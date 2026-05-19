-- seed-v9 T-011 (AC-013/AC-014): nanobot agent chat 세션 추적 테이블
-- chatSend/chatAbort 단위 + 180s timeout + LLM 토큰 집계용
CREATE TABLE IF NOT EXISTS "nanobot_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"session_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_chunk_at" timestamp with time zone,
	"aborted_at" timestamp with time zone,
	"timeout_ms" integer DEFAULT 180000 NOT NULL,
	"total_tokens" integer
);
--> statement-breakpoint
ALTER TABLE "nanobot_agent_sessions" ADD CONSTRAINT "nanobot_agent_sessions_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "nanobot_agent_sessions_agent_session_unique" ON "nanobot_agent_sessions" USING btree ("agent_id","session_key");
--> statement-breakpoint
CREATE INDEX "idx_nanobot_agent_sessions_started" ON "nanobot_agent_sessions" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "idx_nanobot_agent_sessions_npc" ON "nanobot_agent_sessions" USING btree ("npc_id");
