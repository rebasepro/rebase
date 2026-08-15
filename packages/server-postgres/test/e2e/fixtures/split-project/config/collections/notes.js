/**
 * The one collection the split-roles e2e reads and writes.
 *
 * Public select so the data surface can be probed without a token — the point of
 * that test is which PROCESS answers, not who may read.
 */
export default {
    name: "Notes",
    singularName: "Note",
    slug: "notes",
    table: "split_notes",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    },
    securityRules: [{ operation: "select", access: "public" }]
};
