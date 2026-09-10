---
sourceHash: e7b16241ef98f0de
title: Hooks Backend Globaux
sidebar_label: Hooks Globaux
description: Appliquez des callbacks de cycle de vie transversaux à chaque collection au niveau du serveur grâce à CollectionCallbacks.
---

## Vue d'ensemble

Rebase fournit deux niveaux de callbacks de cycle de vie des entités — tous deux utilisent le même type `CollectionCallbacks` issu de `@rebasepro/types` :

- **[Callbacks par collection](/docs/collections/callbacks)** : Définis sur les configurations individuelles des collections. Ils ne s'exécutent que pour cette collection.
- **Callbacks globaux** : Définis sur `initializeRebaseBackend({ callbacks })`. Ils se déclenchent sur **chaque** collection, sur chaque chemin de données (API REST, WebSocket / temps réel, `rebase.dataAsAdmin` côté serveur).

Utilisez les callbacks globaux pour :
- **Le masquage des données personnelles (PII)** — masquer les champs sensibles pour les appelants non-administrateurs sur l'ensemble des collections.
- **La journalisation d'audit unifiée** — enregistrer chaque création, mise à jour ou suppression à un seul endroit.
- **La validation transversale** — appliquer des invariants qui s'étendent sur plusieurs collections.

:::note
**Ordre d'exécution** : callbacks globaux → callbacks de collection → callbacks de propriété.
:::

---

## Configuration

:::note[Où placer ceci]
**Runtime géré** — `export const callbacks = { … }` depuis `config/index.ts`. Le runtime lit cet export au démarrage ; rien d'autre n'a besoin d'être modifié.

**Éjecté** — la clé `callbacks` sur `initializeRebaseBackend({ … })`.

La table de correspondance complète se trouve dans la [Vue d'ensemble du Backend](/docs/backend/#where-each-option-lives).
:::

Passez la clé `callbacks` à `initializeRebaseBackend` :

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            // Runs after every entity read, across all collections
            return row;
        },
        beforeSave({ values, context }) {
            // Runs before every entity save
            return values;
        }
    }
});
```

---

## Type `CollectionCallbacks`

```typescript
type CollectionCallbacks = {
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

Tous les callbacks peuvent retourner une `Promise` (asynchrone) ou une valeur simple (synchrone).

---

## Props des Callbacks

Chaque callback reçoit un unique objet de props. Champs communs :

| Champ | Type | Présent dans |
|-------|------|--------------|
| `collection` | `CollectionConfig` | Tous les callbacks |
| `path` | `string` | Tous les callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (facultatif), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (facultatif) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Tous les callbacks |

`context.user` contient l'utilisateur authentifié (`uid`, `roles`, etc.), ou est `undefined` pour les requêtes publiques.

`collection` est toujours présent. Un callback global s'exécute pour chaque collection, c'est donc
le seul niveau enregistré indépendamment de chacune d'elles — mais il n'est
jamais confronté à une collection manquante. Une requête ciblant un chemin que le
registre des collections ne peut pas résoudre est rejetée avec une erreur `404 NOT_FOUND` avant même qu'un niveau ne s'exécute,
ce qui est la même réponse que les chemins de lecture et d'écriture donnent de toute façon à un tel chemin. L'alternative
— ignorer ce niveau pour ces chemins — ferait de `afterRead` une
étape de masquage avec une exception silencieuse, ce qui n'est donc pas proposé.

---

## Pipeline d'Exécution

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Start PostgreSQL Transaction                             │
 │ 2. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │                                                             │
 │ 3. Global Callback: beforeSave     ─┐                       │
 │ 4. Collection Callback: beforeSave ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global Callback: afterSave      ─┐                       │
 │ 7. Collection Callback: afterSave  ─┘ awaited               │
 │                                                             │
 │ 8. Commit  ← a throw anywhere in 3–7 rolls the write back   │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Realtime notifications flushed — after the commit, never before]
       │
       ▼
[Client Response]
```

---

## Sémantique Bloquante vs. Asynchrone

**Chaque callback de la liste ci-dessous est attendu (`awaited`), et ils s'exécutent tous à l'intérieur de la
transaction qui gère l'écriture.** Il n'y a pas de niveau en mode « fire-and-forget » : la
ligne et tout ce que ses callbacks ont effectué sont validés ensemble (`commit`) ou pas du tout.

- **`beforeSave`, `beforeDelete`** — si le callback lève une exception, l'opération est rejetée avec un code HTTP 400 contenant votre message et le code `CALLBACK_REJECTED`, et l'écriture en base de données n'a jamais lieu. Levez une `RebaseApiError` depuis `@rebasepro/types` pour choisir vous-même le statut — voir les [Callbacks d'Entité](/docs/collections/callbacks#beforesave). Un `beforeDelete` qui *retourne* `false` correspond au même refus sans message, et répond **403** avec ce code.
- **`afterRead`** — la ligne retournée (ou la ligne transformée) est ce que l'appelant reçoit. Sa transaction est en lecture seule (`READ ONLY`) — voir [ci-dessous](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — s'exécutent *avant* le commit, avec `await`. Une exception levée ici annule les modifications (`rollback`) et répond le même code **400 `CALLBACK_REJECTED`**, avec `details.stage` nommant le hook. Ils maintiennent la transaction ouverte pendant leur exécution ; un callback lent représente donc un verrou maintenu.
- **`afterSaveError`** — s'exécute lorsque l'enregistrement a échoué, sur le chemin de sortie.

:::caution[Cette page indiquait auparavant le contraire]
Des versions antérieures mentionnaient que `afterSave` et `afterDelete` « s'exécutent après la validation de la transaction »
et « ne bloquent pas la réponse HTTP ». Ils n'ont jamais fait ni l'un ni l'autre. Le code qui
a été écrit sur la base de cette phrase — un appel de webhook dans `afterSave`, par exemple — a
maintenu une transaction de base de données ouverte pendant toute la durée d'un aller-retour HTTP,
tout en annulant l'écriture de la ligne chaque fois que le service distant était indisponible.
:::

### Effets de bord qui ne doivent pas maintenir la transaction

Tout ce qui est lent, ou tout ce qui ne peut pas être annulé si la transaction subit un rollback,
n'a pas sa place dans le corps du callback :

| Objectif | Faire ceci à la place |
|---|---|
| Appeler un tiers, envoyer un e-mail, générer un fichier | [Mettre un job en file d'attente](/docs/backend/jobs). Un job mis en file d'attente dans une transaction qui subit un rollback n'a jamais été enfilé — ce qui est le comportement souhaité. |
| Informer d'autres processus d'un événement | Publier sur un [canal temps réel](/docs/backend/realtime) après le retour de l'écriture, et non depuis l'intérieur du hook. |
| Travailler dans une [fonction personnalisée](/docs/backend/custom-functions) que l'appelant n'a pas besoin d'attendre | `waitUntil(c, promise)` de `@rebasepro/server/functions` — elle s'exécute après la réponse, et l'hôte l'attend avant de s'arrêter. |

La règle d'or : si le travail doit quand même avoir lieu lorsque l'écriture est annulée, il
ne fait pas partie de l'écriture, et ne doit donc pas être placé dans le hook.

### `afterRead` ne peut pas écrire

Une lecture délimitée par une requête ouvre sa transaction en `READ ONLY`. `afterRead` s'exécute à l'intérieur
de celle-ci, donc **aucune écriture depuis ce callback ne peut réussir** — ni une création
via `context.data`, ni une mise à jour, ni une opération enfouie dans une fonction utilitaire appelée. Postgres refuse
l'instruction avec le SQLSTATE `25006`, et l'appelant reçoit la réponse :

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Il s'agit d'une erreur 409, pas d'une 500 : c'est votre code qui est refusé, et non le serveur qui est en panne.
Le mode lecture seule est délibéré — une lecture qui écrit silencieusement est une lecture dont le
coût, les verrous et la surface RLS n'ont pas été budgétés.

Par conséquent, **l'audit de lecture n'a pas sa place dans `afterRead`**. Journalisez plutôt la lecture en dehors de la
requête — depuis un job d'arrière-plan alimenté par ce que vous émettez déjà, ou
depuis une fonction personnalisée qui effectue la lecture *et* l'écriture avec deux
appels distincts :

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
callbacks: {
    afterRead: async ({ path, row, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return row;
    }
}
```

```typescript no-verify
// ✓ The read and the audit row are two operations, and only the second writes.
import { rebase } from "@rebasepro/server";

export default defineFunction("read-article", (app) => {
    app.get("/:id", async (c) => {
        const article = await c.var.driver.fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: c.var.user?.uid });
        return c.json(article);
    });
});
```

L'audit côté écriture ne rencontre pas ce problème : `afterSave` et `afterDelete` s'exécutent dans une
transaction en lecture-écriture, et la ligne d'audit est validée avec la modification qu'elle consigne.

---

## Exemples

### Masquage des Données Personnelles (PII)

Masquez les adresses e-mail pour les appelants non-administrateurs sur chaque collection :

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            const isAdmin = context.user?.roles?.includes("admin");
            if (!isAdmin && row.email) {
                return { ...row, email: "********" };
            }
            return row;
        }
    }
});
```

### Journalisation d'Audit Globale

Enregistrez chaque suppression, sur l'ensemble des collections, dans une table `audit_log`. Comme
`afterDelete` s'exécute au sein de la transaction propre à la suppression, la ligne d'audit et la
suppression sont validées ensemble — il n'y a aucun intervalle durant lequel l'une existe sans
l'autre :

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        async afterDelete({ collection, id, row, context }) {
            if (collection.slug === "audit_log") return;   // don't audit the audit
            await context.data.audit_log.create({
                action: "delete",
                collection: collection.slug,
                entity_id: String(id),
                actor: context.user?.uid ?? "anonymous",
                snapshot: row
            });
        }
    }
});
```

Notez ce que cela apporte et ce que cela coûte : si la ligne d'audit ne peut pas être écrite, la
suppression n'a pas lieu non plus. Pour une piste d'audit, c'est généralement ce que l'on recherche.
Si ce n'est pas le cas, interceptez l'erreur dans le callback et documentez-le dans un commentaire.

### Logique Spécifique à une Collection

Les callbacks globaux se déclenchent pour toutes les collections. Pour limiter la logique à une seule collection, vérifiez `collection.slug` ou `path` :

```typescript
callbacks: {
    beforeSave({ collection, values, context }) {
        if (collection.slug === "orders") {
            if (!values.total || values.total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
}
```

Pour les callbacks qui ne s'appliquent qu'à une seule collection, privilégiez plutôt les [callbacks par collection](/docs/collections/callbacks).

---
