---
sourceHash: 145ba18b6f108fbd
title: Despliegue
sidebar_label: Despliegue
description: Despliega tu proyecto Rebase en producción utilizando Docker, plataformas en la nube o configuraciones manuales.
---

## Qué sirve un despliegue

Un proyecto de Rebase se despliega como **un único servidor** (en Rebase Cloud: `https://<project>.rebase.website`). Ese servidor gestiona:

- **`/api/*`**: la API de datos, autenticación, tiempo real y almacenamiento
- **todo lo demás**: tu `frontend/` compilado como una SPA estática

No existe un servicio de administración independiente: el panel de administración forma parte del frontend, por lo que el lugar donde aparece depende de cuál sea tu frontend y de si le asignas un nombre de host propio.

| Tipo de proyecto | La URL raíz muestra | El panel de administración está en |
|------------------|---------------------|------------------------------------|
| Estructura predeterminada (`rebase init`) | El panel de administración | `/`: el frontend **es** el panel de administración |
| Frontend de producto personalizado | Tu aplicación | Dondequiera que lo montes, comúnmente `/admin`; consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Administración como una app con su propio nombre de host | Tu aplicación | `https://admin.example.com/`, servido por el mismo servidor; consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Proyecto solo de backend | Nada (solo API) | No desplegado |

:::note[Primera visita]
Un nuevo despliegue de **producción** no ofrece una pantalla de inicialización (bootstrap), y su primer registro es una cuenta ordinaria. En su lugar, define el administrador antes del primer arranque; consulta [Tu primer administrador](#tu-primer-administrador).
:::

## Docker Compose (Recomendado)

El proyecto generado ya incluye un `docker-compose.yml` funcional; **ese archivo es el que se debe usar para un proyecto generado con la plantilla**, tal cual, en lugar de escribirlo a mano o copiarlo de otra parte. `rebase init` completó sus secretos, su primera cuenta de administrador y su versión de runtime fijada, y el propio control de aceptación (acceptance gate) del framework lo arranca en cada push. Ejecuta **dos** contenedores: Postgres y el runtime publicado de Rebase con tu bundle compilado montado en él. No hay que compilar ninguna imagen de la aplicación.

[Autohospedaje](/docs/deployment/self-hosting) cubre el mismo despliegue sin un scaffold previo, utilizando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) del repositorio de Rebase, y las dos cosas que este archivo omite deliberadamente: un pooler de conexiones y la ejecución de funciones y del job worker como procesos propios.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

`rebase build` primero, siempre: el servicio `api` monta `./dist-bundle`, y sin él el contenedor se inicia sobre un directorio vacío.

La estructura del archivo generado:

```yaml title="docker-compose.yml (generated — abridged)"
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase_app -d rebase"]

  api:
    # The published runtime. Upgrading Rebase is a tag change, not a rebuild.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://rebase_app:${DATABASE_PASSWORD:-changeme}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY:?set REBASE_SERVICE_KEY in .env}
      CORS_ORIGINS: ${CORS_ORIGINS:?set CORS_ORIGINS in .env}
      # This service runs in production, where the first account to register is
      # not promoted to admin. So the admin is named instead.
      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?set REBASE_ADMIN_EMAIL in .env}
      REBASE_ADMIN_PASSWORD: ${REBASE_ADMIN_PASSWORD:?set REBASE_ADMIN_PASSWORD in .env}
      DISABLE_SELF_REGISTRATION: ${DISABLE_SELF_REGISTRATION:-true}
    volumes:
      # Your built project, from `rebase build`. Read-only: the build vendors
      # the bundle's dependencies by default, so nothing has to write here.
      - ./dist-bundle:/bundle:ro

volumes:
  postgres_data:
```

Consulta [Tu primer administrador](#tu-primer-administrador) más abajo para ver las tres líneas de `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

El bundle se monta en modo de solo lectura. `rebase build` instala las dependencias declaradas del proyecto en `dist-bundle` a menos que pases `--no-vendor`, en cuyo caso el runtime las instala en cada inicio y el montaje debe tener permisos de escritura (elimina el `:ro`). Consulta [Autohospedaje](/docs/deployment/self-hosting/#dependencies).

`rebase init` escribe todo esto en `.env` por ti, incluida una contraseña de administrador generada. Cada una se declara con `${VAR:?…}`, por lo que si falta alguna, el stack se detiene con un mensaje que indica cuál es, en lugar de arrancar algo medio configurado; además, Compose interpola todo el archivo antes de seleccionar los servicios, por lo que una variable faltante detendrá también `docker compose up -d db`.

Cambia el correo del administrador por el tuyo, inicia sesión y cambia la contraseña. Consulta [Tu primer administrador](#tu-primer-administrador).

### El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El runtime crea las tablas que faltan durante el arranque, **incluidas las que declara `backend/schema`**: `REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, el cual es aditivo en todo el esquema y aplica la seguridad a nivel de fila (RLS) junto con él. Un primer `docker compose up` contra una base de datos vacía se iniciará sirviendo tus tablas.

Lo que el arranque nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue. Esos cambios se realizan a través de la CLI, desde un clon del repositorio o un trabajo de CI apuntando a la base de datos de producción:

```bash
pnpm run db:push
```

Ejecútalo para cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restrictivo, un campo eliminado.

Para un **flujo de trabajo en equipo y versionado**, haz commit de los archivos de migración con `pnpm run db:generate` y ejecuta `pnpm run db:migrate` como un paso de la release. De cualquier forma, se ejecuta desde un checkout del proyecto, no dentro del contenedor en ejecución: la imagen del runtime viene sin la CLI.

## Tu primer administrador

**Establece `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` antes del primer arranque.** Todas las guías de plataformas en este sitio apuntan a esto, porque este es el único paso que no tiene recuperación desde el exterior.

Una base de datos limpia no tiene usuarios, y fuera de producción la política de registro admite el primer registro y lo asciende a administrador. Tiene que ser así: la inicialización (bootstrapping) de un administrador requiere un invocador que ya haya iniciado sesión, por lo que una base de datos vacía sin dicha regla sería un callejón sin salida. En una laptop, la persona frente al teclado es el operador, y eso es exactamente lo correcto.

Pero es completamente incorrecto en un host con un nombre público. Los artefactos distribuidos levantan DNS y TLS antes de que el operador haya escrito nada, por lo que la ventana queda abierta a internet desde el primer segundo, y quien llegue primero al formulario de registro se apropia del despliegue.

Por lo tanto, bajo `NODE_ENV=production`, esa ventana está cerrada. Una tabla de usuarios vacía rechaza el registro de inicialización con `SETUP_REQUIRED`, una cuenta creada mediante registro abierto es una cuenta ordinaria, `GET /api/auth/config` nunca anuncia `needsSetup`, y `POST /api/admin/bootstrap` rechaza la solicitud.

`rebase dev` lee el mismo `.env` e ignora deliberadamente ambas variables, y así lo indica al arrancar: localmente, el primer registro sigue siendo la forma de entrar. Los valores que escribió `rebase init` pertenecen al arranque en producción. Hacer seeding en ambos lados agotaría la ventana antes de que el desarrollador hubiera abierto la aplicación, lo que causaba que el primer paso del propio quickstart generara una cuenta sin rol.

Eso deja dos formas de entrar, ninguna de las cuales es una carrera:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

El runtime crea esa cuenta una sola vez, mientras la tabla de usuarios esté vacía, y no hace nada en los arranques posteriores. O asigna el rol a un usuario existente mediante la clave de servicio (service key), si aprovisionas cuentas fuera de banda.

Dos reglas que el runtime aplica al arrancar, las cuales producen una cuenta que nadie puede usar si se configuran mal:

- La contraseña debe tener **al menos 12 caracteres**, o será rechazada y no se creará ninguna cuenta.
- La dirección debe ser aceptada por `POST /api/auth/login`; este analiza su cuerpo con `z.string().email()`, por lo que un dominio sin punto (`admin@localhost`) se inserta sin problema pero luego responde 400 en cada inicio de sesión. El arranque también rechaza esa dirección.

Define ambos o ninguno: media credencial es un error tipográfico, y el despliegue que produce (autorregistro desactivado, sin administrador) requerirá una terminal de `psql` para recuperarse. El arranque advierte cuando la tabla está vacía en producción y no se indica ningún administrador.

Inicia sesión y cambia la contraseña. Está en texto plano dondequiera que hayas puesto tu entorno.

## Lista de verificación para producción

Antes de desplegar en producción, asegúrate de:

| Elemento | Detalles |
|----------|----------|
| **Primer administrador** | Define `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` **antes del primer arranque**, y `DISABLE_SELF_REGISTRATION=true`. En producción, la primera cuenta que se registra no es promovida; consulta [Tu primer administrador](#tu-primer-administrador). |
| **NODE_ENV** | `NODE_ENV=production`. Es lo que cierra la ventana de bootstrap, rechaza el almacenamiento de archivos local, requiere `CORS_ORIGINS` y desactiva la documentación de OpenAPI. Un despliegue dejado en el valor predeterminado se ejecuta en modo de desarrollo. |
| **Esquema de la base de datos** | El arranque crea las tablas declaradas y su RLS de forma aditiva. Ejecuta `pnpm run db:push` (o `pnpm run db:migrate`) para cualquier cambio que no sea puramente aditivo. |
| **JWT_SECRET** | Usa una cadena aleatoria criptográficamente segura (≥ 32 caracteres). Nunca la reutilices entre entornos. |
| **DATABASE_URL** | Usa una instancia gestionada de Postgres (Neon, Supabase, RDS) con TLS habilitado |
| **CORS_ORIGINS** | Siempre, no solo cuando el frontend está en otro dominio. El runtime se niega a iniciar en producción si no tiene ni `CORS_ORIGINS` ni `FRONTEND_URL`, porque una API que intenta adivinar sus orígenes permitidos tarde o temprano permitirá el incorrecto. |
| **Control de acceso al almacenamiento** | Un bucket configurado **se niega a arrancar en producción** sin un modelo de control de acceso. El almacenamiento no está bajo seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que un valor predeterminado que permita todo facilita que cualquier usuario autenticado liste (`GET /storage/list?prefix=`) y luego lea, sobrescriba o elimine los archivos de cualquier otro usuario. Cumple con esto mediante un hook `storageAuthorize` o `storagePolicies` (el scaffold incluye un hook en `backend/storage.ts`), o declara la intención con `STORAGE_PUBLIC_READ` para una CDN verdaderamente pública, o `STORAGE_ALLOW_ANY_AUTHENTICATED` para una app de inquilino único (single-tenant) donde se confía en que cada cuenta acceda a cualquier archivo. |
| **Backend de almacenamiento** | `STORAGE_TYPE=local` en producción se **descarta**, y las subidas responden con `501 STORAGE_NOT_CONFIGURED`: el sistema de archivos del contenedor se destruye en el siguiente reinicio, por lo que un backend local implica una pérdida silenciosa de datos. Usa `s3` o `gcs`, o establece `FORCE_LOCAL_STORAGE=true` si la ruta realmente es un volumen persistente. |
| **MFA_ENCRYPTION_KEY** | Configúralo (32+ caracteres aleatorios) si usas TOTP. Si no se establece, los secretos almacenados se cifran con `JWT_SECRET`, por lo que rotarlo cerrará la sesión de todos *y además* hará que cualquier autenticador registrado sea indescifrable. |
| **HTTPS** | Termina TLS en tu proxy inverso (nginx, Cloudflare, balanceador de carga) |
| **Las lecturas públicas aún necesitan un invocador** | `access: "public"` amplía qué *filas* ve un invocador, no quién puede llamar: una solicitud anónima a `/api/data/*` responde 401 mientras `AUTH_REQUIRE` esté activado. Establece `AUTH_REQUIRE=false` para un sitio público que lee su propio backend, y deja que solo RLS decida. Es una variable de entorno, por lo que un `.env` local que la configure **no** viaja con tu despliegue. |

## Módulos nativos en el runtime gestionado

El runtime gestionado de Rebase Cloud ejecuta tu bundle dentro de una imagen compartida. No tiene compilador ni forma de cargar un **módulo nativo** (cualquier cosa que incluya un binario `.node` precompilado). El más común con diferencia es `sharp`, que también es la dependencia obvia para cualquier cosa que sirva imágenes.

`rebase cloud deploy` rechaza esto antes de la subida en lugar de después:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tres formas de resolverlo, en el orden en que suelen ser más adecuadas:

1. **Mover el trabajo al momento de compilación.** Redimensiona y recodifica las imágenes en tu paso de compilación (build) y despliega los resultados. Nada nativo se ejecuta en la ruta de la solicitud.
2. **Usar un servicio.** Una CDN de imágenes o una API de transformación realiza el mismo trabajo detrás de una URL.
3. **Ejecutar tu propio contenedor.** Un despliegue autohospedado (Docker, Kubernetes, cualquiera de las [guías de plataformas](/docs/deployment/self-hosting)) es tu propia imagen, por lo que puede incluir lo que quieras.

Las funciones que simplemente necesitan Node en lugar de un binario nativo funcionan sin problemas; el despliegue las informa por separado (`1 of 3 function(s) depend on Node`) y las ejecuta. [Runtime de backend gestionado](/docs/deployment/managed-runtime/) cubre el resto de lo que permite el runtime gestionado: binarios, memoria, tiempos de espera (timeouts), el sistema de archivos, secretos, almacenamiento y red saliente.

## Servir el frontend

En producción, el backend puede servir el frontend como una SPA estática:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compila el frontend primero:

```bash
cd frontend && pnpm build
```

De esta manera, solo necesitas desplegar un servidor que gestione tanto la SPA como la API.

## Guías de despliegue por plataforma

Guías detalladas paso a paso para cada plataforma:

| Plataforma | Tipo | Guía |
|------------|------|------|
| **AWS** | App Runner / ECS + RDS | [Desplegar en AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Desplegar en GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Desplegar en Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Desplegar en Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Desplegar en Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-detect Dockerfile) | [Desplegar en Railway →](/docs/deployment/railway) |
| **Fly.io** | Container runtime | [Desplegar en Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL in one pod, no Docker | [Desplegar en InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + Managed PostgreSQL, or a VPS | [Desplegar en Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run y otras plataformas serverless son sin estado (stateless). Usa **almacenamiento S3** en lugar del sistema de archivos local para la subida de archivos, y establece `--min-instances 1` si utilizas las funciones en tiempo real de Rebase (las conexiones WebSocket se terminan cuando las instancias reducen su escala a cero).
:::


## Cambiar la URL base

Si deseas que el panel de administración se ejecute en una subruta (p. ej. `/admin`), cambia el `path` de la app en `rebase.json`, y su `cms` con él:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin",
    "cms": "/admin"
}
```

`cms` es donde se encuentra el CMS, al cual enlaza Rebase Cloud, y debe estar dentro del `path` de la aplicación. El scaffold configura ambos en `/`, por lo que cambiar solo `path` será rechazado: el CMS estaría en `/`, fuera de una aplicación que ahora comienza en `/admin`.

Para darle al panel de administración un nombre de host propio en lugar de una subruta, define `path` como una URL completa —`"path": "https://admin.example.com"`— y deja `cms` en `"/"`. El administrador responderá únicamente en ese nombre de host y no en la dirección propia del proyecto, por lo que será inaccesible hasta que se verifique el DNS del nombre de host. La API también se mantendrá en `/api` en ese nombre de host. Consulta [Una app con su propio nombre de host](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) para saber cómo se emparejan las solicitudes y qué hace un despliegue de Rebase Cloud con el nombre de host.

`rebase build` pasa `path` a Vite como `base` (mediante `REBASE_APP_BASE`), Vite lo devuelve como `import.meta.env.BASE_URL`, y el archivo `main.tsx` del scaffold ya lo pasa al enrutador; de esta forma, los recursos (assets), las rutas y el servidor coinciden sin tener que escribir el prefijo tres veces:

```tsx title="frontend/src/main.tsx"
// At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });
```

Mantén el panel de administración en un **enrutador de datos (data router)**: `createBrowserRouter` con `<RouterProvider>`, tal como lo hace el scaffold. Con él, un registro con cambios sin guardar también detiene la navegación dentro de la app (un enlace en el menú lateral, el botón atrás del navegador) y pregunta primero mediante `useBlocker`, algo que solo proporciona un data router.

El panel de administración también funciona con un `<BrowserRouter>` convencional. Allí, la protección de cambios no guardados recurre al aviso propio del navegador para abandonar la página, el cual cubre una recarga, cerrar la pestaña o escribir una URL; pero navegar dentro de la app continuará sin preguntar.

**Backend**: si trasladas también la API, actualiza su ruta base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaje sin un `basename` en el enrutador]
El enfoque con `basename` mencionado arriba es el recomendado: react-router elimina el prefijo de la ubicación, por lo que el panel de administración funciona sin cambios. Si, en cambio, incrustas el panel de administración dentro de una **ruta con prefijo de ruta** de una aplicación más grande (p. ej. `<Route path="/admin/*">`) sin `basename`, la ruta actual conserva su prefijo `/admin`. Notifícalo al CMS para que la resolución URL⇄tabla tome en cuenta el prefijo; de lo contrario, las vistas se quedarán bloqueadas en un spinner de carga sin obtener datos:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Configura **o bien** el `basename` del enrutador **o bien** el `basePath` de `RebaseCMS`, pero no ambos, o el prefijo se aplicará dos veces.
:::

### App de producto + Administración en un solo despliegue

El motivo habitual para mover el panel de administración a `/admin` es publicar tu **propia aplicación de producto** en la raíz del mismo despliegue. Una sola entrada de Vite puede servir a ambas, divididas por URL, de modo que cada app se carga bajo demanda (lazy-loaded) y los visitantes del producto nunca descargan el bundle de administración:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

Un enrutador para ambas partes: es preferible que la administración esté en un data router, lo que permite que los cambios no guardados detengan la navegación interna, y no hay razón para que la aplicación de producto use uno diferente.

El backend no necesita cambios para este patrón: la API se mantiene en `/api` y la regla comodín (catch-all) de la SPA sirve `index.html` tanto para `/` como para `/admin/*`.

## Siguientes pasos

- **[Descripción general del backend](/docs/backend)**: configuración completa del backend
- **[Configuración de almacenamiento](/docs/backend/storage)**: configuración de S3 para producción
