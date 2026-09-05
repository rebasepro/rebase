/**
 * The clone-to-running-app path, checked instead of described.
 *
 * CONTRIBUTING's "Getting Started" is the only instruction a first-time
 * contributor follows, and every step of it is a claim about three files that
 * nothing kept in agreement:
 *
 *   - `app/.env.example` shipped `postgresql://user:password@localhost:5432/rebase`
 *     while `app/backend/docker-compose.yml` starts the container as
 *     `rebase:rebasepassword`. Step 4 (`pnpm run db:push`) authenticated
 *     against a database that does not have that role.
 *   - The same URL had no `sslmode=disable`, so even with the right password
 *     Atlas — the schema tool behind `db:push` — stops with "SSL is not enabled
 *     on the server", two errors away from the cause.
 *   - Nothing ever created `app/.env`. The steps went straight from
 *     `docker compose up` to `db:push`, which then read no `DATABASE_URL` at
 *     all and silently fell through to the managed PGlite database — so the
 *     container the previous step started was never touched.
 *
 * None of those are type errors, test failures or lint findings; they are three
 * files disagreeing, which is exactly the class no other gate in this repo
 * looks at. This is the guard that replaces trusting the prose.
 *
 * Run: pnpm run check:contributor-setup
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf-8");

const problems = [];
const fail = (file, message) => problems.push({ file, message });

// ── The compose file is the source of truth for the local database ───────────
const compose = read("app/backend/docker-compose.yml");
const composeValue = (key) => {
    // `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-rebasepassword}` — the default in
    // the shell expansion is what a contributor gets, since nothing exports it.
    const line = compose.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
    if (!line) return null;
    const raw = line[1].trim();
    const expansion = raw.match(/^\$\{[A-Z_]+:-(.*)\}$/);
    return expansion ? expansion[1] : raw;
};

const user = composeValue("POSTGRES_USER");
const password = composeValue("POSTGRES_PASSWORD");
const database = composeValue("POSTGRES_DB");
const portLine = compose.match(/^\s+-\s+"(\d+):5432"\s*$/m);
const port = portLine ? portLine[1] : null;

for (const [name, value] of [["POSTGRES_USER", user], ["POSTGRES_PASSWORD", password], ["POSTGRES_DB", database]]) {
    if (!value) fail("app/backend/docker-compose.yml", `no ${name} to check app/.env.example against`);
}
if (!port) fail("app/backend/docker-compose.yml", "the db service publishes no host port for 5432");

// ── app/.env.example has to be usable as-is ──────────────────────────────────
const envExample = read("app/.env.example");
const urlLine = envExample.match(/^DATABASE_URL=(.+)$/m);
if (!urlLine) {
    fail("app/.env.example", "no uncommented DATABASE_URL — step 4 of CONTRIBUTING has nothing to copy");
} else if (user && password && database && port) {
    const url = new URL(urlLine[1].trim());
    if (decodeURIComponent(url.username) !== user) {
        fail("app/.env.example", `DATABASE_URL user is "${url.username}", compose starts the database as "${user}"`);
    }
    if (decodeURIComponent(url.password) !== password) {
        fail("app/.env.example", `DATABASE_URL password does not match POSTGRES_PASSWORD ("${password}") in docker-compose.yml`);
    }
    if (url.pathname.replace(/^\//, "") !== database) {
        fail("app/.env.example", `DATABASE_URL database is "${url.pathname.slice(1)}", compose creates "${database}"`);
    }
    if (url.port !== port) {
        fail("app/.env.example", `DATABASE_URL port is "${url.port || "(default)"}", compose publishes "${port}"`);
    }
    if (url.searchParams.get("sslmode") !== "disable") {
        fail("app/.env.example", "DATABASE_URL needs sslmode=disable: the compose database has no TLS and atlas requires SSL by default");
    }
}

// ── CONTRIBUTING must still tell people to create the file ───────────────────
const contributing = read("CONTRIBUTING.md");
if (!/cp\s+app\/\.env\.example\s+app\/\.env/.test(contributing)) {
    fail("CONTRIBUTING.md", "no `cp app/.env.example app/.env` step — db:push would fall through to the managed database");
}

if (problems.length === 0) {
    console.log("[32m✓ contributor setup: CONTRIBUTING, app/.env.example and docker-compose.yml agree.[0m");
    process.exit(0);
}

console.error(`[31m✗ ${problems.length} contributor-setup problem(s).[0m\n`);
for (const { file, message } of problems) {
    console.error(`  [1m${file}[0m`);
    console.error(`    ${message}`);
}
console.error("\n[2m  A fresh clone follows CONTRIBUTING literally. These three files are the\n  whole of that path, and nothing else in the pipeline reads them together.[0m");
process.exit(1);
