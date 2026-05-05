import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function saveIconFiles(iconKeys: string[]) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const componentsDir = path.join(__dirname, "../icons/components");

    // Clean out old generated components to remove stale files (e.g. Lucide-prefixed duplicates)
    if (fs.existsSync(componentsDir)) {
        fs.rmSync(componentsDir, { recursive: true });
    }
    fs.mkdirSync(componentsDir, { recursive: true });

    // Initialise index with manual exports
    fs.writeFileSync(path.join(__dirname, "../icons/index.ts"), 'export * from "./icon_keys";\nexport * from "./cool_icon_keys";\nexport * from "./Icon";\nexport * from "./GitHubIcon";\nexport * from "./HandleIcon";\n');

    const generatedComponents = new Set<string>();

    iconKeys.forEach((key: string) => {
        if (!key) return;

        // Ensure key works as component name
        let componentName = `${key}Icon`;
        
        // Handle names that might start with numbers like "10k" -> "_10k"
        if (/^[0-9]/.test(componentName)) {
            componentName = `_${componentName}`;
        }

        if (componentName === "Icon") {
            return;
        }

        if (generatedComponents.has(componentName.toLowerCase())) {
            return;
        }
        generatedComponents.add(componentName.toLowerCase());

        const iconComponent = `import React from "react";
import { IconProps } from "../Icon";
import { ${key} as LucideIcon } from "lucide-react";
import { cls } from "../../util";

/**
 * @group Icons
 */
export const ${componentName} = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
    let sizeInPx: number;
    switch (props.size) {
        case "smallest": sizeInPx = 16; break;
        case "small": sizeInPx = 20; break;
        case "medium": sizeInPx = 24; break;
        case "large": sizeInPx = 28; break;
        default: sizeInPx = typeof props.size === "number" ? props.size : 24;
    }

    const colorClassesMapping: Record<string, string> = {
        inherit: "",
        primary: "text-primary",
        success: "text-green-500",
        warning: "text-yellow-500",
        secondary: "text-secondary",
        disabled: "text-text-disabled dark:text-text-disabled-dark",
        error: "text-red-500"
    };

    return <LucideIcon
        ref={ref}
        size={sizeInPx}
        className={cls(
            props.color ? colorClassesMapping[props.color] : "",
            "select-none shrink-0",
            props.className
        )}
        style={props.style}
        onClick={props.onClick}
    />;
});

${componentName}.displayName = "${componentName}";
`;

        const filePath = path.join(componentsDir, `${componentName}.tsx`);
        fs.writeFileSync(filePath, iconComponent);

        fs.appendFileSync(path.join(__dirname, "../icons/index.ts"), `export * from "./components/${componentName}";\n`, { flag: "a" });
    });
}
