# Stripe setup — ~10 minutes (you have an account)

Code is already wired. Paste three values in Railway and add one webhook — no code changes needed.

**What unlocks:** Virtual PG Card top-up, card on file for rides, ride payment authorization.

---

## Step 1 — Get your keys (Stripe Dashboard)

1. Open [dashboard.stripe.com](https://dashboard.stripe.com)
2. **Developers → API keys**
3. Copy:
   - **Publishable key** → `pk_test_...` (start in test mode)
   - **Secret key** → `sk_test_...`

> Use **test mode** first (toggle in dashboard). Switch to live keys only when ready for real money.

---

## Step 2 — Railway variables

Railway → your PG Ride service → **Variables** → add:

| Variable | Value |
|----------|--------|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `VITE_STRIPE_PUBLIC_KEY` | `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | *(step 3 — add after webhook)* |

**Important:** `VITE_*` vars are baked in at **build** time. After adding them, trigger a **redeploy** (`railway up` or push to main).

---

## Step 3 — Webhook endpoint

1. Stripe → **Developers → Webhooks → Add endpoint**
2. **URL:** `https://peoplegoverned.com/api/webhooks/stripe`  
   (or `https://nbhoodride-production.up.railway.app/api/webhooks/stripe` until DNS is live)
3. **Events to listen for** (minimum):
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
4. Copy the **Signing secret** (`whsec_...`) → Railway `STRIPE_WEBHOOK_SECRET`
5. Redeploy again

---

## Step 4 — Smoke test (test mode)

Use Stripe test card: `4242 4242 4242 4242` · any future expiry · any CVC.

1. Log in as approved rider
2. **Profile → PG Virtual Card → Add funds** ($10 test top-up)
3. **Profile or /card-setup** → save test card
4. Book a short ride → driver accepts → complete → receipt

**Verify readiness:**

```bash
curl -s https://your-url/health/ready | jq '.checks[] | select(.id=="0.5-stripe")'
# status should be "pass"
```

---

## Step 5 — Go live

When ready for real payments:

1. Stripe → complete business verification
2. Toggle to **Live mode** keys
3. Replace all three Railway vars with `pk_live_...`, `sk_live_...`, live `whsec_...`
4. Add **live** webhook endpoint (same URL, live mode)
5. Redeploy

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Top-up button errors immediately | `STRIPE_SECRET_KEY` missing or redeploy needed |
| Card form blank / won't load | `VITE_STRIPE_PUBLIC_KEY` missing — redeploy after setting |
| Payment succeeds but ride stuck | `STRIPE_WEBHOOK_SECRET` wrong or webhook URL unreachable |
| 503 on top-up | Stripe keys not set in Railway |

---

## Code paths (already built)

| Feature | API |
|---------|-----|
| Top-up | `POST /api/virtual-card/topup/create-intent` → confirm |
| Card on file | `POST /api/payment/setup-card` |
| Webhook | `POST /api/webhooks/stripe` |
| Config probe | `GET /api/payment/config` |

*You only paste keys — the app handles the rest.*
