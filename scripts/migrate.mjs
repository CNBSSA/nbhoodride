import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

const SQL = `
-- ── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ride_status AS ENUM ('pending','accepted','driver_arriving','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending_payment','authorized','paid_card','paid_cash','cancelled_with_fee','cancelled','disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash','card');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ownership_status AS ENUM ('none','ad_hoc','lifetime');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE share_cert_status AS ENUM ('active','revoked','transferred');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE profit_decl_status AS ENUM ('draft','declared','distributed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Sessions (connect-pg-simple also creates this, but we ensure it exists) ─
CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire);

-- ── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE,
  password VARCHAR,
  first_name VARCHAR,
  last_name VARCHAR,
  profile_image_url VARCHAR,
  phone VARCHAR,
  is_driver BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  is_admin BOOLEAN DEFAULT false,
  is_super_admin BOOLEAN DEFAULT false,
  is_approved BOOLEAN DEFAULT false,
  approved_by VARCHAR,
  is_suspended BOOLEAN DEFAULT false,
  rating DECIMAL(3,2) DEFAULT 5.00,
  total_rides INTEGER DEFAULT 0,
  emergency_contact VARCHAR,
  stripe_customer_id VARCHAR,
  stripe_payment_method_id VARCHAR,
  virtual_card_balance DECIMAL(10,2) DEFAULT 0.00,
  promo_rides_remaining INTEGER DEFAULT 0,
  password_reset_token VARCHAR,
  password_reset_expiry TIMESTAMP,
  email_verification_token VARCHAR,
  email_verification_expiry TIMESTAMP,
  email_verified_at TIMESTAMP,
  registration_completed_at TIMESTAMP,
  terms_accepted_at TIMESTAMP,
  privacy_accepted_at TIMESTAMP,
  last_login_at TIMESTAMP,
  failed_login_attempts INTEGER DEFAULT 0,
  lockout_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);

-- Idempotent column additions for databases created before these columns
-- existed. Required because CREATE TABLE IF NOT EXISTS above is a no-op on
-- existing tables, and Drizzle's select() lists every schema column — so any
-- query against users (login, signup, /api/auth/user) fails with
-- "column does not exist" if these are missing.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expiry TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_completed_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
-- R-L5: per-account login throttling
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMP;

-- ── Driver profiles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  license_number VARCHAR,
  license_image_url VARCHAR,
  insurance_image_url VARCHAR,
  vehicle_photo_urls JSONB DEFAULT '[]'::jsonb,
  is_online BOOLEAN DEFAULT false,
  is_verified_neighbor BOOLEAN DEFAULT false,
  is_suspended BOOLEAN DEFAULT false,
  approval_status VARCHAR DEFAULT 'pending',
  discount_rate DECIMAL(3,2) DEFAULT 0.00,
  current_location JSONB,
  accepted_counties TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  daily_counties TEXT[],
  daily_session_start TIMESTAMP,
  checkr_candidate_id VARCHAR,
  checkr_report_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_user_id ON driver_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_is_online ON driver_profiles (is_online);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_approval_status ON driver_profiles (approval_status);

-- Idempotent column additions for driver_profiles. CREATE TABLE IF NOT EXISTS
-- is a no-op on existing tables, so any column added after the table was first
-- created in production has to also be backfilled with ALTER TABLE ADD COLUMN
-- IF NOT EXISTS or Drizzle's select() will fail with "column does not exist".
-- This block covers everything that's not part of the original create.
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_photo_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS accepted_counties TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS daily_counties TEXT[];
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS daily_session_start TIMESTAMP;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS checkr_candidate_id VARCHAR;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS checkr_report_id VARCHAR;

-- ── Vehicles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id VARCHAR NOT NULL REFERENCES driver_profiles(id),
  make VARCHAR NOT NULL,
  model VARCHAR NOT NULL,
  year INTEGER NOT NULL,
  color VARCHAR NOT NULL,
  license_plate VARCHAR NOT NULL,
  photos JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Rides ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rides (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id VARCHAR NOT NULL REFERENCES users(id),
  driver_id VARCHAR REFERENCES users(id),
  pickup_location JSONB NOT NULL,
  destination_location JSONB NOT NULL,
  pickup_instructions TEXT,
  status ride_status DEFAULT 'pending',
  payment_method payment_method DEFAULT 'cash',
  estimated_fare DECIMAL(8,2),
  actual_fare DECIMAL(8,2),
  distance DECIMAL(8,2),
  duration INTEGER,
  tip_amount DECIMAL(8,2) DEFAULT 0.00,
  payment_status payment_status DEFAULT 'pending_payment',
  stripe_payment_intent_id VARCHAR,
  virtual_amount_authorized DECIMAL(8,2) DEFAULT 0.00,
  stripe_authorized_amount DECIMAL(8,2) DEFAULT 0.00,
  refunded_amount DECIMAL(8,2),
  cancellation_fee DECIMAL(8,2),
  cancellation_reason TEXT,
  driver_traveled_distance DECIMAL(8,2),
  driver_traveled_time INTEGER,
  route_path JSONB,
  cash_received_at TIMESTAMP,
  paid_by VARCHAR REFERENCES users(id),
  rider_rating INTEGER,
  driver_rating INTEGER,
  rider_review TEXT,
  driver_review TEXT,
  scheduled_at TIMESTAMP,
  pickup_county VARCHAR,
  shared_ride_group_id VARCHAR,
  wants_shared_ride BOOLEAN DEFAULT false,
  shared_fare_discount DECIMAL(8,2) DEFAULT 0.00,
  group_id VARCHAR,
  ride_type VARCHAR DEFAULT 'solo',
  pickup_stops JSONB,
  original_fare DECIMAL(8,2),
  group_discount_amount DECIMAL(8,2) DEFAULT 0.00,
  promo_discount_applied DECIMAL(8,2) DEFAULT 0.00,
  accepted_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rides_rider_id ON rides (rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides (driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides (status);
CREATE INDEX IF NOT EXISTS idx_rides_created_at ON rides (created_at);

-- Idempotent column additions for the rides table — required so the
-- virtual+Stripe split payment flow has somewhere to record how much was
-- authorized from each source at ride accept time.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS virtual_amount_authorized DECIMAL(8,2) DEFAULT 0.00;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS stripe_authorized_amount DECIMAL(8,2) DEFAULT 0.00;

-- ── Shared ride groups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_ride_groups (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_at TIMESTAMP NOT NULL,
  destination_label VARCHAR NOT NULL,
  destination_lat DECIMAL(10,6) NOT NULL,
  destination_lng DECIMAL(10,6) NOT NULL,
  radius_miles DECIMAL(4,2) DEFAULT 2.00,
  max_riders INTEGER DEFAULT 4,
  rider_count INTEGER DEFAULT 0,
  status VARCHAR DEFAULT 'open',
  driver_id VARCHAR REFERENCES users(id),
  discount_pct INTEGER DEFAULT 30,
  created_by VARCHAR NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Ride groups ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ride_groups (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_code VARCHAR(12) UNIQUE,
  organizer_id VARCHAR NOT NULL REFERENCES users(id),
  group_type VARCHAR NOT NULL,
  shared_destination JSONB,
  max_slots INTEGER DEFAULT 3,
  filled_slots INTEGER DEFAULT 1,
  status VARCHAR DEFAULT 'open',
  driver_id VARCHAR REFERENCES users(id),
  discount_active BOOLEAN DEFAULT false,
  scheduled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Push subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Payout requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_requests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  amount DECIMAL(10,2) NOT NULL,
  payout_method VARCHAR NOT NULL,
  payout_details VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'pending',
  admin_note TEXT,
  processed_by VARCHAR REFERENCES users(id),
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Disputes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id VARCHAR NOT NULL REFERENCES rides(id),
  reporter_id VARCHAR NOT NULL REFERENCES users(id),
  issue_type VARCHAR NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR DEFAULT 'pending',
  resolution TEXT,
  resolved_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Emergency incidents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_incidents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  ride_id VARCHAR REFERENCES rides(id),
  incident_type VARCHAR NOT NULL,
  location JSONB,
  description TEXT,
  status VARCHAR DEFAULT 'active',
  share_token VARCHAR UNIQUE,
  emergency_contact_alerted BOOLEAN DEFAULT false,
  last_location_update TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Driver weekly hours ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_weekly_hours (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  week_start DATE NOT NULL,
  total_minutes INTEGER DEFAULT 0,
  ride_count INTEGER DEFAULT 0,
  qualifies_week BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Driver ownership ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_ownership (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id VARCHAR NOT NULL UNIQUE REFERENCES users(id),
  status ownership_status DEFAULT 'none',
  total_qualifying_weeks INTEGER DEFAULT 0,
  total_lifetime_minutes INTEGER DEFAULT 0,
  year1_minutes INTEGER DEFAULT 0,
  year2_minutes INTEGER DEFAULT 0,
  year3_minutes INTEGER DEFAULT 0,
  year4_minutes INTEGER DEFAULT 0,
  year5_minutes INTEGER DEFAULT 0,
  tracking_start_date TIMESTAMP,
  ad_hoc_qualification_date TIMESTAMP,
  lifetime_qualification_date TIMESTAMP,
  grace_deadline TIMESTAMP,
  rating_at_qualification DECIMAL(3,2),
  background_check_status VARCHAR DEFAULT 'pending',
  background_check_date TIMESTAMP,
  has_adverse_record BOOLEAN DEFAULT false,
  violation_notes TEXT,
  removed_from_driving BOOLEAN DEFAULT false,
  removal_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Share certificates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS share_certificates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id VARCHAR NOT NULL REFERENCES users(id),
  ownership_id VARCHAR NOT NULL REFERENCES driver_ownership(id),
  certificate_number VARCHAR NOT NULL UNIQUE,
  share_percentage DECIMAL(8,4),
  status share_cert_status DEFAULT 'active',
  issued_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP,
  revoke_reason TEXT,
  transferred_to VARCHAR REFERENCES users(id),
  transferred_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Ownership rebalance log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ownership_rebalance_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR NOT NULL,
  triggered_by VARCHAR REFERENCES users(id),
  affected_driver_id VARCHAR REFERENCES users(id),
  previous_snapshot JSONB,
  new_snapshot JSONB,
  total_active_owners INTEGER DEFAULT 0,
  driver_pool_percentage DECIMAL(5,2) DEFAULT 49.00,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Profit declarations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profit_declarations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year INTEGER NOT NULL,
  total_revenue DECIMAL(12,2),
  total_expenses DECIMAL(12,2),
  net_profit DECIMAL(12,2),
  distributable_profit DECIMAL(12,2),
  status profit_decl_status DEFAULT 'draft',
  declared_by VARCHAR REFERENCES users(id),
  declared_at TIMESTAMP,
  distributed_at TIMESTAMP,
  board_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Profit distributions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profit_distributions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id VARCHAR NOT NULL REFERENCES profit_declarations(id),
  owner_id VARCHAR NOT NULL REFERENCES users(id),
  share_percentage DECIMAL(8,4),
  ownership_type ownership_status,
  amount DECIMAL(12,2),
  status VARCHAR DEFAULT 'pending',
  paid_at TIMESTAMP,
  payment_method VARCHAR,
  payment_reference VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

-- AH-062: enforce one distribution row per (declaration, owner). With this
-- in place a re-run of distributeProfits() after a partial crash can't
-- silently insert duplicate payouts. Wrapped in pg_constraint check so the
-- migration is safe to re-run.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profit_distributions_declaration_owner_unique'
      AND conrelid = 'profit_distributions'::regclass
  ) THEN
    ALTER TABLE profit_distributions
      ADD CONSTRAINT profit_distributions_declaration_owner_unique
      UNIQUE (declaration_id, owner_id);
  END IF;
END $$;

-- ── Admin activity log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id VARCHAR NOT NULL REFERENCES users(id),
  action VARCHAR NOT NULL,
  target_type VARCHAR,
  target_id VARCHAR,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Wallet transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  amount DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  reason VARCHAR(100) NOT NULL,
  ride_id VARCHAR,
  dispute_id VARCHAR,
  performed_by VARCHAR,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user_created ON wallet_transactions (user_id, created_at);

-- AH-061: enforce wallet_transactions immutability at the DB level so the
-- ledger can be trusted as an audit source for disputes and equity. The
-- application code already treats it as append-only, but a stray admin
-- query or bug could rewrite history. Block UPDATE and DELETE with a
-- trigger that raises an exception — the only acceptable correction is a
-- compensating entry (a new row with the opposite sign).
CREATE OR REPLACE FUNCTION prevent_wallet_transaction_modification()
RETURNS TRIGGER AS $body$
BEGIN
  RAISE EXCEPTION 'wallet_transactions is append-only — % is not allowed (write a compensating entry instead)', TG_OP;
END;
$body$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'wallet_transactions_no_update'
  ) THEN
    CREATE TRIGGER wallet_transactions_no_update
      BEFORE UPDATE ON wallet_transactions
      FOR EACH ROW EXECUTE FUNCTION prevent_wallet_transaction_modification();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'wallet_transactions_no_delete'
  ) THEN
    CREATE TRIGGER wallet_transactions_no_delete
      BEFORE DELETE ON wallet_transactions
      FOR EACH ROW EXECUTE FUNCTION prevent_wallet_transaction_modification();
  END IF;
END $$;

-- ── Processed webhook events (AH-065 idempotency log) ──────────────────────
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR NOT NULL,
  event_id VARCHAR NOT NULL,
  event_type VARCHAR,
  processed_at TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT processed_webhook_events_unique UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_webhook_provider_event
  ON processed_webhook_events (provider, event_id);

-- ── Conversations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Chat messages ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Driver rate cards ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_rate_cards (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id VARCHAR NOT NULL UNIQUE REFERENCES users(id),
  minimum_fare DECIMAL(8,2) DEFAULT 7.65,
  base_fare DECIMAL(8,2) DEFAULT 4.00,
  per_minute_rate DECIMAL(8,4) DEFAULT 0.2900,
  per_mile_rate DECIMAL(8,4) DEFAULT 0.9000,
  surge_adjustment DECIMAL(8,2) DEFAULT 0.00,
  use_suggested BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Event tracking ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_tracking (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id),
  event_type VARCHAR NOT NULL,
  event_category VARCHAR NOT NULL,
  event_data JSONB,
  session_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_type ON event_tracking (event_type);
CREATE INDEX IF NOT EXISTS idx_event_category ON event_tracking (event_category);
CREATE INDEX IF NOT EXISTS idx_event_created ON event_tracking (created_at);

-- ── AI feedback ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_feedback (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id VARCHAR NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  conversation_id VARCHAR NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id),
  rating VARCHAR NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Platform insights ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_insights (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type VARCHAR NOT NULL,
  category VARCHAR NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  data JSONB,
  severity VARCHAR DEFAULT 'info',
  is_read BOOLEAN DEFAULT false,
  is_actionable BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── FAQ entries ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faq_entries (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category VARCHAR NOT NULL,
  source_count INTEGER DEFAULT 1,
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── RAG knowledge chunks (pgvector extension for future HNSW; JSONB embedding today) ─
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type VARCHAR NOT NULL,
  source_id VARCHAR,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks (source_type, source_id);

-- ── In-app notification inbox ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  type VARCHAR NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_in_app_notif_user ON in_app_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_in_app_notif_created ON in_app_notifications (created_at);

-- ── Demand heatmap ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demand_heatmap (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_lat DECIMAL(10,6) NOT NULL,
  grid_lng DECIMAL(10,6) NOT NULL,
  hour_of_day INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,
  ride_count INTEGER DEFAULT 0,
  avg_fare DECIMAL(8,2),
  avg_wait_time INTEGER,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- ── Driver scorecard ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_scorecard (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id VARCHAR NOT NULL UNIQUE REFERENCES users(id),
  total_rides_completed INTEGER DEFAULT 0,
  total_rides_cancelled INTEGER DEFAULT 0,
  acceptance_rate DECIMAL(5,2) DEFAULT 0.00,
  completion_rate DECIMAL(5,2) DEFAULT 0.00,
  avg_rating DECIMAL(3,2) DEFAULT 5.00,
  avg_response_time INTEGER,
  total_earnings DECIMAL(12,2) DEFAULT 0.00,
  peak_hours_worked JSONB,
  best_zones JSONB,
  dispute_count INTEGER DEFAULT 0,
  sos_count INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- ── Safety alerts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS safety_alerts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR NOT NULL,
  severity VARCHAR NOT NULL,
  target_user_id VARCHAR REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  data JSONB,
  is_resolved BOOLEAN DEFAULT false,
  resolved_by VARCHAR REFERENCES users(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Agent audit log (explainable dispatch / agent actions) ───────────────────
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  agent VARCHAR NOT NULL,
  action VARCHAR NOT NULL,
  user_id VARCHAR REFERENCES users(id),
  ride_id VARCHAR REFERENCES rides(id),
  reasoning TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_ride ON agent_audit_log (ride_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_created ON agent_audit_log (created_at);

-- ── Phase B: Delegative UI ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_autonomy_settings (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id),
  autonomy_level INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mobility_intents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_type VARCHAR NOT NULL,
  utterance TEXT,
  payload JSONB,
  status VARCHAR DEFAULT 'parsed',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mobility_intents_user ON mobility_intents (user_id);
-- Idempotently upgrade the existing FK to ON DELETE CASCADE for any DB
-- that already created mobility_intents before this fix landed. Drop
-- (if exists) and re-add the constraint with the cascade behavior.
-- mobility_intents stores raw user input (addresses, names) so deleting
-- a user MUST remove their intents to honor privacy/right-to-delete.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'mobility_intents'
      AND c.contype = 'f'
      AND c.confdeltype <> 'c'
  ) THEN
    ALTER TABLE mobility_intents DROP CONSTRAINT IF EXISTS mobility_intents_user_id_fkey;
    ALTER TABLE mobility_intents
      ADD CONSTRAINT mobility_intents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ride_surface_cache (
  ride_id VARCHAR PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  spec JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ride_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  label VARCHAR NOT NULL,
  pickup JSONB,
  destination JSONB NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ride_templates_user ON ride_templates (user_id);

CREATE TABLE IF NOT EXISTS guardian_links (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_user_id VARCHAR NOT NULL REFERENCES users(id),
  guardian_name VARCHAR NOT NULL,
  share_token VARCHAR NOT NULL UNIQUE,
  active_ride_id VARCHAR REFERENCES rides(id),
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
-- Idempotent column additions for guardian_links: revoked_at supports the
-- DELETE /api/mobility/guardian-links/:id revocation endpoint so a rider
-- can kill a shared link immediately rather than waiting for the 24h TTL.
-- expires_at is enforced NOT NULL post-hoc (set a default for any orphan
-- rows that were created with a NULL before this migration ran).
ALTER TABLE guardian_links ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;
UPDATE guardian_links SET expires_at = COALESCE(expires_at, created_at + INTERVAL '1 day') WHERE expires_at IS NULL;
ALTER TABLE guardian_links ALTER COLUMN expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guardian_links_rider ON guardian_links (rider_user_id);

-- ── Phase C: Trust graph ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trust_edges (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id VARCHAR NOT NULL REFERENCES users(id),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  edge_type VARCHAR NOT NULL DEFAULT 'rode_together',
  ride_count INTEGER DEFAULT 0,
  last_ride_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_edges_pair ON trust_edges (rider_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_trust_edges_rider ON trust_edges (rider_id);

CREATE TABLE IF NOT EXISTS favorite_drivers (
  rider_id VARCHAR NOT NULL REFERENCES users(id),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_drivers_pair ON favorite_drivers (rider_id, driver_id);

CREATE TABLE IF NOT EXISTS rider_trust_preferences (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id),
  max_separation_degrees INTEGER NOT NULL DEFAULT 0,
  prefer_favorites BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_referrals (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id VARCHAR NOT NULL REFERENCES users(id),
  referred_id VARCHAR REFERENCES users(id),
  referral_code VARCHAR NOT NULL UNIQUE,
  chain_type VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'pending',
  credit_amount DECIMAL(8,2),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_anchors (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_type VARCHAR NOT NULL,
  name TEXT NOT NULL,
  location JSONB,
  metadata JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO community_anchors (anchor_type, name, location, metadata)
SELECT * FROM (VALUES
  ('church', 'First Baptist Church of Glenarden', '{"lat":38.9293,"lng":-76.8612,"address":"Glenarden, MD"}'::jsonb, '{"note":"Sunday surge-free zone"}'::jsonb),
  ('campus', 'University of Maryland College Park', '{"lat":38.9869,"lng":-76.9426,"address":"College Park, MD"}'::jsonb, '{"semester":"fall_spring"}'::jsonb),
  ('campus', 'Bowie State University', '{"lat":39.0181,"lng":-76.7615,"address":"Bowie, MD"}'::jsonb, '{}'::jsonb),
  ('metro', 'Greenbelt Metro Station', '{"lat":39.0110,"lng":-76.9113,"address":"Greenbelt, MD"}'::jsonb, '{"line":"Green"}'::jsonb),
  ('metro', 'New Carrollton Metro Station', '{"lat":38.9480,"lng":-76.8722,"address":"New Carrollton, MD"}'::jsonb, '{"line":"Orange/Silver"}'::jsonb),
  ('venue', 'FedExField', '{"lat":38.9076,"lng":-76.8645,"address":"Landover, MD"}'::jsonb, '{"events":true}'::jsonb),
  ('senior_center', 'Wayne K. Curry Sports & Learning Complex', '{"lat":38.9054,"lng":-76.8472,"address":"Landover, MD"}'::jsonb, '{"voice_first":true}'::jsonb)
) AS v(anchor_type, name, location, metadata)
WHERE NOT EXISTS (SELECT 1 FROM community_anchors LIMIT 1);

-- ── Phase D: Predictive co-op ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demand_forecasts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_lat DECIMAL(10,6) NOT NULL,
  grid_lng DECIMAL(10,6) NOT NULL,
  hour_of_day INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,
  forecast_date TIMESTAMP NOT NULL,
  predicted_rides INTEGER DEFAULT 0,
  confidence DECIMAL(4,2) DEFAULT 0.50,
  last_updated TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_forecasts_cell ON demand_forecasts (grid_lat, grid_lng, hour_of_day, day_of_week, forecast_date);

CREATE TABLE IF NOT EXISTS community_bonus_pool (
  id VARCHAR PRIMARY KEY DEFAULT 'default',
  balance DECIMAL(12,2) DEFAULT 0.00,
  total_allocated DECIMAL(12,2) DEFAULT 0.00,
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO community_bonus_pool (id, balance) VALUES ('default', 0.00)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bonus_allocations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  ride_id VARCHAR REFERENCES rides(id),
  amount DECIMAL(8,2) NOT NULL,
  reason TEXT,
  zone_label VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_ride_schedules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  template_id VARCHAR REFERENCES ride_templates(id),
  label VARCHAR NOT NULL,
  pickup JSONB,
  destination JSONB NOT NULL,
  recurrence VARCHAR NOT NULL DEFAULT 'weekly',
  day_of_week INTEGER NOT NULL,
  preferred_hour INTEGER NOT NULL DEFAULT 9,
  last_prompt_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_schedules_user ON recurring_ride_schedules (user_id);

-- ── Phase E: Autonomous operations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_action_proposals (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  agent VARCHAR NOT NULL,
  action VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  user_id VARCHAR REFERENCES users(id),
  ride_id VARCHAR REFERENCES rides(id),
  payload JSONB,
  reasoning TEXT,
  proposed_at TIMESTAMP DEFAULT NOW(),
  reviewed_by VARCHAR REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_status ON agent_action_proposals (status);

CREATE TABLE IF NOT EXISTS compliance_records (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  record_type VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'missing',
  expires_at TIMESTAMP,
  tax_compliance_path VARCHAR,
  metadata JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_driver ON compliance_records (driver_id);

CREATE TABLE IF NOT EXISTS sms_booking_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR NOT NULL UNIQUE,
  user_id VARCHAR REFERENCES users(id),
  state VARCHAR NOT NULL DEFAULT 'idle',
  context JSONB,
  active_ride_id VARCHAR REFERENCES rides(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_ride_preferences (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id),
  calm_ride_mode VARCHAR NOT NULL DEFAULT 'off',
  preferred_language VARCHAR NOT NULL DEFAULT 'en',
  minimize_notifications BOOLEAN DEFAULT false,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Phase F: Research lane ─────────────────────────────────────────────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_ev BOOLEAN DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type VARCHAR DEFAULT 'gas';

CREATE TABLE IF NOT EXISTS l4_readiness_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id VARCHAR NOT NULL REFERENCES rides(id),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  event_type VARCHAR NOT NULL,
  waypoint_quality DECIMAL(4,3),
  speed_mph DECIMAL(6,2),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_l4_readiness_ride ON l4_readiness_events (ride_id);

CREATE TABLE IF NOT EXISTS certificate_provenance (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id VARCHAR NOT NULL UNIQUE REFERENCES share_certificates(id),
  content_hash VARCHAR NOT NULL,
  algorithm VARCHAR NOT NULL DEFAULT 'sha256',
  payload_version VARCHAR DEFAULT 'v1',
  on_chain_tx_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transit_feed_cache (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  agency VARCHAR NOT NULL,
  external_id VARCHAR,
  alert_type VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  summary TEXT,
  severity VARCHAR DEFAULT 'info',
  raw_payload JSONB,
  expires_at TIMESTAMP,
  fetched_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transit_feed_agency ON transit_feed_cache (agency);
CREATE INDEX IF NOT EXISTS idx_transit_feed_expires ON transit_feed_cache (expires_at);

-- ── Lost & found workflow ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lost_found_reports (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id VARCHAR NOT NULL REFERENCES rides(id),
  rider_id VARCHAR NOT NULL REFERENCES users(id),
  driver_id VARCHAR NOT NULL REFERENCES users(id),
  item_description TEXT NOT NULL,
  item_category VARCHAR NOT NULL DEFAULT 'other',
  status VARCHAR NOT NULL DEFAULT 'reported',
  driver_note TEXT,
  rider_note TEXT,
  admin_note TEXT,
  resolved_by VARCHAR REFERENCES users(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lost_found_ride ON lost_found_reports (ride_id);
CREATE INDEX IF NOT EXISTS idx_lost_found_rider ON lost_found_reports (rider_id);
CREATE INDEX IF NOT EXISTS idx_lost_found_driver ON lost_found_reports (driver_id);
CREATE INDEX IF NOT EXISTS idx_lost_found_status ON lost_found_reports (status);

-- ── Ride for a friend (booker pays; passenger rides) ─────────────────────────
ALTER TABLE rides ADD COLUMN IF NOT EXISTS booked_for_friend BOOLEAN DEFAULT false;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS passenger_name VARCHAR;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS passenger_phone VARCHAR;

-- ── Idempotent constraints ────────────────────────────────────────────────────
-- Dedupe driver_profiles before adding the UNIQUE constraint. Without this,
-- the ALTER TABLE below throws "could not create unique index — Key (user_id)
-- is duplicated" if any user already has multiple rows from earlier double-
-- clicks of "Get Started" while strict validation was rejecting them. Railway
-- then aborts the preDeployCommand and the new code never reaches production.
-- Keeps the oldest row per user_id; cascades the cleanup to vehicles that
-- referenced any of the to-be-deleted profile rows.
DO $$
DECLARE
  duplicate_user_ids INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_user_ids
  FROM (SELECT user_id FROM driver_profiles GROUP BY user_id HAVING COUNT(*) > 1) t;

  IF duplicate_user_ids > 0 THEN
    RAISE NOTICE '[migrate] Deduping % user(s) with multiple driver_profiles rows', duplicate_user_ids;

    DELETE FROM vehicles WHERE driver_profile_id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id ORDER BY created_at ASC NULLS LAST, id ASC
        ) AS rn
        FROM driver_profiles
      ) t WHERE t.rn > 1
    );

    DELETE FROM driver_profiles WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id ORDER BY created_at ASC NULLS LAST, id ASC
        ) AS rn
        FROM driver_profiles
      ) t WHERE t.rn > 1
    );
  END IF;
END $$;

-- ── Backlog: Vehicle types, community routes, referral UI ─────────────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR DEFAULT 'standard';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS requested_vehicle_type VARCHAR;

CREATE TABLE IF NOT EXISTS community_routes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  route_category VARCHAR NOT NULL,
  destination_location JSONB NOT NULL,
  from_anchor_id VARCHAR REFERENCES community_anchors(id),
  to_anchor_id VARCHAR REFERENCES community_anchors(id),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO community_routes (name, description, route_category, destination_location, to_anchor_id, sort_order)
SELECT
  'Metro → UMD Campus',
  'First/last mile to College Park',
  'metro',
  a.location,
  a.id,
  10
FROM community_anchors a
WHERE a.name = 'University of Maryland College Park'
  AND NOT EXISTS (SELECT 1 FROM community_routes WHERE name = 'Metro → UMD Campus');

INSERT INTO community_routes (name, description, route_category, destination_location, to_anchor_id, sort_order)
SELECT
  'Metro → Bowie State',
  'Campus drop-off at Bowie State',
  'campus',
  a.location,
  a.id,
  20
FROM community_anchors a
WHERE a.name = 'Bowie State University'
  AND NOT EXISTS (SELECT 1 FROM community_routes WHERE name = 'Metro → Bowie State');

INSERT INTO community_routes (name, description, route_category, destination_location, to_anchor_id, sort_order)
SELECT
  'Greenbelt Metro',
  'Ride to Green Line station',
  'metro',
  a.location,
  a.id,
  30
FROM community_anchors a
WHERE a.name = 'Greenbelt Metro Station'
  AND NOT EXISTS (SELECT 1 FROM community_routes WHERE name = 'Greenbelt Metro');

INSERT INTO community_routes (name, description, route_category, destination_location, to_anchor_id, sort_order)
SELECT
  'New Carrollton Metro',
  'Orange/Silver line connection',
  'metro',
  a.location,
  a.id,
  40
FROM community_anchors a
WHERE a.name = 'New Carrollton Metro Station'
  AND NOT EXISTS (SELECT 1 FROM community_routes WHERE name = 'New Carrollton Metro');

INSERT INTO community_routes (name, description, route_category, destination_location, to_anchor_id, sort_order)
SELECT
  'Sunday → Glenarden Church',
  'Community anchor — surge-free Sundays',
  'church',
  a.location,
  a.id,
  50
FROM community_anchors a
WHERE a.name = 'First Baptist Church of Glenarden'
  AND NOT EXISTS (SELECT 1 FROM community_routes WHERE name = 'Sunday → Glenarden Church');

INSERT INTO community_routes (name, description, route_category, destination_location, to_anchor_id, sort_order)
SELECT
  'Event → FedExField',
  'Game day & events at Landover',
  'venue',
  a.location,
  a.id,
  60
FROM community_anchors a
WHERE a.name = 'FedExField'
  AND NOT EXISTS (SELECT 1 FROM community_routes WHERE name = 'Event → FedExField');

-- In-ride rider ↔ driver chat (quick + free-text)
CREATE TABLE IF NOT EXISTS ride_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id VARCHAR NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role VARCHAR NOT NULL,
  kind VARCHAR NOT NULL DEFAULT 'text',
  message_key VARCHAR,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ride_messages_ride_created_idx ON ride_messages (ride_id, created_at);

-- Ensure one driver profile per user — prevents duplicate rows from concurrent
-- "Get Started" clicks or retries.
--
-- Look up the constraint in pg_catalog instead of relying on EXCEPTION WHEN
-- duplicate_object: ALTER TABLE … ADD CONSTRAINT … UNIQUE first creates the
-- backing unique index, and that step raises sqlstate 42P07 (duplicate_table,
-- because indexes are relations) when the index already exists — not 42710
-- (duplicate_object). The previous handler caught only 42710, so re-runs of
-- this migration aborted with an unhandled 42P07. That's the bug that's
-- blocked every Railway deploy since May 3.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'driver_profiles_user_id_unique'
      AND conrelid = 'driver_profiles'::regclass
  ) THEN
    ALTER TABLE driver_profiles
      ADD CONSTRAINT driver_profiles_user_id_unique UNIQUE (user_id);
  END IF;
END $$;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('PGRide migration starting — creating all tables...');
    await client.query(SQL);
    console.log('Migration complete — all tables ready.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
