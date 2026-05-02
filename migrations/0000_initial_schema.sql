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
CREATE TABLE IF NOT EXISTS "sessions" (
  "sid" varchar PRIMARY KEY,
  "sess" jsonb NOT NULL,
  "expire" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" ("expire");

-- ── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "users" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar UNIQUE,
  "password" varchar,
  "first_name" varchar,
  "last_name" varchar,
  "profile_image_url" varchar,
  "phone" varchar,
  "is_driver" boolean DEFAULT false,
  "is_verified" boolean DEFAULT false,
  "is_admin" boolean DEFAULT false,
  "is_super_admin" boolean DEFAULT false,
  "is_approved" boolean DEFAULT false,
  "approved_by" varchar,
  "is_suspended" boolean DEFAULT false,
  "rating" numeric(3,2) DEFAULT '5.00',
  "total_rides" integer DEFAULT 0,
  "emergency_contact" varchar,
  "stripe_customer_id" varchar,
  "stripe_payment_method_id" varchar,
  "virtual_card_balance" numeric(10,2) DEFAULT '0.00',
  "promo_rides_remaining" integer DEFAULT 0,
  "password_reset_token" varchar,
  "password_reset_expiry" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Driver profiles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "driver_profiles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "license_number" varchar,
  "license_image_url" varchar,
  "insurance_image_url" varchar,
  "is_online" boolean DEFAULT false,
  "is_verified_neighbor" boolean DEFAULT false,
  "is_suspended" boolean DEFAULT false,
  "approval_status" varchar DEFAULT 'pending',
  "discount_rate" numeric(3,2) DEFAULT '0.00',
  "current_location" jsonb,
  "accepted_counties" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "daily_counties" text[],
  "daily_session_start" timestamp,
  "checkr_candidate_id" varchar,
  "checkr_report_id" varchar,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_driver_profiles_user_id" ON "driver_profiles" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_driver_profiles_is_online" ON "driver_profiles" ("is_online");

-- ── Vehicles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_profile_id" varchar NOT NULL REFERENCES "driver_profiles"("id"),
  "make" varchar NOT NULL,
  "model" varchar NOT NULL,
  "year" integer NOT NULL,
  "color" varchar NOT NULL,
  "license_plate" varchar NOT NULL,
  "photos" jsonb DEFAULT '[]',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Rides ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rides" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "rider_id" varchar NOT NULL REFERENCES "users"("id"),
  "driver_id" varchar REFERENCES "users"("id"),
  "pickup_location" jsonb NOT NULL,
  "destination_location" jsonb NOT NULL,
  "pickup_instructions" text,
  "status" ride_status DEFAULT 'pending',
  "payment_method" payment_method DEFAULT 'cash',
  "estimated_fare" numeric(8,2),
  "actual_fare" numeric(8,2),
  "distance" numeric(8,2),
  "duration" integer,
  "tip_amount" numeric(8,2) DEFAULT '0.00',
  "payment_status" payment_status DEFAULT 'pending_payment',
  "stripe_payment_intent_id" varchar,
  "refunded_amount" numeric(8,2),
  "cancellation_fee" numeric(8,2),
  "cancellation_reason" text,
  "driver_traveled_distance" numeric(8,2),
  "driver_traveled_time" integer,
  "route_path" jsonb,
  "cash_received_at" timestamp,
  "paid_by" varchar REFERENCES "users"("id"),
  "rider_rating" integer,
  "driver_rating" integer,
  "rider_review" text,
  "driver_review" text,
  "scheduled_at" timestamp,
  "pickup_county" varchar,
  "shared_ride_group_id" varchar,
  "wants_shared_ride" boolean DEFAULT false,
  "shared_fare_discount" numeric(8,2) DEFAULT '0.00',
  "group_id" varchar,
  "ride_type" varchar DEFAULT 'solo',
  "pickup_stops" jsonb,
  "original_fare" numeric(8,2),
  "group_discount_amount" numeric(8,2) DEFAULT '0.00',
  "promo_discount_applied" numeric(8,2) DEFAULT '0.00',
  "accepted_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_rides_rider_id" ON "rides" ("rider_id");
CREATE INDEX IF NOT EXISTS "idx_rides_driver_id" ON "rides" ("driver_id");
CREATE INDEX IF NOT EXISTS "idx_rides_status" ON "rides" ("status");
CREATE INDEX IF NOT EXISTS "idx_rides_created_at" ON "rides" ("created_at");

-- ── Shared ride groups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shared_ride_groups" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "scheduled_at" timestamp NOT NULL,
  "destination_label" varchar NOT NULL,
  "destination_lat" numeric(10,6) NOT NULL,
  "destination_lng" numeric(10,6) NOT NULL,
  "radius_miles" numeric(4,2) DEFAULT '2.00',
  "max_riders" integer DEFAULT 4,
  "rider_count" integer DEFAULT 0,
  "status" varchar DEFAULT 'open',
  "driver_id" varchar REFERENCES "users"("id"),
  "discount_pct" integer DEFAULT 30,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Ride groups ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ride_groups" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_code" varchar(12) UNIQUE,
  "organizer_id" varchar NOT NULL REFERENCES "users"("id"),
  "group_type" varchar NOT NULL,
  "shared_destination" jsonb,
  "max_slots" integer DEFAULT 3,
  "filled_slots" integer DEFAULT 1,
  "status" varchar DEFAULT 'open',
  "driver_id" varchar REFERENCES "users"("id"),
  "discount_active" boolean DEFAULT false,
  "scheduled_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

-- ── Push subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamp DEFAULT now()
);

-- ── Payout requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payout_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" varchar NOT NULL REFERENCES "users"("id"),
  "amount" numeric(10,2) NOT NULL,
  "payout_method" varchar NOT NULL,
  "payout_details" varchar NOT NULL,
  "status" varchar DEFAULT 'pending',
  "admin_note" text,
  "processed_by" varchar REFERENCES "users"("id"),
  "processed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Disputes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "disputes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "ride_id" varchar NOT NULL REFERENCES "rides"("id"),
  "reporter_id" varchar NOT NULL REFERENCES "users"("id"),
  "issue_type" varchar NOT NULL,
  "description" text NOT NULL,
  "status" varchar DEFAULT 'pending',
  "resolution" text,
  "resolved_by" varchar REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Emergency incidents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "emergency_incidents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "ride_id" varchar REFERENCES "rides"("id"),
  "incident_type" varchar NOT NULL,
  "location" jsonb,
  "description" text,
  "status" varchar DEFAULT 'active',
  "share_token" varchar UNIQUE,
  "emergency_contact_alerted" boolean DEFAULT false,
  "last_location_update" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Driver weekly hours ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "driver_weekly_hours" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" varchar NOT NULL REFERENCES "users"("id"),
  "week_start" date NOT NULL,
  "total_minutes" integer DEFAULT 0,
  "ride_count" integer DEFAULT 0,
  "qualifies_week" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now()
);

-- ── Driver ownership ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "driver_ownership" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" varchar NOT NULL UNIQUE REFERENCES "users"("id"),
  "status" ownership_status DEFAULT 'none',
  "total_qualifying_weeks" integer DEFAULT 0,
  "total_lifetime_minutes" integer DEFAULT 0,
  "year1_minutes" integer DEFAULT 0,
  "year2_minutes" integer DEFAULT 0,
  "year3_minutes" integer DEFAULT 0,
  "year4_minutes" integer DEFAULT 0,
  "year5_minutes" integer DEFAULT 0,
  "tracking_start_date" timestamp,
  "ad_hoc_qualification_date" timestamp,
  "lifetime_qualification_date" timestamp,
  "grace_deadline" timestamp,
  "rating_at_qualification" numeric(3,2),
  "background_check_status" varchar DEFAULT 'pending',
  "background_check_date" timestamp,
  "has_adverse_record" boolean DEFAULT false,
  "violation_notes" text,
  "removed_from_driving" boolean DEFAULT false,
  "removal_reason" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Share certificates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "share_certificates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" varchar NOT NULL REFERENCES "users"("id"),
  "ownership_id" varchar NOT NULL REFERENCES "driver_ownership"("id"),
  "certificate_number" varchar NOT NULL UNIQUE,
  "share_percentage" numeric(8,4),
  "status" share_cert_status DEFAULT 'active',
  "issued_at" timestamp DEFAULT now(),
  "revoked_at" timestamp,
  "revoke_reason" text,
  "transferred_to" varchar REFERENCES "users"("id"),
  "transferred_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Ownership rebalance log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ownership_rebalance_log" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" varchar NOT NULL,
  "triggered_by" varchar REFERENCES "users"("id"),
  "affected_driver_id" varchar REFERENCES "users"("id"),
  "previous_snapshot" jsonb,
  "new_snapshot" jsonb,
  "total_active_owners" integer DEFAULT 0,
  "driver_pool_percentage" numeric(5,2) DEFAULT '49.00',
  "notes" text,
  "created_at" timestamp DEFAULT now()
);

-- ── Profit declarations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "profit_declarations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "fiscal_year" integer NOT NULL,
  "total_revenue" numeric(12,2),
  "total_expenses" numeric(12,2),
  "net_profit" numeric(12,2),
  "distributable_profit" numeric(12,2),
  "status" profit_decl_status DEFAULT 'draft',
  "declared_by" varchar REFERENCES "users"("id"),
  "declared_at" timestamp,
  "distributed_at" timestamp,
  "board_notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Profit distributions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "profit_distributions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "declaration_id" varchar NOT NULL REFERENCES "profit_declarations"("id"),
  "owner_id" varchar NOT NULL REFERENCES "users"("id"),
  "share_percentage" numeric(8,4),
  "ownership_type" ownership_status,
  "amount" numeric(12,2),
  "status" varchar DEFAULT 'pending',
  "paid_at" timestamp,
  "payment_method" varchar,
  "payment_reference" varchar,
  "created_at" timestamp DEFAULT now()
);

-- ── Admin activity log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "admin_activity_log" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_id" varchar NOT NULL REFERENCES "users"("id"),
  "action" varchar NOT NULL,
  "target_type" varchar,
  "target_id" varchar,
  "details" jsonb,
  "created_at" timestamp DEFAULT now()
);

-- ── Wallet transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "amount" numeric(10,2) NOT NULL,
  "balance_after" numeric(10,2) NOT NULL,
  "reason" varchar(100) NOT NULL,
  "ride_id" varchar,
  "dispute_id" varchar,
  "performed_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_wallet_user_created" ON "wallet_transactions" ("user_id", "created_at");

-- ── Conversations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "title" text NOT NULL DEFAULT 'New Chat',
  "created_at" timestamp DEFAULT now()
);

-- ── Chat messages ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" varchar NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "role" varchar NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now()
);

-- ── Driver rate cards ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "driver_rate_cards" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" varchar NOT NULL UNIQUE REFERENCES "users"("id"),
  "minimum_fare" numeric(8,2) DEFAULT '7.65',
  "base_fare" numeric(8,2) DEFAULT '4.00',
  "per_minute_rate" numeric(8,4) DEFAULT '0.2900',
  "per_mile_rate" numeric(8,4) DEFAULT '0.9000',
  "surge_adjustment" numeric(8,2) DEFAULT '0.00',
  "use_suggested" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Event tracking ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "event_tracking" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar REFERENCES "users"("id"),
  "event_type" varchar NOT NULL,
  "event_category" varchar NOT NULL,
  "event_data" jsonb,
  "session_id" varchar,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_event_type" ON "event_tracking" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_event_category" ON "event_tracking" ("event_category");
CREATE INDEX IF NOT EXISTS "idx_event_created" ON "event_tracking" ("created_at");

-- ── AI feedback ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_feedback" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" varchar NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "conversation_id" varchar NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "rating" varchar NOT NULL,
  "reason" text,
  "created_at" timestamp DEFAULT now()
);

-- ── Platform insights ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "platform_insights" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "insight_type" varchar NOT NULL,
  "category" varchar NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "data" jsonb,
  "severity" varchar DEFAULT 'info',
  "is_read" boolean DEFAULT false,
  "is_actionable" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now()
);

-- ── FAQ entries ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "faq_entries" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "category" varchar NOT NULL,
  "source_count" integer DEFAULT 1,
  "is_published" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- ── Demand heatmap ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "demand_heatmap" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "grid_lat" numeric(10,6) NOT NULL,
  "grid_lng" numeric(10,6) NOT NULL,
  "hour_of_day" integer NOT NULL,
  "day_of_week" integer NOT NULL,
  "ride_count" integer DEFAULT 0,
  "avg_fare" numeric(8,2),
  "avg_wait_time" integer,
  "last_updated" timestamp DEFAULT now()
);

-- ── Driver scorecard ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "driver_scorecard" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" varchar NOT NULL UNIQUE REFERENCES "users"("id"),
  "total_rides_completed" integer DEFAULT 0,
  "total_rides_cancelled" integer DEFAULT 0,
  "acceptance_rate" numeric(5,2) DEFAULT '0.00',
  "completion_rate" numeric(5,2) DEFAULT '0.00',
  "avg_rating" numeric(3,2) DEFAULT '5.00',
  "avg_response_time" integer,
  "total_earnings" numeric(12,2) DEFAULT '0.00',
  "peak_hours_worked" jsonb,
  "best_zones" jsonb,
  "dispute_count" integer DEFAULT 0,
  "sos_count" integer DEFAULT 0,
  "last_updated" timestamp DEFAULT now()
);

-- ── Safety alerts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "safety_alerts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_type" varchar NOT NULL,
  "severity" varchar NOT NULL,
  "target_user_id" varchar REFERENCES "users"("id"),
  "title" text NOT NULL,
  "description" text,
  "data" jsonb,
  "is_resolved" boolean DEFAULT false,
  "resolved_by" varchar REFERENCES "users"("id"),
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now()
);
