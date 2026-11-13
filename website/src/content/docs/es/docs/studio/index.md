---
sourceHash: 7f137cdb15196a3e
title: Herramientas de Studio
sidebar_label: Studio
description: Rebase Studio proporciona herramientas de desarrollo para la edición visual de esquemas, consultas SQL, scripting en JavaScript, gestión de políticas RLS y exploración de almacenamiento.
---

## Descripción general

Studio es la mitad para desarrolladores del panel de administración. La misma
aplicación que su equipo de contenido utiliza para editar filas también incluye
un editor de esquemas, una consola SQL, un bloc de notas de JavaScript, un
explorador de políticas RLS y un explorador de almacenamiento, y Studio es el
modo que los desbloquea. Nada que instalar y nada que desplegar: ya está en el
panel, detrás del conmutador en el drawer.

![El editor de colecciones, la herramienta insignia de Studio: un editor visual de esquemas que vuelve a escribir su TypeScript](/img/collection_editor.png)

Existe porque la alternativa es un segundo conjunto de credenciales. De lo
contrario, editar una tabla, verificar qué permite realmente una política o
ejecutar una consulta en producción implica un cliente de base de datos, una
copia de la cadena de conexión y un registro de auditoría que termina en
«alguien con psql». Studio hace todo esto como el administrador autenticado, a
través de la misma autorización que utiliza la API.

## Los dos modos

El panel tiene dos modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de contenido y equipos de operaciones. Muestra las tablas y la gestión de datos. Este es el predeterminado.
- **Studio** (`"studio"`) — Para desarrolladores. Desbloquea las herramientas siguientes.

Alterne entre ellos con el controlador de modo de administración o el
conmutador del drawer. El modo elegido se persiste en `localStorage` bajo
`rebase-admin-mode`; un navegador que haya utilizado el panel antes de la
versión 0.17.0 conservará el valor antiguo `"content"` y se migrará a `"cms"`
al leerlo.

## Herramientas integradas de Studio

### Editor de colecciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un editor visual para una tabla y cómo la muestra el panel. El guardado se divide en dos:

- **Hechos del esquema (Schema facts)** — el tipo de una columna, nulabilidad,
  valor predeterminado, validación, valores de enumeración, almacenamiento,
  relaciones, reglas, descripción, historial — se convierten en ediciones
  `TablePatch` que el editor de esquemas del servidor escribe en
  `backend/schema/<table>.ts` con [ts-morph](https://ts-morph.com/), modificando
  únicamente el código que la edición especifica y dejando el resto del archivo
  tal como estaba: importaciones, comentarios, formato, hooks, columnas
  compartidas. Una edición que afecta a código directo —una columna construida
  mediante un helper, reglas contenidas en una variable— es rechazada indicando
  el lugar donde debe realizarse. Una regla que no se modifique se devuelve
  exactamente como se entregó, por lo que el nombre de su política nunca cambia.
  Consulte [Edición de esquemas en vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch).
- **Presentación** — etiquetas, icono, modos de visualización, orden de
  columnas, columnas ocultas, anchos, etiquetas y colores de enumeraciones,
  kanban, valores predeterminados de consulta — es una preferencia de UI, nunca
  una edición de esquema. Las de un administrador son las del espacio de trabajo:
  donde el servidor pueda escribir en el código fuente del proyecto van a
  `frontend/src/cms/ui-config.json`, y en un despliegue van a la tabla
  `rebase.ui_preferences`, a través de `/api/admin/ui-config`. Los cambios de
  tamaño y cambios de vista propios de un usuario le pertenecen a él.

Un cambio de slug, tabla SQL o base de datos se rechaza como una migración. Una
tabla cuyas reglas provienen de `defaultRls` solicita confirmación antes de
adoptar reglas propias. Quien realiza la llamada y recibe reglas censuradas
(redacted) obtiene un editor de solo lectura. Un guardado que el servidor no
puede compilar enumera cada problema junto al campo correspondiente, y no se
escribe nada. Un archivo modificado en disco desde que el editor lo leyó ofrece
una opción de recarga en lugar de sobrescribir el cambio (`SCHEMA_EDIT_STALE_FILE`).
Un campo cuya definición está construida en código —un helper, una variable
compartida— se muestra como de solo lectura, indicando el motivo. El orden de
las columnas es únicamente de presentación: reordenar nunca mueve una columna
en la tabla. Es la captura de pantalla que encabeza esta página.

**Importar una tabla existente.** Una tabla que la base de datos contiene y que
`backend/schema` no declara aparece listada bajo «Import an existing table»;
seleccionar una escribe su archivo `defineTable` exactamente como lo describe
la base de datos —columnas, claves, índices, seguridad a nivel de fila
(row-level security)— mediante la edición `adoptTable`. La adopción no cambia
nada en la base de datos: no planifica ningún DDL, y el primer paso de política
vuelve a crear una política idéntica una sola vez para estamparla. La postura de
seguridad a nivel de fila nunca se reduce: una tabla con RLS desactivado, o sin
políticas, se adopta como `rls: "admin-only"`, y el diálogo así lo indica. No
se puede adoptar una tabla sin clave primaria. Las rutas son
`GET /api/admin/schema-editor/unmapped-tables` y
`GET /api/admin/schema-editor/unmapped-tables/:schema/:table`.

**Colecciones de Firestore.** En desarrollo, el editor de colecciones también
edita colecciones de Firestore: al guardar, se reescribe in situ la llamada
`defineFirestoreCollection({...})` de la colección en `frontend/src/cms`,
modificando únicamente lo que editó. Las funciones, componentes personalizados,
comentarios e importaciones se conservan tal como se escribieron; los campos
definidos en código se muestran como de solo lectura. En producción, las
colecciones de Firestore son de solo lectura en el editor. Crear una o cambiar
su slug se realiza en el código; para eliminar una, elimine su archivo y su
entrada en `externalCollections`.

El editor está activo dondequiera que Studio esté montado: el `<RebaseStudio/>`
de un scaffold es suficiente y no hay que añadir ninguna prop. `collectionEditor`
sirve para ajustarlo en lugar de para activarlo:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio is mounted, so the Collection Editor is available. Nothing else
// is needed for it.
<Rebase>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` is for fine-tuning — a read-only editor, a different
// token — not for opting in.
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

El que un *guardado* se aplique es decisión del servidor, no del panel: el
editor reescribe `backend/schema`, por lo que está desactivado bajo
`NODE_ENV=production` (a menos que la [edición de esquemas en vivo](/docs/backend/live-schema-editing/)
especifique un repositorio), en modo `baas`, y en un servidor sin `schemaDir`.
El panel consulta `GET /api/admin/schema-editor/status` y muestra el motivo
devuelto junto al botón deshabilitado.

### Herramientas integradas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada herramienta que conoce el esquema lee las tablas que sirve el servidor
desde `GET /api/schema/tables`, con o sin el CMS en la página — por lo que
Studio funciona como la consola de un backend sin panel de administración.
Frente a un runtime anterior a 0.31, que no dispone de dicha ruta, las
herramientas compatibles con esquemas indican que el runtime necesita
actualizarse en lugar de asumir suposiciones; frente a un backend sin
autenticación, o cuando la solicitud falla, cada una indica cuál es el problema.
La consola SQL, los registros (logs), el almacenamiento y las demás herramientas
que no leen el esquema funcionan independientemente.

Estas vienen incluidas con Studio y se **cargan de forma diferida (lazy-loaded)
mediante `RebaseStudio`** — cada una es un fragmento (chunk) independiente,
obtenido la primera vez que se abre. No son importables por separado:
`@rebasepro/studio` exporta deliberadamente solo el orquestador, de modo que una
consola que nunca abra no tenga coste alguno.

| Pestaña | Slug | Grupo | Qué hace |
|-----|------|-------|--------------|
| SQL Console | `sql` | Database | Ejecute SQL sin procesar contra su base de datos PostgreSQL y lea los resultados en una tabla. La tabla muestra el resultado de la última sentencia, hasta sus primeras 10,000 filas o 32 MB de valores; un resultado más extenso indica cuántas filas hubo, y copiar y exportar incluyen únicamente las filas mostradas. Dicho resultado también ofrece **Download full result as CSV**: el servidor transmite la totalidad a través de un cursor de solo lectura (`POST /api/admin/sql/csv`), una consulta a la vez, en un servidor Postgres propio en lugar de la base de datos de desarrollo en proceso. Los valores son el texto de la base de datos, tal como los muestra psql, y **Export JSON** los escribe así; **Export typed JSON** escribe cada valor leído según el tipo de su columna —enteros y numéricos que un número JSON admite con exactitud, booleanos, `json`/`jsonb` como JSON— y mantiene cualquier otro valor como texto. En cada CSV (exportación, copia y descarga completa), cualquier valor que una hoja de cálculo ejecutaría como fórmula (uno que comience con `=`, `+`, `-`, `@`, un tabulador o un retorno de carro, que no sea un número con signo) se escribe con un `'` inicial, tal como lo escribe la exportación de colecciones. Mientras una ejecución está en curso, **Cancel run** devuelve el control a la consola de inmediato; un servidor que acepte la trama `CANCEL_SQL` del socket (lista `cancel_sql` en el `hello` con el que responde al socket) también detiene la sentencia con `pg_cancel_backend`. La base de datos de desarrollo en proceso no se puede interrumpir, y se permite que un servidor más antiguo termine la sentencia dentro de su `statement_timeout` |
| RLS Policies | `rls` | Database | Inspeccione y gestione las políticas de seguridad a nivel de fila (Row Level Security) para sus tablas. La parte declarada es lo que el servidor compiló a partir del `rls` de cada tabla (servido a quienes poseen `schema:read`), en comparación con `pg_policies` de la forma en que `rebase doctor` evalúa la desviación (drift): una política se lista tal como la tiene la base de datos, con la insignia **Differs from code** cuando difiere de lo que el proyecto declara, y una regla declarada que no está presente en la base de datos se lista como no aplicada. Una política generada por Rebase no se puede editar directamente en la base de datos, y en una tabla administrada por Rebase un banner indica que cada inicio del servidor y cada `rebase db push` vuelven a aplicar las políticas declaradas. Quien realice la llamada sin `schema:read` ve lo que contiene la base de datos y se le informa por qué no se muestra la declaración |
| Schema Visualizer | `schema-visualizer` | Database | Diagrama de entidad-relación de sus tablas y sus relaciones, generado a partir de los descriptores servidos: nombres SQL, tipos de Postgres, nulabilidad, claves, valores de enumeración, claves foráneas y uniones son tal como los declaran las tablas. Solo los marcadores de RLS se leen de la base de datos. El diseño se ejecuta en un web worker, por lo que la página sigue respondiendo mientras se organiza un diagrama extenso. Un esquema de más de 300 tablas se dibuja mostrando el entorno de una tabla a la vez —las tablas a una o dos relaciones de distancia—, comenzando por la tabla más conectada; seleccione otra tabla en la lista para desplazarse |
| Branches | `branches` | Database | Cree y gestione [ramas de base de datos](/docs/backend/branching), y revise una de ellas como si fuera una pull request: los cambios de su esquema y políticas RLS lado a lado, las filas insertadas, actualizadas y eliminadas, y una fusión (merge) en la base de datos de origen que define qué tiene prioridad — consulte [Revisar y fusionar una rama](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Explore y descargue copias de seguridad de la base de datos |
| Logs Explorer | `logs` | Database | Registro de solicitudes en vivo, además de todo lo que el servidor reporta como advertencia (warn) o error — consulte más abajo |
| JS Console | `js` | Compute | Escriba y ejecute JavaScript a través del SDK de Rebase. Un script recibe `context.tables`, los descriptores servidos (anteriormente `context.collections`), y accede a una tabla mediante `client.data.<slug>` o `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Compute | Inspeccione y gestione [tareas programadas](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Explore, suba y gestione archivos a través de sus backends de almacenamiento |
| API Explorer | `api` | API | Documentación interactiva de la API, con un ejecutor de solicitudes |
| API Keys | `api-keys` | Access Control | Cree y gestione claves de API de servicio con ámbito (scoped); los destinos de un ámbito `data:*` son las tablas servidas |

### Qué muestra el Explorador de logs

Dos secuencias (streams) en un búfer circular en memoria, alojado en el proceso del servidor:

- **Cada solicitud** — método, ruta, estado, duración, el encabezado `X-Request-ID`,
  la tabla en caso de que la solicitud estuviera relacionada con una y, si la
  solicitud falló, el `code` de error y el mensaje que recibió el cliente. Una
  solicitud fallida se registra como `warn` (4xx) o `error` (5xx), de modo que
  el filtro de nivel pueda encontrarla.
  Su `source` proviene de la ruta: `/api/auth/*` y `/api/oauth/*` son `auth`,
  `/api/storage/*` es `storage`, y todo lo demás es `api`, por lo que el filtro
  de origen (Source) encuentra los inicios de sesión bajo Auth y las subidas
  bajo Storage.
- **Todo lo que el servidor reporta como warn o error** — una advertencia de
  esquema, un rechazo de autenticación, un diagnóstico del controlador (driver),
  un fallo de arranque. `source` proviene del propio prefijo del mensaje
  (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), y cualquier cosa no reconocida
  es `system`.

La actividad rutinaria de nivel `info` se excluye deliberadamente. El búfer
circular contiene 10,000 entradas y una oleada de códigos `200` desalojaría lo
que usted abrió el panel para encontrar.

Por lo tanto, una función personalizada que lance un error muestra aquí su
propio mensaje, asociado a la solicitud que la llamó —el caso para el que esto
existe.

El búfer circular es por proceso y por arranque: no es persistente, no se
comparte entre réplicas y un reinicio lo vacía. Para cualquier cosa que necesite
conservar, consulte la salida estándar (stdout) del proceso, que incluye las
mismas líneas y más.

El explorador así lo indica. Muestra el registro de la única instancia de
servidor que lo está sirviendo y nombra dicha instancia: el evento `snapshot`
de `GET /api/admin/logs/stream` incluye `instance`, el `HOSTNAME` del proceso
(el nombre del pod en Kubernetes, el ID del contenedor en Docker) o bien
`pid-<n>`. No hay una vista agregada entre réplicas, ni de los procesos
`functions` y `worker` de un [despliegue dividido](/docs/deployment/split-processes/).
Una reconexión que recaiga en otra instancia reemplaza la ventana en lugar de
mezclar ambos registros.

El **Editor de colecciones** también es una herramienta de Studio, pero no
figura en esta lista porque se registra de forma diferente: `RebaseStudio` no la
carga de forma diferida. El panel lo monta dondequiera que Studio y el CMS estén
registrados, ya que, a diferencia de las herramientas anteriores, edita tanto la
presentación que dibuja el CMS como el esquema. Se trata de una diferencia en la
forma en que se monta, no en lo que es: edita el esquema y pertenece al mismo
espacio que los editores de SQL y RLS.

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

Las herramientas aparecen en el drawer mientras el modo Studio está activo.
Omita `<RebaseStudio>` por completo y distribuirá un CMS exclusivo de contenido:
sin modo Studio, sin selector y sin nada cargado de forma diferida.

## Añadir su propia herramienta

`devViews` coloca sus propias vistas junto a las integradas. Son
[`AppView`](/docs/frontend#custom-views)s ordinarias — lo único que convierte
a una en herramienta de Studio en lugar de una vista del CMS es el componente
en el que está registrada:

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
| `<RebaseCMS views>` | modo de contenido | elementos que utilizan las personas que editan contenido |
| `<RebaseStudio devViews>` | modo Studio | elementos que usted utiliza para operar el backend |

Una vista pertenece exactamente a uno de ellos: el drawer clasifica según cuál
lo haya registrado, por lo que incluir un slug en ambos lo oculta del modo de
contenido.

Al igual que `tools`, la lista se lee por su *contenido*: escribirla en línea
(inline) es seguro, y un nuevo renderizado del componente anfitrión no desmonta
la herramienta que esté en pantalla. Renombrar una vista o cambiar su grupo sí
vuelve a registrarla.

### Elegir qué herramientas aparecen

Omita `tools` y se registrarán todas las herramientas mencionadas arriba. Páselo
para registrar un subconjunto; por ejemplo, una consola alojada que ya tenga su
propio explorador de almacenamiento puede omitir esa herramienta:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

La vista de Studio del Editor de colecciones es la herramienta `"schema"`. Si
omite `tools`, estará disponible; si pasa una lista sin `"schema"`, como se
muestra arriba, quedará excluida.

La lista se lee por su *contenido*, no por su identidad, por lo que escribirla
en línea es seguro: un nuevo renderizado del host no destruye ni desmonta la
herramienta que esté en pantalla.

## Siguientes pasos

- **[Plugins](/docs/plugins)** — Amplíe el framework con plugins
- **[Tablas](/docs/schema/)** — Declaración de las tablas que lee Studio
- **[Personalizar una tabla](/docs/frontend/customize-table/)** — Cómo las muestra el panel
