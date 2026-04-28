import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { EntityCollection, SecurityRule, SecurityOperation } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import pg from "pg";
const { Pool } = pg;

// --- Helpers to extract policy SQL clauses ---

function resolveRawSql(expression: string): string {
    return expression.replace(/\{(\w+)\}/g, (_, col) => `"${col}"`);
}

function buildUsingClause(rule: SecurityRule): string | null {
    if (rule.using) {
        return resolveRawSql(rule.using);
    }
    if (rule.access === "public") {
        return `true`;
    }
    if (rule.ownerField) {
        return `"${rule.ownerField}" = auth.uid()`;
    }
    return null;
}

function buildWithCheckClause(rule: SecurityRule): string | null {
    if (rule.withCheck) {
        return resolveRawSql(rule.withCheck);
    }
    return buildUsingClause(rule);
}

function wrapWithRoleCheck(clause: string, roles: string[]): string {
    const rolesArrayString = `ARRAY[${roles.map(r => `'${r}'`).join(',')}]`;
    return `(${clause}) AND (string_to_array(auth.roles(), ',') @> ${rolesArrayString})`;
}

const syncPolicies = async (collectionsFilePath: string) => {
    // 1. Load configuration and DB connection
    try {
        const dotenv = await import("dotenv");
        if (process.env.DOTENV_CONFIG_PATH) {
            dotenv.config({ path: process.env.DOTENV_CONFIG_PATH });
        } else {
            dotenv.config();
        }
    } catch {}

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;
    if (!databaseUrl) {
        console.error("✗ DATABASE_URL is not set. Make sure your .env file is configured.");
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });

    try {
        // 2. Load collections
        const resolvedPath = path.resolve(collectionsFilePath);
        let collections: EntityCollection[] = [];
        const stats = fs.statSync(resolvedPath);

        if (stats.isDirectory()) {
            const files = fs.readdirSync(resolvedPath);
            for (const file of files) {
                if ((file.endsWith('.ts') || file.endsWith('.js')) &&
                    !file.includes('.test.') &&
                    !file.endsWith('.d.ts') &&
                    file !== 'index.ts' && file !== 'index.js') {

                    const filePath = path.join(resolvedPath, file);
                    try {
                        const fileUrl = pathToFileURL(filePath).href;
                        const dynamicImport = new Function('url', 'return import(url)');
                        const module = await dynamicImport(fileUrl);
                        if (module && module.default) {
                            collections.push(module.default);
                        }
                    } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : String(err);
                        console.error(`Error loading ${file}:`, message);
                    }
                }
            }
        } else {
            const fileUrl = pathToFileURL(resolvedPath).href + `?t=${Date.now()}`;
            const dynamicImport = new Function('url', 'return import(url)');
            const imported = await dynamicImport(fileUrl);
            collections = imported.backendCollections || imported.collections;
        }

        if (!collections || !Array.isArray(collections) || collections.length === 0) {
            console.error("Error: Could not find collections array or failed to load directory.");
            return;
        }

        // 3. Process each collection to generate and execute SQL
        console.log("Syncing database security policies...");
        
        for (const collection of collections) {
            const tableName = getTableName(collection);
            if (!tableName) continue;

            const rules = (collection as import("@rebasepro/types").PostgresCollection<any, any>).securityRules || [];
            
            // ALWAYS Enable RLS
            await pool.query(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;`);

            // Drop existing policies for this table
            const existingPolicies = await pool.query(`
                SELECT policyname 
                FROM pg_policies 
                WHERE schemaname = 'public' AND tablename = $1
            `, [tableName]);

            for (const row of existingPolicies.rows) {
                await pool.query(`DROP POLICY IF EXISTS "${row.policyname}" ON "${tableName}";`);
            }

            // Create new policies
            let policyIndex = 0;
            for (const rule of rules) {
                const ops: SecurityOperation[] = rule.operations && rule.operations.length > 0
                    ? rule.operations
                    : [rule.operation ?? "all"];

                for (let opIdx = 0; opIdx < ops.length; opIdx++) {
                    const operation = ops[opIdx];
                    const mode = rule.mode ?? "permissive";
                    const roles = rule.roles;
                    
                    const policyName = rule.name
                        ? (ops.length > 1 ? `${rule.name}_${operation}` : rule.name)
                        : `${tableName}_${operation}_policy_${policyIndex}${ops.length > 1 ? `_${opIdx}` : ""}`;
                    
                    const needsUsing = operation !== "insert";
                    const needsWithCheck = operation !== "select" && operation !== "delete";

                    let usingClause = needsUsing ? buildUsingClause(rule) : null;
                    let withCheckClause = needsWithCheck ? buildWithCheckClause(rule) : null;

                    if (roles && roles.length > 0) {
                        if (usingClause) {
                            usingClause = wrapWithRoleCheck(usingClause, roles);
                        } else if (needsUsing) {
                            const rolesArrayString = `ARRAY[${roles.map(r => `'${r}'`).join(',')}]`;
                            usingClause = `string_to_array(auth.roles(), ',') @> ${rolesArrayString}`;
                        }
                        if (withCheckClause) {
                            withCheckClause = wrapWithRoleCheck(withCheckClause, roles);
                        } else if (needsWithCheck) {
                            const rolesArrayString = `ARRAY[${roles.map(r => `'${r}'`).join(',')}]`;
                            withCheckClause = `string_to_array(auth.roles(), ',') @> ${rolesArrayString}`;
                        }
                    }

                    if (!usingClause && needsUsing) {
                        usingClause = `false`;
                    }
                    if (!withCheckClause && needsWithCheck) {
                        withCheckClause = `false`;
                    }

                    const toRoles = rule.pgRoles ?? ["public"];
                    const toRolesClause = toRoles.map(r => `"${r}"`).join(", ");

                    let sql = `CREATE POLICY "${policyName}" ON "${tableName}" AS ${mode} FOR ${operation.toUpperCase()} TO ${toRolesClause}`;
                    
                    if (usingClause) {
                        sql += ` USING (${usingClause})`;
                    }
                    if (withCheckClause) {
                        sql += ` WITH CHECK (${withCheckClause})`;
                    }
                    sql += `;`;

                    await pool.query(sql);
                }
                policyIndex++;
            }
        }
        
        console.log("✅ Security policies synced successfully.");
    } catch (error) {
        console.error("Error syncing policies:", error);
        process.exit(1);
    } finally {
        await pool.end();
    }
};

const main = () => {
    const collectionsFilePathArg = process.argv.find(arg => arg.startsWith("--collections="));
    const collectionsFilePath = collectionsFilePathArg ? collectionsFilePathArg.split("=")[1] : process.argv[2];

    if (!collectionsFilePath) {
        console.log("Usage: ts-node sync-policies.ts <path-to-collections-file>");
        return;
    }

    syncPolicies(collectionsFilePath);
};

// This check ensures the script only runs when executed directly
if (import.meta.url.endsWith(process.argv[1])) {
    main();
}
