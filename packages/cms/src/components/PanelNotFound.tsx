import React from "react";
import { CenteredView, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

/** What a record panel draws for a collection or record that is not there. */
export function PanelNotFound({ className }: { className?: string }) {
    const { t } = useTranslation();
    return (
        <CenteredView className={className}>
            <Typography variant="body2" color="secondary">
                {t("entity_not_found")}
            </Typography>
        </CenteredView>
    );
}
