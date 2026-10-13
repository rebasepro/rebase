/**
 * The one yes/no question the driver CLI asks: before a destructive `db push`,
 * before a `db restore` without `--yes`, before `db branch prune` removes
 * anything, and before `schema introspect` samples rows.
 */
import readline from "readline";

/**
 * Ask a yes/no question on an interactive terminal; `true` only for "y" or
 * "yes".
 *
 * The `isTTY` guard is the contract, not an optimisation: non-interactive
 * shells (CI, pipes, agents) can never answer, and `readline` on a non-TTY
 * stdin resolves with whatever the pipe happens to contain, or never resolves
 * at all. Returning false there is what makes an unattended `db push` abort
 * instead of auto-confirming a destructive change. Callers decide first
 * whether interactive confirmation is possible (`decidePushSafety` for a
 * push); this is the backstop.
 *
 * Ctrl-C and Ctrl-D answer no. On a terminal readline reads Ctrl-C as a key,
 * not as a signal, and with nothing listening it only pauses the input: the
 * question never resolves, and the open database connections behind it keep
 * the process alive, so the command hung instead of stopping. Answering no
 * sends it down the path that says "Aborted" and cleans up.
 */
export async function promptConfirm(question: string): Promise<boolean> {
    if (!process.stdin.isTTY) return false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await new Promise<string>((resolve) => {
            rl.once("SIGINT", () => {
                process.stdout.write("\n");
                resolve("");
            });
            rl.once("close", () => resolve(""));
            rl.question(question, resolve);
        });
        return /^y(es)?$/i.test(answer.trim());
    } finally {
        rl.close();
    }
}
