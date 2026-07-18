// seed-v10 옵션 B1 — nanobot workspace AGENTS.md content 조립 헬퍼.
//
// 순수 string 조합만 수행 (fs/path 의존성 없음) → client/server 양쪽 import 안전.
// 이전엔 nanobot-agent-lifecycle.ts 안에 있었으나 그 파일은 node:fs/promises를
// import해서 client component bundle에 끌려들어가는 chunking 에러가 발생.
// 이 파일에서 분리해 server/client 양쪽에서 동일 매핑 규칙을 공유.

/**
 * identity + meetingProtocol을 nanobot의 AGENTS.md 단일 파일에 흡수.
 *
 * nanobot BOOTSTRAP_FILES가 AGENTS.md 하나만 persona로 읽으므로, deskrpg가 분리
 * 보관하던 두 필드를 한 파일에 섹션으로 합친다. 둘 다 비어 있으면 빈 문자열을
 * 반환 — 호출자는 그 경우 파일 자체를 작성하지 않는다.
 */
export function buildAgentsFileContent(
  identity: string | null | undefined,
  meetingProtocol: string | null | undefined,
): string {
  const parts: string[] = [];
  const id = (identity ?? "").trim();
  const mp = (meetingProtocol ?? "").trim();
  if (id) parts.push(`# Identity\n${id}`);
  if (mp) parts.push(`# Meeting Protocol\n${mp}`);
  return parts.join("\n\n");
}
