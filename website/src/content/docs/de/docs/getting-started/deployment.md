---
title: Bereitstellung
sidebar_label: Bereitstellung
description: Stellen Sie Ihr Rebase-Projekt mit Docker, Cloud-Plattformen oder manuellen Setups in der Produktion bereit.
---

## Docker Compose (Empfohlen)

Das generierte Projekt enthält eine `Dockerfile` und eine `docker-compose.yml`. Dies ist der einfachste Weg zur Bereitstellung:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:18-alpine
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

## Produktions-Checkliste

Stellen Sie vor der Bereitstellung in der Produktion sicher:

| Punkt | Details |
|------|---------|
| **JWT_SECRET** | Verwenden Sie einen kryptografisch starken Zufallsstring (≥ 32 Zeichen). Niemals über Umgebungen hinweg wiederverwenden. |
| **DATABASE_URL** | Verwenden Sie eine verwaltete Postgres-Instanz (Neon, Supabase, RDS) mit aktiviertem TLS |
| **CORS** | Konfigurieren Sie erlaubte Ursprünge in Ihrem Backend, wenn Frontend und Backend auf unterschiedlichen Domains liegen |
| **Speichervolumes** | Hängen Sie persistente Volumes für Dateiuploads ein. Oder wechseln Sie für die Produktion zu S3. |
| **HTTPS** | Beenden Sie TLS an Ihrem Reverse-Proxy (nginx, Cloudflare, Load Balancer) |
| **Registrierung** | Setzen Sie `ALLOW_REGISTRATION=false`, nachdem Sie Ihr Admin-Konto erstellt haben |

## Bereitstellung des Frontends

In der Produktion kann das Backend das Frontend als statische SPA bereitstellen:

```typescript
import { serveSPA } from "@rebasepro/server-core";

// After initializeRebaseBackend()
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Erstellen Sie zuerst das Frontend:

```bash
cd frontend && pnpm build
```

Auf diese Weise müssen Sie nur einen Server bereitstellen, der sowohl SPA als auch API verwaltet.

## Cloud-Plattformen

### Railway / Render / Fly.io

1. Pushen Sie Ihren Code in ein Git-Repository
2. Verbinden Sie das Repository mit Ihrer Cloud-Plattform
3. Legen Sie Umgebungsvariablen fest (`DATABASE_URL`, `JWT_SECRET`, etc.)
4. Die enthaltene `Dockerfile` wird automatisch erkannt

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
Cloud Run-Instanzen sind zustandslos. Verwenden Sie **S3-Speicher** anstelle des lokalen Dateisystems für Dateiuploads, und aktivieren Sie **Echtzeit über Instanzen hinweg**, indem Sie einen `connectionString` in Ihrem `PostgresBootstrapper` bereitstellen, damit WebSocket-Updates über Replikate hinweg verbreitet werden.
:::

## Ändern der Basis-URL

Wenn Sie Rebase unter einem Unterpfad (z. B. `/admin`) ausführen möchten:

**Frontend** — Aktualisieren Sie den `basename` des `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Aktualisieren Sie den Basispfad:

```typescript
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfiguration
- **[Speicherkonfiguration](/docs/storage)** — S3-Setup für die Produktion

---
