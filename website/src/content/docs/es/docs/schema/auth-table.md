---
sourceHash: 6d0133e3a1068d99
title: La tabla de usuarios
sidebar_label: Tabla de usuarios
description: "defineAuthTable declara la tabla en la que auth almacena los usuarios: las columnas que auth necesita, una política de autolectura, columnas de privilegios solo para administradores y el modelo de acceso: roles, scopes de la aplicación, claves personales y los hooks del ciclo de vida del usuario."
---

`defineAuthTable` declara la tabla que lee y escribe la autenticación. Es un
`defineTable` con tres cosas añadidas:

- **Las columnas que auth necesita** se añaden cuando la tabla no las declara:
  el correo electrónico, el hash de la contraseña, la columna `roles`, el estado
  de verificación y los demás campos que utiliza el inicio de sesión.
- **Las políticas de las que depende auth** se añaden independientemente de lo
  que indique `rls`: un usuario que ha iniciado sesión lee su propia fila, y solo
  un administrador escribe en las columnas de privilegios, de modo que nadie pueda
  asignarse un rol a sí mismo.
- **Un bloque `auth`** declara el modelo de acceso y los hooks que se ejecutan
  cuando un administrador crea un usuario o restablece una contraseña.

```ts
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        email:       col.text().notNull().unique(),
        displayName: col.text(),
        roles:       col.text({ enum: ["admin", "editor", "support"] }).array(),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    rls: [
        // Editors may list users; everyone reads their own row through the injected policy.
        { operation: "select", roles: ["editor"] },
    ],
    auth: {
        roles: {
            support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] },
        },
        personalKeys: true,
    },
});
```

Un proyecto tiene como máximo una tabla de usuarios. Se rechaza un segundo
`defineAuthTable` al compilar el esquema; cámbielo por un `defineTable`.

`rls` es obligatorio aquí al igual que en cada tabla. La autolectura inyectada y
el control de escritura de administrador se añaden junto a sus reglas, por lo
que `"admin-only"` es una postura válida: los administradores gestionan los
usuarios y cada usuario sigue leyendo su propia fila.

## Las columnas

Declare las columnas que su aplicación lee o presenta, con los modificadores que
desee; auth añade las que necesita y usted haya omitido. Una columna declarada con
la clave o el nombre SQL de una columna de auth (`email`, `displayName`, `roles`,
`passwordHash`, `emailVerified`, `createdAt`, …) se considera esa columna.

Los secretos del servidor nunca salen del servidor: el hash de la contraseña y el
token de verificación son privados independientemente de lo que diga la declaración,
por lo que una lectura nunca los entrega y una escritura de cliente no puede
establecerlos.

Un usuario posee un rol cuando su columna `roles` lo incluye. Declarar la columna
como `col.text({ enum: [...] }).array()` la restringe a los roles especificados;
omitirla la mantiene abierta, ya que un rol existe tan pronto como se le asigna a
un usuario.

Las reglas en otras tablas pueden hacer referencia a las columnas de la tabla de
usuarios como de costumbre. Una regla en la propia tabla de usuarios también puede
hacer referencia a cada columna de auth, esté declarada o no.

## Sin una tabla de usuarios

Declarar una es opcional. La autenticación integrada siempre tiene exactamente
una tabla de usuarios: sin `defineAuthTable`, auth guarda sus usuarios en
`rebase.users` y el servidor sirve esa tabla como la tabla de auth. Los usuarios
son entonces una colección en el panel de administración como cualquier otra
tabla, con las acciones de una tabla de usuarios declarada, y solo los
administradores pueden leerla o escribirla. Esto vale tanto para un proyecto que
declara sus tablas como para uno cuyas tablas se leen de la base de datos.

Si el proyecto ya tiene una tabla llamada `users` (en cualquier esquema) que no
es su tabla de auth, `rebase.users` no se sirve como tabla, y el arranque lo
indica. El inicio de sesión sigue funcionando; declara tú mismo la tabla de
usuarios, con otro slug, para gestionar los usuarios como una colección.

Para añadir columnas, roles o hooks, declárala: parte del
`backend/schema/users.ts` del scaffold, o ejecuta
`rebase schema introspect --users` contra una base de datos que ya tenga
`rebase.users`. Ambos coinciden con la tabla que crea auth (una clave `text` y
todas las columnas de auth), así que `db push` no cambia nada en ella, y una
migración de `db generate` la crea con `IF NOT EXISTS`. Después, añade tus
propias columnas.

## Usuarios gestionados fuera de Rebase

Un backend cuyo `auth` es un [`AuthAdapter`](/docs/backend/auth-adapters/)
no sirve una tabla de usuarios propia: los usuarios pertenecen al adaptador, y
su `userManagement` responde a `/api/admin/users`. Para mostrarlos en el panel
de administración, declara la tabla donde viven con `defineTable`, mapeada sobre
las columnas que tenga, como cualquier otra tabla.

## El bloque `auth`

| Clave | Qué hace |
|---|---|
| `roles` | Los roles que puede tener un usuario, cada uno con un `name`, una `description` opcional y los `scopes` del plano de administración y de la aplicación que otorga. `admin` está integrado y no se puede declarar. |
| `scopes` | Los propios scopes de la aplicación, por nombre `resource:action`, cada uno con una `label`, una `description` opcional y un `target` opcional. |
| `personalKeys` | `true` permite que cada usuario cree [claves API personales](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | Se ejecuta cuando un administrador crea un usuario a través de la API: devuelva los valores a almacenar y, opcionalmente, una contraseña temporal para mostrar al administrador. |
| `onResetPassword` | Se ejecuta cuando un administrador restablece la contraseña de un usuario: devuelva una contraseña temporal o envíe su propio enlace de restablecimiento. |

`roles`, `scopes` y `personalKeys` se sirven con el descriptor de la tabla.
Los dos hooks permanecen en el servidor; el descriptor solo indica cuáles de ellos
existen. [Roles y scopes](/docs/backend/roles-and-scopes/) cubre lo que otorga cada
scope y cómo las claves y los tokens lo restringen.

### `onCreateUser` y `onResetPassword`

```ts
import { randomBytes } from "node:crypto";
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const members = defineAuthTable("members", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        onCreateUser: async (values, ctx) => {
            const temporaryPassword = randomBytes(12).toString("base64url");
            return {
                values: { ...values, passwordHash: await ctx.hashPassword(temporaryPassword), emailVerified: true },
                temporaryPassword,
            };
        },
        onResetPassword: async (_userId, ctx) => {
            if (ctx.emailConfigured && ctx.sendEmail) {
                // Send your own reset link here and return no temporary password.
                return { invitationSent: true };
            }
            return { temporaryPassword: randomBytes(12).toString("base64url"), invitationSent: false };
        },
    },
});
```

Una `temporaryPassword` devuelta desde `onResetPassword` se convierte en la
contraseña de la cuenta: Rebase genera su hash, la guarda, cierra todas las
sesiones del usuario y se la muestra al administrador para que la transmita. No
devuelva ninguna cuando el hook envíe su propio enlace de restablecimiento; la
contraseña permanecerá como está hasta que el usuario establezca una nueva, y sus
sesiones se cerrarán de todos modos.

Ambos hooks reciben un contexto con:

- `hashPassword(password)`: genera el hash con el algoritmo configurado;
- `sendEmail(options)`: envía un correo electrónico, presente solo cuando el
  correo electrónico está configurado. Se resuelve con lo que reportó el
  proveedor (`messageId`, `accepted`, `rejected`);
- `emailConfigured`, `appName` y `resetPasswordUrl`.

## Qué no se ejecuta en las escrituras de auth

El registro, el inicio de sesión con OAuth y la gestión de usuarios por parte de
un administrador escriben directamente en la tabla de usuarios. Los
[hooks](/docs/collections/callbacks/) de la tabla no se ejecutan para esas
escrituras, por lo que un correo electrónico de bienvenida en `afterSave` nunca se
disparará durante el registro. Colóquelo en los hooks del ciclo de vida de auth
(`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, …) configurados en el
backend. Consulte [Autenticación](/docs/backend/authentication/).

## Próximos pasos

- [Autenticación](/docs/backend/authentication/): métodos de inicio de sesión, tokens y los hooks de auth
- [Roles y scopes](/docs/backend/roles-and-scopes/): declaración de roles y scopes de la aplicación
- [Seguridad a nivel de fila](/docs/collections/security-rules/): las políticas junto a las inyectadas
