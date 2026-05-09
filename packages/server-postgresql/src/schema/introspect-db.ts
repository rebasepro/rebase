import chalk from "chalk";
import fs from "fs";
import path from "path";
import pg from "pg";
import arg from "arg";
import * as dotenv from "dotenv";

function singularize(word: string) {
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.endsWith('ses')) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

function getIconForTable(tableName: string) {
    const table = tableName.toLowerCase();
    if (table.includes('user') || table.includes('account') || table.includes('member')) return 'Users';
    if (table.includes('post') || table.includes('article') || table.includes('blog') || table.includes('page')) return 'FileText';
    if (table.includes('product') || table.includes('item')) return 'Package';
    if (table.includes('order') || table.includes('cart') || table.includes('purchase')) return 'ShoppingCart';
    if (table.includes('setting') || table.includes('config')) return 'Settings';
    if (table.includes('tag') || table.includes('category')) return 'Tag';
    if (table.includes('image') || table.includes('photo') || table.includes('media') || table.includes('asset')) return 'Image';
    return 'Database';
}

async function main() {
    const args = arg(
        {
            "--output": String,
            "-o": "--output"
        },
        { permissive: true }
    );

    const outDir = args["--output"] || path.resolve(process.cwd(), "config", "collections");

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    // Load env
    const envPaths = [
        process.env.DOTENV_CONFIG_PATH,
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../.env"),
        path.resolve(process.cwd(), "../../.env")
    ].filter(Boolean) as string[];

    for (const p of envPaths) {
        if (fs.existsSync(p)) {
            dotenv.config({ path: p });
            break;
        }
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;
    if (!databaseUrl) {
        console.error(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
        process.exit(1);
    }

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    console.log(chalk.gray(`Connected to database: ${databaseUrl.split("@")[1]}`));
    console.log(chalk.gray(`Introspecting schema...`));

    try {
        // 1. Get Tables
        const { rows: tables } = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
              AND table_name NOT LIKE 'drizzle_%'
              AND table_name NOT LIKE 'rebase_%'
        `);

        // 2. Get Columns
        const { rows: columns } = await client.query(`
            SELECT table_name, column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
        `);

        // 3. Get Primary Keys
        const { rows: pks } = await client.query(`
            SELECT t.relname as table_name, a.attname as column_name
            FROM   pg_index i
            JOIN   pg_attribute a ON a.attrelid = i.indrelid
                                AND a.attnum = ANY(i.indkey)
            JOIN   pg_class t ON t.oid = i.indrelid
            JOIN   pg_namespace n ON n.oid = t.relnamespace
            WHERE  i.indisprimary AND n.nspname = 'public'
        `);

        // 4. Get Foreign Keys
        const { rows: fks } = await client.query(`
            SELECT
                tc.table_name, 
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
        `);

        const tablesMap = new Map<string, any>();
        for (const t of tables) {
            tablesMap.set(t.table_name, {
                name: t.table_name,
                columns: columns.filter((c: any) => c.table_name === t.table_name),
                pks: pks.filter((pk: any) => pk.table_name === t.table_name).map((pk: any) => pk.column_name),
                fks: fks.filter((fk: any) => fk.table_name === t.table_name)
            });
        }

        // Identify Join Tables
        const joinTables = new Set<string>();
        for (const [tableName, meta] of tablesMap.entries()) {
            if (meta.fks.length === 2) {
                // Check if all columns are either part of the FK or metadata (like id, created_at)
                const isLikelyJoinTable = meta.columns.every((c: any) => 
                    meta.fks.find((fk: any) => fk.column_name === c.column_name) ||
                    c.column_name === 'id' ||
                    c.column_name === 'created_at' ||
                    c.column_name === 'updated_at'
                );

                if (isLikelyJoinTable) {
                    joinTables.add(tableName);
                }
            }
        }

        console.log(chalk.blue(`Found ${tablesMap.size} tables (including ${joinTables.size} detected join tables).`));

        // Generate Collections
        const generatedFiles: string[] = [];
        
        for (const [tableName, meta] of tablesMap.entries()) {
            if (joinTables.has(tableName)) continue; // We don't generate base collections for pure join tables

            const collectionName = tableName.charAt(0).toUpperCase() + tableName.slice(1).replace(/_/g, " ");
            const singular = singularize(collectionName);
            const icon = getIconForTable(tableName);
            
            const imports = new Set<string>(['import { PostgresCollection } from "@rebasepro/types";']);
            
            let propsOutput = ``;
            const propertiesOrder: string[] = [];
            
            // Map columns
            for (const col of meta.columns) {
                // Skip foreign keys since we handle them as relations
                if (meta.fks.find((fk: any) => fk.column_name === col.column_name)) continue;

                propertiesOrder.push(col.column_name);

                let propType = "string";
                let extra = "";

                const colNameLower = col.column_name.toLowerCase();

                if (col.data_type.includes("int") || col.data_type.includes("numeric") || col.data_type.includes("real")) {
                    propType = "number";
                } else if (col.data_type.includes("bool")) {
                    propType = "boolean";
                } else if (col.data_type.includes("time") || col.data_type.includes("date")) {
                    propType = "date";
                    if (colNameLower === "created_at" || colNameLower === "createdat") {
                        extra = `\n            autoValue: "on_create",\n            readOnly: true,\n            hideFromCollection: true,`;
                    } else if (colNameLower === "updated_at" || colNameLower === "updatedat") {
                        extra = `\n            autoValue: "on_update",\n            readOnly: true,\n            hideFromCollection: true,`;
                    } else if (col.column_default && (col.column_default.includes("now()") || col.column_default.includes("CURRENT_TIMESTAMP"))) {
                        extra = `\n            autoValue: "on_create",\n            readOnly: true,`;
                    }
                } else if (col.data_type === "json" || col.data_type === "jsonb") {
                    propType = "json";
                } else if (col.data_type.includes("text") || col.data_type.includes("varchar")) {
                    propType = "string";
                    
                    if (colNameLower.includes("image") || colNameLower.includes("avatar") || colNameLower.includes("photo") || colNameLower.includes("logo") || colNameLower.includes("cover")) {
                        extra = `\n            // TODO: Add storage configuration if this uses a storage bucket\n            // storage: { storagePath: "images/" },`;
                    } else if (colNameLower === "description" || colNameLower === "summary" || colNameLower === "excerpt") {
                        extra = `\n            multiline: true,`;
                    } else if (colNameLower === "content" || colNameLower === "body") {
                        extra = `\n            multiline: true,\n            markdown: true,`;
                    } else if (colNameLower === "status" || colNameLower === "state" || colNameLower === "role" || colNameLower === "type") {
                        extra = `\n            // TODO: Consider changing to enum: [{ id: "value", label: "Value" }]`;
                    } else if (col.data_type === "text") {
                        extra = `\n            // TODO: Add multiline: true or markdown: true if this contains formatted content`;
                    }
                }

                // Identify IDs
                if (meta.pks.includes(col.column_name)) {
                    if (propType === "number") {
                        extra += `\n            isId: "increment",`;
                    } else {
                        extra += `\n            isId: "uuid", // Verify if this is a UUID or CUID`;
                    }
                }

                if (col.is_nullable === "NO" && !meta.pks.includes(col.column_name) && !col.column_default) {
                    extra += `\n            validation: {\n                required: true\n            },`;
                }

                propsOutput += `
        ${col.column_name}: {
            name: "${col.column_name.replace(/_/g, " ").replace(/\\b\\w/g, (c: string) => c.toUpperCase())}",
            type: "${propType}",${extra}
        },`;
            }

            // Map Owning Relations (from this table's FKs to other tables)
            for (const fk of meta.fks) {
                const targetTableName = fk.foreign_table_name;
                if (!joinTables.has(targetTableName)) {
                    propertiesOrder.push(fk.column_name);
                    const relName = fk.column_name.replace(/_id$/, "");
                    
                    const targetCollectionCamel = targetTableName.replace(/_([a-z])/g, (g: string) => g[1].toUpperCase()) + "Collection";
                    imports.add(`import ${targetCollectionCamel} from "./${targetTableName}";`);

                    propsOutput += `
        ${relName}: {
            name: "${relName.charAt(0).toUpperCase() + relName.slice(1)}",
            type: "relation",
            target: () => ${targetCollectionCamel},
            cardinality: "one",
            direction: "owning",
            // mapped from foreign key: ${fk.column_name} -> ${targetTableName}(${fk.foreign_column_name})
        },`;
                }
            }

            // Map Inverse Relations (1-to-many where OTHER table points to THIS table)
            const inverseFks = fks.filter((fk: any) => fk.foreign_table_name === tableName && !joinTables.has(fk.table_name));
            for (const fk of inverseFks) {
                const sourceTableName = fk.table_name;
                propertiesOrder.push(sourceTableName);
                
                const targetCollectionCamel = sourceTableName.replace(/_([a-z])/g, (g: string) => g[1].toUpperCase()) + "Collection";
                imports.add(`import ${targetCollectionCamel} from "./${sourceTableName}";`);

                propsOutput += `
        ${sourceTableName}: {
            name: "${sourceTableName.charAt(0).toUpperCase() + sourceTableName.slice(1)}",
            type: "relation",
            target: () => ${targetCollectionCamel},
            cardinality: "many",
            direction: "inverse",
            inverseRelationName: "${fk.column_name.replace(/_id$/, "")}"
        },`;
            }

            // Map Many-to-Many Relations (Join Tables)
            const relatedJoinTables = Array.from(joinTables).filter(jt => 
                tablesMap.get(jt).fks.some((fk: any) => fk.foreign_table_name === tableName)
            );

            for (const jt of relatedJoinTables) {
                const joinFks = tablesMap.get(jt).fks;
                const otherFk = joinFks.find((fk: any) => fk.foreign_table_name !== tableName);
                
                if (otherFk) {
                    const targetTableName = otherFk.foreign_table_name;
                    propertiesOrder.push(targetTableName);

                    const targetCollectionCamel = targetTableName.replace(/_([a-z])/g, (g: string) => g[1].toUpperCase()) + "Collection";
                    imports.add(`import ${targetCollectionCamel} from "./${targetTableName}";`);

                    // Determine direction (we arbitrarily make the alphabetically first table owning, or just default to owning for now and let user fix)
                    const direction = tableName < targetTableName ? "owning" : "inverse";

                    propsOutput += `
        ${targetTableName}: {
            name: "${targetTableName.charAt(0).toUpperCase() + targetTableName.slice(1)}",
            type: "relation",
            target: () => ${targetCollectionCamel},
            cardinality: "many",
            direction: "${direction}",
            // Junction table: ${jt}
        },`;
                }
            }

            const fileContent = `
${Array.from(imports).join("\n")}

const ${tableName}Collection: PostgresCollection = {
    name: "${collectionName}",
    singularName: "${singular}",
    slug: "${tableName}",
    table: "${tableName}",
    icon: "${icon}",
    group: "App",
    properties: {${propsOutput}
    },
    propertiesOrder: ${JSON.stringify(propertiesOrder, null, 8).replace(/\\]/, "    ]")}
};

export default ${tableName}Collection;
`;
            
            const filePath = path.join(outDir, `${tableName}.ts`);
            fs.writeFileSync(filePath, fileContent.trim() + "\\n", "utf-8");
            generatedFiles.push(tableName);
            console.log(chalk.green(`  Generated -> ${filePath}`));
        }

        // Generate index.ts
        if (generatedFiles.length > 0) {
            let indexContent = "";
            for (const f of generatedFiles) {
                indexContent += `export { default as ${f} } from "./${f}";\n`;
            }
            fs.writeFileSync(path.join(outDir, "index.ts"), indexContent, "utf-8");
            console.log(chalk.green(`  Generated -> ${path.join(outDir, "index.ts")}`));
        }

        console.log("");
        console.log(chalk.bold.green(`✓ Introspected ${tablesMap.size} tables and successfully generated Rebase Collections!`));
        console.log(chalk.gray(`  Review the generated files in ${outDir} and customize properties as needed.`));
        console.log("");

    } catch (e) {
        console.error(chalk.red(`✗ Error introspecting database: ${e instanceof Error ? e.message : String(e)}`));
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
