---
name: learn-skill
description: >-
  Learning capture workflow. Saves interesting patterns, insights, or knowledge
  into a dated markdown file for the user's personal learning journey. Triggered
  by "save this", "note this", "learn this", "capture this learning", or
  explicitly with /skill:learn-skill. When no relevant topic is found in the
  current session, falls back to project-codebase exploration: asks for user
  confirmation via an interactive dialog, then reads project files (README,
  manifests, source) to extract knowledge domains and lets the user pick one
  before generating the learning entry.
---

# Learn Skill

You are in **learning capture mode**. Your job is to crystallize the most valuable insight, pattern, or knowledge surfaced during this session (or scoped by the user's prompt) into a rich, well-structured markdown file that will serve as a permanent, reusable reference for the user's personal learning journey.

---

## Phase 1 — Determine Scope & Prompt

Evaluate the session and user input, then follow **exactly one** of the three branches below.

### Branch A — Session match (topic found)

1. If the user provided an explicit focus prompt (e.g., `/skill:learn-skill how mermaid diagrams work in markdown`), use that as the primary topic scope and proceed directly to **Phase 2**.
2. If no explicit prompt was given, review the **entire current session** to identify a concrete, reusable insight, pattern, or concept that was actually discussed or demonstrated. If a clear topic is identifiable, proceed to **Phase 2**.

### Branch B — No session match (topic not found)

3. If **no** meaningful learning topic can be grounded in the current session — for example, the session is empty, or the user's query refers to a concept not discussed at all — do **not** fabricate content and do **not** ask the user a generic question. Instead, proceed to **Phase 1b** to offer project-codebase exploration as a fallback.

> **Signal for Branch B:** the session contains fewer than two substantive assistant turns, OR the user's explicit query names a technology / concept with zero coverage in the conversation.

### Branch C — Ambiguous (multiple candidates)

4. If the session contains several equally valid topics and it is genuinely unclear which one the user wants, ask one targeted clarifying question: *"Which topic should I focus on for this learning entry?"* — then proceed to **Phase 2** with the answer. Prefer making a smart automatic choice; use Branch C only when truly necessary.

---

## Phase 1b — Request User Confirmation for Project Exploration

> **Enter this phase only from Branch B of Phase 1.** Do not enter it if a session topic was found.

Before reading any project files, you must obtain explicit user consent via the `confirm_project_exploration` tool provided by the `learn-skill` Pi extension.

### Step 1 — Call the confirmation tool

Invoke the tool with the user's original query text:

```
confirm_project_exploration({ query: "<the user's original query or topic>" })
```

The tool will display an interactive confirmation dialog to the user explaining that you are about to read project files to find relevant learning material.

### Step 2 — Interpret the response

The tool returns an object with two fields:

| Field | Type | Meaning |
|-------|------|---------|
| `confirmed` | `boolean` | `true` = user approved exploration; `false` = user declined |
| `scope` | `string` (optional) | A free-text hint the user typed to focus exploration (e.g. "focus on the auth module") |

### Step 3 — Act on the response

**If `confirmed` is `false`:**
- Stop immediately. Do not explore the filesystem. Do not write any file.
- Print exactly: `🚫 Learning capture cancelled. No files were written.`
- Return to normal session mode.

**If `confirmed` is `true`:**
- If a non-empty `scope` hint was provided, keep it in mind to **narrow** the exploration in Phase 2b (e.g., only look inside the hinted directory or module).
- Proceed to **Phase 2** to resolve the output location, then to **Phase 2b** to explore the project.

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

## Phase 2b — Guided Project Exploration

> **Enter this phase only when coming from Phase 1b with `confirmed: true`.** Skip entirely when a session topic was found in Phase 1.

Your goal is to read the project with read-only tools, derive a list of candidate **knowledge domains**, pick the best one matching the user's query, and hand it off to Phase 3 as the topic.

### Step 1 — Gather structural context

Run these probes in order (stop early if the picture is already clear):

1. `bash ls -1 .` — list the project root to understand its type.
2. `read README.md` (or `README.rst` / `README.txt`) if present — extracts the project's stated purpose.
3. `read package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` (whichever exist) — extracts technology stack, dependencies, and scripts.
4. `bash find . -maxdepth 3 -type f -name "*.md" | head -30` — locate existing docs and learning files for prior-art awareness.
5. If a `scope` hint was provided in Phase 1b, also run: `bash find . -maxdepth 4 -type f | grep -i "<scope>" | head -20` to surface relevant files.
6. `read` up to **3 representative source files** in the main source directory (e.g., `src/`, `lib/`, `app/`) to understand dominant patterns. Choose files that look like the core logic, not auto-generated code.

> **Read-only constraint**: use only `read`, `bash` (non-mutating commands), `ls`, `find`, and `grep`. Do not write or edit any files during exploration.

### Step 2 — Synthesise candidate knowledge domains

From the gathered information, identify **2–5 concrete knowledge domains** that a learner could capture as a reusable reference. A knowledge domain is a concept, pattern, or technique — not a filename. Examples:

- ✅ "React custom hook pattern for data fetching"
- ✅ "Rust error-handling with `thiserror` and `anyhow`"
- ❌ "The file `src/hooks/useFetch.ts`" (too specific, not a domain)
- ❌ "The project" (too vague)

Match each candidate against the user's original query. Score by relevance.

### Step 3 — Select or ask

**Automatic selection** (preferred): if one candidate is clearly the best match for the user's query, select it and proceed to Phase 3 without interrupting the user.

**Ask via `questionnaire`** (only when genuinely ambiguous): if two or more candidates are equally relevant, invoke the `questionnaire` tool to let the user choose:

```
questionnaire({
  questions: [{
    id: "domain",
    label: "Topic",
    prompt: "Which knowledge domain should I capture from this project?",
    options: [
      { value: "domain-1", label: "<candidate 1>" },
      { value: "domain-2", label: "<candidate 2>" },
      ...
    ],
    allowOther: true
  }]
})
```

If the user selects "Type something" (allowOther), use their typed text as the topic.

### Step 4 — Hand off to Phase 3

Set the selected knowledge domain as the topic scope and proceed to **Phase 3** (Generate the Learning File). The topic enriched by project exploration should result in a deeper, more concrete learning entry than a generic description — include specific code patterns, APIs, or idioms discovered during Step 1.

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
