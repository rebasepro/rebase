---
sourceHash: 97a20df64eaeffc7
title: Hooks Backend Globaux
sidebar_label: Hooks Globaux
description: Appliquez des callbacks de cycle de vie transversaux à chaque collection au niveau du serveur à l'aide de CollectionCallbacks.
---

## Vue d'ensemble

Rebase propose deux niveaux de callbacks de cycle de vie des entités — tous deux utilisent le même type `CollectionCallbacks` issu de `@rebasepro/types` :

- **[Callbacks par collection](/docs/collections/callbacks)** : Définis sur les configurations de collections individuelles. Ils s'exécutent uniquement pour cette collection.
- **Callbacks globaux** : Définis sur `initializeRebaseBackend({ callbacks })`. Ils se déclenchent sur **chaque** collection, sur chaque chemin de données (API REST, WebSocket / temps réel, `rebase.dataAsAdmin` côté serveur).

Utilisez les callbacks globaux pour :
- **Le ciblage des lignes (Row scoping)** — <span class="since-badge" data-since="0.22">Depuis la version 0.22</span> `beforeQuery` sur chaque collection, afin que les lectures d'un tenant soient restreintes à un seul endroit plutôt que par collection. Postgres uniquement : à côté d'une source de données MongoDB ou Firestore, un `beforeQuery` global refusera de démarrer plutôt que de laisser les lectures de cette source sans restriction. Voir [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Le masquage des données personnelles (PII)** — masquer les champs sensibles pour les appelants non-administrateurs sur l'ensemble des collections.
- **La journalisation d'audit unifiée** — consigner chaque création, mise à jour ou suppression à un emplacement unique.
- **La validation transversale** — appliquer des invariants qui s'étendent sur plusieurs collections.

:::note
**Ordre d'exécution** : callbacks globaux → callbacks de collection → callbacks de propriété.
:::

---

## Configuration

:::note[Où placer ceci]
**Environnement managé (Managed runtime)** — `export const callbacks = { … }` depuis `config/index.ts`. L'environnement d'exécution lit cet export au démarrage ; rien d'autre n'a besoin d'être modifié.

**Éjecté (Ejected)** — la clé `callbacks` sur `initializeRebaseBackend({ … })`.

La table complète se trouve dans la [Vue d'ensemble du Backend](/docs/backend/#where-each-option-lives).
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
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

<span class="since-badge" data-since="0.22">Depuis la version 0.22</span> `beforeQuery` restreint une lecture avant qu'elle ne soit compilée ; voir
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Tous les callbacks peuvent renvoyer une `Promise` (asynchrone) ou une valeur simple (synchrone).

---

## Props des Callbacks

Chaque callback reçoit un objet props unique. Champs communs :

| Champ | Type | Présent dans |
|-------|------|------------|
| `collection` | `CollectionConfig` | Tous les callbacks |
| `path` | `string` | Tous les callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (facultatif), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (facultatif) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Tous les callbacks |

`context.user` contient l'utilisateur authentifié (`uid`, `roles`, etc.), ou vaut `undefined` pour les requêtes publiques.

`collection` est toujours présent. Un callback global se déclenche pour chaque collection, c'est
donc le seul niveau enregistré indépendamment de chacune d'elles — mais il n'est
jamais confronté à une collection manquante. Une requête mentionnant un chemin que le registre
de collections ne peut pas résoudre est rejetée avec un code `404 NOT_FOUND` avant même qu'un niveau ne s'exécute,
ce qui correspond à la même réponse que les chemins de lecture et d'écriture renvoient de toute façon.
L'alternative — ignorer le niveau pour ces chemins — ferait d'`afterRead` une étape
de masquage avec une exception silencieuse, ce qui n'est donc pas proposé.

---

## Pipeline d'exécution

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

## Sémantique bloquante vs. asynchrone

**Chaque callback de la liste ci-dessous est attendu (`await`), et tous s'exécutent au sein de la
transaction qui porte l'écriture.** Il n'existe pas de niveau « fire and forget » : la
ligne et tout ce que ses callbacks ont effectué sont validés ensemble ou pas du tout.

- **`beforeSave`, `beforeDelete`** — si le callback lève une exception, l'opération est rejetée avec une erreur HTTP 400 contenant votre message et le code `CALLBACK_REJECTED`, et l'écriture en base de données n'a jamais lieu. Lancez une `RebaseApiError` issue de `@rebasepro/types` pour choisir vous-même le statut — voir [Callbacks d'entité](/docs/collections/callbacks#beforesave). Un `beforeDelete` qui *renvoie* `false` équivaut au même refus sans message, et répond **403** avec ce code.
- **`afterRead`** — la ligne renvoyée (ou la ligne transformée) est ce que l'appelant reçoit. Sa transaction est en lecture seule (`READ ONLY`) — voir [ci-dessous](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — s'exécutent *avant* le commit, avec attente (`await`). Une exception levée ici annule la ligne (rollback) et répond avec la même erreur **400 `CALLBACK_REJECTED`**, avec `details.stage` indiquant le nom du hook. Ils maintiennent la transaction ouverte pendant leur exécution ; un hook lent correspond donc à un verrou conservé.
- **`afterSaveError`** — s'exécute lorsque l'enregistrement a échoué, sur le chemin de sortie.

:::caution[Cette page indiquait auparavant le contraire]
Des versions antérieures indiquaient qu'`afterSave` et `afterDelete` « s'exécutent après la validation de la transaction » et « ne bloquent pas la réponse HTTP ». Cela n'a jamais été le cas. Le code qui a été écrit en se basant sur cette affirmation — un appel de webhook dans `afterSave`, par exemple — a maintenu une transaction de base de données ouverte pendant toute la durée d'un aller-retour HTTP, et a annulé la ligne chaque fois que le service distant était indisponible.
:::

### Effets de bord qui ne doivent pas maintenir la transaction ouverte

Tout ce qui est lent, ou tout ce qui ne peut pas être annulé si la transaction subit un rollback,
n'a pas sa place dans le corps du callback :

| Objectif | Ce qu'il faut faire à la place |
|---|---|
| Appeler un service tiers, envoyer un email, générer un fichier | [Mettre un job en file d'attente](/docs/backend/jobs). Un job mis en file d'attente dans une transaction qui subit un rollback n'a en fait jamais été mis en file d'attente — ce qui est le comportement souhaité. |
| Informer d'autres processus qu'un événement s'est produit | Publier sur un [canal en temps réel](/docs/backend/realtime) après le retour de l'écriture, et non depuis l'intérieur du hook. |
| Effectuer un traitement dans une [fonction personnalisée](/docs/backend/custom-functions) que l'appelant n'a pas besoin d'attendre | Utiliser `waitUntil(c, promise)` de `@rebasepro/server/functions` — elle s'exécute après la réponse, et l'hôte attend sa fin avant de s'arrêter. |

La règle générale : si le traitement doit quand même avoir lieu lorsque l'écriture est annulée, il
ne fait pas partie de l'écriture, et n'a donc pas sa place dans le hook.

### `afterRead` ne peut pas écrire

Une lecture avec portée de requête (request-scoped) ouvre sa transaction en `READ ONLY`. `afterRead` s'exécute à
l'intérieur de celle-ci, de sorte que **toute écriture issue de ce callback ne peut aboutir** — ni une
création via `context.data`, ni une mise à jour, ni même une écriture enfouie dans un helper qu'il appelle. Postgres refuse
l'instruction avec le SQLSTATE `25006`, et la réponse suivante est envoyée à l'appelant :

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Il s'agit d'une erreur 409, pas 500 : c'est votre code qui est refusé, pas le serveur qui a échoué.
Le mode lecture seule est délibéré — une lecture qui écrit silencieusement est une lecture dont
le coût, les verrous et la surface RLS n'ont été prévus par personne.

Par conséquent, **l'audit de lecture n'a pas sa place dans `afterRead`**. Consignez la lecture en dehors de la
requête à la place — à partir d'un job en arrière-plan alimenté par ce que vous émettez déjà, ou
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

L'audit côté écriture ne pose pas ce problème : `afterSave` et `afterDelete` s'exécutent dans une
transaction en lecture-écriture, et la ligne d'audit est validée en même temps que la modification qu'elle enregistre.

---

## Exemples

### Masquage de données personnelles (PII)

Masquer les adresses e-mail pour les appelants non-administrateurs sur l'ensemble des collections :

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

### Journalisation d'audit globale

Enregistrer chaque suppression, sur l'ensemble des collections, dans une table `audit_log`. Comme
`afterDelete` s'exécute dans la propre transaction de la suppression, la ligne d'audit et la
suppression sont validées ensemble — il n'y a aucun laps de temps où l'une existe sans
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

Notez bien ce que cela apporte et ce que cela implique : si la ligne d'audit ne peut pas être écrite, la
suppression n'a pas lieu non plus. Pour une piste d'audit, c'est généralement ce que l'on recherche.
Si ce n'est pas le cas, interceptez l'erreur dans le callback et explicitez-le dans un commentaire.

### Logique spécifique à une collection

Les callbacks globaux se déclenchent pour toutes les collections. Pour limiter la portée d'une logique à une seule collection, vérifiez `collection.slug` ou `path` :

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
