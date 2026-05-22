// T-F03 — nanobot-session-recorder의 3개 helper가 schema 호출을 올바른 모양으로
// 만들고, db dep이 누락되거나 throw해도 silent하게 처리하는지 검증.

import test from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const recorder = require("./nanobot-session-recorder.js") as {
  recordSessionStart: (deps: unknown, npcId: string, sessionKey: string, timeoutMs: number) => Promise<void>;
  recordChunkArrival: (deps: unknown, npcId: string, sessionKey: string) => Promise<void>;
  recordSessionAbort: (deps: unknown, npcId: string, sessionKey: string) => Promise<void>;
};

type Insert = { values: Record<string, unknown> | null; conflict: unknown };
type Update = { set: Record<string, unknown> | null; where: unknown };

function makeMockDeps() {
  const inserts: Insert[] = [];
  const updates: Update[] = [];
  const sessionsTable = {
    agentId: { name: "agent_id" },
    sessionKey: { name: "session_key" },
  };
  return {
    inserts,
    updates,
    deps: {
      db: {
        insert: () => {
          const pending: Insert = { values: null, conflict: null };
          return {
            values(v: Record<string, unknown>) { pending.values = v; return this; },
            async onConflictDoUpdate(opts: unknown) { pending.conflict = opts; inserts.push(pending); },
          };
        },
        update: () => {
          const pending: Update = { set: null, where: null };
          return {
            set(s: Record<string, unknown>) { pending.set = s; return this; },
            async where(w: unknown) { pending.where = w; updates.push(pending); },
          };
        },
      },
      schema: { nanobotAgentSessions: sessionsTable },
      eq: (col: { name: string }, val: unknown) => ({ op: "eq", col: col.name, val }),
      and: (...conds: unknown[]) => ({ op: "and", conds }),
    },
  };
}

test("recordSessionStart upserts with agentId/sessionKey/timeoutMs", async () => {
  const { deps, inserts } = makeMockDeps();
  await recorder.recordSessionStart(deps, "npc-1", "agent:npc-1:s1", 180000);
  assert.equal(inserts.length, 1);
  const v = inserts[0].values as Record<string, unknown>;
  assert.equal(v.agentId, "npc-1");
  assert.equal(v.sessionKey, "agent:npc-1:s1");
  assert.equal(v.timeoutMs, 180000);
  assert.ok(v.startedAt instanceof Date);
  assert.ok(inserts[0].conflict, "must use onConflictDoUpdate for idempotency");
});

test("recordChunkArrival updates lastChunkAt with eq(agentId) AND eq(sessionKey)", async () => {
  const { deps, updates } = makeMockDeps();
  await recorder.recordChunkArrival(deps, "npc-1", "agent:npc-1:s1");
  assert.equal(updates.length, 1);
  const setObj = updates[0].set as Record<string, unknown>;
  assert.ok(setObj.lastChunkAt instanceof Date);
  const where = updates[0].where as { op: string; conds: Array<{ col: string; val: unknown }> };
  assert.equal(where.op, "and");
  const cols = where.conds.map((c) => c.col).sort();
  assert.deepEqual(cols, ["agent_id", "session_key"]);
});

test("recordSessionAbort updates abortedAt to a Date", async () => {
  const { deps, updates } = makeMockDeps();
  await recorder.recordSessionAbort(deps, "npc-1", "agent:npc-1:s1");
  assert.equal(updates.length, 1);
  const setObj = updates[0].set as Record<string, unknown>;
  assert.ok(setObj.abortedAt instanceof Date);
});

test("silent no-op when deps is undefined / db is missing", async () => {
  // 어느 것도 throw 하지 않아야 한다.
  await recorder.recordSessionStart(undefined, "a", "b", 1);
  await recorder.recordChunkArrival(null, "a", "b");
  await recorder.recordSessionAbort({}, "a", "b");
  await recorder.recordSessionStart({ db: null }, "a", "b", 1);
  await recorder.recordChunkArrival({ db: {}, schema: {} }, "a", "b");
});

test("silent no-op when db.insert throws (chat flow must not break)", async () => {
  const deps = {
    db: { insert: () => { throw new Error("boom"); } },
    schema: { nanobotAgentSessions: { agentId: { name: "a" }, sessionKey: { name: "s" } } },
    eq: () => ({}),
    and: () => ({}),
  };
  await recorder.recordSessionStart(deps, "npc-1", "s1", 180000);
  // should not throw
});

test("recordChunkArrival/Abort no-op when eq or and is missing", async () => {
  const deps = {
    db: { update: () => ({ set() { return this; }, async where() { /* should never reach */ throw new Error("reached"); } }) },
    schema: { nanobotAgentSessions: { agentId: { name: "a" }, sessionKey: { name: "s" } } },
    // eq + and 누락
  };
  await recorder.recordChunkArrival(deps, "n", "s");
  await recorder.recordSessionAbort(deps, "n", "s");
});
