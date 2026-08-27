/**
 * Router-aware wrapper around CollectionsStudioView.
 *
 * This component provides the react-router-based navigation behavior
 * that Rebase Studio expects: the active collection is derived from the
 * URL, and clicking a collection navigates via react-router.
 *
 * External consumers should use `CollectionsStudioView` directly
 * (which has no react-router dependency).
 */
import React from "react";
import { useLocation, useNavigate } from "react-router";
import { useUrlController } from "../../_cms_internals";
import { CollectionsStudioView, CollectionsStudioViewProps } from "./CollectionsStudioView";

export type RouterCollectionsStudioViewProps = Omit<CollectionsStudioViewProps, "activeCollectionId" | "onActiveCollectionChange">;

export function RouterCollectionsStudioView(props: RouterCollectionsStudioViewProps) {
    const navigate = useNavigate();
    const urlController = useUrlController();
    const location = useLocation();

    // Determine the active collection from the URL segment after "schema/"
    const basePath = urlController.buildAppUrlPath("schema");
    const relativePath = location.pathname.replace(basePath, "").replace(/^\//, "");
    const activeCollectionId = relativePath.split("/")[0] || undefined;

    return (
        <CollectionsStudioView
            {...props}
            activeCollectionId={activeCollectionId}
            onActiveCollectionChange={(id) => {
                if (id) {
                    navigate(urlController.buildAppUrlPath(`schema/${id}`));
                } else {
                    navigate(urlController.buildAppUrlPath("schema"));
                }
            }}
        />
    );
}
