---
sourceHash: b48cc9bf8ad4dcf3
title: Distribuzione
sidebar_label: Distribuzione
description: Distribuisci il tuo progetto Rebase in produzione utilizzando Docker, piattaforme cloud o configurazioni manuali.
---

## Cosa Serve una Distribuzione

Un progetto Rebase si distribuisce come **un server a un URL** (su Rebase Cloud: `https://<project>.rebase.website`). Quel server gestisce:

- **`/api/*`** — l'API dei dati, l'autenticazione, il tempo reale e l'archiviazione
- **tutto il resto** — il tuo `frontend/` compilato come SPA statica

Non c'è un URL di amministrazione separato: il pannello di amministrazione fa parte del tuo frontend, quindi dove appare dipende da cosa è il tuo frontend.

| Tipo di progetto | L'URL radice mostra | Il pannello di amministrazione si trova a |
|--------------|----------------|-------------------|
| Scaffold predefinito (`rebase init`) | Il pannello di amministrazione | `/` — il frontend **è** l'amministrazione |
| Frontend di prodotto personalizzato | La tua app | Dove lo monti, comunemente `/admin` — vedi [Cambiare l'URL di Base](#cambiare-lurl-di-base) |
| Progetto solo backend | Nulla (solo API) | Non distribuito |

:::note[Prima visita]
Una distribuzione di **produzione** nuova non offre alcuna schermata di bootstrap, e la sua prima registrazione è un account ordinario. Indica invece l'amministratore prima del primo avvio — vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore).
:::

## Docker Compose (Consigliato)

Il progetto generato include già un `docker-compose.yml` funzionante — **quel
file è quello da usare per un progetto creato con lo scaffold**, così com'è
anziché scritto a mano o copiato da altrove. `rebase init` ne ha riempito i
segreti, il primo account amministratore e la versione di runtime fissata, ed è
avviato dal gate di accettazione del framework a ogni push. Esegue **due**
container: Postgres e il runtime Rebase pubblicato, con il tuo bundle compilato
montato dentro. Non c'è alcuna immagine applicativa da costruire.

[Self-hosting](/docs/deployment/self-hosting) copre la stessa distribuzione senza
uno scaffold alle spalle, usando
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
dal repository di Rebase — e le due cose che quel file lascia fuori
deliberatamente: un connection pooler e l'esecuzione delle funzioni e del worker
dei job come processi propri.

```bash
rebase build          # produce ./dist-bundle
docker compose up -d
```

Prima `rebase build`, sempre: il servizio `api` monta `./dist-bundle`, e senza di
esso il container parte su una directory vuota.

La forma del file generato:

```yaml title="docker-compose.yml (generated — abridged)"
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase_app -d rebase"]

  api:
    # The published runtime. Upgrading Rebase is a tag change, not a rebuild.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://rebase_app:${DATABASE_PASSWORD:-changeme}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY:?set REBASE_SERVICE_KEY in .env}
      CORS_ORIGINS: ${CORS_ORIGINS:?set CORS_ORIGINS in .env}
      # This service runs in production, where the first account to register is
      # not promoted to admin. So the admin is named instead.
      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?set REBASE_ADMIN_EMAIL in .env}
      REBASE_ADMIN_PASSWORD: ${REBASE_ADMIN_PASSWORD:?set REBASE_ADMIN_PASSWORD in .env}
      DISABLE_SELF_REGISTRATION: ${DISABLE_SELF_REGISTRATION:-true}
    volumes:
      # Your built project, from `rebase build`. Read-only: the build vendors
      # the bundle's dependencies by default, so nothing has to write here.
      - ./dist-bundle:/bundle:ro

volumes:
  postgres_data:
```

Le tre righe `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` sono nuove <span class="since-badge" data-since="0.18">Since 0.18</span>
— nella 0.17.3 il primo account registrato diventa l'amministratore, anche in
produzione. Vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore) più
sotto.

Il bundle è montato in sola lettura. `rebase build` installa le dipendenze
dichiarate del progetto in `dist-bundle`, a meno che tu non passi `--no-vendor`:
in quel caso il runtime le installa a ogni avvio e il mount deve essere
scrivibile, quindi togli il `:ro`. Vedi
[Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` scrive tutto questo nel `.env` per te, inclusa una password di
amministratore generata. Ciascuna è dichiarata con `${VAR:?…}`, così una mancante
ferma lo stack con un messaggio che la nomina invece di avviare qualcosa
configurato a metà — e Compose interpola l'intero file prima di selezionare i
servizi, quindi una mancante ferma anche `docker compose up -d db`.

Cambia l'email dell'amministratore con la tua, accedi e cambia la password. Vedi
[Il tuo primo amministratore](#il-tuo-primo-amministratore).

### Lo schema

Il runtime crea all'avvio le tabelle mancanti, **comprese quelle delle tue
collezioni**: `REBASE_MIGRATE_ON_BOOT` vale `ensure` per impostazione
predefinita, che è additivo sull'intero schema e applica insieme a esso la
sicurezza a livello di riga. Un primo `docker compose up` su un database vuoto si
alza servendo le tue collezioni.

Ciò che l'avvio non fa mai è cambiare qualcosa che esiste già: non altera il tipo
di una colonna, non elimina nulla e non modifica le etichette di un enum
esistente, perché il riavvio di un container non deve rimodellare uno schema come
effetto collaterale di un deploy. Quello passa dalla CLI, da un checkout o da un
job di CI puntato al database di produzione:

```bash
pnpm run db:push
```

Eseguilo per la RLS delle tabelle di giunzione nelle relazioni molti-a-molti, e
per qualunque cambiamento che non sia puramente additivo: una colonna
rinominata, un tipo ristretto, un campo rimosso.

Per un **flusso di lavoro versionato e di squadra**, versiona i file di
migrazione con `pnpm run db:generate` ed esegui `pnpm run db:migrate` come passo
di release. In entrambi i casi si esegue da un checkout del progetto, non
dall'interno del container in esecuzione: l'immagine di runtime non include la
CLI.

## Il tuo primo amministratore

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` prima del primo avvio.** Ogni guida per piattaforma di questo sito rimanda qui, perché è l'unico passo che dall'esterno non si può più rimediare.

Un database appena creato non ha utenti e, fuori dalla produzione, la politica di registrazione ammette la prima iscrizione e la promuove ad amministratore. Deve farlo: nominare un amministratore richiede un chiamante già autenticato, quindi un database vuoto senza quella regola è un vicolo cieco. Su un portatile la persona alla tastiera è l'operatore, ed è esattamente giusto così.

È esattamente sbagliato su un host con un nome pubblico. Gli artefatti distribuiti attivano DNS e TLS prima che l'operatore abbia digitato qualcosa: la finestra è aperta su internet dal primo secondo, e chi raggiunge per primo il modulo di iscrizione possiede la distribuzione.

Per questo, con `NODE_ENV=production` quella finestra è chiusa. Una tabella utenti vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un account creato tramite registrazione aperta è un account ordinario, `GET /api/auth/config` non annuncia mai `needsSetup` e `POST /api/admin/bootstrap` rifiuta. In 0.17.3 e precedenti la finestra era aperta anche in produzione: aggiorna prima di esporre una distribuzione nuova.

`rebase dev` legge lo stesso `.env` ma ignora deliberatamente entrambe le variabili, e lo dice all'avvio: in locale la prima registrazione resta il modo per entrare. I valori scritti da `rebase init` appartengono all'avvio di produzione. Seminare da entrambi i lati consumerebbe la finestra prima che lo sviluppatore avesse aperto l'app, che è proprio ciò che faceva produrre al primo passo del quickstart un account senza ruolo.

Restano due modi per entrare, e nessuno dei due è una corsa:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Il runtime crea quell'account una volta, finché la tabella utenti è vuota, e non fa nulla a ogni avvio successivo. Oppure assegna il ruolo a un utente esistente con la chiave di servizio, se fornisci gli account per altre vie.

Il runtime impone due regole all'avvio, e senza di esse l'account risultante è inutilizzabile:

- La password deve avere **almeno 12 caratteri**, altrimenti viene rifiutata e nessun account viene creato.
- L'indirizzo deve essere accettato da `POST /api/auth/login`: la rotta analizza il corpo con `z.string().email()`, così un dominio senza punto (`admin@localhost`) viene creato senza obiezioni e poi risponde 400 a ogni accesso. Anche quell'indirizzo viene rifiutato all'avvio.

Impostale entrambe o nessuna: mezza credenziale è un refuso, e la distribuzione che ne risulta — autoregistrazione chiusa, nessun amministratore — si recupera solo da una console `psql`. L'avvio avvisa quando in produzione la tabella è vuota e nessun amministratore è stato indicato.

Accedi e cambia la password. È in chiaro dove hai messo il tuo ambiente.

## Lista di Controllo per la Produzione

<span class="since-badge" data-since="0.18">Since 0.18</span>

Prima di distribuire in produzione, assicurati di:

| Elemento | Dettagli |
|------|---------|
| **Primo amministratore** | Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **prima del primo avvio**, insieme a `DISABLE_SELF_REGISTRATION=true`. In produzione il primo account registrato non viene promosso — vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore). |
| **NODE_ENV** | `NODE_ENV=production`. È ciò che chiude la finestra di bootstrap, rifiuta l'archiviazione locale dei file, richiede `CORS_ORIGINS` e disattiva la documentazione OpenAPI. Una distribuzione lasciata al valore predefinito sta girando in modalità sviluppo. |
| **Schema del database** | L'avvio crea le tabelle delle tue collezioni in modo additivo. Esegui `pnpm run db:push` (o `pnpm run db:migrate`) per la RLS delle tabelle di giunzione e per tutto ciò che non è puramente additivo. |
| **JWT_SECRET** | Usa una stringa casuale crittograficamente forte (≥ 32 caratteri). Non riutilizzarla mai tra ambienti. |
| **DATABASE_URL** | Usa un'istanza Postgres gestita (Neon, Supabase, RDS) con TLS abilitato |
| **CORS_ORIGINS** | Sempre, non solo quando il frontend è su un altro dominio. Il runtime si rifiuta di avviarsi in produzione senza né `CORS_ORIGINS` né `FRONTEND_URL`, perché un'API che indovina le proprie origini consentite prima o poi ne consente una sbagliata. |
| **Controllo degli accessi all'archiviazione** | Un bucket configurato **si rifiuta di avviarsi in produzione** senza un modello di controllo degli accessi. L'archiviazione non è soggetta alla sicurezza a livello di riga e le sue chiavi condividono un unico namespace piatto, quindi un valore predefinito permissivo lascia che qualsiasi utente autenticato elenchi (`GET /storage/list?prefix=`) e poi legga, sovrascriva o elimini i file di tutti gli altri. Soddisfalo con un hook `storageAuthorize` o con `storagePolicies` (lo scaffold include un hook in `config/storage.ts`), oppure dichiara l'intento con `STORAGE_PUBLIC_READ` per una vera CDN pubblica, o `STORAGE_ALLOW_ANY_AUTHENTICATED` per un'app single-tenant in cui ogni account è degno di fiducia per ogni file. |
| **Backend di archiviazione** | `STORAGE_TYPE=local` in produzione viene **scartato**, e i caricamenti rispondono `501 STORAGE_NOT_CONFIGURED` — il filesystem del container viene distrutto al riavvio successivo, quindi un backend locale è perdita di dati silenziosa. Usa `s3` o `gcs`, oppure imposta `FORCE_LOCAL_STORAGE=true` se il percorso è davvero un volume duraturo. |
| **MFA_ENCRYPTION_KEY** | Impostala (32+ caratteri casuali) se usi TOTP. Senza, i segreti memorizzati sono cifrati con `JWT_SECRET`: ruotarlo disconnette tutti *e* rende indecifrabile ogni autenticatore registrato. |
| **HTTPS** | Termina TLS sul tuo reverse proxy (nginx, Cloudflare, bilanciatore di carico) |
| **Le letture pubbliche richiedono comunque un chiamante** | `access: "public"` amplia quali *righe* vede un chiamante, non chi può chiamare: una richiesta anonima a `/api/data/*` risponde 401 finché `AUTH_REQUIRE` è attivo. Imposta `AUTH_REQUIRE=false` per un sito pubblico che legge il proprio backend e lascia decidere soltanto a RLS. È una variabile d'ambiente, quindi un `.env` locale che la imposta **non** viaggia con la tua distribuzione. |

## Moduli Nativi sul Runtime Gestito

Il runtime gestito di Rebase Cloud esegue il tuo bundle dentro un'immagine
condivisa. Non ha un compilatore né alcun modo di caricare un **modulo nativo**
— cioè qualsiasi cosa che porti con sé un binario `.node` precompilato. Il più
comune di gran lunga è `sharp`, che è anche la dipendenza ovvia per qualunque
cosa serva immagini.

`rebase cloud deploy` lo rifiuta prima del caricamento, non dopo:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tre vie d'uscita, nell'ordine in cui di solito sono quella giusta:

1. **Sposta il lavoro nel build.** Ridimensiona e ricodifica le immagini nel tuo
   passo di build e distribuisci i risultati. Nel percorso della richiesta non
   gira più nulla di nativo.
2. **Usa un servizio.** Una CDN per immagini o una API di trasformazione fa lo
   stesso lavoro dietro una URL.
3. **Esegui il tuo container.** Una distribuzione self-hosted (Docker,
   Kubernetes, una qualsiasi delle
   [guide per piattaforma](/docs/deployment/self-hosting)) è la tua immagine, e
   quindi può portarsi dietro quello che vuole.

Le funzioni che hanno bisogno solo di Node e non di un binario nativo non danno
problemi — la distribuzione le segnala a parte (`1 of 3 function(s) depend on
Node`) e le esegue.

## Servire il Frontend

In produzione, il backend può servire il frontend come SPA statica:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compila prima il frontend:

```bash
cd frontend && pnpm build
```

In questo modo devi distribuire un solo server che gestisce sia la SPA sia l'API.

## Guide di Distribuzione per Piattaforma

Guide dettagliate passo dopo passo per ogni piattaforma:

| Piattaforma | Tipo | Guida |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Distribuire su AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Distribuire su GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Distribuire su Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Distribuire su Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Container serverless | [Distribuire su Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (rilevamento automatico del Dockerfile) | [Distribuire su Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime di container | [Distribuire su Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run e altre piattaforme serverless sono senza stato. Usa l'**archiviazione S3** invece del filesystem locale per i caricamenti di file, e imposta `--min-instances 1` se usi le funzionalità in tempo reale di Rebase (le connessioni WebSocket vengono terminate quando le istanze vengono ridotte).
:::


## Cambiare l'URL di Base

Se vuoi che l'amministrazione venga eseguita su un sotto-percorso (ad es. `/admin`), cambia una riga — il `path` dell'app in `rebase.json`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin"
}
```

`rebase build` lo passa a Vite come `base` (tramite `REBASE_APP_BASE`), Vite lo restituisce come `import.meta.env.BASE_URL`, e il `main.tsx` dello scaffold lo passa già al router — così gli asset, le route e il server concordano senza che il prefisso sia scritto in tre posti:

```tsx title="frontend/src/main.tsx"
// At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });
```

L'amministrazione ha bisogno di un **data router** — `createBrowserRouter`, non il semplice `BrowserRouter` — perché il blocco delle modifiche non salvate usa `useBlocker`, che solo il data router fornisce.

**Backend** — se sposti anche l'API, aggiorna il suo percorso di base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaggio senza un `basename` del router]
L'approccio `basename` sopra è quello consigliato — react-router rimuove il
prefisso dalla location, così l'amministrazione funziona senza modifiche. Se invece incorpori
l'amministrazione all'interno di una **route con prefisso di percorso** di un'app più grande (ad es. `<Route path="/admin/*">`)
senza `basename`, il percorso corrente mantiene il suo prefisso `/admin`. Comunicalo al CMS
in modo che la risoluzione URL⇄collezione tenga conto del prefisso — altrimenti le viste rimangono bloccate su uno
spinner senza recuperare dati:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Imposta **o** il `basename` del router **o** `RebaseCMS basePath` — non entrambi, altrimenti il
prefisso viene applicato due volte.
:::

### App di Prodotto + Amministrazione in un'Unica Distribuzione

Il motivo comune per spostare l'amministrazione su `/admin` è distribuire la tua **app di prodotto**
alla radice della stessa distribuzione. Un singolo entry point Vite può servire entrambe, suddivise per URL,
così ogni app viene caricata in lazy e i visitatori del prodotto non scaricano mai il bundle di amministrazione:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

Un solo router per entrambe le metà: l'amministrazione ha comunque bisogno del data router, e non c'è motivo perché l'app di prodotto stia su un altro.

Il backend non necessita di modifiche per questo pattern — l'API rimane a `/api` e il catch-all della SPA
serve `index.html` sia per `/` sia per `/admin/*`.

## Prossimi Passi

- **[Panoramica del Backend](/docs/backend)** — Configurazione completa del backend
- **[Configurazione dell'Archiviazione](/docs/backend/storage)** — Configurazione di S3 per la produzione
