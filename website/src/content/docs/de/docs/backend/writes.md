---
sourceHash: 9c622813c5a4eca9
title: Schreiben über REST
sidebar_label: Schreiben über REST
description: Idempotenz-Schlüssel, bedingte Schreibvorgänge mit ETag und If-Match, Feldoperationen, Upserts über natürliche Schlüssel, return=minimal und sammlungsübergreifende Batches.
---

Die Verben finden Sie auf der Seite [REST API](/docs/backend/api/). Hier geht es um die fünf Dinge, die ein Schreibvorgang über sein Verb hinaus *anfordern* kann, sowie um den Endpunkt, der sammlungsübergreifend in einem Schritt schreibt. Alle diese Optionen sind pro Anfrage freiwillig (Opt-in): Ein Schreibvorgang, der nichts davon anfordert, verhält sich exakt wie bisher.

## Schreiben

Über die Verben hinaus akzeptieren die Schreib-Routen fünf Parameter, die das Verhalten eines Schreibvorgangs verändern. Alle fünf sind pro Anfrage optional (Opt-in), sodass sich für Anfragen, die diese nicht anfordern, nichts ändert.

### Idempotenz

`Idempotency-Key: <uuid>` bei einem Schreibvorgang bedeutet: „Wenn diese exakte Anfrage bereits beantwortet wurde, sende dieselbe Antwort erneut, anstatt den Vorgang zweimal auszuführen“.

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Ein Client, der keine Antwort erhält, kann nicht wissen, ob der Schreibvorgang erfolgreich ausgeführt wurde. Daher wiederholt er ihn – und ohne einen Schlüssel kann der Server diesen Wiederholungsversuch nicht von einem zweiten echten Schreibvorgang unterscheiden. In einer Tabelle mit einer vom Server vergebenen ID führt dies zu einer doppelten Zeile, da die vom Client generierte ID nie verwendet wurde.

Ein Schlüssel identifiziert **eine einzige Anfrage**: Er speichert die Methode, den Pfad und den Body, für den er beansprucht wurde. Wird exakt dieselbe Anfrage erneut gesendet, wird deren Antwort wiedergegeben; wird eine andere Anfrage unter demselben Schlüssel gesendet, wird sie mit `IDEMPOTENCY_KEY_REUSED` (422) abgelehnt, anstatt das Ergebnis der ersten zurückzugeben. Ein Wiederholungsversuch, der eintrifft, während der erste noch verarbeitet wird, erhält `IDEMPOTENCY_KEY_IN_PROGRESS` (409) – senden Sie ihn erneut, sobald der erste abgeschlossen ist.

Wird bei `POST`, `PATCH`, `DELETE`, allen drei `/bulk`-Routen sowie `/_batch` unterstützt. Schlüssel sind 24 Stunden lang gültig und an den angemeldeten Aufrufer gebunden; eine nicht authentifizierte Anfrage hat keinen Prinzipal, an den der Schlüssel gebunden werden könnte, daher wird der Header dort ignoriert. Ein Backend, das keine Schlüssel speichern kann, ignoriert den Header, anstatt den Schreibvorgang abzulehnen.

`DELETE` ist der Fall, der besondere Aufmerksamkeit verdient. Ohne Schlüssel wiederholt ausgeführt, stellt der zweite Versuch fest, dass die Zeile nicht mehr existiert, und antwortet mit `404` – was ein wiederholender Client als dauerhaften Fehler für einen Löschvorgang interpretiert, der in Wahrheit erfolgreich war. Mit einem Schlüssel wird stattdessen der `204` wiederholt.

### Optimistische Nebenläufigkeit: `ETag` und `If-Match`

`GET /api/data/:slug/:id` gibt ein `ETag` zurück. Wird dieses bei einem späteren `PATCH` oder `DELETE` als `If-Match` zurückgesendet, wird der Schreibvorgang mit `412` abgelehnt, falls sich die Zeile in der Zwischenzeit geändert hat.

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

Ohne dies gilt bei Read-Modify-Write das Prinzip „Last-Writer-Wins“ für alles, was der zweite Schreibvorgang nicht übermittelt hat: Zwei Bearbeiter, die im Abstand von einer Sekunde speichern, sind beide erfolgreich, und die Änderung des ersten geht ohne jegliche Fehlermeldung verloren.

Das Tag wird aus einer `date`-Eigenschaft mit `autoValue: "on_update"` abgeleitet, sofern die Collection eine solche deklariert – diese Spalte *ist* bereits eine Version – andernfalls aus einem stabilen Hash der Zeile. `If-Match: *` stellt lediglich sicher, dass die Zeile existiert. Es wird nichts geschrieben, wenn die Vorbedingung fehlschlägt.

### Feldoperationen

Der Wert einer Eigenschaft im Body eines `PATCH` kann anstelle eines statischen Werts auch eine Operation auf dem gespeicherten Wert sein:

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

Der Vorteil liegt darin, dass der Aufrufer den Wert nicht mehr vorher lesen muss. Den Ausdruck `views + 1` als konkreten Wert zu übermitteln bedeutet, ihn zuerst lesen zu müssen; zwei Anfragen, die jeweils `4` lesen, eins addieren und `5` schreiben, enden bei `5` – ohne dass eine der beiden Antworten darauf hinweist, dass ein Inkrement verloren ging. Direkt in das Statement kompiliert, findet die Arithmetik innerhalb der Zeilensperre (Row Lock) statt und kann nicht verloren gehen.

Genau ein Operator pro Feld. Ein Operator auf einem Eigenschaftstyp, für den er nicht definiert ist, ein unbekannter `$operator` oder ein Operand mit falscher Struktur führt zu einem `400` (`INVALID_FIELD_OPERATION`), der das Feld benennt – ein Tippfehler wird niemals als JSON-Dokument in die Spalte geschrieben. Operationen gelten nur für Aktualisierungen: Bei einer Zeile, die noch nicht existiert, gibt es nichts zu manipulieren, weshalb sie bei `POST`, `/bulk`-Erstellungen und Upserts abgelehnt werden.

### Upsert über einen natürlichen Schlüssel

`POST /api/data/:slug?on_conflict=email` schreibt `INSERT … ON CONFLICT (email) DO UPDATE` anstelle eines einfachen Inserts. Die Bulk-Route akzeptiert dasselbe Ziel als `onConflict` neben `upsert: true`, ebenso wie jede `upsert`-Operation eines Batches.

```bash
curl -X POST '/api/data/users?on_conflict=email' \
     -d '{"email": "ada@example.com", "name": "Ada"}'

curl -X POST /api/data/users/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "slug"]
}'
```

Das Ziel muss eine Eindeutigkeitsgarantie bieten, die die Datenbank abgleichen kann: der Primärschlüssel (der Standard, wenn keiner angegeben ist), eine Eigenschaft mit `validation: { unique: true }` oder die Spalten eines `unique: true`-[Index](/docs/backend/indexes/). Alles andere führt zu einem `400` (`INVALID_CONFLICT_TARGET`), der die tatsächlich vorhandenen Ziele auflistet – Postgres würde andernfalls innerhalb einer Transaktion, die bereits Arbeit verrichtet hat, mit *there is no unique or exclusion constraint matching the ON CONFLICT specification* antworten.

Die Angabe eines Ziels ohne `upsert: true` bei einem Bulk-Schreibvorgang führt ebenfalls zu einem `400`: Ein stillschweigendes Ignorieren würde einen wiederholbaren Import in einen duplizierenden Vorgang verwandeln.

Eine Zeile, die bereits existierte, behält ihren `on_create`-Zeitstempel. Ein Konflikt bedeutet, dass die Erstellung der Zeile ein Fakt der Vergangenheit ist; ein nächtlicher Re-Import, der `createdAt` bei jedem berührten Datensatz zurücksetzte, würde jede „Neu diese Woche“-Abfrage verfälschen.

### `Prefer: return=minimal`

Standardmäßig antwortet jeder Schreibvorgang mit der vollständigen Zeile, welche die vom Server festgelegten Werte enthält – eine serielle ID, einen `autoValue`-Stempel oder was auch immer `beforeSave` geändert hat. Senden Sie `Prefer: return=minimal`, wenn Sie nichts davon benötigen:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Ein einzelner Schreibvorgang antwortet mit `204`. Ein `/bulk`- oder `/_batch`-Schreibvorgang antwortet mit `200` und liefert die **IDs** anstelle der gesamten Zeilen – bei einer Erstellung ist die ID das Einzige, was der Aufrufer nicht selbst berechnen kann. Sie zu verwerfen würde bedeuten, die Tabelle anhand eines natürlichen Schlüssels erneut lesen zu müssen, um zu erfahren, was gerade geschrieben wurde. Ein einspaltiger Schlüssel wird als Skalar zurückgegeben, ein zusammengesetzter Schlüssel als Objekt seiner Spalten.

## Sammlungsübergreifende Batches

`POST /api/data/_batch` schreibt sammlungsübergreifend in einer einzigen Transaktion unter der Rolle des Aufrufers und mit denselben Validierungen, Callbacks und Zeilenebenen-Sicherheitsregeln (Row-Level Security), die auch die Einzelzeilen-Route jeder Operation anwenden würde.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "collection": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "collection": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "collection": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "collection": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` ist `create`, `update`, `upsert` oder `delete`. `update` und `delete` erfordern eine `id`; `create`, `update` und `upsert` erfordern `values`; `upsert` kann unter denselben Bedingungen wie oben ein `onConflict`-Ziel angeben. `data` ist an `operations` ausgerichtet – die geschriebene Zeile für ein Create, Update oder Upsert und `null` für ein Delete –, sodass ein Index im einen dem Index im anderen entspricht.

### `$ref`: Verweis auf eine Zeile, die derselbe Batch erstellt hat

Eine Operation kann sich selbst über `ref` benennen, und jede spätere Operation kann `{ "$ref": "<name>.<field>" }` überall dort einsetzen, wo ein Wert erwartet wird – in beliebiger Tiefe innerhalb von `values` oder als `id`. Dies wird zu dem entsprechenden Feld der Zeile aufgelöst, die von der benannten Operation geschrieben wurde.

Dies ist der Grund, warum der Endpunkt existiert, anstatt eine Schleife zu sein: Der Fremdschlüssel eines Kind-Elements ist erst bekannt, wenn das übergeordnete Element eingefügt wurde. Ohne diesen Mechanismus müssten Eltern- und Kind-Elemente in separaten Anfragen gesendet werden – genau die Abfolge, die teilweise fehlschlagen kann. Es werden nur **Rückwärtsverweise** aufgelöst; ein Vorwärtsverweis wird abgelehnt, bevor die Transaktion geöffnet wird.

### Was geprüft wird, bevor etwas geschrieben wird

Struktur, unbekannte Sammlungen, unbekannte Felder, Wertebeschränkungen, Feldoperationen, Konfliktziele und die Erreichbarkeit von `$ref` werden alle geprüft, bevor die Transaktion geöffnet wird. Ein Batch ist ein Alles-oder-Nichts-Vorgang, und das Auffinden eines Tippfehlers bei Operation 40 würde andernfalls das Rollback der 39 vorangegangenen Schreibvorgänge erfordern.

Begrenzt auf dieselbe Anzahl von Operationen wie ein Bulk-Schreibvorgang (standardmäßig 1000), da ein Batch seine Sperren für die gesamte Transaktion hält. Ein Treiber, der den Batch nicht atomar ausführen kann, antwortet mit `BATCH_UNSUPPORTED`, anstatt auf eine Schleife von Einzelschreibvorgängen zurückzugreifen – was weder die Atomizität noch den einzelnen Roundtrip bieten würde, für die ein Batch gedacht ist.

Ein `update` oder `delete`, das eine nicht existierende Zeile benennt, lässt den gesamten Batch mit einem `404` fehlschlagen – aus demselben Grund, aus dem partielle Schreibvorgänge überall sonst abgelehnt werden: Ein halb angewendeter Zustand bietet keine verlässliche Wiederherstellung.

---
