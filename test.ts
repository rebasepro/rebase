import { test } from 'vitest';
import { EntityCollection } from '@rebasepro/types';
import { generateSchema } from './packages/server-postgresql/src/schema/generate-drizzle-schema-logic';

const collection: EntityCollection = {
    slug: 'users',
    name: 'User',
    properties: {
        id: { type: 'string', isId: 'uuid' }
    },
    securityRules: [
        { name: 'user_policy', operation: 'all', access: 'public' }
    ]
};

async function run() {
    const schema = await generateSchema([collection], true);
    console.log(schema);
}

run();
