---
sourceHash: 668fde6c17984b6c
title: Scripts y la consola
sidebar_label: Scripts y la consola
description: Abre los datos de un proyecto desde un script, una prueba o un REPL con openRebase, o desde la terminal con rebase console. Sin servidor, sin cambios de esquema.
---

## Visión general

<span class="since-badge" data-since="0.25">Desde 0.25</span> En 0.24 no existe
`openRebase` ni `rebase console`: un script tiene que construir un backend, o
llamar a la API REST de un servidor en ejecución.

Para mirar unas cuantas filas, corregir una, probar un filtro o comprobar qué deja ver una política a un usuario,
no deberías tener que arrancar un servidor. Rebase te da los datos del proyecto
como un objeto, en dos lugares:

- **`rebase console`**, un REPL de Node en tu terminal con el proyecto abierto;
- **`openRebase`**, el mismo objeto en un script o en una prueba tuyos.

Ambos abren la base de datos sin cambiarla: no se crea ninguna tabla, rol, trigger ni
función. El `close()` de un script termina lo que abrió `openRebase`. En la base de
datos de desarrollo gestionada, `rebase console` inicia esa base de datos cuando no
está en ejecución y la deja en marcha después, como hacen los comandos `rebase db`;
`rebase db stop` la detiene. El objeto tiene el
vocabulario que una [función personalizada](/docs/backend/custom-functions/) recibe del
servidor, `dataAsAdmin` y `sql`, de modo que un fragmento de código pasa sin cambios entre una función, un script
y la consola.

## `rebase console`

<span class="since-badge" data-since="0.25">Desde 0.25</span>

Ejecútala en tu proyecto:

```bash
rebase console
```

```text
> const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 })
> data.map(p => p.title)
[ 'Hello', 'Second post', 'Draft' ]
> const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] })
> (await ada.data.posts.find()).data.length
1
```

Hay dos nombres en el ámbito, y `await` de nivel superior funciona:

| Nombre | Qué es |
|---|---|
| `rebase` | Lo que devuelve [`openRebase`](#openrebase): `dataAsAdmin`, `sql`, `withAuth(user)` y `close()` |
| `collections` | Las colecciones del proyecto, cargadas como las carga `rebase db push` |

La consola abre el proyecto como lo hace `rebase db push`: el mismo `.env`,
la misma base de datos y las mismas colecciones. Un proyecto en la base de datos
de desarrollo gestionada la tiene iniciada primero. El historial de lo que escribiste se
guarda en `.rebase/console_history`, que el `.gitignore` del scaffold ya
deja fuera.

La entrada canalizada se ejecuta línea a línea, cada una después de que el `await` de
la anterior se haya resuelto, así que la transcripción de arriba funciona como
`printf '…\n…\n' | rebase console`. Todo lo que viene después de `.exit` se ignora, y los
valores solo se colorean en una terminal. Todo lo que la consola registra va a stderr.

### Un solo fragmento: `--eval`

<span class="since-badge" data-since="0.25">Desde 0.25</span>

`rebase console -e "<code>"` ejecuta un fragmento de código en lugar del REPL. El valor
de una expresión, o el `return` del cuerpo de una función, se espera con `await` y se imprime como
JSON en stdout, de modo que la salida se puede canalizar (pipe):

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Todo lo que la consola registra, diga lo que diga `LOG_LEVEL`, va a stderr, de modo que
stdout contiene el resultado y nada más. Un fragmento que lanza un error imprime el error
en stderr y termina con código `1`.

### Opciones

| Flag | Qué hace |
|---|---|
| `--eval`, `-e` | Ejecuta este código en lugar del REPL, imprime su resultado esperado como JSON y termina con código 1 si lanza un error |
| `--collections`, `-c` | Ruta al directorio de colecciones, si no es el propio del proyecto |
| `--database-url` | Abre esta base de datos en lugar de la del proyecto |
| `--docker` | Usa la base de datos de docker compose, iniciándola si hace falta |

## `openRebase`

<span class="since-badge" data-since="0.25">Desde 0.25</span>

`openRebase` de `@rebasepro/server-postgres` es lo que llama la consola. Úsalo
en un script, un seed, una corrección de datos o una prueba. En un proyecto scaffold,
pon el script bajo `backend/`, por ejemplo `backend/scripts/publish-drafts.ts`: el
workspace del backend es el que depende de `@rebasepro/server-postgres`, y un script
en la carpeta `scripts/` de la raíz no puede importarlo.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Ejecútalo desde `backend/`. `rebase db url` imprime la URL de la base de datos que usa
el proyecto, incluida la de desarrollo gestionada:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Miembro | Qué hace |
|---|---|
| `dataAsAdmin` | Todas las colecciones, leídas y escritas con la identidad de servicio del servidor (`{ uid: "service", roles: ["admin"] }`): administrador, y aun así evaluado por tus políticas RLS, exactamente igual que `rebase.dataAsAdmin` en una función |
| `sql(query, { params })` | SQL en bruto sobre la conexión del propietario, con la misma convención de llamada que `rebase.sql` en una función |
| `withAuth(user)` | Se resuelve a `{ data }`: las colecciones tal como las ve ese usuario. Cada lectura y escritura se ejecuta como él, filtrada por la seguridad a nivel de fila, como lo sería una solicitud HTTP de ese usuario |
| `collections` | Las colecciones con las que se abrió |
| `close()` | Termina el pool de conexiones que creó `openRebase`. Se puede llamar dos veces sin problema |

Sus opciones:

| Opción | Qué hace |
|---|---|
| `databaseUrl` | La base de datos que se abre. `openRebase` crea el pool y `close()` lo termina |
| `connection` | Una conexión de Drizzle que ya tienes (`createPostgresDatabaseConnection(url).db`), en lugar de `databaseUrl`. Sigue siendo tuya: `close()` la deja abierta |
| `collections` | Las colecciones del proyecto. Un array vacío las lee de la base de datos en su lugar, como hace un servidor sin archivos de colección, y las sirve en modo de solo lectura |
| `pool` | Ajustes del pool, junto con `databaseUrl` |
| `dataSourceKey` | La fuente de datos desde la que se sirven estas colecciones. Por defecto `(default)` |

`openRebase` no lee ninguna variable de entorno. El `DATABASE_URL` de arriba lo lee
tu script, y ajustes como `REBASE_DB_POOL_MAX` o `REALTIME_CDC` no cambian
nada aquí.

Sus accesores se tipan con el `Database` que registra `rebase generate-sdk --register`,
como el `rebase` de una función, así que una colección, un campo o un valor de enum mal
escritos en un script son un error de tipos. Sin un registro, nómbralo en cada llamada
con `openRebase<Database>({ … })`; `OpenedRebase<Database>` es el tipo que hay que dar a
un helper que recibe uno. Sin ninguno de los dos, las filas no tienen tipo, por eso el
primer ejemplo convierte `draft.id` con `String()`.

### Comprobar qué puede ver un usuario

<span class="since-badge" data-since="0.25">Desde 0.25</span>

`withAuth` es la forma más rápida de probar una regla de seguridad con datos reales:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
const { data } = await ada.data.posts.find();
console.log(data.every(post => post.author_id === "ada"));
```

Un usuario es `{ uid, roles?, isAnonymous?, claims? }`; `claims` es lo que
lee `rebase.jwt()` en una política.

`withAuth` se ejecuta con el rol restringido que crea el arranque de un servidor (`rebase_user`).
Contra una base de datos en la que ningún servidor de Rebase ha arrancado, ese rol no existe, y
las solicitudes de `withAuth` fallan con el error de rol desconocido de Postgres en lugar de ejecutarse
sin filtrar. Ejecuta antes `rebase db push`, o arranca el servidor una vez.

### En una prueba

<span class="since-badge" data-since="0.25">Desde 0.25</span>

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, collections });
});
after(() => rebase.close());

test("a user only sees their own posts", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data } = await ada.data.posts.find();
    assert.ok(data.every(post => post.author_id === "ada"));
});
```

Ejecútala desde `backend/` con el ejecutor de pruebas de Node, apuntando `TEST_DATABASE_URL`
a una base de datos sobre la que haya arrancado un servidor de Rebase:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

Lo mismo funciona con Vitest o Jest.

### Colecciones con historial

<span class="since-badge" data-since="0.25">Desde 0.25</span>

Una escritura en una colección con [`history: true`](/docs/backend/history/) registra
su entrada igual que lo hace una escritura del servidor. La entrada se escribe en la
transacción de la propia fila, así que una escritura que se revierte no deja ninguna
entrada. Se registra con la identidad con la que se ejecutó la escritura: `service`
para `dataAsAdmin`, el `uid` del usuario con `withAuth`. Las escrituras desde
`rebase console` se registran del mismo modo.

`openRebase` no crea nada donde registrar. Si ningún backend con historial ha arrancado
sobre la base de datos, falta la tabla `rebase.entity_history`. Una escritura en una
colección con historial se rechaza entonces con
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) antes de que se
ejecute cualquiera de sus callbacks, y el mensaje nombra lo que falta. Las lecturas
funcionan como siempre. Arranca el backend una vez con el historial activado
(`rebase dev` lo hace) y las escrituras pasan.

Las entradas se registran, nunca se purgan. La retención es un ajuste del servidor que
un script no puede ver, así que el servidor las purga como de costumbre: cuando vuelve
a escribir la entidad, y en su barrido horario.

### Lo que deja fuera

<span class="since-badge" data-since="0.25">Desde 0.25</span>

`openRebase` abre la capa de datos y nada más. No inicia realtime, así que
sus escrituras no se anuncian a las consultas en vivo.
Almacenamiento, correo electrónico, administración de autenticación y tus funciones no están en él.

Cuando un script también necesita esas piezas, construye el backend sin servirlo:
`createRebaseBackend({ …, provision: false })` te da `backend.rebase`, el
cliente completo en el proceso, con nada montado y nada iniciado. Consulta
[el backend sin un servidor](/docs/backend/custom-server/#the-backend-without-a-server).
Para probar un callback de colección sin ninguna base de datos, llámalo con
[`createCallContext`](/docs/collections/callbacks/#testing-a-callback).

## Relacionado

- [Integración de servidor personalizado](/docs/backend/custom-server/) — el backend como piezas públicas
- [Referencia de la CLI](/docs/cli/) — cada comando `rebase`
- [Reglas de seguridad](/docs/collections/security-rules/) — lo que filtra `withAuth`
