---
name: obsidian-commander
description: Control local Obsidian vault via Local REST API (Search, Read, Write, Append, Links, Tags).
homepage: https://coddingtonbear.github.io/obsidian-local-rest-api/
metadata: {"nanobot":{"emoji":"🔮","requires":{"bins":["curl"]}}}
---

# Obsidian Commander

This skill communicates with the Obsidian server and serves as a direct channel for real-time knowledge base management and graph view expansion.

## ⚙️ Configuration (Variables)
Before executing commands, refer to the following information as variables:
- **Base URL:** `http://192.168.56.1:27123` (hereinafter `{{URL}}`)
- **Token:** `Bearer 037e23fca00f8993dd64d6c14c60326ef4aa3aeed682c32fbed343de9edb0a5f` (hereinafter `{{TOKEN}}`)


## 🧠 Captain's Special Instructions (Operational Rules)

When using this skill, you **must** follow these rules:

1. **Connection-Focused Writing:** When creating or modifying a note, always add a `## Connected Knowledge` section at the bottom of the content and link to at least one or more relevant existing notes in `[[Note Title]]` format.
2. **Tag System Compliance:** Include a `#topic` tag in the frontmatter or at the bottom of every note.
3. **Graph Visualization Consideration:** When writing notes, do not simply list text. Actively wrap key keywords with `[[Keyword]]` to encourage the creation of new nodes in the graph view.
4. **Korean File Name Handling:** If a filename contains Korean characters, internally verify that UTF-8 encoding is properly applied in the request URL.
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

Understand the connection relationships in the graph view. Check who references this note and what this note references.

```bash
# Check other notes that mention/link to this note (Backlinks)
curl -s -X GET "{{URL}}/backlinks/{{path}}" -H "Authorization: {{TOKEN}}"

# Check all links contained within this note
curl -s -X GET "{{URL}}/links/{{path}}" -H "Authorization: {{TOKEN}}"
```

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