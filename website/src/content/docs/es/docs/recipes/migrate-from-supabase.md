---
sourceHash: 4acb34e54a96f397
title: "Receta: Migración desde Supabase"
sidebar_label: Migración desde Supabase
description: "Mueve un proyecto de Supabase a Rebase: haz introspección del esquema, aplica los objetos SQL que no son tablas, copia los datos manteniendo los id de usuario, porta las edge functions y despliega, todo desde la CLI."
---

## Descripción general

Esto traslada un proyecto de Supabase (tablas, seguridad a nivel de fila, funciones y disparadores SQL, usuarios, un bucket de almacenamiento, edge functions) a un proyecto de Rebase, primero localmente y luego en [Rebase Cloud](/docs/deployment/cloud/). Todo se realiza mediante comandos de CLI. Para seguir ejecutándolo en la base de datos de Supabase en lugar de migrarla, consulta [Supabase](/docs/deployment/existing-database/#supabase) en la página de base de datos existente.

El orden importa: genera las tablas desde el **origen**, luego apunta el proyecto al **destino** antes de que se escriba nada.

## 1. Generar las tablas

Haz una introspección de la base de datos de Supabase, o de una copia local de la misma. `SUPABASE_DB_URL` a continuación es su cadena de conexión directa, como el rol `postgres` (panel de control de Supabase: Connect → Direct connection); configúrala primero en tu shell:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` traduce lo que una base de datos de Rebase no tiene:

| En Supabase | Escrito como |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: el servidor escribe el id del llamador |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, y la clave foránea listada bajo "Not carried over" |
| `auth.uid()` en una política | `rebase.uid()` |
| `TO authenticated` / `TO anon` | el rol se descarta y la regla requiere un llamador con sesión iniciada / sin sesión iniciada |
| una política únicamente `TO service_role` | descartada: el código del servidor se ejecuta en el propio contexto del servidor |
| índices simples | los `indexes` de la tabla |

Las columnas de id de usuario pasan a ser `text` porque `rebase.users.id` y `rebase.uid()` son de tipo texto: una columna `uuid` comparada con `rebase.uid()` en una política fallará.

La ejecución finaliza con una lista de lo que **no** se transfirió (funciones, disparadores, extensiones, restricciones CHECK, otros índices, claves foráneas compuestas) y escribe el SQL de cada uno en `backend/sql/_introspected-left-behind.sql`, un borrador que `rebase db push` no aplica hasta que lo renombres.

## 2. Apuntar el proyecto a la nueva base de datos

`DATABASE_URL` todavía apunta a Supabase después del paso 1, y la salida de la introspección así lo indica. Cámbiala (o elimínala, para usar la base de datos de desarrollo administrada) antes del primer push:

```bash
rebase db push
```

## 3. Aplicar los objetos SQL

Edita `backend/sql/_introspected-left-behind.sql` del mismo modo en que se editaron las tablas: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, sin `GRANT … TO anon, authenticated`. Las funciones que llamaban a `pg_net` es mejor implementarlas como una [función personalizada](/docs/backend/custom-functions/). Haz que cada sentencia sea segura de ejecutar otra vez (`DROP TRIGGER IF EXISTS` antes de cada `CREATE TRIGGER`), luego renombra el archivo sin el `_` inicial y haz push:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` aplica cada archivo `.sql` de `backend/sql` por orden de nombre, después de las tablas y antes de las políticas, y registra cada uno por hash en `rebase.sql_files`, de modo que un archivo se ejecuta de nuevo solo cuando cambia. Un despliegue los aplica del mismo modo (paso 8).

Una función a la que el navegador llamaba con `supabase.rpc('fn')` se declara con [`defineRpc`](/docs/backend/rpc/), junto a las tablas. Luego se sirve en `POST /api/rpc/<name>` y se ejecuta como el llamador bajo seguridad a nivel de fila, de modo que una función `SECURITY DEFINER` se comporta como lo hacía en Supabase:

```ts
// backend/schema/rpc.ts, exported from backend/schema/index.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",                         // supabase's anon key; "authenticated" for signed-in only
    args: { token: json.string().required() } // validated before the function runs
});
```

```ts
// in the browser: supabase.rpc("get_public_proposal", { token })
const proposal = await rebase.rpc("get_public_proposal", { token });
```

Solo se pueden invocar las funciones declaradas, y cada una de las de tipo `public` tiene limitación de tasa (rate limiting). Una que realice escrituras necesita `write: true`.

## 4. Copiar los datos manteniendo los id de usuario

Conserva los id de usuario de Supabase para que cada `owner_id` siga apuntando a su usuario: importa primero los usuarios, con sus id, y luego las tablas de la aplicación. `rebase users import` crea las cuentas con los id que tenían, sin contraseña y sin enviar correos electrónicos, y omite aquellas cuyo id o correo electrónico ya exista, por lo que se puede ejecutar nuevamente. Se conecta a Rebase Cloud como cualquier otro comando de `rebase users` (`--project <slug>`, o `--cloud` en un directorio vinculado).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv
```

Informa sobre cada cuenta como creada, omitida o fallida con el motivo, y finaliza con código de salida 1 si alguna falla. Consulta [Importación de cuentas](/docs/cli/project/#importing-accounts) para ver las columnas que lee (`display_name` y `roles` también).

Luego las tablas de la aplicación, con `pg_dump` contra el origen y el destino. `TARGET_URL` es la cadena de conexión de la nueva base de datos: tu `DATABASE_URL`, o en Rebase Cloud la `connectionString` que imprime `rebase cloud db connect --reveal` mientras se ejecuta.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Las contraseñas no se transfieren. Un usuario importado inicia sesión mediante un enlace mágico (magic link), un código por correo electrónico o un restablecimiento de contraseña, bajo el mismo id que antes.

## 5. Almacenamiento

Un bucket público de Supabase se asigna a un origen de [almacenamiento](/docs/backend/storage/) con rutas bajo `public/`, que se sirven sin un token. Copia los objetos con cualquier cliente S3, conservando sus claves.

## 6. Edge functions

Una edge function de Deno pasa a ser una [función personalizada](/docs/backend/custom-functions/) en `backend/functions/`. Las sustituciones habituales:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` dentro del handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` o `rebase.sql` en el servidor |
| un cliente con el JWT del usuario | `getSql(c)`: SQL como el llamador, bajo seguridad a nivel de fila |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([trabajo en segundo plano](/docs/backend/background-work/)) |

Supabase permite que una edge function se ejecute durante 150 s; el valor predeterminado de Rebase es de 30 s. Una función que invoca a un LLM declara su propio tiempo de espera (timeout), el cual el servidor limita a `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s por defecto):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Pasa `getSignal(c)` al `fetch` que llama al modelo, de modo que la llamada se detenga cuando finalice la solicitud. Consulta [el tiempo de espera propio de una función](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. Correo electrónico de inicio de sesión

El inicio de sesión mediante enlace mágico (magic link) y código de correo electrónico requiere un servicio de correo electrónico. Configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` (`rebase cloud env set` en Cloud). Sin ellos, la ruta responde con 503 y `rebase cloud status` informa `blockedOn: email_not_configured`.

## 8. Desplegar

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

El despliegue aplica `backend/sql` igual que `rebase db push`: el bundle incluye los archivos, y el arranque de la nueva revisión ejecuta una sola vez cada archivo nuevo o modificado, después de las tablas y antes de las políticas. Un archivo que falla detiene el arranque y nombra el archivo, de modo que un error en uno se ve en el despliegue, no en una aplicación en marcha.
