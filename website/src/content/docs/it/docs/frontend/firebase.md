---
sourceHash: 3e18de6e2b935fc7
title: Firebase
sidebar_label: Firebase
description:"\"@rebasepro/firebase esegue Rebase CMS con Firestore, Firebase Auth e Firebase Storage: un adapter lato client, senza alcun server Rebase coinvolto.\""
---

`@rebasepro/firebase` collega Rebase CMS a Firebase. Le tue
collection descrivono i documenti Firestore, e il pannello li legge e scrive
tramite l'SDK di Firebase.

:::caution[Sperimentale e strutturalmente diverso dal resto di Rebase]
Questo è un **adapter lato client**. Non è presente alcun server Rebase: il
browser comunica direttamente con Firebase, quindi tutto ciò che il backend di Rebase fornisce —
la row-level security, l'API REST, l'SDK generato, le funzioni, i cron, il
modello di accesso allo storage — non fa parte di questa configurazione.

L'autorizzazione è gestita tramite le **Firebase Security Rules**, scritte e distribuite in Firebase.
Le `securityRules` di Rebase su una collection non si applicano.
:::

## Installazione

```bash
pnpm add @rebasepro/firebase firebase
```

Peer dependencies: `firebase` (10, 11 o 12), `react` ≥ 19, `react-dom` ≥ 19 e,
facoltativamente, `typesense` per la ricerca testuale.

## Cosa offre

- **`RebaseFirebaseApp`** — un'applicazione di amministrazione completa: login con Firebase Auth, routing
  e CRUD su Firestore basate sulle definizioni delle tue collection.
- **Hook per servizio** — auth, Firestore, storage, App Check, gestione utenti.
- **Adapter per la ricerca testuale** — Algolia, Typesense, Pinecone o locale.

```tsx title="src/App.tsx" no-verify
import { RebaseFirebaseApp } from "@rebasepro/firebase";

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[posts, authors]}
    />;
}
```

Un esempio funzionante è disponibile in [`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).

## Cosa non è incluso

Tutto ciò che in questo sito descrive il **backend** di Rebase fa riferimento al
percorso PostgreSQL (o MongoDB), non a questo:

| | |
|---|---|
| Row-level security | Sostituita dalle Firebase Security Rules, scritte in Firebase |
| API REST e SDK generato | Assenti — il browser utilizza l'SDK di Firebase |
| Funzioni e cron | Sostituiti da Cloud Functions for Firebase |
| Modello di accesso allo storage | Sostituito dalle regole di Firebase Storage |
| Studio, `rls-check`, migrazioni | Funzionalità di Postgres; non applicabili |

## Quando sceglierlo

Scegli questa opzione se hai già un progetto Firebase e desideri un pannello di amministrazione
migliore per gestirlo. Se stai scegliendo un backend da zero piuttosto che adattarti a uno esistente,
il [percorso PostgreSQL](/docs/getting-started/quickstart/) è quello a cui fa riferimento
il resto di questa documentazione.

## Contenuti correlati

- [Configurazione frontend](/docs/frontend/) — il pannello di cui questo sostituisce il data layer
- [Autenticazione e Login](/docs/frontend/authentication/) — l'interfaccia di accesso, valida per entrambe le opzioni
- [Definizione delle Collection](/docs/collections/) — la struttura delle collection interpretata da entrambi i driver
