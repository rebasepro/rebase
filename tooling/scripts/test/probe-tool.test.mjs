/**
 * Tests for the external-tool probe `ci:static` and the Docker and Helm gates
 * decide with.
 *
 * The probe this replaced asked `docker info` with no timeout. Docker Desktop
 * stopped answering, the child never returned, and `ci:static` sat silent for
 * thirty minutes with nothing saying what it was waiting on. So the assertions
 * are about the two ways a probe can lie: by never returning, and by saying yes
 * to a client with no daemon behind it.
 *
 * Driven against fake `docker` and `helm` executables on a private PATH, because
 * the lookup and the process handling are the parts that broke, and a mocked
 * spawn would not exercise them. The fakes answer only the exact probe command,
 * so a probe that drifts back to `docker info` fails the healthy case.
 *
 * Run: node --test tooling/scripts/test/probe-tool.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { probeTool } from "../probe-tool.mjs";

const SERVER_VERSION = "version --format {{.Server.Version}}";

/**
 * A PATH holding exactly the fakes given, plus the system dirs they run with.
 * `systemDirs: false` leaves those out, for a case that must find no tool at all:
 * a CI runner ships the real docker in /usr/bin.
 */
function fakeTools(tools, { systemDirs = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-probe-tool-"));
    for (const [name, body] of Object.entries(tools)) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
        fs.chmodSync(file, 0o755);
    }
    return { env: { PATH: systemDirs ? `${dir}:/usr/bin:/bin` : dir }, dir };
}

function withTools(tools, fn, options) {
    const { env, dir } = fakeTools(tools, options);
    try {
        return fn(env);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test("a daemon that answers is a yes, with its server version", () => {
    withTools({
        docker: `case "$*" in "${SERVER_VERSION}") echo 28.3.2 ;; *) echo "unexpected: $*" >&2; exit 64 ;; esac`
    }, (env) => {
        assert.deepEqual(probeTool("docker", { env }), { ok: true, version: "28.3.2" });
    });
});

test("a client with no daemon behind it is not a yes, even when it exits 0", () => {
    // What `docker info` did: a client section, exit 0, no server anywhere.
    withTools({
        docker: `case "$*" in info) printf 'Client:\\n Version: 28.3.2\\n' ;; "${SERVER_VERSION}") ;; *) exit 64 ;; esac`
    }, (env) => {
        const probe = probeTool("docker", { env });
        assert.equal(probe.ok, false);
        assert.match(probe.reason, /exited 0 but no docker server answered/);
    });
});

test("a daemon that refuses the connection is reported with what docker said", () => {
    withTools({
        docker: `echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1`
    }, (env) => {
        const probe = probeTool("docker", { env });
        assert.equal(probe.ok, false);
        assert.match(probe.reason, /exited 1: Cannot connect to the Docker daemon/);
    });
});

test("a daemon that never answers is reported as not answering, not waited on", () => {
    // It ignores SIGTERM, as a wedged client can: a probe that only sends
    // SIGTERM would sit out the whole sleep instead of returning on time.
    withTools({ docker: `trap '' TERM\nexec sleep 10` }, (env) => {
        const started = Date.now();
        const probe = probeTool("docker", { env, timeoutMs: 500 });
        const elapsed = Date.now() - started;
        assert.equal(probe.ok, false);
        assert.match(probe.reason, /^docker did not answer within 0\.5s/);
        assert.ok(elapsed < 5000, `the probe returned after ${elapsed}ms against a 500ms bound`);
    });
});

test("a tool that is not installed says so", () => {
    // No system dirs on this PATH. With /usr/bin on it, the ubuntu-24.04 runner
    // found its own docker and the probe answered `{ ok: true, version: "28.0.4" }`.
    withTools({}, (env) => {
        assert.deepEqual(probeTool("docker", { env }), { ok: false, reason: "docker is not on PATH" });
        assert.deepEqual(probeTool("helm", { env }), { ok: false, reason: "helm is not on PATH" });
    }, { systemDirs: false });
});

test("helm is bounded the same way", () => {
    withTools({
        helm: `case "$*" in "version --short") echo v4.2.4+g3900f43 ;; *) exit 64 ;; esac`
    }, (env) => {
        assert.deepEqual(probeTool("helm", { env }), { ok: true, version: "v4.2.4+g3900f43" });
    });
    withTools({ helm: `trap '' TERM\nexec sleep 10` }, (env) => {
        const probe = probeTool("helm", { env, timeoutMs: 500 });
        assert.equal(probe.ok, false);
        assert.match(probe.reason, /^helm did not answer within 0\.5s/);
    });
});

test("a tool with no probe is refused rather than guessed at", () => {
    assert.throws(() => probeTool("kubectl"), /No probe for "kubectl"/);
});
