// src/lib/task-prompt.js
//
// seed-v10 phase4 T-V26:
//   - injectTaskPrompt / buildTaskCorePrompt / TASK_CORE_PROMPT 제거. nanobot tool calling
//     모델에서는 task가 tool_calls field로 전달되어 LLM identity에 task protocol을
//     prepend할 필요 없음.
//   - buildTaskSessionPrompt는 LLM이 현재 진행 중인 task를 식별할 수 있도록 task 컨텍스트
//     만 유지 (buildTaskCorePrompt 의존 제거, json:task 블록 안내 라인 제거).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { taskPromptMessages } = require("./i18n/task-prompt-messages.js");

function normalizeTaskPromptLocale(locale) {
  const base = typeof locale === "string" ? locale.toLowerCase().slice(0, 2) : "";
  if (base === "ko" || base === "ja" || base === "zh") return base;
  return "en";
}

// taskPromptMessages는 향후 task-related i18n 메시지에서 재사용 가능하므로 helper만 보존.
// 현재 코드 경로에서는 사용처가 없을 수 있다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _translateTaskPrompt(locale, key, params) {
  const normalizedLocale = normalizeTaskPromptLocale(locale);
  let text = taskPromptMessages[normalizedLocale]?.[key]
    ?? taskPromptMessages.en[key]
    ?? key;

  if (params) {
    for (const [paramKey, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(value));
    }
  }

  return text;
}

function buildTaskSessionPrompt(task, _locale) {
  const context = [
    "[TASK CONTEXT]",
    `현재 태스크: ${task.title}`,
    `태스크 ID: ${task.npcTaskId}`,
    `상태: ${task.status}`,
    `생성일: ${task.createdAt}`,
  ];
  if (task.summary) {
    context.push(`최근 요약: ${task.summary}`);
  }
  context.push("");
  context.push("이 대화는 위 태스크 전용입니다.");
  context.push("태스크와 관련된 작업에 집중하되, 사용자의 추가 지시에 유연하게 대응하세요.");

  return context.join("\n");
}

module.exports = {
  buildTaskSessionPrompt,
  normalizeTaskPromptLocale,
};
