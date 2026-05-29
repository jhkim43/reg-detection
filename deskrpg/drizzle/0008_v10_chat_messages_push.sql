-- seed-v10 phase6 T-V35: sub-agent push 메시지 영속화 지원.
--
-- 변경:
--   1. character_id NOT NULL → nullable. sub-agent 자율 보고는 특정 character가 보낸
--      게 아니므로 NULL 허용.
--   2. kind 컬럼 추가: "user_chat" | "npc_response" | "subagent_push" 등. legacy row는
--      NULL (role로 추론).
--   3. metadata jsonb: subagent_id, subagent_label, task_npc_task_id 등 free-form.
--   4. (npc_id, kind, created_at) 복합 index: push 메시지 fetch 효율 + 향후 kind 별
--      필터링.

ALTER TABLE "chat_messages" ALTER COLUMN "character_id" DROP NOT NULL;
ALTER TABLE "chat_messages" ADD COLUMN "kind" varchar(20);
ALTER TABLE "chat_messages" ADD COLUMN "metadata" jsonb;

CREATE INDEX IF NOT EXISTS "idx_chat_messages_npc_kind"
  ON "chat_messages" ("npc_id", "kind", "created_at");
