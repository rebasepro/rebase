---
sourceHash: 1fb30b9d3983d379
title: Despliegue
sidebar_label: Despliegue
description: Despliega tu proyecto Rebase en producción utilizando Docker, plataformas en la nube o configuraciones manuales.
---

## Qué sirve un despliegue

Un proyecto de Rebase se despliega como **un único servidor** (en Rebase Cloud: `https://<project>.rebase.website`). Ese servidor gestiona:

- **`/api/*`** — la API de datos, autenticación, tiempo real y almacenamiento
- **todo lo demás** — tu `frontend/` compilado como una SPA estática

No hay un servicio de administración independiente: el panel de administración es parte de un frontend, por lo que su ubicación depende de cuál sea tu frontend y de si le asignas un hostname propio.

| Tipo de proyecto | La URL raíz muestra | El panel de administración está en |
|------------------|---------------------|-----------------------------------|
| Estructura predeterminada (`rebase init`) | El panel de administración | `/` — el frontend **es** la administración |
| Frontend de producto personalizado | Tu aplicación | Dondequiera que lo montes, habitualmente `/admin` — consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Administración como app con su propio hostname | Tu aplicación | `https://admin.example.com/`, servido por el mismo servidor — consulta [Cambiar la URL base](#cambiar-la-url-base) |
| Proyecto solo de backend | Nada (solo API) | No desplegado |

:::note[Primera visita]
Un despliegue de **producción** nuevo no ofrece una pantalla de inicialización (bootstrap), y su primer registro es una cuenta ordinaria. Asigna el administrador antes del primer arranque en su lugar — consulta [Tu primer administrador](#tu-primer-administrador).
:::

## Docker Compose (Recomendado)

El proyecto generado ya incluye un `docker-compose.yml` funcional — **ese
archivo es el que se debe usar para un proyecto generado mediante scaffolding**, tal cual, en lugar de
escribirlo a mano o copiarlo de otra parte. `rebase init` rellenó sus secretos, su
primera cuenta de administrador y su versión fija de runtime, y se inicia mediante
el propio control de aceptación del framework en cada push. Ejecuta **dos** contenedores:
Postgres y el runtime publicado de Rebase con tu bundle compilado montado en
él. No hay ninguna imagen de aplicación que compilar.

[Autohospedaje](/docs/deployment/self-hosting) cubre el mismo despliegue sin
un scaffolding detrás, utilizando
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
del repositorio de Rebase — y los dos elementos que este archivo omite deliberadamente:
un gestor de grupos de conexiones (connection pooler), y la ejecución de funciones y el job worker como
sus propios procesos.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Siempre ejecuta `rebase build` primero: el servicio `api` monta `./dist-bundle`, y
sin él el contenedor se inicia sobre un directorio vacío.

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

Las tres líneas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` son nuevas
— en la versión 0.17.3 la primera cuenta en registrarse se convierte en administradora,
también en producción. Consulta [Tu primer administrador](#tu-primer-administrador) más abajo.

El bundle se monta en modo de solo lectura. `rebase build` instala las dependencias declaradas
del proyecto dentro de `dist-bundle` a menos que pases `--no-vendor`, en cuyo caso el
runtime las instala en cada inicio y el montaje debe tener permisos de escritura — elimina
el `:ro`. Consulta [Autohospedaje](/docs/deployment/self-hosting/#dependencies).

`rebase init` escribe todo esto en `.env` por ti, incluyendo una contraseña
de administrador generada. Cada una se declara con `${VAR:?…}`, por lo que si falta alguna
se detiene la pila con un mensaje que la identifica en lugar de iniciar algo a medio configurar —
y Compose interpola todo el archivo antes de seleccionar los servicios, por lo que una variable
faltante detiene también `docker compose up -d db`.

Cambia el correo electrónico de administrador por el tuyo, inicia sesión y cambia la contraseña. Consulta [Tu
primer administrador](#tu-primer-administrador).

### El esquema

El runtime crea las tablas que falten en el inicio, **incluyendo las de tus colecciones** —
`REBASE_MIGRATE_ON_BOOT` se establece por defecto en `ensure`, lo cual es aditivo en todo
el esquema y aplica seguridad a nivel de fila (RLS) junto con él. Un primer `docker compose up`
sobre una base de datos vacía arranca sirviendo tus colecciones.

Lo que el inicio nunca hace es modificar algo que ya existe: no altera
el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, porque el
reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue. Esos cambios
se realizan a través de la CLI, desde una copia local o una tarea de CI dirigida a la base
de datos de producción:

```bash
pnpm run db:push
```

Ejecútalo para cualquier cambio que no sea puramente aditivo: una columna renombrada,
un tipo restringido, un campo eliminado.

Para un **flujo de trabajo en equipo con control de versiones**, realiza commit de los archivos de migración con
`pnpm run db:generate` y ejecuta `pnpm run db:migrate` como un paso de release.
En cualquier caso, se ejecuta desde una copia local del proyecto, no dentro del contenedor en ejecución —
la imagen de runtime no incluye la CLI.

## Tu primer administrador

**Establece `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` antes del primer arranque.**
Todas las guías de plataformas en este sitio apuntan aquí, porque este es el único paso que
no tiene recuperación desde el exterior.

Una base de datos limpia no tiene usuarios, y fuera de producción la política de registro
admite el primer registro y lo asciende a administrador. Debe ser así: inicializar un
administrador requiere de un usuario que ya haya iniciado sesión, por lo que una base de datos vacía sin
dicha regla es un callejón sin salida. En una portátil, la persona frente al teclado es el operador y
eso es exactamente lo correcto.

Es exactamente lo incorrecto en un host con un nombre público. Los artefactos distribuidos
levantan DNS y TLS antes de que el operador haya escrito nada, por lo que la ventana queda abierta a
internet desde el primer segundo — y quien llegue primero al formulario de registro
se apropia del despliegue.

Por lo tanto, bajo `NODE_ENV=production` esa ventana está cerrada. Una tabla de usuarios vacía
rechaza el registro de inicialización con `SETUP_REQUIRED`, una cuenta creada
mediante registro abierto es una cuenta ordinaria, `GET /api/auth/config` nunca
anuncia `needsSetup`, y `POST /api/admin/bootstrap` rechaza la petición. En la versión 0.17.3 y
anteriores la ventana estaba abierta también en producción, así que actualiza antes de exponer un
despliegue nuevo.

`rebase dev` lee el mismo `.env` e ignora deliberadamente ambas variables, y
lo indica en el arranque: de forma local, el primer registro sigue siendo la forma de acceso. Los valores
que escribió `rebase init` pertenecen al arranque en producción. Cargar los datos iniciales en ambos lados
habría consumido la oportunidad antes de que el desarrollador abriera la app, que es lo que hacía que el
primer paso de la guía de inicio rápido produjera una cuenta sin roles.

Eso deja dos formas de acceder, ninguna de las cuales implica una condición de carrera:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

El runtime crea esa cuenta una sola vez, mientras la tabla de usuarios esté vacía, y no hace
nada en los arranques posteriores. O bien, asigna el rol a un usuario existente con
la clave de servicio, si aprovisionas cuentas fuera de banda.

Dos reglas que el runtime aplica en el arranque, y que producirán una cuenta que nadie
podrá usar si las configuras mal:

- La contraseña debe tener **al menos 12 caracteres**, o será rechazada y no
  se creará ninguna cuenta.
- La dirección debe ser una que `POST /api/auth/login` acepte — procesa su cuerpo
  con `z.string().email()`, por lo que un dominio sin punto (`admin@localhost`) se inicializa
  bien y luego responde 400 en cada inicio de sesión. El arranque también rechaza esa dirección.

Configura ambas o ninguna: media credencial es un error tipográfico, y el despliegue que produce
— con autorregistro desactivado y sin administrador — requiere acceso a la terminal de `psql` para recuperarse. El arranque advierte
cuando la tabla está vacía en producción y no se ha especificado un administrador.

Inicia sesión y cambia la contraseña. Está guardada en texto plano dondequiera que hayas colocado
tu entorno.

## Lista de verificación para producción

Antes de desplegar en producción, asegúrate de:

| Elemento | Detalles |
|----------|---------|
| **Primer administrador** | Configura `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` **antes del primer arranque**, y `DISABLE_SELF_REGISTRATION=true`. En producción, la primera cuenta en registrarse no es ascendida — consulta [Tu primer administrador](#tu-primer-administrador). |
| **NODE_ENV** | `NODE_ENV=production`. Es lo que cierra la ventana de inicialización, rechaza el almacenamiento de archivos local, requiere `CORS_ORIGINS` y desactiva la documentación de OpenAPI. Un despliegue dejado en el valor predeterminado se ejecuta en modo de desarrollo. |
| **Esquema de base de datos** | El arranque crea las tablas de tus colecciones y su RLS de forma aditiva. Ejecuta `pnpm run db:push` (o `pnpm run db:migrate`) para cualquier cambio que no sea puramente aditivo. |
| **JWT_SECRET** | Usa una cadena aleatoria criptográficamente segura (≥ 32 caracteres). Nunca la reutilices entre entornos. |
| **DATABASE_URL** | Usa una instancia de Postgres administrada (Neon, Supabase, RDS) con TLS habilitado |
| **CORS_ORIGINS** | Siempre, no solo cuando el frontend esté en otro dominio. El runtime se niega a iniciar en producción sin `CORS_ORIGINS` ni `FRONTEND_URL`, ya que una API que adivina sus orígenes permitidos eventualmente permitirá el incorrecto. |
| **Control de acceso al almacenamiento** | Un bucket configurado **se niega a arrancar en producción** sin un modelo de control de acceso. El almacenamiento no está bajo seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que una configuración predeterminada que permita todo deja que cualquier usuario autenticado liste (`GET /storage/list?prefix=`) y luego lea, sobrescriba o elimine los archivos de los demás usuarios. Cumple este requisito con un hook `storageAuthorize` o con `storagePolicies` (el scaffolding incluye un hook en `config/storage.ts`), o define la intención con `STORAGE_PUBLIC_READ` para una CDN pública real, o `STORAGE_ALLOW_ANY_AUTHENTICATED` para una app de inquilino único donde cada cuenta tiene acceso de confianza a todos los archivos. |
| **Backend de almacenamiento** | `STORAGE_TYPE=local` en producción es **descartado**, y las subidas responden `501 STORAGE_NOT_CONFIGURED` — el sistema de archivos del contenedor se destruye en el siguiente reinicio, por lo que un backend local implica pérdida silenciosa de datos. Usa `s3` o `gcs`, o establece `FORCE_LOCAL_STORAGE=true` si la ruta corresponde realmente a un volumen duradero. |
| **MFA_ENCRYPTION_KEY** | Configúrala (32+ caracteres aleatorios) si usas TOTP. Si no se define, los secretos almacenados se cifran con `JWT_SECRET` — por lo que rotar esa clave cierra la sesión de todos *y* hace que cada autenticador registrado sea indescifrable. |
| **HTTPS** | Termina TLS en tu proxy inverso (nginx, Cloudflare, balanceador de carga) |
| **Las lecturas públicas aún requieren un emisor** | `access: "public"` amplía qué *filas* ve un emisor, no quién puede llamar: una solicitud anónima a `/api/data/*` responde 401 mientras `AUTH_REQUIRE` esté activo. Establece `AUTH_REQUIRE=false` para un sitio público que lee su propio backend, y deja que solo RLS decida. Es una variable de entorno, por lo que un `.env` local que la contenga **no** viaja con tu despliegue. |

## Módulos nativos en el runtime administrado

El runtime administrado de Rebase Cloud ejecuta tu bundle dentro de una imagen compartida. No tiene
compilador ni forma de cargar un **módulo nativo** — cualquier cosa que distribuya un binario
`.node` precompilado. El más común con diferencia es `sharp`, que también es la dependencia
obvia para cualquier cosa que sirva imágenes.

`rebase cloud deploy` rechaza esto antes de la subida en lugar de después:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tres formas de solucionarlo, en el orden en que suelen ser adecuadas:

1. **Trasladar el trabajo al momento de compilación (build time).** Redimensiona y recodifica imágenes en tu paso
   de compilación y despliega los resultados. Nada nativo se ejecuta en la ruta de las solicitudes.
2. **Usar un servicio.** Una CDN de imágenes o una API de transformación realizan el mismo trabajo detrás
   de una URL.
3. **Ejecutar tu propio contenedor.** Un despliegue autohospedado (Docker, Kubernetes, cualquiera
   de las [guías de plataformas](/docs/deployment/self-hosting)) utiliza tu propia imagen, por lo que puede
   contener lo que quieras.

Las funciones que simplemente necesitan Node en lugar de un binario nativo funcionan bien — el
despliegue las reporta por separado (`1 of 3 function(s) depend on Node`) y las
ejecuta. [Runtime administrado de backend](/docs/deployment/managed-runtime/) cubre el
resto de lo que el runtime administrado permite: binarios, memoria, tiempos de espera, el
sistema de archivos, secretos, almacenamiento y red saliente.

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

De esta forma solo necesitas desplegar un servidor que gestiona tanto la SPA como la API.

## Guías de despliegue en plataformas

Guías detalladas paso a paso para cada plataforma:

| Plataforma | Tipo | Guía |
|------------|------|------|
| **AWS** | App Runner / ECS + RDS | [Desplegar en AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Desplegar en GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Desplegar en Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Desplegar en Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Desplegar en Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (detección automática de Dockerfile) | [Desplegar en Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de contenedores | [Desplegar en Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run y otras plataformas serverless son sin estado (stateless). Utiliza **almacenamiento S3** en lugar del sistema de archivos local para la subida de archivos, y establece `--min-instances 1` si utilizas las funciones en tiempo real de Rebase (las conexiones WebSocket se terminan cuando las instancias reducen su escala a cero).
:::


## Cambiar la URL base

Si deseas que la administración se ejecute en una sub-ruta (por ejemplo, `/admin`), cambia la propiedad
`path` de la aplicación en `rebase.json`, y su `cms` junto con ella:

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

`cms` es donde se encuentra el CMS, al cual enlaza Rebase Cloud, y debe estar dentro
del `path` de la aplicación. El scaffolding establece ambos en `/`, por lo que cambiar solo `path` es
rechazado — el CMS quedaría en `/`, fuera de una aplicación que ahora comienza en `/admin`.

Para darle a la administración un hostname propio en lugar de una sub-ruta, haz que `path` sea
una URL completa — `"path": "https://admin.example.com"` — y deja `cms` en `"/"`.
La administración responderá entonces solo en ese hostname y no en la dirección
propia del proyecto, por lo que será inaccesible hasta que se verifique el DNS del hostname. La API se mantiene
en `/api` también en ese hostname. Consulta
[Una aplicación en su propio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname)
para ver cómo se emparejan las solicitudes y qué hace un despliegue de Rebase Cloud con el
hostname.

`rebase build` pasa `path` a Vite como `base` (a través de `REBASE_APP_BASE`), Vite lo
devuelve como `import.meta.env.BASE_URL`, y el archivo `main.tsx` del scaffolding ya
lo proporciona al router — de modo que los assets, las rutas y el servidor coinciden
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
`<RouterProvider>`, tal como lo hace el scaffolding. Bajo esta configuración, un registro con cambios
sin guardar también detiene la navegación interna de la aplicación (un enlace en el menú lateral, el botón
atrás del navegador) y pregunta primero mediante `useBlocker`, algo que solo un data router
proporciona.

La administración también
funciona bajo un `<BrowserRouter>` estándar. En ese caso, la protección contra cambios sin guardar recurre
al aviso nativo de abandonar la página del navegador, lo que cubre una recarga, cerrar la
pestaña o escribir una URL; la navegación dentro de la app continúa sin preguntar. En
la versión 0.24, la administración arroja un error fuera de un data router.

**Backend** — si también mueves la API, actualiza su ruta base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaje sin un `basename` de router]
El enfoque con `basename` mencionado arriba es el recomendado — react-router elimina el
prefijo de la ubicación, por lo que la administración funciona sin cambios. Si en su lugar incrustas la
administración dentro de una **ruta con prefijo de ruta** de una aplicación más grande (ej. `<Route path="/admin/*">`)
sin `basename`, la ruta actual conserva su prefijo `/admin`. Infórmaselo al CMS
para que la resolución URL⇄colección tome en cuenta el prefijo — de lo contrario, las vistas se quedarán cargando indefinidamente
sin realizar peticiones de datos:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Establece **o bien** el `basename` del router **o bien** el `basePath` de `RebaseCMS` — no ambos, o el
prefijo se aplicará dos veces.
:::

### Aplicación de producto + Administración en un solo despliegue

La razón común para mover la administración a `/admin` es publicar tu **propia aplicación de producto**
en la raíz del mismo despliegue. Un único punto de entrada de Vite puede servir ambas, divididas por URL,
de modo que cada app se carga de forma diferida (lazy-loaded) y los visitantes del producto nunca descargan el bundle de administración:

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

Un router para ambas partes: la administración funciona mejor en un data router, lo
que permite que los cambios sin guardar detengan la navegación dentro de la app, y no hay razón para que la
aplicación de producto utilice uno diferente.

El backend no requiere cambios para este patrón — la API permanece en `/api` y el comodín
de la SPA sirve `index.html` tanto para `/` como para `/admin/*`.

## Próximos pasos

- **[Visión general del backend](/docs/backend)** — Configuración completa del backend
- **[Configuración del almacenamiento](/docs/backend/storage)** — Configuración de S3 para producción
