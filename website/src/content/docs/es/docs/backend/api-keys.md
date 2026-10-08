---
sourceHash: 7c51c9877d9d0803
title: Claves de API
sidebar_label: Claves de API
description: "Claves de larga duración para scripts, CI, agentes e integraciones: claves de servicio y claves personales, los alcances que tienen, cómo se combinan con la seguridad a nivel de fila y las rutas que las gestionan."
---

## Claves de API

Una clave de API es una credencial bearer de larga duración, `rk_live_…`, para quien
llama sin ser una persona en un navegador: un script, una tarea de CI, un agente, un
cliente MCP, otro servicio. Lo que una clave puede hacer es una lista de
[alcances](/docs/backend/roles-and-scopes/), como `data:read:orders` o `cron:write`.

Hay dos tipos:

- Una **clave de servicio** es la identidad de máquina del propio proyecto. Actúa como
  `api-key:<id>`, no como una persona. Quien tenga `keys:write` las gestiona, en
  `/api/admin/api-keys`.
- Una **clave personal** actúa como la cuenta que la creó. Cada cuenta gestiona las
  suyas, en `/api/auth/keys`, cuando la aplicación las activa.

### Usar una clave

Envíala como token bearer, igual que un token de acceso. `$API_URL` es la dirección
de tu backend: lo que imprimió `rebase dev`, o la URL de tu despliegue.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

La misma clave funciona en la API REST, el almacenamiento, las funciones
personalizadas, las superficies de administración a las que llegan sus alcances, el
WebSocket de tiempo real y el [endpoint `/mcp`](/docs/ai/mcp/#the-remote-endpoint).

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

La respuesta incluye la clave completa en texto plano (`rk_live_...`) **exactamente
una vez**. Guárdala de inmediato.

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Una etiqueta para personas |
| `scopes` | `string[]` | Lo que la clave puede hacer. Al menos uno |
| `roles` | `string[]` | Roles de RLS con los que se ejecuta la clave, además de `service`. Opcional |
| `rate_limit` | `number \| null` | Solicitudes por ventana de 15 minutos. `null` o ausente usa el valor predeterminado del servidor para claves de API, 1000. Consulta [Límite de tasa](#límite-de-tasa) |
| `expires_at` | `string \| null` | Caducidad en ISO-8601. Si falta, no caduca nunca |

### Alcances y RLS: dos barreras independientes

Una solicitud hecha con una clave pasa dos comprobaciones, y ambas deben permitirla:

1. **Los alcances de la clave**, que comprueba la ruta: `data:write:orders` permite
   a la clave escribir en `orders` y en nada más.
2. **La seguridad a nivel de fila**, que comprueba la base de datos. Una clave nunca
   la elude. Una clave de servicio se ejecuta como `uid: "api-key:<id>"` con el rol
   `service`, más los `roles` que se le hayan dado. Las reglas de tipo propietario
   (`owner_id = rebase.uid()`) nunca coinciden con ella.

Así que una clave con `data:read` aún puede obtener resultados vacíos. Eso es RLS
funcionando, no un error. Concede el rol `service` en las reglas de seguridad de la
colección, o dale a la clave el rol `admin`.

#### Una clave de servicio lee cero filas hasta que una regla concede `service`

Este es el paso que hace parecer rota una clave con los alcances correctos. La
política de RLS que Rebase añade por defecto a cada colección se compila en:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

Es decir, el contexto del servidor o un administrador. Una clave de servicio sin el
rol `admin` no coincide con ninguna de las dos ramas. En una colección sin
`securityRules` la solicitud tiene éxito con un resultado vacío y sin ningún error
que explique por qué. Concede el rol explícitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Como `rebase.uid()` contiene el id de la clave, una regla también puede limitar las
filas a una sola clave:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### El rol `admin`

`roles: ["admin"]` (`--roles admin` en la CLI) hace que la clave se ejecute también
con el rol de RLS `admin`, así que supera las políticas de administrador
predeterminadas de cada colección que las conserve. Esas políticas cubren `SELECT`,
`INSERT`, `UPDATE` y `DELETE`, así que la seguridad a nivel de fila no limita las
lecturas, escrituras ni eliminaciones de la clave: puede leer, cambiar y eliminar
todas las filas a las que llegan sus alcances. El rol también supera las
comprobaciones de administrador fuera de la base de datos: `requireAdmin` en las
[funciones personalizadas](/docs/backend/custom-functions/), y las escrituras que el
almacenamiento reserva a los administradores. No concede ningún alcance: la clave
sigue llegando solo a lo que enumeran sus `scopes`.

Quien crea una clave solo puede darle roles que tenga él mismo, salvo que sea
administrador.

### Acceso completo, para CI y migraciones

`--full-access` da a la clave todos los alcances que tiene su creador, menos
`keys:read` y `keys:write`, que ninguna clave puede tener. A través de la CLI, que
usa la clave de servicio, eso son todos los alcances del plano de datos y del plano
de administración. Añade `--roles admin` y la seguridad a nivel de fila deja de
limitar qué filas lee, cambia o elimina:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Esa es la forma adecuada para CI, migraciones y herramientas propias de confianza.
No es la forma adecuada para un agente.

### Límite de tasa

El `rate_limit` de una clave es cuántas solicitudes puede hacer en una ventana
de 15 minutos, y todas las vías cuentan contra él en un mismo contador, `api-key:<id>`:

- sus solicitudes HTTP a las API de datos, almacenamiento y funciones;
- sus tramas de datos en el socket de tiempo real: lecturas, conteos, guardados y
  eliminaciones;
- sus solicitudes a [`/mcp`](/docs/ai/mcp/#the-remote-endpoint).

Sin `rate_limit`, el contador tiene el valor predeterminado del servidor para claves
de API, 1000. Una clave personal no tiene `rate_limit` propio, y cuenta en su propio
contador con ese valor predeterminado. Superado el límite, una solicitud HTTP
responde `429` y una trama del socket `RATE_LIMITED`.

Las rutas de administración bajo `/api/admin`, y los mensajes de administración del
socket, como los del editor SQL, no tienen límite de tasa.

## Claves personales

Una clave personal actúa **como su propietario**: su uid, y sus roles tal como
estén en cada solicitud. Las reglas de tipo propietario coinciden con ella, así que
lee exactamente lo que leería su propietario, restringido por sus alcances. Sirve
para los scripts de una persona, una CLI en su portátil o una herramienta que conecta
a su propia cuenta.

Están desactivadas por defecto, porque cada una es una credencial de larga duración
para una cuenta. Actívalas en el bloque `auth` de la colección de usuarios:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true, personalKeys: true },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Después, una cuenta con la sesión iniciada gestiona sus propias claves:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

Lo mismo por REST. `$ACCESS_TOKEN` es el token de acceso de la propia cuenta,
obtenido al iniciar sesión:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Una clave personal acepta `name`, `scopes` y `expires_at`. No lleva `roles`, porque
se ejecuta con los de su propietario, ni `rate_limit`. Enviar cualquiera de los dos
da `400 INVALID_INPUT`.

Lo que tiene una clave personal son sus alcances, recortados a lo que su propietario
tiene **ahora**. Quita un rol al propietario y cada clave que creó se reduce con él.
Elimina la cuenta y sus claves dejan de funcionar. Desactiva `personalKeys` y todas
las claves personales dejan de funcionar también.

Solo una cuenta puede tener claves personales. Una clave de API, la clave de servicio
y una sesión de invitado se rechazan: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` para una
clave, `403 PERSONAL_KEY_NEEDS_ACCOUNT` para las otras dos. Con la función
desactivada, todas las rutas responden `403 PERSONAL_KEYS_DISABLED`.

## A qué llega cada alcance

### Datos

`data:read`, `data:write` y `data:delete`, sin destino o restringidos a una colección
(`data:read:posts`). La operación sale del método HTTP: `GET`, `HEAD` y `OPTIONS`
leen, `POST`, `PUT` y `PATCH` escriben, `DELETE` elimina.
`POST /api/data/:slug/bulk/delete` cuenta como eliminación, aunque sea un `POST`.

En una ruta anidada, la operación se comprueba contra la colección en la que termina
la ruta, y cada colección por la que pasa necesita `data:read`. Una clave que solo
tiene `data:read:posts` recibe un rechazo en `/api/data/authors/1/posts` hasta que
también pueda leer `authors`.

### Almacenamiento

`storage:read` lista y descarga. `storage:write` sube archivos y crea carpetas, y
cubre cada paso de una subida reanudable (TUS), incluidas la comprobación del
desplazamiento y la cancelación. `storage:delete` elimina. El destino es el id de un
origen de almacenamiento. El id del origen predeterminado es `(default)`, así que
`storage:read:(default)` lee solo el origen predeterminado, y `storage:write:avatars`
escribe en un origen llamado `avatars`. Tras la comprobación del alcance,
[`storageAuthorize`](/docs/backend/storage/#per-object-authorization) sigue
ejecutándose, con la identidad de la clave.

### Funciones

`functions:invoke` llama a todas las funciones personalizadas.
`functions:invoke:<name>` llama a una. Listar las funciones en `GET /api/functions`
necesita el alcance sin destino.

No des `functions:invoke` a una clave que quieras de solo lectura. Una función es
código, y puede escribir. Dentro de una función, `getScopes(c)` y `hasScope(c, …)`
leen lo que tiene la clave, y una aplicación puede declarar sus propios alcances para
que una función los compruebe. Consulta
[Funciones personalizadas](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superficies de administración

Un alcance del plano de administración en una clave llega a esa superficie. Un
planificador que dispara tareas cron necesita `cron:write`. Un servicio que envía
registros a otro sitio necesita `logs:read`. Una tarea de copias de seguridad
necesita `backups:read`. El [índice de endpoints](/docs/backend/endpoints/#admin)
indica el alcance que necesita cada ruta.

`keys:read` y `keys:write` nunca pueden ir en una clave. Una clave capaz de gestionar
claves podría crear su propia sucesora, o ampliarse a sí misma. Cualquier solicitud a
las rutas de claves hecha con una clave se rechaza con
`403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gestiona las claves como una persona con
`keys:write`, o con la clave de servicio.

### Tiempo real

Una clave también autentica el WebSocket: envíala en el mensaje `AUTHENTICATE`. Las
lecturas y las suscripciones necesitan `data:read` en su colección, los guardados
`data:write` y las eliminaciones `data:delete`. Una suscripción a una ruta anidada
necesita el alcance sin destino. Los canales (difusión y presencia) se rechazan para
las claves. El editor SQL y los mensajes de ramas necesitan `database:read` o
`database:write`.

## Agentes y servidores MCP

Un agente necesita la clave *más restringida* que haga su trabajo. Empieza con un
alcance limitado y ponle una caducidad:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Deja fuera `data:delete` cuando el agente pueda editar pero no deba eliminar.
`delete` está separado de `write` precisamente por esto.

## Reglas de creación

Cada clave se comprueba contra quien la crea, igual en ambas rutas:

| Rechazo | Cuándo |
|---|---|
| `400 INVALID_SCOPES` | Un alcance está mal formado, es desconocido o lleva un destino que no admite. `details.validScopes` enumera todos los válidos |
| `400 UNKNOWN_SCOPE_TARGET` | Un destino nombra una colección, un origen de almacenamiento o una función que este backend no sirve |
| `400 KEY_MANAGEMENT_SCOPE` | Se pidió `keys:read` o `keys:write` |
| `403 SCOPE_EXCEEDS_CREATOR` | Un alcance que el creador no tiene. Una clave nunca tiene más que la cuenta que la creó |
| `403 ROLE_EXCEEDS_CREATOR` | Un rol de clave de servicio que el creador no tiene, cuando el creador no es administrador |

Una solicitud para la que la propia clave no tiene alcance responde
`403 SCOPE_MISSING`, con el alcance en `details.requiredScope`. Consulta
[Códigos de error](/docs/backend/errors/#authentication-and-accounts).

## Gestionar claves

| Método | Ruta | Necesita |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Cambia `name`, `scopes`, `roles`, `rate_limit` o `expires_at`, con las mismas reglas que al crear |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoca |
| `GET` | `/api/auth/keys` | Una cuenta: sus propias claves personales |
| `POST` | `/api/auth/keys` | Una cuenta, con `personalKeys` activado |
| `DELETE` | `/api/auth/keys/:id` | Una cuenta: revoca una de las suyas |

Todas las rutas devuelven las claves enmascaradas: `key_prefix`, nunca el hash. Cada
clave indica su `kind` (`service` o `personal`), sus `scopes`, sus `roles` y, si es
una clave personal, su `owner_uid`.

La CLI cubre las claves de servicio: `rebase api-keys list`, `get`, `create`,
`revoke` y `scopes`, que lista todos los alcances que conoce el backend. Consulta la
[referencia de la CLI](/docs/cli/#rebase-api-keys).

## Claves creadas antes de los alcances

Las claves creadas antes de que existieran los alcances llevan una lista
`permissions` y un indicador `admin`. Al arrancar, el almacén da a cada una los
alcances que tiene ahora. Nada se amplía; donde una concesión antigua no tiene un
equivalente exacto, se restringe:

| Concesión antigua | Alcances ahora |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` y `storage:<op>` por cada operación, más `functions:invoke` si tenía `write` |
| `"storage"` | `storage:<op>` por cada operación |
| `"functions"` | `functions:invoke`, solo si tenía `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, solo si tenía `write` |
| `admin: true` | el rol `admin`, más `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

El secreto no cambia, así que una integración sigue funcionando. Dos concesiones se
restringen:

- Una concesión de función sin `write` se convierte en nada. Un `GET` contaba antes
  como lectura, pero una función es código, y llamar a una no es una lectura.
- Una clave de administrador no recibe ningún `database:*`, al que nunca pudo llegar
  antes, ni ningún `keys:*`, que ninguna clave puede tener.

Las columnas antiguas `permissions` y `admin` se mantienen, para que una vuelta atrás
a un runtime anterior siga leyendo sus claves. Una solicitud que envía `permissions`
o `admin` en lugar de `scopes` se rechaza con `400 INVALID_INPUT`.

## Siguientes pasos

- [Roles y alcances](/docs/backend/roles-and-scopes/): todos los alcances, y cómo los tienen los roles
- [Índice de endpoints](/docs/backend/endpoints/): el alcance que necesita cada ruta
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/): lo que la base de datos aplica por encima de los alcances de una clave
