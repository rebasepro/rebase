---
sourceHash: 35d04e650c33c5cb
title: Typisiertes SDK — Erste Schritte
sidebar_label: Erste Schritte
description: Installieren und konfigurieren Sie das Rebase Client SDK, um von jeder JavaScript- oder TypeScript-Anwendung aus mit Ihrem Backend zu interagieren.
---

## Übersicht

Das Paket `@rebasepro/client` bietet ein typsicheres JavaScript-SDK für die Interaktion mit Ihrem Rebase-Backend. Es umfasst:

- **Datenoperationen** — CRUD mit Filtern, Sortieren und Paginierung
- **Laden von Relationen** — Verknüpfte Entitäten mit `.include()` einbinden
- **Echtzeit-Abonnements** — WebSocket-basierte Live-Updates
- **Offline & Local-First-Synchronisation** — Optionale lokale Zeilendatenbank, sofortige Offline-Schreibvorgänge, Live-Abfragen
- **Authentifizierung** — Token-Verwaltung, Anmeldung, Registrierung, OAuth
- **Storage** — Datei-Upload, -Download und -Verwaltung
- **Eigene Funktionen** — Aufrufen benutzerdefinierter Server-Endpunkte

## Installation

```bash
pnpm add @rebasepro/client
```

## Erstellen eines Clients

`rebase dev` leitet einen freien Port vom Pfad des Projekts ab, anstatt einen festen Port zu verwenden. **Lesen Sie daher `baseUrl` aus der ausgegebenen URL ab** — es gibt keinen Port, den sich alle Projekte teilen. In einem Vite-Frontend ist dies die `VITE_API_URL`, die das Scaffold in die `.env`-Datei schreibt; in einem Skript eine eigene Umgebungsvariable.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

Die `websocketUrl` wird automatisch aus der `baseUrl` abgeleitet (`http → ws`, `https → wss`). Bei Bedarf können Sie diese explizit überschreiben:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Konfigurationsoptionen

| Option | Typ | Beschreibung |
|--------|------|-------------|
| `baseUrl` | `string` | Backend-URL. Lesen Sie diese aus der Ausgabe von `rebase dev` ab oder aus Ihrem Deployment |
| `websocketUrl` | `string` | WebSocket-URL — wird automatisch aus `baseUrl` abgeleitet, falls nicht angegeben |
| `token` | `string` | Statisches JWT-Token für Server-zu-Server-Aufrufe |
| `apiPath` | `string` | API-Präfix (Standard: `"/api"`) |
| `fetch` | `typeof fetch` | Eigene fetch-Implementierung (z. B. für SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Eigener 401-Handler — geben Sie `true` zurück, um den Versuch zu wiederholen |
| `realtime` | `boolean` | WebSocket öffnen (Standard `true`) — in Einmalskripten auf `false` setzen |
| `collections` | `Record<string, string>` | Weist Accessor-Namen den Slugs von Collections zu |
| `offline` | `boolean \| OfflineConfig` | [Local-First-Synchronisation](/docs/sdk/offline) — standardmäßig deaktiviert |

## Generierung eines typisierten SDKs

Generieren Sie einen vollständig typisierten Client aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

Übergeben Sie anschließend den Typparameter `Database` an `createRebaseClient` für vollständige Autovervollständigung:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full autocomplete on collection names and field types
const { data } = await client.data.products.find();
```

Wenn `Database` übergeben wird, gibt `createRebaseClient` eine Instanz von `CreateRebaseClientResult<DB>` zurück. Dadurch werden camelCase-Collection-Accessoren auf `client.data` direkt ihren entsprechenden Typen zugeordnet, was Ihnen eine vollständige Autovervollständigung für Collection-Operationen und Typen bietet (z. B. `client.data.products.find()`).

`collectionsDictionary` bildet jeden Accessor wieder auf den Slug ab, der über die Leitung (Wire) verwendet wird. Übergeben Sie es immer dann, wenn ein Slug noch kein gültiger Property-Name ist — `my-notes` ist nur deshalb als `client.data.myNotes` erreichbar, weil das Dictionary dies festlegt.

### Feldnamen

**Der Name eines Feldes über die Leitung (on the wire) ist sein Property-Schlüssel**, und die API ist durchgehend in camelCase gehalten. Eine `createdAt`-Property, die in einer `created_at`-Spalte gespeichert ist, lautet `row.createdAt`, und der Fremdschlüssel einer Relation ist `authorId`, auch wenn die Spalte weiterhin `author_id` heißt. `where` und `orderBy` basieren auf demselben `Row`-Typ, sodass das, was kompiliert, auch dem entspricht, worauf das Backend antwortet.

Ein von *Ihnen* geschriebener Property-Schlüssel bleibt Ihr Schlüssel, unabhängig von seiner Schreibweise — nichts benennt einen von Ihnen gewählten Namen um. Die beiden Schlüssel, die eher abgeleitet als deklariert werden – der Fremdschlüssel einer Relation und eine durch Introspektion zurückgelesene Spalte –, sind in camelCase gehalten.

`Row` beschreibt einen Lesevorgang, `Insert` ein `create()` und `Update` ein `update()` — sie haben nicht dieselbe Struktur. Nullable-Spalten sind auf `Row` als `T | null` definiert, der Primärschlüssel ist bei einem Lesevorgang immer vorhanden und bei einem Update niemals setzbar, und ein `belongsTo`-Ziel kann entweder als Relation (`{ author: 5 }`) oder als Fremdschlüssel (`{ authorId: 5 }`) geschrieben werden.

## Kurzes Beispiel

```typescript
// Create
const product = await client.data.products.create({
    name: "Camera",
    price: 299,
});

// Query with filters
const { data } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();

// Real-time subscription
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] } },
    (response) => console.log("Updated:", response.data)
);
```

## Verwendung mit React

In einem Rebase-Frontend wird der Client einmalig erstellt und über einen Kontext bereitgestellt:

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
- **[Authentifizierung](/docs/sdk/authentication)** — Anmelden, Registrieren, OAuth, Sitzungen
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Offline & Local-First-Synchronisation](/docs/sdk/offline)** — Ohne Verbindung arbeiten und synchronisieren, sobald diese wiederhergestellt ist
- **[Storage & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
