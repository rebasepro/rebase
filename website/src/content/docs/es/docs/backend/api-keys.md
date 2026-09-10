---
sourceHash: 87d15c9eb4314422
title: Claves de API
sidebar_label: Claves de API
description:"\"Claves con alcance limitado y revocables para clientes máquina: a qué puede acceder una clave, cómo se combinan los alcances con la seguridad a nivel de fila y los endpoints de administración que las gestionan.\""
---

## Claves de API

Las claves de API proporcionan autenticación máquina a máquina para agentes, servidores MCP, pipelines de CI e integraciones externas. Admiten la delimitación de permisos por colección y acceso de administrador completo opcional.

### Crear una clave de API

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

La respuesta incluye la clave completa en texto plano (`rk_live_...`) **exactamente una vez**; guárdela inmediatamente.

### Uso de una clave de API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permisos y RLS: dos barreras independientes

La solicitud de una clave de API pasa por **dos** comprobaciones de autorización, y ambas deben permitirla:

1. **La lista de permisos de la clave** — colección × operación, comprobada en la capa de rutas.
2. **Seguridad a nivel de fila (Row-Level Security o RLS)** — Las claves de API *no* eluden RLS. Una clave se ejecuta como
   `uid: "api-key:<id>"` con el rol `service` (más `admin` cuando
   `admin: true`). Las claves de administrador pasan a través de las políticas de administrador integradas; una
   clave que no sea de administrador solo ve las filas que una regla de seguridad conceda explícitamente al
   rol `service` o al público. Las reglas de tipo propietario
   (`owner_id = rebase.uid()`) nunca coinciden con una clave de API.

Por lo tanto, una clave sin privilegios de administrador con permisos `"*"` aún puede obtener resultados vacíos: eso es
RLS funcionando, no un error. Otorgue el rol `service` en las reglas de seguridad
de las colecciones pertinentes o utilice una clave de administrador.

### Funciones personalizadas

Las invocaciones de funciones tienen un alcance similar al de las colecciones, bajo el espacio
de nombres `functions`: `{"collection": "functions", "operations": ["write"]}` otorga acceso a todas
las funciones, `"functions/<name>"` otorga acceso a una y el comodín global `"*"` las otorga
todas. Una clave sin dicha entrada no puede invocar funciones en absoluto.

### Almacenamiento

El almacenamiento funciona de la misma manera, bajo el espacio de nombres `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` permite a la clave
descargar/listar (`read`), subir y crear carpetas (`write`) y eliminar archivos
(`delete`). El comodín global `"*"` también otorga acceso al almacenamiento. Una clave sin dicha
entrada no puede interactuar con el almacenamiento. Las rutas de carga reanudable TUS cuentan como `write`
en cada paso (incluyendo la comprobación de desplazamiento y la cancelación), por lo que una clave con permisos de escritura
puede completar una subida por sí misma.

### Agentes y servidores MCP

Un agente necesita la clave con el alcance más *restringido* posible para hacer su trabajo, no una de administrador. Empiece
con un alcance limitado y asígnele una fecha de caducidad:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Las operaciones son `read`, `write` y `delete`, derivadas del método HTTP:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Una clave con alcance específico lee cero filas hasta que una regla otorga `service`

Este es el paso que hace parecer que una clave correctamente delimitada no funciona. Una clave
que no es de administrador se ejecuta como `uid: "api-key:<id>"` con los roles `["service"]`, y la política de RLS
inyectada en cada colección por defecto se compila en:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— el contexto del servidor o un administrador. Una clave que no es de administrador no coincide con ninguna de las dos ramas, por lo que en una
colección sin `securityRules` la solicitud tiene éxito devolviendo un conjunto de resultados vacío
y sin ningún error que explique el motivo. Otorgue el rol explícitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Debido a que `rebase.uid()` contiene el id de la clave, una regla también puede limitar las filas a una
clave específica:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### No use `"*"` para una clave de solo lectura

El comodín `"*"` no significa solo "todas las colecciones": también coincide con el espacio de nombres `functions`
y con `storage`. Un `GET` cuenta como `read`, y el manejador de una función personalizada
es código arbitrario que puede escribir, por lo que una clave de "solo lectura" con comodín puede
realizar mutaciones a través de una función. Nombrar las colecciones explícitamente evita que la clave
tenga acceso alguno a las funciones.

#### `--admin --full-access`: CI, migraciones y herramientas propias

`"admin": true` otorga a la clave el rol de administrador: rutas `/api/admin/*` para
administración de esquemas, gestión de usuarios y más, además de cron, copias de seguridad y registros.
Combinado con `--full-access` (`{"collection": "*", "operations": ["read", "write",
"delete"]}`), la clave tiene acceso a todas las colecciones, a todo el almacenamiento y a cada función personalizada.
Esa es la configuración adecuada para CI, migraciones y herramientas propias de
confianza, no para agentes.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### No hay tiempo real a través de claves de API

El WebSocket de tiempo real no procesa tokens `rk_`; solo acepta JWT de usuario y
la clave de servicio (service key). Un agente autenticado con una clave de API sondea los
endpoints REST en lugar de suscribirse.

### Opciones de clave

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Etiqueta legible por humanos |
| `permissions` | `ApiKeyPermission[]` | Acceso por colección (`"*"` = todo; `"functions/<name>"` = una función; `"storage"` = almacenamiento de archivos) |
| `admin` | `boolean` | Otorga el rol de administrador: rutas de administración + políticas de administración de RLS |
| `rate_limit` | `number \| null` | Solicitudes por ventana de 15 min (`null` = el valor predeterminado del servidor, 1000) |
| `expires_at` | `string \| null` | Marca de tiempo de expiración en ISO-8601 |

La CLI requiere un alcance explícito: pase `--permissions '<json>'` u opte por
`--full-access`; no existe un valor predeterminado silencioso de acceso total.

Las claves se pueden listar, actualizar y revocar a través de `/api/admin/api-keys` o los
comandos de la CLI `rebase api-keys`, pero no mediante una clave de API. Cualquier solicitud a
`/api/admin/api-keys` autenticada con una clave `rk_` se rechaza con `403
API_KEY_SELF_MANAGEMENT_FORBIDDEN`, independientemente de su indicador `admin`. La gestión de claves
requiere una sesión de usuario administrador o la clave de servicio.

## Siguientes pasos

- [API REST](/docs/backend/api/) — los endpoints a los que llama una clave
- [Índice de endpoints](/docs/backend/endpoints/) — la barrera en cada ruta, incluidas las claves
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/) — lo que la base de datos aplica por encima de los alcances de una clave

---
