-- seed-v11 AC-001: Claude Artifacts 스타일 보고서 본문 보관 (agent_reports).
--
-- 기존 npc_reports (0000_big_karnak.sql) 는 task-driven delivery queue (task_id FK,
-- target_user_id, status pending|delivered|consumed). seed-v11이 도입하는 본 보고서
-- 도메인은 character 소유 + npc 작성자 nullable + 자유 마크다운 본문 — 의미가 완전히
-- 다르므로 별 테이블로 분리. 사용자 옵션 A (rename) 채택 (seed-v11 post_creation_amendments
-- 2026-05-29 참조).

CREATE TABLE "agent_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL,
  "npc_id" uuid,
  "title" text,
  "body_markdown" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_character_id_characters_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_npc_id_npcs_id_fk"
  FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_reports_character_created"
  ON "agent_reports" ("character_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_reports_npc_created"
  ON "agent_reports" ("npc_id", "created_at");
