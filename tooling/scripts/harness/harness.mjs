/**
 * Single entrypoint for the agent harness.
 *
 *   preflight   gate a deploy — the same checks the PreToolUse hook enforces
 *   eval        run the benchmark suite against an agent
 *   trace       inspect what an agent actually did in a session
 *
 * Run: node tooling/scripts/harness/harness.mjs <command> [options]
 */
import fs from "node:fs";
import { context } from "./lib/ctx.mjs";
import { tracePath, traceDir, read } from "./lib/trace.mjs";

const [command, ...rest] = process.argv.slice(2);

const USAGE = `
rebase agent harness

  preflight [--json] [--command "<cmd>"]
      Run every deploy-safety check. Writes a stamp the deploy gate reads.

  eval [--task <id>] [--list] [--agent "<cmd>"] [--json]
      Run benchmark tasks derived from real fix commits.

  trace [--session <id>] [--list]
      Inspect a session trace: tool calls, deploy gates, verification runs.
`;

switch (command) {
    case "preflight": {
        const { main } = await import("./deploy/preflight.mjs");
        process.exit(main(rest));
        break;
    }

    case "eval": {
        const { main } = await import("./eval/run.mjs");
        process.exit(await main(rest));
        break;
    }

    case "trace": {
        const ctx = context();
        if (rest.includes("--list")) {
            const dir = traceDir(ctx.primaryRoot);
            const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : [];
            process.stdout.write(files.length ? files.join("\n") + "\n" : "No traces recorded yet.\n");
            process.exit(0);
        }
        const idIndex = rest.indexOf("--session");
        if (idIndex < 0) {
            process.stdout.write("Pass --session <id>, or --list to see recorded sessions.\n");
            process.exit(1);
        }
        const events = read(tracePath(ctx.primaryRoot, rest[idIndex + 1]));
        process.stdout.write(JSON.stringify(events, null, 2) + "\n");
        process.exit(0);
        break;
    }

    default:
        process.stdout.write(USAGE);
        process.exit(command ? 1 : 0);
}
