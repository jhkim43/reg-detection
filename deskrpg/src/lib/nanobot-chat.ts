import { eq } from "drizzle-orm";

import { db, npcs } from "@/db";
import { parseDbObject } from "@/lib/db-json";
import type { OpenClawAttachment } from "@/lib/file-extractor";

import {
  type ChatMessage,
  nanobotChat,
  nanobotChatStream,
} from "./nanobot-client";

const MAX_HISTORY_TURNS = 16;

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
};

function loadPersonaFromNpc(openclawConfig: Record<string, unknown> | null): {
  identity: string;
  soul: string;
} {
  if (!openclawConfig) return { identity: "", soul: "" };
  const personaConfig = openclawConfig.personaConfig as
    | { identity?: string; soul?: string }
    | undefined;
  if (personaConfig) {
    return {
      identity: typeof personaConfig.identity === "string" ? personaConfig.identity : "",
      soul: typeof personaConfig.soul === "string" ? personaConfig.soul : "",
    };
  }
  const legacyPersona = typeof openclawConfig.persona === "string" ? openclawConfig.persona : "";
  return { identity: legacyPersona, soul: "" };
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

function attachmentsToText(attachments: OpenClawAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  const sections: string[] = [];
  for (const att of attachments) {
    if (!att.content) continue;
    sections.push(`\n--- attached: ${att.fileName} ---\n${att.content}`);
  }
  return sections.length > 0 ? `\n\n[Attached files]${sections.join("")}` : "";
}

function historyToMessages(history: HistoryEntry[] | undefined): ChatMessage[] {
  if (!history || history.length === 0) return [];
  const recent = history.slice(-MAX_HISTORY_TURNS * 2);
  return recent.map((entry) => ({
    role: entry.role === "player" ? "user" : "assistant",
    content: entry.content,
  }));
}

async function buildMessages(input: NanobotChatInput): Promise<ChatMessage[]> {
  const system = input.systemPromptOverride
    || (await getNpcPersona(input.npcId, input.npcName));
  const augmentedMessage = input.message + attachmentsToText(input.attachments);
  return [
    { role: "system", content: system },
    ...historyToMessages(input.history),
    { role: "user", content: augmentedMessage },
  ];
}

export async function nanobotChatSend(input: NanobotChatInput): Promise<string> {
  const messages = await buildMessages(input);
  if (input.onDelta) {
    return nanobotChatStream(messages, input.onDelta);
  }
  return nanobotChat(messages);
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
