/** Normalized WebSocket payload for live driver GPS on the rider map. */
export function buildDriverLocationMessage(opts: {
  rideId: string;
  driverId: string;
  lat: number;
  lng: number;
}) {
  const { rideId, driverId, lat, lng } = opts;
  return {
    type: "driver_location" as const,
    rideId,
    driverId,
    location: { lat, lng },
    // Legacy flat fields — keep until all clients updated
    lat,
    lng,
  };
}
