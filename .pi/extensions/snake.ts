/**
 * Snake game extension for Pi agent
 *
 * Launch with /snake command while Pi is running any task.
 * The game runs in Pi's TUI and does NOT interrupt the LLM —
 * play while you wait for a long task to complete!
 *
 * Controls:
 *   ↑ ↓ ← →  or  W A S D   — move
 *   ESC                     — pause & save (resume later)
 *   Q                       — quit & clear saved state
 *   R / Space               — restart after game over
 *
 * State is persisted into the Pi session log so your position,
 * score, and high score survive a /snake close and re-open.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAME_WIDTH = 40;
const GAME_HEIGHT = 15;
const TICK_MS = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Direction = "up" | "down" | "left" | "right";
type Point = { x: number; y: number };

interface GameState {
	snake: Point[];
	food: Point;
	direction: Direction;
	nextDirection: Direction;
	score: number;
	gameOver: boolean;
	highScore: number;
}

// ---------------------------------------------------------------------------
// Pure game helpers
// ---------------------------------------------------------------------------

function createInitialState(): GameState {
	const startX = Math.floor(GAME_WIDTH / 2);
	const startY = Math.floor(GAME_HEIGHT / 2);
	return {
		snake: [
			{ x: startX, y: startY },
			{ x: startX - 1, y: startY },
			{ x: startX - 2, y: startY },
		],
		food: spawnFood([{ x: startX, y: startY }]),
		direction: "right",
		nextDirection: "right",
		score: 0,
		gameOver: false,
		highScore: 0,
	};
}

function spawnFood(snake: Point[]): Point {
	let food: Point;
	do {
		food = {
			x: Math.floor(Math.random() * GAME_WIDTH),
			y: Math.floor(Math.random() * GAME_HEIGHT),
		};
	} while (snake.some((s) => s.x === food.x && s.y === food.y));
	return food;
}

// ---------------------------------------------------------------------------
// SnakeComponent — Pi custom TUI component
// ---------------------------------------------------------------------------

class SnakeComponent {
	private state: GameState;
	private interval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (state: GameState | null) => void;
	private tui: { requestRender: () => void };

	// Render cache
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;

	// Pause state: true when resuming from a saved game
	private paused: boolean;

	constructor(
		tui: { requestRender: () => void },
		onClose: () => void,
		onSave: (state: GameState | null) => void,
		savedState?: GameState,
	) {
		this.tui = tui;
		this.onClose = onClose;
		this.onSave = onSave;

		if (savedState && !savedState.gameOver) {
			// Resume from saved state, start paused so player can see the board first
			this.state = savedState;
			this.paused = true;
		} else {
			// New game (or saved game was already over — start fresh, keep high score)
			this.state = createInitialState();
			if (savedState) {
				this.state.highScore = savedState.highScore;
			}
			this.paused = false;
			this.startGame();
		}
	}

	// -----------------------------------------------------------------------
	// Game loop
	// -----------------------------------------------------------------------

	private startGame(): void {
		this.interval = setInterval(() => {
			if (!this.state.gameOver) {
				this.tick();
				this.version++;
				this.tui.requestRender();
			}
		}, TICK_MS);
	}

	private tick(): void {
		// Apply the queued direction change
		this.state.direction = this.state.nextDirection;

		const head = this.state.snake[0];
		let newHead: Point;

		switch (this.state.direction) {
			case "up":
				newHead = { x: head.x, y: head.y - 1 };
				break;
			case "down":
				newHead = { x: head.x, y: head.y + 1 };
				break;
			case "left":
				newHead = { x: head.x - 1, y: head.y };
				break;
			case "right":
				newHead = { x: head.x + 1, y: head.y };
				break;
		}

		// Wall collision
		if (
			newHead.x < 0 ||
			newHead.x >= GAME_WIDTH ||
			newHead.y < 0 ||
			newHead.y >= GAME_HEIGHT
		) {
			this.state.gameOver = true;
			return;
		}

		// Self collision
		if (this.state.snake.some((s) => s.x === newHead.x && s.y === newHead.y)) {
			this.state.gameOver = true;
			return;
		}

		// Move: prepend new head
		this.state.snake.unshift(newHead);

		// Food collision
		if (newHead.x === this.state.food.x && newHead.y === this.state.food.y) {
			this.state.score += 10;
			if (this.state.score > this.state.highScore) {
				this.state.highScore = this.state.score;
			}
			this.state.food = spawnFood(this.state.snake);
		} else {
			// Remove tail to keep length constant
			this.state.snake.pop();
		}
	}

	// -----------------------------------------------------------------------
	// Input handling
	// -----------------------------------------------------------------------

	handleInput(data: string): void {
		// When resuming a saved game, any key starts the game (Q/Esc quit without saving)
		if (this.paused) {
			if (matchesKey(data, "escape") || data === "q" || data === "Q") {
				this.dispose();
				this.onClose();
				return;
			}
			// Any other key: unpause and begin the game loop
			this.paused = false;
			this.startGame();
			return;
		}

		// ESC → pause, save state, close
		if (matchesKey(data, "escape")) {
			this.dispose();
			this.onSave(this.state);
			this.onClose();
			return;
		}

		// Q → quit, clear saved state, close
		if (data === "q" || data === "Q") {
			this.dispose();
			this.onSave(null);
			this.onClose();
			return;
		}

		// Direction keys (arrow keys + WASD)
		if (matchesKey(data, "up") || data === "w" || data === "W") {
			if (this.state.direction !== "down") this.state.nextDirection = "up";
		} else if (matchesKey(data, "down") || data === "s" || data === "S") {
			if (this.state.direction !== "up") this.state.nextDirection = "down";
		} else if (matchesKey(data, "right") || data === "d" || data === "D") {
			if (this.state.direction !== "left") this.state.nextDirection = "right";
		} else if (matchesKey(data, "left") || data === "a" || data === "A") {
			if (this.state.direction !== "right") this.state.nextDirection = "left";
		}

		// Restart after game over
		if (this.state.gameOver && (data === "r" || data === "R" || data === " ")) {
			const highScore = this.state.highScore;
			this.state = createInitialState();
			this.state.highScore = highScore;
			this.onSave(null); // Clear saved state so restart is clean
			if (this.interval) {
				clearInterval(this.interval);
				this.interval = null;
			}
			this.startGame();
			this.version++;
			this.tui.requestRender();
		}
	}

	// -----------------------------------------------------------------------
	// Rendering
	// -----------------------------------------------------------------------

	invalidate(): void {
		// Clear render cache (called on theme changes / terminal resize)
		this.cachedWidth = 0;
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.cachedVersion === this.version) {
			return this.cachedLines;
		}

		const lines: string[] = [];

		// Each game cell is 2 chars wide to appear square
		// (terminal character cells are roughly 2:1 height:width aspect ratio)
		const cellWidth = 2;
		const effectiveWidth = Math.min(GAME_WIDTH, Math.floor((width - 4) / cellWidth));
		const effectiveHeight = GAME_HEIGHT;
		const boxWidth = effectiveWidth * cellWidth;

		// ANSI helpers (no theme dependency — works in all color modes)
		const dim    = (s: string) => `\x1b[2m${s}\x1b[22m`;
		const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
		const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
		const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
		const bold   = (s: string) => `\x1b[1m${s}\x1b[22m`;

		// Render a full-width content line inside the box border
		const boxLine = (content: string) => {
			const contentLen = visibleWidth(content);
			const padding = Math.max(0, boxWidth - contentLen);
			return dim(" │") + content + " ".repeat(padding) + dim("│");
		};

		// ── Top border ──────────────────────────────────────────────────────
		lines.push(this.padLine(dim(` ╭${"─".repeat(boxWidth)}╮`), width));

		// ── Header: title + scores ──────────────────────────────────────────
		const scoreText = `Score: ${bold(yellow(String(this.state.score)))}`;
		const highText  = `High: ${bold(yellow(String(this.state.highScore)))}`;
		const header    = `${bold(green("SNAKE"))} │ ${scoreText} │ ${highText}`;
		lines.push(this.padLine(boxLine(header), width));

		// ── Separator ───────────────────────────────────────────────────────
		lines.push(this.padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));

		// ── Game grid ───────────────────────────────────────────────────────
		for (let y = 0; y < effectiveHeight; y++) {
			let row = "";
			for (let x = 0; x < effectiveWidth; x++) {
				const isHead = this.state.snake[0].x === x && this.state.snake[0].y === y;
				const isBody = this.state.snake.slice(1).some((s) => s.x === x && s.y === y);
				const isFood = this.state.food.x === x && this.state.food.y === y;

				if (isHead) {
					row += green("██");  // Snake head  — 2 chars
				} else if (isBody) {
					row += green("▓▓");  // Snake body  — 2 chars
				} else if (isFood) {
					row += red("◆ ");    // Food        — 2 chars
				} else {
					row += "  ";         // Empty cell  — 2 spaces
				}
			}
			lines.push(this.padLine(dim(" │") + row + dim("│"), width));
		}

		// ── Separator ───────────────────────────────────────────────────────
		lines.push(this.padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));

		// ── Footer: controls / status ───────────────────────────────────────
		let footer: string;
		if (this.paused) {
			footer = `${yellow(bold("PAUSED"))} — press any key to continue, ${bold("Q")} to quit`;
		} else if (this.state.gameOver) {
			footer = `${red(bold("GAME OVER!"))} — ${bold("R")} restart  ${bold("Q")} quit`;
		} else {
			footer = `↑↓←→ / WASD move  ${bold("ESC")} pause+save  ${bold("Q")} quit`;
		}
		lines.push(this.padLine(boxLine(footer), width));

		// ── Bottom border ────────────────────────────────────────────────────
		lines.push(this.padLine(dim(` ╰${"─".repeat(boxWidth)}╯`), width));

		// Store cache
		this.cachedLines  = lines;
		this.cachedWidth  = width;
		this.cachedVersion = this.version;

		return lines;
	}

	/** Pad a rendered line so it always fills `width` visible columns. */
	private padLine(line: string, width: number): string {
		const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
		const padding = Math.max(0, width - visibleLen);
		return line + " ".repeat(padding);
	}

	// -----------------------------------------------------------------------
	// Cleanup
	// -----------------------------------------------------------------------

	dispose(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}
}

// ---------------------------------------------------------------------------
// Pi extension entry point
// ---------------------------------------------------------------------------

/** Session entry type used to persist game state across /snake open/close. */
const SNAKE_SAVE_TYPE = "snake-save";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("snake", {
		description: "Play Snake! (works while Pi runs a long task)",

		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Snake requires interactive mode (not print/JSON mode)", "error");
				return;
			}

			// ----------------------------------------------------------------
			// Task 3: Restore saved game state from the Pi session log
			// ----------------------------------------------------------------
			const entries = ctx.sessionManager.getEntries();
			let savedState: GameState | undefined;

			// Walk entries in reverse so we always find the MOST RECENT save
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i];
				if (entry.type === "custom" && entry.customType === SNAKE_SAVE_TYPE) {
					// A null data entry means the player quit (cleared state)
					if (entry.data !== null && entry.data !== undefined) {
						savedState = entry.data as GameState;
					}
					break;
				}
			}

			// ----------------------------------------------------------------
			// Launch the game — ctx.ui.custom() hands full-screen TUI control
			// to SnakeComponent until done() is called (Esc / Q)
			// ----------------------------------------------------------------
			await ctx.ui.custom((tui, _theme, _kb, done) => {
				return new SnakeComponent(
					tui,
					() => done(undefined),         // onClose: return control to Pi
					(state) => {
						// onSave: persist (or clear) game state in the session log.
						// pi.appendEntry stores state without sending it to the LLM.
						pi.appendEntry(SNAKE_SAVE_TYPE, state);
					},
					savedState,
				);
			});
		},
	});
}
