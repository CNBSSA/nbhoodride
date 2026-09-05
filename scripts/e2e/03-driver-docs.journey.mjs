import { Session, check, section, FIXTURES } from "./harness.mjs";

/** Documents persist one at a time; a partial save never wipes the others. */
export async function run({ base }) {
  const driver = new Session(base); check("driver logs in", (await driver.login(FIXTURES.driver.email)).status === 200);
  section("Partial saves");
  await driver.req("PUT", "/api/driver/profile", { licenseImageUrl: "https://e2e/lic.jpg" });
  await driver.req("PUT", "/api/driver/profile", { vehiclePhotoUrls: ["https://e2e/front.jpg"] });
  const me = await driver.req("GET", "/api/driver/profile/me");
  check("license survives a later photo-only save", me.json?.licenseImageUrl === "https://e2e/lic.jpg", JSON.stringify({ lic: me.json?.licenseImageUrl }));
  check("photo saved", (me.json?.vehiclePhotoUrls ?? []).length === 1);
  const ins = await driver.req("PUT", "/api/driver/profile", { insuranceImageUrl: "https://e2e/ins.jpg" });
  check("insurance saved alone", ins.status === 200);
  const all = await driver.req("GET", "/api/driver/profile/me");
  check("all three on file after three separate saves", all.json?.licenseImageUrl && all.json?.insuranceImageUrl && all.json?.vehiclePhotoUrls?.length === 1);
  section("Going online requires approval (fixture is approved)");
  check("approved driver can go online", (await driver.req("POST", "/api/driver/toggle-status", { isOnline: true })).status === 200);
}
