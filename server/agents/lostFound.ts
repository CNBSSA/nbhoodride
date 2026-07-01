import {
  canTransitionLostFound,
  type LostFoundCategory,
  type LostFoundStatus,
} from "@shared/lostFoundPolicy";
import { deliverUserNotification } from "../notificationService";
import type { IStorage } from "../storage";

export interface LostFoundReportInput {
  rideId: string;
  riderId: string;
  itemDescription: string;
  itemCategory: LostFoundCategory;
  riderNote?: string;
}

/** Notify driver and log when a rider reports a lost item. */
export async function processLostFoundReport(
  storage: IStorage,
  input: LostFoundReportInput,
): Promise<{ reportId: string; status: string }> {
  const ride = await storage.getRide(input.rideId);
  if (!ride) throw new Error("Ride not found");
  if (ride.status !== "completed") {
    throw new Error("Lost items can only be reported on completed rides");
  }
  if (ride.riderId !== input.riderId) {
    throw new Error("Only the rider on this trip can report a lost item");
  }
  if (!ride.driverId) {
    throw new Error("This ride has no assigned driver");
  }

  const existing = await storage.getOpenLostFoundReportForRide(input.rideId, input.riderId);
  if (existing) {
    throw new Error("You already have an open lost-item report for this ride");
  }

  const report = await storage.createLostFoundReport({
    rideId: input.rideId,
    riderId: input.riderId,
    driverId: ride.driverId,
    itemDescription: input.itemDescription,
    itemCategory: input.itemCategory,
    riderNote: input.riderNote,
    status: "driver_notified",
  });

  await storage.createAgentAuditLog({
    agent: "support",
    action: "lost_found_reported",
    userId: input.riderId,
    rideId: input.rideId,
    reasoning: `Lost item reported: ${input.itemCategory}`,
    metadata: { reportId: report.id, itemCategory: input.itemCategory },
  });

  await deliverUserNotification(ride.driverId, {
    type: "lost_found",
    title: "Rider left an item",
    body: `Please check your vehicle: ${input.itemDescription.slice(0, 80)}`,
    data: { reportId: report.id, rideId: input.rideId },
    url: "/driver",
  });

  await deliverUserNotification(input.riderId, {
    type: "lost_found",
    title: "Lost item reported",
    body: "We notified your driver. You'll get updates here.",
    data: { reportId: report.id, rideId: input.rideId },
    url: "/rides",
  });

  return { reportId: report.id, status: report.status };
}

export async function updateLostFoundStatus(
  storage: IStorage,
  reportId: string,
  actorId: string,
  actorRole: "driver" | "rider" | "admin",
  newStatus: LostFoundStatus,
  note?: string,
): Promise<void> {
  const report = await storage.getLostFoundReportById(reportId);
  if (!report) throw new Error("Report not found");

  if (actorRole === "driver" && report.driverId !== actorId) {
    throw new Error("Not authorized");
  }
  if (actorRole === "rider" && report.riderId !== actorId) {
    throw new Error("Not authorized");
  }

  if (!canTransitionLostFound(report.status, newStatus, actorRole)) {
    throw new Error(`Cannot move from ${report.status} to ${newStatus}`);
  }

  const updates: {
    status: LostFoundStatus;
    driverNote?: string;
    riderNote?: string;
    adminNote?: string;
    resolvedBy?: string;
    resolvedAt?: Date;
  } = { status: newStatus };

  if (note) {
    if (actorRole === "driver") updates.driverNote = note;
    else if (actorRole === "rider") updates.riderNote = note;
    else updates.adminNote = note;
  }

  if (["returned", "closed_not_found", "closed_no_response"].includes(newStatus)) {
    updates.resolvedBy = actorId;
    updates.resolvedAt = new Date();
  }

  await storage.updateLostFoundReport(reportId, updates);

  const notifyUserId = actorRole === "driver" ? report.riderId : report.driverId;
  await deliverUserNotification(notifyUserId, {
    type: "lost_found_update",
    title: "Lost item update",
    body: `Status: ${newStatus.replace(/_/g, " ")}`,
    data: { reportId, status: newStatus },
    url: actorRole === "driver" ? "/rides" : "/driver",
  });

  await storage.createAgentAuditLog({
    agent: "support",
    action: "lost_found_status",
    userId: actorId,
    rideId: report.rideId,
    reasoning: `${actorRole} set status → ${newStatus}`,
    metadata: { reportId, newStatus },
  });
}
