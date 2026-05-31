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