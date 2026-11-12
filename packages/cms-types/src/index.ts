/**
 * @rebasepro/cms-types — the React-flavoured half of the Rebase type surface.
 *
 * Everything here describes the admin panel: what a collection looks like on
 * screen, the controllers the panel runs on, the props a custom field or view
 * receives. It depends on @rebasepro/types and nothing in @rebasepro/types
 * depends on it, which is what lets a BaaS install exist without React.
 *
 * If you are building a backend, you want @rebasepro/types.
 */
// Side-effect import: this is what adds `admin` back onto the core types.
import "./augment";

export * from "./types/property_options";
// Before `./collections`, and deliberately its own module: this is the builder
// every collection file imports, and a collection file is loaded by the backend
// as well as by the panel. `./collections` holds the panel's view models and
// imports React as a value; nothing in the builder's graph may reach it.
export * from "./define_collection";
// Beside the builder, for the same reason: a collection file combines its
// callback sets with it, and it is the panel-free `@rebasepro/common` one.
export { composeCallbacks } from "@rebasepro/common";
export * from "./collections";
export * from "./admin_collection";
// The admin block's keys as data, and the way back from the flat view model to the block.
export * from "./admin_block";
// `customizeTable`'s types: the deltas a frontend states over a table's default collection.
export * from "./table_customization";
// The collection editor's edits to a `defineFirestoreCollection` call.
export * from "./firestore_collection_patch";
export * from "./rebase_context";
export * from "./types";
export * from "./controllers";
// The view-model helpers the panel runs on (resolution, defaults, conditions, permissions).
export * from "./util";
