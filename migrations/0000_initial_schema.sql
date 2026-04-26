CREATE TYPE "public"."ride_status" AS ENUM('pending', 'accepted', 'driver_arriving', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending_payment', 'authorized', 'paid_card', 'paid_cash', 'cancelled_with_fee', 'cancelled', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card');--> statement-breakpoint
CREATE TYPE "public"."ownership_status" AS ENUM('none', 'ad_hoc', 'lifetime');--> statement-breakpoint
CREATE TYPE "public"."share_cert_status" AS ENUM('active', 'revoked', 'transferred');--> statement-breakpoint
CREATE TYPE "public"."profit_decl_status" AS ENUM('draft', 'declared', 'distributed');--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	"rating" numeric(3, 2) DEFAULT '5.00',
	"total_rides" integer DEFAULT 0,
	"emergency_contact" varchar,
	"stripe_customer_id" varchar,
	"stripe_payment_method_id" varchar,
	"virtual_card_balance" numeric(10, 2) DEFAULT '0.00',
	"promo_rides_remaining" integer DEFAULT 0,
	"password_reset_token" varchar,
	"password_reset_expiry" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"license_number" varchar,
	"license_image_url" varchar,
	"insurance_image_url" varchar,
	"is_online" boolean DEFAULT false,
	"is_verified_neighbor" boolean DEFAULT false,
	"is_suspended" boolean DEFAULT false,
	"approval_status" varchar DEFAULT 'pending',
	"discount_rate" numeric(3, 2) DEFAULT '0.00',
	"current_location" jsonb,
	"accepted_counties" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"daily_counties" text[],
	"daily_session_start" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_profile_id" varchar NOT NULL,
	"make" varchar NOT NULL,
	"model" varchar NOT NULL,
	"year" integer NOT NULL,
	"color" varchar NOT NULL,
	"license_plate" varchar NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" varchar NOT NULL,
	"driver_id" varchar,
	"pickup_location" jsonb NOT NULL,
	"destination_location" jsonb NOT NULL,
	"pickup_instructions" text,
	"status" "ride_status" DEFAULT 'pending',
	"payment_method" "payment_method" DEFAULT 'cash',
	"estimated_fare" numeric(8, 2),
	"actual_fare" numeric(8, 2),
	"distance" numeric(8, 2),
	"duration" integer,
	"tip_amount" numeric(8, 2) DEFAULT '0.00',
	"payment_status" "payment_status" DEFAULT 'pending_payment',
	"stripe_payment_intent_id" varchar,
	"refunded_amount" numeric(8, 2),
	"cancellation_fee" numeric(8, 2),
	"cancellation_reason" text,
	"driver_traveled_distance" numeric(8, 2),
	"driver_traveled_time" integer,
	"route_path" jsonb,
	"cash_received_at" timestamp,
	"paid_by" varchar,
	"rider_rating" integer,
	"driver_rating" integer,
	"rider_review" text,
	"driver_review" text,
	"scheduled_at" timestamp,
	"pickup_county" varchar,
	"shared_ride_group_id" varchar,
	"wants_shared_ride" boolean DEFAULT false,
	"shared_fare_discount" numeric(8, 2) DEFAULT '0.00',
	"group_id" varchar,
	"ride_type" varchar DEFAULT 'solo',
	"pickup_stops" jsonb,
	"original_fare" numeric(8, 2),
	"group_discount_amount" numeric(8, 2) DEFAULT '0.00',
	"promo_discount_applied" numeric(8, 2) DEFAULT '0.00',
	"accepted_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shared_ride_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"destination_label" varchar NOT NULL,
	"destination_lat" numeric(10, 6) NOT NULL,
	"destination_lng" numeric(10, 6) NOT NULL,
	"radius_miles" numeric(4, 2) DEFAULT '2.00',
	"max_riders" integer DEFAULT 4,
	"rider_count" integer DEFAULT 0,
	"status" varchar DEFAULT 'open',
	"driver_id" varchar,
	"discount_pct" integer DEFAULT 30,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ride_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_code" varchar(12) UNIQUE,
	"organizer_id" varchar NOT NULL,
	"group_type" varchar NOT NULL,
	"shared_destination" jsonb,
	"max_slots" integer DEFAULT 3,
	"filled_slots" integer DEFAULT 1,
	"status" varchar DEFAULT 'open',
	"driver_id" varchar,
	"discount_active" boolean DEFAULT false,
	"scheduled_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"endpoint" text NOT NULL UNIQUE,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payout_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payout_method" varchar NOT NULL,
	"payout_details" varchar NOT NULL,
	"status" varchar DEFAULT 'pending',
	"admin_note" text,
	"processed_by" varchar,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" varchar NOT NULL,
	"reporter_id" varchar NOT NULL,
	"issue_type" varchar NOT NULL,
	"description" text NOT NULL,
	"status" varchar DEFAULT 'pending',
	"resolution" text,
	"resolved_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "emergency_incidents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"ride_id" varchar,
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
--> statement-breakpoint
CREATE TABLE "driver_weekly_hours" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"week_start" date NOT NULL,
	"total_minutes" integer DEFAULT 0,
	"ride_count" integer DEFAULT 0,
	"qualifies_week" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_ownership" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL UNIQUE,
	"status" "ownership_status" DEFAULT 'none',
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
	"rating_at_qualification" numeric(3, 2),
	"background_check_status" varchar DEFAULT 'pending',
	"background_check_date" timestamp,
	"has_adverse_record" boolean DEFAULT false,
	"violation_notes" text,
	"removed_from_driving" boolean DEFAULT false,
	"removal_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "share_certificates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" varchar NOT NULL,
	"ownership_id" varchar NOT NULL,
	"certificate_number" varchar NOT NULL UNIQUE,
	"share_percentage" numeric(8, 4),
	"status" "share_cert_status" DEFAULT 'active',
	"issued_at" timestamp DEFAULT now(),
	"revoked_at" timestamp,
	"revoke_reason" text,
	"transferred_to" varchar,
	"transferred_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ownership_rebalance_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar NOT NULL,
	"triggered_by" varchar,
	"affected_driver_id" varchar,
	"previous_snapshot" jsonb,
	"new_snapshot" jsonb,
	"total_active_owners" integer DEFAULT 0,
	"driver_pool_percentage" numeric(5, 2) DEFAULT '49.00',
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profit_declarations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fiscal_year" integer NOT NULL,
	"total_revenue" numeric(12, 2),
	"total_expenses" numeric(12, 2),
	"net_profit" numeric(12, 2),
	"distributable_profit" numeric(12, 2),
	"status" "profit_decl_status" DEFAULT 'draft',
	"declared_by" varchar,
	"declared_at" timestamp,
	"distributed_at" timestamp,
	"board_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profit_distributions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"declaration_id" varchar NOT NULL,
	"owner_id" varchar NOT NULL,
	"share_percentage" numeric(8, 4),
	"ownership_type" "ownership_status",
	"amount" numeric(12, 2),
	"status" varchar DEFAULT 'pending',
	"paid_at" timestamp,
	"payment_method" varchar,
	"payment_reference" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "admin_activity_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" varchar NOT NULL,
	"action" varchar NOT NULL,
	"target_type" varchar,
	"target_id" varchar,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"balance_after" numeric(10, 2) NOT NULL,
	"reason" varchar(100) NOT NULL,
	"ride_id" varchar,
	"dispute_id" varchar,
	"performed_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL DEFAULT 'New Chat',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"role" varchar NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_rate_cards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL UNIQUE,
	"minimum_fare" numeric(8, 2) DEFAULT '7.65',
	"base_fare" numeric(8, 2) DEFAULT '4.00',
	"per_minute_rate" numeric(8, 4) DEFAULT '0.2900',
	"per_mile_rate" numeric(8, 4) DEFAULT '0.9000',
	"surge_adjustment" numeric(8, 2) DEFAULT '0.00',
	"use_suggested" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event_tracking" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"event_type" varchar NOT NULL,
	"event_category" varchar NOT NULL,
	"event_data" jsonb,
	"session_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar NOT NULL,
	"conversation_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"rating" varchar NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "platform_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "faq_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"category" varchar NOT NULL,
	"source_count" integer DEFAULT 1,
	"is_published" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "demand_heatmap" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grid_lat" numeric(10, 6) NOT NULL,
	"grid_lng" numeric(10, 6) NOT NULL,
	"hour_of_day" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"ride_count" integer DEFAULT 0,
	"avg_fare" numeric(8, 2),
	"avg_wait_time" integer,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_scorecard" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL UNIQUE,
	"total_rides_completed" integer DEFAULT 0,
	"total_rides_cancelled" integer DEFAULT 0,
	"acceptance_rate" numeric(5, 2) DEFAULT '0.00',
	"completion_rate" numeric(5, 2) DEFAULT '0.00',
	"avg_rating" numeric(3, 2) DEFAULT '5.00',
	"avg_response_time" integer,
	"total_earnings" numeric(12, 2) DEFAULT '0.00',
	"peak_hours_worked" jsonb,
	"best_zones" jsonb,
	"dispute_count" integer DEFAULT 0,
	"sos_count" integer DEFAULT 0,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "safety_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_type" varchar NOT NULL,
	"severity" varchar NOT NULL,
	"target_user_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"data" jsonb,
	"is_resolved" boolean DEFAULT false,
	"resolved_by" varchar,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_profile_id_driver_profiles_id_fk" FOREIGN KEY ("driver_profile_id") REFERENCES "public"."driver_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_ride_groups" ADD CONSTRAINT "shared_ride_groups_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_ride_groups" ADD CONSTRAINT "shared_ride_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_groups" ADD CONSTRAINT "ride_groups_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_groups" ADD CONSTRAINT "ride_groups_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_incidents" ADD CONSTRAINT "emergency_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_incidents" ADD CONSTRAINT "emergency_incidents_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_weekly_hours" ADD CONSTRAINT "driver_weekly_hours_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_ownership" ADD CONSTRAINT "driver_ownership_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_certificates" ADD CONSTRAINT "share_certificates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_certificates" ADD CONSTRAINT "share_certificates_ownership_id_driver_ownership_id_fk" FOREIGN KEY ("ownership_id") REFERENCES "public"."driver_ownership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_certificates" ADD CONSTRAINT "share_certificates_transferred_to_users_id_fk" FOREIGN KEY ("transferred_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_rebalance_log" ADD CONSTRAINT "ownership_rebalance_log_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_rebalance_log" ADD CONSTRAINT "ownership_rebalance_log_affected_driver_id_users_id_fk" FOREIGN KEY ("affected_driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_declarations" ADD CONSTRAINT "profit_declarations_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_declaration_id_profit_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."profit_declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_activity_log" ADD CONSTRAINT "admin_activity_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_rate_cards" ADD CONSTRAINT "driver_rate_cards_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tracking" ADD CONSTRAINT "event_tracking_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_driver_profiles_user_id" ON "driver_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_driver_profiles_is_online" ON "driver_profiles" USING btree ("is_online");--> statement-breakpoint
CREATE INDEX "idx_rides_rider_id" ON "rides" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "idx_rides_driver_id" ON "rides" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "idx_rides_status" ON "rides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_rides_created_at" ON "rides" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_wallet_user_created" ON "wallet_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_event_type" ON "event_tracking" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_event_category" ON "event_tracking" USING btree ("event_category");--> statement-breakpoint
CREATE INDEX "idx_event_created" ON "event_tracking" USING btree ("created_at");
