---
sourceHash: 035955ac366c306b
title: Soft delete
sidebar_label: Soft delete
description: Transformez la suppression en horodatage, masquez les lignes marquées de chaque lecture et restaurez-les avec une simple mise à jour.
---

## Ce que cela change

Lorsque `softDelete` est activé, une suppression **estampille une colonne au lieu de supprimer la ligne**, et chaque lecture filtre les lignes marquées. Rien d'autre ne change dans l'opération : la même permission est requise, `beforeDelete` peut toujours y mettre son veto et `afterDelete` se déclenche toujours. Du point de vue de l'appelant, la ligne a été supprimée ; la façon dont la table enregistre cela concerne uniquement cette option.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    softDelete: true,
    properties: {
        reference: { name: "Reference", type: "string" },
        deletedAt: { name: "Deleted at", type: "date", admin: { readOnly: true } }
    }
});
```

`true` utilise `deletedAt` (colonne `deleted_at`). La forme objet permet de la renommer : `softDelete: { field: "archivedAt" }`.

:::caution[La colonne doit être déclarée par vos soins]
L'option indique ce qu'une colonne *signifie* ; elle n'en fait pas apparaître une par magie. Une collection qui active `softDelete` sans déclarer cette propriété `date` est rejetée au démarrage — délibérément tôt, car l'alternative serait que l'erreur survienne lorsqu'un utilisateur essaie de supprimer une ligne.
:::

Postgres uniquement, tout comme la [recherche](/docs/backend/search) et les [index](/docs/backend/indexes).

## Ce qu'une lecture voit

Les lignes marquées sont masquées par défaut pour `find`, `findById`, `count`, les agrégats, le rafraîchissement en temps réel, ainsi que pour cette collection lorsqu'elle est chargée via une relation. Ce comportement par défaut est tout l'intérêt : le code écrit avant l'existence de cette option continue de fonctionner, et personne n'a besoin de penser à filtrer.

Deux paramètres de requête permettent de modifier cela :

| Paramètre | Réponses |
|-----------|---------|
| `?deleted=include` | Lignes actives **et** lignes marquées |
| `?deleted=only` | Uniquement les lignes marquées — la vue corbeille |

Toute autre valeur renvoie une 400 plutôt qu'un repli silencieux. Un `?deleted=true` masquant discrètement toutes les lignes supprimées donnerait l'impression de fonctionner tout en répondant à la question inverse.

## Restauration et suppression définitive

Une **restauration** est une simple mise à jour réinitialisant le champ à `null`. Il n'y a pas de verbe spécifique, car il n'y a pas d'état particulier — la ligne n'a jamais disparu.

Un **vrai** `DELETE` s'effectue avec `?hard=true` lors de l'appel de suppression. Il nécessite exactement la même permission qu'une suppression classique : il s'agit du même verbe, et restreindre son accès séparément créerait une seconde surface de contrôle d'accès pour une seule opération. Ce qui change, c'est la possibilité pour la ligne d'être restaurée ou non. Seuls les littéraux `true` ou `1` signifient « oui » ; une faute de frappe renvoie une 400, car un appelant ayant demandé une purge définitive et obtenant une suppression réversible croirait à tort que les données ont disparu.

## Prochaines étapes

- **[Définition des collections](/docs/collections)** — où `softDelete` est déclaré
- **[API REST](/docs/backend/api)** — les points de terminaison de suppression et de requête auxquels ces paramètres s'appliquent
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — qui est autorisé à supprimer une ligne

---
