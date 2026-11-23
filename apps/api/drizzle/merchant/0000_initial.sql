CREATE TABLE "transfer_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transfer_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"sender_org" text NOT NULL,
	"recipient_origin" text NOT NULL,
	"case_type" text NOT NULL,
	"draft_data" jsonb NOT NULL,
	"approved_data" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload_sha256" text,
	"consented_at" timestamp with time zone,
	"consent_expires_at" timestamp with time zone,
	"receiver_case_id" text,
	"receiver_receipt_id" uuid,
	"verified_receipt" jsonb,
	"signed_receipt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_case_type_check" CHECK ("transfers"."case_type" = 'delivery_damage'),
	CONSTRAINT "transfers_status_check" CHECK ("transfers"."status" IN ('draft','approved','submitted','accepted','rejected','cancelled','unknown'))
);

--> statement-breakpoint
ALTER TABLE "transfer_events" ADD CONSTRAINT "transfer_events_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "transfer_events_transfer_time_idx" ON "transfer_events" USING btree ("transfer_id","occurred_at");
