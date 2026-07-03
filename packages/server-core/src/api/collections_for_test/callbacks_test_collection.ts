import { SnapshotCollection, BeforeSaveProps, AfterSaveProps, AfterSaveErrorProps, AfterReadProps, BeforeDeleteProps, AfterDeleteProps, PostgresCollection } from "@rebasepro/types";
import { logger } from "../../utils/logger";

export const callbacksTestCollection: PostgresCollection = {
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
        beforeSave: (props: BeforeSaveProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] beforeSave Triggered!", { detail: props });
            return {
                ...props.values,
                hasPreSaveTriggered: true,
                name: props.values.name + " (PreSaved)" // Modifying value before save
            };
        },
        afterSave: (props: AfterSaveProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] afterSave Triggered!", { detail: props });
            // This usually triggers other side effects (emails, notifications), log for now
        },
        afterSaveError: (props: AfterSaveErrorProps) => {
            logger.error("🔥 [BACKEND_CALLBACK] afterSaveError Triggered!", { detail: props });
        },
        afterRead: (props: AfterReadProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] afterRead Triggered!", { detail: props });
            return {
                ...props.row,
                hasFetchTriggered: true
            };
        },
        beforeDelete: (props: BeforeDeleteProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] beforeDelete Triggered!", { detail: props });
        },
        afterDelete: (props: AfterDeleteProps) => {
            logger.info("🔥 [BACKEND_CALLBACK] afterDelete Triggered!", { detail: props });
        }
    }
};
