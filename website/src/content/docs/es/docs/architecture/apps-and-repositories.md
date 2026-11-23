---
sourceHash: 2524bc9337abdb23
title: Aplicaciones y repositorios
sidebar_label: Apps y repositorios
description: Un proyecto es un backend más las aplicaciones que se comunican con él, las cuales pueden residir cada una en su propio repositorio.
---

## Proyectos y aplicaciones

Un **proyecto** es el backend: la base de datos, autenticación, almacenamiento, realtime y
funciones. Una **aplicación** es algo que se comunica con él.

| Tipo | Qué es |
| --- | --- |
| `backend` | Las tablas, hooks y funciones que definen la API. Exactamente uno por proyecto. |
| `static` | Un bundle cliente compilado — una SPA o sitio estático, servido en su propia ruta, o en su propio hostname. |

Esa es la lista completa. El panel de administración es una aplicación `static` como cualquier otra: se
compila en tu repositorio, con tus personalizaciones de `frontend/src/cms`, razón por la
cual los campos personalizados y las vistas personalizadas funcionan en él desde el primer día.

A quién pertenece el proceso del servidor es una propiedad del backend, no un tipo de aplicación
independiente:

| `runtime` | Qué significa |
| --- | --- |
| `managed` | La imagen de runtime de la plataforma ejecuta tu bundle. Tú proporcionas las tablas, funciones, tareas cron y el esquema. |
| `custom` | Tú proporcionas el servidor: tu propio Dockerfile y entrypoint. `rebase eject` configura esto. |

Esto es independiente de *dónde* se ejecuta. Ambos se ejecutan en Rebase Cloud y ambos se pueden
autoalojar — el destino reside en `.rebase/cloud.json`, no en el manifiesto.

La parte importante es quién es el *propietario* de la lista. Un repositorio declara únicamente las aplicaciones
que contiene; el proyecto es el propietario del conjunto de aplicaciones existentes. Dos repositorios nunca
necesitan conocerse entre sí — solo necesitan conocer el proyecto. Eso es lo que
hace que un repositorio frontend independiente, o una aplicación móvil sin ninguna relación de repositorio
en absoluto, sea algo común en lugar de un caso especial.

## `rebase.json`

El manifiesto declara la topología, y nada más. El esquema, las reglas de seguridad, los hooks
y las funciones permanecen en TypeScript, donde un sistema de tipos puede verificarlos.

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

Un solo proceso sirve todo: la API en `/api`, el sitio en `/`, la administración en
`/admin`. Esa es la propuesta de autoalojamiento, y un nivel pequeño perfectamente válido en
Rebase Cloud.

El `path` de una aplicación estática adopta una de dos formas:

| `path` | Dónde responde la aplicación |
| --- | --- |
| `"/"`, `"/admin"` | En esa ruta, en cada hostname en el que se sirve el proyecto. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Solo en ese hostname, en la ruta que le sigue. Consulta [Una aplicación en su propio hostname](#una-aplicación-en-su-propio-hostname). |

El formato de URL es cómo un proyecto con un sitio por dominio, como un proyecto de Vercel o
Netlify por dominio, se convierte en un único proyecto de Rebase: una aplicación estática por
hostname, todas servidas por el mismo despliegue.

## Indicar dónde está el CMS

`cms` es la ruta URL donde una aplicación monta `<RebaseCMS>`. Es opcional, es
el único campo aquí que describe lo que hay *dentro* de una aplicación en lugar de dónde reside
la aplicación, y existe porque nada más puede averiguarlo.

El CMS es un componente de React dentro de tu propio frontend, por lo que su dirección es una
ruta del lado del cliente. No es una ruta del servidor, no es un archivo en la compilación y no es
distinguible de cualquier otra ruta sin coincidencia bajo una SPA — una petición a
`/admin` obtiene el mismo `index.html` que una petición a `/cualquier-otra-cosa`. Por lo tanto, ningún
despliegue, ningún servidor en ejecución y ninguna cantidad de sondeo pueden determinar dónde está tu panel
de administración. Si no lo indicas por escrito, nada lo sabrá.

Lo que sí lo conoce, hace algo con ello:

- **Rebase Cloud** coloca un enlace *Open CMS* en la cabecera del proyecto y lista la
  dirección en la vista general del proyecto — en el propio hostname de la aplicación cuando
  tiene uno. Sin `cms`, la consola solo puede ofrecer el host del proyecto — el cual
  solo llega al CMS si este casualmente se encuentra en la raíz del mismo.
- **`rebase dev`** imprime la URL del CMS en su banner de inicio cuando no es
  simplemente la página de inicio del frontend.
- **`rebase apps list`** lo muestra junto a la aplicación que lo sirve.

Tres formas, y todas ellas son habituales.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

El valor es la ruta que escribirías después del hostname, no una ruta relativa
a `path`, y tiene que estar dentro de la aplicación que la declara — el fallback
de SPA de esa aplicación es lo que responde allí. Siempre es una ruta, incluso cuando el `path`
de la aplicación es una URL: el CMS se encuentra entonces en esa ruta sobre el hostname de la aplicación, por lo que `"cms": "/"`
arriba significa `https://admin.example.com/`. Un proyecto tiene un solo CMS; declarar un
segundo es un error en lugar de un volado para ver a cuál enlaza la consola.

`path` es una entrada de **tiempo de compilación** además de serlo para servir la aplicación. Una aplicación montada en
`/admin` debe ser *compilada* para `/admin`, o de lo contrario `index.html` se cargará y cada asset
dará un error 404 — una página en blanco sin ningún error visible. `rebase build` pasa el valor como
`REBASE_APP_BASE`, que tu empaquetador lee como su ruta base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

y se niega a enviar una compilación que lo haya ignorado.

Un proyecto existente no necesita uno. La CLI infiere la misma disposición a partir de la
estructura de directorios, y `rebase apps init` la escribe cuando deseas que sea
explícita:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

La inferencia no puede determinar dos cosas que declara el `rebase.json` de un scaffold. Nombra
a la aplicación estática `web`, donde un scaffold la nombra `admin`, y no puede conocer la
ruta `cms` de la aplicación. El nombre no cambia: Rebase Cloud registró `web` para
cada proyecto que se desplegó sin un `rebase.json`.
`rebase apps init --force` conserva los nombres, `path`, `cms`, `routes`,
`frameAncestors`, `redirects` y `cleanUrls` de las aplicaciones que declara el
archivo al que reemplaza, y nombra como eliminada a cualquier aplicación que ya no encuentre.

## Una aplicación en su propio hostname

`path` también puede ser una URL `https://` completa, lo que le da a la aplicación un hostname
propio:

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

`https://admin.example.com` sirve `admin`. Todos los demás hostnames en los que responde el
proyecto — `example.com`, o la propia dirección del proyecto en Rebase Cloud —
sirven `web`, y `admin` no es accesible allí en absoluto. Sigue siendo un solo
proceso y un solo despliegue; el hostname solo decide qué aplicación responde a una petición.

Dos reglas lo determinan:

- Una aplicación con un hostname responde únicamente en ese hostname. Una aplicación sin él
  responde en todos los hostnames.
- De las aplicaciones restantes, la que tenga la ruta más larga gana, como siempre lo ha hecho. Con una
  ruta igual, la aplicación que especifica el hostname gana sobre la que no lo hace.

En el ejemplo ambas aplicaciones están en `/`, por lo que en `admin.example.com` la segunda regla
elige `admin`. Si declaras admin en `"https://admin.example.com/cms"` en su lugar,
responderá únicamente bajo `/cms` en ese hostname: `admin.example.com/pricing`
irá a `web`. Un hostname restringe dónde responde una aplicación; no le entrega
a la aplicación todo lo que esté en ese hostname. Ninguna pareja de aplicaciones puede compartir tanto un hostname como una
ruta.

El backend no es una aplicación, y un hostname no lo reubica. `/api`, `/health`
y las demás rutas que reserva el backend se responden antes de consultar cualquier
aplicación, en cada hostname, por lo que `https://admin.example.com/api` es la misma
API que `https://example.com/api`. Una aplicación que llama a su propio origen — el
`VITE_API_URL` vacío del scaffold — no necesita una URL de API propia ni ninguna
configuración de CORS. Por la misma razón, esas rutas se rechazan después de un hostname tal como
se rechazan por sí solas: `https://admin.example.com/api` no es más válido que
`/api`.

Todo lo demás sobre `path` se aplica a la parte posterior al hostname. La aplicación
se sigue compilando para ella: `https://admin.example.com` se compila con
`REBASE_APP_BASE` establecido en `/`, `https://admin.example.com/cms` con `/cms/`, y
un empaquetador que lo ignore seguirá dándote una página en blanco. `cms` es una ruta en el
hostname de la aplicación, dentro de esa parte de la ruta. La URL debe ser `https://` y llevar un
hostname y una ruta y nada más — sin puerto, consulta ni fragmento. Se rechaza un
`admin.example.com` simple, indicando la URL que debió haber sido.

Bajo `rebase dev`, nada se enruta por hostname. Ejecuta la aplicación en
`frontend/` en la raíz de un puerto de localhost, como siempre lo ha hecho, y para una aplicación
con un hostname su banner también imprime la dirección `https://` que tendrá
una vez desplegada.

`rebase start` es diferente, porque ejecuta el bundle compilado a través del mismo
runtime que utiliza un despliegue — enrutamiento por hostname incluido. Una aplicación con un hostname
responde únicamente a peticiones cuyo `Host` sea ese hostname, por lo que
`http://localhost:3001/` muestra la aplicación sin él, y un bundle cuya única aplicación
especifica un hostname responde con un 404 allí. Para acceder a ella localmente, envía la cabecera
tú mismo:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

o apunta el hostname a `127.0.0.1` en `/etc/hosts` y abre
`http://admin.example.com:3001/`. Deliberadamente no existe ningún parámetro de consulta o
cabecera que anule el enrutamiento: uno que funcionara localmente también funcionaría
contra un despliegue, y elegir la aplicación mediante cualquier cosa que no sea el `Host` real
es lo que el enrutamiento existe para prevenir.

En modo autoalojado, el proceso toma la misma decisión a partir de la cabecera `Host`
de cada petición. Apuntar el hostname al servidor y proporcionarle un certificado te
corresponde a ti, al igual que para el hostname principal del proyecto, y un proxy inverso
al frente debe pasar el `Host` original — Caddy lo hace por defecto,
nginx necesita `proxy_set_header Host $host;`. `X-Forwarded-Host` no se lee,
porque cualquier cliente puede enviar uno.

### En Rebase Cloud

`rebase cloud deploy` registra el hostname en el proyecto — lo que hace
`rebase cloud domains add` —, por lo que no hay ningún paso independiente que olvidar. Lo que
sucede a continuación depende del DNS:

- **Los registros ya existen.** El despliegue verifica el hostname, y este queda
  activo cuando el despliegue finaliza.
- **No existen.** El despliegue continúa e imprime los dos registros que debes crear:
  un registro TXT que demuestra que el nombre es tuyo, y un CNAME que lo apunta al
  proyecto (un registro A, si el hostname es el apex del dominio).

Una vez publicados los registros:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` imprime los registros nuevamente si los pierdes. Un
hostname que no se verifique en un plazo de 7 días tras ser registrado se libera,
y el siguiente despliegue lo registra de nuevo. Cuando
la verificación tiene éxito, la plataforma emite el certificado HTTPS para el
hostname; no hay nada que subir. Hasta entonces, `admin` no responde en ningún lugar, dado que
el único hostname en el que responde aún no llega al proyecto — el resto
del proyecto está activo de cualquier modo.

La consola sigue a la aplicación hacia su hostname: el enlace *Open CMS* y la dirección
del CMS en la vista general del proyecto son `https://admin.example.com/`, no el
host del proyecto.

Un hostname que otro proyecto haya verificado hace fallar el despliegue antes de que nada
se implemente, y lo mismo ocurre con uno bajo el propio dominio de la plataforma. Uno que otro
proyecto registró y nunca verificó no se interpondrá en tu camino: el rechazo
te proporciona un registro TXT para tu proyecto, y una vez que exista, el siguiente despliegue (o
`rebase cloud domains add`) tomará el hostname. Agregar un hostname
que el proyecto aún no tiene modifica los dominios del proyecto, algo que un token de acceso
creado con `--can deploy` no puede hacer: desde CI, agrega el hostname una vez con
`rebase cloud domains add` mientras tengas la sesión iniciada, y el token lo desplegará
como cualquier hostname que ya esté en el proyecto. Quitar la aplicación
de `rebase.json` deja el hostname registrado en el proyecto; elimínalo con
`rebase cloud domains remove admin.example.com`.

### Un hostname pertenece a una aplicación, no a una ruta

Un hostname se asigna a una aplicación completa. No puede apuntar a una ruta dentro de una. Cuando
el CMS es una ruta de una sola SPA — `web` en `/` con `"cms": "/admin"` — reside
en `/admin`, en cada hostname en el que responda el proyecto. Asignarle a esa aplicación
`https://admin.example.com` movería toda la SPA allí, con el CMS aún
en `/admin` debajo de ella. Para darle al CMS un hostname propio, conviértelo en una aplicación
independiente, con su propia compilación, como en el ejemplo anterior.

## Servir una función en una ruta de una aplicación

Una función personalizada responde en `/api/functions/<name>`, y una aplicación estática no puede
reclamar `/api`. Un sitio de publicaciones necesita algunas rutas que ninguna compilación puede albergar — un
sitemap y un feed que listen las últimas publicaciones, una página renderizada desde la
base de datos. `routes` sirve la respuesta de una función en una ruta en la propia
dirección de la aplicación:

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

`https://www.example.com/sitemap.xml` es entonces lo que devuelva `functions/sitemap.ts`,
con su propio `Content-Type`, estado y cabeceras. Todo lo demás en
el hostname es la compilación del sitio, como antes.

- **Exacta o comodín.** `/sitemap.xml` coincide únicamente con esa ruta. `/blog/*`
  coincide con `/blog` y con cada ruta debajo de ella, y le entrega el resto a la función:
  `/blog/hello` llega a la ruta `/:slug` de la función con `slug` establecido en
  `hello`, y `/blog` llega a su ruta `/`.
- **La función ve una llamada ordinaria.** La petición le llega como si se hubiera
  realizado a `/api/functions/<name>`, pasando por la misma autenticación, comprobaciones de alcance,
  límite de peticiones y tiempo de espera. Su método, cabeceras, cuerpo y cadena de consulta se transmiten
  directamente, y también el `Host`, por lo que `new URL(c.req.url).origin` es el origen
  del sitio — a partir del cual se construyen las URLs absolutas de un sitemap. La función sigue
  respondiendo también en `/api/functions/<name>`.
- **La ruta más específica gana**: una ruta exacta antes que cualquier comodín, y un
  comodín más largo antes que uno más corto. Una ruta también gana sobre un archivo con la
  misma ruta en la compilación, por lo que un `public/sitemap.xml` obsoleto no puede ocultarla.
- **Solo donde la aplicación responde.** Una ruta se aplica a peticiones a las que la aplicación misma
  respondería — en su hostname, si tiene uno, y no bajo la ruta de otra aplicación.
  `rebase.json` se rechaza cuando una ruta se ubica donde responde otra aplicación.
- **Dentro de la aplicación, y nunca de las del backend.** La ruta de una ruta es absoluta,
  dentro del `path` de la aplicación, y no puede estar bajo `/api`, `/health`, `/healthz`,
  `/livez`, `/readyz` o `/metrics`, ni tener un segmento que comience con `.`. Un
  comodín no puede cubrir toda la aplicación, ya que dejaría su compilación sin ser servida.

Las rutas son servidas por el proceso de backend en el que se integra la aplicación, porque
allí es donde se ejecutan las funciones: `rebase build` y `rebase cloud deploy` integran cada
aplicación estática en el bundle del backend, y la compilación falla si una ruta nombra una
función que el backend no tiene. Una aplicación estática desplegada por su cuenta no tiene
funciones a las que llamar, por lo que `rebase cloud deploy` rechaza una con rutas, y el
runtime se niega a iniciar un bundle solo estático que las declare.

Una respuesta enrutada que no envía ningún `Content-Security-Policy` obtiene el de la propia aplicación,
por lo que los orígenes en sus [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app)
pueden incrustar en un marco una página renderizada por el servidor tal como pueden incrustar el resto del sitio.

Bajo `rebase dev` la aplicación es servida por su propio servidor de desarrollo, que no sabe
nada de las rutas; llama a la función en `/api/functions/<name>` allí, o prueba las
rutas contra una compilación con `rebase start`.

## Redirecciones y URLs limpias

Una aplicación estática acepta `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`,
incluso hacia otro dominio) y `cleanUrls: true` (`/x` sirve `x.html`). Consulta
[Redirects and clean URLs](/docs/architecture/redirects-and-clean-urls/), que
también mapea un `vercel.json` a `rebase.json`.

## App Links, Universal Links y otros archivos `/.well-known`

Los App Links de Android y los Universal Links de iOS se verifican obteniendo un archivo del
origen del sitio: `https://<host>/.well-known/assetlinks.json` y
`https://<host>/.well-known/apple-app-site-association`. Hasta que una plataforma pueda
obtenerlo, un enlace tocado o escaneado se abre en el navegador en lugar de en la
aplicación instalada. Coloca los archivos en la carpeta `.well-known/` de la compilación (con Vite,
`public/.well-known/`) y la aplicación en `/` los servirá:

```text
site/dist/
  index.html
  .well-known/
    assetlinks.json
    apple-app-site-association
```

- **Un archivo o un 404.** `/.well-known/<name>` responde con ese archivo de la
  compilación, o 404 cuando la compilación no tiene ninguno, nunca con el `index.html` de la aplicación y nunca
  con una redirección. Los archivos que terminan en `.json` y el archivo sin extensión
  `apple-app-site-association` se envían como `application/json`; otros según su
  extensión (`security.txt` como `text/plain`). Cada uno lleva un `ETag` y
  `Cache-Control: no-cache`.
- **Los documentos del backend ganan.** `jwks.json`, `oauth-protected-resource`,
  `oauth-authorization-server`, `openid-configuration` y `acme-challenge/`
  nunca se sirven desde una compilación, incluso en un proceso donde el backend no los
  sirve por sí mismo, por lo que una compilación no puede publicar claves de firma o metadatos de OAuth.
- **Ningún otro archivo con punto.** Un segmento que comience con `.` debajo de `.well-known`
  (`/.well-known/.secret`), y cualquier otra ruta con punto (`/.env`, `/.git/config`),
  siguen siendo rechazados, estén codificados o no, y un archivo que sea un enlace simbólico fuera de la
  compilación no se sirve.
- **Solo la aplicación en `/`.** `/.well-known` pertenece al origen, por lo que una aplicación
  bajo una ruta (`/admin`) no publica nada desde su carpeta `.well-known/`. Con
  [aplicaciones en sus propios hostnames](#una-aplicación-en-su-propio-hostname), la aplicación de cada hostname en `/` sirve los
  suyos, de modo que `admin.example.com` y `www.example.com` pueden
  publicar archivos diferentes.

Los archivos son servidos por el proceso de backend en el que se integra la aplicación
(`rebase start`, un despliegue autoalojado o en Cloud), al igual que el resto de la compilación.
La ruta de una route no puede estar bajo `/.well-known`; para generar uno de estos
documentos, escríbelo en la compilación.

## Compilar y desplegar aplicaciones

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

El backend se compila primero, porque la compilación de una aplicación cliente puede consumir un SDK
generado a partir de sus tablas.

## Múltiples repositorios

El monorepo sigue siendo la opción predeterminada: un repositorio con un backend y un panel de administración
es lo más simple que funciona, y `rebase init` genera su estructura inicial. Dividirlo es
el paso de graduación, no un requisito.

En un repositorio de frontend independiente necesitas dos cosas: un manifiesto que declare
lo que aporta este repositorio y un enlace al proyecto:

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

El enlace se escribe en `.rebase/cloud.json` y **no se confirma en el repositorio** — es
específico de cada checkout, como un control remoto de git. El manifiesto sí se confirma; el enlace no.

## Clientes tipados sin las tablas

Este es el mecanismo que hace que el esquema multirepositorio funcione. Un repositorio que no contiene
tablas genera su SDK tipado a partir del propio proyecto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI obtiene `/api/meta/contract` y lee sus `tables` — los descriptores
compilados, incluidos los destinos de relación, que el generador de tipos necesita para
decidir si una clave foránea es una cadena o un número — y emite exactamente la
misma salida que habría producido a partir del código fuente local.

El endpoint de contrato necesita el alcance `schema:read`, que posee un administrador. Este
describe cada tabla,
columna y relación en el proyecto, incluidas aquellas que ninguna regla de seguridad
expondría jamás; ese es un mapa de la base de datos, no documentación pública de la API.

## Detección de desfases (drift)

Dividir repositorios tiene un costo digno de mención: un cambio de esquema y el
frontend que lo utiliza ya no aterrizan en el mismo commit. El backend puede desplegar un
cambio que deje desamparado a un cliente compilado según la estructura anterior.

Cada SDK generado registra el esquema del que proviene:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Y cada proyecto publica el suyo actual, sin autenticación, porque una
marca de versión no revela nada sobre el esquema que representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.35.1","contract":1}}
```

Comparar ambos en CI convierte un desajuste silencioso en una verificación fallida. La marca
cambia cuando los tipos generados podrían cambiar — una nueva propiedad, una
relación modificada — y deliberadamente *no* cuando cambia un hook, una regla de seguridad o un icono,
para evitar falsas alarmas.

## Configuración del cliente

```bash
rebase apps config web
```

Imprime lo que un cliente necesita para conectarse al proyecto. Nunca imprime un secreto: la
URL de la API y la identidad publicable de una aplicación están pensadas para enviarse dentro de un
bundle de cliente, y cualquier cosa que no sea segura allí no pertenece a una salida que
terminará en un `.env` versionado.

## Contenido relacionado

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — qué produce `rebase build` y qué lo inicia
- [Split Processes](/docs/deployment/split-processes/) — ejecutar un bundle como varios procesos
- [CLI Commands](/docs/cli/) — `rebase apps` y el resto
