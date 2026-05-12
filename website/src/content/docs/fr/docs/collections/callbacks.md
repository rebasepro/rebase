---
title: Rappels d'entité
sidebar_label: Rappels
slug: docs/collections/callbacks
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

## Définir les Rappels

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    callbacks: {
        beforeSave: async ({ values, entityId, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.created_at = new Date();
            }
            values.updated_at = new Date();

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
    },
    properties: { /* ... */ }
};
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
    return { ...values, updated_at: new Date() };
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

Appelé après un enregistrement réussi. À utiliser pour les effets secondaires.

```typescript
afterSave: async ({
    values,         // Saved values
    entityId,       // Entity ID
    previousValues, // Previous values (null for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Send webhook
    await fetch("https://api.slack.com/webhook", {
        method: "POST",
        body: JSON.stringify({ text: `New article: ${values.title}` })
    });
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

Appelé après une suppression réussie.

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

## The `context.data` API

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
        orderBy: "created_at:desc"
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

### Sécurité : Comportement de contournement du RLS

:::important
**Les opérations `context.data` dans les rappels contournent la sécurité au niveau des lignes (RLS).**

Lorsque les rappels s'exécutent sur le backend, ils passent par le `PostgresBackendDriver` de base — et non par le wrapper authentifié. Cela signifie que `context.data` a **un accès complet à la base de données** quelles que soient les permissions de l'utilisateur déclencheur.

C'est intentionnel : les hooks de cycle de vie côté serveur sont du code de confiance qui doit souvent écrire dans des collections auxquelles l'utilisateur final n'a pas un accès direct (par exemple, créer une entrée de journal d'audit, mettre à jour un compteur sur un enregistrement parent).
:::

Si vous avez besoin d'opérations soumises au RLS au sein d'un rappel, utilisez directement le pilote authentifié :

```typescript
afterSave: async ({ context }) => {
    // This bypasses RLS (normal for callbacks):
    await context.data.audit_logs.create({ action: "approved" });

    // To enforce RLS, access the driver and call withAuth():
    const authDriver = await context.driver.withAuth(context.user);
    // authDriver.data operations respect RLS
}
```

### Sémantique des Transactions

:::warning
**Les opérations `context.data` ne sont PAS automatiquement enveloppées dans la même transaction que l'enregistrement déclencheur.**

L'enregistrement original de l'entité termine sa transaction de base de données en premier. Ensuite, `afterSave` s'exécute et tout appel `context.data` ouvre des **transactions distinctes**. Si une opération `context.data` échoue dans `afterSave`, l'enregistrement original n'est **pas annulé**.
:::

Cela signifie :

- ✅ L'enregistrement déclencheur réussit toujours indépendamment
- ⚠️ Les écritures d'effets secondaires peuvent échouer sans affecter l'opération originale
- ⚠️ Il n'y a aucune garantie d'atomicité entre l'enregistrement original et les appels `context.data` ultérieurs

Pour les opérations qui doivent être atomiques, enveloppez-les dans une gestion des erreurs :

```typescript
afterSave: async ({ values, entityId, context }) => {
    try {
        await context.data.jobs.create({
            title: values.title,
            status: "published",
        });
    } catch (error) {
        // Log the failure — the original save already succeeded
        console.error(`Failed to promote job from submission ${entityId}:`, error);
        // Optionally: mark the submission as "promotion_failed"
        await context.data["job-submissions"].update(entityId, {
            promotion_status: "failed",
            promotion_error: String(error),
        });
    }
}
```

## Synchroniser les Données Entre les Collections

L'une des utilisations les plus puissantes des rappels est la **synchronisation des données entre les collections** à l'aide de `context.data` :

```typescript
const submissionsCollection: EntityCollection = {
    slug: "job_submissions",
    callbacks: {
        afterSave: async ({ values, entityId, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.jobs.create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: entityId,
                });

                // Update the submission with the promoted job reference
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    },
    properties: { /* ... */ }
};
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
    /** Le pilote de données sous-jacent (PostgresBackendDriver) */
    driver: DataDriver;
    /** Accès unifié aux données — context.data.<slug>.create/update/find/delete */
    data: RebaseData;
}
```

## Prochaines étapes

- **[Règles de Sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes
- **[Historique des Entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions Personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
