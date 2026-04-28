import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { pgTable, text } from 'drizzle-orm/pg-core';

const users = pgTable('users', {
  id: text('id').primaryKey(),
});
const users2 = pgTable('users2', {
  id: text('id').primaryKey(),
});

async function run() {
  const curJson = generateDrizzleJson({ users, users2 });
  
  const prevJson = {
    "id": "mock-prev",
    "prevId": "mock-prev-prev",
    "version": "7",
    "dialect": "postgresql",
    "tables": {
        "users": {
            "name": "users",
            "schema": "",
            "columns": {
                "id": {
                    "name": "id",
                    "type": "text",
                    "primaryKey": true,
                    "notNull": true
                }
            },
            "indexes": {},
            "foreignKeys": {},
            "compositePrimaryKeys": {},
            "uniqueConstraints": {}
        }
    },
    "enums": {},
    "schemas": {},
    "sequences": {},
    "roles": {},
    "policies": {},
    "views": {},
    "_meta": {
      "schemas": {},
      "tables": {},
      "columns": {}
    }
  };
  
  try {
    const sql = await generateMigration(prevJson as any, curJson as any);
    console.log("SQL statements:", sql);
  } catch (e) {
    console.error("Error:", e);
  }
}

run().catch(console.error);
