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
import {
  insertDriverProfileSchema,
  insertVehicleSchema,
  insertRideSchema,
  insertDisputeSchema,
  insertEmergencyIncidentSchema,
} from "@shared/schema";

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
    const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
      const rides = await storage.getPendingRidesForDriver(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching pending rides:", error);
      res.status(500).json({ message: "Failed to fetch pending rides" });
    }
  });

  app.post('/api/driver/rides/:rideId/accept', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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

  app.post('/api/driver/rides/:rideId/complete', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
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
          const totalAmount = actualFare + (tipAmount || 0);
          const priceDifference = actualFare - estimatedFare;
          
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
  app.post('/api/vehicles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
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

    const userId = req.user?.claims?.sub;

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

  app.post('/api/rides', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      
      console.log("Ride creation request body:", JSON.stringify(req.body, null, 2));
      
      // Convert numeric fare to string for decimal field
      const bodyData = { ...req.body };
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
      const rides = await storage.getActiveRides(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching active rides:", error);
      res.status(500).json({ message: "Failed to fetch active rides" });
    }
  });

  // Rating and Payment routes (must come before parameterized /api/rides/:rideId route)
  app.get('/api/rides/for-rating', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const rides = await storage.getRidesForRating(userId);
      res.json(rides);
    } catch (error) {
      console.error("Error fetching rides for rating:", error);
      res.status(500).json({ message: "Failed to fetch rides for rating" });
    }
  });

  app.get('/api/rides/awaiting-payment', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const userId = req.user?.claims?.sub;
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
      const { distance, duration, driverDiscount = 0 } = req.body;
      
      if (!distance || !duration) {
        return res.status(400).json({ message: "Distance and duration required" });
      }
      
      // PG County rates: $18/hour + $1.50/mile
      const timeRate = 18; // per hour
      const mileRate = 1.50; // per mile
      
      const timeCharge = (duration / 60) * timeRate; // duration in minutes to hours
      const distanceCharge = distance * mileRate;
      const subtotal = timeCharge + distanceCharge;
      const discount = subtotal * (driverDiscount / 100);
      const total = subtotal - discount;
      
      res.json({
        timeCharge: parseFloat(timeCharge.toFixed(2)),
        distanceCharge: parseFloat(distanceCharge.toFixed(2)),
        subtotal: parseFloat(subtotal.toFixed(2)),
        discount: parseFloat(discount.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        formula: `($${timeRate}/hour × ${(duration/60).toFixed(2)} hours) + ($${mileRate}/mile × ${distance} miles)`
      });
    } catch (error) {
      console.error("Error calculating fare:", error);
      res.status(500).json({ message: "Failed to calculate fare" });
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
