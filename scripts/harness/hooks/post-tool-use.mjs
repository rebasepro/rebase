/**
 * Records the outcome of each tool call.
 *
 * The pre hook knows intent; only this one knows what happened. Graders need both —
 * "ran the test suite" and "the test suite passed" are different claims, and an agent
 * that reports the second having only observed the first is the specific failure this
 * trace exists to make visible.
 *
 * Purely observational: never blocks, never edits, always exits 0.
 */
import { context } from "../lib/ctx.mjs";
import { tracePath, append, readHookInput } from "../lib/trace.mjs";

const input = await readHookInput();

try {
    const ctx = context();
    const response = input.tool_response || {};
    const toolInput = input.tool_input || {};

    append(tracePath(ctx.primaryRoot, input.session_id), {
        event: "post_tool_use",
        tool: input.tool_name,
        command: toolInput.command,
        file: toolInput.file_path,
        // Bash results carry an exit code; file tools report success differently. Keep
        // whichever signal exists rather than normalising and losing the distinction.
        exit: response.exit_code ?? response.exitCode,
        interrupted: response.interrupted === true,
        error: typeof response.stderr === "string" ? response.stderr.slice(0, 500) : undefined,
    });
} catch {
    // Observation must never cost a tool call.
}

process.exit(0);
