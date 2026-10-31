---
sourceHash: a1afbafa7c27ef28
title: Typisiertes SDK — Erste Schritte
sidebar_label: Erste Schritte
description: Installieren und konfigurieren Sie das typisierte Rebase-SDK, um von jeder JavaScript- oder TypeScript-Anwendung aus mit Ihrem Backend zu interagieren.
---

## Übersicht

Das Paket `@rebasepro/client` bietet ein typsicheres JavaScript-SDK für die Interaktion mit Ihrem Rebase-Backend. Es übernimmt:

- **Datenoperationen** — CRUD mit Filterung, Sortierung und Paginierung
- **Abrufen von Relationen** — Verknüpfte Entitäten mit `.include()` einbinden
- **Echtzeit-Abonnements** — WebSocket-basierte Live-Updates
- **Offline- & Local-First-Synchronisation** — Optionale lokale Zeilendatenbank, sofortige Offline-Schreibvorgänge, Live-Abfragen
- **Authentifizierung** — Token-Verwaltung, Anmeldung, Registrierung, OAuth
- **Speicher** — Datei-Upload, -Download und -Verwaltung
- **Benutzerdefinierte Funktionen** — Benutzerdefinierte Server-Endpunkte aufrufen

## Installation

```bash
pnpm add @rebasepro/client
```

## Erstellen eines Clients

`rebase dev` leitet einen freien Port aus dem Pfad des Projekts ab, anstatt einen festen zu verwenden. Lesen Sie **`baseUrl` daher aus der ausgegebenen URL ab** – es gibt keinen Port, den alle Projekte teilen. In einem Vite-Frontend ist dies die `VITE_API_URL`, die das Gerüst in die `.env` schreibt; in einem Skript eine eigene Umgebungsvariable.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

Die `websocketUrl` wird automatisch aus `baseUrl` abgeleitet (`http → ws`, `https → wss`). Sie können sie bei Bedarf explizit überschreiben:

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
| `websocketUrl` | `string` | WebSocket-URL – wird automatisch von `baseUrl` abgeleitet, falls weggelassen |
| `token` | `string` | Statisches JWT-Token für Server-zu-Server-Aufrufe |
| `apiPath` | `string` | API-Präfix (Standard: `"/api"`) |
| `fetch` | `typeof fetch` | Benutzerdefinierte fetch-Implementierung (z. B. für SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Benutzerdefinierter 401-Handler – `true` zurückgeben, um den Versuch zu wiederholen |
| `realtime` | `boolean \| RealtimeClientOptions` | Öffnet den WebSocket (Standard `true`) – in One-Shot-Skripten auf `false` setzen. `{ affinity }` [benennt die Gruppe, zu der der Socket gehört](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `collections` | `Record<string, string>` | Ordnet Accessor-Namen den Collection-Slugs zu |
| `offline` | `boolean \| OfflineConfig` | [Local-First-Synchronisation](/docs/sdk/offline) – standardmäßig deaktiviert |
| `impersonate` | `string` | Führt jede Anfrage als dieser Benutzer (per UID) aus, um zu prüfen, was ein Benutzer sehen kann. Nur in der Sitzung eines Administrators zulässig: Die Daten-API, Funktionen und Realtime laufen als dieser Benutzer, alle anderen Routen verweigern den Zugriff |
| `debug` | `boolean` | Protokolliert den Fortschritt der Realtime-Verbindung mit `console.debug` (Standard `false`) – siehe [Verbindungsprotokollierung](#verbindungsprotokollierung) |

### Verbindungsprotokollierung

Der Client gibt standardmäßig nichts über seine Realtime-Verbindung aus, sodass eine öffentliche Seite in der Konsole eines Besuchers nichts über ihr Backend preisgibt. Warnungen und Fehler werden immer ausgegeben. Um das Öffnen der Verbindung, die Anmeldung, Verbindungsabbrüche und Neuverbindungen zu sehen, übergeben Sie `debug: true` oder aktivieren Sie es in einem einzelnen Browser, ohne die Website zu ändern, indem Sie Folgendes in der Konsole ausführen:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Dies gilt ab der nächsten Zeile, die der Client protokolliert, sodass eine Seite, die bereits verbunden ist, nicht neu geladen werden muss. Außerhalb eines Browsers setzen Sie `globalThis.__REBASE_DEBUG__ = true`. Browser zeigen `console.debug` nur auf der Stufe „Ausführlich“ (Verbose) an.

## Generierung des typisierten SDKs

Generieren Sie einen vollständig typisierten Client aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

Während `rebase dev` läuft, müssen Sie dies nicht tun: Es generiert die Typen in `generated/sdk/` beim Start und bei jedem Speichern unter `config/collections/` neu. Führen Sie den Befehl selbst in CI aus, in einem Frontend-Repository ohne Collections (`rebase generate-sdk --from link`) oder überall dort, wo `rebase dev` nicht läuft. Auf 0.23 belässt `rebase dev` die SDK-Typen unverändert; führen Sie den Befehl daher nach jeder Änderung an Collections aus.

Übergeben Sie dann den Typparameter `Database` an `createRebaseClient` für vollständige Autovervollständigung:

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

Wenn `Database` angegeben wird, gibt `createRebaseClient` eine `CreateRebaseClientResult<DB>`-Instanz zurück. Dadurch werden Collection-Accessoren in camelCase direkt auf `client.data` ihren entsprechenden Typen zugeordnet, was Ihnen vollständige Autovervollständigung für Collection-Operationen und -Typen bietet (z. B. `client.data.products.find()`).

`collectionsDictionary` bildet jeden Accessor wieder auf den Slug ab, den die Schnittstelle verwendet. **`collections` ist für einen typisierten Client erforderlich.** Die Typen bieten jeden Accessor an, unabhängig davon, ob Sie ihn übergeben oder nicht. Ohne ihn wird `client.data.myNotes` jedoch an `/data/my_notes` gesendet (der Accessor in snake_case), sodass ein Slug wie `my-notes` oder ein umbenannter Accessor einen 404-Fehler liefert. Der Client warnt einmalig und benennt den Accessor sowie die Lösung. Eine spätere Version wird `collections` in den Typen als erforderlich vorschreiben, wenn `Database` übergeben wird.

Einige Namen auf `client.data` sind bereits belegt: `collection` ist die dynamische Funktion `collection(slug)`, und `then`, `toJSON` sowie `$$typeof` bleiben für Promise- und Serialisierungsprüfungen reserviert. Eine Collection, deren Accessor einer dieser Namen wäre, wird als `<name>Collection` generiert – der Slug `collection` wird zu `client.data.collectionCollection` – und `generate-sdk` gibt eine Warnung aus, die beides benennt. `client.data.collection("collection")` erreicht sie ebenfalls.

### Feldnamen

**Der Name eines Feldes bei der Übertragung ist sein Property-Schlüssel**, und die API verwendet durchgehend camelCase. Eine `createdAt`-Property, die in einer `created_at`-Spalte gespeichert ist, lautet `row.createdAt`, und der Fremdschlüssel einer Relation ist `authorId`, auch wenn die Spalte `author_id` bleibt. `where` und `orderBy` basieren auf demselben `Row`-Typ, sodass das, was kompiliert, auch dem entspricht, worauf das Backend antwortet.

Ein Property-Schlüssel, den *Sie* geschrieben haben, bleibt Ihr Schlüssel, unabhängig von seiner Form – nichts benennt einen von Ihnen gewählten Namen um. Die beiden Schlüssel, die abgeleitet statt deklariert werden – der Fremdschlüssel einer Relation und eine durch Introspektion ausgelesene Spalte –, sind in camelCase.

`Row` beschreibt einen Lesevorgang, `Insert` ein `create()` und `Update` ein `update()` – sie haben nicht dieselbe Struktur. Eine Spalte, die nicht erforderlich ist, ist bei allen dreien `T | null`, sodass ein Schreibvorgang sie leeren kann; der Primärschlüssel ist bei einem Lesevorgang immer vorhanden und bei einem Update niemals setzbar; ein `belongsTo`-Ziel kann entweder als Relation (`{ author: 5 }`) oder als Fremdschlüssel (`{ authorId: 5 }`) geschrieben werden, wobei ein Pflichtfeld durch beides erfüllt wird; ein `hasOne` wird durch Benennen der Zielzeile (`{ profile: 9 }`) geschrieben oder durch `null`, um die Verknüpfung aufzuheben; ein Single-Hop-`via` wird als die Art geschrieben, für die es steht (To-One: die ID des Ziels oder `null`; To-Many: eine Liste von IDs), und ein Multi-Hop-`via` ist schreibgeschützt und in keinem von beiden enthalten; und eine `hasMany`- oder `manyToMany`-Zugehörigkeit wird als Liste von Ziel-IDs oder `{ id }`-Objekten (`{ tags: ["t-1"] }`) geschrieben, die jeweils ein `_pivot` tragen, wenn die Junction-Tabelle Payload-Spalten deklariert. Ein Feld, das niemand schreiben darf (`access: { write: [] }`), ist weder in `Insert` noch in `Update` enthalten. Eine `date`-Spalte wird als ISO-String gelesen, und ein Schreibvorgang akzeptiert entweder diesen String oder ein `Date`.

## Schnelles Beispiel

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

In einem Rebase-Frontend wird der Client einmal erstellt und über den Context geteilt:

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
- **[Offline- & Local-First-Synchronisation](/docs/sdk/offline)** — Ohne Verbindung arbeiten und synchronisieren, sobald sie wieder verfügbar ist
- **[Speicher & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
