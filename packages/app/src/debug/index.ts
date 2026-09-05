/**
 * `@rebasepro/app/debug` — the design reference and the demo dashboard.
 *
 * These three used to be on the package's main barrel, which meant every
 * consumer shipped them: `UIReferenceView` is a single file that renders every
 * component in the kit, `CrmDashboardDemo` is a fake CRM with sample data, and
 * `UIStyleGuide` is a token sheet. Nobody building an admin panel imports any
 * of them, and nothing in the framework does either — the `/debug/ui` route
 * that rendered `UIReferenceView` was hardcoded into `RebaseRouteDefs`, so the
 * whole reference was a static dependency of the admin's route table.
 *
 * They are not dead, though: `/debug/ui` in the dogfood app is where the design
 * language is read from, and the marketing site renders both on public pages.
 * A subpath is what that shape wants — reachable by name, paid for only by
 * whoever asks.
 */
export * from "./UIStyleGuide";
export * from "./UIReferenceView";
export { CrmDashboardDemo } from "./crm-dashboard/CrmDashboardDemo";
