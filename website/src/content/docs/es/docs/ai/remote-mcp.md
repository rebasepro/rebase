---
sourceHash: 166fe94f399384db
title: El endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Sirve MCP desde un backend desplegado en /mcp, para que las personas que usan tu aplicación puedan conectar Claude o Cursor como ellas mismas — OAuth con pantalla de consentimiento, nueve herramientas bajo tres alcances, cada llamada bajo su propia seguridad a nivel de fila.
---

:::tip[¿Conectar Claude a tus propios proyectos?]
Ese es el [conector de Rebase](/docs/ai/rebase-connector/): un solo conector para
todos ellos, y un servidor autohospedado se une a él con `rebase cloud connect`. Esta
página es para las personas que **usan** tu aplicación.
:::

El [servidor MCP](/docs/ai/mcp/) es una herramienta para desarrolladores: se ejecuta en tu máquina y contiene una clave de servicio
o una clave de API. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan tu aplicación. Un asistente que una de ellas conecte lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila (RLS).

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # el origen real de este despliegue
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un driver de datos que pueda delimitar el alcance de una consulta
a un solo usuario, el endpoint se niega a montarse y explica el motivo en el registro de inicio. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro dinámico
  está activado por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que registres), y envía a la persona a una pantalla de consentimiento que inicia
  su sesión a través de tu `/auth/login` existente. A una cuenta con un segundo factor
  se le solicita entonces su código de autenticador o un código de recuperación, a través de las
  rutas existentes de `/auth/mfa/challenge`. Cuando el propio frontend de tu aplicación
  mantiene una sesión en el mismo navegador, la pantalla ofrece esa cuenta y
  "Permitir" da su consentimiento como ella sin contraseña; así es como se conecta alguien que inicia sesión únicamente
  con Google, GitHub o un enlace de correo electrónico. De lo contrario, inicia sesión con una
  contraseña, y alguien que no tenga una primero establece una con `/auth/forgot-password`
  ("Olvidé mi contraseña" de tu aplicación); la pantalla se lo indica. También nombra el host al que se envía el código de autorización
  y advierte que ese host no está verificado: cualquiera puede registrar un cliente bajo
  cualquier nombre, por lo que el host es la parte que una persona puede comprobar.
- **Doce herramientas, tres alcances.** Los mismos [alcances (scopes)](/docs/backend/roles-and-scopes/)
  que utiliza cada credencial. `data:read` ofrece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` y las tres vistas,
  `show_collection`, `show_record` y `show_app`; `data:write` añade `create_document` y
  `update_document`; `data:delete` añade `delete_document`. Un cliente que no solicite
  nada obtiene `data:read`. Cada uno se puede limitar a una colección: `data:read:posts`
  lista, describe y lee `posts` y nada más. Un alcance decide qué herramientas se
  ofrecen y a qué colecciones acceden, no qué filas: una lista vacía puede ser
  señal de RLS funcionando, y `data:write` aún no podrá escribir una fila que la persona no pudiera.
- **Tres herramientas ponen tu panel de administración frente a la persona.** En un cliente que
  renderiza MCP Apps, como Claude, abren las propias vistas del panel de administración en la
  conversación, generadas a partir de tus colecciones: sus campos, enums, validaciones,
  relaciones, secciones de formulario y ajustes de vista.
  - `show_collection` toma los argumentos de `query_collection`, más `view`
    (`table`, `list`, `cards` o `kanban`), y abre la vista de la colección: la
    persona puede buscar, filtrar, ordenar y paginar, abrir el formulario de una fila y añadir filas.
  - `show_record` abre el formulario de una fila (`id`), o un formulario para una nueva fila que
    comienza a partir de los `values` que rellenó el modelo, para que la persona los compruebe y
    guarde por sí misma.
  - `show_app` ejecuta una aplicación que el modelo escribe para la tarea en cuestión: un componente
    de React (`code`) y las `collections` que lee. Importa los paquetes propios de
    Rebase, por lo que el mismo código funciona en tu proyecto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      y `useRowWrites` sobre las filas del proyecto;
    - `@rebasepro/cms`: el `CollectionPanel` del panel de administración (con
      `CollectionToolbar` y sus piezas, y `onRowClick`, que pasa a la
      aplicación la fila seleccionada tal como la lee `useRows`), `EntityFormPanel` y `FormField`,
      `EntityViewPanel`, `FieldValue`, `useSidePanel` y
      `useCollectionRegistryController`, con tus campos, vistas y
      acciones personalizados;
    - `@rebasepro/ui`, todo el kit de UI, incluyendo `SplitView` y las tarjetas de KPI y
      gráficos.

    El servidor lo compila primero, por lo que un error de sintaxis, un módulo que la vista no
    sirva o un nombre que no sirva desde `@rebasepro/cms` o
    `@rebasepro/app` constituirá el error de la llamada, con su número de línea. Un error mientras se
    ejecuta se muestra en su lugar y se comunica al modelo con el siguiente
    mensaje de la persona. Una aplicación solo puede usar las colecciones que enumere. Sus estilos son
    las utilidades estándar de Tailwind, compiladas con la vista antes de que llegue cualquier
    aplicación: un valor arbitrario como `h-[560px]` no hace nada allí, por lo que un
    tamaño exacto debe ser un `style`.

  Cada lectura y guardado en la vista es una de las llamadas de las herramientas de lectura y escritura,
  realizada como la persona bajo su RLS, por lo que un formulario ofrece solo lo que se le
  concedió a su conexión: sin `data:write` es de solo lectura, y un campo que
  sus roles no puedan leer no aparece en él. En la pantalla de una aplicación, un cambio que su código
  realice a través de `useRowWrites` se muestra a la persona para que lo confirme antes de
  enviarse, ya que el código puede escribir sin un clic; un cambio que ella realice con los
  propios controles del administrador (el Guardar de un formulario, una eliminación, una edición en tabla) es suyo y
  no se vuelve a consultar. Se informa al modelo de lo que cambió. Este lee las filas que responde cada herramienta, no las configuraciones de colección con las que
  se dibuja la vista. Un cliente sin MCP Apps, como Claude Code o Cursor, no muestra nada,
  y el modelo lee las mismas filas que obtendría de `query_collection`.
- **Las concesiones realizadas antes de la versión 0.24 mantienen su alcance.** `mcp:read` se interpreta como
  `data:read`, y `mcp:write` como `data:write data:delete`, tanto en las concesiones almacenadas como
  en los tokens ya emitidos.
- **Una clave de API también funciona.** `/mcp` también acepta `Authorization: Bearer rk_…`, para
  un cliente configurado con un encabezado en lugar de un flujo de OAuth. La clave accede a
  las herramientas que cubren sus alcances `data:*`, actuando como quien represente: una
  [clave personal](/docs/backend/api-keys/#personal-keys) como su propietario, una clave de servicio
  como `api-key:<id>`.
- **El vocabulario del SDK, las respuestas de REST.** Las herramientas aceptan lo que acepta el SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, y `data` para una
  escritura — y leen a través de la ruta `GET /api/data/<collection>`, por lo que una fila se devuelve
  como la sirve REST (fechas ISO, un `belongsTo` como su clave foránea, ej.
  `authorId`) y puede enviarse de vuelta en una actualización sin cambios. `query_collection`
  responde `{ data, meta }` con `meta.total` y `meta.hasMore`, y `count_documents`
  `{ count }`. `aggregate_documents` es `GET /api/data/<collection>/aggregate`:
  `select` es una lista en la gramática de REST (`["count()", "sum(total)"]`), `groupBy`
  una lista de campos, y responde `{ data }` con una fila por grupo, más
  `meta.hasMore` en una llamada agrupada, cuyos grupos se paginan con `limit` y `offset`
  y se ordenan con `orderBy`. En una colección que un callback `afterRead` reescribe,
  sirve `count()` únicamente, tal como lo hace REST. Al igual que en REST, se rechaza un `limit` superior a 1000, un argumento no declarado y una
  edición o eliminación de una fila en la papelera (404); establecer el campo de borrado
  lógico en `null` la restaura. `deleted: "only"` (o `"include"`) en
  `query_collection`, `count_documents` y `aggregate_documents` lee la papelera, al igual que hace
  `?deleted=` en REST, para que una fila que `delete_document` envió a la papelera pueda encontrarse de nuevo para
  restaurarla. Su descripción indica al modelo que la eliminación es permanente solo cuando
  la colección no tiene un campo de borrado lógico.
- **El listado nombra las colecciones; `describe_collection` proporciona el esquema de una de ellas.**
  `list_collections` responde con el `name`, `title` y `description` de cada colección,
  y `describe_collection { collection }` con los esquemas OpenAPI `row` y
  `create` de esa colección, más `softDeleteField` en caso de que las filas vayan a una papelera. Las descripciones
  de las herramientas indican al modelo que describa una colección antes de escribir en ella. El listado
  de un proyecto de 200 colecciones ocupa unos 5k tokens, y cada descripción
  menos de 1k; con todos los esquemas en el listado superaba los 150k.
- **Un token solo para este endpoint.** `/api/data`, `/api/admin` y el WebSocket rechazan
  un token de acceso de MCP, por lo que conectar un asistente no
  le otorga una sesión.

Cada solicitud a `/mcp` vuelve a leer la cuenta de la persona. Una cuenta eliminada o
deshabilitada, o una acción de "cerrar sesión en todas partes" o cambio de contraseña tras la emisión
del token, detiene inmediatamente a un cliente conectado con un 401. Una degradación de permisos se aplica en su
siguiente llamada a una herramienta. Cada renovación realiza las mismas comprobaciones y rechaza definitivamente
dicha concesión. Una sesión de invitado no puede dar consentimiento en absoluto.

Una limitación: Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la
propia sesión de la persona) revoca sus tokens de actualización de inmediato, pero un token de acceso
ya emitido sigue funcionando hasta que caduque, en un plazo de una hora.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).
