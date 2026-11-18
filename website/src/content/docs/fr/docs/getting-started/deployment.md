---
sourceHash: 54382ae26efa26ea
title: Déploiement
sidebar_label: Déploiement
description: Déployez votre projet Rebase en production à l'aide de Docker, de plateformes cloud ou d'installations manuelles.
---

## Ce qu'un déploiement sert

Un projet Rebase se déploie sous la forme d'**un seul serveur** (sur Rebase Cloud : `https://<projet>.rebase.website`). Ce serveur gère :

- **`/api/*`** — l'API de données, l'authentification, le temps réel et le stockage
- **tout le reste** — votre dossier `frontend/` compilé sous forme de SPA statique

Il n'y a pas de service d'administration séparé : le panneau d'administration fait partie d'un frontend, son emplacement dépend donc de ce qu'est votre frontend et du fait que vous lui attribuiez ou non son propre nom d'hôte.

| Type de projet | L'URL racine affiche | Le panneau d'administration se trouve sur |
|----------------|----------------------|-------------------------------------------|
| Structure par défaut (`rebase init`) | Le panneau d'administration | `/` — le frontend **est** l'administration |
| Frontend de produit personnalisé | Votre application | Là où vous le montez, généralement `/admin` — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| Administration en tant qu'application sur son propre nom d'hôte | Votre application | `https://admin.example.com/`, servi par le même serveur — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| Projet backend uniquement | Rien (API seulement) | Non déployé |

:::note[Première visite]
Un nouveau déploiement en **production** ne propose pas d'écran d'initialisation, et sa première inscription correspond à un compte ordinaire. Définissez plutôt l'administrateur avant le premier démarrage — voir [Votre premier administrateur](#votre-premier-administrateur).
:::

## Docker Compose (Recommandé)

Le projet généré inclut déjà un fichier `docker-compose.yml` fonctionnel — **ce
fichier est celui à utiliser pour un projet échafaudé**, tel quel plutôt que
rédigé à la main ou copié depuis ailleurs. `rebase init` a renseigné ses secrets, son
premier compte administrateur et sa version de runtime verrouillée, et il est démarré par
la porte de validation du framework lui-même à chaque push. Il exécute **deux** conteneurs,
Postgres et le runtime Rebase publié avec votre bundle compilé monté
à l'intérieur. Il n'y a aucune image d'application à construire.

La section [Auto-hébergement](/docs/deployment/self-hosting) couvre le même déploiement sans
structure générée préalable, en utilisant
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
issu du dépôt Rebase — ainsi que les deux éléments que ce fichier omet délibérément :
un pooler de connexions, et l'exécution des fonctions ainsi que du worker de jobs en tant que processus distincts.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Exécutez toujours `rebase build` en premier : le service `api` monte `./dist-bundle`, et
sans lui, le conteneur démarre sur un répertoire vide.

La structure du fichier généré :

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

Consultez [Votre premier administrateur](#votre-premier-administrateur) ci-dessous pour les trois lignes `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

Le bundle est monté en lecture seule. `rebase build` installe les dépendances
déclarées du projet dans `dist-bundle` sauf si vous passez l'option `--no-vendor`, auquel cas le
runtime les installe à chaque démarrage et le point de montage doit être accessible en écriture — retirez alors
le `:ro`. Voir [Auto-hébergement](/docs/deployment/self-hosting/#dependencies).

`rebase init` écrit l'ensemble de ces valeurs dans `.env` pour vous, y compris un mot de passe
administrateur généré. Chacune est déclarée avec `${VAR:?…}`, de sorte qu'une variable manquante interrompt la
pile avec un message la désignant plutôt que de démarrer une configuration incomplète —
et Compose interpolant l'ensemble du fichier avant de sélectionner les services, une variable manquante
interrompt également `docker compose up -d db`.

Remplacez l'e-mail de l'administrateur par le vôtre, connectez-vous et modifiez le mot de passe. Voir [Votre
premier administrateur](#votre-premier-administrateur).

### Le schéma

Le runtime crée les tables manquantes au démarrage, **y compris celles déclarées par `backend/schema`** —
`REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble
du schéma et applique la sécurité au niveau des lignes (RLS) associée. Un premier `docker compose up`
sur une base de données vide démarre en servant immédiatement vos tables.

Ce que le démarrage ne fait jamais, c'est modifier un élément qui existe déjà : il ne change pas
le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car un
redémarrage de conteneur ne doit pas altérer un schéma en tant qu'effet secondaire d'un déploiement. Ces
opérations s'effectuent via la CLI, depuis une copie de travail locale ou un job CI pointant vers la base de données
de production :

```bash
pnpm run db:push
```

Exécutez cette commande pour toute modification qui n'est pas purement additive — une colonne renommée, un
type restreint, un champ supprimé.

Pour un **flux de travail en équipe avec gestion de versions**, commitez les fichiers de migration avec
`pnpm run db:generate` et exécutez plutôt `pnpm run db:migrate` lors d'une étape de release.
Dans les deux cas, la commande s'exécute depuis une copie de travail du projet, et non à l'intérieur du conteneur en cours d'exécution —
l'image du runtime étant fournie sans la CLI.

## Votre premier administrateur

**Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` avant le premier démarrage.**
Chaque guide de plateforme sur ce site renvoie ici, car il s'agit de la seule étape pour laquelle
aucune récupération externe n'est possible.

Sur Rebase Cloud, il n'y a rien à configurer : les propriétaires et administrateurs de
l'organisation qui détient le projet ouvrent son panneau d'administration depuis la page du projet
dans la console (**Open CMS**, ou **Continue with Rebase Cloud** sur l'écran
de connexion de l'admin) et sont connectés en tant qu'administrateurs. Cette section s'adresse à tous les
autres environnements où vous exécutez Rebase.

Une base de données vierge ne comporte aucun utilisateur, et hors production, la politique d'inscription
accepte la première inscription et la promeut administrateur. Cela est indispensable : l'initialisation d'un
administrateur nécessite un appelant déjà connecté, donc une base de données vide dépourvue d'une telle
règle mènerait à une impasse. Sur un ordinateur portable, la personne au clavier est l'opérateur et
ce fonctionnement est parfaitement adapté.

Il est en revanche totalement inadapté sur un hôte doté d'un nom public. Les artefacts déployés
activent le DNS et TLS avant même que l'opérateur n'ait pu taper quoi que ce soit, la fenêtre d'accès est donc
ouverte sur Internet dès la première seconde — et quiconque atteint le formulaire d'inscription en premier
prend le contrôle du déploiement.

Par conséquent, sous `NODE_ENV=production`, cette fenêtre est fermée. Une table d'utilisateurs vide
refuse l'inscription d'initialisation avec l'erreur `SETUP_REQUIRED`, un compte créé
via l'inscription ouverte reste un compte ordinaire, `GET /api/auth/config` n'annonce jamais
`needsSetup`, et `POST /api/admin/bootstrap` est refusé.

`rebase dev` lit le même fichier `.env` et ignore délibérément les deux variables, en l'indiquant
au démarrage : en local, la première inscription reste la méthode d'accès. Les valeurs
inscrites par `rebase init` sont destinées au démarrage en production. Effectuer le seeding des deux côtés
consommerait cette fenêtre avant même que le développeur n'ait ouvert l'application, ce qui conduisait
la toute première étape du guide de démarrage rapide à produire un compte sans rôle.

Il reste donc deux manières d'accéder, sans risque de concurrence :

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Le runtime crée ce compte une seule fois, lorsque la table des utilisateurs est vide, et ne fait
plus rien lors des démarrages suivants. Vous pouvez également attribuer le rôle à un utilisateur existant
à l'aide de la clé de service (`service key`), si vous provisionnez les comptes hors bande.

Deux règles sont appliquées par le runtime au démarrage, et leur non-respect produit un compte
inutilisable :

- Le mot de passe doit comporter **au moins 12 caractères**, sans quoi il est rejeté et aucun
  compte n'est créé.
- L'adresse doit être acceptée par `POST /api/auth/login` — son corps étant validé
  avec `z.string().email()`, un domaine sans point (`admin@localhost`) est initialisé avec succès
  mais répondra par une erreur 400 à chaque connexion. Le démarrage refuse également ce type d'adresse.

Définissez les deux variables ou aucune : un identifiant incomplet résulte d'une faute de frappe, et le déploiement qui en résulte
— auto-inscription désactivée, aucun admin — nécessite une invite `psql` pour être débloqué. Le démarrage émet un avertissement
lorsque la table est vide en production et qu'aucun administrateur n'est défini.

Connectez-vous et modifiez le mot de passe. Il est stocké en texte clair là où vous avez placé
votre environnement.

## Liste de contrôle de production

Avant de déployer en production, vérifiez les points suivants :

| Élément | Détails |
|---------|---------|
| **Premier admin** | Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` **avant le premier démarrage**, ainsi que `DISABLE_SELF_REGISTRATION=true`. En production, le premier compte à s'inscrire n'est pas promu — voir [Votre premier administrateur](#votre-premier-administrateur). |
| **NODE_ENV** | `NODE_ENV=production`. C'est cette variable qui ferme la fenêtre d'initialisation, refuse le stockage de fichiers en local, exige `CORS_ORIGINS` et désactive la documentation OpenAPI. Un déploiement conservant la valeur par défaut fonctionne en mode développement. |
| **Schéma de base de données** | Le démarrage crée vos tables déclarées et leur RLS de manière additive. Exécutez `pnpm run db:push` (ou `pnpm run db:migrate`) pour toute modification qui n'est pas purement additive. |
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement sûre (≥ 32 caractères). Ne la réutilisez jamais d'un environnement à l'autre. |
| **DATABASE_URL** | Utilisez une instance Postgres gérée (Neon, Supabase, RDS) avec TLS activé. |
| **CORS_ORIGINS** | Toujours requis, et pas seulement lorsque le frontend est sur un autre domaine. Le runtime refuse de démarrer en production si ni `CORS_ORIGINS` ni `FRONTEND_URL` ne sont définis, car une API qui devine ses origines autorisées finira par autoriser la mauvaise. |
| **Contrôle d'accès au stockage** | Un bucket configuré **refuse de démarrer en production** sans modèle de contrôle d'accès. Le stockage n'est pas régi par la sécurité au niveau des lignes (RLS) et ses clés partagent un espace de noms unique, de sorte qu'une autorisation globale par défaut permet à tout utilisateur connecté de lister (`GET /storage/list?prefix=`), puis de lire, écraser ou supprimer les fichiers de tous les autres utilisateurs. Répondez à cette exigence avec un hook `storageAuthorize` ou des `storagePolicies` (la structure par défaut fournit un hook dans `backend/storage.ts`), ou indiquez explicitement votre intention avec `STORAGE_PUBLIC_READ` pour un véritable CDN public, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` pour une application mono-tenant où chaque compte a accès à l'ensemble des fichiers. |
| **Backend de stockage** | `STORAGE_TYPE=local` en production est **rejeté**, et les téléversements renvoient `501 STORAGE_NOT_CONFIGURED` — le système de fichiers du conteneur étant détruit au redémarrage suivant, un backend local entraînerait une perte de données silencieuse. Utilisez `s3` ou `gcs`, ou définissez `FORCE_LOCAL_STORAGE=true` si le chemin pointe réellement vers un volume persistant. |
| **MFA_ENCRYPTION_KEY** | Définissez cette variable (32+ caractères aléatoires) si vous utilisez TOTP. Sans elle, les secrets stockés sont chiffrés avec `JWT_SECRET` — une rotation de ce dernier déconnecterait tout le monde *et* rendrait indéchiffrable chaque application d'authentification enregistrée. |
| **HTTPS** | Terminez le chiffrement TLS au niveau de votre reverse proxy (nginx, Cloudflare, équilibreur de charge). |
| **Les lectures publiques nécessitent toujours un appelant** | `access: "public"` élargit les *lignes* qu'un appelant peut voir, mais pas qui a le droit d'appeler : une requête anonyme sur `/api/data/*` renvoie une erreur 401 tant que `AUTH_REQUIRE` est actif. Définissez `AUTH_REQUIRE=false` pour un site public qui lit son propre backend, et laissez la RLS décider seule. Il s'agit d'une variable d'environnement, donc un fichier `.env` local la définissant ne sera **pas** transféré avec votre déploiement. |

## Modules natifs sur le runtime géré

Le runtime géré de Rebase Cloud exécute votre bundle dans une image partagée. Il ne possède
aucun compilateur et n'a aucun moyen de charger un **module natif** — c'est-à-dire tout élément fournissant un
binaire `.node` précompilé. Le cas le plus fréquent est de loin `sharp`, qui représente également la dépendance
évidente pour tout service traitant des images.

`rebase cloud deploy` refuse ce cas de figure avant même le téléversement :

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Trois solutions existent, présentées par ordre habituel de pertinence :

1. **Déplacer le traitement au moment du build.** Redimensionnez et réencodez les images lors de votre étape
   de build, puis déployez les résultats. Aucun code natif ne s'exécute ainsi sur le chemin de la requête.
2. **Utiliser un service tiers.** Un CDN d'images ou une API de transformation réalise la même tâche derrière
   une URL.
3. **Exécuter votre propre conteneur.** Un déploiement auto-hébergé (Docker, Kubernetes, ou n'importe quel
   guide de nos [guides de plateformes](/docs/deployment/self-hosting)) repose sur votre propre image, qui peut donc
   embarquer tout ce qu'elle souhaite.

Les fonctions qui requièrent simplement Node sans binaire natif fonctionnent parfaitement — le
déploiement les signale séparément (`1 of 3 function(s) depend on Node`) et les
exécute. La section [Runtime backend géré](/docs/deployment/managed-runtime/) détaille le
reste des éléments pris en charge par le runtime géré : binaires, mémoire, délais d'expiration (timeouts),
système de fichiers, secrets, stockage et réseau sortant.

## Servir le frontend

En production, le backend peut servir le frontend sous forme de SPA statique :

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

De cette façon, vous n'avez besoin de déployer qu'un seul serveur qui gère à la fois la SPA et l'API.

## Guides de déploiement par plateforme

Guides détaillés étape par étape pour chaque plateforme :

| Plateforme | Type | Guide |
|------------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Déployer sur AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Déployer sur GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Déployer sur Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Déployer sur Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Déployer sur Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-détection Dockerfile) | [Déployer sur Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de conteneurs | [Déployer sur Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL dans un pod, sans Docker | [Déployer sur InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + PostgreSQL géré, ou un VPS | [Déployer sur Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run et les autres plateformes serverless sont sans état (stateless). Utilisez un **stockage S3** plutôt que le système de fichiers local pour les téléversements, et configurez `--min-instances 1` si vous utilisez les fonctionnalités temps réel de Rebase (les connexions WebSocket étant interrompues lors de la réduction d'échelle des instances).
:::


## Modifier l'URL de base

Si vous souhaitez que l'administration fonctionne sur un sous-chemin (ex. `/admin`), modifiez le
`path` de l'application dans `rebase.json`, ainsi que sa clé `cms` :

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

`cms` désigne l'emplacement du CMS vers lequel Rebase Cloud crée un lien, et doit se situer à l'intérieur
du `path` de l'application. La structure initiale définit les deux sur `/` ; ainsi, déplacer uniquement `path`
est refusé — le CMS se retrouverait sur `/`, hors d'une application débutant désormais à `/admin`.

Pour attribuer à l'administration son propre nom d'hôte plutôt qu'un sous-chemin, définissez `path` sous la forme d'une
URL complète — `"path": "https://admin.example.com"` — et laissez `cms` sur `"/"`.
L'administration ne répondra alors que sur ce nom d'hôte, et non sur l'adresse
propre du projet, ce qui la rend inaccessible tant que le DNS du nom d'hôte n'est pas validé. L'API reste
accessible sur `/api` également sur ce nom d'hôte. Voir
[Une application sur son propre nom d'hôte](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname)
pour comprendre comment les requêtes sont associées et comment le déploiement sur Rebase Cloud gère le
nom d'hôte.

`rebase build` transmet `path` à Vite sous la forme de `base` (via `REBASE_APP_BASE`), Vite le
restitue sous `import.meta.env.BASE_URL`, et le fichier `main.tsx` de la structure de base
le transmet déjà au routeur — ainsi, les assets, les routes et le serveur sont tous synchronisés
sans avoir à renseigner le préfixe à trois reprises :

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

Conservez l'administration sur un **data router** — `createBrowserRouter` avec
`<RouterProvider>`, comme le fait la structure de base. Avec cette configuration, un enregistrement comportant
des modifications non sauvegardées bloque également la navigation interne à l'application (un lien dans le panneau latéral, le bouton
précédent du navigateur) et demande confirmation avant de continuer, grâce à `useBlocker`, fourni
exclusivement par un data router.

L'administration fonctionne
également sous un `<BrowserRouter>` classique. Dans ce cas, la protection contre les modifications non sauvegardées
se rabat sur la boîte de dialogue native de confirmation de sortie du navigateur, qui s'applique lors d'un rechargement, de la fermeture
de l'onglet ou de la saisie d'une URL ; la navigation à l'intérieur de l'application se poursuivra en revanche sans avertissement.

**Backend** — si vous déplacez également l'API, mettez à jour son chemin de base :

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montage sans `basename` de routeur]
L'approche par `basename` décrite ci-dessus est la méthode recommandée — react-router supprime le
préfixe de l'emplacement (location), ce qui permet à l'administration de fonctionner telle quelle. Si vous intégrez
plutôt l'administration au sein d'une **route avec préfixe de chemin** d'une application plus vaste (ex. `<Route path="/admin/*">`)
sans `basename`, le chemin courant conserve son préfixe `/admin`. Informez-en le CMS
afin que la correspondance URL⇄table prenne en compte ce préfixe — sinon, les vues restent bloquées sur un
indicateur de chargement sans récupérer de données :

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Définissez **soit** le `basename` du routeur **soit** le `basePath` de `RebaseCMS` — mais pas les deux, sans quoi le
préfixe serait appliqué deux fois.
:::

### Application produit + Administration sur un seul déploiement

La raison courante de déplacer l'administration sur `/admin` est de déployer votre **propre application produit**
à la racine de ce même déploiement. Un point d'entrée Vite unique peut servir les deux, séparés selon l'URL,
afin que chaque application soit chargée à la demande (lazy-loaded) et que les visiteurs du produit ne téléchargent jamais le bundle d'administration :

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

Un seul routeur pour les deux parties : il est préférable de conserver l'administration sur un data router, ce
qui permet aux modifications non sauvegardées de bloquer la navigation interne, et il n'y a aucune raison pour que
l'application produit en utilise un distinct.

Le backend ne nécessite aucun changement pour cette configuration — l'API reste accessible sur `/api` et la
route globale par défaut (catch-all) de la SPA sert `index.html` aussi bien pour `/` que pour `/admin/*`.

## Étapes suivantes

- **[Aperçu du Backend](/docs/backend)** — Configuration complète du backend
- **[Configuration du Stockage](/docs/backend/storage)** — Configuration S3 pour la production
