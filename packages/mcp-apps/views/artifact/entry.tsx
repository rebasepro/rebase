import React from "react";
import { Alert } from "@rebasepro/ui";
import { readPageApp, startArtifactApp, statusLine } from "./start";

const page = readPageApp();
if (typeof page === "string") {
    statusLine().show(<Alert color="error" size="small">{page}</Alert>);
} else {
    void startArtifactApp(page);
}
