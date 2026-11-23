---
sourceHash: afe3986ede62abca
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable définit en quoi la collection d'une table diffère de ce que le CMS dérive : libellés, icône, vues, kanban, emplacements d'affichage, disposition du formulaire, actions et options par champ avec des composants React importés par valeur. Chaque option, avec son type et son effet."
---

Si vous utilisez le CMS, chaque table fournie par le backend possède déjà une collection dans
le panneau, dérivée de la table elle-même (voir
[comment les tables deviennent des collections](/docs/collections/)). `customizeTable` indique
ce qui doit être modifié, et rien d'autre. Il réside dans le frontend, aux côtés du reste
de votre code React, de sorte qu'un champ personnalisé est un composant que vous importez comme n'importe quel autre.

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

Passez le résultat à `<RebaseCMS tableCustomizations={[postsCms]}/>` ; consultez
[la vue d'ensemble du frontend](/docs/frontend/#rebasecms-props).

:::note[Vous venez des collections ?]
Il s'agit des options de présentation de l'ancien bloc `admin`, au niveau
supérieur et sous quelques nouveaux noms (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). L'utilisation d'un ancien nom lève
une erreur indiquant le nouveau.
:::

## Où se trouvent les fichiers

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Les noms sont une convention. Ce qui importe, c'est que les résultats parviennent à
`<RebaseCMS tableCustomizations>`. Une table sans fichier est affichée telle qu'elle est dérivée.

Le frontend importe uniquement le **type** de la table : `import type { posts }`. Un import
de type est effacé lors de la génération du bundle, de sorte que les hooks et le code serveur de
`backend/schema` n'atteignent jamais le navigateur. Un import de valeur depuis `backend/` dans
le code frontend est la seule chose à ne pas faire. Le backend n'importe jamais rien
depuis le frontend.

## Le slug et le type

Le premier argument est le slug de la table : le nom sous lequel elle a été définie, ou le
`slug` qui lui a été attribué. Avec la table comme argument de type, le slug, chaque clé
qui nomme un champ et chaque valeur d'enum sont vérifiés par rapport à la table :

| Vérifié par rapport à `typeof posts` | Une erreur correspond à |
|---|---|
| le premier argument | une erreur de type, sauf s'il s'agit du slug de la table |
| clés de `fields` | une clé de colonne ou un nom de relation |
| entrées de `fieldOrder`, `listFields`, `form` | un champ, un chemin avec points vers celui-ci (`"seo.title"`), `subcollection:<relation>`, ou la clé d'un champ additionnel |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | un champ ou un chemin vers un champ |
| `kanban.columnField` | une colonne contenant un ensemble fermé de chaînes (`col.enum([...])` ou `.oneOf([...])`) |
| `kanban.orderField` | une colonne de texte |
| `enumLabels`, `enumOrder` | les valeurs que la colonne peut contenir ; une colonne sans ensemble fermé n'accepte ni l'un ni l'autre |
| options de champ | celles du type de la colonne : `multiline` sur une colonne de texte, `format` sur un nombre |
| `entityActions[].onClick` et équivalents | `row` correspond au `InferRow` de la table |

`defineTable("blog_posts", { slug: "posts", … })` est personnalisé sous la forme
`customizeTable<typeof posts>("posts", …)` : toujours un seul argument de type. Sans
l'argument de type, `customizeTable("posts", { … })` accepte les mêmes options,
avec un typage lâche.

## Ce qui est refusé et ce qui est ignoré

`customizeTable` vérifie ce que le compilateur ne peut pas voir lors du chargement du module, et
lève une exception en indiquant ce qu'il faut écrire à la place :

- une option inconnue, en proposant la plus proche connue, ou avec le nouveau nom d'une ancienne
  option `admin` ;
- un composant fourni sous la forme d'un chemin en chaîne de caractères, un thunk lazy `() => import(…)` ou tout
  ce qui n'est pas un composant React ;
- une action d'entité sans `name` ou `onClick`, une vue personnalisée sans
  `Builder`, un `kanban` sans `columnField`, un `referenceTo` qui n'est pas un slug ;
- `fields` à l'intérieur des `overrides` d'une relation : personnalisez la table cible avec son
  propre `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Le résultat est gelé (frozen). Passer deux personnalisations du même slug à
`<RebaseCMS>` lève une exception : celle qui l'emporterait dépendrait de l'ordre d'import.

Ce que le serveur renvoie peut différer de ce par rapport à quoi vous avez écrit le code. Une colonne peut être
masquée pour cet appelant (voir [accès aux champs](/docs/collections/field-access/)),
ou la table a pu changer depuis. Ce n'est pas une erreur à l'exécution. En
développement, le panneau affiche un avertissement par incohérence et l'ignore :

- une personnalisation dont le slug ne correspond à aucune table servie est ignorée ;
- un champ, une entrée de colonne, un emplacement d'affichage, une entrée de formulaire ou un champ kanban que la table
  ne fournit pas est abandonné ;
- une option qui ne s'applique pas au type du champ (`format` sur une colonne de texte,
  `enumLabels` sur un champ sans ensemble fermé) est ignorée.

Le reste de la personnalisation s'applique toujours.

## Options de la table

Chaque clé est facultative. Une clé omise conserve ce que le panneau a dérivé.

### Identité et navigation

| Option | Type | Effet |
|---|---|---|
| `name` | `string` | Le libellé pluriel : tiroir de navigation, titre de la page. Dérivé du nom de la table sinon. |
| `singularName` | `string` | Le libellé d'un enregistrement unique. |
| `description` | `string` | Affiché sous le titre et sur la carte d'accueil. |
| `metadata` | `Record<string, unknown>` | Vos propres données, fusionnées avec les `metadata` de la table. |
| `icon` | `string \| ReactNode` | Un nom d'icône Lucide (`"FileText"`) ou un élément. |
| `group` | `string` | Le groupe de navigation. |
| `hideFromNavigation` | `boolean` | Absent du tiroir. Toujours accessible par URL et comme cible de référence. |
| `hideFromEntityViews` | `boolean` | N'est pas proposé comme onglet sur les enregistrements des tables qui lui sont liées. |

### Vues

| Option | Type | Effet |
|---|---|---|
| `defaultViewMode` | `ViewMode` | La vue sur laquelle arrive un visiteur : `"list"`, `"table"`, `"cards"`, `"kanban"` ou la clé d'une vue personnalisée. `"list"` par défaut. |
| `enabledViews` | `ViewMode[]` | Les vues proposées dans le sélecteur. |
| `kanban` | `{ columnField, orderField? }` | Le tableau kanban : la colonne sur laquelle il effectue le regroupement et la colonne de texte dans laquelle il stocke les clés d'ordre. Voir [Modes de vue](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | D'autres façons de rendre les lignes : `{ key, name, Builder }`, ou la clé d'une vue enregistrée sur `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | La hauteur de ligne par défaut. |

`kanban` prend deux clés :

| Clé | Type | Effet |
|---|---|---|
| `columnField` | clé de colonne | La colonne dont proviennent les colonnes du tableau : un `col.enum([...])` ou `.oneOf([...])` de chaînes de caractères. |
| `orderField` | clé de colonne de texte | L'endroit où la position d'une carte au sein de sa colonne est stockée, sous la forme d'une clé d'ordre fractionnaire. Sans elle, l'ordre est réinitialisé à chaque lecture. La colonne est masquée et désactivée, sauf si son entrée `fields` en dispose autrement. |

### Colonnes et emplacements

| Option | Type | Effet |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | L'ordre dans lequel les champs sont affichés. Les champs omis suivent, donc rien ne disparaît. |
| `listFields` | `TableColumnId[]` | Les colonnes du tableau et de la vue en liste : les champs qu'elles affichent, et aucun autre. Le tableau les ordonne selon `fieldOrder` (ou l'ordre défini par glisser-déposer de l'utilisateur) s'il existe, selon `listFields` sinon. Les champs omis restent présents sur l'enregistrement. |
| `previewFields` | `TableFieldKey[]` | Les champs affichés lorsqu'un enregistrement de cette table est référencé depuis une autre. |
| `display` | `TableDisplay` | Ce qui remplit les propriétés `title`, `subtitle`, `image`, `status`, `date` et `tags` d'un enregistrement : un chemin de champ ou un résolveur. Voir [emplacements d'affichage](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Colonnes calculées de la table. Non présentes sur l'enregistrement sauf si `form.sections` ou `form.sidebar` en nomme une. Voir [Colonnes additionnelles](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Masque la colonne id. |

Une colonne calculée prend :

| Clé | Type | Effet |
|---|---|---|
| `key` | `string` | Identifie la colonne. Nommez-la dans `fieldOrder` sous la forme `"total" as AdditionalFieldKey`. |
| `name` | `string` | L'en-tête. |
| `width` | `number` | La largeur, en pixels. |
| `Builder` | `(props) => ReactNode` | Rend la cellule à partir de `{ row, id, context }`. |
| `dependencies` | chemin(s) de champ | Les champs dont la modification déclenche un nouveau rendu de la cellule. |
| `value` | `(props) => string \| number` | La valeur de la cellule, pour l'export. Peut être asynchrone. |

### Valeurs par défaut de requête

| Option | Type | Effet |
|---|---|---|
| `sort` | `OrderBySpec` | Le tri par défaut : `["publishDate", "desc"]`, ou plusieurs clés dans l'ordre. |
| `fixedFilter` | `FilterValues` | Un filtre que le visiteur ne peut pas modifier. |
| `defaultFilter` | `FilterValues` | Le filtre initial appliqué pour le visiteur. |
| `filterPresets` | `FilterPreset[]` | Filtres en un clic dans la barre d'outils : `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Chargement par pages (`true`, ou la taille de la page), ou tout charger d'un coup (`false`). |

Voir [Filtres et tri](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportement

| Option | Type | Effet |
|---|---|---|
| `inlineEditing` | `boolean` | Modifier les cellules directement dans la table. |
| `selectionEnabled` | `boolean` | Les lignes peuvent être sélectionnées. |
| `selectionController` | `SelectionController` | Une sélection gérée en dehors de la vue (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Indique si la barre d'outils propose l'exportation, et des colonnes supplémentaires pour celle-ci. Voir [Import et export](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | La façon dont un enregistrement s'ouvre. |
| `defaultEntityAction` | `"view" \| "edit"` | Détermine si cliquer sur un enregistrement l'ouvre en lecture ou en édition. |
| `sideDialogWidth` | `number \| string` | La largeur du panneau latéral dans lequel s'ouvre un enregistrement. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | L'onglet sur lequel un enregistrement s'ouvre par défaut. |

### Formulaire

| Option | Type | Effet |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Sections, et barre latérale à côté du formulaire. Voir [Disposition du formulaire](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Un composant qui remplace le formulaire généré. `includeActions` conserve Enregistrer et Abandonner dans la barre de l'enregistrement. |
| `formAutoSave` | `boolean` | Enregistre au fur et à mesure de la saisie par le visiteur. |
| `alwaysApplyDefaultValues` | `boolean` | Remplit les valeurs par défaut déclarées dans les champs vides d'un enregistrement stocké lors de son ouverture. |
| `includeJsonView` | `boolean` | Ajoute un onglet avec l'enregistrement au format JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Conserve les modifications non enregistrées dans le stockage local. |
| `hideIdFromForm` | `boolean` | Masque l'identifiant du formulaire. |

`form` prend :

| Clé | Type | Effet |
|---|---|---|
| `sidebar` | identifiants de champ | Les champs extraits dans le volet latéral à côté du formulaire. |
| `sections` | sections | Les sections de la colonne principale, ci-dessous. |
| `showRecordMeta` | `boolean` | Affiche l'identifiant et les horodatages de l'enregistrement dans le volet latéral. |

Chaque section prend :

| Clé | Type | Effet |
|---|---|---|
| `key` | `string` | Identifie la section ; constitue également l'`id` de son ancre. |
| `title` | `string` | Le titre. Aucun si omis. |
| `fields` | identifiants de champ | Les champs de la section, dans l'ordre. |
| `collapsed` | `boolean` | Commence repliée. |
| `collapsible` | `boolean` | Peut être repliée. |
| `readVariant` | `"grid" \| "summary"` | La façon dont la section s'affiche lorsque l'enregistrement est visualisé plutôt qu'édité. |

### Actions, vues et surcharges

| Option | Type | Effet |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Actions sur un enregistrement. Un objet, ou la clé d'une action enregistrée sur `<RebaseCMS entityActions>`. Voir [Actions d'entité](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Actions intégrées que cette table ne propose pas. |
| `resetPasswordAction` | `false \| TableEntityAction` | Table d'authentification uniquement (`defineAuthTable`) : `false` supprime l'action de réinitialisation de mot de passe intégrée, une action la remplace (proposée quel que soit le support de l'adaptateur d'authentification : son backend vous appartient). Ignoré, avec un avertissement, sur toute autre table. |
| `entityViews` | `(string \| TableEntityView)[]` | Onglets supplémentaires sur un enregistrement. Voir [Vues d'entité](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Composants affichés dans la barre d'outils de la collection. |
| `components` | `TableComponentOverrides` | Surcharges de composants à l'échelle de la collection, chacune sous la forme `{ Component, wrap? }`. Voir [Surcharges de composants](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks qui s'exécutent dans le panneau après les hooks du serveur. Présentation uniquement : ils sont envoyés à chaque visiteur et ne sécurisent rien. Voir [Hooks React](/docs/hooks/). |
| `fields` | `TableFields` | Options par champ, indexées par colonne ou relation. Ci-dessous. |

## Options des champs

`fields.<key>` prend les options communes à chaque champ, plus celles de son
type de colonne. [Champs](/docs/collections/properties/) présente chacun d'eux avec le widget qu'il
modifie.

### Tous les champs

| Option | Type | Effet |
|---|---|---|
| `name` | `string` | Le libellé. Dérivé de la clé sinon (`publishDate` → "Publish Date"). |
| `description` | `string` | Texte d'aide sous le champ. |
| `hidden` | `boolean` | Exclu des vues table, liste et cartes, et de l'enregistrement : son formulaire et sa vue en lecture. Reste lu et écrit par l'API. |
| `hiddenInForm` | `boolean` | Exclu de l'enregistrement (son formulaire et sa vue en lecture). Toujours présent dans les vues. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Le contrôle est grisé. `disabledMessage` en explique la raison à côté ; `clearOnDisabled` efface la valeur lorsqu'il devient désactivé. |
| `readOnly` | `boolean` | La valeur est affichée sous forme de texte, sans contrôle interactif. |
| `Field` | `Component` | Remplace le contrôle du formulaire. Le composant lui-même. Voir [Champs personnalisés](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Remplace la façon dont la valeur est affichée en dehors du formulaire. |
| `Filter` | `Component` | Remplace le contrôle de filtre pour ce champ. |
| `columnWidth` | `number` | La largeur de la colonne dans le tableau, en pixels. |
| `filledByServer` | `boolean` | Un hook serveur le remplit à la création : le formulaire permet de créer un enregistrement sans lui. Une colonne marquée `.serverDefault()` dans son `defineTable` l'est déjà ; ne définissez ceci que pour surcharger la table (`false` le rend à nouveau requis). |
| `span` | `1 \| 2 \| 3 \| 4` | Nombre de colonnes qu'il occupe sur les quatre de la grille du formulaire. |
| `customProps` | `unknown` | Transmis sans modification à vos composants `Field` et `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Restreint les opérateurs de filtre proposés. `[]` désactive le filtrage pour ce champ. |
| `propertyConfig` | `string` | La clé d'un type de champ enregistré sur `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Règles JSON-logic qui masquent, désactivent ou rendent le champ obligatoire selon les valeurs de l'enregistrement. Formulaire uniquement. Voir [conditions](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Renvoie les options de champ applicables actuellement, à partir de l'enregistrement en cours d'édition. Formulaire uniquement. |
| `metadata` | `Record<string, unknown>` | Vos propres données. |

### Colonnes de texte et uuid

| Option | Type | Effet |
|---|---|---|
| `multiline` | `boolean` | Un champ de saisie multiligne, qui s'agrandit avec son contenu. |
| `markdown` | `boolean` | Un éditeur Markdown avec prévisualisation. |
| `previewAsTag` | `boolean` | Affiché sous forme de puce/badge (chip) plutôt que de texte. |
| `clearable` | `boolean` | Ajoute un contrôle qui définit la valeur à `null`. |
| `urlPreview` | `PreviewType \| boolean` | Façon dont une URL contenue dans la valeur est prévisualisée : `"image"`, `"video"`, `"audio"`, `"file"`, ou `true` pour un lien. |
| `referenceTo` | `string` | La colonne contient la clé d'un enregistrement d'une autre collection, sur n'importe quelle source de données : elle est affichée et sélectionnée comme référence au slug de cette collection. Voir [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Colonnes avec un ensemble fermé de valeurs

Un `col.enum([...])`, un `.oneOf([...])`, ou un tableau de l'un ou l'autre :

| Option | Type | Effet |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Libellés pour certaines des valeurs. Les valeurs omises conservent leur libellé et leur couleur dérivés. |
| `enumOrder` | `value[]` | L'ordre dans lequel les valeurs sont proposées et les colonnes kanban affichées. L'ordre propre de la colonne sinon. |
| `previewAsTag` | `boolean` | Sur un `col.enum()` : affiché sous forme de puce/badge (chip). |
| `clearable` | `boolean` | Sur un `col.enum()` : ajoute un contrôle qui définit la valeur à `null`. |

Un `EnumLabel` prend :

| Clé | Type | Effet |
|---|---|---|
| `label` | `string` | Le texte sur le badge et dans le sélecteur. |
| `color` | `ColorKey \| ColorScheme` | Une clé de couleur de badge (`"green"`, `"orangeDark"`) ou un schéma `{ color, text }`. Une valeur sans couleur conserve sa couleur d'origine. |
| `disabled` | `boolean` | Affiché, mais non disponible à la sélection. |

### Colonnes numériques

| Option | Type | Effet |
|---|---|---|
| `clearable` | `boolean` | Ajoute un contrôle qui réinitialise la valeur à `null`. |
| `format` | `NumberFormatOptions` | Affiche le nombre sous forme de devise, de pourcentage ou avec des décimales fixes. |

`format` prend `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (un
code ISO, requis avec `"currency"`), `locale` (celle de l'utilisateur par défaut),
`minimumFractionDigits`, `maximumFractionDigits` et `notation`
(`"standard"` ou `"compact"`, qui écrit `12000` sous la forme `12K`). Il modifie ce qui est
affiché, jamais ce qui est stocké.

### Colonnes de date, timestamp et time

| Option | Type | Effet |
|---|---|---|
| `clearable` | `boolean` | Ajoute un contrôle qui réinitialise la valeur à `null`. |
| `mode` | `"date" \| "date_time"` | Sélectionne et affiche un jour uniquement, ou un jour et une heure. Dérivé du type de colonne sinon. |
| `timezone` | `string` | Le fuseau horaire IANA dans lequel la valeur est affichée et sélectionnée (`"Europe/Madrid"`). Celui de l'utilisateur sinon. |

### Colonnes de vecteurs

| Option | Type | Effet |
|---|---|---|
| `clearable` | `boolean` | Ajoute un contrôle qui réinitialise la valeur à `null`. |

### Colonnes de stockage

| Option | Type | Effet |
|---|---|---|
| `storage` | `StorageCustomization` | Les fonctions de téléversement qui s'exécutent dans le navigateur. |
| `clearable` | `boolean` | Ajoute un contrôle qui réinitialise la valeur à `null`. |
| `urlPreview` | `PreviewType \| boolean` | Comment l'URL stockée est prévisualisée. |

`storage` ne prend que des fonctions ; les options sérialisables restent sur
`col.storage({ … })` (voir [Téléchargements de fichiers](/docs/collections/file-uploads/)) :

| Clé | Signature | Effet |
|---|---|---|
| `path` | `(context) => string` | Le dossier vers lequel un fichier est téléversé, remplaçant le modèle `path` de la colonne. |
| `fileName` | `(context) => string \| Promise<string>` | Le nom du fichier stocké, remplaçant le modèle `fileName` de la colonne. |
| `processFile` | `(file) => Promise<File>` | Transforme un fichier avant son téléversement. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transforme le chemin ou l'URL stocké avant qu'il ne soit écrit dans la colonne. |
| `previewUrl` | `(fileName) => string` | L'URL pour prévisualiser un fichier stocké. |

### Colonnes de tableaux (array)

| Option | Type | Effet |
|---|---|---|
| `expanded` | `boolean` | Chaque élément est ouvert au chargement. |
| `minimalistView` | `boolean` | Éléments sans leur cadre ni leur en-tête. |
| `sortable` | `boolean` | Les éléments peuvent être réordonnés par glisser-déposer. |
| `canAddElements` | `boolean` | Des éléments peuvent être ajoutés. |
| `of` | options de champ | Les options de chaque élément. |
| `storage` | `StorageCustomization` | Les fonctions de téléversement, pour `col.storage().multiple()`. |

`enumLabels` et `enumOrder` définis sur un tableau s'appliquent à ses éléments.

### Colonnes JSON

| Option | Type | Effet |
|---|---|---|
| `expanded` | `boolean` | Les champs du document sont ouverts au chargement. |
| `minimalistView` | `boolean` | Les champs du document sont présentés sans leur cadre. |
| `spreadChildren` | `boolean` | Les champs du document sont disposés comme s'il s'agissait des champs propres à l'enregistrement. |
| `keyValue` | `boolean` | Modifié sous forme de paires clé/valeur libres. |
| `previewFields` | `string[]` | Les clés du document citées dans son résumé sur une ligne, dans cet ordre. |
| `fields` | `{ [key]: options de champ }` | Les options de chaque clé du document. |
| `fieldOrder` | `string[]` | L'ordre dans lequel les clés du document sont affichées. |
| `of` | options de champ | Les options de chaque élément, pour un document qui est une liste. |
| `oneOf` | `{ [variant]: options de champ }` | Les options de chaque variante d'un bloc typé (`json.oneOf`). |

Avec `col.jsonb().$type<T>()` ou une structure `json.object({…})`, `fields` et `fieldOrder`
sont typés d'après les clés du document. Voir [Tableaux et JSON](/docs/collections/arrays-and-maps/).

Dans une cellule de tableau, une ligne de liste ou une carte, un document JSON occupe une seule ligne : ses quatre
premières clés de niveau supérieur (ou ses `previewFields`), étiquetées avec leur `name`, chacune
avec sa valeur lorsqu'il s'agit d'un texte court, d'un nombre ou d'un booléen (oui/non), `3 items` pour
une liste et `4 fields` pour un objet imbriqué, qui n'est pas développé. Une liste de
documents affiche son décompte. Le document entier est présent sur l'enregistrement et dans l'éditeur
déroulant de la cellule. Pour un meilleur affichage sur une ligne, désignez les clés importantes dans
`previewFields`, ou associez au champ un composant `Preview`.

### Relations

| Option | Type | Effet |
|---|---|---|
| `previewFields` | `string[]` | Les champs de la cible affichés dans le badge pour une ligne associée. Au maximum trois peuvent y figurer. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | La ou les lignes associées avec lesquelles commence le formulaire d'un nouvel enregistrement : `new EntityRelation(id, "<target slug>")` (`EntityRelation` issu de `@rebasepro/cms-types`), ou une liste pour une relation to-many. Écrit uniquement lorsque le formulaire est enregistré. La valeur par défaut propre à une colonne se configure via `.default()` sur la colonne. |
| `widget` | `"select" \| "dialog"` | La manière dont une ligne liée est sélectionnée. |
| `fixedFilter` | `FilterValues` | Ne proposer que les lignes qui passent ce filtre. |
| `includeId` | `boolean` | Afficher l'identifiant de la ligne liée dans les prévisualisations. |
| `includeEntityLink` | `boolean` | Afficher un lien qui ouvre la ligne liée. |
| `renderInForm` | `boolean` | Afficher également une relation to-many sous forme de sélecteur dans le formulaire, à côté de son onglet. |
| `overrides` | options de table sans `fields` | Comment la cible est présentée dans l'onglet de cette relation. |

Voir [Relations dans le panneau](/docs/collections/relations-in-the-admin-panel/).

## Personnalisations, `ui-config.json` et préférences

Ce que le panneau affiche pour une table est composé selon un ordre fixe, chaque couche venant
se superposer à la précédente :

1. **La collection dérivée** : ce que le panneau déduit de la table fournie par le serveur.
2. **Le code** : les résultats de `customizeTable` que vous transmettez via `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`** : la présentation de l'espace de travail,
   transmise via `uiConfig`. Il s'agit d'un fichier dans le frontend, édité manuellement (ou par
   votre agent), ce qui permet de le réviser et de le déployer avec le reste.
4. **Préférences de l'espace de travail** : ce qu'un administrateur enregistre sur un déploiement, dans la
   table `rebase.ui_preferences` via
   [`/api/admin/ui-config`](/docs/backend/endpoints/). L'écriture de ces préférences nécessite
   `schema:write`.
5. **Préférences utilisateur** : les largeurs de colonne, changements de vue et
   colonnes masquées propres à chaque personne. Conservées dans le navigateur en l'absence de session connectée.

Un fichier `App.tsx` généré contient déjà cette configuration :

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Les préférences ne contiennent que des éléments de présentation : libellés, icône, modes de vue, ordre des colonnes,
colonnes masquées, libellés et couleurs d'enum, kanban et valeurs par défaut des requêtes. Aucun élément
du schéma ne s'y trouve ; ceux-ci résident dans `backend/schema`.

`rebase build` intègre `frontend/src/cms/ui-config.json` dans le bundle
(`entry.uiConfig`), de sorte qu'un backend déployé le connaît également : `GET /api/admin/ui-config`
le sert sous l'attribut `shipped` aux côtés des couches de l'espace de travail et de l'utilisateur, et les vues MCP
ainsi que `describe_table` fusionnent ces trois mêmes couches — le fichier, l'espace de travail, et
celle propre à l'appelant (aucune pour une clé d'API) — afin qu'un agent voie les libellés, l'ordre,
les colonnes masquées et les libellés d'enum qu'une personne voit dans le panneau.

`rebase verify` analyse chaque appel à `customizeTable` dans `frontend/src/cms` par rapport
aux tables, sans l'exécuter : il détecte une personnalisation ciblant une table ou un
champ inexistant, une colonne obligatoire que le formulaire masquerait, une table
personnalisée deux fois, un fichier `ui-config.json` transmis à aucun `<RebaseCMS>`, ainsi qu'une
configuration Vite dépourvue de `rebaseBackendGuard()`. Voir [`rebase verify`](/docs/cli/#rebase-verify).

## Étapes suivantes

- [Comment les tables deviennent des collections](/docs/collections/) : ce que le panneau dérive avant toute intervention
- [Champs](/docs/collections/properties/) : widget et options de chaque type de colonne
- [Modes de vue](/docs/frontend/view-modes/) : table, cartes, kanban, emplacements d'affichage, filtres
- [Actions d'entité](/docs/frontend/entity-actions/) : `entityActions` et `updateRecord`
- [Firestore aux côtés de Postgres](/docs/frontend/firebase/) : `externalCollections` et références inter-moteurs
