import React from "react";
import { createRoot } from "react-dom/client";
import { McpAppBridge } from "../bridge";
import { CollectionTable } from "./CollectionTable";
import "../index.css";

const bridge = new McpAppBridge();

// The host's light or dark, on the class the UI kit's `dark:` variant reads.
bridge.onhostcontext = (context) => {
    if (context.theme) document.documentElement.classList.toggle("dark", context.theme === "dark");
};

const container = document.getElementById("root");
if (container) {
    createRoot(container).render(<CollectionTable bridge={bridge}/>);
    // Connected after the first render, so the handlers for the tool result
    // are in place before the host sends it.
    void bridge.connect({ name: "rebase-collection-table", version: "0.1.0" });
}
