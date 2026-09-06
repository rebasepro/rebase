---
sourceHash: b48cc9bf8ad4dcf3
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
| Frontend produit personnalisé | Votre app | Là où vous le montez, généralement `/admin` — voir [Changer l'URL de base](#changer-lurl-de-base) |
| Projet backend uniquement | Rien (API seulement) | Non déployé |

:::note[Première visite]
Un déploiement de **production** neuf n'offre aucun écran de bootstrap, et sa première inscription est un compte ordinaire. Nommez plutôt l'administrateur avant le premier démarrage — voir [Votre premier administrateur](#votre-premier-administrateur).
:::

## Docker Compose (Recommandé)

Le projet généré inclut déjà un `docker-compose.yml` fonctionnel — **c'est ce
fichier-là qu'il faut utiliser pour un projet issu du scaffold**, tel quel
plutôt qu'écrit à la main ou copié d'ailleurs. `rebase init` a rempli ses
secrets, son premier compte administrateur et sa version de runtime épinglée, et
la porte d'acceptation du framework le démarre à chaque push. Il fait tourner
**deux** conteneurs : Postgres et le runtime Rebase publié, avec votre bundle
compilé monté dedans. Il n'y a aucune image applicative à construire.

[Auto-hébergement](/docs/deployment/self-hosting) couvre le même déploiement sans
scaffold derrière, avec
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
du dépôt Rebase — et les deux choses que ce fichier laisse délibérément de côté :
un pooler de connexions, et l'exécution des fonctions et du worker de tâches
comme processus distincts.

```bash
rebase build          # produit ./dist-bundle
docker compose up -d
```

`rebase build` d'abord, toujours : le service `api` monte `./dist-bundle`, et
sans lui le conteneur démarre sur un répertoire vide.

La forme du fichier généré :

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

Les trois lignes `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` sont nouvelles <span class="since-badge" data-since="0.18">Since 0.18</span>
— en 0.17.3, le premier compte inscrit devient l'administrateur, en production
aussi. Voir [Votre premier administrateur](#votre-premier-administrateur)
ci-dessous.

Le bundle est monté en lecture seule. `rebase build` installe les dépendances
déclarées du projet dans `dist-bundle`, sauf si vous passez `--no-vendor` — dans
ce cas le runtime les installe à chaque démarrage et le montage doit être
accessible en écriture : retirez alors le `:ro`. Voir
[Auto-hébergement](/docs/deployment/self-hosting/#dependencies).

`rebase init` écrit tout cela dans `.env` pour vous, y compris un mot de passe
administrateur généré. Chacune est déclarée avec `${VAR:?…}`, si bien qu'une
variable manquante arrête la pile avec un message qui la nomme plutôt que de
démarrer quelque chose de à moitié configuré — et Compose interpole le fichier
entier avant de sélectionner les services, donc une variable manquante arrête
aussi `docker compose up -d db`.

Remplacez l'e-mail administrateur par le vôtre, connectez-vous et changez le mot
de passe. Voir [Votre premier administrateur](#votre-premier-administrateur).

### Le schéma

Le runtime crée les tables manquantes au démarrage, **y compris celles de vos
collections** : `REBASE_MIGRATE_ON_BOOT` vaut `ensure` par défaut, ce qui est
additif sur tout le schéma et applique la sécurité au niveau des lignes avec lui.
Un premier `docker compose up` sur une base vide se lève en servant vos
collections.

Ce que le démarrage ne fait jamais, c'est modifier quelque chose qui existe
déjà : il ne change pas un type de colonne, ne supprime rien et n'édite pas les
libellés d'un enum existant, car le redémarrage d'un conteneur ne doit pas
remodeler un schéma comme effet de bord d'un déploiement. Cela passe par la CLI,
depuis un checkout ou un job CI pointé sur la base de données de production :

```bash
pnpm run db:push
```

Exécutez-le pour la RLS des tables de jonction sur les relations
plusieurs-à-plusieurs, et pour tout changement qui n'est pas purement additif :
une colonne renommée, un type rétréci, un champ supprimé.

Pour un **workflow versionné et en équipe**, validez des fichiers de migration
avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` comme étape de
release à la place. Dans les deux cas, cela s'exécute depuis un checkout du
projet, pas à l'intérieur du conteneur en cours d'exécution — l'image de runtime
est livrée sans la CLI.

## Votre premier administrateur

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` avant le premier démarrage.** Chaque guide par plateforme de ce site renvoie ici, car c'est la seule étape qui n'a aucun recours depuis l'extérieur.

Une base de données neuve n'a aucun utilisateur, et hors production la politique d'inscription accepte la première création de compte et la promeut administrateur. Il le faut : nommer un administrateur exige un appelant déjà authentifié, donc une base vide sans cette règle est une impasse. Sur un portable, la personne au clavier est l'exploitant, et c'est exactement ce qu'il faut.

C'est exactement ce qu'il ne faut pas sur un hôte au nom public. Les artefacts livrés montent le DNS et TLS avant que l'exploitant ait tapé quoi que ce soit : la fenêtre est donc ouverte sur internet dès la première seconde, et la première personne à atteindre le formulaire d'inscription possède le déploiement.

Sous `NODE_ENV=production`, cette fenêtre est donc fermée. Une table d'utilisateurs vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un compte créé par inscription ouverte est un compte ordinaire, `GET /api/auth/config` n'annonce jamais `needsSetup`, et `POST /api/admin/bootstrap` refuse. En 0.17.3 et avant, la fenêtre était ouverte en production aussi : mettez à jour avant d'exposer un déploiement neuf.

`rebase dev` lit le même `.env` mais ignore délibérément les deux variables, et le dit au démarrage : en local, la première inscription reste la porte d'entrée. Les valeurs écrites par `rebase init` appartiennent au démarrage de production. Amorcer des deux côtés dépenserait la fenêtre avant que le développeur ait ouvert l'app, ce qui est précisément ce qui faisait produire au premier pas du quickstart un compte sans rôle.

Restent deux portes d'entrée, dont aucune n'est une course :

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Le runtime crée ce compte une fois, tant que la table des utilisateurs est vide, et ne fait rien à chaque démarrage suivant. Ou attribuez le rôle à un utilisateur existant avec la clé de service, si vous provisionnez les comptes par ailleurs.

Le runtime impose deux règles au démarrage, faute de quoi le compte obtenu est inutilisable :

- Le mot de passe doit faire **au moins 12 caractères**, sinon il est refusé et aucun compte n'est créé.
- L'adresse doit être acceptée par `POST /api/auth/login` : cette route analyse son corps avec `z.string().email()`, si bien qu'un domaine sans point (`admin@localhost`) se crée sans broncher puis répond 400 à chaque connexion. Le démarrage refuse aussi cette adresse.

Définissez les deux ou aucune : une demi-information d'identification est une faute de frappe, et le déploiement qu'elle laisse — auto-inscription fermée, aucun administrateur — ne se récupère qu'à une console `psql`. Le démarrage avertit quand la table est vide en production et qu'aucun administrateur n'est nommé.

Connectez-vous et changez le mot de passe. Il est en clair là où vous avez déposé votre environnement.

## Liste de contrôle pour la production

<span class="since-badge" data-since="0.18">Since 0.18</span>

Avant de déployer en production, assurez-vous de :

| Élément | Détails |
|------|---------|
| **Premier administrateur** | Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` **avant le premier démarrage**, ainsi que `DISABLE_SELF_REGISTRATION=true`. En production, le premier compte inscrit n'est pas promu — voir [Votre premier administrateur](#votre-premier-administrateur). |
| **NODE_ENV** | `NODE_ENV=production`. C'est ce qui ferme la fenêtre d'amorçage, refuse le stockage de fichiers local, exige `CORS_ORIGINS` et coupe la documentation OpenAPI. Un déploiement resté sur la valeur par défaut tourne en mode développement. |
| **Schéma de base de données** | Le démarrage crée vos tables de collections de façon additive. Exécutez `pnpm run db:push` (ou `pnpm run db:migrate`) pour la RLS des tables de jonction et pour tout ce qui n'est pas purement additif. |
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement forte (≥ 32 caractères). Ne la réutilisez jamais entre environnements. |
| **DATABASE_URL** | Utilisez une instance Postgres gérée (Neon, Supabase, RDS) avec TLS activé |
| **CORS_ORIGINS** | Toujours, pas seulement quand le frontend est sur un autre domaine. Le runtime refuse de démarrer en production sans `CORS_ORIGINS` ni `FRONTEND_URL`, car une API qui devine ses origines autorisées finit par autoriser la mauvaise. |
| **Contrôle d'accès au stockage** | Un bucket configuré **refuse de démarrer en production** sans modèle de contrôle d'accès. Le stockage ne relève pas de la sécurité au niveau des lignes et ses clés partagent un espace de noms plat : un défaut « tout autoriser » laisse donc n'importe quel utilisateur connecté lister (`GET /storage/list?prefix=`) puis lire, écraser ou supprimer les fichiers de tous les autres. Satisfaites-le avec un hook `storageAuthorize` ou `storagePolicies` (le scaffold livre un hook dans `config/storage.ts`), ou déclarez l'intention avec `STORAGE_PUBLIC_READ` pour un véritable CDN public, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` pour une app mono-tenant où chaque compte est digne de confiance pour chaque fichier. |
| **Backend de stockage** | `STORAGE_TYPE=local` est **abandonné** en production, et les téléversements répondent `501 STORAGE_NOT_CONFIGURED` — le système de fichiers du conteneur est détruit au prochain redémarrage, donc un backend local est une perte de données silencieuse. Utilisez `s3` ou `gcs`, ou définissez `FORCE_LOCAL_STORAGE=true` si le chemin est vraiment un volume durable. |
| **MFA_ENCRYPTION_KEY** | Définissez-la (32+ caractères aléatoires) si vous utilisez TOTP. Sans elle, les secrets stockés sont chiffrés avec `JWT_SECRET` — le faire tourner déconnecte donc tout le monde *et* rend indéchiffrable chaque authentificateur enrôlé. |
| **HTTPS** | Terminez TLS au niveau de votre reverse proxy (nginx, Cloudflare, équilibreur de charge) |
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
