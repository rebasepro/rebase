---
title: Déploiement
sidebar_label: Déploiement
description: Déployez votre projet Rebase en production à l'aide de Docker, de plateformes cloud ou de configurations manuelles.
---

## Docker Compose (Recommandé)

Le projet généré inclut un `Dockerfile` et un `docker-compose.yml`. C'est le moyen le plus simple de déployer :

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

## Liste de contrôle pour la production

Avant de déployer en production, assurez-vous :

| Élément | Détails |
|------|---------|
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement forte (≥ 32 caractères). Ne jamais réutiliser entre les environnements. |
| **DATABASE_URL** | Utilisez une instance Postgres gérée (Neon, Supabase, RDS) avec TLS activé |
| **CORS** | Configurez les origines autorisées sur votre backend si le frontend et le backend sont sur des domaines différents |
| **Volumes de stockage** | Montez des volumes persistants pour les téléchargements de fichiers. Ou passez à S3 pour la production. |
| **HTTPS** | Terminez le TLS au niveau de votre proxy inverse (nginx, Cloudflare, équilibreur de charge) |
| **Inscription** | Définissez `ALLOW_REGISTRATION=false` après avoir créé votre compte administrateur |

## Servir le Frontend

En production, le backend peut servir le frontend comme une SPA statique :

```typescript
import { serveSPA } from "@rebasepro/server";

// Après initializeRebaseBackend()
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Construisez le frontend en premier :

```bash
cd frontend && pnpm build
```

De cette façon, vous n'avez besoin de déployer qu'un seul serveur qui gère à la fois le SPA et l'API.

## Plateformes Cloud

### Railway / Render / Fly.io

1. Poussez votre code vers un dépôt Git
2. Connectez le dépôt à votre plateforme cloud
3. Définissez les variables d'environnement (`DATABASE_URL`, `JWT_SECRET`, etc.)
4. Le `Dockerfile` inclus sera auto-détecté

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
Les instances Cloud Run sont sans état. Utilisez le **stockage S3** au lieu du système de fichiers local pour les téléchargements de fichiers, et activez le **temps réel inter-instances** en fournissant une `connectionString` dans votre `PostgresBootstrapper` afin que les mises à jour WebSocket se propagent entre les répliques.
:::

## Modifier l'URL de base

Si vous souhaitez que Rebase s'exécute à un sous-chemin (par exemple, `/admin`) :

**Frontend** — Mettez à jour le basename de `BrowserRouter` :

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Mettez à jour le chemin de base :

```typescript
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

## Prochaines étapes

- **[Vue d'ensemble du Backend](/docs/backend)** — Configuration complète du backend
- **[Configuration du Stockage](/docs/storage)** — Configuration S3 pour la production
