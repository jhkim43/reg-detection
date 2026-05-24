-- seed-v10 AC-005: npcs.parent_agent_id column 추가
-- nanobot이 발급한 parent agent의 agentId 저장 (string, FK 아님).
-- NULL = 사용자가 hire한 일반 NPC. NOT NULL = nanobot spawn sub-agent.
-- cascade는 application layer에서 처리 (internal-npc-handler.deleteNpcInternal).

ALTER TABLE "npcs" ADD COLUMN "parent_agent_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_npcs_parent_agent_id" ON "npcs" ("parent_agent_id");--> statement-breakpoint
