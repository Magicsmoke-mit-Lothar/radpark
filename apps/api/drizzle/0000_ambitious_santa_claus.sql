CREATE TYPE "public"."dock_status" AS ENUM('available', 'reserved', 'occupied', 'out_of_service');--> statement-breakpoint
CREATE TYPE "public"."lock_state" AS ENUM('locked', 'unlocked', 'jammed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('reserved', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "docks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "dock_status" DEFAULT 'available' NOT NULL,
	"lock_state" "lock_state" DEFAULT 'unknown' NOT NULL,
	"bike_present" boolean DEFAULT false NOT NULL,
	"fault" text,
	"state_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"station_id" uuid,
	"dock_id" uuid,
	"user_id" uuid,
	"session_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dock_id" uuid NOT NULL,
	"status" "session_status" DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"price_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"location" geometry(point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
	"price_per_hour_cents" integer DEFAULT 50 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"firmware" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "docks" ADD CONSTRAINT "docks_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_dock_id_docks_id_fk" FOREIGN KEY ("dock_id") REFERENCES "public"."docks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "docks_station_number_idx" ON "docks" USING btree ("station_id","number");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "parking_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_dock_idx" ON "parking_sessions" USING btree ("dock_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_code_idx" ON "stations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "stations_location_idx" ON "stations" USING gist (("location"::geography));