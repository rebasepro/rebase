import React from "react"
import ReactDOM from "react-dom/client"
import "./index.css"
import App from "./App";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

const router = createBrowserRouter([
    {
        path: "*",
        element: <App />
    }
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>
)
