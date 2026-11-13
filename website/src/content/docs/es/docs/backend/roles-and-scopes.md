---
sourceHash: 1610ca294114442e
title: Roles y scopes
sidebar_label: Roles y scopes
description: "Lo que un solicitante puede hacer: el plano de datos que cada persona posee, el plano de administración que otorgan los roles, los scopes que una aplicación declara para sí misma y cómo los porta cada credencial."
---

Cada solicitud a un backend de Rebase plantea una pregunta: ¿puede este solicitante hacer esto?
La respuesta es un **scope**, una cadena con el formato `resource:action`: `data:read`,
`users:write`, `cron:read`. La sesión de una persona, una clave de API, un token MCP y un
rol contienen scopes, y todos usan las mismas cadenas. Una concesión se lee igual
en una clave, en un rol y en una pantalla de consentimiento.

## Dos planos

Los scopes se dividen en dos planos, y una persona los posee de forma diferente.

**El plano de datos** comprende `data:*`, `storage:*` y `functions:invoke`. Toda
persona que haya iniciado sesión lo posee por completo. Lo que una persona puede hacer con una fila lo determina
la [seguridad a nivel de fila](/docs/collections/security-rules/) de la tabla, fila por fila,
y lo que puede hacer con un archivo lo determinan las [políticas de almacenamiento](/docs/backend/storage-authorization/).
Un scope nunca decide eso para una persona. En una clave o un token, los scopes del plano de datos
se restringen: una clave que solo posea `data:read:posts` lee `posts` y nada más,
independientemente de lo que permitirían las reglas.

**El plano de administración** es todo lo demás: usuarios, esquema, base de datos, copias de seguridad,
cron, registros (logs) y claves. Nadie lo posee de forma implícita. El rol integrado `admin` lo posee
por completo. Cualquier otro rol posee lo que la aplicación declare para él.

## Los scopes

| Scope | Plano | Objetivo | Lo que permite |
|---|---|---|---|
| `data:read` | datos | colección | Leer filas, mediante la seguridad a nivel de fila del solicitante |
| `data:write` | datos | colección | Crear y actualizar filas, mediante la seguridad a nivel de fila del solicitante |
| `data:delete` | datos | colección | Eliminar filas, mediante la seguridad a nivel de fila del solicitante |
| `storage:read` | datos | fuente de almacenamiento | Listar y descargar archivos |
| `storage:write` | datos | fuente de almacenamiento | Subir archivos y crear carpetas |
| `storage:delete` | datos | fuente de almacenamiento | Eliminar archivos |
| `functions:invoke` | datos | función | Invocar funciones personalizadas. Una función puede hacer todo lo que haga su código |
| `users:read` | admin | — | Listar cuentas y sus roles |
| `users:write` | admin | — | Crear, editar y eliminar cuentas, restablecer contraseñas y segundos factores, asignar roles hasta los que posea el propio titular |
| `schema:read` | admin | — | Leer el esquema, planificar cambios en el esquema, ejecutar la auditoría de RLS, leer la documentación de la API privada |
| `schema:write` | admin | — | Aplicar cambios en el esquema: edita los archivos del esquema y modifica la base de datos |
| `database:read` | admin | — | Listar bases de datos, tablas, roles de Postgres y ramas |
| `database:write` | admin | — | Ejecutar SQL como propietario de la base de datos, fuera de la seguridad a nivel de fila, y crear o eliminar ramas |
| `backups:read` | admin | — | Listar y descargar copias de seguridad: cada fila, fuera de la seguridad a nivel de fila |
| `cron:read` | admin | — | Listar tareas cron y leer su historial de ejecución |
| `cron:write` | admin | — | Activar tareas cron y habilitarlas o deshabilitarlas |
| `logs:read` | admin | — | Leer los registros del servidor |
| `keys:read` | admin | — | Listar las claves de servicio del proyecto. Nunca se puede otorgar a una clave |
| `keys:write` | admin | — | Crear, modificar y revocar claves de servicio. Nunca se puede otorgar a una clave |

`GET /api/auth/scopes` devuelve esta lista para el backend en ejecución, con los scopes
propios de la aplicación añadidos, más los scopes que posee el solicitante. Cualquier
solicitante que haya iniciado sesión puede leerla:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Objetivos

Un scope del plano de datos se puede delimitar a un único objetivo, tras un segundo signo de dos puntos:

- `data:read:posts` lee únicamente la tabla `posts`. El objetivo es el slug de una tabla.
- `storage:write:avatars` solo sube archivos a la fuente de almacenamiento `avatars`. El id de la
  fuente predeterminada es `(default)`: `storage:read:(default)`.
- `functions:invoke:export` solo llama a la función `export`.

El scope general cubre todos los objetivos. Un scope delimitado cubre su propio objetivo y
nada más. Nunca responde a una consulta sobre todos los objetivos: una clave que posea
`data:read:posts` no puede listar todas las tablas.

Los scopes del plano de administración no aceptan objetivos. Un scope de aplicación acepta uno cuando declara un
`target`, como se muestra a continuación.

## Declaración de roles

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los roles se declaran en la [tabla de usuarios](/docs/schema/auth-table/), bajo
`auth.roles`. Un rol es un nombre que la base de datos reconoce, con el cual
pueden coincidir las políticas de seguridad a nivel de fila, más una lista de scopes del plano de administración y de la aplicación.

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        roles: col.text({ enum: ["admin", "support", "developer", "editor"] }).array(),
    },
    rls: "admin-only",
    auth: {
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"],
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"],
            },
        },
    },
});
```

Una persona posee un rol cuando su columna `roles` lo incluye. Asígnalo en el panel
de administración o mediante `PUT /api/admin/users/:uid`.

El arranque rechaza cualquier declaración que parezca una concesión que en realidad no es:

- **`admin` no se puede declarar.** Viene integrado y posee todos los scopes.
- **Un rol no puede listar un scope del plano de datos.** Cada persona ya posee el plano
  de datos. `data:write` en un rol no otorgaría nada y daría la impresión de haber otorgado
  algo. Lo que un rol puede hacer con las filas corresponde a la configuración [`rls`](/docs/collections/security-rules/) de la tabla.
- **Cada scope debe existir.** Un nombre desconocido provoca un error en el arranque y lista los válidos.

Un rol que no declares sigue siendo un rol. `editor` en el ejemplo anterior no tiene entrada, por lo que
no posee ningún scope del plano de administración, y una política de RLS aún puede coincidir con él.

`defaultRole`, el rol que recibe cada nuevo usuario registrado, no puede ser `admin` ni un
rol declarado que posea algún scope del plano de administración. Un desconocido que se registre
no debería poseer nada que administre el proyecto. El arranque lo rechazará.

:::note[`schema-admin` ya no existe]
Las versiones anteriores trataban a un rol llamado `schema-admin` como un segundo administrador. Ahora
no significa nada por sí solo. Si tu proyecto lo utilizaba, decláralo con los scopes
que pretendías, por ejemplo
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` lista `admin` y cada rol declarado con sus scopes. Requiere
`users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Scopes de la aplicación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una aplicación puede definir sus propias operaciones como scopes, bajo `auth.scopes`:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project",
            },
        },
    },
});
```

El nombre es `resource:action`, en minúsculas, sin objetivo. No puede reutilizar un
recurso integrado: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` y `keys` ya están ocupados. `label` es obligatorio,
ya que es lo que lee una persona al otorgar el scope. `target` especifica qué
significa un objetivo, permitiendo que una clave contenga `project:deploy:p1`.

Toda persona que haya iniciado sesión posee todos los scopes de la aplicación. Al igual que con el plano de datos, el código
detrás del scope decide si esta persona puede actuar. El scope existe para que
una clave pueda restringirse a esa única acción. Un rol también puede incluir scopes de aplicación.

Verifica uno en una [función personalizada](/docs/backend/custom-functions/) mediante `requireScope`:

```typescript
import { defineFunction, requireAuth, requireScope, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post(
        "/:project",
        requireAuth,
        requireScope("project:deploy", c => c.req.param("project")),
        async (c) => {
            // A person always passes requireScope. Decide here whether
            // this person may deploy this project.
            return c.json({ project: c.req.param("project"), by: getUserId(c) });
        }
    );
});
```

Una clave que contenga `project:deploy:p1` es válida para `p1` y recibe `403 SCOPE_MISSING`
para cualquier otro proyecto. También necesita `functions:invoke`, o
`functions:invoke:<name>` para esta función, para poder acceder a la función en absoluto.
`hasScope(c, scope, target)` y `getScopes(c)` responden a la misma pregunta dentro de un
controlador.

`requireScope`
rechaza un scope que nadie podría poseer. Un nombre que no sea un scope, o un scope integrado
mal escrito como `data:raed`, lanza un error al cargar la función. Un scope de aplicación que
el backend no declare bajo `auth.scopes` responde a cualquier solicitante,
incluso a un administrador, con `500 SCOPE_NOT_DECLARED`.

## Qué significa admin

`admin` es el único rol integrado, y es más que una simple lista de scopes:

- Posee todos los scopes del plano de administración, incluido `keys:*`.
- Es un rol que la base de datos reconoce. Las políticas predeterminadas que Rebase agrega a cada
  tabla lo admiten, por lo que un admin lee y escribe cada fila de una tabla que las conserve.
  Una tabla con `defaultPolicies: false` las descarta.
- Solo un admin puede otorgar `admin`. Un rol que liste todos los scopes del plano de administración
  sigue sin ser `admin`: no puede conceder `admin` y las políticas predeterminadas no lo admiten.

`requireAdmin` comprueba si se posee el rol. Prefiere `requireScope` para cualquier acción que un
rol más restringido o una clave deban poder realizar.

## Nadie otorga más de lo que posee

Una regla abarca cada vía que concede acceso: **no se otorga nada con más permisos
de los que posee quien lo otorga.**

Para las claves:

- Los scopes de una clave deben estar dentro de los de su creador. De lo contrario, `403 SCOPE_EXCEEDS_CREATOR`.
- Los roles de RLS de una clave de servicio deben ser roles que su creador posea, a menos que el creador
  sea un admin. De lo contrario, `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` y `keys:write` nunca se asignan a una clave. Una clave que administre claves podría
  acuñar su propia sucesora. `400 KEY_MANAGEMENT_SCOPE`.
- Quien posea `keys:write` no puede modificar ni revocar una clave que tenga un rol o
  scope que no posea, a menos que sea admin: `403 KEY_OUTRANKS_CALLER`.
  Sin esto, podría ampliar una clave con rol de admin a todos los scopes de datos.

Para las cuentas, quien posea `users:write`:

- No puede editar, restablecer ni eliminar una cuenta cuyos roles contengan un scope que no posea,
  ni a un `admin` si no es administrador:
  `403 ACCOUNT_OUTRANKS_CALLER`. Sin esto, un rol de soporte podría restablecer la contraseña
  de un admin e iniciar sesión en su nombre.
- No puede otorgar roles que contengan más de lo que posee, incluido `admin`: `403 ROLE_EXCEEDS_CALLER`.

El nombre de un rol puede ser cualquiera, excepto uno que pueda interpretarse como otros
roles: un nombre vacío o que contenga `,`, `{`, `}`, `"`, `\` o un carácter
de control se rechaza con `400 INVALID_ROLE` dondequiera que se escriba un rol (usuarios,
la tabla de usuarios, claves de servicio).

## Cómo porta scopes cada credencial

| Credencial | Actúa como | Posee |
|---|---|---|
| Sesión de una persona | la persona | el plano de datos, todos los scopes de aplicación y los scopes de sus roles. Un admin posee todo |
| [Clave de servicio](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, con los roles de RLS `service` más sus propios `roles` | exactamente sus scopes |
| [Clave personal](/docs/backend/api-keys/#personal-keys) `rk_live_…` | su propietario, con los roles del propietario tal como estén en cada solicitud | sus scopes, limitados a lo que el propietario posea en ese momento |
| [Token MCP](/docs/ai/remote-mcp/) | la persona que lo conectó | `data:read`, `data:write`, `data:delete` según lo otorgado, opcionalmente por tabla |
| `REBASE_SERVICE_KEY` | `service`, con el rol `admin` | todo |

Una clave o un token nunca elude la seguridad a nivel de fila. Sus scopes constituyen un límite,
y las políticas de la base de datos para la identidad como la que actúa constituyen otro.

## Cuando falta un scope

La respuesta es `403 SCOPE_MISSING`, y `details.requiredScope` indica el scope,
con su objetivo si lo tiene:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Para una persona, la solución es un rol que incluya el scope. Para una clave, es una nueva clave
que lo posea.

## Próximos pasos

- [Claves de API](/docs/backend/api-keys/): claves de servicio, claves personales y las reglas de creación
- [Seguridad a nivel de fila](/docs/collections/security-rules/): lo que una persona puede hacer con cada fila
- [Índice de endpoints](/docs/backend/endpoints/): el scope que necesita cada ruta
- [Códigos de error](/docs/backend/errors/#authentication-and-accounts): cada rechazo mencionado anteriormente
