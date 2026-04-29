const { generateSchema } = require("./dist/schema/generate-drizzle-schema-logic");

const collections1 = [{
    slug: "test1",
    table: "test_hash",
    name: "Test",
    properties: { data: { type: "string" } },
    securityRules: [
        { operation: "select", roles: ["admin", "user"] }
    ]
}];

generateSchema(collections1).then(console.log).catch(console.error);
