---
sourceHash: d1e6d42ab673666c
title: Déploiement
sidebar_label: Déploiement
description: Déployez votre projet Rebase en production avec Docker, des plateformes cloud ou des configurations manuelles.
---

## Ce qu'un déploiement sert

Un projet Rebase se déploie sous la forme d'**un seul serveur** (sur Rebase Cloud : `https://<project>.rebase.website`). Ce serveur gère :

- **`/api/*`** — l'API de données, l'authentification, le temps réel et le stockage
- **tout le reste** — votre dossier `frontend/` compilé en tant que SPA statique

Il n'y a pas de service d'administration distinct : le panneau d'administration fait partie du frontend. L'endroit où il apparaît dépend donc de ce qu'est votre frontend et du fait de lui attribuer ou non un nom d'hôte propre.

| Type de projet | L'URL racine affiche | Le panneau d'administration se trouve sur |
|----------------|----------------------|-------------------------------------------|
| Structure par défaut (`rebase init`) | Le panneau d'administration | `/` — le frontend **est** l'administration |
| Frontend produit personnalisé | Votre application | Là où vous le montez, généralement `/admin` — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| L'administration sur son propre nom d'hôte | Votre application | `https://admin.example.com/`, servie par le même serveur — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| Projet backend uniquement | Rien (API uniquement) | Non déployé |

:::note[Première visite]
Un nouveau déploiement en **production** ne propose pas d'écran d'initialisation, et sa première inscription crée un compte ordinaire. Définissez plutôt l'administrateur avant le premier démarrage — voir [Votre premier administrateur](#votre-premier-administrateur).
:::

## Docker Compose (Recommandé)

Le projet généré inclut déjà un fichier `docker-compose.yml` fonctionnel — **ce fichier est celui à utiliser pour un projet généré**, tel quel plutôt qu'écrit à la main ou copié depuis ailleurs. `rebase init` a renseigné ses secrets, son premier compte administrateur et sa version de runtime verrouillée, et il est exécuté par la porte d'acceptation du framework à chaque push. Il fait tourner **deux** conteneurs : Postgres et le runtime Rebase publié avec votre bundle compilé monté à l'intérieur. Il n'y a aucune image d'application à construire.

Le guide [Auto-hébergement](/docs/deployment/self-hosting) couvre le même déploiement sans projet généré au préalable, en utilisant
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
du dépôt Rebase — ainsi que les deux éléments que ce fichier omet délibérément : un gestionnaire de pool de connexions, et l'exécution des fonctions ainsi que du worker de tâches dans leurs propres processus.

```bash
rebase build          # produit ./dist-bundle
docker compose up -d
```

Exécutez toujours `rebase build` en premier : le service `api` monte `./dist-bundle`, et sans lui, le conteneur démarre sur un répertoire vide.

Structure du fichier généré :

```yaml title="docker-compose.yml (généré — abrégé)"
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

Voir [Votre premier administrateur](#votre-premier-administrateur) ci-dessous pour les trois lignes `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

Le bundle est monté en lecture seule. `rebase build` installe les dépendances déclarées du projet dans `dist-bundle` sauf si vous passez `--no-vendor`, auquel cas le runtime les installe à chaque démarrage et le montage doit être accessible en écriture — supprimez le `:ro`. Voir [Auto-hébergement](/docs/deployment/self-hosting/#dependencies).

`rebase init` écrit tout cela dans `.env` pour vous, y compris un mot de passe administrateur généré. Chacune des variables est déclarée avec `${VAR:?…}`, de sorte qu'une variable manquante interrompt la stack avec un message explicite au lieu de lancer un service à moitié configuré — et comme Compose évalue l'ensemble du fichier avant de sélectionner les services, une variable manquante empêchera également `docker compose up -d db` de démarrer.

Remplacez l'e-mail de l'administrateur par le vôtre, connectez-vous et modifiez le mot de passe. Voir [Votre premier administrateur](#votre-premier-administrateur).

### Le schéma

Le runtime crée les tables manquantes au démarrage, **y compris celles de vos collections** — `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui applique les modifications de manière additive sur l'ensemble du schéma ainsi que la sécurité au niveau des lignes (RLS). Un premier `docker compose up` sur une base de données vide démarre en servant directement vos collections.

En revanche, le démarrage ne modifie jamais ce qui existe déjà : il ne change pas le type d'une colonne, ne supprime rien et ne modifie pas les valeurs d'une énumération existante, car un redémarrage de conteneur ne doit pas altérer un schéma en tant qu'effet secondaire d'un déploiement. Ces modifications passent par la CLI, depuis une copie de travail locale ou un job de CI pointant vers la base de données de production :

```bash
pnpm run db:push
```

Exécutez cette commande pour toute modification qui n'est pas purement additive — une colonne renommée, un type rendu plus strict, un champ supprimé.

Pour un **flux de travail en équipe avec versionnement**, validez des fichiers de migration avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` lors de l'étape de publication. Dans les deux cas, cela s'exécute depuis une copie de travail du projet, et non à l'intérieur du conteneur en cours d'exécution — l'image du runtime est distribuée sans la CLI.

## Votre premier administrateur

**Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` avant le premier démarrage.**
Tous les guides de déploiement de cette documentation insistent sur ce point, car il s'agit de la seule étape sans moyen de récupération externe.

Une nouvelle base de données ne contient aucun utilisateur, et hors production, la politique d'inscription accepte la première inscription et la promeut administrateur. C'est nécessaire : l'initialisation d'un administrateur nécessite un appelant déjà connecté ; une base vide sans cette règle serait donc une impasse. Sur une machine locale, la personne au clavier est l'opérateur et ce comportement est parfaitement adapté.

Ce n'est en revanche pas du tout adapté sur un serveur doté d'un nom de domaine public. Les configurations déployées activent le DNS et TLS avant même que l'opérateur n'ait pu taper quoi que ce soit : la fenêtre d'accès est donc ouverte à tout Internet dès la première seconde — et quiconque accède en premier au formulaire d'inscription prend le contrôle du déploiement.

Ainsi, sous `NODE_ENV=production`, cette fenêtre est fermée. Une table d'utilisateurs vide refuse l'inscription d'initialisation avec l'erreur `SETUP_REQUIRED`, un compte créé via une inscription libre reste un compte ordinaire, `GET /api/auth/config` ne renvoie jamais `needsSetup`, et `POST /api/admin/bootstrap` est rejeté.

`rebase dev` lit le même fichier `.env` et ignore délibérément ces deux variables, en l'indiquant au démarrage : en local, la première inscription reste la méthode d'accès prévue. Les valeurs écrites par `rebase init` concernent le démarrage en production. Effectuer le seeding des deux côtés consommerait la fenêtre d'accès avant même que le développeur n'ait ouvert l'application, ce qui provoquait l'attribution d'un compte sans rôle dès la première étape du guide de démarrage rapide.

Il reste donc deux manières d'accéder au système, sans risque de concurrence :

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Le runtime crée ce compte une seule fois, lorsque la table des utilisateurs est vide, et n'effectue plus rien lors des démarrages ultérieurs. Vous pouvez également attribuer le rôle à un utilisateur existant à l'aide de la clé de service (`service key`), si vous provisionnez les comptes de manière externe.

Deux règles sont appliquées par le runtime au démarrage, et si vous ne les respectez pas, elles produiront un compte inutilisable par quiconque :

- Le mot de passe doit comporter **au moins 12 caractères**, sans quoi il est refusé et aucun compte n'est créé.
- L'adresse doit être acceptée par `POST /api/auth/login` — son corps de requête est validé avec `z.string().email()`. Ainsi, un domaine sans point (`admin@localhost`) s'enregistre sans erreur mais renvoie ensuite une erreur 400 à chaque tentative de connexion. Le démarrage refusera également cette adresse.

Définissez les deux variables ou aucune des deux : un identifiant incomplet équivaut à une erreur de saisie, et le déploiement qui en résulterait — auto-inscription désactivée, aucun administrateur — nécessiterait un accès direct à `psql` pour être débloqué. Le démarrage émet un avertissement lorsque la table est vide en production et qu'aucun administrateur n'est spécifié.

Connectez-vous et modifiez le mot de passe. Il est stocké en clair là où vous avez placé vos variables d'environnement.

## Liste de contrôle pour la production

Avant de déployer en production, vérifiez les points suivants :

| Élément | Détails |
|---------|---------|
| **Premier admin** | Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` **avant le premier démarrage**, ainsi que `DISABLE_SELF_REGISTRATION=true`. En production, le premier compte inscrit n'est pas promu administrateur — voir [Votre premier administrateur](#votre-premier-administrateur). |
| **NODE_ENV** | `NODE_ENV=production`. C'est ce qui ferme la fenêtre d'initialisation, refuse le stockage de fichiers en local, exige `CORS_ORIGINS` et désactive la documentation OpenAPI. Un déploiement conservant la valeur par défaut fonctionne en mode développement. |
| **Schéma de base de données** | Le démarrage crée de manière additive les tables de vos collections et leurs politiques RLS. Exécutez `pnpm run db:push` (ou `pnpm run db:migrate`) pour tout changement non purement additif. |
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement sûre (≥ 32 caractères). Ne la réutilisez jamais entre différents environnements. |
| **DATABASE_URL** | Utilisez une instance Postgres managée (Neon, Supabase, RDS) avec TLS activé. |
| **CORS_ORIGINS** | Toujours requis, pas seulement lorsque le frontend est sur un autre domaine. Le runtime refuse de démarrer en production si ni `CORS_ORIGINS` ni `FRONTEND_URL` ne sont définis, car une API qui tente de deviner les origines autorisées finira par autoriser la mauvaise. |
| **Contrôle d'accès au stockage** | Un bucket configuré **refuse de démarrer en production** en l'absence d'un modèle de contrôle d'accès. Le stockage n'est pas soumis au RLS et ses clés partagent un espace de noms plat unique. Par conséquent, autoriser tout le monde par défaut permettrait à n'importe quel utilisateur connecté de lister (`GET /storage/list?prefix=`) puis de lire, écraser ou supprimer les fichiers de tous les autres utilisateurs. Répondez à cette exigence avec un hook `storageAuthorize` ou des `storagePolicies` (le squelette de projet fournit un hook dans `config/storage.ts`), ou indiquez explicitement votre intention avec `STORAGE_PUBLIC_READ` pour un CDN réellement public, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` pour une application mono-tenant où chaque compte a accès à l'ensemble des fichiers. |
| **Backend de stockage** | `STORAGE_TYPE=local` en production est **rejeté**, et les téléversements renvoient `501 STORAGE_NOT_CONFIGURED` — le système de fichiers du conteneur étant détruit au redémarrage suivant, un stockage local entraînerait une perte silencieuse de données. Utilisez `s3` ou `gcs`, ou définissez `FORCE_LOCAL_STORAGE=true` si le chemin correspond réellement à un volume persistant. |
| **MFA_ENCRYPTION_KEY** | Définissez cette variable (au moins 32 caractères aléatoires) si vous utilisez TOTP. Sans elle, les secrets stockés sont chiffrés avec `JWT_SECRET` — ainsi, renouveler ce dernier déconnecterait tout le monde *et* rendrait impossible le déchiffrement de chaque application d'authentification configurée. |
| **HTTPS** | Terminez le chiffrement TLS au niveau de votre reverse proxy (nginx, Cloudflare, équilibreur de charge). |
| **Les lectures publiques nécessitent toujours un appelant** | `access: "public"` étend les *lignes* qu'un appelant peut voir, mais pas qui a le droit d'appeler l'API : une requête anonyme vers `/api/data/*` renvoie une erreur 401 tant que `AUTH_REQUIRE` est actif. Définissez `AUTH_REQUIRE=false` pour un site public qui interroge son propre backend, et laissez le RLS décider seul. Il s'agit d'une variable d'environnement : un fichier `.env` local la définissant **ne sera pas** embarqué avec votre déploiement. |

## Modules natifs sur le runtime managé

Le runtime managé de Rebase Cloud exécute votre bundle dans une image partagée. Il n'a pas de compilateur et ne peut pas charger de **module natif** — c'est-à-dire tout paquet fournissant un binaire `.node` précompilé. Le plus courant de loin est `sharp`, qui est également la dépendance typique pour tout ce qui sert des images.

`rebase cloud deploy` rejette ce cas de figure avant même le téléversement :

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Trois solutions existent, classées de la plus recommandée à la moins recommandée :

1. **Déplacer le travail au moment de la compilation.** Redimensionnez et réencodez les images lors de votre étape de build, puis déployez le résultat. Rien de natif ne s'exécute ainsi sur le chemin de la requête.
2. **Utiliser un service dédié.** Un CDN d'images ou une API de transformation réalise la même tâche derrière une URL.
3. **Exécuter votre propre conteneur.** Un déploiement auto-hébergé (Docker, Kubernetes, ou n'importe lequel des [guides de plateformes](/docs/deployment/self-hosting)) utilise votre propre image, qui peut donc contenir tout ce que vous souhaitez.

Les fonctions nécessitant simplement Node sans binaire natif fonctionnent sans problème — le déploiement les signale séparément (`1 of 3 function(s) depend on Node`) et les exécute. La page [Runtime backend managé](/docs/deployment/managed-runtime/) détaille le reste des limites et capacités du runtime managé : binaires, mémoire, délais d'expiration, système de fichiers, secrets, stockage et réseau sortant.

## Servir le Frontend

En production, le backend peut servir le frontend comme une SPA statique :

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compilez le frontend au préalable :

```bash
cd frontend && pnpm build
```

De cette manière, vous n'avez besoin de déployer qu'un seul serveur qui gère à la fois la SPA et l'API.

## Guides de déploiement par plateforme

Guides étape par étape détaillés pour chaque plateforme :

| Plateforme | Type | Guide |
|------------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Déployer sur AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Déployer sur GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Déployer sur Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Déployer sur Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Déployer sur Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (détection auto du Dockerfile) | [Déployer sur Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de conteneurs | [Déployer sur Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL dans un pod, sans Docker | [Déployer sur InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + PostgreSQL managé, ou un VPS | [Déployer sur Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run et d'autres plateformes serverless sont sans état (stateless). Utilisez le **stockage S3** au lieu du système de fichiers local pour le téléversement de fichiers, et définissez `--min-instances 1` si vous utilisez les fonctionnalités temps réel de Rebase (les connexions WebSocket sont interrompues lors de la réduction d'instances).
:::

## Modifier l'URL de base

Si vous souhaitez que l'administration fonctionne sur un sous-chemin (par exemple `/admin`), modifiez la propriété `path` de l'application dans `rebase.json`, ainsi que son `cms` :

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

`cms` correspond à l'emplacement du CMS vers lequel Rebase Cloud crée des liens, et il doit se trouver à l'intérieur du `path` de l'application. La configuration initiale définit les deux sur `/` ; modifier `path` seul sera donc refusé — le CMS se trouverait à `/`, en dehors d'une application débutant désormais à `/admin`.

Pour attribuer à l'administration son propre nom d'hôte plutôt qu'un sous-chemin, indiquez une URL complète dans `path` — `"path": "https://admin.example.com"` — et laissez `cms` sur `"/"`. L'administration ne répondra alors que sur ce nom d'hôte, et non sur l'adresse principale du projet ; elle sera donc inaccessible tant que le DNS du nom d'hôte ne sera pas validé. L'API reste accessible sur `/api` sur ce nom d'hôte également. Consultez [Une application sur son propre nom d'hôte](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) pour comprendre comment les requêtes sont associées et ce qu'un déploiement Rebase Cloud configure avec le nom d'hôte.

`rebase build` transmet `path` à Vite en tant que `base` (via `REBASE_APP_BASE`), Vite le restitue sous `import.meta.env.BASE_URL`, et le fichier `main.tsx` généré le transmet déjà au routeur — ainsi, les assets, les routes et le serveur sont tous synchronisés sans avoir à renseigner le préfixe à trois endroits distincts :

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

Conservez l'administration sur un **data router** — `createBrowserRouter` avec `<RouterProvider>`, tel que configuré dans le projet initial. Grâce à cela, un enregistrement contenant des modifications non sauvegardées bloque également la navigation interne à l'application (un clic dans le menu, le bouton retour du navigateur) et demande confirmation au préalable via `useBlocker`, fourni uniquement par un data router.

L'administration fonctionne également avec un `<BrowserRouter>` classique. Dans ce cas, la protection contre la perte de modifications se rabat sur la boîte de dialogue native du navigateur, qui gère le rafraîchissement de la page, la fermeture de l'onglet ou la saisie directe d'une URL ; la navigation interne à l'application se poursuivra toutefois sans avertissement.

**Backend** — si vous déplacez également l'API, mettez à jour son chemin de base :

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montage sans `basename` de routeur]
L'approche avec `basename` ci-dessus est celle recommandée — react-router retire le préfixe de l'URL courante, ce qui permet à l'administration de fonctionner sans ajustement. Si vous intégrez plutôt l'administration dans une **route avec préfixe de chemin** d'une application plus vaste (ex. `<Route path="/admin/*">`) sans `basename`, le chemin courant conservera son préfixe `/admin`. Vous devez alors en informer le CMS afin que la résolution URL ⇄ collection prenne en compte ce préfixe — dans le cas contraire, les vues resteront bloquées sur un indicateur de chargement sans récupérer de données :

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Définissez **soit** le `basename` du routeur, **soit** le `basePath` de `RebaseCMS` — pas les deux, sinon le préfixe sera appliqué deux fois.
:::

### Application produit + Administration sur un seul déploiement

La raison la plus fréquente de déplacer l'administration sur `/admin` est de déployer votre **propre application produit** à la racine du même environnement. Un seul point d'entrée Vite peut servir les deux, répartis selon l'URL, ce qui permet de charger chaque application à la demande (lazy-loading) pour que les utilisateurs du produit ne téléchargent jamais le bundle de l'administration :

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

Un seul routeur pour les deux parties : il est préférable de laisser l'administration sur un data router pour permettre l'interception de la navigation en cas de modifications non enregistrées, et rien n'empêche l'application produit d'utiliser le même.

Le backend ne nécessite aucun changement pour ce cas d'usage — l'API reste sur `/api` et la règle générique de la SPA sert `index.html` aussi bien pour `/` que pour `/admin/*`.

## Prochaines étapes

- **[Vue d'ensemble du backend](/docs/backend)** — Configuration complète du backend
- **[Configuration du stockage](/docs/backend/storage)** — Configuration S3 pour la production
