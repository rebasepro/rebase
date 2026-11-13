---
sourceHash: 749d3a5f47923f4d
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable définit en quoi la collection d'une table diffère de ce que le CMS dérive : libellés, icône, vues, kanban, emplacements d'affichage, disposition du formulaire, actions et options par champ avec des composants React importés par valeur. Chaque option, avec son type et son effet."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Si vous utilisez le CMS, chaque table servie par le backend possède déjà une
collection dans le panneau, dérivée de la table elle-même (voir
[comment les tables deviennent des collections](/docs/collections/)).
`customizeTable` indique ce qui doit différer, et rien d'autre. Il réside dans
le frontend, aux côtés du reste de votre code React, de sorte qu'un champ
personnalisé est un composant que vous importez comme n'importe quel autre.

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { CustomMarkdownEditor } from "../../../../../components/CustomMarkdownEditor";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",

    defaultViewMode: "cards",
    enabledViews: ["table", "cards", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },

    display: {
        title: "title",
        image: "heroImage",
        status: "status",
        date: "publishDate",
    },

    fields: {
        status: {
            enumLabels: {
                draft:        { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published:    { label: "Published", color: "green" },
                archived:     { label: "Archived", color: "red" },
            },
        },
        title:   { multiline: true },
        content: { Field: CustomMarkdownEditor },
        orgId:   { hidden: true },
        __order: { hidden: true, disabled: true },
    },

    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published"),
        },
    ],
});
```

Transmettez le résultat à `<RebaseCMS tableCustomizations={[postsCms]}/>` ; voir
[la vue d'ensemble du frontend](/docs/frontend/#rebasecms-props).

:::note[Vous venez des collections ?]
Il s'agit des options de présentation de l'ancien bloc `admin`, au premier niveau
et sous quelques nouveaux noms (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). L'utilisation d'un ancien
nom lève une exception indiquant le nouveau nom à utiliser.
:::

## Emplacement des fichiers

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Les noms relèvent d'une convention. Ce qui importe, c'est que les résultats
parviennent à `<RebaseCMS tableCustomizations>`. Une table sans fichier est
affichée telle qu'elle est dérivée.

Le frontend importe uniquement le **type** de la table :
`import type { posts }`. Un import de type est éliminé lors de la création du
bundle, de sorte que les hooks et le code serveur dans `backend/schema`
n'atteignent jamais le navigateur. Un import par valeur depuis `backend/` dans le
code frontend est la seule chose à ne pas écrire. Le backend n'importe jamais
rien depuis le frontend.

## Le slug et le type

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le premier argument est le slug de la table : le nom sous lequel elle a été
définie, ou le `slug` qui lui a été attribué. Avec la table passée en paramètre
de type, le slug, chaque clé qui nomme un champ et chaque valeur d'énumération
sont vérifiés par rapport à la table :

| Vérifié par rapport à `typeof posts` | Une erreur correspond à |
|---|---|
| le premier argument | une erreur de type sauf s'il s'agit du slug de la table |
| les clés de `fields` | une clé de colonne ou un nom de relation |
| les entrées de `fieldOrder`, `listFields`, `form` | un champ, un chemin avec des points vers celui-ci (`"seo.title"`), `subcollection:<relation>`, ou la clé d'un champ supplémentaire |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | un champ ou un chemin vers un champ |
| `kanban.columnField` | une colonne contenant un ensemble fermé de chaînes (`col.enum([...])`, ou `.oneOf([...])`) |
| `kanban.orderField` | une colonne de texte |
| `enumLabels`, `enumOrder` | des valeurs que la colonne peut contenir ; une colonne sans ensemble fermé n'accepte ni l'un ni l'autre |
| les options de champ | celles du type de la colonne : `multiline` sur une colonne de texte, `format` sur un nombre |
| `entityActions[].onClick` et équivalents | `row` correspond au `InferRow` de la table |

`defineTable("blog_posts", { slug: "posts", … })` est personnalisé avec
`customizeTable<typeof posts>("posts", …)` : toujours un seul argument de type.
Sans l'argument de type, `customizeTable("posts", { … })` accepte les mêmes
options, avec un typage plus souple.

## Ce qui est refusé, et ce qui est ignoré

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`customizeTable` vérifie ce que le compilateur ne peut pas voir lors du
chargement du module, et lève une exception en indiquant ce qu'il faut écrire à
la place :

- une option inconnue, avec l'option connue la plus proche, ou avec le nouveau
  nom d'une ancienne option `admin` ;
- un composant fourni sous forme de chemin textuel, un thunk lazy
  `() => import(…)` ou tout ce qui n'est pas un composant React ;
- une action d'entité sans `name` ou `onClick`, une vue personnalisée sans
  `Builder`, un `kanban` sans `columnField`, un `referenceTo` qui n'est pas un slug ;
- des `fields` à l'intérieur des `overrides` d'une relation : personnalisez le
  style de la table cible avec son propre `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Le résultat est gelé (frozen). Passer deux personnalisations du même slug à
`<RebaseCMS>` lève une exception : déterminer laquelle l'emporterait dépendrait
de l'ordre d'importation.

Ce que le serveur fournit peut différer de ce sur quoi vous avez basé votre code.
Une colonne peut être masquée pour cet appelant (voir
[accès aux champs](/docs/collections/field-access/)), ou la table a pu changer
depuis. Cela ne constitue pas une erreur à l'exécution. En développement, le
panneau affiche un avertissement par incohérence et l'ignore :

- une personnalisation dont le slug ne correspond à aucune table servie est ignorée ;
- un champ, une entrée de colonne, un emplacement d'affichage, une entrée de
  formulaire ou un champ kanban que la table ne sert pas est abandonné ;
- une option qui ne s'applique pas au type du champ (`format` sur une colonne de
  texte, `enumLabels` sur un champ sans ensemble fermé) est ignorée.

Le reste de la personnalisation continue de s'appliquer.

## Options de table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque clé est facultative. Une clé omise conserve ce que le panneau a dérivé.

### Identité et navigation

| Option | Type | Effet |
|---|---|---|
| `name` | `string` | Le libellé au pluriel : tiroir, titre de la page. Dérivé du nom de la table sinon. |
| `singularName` | `string` | Le libellé d'un seul enregistrement. |
| `description` | `string` | Affiché sous l'en-tête et sur la carte d'accueil. |
| `metadata` | `Record<string, unknown>` | Vos propres données, fusionnées par-dessus les `metadata` de la table. |
| `icon` | `string \| ReactNode` | Un nom d'icône Lucide (`"FileText"`) ou un élément. |
| `group` | `string` | Le groupe de navigation. |
| `hideFromNavigation` | `boolean` | Absent du tiroir. Toujours accessible par URL et comme cible de référence. |
| `hideFromEntityViews` | `boolean` | Non proposé sous forme d'onglet sur les enregistrements des tables qui y sont liées. |

### Vues

| Option | Type | Effet |
|---|---|---|
| `defaultViewMode` | `ViewMode` | La vue sur laquelle arrive un visiteur : `"list"`, `"table"`, `"cards"`, `"kanban"` ou la clé d'une vue personnalisée. `"list"` sinon. |
| `enabledViews` | `ViewMode[]` | Les vues proposées dans le sélecteur. |
| `kanban` | `{ columnField, orderField? }` | Le tableau : la colonne selon laquelle il effectue le regroupement et la colonne de texte dans laquelle il stocke les clés d'ordre. Voir [Modes de vue](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | D'autres façons de restituer les lignes : `{ key, name, Builder }`, ou la clé de l'une d'entre elles enregistrée sur `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | La hauteur de ligne par défaut. |

`kanban` prend deux clés :

| Clé | Type | Effet |
|---|---|---|
| `columnField` | clé de colonne | La colonne d'où proviennent les colonnes du tableau : un `col.enum([...])` ou `.oneOf([...])` de chaînes. |
| `orderField` | clé de colonne de texte | L'endroit où la position d'une carte dans sa colonne est stockée, sous la forme d'une clé d'ordre fractionnaire. Sans elle, l'ordre est réinitialisé à chaque lecture. |

### Colonnes et emplacements

| Option | Type | Effet |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | L'ordre dans lequel les champs sont affichés. Les champs omis suivent, donc rien ne disparaît. |
| `listFields` | `TableColumnId[]` | Les colonnes de la vue liste. |
| `previewFields` | `TableFieldKey[]` | Les champs affichés lorsqu'un enregistrement de cette table est référencé depuis une autre. |
| `display` | `TableDisplay` | Ce qui remplit les attributs `title`, `subtitle`, `image`, `status`, `date` et `tags` d'un enregistrement : un chemin de champ ou un résolveur. Voir [emplacements d'affichage](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Colonnes calculées. Voir [Colonnes additionnelles](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Masque la colonne identifiant (id). |

Une colonne calculée accepte :

| Clé | Type | Effet |
|---|---|---|
| `key` | `string` | Identifie la colonne. Nommez-la dans `fieldOrder` avec `"total" as AdditionalFieldKey`. |
| `name` | `string` | L'en-tête. |
| `width` | `number` | La largeur, en pixels. |
| `Builder` | `(props) => ReactNode` | Restitue la cellule à partir de `{ row, id, context }`. |
| `dependencies` | chemin(s) de champ | Les champs dont la modification déclenche le nouveau rendu de la cellule. |
| `value` | `(props) => string \| number` | La valeur de la cellule, pour l'exportation. Peut être asynchrone. |

### Valeurs par défaut des requêtes

| Option | Type | Effet |
|---|---|---|
| `sort` | `OrderBySpec` | Le tri par défaut : `["publishDate", "desc"]`, ou plusieurs clés ordonnées. |
| `fixedFilter` | `FilterValues` | Un filtre que le visiteur ne peut pas modifier. |
| `defaultFilter` | `FilterValues` | Le filtre avec lequel un visiteur démarre. |
| `filterPresets` | `FilterPreset[]` | Filtres en un clic dans la barre d'outils : `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Charger par pages (`true`, ou la taille de la page), ou tout charger en une seule fois (`false`). |

Voir [Filtres et tri](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportement

| Option | Type | Effet |
|---|---|---|
| `inlineEditing` | `boolean` | Modifier les cellules directement dans la table. |
| `selectionEnabled` | `boolean` | Les lignes peuvent être sélectionnées. |
| `selectionController` | `SelectionController` | Une sélection que vous conservez en dehors de la vue (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Indique si la barre d'outils propose l'exportation, ainsi que des colonnes supplémentaires pour celle-ci. Voir [Importation et exportation](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Comment s'ouvre un enregistrement. |
| `defaultEntityAction` | `"view" \| "edit"` | Si le fait de cliquer sur un enregistrement l'ouvre en lecture ou en modification. |
| `sideDialogWidth` | `number \| string` | La largeur du panneau latéral dans lequel s'ouvre un enregistrement. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | L'onglet sur lequel un enregistrement s'ouvre. |

### Formulaire

| Option | Type | Effet |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Les sections, et le rail à côté du formulaire. Voir [Disposition du formulaire](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Un composant qui remplace le formulaire généré. `includeActions` conserve Enregistrer et Ignorer dans la barre de l'enregistrement. |
| `formAutoSave` | `boolean` | Enregistre au fur et à mesure que le visiteur saisit du texte. |
| `alwaysApplyDefaultValues` | `boolean` | Remplit les valeurs par défaut déclarées dans les champs vides d'un enregistrement stocké lors de son ouverture. |
| `includeJsonView` | `boolean` | Ajoute un onglet présentant l'enregistrement au format JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Conserve les modifications non enregistrées dans le stockage local. |
| `hideIdFromForm` | `boolean` | Masque l'identifiant (id) dans le formulaire. |

`form` prend :

| Clé | Type | Effet |
|---|---|---|
| `sidebar` | identifiants de champs | Les champs extraits et placés dans le rail à côté du formulaire. |
| `sections` | sections | Les sections de la colonne principale, ci-dessous. |
| `showRecordMeta` | `boolean` | Affiche l'identifiant et les horodatages de l'enregistrement dans le rail. |

Chaque section prend :

| Clé | Type | Effet |
|---|---|---|
| `key` | `string` | Identifie la section ; correspond également à l'`id` de son ancre. |
| `title` | `string` | L'en-tête. Aucun si omis. |
| `fields` | identifiants de champs | Les champs de la section, dans l'ordre. |
| `collapsed` | `boolean` | Démarre repliée. |
| `collapsible` | `boolean` | Peut être repliée. |
| `readVariant` | `"grid" \| "summary"` | Comment la section est présentée lorsque l'enregistrement est affiché plutôt que modifié. |

### Actions, vues et remplacements (overrides)

| Option | Type | Effet |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Actions sur un enregistrement. Un objet, ou la clé de l'une d'elles enregistrée sur `<RebaseCMS entityActions>`. Voir [Actions d'entité](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Actions intégrées que cette table ne propose pas. |
| `resetPasswordAction` | `false \| TableEntityAction` | <span class="since-badge" data-since="0.31">Depuis 0.31</span> La table d'authentification uniquement (`defineAuthTable`) : `false` supprime l'action intégrée de réinitialisation de mot de passe, une action la remplace (proposée quel que soit ce que l'adaptateur d'authentification prend en charge : son backend est le vôtre). Ignoré, avec un avertissement, sur toute autre table. |
| `entityViews` | `(string \| TableEntityView)[]` | Onglets supplémentaires sur un enregistrement. Voir [Vues d'entité](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Composants affichés dans la barre d'outils de la collection. |
| `components` | `TableComponentOverrides` | Remplacements de composants délimités à la collection, chacun sous la forme `{ Component, wrap? }`. Voir [Remplacements de composants](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks qui s'exécutent dans le panneau après les hooks du serveur. Présentation uniquement : ils sont envoyés à chaque visiteur et ne sécurisent rien. Voir [Hooks React](/docs/hooks/). |
| `fields` | `TableFields` | Options par champ, indexées par colonne ou relation. Ci-dessous. |

## Options de champ

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`fields.<key>` accepte les options que chaque champ prend en charge, plus celles
propres au type de sa colonne. [Champs](/docs/collections/properties/) présente
chacune d'elles avec le widget qu'elle modifie.

### Tout champ

| Option | Type | Effet |
|---|---|---|
| `name` | `string` | Le libellé. Dérivé de la clé sinon (`publishDate` → "Publish Date"). |
| `description` | `string` | Texte d'aide sous le champ. |
| `hidden` | `boolean` | Exclu des vues en table et en cartes. Toujours présent sur le formulaire, et toujours lu et écrit par l'API. |
| `hiddenInForm` | `boolean` | Exclu du formulaire. Toujours présent dans les vues. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Le contrôle est grisé. `disabledMessage` en explique la raison, à côté ; `clearOnDisabled` réinitialise la valeur lorsqu'elle devient désactivée. |
| `readOnly` | `boolean` | La valeur est affichée sous forme de texte, sans contrôle. |
| `Field` | `Component` | Remplace le contrôle du formulaire. Le composant lui-même. Voir [Champs personnalisés](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Remplace la façon dont la valeur est affichée en dehors du formulaire. |
| `Filter` | `Component` | Remplace le contrôle de filtre pour ce champ. |
| `columnWidth` | `number` | La largeur de la colonne dans la table, en pixels. |
| `filledByServer` | `boolean` | Un hook serveur la remplit lors de la création : le formulaire permet de créer un enregistrement sans elle. |
| `span` | `1 \| 2 \| 3 \| 4` | Le nombre de colonnes occupées sur les quatre de la grille du formulaire. |
| `customProps` | `unknown` | Transmis tels quels à vos composants `Field` et `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Restreint les opérateurs de filtrage proposés. `[]` désactive le filtrage pour ce champ. |
| `propertyConfig` | `string` | La clé d'un type de champ enregistré sur `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Règles JSON-logic qui masquent, désactivent ou rendent le champ obligatoire à partir des valeurs de l'enregistrement. Formulaire uniquement. Voir [conditions](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Renvoie les options de champ qui s'appliquent actuellement, à partir de l'enregistrement en cours de modification. Formulaire uniquement. |
| `metadata` | `Record<string, unknown>` | Vos propres données. |

### Colonnes de texte et uuid

| Option | Type | Effet |
|---|---|---|
| `multiline` | `boolean` | Un champ de saisie multiligne, qui s'agrandit avec son contenu. |
| `markdown` | `boolean` | Un éditeur Markdown avec prévisualisation. |
| `previewAsTag` | `boolean` | Affiché sous la forme d'une puce (chip) plutôt que de texte. |
| `clearable` | `boolean` | Ajoute un contrôle qui définit la valeur sur `null`. |
| `urlPreview` | `PreviewType \| boolean` | Comment une URL dans la valeur est prévisualisée : `"image"`, `"video"`, `"audio"`, `"file"`, ou `true` pour un lien. |
| `referenceTo` | `string` | La colonne contient la clé d'un enregistrement d'une autre collection, sur n'importe quelle source de données : elle est affichée et sélectionnée comme une référence vers le slug de cette collection. Voir [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Colonnes avec un ensemble fermé de valeurs

Un `col.enum([...])`, un `.oneOf([...])`, ou un tableau de l'un ou l'autre :

| Option | Type | Effet |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Libellés pour certaines des valeurs. Les valeurs omises conservent leur libellé et leur couleur dérivés. |
| `enumOrder` | `value[]` | L'ordre dans lequel les valeurs sont proposées et les colonnes kanban dessinées. L'ordre propre à la colonne sinon. |
| `previewAsTag` | `boolean` | Sur un `col.enum()` : affiché sous forme de puce. |
| `clearable` | `boolean` | Sur un `col.enum()` : ajoute un contrôle qui définit la valeur sur `null`. |

Un `EnumLabel` prend :

| Clé | Type | Effet |
|---|---|---|
| `label` | `string` | Le texte sur la puce et dans la sélection. |
| `color` | `ColorKey \| ColorScheme` | Une clé de couleur de puce (`"green"`, `"orangeDark"`) ou un schéma `{ color, text }`. Une valeur sans couleur conserve sa couleur initialement attribuée. |
| `disabled` | `boolean` | Affichée, mais non proposée à la sélection. |

### Colonnes numériques

| Option | Type | Effet |
|---|---|---|
| `clearable` | `boolean` | Ajoute un contrôle qui définit la valeur sur `null`. |
| `format` | `NumberFormatOptions` | Écrit le nombre sous forme de devise, de pourcentage ou avec des décimales fixes. |

`format` prend `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (un
code ISO, obligatoire avec `"currency"`), `locale` (celle du visiteur sinon),
`minimumFractionDigits`, `maximumFractionDigits` et `notation`
(`"standard"` ou `"compact"`, qui écrit `12000` sous la forme `12K`). Cela modifie
ce qui est affiché, jamais ce qui est stocké.

### Colonnes date, timestamp et time

| Option | Type | Effet |
|---|---|---|
| `clearable` | `boolean` | Ajoute un contrôle qui définit la valeur sur `null`. |
| `mode` | `"date" \| "date_time"` | Sélectionner et afficher uniquement un jour, ou un jour et une heure. Dérivé du type de colonne sinon. |
| `timezone` | `string` | Le fuseau horaire IANA dans lequel la valeur est affichée et sélectionnée (`"Europe/Madrid"`). Celui du visiteur sinon. |

### Colonnes vectorielles

| Option | Type | Effet |
|---|---|---|
| `clearable` | `boolean` | Ajoute un contrôle qui définit la valeur sur `null`. |

### Colonnes de stockage (storage)

| Option | Type | Effet |
|---|---|---|
| `storage` | `StorageCustomization` | Les fonctions d'envoi de fichiers (upload) qui s'exécutent dans le navigateur. |
| `clearable` | `boolean` | Ajoute un contrôle qui définit la valeur sur `null`. |
| `urlPreview` | `PreviewType \| boolean` | Comment l'URL stockée est prévisualisée. |

`storage` ne prend que des fonctions ; les options sérialisables restent sur
`col.storage({ … })` (voir [Téléchargements de fichiers](/docs/collections/file-uploads/)) :

| Clé | Signature | Effet |
|---|---|---|
| `path` | `(context) => string` | Le dossier dans lequel un fichier est téléversé, remplaçant le modèle `path` de la colonne. |
| `fileName` | `(context) => string \| Promise<string>` | Le nom du fichier stocké, remplaçant le modèle `fileName` de la colonne. |
| `processFile` | `(file) => Promise<File>` | Transforme un fichier avant son téléversement. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transforme le chemin ou l'URL stocké avant qu'il ne soit écrit dans la colonne. |
| `previewUrl` | `(fileName) => string` | L'URL pour prévisualiser un fichier stocké. |

### Colonnes tableau (array)

| Option | Type | Effet |
|---|---|---|
| `expanded` | `boolean` | Chaque élément est ouvert au chargement. |
| `minimalistView` | `boolean` | Éléments sans leur cadre ni leur en-tête. |
| `sortable` | `boolean` | Les éléments peuvent être réorganisés par glisser-déposer. |
| `canAddElements` | `boolean` | Des éléments peuvent être ajoutés. |
| `of` | options de champ | Les options de chaque élément. |
| `storage` | `StorageCustomization` | Les fonctions de téléversement, pour `col.storage().multiple()`. |

`enumLabels` et `enumOrder` définis sur un tableau s'appliquent à ses éléments.

### Colonnes JSON

| Option | Type | Effet |
|---|---|---|
| `expanded` | `boolean` | Les champs du document sont ouverts au chargement. |
| `minimalistView` | `boolean` | Les champs du document sans leur cadre. |
| `spreadChildren` | `boolean` | Les champs du document disposés comme s'ils appartenaient directement à l'enregistrement. |
| `keyValue` | `boolean` | Modifié sous la forme de paires clé/valeur libres. |
| `previewFields` | `string[]` | Les clés du document affichées dans sa prévisualisation. |
| `fields` | `{ [key]: options de champ }` | Les options de chaque clé du document. |
| `fieldOrder` | `string[]` | L'ordre dans lequel les clés du document sont affichées. |
| `of` | options de champ | Les options de chaque élément, pour un document qui est une liste. |
| `oneOf` | `{ [variant]: options de champ }` | Les options de chaque variante d'un bloc typé (`json.oneOf`). |

Avec `col.jsonb().$type<T>()` ou une forme `json.object({…})`, `fields` et
`fieldOrder` sont typés par les clés du document. Voir [Tableaux et JSON](/docs/collections/arrays-and-maps/).

### Relations

| Option | Type | Effet |
|---|---|---|
| `previewFields` | `string[]` | Les champs de la cible affichés dans la puce d'une ligne liée. Au maximum trois peuvent s'y insérer. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | La ou les lignes liées avec lesquelles le formulaire d'un nouvel enregistrement démarre : `new EntityRelation(id, "<slug cible>")` (`EntityRelation` provenant de `@rebasepro/cms-types`), ou une liste pour une relation à plusieurs (to-many). Écrit uniquement lors de l'enregistrement du formulaire. La valeur par défaut propre à une colonne est définie via `.default()` sur la colonne. |
| `widget` | `"select" \| "dialog"` | Comment une ligne liée est sélectionnée. |
| `fixedFilter` | `FilterValues` | Ne propose que les lignes qui valident ce filtre. |
| `includeId` | `boolean` | Affiche l'identifiant de la ligne liée dans les aperçus. |
| `includeEntityLink` | `boolean` | Affiche un lien qui ouvre la ligne liée. |
| `renderInForm` | `boolean` | Affiche également une relation to-many sous forme de sélecteur dans le formulaire, à côté de son onglet. |
| `overrides` | options de table sans `fields` | Comment la cible est présentée dans l'onglet de cette relation. |

Voir [Relations dans le panneau](/docs/collections/relations-in-the-admin-panel/).

## Personnalisations, `ui-config.json` et préférences

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Ce que le panneau affiche pour une table est composé selon un ordre précis,
chaque couche venant s'appliquer sur la précédente :

1. **La collection dérivée** : ce que le panneau lit depuis la table fournie par
   le serveur.
2. **Le code** : les résultats de `customizeTable` que vous transmettez via
   `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`** : la présentation de l'espace de
   travail telle que l'éditeur de collection l'a enregistrée lors du
   développement, transmise via `uiConfig`. Il s'agit d'un fichier dans le
   frontend, il est donc révisé et déployé avec lui.
4. **Préférences de l'espace de travail** : ce qu'un administrateur enregistre
   sur un déploiement, dans la table `rebase.ui_preferences` via
   [`/api/admin/ui-config`](/docs/backend/endpoints/). L'écriture de ces
   préférences nécessite `schema:write`.
5. **Préférences utilisateur** : les largeurs de colonnes propres à chaque
   personne, ses sélections de vue et ses colonnes masquées. Conservées dans le
   navigateur en dehors des sessions connectées.

Un fichier `App.tsx` généré contient déjà les liaisons nécessaires :

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Les préférences ne contiennent que des éléments de présentation : libellés,
icône, modes de vue, ordre des colonnes, colonnes masquées, libellés et couleurs
d'énumération, kanban et valeurs par défaut des requêtes. Aucun élément du schéma
n'y figure ; l'[éditeur de collection](/docs/studio/) les enregistre plutôt dans
`backend/schema`.

`rebase build` intègre `frontend/src/cms/ui-config.json` dans le bundle
(`entry.uiConfig`), de sorte qu'un backend déployé en a également connaissance :
`GET /api/admin/ui-config` le sert en tant que `shipped` aux côtés des couches
espace de travail et utilisateur, et les vues MCP ainsi que `describe_table`
fusionnent les trois mêmes couches — le fichier, l'espace de travail et celle de
l'appelant (aucune pour une clé API) — afin qu'un agent voie les libellés, l'ordre,
les colonnes masquées et les libellés d'énumération qu'une personne voit dans le panneau.

`rebase verify` analyse chaque appel à `customizeTable` dans `frontend/src/cms`
par rapport aux tables, sans l'exécuter : il détecte une personnalisation pour une
table ou un champ inexistant, une colonne obligatoire que le formulaire masque,
une table personnalisée deux fois, un `ui-config.json` qui n'est passé à aucun
`<RebaseCMS>`, et une configuration Vite sans `rebaseBackendGuard()`. Voir
[`rebase verify`](/docs/cli/#rebase-verify).

## Étapes suivantes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Comment les tables deviennent des collections](/docs/collections/) : ce que le panneau dérive avant toute personnalisation
- [Champs](/docs/collections/properties/) : le widget et les options associés à chaque type de colonne
- [Modes de vue](/docs/frontend/view-modes/) : table, cartes, kanban, emplacements d'affichage, filtres
- [Actions d'entité](/docs/frontend/entity-actions/) : `entityActions` et `updateRecord`
- [Firestore aux côtés de Postgres](/docs/frontend/firebase/) : `externalCollections` et références entre moteurs
