import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { z } from "zod";
import { nanoid } from "nanoid";
import twilio from "twilio";
import { stripeService } from "./stripeService";
import bcrypt from "bcrypt";
import OpenAI from "openai";
import {
  insertDriverProfileSchema,
  insertVehicleSchema,
  insertRideSchema,
  insertDisputeSchema,
  insertEmergencyIncidentSchema,
} from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Extend Express session type to include testUserId and regular userId
declare module "express-session" {
  interface SessionData {
    testUserId?: string;
    userId?: string;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Email/Password Authentication Routes
  // POST /api/auth/signup - Register new user
  // Temporary route to seed admin user in production
  app.get('/api/admin/setup-final', async (req, res) => {
    try {
      const adminData = {
        id: 'c53bdd87-1e92-4645-85b6-b2805d2948f6',
        email: 'admin@pgcountyrideshare.com',
        password: '$2b$10$EPJMi2pAl649yRepAfG.SeKO5Wprxat12nWNnebDCOuy/tMs6MXCa',
        firstName: 'PG County',
        lastName: 'Administrator',
        isAdmin: true,
        isVerified: true,
        virtualCardBalance: "1000.00"
      };

      await storage.upsertUser(adminData);
      res.send("<h1>Admin setup successful!</h1><p>You can now close this tab and log in.</p>");
    } catch (error: any) {
      console.error("Setup error:", error);
      res.status(500).send(`<h1>Setup failed</h1><p>${error.message}</p>`);
    }
  });

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const signupSchema = z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
        firstName: z.string().min(1, "First name is required"),
        lastName: z.string().min(1, "Last name is required"),
        phone: z.string().optional()
      });

      const { email, password, firstName, lastName, phone } = signupSchema.parse(req.body);

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone
      });

      // Set session
      req.session.userId = user.id;
      
      res.json({ 
        message: "Signup successful",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          virtualCardBalance: user.virtualCardBalance,
          isDriver: user.isDriver
        }
      });
    } catch (error) {
      console.error("Signup error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Signup failed" });
    }
  });

  // POST /api/auth/email-login - Login with email and password
  app.post('/api/auth/email-login', async (req, res) => {
    try {
      const loginSchema = z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(1, "Password is required")
      });

      const { email, password } = loginSchema.parse(req.body);

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Set session
      req.session.userId = user.id;
      
      res.json({ 
        message: "Login successful",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          virtualCardBalance: user.virtualCardBalance,
          isDriver: user.isDriver
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Login failed" });
    }
  });

  // POST /api/auth/forgot-password - Request password reset
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const forgotPasswordSchema = z.object({
        email: z.string().email("Invalid email address")
      });

      const { email } = forgotPasswordSchema.parse(req.body);

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal that user doesn't exist for security
        return res.json({ message: "If the email exists, a password reset link will be sent" });
      }

      // Generate reset token
      const resetToken = nanoid(32);
      const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Save reset token
      await storage.setPasswordResetToken(email, resetToken, resetExpiry);

      // In production, you would send an email here
      // For now, we'll just return the token (development only)
      console.log(`Password reset token for ${email}: ${resetToken}`);
      
      res.json({ 
        message: "If the email exists, a password reset link will be sent",
        resetToken: process.env.NODE_ENV === 'development' ? resetToken : undefined
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Password reset request failed" });
    }
  });

  // POST /api/auth/reset-password - Reset password with token
  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const resetPasswordSchema = z.object({
        token: z.string().min(1, "Reset token is required"),
        newPassword: z.string().min(8, "Password must be at least 8 characters")
      });

      const { token, newPassword } = resetPasswordSchema.parse(req.body);

      // Find user by reset token
      const user = await storage.getUserByResetToken(token);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password and clear reset token
      await storage.updatePassword(user.id, hashedPassword);

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Reset password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Password reset failed" });
    }
  });

  // POST /api/auth/logout - Logout user
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  // Test authentication route for test riders - EXPLICITLY DISABLED BY DEFAULT
  // Only enable when ENABLE_TEST_LOGIN environment variable is explicitly set to 'true'
  // This ensures the endpoint is NEVER available in production unless explicitly configured
  if (process.env.ENABLE_TEST_LOGIN === 'true') {
    const TEST_PASSWORD = process.env.TEST_PASSWORD || "Fes5036tus@3";
    const TEST_RIDERS = [
      { id: 'test-rider-1', email: 'magdelineakingba@gmail.com' },
      { id: 'test-rider-2', email: 'wunmiakingba@gmail.com' },
      { id: 'test-rider-3', email: 'bolaakingba@gmail.com' },
    ];

    console.log('⚠️  WARNING: Test login endpoint is ENABLED. This should ONLY be used in local development!');

    app.post('/api/auth/test-login', async (req, res) => {
      try {
        const { email, password } = req.body;
        
        const testRider = TEST_RIDERS.find(r => r.email === email);
        if (!testRider || password !== TEST_PASSWORD) {
          return res.status(401).json({ message: "Invalid credentials" });
        }

        const user = await storage.getUser(testRider.id);
        if (!user) {
          return res.status(404).json({ message: "Test user not found in database" });
        }

        req.session.testUserId = testRider.id;
        
        res.json({ 
          message: "Login successful",
          user: {
            ...user,
            driverProfile: null
          }
        });
      } catch (error) {
        console.error("Test login error:", error);
        res.status(500).json({ message: "Login failed" });
      }
    });
  } else {
    console.log('✅ Test login endpoint is DISABLED (production safe)');
  }

  // Auth routes
  app.get('/api/auth/user', async (req: any, res) => {
    try {
      // Check for session-based userId first (email/password auth)
      const sessionUserId = req.session?.userId;
      // Then check for test user session
      const testUserId = req.session?.testUserId;
      let userId: string;
      
      if (sessionUserId) {
        userId = sessionUserId;
      } else if (testUserId) {
        userId = testUserId;
      } else if (req.isAuthenticated() && req.user?.claims?.sub) {
        userId = req.user.claims.sub;
      } else {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Get driver profile if user is a driver
      let driverProfile = null;
      if (user.isDriver) {
        driverProfile = await storage.getDriverProfile(userId);
      }
      
      res.json({ ...user, driverProfile });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Object storage routes for driver documents
  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    res.json({ uploadURL });
  });

  // Driver profile routes
  app.post('/api/driver/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const profileData = insertDriverProfileSchema.parse({
        ...req.body,
        userId
      });
      
      const profile = await storage.createDriverProfile(profileData);
      
      // Update user to mark as driver
      await storage.upsertUser({ id: userId, isDriver: true });
      
      res.json(profile);
    } catch (error) {
      console.error("Error creating driver profile:", error);
      res.status(400).json({ message: "Failed to create driver profile" });
    }
  });

  app.put('/api/driver/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const updates = req.body;
      
      const profile = await storage.updateDriverProfile(userId, updates);
      res.json(profile);
    } catch (error) {
      console.error("Error updating driver profile:", error);
      res.status(400).json({ message: "Failed to update driver profile" });
    }
  });

  app.post('/api/driver/toggle-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { isOnline } = req.body;
      
      await storage.toggleDriverOnlineStatus(userId, isOnline);
      res.json({ success: true });
    } catch (error) {
      console.error("Error toggling driver status:", error);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  app.post('/api/driver/location', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { lat, lng } = req.body;
      
      await storage.updateDriverLocation(userId, { lat, lng });
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating driver location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  // Driver ride management endpoints
  app.get('/api/driver/pending-rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getPendingRidesForDriver(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching pending rides:", error);
      res.status(500).json({ message: "Failed to fetch pending rides" });
    }
  });

  app.post('/api/driver/rides/:rideId/accept', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      const ride = await storage.acceptRide(rideId, userId);
      
      // If ride uses card payment, deduct from virtual card balance
      if (ride.paymentMethod === 'card') {
        try {
          const estimatedFare = parseFloat(ride.estimatedFare || "0");
          
          console.log(`Deducting virtual card balance for ride ${rideId}: $${estimatedFare}`);
          
          // Deduct the estimated fare from rider's virtual card balance
          await storage.deductVirtualCardBalance(ride.riderId, estimatedFare);
          
          // Update ride to show payment is authorized
          await storage.setRidePaymentAuthorization(rideId, `virtual-${rideId}`);
          
          console.log(`Virtual card balance deducted successfully for ride ${rideId}`);
        } catch (error: any) {
          console.error("Failed to authorize virtual card payment:", error);
          throw new Error(`Payment authorization failed: ${error.message}`);
        }
      }
      
      // Send targeted WebSocket messages to driver and rider only  
      const rideAcceptedMessage = {
        type: 'ride_accepted',
        rideId: ride.id,
        driverId: userId,
        riderId: ride.riderId
      };
      
      // Send to driver
      if (activeConnections.has(userId)) {
        const driverWs = activeConnections.get(userId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(rideAcceptedMessage));
        }
      }
      
      // Send to rider
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(rideAcceptedMessage));
        }
      }
      
      res.json(ride);
    } catch (error) {
      console.error("Error accepting ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to accept ride" });
      }
    }
  });

  app.post('/api/driver/rides/:rideId/decline', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      await storage.declineRide(rideId, userId);
      
      // Get the ride to access riderId for targeted messaging
      const ride = await storage.getRide(rideId);
      if (ride) {
        // Send targeted WebSocket messages to driver and rider only
        const rideDeclinedMessage = {
          type: 'ride_declined',
          rideId,
          driverId: userId,
          riderId: ride.riderId
        };
        
        // Send to driver
        if (activeConnections.has(userId)) {
          const driverWs = activeConnections.get(userId);
          if (driverWs && driverWs.readyState === WebSocket.OPEN) {
            driverWs.send(JSON.stringify(rideDeclinedMessage));
          }
        }
        
        // Send to rider
        if (activeConnections.has(ride.riderId)) {
          const riderWs = activeConnections.get(ride.riderId);
          if (riderWs && riderWs.readyState === WebSocket.OPEN) {
            riderWs.send(JSON.stringify(rideDeclinedMessage));
          }
        }
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error declining ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to decline ride" });
      }
    }
  });

  // Driver ride status update endpoints
  app.post('/api/driver/rides/:rideId/start', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      const ride = await storage.startRide(rideId, userId);
      
      // Send targeted WebSocket messages to driver and rider only
      const rideStartedMessage = {
        type: 'ride_started',
        rideId: ride.id,
        driverId: userId,
        riderId: ride.riderId,
        status: 'in_progress'
      };
      
      // Send to driver
      if (activeConnections.has(userId)) {
        const driverWs = activeConnections.get(userId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(rideStartedMessage));
        }
      }
      
      // Send to rider
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(rideStartedMessage));
        }
      }
      
      res.json(ride);
    } catch (error) {
      console.error("Error starting ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to start ride" });
      }
    }
  });

  // Track GPS waypoint during active ride
  app.post('/api/driver/rides/:rideId/track-location', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate waypoint
      const waypointSchema = z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180)
      });
      
      const { lat, lng } = waypointSchema.parse(req.body);
      
      await storage.addRouteWaypoint(rideId, userId, { lat, lng });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error tracking location:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to track location" });
      }
    }
  });

  // Get real-time ride stats (distance, duration, estimated fare)
  app.get('/api/driver/rides/:rideId/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      const stats = await storage.getRideStats(rideId, userId);
      
      res.json(stats);
    } catch (error) {
      console.error("Error getting ride stats:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to get ride stats" });
      }
    }
  });

  app.post('/api/driver/rides/:rideId/complete', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate request body - actualFare is now optional to allow automatic calculation
      const completeRideSchema = z.object({
        actualFare: z.number().positive("Actual fare must be a positive number").optional(),
        tipAmount: z.number().min(0).optional()
      });
      
      const { actualFare, tipAmount } = completeRideSchema.parse(req.body);
      
      const ride = await storage.completeRide(rideId, userId, actualFare);
      
      // If ride uses card payment, process virtual card payment
      if (ride.paymentMethod === 'card' && ride.stripePaymentIntentId) {
        try {
          const estimatedFare = parseFloat(ride.estimatedFare || "0");
          const finalFare = actualFare ?? parseFloat(ride.actualFare || "0");
          const totalAmount = finalFare + (tipAmount || 0);
          const priceDifference = finalFare - estimatedFare;
          
          console.log(`Processing virtual card payment for ride ${rideId}: Estimated: $${estimatedFare}, Actual: $${actualFare}, Tip: $${tipAmount || 0}`);
          
          // If actual fare is less than estimated, refund the difference
          if (priceDifference < 0) {
            await storage.addVirtualCardBalance(ride.riderId, Math.abs(priceDifference));
            console.log(`Refunded $${Math.abs(priceDifference)} to rider`);
          }
          // If actual fare is more than estimated, deduct the difference
          else if (priceDifference > 0) {
            await storage.deductVirtualCardBalance(ride.riderId, priceDifference);
            console.log(`Deducted additional $${priceDifference} from rider`);
          }
          
          // If there's a tip, deduct it from rider
          if (tipAmount && tipAmount > 0) {
            await storage.deductVirtualCardBalance(ride.riderId, tipAmount);
            console.log(`Deducted tip $${tipAmount} from rider`);
          }
          
          // Add the total amount to driver's virtual card balance
          if (ride.driverId) {
            await storage.addVirtualCardBalance(ride.driverId, totalAmount);
            console.log(`Added $${totalAmount} to driver's balance`);
          }
          
          await storage.captureRidePayment(rideId, actualFare, tipAmount);
          
          console.log(`Virtual card payment processed successfully for ride ${rideId}`);
        } catch (error: any) {
          console.error("Failed to process virtual card payment:", error);
          throw new Error(`Payment processing failed: ${error.message}`);
        }
      }
      
      // Track driver hours for ownership qualification
      if (ride.startedAt && ride.driverId) {
        try {
          const startTime = new Date(ride.startedAt).getTime();
          const endTime = new Date().getTime();
          const rideDurationMinutes = Math.round((endTime - startTime) / (1000 * 60));
          if (rideDurationMinutes > 0) {
            await storage.addDriverMinutes(ride.driverId, rideDurationMinutes);
          }
        } catch (err) {
          console.error("Failed to track driver hours:", err);
        }
      }

      // Send targeted WebSocket messages to driver and rider only
      const rideCompletedMessage = {
        type: 'ride_completed',
        rideId: ride.id,
        driverId: userId,
        riderId: ride.riderId,
        status: 'completed'
      };
      
      // Send to driver
      if (activeConnections.has(userId)) {
        const driverWs = activeConnections.get(userId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(rideCompletedMessage));
        }
      }
      
      // Send to rider
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(rideCompletedMessage));
        }
      }
      
      res.json(ride);
    } catch (error) {
      console.error("Error completing ride:", error);
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to complete ride" });
      }
    }
  });

  app.get('/api/driver/active-rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getActiveRidesForDriver(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching active rides:", error);
      res.status(500).json({ message: "Failed to fetch active rides" });
    }
  });

  // Driver earnings endpoints
  app.get('/api/driver/earnings/:period', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { period } = req.params;
      
      if (!['today', 'week', 'month'].includes(period)) {
        return res.status(400).json({ message: "Invalid period. Use 'today', 'week', or 'month'" });
      }
      
      const earnings = await storage.getDriverEarnings(userId, period as 'today' | 'week' | 'month');
      res.json(earnings);
    } catch (error) {
      console.error("Error fetching driver earnings:", error);
      res.status(500).json({ message: "Failed to fetch earnings" });
    }
  });

  app.get('/api/driver/rides/:period', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { period } = req.params;
      
      if (!['today', 'week', 'month'].includes(period)) {
        return res.status(400).json({ message: "Invalid period. Use 'today', 'week', or 'month'" });
      }
      
      const rides = await storage.getDriverRides(userId, period as 'today' | 'week' | 'month');
      res.json(rides);
    } catch (error) {
      console.error("Error fetching driver rides:", error);
      res.status(500).json({ message: "Failed to fetch rides" });
    }
  });

  // Vehicle routes
  app.get('/api/vehicles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const driverProfile = await storage.getDriverProfile(userId);
      if (!driverProfile) {
        return res.json([]);
      }
      const vehicleList = await storage.getVehiclesByDriverId(driverProfile.id);
      res.json(vehicleList);
    } catch (error) {
      console.error("Error getting vehicles:", error);
      res.status(500).json({ message: "Failed to get vehicles" });
    }
  });

  app.post('/api/vehicles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const driverProfile = await storage.getDriverProfile(userId);
      
      if (!driverProfile) {
        return res.status(400).json({ message: "Driver profile required" });
      }
      
      const vehicleData = insertVehicleSchema.parse({
        ...req.body,
        driverProfileId: driverProfile.id
      });
      
      const vehicle = await storage.createVehicle(vehicleData);
      res.json(vehicle);
    } catch (error) {
      console.error("Error creating vehicle:", error);
      res.status(400).json({ message: "Failed to create vehicle" });
    }
  });

  app.put('/api/vehicles/:vehicleId', isAuthenticated, async (req: any, res) => {
    try {
      const { vehicleId } = req.params;
      const updates = req.body;
      
      const vehicle = await storage.updateVehicle(vehicleId, updates);
      res.json(vehicle);
    } catch (error) {
      console.error("Error updating vehicle:", error);
      res.status(400).json({ message: "Failed to update vehicle" });
    }
  });

  // Handle vehicle photo uploads
  app.put("/api/vehicles/photos", isAuthenticated, async (req: any, res) => {
    if (!req.body.photoURL || !req.body.vehicleId) {
      return res.status(400).json({ error: "photoURL and vehicleId are required" });
    }

    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;

    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.photoURL,
        {
          owner: userId,
          visibility: "private", // Vehicle photos should be private
        },
      );

      // Update vehicle photos array
      const vehicle = await storage.updateVehicle(req.body.vehicleId, {
        photos: req.body.photos || []
      });

      res.status(200).json({
        objectPath: objectPath,
        vehicle: vehicle,
      });
    } catch (error) {
      console.error("Error setting vehicle photo:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reverse geocoding - convert coordinates to address
  app.get('/api/geocode/reverse', isAuthenticated, async (req: any, res) => {
    try {
      const { lat, lng } = req.query;
      if (!lat || !lng) {
        return res.status(400).json({ message: "lat and lng required" });
      }
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
        { headers: { 'User-Agent': 'PGRide-Community-Rideshare/1.0' } }
      );
      if (!response.ok) {
        return res.status(502).json({ message: "Geocoding service unavailable" });
      }
      const data = await response.json() as any;
      const addr = data.address || {};
      const parts: string[] = [];
      if (addr.house_number && addr.road) {
        parts.push(`${addr.house_number} ${addr.road}`);
      } else if (addr.road) {
        parts.push(addr.road);
      }
      const city = addr.city || addr.town || addr.village || addr.suburb || addr.hamlet || '';
      const state = addr.state ? (addr.state.length > 2 ? (addr.state === 'Maryland' ? 'MD' : addr.state.substring(0, 2).toUpperCase()) : addr.state) : '';
      const postcode = addr.postcode || '';
      if (city) parts.push(city);
      if (state && postcode) {
        parts.push(`${state} ${postcode}`);
      } else if (state) {
        parts.push(state);
      }
      const address = parts.length > 0 ? parts.join(', ') : data.display_name || 'Unknown location';
      res.json({ address, lat: parseFloat(lat as string), lng: parseFloat(lng as string) });
    } catch (error) {
      console.error("Reverse geocoding error:", error);
      res.status(500).json({ message: "Failed to get address" });
    }
  });

  // Ride routes
  app.get('/api/rides/nearby-drivers', isAuthenticated, async (req: any, res) => {
    try {
      const { lat, lng, radius = 10 } = req.query;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Location required" });
      }
      
      const drivers = await storage.getNearbyDrivers(
        { lat: parseFloat(lat), lng: parseFloat(lng) },
        parseFloat(radius)
      );
      
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching nearby drivers:", error);
      res.status(500).json({ message: "Failed to fetch drivers" });
    }
  });

  // Search drivers by phone number
  app.get('/api/drivers/search', isAuthenticated, async (req: any, res) => {
    try {
      const { phone } = req.query;
      
      if (!phone) {
        return res.status(400).json({ message: "Phone number required" });
      }
      
      const drivers = await storage.searchDriversByPhone(phone as string);
      
      res.json(drivers);
    } catch (error) {
      console.error("Error searching drivers:", error);
      res.status(500).json({ message: "Failed to search drivers" });
    }
  });

  app.post('/api/rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      
      console.log("Ride creation request body:", JSON.stringify(req.body, null, 2));
      
      // SECURITY: Enforce virtual card as the only payment method
      if (req.body.paymentMethod && req.body.paymentMethod !== 'card') {
        return res.status(400).json({ message: "Only virtual card payment is supported" });
      }
      
      // Convert numeric fare to string for decimal field
      const bodyData = { 
        ...req.body,
        paymentMethod: 'card' // Force virtual card payment
      };
      if (typeof bodyData.estimatedFare === 'number') {
        bodyData.estimatedFare = bodyData.estimatedFare.toString();
      }
      
      console.log("Processed body data:", JSON.stringify(bodyData, null, 2));
      
      const dataToValidate = {
        ...bodyData,
        riderId: userId
      };
      
      console.log("Data to validate:", JSON.stringify(dataToValidate, null, 2));
      
      const rideData = insertRideSchema.parse(dataToValidate);
      
      const ride = await storage.createRide(rideData);
      res.json(ride);
    } catch (error) {
      console.error("Error creating ride:", error);
      if (error instanceof z.ZodError) {
        console.error("Zod validation errors:", JSON.stringify(error.errors, null, 2));
      }
      res.status(400).json({ message: "Failed to create ride" });
    }
  });

  app.put('/api/rides/:rideId', isAuthenticated, async (req: any, res) => {
    try {
      const { rideId } = req.params;
      const updates = req.body;
      
      const ride = await storage.updateRide(rideId, updates);
      res.json(ride);
    } catch (error) {
      console.error("Error updating ride:", error);
      res.status(400).json({ message: "Failed to update ride" });
    }
  });

  app.post('/api/rides/:rideId/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      const { reason, driverTraveledDistance, driverTraveledTime } = req.body;
      
      const ride = await storage.getRide(rideId);
      
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }

      // Verify user is authorized to cancel (rider or driver)
      if (ride.riderId !== userId && ride.driverId !== userId) {
        return res.status(403).json({ message: "Unauthorized to cancel this ride" });
      }

      // Calculate cancellation fee for card payments
      let cancellationFee = 0;
      
      if (ride.paymentMethod === 'card' && ride.status === 'accepted' && ride.stripePaymentIntentId) {
        // Smart cancellation fee logic: BOTH conditions must be met
        const distance = driverTraveledDistance || 0;
        const time = driverTraveledTime || 0;
        
        // $5.00 fee if driver traveled >= 3mi AND >= 5min
        if (distance >= 3 && time >= 5) {
          cancellationFee = 5.00;
        }
        // $3.50 fee if driver traveled >= 1.5mi AND >= 3min
        else if (distance >= 1.5 && time >= 3) {
          cancellationFee = 3.50;
        }

        const estimatedFare = parseFloat(ride.estimatedFare || "0");
        
        console.log(`Processing cancellation for ride ${rideId}: Est. fare: $${estimatedFare}, Fee: $${cancellationFee}`);

        // Apply cancellation fee if applicable
        if (cancellationFee > 0) {
          // Refund the estimated fare minus the cancellation fee to the rider
          const refundAmount = estimatedFare - cancellationFee;
          if (refundAmount > 0) {
            await storage.addVirtualCardBalance(ride.riderId, refundAmount);
            console.log(`Refunded $${refundAmount} to rider after $${cancellationFee} cancellation fee`);
          }
          
          // Add the cancellation fee to the driver's balance
          if (ride.driverId) {
            await storage.addVirtualCardBalance(ride.driverId, cancellationFee);
            console.log(`Added $${cancellationFee} cancellation fee to driver's balance`);
          }
          
          await storage.cancelRideWithFee(
            rideId, 
            cancellationFee, 
            reason || "Ride cancelled", 
            driverTraveledDistance,
            driverTraveledTime
          );
        } else {
          // No fee - refund the full estimated fare to the rider
          await storage.addVirtualCardBalance(ride.riderId, estimatedFare);
          console.log(`Refunded full $${estimatedFare} to rider (no cancellation fee)`);
          
          await storage.updateRide(rideId, { 
            status: "cancelled",
            cancellationReason: reason || "Ride cancelled",
            paymentStatus: "cancelled"
          });
        }
      } else {
        // No card payment or not applicable for fee
        await storage.updateRide(rideId, { 
          status: "cancelled",
          cancellationReason: reason || "Ride cancelled"
        });
      }

      const updatedRide = await storage.getRide(rideId);
      
      // Send WebSocket notification
      const cancelMessage = {
        type: 'ride_cancelled',
        rideId: ride.id,
        cancellationFee
      };
      
      if (activeConnections.has(ride.riderId)) {
        const riderWs = activeConnections.get(ride.riderId);
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify(cancelMessage));
        }
      }
      
      if (ride.driverId && activeConnections.has(ride.driverId)) {
        const driverWs = activeConnections.get(ride.driverId);
        if (driverWs && driverWs.readyState === WebSocket.OPEN) {
          driverWs.send(JSON.stringify(cancelMessage));
        }
      }

      res.json({ success: true, ride: updatedRide, cancellationFee });
    } catch (error: any) {
      console.error("Error cancelling ride:", error);
      res.status(500).json({ message: error.message || "Failed to cancel ride" });
    }
  });

  app.get('/api/rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { limit } = req.query;
      
      const rides = await storage.getRidesByUser(userId, limit ? parseInt(limit) : undefined);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching rides:", error);
      res.status(500).json({ message: "Failed to fetch rides" });
    }
  });

  app.get('/api/rides/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getActiveRides(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching active rides:", error);
      res.status(500).json({ message: "Failed to fetch active rides" });
    }
  });

  // Get scheduled rides for the current user
  app.get('/api/rides/scheduled', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getScheduledRides(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching scheduled rides:", error);
      res.status(500).json({ message: "Failed to fetch scheduled rides" });
    }
  });

  // Rating and Payment routes (must come before parameterized /api/rides/:rideId route)
  app.get('/api/rides/for-rating', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getRidesForRating(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching rides for rating:", error);
      res.status(500).json({ message: "Failed to fetch rides for rating" });
    }
  });

  app.get('/api/rides/awaiting-payment', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const rides = await storage.getRidesAwaitingPayment(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching rides awaiting payment:", error);
      res.status(500).json({ message: "Failed to fetch rides awaiting payment" });
    }
  });

  app.get('/api/rides/:rideId', isAuthenticated, async (req: any, res) => {
    try {
      const { rideId } = req.params;
      const ride = await storage.getRide(rideId);
      
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }
      
      res.json(ride);
    } catch (error) {
      console.error("Error fetching ride:", error);
      res.status(500).json({ message: "Failed to fetch ride" });
    }
  });

  app.post('/api/rides/:rideId/rating', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate rating data
      const ratingSchema = z.object({
        rating: z.number().min(1).max(5),
        review: z.string().optional()
      });
      
      const { rating, review } = ratingSchema.parse(req.body);
      
      // Get ride and check authorization
      const ride = await storage.getRide(rideId);
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }
      
      // Check if user is authorized to rate this ride
      if (ride.riderId !== userId && ride.driverId !== userId) {
        return res.status(403).json({ message: "Unauthorized to rate this ride" });
      }
      
      // Check if rating already exists to prevent double-rating
      const isRider = ride.riderId === userId;
      const existingRating = isRider ? ride.driverRating : ride.riderRating;
      
      if (existingRating !== null) {
        return res.status(409).json({ message: "You have already rated this ride" });
      }
      
      await storage.updateRideRating(rideId, userId, rating, review);
      
      // Update the OTHER party's overall rating (not the rater's rating)
      const ratedUserId = isRider ? ride.driverId : ride.riderId;
      if (ratedUserId) {
        await storage.updateUserRating(ratedUserId);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error submitting rating:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid rating data" });
      } else {
        res.status(500).json({ message: "Failed to submit rating" });
      }
    }
  });

  // Payment confirmation route
  app.post('/api/rides/:rideId/confirm-payment', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { rideId } = req.params;
      
      // Validate payment confirmation data
      const paymentSchema = z.object({
        tipAmount: z.number().min(0).optional()
      });
      
      const { tipAmount } = paymentSchema.parse(req.body);
      
      const updatedRide = await storage.confirmCashPayment(rideId, userId, tipAmount);
      
      res.json({ success: true, ride: updatedRide });
    } catch (error) {
      console.error("Error confirming payment:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid payment data" });
      } else if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({ message: error.message });
      } else if (error instanceof Error && (error.message.includes("Only the driver") || error.message.includes("already been confirmed"))) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to confirm payment" });
      }
    }
  });

  // Stripe card payment routes
  app.post('/api/payment/setup-card', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { paymentMethodId } = req.body;
      
      if (!paymentMethodId) {
        return res.status(400).json({ message: "Payment method ID required" });
      }

      let customerId = user.stripeCustomerId;
      
      if (!customerId) {
        customerId = await stripeService.createOrGetCustomer(
          userId,
          user.email || '',
          `${user.firstName || ''} ${user.lastName || ''}`
        );
        await storage.updateUserStripeInfo(userId, customerId);
      }

      await stripeService.attachPaymentMethod(paymentMethodId, customerId);
      await stripeService.setDefaultPaymentMethod(customerId, paymentMethodId);
      await storage.updateUserStripeInfo(userId, customerId, paymentMethodId);

      res.json({ success: true, customerId, paymentMethodId });
    } catch (error: any) {
      console.error("Error setting up card:", error);
      res.status(500).json({ message: error.message || "Failed to set up payment method" });
    }
  });

  app.get('/api/payment/methods', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        hasPaymentMethod: !!user.stripePaymentMethodId,
        stripeCustomerId: user.stripeCustomerId,
        stripePaymentMethodId: user.stripePaymentMethodId
      });
    } catch (error: any) {
      console.error("Error fetching payment methods:", error);
      res.status(500).json({ message: "Failed to fetch payment methods" });
    }
  });

  // Dispute routes
  app.post('/api/disputes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const disputeData = insertDisputeSchema.parse({
        ...req.body,
        reporterId: userId
      });
      
      const dispute = await storage.createDispute(disputeData);
      res.json(dispute);
    } catch (error) {
      console.error("Error creating dispute:", error);
      res.status(400).json({ message: "Failed to create dispute" });
    }
  });

  app.get('/api/disputes/ride/:rideId', isAuthenticated, async (req: any, res) => {
    try {
      const { rideId } = req.params;
      const disputes = await storage.getDisputesByRide(rideId);
      res.json(disputes);
    } catch (error) {
      console.error("Error fetching disputes:", error);
      res.status(500).json({ message: "Failed to fetch disputes" });
    }
  });

  // Emergency contact management routes
  app.put('/api/user/emergency-contact', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { emergencyContact } = req.body;
      
      if (!emergencyContact || typeof emergencyContact !== 'string') {
        return res.status(400).json({ message: "Valid emergency contact phone number required" });
      }
      
      const updatedUser = await storage.updateUserEmergencyContact(userId, emergencyContact);
      res.json({ success: true, user: updatedUser });
    } catch (error) {
      console.error("Error updating emergency contact:", error);
      res.status(500).json({ message: "Failed to update emergency contact" });
    }
  });

  app.post('/api/emergency/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { type } = req.body;
      
      if (!type || !['sms', 'call'].includes(type)) {
        return res.status(400).json({ message: "Type (sms/call) required" });
      }

      // Security: Only allow testing with user's own emergency contact
      const user = await storage.getUser(userId);
      if (!user?.emergencyContact) {
        return res.status(400).json({ message: "Please set an emergency contact first" });
      }
      
      const phoneNumber = user.emergencyContact;

      // Initialize Twilio (check if secrets are available)
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

      if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
        return res.status(500).json({ message: "Twilio credentials not configured" });
      }

      const client = twilio(twilioAccountSid, twilioAuthToken);

      if (type === 'sms') {
        await client.messages.create({
          body: "Test message from PG Ride: Your emergency contact is set up correctly! 🚗",
          from: twilioPhoneNumber,
          to: phoneNumber
        });
      } else if (type === 'call') {
        await client.calls.create({
          twiml: '<Response><Say>Hello! This is a test call from PG Ride. Your emergency contact is set up correctly. Thank you!</Say></Response>',
          from: twilioPhoneNumber,
          to: phoneNumber
        });
      }

      res.json({ success: true, message: `Test ${type} sent successfully` });
    } catch (error) {
      console.error(`Error sending test ${req.body.type}:`, error);
      res.status(500).json({ message: `Failed to send test ${req.body.type}` });
    }
  });

  // Enhanced emergency routes
  app.post('/api/emergency/start', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { incidentType, rideId, location, description } = req.body;
      
      // Generate a unique share token for live location sharing
      const shareToken = nanoid(12);
      
      const incidentData = {
        userId,
        rideId,
        incidentType,
        location,
        description: description || `Emergency incident: ${incidentType}`,
        shareToken,
        emergencyContactAlerted: false
      };
      
      const incident = await storage.createEmergencyIncidentWithSharing(incidentData);
      
      let smsDeliveryStatus = "skipped";
      
      // Send SMS alert to emergency contact if available
      const user = await storage.getUser(userId);
      if (user?.emergencyContact) {
        try {
          const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
          const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
          const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

          if (twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
            const client = twilio(twilioAccountSid, twilioAuthToken);
            
            const locationText = location 
              ? `Location: https://maps.google.com/?q=${location.lat},${location.lng}`
              : "Location: Not available";
            
            const shareUrl = `${req.protocol}://${req.get('host')}/emergency/${shareToken}`;
            
            await client.messages.create({
              body: `🚨 EMERGENCY ALERT from ${user.firstName || 'PG Ride user'}\n\n${description}\n\n${locationText}\n\nLive tracking: ${shareUrl}\n\nReply STOP to opt out.`,
              from: twilioPhoneNumber,
              to: user.emergencyContact
            });
            
            // Update incident to mark emergency contact as alerted
            await storage.updateEmergencyIncident(incident.id, { emergencyContactAlerted: true });
            smsDeliveryStatus = "sent";
          } else {
            console.log("Twilio credentials not configured - emergency alert logged without SMS delivery");
            smsDeliveryStatus = "credentials_missing";
          }
        } catch (twilioError) {
          console.error("Failed to send emergency SMS:", twilioError);
          smsDeliveryStatus = "failed";
        }
      }
      
      // Broadcast emergency alert via WebSocket
      broadcast({
        type: 'emergency_alert',
        incident,
        userId
      });
      
      res.json({ 
        success: true, 
        incident,
        shareUrl: `/emergency/${shareToken}`
      });
    } catch (error) {
      console.error("Error starting emergency incident:", error);
      res.status(500).json({ message: "Failed to start emergency incident" });
    }
  });

  app.put('/api/emergency/:incidentId/location', isAuthenticated, async (req: any, res) => {
    try {
      const { incidentId } = req.params;
      const { location } = req.body;
      
      if (!location || !location.lat || !location.lng) {
        return res.status(400).json({ message: "Valid location coordinates required" });
      }
      
      const updatedIncident = await storage.updateEmergencyIncidentLocation(incidentId, location);
      
      // Broadcast location update via WebSocket
      broadcast({
        type: 'emergency_location_update',
        incidentId,
        location
      });
      
      res.json({ success: true, incident: updatedIncident });
    } catch (error) {
      console.error("Error updating emergency location:", error);
      res.status(500).json({ message: "Failed to update emergency location" });
    }
  });

  // Legacy emergency route for backward compatibility
  app.post('/api/emergency', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const incidentData = insertEmergencyIncidentSchema.parse({
        ...req.body,
        userId
      });
      
      const incident = await storage.createEmergencyIncident(incidentData);
      res.json(incident);
    } catch (error) {
      console.error("Error creating emergency incident:", error);
      res.status(400).json({ message: "Failed to create emergency incident" });
    }
  });

  // Fare calculation endpoint
  app.post('/api/rides/calculate-fare', async (req, res) => {
    try {
      const { distance, duration, driverId } = req.body;
      
      if (!distance || !duration) {
        return res.status(400).json({ message: "Distance and duration required" });
      }

      const SUGGESTED = { minimumFare: 7.65, baseFare: 4.00, perMinuteRate: 0.29, perMileRate: 0.90, surgeAdjustment: 0 };
      let rates = SUGGESTED;

      if (driverId) {
        const rateCard = await storage.getDriverRateCard(driverId);
        if (rateCard && !rateCard.useSuggested) {
          rates = {
            minimumFare: parseFloat(rateCard.minimumFare || "7.65"),
            baseFare: parseFloat(rateCard.baseFare || "4.00"),
            perMinuteRate: parseFloat(rateCard.perMinuteRate || "0.2900"),
            perMileRate: parseFloat(rateCard.perMileRate || "0.9000"),
            surgeAdjustment: parseFloat(rateCard.surgeAdjustment || "0.00"),
          };
        }
      }

      const baseFare = rates.baseFare;
      const timeCharge = rates.perMinuteRate * duration;
      const distanceCharge = rates.perMileRate * distance;
      const surgeAdjustment = rates.surgeAdjustment;
      const subtotal = baseFare + timeCharge + distanceCharge + surgeAdjustment;
      const total = Math.max(rates.minimumFare, Math.min(100, subtotal));
      
      res.json({
        baseFare: parseFloat(baseFare.toFixed(2)),
        timeCharge: parseFloat(timeCharge.toFixed(2)),
        distanceCharge: parseFloat(distanceCharge.toFixed(2)),
        surgeAdjustment: parseFloat(surgeAdjustment.toFixed(2)),
        subtotal: parseFloat(subtotal.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        rates: {
          minimumFare: rates.minimumFare,
          baseFare: rates.baseFare,
          perMinuteRate: rates.perMinuteRate,
          perMileRate: rates.perMileRate,
          surgeAdjustment: rates.surgeAdjustment,
        },
        formula: `Base $${rates.baseFare.toFixed(2)} + ($${rates.perMinuteRate}/min × ${duration} min) + ($${rates.perMileRate}/mi × ${distance} mi)`
      });
    } catch (error) {
      console.error("Error calculating fare:", error);
      res.status(500).json({ message: "Failed to calculate fare" });
    }
  });

  // Driver rate card endpoints
  app.get('/api/driver/rate-card', async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const card = await storage.getDriverRateCard(userId);
      if (!card) {
        return res.json({
          driverId: userId,
          minimumFare: "7.65",
          baseFare: "4.00",
          perMinuteRate: "0.2900",
          perMileRate: "0.9000",
          surgeAdjustment: "0.00",
          useSuggested: true,
        });
      }
      res.json(card);
    } catch (error) {
      console.error("Error fetching rate card:", error);
      res.status(500).json({ message: "Failed to fetch rate card" });
    }
  });

  app.put('/api/driver/rate-card', async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const { minimumFare, baseFare, perMinuteRate, perMileRate, surgeAdjustment, useSuggested } = req.body;

      const updateData: any = {};
      if (minimumFare !== undefined) updateData.minimumFare = String(minimumFare);
      if (baseFare !== undefined) updateData.baseFare = String(baseFare);
      if (perMinuteRate !== undefined) updateData.perMinuteRate = String(perMinuteRate);
      if (perMileRate !== undefined) updateData.perMileRate = String(perMileRate);
      if (surgeAdjustment !== undefined) updateData.surgeAdjustment = String(surgeAdjustment);
      if (useSuggested !== undefined) updateData.useSuggested = useSuggested;

      const card = await storage.upsertDriverRateCard(userId, updateData);
      res.json(card);
    } catch (error) {
      console.error("Error updating rate card:", error);
      res.status(500).json({ message: "Failed to update rate card" });
    }
  });

  // Get a specific driver's rate card (public, used for fare estimation)
  app.get('/api/driver/:driverId/rate-card', async (req: any, res) => {
    try {
      const { driverId } = req.params;
      const card = await storage.getDriverRateCard(driverId);
      const SUGGESTED = { minimumFare: "7.65", baseFare: "4.00", perMinuteRate: "0.2900", perMileRate: "0.9000", surgeAdjustment: "0.00", useSuggested: true };
      res.json(card || { driverId, ...SUGGESTED });
    } catch (error) {
      console.error("Error fetching driver rate card:", error);
      res.status(500).json({ message: "Failed to fetch driver rate card" });
    }
  });

  // JSON API endpoint for emergency incident data (no auth required)
  app.get('/api/emergency/incident/:token', async (req: any, res) => {
    try {
      const { token } = req.params;
      const incident = await storage.getEmergencyIncidentByToken(token);
      
      if (!incident) {
        return res.status(404).json({ message: "Emergency incident not found" });
      }
      
      res.json(incident);
    } catch (error) {
      console.error("Error fetching emergency incident:", error);
      res.status(500).json({ message: "Failed to fetch emergency incident" });
    }
  });

  // Update emergency incident location (authenticated)
  app.post('/api/emergency/update-location', async (req: any, res) => {
    try {
      const { lat, lng, incidentId } = req.body;
      const userId = req.session?.user?.id;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!lat || !lng) {
        return res.status(400).json({ message: "Location coordinates required" });
      }

      // Get active emergency incident for user
      const activeIncidents = await storage.getActiveEmergencyIncidents();
      const userIncident = activeIncidents.find(incident => incident.userId === userId);
      
      if (!userIncident) {
        return res.status(404).json({ message: "No active emergency incident found" });
      }

      // Update incident location
      const updatedIncident = await storage.updateEmergencyIncidentLocation(userIncident.id, { lat, lng });
      
      // Broadcast location update via WebSocket
      broadcast({
        type: 'emergency_location_update',
        incidentId: userIncident.id,
        location: { lat, lng }
      });

      res.json({ success: true, incident: updatedIncident });
    } catch (error) {
      console.error("Error updating emergency location:", error);
      res.status(500).json({ message: "Failed to update emergency location" });
    }
  });

  // Public emergency tracking page (no auth required)
  app.get('/emergency/:token', async (req: any, res) => {
    try {
      const { token } = req.params;
      const incident = await storage.getEmergencyIncidentByToken(token);
      
      if (!incident) {
        return res.status(404).json({ message: "Emergency incident not found" });
      }
      
      // Return basic HTML page for live tracking
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Emergency Tracking - PG Ride</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <style>
            body { margin: 0; font-family: system-ui, sans-serif; }
            #map { height: 100vh; }
            .info-panel { position: absolute; top: 10px; left: 10px; z-index: 1000; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); max-width: 300px; }
            .emergency-badge { background: #dc2626; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; font-weight: bold; margin-bottom: 10px; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="info-panel">
            <div class="emergency-badge">🚨 EMERGENCY TRACKING</div>
            <div><strong>Incident:</strong> ${incident.description || incident.incidentType}</div>
            <div><strong>Time:</strong> ${incident.createdAt ? new Date(incident.createdAt).toLocaleString() : 'Unknown'}</div>
            <div><strong>Status:</strong> ${incident.status}</div>
            ${incident.lastLocationUpdate ? `<div><strong>Last Update:</strong> ${new Date(incident.lastLocationUpdate).toLocaleTimeString()}</div>` : ''}
          </div>
          <div id="map"></div>
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <script>
            const incident = ${JSON.stringify(incident)};
            const map = L.map('map');
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            
            if (incident.location) {
              const marker = L.marker([incident.location.lat, incident.location.lng]).addTo(map);
              marker.bindPopup('Emergency Location').openPopup();
              map.setView([incident.location.lat, incident.location.lng], 15);
            } else {
              map.setView([38.9897, -76.9378], 11); // PG County center
            }
            
            // WebSocket for live updates
            const ws = new WebSocket('${req.protocol === 'https' ? 'wss' : 'ws'}://${req.get('host')}/ws');
            ws.onmessage = function(event) {
              const data = JSON.parse(event.data);
              if (data.type === 'emergency_location_update' && data.incidentId === incident.id) {
                marker.setLatLng([data.location.lat, data.location.lng]);
                map.setView([data.location.lat, data.location.lng], 15);
                document.querySelector('.info-panel').innerHTML += '<div style="color: green; font-size: 12px; margin-top: 5px;">📍 Location updated</div>';
              }
            };
          </script>
        </body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Error serving emergency tracking page:", error);
      res.status(500).json({ message: "Failed to load emergency tracking" });
    }
  });

  // ============================================================
  // ADMIN ROUTES
  // ============================================================

  const isAdminOrSessionAuth = async (req: any, res: any, next: any) => {
    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    next();
  };

  const sessionOrOidcAuth = async (req: any, res: any, next: any) => {
    const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    next();
  };

  // Dashboard stats
  app.get('/api/admin/dashboard', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // All users
  app.get('/api/admin/users', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { limit = 100, offset = 0 } = req.query;
      const allUsers = await storage.getAllUsers(parseInt(limit), parseInt(offset));
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Update user (admin actions)
  app.patch('/api/admin/users/:userId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { userId } = req.params;
      const updates = req.body;
      const user = await storage.adminUpdateUser(userId, updates);
      await storage.logAdminAction(adminId, 'update_user', 'user', userId, updates);
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // All drivers
  app.get('/api/admin/drivers', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const drivers = await storage.getAllDrivers();
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching drivers:", error);
      res.status(500).json({ message: "Failed to fetch drivers" });
    }
  });

  // Update driver profile (approve, suspend, verify)
  app.patch('/api/admin/drivers/:userId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { userId } = req.params;
      const updates = req.body;
      const profile = await storage.adminUpdateDriverProfile(userId, updates);
      await storage.logAdminAction(adminId, 'update_driver', 'driver_profile', userId, updates);
      res.json(profile);
    } catch (error) {
      console.error("Error updating driver:", error);
      res.status(500).json({ message: "Failed to update driver" });
    }
  });

  // All rides
  app.get('/api/admin/rides', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { limit = 100, offset = 0 } = req.query;
      const allRides = await storage.getAllRides(parseInt(limit), parseInt(offset));
      res.json(allRides);
    } catch (error) {
      console.error("Error fetching rides:", error);
      res.status(500).json({ message: "Failed to fetch rides" });
    }
  });

  // All disputes
  app.get('/api/admin/disputes', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const allDisputes = await storage.getAllDisputes();
      res.json(allDisputes);
    } catch (error) {
      console.error("Error fetching disputes:", error);
      res.status(500).json({ message: "Failed to fetch disputes" });
    }
  });

  // Resolve dispute
  app.patch('/api/admin/disputes/:disputeId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { disputeId } = req.params;
      const { resolution } = req.body;
      const dispute = await storage.adminResolveDispute(disputeId, resolution, adminId);
      await storage.logAdminAction(adminId, 'resolve_dispute', 'dispute', disputeId, { resolution });
      res.json(dispute);
    } catch (error) {
      console.error("Error resolving dispute:", error);
      res.status(500).json({ message: "Failed to resolve dispute" });
    }
  });

  // Financial summary
  app.get('/api/admin/finances', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { year } = req.query;
      const summary = await storage.getFinancialSummary(year ? parseInt(year) : undefined);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching financial summary:", error);
      res.status(500).json({ message: "Failed to fetch financial summary" });
    }
  });

  // Ownership management
  app.get('/api/admin/ownership', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const owners = await storage.getAllOwners();
      const allRecords = await storage.getAllOwnershipRecords();
      const certificates = await storage.getShareCertificates();
      const rebalanceLog = await storage.getRebalanceLog();
      res.json({ owners, allRecords, certificates, rebalanceLog });
    } catch (error) {
      console.error("Error fetching ownership data:", error);
      res.status(500).json({ message: "Failed to fetch ownership data" });
    }
  });

  // Recalculate ownership
  app.post('/api/admin/ownership/recalculate', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const result = await storage.recalculateOwnership();
      await storage.logAdminAction(adminId, 'recalculate_ownership', 'ownership', undefined, result);
      res.json(result);
    } catch (error) {
      console.error("Error recalculating ownership:", error);
      res.status(500).json({ message: "Failed to recalculate ownership" });
    }
  });

  // Update driver ownership record (background check, adverse record)
  app.patch('/api/admin/ownership/:driverId', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { driverId } = req.params;
      const updates = req.body;

      const ownership = await storage.getOrCreateOwnership(driverId);
      const updatedFields: any = { updatedAt: new Date() };
      if (updates.backgroundCheckStatus !== undefined) updatedFields.backgroundCheckStatus = updates.backgroundCheckStatus;
      if (updates.hasAdverseRecord !== undefined) updatedFields.hasAdverseRecord = updates.hasAdverseRecord;
      if (updates.violationNotes !== undefined) updatedFields.violationNotes = updates.violationNotes;
      if (updates.backgroundCheckDate !== undefined) updatedFields.backgroundCheckDate = new Date(updates.backgroundCheckDate);

      const { db: dbInstance } = await import("./db");
      const { driverOwnership } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await dbInstance.update(driverOwnership).set(updatedFields).where(eq(driverOwnership.id, ownership.id));

      await storage.logAdminAction(adminId, 'update_ownership', 'ownership', driverId, updates);
      const updated = await storage.getDriverOwnershipStatus(driverId);
      res.json(updated);
    } catch (error) {
      console.error("Error updating ownership:", error);
      res.status(500).json({ message: "Failed to update ownership" });
    }
  });

  // Profit declarations
  app.get('/api/admin/profits', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const declarations = await storage.getProfitDeclarations();
      res.json(declarations);
    } catch (error) {
      console.error("Error fetching profit declarations:", error);
      res.status(500).json({ message: "Failed to fetch profit declarations" });
    }
  });

  app.post('/api/admin/profits', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const data = { ...req.body, declaredBy: adminId };
      const declaration = await storage.createProfitDeclaration(data);
      await storage.logAdminAction(adminId, 'create_profit_declaration', 'profit_declaration', declaration.id, data);
      res.json(declaration);
    } catch (error) {
      console.error("Error creating profit declaration:", error);
      res.status(500).json({ message: "Failed to create profit declaration" });
    }
  });

  app.post('/api/admin/profits/:id/declare', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const declaration = await storage.declareProfitDistribution(req.params.id);
      await storage.logAdminAction(adminId, 'declare_profit', 'profit_declaration', req.params.id);
      res.json(declaration);
    } catch (error: any) {
      console.error("Error declaring profit:", error);
      res.status(400).json({ message: error.message || "Failed to declare profit" });
    }
  });

  app.post('/api/admin/profits/:id/distribute', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const adminId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const distributions = await storage.distributeProfits(req.params.id);
      await storage.logAdminAction(adminId, 'distribute_profit', 'profit_declaration', req.params.id);
      res.json(distributions);
    } catch (error: any) {
      console.error("Error distributing profit:", error);
      res.status(400).json({ message: error.message || "Failed to distribute profit" });
    }
  });

  app.get('/api/admin/profits/:id/distributions', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const distributions = await storage.getProfitDistributions(req.params.id);
      res.json(distributions);
    } catch (error) {
      console.error("Error fetching distributions:", error);
      res.status(500).json({ message: "Failed to fetch distributions" });
    }
  });

  // Admin activity log
  app.get('/api/admin/activity-log', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const log = await storage.getAdminActivityLog();
      res.json(log);
    } catch (error) {
      console.error("Error fetching activity log:", error);
      res.status(500).json({ message: "Failed to fetch activity log" });
    }
  });

  // ============================================================
  // DRIVER OWNERSHIP STATUS (for drivers themselves)
  // ============================================================

  app.get('/api/driver/ownership', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const ownership = await storage.getOrCreateOwnership(userId);
      const weeklyHours = await storage.getDriverWeeklyHoursHistory(userId, 52);
      const certificates = await storage.getShareCertificates(userId);
      const profitHistory = await storage.getDriverProfitDistributions(userId);
      res.json({ ownership, weeklyHours, certificates, profitHistory });
    } catch (error) {
      console.error("Error fetching ownership status:", error);
      res.status(500).json({ message: "Failed to fetch ownership status" });
    }
  });

  // ============================================================
  // AI ASSISTANT CHAT ROUTES
  // ============================================================

  const BASE_SYSTEM_PROMPT = `You are PG Ride Assistant, a helpful AI assistant for the PG County Community Ride-Share Platform. You help riders and drivers with questions about:
- How to book rides, schedule rides, and find drivers
- Payment information (Virtual PG Card system, fare estimation)
- Driver registration and verification
- Safety features (SOS, emergency contacts, live tracking)
- Ride history, ratings, and disputes
- The cooperative ownership model for drivers
- General questions about the platform

Be friendly, concise, and helpful. Keep responses brief but informative.`;

  async function buildPersonalizedPrompt(userId: string): Promise<string> {
    try {
      const user = await storage.getUser(userId);
      if (!user) return BASE_SYSTEM_PROMPT;

      const recentRides = await storage.getRidesByUser(userId, 5);
      const completedRides = recentRides.filter(r => r.status === 'completed');
      const activeRides = recentRides.filter(r => ['pending', 'accepted', 'driver_arriving', 'in_progress'].includes(r.status || ''));

      let context = BASE_SYSTEM_PROMPT + `\n\n--- USER CONTEXT (use this to personalize your responses) ---`;
      context += `\nUser: ${user.firstName || 'Unknown'} ${user.lastName || ''}`;
      context += `\nRole: ${user.isDriver ? 'Driver' : 'Rider'}`;
      context += `\nRating: ${user.rating || '5.00'}/5`;
      context += `\nTotal Rides: ${user.totalRides || 0}`;
      context += `\nVirtual Card Balance: $${user.virtualCardBalance || '0.00'}`;

      if (activeRides.length > 0) {
        context += `\nActive Rides: ${activeRides.length} (statuses: ${activeRides.map(r => r.status).join(', ')})`;
      }

      if (completedRides.length > 0) {
        const avgFare = completedRides.reduce((sum, r) => sum + parseFloat(r.actualFare?.toString() || '0'), 0) / completedRides.length;
        context += `\nRecent Completed Rides: ${completedRides.length}`;
        context += `\nAvg Fare: $${avgFare.toFixed(2)}`;
      }

      if (user.isDriver) {
        const profile = await storage.getDriverProfile(userId);
        if (profile) {
          context += `\nDriver Status: ${profile.isOnline ? 'Online' : 'Offline'}`;
          context += `\nVerified Neighbor: ${profile.isVerifiedNeighbor ? 'Yes' : 'No'}`;
          context += `\nApproval: ${profile.approvalStatus}`;
        }
      }

      context += `\n--- END USER CONTEXT ---`;
      context += `\nUse this context to give personalized, relevant answers. Reference their actual data when helpful (e.g., balance, ride count). Don't repeat this context back verbatim.`;

      return context;
    } catch {
      return BASE_SYSTEM_PROMPT;
    }
  }

  app.get('/api/ai/conversations', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const convos = await storage.getConversationsByUser(userId);
      res.json(convos);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.post('/api/ai/conversations', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { title } = req.body;
      const conversation = await storage.createConversation(userId, title || "New Chat");
      res.json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  });

  app.get('/api/ai/conversations/:id/messages', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { id } = req.params;
      const convo = await storage.getConversation(id, userId);
      if (!convo) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      const messages = await storage.getChatMessages(id);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.delete('/api/ai/conversations/:id', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { id } = req.params;
      await storage.deleteConversation(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  app.post('/api/ai/conversations/:id/messages', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { id } = req.params;
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({ message: "Message content is required" });
      }

      const convo = await storage.getConversation(id, userId);
      if (!convo) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      await storage.createChatMessage(id, "user", content);

      const existingMessages = await storage.getChatMessages(id);
      const personalizedPrompt = await buildPersonalizedPrompt(userId);
      const chatHistory: Array<{role: "system" | "user" | "assistant", content: string}> = [
        { role: "system", content: personalizedPrompt },
        ...existingMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: chatHistory,
        stream: true,
        max_completion_tokens: 1024,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) {
          fullResponse += delta;
          res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
        }
      }

      await storage.createChatMessage(id, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error sending AI message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to get AI response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: "Failed to send message" });
      }
    }
  });

  // ============================================================
  // ANALYTICS & SELF-LEARNING ROUTES
  // ============================================================

  app.post('/api/analytics/events', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { eventType, eventCategory, eventData, sessionId } = req.body;
      if (!eventType || !eventCategory) {
        return res.status(400).json({ message: "eventType and eventCategory are required" });
      }
      const event = await storage.trackEvent({ userId, eventType, eventCategory, eventData, sessionId });
      res.json(event);
    } catch (error) {
      console.error("Error tracking event:", error);
      res.status(500).json({ message: "Failed to track event" });
    }
  });

  app.post('/api/ai/feedback', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const { messageId, conversationId, rating, reason } = req.body;
      if (!messageId || !conversationId || !rating) {
        return res.status(400).json({ message: "messageId, conversationId, and rating are required" });
      }
      const feedback = await storage.submitAiFeedback({ messageId, conversationId, userId, rating, reason });
      res.json(feedback);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  app.get('/api/faq', async (req, res) => {
    try {
      const entries = await storage.getFaqEntries(true);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching FAQs:", error);
      res.status(500).json({ message: "Failed to fetch FAQs" });
    }
  });

  app.get('/api/driver/scorecard', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const scorecard = await storage.upsertDriverScorecard(userId);
      res.json(scorecard);
    } catch (error) {
      console.error("Error fetching scorecard:", error);
      res.status(500).json({ message: "Failed to fetch scorecard" });
    }
  });

  app.get('/api/driver/optimal-hours', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const hours = await storage.getDriverOptimalHours(userId);
      res.json(hours);
    } catch (error) {
      console.error("Error fetching optimal hours:", error);
      res.status(500).json({ message: "Failed to fetch optimal hours" });
    }
  });

  app.get('/api/demand-heatmap', sessionOrOidcAuth, async (req: any, res) => {
    try {
      const hourOfDay = req.query.hour ? parseInt(req.query.hour) : undefined;
      const dayOfWeek = req.query.day ? parseInt(req.query.day) : undefined;
      const data = await storage.getDemandHeatmap(hourOfDay, dayOfWeek);
      res.json(data);
    } catch (error) {
      console.error("Error fetching demand heatmap:", error);
      res.status(500).json({ message: "Failed to fetch demand data" });
    }
  });

  // Admin analytics routes
  app.get('/api/admin/analytics/events', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const days = parseInt(req.query.days || '7');
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const stats = await storage.getEventStats(startDate, new Date());
      res.json(stats);
    } catch (error) {
      console.error("Error fetching event stats:", error);
      res.status(500).json({ message: "Failed to fetch event stats" });
    }
  });

  app.get('/api/admin/analytics/ai-feedback', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const stats = await storage.getAiFeedbackStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching AI feedback stats:", error);
      res.status(500).json({ message: "Failed to fetch AI feedback stats" });
    }
  });

  app.get('/api/admin/analytics/conversion', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const days = parseInt(req.query.days || '30');
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const metrics = await storage.getConversionMetrics(startDate, new Date());
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching conversion metrics:", error);
      res.status(500).json({ message: "Failed to fetch conversion metrics" });
    }
  });

  app.get('/api/admin/analytics/insights', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const insights = await storage.getPlatformInsights();
      res.json(insights);
    } catch (error) {
      console.error("Error fetching insights:", error);
      res.status(500).json({ message: "Failed to fetch insights" });
    }
  });

  app.post('/api/admin/analytics/insights/:id/read', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      await storage.markInsightRead(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking insight read:", error);
      res.status(500).json({ message: "Failed to mark insight" });
    }
  });

  app.get('/api/admin/analytics/safety-alerts', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const alerts = await storage.getActiveSafetyAlerts();
      res.json(alerts);
    } catch (error) {
      console.error("Error fetching safety alerts:", error);
      res.status(500).json({ message: "Failed to fetch safety alerts" });
    }
  });

  app.post('/api/admin/analytics/safety-alerts/:id/resolve', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.session?.testUserId || req.user?.claims?.sub;
      const alert = await storage.resolveSafetyAlert(req.params.id, userId);
      res.json(alert);
    } catch (error) {
      console.error("Error resolving safety alert:", error);
      res.status(500).json({ message: "Failed to resolve alert" });
    }
  });

  app.get('/api/admin/analytics/scorecards', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const scorecards = await storage.getAllDriverScorecards();
      res.json(scorecards);
    } catch (error) {
      console.error("Error fetching scorecards:", error);
      res.status(500).json({ message: "Failed to fetch scorecards" });
    }
  });

  app.get('/api/admin/faq', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const entries = await storage.getFaqEntries(false);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching FAQs:", error);
      res.status(500).json({ message: "Failed to fetch FAQs" });
    }
  });

  app.post('/api/admin/faq', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const { question, answer, category } = req.body;
      const entry = await storage.createFaqEntry({ question, answer, category });
      res.json(entry);
    } catch (error) {
      console.error("Error creating FAQ:", error);
      res.status(500).json({ message: "Failed to create FAQ" });
    }
  });

  app.patch('/api/admin/faq/:id', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const entry = await storage.updateFaqEntry(req.params.id, req.body);
      res.json(entry);
    } catch (error) {
      console.error("Error updating FAQ:", error);
      res.status(500).json({ message: "Failed to update FAQ" });
    }
  });

  app.post('/api/admin/analytics/generate-demand-heatmap', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const allRides = await storage.getAllCompletedRides();
      const completedRides = allRides.filter(r => r.pickupLocation);
      let processed = 0;
      for (const ride of completedRides) {
        const pickup = ride.pickupLocation as any;
        if (!pickup?.lat || !pickup?.lng) continue;
        const gridLat = (Math.round(pickup.lat * 100) / 100).toFixed(6);
        const gridLng = (Math.round(pickup.lng * 100) / 100).toFixed(6);
        const d = new Date(ride.createdAt || new Date());
        await storage.upsertDemandHeatmap({
          gridLat, gridLng,
          hourOfDay: d.getHours(),
          dayOfWeek: d.getDay(),
          rideCount: 1,
          avgFare: ride.actualFare?.toString(),
        });
        processed++;
      }
      res.json({ processed, message: `Generated heatmap from ${processed} rides` });
    } catch (error) {
      console.error("Error generating heatmap:", error);
      res.status(500).json({ message: "Failed to generate heatmap" });
    }
  });

  app.post('/api/admin/analytics/refresh-scorecards', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const allDrivers = await storage.getAllDriverProfiles();
      const scorecards = [];
      for (const driver of allDrivers) {
        const scorecard = await storage.upsertDriverScorecard(driver.userId);
        scorecards.push(scorecard);
      }
      res.json({ count: scorecards.length, scorecards });
    } catch (error) {
      console.error("Error refreshing scorecards:", error);
      res.status(500).json({ message: "Failed to refresh scorecards" });
    }
  });

  app.post('/api/admin/analytics/detect-safety-patterns', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const alerts: any[] = [];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const allDriverProfiles = await storage.getAllDriverProfiles();
      for (const driver of allDriverProfiles) {
        const scorecard = await storage.getDriverScorecard(driver.userId);
        if (scorecard) {
          if (parseFloat(scorecard.completionRate?.toString() || '100') < 50 && (scorecard.totalRidesCompleted || 0) + (scorecard.totalRidesCancelled || 0) >= 5) {
            const alert = await storage.createSafetyAlert({
              alertType: 'low_completion_rate',
              severity: 'warning',
              targetUserId: driver.userId,
              title: `Low completion rate: ${scorecard.completionRate}%`,
              description: `Driver has completed only ${scorecard.totalRidesCompleted} of ${(scorecard.totalRidesCompleted || 0) + (scorecard.totalRidesCancelled || 0)} rides`,
              data: { completionRate: scorecard.completionRate, totalRides: (scorecard.totalRidesCompleted || 0) + (scorecard.totalRidesCancelled || 0) },
            });
            alerts.push(alert);
          }
          if ((scorecard.disputeCount || 0) >= 3) {
            const alert = await storage.createSafetyAlert({
              alertType: 'high_dispute_count',
              severity: 'critical',
              targetUserId: driver.userId,
              title: `High dispute count: ${scorecard.disputeCount} disputes`,
              description: `Driver has ${scorecard.disputeCount} reported disputes`,
              data: { disputeCount: scorecard.disputeCount },
            });
            alerts.push(alert);
          }
          if ((scorecard.sosCount || 0) >= 2) {
            const alert = await storage.createSafetyAlert({
              alertType: 'multiple_sos',
              severity: 'critical',
              targetUserId: driver.userId,
              title: `Multiple SOS incidents: ${scorecard.sosCount}`,
              description: `Driver involved in ${scorecard.sosCount} SOS/emergency incidents`,
              data: { sosCount: scorecard.sosCount },
            });
            alerts.push(alert);
          }
          if (parseFloat(scorecard.avgRating?.toString() || '5') < 3.0 && (scorecard.totalRidesCompleted || 0) >= 5) {
            const alert = await storage.createSafetyAlert({
              alertType: 'low_rating',
              severity: 'warning',
              targetUserId: driver.userId,
              title: `Low driver rating: ${scorecard.avgRating}`,
              description: `Driver average rating is below 3.0 with ${scorecard.totalRidesCompleted} completed rides`,
              data: { avgRating: scorecard.avgRating, totalRides: scorecard.totalRidesCompleted },
            });
            alerts.push(alert);
          }
        }
      }
      res.json({ alertsGenerated: alerts.length, alerts });
    } catch (error) {
      console.error("Error detecting safety patterns:", error);
      res.status(500).json({ message: "Failed to detect safety patterns" });
    }
  });

  app.post('/api/admin/analytics/generate-faq', isAdminOrSessionAuth, async (req: any, res) => {
    try {
      const recentMessages = await storage.getEventsByType('ai_chat_message', 200);
      const allConvos = await storage.getPlatformInsights(0);
      
      const faqPrompt = `Based on a ride-share platform's AI assistant conversations, generate 5-8 frequently asked questions with clear, helpful answers. Focus on common user questions about rides, payments, safety, and the platform. Format as JSON array: [{"question": "...", "answer": "...", "category": "rides|payments|safety|platform|drivers"}]`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [{ role: "system", content: faqPrompt }],
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || '{"faqs":[]}';
      const parsed = JSON.parse(content);
      const faqs = parsed.faqs || parsed;

      const created = [];
      for (const faq of (Array.isArray(faqs) ? faqs : [])) {
        if (faq.question && faq.answer && faq.category) {
          const entry = await storage.createFaqEntry({ question: faq.question, answer: faq.answer, category: faq.category });
          created.push(entry);
        }
      }
      res.json({ generated: created.length, faqs: created });
    } catch (error) {
      console.error("Error generating FAQs:", error);
      res.status(500).json({ message: "Failed to generate FAQs" });
    }
  });

  const httpServer = createServer(app);

  // WebSocket server for real-time communication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  const activeConnections = new Map<string, WebSocket>();
  
  wss.on('connection', (ws, req) => {
    console.log('WebSocket connection established');
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'join':
            // User joins with their ID for targeted messaging
            activeConnections.set(message.userId, ws);
            break;
            
          case 'location_update':
            // Driver location update - only send to riders in active rides with this driver
            // For now, we'll store the location but not broadcast globally for privacy
            // In production, implement targeted delivery to assigned riders only
            // TODO: Send location only to rider(s) currently on a ride with this driver
            break;
            
          case 'ride_status':
            // Ride status updates
            if (message.targetUserId && activeConnections.has(message.targetUserId)) {
              const targetWs = activeConnections.get(message.targetUserId);
              if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                  type: 'ride_status_update',
                  rideId: message.rideId,
                  status: message.status,
                  message: message.message
                }));
              }
            }
            break;
            
          case 'emergency':
            // Emergency alert - notify all relevant parties
            broadcast({
              type: 'emergency_alert',
              userId: message.userId,
              location: message.location,
              incident: message.incident
            });
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    ws.on('close', () => {
      // Remove from active connections
      for (const [userId, connection] of Array.from(activeConnections.entries())) {
        if (connection === ws) {
          activeConnections.delete(userId);
          break;
        }
      }
    });
  });
  
  function broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    activeConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  return httpServer;
}
