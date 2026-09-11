/**
 * `rebase cloud db connect` — a local port that is your cloud database.
 *
 * ## What this replaces
 *
 * A managed database lives in a namespace of the platform's cluster, and its
 * address (`postgres-rw.rebase-tenant-….svc.cluster.local`) resolves to nothing
 * on a developer's machine. The console used to bridge that gap by printing
 *
 *     kubectl port-forward svc/postgres-rw -n rebase-tenant-… 5432:5432
 *
 * which nobody outside the platform can run: a tenant of Rebase Cloud has no
 * kubeconfig for our cluster, and there is no product that sells one. So the
 * platform reaches into the cluster instead, and this command is the local end
 * of that reach.
 *
 * ## How it works
 *
 * A listener on 127.0.0.1. Every TCP connection it accepts opens its own
 * WebSocket to the control plane, authenticates in-band with the console session
 * this CLI already holds, and from `ready` onwards the two are a byte pipe. The
 * database still asks for a password — the tunnel is a network path, not a
 * credential — so `psql` behaves exactly as it would against a local Postgres.
 *
 * One WebSocket per connection rather than one multiplexed socket: `psql` is one
 * connection and a pool is a handful, and per-connection sockets keep the
 * framing at "these bytes are those bytes" with no stream ids to get wrong.
 *
 * Node's global `WebSocket` is used rather than `ws`, which is why the token
 * goes in the first frame instead of an `Authorization` header — the WHATWG
 * client cannot set request headers, and a header-only endpoint would be
 * unreachable from a browser too.
 */
import net from "node:net";
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    fail,
    note,
    noteBlank,
    reportError
} from "./context";

/** Documented in `action-help.ts`, and paired with it by `action-help.test.ts`. */
export const DB_CONNECT_FLAGS = {
    "--port": Number,
    "--reveal": Boolean
} as const;

/** What `db-info` answers. Mirrors `saas/backend/functions/db-info.ts`. */
interface DbInfoResponse {
    type: "managed" | "byodb";
    host: string | null;
    port: string | null;
    database: string | null;
    username: string | null;
    passwordAvailable: boolean;
    directAccess: {
        via: "tunnel";
        kubectl?: { namespace: string; service: string; localPort: number; remotePort: number };
    } | null;
    unavailableReason: string | null;
}

/** The default, because it is what every Postgres client assumes. */
const DEFAULT_LOCAL_PORT = 5432;

/**
 * The handshake, which is the only thing the tunnel says in words.
 *
 * After `ready` every frame is bytes, so a text frame arriving later is not a
 * frame of ours at all — it is a proxy answering in the control plane's place.
 */
type TunnelFrame =
    | { type: "ready" }
    | { type: "error"; code?: string; message?: string };

/** `https://app.rebase.pro` → `wss://app.rebase.pro/api/db-tunnel/p1`. */
export function tunnelUrl(cloudUrl: string, projectId: string): string {
    const url = new URL(cloudUrl);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    // Replaced rather than appended: a control-plane URL carrying a path would
    // otherwise produce `/base/api/db-tunnel/...`, and the route is mounted at
    // the root of the host.
    url.pathname = `/api/db-tunnel/${encodeURIComponent(projectId)}`;
    url.search = "";
    return url.toString();
}

/**
 * A local DSN for the tunnel, with the password only if the caller asked.
 *
 * Built here and nowhere else. The server reports the *cluster's* URI, which is
 * the one thing that must not be printed as the way to connect — it is exactly
 * the address that does not work from here.
 */
export function localDsn(opts: {
    port: number;
    username: string | null;
    database: string | null;
    password?: string;
}): string {
    const user = opts.username ? encodeURIComponent(opts.username) : "postgres";
    const auth = opts.password ? `${user}:${encodeURIComponent(opts.password)}` : user;
    const database = opts.database ?? "rebase";
    return `postgresql://${auth}@127.0.0.1:${opts.port}/${database}`;
}

export async function dbConnect(rawArgs: string[]): Promise<void> {
    const { flags: args } = parseCloudArgs({
        spec: DB_CONNECT_FLAGS,
        rawArgs,
        commandWords: 3, // cloud db connect
        command: "cloud db connect",
        maxPositionals: 0
    });
    const { client, url } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    let info: DbInfoResponse;
    try {
        info = await client.functions.invoke<DbInfoResponse>("db-info", undefined, {
            method: "GET",
            path: projectId
        });
    } catch (e) {
        return reportError(e, "Failed to load database info");
    }

    if (info.type === "byodb") {
        fail(
            "This project uses your own database.",
            "Connect to it directly — there is nothing for the platform to tunnel.",
            "byodb"
        );
    }
    if (!info.directAccess) {
        fail(
            "The platform could not resolve this project's database, so it cannot open a path to it.",
            info.unavailableReason ??
                "A managed database is provisioned at the project's first deploy; before then there is nothing to connect to.",
            "db_unavailable"
        );
    }

    // Asked for before the listener opens: a prompt-free failure is better than
    // a tunnel that works and a URL the caller cannot use.
    let password: string | undefined;
    if (args["--reveal"]) {
        if (!info.passwordAvailable) {
            fail(
                "No password is available to reveal for this database.",
                info.unavailableReason ?? undefined,
                "password_unavailable"
            );
        }
        try {
            password = (
                await client.functions.invoke<{ password: string }>("db-info", { projectId }, { path: "reveal" })
            ).password;
        } catch (e) {
            return reportError(e, "Failed to reveal the database password");
        }
    }

    const requested = args["--port"] ?? DEFAULT_LOCAL_PORT;
    if (!Number.isInteger(requested) || requested < 0 || requested > 65535) {
        fail(`--port must be a port number, not ${requested}.`, undefined, "bad_port");
    }

    const endpoint = tunnelUrl(url, projectId);
    const server = net.createServer((socket) => {
        pipeThroughTunnel(socket, endpoint, client.auth.getSession()?.accessToken ?? "");
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            fail(
                `Port ${requested} on 127.0.0.1 is already in use.`,
                "Pass --port to choose another, or stop whatever is listening there.",
                "port_in_use"
            );
        }
        fail(`Could not open a local listener: ${err.message}`, undefined, "listen_failed");
    });

    await new Promise<void>((resolve) => {
        server.listen(requested, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : requested;
    const dsn = localDsn({ port, username: info.username, database: info.database, password });

    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🔌 Tunnel open — project ${projectRef}`));
            console.log("");
            console.log(`  ${chalk.green(dsn)}`);
            console.log("");
            if (!password) {
                console.log(
                    chalk.gray("  The password is hidden. Re-run with --reveal to print it in the URL,")
                );
                console.log(chalk.gray("  or read it with `rebase cloud db info --reveal`."));
                console.log("");
            }
            console.log(chalk.gray("  Leave this running, and point any Postgres client at it."));
            console.log(chalk.gray("  Ctrl-C closes the tunnel."));
            console.log("");
        },
        {
            projectId,
            host: "127.0.0.1",
            port,
            database: info.database,
            username: info.username,
            connectionString: dsn,
            // Only present when explicitly revealed, exactly as `db info` does.
            ...(password ? { password } : {})
        }
    );

    // The command IS the tunnel: it holds the terminal until the developer is
    // done. `once` rather than `on`, so a second Ctrl-C kills the process
    // instead of queueing another shutdown.
    await new Promise<void>((resolve) => {
        process.once("SIGINT", () => {
            noteBlank();
            note(chalk.gray("Tunnel closed."));
            // Not awaited: `server.close` waits for established connections to
            // end, and the developer just asked to stop rather than to drain.
            server.close();
            resolve();
        });
    });
}

/**
 * One accepted connection, carried over one WebSocket.
 *
 * The local socket is paused until the tunnel says `ready`, so a client that
 * sends its startup packet the instant it connects — which every Postgres
 * client does — cannot have those bytes arrive before there is a database to
 * send them to.
 *
 * Exported for `db-connect.pipe.test.ts`, which drives it with a real socket
 * against a real WebSocket: this is the half a developer's client actually
 * talks to, and a pipe is the one component whose bugs are silent — a dropped
 * or reordered chunk does not throw, it corrupts a Postgres message and
 * surfaces as a protocol error nowhere near here.
 */
export function pipeThroughTunnel(socket: net.Socket, endpoint: string, token: string): void {
    socket.pause();
    socket.setNoDelay(true);

    const ws = new WebSocket(endpoint);
    ws.binaryType = "arraybuffer";
    let ready = false;

    const closeBoth = (reason?: string) => {
        if (reason && !ready) {
            // Only worth saying while the tunnel is being established: after
            // that, a close is a client disconnecting and is not news.
            note(chalk.red(`✗ ${reason}`));
        }
        try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        } catch {
            /* already gone */
        }
        socket.destroy();
    };

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: "authenticate", token }));
    };

    ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") {
            // Text frames are the handshake, and the server sends none after
            // `ready` — so anything unparseable here is a proxy or a gateway
            // answering in place of the control plane.
            let frame: TunnelFrame | null = null;
            try {
                frame = JSON.parse(event.data) as TunnelFrame;
            } catch {
                return closeBoth(`the tunnel endpoint answered with ${event.data.slice(0, 80)}`);
            }
            if (frame.type === "ready") {
                ready = true;
                socket.resume();
                return;
            }
            const refusal = frame.type === "error" ? frame : null;
            return closeBoth(
                refusal?.message ?? `the tunnel was refused (${refusal?.code ?? "unknown"})`
            );
        }
        socket.write(Buffer.from(event.data as ArrayBuffer));
    };

    ws.onerror = () => {
        closeBoth("could not reach the control plane's tunnel endpoint");
    };
    ws.onclose = () => {
        socket.destroy();
    };

    socket.on("data", (chunk: Buffer) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // The Uint8Array view is copied rather than sent as-is: `chunk` is a
        // slice of a shared read buffer, and sending the underlying
        // ArrayBuffer would put the whole of it on the wire.
        ws.send(new Uint8Array(chunk));
        if (ws.bufferedAmount > 1024 * 1024) {
            socket.pause();
            const drain = setInterval(() => {
                if (ws.readyState !== WebSocket.OPEN) return clearInterval(drain);
                if (ws.bufferedAmount < 256 * 1024) {
                    clearInterval(drain);
                    socket.resume();
                }
            }, 5);
        }
    });
    socket.on("close", () => closeBoth());
    socket.on("error", () => closeBoth());
}
