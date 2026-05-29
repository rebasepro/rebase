import React from "react";
import {
    cls,
    colorClassesMapping,
    coolIconKeys,
    IconColor,
    iconKeys,
    iconSize,
    lucideIcons
} from "@rebasepro/ui";
import { deepEqual as equal } from "fast-equals"
import { hashString, slugify } from "@rebasepro/utils";

// iconKeys are now PascalCase strings (e.g. "ShoppingCart", "Users")
const iconKeysMap: Record<string, string> = iconKeys.reduce((acc: Record<string, string>, key) => {
    // Also add lowercase versions and snake_case versions to support legacy lookups
    const lower = key.toLowerCase();
    const snake = key.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
    acc[lower] = key;
    acc[snake] = key;
    acc[key] = key;
    return acc;
}, {});

function toPascalCase(str: string): string {
    return str.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

/**
 * Resolve a Lucide icon component by string key.
 * Tries direct match, PascalCase conversion, and falls back to CircleAlert.
 */
function resolveIcon(iconKey: string): React.ComponentType<{ size?: number; className?: string }> | null {
    const iconsMap = lucideIcons as Record<string, React.ComponentType<{ size?: number; className?: string }> | undefined>;
    let icon = iconsMap[iconKey];
    if (!icon) {
        icon = iconsMap[toPascalCase(iconKey)];
    }
    if (!icon) {
        icon = iconsMap.CircleAlert;
    }
    return icon ?? null;
}

/**
 * Render an icon element from a string key or existing React element.
 * This resolves the icon from the lucide-react icons map directly.
 */
export function getIcon(iconKey?: string | React.ReactNode,
    className?: string,
    color?: IconColor,
    size?: "smallest" | "small" | "medium" | "large" | number): React.ReactElement | undefined {

    if (React.isValidElement(iconKey)) {
        return iconKey;
    }

    if (!iconKey) return undefined;
    if (typeof iconKey === "string") {
        const lowerKey = iconKey.toLowerCase();
        const slugifiedKey = slugify(iconKey).replace(/-/g, "_");

        const mappedKey = iconKeysMap[iconKey] || iconKeysMap[lowerKey] || iconKeysMap[slugifiedKey];

        if (!mappedKey) {
            return undefined;
        }

        const LucideIcon = resolveIcon(mappedKey);
        if (!LucideIcon) return undefined;

        const sizeInPx = typeof size === "number" ? size : iconSize[size ?? "medium"];
        return <LucideIcon
            size={sizeInPx}
            className={cls(
                color ? colorClassesMapping[color] : "",
                "select-none shrink-0",
                className
            )}
        />;
    }

    console.warn("Invalid icon key provided:", iconKey);
    return undefined;
}

export type IconViewProps = {
    slug: string;
    name: string;
    singularName?: string;
    group?: string;
    icon?: string | React.ReactNode;
}

export const IconForView = React.memo(
    function IconForView({
        collectionOrView,
        className,
        color,
        size = "medium"
    }: {
        collectionOrView?: IconViewProps,
        color?: IconColor,
        className?: string,
        size?: "smallest" | "small" | "medium" | "large" | number,
    }): React.ReactElement {
        if (!collectionOrView) return <></>;
        const icon = getIcon(collectionOrView.icon, className, color, size);
        if (collectionOrView?.icon && icon)
            return icon;

        let pathname = slugify(("singularName" in collectionOrView ? collectionOrView.singularName : undefined) ?? collectionOrView.name).replace(/-/g, "_");

        let key: string | undefined;
        if (pathname in iconKeysMap)
            key = iconKeysMap[pathname];

        if (!key) {
            pathname = slugify(collectionOrView.slug).replace(/-/g, "_");
            if (pathname in iconKeysMap)
                key = iconKeysMap[pathname];
        }

        const iconsCount = coolIconKeys.length;

        if (!key)
            key = coolIconKeys[hashString(collectionOrView.slug) % iconsCount];

        const LucideIcon = resolveIcon(key);
        if (!LucideIcon) return <></>;

        const sizeInPx = typeof size === "number" ? size : iconSize[size];
        return <LucideIcon
            size={sizeInPx}
            className={cls(
                color ? colorClassesMapping[color] : "",
                "select-none shrink-0",
                className
            )}
        />;
    }, (prevProps, nextProps) => {
        return equal(prevProps.collectionOrView?.icon, nextProps.collectionOrView?.icon) &&
            prevProps.collectionOrView?.name === nextProps.collectionOrView?.name &&
            prevProps.collectionOrView?.slug === nextProps.collectionOrView?.slug &&
            prevProps.collectionOrView?.singularName === nextProps.collectionOrView?.singularName &&
            equal(prevProps.color, nextProps.color) &&
            prevProps.className === nextProps.className &&
            prevProps.size === nextProps.size;
    });
