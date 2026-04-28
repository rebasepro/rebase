import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { pgTable, text } from 'drizzle-orm/pg-core';

const users = pgTable('users', {
  id: text('id').primaryKey(),
});

async function run() {
  const curJson = generateDrizzleJson({ users });
  console.log("curJson version:", curJson.version);
  
  const prevJson = {
    "version": "7",
    "dialect": "postgresql",
    "tables": {},
    "enums": {},
    "schemas": {},
    "sequences": {},
    "_meta": {
      "schemas": {},
      "tables": {},
      "columns": {}
    }
  };
  
  const sql = await generateMigration(prevJson as any, curJson as any);
  console.log("SQL statements:", sql);
}

run().catch(console.error);
