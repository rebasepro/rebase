---
sourceHash: e806583db3fff138
title: Callbacks d'entité
sidebar_label: Callbacks
description: Utilisez les callbacks de cycle de vie pour exécuter une logique personnalisée lors de la création, mise à jour, lecture ou suppression d'entités. Inclut l'API context.data pour les opérations inter-collections.
---

## Vue d'ensemble

Les callbacks vous permettent de vous brancher sur le cycle de vie des entités pour :

- **Synchroniser des données entre collections** — copier ou déplacer des entités entre tables lors de changements de statut
- **Transformer des données** avant l'enregistrement (champs calculés, création de slugs)
- **Valider** des règles métier au-delà de la validation de schéma
- **Déclencher des effets secondaires** après les écritures (envoyer des e-mails, synchroniser des API, mettre à jour des caches)
- **Restreindre une lecture** avant sa compilation, afin qu'un appelant ne voie jamais que ses propres lignes
- **Filtrer/transformer** les données après la lecture
- **Opérations en cascade** — nettoyer les enregistrements associés lors de la suppression

## Où s'exécutent les callbacks

Une collection comporte deux blocs de callbacks, et la seule différence réside dans l'environnement d'exécution qui les exécute.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| S'exécute sur | le serveur | le panneau d'administration, dans le navigateur |
| Se déclenche pour | REST, le SDK, le temps réel, `dataAsAdmin` | les lectures et écritures effectuées par le panneau |
| Atteint le navigateur | non — les corps sont supprimés du bundle | oui, intégralement |
| Utiliser pour | tout ce qui suit | les collections avec lesquelles le panneau communique directement |

**`callbacks` est celui qu'il vous faut.** Il s'exécute sur chaque chemin de données qui atteint le serveur — REST, le SDK, le temps réel, MCP et `rebase.data` — et son corps ne quitte jamais la machine, donc une clé d'API ou une lecture de `process.env` y est en sécurité. Le reste de cette page concerne `callbacks`.

Un point d'écriture n'est pas un chemin de données : **le système d'authentification**. L'inscription, la connexion OAuth et la gestion des utilisateurs par un administrateur écrivent directement les lignes `users` et n'exécutent aucun de leurs callbacks, si bien qu'un e-mail de bienvenue dans `afterSave` sur `users` ne se déclenche jamais à l'inscription. Accrochez-le aux [hooks d'authentification](/docs/backend/authentication/) passés dans `auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — qui prennent un backend éjecté ; le démarrage avertit lorsque la collection users déclare des callbacks que l'inscription n'exécutera pas.

`admin.browserCallbacks` existe pour un cas particulier : une collection sur un transport `direct` ou `custom`, que le panneau lit et écrit *lui-même* sans aucun serveur Rebase dans le chemin de la requête. Rien côté serveur ne voit ces opérations, donc `callbacks` ne peut jamais se déclencher pour elles, et ce bloc est le seul endroit où leur logique de cycle de vie peut résider.

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

Deux règles découlent du fait d'être « envoyé à chaque visiteur », et aucune n'est d'ordre stylistique :

1. **Pas de secrets.** Aucune clé d'API, aucun `process.env`, rien que vous ne souhaiteriez pas voir exposé à un lecteur du bundle. Cela doit aller dans `callbacks`.
2. **Ce n'est pas une frontière de sécurité.** Un `browserCallbacks.afterRead` qui masque un champ le masque *après* que le navigateur détient déjà la ligne — sur un transport direct, le document brut provient directement du store de données. Il s'agit de présentation. Un masquage qui doit être garanti va dans `callbacks`, ou dans les règles propres au store.

Sur une collection avec transport serveur — la configuration par défaut, et presque certainement la vôtre — le serveur a déjà exécuté `callbacks` avant que la ligne n'atteigne le panneau, donc un `browserCallbacks.afterRead` s'exécute *en plus* de celui-ci. Écrivez-le de manière idempotente, ou ne l'écrivez pas.

Un `browserCallbacks.afterSave` s'exécute une fois l'écriture enregistrée, et rien dans le navigateur ne peut
l'annuler. Une exception levée par lui s'affiche comme un avertissement ; l'enregistrement lui-même est
signalé comme terminé, de sorte que le formulaire ne propose pas de créer l'enregistrement une seconde fois.

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

<span class="since-badge" data-since="0.25">Depuis 0.25</span> En 0.24, combinez
les ensembles à la main.

Une collection n'a qu'un seul objet `callbacks`. Lorsque plusieurs préoccupations veulent chacune un hook,
comme les horodatages, une piste d'audit et un périmètre de tenant, écrivez chacune comme son propre ensemble
et combinez-les avec `composeCallbacks` :

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

Les ensembles s'exécutent dans l'ordre donné, et chaque hook se combine comme le backend
combine ses propres niveaux [global](/docs/backend/hooks), de collection et de propriété :

| Hook | Combiné |
|---|---|
| `beforeSave` | Enchaîné : chaque ensemble voit les valeurs renvoyées par le précédent, fusionnées en surface (shallow merge) par-dessus ce qu'il a reçu |
| `afterRead` | Enchaîné : chaque ensemble reçoit la ligne renvoyée par le précédent |
| `beforeQuery` | Combiné par AND : chaque ensemble voit la requête de l'appelant, et une ligne doit passer chaque restriction |
| `beforeDelete` | Tout `false` oppose son veto à la suppression ; chaque ensemble s'exécute tout de même |
| `afterSave`, `afterDelete` | Exécutés dans l'ordre, chacun attendu (awaited) ; une exception arrête les suivants |
| `afterSaveError` | Exécutés dans l'ordre ; une exception n'arrête pas l'ensemble suivant, et la première erreur est relancée à la fin |

Un hook n'est présent dans le résultat que si au moins un ensemble le possède, et un ensemble `undefined` est
ignoré. `composeCallbacks` est aussi exporté depuis `@rebasepro/server` et
`@rebasepro/common`.

Attacher des callbacks après le démarrage avec `backend.setCollectionCallbacks(slug,
callbacks)` **remplace** ceux que la collection a déclarés. Pour ajouter les vôtres à
ceux-ci, passez `composeCallbacks(declared, yours)`.

## Référence des callbacks

### `beforeQuery`

Appelé **avant la compilation d'une lecture**, pour restreindre les lignes demandées. Retournez des conditions à combiner avec un ET logique (AND) dans la requête ; ne retournez rien pour n'en ajouter aucune.

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

`afterRead` voit des lignes qui ont déjà été récupérées, il peut donc masquer une valeur mais ne peut pas empêcher la ligne d'être lue. Celui-ci s'exécute plus tôt, et trois points méritent d'être connus :

- **Il ne peut que restreindre.** La valeur retournée est un filtre combiné avec un AND, et aucune valeur qu'il peut retourner n'élargit la lecture. `filter` accepte les mêmes filtres de champ qu'une requête ; `logical` prend un groupe `or`/`and`, pour une portée telle que « à moi, ou partagé avec moi » — toujours combiné avec un AND dans son ensemble, de sorte que le `or` ne choisit jamais que parmi les lignes que le reste de la requête admet déjà.
- **Il se déclenche sur chaque chemin de lecture.** La liste, la récupération individuelle (get), le décompte (count), l'agrégation, la recherche, la lecture vectorielle, une liste sur chemin imbriqué, la réactualisation en temps réel derrière un `.listen()`, ainsi que les lignes chargées pour une relation ou un `?include=` — où c'est le hook de la collection **cible** qui s'applique, car ce sont les lignes de la cible.
- **Un filtre qu'il ne peut pas compiler rejette la requête.** Spécifier une colonne que la table ne possède pas entraîne une erreur 400, jamais une condition ignorée.
- **Une écriture sur une ligne qu'il exclut renvoie une 404.** Une mise à jour ou une suppression visant une ligne en dehors de la portée est refusée avant l'écriture, avec la même réponse « no row … » qu'une lecture donnerait — une portée est donc une portée pour les écritures aussi, pas seulement pour les lectures. Une écriture d'appartenance un-à-plusieurs (`comments: [ids]` sur un article) laisse en place un enfant que la portée de la cible masque, comme elle laisse en place un id qui ne désigne aucune ligne. Ce qu'il ne contrôle *pas*, ce sont les valeurs en cours d'écriture : refuser une écriture en fonction de son contenu relève de `beforeSave`.

Une lecture n'est délibérément pas restreinte : la vérification d'unicité derrière `validation: { unique: true }`. Elle vérifie si une valeur existe n'importe où dans la table, et si elle était restreinte, elle répondrait « unique » pour une valeur qu'une ligne masquée détient déjà.

:::caution[Postgres uniquement, pour l'instant]
`beforeQuery` est implémenté par `@rebasepro/server-postgres`. Une collection desservie par MongoDB ou Firestore qui en déclare un **échoue au démarrage**, par son nom, plutôt que d'être servie avec le hook silencieusement inerte — ce qui, pour un filtre de lignes, signifierait que chaque ligne serait servie à tout le monde. Un `beforeQuery` [global](/docs/backend/hooks) échoue au démarrage de la même manière si une source de données n'est pas Postgres, tout comme un callback rattaché ultérieurement avec `setCollectionCallbacks`. Le masquage qui fonctionne sur tous les moteurs est [`afterRead`](#afterread).
:::

→ [Extension du serveur](/docs/backend/extending#2-collection-callbacks) pour voir comment cela se positionne parmi les autres options.

### `beforeSave`

Appelé avant qu'un enregistrement ne soit écrit dans la base de données. Retournez les valeurs modifiées.
Sur Postgres, il s'exécute à l'intérieur de la transaction de l'écriture, déjà commencée, et retient donc une
connexion du pool tant qu'il s'exécute — voir [Un callback retient une connexion](/docs/collections/context-data-api#a-callback-holds-a-connection).

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (null for new entities)
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

Pour choisir vous-même le statut et le code — un 409 pour un conflit, un 422 pour quelque chose de bien formé mais inacceptable — levez une `RebaseApiError` :

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
Importez-le depuis `@rebasepro/types`, et non depuis `@rebasepro/server`. Un fichier de collection est partagé avec le frontend — le build Vite du panneau d'administration lit ce même répertoire — il ne peut donc importer que des packages qui s'exécutent dans un navigateur. `RebaseApiError` est la version compatible navigateur, et c'est la même classe que celle levée par le SDK typé.
:::

### `afterSave`

Appelé après l'écriture de la ligne et avant le commit, au sein de la même transaction. Une exception annule l'enregistrement (rollback) — voir [Sémantique des transactions](/docs/collections/context-data-api#transaction-semantics).

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

Il s'exécute pour un enregistrement qui a échoué au niveau de la base de données ou après celle-ci — pas pour un refus par `beforeSave`, une requête refusée avant l'écriture (validation, permission manquante, 404), ou un commit refusé après le retour de l'enregistrement ([liste complète](/docs/backend/hooks/#when-aftersaveerror-runs)).

Lors d'une requête, il s'exécute une fois la transaction de l'écriture en échec annulée (rollback), et non à l'intérieur de celle-ci. Son `context.data` est un nouveau contexte pour le même appelant, dans lequel chaque appel est une transaction à part entière ; un [job](/docs/backend/jobs), un message de file d'attente ou un webhook qu'il met en file d'attente est donc validé (commit) et survit à l'échec qu'il signale. Une exception levée par `afterSaveError` est journalisée, et l'appelant reçoit toujours l'erreur propre à l'enregistrement.

### `afterRead`

Appelé après la lecture des entités depuis la base de données. Transformez les données pour l'affichage.

Il façonne ce que reçoit l'appelant — la réponse d'une lecture ou d'une écriture, et sa trame temps réel — et rien d'autre : `afterSave`, `beforeDelete`, `afterDelete` et l'[historique](/docs/backend/history) reçoivent la ligne telle que stockée : une valeur masquée ici n'est jamais ce qu'un audit enregistre ou ce qu'un retour en arrière réécrit, et un champ ajouté ici n'est jamais écrit.

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

Appelé avant la suppression d'un enregistrement. Levez une erreur pour bloquer la suppression, et l'appelant reçoit `400 CALLBACK_REJECTED` avec votre message. Retourner `false` la bloque aussi, sous la forme `403 CALLBACK_REJECTED` sans message de votre part.

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

Appelé après la suppression de la ligne et avant le commit, au sein de la même transaction. Une exception annule la suppression (rollback).

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

Vous pouvez également définir des callbacks au niveau de la propriété pour des transformations spécifiques à un champ :

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

Chaque callback reçoit aussi `context.data`, une couche de données pour lire et écrire d'autres collections depuis le hook — voir [L'API `context.data`](/docs/collections/context-data-api).

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

Autres modèles inter-collections :

- **Suppression en cascade** : Utilisez `afterDelete` pour supprimer les enregistrements associés dans les collections enfants
- **Dénormalisation** : Utilisez `afterSave` pour mettre à jour les champs de synthèse dans une collection parente
- **Journalisation d'audit** : Utilisez `afterSave` / `afterDelete` pour écrire dans une collection de journaux d'audit
- **Compteurs** : Utilisez `afterSave` / `afterDelete` pour mettre à jour les champs de comptage sur les entités associées

## Tester un callback

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

Un callback est une simple fonction d'un seul objet de props, de sorte qu'un test unitaire l'appelle.
`createCallContext` construit la prop `context` : les champs que vous passez sont utilisés tels
quels, et tout champ omis est un substitut qui lève une exception à la première utilisation, en se nommant lui-même,
de sorte qu'un test ne fournit que ce que le hook touche réellement.

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

Un hook qui lit ou écrit via `context.data` a besoin d'un driver : passez
`createCallContext({ data: buildSdkData(driver) })`, avec `buildSdkData` issu de
`@rebasepro/common` et n'importe quel `DataDriver`, y compris un driver en mémoire. `user`
reste absent sauf si vous le passez, comme lors d'une écriture sans appelant, de sorte qu'une branche
`if (context.user)` est testée honnêtement. Pour exécuter les hooks sur une vraie
base de données, voir [Scripts et console](/docs/backend/scripts/).

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

Interrogez via `context.data`. `context.client` ne possède pas de propriété `data` : côté serveur, il s'agit du singleton `rebase`, dont le seul plan de données est `dataAsAdmin` avec portée administrateur, donc `context.client.data` est une erreur de compilation. Pour en construire un pour un test,
voir [Tester un callback](#tester-un-callback).

## Étapes suivantes

- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
