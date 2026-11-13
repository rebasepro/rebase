---
sourceHash: 92edb85e26e286c4
title: Claves de API
sidebar_label: Claves de API
description: "Claves de larga duración para scripts, CI, agentes e integraciones: claves de servicio y claves personales, los scopes que contienen, cómo se combinan con la seguridad a nivel de fila y las rutas que las administran."
---

## Claves de API

Una clave de API es una credencial de tipo bearer de larga duración, `rk_live_…`, para un emisor de llamadas que no es una persona en un navegador: un script, un trabajo de CI, un agente, un cliente MCP u otro servicio. Lo que una clave puede hacer es una lista de [scopes](/docs/backend/roles-and-scopes/), como `data:read:orders` o `cron:write`.

Hay dos tipos:

- Una **clave de servicio** es la identidad de máquina propia del proyecto. Actúa como `api-key:<id>`, no como una persona. Cualquier usuario que posea `keys:write` las administra, en `/api/admin/api-keys`.
- Una **clave personal** actúa como la cuenta que la creó. Cada cuenta administra las suyas propias, en `/api/auth/keys`, cuando la aplicación las habilita.

### Uso de una clave

Envíala como un token bearer, al igual que un token de acceso. `$API_URL` es la dirección de tu backend: lo que haya impreso `rebase dev` o la URL de tu despliegue.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La misma clave funciona en la API REST, el almacenamiento, las funciones personalizadas, las superficies de administración que alcancen sus scopes, el WebSocket en tiempo real y el [endpoint `/mcp`](/docs/ai/remote-mcp/).

## Claves de servicio

### Creación de una clave

Una clave de servicio necesita un nombre y al menos un scope.

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

La respuesta incluye la clave completa en texto plano (`rk_live_...`) **exactamente una vez**. Guárdala inmediatamente.

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Una etiqueta para personas |
| `scopes` | `string[]` | Lo que la clave puede hacer. Al menos uno |
| `roles` | `string[]` | Roles de RLS con los que se ejecuta la clave, además de `service`. Opcional |
| `rate_limit` | `number \| null` | Solicitudes por ventana de 15 minutos. `null` o ausente utiliza el valor predeterminado del servidor para claves de API, 1000. Consulta [Límite de tasa](#rate-limit) |
| `expires_at` | `string \| null` | Expiración en formato ISO-8601. Ausente significa que nunca expira |

### Scopes y RLS: dos controles independientes

Una solicitud realizada con una clave pasa por dos comprobaciones, y ambas deben permitirla:

1. **Los scopes de la clave**, verificados por la ruta: `data:write:orders` permite a la clave escribir en `orders` y nada más.
2. **Seguridad a nivel de fila (RLS)**, verificada por la base de datos. Una clave nunca la elude. Una clave de servicio se ejecuta como `uid: "api-key:<id>"` con el rol `service`, además de cualquier `roles` que se le haya asignado. Las reglas de tipo propietario (`owner_id = rebase.uid()`) nunca coincidirán con ella.

Por lo tanto, una clave que posea `data:read` aún puede obtener resultados vacíos. Es el funcionamiento normal de RLS, no un error. Otorga el rol `service` en las reglas de seguridad de la colección o asigna a la clave el rol `admin`.

#### Una clave de servicio lee cero filas hasta que una regla otorgue `service`

Este es el paso que hace que una clave con los scopes correctos parezca no funcionar. La política de RLS que Rebase añade a cada tabla de forma predeterminada compila a:

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Ese es el contexto del servidor, o un administrador. Una clave de servicio sin el rol `admin` no coincide con ninguna de las dos ramas. En una tabla cuyo `rls` sea `"admin-only"`, la solicitud se completa con éxito con un resultado vacío y sin ningún error que explique el motivo. Otorga el rol explícitamente en el `rls` de la tabla:

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Debido a que `rebase.uid()` contiene el id de la clave, una regla también puede restringir filas a una sola clave:

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### El rol `admin`

`roles: ["admin"]` (`--roles admin` en la CLI) hace que la clave también se ejecute con el rol de RLS `admin`, por lo que cumple con las políticas de administración predeterminadas de cada colección que las mantenga. Esas políticas cubren `SELECT`, `INSERT`, `UPDATE` y `DELETE`, por lo que la seguridad a nivel de fila no limita las lecturas, escrituras o eliminaciones de la clave: puede leer, modificar y eliminar cada fila que alcancen sus scopes. El rol también supera las comprobaciones de administrador fuera de la base de datos: `requireAdmin` en [funciones personalizadas](/docs/backend/custom-functions/) y las escrituras que el almacenamiento reserva para los administradores. No concede ningún scope: la clave solo puede acceder a lo que indique su lista de `scopes`.

El creador solo puede asignar a una clave los roles que él mismo posea, a menos que sea un administrador.

### Acceso completo, para CI y migraciones

`--full-access` otorga a la clave todos los scopes que posee su creador, excepto `keys:read` y `keys:write`, que ninguna clave puede tener. A través de la CLI, que utiliza la clave de servicio, esto representa todos los scopes del plano de datos y del plano de administración. Añade `--roles admin` y la seguridad a nivel de fila ya no limitará qué filas puede leer, modificar o eliminar:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Esa es la configuración adecuada para CI, migraciones y herramientas de confianza de origen propio. No es la configuración adecuada para un agente.

### Rate limit

El `rate_limit` de una clave define cuántas solicitudes puede realizar en una ventana de 15 minutos, y cada punto de entrada se descuenta de un único bucket, `api-key:<id>`:

- sus solicitudes HTTP a las API de datos, almacenamiento y funciones;
- sus tramas de datos en el socket en tiempo real: lecturas (fetches), conteos, guardados y eliminaciones, así como suscripciones y solicitudes de historial de canal que superen la [cuota](/docs/backend/realtime/#what-a-write-costs-and-the-limits) de cada socket;
- sus solicitudes a [`/mcp`](/docs/ai/remote-mcp/).

Sin un `rate_limit`, el bucket mantiene el valor predeterminado del servidor para claves de API, 1000. Una clave personal no tiene un `rate_limit` propio y se contabiliza en su propio bucket con ese valor predeterminado. Al superar el límite, una solicitud HTTP responde `429` y una trama de socket `RATE_LIMITED`.

Las rutas de administración bajo `/api/admin`, y los mensajes de administración del socket como los del editor SQL, no tienen límite de tasa.

Un administrador que simule una clave ("Simular acceso", `x-rebase-simulate-api-key-id`) consume su propia cuota, no la de la clave: la integración que se ejecuta con esa clave conserva todo su presupuesto. Simular o suplantar a un usuario se carga al administrador de la misma manera.

## Claves personales

<span class="since-badge" data-since="0.31">Since 0.31</span>

Una clave personal actúa **como su propietario**: su uid y sus roles tal como estén en cada solicitud. Las reglas de tipo propietario coinciden con ella, por lo que lee exactamente lo que leería su propietario, delimitado por sus scopes. Es adecuada para los scripts propios de una persona, una CLI en su portátil o una herramienta que conecte a su propia cuenta.

Están desactivadas de forma predeterminada, ya que cada una es una credencial de larga duración para una cuenta. Actívalas en el bloque `auth` de la [tabla de usuarios](/docs/schema/auth-table/):

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

A continuación, una cuenta con sesión iniciada administra sus propias claves:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

Lo mismo a través de REST. `$ACCESS_TOKEN` es el token de acceso propio de la cuenta, obtenido al iniciar sesión:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Una clave personal admite `name`, `scopes` y `expires_at`. No incluye `roles`, porque se ejecuta con los de su propietario, ni `rate_limit`. Enviar cualquiera de los dos genera un error `400 INVALID_INPUT`.

Lo que posee una clave personal son sus scopes, reducidos a lo que su propietario posee **en ese momento**. Si se retira un rol al propietario, cada clave que haya creado se reduce con él. Si se elimina la cuenta, sus claves dejan de funcionar. Si se desactiva `personalKeys`, todas las claves personales también dejan de funcionar.

Solo una cuenta puede tener claves personales. Una clave de API, la clave de servicio y una sesión de invitado son rechazadas: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` para una clave, `403 PERSONAL_KEY_NEEDS_ACCOUNT` para las otras dos. Con la función desactivada, cada ruta responde con `403 PERSONAL_KEYS_DISABLED`.

## A qué accede cada scope

### Datos

`data:read`, `data:write` y `data:delete`, genéricos o acotados a una sola colección (`data:read:posts`). La operación proviene del método HTTP: `GET`, `HEAD` y `OPTIONS` leen, `POST`, `PUT` y `PATCH` escriben, `DELETE` elimina. `POST /api/data/:slug/bulk/delete` se considera una eliminación, aunque sea un `POST`.

En una ruta anidada, la operación se comprueba contra la colección en la que termina la ruta, y cada colección por la que pasa necesita `data:read`. A una clave que solo posea `data:read:posts` se le denegará el acceso a `/api/data/authors/1/posts` hasta que también pueda leer `authors`.

### Almacenamiento

`storage:read` lista y descarga. `storage:write` sube archivos y crea carpetas, y cubre cada paso de una subida reanudable (TUS), incluyendo la verificación de desplazamiento (offset) y la cancelación. `storage:delete` elimina. El destino es el id de una fuente de almacenamiento. El id de la fuente predeterminada es `(default)`, por lo que `storage:read:(default)` solo lee la fuente predeterminada, y `storage:write:avatars` escribe en una fuente llamada `avatars`. Después de la comprobación del scope, [`storageAuthorize`](/docs/backend/storage-authorization/) se sigue ejecutando con la identidad de la clave.

### Funciones

`functions:invoke` llama a todas las funciones personalizadas. `functions:invoke:<name>` llama a una. Listar las funciones en `GET /api/functions` requiere el scope genérico.

No asignes `functions:invoke` a una clave que pretendas que sea de solo lectura. Una función es código y puede escribir. Dentro de una función, `getScopes(c)` y `hasScope(c, …)` leen lo que posee la clave, y una aplicación puede declarar sus propios scopes para que una función los verifique. Consulta [Funciones personalizadas](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superficies de administración

Un scope del plano de administración en una clave permite acceder a esa superficie. Un programador que active trabajos cron necesita `cron:write`. Un recopilador de registros (log shipper) necesita `logs:read`. Un trabajo de copia de seguridad necesita `backups:read`. El [índice de endpoints](/docs/backend/endpoints/#admin) enumera el scope que necesita cada ruta.

`keys:read` y `keys:write` nunca pueden asignarse a una clave. Una clave que pudiera administrar claves podría emitir su propia sucesora o ampliar sus propios permisos. Cualquier solicitud a las rutas de claves realizada con una clave es rechazada con `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Administra las claves como una persona que posea `keys:write` o mediante la clave de servicio.

### Tiempo real

Una clave también autentica el WebSocket: envíala en el mensaje `AUTHENTICATE`. Las lecturas y suscripciones necesitan `data:read` en su colección, los guardados `data:write` y las eliminaciones `data:delete`. Una suscripción a una ruta anidada necesita el scope genérico. Los canales (broadcast y presencia) están denegados para las claves. Los mensajes del editor SQL y de ramas necesitan `database:read` o `database:write`.

## Agentes y servidores MCP

Un agente requiere la clave más *restringida* posible que le permita cumplir su función. Comienza con scopes delimitados y asígnale una fecha de expiración:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Omite `data:delete` si el agente puede editar pero no debería eliminar. `delete` es independiente de `write` precisamente por esta razón.

## Reglas de emisión

Cada clave se verifica contra quien la crea, de la misma manera en ambas rutas:

| Rechazo | Cuándo |
|---|---|
| `400 INVALID_SCOPES` | Un scope está mal formado, es desconocido o incluye un destino que no admite. `details.validScopes` enumera los scopes que puede contener una clave. Omite `keys:*`, que ninguna clave puede tener |
| `400 UNKNOWN_SCOPE_TARGET` | Un destino nombra una colección, fuente de almacenamiento o función que este backend no proporciona |
| `400 KEY_MANAGEMENT_SCOPE` | Se solicitó `keys:read` o `keys:write` |
| `403 SCOPE_EXCEEDS_CREATOR` | Un scope que el creador no posee. Una clave nunca contiene más de lo que posee la cuenta que la creó |
| `403 ROLE_EXCEEDS_CREATOR` | Un rol de clave de servicio que el creador no posee, cuando el creador no es un administrador |
| `400 INVALID_ROLE` | El nombre de un rol está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control, lo que RLS interpretaría como otros roles |
| `403 KEY_OUTRANKS_CALLER` | En una modificación (`PUT`) o revocación (`DELETE`): la clave ya contiene un rol o scope que el emisor de la llamada no tiene, y el emisor no es un administrador |

Una solicitud para la cual la clave no dispone del scope necesario responde con `403 SCOPE_MISSING`, indicando el scope en `details.requiredScope`. Consulta [Códigos de error](/docs/backend/errors/#authentication-and-accounts).

## Administración de claves

| Método | Ruta | Requiere |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Modifica `name`, `scopes`, `roles`, `rate_limit` o `expires_at`, bajo las mismas reglas que la creación |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoca |
| `GET` | `/api/auth/keys` | Una cuenta: sus propias claves personales |
| `POST` | `/api/auth/keys` | Una cuenta, con `personalKeys` activado |
| `DELETE` | `/api/auth/keys/:id` | Una cuenta: revoca una de las suyas |

Cada ruta devuelve las claves enmascaradas: `key_prefix`, nunca el hash. Cada clave reporta su `kind` (`service` o `personal`), sus `scopes`, sus `roles` y, en el caso de una clave personal, su `owner_uid`.

La CLI abarca las claves de servicio: `rebase api-keys list`, `get`, `create`, `revoke` y `scopes`, que enumera cada scope que el backend reconoce. Consulta la [referencia de la CLI](/docs/cli/#rebase-api-keys). Se autentica con `REBASE_SERVICE_KEY` desde `.env`, y solo lo envía al servidor que `rebase dev` esté ejecutando para este proyecto, por lo que con ese servidor detenido no envía nada. Para un servidor ejecutado de otra forma, como `rebase start` o un contenedor, establece `REBASE_BASE_URL` con su dirección ([el entorno propio de la CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Claves creadas antes de los scopes

Las claves creadas antes de que existieran los scopes contienen una lista de `permissions` y un indicador `admin`. Al iniciar, el almacén asigna a cada una los scopes que le corresponden ahora. Nada se amplía; cuando una concesión antigua no tiene una coincidencia exacta, se restringe:

| Concesión antigua | Scopes actuales |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` y `storage:<op>` para cada operación, más `functions:invoke` si tenía `write` |
| `"storage"` | `storage:<op>` para cada operación |
| `"functions"` | `functions:invoke`, solo si tenía `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, solo si tenía `write` |
| `admin: true` | el rol `admin`, más `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

El secreto no cambia, por lo que las integraciones continúan funcionando. Dos concesiones se restringen:

- Una concesión de función sin `write` pasa a ser nada. Anteriormente, un `GET` contaba como lectura, pero una función es código y ejecutar una no es una lectura.
- Una clave de administrador no obtiene `database:*`, al cual nunca pudo acceder antes, ni `keys:*`, que ninguna clave puede tener.

Las antiguas columnas `permissions` y `admin` se mantienen intactas, por lo que volver a una versión anterior del runtime seguirá leyendo sus claves. Una solicitud que envíe `permissions` o `admin` en lugar de `scopes` se rechaza con `400 INVALID_INPUT`.

## Próximos pasos

- [Roles y scopes](/docs/backend/roles-and-scopes/): cada scope y cómo los contienen los roles
- [Índice de endpoints](/docs/backend/endpoints/): el scope que necesita cada ruta
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/): lo que la base de datos aplica por encima de los scopes de una clave
