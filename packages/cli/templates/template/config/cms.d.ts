/// <reference types="@rebasepro/cms-types" />

// One line, once per project. `@rebasepro/cms-types` declares the `admin` block on
// `CollectionConfig` and on every property type by declaration merging, and an
// augmentation applies to the whole *program* — so this reference is what makes
// `admin: { … }` legal in every collection file here.
//
// A BaaS project has no admin panel and no reason for this file. Without it, `admin` on
// a collection or a property is a type error, which is the guarantee.
//
// It is only needed by a file that annotates a collection with the *type* —
// `const posts: PostgresCollectionConfig = { … }`. Every collection here is written with
// `defineCollection()` instead, which is imported from `@rebasepro/cms-types` and brings
// the augmentation with it. The reference stays because it costs one line and covers the
// case where somebody reaches for the annotation.
