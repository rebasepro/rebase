import React from "react";
import { CircularProgressCenter } from "@rebasepro/ui";

// CircularProgressCenter's root element is hard-coded to h-screen (it's meant
// to fill the viewport of a route while data loads), so it is rendered
// un-clipped here rather than inside a short fixed-height wrapper — a
// shorter overflow-hidden ancestor would crop the vertically-centered
// content out of view.
export const WithText = () => (
    <CircularProgressCenter size="medium" text="Loading workspace…"/>
);

export const NoText = () => (
    <CircularProgressCenter size="small"/>
);
