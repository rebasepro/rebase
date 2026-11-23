---
sourceHash: bd5ca4ed0e47d867
title: Redirections et URLs propres
sidebar_label: Redirections & URLs propres
description: "Une application statique dans rebase.json peut répondre aux requêtes par des redirections (correspondance :param façon Vercel, conditions d'hôte, d'hôte exclu et de requête) et servir x.html à l'adresse /x avec cleanUrls."
---

Une application statique peut répondre à certaines requêtes par une redirection au lieu d'un fichier, et servir ses pages HTML sans le `.html` :

```jsonc
"site": {
  "type": "static",
  "root": "site",
  "output": "site",
  "path": "https://www.example.com",
  "cleanUrls": true,
  "redirects": [
    { "from": "/privacy", "to": "/privacidad" },
    { "from": "/blog/:slug", "to": "/posts/:slug", "status": 301 },
    { "from": "/docs/:path*", "to": "https://docs.example.com/:path*" },
    { "from": "/", "to": "/es", "query": { "lang": "es" }, "status": 302 }
  ]
}
```

## `redirects`

- **`from`** est un chemin sur l'adresse de l'application, absolu et situé dans son `path`.
  `:name` correspond à un segment et `:name*`, en tant que dernier segment, correspond au
  reste du chemin, y compris rien du tout : `/docs/:path*` correspond à `/docs`,
  `/docs/start` et `/docs/a/b`. La barre oblique finale sur la requête est ignorée, et la
  correspondance est sensible à la casse.
- **`to`** est un chemin sur la même adresse ou une URL absolue `http://` ou `https://`.
  Chaque `:name` y est remplacé par ce que `from` a capturé, dans son chemin ou sa
  requête (query). Un paramètre dans le nom d'hôte d'une URL est refusé.
- **`status`** vaut `301`, `302`, `307` ou `308`. S'il est omis, il vaut `308` : permanent,
  et la méthode est conservée.
- **`host`** limite une redirection aux requêtes destinées à un seul nom d'hôte. Sur une application dont
  le `path` spécifie un nom d'hôte, il ne peut s'agir que de celui-ci.
- **`notHost`** la limite aux requêtes destinées à tous les noms d'hôte sauf un. Il ne peut pas être
  combiné avec `host`, et sur une application dont le `path` spécifie un nom d'hôte, il ne peut pas s'agir de
  celui-ci, puisque la redirection ne correspondrait jamais.
- **`query`** la limite aux requêtes dont la chaîne de requête (query string) contient chaque paramètre
  avec exactement cette valeur, comparée après décodage. `""` correspond à un paramètre
  présent sans valeur (`?preview` ou `?preview=`) ; il n'y a pas de caractère générique.

La chaîne de requête de la requête entrante est transmise à moins que `to` n'en définisse une lui-même. Les
redirections sont vérifiées dans l'ordre où elles sont écrites, avant tout fichier du
build, et la première qui correspond répond. Un chemin que l'une des
[`routes`](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) de l'application envoie à une fonction appartient à la
fonction, et les chemins du backend (`/api`, `/health` et le reste) ne sont jamais
redirigés. `rebase.json` est refusé lorsqu'une redirection ne pourrait jamais correspondre (un
`from` en dehors de l'application, ou sous le chemin d'une autre application), lorsque deux redirections correspondent
aux mêmes requêtes, et lorsqu'une redirection envoie une requête vers un chemin auquel son propre
`from` correspond à nouveau, ce qui provoquerait une boucle infinie.

## Un chemin, une page différente par nom d'hôte

Une application servie sur plusieurs noms d'hôte peut envoyer le même chemin vers une page différente sur chacun. Ici, `/` ouvre l'application sur `app.example.com` et la démo sur tous les autres noms d'hôte :

```json
"redirects": [
  { "from": "/", "host": "app.example.com", "to": "/app.html", "status": 307 },
  { "from": "/", "notHost": "app.example.com", "to": "/demo.html", "status": 307 }
]
```

Sans `notHost`, la seconde redirection peut n'avoir aucune condition : la première qui correspond répond, donc elle ne voit que ce que la première a laissé passer. `notHost` fait que chaque redirection dit d'elle-même où elle s'applique, comme le fait une condition `missing` de `vercel.json`, si bien que l'ordre n'a plus d'importance.

## Rediriger un domaine vers un autre

Une application dont le seul rôle est une redirection envoie le domaine nu vers `www`, en conservant
le chemin et la requête :

```jsonc
"apex": {
  "type": "static",
  "root": "apex",
  "output": "apex",
  "path": "https://example.com",
  "redirects": [{ "from": "/:path*", "to": "https://www.example.com/:path*" }]
},
"www": { "type": "static", "root": "site", "output": "site", "path": "https://www.example.com", "cleanUrls": true }
```

`root` et `output` désignent toujours un répertoire, dont le déploiement a besoin pour exister : conservez-y
un fichier indicatif (placeholder), comme un `index.html`, puisque git ne conserve aucun
répertoire vide. Aucune requête ne l'atteint. Sur Rebase Cloud, le déploiement enregistre
`example.com` comme n'importe quel nom d'hôte d'application, et affiche l'enregistrement A dont
l'apex du domaine a besoin. Contrairement à [`rebase cloud domains redirect`](/docs/cli/cloud/), qui
envoie un domaine vers le domaine principal du projet, une redirection peut l'envoyer
n'importe où, et un domaine sur lequel une application est servie n'est jamais redirigé vers le domaine principal.

## `cleanUrls`

Avec `"cleanUrls": true`, `/privacidad` sert `privacidad.html` et
`/legal/terms` sert `legal/terms.html`. Une requête qui nomme le fichier,
`/privacidad.html`, répond par un `308` vers `/privacidad`, requête conservée. Un fichier ou un
répertoire portant le nom exact de la requête est servi en priorité, de sorte que `/about` sert toujours
`about/index.html` lorsqu'il existe, et `/docs/index.html` répond par un `308` vers
`/docs/`. Sans cela, `/privacidad` est un chemin sans fichier, auquel un site
avec `spa: false` répond par une 404.

## Venant de Vercel

`vercel.json` :

```json
{
  "cleanUrls": true,
  "redirects": [
    { "source": "/blog/:slug", "destination": "/posts/:slug", "permanent": true },
    { "source": "/:path*", "has": [{ "type": "host", "value": "example.com" }], "destination": "https://www.example.com/:path*" },
    { "source": "/", "has": [{ "type": "query", "key": "lang", "value": "es" }], "destination": "/es", "permanent": false },
    { "source": "/", "missing": [{ "type": "host", "value": "app.example.com" }], "destination": "/demo.html", "permanent": false }
  ]
}
```

devient, sur l'application statique dans `rebase.json` :

```json
{
  "cleanUrls": true,
  "redirects": [
    { "from": "/blog/:slug", "to": "/posts/:slug" },
    { "from": "/:path*", "host": "example.com", "to": "https://www.example.com/:path*" },
    { "from": "/", "query": { "lang": "es" }, "to": "/es", "status": 307 },
    { "from": "/", "notHost": "app.example.com", "to": "/demo.html", "status": 307 }
  ]
}
```

| `vercel.json` | `rebase.json` |
| --- | --- |
| `source` | `from` |
| `destination` | `to` |
| `"permanent": true` | `"status": 308`, par défaut |
| `"permanent": false` | `"status": 307` |
| `statusCode` | `status` |
| `has` avec `"type": "host"` | `host` |
| `has` avec `"type": "query"` et une `value` | `query` |
| `missing` avec `"type": "host"` | `notHost` |
| `cleanUrls` | `cleanUrls` |

Un projet Vercel par domaine devient une application statique par nom d'hôte, comme dans
[Rediriger un domaine vers un autre](#rediriger-un-domaine-vers-un-autre). Les conditions sur un
en-tête ou un cookie, un paramètre de requête `missing`, ainsi que les expressions régulières dans `source`, relèvent de la logique : une
[route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) confie un tel chemin à une
fonction, qui peut répondre avec la redirection de son choix.

## Où ils s'appliquent

Tous deux sont servis par le runtime, à partir du bundle compilé, quel que soit l'endroit où il s'exécute :
`rebase start`, un serveur auto-hébergé, et sur Rebase Cloud chaque application statique que
`rebase cloud deploy` intègre dans le bundle du backend. Sous `rebase dev`, une
application sans étape de build est servie par le backend de dev avec les deux. Une application avec un
build s'exécute sur le serveur de dev de Vite, qui n'applique ni l'un ni l'autre ; testez-les par rapport à un
build avec `rebase start`. Une application statique déployée seule sur Rebase Cloud
(`rebase cloud deploy <app>`) est servie par l'hébergement statique, qui ne les applique
pas encore, ce déploiement est donc refusé ; déployez le backend, qui intègre
l'application.

## Voir aussi

- [Applications et dépôts](/docs/architecture/apps-and-repositories/) : les entrées d'application de `rebase.json` auxquelles appartiennent ces champs, et les deux formes de `path`.
