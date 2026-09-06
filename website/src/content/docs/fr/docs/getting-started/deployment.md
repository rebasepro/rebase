---
sourceHash: 215da7d8e962efb0
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
    # L'image de runtime publiée. Mettre Rebase à niveau est un changement de tag, pas une reconstruction.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    ports:
      - "3001:3001"
    env_file: .env
    volumes:
      # Votre projet construit, issu de `rebase build`.
      - ./dist-bundle:/bundle:ro
    depends_on:
      - db

volumes:
  postgres_data:
  uploads:
```

```bash
rebase build
docker compose up -d
```

Le bundle est monté en lecture seule. `rebase build` installe les dépendances
déclarées du projet dans `dist-bundle`, sauf si vous passez `--no-vendor` — dans
ce cas le runtime les installe à chaque démarrage et le montage doit être
accessible en écriture : retirez alors le `:ro`. Voir
[Auto-hébergement](/docs/deployment/self-hosting/).

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

## Votre premier administrateur

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` avant le premier démarrage.** C'est la seule étape qui n'a aucun recours depuis l'extérieur.

Une base de données neuve n'a aucun utilisateur, et hors production la politique d'inscription accepte la première création de compte et la promeut administrateur. Il le faut : nommer un administrateur exige un appelant déjà authentifié, donc une base vide sans cette règle est une impasse. Sur un portable, la personne au clavier est l'exploitant, et c'est exactement ce qu'il faut.

C'est exactement ce qu'il ne faut pas sur un hôte au nom public. Les artefacts livrés montent le DNS et TLS avant que l'exploitant ait tapé quoi que ce soit : la fenêtre est donc ouverte sur internet dès la première seconde, et la première personne à atteindre le formulaire d'inscription possède le déploiement.

Sous `NODE_ENV=production`, cette fenêtre est donc fermée. Une table d'utilisateurs vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un compte créé par inscription ouverte est un compte ordinaire, `GET /api/auth/config` n'annonce jamais `needsSetup`, et `POST /api/admin/bootstrap` refuse. En 0.17.3 et avant, la fenêtre était ouverte en production aussi : mettez à jour avant d'exposer un déploiement neuf.

`rebase dev` lit le même `.env` mais ignore délibérément les deux variables, et le dit au démarrage : en local, la première inscription reste la porte d'entrée. Les valeurs écrites par `rebase init` appartiennent au démarrage de production.

Restent deux portes d'entrée, dont aucune n'est une course :

```bash
REBASE_ADMIN_EMAIL=vous@example.com
REBASE_ADMIN_PASSWORD=<au moins 12 caractères>
DISABLE_SELF_REGISTRATION=true
```

Le runtime crée ce compte une fois, tant que la table des utilisateurs est vide, et ne fait rien à chaque démarrage suivant. Ou attribuez le rôle à un utilisateur existant avec la clé de service, si vous provisionnez les comptes par ailleurs.

Le runtime impose deux règles au démarrage, faute de quoi le compte obtenu est inutilisable :

- Le mot de passe doit faire **au moins 12 caractères**, sinon il est refusé et aucun compte n'est créé.
- L'adresse doit être acceptée par `POST /api/auth/login` : cette route analyse son corps avec `z.string().email()`, si bien qu'un domaine sans point (`admin@localhost`) se crée sans broncher puis répond 400 à chaque connexion. Le démarrage refuse aussi cette adresse.

Définissez les deux ou aucune : une demi-information d'identification est une faute de frappe, et le déploiement qu'elle laisse — auto-inscription fermée, aucun administrateur — ne se récupère qu'à une console `psql`. Le démarrage avertit quand la table est vide en production et qu'aucun administrateur n'est nommé.

Connectez-vous et changez le mot de passe. Il est en clair là où vous avez déposé votre environnement.

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
| **Premier administrateur** | Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` **avant le premier démarrage**, ainsi que `DISABLE_SELF_REGISTRATION=true`. En production, le premier compte inscrit n'est pas promu — voir [Votre premier administrateur](#votre-premier-administrateur). |

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

Si vous voulez que l'administration tourne sur un sous-chemin (par ex. `/admin`), changez une ligne — le `path` de l'app dans `rebase.json` :

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin"
}
```

`rebase build` le passe à Vite comme `base` (via `REBASE_APP_BASE`), Vite le renvoie comme `import.meta.env.BASE_URL`, et le `main.tsx` du scaffold le donne déjà au routeur — les assets, les routes et le serveur s'accordent donc sans que le préfixe soit écrit à trois endroits :

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

L'administration a besoin d'un **data router** — `createBrowserRouter`, pas le simple `BrowserRouter` — car le blocage des modifications non enregistrées utilise `useBlocker`, que seul le data router fournit.

**Backend** — si vous déplacez aussi l'API, mettez à jour son chemin de base :

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
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

Un seul routeur pour les deux moitiés : l'administration a de toute façon besoin du data router, et rien ne justifie que l'app produit soit sur un autre.

Le backend ne nécessite aucune modification pour ce modèle — l'API reste à `/api` et le catch-all de la SPA
sert `index.html` à la fois pour `/` et `/admin/*`.

## Étapes suivantes

- **[Aperçu du backend](/docs/backend)** — Configuration complète du backend
- **[Configuration du stockage](/docs/backend/storage)** — Configuration de S3 pour la production
