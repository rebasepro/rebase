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
export { useDebounceValue } from "./hooks/useDebounceValue";
export { useInjectStyles } from "./hooks/useInjectStyles";
export { PortalContainerProvider, usePortalContainer } from "./hooks/PortalContainerContext";
export type { PortalContainerContextType, PortalContainerProviderProps } from "./hooks/PortalContainerContext";

// =============================================================================
// Lower-level utilities (used by framework packages)
// =============================================================================
export { debounce } from "./util/debounce";
export type { Cancelable } from "./util/debounce";

// =============================================================================
// NOT exported (internal plumbing — import directly if needed):
//
//   ./util/hash                   – hashString
//   ./util/key_to_icon_component  – keyToIconComponent
// =============================================================================
