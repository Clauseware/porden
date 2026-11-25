CREATE TABLE "handoff_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handoff_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_sha256" text NOT NULL,
	"claims" jsonb NOT NULL,
	"signed_receipt" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_request_unique" UNIQUE("principal_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "handoff_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handoff_id" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"proposed_version" integer NOT NULL,
	"base_status" text NOT NULL,
	"reason" text NOT NULL,
	"proposer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "revision_version_unique" UNIQUE("handoff_id","proposed_version"),
	CONSTRAINT "revision_status" CHECK ("handoff_revisions"."status" IN ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "handoff_versions" (
	"handoff_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"terms" jsonb NOT NULL,
	"terms_sha256" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_versions_handoff_id_version_pk" PRIMARY KEY("handoff_id","version")
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sender_organization_id" uuid NOT NULL,
	"receiver_organization_id" uuid NOT NULL,
	"status" text NOT NULL,
	"current_version" integer NOT NULL,
	"approved_version" integer,
	"accepted_version" integer,
	"pending_revision_id" uuid,
	"workflow_id" uuid NOT NULL,
	"previous_handoff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_participants" CHECK ("handoffs"."sender_organization_id" <> "handoffs"."receiver_organization_id"),
	CONSTRAINT "handoff_status" CHECK ("handoffs"."status" IN ('draft','approved','accepted','rejected','cancelled','awaiting_approval','completed','failed')),
	CONSTRAINT "handoff_version" CHECK ("handoffs"."current_version" > 0 AND ("handoffs"."approved_version" IS NULL OR "handoffs"."approved_version" = "handoffs"."current_version") AND ("handoffs"."accepted_version" IS NULL OR "handoffs"."accepted_version" = "handoffs"."approved_version")),
	CONSTRAINT "handoff_pending" CHECK (("handoffs"."status" = 'awaiting_approval') = ("handoffs"."pending_revision_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"login" text NOT NULL,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"secret_hash" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "principals_login_unique" UNIQUE("login"),
	CONSTRAINT "principal_kind" CHECK ("principals"."kind" IN ('human','integration')),
	CONSTRAINT "principal_role" CHECK ("principals"."role" IN ('member','approver'))
);
--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_revisions" ADD CONSTRAINT "handoff_revisions_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_revisions" ADD CONSTRAINT "handoff_revisions_proposer_id_principals_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_revisions" ADD CONSTRAINT "handoff_revisions_decided_by_principals_id_fk" FOREIGN KEY ("decided_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_versions" ADD CONSTRAINT "handoff_versions_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_versions" ADD CONSTRAINT "handoff_versions_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_sender_organization_id_organizations_id_fk" FOREIGN KEY ("sender_organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_receiver_organization_id_organizations_id_fk" FOREIGN KEY ("receiver_organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_handoff_idx" ON "handoff_receipts" USING btree ("handoff_id","occurred_at");--> statement-breakpoint
CREATE INDEX "handoff_workflow_idx" ON "handoffs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "handoff_sender_idx" ON "handoffs" USING btree ("sender_organization_id","created_at");--> statement-breakpoint
CREATE INDEX "handoff_receiver_idx" ON "handoffs" USING btree ("receiver_organization_id","created_at");