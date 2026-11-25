CREATE TABLE "merchant_claims" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"handoff_id" uuid,
	"request_sha256" text NOT NULL,
	"customer_id" text NOT NULL,
	"order_reference" text NOT NULL,
	"consent_data" jsonb,
	"approved_fields" text[],
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consent_cleared_at" timestamp with time zone,
	CONSTRAINT "merchant_claims_handoff_id_unique" UNIQUE("handoff_id"),
	CONSTRAINT "merchant_claims_consent_check" CHECK (("merchant_claims"."consent_data" IS NULL) = ("merchant_claims"."approved_fields" IS NULL) AND ("merchant_claims"."consent_data" IS NULL) = ("merchant_claims"."consent_cleared_at" IS NOT NULL)),
	CONSTRAINT "merchant_claims_cleared_check" CHECK ("merchant_claims"."consent_cleared_at" IS NULL OR "merchant_claims"."handoff_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "merchant_claims_customer_filed_idx" ON "merchant_claims" USING btree ("customer_id","filed_at");