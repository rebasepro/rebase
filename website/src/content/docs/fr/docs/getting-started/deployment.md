---
title: Déploiement
sidebar_label: Déploiement
description: Déployez votre projet Rebase en production à l'aide de Docker, de plateformes cloud ou de configurations manuelles.
---

## Ce qu'un déploiement sert

Un projet Rebase se déploie comme **un serveur à une URL** (sur Rebase Cloud : `https://<project>.rebase.website`). Ce serveur gère :

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

Le projet généré inclut déjà un `docker-compose.yml` fonctionnel (Postgres + backend + frontend) ainsi que les Dockerfiles `backend/`/`frontend/` — ce fichier généré est la source de vérité ; utilisez-le tel quel plutôt que d'en écrire un à la main. Voici sa structure :

```yaml title="docker-compose.yml (généré — abrégé)"
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    ports:
      - "5432:5432"

  backend:
    build:
      # Context is the PROJECT ROOT so the image can copy
      # pnpm-workspace.yaml, backend/, and config/. A `./backend`
      # context would fail — the Dockerfile lives at backend/Dockerfile.
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      - db

volumes:
  postgres_data:
  uploads:
```

```bash
docker compose up -d
```

### Créer le schéma de base de données

Démarrer la pile ne suffit **pas à lui seul.** Le backend démarre et
crée automatiquement les tables d'**authentification**, mais il ne crée **pas** les tables de
vos propres collections — vous exécutez cela une fois, explicitement, sur la base de
données de production. Depuis un checkout de votre projet (avec les dépendances installées), définissez
`DATABASE_URL` sur votre base de données de production et poussez le schéma :

```bash
pnpm run db:push
```

:::caution[Obligatoire — sinon chaque collection renvoie des erreurs]
Si vous ignorez cette étape, l'application démarre quand même et vous pouvez vous connecter, mais chacune de
vos collections est vide et ses appels d'API échouent avec une erreur « missing table » tant que
le schéma n'existe pas. Au démarrage, le serveur affiche un avertissement encadré indiquant exactement
quelles tables sont manquantes et la commande à exécuter.
:::

`db:push` est l'option rapide — elle applique le schéma directement, sans
fichiers de migration. Pour un **workflow versionné et en équipe**, validez les fichiers de migration
avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` comme étape de release
à la place. Quelle que soit l'option choisie, elle s'exécute sur le `DATABASE_URL` de production
depuis un checkout du projet (ou votre job CI), et non à l'intérieur du conteneur en cours d'exécution —
l'image de production est livrée sans la CLI.

## Liste de contrôle pour la production

Avant de déployer en production, assurez-vous de :

| Élément | Détails |
|------|---------|
| **Schéma de base de données** | Exécutez `pnpm run db:push` (ou `pnpm run db:migrate` pour des migrations versionnées) une fois sur la base de données de production. L'application démarre sans vos tables de collections, mais chaque collection échoue tant qu'elles n'existent pas. |
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement forte (≥ 32 caractères). Ne la réutilisez jamais entre environnements. |
| **DATABASE_URL** | Utilisez une instance Postgres gérée (Neon, Supabase, RDS) avec TLS activé |
| **CORS** | Configurez les origines autorisées sur votre backend si le frontend et le backend sont sur des domaines différents |
| **Volumes de stockage** | Montez des volumes persistants pour les téléversements de fichiers. Ou passez à S3 pour la production. |
| **HTTPS** | Terminez TLS au niveau de votre reverse proxy (nginx, Cloudflare, équilibreur de charge) |
| **Inscription** | Définissez `ALLOW_REGISTRATION=false` après avoir créé votre compte administrateur |

| **Les lectures publiques ont quand même besoin d'un appelant** | `access: "public"` élargit les *lignes* qu'un appelant voit, pas qui a le droit d'appeler : une requête anonyme vers `/api/data/*` répond 401 tant que `AUTH_REQUIRE` est actif. Mettez `AUTH_REQUIRE=false` pour un site public qui lit son propre backend, et laissez RLS seul décider. C'est une variable d'environnement : un `.env` local qui la définit ne voyage **pas** avec votre déploiement. |

## Modules natifs sur le runtime managé

Le runtime managé de Rebase Cloud exécute votre bundle dans une image partagée.
Il n'y a ni compilateur ni moyen de charger un **module natif** — c'est-à-dire
tout ce qui embarque un binaire `.node` précompilé. Le plus courant de loin est
`sharp`, qui se trouve être la dépendance évidente pour tout ce qui sert des
images.

`rebase cloud deploy` le refuse avant l'envoi, et non après :

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Trois issues, dans l'ordre où elles sont généralement les bonnes :

1. **Déplacez le travail au moment du build.** Redimensionnez et réencodez vos
   images dans votre étape de build, puis déployez les résultats. Plus rien de
   natif ne s'exécute dans le chemin de la requête.
2. **Utilisez un service.** Un CDN d'images ou une API de transformation fait le
   même travail derrière une URL.
3. **Faites tourner votre propre conteneur.** Un déploiement auto-hébergé
   (Docker, Kubernetes, l'un des
   [guides par plateforme](/docs/deployment/self-hosting)) est votre image :
   elle peut donc embarquer ce qu'elle veut.

Les fonctions qui ont seulement besoin de Node, et non d'un binaire natif, ne
posent aucun problème — le déploiement les signale séparément (`1 of 3
function(s) depend on Node`) et les exécute.

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

```typescript no-verify
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
<RebaseCMS collections={collections} basePath="/admin" />
```

Définissez **soit** le `basename` du router **soit** `RebaseCMS basePath` — pas les deux, sinon le
préfixe est appliqué deux fois.
:::

### App produit + administration dans un seul déploiement

La raison courante de déplacer l'administration vers `/admin` est de livrer votre **propre app produit**
à la racine du même déploiement. Un seul point d'entrée Vite peut servir les deux, séparés par URL,
de sorte que chaque app est chargée en lazy et que les visiteurs du produit ne téléchargent jamais le bundle d'administration :

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseCMS basePath="/admin" />

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
