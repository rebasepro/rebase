---
sourceHash: b1b5ef4227e130d2
title: Schreiben über REST
sidebar_label: Schreiben über REST
description: Idempotenz-Schlüssel, bedingte Schreibvorgänge mit ETag und If-Match, Feldoperationen, Upserts auf einem natürlichen Schlüssel, return=minimal und tabellenübergreifende Batches.
---

Die Verben finden Sie auf der Seite [REST API](/docs/backend/api/). Hier geht es um die
fünf Dinge, die ein Schreibvorgang über sein Verb hinaus *anfordern* kann, sowie um den Endpunkt, der
über mehrere Tabellen hinweg gleichzeitig schreibt. Alle davon sind pro Anfrage optional (Opt-in): Ein Schreibvorgang,
der nichts davon anfordert, verhält sich genau wie bisher.

## Schreiben

Über die Verben hinaus akzeptieren die Schreibrouten fünf Dinge, die das Verhalten eines Schreibvorgangs
verändern. Alle fünf sind pro Anfrage optional (Opt-in), sodass sich für eine
Anfrage, die dies nicht anfordert, nichts ändert. Die verschachtelten Routen
(`/api/data/authors/42/posts`) führen denselben Schreibcode aus wie die Root-Routen, daher
gilt alles in diesem Abschnitt auch für sie, mit Ausnahme von `?on_conflict=`.

Der Body eines Schreibvorgangs muss ein JSON-Objekt sein. `null`, eine Zahl, ein String oder ein Array führt zu
einem `400 BAD_REQUEST`.

<span class="since-badge" data-since="0.31">Seit 0.31</span> Ein Schreibvorgang akzeptiert die in der REST-API dokumentierten Werte und sonst nichts – dieselbe
Struktur, die ein Lesevorgang zurückgibt: eine To-One-Relation (`belongsTo`, `hasOne`, ein To-One-
`via`) als Schlüssel der verknüpften Zeile oder `null`, eine To-Many-Relation als Liste von Schlüsseln
oder `{ id, _pivot? }`-Objekten, ein Datum als ISO-Text, einen Vektor als Liste von Zahlen,
einen Geopunkt als `{ latitude, longitude }`, ein `bytea` als
`data:application/octet-stream;base64,`-URL. Eine To-One-Relation, die als
Objekt geschrieben wird (`{ "author": { "id": 5 } }`), führt zu einem `400 VALIDATION_INVALID_VALUE`
(„'posts.author' links one 'authors' row: write that row's key …“), ebenso wie ein
Vektor, der als `{ "value": [...] }` geschrieben wird. Im Prozess akzeptiert `rebase.data` auch ein
`Date` und einen `Buffer` / `Uint8Array`.

Das Schreiben einer `hasMany`- oder `hasOne`-Relation vom übergeordneten Element aus (`{ "replies": [1, 2] }`
auf einem Thread) setzt den Fremdschlüssel auf den untergeordneten Zeilen und unterliegt daher den
Regeln dieses Schlüssels: Eine Schlüsselspalte, die `.readOnly()`, `.private()` oder durch
`access.write` eingeschränkt ist, weist dies zurück (`400 VALIDATION_EXCLUDED_FIELDS` /
`FIELD_NOT_WRITABLE`, „Writing 'replies' on 'threads' sets 'threadId' on the
rows of 'replies'“), genau wie es ein Schreiben des Schlüssels auf dem untergeordneten Element tun würde.

Eine Aktualisierung kann den Schlüssel einer Zeile nicht ändern. Ein Body, der den Schlüssel mit einem anderen
Wert angibt, führt zu einem `400 KEY_IMMUTABLE`, bevor ein Hook ausgeführt wird und ohne dass etwas geschrieben wird,
unabhängig davon, wie die Aktualisierung eintrifft: REST, der Realtime-Socket, MCP oder das
prozessinterne `rebase.data`. Der Schlüssel, den die Zeile bereits besitzt, wird akzeptiert, so wie ihn
ein Formular sendet, das die gesamte Zeile zurücksendet. Um eine Zeile zu einem neuen Schlüssel zu verschieben,
erstellen Sie sie dort und löschen Sie die alte.

### Idempotenz

`Idempotency-Key: <uuid>` bei jedem Schreibvorgang bedeutet: „Wenn Sie genau diese
Anfrage bereits beantwortet haben, beantworten Sie sie erneut, anstatt sie zweimal auszuführen“.

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Ein Client, der keine Antwort erhält, kann nicht wissen, ob der Schreibvorgang committet wurde, und
versucht es daher erneut – und ohne einen Schlüssel kann der Server diesen Wiederholungsversuch nicht von einem zweiten
echten Schreibvorgang unterscheiden. Bei einer Tabelle mit einer vom Server vergebenen ID führt dies zu einer doppelten Zeile,
da die vom Client erfundene ID nie verwendet wurde.

Ein Schlüssel benennt **eine Anfrage**: Er zeichnet die Methode, den Pfad, den Query-String
und den Body auf, für die er beansprucht wurde. Senden Sie genau diese Anfrage erneut, wird ihre Antwort wiederholt (replayed); senden Sie
eine andere unter demselben Schlüssel, wird sie mit `IDEMPOTENCY_KEY_REUSED`
(422) verweigert, anstatt mit dem Ergebnis der ersten beantwortet zu werden. Ein Wiederholungsversuch, der eintrifft,
während der erste noch in Bearbeitung ist, erhält `IDEMPOTENCY_KEY_IN_PROGRESS` (409) –
senden Sie ihn erneut, sobald der erste abgeschlossen ist. Der Query-String zählt, da er
ändert, was eine Anfrage bewirkt: `DELETE /api/data/posts/5?hard=true` unter dem Schlüssel eines
früheren Soft-Deletes ist eine andere Anfrage, keine Wiederholung. Die Reihenfolge
der Parameter spielt keine Rolle.

Wird bei `POST`, `PATCH`, `DELETE`, allen drei `/bulk`-Routen und `/_batch` berücksichtigt.
Schlüssel sind 24 Stunden gültig und an den angemeldeten Aufrufer gebunden; eine
nicht authentifizierte Anfrage hat keinen Principal, auf den sie bezogen werden könnte, daher wird der Header dort
ignoriert. Ein Backend, das keine Schlüssel speichern kann, ignoriert den Header, anstatt
den Schreibvorgang zu verweigern.

`DELETE` ist der Fall, den man zweimal lesen sollte. Ohne Schlüssel wiederholt, findet der zweite
Versuch die Zeile nicht mehr vor und antwortet mit `404` – was ein wiederholender Client als
dauerhaften Fehler für einen Löschvorgang interpretiert, der tatsächlich erfolgreich war. Unter einem Schlüssel wird
der `204` wiederholt.

### Optimistische Nebenläufigkeit: `ETag` und `If-Match`

`GET /api/data/:slug/:id` gibt ein `ETag` zurück, ebenso wie das verschachtelte Einzelzeilen-
`GET`. Senden Sie es als `If-Match` bei einem späteren `PATCH` oder `DELETE` zurück, und der Schreibvorgang wird
mit `412` abgelehnt, falls sich die Zeile in der Zwischenzeit geändert hat.

Ein erfolgreicher `PATCH` antwortet mit dem `ETag` der Version, die er geschrieben hat,
sodass der nächste bedingte Schreibvorgang keinen vorherigen Lesevorgang benötigt. Das Tag wird auch bei einem
`204`, der für `Prefer: return=minimal` zurückgegeben wird, mitgeliefert, und eine für einen
`Idempotency-Key` wiederholte Antwort trägt dasselbe Tag wie die erste. Ein Live-Row-Abonnement
trägt dasselbe Tag in jedem Frame (siehe [Realtime](/docs/backend/realtime/)).

```bash
# read
curl -i /api/data/docs/d1
# → ETag: "9f2c…"

# write, conditionally
curl -X PATCH /api/data/docs/d1 \
     -H 'If-Match: "9f2c…"' \
     -d '{"title": "Second draft"}'
# → 412 PRECONDITION_FAILED if somebody else edited it first
```

Ohne dies gilt bei Read-Modify-Write „Last Writer Wins“ über alles, was der zweite
Schreibvorgang nicht gesendet hat: Zwei Bearbeiter mit einer Sekunde Abstand sind beide erfolgreich, und die
Änderung des ersten ist ohne jegliche Fehlermeldung verloren.

Das Tag wird aus einer Zeitstempelspalte mit `.onUpdateNow()` abgeleitet, wenn die
Tabelle eine solche deklariert – diese Spalte *ist* bereits eine Version – und andernfalls aus einem stabilen
Hash der Zeile. `If-Match: *` stellt lediglich sicher, dass die Zeile existiert.
Es wird nichts geschrieben, wenn die Vorbedingung fehlschlägt.

Das Datensatzformular der Administration speichert mit `If-Match`: Ein Speichervorgang für eine Version,
die in der Zwischenzeit von jemandem ersetzt wurde, wird abgelehnt, das Formular weist darauf hin, und die Bearbeitung verbleibt
im Formular, rebased auf die neue Version mit markierten Konfliktfeldern.

Das Tag wird innerhalb der eigenen Transaktion des Schreibvorgangs verglichen, nachdem die Zeile
gesperrt wurde. Zwei Schreibvorgänge mit demselben Tag können nicht beide erfolgreich sein: Der zweite wartet, bis
der erste committet ist, liest, was dieser geschrieben hat, und wird mit `412` abgewiesen.

### Feldoperationen

Der Wert einer Eigenschaft im Body eines `PATCH` kann eine Operation auf dem gespeicherten Wert
statt eines einfachen Werts sein:

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Operator | Eigenschaftstyp | Wird zu |
|----------|-----------------|---------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)` oder eine jsonb-Verkettung |
| `$pull` | `array` | `array_remove(col, …)` oder eine jsonb-Re-Aggregation |
| `$merge` | `map` | `col || '…'::jsonb` (ein **flacher** Merge) |

Der Sinn liegt im Lesevorgang, den der Aufrufer nicht mehr durchführen muss. Das Ausdrücken von
`views + 1` als Wert bedeutet, ihn zuerst zu lesen, und zwei Anfragen, die jeweils `4` lesen,
eins addieren und `5` schreiben, enden bei `5` – ohne dass in einer der Antworten darauf hingewiesen wird,
dass ein Inkrement verloren ging. Kompiliert in das Statement findet die Arithmetik innerhalb der Zeilensperre
statt und kann nicht verloren gehen.

Genau ein Operator pro Feld. Ein Operator auf einem Eigenschaftstyp, für den er nicht definiert
ist, ein unbekannter `$operator` oder ein Operand mit falscher Struktur führt zu einem `400`
(`INVALID_FIELD_OPERATION`), der das Feld benennt – ein Tippfehler wird niemals als
JSON-Dokument in die Spalte geschrieben.

Eine `map` ist die Ausnahme, da ihr Wert ein JSON-Dokument *ist* und eigene
`$`-Schlüssel enthalten kann – etwa `$schema` und `$id` eines JSON-Schemas oder ein aus einer anderen Datenbank exportiertes Dokument. Bei einer
`map` ist nur ein Objekt mit genau einem Schlüssel, der einer der obigen Operatoren ist,
eine Operation; jedes andere Objekt wird wie gesendet gespeichert, einschließlich der `$`-Schlüssel.
`{ "meta": { "$merge": { … } } }` führt also einen Merge aus, und
`{ "meta": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }` wird
gespeichert. Ein falsch geschriebener Operator auf einer `map` wird daher ebenfalls gespeichert; bei jedem anderen
Typ wird er weiterhin abgelehnt. Der Offline-Client verfügt über kein Schema, um eine `map` von
etwas anderem zu unterscheiden, daher lehnt er im Offline-Zustand einen solchen Wert als Feldoperation ab;
senden Sie ihn, sobald die Verbindung wiederhergestellt ist.

Operationen gelten nur für Aktualisierungen: Bei einer Zeile, die
noch nicht existiert, gibt es nichts zu bearbeiten, daher werden sie bei
`POST`, bei `/bulk`-Erstellungen und bei Upserts abgelehnt.

Eine Operation unterliegt der `validation` der Eigenschaft wie ein normaler Wert. Angehängte
Elemente (pushed) werden nach den Elementregeln bewertet, zusammengeführte Schlüssel nach den Eigenschaften der Map,
und der Wert, den eine Operation *erzeugt*, nach den deklarierten Grenzen: `min`,
`max`, `moreThan`, `lessThan`, `positive` und `negative` einer Zahl, `min`- und
`max`-Elemente eines Arrays. Diese letzte Prüfung ist eine Bedingung im selben `UPDATE`, kein Lesevorgang
davor. Bei `stock: { validation: { min: 0 } }` ist `{ "stock": { "$inc": -1 } }`
erfolgreich, solange der Bestand mindestens 1 beträgt, und wird bei 0 mit dem `400`
(`VALIDATION_CONSTRAINT`) abgewiesen, den auch `{ "stock": -1 }` erhält, unter Nennung des Felds und der
Grenze. Zwei gleichzeitige Dekremente eines Bestands von 1 können nicht beide erfolgreich sein, da
das zweite anhand der Zeile beurteilt wird, die das erste committet hat. Eine nicht gesetzte Zahl zählt
als `0` und ein nicht gesetztes Array als leer. Eine abgewiesene Operation schreibt nichts, nicht einmal
die normalen Werte daneben im Body. Da die Prüfung Teil des Statements ist, gilt sie auch für
prozessinterne Schreibvorgänge über `rebase.data`, welche die Validierung auf Anfrageebene überspringen.

### Upsert auf einem natürlichen Schlüssel

`POST /api/data/:slug?on_conflict=sku` fügt die Zeile ein oder aktualisiert diejenige,
die diese SKU bereits enthält, anstatt daran zu scheitern. Die Bulk-Route akzeptiert
dasselbe Ziel als `onConflict` neben `upsert: true`, und das gilt auch für jede `upsert`-
Operation eines Batches.

```bash
curl -X POST '/api/data/products?on_conflict=sku' \
     -d '{"sku": "LAMP-01", "name": "Desk lamp", "price": 39}'

curl -X POST /api/data/products/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "sku"]
}'
```

Das Ziel muss eine Eindeutigkeitsgarantie bieten, auf die die Datenbank abgleichen kann: der
Primärschlüssel (Standard, wenn keiner angegeben ist), eine als `.unique()` deklarierte Spalte
oder die Spalten eines [Index](/docs/backend/indexes/) mit `unique: true`.
Alles andere führt zu einem `400` (`INVALID_CONFLICT_TARGET`), das die tatsächlich existierenden
Ziele auflistet – Postgres würde andernfalls aus einer Transaktion heraus, die bereits Arbeit verrichtet hat,
mit *there is no unique or exclusion constraint matching the ON CONFLICT specification* antworten.

Die Angabe eines Ziels ohne `upsert: true` bei einem Bulk-Schreibvorgang führt ebenfalls zu einem `400`:
Ein stillschweigendes Ignorieren würde einen wiederholbaren Import in einen duplizierenden verwandeln.

`?on_conflict=` wird bei einer verschachtelten Erstellung abgelehnt (`INVALID_CONFLICT_TARGET`). Die
Zeile, auf die es zutrifft, könnte unter einem anderen übergeordneten Element liegen, und der Upsert würde sie
unter dieses verschieben. Senden Sie den Upsert an die eigene Route der Tabelle.

Ein Upsert, der auf eine gespeicherte Zeile trifft, ist eine Aktualisierung dieser Zeile. Der Server liest die vom
Schlüssel benannte Zeile im Scope des Aufrufers und innerhalb der Transaktion des Schreibvorgangs und
führt die normale Aktualisierung durch: Die Felder im Body werden geschrieben, die ausgelassenen
behalten ihre gespeicherten Werte, anstatt auf ihr `.default()` zurückgesetzt zu werden,
`beforeSave` und `afterSave` sehen `status: "existing"` mit den vorherigen Werten,
und die Historie zeichnet eine Aktualisierung auf. Eine Zeile, die beim Lesen nicht sichtbar war, oder eine, die
gleichzeitig eingefügt wurde, wird dennoch von `ON CONFLICT … DO UPDATE` erfasst, wodurch nur das gesetzt wird,
was der Body und die Hooks geschrieben haben, sowie die `.onUpdateNow()`-Zeitstempel. Ein Schlüssel, der eine Zeile
außerhalb des `beforeQuery`-Scopes des Aufrufers benennt, antwortet mit `404`. Ein Schlüssel, der zu einer
Zeile im [Papierkorb](/docs/collections/soft-delete/) gehört, antwortet mit `409 ROW_IN_TRASH`
und schreibt nichts: Stellen Sie die Zeile zuerst wieder her oder löschen Sie sie endgültig (purge).

Eine Zeile, die bereits existierte, behält ihren `.onCreateNow()`-Zeitstempel und ihren
`.onCreateUser()`-Ersteller. Ein Konflikt bedeutet, dass die Erstellung der Zeile eine Tatsache der
Vergangenheit ist, und ein nächtlicher Re-Import, der `createdAt` bei allem zurücksetzt, was er anfasst,
würde jede „Neu in dieser Woche“-Abfrage zunichtemachen.

#### Nicht auf der Auth-Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Auth-Tabelle (die mit `defineAuthTable` deklarierte) verweigert einen Upsert an jeder
Stelle – `?on_conflict=`, `/bulk` mit `upsert: true`, eine `_batch`-`upsert`-
Operation, das `upsert()` des SDKs und der Realtime-Socket – mit einem `400`
(`INVALID_CONFLICT_TARGET`). Ihre Zeilen sind die Benutzer, und das Erstellen und
Ändern eines Benutzers folgen unterschiedlichen Regeln: Eine Erstellung hasht das Passwort, normalisiert
die E-Mail, führt `onCreateUser` aus und versendet die Einladung, während eine Aktualisierung den
letzten Administrator nicht herabstufen darf. Ein Upsert erfährt erst innerhalb des
Schreibvorgangs, um was es sich handelt – zu spät, um eines von beiden anzuwenden. Erstellen Sie Benutzer
mit einem einfachen `POST` und ändern Sie sie mit `PATCH`.

### `Prefer: return=minimal`

Jeder Schreibvorgang antwortet standardmäßig mit der vollständigen Zeile, welche die
vom Server festgelegten Werte enthält – eine fortlaufende ID, einen `.onCreateNow()`-Zeitstempel oder was
auch immer `beforeSave` umgeschrieben hat. Senden Sie `Prefer: return=minimal`, wenn Sie nichts davon benötigen:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Ein einzelner Schreibvorgang antwortet mit `204`. Ein `/bulk`- oder `/_batch`-Schreibvorgang antwortet mit `200`
und liefert die **IDs** statt der vollständigen Zeilen zurück – bei einer Erstellung ist die ID das Einzige,
was der Aufrufer nicht selbst berechnen kann, sodass ihr Verwerfen bedeuten würde, die Tabelle anhand
eines natürlichen Schlüssels erneut zu lesen, um zu erfahren, was gerade geschrieben wurde. Ein einspaltiger Schlüssel
wird als Skalar zurückgegeben; ein zusammengesetzter Schlüssel als Objekt seiner Spalten.

## Tabellenübergreifende Batches

<span class="since-badge" data-since="0.31">Seit 0.31</span> Jede Operation gibt ihre Tabelle als `table` an (zuvor `collection`).

`POST /api/data/_batch` schreibt über Tabellen hinweg in einer einzigen Transaktion unter der
Rolle des Aufrufers mit denselben Validierungen, Hooks und Zeilenebenen-Sicherheitsregeln (Row-Level Security),
die auch die Einzelzeilen-Route jeder Operation anwenden würde.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "table": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "table": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "table": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "table": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` ist `create`, `update`, `upsert` oder `delete`. `update` und `delete` benötigen eine
`id`; `create`, `update` und `upsert` benötigen `values`; `upsert` kann ein
`onConflict`-Ziel zu denselben Bedingungen wie oben angeben. `data` ist an
`operations` ausgerichtet – die geschriebene Zeile für ein create, update oder upsert und `null` für ein
delete – ein Index im einen entspricht also einem Index im anderen.

### `$ref`: Verweis auf eine Zeile, die im selben Batch erstellt wurde

Eine Operation kann sich selbst über `ref` benennen, und jede spätere Operation kann
`{ "$ref": "<name>.<field>" }` überall dort einsetzen, wo ein Wert erwartet wird – in `values` auf beliebiger Tiefe oder
als `id`. Dies wird zu dem Feld der Zeile aufgelöst, die die benannte Operation geschrieben hat.

Das ist der Grund, warum dieser Endpunkt existiert, anstatt eine Schleife zu sein: Ein Fremdschlüssel
eines Kindelements ist erst bekannt, wenn das übergeordnete Element eingefügt wurde. Ohne dies
müssten Eltern- und Kindelemente in getrennten Anfragen gesendet werden –
genau die Abfolge, die nur zur Hälfte erfolgreich sein kann. Es werden nur **Rückwärtsverweise** (backward references) aufgelöst; ein Vorwärtsverweis
wird abgelehnt, bevor die Transaktion geöffnet wird.

### Was geprüft wird, bevor etwas geschrieben wird

Struktur, unbekannte Tabellen, unbekannte Felder, Wertebeschränkungen, Feldoperationen,
Konfliktziele und die Erreichbarkeit von `$ref` werden alle entschieden, bevor die Transaktion
geöffnet wird. Ein Batch ist ein Alles-oder-Nichts-Vorgang, und das Auffinden eines Tippfehlers bei Operation 40 würde
andernfalls das Rollback der 39 vorangegangenen Schreibvorgänge kosten.

Begrenzt auf dieselbe Anzahl von Operationen wie ein Bulk-Schreibvorgang (standardmäßig 1000), da
ein Batch seine Sperren für die gesamte Transaktion hält. Die Hooks jeder Operation
werden nacheinander darin ausgeführt, sodass ein langsamer Hook pro Zeile bei geöffneter
Transaktion anfällt: 100 Zeilen, deren `beforeSave` 50 ms wartet, belegen eine Verbindung
und die Sperren jeder bisher geschriebenen Zeile für 5,3 s. Dasselbe gilt für
einen `/bulk`-Schreibvorgang. Siehe [Ein Hook belegt eine Verbindung](/docs/collections/context-data-api/#a-hook-holds-a-connection). Ein Treiber, der den
Batch nicht atomar ausführen kann, antwortet mit `BATCH_UNSUPPORTED`, anstatt auf eine Schleife
einzelner Schreibvorgänge zurückzugreifen – was weder die Atomarität noch den einzelnen Roundtrip bieten
würde, für die ein Batch gedacht ist.

Ein `update` oder `delete`, das eine nicht existierende Zeile benennt, lässt den gesamten Batch
mit einem `404` fehlschlagen – aus demselben Grund, aus dem ein teilweiser Schreibvorgang überall sonst abgelehnt wird:
Ein halb angewendeter Zustand bietet keine saubere Wiederherstellungsmöglichkeit.
