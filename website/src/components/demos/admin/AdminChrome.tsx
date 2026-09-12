import React from "react";
import {
  ArrowUpDown, ChevronsRight, Download, Funnel, Plus, Search, Settings, Upload
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   The product's own chrome, drawn once.

   The admin.yourdomain.com carousel is three tabs of the SAME app, and each
   tab used to carry its own copy of the drawer, the toolbar and the buttons.
   Copies drift: when the product moved its toolbar to a labelled view button,
   a round search pill and quiet end actions, the list tab kept its own slab and
   the table tab kept a four-icon segmented control — two different apps inside
   one browser frame, neither of them the one we ship.

   Everything here is read off the shipped markup:
     Scaffold.tsx                    — frame / sheet, the lg inset and its radius
     DefaultDrawer + DrawerNavigationItem — the 72px rail, 30px rows, 44px icon wells
     CollectionViewStartActions + ViewModeToggle — the left group
     SearchBar.tsx                   — the h-32 rounded-full field
   Change it there, change it here, and all three tabs move together.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Scaffold root: the frame is the ground everything else sits on. */
export const SHELL_ROOT =
  "flex overflow-hidden bg-surface-frame text-surface-900 dark:text-white pointer-events-none select-none relative";

/**
 * The content sheet — one lightness step above the frame AND a hairline on its
 * edge, inset on large layouts. Both halves matter: the step alone is ~3 L* and
 * the two grounds read as one black without the line.
 *
 * The `lg:mt-2` is Scaffold's `!hasAppBar` branch: in the product the inset on
 * top comes from the DrawerHeader spacer, and the sheet only asks for a margin
 * of its own when there is no app bar above it. These tabs draw no app bar, so
 * without it the sheet was inset left, right and bottom but flush with the top.
 */
export const SHELL_SHEET =
  "bg-surface-sheet grow overflow-auto m-0 mt-1 lg:mx-2 lg:mb-2 lg:mt-2 lg:rounded-xl lg:border lg:border-hairline flex flex-col";

export type DrawerItem = {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  active?: boolean;
};

/** The collapsed navigation rail: logo, one 30px row per collection, toggle. */
export function AdminDrawer({ items }: { items: DrawerItem[] }) {
  return (
    <div className="z-20 relative hidden sm:block" style={{ width: 72 }}>
      <div
        className="h-full no-scrollbar overflow-y-auto overflow-x-hidden relative bg-surface-frame"
        style={{ width: 72 }}
      >
        <div className="flex flex-col h-full">
          <div className="flex flex-row items-center shrink-0 pt-4 pb-0 px-2">
            <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
              <img src="/img/rebase_logo.svg" width="306" height="306" alt="Rebase"
                className="w-[28px] h-[28px] object-contain"/>
            </div>
          </div>

          <div className="flex-grow min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar px-2">
            <div className="my-2 flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    aria-label={item.label}
                    className={`rounded-lg truncate flex flex-row items-center h-[30px] font-medium text-[13px] ${
                      item.active
                        ? "bg-primary/8 dark:bg-primary/10 text-primary"
                        : "text-surface-700 dark:text-surface-300 hover:bg-surface-hover"
                    }`}
                  >
                    <div
                      className={`shrink-0 flex items-center justify-center w-[44px] h-[30px] ${
                        item.active ? "text-primary" : "text-surface-500 dark:text-text-secondary-dark"
                      }`}
                    >
                      <Icon size={16}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* The account, then the expand toggle — the two things the rail
              always ends with. Without the avatar it ended on a lone chevron. */}
          <div className="shrink-0 flex items-center px-[16px] py-1">
            <div className="shrink-0 flex items-center justify-center w-[44px] rounded-md py-1">
              <span className="bg-surface-raised flex items-center justify-center font-medium text-surface-accent-900 dark:text-text-primary-dark rounded-full w-8 h-8 text-xs">
                D
              </span>
            </div>
          </div>

          <div className="shrink-0 mt-auto px-2 py-2">
            <div className="flex flex-row items-center rounded-lg py-2">
              <div className="shrink-0 flex items-center justify-center w-[44px] h-[24px] text-surface-500 dark:text-text-secondary-dark">
                <ChevronsRight size={16}/>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** IconButton, `size="small"`: a 32px round well, accent ink, no fill at rest. */
export function ToolbarIconButton({
  label,
  disabled,
  children
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={`text-surface-accent-500 dark:text-surface-accent-300 inline-flex items-center justify-center
        ease-in-out duration-150 [&>svg]:shrink-0 w-8 h-8 min-w-8 min-h-8 p-2
        bg-transparent hover:bg-surface-hover rounded-full
        ${disabled ? "opacity-50" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * The add action, as `CollectionViewActions` draws it on a large layout: a
 * labelled `Button size="small" variant="filled" color="primary"`. The icon-only
 * filled square is the COMPACT form — what the split-list toolbar falls back to
 * when the pane is narrow — and drawing it at full width left the panel's one
 * primary action reading as a quiet glyph in a row of quiet glyphs.
 */
export function ToolbarAddButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="typography-button h-fit rounded-lg whitespace-nowrap inline-flex items-center justify-center
        gap-2 w-fit border border-primary bg-primary text-white py-0 min-h-[32px] px-2"
    >
      <Plus size={20}/>
      {label}
    </button>
  );
}

/** The view-mode trigger: a labelled `Button size="small"`, not a segmented rail. */
export function ViewModeButton({
  icon: Icon,
  label
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <button
      type="button"
      className="h-fit rounded-lg whitespace-nowrap inline-flex items-center justify-center gap-2 w-fit
        border border-transparent bg-surface-raised hover:bg-surface-raised-hover
        text-text-primary dark:text-text-primary-dark py-0 min-h-[32px] px-2
        [&>svg]:text-surface-accent-500 dark:[&>svg]:text-surface-accent-300"
    >
      <Icon size={20}/>
      <span className="ml-1 text-sm">{label}</span>
    </button>
  );
}

/** SearchBar, `size="small"`: a 32px rounded-full field, not a rounded-lg box. */
export function ToolbarSearch({ width = 180 }: { width?: number }) {
  return (
    <div
      role="search"
      aria-label="Search"
      className="relative h-[32px] bg-surface-field border border-hairline rounded-full overflow-hidden flex items-center"
      style={{ width }}
    >
      <div className="absolute p-0 h-full pointer-events-none flex items-center justify-center top-0 px-2">
        <Search size={18} className="text-text-disabled dark:text-text-disabled-dark"/>
      </div>
      <span className="pl-8 text-sm text-text-disabled dark:text-text-disabled-dark">Search</span>
    </div>
  );
}

/** Saved filters, offered as chips beside the filter and sort controls. */
export function FilterPresets({ presets }: { presets: string[] }) {
  return (
    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
      <div className="flex items-center gap-1 min-w-0 overflow-x-auto py-0.5 no-scrollbar">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className="inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap select-none shrink-0
              px-2 py-0.5 text-xs bg-transparent text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover"
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The collection toolbar. No bottom border: the table header below it draws the
 * only line, and two rules 40px apart read as a box around the controls.
 */
export function AdminToolbar({
  viewIcon,
  viewLabel,
  presets,
  addLabel,
  count
}: {
  viewIcon: React.ComponentType<{ size?: number }>;
  viewLabel: string;
  presets?: string[];
  addLabel: string;
  count?: string;
}) {
  return (
    <div className="no-scrollbar min-h-[52px] overflow-x-auto px-2 md:px-4 bg-surface-sheet flex flex-row justify-between items-center w-full shrink-0">
      <div className="flex items-center gap-1 md:mr-4 mr-2 min-w-0">
        <ViewModeButton icon={viewIcon} label={viewLabel}/>
        <ToolbarIconButton label="Filter">
          <Funnel size={16}/>
        </ToolbarIconButton>
        <ToolbarIconButton label="Sort">
          <ArrowUpDown size={16}/>
        </ToolbarIconButton>
        {presets && presets.length > 0 && <FilterPresets presets={presets}/>}
        {count && (
          <span className="mx-1 text-xs font-mono tabular-nums text-text-secondary dark:text-text-secondary-dark">
            {count}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <ToolbarSearch/>
        <ToolbarIconButton label="Import">
          <Upload size={20}/>
        </ToolbarIconButton>
        <ToolbarIconButton label="Export">
          <Download size={20}/>
        </ToolbarIconButton>
        <ToolbarIconButton label="Settings" disabled>
          <Settings size={18}/>
        </ToolbarIconButton>
        <ToolbarAddButton label={addLabel}/>
      </div>
    </div>
  );
}
