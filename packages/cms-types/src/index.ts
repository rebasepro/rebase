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
export * from "./react_component_ref";
export * from "./collections";
export * from "./admin_collection";
export * from "./rebase_context";
export * from "./types";
export * from "./controllers";
