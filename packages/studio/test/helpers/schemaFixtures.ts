import { col, defineTable, rel } from "@rebasepro/types";
import type { AnyTableDef, TableDescriptor } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";

/** Two tables, `<prefix>_posts` belonging to `<prefix>_authors`, as the server compiles them. */
export function blogSchema(prefix: string): TableDescriptor[] {
    const authors = defineTable(`${prefix}_authors`, {
        columns: { id: col.serial().primaryKey(), name: col.text() },
        rls: "admin-only"
    });
    const posts = defineTable(`${prefix}_posts`, {
        columns: { id: col.serial().primaryKey(), title: col.text() },
        relations: { author: rel.belongsTo(() => authors, { localKey: "author_id" }) },
        rls: "admin-only"
    });
    return compileTables([authors, posts]);
}

/**
 * `count` tables in a chain named `<prefix>c<i>` — each belongs to the one
 * before it — where `c5` is also pointed at by `c100` and `c200`, and, past
 * 300 tables, has a many-to-many to `c300` through `<prefix>peers` (unless
 * `peers` is `false`). So `c5` is the most connected table.
 */
export function chainSchema(prefix: string, count: number, peers = true): TableDescriptor[] {
    const defs: AnyTableDef[] = [];
    for (let i = 0; i < count; i++) {
        const relations: Record<string, ReturnType<typeof rel.belongsTo> | ReturnType<typeof rel.manyToMany>> = {};
        if (i > 0) relations.previous = rel.belongsTo(() => defs[i - 1], { localKey: "previous_id" });
        if (i === 100 || i === 200) relations.hub = rel.belongsTo(() => defs[5], { localKey: "hub_id" });
        if (peers && i === 5 && count > 300) relations.peers = rel.manyToMany(() => defs[300], { through: `${prefix}peers` });
        defs.push(defineTable(`${prefix}c${i}`, {
            columns: { id: col.serial().primaryKey(), label: col.text() },
            relations,
            rls: "admin-only"
        }));
    }
    return compileTables(defs);
}
