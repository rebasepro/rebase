---
sourceHash: 9cda7971a27b0475
title: Solo backend (headless)
sidebar_label: Solo backend
description: Ejecuta Rebase como un Backend-as-a-Service headless sobre tu propio PostgreSQL — una API REST, autenticación, almacenamiento y tiempo real, sin panel de administración ni backend/schema.
---

Rebase tiene dos formas, y esta página corresponde a la que nunca abre un navegador: una
API REST, autenticación, almacenamiento, tiempo real y copias de seguridad sobre una base de datos PostgreSQL
que ya tengas. Sin panel de administración, sin `backend/schema/`. Si estabas
pensando en Supabase o PostgREST, esto es lo equivalente.

Todo lo que aparece en esta página también funciona en el proyecto completo — es el mismo servidor.
Lo que elimina `--headless` es el paquete frontend y los archivos de tablas, no
una funcionalidad.

## Crear la estructura

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Un único workspace, sin `frontend/`:

| Carpeta | Qué contiene |
|--------|---------------|
| `backend/` | `storage.ts` (`storageAuthorize`), tus funciones personalizadas y tareas cron, y el `backend/schema/` que escribe `--introspect` cuando lo solicitas. No hay ningún archivo de servidor — el runtime publicado arranca el proyecto |

`--template` no tiene ningún efecto aquí: un preset inicializa tablas con datos semilla, y esta variante
no tiene ninguna. Node 22.22+, el mismo requisito mínimo que el proyecto completo — el `package.json`
de la capa headless declara `"node": ">=22.22.0"` y reemplaza al que
está debajo.

## Conéctalo a tu base de datos

`init` genera un archivo `.env` listo para usar. Para utilizar una base de datos que ya tengas en ejecución, pasa
su URL en el momento de crear la estructura:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

O configura `DATABASE_URL` en el archivo `.env` después — es exactamente lo mismo. Sin
`DATABASE_URL`, `rebase dev` inicia un PostgreSQL administrado (PGlite) en el directorio
del proyecto, lo cual es útil para probar la API, pero no es el propósito de esta variante.

Luego:

```bash
pnpm install
pnpm run dev
```

**Lee la URL en la salida.** `rebase dev` obtiene un puerto libre a partir de la
ruta del proyecto en lugar de usar uno fijo, por lo que variará entre proyectos y
entre máquinas.

## De dónde provienen las tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

No hay ninguna en el código: sin un `backend/schema/index.ts`, el backend no declara tablas. El servidor lee el esquema de tu base de datos durante el arranque y expone
las tablas que encuentra, de modo que la API sigue tus migraciones: cambia el esquema y
los endpoints cambiarán con él.

Una tabla se expone una vez que se habilita row-level security (RLS) en ella. Sin ninguna política,
se expone pero no devuelve filas, y el arranque mostrará una advertencia al respecto; una política la habilita:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` y `rebase.jwt()` son instaladas por Rebase y
leen la identidad de la solicitud autenticada. Consulta
[Row-level security](/docs/collections/security-rules/) para conocer el vocabulario de las políticas,
y [rls-check](/docs/rls-check/) para auditar lo que tus políticas realmente
permiten.

Una tabla sin RLS se **omite**, deliberadamente: cada solicitud autenticada
se ejecuta como `rebase_user`, por lo que exponer una tabla que no esté protegida por row-level security
entregaría cada fila a cualquier llamador autenticado. Cada tabla omitida se indica durante el arranque junto con el SQL
necesario para protegerla.

Una tabla de unión (join table) no se expone de ninguna manera: se interpreta como el vínculo entre las dos
tablas que une. Si tiene RLS desactivado, también se indicará durante el arranque.

La comprobación se ejecuta en el arranque. Si posteriormente se desactiva RLS en una tabla expuesta, permanecerá
expuesta hasta que el siguiente arranque la omita. La [auditoría programada](/docs/rls-check/)
lo reporta antes, y está desactivada por defecto.

:::note
`baas: { unprotectedTables: "serve" }` las expone de todos modos. Es una
opción de `initializeRebaseBackend`, por lo que solo se puede acceder a ella después de ejecutar `rebase eject` —
el runtime administrado no la lee desde ningún archivo ni desde el entorno. Solo tiene sentido cuando ya se confía en todos los llamadores.
:::

### Generar archivos de tablas en su lugar

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Si prefieres tener las tablas definidas como TypeScript — para tipos,
hooks o revisión —, puedes introspeccionarlas:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` y requiere `--install`, ya que se ejecuta
contra la CLI instalada. En un proyecto existente, el equivalente es:

```bash
pnpm rebase schema introspect
```

Los archivos se generan en `backend/schema/`: un `defineTable` por tabla, con sus columnas,
relaciones y sus políticas como `rls`, junto con un `index.ts` que las exporta. A partir
de ese momento, el proyecto tiene tablas en el código y la introspección durante el arranque deja de
ser lo que define la API.

La estructura headless
instala Atlas en `backend/`, por lo que `rebase db push`, `rebase db generate`
y `pnpm run db:migrate` funcionan en esas tablas como en cualquier otro proyecto.

## Cómo usarlo

A través de HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

O con el cliente con seguridad de tipos (type-safe), que ya viene como dependencia de la estructura headless:

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

- [API REST](/docs/backend/api/) — la estructura de los endpoints, filtros y errores
- [SDK tipado](/docs/sdk/) — consultas, autenticación, tiempo real, almacenamiento
- `/api/docs` — el documento OpenAPI, servido por el backend en ejecución una vez que
  expone una tabla, para un llamador autenticado (las tablas que tiene permiso de ver). Configura
  `REBASE_ENABLE_SWAGGER=true` para publicarlo a todos, con la interfaz de Swagger
  en `/api/swagger` fuera de producción. Un proyecto sin tablas no sirve
  ninguno de los dos: el documento se genera a partir de las tablas

## `404 NO_TABLES`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Si cada solicitud de datos responde con esto:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

significa que el proyecto no declara tablas en código *y* la base de datos no le proporcionó
nada para exponer. Antes de la versión 0.31, el código era `NO_COLLECTIONS`. Es la primera respuesta esperada de un proyecto
headless apuntado a una base de datos vacía, y es un error 404 en lugar de un 500 porque
no hay nada roto — simplemente no hay nada para servir aún.

Tres cosas pueden resolverlo, en el orden en que vale la pena comprobarlas:

1. **La base de datos no tiene tablas.** Créalas — mediante una migración, SQL plano o un
   archivo `defineTable` más `rebase db push` — y reinicia.
2. **Las tablas no tienen row-level security habilitado**, por lo que el arranque las omitió.
   El log de arranque indica cada una de ellas junto con el SQL. Habilítalo y agrega una política,
   como se mostró anteriormente. La respuesta también lo indica: su mensaje nombra las tablas y proporciona el
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` correspondiente, y
   `details.unprotectedTables` las enumera.
3. **`DATABASE_URL` apunta a un lugar distinto** del que crees. `rebase status`
   muestra los tres archivos que determinan a qué se conecta el backend.

## Agregar un panel de administración más adelante

Nada de lo anterior te impide hacerlo más adelante. Agrega una carpeta `frontend/` que monte `<RebaseCMS />`:
este renderiza cada tabla que el backend expone, obtenida desde `GET /api/schema/tables`,
sin necesidad de un archivo por tabla. Escribe `backend/schema/` — manualmente o con
`rebase schema introspect` — cuando desees tener las tablas en código; las
personalizaciones propias del panel van en `frontend/src/cms/`. [Configuración del frontend](/docs/frontend/) es el punto de partida.

## Próximos pasos

- [Autenticación](/docs/backend/authentication/) — proveedores, tokens, claves de API
- [Row-level security](/docs/collections/security-rules/) — el modelo de acceso
- [Funciones personalizadas](/docs/backend/custom-functions/) — tus propias rutas
- [Despliegue](/docs/getting-started/deployment/) — llevarlo a producción
