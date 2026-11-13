---
sourceHash: 87e4ee6ea63add18
title: Scripts y la Consola
sidebar_label: Scripts y la Consola
description: Abra los datos de un proyecto desde un script, una prueba o un REPL con openRebase, o desde la terminal con rebase console. Sin servidor, sin cambios en el esquema.
---

## Descripción general

Para ver algunas filas, corregir una, probar un filtro o verificar lo que una
política le permite ver a un usuario, no debería tener que iniciar un servidor.
Rebase le proporciona los datos del proyecto como un objeto, en dos lugares:

- **`rebase console`**, un REPL de Node en su terminal con el proyecto abierto;
- **`openRebase`**, el mismo objeto en un script o en una prueba propia.

Ambos abren la base de datos sin modificarla: no se crea ninguna tabla, rol,
trigger o función. El `close()` de un script finaliza lo que `openRebase` abrió.
En la base de datos de desarrollo administrada, `rebase console` inicia esa base
de datos cuando no se está ejecutando y la deja en ejecución posteriormente, tal
como lo hacen los comandos `rebase db`; `rebase db stop` la detiene. El objeto
tiene el vocabulario que una [función personalizada](/docs/backend/custom-functions/)
obtiene del servidor, `dataAsAdmin` y `sql`, por lo que un fragmento de código
se traslada entre una función, un script y la consola sin cambios.

## `rebase console`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Ejecútelo en su proyecto:

```bash
rebase console
```

```text
> const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 })
> data.map(p => p.title)
[ 'Draft', 'Second post', 'Hello' ]
> const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] })
> (await ada.data.posts.find({ limit: 3 })).data.length
3
```

Hay dos nombres disponibles en el alcance y `await` de nivel superior funciona:

| Nombre | Qué es |
|---|---|
| `rebase` | Lo que devuelve [`openRebase`](#openrebase): `dataAsAdmin`, `sql`, `withAuth(user)` y `close()` |
| `tables` | Los descriptores de las tablas que sirve el proyecto, cargados desde `backend/schema` de la misma manera que los carga `rebase db push` (`rebase.tables`) |

La consola abre el proyecto de la misma manera que lo hace `rebase db push`: el
mismo `.env`, la misma base de datos y las mismas tablas, desde `backend/schema`.
También carga los `hooks` globales desde `backend/hooks.ts`, por lo que sus
operaciones de escritura ejecutan los mismos hooks que una escritura del
servidor. Un proyecto en la base de datos de desarrollo administrada la inicia
primero. El historial de lo que ha escrito se guarda en
`.rebase/console_history`, el cual el `.gitignore` del scaffold ya omite.

La entrada enviada mediante tuberías (pipes) se ejecuta línea por línea, cada
una después de que el `await` de la línea anterior se haya resuelto, de modo que
la transcripción anterior funciona como `printf '…\n…\n' | rebase console`.
Cualquier cosa después de `.exit` se ignora, y los valores se colorean solo en
una terminal. Todo lo que la consola registra va a stderr.

### Un único fragmento: `--eval`

`rebase console -e "<code>"` ejecuta un fragmento de código en lugar del REPL.
El valor de una expresión, o el `return` del cuerpo de una función, se espera
con `await` y se imprime como JSON en stdout, por lo que la salida se puede
redirigir a través de tuberías:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Todo lo que la consola registra, independientemente de lo que indique
`LOG_LEVEL`, va a stderr, por lo que stdout contiene el resultado y nada más.
Un fragmento que lance un error lo imprimirá en stderr y saldrá con código `1`.

Una base de datos que la consola no pueda abrir se reporta una vez y sale con
código `1`: el banner "Cannot connect to PostgreSQL" que imprimen los comandos
`db` o, en la base de datos de desarrollo administrada, que no tiene conexiones
libres. Esa base de datos solo acepta unas pocas conexiones a la vez y una
instancia en ejecución de `rebase dev` mantiene algunas ocupadas, así que cierre
otro cliente o detenga `rebase dev` y ejecútelo de nuevo.

### Opciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Flag | Qué hace |
|---|---|
| `--eval`, `-e` | Ejecuta este código en lugar del REPL, imprime su resultado esperado con await como JSON y sale con 1 si lanza un error |
| `--schema-dir` | El directorio de esquemas, si no es el del propio proyecto (`backend/schema`, o la clave `tables` de `rebase.json`) |
| `--database-url` | Abre esta base de datos en lugar de la del proyecto |
| `--docker` | Usa la base de datos de docker compose, iniciándola si es necesario |

## `openRebase`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`openRebase` de `@rebasepro/server-postgres` es lo que llama la consola. Úselo
en un script, un seed, una corrección de datos o una prueba. En un proyecto
generado a partir de un scaffold, coloque el script dentro de `backend/`, por
ejemplo en `backend/scripts/publish-drafts.ts`: el workspace de backend es el que
depende de `@rebasepro/server-postgres`, y un script en la carpeta raíz
`scripts/` no puede importarlo.

`openRebase` recibe las tablas compiladas del proyecto: `compileSchema` de
`@rebasepro/common` convierte los resultados de `defineTable` en las tablas
sobre las que opera el driver, hooks incluidos. Coloque eso en un módulo
compartido por los scripts, `backend/scripts/tables.ts`, después de añadir
`@rebasepro/common` a `backend/package.json`:

```typescript no-verify
import { compileSchema } from "@rebasepro/common";
import * as schema from "../schema";

// Every table the index exports, and the defaultRls its "inherit" tables take.
export const tables = compileSchema(
    [schema.users, schema.posts, schema.authors, schema.tags],
    { defaultRls: schema.defaultRls }
);
```

Pase los hooks globales que exporta `backend/hooks.ts` como `hooks`, y las
escrituras del script los ejecutarán al igual que lo hace una escritura del
servidor; sin ellos, un `beforeSave` global que estampe un tenant o escriba una
fila de auditoría no se ejecutará en ninguna escritura del script. Omita
`tables` y `openRebase` leerá las tablas desde la base de datos, tal como lo hace
un servidor sin `backend/schema`. `rebase console` carga ambos por usted.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Ejecútelo desde `backend/`. `rebase db url` imprime la URL de la base de datos
que utiliza el proyecto, incluida la de desarrollo administrada:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Miembro | Qué hace |
|---|---|
| `dataAsAdmin` | Cada tabla, leída y escrita como la identidad de servicio del servidor (`{ uid: "service", roles: ["admin"] }`): admin, y aun así evaluada por sus políticas de RLS, exactamente como `rebase.dataAsAdmin` en una función |
| `sql(query, { params })` | SQL sin procesar (raw SQL) en la conexión propietaria, con la misma convención de llamada que `rebase.sql` en una función. Se ejecuta en la única fuente de datos abierta: cualquier otra especificada con `{ database }` es rechazada |
| `withAuth(user)` | Resuelve a `{ data }`: las tablas tal como las ve ese usuario. Cada lectura y escritura se ejecuta como si fuera dicho usuario, filtrada por la seguridad a nivel de fila (RLS), tal como lo estaría una solicitud HTTP proveniente de ese usuario |
| `tables` | Los descriptores de las tablas que sirve: las que se le proporcionaron o las que describió la base de datos |
| `close()` | Finaliza el pool de conexiones que creó `openRebase`. Es seguro llamarlo dos veces |

Sus opciones:

| Opción | Qué hace |
|---|---|
| `databaseUrl` | La base de datos a abrir. `openRebase` crea el pool y `close()` lo finaliza |
| `connection` | Una conexión de Drizzle que ya tenga (`createPostgresDatabaseConnection(url).db`), en lugar de `databaseUrl`. Sigue siendo suya: `close()` la deja abierta |
| `tables` | Las tablas del proyecto, compiladas con `compileSchema` (ver arriba). Si está ausente o vacío, las lee de la base de datos, tal como lo hace un servidor sin `backend/schema`, y las sirve en modo de solo lectura |
| `pool` | Configuración del pool, con `databaseUrl` |
| `dataSourceKey` | La base de datos desde la que se sirven estas tablas. Predeterminado: `(default)` |
| `hooks` | Los hooks globales del proyecto: los `hooks` que exporta `backend/hooks.ts`, los cuales el servidor ejecuta antes de los de cada tabla. Páselos aquí y una escritura del script los ejecutará también. `rebase console` hace esto por usted |

`openRebase` no lee ninguna variable de entorno. La `DATABASE_URL` anterior es
leída por su script, y configuraciones como `REBASE_DB_POOL_MAX` o
`REALTIME_CDC` no cambian nada aquí.

Al abrirse no registra nada a nivel `info`, por lo que el stdout de un script
contiene lo que el script imprime, y `tsx scripts/report.ts > report.json`
escribe únicamente su JSON. Las advertencias y errores van a stderr en
desarrollo. La nota sobre cómo se aíslan las solicitudes (`RLS enforcement active`)
se registra a nivel `debug`; el arranque de un servidor todavía la imprime a
nivel `info`. Una base de datos a la que no puede conectarse rechaza la apertura
con un único error, `Cannot connect to PostgreSQL at <host>:<port>: <reason>.`,
y no registra nada: qué imprimir es decisión de la llamada del script.

Sus descriptores de acceso (accessors) están tipados por el `Database` que
registra `rebase generate-sdk --register`, al igual que el `rebase` de una
función, por lo que una tabla, campo o valor de enum mal escrito en un script es
un error de tipo. El `backend/tsconfig.json` del scaffold incluye `scripts/`,
por lo que `tsc --noEmit` en `backend/` lo notificará. Sin un registro,
especifíquelo por llamada con `openRebase<Database>({ … })`;
`OpenedRebase<Database>` es el tipo que se debe asignar a un helper que reciba
uno. Sin ninguno de los dos, las filas no tendrán tipos definidos, razón por la
cual el primer ejemplo convierte `draft.id` con `String()`.

### Comprobar lo que un usuario puede ver

`withAuth` es la forma más rápida de probar una regla de seguridad contra datos
reales. El scaffold del blog, el predeterminado de `rebase init`, declara
reglas en `posts`: un usuario que ha iniciado sesión sin ningún rol lee
publicaciones publicadas y ningún borrador, y solo un administrador puede
escribir una. (Las otras tablas indican `rls: "inherit"` y toman el `defaultRls`
en `backend/schema/index.ts`). Esto comprueba ambas partes, como
`backend/scripts/ada-check.ts`:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads published posts, and no drafts…
const { data: seen } = await ada.data.posts.find();
console.log(seen.every(post => post.status === "published"));

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

// SQL as Ada runs under the same policies: her rows, read-only unless { write: true }.
const counted = await ada.sql("SELECT count(*)::int AS n FROM posts");
console.log(Number(counted[0]?.n) === seen.length);

await rebase.close();
```

Ejecútelo de la misma forma en que se ejecuta el primer script, e imprimirá
`true` tres veces:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Una regla que filtra filas por propietario se comprueba de la misma manera:
compare el campo de propietario de cada fila con el `uid` que proporcionó. En
el scaffold del blog ninguna regla hace esto, y `authorId` en una publicación es
el id de una fila de autor, no de un usuario.

Un usuario es `{ uid, roles?, isAnonymous?, claims? }`; `claims` es lo que
`rebase.jwt()` lee en una política.

`withAuth` se ejecuta con el rol restringido que crea el arranque del servidor
(`rebase_user`). Frente a una base de datos en la que no se haya iniciado ningún
servidor de Rebase, ese rol no existe y las solicitudes con `withAuth` fallarán
con el error de rol desconocido de Postgres en lugar de ejecutarse sin filtros.
Ejecute `rebase db push` o arranque el servidor una vez primero.

### En una prueba

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, tables });
});
after(() => rebase.close());

test("a signed-in user reads published posts only and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    assert.ok(seen.every(post => post.status === "published"));
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Guárdelo como `backend/scripts/posts.test.ts` y ejecútelo desde `backend/` con
el test runner de Node, apuntando `TEST_DATABASE_URL` a una base de datos en la
que se haya iniciado un servidor Rebase:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

Lo mismo funciona bajo Vitest o Jest.

### Tablas con historial

Una escritura en una tabla con [`history: true`](/docs/backend/history/)
registra su entrada de la misma manera que lo hace una escritura del servidor.
La entrada se escribe en la propia transacción de la fila, por lo que una
escritura que se revierte (rollback) no deja ninguna entrada. Se registra con
la identidad con la que se ejecutó la escritura: `service` para `dataAsAdmin`, o
el `uid` del usuario bajo `withAuth`. Las escrituras desde `rebase console` se
registran de la misma manera.

`openRebase` no crea nada en lo que registrar. Si ningún backend con historial
se ha iniciado en la base de datos, la tabla `rebase.entity_history` no
existirá. En ese caso, una escritura en una tabla con historial se rechazará
con [`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes)
antes de que se ejecute cualquiera de sus hooks, y el mensaje indicará qué es
lo que falta. Las lecturas funcionan como siempre. Inicie el backend una vez
con el historial activado (`rebase dev` lo hace), y las escrituras se procesarán.

Las entradas se registran, nunca se purgan. La retención es una configuración
del servidor que un script no puede ver, por lo que el servidor las purga como
de costumbre: la próxima vez que escriba la entidad y en su barrido horario.

### Lo que deja fuera

`openRebase` abre la capa de datos y nada más. No inicia un sistema en tiempo
real por sí mismo, pero sus escrituras aún llegan a las consultas en vivo (live
queries): los triggers de captura de cambios de la base de datos notifican cada
escritura, sin importar quién la haya realizado, por lo que los suscriptores en
un servidor en ejecución también vuelven a consultar los datos después de un
backfill. Solo con `REALTIME_CDC=off` en ese servidor no se anuncian. Consulte
[Captura de cambios en la base de datos](/docs/backend/realtime-cdc/). El
almacenamiento (storage), el correo electrónico, la administración de
autenticación y sus funciones no están disponibles en él.

Los hooks propios de cada tabla se ejecutan en cada escritura, como en el
servidor. Los hooks globales del proyecto solo se ejecutan cuando los pasa en la
opción `callbacks`. `rebase console` los pasa por usted: lee los `hooks` que
exporta su `backend/hooks.ts`, por lo que un `beforeSave` global también se
ejecuta en sus escrituras. Si ese archivo no se puede importar (por ejemplo,
requiere una variable de entorno que no se le proporcionó a la consola), la
consola imprime una línea indicando que los hooks globales están desactivados
para la sesión y se abre sin ellos.

Cuando un script también los necesite, compile el backend sin servirlo:
`createRebaseBackend({ …, provision: false })` le proporciona `backend.rebase`,
el cliente completo en proceso, sin nada montado ni iniciado. Consulte
[el backend sin servidor](/docs/backend/custom-server/#the-backend-without-a-server).
Para probar el hook de una tabla sin ninguna base de datos, llámelo con
[`createCallContext`](/docs/collections/callbacks/#testing-a-hook).

## Relacionado

- [Integración de servidor personalizada](/docs/backend/custom-server/) — el backend como piezas públicas
- [Referencia de la CLI](/docs/cli/) — todos los comandos de `rebase`
- [Reglas de seguridad](/docs/collections/security-rules/) — aquello por lo que se filtra `withAuth`
