import React, { useEffect, useState } from "react";
import { isStorageReference } from "@rebasepro/types";
import { ReactNodeViewProps } from "./ReactNodeView";
import { cls } from "@rebasepro/ui";
import { isRenewableImageSrc, loadableImageSrc } from "../extensions/Image";

export const ImageComponent: React.FC<ReactNodeViewProps> = ({ node, view, getPos }) => {
    // If the node is selected
    const selected = view.state.selection.from === getPos();

    // What is stored may be a `rebase-storage:` reference, which a browser
    // cannot load; it is exchanged for a URL each time the image is shown. A
    // download URL saved before references is renewed the same way, and shown
    // as saved meanwhile.
    const stored: string = node.attrs.src;
    const [shown, setShown] = useState<string | undefined>(isStorageReference(stored) ? undefined : stored);
    useEffect(() => {
        let live = true;
        if (!isRenewableImageSrc(stored)) {
            setShown(stored);
            return;
        }
        setShown(isStorageReference(stored) ? undefined : stored);
        loadableImageSrc(view.state, stored).then((url) => {
            if (live) setShown(url);
        });
        return () => {
            live = false;
        };
    }, [stored, view]);

    return (
        <img
            src={shown}
            alt={node.attrs.alt || ""}
            title={node.attrs.title || ""}
            className={cls(
                "rounded-lg max-w-full !m-0",
                selected ? "" : ""
            )}
        />
    );
};
