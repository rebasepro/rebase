---
sourceHash: b48cc9bf8ad4dcf3
title: Despliegue
sidebar_label: Despliegue
description: Despliega tu proyecto Rebase a producción usando Docker, plataformas en la nube o configuraciones manuales.
---

## Qué Sirve un Despliegue

Un proyecto Rebase se despliega como **un servidor en una URL** (en Rebase Cloud: `https://<project>.rebase.website`). Ese servidor gestiona:

- **`/api/*`** — la API de datos, la autenticación, el tiempo real y el almacenamiento
- **todo lo demás** — tu `frontend/` compilado como una SPA estática

No hay una URL de administración separada: el panel de administración forma parte de tu frontend, por lo que dónde aparece depende de qué sea tu frontend.

| Tipo de proyecto | La URL raíz muestra | El panel de administración está en |
|--------------|----------------|-------------------|
| Scaffold predeterminado (`rebase init`) | El panel de administración | `/` — el frontend **es** el administrador |
| Frontend de producto personalizado | Tu app | Donde lo montes, comúnmente `/admin` — consulta [Cambiar la URL Base](#cambiar-la-url-base) |
| Proyecto solo backend | Nada (solo API) | No desplegado |

:::note[Primera visita]
Un despliegue de **producción** recién creado no ofrece ninguna pantalla de bootstrap, y su primer registro es una cuenta corriente. Nombra al administrador antes del primer arranque — consulta [Tu primer administrador](#tu-primer-administrador).
:::

## Docker Compose (Recomendado)

El proyecto generado ya incluye un `docker-compose.yml` que funciona — **ese
fichero es el que hay que usar en un proyecto con scaffold**, tal cual, en lugar
de escribirlo a mano o copiarlo de otro sitio. `rebase init` rellenó sus
secretos, su primera cuenta de administrador y su versión de runtime fijada, y
la propia puerta de aceptación del framework lo arranca en cada push. Levanta
**dos** contenedores: Postgres y el runtime de Rebase publicado, con tu bundle
compilado montado dentro. No hay ninguna imagen de aplicación que construir.

[Autoalojamiento](/docs/deployment/self-hosting) cubre el mismo despliegue sin
un scaffold detrás, usando
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
del repositorio de Rebase — y las dos cosas que ese fichero deja fuera a
propósito: un pooler de conexiones y ejecutar las funciones y el worker de
trabajos como procesos propios.

```bash
rebase build          # produce ./dist-bundle
docker compose up -d
```

Primero `rebase build`, siempre: el servicio `api` monta `./dist-bundle`, y sin
él el contenedor arranca contra un directorio vacío.

La forma del fichero generado:

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

Las tres líneas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` son nuevas <span class="since-badge" data-since="0.18">Since 0.18</span>
— en 0.17.3 la primera cuenta registrada se convierte en la administradora,
también en producción. Consulta [Tu primer
administrador](#tu-primer-administrador) más abajo.

El bundle se monta en solo lectura. `rebase build` instala las dependencias
declaradas del proyecto en `dist-bundle` salvo que pases `--no-vendor`, en cuyo
caso el runtime las instala en cada arranque y el montaje tiene que ser
escribible: quita entonces el `:ro`. Consulta
[Autoalojamiento](/docs/deployment/self-hosting/#dependencies).

`rebase init` escribe todo esto en `.env` por ti, incluida una contraseña de
administrador generada. Cada variable se declara con `${VAR:?…}`, así que una
que falte detiene el stack con un mensaje que la nombra en lugar de arrancar
algo a medio configurar — y Compose interpola el fichero entero antes de
seleccionar servicios, así que una que falte detiene también
`docker compose up -d db`.

Cambia el correo del administrador por el tuyo, inicia sesión y cambia la
contraseña. Consulta [Tu primer administrador](#tu-primer-administrador).

### El esquema

El runtime crea las tablas que faltan al arrancar, **incluidas las de tus
colecciones**: `REBASE_MIGRATE_ON_BOOT` vale `ensure` por defecto, que es
aditivo sobre todo el esquema y aplica con él la seguridad a nivel de fila. Un
primer `docker compose up` contra una base de datos vacía levanta sirviendo tus
colecciones.

Lo que el arranque nunca hace es cambiar algo que ya existe: no altera el tipo
de una columna, no elimina nada y no edita las etiquetas de un enum existente,
porque el reinicio de un contenedor no debe reformar un esquema como efecto
colateral de un despliegue. Eso pasa por la CLI, desde un checkout o desde un
job de CI apuntando a la base de datos de producción:

```bash
pnpm run db:push
```

Ejecútalo para la RLS de las tablas de unión en relaciones muchos a muchos, y
para cualquier cambio que no sea puramente aditivo: una columna renombrada, un
tipo estrechado, un campo eliminado.

Para un **flujo de trabajo versionado y en equipo**, versiona ficheros de
migración con `pnpm run db:generate` y ejecuta `pnpm run db:migrate` como paso
de release. En cualquier caso se ejecuta desde un checkout del proyecto, no
dentro del contenedor en marcha: la imagen de runtime se distribuye sin la CLI.

## Tu primer administrador

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Define `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` antes del primer arranque.** Todas las guías por plataforma de este sitio apuntan aquí, porque es el único paso que no tiene arreglo desde fuera.

Una base de datos recién creada no tiene usuarios, y fuera de producción la política de registro admite el primer alta y la promueve a administrador. Tiene que hacerlo: nombrar a un administrador exige un llamante ya autenticado, así que una base de datos vacía sin esa regla es un callejón sin salida. En un portátil, quien está al teclado es el operador, y eso es exactamente lo correcto.

Es exactamente lo incorrecto en un host con nombre público. Los artefactos publicados levantan DNS y TLS antes de que el operador haya escrito nada, así que la ventana está abierta a internet desde el primer segundo, y quien llegue primero al formulario de alta se queda con el despliegue.

Por eso, bajo `NODE_ENV=production` esa ventana está cerrada. Una tabla de usuarios vacía rechaza el registro de arranque con `SETUP_REQUIRED`, una cuenta creada por registro abierto es una cuenta corriente, `GET /api/auth/config` nunca anuncia `needsSetup` y `POST /api/admin/bootstrap` se niega. En 0.17.3 y anteriores la ventana también estaba abierta en producción: actualiza antes de exponer un despliegue nuevo.

`rebase dev` lee el mismo `.env`, pero ignora ambas variables a propósito y lo dice al arrancar: en local, el primer registro sigue siendo la forma de entrar. Los valores que escribió `rebase init` son del arranque de producción. Sembrar en los dos lados gastaría la ventana antes de que la desarrolladora hubiera abierto la app, que es justo lo que hacía que el primer paso del propio quickstart produjera una cuenta sin rol.

Quedan dos formas de entrar, y ninguna es una carrera:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

El runtime crea esa cuenta una vez, mientras la tabla de usuarios está vacía, y no hace nada en los arranques siguientes. O asigna el rol a un usuario existente con la clave de servicio, si aprovisionas cuentas por otra vía.

El runtime impone dos reglas al arrancar, y ambas producen si no una cuenta que nadie puede usar:

- La contraseña debe tener **al menos 12 caracteres**, o se rechaza y no se crea ninguna cuenta.
- La dirección debe ser una que acepte `POST /api/auth/login`: analiza su cuerpo con `z.string().email()`, así que un dominio sin punto (`admin@localhost`) se crea sin quejas y luego responde 400 en cada inicio de sesión. El arranque también rechaza esa dirección.

Define ambas o ninguna: media credencial es una errata, y el despliegue que deja — autorregistro cerrado, sin administrador — sólo se recupera desde una consola `psql`. El arranque avisa cuando la tabla está vacía en producción y no se ha nombrado administrador.

Inicia sesión y cambia la contraseña. Está en texto plano allí donde hayas puesto tu entorno.

## Lista de Verificación para Producción

<span class="since-badge" data-since="0.18">Since 0.18</span>

Antes de desplegar en producción, asegúrate de:

| Elemento | Detalles |
|------|---------|
| **Primer administrador** | Define `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` **antes del primer arranque**, junto con `DISABLE_SELF_REGISTRATION=true`. En producción la primera cuenta registrada no se promueve — consulta [Tu primer administrador](#tu-primer-administrador). |
| **NODE_ENV** | `NODE_ENV=production`. Es lo que cierra la ventana de bootstrap, rechaza el almacenamiento local de ficheros, exige `CORS_ORIGINS` y apaga la documentación OpenAPI. Un despliegue que se queda con el valor por defecto está corriendo en modo desarrollo. |
| **Esquema de la base de datos** | El arranque crea las tablas de tus colecciones de forma aditiva. Ejecuta `pnpm run db:push` (o `pnpm run db:migrate`) para la RLS de las tablas de unión y para todo lo que no sea puramente aditivo. |
| **JWT_SECRET** | Usa una cadena aleatoria criptográficamente fuerte (≥ 32 caracteres). Nunca la reutilices entre entornos. |
| **DATABASE_URL** | Usa una instancia de Postgres gestionada (Neon, Supabase, RDS) con TLS habilitado |
| **CORS_ORIGINS** | Siempre, no solo cuando el frontend está en otro dominio. El runtime se niega a arrancar en producción sin `CORS_ORIGINS` ni `FRONTEND_URL`, porque una API que adivina sus orígenes permitidos acaba permitiendo el equivocado. |
| **Control de acceso al almacenamiento** | Un bucket configurado **se niega a arrancar en producción** sin un modelo de control de acceso. El almacenamiento no está bajo seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, así que un valor por defecto permisivo deja que cualquier usuario autenticado liste (`GET /storage/list?prefix=`) y luego lea, sobrescriba o borre los ficheros de todos los demás. Satisfazlo con un hook `storageAuthorize` o con `storagePolicies` (el scaffold incluye un hook en `config/storage.ts`), o declara la intención con `STORAGE_PUBLIC_READ` para una CDN pública de verdad, o `STORAGE_ALLOW_ANY_AUTHENTICATED` para una app de un solo inquilino donde se confía cada fichero a cada cuenta. |
| **Backend de almacenamiento** | `STORAGE_TYPE=local` se **descarta** en producción, y las subidas responden `501 STORAGE_NOT_CONFIGURED` — el sistema de archivos del contenedor se destruye en el siguiente reinicio, así que un backend local es pérdida de datos silenciosa. Usa `s3` o `gcs`, o define `FORCE_LOCAL_STORAGE=true` si la ruta es de verdad un volumen duradero. |
| **MFA_ENCRYPTION_KEY** | Defínela (32+ caracteres aleatorios) si usas TOTP. Sin ella, los secretos almacenados se cifran con `JWT_SECRET` — así que rotarlo cierra la sesión de todo el mundo *y* deja indescifrable cada autenticador registrado. |
| **HTTPS** | Termina TLS en tu proxy inverso (nginx, Cloudflare, balanceador de carga) |
| **Las lecturas públicas siguen necesitando un llamante** | `access: "public"` amplía qué *filas* ve un llamante, no quién puede llamar: una petición anónima a `/api/data/*` responde 401 mientras `AUTH_REQUIRE` esté activo. Pon `AUTH_REQUIRE=false` para un sitio público que lee su propio backend y deja que RLS decida por sí solo. Es una variable de entorno, así que un `.env` local que la defina **no** viaja con tu despliegue. |

## Módulos Nativos en el Runtime Gestionado

El runtime gestionado de Rebase Cloud ejecuta tu bundle dentro de una imagen
compartida. No tiene compilador ni forma de cargar un **módulo nativo** —
cualquier cosa que incluya un binario `.node` precompilado. El más común con
diferencia es `sharp`, que además es la dependencia obvia para cualquier cosa
que sirva imágenes.

`rebase cloud deploy` lo rechaza antes de subir nada, no después:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tres salidas, en el orden en que suelen ser la correcta:

1. **Mueve el trabajo al build.** Redimensiona y recodifica las imágenes en tu
   paso de build y despliega los resultados. Nada nativo se ejecuta en la ruta
   de la petición.
2. **Usa un servicio.** Un CDN de imágenes o una API de transformación hace el
   mismo trabajo detrás de una URL.
3. **Ejecuta tu propio contenedor.** Un despliegue autogestionado (Docker,
   Kubernetes, cualquiera de las
   [guías por plataforma](/docs/deployment/self-hosting)) es tu imagen, así que
   puede llevar lo que quiera.

Las funciones que solo necesitan Node y no un binario nativo no dan problema —
el despliegue las reporta por separado (`1 of 3 function(s) depend on Node`) y
las ejecuta.

## Sirviendo el Frontend

En producción, el backend puede servir el frontend como una SPA estática:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compila primero el frontend:

```bash
cd frontend && pnpm build
```

De esta forma solo necesitas desplegar un servidor que gestione tanto la SPA como la API.

## Guías de Despliegue por Plataforma

Guías detalladas paso a paso para cada plataforma:

| Plataforma | Tipo | Guía |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Desplegar en AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Desplegar en GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Desplegar en Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Desplegar en Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Contenedores Serverless | [Desplegar en Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (autodetecta el Dockerfile) | [Desplegar en Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de contenedores | [Desplegar en Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run y otras plataformas serverless son sin estado. Usa **almacenamiento S3** en lugar del sistema de archivos local para las subidas de archivos, y establece `--min-instances 1` si usas las funciones de tiempo real de Rebase (las conexiones WebSocket se terminan cuando las instancias se reducen).
:::


## Cambiar la URL Base

Si quieres que el panel de administración se ejecute en una sub-ruta (p. ej. `/admin`), cambia una línea — el `path` de la app en `rebase.json`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin"
}
```

`rebase build` se lo pasa a Vite como `base` (mediante `REBASE_APP_BASE`), Vite lo devuelve como `import.meta.env.BASE_URL`, y el `main.tsx` del scaffold ya se lo entrega al router — así los assets, las rutas y el servidor coinciden sin escribir el prefijo en tres sitios:

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

El panel necesita un **data router** — `createBrowserRouter`, no el simple `BrowserRouter` — porque el bloqueo de cambios sin guardar usa `useBlocker`, que solo proporciona el data router.

**Backend** — si también mueves la API, actualiza su ruta base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montar sin un `basename` de router]
El enfoque de `basename` anterior es el recomendado — react-router elimina el
prefijo de la ubicación, por lo que el administrador funciona sin cambios. Si en su lugar incrustas el
administrador dentro de una **ruta con prefijo de path** de una app más grande (p. ej. `<Route path="/admin/*">`)
sin `basename`, la ruta actual conserva su prefijo `/admin`. Informa al CMS al
respecto para que la resolución URL⇄colección tenga en cuenta el prefijo — de lo contrario las vistas se quedan en un
spinner sin obtener datos:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Establece **o bien** el `basename` del router **o bien** `RebaseCMS basePath` — no ambos, o el
prefijo se aplica dos veces.
:::

### App de Producto + Administrador en un Solo Despliegue

La razón habitual para mover el administrador a `/admin` es distribuir tu **propia app de producto**
en la raíz del mismo despliegue. Un único punto de entrada de Vite puede servir ambos, dividido por URL,
de modo que cada app se carga de forma diferida y los visitantes del producto nunca descargan el bundle del administrador:

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

Un único router para ambas mitades: el panel necesita el data router de todas formas, y no hay razón para que la app de producto esté en otro.

El backend no necesita cambios para este patrón — la API permanece en `/api` y el catch-all de la SPA
sirve `index.html` tanto para `/` como para `/admin/*`.

## Próximos Pasos

- **[Resumen del Backend](/docs/backend)** — Configuración completa del backend
- **[Configuración de Almacenamiento](/docs/backend/storage)** — Configuración de S3 para producción
