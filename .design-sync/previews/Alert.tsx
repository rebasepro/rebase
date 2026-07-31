import React from "react";
import { Alert, Button } from "@rebasepro/ui";

// Ported from UIReferenceView's "Chips & Alerts" section.
export const Colors = () => (
    <div className="flex flex-col gap-2 p-4 max-w-[520px]">
        <Alert color="info">Info — informational message</Alert>
        <Alert color="success">Success — operation completed</Alert>
        <Alert color="warning">Warning — attention required</Alert>
        <Alert color="error">Error — something went wrong</Alert>
    </div>
);

// The canonical admin pattern: an alert that carries its own remediation.
// Ported from UIReferenceView's "Management Screen" section.
export const WithAction = () => (
    <div className="p-4 max-w-[520px]">
        <Alert color="warning" action={<Button>Make me admin</Button>}>
            No admin users exist. You can make yourself an admin.
        </Alert>
    </div>
);
