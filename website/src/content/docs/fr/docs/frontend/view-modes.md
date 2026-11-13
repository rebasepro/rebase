---
sourceHash: 57ee5c3ecdf49419
title: Modes d'affichage
sidebar_label: Modes d'affichage
description: "Affichez les lignes d'une table sous forme de liste, de feuille de calcul, de cartes ou de tableau kanban ; choisissez ce qui remplit le titre, l'image, le statut et la date de chaque enregistrement ; et définissez le tri par défaut, les filtres et les préréglages de filtres en un clic."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque collection peut être affichée de quatre manières, depuis le sélecteur situé dans sa barre d'outils :

- **Table** : une feuille de calcul virtualisée avec édition en ligne, tri, filtrage
  et sélection multiple. Le mode d'ouverture par défaut d'une collection, sauf indication contraire.
- **List** : une ligne par enregistrement, avec son image, son titre, son sous-titre, son statut et
  sa date.
- **Cards** : une grille de cartes, pour les contenus riches en images.
- **Kanban** : un tableau groupé par une colonne ayant un ensemble fermé de valeurs.

Une collection peut également proposer des modes d'affichage que vous développez (un calendrier, une carte,
une galerie) dans le même sélecteur, pilotés par la même barre d'outils : voir
[Modes d'affichage personnalisés](/docs/frontend/extending#custom-view-modes).

## Choisir les vues

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```ts
// backend/schema/tasks.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        title:   col.text().notNull(),
        status:  col.enum(["backlog", "in_progress", "review", "done"]).notNull().default("backlog"),
        dueDate: col.date(),
        // The board's order key: text, never a number.
        __order: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    defaultViewMode: "kanban",
    enabledViews: ["table", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        status: {
            enumLabels: {
                backlog:     { label: "Backlog", color: "gray" },
                in_progress: { label: "In Progress", color: "blue" },
                review:      { label: "Review", color: "orange" },
                done:        { label: "Done", color: "green" },
            },
        },
        __order: { hidden: true, hiddenInForm: true },
    },
});
```

| Option | Effet |
|---|---|
| `defaultViewMode` | L'affichage sur lequel arrive un visiteur : `"table"`, `"list"`, `"cards"`, `"kanban"` ou la clé d'une vue personnalisée. |
| `enabledViews` | Les vues proposées par le sélecteur. |
| `kanban` | `{ columnField, orderField }` : le tableau kanban. |
| `defaultSize` | La hauteur de ligne, ci-dessous. |
| `customViews` | Vos propres vues, par valeur ou par clé. |

### Hauteur de ligne

| `defaultSize` | Pixels | Idéal pour |
|------|--------|----------|
| `"xs"` | 36 | Tables de données denses |
| `"s"` | 42 | Lignes de texte compactes |
| `"m"` | 48 | Par défaut |
| `"l"` | 96 | Vignettes d'images moyennes |
| `"xl"` | 160 | Grandes vignettes d'images |

## Kanban

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`kanban.columnField` désigne la colonne utilisée pour regrouper le tableau. Elle doit contenir un
ensemble fermé de chaînes de caractères, un `col.enum([...])` ou une colonne texte avec
`.oneOf([...])` ; toute autre configuration provoquera une erreur de type. Les colonnes sont affichées dans l'ordre
propre de la colonne, ou selon `enumOrder`, avec les libellés et couleurs de
`enumLabels`. Glisser une carte vers une autre colonne met à jour `columnField`.

`kanban.orderField` indique où est enregistrée la position d'une carte **au sein** d'une colonne.
Déclarez-le systématiquement : trois erreurs fréquentes produisent ici un tableau qui semble
configuré alors qu'il ne l'est pas.

**`orderField` n'est pas optionnel.** Sans lui, une carte peut toujours être déplacée entre les colonnes,
car cette action écrit dans `columnField`. Mais sa position au sein d'une colonne n'ayant nulle part où
être stockée, elle est réinitialisée à la prochaine lecture, et le tableau affiche un bandeau ambré
indiquant que l'ordonnancement n'est pas configuré.

**La colonne doit être de type texte.** Le réordonnancement écrit une clé d'indexation
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), et non un index numérique. Une colonne numérique ne peut jamais en contenir, c'est pourquoi
`orderField` n'accepte qu'une colonne texte. C'est un mécanisme interne, pas du contenu : masquez-la,
comme ci-dessus.

**Les lignes créées hors du CMS arrivent sans clé.** Rien n'en attribue une à
l'insertion. Une ligne créée par un cron, un script de seed, une migration ou l'API REST
arrive avec `__order` à null, et le tableau affiche *"Some items don't have order
values"* avec un bouton **Initialize**. Un clic permet de rétro-remplir la première page, mais
la prochaine exécution du cron fera réapparaître immédiatement le bandeau. Si un backend crée des lignes pour un
tableau, il doit ajouter la clé lui-même, avec l'alphabet utilisé par le CMS :

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await client.data.tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await client.data.tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Les lignes créées via le formulaire arrivent également sans clé ; la seule différence est que
vous voyez le bandeau dès que vous en ajoutez une. **Initialize** est la solution dans ce cas ; sur un
tableau alimenté par un backend, c'est une solution qui s'annule à chaque exécution.

## Emplacements d'affichage

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque surface affichant un enregistrement utilise certains de ces six emplacements : **title**,
**subtitle**, **image**, **status**, **date** et **tags**. Une ligne de liste équivaut à image +
titre + sous-titre + statut + date, une carte correspond à la même chose avec l'image au-dessus, un
sélecteur de référence équivaut à titre + sous-titre, et l'en-tête d'une page ne comprend que le titre.

Le CMS remplit certains emplacements à partir des colonnes de la table (voir les
[emplacements d'affichage par défaut](/docs/collections/#display-slots)). `display` permet de définir chacun
d'eux, sous forme de chemin de champ ou de fonction :

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    display: {
        title: "title",
        status: "status",
        date: "dueDate",
        subtitle: ({ row }) => row.dueDate ? `Due ${row.dueDate}` : undefined,
    },
});
```

Un emplacement que vous omettez conserve sa valeur dérivée.

Un résolveur reçoit `{ row, id, context }`. `row` correspond à l'enregistrement tel que le serveur
le renvoie, typé selon la ligne de la table : les dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa
colonne de clé étrangère. `id` est sa clé primaire sous forme de chaîne de caractères, les parties d'une clé composite
étant jointes par `:::`. Une relation chargée par le CMS arrive imbriquée sous son nom, telle que le
`include` de REST la renvoie, permettant à un résolveur de lire un champ de l'enregistrement lié
sans requête supplémentaire.

Un résolveur peut être `async`, pour aller chercher un élément que l'enregistrement ne contient pas. Pendant que
la promesse est en cours, la surface affiche la valeur dérivée et la remplace par la
valeur résolue dès qu'elle arrive : un titre n'affiche jamais de spinner. Les résultats sont mis en cache par
enregistrement et par emplacement, et les requêtes simultanées se partagent un seul appel.

Renvoyez `undefined` lorsqu'un enregistrement ne contient rien pour l'emplacement ; la surface se rabat
alors sur ce qu'elle connaît (un titre de page utilise le nom de la collection au singulier, un lien utilise
l'identifiant). Un résolveur qui lève une erreur est traité comme retournant `undefined` et consigné une fois dans les journaux.

Privilégiez un chemin dès que la valeur est présente sur l'enregistrement : un chemin conserve le rendu
propre au champ, ainsi un statut d'énumération reste une pastille de couleur et une date reste formatée,
ce qu'un résolveur renvoyant une chaîne de caractères ne peut pas faire.

Lorsqu'aucun emplacement ne définit le titre, le CMS en choisit un. Avec `fieldOrder`, c'est le premier
champ dans cet ordre qui peut faire office de titre : du texte, une relation à cardinalité simple ou
une référence. Sinon, les candidats sont classés : le texte dont la clé correspond à un libellé
(`name`, `title`, `label`…) en premier, puis le texte court, un e-mail, une énumération, le texte long,
une relation et une référence. Les clés, colonnes uuid, champs de fichier et champs masqués ne sont
jamais éligibles. Tout ce que contient le titre est affiché sous forme de texte : une date formatée, un
tableau joint, et une relation sous forme du premier champ disponible parmi `name`, `title`, `label` ou
`displayName` sur la ligne liée, avec repli sur son identifiant.

## Filtres, préréglages et tri

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    sort: ["dueDate", "asc"],
    defaultFilter: { status: ["!=", "done"] },
    filterPresets: [
        { label: "In review", filterValues: { status: ["==", "review"] } },
        { label: "Overdue", filterValues: { dueDate: ["<", new Date().toISOString().slice(0, 10)] }, sort: ["dueDate", "asc"] },
    ],
});
```

| Option | Effet |
|---|---|
| `sort` | Le tri par défaut : une clé et une direction, ou plusieurs dans l'ordre. |
| `defaultFilter` | Le filtre avec lequel le visiteur commence, et qu'il peut modifier. |
| `fixedFilter` | Un filtre que le visiteur ne peut pas modifier. Les filtres qu'il applique sur d'autres champs y sont combinés. |
| `filterPresets` | Filtres en un clic dans la barre d'outils : `{ label?, filterValues, sort? }`. Sans libellé, un libellé est généré à partir du filtre. |
| `pagination` | Charger par pages (`true`, ou la taille de la page), ou tout charger en une fois (`false`). |

Chaque clé est validée par rapport aux champs de la table. La propriété `filterOperators` propre à un champ
restreint les opérations possibles pour le filtrer, et `[]` désactive complètement le filtrage sur ce champ.

Un `fixedFilter` restreint ce que le CMS *demande*. Il ne s'agit pas d'une barrière de sécurité : ce qu'un
appelant a le droit de lire est déterminé par la [sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/)
de la table, pour chaque appelant.

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [customizeTable](/docs/frontend/customize-table/) : toutes les options
- [Personnaliser l'administration](/docs/frontend/customizing/) : vos propres modes d'affichage, pages et actions
- [Vues d'entité](/docs/frontend/entity-views/) : onglets sur un enregistrement
- [Actions d'entité](/docs/frontend/entity-actions/) : boutons sur un enregistrement
