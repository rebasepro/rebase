import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import chalk from "chalk";
import { logger } from "@rebasepro/server";
import type { CollectionConfig, Relation } from "@rebasepro/types";

const getHelpersDirname = () => {
    try {
        return eval("__dirname");
    } catch {
        const err = new Error();
        const stackLine = err.stack?.split("\n")[1] || "";
        const match = stackLine.match(/\((.*?):\d+:\d+\)/) || stackLine.match(/at (.*?):\d+:\d+/);
        if (match && match[1]) {
            let cleanPath = match[1];
            if (cleanPath.startsWith("file://")) {
                cleanPath = fileURLToPath(cleanPath);
            }
            return path.dirname(cleanPath);
        }
        return process.cwd();
    }
};
const __helpersDirname = getHelpersDirname();



export function resolveLocalBin(binName: string): string | null {
    // Try to find node_modules/.bin upwards from __helpersDirname first (package-relative)
    let dir = __helpersDirname;
    while (true) {
        const candidate = path.join(dir, "node_modules", ".bin", binName);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    let cwd = process.cwd();
    // Try to find node_modules/.bin upwards from process.cwd()
    while (true) {
        const candidate = path.join(cwd, "node_modules", ".bin", binName);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(cwd);
        if (parent === cwd) break;
        cwd = parent;
    }
    // Fall back to globally installed binary via which/where
    try {
        const cmd = process.platform === "win32" ? `where ${binName}` : `which ${binName}`;
        const globalPath = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0].trim();
        if (globalPath && fs.existsSync(globalPath)) return globalPath;
    } catch {
        // not found globally
    }
    return null;
}

export async function getTableIncludesFromCollections(collections: CollectionConfig[]): Promise<string[]> {
    const { getTableName, resolveCollectionRelations } = await import("@rebasepro/common");
    const { isPostgresCollectionConfig } = await import("@rebasepro/types");

    const includes: string[] = [];
    for (const col of collections) {
        const tableName = getTableName(col);
        const schema = isPostgresCollectionConfig(col) && col.schema ? col.schema : "public";
        if (tableName) {
            includes.push(`${schema}.${tableName}`);
        }

        const resolvedRelations = resolveCollectionRelations(col);
        for (const relation of Object.values(resolvedRelations) as Relation[]) {
            if (relation.through) {
                const junctionTableName = relation.through.table;
                const targetCollection = relation.target();
                const targetSchema = isPostgresCollectionConfig(targetCollection) && targetCollection.schema ? targetCollection.schema : "public";
                includes.push(`${targetSchema}.${junctionTableName}`);
            }
        }
    }
    
    return Array.from(new Set(includes));
}

export async function getTableIncludes(collectionsPath: string): Promise<string[]> {
    // Note: a relative --collections path resolves against the *current working
    // directory*, not the backend package. When invoked via the generated npm
    // script (cwd = backend/), the script uses "../config/collections" to
    // compensate — so running the CLI directly from the repo root with a
    // different relative path can silently point at the wrong place.
    const resolvedPath = path.resolve(collectionsPath);
    const collections: CollectionConfig[] = [];
    if (!fs.existsSync(resolvedPath)) {
        logger.warn(chalk.yellow(
            `  ⚠  Collections path not found: "${collectionsPath}"\n` +
            `     Resolved to: ${resolvedPath}\n` +
            `     (relative to cwd: ${process.cwd()})\n` +
            `     Pass an absolute path, or a path relative to where you run the command.`
        ));
    }
    if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath);
        if (stats.isDirectory()) {
            const files = fs.readdirSync(resolvedPath);
            for (const file of files) {
                if ((file.endsWith(".ts") || file.endsWith(".js")) &&
                    !file.includes(".test.") &&
                    !file.endsWith(".d.ts") &&
                    file !== "index.ts" && file !== "index.js") {
                    try {
                        const filePath = path.join(resolvedPath, file);
                        const fileUrl = pathToFileURL(filePath).href;
                        const module = await import(fileUrl);
                        if (module && module.default) {
                            collections.push(module.default);
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    return getTableIncludesFromCollections(collections);
}

export function getDevDatabaseUrl(databaseUrl: string): string {
    try {
        const parsed = new URL(databaseUrl);
        const dbName = parsed.pathname.slice(1);
        parsed.pathname = `/${dbName}_dev_diff`;
        return parsed.toString();
    } catch {
        return databaseUrl + "_dev_diff";
    }
}

export async function ensureDevDatabaseExists(databaseUrl: string, devDatabaseUrl: string) {
    try {
        const { Client } = await import("pg");
        const parsed = new URL(databaseUrl);
        const devDbName = new URL(devDatabaseUrl).pathname.slice(1);
        
        parsed.pathname = "/postgres";
        const client = new Client({ connectionString: parsed.toString() });
        await client.connect();
        try {
            const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [devDbName]);
            if (res.rowCount === 0) {
                await client.query(`CREATE DATABASE "${devDbName}"`);
                logger.info(chalk.gray(`  ✓ Created validation database "${devDbName}"`));
            }
        } finally {
            await client.end();
        }
    } catch {
        // Ignore, let Atlas handle connection failures
    }
}

export async function getTableExcludes(databaseUrl: string, collectionsPath: string): Promise<string[]> {
    const includes = await getTableIncludes(collectionsPath);
    const excludes: string[] = ["atlas_schema_revisions.*", "auth.*"];
    
    try {
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            const res = await client.query(`
                SELECT table_schema || '.' || table_name AS full_name
                FROM information_schema.tables
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                  AND table_type IN ('BASE TABLE', 'VIEW');
            `);
            
            const existingTables = res.rows.map((row: { full_name: string }) => row.full_name);
            
            for (const table of existingTables) {
                if (!includes.includes(table)) {
                    excludes.push(table);
                }
            }
        } finally {
            await client.end();
        }
    } catch (err) {
        logger.warn(chalk.yellow(`  ⚠️  Failed to query database for unmapped tables: ${err instanceof Error ? err.message : String(err)}`));
    }
    
    return excludes;
}

