/**
 * A frozen collection, as `rebase build` emits it today (bundle format 2).
 *
 * Hand-authored on purpose — see the sibling fixture's note. When this stops
 * working, the finding is that a bundle deployed today would stop working, which
 * is precisely what the corpus is for.
 */
export default {
    name: "Notes",
    singularName: "Note",
    slug: "notes",
    table: "corpus_notes_format2",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        title: {
            name: "Title",
            type: "string",
            validation: { required: true }
        },
        body: {
            name: "Body",
            type: "string"
        },
        published: {
            name: "Published",
            type: "boolean"
        },
        createdAt: {
            name: "Created At",
            type: "date",
            mode: "date_time"
        }
    }
};
