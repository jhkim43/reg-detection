// src/db/schema.ts
import { pgTable, uuid, varchar, text, integer, jsonb, timestamp, boolean, doublePrecision, index, unique, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  loginId: varchar("login_id", { length: 50 }).unique().notNull(),
  nickname: varchar("nickname", { length: 50 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  systemRole: varchar("system_role", { length: 20 }).notNull().default("user"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 50 }).notNull(),
  appearance: jsonb("appearance").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_characters_user_id").on(table.userId),
]);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  description: varchar("description", { length: 500 }),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  mapData: jsonb("map_data"),
  mapConfig: jsonb("map_config"),
  isPublic: boolean("is_public").default(true),
  inviteCode: varchar("invite_code", { length: 20 }).unique(),
  maxPlayers: integer("max_players").default(50),
  password: varchar("password", { length: 255 }),
  gatewayConfig: jsonb("gateway_config"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const gatewayResources = pgTable("gateway_resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  baseUrl: text("base_url").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  pairedDeviceId: text("paired_device_id"),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastValidationStatus: varchar("last_validation_status", { length: 40 }),
  lastValidationError: text("last_validation_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_gateway_resources_owner_user_id").on(table.ownerUserId),
]);

export const gatewayShares = pgTable("gateway_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  gatewayId: uuid("gateway_id").notNull().references(() => gatewayResources.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 32 }).notNull().default("use"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_gateway_shares_gateway_id").on(table.gatewayId),
  index("idx_gateway_shares_user_id").on(table.userId),
  uniqueIndex("gateway_shares_gateway_user_idx").on(table.gatewayId, table.userId),
]);

export const channelGatewayBindings = pgTable("channel_gateway_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  gatewayId: uuid("gateway_id").notNull().references(() => gatewayResources.id, { onDelete: "cascade" }),
  boundByUserId: uuid("bound_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  boundAt: timestamp("bound_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_channel_gateway_bindings_gateway_id").on(table.gatewayId),
  uniqueIndex("channel_gateway_bindings_channel_idx").on(table.channelId),
]);

export const groupMembers = pgTable("group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_group_members_group_id").on(table.groupId),
  index("idx_group_members_user_id").on(table.userId),
  unique("group_members_group_user_unique").on(table.groupId, table.userId),
]);

export const groupInvites = pgTable("group_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 64 }).unique().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
  targetLoginId: varchar("target_login_id", { length: 50 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_group_invites_group_id").on(table.groupId),
  index("idx_group_invites_target_user_id").on(table.targetUserId),
]);

export const groupJoinRequests = pgTable("group_join_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  message: text("message"),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_group_join_requests_group_id").on(table.groupId),
  index("idx_group_join_requests_user_id").on(table.userId),
  unique("group_join_requests_group_user_unique").on(table.groupId, table.userId),
]);

export const groupPermissions = pgTable("group_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  permissionKey: varchar("permission_key", { length: 50 }).notNull(),
  effect: varchar("effect", { length: 10 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_group_permissions_group_id").on(table.groupId),
  unique("group_permissions_group_permission_unique").on(table.groupId, table.permissionKey),
]);

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionKey: varchar("permission_key", { length: 50 }).notNull(),
  effect: varchar("effect", { length: 10 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_user_permission_overrides_group_id").on(table.groupId),
  index("idx_user_permission_overrides_user_id").on(table.userId),
  unique("user_permission_overrides_group_user_permission_unique").on(table.groupId, table.userId, table.permissionKey),
]);

export const channelMembers = pgTable("channel_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  lastX: integer("last_x"),
  lastY: integer("last_y"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_channel_members_channel_id").on(table.channelId),
  index("idx_channel_members_user_id").on(table.userId),
  unique("channel_members_channel_user_unique").on(table.channelId, table.userId),
]);

export const maps = pgTable("maps", {
  id: varchar("id", { length: 100 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  tilemapPath: varchar("tilemap_path", { length: 500 }).notNull(),
  config: jsonb("config"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const mapPortals = pgTable("map_portals", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromMapId: varchar("from_map_id", { length: 100 }).references(() => maps.id),
  toMapId: varchar("to_map_id", { length: 100 }).references(() => maps.id),
  fromX: integer("from_x").notNull(),
  fromY: integer("from_y").notNull(),
  toX: integer("to_x").notNull(),
  toY: integer("to_y").notNull(),
});

export const mapTemplates = pgTable("map_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  icon: varchar("icon", { length: 10 }).notNull().default("🗺️"),
  description: varchar("description", { length: 500 }),
  cols: integer("cols").notNull(),
  rows: integer("rows").notNull(),
  layers: jsonb("layers"),
  objects: jsonb("objects"),
  tiledJson: jsonb("tiled_json"),
  thumbnail: text("thumbnail"),
  spawnCol: integer("spawn_col").notNull(),
  spawnRow: integer("spawn_row").notNull(),
  tags: varchar("tags", { length: 500 }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const npcs = pgTable("npcs", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  positionX: integer("position_x").notNull(),
  positionY: integer("position_y").notNull(),
  direction: varchar("direction", { length: 10 }).default("down"),
  appearance: jsonb("appearance").notNull(),
  openclawConfig: jsonb("openclaw_config").notNull(),
  // seed-v10 AC-005 / TRD-D-33: nanobot이 발급한 parent agent의 agentId (string, FK 아님).
  // NULL = 사용자가 hire한 일반 NPC. NOT NULL = nanobot spawn sub-agent (parent_agent_id의
  // npcs.openclawConfig.agentId와 매칭). cascade는 application layer에서 처리.
  parentAgentId: text("parent_agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_npcs_channel_id").on(table.channelId),
  index("idx_npcs_parent_agent_id").on(table.parentAgentId),
  unique("npcs_channel_position_unique").on(table.channelId, table.positionX, table.positionY),
]);

export const npcReports = pgTable("npc_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  npcId: uuid("npc_id").notNull().references(() => npcs.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  targetUserId: uuid("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 20 }).notNull(),
  message: text("message").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

// seed-v10 phase6 T-V35: sub-agent push 메시지 영속화 지원.
//   - character_id nullable — sub-agent 자율 보고는 character scope 무관.
//   - kind: 메시지 종류 식별 ("user_chat"|"npc_response"|"subagent_push"|...). NULL은 기존
//     row(legacy, role로 추론) 호환.
//   - metadata: free-form jsonb — subagent_id, subagent_label, task_npc_task_id 등.
export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").references(() => characters.id),
  npcId: uuid("npc_id").notNull().references(() => npcs.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 10 }).notNull(),
  content: text("content").notNull(),
  kind: varchar("kind", { length: 20 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_chat_messages_lookup").on(table.characterId, table.npcId, table.createdAt),
  index("idx_chat_messages_npc_kind").on(table.npcId, table.kind, table.createdAt),
]);

export const meetingMinutes = pgTable("meeting_minutes", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  transcript: text("transcript").notNull(),
  participants: jsonb("participants").notNull().default([]),
  totalTurns: integer("total_turns").notNull().default(0),
  durationSeconds: integer("duration_seconds"),
  initiatorId: uuid("initiator_id").references(() => users.id, { onDelete: "set null" }),
  keyTopics: jsonb("key_topics").notNull().default([]),
  conclusions: text("conclusions"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_meeting_minutes_channel").on(table.channelId),
  index("idx_meeting_minutes_created").on(table.createdAt),
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  channelId: uuid("channel_id").notNull().references(() => channels.id),
  // seed-v10 backlog-1 (A): NPC 삭제 시 task 이력 보존을 위해 ON DELETE SET NULL.
  // npc_id가 NULL이 되어도 npc_name_snapshot으로 작업자 attribution 살아남음.
  npcId: uuid("npc_id").references(() => npcs.id, { onDelete: "set null" }),
  npcNameSnapshot: varchar("npc_name_snapshot", { length: 100 }),
  assignerId: uuid("assigner_id").notNull().references(() => characters.id),
  npcTaskId: varchar("npc_task_id", { length: 64 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: text("summary"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  autoNudgeCount: integer("auto_nudge_count").notNull().default(0),
  autoNudgeMax: integer("auto_nudge_max").notNull().default(5),
  lastNudgedAt: timestamp("last_nudged_at", { withTimezone: true }),
  lastReportedAt: timestamp("last_reported_at", { withTimezone: true }),
  stalledAt: timestamp("stalled_at", { withTimezone: true }),
  stalledReason: varchar("stalled_reason", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("idx_tasks_channel").on(table.channelId),
  index("idx_tasks_npc").on(table.npcId),
  uniqueIndex("idx_tasks_npc_task_id").on(table.npcId, table.npcTaskId),
]);

export const stamps = pgTable("stamps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  cols: integer("cols").notNull(),
  rows: integer("rows").notNull(),
  tileWidth: integer("tile_width").notNull().default(32),
  tileHeight: integer("tile_height").notNull().default(32),
  layers: jsonb("layers").notNull(),
  tilesets: jsonb("tilesets").notNull(),
  thumbnail: text("thumbnail"),
  createdBy: uuid("created_by").references(() => users.id),
  builtIn: boolean("built_in").default(false).notNull(),
  tags: text("tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const tilesetImages = pgTable("tileset_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  tilewidth: integer("tilewidth").notNull().default(32),
  tileheight: integer("tileheight").notNull().default(32),
  columns: integer("columns").notNull(),
  tilecount: integer("tilecount").notNull(),
  image: text("image").notNull(),
  builtIn: boolean("built_in").default(false).notNull(),
  tags: text("tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("idx_tileset_images_name").on(table.name),
]);

// ── Projects ──────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  thumbnail: text("thumbnail"),
  tiledJson: jsonb("tiled_json"),
  settings: jsonb("settings"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectTilesets = pgTable("project_tilesets", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tilesetId: uuid("tileset_id").notNull().references(() => tilesetImages.id, { onDelete: "cascade" }),
  firstgid: integer("firstgid").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("uq_project_tileset").on(t.projectId, t.tilesetId),
]);

export const projectStamps = pgTable("project_stamps", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stampId: uuid("stamp_id").notNull().references(() => stamps.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("uq_project_stamp").on(t.projectId, t.stampId),
]);

// RegTrack AC-008 — nanobot hook이 매 LLM iteration 후 fire-and-forget POST로 채워넣음.
// session_key는 nanobot 채널/세션 식별자(예: api:<sessionKey>) 그대로 raw로 저장. npc_id는
// session_key 안에 NPC id가 들어있을 때(api:<npcId>-dm-...) 별도 매핑이 끼어들면 채움.
export const llmUsageRecords = pgTable("llm_usage_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionKey: varchar("session_key", { length: 200 }).notNull(),
  npcId: uuid("npc_id").references(() => npcs.id, { onDelete: "set null" }),
  provider: varchar("provider", { length: 20 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  phase: varchar("phase", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_llm_usage_created").on(table.createdAt),
  index("idx_llm_usage_npc").on(table.npcId),
]);

// seed-v9 AC-013/AC-014 — nanobot 게이트웨이의 chat 세션 추적 (chatSend/chatAbort 단위).
// session_key 형식: 'agent:<agentId>:<sessionName>' (openclaw parity).
// nanobot은 stateless이지만 streaming chunk 시각 + timeout 감시 + 호출 토큰 집계용.
export const nanobotAgentSessions = pgTable("nanobot_agent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  npcId: uuid("npc_id").notNull().references(() => npcs.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),  // npcs.openclawConfig.agentId 미러 (nanobot 모드는 npcId와 동일)
  sessionKey: text("session_key").notNull(),  // 'agent:<id>:<name>'
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  lastChunkAt: timestamp("last_chunk_at", { withTimezone: true }),
  abortedAt: timestamp("aborted_at", { withTimezone: true }),
  timeoutMs: integer("timeout_ms").notNull().default(180000),  // 180s, openclaw parity
  totalTokens: integer("total_tokens"),  // LLMUsageRecord와 join 후 집계
}, (table) => [
  uniqueIndex("nanobot_agent_sessions_agent_session_unique").on(table.agentId, table.sessionKey),
  index("idx_nanobot_agent_sessions_started").on(table.startedAt),
  index("idx_nanobot_agent_sessions_npc").on(table.npcId),
]);
