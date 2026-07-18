---
name: obsidian-commander
description: Control local Obsidian vault via Local REST API (Search, Read, Write, Append, Links, Tags).
homepage: https://coddingtonbear.github.io/obsidian-local-rest-api/
metadata: {"nanobot":{"emoji":"🔮","always":true,"requires":{"bins":["curl"]}}}
---

# Obsidian Commander

This skill communicates with the Obsidian server and serves as a direct channel for real-time knowledge base management and graph view expansion.

## ⚙️ Configuration (Variables)
Before executing commands, refer to the following information as variables:
- **Base URL:** `http://192.168.56.1:27123` (hereinafter `{{URL}}`)
- **Token:** `Bearer 7ac54b27dff63a2a3b2fa52a3c2678ea1dd690d5b236441b4d3bcd7d673a4e09` (hereinafter `{{TOKEN}}`)


## 🧠 Captain's Special Instructions (Operational Rules)

When using this skill, you **must** follow these rules:

1. **Obsidian is the Single Source of Truth:** For reading from or writing to the Obsidian vault, you **must** use this `obsidian-commander` skill's REST API commands. Do **not** use filesystem tools (`read`, `write`, `edit`, `glob`, `grep`) on any `obsidian_vault` directory or workspace path. Do **not** create files under `workspace/obsidian_vault`, `api-workspace/obsidian_vault`, or any local vault-like path. Always route vault I/O through Obsidian Local REST API.
2. **Follow the RegTrack Vault Taxonomy:** When creating notes, use the folder, filename, frontmatter, and tag conventions defined below. Do not invent new folder structures or tag names.
3. **Connection-Focused Writing:** When creating or modifying a note, always add a `## Connected Knowledge` section at the bottom of the content and link to at least one or more relevant existing notes in `[[Note Title]]` format.
4. **Tag System Compliance:** Include relevant tags in the frontmatter `tags:` list. Use the controlled vocabulary below (`내규갈음`, `출처/...`, `status/active`, `영역/...`, `MOC`, `research`, etc.). Do not create ad-hoc hashtags outside this taxonomy.
5. **Graph Visualization Consideration:** When writing notes, do not simply list text. Actively wrap key keywords with `[[Keyword]]` to encourage the creation of new nodes in the graph view.
6. **Korean File Name Handling:** If a filename contains Korean characters, percent-encode the path in the request URL and verify that UTF-8 encoding is applied.

---

## 🗂️ RegTrack Vault Taxonomy (Mandatory)

Use these conventions for every new note you create in the vault.

### Folder Layout

| Purpose | Path |
|---|---|
| Internal policy wiki (bank policies substituting for company regulations) | `internal_wiki/{area}/` |
| Area indexes / Map of Content hubs | `internal_wiki/_MOC/` |
| External regulation / research findings | `research/{topic}/YYYY-MM-DD.md` |
| Generated images / artifacts metadata | `media/` or `artifacts/` |
| LLM analysis cache (read-only reference) | `internal_wiki/_llm_cache/` |

### Controlled Tag Vocabulary

- **Type tags**: `내규갈음`, `외규`, `research`, `MOC`, `처리방침`, `가이드라인`
- **Status tags**: `status/active`, `status/draft`, `status/deprecated`
- **Source tags**: `출처/내규갈음`, `출처/{institution_short}`, `출처/정부기관`, `출처/전문리포트`
- **Area tags**: `영역/수집동의`, `영역/처리위탁`, `영역/제3자제공`, `영역/안전성조치`, `영역/신용정보`, `영역/개인정보`
- **Project tags**: `KB은행`, `카카오뱅크`, `하나은행`, `토스뱅크`, `시중은행`, `인터넷전문은행`, `핀테크`

### Internal Policy Note Frontmatter Template

Use this frontmatter for notes created under `internal_wiki/{area}/`.

```yaml
---
title: "{source_institution} {document_type}"
date: YYYY-MM-DD
source_institution: "{은행명}"
document_type: "처리방침"
tags:
  - 내규갈음
  - 처리방침
  - 시중은행          # or 인터넷전문은행, 핀테크
  - {은행명}
  - 출처/내규갈음
  - 출처/{은행명}
  - status/active
  - 영역/수집동의
  - 영역/처리위탁
  - 영역/제3자제공
  - 영역/안전성조치
  - 영역/신용정보
  - 영역/개인정보
status: active
type: 내규갈음
version: "v1.0"
effective_date: YYYY-MM-DD
last_updated: YYYY-MM-DD
sub_area: [수집동의, 처리위탁, 제3자제공, 안전성조치, 신용정보, 개인정보]
source_doc: "{원본 PDF 파일명}"
source_url: "{공개 URL}"
substitution_note: "회사 실제 내규 반출 불가로 시중은행 공개 처리방침으로 갈음"
analysis_method: "llm_structured_json"
related_external: []
---
```

### Research Note Frontmatter Template

Use this for `research/{topic}/YYYY-MM-DD.md` notes produced by the `researcher` skill.

```yaml
---
title: "{Topic} — Research Report"
date: YYYY-MM-DD
tags:
  - research
  - 외규
  - 영역/신용정보     # or 영역/개인정보, etc.
  - status/active
related_internal:
  - "[[KB은행 개인정보 처리방침]]"
  - "[[MOC_개인정보]]"
---
```

### MOC (Map of Content) Frontmatter Template

Use this for area indexes under `internal_wiki/_MOC/`.

```yaml
---
type: MOC
sub_area: {영역명}
date: YYYY-MM-DD
tags:
  - MOC
  - 영역인덱스
  - 영역/{영역명}
---
```

### Related External Updates

When a new external regulation/research is saved and it matches an internal policy area:

1. Add the matching internal policy path to the research note's `related_internal` list.
2. Append the external note title to the internal policy's `related_external` frontmatter list.
3. Add a backlink in the internal policy's `# 관련 외규 (자동 갱신)` section: `- [[External Note Title]]`.
4. Update the MOC for the area if the new note creates a new connection.

---
## 🔍 Discovery & Search

### 1. Global File List and Recent Activity (Vault List)
Retrieves the top-level folders and files in the vault. Adding `sort=mtime` shows recently modified files first.
```bash
# Basic list
curl -s -X GET "{{URL}}/vault/" -H "Authorization: {{TOKEN}}"

# Get 10 most recently modified files (for checking recent activity)
curl -s -X GET "{{URL}}/vault/?sort=mtime&limit=10" -H "Authorization: {{TOKEN}}"
```

### 2. Keyword Search (Simple & Advanced Search)

Find note locations through simple keyword search. URL encoding is recommended for Korean search terms.

```bash
# Simple keyword search (shows filename and partial content)
curl -s -X POST "{{URL}}/search/simple/?query={{query}}&contextLength=100" \
     -H "accept: application/json" \
     -H "Authorization: {{TOKEN}}" \
     -d ''
```

---
## 📖 Content Management (Read/Write)

### 3. Read Note

Retrieves the raw Markdown content of a note.

```bash
curl -s -X GET "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Accept: text/markdown"
```

### 4. Create New Note or Modify (Upsert/Append)

Create new content or append to the end of an existing document to expand the graph view in real time.

```bash
# Create new note or overwrite entire content
curl -s -X PUT "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Content-Type: text/markdown" \
     --data-binary "{{content}}"

# Append content to the end of an existing note (Live Update)
curl -s -X POST "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Content-Type: text/markdown" \
     --data-binary $'\n\n{{content}}'
```

### 5. Surgical Edits (PATCH) — Heading / Block / Frontmatter Targeting

Precisely update a specific section of a note without rewriting the entire file. Use `Target-Type` and `Target` headers to point to the exact location.

```bash
# Replace content under a specific heading (e.g. "## Findings")
curl -s -X PATCH "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Operation: replace" \
     -H "Target-Type: heading" \
     -H "Target: Findings" \
     -H "Content-Type: text/markdown" \
     --data-binary "{{new_content}}"

# Append content under a specific heading
curl -s -X PATCH "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Operation: append" \
     -H "Target-Type: heading" \
     -H "Target: Findings" \
     -H "Content-Type: text/markdown" \
     --data-binary "{{content}}"

# Replace a frontmatter field value (e.g. status: done)
curl -s -X PATCH "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Operation: replace" \
     -H "Target-Type: frontmatter" \
     -H "Target: status" \
     -H "Content-Type: application/json" \
     --data '"{{new_value}}"'

# Read a specific heading's content only (via GET with targeting)
curl -s -X GET "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Target-Type: heading" \
     -H "Target: Findings" \
     -H "Accept: text/markdown"
```

### 6. Delete Note

Permanently remove a file from the vault. Use with caution.

```bash
curl -s -X DELETE "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}"
```

---

## 🔗 Connection & Metadata (Graph & Tags)

### 7. Connection Check (Links & Backlinks)

Backlinks and links are returned as part of a note's metadata. Use the `Accept: application/vnd.olrapi.note+json` header when reading a note to get parsed metadata including `backlinks`, `links`, and `tags`.

```bash
# Read note with parsed metadata (backlinks, links, tags, frontmatter)
curl -s -X GET "{{URL}}/vault/{{path}}" \
     -H "Authorization: {{TOKEN}}" \
     -H "Accept: application/vnd.olrapi.note+json"
```

The response looks like:

```json
{
  "path": "path/to/note.md",
  "content": "# ...",
  "frontmatter": { "status": "draft" },
  "tags": ["topic", "research"],
  "links": ["Another Note.md", "Projects/RegTrack.md"],
  "backlinks": ["Source Note.md"],
  "stat": { "ctime": 1234567890, "mtime": 1234567890, "size": 1234 }
}
```

There are no separate `/backlinks/{path}` or `/links/{path}` endpoints in the Local REST API.

### 8. Tag Analysis

Check all tags used in the vault and their frequency to understand the knowledge map.

```bash
curl -s -X GET "{{URL}}/tags/" -H "Authorization: {{TOKEN}}"
```

---

## 🗓️ Intelligence Tools

### 9. Daily Note Management

Quickly retrieve or update today's record.

```bash
# Read today's daily note
curl -s -X GET "{{URL}}/periodic/daily/" -H "Authorization: {{TOKEN}}" -H "Accept: text/markdown"

# Append content to the daily note
curl -s -X POST "{{URL}}/periodic/daily/" -H "Authorization: {{TOKEN}}" --data-binary "{{content}}"
```

### 10. Check Currently Active File

Retrieve information about the file currently activated by the Captain in the Obsidian app.

```bash
curl -s -X GET "{{URL}}/active/" -H "Authorization: {{TOKEN}}"
```