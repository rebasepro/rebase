---
title: Distribuzione
sidebar_label: Distribuzione
description: Distribuisci il tuo progetto Rebase in produzione utilizzando Docker, piattaforme cloud o configurazioni manuali.
---

## Docker Compose (Consigliato)

Il progetto generato include un `Dockerfile` e un `docker-compose.yml`. Questo è il modo più semplice per la distribuzione:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: rebase
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase:rebase@postgres:5432/rebase
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

## Lista di Controllo per la Produzione

Prima di distribuire in produzione, assicurati:

| Elemento | Dettagli |
|---|---|
| **JWT_SECRET** | Usa una stringa casuale crittograficamente forte (≥ 32 caratteri). Non riutilizzare mai tra ambienti. |
| **DATABASE_URL** | Usa un'istanza Postgres gestita (Neon, Supabase, RDS) con TLS abilitato |
| **CORS** | Configura le origini consentite sul tuo backend se frontend e backend si trovano su domini diversi |
| **Volumi di storage** | Monta volumi persistenti per gli upload di file. Oppure passa a S3 per la produzione. |
| **HTTPS** | Termina TLS sul tuo reverse proxy (nginx, Cloudflare, load balancer) |
| **Registrazione** | Imposta `ALLOW_REGISTRATION=false` dopo aver creato il tuo account amministratore |

## Servire il Frontend

In produzione, il backend può servire il frontend come una SPA statica:

```typescript
import { serveSPA } from "@rebasepro/server-core";

// After initializeRebaseBackend()
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Costruisci prima il frontend:

```bash
cd frontend && pnpm build
```

In questo modo devi distribuire un solo server che gestisce sia la SPA che l'API.

## Piattaforme Cloud

### Railway / Render / Fly.io

1. Invia il tuo codice a un repository Git
2. Collega il repository alla tua piattaforma cloud
3. Imposta le variabili d'ambiente (`DATABASE_URL`, `JWT_SECRET`, ecc.)
4. Il `Dockerfile` incluso verrà rilevato automaticamente

### Google Cloud Run

```bash
# Build the container
docker build -t gcr.io/YOUR_PROJECT/rebase-backend ./backend

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT/rebase-backend

# Deploy
gcloud run deploy rebase-backend \
  --image gcr.io/YOUR_PROJECT/rebase-backend \
  --set-env-vars DATABASE_URL=...,JWT_SECRET=... \
  --allow-unauthenticated
```

:::caution
Le istanze di Cloud Run sono stateless. Usa lo **storage S3** invece del filesystem locale per gli upload di file, e abilita il **realtime cross-istanza** fornendo una `connectionString` nel tuo `PostgresBootstrapper` in modo che gli aggiornamenti WebSocket si propaghino tra le repliche.
:::

## Cambiare l'URL Base

Se vuoi che Rebase venga eseguito su un sotto-percorso (es. `/admin`):

**Frontend** — Aggiorna il basename di `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Aggiorna il percorso base:

```typescript
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

## Prossimi Passi

- **[Panoramica del Backend](/docs/backend)** — Configurazione completa del backend
- **[Configurazione dello Storage](/docs/storage)** — Configurazione S3 per la produzione
---
