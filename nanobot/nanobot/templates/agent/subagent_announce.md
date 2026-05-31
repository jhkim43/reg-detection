[Subagent '{{ label }}' {{ status_text }}]

Task: {{ task }}

Result:
{{ result }}

Summarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.

## Decide: Direct announce or spawn a subagent with a formatting skill?

Read the Result above and decide which action to take:

| Condition | Action |
|-----------|--------|
| Result is simple (<100 chars) or failed | Just announce directly (default) |
| Result contains structured data (tables, categorized items) **OR** exceeds 500 chars | **Spawn a new subagent with an appropriate formatting skill** to produce a polished deliverable |

When spawning a formatting subagent, pass the full result text and any session context (IDs, keys) in the task prompt.