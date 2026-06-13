[Subagent '{{ label }}' {{ status_text }}]

Task: {{ task }}

Result:
{{ result }}

## Decide your next action (in this priority order)

1. **If an active skill (e.g. a multi-stage pipeline) prescribes the next step** — for example a SKILL.md instructing you to spawn the next subagent in a fixed sequence — follow that instruction NOW. Call the next `SpawnTool` immediately in this same turn. Do NOT send any text to the user between subagents; the user is watching the progress via chat_push from the subagents.
2. **Else, if the Result is structured (tables, categorized items) OR exceeds 500 chars** — spawn a new subagent with an appropriate formatting skill, passing the full result text and any session context (IDs, keys) in the task prompt.
3. **Else** — announce directly to the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.