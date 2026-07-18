---
title: Déploiement
sidebar_label: Déploiement
description: Déployez votre projet Rebase en production à l'aide de Docker, de plateformes cloud ou de configurations manuelles.
---

## Ce qu'un déploiement sert

Un projet Rebase se déploie comme **un serveur à une URL** (sur Rebase Cloud : `https://<project>.apps.rebase.pro`). Ce serveur gère :

- **`/api/*`** — l'API de données, l'authentification, le temps réel et le stockage
- **tout le reste** — votre `frontend/` compilé en tant que SPA statique

Il n'y a pas d'URL d'administration séparée : le panneau d'administration fait partie de votre frontend, donc l'endroit où il apparaît dépend de ce qu'est votre frontend.

| Type de projet | L'URL racine affiche | Le panneau d'administration se trouve à |
|--------------|----------------|-------------------|
| Scaffold par défaut (`rebase init`) | Le panneau d'administration | `/` — le frontend **est** l'administration |
| Frontend produit personnalisé | Votre app | Là où vous le montez, généralement `/admin` — voir [Changer l'URL de base](#changing-the-base-url) |
| Projet backend uniquement | Rien (API seulement) | Non déployé |

:::note[Première visite]
Lors de la première visite de l'administration d'un déploiement neuf, Rebase affiche un écran de bootstrap pour **créer votre compte administrateur**. Le premier compte enregistré reçoit les privilèges d'administrateur — réclamez-le juste après le déploiement.
:::

## Docker Compose (Recommandé)

Le projet généré inclut un `Dockerfile` et un `docker-compose.yml`. C'est la façon la plus simple de déployer :

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

Avant de déployer en production, assurez-vous de :

| Élément | Détails |
|------|---------|
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement forte (≥ 32 caractères). Ne la réutilisez jamais entre environnements. |
| **DATABASE_URL** | Utilisez une instance Postgres gérée (Neon, Supabase, RDS) avec TLS activé |
| **CORS** | Configurez les origines autorisées sur votre backend si le frontend et le backend sont sur des domaines différents |
| **Volumes de stockage** | Montez des volumes persistants pour les téléversements de fichiers. Ou passez à S3 pour la production. |
| **HTTPS** | Terminez TLS au niveau de votre reverse proxy (nginx, Cloudflare, équilibreur de charge) |
| **Inscription** | Définissez `ALLOW_REGISTRATION=false` après avoir créé votre compte administrateur |

## Servir le frontend

En production, le backend peut servir le frontend en tant que SPA statique :

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compilez d'abord le frontend :

```bash
cd frontend && pnpm build
```

De cette façon, vous n'avez qu'à déployer un seul serveur qui gère à la fois la SPA et l'API.

## Guides de déploiement par plateforme

Guides détaillés étape par étape pour chaque plateforme :

| Plateforme | Type | Guide |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Déployer sur AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Déployer sur GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Déployer sur Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Déployer sur Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Conteneurs serverless | [Déployer sur Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (détection auto du Dockerfile) | [Déployer sur Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de conteneurs | [Déployer sur Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run et d'autres plateformes serverless sont sans état. Utilisez le **stockage S3** au lieu du système de fichiers local pour les téléversements de fichiers, et définissez `--min-instances 1` si vous utilisez les fonctionnalités temps réel de Rebase (les connexions WebSocket sont terminées lorsque les instances sont réduites).
:::


## Changer l'URL de base

Si vous voulez que Rebase s'exécute sur un sous-chemin (par ex. `/admin`) :

**Frontend** — Mettez à jour le `basename` de `BrowserRouter` :

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

:::note[Montage sans un `basename` de router]
L'approche `basename` ci-dessus est celle recommandée — react-router retire le
préfixe de la location, de sorte que l'administration fonctionne sans modification. Si vous intégrez plutôt
l'administration dans une **route préfixée par un chemin** d'une app plus grande (par ex. `<Route path="/admin/*">`)
sans `basename`, le chemin actuel conserve son préfixe `/admin`. Indiquez-le au CMS
afin que la résolution URL⇄collection tienne compte du préfixe — sinon les vues restent bloquées sur un
spinner sans récupérer de données :

```tsx
<RebaseAdmin collections={collections} basePath="/admin" />
```

Définissez **soit** le `basename` du router **soit** `RebaseAdmin basePath` — pas les deux, sinon le
préfixe est appliqué deux fois.
:::

### App produit + administration dans un seul déploiement

La raison courante de déplacer l'administration vers `/admin` est de livrer votre **propre app produit**
à la racine du même déploiement. Un seul point d'entrée Vite peut servir les deux, séparés par URL,
de sorte que chaque app est chargée en lazy et que les visiteurs du produit ne téléchargent jamais le bundle d'administration :

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

Le backend ne nécessite aucune modification pour ce modèle — l'API reste à `/api` et le catch-all de la SPA
sert `index.html` à la fois pour `/` et `/admin/*`.

## Étapes suivantes

- **[Aperçu du backend](/docs/backend)** — Configuration complète du backend
- **[Configuration du stockage](/docs/backend/storage)** — Configuration de S3 pour la production
