---
sourceHash: e3293eb3c0e15be1
title: Applications et dépôts
sidebar_label: Applications & dépôts
description: Un projet est un backend accompagné des applications qui communiquent avec lui, chacune pouvant résider dans son propre dépôt.
---

## Projets et applications

Un **projet** correspond au backend : la base de données, l'authentification, le stockage, le temps réel et les fonctions. Une **application** est ce qui communique avec lui.

| Type | Ce que c'est |
| --- | --- |
| `backend` | Les tables, hooks et fonctions qui définissent l'API. Exactement un par projet. |
| `static` | Un bundle client compilé — une SPA ou un site statique, servi sur son propre chemin ou sur son propre nom d'hôte. |

C'est la liste complète. Le panneau d'administration est une application `static` comme les autres : il est compilé dans votre dépôt, avec vos personnalisations dans `frontend/src/cms`, c'est pourquoi les champs personnalisés et les vues personnalisées y fonctionnent dès le premier jour.

L'entité qui possède le processus serveur est une propriété du backend, et non un type d'application distinct :

| `runtime` | Ce que cela signifie |
| --- | --- |
| `managed` | L'image runtime de la plateforme exécute votre bundle. Vous fournissez les tables, les fonctions, les tâches cron et le schéma. |
| `custom` | Vous fournissez le serveur : votre propre Dockerfile et point d'entrée. `rebase eject` configure cela. |

Ceci est indépendant de l'*endroit* où il s'exécute. Les deux fonctionnent sur Rebase Cloud et les deux s'auto-hébergent — la destination se trouve dans `.rebase/cloud.json`, et non dans le manifeste.

Le point essentiel est ce qui *possède* la liste. Un dépôt ne déclare que les applications qu'il contient ; le projet possède l'ensemble des applications existantes. Deux dépôts n'ont jamais besoin de se connaître l'un l'autre — ils ont seulement besoin de connaître le projet. C'est ce qui fait d'un dépôt frontend distinct, ou d'une application mobile sans aucune relation de dépôt, une situation ordinaire plutôt qu'un cas particulier.

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

Un seul processus sert l'ensemble : l'API à `/api`, le site à `/`, l'admin à `/admin`. C'est le principe de l'auto-hébergement, et une excellente option légère sur Rebase Cloud.

Le `path` d'une application statique prend l'une de ces deux formes :

| `path` | Où l'application répond |
| --- | --- |
| `"/"`, `"/admin"` | À ce chemin, sur chaque nom d'hôte sur lequel le projet est servi. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Uniquement sur ce nom d'hôte, au chemin qui le suit. Voir [Une application sur son propre nom d'hôte](#une-application-sur-son-propre-nom-dhôte). |

La forme URL permet à un projet ayant un site par domaine, comme un projet Vercel ou Netlify par domaine, de devenir un seul projet Rebase : une application statique par nom d'hôte, toutes servies par le même déploiement.

## Indiquer où se trouve le CMS

`cms` est le chemin d'URL où une application monte `<RebaseCMS>`. C'est facultatif, c'est le seul champ ici qui décrit ce qui se trouve *à l'intérieur* d'une application plutôt que l'endroit où elle réside, et il existe parce que rien d'autre ne peut le déterminer.

Le CMS est un composant React dans votre propre frontend, son adresse est donc une route côté client. Ce n'est pas une route serveur, pas un fichier dans le build, et rien ne le distingue de tout autre chemin sans correspondance dans une SPA — une requête vers `/admin` reçoit le même `index.html` qu'une requête vers `/anything-else`. Ainsi, aucun déploiement, aucun serveur en cours d'exécution et aucune analyse ne peut deviner où se trouve votre panneau d'administration. Si vous ne l'indiquez pas, rien ne peut le savoir.

Ce qui en a connaissance en fait usage :

- **Rebase Cloud** place un lien *Open CMS* dans l'en-tête du projet et indique l'adresse sur la vue d'ensemble du projet — sur le propre nom d'hôte de l'application lorsqu'elle en a un. Sans `cms`, la console ne peut proposer que l'hôte du projet — qui n'atteint le CMS que si celui-ci se trouve par hasard à sa racine.
- **`rebase dev`** affiche l'URL du CMS dans sa bannière de démarrage lorsqu'il ne s'agit pas simplement de la page d'accueil du frontend.
- **`rebase apps list`** l'affiche à côté de l'application qui le sert.

Trois configurations, toutes parfaitement courantes.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

La valeur est le chemin que vous saisiriez après le nom d'hôte, et non un chemin relatif à `path`, et elle doit se trouver à l'intérieur de l'application qui la déclare — le fallback SPA de cette application étant ce qui répond à cet endroit. C'est toujours un chemin, même lorsque le `path` de l'application est une URL : le CMS se trouve alors à ce chemin sur le nom d'hôte de l'application, ainsi `"cms": "/"` ci-dessus signifie `https://admin.example.com/`. Un projet ne possède qu'un seul CMS ; en déclarer un second constitue une erreur plutôt qu'un tirage au sort pour déterminer vers lequel la console renvoie.

`path` est une entrée au **moment du build** (build-time) tout autant qu'au moment de servir. Une application montée sur `/admin` doit être *compilée* pour `/admin`, sinon `index.html` se charge et chaque ressource renvoie une erreur 404 — résultant en une page blanche sans aucune erreur apparente. `rebase build` transmet la valeur sous forme de `REBASE_APP_BASE`, que votre bundler lit comme son chemin de base :

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

et refuse de livrer un build qui l'a ignoré.

Un projet existant n'en a pas besoin. Le CLI déduit la même disposition à partir de la structure de répertoires, et `rebase apps init` l'écrit de manière explicite si vous le souhaitez :

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

L'inférence ne peut pas deviner deux éléments qu'un fichier `rebase.json` issu d'un scaffold déclare. Elle nomme l'application statique `web`, là où un scaffold la nomme `admin`, et elle ne peut pas connaître la route `cms` de l'application. Le nom ne change pas : Rebase Cloud a enregistré `web` pour chaque projet déployé sans `rebase.json`.
`rebase apps init --force` conserve les noms, `path`, `cms`, `routes`,
`frameAncestors`, <span class="since-badge" data-since="0.35">Depuis 0.35</span> `redirects` et `cleanUrls` des applications déclarées dans le fichier qu'il remplace, et marque comme supprimée une application qu'il ne trouve plus.

## Une application sur son propre nom d'hôte

`path` peut également être une URL `https://` complète, ce qui attribue à l'application son propre nom d'hôte :

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

`https://admin.example.com` sert `admin`. Tout autre nom d'hôte auquel le projet répond — `example.com`, ou la propre adresse du projet sur Rebase Cloud — sert `web`, et `admin` n'y est pas accessible du tout. Il s'agit toujours d'un seul processus et d'un seul déploiement ; le nom d'hôte décide uniquement de l'application qui répond à une requête.

Deux règles déterminent ce choix :

- Une application avec un nom d'hôte ne répond que sur ce nom d'hôte. Une application sans nom d'hôte répond sur tous les noms d'hôte.
- Parmi les applications restantes, celle avec le chemin le plus long l'emporte, comme cela a toujours été le cas. À chemin égal, l'application qui spécifie le nom d'hôte l'emporte sur celle qui ne le fait pas.

Dans l'exemple, les deux applications sont à `/`, donc sur `admin.example.com`, la seconde règle sélectionne `admin`. Déclarez plutôt l'admin à `"https://admin.example.com/cms"` et elle ne répondra que sous `/cms` sur ce nom d'hôte : `admin.example.com/pricing` sera dirigé vers `web`. Un nom d'hôte restreint l'endroit où une application répond ; il ne lui attribue pas tout ce qui se trouve sur ce nom d'hôte. Deux applications ne peuvent pas partager à la fois un nom d'hôte et un chemin.

Le backend n'est pas une application, et un nom d'hôte ne le déplace pas. `/api`, `/health` et les autres chemins réservés par le backend sont traités avant que toute application ne soit consultée, sur chaque nom d'hôte, de sorte que `https://admin.example.com/api` est la même API que `https://example.com/api`. Une application qui appelle sa propre origine — la variable vide `VITE_API_URL` du scaffold — n'a besoin d'aucune URL d'API qui lui soit propre ni d'aucune configuration CORS. Pour la même raison, ces chemins sont refusés après un nom d'hôte tout comme ils le sont isolément : `https://admin.example.com/api` n'est pas plus valide que `/api`.

Tout le reste concernant `path` s'applique à la partie située après le nom d'hôte. L'application est toujours compilée pour cela : `https://admin.example.com` est compilée avec `REBASE_APP_BASE` défini sur `/`, `https://admin.example.com/cms` avec `/cms/`, et un bundler qui l'ignore produira toujours une page blanche. `cms` est un chemin sur le nom d'hôte de l'application, à l'intérieur de cette partie de chemin. L'URL doit être en `https://` et comporter un nom d'hôte et un chemin, et rien d'autre — pas de port, de requête ou de fragment. Un simple `admin.example.com` est refusé, en indiquant l'URL sous laquelle il aurait dû être formulé.

Sous `rebase dev`, rien n'est routé par nom d'hôte. La commande exécute l'application dans `frontend/` à la racine d'un port localhost, comme elle l'a toujours fait, et pour une application avec un nom d'hôte, sa bannière affiche également l'adresse `https://` qu'elle aura une fois déployée.

`rebase start` fonctionne différemment, car il exécute le bundle compilé à travers le même runtime qu'un déploiement — routage par nom d'hôte inclus. Une application avec un nom d'hôte ne répond qu'aux requêtes dont le `Host` correspond à ce nom d'hôte, donc `http://localhost:3001/` affiche l'application sans nom d'hôte, et un bundle dont la seule application spécifie un nom d'hôte renvoie une erreur 404 à cette adresse. Pour l'atteindre localement, envoyez vous-même l'en-tête :

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

ou faites pointer le nom d'hôte vers `127.0.0.1` dans `/etc/hosts` et ouvrez `http://admin.example.com:3001/`. Il n'y a délibérément aucun paramètre de requête ni en-tête permettant de contourner le routage : un mécanisme qui fonctionnerait localement fonctionnerait également sur un déploiement, et choisir l'application par un autre moyen que le véritable `Host` est précisément ce que le routage a pour but d'empêcher.

En auto-hébergement, le processus effectue le même choix à partir de l'en-tête `Host` de chaque requête. Faire pointer le nom d'hôte vers le serveur et lui fournir un certificat relève de votre responsabilité, comme pour le nom d'hôte principal du projet, et un reverse proxy en amont doit transmettre le `Host` d'origine — Caddy le fait par défaut, nginx nécessite `proxy_set_header Host $host;`. L'en-tête `X-Forwarded-Host` n'est pas lu, car n'importe quel client peut en envoyer un.

### Sur Rebase Cloud

`rebase cloud deploy` enregistre le nom d'hôte sur le projet — ce que fait `rebase cloud domains add` — il n'y a donc pas d'étape distincte à oublier. Ce qui se passe ensuite dépend du DNS :

- **Les enregistrements existent déjà.** Le déploiement vérifie le nom d'hôte, et celui-ci est actif dès que le déploiement se termine.
- **Ils n'existent pas.** Le déploiement continue et affiche les deux enregistrements à créer : un enregistrement TXT qui prouve que le nom vous appartient, et un CNAME qui le fait pointer vers le projet (un enregistrement A, si le nom d'hôte est l'apex du domaine).

Une fois les enregistrements publiés :

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` réaffiche les enregistrements si vous les avez égarés. Un nom d'hôte qui n'est pas vérifié dans les 7 jours suivant son enregistrement est libéré, et le déploiement suivant l'enregistre à nouveau. Lorsque la vérification réussit, la plateforme émet le certificat HTTPS pour le nom d'hôte ; il n'y a rien à importer. Jusque-là, `admin` ne répond nulle part, puisque le seul nom d'hôte sur lequel elle répond n'atteint pas encore le projet — le reste du projet est en ligne dans les deux cas.

La console suit l'application sur son nom d'hôte : le lien *Open CMS* et l'adresse du CMS sur la vue d'ensemble du projet sont `https://admin.example.com/`, et non l'hôte du projet.

Un nom d'hôte qu'un autre projet a déjà vérifié fait échouer le déploiement avant toute mise en production, tout comme un nom d'hôte situé sous le propre domaine de la plateforme. Un nom d'hôte qu'un autre projet a enregistré mais n'a jamais vérifié ne vous bloque pas : le refus vous fournit un enregistrement TXT pour votre projet, et dès qu'il existe, le déploiement suivant (ou `rebase cloud domains add`) s'approprie le nom d'hôte. Ajouter un nom d'hôte que le projet ne possède pas encore modifie les domaines du projet, ce qu'un jeton d'accès créé avec `--can deploy` ne peut pas faire : depuis la CI, ajoutez le nom d'hôte une fois avec `rebase cloud domains add` en étant connecté, et le jeton pourra ensuite le déployer comme n'importe quel nom d'hôte déjà configuré sur le projet. Retirer l'application de `rebase.json` laisse le nom d'hôte enregistré sur le projet ; supprimez-le avec `rebase cloud domains remove admin.example.com`.

### Un nom d'hôte appartient à une application, pas à une route

Un nom d'hôte est attribué à une application entière. Il ne peut pas pointer vers une route au sein de celle-ci. Lorsque le CMS est une route d'une seule SPA — `web` à `/` avec `"cms": "/admin"` — il réside à `/admin`, sur chaque nom d'hôte auquel le projet répond. Attribuer à cette application `https://admin.example.com` déplacerait l'ensemble de la SPA vers cet emplacement, avec le CMS toujours situé à `/admin` sous celle-ci. Pour donner au CMS son propre nom d'hôte, faites-en une application à part entière, avec son propre build, comme dans l'exemple ci-dessus.

## Servir une fonction sur un chemin d'une application

Une fonction personnalisée répond à `/api/functions/<name>`, et une application statique ne peut pas s'approprier `/api`. Un site de publication a besoin de certains chemins qu'aucun build ne peut contenir — un sitemap et un flux qui listent les derniers articles, une page rendue à partir de la base de données. `routes` permet de servir la réponse d'une fonction à un chemin situé sur l'adresse même de l'application :

```jsonc
"site": {
  "type": "static",
  "root": "site",
  "output": "site/dist",
  "path": "https://www.example.com",
  "routes": [
    { "path": "/sitemap.xml", "function": "sitemap" },
    { "path": "/feed.xml", "function": "feed" },
    { "path": "/blog/*", "function": "blog" }
  ]
}
```

`https://www.example.com/sitemap.xml` correspond alors à ce que `functions/sitemap.ts` retourne, avec ses propres `Content-Type`, statut et en-têtes. Tout le reste sur le nom d'hôte correspond au build du site, comme auparavant.

- **Exact ou joker (wildcard).** `/sitemap.xml` correspond uniquement à ce chemin. `/blog/*` correspond à `/blog` et à tous les chemins en dessous, et transmet le reste à la fonction : `/blog/hello` atteint la route `/:slug` de la fonction avec `slug` valant `hello`, et `/blog` atteint sa route `/`.
- **La fonction voit un appel ordinaire.** La requête lui parvient comme si elle avait été effectuée vers `/api/functions/<name>`, via la même authentification, les mêmes vérifications de portée (scope), la même limitation de débit (rate limit) et le même délai d'expiration (timeout). Sa méthode, ses en-têtes, son corps et sa chaîne de requête sont transmis, tout comme `Host`, de sorte que `new URL(c.req.url).origin` correspond à l'origine du site — ce à partir de quoi les URL absolues d'un sitemap sont construites. La fonction répond toujours également à `/api/functions/<name>`.
- **La route la plus spécifique l'emporte** : un chemin exact avant tout wildcard, et un wildcard plus long avant un plus court. Une route l'emporte également sur un fichier du même chemin dans le build, de sorte qu'un fichier `public/sitemap.xml` obsolète ne peut pas la masquer.
- **Uniquement là où l'application répond.** Une route s'applique aux requêtes auxquelles l'application elle-même répondrait — sur son nom d'hôte, si elle en a un, et pas sous le chemin d'une autre application. `rebase.json` est refusé lorsqu'une route est positionnée là où une autre application répond.
- **À l'intérieur de l'application, et jamais du backend.** Le chemin d'une route est absolu, à l'intérieur du `path` de l'application, et ne peut pas se trouver sous `/api`, `/health`, `/healthz`, `/livez`, `/readyz` ou `/metrics`, ni comporter de segment commençant par `.`. Un wildcard ne peut pas couvrir l'ensemble de l'application, ce qui laisserait son build non servi.

Les routes sont servies par le processus backend dans lequel l'application est intégrée, car c'est là que les fonctions s'exécutent : `rebase build` et `rebase cloud deploy` intègrent chaque application statique dans le bundle du backend, et le build échoue si une route désigne une fonction que le backend ne possède pas. Une application statique déployée seule ne dispose d'aucune fonction à appeler, donc `rebase cloud deploy` en refuse une qui contient des routes, et le runtime refuse de démarrer un bundle purement statique qui en déclare.

Une réponse routée qui n'envoie pas de `Content-Security-Policy` hérite de celle de l'application, de sorte que les origines déclarées dans ses [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app) peuvent intégrer dans une iframe une page rendue côté serveur de la même manière qu'elles peuvent intégrer le reste du site.

Sous `rebase dev`, l'application est servie par son propre serveur de développement, qui n'a pas connaissance des routes ; appelez la fonction à `/api/functions/<name>` dans cet environnement, ou testez les routes sur un build avec `rebase start`.

## Redirections et URL propres

<span class="since-badge" data-since="0.35">Depuis 0.35</span>

Une application statique prend en charge `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`, y compris vers un autre domaine) et `cleanUrls: true` (`/x` sert `x.html`). Voir [Redirections et URL propres](/docs/architecture/redirects-and-clean-urls/), qui détaille également la correspondance d'un fichier `vercel.json` vers `rebase.json`.

## Compiler et déployer des applications

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Le backend est compilé en premier, car le build d'une application cliente peut consommer un SDK généré à partir de ses tables.

## Dépôts multiples

Le monorepo reste l'approche par défaut : un seul dépôt contenant un backend et un panneau d'administration est la solution la plus simple qui fonctionne, et `rebase init` le génère ainsi. Séparer en plusieurs dépôts est une étape ultérieure, pas une obligation.

Dans un dépôt frontend séparé, vous avez besoin de deux éléments — un manifeste déclarant ce que ce dépôt apporte, et une liaison vers le projet :

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

La liaison est enregistrée dans `.rebase/cloud.json` et n'est **pas commitée** — elle est propre à chaque copie locale, comme un remote git. Le manifeste est commité ; la liaison ne l'est pas.

## Clients typés sans les tables

C'est le mécanisme qui rend possible l'architecture multi-dépôts. Un dépôt qui ne contient aucune table génère son SDK typé directement à partir du projet :

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

Le CLI interroge `/api/meta/contract` et lit ses `tables` — les descripteurs compilés, cibles des relations incluses, dont le générateur de types a besoin pour déterminer si une clé étrangère est une chaîne ou un nombre — et génère exactement la même sortie qu'il aurait produite à partir des sources locales.

Le point de terminaison du contrat nécessite le scope `schema:read`, que possède un administrateur. Il décrit chaque table, colonne et relation du projet, y compris celles qu'aucune règle de sécurité n'exposerait jamais ; il s'agit d'une cartographie de la base de données, pas d'une documentation d'API publique.

## Détecter les dérives

Séparer les dépôts implique un inconvénient notable : une modification de schéma et le frontend qui l'utilise n'arrivent plus dans le même commit. Le backend peut déployer un changement qui bloque un client compilé selon l'ancienne structure.

Chaque SDK généré enregistre le schéma dont il est issu :

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Et chaque projet publie sa version actuelle, sans authentification, car une empreinte de version ne révèle rien sur le schéma auquel elle correspond :

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.34.2","contract":1}}
```

Comparer les deux dans la CI transforme une divergence silencieuse en un test en échec. L'empreinte change lorsque les types générés sont susceptibles de changer — une nouvelle propriété, une relation modifiée — et délibérément *pas* lorsqu'un hook, une règle de sécurité ou une icône change, évitant ainsi les fausses alertes.

## Configuration client

```bash
rebase apps config web
```

Affiche les informations dont un client a besoin pour joindre le projet. Cette commande n'affiche jamais de secret : l'URL de l'API et l'identifiant public d'une application sont destinés à être inclus dans un bundle client, et tout ce qui ne peut pas y figurer en toute sécurité n'a pas sa place dans une sortie susceptible de se retrouver dans un fichier `.env` commité.

## Voir aussi

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — ce que `rebase build` produit et ce qui l'exécute
- [Split Processes](/docs/deployment/split-processes/) — exécuter un bundle sous forme de plusieurs processus
- [CLI Commands](/docs/cli/) — `rebase apps` et le reste
