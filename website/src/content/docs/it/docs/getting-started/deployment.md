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
    image: postgres:18-alpine
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

Se vuoi che Rebase venga eseguito su un sotto-percorso (ad es. `/admin`):

**Frontend** — Aggiorna il `basename` di `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Aggiorna il percorso di base:

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
<RebaseAdmin collections={collections} basePath="/admin" />
```

Imposta **o** il `basename` del router **o** `RebaseAdmin basePath` — non entrambi, altrimenti il
prefisso viene applicato due volte.
:::

### App di Prodotto + Amministrazione in un'Unica Distribuzione

Il motivo comune per spostare l'amministrazione su `/admin` è distribuire la tua **app di prodotto**
alla radice della stessa distribuzione. Un singolo entry point Vite può servire entrambe, suddivise per URL,
così ogni app viene caricata in lazy e i visitatori del prodotto non scaricano mai il bundle di amministrazione:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseAdmin basePath="/admin" />

if (isAdmin) {
    // The admin uses useBlocker → needs a data router
    const router = createBrowserRouter([{ path: "/admin/*", element: <AdminApp /> }]);
    root.render(<RouterProvider router={router} />);
} else {
    root.render(<BrowserRouter><ProductApp /></BrowserRouter>);
}
```

Il backend non necessita di modifiche per questo pattern — l'API rimane a `/api` e il catch-all della SPA
serve `index.html` sia per `/` sia per `/admin/*`.

## Prossimi Passi

- **[Panoramica del Backend](/docs/backend)** — Configurazione completa del backend
- **[Configurazione dell'Archiviazione](/docs/backend/storage)** — Configurazione di S3 per la produzione
