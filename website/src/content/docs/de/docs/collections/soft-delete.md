---
sourceHash: 035955ac366c306b
title: Soft Delete
sidebar_label: Soft Delete
description: Verwandeln Sie Löschvorgänge in einen Zeitstempel, blenden Sie mit Zeitstempel versehene Zeilen bei jedem Lesezugriff aus und stellen Sie sie mit einer normalen Aktualisierung wieder her.
---

## Was sich ändert

Wenn `softDelete` aktiviert ist, versieht ein Löschvorgang **eine Spalte mit einem Zeitstempel, anstatt die Zeile zu entfernen**,
und jeder Lesevorgang filtert die so markierten Zeilen heraus. Ansonsten ändert
sich an der Operation nichts: Es ist dieselbe Berechtigung erforderlich, `beforeDelete`
kann weiterhin ein Veto einlegen und `afterDelete` wird weiterhin ausgelöst. Aus
Sicht des Aufrufers wurde die Zeile gelöscht; wie die Tabelle dies festhält,
ist Aufgabe dieses Flags.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    softDelete: true,
    properties: {
        reference: { name: "Reference", type: "string" },
        deletedAt: { name: "Deleted at", type: "date", admin: { readOnly: true } }
    }
});
```

`true` verwendet `deletedAt` (Spalte `deleted_at`). Die Objektform benennt sie um:
`softDelete: { field: "archivedAt" }`.

:::caution[Die Spalte müssen Sie selbst deklarieren]
Das Flag legt fest, was eine Spalte *bedeutet*; es zaubert jedoch keine herbei.
Eine Collection, die `softDelete` aktiviert, ohne diese `date`-Eigenschaft zu
deklarieren, wird beim Start abgewiesen – bewusst frühzeitig, da der Fehler
sonst erst auftreten würde, wenn jemand versucht, eine Zeile zu löschen.
:::

Nur für Postgres, genau wie [search](/docs/backend/search) und
[indexes](/docs/backend/indexes).

## Was bei Lesezugriffen sichtbar ist

Zeilen mit Zeitstempel werden standardmäßig vor `find`, `findById`, `count`, den
Aggregaten, dem Realtime-Refetch und beim Laden dieser Collection über eine
Relation ausgeblendet. Dieser Standardwert ist genau der Zweck: Code, der vor
der Existenz des Flags geschrieben wurde, funktioniert weiterhin, und niemand
muss daran denken, manuell zu filtern.

Zwei Query-Parameter ermöglichen den Zugriff darauf:

| Parameter | Liefert |
|-----------|---------|
| `?deleted=include` | Aktive Zeilen **und** solche mit Zeitstempel |
| `?deleted=only` | Nur Zeilen mit Zeitstempel – die Papierkorb-Ansicht |

Jeder andere Wert führt zu einem 400-Fehler statt eines stillen Fallbacks.
Würde `?deleted=true` stillschweigend alle gelöschten Zeilen ausblenden, würde
es so aussehen, als hätte es funktioniert, und stattdessen die gegenteilige
Frage beantworten.

## Wiederherstellen und endgültiges Löschen

Eine **Wiederherstellung** ist ein ganz normales Update, das das Feld wieder auf
`null` setzt. Es gibt kein spezielles Verb, da es keinen speziellen Status gibt –
die Zeile war nie weg.

Ein **echtes** `DELETE` erfolgt über `?hard=true` beim Delete-Aufruf. Es erfordert
exakt dieselbe Berechtigung wie ein normaler Löschvorgang: Es ist dasselbe Verb,
und eine separate Absicherung wäre eine zweite Zugriffskontrollfläche für ein und
dieselbe Operation. Was sich ändert, ist, ob die Zeile wiederhergestellt werden
kann. Nur das Literal `true` oder `1` bedeutet Ja; ein Tippfehler führt zu einem
400-Fehler, denn ein Aufrufer, der ein vollständiges Löschen angefordert hat und
stattdessen ein Soft Delete erhält, geht davon aus, dass die Daten endgültig gelöscht sind.

## Nächste Schritte

- **[Defining Collections](/docs/collections)** — wo `softDelete` deklariert wird
- **[REST API](/docs/backend/api)** — die Delete- und Abfrage-Endpunkte, zu denen diese Parameter gehören
- **[Security Rules (RLS)](/docs/collections/security-rules)** — wer überhaupt eine Zeile löschen darf

---
