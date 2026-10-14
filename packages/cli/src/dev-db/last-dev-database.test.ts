/**
 * The record of which database the last `rebase dev` ran on.
 *
 * Only Docker is worth recording: every other choice is already somewhere each
 * command reads — `.env`, the shell, the branch pointer — or is the default.
 * So the record holds `docker` exactly when the last `rebase dev` ran on it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lastDevDatabaseNotice, lastDevDatabasePath, readLastDevDocker, recordLastDevDatabase } from "./last-dev-database";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-last-dev-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("recordLastDevDatabase", () => {
    it("remembers Docker, and says what was there before", () => {
        expect(readLastDevDocker(root)).toBe(false);

        expect(recordLastDevDatabase(root, "docker")).toEqual({ previous: null });
        expect(readLastDevDocker(root)).toBe(true);
        expect(recordLastDevDatabase(root, "docker")).toEqual({ previous: "docker" });
    });

    it("forgets it when the next `rebase dev` runs on anything else", () => {
        recordLastDevDatabase(root, "docker");

        expect(recordLastDevDatabase(root, "managed")).toEqual({ previous: "docker" });
        expect(readLastDevDocker(root)).toBe(false);
        expect(fs.existsSync(lastDevDatabasePath(root))).toBe(false);

        recordLastDevDatabase(root, "docker");
        recordLastDevDatabase(root, "external");
        expect(readLastDevDocker(root)).toBe(false);
    });

    it("lives with the rest of the per-checkout state, which is gitignored", () => {
        recordLastDevDatabase(root, "docker");
        expect(path.relative(root, lastDevDatabasePath(root))).toBe(path.join(".rebase", "dev-database.json"));
    });

    /**
     * `rebase dev --docker` with DATABASE_URL in `.env`: the flag is ignored,
     * and the run is on `.env`'s database — but the reader asked for Docker,
     * and was told to comment the `.env` line out to get it. Erasing the
     * record here sent the other commands to the managed database once they
     * did, instead of back to Docker.
     */
    it("leaves the record alone when this run asked for Docker and a connection string outranked it", () => {
        recordLastDevDatabase(root, "docker");

        expect(recordLastDevDatabase(root, "external", { dockerFlag: true })).toEqual({ previous: "docker" });
        expect(readLastDevDocker(root)).toBe(true);

        fs.rmSync(lastDevDatabasePath(root));
        recordLastDevDatabase(root, "external", { dockerFlag: true });
        expect(fs.existsSync(lastDevDatabasePath(root))).toBe(false);
    });

    it("treats a file it cannot read as no record", () => {
        fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
        fs.writeFileSync(lastDevDatabasePath(root), "{not json");
        expect(readLastDevDocker(root)).toBe(false);
    });
});

describe("lastDevDatabaseNotice", () => {
    it("says so when `rebase dev` leaves Docker for the managed database", () => {
        expect(lastDevDatabaseNotice("docker", "managed")).toContain("--docker");
    });

    it("says nothing when this run asked for Docker: the line that says --docker was ignored is the one that applies", () => {
        // "Pass --docker to stay on it", to a reader who just did.
        expect(lastDevDatabaseNotice("docker", "external", { dockerFlag: true })).toBeNull();
    });

    it("says nothing when nothing changed, or when Docker is chosen again", () => {
        expect(lastDevDatabaseNotice(null, "managed")).toBeNull();
        expect(lastDevDatabaseNotice("docker", "docker")).toBeNull();
        expect(lastDevDatabaseNotice(null, "docker")).toBeNull();
    });
});
