// seed-v10 phase4 T-V25: legacy task block parsing 제거 — nanobot tool calling 흐름이
// LLM 응답에 ```json:task``` 코드블록을 생성하지 않으므로 strip 로직 불필요. 일반 markdown
// whitespace collapse만 유지해 chat 응답 정돈 효과는 보존.

/**
 * @param {string} value
 */
function collapseTaskWhitespace(value) {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * @param {string} responseText
 */
function sanitizeNpcResponseText(responseText) {
  if (!responseText || typeof responseText !== "string") return responseText || "";
  return collapseTaskWhitespace(responseText);
}

module.exports = {
  sanitizeNpcResponseText,
};
