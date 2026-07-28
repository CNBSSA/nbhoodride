# Maryland TNC Regulatory & Financial Research (PG Ride)

> Research compiled 2026-07-27 for Festus. Mix of verified statutory facts and
> clearly-labeled estimates. **This is research, not legal advice** — the two
> highest-leverage next steps are a call to the Maryland PSC Transportation
> Division (410-767-8128) and a consult with a Maryland transportation attorney.

---

## 1. The regulatory framework

Maryland regulates rideshare ("transportation network services") under the
**Public Utilities Article, Title 10, Subtitle 4**, enforced by the **Maryland
Public Service Commission (PSC)** — unusual among states, and stricter than
most. Implementing regulations: **COMAR 20.95.01** (esp. .20–.24).

### The hurdles, in order

1. **Company permit (the big one).** A TNC may not operate in Maryland without
   a PSC-issued permit. PG Ride — matching paying riders with drivers through
   an app — is squarely a TNC under the definition. Operating without the
   permit risks cease-and-desist orders and fines. Application: PSC Form 28,
   Transportation Division (410-767-8128).

2. **Per-driver licensing.** Every driver needs a PSC-issued **Transportation
   Network Operator (TNO) license** — temporary (valid 1 year), then
   permanent — plus a national criminal history check run through a
   **PSC-approved** screening agency. The app already integrates Checkr and
   blocks driving on missing/expired documents; the legal step is getting the
   screening process and each driver PSC-approved.

3. **Vehicle permits & standards.** TNC operator vehicle permits under COMAR
   20.95.01.23–.24, Maryland state safety inspection, proof of insurance.

4. **Insurance (§10-405).** TNC-specific phased coverage — contingent coverage
   while the app is on and waiting; ~$1M coverage during an active trip.
   Requires a commercial TNC policy for the company, not just drivers'
   personal auto. Confirm exact figures with a TNC-specialist broker.

5. **Per-trip government fees.**
   - County assessment: up to **25¢/trip** (remitted quarterly to the
     Comptroller) — check whether Prince George's County imposes it.
   - Statewide **TNC impact fee (2024): 50¢/trip** (25¢ for EVs/plug-ins).

6. **PG Ride-specific items needing counsel review:**
   - **Virtual PG Card** stored-value wallet → possible Maryland
     money-transmission angle (often exempt as closed-loop; verify).
   - **Driver ownership/equity program** → a securities offering; cooperative
     structures have friendly paths but need a securities attorney before
     real shares change hands.
   - **Shuttles/circuits** (fixed routes, per-seat fares) may edge outside
     the TNC definition toward regular-route carrier rules — ask the PSC.

### What the app already handles well
Driver document uploads + expiry tracking with driving blocked on
missing/expired (shared/compliancePolicy.ts), Checkr background-check
integration, MD-only pickup enforcement (shared/serviceArea.ts), insurance
document tracking, ride audit logs.

---

## 2. The "Empower model" question — answered

**Question:** if PG Ride switched to Empower-style operation (drivers pay a
subscription, keep ~100%, set their own fares; company claims to be
"just software," not a TNC) — does that avoid the regulation?

**Answer: No. Maryland has already ruled on exactly this.** The Maryland PSC
issued a **cease-and-desist order against Empower**, the judge writing that it
"presents severe and ongoing risks to public safety" by facilitating rides
without regulatory oversight. TNC laws are written around the *activity*
(a digital network connecting riders with paid drivers), not the revenue
model — subscription vs. commission is irrelevant to the regulator.

Empower's track record betting on the "just software" theory:
- **$8.85M in unpaid fines** in DC; contempt orders with daily fines against
  the CEO personally
- Drivers' cars **impounded** in DC (the drivers absorbed the worst of it)
- Survival in DC currently hinges on a loophole where rides are technically
  *free* (Apr 2026 ruling)

**The two halves of the Empower model, separated:**
- ❌ **Its legal theory** ("we're software, not transportation") — rejected by
  regulators and courts in both DC and Maryland. Do not copy.
- ✅ **Its economics** (drivers keep ~100%, pay a subscription, set their own
  rates) — nothing in the TNC framework prohibits this. The PSC permit
  regulates safety/insurance/background checks/fees, not commission
  structure. The app already has driver rate cards.

**The winning play:** Empower's driver economics inside a proper PSC permit.
*"Drivers keep everything and own a piece — and we're fully licensed, so your
car never gets impounded for driving with us."* That turns compliance into a
recruiting weapon aimed at Empower's own drivers.

---

## 3. Financial implications (estimates clearly labeled)

### Known (statutory)
| Item | Amount |
|---|---|
| State TNC impact fee | **50¢/trip** (25¢ EV) |
| County assessment (if PG County imposes) | up to **25¢/trip** |
| Effect on the $7.65 minimum fare | **6.5–10% of fare** to government |

### Estimates (planning numbers, not quotes)
| Item | Estimate | Notes |
|---|---|---|
| PSC TNC permit + filings | ~$1k–$10k/yr | states range widely; exact MD number = one free call to PSC |
| Transportation attorney (application) | ~$5k–$25k one-time | |
| Compliance admin (quarterly remittances, renewals) | ~$1k–$3k/yr | bookkeeper time |
| TNO driver license | ~$50–$100/driver/yr | Uber covers this fee for its MD drivers as a perk — PG Ride could too |
| Background check (Checkr) | ~$30–$80/driver | already integrated |
| Vehicle permit + MD inspection | ~$100–$250/vehicle | usually driver-paid |

### Insurance — the number that decides feasibility
Commercial TNC policy covering ~$1M during-trip typically runs
**~$300–$700 per active vehicle per month** for small fleets:
- 10 active drivers, company carries everything: **~$40k–$80k/yr**
- Leaner structures (usage-based/per-mile TNC programs; drivers carry
  rideshare endorsements + thinner company contingent policy):
  **~$15k–$40k/yr** at launch scale

### Rough year-one total (lean launch, 10–20 active drivers)
- Everything **except** insurance: **~$10k–$20k**
- With insurance: **~$25k–$100k**, depending entirely on policy structure

**Bottom line: registration itself is not the wall — insurance is.**

---

## 4. Next steps (highest leverage first)

1. ☎️ **Call the PSC Transportation Division (410-767-8128)** — get the exact
   TNC permit fee schedule, TNO license fees, and application checklist. Free.
2. ☎️ **Get a quote from a TNC-specialist insurance broker** at the target
   driver count — converts the biggest estimate into a real number. Free.
3. ⚖️ **Maryland transportation attorney consult** for the Form 28
   application (and eventually: money-transmission review for the PG Card,
   securities counsel for the equity program, PSC guidance on circuits).
4. 💰 Build the **50–75¢/trip government fees into fare math** before scaling.

---

## Sources

- [Maryland PSC — Transportation Division](https://psc.maryland.gov/regulated-utilities/transportation/)
- [PSC TNO driver guide (PDF)](https://psc.maryland.gov/wp-content/uploads/2025/11/TNO-Brochure-for-website_07312018.pdf)
- [PSC Form 28 carrier/TNC application (PDF)](https://www.psc.state.md.us/transportation/wp-content/uploads/sites/6/Form-28-Carrier-Application-Packet-Revised-7-1-22.pdf)
- [PSC filing fees](https://psc.maryland.gov/online-services/filing-fees/)
- [COMAR 20.95.01.20 — TNC](https://regs.maryland.gov/us/md/exec/comar/20.95.01.20)
- [COMAR 20.95.01.21 — TNO licenses](https://regs.maryland.gov/us/md/exec/comar/20.95.01.21)
- [COMAR 20.95.01.23 — vehicle permits](https://regs.maryland.gov/us/md/exec/comar/20.95.01.23)
- [Comptroller tax alert — TNC impact fee](https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/legal-publications/alerts/Tax-Alert-2024-TNC-Impact-Fee.pdf)
- [HB 1215 (2024) fiscal note](https://mgaleg.maryland.gov/2024RS/fnotes/bil_0005/hb1215.pdf)
- [Uber — Maryland State TNO License](https://www.uber.com/us/en/blog/maryland-state-tno-license/)
- [Wyoming legislature — state-by-state TNC fee comparison (PDF)](https://wyoleg.gov/InterimCommittee/2021/08-2021051816-03TNCFees.pdf)
- [The Banner — Maryland PSC cease-and-desist against Empower](https://www.thebanner.com/community/transportation/empower-rideshare-maryland-operations-CM2WNYD22FB7BIWZNSGRLPTFCQ/)
- [The Banner — Empower defiant as Maryland regulates](https://www.thebanner.com/community/transportation/rideshare-empower-maryland-regulators-PI6JCDVHMJHYFM45OZLOZ6ZR3M/)
- [Reason — end of the road for Empower in DC](https://reason.com/2026/02/23/it-looks-like-the-end-of-the-road-for-rideshare-alternative-empower-in-d-c/)
- [Washington Post — Empower free-rides loophole ruling](https://www.washingtonpost.com/dc-md-va/2026/04/23/empower-free-rides-dc-judge-ruling/)
- [DC Court of Appeals — Yazam (Empower) v. DFHV](https://law.justia.com/cases/district-of-columbia/court-of-appeals/2025/24-aa-0582.html)
- [HopSkipDrive — Maryland TNO qualification](https://help.hopskipdrive.com/hc/en-us/articles/44647745618196-Maryland-Transportation-Network-Operator-Advanced-Qualification)
