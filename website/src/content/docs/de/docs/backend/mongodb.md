---
sourceHash: 239a291d53ade1fd
title: MongoDB
sidebar_label: MongoDB
description:"\"@rebasepro/server-mongo führt Rebase auf MongoDB aus: ein vollständiger Datentreiber, Change-Stream-Echtzeit und Snapshot-Historie – und keine Row-Level Security.\""
---

`@rebasepro/server-mongo` implementiert Rebase's `BackendBootstrapper` für
MongoDB. Die REST-API, das generierte SDK, das Admin-Panel und die Auth-Oberfläche
funktionieren alle darüber.

:::caution[Experimentell, und ohne Row-Level Security]
Lesen Sie diesen Abschnitt, bevor Sie sich dafür entscheiden. MongoDB hat kein
Äquivalent zur Row-Level Security von PostgreSQL, daher **gilt das Isolationsmodell,
auf dem der Rest von Rebase aufbaut, hier nicht**. `securityRules` für eine Collection
werden nicht von der Datenbank erzwungen; die Autorisierung ist das, was Ihr eigener
Code prüft.

Das ist keine Lücke, die noch geschlossen werden muss – es ist eine Eigenschaft
der Engine. Wenn eine Autorisierung auf Zeilenebene, die unterhalb der Anwendungsebene
erzwungen wird, der Grund dafür ist, dass Sie sich für Rebase interessieren,
verwenden Sie den PostgreSQL-Treiber – unter [Backend Setup](/docs/backend/) wird
er konfiguriert, und [Security Rules](/docs/collections/security-rules/) zeigt,
welche Vorteile er bietet.
:::

## Installation

```bash
pnpm add @rebasepro/server-mongo
```

```ts title="backend/src/index.ts" no-verify
import { rebase } from "@rebasepro/server";
import { createMongoBootstrapper } from "@rebasepro/server-mongo";

rebase({
    backend: createMongoBootstrapper({ url: process.env.DATABASE_URL! })
});
```

Setzen Sie `DATABASE_URL` auf einen MongoDB-Verbindungsstring
(`mongodb://…` oder `mongodb+srv://…`).

## Was funktioniert

| | |
|---|---|
| **Daten-API** | Der gesamte REST-Umfang: List, Get, Create, Update, Delete, Filter, Sortierung, Paginierung |
| **Generiertes SDK** | Derselbe typisierte Client wie bei Postgres |
| **Echtzeit** | Change Streams. Dies erfordert ein Replica Set – ein eigenständiger `mongod` hat kein Oplog zum Auslesen, daher ist Echtzeit dort stillschweigend nicht verfügbar |
| **Historie** | Snapshot-basiert, in der gleichen Form wie bei Postgres |
| **Auth** | Der gesamte Auth-Umfang, wobei die Repositories in MongoDB gespeichert werden |
| **Admin-Panel** | Collections, Formulare, Relationen in der UI, Storage-Felder |

## Was anders ist

- **Keine Row-Level Security.** Siehe Warnung oben. Dies ist der entscheidende Punkt.
- **Keine SQL-Oberfläche.** Der SQL-Editor von Studio, der RLS-Policy-Editor und
  `pnpm rls:check` sind Postgres-Funktionen und stehen nicht zur Verfügung.
- **Keine relationale Integrität.** Eine Relation ist eine gespeicherte Referenz,
  die von der Anwendung aufgelöst wird; es gibt keinen Fremdschlüssel, sodass
  auf Datenbankebene nichts das Entstehen verwaister Referenzen verhindert.
- **Kein `rebase db push` / `generate` / `migrate`.** MongoDB hat kein Schema zum
  Migrieren. Collections entstehen, sobald Dokumente geschrieben werden.

## Die Wahl zwischen beiden

Wählen Sie MongoDB, wenn die Daten tatsächlich dokumentbasiert sind und das
Autorisierungsmodell ohnehin in Ihrer Anwendung liegt. Wählen Sie PostgreSQL,
wenn die Datenbank selbst durchsetzen soll, wer welche Zeile sieht – was das
Argument ist, das Rebase an jeder anderen Stelle auf dieser Website vertritt.
