CREATE TYPE "public"."topup_status" AS ENUM('pending', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."wallet_tx_type" AS ENUM('topup', 'parking', 'bonus', 'refund', 'adjustment');--> statement-breakpoint
CREATE TABLE "topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" "topup_status" DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"balance_after_cents" integer NOT NULL,
	"topup_id" uuid,
	"session_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "balance_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "topups" ADD CONSTRAINT "topups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_topup_id_topups_id_fk" FOREIGN KEY ("topup_id") REFERENCES "public"."topups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_session_id_parking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."parking_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topups_user_idx" ON "topups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "topups_status_idx" ON "topups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wallet_tx_user_idx" ON "wallet_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_tx_topup_once" ON "wallet_transactions" USING btree ("topup_id") WHERE topup_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_tx_session_once" ON "wallet_transactions" USING btree ("session_id") WHERE session_id is not null;