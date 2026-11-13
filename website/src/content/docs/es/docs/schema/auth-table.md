---
sourceHash: c7bebbe33f0a0611
title: La tabla de usuarios
sidebar_label: Tabla de usuarios
description: "defineAuthTable declara la tabla donde auth almacena los usuarios: las columnas que necesita auth, una directiva de autolectura, columnas de privilegios solo para administradores y el modelo de acceso: roles, ámbitos de la aplicación, claves personales y los hooks del ciclo de vida del usuario."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`defineAuthTable` declara la tabla que lee y escribe la autenticación. Es un
`defineTable` con tres elementos añadidos:

- **Las columnas que necesita auth** se añaden cuando la tabla no las declara:
  el correo electrónico, el hash de la contraseña, la columna `roles`, el estado
  de verificación y los demás campos que utiliza el inicio de sesión.
- **Las directivas en las que se basa auth** se añaden sin importar lo que indique
  `rls`: un usuario autenticado lee su propia fila, y solo un administrador puede
  escribir en las columnas de privilegios, de modo que nadie puede autoasignarse
  un rol.
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

Un proyecto tiene como máximo una tabla de usuarios. Se rechazará un segundo
`defineAuthTable` al compilar el esquema; utilice `defineTable` en su lugar.

`rls` es obligatorio aquí al igual que en cualquier tabla. La autolectura
inyectada y el control de escritura de administrador se añaden junto a sus
reglas, por lo que `"admin-only"` es una postura válida: los administradores
gestionan los usuarios y cada usuario sigue leyendo su propia fila.

## Las columnas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Declare las columnas que su aplicación lee o presenta, con los modificadores que
desee; auth añade las que necesita y usted haya omitido. Una columna declarada con
la clave o el nombre SQL de una columna de auth (`email`, `displayName`, `roles`,
`passwordHash`, `emailVerified`, `createdAt`, …) se considera esa columna.

Los secretos del servidor nunca salen del servidor: el hash de la contraseña y el
token de verificación son privados sin importar lo que diga la declaración, por
lo que una lectura nunca los entrega y una escritura del cliente no puede
establecerlos.

Un usuario tiene un rol cuando su columna `roles` lo incluye. Declarar la columna
como `col.text({ enum: [...] }).array()` la limita a los roles que especifique;
omitirla la mantiene abierta, ya que un rol existe tan pronto como se le asigna a
un usuario.

Las reglas en otras tablas pueden hacer referencia a las columnas de la tabla de
usuarios como de costumbre. Una regla en la propia tabla de usuarios también puede
hacer referencia a cada columna de auth, esté declarada o no.

## El bloque `auth`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Clave | Qué hace |
|---|---|
| `roles` | Los roles que un usuario puede tener, cada uno con un `name`, una `description` opcional y los `scopes` del plano de administración y de la aplicación que concede. `admin` está integrado y no se puede declarar. |
| `scopes` | Los propios ámbitos (scopes) de la aplicación, por nombre `resource:action`, cada uno con una `label`, una `description` opcional y un `target` opcional. |
| `personalKeys` | `true` permite que cada usuario cree [claves API personales](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | Se ejecuta cuando un administrador crea un usuario a través de la API: devuelva los valores que se deben almacenar y, opcionalmente, una contraseña temporal para mostrarle al administrador. |
| `onResetPassword` | Se ejecuta cuando un administrador restablece la contraseña de un usuario: devuelva una contraseña temporal o envíe su propio enlace de restablecimiento. |

`roles`, `scopes` y `personalKeys` se entregan con el descriptor de la tabla.
Los dos hooks permanecen en el servidor; el descriptor solo indica cuáles de
ellos existen. [Roles y ámbitos](/docs/backend/roles-and-scopes/) explica qué
concede cada ámbito y cómo las claves y tokens lo restringen.

### `onCreateUser` y `onResetPassword`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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

Una `temporaryPassword` devuelta por `onResetPassword` se convierte en la
contraseña de la cuenta: Rebase calcula su hash, la guarda, cierra todas las
sesiones activas del usuario y se la muestra al administrador para que se la
transmita. No devuelva ninguna si el hook envía su propio enlace de
restablecimiento; en ese caso, la contraseña permanece como está hasta que el
usuario establezca una nueva, y sus sesiones se cerrarán de todos modos.

Ambos hooks reciben un contexto con:

- `hashPassword(password)`: genera el hash con el algoritmo configurado;
- `sendEmail(options)`: envía un correo electrónico, presente solo cuando el
  correo electrónico está configurado. Se resuelve con lo reportado por el
  proveedor (`messageId`, `accepted`, `rejected`);
- `emailConfigured`, `appName` y `resetPasswordUrl`.

## Qué no se ejecuta en las escrituras de auth

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El registro, el inicio de sesión con OAuth y la gestión de usuarios por parte de
un administrador escriben directamente en la tabla de usuarios. Los
[hooks](/docs/collections/callbacks/) de la tabla no se ejecutan para esas
escrituras, por lo que un correo electrónico de bienvenida en `afterSave` nunca se
disparará al registrarse. Colóquelo en los hooks del ciclo de vida de auth
(`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, …) configurados en el
backend. Consulte [Autenticación](/docs/backend/authentication/).

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Autenticación](/docs/backend/authentication/): métodos de inicio de sesión, tokens y los hooks de auth
- [Roles y ámbitos](/docs/backend/roles-and-scopes/): declaración de roles y ámbitos de la aplicación
- [Seguridad a nivel de fila](/docs/collections/security-rules/): las directivas adicionales a las inyectadas
