---
sourceHash: d229f704b330854a
title: Herramientas de Studio
sidebar_label: Studio
description: Rebase Studio proporciona herramientas para desarrolladores para consultas SQL, scripts en JavaScript, gestión de directivas RLS, un diagrama de esquema y exploración de almacenamiento.
---

## Descripción general

Studio es la mitad para desarrolladores del panel de administración. La misma
aplicación que su equipo de contenido utiliza para editar filas también incluye
una consola SQL, un bloc de notas de JavaScript, un editor de directivas RLS, un
diagrama de esquema y un explorador de almacenamiento, y Studio es el modo que
los desbloquea. Nada que instalar y nada que desplegar: ya está en el panel,
detrás del interruptor en el menú lateral.

Existe porque la alternativa es un segundo conjunto de credenciales. De lo
contrario, editar una tabla, verificar qué permite realmente una directiva o
ejecutar una consulta en producción requiere un cliente de base de datos, una
copia de la cadena de conexión y un registro de auditoría que termina en
«alguien con psql». Studio hace todo esto como el administrador autenticado, a
través de la misma autorización que utiliza la API.

## Los dos modos

El panel tiene dos modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de contenido y equipos de operaciones. Muestra las tablas y la gestión de datos. Este es el modo predeterminado.
- **Studio** (`"studio"`) — Para desarrolladores. Desbloquea las herramientas siguientes.

Alterne entre ellos con el controlador de modo de administración o el interruptor
del menú lateral. El modo elegido se guarda en `localStorage` bajo
`rebase-admin-mode`; un navegador que haya usado el panel antes de la versión
0.17.0 conservará el valor antiguo `"content"` y se migrará a `"cms"` al leerlo.

## Herramientas integradas de Studio

El esquema de una tabla es código: `defineTable` en `backend/schema`, o —para un
proyecto que no declare ninguno— lo que contenga la base de datos, modificado
mediante SQL o una migración. Studio no tiene un editor visual de tablas; la
herramienta Collections que cumplía esa función fue eliminada, ya que las
columnas de una tabla y su presentación en el panel se desacoplaron, y un único
formulario para editar ambos ya no coincidía con ninguno. El editor de RLS
todavía guarda las directivas en `backend/schema` durante el desarrollo, a
través del mismo paso de planificar → confirmar → aplicar que la
[edición del esquema en vivo](/docs/backend/live-schema-editing/).

### Herramientas integradas

Cada herramienta que conoce el esquema lee las tablas que sirve el servidor desde
`GET /api/schema/tables`, con o sin el CMS en la página, por lo que Studio
funciona como la consola de un backend sin panel de administración. Frente a un
entorno de ejecución anterior a la versión 0.31, que no tiene dicha ruta, las
herramientas que reconocen el esquema indican que es necesario actualizar el
entorno en lugar de hacer suposiciones; frente a un backend sin autenticación, o
cuando la solicitud falla, cada una indica el motivo. La consola SQL, los
registros, el almacenamiento y las demás herramientas que no leen el esquema
funcionan independientemente.

Estas se incluyen con Studio y se **cargan de forma diferida mediante `RebaseStudio`**;
cada una es un fragmento independiente que se descarga la primera vez que se abre.
No se pueden importar por separado: `@rebasepro/studio` exporta deliberadamente
solo el orquestador, por lo que una consola que nunca se abre no consume recursos.

| Pestaña | Slug | Grupo | Qué hace |
|-----|------|-------|--------------|
| Tablas | `tables` | Base de datos | Crea y modifica tablas, columnas, índices y metadatos de tablas (`rebase.table_meta`) de PostgreSQL, edita filas directamente y expone tablas a través de REST, Realtime, OpenAPI y MCP sin necesidad de código |
| Editor SQL | `sql` | Base de datos | Ejecute SQL sin procesar en su base de datos PostgreSQL y lea los resultados en una tabla. La tabla muestra el resultado de la última instrucción, hasta sus primeras 10 000 filas o 32 MB de valores; un resultado más extenso indica cuántas filas hubo, y las opciones de copiar y exportar incluyen únicamente las filas mostradas. Dicho resultado también ofrece **Download full result as CSV**: el servidor transmite la totalidad del mismo a través de un cursor de solo lectura (`POST /api/admin/sql/csv`), una consulta a la vez, en un servidor Postgres propio en lugar de la base de datos de desarrollo en proceso. Los valores son el texto de la base de datos, tal como los muestra psql, y **Export JSON** los escribe de esa forma; **Export typed JSON** escribe cada valor leído según el tipo de su columna —los enteros y valores numéricos que un número JSON contiene de forma exacta, booleanos, `json`/`jsonb` como JSON— y mantiene cualquier otro valor como texto. En cada CSV (exportación, copia y descarga completa), un valor que una hoja de cálculo ejecutaría como fórmula (uno que comience con `=`, `+`, `-`, `@`, una tabulación o un retorno de carro, que no sea un número con signo) se escribe con un `'` inicial, tal como lo escribe la exportación de colecciones. Mientras una ejecución está en curso, **Cancel run** devuelve el control a la consola de inmediato; un servidor que admita la trama `CANCEL_SQL` del socket (lista `cancel_sql` en el `hello` con el que responde al socket) también detiene la instrucción con `pg_cancel_backend`. La base de datos de desarrollo en proceso no se puede interrumpir, y se deja que un servidor más antiguo termine la instrucción dentro de su `statement_timeout` |
| Políticas | `rls` | Base de datos | Inspeccione y gestione directivas de Row Level Security para sus tablas. La parte declarada es lo que el servidor compiló a partir del `rls` de cada tabla (servido a las entidades que poseen `schema:read`), comparado con `pg_policies` del mismo modo en que `rebase doctor` evalúa las discrepancias: una directiva se lista tal como la contiene la base de datos, marcada con **Differs from code** cuando no coincide con lo declarado en el proyecto, y una regla declarada que no está presente en la base de datos se lista como no aplicada. Una directiva generada por Rebase no se puede editar directamente en la base de datos, y en una tabla administrada por Rebase un banner advierte que cada inicio del servidor y `rebase db push` vuelven a aplicar las directivas declaradas. Quien consulte sin el permiso `schema:read` ve lo que contiene la base de datos y se le informa por qué no se muestra la declaración |
| Esquema | `schema-visualizer` | Base de datos | Diagrama de entidades de sus tablas y sus relaciones, generado a partir de los descriptores servidos: los nombres SQL, tipos de Postgres, nulabilidad, claves, valores de enumeración, claves foráneas y uniones se muestran tal como los declaran las tablas. Solo los marcadores de RLS se leen desde la base de datos. La disposición visual se ejecuta en un web worker, por lo que la página sigue respondiendo mientras se organiza un diagrama grande. Un esquema de más de 300 tablas se dibuja mostrando el entorno inmediato de una tabla a la vez —las tablas a una o dos relaciones de distancia— comenzando por la tabla más conectada; elija otra tabla en la lista para desplazarse |
| Ramas | `branches` | Base de datos | Cree y gestione [ramas de base de datos](/docs/backend/branching) y revise una como si fuera una pull request: sus cambios de esquema y directivas RLS lado a lado, las filas que insertó, actualizó y eliminó, y una fusión en la base de datos a partir de la cual se creó que indica qué prevalece primero; consulte [Revisión y fusión de una rama](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Copias de seguridad | `backups` | Base de datos | Explore y descargue copias de seguridad de la base de datos |
| Consola JS | `js` | Cómputo | Escriba y ejecute JavaScript a través del SDK de Rebase. Un script recibe `context.tables`, los descriptores servidos (anteriormente `context.collections`), y accede a una tabla como `client.data.<slug>` o `client.data.table("<slug>")` |
| Tareas programadas | `cron` | Cómputo | Inspeccione y gestione [tareas programadas](/docs/backend/cron-jobs), incluidos trabajos cron SQL y HTTP sin código |
| Almacenamiento | `storage` | Almacenamiento | Explore, suba y gestione archivos en sus backends de almacenamiento, y configure directivas declarativas de acceso al almacenamiento |
| API | `api` | API | Documentación interactiva de la API, con un ejecutor de solicitudes |
| Webhooks | `webhooks` | API | Configure y pruebe webhooks de base de datos activados por inserciones, actualizaciones y eliminaciones de filas |
| Registros | `logs` | API | Registro de solicitudes en vivo, más todo lo que el servidor reporte como advertencia o error; consulte más abajo |
| Usuarios y roles | `users` | Control de acceso | Gestione cuentas de usuario, asignaciones de roles y alcances de roles RBAC sin código |
| Claves de API | `api-keys` | Control de acceso | Cree y gestione claves de API de servicio con alcance limitado; los destinos de un alcance `data:*` son las tablas servidas |

### Qué muestra la vista de Logs

Dos flujos en un búfer circular en memoria, alojado en el proceso del servidor:

- **Cada solicitud**: método, ruta, estado, duración, el encabezado `X-Request-ID`,
  la tabla si la solicitud estaba relacionada con una y, si la solicitud falló, el
  `code` de error y el mensaje que recibió el cliente. Una solicitud fallida se
  registra como `warn` (4xx) o `error` (5xx), por lo que el filtro de nivel la
  encuentra. Su `source` se deriva de la ruta: `/api/auth/*` y `/api/oauth/*` son
  `auth`, `/api/storage/*` es `storage` y todo lo demás es `api`, de modo que el
  filtro de origen encuentra los inicios de sesión bajo Auth y las subidas de
  archivos bajo Storage.
- **Todo lo que el servidor reporta como advertencia o error**: una advertencia
  del esquema, un rechazo de autenticación, un diagnóstico del controlador, un
  fallo de arranque. El valor de `source` proviene del propio prefijo del mensaje
  (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), y cualquier elemento no
  reconocido se clasifica como `system`.

La actividad rutinaria de `info` se omite deliberadamente. El búfer circular
almacena 10 000 entradas y una oleada de respuestas `200` desplazaría lo que
usted abrió el panel para buscar.

Por lo tanto, una función personalizada que lance una excepción muestra su propio
mensaje aquí, junto a la solicitud que la llamó: el caso de uso para el que esto
existe.

El búfer circular es por proceso y por arranque: no es persistente, no se comparte
entre réplicas y un reinicio lo vacía. Para cualquier cosa que necesite
conservar, consulte la salida estándar (stdout) del proceso, que contiene las
mismas líneas y más.

El explorador lo indica así. Muestra el registro de la única instancia de servidor
que lo atiende e identifica esa instancia: el evento `snapshot` de
`GET /api/admin/logs/stream` incluye `instance`, el `HOSTNAME` del proceso (el
nombre del pod en Kubernetes, el identificador del contenedor en Docker) o bien
`pid-<n>`. No hay una vista combinada de todas las réplicas, ni de los procesos
`functions` y `worker` de un
[despliegue dividido](/docs/deployment/split-processes/). Una reconexión que
llegue a otra instancia reemplaza la ventana en lugar de mezclar ambos registros.

## Activación de Studio

Un solo componente, en cualquier lugar dentro de `<Rebase>`. No renderiza nada:
registra las herramientas y `<RebaseShell>` las dibuja:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Las herramientas aparecen en el menú lateral mientras el modo Studio está activo.
Si omite `<RebaseStudio>` por completo, distribuirá un CMS exclusivo para
contenido: sin modo Studio, sin interruptor y sin nada cargado de forma diferida.

## Agregar su propia herramienta

`devViews` sitúa sus propias vistas junto a las integradas. Son
[`AppView`](/docs/frontend#custom-views)s normales; lo único que convierte a una
en una herramienta de Studio en lugar de una vista del CMS es en qué componente
está registrada:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    icon: "ListOrdered",
    description: "Depth and failures, per queue",
    view: <QueuesView/>
};

<RebaseStudio devViews={[queues]}/>
```

| Registrado en | Aparece en | Para |
|---|---|---|
| `<RebaseCMS views>` | modo de contenido | lo que utilizan las personas que editan contenido |
| `<RebaseStudio devViews>` | modo Studio | lo que usted utiliza para operar el backend |

Una vista se incluye exactamente en uno de ellos: el menú lateral la clasifica
según cuál la registró, por lo que listar un slug en ambos la oculta del modo de
contenido.

Al igual que `tools`, la lista se lee por su *contenido*: definirla en línea es
seguro, y un nuevo renderizado del componente anfitrión no desmonta la
herramienta que esté en pantalla. Cambiar el nombre de una vista o modificar su
grupo sí la vuelve a registrar.

### Elegir qué herramientas aparecen

Omita `tools` y se registrarán todas las herramientas anteriores. Páselo para
registrar un subconjunto; por ejemplo, una consola alojada que tenga su propio
explorador de almacenamiento puede omitir esa herramienta:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, la herramienta Collections, ya no se acepta: la herramienta fue
eliminada.

La lista se lee por *contenido*, no por identidad, por lo que definirla en línea
es seguro: un nuevo renderizado del anfitrión no destruye ni desmonta la
herramienta que esté en pantalla.

## Próximos pasos

- **[Plugins](/docs/plugins)** — Amplíe el framework con plugins
- **[Tablas](/docs/schema/)** — Declaración de las tablas que lee Studio
- **[Personalización de una tabla](/docs/frontend/customize-table/)** — Cómo las muestra el panel
