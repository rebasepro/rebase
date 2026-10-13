import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveStorageSources } from "@rebasepro/server";
import { DEFAULT_STORAGE_SOURCE_KEY, type StorageSourceDefinition } from "@rebasepro/types";

/**
 * Every local bucket a self-hosted container writes lands on a volume it can
 * write to.
 *
 * Asked of the compose files `rebase init` and `rebase eject` write, through
 * the resolver boot runs, with a named bucket declared. Both pointed the
 * default source at a volume with `STORAGE_PATH` while `bucket("media")`
 * resolved beside the code's own base path, on the container's filesystem,
 * and the volume's mount point did not exist in the image, so it was root's
 * and the image's unprivileged user could not write the default either. Files
 * written outside a volume are gone the next time the container is recreated,
 * and nothing errors until then.
 *
 * `pnpm run verify:selfhost:docker` proves the same thing with a container: an
 * upload to a named bucket, a recreate, and the file read back.
 */

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");

const declared: StorageSourceDefinition[] = [
    { key: DEFAULT_STORAGE_SOURCE_KEY, engine: "local", transport: "server" },
    { key: "media", engine: "local", transport: "server" }
];

/** The lines of one service in a compose file, its own header excluded. */
function serviceBlock(compose: string, service: string): string[] {
    const lines = compose.split("\n");
    const start = lines.findIndex(line => line === `  ${service}:`);
    expect(start, `service "${service}"`).toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(line => /^ {0,2}\S/.test(line));
    return end === -1 ? rest : rest.slice(0, end);
}

/** The entries under one of a service's keys (`environment:`, `volumes:`). */
function section(block: string[], key: string): string[] {
    const start = block.findIndex(line => line === `    ${key}:`);
    if (start === -1) return [];
    const rest = block.slice(start + 1);
    const end = rest.findIndex(line => /^ {0,4}\S/.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).filter(line => !/^\s*(#|$)/.test(line));
}

function environmentOf(block: string[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of section(block, "environment")) {
        const match = /^ {6}([A-Z_][A-Z0-9_]*):\s*(.*?)\s*$/.exec(line);
        if (match) env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
    }
    return env;
}

function mountsOf(block: string[]): { source: string; target: string; readOnly: boolean }[] {
    return section(block, "volumes").map(line => {
        const match = /^ {6}- ([^:\s]+):(\/[^:\s]*)(?::(\w+))?\s*$/.exec(line);
        expect(match, `a volume line this test can read: ${line}`).not.toBeNull();
        return { source: match![1], target: match![2], readOnly: match![3] === "ro" };
    });
}

function declaredVolumes(compose: string): string[] {
    const lines = compose.split("\n");
    const start = lines.indexOf("volumes:");
    if (start === -1) return [];
    const names: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (/^\S/.test(line)) break;
        const match = /^ {2}([\w.-]+):/.exec(line);
        if (match) names.push(match[1]);
    }
    return names;
}

const isInside = (dir: string, parent: string): boolean =>
    dir === parent || dir.startsWith(parent.endsWith("/") ? parent : `${parent}/`);

/** Whether the image creates `dir` and gives it to the user it runs as. */
function imageOwns(dockerfile: string, dir: string): { user?: string; owned: boolean } {
    const user = [...dockerfile.matchAll(/^USER\s+(\S+)/gm)].pop()?.[1];
    const owned = dockerfile.split("\n").some(line => {
        if (!line.startsWith("RUN ")) return false;
        const steps = line.slice(4).split("&&").map(step => step.trim().split(/\s+/));
        const made = steps.some(words => words[0] === "mkdir" && words.includes(dir));
        const given = steps.some(words =>
            words[0] === "chown" && words.some(word => word.startsWith(`${user}:`)) && words.includes(dir));
        return made && given;
    });
    return { user, owned };
}

const cases = [
    {
        name: "the scaffold's docker-compose.yml",
        compose: path.join(CLI_ROOT, "templates", "template", "docker-compose.yml"),
        service: "api",
        // The published runtime image it runs.
        dockerfile: path.join(REPO_ROOT, "infra", "docker", "server.Dockerfile"),
        // What boot passes: `path.join(bundle.dir, "uploads")`. (A read-only
        // bundle is copied to `/app/bundle` first; outside the volume either way.)
        defaultBasePath: (mounts: { source: string; target: string }[]) =>
            path.posix.join(mounts.find(mount => mount.source === "./dist-bundle")!.target, "uploads")
    },
    {
        name: "the docker-compose.custom.yml `rebase eject` writes",
        compose: path.join(CLI_ROOT, "templates", "eject", "docker-compose.custom.yml"),
        service: "backend",
        dockerfile: path.join(CLI_ROOT, "templates", "eject", "Dockerfile"),
        // What the ejected entrypoint passes, `path.resolve(__dirname,
        // "../../uploads")`, from where it runs compiled in that image.
        defaultBasePath: () => "/app/backend/dist/uploads"
    }
];

describe.each(cases)("$name", ({ compose: composePath, service, dockerfile: dockerfilePath, defaultBasePath }) => {
    const compose = fs.readFileSync(composePath, "utf8");
    const block = serviceBlock(compose, service);
    const env = environmentOf(block);
    const mounts = mountsOf(block);
    const volumes = mounts.filter(mount => declaredVolumes(compose).includes(mount.source) && !mount.readOnly);
    const resolved = resolveStorageSources(env, declared, defaultBasePath(mounts), { production: true }) ?? {};
    const directories = Object.entries(resolved).map(([key, config]) => {
        expect(config.type, `"${key}" is local storage`).toBe("local");
        return { key, dir: config.type === "local" ? path.posix.resolve(config.basePath) : "" };
    });

    it("acknowledges local storage, so a container keeps it in production", () => {
        // Without this the runtime drops every local source and the checks
        // below would pass over nothing.
        expect(env.FORCE_LOCAL_STORAGE).toBe("true");
        expect(directories.map(({ key }) => key).sort()).toEqual([DEFAULT_STORAGE_SOURCE_KEY, "media"]);
    });

    it("keeps every local bucket's directory on a named volume", () => {
        for (const { key, dir } of directories) {
            expect(
                volumes.some(volume => isInside(dir, volume.target)),
                `"${key}" writes to ${dir}, outside every writable named volume (${volumes.map(v => v.target).join(", ") || "none"})`
            ).toBe(true);
        }
    });

    it("gives each bucket a directory no other bucket's is inside", () => {
        // Boot refuses two sources whose directories are the same or nested.
        for (const a of directories) {
            for (const b of directories) {
                if (a !== b) expect(isInside(a.dir, b.dir), `"${a.key}" (${a.dir}) inside "${b.key}" (${b.dir})`).toBe(false);
            }
        }
    });

    it("mounts the volume over a directory the image gives to the user it runs as", () => {
        const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
        for (const volume of volumes) {
            const { user, owned } = imageOwns(dockerfile, volume.target);
            expect(user, `${path.basename(dockerfilePath)} runs as a named user`).toBeDefined();
            expect(owned, `${path.relative(REPO_ROOT, dockerfilePath)} creates ${volume.target} owned by ${user}`).toBe(true);
        }
    });
});
