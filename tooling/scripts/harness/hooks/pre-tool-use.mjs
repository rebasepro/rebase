/**
 * The gate. Runs before every tool call; blocks deploy-shaped commands whose
 * preflight fails, and records every call to the session trace.
 *
 * Two rules keep this from becoming the kind of hook people disable:
 *
 *   1. It only interrupts on deploy-shaped commands. Everything else is traced
 *      silently. A gate that prompts on ordinary work gets turned off within a day.
 *   2. It fails open. If the harness itself throws, the tool call is allowed and the
 *      error goes to the trace. A broken check must not be able to wedge a session —
 *      the cost of a missed gate is lower than the cost of an agent that cannot work.
 *
 * FAIL findings deny outright. WARN findings escalate to the user rather than being
 * swallowed, because the control-plane warnings are exactly the class where the agent
 * cannot tell on its own which target was intended.
 */
import { context } from "../lib/ctx.mjs";
import { tracePath, append, readHookInput } from "../lib/trace.mjs";
import { isDeployShaped } from "../checks/control-plane.mjs";
import { runChecks, readStamp } from "../deploy/preflight.mjs";

function decide(decision, reason) {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
        }) + "\n",
    );
    process.exit(0);
}

const allow = () => process.exit(0); // silence is consent; no payload needed

const input = await readHookInput();
const toolName = input.tool_name || "";
const toolInput = input.tool_input || {};

let ctx;
let trace;
try {
    ctx = context();
    trace = tracePath(ctx.primaryRoot, input.session_id);
    append(trace, {
        event: "pre_tool_use",
        tool: toolName,
        // Enough to grade behaviour without copying whole file bodies into the trace.
        command: toolInput.command,
        file: toolInput.file_path,
        cwd: input.cwd,
        branch: ctx.branch,
        worktree: ctx.isWorktree,
    });
} catch {
    allow(); // context resolution failed — nothing to gate on
}

const command = typeof toolInput.command === "string" ? toolInput.command : "";
if (toolName !== "Bash" || !command || !isDeployShaped(command)) allow();

try {
    // A recent passing stamp for this exact tree means preflight already ran; re-running
    // the full check set on every deploy-shaped command would make the gate feel like lag.
    const stamped = readStamp(ctx);
    const findings = stamped ? stamped.findings : runChecks({ command });

    // The control-plane check is command-specific, so it always re-runs even when stamped.
    const commandFindings = stamped ? runChecks({ command }).filter((f) => f.id === "control-plane") : [];
    const all = [...findings.filter((f) => f.id !== "control-plane" || !stamped), ...commandFindings];

    const fails = all.filter((f) => f.level === "fail");
    const warns = all.filter((f) => f.level === "warn");

    append(trace, { event: "deploy_gate", command, fails: fails.length, warns: warns.length });

    if (fails.length) {
        decide(
            "deny",
            `Deploy preflight failed — this command is blocked:\n\n` +
                fails.map((f) => `• ${f.message}${f.fix ? `\n  Fix: ${f.fix}` : ""}`).join("\n\n") +
                `\n\nResolve these, then re-run: node tooling/scripts/harness/harness.mjs preflight`,
        );
    }

    if (warns.length) {
        decide(
            "ask",
            `Deploy preflight raised warnings:\n\n` +
                warns.map((f) => `• ${f.message}${f.fix ? `\n  Fix: ${f.fix}` : ""}`).join("\n\n") +
                `\n\nConfirm this is the intended target before proceeding.`,
        );
    }
} catch (error) {
    append(trace, { event: "gate_error", message: error.message });
}

allow();
