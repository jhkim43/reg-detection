-- seed-v10 backlog-1 (A): tasks.npc_name_snapshot 컬럼 추가.
-- NPC 삭제(FK ON DELETE CASCADE) 시 task 작업자 attribution을 잃지 않도록
-- handleTaskEvent(create) 시점에 npcs.name을 캡처해 저장한다. UI는
-- npcs.name(LEFT JOIN; NULL일 수 있음) ?? npc_name_snapshot으로 fallback.

ALTER TABLE "tasks" ADD COLUMN "npc_name_snapshot" varchar(100);--> statement-breakpoint
