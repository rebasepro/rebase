/**
 * @jest-environment jsdom
 */
import {
    getEntityPreviewKeys,
    getEntityTitlePropertyKey
} from "../../src/util/previews";
import { resolveCollectionSlotKeys } from "../../src/components/CollectionViewBinding/usePreviewSlots";
import type { AuthController, CollectionConfig, PropertyConfig, Property } from "@rebasepro/types";

const mockAuthController = {
    user: { uid: "test" },
    initialLoading: false
} as unknown as AuthController;

const fields: Record<string, PropertyConfig> = {};

/**
 * Exact replica of the databases collection config from saas/config.
 */
const databasesCollection: CollectionConfig = {
    id: "databases",
    name: "Databases",
    singularName: "Database",
    slug: "databases",
    path: "databases",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        } as unknown as Property,
        project: {
            name: "Project",
            type: "relation",
            relationName: "project",
            cardinality: "one",
            direction: "owning",
            target: () => ({} as CollectionConfig),
            onDelete: "cascade"
        } as unknown as Property,
        type: {
            name: "Type",
            type: "string",
            enum: [
                { id: "managed",
label: "SaaS Managed",
color: "green" },
                { id: "byodb",
label: "Bring Your Own DB",
color: "blue" }
            ]
        } as unknown as Property,
        connectionString: {
            name: "Connection String",
            type: "string"
        } as Property,
        useSshTunnel: {
            name: "Use SSH Tunnel",
            type: "boolean"
        } as Property,
        sshHost: {
            name: "SSH Bastion Host",
            type: "string"
        } as Property,
        sshPort: {
            name: "SSH Bastion Port",
            type: "number"
        } as Property,
        sshUser: {
            name: "SSH Bastion User",
            type: "string"
        } as Property,
        sshPublicKey: {
            name: "SSH Public Key",
            type: "string"
        } as Property,
        sshPrivateKey: {
            name: "SSH Private Key",
            type: "string"
        } as Property,
        connectionStatus: {
            name: "Connection Status",
            type: "string",
            enum: [
                { id: "connected",
label: "Connected",
color: "green" },
                { id: "failed",
label: "Failed",
color: "red" },
                { id: "untested",
label: "Untested",
color: "gray" }
            ]
        } as unknown as Property,
        pitrEnabled: {
            name: "PITR Enabled",
            type: "boolean"
        } as Property,
        lastBackupTime: {
            name: "Last Backup Time",
            type: "date",
            mode: "date_time"
        } as unknown as Property,
        recoveryWindowStart: {
            name: "Recovery Window Start",
            type: "date",
            mode: "date_time"
        } as unknown as Property
    },
    propertiesOrder: [
        "id",
        "project",
        "type",
        "connectionString",
        "useSshTunnel",
        "sshHost",
        "sshPort",
        "sshUser",
        "sshPublicKey",
        "sshPrivateKey",
        "connectionStatus",
        "pitrEnabled",
        "lastBackupTime",
        "recoveryWindowStart"
    ]
} as unknown as CollectionConfig;

/**
 * Same shape but WITHOUT propertiesOrder — should keep the old heuristic behavior.
 */
const databasesCollectionNoOrder: CollectionConfig = {
    ...databasesCollection,
    id: "databases_no_order",
    propertiesOrder: undefined
} as unknown as CollectionConfig;

// ---------------------------------------------------------------------------
// getEntityPreviewKeys — with explicit propertiesOrder
// ---------------------------------------------------------------------------
describe("getEntityPreviewKeys with propertiesOrder (databases collection)", () => {

    it("includes relation properties when propertiesOrder is set", () => {
        const result = getEntityPreviewKeys(mockAuthController, databasesCollection, fields, undefined, 10);
        expect(result).toContain("project");
    });

    it("respects the propertiesOrder ordering", () => {
        const result = getEntityPreviewKeys(mockAuthController, databasesCollection, fields, undefined, 10);
        const projectIdx = result.indexOf("project");
        const typeIdx = result.indexOf("type");
        const connIdx = result.indexOf("connectionString");
        // project should come before type and connectionString
        expect(projectIdx).toBeLessThan(typeIdx);
        expect(projectIdx).toBeLessThan(connIdx);
    });

    it("excludes id property", () => {
        const result = getEntityPreviewKeys(mockAuthController, databasesCollection, fields, undefined, 10);
        expect(result).not.toContain("id");
    });

    it("still excludes relations when propertiesOrder is NOT set", () => {
        const result = getEntityPreviewKeys(mockAuthController, databasesCollectionNoOrder, fields, undefined, 10);
        expect(result).not.toContain("project");
    });
});

// ---------------------------------------------------------------------------
// resolveCollectionSlotKeys — with explicit propertiesOrder
// ---------------------------------------------------------------------------
describe("resolveCollectionSlotKeys with propertiesOrder (databases collection)", () => {

    it("does not separate relations into relationKeys when propertiesOrder is set", () => {
        const slotKeys = resolveCollectionSlotKeys(databasesCollection, mockAuthController, fields);
        expect(slotKeys.relationKeys).toEqual([]);
    });

    it("uses project (relation) as titleKey since it is first meaningful property", () => {
        const slotKeys = resolveCollectionSlotKeys(databasesCollection, mockAuthController, fields);
        // titleKey should be "project" (first non-id property in propertiesOrder)
        expect(slotKeys.titleKey).toBe("project");
        // subtitleKey should be "connectionString" (first non-title candidate in propertiesOrder)
        expect(slotKeys.subtitleKey).toBe("connectionString");
    });

    it("still separates relations into relationKeys when propertiesOrder is NOT set", () => {
        const slotKeys = resolveCollectionSlotKeys(databasesCollectionNoOrder, mockAuthController, fields);
        expect(slotKeys.relationKeys).toContain("project");
        // subtitleKey should NOT be the relation
        expect(slotKeys.subtitleKey).not.toBe("project");
    });
});
