---
title: Redirects and clean URLs
sidebar_label: Redirects & Clean URLs
description: "A static app in rebase.json can answer requests with redirects (Vercel-style :param matching, host, negated host and query conditions) and serve x.html at /x with cleanUrls."
---

<span class="since-badge" data-since="0.35">Since 0.35</span>

A static app can answer some requests with a redirect instead of a file, and
serve its HTML pages without the `.html`:

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

<span class="since-badge" data-since="0.35">Since 0.35</span>

- **`from`** is a path on the app's address, absolute and inside its `path`.
  `:name` matches one segment and `:name*`, as the last segment, matches the
  rest of the path, none included: `/docs/:path*` matches `/docs`,
  `/docs/start` and `/docs/a/b`. A trailing slash on the request is ignored, and
  matching is case-sensitive.
- **`to`** is a path on the same address or an absolute `http://` or `https://`
  URL. Every `:name` in it is replaced by what `from` captured, in its path or
  query. A parameter in a URL's hostname is refused.
- **`status`** is `301`, `302`, `307` or `308`. Left out, it is `308`: permanent,
  and the method is kept.
- **`host`** limits a redirect to requests for one hostname. On an app whose
  `path` names a hostname, it can only be that one.
- **`notHost`** limits it to requests for every hostname but one. It cannot be
  set with `host`, and on an app whose `path` names a hostname it cannot be
  that one, since the redirect would never match.
- **`query`** limits it to requests whose query string holds each parameter
  with exactly that value, compared after decoding. `""` matches a parameter
  present with no value (`?preview` or `?preview=`); there is no wildcard.

The request's query string is passed on unless `to` has one of its own. The
redirects are checked in the order they are written, before any file of the
build, and the first that matches answers. A path one of the app's
[`routes`](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) sends to a function is the
function's, and the backend's paths (`/api`, `/health` and the rest) are never
redirected. `rebase.json` is refused when a redirect could never match (a
`from` outside the app, or under another app's path), when two redirects match
the same requests, and when a redirect sends a request to a path its own
`from` matches again, which would loop forever.

## One path, a different page per hostname

<span class="since-badge" data-since="0.35">Since 0.35</span>

An app served on several hostnames can send the same path to a different page
on each. Here `/` opens the app on `app.example.com` and the demo on every other
hostname:

```json
"redirects": [
  { "from": "/", "host": "app.example.com", "to": "/app.html", "status": 307 },
  { "from": "/", "notHost": "app.example.com", "to": "/demo.html", "status": 307 }
]
```

Without `notHost`, the second redirect can have no condition at all: the first
match answers, so it only sees what the first one let through. `notHost` makes
each redirect say on its own where it applies, as a `vercel.json` `missing`
condition does, so the order no longer matters.

## Sending a domain to another

<span class="since-badge" data-since="0.35">Since 0.35</span>

An app whose only job is a redirect sends the bare domain to `www`, path and
query kept:

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

`root` and `output` still name a directory, which a deploy needs to exist: keep
one placeholder file in it, such as an `index.html`, since git keeps no empty
directory. No request reaches it. On Rebase Cloud the deploy registers
`example.com` like any app's hostname, and prints the A record the domain's
apex needs. Unlike [`rebase cloud domains redirect`](/docs/cli/cloud/), which
sends a domain to the project's primary domain, a redirect can send it
anywhere, and a domain an app is served on is never redirected to the primary.

## `cleanUrls`

With `"cleanUrls": true`, `/privacidad` serves `privacidad.html` and
`/legal/terms` serves `legal/terms.html`. A request that names the file,
`/privacidad.html`, answers `308` to `/privacidad`, query kept. A file or
directory of the request's exact name is served first, so `/about` still serves
`about/index.html` when that exists, and `/docs/index.html` answers `308` to
`/docs/`. Without it, `/privacidad` is a path with no file, which a `spa: false`
site answers with a 404.

## Coming from Vercel

<span class="since-badge" data-since="0.35">Since 0.35</span>

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

becomes, on the static app in `rebase.json`:

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
| `"permanent": true` | `"status": 308`, the default |
| `"permanent": false` | `"status": 307` |
| `statusCode` | `status` |
| `has` of `"type": "host"` | `host` |
| `has` of `"type": "query"` with a `value` | `query` |
| `missing` of `"type": "host"` | `notHost` |
| `cleanUrls` | `cleanUrls` |

A Vercel project per domain becomes a static app per hostname, as in
[Sending a domain to another](#sending-a-domain-to-another). Conditions on a
header or a cookie, a `missing` query parameter, and regular expressions in
`source`, are logic: a
[route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) hands such a path to a
function, which can answer with any redirect it decides on.

## Where they apply

Both are served by the runtime, from the built bundle, wherever it runs:
`rebase start`, a self-hosted server, and on Rebase Cloud every static app
`rebase cloud deploy` folds into the backend's bundle. Under `rebase dev`, an
app with no build step is served by the dev backend with both. An app with a
build runs on Vite's dev server, which applies neither; try them against a
build with `rebase start`. A static app deployed to Rebase Cloud on its own
(`rebase cloud deploy <app>`) is served by static hosting, which does not apply
them yet, so that deploy is refused; deploy the backend, which folds the app
in.

## Related

- [Apps and Repositories](/docs/architecture/apps-and-repositories/): the `rebase.json` app entries these fields belong to, and the two forms of `path`.
