/** E5 — Post active-ride status to service worker for PWA shortcuts / badge. */
export function updateRideWidget(data: {
  rideId?: string;
  status?: string;
  etaMinutes?: number;
  driverName?: string;
}) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage({ type: "RIDE_WIDGET_UPDATE", payload: data });
    })
    .catch(() => {});
}

export function clearRideWidget() {
  updateRideWidget({});
}
