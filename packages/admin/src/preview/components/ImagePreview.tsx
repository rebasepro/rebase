import { CopyIcon, ExternalLinkIcon, ImageOffIcon } from "@rebasepro/ui";
import React, { CSSProperties, useMemo, useState, useEffect } from "react";import { IconButton, Tooltip } from "@rebasepro/ui";
import { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { getThumbnailMeasure } from "../util";
import { useTranslation } from "@rebasepro/app";
import { sanitizeUrl } from "../util";

/**
 * @group Preview components
 */
export interface ImagePreviewProps {
    size: PreviewSize,
    url: string,
    /**
     * If true, image fills its container completely with object-fit cover
     */
    fill?: boolean
}

/**
 * @group Preview components
 */
export function ImagePreview({
    size,
    url,
    fill
    }: ImagePreviewProps) {
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setHasError(false);
    }, [url]);

    const handleError = () => setHasError(true);

    const imageSize = useMemo(() => getThumbnailMeasure(size), [size]);
    const { t } = useTranslation();

    // Fill mode - image fills its container completely
    if (fill) {
        if (hasError) {
            return (
                <div className="w-full h-full flex items-center justify-center bg-surface-100 dark:bg-surface-900 rounded-md">
                    <ImageOffIcon className="text-surface-400 dark:text-surface-500"/>
                </div>
            );
        }
        return (
            <img src={url}
                className={"w-full h-full object-cover"}
                key={"fill_image_preview_" + url}
                loading="lazy"
                onError={handleError}
            />
        );
    }

    if (size === "small") {
        if (hasError) {
            return (
                <div className="flex items-center justify-center bg-surface-100 dark:bg-surface-900 rounded-md"
                     style={{ width: imageSize,
height: imageSize,
maxHeight: "100%" }}>
                    <ImageOffIcon className="text-surface-400 dark:text-surface-500"/>
                </div>
            );
        }
        return (
            <img src={url}
                className={"rounded-md"}
                key={"tiny_image_preview_" + url}
                onError={handleError}
                style={{
                    position: "relative",
                    objectFit: "cover",
                    width: imageSize,
                    height: imageSize,
                    maxHeight: "100%"
                }}/>
        );
    }

    const imageStyle: CSSProperties =
    {
        maxWidth: "100%",
        maxHeight: "100%"
    };

    return (
        <div
            className="relative flex items-center justify-center max-w-full max-h-full group"
            style={{
                width: imageSize,
                height: imageSize
            }}
            key={"image_preview_" + url}>

            {hasError ? (
                <div className="w-full h-full flex items-center justify-center bg-surface-100 dark:bg-surface-900 rounded-md">
                    <ImageOffIcon className="text-surface-400 dark:text-surface-500"/>
                </div>
            ) : (
                <img src={url}
                    className={"rounded-md"}
                    style={imageStyle}
                    onError={handleError}/>
            )}

            <div className={"flex flex-row gap-2 absolute bottom-[-4px] right-[-4px] invisible group-hover:visible"}>
                {navigator && <Tooltip
                    asChild={true}
                    title={t("copy_url_to_clipboard")} side={"bottom"}>
                    <IconButton
                        variant={"filled"}
                        size={"smallest"}
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            return navigator.clipboard.writeText(url);
                        }}>
                        <CopyIcon className={"text-surface-700 dark:text-surface-300"}/>
                    </IconButton>
                </Tooltip>}

                <Tooltip title={t("open_image_in_new_tab")} side={"bottom"}>
                    <IconButton
                        className="invisible group-hover:visible"
                        variant={"filled"}
                        component={"a" as React.ElementType}
                        href={sanitizeUrl(url)}
                        rel="noopener noreferrer"
                        target="_blank"
                        size={"smallest"}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        <ExternalLinkIcon className={"text-surface-700 dark:text-surface-300"}/>
                    </IconButton>
                </Tooltip>
            </div>

        </div>
    );
}
