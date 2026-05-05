import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as LucideIcons from "lucide-react";

export async function generateIconKeys() {
    const keys = Object.keys(LucideIcons).filter(k => 
        k !== "createLucideIcon" && 
        k !== "default" && 
        k !== "icons" && 
        k !== "LucideIcon" && 
        k !== "Icon" && 
        k !== "LucideProvider" &&
        k !== "useLucideContext" &&
        !k.endsWith("Node") && 
        !k.endsWith("Props") &&
        !k.endsWith("Icon") &&
        // Filter out Lucide-prefixed duplicates (e.g. "LucideArrowDown" duplicates "ArrowDown")
        !k.startsWith("Lucide")
    );

    // Remove case-insensitive duplicates (e.g. "ArrowDownAZ" vs "ArrowDownAz"),
    // keeping the first occurrence (typically the canonical PascalCase name)
    const seen = new Set<string>();
    const deduped = keys.filter(k => {
        const lower = k.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
    });

    saveIconKeys(deduped);
    return deduped;
}

function saveIconKeys(keys: string[]) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    fs.writeFileSync(path.join(__dirname, "../icons/icon_keys.ts"), `export const iconKeys = ${JSON.stringify(keys, null, 4)};`);
}

generateIconKeys();
