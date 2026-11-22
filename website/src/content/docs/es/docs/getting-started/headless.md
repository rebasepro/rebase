---
sourceHash: c423ff16c60af471
title: Solo backend (headless)
sidebar_label: Solo backend
description: Ejecuta Rebase como un Backend-as-a-Service headless sobre tu propio PostgreSQL — una API REST, autenticación, almacenamiento y tiempo real, sin panel de administración ni backend/schema.
---

Rebase tiene dos formas, y esta página trata sobre la que nunca abre un navegador: una
API REST, autenticación, almacenamiento, tiempo real y copias de seguridad sobre una base de datos PostgreSQL que
ya tengas. Sin panel de administración, sin `backend/schema/`. Si estabas
pensando en Supabase o PostgREST, esto es lo equivalente.

Todo lo que se describe en esta página también funciona en el proyecto completo: es el mismo servidor.
Lo que `--headless` elimina es el paquete de frontend y los archivos de tablas, no
una funcionalidad.

## Genera la estructura

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Un solo espacio de trabajo (workspace), sin `frontend/`:

| Carpeta | Qué contiene |
|---------|--------------|
| `backend/` | `storage.ts` (`storageAuthorize`), tus funciones personalizadas y crons, y el `backend/schema/` que escribe `--introspect` cuando lo solicitas. No hay ningún archivo de servidor: el runtime publicado inicializa el proyecto |

`--template` no tiene efecto aquí: un preset genera tablas iniciales, y esta variante no
tiene ninguna. Node 22.22+, el mismo requisito mínimo que el proyecto completo: el
`package.json` de la capa headless declara `"node": ">=22.22.0"` y reemplaza al que
está debajo.

## Apúntalo a tu base de datos

`init` genera un archivo `.env` listo para usar. Para utilizar una base de datos que ya tengas en ejecución, pasa
su URL durante la creación de la estructura:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

O configura `DATABASE_URL` en `.env` después; es lo mismo. Sin
`DATABASE_URL`, `rebase dev` inicia un PostgreSQL administrado (PGlite) en el directorio
del proyecto, lo cual es útil para probar la API, pero no es el propósito de esta
variante.

Luego:

```bash
pnpm install
pnpm run dev
```

**Lee la URL en la salida.** `rebase dev` deriva un puerto libre a partir de la
ruta del proyecto en lugar de usar uno fijo, por lo que varía entre proyectos y
entre máquinas.

## De dónde provienen las tablas

No hay ninguna en el código: sin un archivo `backend/schema/index.ts`, el backend no declara ninguna tabla. El servidor lee el esquema de tu base de datos al arrancar y sirve
las tablas que encuentra, de modo que la API sigue tus migraciones: cambia el esquema y
los endpoints cambiarán con él.

Una tabla se sirve una vez que se habilita la seguridad a nivel de fila (RLS) en ella. Sin ninguna política,
se sirve pero no devuelve ninguna fila, y el arranque advierte sobre ello; una política le da acceso:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` y `rebase.jwt()` son instaladas por Rebase y
leen la identidad de la solicitud autenticada. Consulta
[Seguridad a nivel de fila](/docs/collections/security-rules/) para conocer el vocabulario de las políticas,
y [rls-check](/docs/rls-check/) para obtener una auditoría de lo que realmente
permiten tus políticas.

Una tabla sin RLS se **omite** deliberadamente: cada solicitud autenticada
se ejecuta como `rebase_user`, por lo que servir una tabla que no esté protegida por la seguridad a nivel de fila
entregaría cada fila a cualquier usuario que haya iniciado sesión. Cada tabla omitida se indica en el arranque junto con el SQL
necesario para protegerla.

Una tabla intermedia (join table) no se sirve en ningún caso: se lee como el enlace entre las dos
tablas que une. Si tiene RLS desactivado, también se indicará en el arranque.

La comprobación se ejecuta durante el arranque. Si más tarde se deshabilita RLS en una tabla que se está sirviendo, continuará
sirviéndose hasta que el próximo arranque la omita. La [auditoría programada](/docs/rls-check/)
lo reporta antes, y está desactivada por defecto.

:::note
`baas: { unprotectedTables: "serve" }` las sirve de todos modos. Es una
opción de `initializeRebaseBackend`, por lo que solo está disponible tras ejecutar `rebase eject` —
el runtime administrado no la lee desde ningún archivo ni desde el entorno. Solo tiene sentido cuando ya se confía en todos los emisores de solicitudes.
:::

### Generar archivos de tabla en su lugar

Si prefieres tener las tablas definidas en TypeScript (para tipos,
hooks o revisión de código), inspecciónalas:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` y requiere `--install`, ya que se ejecuta
contra la CLI instalada. En un proyecto existente, el equivalente es:

```bash
pnpm rebase schema introspect
```

Los archivos se generan en `backend/schema/`: un `defineTable` por tabla, con sus columnas,
relaciones y sus políticas como `rls`, junto con un archivo `index.ts` que las exporta. A partir
de ese momento, el proyecto tiene tablas en código y la introspección durante el arranque deja de
ser lo que define la API.

La estructura headless
instala Atlas en `backend/`, por lo que `rebase db push`, `rebase db generate`
y `pnpm run db:migrate` funcionan en esas tablas como en cualquier otro proyecto.

## Úsalo

A través de HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

O con el cliente con seguridad de tipos (type-safe), que ya es una dependencia
de la estructura headless:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.table("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [API REST](/docs/backend/api/) — las estructuras de los endpoints, filtros y errores
- [SDK tipado](/docs/sdk/) — consultas, autenticación, tiempo real, almacenamiento
- `/api/docs` — el documento OpenAPI, servido por el backend en ejecución una vez que
  sirve una tabla, a un usuario autenticado (las tablas que tiene permiso para ver). Configura
  `REBASE_ENABLE_SWAGGER=true` para publicarlo a todo el mundo, con la interfaz de Swagger UI
  en `/api/swagger` fuera de producción. Un proyecto sin tablas no sirve
  ninguno de los dos: el documento se genera a partir de las tablas

## `404 NO_TABLES`

Si cada solicitud de datos responde con esto:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

significa que el proyecto no declara tablas en código *y* la base de datos no le
proporcionó nada que servir. Antes de la versión 0.31, el código era `NO_COLLECTIONS`. Es la primera respuesta esperada de un proyecto headless
apuntado a una base de datos vacía, y es un error 404 en lugar de un 500 porque
no hay nada roto: simplemente aún no hay nada que servir.

Tres cosas pueden resolverlo, en el orden en que conviene verificarlas:

1. **La base de datos no tiene tablas.** Créalas —mediante una migración, SQL puro o un
   archivo `defineTable` junto con `rebase db push`— y reinicia.
2. **Las tablas no tienen habilitada la seguridad a nivel de fila (RLS)**, por lo que el arranque las omitió.
   El registro de arranque indica cada una de ellas junto con el SQL necesario. Habilítala y añade una política,
   como se explicó anteriormente. La
   respuesta también lo indica: su mensaje menciona las tablas y proporciona el
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` correspondiente, y
   `details.unprotectedTables` las lista.
3. **`DATABASE_URL` apunta a un lugar diferente** del que crees. `rebase status`
   muestra los tres archivos que determinan a qué se conecta el backend.

## Añadir un panel de administración más adelante

Nada en esta configuración te impide hacerlo. Un solo comando añade el directorio `frontend/` que
`rebase init` sin `--headless` habría generado, con su espacio de trabajo y
su aplicación en `rebase.json`:

```bash
pnpm rebase apps add admin               # at /, or at /admin when another app is at /
pnpm rebase apps add admin --path /admin
pnpm install
pnpm run dev
```

Escribe lo que `rebase init` sin `--headless` habría generado, a partir de las mismas
plantillas:

- `frontend/`, con `rebaseBackendGuard()` en su configuración de Vite. El panel de administración renderiza
  cada tabla que sirve el backend a partir de `GET /api/schema/tables`, sin necesidad de un archivo por
  tabla; la personalización de `users` solo se incluye cuando
  `backend/schema/users.ts` declara la tabla de autenticación como lo hace el andamiaje inicial. Las
  personalizaciones propias del panel van en `frontend/src/cms/`.
- la aplicación `admin` en `rebase.json`, con `cms` en su ruta y un comando de compilación
  en el gestor de paquetes del proyecto. Si el proyecto no tiene un archivo `rebase.json`, se crea uno.
- `frontend` en los `workspaces` de `package.json` y en `pnpm-workspace.yaml`.
- si hay tablas en el código (`backend/schema/index.ts`, creadas manualmente o mediante
  `rebase schema introspect`), los scripts `db:push`, `db:generate` y
  `schema:generate` de la plantilla, la compilación del backend que ejecuta
  `rebase schema generate` primero, y `ts-morph`. Cualquier script que hayas modificado se conservará
  y se notificará.

Cada paquete `@rebasepro/*` se fija a la versión que el proyecto ya está utilizando
(priorizando la de `@rebasepro/server`), no a la de la CLI. Un proyecto que solo fija
especificaciones `link:` o `workspace:` recibe la versión de la CLI y se le notifica.

La operación se rechaza si `frontend/` ya existe, si una aplicación ya se llama `admin` o
declara el CMS, o si `--path` ya está en uso o no es una ruta en la que se pueda
servir una aplicación. Un rechazo no altera nada, y tampoco lo hace una escritura que falle a
mitad del proceso: cada archivo se restaura. Con `--json`, imprime lo que escribió o el
objeto de error. Consulta [Frontend Setup](/docs/frontend/) para más información sobre el frontend en sí.

## Próximos pasos

- [Autenticación](/docs/backend/authentication/) — proveedores, tokens, claves de API
- [Seguridad a nivel de fila](/docs/collections/security-rules/) — el modelo de acceso
- [Funciones personalizadas](/docs/backend/custom-functions/) — tus propias rutas
- [Despliegue](/docs/getting-started/deployment/) — llevarlo a producción
