---
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
| Frontend di prodotto personalizzato | La tua app | Dove lo monti, comunemente `/admin` — vedi [Cambiare l'URL di Base](#changing-the-base-url) |
| Progetto solo backend | Nulla (solo API) | Non distribuito |

:::note[Prima visita]
Alla prima visita all'amministrazione di una nuova distribuzione, Rebase mostra una schermata di bootstrap per **creare il tuo account amministratore**. Il primo account registrato riceve i privilegi di amministratore — rivendicalo subito dopo la distribuzione.
:::

## Docker Compose (Consigliato)

Il progetto generato include un `Dockerfile` e un `docker-compose.yml`. Questo è il modo più semplice per distribuire. L'estratto qui sotto è illustrativo: il `docker-compose.yml` generato nel tuo progetto è la fonte di verità, quindi preferiscilo a questo esempio.

```yaml title="docker-compose.yml"
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase_app:rebase@postgres:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    volumes:
      - uploads:/app/uploads

volumes:
  pgdata:
  uploads:
```

```bash
docker compose up -d
```

## Crea lo Schema del Database

All'avvio Rebase crea automaticamente **solo le tabelle di autenticazione**. Le tabelle per le tue collezioni **non** vengono create automaticamente: l'app si avvia comunque e il login funziona, quindi è facile non accorgersene, finché ogni collezione non restituisce un errore "missing table".

Esegui la sincronizzazione dello schema una volta, con `DATABASE_URL` che punta al database di produzione:

```bash
pnpm run db:push
```

Eseguilo da un checkout del progetto o dalla CI, **non** dall'interno del container: l'immagine di produzione non include la CLI. Se preferisci migrazioni versionate a una sincronizzazione diretta, usa invece `pnpm run db:generate` seguito da `pnpm run db:migrate`.

## Lista di Controllo per la Produzione

Prima di distribuire in produzione, assicurati di:

| Elemento | Dettagli |
|------|---------|
| **Schema del database** | Esegui `pnpm run db:push` (oppure `pnpm run db:generate` + `pnpm run db:migrate`) con `DATABASE_URL` puntato alla produzione. All'avvio Rebase crea solo le tabelle di autenticazione, non quelle delle tue collezioni. |
| **JWT_SECRET** | Usa una stringa casuale crittograficamente forte (≥ 32 caratteri). Non riutilizzarla mai tra ambienti. |
| **DATABASE_URL** | Usa un'istanza Postgres gestita (Neon, Supabase, RDS) con TLS abilitato |
| **CORS** | Configura le origini consentite sul tuo backend se frontend e backend sono su domini diversi |
| **Volumi di archiviazione** | Monta volumi persistenti per i caricamenti di file. Oppure passa a S3 per la produzione. |
| **HTTPS** | Termina TLS sul tuo reverse proxy (nginx, Cloudflare, bilanciatore di carico) |
| **Registrazione** | Imposta `ALLOW_REGISTRATION=false` dopo aver creato il tuo account amministratore |

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
