import { LegacyCollectionConfig, LegacyBeforeSaveProps, LegacyAfterSaveProps, LegacyAfterSaveErrorProps, LegacyAfterReadProps, LegacyBeforeDeleteProps, LegacyAfterDeleteProps, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { logger } from "../../src/utils/logger";

export const callbacksTestCollection: LegacyPostgresCollectionConfig = {
    name: "Callback Tests",
    slug: "callback_tests",
    table: "callback_tests",
    description: "A collection to test backend callbacks",
    properties: {
        name: {
            name: "Name",
            validation: { required: true },
            type: "string"
        },
        hasSaveSuccessTriggered: {
            name: "Save Success Triggered",
            type: "boolean"
        },
        hasPreSaveTriggered: {
            name: "Pre Save Triggered",
            type: "boolean"
        },
        hasFetchTriggered: {
            name: "Fetch Triggered",
            type: "boolean"
        }
    },
    callbacks: {
        beforeSave: (props: LegacyBeforeSaveProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] beforeSave Triggered!", { detail: props });
            return {
                ...props.values,
                hasPreSaveTriggered: true,
                name: props.values.name + " (PreSaved)" // Modifying value before save
            };
        },
        afterSave: (props: LegacyAfterSaveProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] afterSave Triggered!", { detail: props });
            // This usually triggers other side effects (emails, notifications), log for now
        },
        afterSaveError: (props: LegacyAfterSaveErrorProps) => {
            logger.error("🔥 [BACKEND_CALLBACK] afterSaveError Triggered!", { detail: props });
        },
        afterRead: (props: LegacyAfterReadProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] afterRead Triggered!", { detail: props });
            return {
                ...props.row,
                hasFetchTriggered: true
            };
        },
        beforeDelete: (props: LegacyBeforeDeleteProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] beforeDelete Triggered!", { detail: props });
        },
        afterDelete: (props: LegacyAfterDeleteProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] afterDelete Triggered!", { detail: props });
        }
    }
};
