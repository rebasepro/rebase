import React from "react";
import { createRoot } from "react-dom/client";
import { loadFonts } from "../fonts";
import { App } from "./App";

/* The film's three faces, from public/fonts — the same files the render
   loads, served by scripts/live.mjs at the site root. */
loadFonts();

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
