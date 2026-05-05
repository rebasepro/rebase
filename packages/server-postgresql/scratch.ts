import { pgTable, integer, varchar } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { config } from "dotenv";
config({ path: "../../.env" });

const authors = pgTable("authors", {
    id: integer("id").primaryKey(),
    name: varchar("name")
});
const posts = pgTable("posts", {
    id: integer("id").primaryKey(),
    author_id: integer("author_id")
});
const profiles = pgTable("profiles", {
    id: integer("id").primaryKey(),
    author_id: integer("author_id")
});

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres"
    });
    await client.connect();
    const db = drizzle(client);

    let query = db.select().from(posts);
    // @ts-expect-error
    query = query.innerJoin(authors, eq(posts.author_id, authors.id));
    // @ts-expect-error
    query = query.innerJoin(profiles, eq(authors.id, profiles.author_id));

    const results = await query;
    console.log("Drizzle Inner Join Results:");
    console.log(JSON.stringify(results, null, 2));

    await client.end();
}

main().catch(console.error);
