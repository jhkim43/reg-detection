# Agent Instructions

## Scheduled Reminders

Before scheduling reminders, check available skills and follow skill guidance first.
Use the built-in `cron` tool to create/list/remove jobs (do not call `nanobot cron` via `exec`).
Get USER_ID and CHANNEL from the current session (e.g., `8281248569` and `telegram` from `telegram:8281248569`).

**Do NOT just write reminders to MEMORY.md** — that won't trigger actual notifications.

## Heartbeat Tasks

`HEARTBEAT.md` is checked on the configured heartbeat interval. Use file tools to manage periodic tasks:

- **Add**: `edit_file` to append new tasks
- **Remove**: `edit_file` to delete completed tasks
- **Rewrite**: `write_file` to replace all tasks

When the user asks for a recurring/periodic task, update `HEARTBEAT.md` instead of creating a one-time cron reminder.

## Multi-Step Orchestration

For complex requests spanning multiple domains (research → synthesize → report), use the subagent spawning pattern:

1. **Research** — Spawn a subagent to gather information.
2. **Review** — When it completes, review its output.
3. **Format (if needed)** — If the result is structured (tables, categories, 500+ chars), spawn a second subagent with a formatting skill to produce the final deliverable.

Pass any necessary session context (IDs, keys) in the task prompt when spawning formatting subagents so they can complete push operations. Use the `load_skills` parameter when the skill provides formatting templates and push instructions.

## Knowledge-First Protocol

For every user query (especially Telegram → nanobot-gateway), follow this lookup order.

### MANDATORY FIRST STEP for every user query

Before calling `web_search`, `grep`, `glob`, `read_file`, `list_dir`, or any other tool, you **must** first call the `obsidian-commander` skill's `/search/simple/` API to search the Obsidian vault. This applies to questions, research requests, and save/update requests alike.

1. **internal_wiki first (Obsidian vault)**
   - Start **every** response by calling `obsidian-commander` `/search/simple/` once with the user's core keywords.
   - Do **not** call the same query twice. If the first result is insufficient, try a different keyword or move to `web_search`, rather than repeating the identical query.
   - If relevant notes exist, summarize/quote them and read the full note with `/vault/{path}` when needed.
   - `grep`/`glob`/`read_file` on workspace markdown files is **not** internal_wiki search and is forbidden for knowledge lookup. All vault I/O must go through the `obsidian-commander` skill.


2. **external_wiki / web search (only after obsidian)**
   - Only use `web_search` when the vault has no answer or the answer is stale/insufficient.
   - Do not just answer; if the new information is worth keeping, route it through the `researcher` skill for storage.

3. **Save to reuse via Obsidian API**
   - Cite vault notes with `[[Note Title]]` links.
   - Persist external findings via the `researcher` skill's 4-phase protocol under `research/{topic}/` so future queries reuse them.
   - When the `researcher` skill saves to Obsidian, it must use the `obsidian-commander` skill's REST API commands — never direct filesystem writes to the vault directory.

4. **Subagents inherit Knowledge-First (but use sparingly on Telegram)**
   - For **Telegram**, prefer direct tool execution. Spawn a subagent only when the task clearly requires parallel multi-angle research, report formatting with DeskRPG push, or coordination across multiple domains.
   - A simple "web search → summarize → save to Obsidian" request on Telegram should be handled directly by the main agent using `web_search`/`web_fetch` and `obsidian-commander`, without spawning subagents.
   - When you do spawn subagents for research, formatting, or report composition, include the Knowledge-First protocol in the task prompt.
   - Subagents must use `obsidian-commander` REST API for all vault search/read/write.
   - Subagents must not use `chat_push` or `push_report` unless the current channel is DeskRPG and `deskrpg_meta` is provided.

This protocol is reinforced by `SOUL.md`, `USER.md`, and `nanobot/nanobot/skills/researcher/SKILL.md`.