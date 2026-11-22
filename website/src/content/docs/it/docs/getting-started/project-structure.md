---
sourceHash: 157b3967e59bc849
title: Struttura del progetto
sidebar_label: Struttura del progetto
description: "Il layout di un progetto Rebase — le tabelle in backend/schema, i moduli di backend letti dal runtime e le personalizzazioni del pannello di amministrazione in frontend/src/cms — con e senza il pannello."
---

:::note[Sei termini utilizzati in questa pagina]
Ciascuno di essi ha un significato specifico qui, e la maggior parte ha un significato diverso altrove nel settore.

- **Tabella** — una tabella Postgres, dichiarata in TypeScript con `defineTable` in
  `backend/schema/`. L'SQL, le policy di sicurezza a livello di riga (row-level security), l'API,
  i tipi dell'SDK e le impostazioni predefinite del pannello di amministrazione derivano tutti da essa.
- **Collezione** — ciò che mostra il pannello di amministrazione: una tabella renderizzata come elenco e
  form, personalizzata in `frontend/src/cms/`, oppure una collezione Firestore letta
  direttamente dal pannello.
- **Studio** — la metà per sviluppatori del pannello di amministrazione: console SQL, policy
  RLS, diagramma dello schema, branch, log. La stessa app utilizzata dal team editoriale,
  accessibile tramite un selettore.
- **Runtime gestito** — l'immagine pubblicata `rebasepro/server` avvia il tuo
  progetto. Non scrivi alcun file server e ottieni gli aggiornamenti del runtime senza
  dover ricompilare. L'alternativa è `rebase eject`, descritta di seguito.
- **Bundle** — ciò che produce `rebase build`: le tue tabelle, funzioni e cron job,
  compilati, con un manifest che indica dove si trova ciascuno di essi. È ciò che il runtime
  gestito avvia.
- **Risorsa** — qualcosa di cui il progetto ha bisogno dall'ambiente in cui viene eseguito: un database,
  un bucket, un topic. Dichiarata in `backend/resources.ts`, collegata tramite variabili
  d'ambiente.
:::

`rebase init` crea lo scaffolding di uno tra due layout. Entrambi condividono lo stesso `backend/`; la
differenza sta nella presenza o meno del pannello di amministrazione nel progetto.

**Con il pannello di amministrazione** (predefinito):

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # Lists the tables and reads a few rows: `pnpm example`
│
├── backend/
│   ├── schema/             # Your tables
│   │   ├── index.ts        # Exports every table, and the optional defaultRls
│   │   ├── posts.ts        # defineTable("posts", …)
│   │   └── users.ts        # defineAuthTable("users", …)
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files (storageAuthorize)
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your tables
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── cms/            # How tables look in the panel: customizeTable(...)
    │       └── posts.tsx
    └── vite.config.ts
```

**Solo backend** (`rebase init --headless`): lo stesso `backend/`, senza
`frontend/` — e senza nemmeno `backend/schema/`. Il server legge le tabelle del database
all'avvio ed espone ciascuna di quelle con la sicurezza a livello di riga abilitata. Vedi
[Solo backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Altri due file compaiono quando necessario, ed entrambi vengono letti dal runtime:
`backend/hooks.ts`, il cui export `hooks` viene eseguito per ogni tabella
([Hook globali](/docs/backend/hooks/)), e `backend/crons/`, per i job
pianificati. `rebase generate-sdk --register` aggiunge `backend/generated/`.

`tsc --noEmit` nella root controlla `scripts/`; all'interno di `backend/` o `frontend/`
controlla quel workspace specifico. Non esiste un package `config/` separato: il frontend
importa una tabella da `backend/schema` esclusivamente come tipo (`import type`). Un'importazione
di valori di qualsiasi elemento in `backend/` invierebbe codice server — gli hook e i
segreti che leggono — al browser; per questo motivo, `rebaseBackendGuard()` da
`@rebasepro/app/vitePlugin`, presente nel file `frontend/vite.config.ts` generato, blocca
`vite build` e `vite dev` se qualcosa si risolve all'interno di `backend/`, indicando
l'importatore, l'import e il file. `rebase build` rifiuta un frontend privo di questa
guardia. Per aggiungerla a un progetto esistente, importala e aggiungi `rebaseBackendGuard()`
a `plugins` in `frontend/vite.config.ts`.

:::note[Non esiste un `backend/src/index.ts`]
E nessun `Dockerfile`. Un progetto generato tramite scaffolding dichiara `runtime: "managed"` in
`rebase.json`, il che significa che l'**immagine pubblicata `rebasepro/server` avvia il tuo
progetto come un bundle** — lo stesso artefatto sia in caso di self-hosting sia di deploy
su Rebase Cloud. La configurazione del server avviene tramite `rebase.json`, i file in
`backend/` e le variabili d'ambiente, invece di scrivere un punto di ingresso (entry point).

Se desideri avere il pieno controllo del processo — i tuoi middleware, le tue route, la tua
configurazione di autenticazione — `rebase eject` genera l'entry point, un Dockerfile e un
file compose per compilarli. Vedi [Integrazione server personalizzato](/docs/backend/custom-server).
:::

## Tabelle (`backend/schema/`)

Le tabelle sono la **singola fonte di verità** per il tuo modello dati:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        price: col.numeric(),
    },
    rls: "admin-only",
});
```

Il nome diventa l'endpoint REST (`/api/data/products`), il nome della tabella in
Postgres e la route del pannello; `table` e `slug` permettono di sovrascriverli. `rls` è
obbligatorio. Una tabella viene considerata attiva una volta esportata da `backend/schema/index.ts` — un
`defineTable` non incluso nell'index impedisce l'avvio. La sezione [Tabelle](/docs/schema/)
illustra tutte le opzioni disponibili.

## Frontend (`frontend/`)

Il frontend è un'applicazione standard **Vite + React + TypeScript**. Il file principale è `App.tsx`, che collega tutti i controller di Rebase:

```tsx title="frontend/src/App.tsx"
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { postsCms } from "./cms/posts";
import { authorsCms } from "./cms/authors";
import { tagsCms } from "./cms/tags";
import { usersCms } from "./cms/users";
// The admin panel's shared layout for each table (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// One client for the page, created when this module loads. Inside a component,
// even in a `useMemo`, `<React.StrictMode>` builds a second one in development,
// and both restore the session and open their own connections.
const rebaseClient = createRebaseClient({
    baseUrl: API_URL,
    // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
    // localStorage. The backend issues it via `auth.cookieAuth`.
    auth: { authFlowMode: "cookie" }
});

export function App() {
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
                {/* Every table the backend serves gets an admin view with no
                    code. A file in ./cms changes how one of them looks:
                    labels, icons, enum colours, custom fields and actions. */}
                <RebaseCMS tableCustomizations={[postsCms, authorsCms, tagsCms, usersCms]} uiConfig={uiConfig} />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` lo monta sotto un `basename` di `react-router` ricavato da
`import.meta.env.BASE_URL`, impostato da `rebase build` a partire dal `path` dichiarato
dall'app in `rebase.json` — in questo modo gli asset, il router e il server concordano su
un unico valore senza doverlo scrivere tre volte.

### Concetti chiave

- **`createRebaseClient`** — Crea il client SDK che gestisce le richieste HTTP, le connessioni WebSocket e la gestione dei token di autenticazione. Va chiamato una sola volta a livello di modulo: all'interno di un componente, anche in un `useMemo`, `<React.StrictMode>` creerebbe un secondo client durante lo sviluppo.
- **`<RebaseCMS tableCustomizations>`** — il pannello renderizza ogni tabella esposta dal backend all'endpoint `GET /api/schema/tables`; gli oggetti `customizeTable` provenienti da `frontend/src/cms/` modificano l'aspetto di alcune di esse, mentre `uiConfig` include il layout condiviso da `frontend/src/cms/ui-config.json`. Vedi [Personalizzare una tabella](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences).
- **`useRebaseAuthController`** — Mantiene l'utente autenticato e il ciclo di vita del token, ed è ciò che `<Rebase>` distribuisce a tutti i componenti sottostanti.

## Backend (`backend/`)

Non c'è alcun file server da leggere, ed è così per progettazione: un progetto generato
tramite scaffolding dichiara `runtime: "managed"`, quindi l'immagine pubblicata `rebasepro/server` avvia
il progetto. La directory `backend/` contiene il codice che il runtime rileva:

| Percorso | Descrizione |
|---|---|
| `backend/schema/` | Le tabelle e il `defaultRls` esportato dal loro index |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Risorse dichiarate, `storageAuthorize` e hook globali delle tabelle |
| `backend/functions/` | Route personalizzate, montate automaticamente su `/api/functions/<filename>` |
| `backend/crons/` | Job pianificati, individuati nello stesso modo (creala quando ne hai bisogno) |
| `backend/src/schema.generated.ts` | Lo schema Drizzle delle tabelle: scritto da `rebase init` e rigenerato a ogni `rebase dev` e `rebase build` |

Il runtime configura:

- **API REST** su `/api/data/*` — CRUD generato per ogni tabella
- **Autenticazione** su `/api/auth/*` — registrazione, login, refresh, OAuth
- **Storage** su `/api/storage/*` — caricamento e download
- **WebSocket** — sincronizzazione in tempo reale tramite LISTEN/NOTIFY di Postgres
- **Le tue funzioni e i tuoi cron job**, provenienti dalle directory indicate sopra

La configurazione proviene da `rebase.json`, dai file in `backend/` e dalle variabili
d'ambiente. Vedi [Ambiente e configurazione](/docs/getting-started/configuration).

`rebase build` trasforma tutto questo in un **bundle** — le tabelle, le funzioni e i
cron job compilati insieme a un manifest — che il runtime gestito avvia. Nessuna parte
del bundle viene scritta manualmente; per approfondire, consulta
[Runtime e bundle](/docs/architecture/runtime-and-bundles/).

Il pannello servito dal frontend è composto da due parti. **Studio** è quella dedicata agli sviluppatori —
la console SQL, il visualizzatore delle policy RLS, il diagramma dello schema — ed è accessibile
tramite il selettore nel menu a scomparsa, senza richiedere un deployment separato. Vedi [Studio](/docs/studio/).

Se desideri invece assumere il pieno controllo del processo — middleware personalizzati, route e
gestione dell'autenticazione — esegui `rebase eject`. **Tutto ciò che segue questo paragrafo si applica solo dopo l'eject**:
un progetto generato via scaffolding non include nessuno di questi file e nulla al suo interno richiama
`initializeRebaseBackend`. Il comando genera un entry point che chiama direttamente
`initializeRebaseBackend`, oltre a un Dockerfile e a un file compose per la compilazione;
da quel momento in poi dovrai gestire direttamente il server e gli aggiornamenti del runtime
della piattaforma non verranno più applicati automaticamente al progetto. Tale interfaccia è documentata in
[Integrazione server personalizzato](/docs/backend/custom-server).

## Come si collegano

1. **Dichiari** le tabelle in `backend/schema/`
2. **Il backend** le compila, crea tabelle e policy e predispone le route REST, realtime e MCP
3. **Il pannello di amministrazione** le legge da `GET /api/schema/tables` e renderizza una vista per ciascuna di esse, personalizzata dai file in `frontend/src/cms/`
4. **La CLI** le legge per generare lo schema Drizzle (`rebase schema generate`), i tipi dell'SDK (`rebase generate-sdk`) e, a partire da tale schema, i file di migrazione (`rebase db generate`)

Mentre `rebase dev` è in esecuzione, il salvataggio di un file all'interno di `backend/schema/`
rigenera `backend/src/schema.generated.ts` e i tipi dell'SDK in
`generated/sdk/`, riavvia il backend e l'avvio crea le tabelle e le colonne
mancanti. Al di fuori di `rebase dev`, le stesse operazioni vengono eseguite tramite `rebase schema generate`
e `rebase generate-sdk`.

Un progetto precedente alla versione 0.31 presenta invece una directory `config/collections/`. Ogni
comando la rifiuta e segnala il comando `rebase migrate collections-to-tables`, che si occupa
della migrazione — vedi [la guida all'aggiornamento](/docs/upgrading/0-30-to-0-31/).

## Passaggi successivi

- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia a lavorare con un nuovo progetto Rebase
- **[Tabelle](/docs/schema/)** — Dichiara il tuo modello dati
- **[Configurazione](/docs/getting-started/configuration)** — Tutte le variabili d'ambiente e le opzioni
