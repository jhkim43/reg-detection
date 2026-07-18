// seed-v10 AC-001 / T-V07 — Logic Layer: nanobot task lifecycle event handler.
//
// nanobot agent loop의 tool execution event(create/update/complete/cancel)를
// deskrpg tasks 테이블에 반영하고 socket.io broadcast 트리거를 위임한다.
//
// 권한: channel.ownerId == ownerUserId 매칭 (D-31: channel owner 모델만 인정).
// 멱등: (npcId, npcTaskId) 복합 키로 onConflictDoUpdate.
// Socket emit은 deps.emit으로 inject — route layer가 _internal/emit forward 담당.

import { and, eq } from "drizzle-orm";
import { db as defaultDb, channels, npcs, tasks, isPostgres } from "@/db";

// PG timestamptz는 Date 객체, SQLite text는 ISO string을 기대.
// drizzle ORM의 dialect 차이를 흡수하는 단일 헬퍼.
function nowForDb(): Date {
  return (isPostgres ? new Date() : new Date().toISOString()) as unknown as Date;
}

export type TaskAction = "create" | "update" | "complete" | "cancel";
// deskrpg TaskBoard 기존 enum과 정합. "complete"는 단수형(과거형 "completed" 아님).
export type TaskStatus = "backlog" | "in_progress" | "complete" | "cancelled";

export type TaskMetadata = {
  started_at?: string;
  progressing_at?: string;
  completed_at?: string;
  error_message?: string;
  partial_result_summary?: string;
};

export type TaskEventInput = {
  channelId: string;
  npcId: string;
  npcTaskId: string;
  title: string;
  summary?: string | null;
  status: TaskStatus;
  action: TaskAction;
  assignerCharacterId: string;
  ownerUserId: string;
  metadata?: TaskMetadata;
};

export type TaskEventPayload = {
  taskId: string;
  npcId: string;
  npcTaskId: string;
  status: TaskStatus;
  action: TaskAction;
};

export type TaskEventOk = {
  ok: true;
  statusCode: 200 | 201;
  task: {
    id: string;
    status: string;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
};

export type TaskEventErr = {
  ok: false;
  statusCode: 400 | 403 | 404 | 409 | 500;
  errorCode:
    | "missing_required_field"
    | "forbidden_channel"
    | "channel_not_found"
    | "npc_not_found"
    | "task_not_found"
    | "task_id_conflict"
    | "internal_error";
  field?: string;
  existingStatus?: string;
};

export type TaskEventResult = TaskEventOk | TaskEventErr;

export type TaskEmit = (channelId: string, payload: TaskEventPayload) => void | Promise<void>;

export type TaskEventDeps = {
  emit: TaskEmit;
  db?: typeof defaultDb;
};

const REQUIRED_FIELDS: Array<keyof TaskEventInput> = [
  "channelId",
  "npcId",
  "npcTaskId",
  "title",
  "status",
  "action",
  "ownerUserId",
];

const REQUIRED_FIELDS_CREATE: Array<keyof TaskEventInput> = [
  ...REQUIRED_FIELDS,
  "assignerCharacterId",
];

function validateRequired(input: TaskEventInput): TaskEventErr | null {
  const fields = input.action === "create" ? REQUIRED_FIELDS_CREATE : REQUIRED_FIELDS;
  for (const field of fields) {
    const value = input[field];
    if (value == null || (typeof value === "string" && value.trim() === "")) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "missing_required_field",
        field: String(field),
      };
    }
  }
  return null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function handleTaskEvent(
  input: TaskEventInput,
  deps: TaskEventDeps,
): Promise<TaskEventResult> {
  const validationError = validateRequired(input);
  if (validationError) return validationError;

  const dbHandle = deps.db ?? defaultDb;

  const [channel] = await dbHandle
    .select({ id: channels.id, ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);
  if (!channel) {
    return { ok: false, statusCode: 404, errorCode: "channel_not_found" };
  }
  if (channel.ownerId !== input.ownerUserId) {
    return { ok: false, statusCode: 403, errorCode: "forbidden_channel" };
  }

  const [npc] = await dbHandle
    .select({ id: npcs.id, name: npcs.name })
    .from(npcs)
    .where(eq(npcs.id, input.npcId))
    .limit(1);
  if (!npc) {
    return { ok: false, statusCode: 404, errorCode: "npc_not_found" };
  }

  if (input.action === "create") {
    return runCreate(input, dbHandle, deps.emit, npc.name);
  }
  return runMutation(input, dbHandle, deps.emit);
}

async function runCreate(
  input: TaskEventInput,
  dbHandle: typeof defaultDb,
  emit: TaskEmit,
  npcName: string,
): Promise<TaskEventResult> {
  const now = nowForDb();
  const completedAt = input.action === "create" && input.status === "complete" ? now : null;

  const [row] = await dbHandle
    .insert(tasks)
    .values({
      channelId: input.channelId,
      npcId: input.npcId,
      npcNameSnapshot: npcName,
      assignerId: input.assignerCharacterId,
      npcTaskId: input.npcTaskId,
      title: input.title,
      summary: input.summary ?? null,
      status: input.status,
      createdAt: now,
      updatedAt: now,
      completedAt,
    })
    .onConflictDoUpdate({
      target: [tasks.npcId, tasks.npcTaskId],
      set: {
        title: input.title,
        summary: input.summary ?? null,
        status: input.status,
        npcNameSnapshot: npcName,
        updatedAt: now,
      },
    })
    .returning({
      id: tasks.id,
      status: tasks.status,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    });

  await safeEmit(emit, input.channelId, {
    taskId: row.id,
    npcId: input.npcId,
    npcTaskId: input.npcTaskId,
    status: input.status,
    action: input.action,
  });

  return {
    ok: true,
    statusCode: 201,
    task: {
      id: row.id,
      status: row.status,
      createdAt: toIso(row.createdAt as Date | string | null),
      updatedAt: toIso(row.updatedAt as Date | string | null),
    },
  };
}

async function runMutation(
  input: TaskEventInput,
  dbHandle: typeof defaultDb,
  emit: TaskEmit,
): Promise<TaskEventResult> {
  const now = nowForDb();
  const nextStatus: TaskStatus =
    input.action === "complete"
      ? "complete"
      : input.action === "cancel"
        ? "cancelled"
        : input.status;
  const completedAt =
    input.action === "complete" || input.action === "cancel" ? now : undefined;

  const updateSet: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: now,
  };
  if (typeof input.summary === "string") updateSet.summary = input.summary;
  if (completedAt) updateSet.completedAt = completedAt;

  const [row] = await dbHandle
    .update(tasks)
    .set(updateSet)
    .where(and(eq(tasks.npcId, input.npcId), eq(tasks.npcTaskId, input.npcTaskId)))
    .returning({
      id: tasks.id,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
    });

  if (!row) {
    return { ok: false, statusCode: 404, errorCode: "task_not_found" };
  }

  await safeEmit(emit, input.channelId, {
    taskId: row.id,
    npcId: input.npcId,
    npcTaskId: input.npcTaskId,
    status: nextStatus,
    action: input.action,
  });

  return {
    ok: true,
    statusCode: 200,
    task: {
      id: row.id,
      status: row.status,
      updatedAt: toIso(row.updatedAt as Date | string | null),
    },
  };
}

async function safeEmit(emit: TaskEmit, channelId: string, payload: TaskEventPayload): Promise<void> {
  try {
    await emit(channelId, payload);
  } catch (err) {
    console.warn("[internal-task-handler] socket emit failed:", err);
  }
}
