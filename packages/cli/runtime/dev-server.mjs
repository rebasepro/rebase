/**
 * The development entrypoint.
 *
 * Run under `tsx` by `rebase dev` for projects that have no hand-written
 * `backend/src/index.ts`. It boots the same runtime a deployment does, over the
 * project's TypeScript **source** rather than a compiled bundle — so hot reload
 * still works, and development still predicts production because both go through
 * one boot path.
 *
 * Paths arrive in the environment rather than as arguments because `tsx watch`
 * owns the argument list.
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

const projectRoot = process.env.REBASE_DEV_PROJECT_ROOT || process.cwd();

const envFile = process.env.DOTENV_CONFIG_PATH;
if (envFile && fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

const { createSourceBundle, runFromBundle } = await import("@rebasepro/server");

const optional = (value) => (value && value.length > 0 ? value : undefined);

const bundle = createSourceBundle({
    projectRoot,
    config: optional(process.env.REBASE_DEV_CONFIG),
    functions: optional(process.env.REBASE_DEV_FUNCTIONS),
    crons: optional(process.env.REBASE_DEV_CRONS),
    schema: optional(process.env.REBASE_DEV_SCHEMA),
    mode: process.env.REBASE_DEV_MODE === "baas" ? "baas" : "cms",
    app: optional(process.env.REBASE_DEV_APP)
});

// The dev port file and the graceful-shutdown handlers both key off the project
// root, so make sure the process agrees with the CLI about where that is.
process.chdir(projectRoot);
void path;

await runFromBundle({ bundle });
