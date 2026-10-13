import React from "react";
import { render } from "@testing-library/react";
import type { RebasePlugin } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import { resetDeprecationWarningsForTests } from "@rebasepro/common";

/**
 * `hooks.modifyCollectionAsync` and `lifecycle.onCollectionChange` were part of
 * the declared plugin API and nothing ever called them: a plugin that relied on
 * either did nothing, and said nothing about it. They are deprecated in the
 * types, and a plugin that sets one is told at runtime — once, by name, with
 * the hook to use instead.
 */

const client = {
    data: { collection: () => ({}) },
    auth: {},
    fetchStorageSources: async () => []
} as never;

const authController = {
    user: null,
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: async () => "t",
    signOut: async () => undefined,
    extra: null,
    setExtra: () => undefined
};

function renderWith(plugins: RebasePlugin[]) {
    return render(
        <Rebase authController={authController} client={client} storageSource={{} as never} plugins={plugins}>
            <div/>
        </Rebase>
    );
}

/** Every line written to the console's warn and error channels that mentions `text`. */
function linesMentioning(spies: jest.SpyInstance[], text: string): string[] {
    return spies.flatMap(spy => spy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")))
        .filter(line => line.includes(text));
}

describe("a plugin that sets a deprecated key nothing calls", () => {
    let spies: jest.SpyInstance[];
    beforeEach(() => {
        resetDeprecationWarningsForTests();
        spies = [
            jest.spyOn(console, "warn").mockImplementation(() => undefined),
            jest.spyOn(console, "error").mockImplementation(() => undefined)
        ];
    });
    afterEach(() => spies.forEach(spy => spy.mockRestore()));

    it("names hooks.modifyCollectionAsync, the plugin, and what to use instead — once", () => {
        const plugins: RebasePlugin[] = [{ key: "remote-config", hooks: { modifyCollectionAsync: async (c) => c } }];
        const first = renderWith(plugins);
        first.unmount();
        renderWith([...plugins]).unmount();

        const lines = linesMentioning(spies, "hooks.modifyCollectionAsync");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("remote-config");
        expect(lines[0]).toContain("`hooks.modifyCollection`");
    });

    it("names lifecycle.onCollectionChange and what to use instead — once", () => {
        const plugins: RebasePlugin[] = [{ key: "analytics", lifecycle: { onCollectionChange: () => undefined } }];
        renderWith(plugins).unmount();
        renderWith([...plugins]).unmount();

        const lines = linesMentioning(spies, "lifecycle.onCollectionChange");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("analytics");
        expect(lines[0]).toContain(".listen(");
    });

    it("says nothing about a plugin that uses only hooks that run", () => {
        renderWith([{
            key: "fine",
            hooks: { modifyCollection: (c) => c },
            lifecycle: { onMount: () => undefined }
        }]).unmount();

        expect(linesMentioning(spies, "Plugin \"fine\"")).toEqual([]);
    });
});
