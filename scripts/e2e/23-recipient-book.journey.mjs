/**
 * The recipient book: saved from a booking, one entry per phone, offered
 * back on the job row as "Send again", scoped to the organization, and
 * archived without touching history.
 */
import { Session, check, section, deleteRides, deleteOrgs, FIXTURES, PICKUP, DEST } from "./harness.mjs";

export async function run({ base, db }) {
  const admin = new Session(base); await admin.login(FIXTURES.admin.email);
  const rider = new Session(base); await rider.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const rideIds = [], orgIds = [];
  const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
  try {
    const shop = await admin.req("POST", "/api/admin/organizations", { name: "Books Expert LLC", category: "business", address: { lat: PICKUP.lat, lng: PICKUP.lng, address: PICKUP.address } });
    const orgId = shop.json.id; orgIds.push(orgId);
    await admin.req("POST", `/api/admin/organizations/${orgId}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const other = await admin.req("POST", "/api/admin/organizations", { name: "Some Other Shop", category: "business" });
    orgIds.push(other.json.id);

    section("A booking remembers its recipient");
    const first = await rider.req("POST", `/api/org/${orgId}/deliveries`, {
      parcelSize: "small", pickupContact: { name: "Counter" }, dropContact: { name: "Tunde Bakare", phone: "(301) 555-0177", note: "Ring twice" },
      readyAt: inMin(90), windowHours: 2, pickup: PICKUP, destination: DEST, handover: "unattended", rememberRecipient: true,
    });
    check("the delivery is booked and the desk is told the recipient was remembered", first.status === 201 && first.json?.remembered?.ok === true, JSON.stringify(first.json?.remembered ?? first.json?.message ?? first.status));
    rideIds.push(first.json.ride.id);
    const book = await rider.req("GET", `/api/org/${orgId}/recipients`);
    const saved = (book.json ?? []).find((r) => r.phone === "3015550177");
    check("the recipient is in the book with their address, handover and note", !!saved && saved.name === "Tunde Bakare" && saved.address?.address === DEST.address && saved.handover === "unattended" && saved.note === "Ring twice", JSON.stringify(book.json));

    section("The same phone is one entry, however it is typed; details refresh");
    const again = await rider.req("POST", `/api/org/${orgId}/recipients`, { name: "Tunde B.", phone: "+1 301 555 0177", address: { lat: DEST.lat, lng: DEST.lng, address: "Oxon Hill, MD" }, handover: "person" });
    check("saving them again updates the one entry", again.status === 201 && again.json?.id === saved?.id && again.json?.name === "Tunde B." && again.json?.address?.address === "Oxon Hill, MD", JSON.stringify(again.json));
    const bookNow = await rider.req("GET", `/api/org/${orgId}/recipients`);
    check("and the book still has one of them", (bookNow.json ?? []).filter((r) => r.phone === "3015550177").length === 1, `n=${(bookNow.json ?? []).length}`);
    const bad = await rider.req("POST", `/api/org/${orgId}/recipients`, { name: "", address: { lat: 1, lng: 1, address: "x" } });
    check("a recipient needs a name", bad.status === 400 && /needs a name/.test(bad.json?.message ?? ""), JSON.stringify(bad.json));
    const nullIsland = await rider.req("POST", `/api/org/${orgId}/recipients`, { name: "Nobody", address: { lat: null, lng: null, address: "Somewhere" } });
    check("and a real address, not a blank one that would be Null Island", nullIsland.status === 400, JSON.stringify(nullIsland.json));
    const phoneless = await rider.req("POST", `/api/org/${orgId}/recipients`, { name: "Tunde B.", address: { lat: DEST.lat, lng: DEST.lng, address: "Oxon Hill, MD" }, note: "Back gate" });
    check("saving them again without a phone keeps the phone the book already knows", phoneless.status === 201 && phoneless.json?.id === saved?.id && phoneless.json?.phone === "3015550177" && phoneless.json?.note === "Back gate", JSON.stringify(phoneless.json));
    const twinless = await rider.req("POST", `/api/org/${orgId}/recipients`, { name: "Ada Obi", address: { lat: DEST.lat, lng: DEST.lng, address: "Oxon Hill, MD" } });
    const twinPhone = await rider.req("POST", `/api/org/${orgId}/recipients`, { name: "Ada Obi", phone: "3015550199", address: { lat: DEST.lat, lng: DEST.lng, address: "Oxon Hill, MD" } });
    check("a phone added later folds into the phoneless entry instead of making a twin", twinless.status === 201 && twinPhone.status === 201 && twinPhone.json?.id === twinless.json?.id && twinPhone.json?.phone === "3015550199", JSON.stringify([twinless.json?.id, twinPhone.json?.id]));
    const unrememberable = await rider.req("POST", `/api/org/${orgId}/deliveries`, {
      parcelSize: "small", pickupContact: { name: "Counter" }, dropContact: { name: "Overseas Guest", phone: "+44 20 7946 0958" },
      readyAt: inMin(95), windowHours: 2, pickup: PICKUP, destination: DEST, rememberRecipient: true,
    });
    if (unrememberable.status === 201) rideIds.push(unrememberable.json.ride.id);
    check("a booking that cannot be remembered still books, and says why", unrememberable.status === 201 && unrememberable.json?.remembered?.ok === false && /10-digit/.test(unrememberable.json?.remembered?.reason ?? ""), JSON.stringify(unrememberable.json?.remembered ?? unrememberable.json?.message));

    section("The job row carries what was sent and to whom, and the past job is untouched by edits");
    const jobs = await rider.req("GET", `/api/org/${orgId}/jobs`);
    const row = (jobs.json ?? []).find((j) => j.rideId === first.json.ride.id);
    check("'Send again' has the parcel, the handover and the recipient as they were booked", row?.parcel?.parcelSize === "small" && row?.parcel?.handover === "unattended" && row?.parcel?.dropContact?.name === "Tunde Bakare" && row?.parcel?.dropContact?.note === "Ring twice" && row?.destination?.address === DEST.address, JSON.stringify(row?.parcel));

    section("The book is the organization's alone");
    const outsider = await driver.req("GET", `/api/org/${orgId}/recipients`);
    check("a non-member cannot read it", outsider.status === 403, `status=${outsider.status}`);
    await admin.req("POST", `/api/admin/organizations/${other.json.id}/members`, { email: FIXTURES.rider.email, role: "owner" });
    const otherBook = await rider.req("GET", `/api/org/${other.json.id}/recipients`);
    check("another organization's book does not show them", otherBook.status === 200 && !(otherBook.json ?? []).some((r) => r.phone === "3015550177"), JSON.stringify(otherBook.json));

    section("Removing a recipient hides them and keeps history");
    const removed = await rider.req("DELETE", `/api/org/${orgId}/recipients/${saved.id}`);
    check("removed", removed.status === 200 && removed.json?.removed === true, JSON.stringify(removed.json));
    const after = await rider.req("GET", `/api/org/${orgId}/recipients`);
    check("gone from the book", !(after.json ?? []).some((r) => r.id === saved.id));
    const jobsAfter = await rider.req("GET", `/api/org/${orgId}/jobs`);
    const rowAfter = (jobsAfter.json ?? []).find((j) => j.rideId === first.json.ride.id);
    check("the past job still names them", rowAfter?.parcel?.dropContact?.name === "Tunde Bakare", JSON.stringify(rowAfter?.parcel?.dropContact));
    const back = await rider.req("POST", `/api/org/${orgId}/recipients`, { name: "Tunde Bakare", phone: "3015550177", address: DEST });
    check("saving them again brings the same entry back", back.status === 201 && back.json?.id === saved.id, JSON.stringify(back.json?.id));
  } finally {
    await deleteRides(db, rideIds).catch(() => {});
    for (const id of orgIds) await db.query("DELETE FROM organization_recipients WHERE organization_id=$1", [id]).catch(() => {});
    await deleteOrgs(db, orgIds).catch(() => {});
  }
}
