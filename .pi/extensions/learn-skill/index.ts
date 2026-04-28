/**
 * Learn-Skill Extension
 *
 * Companion extension for the `learn-skill` SKILL.md workflow.
 *
 * Registers the `confirm_project_exploration` tool, which the agent calls
 * when it cannot find a relevant learning topic in the current session and
 * wants to fall back to reading the live project codebase.
 *
 * The tool presents an interactive confirmation dialog to the user.
 * The user can:
 *   - Approve (optionally typing a scope hint to focus exploration)
 *   - Decline (exploration is skipped; no files are written)
 *
 * Returns: { confirmed: boolean, scope?: string }
 *
 * Non-interactive mode (ctx.hasUI === false): returns { confirmed: false }
 * immediately so the skill can abort gracefully without blocking.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfirmResult {
  confirmed: boolean;
  scope?: string;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function learnSkillExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "confirm_project_exploration",
    label: "Confirm Project Exploration",
    description:
      "Ask the user for permission to explore the current project's codebase to find relevant learning material. " +
      "Call this tool when the learn-skill workflow cannot find a suitable topic in the current session. " +
      "Returns { confirmed: boolean, scope?: string }. " +
      "If confirmed is false, abort the learning capture immediately — do not read any project files.",

    parameters: Type.Object({
      query: Type.String({
        description:
          "The user's original learning query or topic request, shown verbatim in the confirmation dialog.",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // ------------------------------------------------------------------
      // Non-interactive mode: auto-decline to avoid hanging
      // ------------------------------------------------------------------
      if (!ctx.hasUI) {
        console.error(
          "[learn-skill] confirm_project_exploration: no UI available, declining automatically."
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ confirmed: false } satisfies ConfirmResult),
            },
          ],
          details: { confirmed: false } satisfies ConfirmResult,
        };
      }

      // ------------------------------------------------------------------
      // Interactive mode: show a custom confirmation + optional scope dialog
      // ------------------------------------------------------------------
      const result = await ctx.ui.custom<ConfirmResult>(
        (tui, theme, _kb, done) => {
          // ----------------------------------------------------------------
          // State
          // ----------------------------------------------------------------
          type Step = "confirm" | "scope";
          let step: Step = "confirm";
          // "confirm" step: 0 = Yes, 1 = No
          let selectedOption = 0;
          let cachedLines: string[] | undefined;

          // Scope editor (shown after user selects "Yes")
          const editorTheme: EditorTheme = {
            borderColor: (s) => theme.fg("accent", s),
            selectList: {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          };
          const editor = new Editor(tui, editorTheme);

          editor.onSubmit = (value) => {
            done({ confirmed: true, scope: value.trim() || undefined });
          };

          // ----------------------------------------------------------------
          // Helpers
          // ----------------------------------------------------------------
          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          // ----------------------------------------------------------------
          // Input handler
          // ----------------------------------------------------------------
          function handleInput(data: string) {
            if (step === "scope") {
              if (matchesKey(data, Key.escape)) {
                // User backed out of scope — confirm without scope
                done({ confirmed: true, scope: undefined });
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }

            // "confirm" step
            if (matchesKey(data, Key.up)) {
              selectedOption = Math.max(0, selectedOption - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              selectedOption = Math.min(1, selectedOption + 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.enter)) {
              if (selectedOption === 0) {
                // "Yes" — move to scope step
                step = "scope";
                editor.setText("");
                refresh();
              } else {
                // "No"
                done({ confirmed: false });
              }
              return;
            }
            if (matchesKey(data, Key.escape)) {
              done({ confirmed: false });
            }
          }

          // ----------------------------------------------------------------
          // Renderer
          // ----------------------------------------------------------------
          function render(width: number): string[] {
            if (cachedLines) return cachedLines;

            const lines: string[] = [];
            const add = (s: string) => lines.push(truncateToWidth(s, width));

            add(theme.fg("accent", "─".repeat(width)));
            add(
              " " +
                theme.fg("accent", theme.bold("🔍 Learn Skill — Project Exploration"))
            );
            lines.push("");

            if (step === "confirm") {
              // ---- Confirm step ----
              add(
                " " +
                  theme.fg("text", "No relevant topic was found in the current session.")
              );
              add(
                " " +
                  theme.fg(
                    "muted",
                    "The agent wants to explore this project's files to find learning material."
                  )
              );
              lines.push("");
              add(" " + theme.fg("dim", "Your query:"));
              add(
                " " +
                  theme.fg(
                    "text",
                    truncateToWidth(`"${params.query}"`, width - 2)
                  )
              );
              lines.push("");
              add(
                " " +
                  theme.fg(
                    "muted",
                    "The agent will read: README, manifests (package.json, etc.), and up to 3 source files."
                  )
              );
              lines.push("");

              const options = ["Yes — explore the project", "No — cancel"];
              for (let i = 0; i < options.length; i++) {
                const selected = i === selectedOption;
                const prefix = selected
                  ? theme.fg("accent", "> ")
                  : "  ";
                const color = selected ? "accent" : "text";
                add(prefix + theme.fg(color, options[i]!));
              }

              lines.push("");
              add(theme.fg("dim", " ↑↓ navigate • Enter select • Esc cancel"));
            } else {
              // ---- Scope step ----
              add(
                " " +
                  theme.fg("success", "✓ Exploration approved.")
              );
              add(
                " " +
                  theme.fg(
                    "text",
                    "Optionally narrow the search with a scope hint (e.g. \"auth module\", \"src/api\")."
                  )
              );
              add(
                " " +
                  theme.fg("muted", "Leave blank and press Enter to explore the whole project.")
              );
              lines.push("");
              add(" " + theme.fg("dim", "Scope hint (optional):"));
              for (const line of editor.render(width - 2)) {
                add(` ${line}`);
              }
              lines.push("");
              add(
                theme.fg(
                  "dim",
                  " Enter to confirm • Esc to skip scope and proceed"
                )
              );
            }

            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        }
      );

      // ------------------------------------------------------------------
      // Post-dialog notifications
      // ------------------------------------------------------------------
      if (result.confirmed) {
        const msg = result.scope
          ? `🔍 Project exploration starting (scope: "${result.scope}")…`
          : "🔍 Project exploration starting…";
        ctx.ui.notify(msg, "info");
      } else {
        ctx.ui.notify("🚫 Project exploration declined.", "info");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
        details: result,
      };
    },

    // ----------------------------------------------------------------------
    // Custom rendering in the TUI history
    // ----------------------------------------------------------------------
    renderCall(args, theme, _context) {
      const q = (args as { query?: string }).query ?? "";
      return new Text(
        theme.fg("toolTitle", theme.bold("confirm_project_exploration ")) +
          theme.fg("muted", truncateToWidth(`"${q}"`, 60)),
        0,
        0
      );
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as ConfirmResult | undefined;
      if (!details) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
      }
      if (!details.confirmed) {
        return new Text(theme.fg("warning", "✗ Declined — exploration cancelled"), 0, 0);
      }
      const scopePart = details.scope
        ? theme.fg("muted", ` (scope: "${details.scope}")`)
        : "";
      return new Text(
        theme.fg("success", "✓ Approved") + scopePart,
        0,
        0
      );
    },
  });
}
