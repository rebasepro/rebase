---
sourceHash: 8fb63312e30e41a2
title: Struttura del progetto
sidebar_label: Struttura del progetto
description: Comprendi la struttura di un progetto Rebase — frontend, backend e configurazione delle collection.
---

:::note[Cinque parole usate in questa pagina]
Ognuna di esse ha un significato specifico qui, e quattro di esse significano qualcos'altro altrove nel settore.

- **Collection** — una tabella, descritta in TypeScript. Lo schema, l'API e la schermata di amministrazione provengono tutti dallo stesso file.
- **Studio** — la metà per sviluppatori del pannello di amministrazione: editor di schemi, console SQL, browser delle policy. La stessa applicazione usata dal team dei contenuti, dietro un selettore.
- **Managed runtime** — l'immagine pubblicata `rebasepro/server` avvia il tuo progetto. Non scrivi alcun file server e ricevi gli aggiornamenti del runtime senza ricompilare. L'alternativa è `rebase eject`, descritta di seguito.
- **Bundle** — ciò che produce `rebase build`: le tue collection, funzioni e cron, compilati, con un manifest che indica dove si trova ciascuno di essi. È ciò che il runtime gestito avvia.
- **Resource** — qualcosa di cui il progetto ha bisogno da ovunque venga eseguito: un database, un bucket, un topic. Dichiarata in `config/resources.ts`, collegata tramite variabili d'ambiente.
:::

Un progetto iniziale Rebase presenta tre pacchetti interconnessi:

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
│
├── config/                 # Shared by the backend and the admin panel
│   ├── index.ts            # Re-exports what the runtime reads (collections, storageAuthorize)
│   ├── collections/        # Your data model
│   │   ├── index.ts        # Exports `collections` and the default security rules
│   │   ├── posts.ts        # Example collections
│   │   └── users.ts        # The auth collection
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files
│   └── cms.d.ts            # One line that makes the `admin` block legal here
│
├── backend/
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your collections
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/App.tsx
    ├── src/main.tsx
    └── vite.config.ts
```

:::note[Non c'è alcun `backend/src/index.ts`]
E nessun `Dockerfile`. Un progetto generato tramite scaffold dichiara `runtime: "managed"` in `rebase.json`, il che significa che l'**immagine pubblicata `rebasepro/server` avvia il tuo progetto come bundle** — lo stesso artefatto, sia che tu scelga il self-hosting o il deploy su Rebase Cloud. Puoi configurare il server tramite `rebase.json`, `config/` e variabili d'ambiente, anziché scrivendo un entry point.

Se desideri gestire direttamente il processo — middleware personalizzati, route dedicate, configurazione personalizzata dell'autenticazione — `rebase eject` crea l'entry point, un Dockerfile e un file compose per compilarli. Consulta [Integrazione server personalizzato](/docs/backend/custom-server).
:::

## Frontend (`frontend/`)

Il frontend è una tipica applicazione **Vite + React + TypeScript**. Il file principale è `App.tsx`, che collega tra loro tutti i controller Rebase:

```typescript title="frontend/src/App.tsx"
import React from "react";

import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL,
        // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
        // localStorage. The backend issues it via `auth.cookieAuth`.
        auth: { authFlowMode: "cookie" }
    }), []);

    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                authController={authController}
            >
                {/* The sign-in screen. On its own this changes nothing —
                    it is where you pass `loginView` to replace it. */}
                <RebaseAuth />
                <RebaseCMS
                    collections={collections}
                />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` lo monta sotto un `basename` di `react-router` ricavato da `import.meta.env.BASE_URL`, che `rebase build` imposta a partire dal `path` dichiarato da questa app in `rebase.json` — in questo modo gli asset, il router e il server concordano su un unico valore senza doverlo scrivere tre volte.

### Concetti chiave

- **`createRebaseClient`** — Crea il client SDK che gestisce le richieste HTTP, le connessioni WebSocket e la gestione dei token di autenticazione
- **`virtual:rebase-collections`** — Un plugin Vite che importa automaticamente le collection condivise al momento della compilazione
- **`useRebaseAuthController`** — Mantiene l'utente autenticato e il ciclo di vita del token, ed è ciò che `<Rebase>` distribuisce a tutto ciò che si trova al suo interno

## Backend (`backend/`)

Non c'è alcun file server da leggere, ed è proprio così che è stato progettato: un progetto creato tramite scaffold dichiara `runtime: "managed"`, quindi l'immagine pubblicata `rebasepro/server` avvia il tuo progetto. Ciò che contiene `backend/` è il codice rilevato dal runtime:

| Percorso | Cos'è |
|---|---|
| `backend/functions/` | Route personalizzate, montate automaticamente su `/api/functions/<filename>` |
| `backend/crons/` | Job pianificati, individuati allo stesso modo (crea la cartella quando ne hai bisogno) |
| `backend/src/schema.generated.ts` | Lo schema Drizzle, rigenerato a partire dalle collection a ogni `rebase dev` e `rebase build` |

Il runtime configura:

- **REST API** su `/api/data/*` — CRUD generato per ogni collection
- **Autenticazione** su `/api/auth/*` — registrazione, login, refresh, OAuth
- **Storage** su `/api/storage/*` — upload e download
- **WebSocket** — sincronizzazione in tempo reale tramite LISTEN/NOTIFY di Postgres
- **Funzioni e cron**, dalle directory sopra indicate

La configurazione proviene da `rebase.json`, dalla directory `config/` e dalle variabili d'ambiente. Consulta [Ambiente e configurazione](/docs/getting-started/configuration).

`rebase build` trasforma tutto questo in un **bundle** — le collection compilate, le funzioni e i cron oltre a un manifest — che il runtime gestito avvia. Nessuna parte del bundle viene scritta a mano; se vuoi vederne uno, [Runtime e bundle](/docs/architecture/runtime-and-bundles/) ne descrive il contenuto.

Il pannello fornito dal frontend ha due parti. **Studio** è quella per gli sviluppatori — l'editor di schemi, la console SQL, il browser delle policy RLS — ed è accessibile tramite il selettore nel drawer, non come deployment separato. Consulta [Studio](/docs/studio/).

Se desideri invece prendere il controllo del processo — con middleware, route e logica di autenticazione personalizzati — esegui `rebase eject`. **Tutto ciò che segue questo paragrafo si applica solo dopo un eject**: un progetto generato tramite scaffold non possiede nessuno di questi file e nulla al suo interno chiama `initializeRebaseBackend`. Il comando genera un entry point che chiama direttamente `initializeRebaseBackend`, oltre a un Dockerfile e a un file compose per la compilazione; da quel momento in poi sarai tu a gestire il server e gli aggiornamenti del runtime della piattaforma non interesseranno più il progetto. Quest'area è documentata in [Integrazione server personalizzato](/docs/backend/custom-server).

## Collection (`config/collections/`)

Le collection rappresentano l'**unica fonte di verità** per il tuo modello di dati. Sono definite in TypeScript e utilizzate sia dal frontend (per la generazione dell'interfaccia utente) che dal backend (per la generazione dello schema e il routing delle API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});

// The default export is what the registry picks up — every collection in the
// scaffold is written this way.
export default productsCollection;
```

Lo `slug` diventa il percorso URL nell'interfaccia di amministrazione e l'endpoint dell'API REST (`/api/data/products`), e il nome della tabella PostgreSQL corrisponde ad esso per impostazione predefinita. Aggiungi `table` solo se differiscono.

## Come si collegano tra loro

1. **Tu definisci** le collection in `config/collections/`
2. **Il backend** le legge per generare gli schemi Drizzle e registrare le route REST
3. **Il frontend** le legge (tramite il plugin Vite) per renderizzare tabelle, moduli e navigazione
4. **La CLI** le legge per generare i file di migrazione con `rebase schema generate`

Mentre `rebase dev` è in esecuzione, il salvataggio di un file all'interno di `config/collections/` rigenera `backend/src/schema.generated.ts` e riavvia il backend; all'avvio vengono create le tabelle e le colonne mancanti. Al di fuori di `rebase dev`, la stessa operazione corrisponde a `rebase schema generate`.

## Prossimi passi

- **[Avvio rapido](/docs/getting-started/quickstart)** — Inizia con un nuovo progetto Rebase
- **[Configurazione](/docs/getting-started/configuration)** — Tutte le variabili d'ambiente e le opzioni
