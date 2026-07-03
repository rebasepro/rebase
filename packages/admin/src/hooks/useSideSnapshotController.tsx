import type { SideSnapshotController } from "@rebasepro/types";
import React, { useContext } from "react";

export const SideSnapshotControllerContext = React.createContext<SideSnapshotController>({} as SideSnapshotController);

/**
 * Use this hook to retrieve a snapshot controller that allows you to open
 * a side dialog to edit a snapshot.
 *
 * @see SideSnapshotController
 * @group Hooks and utilities
 */
export const useSideSnapshotController = (): SideSnapshotController => useContext(SideSnapshotControllerContext);
