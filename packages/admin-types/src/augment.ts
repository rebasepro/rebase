/**
 * The admin block, added back onto the core types by declaration merging.
 *
 * `@rebasepro/types` declares no `admin` field — not on `BaseCollectionConfig`, not on
 * any property. A BaaS install therefore cannot write one: `admin: { … }` on a property
 * there is a type error, which is the whole point. Installing this package is what makes
 * the surface exist.
 *
 * This works because every target is an `interface`. Interfaces merge; `type` aliases do
 * not, so `BaseProperty` and the ten concrete property types must stay interfaces in core
 * for this file to be possible at all.
 *
 * Two consequences worth knowing:
 *
 * - The augmentation applies to the whole **program**, not to the files that import it.
 *   `config/` and `frontend/` are separate tsconfig programs, so a collection file needs
 *   this package in *its* program. The templates do that with one line in one file —
 *   `config/admin.d.ts`, holding `/// <reference types="@rebasepro/admin-types" />` —
 *   which is why no collection file has to import anything from here to write `admin`.
 *   That reference resolves through `typeRoots`, so the project must also depend on this
 *   package; `tooling/scripts/check-templates.mjs` asserts both halves.
 * - Each concrete property narrows the block to its own options type
 *   (`AdminStringOptions` on `StringProperty`, and so on). That is legal because each
 *   extends `AdminPropertyOptions`, exactly as it was declared when these lived in core.
 */
import type {
    AdminArrayOptions,
    AdminDateOptions,
    AdminMapOptions,
    AdminNumberOptions,
    AdminPropertyOptions,
    AdminReferenceOptions,
    AdminRelationOptions,
    AdminStringOptions,
    AdminVectorOptions
} from "./types/property_options";
import type { AdminCollectionOptions } from "./admin_collection";
// Named in the merged declaration's parameter list, which must match core's.
import type { User } from "@rebasepro/types";

declare module "@rebasepro/types" {

    /**
     * Presentation and behaviour for a collection in the admin panel.
     *
     * The type parameters are repeated here verbatim because declaration
     * merging requires an identical parameter list — and they have to be
     * *forwarded* to `AdminCollectionOptions`, which is the part that was
     * missing. Written as a bare `admin?: AdminCollectionOptions`, `M` fell
     * back to its default `Record<string, unknown>`, so `Extract<keyof M,
     * string>` widened to `string` and every key-shaped field in the block —
     * `display`, `sort`, `propertiesOrder`, `listProperties` — silently
     * accepted any string. The completion `defineCollection` advertises is
     * derived from `M`, so it never appeared: the inference was computed,
     * carried to this seam, and dropped one line short of the field that
     * needed it.
     */
    interface BaseCollectionConfig<
        M extends Record<string, unknown> = Record<string, unknown>,
        USER extends User = User
    > {
        admin?: AdminCollectionOptions<M, USER>;
    }

    interface BaseProperty<CustomProps = unknown> {
        admin?: AdminPropertyOptions<CustomProps>;
    }

    interface StringProperty { admin?: AdminStringOptions; }
    interface NumberProperty { admin?: AdminNumberOptions; }
    interface BooleanProperty { admin?: AdminPropertyOptions; }
    interface VectorProperty { admin?: AdminVectorOptions; }
    interface DateProperty { admin?: AdminDateOptions; }
    interface GeopointProperty { admin?: AdminPropertyOptions; }
    interface ReferenceProperty { admin?: AdminReferenceOptions; }
    interface RelationProperty { admin?: AdminRelationOptions; }
    interface ArrayProperty { admin?: AdminArrayOptions; }
    interface MapProperty { admin?: AdminMapOptions; }
}
