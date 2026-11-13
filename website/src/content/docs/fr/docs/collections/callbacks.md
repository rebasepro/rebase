---
sourceHash: 067f45147f37ef16
title: Hooks de table
sidebar_label: Hooks de table
description: "Exécutez du code côté serveur à chaque étape du cycle de vie d'une table avec les hooks : restreignez les lectures, masquez des champs, validez et complétez les écritures, réagissez aux enregistrements et suppressions, et transformez des colonnes individuelles."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les `hooks` d'une table s'exécutent sur le serveur à chaque étape de la vie d'une ligne : avant une lecture, sur chaque ligne quittant le serveur, avant et après une écriture, et avant et après une suppression. Ils s'exécutent pour chaque point d'entrée vers la table — REST, le SDK, le temps réel, MCP et le code serveur via `rebase.data` — et leur code ne quitte jamais le serveur, de sorte qu'une clé d'API ou une lecture de `process.env` dans un hook est totalement sécurisée.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique(),
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

Les props sont typées d'après les colonnes de la table : ci-dessus, `values.title` est une `string`, et `values.status` est `"draft" | "published"`.

:::note[Vous venez des collections ?]
Les hooks de table correspondent aux `callbacks` serveur d'une collection, avec le même cycle de vie. Chaque hook reçoit le descripteur de la table en tant que `table`, et `afterRead` ainsi que les hooks de suppression reçoivent la ligne sous la forme `values`. Le guide de mise à niveau de cette version liste les renommages.
:::

## Les sept hooks

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Hook | S'exécute | Retourne |
|---|---|---|
| `beforeQuery` | avant la compilation de chaque lecture | un filtre à combiner avec un ET logique (AND) dans la lecture, ou rien |
| `afterRead` | sur chaque ligne quittant le serveur | la ligne à renvoyer |
| `beforeSave` | avant une création ou une mise à jour, au sein de sa transaction | les valeurs à écrire ; levez une exception pour refuser |
| `afterSave` | après l'écriture, avant le commit | rien ; levez une exception pour annuler l'écriture (rollback) |
| `afterSaveError` | après l'échec et l'annulation d'une écriture | rien |
| `beforeDelete` | avant une suppression, au sein de sa transaction | `false` ou levez une exception pour refuser |
| `afterDelete` | après la suppression, avant le commit | rien ; levez une exception pour annuler la suppression (rollback) |

Chaque hook peut être `async`. Chaque hook reçoit :

| Prop | Description |
|---|---|
| `table` | La table telle que le serveur la connaît : son descripteur, avec ses colonnes, ses relations et sa configuration `rls`. |
| `path` | Le chemin visé par la requête : le slug ou un chemin imbriqué. |
| `context` | L'appelant (`context.user`), et `context.data` délimité à son périmètre. Voir [L'API `context.data`](/docs/collections/context-data-api/). |

Un auteur d'écriture ne les exécute pas : **le système d'authentification**. L'inscription, la connexion OAuth et la gestion des utilisateurs par un administrateur écrivent directement dans la table des utilisateurs. Voir [La table des utilisateurs](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Une table modifiée par le CMS directement dans le navigateur, sans serveur Rebase dans le chemin de la requête, n'atteint jamais ces hooks. Le CMS dispose de ses propres hooks côté navigateur pour ce cas, décrits dans les personnalisations du CMS.

## `beforeQuery`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

- **Il ne peut que restreindre.** `filter` accepte les mêmes filtres de champ qu'une requête ; `logical` accepte un groupe `or`/`and` pour une portée comme « les miens, ou partagés avec moi », toujours combiné dans l'ensemble par un AND.
- **Il s'exécute sur chaque chemin de lecture** : la liste, un get unique, le count, l'agrégation, la recherche, la lecture vectorielle, une liste par chemin imbriqué, la récupération en temps réel derrière un `.listen()`, et les lignes chargées pour une relation ou un `?include=`, où c'est le hook de la table **cible** qui s'applique.
- **Un filtre qu'il ne parvient pas à compiler rejette la requête.** Spécifier une colonne inexistante dans la table produit une erreur 400, et non une condition ignorée.
- **Une écriture sur une ligne qu'il exclut renvoie une 404.** Une mise à jour ou une suppression ciblant une ligne hors de portée est rejetée avant l'écriture. Le refus d'une écriture en fonction de son contenu relève de `beforeSave`.

La vérification d'unicité derrière `.unique()` n'est pas restreinte : si elle l'était, elle répondrait « unique » pour une valeur qu'une ligne masquée possède déjà.

La sécurité au niveau des lignes (Row-level security) est le modèle d'autorisation ; `beforeQuery` constitue une logique applicative par-dessus. Utilisez [`rls`](/docs/collections/security-rules/) pour tout ce qui doit également s'appliquer au SQL exécuté en tant qu'appelant.

## `beforeSave`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

S'exécute avant qu'une ligne ne soit écrite et retourne les valeurs à écrire. `values` contient toutes les valeurs lors d'une création et les valeurs modifiées lors d'une mise à jour ; `previousValues` correspond à la ligne telle qu'elle était avant la mise à jour ; `status` vaut `"new"`, `"existing"` ou `"copy"` ; `id` est absent lors d'une création dont la clé est générée par la base de données.

Il s'exécute au sein de la transaction d'écriture et conserve donc une connexion du pool pendant toute sa durée d'exécution. Voir [Un hook retient une connexion](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Levez une exception pour **refuser l'écriture**. Rien n'atteint la base de données, et l'appelant reçoit un code **400** avec votre message et le code `CALLBACK_REJECTED` :

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Pour choisir le statut et le code — un 409 pour un conflit, un 422 pour un élément bien formé mais inacceptable — levez une `RebaseApiError` :

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

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`afterSave` s'exécute après l'écriture de la ligne et avant le commit, dans la même transaction. Ses `values` représentent la ligne telle qu'elle est stockée. Une exception annule l'enregistrement (rollback), ainsi que tout ce que le hook a écrit via `context.data` :

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

Les opérations qui sortent de la base de données — un e-mail, un webhook — n'ont pas leur place dans le corps du hook : cela maintient la transaction ouverte pendant un aller-retour réseau, et rien ne peut les annuler si l'écriture fait l'objet d'un rollback. Mettez plutôt un [job](/docs/backend/jobs/) en file d'attente ; un job mis en file d'attente depuis un hook est commité avec l'écriture.

`afterSaveError` s'exécute lorsqu'un enregistrement a échoué au niveau de la base de données ou après, une fois que la transaction de l'écriture ayant échoué a été annulée. Il ne s'exécute pas en cas de refus dans `beforeSave` ou pour une requête refusée avant l'écriture. Son `context.data` est une instance nouvelle pour le même appelant, de sorte qu'un job qu'il met en file d'attente survit à l'échec qu'il signale. Une exception levée depuis celui-ci est journalisée, et l'appelant reçoit toujours l'erreur d'origine de l'enregistrement.

## `afterRead`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

S'exécute sur chaque ligne quittant le serveur — la réponse d'une lecture, la réponse d'une écriture, une trame temps réel, un résultat MCP — et retourne la ligne à servir. `values` correspond à la ligne telle qu'elle est stockée, après que [l'accès aux champs](/docs/collections/field-access/) a retiré ce que l'appelant n'est pas autorisé à lire.

Il formate ce qu'un appelant reçoit et rien d'autre : `afterSave`, les hooks de suppression et [l'historique](/docs/backend/history/) reçoivent la ligne telle qu'elle est stockée, de sorte qu'une valeur masquée ici n'est jamais ce qu'un audit consigne ou ce qu'un rétablissement réécrit. L'historique *sert* également ses entrées via `afterRead`, ainsi un snapshot affiche la valeur masquée de la même manière que la ligne.

Les lignes imbriquées dans la réponse d'une autre table — un `include`, les valeurs d'une référence de relation, les lignes transportées par une trame temps réel pour une relation — sont masquées sur un niveau de profondeur avec le hook `afterRead` de la table **cible**. L'ordre d'exécution est global, puis table, puis colonne `.transform({ afterRead })`. Un service temps réel sans pilote pour exécuter les hooks refusera les trames destinées à une table qui en possède, plutôt que de les envoyer non masquées.

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

Une agrégation retourne des sommes et des décomptes, et non des lignes ; elle ne peut donc pas passer par `afterRead`. Sur une table qui en possède un, seul `count()` sans `groupBy` est servi ; tout autre [agrégat](/docs/sdk/aggregates-and-search/#aggregates) est refusé avec `400 AGGREGATE_MASKED_BY_AFTER_READ`.

Une valeur qu'un appelant ne doit jamais recevoir gagne à être retenue plutôt que masquée : [`.access()` ou `.private()`](/docs/collections/field-access/) suppriment la colonne avant l'exécution de tout hook et l'excluent également des filtres.

## `beforeDelete` et `afterDelete`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Tous deux reçoivent la ligne en cours de suppression sous forme de `values`, ainsi que son `id`.

`beforeDelete` s'exécute au sein de la transaction de suppression. Levez une exception pour refuser la suppression, et l'appelant recevra `400 CALLBACK_REJECTED` avec votre message. Retourner `false` la refuse également, sous la forme d'un `403 CALLBACK_REJECTED` sans message personnalisé.

`afterDelete` s'exécute après la suppression de la ligne et avant le commit. Une exception annule la suppression (rollback). Sur une table avec [suppression réversible (soft delete)](/docs/collections/soft-delete/), une suppression est un horodatage (stamp), et les deux hooks s'exécutent tout de même.

## Hooks de champ : `.transform()`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La méthode `.transform()` d'une colonne prend deux hooks au niveau du champ : `beforeSave` retourne la valeur à stocker, et `afterRead` retourne la valeur à servir. Ils s'exécutent sur le serveur, pour chaque appelant, et reçoivent `value`, la ligne entière sous forme de `values`, ainsi que les props reçues par chaque hook.

`value` est typée fidèlement : `T | null` sur une colonne nullable, et `T` lorsque `.notNull()` est écrit **avant** `.transform()`. Sur un champ JSON, elle est de type `T | undefined`, à moins que `.required()` ne vienne en premier.

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

`.transform()` est également disponible sur les éléments de tableau et sur chaque champ d'un [document JSON](/docs/schema/json/). Pour la suppression des espaces et la casse, les [règles de validation](/docs/schema/columns/#validation) `trim`, `lowercase` et `uppercase` ne nécessitent aucun code.

## Écrire dans d'autres tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`context.data` lit et écrit dans n'importe quelle table via son slug, en tant qu'appelant et dans la même transaction que l'écriture qui a déclenché le hook :

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

La mise à jour ci-dessus enregistre à nouveau `job_submissions`, ce qui réexécute ce hook ; la vérification du statut permet d'éviter une boucle infinie. [L'API `context.data`](/docs/collections/context-data-api/) détaille les privilèges avec lesquels elle s'exécute, ainsi que les limites de transaction et d'imbrication.

## Hooks pour toutes les tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les hooks s'appliquant à toutes les tables — masquage des données personnelles (PII) à l'échelle du schéma, journal d'audit global — sont exportés sous le nom `hooks` depuis `backend/hooks.ts`, avec la même structure `TableHooks`. Ils s'exécutent avant les hooks propres à chaque table, qui s'exécutent eux-mêmes avant le `.transform()` de leurs colonnes. Voir [Hooks globaux](/docs/backend/hooks/).

Les hooks peuvent également être rattachés après le démarrage avec `setTableHooks(slug, hooks)` sur le backend. Cela **remplace** les hooks déclarés par la table ; pour les combiner, passez `composeTableHooks(declared, yours)`.

## Combiner des ensembles de hooks

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une table possède un seul objet `hooks`. Lorsque plusieurs fonctionnalités ont chacune besoin d'un hook — un générateur de slug, une piste d'audit, une portée par tenant — écrivez chacune dans son propre ensemble et combinez-les avec `composeTableHooks` issu de `@rebasepro/common` :

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

Les ensembles s'exécutent dans l'ordre spécifié, et chaque hook se combine de la même façon que le backend combine ses niveaux global et table :

| Hook | Combinaison |
|---|---|
| `beforeSave` | Enchaîné : chaque ensemble voit les valeurs retournées par le précédent, fusionnées superficiellement (shallow merge) par-dessus ce qui lui a été fourni |
| `afterRead` | Enchaîné : chaque ensemble reçoit la ligne retournée par le précédent |
| `beforeQuery` | Combiné avec AND : chaque ensemble voit la requête de l'appelant, et une ligne doit satisfaire chaque restriction |
| `beforeDelete` | Tout `false` oppose un veto à la suppression ; chaque ensemble s'exécute malgré tout |
| `afterSave`, `afterDelete` | Exécutés dans l'ordre, chacun attendu (`await`) ; une exception interrompt les suivants |
| `afterSaveError` | Exécutés dans l'ordre ; une exception n'interrompt pas l'ensemble suivant, et la première erreur est renvoyée à la fin |

Un hook n'est présent dans le résultat que si un ensemble le définit, et un ensemble `undefined` est ignoré. Un ensemble écrit indépendamment de sa table, comme `auditTrail` ci-dessus, est typé avec une ligne générique ; lisez donc ses valeurs en tant que `unknown` et vérifiez-les.

## Tester un hook

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un hook est une simple fonction acceptant un objet de props, de sorte qu'un test unitaire l'appelle directement : `posts.config.hooks?.beforeSave?.(props)`. La fonction `createCallContext` issue de `@rebasepro/server` construit la prop `context` uniquement avec les champs transmis par le test ; tout autre champ lève une exception dès sa première utilisation en indiquant son nom. `table` est le descripteur renvoyé par `compileTables` de `@rebasepro/common` pour la table. Pour exécuter des hooks sur une vraie base de données, voir [Scripts et la Console](/docs/backend/scripts/).

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [L'API `context.data`](/docs/collections/context-data-api/) : privilèges, transactions et la connexion retenue par un hook
- [Hooks globaux](/docs/backend/hooks/) : des hooks appliqués à toutes les tables
- [Historique des entités](/docs/backend/history/) : une piste d'audit sans écrire de hooks
