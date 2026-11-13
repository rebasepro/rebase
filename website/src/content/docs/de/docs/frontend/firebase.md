---
sourceHash: 6995a63f34afa39a
title: Firestore neben Postgres
sidebar_label: Firebase
description: "Firestore-Collections im CMS neben Ihren Postgres-Tabellen anzeigen: defineFirestoreCollection, useFirestoreDataSource, externalCollections und Referenzen, die Firestore-Dokumente und Postgres-Zeilen in beide Richtungen verbinden."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`@rebasepro/firebase` ermöglicht es dem CMS, Firestore-Collections über das
Firebase-SDK direkt im Browser neben den Tabellen zu lesen und zu schreiben, die
Ihr Rebase-Backend bereitstellt. Eine Navigation, eine Suche, eine
Referenzauswahl: Operatoren müssen nicht wissen, in welcher Engine ein Datensatz
gespeichert ist.

Firestore ist hier eine reine Frontend-Angelegenheit. Das Backend weiß nichts
davon, und eine Firestore-Collection wird in `frontend/src/cms/` deklariert,
niemals in `backend/schema`.

:::caution[Firestore-Collections werden direkt aus dem Browser gelesen]
Nichts zwischen dem Browser und Firestore stammt von Rebase: Row-Level Security,
die REST-API, das generierte SDK, Functions, Crons und das Storage-Zugriffsmodell
gelten nicht für eine Firestore-Collection. Wer deren Dokumente lesen und
schreiben darf, wird durch **Firebase Security Rules** bestimmt, die in
Firebase geschrieben und bereitgestellt werden.
:::

## Installation

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
pnpm add @rebasepro/firebase firebase
```

Peer-Dependencies: `firebase` (10, 11 oder 12), `react` ≥ 19, `react-dom` ≥ 19
und optional `typesense` für die Volltextsuche.

## Eine Firestore-Collection deklarieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```ts
// frontend/src/cms/events.ts
import { defineFirestoreCollection } from "@rebasepro/firebase";

const eventTraces = defineFirestoreCollection({
    slug: "fs_event_traces",
    path: "traces",
    name: "Traces",
    dataSource: "firestore",
    fields: {
        step: { name: "Step", type: "string" },
        at:   { name: "At", type: "date" },
    },
});

export const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live Events (Firestore)",
    dataSource: "firestore",
    fields: {
        type:       { name: "Event Type", type: "string", required: true },
        payload:    { name: "Payload", type: "map" },
        // A reference to a row of the `customers` Postgres table.
        customerId: { name: "Customer", type: "reference", target: "customers" },
    },
    subcollections: () => [eventTraces],
});
```

| Schlüssel | Funktion |
|---|---|
| `slug` | Der Name der Collection im Panel: ihre URL und das Ziel, das andere Referenzen angeben. Er muss sich vom Slug jeder Tabelle unterscheiden. |
| `path` | Der Speicherort der Dokumente in Firestore, wenn dieser vom Slug abweicht. |
| `name` | Die Beschriftung in der Navigation. |
| `dataSource` | Der Schlüssel des `<Rebase dataSources>`-Eintrags, der sie liest: der `key`, der an `useFirestoreDataSource` übergeben wird. Nur weglassen, wenn Firestore die Standarddatenquelle ist. |
| `databaseId` | Eine Firestore-Datenbank, die von der Standarddatenbank abweicht. |
| `fields` | Die Felder des Dokuments, nach Schlüssel geordnet. |
| `subcollections` | Unter jedem Dokument verschachtelte Collections, die als Tabs des Dokuments dargestellt und unter `<path>/<id>/<child path>` gespeichert werden. Jede ist ebenfalls ein `defineFirestoreCollection`. |

Der `type` eines Feldes entspricht den von Firestore unterstützten Typen:
`string`, `number`, `boolean`, `date`, `geopoint`, `map`, `array`, `reference`
oder `binary`. `required: true` kennzeichnet ein Pflichtfeld. Eine `reference`
gibt über `target` die Collection an, auf die sie verweist (auf einer beliebigen
Datenquelle). Eine `relation` oder ein `vector` gehört zu einer Postgres-Tabelle
und wird hier abgewiesen, ebenso wie `properties` und `engine`.

Der Dokumenttyp wird aus `fields` abgeleitet, sodass die Optionen der Collection
anhand ihrer Schlüssel überprüft werden. Darstellungsoptionen, die eine
Firestore-Collection akzeptiert (Icon, Gruppe, Ansichten), sind die des
Collection-Modells des Panels – nicht `customizeTable`, welches für Tabellen
gedacht ist.

## Neben den Tabellen einbinden

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Zwei Schritte: Firestore als Datenquelle auf `<Rebase>` registrieren und die
Collection an `<RebaseCMS externalCollections>` übergeben.

```tsx
// frontend/src/App.tsx
import React from "react";
import { initializeApp } from "firebase/app";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { useFirestoreDataSource } from "@rebasepro/firebase";
import { postsCms } from "./cms/posts";
import { customersCms } from "./cms/customers";
import { firestoreEvents } from "./cms/events";

const rebaseClient = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });
const firebaseApp = initializeApp({ projectId: "acme-ops", apiKey: "…", appId: "…" });

export function App() {
    const authController = useRebaseAuthController({ client: rebaseClient });
    const firestoreSource = useFirestoreDataSource({ key: "firestore", firebaseApp });

    return (
        <Rebase
            client={rebaseClient}            // the default data source: the Postgres backend
            dataSources={[firestoreSource]}  // a second, direct source: Firestore
            authController={authController}
        >
            <RebaseAuth/>
            <RebaseCMS
                tableCustomizations={[postsCms, customersCms]}
                externalCollections={[firestoreEvents]}
            />
            <RebaseStudio/>
            <RebaseShell title="Acme Ops"/>
        </Rebase>
    );
}
```

Das Panel zeigt jede vom Backend bereitgestellte Tabelle – mit angewendetem
`postsCms` und `customersCms` – und anschließend `fs_events` in derselben
Navigation an. Ein Slug bezeichnet genau eine Collection: Eine externe
Collection mit dem Slug einer Tabelle wird abgewiesen (siehe
[Kollisionen](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` gibt bei jedem Rendern dasselbe Objekt zurück, solange
die Optionen unverändert bleiben, sodass es inline in `dataSources` platziert
werden kann. Die Optionen:

| Option | Funktion |
|---|---|
| `key` | **Erforderlich.** Der Name, den das `dataSource` einer Collection referenziert. |
| `firebaseApp` | Die initialisierte Firebase-App. Bis sie gesetzt ist, meldet die Quelle, dass sie nicht bereit ist. |
| `databaseId` | Die Firestore-Datenbank, falls es nicht die Standarddatenbank der App ist. Eine eigene `databaseId` der Collection hat Vorrang. |
| `label` | Eine Bezeichnung für die Datenquelle an Stellen, an denen das Panel Datenquellen anzeigt. |
| `textSearchControllerBuilder` | Beantwortet Textsuchanfragen mit Dokument-IDs (Algolia, Typesense, Pinecone, Rebase Search). |
| `localTextSearchEnabled` | Suche im Browser direkt über die Dokumente, wenn kein Controller eine Collection abdeckt. Liest jedes Dokument ein: geeignet für kleine Collections. |
| `firestoreIndexesBuilder` | Die zusammengesetzten Indizes (Composite Indexes) der Datenbank, damit das Panel nur Filter und Sortierungen anbietet, die Firestore auch ausführen kann. |

Es registriert außerdem die Fähigkeiten von Firestore, sodass für dessen
Collections niemals Relations-Tabs oder Filter angeboten werden, die Firestore
nicht ausführen kann.

## Bearbeiten im Collection-Editor

<span class="since-badge" data-since="0.31">Seit 0.31</span>

In der Entwicklungsumgebung bearbeitet der
[Collection-Editor](/docs/studio/#collection-editor) auch Firestore-Collections:
Beim Speichern wird der Aufruf von `defineFirestoreCollection({...})` in
`frontend/src/cms` direkt überschrieben, wobei nur das geändert wird, was Sie
editiert haben. Funktionen, benutzerdefinierte Komponenten, Kommentare und
Importe bleiben unverändert erhalten; im Code definierte Felder werden als
schreibgeschützt angezeigt. In der Produktionsumgebung sind Firestore-Collections
im Editor schreibgeschützt. Um eine Collection zu löschen, entfernen Sie deren
Datei und den entsprechenden Eintrag in `externalCollections`.

## Von Firestore zu einer Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`customerId: { type: "reference", target: "customers" }` verweist auf die
Tabelle `customers`. Wenn ein Operator ein Event öffnet und auf das
Kunden-Chip-Element klickt oder einen Kunden auswählt, wird der Lookup über die
Datenquelle des Ziels weitergeleitet: Die Collection `customers` ist eine
Tabelle, also geht die Anfrage an das Rebase-Backend unter Berücksichtigung der
Row-Level Security des Aufrufers.

Eine Referenz auf einen Datensatz in einer anderen Datenquelle wird im Dokument
als **ID** des Datensatzes (als String) gespeichert, sodass eine Firestore-Abfrage
nach `customerId == "42"` darauf zutrifft. Eine Referenz auf ein Dokument in
derselben Firestore-Datenbank wird als Firestore-`DocumentReference` gespeichert,
wie es Firestore erwartet.

## Von einer Tabelle zu Firestore

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Tabellenspalte, die die ID eines Firestore-Dokuments enthält, ist im Backend
eine gewöhnliche Textspalte. Durch `referenceTo` im zugehörigen `customizeTable`
wird sie im Panel zu einer Referenz:

```ts
// backend/schema/customers.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        name:           col.text().notNull(),
        // The id of this customer's document in the Firestore `fs_events` collection.
        lastEventDocId: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/customers.tsx
import { customizeTable } from "@rebasepro/cms";
import type { customers } from "../../../backend/schema/customers";

export const customersCms = customizeTable<typeof customers>("customers", {
    fields: {
        lastEventDocId: { name: "Last event", referenceTo: "fs_events" },
    },
});
```

Das Feld wird als Referenz auf `fs_events` dargestellt und ausgewählt, und beim
Öffnen wird das Dokument über `firestoreSource` gelesen. Die Spalte speichert
die ID weiterhin als Text, und das Backend sieht weiterhin eine Textspalte.
`referenceTo` kann auf Text- und UUID-Spalten angewendet werden; bei jedem
anderen Typ wird es ignoriert, begleitet von einer Warnung im Entwicklungsmodus.

## Ein reines Firestore-Panel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`RebaseFirebaseApp` ist ein vollständiges Panel, das ausschließlich auf
Firebase basiert: Firebase-Auth-Anmeldung, Routing und die von Ihnen übergebenen
Collections – ganz ohne Rebase-Backend.

```tsx
import React from "react";
import { RebaseFirebaseApp, defineFirestoreCollection } from "@rebasepro/firebase";

const firebaseConfig = { projectId: "acme-ops", apiKey: "…", appId: "…" };

// No `dataSource`: here Firestore is the default source.
const events = defineFirestoreCollection({
    slug: "events",
    name: "Events",
    fields: {
        type: { name: "Event Type", type: "string", required: true },
    },
});

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[events]}
    />;
}
```

Ein funktionsfähiges Beispiel finden Sie unter
[`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).
Bei diesem Setup gilt nichts von den Backend-Seiten dieser Dokumentation:
Firebase Security Rules ersetzen die Row-Level Security, das Firebase-SDK
ersetzt die REST-API und das generierte SDK, Cloud Functions ersetzen Functions
und Crons, und Studio sowie `rls-check` haben nichts zu prüfen.

## Verwandte Themen

- [Tabellen im CMS](/docs/collections/): Was die Postgres-Seite ohne Konfiguration anzeigt
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` und alle weiteren Tabellenoptionen
- [Frontend-Übersicht](/docs/frontend/): Props von `<Rebase dataSources>` und `<RebaseCMS>`
- [Authentifizierung & Login](/docs/frontend/authentication/): Die Anmeldeoberfläche
