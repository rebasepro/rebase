/**
 * A frozen collection, as `rebase build` emitted it in the format-1 era.
 *
 * Plain JavaScript with a default export, because that is exactly what the
 * runtime imports out of a bundle — the loader reads a directory of `.js` files
 * and takes each module's default. Hand-authored rather than produced by a build
 * so it cannot move when the builder moves: the point of a corpus is that the
 * bundle stays still while the runtime changes underneath it.
 *
 * Do not "fix" this file to match current conventions. It is a historical
 * artifact; if a change to the framework makes it stop working, that is the
 * finding, not a fixture to update.
 */
export default {
    name: "Notes",
    singularName: "Note",
    slug: "notes",
    table: "corpus_notes_format1",
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
        createdAt: {
            name: "Created At",
            type: "date",
            mode: "date_time"
        }
    }
};
