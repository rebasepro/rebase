---
sourceHash: 86856f16dce196a2
title: Relationen
sidebar_label: Relations
description: Definieren Sie 1:1-, 1:n- und m:n-SQL-Relationen zwischen Collections mit Fremdschlüsseln, Junction-Tabellen und Multi-Hop-Joins.
---

## Übersicht

Relationen definieren, wie Collections auf Datenbankebene miteinander verknüpft sind. Sie ermöglichen es Rebase:

- **Relations-Auswahlfelder (Picker)** in Entitätsformularen darzustellen
- **Verknüpfte Entitäten** beim Rendern von Vorschauen aufzulösen
- **Foreign-Key-Constraints** im Drizzle-Schema zu generieren
- **Cascade-Delete/Update-Verhalten** zu unterstützen

Relationen können entweder inline innerhalb der Property oder explizit im `relations`-Array einer Collection definiert werden:

### 1. Inline-Relationen (Empfohlen)

Deklarieren Sie die Verknüpfung direkt auf der Property, geschachtelt unter `relation`. Wählen Sie den `kind`-Typ, und der Typ stellt exakt die Felder bereit, die dieser Typ benötigt.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: {
            type: "relation",
            name: "Author",
            relation: {
                kind: "belongsTo",
                target: () => usersCollection
            }
        }
    }
});
```

### 2. Explizites Relations-Array

Für eine Verknüpfung ohne eigene Property – also ohne Bezeichnung im Formular oder in einer Tabellenspalte – deklarieren Sie diese in `relations`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    properties: {
        name: { type: "string", name: "Name" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection
        }
    ]
});
```

## Die fünf Arten (Kinds)

Eine Relation gehört zu einer von fünf Arten. Die Art bestimmt, wo der Schlüssel liegt, ob eine oder mehrere Zeilen zurückgegeben werden und was ein Schreibzugriff über die Relation modifizieren darf.

| Kind | Schlüssel liegt | Rückgabe | Hinweise |
|---|---|---|---|
| `belongsTo` | in **dieser** Tabelle | eine | `localKey`, Standardwert ist `<relationName>_id` |
| `hasOne` | in der Tabelle des **Ziels** | eine | `foreignKeyOnTarget`, Standardwert ist der Singular dieser Collection plus `_id` (`users` → `user_id`) |
| `hasMany` | in der Tabelle des **Ziels** | viele | Untergeordnete Zeilen gehören ausschließlich diesem übergeordneten Datensatz |
| `manyToMany` | in einer **Junction-Tabelle** | viele | Zeilen werden geteilt; die Verknüpfung gehört Ihnen |
| `via` | ein expliziter `joinPath` | beides | beschreibbar bei Single-Hop, ansonsten schreibgeschützt; `cardinality` muss selbst angegeben werden |

Jedes Feld ist optional, mit Ausnahme von `kind` und `target` (sowie bei `via` zusätzlich `cardinality` und `joinPath`) – der Rest wird abgeleitet.

### belongsTo — der Schlüssel liegt in dieser Tabelle

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

Die Spalte wird automatisch für Sie indexiert: Postgres indexiert den Schlüssel, auf den ein Foreign Key verweist, niemals jedoch die Spalte, die ihn enthält. Ohne Index würde jedes `hasMany`-Include und jede verschachtelte Auflistung von der anderen Seite diese Tabelle sequentiell scannen. `index: false` behält den Constraint bei und entfernt den Index – siehe [Foreign keys are indexed for you](/docs/backend/indexes#foreign-keys-are-indexed-for-you) für Fälle, in denen sich das lohnt, und für Fälle, in denen Rebase dies automatisch überspringt, weil bereits ein anderer Index die Spalte abdeckt.

### hasMany / hasOne — der Schlüssel liegt in der Zieltabelle

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → liest posts.user_id
```

`hasOne` ist dieselbe Verknüpfung mit maximal einer Zeile auf der Gegenseite.

#### Verknüpfung über einen natürlichen Schlüssel (Natural Key)

Standardmäßig enthält der Fremdschlüssel des Ziels die **id** der Quellzeile. Wenn die beiden Seiten über etwas anderes verknüpft sind – eine externe Identity-ID, eine SKU, einen Mandanten-Slug –, benennen Sie diese Spalte mit `sourceKey`:

```typescript
relations: [
    {
        kind: "hasMany",
        relationName: "applications",
        target: () => applicationsCollection,
        sourceKey: "auth_user_id",          // Spalte in DIESER Tabelle
        foreignKeyOnTarget: "auth_user_id"  // Spalte in der ZIEL-Tabelle
    }
]
// → liest applications.auth_user_id = talents.auth_user_id
```

`sourceKey` ist das Gegenstück zu `localKey` bei `belongsTo`: Letzterer benennt die Spalte, *von* der diese Seite liest, ersterer die Spalte, auf die die andere Seite *zeigt*. Ohne ihn lässt sich eine Verknüpfung wie die obige überhaupt nicht als `hasMany` abbilden und muss auf [`via`](#via--eine-explizite-join-kette) zurückfallen, was für eine solche Kette schreibgeschützt ist.

Die Spalte muss eindeutig sein. Eine Verknüpfung, die mehr als eine Quellzeile adressiert, kann nicht bestimmen, zu welcher davon eine verknüpfte Zeile gehört, und Postgres akzeptiert auch keinen Foreign Key auf eine nicht eindeutige Spalte. Rebase prüft dies beim Lesen und bricht ab, anstatt willkürlich eine auszuwählen.

Ein übergeordneter Datensatz, dessen `sourceKey` `NULL` ist, erreicht keine Zeilen, und Schreibzugriffe über die Relation erzeugen einen Fehler – es gibt nichts, worauf die verknüpften Zeilen verweisen könnten.

### manyToMany — über eine Junction-Tabelle

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → Junction-Tabelle `posts_tags` (beide Tabellennamen, sortiert), Spalten post_id / tag_id
```

Beide Seiten deklarieren ihre eigene Relation, und jede schreibt `through` **aus der eigenen Perspektive** – `sourceColumn` benennt immer *diese* Collection:

```typescript
// auf posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// auf tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — eine explizite Join-Kette

Für Verknüpfungen, die die vier obigen Formen nicht ausdrücken können: Multi-Hop-Pfade, zusammengesetzte Schlüssel (Composite Keys) oder Joins, deren Bedingung kein einfacher Fremdschlüssel ist.

Eine **Single-Hop**-Kette ist über ein Create oder Update beschreibbar, genau wie die Art, die sie vertritt:

- eine **to-one**-Kette mit **einem Schritt** – die Zielzeile enthält den Schlüssel, daher verweist `{ badge: "b-1" }` diese Spalte auf diesen Datensatz und `null` hebt die Verknüpfung auf, genau wie ein `hasOne`-Schreibzugriff;
- eine **to-many**-Kette mit **zwei Schritten über eine Tabelle** zwischen den Enden – diese Tabelle enthält die Verknüpfungen, daher setzt `{ tags: ["t-1", "t-2"] }` sie als deren Zeilen, genau wie ein `manyToMany`-Schreibzugriff (ein `via` überträgt kein `_pivot`).

Alles darüber hinaus ist **schreibgeschützt (read-only)**: Rebase leitet nicht automatisch ab, wie über eine beliebige Kette geschrieben werden soll. Ein Create oder Update, das eine solche Kette anspricht, wird mit `400 RELATION_NOT_WRITABLE` abgelehnt, und das Admin-Formular zeigt das Feld ohne Picker an. Ein verschachtelter Schreibzugriff (`PATCH users/1/permissions/3`) über ein beliebiges `via` wird auf dieselbe Weise abgelehnt.

```typescript
{
    kind: "via",
    relationName: "permissions",
    target: () => permissionsCollection,
    cardinality: "many",
    joinPath: [
        { table: "user_roles",       on: { from: "id",            to: "user_id" } },
        { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
        { table: "permissions",      on: { from: "permission_id", to: "id" } }
    ]
}
```

## Relations-Properties

Um ein Relationsfeld in einem Formular darzustellen, fügen Sie eine Property mit `type: "relation"` hinzu:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        // Welches Steuerelement gezeichnet wird, ist Darstellungssache und gehört in den admin-Block:
        // "select" (Dropdown) oder "dialog" (vollständiger Picker).
        admin: { widget: "select" }
    }
}
```

Beim Rendern einer Vorschau (wie in einer Tabellenzelle oder einem Referenz-Chip) übernimmt Rebase die Hydratisierung automatisch.

### To-One erhält einen Picker, Many erhält einen Tab

Die Kardinalität bestimmt die Darstellungsoberfläche, und es wird immer nur eine Oberfläche verwendet:

- **`belongsTo` / `hasOne`** — eine Zeile, daher ist die Property ein Foreign Key, den der Autor bearbeitet. Sie wird wie oben als Picker dargestellt.
- **`hasMany` / `manyToMany`** — viele Zeilen, daher listet die Entitätsansicht sie als eigenen **Tab** auf. Die Property wird nicht im Formular gerendert: Die Kindelemente einer Collection sind eine Liste, kein einzelner Wert, den der Datensatz hält, und eine Auswahl über ein Dropdown ist im Formular nicht sinnvoll abbildbar.

Es lohnt sich dennoch, eine Many-Relation als Property zu deklarieren – dadurch wird der Tab benannt und die Relation erhält eine Spalte in der Collection-Tabelle, welche beim Listenabruf hydratisiert wird, sodass die untergeordneten Zeilen als Chips in der Zeile erscheinen. Lediglich das Formularfeld entfällt.

In der Tabelle erhält eine Relation mit eigener Property genau **eine** Spalte: ihre eigene. Jeder Tab besitzt zudem eine Spalte mit einem Button zum Wechseln zum Tab; bei einer über eine Property deklarierten Relation würde dieser Button jedoch dieselbe Überschrift neben einer Spalte wiederholen, die die Kindelemente bereits anzeigt, weshalb er weggelassen wird. Blenden Sie die Spalte der Relation aus (`admin: { hideFromCollection: true }`), erscheint der Button wieder, sodass die Relation nie vollständig aus der Tabelle verschwindet.

Das Ausblenden der Spalte stoppt den Abruf nicht. Der Listenabruf der Collection bettet jede Relation ein, die eine Property deklariert – unabhängig davon, ob sie ausgeblendet ist oder nicht. Code, der Listen-Zeilen liest – `additionalFields`, Display-Resolver, Entitäts-Aktionen, Collection-Aktionen über `tableController.rows`, Plugin-Slots –, findet die verknüpften Zeilen dort vor, verschachtelt unter dem Namen der Relation, wie RESTs `include` sie zurückgibt, neben der Foreign-Key-Spalte. Einem `browserCallbacks.afterRead` wird dieselbe Zeile übergeben. Eine Relation, die nur im `relations`-Array der Collection ohne Property deklariert ist, wird nicht in die Liste eingebettet; ihre Zeilen werden geladen, wenn ihr Tab geöffnet wird.

Wenn Sie dennoch den Inline-Picker wünschen, können Sie ihn explizit anfordern:

```typescript
properties: {
    tags: {
        type: "relation",
        name: "Tags",
        relation: { kind: "manyToMany", target: () => tagsCollection },
        admin: { renderInForm: true }   // standardmäßig deaktiviert; der Tab ist die Standarddarstellung
    }
}
```

## Multi-Hop Joins

Verwenden Sie für Beziehungen, die sich über mehrere Tabellen erstrecken, `kind: "via"` mit einem `joinPath`. Eine Kette mit mehr als einem Schritt ist schreibgeschützt: Rebase leitet nicht ab, wie über eine beliebige Kette geschrieben werden soll (siehe [via](#via--eine-explizite-join-kette) für Single-Hop-Ketten, die beschreibbar sind).

```typescript
// Users → Permissions über Roles
relations: [
    {
        kind: "via",
        relationName: "permissions",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "user_id" }
            },
            {
                table: "roles",
                on: { from: "role_id", to: "id" }
            },
            {
                table: "role_permissions",
                on: { from: "id", to: "role_id" }
            },
            {
                table: "permissions",
                on: { from: "permission_id", to: "id" }
            }
        ]
    }
]
```

### Joins mit zusammengesetzten Schlüsseln (Composite Keys)

```typescript
joinPath: [
    {
        table: "customers",
        on: {
            from: ["company_code", "region_id"],  // Mehrere Spalten
            to: ["code", "region_id"]
        }
    }
]
```

### Übereinstimmung mit einer von zwei Spalten

Eine Liste in `on` verknüpft eine Zeile, die **mindestens eine** Bedingung erfüllt – eine Verknüpfung in `a` oder `b`. Dies ist **schreibgeschützt (read-only)**.

```typescript
joinPath: [{ table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] }]
```

Das Hinzufügen eines zweiten Schritts zu `people` (`on: [{ from: "a", to: "id" }, { from: "b", to: "id" }]`) matcht auch die eigene Spalte des übergeordneten Datensatzes, sodass jede Person als ihr eigener Freund zurückgegeben wird: Listen Sie die Freundschaftszeilen auf oder filtern Sie die Person heraus.

## Kaskadierungsregeln (Cascade Rules)

Steuern Sie, was passiert, wenn verknüpfte Entitäten aktualisiert oder gelöscht werden:

```typescript
relations: [
    {
        kind: "belongsTo",
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id",
        onDelete: "cascade",    // Löscht Posts, wenn der User gelöscht wird
        onUpdate: "cascade"     // Aktualisiert FK, wenn sich die User-ID ändert
    }
]
```

| Aktion | Verhalten |
|--------|-----------|
| `"cascade"` | Änderung auf verknüpfte Zeilen übertragen |
| `"restrict"` | Operation verhindern, wenn verknüpfte Zeilen existieren |
| `"no action"` | Wie restrict (Prüfung dem Constraint überlassen) |
| `"set null"` | FK-Spalte auf NULL setzen |
| `"set default"` | FK-Spalte auf ihren Standardwert setzen |

### Standardverhalten ohne explizite Angabe

`onDelete` ist optional, daher wird es bei den meisten Relationen nicht explizit angegeben. Der Standardwert hängt davon ab, ob die Relation erforderlich ist:

| Relation | Standard `onDelete` |
|--------|----------|
| `belongsTo`, optional | `"set null"` — der Verweis wird geleert |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — das Löschen des Parents schlägt fehl |
| `manyToMany` (Junction-Zeilen) | `"cascade"` — die Verknüpfung wird entfernt, das Ziel bleibt erhalten |

Eine erforderliche Relation ist **keine** Kaskadierung. `required` besagt, dass ein Child-Datensatz nicht ohne einen Parent existieren kann; es besagt nicht, dass das Löschen des Parents das Child zerstören soll. Dies sind unterschiedliche Anforderungen, und nur eine davon entfernt Zeilen, die Sie nicht explizit benannt haben. Daher schlägt das Löschen standardmäßig fehl und benennt den Constraint; `"cascade"` muss explizit angefordert werden:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // Eine Bestellposition ist ohne ihre Bestellung bedeutungslos — geben Sie dies explizit an.
    onDelete: "cascade"
}
```

`onUpdate` hat keinen Standardwert: Wenn nichts festgelegt ist, wendet Postgres `NO ACTION` an. Setzen Sie `"cascade"`, wenn der Schlüssel des Ziels manuell bearbeitet werden kann – ein Slug, eine SKU –, damit die Verweise der Änderung folgen.

## Abrufen von Relationen im SDK

Bei Datenabfragen über das typisierte Rebase SDK werden Relationen standardmäßig **nicht** mitgeladen. Verwenden Sie die Methode `include()`, um verknüpfte Entitäten zusammen mit den Primärdaten anzufordern.

### Bestimmte Relationen einbinden

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Alle Relationen einbinden

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Verwendung der Params-Syntax

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Antwortstruktur

Wenn Relationen eingebunden werden, enthält die Antwort sowohl den **skalaren Foreign Key** als auch das **hydratisierte Relationsobjekt**:

```typescript
const { data } = await client.data
    .collection<{ id: string; authorId: string; author?: { name: string } }>("articles")
    .include("author")
    .find();

// Das SDK gibt flache Zeilen zurück — es gibt keinen `.values`-Wrapper. (`Entity`, mit
// `id`/`path`/`values`, ist ein View-Model der Admin-UI, nicht das, was der Client zurückgibt.)
for (const article of data) {
    // Skalarer FK — immer vorhanden
    article.authorId;     // "uuid-1234"

    // Hydratisierte Relation — nur vorhanden, wenn per include angefordert
    article.author?.name;  // "Jane Doe"
}
```

> Die an `include()` übergebenen Relationsnamen müssen mit dem Namen der Relation übereinstimmen: dem `relationName` eines Eintrags im `relations`-Array der Collection oder dem Schlüssel der Property, die sie inline deklariert.

Die vollständige Query-Builder-Referenz (Filtern, Sortieren, Paginierung, Echtzeit) finden Sie in der [Dokumentation zum typisierten SDK](/docs/sdk).

## Relationen im Admin-Panel

Jede To-Many-Relation (`hasMany`, `manyToMany` oder ein To-Many-`via`) wird zu einem Tab unter einem Datensatz im Admin-Panel, adressiert über den Namen der Relation. [Relationen im Admin-Panel](/docs/collections/relations-in-the-admin-panel/) behandelt die Pfade, was ein Tab erstellt, verknüpft, trennt oder löscht, dieselben Regeln über REST und was nicht zu einem Tab wird.

## Vollständiges Relation-Interface

`Relation` ist eine geschlossene Union (Closed Union) – ein Member pro Art, wobei jeder nur die Felder enthält, die diese Art besitzt. Es gibt keine Kombination von Feldern, die zwei verschiedene Verknüpfungen beschreibt, und kein Feld, das gesetzt werden kann, ohne von dieser Art verwendet zu werden.

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

interface RelationBase {
    relationName?: string;          // Standardwert ist der Property-Key, danach der Slug des Ziels
    target: () => CollectionConfig;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<CollectionConfig>;   // wird angewendet, wenn als Tab gerendert
}
// `required` ist hier nicht enthalten. Es entspricht `validation: { required: true }` auf der
// Property, die die Relation deklariert — derselbe Key, den jedes andere Feld verwendet.

interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // Spalte in DIESER Tabelle
    index?: boolean;                // B-Tree auf localKey; standardmäßig true
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // Spalte in der ZIEL-Tabelle
    sourceKey?: string;             // Spalte in DIESER Tabelle; Standardwert ist der Primärschlüssel
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // Spalte in der ZIEL-Tabelle
    sourceKey?: string;             // Spalte in DIESER Tabelle; Standardwert ist der Primärschlüssel
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;
        targetColumn?: string;
        properties?: Properties;    // zusätzliche Spalten auf der Junction-Zeile, bereitgestellt unter `_pivot`
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // kann von einer Join-Kette nicht impliziert werden
    joinPath: JoinStep[];
}
```

### Die aufgelöste Form (Resolved Form)

Was Sie oben schreiben, ist die Form für die *Deklaration*. Intern arbeitet Rebase mit `ResolvedRelation`: dieselbe Verknüpfung, bei der alle Standardwerte ausgefüllt sind und nichts optional ist, plus `cardinality`, `targetSlug` und zwei Flags – `writable` (nur bei einem Multi-Hop-`via` oder einem Schritt mit Mehrfachbedingungen false) und `shared` (true, wenn die Zielzeilen auch zu anderen Parents gehören, sodass ein Entfernen die Verknüpfung löst, anstatt zu löschen).

`sourceKey` ist die einzige Ausnahme von "nichts ist optional": Sein Standardwert ist der Primärschlüssel der Quelle, und dessen Ermittlung erfordert das Schema des Treibers, welches bei der Auflösung noch nicht vorliegt. `undefined` bedeutet dort "der Primärschlüssel" und nichts anderes.

Sie schreiben niemals eine `ResolvedRelation`. Bei einer Relations-Property gehört `relation` Ihnen und `resolvedRelation` ist das ausgefüllte Pendant, das während der Normalisierung gesetzt wird.

## Nächste Schritte

- **[Security-Regeln](/docs/collections/security-rules)** — Row Level Security
- **[Properties](/docs/collections/properties)** — Referenz der Property-Typen
