/**
 * One build of a project's bundle at a time.
 *
 * Every build empties `dist-bundle/` and compiles into it, and nothing stopped
 * two from doing so at once: two `rebase cloud deploy`s from the same directory,
 * a deploy beside a `rebase build`. The run that starts second deletes files the
 * first has already emitted. The first has no way to notice, finishes, and packs
 * what is left, so a bundle ships with `songs.js` and without the `songs.json`
 * beside it, and the failure appears at boot on a machine far from the cause.
 *
 * The file lives in `.rebase/`, beside the generated tsconfig the runs also
 * share, which no upload carries. It records the holder's pid so that a run
 * killed part way leaves nothing to clean up by hand.
 */
import fs from "fs";
import path from "path";

/** Whether `pid` is a process. EPERM is one that belongs to somebody else. */
function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err instanceof Error && "code" in err && err.code === "EPERM";
    }
}

/**
 * Take the project's build lock, or throw naming the process that holds it.
 *
 * Returns the release, which may be called more than once. The lock also goes
 * with the process, and a process is never refused by itself: `fail()` ends a
 * run on the spot with no `finally` behind it, and a build that threw leaves the
 * lock with a caller that may build again.
 */
export function lockBundleBuild(projectRoot: string): () => void {
    const lockPath = path.join(projectRoot, ".rebase", "bundle-build.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    for (;;) {
        try {
            fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
            break;
        } catch (err) {
            if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
        }
        let holder: string;
        try {
            holder = fs.readFileSync(lockPath, "utf8");
        } catch {
            // Released between the two calls, so it is free again.
            continue;
        }
        if (Number(holder) === process.pid) break;
        // Empty is a holder that has created the file and not yet written to it.
        if (holder === "" || isRunning(Number(holder))) {
            throw new Error(
                `Another build of this project is running${holder ? ` (process ${holder})` : ""}, and two builds ` +
                "share dist-bundle/: the second would delete what the first has already written. " +
                `Wait for it to finish. If nothing is running, delete ${lockPath}.`
            );
        }
        fs.rmSync(lockPath, { force: true });
    }

    const release = (): void => {
        process.off("exit", release);
        try {
            if (Number(fs.readFileSync(lockPath, "utf8")) === process.pid) fs.rmSync(lockPath, { force: true });
        } catch {
            // Gone already: released twice, or the project was removed around it.
        }
    };
    process.on("exit", release);
    return release;
}
