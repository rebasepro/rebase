---
sourceHash: 9b21d41a290148dd
title: Callbacks d'entité
sidebar_label: Callbacks
description: Utilisez les callbacks de cycle de vie pour exécuter une logique personnalisée lors de la création, mise à jour, lecture ou suppression d'entités. Inclut l'API context.data pour les opérations inter-collections.
---

## Vue d'ensemble

Les callbacks vous permettent de vous brancher sur le cycle de vie des entités pour :

- **Synchroniser des données entre collections** — copier ou déplacer des entités d'une table à l'autre lors de changements de statut
- **Transformer les données** avant l'enregistrement (champs calculés, génération de slugs)
- **Valider** des règles métier au-delà de la validation de schéma
- **Déclencher des effets secondaires** après les écritures (envoyer des e-mails, synchroniser des API, mettre à jour des caches)
- **Restreindre une lecture** avant sa compilation, afin qu'un appelant ne voie que ses propres lignes
- **Filtrer/transformer** les données après la lecture
- **Opérations en cascade** — nettoyer les enregistrements associés lors d'une suppression

## Où s'exécutent les callbacks

Une collection possède deux blocs de callbacks, et la seule différence réside dans l'environnement d'exécution qui les prend en charge.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| S'exécute sur | le serveur | le panneau d'administration, dans le navigateur |
| Se déclenche pour | REST, le SDK, le temps réel, `dataAsAdmin` | les lectures et écritures effectuées par le panneau |
| Atteint le navigateur | non — les corps de fonction sont retirés du bundle | oui, en intégralité |
| À utiliser pour | tout ce qui suit | les collections avec lesquelles le panneau communique directement |

**`callbacks` est celui qu'il vous faut.** Il s'exécute sur chaque chemin de données atteignant le serveur — REST, le SDK, le temps réel, MCP et `rebase.data` — et son corps ne quitte jamais la machine, garantissant ainsi la sécurité d'une clé d'API ou d'une lecture de `process.env`. Le reste de cette page traite de `callbacks`.

Un mécanisme d'écriture ne constitue pas un chemin de données standard : **le système d'authentification**. L'inscription, la connexion OAuth et la gestion des utilisateurs de l'admin écrivent directement les lignes de la table `users` et n'exécutent aucun de leurs callbacks ; ainsi, un e-mail de bienvenue dans `afterSave` sur `users` ne se déclenchera jamais lors d'une inscription. Associez-le aux [auth hooks](/docs/backend/authentication/) passés dans `auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — qui reçoivent un backend éjecté ; le démarrage émet un avertissement lorsque la collection d'utilisateurs déclare des callbacks que l'inscription n'exécutera pas.

`admin.browserCallbacks` existe pour un cas précis : une collection sur un transport `direct` ou `custom`, que le panneau lit et écrit *lui-même* sans aucun serveur Rebase dans le chemin de la requête. Rien côté serveur ne voit ces opérations, donc `callbacks` ne peut jamais se déclencher pour elles, et ce bloc constitue le seul endroit où leur logique de cycle de vie peut résider.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // declared with transport: "direct"
    properties: {
        city: { name: "City", type: "string" },
        code: { name: "Code", type: "string" }
    },
    admin: {
        browserCallbacks: {
            afterRead: ({ row }) => ({ ...row, label: [row.city, row.code].join(" · ") })
        }
    }
};
```

Deux règles découlent du principe selon lequel le code est « livré à chaque visiteur », et aucune n'est d'ordre stylistique :

1. **Aucun secret.** Pas de clés d'API, pas de `process.env`, rien que vous ne souhaiteriez pas qu'un lecteur du bundle puisse voir. Cela doit être placé dans `callbacks`.
2. **Ce n'est pas une frontière de sécurité.** Un `browserCallbacks.afterRead` qui masque un champ le masque *après* que le navigateur détient déjà la ligne — sur un transport direct, le document brut provient directement du store. C'est de la présentation. Un masquage devant impérativement être appliqué doit aller dans `callbacks`, ou dans les règles propres au store.

Sur une collection avec transport serveur — le comportement par défaut, et très probablement le vôtre —, le serveur a déjà exécuté `callbacks` avant que la ligne n'atteigne le panneau, donc un `browserCallbacks.afterRead` s'exécute *en plus* de celui-ci. Rendez-le idempotent, ou ne l'écrivez pas.

Un `browserCallbacks.afterSave` s'exécute après l'enregistrement de l'écriture, et rien dans le navigateur ne peut l'annuler (rollback). Une exception levée est affichée sous forme d'avertissement ; l'enregistrement lui-même est signalé comme effectué, de sorte que le formulaire ne propose pas de créer l'enregistrement une seconde fois.

## Définir des callbacks

```typescript
import { defineCollection } from "@rebasepro/cms-types";

// The row shape is inferred from `properties`, so `values.title` below is a
// `string` without anything being written twice.
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values, id, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.createdAt = new Date().toISOString();
            }
            values.updatedAt = new Date().toISOString();

            return values;
        },

        afterSave: async ({ values, id }) => {
            // Send notification
            console.log(`Article ${id} saved: ${values.title}`);
        },

        beforeDelete: async ({ id }) => {
            // Prevent deletion of published articles
            // Throw (or return false) to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Combiner des ensembles de callbacks

Sur la version 0.24, combinez
les ensembles manuellement.

Une collection possède un seul objet `callbacks`. Lorsque plusieurs fonctionnalités distinctes nécessitent chacune un hook, comme des horodatages, une piste d'audit et une portée multi-tenant, écrivez chacune dans son propre ensemble et combinez-les avec `composeCallbacks` :

```typescript
import { composeCallbacks, defineCollection } from "@rebasepro/cms-types";
import type { CollectionCallbacks } from "@rebasepro/types";

const timestamps: CollectionCallbacks = {
    beforeSave: ({ values, status }) => ({
        ...values,
        ...(status === "new" ? { createdAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString()
    })
};

const auditTrail: CollectionCallbacks = {
    afterSave: async ({ context, id, status }) => {
        await context.data.audit_log.create({ entity: "articles", entityId: String(id), action: status });
    }
};

export default defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: composeCallbacks(timestamps, auditTrail)
});
```

Les ensembles s'exécutent dans l'ordre fourni, et chaque hook se combine de la même manière que le backend combine ses propres niveaux [globaux](/docs/backend/hooks), de collection et de propriété :

| Hook | Combinaison |
|---|---|
| `beforeSave` | Chaîné : chaque ensemble voit les valeurs renvoyées par le précédent, fusionnées de manière superficielle (shallow-merge) avec ce qui lui a été fourni |
| `afterRead` | Chaîné : chaque ensemble reçoit la ligne renvoyée par le précédent |
| `beforeQuery` | Opération ET (AND) : chaque ensemble voit la requête de l'appelant, et une ligne doit satisfaire chaque restriction |
| `beforeDelete` | Tout `false` oppose un veto à la suppression ; chaque ensemble s'exécute tout de même |
| `afterSave`, `afterDelete` | Exécutés dans l'ordre, chacun attendu (awaited) ; une exception interrompt les suivants |
| `afterSaveError` | Exécutés dans l'ordre ; une exception n'arrête pas l'ensemble suivant, et la première erreur est levée à nouveau à la fin |

Un hook n'est présent dans le résultat que si un ensemble le définit, et un ensemble `undefined` est ignoré. `composeCallbacks` est également exporté depuis `@rebasepro/server` et `@rebasepro/common`.

Attacher des callbacks après le démarrage avec `backend.setCollectionCallbacks(slug, callbacks)` **remplace** ceux déclarés par la collection. Pour y ajouter les vôtres, passez `composeCallbacks(declared, yours)`.

## Référence des callbacks

### `beforeQuery`

Appelé **avant la compilation d'une lecture**, pour restreindre les lignes demandées. Renvoyez des conditions à combiner avec un ET logique (AND) dans la requête ; ne renvoyez rien pour n'en ajouter aucune.

```typescript
beforeQuery: ({
    operation,   // "list" | "get" | "count" | "aggregate" | "relation"
    query,       // the parsed read, read-only
    context
}) => {
    if (context.user?.roles?.includes("admin")) return;
    return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
}
```

`afterRead` voit des lignes qui ont déjà été récupérées ; il peut donc masquer une valeur mais ne peut pas empêcher la lecture de la ligne. Ce hook s'exécute plus tôt, et trois éléments méritent d'être connus à son sujet :

- **Il ne peut que restreindre.** La valeur de retour est un filtre combiné par un ET logique (AND), et aucune valeur renvoyée ne peut élargir la lecture. `filter` accepte les mêmes filtres de champ qu'une requête ; `logical` accepte un groupe `or`/`and`, pour une portée telle que « les miens, ou partagés avec moi » — toujours combiné globalement avec un ET, de sorte que le `or` ne fait que choisir parmi les lignes déjà autorisées par le reste de la requête.
- **Il se déclenche sur chaque chemin de lecture.** La liste, l'obtention unitaire, le décompte, l'agrégation, la recherche, la lecture vectorielle, une liste par chemin imbriqué, le réacheminement en temps réel derrière un `.listen()`, et les lignes chargées pour une relation ou un `?include=` — où c'est le hook de la collection **cible** qui s'applique, car il s'agit des lignes de la cible.
- **Un filtre qui ne peut pas être compilé refuse la requête.** Nommer une colonne inexistante dans la table produit une erreur 400, et ne supprime jamais silencieusement la condition.
- **Une écriture ciblant une ligne qu'il exclut renvoie une 404.** Une mise à jour ou une suppression visant une ligne hors de portée est refusée avant l'écriture, avec la même réponse « aucune ligne… » qu'une lecture — une portée s'applique donc aussi aux écritures, pas seulement aux lectures. Une écriture d'appartenance un-à-plusieurs (`comments: [ids]` sur un post) laisse un enfant masqué par la portée de la cible là où il se trouve, tout comme elle laisse un identifiant qui ne correspond à aucune ligne. Ce qu'il ne filtre *pas*, ce sont les valeurs écrites : le refus d'une écriture en fonction de son contenu relève de `beforeSave`.

Une lecture n'est délibérément pas restreinte : la vérification d'unicité derrière `validation: { unique: true }`. Elle vérifie si une valeur existe n'importe où dans la table ; si elle était restreinte, elle indiquerait « unique » pour une valeur déjà détenue par une ligne masquée.

:::caution[Postgres uniquement, pour l'instant]
`beforeQuery` est implémenté par `@rebasepro/server-postgres`. Une collection alimentée par MongoDB ou Firestore qui en déclare un **échoue au démarrage**, nommément, plutôt que d'être servie avec un hook silencieusement inactif — ce qui, pour un filtre de ligne, signifierait que chaque ligne serait accessible à tout le monde. Un `beforeQuery` [global](/docs/backend/hooks) échoue au démarrage de la même manière si une source de données n'est pas Postgres, tout comme un hook rattaché ultérieurement via `setCollectionCallbacks`. Le masquage qui fonctionne sur tous les moteurs est [`afterRead`](#afterread).
:::

→ Consultez [Étendre le serveur](/docs/backend/extending#2-collection-callbacks) pour voir comment cela se positionne par rapport aux autres options.

### `beforeSave`

Appelé avant l'écriture d'un enregistrement dans la base de données. Renvoyez les valeurs modifiées. Sur Postgres, il s'exécute au sein de la transaction d'écriture, qui a déjà débuté, maintenant ainsi une connexion du pool pendant toute sa durée d'exécution — voir [Un callback conserve une connexion](/docs/collections/context-data-api#a-callback-holds-a-connection).

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (undefined for a new entity, unless the caller sent one)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Levez une erreur pour **bloquer l'enregistrement**. L'écriture n'atteint jamais la base de données, et l'appelant reçoit une erreur **400** avec votre message et le code `CALLBACK_REJECTED` :

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Pour définir vous-même le code de statut et le code d'erreur — un 409 pour un conflit, un 422 pour un élément bien formé mais inacceptable —, levez une `RebaseApiError` :

```typescript
import { RebaseApiError } from "@rebasepro/types";

beforeSave: async ({ values }) => {
    if (await isTaken(values.slug)) {
        throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
    }
    return values;
}
```

:::note
Importez-le depuis `@rebasepro/types`, et non depuis `@rebasepro/server`. Un fichier de collection est partagé avec le frontend — le build Vite du panneau d'administration lit ce même répertoire — il ne peut donc importer que des paquets exécutables dans un navigateur. `RebaseApiError` est compatible avec le navigateur, et c'est la même classe que le SDK typé lève.
:::

### `afterSave`

Appelé après l'écriture de la ligne et avant le commit, dans la même transaction. Une exception annule l'enregistrement (rollback) — voir [Sémantique des transactions](/docs/collections/context-data-api#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values: the row as stored, not afterRead's view of it
    id,             // Entity ID
    previousValues, // Previous values (undefined for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Same transaction as the save: the log row commits with the article or not at all
    await context.data.audit_log.create({ action: status, article_id: id, title: values.title });
}
```

### `afterSaveError`

Appelé lorsqu'une opération d'enregistrement échoue.

```typescript
afterSaveError: async ({
    values,
    id,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

Il s'exécute pour un enregistrement qui a échoué au niveau de la base de données ou après celle-ci — et non pour un refus de `beforeSave`, une requête refusée avant l'écriture (validation, permission manquante, 404), ou un commit refusé après le retour de l'enregistrement ([liste complète](/docs/backend/hooks/#when-aftersaveerror-runs)).

Lors d'une requête, il s'exécute une fois que la transaction de l'écriture ayant échoué a été annulée (rollback), et non à l'intérieur de celle-ci. Son `context.data` est une nouvelle instance pour le même appelant, où chaque appel constitue une transaction distincte ; ainsi, un [job](/docs/backend/jobs), un message de file d'attente ou un webhook qu'il met en file est validé (commit) et survit à l'échec signalé. Une exception levée depuis `afterSaveError` est consignée dans les logs, et l'appelant reçoit toujours l'erreur d'origine de l'enregistrement.

### `afterRead`

Appelé après la lecture d'entités depuis la base de données. Permet de transformer les données pour l'affichage.

Il façonne ce qu'un appelant reçoit — la réponse d'une lecture ou d'une écriture, ainsi que sa trame temps réel — et rien d'autre : `afterSave`, `beforeDelete`, `afterDelete` et l'[historique](/docs/backend/history) reçoivent la ligne telle qu'elle est stockée : une valeur masquée ici n'est jamais ce qu'un audit consigne ou ce qu'un rétablissement réécrit, et un champ ajouté ici n'est jamais écrit.

Une agrégation renvoie des sommes et des décomptes, et non des lignes ; elle ne peut donc pas passer par `afterRead`. Sur une collection à laquelle il s'applique, seul `count()` sans `groupBy` est pris en charge ; toute autre [agrégation](/docs/sdk/aggregates-and-search/#aggregates) est refusée avec l'erreur `400 AGGREGATE_MASKED_BY_AFTER_READ`.

```typescript
afterRead: async ({
    row,    // The row to transform
    context
}) => {
    // Add computed fields
    return {
        ...row,
        displayName: `${row.first_name} ${row.last_name}`
    };
}
```

### `beforeDelete`

Appelé avant la suppression d'un enregistrement. Levez une exception pour bloquer la suppression, et l'appelant recevra `400 CALLBACK_REJECTED` avec votre message. Renvoyer `false` la bloque également, sous la forme d'un `403 CALLBACK_REJECTED` sans message personnalisé.

```typescript
beforeDelete: async ({
    id,
    row,
    context
}) => {
    if (row.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Appelé après la suppression de la ligne et avant le commit, dans la même transaction. Une exception annule la suppression (rollback).

```typescript
afterDelete: async ({
    id,
    row,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${id} deleted`);
}
```

## Callbacks de propriété

Vous pouvez également définir des callbacks au niveau des propriétés pour des transformations spécifiques aux champs :

```typescript
properties: {
    email: {
        type: "string",
        name: "Email",
        callbacks: {
            beforeSave: ({ value }) => value?.toLowerCase().trim(),
            afterRead: ({ value }) => value // Could decrypt, etc.
        }
    }
}
```

Chaque callback reçoit également `context.data`, une couche de données permettant de lire et d'écrire dans d'autres collections depuis le hook — voir [L'API `context.data`](/docs/collections/context-data-api).

## Synchroniser des données entre collections

L'une des utilisations les plus puissantes des callbacks est la **synchronisation de données entre collections** à l'aide de `context.data` :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const submissionsCollection = defineCollection({
    slug: "job_submissions",
    name: "Job Submissions",
    table: "job_submissions",
    properties: {
        title: { name: "Title", type: "string" },
        description: { name: "Description", type: "string" },
        company_id: { name: "Company", type: "string" },
        status: { name: "Status", type: "string" },
        promoted_job_id: { name: "Promoted job", type: "string" }
    },
    callbacks: {
        afterSave: async ({ values, id, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });

                // Update the submission with the promoted job reference
                await context.data.collection<Record<string, unknown>>("job_submissions").update(id, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Autres cas d'usage inter-collections :

- **Suppression en cascade** : Utilisez `afterDelete` pour supprimer les enregistrements associés dans les collections enfants
- **Dénormalisation** : Utilisez `afterSave` pour mettre à jour des champs récapitulatifs dans une collection parente
- **Journalisation d'audit** : Utilisez `afterSave` / `afterDelete` pour écrire dans une collection de logs d'audit
- **Compteurs** : Utilisez `afterSave` / `afterDelete` pour mettre à jour des compteurs sur les entités liées

## Tester un callback

Un callback est une simple fonction acceptant un objet de propriétés (props), un test unitaire peut donc l'appeler directement. `createCallContext` construit la propriété `context` : les champs transmis sont utilisés tels quels, et tout champ omis est remplacé par un substitut qui lève une exception lors de sa première utilisation en s'identifiant, garantissant qu'un test ne fournisse que ce que le hook manipule réellement.

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCallContext } from "@rebasepro/server";
import type { User } from "@rebasepro/types";
import articlesCollection from "../config/collections/articles";

const editor: User = {
    uid: "u1", displayName: null, email: null, photoURL: null,
    providerId: "password", isAnonymous: false, roles: ["editor"]
};

test("beforeSave derives the slug from the title", async () => {
    const values = await articlesCollection.callbacks!.beforeSave!({
        collection: articlesCollection,
        path: "articles",
        status: "new",
        values: { title: "Hello World" },
        context: createCallContext({ user: editor })
    });
    assert.equal(values.slug, "hello-world");
});
```

Un hook qui lit ou écrit via `context.data` a besoin d'un driver : passez `createCallContext({ data: buildSdkData(driver) })`, avec `buildSdkData` issu de `@rebasepro/common` et n'importe quel `DataDriver`, y compris en mémoire. `user` reste absent à moins que vous ne le transmettiez, comme c'est le cas pour une écriture sans appelant, ce qui permet de tester fidèlement une branche `if (context.user)`. Pour exécuter plutôt des hooks sur une vraie base de données, consultez [Scripts et console](/docs/backend/scripts/).

## Référence complète du contexte

Chaque callback reçoit un objet `context` de type `RebaseCallContext` :

```typescript
interface RebaseCallContext {
    /** The authenticated user, if any */
    user?: User;
    /** The driver running this operation (server-side only) */
    driver?: DataDriver;
    /** The query accessor — context.data.<slug>.create/update/find/delete */
    data: RebaseSdkData;
    /** Functions, storage, email and dataAsAdmin — but no `data` */
    client: RebaseCallbackClient;
    /** The default storage source */
    storageSource: StorageSource;
}
```

Interrogez les données via `context.data`. `context.client` ne possède pas de propriété `data` : côté serveur, il s'agit du singleton `rebase`, dont le seul plan de données est `dataAsAdmin` (portée administrateur), donc `context.client.data` produit une erreur de compilation. Pour en construire un pour un test, voir [Tester un callback](#tester-un-callback).

## Prochaines étapes

- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
