/**
 * The port file `rebase dev` leaves, read by the next server in the project.
 *
 * `rebase dev` wrote `.rebase-dev-port` as a bare `<bound>`, over the server's
 * own `<bound> <requested>`. The requested half is what tells a later server
 * whether the saved port is meant for it; without it, any server in the
 * project tried dev's port first. So `DATABASE_URL="$(rebase db url)" rebase
 * start` beside dev logged `Port 3755 is in use — trying 3001`, and after a dev
 * that crashed (the file stays behind) it bound dev's 3755 instead of the
 * `PORT=3001` its own environment named.
 */
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listenWithPortRetry } from "@rebasepro/server";

import { findFreePort } from "../dev-db/state";
import { DEV_PORT_FILENAME, devPortFileContents, resolveStartPort } from "./dev";

describe("the port file rebase dev writes", () => {
    let projectRoot: string;
    const servers: http.Server[] = [];

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dev-port-file-"));
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it("does not send a server that asks for another port to dev's, after a dev that crashed", async () => {
        const devPort = await findFreePort();
        const startPort = await findFreePort();
        // What a dev that asked for `devPort`, bound it, and then crashed leaves.
        fs.writeFileSync(path.join(projectRoot, DEV_PORT_FILENAME), devPortFileContents(devPort, devPort));

        const server = http.createServer();
        servers.push(server);
        const bound = await listenWithPortRetry(server, startPort, { portFileDir: projectRoot, host: "127.0.0.1" });

        expect(bound).toBe(startPort);
    });

    it("still gives the next rebase dev the port the last one landed on", () => {
        fs.writeFileSync(path.join(projectRoot, DEV_PORT_FILENAME), devPortFileContents(4321, 4300));
        const saved = process.env.PORT;
        delete process.env.PORT;
        try {
            expect(resolveStartPort(projectRoot)).toEqual({ port: 4321, source: "affinity" });
        } finally {
            if (saved !== undefined) process.env.PORT = saved;
        }
    });
});
