/**
 * One result shape for every check, so the same check can be read by a human at a
 * terminal, parsed by the PreToolUse hook to decide whether to block, and scored by
 * the eval grader — without each caller reimplementing the severity rules.
 *
 * A check returns findings; it never decides the exit code. That belongs to the
 * runner, because the same finding blocks a deploy but only warns during `--advice`.
 */

export const FAIL = "fail";
export const WARN = "warn";
export const PASS = "pass";

const COLORS = { fail: "\x1b[31m", warn: "\x1b[33m", pass: "\x1b[32m", dim: "\x1b[2m", off: "\x1b[0m" };

/**
 * @param {string} id stable slug, used by eval graders and by `--skip`
 * @param {string} level FAIL | WARN | PASS
 * @param {string} message what is wrong, in one line
 * @param {string} [fix] the command or edit that resolves it
 */
export function finding(id, level, message, fix) {
    return { id, level, message, ...(fix ? { fix } : {}) };
}

export const pass = (id, message) => finding(id, PASS, message);

/** True when anything in the set should stop a deploy. */
export const blocking = (findings) => findings.some((f) => f.level === FAIL);

export function print(findings, { json = false, title = "" } = {}) {
    if (json) {
        process.stdout.write(JSON.stringify({ findings, blocking: blocking(findings) }, null, 2) + "\n");
        return;
    }

    if (title) process.stdout.write(`\n${COLORS.dim}━━━ ${title} ━━━${COLORS.off}\n`);

    for (const f of findings) {
        const glyph = f.level === FAIL ? "✗" : f.level === WARN ? "⚠" : "✓";
        process.stdout.write(`${COLORS[f.level]}${glyph} ${f.message}${COLORS.off}\n`);
        if (f.fix) process.stdout.write(`  ${COLORS.dim}→ ${f.fix}${COLORS.off}\n`);
    }
}
