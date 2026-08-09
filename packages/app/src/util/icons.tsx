import React from "react";
import {
    cls,
    colorClassesMapping,
    coolIconKeys,
    IconColor,
    iconKeys,
    iconSize,
    LucideIconByName
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

/**
 * Render an icon element from a string key or existing React element.
 *
 * Whether a key names an icon is decided here, against `iconKeys` — an array
 * of strings. The component behind the key is fetched by `LucideIconByName` on
 * first use: this used to index lucide's full `icons` map, which is the whole
 * library and cannot be tree-shaken.
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

        const sizeInPx = typeof size === "number" ? size : iconSize[size ?? "medium"];
        return <LucideIconByName
            name={mappedKey}
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

        const sizeInPx = typeof size === "number" ? size : iconSize[size];
        return <LucideIconByName
            name={key}
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
