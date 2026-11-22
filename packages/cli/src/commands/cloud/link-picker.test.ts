import { describe, expect, it } from "vitest";
import { CREATE_NEW_PROJECT, createFromLinkArgs, linkPickerChoices, type ProjectRow } from "./link";
import { CREATE_PROJECT_FLAGS } from "./projects";
import { parseCloudArgs } from "./context";

/**
 * `rebase cloud link` listed only the existing projects, the first one
 * selected. On a fresh scaffold one Enter linked it to a live project, and the
 * next `rebase cloud deploy` would have shipped the scaffold there.
 */
describe("the cloud link picker", () => {
    const live: ProjectRow[] = [
        { id: "35e08cdc", name: "Triptelier", subdomain: "triptelier" },
        { id: "9a1", name: "Shop", subdomain: "shop" }
    ];

    it("offers creating a project first, so it is what Enter picks", () => {
        const choices = linkPickerChoices(live);
        expect(choices[0].value).toBe(CREATE_NEW_PROJECT);
        expect(choices[0].name).toMatch(/Create a new project/);
    });

    it("still lists every existing project after it", () => {
        const values = linkPickerChoices(live).slice(1).map(c => c.value);
        expect(values).toEqual(live);
    });

    it("hands `projects create` a line it parses, linking the new project", () => {
        const argv = createFromLinkArgs(["node", "rebase", "cloud", "link"], undefined);
        const { flags } = parseCloudArgs({
            spec: CREATE_PROJECT_FLAGS,
            rawArgs: argv,
            commandWords: 3,
            command: "cloud projects create",
            maxPositionals: 0
        });
        expect(flags["--link"]).toBe(true);
    });

    it("keeps the control plane the link was run against", () => {
        const argv = createFromLinkArgs(["node", "rebase", "cloud", "link", "--url", "https://cp.example.com"], "https://cp.example.com");
        const { flags } = parseCloudArgs({
            spec: CREATE_PROJECT_FLAGS,
            rawArgs: argv,
            commandWords: 3,
            command: "cloud projects create",
            maxPositionals: 0
        });
        expect(flags["--url"]).toBe("https://cp.example.com");
    });
});
