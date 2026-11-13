---
sourceHash: 23be8a1faf1d5f49
title: Documents JSON
sidebar_label: Documents JSON
description: "Typez une colonne jsonb avec col.jsonb().$type<T>(), ou donnez-lui une structure avec json.* afin que le serveur valide les champs imbriqués, applique les valeurs par défaut et les horodatages, trouve les fichiers référencés par un document et recherche à l'intérieur de celui-ci."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une colonne `jsonb` peut être déclarée de deux manières. `col.jsonb().$type<T>()` type le document
pour TypeScript et n'indique rien au serveur à son sujet. `col.jsonb(shape)` prend une
structure construite avec `json.*`, ce qui type le document de la même manière et
le décrit également au serveur.

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const pages = defineTable("pages", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),

        // Typed for TypeScript only.
        settings: col.jsonb().$type<{ theme?: "light" | "dark"; pinned?: boolean }>(),

        // Typed, and known to the server.
        seo: col.jsonb(json.object({
            title:        json.string().validate({ max: 60 }).required(),
            canonicalUrl: json.string().validate({ url: true }),
            noIndex:      json.boolean().default(false),
        })),
    },
    rls: "admin-only",
});
```

Avec une structure, le serveur :

- **valide** chaque champ avant une écriture, avec les mêmes règles qu'une colonne ;
- **applique des valeurs par défaut** aux champs absents lors de la création ;
- **estampille** les champs de date avec `.onCreateNow()` / `.onUpdateNow()`, et les champs utilisateur avec `.onCreateUser()` / `.onUpdateUser()`, à n'importe quelle profondeur ;
- **exécute** les hooks `.transform()` de chaque champ ;
- **trouve les fichiers** référencés par un document (`json.storage()`), afin que le
  balayage des orphelins les prenne en compte ;
- **peut effectuer des recherches** à l'intérieur du document : un champ `search` peut désigner un chemin tel que
  `"seo.title"` (voir [Recherche](/docs/backend/search/)).

La structure est fournie avec le descripteur de la table, permettant au CMS de construire un formulaire pour
le document sans configuration supplémentaire. `col.jsonb().$type<T>()` obtient à la place
un éditeur JSON générique.

## Constructeurs

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Constructeur | Contient | Type TypeScript |
|---|---|---|
| `json.string()` | une chaîne de caractères | `string` |
| `json.number()` | un nombre | `number` |
| `json.boolean()` | un booléen | `boolean` |
| `json.date()` | un instant, sous forme de chaîne ISO | `string` |
| `json.geopoint()` | un point géographique sur Terre | `{ latitude: number; longitude: number }` |
| `json.storage(options)` | le chemin d'un fichier stocké | `string` |
| `json.object(fields, { additional? })` | un objet avec des clés connues | un type d'objet : champs requis obligatoires, le reste optionnel |
| `json.array(of)` | un tableau d'une seule structure | un tableau du type de `of` |
| `json.oneOf(variants, { typeField?, valueField? })` | un bloc typé | une union de `{ type: "<variant>"; value: <son type> }` |
| `json.unknown()` | n'importe quoi | `unknown` |

`json.storage()` accepte les mêmes options que [`col.storage()`](/docs/schema/columns/#storage-columns).
`json.object(fields, { additional: true })` accepte également des clés qu'il ne nomme pas.

## Modificateurs

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Modificateur | S'applique à | Description |
|---|---|---|
| `.required()` | chaque champ | La clé doit être présente dans le document. Rend la clé obligatoire dans le type. |
| `.default(value)` | chaque champ | La valeur écrite lorsque la clé est absente lors de la création. |
| `.describe(text)` | chaque champ | Description de la valeur, pour OpenAPI et MCP. |
| `.validate(rules)` | chaque champ | Les règles acceptées par une colonne du même type : règles de texte sur `json.string()`, règles numériques sur `json.number()`, bornes de date sur `json.date()`, nombre d'éléments, `uniqueItems` et `uniqueBy` sur `json.array()`. Voir [Validation](/docs/schema/columns/#validation). |
| `.transform({ beforeSave?, afterRead? })` | chaque champ | Hooks au niveau du champ, exécutés sur le serveur. `value` est `T \| undefined` sauf si `.required()` est placé avant. |
| `.oneOf(values)` | `json.string()`, `json.number()` | Un ensemble fermé de valeurs acceptées, typé comme leur union. |
| `.onCreateNow()` | `json.date()` | Le serveur écrit la date/heure actuelle lors de la création de la ligne. |
| `.onUpdateNow()` | `json.date()` | Le serveur écrit la date/heure actuelle à chaque écriture. |
| `.onCreateUser()` | `json.string()` | Le serveur écrit l'ID de l'utilisateur actif lors de la création de la ligne, ou `null` si aucun utilisateur n'agit. |
| `.onUpdateUser()` | `json.string()` | Le serveur écrit l'ID de l'utilisateur actif à chaque écriture. |
| `.userId()` | `json.string()` | La valeur est l'ID d'un utilisateur : le panneau propose un sélecteur d'utilisateur, et un appelant autorisé à écrire dans la table peut rechercher des utilisateurs pour le renseigner. Voir [Colonnes utilisateur](/docs/schema/columns/#user-columns). |

Les champs sont optionnels sauf mention contraire avec `.required()`. Une clé obligatoire l'est
également dans le type TypeScript :

```ts
import { col, json } from "@rebasepro/server/schema";

const address = json.object({
    street:  json.string().required(),
    city:    json.string().required(),
    country: json.string().validate({ length: 2, uppercase: true }).required(),
    notes:   json.string(),
});

// { street: string; city: string; country: string; notes?: string }
const shipping = col.jsonb(address);
```

### Estampilles au sein d'un document

Les estampilles fonctionnent à n'importe quelle profondeur d'une colonne JSON : champs d'objets,
chaque élément de tableau et la valeur d'un élément `oneOf` dont le `type` nomme la
variante. Lors d'une création, les objets manquants sur le chemin menant à une estampille sont créés.
Lors d'une mise à jour, seuls les champs `onUpdate*` sont estampillés, et uniquement à l'intérieur
d'un document envoyé par la mise à jour ; un document non envoyé conserve sa valeur stockée.
Une estampille remplace tout ce qui a été envoyé par l'écriture, et le `.default()` d'un
champ le remplit en premier.

## Tableaux et blocs typés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`json.array(of)` est une liste d'une même structure. `json.oneOf(variants)` est un bloc dont
la clé `type` indique de quelle variante il s'agit et dont la clé `value` contient le contenu
de cette variante. En tant qu'éléments d'un tableau, il s'agit de la structure d'un éditeur de blocs :

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.jsonb(json.array(json.oneOf({
            paragraph: json.string(),
            image:     json.storage({ path: "articles/images/", accept: ["image/*"] }),
            quote:     json.object({ text: json.string().required(), author: json.string() }),
        }))),
    },
    rls: "admin-only",
});
```

Le champ `body` d'une ligne est alors typé comme un tableau de :

```ts
type Block =
    | { type: "paragraph"; value: string }
    | { type: "image"; value: string }
    | { type: "quote"; value: { text: string; author?: string } };
```

`json.array(json.object({...})).validate({ uniqueBy: ["sku"] })` refuse deux
éléments qui partagent une valeur dans un champ nommé (`unique_by` ; les valeurs
absentes et `null` ne sont pas comparées, et un `$push` vérifie les éléments ajoutés
entre eux). `validate({ uniqueItems: true })` refuse deux éléments identiques.
La racine d'un document peut elle-même être un scalaire ou un `json.oneOf`, et
`json.unknown()` représente un champ acceptant n'importe quelle valeur JSON ; le serveur vérifie chaque structure
lors des écritures REST, MCP et socket.

`typeField` et `valueField` permettent de renommer les deux clés, pour les documents qui utilisent déjà
d'autres noms : `json.oneOf({ … }, { typeField: "kind", valueField: "data" })`.

## `jsonb` ou `json`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`col.json()` prend les mêmes arguments que `col.jsonb()`. Il stocke le texte tel qu'il a été
fourni, ordre des clés et espaces compris, et ne peut pas être indexé ou faire l'objet de recherches
comme `jsonb`. Ne l'utilisez que si le texte exact a de l'importance ; sinon, utilisez
`col.jsonb()`.

Un point sur Terre a son propre constructeur de colonne, `col.geopoint()`, stocké sous forme de `jsonb`.
Une liste de valeurs simples que Postgres doit indexer est souvent préférable sous la forme d'une
colonne de tableau : `col.text().array()`. Les listes imbriquées ont leur place dans `jsonb` : un `.array()`
d'un tableau est refusé.

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Colonnes](/docs/schema/columns/) : les constructeurs de colonnes et leurs règles de validation
- [Recherche](/docs/backend/search/) : rechercher des chemins au sein d'un document
- [Hooks de table](/docs/collections/callbacks/) : `.transform()` et les hooks au niveau de la table
