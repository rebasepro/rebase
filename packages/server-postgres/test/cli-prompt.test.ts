/**
 * The driver CLI's one confirmation prompt.
 *
 * It guards a destructive `db push`, a `db restore` without `--yes` and
 * `db branch prune`, so both of its edges matter: it must never say yes for a
 * shell that cannot answer, and on a terminal every way of not answering
 * "yes" (typing something else, Ctrl-C, Ctrl-D) must come back as no rather
 * than leave the command hanging on a question nobody can finish.
 */
import { EventEmitter } from "events";
import readline from "readline";
import { promptConfirm } from "../src/cli-prompt";

jest.mock("readline");

/** A readline interface that emits like the real one and answers through `question`. */
class FakeInterface extends EventEmitter {
    question = jest.fn();
    close = jest.fn(() => {
        this.emit("close");
    });
}

describe("promptConfirm", () => {
    const realIsTTY = process.stdin.isTTY;
    let rl: FakeInterface;

    beforeEach(() => {
        jest.clearAllMocks();
        rl = new FakeInterface();
        (readline.createInterface as jest.Mock).mockReturnValue(rl);
    });

    afterEach(() => {
        Object.defineProperty(process.stdin, "isTTY", { value: realIsTTY, configurable: true });
    });

    const setTTY = (value: boolean | undefined) => {
        Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
    };

    // This guard is the last thing between `db push` in CI and an
    // unattended destructive migration. A non-TTY stdin cannot answer, so
    // returning `true` there would silently auto-confirm every prompt; and
    // readline must not even be opened, or the process hangs on a pipe that
    // never closes instead of exiting.
    it.each([[false], [undefined]])("refuses without prompting when isTTY is %s", async (isTTY) => {
        setTTY(isTTY as boolean | undefined);

        await expect(promptConfirm("apply destructive changes? ")).resolves.toBe(false);
        expect(readline.createInterface).not.toHaveBeenCalled();
    });

    // The mirror image: without this, "always return false" would satisfy the
    // assertions above and the prompt would be dead code.
    it("asks on a TTY and accepts an affirmative answer", async () => {
        setTTY(true);
        rl.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb(" YES "));

        await expect(promptConfirm("apply? ")).resolves.toBe(true);
        expect(readline.createInterface).toHaveBeenCalledTimes(1);
        expect(rl.close).toHaveBeenCalled();
    });

    it("asks on a TTY and refuses anything else", async () => {
        setTTY(true);
        rl.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb("no"));

        await expect(promptConfirm("apply? ")).resolves.toBe(false);
    });

    // On a terminal readline reads Ctrl-C as a key and emits `SIGINT` on the
    // interface. With no listener it only pauses the input: the question never
    // resolves and the open database connections keep the process alive.
    it("answers no to Ctrl-C instead of waiting forever", async () => {
        setTTY(true);
        jest.spyOn(process.stdout, "write").mockImplementation(() => true);
        rl.question.mockImplementation(() => {
            rl.emit("SIGINT");
        });

        await expect(promptConfirm("apply? ")).resolves.toBe(false);
        expect(rl.close).toHaveBeenCalled();
    });

    it("answers no when the input closes (Ctrl-D)", async () => {
        setTTY(true);
        rl.question.mockImplementation(() => {
            rl.emit("close");
        });

        await expect(promptConfirm("apply? ")).resolves.toBe(false);
    });
});
