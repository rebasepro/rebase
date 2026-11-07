import React from "react";
import { createRoot } from "react-dom/client";
import { McpAppBridge } from "../bridge";
import { App } from "./App";
import "../index.css";

const bridge = new McpAppBridge();

// The host's light or dark, on the class the UI kit's `dark:` variant reads.
bridge.onhostcontext = (context) => {
    if (context.theme) document.documentElement.classList.toggle("dark", context.theme === "dark");
};

// A host may sandbox the view without `allow-forms`, and then a form's submit
// button submits nothing: the browser drops the submission before the form's
// `submit` event — the admin panel's record form saves on that event. The click
// still happens, so it is turned into the event itself, after the click has
// finished (a button's own handler may say which save it was).
document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[type=submit]") : null;
    if (!(button instanceof HTMLButtonElement) || !button.form || button.disabled) return;
    event.preventDefault();
    const form = button.form;
    setTimeout(() => form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button })));
}, true);

const container = document.getElementById("root");
if (container) {
    createRoot(container).render(<App bridge={bridge}/>);
    // Connected after the first render, so the handlers for the tool result
    // are in place before the host sends it.
    void bridge.connect({ name: "rebase", version: "0.2.0" });
}
