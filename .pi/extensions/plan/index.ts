/**
 * Plan Extension
 *
 * Integrates a structured "plan before implement" workflow into Pi.
 *
 * Workflow:
 *   1. User types `/plan <description>` (or Ctrl+Alt+P)
 *   2. Extension switches to read-only tools and injects plan-skill guidance
 *   3. LLM explores codebase, asks clarifying questions, produces a plan
 *   4. Extension parses the plan, writes PLAN.md, shows GO gate dialog
 *   5. On GO: full tools restored, implementation begins with PLAN.md in context
 *   6. Progress widget tracks [DONE:n] markers during execution
 *
 * Commands: /plan, /plan-status
 * Shortcut:  Ctrl+Alt+P
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

import {
	extractPlanTitle,
	isSafeCommand,
	markCompletedTasks,
	parsePlanTasks,
	renderPlanMarkdown,
	type PlanTask,
} from "./utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_FILE = "PLAN.md";

// The full SKILL.md content is injected at before_agent_start so it is
// always present regardless of skill auto-loading order.
const SKILL_PATH = path.join(__dirname, "../../skills/plan-skill/SKILL.md");

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(msg: AssistantMessage): string {
	return msg.content
		.filter((b): b is TextContent => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}

// ---------------------------------------------------------------------------
// Persisted state shape
// ---------------------------------------------------------------------------

interface PlanState {
	planMode: boolean;
	executionMode: boolean;
	featureTitle: string;
	tasks: PlanTask[];
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function planExtension(pi: ExtensionAPI): void {
	// In-memory runtime state
	let planMode = false;
	let executionMode = false;
	let featureTitle = "";
	let tasks: PlanTask[] = [];

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	function planFilePath(ctx: ExtensionContext): string {
		return path.join(ctx.cwd, PLAN_FILE);
	}

	function loadSkillContent(): string {
		try {
			return fs.readFileSync(SKILL_PATH, "utf8");
		} catch {
			// Fallback: inline minimal guidance if file is not found
			return "You are in plan mode. Explore the codebase using read-only tools, then produce a plan using the schema: ## Plan: <title> followed by ### Task N – <title> sections each with **What**: and **Acceptance criteria**: checklist.";
		}
	}

	function persistState(): void {
		pi.appendEntry("plan-state", {
			planMode,
			executionMode,
			featureTitle,
			tasks,
		} satisfies PlanState);
	}

	function updateUI(ctx: ExtensionContext): void {
		// --- Footer status ---
		if (executionMode && tasks.length > 0) {
			const done = tasks.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan", ctx.ui.theme.fg("accent", `📋 ${done}/${tasks.length}`));
		} else if (planMode) {
			ctx.ui.setStatus("plan", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan", undefined);
		}

		// --- Widget above editor ---
		if (executionMode && tasks.length > 0) {
			const lines = tasks.map((t) => {
				if (t.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") +
						ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(t.title))
					);
				}
				return ctx.ui.theme.fg("muted", "☐ ") + t.title;
			});
			ctx.ui.setWidget("plan-tasks", lines);
		} else {
			ctx.ui.setWidget("plan-tasks", undefined);
		}
	}

	function enterPlanMode(ctx: ExtensionContext, description?: string): void {
		planMode = true;
		executionMode = false;
		tasks = [];
		featureTitle = description ?? "";
		pi.setActiveTools(PLAN_MODE_TOOLS);
		const msg = description
			? `Plan mode enabled for: "${description}". Tools restricted to read-only.`
			: "Plan mode enabled. Tools restricted to read-only.";
		ctx.ui.notify(msg, "info");
		updateUI(ctx);
	}

	function exitPlanMode(ctx: ExtensionContext, quiet = false): void {
		planMode = false;
		executionMode = false;
		tasks = [];
		featureTitle = "";
		pi.setActiveTools(NORMAL_MODE_TOOLS);
		if (!quiet) ctx.ui.notify("Plan mode disabled. Full tool access restored.", "info");
		updateUI(ctx);
	}

	/**
	 * Offer the user an optional context compaction after plan mode exits.
	 * Called at both explicit toggle-off (/plan) and GO-gate confirmation.
	 *
	 * Uses ctx.compact() which mirrors what /compact does internally.
	 * Safe to call from both command handlers and event handlers since
	 * ctx.compact() is fire-and-forget (non-blocking).
	 */
	async function offerCompact(ctx: ExtensionContext, reason: "toggle-off" | "go"): Promise<void> {
		if (!ctx.hasUI) return;

		const label =
			reason === "go"
				? "Compact the planning conversation before implementing?"
				: "Compact the planning conversation before continuing?";

		const hint =
			"This summarises the exploration & plan discussion to free up context tokens for implementation.";

		const choice = await ctx.ui.select(`${label}\n${hint}`, [
			"Yes – compact now",
			"No – skip",
		]);

		if (!choice || choice === "No – skip") return;

		const customInstructions =
			"Summarise the planning phase that just completed. " +
			"Preserve: the feature title, all task titles, their acceptance criteria, " +
			"and any key decisions or constraints discovered during exploration. " +
			"Omit raw file content that was only read for context.";

		ctx.compact({
			customInstructions,
			onComplete: () => {
				ctx.ui.notify("✓ Compaction complete. Context freed for implementation.", "success");
			},
			onError: (err) => {
				ctx.ui.notify(`Compaction failed: ${err.message}`, "error");
			},
		});

		ctx.ui.notify("Compaction started in background…", "info");
	}

	// ------------------------------------------------------------------
	// Commands
	// ------------------------------------------------------------------

	pi.registerCommand("plan", {
		description: "Start plan mode for a feature. Usage: /plan <description>",
		handler: async (args, ctx) => {
			if (planMode) {
				exitPlanMode(ctx);
				await offerCompact(ctx, "toggle-off");
				return;
			}
			enterPlanMode(ctx, args?.trim() || undefined);

			// If a description was provided, immediately kick off the agent
			if (args?.trim()) {
				pi.sendUserMessage(
					`Please plan the following using the plan-skill workflow: ${args.trim()}`,
					{ deliverAs: "followUp" },
				);
			} else {
				ctx.ui.notify(
					"Describe what you want to plan, e.g.: /plan add dark mode support",
					"info",
				);
			}
		},
	});

	pi.registerCommand("plan-status", {
		description: "Show current PLAN.md content or plan progress",
		handler: async (_args, ctx) => {
			const planPath = planFilePath(ctx);

			if (!planMode && !executionMode && !fs.existsSync(planPath)) {
				ctx.ui.notify("No active plan. Start one with /plan <description>", "info");
				return;
			}

			if (executionMode && tasks.length > 0) {
				const done = tasks.filter((t) => t.completed).length;
				const lines = [`📋 Plan: ${featureTitle} (${done}/${tasks.length} done)`, ""];
				for (const t of tasks) {
					const check = t.completed ? "☑" : "☐";
					lines.push(`  ${check} Task ${t.number}: ${t.title}`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (planMode) {
				ctx.ui.notify(
					tasks.length > 0
						? `Plan mode active. ${tasks.length} tasks drafted. Use /plan to toggle off.`
						: `Plan mode active for: "${featureTitle || "unspecified"}". Waiting for plan output.`,
					"info",
				);
				return;
			}

			// Read PLAN.md from disk
			try {
				const content = fs.readFileSync(planPath, "utf8");
				// Show first 50 lines as notification
				const preview = content.split("\n").slice(0, 50).join("\n");
				ctx.ui.notify(preview, "info");
			} catch {
				ctx.ui.notify(`PLAN.md not found at ${planPath}`, "info");
			}
		},
	});

	// ------------------------------------------------------------------
	// Shortcut: Ctrl+Alt+P
	// ------------------------------------------------------------------

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			if (planMode) {
				exitPlanMode(ctx);
			} else {
				enterPlanMode(ctx);
				ctx.ui.notify("Plan mode on. Type your feature description and press Enter.", "info");
			}
		},
	});

	// ------------------------------------------------------------------
	// Tool gating: block destructive bash commands in plan mode
	// ------------------------------------------------------------------

	pi.on("tool_call", async (event) => {
		if (!planMode) return;

		if (event.toolName === "bash") {
			const command = (event.input as { command: string }).command ?? "";
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason:
						`⏸ Plan mode: this command is not allowed during planning.\n` +
						`Command: ${command}\n` +
						`Only read-only commands are permitted. Use /plan to exit plan mode first.`,
				};
			}
		}

		// Block write/edit tools even if somehow active
		if (event.toolName === "write" || event.toolName === "edit") {
			return {
				block: true,
				reason:
					`⏸ Plan mode: file writes are disabled during planning.\n` +
					`Use /plan to exit plan mode before making changes.`,
			};
		}
	});

	// ------------------------------------------------------------------
	// Context filter: strip plan-mode injections when not in plan mode
	// ------------------------------------------------------------------

	pi.on("context", async (event) => {
		if (planMode || executionMode) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				return msg.customType !== "plan-skill-context" && msg.customType !== "plan-exec-context";
			}),
		};
	});

	// ------------------------------------------------------------------
	// Inject plan guidance before each agent turn
	// ------------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		if (planMode) {
			const skillContent = loadSkillContent();
			const header = featureTitle
				? `\n\n[PLAN MODE ACTIVE — Feature: "${featureTitle}"]\n\n`
				: "\n\n[PLAN MODE ACTIVE]\n\n";
			return {
				message: {
					customType: "plan-skill-context",
					content: header + skillContent,
					display: false,
				},
				systemPrompt:
					event.systemPrompt +
					"\n\n## Plan Mode\nYou are currently in plan mode. Do NOT use write, edit, or destructive bash commands. Explore, ask questions, and produce a plan only.",
			};
		}

		if (executionMode && tasks.length > 0) {
			const remaining = tasks.filter((t) => !t.completed);
			if (remaining.length === 0) return;

			const taskList = remaining.map((t) => `${t.number}. ${t.title}`).join("\n");
			return {
				message: {
					customType: "plan-exec-context",
					content:
						`[EXECUTING PLAN — Full tool access enabled]\n\n` +
						`Reference: @${PLAN_FILE}\n\n` +
						`Remaining tasks:\n${taskList}\n\n` +
						`Execute each task in order. After completing a task, include [DONE:n] in your response (where n is the task number).`,
					display: false,
				},
			};
		}
	});

	// ------------------------------------------------------------------
	// After each LLM turn: track [DONE:n] markers during execution
	// ------------------------------------------------------------------

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || tasks.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		const newly = markCompletedTasks(text, tasks);
		if (newly > 0) {
			updateUI(ctx);
			persistState();
		}
	});

	// ------------------------------------------------------------------
	// After agent finishes: parse plan output or check execution complete
	// ------------------------------------------------------------------

	pi.on("agent_end", async (event, ctx) => {
		// --- Execution mode: check if all tasks done ---
		if (executionMode && tasks.length > 0) {
			if (tasks.every((t) => t.completed)) {
				const completedList = tasks.map((t) => `- ~~${t.title}~~`).join("\n");
				pi.sendMessage(
					{
						customType: "plan-complete",
						content: `**Plan Complete! ✓**\n\nAll ${tasks.length} tasks finished for: _${featureTitle}_\n\n${completedList}`,
						display: true,
					},
					{ triggerTurn: false },
				);
				executionMode = false;
				tasks = [];
				featureTitle = "";
				pi.setActiveTools(NORMAL_MODE_TOOLS);
				updateUI(ctx);
				persistState();
			}
			return;
		}

		// --- Plan mode: look for plan output ---
		if (!planMode || !ctx.hasUI) return;

		// Find the last assistant message in this agent run
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (!lastAssistant) return;

		const text = getTextContent(lastAssistant);
		const title = extractPlanTitle(text);
		const parsed = parsePlanTasks(text);

		if (!title || parsed.length === 0) {
			// No plan found yet — stay in plan mode, nothing to gate
			return;
		}

		// We have a valid plan — update state
		featureTitle = title;
		tasks = parsed;

		// Write PLAN.md to project root
		const planPath = planFilePath(ctx);
		const markdown = renderPlanMarkdown(featureTitle, tasks);
		try {
			fs.writeFileSync(planPath, markdown, "utf8");
			ctx.ui.notify(`PLAN.md written (${tasks.length} tasks) → ${planPath}`, "success");
		} catch (err) {
			ctx.ui.notify(`Could not write PLAN.md: ${String(err)}`, "error");
		}

		// Show task list as a message
		const taskListText = tasks
			.map((t) => `${t.number}. ☐ **${t.title}**`)
			.join("\n");
		pi.sendMessage(
			{
				customType: "plan-tasklist",
				content: `**Plan: ${featureTitle}** (${tasks.length} tasks)\n\n${taskListText}`,
				display: true,
			},
			{ triggerTurn: false },
		);

		// --- GO gate dialog ---
		const choice = await ctx.ui.select("Plan ready — what next?", [
			`GO – implement the plan (${tasks.length} tasks)`,
			"Review & refine",
			"Abort",
		]);

		if (!choice || choice === "Abort") {
			exitPlanMode(ctx);
			persistState();
			ctx.ui.notify("Plan aborted. Plan mode disabled.", "info");
			return;
		}

		if (choice === "Review & refine") {
			// Stay in plan mode; user types a refinement prompt
			ctx.ui.notify(
				"Still in plan mode. Describe your refinements and press Enter.",
				"info",
			);
			persistState();
			return;
		}

		// GO
		planMode = false;
		executionMode = true;
		pi.setActiveTools(NORMAL_MODE_TOOLS);
		updateUI(ctx);
		persistState();

		await offerCompact(ctx, "go");

		pi.sendUserMessage(
			`Implement the plan described in @${PLAN_FILE}. Start with Task 1: ${tasks[0].title}.`,
			{ deliverAs: "followUp" },
		);
	});

	// ------------------------------------------------------------------
	// Session persistence: restore state on start/resume/fork/tree
	// ------------------------------------------------------------------

	function restoreState(ctx: ExtensionContext): void {
		planMode = false;
		executionMode = false;
		featureTitle = "";
		tasks = [];

		const entries = ctx.sessionManager.getEntries();
		// Find the most recent plan-state custom entry
		const stateEntry = [...entries]
			.reverse()
			.find(
				(e: { type: string; customType?: string }) =>
					e.type === "custom" && e.customType === "plan-state",
			) as { data?: PlanState } | undefined;

		if (stateEntry?.data) {
			planMode = stateEntry.data.planMode ?? false;
			executionMode = stateEntry.data.executionMode ?? false;
			featureTitle = stateEntry.data.featureTitle ?? "";
			tasks = stateEntry.data.tasks ?? [];
		}

		if (planMode) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		} else if (executionMode) {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
		}

		updateUI(ctx);
	}

	pi.on("session_start", async (_event, ctx) => restoreState(ctx));
	pi.on("session_switch", async (_event, ctx) => restoreState(ctx));
	pi.on("session_fork", async (_event, ctx) => restoreState(ctx));
	pi.on("session_tree", async (_event, ctx) => restoreState(ctx));
}
