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
 *   this package in *its* program — a type-only import of `AdminCollectionConfig` does
 *   it, which is what the templates do.
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

declare module "@rebasepro/types" {

    /** Presentation and behaviour for a collection in the admin panel. */
    interface BaseCollectionConfig {
        admin?: AdminCollectionOptions;
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
