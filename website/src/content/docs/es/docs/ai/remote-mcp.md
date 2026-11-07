---
sourceHash: b813cdc1b302b6c6
title: El endpoint remoto de MCP
sidebar_label: Endpoint remoto de MCP
description: "Sirva MCP desde un backend desplegado en /mcp, de modo que las personas que usan su aplicación puedan conectar Claude o Cursor como ellas mismas: OAuth con pantalla de consentimiento, nueve herramientas bajo tres ámbitos, cada llamada bajo su propia seguridad a nivel de fila."
---

:::tip[¿Conectar Claude a sus propios proyectos?]
Ese es el [conector de Rebase](/docs/ai/rebase-connector/): un conector para
todos ellos, y un servidor autohospedado se une a él con `rebase cloud connect`. Esta
página es para las personas que **usan** su aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta para desarrolladores: se ejecuta en su máquina y contiene una clave
de servicio o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan su aplicación. Un asistente conectado por alguno de ellos lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila (RLS).

Está desactivado a menos que lo active, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda limitar una consulta
a un solo usuario, el endpoint se niega a montarse e indica el motivo en el registro de inicio. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con una pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro
  dinámico está activado por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que usted registre) y envía a la persona a una pantalla de consentimiento que
  inicia su sesión a través de su `/auth/login` existente. A continuación, a una cuenta con un segundo factor
  de autenticación se le solicita su código de autenticador o un código de recuperación, a través de
  las rutas existentes `/auth/mfa/challenge`. Cuando el propio frontend de su aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta, y
  Permitir otorga el consentimiento en su nombre sin contraseña; así es como se conecta alguien que inicia sesión solo
  con Google, GitHub o un enlace de correo electrónico. De lo contrario, inicia sesión con una
  contraseña, y quien no tenga una, primero establece una con `/auth/forgot-password`
  (el «Olvidé mi contraseña» de su aplicación); la pantalla así se lo indica. También nombra el host al que se envía el código de autorización
  y especifica que dicho host no está verificado: cualquiera puede registrar un cliente bajo
  cualquier nombre, por lo que el host es la parte que una persona puede verificar.
- **Once herramientas, tres ámbitos (scopes).** Los mismos [ámbitos](/docs/backend/roles-and-scopes/)
  que utiliza cada credencial. `data:read` ofrece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` y las tres vistas,
  `show_collection`, `show_record` y `show_app`; `data:write` añade `create_document` y
  `update_document`; `data:delete` añade `delete_document`. Un cliente que no solicita
  nada obtiene `data:read`. Cada uno se restringe a una colección: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un ámbito decide qué herramientas se
  ofrecen y a qué colecciones llegan, no qué filas: una lista vacía puede ser
  RLS funcionando, y `data:write` todavía no puede escribir una fila que la persona no podría.
- **Tres herramientas ponen su panel de administración frente a la persona.** En un cliente que
  renderiza MCP Apps, como Claude, abren las propias vistas del panel de administración en la
  conversación, extraídas de sus colecciones: sus campos, enums, validación,
  relaciones, secciones de formulario y configuraciones de vista.
  - `show_collection` toma los argumentos de `query_collection`, más `view`
    (`table`, `list`, `cards` o `kanban`), y abre la vista de la colección: la
    persona puede buscar, filtrar, ordenar y paginar, abrir el formulario de una fila y añadir filas.
  - `show_record` abre el formulario de una fila (`id`), o un formulario para una nueva fila que
    comienza a partir de los valores (`values`) que el modelo completó, para que la persona los revise
    y guarde ella misma.
  - `show_app` ejecuta una aplicación que el modelo escribe para la tarea en cuestión: un
    componente React (`code`) y las colecciones (`collections`) que lee. Importa el kit de interfaz
    (`@rebasepro/ui`), las tarjetas KPI y gráficos de `@rebasepro/plugin-insights`,
    y `@rebasepro/mcp-apps`: `useQuery`, `useRecord`, `useCount` y
    `useMutate` sobre las filas del proyecto, y `CollectionView` y
    `RecordForm` del panel de administración para componer. El servidor lo compila
    primero, por lo que un error de sintaxis o una importación que la vista no tiene es el
    error de la llamada, con su línea; un error mientras se ejecuta se muestra en su lugar
    y se comunica al modelo con el siguiente mensaje de la persona.

  Cada lectura y guardado en la vista es una de las llamadas de las herramientas de lectura y escritura,
  realizada como la persona bajo su RLS, por lo que un formulario ofrece solo lo que
  se le concedió a su conexión: sin `data:write` es de solo lectura, y un campo
  que sus roles no pueden leer no está en él. Cualquier cambio que realice el código de una aplicación se muestra
  a la persona para que lo confirme antes de enviarse. Se le informa al modelo lo que
  cambiaron. Lee las filas que responde cada herramienta, no las configuraciones de colección con las que
  dibuja la vista. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra nada,
  y el modelo lee las mismas filas que leería desde `query_collection`.
- **Las autorizaciones otorgadas antes de la versión 0.24 mantienen su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, en las autorizaciones almacenadas y
  en los tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con un encabezado en lugar de un flujo OAuth. La clave accede
  a las herramientas que cubren sus ámbitos `data:*`, actuando en nombre de quien corresponda: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura — y leen a través de la ruta `GET /api/data/<collection>`, por lo que una fila se
  devuelve como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, p. ej.
  `authorId`) y se puede enviar de vuelta en una actualización sin cambios. `query_collection`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_documents`
  `{ count }`. Al igual que en REST, se rechaza un `limit` superior a 1000, un argumento no declarado y una
  edición o eliminación de una fila en la papelera (404); establecer el campo de borrado suave
  en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_collection` y `count_documents` lee la papelera, al igual que hace `?deleted=`
  en REST, por lo que una fila que `delete_document` envió a la papelera se puede volver a encontrar para
  restaurarla. Su descripción le indica al modelo que la eliminación es permanente solo cuando
  la colección no tiene un campo de borrado suave.
- **El listado nombra las colecciones; `describe_collection` proporciona el esquema de una.**
  `list_collections` responde con el `name`, `title` y `description` de cada colección,
  y `describe_collection { collection }` con los esquemas OpenAPI `row` y
  `create` de esa colección, además de `softDeleteField` donde las filas van a la papelera. Las
  descripciones de las herramientas le indican al modelo que describa una colección antes de escribir en ella. El
  listado de un proyecto de 200 colecciones ocupa unos 5k tokens, y cada descripción
  menos de 1k; con cada esquema incluido en el listado rondaba los 150k.
- **Un token solo para este endpoint.** `/api/data`, `/api/admin` y el
  WebSocket rechazan un token de acceso MCP, por lo que conectar un asistente no
  le otorga una sesión.

Cada solicitud a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o
deshabilitada, o un «cerrar sesión en todas partes» o cambio de contraseña posterior a la emisión
del token, detiene de inmediato a un cliente conectado con un 401. Una degradación de permisos se aplica en su
siguiente llamada a una herramienta. Cada actualización realiza las mismas comprobaciones y rechaza dicha concesión
de forma definitiva. Una sesión de invitado no puede dar su consentimiento en absoluto.

Una limitación. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización de inmediato, pero un token de acceso
ya emitido sigue funcionando hasta que expire, dentro del plazo de una hora.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
