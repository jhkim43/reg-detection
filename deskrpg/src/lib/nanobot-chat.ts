import { eq } from "drizzle-orm";

import { db, npcs } from "@/db";
import { parseDbObject } from "@/lib/db-json";
import type { OpenClawAttachment } from "@/lib/file-extractor";

import {
  type ChatMessage,
  nanobotChat,
  nanobotChatStream,
} from "./nanobot-api-client";

// History is retained on the nanobot session (session_id) — client no longer
// forwards prior turns. The HistoryEntry shape is kept so callers can keep
// passing `history` without breaking, but it is ignored by the chat path.
export type HistoryEntry = {
  role: "player" | "npc";
  content: string;
  timestamp: number;
};

export type NanobotChatInput = {
  npcId: string;
  npcName: string;
  message: string;
  history?: HistoryEntry[];
  attachments?: OpenClawAttachment[];
  systemPromptOverride?: string;
  onDelta?: (delta: string) => void;
  sessionId?: string;
};

function loadPersonaFromNpc(openclawConfig: Record<string, unknown> | null): {
  identity: string;
  soul: string;
} {
  if (!openclawConfig) return { identity: "", soul: "" };
  const personaConfig = openclawConfig.personaConfig as
    | { identity?: string; soul?: string }
    | undefined;
  if (!personaConfig) return { identity: "", soul: "" };
  return {
    identity: typeof personaConfig.identity === "string" ? personaConfig.identity : "",
    soul: typeof personaConfig.soul === "string" ? personaConfig.soul : "",
  };
}

async function getNpcPersona(npcId: string, npcName: string): Promise<string> {
  try {
    const [row] = await db
      .select({ openclawConfig: npcs.openclawConfig })
      .from(npcs)
      .where(eq(npcs.id, npcId))
      .limit(1);
    if (!row) return defaultSystemPrompt(npcName);
    const oc = parseDbObject(row.openclawConfig) ?? {};
    const { identity, soul } = loadPersonaFromNpc(oc as Record<string, unknown>);
    const parts = [
      `You are ${npcName}, an NPC in a virtual office RPG.`,
      identity && `\n[Identity]\n${identity}`,
      soul && `\n[Soul]\n${soul}`,
      `\nRespond naturally in the user's language. Stay in character.`,
    ].filter(Boolean);
    return parts.join("\n");
  } catch {
    return defaultSystemPrompt(npcName);
  }
}

function defaultSystemPrompt(npcName: string): string {
  return `You are ${npcName}, an NPC in a virtual office RPG. Respond in the user's language.`;
}

/**
 * seed-v9 AC-014 T-026 — gateway adapter용 folded prompt 빌더.
 *
 * nanobot은 messages 길이가 정확히 1이어야 하므로 [system, ...history, user]를
 * 하나의 user content로 접는다. 기존 nanobotChatSend가 내부적으로 하던 일을
 * 외부 caller(streamNpcResponse via gateway adapter)에 노출.
 */
export async function buildNanobotChatPrompt(input: {
  npcId: string;
  npcName: string;
  message: string;
  attachments?: OpenClawAttachment[];
  systemPromptOverride?: string;
}): Promise<string> {
  const system = input.systemPromptOverride
    || (await getNpcPersona(input.npcId, input.npcName));
  const augmentedMessage = input.message + attachmentsToText(input.attachments);
  return `${system}\n\n${augmentedMessage}`;
}

function attachmentsToText(attachments: OpenClawAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  const sections: string[] = [];
  for (const att of attachments) {
    if (!att.content) continue;
    sections.push(`\n--- attached: ${att.fileName} ---\n${att.content}`);
  }
  return sections.length > 0 ? `\n\n[Attached files]${sections.join("")}` : "";
}

async function buildMessages(input: NanobotChatInput): Promise<ChatMessage[]> {
  const system = input.systemPromptOverride
    || (await getNpcPersona(input.npcId, input.npcName));
  const augmentedMessage = input.message + attachmentsToText(input.attachments);
  return [
    { role: "system", content: system },
    { role: "user", content: augmentedMessage },
  ];
}

export async function nanobotChatSend(input: NanobotChatInput): Promise<string> {
  const messages = await buildMessages(input);
  const opts = input.sessionId ? { sessionId: input.sessionId } : {};
  if (input.onDelta) {
    return nanobotChatStream(messages, input.onDelta, opts);
  }
  return nanobotChat(messages, opts);
}

export async function nanobotChatPlain(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  return nanobotChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]);
}
