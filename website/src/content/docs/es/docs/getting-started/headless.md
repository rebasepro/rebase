---
sourceHash: a43be9786395a654
title: Solo backend (headless)
sidebar_label: Solo backend
description: Ejecuta Rebase como un Backend-as-a-Service headless sobre tu propio PostgreSQL — una API REST, autenticación, almacenamiento y tiempo real, sin panel de administración ni archivos de colecciones.
---

Rebase tiene dos formas, y esta página corresponde a la que nunca abre un navegador: una
API REST, autenticación, almacenamiento, tiempo real y copias de seguridad sobre una base de datos PostgreSQL que
ya tengas. Sin panel de administración, sin archivos de colecciones. Si estabas
considerando Supabase o PostgREST, esto es lo equivalente.

Todo lo que aparece en esta página también funciona en el proyecto completo: es el mismo servidor.
Lo que elimina `--headless` es el paquete de frontend y los archivos de colecciones, no
una funcionalidad.

## Crear la estructura inicial

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Dos espacios de trabajo, sin `frontend/`:

| Carpeta | Qué contiene |
|---------|--------------|
| `backend/` | Tus funciones personalizadas y tareas cron. No hay archivo de servidor: el runtime publicado arranca el proyecto |
| `config/` | `storageAuthorize` y cualquier colección que `--introspect` genere |

`--template` no tiene efecto aquí: un preset genera archivos de colecciones iniciales, y esta
variante no tiene ninguno. Node 22.22+, el mismo requisito mínimo que el proyecto completo: el
`package.json` del overlay headless declara `"node": ">=22.22.0"` y reemplaza al que
está debajo.

## Apuntarlo a tu base de datos

`init` genera un archivo `.env` listo para ejecutar. Para usar una base de datos que ya tengas en ejecución, pasa
su URL en el momento de la inicialización:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

O define `DATABASE_URL` en `.env` posteriormente; es lo mismo. Sin
`DATABASE_URL`, `rebase dev` inicia un PostgreSQL administrado (PGlite) en el directorio
del proyecto, lo cual es útil para probar la API pero no es para lo que está pensada
esta variante.

Luego:

```bash
pnpm install
pnpm run dev
```

**Lee la URL en la salida.** `rebase dev` obtiene un puerto libre a partir de la
ruta del proyecto en lugar de usar uno fijo, por lo que variará entre proyectos y
entre máquinas.

## De dónde provienen las colecciones

No hay ninguna en el código. El servidor lee el esquema de tu base de datos durante el arranque y expone
las tablas que encuentra, de modo que la API sigue tus migraciones: cambia el esquema y
los endpoints cambiarán con él.

Una tabla se expone una vez que se habilita la seguridad a nivel de fila (RLS) en ella. Sin ninguna directiva,
se expone pero no devuelve filas, y el arranque advierte sobre ello; una directiva le da acceso:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` y `rebase.jwt()` son instaladas por Rebase y
leen la identidad de la solicitud autenticada. Consulta
[Reglas de seguridad](/docs/collections/security-rules/) para conocer el vocabulario de las directivas,
y [rls-check](/docs/rls-check/) para una auditoría de lo que tus directivas realmente
permiten.

Una tabla sin RLS se **omite**, deliberadamente: cada solicitud autenticada
se ejecuta como `rebase_user`, por lo que exponer una tabla que la seguridad a nivel de fila no proteja
entregaría cada fila a cualquier llamador autenticado. Cada tabla omitida se menciona en el arranque junto con el SQL
que la protegería.

Una tabla de unión no se expone de ninguna manera, ya que nunca se convierte en una colección.
Si tiene RLS desactivado, también se menciona en el arranque.

La verificación se ejecuta en el arranque. Si más adelante se deshabilita RLS en una tabla expuesta, seguirá
expuesta hasta que el siguiente arranque la omita. La [auditoría programada](/docs/rls-check/)
lo reporta antes y está desactivada por defecto.

:::note
`baas: { unprotectedTables: "serve" }` las expone de todos modos. Es una
opción de `initializeRebaseBackend`, por lo que solo es accesible después de `rebase eject`:
el runtime administrado no la lee desde `config/index.ts` ni desde el
entorno. Solo tiene sentido cuando ya se confía en todos los llamadores.
:::

### Generar archivos de colección en su lugar

Si prefieres tener las tablas definidas como TypeScript —para tipos,
callbacks o revisión—, realiza una introspección:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` y requiere `--install`, ya que se ejecuta
contra la CLI instalada. En un proyecto existente, lo equivalente es:

```bash
pnpm rebase schema introspect
```

Los archivos se guardan en `config/collections/`. A partir de ese momento, el proyecto tiene colecciones
en el código y la introspección en tiempo de arranque deja de ser lo que define la API.

La estructura inicial
headless instala Atlas en `backend/`, por lo que `rebase db push`, `rebase db generate`
y `pnpm run db:migrate` funcionan en esas colecciones como en cualquier proyecto. En la versión 0.24,
cada uno de ellos se detiene con "The atlas binary is missing"; agrégalo al backend con
`pnpm --dir backend add @ariga/atlas`.

## Cómo usarlo

A través de HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

O con el cliente con seguridad de tipos, que ya es una dependencia de la
estructura headless:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.collection("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [API REST](/docs/backend/api/) — la estructura de los endpoints, filtros y errores
- [SDK tipado](/docs/sdk/) — consultas, autenticación, tiempo real, almacenamiento
- `/api/docs` y `/api/swagger` — el documento OpenAPI y su visor, servidos
  por el backend en ejecución una vez que tiene una colección. Un proyecto sin ninguna no sirve
  ninguno de los dos: el documento se genera a partir de las colecciones, por lo que no hay nada
  que describir hasta que se haya ejecutado la sección anterior

## `404 NO_COLLECTIONS`

Si cada solicitud de datos responde con esto:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

significa que el proyecto no declara colecciones en el código *y* la base de datos no le dio
nada a partir de lo cual derivarlas. Es la primera respuesta esperada de un proyecto headless
apuntado a una base de datos vacía, y es un 404 en lugar de un 500 porque
no hay nada roto: simplemente no hay nada que servir todavía.

Tres cosas lo resuelven, en el orden en que conviene comprobarlas:

1. **La base de datos no tiene tablas.** Créalas —una migración, SQL directo o un
   archivo de colección más `rebase db push`— y reinicia.
2. **Las tablas no tienen habilitada la seguridad a nivel de fila**, por lo que el arranque las
   omitió. El registro de arranque nombra cada una, junto con el SQL. Habilítala y añade una directiva,
   como se indicó anteriormente. La respuesta
   también lo indica: su mensaje nombra las tablas y proporciona el
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` para ellas, y
   `details.unprotectedTables` las lista. En la versión 0.24 indica que la base de datos no tiene
   tablas.
3. **`DATABASE_URL` apunta a un lugar diferente** del que crees. `rebase status`
   imprime los tres archivos que determinan a qué se conecta el backend.

## Agregar un panel de administración más adelante

Nada aquí te impide hacerlo. Añade un directorio `config/collections/` —a
mano o con `rebase schema introspect`— y un frontend que las renderice; el
backend no cambia. [Configuración del frontend](/docs/frontend/) es donde comienza ese proceso.

## Siguientes pasos

- [Autenticación](/docs/backend/authentication/) — proveedores, tokens, claves de API
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/) — el modelo de acceso
- [Funciones personalizadas](/docs/backend/custom-functions/) — tus propias rutas
- [Despliegue](/docs/getting-started/deployment/) — llevarlo a producción
