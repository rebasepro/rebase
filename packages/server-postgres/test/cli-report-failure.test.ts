/**
 * The driver CLI's last frame: what a developer is told when a command throws.
 *
 * Every case here was silent before — `runPluginCommand(...).catch(() =>
 * process.exit(1))` discarded the error, so `rebase db branch create` on a
 * database with open connections printed a header and exited 1 with an empty
 * stderr. These assert that the message survives to stderr, and that the two
 * shapes worth suppressing still are.
 */
import { reportCommandFailure } from "../src/cli-errors";

describe("reportCommandFailure", () => {
    let stderr: string[];
    let spy: jest.SpyInstance;

    beforeEach(() => {
        stderr = [];
        spy = jest.spyOn(console, "error").mockImplementation((line?: unknown) => {
            stderr.push(String(line ?? ""));
        });
    });

    afterEach(() => spy.mockRestore());

    const written = () => stderr.join("\n");

    it("prints the message of a plain Error", () => {
        reportCommandFailure(new Error('Branch "try_it" already exists.'));

        expect(written()).toContain('Branch "try_it" already exists.');
    });

    it("prints the actionable message BranchService raises for a busy source", () => {
        reportCommandFailure(new Error(
            'Cannot create branch: the source database "leadgen" has active connections. '
            + "Close other clients or connections and try again."
        ));

        expect(written()).toContain("has active connections");
        expect(written()).toContain("Close other clients");
    });

    it("stays quiet for a child process that already wrote its own diagnosis", () => {
        // Atlas and pg_dump run with inherited stdio; execa's wrapper would only
        // repeat the command line under a red cross.
        reportCommandFailure(new Error("Command failed with exit code 1: atlas schema apply"));

        expect(stderr).toHaveLength(0);
    });

    it("stays quiet for the other execa phrasing", () => {
        reportCommandFailure(new Error("Process exited with code 2"));

        expect(stderr).toHaveLength(0);
    });

    it("appends the PostgreSQL cause Drizzle hides behind its query wrapper", () => {
        const wrapper = new Error("Failed query: CREATE DATABASE \"rb_x\" TEMPLATE \"leadgen\" params:");
        wrapper.cause = new Error('source database "leadgen" is being accessed by other users');

        reportCommandFailure(wrapper);

        expect(written()).toContain("Failed query");
        expect(written()).toContain("is being accessed by other users");
    });

    it("does not repeat a cause the message already carries", () => {
        const wrapper = new Error("permission denied for table leads");
        wrapper.cause = new Error("permission denied for table leads");

        reportCommandFailure(wrapper);

        expect(written().match(/permission denied/g)).toHaveLength(1);
    });

    it("survives a thrown non-Error", () => {
        reportCommandFailure("something went wrong");

        expect(written()).toContain("something went wrong");
    });

    it("prints nothing at all for an error with no message", () => {
        reportCommandFailure(new Error(""));

        expect(stderr).toHaveLength(0);
    });
});
