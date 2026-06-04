import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import "./index.css";

window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    console.error("[Rebase] Unhandled promise rejection:", event.reason);
});

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router}/>
    </React.StrictMode>
);
