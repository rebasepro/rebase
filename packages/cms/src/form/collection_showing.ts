import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * The collection as a record showing only `fields` lays it out, in the form
 * and in the read-only view alike: `fields` as its order, which
 * `getFormFieldKeys` also restricts to, and each section and the rail holding
 * only those fields, in that order. Sections follow their first field.
 */
export function collectionShowing<M extends Record<string, unknown>>(collection: AdminCollection<M>, fields: string[]): AdminCollection<M> {
    const rank = new Map(fields.map((key, index) => [key, index] as const));
    const ranked = (keys: string[]) => keys
        .filter(key => rank.has(key))
        .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const form = collection.form;
    const firstRank = (keys: string[]) => Math.min(...keys.map(key => rank.get(key) ?? Infinity));
    return {
        ...collection,
        propertiesOrder: fields as AdminCollection<M>["propertiesOrder"],
        form: form && {
            ...form,
            sidebar: form.sidebar && ranked(form.sidebar as string[]) as typeof form.sidebar,
            sections: form.sections && form.sections
                .map(section => ({ ...section, properties: ranked(section.properties as string[]) as typeof section.properties }))
                .sort((a, b) => firstRank(a.properties as string[]) - firstRank(b.properties as string[]))
        }
    };
}
