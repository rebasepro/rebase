/**
 * Benchmark tasks, derived from the repo's own fix commits.
 *
 * Hand-written eval tasks go stale and are expensive to keep honest. This repo already
 * contains a stream of high-quality ones: every commit that fixes a real bug *and* adds
 * the regression test proving it. Reverting only the source half of such a commit
 * reproduces the exact state the original author faced, with a grader — the test — that
 * was written by someone who understood the bug.
 *
 * So a task spec is deliberately thin: a commit, a prompt, and how to run the test. The
 * split between "source to revert" and "tests to keep" is inferred, and only needs an
 * override when a commit puts test helpers somewhere unusual.
 */
import { sh } from "../lib/ctx.mjs";

/** Paths that hold the grader rather than the implementation. */
const TEST_PATTERNS = [/(^|\/)tests?\//, /\.test\.[cm]?[jt]sx?$/, /\.spec\.[cm]?[jt]sx?$/, /(^|\/)e2e\//, /__tests__\//];

export function isTestPath(file) {
    return TEST_PATTERNS.some((re) => re.test(file));
}

/**
 * The commit that added the admin customization recipes, named by its subject
 * rather than its hash: these tasks were written beside commits that had not
 * landed yet, and a rebase onto the main branch changes every hash under it.
 *
 * Each customization task reverts one recipe and asks an agent to build what it
 * does from the request alone, with the recipe's test as the grader. What it
 * measures is whether the admin's building blocks, hooks and places — and the
 * README beside the recipes, which the revert leaves in place — are enough for
 * an agent to customize the admin on the first try. A failure names the part
 * that is hard to use, which is the thing to fix.
 */
const CUSTOMIZATION_RECIPES = { subject: "feat(cms): tested customization recipes, shipped in the package" };

/** What every customization prompt adds: the one constraint the grader depends on. */
const CUSTOMIZATION_HINT =
    " Import only from package entry points (@rebasepro/app, @rebasepro/cms, @rebasepro/cms-types, @rebasepro/types, @rebasepro/ui) and react.";

/**
 * The seed set.
 *
 * `verify` is scoped to the narrowest command that actually proves the fix — a full
 * `pnpm test` would take the harness from minutes to tens of minutes per task and would
 * blur a real failure into unrelated noise.
 *
 * It also never goes through pnpm. An eval worktree gets its node_modules by symlink, and
 * pnpm reads a workspace-state file through that link and dies with ELOOP — which the
 * runner would otherwise have read as "the bug reproduced", passing the gate for the
 * wrong reason. Invoking the test runner directly keeps a verify failure meaningful.
 * `--passWithNoTests` is likewise omitted on purpose: a filter that matches nothing must
 * fail the task, not exit 0.
 *
 * `cwd` is relative to the worktree root; `{worktree}` in cmd/args is substituted with it.
 */
export const TASKS = [
    {
        id: "dev-port-retry",
        commit: "3c896876d",
        prompt:
            "Users report that `rebase dev` prints a backend URL on a port that something else is already serving. " +
            "It happens only when the first port it tries is already taken. The announced port is wrong — requests to it " +
            "reach a different process. Find the root cause in the dev server's port selection and fix it.",
        verify: {
            cwd: "packages/server",
            cmd: "{worktree}/packages/server/node_modules/.bin/jest",
            args: ["dev-port", "--forceExit"],
            env: { NODE_OPTIONS: "--experimental-vm-modules" },
        },
        /** What a correct fix must not do: make the test agree with the bug. */
        protected: ["packages/server/test/dev-port.test.ts"],
    },
    {
        id: "template-image-import",
        commit: "ff9ccd6df",
        prompt:
            "A user scaffolded a project with `rebase init`, added a custom Field component that imports a PNG, and the " +
            "config build now fails. Reproduce the failure in the template's config typecheck and fix it so a custom " +
            "component importing an image asset compiles.",
        verify: { cmd: "node", args: ["tooling/scripts/check-templates.mjs"] },
        protected: ["tooling/scripts/check-templates.mjs"],
    },

    // ── Customization tasks ──────────────────────────────────────────────────────
    {
        id: "customize-site-settings",
        ...CUSTOMIZATION_RECIPES,
        prompt:
            "Our admin needs a \"Site settings\" page: one settings record \u2014 site name (`siteName`, required, defaulting to \"My site\"), `tagline`, `maintenanceMode` (boolean) and `supportEmail` \u2014 that admins edit on a page of its own. There is only ever one such record and nobody should have to create or seed it by hand: the first save creates it. Write it in packages/cms/recipes/site-settings.tsx, exporting `SiteSettingsPage` (the page component), `SITE_SETTINGS_ID` (the id of the one record), `siteSettingsCollection` (its collection, slug `site_settings`) and `siteSettingsView` (an AppView for `<RebaseCMS views>`)." +
            CUSTOMIZATION_HINT,
        verify: {
            cwd: "packages/cms",
            cmd: "{worktree}/packages/cms/node_modules/.bin/jest",
            args: ["test/recipes/site-settings.test.tsx"],
        },
        source: ["packages/cms/recipes/site-settings.tsx"],
        protected: ["packages/cms/test/recipes/site-settings.test.tsx", "packages/cms/test/recipes/recipe_harness.tsx"],
    },
    {
        id: "customize-my-preferences",
        ...CUSTOMIZATION_RECIPES,
        prompt:
            "Add a \"My preferences\" page to our admin where each signed-in user edits their own preferences: `theme` (\"system\", \"light\" or \"dark\", default \"system\") and `weeklyDigest` (boolean, default true), stored in collection `user_preferences`, one record per user keyed by the user's uid. A user's first save creates their record; somebody else's record must never be touched; with nobody signed in the page renders nothing. Write it in packages/cms/recipes/my-preferences.tsx, exporting `MyPreferencesPage`, `userPreferencesCollection` and `myPreferencesView` (an AppView)." +
            CUSTOMIZATION_HINT,
        verify: {
            cwd: "packages/cms",
            cmd: "{worktree}/packages/cms/node_modules/.bin/jest",
            args: ["test/recipes/my-preferences.test.tsx"],
        },
        source: ["packages/cms/recipes/my-preferences.tsx"],
        protected: ["packages/cms/test/recipes/my-preferences.test.tsx", "packages/cms/test/recipes/recipe_harness.tsx"],
    },
    {
        id: "customize-bulk-set-status",
        ...CUSTOMIZATION_RECIPES,
        prompt:
            "Admins want to archive many rows at once from a collection's table: tick rows, click \"Archive selected\", and every selected row's `status` becomes \"archived\". The button must only appear while rows are selected, and the selection is cleared afterwards. Write it as a component for a collection's toolbar (`admin.Actions`) in packages/cms/recipes/bulk-set-status.tsx, exported as `ArchiveSelectedAction`." +
            CUSTOMIZATION_HINT,
        verify: {
            cwd: "packages/cms",
            cmd: "{worktree}/packages/cms/node_modules/.bin/jest",
            args: ["test/recipes/bulk-set-status.test.tsx"],
        },
        source: ["packages/cms/recipes/bulk-set-status.tsx"],
        protected: ["packages/cms/test/recipes/bulk-set-status.test.tsx", "packages/cms/test/recipes/recipe_harness.tsx"],
    },
    {
        id: "customize-calendar-view",
        ...CUSTOMIZATION_RECIPES,
        prompt:
            "Add a calendar view mode to the admin so a collection's rows can be seen on a month grid by their `dueDate`, showing each row's `title`; rows without a date are left out. Clicking a row opens its record. Buttons labelled \"Previous month\" and \"Next month\" (aria-label) move between months, starting from the current one. Each day cell carries `data-day=\"<year>-<monthIndex>-<date>\"` (month index from 0). Write it in packages/cms/recipes/calendar-view.tsx, exporting `calendarView` (a collection view with key \"calendar\") and `CalendarView`." +
            CUSTOMIZATION_HINT,
        verify: {
            cwd: "packages/cms",
            cmd: "{worktree}/packages/cms/node_modules/.bin/jest",
            args: ["test/recipes/calendar-view.test.tsx"],
        },
        source: ["packages/cms/recipes/calendar-view.tsx"],
        protected: ["packages/cms/test/recipes/calendar-view.test.tsx", "packages/cms/test/recipes/recipe_harness.tsx"],
    },
    {
        id: "customize-orders-dashboard",
        ...CUSTOMIZATION_RECIPES,
        prompt:
            "Build an orders dashboard page for the admin: the total number of orders, and a bar per `status` with its count, largest first; an order without a status counts under \"\u2014\". Each status row is a link to the orders collection with aria-label \"<status>: <count>\". Write it in packages/cms/recipes/orders-dashboard.tsx, exporting `OrdersDashboard` and `ordersDashboardView` (an AppView)." +
            CUSTOMIZATION_HINT,
        verify: {
            cwd: "packages/cms",
            cmd: "{worktree}/packages/cms/node_modules/.bin/jest",
            args: ["test/recipes/orders-dashboard.test.tsx"],
        },
        source: ["packages/cms/recipes/orders-dashboard.tsx"],
        protected: ["packages/cms/test/recipes/orders-dashboard.test.tsx", "packages/cms/test/recipes/recipe_harness.tsx"],
    },
    {
        id: "customize-custom-login",
        ...CUSTOMIZATION_RECIPES,
        prompt:
            "Replace the admin's login screen with our own branded one: the title \"Acme back office\", an \"Email\" and a \"Password\" field, and a \"Sign in\" button that signs in with email and password. If sign-in fails, show the error message in an element with role=\"alert\". Write it in packages/cms/recipes/custom-login.tsx, exporting `BrandedLoginView`, which takes `{ authController }` and is registered through `<Rebase components={{ \"Auth.LoginView\": { Component: BrandedLoginView } }}>`." +
            CUSTOMIZATION_HINT,
        verify: {
            cwd: "packages/cms",
            cmd: "{worktree}/packages/cms/node_modules/.bin/jest",
            args: ["test/recipes/custom-login.test.tsx"],
        },
        source: ["packages/cms/recipes/custom-login.tsx"],
        protected: ["packages/cms/test/recipes/custom-login.test.tsx", "packages/cms/test/recipes/recipe_harness.tsx"],
    },];

/**
 * The commit a task is pinned to: its `commit`, or the newest commit whose
 * subject line is its `subject`. Empty when there is none.
 */
export function resolveCommit(root, task) {
    if (task.commit) return task.commit;
    if (!task.subject) return "";
    const subjects = sh("git", ["log", "--format=%h%x09%s", "--fixed-strings", `--grep=${task.subject}`, "HEAD"], root);
    const match = subjects.split("\n").map((line) => line.split("\t")).find(([, subject]) => subject === task.subject);
    return match ? match[0] : "";
}

/** Files a commit changed, split into the half to revert and the half to keep. */
export function splitCommit(root, commit, spec = {}) {
    const files = sh("git", ["show", "--name-only", "--format=", commit], root)
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);

    if (!files.length) return null;
    return splitFiles(files, spec);
}

/**
 * The split itself, given a commit's files.
 *
 * By default every file that is not a test is source. A task can name its
 * `source` instead: a customization task reverts one recipe and leaves the rest
 * of its commit — the README and docs the agent is meant to read — in place.
 */
export function splitFiles(files, spec = {}) {
    if (spec.source) {
        const source = files.filter((f) => spec.source.includes(f));
        return { files, tests: files.filter((f) => !source.includes(f)), source };
    }
    const tests = files.filter((f) => isTestPath(f) || (spec.protected || []).includes(f));
    const source = files.filter((f) => !tests.includes(f));
    return { files, tests, source };
}

export function getTask(id) {
    return TASKS.find((t) => t.id === id) || null;
}
