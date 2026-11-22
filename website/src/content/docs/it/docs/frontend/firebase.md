---
sourceHash: ce9fefc61944ee85
title: Firestore accanto a Postgres
sidebar_label: Firebase
description: "Mostra le collezioni Firestore nel CMS accanto alle tue tabelle Postgres: defineFirestoreCollection, useFirestoreDataSource, externalCollections e riferimenti incrociati tra documenti Firestore e righe Postgres in entrambe le direzioni."
---

`@rebasepro/firebase` consente al CMS di leggere e scrivere collezioni Firestore nel
browser, tramite il Firebase SDK, accanto alle tabelle servite dal tuo backend
Rebase. Un'unica navigazione, una sola ricerca, un solo selettore di riferimenti: un operatore non
ha bisogno di sapere in quale motore risiede un record.

Firestore qui è una questione di frontend. Il backend non ne sa nulla e una
collezione Firestore viene dichiarata in `frontend/src/cms/`, mai in
`backend/schema`.

:::caution[Le collezioni Firestore vengono lette direttamente dal browser]
Nulla tra il browser e Firestore appartiene a Rebase: la row-level security,
l'API REST, l'SDK generato, le funzioni, i cron e il modello di accesso allo storage non
si applicano a una collezione Firestore. Chi può leggere e scrivere i suoi documenti è
stabilito dalle **Firebase Security Rules**, scritte e distribuite in Firebase.
:::

## Installazione

```bash
pnpm add @rebasepro/firebase firebase
```

Peer dependency: `firebase` (10, 11 o 12), `react` ≥ 19, `react-dom` ≥ 19 e,
opzionalmente, `typesense` per la ricerca testuale.

## Dichiarare una collezione Firestore

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

| Chiave | Cosa fa |
|---|---|
| `slug` | Il nome della collezione nel pannello: il suo URL e il target indicato dagli altri riferimenti. Deve essere diverso dallo slug di ogni tabella. |
| `path` | Il percorso in cui risiedono i documenti in Firestore, quando non coincide con lo slug. |
| `name` | L'etichetta nella navigazione. |
| `dataSource` | La chiave della voce `<Rebase dataSources>` che la legge: la `key` fornita a `useFirestoreDataSource`. Omettila solo quando Firestore è la sorgente predefinita. |
| `databaseId` | Un database Firestore diverso da quello predefinito. |
| `fields` | I campi del documento, per chiave. |
| `subcollections` | Collezioni annidate sotto ogni documento, mostrate come schede del documento e memorizzate in `<path>/<id>/<child path>`. Ognuna è anch'essa un `defineFirestoreCollection`. |

Il `type` di un campo è uno di quelli memorizzati da Firestore: `string`, `number`, `boolean`,
`date`, `geopoint`, `map`, `array`, `reference` o `binary`. `required: true`
indica in breve un campo obbligatorio. Un `reference` indica la collezione a cui punta
tramite `target`, su qualsiasi data source. Un `relation` o un `vector` appartiene a una
tabella Postgres e qui viene rifiutato, così come `properties` ed `engine`.

Il tipo del documento viene inferito da `fields`, quindi le opzioni proprie della collezione
vengono verificate a fronte delle sue chiavi. Le opzioni di presentazione accettate da una collezione Firestore
(icon, group, views) sono quelle del modello di collezione del pannello, non di
`customizeTable`, che è destinato alle tabelle.

## Montarla accanto alle tabelle

Due passaggi: registrare Firestore come data source su `<Rebase>` e passare la
collezione a `<RebaseCMS externalCollections>`.

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

Il pannello mostra ogni tabella servita dal backend, con `postsCms` e
`customersCms` applicati, e poi `fs_events`, nella stessa navigazione. Uno slug
identifica un'unica collezione: una collezione esterna con lo slug di una tabella viene rifiutata,
indicando entrambe (vedi [collisioni](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` restituisce lo stesso oggetto a ogni render finché le sue
opzioni rimangono invariate, quindi può essere inserito inline in `dataSources`. Le sue opzioni:

| Opzione | Cosa fa |
|---|---|
| `key` | **Obbligatorio.** Ciò a cui fa riferimento il `dataSource` di una collezione. |
| `firebaseApp` | L'app Firebase inizializzata. Fino a quando non è impostata, la sorgente segnala di non essere pronta. |
| `databaseId` | Il database Firestore, quando non è quello predefinito dell'app. Il `databaseId` specifico di una collezione ha la precedenza. |
| `label` | Un'etichetta per la sorgente, usata dove il pannello mostra i nomi delle sorgenti dati. |
| `textSearchControllerBuilder` | Risponde alle ricerche testuali con gli ID dei documenti (Algolia, Typesense, Pinecone, Rebase search). |
| `localTextSearchEnabled` | Esegue la ricerca nel browser direttamente sui documenti quando nessun controller copre una collezione. Legge ogni documento: adatto per collezioni di piccole dimensioni. |
| `firestoreIndexesBuilder` | Gli indici compositi presenti nel database, in modo che il pannello offra solo i filtri e gli ordinamenti che Firestore può eseguire. |

Inoltre registra ciò che Firestore può gestire, in modo che alle sue collezioni non vengano mai
proposte schede di relazione o filtri che Firestore non è in grado di eseguire.

## Modifica

Una collezione Firestore corrisponde alla sua chiamata `defineFirestoreCollection({...})` in
`frontend/src/cms`: modificala lì. Per eliminarne una, rimuovi il relativo file e la sua
voce in `externalCollections`.

## Da Firestore a una tabella

`customerId: { type: "reference", target: "customers" }` punta alla
tabella `customers`. Quando un operatore apre un evento e fa clic sul chip del cliente,
o seleziona un cliente, la ricerca viene instradata dalla sorgente dati della destinazione: la
collezione `customers` è una tabella, quindi la richiesta va al backend Rebase, sotto la
row-level security del chiamante.

Un riferimento a un record su un'altra sorgente dati viene memorizzato nel documento come l'**id**
del record, una stringa, in modo che una query Firestore per `customerId == "42"`
corrisponda ad esso. Un riferimento a un documento nello stesso database Firestore viene memorizzato
come un `DocumentReference` di Firestore, come previsto da Firestore.

## Da una tabella a Firestore

Una colonna di tabella che contiene l'ID di un documento Firestore è una semplice colonna di testo sul
backend. `referenceTo` nel suo `customizeTable` la trasforma in un riferimento nel
pannello:

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

Il campo viene disegnato e selezionato come un riferimento a `fs_events`, e aprendolo
si legge il documento tramite `firestoreSource`. La colonna continua a memorizzare l'ID come
testo, e il backend continua a vedere una colonna di testo. `referenceTo` si applica alle colonne di tipo
text e uuid; su qualsiasi altro tipo viene ignorato, con un avviso in
fase di sviluppo.

## Un pannello solo Firestore

`RebaseFirebaseApp` è un pannello completo basato esclusivamente su Firebase: accesso
con Firebase Auth, routing e le collezioni passate, senza alcun backend Rebase.

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

Un esempio funzionante è disponibile in
[`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).
In tale configurazione, nulla di quanto descritto nelle pagine dedicate al backend di questo sito si applica: le
Firebase Security Rules sostituiscono la row-level security, il Firebase SDK sostituisce l'API
REST e l'SDK generato, le Cloud Functions sostituiscono le funzioni e i cron, e lo
Studio e `rls-check` non hanno nulla da ispezionare.

## Risorse correlate

- [Tabelle nel CMS](/docs/collections/): cosa mostra il versante Postgres senza alcuna configurazione
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` e tutte le altre opzioni per le tabelle
- [Panoramica frontend](/docs/frontend/): proprietà di `<Rebase dataSources>` e `<RebaseCMS>`
- [Autenticazione e Login](/docs/frontend/authentication/): l'interfaccia di accesso
