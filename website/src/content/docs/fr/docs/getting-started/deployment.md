---
sourceHash: 145ba18b6f108fbd
title: Déploiement
sidebar_label: Déploiement
description: Déployez votre projet Rebase en production à l'aide de Docker, de plateformes cloud ou d'installations manuelles.
---

## Ce que dessert un déploiement

Un projet Rebase se déploie sous la forme d'**un seul serveur** (sur Rebase Cloud : `https://<project>.rebase.website`). Ce serveur gère :

- **`/api/*`** — l'API de données, l'authentification, le temps réel et le stockage
- **tout le reste** — votre `frontend/` compilé en tant que SPA statique

Il n'y a pas de service d'administration distinct : le panneau d'administration fait partie d'un frontend, donc l'endroit où il apparaît dépend de la nature de votre frontend, et du fait que vous lui attribuiez ou non son propre nom d'hôte.

| Type de projet | L'URL racine affiche | Le panneau d'administration est sur |
|----------------|----------------------|-------------------------------------|
| Scaffold par défaut (`rebase init`) | Le panneau d'administration | `/` — le frontend **est** l'admin |
| Frontend produit personnalisé | Votre application | Là où vous le montez, généralement `/admin` — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| L'admin en tant qu'application sur son propre nom d'hôte | Votre application | `https://admin.example.com/`, servi par le même serveur — voir [Modifier l'URL de base](#modifier-lurl-de-base) |
| Projet backend uniquement | Rien (API uniquement) | Non déployé |

:::note[Première visite]
Un nouveau déploiement en **production** ne propose pas d'écran d'initialisation (bootstrap), et sa première inscription est un compte ordinaire. Désignez plutôt l'administrateur avant le premier démarrage — voir [Votre premier admin](#votre-premier-admin).
:::

## Docker Compose (recommandé)

Le projet généré inclut déjà un fichier `docker-compose.yml` fonctionnel — **ce
fichier est celui à utiliser pour un projet scaffoldé**, tel quel plutôt
qu'écrit à la main ou copié d'ailleurs. `rebase init` y a renseigné ses secrets,
son premier compte administrateur et sa version de runtime épinglée, et il est
démarré par la validation d'acceptation du framework à chaque push. Il exécute
**deux** conteneurs, Postgres et le runtime Rebase publié avec votre bundle
compilé monté à l'intérieur. Il n'y a aucune image d'application à construire.

[L'auto-hébergement](/docs/deployment/self-hosting) couvre le même déploiement
sans scaffold derrière, en utilisant
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
depuis le dépôt Rebase — ainsi que les deux éléments que ce fichier omet
délibérément : un pooler de connexions, et l'exécution des fonctions et du worker
de tâches dans leurs propres processus.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

`rebase build` d'abord, toujours : le service `api` monte `./dist-bundle`, et
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

Voir [Votre premier admin](#votre-premier-admin) ci-dessous pour les trois lignes `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

Le bundle est monté en lecture seule. `rebase build` installe les dépendances
déclarées du projet dans `dist-bundle` sauf si vous passez `--no-vendor`, auquel
cas le runtime les installe à chaque démarrage et le montage doit être accessible
en écriture — supprimez le `:ro`. Voir [Auto-hébergement](/docs/deployment/self-hosting/#dependencies).

`rebase init` écrit tout cela dans `.env` pour vous, y compris un mot de passe
administrateur généré. Chacune est déclarée avec `${VAR:?…}`, de sorte qu'une
variable manquante arrête la stack avec un message indiquant son nom plutôt que
de démarrer quelque chose de semi-configuré — et Compose interpole l'ensemble du
fichier avant de sélectionner les services, donc une variable manquante arrête
également `docker compose up -d db`.

Remplacez l'e-mail d'administration par le vôtre, connectez-vous et modifiez le
mot de passe. Voir [Votre premier admin](#votre-premier-admin).

### Le schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le runtime crée les tables manquantes au démarrage, **y compris celles déclarées par `backend/schema`** —
`REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur
l'ensemble du schéma et applique la sécurité au niveau des lignes (RLS) avec lui.
Un premier `docker compose up` sur une base de données vide démarre en servant
directement vos tables.

Ce que le démarrage ne fait jamais, c'est modifier quelque chose qui existe déjà :
il ne modifie pas le type d'une colonne, ne supprime rien et n'édite pas les
libellés d'un enum existant, car le redémarrage d'un conteneur ne doit pas
remodeler un schéma comme effet secondaire d'un déploiement. Ces opérations
passent par la CLI, depuis un checkout du projet ou un job CI pointant vers la
base de données de production :

```bash
pnpm run db:push
```

Exécutez-le pour tout changement qui n'est pas purement additif — une colonne
renommée, un type restreint, un champ supprimé.

Pour un **workflow d'équipe avec gestion de versions**, committez les fichiers
de migration avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` en tant
qu'étape de release. Dans les deux cas, cela s'exécute depuis un checkout du
projet, et non à l'intérieur du conteneur en cours d'exécution — l'image du
runtime est fournie sans la CLI.

## Votre premier admin

**Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` avant le premier démarrage.**
Tous les guides de plateformes de ce site pointent ici, car c'est la seule étape
pour laquelle il n'existe aucune récupération depuis l'extérieur.

Une base de données vierge n'a pas d'utilisateurs, et en dehors de la production,
la politique d'inscription accepte la première création de compte et la promeut
administrateur. C'est nécessaire : l'initialisation d'un admin nécessite un
appelant déjà connecté, donc une base de données vide sans une telle règle serait
une impasse. Sur un ordinateur portable, la personne au clavier est l'opérateur
et cela convient parfaitement.

C'est tout le contraire sur un hôte avec un nom public. Les artefacts déployés
activent le DNS et TLS avant même que l'opérateur n'ait tapé quoi que ce soit, de
sorte que la fenêtre est ouverte sur Internet dès la première seconde — et
quiconque accède en premier au formulaire d'inscription prend le contrôle du
déploiement.

Ainsi, sous `NODE_ENV=production`, cette fenêtre est fermée. Une table
d'utilisateurs vide refuse l'inscription bootstrap avec `SETUP_REQUIRED`, un
compte créé via une inscription ouverte est un compte ordinaire,
`GET /api/auth/config` n'annonce jamais `needsSetup`, et `POST /api/admin/bootstrap`
refuse la requête.

`rebase dev` lit le même `.env` et ignore délibérément les deux variables, et
l'indique au démarrage : localement, la première inscription reste la porte
d'entrée. Les valeurs écrites par `rebase init` sont destinées au démarrage en
production. Effectuer un seeding des deux côtés consommerait la fenêtre avant que
le développeur n'ait ouvert l'application, ce qui conduisait la première étape
du guide de démarrage rapide à produire un compte sans rôle.

Cela laisse deux moyens d'accès, aucun des deux n'étant une course :

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Le runtime crée ce compte une seule fois, tant que la table des utilisateurs est
vide, et ne fait rien à chaque démarrage ultérieur. Vous pouvez aussi attribuer
le rôle à un utilisateur existant avec la clé de service (service key), si vous
provisionnez les comptes hors bande.

Deux règles appliquées par le runtime au démarrage, dont le non-respect produit un
compte que personne ne peut utiliser :

- Le mot de passe doit comporter **au moins 12 caractères**, sinon il est refusé
  et aucun compte n'est créé.
- L'adresse doit être acceptée par `POST /api/auth/login` — son corps de requête
  est validé avec `z.string().email()`, donc un domaine sans point (`admin@localhost`)
  s'initialise correctement mais renvoie ensuite une erreur 400 à chaque connexion.
  Le démarrage refuse également cette adresse.

Définissez les deux ou aucun des deux : un identifiant incomplet est une
coquille, et le déploiement qui en résulte — auto-inscription désactivée, aucun
admin — nécessite une invite de commande `psql` pour être récupéré. Le démarrage
émet un avertissement lorsque la table est vide en production et qu'aucun admin
n'est désigné.

Connectez-vous et modifiez le mot de passe. Il est stocké en texte clair là où
vous avez configuré votre environnement.

## Checklist de production

Avant de déployer en production, assurez-vous des points suivants :

| Élément | Détails |
|---------|---------|
| **Premier admin** | Définissez `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` **avant le premier démarrage**, ainsi que `DISABLE_SELF_REGISTRATION=true`. En production, le premier compte à s'inscrire n'est pas promu — voir [Votre premier admin](#votre-premier-admin). |
| **NODE_ENV** | `NODE_ENV=production`. C'est ce qui ferme la fenêtre de bootstrap, refuse le stockage de fichiers local, requiert `CORS_ORIGINS` et désactive la documentation OpenAPI. Un déploiement laissé avec la valeur par défaut s'exécute en mode développement. |
| **Schéma de base de données** | Le démarrage crée de manière additive vos tables déclarées et leur RLS. Exécutez `pnpm run db:push` (ou `pnpm run db:migrate`) pour tout ce qui n'est pas purement additif. |
| **JWT_SECRET** | Utilisez une chaîne aléatoire cryptographiquement forte (≥ 32 caractères). Ne la réutilisez jamais d'un environnement à l'autre. |
| **DATABASE_URL** | Utilisez une instance Postgres gérée (Neon, Supabase, RDS) avec TLS activé |
| **CORS_ORIGINS** | Toujours, et pas seulement lorsque le frontend est sur un autre domaine. Le runtime refuse de démarrer en production s'il n'y a ni `CORS_ORIGINS` ni `FRONTEND_URL`, car une API qui devine ses origines autorisées finira par autoriser la mauvaise. |
| **Contrôle d'accès au stockage** | Un bucket configuré **refuse de démarrer en production** sans modèle de contrôle d'accès. Le stockage n'est pas soumis à la sécurité au niveau des lignes (RLS) et ses clés partagent un espace de noms plat, de sorte qu'un comportement par défaut autorisant tout permettrait à n'importe quel utilisateur connecté de lister (`GET /storage/list?prefix=`), puis de lire, écraser ou supprimer les fichiers de tous les autres utilisateurs. Répondez à cette exigence avec un hook `storageAuthorize` ou des `storagePolicies` (le scaffold fournit un hook dans `backend/storage.ts`), ou indiquez votre intention avec `STORAGE_PUBLIC_READ` pour un véritable CDN public, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` pour une application mono-tenant où chaque compte a accès à l'ensemble des fichiers en toute confiance. |
| **Backend de stockage** | `STORAGE_TYPE=local` en production est **ignoré**, et les téléversements renvoient `501 STORAGE_NOT_CONFIGURED` — le système de fichiers du conteneur étant détruit au prochain redémarrage, un backend local entraînerait une perte de données silencieuse. Utilisez `s3` ou `gcs`, ou définissez `FORCE_LOCAL_STORAGE=true` si le chemin correspond réellement à un volume persistant. |
| **MFA_ENCRYPTION_KEY** | Définissez-la (32+ caractères aléatoires) si vous utilisez TOTP. Si elle n'est pas définie, les secrets stockés sont chiffrés avec `JWT_SECRET` — une rotation de cette clé déconnecterait donc tout le monde *et* rendrait indéchiffrable chaque application d'authentification enregistrée. |
| **HTTPS** | Terminez TLS au niveau de votre reverse proxy (nginx, Cloudflare, équilibreur de charge) |
| **Les lectures publiques nécessitent toujours un appelant** | `access: "public"` élargit les *lignes* qu'un appelant peut voir, mais pas qui a le droit d'appeler : une requête anonyme vers `/api/data/*` renvoie 401 tant que `AUTH_REQUIRE` est actif. Définissez `AUTH_REQUIRE=false` pour un site public qui lit son propre backend, et laissez la RLS décider seule. Il s'agit d'une variable d'environnement, donc un fichier `.env` local qui la définit **ne voyagera pas** avec votre déploiement. |

## Modules natifs sur le runtime managé

Le runtime managé de Rebase Cloud exécute votre bundle au sein d'une image
partagée. Il n'a pas de compilateur et aucun moyen de charger un **module
natif** — tout élément livrant un binaire précompilé `.node`. Le plus courant est
de loin `sharp`, qui est également la dépendance évidente pour tout ce qui sert
des images.

`rebase cloud deploy` refuse cela avant le téléversement plutôt qu'après :

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Trois solutions possibles, dans l'ordre où elles sont généralement les plus pertinentes :

1. **Déplacer le travail au moment du build.** Redimensionnez et réencodez les
   images lors de votre étape de build, puis déployez les résultats. Rien de
   natif ne s'exécute lors du traitement des requêtes.
2. **Utiliser un service.** Un CDN d'images ou une API de transformation
   effectue le même travail derrière une URL.
3. **Exécuter votre propre conteneur.** Un déploiement auto-hébergé (Docker,
   Kubernetes, ou n'importe lequel des [guides de plateformes](/docs/deployment/self-hosting))
   utilise votre propre image, elle peut donc embarquer ce que bon vous semble.

Les fonctions qui ont simplement besoin de Node plutôt que d'un binaire natif
fonctionnent parfaitement — le déploiement les signale séparément
(`1 of 3 function(s) depend on Node`) et les exécute. Le [Runtime backend managé](/docs/deployment/managed-runtime/)
détaille le reste de ce que le runtime managé permet : binaires, mémoire,
timeouts, système de fichiers, secrets, stockage et réseau sortant.

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

De cette manière, vous n'avez besoin de déployer qu'un seul serveur qui gère à la
fois la SPA et l'API.

## Guides de déploiement par plateforme

Guides détaillés étape par étape pour chaque plateforme :

| Plateforme | Type | Guide |
|------------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Déployer sur AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Déployer sur GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Déployer sur Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Déployer sur Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Conteneurs Serverless | [Déployer sur Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (détection automatique de Dockerfile) | [Déployer sur Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de conteneurs | [Déployer sur Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL dans un seul pod, sans Docker | [Déployer sur InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + PostgreSQL managé, ou un VPS | [Déployer sur Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run et les autres plateformes serverless sont sans état (stateless). Utilisez un **stockage S3** au lieu du système de fichiers local pour les téléversements de fichiers, et définissez `--min-instances 1` si vous utilisez les fonctionnalités temps réel de Rebase (les connexions WebSocket sont interrompues lorsque les instances sont réduites à l'échelle).
:::


## Modifier l'URL de base

Si vous souhaitez que l'admin s'exécute sur un sous-chemin (ex. `/admin`),
modifiez le `path` de l'application dans `rebase.json`, ainsi que son `cms` :

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

`cms` correspond à l'emplacement du CMS, vers lequel Rebase Cloud crée des liens,
et il doit se trouver à l'intérieur du `path` de l'application. Le scaffold définit
les deux sur `/`, donc déplacer `path` seul est refusé — le CMS se trouverait à
`/`, en dehors d'une application qui commence désormais à `/admin`.

Pour attribuer à l'admin son propre nom d'hôte plutôt qu'un sous-chemin,
définissez `path` comme une URL complète — `"path": "https://admin.example.com"` —
et laissez `cms` à `"/"`. L'admin ne répondra alors que sur ce nom d'hôte, et non
sur l'adresse propre du projet ; il sera donc inaccessible tant que le DNS du nom
d'hôte n'est pas vérifié. L'API reste également accessible à `/api` sur ce nom
d'hôte. Voir [Une application sur son propre nom d'hôte](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname)
pour comprendre comment les requêtes sont associées et ce qu'un déploiement
Rebase Cloud fait du nom d'hôte.

`rebase build` transmet `path` à Vite sous forme de `base` (via `REBASE_APP_BASE`),
Vite le restitue sous `import.meta.env.BASE_URL`, et le `main.tsx` du scaffold le
fournit déjà au routeur — ainsi, les assets, les routes et le serveur sont tous
synchronisés sans avoir à écrire le préfixe trois fois :

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

Conservez l'admin sur un **routeur de données** (data router) — `createBrowserRouter`
avec `<RouterProvider>`, comme le fait le scaffold. Avec celui-ci, un enregistrement
contenant des modifications non enregistrées interrompt également la navigation
interne à l'application (un lien dans le tiroir latéral, le bouton précédent du
navigateur) et demande confirmation au préalable via `useBlocker`, ce que seul
un routeur de données fournit.

L'admin fonctionne également sous un simple `<BrowserRouter>`. Dans ce cas, la
protection des modifications non enregistrées bascule sur l'invite native de
fermeture de page du navigateur, qui couvre le rechargement, la fermeture de
l'onglet ou la saisie d'une URL ; mais la navigation à l'intérieur de l'application
s'exécute sans confirmation.

**Backend** — si vous déplacez également l'API, mettez à jour son chemin de base :

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montage sans basename de routeur]
L'approche avec `basename` ci-dessus est celle recommandée — react-router retire
le préfixe de l'emplacement (location), permettant à l'admin de fonctionner sans
modification. Si vous intégrez plutôt l'admin au sein d'une **route avec
préfixe de chemin** d'une application plus vaste (par ex. `<Route path="/admin/*">`)
sans `basename`, le chemin actuel conserve son préfixe `/admin`. Indiquez-le au
CMS afin que la résolution URL⇄table prenne en compte le préfixe — sinon, les
vues restent bloquées sur un indicateur de chargement sans récupérer de données :

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Définissez **soit** le router `basename` **soit** `RebaseCMS basePath` — mais pas les
deux, sinon le préfixe sera appliqué deux fois.
:::

### Application produit + Admin dans un seul déploiement

La raison courante de déplacer l'admin vers `/admin` est de déployer votre
**propre application produit** à la racine du même déploiement. Un point d'entrée
Vite unique peut servir les deux, répartis par URL, de sorte que chaque
application soit chargée à la demande (lazy-loaded) et que les visiteurs du
produit ne téléchargent jamais le bundle d'administration :

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

Un seul routeur pour les deux parties : l'admin fonctionne mieux sur un routeur
de données, ce qui permet aux modifications non enregistrées d'interrompre la
navigation dans l'application, et il n'y a aucune raison pour que l'application
produit en utilise un différent.

Le backend ne nécessite aucune modification pour ce cas de figure — l'API reste
à `/api` et le catch-all de la SPA sert `index.html` pour `/` ainsi que pour
`/admin/*`.

## Prochaines étapes

- **[Vue d'ensemble du backend](/docs/backend)** — Configuration complète du backend
- **[Configuration du stockage](/docs/backend/storage)** — Configuration de S3 pour la production
