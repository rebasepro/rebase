---
sourceHash: 13eea3897cdb7bee
title: Rappels d'entité
sidebar_label: Rappels
description: Utilisez les rappels de cycle de vie pour exécuter une logique personnalisée lors de la création, la mise à jour, la lecture ou la suppression d'entités. Inclut l'API context.data pour les opérations inter-collections.
---

## Vue d'ensemble

Les rappels vous permettent d'intervenir dans le cycle de vie de l'entité pour :

- **Synchroniser les données entre les collections** — copier ou déplacer des entités entre les tables lors de changements de statut
- **Transformer les données** avant de les enregistrer (champs calculés, slugification)
- **Valider** les règles métier au-delà de la validation de schéma
- **Déclencher des effets secondaires** après les écritures (envoyer des e-mails, synchroniser des APIs, mettre à jour des caches)
- **Filtrer/transformer** les données après lecture
- **Opérations en cascade** — nettoyer les enregistrements liés lors de la suppression

## Où les rappels s'exécutent

Une collection a deux blocs de rappels, et la seule différence est quel runtime les exécute.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| S'exécute sur | le serveur | le panneau d'administration, dans le navigateur |
| Se déclenche pour | REST, le SDK, le temps réel, `dataAsAdmin` | les lectures et écritures faites par le panneau |
| Atteint le navigateur | non — les corps sont retirés du bundle | oui, en entier |
| À utiliser pour | tout ce qui suit | les collections auxquelles le panneau parle directement |

**`callbacks` est celui que vous voulez.** Il s'exécute sur chaque chemin qui
atteint le serveur, donc rien ne le contourne, et son corps ne quitte jamais la
machine : une clé d'API ou une lecture de `process.env` y est en sécurité. Le
reste de cette page porte sur `callbacks`.

`admin.browserCallbacks` existe pour un seul cas : une collection sur un
transport `direct` ou `custom`, que le panneau lit et écrit *lui-même*, sans
aucun serveur Rebase dans le chemin de la requête. Rien côté serveur ne voit ces
opérations, donc `callbacks` ne peut jamais s'y déclencher, et ce bloc est le
seul endroit où leur logique de cycle de vie peut vivre.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // déclaré avec transport: "direct"
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

Deux règles découlent de « livré à chaque visiteur », et aucune n'est
stylistique :

1. **Aucun secret.** Pas de clé d'API, pas de `process.env`, rien que vous
   n'aimeriez pas voir lu dans le bundle. Cela appartient à `callbacks`.
2. **Ce n'est pas une frontière de sécurité.** Un `browserCallbacks.afterRead`
   qui masque un champ le masque *après* que le navigateur détient déjà la
   ligne — sur un transport direct, le document brut vient directement du
   magasin. C'est de la présentation. Le masquage qui doit tenir va dans
   `callbacks`, ou dans les règles du magasin lui-même.

Sur une collection à transport serveur — le cas par défaut, et presque
certainement le vôtre — le serveur a déjà exécuté `callbacks` avant que la ligne
n'atteigne le panneau, donc un `browserCallbacks.afterRead` s'exécute *en plus*.
Écrivez-le idempotent, ou ne l'écrivez pas.

## Définir les Rappels

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

        afterSave: async ({ values, entityId }) => {
            // Send notification
            console.log(`Article ${entityId} saved: ${values.title}`);
        },

        beforeDelete: async ({ entityId }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ entity }) => {
            // Transform data after loading
            return entity;
        }
    }
});
```

## Référence des Rappels

### `beforeSave`

Appelé avant qu'une entité ne soit écrite dans la base de données. Retournez les valeurs modifiées.

```typescript
beforeSave: async ({
    values,       // Entity values
    entityId,     // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lancez une erreur pour **bloquer l'enregistrement** :

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

### `afterSave`

Appelé après l'écriture de la ligne et avant le commit, dans la même transaction. Une exception annule l'enregistrement — voir [Sémantique des Transactions](#sémantique-des-transactions).

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
    entityId,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

### `afterRead`

Appelé après la lecture d'entités depuis la base de données. Transformez les données pour l'affichage.

```typescript
afterRead: async ({
    entity,    // The entity to transform
    context
}) => {
    // Add computed fields
    return {
        ...entity,
        values: {
            ...entity.values,
            displayName: `${entity.values.first_name} ${entity.values.last_name}`
        }
    };
}
```

### `beforeDelete`

Appelé avant la suppression d'une entité. Lancez une erreur pour bloquer la suppression.

```typescript
beforeDelete: async ({
    entityId,
    entity,
    context
}) => {
    if (entity.values.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Appelé après la suppression de la ligne et avant le commit, dans la même transaction. Une exception annule la suppression.

```typescript
afterDelete: async ({
    entityId,
    entity,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${entityId} deleted`);
}
```

## Rappels de Propriété

Vous pouvez également définir des rappels au niveau de la propriété pour des transformations spécifiques au champ :

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

Chaque rappel reçoit un objet `context` qui inclut `context.data` — une couche d'accès aux données unifiée pour effectuer des **opérations inter-collections** à partir des hooks de cycle de vie.

### Accéder aux Collections

`context.data` utilise un Proxy JavaScript, vous pouvez donc accéder à n'importe quelle collection par son slug en tant que propriété :

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

### Méthodes Disponibles

Chaque accesseur de collection (`context.data.<slug>`) fournit ces méthodes :

| Méthode | Signature | Description |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Interroger les entités avec des filtres, tri et pagination |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Récupérer une seule entité par ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Créer une nouvelle entité |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Mettre à jour une entité existante |
| `.delete()` | `delete(id: string \| number) → void` | Supprimer une entité |
| `.count()` | `count(params?: FindParams) → number` | Compter les entités correspondantes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Abonnement en temps réel (si supporté) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Écouter une seule entité |

### Interroger avec `.find()`

La méthode `find()` prend en charge un filtrage riche :

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

### Créer des Entités

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

### Sécurité : avec quels privilèges `context.data` s'exécute

:::important
**`context.data` hérite des privilèges de ce qui a déclenché le rappel.** Ce n'est pas un niveau de confiance fixe.

- Déclenché par une **requête utilisateur** (REST, temps réel, une modification dans le panneau d'administration) → **limité à l'utilisateur**. Le rappel s'exécute dans la transaction soumise au RLS ouverte pour cette requête ; les politiques s'appliquent donc aux lectures *et* aux écritures. Un rappel ne peut pas voir une ligne que son appelant ne pouvait pas voir.
- Déclenché par **`rebase.dataAsAdmin` ou une tâche cron** (le même singleton) → **limité à l'administrateur**, et non pas non limité. Ce pilote est restreint à `{ uid: "service", roles: ["admin"] }` ; le rappel s'exécute donc toujours dans une transaction soumise au RLS : vos politiques sont évaluées, face à cette identité.
- Déclenché par le **pilote de base** (les flux d'authentification intégrés, les migrations) → **non limité**. Il s'exécute sur la connexion propriétaire et contourne le RLS.
:::

C'est surtout important dans la direction qui échoue en silence. Le RLS *filtre*, il ne lève pas d'erreur — un rappel qui lit une ligne voisine la trouvera lorsqu'une tâche d'administration enregistre, et peut ne rien trouver lorsqu'un utilisateur final enregistre, sans erreur dans les deux cas. Écrivez des rappels qui tolèrent un résultat vide, ou passez délibérément par le plan d'administration :

```typescript
afterSave: async ({ context }) => {
    // Limité à l'utilisateur quand c'est un utilisateur qui a déclenché cet
    // enregistrement : le RLS s'applique.
    await context.data.audit_logs.create({ action: "approved" });

    // Délibérément limité à l'administrateur — pour un travail que l'appelant ne
    // doit réellement pas voir, comme un journal d'audit qu'il ne peut ni lire ni
    // modifier. Attention : c'est la portée d'un administrateur, pas un
    // contournement du RLS — une collection dont la seule règle est
    // `policy.serverContext()` lui reste fermée, car cela compile en
    // `rebase.uid() IS NULL` et l'uid de cet accesseur est `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Cette page affirmait le contraire]
Les versions précédentes de cette page indiquaient que les rappels contournent toujours le RLS et disposent d'un « accès complet à la base de données quelles que soient les permissions de l'utilisateur déclencheur ». C'était faux, et faux dans la direction dangereuse — cela incitait à écrire des rappels en supposant qu'ils voyaient toujours tout.

Le comportement décrit ci-dessus est vérifié de bout en bout sur Postgres par le cas `"scopes context.data to the caller when a callback runs on a user request"` de la suite d'application du RLS de `@rebasepro/server-postgres`.
:::

### Sémantique des Transactions

:::important
**Ce qu'un callback écrit via `context.data` fait partie de l'écriture qui l'a déclenché.** Sur Postgres, `beforeSave`, l'enregistrement et `afterSave` — ou `beforeDelete`, la suppression et `afterDelete` — s'exécutent dans une seule transaction ; chaque callback est attendu avant le commit, et `context.data` écrit via cette même transaction.
:::

L'écriture déclenchante et tout ce que ses callbacks ont écrit sont donc validés ensemble ou pas du tout :

- Une exception levée dans `afterSave` ou `afterDelete` annule l'écriture déclenchante, ainsi que chaque écriture faite par les callbacks via `context.data`. L'appelant reçoit **400 `CALLBACK_REJECTED`**, avec `details.stage` nommant le hook — ou le statut propre de l'erreur quand elle en porte un : une `RebaseApiError` que vous avez levée, le 409 d'une violation d'unicité.
- Les abonnés temps réel n'apprennent l'existence de la ligne qu'après le commit : une écriture annulée n'est jamais annoncée.
- Un callback garde la transaction ouverte pendant qu'il s'exécute ; un callback lent, c'est donc un verrou maintenu et une connexion du pool immobilisée.

Laissez l'erreur remonter quand l'écriture déclenchante ne doit pas lui survivre. Capturez-la quand elle le doit : l'écriture en échec est annulée à elle seule, et le reste est validé.

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

Le travail qui doit sortir de la base de données — un e-mail, un webhook, un appel à une API tierce — n'a pas sa place dans le corps du callback. Il garderait la transaction ouverte le temps d'un aller-retour réseau, et rien ne peut le reprendre quand l'écriture est annulée. Mettez un [job](/docs/backend/jobs) en file pour cela, ou faites-le une fois l'écriture terminée : publiez sur un [canal temps réel](/docs/backend/realtime) ou utilisez `waitUntil` dans une [fonction personnalisée](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indique ce qui convient.

Sur MongoDB, rien de tout cela ne s'applique. Ce pilote exécute les mêmes callbacks sans transaction : l'écriture est déjà enregistrée quand `afterSave` s'exécute, et une exception à ce stade signale l'échec sans annuler l'écriture.

## Synchroniser les Données Entre les Collections

L'une des utilisations les plus puissantes des rappels est la **synchronisation des données entre les collections** à l'aide de `context.data` :

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
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Autres modèles inter-collections :

- **Suppression en cascade** : Utilisez `afterDelete` pour supprimer les enregistrements liés dans les collections enfants
- **Dénormalisation** : Utilisez `afterSave` pour mettre à jour les champs récapitulatifs dans une collection parente
- **Journalisation d'audit** : Utilisez `afterSave` / `afterDelete` pour écrire dans une collection de journaux d'audit
- **Compteurs** : Utilisez `afterSave` / `afterDelete` pour mettre à jour les champs de compte sur les entités liées

## Référence Complète du Contexte

Chaque rappel reçoit un objet `context` de type `RebaseCallContext` :

```typescript
interface RebaseCallContext {
    /** L'utilisateur authentifié, le cas échéant */
    user?: User;
    /** Le pilote qui exécute cette opération (côté serveur uniquement) */
    driver?: DataDriver;
    /** L'accesseur des requêtes — context.data.<slug>.create/update/find/delete */
    data: RebaseSdkData;
    /** Fonctions, stockage, e-mail et dataAsAdmin — mais pas de `data` */
    client: RebaseCallbackClient;
    /** La source de stockage par défaut */
    storageSource: StorageSource;
}
```

Interrogez les données via `context.data`. `context.client` n'a pas de `data` :
côté serveur, c'est le singleton `rebase`, dont le seul plan de données est
`dataAsAdmin`, limité à l'administrateur ; `context.client.data` est donc une
erreur de compilation.

## Prochaines étapes

- **[Règles de Sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes
- **[Historique des Entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions Personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
