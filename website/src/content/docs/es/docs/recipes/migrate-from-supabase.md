---
sourceHash: 76cb1578ad9289ff
title: "Receta: Migración desde Supabase"
sidebar_label: Migración desde Supabase
description: "Mueve un proyecto de Supabase a Rebase: introspecciona el esquema, aplica los objetos SQL que no son tablas, copia los datos manteniendo los ID de usuario, migra las edge functions y despliega, todo desde la CLI."
---

## Descripción general

Esto traslada un proyecto de Supabase (tablas, seguridad a nivel de fila, funciones SQL y disparadores, usuarios, un bucket de almacenamiento, edge functions) a un proyecto de Rebase, primero localmente y luego en [Rebase Cloud](/docs/deployment/cloud/). Todo se realiza mediante comandos de CLI. Para seguir ejecutando la aplicación sobre la base de datos de Supabase en lugar de abandonarla, consulta [Supabase](/docs/deployment/existing-database/#supabase) en la página de bases de datos existentes.

El orden importa: genera las tablas desde el **origen** y luego apunta el proyecto al **destino** antes de que se realice cualquier escritura.

## 1. Generar las tablas

Introspecciona la base de datos de Supabase o una copia local de la misma. `SUPABASE_DB_URL` a continuación es su cadena de conexión directa como el rol `postgres` (panel de control de Supabase: Connect → Direct connection); configúrala primero en tu shell:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` traduce lo que una base de datos de Rebase no tiene:

| En Supabase | Escrito como |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: el servidor escribe el id del invocador |
| `owner_id uuid references auth.users(id)` | `col.text().userId()` y la clave foránea listada bajo "Not carried over" |
| `auth.uid()` en una política | `rebase.uid()` |
| `TO authenticated` / `TO anon` | el rol se descarta y la regla requiere un invocador autenticado / no autenticado |
| una política únicamente `TO service_role` | descartada: el código del servidor se ejecuta en el propio contexto del servidor |
| índices simples | los `indexes` de la tabla |

Las columnas de ID de usuario se convierten en `text` porque `rebase.users.id` y `rebase.uid()` son de tipo texto: una columna `uuid` comparada con `rebase.uid()` en una política fallará.

La ejecución finaliza con una lista de lo que **no** se transfirió (funciones, disparadores, extensiones, restricciones CHECK, otros índices, claves foráneas compuestas) y escribe el SQL de cada uno en `backend/sql/_introspected-left-behind.sql`, un borrador que `rebase db push` no aplicará hasta que le cambies el nombre.

## 2. Apuntar el proyecto a la nueva base de datos

`DATABASE_URL` todavía apunta a Supabase tras el paso 1, y la salida de introspección así lo indica. Cámbialo (o elimínalo para usar la base de datos de desarrollo administrada) antes del primer push:

```bash
rebase db push
```

## 3. Aplicar los objetos SQL

Edita `backend/sql/_introspected-left-behind.sql` del mismo modo en que se editaron las tablas: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, sin `GRANT … TO anon, authenticated`. Las funciones que llamaban a `pg_net` funcionan mejor como una [función personalizada](/docs/backend/custom-functions/). Asegúrate de que cada instrucción sea segura de volver a ejecutar (`DROP TRIGGER IF EXISTS` antes de cada `CREATE TRIGGER`), luego renombra el archivo eliminando el `_` inicial y haz push:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` aplica cada archivo `.sql` de `backend/sql` en orden alfabético, después de las tablas y antes de las políticas, y registra cada uno mediante su hash en `rebase.sql_files`, de modo que un archivo solo se vuelve a ejecutar si cambia. Un despliegue los aplica de la misma manera (paso 8).

Una función que el navegador llamaba con `supabase.rpc('fn')` se declara con [`defineRpc`](/docs/backend/rpc/), junto a las tablas. Luego se expone en `POST /api/rpc/<name>` y se ejecuta como el invocador bajo seguridad a nivel de fila, de modo que una función `SECURITY DEFINER` se comporta igual que en Supabase:

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

Solo las funciones declaradas son invocables, y cada función `public` tiene límite de tasa. Una función que escriba datos necesita `write: true`.

## 4. Copiar los datos manteniendo los ID de usuario

Conserva los ID de usuario de Supabase para que cada `owner_id` continúe apuntando a su usuario: importa primero los usuarios con sus ID y luego las tablas de la aplicación. `rebase users import` crea las cuentas con los ID que tenían, incluyendo sus hashes de contraseña de Supabase al pasar `--password-hashes bcrypt`, no envía correos y omite aquellos cuyo ID o correo ya exista, por lo que se puede volver a ejecutar. Llega a Rebase Cloud como cualquier otro comando de `rebase users` (`--project <slug>`, o `--cloud` en un directorio vinculado).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt
rm users.csv
```

Informa de cada cuenta como creada, omitida o fallida junto con la causa, y sale con código 1 si alguna falla. Consulta [Importación de cuentas](/docs/cli/project/#importing-accounts) para ver las columnas que lee (`display_name` y `roles` también).

Luego, traslada las tablas de la aplicación utilizando `pg_dump` contra el origen y el destino. `TARGET_URL` es la cadena de conexión de la nueva base de datos: tu `DATABASE_URL` o, en Rebase Cloud, el `connectionString` que `rebase cloud db connect --reveal` imprime durante su ejecución.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Las contraseñas se transfieren como sus hashes. Supabase almacena bcrypt en `auth.users.encrypted_password`, por lo que cada usuario inicia sesión con la contraseña que ya tiene, bajo el mismo ID de antes, y su primer inicio de sesión reemplaza el hash por el propio de Rebase. Una cuenta que no tenía contraseña (magic link, un proveedor) tendrá un `encrypted_password` vacío e iniciará sesión de la misma forma que lo hacía. Omite la columna y el flag para importar sin contraseñas: esos usuarios iniciarán sesión con un enlace mágico, un código por correo o un restablecimiento de contraseña.

## 5. Almacenamiento

Un bucket público de Supabase se asigna a un origen de [almacenamiento](/docs/backend/storage/) con rutas bajo `public/`, las cuales se sirven sin token. Copia los objetos con cualquier cliente S3, manteniendo sus claves.

## 6. Edge functions

Una edge function de Deno se convierte en una [función personalizada](/docs/backend/custom-functions/) en `backend/functions/`. Las sustituciones habituales:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` dentro del handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` o `rebase.sql` en el servidor |
| un cliente con el JWT del usuario | `getSql(c)`: SQL como el invocador, bajo seguridad a nivel de fila |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([trabajo en segundo plano](/docs/backend/background-work/)) |

Supabase permite que una edge function se ejecute durante 150 s; el valor predeterminado de Rebase es 30 s. Una función que llame a un LLM debe declarar su propio tiempo de espera, el cual el servidor limita a `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s por defecto):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Pasa `getSignal(c)` al `fetch` que llama al modelo para que la invocación se interrumpa si la solicitud se cancela. Consulta [el tiempo de espera propio de una función](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. Correo de inicio de sesión

El inicio de sesión mediante magic link o código por correo requiere un servicio de correo electrónico. Configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` (`rebase cloud env set` en Cloud). Sin ellos, la ruta responde con 503 y `rebase cloud status` reporta `blockedOn: email_not_configured`.

## 8. Despliegue

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

El despliegue aplica `backend/sql` del mismo modo que `rebase db push`: el bundle incluye los archivos, y el arranque de la nueva revisión ejecuta cada archivo nuevo o modificado una vez, después de las tablas y antes de las políticas. Un archivo que falle detiene el arranque e indica el archivo causante, garantizando que los errores se detecten durante el despliegue y no en la aplicación en ejecución.
