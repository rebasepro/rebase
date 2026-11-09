/**
 * @jest-environment jsdom
 */
import {
    getEntityPreviewKeys,
    getEntityTitlePropertyKey
} from "../../src/util/previews";
import { resolveCollectionSlotKeys } from "../../src/components/CollectionViewBinding/usePreviewSlots";
import type { CollectionConfig, Property } from "@rebasepro/types";
import type { AdminCollection, AuthController, PropertyConfig } from "@rebasepro/cms-types";
import { fakeAuthController, fakeUser } from "../helpers/fakes";

const mockAuthController = fakeAuthController({ user: fakeUser("test") });

const fields: Record<string, PropertyConfig> = {};

/**
 * Exact replica of the databases collection config from saas/config.
 */
const databasesCollection: AdminCollection = {
    name: "Databases",
    singularName: "Database",
    slug: "databases",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        project: {
            name: "Project",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => ({}),
                relationName: "project",
                onDelete: "cascade",
            }
        },
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
        },
        connectionString: {
            name: "Connection String",
            type: "string"
        },
        useSshTunnel: {
            name: "Use SSH Tunnel",
            type: "boolean"
        },
        sshHost: {
            name: "SSH Bastion Host",
            type: "string"
        },
        sshPort: {
            name: "SSH Bastion Port",
            type: "number"
        },
        sshUser: {
            name: "SSH Bastion User",
            type: "string"
        },
        sshPublicKey: {
            name: "SSH Public Key",
            type: "string"
        },
        sshPrivateKey: {
            name: "SSH Private Key",
            type: "string"
        },
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
        },
        pitrEnabled: {
            name: "PITR Enabled",
            type: "boolean"
        },
        lastBackupTime: {
            name: "Last Backup Time",
            type: "date",
            mode: "date_time"
        },
        recoveryWindowStart: {
            name: "Recovery Window Start",
            type: "date",
            mode: "date_time"
        }
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
};

/**
 * Same shape but WITHOUT propertiesOrder — should keep the old heuristic behavior.
 */
const databasesCollectionNoOrder: AdminCollection = {
    ...databasesCollection,
    propertiesOrder: undefined
};

/**
 * A relation that is *not* what the collection leads with: the row has text of
 * its own, so the relation stays a chip.
 */
const collectionWithTrailingRelation: AdminCollection = {
    name: "Labelled",
    slug: "labelled",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        label: {
            name: "Label",
            type: "string"
        },
        project: (databasesCollection.properties as Record<string, Property>).project
    }
};

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

    const exercisesCollection: AdminCollection = {
        name: "Exercises",
        singularName: "Exercise",
        slug: "exercises",
        properties: {
            medico_enabled: {
                name: "Medico enabled",
                type: "boolean"
            },
            image: {
                name: "Image",
                type: "string",
                storage: {
                    storagePath: "images",
                    acceptedFiles: ["image/*"]
                }
            },
            exercise_type: {
                name: "Exercise type",
                type: "string"
            }
        },
        propertiesOrder: [
            "medico_enabled",
            "image",
            "exercise_type"
        ]
    };

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
