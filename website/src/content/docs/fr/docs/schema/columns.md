---
sourceHash: b2705ba2e3901257
title: Colonnes
sidebar_label: Colonnes
description: "Chaque constructeur et modificateur col.* : le type Postgres créé, le type lu et écrit par un client, et ce que l'API applique — nullabilité, valeurs par défaut, stamps, validation, ensembles de valeurs fermés, accès et stockage."
---

Une colonne est un constructeur `col.*`, affiné par des modificateurs. Le constructeur détermine le type Postgres ; les modificateurs définissent tout le reste : si la colonne peut être nulle, sa valeur par défaut, sa validation, et qui peut la lire et l'écrire.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        sku:       col.varchar({ length: 32 }).notNull().unique(),
        name:      col.text().notNull().validate({ min: 2, max: 120, trim: true }),
        price:     col.numeric({ precision: 10, scale: 2 }).notNull().validate({ min: 0 }),
        status:    col.enum(["draft", "active", "retired"]).notNull().default("draft"),
        tags:      col.text().array().validate({ maxItems: 10 }),
        photo:     col.storage({ path: "products/", accept: ["image/*"], maxBytes: "5MB" }),
        createdBy: col.uuid().onCreateUser().readOnly(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
    },
    rls: "admin-only",
});
```

Les constructeurs sont immuables : chaque modificateur renvoie un nouveau constructeur, de sorte qu'une colonne peut être déclarée une seule fois et partagée entre plusieurs tables.

Après le point, la syntaxe d'une colonne ressemble à celle de `pg-core` de [Drizzle](https://orm.drizzle.team/docs/column-types/pg) : les mêmes noms de constructeurs, un nom de colonne SQL facultatif en premier, puis l'objet de configuration de Drizzle, puis le chaînage — `col.varchar({ length: 32 })`, `col.timestamp({ withTimezone: true })`, `col.text().array()`, `` .default(sql`now()`) ``. Une syntaxe Drizzle qui aurait une autre signification ici ne compilera pas, et l'erreur indiquera quoi écrire à la place. Deux différences sont à garder à l'esprit :

- **Une clé étrangère est une relation.** Déclarez-la sous `relations` : `author: rel.belongsTo(() => users, { localKey: "author_id" })`. La clé de la relation correspond à ce que nomme `include`. `.references()` n'existe pas et l'indique explicitement. Voir [Relations](/docs/collections/relations/).
- **`.defaultNow()` est uniquement une valeur par défaut en base de données** : `DEFAULT now()`, qu'un client peut toujours écraser. `.onCreateNow()` est un [stamp](#stamps) serveur : le serveur écrit la date/heure à la création, peu importe ce que le client a envoyé.

## Constructeurs

Un constructeur par type Postgres. Le type réseau est ce qu'un client lit dans une ligne et envoie lors d'une écriture, et la manière dont le SDK et [`InferRow`](/docs/schema/types/) typent la colonne. Chaque constructeur accepte un nom de colonne SQL facultatif comme premier argument (`col.text("legacy_title")`) ; sans lui, le nom SQL correspond au snake_case de la clé.

| Constructeur | Type Postgres | Type réseau | Remarques |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` pour `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` n'accepte que ces valeurs ; voir [Ensembles de valeurs fermés](#ensembles-de-valeurs-fermés) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | la longueur est requise ; accepte aussi `enum` |
| `col.char({ length })` | `CHAR(n)` | `string` | la longueur est requise ; accepte aussi `enum` |
| `col.enum(values)` | un type enum Postgres, `<table>_<column>` | l'union de `values` | voir [Ensembles de valeurs fermés](#ensembles-de-valeurs-fermés) |
| `pgEnum(name, values)`, puis `status()` | un type enum Postgres nommé | l'union de `values` | chaque colonne qui l'utilise partage ce même type |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | lu et écrit comme un nombre JavaScript |
| `col.smallserial()` | `SMALLSERIAL` | `number` | a une valeur par défaut ; préférez `col.smallint().generatedByDefaultAsIdentity()` dans un nouveau schéma |
| `col.serial()` | `SERIAL` | `number` | a une valeur par défaut ; préférez `col.integer().generatedByDefaultAsIdentity()` |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | a une valeur par défaut ; préférez `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | une échelle nécessite une précision ; `col.decimal()` est le même constructeur |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | une écriture accepte également une `Date` ; un timestamp sans fuseau horaire s'écrit `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | une écriture accepte également une `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | une écriture accepte également une `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (`.$type<T>()` le type), ou le type de la forme | voir [Documents JSON](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | comme `jsonb` | conserve le texte fourni ; préférez `jsonb` |
| `<builder>.array()` | `<inner>[]` | un tableau du type réseau interne | `col.text().array()` ; pas de tableaux de tableaux ; voir [Tableaux](#tableaux) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | un index HNSW cosinus sauf si `index` indique le contraire ; voir [Recherche vectorielle](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (le chemin du fichier) | `.multiple()` en fait un `TEXT[]` ; voir [Colonnes de stockage](#colonnes-de-stockage) |
| `col.custom({ dataType })` | tout autre type Postgres, tel quel (`"inet"`, `"citext"`) | `string` (`.$type<T>()` le type) | Rebase nomme le type dans le DDL et transmet les valeurs telles quelles |

## Modificateurs

Chaque constructeur dispose du premier groupe. Les autres n'existent que sur les constructeurs pour lesquels ils ont du sens ; en appeler un ailleurs constitue une erreur de type.

| Modificateur | Sur | Base de données | API et types |
|---|---|---|---|
| `.notNull()` | toutes les colonnes | `NOT NULL` | jamais `null` sur une ligne ; requis à la création sauf s'il a une valeur par défaut |
| `.primaryKey()` | toutes les colonnes | composant de la clé primaire, `NOT NULL` | absent du type `Update` |
| `.unique()` | toutes les colonnes | `UNIQUE` sur une seule colonne | un doublon renvoie une `409` |
| `.default(value)` | toutes les colonnes | `DEFAULT <valeur>` | également appliqué par le pilote à la création ; facultatif à la création |
| `` .default(sql`expr`) `` | toutes les colonnes | `DEFAULT <expr>` | facultatif à la création ; `sql` est importé aux côtés de `col` |
| `.dbDefault()` | toutes les colonnes | laisse intacte la valeur par défaut existante en base | facultatif à la création |
| `.serverDefault()` | toutes les colonnes | aucun | un hook le renseigne ; facultatif à la création, et le formulaire du panneau d'administration ne l'exige pas |
| `` .generatedAlwaysAs(sql`expr`) `` | toutes les colonnes | `GENERATED ALWAYS AS (<expr>) STORED` | jamais modifiable en écriture, par qui que ce soit |
| `.$type<T>()` | toutes les colonnes | aucun | type la valeur pour TypeScript uniquement, comme dans Drizzle |
| `.array()` | toutes les colonnes | `<type>[]` | voir [Tableaux](#tableaux) |
| `.readOnly()` | toutes les colonnes | aucun | écritures client refusées ; absent de `Insert` et `Update` |
| `.private()` | toutes les colonnes | aucun | jamais exposé sur le réseau, dans le SDK ou dans OpenAPI |
| `.access({ read?, write? })` | toutes les colonnes | aucun | lecture et écriture par rôle ; voir [Accès aux champs](/docs/collections/field-access/) |
| `.describe(text)` | toutes les colonnes | aucun | la description dans OpenAPI et MCP |
| `.validate(rules)` | toutes les colonnes | aucun | vérifié avant chaque écriture ; les règles dépendent du type, voir [Validation](#validation) |
| `.transform({ beforeSave?, afterRead? })` | toutes les colonnes | aucun | hooks au niveau du champ ; `value` est `T \| null` sauf si `.notNull()` précède ; voir [Hooks de table](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | colonnes numériques | aucun | seules ces valeurs sont acceptées ; typé comme leur union (une colonne texte utilise `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | facultatif à la création |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | facultatif à la création |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | facultatif à la création ; un client peut toujours envoyer une valeur |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | le serveur enregistre l'heure à la création |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` et un trigger `BEFORE UPDATE` | le serveur enregistre l'heure à la création et à chaque mise à jour |
| `.onCreateUser()` | colonnes texte, `col.uuid()` | aucun | le serveur écrit l'identifiant de l'appelant à la création |
| `.onUpdateUser()` | colonnes texte, `col.uuid()` | aucun | le serveur écrit l'identifiant de l'appelant à chaque écriture |
| `.userId()` | colonnes texte, `col.uuid()` | aucun | la colonne contient l'identifiant d'un utilisateur ; le panneau propose un sélecteur d'utilisateurs ; voir [Colonnes utilisateur](#colonnes-utilisateur) |
| `.multiple()` | `col.storage()` | `TEXT[]` | la colonne contient plusieurs chemins de fichiers |

## Null, obligatoire et valeurs par défaut

Les colonnes acceptent les valeurs nulles par défaut. `.notNull()` et `.primaryKey()` rendent une colonne `NOT NULL`, et l'API l'exige alors à la création sauf si elle possède une valeur par défaut. Une colonne `NOT NULL` est de type `T` sur une ligne ; toute autre colonne est de type `T | null`.

Une valeur par défaut correspond à `.default()`, `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()`, `.serverDefault()`, `.defaultRandom()`, `.generatedByDefaultAsIdentity()`, un stamp ou un constructeur serial. Une colonne dotée d'une valeur par défaut peut être omise lors d'une création :

```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.integer().primaryKey().generatedByDefaultAsIdentity(),
        code:     col.text().notNull().default(sql`gen_short_id()`),
        priority: col.smallint().notNull().default(3),
        legacy:   col.text().dbDefault(),
    },
    rls: "admin-only",
});
```

- **`.default(value)`** est inscrit en tant que `DEFAULT` de la colonne et est également appliqué par le pilote lors de la création, de sorte qu'une ligne est identique quel que soit l'auteur de l'insertion. Une colonne temporelle accepte également un objet `Date`, stocké sous forme de chaîne ISO. La valeur par défaut d'une colonne enum doit être l'une de ses valeurs.
- **`` .default(sql`expression`) ``** est évalué par Postgres. L'expression est écrite telle quelle dans le DDL, le tag `sql` ne prend donc pas de `${…}`. `.defaultNow()` équivaut à `` .default(sql`now()`) ``.
- **`.dbDefault()`** indique que la base de données contient déjà une valeur par défaut non précisée dans le schéma. Une création peut omettre la colonne, et un déploiement du schéma (`schema push`) ne supprime pas la valeur par défaut.
- **`.serverDefault()`** indique que le code serveur propre à la table remplit la colonne lorsqu'une création l'omet : un `hooks.beforeSave` qui génère un slug à partir du titre, ou le `.transform()` de la colonne. Un hook étant du code invisible de l'extérieur, la colonne explicite ainsi son comportement. Aucune valeur par défaut n'est inscrite dans le DDL ; une création peut omettre la colonne, OpenAPI ne l'indique pas comme requise, et le formulaire du panneau d'administration permet de créer un enregistrement sans la fournir (aucun `filledByServer` nécessaire dans la personnalisation).

`.generatedAlwaysAs()` ne peut pas avoir de valeur par défaut ni de stamp : Postgres calcule la colonne à chaque écriture. Une colonne de clé primaire ne peut pas être `.private()`.

## Stamps

Un stamp est une valeur que le serveur écrit de lui-même dans une colonne. Il écrase tout ce qu'un client pourrait envoyer pour cette colonne.

| Stamp | Écrit | Quand |
|---|---|---|
| `.onCreateNow()` | la date/heure actuelle | à la création |
| `.onUpdateNow()` | la date/heure actuelle | à la création et à chaque mise à jour |
| `.onCreateUser()` | l'identifiant de l'utilisateur appelant | à la création |
| `.onUpdateUser()` | l'identifiant de l'utilisateur appelant | à la création et à chaque mise à jour |

Une colonne ne peut contenir qu'un seul stamp. En appeler un second différent lève une erreur au chargement du module ; `.onUpdateNow()` à lui seul applique déjà un stamp à la ligne lors de sa création. Les colonnes à stamp restent nullables à moins de spécifier `.notNull()`.

`.onCreateUser()` permet d'attribuer sa valeur à une colonne qu'une règle de sécurité au niveau des lignes (RLS) compare avec l'appelant (`ownerField`). Une colonne remplie par l'appelant est une colonne sur laquelle l'appelant peut mentir.

## Colonnes utilisateur

`.userId()` indique qu'une colonne contient l'identifiant d'un utilisateur. Il s'agit d'une sémantique, pas d'un type : la colonne reste de type `text` (ou `varchar`, `char`, `uuid`), et le descripteur fourni par le serveur porte la mention `semantic: "user"`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        subject: col.text().notNull(),
        assignedTo: col.text().userId().describe("Team member assigned to this ticket"),
        watchers: col.text().userId().array()
    },
    rls: "admin-only"
});
```

Deux conséquences en découlent :

- Le panneau d'administration affiche un sélecteur d'utilisateur pour la colonne au lieu d'un champ texte, et présente l'utilisateur plutôt que l'identifiant brut.
- Un appelant autorisé à écrire dans la table peut rechercher des utilisateurs pour la renseigner. La lecture du sélecteur lui répond même lorsque la sécurité au niveau des lignes lui masque les enregistrements des autres utilisateurs.

Cela fonctionne sur `col.text()`, `col.varchar()`, `col.char()` et `col.uuid()`, sur les éléments d'un tableau (`col.text().userId().array()`), ainsi que sur `json.string()` à l'intérieur d'un [document JSON](/docs/schema/json/). Partout ailleurs, cela lève une erreur au chargement du module. Cela ne déclare aucune clé étrangère : écrivez `rel.belongsTo(() => users)` lorsque la base de données doit en faire respecter une. Pour que le serveur renseigne la colonne avec l'identifiant de l'appelant, utilisez plutôt un [stamp](#stamps).

## Validation

`.validate(rules)` accepte les règles correspondant au type de la colonne. L'API les vérifie avant chaque création ou mise à jour et refuse l'écriture avec une erreur `400` en nommant la colonne. Appeler `.validate()` deux fois fusionne les règles.

| Règle | Colonnes texte et `col.storage()` | Colonnes numériques | `timestamptz`, `date`, `time` | Tableaux |
|---|---|---|---|---|
| `min`, `max` | longueur | bornes inclusives | valeur la plus ancienne et la plus récente (chaîne ISO ou `Date`) | |
| `length` | longueur exacte | | | |
| `matches`, `matchesFlags`, `matchesMessage` | un motif (chaîne ou `RegExp`) et l'erreur | | | |
| `email`, `url` | la valeur est une adresse e-mail ou une URL | | | |
| `trim`, `lowercase`, `uppercase` | la valeur est normalisée avant d'être stockée | | | |
| `lessThan`, `moreThan` | | bornes exclusives | | |
| `positive`, `negative`, `integer` | | signe, entier | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | nombre d'éléments, sans doublons |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` est le message d'erreur retourné lors d'une création si une colonne `.notNull()` sans valeur par défaut est omise. Tous les autres types de colonnes (`uuid`, `enum`, `boolean`, JSON, `vector`, `bytea`, `geopoint`) n'acceptent que `requiredMessage`.

Une `RegExp` est stockée sous la forme de sa source et de ses indicateurs (flags), et une borne `Date` sous la forme de sa chaîne ISO, de sorte que les règles transmises sur le réseau sont celles que le serveur vérifie.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const signups = defineTable("signups", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        email:    col.text().notNull().validate({ email: true, lowercase: true, trim: true, requiredMessage: "Enter your e-mail address." }),
        handle:   col.varchar({ length: 32 }).validate({ matches: /^[a-z0-9_]+$/, matchesMessage: "Lower-case letters, digits and _ only." }),
        age:      col.smallint().validate({ integer: true, min: 13 }),
        birthday: col.date().validate({ max: "2013-01-01" }),
    },
    rls: "admin-only",
});
```

Sur `col.varchar({ length })` et `col.char({ length })`, la longueur est appliquée par Postgres et par l'API. Un `max` qui en différerait entrerait en contradiction avec celle-ci ; indiquez la longueur une seule fois.

## Ensembles de valeurs fermés

Deux façons de n'accepter que certaines valeurs :

- **Un type enum Postgres**, afin que la base de données applique également la contrainte. `col.enum(values)` en crée un nommé `<table>_<column>`. Un type doté du nom de votre choix, partagé entre plusieurs colonnes, se déclare une seule fois avec `pgEnum(name, values)` — comme dans Drizzle — et s'appelle dans chaque colonne : `postStatus()`. Deux déclarations portant le même nom doivent lister les mêmes valeurs dans le même ordre.
- **Un ensemble vérifié par l'API**, sans type Postgres : `{ enum: [...] }` sur `col.text()`, `col.varchar()` ou `col.char()`, et `.oneOf(values)` sur une colonne numérique. C'est également la syntaxe à utiliser pour un tableau de chaînes connues : `col.text({ enum: ["a", "b"] }).array()`.

Tous typent la colonne comme l'union de leurs valeurs : `status` ci-dessous est `"draft" | "published"` sur la ligne, `kind` est `"news" | "guide"`, et `rating` est `1 | 2 | 3 | 4 | 5`.

```ts
import { defineTable, col, pgEnum } from "@rebasepro/server/schema";

const reviewStatus = pgEnum("review_status", ["draft", "published"]);

export const reviews = defineTable("reviews", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: reviewStatus().notNull().default("draft"),
        kind:   col.text({ enum: ["news", "guide"] }),
        rating: col.smallint().notNull().oneOf([1, 2, 3, 4, 5]),
        labels: col.text({ enum: ["bug", "praise", "question"] }).array(),
    },
    rls: "admin-only",
});
```

Les libellés et les couleurs associés aux valeurs relèvent de la présentation. Ils appartiennent au CMS, pas à la table.

## Tableaux

`.array()` crée un tableau Postgres du type de la colonne, comme dans Drizzle : `col.text().array()` correspond à `TEXT[]`, `col.integer().array()` à `INTEGER[]`. Ce qui est chaîné avant `.array()` décrit chaque élément : son `{ enum }`, son `.validate()`, son `.oneOf()`, ses options de stockage et son `.transform()`. Ce qui vient après décrit la colonne de tableau : son propre `.validate()` accepte `minItems`, `maxItems` et `uniqueItems`.

Les modificateurs qui décrivent une colonne (`.notNull()`, une valeur par défaut, `.unique()`, `.access()`) se placent après `.array()` — `col.text().array().notNull().default([])` ; placés avant, ils ne compilent pas. Un tableau de tableaux est refusé ; utilisez `col.jsonb()` pour les listes imbriquées. Un tableau contient des scalaires — texte, `uuid`, nombres, booléens, dates, enums : un `.array()` de `jsonb`, `json`, `vector`, `bytea`, geopoints ou `col.custom()` est refusé, et une liste de documents, de points ou de vecteurs s'exprime par `col.jsonb(json.array(…))`. Un type de liste personnalisé est nommé tel quel : `col.custom({ dataType: "inet[]" })`.

Chaque élément est restitué selon la façon dont son type l'est sur une colonne scalaire : un élément de `timestamptz[]` sous forme de chaîne RFC 3339, un élément de `numeric[]` sous forme de nombre, et un élément nul sous forme de `null`.

## Clés, identité et serials

`.generatedByDefaultAsIdentity()` transforme une colonne d'entiers en `GENERATED BY DEFAULT AS IDENTITY`. C'est la forme recommandée pour une clé entière dans un nouveau schéma (`.generatedAlwaysAsIdentity()` ne compile pas : Rebase crée uniquement des identités by default). Les constructeurs serial (`col.smallserial()`, `col.serial()`, `col.bigserial({ mode: "number" })`) existent pour les schémas qui les utilisent déjà ; une colonne pointant vers une clé serial est un entier simple de même taille. Voir [Clés primaires](/docs/schema/#primary-keys) pour les clés composites.

`col.bigint({ mode: "number" })` est lu et écrit comme un `number` JavaScript (le `mode: "bigint"` de Drizzle ne compile pas), ce qui est exact jusqu'à 2⁵³ − 1. `col.numeric()` est également un `number`, de sorte qu'il transporte la précision d'un double sur le réseau, quelle que soit la précision stockée par Postgres.

## Qui peut lire et écrire une colonne

La sécurité au niveau des lignes (RLS) détermine les lignes auxquelles un appelant a accès. Trois modificateurs restreignent ce qu'il peut voir d'une ligne et ce qu'il peut modifier :

- **`.readOnly()`** refuse toute écriture client sur la colonne, à la création comme à la mise à jour, quel que soit le rôle de l'appelant. La base de données (une valeur par défaut, un trigger) et le code serveur peuvent toujours la renseigner. La colonne est absente des types `Insert` et `Update`.
- **`.private()`** conserve la colonne sur le serveur : absente de chaque ligne sur le réseau, du SDK et d'OpenAPI, et refusée dans les filtres et les tris. Les hooks et le code serveur continuent de la voir. Une colonne privée ne peut pas également déclarer `.access()`.
- **`.access({ read, write })`** liste les rôles qui reçoivent la colonne et ceux qui peuvent l'écrire. Omettre une liste délègue cette direction au niveau de la ligne ; une liste vide l'interdit à tous les appelants.

[Accès aux champs](/docs/collections/field-access/) détaille ce qu'un appelant voit lorsqu'une colonne lui est masquée, ainsi que tous les points d'entrée auxquels la règle s'applique.

## Colonnes de stockage

`col.storage(options)` contient le chemin d'un fichier dans un bucket de stockage. La route d'upload applique `accept` et `maxBytes`, et le nettoyage des fichiers orphelins considère le fichier comme référencé tant qu'une ligne conserve son chemin. `.multiple()` permet à la colonne de contenir plusieurs chemins (`TEXT[]`).

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const listings = defineTable("listings", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        cover:  col.storage({ path: "listings/{id}/", accept: ["image/*"], maxBytes: "10MB",
                              imageResize: { maxWidth: 1600, format: "webp", quality: 80 } }),
        photos: col.storage({ path: "listings/{id}/gallery/", accept: ["image/*"] }).multiple(),
        terms:  col.storage({ path: "listings/terms/", accept: ["application/pdf"], public: true }),
    },
    rls: "admin-only",
});
```

| Option | Description |
|---|---|
| `path` | **Requis.** Emplacement des fichiers, sous forme de modèle de chemin : `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | Le bucket, déclaré dans `backend/resources.ts`. Le bucket par défaut en cas d'omission. |
| `accept` | Types MIME acceptés, avec caractères génériques : `["image/*", "application/pdf"]`. |
| `maxBytes` | La taille maximale de fichier acceptée : un nombre d'octets, ou une taille telle que `"10MB"`, `"512 kb"`, `"1.5GB"`. Multiples binaires : 1 Mo vaut 1 048 576 octets. Une taille non lisible lève une erreur. |
| `imageResize` | Redimensionner les images avant de les stocker : `maxWidth`, `maxHeight`, `mode` (`"contain"` ou `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | Les fichiers sont lisibles sans URL signée. |
| `fileName` | Le nom du fichier stocké, sous forme de modèle. Le nom d'origine lors de l'upload en cas d'omission. |
| `metadata` | Métadonnées stockées avec chaque fichier. |
| `includeBucketUrl` | Stocker l'URL du bucket devant le chemin. |
| `storeUrl` | Stocker l'URL de téléchargement à la place du chemin. |

Une colonne de stockage accepte les règles de validation d'une colonne de texte. Un fichier au sein d'un document JSON s'écrit `json.storage()`, avec les mêmes options ; voir [Documents JSON](/docs/schema/json/). Les autorisations d'upload et de download selon les chemins relèvent de [l'autorisation de stockage](/docs/backend/storage-authorization/) ; la distribution et la mise en cache des fichiers sont traitées dans [Stockage](/docs/backend/storage/).

## Ce qui est refusé

Au chargement du module, un constructeur lève une erreur dans les cas suivants :

- `col.varchar()` ou `col.char()` sans longueur ; une valeur `length` ou `dimensions` qui n'est pas un nombre entier positif, et `col.numeric({ scale })` sans précision ;
- `col.enum([])`, `pgEnum(name, { … })`, et un `.array()` d'un tableau ;
- une valeur par défaut `sql` ou une expression générée comportant une interpolation ;
- un deuxième stamp différent sur une même colonne, et `.oneOf()` avec une valeur qui n'est ni une chaîne ni un nombre ;
- `.access()` dont `read` ou `write` n'est pas une liste de noms de rôles non vides ;
- `col.storage()` sans `path`, ou avec un `maxBytes` qui ne correspond pas à une taille valide.

À la compilation du schéma, la table est refusée dans les cas suivants :

- une valeur par défaut combinée à `.generatedAlwaysAs()`, ou un stamp combiné à celui-ci ;
- `.generatedByDefaultAsIdentity()` sur une colonne non entière, `.defaultRandom()` sur une colonne non-`uuid`, un stamp temporel sur une colonne non temporelle, un stamp utilisateur sur une colonne qui n'est ni texte ni `uuid` ;
- une clé primaire `.private()`, ou une clé primaire de type `timestamptz` ou `time` ;
- une clé primaire sur une colonne `jsonb`, `json`, geopoint, `vector`, `bytea`, tableau ou liste personnalisée : une clé doit être un scalaire (texte, `varchar`, `char`, `uuid`, un enum, un nombre, un booléen ou une date). `schema introspect` ignore une table ayant une clé de ce type et en indique la raison ;
- un `.array()` de `jsonb`, `json`, `vector`, `bytea`, geopoints ou `col.custom()` (voir [Tableaux](#tableaux)) ;
- une règle `.validate()` que le type de colonne, ses éléments ou un nœud JSON ne vérifie pas (`integer` sur une colonne texte, `trim` sur un nombre, `minItems` sur un scalaire) ;
- une colonne à la fois `.private()` et `.access()` ;
- un `.transform()` sur une colonne et un autre sur sa forme JSON ;
- un `col.custom({ dataType })` dont le nom de type n'a pas la forme d'un nom de type Postgres ;
- `.oneOf([])`, et `.oneOf()` sur une colonne qui n'est ni texte ni numérique ;
- un enum avec une valeur vide ou en double, ou une valeur par défaut qui ne fait pas partie de ses valeurs ;
- deux clés qui résolvent vers la même colonne SQL, y compris une fois que Postgres a tronqué les noms à 63 octets ;
- un type enum nommé auquel sont fournies deux listes de valeurs différentes.

Chaque refus indique la table, la colonne et ce qu'il convient d'écrire à la place.

Les syntaxes Drizzle qui signifieraient autre chose ici ne compilent pas, et le compilateur affiche ce qu'il faut écrire : `col.timestamp()` sans `withTimezone: true`, `.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`, `.unique("name")`, le `mode: "string"` de `numeric`, ainsi que `col.inet()`, `col.interval()` et les autres types que Rebase nomme uniquement via `col.custom({ dataType })`.

## Prochaines étapes

- [Documents JSON](/docs/schema/json/) : la forme d'une colonne `jsonb`
- [Relations](/docs/collections/relations/) : les clés étrangères proviennent de `rel.*`, pas des colonnes
- [Accès aux champs](/docs/collections/field-access/) : `.access()`, `.private()` et `.readOnly()` en détail
- [Inférence de types](/docs/schema/types/) : l'effet de chaque modificateur sur `InferRow` et `InferInsert`
