import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

/** Wire native shell affordances when running inside Capacitor (App Store / Play builds). */
export async function initCapacitorShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#339AF0" });
  } catch {
    // Status bar APIs are not available on all platforms.
  }

  App.addListener("appUrlOpen", ({ url }) => {
    try {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (path && path !== "/" && window.location.pathname !== parsed.pathname) {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    } catch {
      // Ignore malformed deep links.
    }
  });

  try {
    await SplashScreen.hide();
  } catch {
    // Splash may already be hidden.
  }
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
