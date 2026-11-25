---
sourceHash: af88a900323a0f86
title: Applications et dépôts
sidebar_label: Applications & Dépôts
description: Un projet est un backend plus les applications qui communiquent avec lui, chacune pouvant vivre dans son propre dépôt.
---

## Projets et applications

Un **projet** est le backend : la base de données, l'authentification, le stockage, le temps réel et les
fonctions. Une **application** est quelque chose qui communique avec lui.

| Type | Ce que c'est |
| --- | --- |
| `backend` | Les tables, hooks et fonctions qui définissent l'API. Exactement un par projet. |
| `static` | Un bundle client compilé — une SPA ou un site statique, servi sur son propre chemin, ou sur un nom d'hôte dédié. |

C'est toute la liste. Le panneau d'administration est une application `static` comme les
autres : il est compilé dans votre dépôt, avec vos personnalisations `frontend/src/cms`, ce qui
explique pourquoi les champs et vues personnalisés y fonctionnent dès le premier jour.

La propriété du processus serveur appartient au backend, pas à un type
d'application distinct :

| `runtime` | Ce que cela signifie |
| --- | --- |
| `managed` | L'image d'exécution de la plateforme exécute votre bundle. Vous fournissez les tables, fonctions, crons et le schéma. |
| `custom` | Vous fournissez le serveur : votre propre Dockerfile et point d'entrée. `rebase eject` configure cela. |

Cela est indépendant de l'endroit *où* il s'exécute. Les deux fonctionnent sur Rebase Cloud et les deux
s'auto-hébergent — la destination réside dans `.rebase/cloud.json`, pas dans le manifeste.

L'élément important est ce qui *possède* la liste. Un dépôt ne déclare que les applications
qu'il contient ; le projet possède l'ensemble des applications existantes. Deux dépôts n'ont
jamais besoin de se connaître — ils ont seulement besoin de connaître le projet. C'est ce qui
fait qu'un dépôt frontend distinct, ou une application mobile sans aucun lien de dépôt,
soit une chose ordinaire plutôt qu'un cas particulier.

## `rebase.json`

Le manifeste déclare la topologie, et rien d'autre. Le schéma, les règles de sécurité, les hooks
et les fonctions restent en TypeScript où un système de types peut les vérifier.

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

Un seul processus sert l'ensemble : l'API à `/api`, le site à `/`, l'administration à
`/admin`. C'est le principe de l'auto-hébergement, et une excellente formule de base sur
Rebase Cloud.

Le `path` d'une application statique prend l'une des deux formes suivantes :

| `path` | Où l'application répond |
| --- | --- |
| `"/"`, `"/admin"` | À ce chemin, sur chaque nom d'hôte sur lequel le projet est servi. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Uniquement sur ce nom d'hôte, au chemin qui suit. Voir [Une application sur son propre nom d'hôte](#une-application-sur-son-propre-nom-dhôte). |

La forme URL est la manière dont un projet avec un site par domaine, comme un projet Vercel ou
Netlify par domaine, devient un seul projet Rebase : une application statique par nom d'hôte,
toutes servies par le même déploiement.

## Indiquer l'emplacement du CMS

`cms` est le chemin d'URL où une application monte `<RebaseCMS>`. Il est facultatif, c'est
le seul champ ici qui décrit ce qui se trouve *à l'intérieur* d'une application plutôt que l'endroit où
elle réside, et il existe parce que rien d'autre ne peut le déterminer.

Le CMS est un composant React dans votre propre frontend, son adresse est donc une
route côté client. Ce n'est pas une route serveur, pas un fichier dans le build, et elle n'est pas
distinguable de tout autre chemin non mappé sous une SPA — une requête vers
`/admin` reçoit le même `index.html` qu'une requête vers `/anything-else`. Ainsi, aucun
déploiement, aucun serveur en cours d'exécution et aucune analyse ne peut déterminer où se trouve
votre panneau d'administration. Si vous ne l'écrivez pas, rien ne le sait.

Ce qui le sait en fait usage :

- **Rebase Cloud** place un lien *Open CMS* dans l'en-tête du projet et liste
  l'adresse dans la vue d'ensemble du projet — sur le nom d'hôte propre à l'application
  lorsqu'elle en possède un. Sans `cms`, la console ne peut proposer que l'hôte du projet — qui
  n'atteint le CMS que si celui-ci se trouve par hasard à sa racine.
- **`rebase dev`** affiche l'URL du CMS dans sa bannière de démarrage lorsqu'elle n'est pas
  simplement la page d'accueil du frontend.
- **`rebase apps list`** l'affiche à côté de l'application qui la sert.

Trois configurations, et toutes sont courantes.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

La valeur est le chemin que vous taperiez après le nom d'hôte, et non un chemin relatif
à `path`, et elle doit se trouver à l'intérieur de l'application qui la déclare — le fallback SPA
de cette application est ce qui y répond. C'est toujours un chemin, même lorsque le `path` de
l'application est une URL : le CMS se trouve alors à ce chemin sur le nom d'hôte de l'application,
donc `"cms": "/"` ci-dessus signifie `https://admin.example.com/`. Un projet possède un seul CMS ;
en déclarer un deuxième est une erreur plutôt qu'un tirage à pile ou face pour déterminer vers lequel
la console pointe.

`path` est une entrée au moment du **build** tout autant qu'au moment de servir le contenu. Une application montée sur
`/admin` doit être *compilée* pour `/admin`, sinon `index.html` se charge et chaque ressource
renvoie une 404 — une page blanche sans aucune erreur visible. `rebase build` transmet la valeur sous
`REBASE_APP_BASE`, que votre bundler lit comme son chemin de base :

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

et refuse de livrer un build qui l'a ignoré.

Un projet existant n'en a pas besoin. La CLI déduit la même disposition à partir de la
structure des répertoires, et `rebase apps init` l'écrit lorsque vous souhaitez la rendre explicite :

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

L'inférence ne peut pas savoir deux choses qu'un `rebase.json` échafaudé déclare. Elle nomme
l'application statique `web`, là où un échafaudage la nomme `admin`, et elle ne peut pas connaître
la route `cms` de l'application. Le nom ne change pas : Rebase Cloud a enregistré `web` pour
chaque projet déployé sans `rebase.json`.
`rebase apps init --force` conserve les noms, `path`, `cms`, `routes`,
`frameAncestors`, `redirects` et `cleanUrls` des applications déclarées par le fichier qu'il remplace,
et marque comme supprimée une application qu'il ne trouve plus.

## Une application sur son propre nom d'hôte

`path` peut également être une URL `https://` complète, ce qui donne à l'application un nom d'hôte
dédié :

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

`https://admin.example.com` sert `admin`. Tous les autres noms d'hôte auxquels le projet
répond — `example.com`, ou la propre adresse du projet sur Rebase Cloud —
servent `web`, et `admin` n'y est pas accessible du tout. Il s'agit toujours d'un seul
processus et d'un seul déploiement ; le nom d'hôte décide uniquement de quelle application répond à une requête.

Deux règles en décident :

- Une application avec un nom d'hôte répond uniquement sur ce nom d'hôte. Une application sans nom d'hôte
  répond sur tous les noms d'hôte.
- Parmi les applications restantes, celle dont le chemin est le plus long l'emporte, comme cela a toujours été le cas. À chemin
  égal, l'application qui spécifie le nom d'hôte l'emporte sur celle qui ne le fait pas.

Dans l'exemple, les deux applications sont sur `/`, donc sur `admin.example.com`, la deuxième règle
choisit `admin`. Déclarez plutôt l'administration sur `"https://admin.example.com/cms"`
et elle ne répondra que sous `/cms` sur ce nom d'hôte : `admin.example.com/pricing`
ira vers `web`. Un nom d'hôte restreint l'endroit où une application répond ; il ne confie pas à
l'application l'intégralité de ce nom d'hôte. Deux applications ne peuvent pas partager à la fois un nom d'hôte et un
chemin.

Le backend n'est pas une application, et un nom d'hôte ne le déplace pas. `/api`, `/health`
et les autres chemins réservés par le backend reçoivent une réponse avant que toute application ne soit
consultée, sur chaque nom d'hôte, de sorte que `https://admin.example.com/api` est la même
API que `https://example.com/api`. Une application qui appelle sa propre origine — le
`VITE_API_URL` vide de l'échafaudage — n'a besoin d'aucune URL d'API qui lui soit propre et d'aucune
configuration CORS. Pour la même raison, ces chemins sont refusés après un nom d'hôte tout comme
ils le sont seuls : `https://admin.example.com/api` n'est pas plus valide que
`/api`.

Tout le reste concernant `path` s'applique à la partie située après le nom d'hôte. L'application
est toujours compilée pour celui-ci : `https://admin.example.com` est compilée avec
`REBASE_APP_BASE` défini sur `/`, `https://admin.example.com/cms` avec `/cms/`, et
un bundler qui l'ignore vous donnera quand même une page blanche. `cms` est un chemin sur le nom
d'hôte de l'application, à l'intérieur de cette partie de chemin. L'URL doit être en `https://` et comporter un
nom d'hôte et un chemin et rien d'autre — pas de port, de requête ou de fragment. Un simple
`admin.example.com` est refusé, en indiquant l'URL qu'il aurait dû être.

Sous `rebase dev`, rien n'est routé par nom d'hôte. Il exécute l'application dans
`frontend/` à la racine d'un port localhost, comme il l'a toujours fait, et pour une application
dotée d'un nom d'hôte, sa bannière affiche également l'adresse `https://` qu'elle aura
une fois déployée.

`rebase start` est différent, car il exécute le bundle compilé à travers le même
runtime qu'un déploiement — routage par nom d'hôte inclus. Une application avec un nom d'hôte
ne répond qu'aux requêtes dont le `Host` est ce nom d'hôte, donc
`http://localhost:3001/` affiche l'application sans nom d'hôte, et un bundle dont la seule application
spécifie un nom d'hôte y répond par une 404. Pour y accéder localement, envoyez vous-même
l'en-tête :

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

ou faites pointer le nom d'hôte vers `127.0.0.1` dans `/etc/hosts` et ouvrez
`http://admin.example.com:3001/`. Il n'y a délibérément aucun paramètre de requête ou
en-tête permettant de surcharger le routage : un paramètre fonctionnant localement fonctionnerait également
sur un déploiement, et choisir l'application par autre chose que le véritable `Host` est
précisément ce que le routage vise à empêcher.

En auto-hébergement, le processus effectue le même choix à partir de l'en-tête `Host` de chaque requête.
Pointer le nom d'hôte vers le serveur et lui attribuer un certificat
vous incombent, comme pour le nom d'hôte principal du projet, et un reverse proxy
en amont doit transmettre le `Host` d'origine — Caddy le fait par défaut,
nginx nécessite `proxy_set_header Host $host;`. `X-Forwarded-Host` n'est pas lu,
car n'importe quel client peut en envoyer un.

### Sur Rebase Cloud

`rebase cloud deploy` enregistre le nom d'hôte sur le projet — ce que
fait `rebase cloud domains add` — il n'y a donc aucune étape séparée à oublier. Ce qui
se passe ensuite dépend du DNS :

- **Les enregistrements existent déjà.** Le déploiement vérifie le nom d'hôte, et celui-ci est
  en ligne dès la fin du déploiement.
- **Ils n'existent pas.** Le déploiement se poursuit et affiche les deux enregistrements à créer :
  un enregistrement TXT qui prouve que le nom vous appartient, et un CNAME qui le pointe vers le
  projet (un enregistrement A si le nom d'hôte est l'apex du domaine).

Une fois les enregistrements publiés :

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` affiche à nouveau les enregistrements si vous les perdez. Un
nom d'hôte qui n'est pas vérifié dans les 7 jours suivant son enregistrement est libéré,
et le déploiement suivant l'enregistre à nouveau. Lorsque la
vérification réussit, la plateforme émet le certificat HTTPS pour le
nom d'hôte ; il n'y a rien à téléverser. D'ici là, `admin` ne répond nulle part, puisque
le seul nom d'hôte sur lequel il répond n'atteint pas encore le projet — le reste
du projet est opérationnel dans tous les cas.

La console suit l'application sur son nom d'hôte : le lien *Open CMS* et l'adresse
du CMS sur la vue d'ensemble du projet sont `https://admin.example.com/`, et non
l'hôte du projet.

Un nom d'hôte vérifié par un autre projet fait échouer le déploiement avant le moindre
déploiement effectif, tout comme un nom d'hôte sous le propre domaine de la plateforme. Un nom d'hôte qu'un autre
projet a enregistré mais n'a jamais vérifié ne vous bloque pas : le refus
vous fournit un enregistrement TXT pour votre projet, et une fois celui-ci créé, le prochain déploiement (ou
`rebase cloud domains add`) s'approprie le nom d'hôte. Ajouter un nom d'hôte
que le projet ne possède pas encore modifie les domaines du projet, ce qu'un jeton d'accès
créé avec `--can deploy` ne peut pas faire : depuis la CI, ajoutez le nom d'hôte une fois avec
`rebase cloud domains add` en étant connecté, et le jeton le déploiera ensuite comme
n'importe quel nom d'hôte déjà présent sur le projet. Retirer l'application
de `rebase.json` laisse le nom d'hôte enregistré sur le projet ; supprimez-le avec
`rebase cloud domains remove admin.example.com`.

### Un nom d'hôte appartient à une application, pas à une route

Un nom d'hôte est attribué à une application entière. Il ne peut pas pointer vers une route à l'intérieur de celle-ci. Lorsque
le CMS est une route d'une seule SPA — `web` sur `/` avec `"cms": "/admin"` — il
réside sur `/admin`, sur chaque nom d'hôte auquel le projet répond. Donner à cette application
`https://admin.example.com` déplacerait l'ensemble de la SPA vers celui-ci, avec le CMS toujours
situé à `/admin` en dessous. Pour donner au CMS son propre nom d'hôte, faites-en une application
à part entière, avec son propre build, comme dans l'exemple ci-dessus.

## Servir une fonction sur le chemin d'une application

Une fonction personnalisée répond sur `/api/functions/<name>`, et une application statique ne peut pas
revendiquer `/api`. Un site de publication a besoin de certains chemins qu'aucun build ne peut contenir — un
sitemap et un flux listant les derniers articles, une page rendue à partir de la
base de données. `routes` sert la réponse d'une fonction à un chemin sur l'adresse propre
de l'application :

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

`https://www.example.com/sitemap.xml` correspond alors à ce que renvoie `functions/sitemap.ts`,
avec ses propres `Content-Type`, statut et en-têtes. Tout le reste sur
ce nom d'hôte correspond au build du site, comme auparavant.

- **Exact ou joker (wildcard).** `/sitemap.xml` correspond uniquement à ce chemin. `/blog/*`
  correspond à `/blog` et à tous les chemins situés en dessous, et transmet le reste à la fonction :
  `/blog/hello` atteint la route `/:slug` de la fonction avec `slug` défini sur
  `hello`, et `/blog` atteint sa route `/`.
- **La fonction reçoit un appel ordinaire.** La requête l'atteint comme si elle avait
  été envoyée à `/api/functions/<name>`, en passant par la même authentification, les vérifications de scopes,
  la limitation de débit et le délai d'expiration. Sa méthode, ses en-têtes, son corps et sa chaîne de requête sont transmis,
  de même que `Host`, de sorte que `new URL(c.req.url).origin` correspond à l'origine du site — ce à partir de quoi
  les URL absolues d'un sitemap sont construites. La fonction répond toujours
  également à `/api/functions/<name>`.
- **La route la plus spécifique l'emporte** : un chemin exact avant tout wildcard, et un
  wildcard plus long avant un plus court. Une route l'emporte également sur un fichier ayant le
  même chemin dans le build, de sorte qu'un `public/sitemap.xml` obsolète ne peut pas la masquer.
- **Uniquement là où l'application répond.** Une route s'applique aux requêtes auxquelles l'application elle-même
  répondrait — sur son nom d'hôte, si elle en a un, et non sous le chemin d'une autre application.
  `rebase.json` est refusé lorsqu'une route se situe là où une autre application répond.
- **À l'intérieur de l'application, et jamais du backend.** Le chemin d'une route est absolu,
  situé à l'intérieur du `path` de l'application, et ne peut pas se trouver sous `/api`, `/health`, `/healthz`,
  `/livez`, `/readyz` ou `/metrics`, ni comporter de segment commençant par `.`. Un
  wildcard ne peut pas couvrir l'intégralité de l'application, ce qui laisserait son build non servi.

Les routes sont servies par le processus backend dans lequel l'application est intégrée, car c'est
là que s'exécutent les fonctions : `rebase build` et `rebase cloud deploy` intègrent chaque
application statique dans le bundle du backend, et le build échoue si une route désigne une
fonction que le backend ne possède pas. Une application statique déployée seule n'a aucune
fonction à appeler, donc `rebase cloud deploy` en refuse une qui contient des routes, et le
runtime refuse de démarrer un bundle purement statique qui en déclare.

Une réponse routée qui n'envoie aucun `Content-Security-Policy` reçoit celui de l'application,
afin que les origines présentes dans son [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app)
puissent intégrer une page rendue côté serveur dans une iframe comme elles peuvent intégrer le reste du site.

Sous `rebase dev`, l'application est servie par son propre serveur de développement, qui ignore tout
des routes ; appelez-y la fonction sur `/api/functions/<name>`, ou testez les
routes sur un build avec `rebase start`.

## Redirections et URL propres

Une application statique accepte `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`,
y compris vers un autre domaine) et `cleanUrls: true` (`/x` sert `x.html`). Voir
[Redirections et URL propres](/docs/architecture/redirects-and-clean-urls/), qui
explique également comment faire correspondre un `vercel.json` avec un `rebase.json`.

## App Links, Universal Links et autres fichiers `/.well-known`

Les App Links Android et Universal Links iOS sont vérifiés en récupérant un fichier depuis
l'origine du site : `https://<host>/.well-known/assetlinks.json` et
`https://<host>/.well-known/apple-app-site-association`. Tant qu'une plateforme ne peut pas
le récupérer, un lien cliqué ou scanné s'ouvre dans le navigateur au lieu de
l'application installée. Placez les fichiers dans le dossier `.well-known/` du build (avec Vite,
`public/.well-known/`) et l'application à `/` les servira :

```text
site/dist/
  index.html
  .well-known/
    assetlinks.json
    apple-app-site-association
```

- **Un fichier ou une 404.** `/.well-known/<name>` répond avec ce fichier du
  build, ou une 404 lorsque le build n'en contient pas, jamais le fichier `index.html` de l'application et jamais
  une redirection. Les fichiers se terminant par `.json` et le fichier sans extension
  `apple-app-site-association` sont envoyés avec le type `application/json` ; les autres selon leur
  extension (`security.txt` en tant que `text/plain`). Chacun comporte un `ETag` et
  `Cache-Control: no-cache`.
- **Les documents du backend l'emportent.** `jwks.json`, `oauth-protected-resource`,
  `oauth-authorization-server`, `openid-configuration` et `acme-challenge/`
  ne sont jamais servis depuis un build, même dans un processus où le backend ne les
  sert pas lui-même, afin qu'un build ne puisse pas publier de clés de signature ou de métadonnées OAuth.
- **Aucun autre fichier commençant par un point.** Un segment commençant par `.` sous `.well-known`
  (`/.well-known/.secret`), ainsi que tout autre chemin avec un point (`/.env`, `/.git/config`),
  restent refusés, qu'ils soient encodés ou non, et un fichier qui est un lien symbolique pointant hors
  du build n'est pas servi.
- **Uniquement l'application sur `/`.** `/.well-known` appartient à l'origine, donc une application
  sous un chemin (`/admin`) ne publie rien depuis son dossier `.well-known/`. Avec les
  [applications sur leurs propres noms d'hôte](#une-application-sur-son-propre-nom-dhôte), l'application sur `/` de chaque nom d'hôte
  sert les siens, de sorte qu'`admin.example.com` et `www.example.com` peuvent
  publier des fichiers différents.

Les fichiers sont servis par le processus backend dans lequel l'application est intégrée
(`rebase start`, un déploiement auto-hébergé ou Cloud), tout comme le reste du build.
Le chemin d'une route ne peut pas être sous `/.well-known` ; pour générer l'un de ces
documents, écrivez-le dans le build.

## Compiler et déployer des applications

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Le backend est compilé en premier, car le build d'une application cliente peut consommer un SDK
généré à partir de ses tables.

## Dépôts multiples

Le monorepo reste le choix par défaut : un seul dépôt avec un backend et un panneau d'administration
est la solution la plus simple qui fonctionne, et `rebase init` l'échafaude. La séparation est
une étape ultérieure, pas une obligation.

Dans un dépôt frontend séparé, vous avez besoin de deux choses — un manifeste déclarant
ce à quoi ce dépôt contribue, et un lien vers le projet :

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

Le lien est écrit dans `.rebase/cloud.json` et n'est **pas commité** — il est
propre à chaque copie locale, comme un remote git. Le manifeste est commité ; le lien ne l'est pas.

## Clients typés sans les tables

C'est le mécanisme qui permet le multi-dépôt. Un dépôt qui ne contient aucune
table génère son SDK typé à partir du projet lui-même :

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI récupère `/api/meta/contract` et lit ses `tables` — les descripteurs compilés,
cibles de relations incluses, dont le générateur de types a besoin pour
déterminer si une clé étrangère est une chaîne ou un nombre — et produit exactement la
même sortie qu'elle aurait produite à partir du code source local.

Le point de terminaison du contrat nécessite le scope `schema:read`, que possède un administrateur. Il
décrit chaque table,
colonne et relation du projet, y compris celles qu'aucune règle de sécurité n'exposerait
jamais ; il s'agit d'une cartographie de la base de données, pas d'une documentation d'API publique.

## Détecter les dérives

Séparer les dépôts a un coût qu'il convient de mentionner : une modification du schéma et le
frontend qui l'utilise ne se retrouvent plus dans le même commit. Le backend peut déployer une
modification qui bloque un client compilé sur l'ancienne structure.

Chaque SDK généré enregistre le schéma dont il provient :

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Et chaque projet publie son schéma actuel, sans authentification, car un
indicateur de version ne révèle rien sur le schéma qu'il représente :

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.38.1","contract":1}}
```

Comparer les deux dans la CI transforme une incompatibilité silencieuse en une vérification échouée. L'indicateur
change lorsque les types générés sont susceptibles de changer — une nouvelle propriété, une
relation modifiée — et délibérément *pas* lorsqu'un hook, une règle de sécurité ou une icône
change, évitant ainsi les fausses alertes.

## Configuration du client

```bash
rebase apps config web
```

Affiche ce dont un client a besoin pour joindre le projet. Il n'affiche jamais de secret : l'URL
de l'API et l'identité publiable d'une application sont destinées à être intégrées au
bundle client, et tout ce qui n'y est pas sécurisé n'a pas sa place dans une sortie susceptible
de se retrouver dans un fichier `.env` commité.

## Voir aussi

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — ce que produit `rebase build` et ce qui le démarre
- [Processus divisés](/docs/deployment/split-processes/) — exécuter un bundle sous forme de plusieurs processus
- [Commandes CLI](/docs/cli/) — `rebase apps` et le reste
