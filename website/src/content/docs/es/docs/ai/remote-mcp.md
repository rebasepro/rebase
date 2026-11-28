---
sourceHash: 3e29eee7079b7ef3
title: El endpoint remoto de MCP
sidebar_label: Endpoint remoto de MCP
description: Sirve MCP desde un backend desplegado en /mcp, para que las personas que usan tu app puedan conectar Claude o Cursor como ellas mismas — OAuth con pantalla de consentimiento, diecisiete herramientas bajo tres alcances, cada llamada bajo su propia seguridad a nivel de fila.
---

:::tip[¿Conectando Claude a tus propios proyectos?]
Ese es el [conector de Rebase](/docs/ai/rebase-connector/): un conector para
todos ellos, y un servidor autoalojado se une a él con `rebase cloud connect`. Esta
página es para las personas que **usan** tu aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta para desarrolladores: se ejecuta en tu máquina y contiene una clave
de servicio o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan tu aplicación. Un asistente que alguno de ellos conecte lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila (row-level security).

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda delimitar el alcance de una consulta
a un solo usuario, el endpoint se niega a montarse y explica el motivo en el registro de inicio. Ningún
`REBASE_ROLE` lo activa.

`rebase dev` es la única excepción: activa `/mcp` para el servidor que
inicia, y ese servidor define su propia dirección, `http://localhost:<port>`, como
la URL pública, por lo que no hay nada que configurar. Una línea `REBASE_MCP_ENABLED`
en la shell o en `.env` sigue decidiendo, `false` incluido. El banner de desarrollo
imprime el endpoint en una línea `MCP:` una vez que se ha montado.

## Conectar un cliente

```bash
rebase mcp connect            # pick the clients to connect, from a list
rebase mcp connect --client claude-code,cursor
rebase mcp connect --print    # the URL, the command and the install links; changes nothing
rebase mcp url                # the URL alone
```

`rebase mcp connect` le pregunta al servidor dónde está `/mcp`, leyendo el documento que
publica en `/.well-known/oauth-protected-resource/mcp`, de modo que la URL sea la correcta
detrás de un proxy, bajo `REBASE_PUBLIC_URL`, y en un puerto de desarrollo que haya cambiado. Luego
conecta cada cliente que elijas:

| Cliente | `--client` | Qué sucede |
|---|---|---|
| Claude Code | `claude-code` | Ejecuta `claude mcp add --transport http <name> <url>` |
| Cursor | `cursor` | Abre el enlace de instalación de Cursor |
| VS Code | `vscode` | Abre el enlace de instalación de VS Code |
| Claude (claude.ai, escritorio, móvil) | `claude` | Imprime los pasos para Configuración → Conectores, con la URL para pegar |
| ChatGPT | `chatgpt` | Imprime los pasos para la configuración de sus conectores |

Los clientes que encuentra instalados ya aparecen marcados. Claude y ChatGPT se conectan
desde sus propios servidores, los cuales no pueden alcanzar `localhost`, por lo que frente a un servidor de desarrollo
se listan indicando que necesitan un proyecto desplegado. `--client all` nombra a cada uno.
Sin una terminal, o bajo `--json`, y sin `--client`, el comando imprime lo que
hace `--print` y no conecta nada.

El servidor al que consulta es el del propio proyecto: `REBASE_BASE_URL`, o de lo contrario el
`rebase dev` en ejecución. `--cloud` consulta al proyecto de Rebase Cloud al que está vinculado el
directorio, y `--url <server>` a cualquier backend. Un servidor con `/mcp` desactivado no responde nada
allí, y el comando indica cómo activarlo.

El servidor se registra con el nombre del proyecto, con `-local` para uno en esta
máquina, de modo que se puedan conectar tanto un proyecto local como uno desplegado; `--name`
lo cambia. Nunca es `rebase`, el nombre del [servidor MCP para desarrolladores](/docs/ai/mcp/)
en el archivo `.mcp.json` de un proyecto, el cual quedaría oculto por un segundo servidor
con el mismo nombre.

El panel de administración ofrece los mismos pasos. Su panel lateral tiene un botón **Connect AI**
que muestra la URL que publica el servidor, el comando `claude mcp add`, los enlaces de instalación
de Cursor y VS Code y, en un proyecto desplegado, los pasos del conector para Claude y
ChatGPT. Debajo de ellos enumera los agentes que la persona con sesión iniciada
ha conectado, cada uno con una opción para desconectarlo. Todos los que hayan iniciado sesión
ven el botón mientras `/mcp` esté activo. Mientras esté desactivado, solo un administrador
lo ve, con instrucciones sobre cómo activarlo.

## Qué obtiene una conexión

- **OAuth, con una pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro dinámico
  está activo por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita a los clientes que registres)
  y envía a la persona a una pantalla de consentimiento que inicia su sesión a través de tu `/auth/login` existente.
  A una cuenta con un segundo factor de autenticación se le solicita su código de autenticador o un código de recuperación,
  a través de las rutas existentes de `/auth/mfa/challenge`. Cuando el propio frontend de tu aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta y Permitir (Allow)
  otorga el consentimiento como ese usuario sin contraseña; así es como se conecta alguien que inicia sesión únicamente
  con Google, GitHub o un enlace por correo electrónico. De lo contrario, inicia sesión con una
  contraseña, y alguien que no tenga una debe configurarla primero con `/auth/forgot-password`
  ("Olvidé mi contraseña" de tu app); la pantalla se lo indicará. También indica el host al que se envía el código de autorización
  y advierte que dicho host no está verificado: cualquiera puede registrar un cliente bajo
  cualquier nombre, por lo que el host es la parte que una persona puede comprobar.
- **Diecisiete herramientas, tres alcances.** Los mismos [alcances (scopes)](/docs/backend/roles-and-scopes/)
  que utiliza cada credencial. `data:read` ofrece `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, las tres vistas,
  `show_table`, `show_record` y `show_app`, `show_app_guide`, y las experimentales
  `list_apps` y `open_app`; `data:write` añade `create_row`, `update_row` y las
  experimentales `save_app` y `delete_app`; `data:delete` añade `delete_row`. Un cliente que no solicita
  nada obtiene `data:read`. Cada uno se puede limitar a una tabla: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un alcance decide qué herramientas se
  ofrecen y a qué tablas acceden, no a qué filas: una lista vacía puede ser
  RLS funcionando, y `data:write` sigue sin poder escribir una fila que la persona no podría.
- **Tres herramientas ponen tu panel de administración frente a la persona.** En un cliente que
  renderiza MCP Apps, como Claude, estas abren las vistas propias del panel de administración en la
  conversación, generadas a partir de los descriptores de tabla que el backend sirve a esta
  persona —columnas, enums, validación, relaciones— con las preferencias de UI que el
  panel compone: el `ui-config.json` incluido en el paquete, las del espacio de trabajo y
  las de la propia persona (una clave de API no tiene ninguna), de modo que las etiquetas, el orden de las columnas, las columnas
  ocultas y las etiquetas de los enums coincidan con el panel. Las personalizaciones del panel de tu
  propio proyecto se muestran donde el backend sirve su vista MCP.
  - `show_table` toma los argumentos de `query_table`, más `view`
    (`table`, `list`, `cards` o `kanban`), y abre la vista de la tabla: la
    persona puede buscar, filtrar, ordenar y paginar, abrir el formulario de una fila y añadir filas.
  - `show_record` abre el formulario de una fila (`id`), o un formulario para una nueva fila que
    comienza a partir de los `values` que el modelo completó, para que la persona los revise y
    guarde por sí misma.
  - `show_app` ejecuta una aplicación que el modelo escribe para la tarea en cuestión: un
    componente de React (`code`) y las tablas (`tables`) que lee. Importa los
    propios paquetes de Rebase, de modo que el mismo código funcione en tu proyecto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      y `useRowWrites` sobre las filas del proyecto;
    - `@rebasepro/cms`: el `CollectionPanel` del panel de administración (con
      `CollectionToolbar` y sus componentes, y `onRowClick`, que pasa a la
      app la fila clickeada tal como la lee `useRows`), `RecordForm` y `FormField`,
      `RecordDetail`, `FieldValue` y `useSidePanel`, cada uno nombrando su
      tabla por ruta, con tus campos personalizados, vistas y acciones;
    - `@rebasepro/ui`, todo el kit de interfaz de usuario, incluyendo `SplitView` y las tarjetas de KPI y
      gráficos.

    El servidor lo compila primero, por lo que un error de sintaxis, un módulo que la vista
    no sirva o un nombre que no proporcione desde `@rebasepro/cms` o
    `@rebasepro/app` será el error de la llamada, junto con su línea. Un error durante
    su ejecución se muestra en su lugar y se comunica al modelo con el siguiente
    mensaje de la persona. Una app solo puede usar las tablas que enumera. Sus estilos son
    las utilidades estándar de Tailwind, compiladas con la vista antes de que
    llegue cualquier app: un valor arbitrario como `h-[560px]` no hace nada allí, por lo que un
    tamaño exacto debe ser un `style`.

    La descripción de `show_app` incluye únicamente lo esencial, ya que un cliente
    puede recortar una descripción de herramienta larga (claude.ai lo hace alrededor de los 4.000
    caracteres). Le indica al modelo que llame primero a `show_app_guide`, el cual
    devuelve cada hook, componente y prop que una app puede usar, junto con un
    ejemplo práctico. `show_app_guide` se ofrece dondequiera que esté disponible `show_app`.

  Cada lectura y guardado en la vista es una llamada a las herramientas de lectura y escritura,
  realizada como la persona bajo su RLS, por lo que un formulario ofrece únicamente aquello para lo que
  se le concedieron permisos a su conexión: sin `data:write` es de solo lectura, y un campo
  que sus roles no pueden leer no aparecerá en él. Ese es también el límite dentro del cual
  opera el código de una app: se ejecuta en la vista, por lo que cada llamada que realiza es a una de
  esas herramientas, como la persona, y no puede hacer nada que el modelo no pudiera hacer
  con las mismas herramientas. En el conector alojado, cada escritura también es planificada
  y confirmada por el servidor. Dentro de eso, `useRowWrites` le pregunta a la persona
  antes de escribir, para que una app no escriba sin su clic; los controles propios de
  administración (el Guardar de un formulario, una eliminación, la edición de una tabla) se comportan como lo
  hacen en una pantalla de `show_table`. Al modelo se le comunica qué cambiaron. Lee las filas que responde cada herramienta, no los descriptores con los que
  se dibuja la vista. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra nada,
  y el modelo lee las mismas filas que obtendría de `query_table`.
- **Experimental: apps guardadas en el proyecto.** `save_app` conserva una app que el
  modelo construyó con `show_app` para que pueda abrirse nuevamente: compila el código tal como
  lo hace `show_app` y la almacena con su `title`, `tables` y
  `visibility`, que puede ser `personal` (su propietario, por defecto), `roles` (cualquiera
  que tenga uno de sus `roles`) o `team` (todos los que inicien sesión). Guardar para
  alguien más además de ti mismo requiere el rol de administrador, ya que una app compartida es código que una IA
  escribió, ejecutándose para otras personas. Solo su propietario o un administrador reemplaza
  (`id`) o elimina una, y una persona puede conservar como máximo 200. `list_apps` enumera
  las apps que el llamador puede abrir, `open_app` abre una como lo haría `show_app`, y
  `delete_app` la elimina. Ver una app no significa acceder a sus datos: una app
  abierta lee y escribe a través de las herramientas anteriores, como quienquiera que la abra, bajo
  su RLS. Las apps residen en `rebase.saved_apps`, que el backend crea
  la primera vez que una herramienta lo utiliza y no se concede a ningún usuario final.
  El panel de administración abre las mismas apps: añade `savedAppsView` de
  `@rebasepro/cms` a tus `views`. Ejecuta una app en un iframe aislado (sandboxed)
  sin `allow-same-origin` y sin red propia, y retransmite sus llamadas
  a herramientas a `POST /api/admin/apps/mcp`, las mismas herramientas para la sesión del
  panel de administración, que se monta con las rutas de administración independientemente de si
  `REBASE_MCP_ENABLED` está establecido o no. Los nombres y formas de las herramientas aún pueden cambiar.
- **Las autorizaciones otorgadas antes de 0.24 conservan su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, en autorizaciones almacenadas y
  en tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con un encabezado en lugar de un flujo OAuth. La clave accede a
  las herramientas cubiertas por sus alcances `data:*`, actuando como quien corresponda: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura— y leen a través de la ruta de `GET /api/data/<table>`, por lo que una fila se
  devuelve tal como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, ej.
  `authorId`) y se puede enviar de vuelta en una actualización sin cambios. `query_table`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_rows`
  `{ count }`; `tools/list` proporciona a ambos, a `aggregate_rows` y a `get_row`
  un `outputSchema`, flexible donde una respuesta varíe. `aggregate_rows` es `GET /api/data/<table>/aggregate`:
  `select` es una lista en la gramática de REST (`["count()", "sum(total)"]`), `groupBy`
  una lista de campos, y responde `{ data }` con una fila por grupo, más
  `meta.hasMore` en una llamada agrupada, cuyos grupos se paginan con `limit` y `offset`
  y se ordenan con `orderBy`. En una tabla donde un hook `afterRead` reescribe los datos,
  sirve únicamente `count()`, al igual que REST. Como en REST, se rechaza un `limit` superior a 1000, un argumento no declarado y
  la edición o eliminación de una fila en la papelera (404); establecer el campo de borrado suave
  en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_table`, `count_rows` y `aggregate_rows` lee la papelera, al igual que `?deleted=` en REST,
  de modo que una fila que `delete_row` envió a la papelera pueda encontrarse nuevamente para
  restaurarla. Su descripción le indica al modelo que la eliminación es permanente únicamente donde
  la tabla no tiene un campo de borrado suave.
- **El listado nombra las tablas; `describe_table` proporciona el esquema de una.**
  `list_tables` responde `{ tables: [{ name, description, kind? }] }` —sin etiqueta—
  y `describe_table { table }` responde los esquemas OpenAPI `row` (las columnas servidas a este llamador) y `create` (las modificables)
  de esa tabla, su `primaryKey`, las relaciones servidas (`relations`) y `rls` (SQL sin procesar
  redactado/oculto sin `schema:read`), además de `softDeleteField` cuando las filas van a la
  papelera, y la presentación que le otorgan las preferencias de UI del llamador: `title`, y
  por columna `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Lo que una
  conexión puede saber sobre el esquema se decide mediante el mismo serializador
  que utiliza `GET /api/schema/tables`. Las descripciones de las herramientas le indican al modelo que
  describa una tabla antes de escribir en ella. El listado de un proyecto de 200 tablas ocupa
  unos 5k tokens, y cada descripción
  menos de 1k; con todos los esquemas en el listado ocupaba alrededor de 150k.
- **Un token solo para este endpoint.** `/api/data`, `/api/admin` y el WebSocket
  rechazan un token de acceso de MCP, por lo que conectar un asistente no le
  entrega una sesión.

Cada solicitud a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o deshabilitada,
o un "cerrar sesión en todas partes" o cambio de contraseña posterior a la emisión
del token, detiene de inmediato a un cliente conectado con un 401. Una degradación de permisos se aplica en su
siguiente llamada a herramienta. Cada actualización de token (refresh) realiza las mismas comprobaciones y rechaza dicha autorización
definitivamente. Una sesión de invitado no puede otorgar consentimiento en absoluto.

Un límite. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización de inmediato, pero un token de acceso
ya emitido sigue funcionando hasta que caduque, en el transcurso de una hora.

## Skills

El endpoint también puede servir [Agent Skills](https://agentskills.io/specification)
a través de MCP: instrucciones que un asistente carga cuando la tarea las requiere, como la forma en que
tu equipo registra un pedido o lo que significa un campo. Coloca cada skill en su propia
carpeta, con un archivo `SKILL.md` cuyo frontmatter tenga un `name` que coincida con la carpeta
y una `description`, además de cualquier archivo al que enlace. Luego indica la carpeta superior
en la configuración del backend:

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

La ruta es relativa al directorio de trabajo. Las herramientas de datos permanecen tal como
están, y `skills` se ubica junto a `tools` cuando un backend aporta las suyas propias.

- **Qué ve un cliente.** Los clientes en la revisión de protocolo 2026-07-28 o posterior
  (Claude Code, Claude) listan las skills y cargan una cuando es relevante.
  Claude Code nombra a cada una `<connector>:<skill>`. Estas se sirven a través
  de la extensión de skills de MCP (`io.modelcontextprotocol/skills`): `skills/list`,
  `skills/get`, y `resources/read` de `skill://<name>/…`. Cada skill viene
  con un manifiesto SHA-256 de sus archivos. El cliente verifica cada archivo contra
  ese manifiesto, y la aprobación de la persona queda vinculada a él.
- **Quién puede leerlas.** Cualquier conexión autenticada, independientemente de sus alcances.
  No incluyas nada en una skill que no sea apto para todos los que se conecten.
- **Cuándo cambian.** La carpeta se lee en la primera solicitud que la necesite,
  por lo que una edición surte efecto en el siguiente despliegue o reinicio. Un archivo que cambie en
  disco antes de ese momento se rechaza, no se sirve contra un manifiesto con el que ya no
  coincide.
- **Qué queda excluido.** Se omite cualquier skill que incumpla una regla, y el registro de inicio
  explica el motivo. Las reglas: no tener frontmatter, un nombre diferente al de su carpeta,
  un enlace simbólico en su interior, o más de 512 archivos o 16 MiB. Los archivos ocultos como
  `.gitkeep` nunca se sirven. Una skill que supere los límites propios de Claude Code (100 KB
  por archivo, 400 KB en total) se sirve con una advertencia, ya que Claude Code
  no la cargará.

El endpoint responde a ambas eras del protocolo. Un cliente de la era 2025 comienza con
`initialize`, como antes. Un cliente 2026-07-28 no envía saludo inicial (handshake). Cada solicitud
lleva su versión de protocolo y capacidades en `params._meta`, además de los
encabezados `MCP-Protocol-Version`, `Mcp-Method` y `Mcp-Name`, que deben coincidir
con el cuerpo. Sus capacidades provienen de `server/discover`. Las skills se
declaran únicamente allí.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
