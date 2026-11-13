---
sourceHash: 8f9385dd3838df4f
title: Claves de API
sidebar_label: Claves de API
description: "Claves de larga duración para scripts, CI, agentes e integraciones: claves de servicio y claves personales, los alcances que poseen, cómo se combinan con la seguridad a nivel de fila y las rutas que las administran."
---

## Claves de API

Una clave de API es una credencial de portador (bearer) de larga duración, `rk_live_…`,
para un emisor que no es una persona en un navegador: un script, un trabajo de CI,
un agente, un cliente MCP, otro servicio. Lo que una clave puede hacer es una lista de
[alcances](/docs/backend/roles-and-scopes/), como `data:read:orders` o `cron:write`.

Existen dos tipos:

- Una **clave de servicio** es la identidad de máquina propia del proyecto. Actúa como
  `api-key:<id>`, no como una persona. Cualquier usuario que posea `keys:write` las gestiona,
  en `/api/admin/api-keys`.
- Una **clave personal** actúa como la cuenta que la creó. Cada cuenta administra las
  suyas, en `/api/auth/keys`, cuando la aplicación las habilita.

### Uso de una clave

Envíela como un token bearer, como un token de acceso. `$API_URL` es la dirección
de su backend: lo que haya mostrado `rebase dev`, o la URL de su despliegue.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La misma clave funciona en la API REST, almacenamiento, funciones personalizadas, las superficies
de administración que sus alcances cubran, el WebSocket en tiempo real y el [endpoint `/mcp`](/docs/ai/remote-mcp/).

## Claves de servicio

### Crear una

Una clave de servicio necesita un nombre y al menos un alcance.

```bash
# CLI: talks to the backend with the service key from .env
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders

# REST: needs keys:write
curl -X POST "$API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $REBASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order sync",
    "scopes": ["data:read:orders", "data:write:orders"]
  }'
```

O con el SDK de cliente:

```ts
const { key } = await client.apiKeys.createKey({
    name: "Order sync",
    scopes: ["data:read:orders", "data:write:orders"],
    expires_at: "2027-01-01T00:00:00.000Z"
});
console.log(key.key); // the only time the plaintext is returned
```

La respuesta incluye la clave completa en texto plano (`rk_live_...`) **exactamente una vez**.
Guárdela de inmediato.

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Una etiqueta para personas |
| `scopes` | `string[]` | Lo que la clave puede hacer. Al menos uno |
| `roles` | `string[]` | Roles RLS con los que se ejecuta la clave, además de `service`. Opcional |
| `rate_limit` | `number \| null` | Solicitudes por ventana de 15 minutos. `null` o ausente utiliza el valor predeterminado del servidor para claves de API, 1000. Consulte [Límite de tasa](#límite-de-tasa) |
| `expires_at` | `string \| null` | Expiración en ISO-8601. Si está ausente, nunca expira |

### Alcances y RLS: dos controles independientes

Una solicitud realizada con una clave pasa dos verificaciones, y ambas deben permitirla:

1. **Los alcances de la clave**, verificados por la ruta: `data:write:orders` permite que
   la clave escriba en `orders` y nada más.
2. **Seguridad a nivel de fila (RLS)**, verificada por la base de datos. Una clave nunca la
   elude. Una clave de servicio se ejecuta como `uid: "api-key:<id>"` con el rol `service`,
   más cualquier `roles` que se le haya asignado. Las reglas de tipo propietario
   (`owner_id = rebase.uid()`) nunca coinciden con ella.

Por lo tanto, una clave que posea `data:read` aún puede obtener resultados vacíos. Es el
comportamiento esperado de RLS, no un error. Otorgue el rol `service` en las reglas `rls`
de la tabla, o asigne a la clave el rol `admin`.

#### Una clave de servicio lee cero filas hasta que una regla otorgue `service`

Este es el paso que hace que una clave con los alcances correctos parezca rota. La política
de RLS que Rebase agrega a cada tabla por defecto compila en:

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Ese es el contexto del servidor, o un administrador. Una clave de servicio sin el rol
`admin` no coincide con ninguna de las dos condiciones. En una tabla cuyo `rls` sea
`"admin-only"`, la solicitud tiene éxito con un resultado vacío y sin ningún error que
explique el motivo. Otorgue el rol explícitamente, en el `rls` de la tabla:

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Dado que `rebase.uid()` contiene el id de la clave, una regla también puede limitar filas
a una clave específica:

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### El rol `admin`

`roles: ["admin"]` (`--roles admin` en la CLI) hace que la clave también se ejecute
con el rol RLS `admin`, por lo que supera las políticas de administración predeterminadas
de cada tabla que las conserve. Esas políticas cubren `SELECT`, `INSERT`, `UPDATE` y
`DELETE`, por lo que la seguridad a nivel de fila no limita las lecturas, escrituras o
eliminaciones de la clave: puede leer, modificar y eliminar cada fila que sus alcances
cubran. El rol también pasa las comprobaciones de administrador fuera de la base de datos:
`requireAdmin` en [funciones personalizadas](/docs/backend/custom-functions/), y las
escrituras que el almacenamiento reserva para administradores. No concede ningún alcance:
la clave sigue accediendo únicamente a lo que indique su lista de `scopes`.

Un creador solo puede otorgar a una clave los roles que él mismo posee, a menos que sea
un administrador.

### Acceso completo, para CI y migraciones

`--full-access` otorga a la clave todos los alcances que posee su creador, excepto
`keys:read` y `keys:write`, que ninguna clave puede poseer. A través de la CLI, que utiliza
la clave de servicio, esto abarca todos los alcances del plano de datos y del plano de
administración. Agregue `--roles admin` y la seguridad a nivel de fila ya no limitará
las filas que lee, modifica o elimina:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Esa es la configuración adecuada para CI, migraciones y herramientas internas de confianza.
No es la configuración adecuada para un agente.

### Límite de tasa

El `rate_limit` de una clave es la cantidad de solicitudes que puede realizar en una
ventana de 15 minutos, y cada vía cuenta contra este en un único bucket, `api-key:<id>`:

- sus solicitudes HTTP a las API de datos, almacenamiento y funciones;
- sus tramas de datos en el socket en tiempo real: lecturas (fetches), recuentos (counts),
  guardados y eliminaciones, así como suscripciones y solicitudes de historial de canal
  que superen la [cuota](/docs/backend/realtime/#what-a-write-costs-and-the-limits) de cada socket;
- sus solicitudes a [`/mcp`](/docs/ai/remote-mcp/).

Sin un `rate_limit`, el bucket mantiene el valor predeterminado del servidor para claves de API,
1000. Una clave personal no tiene un `rate_limit` propio y cuenta en su propio bucket con ese
valor predeterminado. Al superar el límite, una solicitud HTTP responde `429` y una trama de
socket `RATE_LIMITED`.

Las rutas de administración bajo `/api/admin`, y los mensajes de administración del socket como
los del editor SQL, no tienen límite de tasa.

Un administrador que simula una clave ("Simulate access", `x-rebase-simulate-api-key-id`)
gasta su propia cuota, no la de la clave: la integración que se ejecuta con esa clave conserva
todo su presupuesto. Simular o suplantar a un usuario se cobra al administrador de la misma manera.

## Claves personales

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una clave personal actúa **como su propietario**: su uid y sus roles tal como están en
cada solicitud. Las reglas de tipo propietario coinciden con ella, por lo que lee exactamente
lo que leería su propietario, acotado por sus alcances. Es ideal para los scripts propios de
una persona, una CLI en su portátil o una herramienta que conecta a su propia cuenta.

Están desactivadas por defecto, porque cada una es una credencial de larga duración para
una cuenta. Actívelas en el bloque `auth` de la [tabla de usuarios](/docs/schema/auth-table/):

```typescript
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique()
    },
    rls: "admin-only",
    auth: { personalKeys: true }
});
```

Luego, una cuenta con sesión iniciada gestiona sus propias claves:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

Lo mismo a través de REST. `$ACCESS_TOKEN` es el token de acceso propio de la cuenta,
obtenido al iniciar sesión:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Una clave personal acepta `name`, `scopes` y `expires_at`. No incluye `roles`,
porque se ejecuta con los de su propietario, ni `rate_limit`. Enviar cualquiera
de ellos devuelve un error `400 INVALID_INPUT`.

Lo que posee una clave personal son sus alcances, reducidos a lo que su propietario
posee **ahora**. Elimine un rol del propietario y cada clave que haya creado se reducirá
en consecuencia. Elimine la cuenta y sus claves dejarán de funcionar. Desactive
`personalKeys` y todas las claves personales también dejarán de funcionar.

Solo una cuenta puede tener claves personales. Una clave de API, la clave de servicio y
una sesión de invitado son rechazadas: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` para una
clave, `403 PERSONAL_KEY_NEEDS_ACCOUNT` para las otras dos. Con la funcionalidad desactivada,
cada ruta responde `403 PERSONAL_KEYS_DISABLED`.

## Qué abarca cada alcance

### Datos

`data:read`, `data:write` y `data:delete`, generales o limitados a una tabla
(`data:read:posts`). La operación proviene del método HTTP: `GET`, `HEAD` y
`OPTIONS` leen, `POST`, `PUT` y `PATCH` escriben, `DELETE` elimina.
`POST /api/data/:slug/bulk/delete` cuenta como una eliminación, aunque sea un `POST`.

En una ruta anidada, la operación se verifica contra la tabla en la que termina la ruta,
y cada tabla por la que pasa necesita `data:read`. A una clave que solo tenga
`data:read:posts` se le deniega el acceso a `/api/data/authors/1/posts` hasta que también
pueda leer `authors`.

### Almacenamiento

`storage:read` lista y descarga. `storage:write` sube archivos y crea carpetas, y cubre
cada paso de una subida reanudable (TUS), incluida la verificación de desplazamiento (offset)
y la cancelación. `storage:delete` elimina. El objetivo es el id de una fuente de
almacenamiento. El id de la fuente predeterminada es `(default)`, por lo que
`storage:read:(default)` lee únicamente la fuente predeterminada, y `storage:write:avatars`
escribe en una fuente llamada `avatars`. Tras la verificación del alcance,
[`storageAuthorize`](/docs/backend/storage-authorization/) aún se ejecuta, con la
identidad de la clave.

### Funciones

`functions:invoke` invoca cada función personalizada. `functions:invoke:<name>` invoca
una en específico. Listar las funciones en `GET /api/functions` requiere el alcance general.

No otorgue `functions:invoke` a una clave que pretenda que sea de solo lectura. Una función
es código y puede realizar escrituras. Dentro de una función, `getScopes(c)` y `hasScope(c, …)`
leen lo que posee la clave, y una aplicación puede declarar sus propios alcances para que una
función los verifique. Consulte [Funciones personalizadas](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superficies de administración

Un alcance del plano de administración en una clave da acceso a esa superficie. Un
programador que activa tareas cron necesita `cron:write`. Un recopilador de logs necesita
`logs:read`. Un trabajo de copias de seguridad necesita `backups:read`. El
[índice de endpoints](/docs/backend/endpoints/#admin) enumera el alcance que requiere cada ruta.

`keys:read` y `keys:write` nunca pueden asignarse a una clave. Una clave que pudiera administrar
claves podría acuñar su propia sucesora o ampliar sus propios privilegios. Cualquier solicitud
a las rutas de claves realizada con una clave se rechaza con `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`.
Administre las claves como una persona que posea `keys:write`, o con la clave de servicio.

### Tiempo real

Una clave también autentica el WebSocket: envíela en el mensaje `AUTHENTICATE`. Las consultas
(fetches) y suscripciones necesitan `data:read` en su tabla, las operaciones de guardado
`data:write`, y las eliminaciones `data:delete`. Una suscripción a una ruta anidada necesita
el alcance general. Los canales (broadcast y presencia) están denegados para las claves.
Los mensajes del editor SQL y de ramas necesitan `database:read` o `database:write`.

## Agentes y servidores MCP

Un agente requiere la clave más *restringida* que le permita hacer su trabajo. Comience
con alcances delimitados y asígnele un vencimiento:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Omita `data:delete` cuando el agente pueda editar pero no deba eliminar.
`delete` está separado de `write` exactamente por este motivo.

## Reglas de emisión

Cada clave se verifica contra quien la crea, de la misma manera en ambas rutas:

| Rechazo | Cuándo |
|---|---|
| `400 INVALID_SCOPES` | Un alcance está mal formado, es desconocido o incluye un objetivo que no admite. `details.validScopes` enumera los alcances que una clave puede tener. Omite `keys:*`, que ninguna clave puede poseer |
| `400 UNKNOWN_SCOPE_TARGET` | Un objetivo nombra una tabla, fuente de almacenamiento o función que este backend no proporciona |
| `400 KEY_MANAGEMENT_SCOPE` | Se solicitó `keys:read` o `keys:write` |
| `403 SCOPE_EXCEEDS_CREATOR` | Un alcance que el creador no posee. Una clave nunca posee más de lo que tiene la cuenta que la creó |
| `403 ROLE_EXCEEDS_CREATOR` | Un rol de clave de servicio que el creador no posee, cuando el creador no es un administrador |
| `400 INVALID_ROLE` | El nombre de un rol está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control, que RLS interpretaría como otros roles |
| `403 KEY_OUTRANKS_CALLER` | En una modificación (`PUT`) o una revocación (`DELETE`): la clave ya posee un rol o alcance que el emisor no tiene, y el emisor no es un administrador |

Una solicitud para la cual la clave carece de alcance responde `403 SCOPE_MISSING`,
indicando el alcance requerido en `details.requiredScope`. Consulte [Códigos de error](/docs/backend/errors/#authentication-and-accounts).

## Administración de claves

| Método | Ruta | Requiere |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifica `name`, `scopes`, `roles`, `rate_limit` o `expires_at`, bajo las mismas reglas que la creación |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoca |
| `GET` | `/api/auth/keys` | Una cuenta: sus propias claves personales |
| `POST` | `/api/auth/keys` | Una cuenta, con `personalKeys` habilitado |
| `DELETE` | `/api/auth/keys/:id` | Una cuenta: revoca una de las suyas |

Cada ruta devuelve las claves enmascaradas: `key_prefix`, nunca el hash. Cada clave
informa su `kind` (`service` o `personal`), sus `scopes`, sus `roles` y, para una clave
personal, su `owner_uid`.

La CLI cubre las claves de servicio: `rebase api-keys list`, `get`, `create`, `revoke` y
`scopes`, que enumera cada alcance que el backend conoce. Consulte la
[referencia de la CLI](/docs/cli/#rebase-api-keys). Se autentica con `REBASE_SERVICE_KEY`
desde `.env`, y lo envía únicamente al servidor que `rebase dev` está ejecutando para
este proyecto, por lo que con ese servidor detenido no envía nada. Para un servidor
ejecutado de otra manera, como `rebase start` o un contenedor, configure `REBASE_BASE_URL`
con su dirección ([el propio entorno de la CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Claves creadas antes de los alcances

Las claves creadas antes de que existieran los alcances incluyen una lista de `permissions`
y un indicador `admin`. Al iniciar, el almacén asigna a cada una los alcances que posee
actualmente. Nada se amplía; cuando una concesión antigua no tiene una coincidencia exacta,
se restringe:

| Concesión antigua | Alcances actuales |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` y `storage:<op>` para cada operación, más `functions:invoke` si tenía `write` |
| `"storage"` | `storage:<op>` para cada operación |
| `"functions"` | `functions:invoke`, solo si tenía `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, solo si tenía `write` |
| `admin: true` | el rol `admin`, más `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

El secreto no cambia, por lo que las integraciones continúan funcionando. Dos concesiones
se restringen:

- Una concesión de función sin `write` se convierte en nada. Un `GET` solía contar como
  una lectura, pero una función es código y llamarla no es una lectura.
- Una clave de administrador no obtiene `database:*`, a la cual nunca pudo acceder antes,
  y tampoco `keys:*`, que ninguna clave puede poseer.

Las antiguas columnas `permissions` y `admin` se mantienen intactas, de modo que una reversión
a un runtime anterior aún pueda leer sus claves. Una solicitud que envíe `permissions` o
`admin` en lugar de `scopes` se rechaza con `400 INVALID_INPUT`.

## Próximos pasos

- [Roles y alcances](/docs/backend/roles-and-scopes/): cada alcance y cómo los contienen los roles
- [Índice de endpoints](/docs/backend/endpoints/): el alcance que necesita cada ruta
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/): lo que la base de datos aplica por encima de los alcances de una clave
