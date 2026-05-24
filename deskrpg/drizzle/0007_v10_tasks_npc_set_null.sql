-- seed-v10 backlog-1 (A) 완성: tasks.npc_id를 nullable + ON DELETE SET NULL.
-- 기존 ON DELETE CASCADE는 NPC 삭제 시 task row 자체를 지워버려서 작업자 attribution이
-- 함께 사라지는 문제가 있었음. 본 migration 후 npcs row가 사라져도 tasks row는 유지되며,
-- npc_id만 NULL로 설정되고 npc_name_snapshot으로 작업자 라벨이 살아남는다.

ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_npc_id_npcs_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "npc_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_npc_id_npcs_id_fk"
  FOREIGN KEY ("npc_id") REFERENCES "npcs"("id") ON DELETE SET NULL;--> statement-breakpoint
