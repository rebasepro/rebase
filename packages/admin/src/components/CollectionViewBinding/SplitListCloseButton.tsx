import React from "react";

import { ChevronsLeftIcon, IconButton, iconSize, Tooltip } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

import { useSplitView } from "./SplitViewContext";

/**
 * Closes the list of a split view, leaving the open record on its own.
 *
 * It leads the record's own app bar, where the breadcrumb starts — this is the
 * entity pane's old "Open full screen" button, moved to that edge and wearing a
 * double chevron pointing at the list it folds away: closing the list and
 * opening the record full screen are the same thing, so there is one control
 * and one route (`#full`) rather than two. Full screen carries the mirrored
 * chevron to bring the list back.
 */
export function SplitListCloseButton() {

    const { t } = useTranslation();
    const splitView = useSplitView();

    if (!splitView?.detailOpen) return null;

    return (
        <Tooltip title={t("hide_list")}>
            <IconButton
                size="small"
                onClick={splitView.openFullScreen}
                aria-label={t("hide_list")}>
                <ChevronsLeftIcon size={iconSize.smallest}/>
            </IconButton>
        </Tooltip>
    );
}
