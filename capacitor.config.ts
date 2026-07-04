import type { CapacitorConfig } from "@capacitor/cli";

// Production native shells load the deployed web app so sessions, CSRF, and
// WebSockets stay same-origin. Override with CAPACITOR_SERVER_URL or set
// CAPACITOR_USE_LOCAL=true to test against bundled assets + local API.
const productionUrl = (
  process.env.CAPACITOR_SERVER_URL ||
  process.env.PUBLIC_APP_URL ||
  "https://nbhoodride-production.up.railway.app"
).replace(/\/+$/, "");

const useLocal = process.env.CAPACITOR_USE_LOCAL === "true";

const config: CapacitorConfig = {
  appId: "com.pgride.app",
  appName: "PG Ride",
  webDir: "dist/public",
  server: useLocal
    ? {
        androidScheme: "https",
        iosScheme: "https",
      }
    : {
        url: productionUrl,
        cleartext: false,
        androidScheme: "https",
        iosScheme: "https",
      },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#339AF0",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
