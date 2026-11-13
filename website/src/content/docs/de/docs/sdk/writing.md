---
sourceHash: dc2857e881f65bd3
title: Daten schreiben
sidebar_label: Daten schreiben
description: create, upsert, update und delete mit dem SDK — Feldoperationen, bedingte Schreibvorgänge, Idempotenzschlüssel, Batch-Schreibvorgänge und tabellenübergreifendes Schreiben in einer einzigen Transaktion.
---

Lesevorgänge werden unter [Querying data](/docs/sdk/querying/) beschrieben. Diese Seite ist die andere Hälfte:
alles, was eine Zeile verändert.

Jede Methode hier durchläuft dieselbe Pipeline wie ein Schreibvorgang von jeder anderen Stelle — [Hooks](/docs/collections/callbacks/),
[Relationen](/docs/collections/relations/) und
[Row-Level-Security](/docs/collections/security-rules/) gelten weiterhin. Nichts
davon ist eine Abkürzung an Ihren eigenen Regeln vorbei; was diese Optionen bringen, ist ein
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

Fügt die Zeile ein oder aktualisiert diejenige, die diesen Schlüssel bereits belegt:

```typescript
await client.data.products.upsert(
    { sku: "LAMP-01", name: "Desk lamp", price: 39 },
    { onConflict: ["sku"] }
);
```

Der Server entscheidet dies innerhalb einer Transaktion und greift auf
`INSERT … ON CONFLICT DO UPDATE` zurück. Im Gegensatz zu einem `findById` gefolgt von
`create` oder `update` kann er die Race Condition zwischen beiden also nicht verlieren, und im Gegensatz
zu `create` schlägt er nicht fehl, wenn die Zeile bereits vorhanden ist.

Wenn die Zeile vorhanden ist, fungiert das Upsert als Aktualisierung dieser Zeile. Die übergebenen Felder
werden geschrieben, und die weggelassenen behalten ihre gespeicherten Werte — sie werden nicht
auf ihren `defaultValue` zurückgesetzt. `beforeSave` und `afterSave` sehen `status: "existing"`
mit den vorherigen Werten, und die History zeichnet ein Update auf. Ein Schlüssel, der eine Zeile
außerhalb des `beforeQuery`-Scopes des Aufrufers benennt, führt zu einem 404.

`onConflict` verwendet standardmäßig den Primärschlüssel, was für die meisten
Schreibvorgänge, für die ein Upsert verwendet wird, das falsche Ziel ist: Bei einem fortlaufenden ID-Schlüssel (Serial ID) ist dies
ein einfacher Insert, da der Aufrufer die ID nicht kennt — ein wiederholbarer Import
dupliziert somit beim zweiten Durchlauf jede Zeile. Geben Sie stattdessen den natürlichen Schlüssel an. Er
muss eine Eindeutigkeitsgarantie besitzen, die die Datenbank abgleichen kann — `validation: { unique:
true }` auf der Eigenschaft oder die Spalten eines `unique: true`-
[Index](/docs/backend/indexes/) — andernfalls wird ein 400-Fehler ausgegeben, der die tatsächlich existierenden
Ziele auflistet, anstatt eines Fehlers, der innerhalb einer Transaktion ausgelöst wird.

Der `on_create`-Zeitstempel und der `user_on_create`-Ersteller einer bereits existierenden
Zeile bleiben unberührt: Ein Konflikt bedeutet, dass ihre Erstellung eine Tatsache aus der Vergangenheit ist.

#### Beibehalten der gespeicherten Zeile: `where` und `ignoreDuplicates`

`where` ersetzt die gespeicherte Zeile nur dann, wenn sie übereinstimmt — ein Filter auf den
Spalten der gespeicherten Zeile, geschrieben wie in einem `find()`. `ignoreDuplicates` ersetzt sie
niemals. In beiden Fällen wird der Aufruf zu `undefined` aufgelöst, wenn die gespeicherte Zeile
unverändert geblieben ist. Die Prüfung erfolgt direkt im Statement (`ON CONFLICT … DO UPDATE
… WHERE`, `ON CONFLICT DO NOTHING`), sodass kein anderer Schreibvorgang zwischen einem Lesevorgang
und der Entscheidung stattfinden kann:

```typescript
// Keep the best score of the day: written only when it beats the stored one.
const kept = await client.data.scores.upsert(
    { day, player, score },
    { where: { score: ["<", score] } }
);

// Claim a slot once; a second claim changes nothing.
const claim = await client.data.claims.upsert({ slot, owner }, { ignoreDuplicates: true });
if (!claim) throw new Error("taken");
```

`createMany(rows, { upsert: true, where })` und `{ upsert: true, ignoreDuplicates: true }`
verhalten sich pro Zeile genauso und geben nur die Zeilen zurück, die sie geschrieben haben. Beide erfordern `upsert`, und
die beiden können nicht kombiniert werden (`INVALID_CONFLICT_RULE`).

#### Nicht auf der Auth-Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`upsert()` auf der Auth-Tabelle (die mit `defineAuthTable` deklarierte) wird mit
einem 400 (`INVALID_CONFLICT_TARGET`) abgewiesen, ebenso wie `createMany` mit `upsert`
dort. Das Erstellen und das Ändern eines Benutzers folgen unterschiedlichen Regeln — ein Create
hasht das Passwort und versendet die Einladung, ein Update darf nicht den letzten
Administrator herabstufen — und ein Upsert erfährt erst während des Schreibvorgangs, um welchen Fall es sich handelt.
Rufen Sie stattdessen `create` oder `update` auf.

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
| `$merge` | `map` | ein Objekt per Shallow-Merge einfügen |

Der Grund für ihre Verwendung ist der Lesevorgang, den man sich dadurch erspart, und die Race Condition, die dieser
Lesevorgang eröffnen würde. `views = current + 1` bedeutet, dass zuerst `current` abgerufen werden muss, und zwei
Anfragen, die jeweils `4` lesen, schreiben beide `5` — eine Inkrementierung geht verloren, und keine der beiden
Antworten weist darauf hin. Direkt in das Statement kompiliert findet die Arithmetik innerhalb der
Zeilensperre (Row Lock) statt.

Genau ein Operator pro Feld und nur bei einem Update: Bei einer Zeile, die noch nicht
existiert, gibt es nichts, worauf operiert werden könnte; daher führt eine Operation in einem `create`,
`createMany` oder `upsert` zu einem 400-Fehler. Ein Operator auf dem falschen Eigenschaftstyp oder ein
falsch geschriebener `$operator` führt zu einem 400-Fehler, der das betroffene Feld nennt — niemals zu einem JSON-Dokument,
das in die Spalte geschrieben wird.

Eine Operation unterliegt wie ein gewöhnlicher Wert der `validation` der Eigenschaft, und das
schließt den resultierenden Wert mit ein. `{ stock: { $inc: -1 } }` auf einem `stock`-Feld mit
`validation: { min: 0 }` gelingt, solange der Bestand mindestens 1 beträgt, und wird bei 0 mit demselben
400-Fehler (`VALIDATION_CONSTRAINT`) abgewiesen, den auch `{ stock: -1 }` erhält. Dasselbe gilt für
`max`, `moreThan`, `lessThan`, `positive` und `negative` sowie für die `min`- und `max`-Elemente eines Arrays
nach einem `$push` oder `$pull`. Die Prüfung ist Teil des Update-Statements, sodass zwei
gleichzeitige Dekrementierungen eines Bestands von 1 nicht beide erfolgreich sein können, und ein abgewiesenes
Update schreibt nichts.

Im Offline-Modus werden sie abgewiesen statt in die Warteschlange gestellt: Eine Operation wird
gegen einen gespeicherten Wert ausgewertet, von dem das Gerät keine aktuelle Kopie besitzt, und eine optimistische
Zeile könnte bis zur Abarbeitung der Queue nur den Marker selbst anzeigen.

### Delete

```typescript
await client.data.products.delete(42);
```

Bei einer Tabelle mit [Soft Delete](/docs/collections/soft-delete) wird die
Zeile markiert, anstatt sie zu löschen. `client.data.products.trash` listet, zählt, stellt wieder her
und bereinigt die markierten Zeilen endgültig.

### Bedingte Schreibvorgänge

`update` und `delete` akzeptieren ein `ifMatch`, sodass ein Schreibvorgang verweigert wird, wenn die Zeile
sich geändert hat, seit Sie sie gelesen haben:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Ohne dies gilt bei Read-Modify-Write das Last-Writer-Wins-Prinzip für alles, was Sie nicht
gesendet haben: Zwei Bearbeiter im Abstand von einer Sekunde haben beide Erfolg, und die Änderung des ersten ist
verloren, ohne dass irgendwo ein Fehler auftritt.

`etagOf(row)` liest die Version aus einer Zeile aus, die von `findById`/`get` stammt. Sie
befindet sich auf einem nicht-aufzählbaren Schlüssel, sodass sie niemals in den generierten `Row`-Typ, ein
`JSON.stringify` oder ein Spread in den nächsten Update-Body gelangt. Bei einer Zeile
aus `find()`, aus dem Offline-Cache oder von einem Server, der keinen `ETag` sendet, ist der Wert `undefined`
— und die Übergabe von `undefined` sendet keine Vorbedingung, sodass der obige Aufruf
zu einem gewöhnlichen Update herabgestuft wird, anstatt einen Fehler auszulösen.

Eine Zeile aus `update()` enthält die Version, die durch diesen Schreibvorgang erzeugt wurde, sodass
bedingte Änderungen ohne zwischenzeitlichen Lesevorgang verkettet werden können. Eine Zeile, die ein
`listenById()`-Callback empfängt, trägt die Version, die dieser Frame darstellt:

```typescript
import { etagOf } from "@rebasepro/client";

let shown: Record<string, unknown> | undefined;
client.data.posts.listenById(1, (post) => {
    shown = post; // etagOf(shown) is the version this frame shows
});

// On save: refused with 412 if the row has moved on since that frame
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(shown) });
```

Von einem Browser auf einer anderen Origin — etwa einem Vite-Frontend auf einem eigenen Port oder einem `app.`-
Host, der einen `api.`-Host aufruft — ist das `ETag` nur lesbar, weil der Server
es in `Access-Control-Expose-Headers` aufführt. Die Rebase-Runtime tut dies, zusammen
mit `Retry-After`, `X-Request-ID`, den `X-RateLimit-*`-Headern und
`Preference-Applied`. Ein Backend, das sein eigenes `cors()` konfiguriert, muss dieselbe Liste freigeben,
da `etagOf` dort sonst immer `undefined` ist und jeder bedingte Schreibvorgang
unkonditioniert gesendet wird.

### Überspringen der Antwort

Jeder Schreibvorgang wird zu der Zeile aufgelöst, die er geschrieben hat. Übergeben Sie `{ returning: false }`, wenn Sie
diese nicht benötigen:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Dadurch wird `Prefer: return=minimal` gesendet; der Server antwortet bei einem einzelnen Schreibvorgang mit `204`
und bei einem Batch nur mit den IDs. Die Methode löst sich dann zu `undefined` (oder `[]`) auf,
sodass Sie nicht versehentlich eine Zeile verwenden können, die der Server gar nicht gesendet hat. Lohnenswert
bei Importen und Fire-and-Forget-Schreibvorgängen — der Standardwert ist die Zeile, da sie enthält, was der
*Server* festgelegt hat.

## Batch-Schreibvorgänge

Drei Operationen schreiben viele Zeilen in einer **einzigen Anfrage und einer einzigen
Transaktion**. Jede Zeile durchläuft weiterhin die normale Pipeline — Hooks, Relationen,
Row-Level-Security — ein Batch ist also keine Abkürzung an Ihren eigenen Regeln vorbei; der Gewinn
besteht in einem Roundtrip und einer Transaktion anstelle von jeweils N.

Alle drei sind **Alles-oder-Nichts**. Wenn eine Zeile abgelehnt wird, wird keine davon übernommen und
der Fehler nennt den betroffenen Index.

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

### Aus wie vielen Statements ein Batch besteht

Auf einer Tabelle ohne `beforeSave`-, `afterSave`- oder `afterSaveError`-Hook,
ohne `history` und ohne `tenant` besteht ein Batch aus wenigen Statements statt
einem pro Zeile: `createMany` sendet mehrzeilige `INSERT … RETURNING`-Statements (bei
`upsert`: `INSERT … ON CONFLICT … DO UPDATE`), und `updateMany` sendet ein
`UPDATE … FROM (VALUES …) RETURNING` pro Durchlauf von Einträgen, die dieselben
Felder setzen. Deklarierte Standardwerte, `.onCreateNow()`- / `.onUpdateNow()`-Stempel, `afterRead` und Realtime-Events
gelten für jede Zeile genauso wie bei Einzeloperationen. Wenn die Datenbank den
Batch verweigert, wird er rückgängig gemacht und Zeile für Zeile erneut ausgeführt, sodass der Fehler weiterhin den Eintrag
benennt, der fehlgeschlagen ist. Eine Tabelle, die einen dieser Hooks deklariert, behält die zeilenweise
Pipeline bei, da jeder Hook einmal pro Zeile zwischen den Schreibvorgängen dieser Zeile ausgeführt wird.

Ein einzelnes `update` liest ebenfalls nichts aus, wenn nichts die gespeicherte Zeile benötigt:
Das `UPDATE … RETURNING` fungiert sowohl als 404 für eine fehlende Zeile als auch als die Zeile, mit der es
antwortet. Ein `delete`, das weder Hook, History noch Trash bedienen muss, liest
ebenfalls nichts.

### Wie viele Roundtrips ein Schreibvorgang benötigt

Ein Schreibvorgang auf einer solchen Tabelle erfordert einen einzigen Roundtrip zur Datenbank: Das
`BEGIN` der Transaktion, die Identität des Aufrufers, das Statement und das `COMMIT` werden
in einem Batch übertragen. Das gilt für `create`, `update`, `upsert`, `delete`,
`updateWhere`, `deleteWhere` und ein gemeinsam geschriebenes `createMany`. Ein Statement,
das die Datenbank verweigert, überspringt das nachfolgende `COMMIT`, und der Schreibvorgang wird wie
jeder fehlgeschlagene Vorgang zurückgerollt. Ein Schreibvorgang, der einen Hook ausführt oder History aufzeichnet, sendet sein
`COMMIT` erst danach in einem zweiten Roundtrip.

### Warum `{ id, data }` statt flacher Zeilen

`createMany` nimmt flache Zeilen entgegen, da eine neu erstellte Zeile aus ihren Spalten *besteht*.
`updateMany` benennt die Adresse separat, da bei einer Tabelle, deren Schlüssel nicht die
`id` ist — etwa eine `sku` oder ein zusammengesetzter Schlüssel —, eine flache Zeile nicht unterscheiden kann, ob
eine Spalte die Adresse oder ein zu schreibender Wert ist. Dies spiegelt das zeilenbasierte
`update(id, data)` exakt wider.

## Schreiben über einen Filter

`updateWhere` und `deleteWhere` schreiben jede Zeile, auf die ein Filter zutrifft, in einem
einzigen Statement — `UPDATE … WHERE … RETURNING` und `DELETE … WHERE`. Der Filter entspricht
dem `where` und `logical`, die auch von `find()` akzeptiert werden:

```typescript
// Every expired session, gone; resolves to how many.
const removed = await client.data.sessions.deleteWhere({ where: { expiresAt: ["<", cutoff] } });

// Field operations work as on update(); resolves to the rows updated.
const bumped = await client.data.songs.updateWhere(
    { where: { "lower(artist)": ["in", ["abba", "queen"]] } },
    { plays: { $inc: 1 } }
);
```

Ein Filter, der auf nichts zutrifft, ist kein Fehler — das Ergebnis ist `[]` oder `0` —, was
`deleteWhere` auch zur Löschmethode für eine Zeile macht, die möglicherweise bereits nicht mehr existiert,
während `delete` mit 404 antwortet. Und da das Statement, das schreibt, dasselbe ist, das den
Filter prüft, handelt es sich um ein Compare-and-Set:

```typescript
// Save only over the revision this client read; [] means somebody else saved first.
const [saved] = await client.data.saves.updateWhere(
    { where: { player: ["==", player], rev: ["==", rev] } },
    { body, rev: { $inc: 1 } }
);
```

Ein Filter ohne Bedingung wird mit `FILTER_REQUIRED` abgewiesen, anstatt ausgeführt zu werden —
er würde sonst jede Zeile betreffen — und ein Feld, das keine Spalte ist, wird wie bei einem Lesevorgang abgewiesen,
niemals stillschweigend verworfen. Ein gefiltertes Update kann keine Schlüsselspalte setzen.

Auf einer Tabelle, deren Schreibvorgänge zeilenweise Arbeit erfordern — ein Save- oder Delete-Hook, History,
Mandantenfähigkeit (Tenancy), ein `beforeQuery`, Soft Delete, feldbasierte Zugriffskontrolle —, werden die passenden Zeilen
unter dem Scope des Aufrufers gelesen und nacheinander durch die vollständige Pipeline
in einer einzigen Transaktion geschrieben. Über HTTP sind dies die Bulk-Routen mit einem Filter
anstelle von IDs: `PATCH /api/data/<slug>/bulk` mit `{ where, logical, data }`
und `POST /api/data/<slug>/bulk/delete` mit `{ where, logical }`. Sie stehen auf
der Auth-Tabelle nicht zur Verfügung, da deren Updates und Deletes Benutzer für
Benutzer geprüft werden (`FILTERED_USER_WRITE`); benennen Sie die Benutzer stattdessen mit `updateMany`/`deleteMany`.

### Wiederholungsversuche und Duplikate

Ein Client, der die Antwort nie erhält, kann nicht wissen, ob der Batch committet wurde,
und wiederholt den Vorgang daher — und ohne einen Schlüssel kann der Server diesen Wiederholungsversuch nicht von
einem zweiten echten Batch unterscheiden. Übergeben Sie einen Idempotenzschlüssel bei allem, was möglicherweise erneut gesendet wird:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Ein Schlüssel bezeichnet eine einzelne Anfrage, keinen Job: Er wird für die Methode, den Pfad
und den Body registriert, mit dem er gesendet wurde. Das erneute Senden genau dieser Anfrage wiederholt deren Antwort;
derselbe Schlüssel bei einer anderen Anfrage wird mit `IDEMPOTENCY_KEY_REUSED`
(422) abgewiesen. Erzeugen Sie daher einen Schlüssel pro Aufruf, anstatt eine fachliche ID wiederzuverwenden — eine `importId`,
die sich das `createMany` und das `deleteMany` eines Imports teilen, würde dazu führen, dass das
Löschen stillschweigend nicht ausgeführt wird.

Ein Wiederholungsversuch, der eintrifft, während der erste Versuch noch verarbeitet wird, erhält
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): Senden Sie ihn erneut, und er wird mit dem Ergebnis
des ersten Versuchs beantwortet, sobald dieser abgeschlossen ist. Schlüssel sind 24 Stunden lang gültig, und
zwar nur für einen angemeldeten Aufrufer — andernfalls gibt es keinen Principal, auf den der Schlüssel beschränkt werden könnte.

Die Offline-Warteschlange setzt bei jeder Wiederholung automatisch einen Schlüssel.

### Limits

Batches sind serverseitig begrenzt (standardmäßig 1000 Zeilen), da ein Batch
seine Locks für die gesamte Transaktion hält. Eine Überschreitung führt zu einem `BULK_TOO_LARGE`-Fehler,
der sowohl das Limit als auch Ihre Zeilenzahl nennt; teilen Sie die Daten daher in Chunks auf:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Eine Datenquelle, die nicht atomar schreiben kann, meldet `BULK_UNSUPPORTED`, anstatt
stillschweigend Einzelschreibvorgänge in einer Schleife auszuführen — was Ihnen weder die Atomarität
noch den einzelnen Roundtrip bieten würde, weshalb Sie überhaupt einen Batch gewählt haben.

## Tabellenübergreifendes Schreiben

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`createMany` und ähnliche Methoden beziehen sich jeweils auf eine Tabelle. `client.batch()` ist die
tabellenübergreifende Variante: eine Anfrage, eine Transaktion, alles oder nichts.

```typescript
const result = await client.batch([
    { op: "create", table: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", table: "orderItems",
      values: { orderId: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", table: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", table: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` ist `create`, `update`, `upsert` oder `delete`, und `table` grenzt
`values` auf den generierten `Insert`- oder `Update`-Typ dieser Tabelle ein — eine Spalte,
die die Tabelle nicht besitzt, führt zu einem Kompilierungsfehler, ebenso wie ein Create, dem eine
erforderliche Spalte fehlt. `table` ist der Accessor, also der Name, den `client.data.<accessor>`
verwendet (`orderItems` für den Slug `order_items`); der Client sendet den Slug
über das `tables`-Dictionary, mit dem er erstellt wurde. Jede
Operation durchläuft dieselbe Pipeline wie ihr Einzelzeilen-Pendant — dieselbe
Validierung, dieselben Hooks und dieselbe Row-Level-Security, als derselbe Benutzer.

### `$ref`

Eine Operation kann sich selbst über `ref` benennen; eine spätere Operation kann
`{ $ref: "<name>.<field>" }` überall dort einsetzen, wo ein Wert erwartet wird, einschließlich als `id` und in
beliebiger Tiefe innerhalb von `values`. Dies wird zu dem Feld der Zeile aufgelöst, die von der
benannten Operation geschrieben wurde.

Aus diesem Grund existiert die Methode anstelle einer Schleife über `createMany`: Der
Fremdschlüssel des Child-Datensatzes existiert erst, wenn der Parent-Datensatz eingefügt wurde; daher
müssten beide getrennte Anfragen sein — und getrennte Anfragen können teilweise erfolgreich sein. Die
Fehlerbehebung dafür (zurücklesen, herausfinden, welche Hälfte gespeichert wurde, und diese rückgängig machen) ist
Code, den niemand gerne schreibt.

Nur Rückwärtsreferenzen werden aufgelöst. Eine Vorwärtsreferenz wird abgewiesen, noch bevor die
Transaktion geöffnet wird, zusammen mit unbekannten Tabellen, unbekannten Feldern, unzulässigen
Feldoperationen und ungeeigneten Konfliktzielen — denn ein Fehler bei Operation 40 würde
andernfalls das Rollback der 39 vorherigen Schreibvorgänge erzwingen.

### Limits und Fehlerbehandlung

Es gilt dieselbe Obergrenze von 1000 Operationen wie bei einem Bulk-Schreibvorgang, und zwar aus demselben
Grund: Ein Batch hält seine Locks während der gesamten Transaktion. Ein `update` oder `delete`,
das eine nicht existierende Zeile benennt, lässt den gesamten Batch mit einem 404-Fehler fehlschlagen. Ein Backend,
dessen Treiber dies nicht atomar ausführen kann, antwortet mit `BATCH_UNSUPPORTED`, anstatt Schleifen zu durchlaufen.

`idempotencyKey` und `returning` funktionieren genauso wie bei jedem anderen Schreibvorgang.

Serverseitig akzeptieren `rebase.dataAsAdmin.batch([...])` und `context.data.batch([...])`
dieselben Operationen und liefern dasselbe Ergebnis in der eigenen Transaktion des Aufrufers.
`batch` ist dort ebenso wie `table` reserviert: Eine Tabelle, deren Accessor `batch` lautet,
wird über `data.table("batch")` erreicht.
