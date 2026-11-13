---
sourceHash: 3b3d8ad69537b827
title: Roles y scopes
sidebar_label: Roles y scopes
description: "Lo que puede hacer quien realiza la llamada: el plano de datos que cada persona posee, el plano de administración que otorgan los roles, los scopes que una aplicación declara para sí misma y cómo los porta cada credencial."
---

Cada solicitud a un backend de Rebase hace una sola pregunta: ¿puede este invocador hacer esto?
La respuesta es un **scope**, una cadena con el formato `resource:action`: `data:read`,
`users:write`, `cron:read`. La sesión de una persona, una API key, un token MCP y un
rol contienen scopes, y todos usan las mismas cadenas. Una concesión se lee igual
en una clave, en un rol y en una pantalla de consentimiento.

## Dos planos

Los scopes se dividen en dos planos, y una persona los posee de manera diferente.

**El plano de datos** comprende `data:*`, `storage:*` y `functions:invoke`. Toda
persona que haya iniciado sesión posee la totalidad de este plano. Lo que una persona puede hacer con una fila lo decide
la [seguridad a nivel de fila](/docs/collections/security-rules/) de la tabla, fila por fila,
y lo que puede hacer con un archivo lo deciden las [políticas de almacenamiento](/docs/backend/storage-authorization/).
Un scope nunca decide eso para una persona. En una clave o un token, los scopes del plano de datos
se restringen: una clave que solo tiene `data:read:posts` lee `posts` y nada más,
sin importar lo que permitirían las reglas.

**El plano de administración** es todo lo demás: usuarios, esquema, base de datos, copias de seguridad,
cron, registros y claves. Nadie lo posee de forma implícita. El rol integrado `admin` posee
la totalidad de este plano. Cualquier otro rol posee lo que la aplicación declare para él.

## Los scopes

| Scope | Plano | Destino | Lo que permite |
|---|---|---|---|
| `data:read` | data | colección | Leer filas, a través de la seguridad a nivel de fila del invocador |
| `data:write` | data | colección | Crear y actualizar filas, a través de la seguridad a nivel de fila del invocador |
| `data:delete` | data | colección | Eliminar filas, a través de la seguridad a nivel de fila del invocador |
| `storage:read` | data | fuente de almacenamiento | Listar y descargar archivos |
| `storage:write` | data | fuente de almacenamiento | Subir archivos y crear carpetas |
| `storage:delete` | data | fuente de almacenamiento | Eliminar archivos |
| `functions:invoke` | data | función | Llamar a funciones personalizadas. Una función puede hacer todo lo que haga su código |
| `users:read` | admin | — | Listar cuentas y sus roles |
| `users:write` | admin | — | Crear, editar y eliminar cuentas, restablecer contraseñas y segundos factores, asignar roles hasta los propios del titular |
| `schema:read` | admin | — | Leer el esquema, planificar cambios de esquema, ejecutar la auditoría RLS, leer la documentación de la API privada |
| `schema:write` | admin | — | Aplicar cambios de esquema: edita los archivos de esquema y modifica la base de datos |
| `database:read` | admin | — | Listar bases de datos, tablas, roles de Postgres y ramas |
| `database:write` | admin | — | Ejecutar SQL como propietario de la base de datos, fuera de la seguridad a nivel de fila, y crear o eliminar ramas |
| `backups:read` | admin | — | Listar y descargar copias de seguridad: cada fila, fuera de la seguridad a nivel de fila |
| `cron:read` | admin | — | Listar tareas cron y leer su historial de ejecución |
| `cron:write` | admin | — | Activar tareas cron y encenderlas o apagarlas |
| `logs:read` | admin | — | Leer los registros del servidor |
| `keys:read` | admin | — | Listar las claves de servicio del proyecto. Nunca se puede otorgar a una clave |
| `keys:write` | admin | — | Crear, modificar y revocar claves de servicio. Nunca se puede otorgar a una clave |

`GET /api/auth/scopes` devuelve esta lista para el backend en ejecución, con los scopes
propios de la aplicación agregados, más los scopes que posee el invocador. Cualquier invocador
que haya iniciado sesión puede leerla:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Objetivos

Un scope del plano de datos puede restringirse a un objetivo, después de dos puntos adicionales:

- `data:read:posts` lee únicamente la tabla `posts`. El objetivo es el slug de una tabla.
- `storage:write:avatars` solo sube a la fuente de almacenamiento `avatars`. El id de la fuente
  predeterminada es `(default)`: `storage:read:(default)`.
- `functions:invoke:export` solo llama a la función `export`.

El scope genérico cubre todos los objetivos. Un scope restringido cubre su propio objetivo y
nada más. Nunca responde a una pregunta sobre todos los objetivos: una clave que contiene
`data:read:posts` no puede listar todas las tablas.

Los scopes del plano de administración no admiten objetivos. Un scope de aplicación admite uno cuando declara un
`target`, como se muestra a continuación.

## Declarar roles

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los roles se declaran en la [tabla de usuarios](/docs/schema/auth-table/), bajo
`auth.roles`. Un rol es un nombre que la base de datos reconoce, con el cual pueden
coincidir las políticas de seguridad a nivel de fila, además de una lista de scopes de aplicación y del plano de administración.

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

Una persona posee un rol cuando su columna `roles` lo incluye. Asígnalo en el panel de administración
o con `PUT /api/admin/users/:uid`.

El inicio del sistema rechaza cualquier declaración que parezca una concesión cuando no lo es:

- **`admin` no se puede declarar.** Está integrado y contiene todos los scopes.
- **Un rol no puede incluir un scope del plano de datos.** Todas las personas ya poseen el plano
  de datos. `data:write` en un rol no otorgaría nada y daría la impresión de haber otorgado
  algo. Lo que un rol puede hacer con las filas corresponde a la directiva [`rls`](/docs/collections/security-rules/) de la tabla.
- **Cada scope debe existir.** Un nombre desconocido provoca un fallo en el arranque y muestra la lista de los válidos.

Un rol que no declares sigue siendo un rol. `editor` en el ejemplo anterior no tiene ninguna entrada, por lo que
no contiene ningún scope del plano de administración, y una política RLS aún puede coincidir con él.

`defaultRole`, el rol que recibe cada nuevo usuario registrado, no puede ser `admin` ni un
rol declarado que contenga algún scope del plano de administración. Un desconocido que se registre no debería
poseer nada que administre el proyecto. El arranque lo rechazará.

:::note[`schema-admin` ya no existe]
Las versiones anteriores trataban a un rol llamado `schema-admin` como un segundo administrador. Ahora
no tiene ningún significado por sí solo. Si tu proyecto lo utilizaba, decláralo con los scopes
que deseabas, por ejemplo
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

El nombre sigue el formato `resource:action`, en minúsculas, sin objetivo. No puede reutilizar un
recurso integrado: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` y `keys` ya están ocupados. `label` es obligatorio,
porque es lo que una persona lee cuando concede el scope. `target` define el significado
del objetivo, de modo que una clave pueda contener `project:deploy:p1`.

Toda persona que haya iniciado sesión posee todos los scopes de la aplicación. Al igual que en el plano de datos, el código
detrás del scope decide si esta persona puede actuar. El scope existe para que
una clave se pueda restringir a esa única acción. Un rol también puede listar scopes de aplicación.

Comprueba uno en una [función personalizada](/docs/backend/custom-functions/) con `requireScope`:

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

Una clave que contenga `project:deploy:p1` pasa para `p1` y recibe `403 SCOPE_MISSING`
para cualquier otro proyecto. También necesita `functions:invoke`, o
`functions:invoke:<name>` para esta función, para poder acceder a ella.
`hasScope(c, scope, target)` y `getScopes(c)` responden a la misma pregunta dentro de un
manejador.

`requireScope`
rechaza cualquier scope que nadie podría tener. Un nombre que no sea un scope, o uno integrado
mal escrito como `data:raed`, lanza un error cuando la función se carga. Un scope de aplicación que el
backend no declara bajo `auth.scopes` responde a cualquier invocador,
incluido un administrador, con `500 SCOPE_NOT_DECLARED`.

## Qué significa admin

`admin` es el único rol integrado, y es más que una simple lista de scopes:

- Posee todos los scopes del plano de administración, incluido `keys:*`.
- Es un rol que la base de datos reconoce. Las políticas predeterminadas que Rebase agrega a cada
  tabla lo admiten, por lo que un administrador lee y escribe en cada fila de una tabla que las conserve.
  Una tabla con `defaultPolicies: false` las descarta.
- Solo un administrador puede otorgar `admin`. Un rol que liste todos los scopes del plano de administración
  sigue sin ser `admin`: no puede conceder `admin` y las políticas predeterminadas no
  lo admiten.

`requireAdmin` comprueba si se posee el rol. Prefiere `requireScope` para cualquier cosa que un
rol más acotado o una clave deban poder realizar.

## Nadie otorga más de lo que posee

Una regla rige cada vía que otorga acceso: **no se concede nada con más permisos
de los que posee quien lo otorga.**

Para claves:

- Los scopes de una clave deben estar dentro de los de su creador. De lo contrario, `403 SCOPE_EXCEEDS_CREATOR`.
- Los roles RLS de una clave de servicio deben ser roles que su creador posea, a menos que el creador
  sea un administrador. De lo contrario, `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` y `keys:write` nunca se asignan a una clave. Una clave que gestiona claves podría
  generar su propia sucesora. `400 KEY_MANAGEMENT_SCOPE`.
- Quien posea `keys:write` no puede modificar ni revocar una clave que tenga un rol o
  scope que no posea, a menos que sea un administrador: `403 KEY_OUTRANKS_CALLER`.
  Sin esto, podría ampliar una clave con rol de administrador a todos los scopes de datos.

Para cuentas, quien posea `users:write`:

- no puede editar, restablecer ni eliminar una cuenta cuyos roles contengan un scope que no posea,
  ni `admin` si no es administrador:
  `403 ACCOUNT_OUTRANKS_CALLER`. Sin esto, un rol de soporte podría restablecer la contraseña de un
  administrador e iniciar sesión en su lugar.
- no puede otorgar roles que posean más permisos de los que tiene, incluido `admin`: `403 ROLE_EXCEEDS_CALLER`.

El nombre de un rol puede ser cualquiera, excepto uno que pueda malinterpretarse como otros
roles: un nombre vacío, o uno que contenga `,` `{` `}` `"` `\` o un carácter de control,
se rechaza con `400 INVALID_ROLE` en cualquier lugar donde se escriba un rol (usuarios,
la tabla de usuarios, claves de servicio).

## Cómo porta los scopes cada credencial

| Credencial | Actúa como | Posee |
|---|---|---|
| La sesión de una persona | la persona | el plano de datos, todos los scopes de la aplicación y los scopes de sus roles. Un admin posee todo |
| [Clave de servicio](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, con los roles RLS `service` más sus propios `roles` | exactamente sus scopes |
| [Clave personal](/docs/backend/api-keys/#personal-keys) `rk_live_…` | su propietario, con los roles del propietario tal como están en cada solicitud | sus scopes, limitados a lo que el propietario posee en ese momento |
| [Token MCP](/docs/ai/remote-mcp/) | la persona que lo conectó | `data:read`, `data:write`, `data:delete` según lo otorgado, opcionalmente por colección |
| `REBASE_SERVICE_KEY` | `service`, con el rol `admin` | todo |

Una clave o un token nunca eluden la seguridad a nivel de fila. Sus scopes representan un límite superior,
y las políticas de la base de datos para la identidad bajo la que actúa representan otro.

## Cuando falta un scope

La respuesta es `403 SCOPE_MISSING`, y `details.requiredScope` indica el scope,
junto con su objetivo si lo tiene:

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

- [API keys](/docs/backend/api-keys/): claves de servicio, claves personales y las reglas de emisión
- [Seguridad a nivel de fila](/docs/collections/security-rules/): lo que una persona puede hacer con cada fila
- [Índice de endpoints](/docs/backend/endpoints/): el scope que necesita cada ruta
- [Códigos de error](/docs/backend/errors/#authentication-and-accounts): cada uno de los rechazos anteriores
