---
sourceHash: b8fb2609d1a27893
title: Beziehungen
sidebar_label: Beziehungen
description: Definieren Sie Eins-zu-Eins-, Eins-zu-Viele- und Viele-zu-Viele-SQL-Beziehungen zwischen Sammlungen mit Fremdschlüsseln, Verbindungstabellen und Multi-Hop-Joins.
---

## Übersicht

Beziehungen definieren, wie Sammlungen auf Datenbankebene miteinander verbunden sind. Sie ermöglichen Rebase, Folgendes zu tun:

- **Beziehungsauswahlfelder** in Entitätsformularen rendern
- **Verwandte Entitäten** beim Anzeigen von Vorschauen auflösen
- **Fremdschlüsselbeschränkungen** im Drizzle-Schema generieren
- **Kaskadierendes Löschen/Aktualisieren** unterstützen

Beziehungen können entweder inline innerhalb der Eigenschaft oder explizit im `relations`-Array einer Sammlung definiert werden:

### 1. Inline-Beziehungen (Empfohlen)

Deklarieren Sie die Verknüpfung an der Eigenschaft, verschachtelt unter
`relation`. Wählen Sie die `kind`, und der Typ bietet genau die Felder an, die
diese Art benötigt.

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

### 2. Explizites Beziehungen-Array

Für eine Verknüpfung ohne eigene Eigenschaft — nichts, wonach sie im Formular
oder in einer Tabellenspalte benannt werden könnte — deklarieren Sie sie in
`relations`:

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

## Die fünf Arten

Eine Beziehung ist eine von fünf Arten. Die Art entscheidet, wo der Schlüssel
liegt, ob eine Zeile oder viele zurückkommen und was ein Schreibvorgang durch
sie hindurch anfassen darf.

| Art | Der Schlüssel liegt | Liefert | Hinweise |
|---|---|---|---|
| `belongsTo` | auf **dieser** Tabelle | eine | `localKey`, Standard `<relationName>_id` |
| `hasOne` | auf der Tabelle des **Ziels** | eine | `foreignKeyOnTarget`, Standard `<thisCollection>_id` |
| `hasMany` | auf der Tabelle des **Ziels** | viele | Kinder gehören allein zu diesem Elternteil |
| `manyToMany` | in einer **Verbindungstabelle** | viele | Zeilen werden geteilt; Ihnen gehört die Verknüpfung |
| `via` | ein expliziter `joinPath` | beides | schreibgeschützt; `cardinality` geben Sie selbst an |

Jedes Feld außer `kind` und `target` ist optional — der Rest wird abgeleitet.

### belongsTo — der Schlüssel liegt auf dieser Tabelle

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

### hasMany / hasOne — der Schlüssel liegt auf ihrer

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` ist dieselbe Verknüpfung mit höchstens einer Zeile auf der Gegenseite.

#### Join über einen natürlichen Schlüssel

Standardmäßig hält der Fremdschlüssel des Ziels die **id** der Quellzeile.
Werden die beiden Seiten über etwas anderes verbunden — eine externe
Identitäts-Id, eine SKU, ein Mandanten-Slug —, benennen Sie diese Spalte mit
`sourceKey`:

```typescript
relations: [
    {
        kind: "hasMany",
        relationName: "applications",
        target: () => applicationsCollection,
        sourceKey: "auth_user_id",          // column on THIS table
        foreignKeyOnTarget: "auth_user_id"  // column on the TARGET's table
    }
]
// → reads applications.auth_user_id = talents.auth_user_id
```

`sourceKey` ist das Spiegelbild von `localKey` bei `belongsTo`: jenes benennt
die Spalte, aus der diese Seite liest, dieses die Spalte, auf die die andere
Seite zeigt. Ohne es ist eine Verknüpfung wie die obige als `hasMany` überhaupt
nicht ausdrückbar und muss auf [`via`](#via--eine-explizite-join-kette)
zurückfallen, das schreibgeschützt ist.

Die Spalte muss eindeutig sein. Eine Verknüpfung, die mehr als eine Quellzeile
adressiert, kann nicht sagen, zu welcher eine verwandte Zeile gehört, und
Postgres akzeptiert einen Fremdschlüssel auf eine nicht-eindeutige Spalte
ebenso wenig. Rebase prüft das zur Lesezeit und verweigert, statt eine
auszuwählen.

Ein Elternteil, dessen `sourceKey` `NULL` ist, erreicht keine Zeilen, und das
Schreiben durch die Beziehung ist ein Fehler — es gibt nichts, worauf die
verwandten Zeilen zeigen könnten.

### manyToMany — über eine Verbindungstabelle

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Beide Seiten deklarieren ihre eigene, und jede schreibt `through` **aus ihrer
eigenen Sicht** — `sourceColumn` benennt immer *diese* Sammlung:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — eine explizite Join-Kette

Für Verknüpfungen, die die vier obigen Formen nicht ausdrücken können:
Multi-Hop-Pfade, zusammengesetzte Schlüssel oder ein Join, dessen Bedingung kein
einfacher Fremdschlüssel ist. Schreibgeschützt — Rebase leitet nicht ab, wie
durch eine beliebige Kette hindurch geschrieben werden soll.

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

## Beziehungseigenschaften

Um ein Beziehungsfeld in einem Formular zu rendern, fügen Sie eine Eigenschaft mit `type: "relation"` hinzu:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

Beim Rendern einer Vorschau (z. B. in einer Tabellenzelle oder einem Referenz-Chip) übernimmt Rebase die Hydration automatisch.

### Zu-eins bekommt einen Picker, viele einen Tab

Die Kardinalität entscheidet über die Oberfläche, und es wird nur eine
verwendet:

- **`belongsTo` / `hasOne`** — eine Zeile, die Eigenschaft ist also ein
  Fremdschlüssel, den der Autor bearbeitet. Sie wird als der obige Picker
  gerendert.
- **`hasMany` / `manyToMany`** — viele Zeilen, die Entitätsansicht listet sie
  also in einem **eigenen Tab** auf. Die Eigenschaft wird nicht im Formular
  gerendert: Die Kinder einer Sammlung sind eine Liste, kein Wert, den der
  Datensatz hält, und sie aus einem Dropdown auszuwählen ist nichts, was das
  Formular sinnvoll anbieten kann.

Eine Viele-Beziehung dennoch als Eigenschaft zu deklarieren lohnt sich: Sie ist
es, die den Tab benennt, und sie gibt der Beziehung eine Spalte in der
Sammlungstabelle, die der Listen-Abruf hydriert, sodass die Kindzeilen als Chips
in der Zeile erscheinen. Nur das Formularfeld entfällt.

In der Tabelle bekommt eine Beziehung mit eigener Eigenschaft **eine** Spalte:
ihre eigene. Jeder Tab hat außerdem eine Spalte mit einer Sprung-zum-Tab-Taste,
aber bei einer per Eigenschaft deklarierten Beziehung wiederholte diese Taste
dieselbe Überschrift neben einer Spalte, die die Kinder bereits zeigt — sie
entfällt daher. Blenden Sie die Spalte der Beziehung aus
(`admin: { hideFromCollection: true }`), und die Taste kommt zurück, sodass die
Beziehung nie ganz aus der Tabelle fällt.

Wenn Sie den Inline-Picker trotzdem wollen, verlangen Sie ihn:

```typescript
properties: {
    tags: {
        type: "relation",
        name: "Tags",
        relation: { kind: "manyToMany", target: () => tagsCollection },
        admin: { renderInForm: true }   // off by default; the tab is the default treatment
    }
}
```

## Multi-Hop-Joins

Für Beziehungen, die mehrere Tabellen durchqueren, verwenden Sie `kind: "via"`
mit einem `joinPath`. Diese sind schreibgeschützt: Rebase leitet nicht ab, wie
durch eine beliebige Kette hindurch geschrieben werden soll.

```typescript
// Users → Permissions through Roles
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

### Joins mit zusammengesetztem Schlüssel

```typescript
joinPath: [
    {
        table: "customers",
        on: {
            from: ["company_code", "region_id"],  // Multiple columns
            to: ["code", "region_id"]
        }
    }
]
```

## Kaskadenregeln

Steuern Sie, was passiert, wenn verwandte Entitäten aktualisiert oder gelöscht werden:

```typescript
relations: [
    {
        kind: "belongsTo",
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id",
        onDelete: "cascade",    // Delete posts when user is deleted
        onUpdate: "cascade"     // Update FK when user ID changes
    }
]
```

| Aktion | Verhalten |
|--------|----------|
| `"cascade"` | Die Änderung auf verwandte Zeilen übertragen |
| `"restrict"` | Den Vorgang verhindern, wenn verwandte Zeilen existieren |
| `"no action"` | Gleich wie restrict (Aufschub bis zur Beschränkungsprüfung) |
| `"set null"` | Die FK-Spalte auf NULL setzen |
| `"set default"` | Die FK-Spalte auf ihren Standardwert setzen |

### Was gilt, wenn Sie nichts angeben

<span class="since-badge" data-since="0.18">Since 0.18</span>

Der Standardwert für ein **erforderliches** `belongsTo` hat sich geändert. In
0.17.3 ist er `ON DELETE CASCADE` — das Löschen eines Elternteils löscht seine
Kinder — und ab 0.18 ist er `RESTRICT`: das Löschen schlägt fehl und nennt den
Constraint. Alles Übrige in diesem Abschnitt ist unverändert, und `db push` plant
die Constraint-Umschreibung beim Upgrade.

`onDelete` ist optional, daher benennen die meisten Beziehungen nie eines. Der
Standardwert hängt davon ab, ob die Beziehung erforderlich ist:

| Beziehung | Standard-`onDelete` |
|--------|----------|
| `belongsTo`, optional | `"set null"` — der Zeiger wird geleert |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — das Löschen des Elternteils schlägt fehl |
| `manyToMany` (Verknüpfungszeilen) | `"cascade"` — die Verknüpfung geht, die Zielzeile bleibt |

Eine erforderliche Beziehung ist **keine** Kaskade. `required` sagt, dass ein
Kind ohne Elternteil nicht existieren kann; es sagt nicht, dass das Löschen des
Elternteils das Kind zerstören soll. Das sind verschiedene Aussagen, und nur eine
davon entfernt Zeilen, die Sie nicht benannt haben. Deshalb lässt der
Standardwert das Löschen fehlschlagen und nennt die Beschränkung, und `"cascade"`
ist etwas, worum Sie ausdrücklich bitten:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // Eine Bestellposition ist ohne ihre Bestellung sinnlos — sagen Sie es.
    onDelete: "cascade"
}
```

`onUpdate` hat keinen Standardwert: ohne Angabe wendet Postgres `NO ACTION` an.
Setzen Sie `"cascade"`, wenn der Schlüssel des Ziels etwas ist, das eine Person
bearbeiten kann — ein Slug, eine SKU — damit die Zeiger ihm folgen.

## Beziehungen im SDK abrufen

Beim Abfragen von Daten über das Rebase Client SDK sind Beziehungen standardmäßig **nicht** enthalten. Verwenden Sie die Methode `include()`, um verwandte Entitäten zusammen mit den primären Daten anzufordern.

### Spezifische Beziehungen einschließen

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Alle Beziehungen einschließen

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Verwendung der params-Syntax

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Antwortstruktur

Wenn enthalten, enthält die Antwort sowohl den **skalaren Fremdschlüssel** als auch das **hydrierte Beziehungsobjekt**:

```typescript
const { data } = await client.data
    .collection<{ id: string; authorId: string; author?: { name: string } }>("articles")
    .include("author")
    .find();

// The SDK returns flat rows — there is no `.values` wrapper. (`Entity`, with
// `id`/`path`/`values`, is an admin-UI view model, not what the client hands back.)
for (const article of data) {
    // Scalar FK — always present
    article.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.author?.name;  // "Jane Doe"
}
```

> Die an `include()` übergebenen Beziehungsnamen müssen mit dem `relationName` übereinstimmen, der im `relations`-Array der Sammlung definiert ist.

Für die vollständige Referenz zum Query Builder (Filtern, Sortieren, Paginierung, Echtzeit) siehe die [Client SDK-Dokumentation](/docs/sdk).

## Beziehungen im Admin-Panel

Jede Zu-viele-Beziehung — `hasMany`, `manyToMany` oder ein Zu-viele-`via` — wird
im Admin-Panel zu einem **Tab** unter einem Datensatz, der die Zeilen auflistet,
die dieser Datensatz erreicht.

### Das Pfadsegment ist der Beziehungsname

Eine Kindliste wird als `parent/parentId/relationName` adressiert:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

Das letzte Segment ist der **Beziehungsname**, nicht der Slug der Zielsammlung.
Beide sind oft gleich, weil eine unbenannte Beziehung den Slug ihres Ziels
übernimmt — eine Inline-Beziehungseigenschaft übernimmt jedoch den
*Eigenschaftsschlüssel*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

Das ist auch der Grund, warum zwei Beziehungen zur selben Sammlung
funktionieren: Jede hat ihren eigenen Namen, also ihren eigenen Tab und ihren
eigenen Pfad.

### Eigene Zeilen gegenüber geteilten Zeilen

Was ein Tab Ihnen erlaubt, hängt davon ab, wie die Beziehung gespeichert ist,
denn die beiden Fälle bedeuten Unterschiedliches:

| | Eins-zu-viele (`foreignKeyOnTarget`) | Viele-zu-viele (`through`) |
|---|---|---|
| Das Kind gehört zu | allein diesem Elternteil | jedem Elternteil, das es verknüpft |
| Anlegen | legt die Zeile unter diesem Elternteil an | legt die Zeile an und verknüpft sie |
| Vorhandenes hinzufügen | — | verknüpft eine vorhandene Zeile |
| Entfernen | **löscht** die Zeile | **löst** die Verknüpfung; die Zeile bleibt unberührt |

Das Admin-Panel rendert das entsprechend: Ein Viele-zu-viele-Tab bietet
**Vorhandenes hinzufügen** und **Aus diesem Datensatz entfernen** an, und nie ein
Löschen, das die Zeile anderen Elternteilen wegnähme.

### Dieselben Regeln über REST

Kindlisten sind gewöhnliche Sammlungsabfragen, eingeschränkt auf einen
Elternteil, und akzeptieren daher alles, was eine Wurzelliste akzeptiert —
Filter, `orderBy`, `limit`, `offset`, `include` —, und `meta.total` zählt die
gefilterten Zeilen. Filtern Sie entweder pro Feld (`?field=op.value`) oder mit
einem ganzen Objekt `?where={"field":["op","value"]}`; beides erreicht dieselbe
Abfrage:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Das Elternsegment wird durchgesetzt, es ist keine Dekoration. Eine Zeile zu
adressieren, die nicht unter diesem Elternteil liegt, ergibt `404`, und `PATCH`
verschiebt eine Zeile nie von einem Elternteil zu einem anderen — setzen Sie den
Fremdschlüssel ausdrücklich, wenn Sie genau das wollen.

Bei einer Viele-zu-viele-Beziehung ist `PATCH parent/id/child/childId`
*Mengenzugehörigkeit*: Es verknüpft die Zeile, falls sie noch nicht verknüpft
ist, und ist idempotent. So hängen Sie eine bereits vorhandene Zeile an.

### Was nicht zu einem Tab wird

- **Zu-eins-Beziehungen** — sie sind ein Feld am Datensatz, keine Liste. Das
  Schreiben über einen Zu-eins-Pfad wird abgelehnt: Der Fremdschlüssel liegt auf
  der Tabelle des Elternteils.
- **Beziehungen, die innerhalb einer `map` deklariert sind** — sie sind ein Feld
  dieser Map.

## Vollständige Beziehungsschnittstelle

`Relation` ist eine geschlossene Union — ein Mitglied pro Art, das jeweils nur
die Felder trägt, die diese Art hat. Es gibt keine Feldkombination, die zwei
verschiedene Verknüpfungen beschreibt, und kein Feld, das Sie setzen können und
das die Art nicht verwendet.

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

interface RelationBase {
    relationName?: string;          // defaults to the property key, then the target's slug
    target: () => CollectionConfig;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<CollectionConfig>;   // applied when rendered as a tab
}
// `required` is not here. It is `validation: { required: true }` on the
// property that declares the relation, the same key every other field uses.

interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### Die aufgelöste Form

Was Sie oben schreiben, ist die *Autoren*-Form. Intern arbeitet Rebase mit
`ResolvedRelation`: dieselbe Verknüpfung mit allen eingesetzten Standardwerten
und nichts Optionalem, dazu `cardinality`, `targetSlug` und zwei Flags —
`writable` (nur bei `via` false) und `shared` (true, wenn die Zielzeilen auch
anderen Elternteilen gehören, ein Entfernen also die Verknüpfung löst, statt zu
löschen).

`sourceKey` ist die eine Ausnahme von „nichts Optionales“: Sein Standardwert ist
der Primärschlüssel der Quelle, und um den aufzulösen, bräuchte es das Schema des
Treibers, das die Auflösung nicht hat. `undefined` bedeutet dort „der
Primärschlüssel“ und sonst nichts.

Sie schreiben nie eine `ResolvedRelation`. An einer Beziehungseigenschaft gehört
`relation` Ihnen, und `resolvedRelation` ist die ausgefüllte, während der
Normalisierung gestempelte Fassung.

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Zeilenebenen-Sicherheit
- **[Eigenschaften](/docs/collections/properties)** — Referenz der Eigenschaftstypen

---
