import React, { Suspense } from "react";
import { hasAdminRole } from "@rebasepro/types";
import { useRlsSimulation } from "../../contexts/RlsSimulationContext";
import { useAuthController } from "../../hooks/useAuthController";

// The pill and the banner are fetched the first time someone may see them, so
// the startup bundle carries only these two wrappers.
const RlsSimulatorBarPanel = React.lazy(() =>
    import("./RlsSimulatorPanel").then((module) => ({ default: module.RlsSimulatorBarPanel })));
const RlsSimulationBannerPanel = React.lazy(() =>
    import("./RlsSimulatorPanel").then((module) => ({ default: module.RlsSimulationBannerPanel })));

export interface RlsSimulatorBarProps {
    className?: string;
    /** An icon button instead of the pill — for a collapsed drawer rail. */
    compact?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    /** Where the popover mounts — inside a floating drawer, so hovering it keeps the drawer open. */
    portalContainer?: HTMLElement | null;
}

/**
 * Whether the signed-in person may simulate access here: an administrator,
 * with data views that ride a client able to derive a simulated one.
 *
 * @group Hooks and utilities
 */
export function useCanSimulateAccess(): boolean {
    const authController = useAuthController();
    const { available } = useRlsSimulation();
    return available && hasAdminRole(authController.user?.roles);
}

/**
 * "Simulate access": the app bar pill that runs every data view as a role, a
 * user or a service key, so an administrator sees exactly the rows and fields
 * that identity's row-level security lets it read.
 *
 * Shown only to an administrator, and only when the data views ride a client
 * that can derive a simulated one. The server checks the first again on every
 * request: anyone else sending the simulation headers gets a 403.
 *
 * @group Components
 */
export function RlsSimulatorBar(props: RlsSimulatorBarProps) {
    const canSimulate = useCanSimulateAccess();
    if (!canSimulate) return null;
    return (
        <Suspense fallback={null}>
            <RlsSimulatorBarPanel {...props}/>
        </Suspense>
    );
}

/**
 * The banner every screen shows while access is simulated: who the data views
 * run as, how many collections show that identity nothing, how many fields its
 * roles cannot read — and the way out.
 *
 * @group Components
 */
export function RlsSimulationBanner({ className }: { className?: string }) {
    const { simulation } = useRlsSimulation();
    if (!simulation) return null;
    return (
        <Suspense fallback={null}>
            <RlsSimulationBannerPanel className={className}/>
        </Suspense>
    );
}
