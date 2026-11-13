---
sourceHash: 4ad669042dfd8fc9
title: Applications et dépôts
sidebar_label: Apps & dépôts
description: Un projet est un backend accompagné des applications qui communiquent avec lui, chacune pouvant résider dans son propre dépôt.
---

## Projets et applications

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un **projet** correspond au backend : la base de données, l'authentification, le stockage, le temps réel et les fonctions. Une **app** est un élément qui communique avec lui.

| Type | Ce que c'est |
| --- | --- |
| `backend` | Les tables, hooks et fonctions qui définissent l'API. Exactement un par projet. |
| `static` | Un bundle client compilé — une SPA ou un site statique, servi sur son propre chemin, ou sur son propre nom d'hôte. |

C'est toute la liste. Le panneau d'administration est une app `static` comme les autres : il est compilé dans votre dépôt, avec vos personnalisations issues de `frontend/src/cms`, c'est pourquoi les champs personnalisés et les vues personnalisées y fonctionnent dès le premier jour.

L'entité qui gère le processus serveur est une propriété du backend, et non un type d'app distinct :

| `runtime` | Ce que cela signifie |
| --- | --- |
| `managed` | L'image de runtime de la plateforme exécute votre bundle. Vous fournissez les tables, les fonctions, les tâches cron et le schéma. |
| `custom` | Vous fournissez le serveur : votre propre Dockerfile et point d'entrée. `rebase eject` configure cela. |

Cela est indépendant de l'endroit *où* il s'exécute. Les deux fonctionnent sur Rebase Cloud et tous deux peuvent être auto-hébergés — la destination se trouve dans `.rebase/cloud.json`, et non dans le manifeste.

La partie importante est ce qui *possède* la liste. Un dépôt déclare uniquement les apps qu'il contient ; le projet possède l'ensemble des apps qui existent. Deux dépôts n'ont jamais besoin de se connaître l'un l'autre — ils ont seulement besoin de connaître le projet. C'est ce qui fait d'un dépôt frontend séparé, ou d'une application mobile sans aucun lien de dépôt, une situation ordinaire plutôt qu'un cas particulier.

## `rebase.json`

Le manifeste déclare la topologie, et rien d'autre. Le schéma, les règles de sécurité, les hooks et les fonctions restent en TypeScript, où un système de types peut les vérifier.

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

Un seul processus dessert l'ensemble : l'API sur `/api`, le site sur `/`, l'administration sur `/admin`. C'est le principe de l'auto-hébergement, et une excellente offre de petite taille sur Rebase Cloud.

## Indiquer l'emplacement du CMS

`cms` est le chemin d'URL où une app monte `<RebaseCMS>`. Il est facultatif, c'est le seul champ ici qui décrit ce qui se trouve *à l'intérieur* d'une app plutôt que l'endroit où elle réside, et il existe car rien d'autre ne peut le déduire.

Le CMS est un composant React dans votre propre frontend, son adresse est donc une route côté client. Ce n'est pas une route serveur, ni un fichier dans le build, et elle n'est pas distinguable de tout autre chemin non mappé sous une SPA — une requête vers `/admin` reçoit le même `index.html` qu'une requête vers `/anything-else`. Ainsi, aucun déploiement, aucun serveur en cours d'exécution et aucune analyse exploratoire ne peut déterminer où se trouve votre panneau d'administration. Si vous ne l'indiquez pas explicitement, rien ne peut le savoir.

Ce qui en a connaissance en fait usage :

- **Rebase Cloud** place un lien *Open CMS* dans l'en-tête du projet et liste l'adresse sur la vue d'ensemble du projet — sur le propre nom d'hôte de l'app lorsqu'elle en a un. Sans `cms`, la console ne peut proposer que l'hôte du projet — qui n'atteint le CMS que si celui-ci se trouve par hasard à sa racine.
- **`rebase dev`** affiche l'URL du CMS dans sa bannière de démarrage lorsqu'il ne s'agit pas simplement de la page d'accueil du frontend.
- **`rebase apps list`** l'affiche à côté de l'app qui le dessert.

Trois configurations possibles, toutes courantes.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

La valeur correspond au chemin que vous saisiriez après le nom d'hôte, et non à un chemin relatif à `path`, et elle doit se trouver à l'intérieur de l'app qui la déclare — le fallback SPA de cette app étant ce qui répond à cet endroit. C'est toujours un chemin, même lorsque le `path` de l'app est une URL : le CMS se trouve alors à ce chemin sur le nom d'hôte de l'app, donc `"cms": "/"` ci-dessus signifie `https://admin.example.com/`. Un projet possède un seul CMS ; en déclarer un second constitue une erreur plutôt qu'un tirage au sort pour déterminer celui vers lequel la console pointe.

`path` est une entrée au moment du **build** tout comme au moment de la diffusion. Une app montée sur `/admin` doit être *compilée* pour `/admin`, sinon `index.html` se charge et chaque ressource renvoie une erreur 404 — une page blanche sans aucune erreur visible nulle part. `rebase build` transmet la valeur sous la forme `REBASE_APP_BASE`, que votre bundler lit comme son chemin de base :

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

et refuse de livrer un build qui l'a ignoré.

Un projet existant n'en a pas nécessairement besoin. La CLI déduit la même disposition à partir de la structure des répertoires, et `rebase apps init` l'écrit lorsque vous souhaitez la rendre explicite :

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

L'inférence ne peut pas deviner deux choses que le `rebase.json` d'un projet généré déclare. Elle nomme l'app statique `web`, là où la génération initiale la nomme `admin`, et elle ne peut pas connaître la route `cms` de l'app. Le nom ne change pas : Rebase Cloud a enregistré `web` pour chaque projet déployé sans `rebase.json`.
`rebase apps init --force` conserve les noms, `path` et `cms` des apps déclarées par le fichier qu'il remplace, et marque comme supprimée toute app qu'il ne trouve plus.

## Une app sur son propre nom d'hôte

`path` peut également être une URL `https://` complète, ce qui attribue à l'app son propre nom d'hôte :

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

`https://admin.example.com` dessert `admin`. Tous les autres noms d'hôte sur lesquels le projet répond — `example.com`, ou la propre adresse du projet sur Rebase Cloud — desservent `web`, et `admin` n'y est pas accessible du tout. Il s'agit toujours d'un seul processus et d'un seul déploiement ; le nom d'hôte décide uniquement de l'app qui répond à une requête.

Deux règles tranchent :

- Une app disposant d'un nom d'hôte ne répond que sur ce nom d'hôte. Une app sans nom d'hôte répond sur tous les noms d'hôte.
- Parmi les apps restantes, celle dont le chemin est le plus long l'emporte, comme cela a toujours été le cas. À longueur de chemin égale, l'app qui spécifie le nom d'hôte l'emporte sur celle qui ne le fait pas.

Dans l'exemple, les deux apps sont sur `/`, donc sur `admin.example.com`, la seconde règle choisit `admin`. Si vous déclarez plutôt l'administration sur `"https://admin.example.com/cms"`, elle ne répondra que sous `/cms` sur ce nom d'hôte : `admin.example.com/pricing` sera dirigé vers `web`. Un nom d'hôte restreint l'endroit où une app répond ; il ne confie pas l'intégralité du trafic de ce nom d'hôte à l'app. Deux apps ne peuvent pas partager à la fois le même nom d'hôte et le même chemin.

Le backend n'est pas une app, et un nom d'hôte ne le déplace pas. Les routes `/api`, `/health` et les autres chemins réservés par le backend sont traités avant que la moindre app ne soit consultée, sur tous les noms d'hôte ; ainsi, `https://admin.example.com/api` est la même API que `https://example.com/api`. Une app qui appelle sa propre origine — le `VITE_API_URL` vide du squelette initial — n'a besoin d'aucune URL d'API spécifique ni d'aucune configuration CORS. Pour la même raison, ces chemins sont refusés après un nom d'hôte tout comme ils le sont seuls : `https://admin.example.com/api` n'est pas plus valide que `/api`.

Tout le reste concernant `path` s'applique à la partie située après le nom d'hôte. L'app est toujours compilée en conséquence : `https://admin.example.com` est compilée avec `REBASE_APP_BASE` défini sur `/`, `https://admin.example.com/cms` avec `/cms/`, et un bundler qui l'ignore produira toujours une page blanche. `cms` est un chemin sur le nom d'hôte de l'app, à l'intérieur de cette partie de chemin. L'URL doit commencer par `https://` et comporter un nom d'hôte et un chemin, et rien d'autre — aucun port, paramètre de requête ou fragment. Un simple `admin.example.com` sera refusé, en indiquant l'URL qu'il aurait dû être.

Sous `rebase dev`, rien n'est routé par nom d'hôte. La commande exécute l'app située dans `frontend/` à la racine d'un port localhost, comme cela a toujours été le cas, et pour une app dotée d'un nom d'hôte, sa bannière affiche également l'adresse `https://` qu'elle aura une fois déployée.

`rebase start` est différent, car il exécute le bundle compilé via le même runtime qu'un déploiement — routage par nom d'hôte inclus. Une app avec un nom d'hôte ne répond qu'aux requêtes dont l'en-tête `Host` correspond à ce nom d'hôte, ainsi `http://localhost:3001/` affiche l'app qui n'en a pas, et un bundle dont la seule app spécifie un nom d'hôte y renverra une erreur 404. Pour l'atteindre localement, envoyez vous-même l'en-tête :

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

ou faites pointer le nom d'hôte vers `127.0.0.1` dans `/etc/hosts` et ouvrez `http://admin.example.com:3001/`. Il n'existe délibérément aucun paramètre d'URL ni aucun en-tête permettant de court-circuiter le routage : une option qui fonctionnerait localement fonctionnerait également sur un déploiement, et choisir l'app par un autre moyen que le véritable en-tête `Host` est précisément ce que ce routage a pour but d'empêcher.

En auto-hébergement, le processus effectue le même choix à partir de l'en-tête `Host` de chaque requête. Pointer le nom d'hôte vers le serveur et lui attribuer un certificat relève de votre responsabilité, tout comme pour le nom d'hôte principal du projet, et un reverse proxy en amont doit transmettre le `Host` d'origine — Caddy le fait par défaut, nginx nécessite `proxy_set_header Host $host;`. `X-Forwarded-Host` n'est pas lu, car n'importe quel client peut en envoyer un.

### Sur Rebase Cloud

`rebase cloud deploy` enregistre le nom d'hôte sur le projet — ce que fait `rebase cloud domains add` — il n'y a donc aucune étape séparée à oublier. Ce qui se passe ensuite dépend du DNS :

- **Les enregistrements existent déjà.** Le déploiement vérifie le nom d'hôte, et celui-ci est en ligne dès la fin du déploiement.
- **Ils n'existent pas.** Le déploiement se poursuit et affiche les deux enregistrements à créer : un enregistrement TXT prouvant que le nom vous appartient, et un CNAME qui le fait pointer vers le projet (un enregistrement A s'il s'agit du domaine apex).

Une fois les enregistrements publiés :

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` affiche à nouveau les enregistrements si vous les perdez. Un nom d'hôte qui n'est pas vérifié dans les 7 jours suivant son enregistrement est libéré, et le déploiement suivant l'enregistrera à nouveau. Lorsque la vérification réussit, la plateforme émet le certificat HTTPS pour le nom d'hôte ; vous n'avez rien à téléverser. D'ici là, `admin` ne répond nulle part, étant donné que le seul nom d'hôte sur lequel il répond n'atteint pas encore le projet — le reste du projet étant en ligne dans tous les cas.

La console suit l'app sur son nom d'hôte : le lien *Open CMS* et l'adresse du CMS sur la vue d'ensemble du projet affichent `https://admin.example.com/`, et non l'hôte du projet.

Un nom d'hôte vérifié par un autre projet fait échouer le déploiement avant toute mise en production, tout comme un nom d'hôte situé sous le domaine propre de la plateforme. Un nom d'hôte qu'un autre projet a enregistré sans jamais le vérifier ne vous bloque pas : le refus vous fournit un enregistrement TXT pour votre projet, et dès qu'il existe, le déploiement suivant (ou `rebase cloud domains add`) s'approprie le nom d'hôte. Ajouter un nom d'hôte que le projet ne possède pas encore modifie les domaines du projet, ce qu'un jeton d'accès créé avec `--can deploy` n'est pas autorisé à faire : depuis la CI, ajoutez le nom d'hôte une fois avec `rebase cloud domains add` en étant connecté, puis le jeton pourra le déployer comme n'importe quel nom d'hôte déjà présent sur le projet. Retirer l'app de `rebase.json` laisse le nom d'hôte enregistré sur le projet ; supprimez-le avec `rebase cloud domains remove admin.example.com`.

### Un nom d'hôte appartient à une app, pas à une route

Un nom d'hôte est attribué à une app entière. Il ne peut pas pointer vers une route au sein de celle-ci. Lorsque le CMS est une route d'une SPA unique — `web` sur `/` avec `"cms": "/admin"` — il réside sur `/admin`, sur chaque nom d'hôte auquel répond le projet. Attribuer `https://admin.example.com` à cette app déplacerait l'ensemble de la SPA vers cette adresse, avec le CMS toujours situé sous `/admin`. Pour attribuer au CMS son propre nom d'hôte, faites-en une app dédiée, avec son propre build, comme dans l'exemple ci-dessus.

## Compiler et déployer des apps

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Le backend est compilé en premier, car le build d'une application cliente peut consommer un SDK généré à partir de ses tables.

## Dépôts multiples

Le monorepo reste l'option par défaut : un seul dépôt contenant un backend et un panneau d'administration est la solution la plus simple qui fonctionne, et `rebase init` en génère la structure initiale. La séparation en plusieurs dépôts est une étape ultérieure d'évolution, pas une obligation.

Dans un dépôt frontend séparé, vous avez besoin de deux choses — un manifeste déclarant ce à quoi ce dépôt contribue, et une liaison vers le projet :

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

Le lien est écrit dans `.rebase/cloud.json` et n'est **pas commité** — il est propre à chaque copie locale, comme un remote git. Le manifeste est commité ; le lien ne l'est pas.

## Clients typés sans les tables

C'est le mécanisme qui permet au multi-dépôt de fonctionner. Un dépôt qui ne contient aucune table génère son SDK typé directement à partir du projet :

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI interroge `/api/meta/contract` et lit ses `tables` — les descripteurs compilés, cibles de relations incluses, dont le générateur de types a besoin pour déterminer si une clé étrangère est une chaîne ou un nombre — et produit exactement la même sortie qu'il aurait générée à partir des sources locales.

Le point de terminaison du contrat requiert la portée `schema:read`, détenue par un administrateur. Il décrit chaque table, colonne et relation du projet, y compris celles qu'aucune règle de sécurité n'exposerait jamais ; il s'agit d'une cartographie de la base de données, pas d'une documentation d'API publique.

## Détecter les dérives

La séparation des dépôts a un inconvénient notable : un changement de schéma et le frontend qui l'utilise n'arrivent plus dans le même commit. Le backend peut déployer une modification qui laisse en suspens un client compilé selon l'ancienne structure.

Chaque SDK généré enregistre le schéma dont il est issu :

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Et chaque projet publie son schéma actuel, sans authentification, car un identifiant de version ne révèle rien sur le schéma qu'il représente :

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.30.1","contract":1}}
```

Comparer les deux dans la CI transforme une incompatibilité silencieuse en une vérification en échec. L'empreinte change lorsque les types générés sont susceptibles de changer — une nouvelle propriété, une relation modifiée — et délibérément *pas* lorsqu'un hook, une règle de sécurité ou une icône change, évitant ainsi les fausses alertes.

## Configuration du client

```bash
rebase apps config web
```

Affiche ce dont un client a besoin pour joindre le projet. Cette commande n'affiche jamais de secret : l'URL de l'API et l'identité publiable d'une app sont destinées à être intégrées dans le bundle client, et tout ce qui ne peut pas y figurer en toute sécurité n'a pas sa place dans une sortie qui finira dans un `.env` commité.

## Voir aussi

- [Runtime et bundles](/docs/architecture/runtime-and-bundles/) — ce que produit `rebase build` et ce qui le démarre
- [Processus séparés](/docs/deployment/split-processes/) — exécuter un bundle sous forme de plusieurs processus
- [Commandes CLI](/docs/cli/) — `rebase apps` et le reste
