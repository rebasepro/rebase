---
sourceHash: 929d8e7ae10aab87
title: El endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: "Sirve MCP desde un backend desplegado en /mcp, para que las personas que usan tu aplicación puedan conectar Claude o Cursor como ellas mismas: OAuth con una pantalla de consentimiento, nueve herramientas bajo tres alcances y cada llamada bajo su propia seguridad a nivel de fila."
---

:::tip[¿Conectando Claude a tus propios proyectos?]
Ese es el [conector de Rebase](/docs/ai/rebase-connector/): un conector para
todos ellos, y un servidor autoalojado se une a él con `rebase cloud connect`. Esta
página es para las personas que **usan** tu aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta de desarrollo: se ejecuta en tu máquina y contiene una
clave de servicio o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan tu aplicación. Un asistente conectado por una de ellas lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila.

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda restringir una consulta
a un usuario, el endpoint se niega a montarse e indica el motivo en el registro de arranque. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con una pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro dinámico
  está activado por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita a
  los clientes que registres) y envía a la persona a una pantalla de consentimiento que inicia su sesión
  a través de tu `/auth/login` existente. A una cuenta con un segundo factor
  se le solicita entonces su código de autenticador o un código de recuperación, a través de las
  rutas existentes `/auth/mfa/challenge`. Cuando el propio frontend de tu aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta, y
  Permitir otorga el consentimiento como tal sin contraseña; así es como se conecta alguien que solo
  inicia sesión con Google, GitHub o un enlace por correo electrónico. De lo contrario, inicia sesión con una
  contraseña, y quien no tenga una, establece una primero con `/auth/forgot-password`
  ("¿Olvidó su contraseña?" de tu aplicación); la pantalla se lo indica. También nombra el host al que se envía el código de autorización,
  y advierte que dicho host no está verificado: cualquiera puede registrar un cliente bajo
  cualquier nombre, por lo que el host es la parte que una persona puede verificar.
- **Nueve herramientas, tres alcances.** Los mismos [alcances (scopes)](/docs/backend/roles-and-scopes/)
  que utiliza cada credencial. `data:read` ofrece `list_collections`, `describe_collection`,
  `query_collection`, `show_collection`, `count_documents` y `get_document`; `data:write` añade `create_document` y
  `update_document`; `data:delete` añade `delete_document`. Un cliente que no solicita
  nada obtiene `data:read`. Cada uno se delimita a una colección: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un alcance decide qué herramientas se
  ofrecen y a qué colecciones acceden, no a qué filas: una lista vacía puede ser
  consecuencia del funcionamiento de RLS, y `data:write` aún no puede escribir una fila que la persona no podría.
- **`show_collection` pone las filas frente a la persona.** Acepta los
  argumentos de `query_collection` y responde la misma página, más las columnas que
  muestra el panel de administración. Un cliente que renderiza MCP Apps, como Claude, lo abre como una
  tabla en la conversación: la persona puede cargar más filas y, cuando
  la conexión dispone de `data:write`, editar una celda directamente en el lugar. Cada guardado es una
  llamada a `update_document` realizada en su nombre, bajo su RLS, y se le informa al modelo lo que
  cambió. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra ninguna
  tabla, y el modelo lee la página tal como lo haría desde `query_collection`.
- **Las concesiones otorgadas antes de la versión 0.24 mantienen su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, tanto en concesiones almacenadas como
  en tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con un encabezado en lugar de un flujo OAuth. La clave accede a
  las herramientas que cubren sus alcances `data:*`, actuando como quien corresponda: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura — y leen a través de la ruta de `GET /api/data/<collection>`, por lo que una fila se devuelve
  como la entrega REST (fechas ISO, un `belongsTo` como su clave foránea, p. ej.
  `authorId`) y se puede enviar de vuelta en una actualización sin cambios. `query_collection`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_documents`
  `{ count }`. Al igual que en REST, se rechaza un `limit` superior a 1000, un argumento no declarado y una
  edición o eliminación de una fila en la papelera (404); establecer el campo de borrado suave
  en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_collection` y `count_documents` lee la papelera, al igual que hace
  `?deleted=` de REST, de modo que una fila enviada a la papelera por `delete_document` se puede encontrar nuevamente para
  restaurarla. Su descripción le indica al modelo que la eliminación es permanente solo cuando
  la colección no tiene un campo de borrado suave.
- **El listado nombra las colecciones; `describe_collection` proporciona el esquema de una.**
  `list_collections` responde el `name`, `title` y `description` de cada colección,
  y `describe_collection { collection }` los esquemas OpenAPI `row` y
  `create` de esa colección, más `softDeleteField` donde las filas van a una papelera. Las descripciones
  de las herramientas le indican al modelo que describa una colección antes de escribir en ella. El
  listado de un proyecto de 200 colecciones ocupa alrededor de 5k tokens, y cada descripción
  menos de 1k; con cada esquema incluido en el listado rondaba los 150k.
- **Un token solo para este endpoint.** Un token de acceso de MCP es rechazado por
  `/api/data`, `/api/admin` y el WebSocket, por lo que conectar un asistente no le
  entrega una sesión.

Cada solicitud a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o deshabilitada,
o un "cerrar sesión en todas partes" o cambio de contraseña después de que se emitió el token,
detiene inmediatamente a un cliente conectado con un 401. Una degradación de permisos se aplica a su
siguiente llamada a una herramienta. Cada actualización (refresh) realiza las mismas comprobaciones y rechaza dicha concesión
definitivamente. Una sesión de invitado no puede otorgar consentimiento en absoluto.

Una limitación. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización de inmediato, pero un token de acceso
ya emitido sigue funcionando hasta que caduca, dentro del plazo de una hora.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
