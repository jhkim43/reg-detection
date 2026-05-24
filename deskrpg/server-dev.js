// server-dev.js
// Custom server — wraps Next.js standalone with Socket.io on a single port
/* eslint-disable @typescript-eslint/no-require-imports */

const path = require("node:path");
const http = require("node:http");
const { Server } = require("socket.io");
const express = require("express");
const next = require("next");

const {
  OpenClawGateway,
  buildGatewayErrorPayload,
  getGatewayErrorStatus,
} = require("./src/lib/openclaw-gateway.js");
const {
  isNanobotProvider,
  createNanobotAdapter,
} = require("./src/lib/nanobot-client.js");
const { parseNpcResponse, isValidTaskAction } = require("./src/lib/task-parser.js");
const { TaskManager } = require("./src/lib/task-manager.js");
const { withTaskReminder, normalizeTaskPromptLocale, buildTaskSessionPrompt } = require("./src/lib/task-prompt.js");
const {
  getInternalSocketHostname,
  isInternalRequestAuthorized,
} = require("./src/lib/internal-transport.js");

const dir = __dirname;
// 개발 환경과 운영 환경을 동적으로 구분할 수 있도록 수정 (Dockerfile.dev의 ENV NODE_ENV=development 반영)
const isDev = process.env.NODE_ENV !== "production";

// Standalone server runs on HTTP localhost — default to insecure cookies
// so browsers accept Set-Cookie. Override with COOKIE_SECURE=true for HTTPS.
if (!process.env.COOKIE_SECURE) process.env.COOKIE_SECURE = "false";
process.chdir(dir);

const currentPort = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

async function main() {
  // 1. Next.js 앱 초기화 (isDev 상태에 따라 HMR 활성화)
  const app = next({ dev: isDev, dir });
  const handle = app.getRequestHandler();
  await app.prepare();

  // 2. 동적 모듈 임포트
  const { jwtVerify } = await import("jose");
  const unwrapTsModule = (moduleNamespace) => {
    if (
      moduleNamespace &&
      typeof moduleNamespace === "object" &&
      "default" in moduleNamespace &&
      moduleNamespace.default &&
      typeof moduleNamespace.default === "object"
    ) {
      return moduleNamespace.default;
    }
    return moduleNamespace;
  };
  const taskReporting = unwrapTsModule(await import("./src/lib/task-reporting.ts"));
  const {
    buildAutoExecutionPrompt,
    buildCompletionReportRow,
    buildResumeTaskExecutionPrompt,
    buildTaskActionStartMessage,
    buildQueuedReportRow,
    buildManualTaskReportPrompt,
    enqueueCompletionReport,
    enqueueQueuedReport,
    getProgressNudgeCutoff,
    getPendingReportsForUserAndChannel,
    getReportsByTaskId,
    getTaskAutomationConfig,
    markReportConsumed,
    markReportDelivered,
    shouldDeliverCompletionReport,
    toReportReadyPayload,
  } = taskReporting;
  const channelAccess = unwrapTsModule(await import("./src/lib/rbac/channel-access.ts"));
  const {
    buildChannelAccessDeniedPayload,
    summarizeChannelParticipationAccess,
  } = channelAccess;
  const meetingSocket = unwrapTsModule(await import("./src/server/meeting-socket.ts"));
  const {
    registerMeetingSocketHandlers,
  } = meetingSocket;
  const meetingDiscussion = unwrapTsModule(await import("./src/server/meeting-discussion.ts"));
  const {
    registerMeetingDiscussionHandlers,
  } = meetingDiscussion;

  // seed-v9 AC-015 T-F01: 첫 부팅 시 legacy ~/.openclaw 디렉토리를 ~/.nanobot으로 이동.
  try {
    const { migrateLegacyOpenClawPaths } = await import("./src/lib/nanobot-path-migration.ts");
    const migrationResult = await migrateLegacyOpenClawPaths();
    for (const step of migrationResult.steps) {
      if (step.action === "moved") {
        console.log(`✓ [migrate] ${step.from} → ${step.to}`);
      } else if (step.action === "error") {
        console.warn(`⚠ [migrate] ${step.from} → ${step.to} failed: ${step.error}`);
      }
    }
  } catch (err) {
    console.warn("[migrate] legacy path migration encountered an error:", err);
  }

  const { db, schema } = require("./src/db/server-db.js");
  const { eq, and } = require("drizzle-orm");

  // seed-v9 AC-014 T-026 production wiring — in-flight NPC chat 추적.
  const pendingNpcChats = new Map();
  function pendingNpcChatKey(socketId, npcId) {
    return socketId + ":" + npcId;
  }
  const { parseJson } = require("./src/db/normalize.js");
  const taskManager = new TaskManager(db, schema);
  const { MeetingBroker } = require("./src/lib/meeting-broker.js");
  const reportSchema = { npcReports: schema.npcReports };

  // 3. 통합 HTTP 서버 및 Express 초기화
  const expressApp = express();
  const httpServer = http.createServer(expressApp);

  // 하나의 포트에서 Socket.io와 Next.js가 같이 작동하도록 연결
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: "*" },
    maxHttpBufferSize: 20e6, // 20 MB — supports 3 × 5 MB file attachments
  });

  // JWT helpers
  function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("Missing JWT_SECRET");
    return new TextEncoder().encode(secret);
  }

  async function authenticateSocket(socket) {
    try {
      const cookieHeader = socket.handshake.headers.cookie || "";
      const tokenMatch = cookieHeader.match(/token=([^;]+)/);
      if (!tokenMatch) return null;
      const { payload } = await jwtVerify(tokenMatch[1], getJwtSecret());
      return { userId: payload.userId, nickname: payload.nickname };
    } catch {
      return null;
    }
  }

  function emitChannelAccessDenied(socket, input) {
    socket.emit("channel:access-denied", buildChannelAccessDeniedPayload(input));
  }

  async function getSocketChannelParticipationAccess(channelId, userId) {
    const channelRows = await db
      .select({
        id: schema.channels.id,
        groupId: schema.channels.groupId,
        isPublic: schema.channels.isPublic,
        ownerId: schema.channels.ownerId,
      })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);

    const channel = channelRows[0];
    if (!channel) {
      return null;
    }

    const groupMembershipRows = channel.groupId
      ? await db
          .select({ role: schema.groupMembers.role })
          .from(schema.groupMembers)
          .where(
            and(
              eq(schema.groupMembers.groupId, channel.groupId),
              eq(schema.groupMembers.userId, userId),
            ),
          )
          .limit(1)
      : [];

    const channelMembershipRows = await db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
        ),
      )
      .limit(1);

    const access = summarizeChannelParticipationAccess({
      groupId: channel.groupId,
      isPublic: channel.isPublic ?? true,
      hasActiveGroupMembership: groupMembershipRows.length > 0,
      isChannelMember: channel.ownerId === userId || channelMembershipRows.length > 0,
    });

    return { channel, access };
  }

  // In-memory state
  const players = new Map();
  const npcConfigCache = new Map();
  const lastChatTime = new Map();
  const meetingRooms = new Map(); // channelId → { participants: Set, messages: [] }
  const activeBrokers = new Map(); // channelId -> MeetingBroker instance
  const discussionInitiators = new Map(); // channelId → userId
  const userSockets = new Map(); // userId → socketId (one socket per user)
  const channelOwners = new Map(); // channelId → ownerId
  const channelGateways = new Map(); // channelId → OpenClawGateway instance
  const channelChatHistory = new Map(); // channelId -> message[] (all messages kept for session lifetime)
  
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const chatHistory = require("./src/lib/chat-history.js");
  const CHAT_COOLDOWN_MS = 2000;
  const PROGRESS_NUDGE_SCAN_MS = 60_000;
  const progressNudgeInFlight = new Set();
  const progressNudgeCooldowns = new Map();

  function getSocketLocale(socket) {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const localeMatch = cookieHeader.match(/(?:^|;\s*)deskrpg-locale=([^;]+)/);
    return normalizeTaskPromptLocale(localeMatch && localeMatch[1]);
  }

  function getJoinedSocketsForUserAndChannel(userId, channelId) {
    return Array.from(players.values())
      .filter((player) => player.userId === userId && player.mapId === channelId)
      .map((player) => io.sockets.sockets.get(player.id))
      .filter(Boolean);
  }

  async function appendNpcHistoryMessage(characterId, npcId, content) {
    const sanitizedContent = require("./src/lib/task-block-utils.js").sanitizeNpcResponseText(content);
    if (!sanitizedContent.trim()) return null;
    if (characterId) {
      await chatHistory.appendMessage(characterId, npcId, "npc", sanitizedContent);
    }
    return sanitizedContent;
  }

  async function appendNpcHistoryMessageForUser(userId, characterId, channelId, npcId, content) {
    const sanitizedContent = await appendNpcHistoryMessage(characterId, npcId, content);
    if (!sanitizedContent) return;

    const joinedSockets = getJoinedSocketsForUserAndChannel(userId, channelId);
    for (const joinedSocket of joinedSockets) {
      joinedSocket.emit("npc:history-append", { npcId, message: sanitizedContent });
    }
  }

  async function deliverPendingReportsToSocket(socket, userId, channelId) {
    const pendingReports = await getPendingReportsForUserAndChannel(
      db,
      reportSchema,
      { userId, channelId },
    );

    for (const report of pendingReports) {
      const npcConfig = await getNpcConfig(report.npcId);
      socket.emit("npc:report-ready", toReportReadyPayload(report, npcConfig?._name));
      await markReportDelivered(db, reportSchema, report.id);
    }
  }

  async function getAssignerUserId(assignerId) {
    const rows = await db
      .select({ userId: schema.characters.userId })
      .from(schema.characters)
      .where(eq(schema.characters.id, assignerId));
    return rows[0]?.userId || null;
  }

  async function getChannelTaskAutomation(channelId) {
    const rows = await db
      .select({ gatewayConfig: schema.channels.gatewayConfig })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId));
    return getTaskAutomationConfig(rows[0]?.gatewayConfig || null);
  }

  async function processNpcTaskActions(parsed, input) {
    const taskAutomation = await getChannelTaskAutomation(input.channelId);
    for (const taskAction of parsed.tasks) {
      if (!isValidTaskAction(taskAction)) {
        console.warn("[TaskManager] Invalid task action:", taskAction);
        continue;
      }

      try {
        const task = await taskManager.handleTaskAction(
          taskAction,
          input.channelId,
          input.npcId,
          input.assignerCharacterId,
          { autoNudgeMax: taskAutomation.autoProgressNudgeMax },
        );

        if (!task) continue;

        io.to(input.channelId).emit("task:updated", { task, action: taskAction.action });

        if (shouldDeliverCompletionReport(taskAction)) {
          await appendNpcHistoryMessage(input.assignerCharacterId, input.npcId, parsed.message);
          const report = await enqueueCompletionReport(
            db,
            reportSchema,
            buildCompletionReportRow({
              channelId: input.channelId,
              npcId: input.npcId,
              taskId: task.id,
              targetUserId: input.targetUserId,
              message: parsed.message,
            }),
          );

          if (report) {
            const joinedSockets = getJoinedSocketsForUserAndChannel(input.targetUserId, input.channelId);
            if (joinedSockets.length > 0) {
              const payload = toReportReadyPayload(report, input.npcName);
              for (const joinedSocket of joinedSockets) {
                joinedSocket.emit("npc:report-ready", payload);
              }
              await markReportDelivered(db, reportSchema, report.id);
            }
          }
        }
      } catch (err) {
        console.error("[TaskManager] Error handling task action:", err);
      }
    }
  }

  async function runProgressNudgeForTask(task, promptOverride, reportKind = "progress") {
    if (progressNudgeInFlight.has(task.id)) return;
    progressNudgeInFlight.add(task.id);

    try {
      const npcConfig = await getNpcConfig(task.npcId);
      const agentId = npcConfig?.agentId || npcConfig?.agent_id || null;
      if (!npcConfig || !agentId) return;

      const targetUserId = await getAssignerUserId(task.assignerId);
      if (!targetUserId) return;

      const gateway = await getOrConnectGateway(task.channelId);
      if (!gateway) return;

      const sessionKey = `${npcConfig.sessionKeyPrefix || task.npcId}-dm-${targetUserId}`;
      await taskManager.markTaskNudged(task.id, task.channelId);
      const response = await gateway.chatSend(
        agentId,
        sessionKey,
        withTaskReminder(promptOverride || buildAutoExecutionPrompt(task)),
        () => {},
      );
      const parsed = parseNpcResponse(response);

      await processNpcTaskActions(parsed, {
        channelId: task.channelId,
        npcId: task.npcId,
        npcName: npcConfig._name,
        assignerCharacterId: task.assignerId,
        targetUserId,
      });

      const preview = (parsed.message || "").trim() || `${task.title} 진행 상황을 보고했습니다.`;
      await appendNpcHistoryMessage(task.assignerId, task.npcId, preview);

      const report = await enqueueQueuedReport(
        db,
        reportSchema,
        buildQueuedReportRow({
          channelId: task.channelId,
          npcId: task.npcId,
          taskId: task.id,
          targetUserId,
          message: preview,
          kind: reportKind,
        }),
      );

      if (report) {
        const joinedSockets = getJoinedSocketsForUserAndChannel(targetUserId, task.channelId);
        if (joinedSockets.length > 0) {
          const payload = toReportReadyPayload(report, npcConfig._name);
          for (const joinedSocket of joinedSockets) {
            joinedSocket.emit("npc:report-ready", payload);
          }
          await markReportDelivered(db, reportSchema, report.id);
        }
      }
    } catch (err) {
      console.error("[task-reporting] Progress nudge failed:", err);
    } finally {
      progressNudgeInFlight.delete(task.id);
    }
  }

  async function scanProgressNudges() {
    try {
      const channelRows = await db
        .select({ id: schema.channels.id, gatewayConfig: schema.channels.gatewayConfig })
        .from(schema.channels);

      for (const channelRow of channelRows) {
        const taskAutomation = getTaskAutomationConfig(channelRow.gatewayConfig);
        if (!taskAutomation.autoProgressNudgeEnabled) continue;

        const cutoffIso = new Date(
          getProgressNudgeCutoff(taskAutomation.autoProgressNudgeMinutes),
        ).toISOString();

        const staleTasks = await taskManager.getStaleInProgressTasks(channelRow.id, cutoffIso);
        for (const task of staleTasks) {
          const autoNudgeMax = task.autoNudgeMax ?? taskAutomation.autoProgressNudgeMax;
          if ((task.autoNudgeCount ?? 0) >= autoNudgeMax) {
            const stalledTask = await taskManager.markTaskStalled(task.id, channelRow.id, "max_nudges_reached");
            if (stalledTask) {
              io.to(channelRow.id).emit("task:updated", { task: stalledTask, action: "stalled" });
            }
            continue;
          }

          const lastNudgedAt = progressNudgeCooldowns.get(task.id) || 0;
          if (Date.now() - lastNudgedAt < taskAutomation.autoProgressNudgeMinutes * 60 * 1000) {
            continue;
          }

          progressNudgeCooldowns.set(task.id, Date.now());
          await runProgressNudgeForTask(task, buildAutoExecutionPrompt(task));
        }
      }
    } catch (err) {
      console.error("[task-reporting] Progress nudge scan failed:", err);
    }
  }

  setInterval(() => {
    void scanProgressNudges();
  }, PROGRESS_NUDGE_SCAN_MS);

  async function getNpcConfig(npcId) {
    if (npcConfigCache.has(npcId)) return npcConfigCache.get(npcId);
    try {
      const rows = await db.select({
        name: schema.npcs.name,
        openclawConfig: schema.npcs.openclawConfig,
        channelId: schema.npcs.channelId,
      }).from(schema.npcs).where(eq(schema.npcs.id, npcId));
      if (rows.length === 0) return null;
      const r = rows[0];
      const openclawConfig = parseJson(r.openclawConfig);
      const config = { ...openclawConfig, _channelId: r.channelId, _name: r.name };
      // nanobot mode: NPC id doubles as agent id (no OpenClaw agents.create step).
      if (isNanobotProvider()) {
        config.agentId = npcId;
      }
      npcConfigCache.set(npcId, config);
      return config;
    } catch (err) {
      console.error("[npc] DB error:", err);
      return null;
    }
  }

  function decryptGatewayToken(payload) {
    const crypto = require("node:crypto");
    const secret = process.env.INTERNAL_RPC_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("Missing JWT_SECRET for gateway token decryption");
    const key = crypto.createHash("sha256").update(secret).digest();
    const [version, ivB64, tagB64, encryptedB64] = payload.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !encryptedB64) {
      throw new Error("Invalid gateway token payload");
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedB64, "base64url")), decipher.final()]).toString("utf8");
  }

  async function getOrConnectGateway(channelId) {
    if (isNanobotProvider()) {
      return createNanobotAdapter({ db, schema, eq, and });
    }

    if (channelGateways.has(channelId)) {
      const gw = channelGateways.get(channelId);
      if (gw.isConnected()) return gw;
      gw.disconnect();
      channelGateways.delete(channelId);
    }

    try {
      const bindings = await db
        .select({ gatewayId: schema.channelGatewayBindings.gatewayId })
        .from(schema.channelGatewayBindings)
        .where(eq(schema.channelGatewayBindings.channelId, channelId))
        .limit(1);

      if (!bindings.length) return null;

      const [resource] = await db
        .select({ baseUrl: schema.gatewayResources.baseUrl, tokenEncrypted: schema.gatewayResources.tokenEncrypted })
        .from(schema.gatewayResources)
        .where(eq(schema.gatewayResources.id, bindings[0].gatewayId))
        .limit(1);

      if (!resource?.baseUrl || !resource?.tokenEncrypted) return null;

      const token = decryptGatewayToken(resource.tokenEncrypted);
      const gateway = new OpenClawGateway();
      await gateway.connect(resource.baseUrl, token);
      channelGateways.set(channelId, gateway);
      return gateway;
    } catch (err) {
      console.error(`[gateway] Failed to connect for channel ${channelId.slice(0, 8)}:`, err.message);
      return null;
    }
  }

  async function streamNpcResponse(socket, npcId, npcConfig, userId, message, sessionKeyOverride, responseEvent) {
    const agentId = npcConfig.agentId || npcConfig.agent_id || null;
    const eventName = responseEvent || "npc:response";
    if (!agentId) {
      socket.emit(eventName, { npcId, chunk: "[This NPC has no AI agent connected]", done: true });
      return "";
    }

    const channelId = npcConfig._channelId;
    const gateway = channelId ? await getOrConnectGateway(channelId) : null;
    if (!gateway) {
      socket.emit(eventName, { npcId, chunk: "[Gateway not connected]", done: true });
      return "";
    }

    const sessionKey = sessionKeyOverride || `${npcConfig.sessionKeyPrefix || npcId}-dm-${userId}`;

    const pendKey = pendingNpcChatKey(socket.id, npcId);
    pendingNpcChats.set(pendKey, { gateway, agentId, sessionKey });

    try {
      const response = await gateway.chatSend(agentId, sessionKey, message, (delta) => {
        socket.emit(eventName, { npcId, chunk: delta, done: false });
      });
      socket.emit(eventName, { npcId, chunk: "", done: true });
      return response;
    } catch (err) {
      console.error("[npc] Chat error:", err.message);
      socket.emit(eventName, { npcId, chunk: "[AI Gateway error]", done: true });
      return "";
    } finally {
      pendingNpcChats.delete(pendKey);
    }
  }

  async function generateMeetingSummary(gateway, agentId, sessionKeyPrefix, meetingId, topic, transcript) {
    const summaryPrompt = `다음 회의 내용을 분석하여 JSON으로 응답하세요.

회의 주제: ${topic}

${transcript}

응답 형식 (JSON만, 다른 텍스트 없이):
{
  "keyTopics": ["주제1", "주제2", "주제3"],
  "conclusions": "결론 요약 2-3문장"
}`;

    try {
      const sessionKey = `${sessionKeyPrefix}-summary-${meetingId}`;
      const response = await Promise.race([
        gateway.chatSend(agentId, sessionKey, summaryPrompt, () => {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Summary timeout")), 60000)),
      ]);
      const text = response || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
          conclusions: typeof parsed.conclusions === "string" ? parsed.conclusions : null,
        };
      }
      return { keyTopics: [], conclusions: null };
    } catch (err) {
      console.warn("[meeting] Summary generation failed:", err.message);
      return { keyTopics: [], conclusions: null };
    }
  }

  async function getNpcConfigsForChannel(channelId) {
    try {
      const rows = await db.select({
        id: schema.npcs.id,
        name: schema.npcs.name,
        openclawConfig: schema.npcs.openclawConfig,
      }).from(schema.npcs).where(eq(schema.npcs.channelId, channelId));
      const nanobotMode = isNanobotProvider();
      return rows.map(r => {
        const config = parseJson(r.openclawConfig) || {};
        return {
          id: r.id,
          name: r.name,
          agentId: nanobotMode ? r.id : (config.agentId || config.agent_id || null),
          sessionKeyPrefix: config.sessionKeyPrefix || config.session_key_prefix || "",
          role: "Participant",
          passPolicy: config.passPolicy || null,
        };
      });
    } catch (err) {
      console.error("[meeting] Failed to load NPCs:", err);
      return [];
    }
  }

  function isMeetingController(channelId, userId) {
    return discussionInitiators.get(channelId) === userId
        || channelOwners.get(channelId) === userId;
  }

  io.on("connection", async (socket) => {
    const user = await authenticateSocket(socket);
    if (!user) { socket.disconnect(true); return; }

    socket.on("player:join", async (data) => {
      try {
        const memberRows = await db.select({ role: schema.channelMembers.role })
          .from(schema.channelMembers)
          .where(and(eq(schema.channelMembers.channelId, data.mapId), eq(schema.channelMembers.userId, user.userId)));
        if (memberRows.length === 0) {
          socket.emit("join-error", { error: "Not a member of this channel" });
          return;
        }
      } catch (err) {
        console.error("[socket] Membership check failed:", err);
      }

      try {
        const ownerRows = await db.select({ ownerId: schema.channels.ownerId })
          .from(schema.channels).where(eq(schema.channels.id, data.mapId));
        if (ownerRows.length > 0) {
          channelOwners.set(data.mapId, ownerRows[0].ownerId);
        }
        getOrConnectGateway(data.mapId).catch(() => {});
      } catch (err) {
        console.error("[socket] Channel cache failed:", err);
      }

      const prevSocketId = userSockets.get(user.userId);
      if (prevSocketId && prevSocketId !== socket.id) {
        const prevSocket = io.sockets.sockets.get(prevSocketId);
        if (prevSocket) {
          prevSocket.emit("session:kicked", { reason: "다른 위치에서 접속하여 현재 세션이 종료되었습니다." });
          prevSocket.disconnect(true);
        }
        players.delete(prevSocketId);
      }

      const playerState = {
        id: socket.id, userId: user.userId,
        characterId: data.characterId, characterName: data.characterName,
        appearance: data.appearance, mapId: data.mapId,
        x: data.x, y: data.y, direction: "down", animation: "idle",
      };
      players.set(socket.id, playerState);
      userSockets.set(user.userId, socket.id);
      socket.join(data.mapId);
      const mapPlayers = Array.from(players.values()).filter(p => p.mapId === data.mapId && p.id !== socket.id);
      socket.emit("players:state", { players: mapPlayers });
      
      const channelHistory = channelChatHistory.get(data.mapId);
      if (channelHistory && channelHistory.length > 0) {
        socket.emit("chat:history", { messages: channelHistory });
      }
      await deliverPendingReportsToSocket(socket, user.userId, data.mapId);
      socket.to(data.mapId).emit("player:joined", playerState);
    });

    socket.on("player:move", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      Object.assign(player, { x: data.x, y: data.y, direction: data.direction, animation: data.animation });
      socket.to(player.mapId).emit("player:moved", { id: socket.id, ...data });
    });

    socket.on("npc:chat", async (data) => {
      const { npcId, message } = data || {};
      if (!npcId || !message) return;
      const trimmed = String(message).trim().slice(0, 500);
      if (!trimmed) return;
      const now = Date.now();
      if (now - (lastChatTime.get(socket.id) || 0) < CHAT_COOLDOWN_MS) {
        socket.emit("npc:response", { npcId, chunk: "[Wait before sending.]", done: true });
        return;
      }
      lastChatTime.set(socket.id, now);
      const npcConfig = await getNpcConfig(npcId);
      if (!npcConfig) { socket.emit("npc:response", { npcId, chunk: "[NPC not found]", done: true }); return; }
      const player = players.get(socket.id);
      const characterId = player?.characterId || null;
      if (characterId) {
        await chatHistory.appendMessage(characterId, npcId, "player", trimmed);
      }
      const messageToSend = withTaskReminder(trimmed, getSocketLocale(socket));
      const response = await streamNpcResponse(socket, npcId, npcConfig, user.userId, messageToSend);
      if (response) {
        if (characterId) {
          await chatHistory.appendMessage(characterId, npcId, "npc", response);
        }

        const parsed = parseNpcResponse(response);
        if (parsed.tasks.length > 0 && player?.characterId) {
          await processNpcTaskActions(parsed, {
            channelId: npcConfig._channelId,
            npcId,
            npcName: npcConfig._name,
            assignerCharacterId: player.characterId,
            targetUserId: player.userId,
          });
        } else if (parsed.tasks.length > 0) {
          console.warn("[TaskManager] No characterId for socket", socket.id);
        }

        socket.emit("npc:response-complete", { npcId, npcName: npcConfig._name || npcId });
      }
    });

    socket.on("task:list", async ({ channelId, npcId }) => {
      try {
        const tasks = npcId
          ? await taskManager.getTasksByNpc(npcId)
          : await taskManager.getTasksByChannel(channelId);
        socket.emit("task:list-response", { tasks, npcId: npcId || null });
      } catch (err) {
        console.error("[TaskManager] Error fetching tasks:", err);
        socket.emit("task:list-response", { tasks: [], npcId: npcId || null });
      }
    });

    socket.on("task:create", async ({ channelId, title, summary, npcId }) => {
      try {
        const player = players.get(socket.id);
        if (!player) return;

        if (!channelId || typeof channelId !== "string") return;
        if (typeof title !== "string") return;

        const trimmedTitle = title.trim().slice(0, 200);
        if (!trimmedTitle) return;
        const trimmedSummary = typeof summary === "string" ? summary.trim() : null;

        let task = await taskManager.createBacklogTask(channelId, player.characterId, trimmedTitle, trimmedSummary);
        if (npcId) {
          task = await taskManager.moveTask(task.id, player.mapId, "pending", npcId);
        }

        if (task) {
          io.to(player.mapId).emit("task:updated", { task, action: "create" });
        }
      } catch (err) {
        console.error("[TaskManager] Error creating task:", err);
      }
    });

    socket.on("task:move", async ({ taskId, toStatus, npcId }) => {
      try {
        const player = players.get(socket.id);
        if (!player || !taskId || !toStatus) return;

        const allowedStatuses = ["backlog", "pending", "in_progress", "stalled", "complete", "cancelled"];
        if (!allowedStatuses.includes(toStatus)) return;

        const movedTask = await taskManager.moveTask(taskId, player.mapId, toStatus, npcId || null);
        if (!movedTask) return;

        const fromStatus = movedTask._fromStatus;
        const { _fromStatus, ...task } = movedTask;
        io.to(player.mapId).emit("task:updated", { task, action: `move_${fromStatus}_${toStatus}` });

        if (
          toStatus === "in_progress" &&
          (fromStatus === "backlog" || fromStatus === "pending") &&
          task.npcId
        ) {
          const npcConfig = await getNpcConfig(task.npcId);
          if (npcConfig) {
            const locale = getSocketLocale(socket);
            const taskSessionPrompt = buildTaskSessionPrompt({
              ...task,
              summary: task.summary || "",
              createdAt: task.createdAt || "",
            }, locale);
            const autoStartMessage = withTaskReminder(`${task.title} 업무를 시작합니다.`, locale);
            const messageToSend = `${taskSessionPrompt}\n\n${autoStartMessage}`;
            const sessionKey = `${npcConfig.sessionKeyPrefix || task.npcId}-task-${task.npcTaskId}`;

            const response = await streamNpcResponse(
              socket,
              task.npcId,
              npcConfig,
              player.userId,
              messageToSend,
              sessionKey,
              "npc:task-response",
            );

            if (response) {
              const parsed = parseNpcResponse(response);
              await processNpcTaskActions(parsed, {
                channelId: player.mapId,
                npcId: task.npcId,
                npcName: npcConfig._name,
                assignerCharacterId: player.characterId,
                targetUserId: player.userId,
              });
              socket.emit("npc:response-complete", {
                npcId: task.npcId,
                npcName: npcConfig._name || task.npcId,
              });
            }
          }
        }
      } catch (err) {
        console.error("[TaskManager] Error moving task:", err);
        if (err instanceof Error && err.message.includes("npcId required")) {
          socket.emit("task:move-error", { error: "npcId_required" });
        }
      }
    });

    socket.on("task:delete", async ({ taskId }) => {
      try {
        const player = players.get(socket.id);
        if (!player) return;
        const deleted = await taskManager.deleteTask(taskId, player.mapId);
        if (deleted) {
          io.to(player.mapId).emit("task:deleted", { taskId });
        }
      } catch (err) {
        console.error("[TaskManager] Error deleting task:", err);
      }
    });

    socket.on("task:request-report", async ({ taskId }) => {
      try {
        const player = players.get(socket.id);
        if (!player || !taskId) return;

        const task = await taskManager.getTaskById(taskId, player.mapId);
        if (!task) return;
        if (task.status === "complete" || task.status === "cancelled") return;

        let runnableTask = task;
        if (task.status === "stalled") {
          const resumedTask = await taskManager.resumeTask(task.id, player.mapId);
          if (!resumedTask) return;
          io.to(player.mapId).emit("task:updated", { task: resumedTask, action: "resume" });
          runnableTask = resumedTask;
        }

        await appendNpcHistoryMessageForUser(
          player.userId,
          player.characterId,
          player.mapId,
          runnableTask.npcId,
          buildTaskActionStartMessage({ title: runnableTask.title }, "request-report"),
        );

        await runProgressNudgeForTask(runnableTask, buildManualTaskReportPrompt({
          title: runnableTask.title,
          summary: runnableTask.summary,
          npcTaskId: runnableTask.npcTaskId,
          status: runnableTask.status,
        }), "manual");
      } catch (err) {
        console.error("[TaskManager] Error requesting task report:", err);
      }
    });

    socket.on("task:get-report", async ({ taskId }) => {
      try {
        const player = players.get(socket.id);
        if (!player || !taskId) return;

        const reports = await getReportsByTaskId(db, reportSchema, taskId);
        const lastReport = reports.length > 0 ? reports[reports.length - 1] : null;
        socket.emit("task:report", {
          taskId,
          message: lastReport?.message || null,
          kind: lastReport?.kind || null,
          createdAt: lastReport?.createdAt || null,
        });
      } catch (err) {
        console.error("[TaskManager] Error getting task report:", err);
        socket.emit("task:report", { taskId, message: null, kind: null, createdAt: null });
      }
    });

    socket.on("task:resume", async ({ taskId }) => {
      try {
        const player = players.get(socket.id);
        if (!player || !taskId) return;

        const resumedTask = await taskManager.resumeTask(taskId, player.mapId);
        if (resumedTask) {
          io.to(player.mapId).emit("task:updated", { task: resumedTask, action: "resume" });

          await appendNpcHistoryMessageForUser(
            player.userId,
            player.characterId,
            player.mapId,
            resumedTask.npcId,
            buildTaskActionStartMessage({ title: resumedTask.title }, "resume"),
          );

          await runProgressNudgeForTask(resumedTask, buildResumeTaskExecutionPrompt({
            title: resumedTask.title,
            summary: resumedTask.summary,
            npcTaskId: resumedTask.npcTaskId,
          }), "resume");
        }
      } catch (err) {
        console.error("[TaskManager] Error resuming task:", err);
      }
    });

    socket.on("task:complete", async ({ taskId }) => {
      try {
        const player = players.get(socket.id);
        if (!player || !taskId) return;

        const completedTask = await taskManager.completeTask(taskId, player.mapId);
        if (completedTask) {
          io.to(player.mapId).emit("task:updated", { task: completedTask, action: "complete_manual" });
        }
      } catch (err) {
        console.error("[TaskManager] Error completing task:", err);
      }
    });

    socket.on("npc:history", async ({ npcId }) => {
      const player = players.get(socket.id);
      if (!player || !npcId || !player.characterId) {
        socket.emit("npc:history", { npcId, messages: [] });
        return;
      }
      const history = await chatHistory.loadHistory(player.characterId, npcId);
      socket.emit("npc:history", { npcId, messages: history });
    });

    socket.on("npc:reset-chat", async ({ npcId }) => {
      const player = players.get(socket.id);
      if (!player || !npcId || !player.characterId) return;
      await chatHistory.resetHistory(player.characterId, npcId);
    });

    socket.on("chat:abort", async ({ npcId }) => {
      if (!npcId) return;
      const pendKey = pendingNpcChatKey(socket.id, npcId);
      const entry = pendingNpcChats.get(pendKey);
      if (!entry || !entry.gateway || typeof entry.gateway.chatAbort !== "function") return;
      try {
        await entry.gateway.chatAbort(entry.agentId, entry.sessionKey);
        socket.emit("npc:response-complete", { npcId, aborted: true });
      } catch (err) {
        console.error("[npc:abort] chatAbort failed for", npcId, ":", err && err.message);
      } finally {
        pendingNpcChats.delete(pendKey);
      }
    });

    socket.on("npc:report-consumed", async ({ reportId }) => {
      if (!reportId) return;
      try {
        await markReportConsumed(db, reportSchema, reportId);
      } catch (err) {
        console.error("[task-reporting] Error marking report consumed:", err);
      }
    });

    registerMeetingSocketHandlers({
      io,
      socket,
      deps: {
        meetingRooms,
        players,
        lastChatTime,
        chatCooldownMs: CHAT_COOLDOWN_MS,
        user,
        getParticipationAccess: getSocketChannelParticipationAccess,
        emitChannelAccessDenied,
        storeMeetingFallbackPlayer: true,
        onMeetingChat: ({ channelId, message, player }) => {
          const broker = activeBrokers.get(channelId);
          if (broker && broker.isRunning()) {
            const userName = player?.characterName || user.nickname;
            broker.addUserMessage(userName, message);
          }
        },
      },
    });

    registerMeetingDiscussionHandlers({
      io,
      socket,
      deps: {
        activeBrokers,
        discussionInitiators,
        meetingRooms,
        players,
        user,
        getOrConnectGateway,
        getNpcConfigsForChannel,
        canControlMeeting: isMeetingController,
        createMeetingBroker: (config, callbacks) => new MeetingBroker(config, callbacks),
        generateMeetingSummary,
        persistMeetingMinutes: async (input) => {
          try {
            const [minutesRow] = await db.insert(schema.meetingMinutes).values({
              channelId: input.channelId,
              topic: input.topic,
              transcript: input.transcript,
              participants: JSON.stringify(input.participants),
              totalTurns: input.totalTurns,
              durationSeconds: input.durationSeconds || null,
              initiatorId: input.initiatorId,
              keyTopics: JSON.stringify(input.keyTopics),
              conclusions: input.conclusions,
            }).returning();
            return minutesRow?.id ?? null;
          } catch (err) {
            console.error("[meeting] Failed to save minutes:", err.message);
            return null;
          }
        },
      },
    });

    socket.on("npc:call", ({ channelId, npcId }) => {
      if (!channelId || !npcId) return;
      const player = players.get(socket.id);
      if (!player) return;
      io.to(channelId).emit("npc:come-to-player", {
        npcId,
        targetPlayerId: socket.id,
      });
    });

    socket.on("npc:return-home", ({ channelId, npcId }) => {
      if (!channelId || !npcId) return;
      io.to(channelId).emit("npc:returning", { npcId });
    });

    socket.on("npc:position-update", ({ channelId, npcId, x, y, direction }) => {
      if (!channelId || !npcId) return;
      socket.to(channelId).emit("npc:position-sync", { npcId, x, y, direction });
    });

    socket.on("npc:arrived", ({ channelId, npcId }) => {
      if (!channelId || !npcId) return;
      socket.to(channelId).emit("npc:stop-moving", { npcId });
    });

    socket.on("chat:send", ({ message }) => {
      const player = players.get(socket.id);
      if (!player) return;
      const trimmed = String(message || "").trim().slice(0, 500);
      if (!trimmed) return;
      const now = Date.now();
      if (now - (lastChatTime.get(socket.id) || 0) < CHAT_COOLDOWN_MS) return;
      lastChatTime.set(socket.id, now);

      const chatMessage = {
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: player.characterName || user.nickname,
        senderId: socket.id,
        content: trimmed,
        timestamp: now,
      };
      const history = channelChatHistory.get(player.mapId) || [];
      history.push(chatMessage);
      channelChatHistory.set(player.mapId, history);
      io.to(player.mapId).emit("chat:message", chatMessage);
    });

    socket.on("npc:broadcast-add", (npcData) => {
      const player = players.get(socket.id);
      if (!player) return;
      socket.to(player.mapId).emit("npc:added", npcData);
      npcConfigCache.delete(npcData.id);
    });

    socket.on("npc:broadcast-update", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      socket.to(player.mapId).emit("npc:updated", data);
      if (data.npcId) npcConfigCache.delete(data.npcId);
    });

    socket.on("npc:broadcast-remove", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      socket.to(player.mapId).emit("npc:removed", data);
      if (data.npcId) npcConfigCache.delete(data.npcId);
    });

    socket.on("map:object-add", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (channelOwners.get(player.mapId) !== user.userId) return;
      socket.to(player.mapId).emit("map:object-added", data);
    });

    socket.on("map:object-remove", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (channelOwners.get(player.mapId) !== user.userId) return;
      socket.to(player.mapId).emit("map:object-removed", data);
    });

    socket.on("map:tiles-update", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (channelOwners.get(player.mapId) !== user.userId) return;
      socket.to(player.mapId).emit("map:tiles-updated", data);
    });

    socket.on("disconnect", () => {
      const player = players.get(socket.id);
      if (player) {
        socket.to(player.mapId).emit("player:left", { id: socket.id });
        players.delete(socket.id);
        if (userSockets.get(user.userId) === socket.id) {
          userSockets.delete(user.userId);
        }

        const leftChannelId = player.mapId;
        if (leftChannelId) {
          const remaining = Array.from(players.values()).filter(p => p.mapId === leftChannelId);
          if (remaining.length === 0) {
            const gw = channelGateways.get(leftChannelId);
            if (gw) {
              gw.disconnect();
              channelGateways.delete(leftChannelId);
            }
          }
        }
      }
      
      for (const [chId, room] of meetingRooms.entries()) {
        if (room.participants.has(socket.id)) {
          room.participants.delete(socket.id);
          socket.to(`meeting-${chId}`).emit("meeting:participant-left", { id: socket.id });
        }
      }
      
      for (const [chId, broker] of activeBrokers.entries()) {
        const room = meetingRooms.get(chId);
        if (room && room.participants.size === 0) {
          broker.stop();
          activeBrokers.delete(chId);
        }
      }
      lastChatTime.delete(socket.id);
    });
  });

  // 4. Internal HTTP 엔드포인트 통합 (Express Middleware)
  // body-parser를 사용하여 req.body로 파싱합니다.
  expressApp.use("/_internal", express.json());
  
  expressApp.all("/_internal/*", async (req, res) => {
    // 공통 권한 검사
    if (!isInternalRequestAuthorized(req.headers)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    // POST /_internal/rpc
    if (req.method === "POST" && req.path === "/_internal/rpc") {
      try {
        const { channelId, method, params } = req.body || {};
        const gateway = await getOrConnectGateway(channelId);
        if (!gateway) {
          return res.status(503).json({ ok: false, error: "Gateway not connected" });
        }
        const result = await gateway._rpcRequest(method, params || {});
        return res.status(200).json({ ok: true, result });
      } catch (err) {
        const status = getGatewayErrorStatus(err, 500);
        return res.status(status).json(buildGatewayErrorPayload(err));
      }
    }

    // POST /_internal/emit
    if (req.method === "POST" && req.path === "/_internal/emit") {
      try {
        const { event, room, targetUserId, payload } = req.body || {};

        if (event === "gateway:config-updated" && payload?.channelId) {
          const gw = channelGateways.get(payload.channelId);
          if (gw) {
            gw.disconnect();
            channelGateways.delete(payload.channelId);
          }
        }

        if (targetUserId) {
          const socketId = userSockets.get(targetUserId);
          if (socketId) {
            io.to(socketId).emit(event, payload);
            if (event === "member:kicked" && payload?.channelId) {
              const targetSocket = io.sockets.sockets.get(socketId);
              if (targetSocket) {
                targetSocket.leave(payload.channelId);
              }
            }
          }
        } else if (room) {
          io.to(room).emit(event, payload);
        } else {
          io.emit(event, payload);
        }

        return res.status(200).json({ ok: true });
      } catch {
        return res.status(400).json({ error: "Invalid request" });
      }
    }

    // GET /_internal/room-members?channelId=X
    if (req.method === "GET" && req.path === "/_internal/room-members") {
      const channelId = req.query.channelId;

      if (!channelId) {
        return res.status(400).json({ error: "channelId required" });
      }

      const roomSockets = io.sockets.adapter.rooms.get(channelId);
      const userIds = [];

      if (roomSockets) {
        for (const socketId of roomSockets) {
          const player = players.get(socketId);
          if (player && player.userId) {
            userIds.push(player.userId);
          }
        }
      }

      return res.status(200).json({ userIds });
    }

    return res.status(404).json({ error: "Not found" });
  });

  // 5. Fallback Route: 나머지 모든 요청을 Next.js 핸들러로 전달
  expressApp.all("*", (req, res) => handle(req, res));

  // 6. 단일 포트로 서버 실행
  httpServer.listen(currentPort, hostname, () => {
    console.log(`> Ready on http://${hostname}:${currentPort} (dev: ${isDev})`);
  });
}

main().catch(err => { console.error(err); process.exit(1); });