---
sourceHash: f385a35cc59df9c6
title: Seguridad a nivel de fila
sidebar_label: Seguridad a nivel de fila
description: "Cada tabla declara su postura de rls — admin-only, inherit o una lista de reglas — y Rebase la compila en políticas de seguridad a nivel de fila de Postgres. Formas de reglas, condiciones abreviadas, defaultRls y qué falla de forma cerrada."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada tabla indica quién puede acceder a sus filas mediante su clave `rls`. Rebase compila esto
en seguridad a nivel de fila de Postgres: `ENABLE ROW LEVEL SECURITY` en la tabla y
un `CREATE POLICY` por cada regla y operación. Luego, Postgres filtra cada
sentencia en cada ruta — REST, realtime, MCP, el CMS y SQL ejecutado como el
llamador — porque las reglas residen en la base de datos, no en el código de la aplicación.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        status:   col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser(),
    },
    rls: [
        // Anyone reads the published posts.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] },
    ],
});
```

`rls` no tiene un valor predeterminado. Omitirlo es un error de tipo, y una tabla que llegue
al compilador sin una postura utilizable es rechazada. Consulta
[Qué falla de forma cerrada](#qué-falla-de-forma-cerrada).

:::note[¿Vienes de collections?]
`rls` reemplaza a `securityRules`, y es obligatorio. Una regla escrita para
`securityRules` es una entrada válida de `rls` tal como está. La guía de actualización para esta
versión cubre `defaultSecurityRules` y `disableDefaultPolicies`.
:::

## Las tres posturas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| `rls` | Significado |
|---|---|
| `"admin-only"` | Seguridad a nivel de fila activada y solo las políticas base de administrador: el rol `admin` y el propio código del servidor acceden a las filas. Cualquier otro llamador no obtiene filas y sus escrituras son rechazadas. |
| `"inherit"` | El `defaultRls` exportado desde `backend/schema/index.ts`. Se rechaza cuando no hay ninguno. |
| una lista de reglas | Las políticas a generar, una o más. Se rechaza `[]`: escribe `"admin-only"` para bloquear una tabla solo a administradores. |

`"admin-only"` es la postura con la que comenzar una tabla cuando aún no has decidido
quién debería verla. Nada queda expuesto hasta que escribas las reglas que lo
expongan.

### `defaultRls`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`backend/schema/index.ts` puede exportar una postura para las tablas que indiquen
`rls: "inherit"`:

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { posts } from "./posts";
export { comments } from "./comments";

export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["editor"] },
];
```

`defaultRls` es `"admin-only"` o una lista no vacía de reglas. Se aplica únicamente a
las tablas que definen `"inherit"`; una tabla con sus propias reglas no toma ninguna
de estas, y las dos listas nunca se fusionan. `rls: "inherit"` sin ningún `defaultRls`
exportado detiene `rebase db generate`, `rebase db push` y el inicio del servidor con un error
que indica exportar uno.

## Políticas que una tabla obtiene sin escribirlas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las políticas en una tabla son más que sus propias reglas:

- **La base de administración.** Cada tabla obtiene las políticas `<table>_default_admin_read` y
  `<table>_default_admin_write` para insert, update y delete. Son
  permisivas y admiten el contexto del servidor y el rol `admin`, por lo que los administradores
  leen y escriben cada fila. Las políticas permisivas se combinan mediante OR, por lo que la base amplía
  lo que permitan tus reglas; nunca las restringe.
- **La tabla de usuarios.** Una tabla declarada con
  [`defineAuthTable`](/docs/schema/auth-table/) también obtiene una política que permite a un
  usuario autenticado leer su propia fila, y una barrera restrictiva que solo permite a un
  administrador escribir en las columnas de privilegios (`roles`), independientemente de lo que digan sus reglas.
- **Multiinquilino (Tenancy).** Una tabla con [`tenant`](/docs/collections/tenancy/) obtiene una
  política restrictiva que confina cada operación al inquilino (*tenant*) del llamador.
- **Tablas de unión.** La unión de una relación [`manyToMany`](/docs/collections/relations/#manytomany--through-a-junction)
  obtiene sus propias políticas.

`defaultPolicies: false` en una tabla elimina la base permisiva de administración y
mantiene las barreras restrictivas, de modo que la tabla tiene exactamente las reglas que escribiste. Se
rechaza junto con `"admin-only"`, que es la base y nada más:
la combinación dejaría una tabla a la que ningún llamador puede acceder, incluidos los administradores.

El DDL generado marca cada política inyectada, y `rebase db push` restaura las que
se hayan eliminado manualmente.

## Formas de reglas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una regla tiene una de estas formas. Mezclar dos en una misma regla es un error de tipo, y el
compilador también lo rechaza, detectando así casos en JavaScript y conversiones de tipo (*casts*): `access` junto a
`ownerField`, `using` o `withCheck`; `ownerField` junto a `using`, `withCheck`,
`condition` o `check`; `condition` o `check` junto a `using` o `withCheck`.
También lo es un valor fuera de la lista para `access`, `mode`, `operation(s)` o `roles`
(un `"restrictive"` mal escrito se rechaza, no se interpreta como permisivo). Una regla nunca
se convierte en una política que ignore silenciosamente la mitad de lo que se escribió.

| Forma | Ejemplo | `USING` (qué filas) | `WITH CHECK` (qué se puede escribir) |
|---|---|---|---|
| Propietario | `{ ownerField: "authorId" }` | la columna es igual al id del llamador | lo mismo |
| Pública | `{ access: "public" }` | cada fila | cada fila |
| Autenticado | `{ access: "authenticated" }` | cada fila, para un llamador autenticado | lo mismo |
| Autenticado con cuenta | `{ access: "registered" }` | cada fila, para un llamador autenticado que no sea invitado | lo mismo |
| Acceso con condición | `{ access: "public", condition: { status: "published" } }` | la condición (y autenticado, para `"authenticated"` y `"registered"`) | `check`, o la condición, restringido de la misma manera |
| Acceso con validación (check) | `{ access: "authenticated", check: { state: "open" } }` | solo la prueba de acceso | la validación, restringida por la prueba de acceso |
| Estructurada | `{ condition: policy.rolesOverlap(["moderator"]) }` | la condición | `check`, o la condición |
| SQL sin formato | `{ using: "{published_at} > now() - interval '30 days'" }` | el SQL | `withCheck`, o `using` |
| Solo check sin formato | `{ operation: "insert", withCheck: "{owner_id} = rebase.uid()" }` | ninguna fila | el SQL |
| Solo roles | `{ operation: "delete", roles: ["admin"] }` | cada fila, para los roles | lo mismo |

Cada forma también acepta las claves compartidas:

| Clave | Predeterminado | Qué hace |
|---|---|---|
| `operation` | `"all"` | `"select"`, `"insert"`, `"update"`, `"delete"` o `"all"`. |
| `operations` | | Varias operaciones a la vez; se genera una política por operación. Tiene prioridad sobre `operation`. |
| `roles` | | Roles de la aplicación; la regla se aplica solo a un llamador que posea uno de ellos. Se combina con AND con el resto de la regla. |
| `mode` | `"permissive"` | `"restrictive"` convierte la regla en una barrera que también debe cumplirse. Consulta [Permisivas y restrictivas](#permisivas-y-restrictivas). |
| `name` | derivado | El nombre de la política. Sin él, el nombre se deriva de la tabla, la operación y un hash de la regla, por lo que editar una regla renombra su política. |
| `pgRoles` | `["public"]` | Roles nativos de Postgres: la cláusula `TO` de `CREATE POLICY`. No es lo mismo que `roles`. |

Los `roles` son roles de aplicación de Rebase, almacenados en la columna `roles` de
la tabla de usuarios y leídos dentro de una política a través de `rebase.roles()`. No son roles
de Postgres: nombres como `anon` o `authenticated` pertenecen a `pgRoles`, y en `roles`
producen una condición que ningún usuario cumple. Prácticamente todos los proyectos necesitan `roles`.

:::note[Reglas migradas desde 0.30]
El compilador de la versión 0.30 leía solo una cláusula de una regla y no reconocía ningún valor de `access` excepto
`"public"`, por lo que cuatro variantes ahora otorgan algo diferente: un
`access: "authenticated"` simple no otorgaba nada y ahora admite a cualquier llamador autenticado.
`rebase migrate collections-to-tables` enumera cada una bajo "Revisar antes de desplegar"; consulta
[la guía de actualización](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning).
:::

### Propietario (Owner)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const notes = defineTable("notes", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        ownerId: col.uuid().notNull().onCreateUser(),
        body:    col.text(),
    },
    rls: [{ operation: "all", ownerField: "ownerId" }],
});
```

Esto genera `USING ((owner_id)::text = (SELECT rebase.uid()))`.
`ownerField` nombra una clave de columna, una columna SQL o una relación `belongsTo` (su
columna de clave foránea). Compara la columna con el id del llamador; no la
rellena. `.onCreateUser()` hace que el servidor escriba el id del llamador al crear,
independientemente de lo que haya enviado la solicitud, que es lo que le da sentido a la comparación.

### Acceso público

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`{ operation: "select", access: "public" }` genera `USING (true)`: sin filtro de
filas en las lecturas, por lo que cualquier llamador al que la API dé paso lee cada fila.

Amplía qué filas ve un llamador, no quién puede llamar. De forma predeterminada, la API sigue
respondiendo 401 a una solicitud sin token. Establece `AUTH_REQUIRE=false`
(`auth.requireAuth: false`) para eliminar esa barrera y permitir que solo las políticas
decidan; entonces, un llamador no autenticado también podrá leer estas filas.

`{ access: "authenticated" }` es lo mismo pero con una comprobación de inicio de sesión: el llamador tiene
una sesión. Un invitado creado mediante inicio de sesión anónimo tiene una.
`{ access: "registered" }` también excluye a los invitados; úsalo preferentemente en proyectos con
inicio de sesión anónimo. Ambos se combinan con `condition` y `check` al igual que `"public"`.
Consulta [`authenticated()` y `registered()`](#authenticated-y-registered).

### Condiciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una `condition` indica qué filas existentes cubre una regla; un `check` indica qué valores
nuevos o actualizados permite, y por defecto toma el valor de la condición. Ambos aceptan la
forma abreviada de objeto o una expresión estructurada.

La **forma abreviada** es un objeto simple de claves de columna y valores literales. Se cumple
cuando cada columna coincide con su valor, y un valor `null` significa `IS NULL`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const reports = defineTable("reports", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        state:     col.enum(["open", "closed"]).notNull().default("open"),
        public:    col.boolean().notNull().default(false),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    rls: [
        // Anyone reads public reports that are not deleted.
        { operation: "select", access: "public", condition: { public: true, deletedAt: null } },
        // Signed-in callers may file a report, but only as an open one.
        { operation: "insert", access: "authenticated", check: { state: "open" } },
    ],
});
```

La forma abreviada necesita al menos una clave, y ninguna clave puede llamarse `kind` (así
es como se reconoce una expresión estructurada; compara una columna llamada `kind` con
la forma detallada). Sus claves se validan contra la tabla al compilar el
esquema: una clave que no corresponda a ninguna columna es rechazada, indicando la tabla y la clave en
el error.

Una condición **estructurada** se construye con `policy`, importado desde
`@rebasepro/types`. Se compila a SQL para la base de datos y se evalúa en
JavaScript mediante el CMS, de modo que el CMS nunca ofrece una acción que la base de datos vaya a
rechazar:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { policy } from "@rebasepro/types";

export const documents = defineTable("documents", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        teamId: col.uuid().notNull(),
        userId: col.uuid().notNull(),
    },
    rls: [
        // The owner, or anyone holding `moderator`.
        {
            operation: "update",
            condition: policy.or(
                policy.compare(policy.field("userId"), "eq", policy.authUid()),
                policy.rolesOverlap(["moderator"])
            ),
        },
        // Members of the document's team read it.
        {
            operation: "select",
            condition: policy.existsIn({
                table: "team_members",
                where: policy.and(
                    policy.compare(policy.field("team_id"), "eq", policy.outerField("teamId")),
                    policy.compare(policy.field("user_id"), "eq", policy.authUid())
                ),
            }),
        },
    ],
});
```

Dentro de `existsIn`, `policy.field()` nombra una columna de la otra tabla y
`policy.outerField()` una columna de la fila que se está comprobando. Se compila en una
subconsulta `EXISTS` correlacionada.

| Expresión | Compila a |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` / `policy.not(e)` | conjunción, disyunción, negación |
| `policy.compare(left, op, right)` | una comparación; `op` es `"eq"`, `"neq"`, `"lt"`, `"lte"`, `"gt"` o `"gte"` |
| `policy.rolesOverlap(roles)` | el llamador posee **cualquiera** de estos roles |
| `policy.rolesContain(roles)` | el llamador posee **todos** estos roles |
| `policy.authenticated()` | un llamador autenticado |
| `policy.registered()` | un llamador autenticado con cuenta, no un invitado |
| `policy.serverContext()` | `rebase.uid() IS NULL`; consulta la advertencia más abajo |
| `policy.existsIn({ table, where })` | un `EXISTS` correlacionado sobre otra tabla; uno sin `table` se rechaza cuando el esquema compila |
| `policy.raw(sql)` | el SQL, insertado tal como se escribió |

| Operando | Significado |
|---|---|
| `policy.field(name)` | una columna de la fila que se está comprobando, o dentro de `existsIn` de la otra tabla |
| `policy.outerField(name)` | dentro de `existsIn`, una columna de la fila que se está comprobando |
| `policy.literal(value)` | una cadena, número, booleano o `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | los roles del llamador como un array |
| `policy.authClaim(name)` | un claim personalizado en el token de sesión, convertido al tipo de la columna con la que se compara |

`existsIn`, `raw` y `authClaim` son evaluados únicamente por la base de datos; el CMS
los trata como desconocidos y refleja lo que informa el servidor.

### SQL sin formato

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`using` y `withCheck` aceptan SQL. `{column}` se resuelve a la columna de la tabla, y
el llamador está disponible como `rebase.uid()`, `rebase.roles()` (roles separados por
comas) y `rebase.jwt()` (los claims del token como `jsonb`):

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        orgId:    col.uuid().notNull(),
        isLocked: col.boolean().notNull().default(false),
    },
    rls: [
        {
            operation: "select",
            using: "EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = {org_id} AND m.user_id = rebase.uid())",
        },
        { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" },
    ],
});
```

El SQL sin formato es aplicado únicamente por Postgres: el CMS no puede evaluarlo. Prefiere una
condición abreviada o estructurada siempre que sea posible expresar lo mismo.

## Evaluado una vez por sentencia

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada parte de una regla que no lea la fila —el id del llamador, una comprobación
de roles, un claim, `serverContext()`— se compila dentro de una subconsulta escalar. Una regla de
propietario se convierte en `(user_id)::text = (SELECT rebase.uid())`. Postgres calcula dicha
subconsulta una vez por sentencia en lugar de una vez por fila, y planifica como si la
comprobación pasara la mitad de la tabla en lugar del 1.5% de ella, lo que mantiene las páginas profundas de una
tabla grande en su índice. Quién puede leer o escribir qué permanece sin cambios.

El SQL sin formato recibe el mismo tratamiento cuando Rebase puede interpretar su estructura
(`owner_id = rebase.uid()` lo hace). Cualquier otra cosa se inserta tal como se escribió, por lo que
debes envolver las llamadas tú mismo: `(SELECT rebase.uid())`.

## `authenticated()` y `registered()`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A una solicitud sin ninguna sesión se le asigna un id centinela, por lo que `rebase.uid()`
nunca es `NULL` en una solicitud, y `policy.authenticated()` (al igual que
`access: "authenticated"`) la excluye.

Un **invitado** es diferente: `POST /auth/anonymous` crea una fila de usuario real con
una sesión real, por lo que un invitado pasa cada prueba que verifique el id.
`policy.registered()` (y `access: "registered"`) es `authenticated()` más
"no ser un invitado". Úsalo siempre que una regla concierna a una persona que deba rendir
cuentas o asumir responsabilidades —escribir una reseña, unirse a una organización, gastar dinero—
y `authenticated()` donde un invitado sea bienvenido: un carrito antes del pago, un borrador antes de registrarse.

:::caution[`serverContext()` no se satisface con `dataAsAdmin`]
Se compila a `rebase.uid() IS NULL`, verdadero solo para los flujos integrados que
se ejecutan sin usuario (registro, migraciones). `rebase.dataAsAdmin` se ejecuta como
`uid: "service"` con el rol `admin`, por lo que es **falso** allí. Una tabla con
`defaultPolicies: false` cuya única regla sea `serverContext()` rechazará esas
escrituras y no devolverá filas a esas lecturas. `rebase.sql()` es el método de acceso que
elude las políticas.
:::

## Permisivas y restrictivas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las reglas permisivas (las predeterminadas) se combinan mediante OR: se accede a una fila cuando cualquiera de
ellas lo admite. Las reglas restrictivas se combinan mediante AND con ellas: cada regla restrictiva también
debe cumplirse. Una regla permisiva amplía el acceso; una restrictiva solo puede
reducirlo. El aislamiento de inquilinos (*tenancy*) es una regla restrictiva por esa razón: una regla `access: "public"`
en otra parte de la tabla no puede anular el límite del inquilino.

## Qué falla de forma cerrada

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una tabla no puede volverse accesible por accidente:

- **En el editor**, `rls` es obligatorio y `[]` no es un valor válido.
- **Al cargar el módulo**, `defineTable` lanza un error si `rls` falta, está vacío
  o no es una de las tres posturas, por lo que JavaScript y las conversiones de tipo (*casts*) también se detectan.
- **Al compilar el esquema** — `rebase db generate`, `rebase db push`,
  `rebase doctor` y el inicio del servidor — el esquema se rechaza si se usa `"inherit"`
  sin un `defaultRls`, `"admin-only"` con `defaultPolicies: false`, y una
  regla que mencione una columna que la tabla no tiene (en `ownerField`, una
  clave abreviada o un `policy.field()`). De lo contrario, un error tipográfico en una regla llegaría
  a `CREATE POLICY` y fallaría allí, en una tabla cuya seguridad a nivel de fila
  ya está activada, dejándola inaccesible para todos.
- **Sin un esquema**, cuando el backend lee las tablas desde la base de datos, una
  tabla sin `ENABLE ROW LEVEL SECURITY` no se sirve. El inicio del servidor la menciona, junto
  con el `ALTER TABLE … ENABLE ROW LEVEL SECURITY` que la protege. Consulta
  [Solo backend](/docs/getting-started/headless/).

Cada solicitud ejecuta sus sentencias bajo un rol de base de datos al que se
aplica la seguridad a nivel de fila, dentro de una transacción que transporta el id, los roles
y los claims del llamador. Eso es lo que leen `rebase.uid()`, `rebase.roles()` y `rebase.jwt()`.

## Solicitudes sin sesión

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una solicitud sin token llega a las políticas únicamente cuando `AUTH_REQUIRE=false`;
de lo contrario, la API responde 401 primero. Luego se ejecuta con `rebase.uid()` establecido
en `'anonymous'` y sin roles: las reglas `access: "public"` la admiten, mientras que
`access: "authenticated"` y las reglas de propietario no.

Un formulario de contacto acepta inserciones de cualquiera y es leído únicamente por administradores:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contactMessages = defineTable("contact_messages", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        email:   col.text().notNull().validate({ email: true }),
        message: col.text().notNull().validate({ max: 5000 }),
    },
    rls: [
        { operation: "insert", access: "public" },
        { operations: ["select", "update", "delete"], roles: ["admin"] },
    ],
});
```

## Filas aquí, columnas al lado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rls` decide a qué filas puede acceder un llamador. No tiene nada que decir sobre las
columnas de una fila a la que sí acceda: una regla que permite a un empleado leer las filas de su
equipo le permite leer todas las columnas de esas filas, salario incluido. Las reglas
por columna se definen con [`.access()`](/docs/collections/field-access/) en la columna:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Everyone the rules let read the row; only HR receives this column.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Los roles son los mismos roles: `policy.rolesOverlap(["hr"])` en una regla y
`.access({ read: ["hr"] })` en una columna se refieren al mismo `hr`. Las reglas de columnas
son aplicadas por el servidor, por lo que cubren todas las rutas de la API; una consulta ejecutada a través
de `rebase.sql()` ve todas las columnas, ya que elude la seguridad a nivel de fila.

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Acceso a campos](/docs/collections/field-access/): roles de lectura y escritura por columna
- [Multiinquilino (Tenancy)](/docs/collections/tenancy/): un límite restrictivo por inquilino
- [Roles y alcances](/docs/backend/roles-and-scopes/): de dónde provienen los roles
- [La tabla de usuarios](/docs/schema/auth-table/): las políticas que agrega `defineAuthTable`
