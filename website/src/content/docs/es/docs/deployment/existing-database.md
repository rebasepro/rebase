---
sourceHash: 61a4474d68248a58
title: Ejecución en una base de datos existente o compartida
sidebar_label: Base de datos existente o compartida
description: Ejecuta Rebase en una base de datos PostgreSQL de la que no es propietario (un clúster compartido con otras aplicaciones, un segundo proyecto de Rebase, Supabase o una base de datos bloqueada por un DBA) con las configuraciones de rls, rebase doctor --database y rebase db request-role migrate.
---

## El problema

Rebase ejecuta cada solicitud iniciada por un usuario o anónima como un rol
restringido de Postgres, `rebase_user`, y permite que la seguridad a nivel de fila
(RLS) decida qué filas ve esa solicitud. El rol de conexión es el propietario de
las tablas y omite RLS; cada solicitud cambia a `rebase_user` dentro de su
transacción.

Esto funciona en una base de datos que pertenece en su totalidad a Rebase:
Rebase Cloud, la configuración de Docker generada por `rebase init`, la base de
datos de desarrollo administrada. Se basa en dos supuestos:

1. Solo el servidor de este proyecto puede convertirse en `rebase_user`.
2. Solo `rebase_user` y el propietario de la tabla tocan las tablas de Rebase.

Una base de datos que alguien ya administra a menudo incumple ambos:

- **Los roles pertenecen a todo el clúster, no a una sola base de datos.** Dos
  proyectos de Rebase en un mismo clúster comparten el mismo `rebase_user`. De forma
  predeterminada, cada rol puede conectarse a cualquier base de datos, y cualquiera
  puede establecer las variables de sesión que leen las políticas de Rebase, de modo
  que la conexión del proyecto A puede abrir la base de datos del proyecto B,
  cambiar a `rebase_user` y cumplir con las políticas de B como administrador de B.
- **Los permisos (grants) cubren esquemas completos.** De forma predeterminada,
  Rebase otorga al rol de solicitud privilegios `SELECT, INSERT, UPDATE, DELETE` en
  cada tabla de `public` sobre la que pueda otorgar permisos, incluidas las tablas
  que pertenecen a otra aplicación.
- **Las políticas predeterminadas se aplican `TO public`.** La política base que
  Rebase añade a cada tabla permite el acceso a cualquier sesión que nunca haya
  establecido la identidad de Rebase. Así es como pasan las consultas del propio
  servidor, y también permite el acceso a cualquier otro rol que tenga privilegios
  concedidos en la tabla, como el rol `anon` de Supabase a través de su Data API.
- **Las políticas existentes basadas en roles nunca se aplican.** Una política escrita
  como `TO authenticated` no se aplica a `rebase_user`, porque `rebase_user` no
  hereda los privilegios de otros roles.
- **Algunas bases de datos no permiten en absoluto que la aplicación cree roles.**
  Un DBA crea cada rol manualmente, o los roles se gestionan en Terraform.

Cada uno de estos casos tiene una opción de configuración. Cada ajuste tiene por
defecto el comportamiento que Rebase tendría sin él, por lo que un proyecto que
no configure nada se comportará exactamente igual que antes.

## Comprueba la base de datos primero

```bash
rebase doctor --database
```

Lee el catálogo de la base de datos del proyecto y no cambia nada. Informa:

- si cada rol de solicitud existe, si está restringido y si esta conexión puede
  cambiar a él;
- otros roles de inicio de sesión que pueden cambiar al rol de solicitud;
- si todos los roles del clúster pueden conectarse a esta base de datos;
- tablas en los esquemas de Rebase que Rebase no sirve;
- otros roles que poseen privilegios en las tablas de Rebase;
- políticas en las tablas de Rebase escritas `TO` un rol que el rol de solicitud
  no hereda;
- privilegios predeterminados que entregan nuevas tablas a otros roles.

Cada hallazgo viene acompañado del SQL para ejecutar como administrador de base
de datos, la configuración que adapta Rebase a la base de datos en su lugar, o
ambos. Finaliza con código de salida 1 cuando un hallazgo es un fallo, por lo que
puede condicionar un despliegue. Comprueba la base de datos comparándola con las
opciones de configuración que puede ver: las variables `REBASE_RLS_*`, y luego los
roles de solicitud que el inicio del servidor registró en la base de datos.

`npx @rebasepro/rls-check` audita las políticas en sí, en cualquier Postgres. En
una base de datos de Rebase, lee el rol de solicitud de la misma manera; indícalo
con `--request-role` cuando aún no esté registrado.

## Las configuraciones

Defínelos en la declaración de la base de datos en `backend/resources.ts`:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

O desde el entorno, el cual prevalece sobre la declaración. El entorno es lo que
buscas para un valor que difiere entre dos despliegues del mismo código, como el
nombre del rol cuando staging y producción comparten un clúster.

| Ajuste | Variable de entorno | Valor predeterminado | Alternativas |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un único nombre) | `"rebase_user"` | Cualquier nombre de rol. `{ anonymous, signedIn }` para ejecutar llamadas sin sesión como un rol y llamadas autenticadas como otro. En el código del driver, una función de la identidad de la solicitud. |
| `requestRoles` | ninguno | derivado de `requestRole` | Cada rol que puede retornar un `requestRole` basado en función, de modo que cada uno pueda ser aprovisionado, recibir permisos y ser comprobado. Obligatorio cuando se usa una función. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: crea el rol si falta y otorga a esta conexión el derecho de cambiar a él | `"never"`: el rol y la pertenencia son responsabilidad tuya. El inicio comprueba ambos y falla mostrando el SQL a ejecutar. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: cada tabla y secuencia en los esquemas que Rebase sirve sobre los que la conexión pueda otorgar permisos, más privilegios predeterminados para tablas creadas posteriormente | `"managed"`: solo las tablas que sirve Rebase, y sin privilegios predeterminados. `"none"`: Rebase no concede nada; se rechaza cualquier tabla a la que no le hayas otorgado permisos. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: las políticas permisivas solo se aplican al rol o roles de solicitud. Las políticas restrictivas se siguen aplicando a todos. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: las políticas que solo el contexto del servidor o un administrador pueden cumplir (la línea base, `roles: ["admin"]`) se escriben `TO rebase_admin`, y las solicitudes de administrador se ejecutan como `<request role>_admin` | `"public"`: esas políticas se escriben `TO public` y los administradores se ejecutan como el rol de solicitud, igual que antes de que existiera este ajuste. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: ninguna tabla recibe la línea base de servidor o administrador. El propio `defaultPolicies: false` de una tabla sigue decidiendo por ella misma. |
| `required` | ninguno | `true`: una tabla declarada que la base de datos no protege (seguridad a nivel de fila desactivada, ausencia de sus políticas declaradas) no se sirve cuando el inicio no aprovisiona nada | `false`: sirve las tablas de esta base de datos de todos modos e indícalas en el inicio. Para un esquema propiedad de otra herramienta y una aplicación que aplica el acceso por sí misma; consulta "Otra herramienta es propietaria del esquema" más abajo. El propio `rlsRequired` de una tabla decide por ella misma. |
| `inheritRoles` | ninguno | `[]` | Roles otorgados al rol de solicitud `WITH INHERIT TRUE`, de modo que se apliquen las políticas escritas `TO` dichos roles. Con un rol de solicitud `{ anonymous, signedIn }`, solo el rol que haya iniciado sesión los recibe; con una función, este ajuste se rechaza. PostgreSQL 16 y posteriores; se rechaza en 15 y anteriores. |
| `identity` | `REBASE_RLS_IDENTITY` (formatos con nombre) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: también `request.jwt.claims`, `request.jwt.claim.sub` y `request.jwt.claim.role`, para que `auth.uid()` y `auth.jwt()` vean a quien realiza la llamada. En el código del driver, una función que devuelve configuraciones adicionales. Las configuraciones `app.*` siempre se establecen. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` cuando otro inicio de sesión puede cambiar al rol de solicitud | `"refuse"`: falla el inicio. `"ignore"`: no muestra nada. |

Las formas funcionales de `requestRole` e `identity` solo se aceptan en el
propio bloque `rls` del driver, que admite los mismos ajustes. `policyTarget`,
`adminPolicies` y `defaultPolicies` modifican el SQL de políticas que escribe
`rebase db generate`, y la CLI no puede leer el código del driver, por lo que
debes definirlos en la declaración o en el entorno. Un inicio que solo los
encuentre en el código del driver se negará a arrancar.

Al iniciar, la línea que informa cómo se aíslan las solicitudes lista cada ajuste
que no tenga su valor predeterminado. Un ajuste que te delega una tarea, como
`grants: "none"`, indica una vez cuál es esa tarea.

El primer inicio de aprovisionamiento registra el rol o roles de solicitud en
`rebase.schema_meta`. Un inicio posterior configurado con un rol diferente se
negará a arrancar e indicará el comando para migrar la base de datos, detallado
más abajo. Sin esa comprobación, el rol antiguo mantendría sus permisos mientras
se configuraba uno nuevo a su lado.

## Recetas

### Un clúster compartido con otras aplicaciones o proyectos

Asigna a cada proyecto y a cada despliegue que comparta un clúster un rol
propio:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Una base de datos que ya se haya ejecutado como `rebase_user` registra eso,
por lo que primero debes migrarla:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

El comando crea el nuevo rol si falta, vuelve a emitir solo en esta base de datos
cada permiso que poseía el rol antiguo (tablas, columnas, secuencias, esquemas,
funciones, los privilegios predeterminados que estableció esta conexión y las
pertenencias), redirige las políticas que nombran al rol antiguo y registra el
nuevo rol. Se ejecuta en una sola transacción. El rol antiguo se deja tal como
está, porque otra base de datos en el clúster aún podría usarlo. Al finalizar,
imprime las sentencias `REVOKE` que revocan los permisos del rol antiguo en esta
base de datos, para ejecutarlas una vez que nada aquí los necesite. `--dry-run`
imprime las mismas sentencias y no cambia nada. En una terminal solicita
confirmación antes de ejecutarse; sin una terminal, se rehúsa a ejecutarse sin
`--yes`.

Luego, define `REBASE_RLS_REQUEST_ROLE` en cada servidor que utilice la base de
datos.

`rebase doctor --database` también informa si todos los roles del clúster pueden
conectarse a la base de datos, con el `REVOKE CONNECT … FROM PUBLIC` que lo
impide. Rebase no ejecuta eso por sí mismo en una base de datos de la que no es
propietario.

### Supabase

Un esquema de Supabase existente ya tiene `anon` y `authenticated`, así como
políticas escritas contra ellos con `auth.uid()`. Para que esas políticas se
apliquen a las solicitudes de Rebase sin modificaciones:

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

- `requestRole` ejecuta las llamadas sin sesión como `anon` y a todos los que
  hayan iniciado sesión (invitados incluidos) como `authenticated`.
- `identity: "supabase"` establece las variables `request.jwt.*` que lee
  `auth.uid()`. Sin ellas, cualquier comprobación `auth.uid() = owner_id`
  fallará o pasará cuando no debería.
- `policyTarget: "requestRole"` evita que las políticas propias de Rebase se
  apliquen a sesiones que no sean solicitudes de Rebase, como la Data API de
  Supabase.

Dado que las solicitudes se ejecutan como `anon` y `authenticated` en sí mismas,
las políticas escritas como `TO anon` o `TO authenticated` se aplican tal cual y
no se necesita `inheritRoles`. Este último está pensado para proyectos cuyas
solicitudes se ejecutan como un rol propio, como
`requestRole: "acme_user", inheritRoles: ["authenticated"]`. Con un par
`{ anonymous, signedIn }`, se otorga únicamente al rol autenticado, nunca al
anónimo.

Los privilegios predeterminados estándar de Supabase conceden las tablas creadas
en `public` a `anon` y `authenticated`; comprueba los de tu proyecto. Ejecuta
`rebase doctor --database` y `rls-check` después del primer inicio para ver qué
pueden alcanzar esos roles.

### Otra herramienta es propietaria del esquema y la aplicación aplica el acceso

Algunas bases de datos no le corresponde asegurarlas a Rebase. Alembic, Prisma o
un DBA son propietarios de las tablas, nada allí habilita la seguridad a nivel de
fila y la aplicación decide por sí misma quién ve qué: solo el personal puede
iniciar sesión, los hooks verifican cada escritura, un scope condiciona cada
ruta. Un inicio que no aprovisiona nada (`REBASE_PROVISION=false`,
`REBASE_MIGRATE_ON_BOOT=none`) retiene cada una de esas tablas por defecto
(`503 TABLE_WITHHELD`), ya que Postgres entregaría cada fila a cualquier
solicitante autenticado.

Indica que la aplicación aplica el acceso en su lugar, para toda la base de
datos:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

o para una sola tabla:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "admin-only",
    rlsRequired: false
});
```

A partir de entonces, las tablas se sirven independientemente de lo que diga el
catálogo, y el inicio las nombra en una advertencia. El valor `rlsRequired: true`
de una tabla hace que siga siendo obligatoria bajo una base de datos que
especifique `required: false`. Nada cambia en la base de datos: un inicio que sí
aprovisiona continúa habilitando la seguridad a nivel de fila y escribiendo las
políticas declaradas, y `rebase doctor` continuará reportando las tablas como
desprotegidas.

Con la seguridad a nivel de fila desactivada, Postgres no aplica el `rls`
declarado: `"admin-only"` no detiene a un usuario autenticado que no sea
administrador. Mantén el inicio de sesión, los roles y los hooks encargándose
de esa tarea.

### Un administrador de base de datos crea los roles

Cuando la conexión no puede crear roles o los roles se gestionan en Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

El inicio comprueba entonces el rol y la pertenencia, y falla mostrando el SQL a
ejecutar, en lugar de intentar crearlos. Para entregar ese SQL al administrador
con antelación:

```bash
rebase db provision --print > request-role.sql
```

Imprime, para cada rol de solicitud, las sentencias que lo crean
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), le otorgan al rol de conexión el
derecho de cambiar a él (`WITH SET TRUE, INHERIT FALSE` en PostgreSQL 16 y
posteriores) y le conceden permisos sobre los esquemas según `grants: "schema"`.
La explicación está redactada como comentarios SQL, de modo que el archivo se
puede ejecutar tal cual. Lee el rol de conexión de la base de datos y no ejecuta
nada más. Cada sentencia es segura para ejecutarse nuevamente.

### Solicitudes de administrador y `rebase_admin`

Postgres combina las políticas permisivas que se aplican a un rol mediante OR.
Escrita `TO public`, la línea base que lleva cada tabla (`rebase.uid() IS NULL OR`
el rol `admin`) se aplicaría también a los usuarios autenticados, y un OR cuyo otro
lado sea constante para toda la sentencia no puede usar un índice: una lista o
conteo con alcance de propietario de un usuario realizaría un escaneo completo de
la tabla. Por lo tanto, las políticas que solo el contexto del servidor o un
administrador pueden cumplir se escriben `TO rebase_admin` y nunca llegan al
plan de consulta de un usuario.

`rebase_admin` no posee privilegios y no puede iniciar sesión. Quien realice una
llamada y posea el rol `admin`, incluido `rebase.dataAsAdmin`, se ejecuta como
`<request role>_admin` (`rebase_user_admin` por defecto), el cual hereda el rol
de solicitud y `rebase_admin`. Una conexión que esté sujeta por sí misma a
seguridad a nivel de fila hereda `rebase_admin` para el contexto del servidor.
El inicio crea todo esto cuando la conexión puede crear roles. Bajo
`provisionRole: "never"`, créalos manualmente:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

En PostgreSQL 15 y anteriores, crea `rebase_user_admin` con `INHERIT` y omite
las opciones `WITH`. Donde `rebase_admin` no se pueda crear en absoluto, el
inicio y `rebase db push` escribirán esas políticas `TO public`, como era antes,
y los administradores seguirán ejecutándose como el rol de solicitud.
`rebase doctor --database` informa cuál de estos tienes.

#### Las lecturas de administrador usan los índices del propietario

Una política que no sea una constante impide que Postgres use un índice para un
operador que no sea leakproof (a prueba de fugas), como `&&` en un array, `~` o
un operador jsonb. Sin el paso que figura a continuación, una consulta
`tags && $1` de un administrador escaneaba toda la tabla, mientras que la misma
consulta ejecutada por el propietario utilizaba el índice GIN. Eso afectaba a
`rebase.sqlAsAdmin`, `rebase.dataAsAdmin` y a los usuarios administradores por
igual.

Por ello, al arrancar, el inicio otorga a cada política exclusiva de
administrador que todo administrador cumple una política complementaria
`TO rebase_admin_request USING (true)`, llamada `<policy>_ar_<hash>`. Para una
solicitud de administrador, Postgres reduce las políticas a `true` y planifica
la consulta como lo haría para el propietario. Las políticas restrictivas aún se
aplican. Solo los roles `<request role>_admin` pueden poseer
`rebase_admin_request`. En cada inicio, Rebase comprueba qué roles poseen sus
privilegios. Si cualquier otro rol sujeto a seguridad a nivel de fila los posee,
el inicio no escribe complementarias y elimina cualquiera que encuentre. Las
políticas complementarias requieren PostgreSQL 16 o posterior, ya que en 15 y
anteriores la conexión heredaría el rol. Solo el inicio las escribe.
`policies.sql` y las migraciones nunca crean ninguna, pero eliminan la
complementaria de cada política que reescriban y que ya no la merezca.
`rebase db push` y `rebase db migrate` también eliminan cualquier complementaria
cuya regla haya desaparecido. Por lo tanto, una regla de administrador
restringida o eliminada deja de admitir a todos los administradores, incluso
cuando el inicio no aprovisiona nada. Bajo `provisionRole: "never"`, crea el
rol tú mismo:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Antes de revertir a una versión anterior a la que introdujo las políticas
complementarias, hazlas inertes. Un runtime más antiguo no sabe qué son y
nunca elimina ninguna, por lo que una regla que cambies más adelante dejaría
su complementaria admitiendo a todos los administradores en cada fila. Una
sentencia por cada rol de solicitud de administrador hace que ninguna
complementaria admita a nadie:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

O elimínalas: cada política cuyo nombre termine en `_ar_` y ocho dígitos
hexadecimales, y cuyo rol sea `rebase_admin_request`.

### Un esquema `public` compartido

Cuando `public` contiene tablas a las que Rebase no debería acceder:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase entonces otorga permisos al rol de solicitud únicamente sobre las tablas
que sirve: tablas declaradas, tablas de unión (junction tables) y sus propias
tablas protegidas por filas. No establece privilegios predeterminados en
esquemas compartidos y no revoca nada que ya haya sido otorgado.
`rebase doctor --database` lista las tablas en los esquemas de Rebase que no
sirve.

Otra alternativa es un esquema propio de Rebase: define `schema` en cada
`defineTable`.

## Proveedores

Lo que el rol de conexión puede hacer difiere entre proveedores y determina si
Rebase puede crear el rol de solicitud por sí mismo. Las notas a continuación
son lo que esperamos; verifícalas con tu proveedor.

| Proveedor | Rol de conexión habitual | Notas |
|---|---|---|
| Supabase | `postgres` (no es superusuario, tiene CREATEROLE) | Una base de datos por proyecto. Existen `anon`, `authenticated` y `authenticator`, con privilegios predeterminados en `public`. Consulta la receta de Supabase anterior. |
| Neon | el propietario del proyecto, miembro de `neon_superuser` | Los roles pertenecen a una rama, y cada base de datos en una rama los comparte. Dos bases de datos de Rebase en un mismo proyecto de Neon comparten `rebase_user`, por lo que se debe configurar `requestRole` por base de datos. |
| AWS RDS / Aurora | el usuario maestro, miembro de `rds_superuser` | Tiene CREATEROLE pero no es superusuario. Las instancias suelen compartirse entre aplicaciones. |
| Google Cloud SQL | `postgres`, miembro de `cloudsqlsuperuser` | Igual que RDS. |
| Azure Flexible Server | el usuario administrador, miembro de `azure_pg_admin` | Igual que RDS. |
| InstaPods | `instapod`; superusuario mediante `sudo -u postgres` | [La guía de InstaPods](/docs/deployment/instapods/) crea el rol de antemano. |
| Hostman | `gen_user`; CREATE ROLE otorgado desde el panel | No disponible en el plan más pequeño. [La guía de Hostman](/docs/deployment/hostman/) crea el rol de antemano. |

## Relacionado

- [Comandos de base de datos](/docs/cli/database/): `rebase db request-role` y
  `rebase db provision`
- [Referencia de la CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): audita las políticas en cualquier Postgres
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/): las políticas
  que Rebase escribe para cada tabla
