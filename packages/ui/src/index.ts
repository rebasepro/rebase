"use client";
// The whole kit is one client boundary for React Server Components, as it was
// when `dist` was a single file that inherited the directive from any module
// carrying it. `dist` is one file per module now, and only 44 of them say
// "use client" themselves; on the entry it keeps every export a client
// reference, exactly as before.

// =============================================================================
// Components
// =============================================================================
export * from "./components";

// =============================================================================
// Views
// =============================================================================
export * from "./views";

// =============================================================================
// Icons
// =============================================================================
export * from "./icons";

// =============================================================================
// Design System Utilities
// =============================================================================
export * from "./styles";
export { cls } from "./util/cls";
export { lazyChunk, loadChunk, isChunkLoadError } from "./util/lazy_chunk";
export { CHIP_COLORS, CHIP_HUES, CHIP_SEED_KEYS, getColorSchemeForKey, getColorSchemeForSeed } from "./util/chip_colors";
export type { ChipHue, ChipTone } from "./util/chip_colors";

// =============================================================================
// Public Hooks
// =============================================================================
export { useOutsideAlerter } from "./hooks/useOutsideAlerter";
export { useDebouncedCallback } from "./hooks/useDebouncedCallback";
export { useDebounceCallback } from "./hooks/useDebounceCallback";
export { useIsDarkMode } from "./hooks/useIsDarkMode";
export { useDebounceValue } from "./hooks/useDebounceValue";
export { useInjectStyles } from "./hooks/useInjectStyles";
export { PortalContainerProvider, usePortalContainer } from "./hooks/PortalContainerContext";
export type { PortalContainerContextType, PortalContainerProviderProps } from "./hooks/PortalContainerContext";
export { UiLabelsProvider, useUiLabels, defaultUiLabels } from "./hooks/UiLabelsContext";
export type { UiLabels, UiLabelsProviderProps, UiRelativeTimeLabels } from "./hooks/UiLabelsContext";

// =============================================================================
// Lower-level utilities (used by framework packages)
// =============================================================================
export { debounce } from "./util/debounce";
export { isKeyHandled } from "./util/keys";
export type { Cancelable } from "./util/debounce";

// =============================================================================
// NOT exported (internal plumbing — import directly if needed):
//
//   ./util/hash                   – hashString
//   ./util/key_to_icon_component  – keyToIconComponent
// =============================================================================
