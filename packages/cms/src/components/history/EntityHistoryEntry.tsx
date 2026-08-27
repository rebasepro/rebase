
import type { Property } from "@rebasepro/types";
import * as React from "react";

import { ArrowLeftIcon, Chip, cls, defaultBorderMixin, iconSize, Tooltip, Typography } from "@rebasepro/ui";
import { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { getPropertyInPath } from "../../util/property_utils";
import { PropertyPreview } from "../../preview/PropertyPreview";
import { SkeletonPropertyComponent } from "../../preview/property_previews/SkeletonPropertyComponent";
import { useAuthController } from "@rebasepro/app";
import { UserChip } from "./UserChip";
import { HistoryEntryData } from "../../hooks";
import { getValueInPath } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Recursive deep equality for primitives, arrays and plain objects.
 */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object") return false;

    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== (b as unknown[]).length) return false;
        return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
    }

    if (Array.isArray(b)) return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => key in bObj && deepEqual(aObj[key], bObj[key]));
}

export type EntityHistoryEntryProps = {
    size: PreviewSize;
    actions?: React.ReactNode;
    collection?: AdminCollection;
    hover?: boolean;
    entry: HistoryEntryData;
    onClick?: (e: React.SyntheticEvent) => void;
};

function PreviousValueView({
    previousValueInPath,
    childProperty,
    propertyKey
}: {
    previousValueInPath: unknown;
    childProperty: Property;
    propertyKey: string;
}) {
    if (typeof previousValueInPath === "string" || typeof previousValueInPath === "number") {
        return <Typography variant={"caption"} color={"secondary"} className="line-through">
            {previousValueInPath}
        </Typography>;
    } else if (typeof previousValueInPath === "boolean") {
        return <Typography variant={"caption"} color={"secondary"} className="line-through">
            {previousValueInPath ? "true" : "false"}
        </Typography>;
    } else {
        return <Tooltip
            side={"left"}
            title={<div className={"flex flex-col gap-2"}>
                <Typography variant={"caption"} color={"secondary"}>
                    Previous value
                </Typography>
                <PropertyPreview
                    propertyKey={propertyKey as string}
                    value={previousValueInPath as never}
                    property={childProperty as Property}
                    size={"small"}/>
            </div>}>
            <ArrowLeftIcon size={iconSize.smallest} color={"disabled"} className={"mb-1"}/>
        </Tooltip>
    }
}

/**
 * Displays a single entity history revision entry.
 * Adapted from the entity_history plugin — now reads from backend API data.
 */
export function EntityHistoryEntry({
    actions,
    hover,
    collection,
    size,
    entry
}: EntityHistoryEntryProps) {

    const authController = useAuthController();

    // The backend reports the whole row as changed, which includes the columns
    // that cannot meaningfully change: a timestamp it stamps itself on every
    // write, and the primary key, which is what identifies the row being
    // revised. Every revision was listing `updated_at: <now>` and `id: <the id
    // in the title bar>` around the one field the user actually edited.
    const changedFields = React.useMemo(() => {
        const all = entry.changed_fields;
        if (!all || !collection) return all;
        return all.filter(key => {
            const property = getPropertyInPath(collection.properties, key);
            if (!property) return true;
            if ("isId" in property && property.isId) return false;
            return !(property.type === "date" && "autoValue" in property && property.autoValue);
        });
    }, [entry.changed_fields, collection]);

    const previousValues = entry.previous_values;
    const updatedOn = new Date(entry.updated_at);
    const updatedBy = entry.updated_by;

    // Resolve user display
    const currentUser = authController.user;
    const userDisplay = updatedBy === currentUser?.uid
        ? currentUser
        : undefined;

    return <div className={"@container/histentry w-full flex flex-col gap-2"}>
        <div className={"flex items-center flex-wrap gap-2"}>
            <Typography variant={"body2"} color={"secondary"}>
                {updatedOn.toLocaleString()}
            </Typography>
            <Chip size={"small"}>
                {entry.action}
            </Chip>
            {!userDisplay && updatedBy && <Chip size={"small"}>{updatedBy}</Chip>}
            {userDisplay && <UserChip user={userDisplay}/>}
        </div>
        <div
            className={cls(
                "bg-white dark:bg-surface-900",
                "min-h-[44px]",
                "w-full",
                "items-center",
                hover ? "hover:bg-surface-accent-50 dark:hover:bg-surface-800" : "",
                size === "small" ? "p-1" : "px-2 py-1",
                "flex border rounded-lg",
                defaultBorderMixin
            )}>

            {actions}

            <div className={"flex flex-col grow w-full m-1 shrink min-w-0"}>

                {changedFields && collection && changedFields.map((key: string) => {
                    const childProperty = getPropertyInPath(collection.properties, key);
                    const valueInPath = entry.values ? getValueInPath(entry.values, key) : undefined;
                    const previousValueInPath = previousValues ? getValueInPath(previousValues, key) : undefined;

                    const element = childProperty
                        ? <PropertyPreview
                            propertyKey={key}
                            value={valueInPath as never}
                            property={childProperty as Property}
                            size={"small"}/>
                        : <Typography variant={"body2"}>
                            {typeof valueInPath === "string" ? valueInPath : JSON.stringify(valueInPath)}
                        </Typography>;

                    // The key column used to be `min-w-[200px] w-1/5` beside a
                    // `w-4/5` value — 200px of label and 80% of the row, which
                    // adds up to more than the row in anything narrower than a
                    // full page. In the inspector that pushed every value off
                    // the right edge and wrapped ids one character per line.
                    // It stacks until the entry itself is wide enough.
                    return (
                        <div key={"ref_prev_" + key}
                            className="flex flex-col @sm/histentry:flex-row @sm/histentry:items-baseline gap-x-4 gap-y-0.5 w-full my-1.5">
                            <Typography variant={"caption"}
                                color={"secondary"}
                                className="shrink-0 break-all @sm/histentry:w-40 @sm/histentry:text-right @sm/histentry:break-normal @sm/histentry:truncate">
                                {key}
                            </Typography>
                            <div className="min-w-0 flex-1 flex flex-col items-start gap-0.5">
                                {previousValueInPath !== undefined && !deepEqual(previousValueInPath, valueInPath) &&
                                    <PreviousValueView previousValueInPath={previousValueInPath}
                                        childProperty={childProperty as Property}
                                        propertyKey={key}/>
                                }
                                {element}
                            </div>
                        </div>
                    );
                })}

                {(!changedFields || changedFields.length === 0) && (
                    <Typography variant={"caption"} color={"secondary"}>
                        {entry.action === "create" ? "Entity created" :
                            entry.action === "delete" ? "Entity deleted" : "No field changes recorded"}
                    </Typography>
                )}

            </div>

        </div>
    </div>;
}
