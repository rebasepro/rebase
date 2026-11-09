---
sourceHash: 3885c8f3dc44eb65
title: Callbacks d'entité
sidebar_label: Callbacks
description: Utilisez les callbacks de cycle de vie pour exécuter une logique personnalisée lorsque des entités sont créées, mises à jour, lues ou supprimées. Comprend l'API context.data pour les opérations inter-collections.
---

## Vue d'ensemble

Les callbacks vous permettent de vous brancher sur le cycle de vie de l'entité pour :

- **Synchroniser des données entre collections** — copier ou déplacer des entités d'une table à l'autre lors de changements de statut
- **Transformer des données** avant l'enregistrement (champs calculés, génération de slugs)
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
| Atteint le navigateur | non — les corps de fonction sont retirés du bundle | oui, intégralement |
| À utiliser pour | tout ce qui suit | les collections avec lesquelles le panneau communique directement |

**`callbacks` est celui qu'il vous faut.** Il s'exécute sur chaque chemin de données qui atteint le serveur — REST, le SDK, le temps réel, MCP et `rebase.data` — et son corps ne quitte jamais la machine, garantissant ainsi la sécurité d'une clé d'API ou d'une lecture de `process.env`. Le reste de cette page concerne `callbacks`.

Une source d'écriture ne constitue pas un chemin de données : **le système d'authentification**. L'inscription, la connexion OAuth et la gestion des utilisateurs par l'administrateur écrivent directement les lignes de la table des utilisateurs et n'exécutent aucun de leurs callbacks ; ainsi, un e-mail de bienvenue dans `afterSave` sur `users` ne se déclenchera jamais lors d'une inscription. Raccordez-le aux [hooks d'authentification](/docs/backend/authentication/) transmis dans `auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — qui acceptent un backend éjecté ; l'initialisation (boot) émet un avertissement lorsque la collection des utilisateurs déclare des callbacks que l'inscription n'exécutera pas.

`admin.browserCallbacks` existe pour un cas spécifique : une collection utilisant un transport `direct` ou `custom`, que le panneau lit et écrit *lui-même* sans aucun serveur Rebase dans le chemin de la requête. Rien côté serveur ne voit ces opérations, donc `callbacks` ne peut jamais se déclencher pour elles, et ce bloc est le seul endroit où leur logique de cycle de vie peut résider.

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

Deux règles découlent du fait que le code « est envoyé à chaque visiteur », et aucune n'est d'ordre stylistique :

1. **Aucun secret.** Pas de clés d'API, pas de `process.env`, rien que vous ne souhaiteriez voir découvert par une personne inspectant le bundle. Ces éléments ont leur place dans `callbacks`.
2. **Ce n'est pas une frontière de sécurité.** Un `browserCallbacks.afterRead` qui masque un champ le fait *après* que le navigateur détient déjà la ligne — sur un transport direct, le document brut provient directement de la base. Il s'agit de présentation. Le masquage qui doit impérativement être appliqué doit figurer dans `callbacks`, ou dans les règles propres à la base de données.

Sur une collection avec transport serveur — la configuration par défaut, et très probablement la vôtre — le serveur a déjà exécuté `callbacks` avant que la ligne n'atteigne le panneau, de sorte qu'un `browserCallbacks.afterRead` s'exécute *en plus* de celui-ci. Rédigez-le pour qu'il soit idempotent, ou ne l'écrivez pas.

Les deux blocs reçoivent exactement la même chose : les lignes telles que le serveur les envoie, une date sous forme de chaîne ISO et une relation belongsTo sous forme de colonne de clé étrangère. Cela s'applique à chaque écriture effectuée par le panneau — la sauvegarde d'un formulaire d'enregistrement, une modification en ligne dans un tableau, `useRowWrites` et une écriture via le `context.data` du navigateur — ainsi, le corps d'un callback fonctionne indifféremment dans l'un ou l'autre bloc. Ce qu'un `browserCallbacks.beforeSave` modifie dans la ligne qu'il retourne correspond à ce que le formulaire sauvegarde. Le `context` qu'il reçoit est celui du navigateur : son `data` lit les lignes de la même manière, et une écriture par son intermédiaire exécute également les `browserCallbacks` de la collection ; ainsi, un hook qui écrit sur sa propre collection s'exécutera à nouveau.

Un `browserCallbacks.afterSave` s'exécute après que l'écriture a été enregistrée, et rien dans le navigateur ne peut l'annuler (rollback). Une erreur levée depuis ce hook est affichée sous forme d'avertissement ; la sauvegarde elle-même est signalée comme effectuée, afin que le formulaire ne propose pas de créer l'enregistrement une seconde fois.

## Définir des Callbacks

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

Sur la version 0.24, combinez les ensembles manuellement.

Une collection possède un unique objet `callbacks`. Lorsque plusieurs fonctionnalités nécessitent chacune un hook, comme l'horodatage, une piste d'audit et la gestion du multi-tenant, écrivez chacune sous forme d'un ensemble distinct et combinez-les avec `composeCallbacks` :

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

Les ensembles s'exécutent dans l'ordre indiqué, et chaque hook se combine de la même manière que le backend combine ses propres niveaux [globaux](/docs/backend/hooks), de collection et de propriété :

| Hook | Combinaison |
|---|---|
| `beforeSave` | Enchaîné : chaque ensemble reçoit les valeurs renvoyées par le précédent, fusionnées de manière superficielle (shallow-merged) avec ce qui lui a été fourni |
| `afterRead` | Enchaîné : chaque ensemble reçoit la ligne retournée par le précédent |
| `beforeQuery` | Opération ET (AND) : chaque ensemble reçoit la requête de l'appelant, et une ligne doit satisfaire à toutes les restrictions |
| `beforeDelete` | Tout `false` oppose un veto à la suppression ; chaque ensemble s'exécute néanmoins |
| `afterSave`, `afterDelete` | Exécutés dans l'ordre, chacun attendu (awaited) ; une exception interrompt les suivants |
| `afterSaveError` | Exécutés dans l'ordre ; une exception n'arrête pas l'ensemble suivant, et la première erreur est levée à nouveau à la fin |

Un hook n'est présent dans le résultat que si l'un des ensembles le contient, et un ensemble `undefined` est ignoré. `composeCallbacks` est également exporté depuis `@rebasepro/server` et `@rebasepro/common`.

Associer des callbacks après le démarrage avec `backend.setCollectionCallbacks(slug, callbacks)` **remplace** ceux déclarés par la collection. Pour ajouter les vôtres à ceux existants, passez `composeCallbacks(declared, yours)`.

## Référence des Callbacks

### `beforeQuery`

Appelé **avant la compilation d'une lecture**, pour restreindre les lignes demandées. Retournez des conditions à combiner avec l'opérateur AND dans la requête ; ne retournez rien pour n'en ajouter aucune.

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

`afterRead` accède à des lignes qui ont déjà été récupérées ; il peut donc masquer une valeur mais ne peut pas empêcher la lecture de la ligne. Ce hook intervient plus tôt, et trois éléments méritent d'être soulignés :

- **Il ne peut que restreindre.** La valeur de retour est un filtre à combiner par ET (AND), et aucune valeur retournée ne peut élargir la lecture. `filter` accepte les mêmes filtres de champs qu'une requête ; `logical` accepte un groupe `or`/`and`, pour un périmètre du type « les miens, ou partagés avec moi » — toujours combiné par ET dans son ensemble, de sorte que le `or` ne fait que choisir parmi les lignes déjà autorisées par le reste de la requête.
- **Il se déclenche sur chaque chemin de lecture.** La liste, la lecture unique, le comptage, l'agrégation, la recherche, la lecture vectorielle, une liste sur chemin imbriqué, la réactualisation temps réel sous un `.listen()`, et les lignes chargées pour une relation ou un `?include=` — dans ce dernier cas, c'est le hook de la collection **cible** qui s'applique, car il s'agit des lignes de la cible.
- **Un filtre qu'il ne peut pas compiler rejette la requête.** Spécifier une colonne que la table ne possède pas entraîne une erreur 400, jamais une condition ignorée.
- **Une écriture sur une ligne qu'il exclut renvoie une 404.** Une mise à jour ou une suppression ciblant une ligne hors du périmètre est refusée avant l'écriture, avec la même réponse « no row … » qu'une lecture — une restriction de périmètre s'applique donc aussi bien aux écritures qu'aux lectures. Une écriture d'appartenance un-à-plusieurs (`comments: [ids]` sur un article) laisse un enfant masqué par le périmètre de la cible là où il se trouve, de la même manière qu'un identifiant ne correspondant à aucune ligne. Ce qu'il ne contrôle *pas*, en revanche, ce sont les valeurs écrites : le refus d'une écriture basé sur son contenu relève de `beforeSave`.

Une lecture n'est délibérément pas restreinte : la vérification d'unicité liée à `validation: { unique: true }`. Elle cherche à déterminer si une valeur existe n'importe où dans la table, et si elle était restreinte, elle répondrait « unique » pour une valeur qu'une ligne masquée possède déjà.

:::caution[Postgres uniquement, pour l'instant]
`beforeQuery` est implémenté par `@rebasepro/server-postgres`. Une collection gérée par MongoDB ou Firestore qui déclare ce hook **échouera au démarrage**, nommément, plutôt que d'être exécutée avec un hook silencieusement inerte — ce qui, pour un filtre de lignes, signifierait que toutes les lignes seraient exposées à tout le monde. Un `beforeQuery` [global](/docs/backend/hooks) échouera au démarrage de la même manière si une source de données n'est pas Postgres, tout comme un hook rattaché ultérieurement via `setCollectionCallbacks`. Le masquage fonctionnant sur tous les moteurs est [`afterRead`](#afterread).
:::

→ [Extension du serveur](/docs/backend/extending#2-collection-callbacks) pour comprendre comment ce mécanisme se positionne par rapport aux autres options.

### `beforeSave`

Appelé avant qu'un enregistrement ne soit écrit dans la base de données. Retournez les valeurs modifiées.
Sur Postgres, il s'exécute à l'intérieur de la transaction d'écriture, qui a déjà commencé, et conserve donc une connexion du pool aussi longtemps qu'il s'exécute — voir [Un callback retient une connexion](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Levez une erreur pour **bloquer l'enregistrement**. L'écriture n'atteint jamais la base de données, et l'appelant reçoit une erreur **400** accompagnée de votre message et du code `CALLBACK_REJECTED` :

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

Pour choisir vous-même le statut et le code HTTP — une 409 pour un conflit, une 422 pour une donnée bien formée mais inacceptable — levez une exception `RebaseApiError` :

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
Importez-le depuis `@rebasepro/types`, et non depuis `@rebasepro/server`. Un fichier de collection est partagé avec le frontend — le build Vite du panneau d'administration lit ce même répertoire — il ne doit donc importer que des paquets capables de s'exécuter dans un navigateur. `RebaseApiError` est la classe compatible navigateur, et c'est la même classe que celle levée par le SDK typé.
:::

### `afterSave`

Appelé après l'écriture de la ligne et avant le commit, au sein de la même transaction. Lever une exception annule (rollback) l'enregistrement — voir [Sémantique des transactions](/docs/collections/context-data-api#transaction-semantics).

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

Il s'exécute pour une sauvegarde ayant échoué au niveau de la base de données ou ultérieurement — et non pour un refus lors de `beforeSave`, une requête refusée avant l'écriture (validation, permission manquante, 404), ou un commit refusé après que l'enregistrement a retourné sa réponse ([liste complète](/docs/backend/hooks/#when-aftersaveerror-runs)).

Lors d'une requête, il s'exécute une fois que la transaction de l'écriture échouée a été annulée, et non à l'intérieur de celle-ci. Son `context.data` est une instance neuve pour le même appelant, où chaque appel constitue une transaction distincte ; ainsi, un [job](/docs/backend/jobs), un message de file d'attente ou un webhook qu'il planifie sera validé (commit) et survivra à l'échec signalé. Une exception levée depuis `afterSaveError` est consignée dans les logs, et l'appelant reçoit toujours l'erreur d'origine de la sauvegarde.

### `afterRead`

Appelé après la lecture des entités depuis la base de données. Transforme les données pour l'affichage.

Il formate ce qu'un appelant reçoit — la réponse d'une lecture ou d'une écriture, ainsi que sa trame en temps réel — et rien d'autre : `afterSave`, `beforeDelete`, `afterDelete` et [l'historique](/docs/backend/history) reçoivent la ligne telle qu'elle est stockée : une valeur masquée ici n'est jamais enregistrée dans un audit ni réécrite lors d'un rétablissement (revert), et un champ ajouté ici n'est jamais écrit.

Une agrégation renvoie des sommes et des décomptes, et non des lignes ; elle ne peut donc pas passer par `afterRead`. Sur une collection concernée par ce hook, seul `count()` sans `groupBy` est pris en charge ; tout autre type d'[agrégation](/docs/sdk/aggregates-and-search/#aggregates) est rejeté avec `400 AGGREGATE_MASKED_BY_AFTER_READ`.

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

Appelé avant la suppression d'un enregistrement. Levez une exception pour bloquer la suppression, et l'appelant recevra `400 CALLBACK_REJECTED` accompagné de votre message. Renvoyer `false` la bloque également, sous la forme d'un code `403 CALLBACK_REJECTED` sans message personnalisé.

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

Appelé après la suppression de la ligne et avant le commit, au sein de la même transaction. Lever une exception annule la suppression (rollback).

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

Vous pouvez également définir des callbacks au niveau des propriétés pour des transformations spécifiques à un champ :

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

Chaque callback reçoit également `context.data`, une couche de données permettant de lire et d'écrire dans d'autres collections depuis l'intérieur du hook — voir [L'API `context.data`](/docs/collections/context-data-api).

## Synchroniser des données entre collections

L'une des utilisations les plus puissantes des callbacks est la **synchronisation de données entre collections** via `context.data` :

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

Autres modèles d'opérations inter-collections :

- **Suppression en cascade** : Utilisez `afterDelete` pour supprimer les enregistrements associés dans des collections enfants
- **Dénormalisation** : Utilisez `afterSave` pour mettre à jour des champs récapitulatifs dans une collection parente
- **Journalisation d'audit** : Utilisez `afterSave` / `afterDelete` pour écrire dans une collection de logs d'audit
- **Compteurs** : Utilisez `afterSave` / `afterDelete` pour incrémenter ou décrémenter des compteurs sur des entités associées

## Tester un callback

Un callback est une simple fonction acceptant un unique objet d'arguments (props), de sorte qu'un test unitaire l'appelle directement.
`createCallContext` construit la propriété `context` : les champs que vous fournissez sont utilisés tels quels, et tout champ omis est remplacé par un substitut qui lève une exception à la première utilisation, indiquant son propre nom, garantissant ainsi qu'un test ne fournit que ce que le hook manipule réellement.

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

Un hook qui lit ou écrit via `context.data` nécessite un pilote (driver) : passez `createCallContext({ data: buildSdkData(driver) })`, avec `buildSdkData` issu de `@rebasepro/common` et n'importe quel `DataDriver`, y compris un pilote en mémoire. `user` reste absent à moins que vous ne le définissiez, tout comme lors d'une écriture sans appelant, ce qui permet de tester fidèlement une branche `if (context.user)`. Pour exécuter des hooks sur une vraie base de données, consultez [Scripts et la Console](/docs/backend/scripts/).

## Référence complète du Context

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

Effectuez les requêtes via `context.data`. `context.client` ne possède pas de propriété `data` : côté serveur, il s'agit du singleton `rebase`, dont le seul plan de données est `dataAsAdmin` avec une portée administrateur ; par conséquent, `context.client.data` constitue une erreur de compilation. Pour instancier l'un de ces objets lors d'un test, consultez [Tester un callback](#tester-un-callback).

## Prochaines étapes

- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
