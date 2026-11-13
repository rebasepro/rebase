---
sourceHash: 3bff62ceb5aceb62
title: Ejecución en una base de datos existente o compartida
sidebar_label: Base de datos existente o compartida
description: Ejecute Rebase en una base de datos PostgreSQL que no posee —un clúster compartido con otras aplicaciones, un segundo proyecto de Rebase, Supabase o una base de datos bloqueada por un DBA— con los ajustes de rls, rebase doctor --database y rebase db request-role migrate.
---

## El problema

Rebase ejecuta cada solicitud autenticada y anónima como un rol restringido
de Postgres, `rebase_user`, y permite que la seguridad a nivel de fila (RLS)
decida qué filas ve esa solicitud. El rol de conexión es el propietario de las
tablas y omite RLS; cada solicitud cambia a `rebase_user` dentro de su
transacción.

Esto funciona en una base de datos de la que Rebase es propietario exclusivo:
Rebase Cloud, la configuración de Docker que genera `rebase init`, la base de
datos de desarrollo administrada. Se basa en dos supuestos:

1. Solo el servidor de este proyecto puede convertirse en `rebase_user`.
2. Solo `rebase_user` y el propietario de la tabla tocan las tablas de Rebase.

Una base de datos que alguien ya administra a menudo rompe ambos:

- **Los roles pertenecen a todo el clúster, no a una sola base de datos.** Dos
  proyectos de Rebase en un clúster comparten el mismo `rebase_user`. De forma
  predeterminada, cada rol puede conectarse a cada base de datos y cualquiera
  puede establecer los ajustes de sesión que leen las políticas de Rebase, de
  modo que la conexión del proyecto A puede abrir la base de datos del proyecto
  B, cambiar a `rebase_user` y superar las políticas de B como administrador de B.
- **Los permisos cubren esquemas completos.** De forma predeterminada, Rebase
  otorga al rol de solicitud `SELECT, INSERT, UPDATE, DELETE` en cada tabla de
  `public` sobre la que pueda otorgar permisos, incluidas las tablas que
  pertenecen a otra aplicación.
- **Las políticas predeterminadas se aplican `TO public`.** La política base que
  Rebase agrega a cada tabla permite el acceso a cualquier sesión que nunca haya
  establecido la identidad de Rebase. Así es como pasan las propias consultas del
  servidor, y también permite la entrada a cualquier otro rol que tenga un
  permiso sobre la tabla, como el rol `anon` de Supabase a través de su Data API.
- **Las políticas existentes basadas en roles nunca se aplican.** Una política
  escrita como `TO authenticated` no se aplica a `rebase_user`, porque
  `rebase_user` no hereda los privilegios de otros roles.
- **Algunas bases de datos no permiten que la aplicación cree roles en absoluto.**
  Un DBA crea cada rol a mano, o los roles se administran en Terraform.

Cada uno de estos casos tiene un ajuste. Cada ajuste tiene como valor
predeterminado lo que hace Rebase sin él, por lo que un proyecto que no
configure nada se comporta exactamente como antes.

## Compruebe la base de datos primero

```bash
rebase doctor --database
```

Lee el catálogo de la base de datos del proyecto y no cambia nada. Informa:

- si cada rol de solicitud existe, está restringido y si esta conexión puede
  cambiar a él;
- otros roles de inicio de sesión que pueden cambiar al rol de solicitud;
- si cada rol en el clúster puede conectarse a esta base de datos;
- tablas en los esquemas de Rebase que Rebase no administra;
- otros roles que tienen privilegios sobre las tablas de Rebase;
- políticas en las tablas de Rebase escritas `TO` un rol que el rol de solicitud
  no hereda;
- privilegios predeterminados que otorgan nuevas tablas a otros roles.

Cada hallazgo viene con el SQL que se debe ejecutar como administrador de la
base de datos, el ajuste que adapta Rebase a la base de datos en su lugar, o
ambos. Finaliza con código 1 cuando un hallazgo es un fallo, por lo que puede
condicionar un despliegue. Comprueba la base de datos con los ajustes que puede
ver: las variables `REBASE_RLS_*`, y luego los roles de solicitud que el inicio
del servidor registró en la base de datos.

`npx @rebasepro/rls-check` audita las políticas en sí, en cualquier Postgres. En
una base de datos de Rebase, lee el rol de solicitud de la misma manera; indíquelo
con `--request-role` cuando aún no esté registrado.

## Los ajustes

Establézcalos en la declaración de la base de datos en `backend/resources.ts`:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

O desde el entorno, que tiene prioridad sobre la declaración. El entorno es lo
adecuado para un valor que difiere entre dos despliegues del mismo código, como el
nombre del rol cuando staging y producción comparten un clúster.

| Ajuste | Variable de entorno | Valor predeterminado | Alternativas |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un solo nombre) | `"rebase_user"` | Cualquier nombre de rol. `{ anonymous, signedIn }` para ejecutar a los remitentes sin sesión como un rol y a los que han iniciado sesión como otro. En el código del driver, una función de la identidad de la solicitud. |
| `requestRoles` | ninguna | derivado de `requestRole` | Cada rol que puede devolver un `requestRole` con valor de función, para que cada uno pueda ser aprovisionado, otorgado y verificado. Obligatorio con una función. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: crea el rol si falta y otorga a esta conexión el derecho de cambiar a él | `"never"`: el rol y la membresía son suyos. El inicio comprueba ambos y falla con el SQL a ejecutar. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: cada tabla y secuencia en los esquemas que sirve Rebase sobre las que la conexión puede otorgar permisos, más privilegios predeterminados para tablas creadas posteriormente | `"managed"`: solo las tablas que sirve Rebase, y sin privilegios predeterminados. `"none"`: Rebase no otorga nada; se rechaza una tabla a la que no haya otorgado permisos. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: las políticas permisivas se aplican solo al rol o roles de solicitud. Las políticas restrictivas se siguen aplicando a todos. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: las políticas que solo el contexto del servidor o un administrador pueden superar (la línea base, `roles: ["admin"]`) se escriben `TO rebase_admin`, y las solicitudes de administrador se ejecutan como `<rol de solicitud>_admin` | `"public"`: esas políticas son `TO public` y los administradores se ejecutan como el rol de solicitud, como antes de que existiera este ajuste. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: ninguna tabla recibe la línea base de servidor o administrador. El `defaultPolicies: false` propio de una tabla sigue decidiendo por ella. |
| `inheritRoles` | ninguna | `[]` | Roles otorgados al rol de solicitud `WITH INHERIT TRUE`, para que se apliquen las políticas escritas `TO` ellos. Con un rol de solicitud `{ anonymous, signedIn }`, solo el autenticado los recibe; con una función, el ajuste se rechaza. PostgreSQL 16 y más reciente; rechazado en 15 y anteriores. |
| `identity` | `REBASE_RLS_IDENTITY` (formas con nombre) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: también `request.jwt.claims`, `request.jwt.claim.sub` y `request.jwt.claim.role`, para que `auth.uid()` y `auth.jwt()` vean al remitente. En el código del driver, una función que devuelve ajustes adicionales. Los ajustes `app.*` siempre se configuran. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` cuando otro inicio de sesión puede cambiar al rol de solicitud | `"refuse"`: falla el inicio. `"ignore"`: no dice nada. |

Las formas de función de `requestRole` e `identity` se aceptan solo en el propio
bloque `rls` del driver, que admite los mismos ajustes. `policyTarget`,
`adminPolicies` y `defaultPolicies` cambian el SQL de políticas que escribe
`rebase db generate`, y la CLI no puede leer el código del driver, así que
configúrelos en la declaración o en el entorno. Un inicio que solo los encuentre
en el código del driver se negará a arrancar.

Al iniciar, la línea que informa cómo se aíslan las solicitudes enumera cada
ajuste que no esté en su valor predeterminado. Un ajuste que le delega una tarea,
como `grants: "none"`, indica una vez cuál es esa tarea.

El primer inicio de aprovisionamiento registra el rol (o roles) de solicitud en
`rebase.schema_meta`. Un inicio posterior configurado con un rol diferente se
negará a arrancar e indicará el comando que migra la base de datos, a
continuación. Sin esa comprobación, el rol anterior mantendría sus permisos
mientras se configuraba uno nuevo junto a él.

## Recetas

### Un clúster compartido con otras aplicaciones o proyectos

Asigne a cada proyecto y a cada despliegue que comparta un clúster un rol propio:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Una base de datos que ya se ha ejecutado como `rebase_user` lo tiene registrado,
así que primero migre el rol:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

El comando crea el nuevo rol si falta, vuelve a emitir solo en esta base de datos
cada permiso que posee el rol anterior (tablas, columnas, secuencias, esquemas,
funciones, los privilegios predeterminados que estableció esta conexión y
membresías), redirige las políticas que nombran al rol anterior y registra el
nuevo rol. Se ejecuta en una sola transacción. El rol anterior se deja tal como
está, porque otra base de datos en el clúster aún podría usarlo. Cuando finaliza,
imprime las sentencias `REVOKE` que retiran los permisos del rol anterior en esta
base de datos, para ejecutarlas una vez que nada aquí los necesite. `--dry-run`
imprime las mismas sentencias y no cambia nada. En una terminal, solicita
confirmación antes de ejecutarse; sin terminal, se rechaza sin `--yes`.

Luego configure `REBASE_RLS_REQUEST_ROLE` en cada servidor que utilice la base
de datos.

`rebase doctor --database` también informa si cada rol del clúster puede
conectarse a la base de datos, junto con el `REVOKE CONNECT … FROM PUBLIC` que
lo impide. Rebase no ejecuta eso por sí mismo en una base de datos de la que no
es propietario.

### Supabase

Un esquema de Supabase existente ya tiene `anon` y `authenticated`, y políticas
escritas contra ellos con `auth.uid()`. Para que esas políticas se apliquen a las
solicitudes de Rebase sin cambios:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: { anonymous: "anon", signedIn: "authenticated" },
        identity: "supabase",
        policyTarget: "requestRole"
    }
});
```

- `requestRole` ejecuta a los remitentes sin sesión como `anon` y a todos los que
  han iniciado sesión (invitados incluidos) como `authenticated`.
- `identity: "supabase"` establece los ajustes `request.jwt.*` que lee
  `auth.uid()`. Sin ellos, cada comprobación `auth.uid() = owner_id` fallará o
  pasará cuando no debería.
- `policyTarget: "requestRole"` evita que las propias políticas de Rebase se
  apliquen a sesiones que no son solicitudes de Rebase, como la Data API de
  Supabase.

Dado que las solicitudes se ejecutan como `anon` y `authenticated` en sí mismas,
las políticas escritas como `TO anon` o `TO authenticated` se aplican tal cual, y
no se necesita `inheritRoles`. Este último es para un proyecto cuyas solicitudes
se ejecutan como un rol propio, como
`requestRole: "acme_user", inheritRoles: ["authenticated"]`. Con un par
`{ anonymous, signedIn }`, se otorga solo al rol con sesión iniciada, nunca al
anónimo.

Los privilegios predeterminados estándar de Supabase han otorgado las tablas
creadas en `public` a `anon` y `authenticated`; verifique las de su proyecto.
Ejecute `rebase doctor --database` y `rls-check` después del primer inicio para
ver qué pueden alcanzar esos roles.

### Un administrador de base de datos crea los roles

Cuando la conexión no puede crear roles, o los roles residen en Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

El inicio comprueba entonces el rol y la membresía y falla con el SQL a ejecutar,
en lugar de intentar crearlos. Para entregar ese SQL al administrador con
antelación:

```bash
rebase db provision --print > request-role.sql
```

Imprime, para cada rol de solicitud, las sentencias que lo crean
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), otorgan al rol de conexión el
derecho a cambiar a él (`WITH SET TRUE, INHERIT FALSE` en PostgreSQL 16 y
posteriores) y le otorgan los esquemas bajo `grants: "schema"`. La explicación
está escrita como comentarios SQL, por lo que el archivo se puede ejecutar tal
como está. Lee el rol de conexión de la base de datos y no ejecuta nada más.
Cada sentencia es segura para volver a ejecutarse.

### Solicitudes de administrador y `rebase_admin`

Postgres combina con OR las políticas permisivas que se aplican a un rol. Escrita
`TO public`, la línea base que lleva cada tabla (`rebase.uid() IS NULL OR` el rol
`admin`) se aplicaría también a los usuarios con sesión iniciada, y un OR cuyo
otro extremo es constante para toda la sentencia no puede usar un índice: una
lista o conteo delimitado al propietario por parte de un usuario escanearía toda
la tabla. Por tanto, las políticas que solo el contexto del servidor o un
administrador pueden superar se escriben `TO rebase_admin` y nunca llegan al
plan de consulta de un usuario.

`rebase_admin` no posee privilegios y no puede iniciar sesión. Un remitente que
posee el rol `admin`, incluido `rebase.dataAsAdmin`, se ejecuta como
`<rol de solicitud>_admin` (`rebase_user_admin` por defecto), que hereda el rol
de solicitud y `rebase_admin`. Una conexión que está sujeta a seguridad a nivel
de fila por sí misma hereda `rebase_admin` para el contexto del servidor. El
inicio crea todo esto cuando la conexión puede crear roles. Bajo
`provisionRole: "never"`, créelos usted mismo:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

En PostgreSQL 15 y versiones anteriores, cree `rebase_user_admin` con `INHERIT`
y omita las opciones `WITH`. Donde `rebase_admin` no se puede crear en absoluto,
el inicio y `rebase db push` escriben esas políticas `TO public`, como antes, y
los administradores continúan ejecutándose como el rol de solicitud.
`rebase doctor --database` informa cuál de estos casos tiene.

#### Las lecturas de administrador usan los índices del propietario

Una política que no es una constante impide que Postgres use un índice para un
operador que no sea leakproof (a prueba de fugas), como `&&` en un array, `~` o
un operador jsonb. Sin el paso a continuación, un `tags && $1` de un
administrador escaneaba toda la tabla, mientras que la misma consulta realizada
por el propietario utilizaba el índice GIN. Esto abarcaba tanto
`rebase.sqlAsAdmin`, `rebase.dataAsAdmin` como a los usuarios administradores por
igual.

Por lo tanto, en el inicio se le otorga a cada política exclusiva de
administrador que todo administrador supera una compañera
`TO rebase_admin_request USING (true)`, nombrada `<policy>_ar_<hash>`. Para una
solicitud de administrador, Postgres reduce las políticas a `true` y planifica
la consulta como lo haría para el propietario. Las políticas restrictivas se
siguen aplicando. Solo los roles `<request role>_admin` pueden tener
`rebase_admin_request`. En cada inicio, Rebase comprueba qué roles tienen sus
privilegios. Si algún otro rol sujeto a seguridad a nivel de fila los tiene, el
inicio no escribe ninguna compañera y elimina las que encuentre. Las políticas
compañeras necesitan PostgreSQL 16 o posterior, porque en 15 y anteriores la
conexión heredaría el rol. Solo el arranque las escribe. `policies.sql` y las
migraciones nunca crean una, pero eliminan la compañera de cada política que
reescriben y que ya no la amerite. `rebase db push` y `rebase db migrate`
también eliminan cualquier compañera cuya regla haya desaparecido. Por lo tanto,
una regla de administrador reducida o eliminada deja de admitir a todos los
administradores, incluso donde el inicio no aprovisiona nada. Bajo
`provisionRole: "never"`, cree el rol usted mismo:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Antes de revertir a una versión anterior a la que introdujo las políticas
compañeras, hágalas inertes. Un runtime más antiguo no sabe qué son y nunca
eliminará ninguna, por lo que una regla que cambie más adelante dejaría a su
compañera admitiendo a todos los administradores a todas las filas. Una sentencia
por cada rol de solicitud de administrador hace que ninguna compañera admita a
nadie:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

O elimínelas: cada política cuyo nombre termine en `_ar_` y ocho dígitos
hexadecimales, y cuyo rol sea `rebase_admin_request`.

### Un esquema `public` compartido

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cuando `public` contiene tablas a las que Rebase no debería acceder:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase entonces otorga permisos al rol de solicitud solo sobre las tablas que
administra: tablas declaradas, tablas de unión (junction tables) y sus propias
tablas protegidas por filas. No establece privilegios predeterminados en
esquemas compartidos y no revoca nada ya otorgado. `rebase doctor --database`
enumera las tablas en los esquemas de Rebase que no administra.

Otra alternativa es usar un esquema propio para Rebase: defina `schema` en cada
`defineTable`.

## Proveedores

Lo que el rol de conexión puede hacer difiere entre proveedores y determina si
Rebase puede crear el rol de solicitud por sí mismo. Las siguientes notas
reflejan lo que esperamos; verifíquelas con su proveedor.

| Proveedor | Rol de conexión habitual | Notas |
|---|---|---|
| Supabase | `postgres` (no es superusuario, tiene CREATEROLE) | Una base de datos por proyecto. `anon`, `authenticated` y `authenticator` existen, con privilegios predeterminados en `public`. Consulte la receta de Supabase anterior. |
| Neon | el propietario del proyecto, miembro de `neon_superuser` | Los roles pertenecen a una rama (branch), y cada base de datos en una rama los comparte. Dos bases de datos de Rebase en un proyecto de Neon comparten `rebase_user`, así que configure `requestRole` por base de datos. |
| AWS RDS / Aurora | el usuario maestro, miembro de `rds_superuser` | Tiene CREATEROLE pero no es superusuario. Las instancias a menudo se comparten entre aplicaciones. |
| Google Cloud SQL | `postgres`, miembro de `cloudsqlsuperuser` | Igual que RDS. |
| Azure Flexible Server | el usuario administrador, miembro de `azure_pg_admin` | Igual que RDS. |
| InstaPods | `instapod`; superusuario mediante `sudo -u postgres` | [La guía de InstaPods](/docs/deployment/instapods/) crea el rol de antemano. |
| Hostman | `gen_user`; CREATE ROLE otorgado desde el panel | No disponible en el plan más pequeño. [La guía de Hostman](/docs/deployment/hostman/) crea el rol de antemano. |

## Relacionado

- [Comandos de base de datos](/docs/cli/database/): `rebase db request-role` y
  `rebase db provision`
- [Referencia de la CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): audite las políticas en cualquier Postgres
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/): las políticas
  que Rebase escribe para cada tabla
