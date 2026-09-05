import { Session, check, section, FIXTURES } from "./harness.mjs";

/** Admin-to-rider channel: authorization, targeting, exclusions, audit record. */
export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const count = async (id) => (await db.query("SELECT count(*)::int AS n FROM in_app_notifications WHERE user_id=$1 AND type LIKE 'announcement%'", [id])).rows[0].n;

  section("Authorization + validation");
  check("a rider cannot send announcements", [401, 403].includes((await rider.req("POST", "/api/admin/announcements", { title: "x", body: "y", audience: "all" })).status));
  check("empty title refused", (await admin.req("POST", "/api/admin/announcements", { title: " ", body: "y", audience: "all" })).status === 400);
  check("specific with no targets refused", (await admin.req("POST", "/api/admin/announcements", { title: "x", body: "y", audience: "specific", targetUserIds: [] })).status === 400);

  section("Targeting");
  const before = await count(FIXTURES.rider.id), beforeDrv = await count(FIXTURES.driver.id);
  const one = await admin.req("POST", "/api/admin/announcements", { title: "Add a card", body: "Profile → Payment", audience: "specific", targetUserIds: [FIXTURES.rider.id] });
  check("targeted send reaches exactly one person", one.status === 200 && one.json?.recipientCount === 1 && (await count(FIXTURES.rider.id)) === before + 1 && (await count(FIXTURES.driver.id)) === beforeDrv);
  const counts = await admin.req("GET", "/api/admin/announcements/audience-counts");
  const bc = await admin.req("POST", "/api/admin/announcements", { title: "Snow", body: "Rides resume 6am", audience: "riders", urgent: true });
  check("riders-only broadcast reaches every rider and no driver", bc.status === 200 && bc.json?.recipientCount === counts.json?.riders && (await count(FIXTURES.driver.id)) === beforeDrv, `${bc.json?.recipientCount} vs ${counts.json?.riders}`);

  section("Suspended riders excluded");
  await db.query("UPDATE users SET is_suspended = true WHERE id=$1", [FIXTURES.rider.id]);
  const b2 = await count(FIXTURES.rider.id);
  await admin.req("POST", "/api/admin/announcements", { title: "Again", body: "x", audience: "riders" });
  check("suspended rider receives nothing", (await count(FIXTURES.rider.id)) === b2);
  await db.query("UPDATE users SET is_suspended = false WHERE id=$1", [FIXTURES.rider.id]);

  const hist = await admin.req("GET", "/api/admin/announcements");
  check("history records urgency and reach", Array.isArray(hist.json) && hist.json.some((a) => a.title === "Snow" && a.urgent === true && a.recipientCount > 0));
}
