---
sourceHash: 3c5e837860d6c8c6
title: El endpoint remoto de MCP
sidebar_label: Endpoint remoto de MCP
description: Sirve MCP desde un backend desplegado en /mcp, para que las personas que usan tu aplicación conecten Claude o Cursor como ellas mismas — OAuth con pantalla de consentimiento, ocho herramientas bajo tres alcances, y cada llamada bajo su propia seguridad a nivel de fila.
---

El [servidor MCP](/docs/ai/mcp/) es una herramienta de desarrollo: se ejecuta en tu máquina y
guarda una clave de servicio o una clave de API. Un backend desplegado también puede servir
MCP por sí mismo, en `/mcp`, para las personas que usan tu aplicación. Un asistente que una
de ellas conecta lee y escribe el proyecto **como esa persona**, y cada llamada se ejecuta
bajo su propia seguridad a nivel de fila.

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un driver de datos capaz de acotar una consulta
a un solo usuario, el endpoint se niega a montarse y explica por qué en el log de arranque.
Ningún `REBASE_ROLE` lo activa.

- **OAuth, con pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro
  dinámico está activado por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que tú registres) y envía a la persona a una pantalla de consentimiento que
  la autentica mediante tu `/auth/login` existente. A una cuenta con un segundo factor se le
  pide entonces su código del autenticador o un código de recuperación, a través de las
  rutas `/auth/mfa/challenge` existentes. La pantalla inicia sesión solo con contraseña:
  quien solo ha usado Google, GitHub o un enlace por correo establece una primero con
  `/auth/forgot-password` (el "Olvidé mi contraseña" de tu aplicación), y la pantalla se lo
  indica. También nombra el host al que se envía el código de autorización, y avisa de que
  ese host no está verificado: cualquiera puede registrar un cliente con cualquier nombre,
  así que el host es la parte que una persona puede comprobar.
- **Ocho herramientas, tres alcances.** Los mismos [alcances](/docs/backend/roles-and-scopes/)
  que usa toda credencial. `data:read` ofrece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents` y `get_document`; `data:write` añade `create_document` y
  `update_document`; `data:delete` añade `delete_document`. Un cliente que no pide
  nada obtiene `data:read`. Cada uno se acota a una colección: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un alcance decide qué herramientas se
  ofrecen y a qué colecciones llegan, no qué filas: una lista vacía puede ser RLS
  funcionando, y `data:write` sigue sin poder escribir una fila que la persona no podría.
- **Las concesiones hechas antes de 0.24 conservan su alcance.** `mcp:read` se lee como
  `data:read`, y `mcp:write` como `data:write data:delete`, tanto en las concesiones
  almacenadas como en los tokens ya emitidos.
- **Una clave de API también sirve.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con una cabecera en lugar de un flujo OAuth. La clave llega a
  las herramientas que cubren sus alcances `data:*`, actuando como quien corresponda: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString` y `data` para una
  escritura — y leen por la ruta de `GET /api/data/<collection>`, de modo que una fila vuelve
  tal como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, p. ej.
  `authorId`) y puede reenviarse en una actualización sin cambios. `query_collection`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_documents`
  `{ count }`. Como en REST, se rechazan un `limit` superior a 1000, un argumento no declarado y
  la edición o eliminación de una fila que está en la papelera (404); poner el campo de soft-delete
  a `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_collection` y `count_documents` lee la papelera, como hace `?deleted=` en
  REST, de modo que una fila que `delete_document` envió a la papelera puede volver a
  encontrarse para restaurarla. Su descripción le dice al modelo que la eliminación es permanente
  solo donde la colección no tiene un campo de soft-delete.
- **El listado nombra las colecciones; `describe_collection` da el esquema de una.**
  `list_collections` responde el `name`, el `title` y la `description` de cada colección,
  y `describe_collection { collection }` los esquemas OpenAPI `row` y
  `create` de esa colección, más `softDeleteField` donde las filas van a una papelera. Las
  descripciones de las herramientas le dicen al modelo que describa una colección antes de escribir en ella. El
  listado de un proyecto de 200 colecciones ronda los 5k tokens, y cada descripción
  queda por debajo de 1k; con todos los esquemas en el listado eran unos 150k.
- **Un token solo para este endpoint.** Un token de acceso de MCP es rechazado por
  `/api/data`, `/api/admin` y el WebSocket, así que conectar un asistente no le
  entrega una sesión.

Cada petición a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o desactivada,
o un "cerrar sesión en todas partes" o un cambio de contraseña posterior a la emisión del
token, detiene de inmediato a un cliente conectado con un 401. Una degradación de rol se aplica en
su siguiente llamada a una herramienta. Cada renovación hace las mismas comprobaciones y rechaza
una concesión así para siempre. Una sesión de invitado no puede dar su consentimiento en absoluto.

Un límite. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización al instante, pero un token de acceso
ya emitido sigue funcionando hasta que caduca, dentro de la hora.

Las rutas están en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
