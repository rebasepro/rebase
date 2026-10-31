---
sourceHash: a1afbafa7c27ef28
title: Typisiertes SDK — Erste Schritte
sidebar_label: Erste Schritte
description: Installieren und konfigurieren Sie das typisierte SDK von Rebase, um von jeder JavaScript- oder TypeScript-Anwendung aus mit Ihrem Backend zu interagieren.
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
| `realtime` | `boolean \| RealtimeClientOptions` | WebSocket öffnen (Standard `true`) — in Einmalskripten auf `false` setzen. `{ affinity }` [benennt die Gruppe, zu der der Socket gehört](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `collections` | `Record<string, string>` | Weist Accessor-Namen den Slugs von Collections zu |
| `offline` | `boolean \| OfflineConfig` | [Local-First-Synchronisation](/docs/sdk/offline) — standardmäßig deaktiviert |
| `impersonate` | `string` | Jede Anfrage als dieser Benutzer ausführen (per uid), um zu prüfen, was ein Benutzer sehen kann. Nur mit der Sitzung eines Administrators: Daten-API, Functions und Realtime laufen als dieser Benutzer, jede andere Route lehnt ab |
| `debug` | `boolean` | Den Fortschritt der Realtime-Verbindung mit `console.debug` protokollieren (Standard `false`) — siehe [Verbindungsprotokoll](#verbindungsprotokoll) |

### Verbindungsprotokoll

Standardmäßig gibt der Client nichts über seine Realtime-Verbindung aus, sodass eine öffentliche Seite in der Konsole eines Besuchers nichts über ihr Backend verrät. Warnungen und Fehler werden immer ausgegeben. Um zu sehen, wie die Verbindung aufgebaut, angemeldet, getrennt und neu gewählt wird, übergeben Sie `debug: true` – oder schalten Sie es in einem einzelnen Browser ein, ohne die Seite zu ändern, indem Sie dies in seiner Konsole ausführen:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Es gilt ab der nächsten Zeile, die der Client protokolliert; eine bereits verbundene Seite muss nicht neu geladen werden. Außerhalb eines Browsers setzen Sie `globalThis.__REBASE_DEBUG__ = true`. Browser zeigen `console.debug` nur auf der Stufe „Ausführlich“ (Verbose) an.

## Generierung eines typisierten SDKs

Generieren Sie einen vollständig typisierten Client aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

Solange `rebase dev` läuft, ist das nicht nötig: Es generiert die Typen in
`generated/sdk/` beim Start und bei jedem Speichern unter `config/collections/` neu.
Selbst ausführen müssen Sie den Befehl in CI, in einem Frontend-Repository ohne
Collections (`rebase generate-sdk --from link`) oder überall dort, wo `rebase dev`
nicht läuft.
Unter 0.23 lässt `rebase dev` die SDK-Typen unberührt, führen Sie den Befehl daher nach
jeder Collection-Änderung aus.

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

`collectionsDictionary` bildet jeden Accessor wieder auf den Slug ab, der über die Leitung (Wire) verwendet wird. **`collections` ist für einen typisierten Client erforderlich.** Die Typen bieten jeden Accessor an, ob Sie es übergeben oder nicht, aber ohne es wird `client.data.myNotes` an `/data/my_notes` gesendet, den Accessor in snake_case, sodass ein Slug wie `my-notes` oder ein umbenannter Accessor mit 404 antwortet. Der Client warnt einmal und nennt den Accessor und die Abhilfe. Eine spätere Version macht `collections` in den Typen erforderlich, wenn `Database` übergeben wird.

Einige Namen auf `client.data` sind vergeben: `collection` ist die dynamische Funktion `collection(slug)`, und `then`, `toJSON` und `$$typeof` bleiben für Promise- und Serialisierungsprüfungen unangetastet. Eine Collection, deren Accessor einer davon wäre, wird als `<name>Collection` generiert – der Slug `collection` ist `client.data.collectionCollection` – und `generate-sdk` gibt eine Warnung aus, die beide nennt. `client.data.collection("collection")` erreicht sie ebenfalls.

### Feldnamen

**Der Name eines Feldes über die Leitung (on the wire) ist sein Property-Schlüssel**, und die API ist durchgehend in camelCase gehalten. Eine `createdAt`-Property, die in einer `created_at`-Spalte gespeichert ist, lautet `row.createdAt`, und der Fremdschlüssel einer Relation ist `authorId`, auch wenn die Spalte weiterhin `author_id` heißt. `where` und `orderBy` basieren auf demselben `Row`-Typ, sodass das, was kompiliert, auch dem entspricht, worauf das Backend antwortet.

Ein von *Ihnen* geschriebener Property-Schlüssel bleibt Ihr Schlüssel, unabhängig von seiner Schreibweise — nichts benennt einen von Ihnen gewählten Namen um. Die beiden Schlüssel, die eher abgeleitet als deklariert werden – der Fremdschlüssel einer Relation und eine durch Introspektion zurückgelesene Spalte –, sind in camelCase gehalten.

`Row` beschreibt einen Lesevorgang, `Insert` ein `create()` und `Update` ein `update()` — sie haben nicht dieselbe Struktur. Eine Spalte, die nicht erforderlich ist, ist bei allen drei als `T | null` definiert, sodass ein Schreibvorgang sie leeren kann; der Primärschlüssel ist bei einem Lesevorgang immer vorhanden und bei einem Update niemals setzbar; ein `belongsTo`-Ziel kann entweder als Relation (`{ author: 5 }`) oder als Fremdschlüssel (`{ authorId: 5 }`) geschrieben werden, und ein erforderliches wird von beidem erfüllt; ein `hasOne` wird geschrieben, indem die Zielzeile genannt wird (`{ profile: 9 }`), oder mit `null`, um die Verknüpfung zu lösen; ein einstufiges `via` wird als die Art geschrieben, für die es steht (To-one: die ID des Ziels oder `null`; To-many: eine Liste von IDs), und ein mehrstufiges ist schreibgeschützt und in keinem von beiden; und eine `hasMany`- oder `manyToMany`-Mitgliedschaft wird als Liste von Ziel-IDs oder `{ id }`-Objekten geschrieben (`{ tags: ["t-1"] }`), jedes mit einem `_pivot`, wenn die Zwischentabelle (Junction) Payload-Spalten deklariert. Ein Feld, das niemand schreiben darf (`access: { write: [] }`), ist weder in `Insert` noch in `Update` enthalten. Eine `date`-Spalte wird als ISO-String gelesen, und ein Schreibvorgang akzeptiert diesen String oder ein `Date`.

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
