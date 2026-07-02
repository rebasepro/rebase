import { installShutdownHandlers } from "../src/init/shutdown";

// Use SIGUSR2 in tests so we never trigger listeners that other tooling
// may have registered on SIGTERM/SIGINT.
const TEST_SIGNAL: NodeJS.Signals = "SIGUSR2";

function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("installShutdownHandlers", () => {
    let uninstall: (() => void) | undefined;

    afterEach(() => {
        uninstall?.();
        uninstall = undefined;
    });

    it("drains the backend, runs cleanup, and exits 0", async () => {
        const calls: string[] = [];
        const backend = {
            shutdown: async () => { calls.push("shutdown"); }
        };
        const exit = jest.fn(() => { calls.push("exit"); });

        uninstall = installShutdownHandlers(backend, {
            signals: [TEST_SIGNAL],
            onCleanup: () => { calls.push("cleanup"); },
            exit: exit as unknown as (code: number) => void
        });

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(calls).toEqual(["shutdown", "cleanup", "exit"]);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it("ignores repeated signals while shutting down", async () => {
        const shutdown = jest.fn(async () => { await flushAsync(); });
        const exit = jest.fn();

        uninstall = installShutdownHandlers({ shutdown }, {
            signals: [TEST_SIGNAL],
            exit: exit as unknown as (code: number) => void
        });

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();
        await flushAsync();

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it("exits 1 when the backend drain fails", async () => {
        const exit = jest.fn();

        uninstall = installShutdownHandlers(
            { shutdown: async () => { throw new Error("drain failed"); } },
            { signals: [TEST_SIGNAL], exit: exit as unknown as (code: number) => void }
        );

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(exit).toHaveBeenCalledWith(1);
    });

    it("exits 1 when cleanup fails", async () => {
        const exit = jest.fn();

        uninstall = installShutdownHandlers(
            { shutdown: async () => {} },
            {
                signals: [TEST_SIGNAL],
                onCleanup: () => { throw new Error("pool close failed"); },
                exit: exit as unknown as (code: number) => void
            }
        );

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(exit).toHaveBeenCalledWith(1);
    });

    it("force-exits 1 when shutdown hangs past timeoutMs", async () => {
        const exit = jest.fn();

        uninstall = installShutdownHandlers(
            // Never resolves — simulates a hung drain.
            { shutdown: () => new Promise<void>(() => {}) },
            {
                signals: [TEST_SIGNAL],
                timeoutMs: 30,
                exit: exit as unknown as (code: number) => void
            }
        );

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(exit).toHaveBeenCalledWith(1);
    });

    it("uninstall removes the signal listeners", async () => {
        const shutdown = jest.fn(async () => {});
        const exit = jest.fn();

        const remove = installShutdownHandlers({ shutdown }, {
            signals: [TEST_SIGNAL],
            exit: exit as unknown as (code: number) => void
        });
        remove();

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(shutdown).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});
