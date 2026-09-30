---
sourceHash: 5db546fe110a140a
title: Applications et dépôts
sidebar_label: Apps & dépôts
description: Un projet est un backend accompagné des applications qui communiquent avec lui, chacune pouvant résider dans son propre dépôt.
---

## Projets et applications

Un **projet** est le backend : la base de données, l'authentification, le stockage, le temps réel et les fonctions. Une **application** est quelque chose qui communique avec lui.

| Type | Ce que c'est |
| --- | --- |
| `backend` | Les collections, hooks et fonctions qui définissent l'API. Exactement une par projet. |
| `static` | Un bundle client compilé — une SPA ou un site statique, servi sur son propre chemin d'accès, ou sur un nom d'hôte bien à lui. |

C'est la liste complète. Le panneau d'administration est une application `static` comme les autres : elle est compilée dans votre dépôt, en fonction de vos collections, c'est pourquoi les champs personnalisés et les vues personnalisées y fonctionnent dès le premier jour.

La propriété du processus serveur dépend du backend, et non d'un type d'application distinct :

| `runtime` | Ce que cela signifie |
| --- | --- |
| `managed` | L'image d'exécution de la plateforme exécute votre bundle. Vous fournissez les collections, fonctions, tâches cron et schémas. |
| `custom` | Vous fournissez le serveur : votre propre Dockerfile et point d'entrée. `rebase eject` configure cela. |

Cela est indépendant de l'*endroit* où il s'exécute. Les deux s'exécutent sur Rebase Cloud et les deux s'auto-hébergent — la destination réside dans `.rebase/cloud.json`, pas dans le manifeste.

L'élément important est ce qui *possède* la liste. Un dépôt ne déclare que les applications qu'il contient ; le projet possède l'ensemble des applications qui existent. Deux dépôts n'ont jamais besoin de se connaître — ils ont seulement besoin de connaître le projet. C'est ce qui fait d'un dépôt frontend distinct, ou d'une application mobile sans aucun lien de dépôt, une chose ordinaire plutôt qu'un cas particulier.

## `rebase.json`

Le manifeste déclare la topologie, et rien d'autre. Le schéma, les règles de sécurité, les hooks et les fonctions restent en TypeScript où un système de types peut les vérifier.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

Un seul processus sert l'ensemble : l'API sur `/api`, le site sur `/`, l'administration sur `/admin`. C'est l'approche pour l'auto-hébergement, et une excellente offre de base sur Rebase Cloud.

## Indiquer l'emplacement du CMS

`cms` est le chemin d'URL où une application monte `<RebaseCMS>`. Il est optionnel, c'est le seul champ ici qui décrit ce qui se trouve *à l'intérieur* d'une application plutôt que l'endroit où elle réside, et il existe parce que rien d'autre ne peut le déterminer.

Le CMS est un composant React dans votre propre frontend, son adresse est donc une route côté client. Ce n'est ni une route serveur, ni un fichier dans le build, et elle n'est pas distinguable de tout autre chemin non mappé sous une SPA — une requête vers `/admin` reçoit le même `index.html` qu'une requête vers `/anything-else`. Aucun déploiement, aucun serveur en cours d'exécution et aucun test d'exploration ne peut donc révéler où se trouve votre panneau d'administration. Si vous ne l'indiquez pas, rien ne peut le savoir.

Les outils qui le connaissent l'utilisent :

- **Rebase Cloud** place un lien *Ouvrir le CMS* dans l'en-tête du projet et affiche l'adresse sur la vue d'ensemble du projet — sur le nom d'hôte propre à l'application lorsqu'elle en a un. Sans `cms`, la console ne peut proposer que l'hôte du projet — qui n'atteint le CMS que si celui-ci se trouve par hasard à la racine.
- **`rebase dev`** affiche l'URL du CMS dans sa bannière de démarrage lorsqu'il ne s'agit pas simplement de la page d'accueil du frontend.
- **`rebase apps list`** l'affiche à côté de l'application qui la sert.

Trois configurations, toutes courantes :

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

La valeur est le chemin que vous saisiriez après le nom d'hôte, et non un chemin relatif à `path`, et elle doit se trouver dans l'application qui la déclare — le fallback SPA de cette application étant ce qui y répond. C'est toujours un chemin, même quand le `path` de l'application est une URL : le CMS se trouve alors à ce chemin sur le nom d'hôte de l'application, si bien que `"cms": "/"` ci-dessus désigne `https://admin.example.com/`. Un projet possède un seul CMS ; en déclarer un deuxième constitue une erreur plutôt qu'un tirage à pile ou face pour savoir vers lequel la console pointe.

`path` est une entrée au moment du **build** ainsi qu'au moment du service. Une application montée sur `/admin` doit être *compilée* pour `/admin`, sinon `index.html` se charge et tous les assets renvoient une erreur 404 — une page blanche sans aucune erreur apparente. `rebase build` transmet la valeur sous forme de `REBASE_APP_BASE`, que votre bundler lit comme son chemin de base :

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

et refuse de livrer un build qui l'a ignoré.

Un projet existant n'en a pas besoin. La CLI déduit la même structure à partir de l'organisation des répertoires, et `rebase apps init` l'écrit lorsque vous souhaitez la rendre explicite :

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Une application sur son propre nom d'hôte

`path` peut aussi être une URL `https://` complète, ce qui donne à l'application un nom d'hôte bien à elle :

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "web": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "https://admin.example.com",
      "cms": "/"
    }
  }
}
```

`https://admin.example.com` sert `admin`. Tous les autres noms d'hôte sur lesquels le projet répond — `example.com`, ou l'adresse du projet sur Rebase Cloud — servent `web`, et `admin` n'y est pas joignable du tout. Il s'agit toujours d'un seul processus et d'un seul déploiement ; le nom d'hôte décide seulement quelle application répond à une requête.

Deux règles en décident :

- Une application dotée d'un nom d'hôte ne répond que sur ce nom d'hôte. Une application sans nom d'hôte répond sur tous.
- Parmi les applications restantes, celle dont le chemin est le plus long l'emporte, comme toujours. À chemin égal, l'application qui nomme le nom d'hôte l'emporte sur celle qui ne le nomme pas.

Dans l'exemple, les deux applications sont sur `/`, donc sur `admin.example.com` la seconde règle choisit `admin`. Déclarez plutôt l'administration sur `"https://admin.example.com/cms"` et elle ne répond que sous `/cms` sur ce nom d'hôte : `admin.example.com/pricing` va à `web`. Un nom d'hôte restreint l'endroit où une application répond ; il ne lui confie pas tout ce qui se trouve sur ce nom d'hôte. Deux applications ne peuvent pas partager à la fois un nom d'hôte et un chemin.

Le backend n'est pas une application, et un nom d'hôte ne le déplace pas. `/api`, `/health` et les autres chemins réservés par le backend reçoivent une réponse avant qu'aucune application ne soit consultée, sur tous les noms d'hôte ; `https://admin.example.com/api` est donc la même API que `https://example.com/api`. Une application qui appelle sa propre origine — le `VITE_API_URL` vide du scaffold — n'a besoin ni d'une URL d'API à elle ni d'aucun réglage CORS. Pour la même raison, ces chemins sont refusés après un nom d'hôte tout comme seuls : `https://admin.example.com/api` n'est pas plus valide que `/api`.

Tout le reste de ce qui concerne `path` s'applique à la partie située après le nom d'hôte. L'application est toujours compilée pour elle : `https://admin.example.com` est compilé avec `REBASE_APP_BASE` à `/`, `https://admin.example.com/cms` avec `/cms`, et un bundler qui l'ignore donne toujours une page blanche. `cms` est un chemin sur le nom d'hôte de l'application, à l'intérieur de cette partie chemin. L'URL doit commencer par `https://` et contenir un nom d'hôte et un chemin, rien d'autre — ni port, ni query, ni fragment. Un `admin.example.com` seul est refusé, avec l'URL qu'il aurait dû être.

En local, rien n'est routé par nom d'hôte. `rebase dev` lance l'application de `frontend/` à la racine d'un port de localhost, comme toujours, et pour une application dotée d'un nom d'hôte sa bannière affiche aussi l'adresse `https://` qu'elle aura une fois déployée.

En auto-hébergement, le processus fait le même choix à partir de l'en-tête `Host` de chaque requête. Faire pointer le nom d'hôte vers le serveur et lui fournir un certificat vous revient, comme pour le nom d'hôte principal du projet, et un reverse proxy placé devant doit transmettre l'en-tête `Host` d'origine — Caddy le fait par défaut, nginx a besoin de `proxy_set_header Host $host;`. `X-Forwarded-Host` n'est pas lu, parce que n'importe quel client peut en envoyer un.

### Sur Rebase Cloud

`rebase cloud deploy` enregistre le nom d'hôte sur le projet — ce que fait `rebase cloud domains add` — il n'y a donc pas d'étape séparée à oublier. La suite dépend du DNS :

- **Les enregistrements existent déjà.** Le déploiement vérifie le nom d'hôte, qui est en ligne à la fin du déploiement.
- **Ils n'existent pas.** Le déploiement se poursuit et affiche les deux enregistrements à créer : un enregistrement TXT qui prouve que le nom vous appartient, et un CNAME qui le fait pointer vers le projet (un enregistrement A si le nom d'hôte est l'apex du domaine).

Une fois les enregistrements publiés :

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` affiche de nouveau les enregistrements si vous les perdez. Quand la vérification réussit, la plateforme émet le certificat HTTPS du nom d'hôte ; il n'y a rien à téléverser. D'ici là, `admin` ne répond nulle part, puisque le seul nom d'hôte sur lequel elle répond n'atteint pas encore le projet — le reste du projet est en ligne dans tous les cas.

La console suit l'application sur son nom d'hôte : le lien *Ouvrir le CMS* et l'adresse du CMS sur la vue d'ensemble du projet sont `https://admin.example.com/`, et non l'hôte du projet.

Un nom d'hôte déjà détenu par un autre projet fait échouer le déploiement avant que quoi que ce soit ne soit mis en production, tout comme un nom d'hôte situé sous le domaine propre de la plateforme. Retirer l'application de `rebase.json` laisse le nom d'hôte enregistré sur le projet ; supprimez-le avec `rebase cloud domains remove admin.example.com`.

### Un nom d'hôte appartient à une application, pas à une route

Un nom d'hôte est donné à une application entière. Il ne peut pas pointer vers une route à l'intérieur de l'une d'elles. Quand le CMS est une route d'une seule SPA — `web` sur `/` avec `"cms": "/admin"` — il se trouve sur `/admin`, sur chaque nom d'hôte auquel le projet répond. Donner `https://admin.example.com` à cette application y déplacerait la SPA entière, avec le CMS toujours sur `/admin` à l'intérieur. Pour donner au CMS un nom d'hôte bien à lui, faites-en une application à part entière, avec son propre build, comme dans l'exemple ci-dessus.

## Compiler et déployer des applications

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Le backend est compilé en premier, car le build d'une application cliente peut consommer un SDK généré à partir de ses collections.

## Dépôts multiples

Le monorepo reste la valeur par défaut : un seul dépôt contenant un backend et un panneau d'administration est la solution la plus simple qui fonctionne, et `rebase init` en génère la structure. La séparation en plusieurs dépôts est une étape ultérieure, pas une obligation.

Dans un dépôt frontend distinct, vous avez besoin de deux choses — un manifeste déclarant ce que ce dépôt apporte, et un lien vers le projet :

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

Le lien est enregistré dans `.rebase/cloud.json` et n'est **pas commité** — il est propre à chaque copie locale, comme un remote git. Le manifeste est commité ; le lien ne l'est pas.

## Clients typés sans les collections

C'est le mécanisme qui permet au multi-repo de fonctionner. Un dépôt ne contenant aucune collection génère son SDK typé à partir du projet lui-même :

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI récupère `/api/meta/contract`, reconstruit les définitions des collections — y compris les cibles de relations, dont le générateur de types a besoin pour déterminer si une clé étrangère est une chaîne ou un nombre — et produit exactement le même résultat qu'elle aurait généré à partir du code source local.

Le point de terminaison du contrat est réservé aux administrateurs. Les définitions de collections décrivent chaque table, colonne et relation du projet, y compris celles qu'aucune règle de sécurité n'exposerait jamais ; il s'agit d'une cartographie de la base de données, pas d'une documentation d'API publique.

## Détecter les dérives

Séparer les dépôts a un inconvénient qui mérite d'être souligné : un changement de schéma et le frontend qui l'utilise ne figurent plus dans le même commit. Le backend peut déployer une modification qui bloque un client compilé selon l'ancienne structure.

Chaque SDK généré enregistre le schéma dont il est issu :

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Et chaque projet publie son schéma actuel, sans authentification, car un identifiant de version ne révèle rien du schéma qu'il représente :

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Comparer les deux dans la CI transforme une incompatibilité silencieuse en un échec de vérification. L'identifiant change lorsque les types générés sont susceptibles de changer — une nouvelle propriété, une relation modifiée — et délibérément *pas* lorsqu'un hook, une règle de sécurité ou une icône change, évitant ainsi les fausses alertes.

## Configuration client

```bash
rebase apps config web
```

Affiche ce dont un client a besoin pour joindre le projet. Il n'affiche jamais de secret : l'URL de l'API et l'identité publiable d'une application sont destinées à être intégrées dans un bundle client, et tout ce qui n'y est pas sécurisé n'a pas sa place dans une sortie qui finira dans un `.env` commité.

## Voir aussi

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — ce que `rebase build` produit et ce qui le démarre
- [Split Processes](/docs/deployment/split-processes/) — exécuter un bundle sous forme de plusieurs processus
- [CLI Commands](/docs/cli/) — `rebase apps` et le reste
