---
sourceHash: 68aa6b76fbe1dd6b
title: Modes d'affichage
sidebar_label: Modes d'affichage
description: "Affichez les lignes d'une table sous forme de liste, de feuille de calcul, de cartes ou de tableau kanban ; choisissez ce qui remplit le titre, l'image, le statut et la date de chaque enregistrement ; et définissez le tri par défaut, les filtres et les préréglages de filtres en un clic."
---

Chaque collection peut être affichée de quatre manières, depuis le sélecteur dans sa barre d'outils :

- **Table** : une feuille de calcul virtualisée avec édition en ligne, tri, filtrage
  et sélection multiple. C'est le mode d'ouverture par défaut d'une collection, sauf indication contraire.
- **List** : une ligne par enregistrement, avec son image, son titre, son sous-titre, son statut et
  sa date.
- **Cards** : une grille de cartes, pour les contenus riches en images.
- **Kanban** : un tableau regroupé par une colonne ayant un ensemble fermé de valeurs.

Une collection peut également proposer des modes d'affichage que vous écrivez vous-même (un calendrier, une carte, une
galerie) dans le même sélecteur, pilotés par la même barre d'outils : voir
[Modes d'affichage personnalisés](/docs/frontend/extending#custom-view-modes).

## Choisir les vues

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
    },
});
```

| Option | Effet |
|---|---|
| `defaultViewMode` | La vue sur laquelle arrive un visiteur : `"table"`, `"list"`, `"cards"`, `"kanban"` ou la clé d'une vue personnalisée. |
| `enabledViews` | Les vues proposées par le sélecteur. |
| `kanban` | `{ columnField, orderField }` : le tableau. |
| `defaultSize` | La hauteur de ligne, ci-dessous. |
| `customViews` | Vos propres vues, par valeur ou par clé. |

### Hauteur de ligne

| `defaultSize` | Pixels | Idéal pour |
|------|--------|----------|
| `"xs"` | 36 | Tables de données denses |
| `"s"` | 42 | Lignes de texte compactes |
| `"m"` | 48 | Par défaut |
| `"l"` | 96 | Miniatures d'images moyennes |
| `"xl"` | 160 | Grandes miniatures d'images |

## Kanban

`kanban.columnField` nomme la colonne utilisée pour regrouper le tableau. Elle doit contenir un
ensemble fermé de chaînes, un `col.enum([...])` ou une colonne texte avec
`.oneOf([...])` ; tout autre élément génère une erreur de type. Les colonnes sont affichées dans
l'ordre propre de la colonne, ou selon `enumOrder`, avec les libellés et les couleurs de
`enumLabels`. Glisser une carte vers une autre colonne écrit dans `columnField`.

`kanban.orderField` indique l'endroit où la position d'une carte **au sein** d'une colonne est stockée.
Déclarez-le dès que cet ordre a de l'importance : trois erreurs courantes ici produisent toutes un tableau
qui semble configuré mais ne l'est pas.

**Sans `orderField`, seule la colonne est conservée.** Une carte peut toujours être glissée entre
les colonnes, car cela écrit dans `columnField`, ce qui suffit à un tableau de statuts.
Sa position au sein d'une colonne ne pouvant être stockée nulle part, elle se réinitialise à la prochaine
lecture. Le tableau l'indique la première fois qu'une carte est déposée à un nouvel emplacement dans sa
propre colonne, via un bandeau qui peut être fermé ; un tableau dont les cartes ne se déplacent
qu'entre colonnes n'affiche rien.

**La colonne doit être de type texte.** La réorganisation écrit une clé
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), pas un index. Une colonne numérique ne peut jamais en contenir, donc
`orderField` n'accepte qu'une colonne texte. Il s'agit d'un mécanisme interne et non de contenu, donc
le renseigner dans `orderField` le masque de la table et le désactive dans le formulaire.
Une entrée `fields.__order` surcharge néanmoins l'un ou l'autre : `hidden: false` l'affiche.

**Les lignes créées en dehors du CMS arrivent sans clé.** Rien n'en assigne une à
l'insertion. Une ligne écrite par un cron, un script de seed, une migration ou l'API REST
arrive avec `__order` à null, et le tableau affiche *"Some items don't have order
values"* avec un bouton **Initialize**. Un clic remplit la première page, et
la prochaine exécution du cron fait réapparaître le bandeau immédiatement. Si un backend crée des lignes pour un
tableau, il doit ajouter la clé lui-même, avec l'alphabet qu'utilise le CMS :

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

Les lignes créées via le formulaire arrivent également sans clé ; la seule différence est
que vous voyez le bandeau dès que vous en ajoutez une. **Initialize** est la solution dans ce cas ; sur un
tableau alimenté par un backend, c'est une solution qui s'annule à chaque exécution.

## Emplacements d'affichage (Display slots)

Toute surface affichant un enregistrement utilise certains de ces six emplacements : **title**,
**subtitle**, **image**, **status**, **date** et **tags**. Une ligne de liste est composée de image +
title + subtitle + status + date, une carte est identique avec l'image au-dessus, un
sélecteur de référence correspond à title + subtitle, et un en-tête de page correspond au title seul.

Le CMS remplit certains emplacements à partir des colonnes de la table (voir
[emplacements d'affichage par défaut](/docs/collections/#display-slots)). `display` permet de définir
n'importe lequel d'entre eux, sous forme de chemin de champ ou de fonction :

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

Un resolver reçoit `{ row, id, context }`. `row` est l'enregistrement tel que le serveur
l'envoie, typé selon la ligne de la table : les dates sous forme de chaînes ISO, une relation belongsTo sous la forme
de sa colonne de clé étrangère. `id` est sa clé primaire sous forme de chaîne de caractères, les parties d'une clé composite
étant jointes par `:::`. Une relation chargée par le CMS arrive imbriquée sous son nom, telle que
`include` de l'API REST la renvoie, permettant à un resolver de lire le champ d'un enregistrement lié
sans effectuer de requête supplémentaire.

Un resolver peut être `async`, pour aller lire un élément que l'enregistrement ne contient pas. Pendant que
la promesse est en attente, la surface affiche la valeur dérivée puis la remplace par la valeur
résolue dès qu'elle arrive : un titre n'est jamais un indicateur de chargement. Les résultats sont mis en cache par
enregistrement et par emplacement, et les requêtes simultanées partagent un seul appel.

Renvoyez `undefined` lorsqu'un enregistrement ne contient rien pour l'emplacement ; la surface se rabat
sur ce qu'elle connaît (un en-tête utilise le nom de la collection au singulier, un lien utilise
l'identifiant). Un resolver qui lève une exception est traité comme renvoyant `undefined` et est consigné dans les logs une seule fois.

Privilégiez un chemin dès que la valeur se trouve sur l'enregistrement : un chemin conserve le
rendu propre au champ, ainsi un statut enum reste un badge coloré et une date reste formatée,
ce qu'un resolver renvoyant une chaîne ne peut pas faire.

Lorsqu'aucun emplacement ne spécifie le titre, le CMS en choisit un à partir du texte de la table elle-même.
Avec `fieldOrder`, il choisit le premier champ dans cet ordre pouvant faire office de titre.
Sinon, les candidats sont classés : le texte dont la clé correspond à un libellé (`name`,
`title`, `label`…) en premier, puis un texte court, une adresse e-mail, un enum, un texte long et un
sélecteur d'utilisateur. Les clés, colonnes uuid, clés étrangères, relations, références, documents
JSON, champs de fichiers et champs masqués ne sont jamais retenus : une relation nomme
un autre enregistrement, ainsi un client appartenant à une agence n'a jamais pour titre
l'agence. Une table ne possédant aucun de ces éléments est intitulée par son identifiant. Un nom qui réside
dans une colonne JSON, ou une relation qui correspond réellement au nom d'une ligne (une
ligne de jonction), est désigné avec `display.title` : `title: "data.name"`,
`title: "agency"`. Quel que soit le contenu du titre, il est affiché sous forme de texte : une date formatée,
un tableau concaténé, et une relation sous forme du titre de sa ligne liée, avec un repli
sur son identifiant.

## Filtres, préréglages et tri

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
| `defaultFilter` | Le filtre à partir duquel un visiteur commence, et qu'il peut modifier. |
| `fixedFilter` | Un filtre que le visiteur ne peut pas modifier. Les filtres qu'il applique sur d'autres champs y sont combinés. |
| `filterPresets` | Filtres en un clic dans la barre d'outils : `{ label?, filterValues, sort? }`. Sans libellé, un nom est généré à partir du filtre. |
| `pagination` | Charger par pages (`true`, ou la taille de page), ou tout en une seule fois (`false`). |

Chaque clé est validée par rapport aux champs de la table. La propriété `filterOperators` d'un champ
restreint ce qui peut être filtré sur celui-ci, et `[]` en désactive le filtrage.

Un `fixedFilter` restreint ce que le CMS *demande*. Il ne s'agit pas d'une limite de sécurité : ce qu'un
appelant a le droit de lire est déterminé par la
[sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/) de la table, pour chaque appelant.

## Prochaines étapes

- [customizeTable](/docs/frontend/customize-table/) : toutes les options
- [Personnalisation de l'administration](/docs/frontend/customizing/) : vos propres modes d'affichage, pages et actions
- [Entity views](/docs/frontend/entity-views/) : onglets sur un enregistrement
- [Entity actions](/docs/frontend/entity-actions/) : boutons sur un enregistrement
