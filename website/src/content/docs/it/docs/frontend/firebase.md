---
sourceHash: 6995a63f34afa39a
title: Firestore accanto a Postgres
sidebar_label: Firebase
description: "Mostra le collezioni Firestore nel CMS accanto alle tue tabelle Postgres: defineFirestoreCollection, useFirestoreDataSource, externalCollections e riferimenti che incrociano documenti Firestore e righe Postgres in entrambe le direzioni."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

`@rebasepro/firebase` consente al CMS di leggere e scrivere collezioni Firestore nel
browser, tramite l'SDK Firebase, accanto alle tabelle servite dal tuo backend
Rebase. Una sola navigazione, una sola ricerca, un solo selettore di riferimenti: un operatore
non ha bisogno di sapere in quale motore risieda un record.

In questo contesto, Firestore è una questione di frontend. Il backend non ne sa nulla e una
collezione Firestore viene dichiarata in `frontend/src/cms/`, mai in
`backend/schema`.

:::caution[Le collezioni Firestore vengono lette direttamente dal browser]
Nulla di ciò che si trova tra il browser e Firestore appartiene a Rebase: la sicurezza a livello di riga (RLS), l'API
REST, l'SDK generato, le funzioni, i cron e il modello di accesso allo storage non
si applicano a una collezione Firestore. Chi può leggere e scrivere i suoi documenti è
stabilito dalle **Firebase Security Rules**, scritte e distribuite in Firebase.
:::

## Installazione

<span class="since-badge" data-since="0.31">Since 0.31</span>

```bash
pnpm add @rebasepro/firebase firebase
```

Dipendenze peer: `firebase` (10, 11 o 12), `react` ≥ 19, `react-dom` ≥ 19 e,
opzionalmente, `typesense` per la ricerca testuale.

## Dichiarare una collezione Firestore

<span class="since-badge" data-since="0.31">Since 0.31</span>

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
| `slug` | Il nome della collezione nel pannello: il suo URL e il target indicato da altri riferimenti. Deve differire dallo slug di ogni tabella. |
| `path` | Il percorso in cui risiedono i documenti in Firestore, quando non coincide con lo slug. |
| `name` | L'etichetta visualizzata nella navigazione. |
| `dataSource` | La chiave della voce `<Rebase dataSources>` che la legge: la `key` fornita a `useFirestoreDataSource`. Da omettere solo quando Firestore è la sorgente predefinita. |
| `databaseId` | Un database Firestore diverso da quello predefinito. |
| `fields` | I campi del documento, indicati per chiave. |
| `subcollections` | Collezioni annidate sotto ciascun documento, mostrate come schede del documento e salvate su `<path>/<id>/<child path>`. Ciascuna è a sua volta una `defineFirestoreCollection`. |

Il `type` di un campo è uno di quelli memorizzati da Firestore: `string`, `number`, `boolean`,
`date`, `geopoint`, `map`, `array`, `reference` o `binary`. `required: true`
è la sintassi abbreviata per un campo obbligatorio. Una `reference` indica la collezione a cui punta
tramite `target`, su qualsiasi sorgente dati. Una `relation` o un `vector` appartengono a una
tabella Postgres e qui vengono rifiutati, così come `properties` ed `engine`.

Il tipo del documento viene dedotto da `fields`, pertanto le opzioni specifiche della collezione
vengono verificate a fronte delle sue chiavi. Le opzioni di presentazione accettate da una collezione Firestore
(icona, gruppo, viste) sono quelle del modello di collezione del pannello, non
`customizeTable`, che è riservato alle tabelle.

## Montarla accanto alle tabelle

<span class="since-badge" data-since="0.31">Since 0.31</span>

Due passaggi: registrare Firestore come sorgente dati su `<Rebase>` e passare la
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
`customersCms` applicati, e successivamente `fs_events`, nella stessa navigazione. Uno slug
identifica una singola collezione: una collezione esterna avente lo slug di una tabella viene rifiutata,
indicando entrambe (vedi [collisioni](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` restituisce lo stesso oggetto a ogni render finché le sue
opzioni rimangono invariate, quindi può essere posizionato inline in `dataSources`. Le sue opzioni:

| Opzione | Cosa fa |
|---|---|
| `key` | **Obbligatoria.** Ciò a cui fa riferimento il `dataSource` di una collezione. |
| `firebaseApp` | L'app Firebase inizializzata. Finché non è impostata, la sorgente segnala di non essere pronta. |
| `databaseId` | Il database Firestore, quando non è quello predefinito dell'app. Il `databaseId` specificato sulla collezione ha la priorità. |
| `label` | Un'etichetta per la sorgente, usata dove il pannello mostra i nomi delle sorgenti dati. |
| `textSearchControllerBuilder` | Risponde alle ricerche testuali con gli ID dei documenti (Algolia, Typesense, Pinecone, ricerca Rebase). |
| `localTextSearchEnabled` | Esegue la ricerca nel browser sui documenti stessi quando nessun controller gestisce la collezione. Legge ogni documento: adatto a collezioni di piccole dimensioni. |
| `firestoreIndexesBuilder` | Gli indici composti presenti nel database, in modo che il pannello offra solo i filtri e gli ordinamenti che Firestore può eseguire. |

Inoltre, registra ciò che Firestore supporta, così che alle sue collezioni non vengano
mai proposte schede di relazione o filtri che Firestore non è in grado di eseguire.

## Modifica nell'editor delle collezioni

<span class="since-badge" data-since="0.31">Since 0.31</span>

In fase di sviluppo, l'[editor delle collezioni](/docs/studio/#collection-editor) permette di modificare
anche le collezioni Firestore: un salvataggio riscrive sul posto la chiamata
`defineFirestoreCollection({...})` della collezione in `frontend/src/cms`,
modificando esclusivamente ciò che hai cambiato. Funzioni, componenti personalizzati, commenti e
import rimangono invariati; i campi definiti nel codice appaiono in sola lettura. In
produzione, le collezioni Firestore sono in sola lettura nell'editor. Per eliminarne una,
rimuovi il relativo file e la sua voce in `externalCollections`.

## Da Firestore a una tabella

<span class="since-badge" data-since="0.31">Since 0.31</span>

`customerId: { type: "reference", target: "customers" }` punta alla
tabella `customers`. Quando un operatore apre un evento e clicca sul chip del cliente,
o seleziona un cliente, la ricerca viene instradata in base alla sorgente dati del target: la
collezione `customers` è una tabella, quindi la richiesta va al backend Rebase, nel rispetto
della sicurezza a livello di riga del chiamante.

Un riferimento a un record su un'altra sorgente dati viene salvato nel documento come **id**
del record, sotto forma di stringa, in modo che una query Firestore per `customerId == "42"`
vi corrisponda. Un riferimento a un documento nello stesso database Firestore viene memorizzato
come `DocumentReference` di Firestore, come previsto da Firestore.

## Da una tabella a Firestore

<span class="since-badge" data-since="0.31">Since 0.31</span>

Una colonna di tabella che contiene l'ID di un documento Firestore è una normale colonna di testo
sul backend. L'opzione `referenceTo` nel suo `customizeTable` la rende un riferimento nel
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

Il campo viene disegnato e selezionato come riferimento a `fs_events`, e aprendolo
si legge il documento tramite `firestoreSource`. La colonna continua a memorizzare l'ID come
testo, e il backend continua a vedere una colonna di testo. `referenceTo` si applica a colonne di
tipo text e uuid; su qualsiasi altro tipo viene ignorato, con un avviso in
fase di sviluppo.

## Un pannello solo Firestore

<span class="since-badge" data-since="0.31">Since 0.31</span>

`RebaseFirebaseApp` è un pannello completo basato esclusivamente su Firebase: accesso
tramite Firebase Auth, routing e le collezioni passate, senza alcun backend Rebase.

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
Firebase Security Rules sostituiscono la sicurezza a livello di riga, l'SDK Firebase sostituisce l'API
REST e l'SDK generato, le Cloud Functions sostituiscono funzioni e cron, e lo
Studio e `rls-check` non hanno nulla da ispezionare.

## Correlati

- [Tabelle nel CMS](/docs/collections/): cosa mostra il lato Postgres senza alcuna configurazione
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` e tutte le altre opzioni per le tabelle
- [Panoramica frontend](/docs/frontend/): le prop di `<Rebase dataSources>` e `<RebaseCMS>`
- [Autenticazione e Login](/docs/frontend/authentication/): l'interfaccia di accesso
