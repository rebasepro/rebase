import type { CollectionPropertyConfig } from "./CollectionViewTypes";

/**
 * Pick the property that acts as a row's title.
 *
 * Headless mirror of the ranking in `@rebasepro/common`: identifiers are kept
 * out of the title slot structurally (the id property, images, hidden fields),
 * and among what is left a plain text field beats a description, an enum or a
 * relation. Falls back to the id property only when a collection has nothing
 * else to show.
 */
export function resolveTitlePropertyKey(
    order: string[],
    properties: Record<string, CollectionPropertyConfig>,
    idProperty: string,
    titleProperty?: string
): string {
    if (titleProperty) return titleProperty;

    const SCORE = {
        RELATION: 10,
        LONG_TEXT: 20,
        ENUM: 30,
        EMAIL: 45,
        PLAIN_TEXT: 60,
        NAMED: 100
    };
    const titleLikeKeys = new Set(["name", "fullname", "displayname", "title", "label", "heading", "subject", "username", "nickname"]);

    let best: { key: string; score: number } | undefined;

    order.forEach(key => {
        const property = properties[key];
        if (!property || property.hideFromCollection) return;
        if (key === idProperty) return;
        if (property.storage || property.url === "image") return;

        let score: number;
        if (property.type === "relation" || property.type === "reference") score = SCORE.RELATION;
        else if (property.type !== "string") return;
        else if (property.enum) score = SCORE.ENUM;
        else if (property.multiline || property.markdown) score = SCORE.LONG_TEXT;
        else if (property.email) score = SCORE.EMAIL;
        else if (titleLikeKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) score = SCORE.NAMED;
        else score = SCORE.PLAIN_TEXT;

        if (!best || score > best.score) best = { key,
score };
    });

    return best?.key ?? idProperty;
}
