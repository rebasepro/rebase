/**
 * What trigger-based change capture costs a write, measured on a throwaway
 * Postgres.
 *
 *     node --import tsx tooling/scripts/bench-cdc-notify.mts
 *     node --import tsx tooling/scripts/bench-cdc-notify.mts --flush-delay-us 1000
 *     node --import tsx tooling/scripts/bench-cdc-notify.mts --clients 1,8,32,64 --seconds 15
 *
 * Three copies of one table, written to by pgbench:
 *
 * - `plain` has no triggers.
 * - `fake` has the capture triggers exactly as provisioning attaches them, with
 *   `pg_notify` swapped for a function that does nothing.
 * - `cdc` has the real triggers, and a session listening on the channel and
 *   draining it, as a running server does.
 *
 * `plain` → `fake` is what the trigger body costs. `fake` → `cdc` is what
 * NOTIFY costs, and it is the larger of the two once writes are concurrent:
 * a transaction that notified takes one lock for the whole server at commit
 * ("database 0", AccessExclusiveLock, `PreCommit_Notify` in async.c) and holds
 * it until the transaction ends, disk flush included. So those commits happen
 * one at a time and cannot share a flush, where every other write can.
 *
 * A laptop SSD flushes in microseconds, which hides most of that.
 * `--flush-delay-us` sets `commit_delay`, which waits that long inside the
 * flush, to stand in for a network disk.
 *
 * The SQL is generated from `trigger-cdc.ts`, not copied, so it measures the
 * triggers this checkout installs. Needs `initdb`, `pg_ctl`, `psql` and
 * `pgbench` on PATH. The cluster lives in the OS temp directory and is removed
 * on exit.
 */
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { spawn, spawnSync } from "child_process";
import {
    CDC_CHANNEL,
    buildCdcFunctionSql,
    buildCdcTriggerSql
} from "../../packages/server-postgres/src/services/cdc/trigger-cdc.ts";

type Variant = "plain" | "fake" | "cdc";
type Workload = "insert" | "update";

const VARIANTS: readonly Variant[] = ["plain", "fake", "cdc"];
const SEED_ROWS = 10_000;

const WORKLOADS: Record<Workload, string> = {
    insert: "INSERT INTO items (title, n) VALUES ('x', 1);\n",
    update: `\\set id random(1, ${SEED_ROWS})\nUPDATE items SET n = n + 1, updated_at = now() WHERE id = :id;\n`
};

const TABLE_SQL = `
CREATE TABLE items (
    id bigserial PRIMARY KEY,
    title text NOT NULL,
    n int NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO items (title) SELECT 'seed' FROM generate_series(1, ${SEED_ROWS});
`;

interface Options {
    seconds: number;
    clients: number[];
    workloads: Workload[];
    flushDelayUs: number;
}

function parseArgs(argv: string[]): Options {
    const options: Options = { seconds: 10,
clients: [1, 8, 32],
workloads: ["insert", "update"],
flushDelayUs: 0 };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (value === undefined) throw new Error(`${flag} needs a value`);
        if (flag === "--seconds") options.seconds = positiveInt(flag, value);
        else if (flag === "--clients") options.clients = value.split(",").map((part) => positiveInt(flag, part));
        else if (flag === "--flush-delay-us") options.flushDelayUs = nonNegativeInt(flag, value);
        else if (flag === "--workloads") options.workloads = value.split(",").map(workload);
        else throw new Error(`Unknown flag ${flag}`);
        i++;
    }
    return options;
}

function positiveInt(flag: string, value: string): number {
    const n = nonNegativeInt(flag, value);
    if (n === 0) throw new Error(`${flag} must be at least 1`);
    return n;
}

function nonNegativeInt(flag: string, value: string): number {
    if (!/^\d+$/.test(value)) throw new Error(`${flag} takes a whole number, got "${value}"`);
    return Number(value);
}

function workload(value: string): Workload {
    if (value === "insert" || value === "update") return value;
    throw new Error(`--workloads takes insert and/or update, got "${value}"`);
}

function requireTools(): void {
    const missing = ["initdb", "pg_ctl", "psql", "pgbench"].filter((tool) => spawnSync("which", [tool]).status !== 0);
    if (missing.length) throw new Error(`Not on PATH: ${missing.join(", ")}. Install Postgres (e.g. brew install postgresql).`);
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            server.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
        });
    });
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
    const result = spawnSync(command, args, { encoding: "utf8",
env: { ...process.env,
...env } });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/**
 * A session that listens on the capture channel and keeps draining it.
 *
 * psql reads notifications only between commands, so it is fed a trivial one
 * every 50 ms; each notification it prints is counted. Without a draining
 * listener the queue still fills and the lock is still taken, but a server
 * always has one, so the measurement does too.
 */
function startListener(psqlArgs: string[]): { stop: () => Promise<number> } {
    const child = spawn("psql", [...psqlArgs, "-d", "cdc", "-X", "-q"], { stdio: ["pipe", "pipe", "ignore"] });
    let received = 0;
    let tail = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
        const text = tail + chunk;
        const lines = text.split("\n");
        tail = lines.pop() ?? "";
        for (const line of lines) if (line.startsWith("Asynchronous notification")) received++;
    });
    child.stdin.write(`LISTEN ${CDC_CHANNEL};\n`);
    const timer = setInterval(() => child.stdin.write("SELECT 1;\n"), 50);
    return {
        stop: () => new Promise((resolve) => {
            clearInterval(timer);
            child.on("close", () => resolve(received));
            child.stdin.end("SELECT 1;\n");
        })
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    requireTools();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cdc-bench-"));
    const dataDir = path.join(dir, "pgdata");
    const port = await freePort();
    const psqlArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "rebase", "-v", "ON_ERROR_STOP=1"];
    // The postmaster refuses to start on macOS without a locale in the
    // environment ("became multithreaded during startup").
    const pgEnv = { LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8" };
    let started = false;

    try {
        run("initdb", ["-D", dataDir, "-U", "rebase", "--auth=trust", "--no-locale", "-E", "UTF8"]);
        // No unix socket: a temp path can exceed the ~103-character limit.
        run("pg_ctl", ["-D", dataDir, "-l", path.join(dir, "pg.log"), "-w", "-o",
            `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c max_connections=${Math.max(...options.clients) + 20}`,
            "start"], pgEnv);
        started = true;

        const captureSql = [
            "CREATE SCHEMA IF NOT EXISTS rebase;",
            `${buildCdcFunctionSql()};`,
            buildCdcTriggerSql("public", "items")
        ].join("\n");
        const fakeSql = [
            "CREATE SCHEMA IF NOT EXISTS rebase;",
            "CREATE FUNCTION rebase.bench_no_notify(text, text) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';",
            captureSql.replaceAll("pg_notify(", "rebase.bench_no_notify(")
        ].join("\n");

        for (const variant of VARIANTS) {
            run("psql", [...psqlArgs, "-d", "postgres", "-q", "-c", `CREATE DATABASE ${variant}`]);
            run("psql", [...psqlArgs, "-d", variant, "-q", "-c", TABLE_SQL]);
        }
        run("psql", [...psqlArgs, "-d", "fake", "-q", "-c", fakeSql], { PGOPTIONS: "-c client_min_messages=warning" });
        run("psql", [...psqlArgs, "-d", "cdc", "-q", "-c", captureSql], { PGOPTIONS: "-c client_min_messages=warning" });

        const pgOptions = options.flushDelayUs > 0
            ? { PGOPTIONS: `-c commit_delay=${options.flushDelayUs} -c commit_siblings=1` }
            : undefined;
        const workloadFiles = new Map<Workload, string>();
        for (const name of options.workloads) {
            const file = path.join(dir, `${name}.sql`);
            fs.writeFileSync(file, WORKLOADS[name]);
            workloadFiles.set(name, file);
        }

        console.log(`Postgres ${run("psql", [...psqlArgs, "-d", "postgres", "-tA", "-c", "SHOW server_version"]).trim()}, ` +
            `${options.seconds}s per run` +
            (options.flushDelayUs ? `, commit_delay ${options.flushDelayUs}µs standing in for a slower disk flush` : "") + "\n");
        console.log("| workload | clients | plain tps | fake tps | cdc tps | NOTIFY cost (fake ÷ cdc) | notifications |");
        console.log("|---|---|---|---|---|---|---|");

        for (const name of options.workloads) {
            const file = workloadFiles.get(name);
            if (!file) continue;
            for (const clients of options.clients) {
                const tps: Record<Variant, number> = { plain: 0,
fake: 0,
cdc: 0 };
                let received = 0;
                for (const variant of VARIANTS) {
                    const listener = variant === "cdc" ? startListener(psqlArgs) : undefined;
                    if (listener) await sleep(500);
                    const out = run("pgbench", [...psqlArgs.filter((arg) => arg !== "-v" && arg !== "ON_ERROR_STOP=1"),
                        "-n", "-c", String(clients), "-j", String(Math.min(clients, 8)),
                        "-T", String(options.seconds), "-f", file, variant], pgOptions);
                    const match = /^tps = ([\d.]+)/m.exec(out);
                    if (!match) throw new Error(`pgbench printed no tps:\n${out}`);
                    tps[variant] = Number(match[1]);
                    if (listener) received = await listener.stop();
                }
                const ratio = tps.cdc > 0 ? (tps.fake / tps.cdc).toFixed(1) + "×" : "—";
                console.log(`| ${name} | ${clients} | ${Math.round(tps.plain)} | ${Math.round(tps.fake)} | ${Math.round(tps.cdc)} | ${ratio} | ${received} |`);
            }
        }
    } finally {
        if (started) spawnSync("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"], { env: { ...process.env,
...pgEnv } });
        fs.rmSync(dir, { recursive: true,
force: true });
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
