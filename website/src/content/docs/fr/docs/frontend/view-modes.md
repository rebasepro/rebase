---
sourceHash: 94cc15a104ed93ec
title: Modes d'affichage
sidebar_label: Modes d'affichage
description: "Affichez les lignes d'une table sous forme de liste, de feuille de calcul, de cartes ou de tableau kanban ; choisissez ce qui remplit le titre, l'image, le statut et la date de chaque enregistrement ; et définissez le tri par défaut, les filtres et les préconfigurations de filtres en un clic."
---

Chaque collection peut être affichée de quatre manières, depuis le sélecteur dans sa barre d'outils :

- **Table** : une feuille de calcul virtualisée avec édition en ligne, tri, filtrage
  et sélection multiple. Là où une collection s'ouvre sauf indication contraire.
- **Liste** : une ligne par enregistrement, avec son image, son titre, son sous-titre, son statut et sa
  date.
- **Cartes** : une grille de cartes, pour les contenus riches en images.
- **Kanban** : un tableau regroupé selon une colonne avec un ensemble fermé de valeurs.

Une collection peut également proposer des modes d'affichage que vous écrivez (un calendrier, une carte, une
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
        __order: { hidden: true },
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
| `"l"` | 96 | Vignettes d'images moyennes |
| `"xl"` | 160 | Grandes vignettes d'images |

## Kanban

`kanban.columnField` désigne la colonne selon laquelle le tableau effectue le regroupement. Elle doit contenir un
ensemble fermé de chaînes de caractères, un `col.enum([...])` ou une colonne texte avec
`.oneOf([...])` ; toute autre valeur génère une erreur de type. Les colonnes sont affichées dans l'ordre propre de
la colonne, ou selon `enumOrder`, avec les libellés et les couleurs de
`enumLabels`. Glisser une carte vers une autre colonne met à jour `columnField`.

`kanban.orderField` désigne l'endroit où la position d'une carte **au sein** d'une colonne est stockée.
Déclarez-le dès que cet ordre a de l'importance : trois erreurs ici produisent toutes un tableau
qui semble configuré mais ne l'est pas.

**Sans `orderField`, seule la colonne est conservée.** Une carte peut toujours être glissée entre les
colonnes, car cela écrit dans `columnField`, ce qui suffit amplement pour un tableau d'états.
Sa position au sein d'une colonne n'a aucun endroit où être stockée, elle est donc réinitialisée à la prochaine
lecture. Le tableau l'indique la première fois qu'une carte est déposée à un nouvel endroit dans sa
propre colonne, dans une barre qui peut être fermée ; un tableau dont les cartes ne se déplacent qu'entre
les colonnes n'affiche rien.

**La colonne doit être de type texte.** La réorganisation écrit une clé de
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), et non un indice numérique. Une colonne de nombres ne peut jamais en contenir une,
c'est pourquoi `orderField` n'accepte qu'une colonne texte. Il s'agit de tuyauterie technique, pas de contenu : masquez-la,
comme ci-dessus.

**Les lignes créées en dehors du CMS arrivent sans clé.** Rien n'en attribue une lors de
l'insertion. Une ligne écrite par une tâche cron, un script de seed, une migration ou l'API REST
arrive avec un `__order` null, et le tableau affiche *« Some items don't have order
values »* avec un bouton **Initialize**. Un simple clic permet de remplir rétroactivement la première page, et
la prochaine exécution de la tâche cron fera réapparaître la barre aussitôt. Si un backend crée des lignes pour un
tableau, il doit lui-même ajouter la clé, en utilisant l'alphabet utilisé par le CMS :

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
vous voyez la barre dès que vous en ajoutez une. **Initialize** est la solution dans ce cas ;
sur un tableau alimenté par un backend, c'est une solution qui s'annule à chaque exécution.

## Emplacements d'affichage

Chaque surface qui restitue un enregistrement utilise certains des six emplacements : **title**,
**subtitle**, **image**, **status**, **date** et **tags**. Une ligne de liste est image +
titre + sous-titre + statut + date, une carte est identique avec l'image au-dessus, un
sélecteur de référence est titre + sous-titre, et un en-tête de page est le titre seul.

Le CMS remplit certains emplacements à partir des colonnes de la table (voir les
[emplacements d'affichage par défaut](/docs/collections/#display-slots)). `display` définit n'importe
lequel d'entre eux, sous forme de chemin de champ ou de fonction :

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

Un emplacement omis conserve sa valeur dérivée.

Un résolveur reçoit `{ row, id, context }`. `row` est l'enregistrement tel que le serveur
l'envoie, typé selon la ligne de la table : les dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa
colonne de clé étrangère. `id` est sa clé primaire sous forme de chaîne, les parties d'une clé composite
étant jointes par `:::`. Une relation chargée par le CMS arrive imbriquée sous son nom, de la même manière que
le paramètre `include` de REST la renvoie, permettant ainsi à un résolveur de lire le champ d'un enregistrement lié sans
aucune requête supplémentaire.

Un résolveur peut être `async`, pour lire des données que l'enregistrement ne contient pas. Pendant que
la promesse est en cours, la surface affiche la valeur dérivée et la remplace par la
valeur résolue dès qu'elle arrive : un titre n'est jamais un indicateur de chargement. Les résultats sont mis en cache par
enregistrement et par emplacement, et les requêtes simultanées partagent un seul appel.

Renvoyez `undefined` lorsqu'un enregistrement ne possède rien pour l'emplacement ; la surface bascule
alors sur ce qu'elle connaît (un en-tête utilise le nom de la collection au singulier, un lien utilise
l'id). Un résolveur qui lève une exception est traité comme `undefined` et consigné une seule fois dans les logs.

Privilégiez un chemin dès que la valeur se trouve sur l'enregistrement : un chemin préserve le rendu
propre au champ, ainsi un statut d'enum reste une pastille colorée et une date reste formatée,
ce qu'un résolveur renvoyant une chaîne ne peut pas faire.

Lorsqu'aucun emplacement ne spécifie le titre, le CMS en choisit un parmi les champs texte de la table.
Avec `fieldOrder`, il prend le premier champ dans cet ordre pouvant servir de titre.
Sinon, les candidats sont classés : le texte dont la clé correspond à un libellé (`name`,
`title`, `label`…) en premier, puis le texte court, un e-mail, un enum, le texte long et un
sélecteur d'utilisateur. Les clés, les colonnes uuid, les clés étrangères, les relations, les références, les
documents JSON, les champs de fichiers et les champs masqués ne sont jamais éligibles : une relation désigne
un autre enregistrement, ainsi un client qui appartient à une agence n'aura jamais l'agence pour titre.
Une table ne disposant d'aucun de ces éléments a pour titre son id. Un nom qui réside
dans une colonne JSON, ou une relation qui correspond véritablement au nom d'une ligne (une ligne de jonction),
est désigné avec `display.title` : `title: "data.name"`,
`title: "agency"`. Quel que soit le contenu du titre, il est affiché sous forme de texte : une date formatée,
un tableau joint, et une relation prend le titre de sa ligne liée, avec repli sur
son id.

## Filtres, préconfigurations et tri

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
| `defaultFilter` | Le filtre initial d'un visiteur, qu'il peut modifier. |
| `fixedFilter` | Un filtre que le visiteur ne peut pas modifier. Les filtres qu'il applique sur d'autres champs se combinent avec celui-ci. |
| `filterPresets` | Filtres en un clic dans la barre d'outils : `{ label?, filterValues, sort? }`. Sans libellé, un libellé est généré à partir du filtre. |
| `pagination` | Chargement par pages (`true`, ou la taille de la page), ou tout d'un coup (`false`). |

Chaque clé est vérifiée par rapport aux champs de la table. La propriété `filterOperators` propre à un champ
restreint ce qui peut être filtré dessus, et `[]` désactive le filtrage pour celui-ci.

Un `fixedFilter` restreint ce que le CMS *demande*. Il ne constitue pas une barrière : ce qu'un
appelant peut lire est déterminé par la
[sécurité au niveau des lignes](/docs/collections/security-rules/) de la table, pour chaque appelant.

## Prochaines étapes

- [customizeTable](/docs/frontend/customize-table/) : toutes les options
- [Personnaliser l'administration](/docs/frontend/customizing/) : vos propres modes d'affichage, pages et actions
- [Vues d'entités](/docs/frontend/entity-views/) : onglets sur un enregistrement
- [Actions d'entités](/docs/frontend/entity-actions/) : boutons sur un enregistrement
