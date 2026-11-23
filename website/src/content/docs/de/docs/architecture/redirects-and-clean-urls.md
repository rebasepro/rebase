---
sourceHash: bd5ca4ed0e47d867
title: Weiterleitungen und Clean URLs
sidebar_label: Weiterleitungen & Clean URLs
description: "Eine statische App in rebase.json kann Anfragen mit Weiterleitungen beantworten (Vercel-ähnliches :param-Matching, Host-, negierte Host- und Query-Bedingungen) und mit cleanUrls x.html unter /x bereitstellen."
---

Eine statische App kann bestimmte Anfragen mit einer Weiterleitung statt einer Datei beantworten und ihre HTML-Seiten ohne das `.html` bereitstellen:

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

- **`from`** ist ein Pfad auf der Adresse der App, absolut und innerhalb ihres `path`.
  `:name` entspricht einem Segment und `:name*`, als letztes Segment, entspricht dem
  Rest des Pfads (auch keinem Segment): `/docs/:path*` entspricht `/docs`,
  `/docs/start` und `/docs/a/b`. Ein nachgestellter Schrägstrich (Trailing Slash) bei der
  Anfrage wird ignoriert, und beim Abgleich wird zwischen Groß- und Kleinschreibung unterschieden.
- **`to`** ist ein Pfad auf derselben Adresse oder eine absolute `http://`- oder `https://`-URL.
  Jedes `:name` darin wird durch das ersetzt, was `from` erfasst hat, in seinem Pfad oder
  seiner Query. Ein Parameter im Hostnamen einer URL wird abgelehnt.
- **`status`** ist `301`, `302`, `307` oder `308`. Wird er weggelassen, ist der Standardwert `308`: permanent,
  und die Methode wird beibehalten.
- **`host`** beschränkt eine Weiterleitung auf Anfragen für einen bestimmten Hostnamen. Bei einer App, deren
  `path` einen Hostnamen angibt, kann dies nur dieser sein.
- **`notHost`** beschränkt sie auf Anfragen für jeden Hostnamen außer einem. Es kann nicht zusammen mit `host`
  gesetzt werden, und bei einer App, deren `path` einen Hostnamen angibt, kann es nicht dieser sein, da die
  Weiterleitung nie zutreffen würde.
- **`query`** beschränkt sie auf Anfragen, deren Query-String jeden Parameter
  mit genau diesem Wert enthält, verglichen nach der Dekodierung. `""` entspricht einem Parameter,
  der ohne Wert vorhanden ist (`?preview` oder `?preview=`); es gibt keine Wildcards.

Der Query-String der Anfrage wird weitergegeben, es sei denn, `to` besitzt einen eigenen. Die
Weiterleitungen werden in der Reihenfolge geprüft, in der sie definiert sind, noch vor jeder Datei des
Builds, und die erste Übereinstimmung antwortet. Ein Pfad, den eine der
[`routes`](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) der App an eine Funktion weiterleitet, gehört der
Funktion, und die Pfade des Backends (`/api`, `/health` und der Rest) werden niemals
weitergeleitet. `rebase.json` wird abgelehnt, wenn eine Weiterleitung niemals zutreffen könnte (ein
`from` außerhalb der App oder unter dem Pfad einer anderen App), wenn zwei Weiterleitungen auf
dieselben Anfragen zutreffen, und wenn eine Weiterleitung eine Anfrage an einen Pfad sendet, auf den ihr eigenes
`from` erneut zutrifft, was zu einer Endlosschleife führen würde.

## Ein Pfad, auf jedem Hostnamen eine andere Seite

Eine App, die unter mehreren Hostnamen bereitgestellt wird, kann denselben Pfad auf jedem zu einer anderen Seite weiterleiten. Hier öffnet `/` auf `app.example.com` die App und auf jedem anderen Hostnamen die Demo:

```json
"redirects": [
  { "from": "/", "host": "app.example.com", "to": "/app.html", "status": 307 },
  { "from": "/", "notHost": "app.example.com", "to": "/demo.html", "status": 307 }
]
```

Ohne `notHost` kann die zweite Weiterleitung ganz ohne Bedingung auskommen: Die erste Übereinstimmung antwortet, daher sieht sie nur, was die erste durchgelassen hat. Mit `notHost` legt jede Weiterleitung für sich fest, wo sie gilt, so wie es eine `missing`-Bedingung in `vercel.json` tut, sodass die Reihenfolge keine Rolle mehr spielt.

## Eine Domain an eine andere weiterleiten

Eine App, deren einzige Aufgabe eine Weiterleitung ist, leitet die Bare-Domain an `www` weiter,
wobei Pfad und Query beibehalten werden:

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

`root` und `output` benennen weiterhin ein Verzeichnis, dessen Existenz für ein Deployment erforderlich ist:
Behalten Sie darin eine Platzhalterdatei, wie etwa eine `index.html`, da Git keine leeren
Verzeichnisse speichert. Keine Anfrage erreicht diese. Auf Rebase Cloud registriert das Deployment
`example.com` wie den Hostnamen jeder App und gibt den A-Record aus, den der
Apex der Domain benötigt. Anders als [`rebase cloud domains redirect`](/docs/cli/cloud/), das
eine Domain an die primäre Domain des Projekts weiterleitet, kann eine Weiterleitung sie
überallhin senden, und eine Domain, unter der eine App bereitgestellt wird, wird niemals an die primäre weitergeleitet.

## `cleanUrls`

Mit `"cleanUrls": true` liefert `/privacidad` die Datei `privacidad.html` aus und
`/legal/terms` liefert `legal/terms.html` aus. Eine Anfrage, die die Datei direkt benennt,
`/privacidad.html`, antwortet mit `308` auf `/privacidad`, wobei die Query beibehalten wird. Eine Datei oder
ein Verzeichnis mit dem exakten Namen der Anfrage wird zuerst ausgeliefert, sodass `/about` weiterhin
`about/index.html` ausliefert, falls diese existiert, und `/docs/index.html` mit `308` auf
`/docs/` antwortet. Ohne diese Option ist `/privacidad` ein Pfad ohne Datei, den eine
`spa: false`-Site mit einem 404 beantwortet.

## Von Vercel umsteigen

`vercel.json`:

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

wird in der statischen App in `rebase.json` zu:

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
| `"permanent": true` | `"status": 308`, Standardwert |
| `"permanent": false` | `"status": 307` |
| `statusCode` | `status` |
| `has` vom Typ `"type": "host"` | `host` |
| `has` vom Typ `"type": "query"` mit einem `value` | `query` |
| `missing` vom Typ `"type": "host"` | `notHost` |
| `cleanUrls` | `cleanUrls` |

Ein Vercel-Projekt pro Domain wird zu einer statischen App pro Hostname, wie unter
[Eine Domain an eine andere weiterleiten](#eine-domain-an-eine-andere-weiterleiten) beschrieben. Bedingungen an einen
Header oder ein Cookie, einen `missing`-Query-Parameter sowie reguläre Ausdrücke in `source` sind Logik: Eine
[Route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) übergibt einen solchen Pfad an eine
Funktion, die mit einer beliebigen Weiterleitung antworten kann.

## Wo sie gelten

Beide werden von der Runtime aus dem erstellten Bundle bereitgestellt, wo immer sie ausgeführt wird:
`rebase start`, ein selbst gehosteter Server, und auf Rebase Cloud jede statische App, die
`rebase cloud deploy` in das Bundle des Backends einbindet. Unter `rebase dev` wird eine
App ohne Build-Schritt vom Dev-Backend mit beidem bedient. Eine App mit einem
Build läuft auf dem Dev-Server von Vite, der keines von beiden anwendet; testen Sie diese mit
`rebase start` gegen einen Build. Eine statische App, die eigenständig auf Rebase Cloud bereitgestellt wird
(`rebase cloud deploy <app>`), wird über statisches Hosting bereitgestellt, das diese noch nicht
anwendet, weshalb dieses Deployment abgelehnt wird; stellen Sie das Backend bereit, welches die App einbindet.

## Verwandte Themen

- [Apps und Repositories](/docs/architecture/apps-and-repositories/): die App-Einträge in `rebase.json`, zu denen diese Felder gehören, und die beiden Formen von `path`.
