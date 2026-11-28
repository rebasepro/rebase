---
sourceHash: 4107937aed2a477c
title: Ejecución en una base de datos existente o compartida
sidebar_label: Base de datos existente o compartida
description: Ejecuta Rebase en una base de datos PostgreSQL que no le pertenece — un clúster compartido con otras aplicaciones, un segundo proyecto de Rebase, Supabase o una base de datos restringida por un DBA — con la configuración de rls, rebase doctor --database y rebase db request-role migrate.
---

## El problema

Rebase ejecuta cada solicitud autenticada y anónima como un rol restringido de
Postgres, `rebase_user`, y deja que la seguridad a nivel de fila (RLS) decida
qué filas ve esa solicitud. El rol de conexión es el propietario de las tablas
y elude RLS; cada solicitud cambia a `rebase_user` dentro de su transacción.

Esto funciona en una base de datos que pertenece enteramente a Rebase: Rebase
Cloud, la configuración de Docker que genera `rebase init`, la base de datos de
desarrollo administrada. Se basa en dos suposiciones:

1. Solo el servidor de este proyecto puede convertirse en `rebase_user`.
2. Solo `rebase_user` y el propietario de la tabla tocan las tablas de Rebase.

Una base de datos que alguien ya administra a menudo rompe ambas:

- **Los roles pertenecen a todo el clúster, no a una sola base de datos.** Dos
  proyectos de Rebase en un clúster comparten el mismo `rebase_user`. Por
  defecto, cada rol puede conectarse a cada base de datos y cualquiera puede
  definir la configuración de sesión que leen las políticas de Rebase, por lo
  que la conexión del proyecto A puede abrir la base de datos del proyecto B,
  cambiar a `rebase_user` y pasar las políticas de B como administrador de B.
- **Los permisos cubren esquemas enteros.** Por defecto, Rebase otorga al rol
  de solicitud permisos de `SELECT, INSERT, UPDATE, DELETE` en cada tabla de
  `public` sobre la que pueda otorgar permisos, incluidas las tablas que
  pertenecen a otra aplicación.
- **Las políticas predeterminadas se aplican `TO public`.** La política base
  que Rebase añade a cada tabla permite el acceso a cualquier sesión que nunca
  haya establecido la identidad de Rebase. Así es como pasan las consultas
  propias del servidor, y también permite la entrada a cualquier otro rol que
  tenga un permiso en la tabla, como el rol `anon` de Supabase a través de su
  Data API.
- **Las políticas existentes basadas en roles nunca se aplican.** Una política
  escrita `TO authenticated` no se aplica a `rebase_user`, porque `rebase_user`
  no hereda los privilegios de otros roles.
- **Algunas bases de datos no permiten que la aplicación cree roles en
  absoluto.** Un DBA crea cada rol manualmente, o los roles se gestionan en
  Terraform.

Cada uno de estos casos tiene una opción de configuración. Cada ajuste tiene
como valor predeterminado lo que Rebase hace sin él, por lo que un proyecto que
no configure nada se comportará exactamente como antes.

## Comprueba la base de datos primero

```bash
rebase doctor --database
```

Lee el catálogo de la base de datos del proyecto y no cambia nada. Informa:

- si cada rol de solicitud existe, si está restringido y si esta conexión
  puede cambiar a él;
- otros roles de inicio de sesión que pueden cambiar al rol de solicitud;
- si cada rol del clúster puede conectarse a esta base de datos;
- tablas en los esquemas de Rebase que Rebase no sirve;
- otros roles que tienen privilegios sobre las tablas de Rebase;
- políticas en las tablas de Rebase escritas `TO` a un rol que el rol de
  solicitud no hereda;
- privilegios predeterminados que otorgan nuevas tablas a otros roles.

Cada hallazgo incluye el SQL a ejecutar como administrador de base de datos, la
configuración que adapta Rebase a la base de datos en su lugar, o ambos.
Finaliza con código de salida 1 cuando un hallazgo es un fallo, por lo que puede
condicionar un despliegue. Comprueba la base de datos comparándola con las
configuraciones visibles: las variables `REBASE_RLS_*` y, a continuación, los
roles de solicitud que un inicio del servidor registró en la base de datos.

`npx @rebasepro/rls-check` audita las políticas en sí, en cualquier Postgres. En
una base de datos de Rebase, lee el rol de solicitud de la misma manera;
indícalo con `--request-role` si aún no está registrado.

## Las configuraciones

Defínelas en la declaración de la base de datos en `backend/resources.ts`:

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
adecuado para un valor que difiere entre dos despliegues del mismo código, como
el nombre del rol cuando staging y producción comparten un clúster.

| Configuración | Variable de entorno | Por defecto | Alternativas |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un solo nombre) | `"rebase_user"` | Cualquier nombre de rol. `{ anonymous, signedIn }` para ejecutar las llamadas sin sesión como un rol y las llamadas autenticadas como otro. En el código del driver, una función de la identidad de la solicitud. |
| `requestRoles` | ninguno | derivado de `requestRole` | Cada rol que un `requestRole` con valor de función puede devolver, para que cada uno pueda ser aprovisionado, recibir permisos y ser verificado. Obligatorio con una función. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: crea el rol si falta y otorga a esta conexión el derecho a cambiar a él | `"never"`: el rol y la pertenencia dependen de ti. El arranque comprueba ambos y falla con el SQL a ejecutar. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: cada tabla y secuencia en los esquemas que Rebase sirve sobre las que la conexión pueda otorgar permisos, más los privilegios por defecto para las tablas creadas posteriormente | `"managed"`: solo las tablas que sirve Rebase, y sin privilegios predeterminados. `"none"`: Rebase no otorga nada; se rechaza cualquier tabla a la que no le hayas otorgado permisos. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: las políticas permisivas solo se aplican a los roles de solicitud. Las políticas restrictivas siguen aplicándose a todos. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: las políticas que solo el contexto del servidor o un admin pueden superar (la base, `roles: ["admin"]`) se escriben `TO rebase_admin`, y las solicitudes de admin se ejecutan como `<request role>_admin` | `"public"`: esas políticas son `TO public` y los administradores se ejecutan como el rol de solicitud, como antes de que existiera esta configuración. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: ninguna tabla recibe la base de servidor o admin. El propio `defaultPolicies: false` de una tabla sigue decidiendo por ella. |
| `required` | ninguno | `true`: una tabla declarada que la base de datos no protege (seguridad a nivel de fila desactivada, faltan sus políticas declaradas) no se sirve cuando el arranque no aprovisiona nada | `false`: sirve las tablas de esta base de datos de todos modos e indícalas en el arranque. Para un esquema propiedad de otra herramienta y una aplicación que aplica el control de acceso por sí misma; consulta "Otra herramienta es propietaria del esquema" a continuación. El propio `rlsRequired` de una tabla decide por ella. |
| `inheritRoles` | ninguno | `[]` | Roles otorgados al rol de solicitud `WITH INHERIT TRUE`, de modo que se apliquen las políticas escritas `TO` ellos. Con un rol de solicitud `{ anonymous, signedIn }`, solo el rol autenticado los obtiene; con una función, la configuración se rechaza. PostgreSQL 16 y posteriores; rechazado en 15 y anteriores. |
| `identity` | `REBASE_RLS_IDENTITY` (formas con nombre) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: también `request.jwt.claims`, `request.jwt.claim.sub` y `request.jwt.claim.role`, para que `auth.uid()` y `auth.jwt()` vean al emisor. En el código del driver, una función que devuelve configuraciones adicionales. Los ajustes `app.*` siempre se establecen. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` cuando otro inicio de sesión puede cambiar al rol de solicitud | `"refuse"`: falla el arranque. `"ignore"`: no muestra nada. |

Las formas de función de `requestRole` e `identity` solo se aceptan en el
propio bloque `rls` del driver, que admite las mismas configuraciones.
`policyTarget`, `adminPolicies` y `defaultPolicies` modifican el SQL de
políticas que escribe `rebase db generate`, y la CLI no puede leer el código
del driver, así que defínelos en la declaración o en el entorno. Un arranque que
solo los encuentre en el código del driver se negará a iniciar.

En el arranque, la línea que informa cómo se aíslan las solicitudes enumera
cada configuración que no esté en su valor por defecto. Una configuración que
te delegue una tarea, como `grants: "none"`, indicará una sola vez cuál es esa
tarea.

El primer arranque de aprovisionamiento registra el rol (o roles) de solicitud
en `rebase.schema_meta`. Un arranque posterior configurado con un rol diferente
se negará a iniciar e indicará el comando para migrar la base de datos,
descrito más adelante. Sin esa comprobación, el rol anterior mantendría sus
permisos mientras se configuraba uno nuevo a su lado.

## Recetas

### Un clúster compartido con otras aplicaciones o proyectos

Asigna a cada proyecto, y a cada despliegue que comparta un clúster, un rol
propio:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Una base de datos que ya se ha ejecutado como `rebase_user` registra ese dato,
así que primero mígrala:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

El comando crea el nuevo rol si no existe, vuelve a otorgar únicamente en esta
base de datos cada permiso que tenga el rol anterior (tablas, columnas,
secuencias, esquemas, funciones, los privilegios por defecto definidos por esta
conexión y las pertenencias), redirige las políticas que hacen referencia al
rol anterior y registra el nuevo rol. Se ejecuta en una sola transacción. El
rol anterior se deja tal cual, porque otra base de datos en el clúster aún
podría estar usándolo. Cuando finaliza, imprime las sentencias `REVOKE` que
retiran los permisos del rol anterior en esta base de datos, para ejecutarlas
una vez que nada aquí las necesite. `--dry-run` imprime las mismas sentencias y
no cambia nada. En una terminal pide confirmación antes de ejecutarse; sin una
terminal se rechaza si no se incluye `--yes`.

Luego define `REBASE_RLS_REQUEST_ROLE` en cada servidor que utilice la base de
datos.

`rebase doctor --database` también informa si todos los roles del clúster
pueden conectarse a la base de datos, indicando el comando `REVOKE CONNECT … FROM
PUBLIC` para evitarlo. Rebase no ejecuta esto por sí mismo en una base de datos
que no le pertenece.

### Supabase

Un esquema existente de Supabase ya cuenta con `anon` y `authenticated`, además
de políticas escritas para ellos usando `auth.uid()`. Para que esas políticas se
apliquen a las solicitudes de Rebase sin cambios:

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

- `requestRole` ejecuta a los emisores sin sesión como `anon` y a todos los que
  hayan iniciado sesión (invitados incluidos) como `authenticated`.
- `identity: "supabase"` define los ajustes `request.jwt.*` que lee
  `auth.uid()`. Sin ellos, cualquier comprobación `auth.uid() = owner_id`
  fallará, o se superará cuando no debería.
- `policyTarget: "requestRole"` evita que las políticas propias de Rebase se
  apliquen a sesiones que no son solicitudes de Rebase, como la Data API de
  Supabase.

Dado que las solicitudes se ejecutan como `anon` y `authenticated`, las
políticas escritas `TO anon` o `TO authenticated` se aplican tal cual, y no se
necesita `inheritRoles`. Este se reserva para un proyecto cuyas solicitudes se
ejecutan con un rol propio, como `requestRole: "acme_user", inheritRoles:
["authenticated"]`. Con un par `{ anonymous, signedIn }`, solo se concede al
rol autenticado, nunca al anónimo.

Los privilegios predeterminados de fábrica de Supabase han concedido las tablas
creadas en `public` a `anon` y `authenticated`; comprueba los de tu proyecto.
Ejecuta `rebase doctor --database` y `rls-check` después del primer arranque para
ver a qué pueden acceder esos roles.

### Otra herramienta es propietaria del esquema y la aplicación aplica el acceso

Algunas bases de datos no le corresponden a Rebase proteger. Alembic, Prisma o
un DBA son propietarios de las tablas, nada allí habilita la seguridad a nivel
de fila y la aplicación decide por sí misma quién ve qué: solo el personal
puede iniciar sesión, los hooks verifican cada escritura, un scope restringe
cada ruta.

Declara esta postura directamente en la tabla:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "unmanaged"
});
```

O para todo el proyecto mediante `defaultRls = "unmanaged"` en
`backend/schema/index.ts` junto con `rls: "inherit"` en cada tabla. Rebase no
emite ningún DDL de `ENABLE ROW LEVEL SECURITY` ni de políticas para tablas
`"unmanaged"` (en `db push` o arranques de aprovisionamiento), las sirve sin
retenciones y las enumera una vez al arrancar. Mantén el inicio de sesión,
roles, scopes y hooks aplicando el control de acceso.

Si Postgres **sí** aplica seguridad a nivel de fila en esas tablas, con
políticas creadas en migraciones SQL, Supabase o Terraform en lugar de en
Rebase, utiliza `rls: "external"` en su lugar:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "external"
});
```

Rebase no emite DDL de RLS ni de políticas para tablas `"external"` y nunca
purga sus políticas (`--prune-policies`), mientras que el arranque y `rebase
doctor` siguen verificando que `ENABLE ROW LEVEL SECURITY` esté activo en la
tabla en Postgres.

Para las tablas que todavía declaran reglas de Rebase en una base de datos que
pertenece a otra herramienta, `rlsRequired: false` (o `database({ rls: {
required: false } })` para toda la base de datos) las sirve en un arranque sin
aprovisionamiento incluso cuando las políticas declaradas no están presentes,
indicándolas en una advertencia:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

El `rlsRequired: true` de una tabla la mantiene como obligatoria en una base de
datos que indique `required: false`. Con la seguridad a nivel de fila
desactivada, Postgres no aplica una regla declarada: mantén el inicio de
sesión, los roles y los hooks encargándose de esa tarea.

### Un administrador de base de datos crea los roles

Cuando la conexión no puede crear roles, o los roles residen en Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

El arranque comprueba entonces el rol y la pertenencia, y falla mostrando el
SQL a ejecutar, en lugar de intentar crearlos. Para entregar ese SQL al
administrador con antelación:

```bash
rebase db provision --print > request-role.sql
```

Imprime, para cada rol de solicitud, las sentencias que lo crean (`NOLOGIN
NOSUPERUSER NOBYPASSRLS NOINHERIT`), le otorgan al rol de conexión el derecho a
cambiar a él (`WITH SET TRUE, INHERIT FALSE` en PostgreSQL 16 y versiones
posteriores) y le conceden los esquemas bajo `grants: "schema"`. La explicación
está redactada como comentarios SQL, por lo que el archivo se puede ejecutar tal
cual. Lee el rol de conexión desde la base de datos y no ejecuta nada más. Cada
sentencia se puede ejecutar de nuevo de forma segura.

### Solicitudes de admin y `rebase_admin`

Postgres combina las políticas permisivas que se aplican a un rol con OR.
Escrita `TO public`, la base que tiene cada tabla (`rebase.uid() IS NULL OR` el
rol `admin`) se aplicaría también a los usuarios que hayan iniciado sesión, y
un OR cuyo otro lado sea constante para toda la sentencia no puede usar un
índice: una lista o conteo con alcance de propietario de un usuario escanearía
toda la tabla. Por tanto, las políticas que solo el contexto del servidor o un
admin pueden superar se escriben `TO rebase_admin`, y nunca llegan al plan de
consulta de un usuario.

La tabla de usuarios es la excepción. Auth la lee y escribe en el contexto del
servidor en el propio rol de la conexión, el cual no cambia a `rebase_admin`,
por lo que sus políticas permanecen como `TO public` independientemente de la
configuración: detrás de un rol de conexión que no es propietario de la tabla,
el registro y el inicio de sesión funcionan de la misma manera.

`rebase_admin` no posee privilegios y no puede iniciar sesión. Un emisor que
tenga el rol `admin`, incluido `rebase.dataAsAdmin`, se ejecuta como `<request
role>_admin` (`rebase_user_admin` por defecto), que hereda el rol de solicitud y
`rebase_admin`. Una conexión que esté sujeta a seguridad a nivel de fila hereda
`rebase_admin` para el contexto del servidor. El arranque crea todo esto cuando
la conexión puede crear roles. Con `provisionRole: "never"`, créalos tú mismo:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

En PostgreSQL 15 y versiones anteriores, crea `rebase_user_admin` con `INHERIT`
y omite las opciones `WITH`. Donde no sea posible crear `rebase_admin` en
absoluto, el arranque y `rebase db push` escriben esas políticas `TO public`,
como estaban antes, y los administradores continúan ejecutándose como el rol de
solicitud. `rebase doctor --database` informa cuál de estos tienes.

#### Las lecturas de admin utilizan los índices del propietario

Una política que no sea constante impide que Postgres utilice un índice para un
operador que no sea leakproof, como `&&` en un array, `~` o un operador jsonb.
Sin el paso siguiente, un `tags && $1` de un admin escaneaba toda la tabla,
mientras que la misma consulta como propietario utilizaba el índice GIN. Esto
afectaba por igual a `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` y a los usuarios
administradores.

Por ello, el arranque proporciona a cada política exclusiva de admin que todo
admin cumple una política complementaria `TO rebase_admin_request USING (true)`,
llamada `<policy>_ar_<hash>`. Para una solicitud de admin, Postgres reduce las
políticas a `true` y planifica la consulta como lo haría para el propietario.
Las políticas restrictivas siguen aplicándose. Solo los roles `<request
role>_admin` pueden tener `rebase_admin_request`. En cada arranque, Rebase
comprueba qué roles tienen sus privilegios. Si cualquier otro rol sujeto a
seguridad a nivel de fila los tiene, el arranque no escribe complementos y
elimina cualquiera que encuentre. Los complementos requieren PostgreSQL 16 o
posterior, ya que en 15 y versiones anteriores la conexión heredaría el rol.
Solo el arranque los escribe. `policies.sql` y las migraciones nunca crean uno,
pero eliminan el complemento de cada política que reescriben si ya no le
corresponde uno. `rebase db push` y `rebase db migrate` también eliminan
cualquier complemento cuya regla haya desaparecido. Por lo tanto, una regla de
admin restringida o eliminada deja de admitir a todos los administradores
incluso si el arranque no aprovisiona nada. Con `provisionRole: "never"`, crea
el rol tú mismo:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Antes de revertir a una versión anterior a la que introdujo los complementos,
déjalos inactivos. Un runtime más antiguo no sabe qué son y nunca los
eliminará, por lo que una regla que cambies más adelante dejaría su
complemento permitiendo a cada admin el acceso a cada fila. Una sentencia por
cada rol de solicitud de admin hace que ningún complemento admita a nadie:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

O elimínalos: cada política cuyo nombre termine en `_ar_` y ocho dígitos
hexadecimales, y cuyo rol sea `rebase_admin_request`.

### Un esquema `public` compartido

Cuando `public` contiene tablas a las que Rebase no debería acceder:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase entonces solo otorga permisos al rol de solicitud sobre las tablas que
administra: tablas declaradas, tablas de unión y sus propias tablas protegidas
por filas. No define privilegios predeterminados en esquemas compartidos y no
revoca nada ya concedido. `rebase doctor --database` enumera las tablas en los
esquemas de Rebase que no administra.

Otra alternativa es utilizar un esquema propio de Rebase: define `schema` en
cada `defineTable`.

## Proveedores

Lo que el rol de conexión puede hacer varía entre proveedores y determina si
Rebase puede crear el rol de solicitud por sí mismo. Las notas a continuación
son lo que esperamos; verifícalas con tu proveedor.

| Proveedor | Rol de conexión habitual | Notas |
|---|---|---|
| Supabase | `postgres` (no es superusuario, tiene CREATEROLE) | Una base de datos por proyecto. Existen `anon`, `authenticated` y `authenticator`, con privilegios predeterminados en `public`. Consulta la receta de Supabase anterior. |
| Neon | el propietario del proyecto, miembro de `neon_superuser` | Los roles pertenecen a una rama, y cada base de datos en una rama los comparte. Dos bases de datos de Rebase en un proyecto de Neon comparten `rebase_user`, así que define `requestRole` por base de datos. |
| AWS RDS / Aurora | el usuario maestro, miembro de `rds_superuser` | Tiene CREATEROLE pero no es superusuario. Las instancias a menudo se comparten entre aplicaciones. |
| Google Cloud SQL | `postgres`, miembro de `cloudsqlsuperuser` | Igual que RDS. |
| Azure Flexible Server | el usuario admin, miembro de `azure_pg_admin` | Igual que RDS. |
| InstaPods | `instapod`; superusuario mediante `sudo -u postgres` | [La guía de InstaPods](/docs/deployment/instapods/) crea el rol de antemano. |
| Hostman | `gen_user`; CREATE ROLE otorgado desde el panel | No disponible en el plan más básico. [La guía de Hostman](/docs/deployment/hostman/) crea el rol de antemano. |

## Relacionado

- [Comandos de base de datos](/docs/cli/database/): `rebase db request-role` y
  `rebase db provision`
- [Referencia de la CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): audita las políticas en cualquier Postgres
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/): las políticas
  que Rebase escribe para cada tabla
