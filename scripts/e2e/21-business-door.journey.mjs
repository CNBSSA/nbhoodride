/**
 * The business door: an owner invites an email with no account, the
 * invitee sets up their sign-in from the link and lands in the desk as a
 * member — no rider signup, no approval queue. Links are single use and
 * pinned to the email; an existing account is attached instead of created.
 */
import { Session, check, section, FIXTURES, PASSWORD, uniqueEmail } from "./harness.mjs";

export async function run({ base, db }) {
  const owner = new Session(base); await owner.login(FIXTURES.rider.email);
  const driver = new Session(base); await driver.login(FIXTURES.driver.email);
  const orgId = FIXTURES.org.id;
  const emails = [];
  const tokenOf = (link) => String(link ?? "").split("/org/join/")[1];
  try {
    section("Only someone who manages people can invite");
    const notOwner = await driver.req("POST", `/api/org/${orgId}/members`, { email: uniqueEmail("nope"), role: "requester" });
    check("a non-member is refused", notOwner.status === 403, `status=${notOwner.status}`);

    section("An email with no account is invited, not refused");
    const email = uniqueEmail("clerk"); emails.push(email);
    const inv = await owner.req("POST", `/api/org/${orgId}/members`, { email, role: "requester" });
    check("the owner gets an invitation with a link, not 'they need to sign up first'", inv.status === 202 && inv.json?.invited === true && typeof inv.json?.link === "string" && inv.json.link.includes("/org/join/"), JSON.stringify(inv.json?.message ?? inv.json?.link ?? inv.status));
    check("the desk is told whether the email went out, so it can send the link itself", typeof inv.json?.emailSent === "boolean", `emailSent=${inv.json?.emailSent}`);
    const listed = await owner.req("GET", `/api/org/${orgId}/invitations`);
    check("the open invitation is listed for the desk", listed.status === 200 && listed.json?.some((i) => i.email === email && i.state === "open"), JSON.stringify(listed.json));
    const { rows: [stored] } = await db.query("SELECT token_hash FROM organization_invitations WHERE organization_id=$1 AND email=$2", [orgId, email]);
    const token = tokenOf(inv.json.link);
    check("only the hash of the token is stored", !!stored && stored.token_hash !== token && stored.token_hash.length === 64, stored?.token_hash?.slice(0, 8));

    section("The invitee opens the link with no account at all");
    const guest = new Session(base); await guest.csrf();
    const desc = await guest.req("GET", `/api/org/invitations/${token}`);
    check("the join page knows who invited them and for what", desc.status === 200 && desc.json?.organizationName === FIXTURES.org.name && desc.json?.email === email && desc.json?.role === "requester" && desc.json?.state === "open" && desc.json?.hasAccount === false, JSON.stringify(desc.json));
    const bad = await guest.req("GET", "/api/org/invitations/not-a-token");
    check("a made-up link is not valid", bad.status === 404, `status=${bad.status}`);
    const weak = await guest.req("POST", `/api/org/invitations/${token}/accept`, { firstName: "Desk", lastName: "Clerk", phone: "3015550123", password: "weak", termsAccepted: true, privacyAccepted: true });
    check("a weak password is refused in words", weak.status === 400 && /Password must contain/.test(weak.json?.message ?? ""), JSON.stringify(weak.json));
    const noTerms = await guest.req("POST", `/api/org/invitations/${token}/accept`, { firstName: "Desk", lastName: "Clerk", phone: "3015550123", password: PASSWORD, termsAccepted: false, privacyAccepted: false });
    check("the terms must be accepted", noTerms.status === 400, JSON.stringify(noTerms.json));
    const ok = await guest.req("POST", `/api/org/invitations/${token}/accept`, { firstName: "Desk", lastName: "Clerk", phone: "(301) 555-0123", password: PASSWORD, termsAccepted: true, privacyAccepted: true });
    check("the account is created and the invitee is signed in", ok.status === 200 && ok.json?.organizationId === orgId && ok.json?.existing === false, JSON.stringify(ok.json));
    const me = await guest.req("GET", "/api/auth/user");
    check("the same session is now that person", me.status === 200 && me.json?.email === email && me.json?.firstName === "Desk", JSON.stringify(me.json?.email));
    const mine = await guest.req("GET", "/api/org/mine");
    check("and a requester for the organization", mine.status === 200 && mine.json?.some((m) => m.organization.id === orgId && m.role === "requester"), JSON.stringify(mine.json));
    const jobs = await guest.req("GET", `/api/org/${orgId}/jobs`);
    check("who can open the desk at once", jobs.status === 200, `status=${jobs.status}`);
    const { rows: [u] } = await db.query("SELECT is_approved, approved_by, phone FROM users WHERE email=$1", [email]);
    check("approved on acceptance, vouched for by the organization, phone normalised", u?.is_approved === true && u?.approved_by === `organization:${orgId}` && /3015550123/.test(u?.phone ?? ""), JSON.stringify(u));

    section("The link is single use, and the new sign-in works at the ordinary door");
    const again = await guest.req("POST", `/api/org/invitations/${token}/accept`, { firstName: "X", lastName: "Y", phone: "3015550123", password: PASSWORD, termsAccepted: true, privacyAccepted: true });
    check("a used link says so", again.status === 410 && /already been used/.test(again.json?.message ?? ""), JSON.stringify(again.json));
    const gone = await owner.req("GET", `/api/org/${orgId}/invitations`);
    check("it is no longer listed as open", gone.status === 200 && !gone.json?.some((i) => i.email === email), JSON.stringify(gone.json));
    const fresh = new Session(base);
    const login = await fresh.login(email, PASSWORD);
    check("they can sign in with their password — no 'pending approval'", login.status === 200, JSON.stringify(login.json?.message ?? login.status));

    section("An existing account is attached, never re-created");
    const existing = await owner.req("POST", `/api/org/${orgId}/members`, { email: FIXTURES.driver.email, role: "billing" });
    check("adding an email that has an account attaches it at once, as before", existing.status === 201 && existing.json?.userId === FIXTURES.driver.id && existing.json?.role === "billing", JSON.stringify(existing.json));
    await owner.req("DELETE", `/api/org/${orgId}/members/${FIXTURES.driver.id}`);

    section("Revoking an invitation kills its link");
    const email2 = uniqueEmail("clerk2"); emails.push(email2);
    const inv2 = await owner.req("POST", `/api/org/${orgId}/members`, { email: email2, role: "requester" });
    const token2 = tokenOf(inv2.json?.link);
    const revoked = await owner.req("DELETE", `/api/org/${orgId}/invitations/${inv2.json?.id}`);
    check("the owner can revoke it", revoked.status === 200 && revoked.json?.revoked === true, JSON.stringify(revoked.json));
    const dead = await guest.req("GET", `/api/org/invitations/${token2}`);
    check("and the link no longer opens anything", dead.status === 404, `status=${dead.status}`);

    section("Re-inviting the same email issues a fresh link and retires the old one");
    const email3 = uniqueEmail("clerk3"); emails.push(email3);
    const first = await owner.req("POST", `/api/org/${orgId}/members`, { email: email3, role: "requester" });
    const second = await owner.req("POST", `/api/org/${orgId}/members`, { email: email3, role: "owner" });
    const oldLink = await guest.req("GET", `/api/org/invitations/${tokenOf(first.json?.link)}`);
    const newLink = await guest.req("GET", `/api/org/invitations/${tokenOf(second.json?.link)}`);
    check("the old link is dead and the new one carries the new role", oldLink.status === 404 && newLink.status === 200 && newLink.json?.role === "owner", `old=${oldLink.status} new=${newLink.status} role=${newLink.json?.role}`);

    section("An expired link is refused in words");
    await db.query("UPDATE organization_invitations SET expires_at = NOW() - interval '1 minute' WHERE organization_id=$1 AND email=$2", [orgId, email3]);
    const expired = await guest.req("GET", `/api/org/invitations/${tokenOf(second.json?.link)}`);
    check("the join page says it expired", expired.status === 200 && expired.json?.state === "expired" && /expired/.test(expired.json?.refusal ?? ""), JSON.stringify(expired.json?.refusal));
    const acceptExpired = await guest.req("POST", `/api/org/invitations/${tokenOf(second.json?.link)}/accept`, { firstName: "A", lastName: "B", phone: "3015550123", password: PASSWORD, termsAccepted: true, privacyAccepted: true });
    check("and accepting it is refused", acceptExpired.status === 410, `status=${acceptExpired.status}`);
  } finally {
    for (const e of emails) {
      const { rows } = await db.query("SELECT id FROM users WHERE email=$1", [e]).catch(() => ({ rows: [] }));
      for (const r of rows) {
        await db.query("DELETE FROM organization_members WHERE user_id=$1", [r.id]).catch(() => {});
        await db.query("UPDATE organization_invitations SET accepted_user_id=NULL WHERE accepted_user_id=$1", [r.id]).catch(() => {});
        await db.query("DELETE FROM users WHERE id=$1", [r.id]).catch(() => {});
      }
      await db.query("DELETE FROM organization_invitations WHERE email=$1", [e]).catch(() => {});
    }
  }
}
