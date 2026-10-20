import React, { useContext } from "react";
import type { AccessSimulation } from "@rebasepro/types";

/**
 * How the banner names what is simulated — a key's name, a user's email —
 * which the headers alone do not carry.
 *
 * @group Models
 */
export type RlsSimulationLabel =
    | { kind: "role"; role: string; userId?: string }
    | { kind: "user"; user: string }
    | { kind: "apiKey"; name: string; keyPrefix: string };

/**
 * The RLS simulator's state: what the admin panel's data views run as.
 *
 * While `simulation` is set, every data view reads through a client derived
 * with `client.simulate()`, so a grid shows exactly the rows and fields that
 * role, user or key can read. `null` is the signed-in administrator.
 *
 * @group Models
 */
export interface RlsSimulationController {
    /**
     * Whether simulation is possible here: the client can derive a simulated
     * one, and the default data source is that client (not a direct driver).
     */
    available: boolean;
    simulation: AccessSimulation | null;
    label: RlsSimulationLabel | null;
    setSimulation(simulation: AccessSimulation | null, label?: RlsSimulationLabel | null): void;
}

const DEFAULT_CONTROLLER: RlsSimulationController = {
    available: false,
    simulation: null,
    label: null,
    setSimulation: () => undefined
};

export const RlsSimulationContext = React.createContext<RlsSimulationController>(DEFAULT_CONTROLLER);

/**
 * The RLS simulator's state, for the bar that sets it and the banner that
 * shows it.
 *
 * @group Hooks and utilities
 */
export function useRlsSimulation(): RlsSimulationController {
    return useContext(RlsSimulationContext);
}
