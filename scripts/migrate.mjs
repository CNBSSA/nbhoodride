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
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

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

-- ── Driver profiles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  license_number VARCHAR,
  license_image_url VARCHAR,
  insurance_image_url VARCHAR,
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

-- ── Idempotent constraints ────────────────────────────────────────────────────
-- Ensure one driver profile per user — prevents duplicate rows from concurrent
-- "Get Started" clicks or retries.
DO $$ BEGIN
  ALTER TABLE driver_profiles ADD CONSTRAINT driver_profiles_user_id_unique UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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
