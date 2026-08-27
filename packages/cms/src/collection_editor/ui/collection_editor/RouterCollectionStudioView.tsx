/**
 * Router-aware wrapper around CollectionStudioView.
 *
 * This component provides the react-router-based navigation behavior
 * that Rebase Studio expects: cancel navigates to the root path,
 * save navigates to the saved collection's slug, and a snackbar
 * toast is shown on success.
 *
 * External consumers should use `CollectionStudioView` directly
 * (which has no react-router dependency).
 */
import React from "react";
import { useNavigate } from "react-router";
import { useUrlController } from "../../_cms_internals";
import { useSnackbarController } from "@rebasepro/app";
import { CollectionStudioView, CollectionStudioViewProps } from "./CollectionStudioView";

export type RouterCollectionStudioViewProps = Omit<CollectionStudioViewProps, "onSave" | "onCancel">;

export function RouterCollectionStudioView(props: RouterCollectionStudioViewProps) {
    const navigate = useNavigate();
    const urlController = useUrlController();
    const snackbarController = useSnackbarController();

    return (
        <CollectionStudioView
            {...props}
            onCancel={() => {
                navigate(urlController.buildAppUrlPath("/"));
            }}
            onSave={(savedCollection) => {
                if (savedCollection) {
                    snackbarController.open({
                        type: "success",
                        message: `Collection ${savedCollection.name || savedCollection.slug} saved`
                    });
                    if (props.collectionId === "new") {
                        navigate(urlController.buildAppUrlPath(`s/schema/${savedCollection.slug}`));
                    }
                }
            }}
        />
    );
}
