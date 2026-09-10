---
sourceHash: c7ecc940df2e4680
title: Relationen abfragen
sidebar_label: Relationen
description: "Binden Sie verknüpfte Entitäten in eine Abfrage ein und lesen Sie eine Child-Collection über ihr Parent mit den Relations-Accessors des SDKs."
---

## Verknüpfte Zeilen laden

Relationen können eingebunden werden, sodass verknüpfte Entitäten zusammen mit den primären Daten zurückgegeben werden – anstatt nur deren Fremdschlüssel-IDs.

### Mit `include()` (Fluent)

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

Wiederholte Aufrufe **ergänzen** einander, anstatt sich zu ersetzen; `.include("author").include("categories")` fragt also beides ab.

### Mit `find({ include })` (Parameter)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Verschachtelung: Relationen von Relationen

Ein durch Punkte getrennter Pfad lädt eine Relation einer Relation, bis zu **drei Hops** tief:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .collection<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Die Benennung des Zwischenschritts ist optional – `comments.author` impliziert bereits `comments` – und das Senden beider Angaben führt dieselbe Anfrage doppelt aus.

Jeder Hop ist eine gebatchte Abfrage für die gesamte Seite, nicht eine pro Zeile: Eine Seite mit 50 Beiträgen mit `comments.author` entspricht drei Abfragen, unabhängig von der Anzahl der Kommentare. Die Tiefenbegrenzung verhindert, dass eine selbstreferenzierende Relation endlos durchlaufen wird; darüber hinaus schlägt die Anfrage mit einem 400 `INCLUDE_TOO_DEEP` fehl.

### Einschränken, was eine Relation lädt

Die Listenform bietet keinen Platz für ein `limit` pro Relation. Daher akzeptiert eine Relation, die eingeschränkt werden muss, stattdessen ein Options-Objekt:

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
|--------|--------------|
| `limit` | Zeilen **pro Parent**, nicht über die gesamte Seite hinweg – fünf Kommentare zu jedem Beitrag, nicht fünf insgesamt. |
| `where` | Derselbe Filter-Dialekt, den auch das Top-Level-`where` verwendet. Wird in die Abfrage verschoben, sodass das `limit` für übereinstimmende Zeilen gilt. |
| `logical` | Eine `or`/`and`/`not`-Gruppe über die verknüpften Zeilen. |
| `orderBy` | Dieselbe Sortiersyntax, einschließlich der [NULL-Platzierung](/docs/sdk/querying#where-nulls-sort). |
| `fields` | Spalten der *verknüpften* Zeile. Ihr Schlüssel bleibt immer erhalten, sodass die Zeile adressierbar bleibt. |
| `include` | Relationen der verknüpften Zeile wiederum – so wird der Baum verschachtelt. |

`true` ist die Kurzform für „vollständig laden“: `{ author: true }` und `["author"]` sind dieselbe Anfrage.

### Unbekannte Relationsnamen werden abgelehnt

Ein Name, der keine Relation der Collection ist, führt auf jeder Ebene des Baums zu einem **400 `UNKNOWN_RELATION`** – auch innerhalb eines verschachtelten `include`. Früher wurde dies ignoriert, was mit 200 beantwortet wurde, wobei das Feld einfach fehlte. Ein fehlendes Relationsfeld ist jedoch nicht von einer Zeile zu unterscheiden, die tatsächlich keine verknüpfte Zeile hat. Ein Tippfehler sah daher genauso aus wie leere Daten.

Mit einem generierten `Database`-Typ kommt es gar nicht erst so weit: `include`-Schlüssel werden zur Compile-Zeit rekursiv mit den echten Relationen der Collection abgeglichen. Siehe [Typisierte Includes](#typed-includes).

### Übertragungsprotokoll (On the wire)

`include` ist ein einzelner Query-Parameter mit zwei Schreibweisen, die durch eine führende geschweifte Klammer unterschieden werden:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

Die flache Form tippt ein Mensch und die meisten Anfragen benötigen sie; die JSON-Form existiert, weil die flache Variante keine Optionen pro Relation enthalten kann, und das Erfinden einer Zeichensetzung dafür (`comments(limit:5)`) eine dritte Grammatik wäre, die man neben den beiden bestehenden dieser API lernen müsste. Beide werden auf jeder Listen- und Get-by-ID-Route akzeptiert, und das SDK wählt diejenige aus, die die Abfrage erfordert.

### Kombination mit Filtern

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Relationsdaten auslesen

Wenn Relationen eingebunden sind, enthält die Antwort **sowohl** den skalaren Fremdschlüssel als auch das hydratisierte Relations-Objekt:

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Hinweis:** Ohne `.include("author")` wird nur das skalare Feld `authorId` zurückgegeben. Das hydratisierte `author`-Objekt ist `undefined`.

### Ein `belongsTo` hat drei Ausprägungen

Eine Relation, drei Stellen, an denen sie vorkommt – und die Übertragung ist bewusst nicht symmetrisch gehalten, daher lohnt es sich, alle drei zu kennen:

| Wo | Ausprägung | Warum |
|-------|-------|-----|
| **Schreiben** | `{ author: id }` **oder** `{ authorId: id }` | Beide werden akzeptiert. Der Write-Transformer bildet die Relations-Eigenschaft auf die Fremdschlüsselspalte ab, sodass beides derselbe Schreibvorgang ist. |
| **Lesen** | `authorId` | Es ist eine Spalte. Jeder Lesevorgang gibt sie zurück. |
| **Lesen mit `include`** | `author`, die eigene Zeile des Ziels | Wird nur geladen, wenn die Abfrage sie benennt; fehlt daher bei jedem anderen Lesevorgang. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.collection<Post>("posts");

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

Ein generiertes `Database` typisiert alle drei präzise: `Insert` und `Update` akzeptieren beide Schreibweisen, `Row` besitzt `authorId` bedingungslos, und `author` ist auf `Row` optional und auf der Zeile, die ein Lesevorgang mit `include` zurückgibt, **erforderlich** – siehe [Typisierte Includes](#typed-includes).

Der einzige Fall, in dem die drei zusammenfallen, ist eine Relation, die identisch zu ihrem eigenen Fremdschlüssel benannt ist. Dort wird die eingebundene Zeile *über* der Spalte ausgeliefert, und der generierte Typ bildet dies ab, indem er diesen Schlüssel als beides typisiert.

### Typisierte Includes

`rebase generate-sdk` schreibt den Relationsgraphen in Ihren `Database`-Typ sowie zwei darauf aufbauende Helper:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` beschränkt die Schlüssel eines Includes auf tatsächlich existierende Relationen, und zwar auf jeder Ebene. `RowWith<A, I>` ist die Zeile, die der Lesevorgang zurückgibt, wobei jede eingebundene Relation als **erforderlich** festgelegt wird – nach der Abfrage des Autors benötigt `row.author.name` also kein `?.` mehr.

Ohne ein generiertes `Database` bleibt `include` ein einfaches `string[]` oder ein Baum: Ein manuell geschriebener Zeilentyp enthält keine Relationen, gegen die geprüft werden könnte, und der 400-Fehler des Servers dient als Fallback.

### Relationsnamen

Die Relationsnamen, die Sie an `include()` übergeben, müssen mit dem in dem `relations`-Array der Collection definierten `relationName` übereinstimmen:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Abfragen über eine Relation hinweg

`include()` ruft verknüpfte Zeilen ab, *nachdem* die Seite ausgewählt wurde. Die beiden folgenden Funktionen wählen die Seite **zusammen mit** ihnen aus: Sie werden zu SQL kompiliert und daher vor `limit` und `offset` ausgeführt, anstatt danach.

Das ist genau das, was eine Warteschlangen-Ansicht benötigt – *wer wartet, am längsten Wartende zuerst* –, wobei beide Teile der Frage von einer verknüpften Tabelle beantwortet werden und nicht von der Zeile, die aufgelistet wird.

### Nach einer Spalte der verknüpften Zeile filtern

Ein durch Punkte getrennter Schlüssel greift über eine Relation auf eine der Spalten des Ziels zu:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Dies wird zu einem `EXISTS` über die verknüpfte Tabelle kompiliert, korreliert mit der aufgelisteten Zeile – kein Join, der Zeilen vervielfachen und `limit` unbemerkt verfälschen würde.

Jeder Operator funktioniert, da das Vergleichsobjekt eine gewöhnliche Spalte ist:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Die negativen Operatoren – `!=`, `not-in`, `not-like`, `not-ilike` – bedeuten **„keine verknüpfte Zeile stimmt überein“**, nicht „irgendeine verknüpfte Zeile weicht ab“:

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Das ist die Lesart, die Sie wollen, und die einzige, die dafür sorgt, dass `==` und `!=` die Zeilen partitionieren. Die andere Lesart – „irgendeine Bewerbung ist nicht 'hired'“ – trifft auf fast jeden Kandidaten mit mehr als einer Bewerbung zu und beantwortet nichts, wonach jemand gefragt hätte.

`is-null` und `is-not-null` bilden hier bewusst **kein** komplementäres Paar. Sie bedeuten „hat eine verknüpfte Zeile, deren Spalte nicht gesetzt ist“ und „hat eine, bei der sie gesetzt ist“ – beides trifft auf einen Kandidaten mit zwei Bewerbungen zu, wenn jeweils ein Fall vorliegt.

Ein Relationsname, der nicht existiert, oder eine Spalte, die das Ziel nicht hat, führt zu einem 400-Fehler, der die echten Spalten des Ziels nennt. Es handelt sich niemals um eine verworfene Bedingung: Das Verwerfen eines Filterschlüssels würde den Lesevorgang auf alle Zeilen *erweitern*.

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

`min`, `max`, `count`, `sum` und `avg`. `field` ist bei allen erforderlich, außer bei `count`, welches die verknüpften Zeilen zählt, wenn Sie es weglassen, und die Zeilen mit einer Nicht-Null-Spalte zählt, wenn Sie es angeben.

Dies ist der Teil einer Warteschlange, den Sie auf dem Client nicht umgehen können. Ein Filter kann angenähert werden, indem ein Flag auf die Zeile denormalisiert wird; eine Sortierung kann überhaupt nicht angenähert werden, sobald die Ergebnismenge paginiert ist, da der Client immer nur eine Seite hält und diese Seite nach der falschen Reihenfolge ausgewählt wurde.

Zeilen, über die die Relation nichts erreicht, landen an einem definierten Ende – **zuletzt aufsteigend, zuerst absteigend**, die Platzierung, die Postgres einem `NULL` zuweist. Ein `count` von nichts ist `0` statt null, daher sortieren diese Zeilen als Null.

Über HTTP ist der Schlüssel ein einzelner String, sodass er unverändert in `?orderBy=` passt:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

Cursor-Paginierung funktioniert darüber. Da auf der Cursor-Zeile kein Aggregat gespeichert ist, mit dem verglichen werden könnte, berechnet der Treiber den Wert der Cursor-Zeile in SQL aus der vorhandenen ID neu.

### Row-Level Security

Beides wird zu einer Unterabfrage kompiliert, die als lesender Benutzer ausgeführt wird. Eine verknüpfte Zeile, die Ihre Richtlinien verbergen, stimmt also mit keinem Filter überein und fließt nicht in ein Aggregat ein.

Eine Einschränkung gibt es ausschließlich in der **negativen** Richtung: „keine verknüpfte Zeile stimmt überein“ und „keine verknüpfte Zeile, *die dieser Leser sehen kann*, stimmt überein“ sind dieselbe Aussage. Eine Zieltabelle mit Row-Level Security und ohne `SELECT`-Richtlinie für `rebase_user` ist intransparent, sodass jede Zeile als nicht übereinstimmend erscheint und ein `!=` / `not-in`-Filter zu viele Ergebnisse liefert. Es dringt nichts nach außen – die Richtlinien der aufgelisteten Tabelle selbst entscheiden weiterhin, welche Zeilen überhaupt existieren, und die positive Richtung gibt korrekterweise nichts zurück. Die Lösung ist eine `SELECT`-Richtlinie auf dem Ziel. Rebase leitet eine solche für deklarierte Many-to-Many-Relationen ab; ein manuell geschriebenes Schema muss sie bereitstellen.

### Engine-Unterstützung

Nur Postgres. Firestore und MongoDB deklarieren `filterableRelationKinds: []` und bieten keines der beiden Features – ein Dokumentenspeicher verknüpft über Referenzen und verfügt über keine Unterabfrage, in die dies kompiliert werden könnte. Siehe [Funktionen von Datenquellen](/docs/backend/multiple-sources).

### Warum nicht `additionalFields`?

`AdditionalFieldDelegate.value()` ist asynchron und erhält den gesamten Kontext, sodass es eine andere Collection lesen *kann* – und dennoch kann es hier nicht helfen. Es läuft im Browser, einmal pro Zeile, **nachdem** die Seite abgerufen und sortiert wurde. Ein dort berechneter Wert kann angezeigt werden, aber es kann niemals danach gefiltert, sortiert oder paginiert werden.

Wenn ein abgeleiteter Wert kein Aggregat über eine Relation ist, legen Sie ihn in die Datenbank – als generierte Spalte oder als über Trigger gepflegte Spalte – und er wird zu einer gewöhnlichen Eigenschaft.

## Nächste Schritte

- [Daten abfragen](/docs/sdk/querying/) – der Query-Builder, den diese Accessors zurückgeben
- [Relationen](/docs/collections/relations/) – Deklarieren der Links, die diese Seite liest
- [REST-API](/docs/backend/api/) – dasselbe `include` über HTTP

---
