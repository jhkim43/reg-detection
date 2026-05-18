CREATE TABLE "llm_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_key" varchar(200) NOT NULL,
	"npc_id" uuid,
	"provider" varchar(20) NOT NULL,
	"model" varchar(100) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"phase" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_usage_records" ADD CONSTRAINT "llm_usage_records_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_llm_usage_created" ON "llm_usage_records" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "idx_llm_usage_npc" ON "llm_usage_records" USING btree ("npc_id");
