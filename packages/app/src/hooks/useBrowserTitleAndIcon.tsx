import { useEffect } from "react";

const rebaseLogo = "data:image/png;base64,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";

/**
 * Internal hook to handle the browser title and icon
 * @param name
 * @param logo
 */
export function useBrowserTitleAndIcon(name: string, logo?: string) {
    useEffect(() => {
        if (document) {
            document.title = `${name} - Rebase`;
            let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
            if (!link) {
                link = document.createElement("link");
                link.rel = "icon";
                document.getElementsByTagName("head")[0].appendChild(link);
            }
            link.href = logo ?? rebaseLogo;
        }
    }, [name, logo]);
}
