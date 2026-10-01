import { Properties } from "@rebasepro/types";
import { guessIdColumn, ImportConfig } from "../../../_cms_internals";
import { slugify } from "@rebasepro/utils";

export function cleanPropertiesFromImport(properties: Properties, parentSlug = ""): {
    headersMapping: ImportConfig["headersMapping"],
    properties: Properties,
    idColumn?: ImportConfig["idColumn"],
} {

    const result = Object.keys(properties).reduce((acc, key) => {
        const property = properties[key];
        const slug = slugify(key);
        const fullSlug = parentSlug ? `${parentSlug}.${slug}` : slug;

        if (property.type === "map" && property.properties) {
            const slugifiedResult = cleanPropertiesFromImport(property.properties as Properties, fullSlug);
            // The children's mapping is keyed by their own names in the file
            // (`streetName`), and the rows are flattened to the full column
            // name (`address.streetName`) before they are looked up — so it
            // joins the parent's mapping under the parent's name in the file.
            // Dropped, every nested key that slugging changes was not imported.
            const childMapping = Object.fromEntries(Object.entries(slugifiedResult.headersMapping)
                .map(([childKey, childSlug]) => [`${key}.${childKey}`, childSlug]));
            return {
                headersMapping: { ...acc.headersMapping,
                    [key]: fullSlug,
                    ...childMapping },
                properties: {
                    ...acc.properties,
                    [slug]: {
                        ...property,
                        properties: slugifiedResult.properties,
                        propertiesOrder: Object.keys(slugifiedResult.properties)
                    }
                }
            }
        }

        const updatedProperties = {
            ...acc.properties,
            [slug]: property
        } as Properties;

        const headersMapping = { ...acc.headersMapping,
[key]: fullSlug } as Record<string, string>;

        return {
            headersMapping,
            properties: updatedProperties
        }
    }, { headersMapping: {},
properties: {} });

    return {
        ...result,
        idColumn: guessIdColumn(Object.keys(result.headersMapping), result.headersMapping, result.properties)
    };
}
