import React, { useEffect, useMemo, useState } from "react";
import type { ArrayProperty, EnumValues } from "@rebasepro/cms-types";
import { apiBaseOf, useAuthController, useRebaseClient, useTranslation } from "@rebasepro/app";
import type { FieldProps } from "../../types/fields";
import { MultiSelectFieldBinding } from "./MultiSelectFieldBinding";

/** A role as `GET /admin/roles` answers it. */
interface RoleOption {
    name: string;
    label?: string;
    assignable?: boolean;
}

/**
 * The users table's `roles` field: a multi-select over the project's roles.
 *
 * The options are the project's roles — the ones declared in code and the ones
 * made at runtime, as `GET /admin/roles` answers them — so the field offers the
 * roles that grant something. A role nobody defined is still a name row-level
 * security can match; it is given through the API. A role the user already holds stays listed
 * even when it is gone or not assignable, so saving the form never drops it
 * silently. Until the roles arrive the field lists what the user holds; where
 * the caller may not read them (no `users:read`), it says so under the field,
 * as it does for a role Rebase Cloud's "Open admin panel" granted, which is
 * taken back when the person's Cloud access goes.
 *
 * The CMS puts it on the auth table's `roles` property
 * (`injectAuthCollectionConfig`) unless the collection names its own field.
 * @group Form fields
 */
export function RolesSelectFieldBinding(props: FieldProps<ArrayProperty, unknown, Record<string, unknown>>) {
    const client = useRebaseClient();
    const { getAuthToken } = useAuthController();
    const { t } = useTranslation();
    const [roles, setRoles] = useState<RoleOption[] | undefined>(undefined);
    // Refused by the server: the caller cannot read the project's roles.
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        const apiBase = apiBaseOf(client);
        if (!apiBase) return;
        let cancelled = false;
        void (async () => {
            try {
                const token = await getAuthToken?.();
                const response = await fetch(`${apiBase}/admin/roles`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                if (!response.ok) {
                    if (!cancelled && (response.status === 401 || response.status === 403)) setUnavailable(true);
                    return;
                }
                const body = await response.json() as { roles?: RoleOption[] };
                if (!cancelled && Array.isArray(body.roles)) setRoles(body.roles);
            } catch {
                // The field still lists the roles the user holds.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [client, getAuthToken]);

    const held = useMemo(
        () => (Array.isArray(props.value) ? props.value.filter((v): v is string => typeof v === "string") : []),
        [props.value]
    );

    // Roles Rebase Cloud's "Open admin panel" granted (`metadata.platformRoles`):
    // taken back when the person's Cloud access goes, so the field says so.
    const metadata = props.context?.values?.metadata;
    const platformRoles = useMemo(() => {
        const listed = typeof metadata === "object" && metadata !== null && "platformRoles" in metadata ? metadata.platformRoles : undefined;
        return Array.isArray(listed) ? listed.filter((r): r is string => typeof r === "string" && held.includes(r)) : [];
    }, [metadata, held]);

    const property = useMemo<ArrayProperty>(() => {
        const enumValues: EnumValues = {};
        for (const role of roles ?? []) {
            if (role.assignable === false && !held.includes(role.name)) continue;
            enumValues[role.name] = role.label || role.name;
        }
        for (const name of held) {
            if (!(name in enumValues)) enumValues[name] = name;
        }
        const of = props.property.of && !Array.isArray(props.property.of) && props.property.of.type === "string"
            ? props.property.of
            : { type: "string" as const };
        const description = [
            props.property.description,
            unavailable ? t("roles_field_unavailable") : undefined,
            platformRoles.length > 0
                ? `${t("studio_users_platform_granted")}: ${t("studio_users_platform_granted_tooltip", { roles: platformRoles.join(", ") })}`
                : undefined
        ].filter(Boolean).join(" ") || undefined;
        return { ...props.property, description, of: { ...of, enum: enumValues } };
    }, [roles, held, props.property, unavailable, platformRoles, t]);

    return <MultiSelectFieldBinding {...props} property={property} includeDescription={props.includeDescription || unavailable || platformRoles.length > 0}/>;
}
