/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react";
import type { AuthController, AdminCollection } from "@rebasepro/cms-types";

import { usePermissions } from "../../src/hooks/usePermissions";
import { AuthControllerContext } from "../../src/contexts/AuthControllerContext";
import { RlsSimulationContext, type RlsSimulationController } from "../../src/contexts/RlsSimulationContext";

/**
 * "Simulate access" is read-only: the server refuses every write carrying a
 * simulation (`SIMULATION_READ_ONLY`). The admin panel's create, edit and
 * delete affordances were still computed from the signed-in administrator's
 * roles, so a form offered a save that ran as the simulated user — and, once
 * refused, failed only on save. While simulating, the views offer none.
 */

const admin = { user: { uid: "admin-1", roles: ["admin"] } } as unknown as AuthController;
const posts = { slug: "posts", name: "Posts", properties: {} } as unknown as AdminCollection;

function permissionsWith(simulation: RlsSimulationController["simulation"]) {
    let seen: ReturnType<typeof usePermissions> | undefined;
    function Probe() {
        seen = usePermissions();
        return null;
    }
    const controller: RlsSimulationController = { available: true, simulation, label: null, setSimulation: () => undefined };
    render(
        <AuthControllerContext.Provider value={admin}>
            <RlsSimulationContext.Provider value={controller}>
                <Probe/>
            </RlsSimulationContext.Provider>
        </AuthControllerContext.Provider>
    );
    const p = seen!;
    return {
        create: p.canCreate(posts, "posts"),
        edit: p.canEdit(posts, "posts", null),
        delete: p.canDelete(posts, "posts", null),
        read: p.canRead(posts)
    };
}

describe("usePermissions while access is simulated", () => {
    it("lets the administrator create, edit and delete when not simulating", () => {
        expect(permissionsWith(null)).toEqual({ create: true, edit: true, delete: true, read: true });
    });

    it("offers no create, edit or delete while simulating, and still reads", () => {
        expect(permissionsWith({ role: "customer", userId: "u_1" })).toEqual({ create: false, edit: false, delete: false, read: true });
    });
});
