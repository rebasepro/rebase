---
sourceHash: 145ba18b6f108fbd
title: Deployment
sidebar_label: Deployment
description: Distribuisci il tuo progetto Rebase in produzione utilizzando Docker, piattaforme cloud o configurazioni manuali.
---

## Cosa gestisce un deployment

Un progetto Rebase viene distribuito come **un unico server** (su Rebase Cloud: `https://<project>.rebase.website`). Quel server gestisce:

- **`/api/*`** — l'API dei dati, l'autenticazione, il realtime e lo storage
- **tutto il resto** — il tuo `frontend/` compilato come SPA statica

Non esiste un servizio di amministrazione separato: il pannello di amministrazione fa parte di un frontend, quindi la sua posizione dipende da come è strutturato il tuo frontend e dall'eventuale assegnazione di un proprio hostname.

| Tipo di progetto | L'URL root mostra | Il pannello admin si trova su |
|------------------|-------------------|-------------------------------|
| Scaffold predefinito (`rebase init`) | Il pannello di amministrazione | `/` — il frontend **è** l'admin |
| Frontend di prodotto personalizzato | La tua app | Ovunque tu lo monti, comunemente `/admin` — vedi [Modificare l'URL di base](#modificare-lurl-di-base) |
| Admin come app su un proprio hostname | La tua app | `https://admin.example.com/`, servito dallo stesso server — vedi [Modificare l'URL di base](#modificare-lurl-di-base) |
| Progetto solo backend | Niente (solo API) | Non distribuito |

:::note[Prima visita]
Un nuovo deployment di **produzione** non offre una schermata di bootstrap e la sua prima registrazione corrisponde a un account ordinario. Definisci invece l'amministratore prima del primo avvio — vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore).
:::

## Docker Compose (Consigliato)

Il progetto generato include già un file `docker-compose.yml` funzionante — **questo file è quello da utilizzare per un progetto scaffold**, così com'è anziché scritto a mano o copiato da altrove. `rebase init` ha inserito i suoi secret, il suo primo account amministratore e la versione del runtime bloccata, e viene avviato dal gate di accettazione del framework stesso a ogni push. Esegue **due** container: Postgres e il runtime di Rebase pubblicato con il bundle compilato montato al suo interno. Non c'è alcuna immagine dell'applicazione da compilare.

[Self-Hosting](/docs/deployment/self-hosting) tratta lo stesso deployment senza uno scaffold alle spalle, utilizzando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) dal repository di Rebase — e le due cose che questo file tralascia deliberatamente: un connection pooler e l'esecuzione delle funzioni e del job worker come processi separati.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Esegui sempre prima `rebase build`: il servizio `api` monta `./dist-bundle` e, senza di esso, il container si avvia su una directory vuota.

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

Vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore) più sotto per le tre righe `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

Il bundle viene montato in sola lettura. `rebase build` installa le dipendenze dichiarate del progetto in `dist-bundle`, a meno che non si passi `--no-vendor`, nel qual caso il runtime le installa a ogni avvio e il punto di montaggio deve essere scrivibile — rimuovi `:ro`. Vedi [Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` scrive tutte queste variabili in `.env` per te, inclusa una password di amministrazione generata. Ognuna è dichiarata con `${VAR:?…}`, quindi una variabile mancante blocca lo stack con un messaggio che ne indica il nome anziché avviare qualcosa configurato solo a metà — e Compose interpola l'intero file prima di selezionare i servizi, quindi una variabile mancante bloccherà anche `docker compose up -d db`.

Modifica l'email dell'amministratore con la tua, accedi e modifica la password. Vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore).

### Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il runtime crea le tabelle mancanti all'avvio, **incluse quelle dichiarate da `backend/schema`** — `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è additivo su tutto lo schema e applica di conseguenza la sicurezza a livello di riga (RLS). Un primo `docker compose up` su un database vuoto si avvia servendo le tue tabelle.

Ciò che l'avvio non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy. Tali modifiche passano attraverso la CLI, da un checkout o da un job di CI puntato al database di produzione:

```bash
pnpm run db:push
```

Eseguilo per qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un **flusso di lavoro di team, basato su versioni**, esegui il commit dei file di migrazione con `pnpm run db:generate` ed esegui invece `pnpm run db:migrate` come fase di rilascio. In entrambi i casi viene eseguito da un checkout del progetto, non all'interno del container in esecuzione — l'immagine di runtime viene fornita senza la CLI.

## Il tuo primo amministratore

**Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` prima del primo avvio.** Tutte le guide alle piattaforme presenti su questo sito rimandano a questa sezione, poiché è l'unico passaggio da cui non è possibile recuperare dall'esterno.

Un database appena creato non ha utenti e, al di fuori della produzione, la policy di registrazione accetta la prima iscrizione promuovendola ad amministratore. È necessario che sia così: il bootstrap di un amministratore richiede un chiamante che sia già autenticato, quindi un database vuoto senza tale regola sarebbe un vicolo cieco. Su un portatile la persona alla tastiera è l'operatore, ed è esattamente ciò che deve accadere.

È invece del tutto scorretto su un host con un nome pubblico. I componenti distribuiti attivano DNS e TLS prima ancora che l'operatore abbia digitato qualcosa, quindi la finestra è aperta a Internet sin dal primo secondo — e chiunque raggiunga per primo il modulo di registrazione prende il controllo del deployment.

Di conseguenza, con `NODE_ENV=production` quella finestra viene chiusa. Una tabella degli utenti vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un account creato tramite registrazione aperta è un account ordinario, `GET /api/auth/config` non espone mai `needsSetup` e `POST /api/admin/bootstrap` rifiuta la richiesta.

`rebase dev` legge lo stesso `.env` e ignora deliberatamente entrambe le variabili, segnalandolo all'avvio: in locale la prima registrazione rimane il metodo di accesso iniziale. I valori scritti da `rebase init` appartengono all'avvio in produzione. Eseguire il seed da entrambi i lati consumerebbe la finestra prima ancora che lo sviluppatore abbia aperto l'app, il che causava la creazione di un account privo di ruoli al primo passaggio della guida rapida.

Rimangono due metodi di accesso, nessuno dei quali è soggetto a race condition:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Il runtime crea quell'account una sola volta, quando la tabella degli utenti è vuota, e non fa nulla a ogni avvio successivo. In alternativa, puoi assegnare il ruolo a un utente esistente con la service key, se effettui il provisioning degli account fuori banda.

Due regole che il runtime impone all'avvio, ed entrambe producono un account inutilizzabile se configurate in modo errato:

- La password deve essere di **almeno 12 caratteri**, altrimenti viene rifiutata e nessun account viene creato.
- L'indirizzo deve essere accettato da `POST /api/auth/login` — il body viene validato con `z.string().email()`, quindi un dominio senza punto (`admin@localhost`) viene registrato regolarmente ma risponde con 400 a ogni accesso. Anche in questo caso l'avvio rifiuterà tale indirizzo.

Imposta entrambe o nessuna: una credenziale a metà è considerata un errore di digitazione, e il deployment risultante — auto-registrazione disabilitata, nessun admin — richiederà un prompt `psql` per il ripristino. L'avvio genera un avviso quando la tabella è vuota in produzione e non viene indicato alcun amministratore.

Accedi e cambia la password. È memorizzata in chiaro ovunque tu abbia posizionato il tuo ambiente.

## Checklist per la produzione

Prima di eseguire il deployment in produzione, verifica:

| Elemento | Dettagli |
|----------|----------|
| **Primo amministratore** | Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **prima del primo avvio**, e `DISABLE_SELF_REGISTRATION=true`. In produzione il primo account registrato non viene promosso — vedi [Il tuo primo amministratore](#il-tuo-primo-amministratore). |
| **NODE_ENV** | `NODE_ENV=production`. È ciò che chiude la finestra di bootstrap, rifiuta lo storage su file locale, richiede `CORS_ORIGINS` e disattiva la documentazione OpenAPI. Un deployment lasciato al valore predefinito viene eseguito in modalità di sviluppo. |
| **Schema del database** | L'avvio crea in modo additivo le tabelle dichiarate e le relative RLS. Esegui `pnpm run db:push` (o `pnpm run db:migrate`) per qualsiasi modifica che non sia puramente additiva. |
| **JWT_SECRET** | Utilizza una stringa casuale crittograficamente sicura (≥ 32 caratteri). Non riutilizzarla mai tra ambienti diversi. |
| **DATABASE_URL** | Utilizza un'istanza Postgres gestita (Neon, Supabase, RDS) con TLS abilitato |
| **CORS_ORIGINS** | Sempre, non solo quando il frontend si trova su un altro dominio. Il runtime rifiuta l'avvio in produzione se mancano sia `CORS_ORIGINS` che `FRONTEND_URL`, perché un'API che tenta di indovinare le origini consentite finirà prima o poi per autorizzare quella sbagliata. |
| **Controllo degli accessi allo storage** | Un bucket configurato **rifiuta l'avvio in produzione** in assenza di un modello di controllo degli accessi. Lo storage non è gestito da row-level security e le sue chiavi condividono un unico namespace piatto; pertanto, un'impostazione predefinita che consente tutto permetterebbe a qualsiasi utente autenticato di elencare (`GET /storage/list?prefix=`) e quindi leggere, sovrascrivere o eliminare i file di ogni altro utente. Soddisfa questo requisito con un hook `storageAuthorize` o con `storagePolicies` (lo scaffold include un hook in `backend/storage.ts`), oppure esplicita l'intento con `STORAGE_PUBLIC_READ` per un vero CDN pubblico, o con `STORAGE_ALLOW_ANY_AUTHENTICATED` per un'app single-tenant in cui ogni account è ritenuto affidabile per qualsiasi file. |
| **Backend di storage** | `STORAGE_TYPE=local` in produzione viene **ignorato**, e i caricamenti rispondono con `501 STORAGE_NOT_CONFIGURED` — il filesystem del container viene eliminato al riavvio successivo, quindi un backend locale comporterebbe una perdita silenziosa di dati. Usa `s3` o `gcs`, oppure imposta `FORCE_LOCAL_STORAGE=true` se il percorso corrisponde a un volume realmente persistente. |
| **MFA_ENCRYPTION_KEY** | Impostala (32+ caratteri casuali) se usi TOTP. Se non impostata, i secret memorizzati vengono cifrati con `JWT_SECRET` — pertanto, la rotazione di quest'ultimo disconnetterà tutti gli utenti *e* renderà indecifrabili tutti gli authenticator registrati. |
| **HTTPS** | Termina TLS sul tuo reverse proxy (nginx, Cloudflare, load balancer) |
| **Le letture pubbliche richiedono comunque un chiamante** | `access: "public"` estende le *righe* visibili a un chiamante, non chi è autorizzato a chiamare: una richiesta anonima a `/api/data/*` risponde con 401 finché `AUTH_REQUIRE` è attivo. Imposta `AUTH_REQUIRE=false` per un sito pubblico che legge il proprio backend, lasciando che sia unicamente la RLS a decidere. Si tratta di una variabile d'ambiente, quindi un file `.env` locale che la definisce **non** viene trasferito con il deploy. |

## Moduli nativi sul runtime gestito

Il runtime gestito di Rebase Cloud esegue il bundle all'interno di un'immagine condivisa. Non dispone di un compilatore né di un modo per caricare un **modulo nativo** — qualsiasi componente che distribuisca un file binario precompilato `.node`. Il più comune in assoluto è `sharp`, che è anche la dipendenza naturale per qualsiasi servizio che gestisca immagini.

`rebase cloud deploy` rifiuta questa operazione prima dell'upload anziché dopo:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tre modi per procedere, nell'ordine in cui sono solitamente appropriati:

1. **Sposta il lavoro al momento della build.** Ridimensiona e ricodifica le immagini nella fase di build e distribuisci i risultati. Nessun elemento nativo verrà eseguito nel percorso della richiesta.
2. **Utilizza un servizio.** Un CDN per immagini o un'API di trasformazione svolgono lo stesso lavoro dietro un URL.
3. **Esegui il tuo container.** Un deployment self-hosted (Docker, Kubernetes, qualsiasi delle [guide alle piattaforme](/docs/deployment/self-hosting)) usa una tua immagine, che può quindi includere tutto ciò che desideri.

Le funzioni che necessitano semplicemente di Node anziché di un binario nativo funzionano senza problemi — il deploy le segnala separatamente (`1 of 3 function(s) depend on Node`) e le esegue. [Runtime di backend gestito](/docs/deployment/managed-runtime/) illustra il resto di ciò che il runtime gestito consente: binari, memoria, timeout, filesystem, secret, storage e rete in uscita.

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

In questo modo è sufficiente distribuire un solo server che gestisce sia la SPA che le API.

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
| **Hostman** | App Platform + PostgreSQL gestito, o un VPS | [Distribuisci su Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run e altre piattaforme serverless sono stateless. Usa lo **storage S3** invece del filesystem locale per il caricamento dei file, e imposta `--min-instances 1` se utilizzi le funzionalità realtime di Rebase (le connessioni WebSocket vengono terminate quando le istanze scalano a zero).
:::


## Modificare l'URL di base

Se desideri che l'admin venga eseguito su un sottopercorso (es. `/admin`), modifica il parametro `path` dell'app in `rebase.json`, e insieme ad esso il relativo `cms`:

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

`cms` è la posizione del CMS a cui Rebase Cloud rimanda, e deve trovarsi all'interno del `path` dell'applicazione. Lo scaffold imposta entrambi su `/`, quindi modificare solo `path` viene rifiutato — il CMS si troverebbe su `/`, al di fuori di un'app che ora inizia da `/admin`.

Per assegnare all'admin un proprio hostname invece di un sottopercorso, imposta `path` come URL completo — `"path": "https://admin.example.com"` — e lascia `cms` impostato su `"/"`. L'admin risponderà quindi solo su quell'hostname e non sull'indirizzo del progetto, rimanendo irraggiungibile fino alla verifica dei DNS dell'hostname. Anche l'API rimane su `/api` su tale hostname. Consulta [Un'app su un proprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) per capire come vengono instradate le richieste e cosa fa il deploy di Rebase Cloud con l'hostname.

`rebase build` passa `path` a Vite come `base` (tramite `REBASE_APP_BASE`), Vite lo restituisce come `import.meta.env.BASE_URL`, e il file `main.tsx` dello scaffold lo fornisce già al router — in questo modo gli asset, le route e il server sono coerenti senza dover specificare il prefisso tre volte:

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

Mantieni l'admin su un **data router** — `createBrowserRouter` con `<RouterProvider>`, come fa lo scaffold. In questo modo, un record con modifiche non salvate blocca anche la navigazione interna all'app (un link nel drawer, il pulsante indietro del browser) e richiede prima conferma, tramite `useBlocker`, funzionalità fornita solo da un data router.

L'admin funziona anche con un semplice `<BrowserRouter>`. In questo caso, il controllo delle modifiche non salvate ricorre al prompt predefinito del browser per l'uscita dalla pagina, che copre il ricaricamento, la chiusura della scheda o l'inserimento manuale di un URL; la navigazione all'interno dell'app proseguirà invece senza richiedere conferma.

**Backend** — se sposti anche l'API, aggiorna il suo percorso di base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaggio senza un router `basename`]
L'approccio basato su `basename` descritto sopra è quello consigliato: react-router rimuove il prefisso dalla location, consentendo all'admin di funzionare senza modifiche. Se invece incorpori l'admin all'interno di una **route con prefisso di percorso** in un'app più grande (es. `<Route path="/admin/*">`) senza `basename`, il percorso corrente manterrà il prefisso `/admin`. Informa il CMS di questo comportamento affinché la risoluzione URL⇄tabella tenga conto del prefisso — altrimenti le viste rimarranno bloccate su uno spinner senza recuperare dati:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Imposta **o** il `basename` del router **oppure** `basePath` di `RebaseCMS` — non entrambi, altrimenti il prefisso verrà applicato due volte.
:::

### App di prodotto + Admin in un unico deployment

Il motivo più comune per spostare l'admin su `/admin` è rilasciare la **propria app di prodotto** alla root dello stesso deployment. Un singolo entry point Vite può gestire entrambe, suddivise per URL, in modo che ogni app sia caricata tramite lazy loading e i visitatori del prodotto non scarichino mai il bundle dell'admin:

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

Un unico router per entrambe le parti: per l'admin è preferibile un data router, che consente alle modifiche non salvate di bloccare la navigazione in-app, e non c'è motivo per cui l'app di prodotto debba usarne uno diverso.

Il backend non richiede modifiche per questo pattern — l'API rimane su `/api` e il catch-all della SPA serve `index.html` sia per `/` che per `/admin/*`.

## Prossimi passaggi

- **[Panoramica del backend](/docs/backend)** — Configurazione completa del backend
- **[Configurazione dello storage](/docs/backend/storage)** — Configurazione di S3 per la produzione
