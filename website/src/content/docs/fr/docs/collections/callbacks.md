---
sourceHash: a45467350cfc4cad
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

**`callbacks` est celui qu'il vous faut.** Il s'exécute sur chaque chemin qui atteint le serveur, de sorte que rien ne peut le contourner, et son corps ne quitte jamais la machine — une clé d'API ou une lecture de `process.env` y est en sécurité. Le reste de cette page concerne `callbacks`.

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
            // Throw to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

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
- **Une écriture sur une ligne qu'il exclut renvoie une 404.** Une mise à jour ou une suppression visant une ligne en dehors de la portée est refusée avant l'écriture, avec la même réponse « no row … » qu'une lecture donnerait — une portée est donc une portée pour les écritures aussi, pas seulement pour les lectures. Ce qu'il ne contrôle *pas*, ce sont les valeurs en cours d'écriture : refuser une écriture en fonction de son contenu relève de `beforeSave`.

Une lecture n'est délibérément pas restreinte : la vérification d'unicité derrière `validation: { unique: true }`. Elle vérifie si une valeur existe n'importe où dans la table, et si elle était restreinte, elle répondrait « unique » pour une valeur qu'une ligne masquée détient déjà.

:::caution[Postgres uniquement, pour l'instant]
`beforeQuery` est implémenté par `@rebasepro/server-postgres`. Une collection desservie par MongoDB ou Firestore qui en déclare un **échoue au démarrage**, par son nom, plutôt que d'être servie avec le hook silencieusement inerte — ce qui, pour un filtre de lignes, signifierait que chaque ligne serait servie à tout le monde. Un `beforeQuery` [global](/docs/backend/hooks) échoue au démarrage de la même manière si une source de données n'est pas Postgres, tout comme un callback rattaché ultérieurement avec `setCollectionCallbacks`. Le masquage qui fonctionne sur tous les moteurs est [`afterRead`](#afterread).
:::

→ [Extension du serveur](/docs/backend/extending#2-collection-callbacks) pour voir comment cela se positionne parmi les autres options.

### `beforeSave`

Appelé avant qu'un enregistrement ne soit écrit dans la base de données. Retournez les valeurs modifiées.

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
Importez-le depuis `@rebasepro/types`, et non depuis `@rebasepro/server`. Un fichier de collection est partagé avec le frontend — le build Vite du panneau d'administration lit ce même répertoire — il ne peut donc importer que des packages qui s'exécutent dans un navigateur. `RebaseApiError` est la version compatible navigateur, et c'est la même classe que celle levée par le SDK client.
:::

### `afterSave`

Appelé après l'écriture de la ligne et avant le commit, au sein de la même transaction. Une exception annule l'enregistrement (rollback) — voir [Sémantique des transactions](#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values
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

### `afterRead`

Appelé après la lecture des entités depuis la base de données. Transformez les données pour l'affichage.

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

Appelé avant la suppression d'un enregistrement. Levez une erreur pour bloquer la suppression.

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

## L'API `context.data`

Chaque callback reçoit un objet `context` qui inclut `context.data` — une couche d'accès aux données unifiée pour effectuer des **opérations inter-collections** depuis les hooks de cycle de vie.

### Accéder aux collections

`context.data` utilise un Proxy JavaScript, vous pouvez donc accéder à n'importe quelle collection via son slug en tant que propriété :

```typescript
afterSave: async ({ values, entityId, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Méthodes disponibles

Chaque accesseur de collection (`context.data.<slug>`) fournit ces méthodes :

| Méthode | Signature | Description |
|---|---|---|
| `.find()` | `find(params?: FindParams) → FindResponse` | Interroger les entités avec des filtres, du tri et de la pagination |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Récupérer une entité unique par son ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Créer une nouvelle entité |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Mettre à jour une entité existante |
| `.delete()` | `delete(id: string \| number) → void` | Supprimer un enregistrement |
| `.count()` | `count(params?: FindParams) → number` | Compter les entités correspondantes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Abonnement en temps réel (si pris en charge) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Écouter une entité unique |

### Interroger avec `.find()`

La méthode `find()` prend en charge des filtres avancés :

```typescript
afterSave: async ({ values, context }) => {
    // Simple equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: "published" },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // PostgREST-style operators
    const { data: recentJobs } = await context.data.jobs.find({
        where: {
            status: "eq.published",
            salary: "gte.50000"
        }
    });

    // Tuple syntax
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Créer des entités

```typescript
afterSave: async ({ values, entityId, previousValues, context }) => {
    // Promote an approved submission to a published job
    if (values.status === "approved" && previousValues?.status !== "approved") {
        const newJob = await context.data.jobs.create({
            title: values.title,
            description: values.description,
            company_id: values.company_id,
            status: "published",
            source_submission_id: entityId,
        });

        // Link back to the original submission
        await context.data["job-submissions"].update(entityId, {
            promoted_job_id: newJob.id,
        });
    }
}
```

### Sécurité : avec quels privilèges `context.data` s'exécute-t-il

:::important
**`context.data` hérite des privilèges de ce qui a déclenché le callback.** Il ne s'agit pas d'un niveau de confiance fixe.

- Déclenché par une **requête utilisateur** (REST, temps réel, modification dans le panneau d'administration) → **portée utilisateur (user-scoped)**. Le callback s'exécute dans la transaction soumise à RLS ouverte pour cette requête, les politiques s'appliquent donc aux lectures *et* aux écritures. Un callback ne peut pas voir une ligne que son appelant ne pourrait pas voir.
- Déclenché par **`rebase.dataAsAdmin` ou une tâche cron** (le même singleton) → **portée administrateur (admin-scoped)**, et non sans portée. Ce pilote a pour portée `{ uid: "service", roles: ["admin"] }`, le callback s'exécute donc toujours sur une transaction soumise à RLS — vos politiques sont évaluées par rapport à cette identité.
- Déclenché par **le pilote de base** (flux d'authentification intégrés, migrations) → **sans portée (unscoped)**. Il s'exécute sur la connexion propriétaire et contourne RLS.
:::

Cela a le plus d'importance dans la direction où les échecs sont silencieux. RLS *filtre*, il ne lève pas d'erreur — ainsi, un callback qui lit une ligne sœur la trouvera lorsqu'une tâche d'administration enregistre, et pourra ne rien trouver lorsqu'un utilisateur final enregistre, sans qu'aucune erreur ne soit générée dans les deux cas. Écrivez des callbacks qui tolèrent un résultat vide, ou accédez délibérément au plan d'administration :

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Cette page indiquait auparavant le contraire]
Les versions précédentes de cette page indiquaient que les callbacks contournaient toujours RLS et disposaient d'un « accès complet à la base de données indépendamment des permissions de l'utilisateur déclencheur ». C'était incorrect, et incorrect dans le sens le moins sûr — cela incitait à écrire des callbacks en partant du principe qu'ils pouvaient toujours tout voir.

Le comportement ci-dessus est vérifié de bout en bout sur Postgres par le cas de test `"scopes context.data to the caller when a callback runs on a user request"` dans la suite de tests d'application de RLS de `@rebasepro/server-postgres`.
:::

### Sémantique des transactions

:::important
**Les écritures `context.data` d'un callback font partie intégrante de l'écriture qui l'a déclenché.** Sur Postgres, `beforeSave`, l'enregistrement et `afterSave` — ou `beforeDelete`, la suppression et `afterDelete` — s'exécutent au sein d'une seule et même transaction, chaque callback étant attendu (`await`) avant le commit, et `context.data` écrivant à travers cette même transaction.
:::

Ainsi, l'écriture déclencheuse et tout ce que ses callbacks ont écrit sont validés ensemble (commit) ou pas du tout :

- Une exception levée depuis `afterSave` ou `afterDelete` annule (rollback) l'écriture déclencheuse ainsi que chaque écriture `context.data` effectuée par les callbacks. L'appelant reçoit la réponse **400 `CALLBACK_REJECTED`** avec `details.stage` indiquant le nom du hook — ou avec le propre statut de l'erreur lorsqu'elle en comporte un : une `RebaseApiError` que vous avez levée, un 409 de violation d'unicité.
- Les abonnés en temps réel ne sont informés de la ligne qu'après le commit, de sorte qu'une écriture annulée n'est jamais annoncée.
- Un callback maintient la transaction ouverte pendant son exécution, donc un callback lent équivaut à un verrou maintenu et une connexion du pool monopolisée.

Laissez une défaillance lever une exception lorsque l'écriture déclencheuse ne doit pas lui survivre. Interceptez-la lorsqu'elle le doit : l'écriture qui a échoué est annulée isolément, et le reste est validé.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

Tout traitement qui doit sortir de la base de données — un e-mail, un webhook, un appel à une API tierce — n'a pas sa place dans le corps d'un callback. Cela maintiendrait la transaction ouverte le temps d'un aller-retour réseau, et rien ne pourra l'annuler si l'écriture fait l'objet d'un rollback. Mettez en file d'attente un [job](/docs/backend/jobs) pour cela, ou réalisez-le après le retour de l'écriture : publiez sur un [canal temps réel](/docs/backend/realtime), ou utilisez `waitUntil` dans une [fonction personnalisée](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) détaille l'option la plus adaptée.

Sur MongoDB, rien de tout cela ne s'applique. Ce pilote exécute les mêmes callbacks sans transaction, de sorte que l'écriture est déjà enregistrée lorsque `afterSave` s'exécute, et une exception à cet endroit signale l'échec sans l'annuler.

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

Interrogez via `context.data`. `context.client` ne possède pas de propriété `data` : côté serveur, il s'agit du singleton `rebase`, dont le seul plan de données est `dataAsAdmin` avec portée administrateur, donc `context.client.data` est une erreur de compilation.

## Étapes suivantes

- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
