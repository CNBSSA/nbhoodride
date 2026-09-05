import { check, section } from "./harness.mjs";
/** The self-update contract: the server tells clients which build is live. */
export async function run({ base }) {
  section("Build id");
  const r = await fetch(base + "/api/version");
  const j = await r.json();
  check("/api/version serves a build id", r.status === 200 && typeof j.id === "string" && j.id.length >= 4, JSON.stringify(j));
  check("not cached", /no-store/.test(r.headers.get("cache-control") || ""));
}
