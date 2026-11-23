---
sourceHash: 690d0ebb30684b40
title: Funciones SQL como RPC
sidebar_label: Funciones SQL (RPC)
description: "Exponga una función de Postgres en POST /api/rpc/<name> con defineRpc: declarada por función, argumentos validados, ejecutada como el invocador bajo seguridad a nivel de fila, con límite de peticiones para las públicas."
---

Una función SQL que declare con `defineRpc` se sirve en `POST /api/rpc/<name>`,
con sus argumentos con nombre como cuerpo JSON. Se ejecuta como el invocador, de
la misma manera que lo hace `getSql(c)`: un invocador anónimo como la identidad
anónima, uno autenticado como él mismo, por lo que la seguridad a nivel de fila
de las tablas se aplica dentro de la función, y una función `SECURITY DEFINER` se
ejecuta como su propietario. Esto es lo que hace `supabase.rpc('fn', args)`, sin
tener que escribir un manejador por función.

Solo se pueden invocar las funciones declaradas. Una función que existe en la
base de datos y nadie ha declarado responde con `404 RPC_NOT_FOUND`.

## Cómo declarar una

Las declaraciones se ubican junto a las tablas, en `backend/schema/`, y el índice
del esquema las exporta:

```typescript
// backend/schema/rpc.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",
    args: { token: json.string().required() }
});

export const myTrips = defineRpc("my_trips", {
    access: "authenticated",
    args: { from: json.date(), limit: json.number().validate({ integer: true, max: 100 }) }
});

export const bookTrip = defineRpc("book_trip", {
    access: "authenticated",
    write: true,
    args: { trip_id: json.number().required() }
});
```

```typescript
// backend/schema/index.ts
export * from "./rpc";
```

La función en sí es código SQL que usted crea en la base de datos, por ejemplo
desde un archivo en `backend/sql/`:

```sql
CREATE OR REPLACE FUNCTION public.get_public_proposal(token text)
RETURNS public.proposals
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.proposals p WHERE p.share_token = get_public_proposal.token $$;
```

El nombre es el nombre de la función tal como Postgres lo almacena (un
`CREATE FUNCTION getProposal` sin comillas se almacena como `getproposal`), y
también el segmento de la URL. `schema` tiene como valor predeterminado `"public"`.
Al igual que con una tabla, un RPC definido en un archivo dentro de `backend/schema/`
que el índice no exporta detiene el arranque, al igual que un nombre declarado dos veces.

| Opción | Significado |
|---|---|
| `access` | Requerido. `"public"`: cualquiera, haya iniciado sesión o no, siempre con límite de tasa. `"authenticated"`: cualquier invocador con una identidad (una sesión, una sesión de invitado, una clave API, la clave de servicio); uno anónimo obtiene `401` |
| `args` | Los argumentos con nombre, un campo `json.*` por parámetro SQL. Ausente: la función no recibe ninguno |
| `schema` | El esquema de Postgres en el que se encuentra la función. Por defecto `"public"` |
| `write` | Ejecuta la llamada en modo lectura-escritura. Desactivado por defecto: la llamada es de solo lectura y puede ser atendida por una réplica de lectura |
| `rateLimit` | `{ limit, windowMs }` por invocador para esta función. Un RPC público sin esto se limita a 120 llamadas por minuto |
| `description` | Lo que hace, para quien lea las declaraciones |

## Cómo llamar a una

Desde el SDK:

```typescript
const proposal = await rebase.rpc<Proposal | null>("get_public_proposal", { token });
const trips = await rebase.rpc<Trip[]>("my_trips", { limit: 20 });
```

A través de HTTP:

```bash
curl -X POST https://your-app.example.com/api/rpc/get_public_proposal \
  -H "content-type: application/json" \
  -d '{"token": "f1c2…"}'
```

Una llamada autenticada envía su token como en cualquier otra ruta. Los argumentos
pueden tiparse a partir de la declaración, la cual el frontend importa únicamente
como tipo:

```typescript
import type { RpcArgs } from "@rebasepro/server/schema";
import type { myTrips } from "../../backend/schema/rpc";

const args: RpcArgs<typeof myTrips> = { limit: 20 };
const trips = await rebase.rpc<Trip[]>("my_trips", args);
```

## Argumentos

El cuerpo se comprueba contra `args` antes de que nada llegue a la base de datos.
Una clave que `args` no nombra, un argumento `.required()` que falta y un valor del
tipo incorrecto (un número para `json.string()`, una cadena que no es una fecha para
`json.date()`) se rechazan junto con `400 VALIDATION_CONSTRAINT`, indicando cada
infracción el nombre de su campo (`filters.from`, `tags[2]`). Las reglas que
acepta una columna JSON también se aplican: `.validate({ min, max, pattern, … })`, `.oneOf([...])`.

Un argumento omitido no se pasa, por lo que se aplica el `DEFAULT` propio de la
función SQL; un `.default(value)` en el campo lo completa en su lugar. Un argumento
enviado como `null` se pasa como `NULL`.

Los valores llegan a la función como un único parámetro vinculado, un objeto JSON
que Postgres convierte a los tipos de parámetro de la función (`json_to_record`),
por lo que un arreglo se convierte en un `integer[]`, un objeto en un `jsonb`, una
cadena ISO en un `timestamptz`. Nunca se escriben dentro del texto de la sentencia.
Un valor que Postgres no pueda interpretar como el tipo del parámetro genera un
`400 RPC_INVALID_ARGUMENT`.

## Qué responde

La respuesta sigue el tipo de retorno de la función, al igual que PostgREST:

| La función devuelve | La respuesta |
|---|---|
| `SETOF <table>`, `TABLE (…)` | un arreglo de filas |
| `SETOF integer` (cualquier valor individual) | un arreglo de valores |
| un tipo de fila, o parámetros `OUT` | la fila, o `null` cuando es `NULL` |
| un valor individual (`bigint`, `text`, `jsonb`, …) | el valor |
| `void` | `null` |

Los valores se representan tal como los representa `/api/data`: un `timestamptz`
en RFC 3339, un `bigint` como número cuando cabe.

## Como quién se ejecuta

Cada llamada abre una transacción como el invocador, con la misma identidad que
utiliza la API de datos, por lo que una función `SECURITY INVOKER` (por defecto)
ve exactamente las filas que las políticas del invocador le permiten, y
`rebase.uid()` dentro de ella es el invocador. Un invocador anónimo de un RPC
público se ejecuta como la identidad anónima: una política que requiere un
usuario le oculta todas las filas. Una función `SECURITY DEFINER` se ejecuta como
el rol propietario de la misma, que es la forma en que una función entrega a un
invocador anónimo una fila mediante un token sin abrirle la tabla completa.

Una clave API que restringe lo que puede hacer necesita `data:read` para llamar a
un RPC, o `data:write` para uno declarado con `write: true`, sin restricciones
adicionales: una función lee cualquier tabla que deba leer.

## Escrituras

Una llamada se ejecuta en modo de solo lectura a menos que el RPC indique
`write: true`. Una función que inserte, actualice o elimine sin esto fallará con
`500 RPC_READ_ONLY`. Una escritura aún debe cumplir con las políticas de
inserción y actualización de las tablas como el invocador.

## Límites de tasa

Cada RPC `public` está limitado por invocador (por ID de usuario cuando ha
iniciado sesión, por dirección IP en caso contrario): 120 llamadas por minuto a
menos que declare `rateLimit`. El conteo reside donde el backend almacena sus
[límites de tasa de funciones](/docs/backend/function-rate-limits/), por lo que
`REBASE_RATE_LIMIT_STORE=sql` lo comparte entre réplicas. Al superarlo, la llamada
responde con `429 RATE_LIMITED` junto con `Retry-After`. Las llamadas también
consumen el presupuesto de la API de datos del invocador. Un RPC `authenticated`
solo se limita cuando declara `rateLimit`.

## Errores desde la función

`RAISE EXCEPTION 'This proposal has expired'` responde con `400 RPC_EXCEPTION`
con ese mensaje, y `details.sqlState`, `detail` e `hint`.
`RAISE SQLSTATE 'PT404'` responde con el código de estado posterior a `PT`, como en PostgREST.
Cada código de RPC se encuentra listado en [Errores](/docs/backend/errors/#sql-functions-as-rpc).

## En el entorno de ejecución administrado y Rebase Cloud

No hay nada que configurar: las declaraciones forman parte de `backend/schema`,
el cual `rebase build` incluye en el paquete (bundle), y el entorno de ejecución
las lee donde lee las tablas. La función en sí debe existir en la base de datos
que utiliza el despliegue.

Un backend expulsado (ejected) que pasa `schemaDir` las lee desde el mismo
índice; uno que pasa sus tablas como valores pasa sus RPCs de la misma manera:

```typescript
await initializeRebaseBackend({ app, server, tables, rpc: [getPublicProposal, myTrips], /* … */ });
```

Los RPC forman parte de la superficie de datos: un proceso que no sirve
`/api/data` (`REBASE_ROLE=functions`) no sirve `/api/rpc`, y se ejecutan en la
base de datos predeterminada.

## Qué no hace

- Las llamadas son únicamente `POST`; un `GET` a un nombre declarado responde con `405`.
- Solo se pueden pasar parámetros con nombre. Una función cuyos parámetros no
  tengan nombre, o que devuelva `SETOF record` sin parámetros `OUT`, no se puede
  invocar de esta manera.
- Entre sobrecargas de un mismo nombre, la llamada llega a aquella cuyos
  parámetros con nombre aceptan exactamente los argumentos enviados; dos
  funciones que coincidan causan un `500 RPC_AMBIGUOUS`.

Para lógica que no sea una sola función SQL, escriba una [función personalizada](/docs/backend/custom-functions/)
y ejecute SQL en ella con `getSql(c)`.
