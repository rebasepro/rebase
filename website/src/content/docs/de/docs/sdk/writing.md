---
sourceHash: a31d37ab40b701e5
title: Daten schreiben
sidebar_label: Daten schreiben
description: Erstellen, Upserten, Aktualisieren und Löschen mit dem SDK – Feldoperationen, bedingte Schreibvorgänge, Idempotenzschlüssel, Batch-Schreibvorgänge und kollektionsübergreifendes Schreiben in einer einzigen Transaktion.
---

Lesevorgänge finden Sie unter [Daten abfragen](/docs/sdk/querying/). Diese Seite ist die andere Hälfte:
alles, was eine Zeile ändert.

Jede Methode hier durchläuft dieselbe Pipeline wie ein Schreibvorgang von überall sonst – [Callbacks](/docs/collections/callbacks/),
[Relationen](/docs/collections/relations/) und
[Row-Level Security](/docs/collections/security-rules/) greifen weiterhin. Nichts
davon ist eine Abkürzung an Ihren eigenen Regeln vorbei; was Ihnen diese Optionen bieten, ist ein
Roundtrip, eine Transaktion oder eine Race Condition, die Sie nicht mehr verlieren müssen.

## Einzelzeilen-Schreibvorgänge

### Create

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Upsert

Fügen Sie die Zeile ein oder ersetzen Sie diejenige, die deren Schlüssel bereits belegt:

```typescript
await client.data.users.upsert(
    { email: "ada@example.com", name: "Ada" },
    { onConflict: ["email"] }
);
```

Ein einziges Statement serverseitig (`INSERT … ON CONFLICT DO UPDATE`), sodass es – anders als ein
`findById` gefolgt von `create` oder `update` – die Race Condition zwischen den beiden nicht
verlieren kann und – anders als `create` – nicht fehlschlägt, wenn die Zeile bereits vorhanden ist.

`onConflict` ist standardmäßig der Primärschlüssel, was für die meisten Schreibvorgänge, für die ein
Upsert genutzt wird, das falsche Ziel ist: Bei einem fortlaufenden ID-Schlüssel handelt es sich um
ein einfaches Einfügen, da der Aufrufer die ID nicht kennt – ein wiederholbarer Import dupliziert
somit beim zweiten Durchlauf jede Zeile. Geben Sie stattdessen den natürlichen Schlüssel an. Dieser
muss eine Eindeutigkeitsgarantie aufweisen, die die Datenbank abgleichen kann – `validation: { unique:
true }` auf der Eigenschaft oder die Spalten eines `unique: true`-[Index](/docs/backend/indexes/) –
und alles andere führt zu einem 400-Fehler, der die tatsächlich existierenden Ziele auflistet, statt
zu einem Fehler innerhalb einer Transaktion.

Der `on_create`-Zeitstempel einer bereits existierenden Zeile bleibt unberührt: Ein Konflikt
bedeutet, dass ihre Erstellung eine Tatsache aus der Vergangenheit ist.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Feldoperationen

Ein Wert kann stattdessen auch eine Operation auf dem *gespeicherten* Wert sein:

```typescript
await client.data.posts.update(postId, {
    views: { $inc: 1 },
    tags:  { $push: "featured" },
    meta:  { $merge: { lastSeen: Date.now() } }
});
```

| Operator | Eigenschaftstyp | Bedeutung |
|----------|-----------------|-----------|
| `$inc` | `number` | addieren (negativ zum Subtrahieren) |
| `$push` | `array` | einen einzelnen Wert oder jeden Wert eines Arrays anhängen |
| `$pull` | `array` | jedes Vorkommen eines Werts entfernen |
| `$merge` | `map` | ein Objekt flach hineinmergen |

Der Grund, sie zu nutzen, ist der Lesevorgang, den Sie nicht mehr durchführen müssen, und die Race
Condition, die dieser Lesevorgang eröffnen würde. `views = current + 1` bedeutet, zuerst `current`
abzurufen, und zwei Anfragen, die jeweils `4` lesen, schreiben beide `5` – ein Inkrement geht
verloren, ohne dass eine der Antworten darauf hinweist. Da dies in das Statement kompiliert wird,
findet die Arithmetik innerhalb der Zeilensperre statt.

Genau ein Operator pro Feld und nur bei einem Update: Bei einer Zeile, die noch nicht existiert,
gibt es nichts zu manipulieren, daher ist eine Operation in einem `create`, `createMany` oder
`upsert` ein 400-Fehler. Ein Operator auf dem falschen Eigenschaftstyp oder ein falsch geschriebener
`$operator` ist ein 400-Fehler, der das Feld benennt – niemals ein JSON-Dokument, das in die Spalte
geschrieben wird.

Im Offline-Modus werden sie abgelehnt, anstatt in die Warteschlange eingereiht zu werden: Eine
Operation wird anhand eines gespeicherten Werts ausgewertet, von dem das Gerät keine aktuelle Kopie
besitzt, und eine optimistische Zeile könnte bis zum Abarbeiten der Warteschlange nur den Marker
selbst anzeigen.

### Delete

```typescript
await client.data.products.delete(42);
```

### Bedingte Schreibvorgänge

`update` und `delete` akzeptieren ein `ifMatch`, sodass ein Schreibvorgang abgewiesen wird, wenn
sich die Zeile seit dem Lesen geändert hat:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Ohne dies gilt für Read-Modify-Write das Prinzip »Last-Writer-Wins« für alles, was Sie nicht
gesendet haben: Zwei Bearbeiter im Abstand von einer Sekunde sind beide erfolgreich, und die
Änderung des ersten ist ohne jegliche Fehlermeldung verloren.

`etagOf(row)` liest die Version aus einer Zeile aus, die von `findById`/`get` stammt. Sie liegt auf
einem nicht-aufzählbaren (non-enumerable) Schlüssel, sodass sie nie in den generierten `Row`-Typ, ein
`JSON.stringify` oder ein Spread in den nächsten Update-Body gelangt. Sie ist `undefined` für eine
Zeile aus `find()`, aus dem Offline-Cache oder von einem Server, der kein `ETag` sendet – und die
Übergabe von `undefined` sendet keine Vorbedingung, sodass der obige Aufruf zu einem gewöhnlichen
Update herabgestuft wird, anstatt einen Fehler zu werfen.

### Antwort überspringen

Jeder Schreibvorgang löst zu der Zeile auf, die geschrieben wurde. Übergeben Sie `{ returning: false }`,
wenn Sie diese nicht benötigen:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Dadurch wird `Prefer: return=minimal` gesendet; der Server antwortet bei einem einzelnen
Schreibvorgang mit `204` und bei einem Batch nur mit den IDs. Die Methode löst dann zu `undefined`
(oder `[]`) auf, sodass Sie nicht versehentlich eine Zeile verwenden können, die der Server nie
gesendet hat. Lohnenswert bei Importen und Fire-and-Forget-Schreibvorgängen – der Standard ist die
Zeile, da sie enthält, was der *Server* entschieden hat.

## Batch-Schreibvorgänge

Drei Operationen schreiben viele Zeilen in einer **einzigen Anfrage und einer einzigen
Transaktion**. Jede Zeile durchläuft weiterhin die normale Pipeline – Callbacks, Relationen,
Row-Level Security – ein Batch ist also keine Abkürzung an Ihren eigenen Regeln vorbei; der Gewinn
besteht in einem einzigen Roundtrip und einer einzigen Transaktion statt jeweils N davon.

Alle drei folgen dem Prinzip **Alles-oder-nichts**. Wird eine beliebige Zeile abgelehnt, wird keine
davon übernommen und der Fehler nennt den betroffenen Index.

```typescript
// Create
await client.data.products.createMany([
    { name: "Widget", price: 9.99 },
    { name: "Gadget", price: 19.99 }
]);

// Update — each entry names its row and the fields to change
await client.data.orders.updateMany([
    { id: "o-1", data: { status: "shipped" } },
    { id: "o-2", data: { status: "shipped" } }
]);

// Delete — by id
await client.data.sessions.deleteMany(["s-1", "s-2"]);
```

### Warum `{ id, data }` statt flacher Zeilen

`createMany` nimmt flache Zeilen entgegen, weil eine zu erstellende Zeile aus ihren Spalten *besteht*.
`updateMany` benennt die Adresse separat, da bei einer Tabelle, deren Schlüssel nicht die `id` ist –
etwa eine `sku` oder ein zusammengesetzter Schlüssel –, eine flache Zeile nicht unterscheiden kann, ob
eine Spalte die Adresse oder ein zu schreibender Wert ist. Dies spiegelt das
Einzelzeilen-`update(id, data)` exakt wider.

### Warum `deleteMany` IDs statt eines Filters erwartet

Ein filterbasiertes Massenlöschen ist eine ganz andere und weitaus gefährlichere Operation: Die
Fehlerquelle ist hier eine weggelassene oder falsch getippte Bedingung, die eine ganze Tabelle leert,
und dies kann an der Aufrufstelle nicht so überprüft werden wie eine explizite Liste. Lesen Sie
zuerst und übergeben Sie dann die beabsichtigten IDs:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
await client.data.sessions.deleteMany(stale.map(s => s.id as string));
```

### Wiederholungen und Duplikate

Ein Client, der die Antwort nie erhält, kann nicht wissen, ob der Batch committet wurde, und
versucht es erneut – und ohne einen Schlüssel kann der Server diesen Wiederholungsversuch nicht von
einem zweiten, echten Batch unterscheiden. Übergeben Sie einen Idempotenzschlüssel bei allem, was
möglicherweise erneut gesendet wird:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Ein Schlüssel bezeichnet eine einzelne Anfrage, keinen Auftrag: Er wird für die Methode, den Pfad
und den Body registriert, mit denen er gesendet wurde. Das erneute Senden exakt dieser Anfrage spielt
deren Antwort erneut ab; derselbe Schlüssel bei einer anderen Anfrage wird mit
`IDEMPOTENCY_KEY_REUSED` (422) abgelehnt. Erzeugen Sie daher einen Schlüssel pro Aufruf, anstatt eine
fachliche ID wiederzuverwenden – eine `importId`, die sich `createMany` und `deleteMany` eines Imports
teilen, würde dazu führen, dass das Löschen stillschweigend nicht ausgeführt wird.

Ein Wiederholungsversuch, der eintrifft, während der erste Versuch noch beantwortet wird, erhält
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): Senden Sie ihn erneut, und er wird mit dem Ergebnis des ersten
Versuchs beantwortet, sobald dieses vorliegt. Schlüssel werden 24 Stunden lang berücksichtigt, und das
nur für authentifizierte Aufrufer – andernfalls gibt es keinen Principal, auf den der Schlüssel
beschränkt werden könnte.

Die Offline-Warteschlange setzt bei jeder Wiederholung automatisch einen Schlüssel.

### Limits

Batches sind serverseitig begrenzt (standardmäßig 1000 Zeilen), da ein Batch seine Sperren für die
gesamte Transaktion hält. Eine Überschreitung führt zu einem `BULK_TOO_LARGE`-Fehler, der sowohl das
Limit als auch Ihre Zeilenanzahl nennt; teilen Sie die Daten daher in Chunks auf:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Eine Datenquelle, die nicht atomar schreiben kann, meldet `BULK_UNSUPPORTED`, anstatt stillschweigend
einzelne Schreibvorgänge in einer Schleife auszuführen – was Ihnen weder die Atomarität noch den
einzelnen Roundtrip bringen würde, weswegen Sie überhaupt zu einem Batch gegriffen haben.

## Kollektionsübergreifendes Schreiben

`createMany` und verwandte Methoden arbeiten jeweils auf einer einzelnen Kollektion. `client.batch()`
ist die kollektionsübergreifende Variante: eine Anfrage, eine Transaktion, alles oder nichts.

```typescript
const result = await client.batch([
    { op: "create", collection: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", collection: "order_items",
      values: { order_id: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", collection: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", collection: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` ist `create`, `update`, `upsert` oder `delete`, und `collection` schränkt `values` auf den
generierten `Insert`- oder `Update`-Typ dieser Kollektion ein. Jede Operation durchläuft die gleiche
Pipeline wie ihr Einzelzeilen-Äquivalent – dieselbe Validierung, dieselben Callbacks und dieselbe
Row-Level Security, als derselbe Benutzer.

### `$ref`

Eine Operation kann sich über `ref` selbst einen Namen geben; eine spätere Operation kann
`{ $ref: "<name>.<field>" }` überall dort einsetzen, wo ein Wert stehen darf, einschließlich als `id`
und in beliebiger Schachtelungstiefe innerhalb von `values`. Es löst zu dem Feld der Zeile auf, die von
der benannten Operation geschrieben wurde.

Aus diesem Grund existiert diese Methode anstelle einer Schleife über `createMany`: Der
Fremdschlüssel des Kind-Datensatzes existiert erst, wenn der Eltern-Datensatz eingefügt wurde, sodass
beide in separaten Anfragen gesendet werden müssten – und separate Anfragen können nur teilweise
erfolgreich sein. Die Wiederherstellung danach (zurücklesen, herausfinden, welche Hälfte angekommen ist,
rückgängig machen) ist Code, den niemand schreiben möchte.

Nur Rückwärtsreferenzen werden aufgelöst. Eine Vorwärtsreferenz wird vor dem Öffnen der Transaktion
abgelehnt, ebenso wie unbekannte Kollektionen, unbekannte Felder, unzulässige Feldoperationen und
ungeeignete Konfliktziele – denn ein Fehler bei Operation 40 würde andernfalls den Rollback der 39
vorangegangenen Schreibvorgänge erzwingen.

### Limits und Fehlerbehandlung

Dasselbe Limit von 1000 Operationen wie bei einem Bulk-Schreibvorgang, aus demselben Grund: Ein
Batch hält seine Sperren für die gesamte Transaktion. Ein `update` oder `delete`, das eine nicht
existierende Zeile benennt, lässt den gesamten Batch mit einem 404 fehlschlagen. Ein Backend, dessen
Treiber dies nicht atomar ausführen kann, antwortet mit `BATCH_UNSUPPORTED`, anstatt Schleifen zu
durchlaufen.

`idempotencyKey` und `returning` funktionieren genau wie bei jedem anderen Schreibvorgang.

---
