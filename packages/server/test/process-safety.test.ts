import { describe, expect, it, afterEach } from "@jest/globals";

import { installUnhandledRejectionHandler } from "../src/init/process-safety";

/**
 * One floating promise in application code must not end the process.
 *
 * Node terminates on an unhandled rejection by default. Hono catches anything
 * thrown or rejected inside an awaited handler, so the ordinary request path is
 * covered — but a fire-and-forget `void syncToCrm(body)` in one custom function
 * rejects outside Hono's frame. On the managed runtime the process is shared
 * between tenants, so the blast radius of that one `void` is every other
 * tenant's functions on the pod, with nothing in the request log to point at:
 * the request that started it succeeded.
 */
describe("installUnhandledRejectionHandler", () => {
    const uninstallers: Array<() => void> = [];

    afterEach(() => {
        while (uninstallers.length) uninstallers.pop()!();
        delete process.env.REBASE_EXIT_ON_UNHANDLED_REJECTION;
    });

    it("registers a listener, so Node's terminate-by-default does not apply", () => {
        const before = process.listenerCount("unhandledRejection");

        const uninstall = installUnhandledRejectionHandler();
        expect(uninstall).toBeDefined();
        uninstallers.push(uninstall!);

        expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
    });

    it("installs exactly one listener however many copies of the module boot", () => {
        const uninstall = installUnhandledRejectionHandler();
        uninstallers.push(uninstall!);
        const after = process.listenerCount("unhandledRejection");

        // The singleton is process-global for the same reason: the image and a
        // project's bundle can each load their own copy of this package.
        expect(installUnhandledRejectionHandler()).toBeUndefined();
        expect(process.listenerCount("unhandledRejection")).toBe(after);
    });

    it("stays out of the way when the operator wants Node's default", () => {
        process.env.REBASE_EXIT_ON_UNHANDLED_REJECTION = "1";
        const before = process.listenerCount("unhandledRejection");

        expect(installUnhandledRejectionHandler()).toBeUndefined();
        expect(process.listenerCount("unhandledRejection")).toBe(before);
    });
});
