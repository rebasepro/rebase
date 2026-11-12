// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency

import { defineTable, col, rel } from "@rebasepro/server/schema";
import { products } from "./products";

export const productLocales = defineTable("product_locales", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        productId: col.uuid(),
        locale: col.enum(["en", "es", "fr", "de", "it"]).notNull(),
        name: col.text(),
        description: col.text()
    },
    relations: {
        product: rel.belongsTo(() => products)
    },
    rls: "inherit",
    history: true
});
