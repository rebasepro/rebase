---
sourceHash: 81fb68b88d544514
title: Hooks Backend Globaux
sidebar_label: Hooks globaux
description: "Appliquez des hooks de cycle de vie transversaux à chaque table au niveau du serveur : exportez les hooks depuis backend/hooks.ts, selon la même structure TableHooks que celle utilisée par les hooks propres à une table."
---

## Vue d'ensemble

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Rebase exécute les hooks de table à deux niveaux, tous deux du type `TableHooks` issu de
`@rebasepro/server/schema` :

- **[Hooks de table](/docs/collections/callbacks)** : la clé `hooks` d'un `defineTable`. Ils s'exécutent uniquement pour cette table.
- **Hooks globaux** : exportés sous le nom `hooks` depuis `backend/hooks.ts`. Ils se déclenchent sur **chaque** table, sur chaque chemin de données (API REST, WebSocket / temps réel, MCP, `rebase.dataAsAdmin` côté serveur). Le seul système d'écriture qu'ils ne voient pas est le système d'authentification : l'inscription, la connexion OAuth et la gestion des utilisateurs par l'administrateur écrivent directement les lignes de l'utilisateur et exécutent à la place les [hooks d'authentification](/docs/backend/authentication/) (`afterUserCreate`, …).

Utilisez les hooks globaux pour :
- **Le scoping de lignes** — `beforeQuery` sur chaque table, afin que les lectures d'un locataire (tenant) soient restreintes à un seul endroit plutôt que par table. Voir [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Le masquage des PII (données personnelles)** — masquer les champs sensibles pour les appelants non-administrateurs sur l'ensemble des tables.
- **La journalisation d'audit unifiée** — enregistrer chaque création, mise à jour ou suppression au même endroit. Les nouveaux comptes issus des inscriptions et d'OAuth n'en font pas partie ; journalisez-les depuis `afterUserCreate`.
- **La validation transversale** — appliquer des invariants s'étendant sur plusieurs tables.

:::note
**Ordre d'exécution** : hooks globaux → hooks propres à la table → `.transform()` de ses colonnes.
:::

Chaque hook reçoit le descripteur de la table pour laquelle il s'exécute via `table`, les hooks globaux nécessitent donc des tables déclarées : un backend qui inspecte la base de données par introspection (sans `backend/schema`) les refusera au démarrage.

---

## Configuration

:::note[Emplacement]
**Runtime managé** — `export const hooks = { … }` depuis `backend/hooks.ts`. Le runtime lit cet export au démarrage ; rien d'autre n'a besoin d'être modifié. Tout autre export du fichier est signalé au démarrage et ignoré.

**Éjecté** — la clé `hooks` dans `initializeRebaseBackend({ … })`.

La cartographie complète se trouve dans [Vue d'ensemble du backend](/docs/backend/#where-each-option-lives).
:::

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values }) {
        // Runs after every row read, across all tables
        return values;
    },
    beforeSave({ values }) {
        // Runs before every save
        return values;
    }
};
```

`hooks` prend un seul ensemble. Pour séparer plusieurs problématiques, écrivez chacune dans son propre ensemble et passez `composeTableHooks(tenantScope, auditTrail)` depuis `@rebasepro/common` : ils se combinent exactement de la même manière que les niveaux présentés ci-dessus. Voir [Combiner des ensembles de hooks](/docs/collections/callbacks/#combining-hook-sets).
Il en va de même pour `backend.setTableHooks(slug, hooks)`, qui remplace les hooks déclarés par une table : passez `composeTableHooks(declared, yours)` pour les conserver.

---

## Type `TableHooks`

```typescript
type TableHooks = {
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform the row before returning it to the caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

`beforeQuery` restreint une lecture avant qu'elle ne soit compilée ; voir
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Tous les hooks peuvent retourner une `Promise` (asynchrone) ou une valeur simple (synchrone).

---

## Propriétés des hooks (Props)

Chaque hook reçoit un objet de propriétés unique. Champs communs :

| Champ | Type | Présent dans |
|-------|------|--------------|
| `table` | `TableDescriptor` | Tous les hooks |
| `path` | `string` | Tous les hooks |
| `values` | `Record<string, unknown>` | Tous sauf `beforeQuery` : la ligne lue (`afterRead`), en cours de suppression (`beforeDelete`, `afterDelete`), ou les valeurs écrites (les hooks de sauvegarde) |
| `id` | `string \| number` | `beforeSave` (optionnel), `afterSave`, `afterSaveError` (optionnel), `beforeDelete`, `afterDelete` |
| `previousValues` | ligne (optionnel) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing" \| "copy"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `error` | `unknown` | `afterSaveError` |
| `operation`, `query` | type de lecture, requête de l'appelant | `beforeQuery` |
| `context` | `RebaseCallContext` | Tous les hooks |

`context.user` contient l'utilisateur authentifié (`uid`, `roles`, etc.). Une requête sans jeton, lorsque l'API en autorise l'accès, transmet l'identité anonyme `{ uid: "anonymous", roles: ["anon"] }` au lieu de `undefined`.

`context.credential` désigne la clé d'API avec laquelle une écriture a été effectuée : `{ kind, id, name }`, où `kind` est `"personal"` ou `"service"`. Une clé personnelle agit en tant que son propriétaire, donc `context.user` correspond au propriétaire, qu'il ait sauvegardé manuellement ou qu'une tâche de CI ait écrit avec sa clé ; `context.credential` permet de distinguer les deux. Elle est définie sur l'API de données, le socket temps réel et `/mcp`, et absente pour une session, la clé de service, les opérations en contexte serveur (`rebase.dataAsAdmin`, tâches cron) et dans le navigateur. Elle ne contient jamais le secret.

`table` est toujours présente. Un hook global se déclenchant pour chaque table, il s'agit du seul niveau enregistré indépendamment de chacune d'elles — mais il ne reçoit jamais une table manquante. Une requête mentionnant un chemin que le serveur ne peut pas résoudre est rejetée avec un code `404 NOT_FOUND` avant qu'aucun niveau ne s'exécute, ce qui correspond à la même réponse que les chemins de lecture et d'écriture renvoient de toute façon. L'alternative — ignorer ce niveau pour ces chemins — transformerait `afterRead` en une étape de caviardage avec une exception silencieuse, ce qui n'est donc pas proposé.

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
 │ 3. Global hook: beforeSave         ─┐                       │
 │ 4. Table hook: beforeSave          ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global hook: afterSave          ─┐                       │
 │ 7. Table hook: afterSave           ─┘ awaited               │
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

**Chaque hook de la liste ci-dessous est attendu (`awaited`), et ils s'exécutent tous à l'intérieur de la transaction qui porte l'écriture, à l'exception de `afterSaveError`.** Il n'existe pas de niveau « fire and forget » : la ligne et tout ce que ses hooks ont accompli sont validés ensemble ou pas du tout.

- **`beforeSave`, `beforeDelete`** — si le hook lève une exception, l'opération est rejetée avec une erreur HTTP 400 contenant votre message et le code `CALLBACK_REJECTED`, et l'écriture en base de données n'a jamais lieu. Levez une `RebaseApiError` issue de `@rebasepro/types` pour choisir vous-même le code d'état — voir [Hooks de table](/docs/collections/callbacks#beforesave). Un `beforeDelete` qui *retourne* `false` correspond au même refus sans message, et répond **403** avec ce même code.
- **`afterRead`** — la ligne renvoyée (ou transformée) est ce que l'appelant reçoit, et uniquement l'appelant : lors d'une écriture, elle structure la réponse, tandis que `afterSave`, `beforeDelete`, `afterDelete` et l'historique reçoivent la ligne telle qu'elle est stockée — une valeur masquée n'est jamais enregistrée ni restaurée dans la colonne. Sa transaction est en lecture seule (`READ ONLY`) — voir [ci-dessous](#afterread-ne-peut-pas-écrire).
- **`afterSave`, `afterDelete`** — s'exécutent *avant* le commit, en attente (`awaited`). Une exception levée ici annule l'enregistrement de la ligne (rollback) et renvoie le même code **400 `CALLBACK_REJECTED`**, avec `details.stage` nommant le hook. Ils maintiennent la transaction ouverte pendant leur exécution, donc une opération lente constitue un verrou maintenu.
- **`afterSaveError`** — s'exécute lorsque la sauvegarde a échoué, sur le chemin de retour. Lors d'une requête, il s'exécute après l'annulation (rollback) de la transaction de l'écriture en échec, avec un `context` dont chaque appel représente sa propre transaction, de sorte qu'une tâche mise en file d'attente pour signaler l'échec est préservée. Une exception levée par ce hook est journalisée ; l'appelant reçoit l'erreur d'origine de la sauvegarde.

:::caution[Cette page indiquait auparavant le contraire]
Les versions précédentes mentionnaient que `afterSave` et `afterDelete` « s'exécutent après la validation de la transaction » et « ne bloquent pas la réponse HTTP ». Elles n'ont en réalité jamais fonctionné ainsi. Le code écrit sur la base de cette affirmation — un appel de webhook dans `afterSave`, par exemple — a maintenu une transaction de base de données ouverte pendant toute la durée d'un aller-retour HTTP, tout en annulant la ligne à chaque fois que le service distant était indisponible.
:::

### Quand `afterSaveError` s'exécute-t-il

Il signale une sauvegarde qui a échoué **au niveau de la base de données ou après celle-ci** — à partir de l'instruction INSERT ou UPDATE. Une sauvegarde refusée avant ce stade n'a jamais atteint la base de données, le hook n'en est donc pas informé.

| S'exécute | Ne s'exécute pas |
|---|---|
| La base de données refuse l'instruction : violation de clé unique ou étrangère, contrainte CHECK ou déclencheur (trigger), politique de sécurité au niveau des lignes (RLS - `WRITE_DENIED`) | Un refus dans `beforeSave` — le hook ayant refusé est celui qui a l'information |
| `afterRead` ou `afterSave` lève une exception (l'appelant reçoit `CALLBACK_REJECTED`) | Une requête refusée avant le pilote : validation (`VALIDATION_*`), un champ que l'appelant n'est pas autorisé à écrire, une permission manquante |
| L'entrée d'historique ne peut pas être enregistrée | Une ligne que l'appelant ne peut pas adresser (`404`), un identifiant de locataire (tenant stamp) qu'il ne peut pas définir |
| | Le commit est refusé après le retour de la sauvegarde : `TRANSACTION_ABORTED` (une instruction en échec interceptée par un hook), ou une contrainte différée vérifiée au moment du `COMMIT` |
| | Une suppression — il n'existe pas d'équivalent pour la suppression |

Lors d'une écriture en masse ou via `_batch`, il s'exécute pour la ligne qui a échoué ; les lignes précédentes sont annulées avec le lot et ne sont pas signalées.

### Effets de bord ne devant pas maintenir la transaction ouverte

Tout ce qui est lent, ou tout ce qui ne peut pas être annulé en cas de rollback de la transaction, n'a pas sa place dans le corps du hook :

| Besoin | Solution recommandée |
|---|---|
| Appeler un service tiers, envoyer un e-mail, générer un fichier | [Mettre une tâche en file d'attente](/docs/backend/jobs). Une tâche mise en file d'attente dans une transaction annulée ne sera jamais mise en file d'attente — ce qui correspond au comportement attendu. |
| Notifier d'autres processus qu'un événement s'est produit | Publier sur un [canal temps réel](/docs/backend/realtime) après le retour de l'écriture, et non depuis l'intérieur du hook. |
| Travailler dans une [fonction personnalisée](/docs/backend/custom-functions) que l'appelant n'a pas besoin d'attendre | `waitUntil(c, promise)` issu de `@rebasepro/server/functions` — s'exécute après la réponse, et l'hôte attend sa fin avant de s'arrêter. |

La règle générale : si le travail doit persister alors que l'écriture est annulée, il ne fait pas partie de l'écriture et ne doit donc pas figurer dans le hook.

### `afterRead` ne peut pas écrire

Une lecture initiée par une requête ouvre sa transaction en mode `READ ONLY`, tout comme le rafraîchissement d'une souscription temps réel. `afterRead` s'exécute à l'intérieur de celle-ci, de sorte **qu'aucune écriture issue de ce hook ne peut réussir** — ni une création via `context.data`, ni une mise à jour, ni même une écriture dissimulée dans une fonction utilitaire appelée. Postgres refuse l'instruction avec le SQLSTATE `25006`, et l'appelant reçoit :

```json
{ "error": { "message": "An `afterRead` hook tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Il s'agit d'une erreur 409, et non d'une 500 : c'est votre code qui est refusé, et non le serveur qui est en panne.
Ce mode lecture seule est délibéré — une lecture qui effectue discrètement des écritures est une lecture dont personne n'a anticipé le coût, les verrous et la surface d'exposition RLS.

Par conséquent, **l'audit de lecture n'a pas sa place dans `afterRead`**. Journalisez plutôt la lecture en dehors de la requête — depuis une tâche de fond alimentée par ce que vous émettez déjà, ou depuis une fonction personnalisée effectuant la lecture *et* l'écriture via deux appels distincts :

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
export const hooks: TableHooks = {
    afterRead: async ({ path, values, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return values;
    }
};
```

```typescript
// backend/functions/read-article.ts — served at /api/functions/read-article/:id
// ✓ The read and the audit row are two operations, and only the second writes.
import { defineFunction, getUserId, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/:id", requireAuth, async (c) => {
        const article = await requireDriver(c).fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: getUserId(c) });
        return c.json(article);
    });
});
```

L'audit côté écriture ne pose aucun problème de ce genre : `afterSave` et `afterDelete` s'exécutent dans une transaction en lecture-écriture, et la ligne d'audit est validée en même temps que la modification qu'elle enregistre.

---

## Exemples

### Masquage des PII (données sensibles)

Masquer les adresses e-mail pour les appelants non-administrateurs sur toutes les tables :

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values, context }) {
        const isAdmin = context.user?.roles?.includes("admin");
        if (!isAdmin && values.email) {
            return { ...values, email: "********" };
        }
        return values;
    }
};
```

### Journalisation d'audit globale

Enregistrer chaque suppression, sur l'ensemble des tables, dans une table `audit_log`. Comme `afterDelete` s'exécute dans la transaction propre à la suppression, la ligne d'audit et la suppression sont validées conjointement — il n'existe aucun intervalle où l'une existe sans l'autre :

```typescript no-verify
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    async afterDelete({ table, id, values, context }) {
        if (table.slug === "audit_log") return;   // don't audit the audit
        await context.data.audit_log.create({
            action: "delete",
            table: table.slug,
            entity_id: String(id),
            actor: context.user?.uid ?? "anonymous",
            // The API key, when the delete was made with one.
            via_key: context.credential?.name ?? null,
            snapshot: values
        });
    }
};
```

Notez ce que cela apporte et ce que cela implique : si la ligne d'audit ne peut pas être écrite, la suppression n'a pas lieu non plus. Pour un journal d'audit, c'est généralement ce qui est recherché. Si ce n'est pas le cas, interceptez l'erreur dans le hook et indiquez-le dans un commentaire.

### Logique spécifique à une table

Les hooks globaux se déclenchent pour toutes les tables. Pour restreindre la logique à une seule table, vérifiez `table.slug` ou `path` :

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    beforeSave({ table, values }) {
        if (table.slug === "orders") {
            const total = values.total;
            if (typeof total !== "number" || total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
};
```

Pour les hooks ne s'appliquant qu'à une seule table, privilégiez plutôt [les hooks propres à la table](/docs/collections/callbacks).
