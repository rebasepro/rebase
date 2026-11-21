import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { RebaseStudioApp } from "../src/components/RebaseStudioApp";

const rootEl = document.getElementById("root");
if (rootEl) {
    createRoot(rootEl).render(
        <React.StrictMode>
            <RebaseStudioApp basename="/_studio" apiUrl={window.location.origin} />
        </React.StrictMode>
    );
}
