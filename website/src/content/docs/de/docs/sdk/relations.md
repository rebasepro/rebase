---
sourceHash: 3db2d10879df1c44
title: Relationen abfragen
sidebar_label: Relationen
description: "Verknüpfte Entitäten in eine Abfrage einbeziehen und eine untergeordnete Tabelle über deren übergeordnete Tabelle mit den Relations-Accessoren des SDKs lesen."
---

## Verknüpfte Zeilen laden

Relationen können eingebunden werden, sodass verknüpfte Entitäten zusammen mit den Primärdaten zurückgegeben werden, anstatt nur ihrer Fremdschlüssel-IDs.

### Verwendung von `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations, one hop deep
const { data } = await client.data.posts
    .include("*")
    .find();
```

Wiederholte Aufrufe **ergänzen** einander, anstatt sich zu ersetzen; `.include("author").include("categories")` fordert also beides an.

### Verwendung von `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Verschachtelung: Relationen von Relationen

Ein Pfad mit Punktnotation lädt eine Relation einer Relation über bis zu **drei Hops**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .table<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Das Benennen des Zwischenschritts ist optional – `comments.author` impliziert bereits `comments` – und das Übergeben von beidem entspricht derselben Anfrage zweimal.

Jeder Hop ist eine gebatchte Abfrage für die gesamte Seite, nicht eine pro Zeile: Eine Seite mit 50 Beiträgen mit `comments.author` entspricht drei Abfragen, unabhängig von der Anzahl der Kommentare. Die Tiefenbegrenzung verhindert, dass eine selbstreferenzierende Relation unendlich durchlaufen wird; darüber hinaus schlägt die Anfrage mit einem 400 `INCLUDE_TOO_DEEP` fehl.

### Einschränken, was eine Relation lädt

Die Listenform bietet keinen Platz für ein `limit` pro Relation, daher nimmt eine Relation, die eingeschränkt werden muss, stattdessen ein Optionsobjekt entgegen:

```typescript
const { data } = await client.data.posts.include({
    comments: {
        limit: 5,
        where: { published: ["==", true] },
        orderBy: ["createdAt", "desc"],
        fields: ["id", "body"],
        include: { author: true }
    }
}).find();
```

| Option | Funktion |
|--------|----------|
| `limit` | Zeilen **pro Elternelement**, nicht über die gesamte Seite hinweg – fünf Kommentare pro Beitrag, nicht fünf insgesamt. Wird von der Abfrage angewendet, sodass Zeilen darüber hinaus gar nicht erst aus der Datenbank gelesen werden. |
| `where` | Derselbe Filter-Dialekt, den auch das `where` auf oberster Ebene verwendet. Wird in die Abfrage verschoben, sodass das `limit` auf Zeilen angewendet wird, die übereinstimmen. |
| `logical` | Eine `or`/`and`/`not`-Gruppe über die verknüpften Zeilen. |
| `orderBy` | Dieselbe Sortier-Syntax, einschließlich der [NULL-Platzierung](/docs/sdk/querying#where-nulls-sort). Bei Gleichstand sowie bei einem `limit` ohne `orderBy` erfolgt die Sortierung nach dem Schlüssel der verknüpften Zeile aufsteigend. |
| `fields` | Spalten der *verknüpften* Zeile. Ihr Schlüssel bleibt immer erhalten, damit die Zeile adressierbar bleibt. |
| `include` | Relationen der verknüpften Zeile wiederum – so wird der Baum verschachtelt. |
| `count` | Gibt zusätzlich unter `_count` der Zeile zurück, wie viele verknüpfte Zeilen es insgesamt pro Elternelement gibt. Siehe [Zählen, was ein Limit auslässt](#zählen-was-ein-limit-auslässt). |

`true` ist die Kurzschreibweise für „vollständig laden“: `{ author: true }` und `["author"]` sind dieselbe Anfrage.

### Zählen, was ein Limit auslässt

Ein `limit` deckelt, was gesendet wird, und `count: true` gibt an, wie viel ausgelassen wurde. Dies ist genau das, was eine Liste benötigt, um vier Tags und ein „+33“ anzuzeigen:

```typescript
const { data } = await client.data.posts.include({
    tags: { limit: 4, count: true }
}).find();

// data[0] → { id: 1, title: "…", tags: [ …4 rows ], _count: { tags: 37 } }
```

- `_count` ist ein Objekt pro Zeile, mit dem Relationsnamen als Schlüssel. Das Zählen von zwei Relationen fügt zwei Schlüssel hinzu.
- Die Gesamtzahl wird in derselben SQL-Anweisung gezählt, die auch die Zeilen liest. Sie deckt dieselben Zeilen ab, die ein Lesevorgang ohne das `limit` zurückgeben würde: das `where` des Includes, Soft Delete und Row-Level Security greifen alle. Das Abfragen erzeugt keine zusätzliche Abfrage.
- Ohne ein `limit` entspricht die Gesamtzahl der Anzahl der zurückgegebenen Zeilen.
- `count` funktioniert nur bei To-Many-Relationen. Bei einer To-One-Relation wird ein 400 `INVALID_INCLUDE` zurückgegeben. Dasselbe gilt für eine Tabelle mit einer Spalte namens `_count`, da die Gesamtsumme diese überschreiben würde.
- Eine Relation, die der Aufrufer nicht lesen darf (Feldzugriff), wird in `_count` ausgelassen, genau wie ihre Zeilen.

### Unbekannte Relationsnamen werden abgelehnt

Ein Name, der keine Relation der Tabelle ist, führt zu einem **400 `UNKNOWN_RELATION`** auf jeder Ebene des Baums – einschließlich innerhalb eines verschachtelten `include`. Früher wurde dies ignoriert, was mit 200 beantwortet wurde, wobei das Feld einfach fehlte; und ein fehlendes Relationsfeld ist nicht von einer Zeile zu unterscheiden, die tatsächlich keine verknüpfte Zeile hat. Ein Tippfehler sah daher genauso aus wie leere Daten.

Mit einem generierten `Database`-Typ kommt es gar nicht erst so weit: `include`-Schlüssel werden zur Compile-Zeit rekursiv gegen die tatsächlichen Relationen der Tabelle geprüft. Siehe [Typisierte Includes](#typisierte-includes).

### Auf Netzwerkebene

`include` ist ein einzelner Abfrageparameter mit zwei Schreibweisen, die sich durch eine führende geschweifte Klammer unterscheiden:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

Die flache Form ist das, was ein Mensch tippt und was die meisten Anfragen benötigen; die JSON-Form existiert, weil die flache keine Optionen pro Relation übermitteln kann und das Erfinden einer eigenen Zeichensetzung dafür (`comments(limit:5)`) eine dritte Grammatik wäre, die man neben den beiden bereits vorhandenen dieser API lernen müsste. Beide werden auf jeder Listen- und Get-by-ID-Route akzeptiert, und das SDK wählt automatisch die Variante, die die Abfrage erfordert.

### Kombination mit Filtern

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Relationsdaten lesen

Wenn Relationen eingebunden werden, enthält die Antwort **sowohl** den skalaren Fremdschlüssel als auch das hydrierte Relationsobjekt:

```typescript
const { data } = await client.data
    .table<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Hinweis:** Ohne `.include("author")` wird nur das skalare Feld `authorId` zurückgegeben. Das hydrierte `author`-Objekt ist `undefined`.

### Ein `belongsTo` hat drei Ausprägungen

Eine Relation, drei Stellen, an denen sie vorkommt – und das Protokoll ist hierbei bewusst nicht symmetrisch, daher lohnt es sich, alle drei zu kennen:

| Wo | Form | Warum |
|----|------|-------|
| **Schreiben** | `{ author: id }` **oder** `{ authorId: id }` | Beide werden akzeptiert. Der Write-Transformer bildet die Relations-Eigenschaft auf die Fremdschlüssel-Spalte ab, sodass beides derselbe Schreibvorgang ist. Ein Objekt (`{ author: { id } }`) führt zu einem 400-Fehler, der die Relation benennt: Übergeben Sie den Schlüssel. |
| **Lesen** | `authorId` | Es ist eine Spalte. Jeder Lesevorgang gibt sie zurück. |
| **Lesen mit `include`** | `author`, die eigene Zeile des Ziels | Wird nur geladen, wenn die Abfrage sie explizit benennt; bei jedem anderen Lesevorgang fehlt sie daher. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.table<Post>("posts");

// Write: either spelling.
await posts.create({ title: "Hello", author: authorId } as Partial<Post>);
await posts.create({ title: "Hello", authorId });

// Read: the key.
const post = await posts.get(id);
post.authorId;          // "uuid-1234"
post.author;            // undefined — nothing asked for it

// Read with include: the row.
const { data } = await posts.include("author").find();
data[0].authorId;       // "uuid-1234" — still there
data[0].author?.name;   // "Jane Doe"
```

Ein generierter `Database`-Typ typisiert alle drei präzise: `Insert` und `Update` akzeptieren beide Schreibweisen, `Row` enthält `authorId` bedingungslos und `author` ist auf `Row` optional – `RowWith<"posts", ["author"]>` ist die Zeile, in der es als **erforderlich** typisiert ist, für einen Lesevorgang, der danach gefragt hat. Siehe [Typisierte Includes](#typisierte-includes).

Der einzige Fall, in dem die drei zusammenfallen, ist eine Relation, die identisch mit ihrem eigenen Fremdschlüssel benannt ist. Dort wird die eingebundene Zeile *über* der Spalte ausgeliefert, und der generierte Typ bildet dies ab, indem er diesen Schlüssel als beides typisiert.

### Typisierte Includes

`rebase generate-sdk` schreibt den Relationsgraphen in Ihren `Database`-Typ sowie zwei darauf aufbauende Hilfstypen:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` beschränkt die Schlüssel eines Includes auf tatsächlich existierende Relationen, und zwar auf jeder Ebene – und ein typisierter Client prüft `include` auf dieselbe Weise, sowohl in `find({ include })` als auch in `.include(...)`, sodass `posts.include("authr")` ein Compile-Fehler statt eines 400 `UNKNOWN_RELATION` ist. Die Zeilen, die ein Lesevorgang zurückgibt, typisieren jede Relation weiterhin als optional; `RowWith<A, I>` ist diese Zeile, bei der jede eingebundene Relation als **erforderlich** markiert ist, um das Gelesene zu typisieren – nach dem Anfordern des Autors benötigt ein `RowWith<"posts", ["author"]>` also kein `?.` bei `row.author.name`.

Ohne ein generiertes `Database` bleibt `include` ein einfaches `string[]` oder ein Baum: Ein manuell geschriebener Zeilentyp enthält keine Relationen, gegen die geprüft werden könnte, und der 400er-Fehler des Servers dient als Auffangnetz.

### Relationsnamen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Namen, die Sie an `include()` übergeben, sind die Schlüssel der `relations` der Tabelle:

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { categories } from "./categories";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull()
    },
    relations: {
        author: rel.belongsTo(() => users),
        categories: rel.manyToMany(() => categories)
    },
    rls: "admin-only"
});
```

```typescript
// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Über eine Relation abfragen

`include()` ruft verknüpfte Zeilen ab, *nachdem* die Seite ausgewählt wurde. Die beiden folgenden Funktionen wählen die Seite **zusammen mit** ihnen aus: Sie kompilieren zu SQL und werden daher vor `limit` und `offset` ausgeführt, nicht danach.

Dies ist genau das, was eine Warteschlangen-Ansicht benötigt – *wer wartet, am längsten Wartende zuerst* –, wobei beide Hälften der Frage von einer verknüpften Tabelle beantwortet werden und nicht von der Zeile, die aufgelistet wird.

### Nach einer Spalte der verknüpften Zeile filtern

Ein Schlüssel mit Punktnotation greift über eine Relation auf eine der Spalten des Ziels zu:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Es kompiliert zu einem `EXISTS` über die verknüpfte Tabelle, korreliert mit der aufgelisteten Zeile – kein Join, der Zeilen vervielfachen und stillschweigend `limit` brechen würde.

Jeder Operator funktioniert, da der verglichene Wert eine gewöhnliche Spalte ist:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Die negativen Operatoren – `!=`, `not-in`, `not-like`, `not-ilike` – bedeuten **„keine verknüpfte Zeile stimmt überein“**, nicht „irgendeine verknüpfte Zeile unterscheidet sich“:

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Das ist die gewünschte Interpretation und die einzige, durch die `==` und `!=` die Zeilen sauber partitionieren. Die andere Lesart – „irgendeine Bewerbung ist nicht 'hired'“ – trifft auf fast jeden Kandidaten mit mehr als einer Bewerbung zu und beantwortet nichts von dem, was man wissen wollte.

`is-null` und `is-not-null` sind hier bewusst **kein** komplementäres Paar. Sie bedeuten „hat eine verknüpfte Zeile, deren Spalte nicht gesetzt ist“ und „hat eine, bei der sie gesetzt ist“ – beides trifft auf einen Kandidaten mit zwei Bewerbungen zu, wenn jeweils eine davon zutrifft.

Ein Relationsname, der nicht existiert, oder eine Spalte, die das Ziel nicht hat, führt zu einem 400-Fehler, der die tatsächlichen Spalten des Ziels benennt. Es handelt sich niemals um eine verworfene Bedingung: Das Verwerfen eines Filterschlüssels würde den Lesevorgang auf alle Zeilen *ausweiten*.

### Nach einem Aggregat über eine Relation sortieren

```typescript
// Candidates, whoever has been waiting longest first.
const { data } = await client.data.talents.find({
    where: { "applications.status": ["in", ["applied", "reviewing"]] },
    orderBy: [[{ relation: "applications", field: "createdAt", agg: "min" }, "asc"]]
});

// Clients, busiest first.
orderBy: [[{ relation: "orders", agg: "count" }, "desc"]]
```

Der Fluent-Builder akzeptiert denselben Schlüssel:

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` und `avg`. `field` ist bei allen erforderlich, außer bei `count`, das die verknüpften Zeilen zählt, wenn Sie es weglassen, und die Zeilen mit einer Non-Null-Spalte zählt, wenn Sie es angeben.

Dies ist der Teil einer Warteschlange, den man auf dem Client nicht umgehen kann. Ein Filter lässt sich annähern, indem ein Flag auf die Zeile denormalisiert wird; eine Sortierung lässt sich überhaupt nicht annähern, sobald die Ergebnismenge paginiert ist, da der Client immer nur eine Seite hält und diese Seite anhand der falschen Reihenfolge ausgewählt wurde.

Zeilen, bei denen die Relation ins Leere greift, landen an einem definierten Ende – **zuletzt bei aufsteigender, zuerst bei absteigender Sortierung**, also die Platzierung, die Postgres einem `NULL` zuweist. Ein `count` von nichts ist `0` statt null, daher sortieren sich diese Zeilen als Null.

Über HTTP ist der Schlüssel ein einzelner String, passt also unverändert in `?orderBy=`:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

Cursor-Paginierung funktioniert darüber. Auf der Cursor-Zeile ist kein Aggregat gespeichert, mit dem verglichen werden könnte, daher berechnet der Treiber den Wert der Cursor-Zeile in SQL anhand der vorhandenen ID neu.

### Row-level security

Beide kompilieren zu einer Unterabfrage, die im Kontext des Lesenden ausgeführt wird, sodass eine verknüpfte Zeile, die durch Ihre Policies ausgeblendet wird, nicht mit einem Filter übereinstimmt und nicht zu einem Aggregat beiträgt.

Eine Einschränkung gibt es nur bei der **negativen** Richtung: „Keine verknüpfte Zeile stimmt überein“ und „keine verknüpfte Zeile, *die dieser Leser sehen kann*, stimmt überein“ sind derselbe Satz. Eine Zieltabelle mit Row-Level Security und ohne `SELECT`-Policy für `rebase_user` ist undurchsichtig, sodass jede Zeile als nicht übereinstimmend erscheint und ein `!=` / `not-in`-Filter zu viele Ergebnisse liefert. Es dringt nichts nach außen – die eigenen Policies der aufgelisteten Tabelle entscheiden weiterhin, welche Zeilen überhaupt existieren, und die positive Richtung gibt korrekterweise nichts zurück. Die Lösung ist eine `SELECT`-Policy auf dem Ziel. Rebase leitet eine für ein deklariertes Many-to-Many ab; ein manuell erstelltes Schema muss diese bereitstellen.

### Engine-Unterstützung

Nur Postgres. Eine Firestore-Collection im CMS deklariert `filterableRelationKinds: []` und bietet keines der beiden Features – ein Document Store verknüpft per Referenz und hat keine Unterabfrage, zu der dies kompiliert werden könnte. Siehe [Firebase](/docs/frontend/firebase/).

### Warum nicht `additionalFields`?

`AdditionalFieldDelegate.value()` ist asynchron und erhält den gesamten Kontext, kann also eine andere Tabelle lesen – und hilft hier trotzdem nicht weiter. Es läuft im Browser, einmal pro Zeile, **nachdem** die Seite abgerufen und sortiert wurde. Ein dort berechneter Wert kann angezeigt werden, aber es kann niemals danach gefiltert, sortiert oder paginiert werden.

Wenn ein abgeleiteter Wert kein Aggregat über eine Relation ist, legen Sie ihn in der Datenbank ab – als generierte Spalte oder als trigger-gepflegte Spalte –, und er wird zu einer gewöhnlichen Eigenschaft.

## Nächste Schritte

- [Querying Data](/docs/sdk/querying/) — der Abfrage-Builder, den diese Accessoren zurückgeben
- [Relations](/docs/collections/relations/) — Deklarieren der Verknüpfungen, die diese Seite liest
- [REST API](/docs/backend/api/) — dasselbe `include` über HTTP
