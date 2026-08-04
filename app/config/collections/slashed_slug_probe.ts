// TEMPORARY REPRO — a collection whose slug has slashes, like medmot's
// `content/{locale}/podcasts`. Delete after debugging.
import type { PostgresCollectionConfig } from "@rebasepro/types";

const probe: PostgresCollectionConfig = {
    name: "Podcasts",
    singularName: "Podcast",
    slug: "content/de-DE/podcasts",
    table: "exercises",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Title", type: "string" }
    },
    admin: {
        icon: "Mic",
        group: "Probe",
        display: { title: "name" }
    }
};

export default probe;
