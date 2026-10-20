---
sourceHash: 1fb30b9d3983d379
title: Déploiement
sidebar_label: Déploiement
description: Déployez votre projet Rebase en production à l'aide de Docker, de plateformes cloud ou d'installations manuelles.
---

## Ce qu'un déploiement sert

Un projet Rebase se déploie sous la forme d'**un seul serveur** (sur Rebase Cloud : `https://<projet>.rebase.website`). Ce serveur gère :

- **`/api/*`** — l'API de données, l'authentification, le temps réel et le stockage
- **tout le reste** — votre dossier `frontend/` compilé sous forme de SPA statique

Il n'y a pas de service d'administration distinct : le panneau d'administration fait partie d'un frontend, donc son emplacement dépend de la nature de votre frontend et de l'attribution ou non d'un nom d'hôte dédié.

| Type de projet | L'URL racine affiche | Le panneau d'administration se trouve sur |
|----------------|----------------------|-------------------------------------------|
| Structure par défaut (`rebase init`) | Le panneau d'administration | `/` — le frontend **est** l'administration |
| Frontend de produit personnalisé | Votre application | Là où vous le montez, généralement `/admin` — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| L'administration en tant qu'application sur son propre nom d'hôte | Votre application | `https://admin.example.com/`, servi par le même serveur — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| Projet backend uniquement | Rien (API seulement) | Non déployé |

:::note[Première visite]
Un nouveau déploiement en **production** ne propose pas d'écran d'initialisation (bootstrap), et sa première inscription crée un compte ordinaire. Définissez plutôt l'administrateur avant le premier démarrage — voir [Votre premier administrateur](#votre-premier-administrateur).
:::

## Docker Compose (Recommandé)

Le projet généré inclut déjà un fichier `docker-compose.yml` fonctionnel — **ce
fichier est celui à utiliser pour un projet échafaudé**, tel quel plutôt
qu'écrit à la main ou copié d'ailleurs. `rebase init` a renseigné ses secrets, son
premier compte administrateur et sa version d'exécution épinglée, et il est démarré par la
barrière de validation du framework lui-même à chaque push. Il exécute **deux** conteneurs,
Postgres et le runtime Rebase publié avec votre bundle compilé monté
à l'intérieur. Il n'y a aucune image d'application à construire.

[Auto-hébergement](/docs/deployment/self-hosting) couvre le même déploiement sans
structure générée sous-jacente, en utilisant
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
depuis le dépôt Rebase — ainsi que les deux éléments que ce fichier omet délibérément :
un pooler de connexions, et l'exécution des fonctions et du worker de tâches dans leurs
propres processus.

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

Les trois lignes `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` sont nouvelles
— sur la version 0.17.3, le premier compte à s'inscrire devient administrateur, y
compris en production. Voir [Votre premier administrateur](#votre-premier-administrateur) ci-dessous.

Le bundle est monté en lecture seule. `rebase build` installe les dépendances déclarées
du projet dans `dist-bundle`, sauf si vous passez `--no-vendor`, auquel cas le
runtime les installe à chaque démarrage et le point de montage doit être accessible en écriture — retirez
le `:ro`. Voir [Auto-hébergement](/docs/deployment/self-hosting/#dependencies).

`rebase init` écrit l'ensemble de ces valeurs dans `.env` pour vous, y compris un mot
de passe administrateur généré. Chacune est déclarée avec `${VAR:?…}`, de sorte qu'une variable manquante
interrompt la stack avec un message la désignant plutôt que de démarrer une configuration incomplète —
et comme Compose interpole le fichier entier avant de sélectionner les services, une variable manquante
bloque également `docker compose up -d db`.

Remplacez l'e-mail de l'administrateur par le vôtre, connectez-vous et modifiez le mot de passe. Voir [Votre
premier administrateur](#votre-premier-administrateur).

### Le schéma

Le runtime crée les tables manquantes au démarrage, **y compris celles de vos collections** —
`REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble
du schéma et applique la sécurité au niveau des lignes (RLS) associée. Un premier `docker compose up`
sur une base de données vide démarre en servant immédiatement vos collections.

Ce que le démarrage ne fait jamais, c'est modifier un élément existant : il ne change pas
le type d'une colonne, ne supprime rien et ne modifie pas les libellés d'un enum existant, car un
redémarrage de conteneur ne doit pas altérer un schéma en tant qu'effet secondaire d'un déploiement. Ces
opérations passent par la CLI, depuis une copie locale du code ou une tâche CI pointant vers la base de données
de production :

```bash
pnpm run db:push
```

Exécutez cette commande pour toute modification qui n'est pas purement additive — une colonne renommée,
un type restreint, un champ supprimé.

Pour un **flux de travail en équipe avec gestion de versions**, commitez les fichiers de migration avec
`pnpm run db:generate` et exécutez plutôt `pnpm run db:migrate` lors de l'étape de livraison (release).
Dans les deux cas, l'exécution s'effectue depuis une copie du projet, et non à l'intérieur du conteneur en cours d'exécution —
l'image du runtime étant livrée sans la CLI.

## Votre premier administrateur

**Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` avant le premier démarrage.**
Tous les guides de plateformes sur ce site renvoient ici, car il s'agit de la seule étape pour laquelle
aucune récupération externe n'est possible.

Une nouvelle base de données ne contient aucun utilisateur, et hors production, la politique d'inscription
accepte la première création de compte et la promeut administrateur. Cela est indispensable : initialiser
un administrateur nécessite un utilisateur déjà connecté, de sorte qu'une base de données vide sans cette
règle serait une impasse. Sur un ordinateur portable, la personne au clavier est l'opérateur et
ce comportement est parfaitement adapté.

Ce comportement est en revanche totalement inadapté sur un hôte disposant d'un nom public. Les artefacts livrés
activent le DNS et le TLS avant que l'opérateur n'ait pu taper quoi que ce soit, ce qui laisse la fenêtre ouverte
à tout Internet dès la première seconde — et quiconque atteint le formulaire d'inscription en premier
prend le contrôle du déploiement.

Ainsi, sous `NODE_ENV=production`, cette fenêtre est fermée. Une table d'utilisateurs vide
rejette l'inscription d'initialisation avec l'erreur `SETUP_REQUIRED`, un compte créé
via l'inscription ouverte reste un compte ordinaire, `GET /api/auth/config` n'indique
jamais `needsSetup`, et `POST /api/admin/bootstrap` refuse l'opération. Avec la version 0.17.3 et
les versions antérieures, la fenêtre restait ouverte en production également, veillez donc à mettre à jour votre version avant d'exposer un
nouveau déploiement.

`rebase dev` lit le même fichier `.env` et ignore délibérément ces deux variables, tout
en l'indiquant au démarrage : en local, la première inscription reste le moyen d'accès. Les valeurs
générées par `rebase init` concernent le démarrage en production. Effectuer le seeding des deux côtés
consommerait cette opportunité avant même que le développeur n'ait ouvert l'application, ce qui provoquait
la création d'un compte sans rôle dès la première étape du guide de démarrage rapide.

Il reste donc deux manières d'accéder, sans qu'aucune ne dépende d'une situation de compétition :

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Le runtime crée ce compte une seule fois, tant que la table des utilisateurs est vide, et n'effectue
plus aucune action lors des démarrages suivants. Vous pouvez également attribuer le rôle à un utilisateur existant
à l'aide de la clé de service (`service key`), si vous approvisionnez les comptes en dehors de ce flux.

Deux règles sont imposées par le runtime au démarrage, et leur non-respect produit un compte
inutilisable par quiconque :

- Le mot de passe doit comporter **au moins 12 caractères**, faute de quoi il est rejeté et aucun
  compte n'est créé.
- L'adresse doit être acceptée par `POST /api/auth/login` — le corps de la requête est analysé
  avec `z.string().email()`, de sorte qu'un domaine sans point (`admin@localhost`) est initialisé
  sans erreur mais renverra un code 400 à chaque tentative de connexion. Le démarrage rejette également une telle adresse.

Renseignez les deux variables ou aucune : un identifiant incomplet résulte d'une erreur de saisie, et le déploiement qui en résulte
— auto-inscription désactivée, aucun admin — nécessite une invite de commande `psql` pour être réparé. Le démarrage émet un avertissement
lorsque la table est vide en production et qu'aucun administrateur n'est spécifié.

Connectez-vous et modifiez le mot de passe. Celui-ci figure en texte brut là où vous avez configuré
votre environnement.

## Liste de contrôle de production

Avant de déployer en production, vérifiez les points suivants :

| Élément | Détails |
|---------|---------|
| **Premier admin** | Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` **avant le premier démarrage**, ainsi que `DISABLE_SELF_REGISTRATION=true`. En production, le premier compte inscrit n'est pas promu — voir [Votre premier administrateur](#votre-premier-administrateur). |
| **NODE_ENV** | `NODE_ENV=production`. C'est ce qui ferme la fenêtre d'initialisation, refuse le stockage de fichiers en local, impose `CORS_ORIGINS` et désactive la documentation OpenAPI. Un déploiement laissé avec la valeur par défaut s'exécute en mode développement. |
| **Schéma de base de données** | Le démarrage crée les tables de vos collections et leur RLS de manière additive. Exécutez `pnpm run db:push` (ou `pnpm run db:migrate`) pour tout ce qui n'est pas purement additif. |
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement sûre (≥ 32 caractères). Ne la réutilisez jamais d'un environnement à l'autre. |
| **DATABASE_URL** | Utilisez une instance Postgres managée (Neon, Supabase, RDS) avec TLS activé. |
| **CORS_ORIGINS** | Indispensable en permanence, pas seulement lorsque le frontend est sur un autre domaine. Le runtime refuse de démarrer en production si ni `CORS_ORIGINS` ni `FRONTEND_URL` ne sont définis, car une API qui tente de deviner ses origines autorisées finira par autoriser la mauvaise. |
| **Contrôle d'accès au stockage** | Un bucket configuré **refuse de démarrer en production** sans modèle de contrôle d'accès. Le stockage n'est pas soumis à la sécurité au niveau des lignes (RLS) et ses clés partagent un espace de noms plat unique ; par conséquent, autoriser tous les accès par défaut permettrait à tout utilisateur connecté de lister (`GET /storage/list?prefix=`) puis de lire, écraser ou supprimer les fichiers de tous les autres utilisateurs. Répondez à cette exigence à l'aide d'un hook `storageAuthorize` ou de `storagePolicies` (le squelette fournit un hook dans `config/storage.ts`), ou indiquez clairement votre intention avec `STORAGE_PUBLIC_READ` pour un véritable CDN public, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` pour une application mono-locataire où chaque compte a accès à l'ensemble des fichiers. |
| **Backend de stockage** | `STORAGE_TYPE=local` en production est **abandonné**, et les téléversements renvoient `501 STORAGE_NOT_CONFIGURED` — le système de fichiers du conteneur étant détruit au redémarrage suivant, un backend local provoquerait une perte silencieuse de données. Utilisez `s3` ou `gcs`, ou définissez `FORCE_LOCAL_STORAGE=true` si le chemin correspond réellement à un volume persistant. |
| **MFA_ENCRYPTION_KEY** | Définissez cette variable (32+ caractères aléatoires) si vous utilisez le TOTP. En son absence, les secrets stockés sont chiffrés avec `JWT_SECRET` — une rotation de cette clé déconnecterait alors tout le monde *et* rendrait indéchiffrables tous les authenticateurs enregistrés. |
| **HTTPS** | Terminez le TLS au niveau de votre reverse proxy (nginx, Cloudflare, équilibreur de charge). |
| **Les lectures publiques nécessitent toujours un appelant** | `access: "public"` élargit les *lignes* qu'un appelant peut voir, mais pas l'autorisation d'appel en elle-même : une requête anonyme vers `/api/data/*` renvoie 401 tant que `AUTH_REQUIRE` est actif. Définissez `AUTH_REQUIRE=false` pour un site public qui lit son propre backend, et laissez la RLS décider seule. Il s'agit d'une variable d'environnement : un fichier `.env` local la définissant ne sera **pas** transféré avec votre déploiement. |

## Modules natifs sur le runtime managé

Le runtime managé de Rebase Cloud exécute votre bundle dans une image partagée. Il ne possède
aucun compilateur et ne permet pas de charger un **module natif** — c'est-à-dire tout élément fournissant un binaire
précompilé `.node`. Le plus courant est de loin `sharp`, qui est également la dépendance
évidente pour tout ce qui sert des images.

`rebase cloud deploy` rejette cette configuration avant le téléversement plutôt qu'après :

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Trois approches sont possibles, dans l'ordre de pertinence habituel :

1. **Déplacer le traitement au moment de la compilation.** Redimensionnez et réencodez les images lors de l'étape
   de build et déployez le résultat. Aucun composant natif ne s'exécute ainsi sur le chemin de la requête.
2. **Utiliser un service dédié.** Un CDN d'images ou une API de transformation réalise la même tâche derrière
   une URL.
3. **Exécuter votre propre conteneur.** Un déploiement auto-hébergé (Docker, Kubernetes, ou n'importe lequel
   des [guides de plateformes](/docs/deployment/self-hosting)) utilise votre propre image, qui peut donc
   embarquer tout ce que vous souhaitez.

Les fonctions nécessitant simplement Node sans dépendre d'un binaire natif fonctionnent sans problème — le
déploiement les signale séparément (`1 of 3 function(s) depend on Node`) et les
exécute. [Runtime backend managé](/docs/deployment/managed-runtime/) détaille
les autres éléments gérés par le runtime managé : binaires, mémoire, timeouts,
système de fichiers, secrets, stockage et réseau sortant.

## Servir le frontend

En production, le backend peut servir le frontend sous forme de SPA statique :

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

De cette façon, vous n'avez besoin de déployer qu'un seul serveur qui prend en charge à la fois la SPA et l'API.

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

:::caution
Cloud Run et les autres plateformes serverless sont sans état (stateless). Utilisez le **stockage S3** au lieu du système de fichiers local pour le téléversement de fichiers, et définissez `--min-instances 1` si vous utilisez les fonctionnalités temps réel de Rebase (les connexions WebSocket sont interrompues lors de la réduction d'échelle des instances).
:::


## Modifier l'URL de base

Si vous souhaitez que l'administration s'exécute sur un sous-chemin (par exemple `/admin`), modifiez le champ
`path` de l'application dans `rebase.json`, ainsi que son paramètre `cms` :

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

`cms` désigne l'emplacement du CMS vers lequel Rebase Cloud crée des liens, et il doit se trouver à l'intérieur
du `path` de l'application. La configuration par défaut définit les deux sur `/` ; modifier uniquement `path` est donc
rejeté — le CMS se retrouverait alors à `/`, en dehors d'une application qui commence désormais à `/admin`.

Pour attribuer à l'administration son propre nom d'hôte plutôt qu'un sous-chemin, définissez `path` avec une
URL complète — `"path": "https://admin.example.com"` — et laissez `cms` sur `"/"`.
L'administration répondra alors uniquement sur ce nom d'hôte, et non sur l'adresse
principale du projet, ce qui la rend inaccessible tant que le DNS du nom d'hôte n'est pas validé. L'API reste
accessible sur `/api` sur ce nom d'hôte également. Consultez
[Une application sur son propre nom d'hôte](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname)
pour comprendre comment les requêtes sont mises en correspondance et comment un déploiement Rebase Cloud gère le
nom d'hôte.

`rebase build` transmet `path` à Vite sous forme de `base` (via `REBASE_APP_BASE`), Vite le
restitue sous `import.meta.env.BASE_URL`, et le fichier `main.tsx` de la structure l'injecte
déjà dans le routeur — ainsi, les assets, les routes et le serveur restent parfaitement alignés
sans avoir à renseigner le préfixe à trois endroits différents :

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

Conservez l'administration sur un **routeur de données** (data router) — `createBrowserRouter` avec
`<RouterProvider>`, comme le fait le template généré. Grâce à cela, un enregistrement contenant des modifications
non sauvegardées peut bloquer la navigation interne à l'application (un lien dans le panneau latéral, le bouton retour
du navigateur) et demander confirmation au préalable via `useBlocker`, que seul un routeur de données
propose.

L'administration fonctionne également sous un simple `<BrowserRouter>`. Dans ce cas, la protection contre les
modifications non enregistrées bascule sur la boîte de dialogue standard du navigateur pour quitter la page, ce qui couvre
le rechargement, la fermeture de l'onglet ou la saisie d'une URL ; la navigation au sein de l'application se poursuit
en revanche sans confirmation. À partir de la version 0.24, l'administration lève une erreur en dehors d'un routeur de données.

**Backend** — si vous déplacez également l'API, mettez à jour son chemin de base :

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montage sans le `basename` du routeur]
L'approche par `basename` ci-dessus est celle recommandée — react-router supprime le
préfixe de l'URL, ce qui permet à l'administration de fonctionner sans modification. Si vous intégrez
plutôt l'administration au sein d'une **route avec préfixe de chemin** d'une application plus vaste (ex. `<Route path="/admin/*">`)
sans `basename`, le chemin actif conserve son préfixe `/admin`. Vous devez alors en informer le CMS
afin que la résolution URL ⇄ collection prenne en compte ce préfixe — dans le cas contraire, les vues resteront bloquées
sur un indicateur de chargement sans récupérer de données :

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Définissez **soit** le `basename` du routeur, **soit** le `basePath` de `RebaseCMS` — mais pas les deux, sinon le
préfixe s'appliquera deux fois.
:::

### Application produit + Administration dans un seul déploiement

La raison la plus fréquente de déplacer l'administration vers `/admin` est de déployer votre **propre application produit**
à la racine du même environnement. Un seul point d'entrée Vite peut servir les deux, segmentés par URL,
de sorte que chaque application soit chargée à la demande (lazy-loaded) et que les utilisateurs du produit ne téléchargent jamais le bundle d'administration :

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

Un seul routeur pour les deux parties : il est préférable de conserver l'administration sur un routeur de données, ce qui
permet d'interrompre la navigation interne en cas de modifications non enregistrées, et rien n'impose à
l'application produit d'utiliser un système différent.

Le backend ne nécessite aucun ajustement pour ce modèle — l'API reste sur `/api` et la règle
catch-all de la SPA sert `index.html` pour `/` comme pour `/admin/*`.

## Étapes suivantes

- **[Aperçu du backend](/docs/backend)** — Configuration complète du backend
- **[Configuration du stockage](/docs/backend/storage)** — Configuration S3 pour la production
