import React from "react";
import { renderToString } from "react-dom/server";
import type { RebasePlugin } from "@rebasepro/cms-types";
import { resetDeprecationWarningsForTests } from "@rebasepro/common";
import { useInsightsPlugin } from "./useInsightsPlugin";
import type { InsightsPluginConfig } from "./types";

// Building the plugin renders none of its slots, so the admin and the UI kit
// (which pull in the router, ESM this runner does not load) are stand-ins.
jest.mock("@rebasepro/app", () => ({}));
jest.mock("@rebasepro/ui", () => ({}));

const config: InsightsPluginConfig = {
    sources: { orders: async () => ({ revenue: 1 }) },
    insights: { home: [{ id: "revenue", title: "Revenue", source: "orders", value: { field: "revenue" } }] }
};

/** Calls the hook inside a render and hands back what it returned. */
function callHook(): RebasePlugin {
    let plugin: RebasePlugin | undefined;
    function Probe() {
        plugin = useInsightsPlugin(config);
        return null;
    }
    renderToString(<Probe/>);
    if (!plugin) throw new Error("The hook did not run");
    return plugin;
}

describe("useInsightsPlugin (deprecated)", () => {
    beforeEach(() => resetDeprecationWarningsForTests());

    it("still builds the plugin", () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const plugin = callHook();
        expect(plugin.key).toBe("plugin-insights");
        expect(plugin.slots?.map((slot) => slot.slot)).toEqual(["home.children.start"]);
    });

    it("warns once, naming what replaces it", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        callHook();
        callHook();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/useInsightsPlugin.*KpiTile.*useInsightData/);
    });

    afterEach(() => jest.restoreAllMocks());
});
