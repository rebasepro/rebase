---
sourceHash: d3b3f413d231c3d0
title: Typisiertes SDK — Erste Schritte
sidebar_label: Erste Schritte
description: Installieren und konfigurieren Sie das typisierte Rebase-SDK, um von jeder JavaScript- oder TypeScript-Anwendung aus mit Ihrem Backend zu interagieren.
---

## Übersicht

Das Paket `@rebasepro/client` bietet ein typsicheres JavaScript-SDK für die Interaktion mit Ihrem Rebase-Backend. Es umfasst:

- **Datenoperationen** — CRUD mit Filterung, Sortierung und Paginierung
- **Abrufen von Relationen** — Verknüpfte Entitäten mit `.include()` einbinden
- **Echtzeit-Abonnements** — WebSocket-basierte Live-Updates
- **Offline & Local-First-Synchronisierung** — Opt-in lokale Zeilendatenbank, sofortige Offline-Schreibvorgänge, Live-Abfragen
- **Authentifizierung** — Token-Verwaltung, Anmeldung, Registrierung, OAuth
- **Speicher** — Datei-Upload, -Download und -Verwaltung
- **Benutzerdefinierte Funktionen** — Aufrufen benutzerdefinierter Server-Endpunkte

## Installation

```bash
pnpm add @rebasepro/client
```

## Einen Client erstellen

`rebase dev` leitet einen freien Port aus dem Pfad des Projekts ab, anstatt einen festen Port zu verwenden. **Lesen Sie `baseUrl` daher aus der ausgegebenen URL ab** — es gibt keinen Port, den sich alle Projekte teilen. In einem Vite-Frontend ist dies `VITE_API_URL`, die das Scaffold in `.env` schreibt; in einem Skript eine eigene Umgebungsvariable.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

Die `websocketUrl` wird automatisch von `baseUrl` abgeleitet (`http → ws`, `https → wss`). Sie können sie bei Bedarf explizit überschreiben:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Konfigurationsoptionen

| Option | Typ | Beschreibung |
|--------|------|-------------|
| `baseUrl` | `string` | Backend-URL. Lesen Sie diese aus der Ausgabe von `rebase dev` oder aus Ihrem Deployment ab |
| `websocketUrl` | `string` | WebSocket-URL — wird automatisch aus `baseUrl` abgeleitet, falls weggelassen |
| `token` | `string` | Statisches JWT-Token für Server-zu-Server-Aufrufe |
| `apiPath` | `string` | API-Präfix (Standard: `"/api"`) |
| `fetch` | `typeof fetch` | Benutzerdefinierte fetch-Implementierung (z. B. für SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Benutzerdefinierter 401-Handler — `true` zurückgeben, um den Versuch zu wiederholen |
| `realtime` | `boolean \| RealtimeClientOptions` | WebSocket öffnen (Standard `true`) — in Einmalskripten auf `false` setzen. `{ affinity }` [benennt die Gruppe, zu der der Socket gehört](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `tables` | `Record<string, string>` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Ordnet Accessor-Namen den Tabellen-Slugs zu — das generierte `tablesDictionary` |
| `offline` | `boolean \| OfflineConfig` | [Local-First-Synchronisierung](/docs/sdk/offline) — standardmäßig deaktiviert |
| `impersonate` | `string` | Führt jede Anfrage als dieser Benutzer aus (per uid), um zu prüfen, was ein Benutzer sehen kann. Nur für die Sitzung eines Administrators zulässig: Die Daten-API, Funktionen und Realtime laufen als dieser Benutzer, und jede andere Route lehnt die Anfrage ab |
| `debug` | `boolean` | Protokolliert den Fortschritt der Realtime-Verbindung mit `console.debug` (Standard `false`) — siehe [Verbindungsprotokollierung](#verbindungsprotokollierung) |

### Verbindungsprotokollierung

Der Client gibt standardmäßig nichts über seine Realtime-Verbindung aus, sodass eine öffentliche Seite in der Konsole eines Besuchers keine Informationen über ihr Backend preisgibt. Warnungen und Fehler werden immer ausgegeben. Um zu sehen, wie die Verbindung geöffnet wird, sich anmeldet, abbricht und sich neu verbindet, übergeben Sie `debug: true`, oder aktivieren Sie es in einem einzelnen Browser, ohne die Website zu ändern, indem Sie Folgendes in dessen Konsole ausführen:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") zum Beenden
```

Dies gilt ab der nächsten Zeile, die der Client protokolliert, sodass eine bereits verbundene Seite nicht neu geladen werden muss. Außerhalb eines Browsers setzen Sie `globalThis.__REBASE_DEBUG__ = true`. Browser zeigen `console.debug` nur auf der Stufe „Ausführlich“ (Verbose) an.

## Typisierte SDK-Generierung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Generieren Sie einen vollständig typisierten Client aus Ihren Tabellen:

```bash
rebase generate-sdk
```

Während `rebase dev` läuft, müssen Sie dies nicht tun: Es regeneriert die Typen in `generated/sdk/` beim Start und bei jedem Speichervorgang unter `backend/schema/`. Führen Sie den Befehl selbst in CI aus, in einem Frontend-Repository, das keine eigenen Tabellen hat (`rebase generate-sdk --from link`), oder überall dort, wo `rebase dev` nicht ausgeführt wird. `generate-sdk` liest die Tabellen, die `backend/schema/index.ts` exportiert, über denselben Loader, aus dem das Backend startet; `--from` liest stattdessen die `tables` aus `/api/meta/contract` eines laufenden Backends.

Übergeben Sie dann den Typparameter `Database` an `createRebaseClient` für eine vollständige Autovervollständigung:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Vollständige Autovervollständigung für Tabellennamen und Feldtypen
const { data } = await client.data.products.find();
```

Wenn `Database` angegeben ist, gibt `createRebaseClient` eine `CreateRebaseClientResult<DB>`-Instanz zurück. Dadurch werden camelCase-Tabellen-Accessoren direkt auf `client.data` ihren entsprechenden Typen zugeordnet, was Ihnen eine vollständige Autovervollständigung für Tabellenoperationen und Typen bietet (z. B. `client.data.products.find()`).

`tablesDictionary` ordnet jeden Accessor wieder dem Slug zu, der über die Leitung verwendet wird. Das generierte Modul exportiert außerdem `TableName`, die Vereinigung aller Slugs, sowie den Typ `TablesDictionary`. **`tables` ist für einen typisierten Client erforderlich.** Die Typen bieten jeden Accessor an, unabhängig davon, ob Sie ihn übergeben oder nicht, aber ohne ihn wird `client.data.myNotes` an `/data/my_notes` gesendet (der Accessor in snake_case), sodass ein Slug wie `my-notes` oder ein umbenannter Accessor mit 404 antwortet. Der Client warnt einmalig und nennt den Accessor sowie die Behebung. Mit dem Dictionary löst ein Accessor, der sich nicht darin befindet, einen `RebaseClientError` mit dem Code `UNKNOWN_TABLE` und einem Vorschlag aus. Eine spätere Version wird `tables` in den Typen zur Pflicht machen, wenn `Database` angegeben ist.

Einige Namen auf `client.data` sind bereits belegt: `table` ist die dynamische Funktion `table(slug)`, `batch` ist [`client.batch`](/docs/sdk/writing/#writing-across-tables), und `then`, `toJSON` sowie `$$typeof` bleiben für Promise- und Serialisierungsprüfungen unberührt. Eine Tabelle, deren Accessor `table`, `then`, `toJSON` oder `$$typeof` lauten würde, wird als `<name>Table` generiert — der Slug `table` lautet `client.data.tableTable` — und `generate-sdk` gibt eine Warnung aus, die beide nennt. `client.data.table("table")` erreicht sie ebenfalls und ist der Weg, wie eine Tabelle erreicht wird, deren Accessor `batch` wäre. `data.table(slug)` verweigert einen Slug mit einem `.`- oder `..`-Segment, der `/data` verlassen würde, mit `INVALID_TABLE_PATH`.

### Feldnamen

**Der Name eines Feldes über die Leitung ist sein Spaltenschlüssel**, und die API ist durchgehend in camelCase gehalten. Eine `createdAt`-Spalte, die als `created_at` gespeichert ist, lautet `row.createdAt`, und der Fremdschlüssel einer Relation lautet `authorId`, auch wenn die Spalte `author_id` bleibt. `where` und `orderBy` orientieren sich am selben `Row`-Typ, sodass das kompiliert, worauf das Backend antwortet.

Ein Spaltenschlüssel, den *Sie* geschrieben haben, ist Ihr Schlüssel, unabhängig von seiner Form — nichts benennt einen von Ihnen gewählten Namen um. Die beiden Schlüssel, die abgeleitet statt deklariert werden (der Fremdschlüssel einer Relation und eine durch Introspektion ausgelesene Spalte), sind in camelCase.

`Row` beschreibt einen Lesevorgang, `Insert` ein `create()` und `Update` ein `update()` — sie haben nicht dieselbe Struktur. Eine Spalte, die nicht erforderlich ist, ist bei allen dreien `T | null`, sodass ein Schreibvorgang sie leeren kann; der Primärschlüssel ist bei einem Lesevorgang immer vorhanden und bei einem Update niemals setzbar; ein `belongsTo`-Ziel kann entweder als die Relation (`{ author: 5 }`) oder als ihr Fremdschlüssel (`{ authorId: 5 }`) geschrieben werden, und eine erforderliche Relation wird durch beides erfüllt; ein `hasOne` wird durch Benennung der Zielzeile (`{ profile: 9 }`) oder `null` geschrieben, um die Verknüpfung aufzuheben; ein Single-Hop-`via` wird als die Art geschrieben, für die es steht (To-One: die ID des Ziels oder `null`; To-Many: eine Liste von IDs), und ein Multi-Hop-`via` ist schreibgeschützt und in keinem von beiden enthalten; und eine `hasMany`- oder `manyToMany`-Zugehörigkeit wird als Liste von Ziel-IDs oder `{ id }`-Objekten (`{ tags: ["t-1"] }`) geschrieben, die jeweils ein `_pivot` tragen, wenn die Junction-Tabelle Payload-Spalten deklariert. Ein Feld, das niemand schreiben darf (`.access({ write: [] })`), ist weder in `Insert` noch in `Update` enthalten. Eine `date`-Spalte wird als ISO-String gelesen, und ein Schreibvorgang akzeptiert entweder diesen String oder ein `Date`.

## Schnelles Beispiel

```typescript
// Erstellen
const product = await client.data.products.create({
    name: "Camera",
    price: 299,
});

// Mit Filtern abfragen
const { data } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();

// Echtzeit-Abonnement
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] } },
    (response) => console.log("Updated:", response.data)
);
```

## Verwendung mit React

In einem Rebase-Frontend wird der Client einmal erstellt und über den Kontext geteilt:

```tsx no-verify
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL });

<Rebase client={client} ...>
```

Greifen Sie von jeder Komponente aus darauf zu:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // client.data, client.auth, client.storage, client.functions
}
```

## Nächste Schritte

- **[Daten abfragen](/docs/sdk/querying)** — CRUD, Filter, Paginierung und Relationen
- **[Authentifizierung](/docs/sdk/authentication)** — Anmeldung, Registrierung, OAuth, Sitzungen
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Offline & Local-First-Synchronisierung](/docs/sdk/offline)** — Ohne Verbindung arbeiten und synchronisieren, sobald sie wiederhergestellt ist
- **[Speicher & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
