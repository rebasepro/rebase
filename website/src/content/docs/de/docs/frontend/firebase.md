---
sourceHash: ce9fefc61944ee85
title: Firestore neben Postgres
sidebar_label: Firebase
description: "Zeigen Sie Firestore-Collections im CMS neben Ihren Postgres-Tabellen an: defineFirestoreCollection, useFirestoreDataSource, externalCollections und Referenzen, die Firestore-Dokumente und Postgres-Zeilen in beide Richtungen verbinden."
---

Mit `@rebasepro/firebase` kann das CMS Firestore-Collections im Browser über
das Firebase-SDK lesen und schreiben, direkt neben den Tabellen, die Ihr
Rebase-Backend bereitstellt. Eine gemeinsame Navigation, eine Suche, eine
Referenzauswahl: Ein Operator muss nicht wissen, in welcher Engine ein Datensatz
liegt.

Firestore ist hier eine reine Frontend-Angelegenheit. Das Backend weiß nichts
davon, und eine Firestore-Collection wird in `frontend/src/cms/` deklariert,
niemals in `backend/schema`.

:::caution[Firestore-Collections werden direkt aus dem Browser gelesen]
Zwischen dem Browser und Firestore gehört nichts zu Rebase: Row-Level Security,
die REST-API, das generierte SDK, Functions, Crons und das
Speicherzugriffsmodell gelten nicht für eine Firestore-Collection. Wer deren
Dokumente lesen und schreiben darf, wird durch **Firebase Security Rules**
bestimmt, die in Firebase geschrieben und bereitgestellt werden.
:::

## Installation

```bash
pnpm add @rebasepro/firebase firebase
```

Peer-Dependencies: `firebase` (10, 11 oder 12), `react` ≥ 19, `react-dom` ≥ 19
und optional `typesense` für die Textsuche.

## Eine Firestore-Collection deklarieren

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

| Schlüssel | Beschreibung |
|---|---|
| `slug` | Der Name der Collection im Panel: ihre URL und das Ziel, das andere Referenzen angeben. Er muss sich vom Slug jeder Tabelle unterscheiden. |
| `path` | Der Speicherort der Dokumente in Firestore, wenn er vom Slug abweicht. |
| `name` | Die Beschriftung in der Navigation. |
| `dataSource` | Der Schlüssel des `<Rebase dataSources>`-Eintrags, der sie liest: der `key`, der an `useFirestoreDataSource` übergeben wird. Nur weglassen, wenn Firestore die Standarddatenquelle ist. |
| `databaseId` | Eine Firestore-Datenbank, die von der Standarddatenbank abweicht. |
| `fields` | Die Felder des Dokuments, nach Schlüssel. |
| `subcollections` | Unter jedem Dokument verschachtelte Collections, die als Tabs des Dokuments angezeigt und unter `<path>/<id>/<child path>` gespeichert werden. Jede ist ebenfalls ein `defineFirestoreCollection`. |

Der `type` eines Feldes ist einer der von Firestore gespeicherten Typen:
`string`, `number`, `boolean`, `date`, `geopoint`, `map`, `array`, `reference`
oder `binary`. `required: true` steht für ein Pflichtfeld. Eine `reference`
benennt die Collection, auf die sie verweist, mit `target` (auf einer
beliebigen Datenquelle). Eine `relation` oder ein `vector` gehört zu einer
Postgres-Tabelle und wird hier abgewiesen, ebenso wie `properties` und `engine`.

Der Dokumenttyp wird aus `fields` abgeleitet, sodass die Optionen der Collection
selbst anhand ihrer Schlüssel geprüft werden. Darstellungsoptionen, die eine
Firestore-Collection akzeptiert (Icon, Gruppe, Ansichten), sind diejenigen des
Collection-Modells des Panels – nicht `customizeTable`, das für Tabellen
gedacht ist.

## Neben den Tabellen einbinden

Zwei Schritte: Registrieren Sie Firestore als Datenquelle auf `<Rebase>` und
übergeben Sie die Collection an `<RebaseCMS externalCollections>`.

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
Collection mit dem Slug einer Tabelle wird abgelehnt, wobei beide genannt
werden (siehe [Kollisionen](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` gibt bei jedem Rendern dasselbe Objekt zurück, solange
die Optionen unverändert bleiben, sodass es inline in `dataSources` definiert
werden kann. Die Optionen:

| Option | Beschreibung |
|---|---|
| `key` | **Erforderlich.** Der Name, auf den sich das `dataSource` einer Collection bezieht. |
| `firebaseApp` | Die initialisierte Firebase-App. Bis sie gesetzt ist, meldet sich die Datenquelle als nicht bereit. |
| `databaseId` | Die Firestore-Datenbank, wenn es sich nicht um den Standard der App handelt. Das `databaseId` einer Collection hat Vorrang. |
| `label` | Eine Bezeichnung für die Quelle an Stellen, an denen das Panel Datenquellen benennt. |
| `textSearchControllerBuilder` | Beantwortet Textsuchen mit Dokument-IDs (Algolia, Typesense, Pinecone, Rebase Search). |
| `localTextSearchEnabled` | Suche im Browser direkt über die Dokumente selbst, wenn kein Controller eine Collection abdeckt. Liest jedes Dokument ein: geeignet für kleine Collections. |
| `firestoreIndexesBuilder` | Die zusammengesetzten Indizes (Composite Indexes) der Datenbank, damit das Panel nur die Filter und Sortierungen anbietet, die Firestore ausführen kann. |

Es registriert außerdem die Fähigkeiten von Firestore, sodass für dessen
Collections niemals Relations-Tabs oder Filter angeboten werden, die Firestore
nicht ausführen kann.

## Bearbeiten

Eine Firestore-Collection entspricht ihrem `defineFirestoreCollection({...})`-Aufruf
in `frontend/src/cms`: Bearbeiten Sie sie dort. Um eine zu löschen, entfernen Sie
die entsprechende Datei und ihren Eintrag in `externalCollections`.

## Von Firestore zu einer Tabelle

`customerId: { type: "reference", target: "customers" }` verweist auf die
Tabelle `customers`. Wenn ein Operator ein Event öffnet und auf den
Customer-Chip klickt oder einen Kunden auswählt, wird die Abfrage über die
Datenquelle des Ziels weitergeleitet: Da die `customers`-Collection eine Tabelle
ist, geht die Anfrage an das Rebase-Backend – unter Einhaltung der Row-Level
Security des Aufrufers.

Eine Referenz auf einen Datensatz in einer anderen Datenquelle wird im Dokument
als **ID** des Datensatzes (ein String) gespeichert, sodass eine
Firestore-Abfrage nach `customerId == "42"` darauf zutrifft. Eine Referenz auf
ein Dokument in derselben Firestore-Datenbank wird als Firestore-`DocumentReference`
gespeichert, wie es Firestore erwartet.

## Von einer Tabelle zu Firestore

Eine Tabellenspalte, die die ID eines Firestore-Dokuments enthält, ist im Backend
eine gewöhnliche Textspalte. Durch `referenceTo` in `customizeTable` wird sie im
Panel zu einer Referenz:

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
`referenceTo` gilt für Text- und UUID-Spalten; bei jedem anderen Typ wird es
übersprungen, begleitet von einer Warnung im Development-Modus.

## Ein reines Firestore-Panel

`RebaseFirebaseApp` ist ein vollständiges Panel ausschließlich für Firebase:
Firebase Auth-Login, Routing und die von Ihnen übergebenen Collections, ganz
ohne Rebase-Backend.

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

Ein funktionierendes Beispiel befindet sich unter
[`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).
In diesem Setup findet nichts von den Backend-Seiten dieser Dokumentation
Anwendung: Firebase Security Rules ersetzen die Row-Level Security, das
Firebase-SDK ersetzt die REST-API und das generierte SDK, Cloud Functions
ersetzen Functions und Crons, und Studio sowie `rls-check` haben nichts zu
prüfen.

## Verwandte Themen

- [Tabellen im CMS](/docs/collections/): Was die Postgres-Seite ohne Konfiguration anzeigt
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` und alle weiteren Tabellenoptionen
- [Frontend-Übersicht](/docs/frontend/): Props von `<Rebase dataSources>` und `<RebaseCMS>`
- [Authentifizierung & Login](/docs/frontend/authentication/): Die Anmeldeoberfläche
