---
sourceHash: 213cc853c469bd0c
title: Solo backend (headless)
sidebar_label: Solo backend
description: Ejecuta Rebase como un Backend-as-a-Service headless sobre tu propio PostgreSQL — una API REST, autenticación, almacenamiento y tiempo real, sin panel de administración ni archivos de colecciones.
---

Rebase tiene dos formas, y esta página corresponde a la que nunca abre un
navegador: una API REST, autenticación, almacenamiento, tiempo real y copias de
seguridad sobre una base de datos PostgreSQL que ya tengas. Sin panel de
administración, sin archivos de colecciones. Si estabas considerando Supabase o
PostgREST, esto es lo comparable.

Todo lo que aparece en esta página también funciona en el proyecto completo — es
el mismo servidor. Lo que `--headless` elimina es el paquete de frontend y los
archivos de colecciones, no una funcionalidad.

## Crear el scaffold

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Dos espacios de trabajo, sin `frontend/`:

| Carpeta | Qué contiene |
|---------|--------------|
| `backend/` | Tus funciones personalizadas y tareas cron. No hay archivo de servidor — el runtime publicado inicia el proyecto |
| `config/` | `storageAuthorize`, y cualquier colección que genere `--introspect` |

`--template` no tiene efecto aquí: un preset genera archivos de colecciones, y esta
variante no tiene ninguno. Node 22.22+, el mismo requisito mínimo que el proyecto
completo — el `package.json` del overlay headless declara `"node": ">=22.22.0"` y
reemplaza al que está debajo.

## Apúntalo a tu base de datos

`init` genera un `.env` listo para ejecutarse. Para usar una base de datos que ya
tengas en funcionamiento, pasa su URL en el momento del scaffold:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

O define `DATABASE_URL` en `.env` posteriormente — es lo mismo. Sin
`DATABASE_URL`, `rebase dev` inicia un PostgreSQL administrado (PGlite) en el
directorio del proyecto, lo cual es útil para probar la API, pero no es el
propósito de esta variante.

Luego:

```bash
pnpm install
pnpm run dev
```

**Lee la URL de la salida.** `rebase dev` obtiene un puerto libre a partir de la
ruta del proyecto en lugar de usar uno fijo, por lo que difiere entre proyectos y
entre máquinas.

## De dónde provienen las colecciones

No hay ninguna en el código. El servidor lee el esquema de tu base de datos al
arrancar y sirve las tablas que encuentra, de modo que la API sigue tus
migraciones: cambia el esquema y los endpoints cambiarán con él.

Una tabla se sirve una vez que cuenta con un modelo de autorización: seguridad a
nivel de fila (RLS) habilitada, además de al menos una política:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` y `rebase.jwt()` son instalados por Rebase y
leen la identidad de la solicitud autenticada. Consulta
[Security Rules](/docs/collections/security-rules/) para conocer el vocabulario
de políticas, y [rls-check](/docs/rls-check/) para auditar lo que tus políticas
realmente permiten.

Una tabla sin RLS se **omite**, deliberadamente: cada solicitud autenticada se
ejecuta como `rebase_user`, por lo que servir una tabla sin políticas entregaría
cada fila a cualquier usuario que haya iniciado sesión. Cada tabla omitida se
menciona durante el arranque junto con el SQL que la protegería.

:::note
`baas: { unprotectedTables: "serve" }` las sirve de todos modos. Es una opción
de `initializeRebaseBackend`, por lo que solo es accesible después de `rebase eject` —
el runtime administrado no la lee desde `config/index.ts` ni desde el entorno.
Solo tiene sentido cuando ya se confía plenamente en todos los emisores de solicitudes.
:::

### Generar archivos de colecciones en su lugar

Si prefieres tener las tablas definidas en TypeScript — para tipos, para
callbacks, para revisión —, realiza una introspección de las mismas:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` y requiere `--install`, ya que se
ejecuta contra la CLI instalada. En un proyecto existente, el equivalente es:

```bash
pnpm rebase schema introspect
```

Los archivos se generan en `config/collections/`. A partir de ese momento, el
proyecto tiene colecciones en el código y la introspección en tiempo de arranque
deja de ser lo que define la API.

## Uso

Mediante HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

O con el cliente con seguridad de tipos (type-safe), que ya es una dependencia
de la estructura inicial headless:

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

- [REST API](/docs/backend/api/) — la estructura de los endpoints, filtros y errores
- [Client SDK](/docs/sdk/) — consultas, autenticación, tiempo real, almacenamiento
- `/api/docs` y `/api/swagger` — el documento OpenAPI y su visualizador, servidos
  por el backend en ejecución una vez que tiene una colección. Un proyecto sin
  ninguna no servirá ninguno de los dos: el documento se genera a partir de las
  colecciones, por lo que no hay nada que describir hasta que se haya ejecutado
  la sección anterior

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

entonces el proyecto no declara colecciones en el código *y* la base de datos no
le proporcionó nada a partir de lo cual derivarlas. Es la primera respuesta
esperada de un proyecto headless apuntado a una base de datos vacía, y es un 404
en lugar de un 500 porque no hay nada roto — simplemente no hay nada que servir
todavía.

Tres cosas lo resuelven, en el orden en que conviene verificarlas:

1. **La base de datos no tiene tablas.** Créalas — una migración, SQL simple o
   un archivo de colección más `rebase db push` — y reinicia.
2. **Las tablas no tienen una política RLS**, por lo que el arranque las omitió.
   El registro de arranque menciona cada una. Añade una política, como se indicó
   anteriormente.
3. **`DATABASE_URL` apunta a un lugar diferente** al que crees. `rebase status`
   imprime los tres archivos que determinan a qué accede el backend.

## Añadir un panel de administración más adelante

Nada aquí te impide hacerlo. Añade un directorio `config/collections/` —
manualmente o con `rebase schema introspect` — y un frontend que las renderice;
el backend no cambia. [Frontend Setup](/docs/frontend/) es el punto de partida.

## Próximos pasos

- [Authentication](/docs/backend/authentication/) — proveedores, tokens, claves de API
- [Security Rules (RLS)](/docs/collections/security-rules/) — el modelo de acceso
- [Custom Functions](/docs/backend/custom-functions/) — tus propias rutas
- [Deployment](/docs/getting-started/deployment/) — llevarlo a producción

---
