import React, { useContext } from "react";

/**
 * The enclosing master-detail split view, exposed to the list panel so it can
 * carry the control that closes it.
 */
export type SplitViewController = {
    /** Whether a record is open in the detail pane. */
    detailOpen: boolean;
    /**
     * Close the list and leave the open record on its own, full screen. This is
     * the existing full-screen entity route (`#full`), not a second mechanism.
     */
    openFullScreen: () => void;
};

const SplitViewContext = React.createContext<SplitViewController | undefined>(undefined);

/**
 * The enclosing split view, or `undefined` when the component is not rendered
 * inside one (a side panel, a dialog, a full-screen route).
 */
export function useSplitView(): SplitViewController | undefined {
    return useContext(SplitViewContext);
}

export function SplitViewProvider({
    value,
    children
}: { value: SplitViewController, children: React.ReactNode }) {
    return <SplitViewContext.Provider value={value}>
        {children}
    </SplitViewContext.Provider>;
}
