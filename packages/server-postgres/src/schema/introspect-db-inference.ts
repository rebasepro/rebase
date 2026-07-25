import { humanize } from "./introspect-db-naming";

export interface InferenceResult {
    propType?: string; // If the inference changes the base type
    extra?: string; // String to append to the property definition
}

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUID_REGEX = /^c[^\s-]{7,}$/i; // Basic CUID check
const COLOR_HEX_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export function inferPropertyFromData(
    columnName: string,
    pgDataType: string,
    currentPropType: string,
    sampleValues: unknown[],
    isPk: boolean
): InferenceResult {
    const result: InferenceResult = {};
    const extraLines: string[] = [];

    // Filter out null/undefined for analysis
    const validValues = sampleValues.filter(v => v !== null && v !== undefined && v !== "");

    if (validValues.length === 0) {
        return result; // Not enough data
    }

    const colNameLower = columnName.toLowerCase();

    // ── Number Analysis ──────────────────────────────────────────────────
    if (currentPropType === "number") {
        // Boolean stored as int
        const allZeroOrOne = validValues.every(v => v === 0 || v === 1 || v === "0" || v === "1");
        if (allZeroOrOne) {
            result.propType = "boolean";
            return result; // Don't do min/max if boolean
        }

        // Min / Max constraints
        const numValues = validValues.map(v => Number(v)).filter(v => !isNaN(v));
        if (numValues.length === validValues.length) {
            const min = Math.min(...numValues);
            const max = Math.max(...numValues);
            // Example heuristic: percentages
            if (min >= 0 && max <= 100 && (colNameLower.includes("percent") || colNameLower.includes("rate") || colNameLower.includes("score"))) {
                extraLines.push("            validation: {\n                min: 0,\n                max: 100\n            }");
            } else if (min >= 0 && (colNameLower.includes("count") || colNameLower.includes("total") || colNameLower.includes("amount"))) {
                extraLines.push("            validation: {\n                min: 0\n            }");
            }
        }

        // No currency heuristic. `admin.currency` was never a declared option and
        // nothing reads it, so a column called `price` got a block of config that did
        // nothing — invisible because this generator emits *source text*, which no
        // typechecker ever saw. Reinstate it by adding `currency` to
        // AdminNumberOptions first, and something that renders it.
    }

    // ── JSON / JSONB Analysis ────────────────────────────────────────────
    if (currentPropType === "map" || pgDataType.includes("json")) {
        // PostGres jsonb can be object or array
        let allArrays = true;
        let allObjects = true;

        for (const v of validValues) {
            let parsed = v;
            if (typeof v === "string") {
                try { parsed = JSON.parse(v); } catch (e) { allArrays = false; allObjects = false; break; }
            }
            if (Array.isArray(parsed)) {
                allObjects = false;
            } else if (typeof parsed === "object" && parsed !== null) {
                allArrays = false;
            } else {
                allArrays = false;
                allObjects = false;
            }
        }

        if (allArrays && !allObjects) {
            result.propType = "array";
            // Infer inner type
            let allNumbers = true;
            let allStrings = true;
            for (const v of validValues) {
                const parsed = typeof v === "string" ? JSON.parse(v) : v;
                for (const item of parsed) {
                    if (typeof item !== "number") allNumbers = false;
                    if (typeof item !== "string") allStrings = false;
                }
            }
            const innerType = allNumbers ? "number" : allStrings ? "string" : "map";
            extraLines.push(`            of: { name: "${humanize(columnName)} Item", type: "${innerType}" }`);
        } else {
            result.propType = "map";

            // Infer inner schema
            if (allObjects && validValues.length > 0) {
                const schema: Record<string, string> = {};
                for (const v of validValues) {
                    const parsed = typeof v === "string" ? JSON.parse(v) : v;
                    for (const [k, val] of Object.entries(parsed)) {
                        if (val === null || val === undefined) continue;
                        const type = typeof val;
                        if (type === "string" || type === "number" || type === "boolean") {
                            if (!schema[k]) schema[k] = type;
                            else if (schema[k] !== type) schema[k] = "mixed";
                        } else if (Array.isArray(val)) {
                            if (!schema[k]) schema[k] = "array";
                            else if (schema[k] !== "array") schema[k] = "mixed";
                        } else if (type === "object") {
                            if (!schema[k]) schema[k] = "map";
                            else if (schema[k] !== "map") schema[k] = "mixed";
                        }
                    }
                }

                const keys = Object.keys(schema).filter(k => schema[k] !== "mixed");
                if (keys.length > 0) {
                    const props = keys.map(k => {
                        return `\n                ${k}: { name: "${humanize(k)}", type: "${schema[k]}" }`;
                    }).join(",");
                    extraLines.push(`            properties: {${props}\n            }`);
                } else {
                    extraLines.push("            keyValue: true");
                }
            } else {
                extraLines.push("            keyValue: true");
            }
        }
    }

    // ── String Analysis ──────────────────────────────────────────────────
    if (currentPropType === "string") {
        // Date/Time Strings
        if (validValues.every(v => typeof v === "string" && ISO_8601_REGEX.test(v))) {
            result.propType = "date";
            return result;
        }

        // Implicit Enums
        const uniqueValues = new Set(validValues);
        // Determine the maximum length among unique values
        let maxEnumLength = 0;
        for (const v of uniqueValues) {
            if (typeof v === "string" && v.length > maxEnumLength) {
                maxEnumLength = v.length;
            }
        }

        // Ensure no empty string, max length makes sense, and fewer unique values than total values (unless small total)
        if (uniqueValues.size > 0 && uniqueValues.size <= 5 && maxEnumLength <= 50 && validValues.length > uniqueValues.size && !uniqueValues.has("")) {
            const isLikelyId = isPk || colNameLower.endsWith("_id");
            if (!isLikelyId) {
                const enumEntries = Array.from(uniqueValues).map(v => `{ id: ${JSON.stringify(v)}, label: ${JSON.stringify(humanize(v as string))} }`).join(", ");
                extraLines.push(`            enum: [${enumEntries}]`);
                result.extra = extraLines.length > 0 ? "\n" + extraLines.join(",\n") + "," : "";
                return result; // Skip other string checks if it's an enum
            }
        }

        // UUID / CUID Detection
        const allUuid = validValues.every(v => typeof v === "string" && UUID_REGEX.test(v));
        const allCuid = validValues.every(v => typeof v === "string" && CUID_REGEX.test(v));
        if (allUuid) {
            if (isPk) extraLines.push("            isId: \"uuid\"");
        } else if (allCuid) {
            if (isPk) extraLines.push("            isId: \"cuid\"");
        }

        // Color Codes
        const allColors = validValues.every(v => typeof v === "string" && COLOR_HEX_REGEX.test(v));
        if (allColors) {
            extraLines.push("            admin: {\n                color: true\n            }");
        }

        // Text Lengths, Multiline & Markdown
        let maxLength = 0;
        let hasNewlines = false;
        let hasMarkdown = false;
        for (const v of validValues) {
            if (typeof v === "string") {
                if (v.length > maxLength) maxLength = v.length;
                if (v.includes("\n")) hasNewlines = true;
                if (/^#{1,6}\s+.+/m.test(v) || /\*\*.+\*\*/.test(v) || /\[.+\]\(.+\)/.test(v) || /^\s*[-*]\s+.+/m.test(v)) {
                    hasMarkdown = true;
                }
            }
        }

        if (hasMarkdown) {
            extraLines.push("            multiline: true,\n            markdown: true");
        } else if (hasNewlines || maxLength > 100) {
            extraLines.push("            multiline: true");
        }

        if (maxLength > 0 && maxLength < 10000) { // arbitrary cap to avoid huge limits
            // Pad the max length slightly for the constraint
            const paddedMax = Math.ceil((maxLength * 1.5) / 10) * 10;
            // Only add length constraint if it seems like a bounded string, not a long text
            if (paddedMax < 255) {
                extraLines.push(`            validation: {\n                max: ${paddedMax}\n            }`);
            }
        }

        // Storage & Media (Extracted from old logic)
        const isUrl = colNameLower.endsWith("_url") || colNameLower.endsWith("_uri") || colNameLower.endsWith("_link");
        const isMedia = colNameLower.includes("image") || colNameLower.includes("avatar") || colNameLower.includes("photo") || colNameLower.includes("logo") || colNameLower.includes("cover");

        const allAbsoluteUrls = validValues.every(v => typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://")));
        if (allAbsoluteUrls) {
            const isImage = validValues.some(v => typeof v === "string" && v.match(/\.(jpeg|jpg|gif|png|webp|svg)/i));
            if (isImage || isMedia) {
                extraLines.push("            admin: {\n                url: \"image\"\n            }");
            } else {
                extraLines.push("            admin: {\n                url: true\n            }");
            }
        } else {
            const hasFileExtension = validValues.some(v => typeof v === "string" && v.match(/\.[a-zA-Z0-9]+$/));
            if (hasFileExtension) {
                const firstVal = validValues[0] as string;
                const lastSlash = firstVal.lastIndexOf("/");
                const inferredStoragePath = lastSlash > 0 ? firstVal.substring(0, lastSlash) : "files";
                extraLines.push(`            storage: {\n                storagePath: "${inferredStoragePath}"\n            }`);
            } else if (isUrl) {
                if (isMedia) {
                    extraLines.push("            admin: {\n                url: \"image\"\n            }");
                } else {
                    extraLines.push("            admin: {\n                url: true\n            }");
                }
            }
        }
    }

    result.extra = extraLines.length > 0 ? "\n" + extraLines.join(",\n") + "," : "";
    return result;
}
