---
sourceHash: 31c288c62ca55c7e
title: El endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: "Sirve MCP desde un backend desplegado en /mcp, para que las personas que usan tu aplicación puedan conectar Claude o Cursor como ellas mismas: OAuth con pantalla de consentimiento, diecisiete herramientas bajo tres scopes, cada llamada bajo su propia seguridad a nivel de fila."
---

:::tip[¿Conectando Claude a tus propios proyectos?]
Ese es el [conector de Rebase](/docs/ai/rebase-connector/): un conector para
todos ellos, y un servidor autohospedado se une con `rebase cloud connect`. Esta
página es para las personas que **usan** tu aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta para desarrolladores: se ejecuta en tu máquina y contiene una
clave de servicio o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan tu aplicación. Un asistente que alguno de ellos conecte lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila (row-level security).

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda restringir una consulta
a un solo usuario, el endpoint se niega a montarse e indica el motivo en el registro de inicio. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro dinámico
  está habilitado por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que tú registres) y envía a la persona a una pantalla de consentimiento que inicia su
  sesión mediante tu `/auth/login` existente. A una cuenta con un segundo factor
  se le solicita entonces su código de autenticador o un código de recuperación, a través de las
  rutas `/auth/mfa/challenge` existentes. Cuando el propio frontend de tu aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta, y
  Permitir otorga el consentimiento como ese usuario sin contraseña; así es como se conecta alguien que inicia
  sesión únicamente con Google, GitHub o un enlace por correo electrónico. De lo contrario, inicia sesión con una
  contraseña, y alguien que no tenga una puede configurarla primero mediante `/auth/forgot-password`
  (el "¿Olvidaste tu contraseña?" de tu aplicación); la pantalla se lo indica. También especifica el host al que se envía el código de autorización,
  y advierte que dicho host no está verificado: cualquiera puede registrar un cliente bajo
  cualquier nombre, por lo que el host es la parte que una persona puede verificar.
- **Diecisiete herramientas, tres scopes.** Los mismos [scopes](/docs/backend/roles-and-scopes/)
  que utiliza cualquier credencial. `data:read` ofrece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document`, las tres vistas,
  `show_collection`, `show_record` y `show_app`, `show_app_guide`, y las experimentales
  `list_apps` y `open_app`; `data:write` añade `create_document`, `update_document` y las
  experimentales `save_app` y `delete_app`; `data:delete` añade `delete_document`. Un cliente que no solicita
  nada obtiene `data:read`. Cada uno puede restringirse a una colección: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un scope decide qué herramientas se
  ofrecen y a qué colecciones acceden, no a qué filas: una lista vacía puede ser
  RLS funcionando correctamente, y `data:write` sigue sin poder escribir una fila a la que la persona no tendría acceso.
- **Tres herramientas ponen tu panel de administración frente a la persona.** En un cliente que
  renderiza MCP Apps, como Claude, estas abren las vistas del propio panel de administración en la
  conversación, generadas a partir de tus colecciones: sus campos, enums, validación,
  relaciones, secciones de formularios y ajustes de vista.
  - `show_collection` acepta los argumentos de `query_collection`, más `view`
    (`table`, `list`, `cards` o `kanban`), y abre la vista de la colección: la
    persona puede buscar, filtrar, ordenar y paginar, abrir el formulario de una fila y añadir filas.
  - `show_record` abre el formulario de una fila (`id`), o un formulario para una nueva fila que
    comienza a partir de los `values` que el modelo completó, para que la persona los revise y
    los guarde por sí misma.
  - `show_app` ejecuta una aplicación que el modelo escribe para la tarea en cuestión: un
    componente de React (`code`) y las `collections` que lee. Importa los propios
    paquetes de Rebase, por lo que el mismo código funciona en tu proyecto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      y `useRowWrites` sobre las filas del proyecto;
    - `@rebasepro/cms`: el `CollectionPanel` del panel de administración (con
      `CollectionToolbar` y sus piezas, y `onRowClick`, que pasa a la
      aplicación la fila seleccionada tal como la lee `useRows`), `RecordForm` y `FormField`,
      `RecordDetail`, `FieldValue` y `useSidePanel`, cada uno especificando su
      colección por ruta, con tus campos personalizados, vistas y acciones;
    - `@rebasepro/ui`, todo el kit de interfaz de usuario, con `SplitView` y las tarjetas (tiles) y
      gráficos de KPI incluidos.

    El servidor lo compila primero, por lo que un error de sintaxis, un módulo que la vista
    no sirve o un nombre que no exporta desde `@rebasepro/cms` o
    `@rebasepro/app` se devuelve como el error de la llamada, indicando su línea. Un error mientras
    se ejecuta se muestra en su lugar correspondiente y se le comunica al modelo con el siguiente
    mensaje de la persona. Una aplicación solo puede utilizar las colecciones que declare en su lista. Sus estilos son
    las utilidades estándar de Tailwind, compiladas con la vista antes de que llegue cualquier
    aplicación: un valor arbitrario como `h-[560px]` no tiene efecto allí, por lo que
    un tamaño exacto debe definirse como un `style`.

    La descripción de `show_app` contiene solo lo esencial, porque un cliente
    puede recortar una descripción de herramienta demasiado larga (claude.ai lo
    hace a unos 4.000 caracteres). Indica al modelo que llame primero a
    `show_app_guide`, que devuelve todos los hooks, componentes y props que
    una aplicación puede usar, con un ejemplo completo. `show_app_guide` se
    ofrece dondequiera que se ofrezca `show_app`.

  Cada lectura y guardado en la vista es una llamada a las herramientas de lectura y escritura,
  realizada como la persona bajo su RLS, de modo que un formulario ofrece únicamente aquello para lo que
  su conexión recibió permisos: sin `data:write` es de solo lectura, y un campo que
  sus roles no pueden leer no aparece en él. Ese es también el límite dentro del cual trabaja
  el código de una aplicación: se ejecuta en la vista, por lo que cada llamada que realiza corresponde a una
  de esas herramientas, actuando como la persona, y no puede hacer nada que el modelo no pudiera hacer
  con esas mismas herramientas. En el conector alojado, cada escritura también es planificada
  y confirmada por el servidor. Dentro de ese marco, `useRowWrites` le pide confirmación a la persona
  antes de escribir, para que una aplicación no escriba sin su clic; los controles propios
  del administrador (el botón Guardar de un formulario, una eliminación, una edición en tabla) se comportan como lo
  hacen en una pantalla de `show_collection`. Al modelo se le informa sobre los cambios realizados. Lee las filas que responde cada herramienta, no las configuraciones de colección con las que
  dibuja la vista. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra nada,
  y el modelo lee las mismas filas que obtendría mediante `query_collection`.
- **Experimental: aplicaciones guardadas en el proyecto.** <span class="since-badge" data-since="0.30">Since 0.30</span> `save_app` conserva una aplicación
  que el modelo construyó con `show_app` para que vuelva a abrirse: compila el código como lo hace
  `show_app` y lo guarda con su `title`, sus `collections` y su `visibility`, que es `personal` (su
  propietario, el valor por defecto), `roles` (quien tenga uno de sus `roles`) o `team` (todos los
  que inician sesión). Guardar para alguien más que uno mismo requiere el rol de administrador,
  porque una aplicación compartida es código que escribió una IA y que se ejecuta para otras
  personas. Solo su propietario o un administrador la reemplaza (`id`) o la elimina, y una persona
  conserva como máximo 200. `list_apps` lista las aplicaciones que quien llama puede abrir,
  `open_app` abre una como lo haría `show_app`, y `delete_app` elimina una. Ver una aplicación no es
  llegar a sus datos: una aplicación abierta lee y escribe mediante las herramientas anteriores, como
  quien la abre, bajo su RLS. Las aplicaciones se guardan en `rebase.saved_apps`, que el backend crea
  la primera vez que una herramienta la usa y que no concede a ningún usuario final.
  El panel de administración abre las mismas aplicaciones: añade `savedAppsView` de `@rebasepro/cms`
  a tus `views`. Ejecuta una aplicación en un iframe aislado sin `allow-same-origin` y sin red
  propia, y reenvía sus llamadas a herramientas a `POST /api/admin/apps/mcp`, las mismas
  herramientas para la sesión del panel de administración, que se monta con las rutas de
  administración esté o no definido `REBASE_MCP_ENABLED`. Los nombres y las formas de las
  herramientas aún pueden cambiar.
- **Las concesiones otorgadas antes de la versión 0.24 mantienen su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, tanto en las concesiones almacenadas como
  en los tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con un encabezado en lugar de un flujo de OAuth. La clave accede
  a las herramientas que cubren sus scopes `data:*`, actuando según a quién represente: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura — y leen a través de la ruta de `GET /api/data/<collection>`, por lo que una fila se devuelve
  tal como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, ej.
  `authorId`) y se puede enviar de vuelta en una actualización sin modificaciones. `query_collection`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_documents`
  `{ count }`; `tools/list` da a ambas, a `aggregate_documents` y a `get_document`
  un `outputSchema`, flexible donde una respuesta varía. `aggregate_documents` equivale a `GET /api/data/<collection>/aggregate`:
  `select` es una lista en la sintaxis de REST (`["count()", "sum(total)"]`), `groupBy`
  una lista de campos, y responde `{ data }` con una fila por grupo, más
  `meta.hasMore` en una llamada agrupada, cuyos grupos se paginan con `limit` y `offset`
  y se ordenan con `orderBy`. En una colección donde un callback `afterRead` la reescribe,
  sirve únicamente `count()`, al igual que REST. Al igual que en REST, se rechaza un `limit`
  superior a 1000, un argumento no declarado y la edición o eliminación de una fila enviada a la papelera (404);
  establecer el campo de borrado suave en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_collection`, `count_documents` y `aggregate_documents` lee la papelera, al igual que hace
  `?deleted=` en REST, de modo que una fila enviada a la papelera por `delete_document` se puede volver a encontrar
  para restaurarla. Su descripción le indica al modelo que la eliminación es permanente únicamente en los casos donde
  la colección no cuenta con un campo de borrado suave.
- **El listado nombra las colecciones; `describe_collection` entrega el esquema de una.**
  `list_collections` responde con el `name`, `title` y `description` de cada colección,
  y `describe_collection { collection }` con los esquemas OpenAPI `row` y
  `create` de esa colección, además de `softDeleteField` donde las filas van a la papelera. Las descripciones
  de las herramientas le indican al modelo que describa una colección antes de escribir en ella. El
  listado de un proyecto de 200 colecciones ocupa alrededor de 5k tokens, y cada descripción
  menos de 1k; con todos los esquemas incluidos en el listado, ocupaba alrededor de 150k.
- **Un token solo para este endpoint.** Un token de acceso MCP es rechazado por
  `/api/data`, `/api/admin` y el WebSocket, por lo que conectar un asistente no le
  entrega una sesión.

Cada petición a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o deshabilitada,
o una acción de "cerrar sesión en todas partes" o un cambio de contraseña después de que se emitiera
el token, detiene a un cliente conectado de inmediato con un error 401. Una degradación de permisos se aplica en su
siguiente llamada a una herramienta. Cada actualización de token realiza las mismas comprobaciones y rechaza dicha concesión
definitivamente. Una sesión de invitado no puede otorgar ningún consentimiento.

Una limitación: desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización de inmediato, pero un token de acceso
ya emitido continúa funcionando hasta que expire, dentro del plazo de una hora.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
