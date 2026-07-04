import type { SidePanelController } from "@rebasepro/types";
import React, { useContext } from "react";

export const SidePanelControllerContext = React.createContext<SidePanelController>({} as SidePanelController);

/**
 * Use this hook to retrieve a snapshot controller that allows you to open
 * a side dialog to edit a snapshot.
 *
 * @see SidePanelController
 * @group Hooks and utilities
 */
export const useSidePanel = (): SidePanelController => useContext(SidePanelControllerContext);
