---
sourceHash: 54382ae26efa26ea
title: Despliegue
sidebar_label: Despliegue
description: Despliega tu proyecto Rebase en producción usando Docker, plataformas en la nube o configuraciones manuales.
---

## Qué sirve un despliegue

Un proyecto de Rebase se despliega como **un único servidor** (en Rebase Cloud: `https://<project>.rebase.website`). Ese servidor gestiona:

- **`/api/*`** — la API de datos, autenticación, tiempo real y almacenamiento
- **todo lo demás** — tu `frontend/` compilado como una SPA estática

No hay un servicio de administración independiente: el panel de administración forma parte de un frontend, por lo que el lugar donde aparece depende de cuál sea tu frontend y de si le asignas un nombre de host propio.

| Tipo de proyecto | La URL raíz muestra | El panel de administración está en |
|------------------|---------------------|-----------------------------------|
| Estructura predeterminada (`rebase init`) | El panel de administración | `/` — el frontend **es** la administración |
| Frontend de producto personalizado | Tu aplicación | Donde sea que lo montes, comúnmente `/admin` — consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Administración como una aplicación en su propio nombre de host | Tu aplicación | `https://admin.example.com/`, servido por el mismo servidor — consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Proyecto solo de backend | Nada (solo API) | No desplegado |

:::note[Primera visita]
Un despliegue nuevo en **producción** no ofrece una pantalla de inicialización, y su primer registro es una cuenta ordinaria. En su lugar, define al administrador antes del primer arranque — consulta [Tu primer administrador](#tu-primer-administrador).
:::

## Docker Compose (Recomendado)

El proyecto generado ya incluye un `docker-compose.yml` funcional — **ese
archivo es el que se debe usar para un proyecto generado con scaffolding**, tal como está,
en lugar de escribirlo a mano o copiarlo de otra parte. `rebase init` completó sus secretos, su
primera cuenta de administrador y su versión fija de runtime, y el propio control de aceptación
del framework lo arranca en cada push. Ejecuta **dos** contenedores:
Postgres y el runtime publicado de Rebase con tu bundle compilado montado en
él. No hay ninguna imagen de aplicación que compilar.

[Autohospedaje](/docs/deployment/self-hosting) cubre el mismo despliegue sin
un scaffolding detrás, usando
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
del repositorio de Rebase — y las dos cosas que este archivo omite deliberadamente:
un agrupador de conexiones (connection pooler) y la ejecución de funciones y el worker de tareas como
procesos independientes.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

`rebase build` primero, siempre: el servicio `api` monta `./dist-bundle`, y
sin él, el contenedor se inicia contra un directorio vacío.

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

Consulta [Tu primer administrador](#tu-primer-administrador) a continuación para conocer las tres líneas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

El bundle se monta en modo de solo lectura. `rebase build` instala las dependencias declaradas
del proyecto en `dist-bundle` a menos que pases `--no-vendor`, en cuyo caso el
runtime las instala en cada inicio y el montaje debe tener permisos de escritura — elimina
el `:ro`. Consulta [Autohospedaje](/docs/deployment/self-hosting/#dependencies).

`rebase init` escribe todo esto en `.env` por ti, incluyendo una contraseña de
administrador generada. Cada una se declara con `${VAR:?…}`, por lo que si falta alguna,
la pila se detiene con un mensaje indicándola en lugar de iniciar algo a medio configurar —
y Compose interpola todo el archivo antes de seleccionar los servicios, por lo que una variable
faltante también detiene `docker compose up -d db`.

Cambia el correo electrónico del administrador por el tuyo, inicia sesión y cambia la contraseña. Consulta [Tu
primer administrador](#tu-primer-administrador).

### El esquema

El runtime crea las tablas que faltan durante el arranque, **incluidas las que declara `backend/schema`** —
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el
esquema y aplica la seguridad a nivel de fila (RLS) con él. Un primer `docker compose up`
contra una base de datos vacía se iniciará sirviendo tus tablas.

Lo que el arranque nunca hace es modificar algo que ya existe: no altera
el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que
un reinicio del contenedor no debe remodelar un esquema como efecto secundario de un despliegue. Esos cambios
se realizan mediante la CLI, desde un clon local o un trabajo de CI apuntando a la
base de datos de producción:

```bash
pnpm run db:push
```

Ejecútalo para cualquier cambio que no sea puramente aditivo: una columna renombrada,
un tipo más restringido, un campo eliminado.

Para un **flujo de trabajo en equipo con versiones**, haz commit de los archivos de migración con
`pnpm run db:generate` y ejecuta `pnpm run db:migrate` como paso de lanzamiento en su lugar.
De cualquier forma, se ejecuta desde un clon del proyecto, no dentro del contenedor en ejecución —
la imagen de runtime se distribuye sin la CLI.

## Tu primer administrador

**Define `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` antes del primer arranque.**
Todas las guías de plataformas en este sitio apuntan aquí, porque este es el único paso que
no tiene recuperación desde el exterior.

En Rebase Cloud no hay nada que configurar: los propietarios y administradores de la
organización dueña del proyecto abren su panel de administración desde la página del proyecto
en la consola (**Open CMS**, o **Continue with Rebase Cloud** en la propia pantalla de inicio de sesión de la
administración) y acceden directamente como administradores. Esta sección es para cualquier otro
lugar donde ejecutes Rebase.

Una base de datos nueva no tiene usuarios, y fuera de producción la política de registro
admite el primer registro y lo promueve a administrador. Tiene que ser así: inicializar
un administrador requiere un invocador que ya haya iniciado sesión, por lo que una base de datos vacía sin
dicha regla sería un callejón sin salida. En una laptop, la persona en el teclado es el operador y
eso es exactamente lo correcto.

Es exactamente lo contrario en un host con un nombre público. Los artefactos distribuidos levantan
el DNS y TLS antes de que el operador haya escrito nada, por lo que la ventana queda abierta a
internet desde el primer segundo — y quien llegue primero al formulario de registro
se apropia del despliegue.

Por lo tanto, bajo `NODE_ENV=production` esa ventana se cierra. Una tabla de usuarios vacía
rechaza el registro de inicialización con `SETUP_REQUIRED`, una cuenta creada
mediante registro abierto es una cuenta ordinaria, `GET /api/auth/config` nunca
anuncia `needsSetup`, y `POST /api/admin/bootstrap` lo rechaza.

`rebase dev` lee el mismo `.env` e ignora deliberadamente ambas variables, y
así lo indica en el arranque: localmente el primer registro sigue siendo la forma de entrar. Los valores
que escribió `rebase init` pertenecen al arranque en producción. Sembrar los datos en ambos lados
consumiría la ventana antes de que el desarrollador hubiera abierto la aplicación, que es lo que hacía que el
primer paso del inicio rápido produjera una cuenta sin rol.

Eso deja dos formas de acceder, ninguna de las cuales es una carrera:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

El runtime crea esa cuenta una sola vez, mientras la tabla de usuarios esté vacía, y no
hace nada en cada arranque posterior. O asigna el rol a un usuario existente con
la clave de servicio (service key), si aprovisionas cuentas fuera de banda.

Dos reglas que el runtime aplica en el arranque, las cuales producirán una cuenta que nadie
puede usar si te equivocas en ellas:

- La contraseña debe tener **al menos 12 caracteres**, o será rechazada y no se
  creará ninguna cuenta.
- La dirección debe ser una que `POST /api/auth/login` acepte — analiza su cuerpo
  con `z.string().email()`, por lo que un dominio sin punto (`admin@localhost`) se siembra
  sin problemas pero luego responde con 400 en cada inicio de sesión. El arranque también rechaza esa dirección.

Define ambas o ninguna: media credencial es un error tipográfico, y el despliegue que produce
— autoregistro desactivado, sin administrador — requiere una consola de `psql` para recuperarse. El arranque advierte
cuando la tabla está vacía en producción y no se indica ningún administrador.

Inicia sesión y cambia la contraseña. Se encuentra en texto plano dondequiera que hayas puesto
tu entorno.

## Lista de verificación para producción

Antes de desplegar en producción, asegúrate de:

| Elemento | Detalles |
|----------|----------|
| **Primer administrador** | Define `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` **antes del primer arranque**, y `DISABLE_SELF_REGISTRATION=true`. En producción, la primera cuenta que se registra no se promueve — consulta [Tu primer administrador](#tu-primer-administrador). |
| **NODE_ENV** | `NODE_ENV=production`. Es lo que cierra la ventana de inicialización, rechaza el almacenamiento de archivos local, requiere `CORS_ORIGINS` y desactiva la documentación de OpenAPI. Un despliegue dejado con el valor predeterminado se ejecuta en modo de desarrollo. |
| **Esquema de base de datos** | El arranque crea tus tablas declaradas y su RLS de forma aditiva. Ejecuta `pnpm run db:push` (o `pnpm run db:migrate`) para cualquier cambio que no sea puramente aditivo. |
| **JWT_SECRET** | Utiliza una cadena aleatoria criptográficamente segura (≥ 32 caracteres). Nunca la reutilices entre entornos. |
| **DATABASE_URL** | Utiliza una instancia administrada de Postgres (Neon, Supabase, RDS) con TLS habilitado |
| **CORS_ORIGINS** | Siempre, no solo cuando el frontend esté en otro dominio. El runtime se niega a iniciar en producción sin `CORS_ORIGINS` ni `FRONTEND_URL`, porque una API que adivina sus orígenes permitidos eventualmente permitirá el incorrecto. |
| **Control de acceso al almacenamiento** | Un bucket configurado **se niega a arrancar en producción** sin un modelo de control de acceso. El almacenamiento no está bajo seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que un valor predeterminado que permita todo permite a cualquier usuario autenticado listar (`GET /storage/list?prefix=`) y luego leer, sobrescribir o eliminar los archivos de cualquier otro usuario. Cumple este requisito con un hook `storageAuthorize` o `storagePolicies` (la estructura inicial incluye un hook en `backend/storage.ts`), o declara la intención con `STORAGE_PUBLIC_READ` para una CDN pública genuina, o `STORAGE_ALLOW_ANY_AUTHENTICATED` para una aplicación mono-inquilino (single-tenant) donde se confía en que cada cuenta acceda a cada archivo. |
| **Backend de almacenamiento** | `STORAGE_TYPE=local` en producción se **descarta**, y las subidas responden `501 STORAGE_NOT_CONFIGURED` — el sistema de archivos del contenedor se destruye en el siguiente reinicio, por lo que un backend local implica pérdida silenciosa de datos. Usa `s3` o `gcs`, o establece `FORCE_LOCAL_STORAGE=true` si la ruta es realmente un volumen duradero. |
| **MFA_ENCRYPTION_KEY** | Configúrala (32+ caracteres aleatorios) si usas TOTP. Si no se define, los secretos almacenados se cifran con `JWT_SECRET` — por lo que rotar este último cierra la sesión de todos *y* hace que cualquier autenticador registrado sea indescifrable. |
| **HTTPS** | Termina TLS en tu proxy inverso (nginx, Cloudflare, balanceador de carga) |
| **Las lecturas públicas aún necesitan un invocador** | `access: "public"` amplía qué *filas* ve un invocador, no quién puede llamar: una solicitud anónima a `/api/data/*` responde 401 mientras `AUTH_REQUIRE` esté activo. Establece `AUTH_REQUIRE=false` para un sitio público que lee su propio backend, y deja que solo RLS decida. Es una variable de entorno, por lo que un `.env` local que la defina **no** se transfiere con tu despliegue. |

## Módulos nativos en el runtime administrado

El runtime administrado de Rebase Cloud ejecuta tu bundle dentro de una imagen compartida. No tiene
compilador ni forma de cargar un **módulo nativo** — cualquier cosa que distribuya un binario
`.node` precompilado. El más común con diferencia es `sharp`, que también es la dependencia
obvia para cualquier cosa que sirva imágenes.

`rebase cloud deploy` rechaza esto antes de la subida en lugar de después:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tres formas de resolverlo, en el orden en que suelen ser convenientes:

1. **Mueve el trabajo al momento de la compilación.** Redimensiona y recodifica imágenes en tu
   paso de compilación y despliega los resultados. Nada nativo se ejecuta en la ruta de la solicitud.
2. **Usa un servicio.** Una CDN de imágenes o una API de transformación realizan el mismo trabajo detrás
   de una URL.
3. **Ejecuta tu propio contenedor.** Un despliegue autohospedado (Docker, Kubernetes, cualquiera
   de las [guías de plataformas](/docs/deployment/self-hosting)) es tu propia imagen, por lo que
   puede incluir lo que desee.

Las funciones que simplemente necesitan Node en lugar de un binario nativo funcionan bien — el
despliegue las informa por separado (`1 of 3 function(s) depend on Node`) y las
ejecuta. [Runtime administrado de backend](/docs/deployment/managed-runtime/) cubre el
resto de lo que permite el runtime administrado: binarios, memoria, tiempos de espera (timeouts), el
sistema de archivos, secretos, almacenamiento y red de salida.

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

## Guías de despliegue en plataformas

Guías detalladas paso a paso para cada plataforma:

| Plataforma | Tipo | Guía |
|------------|------|------|
| **AWS** | App Runner / ECS + RDS | [Desplegar en AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Desplegar en GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Desplegar en Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Desplegar en Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Contenedores serverless | [Desplegar en Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (detección automática de Dockerfile) | [Desplegar en Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de contenedores | [Desplegar en Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL en un solo pod, sin Docker | [Desplegar en InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + PostgreSQL administrado, o un VPS | [Desplegar en Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run y otras plataformas serverless son sin estado (stateless). Usa **almacenamiento S3** en lugar del sistema de archivos local para la subida de archivos, y configura `--min-instances 1` si utilizas las funciones en tiempo real de Rebase (las conexiones WebSocket se terminan cuando las instancias escalan a la baja).
:::


## Cambiar la URL base

Si deseas que la administración se ejecute en una subruta (por ejemplo, `/admin`), cambia el
`path` de la aplicación en `rebase.json`, y su `cms` con él:

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

`cms` es donde se encuentra el CMS, al que enlaza Rebase Cloud, y debe estar dentro
del `path` de la aplicación. La estructura inicial establece ambos en `/`, por lo que mover solo `path` es
rechazado — el CMS estaría en `/`, fuera de una aplicación que ahora comienza en `/admin`.

Para darle a la administración un nombre de host propio en lugar de una subruta, haz que `path` sea una
URL completa — `"path": "https://admin.example.com"` — y deja `cms` en `"/"`.
La administración responderá únicamente en ese nombre de host y no en la dirección propia
del proyecto, por lo que será inaccesible hasta que el DNS del nombre de host se verifique. La API permanece
también en `/api` en ese nombre de host. Consulta
[Una aplicación en su propio nombre de host](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname)
para saber cómo se enrutan las solicitudes y qué hace un despliegue de Rebase Cloud con el
nombre de host.

`rebase build` pasa `path` a Vite como `base` (a través de `REBASE_APP_BASE`), Vite lo devuelve
como `import.meta.env.BASE_URL`, y el `main.tsx` generado ya lo
suministra al router — de modo que los assets, las rutas y el servidor coinciden
sin tener que escribir el prefijo tres veces:

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

Mantén la administración en un **data router** — `createBrowserRouter` con
`<RouterProvider>`, como hace la estructura generada. Con él, un registro con cambios no guardados
también detiene la navegación interna de la aplicación (un enlace en el menú lateral, el botón de retroceso
del navegador) y pregunta primero, a través de `useBlocker`, que solo un data router
proporciona.

La administración también
funciona bajo un `<BrowserRouter>` convencional. En ese caso, la protección contra cambios no guardados recurre
al aviso nativo del navegador para abandonar la página, que cubre recargas, cerrar la
pestaña o escribir una URL; la navegación dentro de la aplicación continuará sin preguntar.

**Backend** — si también mueves la API, actualiza su ruta base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montar sin un `basename` de router]
El enfoque con `basename` mencionado arriba es el recomendado — react-router elimina el
prefijo de la ubicación, por lo que la administración funciona sin cambios. Si, en su lugar, incrustas la
administración dentro de una **ruta con prefijo de ruta** en una aplicación más grande (por ejemplo, `<Route path="/admin/*">`)
sin `basename`, la ruta actual mantiene su prefijo `/admin`. Infórmaselo al CMS
para que la resolución URL⇄tabla tenga en cuenta el prefijo — de lo contrario, las vistas se quedarán bloqueadas en un
indicador de carga sin obtener datos:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Define **o bien** el `basename` del router **o bien** `RebaseCMS basePath` — no ambos, o el
prefijo se aplicará dos veces.
:::

### Aplicación de producto + Administración en un solo despliegue

La razón habitual para mover la administración a `/admin` es publicar tu **propia aplicación de producto**
en la raíz del mismo despliegue. Una sola entrada de Vite puede servir ambas, divididas por URL,
de modo que cada aplicación se cargue de forma diferida (lazy loading) y los visitantes del producto nunca descarguen el bundle de administración:

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

Un solo router para ambas partes: la administración funciona mejor en un data router, lo que
permite que los cambios no guardados detengan la navegación interna, y no hay razón para que la
aplicación de producto use uno diferente.

El backend no necesita cambios para este patrón — la API permanece en `/api` y el comodín catch-all
de la SPA sirve `index.html` tanto para `/` como para `/admin/*`.

## Próximos pasos

- **[Visión general del backend](/docs/backend)** — Configuración completa del backend
- **[Configuración de almacenamiento](/docs/backend/storage)** — Configuración de S3 para producción
