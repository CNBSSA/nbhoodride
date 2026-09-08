import { Session, check, section, FIXTURES, PICKUP } from "./harness.mjs";

/**
 * SOS share links expire. A guardian's link keeps working while the
 * incident is live and for 24 hours after it is resolved, then goes dark —
 * before this, a resolved incident's link kept answering with the rider's
 * last location forever.
 */
export async function run({ base, db }) {
  const rider = new Session(base);
  check("rider logs in", (await rider.login(FIXTURES.rider.email)).status === 200);
  const admin = new Session(base);
  check("admin logs in", (await admin.login(FIXTURES.admin.email)).status === 200);
  const created = [];

  try {
    section("A live SOS link answers without a session");
    const start = await rider.req("POST", "/api/emergency/start", { incidentType: "sos", location: { lat: PICKUP.lat, lng: PICKUP.lng }, description: "e2e: link expiry" });
    const tokenOf = (r) => String(r.json?.shareUrl ?? "").split("/emergency/")[1] || r.json?.incident?.shareToken;
    const token = tokenOf(start);
    check("SOS started with a share link", start.status === 200 && typeof token === "string" && token.length >= 8, JSON.stringify(start.json?.message ?? start.status));
    const { rows: [row] } = await db.query("SELECT id FROM emergency_incidents WHERE share_token=$1", [token]);
    created.push(row.id);
    const live = await fetch(`${base}/api/emergency/incident/${token}`);
    check("guardian (no session) can read the live incident", live.status === 200 && (await live.json()).status === "active", `status=${live.status}`);

    section("Resolved: readable for the grace period, then gone");
    await db.query("UPDATE emergency_incidents SET status='resolved', resolved_at=NOW() - interval '1 hour', updated_at=NOW() WHERE id=$1", [row.id]);
    const grace = await fetch(`${base}/api/emergency/incident/${token}`);
    const graceBody = await grace.json();
    check("an hour after resolution the link still shows the outcome", grace.status === 200 && graceBody.status === "resolved", `status=${grace.status} ${graceBody.status}`);
    await db.query("UPDATE emergency_incidents SET resolved_at=NOW() - interval '25 hours' WHERE id=$1", [row.id]);
    const gone = await fetch(`${base}/api/emergency/incident/${token}`);
    const goneBody = await gone.json().catch(() => ({}));
    check("25 hours after resolution the link is refused with a reason", gone.status === 410 && /expired/i.test(goneBody.message ?? ""), `status=${gone.status} ${JSON.stringify(goneBody)}`);
    check("the expired link leaks no location", !("location" in goneBody) && !("userId" in goneBody));
    await db.query("UPDATE emergency_incidents SET status='resolved', resolved_at=NULL, updated_at=NOW() - interval '30 hours' WHERE id=$1", [row.id]);
    const noStamp = await fetch(`${base}/api/emergency/incident/${token}`);
    check("a resolved incident with no resolved_at still expires (falls back to updated_at)", noStamp.status === 410, `status=${noStamp.status}`);

    section("Resolving through the admin queue stamps the clock and tells the watchers");
    const second = await rider.req("POST", "/api/emergency/start", { incidentType: "sos", location: { lat: PICKUP.lat, lng: PICKUP.lng }, description: "e2e: admin resolve" });
    const token2 = tokenOf(second);
    const { rows: [row2] } = await db.query("SELECT id FROM emergency_incidents WHERE share_token=$1", [token2]);
    created.push(row2.id);
    const resolved = await admin.req("POST", `/api/admin/emergency-incidents/${row2.id}/resolve`);
    check("admin resolves the incident", resolved.status === 200 && resolved.json?.incident?.status === "resolved", JSON.stringify(resolved.json?.message ?? resolved.status));
    const { rows: [after] } = await db.query("SELECT resolved_at FROM emergency_incidents WHERE id=$1", [row2.id]);
    check("resolution is time-stamped, so the 24-hour clock starts", !!after.resolved_at);
    const stillReadable = await fetch(`${base}/api/emergency/incident/${token2}`);
    check("just-resolved link still readable (inside the grace period)", stillReadable.status === 200);
  } finally {
    for (const id of created) await db.query("DELETE FROM emergency_incidents WHERE id=$1", [id]).catch(() => {});
  }
}
