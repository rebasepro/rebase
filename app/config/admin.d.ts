/// <reference types="@rebasepro/cms-types" />

// One line, once per project. `@rebasepro/cms-types` declares the `admin` block on
// `CollectionConfig` and on every property type by declaration merging, and an
// augmentation applies to the whole *program* — so this reference is what makes
// `admin: { … }` legal in every collection file here.
//
// A BaaS project has no admin panel and no reason for this file; without it, `admin`
// on a collection or a property is a type error, which is the guarantee.
