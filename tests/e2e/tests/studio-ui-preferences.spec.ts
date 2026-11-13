/**
 * The collection editor saves a presentation change as a UI preference, not
 * as schema.
 *
 * A save is split (`splitEdit` in packages/cms/src/collection_editor): what
 * changes the table goes to the schema editor as `TablePatch`es — planned,
 * reviewed, committed — and what only changes how the panel draws it goes to
 * `PUT /api/admin/ui-config/workspace/:slug`. Under `rebase dev` the workspace
 * preferences are written to `frontend/src/cms/ui-config.json`, the file the
 * app passes to `<RebaseCMS uiConfig>`. Renaming a table in the panel is the
 * plainest such change: it must not open the schema review, it must land in
 * the workspace preferences, and the panel must draw the new name.
 *
 * The run writes into `app/frontend/src/cms/ui-config.json` in this checkout,
 * so it removes its preference afterwards through the same route, and puts the
 * file back if that left anything of its own behind.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { AUTH_STATE, freshSession } from "../auth";
import { failOnPageErrors, getApiBaseUrl, getAuthHeaders } from "./test-helpers";

test.use({ storageState: AUTH_STATE });
test.beforeEach(({ context }) => freshSession(context));

const UI_CONFIG = path.resolve(__dirname, "../../../app/frontend/src/cms/ui-config.json");
const SLUG = "tags";
const RENAMED = "Labels E2E";

interface UiConfigAnswer {
    workspace?: Record<string, { name?: string } | undefined>;
    workspaceTarget?: string;
}

async function workspacePreferences(): Promise<UiConfigAnswer> {
    const res = await fetch(`${getApiBaseUrl()}/api/admin/ui-config`, { headers: await getAuthHeaders() });
    expect(res.status).toBe(200);
    return await res.json() as UiConfigAnswer;
}

test.describe("Studio: a presentation change is a UI preference", () => {
    let original: string | undefined;

    test.beforeAll(() => {
        original = fs.existsSync(UI_CONFIG) ? fs.readFileSync(UI_CONFIG, "utf8") : undefined;
    });

    test.afterAll(async () => {
        await fetch(`${getApiBaseUrl()}/api/admin/ui-config/workspace/${SLUG}`, {
            method: "DELETE",
            headers: await getAuthHeaders()
        });
        if (original !== undefined && fs.existsSync(UI_CONFIG) && fs.readFileSync(UI_CONFIG, "utf8").includes(RENAMED)) {
            fs.writeFileSync(UI_CONFIG, original, "utf8");
        }
    });

    test("renaming a table writes the workspace preferences and the panel draws it", async ({ page }) => {
        failOnPageErrors(page);
        const before = await workspacePreferences();
        expect(before.workspace?.[SLUG]?.name).toBeUndefined();

        // The schema editor lists the tables; picking one opens its editor.
        await page.goto("/schema");
        await page.getByRole("main").getByRole("button", { name: "Tags", exact: true }).click();
        const nameInput = page.getByLabel("Name", { exact: true });
        await expect(nameInput).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(500); // the form hydrates after the dialog animates in
        await nameInput.fill(RENAMED);
        await expect(nameInput).toHaveValue(RENAMED);

        const save = page.getByRole("button", { name: "Update collection" });
        await expect(save).toBeEnabled();
        const written = page.waitForResponse(response =>
            response.url().includes(`/api/admin/ui-config/workspace/${SLUG}`) && response.request().method() === "PUT");
        await save.click();
        expect((await written).status()).toBeLessThan(300);

        // Nothing about the table changed, so nothing is planned or committed.
        await expect(page.getByText("Review schema change")).toHaveCount(0);

        const after = await workspacePreferences();
        expect(after.workspace?.[SLUG]?.name).toBe(RENAMED);
        // `rebase dev` keeps workspace preferences in the project's source.
        expect(after.workspaceTarget).toBe("file");
        expect(fs.readFileSync(UI_CONFIG, "utf8")).toContain(RENAMED);

        // And the panel draws the table under its new name.
        await page.goto("/");
        await expect(page.getByRole("link").filter({ hasText: RENAMED }).first()).toBeVisible({ timeout: 15000 });
    });
});
