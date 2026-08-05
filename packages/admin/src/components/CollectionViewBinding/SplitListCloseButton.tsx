import React from "react";

import { IconButton, iconSize, PanelLeftCloseIcon, Tooltip } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

import { useSplitView } from "./SplitViewContext";

/**
 * Closes the list of a split view, leaving the open record on its own.
 *
 * It leads the record's own app bar, where the breadcrumb starts — this is the
 * entity pane's old "Open full screen" button, moved to that edge: closing the
 * list and opening the record full screen are the same thing, so there is one
 * control and one route (`#full`) rather than two. Full screen carries the
 * mirrored icon to bring the list back.
 *
 * A pane glyph rather than the double chevron it wore first. Now that the bar
 * ends in a ✕ that dismisses the record, an arrow pointing off the left edge of
 * the record's own bar was the other thing on it that read as "close me" — and
 * it is the one control here that does not act on the record at all.
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
                <PanelLeftCloseIcon size={iconSize.smallest}/>
            </IconButton>
        </Tooltip>
    );
}
