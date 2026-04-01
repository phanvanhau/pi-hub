---
name: plan-skill
description: Structured planning workflow. Use when asked to plan, brainstorm, or design a solution before implementing. Explores the codebase, asks clarifying questions, then produces a task list with acceptance criteria.
---

# Plan Skill

You are in **plan mode** — a read-only exploration and design phase.
Your job is to fully understand the requirement, explore the codebase, resolve ambiguity, and produce a structured, actionable plan.
You must NOT create, edit, or write any files during this phase.

---

## Phase 1 — Clarify Requirements

Before touching any code, use the `questionnaire` tool to resolve ambiguities.

Ask questions only when the answer would materially change the plan. Typical areas:

- Scope: which subsystems / modules are in scope?
- Constraints: performance targets, backward compatibility, API stability?
- Preferences: pattern to follow (e.g. existing conventions vs. new approach)?
- Priority: must-have vs. nice-to-have features?

If the request is already unambiguous, skip the questionnaire and proceed directly to Phase 2.

---

## Phase 2 — Explore the Codebase

Use read-only tools (`read`, `grep`, `find`, `ls`, `bash` safe commands) to understand:

1. **Entry points** – where does the relevant code begin?
2. **Data flow** – how does data move through the system?
3. **Existing patterns** – what conventions are already in use?
4. **Dependencies** – what does the code under change depend on?
5. **Tests** – are there existing tests to preserve or extend?
6. **Configuration** – any env vars, settings, or feature flags involved?

Read `AGENTS.md` / `README.md` / `package.json` at the project root first for context.

---

## Phase 3 — Write the Plan

Once you have enough information, output the plan using the schema below.
The plan must be complete enough that a developer (or agent) can implement each task
without needing to re-read this conversation.

### Required Schema

```
## Plan: <short feature title>

> <one-sentence summary of what will be built and why>

---

### Task 1 – <concise task title>

**What**: <2–4 sentences describing what this task implements, which files are touched, and what pattern it follows>

**Acceptance criteria**:
- [ ] <specific, verifiable criterion>
- [ ] <specific, verifiable criterion>
- [ ] <specific, verifiable criterion (add as many as needed)>

---

### Task 2 – <concise task title>

**What**: ...

**Acceptance criteria**:
- [ ] ...

---

(repeat for all tasks)
```

### Schema Rules

- Start with exactly `## Plan:` followed by the feature title (the extension parses this header).
- Use `### Task N –` for each task header (the extension extracts titles from here).
- Every task must have a `**What**:` paragraph and an `**Acceptance criteria**:` checklist.
- Tasks must be ordered by dependency: task N should not depend on task N+2.
- Each acceptance criterion must be independently verifiable (pass/fail).
- Do NOT include implementation steps or code snippets in the plan — only what, not how.
- Aim for 3–8 tasks. Split large tasks; merge trivial ones.

---

## Phase 4 — Wait for GO

After outputting the plan, stop. Do not start implementing.
The user will review the plan and either:
- Ask you to **refine** it (stay in plan mode, iterate)
- Give the **GO** signal (implementation phase begins automatically)
- **Abort** (discard the plan)

---

## Reminders

- You are in read-only mode. Any attempt to use `write`, `edit`, or destructive `bash` commands will be blocked.
- Be thorough in exploration — a shallow plan leads to missed edge cases.
- Acceptance criteria must describe *observable outcomes*, not implementation details.
  - ✓ Good: "The `/plan` command is available in the editor and toggles plan mode"
  - ✗ Bad: "Set `planModeEnabled = true` in the extension"
