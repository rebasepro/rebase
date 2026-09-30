/**
 * `rebase apps list`, one app per line.
 *
 * The line is where a developer checks where each app will be served, so it
 * has to print the address the platform will route — for an app declared at a
 * URL, the whole URL, and the CMS on that app's hostname rather than as a bare
 * path that reads as the project's own root.
 */
import { describe, expect, it } from "vitest";
import { describeApp } from "./apps";

// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("describeApp", () => {
    it("prints a path-mounted app the way it always has", () => {
        expect(plain(describeApp("web", { type: "static", root: "frontend", output: "frontend/dist", path: "/", cms: "/admin" })))
            .toBe("frontend → frontend/dist @ /  CMS at /admin");
    });

    it("prints an app on its own hostname at its URL, and its CMS there", () => {
        expect(plain(describeApp("admin", {
            type: "static",
            root: "admin",
            output: "admin/dist",
            path: "https://Admin.Dadaki.com",
            cms: "/"
        }))).toBe("admin → admin/dist @ https://admin.dadaki.com  CMS at https://admin.dadaki.com");
    });

    it("keeps the path part of a URL, for the app and for a CMS route under it", () => {
        expect(plain(describeApp("admin", {
            type: "static",
            root: "admin",
            output: "admin/dist",
            path: "https://admin.dadaki.com/cms",
            cms: "/cms/panel"
        }))).toBe("admin → admin/dist @ https://admin.dadaki.com/cms  CMS at https://admin.dadaki.com/cms/panel");
    });
});
