---
sourceHash: 51ad2b8ffc5dc3c7
title: Redirect e clean URL
sidebar_label: Redirect & Clean URL
description: "Un'app statica in rebase.json può rispondere alle richieste con dei redirect (matching dei :param in stile Vercel, condizioni su host e query) e servire x.html su /x con cleanUrls."
---

<span class="since-badge" data-since="0.35">Da 0.35</span>

Un'app statica può rispondere ad alcune richieste con un redirect invece che con un file, e
servire le sue pagine HTML senza `.html`:

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

<span class="since-badge" data-since="0.35">Da 0.35</span>

- **`from`** è un percorso sull'indirizzo dell'app, assoluto e all'interno del suo `path`.
  `:name` corrisponde a un singolo segmento e `:name*`, come ultimo segmento, corrisponde al
  resto del percorso, inclusa l'assenza di segmenti: `/docs/:path*` corrisponde a `/docs`,
  `/docs/start` e `/docs/a/b`. Lo slash finale nella richiesta viene ignorato e
  la corrispondenza fa distinzione tra maiuscole e minuscole (case-sensitive).
- **`to`** è un percorso sullo stesso indirizzo o un URL assoluto `http://` o `https://`.
  Ogni `:name` al suo interno viene sostituito con quanto catturato da `from`, nel suo percorso o
  nella query. I parametri nell'hostname di un URL vengono rifiutati.
- **`status`** è `301`, `302`, `307` o `308`. Se omesso, è `308`: permanente,
  e il metodo viene mantenuto.
- **`host`** limita il redirect alle richieste per un singolo hostname. Su un'app il cui
  `path` specifica un hostname, può essere solo quello.
- **`query`** lo limita alle richieste la cui query string contiene ciascun parametro
  esattamente con quel valore, confrontato dopo la decodifica. `""` corrisponde a un parametro
  presente senza valore (`?preview` o `?preview=`); non sono supportati caratteri jolly.

La query string della richiesta viene propagata a meno che `to` non ne abbia una propria. I
redirect vengono controllati nell'ordine in cui sono scritti, prima di qualsiasi file della
build, e risponde il primo che trova corrispondenza. Un percorso che una delle
[`routes`](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) dell'app invia a una funzione appartiene alla
funzione, e i percorsi del backend (`/api`, `/health` e gli altri) non vengono mai
reindirizzati. `rebase.json` viene rifiutato quando un redirect non potrebbe mai corrispondere (un
`from` all'esterno dell'app o sotto il percorso di un'altra app), quando due redirect corrispondono
alle stesse richieste, o quando un redirect invia una richiesta a un percorso a cui il suo stesso
`from` corrisponde di nuovo, generando un loop infinito.

## Reindirizzare un dominio verso un altro

<span class="since-badge" data-since="0.35">Da 0.35</span>

Un'app il cui unico scopo è un redirect invia il bare domain a `www`, mantenendo
percorso e query:

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

`root` e `output` indicano comunque una directory, che deve esistere per il deploy: mantieni
un file segnaposto al suo interno, come un `index.html`, poiché git non tiene traccia delle
directory vuote. Nessuna richiesta la raggiungerà. Su Rebase Cloud il deploy registra
`example.com` come l'hostname di qualsiasi app e stampa il record A richiesto dall'apex
del dominio. A differenza di [`rebase cloud domains redirect`](/docs/cli/cloud/), che
invia un dominio al dominio primario del progetto, un redirect può inviarlo
ovunque, e un dominio su cui è servita un'app non viene mai reindirizzato al primario.

## `cleanUrls`

Con `"cleanUrls": true`, `/privacidad` serve `privacidad.html` e
`/legal/terms` serve `legal/terms.html`. Una richiesta che specifica il file,
`/privacidad.html`, risponde con `308` verso `/privacidad`, mantenendo la query. Un file o una
directory con il nome esatto della richiesta viene servito per primo, quindi `/about` serve comunque
`about/index.html` quando esiste, e `/docs/index.html` risponde con `308` verso
`/docs/`. Senza questa opzione, `/privacidad` è un percorso senza file, a cui un
sito con `spa: false` risponde con un 404.

## Se provieni da Vercel

<span class="since-badge" data-since="0.35">Da 0.35</span>

`vercel.json`:

```json
{
  "cleanUrls": true,
  "redirects": [
    { "source": "/blog/:slug", "destination": "/posts/:slug", "permanent": true },
    { "source": "/:path*", "has": [{ "type": "host", "value": "example.com" }], "destination": "https://www.example.com/:path*" },
    { "source": "/", "has": [{ "type": "query", "key": "lang", "value": "es" }], "destination": "/es", "permanent": false }
  ]
}
```

diventa, sull'app statica in `rebase.json`:

```json
{
  "cleanUrls": true,
  "redirects": [
    { "from": "/blog/:slug", "to": "/posts/:slug" },
    { "from": "/:path*", "host": "example.com", "to": "https://www.example.com/:path*" },
    { "from": "/", "query": { "lang": "es" }, "to": "/es", "status": 307 }
  ]
}
```

| `vercel.json` | `rebase.json` |
| --- | --- |
| `source` | `from` |
| `destination` | `to` |
| `"permanent": true` | `"status": 308`, il valore predefinito |
| `"permanent": false` | `"status": 307` |
| `statusCode` | `status` |
| `has` di `"type": "host"` | `host` |
| `has` di `"type": "query"` con un `value` | `query` |
| `cleanUrls` | `cleanUrls` |

Un progetto Vercel per dominio diventa un'app statica per hostname, come in
[Reindirizzare un dominio verso un altro](#reindirizzare-un-dominio-verso-un-altro). Le condizioni su un
header o un cookie, e le espressioni regolari in `source`, sono logica: una
[route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) affida tale percorso a una
funzione, che può rispondere con qualsiasi redirect decida.

## Dove si applicano

Entrambi sono serviti dal runtime, a partire dal bundle generato, ovunque venga eseguito:
`rebase start`, un server self-hosted, e su Rebase Cloud ogni app statica che
`rebase cloud deploy` include nel bundle del backend. Sotto `rebase dev`, un'app
senza fase di build viene servita dal backend di sviluppo con entrambi. Un'app con una
build viene eseguita sul server di sviluppo di Vite, che non applica nessuno dei due; provali a
fronte di una build con `rebase start`. Un'app statica distribuita singolarmente su Rebase Cloud
(`rebase cloud deploy <app>`) viene servita dall'hosting statico, che non li applica
ancora, quindi tale deploy viene rifiutato; distribuisci il backend, che include l'app
al suo interno.

## Correlati

- [App e repository](/docs/architecture/apps-and-repositories/): le voci dell'app in `rebase.json` a cui appartengono questi campi e le due forme di `path`.
