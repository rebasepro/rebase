import { PostgresCollection, EntityCollection } from "@rebasepro/types";

const rolesCollection: PostgresCollection = {
    name: "Roles",
    singularName: "Role",
    slug: "roles",
    table: "roles",
    schema: "rebase",
    icon: "Shield",
    group: "Settings",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "manual",
            validation: {
                required: true
            }
        },
        name: {
            name: "Name",
            type: "string",
            validation: {
                required: true
            }
        },
        isAdmin: {
            name: "Is Admin",
            type: "boolean",
            columnName: "is_admin",
            defaultValue: false
        },
        defaultPermissions: {
            name: "Default Permissions",
            type: "map",
            columnName: "default_permissions",
            properties: {
                read: { name: "Read", type: "boolean" },
                create: { name: "Create", type: "boolean" },
                edit: { name: "Edit", type: "boolean" },
                delete: { name: "Delete", type: "boolean" }
            }
        },
        collectionPermissions: {
            name: "Collection Permissions",
            type: "map",
            columnName: "collection_permissions"
        }
    }
};

rolesCollection.securityRules = [
    {
        name: "roles_public_access",
        mode: "permissive",
        operation: "all",
        pgRoles: ["public"],
        using: "true"
    }
];

export default rolesCollection;
