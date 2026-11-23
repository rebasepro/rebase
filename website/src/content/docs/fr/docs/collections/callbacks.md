---
sourceHash: 1487ed768dd198b7
title: Hooks de table
sidebar_label: Hooks de table
description: "Exécutez du code côté serveur à chaque étape du cycle de vie d'une table avec les hooks : restreindre les lectures, masquer des champs, valider et compléter les écritures, réagir aux enregistrements et suppressions, et transformer des colonnes individuelles."
---

Les `hooks` d'une table s'exécutent sur le serveur à chaque étape de la vie d'une ligne : avant une lecture, sur chaque ligne quittant le serveur, avant et après une écriture, et avant et après une suppression. Ils s'exécutent pour chaque point d'entrée de la table — REST, le SDK, le temps réel, MCP et le code serveur via `rebase.data` — et leur code ne quitte jamais le serveur, de sorte qu'une clé d'API ou une lecture de `process.env` dans un hook est sécurisée.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique().serverDefault(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: ({ values, previousValues }) => {
            // Derive the slug from the title when none is given.
            const title = values.title ?? previousValues?.title;
            if (title && !values.slug && !previousValues?.slug) {
                values.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            return values;
        },
        beforeDelete: ({ values }) => {
            if (values.status === "published") {
                throw new Error("Unpublish the article before deleting it.");
            }
        },
    },
});
```

Les props sont typées d'après les colonnes de la table : `values.title` ci-dessus est une `string`, et `values.status` est `"draft" | "published"`.

`.serverDefault()` sur `slug` indique ce que fait le hook, puisque son code ne peut pas être lu : une création peut omettre la colonne, le type d'insertion du SDK la rend facultative, et le formulaire du panneau permet de créer un enregistrement sans elle.

:::note[Vous venez des collections ?]
Les hooks de table sont les `callbacks` serveur d'une collection, avec le même cycle de vie. Chaque hook reçoit le descripteur de la table sous le nom `table`, et `afterRead` ainsi que les hooks de suppression reçoivent la ligne sous le nom `values`. Le guide de mise à niveau pour cette version répertorie les renommages.
:::

## Les sept hooks

| Hook | S'exécute | Retourne |
|---|---|---|
| `beforeQuery` | avant la compilation de chaque lecture | un filtre à combiner avec un AND dans la lecture, ou rien |
| `afterRead` | sur chaque ligne quittant le serveur | la ligne à renvoyer |
| `beforeSave` | avant une création ou une mise à jour, au sein de sa transaction | les valeurs à écrire ; lever une exception pour refuser |
| `afterSave` | après l'écriture, avant le commit | rien ; lever une exception pour annuler l'écriture (rollback) |
| `afterSaveError` | après l'échec et le rollback d'une écriture | rien |
| `beforeDelete` | avant une suppression, au sein de sa transaction | `false` ou lever une exception pour refuser |
| `afterDelete` | après la suppression, avant le commit | rien ; lever une exception pour annuler la suppression (rollback) |

Chaque hook peut être `async`. Chaque hook reçoit :

| Prop | Description |
|---|---|
| `table` | La table telle que le serveur la connaît : son descripteur, avec ses colonnes, ses relations et sa posture `rls`. |
| `path` | Le chemin ciblé par la requête : le slug, ou un chemin imbriqué. |
| `context` | L'appelant (`context.user`), et `context.data` restreint à celui-ci. Voir [L'API `context.data`](/docs/collections/context-data-api/). |

Un auteur d'écritures ne les exécute pas : **le système d'authentification**. L'inscription, la connexion OAuth et la gestion des utilisateurs par un administrateur écrivent directement dans la table des utilisateurs. Voir [La table des utilisateurs](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Une table écrite directement par le CMS dans le navigateur, sans serveur Rebase dans le chemin de la requête, n'atteint jamais ces hooks. Le CMS possède ses propres hooks côté navigateur pour ce cas, décrits dans les personnalisations du CMS.

## `beforeQuery`

S'exécute **avant la compilation d'une lecture**, afin de restreindre les lignes demandées. Retournez des conditions à ajouter avec un opérateur AND dans la requête ; ne retournez rien pour n'en ajouter aucune.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text().notNull(),
        subject:  col.text().notNull(),
    },
    rls: [{ operation: "all", access: "authenticated" }],
    hooks: {
        beforeQuery: ({ operation, context }) => {
            // operation: "list" | "get" | "count" | "aggregate" | "relation"
            if (context.user?.roles?.includes("admin")) return;
            return { filter: { tenantId: ["==", String(context.user?.uid ?? "")] } };
        },
    },
});
```

- **Il ne peut que restreindre.** `filter` prend les mêmes filtres de champs qu'une requête ; `logical` prend un groupe `or`/`and` pour une portée comme « les miens, ou partagés avec moi », toujours combiné dans l'ensemble par un AND.
- **Il s'exécute sur chaque chemin de lecture** : le listing, un get unique, le count, l'agrégation, la recherche, la lecture vectorielle, un listing de chemin imbriqué, le réacheminement en temps réel derrière un `.listen()`, et les lignes chargées pour une relation ou un `?include=`, où c'est le hook de la table **cible** qui s'applique.
- **Un filtre qu'il ne peut pas compiler refuse la requête.** Nommer une colonne que la table ne possède pas entraîne une erreur 400, jamais une condition ignorée.
- **Une écriture sur une ligne qu'il exclut donne une erreur 404.** Une mise à jour ou une suppression visant une ligne hors du périmètre est refusée avant l'écriture. Refuser une écriture en fonction de son contenu relève de `beforeSave`.

La vérification d'unicité derrière `.unique()` n'est pas restreinte : si elle l'était, elle répondrait « unique » pour une valeur qu'une ligne masquée possède déjà.

La sécurité au niveau des lignes (Row-level security ou RLS) est le modèle d'autorisation ; `beforeQuery` est de la logique applicative par-dessus. Utilisez [`rls`](/docs/collections/security-rules/) pour tout ce qui doit également s'appliquer au code SQL exécuté en tant qu'appelant.

## `beforeSave`

S'exécute avant l'écriture d'une ligne et retourne les valeurs à écrire. `values` contient toutes les valeurs lors d'une création et les valeurs modifiées lors d'une mise à jour ; `previousValues` représente la ligne telle qu'elle était lors d'une mise à jour ; `status` vaut `"new"`, `"existing"` ou `"copy"` ; `id` est absent lors d'une création dont la clé est générée par la base de données.

Il s'exécute au sein de la transaction d'écriture et conserve donc une connexion du pool aussi longtemps qu'il s'exécute. Voir [Un hook conserve une connexion](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Levez une exception pour **refuser l'écriture**. Rien n'atteint la base de données et l'appelant reçoit une erreur **400** avec votre message et le code `CALLBACK_REJECTED` :

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Pour choisir le statut et le code — un 409 en cas de conflit, un 422 pour un élément bien formé mais inacceptable — levez une exception `RebaseApiError` :

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { RebaseApiError } from "@rebasepro/types";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        slug:  col.text().notNull(),
        price: col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: async ({ values, context }) => {
            if (values.slug) {
                const taken = await context.data.products.count({ where: { slug: ["==", values.slug] } });
                if (taken > 0) throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
            }
            return values;
        },
    },
});
```

Importez `RebaseApiError` depuis `@rebasepro/types` : les fichiers de schéma ne chargent pas de code serveur, et il s'agit de la même classe que celle levée par le SDK typé.

## `afterSave` et `afterSaveError`

`afterSave` s'exécute après l'écriture de la ligne et avant le commit, dans la même transaction. Ses `values` correspondent à la ligne telle qu'elle est stockée. Une exception annule l'enregistrement (rollback), ainsi que tout ce que le hook a écrit via `context.data` :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, status, values, context }) => {
            // Commits with the order, or not at all.
            await context.data.audit_log.create({ table: "orders", rowId: String(id), action: status, state: values.status });
        },
    },
});
```

Les opérations qui sortent de la base de données — un e-mail, un webhook — n'ont pas leur place dans le corps du hook : cela maintient la transaction ouverte pendant un aller-retour réseau, et rien ne l'annule si l'écriture fait l'objet d'un rollback. Enfilez plutôt un [job](/docs/backend/jobs/) ; un job mis en file d'attente depuis un hook est commité avec l'écriture.

`afterSaveError` s'exécute lorsqu'un enregistrement échoue au niveau de la base de données ou après celle-ci, une fois que la transaction de l'écriture en échec a été annulée. Il ne s'exécute pas pour un refus dans `beforeSave` ou pour une requête refusée avant l'écriture. Son `context.data` est une nouvelle instance pour le même appelant, de sorte qu'un job qu'il met en file d'attente survit à l'échec qu'il signale. Une exception levée par celui-ci est journalisée, et l'appelant reçoit toujours l'erreur d'origine de l'enregistrement.

## `afterRead`

S'exécute sur chaque ligne quittant le serveur — la réponse d'une lecture, la réponse d'une écriture, une trame temps réel, un résultat MCP — et retourne la ligne à servir. `values` représente la ligne telle qu'elle est stockée, après que le contrôle d'[accès aux champs](/docs/collections/field-access/) a supprimé ce que l'appelant n'a pas le droit de lire.

Il formate ce qu'un appelant reçoit et rien d'autre : `afterSave`, les hooks de suppression et l'[historique](/docs/backend/history/) reçoivent la ligne telle qu'elle est stockée, de sorte qu'une valeur masquée ici n'est jamais ce qu'un audit enregistre ou ce qu'une restauration réécrit. L'historique *sert* également ses entrées via `afterRead`, de sorte qu'un instantané (snapshot) présente la valeur masquée de la même manière que la ligne.

Les lignes imbriquées dans la réponse d'une autre table — un `include`, les valeurs d'une référence de relation, les lignes transportées par une trame temps réel pour une relation — sont masquées sur un niveau de profondeur avec le `afterRead` de la table **cible**. L'ordre d'exécution est global, puis table, puis colonne via `.transform({ afterRead })`. Un service temps réel sans pilote pour exécuter les hooks refusera les trames pour une table qui en possède, plutôt que de les envoyer non masquées.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        email: col.text().notNull(),
        phone: col.text(),
    },
    rls: [{ operation: "select", roles: ["support", "sales"] }],
    hooks: {
        // Mask contact details for everyone but support.
        afterRead: ({ values, context }) => {
            if (context.user?.roles?.includes("support")) return values;
            return {
                ...values,
                email: values.email.replace(/^(.).*(@.*)$/, "$1***$2"),
                phone: values.phone === null ? null : "•••",
            };
        },
    },
});
```

Une agrégation retourne des sommes et des décomptes, et non des lignes ; elle ne peut donc pas passer par `afterRead`. Sur une table qui en comporte un, seul `count()` sans `groupBy` est servi ; toute autre [agrégation](/docs/sdk/aggregates-and-search/#aggregates) est refusée avec l'erreur `400 AGGREGATE_MASKED_BY_AFTER_READ`.

Il vaut mieux retenir une valeur qu'un appelant ne doit jamais recevoir plutôt que de la masquer : [`.access()` ou `.private()`](/docs/collections/field-access/) suppriment la colonne avant l'exécution de tout hook, et l'excluent également des filtres.

## `beforeDelete` et `afterDelete`

Tous deux reçoivent la ligne en cours de suppression sous forme de `values`, ainsi que son `id`.

`beforeDelete` s'exécute au sein de la transaction de suppression. Levez une exception pour refuser la suppression, et l'appelant recevra `400 CALLBACK_REJECTED` avec votre message. Retourner `false` la refuse également, avec l'erreur `403 CALLBACK_REJECTED` sans message personnalisé.

`afterDelete` s'exécute après la suppression de la ligne et avant le commit. Lever une exception annule la suppression (rollback). Sur une table avec [suppression réversible (soft delete)](/docs/collections/soft-delete/), une suppression est un horodatage (stamp), et les deux hooks s'exécutent toujours.

## Hooks de champ : `.transform()`

La méthode `.transform()` d'une colonne accepte deux hooks au niveau du champ : `beforeSave` retourne la valeur à stocker, et `afterRead` retourne la valeur à servir. Ils s'exécutent sur le serveur, pour chaque appelant, et reçoivent `value`, la ligne entière sous forme de `values`, ainsi que les props reçues par chaque hook.

`value` est typé fidèlement : `T | null` sur une colonne nullable, et `T` lorsque `.notNull()` est écrit **avant** `.transform()`. Sur un champ JSON, il s'agit de `T | undefined` à moins que `.required()` ne soit placé en premier.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contacts = defineTable("contacts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().transform({
            beforeSave: ({ value }) => value.trim().toLowerCase(),
        }),
        iban: col.text().transform({
            afterRead: ({ value, context }) =>
                value && !context.user?.roles?.includes("finance") ? `•••• ${value.slice(-4)}` : value,
        }),
    },
    rls: "admin-only",
});
```

`.transform()` est également disponible sur les éléments de tableau et sur chaque champ d'un [document JSON](/docs/schema/json/). Pour la suppression des espaces superflus et la casse, les [règles de validation](/docs/schema/columns/#validation) `trim`, `lowercase` et `uppercase` ne nécessitent aucun code.

## Écriture dans d'autres tables

`context.data` lit et écrit dans n'importe quelle table via son slug, en tant qu'appelant et au sein de la même transaction que l'écriture ayant déclenché le hook :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const submissions = defineTable("job_submissions", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        title:         col.text().notNull(),
        status:        col.enum(["pending", "approved", "rejected"]).notNull().default("pending"),
        promotedJobId: col.uuid(),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, values, previousValues, context }) => {
            // When a submission is approved, publish it as a job and link it back.
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const job = await context.data.jobs.create({ title: values.title, status: "published" });
                await context.data.job_submissions.update(id, { promotedJobId: job.id });
            }
        },
    },
});
```

La mise à jour ci-dessus enregistre à nouveau `job_submissions`, ce qui réexécute ce hook ; c'est la vérification du statut qui l'interrompt. [L'API `context.data`](/docs/collections/context-data-api/) détaille les privilèges avec lesquels il s'exécute, ainsi que les limites de transaction et d'imbrication.

## Hooks pour toutes les tables

Les hooks qui s'appliquent à toutes les tables — masquage des données personnelles (PII) sur l'ensemble du schéma, journal d'audit global — sont exportés sous le nom `hooks` depuis `backend/hooks.ts`, sous la même forme `TableHooks`. Ils s'exécutent avant les hooks propres à chaque table, qui s'exécutent eux-mêmes avant le `.transform()` de ses colonnes. Voir [Hooks globaux](/docs/backend/hooks/).

Des hooks peuvent également être attachés après le démarrage avec `setTableHooks(slug, hooks)` sur le backend. Cela **remplace** les hooks déclarés par la table ; pour les compléter, passez `composeTableHooks(declared, yours)`.

## Combiner des ensembles de hooks

Une table possède un seul objet `hooks`. Lorsque plusieurs problématiques nécessitent chacune un hook — un générateur de slugs, une piste d'audit, une portée par tenant — écrivez chacune dans son propre ensemble et combinez-les avec `composeTableHooks` de `@rebasepro/common` :

```ts
import { defineTable, col, type TableHooks } from "@rebasepro/server/schema";
import { composeTableHooks } from "@rebasepro/common";

const auditTrail: TableHooks = {
    afterSave: async ({ table, id, status, context }) => {
        await context.data.audit_log.create({ table: table.slug, rowId: String(id), action: status });
    },
};

export const pages = defineTable("pages", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug:  col.text(),
    },
    rls: "admin-only",
    hooks: composeTableHooks(auditTrail, {
        beforeSave: ({ values }) =>
            typeof values.title === "string" && !values.slug
                ? { ...values, slug: values.title.toLowerCase().replace(/\s+/g, "-") }
                : values,
    }),
});
```

Les ensembles s'exécutent dans l'ordre fourni, et chaque hook se combine de la même façon que le backend combine ses niveaux globaux et au niveau de la table :

| Hook | Combinaison |
|---|---|
| `beforeSave` | Enchaîné : chaque ensemble voit les valeurs retournées par le précédent, fusionnées superficiellement (shallow merge) avec ce qui lui a été fourni |
| `afterRead` | Enchaîné : chaque ensemble reçoit la ligne retournée par le précédent |
| `beforeQuery` | Combiné par AND : chaque ensemble voit la requête de l'appelant, et une ligne doit satisfaire chaque restriction |
| `beforeDelete` | Tout `false` oppose un veto à la suppression ; chaque ensemble s'exécute tout de même |
| `afterSave`, `afterDelete` | Exécutés dans l'ordre, chacun attendu (awaited) ; une exception interrompt les suivants |
| `afterSaveError` | Exécutés dans l'ordre ; une exception n'arrête pas l'ensemble suivant, et la première erreur est re-levée à la fin |

Un hook n'est présent dans le résultat que si l'un des ensembles le définit, et un ensemble `undefined` est ignoré. Un ensemble écrit indépendamment de sa table, comme `auditTrail` ci-dessus, est typé avec la ligne générique ; lisez donc ses valeurs en tant que `unknown` et vérifiez-les.

## Tester un hook

Un hook est une simple fonction acceptant un objet de props, un test unitaire peut donc l'appeler : `posts.config.hooks?.beforeSave?.(props)`. `createCallContext` de `@rebasepro/server` construit la prop `context` uniquement avec les champs transmis par le test ; tout autre champ lève une exception lors de sa première utilisation en indiquant son nom. `table` est le descripteur que `compileTables` de `@rebasepro/common` renvoie pour la table. Pour exécuter des hooks sur une vraie base de données, voir [Scripts et console](/docs/backend/scripts/).

## Prochaines étapes

- [L'API `context.data`](/docs/collections/context-data-api/) : privilèges, transactions et la connexion maintenue par un hook
- [Hooks globaux](/docs/backend/hooks/) : des hooks pour toutes les tables
- [Historique des entités](/docs/backend/history/) : une piste d'audit sans écrire de hooks
