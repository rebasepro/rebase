---
sourceHash: d1e6d42ab673666c
title: Despliegue
sidebar_label: Despliegue
description: Despliega tu proyecto Rebase en producción usando Docker, plataformas en la nube o configuraciones manuales.
---

## Qué sirve un despliegue

Un proyecto Rebase se despliega como **un único servidor** (en Rebase Cloud: `https://<project>.rebase.website`). Ese servidor gestiona:

- **`/api/*`** — la API de datos, autenticación, tiempo real y almacenamiento
- **todo lo demás** — tu `frontend/` compilado como una SPA estática

No existe un servicio de administración independiente: el panel de administración forma parte de un frontend, por lo que el lugar donde aparece depende de cuál sea tu frontend y de si le asignas un nombre de host propio.

| Tipo de proyecto | La URL raíz muestra | El panel de administración está en |
|------------------|---------------------|-----------------------------------|
| Andamiaje predeterminado (`rebase init`) | El panel de administración | `/` — el frontend **es** la administración |
| Frontend de producto personalizado | Tu aplicación | Dondequiera que lo montes, comúnmente `/admin` — consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Administración como aplicación en su propio nombre de host | Tu aplicación | `https://admin.example.com/`, servido por el mismo servidor — consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Proyecto solo de backend | Nada (solo API) | No desplegado |

:::note[Primera visita]
Un nuevo despliegue en **producción** no ofrece una pantalla de inicio (bootstrap), y su primer registro es una cuenta ordinaria. En su lugar, define al administrador antes del primer arranque — consulta [Tu primer administrador](#tu-primer-administrador).
:::

## Docker Compose (Recomendado)

El proyecto generado ya incluye un `docker-compose.yml` funcional — **ese archivo es el que se debe utilizar para un proyecto generado con andamiaje**, tal cual, en lugar de escribirlo a mano o copiarlo de otro lugar. `rebase init` completó sus secretos, su primera cuenta de administrador y su versión de runtime fijada, y es iniciado por la propia compuerta de aceptación del framework en cada push. Ejecuta **dos** contenedores: Postgres y el runtime publicado de Rebase con tu bundle compilado montado en él. No es necesario compilar una imagen de aplicación.

[Autohospedaje](/docs/deployment/self-hosting) cubre el mismo despliegue sin un andamiaje detrás, usando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) del repositorio de Rebase — y las dos cosas que este archivo omite deliberadamente: un agrupador de conexiones (connection pooler) y la ejecución de funciones y el worker de tareas como procesos independientes.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Siempre ejecuta primero `rebase build`: el servicio `api` monta `./dist-bundle`, y sin él el contenedor se iniciará sobre un directorio vacío.

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

Consulta [Tu primer administrador](#tu-primer-administrador) a continuación para las tres líneas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

El bundle se monta en modo de solo lectura. `rebase build` instala las dependencias declaradas del proyecto en `dist-bundle` a menos que pases `--no-vendor`, en cuyo caso el runtime las instala en cada inicio y el montaje debe ser de escritura — elimina el `:ro`. Consulta [Autohospedaje](/docs/deployment/self-hosting/#dependencies).

`rebase init` escribe todo esto en `.env` por ti, incluyendo una contraseña de administrador generada. Cada una se declara con `${VAR:?…}`, por lo que si falta alguna, el stack se detiene con un mensaje que la indica en lugar de iniciar algo a medio configurar — y Compose interpola todo el archivo antes de seleccionar los servicios, por lo que una variable faltante también detiene `docker compose up -d db`.

Cambia el correo electrónico del administrador por el tuyo, inicia sesión y cambia la contraseña. Consulta [Tu primer administrador](#tu-primer-administrador).

### El esquema

El runtime crea las tablas faltantes al arrancar, **incluyendo las de tus colecciones** — `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema y aplica la seguridad a nivel de fila (RLS) correspondiente. Un primer `docker compose up` contra una base de datos vacía se iniciará sirviendo tus colecciones.

Lo que el arranque nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue. Esos cambios se realizan mediante la CLI, desde un repositorio clonado o un trabajo de CI apuntado a la base de datos de producción:

```bash
pnpm run db:push
```

Ejecútalo para cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restrictivo o un campo eliminado.

Para un **flujo de trabajo en equipo y con versiones**, haz commit de los archivos de migración con `pnpm run db:generate` y ejecuta `pnpm run db:migrate` como un paso de release. De cualquier forma, se ejecuta desde el código del proyecto, no dentro del contenedor en ejecución — la imagen del runtime se distribuye sin la CLI.

## Tu primer administrador

**Configura `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` antes del primer arranque.** Todas las guías de plataformas en este sitio apuntan a esto, porque es el único paso que no tiene recuperación desde el exterior.

Una base de datos recién creada no tiene usuarios, y fuera de producción la política de registro admite el primer registro y lo asciende a administrador. Tiene que ser así: inicializar un administrador requiere un invocador que ya haya iniciado sesión, por lo que una base de datos vacía sin dicha regla sería un callejón sin salida. En una portátil, la persona frente al teclado es el operador y eso es exactamente lo correcto.

Es exactamente incorrecto en un host con un nombre público. Los artefactos distribuidos levantan DNS y TLS antes de que el operador haya escrito nada, por lo que la ventana queda abierta a internet desde el primer segundo — y quien llegue primero al formulario de registro toma control del despliegue.

Por lo tanto, bajo `NODE_ENV=production` esa ventana se cierra. Una tabla de usuarios vacía rechaza el registro de inicialización con `SETUP_REQUIRED`, una cuenta creada mediante registro abierto es una cuenta ordinaria, `GET /api/auth/config` nunca anuncia `needsSetup`, y `POST /api/admin/bootstrap` lo rechaza.

`rebase dev` lee el mismo `.env` e ignora deliberadamente ambas variables, y así lo indica al arrancar: localmente, el primer registro sigue siendo la forma de acceso. Los valores que escribió `rebase init` pertenecen al arranque en producción. Hacer el seed en ambos lados consumiría la ventana antes de que el desarrollador abriera la aplicación, que es lo que hacía que el primer paso de la guía de inicio rápido produjera una cuenta sin rol.

Esto deja dos formas de acceder, ninguna de las cuales es una carrera:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

El runtime crea esa cuenta una sola vez, mientras la tabla de usuarios esté vacía, y no hace nada en los arranques posteriores. O bien asigna el rol a un usuario existente mediante la clave de servicio, si aprovisionas cuentas fuera de banda.

Dos reglas que el runtime exige en el arranque, y si te equivocas en alguna de ellas se creará una cuenta que nadie podrá usar:

- La contraseña debe tener **al menos 12 caracteres**, o será rechazada y no se creará ninguna cuenta.
- La dirección debe ser una que `POST /api/auth/login` acepte — analiza su cuerpo con `z.string().email()`, por lo que un dominio sin punto (`admin@localhost`) se inserta bien y luego responde 400 en cada inicio de sesión. El arranque también rechaza esa dirección.

Configura ambas o ninguna: media credencial es un error tipográfico, y el despliegue que genera — autoregistro desactivado, sin administrador — requiere una consola `psql` para recuperarse. El arranque advierte cuando la tabla está vacía en producción y no se ha especificado un administrador.

Inicia sesión y cambia la contraseña. Queda expuesta en texto sin formato dondequiera que coloques tu entorno.

## Lista de verificación para producción

Antes de desplegar en producción, asegúrate de:

| Elemento | Detalles |
|----------|---------|
| **Primer administrador** | Configura `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` **antes del primer arranque**, y `DISABLE_SELF_REGISTRATION=true`. En producción, la primera cuenta en registrarse no es ascendida — consulta [Tu primer administrador](#tu-primer-administrador). |
| **NODE_ENV** | `NODE_ENV=production`. Es lo que cierra la ventana de inicialización, rechaza el almacenamiento local de archivos, requiere `CORS_ORIGINS` y desactiva la documentación de OpenAPI. Un despliegue dejado con el valor predeterminado se ejecuta en modo de desarrollo. |
| **Esquema de base de datos** | El arranque crea las tablas de tus colecciones y su RLS de forma aditiva. Ejecuta `pnpm run db:push` (o `pnpm run db:migrate`) para cualquier cambio que no sea puramente aditivo. |
| **JWT_SECRET** | Utiliza una cadena aleatoria criptográficamente segura (≥ 32 caracteres). Nunca la reutilices entre entornos. |
| **DATABASE_URL** | Utiliza una instancia de Postgres administrada (Neon, Supabase, RDS) con TLS habilitado |
| **CORS_ORIGINS** | Siempre, no solo cuando el frontend esté en otro dominio. El runtime se niega a iniciar en producción si no tiene ni `CORS_ORIGINS` ni `FRONTEND_URL`, porque una API que adivina sus orígenes permitidos eventualmente permitirá el incorrecto. |
| **Control de acceso al almacenamiento** | Un bucket configurado **se niega a arrancar en producción** sin un modelo de control de acceso. El almacenamiento no está bajo seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que un valor predeterminado que permita todo permite a cualquier usuario autenticado listar (`GET /storage/list?prefix=`) y luego leer, sobrescribir o eliminar los archivos de todos los demás usuarios. Cumple con esto mediante un hook `storageAuthorize` o `storagePolicies` (el andamiaje incluye un hook en `config/storage.ts`), o declara la intención con `STORAGE_PUBLIC_READ` para una CDN pública real, o `STORAGE_ALLOW_ANY_AUTHENTICATED` para una aplicación de un solo inquilino donde se confía en cada cuenta para cada archivo. |
| **Backend de almacenamiento** | `STORAGE_TYPE=local` en producción se **descarta**, y las subidas responden `501 STORAGE_NOT_CONFIGURED` — el sistema de archivos del contenedor se destruye en el siguiente reinicio, por lo que un backend local implica pérdida silenciosa de datos. Usa `s3` o `gcs`, o establece `FORCE_LOCAL_STORAGE=true` si la ruta es realmente un volumen duradero. |
| **MFA_ENCRYPTION_KEY** | Configúrala (más de 32 caracteres aleatorios) si utilizas TOTP. Si no está configurada, los secretos almacenados se cifran con `JWT_SECRET` — por lo que rotarlo cerrará la sesión de todos *y* hará que cada autenticador registrado sea indescifrable. |
| **HTTPS** | Termina TLS en tu proxy inverso (nginx, Cloudflare, balanceador de carga) |
| **Las lecturas públicas aún necesitan un invocador** | `access: "public"` amplía qué *filas* ve un invocador, no quién puede llamar: una solicitud anónima a `/api/data/*` responde 401 mientras `AUTH_REQUIRE` esté activo. Configura `AUTH_REQUIRE=false` para un sitio público que lee su propio backend, y deja que RLS decida por sí solo. Es una variable de entorno, por lo que un `.env` local que la configure **no** viaja con tu despliegue. |

## Módulos nativos en el runtime administrado

El runtime administrado de Rebase Cloud ejecuta tu bundle dentro de una imagen compartida. No tiene compilador ni forma de cargar un **módulo nativo** — cualquier cosa que distribuya un binario `.node` precompilado. El más común, por mucho, es `sharp`, que también es la dependencia obvia para cualquier cosa que sirva imágenes.

`rebase cloud deploy` rechaza esto antes de la subida en lugar de después:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tres formas de resolverlo, en el orden en que suelen ser más adecuadas:

1. **Mover el trabajo al momento de compilación.** Redimensiona y recodifica imágenes en tu paso de compilación y despliega los resultados. Nada nativo se ejecuta en la ruta de la solicitud.
2. **Usar un servicio.** Una CDN de imágenes o una API de transformación realiza el mismo trabajo detrás de una URL.
3. **Ejecutar tu propio contenedor.** Un despliegue autohospedado (Docker, Kubernetes, cualquiera de las [guías de plataformas](/docs/deployment/self-hosting)) utiliza tu propia imagen, por lo que puede incluir lo que quieras.

Las funciones que simplemente necesitan Node en lugar de un binario nativo funcionan bien — el despliegue las informa por separado (`1 of 3 function(s) depend on Node`) y las ejecuta. [Runtime administrado de backend](/docs/deployment/managed-runtime/) cubre el resto de lo que permite el runtime administrado: binarios, memoria, tiempos de espera, el sistema de archivos, secretos, almacenamiento y red saliente.

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

De esta manera solo necesitas desplegar un servidor que maneja tanto la SPA como la API.

## Guías de despliegue por plataforma

Guías detalladas paso a paso para cada plataforma:

| Plataforma | Tipo | Guía |
|------------|------|-------|
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
Cloud Run y otras plataformas serverless son sin estado. Utiliza **almacenamiento S3** en lugar del sistema de archivos local para las subidas de archivos, y establece `--min-instances 1` si utilizas las funciones en tiempo real de Rebase (las conexiones WebSocket se terminan cuando las instancias reducen su escala a cero).
:::


## Cambiar la URL base

Si deseas que la administración se ejecute en una subruta (p. ej. `/admin`), cambia la propiedad `path` de la aplicación en `rebase.json`, y su `cms` junto con ella:

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

`cms` es donde se encuentra el CMS, al cual enlaza Rebase Cloud, y debe estar dentro del `path` de la aplicación. El andamiaje establece ambos en `/`, por lo que mover solo `path` es rechazado — el CMS quedaría en `/`, fuera de una aplicación que ahora comienza en `/admin`.

Para darle a la administración un nombre de host propio en lugar de una subruta, define `path` como una URL completa — `"path": "https://admin.example.com"` — y deja `cms` en `"/"`. La administración responderá únicamente en ese nombre de host, y no en la dirección propia del proyecto, por lo que será inaccesible hasta que se verifique el DNS del nombre de host. La API permanece también en `/api` en ese nombre de host. Consulta [Una aplicación en su propio nombre de host](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) para saber cómo se enrutan las solicitudes y qué hace un despliegue de Rebase Cloud con el nombre de host.

`rebase build` pasa `path` a Vite como `base` (mediante `REBASE_APP_BASE`), Vite lo devuelve como `import.meta.env.BASE_URL`, y el archivo `main.tsx` del andamiaje ya lo proporciona al enrutador — de este modo, los assets, las rutas y el servidor coinciden sin tener que escribir el prefijo tres veces:

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

Mantén la administración en un **enrutador de datos** — `createBrowserRouter` con `<RouterProvider>`, tal como lo hace el andamiaje. Con él, un registro con cambios sin guardar también detiene la navegación interna de la aplicación (un enlace en el menú lateral, el botón atrás del navegador) y solicita confirmación primero mediante `useBlocker`, que solo ofrece un data router.

La administración también puede ejecutarse bajo un `<BrowserRouter>` estándar. En ese caso, la protección de cambios sin guardar recurre al diálogo nativo del navegador para abandonar la página, el cual cubre una recarga, cerrar la pestaña o escribir una URL; la navegación dentro de la aplicación continuará sin preguntar.

**Backend** — si también mueves la API, actualiza su ruta base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaje sin un `basename` de enrutador]
El enfoque con `basename` mencionado arriba es el recomendado — react-router elimina el prefijo de la ubicación, por lo que la administración funciona sin modificaciones. Si en su lugar integras la administración dentro de una **ruta con prefijo de trayectoria** en una aplicación más grande (p. ej. `<Route path="/admin/*">`) sin `basename`, la ruta actual mantiene su prefijo `/admin`. Infórmaselo al CMS para que la resolución URL⇄colección tome en cuenta el prefijo — de lo contrario, las vistas se quedarán cargando indefinidamente sin obtener datos:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Configura **el `basename` del enrutador** o **el `basePath` de `RebaseCMS`** — no ambos, o el prefijo se aplicará dos veces.
:::

### Aplicación de producto + administración en un solo despliegue

La razón habitual para mover la administración a `/admin` es publicar tu **propia aplicación de producto** en la raíz del mismo despliegue. Un único punto de entrada de Vite puede servir ambas, divididas por URL, de modo que cada aplicación se cargue de forma diferida y los visitantes del producto nunca descarguen el bundle de administración:

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

Un solo enrutador para ambas partes: la administración funciona mejor en un enrutador de datos, lo que permite que los cambios sin guardar detengan la navegación interna de la aplicación, y no hay razón para que la aplicación del producto esté en uno diferente.

El backend no necesita cambios para este patrón: la API permanece en `/api` y el comodín de la SPA sirve `index.html` tanto para `/` como para `/admin/*`.

## Siguientes pasos

- **[Descripción general del backend](/docs/backend)** — Configuración completa del backend
- **[Configuración del almacenamiento](/docs/backend/storage)** — Configuración de S3 para producción
