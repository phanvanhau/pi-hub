---
name: learn-skill
description: Learning capture workflow. Use when the user wants to save an interesting pattern, insight, or knowledge discovered during the current session into a dated markdown file for their personal learning journey. Triggered by phrases like "save this", "note this", "learn this", "capture this learning", or explicitly with /skill:learn-skill.
---

# Learn Skill

You are in **learning capture mode**. Your job is to crystallize the most valuable insight, pattern, or knowledge surfaced during this session (or scoped by the user's prompt) into a rich, well-structured markdown file that will serve as a permanent, reusable reference for the user's personal learning journey.

---

## Phase 1 — Determine Scope & Prompt

1. If the user provided an explicit focus prompt (e.g., `/skill:learn-skill how mermaid diagrams work in markdown`), use that as the primary topic scope.
2. If no prompt was given, review the **entire current session** to identify the single most interesting, reusable, or insightful pattern or concept discovered.
3. If the topic is ambiguous or spans multiple unrelated areas, ask the user one clarifying question: *"Which topic should I focus on for this learning entry?"* — but only if truly necessary. Prefer making a smart choice.

---

## Phase 2 — Determine Output Location

Resolve the output directory using this priority order:

1. **User explicitly provides a path** during this conversation → use it.
2. **Environment variable `PI_LEARNING_PATH`** is set → use that directory.
3. **Default** → use `./learning/` relative to the current working directory.

Then:
- If the resolved directory does not exist, create it with `bash`: `mkdir -p <directory>`
- Confirm the resolved path to the user in a single line before writing: `📁 Saving to: <resolved_path>`

---

## Phase 3 — Generate the Learning File

### Filename Convention

```
YYYY-MM-DD-<kebab-case-slug-of-title>.md
```

Example: `2026-04-02-understanding-mermaid-diagrams.md`

Use today's date. Derive the slug from the generated title (lowercase, words separated by hyphens, no special characters).

---

### Frontmatter

```yaml
---
title: '<Concise, descriptive title of the learned topic>'
description: '<One sentence summarising the insight or pattern>'
date: '<YYYY-MM-DD>'
tags: ['<tag1>', '<tag2>', ...]
draft: false
---
```

**Tag rules:**
- 2 to 5 tags
- Lowercase, kebab-case (e.g., `ci-cd`, `design-patterns`, `react`, `data-structures`)
- Derived from the topic domain and key concepts

---

### Main Content Rules

The content body must follow these rules:

1. **Rich markdown**: use headings (`##`, `###`), **bold**, *italic*, `inline code`, fenced code blocks with language tags, blockquotes for key insights, and horizontal rules to separate major sections.
2. **Tables**: use markdown tables to compare options, list properties, or summarise data when applicable.
3. **Links**: include relevant reference links (official docs, RFCs, articles) where meaningful.
4. **Mermaid diagrams**: STRONGLY RECOMMENDED whenever a concept benefits from visual representation. Use fenced code blocks with ` ```mermaid ` for:
   - **Business flows** → `flowchart LR` or `flowchart TD`
   - **Sequence diagrams** → `sequenceDiagram`
   - **Technical architecture / component schemas** → `graph TD` with subgraphs
   - **State machines** → `stateDiagram-v2`
   - **Entity relationships** → `erDiagram`
   - **Timelines or Gantt** → `gantt`
   - Use mermaid any time a diagram would reduce cognitive load or replace a paragraph of explanation.
5. **Examples**: always include at least one concrete, runnable or illustrative code example if the topic is technical.
6. **Structure**: organise the body into logical sections. A suggested skeleton (adapt as needed):

```
## Overview
(What is it? Why does it matter?)

## Key Concepts
(Core ideas, terms, mental models — use tables or lists)

## How It Works
(Mechanism, flow, internals — use mermaid diagrams here)

## Examples
(Concrete code / config / command examples)

## When to Use / When Not to Use
(Decision guidance)

## References
(Links to authoritative sources)
```

7. **Depth**: aim for a self-contained reference that a future reader (the user themselves) could understand without needing the original session context.
8. **Tone**: clear, direct, technical where needed. No filler phrases.

---

## Phase 4 — Write the File

Use the `write` tool to create the file at the resolved path with the generated filename.

After writing:
- Confirm success: `✅ Learning saved: <full_file_path>`
- Print a one-line summary: `📝 Topic: <title> | Tags: <tags>`
- Do NOT print the full file content back to the user (it's already saved).

---

## Phase 5 — Optional Index Update

If a file named `README.md` or `index.md` exists inside the learning directory, append a new row to its table of contents (if it has one) or add a bullet link at the end:

```markdown
- [<title>](./<filename>) — <description>
```

If no such index file exists, skip this step silently (do not create one automatically).

---

## Reminders

- Always use today's real date for the frontmatter `date` field and filename prefix. Check with `bash date +%Y-%m-%d` if unsure.
- The mermaid diagram is the soul of a good learning entry — default to including one unless the topic is purely textual (e.g., a writing convention or soft skill).
- Keep the frontmatter strictly YAML-valid: wrap string values in single quotes, arrays use bracket notation.
- Never truncate the content to save tokens — this file is meant to be a complete, lasting reference.
- After saving, stay in the current session normally. Learning capture is a side-effect, not a session reset.
