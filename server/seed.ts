import { db } from "./db";
import { users, driverProfiles, vehicles } from "../shared/schema";
import { eq } from "drizzle-orm";

const DEMO_DRIVERS = [
  {
    user: {
      id: "demo-driver-001",
      email: "marcus.johnson@pgride.demo",
      firstName: "Marcus",
      lastName: "Johnson",
      phone: "301-555-0101",
      isDriver: true,
      isApproved: true,
      isSuspended: false,
      rating: "4.97",
    },
    profile: {
      id: "demo-dp-001",
      licenseNumber: "MD-DEMO-001",
      isOnline: true,
      isVerifiedNeighbor: true,
      isSuspended: false,
      approvalStatus: "approved",
      currentLocation: { lat: 38.9334, lng: -76.8499 },
    },
    vehicle: {
      make: "Toyota",
      model: "Camry",
      year: 2021,
      color: "Silver",
      licensePlate: "PG-DEMO-1",
    },
  },
  {
    user: {
      id: "demo-driver-002",
      email: "keisha.washington@pgride.demo",
      firstName: "Keisha",
      lastName: "Washington",
      phone: "301-555-0202",
      isDriver: true,
      isApproved: true,
      isSuspended: false,
      rating: "4.89",
    },
    profile: {
      id: "demo-dp-002",
      licenseNumber: "MD-DEMO-002",
      isOnline: true,
      isVerifiedNeighbor: true,
      isSuspended: false,
      approvalStatus: "approved",
      currentLocation: { lat: 38.8968, lng: -76.7498 },
    },
    vehicle: {
      make: "Honda",
      model: "Accord",
      year: 2020,
      color: "Black",
      licensePlate: "PG-DEMO-2",
    },
  },
  {
    user: {
      id: "demo-driver-003",
      email: "darnell.brooks@pgride.demo",
      firstName: "Darnell",
      lastName: "Brooks",
      phone: "301-555-0303",
      isDriver: true,
      isApproved: true,
      isSuspended: false,
      rating: "5.00",
    },
    profile: {
      id: "demo-dp-003",
      licenseNumber: "MD-DEMO-003",
      isOnline: false,
      isVerifiedNeighbor: false,
      isSuspended: false,
      approvalStatus: "approved",
      currentLocation: { lat: 38.9073, lng: -76.8640 },
    },
    vehicle: {
      make: "Ford",
      model: "Fusion",
      year: 2019,
      color: "Blue",
      licensePlate: "PG-DEMO-3",
    },
  },
];

export async function seedDemoDrivers() {
  try {
    // Check if demo drivers already exist
    const existing = await db.select().from(users).where(eq(users.id, "demo-driver-001"));
    if (existing.length > 0) return; // Already seeded

    console.log("[seed] Creating demo drivers for PG Ride...");

    for (const demo of DEMO_DRIVERS) {
      // Insert user
      await db.insert(users).values({
        id: demo.user.id,
        email: demo.user.email,
        firstName: demo.user.firstName,
        lastName: demo.user.lastName,
        phone: demo.user.phone,
        isDriver: demo.user.isDriver,
        isApproved: demo.user.isApproved,
        isSuspended: demo.user.isSuspended,
        rating: demo.user.rating,
      }).onConflictDoNothing();

      // Insert driver profile
      await db.insert(driverProfiles).values({
        id: demo.profile.id,
        userId: demo.user.id,
        licenseNumber: demo.profile.licenseNumber,
        isOnline: demo.profile.isOnline,
        isVerifiedNeighbor: demo.profile.isVerifiedNeighbor,
        isSuspended: demo.profile.isSuspended,
        approvalStatus: demo.profile.approvalStatus,
        currentLocation: demo.profile.currentLocation,
      }).onConflictDoNothing();

      // Insert vehicle
      await db.insert(vehicles).values({
        driverProfileId: demo.profile.id,
        make: demo.vehicle.make,
        model: demo.vehicle.model,
        year: demo.vehicle.year,
        color: demo.vehicle.color,
        licensePlate: demo.vehicle.licensePlate,
      }).onConflictDoNothing();
    }

    console.log("[seed] Demo drivers created successfully.");
  } catch (err) {
    console.error("[seed] Failed to seed demo drivers:", err);
  }
}
