/**
 * What a declared resource becomes on a laptop when nothing bound it.
 *
 * The rule this exists for: **declaring a resource must be enough to use it in
 * development.** A developer who writes `bucket("media")` and runs `rebase dev`
 * should be able to upload a file, not read an error telling them to invent an
 * S3 account first. Encore does this by starting containers; here the local
 * implementations are already in the box, so it is a directory and a table.
 *
 * Only ever reached when the infra file and the environment both said nothing,
 * and only ever enabled outside production. A production boot that falls
 * through to "make something up" is how a deployment ends up writing user
 * uploads to a container filesystem that vanishes on the next rollout — so the
 * caller decides, and `createLocalProvisioner` is simply not constructed there.
 */
import fs from "fs";
import path from "path";
import { DEFAULT_RESOURCE_KEY, type ResourceDeclaration } from "@rebasepro/types";
import { logger } from "../utils/logger.js";
import type { LocalProvisioner } from "./bindings.js";

export interface LocalProvisionerOptions {
    /**
     * Where local state lives. `.rebase` beside the project, which is already
     * where the development database keeps its files.
     */
    stateDir: string;
    /** Announced once per resource, so a developer knows what they got. */
    onProvision?: (declaration: ResourceDeclaration, detail: string) => void;
}

/** A readable directory name for a resource key, including the default's sentinel. */
function directoryNameFor(key: string): string {
    if (key === DEFAULT_RESOURCE_KEY) return "default";
    // Anything that is not obviously safe in a path becomes an underscore. Keys
    // are validated at declaration, but this writes to a filesystem and a key
    // like `../etc` should produce a bad directory name rather than a traversal.
    return key.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/**
 * Provision the kinds that can be provisioned locally.
 *
 * Databases are deliberately not among them. `rebase dev` already starts the
 * development database and exports its connection string, so by the time
 * binding runs the environment has one — and a provisioner that invented a
 * *second* database here would produce a backend quietly talking to a different
 * one than the CLI just migrated.
 */
export function createLocalProvisioner(options: LocalProvisionerOptions): LocalProvisioner {
    const { stateDir, onProvision } = options;

    return {
        provision(declaration: ResourceDeclaration): Record<string, string> | null {
            switch (declaration.kind) {
                case "bucket": {
                    // A `direct` bucket is reached by a provider SDK in the
                    // browser; there is no local stand-in for that, and handing
                    // back a directory would make it look configured while
                    // every client upload still failed.
                    if (declaration.transport === "direct") return null;

                    const dir = path.join(stateDir, "storage", directoryNameFor(declaration.key));
                    fs.mkdirSync(dir, { recursive: true });
                    onProvision?.(declaration, dir);
                    logger.debug(`[resources] bucket "${declaration.key}" → ${dir} (local development)`);
                    return { STORAGE_BUCKET: dir, REBASE_STORAGE_ENGINE: "local" };
                }

                case "topic":
                    // Topics need no address: they are rows in the project's own
                    // database, and the queue is already up by the time one is
                    // published to. Bound with no values rather than left
                    // unbound, which would read as "nothing configured this".
                    return {};

                default:
                    return null;
            }
        }
    };
}

/**
 * Whether local provisioning should be offered at all.
 *
 * Deliberately not just `NODE_ENV !== "production"`. A managed tenant runs with
 * whatever `NODE_ENV` its bundle was built with, and one built carelessly would
 * otherwise get a container-filesystem bucket that looks like it works until
 * the pod is rescheduled. Both signals have to agree.
 */
export function localProvisioningAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.NODE_ENV === "production") return false;
    if (env.REBASE_MANAGED === "1" || env.REBASE_CLOUD === "1") return false;
    return true;
}
