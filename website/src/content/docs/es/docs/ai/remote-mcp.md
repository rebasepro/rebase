---
sourceHash: 4c9e8266acfba86f
title: El endpoint remoto de MCP
sidebar_label: Endpoint remoto de MCP
description: "Sirve MCP desde un backend desplegado en /mcp, para que las personas que usan tu aplicación puedan conectar Claude o Cursor en su propio nombre: OAuth con pantalla de consentimiento, diecisiete herramientas bajo tres alcances, cada llamada bajo su propia seguridad a nivel de fila."
---

:::tip[¿Conectando Claude a tus propios proyectos?]
Ese es el [conector de Rebase](/docs/ai/rebase-connector/): un conector para
todos ellos, y un servidor autoalojado se une con `rebase cloud connect`. Esta
página es para las personas que **usan** tu aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta para desarrolladores: se ejecuta en tu máquina y contiene una clave
de servicio o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan tu aplicación. Un asistente que uno de ellos conecte lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila (RLS).

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda limitar el alcance de una consulta
a un solo usuario, el endpoint se niega a montarse y explica el motivo en el registro de inicio. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con una pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro
  dinámico está activo por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que registres) y envía a la persona a una pantalla de consentimiento que inicia
  su sesión a través de tu `/auth/login` existente. A una cuenta con un segundo factor
  se le solicita luego su código de autenticador o un código de recuperación, a través de las
  rutas existentes `/auth/mfa/challenge`. Cuando el frontend de tu propia aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta, y
  Permitir da el consentimiento como tal sin contraseña; así es como se conecta alguien que solo
  inicia sesión con Google, GitHub o un enlace por correo electrónico. De lo contrario, inicia sesión con una
  contraseña, y quien no tenga una debe configurarla primero con `/auth/forgot-password`
  ("Olvidé mi contraseña" de tu aplicación); la pantalla se lo indica. También nombra el host al que se envía el código de autorización
  y advierte que dicho host no está verificado: cualquiera puede registrar un cliente bajo
  cualquier nombre, por lo que el host es la parte que una persona puede verificar.
- **Diecisiete herramientas, tres alcances.** <span class="since-badge" data-since="0.31">Desde 0.31</span> Los mismos [alcances](/docs/backend/roles-and-scopes/)
  que utiliza cada credencial. `data:read` ofrece `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, las tres vistas,
  `show_table`, `show_record` y `show_app`, `show_app_guide`, y los experimentales
  `list_apps` y `open_app`; `data:write` añade `create_row`, `update_row` y los
  experimentales `save_app` y `delete_app`; `data:delete` añade `delete_row`. Un cliente que no
  solicita nada recibe `data:read`. Cada uno se restringe a una tabla: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un alcance decide qué herramientas se
  ofrecen y a qué tablas acceden, no a qué filas: una lista vacía puede ser
  RLS funcionando, y `data:write` sigue sin poder escribir una fila que la persona no podría.
- **Tres herramientas ponen tu panel de administración frente a la persona.** En un cliente que
  renderiza MCP Apps, como Claude, estas abren las propias vistas del panel de administración en la
  conversación, generadas a partir de los descriptores de tabla que el backend sirve a esta
  persona —columnas, enums, validación, relaciones— con las preferencias de UI que el
  panel compone: el `ui-config.json` que incluía el paquete, las del espacio de trabajo y
  las de la propia persona (una clave de API no tiene ninguna), de modo que las etiquetas, el orden de las columnas, las
  columnas ocultas y las etiquetas de enums coinciden con el panel. Las personalizaciones
  del panel de tu propio proyecto se muestran donde el backend sirve su vista MCP.
  - `show_table` toma los argumentos de `query_table`, más `view`
    (`table`, `list`, `cards` o `kanban`), y abre la vista de la tabla: la
    persona puede buscar, filtrar, ordenar y paginar, abrir el formulario de una fila y agregar filas.
  - `show_record` abre el formulario de una fila (`id`), o un formulario para una nueva fila que
    comienza a partir de los `values` que el modelo completó, para que la persona lo revise y
    lo guarde ella misma.
  - `show_app` ejecuta una aplicación que el modelo escribe para la tarea en cuestión: un
    componente de React (`code`) y las `tables` que lee. Importa los propios
    paquetes de Rebase, por lo que el mismo código funciona en tu proyecto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      y `useRowWrites` sobre las filas del proyecto;
    - `@rebasepro/cms`: el `CollectionPanel` del panel de administración (con
      `CollectionToolbar` y sus piezas, y `onRowClick`, que pasa a la
      app la fila cliqueada tal como la lee `useRows`), `RecordForm` y `FormField`,
      `RecordDetail`, `FieldValue` y `useSidePanel`, cada uno nombrando su
      tabla por ruta, con tus campos, vistas y acciones personalizados;
    - `@rebasepro/ui`, todo el kit de UI, incluidos `SplitView` y los mosaicos de KPI y
      gráficos.

    El servidor lo compila primero, por lo que un error de sintaxis, un módulo que la vista
    no sirve o un nombre que no sirve desde `@rebasepro/cms` o
    `@rebasepro/app` será el error de la llamada, con su línea. Un error mientras se
    ejecuta se muestra en su lugar y se comunica al modelo con el siguiente
    mensaje de la persona. Una app solo puede usar las tablas que enumera. Sus estilos son
    las utilidades estándar de Tailwind, compiladas con la vista antes de que llegue
    cualquier app: un valor arbitrario como `h-[560px]` no hace nada allí, por lo que un
    tamaño exacto debe ser un `style`.

    La descripción de `show_app` contiene solo lo esencial, ya que un cliente
    puede truncar una descripción de herramienta larga (claude.ai lo hace alrededor de los 4.000
    caracteres). Le indica al modelo que llame primero a `show_app_guide`, que
    devuelve cada hook, componente y prop que una app puede usar, con un
    ejemplo práctico. `show_app_guide` se ofrece dondequiera que esté `show_app`.

  Cada lectura y guardado en la vista es una llamada a las herramientas de lectura y escritura,
  realizada como la persona bajo su RLS, por lo que un formulario ofrece solo lo que se le
  otorgó a su conexión: sin `data:write` es de solo lectura, y un campo que
  sus roles no pueden leer no aparece en él. Ese es también el límite dentro del cual
  opera el código de una app: se ejecuta en la vista, por lo que cada llamada que realiza es una de
  esas herramientas, como la persona, y no puede hacer nada que el modelo no pudiera hacer
  con las mismas herramientas. En el conector alojado, cada escritura también es planificada
  y confirmada por el servidor. Dentro de eso, `useRowWrites` le pregunta a la persona
  antes de escribir, de modo que una app no escribe sin su clic; los controles
  propios del administrador (el Guardar de un formulario, una eliminación, una edición de tabla) se comportan como
  lo hacen en una pantalla de `show_table`. Al modelo se le informa qué cambiaron. Lee las filas que responde cada herramienta, no los descriptores con los que
  dibuja la vista. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra nada,
  y el modelo lee las mismas filas que leería desde `query_table`.
- **Experimental: aplicaciones guardadas en el proyecto.** `save_app` conserva una app que el
  modelo creó con `show_app` para que pueda abrirse nuevamente: compila el código tal como
  lo hace `show_app` y la almacena con su `title`, `tables` y
  `visibility`, que es `personal` (su propietario, el valor predeterminado), `roles` (cualquiera
  que tenga uno de sus `roles`) o `team` (todos los que inicien sesión). Guardar para
  alguien más además de ti mismo requiere el rol de administrador, ya que una app compartida es código que escribió
  una IA ejecutándose para otras personas. Solo su propietario o un administrador reemplaza
  (`id`) o elimina una, y una persona conserva como máximo 200. `list_apps` lista
  las aplicaciones que quien llama puede abrir, `open_app` abre una como lo haría `show_app`, y
  `delete_app` elimina una. Ver una aplicación no significa acceder a sus datos: una
  app abierta lee y escribe a través de las herramientas anteriores, como quien la abra, bajo
  su RLS. Las aplicaciones residen en `rebase.saved_apps`, que el backend crea
  la primera vez que una herramienta lo utiliza y no se concede a ningún usuario final.
  El panel de administración abre las mismas aplicaciones: añade `savedAppsView` desde
  `@rebasepro/cms` a tus `views`. Ejecuta una app en un iframe aislado (sandboxed)
  sin `allow-same-origin` y sin red propia, y retransmite sus
  llamadas a herramientas a `POST /api/admin/apps/mcp`, las mismas herramientas para la
  sesión del panel de administración, que se monta con las rutas de administración independientemente
  de si `REBASE_MCP_ENABLED` está configurado. Los nombres y estructuras de las herramientas aún pueden cambiar.
- **Las autorizaciones otorgadas antes de 0.24 conservan su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, en autorizaciones almacenadas y
  en tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con una cabecera en lugar de un flujo de OAuth. La clave accede a
  las herramientas que cubren sus alcances `data:*`, según en nombre de quién actúe: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura— y leen a través de la ruta `GET /api/data/<table>`, de modo que una fila se devuelve
  tal como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, ej.
  `authorId`) y se puede enviar de vuelta en una actualización sin cambios. `query_table`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_rows`
  `{ count }`; `tools/list` proporciona a ambos, a `aggregate_rows` y a `get_row`
  un `outputSchema`, flexible donde una respuesta varía. `aggregate_rows` es `GET /api/data/<table>/aggregate`:
  `select` es una lista en la gramática de REST (`["count()", "sum(total)"]`), `groupBy`
  una lista de campos, y responde `{ data }` con una fila por grupo, más
  `meta.hasMore` en una llamada agrupada, cuyos grupos se paginan con `limit` y `offset`
  y se ordenan con `orderBy`. En una tabla donde un hook `afterRead` la reescribe,
  sirve únicamente `count()`, tal como lo hace REST. Al igual que en REST, se rechaza un `limit` superior a 1000, un argumento no declarado y la
  edición o eliminación de una fila enviada a la papelera (404);
  establecer el campo de eliminación suave en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_table`, `count_rows` y `aggregate_rows` lee la papelera, al igual que `?deleted=` de REST,
  de modo que una fila enviada a la papelera por `delete_row` pueda encontrarse nuevamente para
  restaurarla. Su descripción le indica al modelo que la eliminación es permanente únicamente donde
  la tabla no tiene un campo de eliminación suave.
- **El listado nombra las tablas; `describe_table` proporciona el esquema de una.**
  `list_tables` responde `{ tables: [{ name, description, kind? }] }` —sin label—
  y `describe_table { table }` responde los esquemas
  OpenAPI `row` (las columnas que se sirven a quien llama) y `create` (las modificables)
  de esa tabla, su `primaryKey`, las `relations` servidas y `rls` (SQL sin procesar
  censurado sin `schema:read`), además de `softDeleteField` donde las filas van a la
  papelera, y la presentación que le otorgan las preferencias de UI de quien llama: `title`, y
  por columna `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Lo que una
  conexión puede conocer sobre el esquema lo decide el mismo serializador que
  utiliza `GET /api/schema/tables`. Las descripciones de las herramientas indican al modelo que
  describa una tabla antes de escribir en ella. El listado de un proyecto de 200 tablas ocupa
  unos 5k tokens, y cada descripción
  menos de 1k; con cada esquema en el listado rondaba los 150k.
- **Un token solo para este endpoint.** Un token de acceso de MCP es rechazado por
  `/api/data`, `/api/admin` y el WebSocket, por lo que conectar un asistente no le
  entrega una sesión.

Cada solicitud a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o deshabilitada,
o un "cerrar sesión en todas partes" o cambio de contraseña después de que se emitió el token,
detiene a un cliente conectado de inmediato con un 401. Una degradación de permisos se aplica en su
siguiente llamada a herramienta. Cada actualización (refresh) realiza las mismas comprobaciones y rechaza dicha autorización
de forma permanente. Una sesión de invitado no puede dar su consentimiento en absoluto.

Una limitación. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus refresh tokens de inmediato, pero un token de acceso
ya emitido continúa funcionando hasta que expire, dentro de una hora.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
