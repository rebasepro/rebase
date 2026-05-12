import fs from "fs";

let content = fs.readFileSync("packages/types/src/types/collections.ts", "utf8");

content = content.replace("export interface PostgresCollection<M extends Record<string, any> = any> extends BaseEntityCollection<M> {", `export interface PostgresCollection<M extends Record<string, any> = any> extends BaseEntityCollection<M> {
    properties: import("./properties").PostgresProperties;`);

content = content.replace("export interface FirebaseCollection<M extends Record<string, any> = any> extends BaseEntityCollection<M> {", `export interface FirebaseCollection<M extends Record<string, any> = any> extends BaseEntityCollection<M> {
    properties: import("./properties").FirebaseProperties;`);

content = content.replace(`    /**
     * Legacy array of relations.
     * Note: This is deprecated in favor of defining relations directly on properties
     * via \`type: "relation"\`.
     * @deprecated
     */
    relations?: import("./relations").Relation[];`, "");

fs.writeFileSync("packages/types/src/types/collections.ts", content);
