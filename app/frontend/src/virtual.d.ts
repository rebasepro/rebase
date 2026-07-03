/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

declare module "@fontsource/*";
declare module "*.css";

declare module "virtual:rebase-collections" {
    export const collections: import("@rebasepro/types").SnapshotCollection[];
}
