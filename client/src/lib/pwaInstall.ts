/** PWA install detection + QR install gate (session flag). */

export const INSTALL_GATE_SESSION_KEY = "pg-install-gate-required";

export function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isAndroidDevice(): boolean {
  return /android/i.test(navigator.userAgent);
}

export function isMobileDevice(): boolean {
  return isIosDevice() || isAndroidDevice();
}

export function isStandalonePwa(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** True when Capacitor native shell is running the app (future store builds). */
export function isNativeShell(): boolean {
  try {
    // @capacitor/core is optional at runtime in pure web
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function isAppInstalledContext(): boolean {
  return isStandalonePwa() || isNativeShell();
}

export function captureInstallGateFromUrl(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  const shouldGate =
    params.has("qr") ||
    params.get("from") === "qr" ||
    params.get("install") === "1" ||
    params.get("install") === "required";
  if (shouldGate) {
    sessionStorage.setItem(INSTALL_GATE_SESSION_KEY, "1");
    return true;
  }
  return sessionStorage.getItem(INSTALL_GATE_SESSION_KEY) === "1";
}

export function isInstallGateRequired(): boolean {
  return sessionStorage.getItem(INSTALL_GATE_SESSION_KEY) === "1";
}

export function clearInstallGateRequirement(): void {
  sessionStorage.removeItem(INSTALL_GATE_SESSION_KEY);
}

export function isPublicInstallExemptPath(pathname: string = window.location.pathname): boolean {
  return (
    pathname.startsWith("/emergency/") ||
    pathname.startsWith("/guardian/") ||
    pathname === "/terms" ||
    pathname === "/privacy"
  );
}

export function shouldShowInstallGate(pathname: string = window.location.pathname): boolean {
  if (isPublicInstallExemptPath(pathname)) return false;
  if (!isInstallGateRequired()) return false;
  if (isAppInstalledContext()) {
    clearInstallGateRequirement();
    return false;
  }
  return true;
}
