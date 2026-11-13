---
sourceHash: a289b69be61220df
title: Soft Delete
sidebar_label: Soft Delete
description: "softDelete auf einer Tabelle verwandelt Löschvorgänge in einen Zeitstempel, blendet markierte Zeilen bei jedem Lesevorgang aus und stellt sie mit einer gewöhnlichen Aktualisierung wieder her."
---

## Was sich ändert

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn `softDelete` aktiviert ist, versieht ein Löschvorgang **eine Spalte mit einem Zeitstempel, anstatt die Zeile zu entfernen**, und jeder Lesevorgang filtert die markierten Zeilen heraus. Alles andere an der Operation bleibt unverändert: Es ist dieselbe Berechtigung erforderlich, `beforeDelete` kann weiterhin ein Veto einlegen und `afterDelete` wird weiterhin ausgelöst. Aus Sicht des Aufrufers wurde die Zeile gelöscht; wie die Tabelle dies aufzeichnet, ist Aufgabe dieses Flags.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        reference: col.text().notNull(),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    softDelete: true,
    rls: "admin-only",
});
```

`true` verwendet die Spalte `deletedAt` (SQL `deleted_at`). Die Objektschreibweise gibt eine andere Spalte an: `softDelete: { field: "archivedAt" }`. Das Feld wird über die Typen anhand der Tabellenspalten überprüft.

:::caution[Die Spalte muss selbst deklariert werden]
Das Flag gibt an, was eine Spalte *bedeutet*; es fügt keine neue hinzu. Eine Tabelle, die `softDelete` aktiviert, ohne diese Spalte zu deklarieren, oder mit einer Spalte, die kein `timestamptz`, `date` oder `time` ist, wird beim Kompilieren des Schemas abgelehnt – noch bevor jemand versucht, eine Zeile zu entfernen.
:::

## Was ein Lesevorgang sieht

Markierte Zeilen werden standardmäßig vor `find`, `findById`, `count`, Aggregaten, dem Realtime-Refetch sowie vor dem Laden dieser Tabelle über eine Relation verborgen. Dieser Standard ist der entscheidende Punkt: Vor der Einführung des Flags geschriebener Code funktioniert weiterhin, und niemand muss daran denken, manuell zu filtern.

Zwei Abfrageparameter heben dies auf:

| Parameter | Liefert |
|-----------|---------|
| `?deleted=include` | Aktive Zeilen **und** markierte Zeilen |
| `?deleted=only` | Nur markierte Zeilen – die Papierkorbansicht |

Jeder andere Wert führt zu einem 400-Fehler anstelle eines stillen Fallbacks. Wenn `?deleted=true` stillschweigend alle gelöschten Zeilen ausblenden würde, sähe es so aus, als ob es funktionierte, würde aber die gegenteilige Frage beantworten.

## Wiederherstellen und endgültiges Löschen

Ein **Wiederherstellen** ist ein gewöhnliches Update, das das Feld wieder auf `null` setzt. Es gibt kein spezielles Verb, da es keinen besonderen Status gibt – die Zeile war nie weg. Über REST ist es ein `PATCH` – einzeln, `/bulk` oder `_batch` –, dessen Body das Feld auf `null` setzt:

```bash
curl -X PATCH /api/data/invoices/7 -d '{"deletedAt": null}'
```

Diese Aktualisierung ist die einzige, die eine markierte Zeile erreicht. Jede andere Bearbeitung wird mit `404` beantwortet, so wie die Zeile auch auf jeden Standard-Lesevorgang reagiert; stellen Sie sie zuerst wieder her.

Der umgekehrte Weg ist kein Update. Das Setzen des Feldes auf einen Wert wird mit `400` `FIELD_NOT_WRITABLE` abgelehnt – löschen Sie stattdessen die Zeile –, damit die `delete`-Berechtigung, `beforeDelete` und `afterDelete` immer darauf angewendet werden. Ein Upsert kann eine Zeile erstellen, die bereits mit einem Zeitstempel versehen ist, versieht jedoch niemals eine bereits gespeicherte Zeile mit einem Stempel.

Ein Upsert schreibt auch nicht in eine Zeile im Papierkorb: Gehört der Schlüssel zu einer markierten Zeile, wird dies mit `409` `ROW_IN_TRASH` abgelehnt und nichts geschrieben. Stellen Sie die Zeile zuerst wieder her oder bereinigen Sie sie endgültig mit `?hard=true` und führen Sie den Upsert erneut aus.

Ein Löschvorgang über einen Many-to-Many-Pfad, wie etwa `DELETE /api/data/posts/1/tags/5`, entfernt die Verknüpfung von Beitrag 1 mit dem Tag. Er führt kein Soft-Delete für den Tag aus, den andere Beiträge weiterhin verwenden.

Ein **echtes** `DELETE` ist `?hard=true` beim Löschaufruf. Es erfordert genau dieselbe Berechtigung wie ein normales Löschen: Es handelt sich um dasselbe Verb, und eine separate Einschränkung wäre eine zweite Zugriffskontrollfläche für ein und dieselbe Operation. Was es ändert, ist, ob die Zeile wiederhergestellt werden kann. Nur das Literal `true` oder `1` bedeutet Zustimmung; ein Tippfehler führt zu einem 400-Fehler, denn ein Aufrufer, der ein endgültiges Löschen anfordert und ein Soft-Delete erhält, geht davon aus, dass die Daten weg sind.

## Über das SDK

Der typisierte Client greift über `trash` auf jeder Tabelle auf den Papierkorb zu. Er sendet die oben genannten Anfragen: `?deleted=only` bei Lesevorgängen, das Update auf `null` für eine Wiederherstellung und `?hard=true` für ein endgültiges Löschen.

```typescript
const trashed = await client.data.invoices.trash.find({ limit: 20 });
const howMany = await client.data.invoices.trash.count();

await client.data.invoices.trash.restore(7);       // PATCH { deletedAt: null }
await client.data.invoices.trash.restoreMany([8, 9]);

await client.data.invoices.trash.purge(7);         // DELETE ?hard=true
await client.data.invoices.trash.purgeMany([8, 9]);
```

`trash.find` und `trash.count` akzeptieren dieselben Parameter wie `find` und `count`. Eine Wiederherstellung setzt `deletedAt`, sofern Sie das Feld nicht explizit angeben: Eine Tabelle, die mit `softDelete: { field: "archivedAt" }` deklariert ist, wird mit `trash.restore(7, { field: "archivedAt" })` wiederhergestellt. Der Client kann den Feldnamen nicht vom Server auslesen.

Verwenden Sie `trash` bei Tabellen, die `softDelete` deklarieren. Bei Tabellen, die dies nicht tun, ignoriert der Server `?deleted=`, sodass `trash.find` die aktiven Zeilen zurückgibt und `trash.purge` ein gewöhnliches Löschen ist.

Server-Code verfügt über dasselbe `trash`: `context.data.invoices.trash` in einem Hook und `rebase.data.invoices.trash` in einer Funktion oder einem Cron. Er liest und löscht über den Treiber mit den Berechtigungen des Aufrufers, wie auch der Rest von [`context.data`](/docs/collections/context-data-api).

Wenn [offline](/docs/sdk/offline) aktiviert ist, wird der Papierkorb niemals zwischengespeichert und nichts darin in eine Warteschlange eingereiht. Jeder Aufruf erfordert den Server und schlägt ohne Verbindung mit dem Fehler `OFFLINE` fehl. Eine wiederhergestellte Zeile wird der lokalen Datenbank hinzugefügt, und eine endgültig gelöschte Zeile verlässt sie.

## Nächste Schritte

- **[Tabellen](/docs/schema/)** — wo `softDelete` deklariert wird
- **[REST-API](/docs/backend/api)** — die Endpunkte für Löschvorgänge und Abfragen, zu denen diese Parameter gehören
- **[Row-Level Security](/docs/collections/security-rules/)** — wer überhaupt eine Zeile löschen darf
