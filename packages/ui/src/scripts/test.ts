import * as LucideIcons from "lucide-react";
import fs from "fs";

const keys = Object.keys(LucideIcons).filter(k => k !== "createLucideIcon" && k !== "default" && k !== "icons" && k !== "LucideIcon" && k !== "Icon");
console.log(`Found ${keys.length} icons`);
fs.writeFileSync("/tmp/lucide_keys.json", JSON.stringify(keys));
