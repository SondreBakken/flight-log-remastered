CREATE TABLE "followed_takeoffs" (
	"user_id" text NOT NULL,
	"country_id" integer NOT NULL,
	"takeoff_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followed_takeoffs_pkey" PRIMARY KEY("user_id","country_id","takeoff_id")
);
--> statement-breakpoint
ALTER TABLE "followed_takeoffs" ADD CONSTRAINT "followed_takeoffs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followed_takeoffs_user_id_idx" ON "followed_takeoffs" USING btree ("user_id");