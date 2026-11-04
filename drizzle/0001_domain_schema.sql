CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" text NOT NULL,
	"pilot_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_pkey" PRIMARY KEY("user_id","pilot_id")
);
--> statement-breakpoint
CREATE TABLE "profile_verification_issuance" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_issued_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_verifications" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"otp_code_hash" text,
	"otp_expires_at" timestamp with time zone,
	"flightlog_pilot_id" integer NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"flightlog_pilot_id" integer,
	"certificate_level" text,
	"certificate_level_set_at" timestamp with time zone,
	"certificate_checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "profiles_certificate_level_check" CHECK ("profiles"."certificate_level" in ('PP2', 'PP3', 'PP4', 'PP5'))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_verification_issuance" ADD CONSTRAINT "profile_verification_issuance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_verifications" ADD CONSTRAINT "profile_verifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_trip_id_created_at_idx" ON "comments" USING btree ("trip_id","created_at") WHERE "comments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "comments_user_id_created_at_idx" ON "comments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "follows_user_id_idx" ON "follows" USING btree ("user_id");