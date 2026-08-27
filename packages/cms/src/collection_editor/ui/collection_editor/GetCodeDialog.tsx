import { useSafeSnackbarController } from "../../useSafeSnackbarController";

import { Button, CopyIcon, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import React from "react";
import JSON5 from "json5";
import { Highlight, themes } from "prism-react-renderer"
import { camelCase } from "./utils/strings";
import { clone } from "@rebasepro/forms";
import { isEmptyObject } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/cms-types";

export function GetCodeDialog({
    collection,
    onOpenChange,
    open
}: { onOpenChange: (open: boolean) => void, collection: AdminCollection, open: boolean }) {

    const snackbarController = useSafeSnackbarController();

    const code = collection
        ? "import { AdminCollection } from \"@rebasepro/app\";\n\nconst " + (collection?.name ? camelCase(collection.name) : "my") + "Collection:AdminCollection = " + JSON5.stringify(collectionToCode({ ...collection }), null, "\t")
        : "No collection selected";
    return <Dialog open={open}
        onOpenChange={onOpenChange}
        maxWidth={"4xl"}>
        <DialogTitle variant={"h6"}>Code for {collection.name}</DialogTitle>
        <DialogContent>

            <Typography variant={"body2"} className={"my-4 mb-8"}>
                If you want to customise the collection in code, you can add this collection code to your admin
                app configuration.
                More info in the <a
                    rel="noopener noreferrer"
                    href={"https://rebase.pro/docs/cloud/quickstart"}>docs</a>.
            </Typography>
            <Highlight
                theme={themes.vsDark}
                code={code}
                language="typescript"
            >
                {({
                    className,
                    style,
                    tokens,
                    getLineProps,
                    getTokenProps
                }) => (
                    <pre style={style} className={"p-4 rounded-xs text-sm"}>
                        {tokens.map((line, i) => (
                            <div key={i} {...getLineProps({ line })}>
                                {line.map((token, key) => (
                                    <span key={key} {...getTokenProps({ token })}/>
                                ))}
                            </div>
                        ))}
                    </pre>
                )}
            </Highlight>

        </DialogContent>
        <DialogActions>
            <Button
                variant={"text"}
                size={"small"}
                onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    snackbarController?.open({
                        type: "success",
                        message: "Copied"
                    })
                    return navigator.clipboard.writeText(code);
                }}>
                <CopyIcon/>
                CopyIcon to clipboard
            </Button>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogActions>
    </Dialog>;
}

function collectionToCode(collection: AdminCollection): object {

    const propertyCleanup = (value: unknown): unknown => {
        if (value === undefined || value === null) {
            return value;
        }
        const valueCopy = clone(value);
        if (typeof valueCopy === "function") {
            return valueCopy;
        }
        if (Array.isArray(valueCopy)) {
            return valueCopy.map((v: unknown) => propertyCleanup(v));
        }
        if (typeof valueCopy === "object") {
            if (valueCopy === null)
                return valueCopy;
            const obj = valueCopy as Record<string, any>;
            Object.keys(obj).forEach((key) => {
                if (!isEmptyObject(obj)) {
                    const childRes = propertyCleanup(obj[key]);
                    if (childRes !== null && childRes !== undefined && childRes !== false && !isEmptyObject(childRes)) {
                        obj[key] = childRes;
                    } else {
                        delete obj[key];
                    }
                }
            });
            delete obj.resolved;
            delete obj.propertiesOrder;
            delete obj.propertyConfig;

        }

        return valueCopy;
    }

    return {
        id: collection.slug,
        name: collection.name,
        singularName: collection.singularName,
        path: collection.slug,
        description: collection.description,

        icon: collection.icon,
        defaultFilter: collection.defaultFilter,
        sort: collection.sort,
        properties: Object.entries({
            ...(collection.properties ?? {})
        })
            .map(([key, value]) => ({
                [key]: propertyCleanup(value)
            }))
            .reduce((a, b) => ({
                ...a,
                ...b
            }), {})
        // subcollections: (collection.subcollections ?? []).map(collectionToCode)
    }

}
