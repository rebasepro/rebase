---
sourceHash: e3293eb3c0e15be1
title: Aplicaciones y repositorios
sidebar_label: Aplicaciones y repositorios
description: Un proyecto es un backend más las aplicaciones que se comunican con él, cada una de las cuales puede residir en su propio repositorio.
---

## Proyectos y aplicaciones

Un **proyecto** es el backend: la base de datos, la autenticación, el almacenamiento, el tiempo real y las funciones. Una **aplicación** es algo que se comunica con él.

| Tipo | Qué es |
| --- | --- |
| `backend` | Las tablas, hooks y funciones que definen la API. Exactamente uno por proyecto. |
| `static` | Un bundle de cliente compilado: una SPA o sitio estático, servido en su propia ruta o en su propio hostname. |

Esa es toda la lista. El panel de administración es una aplicación `static` como cualquier otra: se compila en tu repositorio, con tus personalizaciones en `frontend/src/cms`, razón por la cual los campos y vistas personalizados funcionan en él desde el primer día.

Quién es el propietario del proceso del servidor es una propiedad del backend, no un tipo de aplicación independiente:

| `runtime` | Qué significa |
| --- | --- |
| `managed` | La imagen de runtime de la plataforma ejecuta tu bundle. Tú proporcionas tablas, funciones, crons y el esquema. |
| `custom` | Tú proporcionas el servidor: tu propio Dockerfile y entrypoint. `rebase eject` configura esto. |

Esto es independiente de *dónde* se ejecuta. Ambos se ejecutan en Rebase Cloud y ambos admiten self-hosting: el destino reside en `.rebase/cloud.json`, no en el manifiesto.

La parte importante es quién es el *propietario* de la lista. Un repositorio declara únicamente las aplicaciones que contiene; el proyecto es el propietario del conjunto de aplicaciones existentes. Dos repositorios nunca necesitan conocerse entre sí; solo necesitan conocer el proyecto. Eso es lo que hace que un repositorio de frontend independiente, o una aplicación móvil sin ninguna relación de repositorio, sea algo común en lugar de un caso especial.

## `rebase.json`

El manifiesto declara la topología, y nada más. El esquema, las reglas de seguridad, los hooks y las funciones se mantienen en TypeScript, donde un sistema de tipos puede verificarlos.

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

Un solo proceso sirve todo: la API en `/api`, el sitio en `/`, el admin en `/admin`. Esa es la historia de self-hosting, y un nivel pequeño perfectamente válido en Rebase Cloud.

El `path` de una aplicación estática adopta una de dos formas:

| `path` | Dónde responde la aplicación |
| --- | --- |
| `"/"`, `"/admin"` | En esa ruta, en cada hostname en el que se sirva el proyecto. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Solo en ese hostname, en la ruta posterior. Consulta [Una aplicación en su propio hostname](#una-aplicación-en-su-propio-hostname). |

La forma de URL es cómo un proyecto con un sitio por dominio, como un proyecto de Vercel o Netlify por dominio, se convierte en un solo proyecto de Rebase: una aplicación estática por hostname, todas servidas por el mismo despliegue.

## Indicar dónde está el CMS

`cms` es la ruta URL donde una aplicación monta `<RebaseCMS>`. Es opcional, es el único campo aquí que describe lo que hay *dentro* de una aplicación en lugar de dónde reside la aplicación, y existe porque nada más puede averiguarlo.

El CMS es un componente de React en tu propio frontend, por lo que su dirección es una ruta del lado del cliente. No es una ruta del servidor, no es un archivo en la compilación y no se distingue de cualquier otra ruta no coincidente bajo una SPA; una solicitud a `/admin` obtiene el mismo `index.html` que una solicitud a `/anything-else`. Por lo tanto, ningún despliegue, ningún servidor en ejecución y ninguna cantidad de sondeo pueden determinar dónde está tu panel de administración. Si no lo indicas, nada lo sabrá.

Lo que lo conoce, hace algo con ello:

- **Rebase Cloud** coloca un enlace *Open CMS* en el encabezado del proyecto y muestra la dirección en la vista general del proyecto, en el propio hostname de la aplicación cuando tiene uno. Sin `cms`, la consola solo puede ofrecer el host del proyecto, el cual solo llega al CMS si este casualmente se encuentra en la raíz del mismo.
- **`rebase dev`** imprime la URL del CMS en su banner de inicio cuando no es simplemente la página de inicio del frontend.
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

El valor es la ruta que escribirías después del hostname, no una ruta relativa a `path`, y debe estar dentro de la aplicación que lo declara; el fallback de SPA de esa aplicación es lo que responde allí. Siempre es una ruta, incluso cuando el `path` de la aplicación es una URL: el CMS se encuentra entonces en esa ruta en el hostname de la aplicación, por lo que `"cms": "/"` arriba significa `https://admin.example.com/`. Un proyecto tiene un solo CMS; declarar un segundo es un error en lugar de un sorteo sobre a cuál enlaza la consola.

`path` es un parámetro tanto de **tiempo de compilación** (build-time) como de servicio. Una aplicación montada en `/admin` debe ser *compilada* para `/admin`, o de lo contrario `index.html` se carga y cada asset devuelve un 404: una página en blanco sin ningún error en ninguna parte. `rebase build` pasa el valor como `REBASE_APP_BASE`, que tu empaquetador lee como su ruta base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

y se niega a enviar una compilación que lo haya ignorado.

Un proyecto existente no necesita uno. La CLI infiere la misma disposición a partir de la estructura de directorios, y `rebase apps init` lo escribe cuando deseas que sea explícito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

La inferencia no puede conocer dos cosas que declara el `rebase.json` de un scaffold. Nombra la aplicación estática como `web`, donde un scaffold la nombra `admin`, y no puede conocer la ruta `cms` de la aplicación. El nombre no cambia: Rebase Cloud registró `web` para cada proyecto que se desplegó sin un `rebase.json`. `rebase apps init --force` conserva los nombres, `path`, `cms`, `routes`, `frameAncestors`, <span class="since-badge" data-since="0.35">Desde 0.35</span> `redirects` y `cleanUrls` de las aplicaciones que declara el archivo al que reemplaza, y marca como eliminada una aplicación que ya no encuentra.

## Una aplicación en su propio hostname

`path` también puede ser una URL completa con `https://`, lo que le da a la aplicación un hostname propio:

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

`https://admin.example.com` sirve `admin`. Cualquier otro hostname en el que responda el proyecto —`example.com` o la propia dirección del proyecto en Rebase Cloud— sirve `web`, y `admin` no es accesible en ellos en absoluto. Sigue siendo un solo proceso y un solo despliegue; el hostname solo decide qué aplicación responde a una solicitud.

Dos reglas lo deciden:

- Una aplicación con un hostname responde únicamente en ese hostname. Una aplicación sin él responde en todos los hostnames.
- De las aplicaciones restantes, gana la que tenga la ruta más larga, como siempre ha sido. Con la misma ruta, la aplicación que especifica el hostname gana sobre la que no lo hace.

En el ejemplo, ambas aplicaciones están en `/`, por lo que en `admin.example.com` la segunda regla elige `admin`. Si declaras el admin en `"https://admin.example.com/cms"`, responderá únicamente bajo `/cms` en ese hostname: `admin.example.com/pricing` irá a `web`. Un hostname restringe dónde responde una aplicación; no le entrega a la aplicación todo lo que haya en ese hostname. Ningún par de aplicaciones puede compartir a la vez el mismo hostname y la misma ruta.

El backend no es una aplicación, y un hostname no lo mueve. `/api`, `/health` y las demás rutas que reserva el backend se responden antes de consultar cualquier aplicación, en cada hostname, por lo que `https://admin.example.com/api` es la misma API que `https://example.com/api`. Una aplicación que llama a su propio origen —el `VITE_API_URL` vacío del scaffold— no necesita una URL de API propia ni configuración de CORS. Por la misma razón, esas rutas se rechazan después de un hostname tal como se rechazan por sí solas: `https://admin.example.com/api` no es más válido que `/api`.

Todo lo demás sobre `path` se aplica a la parte posterior al hostname. La aplicación todavía se compila para ello: `https://admin.example.com` se compila con `REBASE_APP_BASE` establecido en `/`, `https://admin.example.com/cms` con `/cms/`, y un empaquetador que lo ignore te seguirá dando una página en blanco. `cms` es una ruta en el hostname de la aplicación, dentro de esa parte de la ruta. La URL debe ser `https://` y contener un hostname y una ruta y nada más: sin puerto, consulta ni fragmento. Se rechaza un `admin.example.com` a secas, indicando la URL que debería haber sido.

Bajo `rebase dev`, nada se enruta por hostname. Ejecuta la aplicación en `frontend/` en la raíz de un puerto localhost, como siempre lo ha hecho, y para una aplicación con un hostname, su banner también imprime la dirección `https://` que tendrá una vez desplegada.

`rebase start` es diferente, porque ejecuta el bundle compilado a través del mismo runtime que un despliegue, incluyendo el enrutamiento por hostname. Una aplicación con un hostname responde solo a solicitudes cuyo encabezado `Host` sea ese hostname, por lo que `http://localhost:3001/` muestra la aplicación sin hostname, y un bundle cuya única aplicación nombra un hostname responderá 404 allí. Para acceder a ella localmente, envía el encabezado tú mismo:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

o apunta el hostname a `127.0.0.1` en `/etc/hosts` y abre `http://admin.example.com:3001/`. Deliberadamente no existe ningún parámetro de consulta o encabezado que anule el enrutamiento: uno que funcionara localmente también funcionaría contra un despliegue, y elegir la aplicación mediante cualquier cosa que no sea el `Host` real es precisamente lo que el enrutamiento existe para prevenir.

En self-hosting, el proceso toma la misma decisión a partir del encabezado `Host` de cada solicitud. Apuntar el hostname al servidor y proporcionarle un certificado es responsabilidad tuya, al igual que lo son para el hostname principal del proyecto, y un proxy inverso delante debe reenviar el `Host` original (Caddy lo hace por defecto, nginx necesita `proxy_set_header Host $host;`). `X-Forwarded-Host` no se lee, porque cualquier cliente puede enviar uno.

### En Rebase Cloud

`rebase cloud deploy` registra el hostname en el proyecto —lo que hace `rebase cloud domains add`— por lo que no hay ningún paso adicional que olvidar. Lo que sucede a continuación depende del DNS:

- **Los registros ya existen.** El despliegue verifica el hostname y queda activo cuando finaliza el despliegue.
- **No existen.** El despliegue continúa e imprime los dos registros que se deben crear: un registro TXT que demuestra que el nombre es tuyo y un CNAME que lo apunta al proyecto (un registro A, si el hostname es el apex del dominio).

Una vez que los registros estén publicados:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` vuelve a imprimir los registros si los pierdes. Un hostname que no se verifique dentro de los 7 días posteriores a su registro se libera, y el siguiente despliegue lo vuelve a registrar. Cuando se aprueba la verificación, la plataforma emite el certificado HTTPS para el hostname; no hay nada que subir. Hasta entonces, `admin` no responderá en ninguna parte, ya que el único hostname en el que responde aún no llega al proyecto; el resto del proyecto está activo de cualquier modo.

La consola sigue a la aplicación hasta su hostname: el enlace *Open CMS* y la dirección del CMS en la vista general del proyecto son `https://admin.example.com/`, no el host del proyecto.

Un hostname que otro proyecto haya verificado hace que el despliegue falle antes de lanzar nada, y lo mismo ocurre con uno bajo el propio dominio de la plataforma. Uno que otro proyecto haya registrado y nunca verificado no se interpondrá en tu camino: el rechazo te proporciona un registro TXT para tu proyecto, y una vez que exista, el siguiente despliegue (o `rebase cloud domains add`) tomará el hostname. Agregar un hostname que el proyecto aún no tiene modifica los dominios del proyecto, algo que un token de acceso creado con `--can deploy` no puede hacer: desde CI, agrega el hostname una vez con `rebase cloud domains add` mientras tengas la sesión iniciada, y el token luego lo desplegará como cualquier hostname que ya esté en el proyecto. Quitar la aplicación de `rebase.json` deja el hostname registrado en el proyecto; elimínalo con `rebase cloud domains remove admin.example.com`.

### Un hostname pertenece a una aplicación, no a una ruta

Un hostname se asigna a una aplicación completa. No puede apuntar a una ruta dentro de ella. Cuando el CMS es una ruta de una sola SPA —`web` en `/` con `"cms": "/admin"`—, reside en `/admin`, en cada hostname en el que responda el proyecto. Darle a esa aplicación `https://admin.example.com` movería toda la SPA allí, con el CMS aún en `/admin` dentro de ella. Para darle al CMS un hostname propio, conviértelo en una aplicación propia, con su propia compilación, como en el ejemplo anterior.

## Servir una función en una ruta de una aplicación

Una función personalizada responde en `/api/functions/<name>`, y una aplicación estática no puede reclamar `/api`. Un sitio de publicaciones necesita algunas rutas que ninguna compilación puede contener: un sitemap y un feed que listen las últimas publicaciones, una página renderizada desde la base de datos. `routes` sirve la respuesta de una función en una ruta dentro de la propia dirección de la aplicación:

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

`https://www.example.com/sitemap.xml` es entonces lo que sea que devuelva `functions/sitemap.ts`, con su propio `Content-Type`, código de estado y encabezados. Todo lo demás en el hostname es la compilación del sitio, como antes.

- **Exacto o comodín.** `/sitemap.xml` coincide únicamente con esa ruta. `/blog/*` coincide con `/blog` y con todas las rutas por debajo de ella, y le entrega el resto a la función: `/blog/hello` llega a la ruta `/:slug` de la función con `slug` establecido en `hello`, y `/blog` llega a su ruta `/`.
- **La función ve una llamada ordinaria.** La solicitud le llega como si se hubiera realizado a `/api/functions/<name>`, a través de la misma autenticación, comprobaciones de permisos, límite de velocidad y tiempo de espera. Su método, encabezados, cuerpo y query string se transmiten, al igual que el `Host`, por lo que `new URL(c.req.url).origin` es el origen del sitio, a partir del cual se construyen las URL absolutas de un sitemap. La función también sigue respondiendo en `/api/functions/<name>`.
- **La ruta más específica gana**: una ruta exacta antes que cualquier comodín, y un comodín más largo antes que uno más corto. Una ruta también prevalece sobre un archivo con la misma ruta en la compilación, por lo que un `public/sitemap.xml` obsoleto no puede ocultarla.
- **Solo donde responde la aplicación.** Una ruta se aplica a las solicitudes que la propia aplicación respondería: en su hostname, si tiene uno, y no bajo la ruta de otra aplicación. Se rechaza `rebase.json` si una ruta se ubica donde responde otra aplicación.
- **Dentro de la aplicación, y nunca en la del backend.** La ruta de una route es absoluta, dentro del `path` de la aplicación, y no puede estar bajo `/api`, `/health`, `/healthz`, `/livez`, `/readyz` ni `/metrics`, ni tener un segmento que comience con `.`. Un comodín no puede cubrir toda la aplicación, ya que dejaría su compilación sin servir.

Las rutas son servidas por el proceso de backend en el que se integra la aplicación, porque allí es donde se ejecutan las funciones: `rebase build` y `rebase cloud deploy` integran cada aplicación estática en el bundle del backend, y la compilación falla si una ruta hace referencia a una función que el backend no tiene. Una aplicación estática desplegada por su cuenta no tiene funciones a las que llamar, por lo que `rebase cloud deploy` rechaza una con rutas, y el runtime se niega a iniciar un bundle solo estático que las declare.

Una respuesta enrutada que no envíe `Content-Security-Policy` recibe la de la propia aplicación, de modo que los orígenes en sus [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app) pueden incrustar una página renderizada en el servidor del mismo modo que pueden incrustar el resto del sitio.

Bajo `rebase dev`, la aplicación es servida por su propio servidor de desarrollo, el cual no sabe nada de las rutas; llama a la función en `/api/functions/<name>` allí, o prueba las rutas contra una compilación con `rebase start`.

## Redirecciones y URL limpias

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Una aplicación estática acepta `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`, incluso hacia otro dominio) y `cleanUrls: true` (`/x` sirve `x.html`). Consulta [Redirecciones y URL limpias](/docs/architecture/redirects-and-clean-urls/), que también asigna un `vercel.json` a `rebase.json`.

## Compilar y desplegar aplicaciones

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

El backend se compila primero, ya que la compilación de una aplicación cliente puede consumir un SDK generado a partir de sus tablas.

## Múltiples repositorios

El monorepo sigue siendo la opción predeterminada: un repositorio con un backend y un panel de administración es lo más simple que funciona, y `rebase init` genera su estructura inicial. Dividirlo es un paso de avance opcional, no un requisito.

En un repositorio de frontend independiente necesitas dos cosas: un manifiesto que declare lo que aporta este repositorio y un enlace al proyecto:

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

El enlace se escribe en `.rebase/cloud.json` y **no se incluye en los commits**; es por copia local, como un git remote. El manifiesto sí se incluye en los commits; el enlace no.

## Clientes con tipado sin las tablas

Este es el mecanismo que hace que el esquema multirrepositorio funcione. Un repositorio que no contiene tablas genera su SDK tipado a partir del propio proyecto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI obtiene `/api/meta/contract` y lee sus `tables` —los descriptores compilados, incluidos los destinos de relaciones, que el generador de tipos necesita para decidir si una clave foránea es una cadena o un número— y emite exactamente la misma salida que habría producido a partir del código fuente local.

El endpoint de contrato necesita el scope `schema:read`, el cual posee un administrador. Describe cada tabla, columna y relación del proyecto, incluidas aquellas que ninguna regla de seguridad expondría jamás; se trata de un mapa de la base de datos, no de documentación pública de la API.

## Detectar desviaciones (drift)

Dividir los repositorios tiene un costo que vale la pena mencionar: un cambio de esquema y el frontend que lo utiliza ya no se entregan en el mismo commit. El backend puede desplegar un cambio que deje incomunicado o desactualizado a un cliente compilado con la estructura anterior.

Cada SDK generado registra el esquema del que proviene:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Y cada proyecto publica el suyo actual, sin autenticación, porque un sello de versión no revela nada sobre el esquema que representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.34.2","contract":1}}
```

Comparar ambos en CI convierte una discrepancia silenciosa en una comprobación fallida. El sello cambia cuando los tipos generados podrían cambiar —una nueva propiedad, una relación modificada— y deliberadamente *no* cuando cambia un hook, una regla de seguridad o un icono, para evitar falsas alarmas.

## Configuración del cliente

```bash
rebase apps config web
```

Imprime lo que un cliente necesita para conectarse al proyecto. Nunca imprime un secreto: la URL de la API y la identidad publicable de una aplicación están destinadas a distribuirse dentro del bundle del cliente, y cualquier cosa que no sea segura allí no debe figurar en una salida que terminará en un `.env` versionado en git.

## Relacionado

- [Runtime y bundles](/docs/architecture/runtime-and-bundles/) — lo que produce `rebase build` y lo que lo inicializa
- [Procesos divididos](/docs/deployment/split-processes/) — ejecutar un solo bundle como varios procesos
- [Comandos de la CLI](/docs/cli/) — `rebase apps` y el resto
