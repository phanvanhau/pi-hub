/**
 * Pure utility functions for the plan extension.
 * Extracted for clarity and testability.
 */

// ---------------------------------------------------------------------------
// Safe-command allowlist for read-only plan mode
// ---------------------------------------------------------------------------

const DESTRUCTIVE_PATTERNS: RegExp[] = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	// Redirect to file (but not >>& or process substitution)
	/(^|[^<2])>(?!>|\()/,
	/>>/,
	// Package managers – write ops
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bbun\s+(add|remove|install)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	// Git – write ops
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone|apply|am)/i,
	// Privilege escalation / system control
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	// Editors
	/\b(vim?|nano|emacs|code|subl|hx)\b/i,
];

const SAFE_PATTERNS: RegExp[] = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*ll\b/,
	/^\s*la\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*exa\b/,
	/^\s*lsd\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-files|ls-tree|describe|shortlog|blame|notes)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+(-v|--version)/i,
	/^\s*python\s+(-V|--version)/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
];

/**
 * Returns true if the command is safe to run in read-only plan mode.
 * A command is safe if it matches a safe pattern AND does NOT match any
 * destructive pattern.
 */
export function isSafeCommand(command: string): boolean {
	const firstLine = command.split("\n")[0].trim();
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(firstLine));
	return !isDestructive && isSafe;
}

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

export interface PlanTask {
	/** 1-based task number */
	number: number;
	/** Task title extracted from `### Task N – <title>` */
	title: string;
	/** Full **What**: paragraph */
	what: string;
	/** List of acceptance criteria lines (without `- [ ]` prefix) */
	criteria: string[];
	/** Runtime completion state (not persisted in PLAN.md text) */
	completed: boolean;
}

/**
 * Extract the feature title from `## Plan: <title>`.
 * Returns undefined if the header is not found.
 */
export function extractPlanTitle(text: string): string | undefined {
	const match = text.match(/^##\s+Plan:\s*(.+)$/m);
	return match ? match[1].trim() : undefined;
}

/**
 * Parse all tasks from a plan block.
 *
 * Expected format (produced by the plan-skill):
 *
 *   ### Task 1 – Title here
 *   **What**: description
 *   **Acceptance criteria**:
 *   - [ ] criterion
 *   - [ ] criterion
 *
 * Returns an empty array if no tasks are found.
 */
export function parsePlanTasks(text: string): PlanTask[] {
	const tasks: PlanTask[] = [];

	// Find the ## Plan: header first so we only parse inside the plan section
	const planHeaderMatch = text.match(/^##\s+Plan:/m);
	if (!planHeaderMatch) return tasks;

	const planBody = text.slice(text.indexOf(planHeaderMatch[0]));

	// Split into task blocks on `### Task N`
	const taskBlocks = planBody.split(/(?=^###\s+Task\s+\d+)/m);

	for (const block of taskBlocks) {
		const headerMatch = block.match(/^###\s+Task\s+(\d+)\s*[–\-—]\s*(.+)$/m);
		if (!headerMatch) continue;

		const number = parseInt(headerMatch[1], 10);
		const title = headerMatch[2].trim().replace(/\*+/g, "");

		// Extract **What**: content (everything between **What**: and next ** or ---
		const whatMatch = block.match(/\*\*What\*\*:\s*([\s\S]+?)(?=\n\*\*|\n---|\n###|$)/);
		const what = whatMatch ? whatMatch[1].trim() : "";

		// Extract acceptance criteria checkboxes
		const criteriaSection = block.match(/\*\*Acceptance criteria\*\*:\s*([\s\S]+?)(?=\n---|\n###|$)/);
		const criteria: string[] = [];
		if (criteriaSection) {
			for (const line of criteriaSection[1].split("\n")) {
				const crit = line.match(/^\s*-\s+\[[ x]\]\s+(.+)$/);
				if (crit) criteria.push(crit[1].trim());
			}
		}

		if (title) {
			tasks.push({ number, title, what, criteria, completed: false });
		}
	}

	return tasks;
}

/**
 * Render parsed tasks back to PLAN.md Markdown.
 * Preserves the full schema expected by the skill and readable by humans.
 */
export function renderPlanMarkdown(featureTitle: string, tasks: PlanTask[]): string {
	const lines: string[] = [
		`## Plan: ${featureTitle}`,
		"",
		"> Generated by pi plan-skill. Edit freely; re-run `/plan` to regenerate.",
		"",
		"---",
		"",
	];

	for (const task of tasks) {
		lines.push(`### Task ${task.number} – ${task.title}`, "");
		if (task.what) {
			lines.push(`**What**: ${task.what}`, "");
		}
		lines.push("**Acceptance criteria**:");
		for (const c of task.criteria) {
			lines.push(`- [ ] ${c}`);
		}
		lines.push("", "---", "");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Execution tracking
// ---------------------------------------------------------------------------

/**
 * Parse all `[DONE:n]` markers from an assistant message.
 */
export function extractDoneSteps(text: string): number[] {
	const steps: number[] = [];
	for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
		const n = parseInt(match[1], 10);
		if (Number.isFinite(n) && n > 0) steps.push(n);
	}
	return steps;
}

/**
 * Mark tasks as completed based on `[DONE:n]` markers in `text`.
 * Returns the count of newly-completed tasks.
 */
export function markCompletedTasks(text: string, tasks: PlanTask[]): number {
	const doneSteps = extractDoneSteps(text);
	let count = 0;
	for (const step of doneSteps) {
		const task = tasks.find((t) => t.number === step);
		if (task && !task.completed) {
			task.completed = true;
			count++;
		}
	}
	return count;
}
