-- seed-v9 D-23: legacy openclawConfig.persona (string) key cleanup
-- v9부터 personaConfig.{identity, soul}만 정식. legacy persona는 deprecated.
-- 멱등 (idempotent): persona 키가 없는 row는 영향 없음.
UPDATE "npcs"
   SET "openclaw_config" = "openclaw_config" - 'persona'
 WHERE "openclaw_config" ? 'persona';
