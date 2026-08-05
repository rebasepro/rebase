import React from "react";

import { IconButton, iconSize, PanelLeftOpenIcon, Tooltip } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

/**
 * Brings the list back beside a record that was opened full screen.
 *
 * The mirror of {@link SplitListCloseButton}: the same edge of the same bar,
 * the same pane glyph opening rather than closing, and the same single route —
 * showing the list is dropping the `#full` hash. It replaces the back arrow
 * where it applies, because the list it unfolds already holds the record.
 */
export function SplitListShowButton({ onClick }: { onClick: () => void }) {

    const { t } = useTranslation();

    return (
        <Tooltip title={t("show_list")}>
            <IconButton
                size="small"
                onClick={onClick}
                aria-label={t("show_list")}>
                <PanelLeftOpenIcon size={iconSize.smallest}/>
            </IconButton>
        </Tooltip>
    );
}
