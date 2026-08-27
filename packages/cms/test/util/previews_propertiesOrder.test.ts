/**
 * @jest-environment jsdom
 */
import {
    getEntityPreviewKeys,
    getEntityTitlePropertyKey
} from "../../src/util/previews";
import { resolveCollectionSlotKeys } from "../../src/components/CollectionViewBinding/usePreviewSlots";
import type { CollectionConfig, Property } from "@rebasepro/types";
import type { AuthController, PropertyConfig } from "@rebasepro/cms-types";

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
            relation: {
                kind: "belongsTo",
                target: () => ({} as CollectionConfig),
                relationName: "project",
                onDelete: "cascade",
            }
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

/**
 * A relation that is *not* what the collection leads with: the row has text of
 * its own, so the relation stays a chip.
 */
const collectionWithTrailingRelation: CollectionConfig = {
    id: "labelled",
    name: "Labelled",
    slug: "labelled",
    path: "labelled",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        } as unknown as Property,
        label: {
            name: "Label",
            type: "string"
        } as Property,
        project: (databasesCollection.properties as Record<string, Property>).project
    }
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

    // A collection that *leads* with a relation is named by it, ordered or not:
    // the leading relation is what the row is about, and the rule reads
    // declaration order rather than property names.
    it("uses the leading relation as the title even without propertiesOrder", () => {
        const slotKeys = resolveCollectionSlotKeys(databasesCollectionNoOrder, mockAuthController, fields);
        expect(slotKeys.titleKey).toBe("project");
        // Already the row's headline — not repeated as a chip below it.
        expect(slotKeys.relationKeys).not.toContain("project");
        expect(slotKeys.subtitleKey).not.toBe("project");
    });

    it("still separates a relation that is not the leading property into relationKeys", () => {
        const slotKeys = resolveCollectionSlotKeys(collectionWithTrailingRelation, mockAuthController, fields);
        expect(slotKeys.titleKey).toBe("label");
        expect(slotKeys.relationKeys).toContain("project");
        expect(slotKeys.subtitleKey).not.toBe("project");
    });
});

// ---------------------------------------------------------------------------
// Regression: a storage/image property first in propertiesOrder must not
// become the title slot — it belongs to the dedicated image slot, and using
// it for both would render the same image twice per row.
// ---------------------------------------------------------------------------
describe("getEntityTitlePropertyKey does not pick a storage/image property as title", () => {

    const exercisesCollection: CollectionConfig = {
        id: "exercises",
        name: "Exercises",
        singularName: "Exercise",
        slug: "exercises",
        path: "exercises",
        properties: {
            medico_enabled: {
                name: "Medico enabled",
                type: "boolean"
            } as Property,
            image: {
                name: "Image",
                type: "string",
                storage: {
                    storagePath: "images",
                    acceptedFiles: ["image/*"]
                }
            } as unknown as Property,
            exercise_type: {
                name: "Exercise type",
                type: "string"
            } as Property
        },
        propertiesOrder: [
            "medico_enabled",
            "image",
            "exercise_type"
        ]
    } as unknown as CollectionConfig;

    it("skips the storage image and picks the next string property as title", () => {
        const titleKey = getEntityTitlePropertyKey(exercisesCollection, fields);
        expect(titleKey).toBe("exercise_type");
        expect(titleKey).not.toBe("image");
    });

    it("resolveCollectionSlotKeys keeps title and image slots distinct", () => {
        const slotKeys = resolveCollectionSlotKeys(exercisesCollection, mockAuthController, fields);
        expect(slotKeys.imageKey).toBe("image");
        expect(slotKeys.titleKey).toBe("exercise_type");
        expect(slotKeys.titleKey).not.toBe(slotKeys.imageKey);
    });
});
