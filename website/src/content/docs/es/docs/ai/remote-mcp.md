---
sourceHash: fc4e87a4b7e7a310
title: El endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: "Sirve MCP desde un backend desplegado en /mcp, para que las personas que usan tu aplicación puedan conectar Claude o Cursor como ellos mismos: OAuth con una pantalla de consentimiento, doce herramientas bajo tres scopes, cada llamada bajo su propia seguridad a nivel de fila."
---

:::tip[¿Conectando Claude a tus propios proyectos?]
Para eso está el [conector de Rebase](/docs/ai/rebase-connector/): un conector para
todos ellos, y un servidor autohospedado se une a él con `rebase cloud connect`. Esta
página es para las personas que **usan** tu aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta para desarrolladores: se ejecuta en tu máquina y contiene una clave
de servicio o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan tu aplicación. Un asistente que alguno de ellos conecte lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila.

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda delimitar una consulta
a un usuario, el endpoint rechaza montarse y explica el motivo en el registro de arranque. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con una pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro
  dinámico está activado de forma predeterminada; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que tú registres) y envía a la persona a una pantalla de consentimiento que
  inicia su sesión a través de tu `/auth/login` existente. A una cuenta con un segundo factor
  se le solicita luego su código de autenticador o un código de recuperación, a través de las
  rutas `/auth/mfa/challenge` existentes. Cuando el propio frontend de tu aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta, y
  Permitir otorga el consentimiento en su nombre sin contraseña; así es como se conecta alguien que inicia
  sesión únicamente con Google, GitHub o un enlace por correo electrónico. De lo contrario, inicia sesión con
  una contraseña, y quien no tenga una establece una primero con `/auth/forgot-password`
  ("Olvidé mi contraseña" de tu aplicación); la pantalla se lo indica. También especifica el host al que se envía el código de autorización
  y advierte que dicho host no está verificado: cualquiera puede registrar un cliente con
  cualquier nombre, por lo que el host es la parte que una persona puede comprobar.
- **Doce herramientas, tres scopes.** <span class="since-badge" data-since="0.29">Desde 0.29</span> Los mismos [scopes](/docs/backend/roles-and-scopes/)
  que utiliza cada credencial. `data:read` ofrece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` y las tres vistas,
  `show_collection`, `show_record` y `show_app`; `data:write` añade `create_document` y
  `update_document`; `data:delete` añade `delete_document`. Un cliente que no solicita
  nada obtiene `data:read`. Cada uno se delimita a una colección: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un scope decide qué herramientas se
  ofrecen y a qué colecciones acceden, no qué filas: una lista vacía puede ser
  RLS funcionando, y `data:write` todavía no puede escribir una fila que la persona no pudiera.
- **Tres herramientas ponen tu panel de administración frente a la persona.** En un cliente que
  renderiza MCP Apps, como Claude, estas abren las propias vistas del panel de administración en la
  conversación, generadas a partir de tus colecciones: sus campos, enums, validaciones,
  relaciones, secciones de formularios y configuraciones de vistas.
  - `show_collection` toma los argumentos de `query_collection`, más `view`
    (`table`, `list`, `cards` o `kanban`), y abre la vista de la colección: la
    persona puede buscar, filtrar, ordenar y paginar, abrir el formulario de una fila y añadir filas.
  - `show_record` abre el formulario de una fila (`id`), o un formulario para una nueva fila que
    comienza a partir de los `values` que el modelo rellenó, para que la persona los revise
    y guarde por sí misma.
  - `show_app` ejecuta una aplicación que el modelo escribe para la tarea en cuestión: un
    componente de React (`code`) y las `collections` que lee. Importa los
    propios paquetes de Rebase, por lo que el mismo código funciona en tu proyecto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      y `useRowWrites` sobre las filas del proyecto;
    - `@rebasepro/cms`: `CollectionPanel` del panel de administración (con
      `CollectionToolbar` y sus componentes, y `onRowClick`, que pasa a la
      aplicación la fila seleccionada tal como la lee `useRows`), `EntityFormPanel` y `FormField`,
      `EntityViewPanel`, `FieldValue` y `useSidePanel`, cada uno especificando su
      colección por ruta, con tus campos, vistas y acciones personalizados;
    - `@rebasepro/ui`, todo el kit de UI, incluyendo `SplitView` y las tarjetas de KPI y
      gráficos.

    El servidor lo compila primero, por lo que un error de sintaxis, un módulo que la vista
    no sirve o un nombre que no sirve desde `@rebasepro/cms` o
    `@rebasepro/app` se convierte en el error de la llamada, indicando su línea. Un error mientras se
    ejecuta se muestra en su lugar y se comunica al modelo con el siguiente
    mensaje de la persona. Una aplicación solo puede utilizar las colecciones que lista. Sus estilos son
    las utilidades estándar de Tailwind, compiladas con la vista antes de que llegue cualquier
    aplicación: un valor arbitrario como `h-[560px]` no hace nada allí, por lo que un
    tamaño exacto debe ser un `style`.

  Cada lectura y guardado en la vista es una llamada de las herramientas de lectura y escritura,
  realizada como la persona bajo su RLS, por lo que un formulario ofrece solo aquello para lo que su
  conexión tiene permisos: sin `data:write` es de solo lectura, y un campo
  que sus roles no pueden leer no aparece en él. Ese es también el límite dentro del cual trabaja
  el código de una aplicación: se ejecuta en la vista, por lo que cada llamada que realiza corresponde a una de
  esas herramientas, como la persona, y no puede hacer nada que el modelo no pudiera hacer
  con esas mismas herramientas. En el conector alojado, cada escritura también es planificada
  y confirmada por el servidor. Dentro de eso, `useRowWrites` pregunta a la persona
  antes de escribir, por lo que una aplicación no escribe sin su clic; los
  propios controles del administrador (el Guardar de un formulario, una eliminación, una edición en tabla) se comportan como
  lo hacen en una pantalla de `show_collection`. Al modelo se le informa lo que cambiaron. Lee las filas que responde cada herramienta, no las configuraciones de la colección con las que
  se dibuja la vista. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra nada,
  y el modelo lee las mismas filas que obtendría de `query_collection`.
- **Las autorizaciones otorgadas antes de la versión 0.24 mantienen su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, en las autorizaciones almacenadas y
  en los tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con un encabezado en lugar de un flujo de OAuth. La clave accede
  a las herramientas que cubren sus scopes `data:*`, actuando en nombre de quien corresponda: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura — y leen a través de la ruta `GET /api/data/<collection>`, por lo que una fila se devuelve
  como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, p. ej.
  `authorId`) y se puede reenviar en una actualización sin modificaciones. `query_collection`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_documents`
  `{ count }`. `aggregate_documents` equivale a `GET /api/data/<collection>/aggregate`:
  `select` es una lista en la sintaxis de REST (`["count()", "sum(total)"]`), `groupBy`
  una lista de campos, y responde `{ data }` con una fila por grupo, más
  `meta.hasMore` en una llamada agrupada, cuyos grupos se paginan con `limit` y `offset`
  y se ordenan con `orderBy`. En una colección que una función callback `afterRead` reescribe,
  sirve `count()` únicamente, tal como lo hace REST. Al igual que en REST, se rechaza un `limit` superior a 1000, un argumento no declarado y la
  edición o eliminación de una fila enviada a la papelera (404); establecer el campo de
  borrado suave en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_collection`, `count_documents` y `aggregate_documents` lee la papelera, al igual que lo hace `?deleted=` en REST,
  de modo que una fila enviada a la papelera mediante `delete_document` se puede encontrar nuevamente para
  restaurarla. Su descripción le indica al modelo que la eliminación solo es permanente cuando
  la colección no tiene un campo de borrado suave.
- **El listado nombra las colecciones; `describe_collection` proporciona el esquema de una.**
  `list_collections` responde con el `name`, `title` y `description` de cada colección,
  y `describe_collection { collection }` con los esquemas OpenAPI `row` y
  `create` de esa colección, más `softDeleteField` en caso de que las filas vayan a una papelera. Las descripciones
  de las herramientas indican al modelo que describa una colección antes de escribir en ella. El
  listado de un proyecto de 200 colecciones ocupa unos 5k tokens, y cada descripción
  menos de 1k; si se incluyeran todos los esquemas en el listado, ocuparía unos 150k.
- **Un token solo para este endpoint.** Un token de acceso MCP es rechazado por
  `/api/data`, `/api/admin` y el WebSocket, por lo que conectar un asistente no le
  otorga una sesión.

Cada solicitud a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o deshabilitada,
o un "cerrar sesión en todas partes" o cambio de contraseña posterior a la emisión del token,
detiene a un cliente conectado de inmediato con un 401. Una degradación de permisos se aplica en su
siguiente llamada a una herramienta. Cada actualización (refresh) realiza las mismas comprobaciones y rechaza
dicha autorización de forma definitiva. Una sesión de invitado no puede otorgar consentimiento en absoluto.

Una limitación. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización de inmediato, pero un token de acceso
ya emitido continuará funcionando hasta que expire, en el lapso de una hora.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
