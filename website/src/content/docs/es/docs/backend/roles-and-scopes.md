---
sourceHash: e89814d78c29b234
title: Roles y alcances
sidebar_label: Roles y alcances
description: "Lo que puede hacer quien llama: el plano de datos que tiene toda persona, el plano de administración que conceden los roles, los alcances que una aplicación declara para sí misma y cómo los lleva cada credencial."
---

<span class="since-badge" data-since="0.24">Desde 0.24</span> Cada solicitud a un backend de Rebase plantea una pregunta: ¿puede quien llama hacer esto?
La respuesta es un **alcance** (scope), una cadena con la forma `resource:action`:
`data:read`, `users:write`, `cron:read`. La sesión de una persona, una clave de API,
un token de MCP y un rol tienen alcances, y todos usan las mismas cadenas. Una
concesión se lee igual en una clave, en un rol y en una pantalla de consentimiento.

## Dos planos

Los alcances se dividen en dos planos, y una persona los tiene de forma distinta.

**El plano de datos** es `data:*`, `storage:*` y `functions:invoke`. Toda persona con
la sesión iniciada lo tiene entero. Lo que una persona puede hacer con una fila lo
deciden las [reglas de seguridad](/docs/collections/security-rules/) de la colección,
fila por fila, y lo que puede hacer con un archivo, las
[políticas de almacenamiento](/docs/backend/storage/#per-object-authorization). Un
alcance nunca decide eso para una persona. En una clave o un token, los alcances del
plano de datos restringen: una clave que solo tiene `data:read:posts` lee `posts` y
nada más, permitan lo que permitan las reglas.

**El plano de administración** es todo lo demás: usuarios, esquema, la base de datos,
copias de seguridad, cron, registros y claves. Nadie lo tiene de forma implícita. El
rol integrado `admin` lo tiene entero. Cualquier otro rol tiene lo que la aplicación
declare para él.

## Los alcances

| Alcance | Plano | Destino | Qué permite |
|---|---|---|---|
| `data:read` | datos | colección | Leer filas, a través de la seguridad a nivel de fila de quien llama |
| `data:write` | datos | colección | Crear y actualizar filas, a través de la seguridad a nivel de fila de quien llama |
| `data:delete` | datos | colección | Eliminar filas, a través de la seguridad a nivel de fila de quien llama |
| `storage:read` | datos | origen de almacenamiento | Listar y descargar archivos |
| `storage:write` | datos | origen de almacenamiento | Subir archivos y crear carpetas |
| `storage:delete` | datos | origen de almacenamiento | Eliminar archivos |
| `functions:invoke` | datos | función | Llamar a funciones personalizadas. Una función puede hacer todo lo que haga su código |
| `users:read` | administración | — | Listar cuentas y sus roles |
| `users:write` | administración | — | Crear, editar y eliminar cuentas, restablecer contraseñas y segundos factores, asignar roles hasta los del propio titular |
| `schema:read` | administración | — | Leer el esquema de colecciones, planificar cambios de esquema, ejecutar la auditoría de RLS, leer la documentación privada de la API |
| `schema:write` | administración | — | Aplicar cambios de esquema: edita los archivos de colección y altera la base de datos |
| `database:read` | administración | — | Listar bases de datos, tablas, roles de Postgres y ramas |
| `database:write` | administración | — | Ejecutar SQL como propietario de la base de datos, fuera de la seguridad a nivel de fila, y crear o eliminar ramas |
| `backups:read` | administración | — | Listar y descargar copias de seguridad: todas las filas, fuera de la seguridad a nivel de fila |
| `cron:read` | administración | — | Listar las tareas cron y leer su historial de ejecuciones |
| `cron:write` | administración | — | Disparar tareas cron y activarlas o desactivarlas |
| `logs:read` | administración | — | Leer los registros del servidor |
| `keys:read` | administración | — | Listar las claves de servicio del proyecto. Nunca se puede conceder a una clave |
| `keys:write` | administración | — | Crear, cambiar y revocar claves de servicio. Nunca se puede conceder a una clave |

`GET /api/auth/scopes` devuelve esta lista para el backend en ejecución, con los
alcances propios de la aplicación añadidos, más los alcances que tiene quien llama.
Cualquier llamante con la sesión iniciada puede leerla:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Destinos

Un alcance del plano de datos se puede restringir a un destino, después de un segundo
signo de dos puntos:

- `data:read:posts` lee solo la colección `posts`. El destino es el slug de una colección.
- `storage:write:avatars` sube archivos solo al origen de almacenamiento `avatars`. El
  id del origen predeterminado es `(default)`: `storage:read:(default)`.
- `functions:invoke:export` llama solo a la función `export`.

El alcance sin destino cubre todos los destinos. Un alcance restringido cubre su
propio destino y nada más. Nunca responde a una pregunta sobre todos los destinos:
una clave que tiene `data:read:posts` no puede listar todas las colecciones.

Los alcances del plano de administración no admiten destino. Un alcance de la
aplicación admite uno cuando declara un `target`, como se ve más abajo.

## Declarar roles

<span class="since-badge" data-since="0.24">Desde 0.24</span> Los roles se declaran en la colección de usuarios, bajo `auth.roles`. Un rol es un
nombre que ve la base de datos, con el que pueden coincidir las políticas de RLS, más
una lista de alcances del plano de administración y de la aplicación.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"]
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"]
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" },
        roles: {
            name: "Roles",
            type: "array",
            columnType: "text[]",
            of: {
                name: "Role",
                type: "string",
                enum: { admin: "Admin", support: "Support", developer: "Developer", editor: "Editor" }
            }
        }
    }
});
```

Una persona tiene un rol cuando su columna `roles` lo incluye. Asígnalo en el panel de
administración, o con `PUT /api/admin/users/:uid`.

El arranque rechaza una declaración que parecería una concesión que no es:

- **`admin` no se puede declarar.** Está integrado y tiene todos los alcances.
- **Un rol no puede incluir un alcance del plano de datos.** Toda persona ya tiene el
  plano de datos. `data:write` en un rol no concedería nada y parecería conceder
  algo. Lo que un rol puede hacer con las filas va en las `securityRules` de la
  colección.
- **Todos los alcances deben existir.** Un nombre desconocido hace fallar el arranque
  y enumera los válidos.

Un rol que no declaras sigue siendo un rol. `editor`, arriba, no tiene entrada, así
que no tiene ningún alcance del plano de administración, y una política de RLS puede
seguir coincidiendo con él.

`defaultRole`, el rol que recibe cada persona nueva que se registra, no puede ser
`admin` ni un rol declarado que tenga algún alcance del plano de administración. Un
desconocido que se registra no debería tener nada que gestione el proyecto. El
arranque lo rechaza.

:::note[`schema-admin` ya no existe]
Las versiones anteriores trataban un rol llamado `schema-admin` como un segundo
administrador. Ahora no significa nada por sí solo. Si tu proyecto lo usaba,
decláralo con los alcances que querías darle, por ejemplo
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` lista `admin` y cada rol declarado con sus alcances. Necesita
`users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Alcances de la aplicación

Una aplicación puede nombrar sus propias operaciones como alcances, bajo
`auth.scopes`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project"
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

El nombre es `resource:action`, en minúsculas y sin destino. No puede reutilizar un
recurso integrado: `data`, `storage`, `functions`, `users`, `schema`, `database`,
`backups`, `cron`, `logs` y `keys` están ocupados. `label` es obligatorio, porque es
lo que lee una persona cuando concede el alcance. `target` nombra lo que significa un
destino, para que una clave pueda tener `project:deploy:p1`.

Toda persona con la sesión iniciada tiene todos los alcances de la aplicación. Igual
que con el plano de datos, el código que hay detrás del alcance decide si esta
persona puede actuar. El alcance existe para que una clave pueda restringirse a esa
única acción. Un rol también puede incluir alcances de la aplicación.

Compruébalo en una [función personalizada](/docs/backend/custom-functions/) con
`requireScope`:

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

Una clave que tiene `project:deploy:p1` pasa para `p1` y recibe `403 SCOPE_MISSING`
para cualquier otro proyecto. También necesita `functions:invoke`, o
`functions:invoke:<name>` para esta función, para llegar siquiera a la función.
`hasScope(c, scope, target)` y `getScopes(c)` responden a la misma pregunta dentro de
un manejador.

## Qué significa admin

`admin` es el único rol integrado, y es más que una lista de alcances:

- Tiene todos los alcances del plano de administración, `keys:*` incluido.
- Es un rol que ve la base de datos. Las políticas predeterminadas que Rebase añade a
  cada colección lo admiten, así que un administrador lee y escribe todas las filas
  de una colección que las conserve. Una colección con
  `disableDefaultPolicies: true` las descarta.
- Solo un administrador puede conceder `admin`. Un rol que incluye todos los alcances
  del plano de administración sigue sin ser `admin`: no puede conceder `admin`, y las
  políticas predeterminadas no lo admiten.

`requireAdmin` comprueba el rol. Prefiere `requireScope` para todo lo que deba poder
hacer un rol más restringido o una clave.

## Nadie concede más de lo que tiene

Una sola regla cubre cada puerta que reparte acceso: **nada se concede con más de lo
que tiene quien lo concede.**

Para las claves:

- Los alcances de una clave deben estar dentro de los de su creador. Si no,
  `403 SCOPE_EXCEEDS_CREATOR`.
- Los roles de RLS de una clave de servicio deben ser roles que tenga su creador,
  salvo que el creador sea administrador. Si no, `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` y `keys:write` nunca van en una clave. Una clave que gestiona claves
  podría crear su propia sucesora. `400 KEY_MANAGEMENT_SCOPE`.

Para las cuentas, quien tiene `users:write`:

- no puede editar, restablecer ni eliminar una cuenta que tenga un rol o un alcance
  que él no tiene: `403 ACCOUNT_OUTRANKS_CALLER`. Sin esto, un rol de soporte podría
  restablecer la contraseña de un administrador e iniciar sesión como él.
- no puede conceder roles que tengan más de lo que él tiene:
  `403 ROLE_EXCEEDS_CALLER`.

## Cómo lleva los alcances cada credencial

| Credencial | Actúa como | Tiene |
|---|---|---|
| La sesión de una persona | la persona | el plano de datos, todos los alcances de la aplicación y los alcances de sus roles. Un administrador lo tiene todo |
| [Clave de servicio](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, con los roles de RLS `service` más sus propios `roles` | exactamente sus alcances |
| [Clave personal](/docs/backend/api-keys/#personal-keys) `rk_live_…` | su propietario, con los roles que este tenga en cada solicitud | sus alcances, recortados a lo que el propietario tiene ahora |
| [Token de MCP](/docs/ai/mcp/#the-remote-endpoint) | la persona que lo conectó | `data:read`, `data:write`, `data:delete` según se concedieron, opcionalmente por colección |
| `REBASE_SERVICE_KEY` | `service`, con el rol `admin` | todo |

Una clave o un token nunca eluden la seguridad a nivel de fila. Sus alcances son un
techo, y las políticas de la base de datos para la identidad con la que actúan son
otro.

## Cuando falta un alcance

<span class="since-badge" data-since="0.24">Desde 0.24</span> La respuesta es `403 SCOPE_MISSING`, y `details.requiredScope` nombra el alcance, con
su destino cuando lo tiene:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Para una persona, la solución es un rol que incluya el alcance. Para una clave, es
una clave nueva que lo tenga.

## Siguientes pasos

- [Claves de API](/docs/backend/api-keys/): claves de servicio, claves personales y las reglas de creación
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/): lo que una persona puede hacer con cada fila
- [Índice de endpoints](/docs/backend/endpoints/): el alcance que necesita cada ruta
- [Códigos de error](/docs/backend/errors/#authentication-and-accounts): todos los rechazos anteriores
