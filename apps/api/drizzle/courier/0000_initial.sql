CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_case_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"caller_origin" text NOT NULL,
	"request_id" text NOT NULL,
	"transfer_id" uuid NOT NULL,
	"case_type" text NOT NULL,
	"request_sha256" text NOT NULL,
	"case_data" jsonb NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_public_case_id_unique" UNIQUE("public_case_id"),
	CONSTRAINT "cases_caller_origin_request_id_key" UNIQUE("caller_origin","request_id"),
	CONSTRAINT "cases_caller_origin_transfer_id_key" UNIQUE("caller_origin","transfer_id"),
	CONSTRAINT "cases_case_type_check" CHECK ("cases"."case_type" = 'delivery_damage'),
	CONSTRAINT "cases_status_check" CHECK ("cases"."status" = 'accepted')
);

--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"key_id" text NOT NULL,
	"signed_jws" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_case_id_unique" UNIQUE("case_id")
);

--> statement-breakpoint
CREATE TABLE "shipments" (
	"order_reference" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL
);

--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO shipments (order_reference,customer_id) VALUES ('DEMO-1042','demo-user');
