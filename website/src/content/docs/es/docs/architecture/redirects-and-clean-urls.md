---
sourceHash: 8250c897b7861c24
title: Redirecciones y URLs limpias
sidebar_label: Redirecciones y URLs limpias
description: "Una aplicación estática en rebase.json puede responder solicitudes con redirecciones (coincidencia de :param al estilo Vercel, condiciones de host, host negado y consulta) y servir x.html en /x con cleanUrls."
---

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Una aplicación estática puede responder a ciertas solicitudes con una redirección en lugar de un archivo, y servir sus páginas HTML sin el `.html`:

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

<span class="since-badge" data-since="0.35">Desde 0.35</span>

- **`from`** es una ruta en la dirección de la aplicación, absoluta y dentro de su `path`. `:name` coincide con un segmento y `:name*`, como último segmento, coincide con el resto de la ruta, ninguno incluido: `/docs/:path*` coincide con `/docs`, `/docs/start` y `/docs/a/b`. Se ignora una barra final en la solicitud y la coincidencia distingue entre mayúsculas y minúsculas.
- **`to`** es una ruta en la misma dirección o una URL absoluta `http://` o `https://`. Cada `:name` en ella se reemplaza por lo que capturó `from`, en su ruta o consulta. Se rechaza un parámetro en el nombre de host de una URL.
- **`status`** es `301`, `302`, `307` o `308`. Si se omite, es `308`: permanente y se mantiene el método.
- **`host`** limita una redirección a solicitudes para un único nombre de host. En una aplicación cuyo `path` especifica un nombre de host, solo puede ser ese.
- **`notHost`** la limita a solicitudes para cualquier nombre de host salvo uno. No puede combinarse con `host`, y en una aplicación cuyo `path` especifica un nombre de host no puede ser ese, ya que la redirección nunca coincidiría.
- **`query`** la limita a solicitudes cuya cadena de consulta contenga cada parámetro exactamente con ese valor, comparado después de decodificar. `""` coincide con un parámetro presente sin valor (`?preview` o `?preview=`); no hay comodín.

La cadena de consulta de la solicitud se transfiere a menos que `to` tenga una propia. Las redirecciones se evalúan en el orden en que están escritas, antes de cualquier archivo de la compilación, y responde la primera que coincida. Una ruta que una de las [`routes`](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) de la aplicación envía a una función pertenece a la función, y las rutas del backend (`/api`, `/health` y el resto) nunca se redirigen. `rebase.json` se rechaza cuando una redirección nunca podría coincidir (un `from` fuera de la aplicación o bajo la ruta de otra aplicación), cuando dos redirecciones coinciden con las mismas solicitudes y cuando una redirección envía una solicitud a una ruta con la que su propio `from` vuelve a coincidir, lo que crearía un bucle infinito.

## Una ruta, una página distinta por nombre de host

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Una aplicación servida en varios nombres de host puede enviar la misma ruta a una página distinta en cada uno. Aquí `/` abre la aplicación en `app.example.com` y la demo en cualquier otro nombre de host:

```json
"redirects": [
  { "from": "/", "host": "app.example.com", "to": "/app.html", "status": 307 },
  { "from": "/", "notHost": "app.example.com", "to": "/demo.html", "status": 307 }
]
```

Sin `notHost`, la segunda redirección podría no tener ninguna condición: responde la primera que coincida, así que solo ve lo que la primera dejó pasar. `notHost` hace que cada redirección diga por sí sola dónde se aplica, como lo hace una condición `missing` de `vercel.json`, de modo que el orden deja de importar.

## Enviar un dominio a otro

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Una aplicación cuyo único propósito es una redirección envía el dominio raíz a `www`, conservando la ruta y la consulta:

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

`root` y `output` siguen indicando un directorio, el cual un despliegue necesita que exista: mantén un archivo marcador de posición en él, como un `index.html`, ya que git no conserva directorios vacíos. Ninguna solicitud llega a él. En Rebase Cloud, el despliegue registra `example.com` como el nombre de host de cualquier aplicación e imprime el registro A que necesita el apex del dominio. A diferencia de [`rebase cloud domains redirect`](/docs/cli/cloud/), que envía un dominio al dominio principal del proyecto, una redirección puede enviarlo a cualquier lugar, y un dominio en el que se sirve una aplicación nunca se redirige al principal.

## `cleanUrls`

Con `"cleanUrls": true`, `/privacidad` sirve `privacidad.html` y `/legal/terms` sirve `legal/terms.html`. Una solicitud que especifique el archivo, `/privacidad.html`, responde `308` hacia `/privacidad`, conservando la consulta. Primero se sirve un archivo o directorio con el nombre exacto de la solicitud, por lo que `/about` aún sirve `about/index.html` cuando este existe, y `/docs/index.html` responde `308` hacia `/docs/`. Sin esto, `/privacidad` es una ruta sin archivo, a la cual un sitio con `spa: false` responde con un 404.

## Si vienes de Vercel

<span class="since-badge" data-since="0.35">Desde 0.35</span>

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

se convierte, en la aplicación estática en `rebase.json`, en:

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
| `"permanent": true` | `"status": 308`, el valor predeterminado |
| `"permanent": false` | `"status": 307` |
| `statusCode` | `status` |
| `has` de `"type": "host"` | `host` |
| `has` de `"type": "query"` con un `value` | `query` |
| `missing` de `"type": "host"` | `notHost` |
| `cleanUrls` | `cleanUrls` |

Un proyecto de Vercel por dominio se convierte en una aplicación estática por nombre de host, como en [Enviar un dominio a otro](#enviar-un-dominio-a-otro). Las condiciones sobre un encabezado o una cookie, un parámetro de consulta `missing` y las expresiones regulares en `source`, son lógica: una [ruta](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) entrega dicha ruta a una función, que puede responder con cualquier redirección que decida.

## Dónde se aplican

Ambos son servidos por el runtime, desde el bundle compilado, dondequiera que se ejecute: `rebase start`, un servidor autohospedado, y en Rebase Cloud cada aplicación estática que `rebase cloud deploy` integra en el bundle del backend. Con `rebase dev`, el backend de desarrollo sirve una aplicación sin paso de compilación con ambos. Una aplicación con compilación se ejecuta en el servidor de desarrollo de Vite, que no aplica ninguno; pruébalos con una compilación usando `rebase start`. Una aplicación estática desplegada en Rebase Cloud por sí sola (`rebase cloud deploy <app>`) es servida por alojamiento estático, que aún no los aplica, por lo que ese despliegue es rechazado; despliega el backend, que integra la aplicación.

## Relacionado

- [Aplicaciones y repositorios](/docs/architecture/apps-and-repositories/): las entradas de aplicación de `rebase.json` a las que pertenecen estos campos, y las dos formas de `path`.
