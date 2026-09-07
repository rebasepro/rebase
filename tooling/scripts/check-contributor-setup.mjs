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
 * The static half above still cannot see the failure that survived it: three
 * files can agree perfectly on `localhost:5432` and the URL still not reach the
 * container. Docker publishes on `0.0.0.0`, a native Postgres binds the more
 * specific `127.0.0.1`, and the specific one wins for `localhost` — so compose
 * reports `Up (healthy) 0.0.0.0:5432->5432/tcp` while every connection lands in
 * the developer's own database and `db push` writes a schema into it. So:
 *
 *     pnpm run check:contributor-setup          the three files agree
 *     pnpm run check:contributor-setup --live   …and the URL reaches the container
 *
 * `--live` starts the compose service, connects on the URL `app/.env.example`
 * documents, and asserts the server it reached reports the marker the compose
 * file starts it with (`cluster_name=rebase-compose`). It runs in the `e2e-cli`
 * job, which already has Docker; `REBASE_DB_PORT` moves the published port, and
 * the check follows it.
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf-8");

const live = process.argv.includes("--live");

/**
 * The marker the compose file starts Postgres with, and the check `--live` is
 * built around. `cluster_name` is empty by default and settable only at server
 * start, so a server that reports it is the one this compose file started.
 * Deliberately not an `/docker-entrypoint-initdb.d` script: that runs once,
 * against an empty data directory, so an existing volume would carry no marker.
 */
const MARKER_SETTING = "cluster_name";
const MARKER_VALUE = "rebase-compose";

/** The variable the compose file publishes the database port through. */
const PORT_VAR = "REBASE_DB_PORT";

const COMPOSE_FILE = "app/backend/docker-compose.yml";
const ENV_EXAMPLE = "app/.env.example";

const problems = [];
const fail = (file, message) => problems.push({ file, message });

// ── The compose file is the source of truth for the local database ───────────
const compose = read(COMPOSE_FILE);
const composeValue = (key) => {
    // `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-rebasepassword}` — the default in
    // the shell expansion is what a contributor gets, since nothing exports it.
    const line = compose.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
    if (!line) return null;
    return expansionDefault(line[1].trim());
};

/** `${VAR:-default}` → `default`; anything else → itself. */
const expansionDefault = (raw) => {
    const expansion = raw.match(/^\$\{[A-Z_]+:-(.*)\}$/);
    return expansion ? expansion[1] : raw;
};

const user = composeValue("POSTGRES_USER");
const password = composeValue("POSTGRES_PASSWORD");
const database = composeValue("POSTGRES_DB");

// The published host port, which must be overridable: 5432 is the port a
// contributor is most likely to already be serving, and the failure when they
// are is silent. `- "${REBASE_DB_PORT:-5432}:5432"`.
const portLine = compose.match(/^\s+-\s+"([^"]+):5432"\s*$/m);
const portSpec = portLine ? portLine[1] : null;
const port = portSpec ? expansionDefault(portSpec) : null;

for (const [name, value] of [["POSTGRES_USER", user], ["POSTGRES_PASSWORD", password], ["POSTGRES_DB", database]]) {
    if (!value) fail(COMPOSE_FILE, `no ${name} to check ${ENV_EXAMPLE} against`);
}
if (!port) {
    fail(COMPOSE_FILE, "the db service publishes no host port for 5432");
} else if (portSpec === port) {
    fail(
        COMPOSE_FILE,
        `the db service publishes a literal "${port}:5432". It has to be ` +
        `"\${${PORT_VAR}:-${port}}:5432": a developer already serving Postgres on ` +
        `${port} gets a healthy container nothing can reach, and no error anywhere.`
    );
} else if (!portSpec.startsWith(`\${${PORT_VAR}:-`)) {
    fail(COMPOSE_FILE, `the db port is published through \`${portSpec}\`, not \`\${${PORT_VAR}:-…}\``);
}

if (!compose.includes(`${MARKER_SETTING}=${MARKER_VALUE}`)) {
    fail(
        COMPOSE_FILE,
        `the db command no longer sets \`-c ${MARKER_SETTING}=${MARKER_VALUE}\`, which is the ` +
        "only way `--live` can tell this container apart from anything else answering on the port"
    );
}

// ── app/.env.example has to be usable as-is ──────────────────────────────────
const envExample = read(ENV_EXAMPLE);
const urlLine = envExample.match(/^DATABASE_URL=(.+)$/m);
if (!urlLine) {
    fail(ENV_EXAMPLE, "no uncommented DATABASE_URL — step 4 of CONTRIBUTING has nothing to copy");
} else if (user && password && database && port) {
    const url = new URL(urlLine[1].trim());
    if (decodeURIComponent(url.username) !== user) {
        fail(ENV_EXAMPLE, `DATABASE_URL user is "${url.username}", compose starts the database as "${user}"`);
    }
    if (decodeURIComponent(url.password) !== password) {
        fail(ENV_EXAMPLE, `DATABASE_URL password does not match POSTGRES_PASSWORD ("${password}") in ${COMPOSE_FILE}`);
    }
    if (url.pathname.replace(/^\//, "") !== database) {
        fail(ENV_EXAMPLE, `DATABASE_URL database is "${url.pathname.slice(1)}", compose creates "${database}"`);
    }
    if (url.port !== port) {
        fail(ENV_EXAMPLE, `DATABASE_URL port is "${url.port || "(default)"}", compose publishes "${port}"`);
    }
    if (url.searchParams.get("sslmode") !== "disable") {
        fail(ENV_EXAMPLE, "DATABASE_URL needs sslmode=disable: the compose database has no TLS and atlas requires SSL by default");
    }
}
if (!envExample.includes(PORT_VAR)) {
    fail(
        ENV_EXAMPLE,
        `never mentions ${PORT_VAR}. The port in the URL above is a compose default a ` +
        "contributor may have to move, and a default nobody is told is overridable is a literal"
    );
}

// ── CONTRIBUTING must still tell people to create the file ───────────────────
const contributing = read("CONTRIBUTING.md");
if (!/cp\s+app\/\.env\.example\s+app\/\.env/.test(contributing)) {
    fail("CONTRIBUTING.md", "no `cp app/.env.example app/.env` step — db:push would fall through to the managed database");
}
if (!contributing.includes(PORT_VAR)) {
    fail(
        "CONTRIBUTING.md",
        `step 3 does not name ${PORT_VAR}. The one failure this path has left is a port ` +
        "already in use, and it produces a healthy container and no error message"
    );
}

if (problems.length > 0) {
    console.error(`\x1b[31m✗ ${problems.length} contributor-setup problem(s).\x1b[0m\n`);
    for (const { file, message } of problems) {
        console.error(`  \x1b[1m${file}\x1b[0m`);
        console.error(`    ${message}`);
    }
    console.error("\n\x1b[2m  A fresh clone follows CONTRIBUTING literally. These three files are the\n  whole of that path, and nothing else in the pipeline reads them together.\x1b[0m");
    process.exit(1);
}

if (!live) {
    console.log("\x1b[32m✓ contributor setup: CONTRIBUTING, app/.env.example and docker-compose.yml agree.\x1b[0m");
    process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// --live: start it, and prove the documented URL reaches THAT container.
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT = "rebase-contributor-check";
const livePort = process.env[PORT_VAR] ?? port;
const composeArgs = ["compose", "-f", path.join(repoRoot, COMPOSE_FILE), "-p", PROJECT];

const dockerCompose = (args, opts = {}) =>
    spawnSync("docker", [...composeArgs, ...args], {
        cwd: path.join(repoRoot, "app/backend"),
        encoding: "utf-8",
        env: { ...process.env, [PORT_VAR]: livePort },
        ...opts
    });

let started = false;
/** Idempotent: `die` runs it too, because `process.exit` skips a `finally`. */
const cleanup = () => {
    if (!started) return;
    started = false;
    dockerCompose(["down", "-v"], { stdio: "ignore" });
};

const die = (headline, detail) => {
    cleanup();
    console.error(`\x1b[31m✗ ${headline}\x1b[0m`);
    if (detail) console.error(`\x1b[2m${detail.split("\n").map((l) => `  ${l}`).join("\n")}\x1b[0m`);
    process.exit(1);
};

if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    die(
        "--live needs Docker, and `docker info` failed.",
        "This mode exists to run where Docker is present (CI's e2e job). Without it,\n" +
        "`pnpm check:contributor-setup` on its own still checks the three files."
    );
}

/** Is anything already listening on 127.0.0.1:<port>? */
const squatter = await new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: Number(livePort) });
    const done = (answer) => { socket.destroy(); resolve(answer); };
    socket.setTimeout(2000);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
});

if (squatter) {
    die(
        `Something is already listening on 127.0.0.1:${livePort}.`,
        `Start the container elsewhere and point the URL at it:\n\n` +
        `  ${PORT_VAR}=5499 docker compose -f ${COMPOSE_FILE} up -d db\n\n` +
        "This is the whole point of the check: compose would have published on\n" +
        "0.0.0.0 and started healthy, while every connection reached the other server."
    );
}

try {
    const up = dockerCompose(["up", "-d", "db"], { stdio: "inherit" });
    if (up.status !== 0) die(`\`docker compose up -d db\` failed (exit ${up.status}).`);
    started = true;

    // Wait for the healthcheck the compose file declares, not for a fixed sleep.
    const deadline = Date.now() + 90_000;
    let health = "";
    while (Date.now() < deadline) {
        const ps = dockerCompose(["ps", "--format", "{{.Health}}", "db"]);
        health = (ps.stdout ?? "").trim();
        if (health === "healthy") break;
        await new Promise((r) => setTimeout(r, 1000));
    }
    if (health !== "healthy") die(`the db container never became healthy (last state: "${health || "unknown"}").`);

    // `pg` is not a root dependency; resolve it through the package that owns
    // the driver, which is where the lockfile puts it under pnpm's layout.
    const requireFromDriver = createRequire(path.join(repoRoot, "packages/server-postgres/package.json"));
    const { default: pg } = await import(pathToFileURL(requireFromDriver.resolve("pg")).href);

    // The URL a contributor has after step 4, with only the port they were told
    // to move applied. Everything else is read from the file, not retyped.
    const documented = new URL(urlLine[1].trim());
    documented.port = String(livePort);
    /** The URL with the password taken out — this prints on failure. */
    const shown = documented.href.replace(/:[^:@]+@/, ":***@");

    const client = new pg.Client({ connectionString: documented.href });
    try {
        await client.connect();
    } catch (error) {
        die(
            `nothing usable answered ${shown}.`,
            `${error.message}\n\n` +
            "The container is up and healthy, so either the port is published somewhere\n" +
            "this cannot reach, or another server is answering on it."
        );
    }
    const { rows } = await client.query(`SELECT current_setting($1, true) AS marker`, [MARKER_SETTING]);
    await client.end();

    const marker = rows[0]?.marker ?? "";
    if (marker !== MARKER_VALUE) {
        die(
            `${shown} reached a Postgres that is not the compose container.`,
            `Expected ${MARKER_SETTING} = "${MARKER_VALUE}", got "${marker || "(empty)"}".\n\n` +
            "That is the silent failure this check exists for: compose starts and reports\n" +
            "healthy while another server answers on the published port, and `db push`\n" +
            `writes the schema into it. Move the container: ${PORT_VAR}=5499 docker compose up -d db.`
        );
    }

    console.log(
        `\x1b[32m✓ contributor setup (live): ${shown} reached the compose container ` +
        `(${MARKER_SETTING}=${marker}).\x1b[0m`
    );
} finally {
    cleanup();
}
