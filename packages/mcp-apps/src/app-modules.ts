/**
 * The modules an app Claude writes may import: the server's compiler refuses
 * any other, and the view's `require` hands out exactly these.
 */
export const APP_MODULES = [
    "react",
    // What JSX compiles to; never written by hand.
    "react/jsx-runtime",
    // The UI kit: Card, Button, Typography, Tabs, Chip, TextField, Select, …
    "@rebasepro/ui",
    // KPI tiles and charts.
    "@rebasepro/plugin-insights",
    // The app SDK: the project's data, and the admin panel's views of it.
    "@rebasepro/mcp-apps"
] as const;

export type AppModule = (typeof APP_MODULES)[number];
