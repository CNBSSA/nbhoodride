import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installCsrfFetch } from "./lib/csrf";

// Patch window.fetch once so every state-changing same-origin request
// automatically carries the X-CSRF-Token header that pairs with the
// csrf_token cookie issued by the server.
installCsrfFetch();

createRoot(document.getElementById("root")!).render(<App />);
