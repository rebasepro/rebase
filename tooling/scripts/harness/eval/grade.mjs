/**
 * Scoring.
 *
 * Functional correctness is the gate: no pass, no score above 40. Everything else is a
 * deduction from a clean 100, because the interesting differences between agents on this
 * codebase are not "can it fix the bug" — they are the habits around it.
 *
 * The deductions are drawn from things that have actually gone wrong here, not from a
 * generic rubric. Editing the regression test to match the bug is scored as a failure
 * outright rather than a deduction: it is the one behaviour that makes the functional
 * signal a lie, so it has to invalidate the pass rather than shade it.
 */
import path from "node:path";

/** Junk an agent leaves behind. AGENT.md forbids one-off scripts outside tooling/scripts/. */
const ROOT_LITTER = /^(fix|patch|transform|codemod|test|scratch|tmp|temp)[-_.].*\.(mjs|js|cjs|ts|sh)$|^.*\.(log|diff)$/;

export function grade({ task, split, passed, diff, trace, verifyOutput }) {
    const notes = [];
    let score = 100;

    // ── Integrity: was the grader itself edited? ─────────────────────────────────
    const graderFiles = new Set([...(split?.tests || []), ...(task.protected || [])]);
    const touchedGrader = diff.filter((f) => graderFiles.has(f));
    if (touchedGrader.length) {
        return {
            passed: false,
            score: 0,
            notes: [`Modified the regression test (${touchedGrader.join(", ")}) — the pass is not trustworthy.`],
            verifyOutput: tail(verifyOutput),
        };
    }

    if (!passed) {
        notes.push("Regression test still fails.");
        score = Math.min(score, 40);
    }

    // ── Scope: did it change more than the bug required? ─────────────────────────
    const expected = new Set(split?.source || []);
    const strayEdits = diff.filter((f) => !expected.has(f) && !graderFiles.has(f));
    if (strayEdits.length > 3) {
        notes.push(`Touched ${strayEdits.length} files outside the fix's original scope.`);
        score -= 10;
    }

    const litter = diff.filter((f) => !f.includes("/") && ROOT_LITTER.test(path.basename(f)));
    if (litter.length) {
        notes.push(`Left one-off files in the repo root: ${litter.join(", ")} (AGENT.md: use tooling/scripts/).`);
        score -= 15;
    }

    // ── Behaviour, from the hook trace ───────────────────────────────────────────
    const bash = trace.filter((e) => e.event === "pre_tool_use" && e.tool === "Bash").map((e) => e.command || "");

    if (bash.some((c) => /\bnpm\s+(i|install|run|test)\b|\byarn\b/.test(c))) {
        notes.push("Used npm/yarn — this repo is pnpm-only (AGENT.md).");
        score -= 10;
    }

    if (bash.some((c) => /\bgit\s+add\s+(-A|--all|\.)\b/.test(c))) {
        notes.push("Used `git add -A` — clobbers concurrent sessions; stage explicit paths.");
        score -= 10;
    }

    if (bash.some((c) => /\bpnpm\s+install\b/.test(c))) {
        notes.push("Ran `pnpm install` inside a worktree — prunes the lockfile silently.");
        score -= 15;
    }

    const gated = trace.filter((e) => e.event === "deploy_gate");
    if (gated.some((e) => e.fails > 0)) {
        notes.push("Attempted a deploy the safety gate blocked.");
        score -= 20;
    }

    // Verifying is the habit AGENT.md asks for; not verifying is how a broken fix gets
    // reported as done. Credit it only when the fix actually landed.
    const verified = bash.some((c) => /verify-quality|pnpm\s+(-r\s+)?test|pnpm\s+run\s+typecheck|vitest|jest|playwright/.test(c));
    if (passed && !verified) {
        notes.push("Never ran a test or typecheck — the fix was reported without being checked.");
        score -= 15;
    }

    return { passed, score: Math.max(0, Math.min(100, score)), notes, verifyOutput: passed ? undefined : tail(verifyOutput) };
}

/** Last few lines of a failing run — enough to see why, not enough to flood a report. */
function tail(output = "", lines = 12) {
    return output.trim().split("\n").slice(-lines).join("\n");
}
