---
sourceHash: 8a72cff37e30800b
title: Views
sidebar_label: Views
description: "Einen SQL-View oder einen Materialized View mit defineView schreibgeschützt bereitstellen: security_invoker-Views, gesteuert durch die gelesenen Tabellen, Materialized Views rollenabhängig beschränkt, bei Bedarf aktualisiert, erstellt via db push."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`defineView` stellt eine SQL-Abfrage als schreibgeschützte Tabelle bereit. Deklarieren Sie die Abfrage, die zurückgegebenen Spalten und die Spalte oder Spalten, die eine Zeile identifizieren:

```ts
// backend/schema/artist-stats.ts
import { defineView, col } from "@rebasepro/server/schema";

export const artistStats = defineView("artist_stats", {
    query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
            FROM songs GROUP BY 1`,
    columns: {
        artist: col.text().primaryKey(),
        songs:  col.integer().notNull(),
        fame:   col.integer(),
    },
});
```

Exportieren Sie ihn wie eine Tabelle aus `backend/schema/index.ts`. Er lässt sich wie jede Tabelle lesen – `find`, `findById`, `count`, [`aggregate`](/docs/sdk/aggregates-and-search/), `listen`, die REST-Routen, MCP und das CMS – und wird niemals beschrieben: Jeder Schreibvorgang führt zu einem `405 TABLE_READ_ONLY`. Schreiben Sie in die Tabellen, die der View liest.

`rebase db push` erstellt den View nach den Tabellen, `rebase db generate` hängt ihn an die Migration an, und ein verwalteter Start erstellt ihn in seinem Schema-Schritt. Ein View, dessen Abfrage sich nicht geändert hat, bleibt unberührt; einer, dessen Abfrage geändert wurde, wird gelöscht und neu erstellt, zusammen mit allen Ihren Views, die ihn lesen. Rebase weigert sich, eine Tabelle oder einen nicht von Rebase erstellten View zu ersetzen, der bereits diesen Namen trägt.

## Optionen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Schlüssel | Beschreibung |
|---|---|
| `query` | **Erforderlich.** Das definierende `SELECT`. |
| `columns` | **Erforderlich.** Die Spalten, die die Abfrage zurückgibt, als `col.*`-Builder. `.primaryKey()` kennzeichnet diejenigen, die eine Zeile identifizieren. |
| `materialized` | `true` speichert die Zeilen. Siehe [Materialized Views](#materialized-views). |
| `roles` | Wer einen Materialized View lesen darf. `["admin"]`, wenn nicht angegeben. Bei einem regulären View unzulässig. |
| `table` | Der SQL-View-Name, wenn er vom Namen abweicht. |
| `slug` | Der Name in der API. Wenn nicht angegeben, der Name des Views. |
| `schema` | Das Postgres-Schema. `public`, wenn nicht angegeben. |
| `database` | Eine abweichende Postgres-Datenbank. |
| `description` | Was der View enthält, für OpenAPI und MCP. |
| `relations` | Relationen, über die gelesen werden kann, wie bei einer Tabelle. Für einen View wird kein Constraint erstellt. |
| `indexes` | Indizes auf den gespeicherten Zeilen eines Materialized Views. |
| `hooks` | Nur `beforeQuery` und `afterRead`. Siehe [Tabellen-Hooks](/docs/collections/callbacks/). |
| `metadata` | Beliebige Daten, die mit dem Deskriptor des Views bereitgestellt werden sollen. |

Ein View hat mindestens eine `.primaryKey()`-Spalte: Ein View besitzt keinen eigenen Primärschlüssel, und eine Zeile benötigt eine Adresse.

## Wer welche Zeilen sieht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein regulärer View wird `WITH (security_invoker = true)` erstellt, läuft also **als der Aufrufer**: Die Row-Level Security der Tabellen, die er liest, entscheidet, was der jeweilige Aufrufer sieht. Ein Benutzer, dessen Richtlinien ihm seine eigenen Songs anzeigen, sieht im View nur seine eigenen Songs. Aus diesem Grund hat ein View kein `rls`: Es gibt nichts, woran Richtlinien angehängt werden könnten, und nichts, was sie hinzufügen könnten. Siehe [Row-Level Security](/docs/collections/security-rules/) für die Richtlinien auf den darunterliegenden Tabellen.

## Materialized Views

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`materialized: true` speichert die Zeilen, sodass ein Lesevorgang die Abfrage nicht erneut ausführt:

```ts
import { defineView, col } from "@rebasepro/server/schema";

export const langs = defineView("langs", {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"],
    columns: {
        lang:  col.text().primaryKey(),
        songs: col.integer().notNull(),
    },
    indexes: [{ columns: ["songs"], reason: "the most-used languages first" }],
});
```

Postgres wendet keine Row-Level Security auf einen Materialized View an: Wer ihn lesen darf, liest alles. Daher stellt Rebase ihn nur Aufrufern bereit, die eine der `roles` besitzen (`["admin"]`, wenn nicht angegeben, was `dataAsAdmin` besitzt), und weist alle anderen mit `403 VIEW_NOT_READABLE` ab. Speichern Sie nichts darin, was seine Leser nicht sehen dürfen.

Diese Regel wird auch in der Datenbank durchgesetzt, sodass [als Aufrufer ausgeführtes SQL](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller) sie ebenfalls erfüllt. Die Zeilen werden unter `<view>_rebase_rows` gespeichert, was nur der Datenbank-Owner lesen darf, und der Name des Views selbst ist ein View darüber, der Zeilen nur an Aufrufer mit einer der `roles` sowie an den Server selbst (`rebase.sql()`, Cron-Jobs) zurückgibt. Fragen Sie immer den Namen des Views ab, niemals die gespeicherten Zeilen.

Die Zeilen entsprechen dem Stand der letzten Aktualisierung. Aktualisieren Sie mit `refresh()` – auf dem Server als `rebase.dataAsAdmin.langs.refresh()` oder über einen Client, der mit einer der Rollen angemeldet ist – oder über HTTP:

```typescript
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` liefert weiterhin die alten Zeilen aus, während die neuen berechnet werden. Dies erfordert den Unique Index, den Rebase auf den `.primaryKey()`-Spalten erstellt, sodass diese im Ergebnis der Abfrage eindeutig sein müssen. Um nach einem Zeitplan zu aktualisieren, rufen Sie `refresh()` aus einem [Cron-Job](/docs/backend/cron-jobs/) auf. Ein Materialized View kann eigene `indexes` besitzen (siehe [Indizes](/docs/backend/indexes/)), die auf seinen gespeicherten Zeilen aufbauen; ein regulärer View nutzt die Indizes seiner Tabellen.

## Was ein View nicht haben kann

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`rls`, `history`, `softDelete`, `tenant` und `search` werden beim Kompilieren des Schemas abgelehnt: Jedes davon benötigt eine Tabelle, in die geschrieben werden kann oder an die Richtlinien angehängt werden können. `roles` bei einem regulären View wird beim Laden des Moduls abgelehnt, ebenso wie eine leere `query`. `indexes` bei einem regulären View wird beim Kompilieren des Schemas abgelehnt.

Ein `listen` auf einem View registriert ein `refresh()`. Ein Schreibzugriff auf die Tabellen unterhalb eines Views erreicht die Abonnenten des Views nicht: Abonnieren Sie die Tabellen oder fragen Sie den View erneut ab.
