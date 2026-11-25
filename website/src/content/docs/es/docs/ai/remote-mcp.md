---
sourceHash: da06ce7daeaa1c32
title: El endpoint remoto de MCP
sidebar_label: Endpoint MCP remoto
description: "Sirva MCP desde un backend desplegado en /mcp, para que las personas que usan su aplicación puedan conectar Claude o Cursor como ellas mismas: OAuth con pantalla de consentimiento, diecisiete herramientas bajo tres scopes, cada llamada bajo su propia seguridad a nivel de fila."
---

:::tip[¿Conectar Claude a sus propios proyectos?]
Ese es el [conector de Rebase](/docs/ai/rebase-connector/): un solo conector para
todos ellos, y un servidor autohospedado se une a él con `rebase cloud connect`. Esta
página es para las personas que **usan** su aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta para desarrolladores: se ejecuta en su máquina y contiene una clave
de servicio o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan su aplicación. Un asistente que una de ellas conecte lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila (row-level security).

Está desactivado a menos que lo active, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda delimitar una consulta
a un solo usuario, el endpoint se niega a montarse e indica el motivo en el registro de inicio. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro
  dinámico está activo por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que usted registre) y envía a la persona a una pantalla de consentimiento que
  inicia su sesión a través de su `/auth/login` existente. A una cuenta con un segundo factor
  se le solicita su código de autenticación o un código de recuperación a través de las
  rutas existentes `/auth/mfa/challenge`. Cuando el propio frontend de su aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta y
  Permitir da su consentimiento actuando como ella sin contraseña; así es como se conecta alguien que solo
  inicia sesión con Google, GitHub o un enlace de correo electrónico. De lo contrario, inicia sesión con
  contraseña, y alguien que no tenga una debe configurarla primero con `/auth/forgot-password`
  ("Olvidé mi contraseña" en su aplicación); la pantalla se lo indicará. También indica el host al que se envía el código de autorización
  y especifica que dicho host no está verificado: cualquiera puede registrar un cliente con
  cualquier nombre, por lo que el host es la parte que la persona puede verificar.
- **Diecisiete herramientas, tres scopes.** Los mismos [scopes](/docs/backend/roles-and-scopes/)
  que utiliza cada credencial. `data:read` ofrece `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, las tres vistas,
  `show_table`, `show_record` y `show_app`, `show_app_guide`, y las experimentales
  `list_apps` y `open_app`; `data:write` añade `create_row`, `update_row` y las
  experimentales `save_app` y `delete_app`; `data:delete` añade `delete_row`. Un cliente que no
  solicita nada obtiene `data:read`. Cada uno puede restringirse a una tabla: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un scope decide qué herramientas se
  ofrecen y a qué tablas acceden, no qué filas: una lista vacía puede ser
  resultado de RLS en funcionamiento, y `data:write` aún no puede escribir una fila que la persona no podría.
- **Tres herramientas ponen su panel de administración frente a la persona.** En un cliente que
  renderiza MCP Apps, como Claude, estas abren las vistas propias del panel de administración en la
  conversación, generadas a partir de los descriptores de tabla que el backend sirve a esta
  persona —columnas, enumeraciones, validación, relaciones— con las preferencias de interfaz de usuario que
  compone el panel: el `ui-config.json` incluido en el paquete, las del espacio de trabajo y
  las de la propia persona (una clave de API no tiene ninguna), de modo que las etiquetas, el orden de las columnas,
  las columnas ocultas y las etiquetas de enum coincidan con el panel. Las personalizaciones del panel de
  su propio proyecto se muestran donde el backend sirve su vista MCP.
  - `show_table` toma los argumentos de `query_table`, más `view`
    (`table`, `list`, `cards` o `kanban`), y abre la vista de la tabla: la
    persona puede buscar, filtrar, ordenar y paginar, abrir el formulario de una fila y agregar filas.
  - `show_record` abre el formulario de una fila (`id`), o un formulario para una nueva fila a
    partir de los `values` que el modelo completó, para que la persona lo revise y
    guarde por sí misma.
  - `show_app` ejecuta una aplicación que el modelo escribe para la tarea en cuestión: un
    componente de React (`code`) y las tablas (`tables`) que lee. Importa los paquetes
    propios de Rebase, por lo que el mismo código funciona en su proyecto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      y `useRowWrites` sobre las filas del proyecto;
    - `@rebasepro/cms`: el `CollectionPanel` del panel de administración (con
      `CollectionToolbar` y sus componentes, y `onRowClick`, que entrega a la
      aplicación la fila seleccionada según la lee `useRows`), `RecordForm` y `FormField`,
      `RecordDetail`, `FieldValue` y `useSidePanel`, cada uno especificando su
      tabla por ruta, con sus campos, vistas y acciones personalizados;
    - `@rebasepro/ui`, todo el kit de UI, incluidos `SplitView` y los mosaicos y
      gráficos de KPI.

    El servidor lo compila primero, por lo que un error de sintaxis, un módulo que la vista no
    sirva o un nombre que no proporcione desde `@rebasepro/cms` o
    `@rebasepro/app` será el error devuelto en la llamada, junto con su número de línea. Un error mientras se
    ejecuta se muestra en su lugar y se comunica al modelo en el siguiente
    mensaje de la persona. Una aplicación solo puede usar las tablas que enumera. Sus estilos son
    las utilidades estándar de Tailwind, compiladas con la vista antes de que llegue
    cualquier aplicación: un valor arbitrario como `h-[560px]` no surte ningún efecto allí, por lo que un
    tamaño exacto debe definirse como un `style`.

    La descripción de `show_app` contiene solo lo esencial, porque un cliente
    puede truncar una descripción de herramienta demasiado larga (claude.ai lo hace alrededor de los 4.000
    caracteres). Le indica al modelo que llame primero a `show_app_guide`, que
    devuelve cada hook, componente y prop que una aplicación puede usar, junto con un
    ejemplo práctico. `show_app_guide` se ofrece dondequiera que esté disponible `show_app`.

  Cada lectura y guardado en la vista es una llamada a una de las herramientas de lectura y escritura,
  realizada como la persona bajo su RLS, por lo que un formulario ofrece solo aquello para lo que su
  conexión tiene permisos: sin `data:write` es de solo lectura, y un campo
  que sus roles no pueden leer no aparecerá en él. Ese es también el límite dentro del cual trabaja el código
  de una aplicación: se ejecuta en la vista, por lo que cada llamada que realiza corresponde a una de
  esas herramientas, actuando como la persona, y no puede hacer nada que el modelo no pudiera hacer
  con las mismas herramientas. En el conector alojado, cada escritura también es planificada
  y confirmada por el servidor. Dentro de ese marco, `useRowWrites` pregunta a la persona
  antes de escribir, de modo que una aplicación no escribe sin su clic; los
  propios controles del administrador (el botón Guardar de un formulario, una eliminación, la edición de una tabla) se comportan como lo
  hacen en una pantalla de `show_table`. Al modelo se le informa sobre lo que cambiaron. Lee las filas que responde cada herramienta, no los descriptores con los que
  dibuja la vista. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra nada,
  y el modelo lee las mismas filas que obtendría de `query_table`.
- **Experimental: aplicaciones guardadas en el proyecto.** `save_app` conserva una aplicación que el
  modelo construyó con `show_app` para que pueda abrirse nuevamente: compila el código como lo
  hace `show_app` y la almacena con su `title`, `tables` y
  `visibility`, que puede ser `personal` (su propietario, por defecto), `roles` (cualquiera
  que tenga uno de sus `roles`) o `team` (todos los que inicien sesión). Guardar para
  alguien más que para uno mismo requiere el rol de administrador, ya que una aplicación compartida es código escrito por una IA
  que se ejecuta para otras personas. Solo su propietario o un administrador pueden reemplazar
  (`id`) o eliminar una, y una persona puede conservar como máximo 200. `list_apps` lista
  las aplicaciones que quien llama puede abrir, `open_app` abre una tal como lo haría `show_app`, y
  `delete_app` la elimina. Ver una aplicación no significa acceder a sus datos: una aplicación
  abierta lee y escribe mediante las herramientas anteriores, actuando como quien la abra, bajo
  su RLS. Las aplicaciones residen en `rebase.saved_apps`, que el backend crea
  la primera vez que una herramienta la usa y no otorga permisos a ningún usuario final.
  El panel de administración abre las mismas aplicaciones: agregue `savedAppsView` desde
  `@rebasepro/cms` a sus `views`. Ejecuta una aplicación en un iframe aislado (sandboxed)
  sin `allow-same-origin` y sin red propia, y retransmite sus
  llamadas a herramientas a `POST /api/admin/apps/mcp`, las mismas herramientas para la sesión del panel de
  administración, que se monta con las rutas de administración independientemente de si
  `REBASE_MCP_ENABLED` está configurado. Los nombres y formatos de las herramientas aún pueden cambiar.
- **Las autorizaciones otorgadas antes de la versión 0.24 mantienen su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, tanto en las autorizaciones almacenadas como
  en los tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con un encabezado en lugar de un flujo OAuth. La clave accede a
  las herramientas que cubren sus scopes `data:*`, actuando como quien represente: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK:
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura; y leen a través de la ruta de `GET /api/data/<table>`, de modo que una fila se devuelve
  tal como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, p. ej.,
  `authorId`) y puede enviarse de vuelta en una actualización sin cambios. `query_table`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_rows`
  `{ count }`; `tools/list` proporciona a ambos, a `aggregate_rows` y a `get_row`
  un `outputSchema`, flexible cuando una respuesta varía. `aggregate_rows` es `GET /api/data/<table>/aggregate`:
  `select` es una lista en la gramática de REST (`["count()", "sum(total)"]`), `groupBy`
  es una lista de campos, y responde `{ data }` con una fila por grupo, más
  `meta.hasMore` en una llamada agrupada, cuyos grupos se paginan con `limit` y `offset`
  y se ordenan con `orderBy`. En una tabla donde un hook `afterRead` reescribe el resultado,
  sirve `count()` solo, al igual que REST. Al igual que en REST, se rechaza un `limit` superior a 1000,
  un argumento no declarado y la edición o eliminación de una fila en la papelera (404);
  establecer el campo de borrado lógico (soft-delete) en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_table`, `count_rows` y `aggregate_rows` lee la papelera, al igual que hace
  `?deleted=` en REST, de modo que una fila enviada a la papelera por `delete_row` pueda encontrarse nuevamente para
  restaurarla. Su descripción indica al modelo que la eliminación es permanente solo cuando
  la tabla no tiene un campo de borrado lógico.
- **El listado nombra las tablas; `describe_table` proporciona el esquema de una.**
  `list_tables` responde `{ tables: [{ name, description, kind? }] }` —sin label—
  y `describe_table { table }` devuelve los esquemas OpenAPI `row` (las columnas servidas a quien llama) y `create` (las modificables)
  de esa tabla, su `primaryKey`, las `relations` servidas y `rls` (SQL
  sin procesar redactado si no se tiene `schema:read`), además de `softDeleteField` donde las filas van a la
  papelera, y la presentación que le otorgan las preferencias de interfaz de usuario de quien llama: `title`, y
  por columna `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Lo que una
  conexión puede saber sobre el esquema lo decide el mismo serializador
  que utiliza `GET /api/schema/tables`. Las descripciones de las herramientas indican al modelo que
  describa una tabla antes de escribir en ella. El listado de un proyecto de 200 tablas ocupa
  unos 5.000 tokens, y cada descripción
  menos de 1.000; con todos los esquemas en el listado eran unos 150.000.
- **Un token exclusivo para este endpoint.** `/api/data`,
  `/api/admin` y el WebSocket rechazan los tokens de acceso de MCP, por lo que conectar un asistente no le
  otorga una sesión.

Cada solicitud a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o deshabilitada,
o una acción de "cerrar sesión en todas partes" o un cambio de contraseña después de que se emitió el token,
detiene de inmediato a un cliente conectado con un error 401. Una degradación de permisos se aplica a su
siguiente llamada a herramienta. Cada actualización (refresh) realiza las mismas comprobaciones y rechaza dicha autorización
definitivamente. Una sesión de invitado no puede dar consentimiento en absoluto.

Un límite. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización (refresh tokens) de inmediato, pero un token de acceso
ya emitido continúa funcionando hasta que caduque, dentro del plazo de una hora.

## Skills

El endpoint también puede servir [Agent Skills](https://agentskills.io/specification)
a través de MCP: instrucciones que un asistente carga cuando la tarea las requiere, como por
ejemplo la forma en que su equipo registra un pedido o qué significa un campo determinado. Coloque cada skill en su propia
carpeta, con un archivo `SKILL.md` cuyo frontmatter tenga un `name` que coincida con la carpeta
y un `description`, además de los archivos a los que haga referencia. Luego, indique el nombre de la carpeta principal
en la configuración del backend:

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

La ruta es relativa al directorio de trabajo. Las herramientas de datos permanecen tal cual,
y `skills` se ubica junto a `tools` cuando un backend aporta las suyas propias.

- **Lo que ve un cliente.** Los clientes en la revisión del protocolo 2026-07-28 o posterior
  (Claude Code, Claude) listan las skills y cargan una cuando es relevante.
  Claude Code nombra a cada una `<connector>:<skill>`. Estas se sirven a través de
  la extensión de skills de MCP (`io.modelcontextprotocol/skills`): `skills/list`,
  `skills/get` y `resources/read` de `skill://<name>/…`. Cada skill viene
  acompañada de un manifiesto SHA-256 de sus archivos. El cliente verifica cada archivo contra
  ese manifiesto y la aprobación de la persona queda vinculada a él.
- **Quién puede leerlas.** Cualquier conexión autenticada, independientemente de sus scopes.
  No incluya nada en una skill que no sea apto para todos los que se conecten.
- **Cuándo cambian.** La carpeta se lee en la primera solicitud que la necesita,
  por lo que una edición surte efecto en el siguiente despliegue o reinicio. Un archivo que cambie en el
  disco antes de eso es rechazado, no servido contra un manifiesto con el que ya no
  coincida.
- **Qué queda fuera.** Se omite cualquier skill que incumpla una regla, y el registro de inicio
  explica el motivo. Las reglas: ausencia de frontmatter, un nombre que difiera del de su carpeta,
  un enlace simbólico en su interior, o más de 512 archivos o 16 MiB. Los archivos ocultos como
  `.gitkeep` nunca se sirven. Una skill que supere los propios límites de Claude Code (100 KB
  por archivo, 400 KB en total) se sirve con una advertencia, ya que Claude Code
  no la cargará.

El endpoint responde a ambas eras del protocolo. Un cliente de la era 2025 inicia con
`initialize`, como antes. Un cliente 2026-07-28 no envía ningún protocolo de enlace (handshake). Cada solicitud
incluye su versión del protocolo y sus capacidades en `params._meta`, además de los encabezados
`MCP-Protocol-Version`, `Mcp-Method` y `Mcp-Name`, que deben coincidir
con el cuerpo. Sus capacidades provienen de `server/discover`. Las skills se
declaran únicamente allí.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuration](/docs/getting-started/configuration/#mcp-surface).
