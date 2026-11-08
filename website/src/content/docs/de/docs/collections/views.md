---
sourceHash: 040afb7b119d3d2a
title: Views
sidebar_label: Views
description: Stellen Sie eine SQL-View oder Materialized View als schreibgeschützte Collection bereit, deklariert in der Konfiguration und erstellt durch db push.
---

## Eine Collection über einer Abfrage

Eine Collection kann statt einer Tabelle eine SQL-View bereitstellen. Deklarieren Sie die Abfrage unter
`view`, beschreiben Sie ihre Spalten als Properties und markieren Sie die Spalte, die eine
Zeile identifiziert, mit `isId` — eine View hat keinen eigenen Primärschlüssel:

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    slug: "artists",
    name: "Artists",
    table: "artist_stats",
    view: {
        query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
                FROM songs GROUP BY 1`
    },
    properties: {
        artist: { name: "Artist", type: "string", isId: true },
        songs: { name: "Songs", type: "number" },
        fame: { name: "Fame", type: "number" }
    }
});
```

Sie wird wie jede andere Collection gelesen — `find`, `findById`, `count`,
[`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, die REST-Routen, MCP und das Admin-Panel — und ist schreibgeschützt: Jeder
Schreibvorgang ergibt ein `405 COLLECTION_READ_ONLY`, und das Admin-Panel bietet kein Erstellen, Bearbeiten oder
Löschen an. Schreiben Sie in die Tabellen, die die View liest.

`rebase db push` erstellt die View nach den Tabellen (sie wird von Rebase angewendet,
nicht von Atlas), `rebase db generate` hängt sie an die Migration an, und ein Managed-
Boot erstellt sie in seinem Schema-Schritt. Eine View, deren Abfrage sich nicht geändert hat, bleibt
unberührt; eine, deren Abfrage sich geändert hat, wird gelöscht und neu erstellt, zusammen mit allen
Ihren Views, die sie lesen. Rebase weigert sich, eine Tabelle oder eine View, die es nicht
erstellt hat und die bereits diesen Namen trägt, zu ersetzen.

## Wer welche Zeilen sieht

Eine einfache View läuft **als Aufrufer** (`security_invoker`), sodass die Policies der
Tabellen, die sie liest, entscheiden, was jeder Aufrufer sieht: Ein Benutzer, dessen Policies ihm
seine eigenen Songs zeigen, sieht die View seiner eigenen Songs. Deshalb
können auf einer View keine `securityRules` deklariert werden — es gibt nichts, woran man sie
anhängen könnte, und nichts, was sie hinzufügen könnten. Siehe [Sicherheitsregeln](/docs/collections/security-rules/) für
die Policies auf den darunterliegenden Tabellen.

## Materialized Views

`materialized: true` speichert die Zeilen, sodass ein Lesevorgang die Abfrage nicht ausführt:

```ts
view: {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"]
}
```

Postgres legt keine Row-Level Security auf eine Materialized View: Wer sie lesen darf,
liest alles. Deshalb stellt Rebase sie nur Aufrufern bereit, die eine der `roles` besitzen
(`["admin"]`, wenn weggelassen, was `dataAsAdmin` besitzt), und weist alle anderen
mit `403 VIEW_NOT_READABLE` ab. Legen Sie nichts hinein, was ihre Leser nicht sehen dürfen.

Die Zeilen entsprechen dem Stand der letzten Aktualisierung. Aktualisieren Sie mit `refresh()` — auf dem Server
als `rebase.dataAsAdmin.langs.refresh()`, oder von einem Client, der mit einer der
Rollen angemeldet ist — oder über HTTP:

```ts
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` liefert weiter die alten Zeilen aus, während die neuen berechnet werden; es
benötigt den eindeutigen Index, den Rebase auf den `isId`-Spalten erstellt, diese müssen also
im Ergebnis der Abfrage eindeutig sein. Um zeitgesteuert zu aktualisieren, rufen Sie `refresh()` aus einem
[Cron-Job](/docs/backend/cron-jobs/) auf. Eine Materialized View kann eigene `indexes` besitzen
(siehe [Indizes](/docs/backend/indexes/)); eine einfache View nutzt die
Indizes ihrer Tabellen.

## Was eine View nicht haben kann

`securityRules`, `history`, `softDelete`, `tenant` und `search` werden beim
Boot abgelehnt, weil jedes eine Tabelle braucht, in die geschrieben werden kann oder an die es sich anhängen lässt.

Ein `listen` auf einer View bekommt ein `refresh()` mit. Ein Schreibvorgang auf die Tabellen unter einer
View erreicht die Abonnenten der View nicht: Abonnieren Sie die Tabellen oder
lesen Sie die View erneut.
