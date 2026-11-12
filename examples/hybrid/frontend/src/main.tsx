import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { App } from "./App";
import "./index.css";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([{ path: "/*", element: <App/> }], { basename });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router}/>
    </React.StrictMode>
);
