export type { ErrorViewProps } from "./ErrorView";
export { ErrorView } from "./ErrorView";


export * from "./common";

export * from "./NotFoundPage";

export * from "./ConfirmationDialog";
export * from "./ErrorTooltip";
export * from "./RebaseLogo";

export * from "./AIIcon";
// `UIStyleGuide`, `UIReferenceView` and `CrmDashboardDemo` used to be exported
// here, which meant every consumer of this package shipped a file that renders
// every component in the kit and a fake CRM with its sample data. They are
// `@rebasepro/app/debug` now — see `src/debug/index.ts`.
export * from "./UserSettingsView";
export * from "./LanguageToggle";
export * from "./UserSelectPopover";
export * from "./UserDisplay";

export * from "./LoginView";

export * from "./RebaseAuth";

export * from "./SchemaDriftBanner";
