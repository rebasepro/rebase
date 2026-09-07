import { AdminModeControllerContext } from "../contexts/AdminModeController";
import { useContext } from "react";

/**
 * Use this controller to change the admin mode: `"cms"` for editing data,
 * `"studio"` for the developer tools.
 * @group Hooks and utilities
 */
export interface AdminModeController {
    mode: "cms" | "studio";
    setMode: (mode: "cms" | "studio") => void;
}

/**
 * Hook to retrieve the current admin mode (`"cms"` | `"studio"`), and `setMode`
 * to change it.
 *
 * Consider that in order to use this hook you need to have a parent
 * `Rebase`
 *
 * @see AdminModeController
 * @group Hooks and utilities
 */
export const useAdminModeController = () => useContext(AdminModeControllerContext);
