import type { StringProperty } from "@rebasepro/cms-types";
import React from "react";

import { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { PropertyPreview } from "../../preview";

import { cls, IconButton, Tooltip } from "@rebasepro/ui";
import { ErrorBoundary, FileTextIcon, XIcon } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

interface StorageItemPreviewProps {
    name: string;
    property: StringProperty;
    value: string,
    onRemove: (value: string) => void;
    size: PreviewSize;
    disabled: boolean;
    placeholder?: boolean;
    className?: string;
}

export function StorageItemPreview({
    name,
    property,
    value,
    onRemove,
    disabled,
    size,
    placeholder,
    className
}: StorageItemPreviewProps) {
    const { t } = useTranslation();

    return (
        <div className={cls(
            "relative border-box flex items-center justify-center rounded-md overflow-hidden bg-surface-well",
            size === "large" ? "min-w-[220px] min-h-[220px] max-w-[220px]" : "min-w-[96px] min-h-[96px] max-w-[118px]",
            className)}>

            {!placeholder && !disabled &&
                <div
                    className="absolute rounded-md top-1.5 right-1.5 z-10 bg-surface-card/90 shadow-xs">

                    <Tooltip
                        asChild={true}
                        title={t("remove")}>
                        <IconButton aria-label={t("remove")}
                            size={"smallest"}
                            onClick={(event) => {
                                event.stopPropagation();
                                onRemove(value);
                            }}>
                            <XIcon size={13}/>
                        </IconButton>
                    </Tooltip>
                </div>
            }

            {!placeholder && value &&
                <ErrorBoundary>
                    <PropertyPreview propertyKey={name}
                        value={value}
                        property={property}
                        interactive={false}
                        size={size}/>
                </ErrorBoundary>
            }

            {placeholder &&
                <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex flex-col items-center justify-center w-full h-full">
                    <FileTextIcon className="text-surface-700 dark:text-surface-300"/>
                </div>
            }

        </div>
    );

}
