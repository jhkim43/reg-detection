---
name: researcher
description: Research a topic using web_search/web_fetch, then save structured insights to Obsidian vault.
homepage: https://coddingtonbear.github.io/obsidian-local-rest-api/
metadata: {"nanobot":{"emoji":"🔬","requires":{"bins":["curl"]}}}
---

# Researcher — Web Research → Obsidian Save

This skill teaches you how to autonomously research any topic using `web_search` and `web_fetch`, synthesize findings with insight, and save the result to the Obsidian vault via the obsidian-commander skill's REST API.

It works hand-in-hand with the **obsidian-commander** skill — read that skill's SKILL.md file for the curl command details.

---

## When To Use (Default Trigger)

Activate this skill whenever any of the following is true:

- The user explicitly asks to research a topic (e.g., "조사해줘", "정리해줘", "리서치 해줘").
- `obsidian-commander` search returns insufficient or stale results and external search is needed.
- A user-provided fact, external discovery, or new regulation/trend should be preserved for future reuse.

> **Default behavior:** every external search finding SHOULD be saved to Obsidian unless the user explicitly says "just tell me, do not save."
> If the answer came from the web, it should live in the vault.

---

## 🧪 Research & Save Protocol

When asked to research a topic and save to Obsidian, follow this **4-phase protocol**:

---

### Phase 1: Discover (web_search)

Run **3–5 parallel `web_search` queries** covering different angles of the topic. Do not stop after one query — multi-angle search produces better research.

```
Angle 1 — Overview & definition: "{{topic}} overview definition key concepts"
Angle 2 — Recent developments: "{{topic}} latest news 2025 2026 update"
Angle 3 — Technical/deep dive: "{{topic}} technical analysis implementation"
Angle 4 — Use cases / applications: "{{topic}} use cases examples applications"
Angle 5 — Criticism / risks: "{{topic}} criticism risks challenges limitations"
```

- Use `count=5` to get 5 results per query.
- Scan titles and snippets. Note which URLs look most promising.
- If the topic is Korean (e.g. 금융 규제), include Korean-language queries.

---

### Phase 2: Fetch (web_fetch)

From the search results, select the **2–3 most relevant, authoritative URLs** and fetch them with `web_fetch` for full content.

```text
# Prioritize in this order:
1. Official sources (government sites, .go.kr, company blogs)
2. News articles from reputable outlets
3. Analysis/reports from recognized experts
```

- Use `maxChars=10000` for each fetch.
- Extract key data points, quotes, statistics, and dates.

---

### Phase 3: Synthesize

Create a structured markdown document with the following sections. Write **in the same language as the research topic** (Korean for Korean topics).

```markdown
# {{Topic}} — Research Report

**Date:** {{YYYY-MM-DD}}

## 📌 핵심 요약
2-3 sentence executive summary in Korean (or topic's language).

---

## 📋 상세 분석

### 1. 개요 (Overview)
{What is this topic? Key background context.}

### 2. 주요 발언 / 핵심 내용 (Key Statements / Findings)
{Bullet points with the most important findings. Include direct quotes where relevant.}

### 3. 영향 분석 (Impact Analysis)
{Who or what does this affect? How significant is it?}

### 4. 시사점 (Implications)
{What does this mean going forward? Strategic insights.}

---

## 📊 요약 정보

| 항목 | 내용 |
|------|------|
| 조사 일자 | {{YYYY-MM-DD}} |
| 주요 출처 수 | {{N}} |
| 관련 태그 | {{#tags}} |

---

## 🔗 출처 (Sources)

1. [Title](url) — key takeaway
2. [Title](url) — key takeaway
3. [Title](url) — key takeaway

---

## 🧠 Connected Knowledge
- Link to related notes using `[[Note Title]]` format.
- Add at least 2–3 connections to existing notes.
```

---

### Phase 4: Save to Obsidian

Use the obsidian-commander skill's curl commands via the **`exec`** tool to save the synthesized document to the vault.

**File path convention:** Research notes go under `research/{{topic-sanitized}}/{{YYYY-MM-DD}}.md`

```bash
# 1. Create/overwrite the note
curl -s -X PUT "{{URL}}/vault/research/{{topic}}/{{YYYY-MM-DD}}.md" \
     -H "Authorization: {{TOKEN}}" \
     -H "Content-Type: text/markdown" \
     --data-binary "{{full_markdown_content}}"

# 2. (Optional) Append a reference to today's daily note
curl -s -X POST "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Content-Type: text/markdown" \
     --data-binary $'\n\n## 🔗 Research Added\nToday[[research/{{topic}}/{{YYYY-MM-DD}}|research note]] on {{topic}} was added to the vault.'
```

> ⚠️ **Important:** Replace `{{URL}}` with `http://192.168.56.1:27123` and `{{TOKEN}}` with the Bearer token from the obsidian-commander skill configuration.

---

## ✅ Quality Checklist

Before finishing, verify:

- [ ] `obsidian-commander` search was attempted first (or reason noted if skipped)
- [ ] 3–5 search queries executed (multi-angle)
- [ ] 2–3 pages fetched for depth
- [ ] At least 3 distinct sources cited
- [ ] Synthesis includes: overview, key findings, impact analysis, implications
- [ ] `## Connected Knowledge` section with `[[links]]` to existing notes
- [ ] Saved to `research/{{topic}}/` path in Obsidian
- [ ] Tags included (at minimum `#research` and `#{{topic}}`)
- [ ] Content written in the topic's language (Korean for Korean topics)
- [ ] Daily note updated with a backlink to the new research note
- [ ] Findings are reusable: the next similar query should be answered from this note
