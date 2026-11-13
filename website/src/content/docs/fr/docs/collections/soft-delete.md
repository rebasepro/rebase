---
sourceHash: a289b69be61220df
title: Soft delete
sidebar_label: Soft delete
description: "softDelete sur une table transforme delete en un horodatage, masque les lignes marquées de chaque lecture et les restaure avec une simple mise à jour."
---

## Ce que cela change

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Lorsque `softDelete` est activé, une suppression **horodate une colonne au lieu de supprimer la ligne**, et chaque lecture filtre les lignes ainsi marquées. Rien d'autre ne change dans l'opération : la même permission est requise, `beforeDelete` peut toujours y mettre son veto et `afterDelete` se déclenche toujours. Du point de vue de l'appelant, la ligne a été supprimée ; la manière dont la table l'enregistre concerne ce flag.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        reference: col.text().notNull(),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    softDelete: true,
    rls: "admin-only",
});
```

`true` utilise la colonne `deletedAt` (SQL `deleted_at`). La forme objet permet d'en désigner une autre : `softDelete: { field: "archivedAt" }`. Le champ est vérifié par rapport aux colonnes de la table par les types.

:::caution[À vous de déclarer la colonne]
Ce flag définit la *signification* d'une colonne ; il n'en ajoute pas. Une table qui active `softDelete` sans déclarer cette colonne, ou avec une colonne qui n'est pas de type `timestamptz`, `date` ou `time`, est refusée lors de la compilation du schéma — avant même que quiconque ne tente de supprimer une ligne.
:::

## Ce que voit une lecture

Les lignes marquées sont masquées par défaut pour `find`, `findById`, `count`, les agrégats, le refetch en temps réel, ainsi que lorsque cette table est chargée via une relation. Ce comportement par défaut est tout l'intérêt : le code écrit avant l'existence du flag continue de fonctionner, et personne n'a besoin de penser à filtrer.

Deux paramètres de requête permettent d'élargir l'accès :

| Paramètre | Renvoie |
|-----------|---------|
| `?deleted=include` | Lignes actives **et** lignes marquées |
| `?deleted=only` | Lignes marquées uniquement — la vue corbeille |

Toute autre valeur renvoie une erreur 400 plutôt qu'un repli silencieux. `?deleted=true` masquant silencieusement chaque ligne supprimée donnerait l'impression de fonctionner tout en répondant à la question inverse.

## Restaurer, et supprimer définitivement

Une **restauration** est une simple mise à jour remettant le champ à `null`. Il n'y a pas de verbe spécifique, car il n'y a pas d'état particulier — la ligne n'est jamais partie. Via REST, il s'agit d'un `PATCH` — individuel, `/bulk` ou `_batch` — dont le corps définit le champ à `null` :

```bash
curl -X PATCH /api/data/invoices/7 -d '{"deletedAt": null}'
```

Cette mise à jour est la seule qui puisse atteindre une ligne marquée. Toute autre modification de celle-ci renvoie `404`, tout comme la ligne le fait pour chaque lecture par défaut ; restaurez-la d'abord.

L'inverse n'est pas une mise à jour. Définir le champ sur une valeur est refusé avec l'erreur `400` `FIELD_NOT_WRITABLE` — supprimez plutôt la ligne — afin que la permission `delete`, `beforeDelete` et `afterDelete` s'appliquent toujours. Un upsert peut créer une ligne déjà marquée, mais ne marque jamais une ligne déjà enregistrée.

Un upsert n'écrit pas non plus dans une ligne située dans la corbeille : lorsque sa clé appartient à une ligne marquée, il est refusé avec l'erreur `409` `ROW_IN_TRASH` et rien n'est écrit. Restaurez d'abord la ligne, ou purgez-la avec `?hard=true` puis relancez l'upsert.

Une suppression via un chemin many-to-many, comme `DELETE /api/data/posts/1/tags/5`, supprime le lien de l'article 1 avec le tag. Elle n'effectue pas de suppression réversible du tag, que d'autres articles continuent d'utiliser.

Un **véritable** `DELETE` utilise `?hard=true` sur l'appel de suppression. Il requiert exactement la même permission qu'une suppression ordinaire : il s'agit du même verbe, et le restreindre séparément créerait une seconde surface de contrôle d'accès pour une seule opération. Ce que cela change, c'est la possibilité pour la ligne d'être restaurée. Seuls les littéraux `true` ou `1` signifient oui ; une faute de frappe renvoie une erreur 400, car un appelant qui a demandé une purge et a obtenu une suppression réversible croirait que les données ont disparu.

## Depuis le SDK

Le client typé accède à la corbeille via `trash` sur chaque table. Il envoie les requêtes mentionnées ci-dessus : `?deleted=only` sur les lectures, la mise à jour vers `null` pour une restauration, et `?hard=true` pour une purge.

```typescript
const trashed = await client.data.invoices.trash.find({ limit: 20 });
const howMany = await client.data.invoices.trash.count();

await client.data.invoices.trash.restore(7);       // PATCH { deletedAt: null }
await client.data.invoices.trash.restoreMany([8, 9]);

await client.data.invoices.trash.purge(7);         // DELETE ?hard=true
await client.data.invoices.trash.purgeMany([8, 9]);
```

`trash.find` et `trash.count` acceptent les mêmes paramètres que `find` et `count`. Une restauration définit `deletedAt` à moins que vous ne spécifiiez le champ : une table déclarée avec `softDelete: { field: "archivedAt" }` se restaure avec `trash.restore(7, { field: "archivedAt" })`. Le client ne peut pas lire le nom du champ depuis le serveur.

Utilisez `trash` sur une table qui déclare `softDelete`. Sur une table qui ne le déclare pas, le serveur ignore `?deleted=`, de sorte que `trash.find` renvoie les lignes actives et `trash.purge` effectue une suppression ordinaire.

Le code serveur dispose du même `trash` : `context.data.invoices.trash` dans un hook, et `rebase.data.invoices.trash` dans une fonction ou un cron. Il lit et purge via le pilote, avec les privilèges de l'appelant, tout comme le reste de [`context.data`](/docs/collections/context-data-api).

Lorsque le mode [hors-ligne](/docs/sdk/offline) est activé, la corbeille n'est jamais mise en cache et rien à l'intérieur n'est mis en file d'attente. Chaque appel nécessite le serveur et échoue avec l'erreur `OFFLINE` en son absence. Une ligne restaurée réintègre la base de données locale, et une ligne purgée en est retirée.

## Prochaines étapes

- **[Tables](/docs/schema/)** — où `softDelete` est déclaré
- **[API REST](/docs/backend/api)** — les points de terminaison de suppression et de requête auxquels ces paramètres s'appliquent
- **[Sécurité au niveau des lignes](/docs/collections/security-rules/)** — qui a le droit de supprimer une ligne
