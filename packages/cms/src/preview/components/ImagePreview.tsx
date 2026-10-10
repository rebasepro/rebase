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
     * A smaller rendition of `url` to display (a storage thumbnail). If it
     * fails to load, `url` itself is shown; the copy and open buttons always
     * use `url`.
     */
    previewUrl?: string,
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
    previewUrl,
    fill
    }: ImagePreviewProps) {
    const [hasError, setHasError] = useState(false);
    const [previewFailed, setPreviewFailed] = useState(false);

    useEffect(() => {
        setHasError(false);
        setPreviewFailed(false);
    }, [url, previewUrl]);

    const src = previewUrl && !previewFailed ? previewUrl : url;
    // A rendition that fails (a server that could not resize this file) gives
    // way to the original; only the original failing is an error.
    const handleError = () => (src !== url ? setPreviewFailed(true) : setHasError(true));

    const imageSize = useMemo(() => getThumbnailMeasure(size), [size]);
    const { t } = useTranslation();

    // Fill mode - image fills its container completely
    if (fill) {
        if (hasError) {
            return (
                <div className="w-full h-full flex items-center justify-center bg-surface-raised rounded-md">
                    <ImageOffIcon className="text-surface-400 dark:text-surface-500"/>
                </div>
            );
        }
        return (
            <img src={src}
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
                <div className="flex items-center justify-center bg-surface-raised rounded-md"
                     style={{ width: imageSize,
height: imageSize,
maxHeight: "100%" }}>
                    <ImageOffIcon className="text-surface-400 dark:text-surface-500"/>
                </div>
            );
        }
        return (
            <img src={src}
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
                <div className="w-full h-full flex items-center justify-center bg-surface-raised rounded-md">
                    <ImageOffIcon className="text-surface-400 dark:text-surface-500"/>
                </div>
            ) : (
                <img src={src}
                    className={"rounded-md"}
                    style={imageStyle}
                    onError={handleError}/>
            )}

            <div className={"flex flex-row gap-2 absolute bottom-[-4px] right-[-4px] invisible group-hover:visible"}>
                {navigator && <Tooltip
                    asChild={true}
                    title={t("copy_url_to_clipboard")} side={"bottom"}>
                    <IconButton aria-label={t("copy_url_to_clipboard")}
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
                    <IconButton aria-label={t("open_image_in_new_tab")}
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
