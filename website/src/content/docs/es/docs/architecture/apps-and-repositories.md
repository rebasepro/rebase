---
sourceHash: 4ad669042dfd8fc9
title: Aplicaciones y repositorios
sidebar_label: Apps y repositorios
description: Un proyecto es un backend más las aplicaciones que se comunican con él, las cuales pueden residir cada una en su propio repositorio.
---

## Proyectos y aplicaciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un **proyecto** es el backend: la base de datos, auth, almacenamiento, tiempo real y
funciones. Una **aplicación** (app) es algo que se comunica con él.

| Tipo | Qué es |
| --- | --- |
| `backend` | Las tablas, hooks y funciones que definen la API. Exactamente uno por proyecto. |
| `static` | Un bundle de cliente compilado: una SPA o sitio estático, servido en su propia ruta o en su propio hostname. |

Esa es la lista completa. El panel de administración es una aplicación `static` como cualquier otra: se compila en tu repositorio, con tus personalizaciones en `frontend/src/cms`, razón por la cual los campos personalizados y las vistas personalizadas funcionan en él desde el primer día.

Quién posee el proceso del servidor es una propiedad del backend, no un tipo de aplicación independiente:

| `runtime` | Qué significa |
| --- | --- |
| `managed` | La imagen de runtime de la plataforma ejecuta tu bundle. Tú proporcionas tablas, funciones, crons y el esquema. |
| `custom` | Tú proporcionas el servidor: tu propio Dockerfile y entrypoint. `rebase eject` configura esto. |

Esto es independiente de *dónde* se ejecuta. Ambos se ejecutan en Rebase Cloud y ambos se pueden autohospedar (self-host); el destino reside en `.rebase/cloud.json`, no en el manifiesto.

La parte importante es quién *posee* la lista. Un repositorio declara únicamente las aplicaciones que contiene; el proyecto posee el conjunto de aplicaciones que existen. Dos repositorios nunca necesitan saber el uno del otro; solo necesitan conocer el proyecto. Eso es lo que hace que un repositorio frontend independiente, o una aplicación móvil sin ninguna relación de repositorio, sea algo común en lugar de un caso especial.

## `rebase.json`

El manifiesto declara la topología, y nada más. El esquema, las reglas de seguridad, los hooks y las funciones permanecen en TypeScript, donde un sistema de tipos puede verificarlos.

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

Un solo proceso lo sirve todo: la API en `/api`, el sitio en `/`, el admin en `/admin`. Esa es la historia del autohospedaje, y un nivel pequeño perfectamente válido en Rebase Cloud.

## Indicar dónde está el CMS

`cms` es la ruta URL donde una aplicación monta `<RebaseCMS>`. Es opcional, es el único campo aquí que describe lo que hay *dentro* de una aplicación en lugar de dónde reside la aplicación, y existe porque nada más puede averiguarlo.

El CMS es un componente de React en tu propio frontend, por lo que su dirección es una ruta del lado del cliente. No es una ruta del servidor, ni un archivo en la compilación, y no es distinguible de cualquier otra ruta no coincidente bajo una SPA: una petición a `/admin` obtiene el mismo `index.html` que una petición a `/anything-else`. Así que ningún despliegue, ningún servidor en ejecución ni ninguna cantidad de sondeos puede saber dónde está tu panel de administración. Si no lo indicas por escrito, nada lo sabe.

Lo que lo conoce, hace algo con ello:

- **Rebase Cloud** coloca un enlace *Open CMS* en la cabecera del proyecto y muestra la dirección en la vista general del proyecto; en el hostname propio de la aplicación cuando tiene uno. Sin `cms`, la consola solo puede ofrecer el host del proyecto, que solo llega al CMS si este casualmente se encuentra en la raíz del mismo.
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

El valor es la ruta que escribirías después del hostname, no una ruta relativa a `path`, y tiene que estar dentro de la aplicación que lo declara; el fallback de SPA de esa aplicación es lo que responde allí. Siempre es una ruta, incluso cuando el `path` de la aplicación es una URL: el CMS se encuentra entonces en esa ruta en el hostname de la aplicación, por lo que `"cms": "/"` arriba significa `https://admin.example.com/`. Un proyecto tiene un solo CMS; declarar un segundo es un error en lugar de lanzar una moneda al aire para ver a cuál enlaza la consola.

`path` es una entrada de **tiempo de compilación** además de servir contenido. Una aplicación montada en `/admin` debe ser *compilada* para `/admin`, o de lo contrario `index.html` cargará y cada asset dará un error 404: una página en blanco sin ningún error visible. `rebase build` pasa el valor como `REBASE_APP_BASE`, que tu empaquetador lee como su ruta base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

y se niega a enviar una compilación que lo haya ignorado.

Un proyecto existente no necesita uno. La CLI infiere la misma estructura a partir del diseño de directorios, y `rebase apps init` lo deja por escrito cuando lo deseas explícito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

La inferencia no puede saber dos cosas que declara el `rebase.json` de un scaffold. Nombra a la aplicación estática `web`, donde un scaffold la nombra `admin`, y no puede conocer la ruta `cms` de la aplicación. El nombre no cambia: Rebase Cloud registró `web` para cada proyecto que se desplegó sin un `rebase.json`.
`rebase apps init --force` conserva los nombres, `path` y `cms` de las aplicaciones que declara el archivo que reemplaza, y marca como eliminada cualquier aplicación que ya no encuentre.

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

`https://admin.example.com` sirve `admin`. Cualquier otro hostname en el que responda el proyecto (como `example.com` o la propia dirección del proyecto en Rebase Cloud) sirve `web`, y `admin` no es accesible en ellos en absoluto. Sigue siendo un solo proceso y un solo despliegue; el hostname solo decide qué aplicación responde a una petición.

Dos reglas lo deciden:

- Una aplicación con un hostname responde únicamente en ese hostname. Una aplicación sin él responde en todos los hostnames.
- De las aplicaciones restantes, gana la que tenga la ruta más larga, como siempre ha sido. Con rutas iguales, la aplicación que especifica el hostname gana sobre la que no lo hace.

En el ejemplo, ambas aplicaciones están en `/`, por lo que en `admin.example.com` la segunda regla elige `admin`. Si en su lugar declaras el admin en `"https://admin.example.com/cms"`, solo responderá bajo `/cms` en ese hostname: `admin.example.com/pricing` irá a `web`. Un hostname restringe dónde responde una aplicación; no le entrega a la aplicación todo en ese hostname. Ningún par de aplicaciones puede compartir tanto un hostname como una ruta.

El backend no es una aplicación, y un hostname no lo mueve. `/api`, `/health` y las demás rutas que reserva el backend se responden antes de consultar cualquier aplicación, en todos los hostnames, por lo que `https://admin.example.com/api` es la misma API que `https://example.com/api`. Una aplicación que llama a su propio origen (el `VITE_API_URL` vacío del scaffold) no necesita una URL de API propia ni configuración de CORS. Por la misma razón, esas rutas se rechazan después de un hostname tal como se rechazan por sí solas: `https://admin.example.com/api` no es más válido que `/api`.

Todo lo demás sobre `path` se aplica a la parte posterior al hostname. La aplicación todavía se compila para ello: `https://admin.example.com` se compila con `REBASE_APP_BASE` establecido en `/`, `https://admin.example.com/cms` con `/cms/`, y un empaquetador que lo ignore seguirá dándote una página en blanco. `cms` es una ruta en el hostname de la aplicación, dentro de esa parte de la ruta. La URL debe ser `https://` y llevar un hostname y una ruta y nada más: sin puerto, consulta ni fragmento. Un `admin.example.com` simple se rechaza, indicando la URL que debería haber sido.

Bajo `rebase dev`, nada se enruta por hostname. Ejecuta la aplicación en `frontend/` en la raíz de un puerto de localhost, como siempre lo ha hecho, y para una aplicación con un hostname, su banner también imprime la dirección `https://` que tendrá una vez desplegada.

`rebase start` es diferente, porque ejecuta el bundle compilado a través del mismo runtime que utiliza un despliegue, incluyendo el enrutamiento por hostname. Una aplicación con un hostname solo responde a peticiones cuyo `Host` sea ese hostname, por lo que `http://localhost:3001/` muestra la aplicación sin ninguno, y un bundle cuya única aplicación nombra un hostname responde con un 404 allí. Para acceder a ella localmente, envía la cabecera tú mismo:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

o apunta el hostname a `127.0.0.1` en `/etc/hosts` y abre `http://admin.example.com:3001/`. Deliberadamente no hay ningún parámetro de consulta o cabecera que sobrescriba el enrutamiento: uno que funcionara localmente también funcionaría contra un despliegue, y elegir la aplicación por cualquier cosa que no sea el `Host` real es precisamente lo que el enrutamiento busca prevenir.

En autohospedaje, el proceso toma la misma decisión a partir de la cabecera `Host` de cada petición. Apuntar el hostname al servidor y proporcionarle un certificado es responsabilidad tuya, al igual que con el hostname principal del proyecto, y un proxy inverso delante debe pasar el `Host` original: Caddy lo hace por defecto, nginx necesita `proxy_set_header Host $host;`. `X-Forwarded-Host` no se lee, porque cualquier cliente puede enviar uno.

### En Rebase Cloud

`rebase cloud deploy` registra el hostname en el proyecto —lo que hace `rebase cloud domains add`—, por lo que no hay ningún paso separado que olvidar. Lo que sucede a continuación depende del DNS:

- **Los registros ya existen.** El despliegue verifica el hostname y este queda activo cuando termina el despliegue.
- **No existen.** El despliegue continúa e imprime los dos registros a crear: un registro TXT que demuestra que el nombre es tuyo, y un CNAME que lo apunta al proyecto (un registro A, si el hostname es el apex del dominio).

Una vez que los registros estén publicados:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` imprime los registros nuevamente si los pierdes. Un hostname que no se verifique en un plazo de 7 días tras su registro se libera, y el siguiente despliegue lo vuelve a registrar. Cuando se supera la verificación, la plataforma emite el certificado HTTPS para el hostname; no hay nada que subir. Hasta entonces, `admin` no responde en ninguna parte, ya que el único hostname en el que responde aún no llega al proyecto; el resto del proyecto sigue activo de todos modos.

La consola sigue a la aplicación hacia su hostname: el enlace *Open CMS* y la dirección del CMS en la vista general del proyecto son `https://admin.example.com/`, no el host del proyecto.

Un hostname que otro proyecto haya verificado hace que el despliegue falle antes de que se distribuya nada, y lo mismo ocurre con uno bajo el dominio propio de la plataforma. Uno que otro proyecto registró y nunca verificó no se interpone en tu camino: el rechazo te proporciona un registro TXT para tu proyecto, y una vez que exista, el siguiente despliegue (o `rebase cloud domains add`) toma el hostname. Añadir un hostname que el proyecto aún no tiene modifica los dominios del proyecto, algo que un token de acceso creado con `--can deploy` no puede hacer: desde CI, añade el hostname una vez con `rebase cloud domains add` habiendo iniciado sesión, y luego el token lo desplegará como cualquier hostname que ya esté en el proyecto. Quitar la aplicación de `rebase.json` deja el hostname registrado en el proyecto; elimínalo con `rebase cloud domains remove admin.example.com`.

### Un hostname pertenece a una aplicación, no a una ruta

Un hostname se asigna a una aplicación completa. No puede apuntar a una ruta dentro de una. Cuando el CMS es una ruta de una sola SPA —`web` en `/` con `"cms": "/admin"`—, vive en `/admin`, en todos los hostnames en los que responde el proyecto. Asignar `https://admin.example.com` a esa aplicación movería toda la SPA allí, con el CMS todavía en `/admin` dentro de ella. Para darle al CMS un hostname propio, conviértelo en una aplicación independiente, con su propia compilación, como en el ejemplo anterior.

## Compilación y despliegue de aplicaciones

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

El backend se compila primero, ya que la compilación de una aplicación cliente puede consumir un SDK generado a partir de sus tablas.

## Múltiples repositorios

El monorepositorio sigue siendo el valor predeterminado: un repositorio con un backend y un panel de administración es lo más sencillo que funciona, y `rebase init` lo inicializa. Dividirlo es el paso de graduación, no un requisito.

En un repositorio frontend independiente necesitas dos cosas: un manifiesto que declare lo que este repositorio aporta, y un enlace al proyecto:

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

El enlace se escribe en `.rebase/cloud.json` y **no se incluye en el control de versiones** (no se hace commit): es por clon/checkout, como un git remote. El manifiesto se commitea; el enlace no.

## Clientes tipados sin las tablas

Este es el mecanismo que hace que el enfoque multi-repo funcione. Un repositorio que no contiene tablas genera su SDK tipado a partir del propio proyecto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI consulta `/api/meta/contract` y lee sus `tables` —los descriptores compilados, incluidos los destinos de relación, que el generador de tipos necesita para decidir si una clave foránea es una cadena o un número— y emite exactamente la misma salida que habría producido a partir del código fuente local.

El endpoint de contrato necesita el scope `schema:read`, el cual posee un admin. Describe cada tabla, columna y relación en el proyecto, incluidas aquellas que ninguna regla de seguridad expondría jamás; ese es un mapa de la base de datos, no documentación de API pública.

## Detectar desfases

Dividir los repositorios te cuesta una cosa que vale la pena mencionar: un cambio de esquema y el frontend que lo utiliza ya no aterrizan en el mismo commit. El backend puede desplegar un cambio que deje desamparado a un cliente compilado contra la forma anterior.

Cada SDK generado registra el esquema del que proviene:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Y cada proyecto publica el suyo actual, sin autenticación, porque una marca de versión no revela nada sobre el esquema que representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.30.1","contract":1}}
```

Comparar los dos en CI convierte una discrepancia silenciosa en una comprobación fallida. La marca cambia cuando los tipos generados podrían cambiar (una nueva propiedad, una relación modificada) y deliberadamente *no* cuando cambia un hook, una regla de seguridad o un icono, para no dar falsas alarmas.

## Configuración del cliente

```bash
rebase apps config web
```

Imprime lo que un cliente necesita para comunicarse con el proyecto. Nunca imprime un secreto: la URL de la API y la identidad publicable de una aplicación están pensadas para enviarse dentro de un bundle de cliente, y cualquier cosa que no sea segura allí no pertenece a una salida que terminará en un `.env` commiteado.

## Relacionado

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — qué produce `rebase build` y qué lo inicia
- [Split Processes](/docs/deployment/split-processes/) — ejecutar un bundle como varios procesos
- [CLI Commands](/docs/cli/) — `rebase apps` y el resto
