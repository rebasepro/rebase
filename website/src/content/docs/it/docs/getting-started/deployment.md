---
sourceHash: 54382ae26efa26ea
title: Deployment
sidebar_label: Deployment
description: Distribuisci il tuo progetto Rebase in produzione utilizzando Docker, piattaforme cloud o configurazioni manuali.
---

## Cosa gestisce un deployment

Un progetto Rebase viene distribuito come **un unico server** (su Rebase Cloud: `https://<project>.rebase.website`). Quel server gestisce:

- **`/api/*`** — l'API dei dati, l'autenticazione, il realtime e lo storage
- **tutto il resto** — la tua cartella `frontend/` compilata come SPA statica

Non esiste un servizio di amministrazione separato: il pannello di amministrazione fa parte del frontend, quindi il punto in cui compare dipende da cosa sia il tuo frontend e se gli assegni un hostname dedicato.

| Tipo di progetto | L'URL root mostra | Il pannello admin si trova su |
|------------------|-------------------|-------------------------------|
| Scaffold predefinito (`rebase init`) | Il pannello di amministrazione | `/` — il frontend **è** l'admin |
| Frontend del prodotto personalizzato | La tua app | Ovunque lo monti, comunemente `/admin` — vedi [Modificare l'URL di base](#modificare-lurl-di-base) |
| Admin come app con un proprio hostname | La tua app | `https://admin.example.com/`, servito dallo stesso server — vedi [Modificare l'URL di base](#modificare-lurl-di-base) |
| Progetto solo backend | Nulla (solo API) | Non distribuito |

:::note[Prima visita]
Un nuovo deployment di **produzione** non offre una schermata di bootstrap e la sua prima registrazione corrisponde a un account ordinario. Definisci invece l'amministratore prima del primo avvio — vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore).
:::

## Docker Compose (Consigliato)

Il progetto generato include già un file `docker-compose.yml` funzionante — **questo file è quello da utilizzare per un progetto basato su scaffold**, così com'è anziché scritto a mano o copiato da altrove. `rebase init` ha configurato i relativi segreti, il suo primo account amministratore e la versione bloccata del runtime, e viene avviato dal gate di accettazione del framework stesso a ogni push. Esegue **due** container: Postgres e il runtime di Rebase pubblicato con il bundle compilato montato al suo interno. Non c'è alcuna immagine dell'applicazione da compilare.

[Self-Hosting](/docs/deployment/self-hosting) illustra lo stesso deployment senza uno scaffold alle spalle, utilizzando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) dal repository di Rebase — e le due cose che questo file tralascia deliberatamente: un connection pooler e l'esecuzione di funzioni e job worker come processi indipendenti.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Esegui prima `rebase build`, sempre: il servizio `api` monta `./dist-bundle`, e senza di esso il container si avvia puntando a una directory vuota.

La struttura del file generato:

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

Vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore) più in basso per le tre righe relative a `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

Il bundle è montato in sola lettura. `rebase build` installa le dipendenze dichiarate del progetto all'interno di `dist-bundle`, a meno che non venga passato `--no-vendor`, nel qual caso il runtime le installerà a ogni avvio e il punto di montaggio dovrà essere scrivibile — rimuovi `:ro`. Vedi [Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` scrive tutte queste variabili nel file `.env` per te, inclusa una password di amministratore generata automaticamente. Ognuna è dichiarata con `${VAR:?…}`, quindi una variabile mancante arresta lo stack con un messaggio che ne indica il nome anziché avviare un sistema configurato a metà — inoltre, Compose effettua l'interpolazione dell'intero file prima di selezionare i servizi, pertanto una variabile mancante bloccherà anche `docker compose up -d db`.

Sostituisci l'email dell'amministratore con la tua, effettua l'accesso e modifica la password. Vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore).

### Lo schema

Il runtime crea le tabelle mancanti all'avvio, **comprese quelle dichiarate da `backend/schema`** — `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che opera in modalità additiva sull'intero schema e applica la row-level security insieme ad esso. Un primo `docker compose up` su un database vuoto si avvia servendo già le tue tabelle.

Ciò che l'avvio non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy. Tali operazioni passano attraverso la CLI, a partire da un checkout locale o da un job di CI puntato al database di produzione:

```bash
pnpm run db:push
```

Eseguilo per qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un **flusso di lavoro in team basato su versioni**, esegui il commit dei file di migrazione con `pnpm run db:generate` ed esegui `pnpm run db:migrate` come passaggio di rilascio. In entrambi i casi il comando viene eseguito da un checkout del progetto, non all'interno del container in esecuzione — l'immagine del runtime viene distribuita senza la CLI.

## Il tuo primo amministratore

**Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` prima del primo avvio.** Tutte le guide alle piattaforme presenti su questo sito rimandano a questo punto, poiché questo è l'unico passaggio per cui non è possibile alcun ripristino dall'esterno.

Su Rebase Cloud non c'è nulla da impostare: i proprietari e gli amministratori dell'organizzazione a cui appartiene il progetto aprono il relativo pannello di amministrazione dalla pagina del progetto nella console (**Open CMS**, o **Continue with Rebase Cloud** nella schermata di accesso dell'admin) e accedono già autenticati come amministratori. Questa sezione riguarda qualsiasi altro ambiente in cui viene eseguito Rebase.

Un database appena creato non contiene utenti, e al di fuori della produzione la policy di registrazione ammette la prima iscrizione promuovendola ad amministratore. Deve funzionare così: il bootstrap di un amministratore richiede un chiamante già autenticato, quindi un database vuoto privo di tale regola si troverebbe in un vicolo cieco. Su un computer portatile, la persona alla tastiera è l'operatore e questo comportamento è del tutto corretto.

Tuttavia, è del tutto errato su un host con un nome pubblico. Gli artefatti distribuiti attivano DNS e TLS prima ancora che l'operatore abbia digitato alcunché, lasciando la finestra aperta a Internet fin dal primo secondo — e chiunque raggiunga per primo il modulo di registrazione acquisisce il controllo del deployment.

Per questo motivo, con `NODE_ENV=production` quella finestra viene chiusa. Una tabella degli utenti vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un account creato tramite registrazione aperta rimane un account ordinario, `GET /api/auth/config` non restituisce mai `needsSetup` e `POST /api/admin/bootstrap` rifiuta la richiesta.

`rebase dev` legge lo stesso `.env` ignorando deliberatamente entrambe le variabili, e lo segnala all'avvio: in locale la prima registrazione rimane la via d'accesso. I valori impostati da `rebase init` sono destinati all'avvio in produzione. Il seeding su entrambi i lati consumerebbe la finestra prima che lo sviluppatore abbia persino aperto l'app, il che è esattamente ciò che faceva produrre al primo passaggio della guida rapida un account privo di ruoli.

Rimangono due metodi di accesso, nessuno dei quali comporta una race condition:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Il runtime crea quell'account una sola volta, quando la tabella degli utenti è vuota, e non compie alcuna azione a ogni avvio successivo. In alternativa, puoi assegnare il ruolo a un utente esistente tramite la service key, se effettui il provisioning degli account fuori banda.

Due regole che il runtime impone all'avvio, ed entrambe producono un account inutilizzabile se configurate in modo errato:

- La password deve contenere **almeno 12 caratteri**, altrimenti viene rifiutata e nessun account viene creato.
- L'indirizzo deve essere accettabile per `POST /api/auth/login` — il corpo della richiesta viene validato con `z.string().email()`, quindi un dominio senza punto (`admin@localhost`) supera il seed ma risponde con 400 a ogni tentativo di accesso. All'avvio viene rifiutato anche questo tipo di indirizzo.

Imposta entrambe le variabili o nessuna: mezza credenziale equivale a un errore di battitura, e il deployment che ne risulterebbe — con auto-registrazione disattivata e nessun admin — richiederebbe un prompt `psql` per il ripristino. L'avvio genera un avviso quando la tabella è vuota in produzione e non viene specificato alcun amministratore.

Accedi e modifica la password. È presente in chiaro ovunque tu abbia memorizzato il tuo ambiente.

## Checklist per la produzione

Prima di distribuire in produzione, assicurati di verificare quanto segue:

| Elemento | Dettagli |
|----------|----------|
| **Primo admin** | Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **prima del primo avvio**, e `DISABLE_SELF_REGISTRATION=true`. In produzione, il primo account a registrarsi non viene promosso — vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore). |
| **NODE_ENV** | `NODE_ENV=production`. È ciò che chiude la finestra di bootstrap, rifiuta lo storage di file locale, richiede `CORS_ORIGINS` e disattiva la documentazione OpenAPI. Un deployment lasciato al valore predefinito viene eseguito in modalità di sviluppo. |
| **Schema del database** | L'avvio crea in modalità additiva le tabelle dichiarate e la relativa RLS. Esegui `pnpm run db:push` (o `pnpm run db:migrate`) per qualsiasi operazione non puramente additiva. |
| **JWT_SECRET** | Utilizza una stringa casuale crittograficamente sicura (≥ 32 caratteri). Non riutilizzarla mai tra ambienti diversi. |
| **DATABASE_URL** | Utilizza un'istanza Postgres gestita (Neon, Supabase, RDS) con TLS abilitato |
| **CORS_ORIGINS** | Sempre, non solo quando il frontend si trova su un altro dominio. Il runtime rifiuta l'avvio in produzione se mancano sia `CORS_ORIGINS` che `FRONTEND_URL`, poiché un'API che tenta di indovinare le origini consentite finirà prima o poi per autorizzare quella sbagliata. |
| **Controllo degli accessi allo storage** | Un bucket configurato **rifiuta l'avvio in produzione** in assenza di un modello di controllo degli accessi. Lo storage non è soggetto a row-level security e le sue chiavi condividono un unico namespace piatto; pertanto, un'impostazione predefinita che consenta tutto permette a qualsiasi utente autenticato di elencare (`GET /storage/list?prefix=`) e quindi leggere, sovrascrivere o eliminare i file di ogni altro utente. Soddisfa questo requisito con un hook `storageAuthorize` o con `storagePolicies` (lo scaffold include un hook in `backend/storage.ts`), oppure dichiara esplicitamente l'intenzione impostando `STORAGE_PUBLIC_READ` per una CDN pubblica a tutti gli effetti, o `STORAGE_ALLOW_ANY_AUTHENTICATED` per un'app single-tenant in cui ogni account è autorizzato a gestire qualsiasi file. |
| **Backend dello storage** | In produzione `STORAGE_TYPE=local` viene **ignorato** e i caricamenti rispondono con `501 STORAGE_NOT_CONFIGURED` — il filesystem del container viene eliminato al riavvio successivo, quindi un backend locale comporterebbe una perdita invisibile di dati. Usa `s3` o `gcs`, oppure imposta `FORCE_LOCAL_STORAGE=true` se il percorso corrisponde effettivamente a un volume persistente. |
| **MFA_ENCRYPTION_KEY** | Impostala (32+ caratteri casuali) se utilizzi TOTP. Se non configurata, i segreti archiviati vengono crittografati con `JWT_SECRET` — pertanto ruotare quest'ultimo disconnette tutti gli utenti *e* rende indecifrabili tutti gli autenticatori configurati. |
| **HTTPS** | Termina TLS sul tuo reverse proxy (nginx, Cloudflare, load balancer) |
| **Le letture pubbliche richiedono comunque un chiamante** | `access: "public"` estende le *righe* visibili a un chiamante, non chi è autorizzato a chiamare: una richiesta anonima a `/api/data/*` risponde con 401 mentre `AUTH_REQUIRE` è attivo. Imposta `AUTH_REQUIRE=false` per un sito pubblico che legge il proprio backend, e lascia che sia solo la RLS a decidere. Trattandosi di una variabile d'ambiente, un file `.env` locale in cui è impostata **non** viene trasferito con il deploy. |

## Moduli nativi sul runtime gestito

Il runtime gestito di Rebase Cloud esegue il tuo bundle all'interno di un'immagine condivisa. Non dispone di un compilatore né di alcun modo per caricare un **modulo nativo** — ossia qualsiasi componente che distribuisca un binario `.node` precompilato. Il più comune in assoluto è `sharp`, che è anche la dipendenza più scontata per qualsiasi servizio che elabori immagini.

`rebase cloud deploy` rifiuta questo scenario prima del caricamento anziché dopo:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tre possibili soluzioni, nell'ordine in cui solitamente risultano preferibili:

1. **Spostare l'elaborazione alla fase di compilazione.** Ridimensiona e ricodifica le immagini durante il passaggio di build e distribuisci i risultati ottenuti. In questo modo nessun componente nativo viene eseguito nel percorso di gestione delle richieste.
2. **Utilizzare un servizio.** Una CDN per immagini o un'API di trasformazione svolgono lo stesso lavoro dietro a un URL.
3. **Eseguire il proprio container.** Un deployment self-hosted (Docker, Kubernetes o una qualsiasi delle [guide per le piattaforme](/docs/deployment/self-hosting)) fa uso della tua immagine, che può quindi includere qualsiasi componente necessario.

Le funzioni che richiedono semplicemente Node anziché un binario nativo funzionano senza problemi — il deploy le segnala separatamente (`1 of 3 function(s) depend on Node`) e le esegue. [Runtime gestito del backend](/docs/deployment/managed-runtime/) descrive il resto di ciò che il runtime gestito consente: binari, memoria, timeout, filesystem, segreti, storage e rete in uscita.

## Servire il frontend

In produzione, il backend può servire il frontend come una SPA statica:

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

In questo modo è sufficiente distribuire un unico server che gestisce sia la SPA sia le API.

## Guide al deployment sulle piattaforme

Guide dettagliate passo dopo passo per ciascuna piattaforma:

| Piattaforma | Tipo | Guida |
|-------------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Distribuisci su AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Distribuisci su GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Distribuisci su Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Distribuisci su Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Distribuisci su Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-detect Dockerfile) | [Distribuisci su Railway →](/docs/deployment/railway) |
| **Fly.io** | Container runtime | [Distribuisci su Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL in un unico pod, senza Docker | [Distribuisci su InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + PostgreSQL gestito, o VPS | [Distribuisci su Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run e altre piattaforme serverless sono stateless. Utilizza uno **storage S3** anziché il filesystem locale per l'upload dei file, e imposta `--min-instances 1` se utilizzi le funzionalità realtime di Rebase (le connessioni WebSocket vengono terminate quando le istanze scalano verso il basso).
:::


## Modificare l'URL di base

Se desideri che l'amministrazione venga eseguita su un sotto-percorso (es. `/admin`), modifica il parametro `path` dell'app in `rebase.json`, e conseguentemente il suo `cms`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin",
    "cms": "/admin"
}
```

`cms` indica la posizione del CMS a cui Rebase Cloud fa riferimento, e deve trovarsi all'interno del parametro `path` dell'app. Lo scaffold imposta entrambi su `/`, quindi lo spostamento del solo `path` viene rifiutato — il CMS si troverebbe su `/`, all'esterno di un'app che ora inizia su `/admin`.

Per assegnare all'admin un proprio hostname anziché un sotto-percorso, imposta `path` come URL completo — `"path": "https://admin.example.com"` — e lascia `cms` su `"/"`. In questo modo l'admin risponderà solo su quell'hostname e non sull'indirizzo del progetto, risultando quindi irraggiungibile finché il DNS dell'hostname non viene verificato. Anche l'API rimane su `/api` su quell'hostname. Vedi [Un'app con un proprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) per i dettagli su come vengono associate le richieste e su come il deploy di Rebase Cloud gestisce l'hostname.

`rebase build` passa `path` a Vite come `base` (tramite `REBASE_APP_BASE`), Vite lo restituisce come `import.meta.env.BASE_URL`, e il file `main.tsx` dello scaffold lo fornisce già al router — in questo modo gli asset, le route e il server concordano senza dover specificare il prefisso tre volte:

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

Mantieni l'admin su un **data router** — `createBrowserRouter` con `<RouterProvider>`, come fa lo scaffold. Sotto questa configurazione, un record con modifiche non salvate blocca anche la navigazione all'interno dell'app (un link nel menu laterale, il pulsante indietro del browser) e richiede prima conferma tramite `useBlocker`, fornito solo da un data router.

L'admin può anche essere eseguito con un semplice `<BrowserRouter>`. In questo caso, il controllo delle modifiche non salvate ricade sul prompt di uscita dalla pagina del browser stesso, che copre il ricaricamento, la chiusura della scheda o la digitazione di un URL; la navigazione all'interno dell'app prosegue invece senza alcuna richiesta di conferma.

**Backend** — se sposti anche l'API, aggiorna il suo percorso di base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaggio senza `basename` nel router]
L'approccio basato su `basename` descritto sopra è quello consigliato: react-router rimuove il prefisso dalla location, permettendo all'admin di funzionare senza modifiche. Se invece incorpori l'admin all'interno di una **route con prefisso di percorso** di un'app più ampia (es. `<Route path="/admin/*">`) senza specificare `basename`, il percorso corrente mantiene il prefisso `/admin`. Informa il CMS di questo comportamento affinché la risoluzione URL⇄tabella tenga conto del prefisso — altrimenti le viste rimarranno bloccate su uno spinner senza caricare i dati:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Imposta **o** il `basename` del router **oppure** il `basePath` di `RebaseCMS` — non entrambi, altrimenti il prefisso verrà applicato due volte.
:::

### App del prodotto + Admin in un unico deployment

Il motivo comune per spostare l'admin su `/admin` è il rilascio della **propria app di prodotto** alla radice dello stesso deployment. Un singolo entry point Vite può gestire entrambe, suddivise per URL, consentendo il lazy-loading di ciascuna app ed evitando che i visitatori del prodotto scarichino il bundle dell'admin:

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

Un unico router per entrambe le parti: per l'admin è preferibile un data router, che consente alle modifiche non salvate di bloccare la navigazione in-app, e non vi è alcun motivo per cui l'app di prodotto debba utilizzarne uno diverso.

Il backend non richiede modifiche per questo pattern: l'API rimane su `/api` e il catch-all della SPA serve `index.html` sia per `/` che per `/admin/*`.

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Configurazione completa del backend
- **[Configurazione dello storage](/docs/backend/storage)** — Configurazione di S3 per la produzione
