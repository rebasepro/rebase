---
sourceHash: 042c679d9fdfa2aa
title: Herramientas de Studio
sidebar_label: Studio
description: Rebase Studio proporciona herramientas para desarrolladores para consultas SQL, scripts en JavaScript, gestión de políticas RLS, un diagrama de esquema y exploración de almacenamiento.
---

## Descripción general

Studio es la mitad para desarrolladores del panel de administración. La misma
aplicación que su equipo de contenido utiliza para editar filas también incluye
una consola SQL, un scratchpad de JavaScript, un editor de políticas RLS, un
diagrama de esquemas y un explorador de almacenamiento — y Studio es el modo
que los desbloquea. No hay nada que instalar ni nada que desplegar: ya está en
el panel, detrás del selector en el drawer.

Existe porque la alternativa es un segundo conjunto de credenciales. Editar una
tabla, comprobar lo que realmente permite una política o ejecutar una consulta
contra producción significa, de otro modo, un cliente de base de datos, una copia
de la cadena de conexión y un registro de auditoría que termina en «alguien con
psql». Studio hace todo esto como el administrador que ha iniciado sesión, a
través de la misma autorización que utiliza la API.

## Los dos modos

El panel tiene dos modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de contenido y equipos de operaciones. Muestra las tablas y la gestión de datos. Este es el modo predeterminado.
- **Studio** (`"studio"`) — Para desarrolladores. Desbloquea las herramientas a continuación.

Alterne entre ellos con el controlador de modo de administración o el interruptor
del drawer. El modo elegido se guarda en `localStorage` bajo `rebase-admin-mode`;
un navegador que haya utilizado el panel antes de la versión 0.17.0 conservará el
valor antiguo `"content"` y se migrará a `"cms"` al leerlo.

## Herramientas integradas de Studio

El esquema de una tabla es código: `defineTable` en `backend/schema`, o — para un
proyecto que no declare ninguno — lo que contenga la base de datos, modificado
mediante SQL o una migración. Studio no tiene un editor visual de tablas; la
herramienta Collections que antes lo era fue eliminada, debido a que las
columnas de una tabla y su presentación en el panel se desacoplaron y un único
formulario editando ambos ya no encajaba con ninguno. El editor de RLS todavía
guarda políticas en `backend/schema` en desarrollo, a través del mismo paso
planificar → confirmar → aplicar que la
[edición de esquema en vivo](/docs/backend/live-schema-editing/).

### Herramientas integradas

Cada herramienta que reconoce el esquema lee las tablas que sirve el servidor desde
`GET /api/schema/tables`, con o sin el CMS en la página — por lo que Studio
funciona como la consola de un backend sin panel de administración. Frente a un
runtime anterior a 0.31, que no tiene dicha ruta, las herramientas que reconocen el
esquema indican que el runtime necesita actualizarse en lugar de suponerlo;
frente a un backend sin autenticación, o cuando la solicitud falla, cada una
indica cuál es el problema. La consola SQL, los logs, el almacenamiento y las
demás herramientas que no leen el esquema funcionan de todos modos.

Estas se incluyen con Studio y se **cargan de forma diferida (lazy-loaded) mediante `RebaseStudio`** —
cada una es un fragmento independiente, obtenido la primera vez que se abre. No
se pueden importar por sí solas: `@rebasepro/studio` exporta deliberadamente solo
el orquestador, por lo que una consola que nunca abra no cuesta nada.

| Pestaña | Slug | Grupo | Qué hace |
|-----|------|-------|--------------|
| Tables | `tables` | Database | Cree y modifique tablas, columnas, índices y metadatos de tablas de PostgreSQL (`rebase.table_meta`), edite filas directamente y exponga tablas a través de REST, Realtime, OpenAPI y MCP sin código |
| SQL Console | `sql` | Database | Ejecute SQL sin procesar contra su base de datos PostgreSQL y lea los resultados en una tabla. La tabla muestra el resultado de la última sentencia, hasta sus primeras 10.000 filas o 32 MB de valores; un resultado más extenso indica cuántas filas había, y la copia y exportación incluyen únicamente las filas mostradas. Dicho resultado también ofrece **Download full result as CSV**: el servidor transmite la totalidad del mismo a través de un cursor de solo lectura (`POST /api/admin/sql/csv`), una consulta a la vez, en un servidor Postgres propio en lugar de la base de datos de desarrollo en proceso. Los valores son el texto de la base de datos, tal como los muestra psql, y **Export JSON** los escribe de ese modo; **Export typed JSON** escribe cada valor leído según el tipo de su columna — enteros y numéricos que un número JSON contiene de forma exacta, booleanos, `json`/`jsonb` como JSON — y mantiene cualquier otro valor como texto. En cada CSV (exportación, copia y descarga completa), un valor que una hoja de cálculo ejecutaría como fórmula (uno que comience con `=`, `+`, `-`, `@`, una tabulación o un retorno de carro, que no sea un número con signo) se escribe con un `'` inicial, tal como lo escribe la exportación de colecciones. Mientras una ejecución está en curso, **Cancel run** devuelve el control a la consola de inmediato; un servidor que acepta la trama `CANCEL_SQL` del socket (lista `cancel_sql` en el `hello` con el que responde al socket) también detiene la sentencia con `pg_cancel_backend`. La base de datos de desarrollo en proceso no se puede interrumpir, y un servidor más antiguo se deja para que finalice la sentencia dentro de su `statement_timeout` |
| RLS Policies | `rls` | Database | Inspeccione y gestione las políticas de Row Level Security para sus tablas. El lado declarado es lo que el servidor compiló a partir del `rls` de cada tabla (servido a los clientes que posean `schema:read`), comparado con `pg_policies` de la forma en que `rebase doctor` evalúa el desfase (drift): una política se lista tal como la contiene la base de datos, marcada con la etiqueta **Differs from code** cuando no coincide con lo que declara el proyecto, y una regla declarada de la que carece la base de datos se lista como no aplicada. Una política generada por Rebase no se puede editar directamente en la base de datos, y en una tabla gestionada por Rebase un banner indica que cada inicio del servidor y cada `rebase db push` vuelven a aplicar las políticas declaradas. Un llamador sin `schema:read` ve lo que contiene la base de datos y se le explica por qué no se muestra la declaración |
| Schema Visualizer | `schema-visualizer` | Database | Diagrama de entidades de sus tablas y sus relaciones, trazado a partir de los descriptores servidos: los nombres SQL, tipos de Postgres, nulabilidad, claves, valores de enum, claves foráneas y uniones son tal como los declaran las tablas. Solo los marcadores de RLS se leen desde la base de datos. La disposición (layout) se ejecuta en un web worker, por lo que la página sigue respondiendo mientras se organiza un diagrama grande. Un esquema de más de 300 tablas se dibuja de acuerdo con el entorno de una tabla a la vez — las tablas a una o dos relaciones de distancia —, comenzando por la tabla más conectada; elija otra tabla de la lista para desplazarse |
| Branches | `branches` | Database | Cree y gestione [ramas de base de datos](/docs/backend/branching), y revise una como si fuera un pull request: sus cambios de esquema y políticas RLS lado a lado, las filas que insertó, actualizó y eliminó, y una fusión en la base de datos a partir de la cual se creó que indica qué prevalece primero — consulte [Revisión y fusión de una rama](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Explore y descargue copias de seguridad de la base de datos |
| Logs Explorer | `logs` | Database | Registro de solicitudes en vivo, además de todo lo que el servidor reporta con nivel warn o error — consulte más abajo |
| JS Console | `js` | Compute | Escriba y ejecute JavaScript a través del SDK de Rebase. Un script recibe `context.tables`, los descriptores servidos (anteriormente `context.collections`), y accede a una tabla como `client.data.<slug>` o `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Compute | Inspeccione y gestione [tareas programadas](/docs/backend/cron-jobs), incluyendo trabajos cron SQL y HTTP sin código |
| Storage | `storage` | Storage | Explore, suba y gestione archivos a través de sus backends de almacenamiento, y configure políticas declarativas de acceso al almacenamiento |
| API Explorer | `api` | API | Documentación interactiva de la API, con un ejecutor de solicitudes |
| Webhooks | `webhooks` | API | Configure y pruebe webhooks de base de datos activados por inserciones, actualizaciones y eliminaciones de filas |
| Users & Roles | `users` | Access Control | Gestione cuentas de usuario, asignaciones de roles y alcances de roles RBAC sin código |
| API Keys | `api-keys` | Access Control | Cree y gestione claves de API de servicio con alcance específico; los destinos de un alcance `data:*` son las tablas servidas |

### Qué muestra el Logs Explorer

Dos flujos en un búfer circular en memoria (ring), alojado en el proceso del servidor:

- **Cada solicitud** — método, ruta, estado, duración, el encabezado `X-Request-ID`, la
  tabla cuando la solicitud estaba relacionada con una y, cuando la solicitud falló, el
  `code` de error y el mensaje que recibió el cliente. Una solicitud fallida se registra como
  `warn` (4xx) o `error` (5xx), por lo que el filtro de nivel la encuentra.
  Su `source` proviene de la ruta: `/api/auth/*` y `/api/oauth/*` son
  `auth`, `/api/storage/*` es `storage`, y todo lo demás es `api`, de modo que el
  filtro de origen (Source) encuentra inicios de sesión en Auth y subidas en Storage.
- **Todo lo que el servidor reporta como warn o error** — una advertencia de esquema, un
  rechazo de autenticación, un diagnóstico del controlador (driver), un fallo de arranque.
  `source` proviene del propio prefijo del mensaje (`[API]`, `[Auth]`, `[storage]`, `[realtime]`),
  y cualquier cosa no reconocida es `system`.

La actividad rutinaria de nivel `info` se omite deliberadamente. El búfer circular
contiene 10.000 entradas y una avalancha de respuestas `200` desalojaría lo que
usted abrió el panel para buscar.

Por lo tanto, una función personalizada que lance un error (throw) muestra su propio
mensaje aquí, junto a la solicitud que la invocó — el caso de uso para el cual esto existe.

El búfer circular es por proceso y por arranque: no es persistente, no se comparte
entre réplicas y un reinicio lo vacía. Para cualquier cosa que necesite conservar,
consulte la salida estándar (stdout) del proceso, que incluye las mismas líneas y más.

El explorador así lo indica. Muestra el registro de la única instancia de servidor
que lo está sirviendo y nombra dicha instancia: el evento `snapshot` de
`GET /api/admin/logs/stream` incluye `instance`, el `HOSTNAME` del proceso (el
nombre del pod en Kubernetes, el ID del contenedor en Docker) o bien `pid-<n>`. No
hay una vista conjunta entre réplicas, ni de los procesos `functions` y `worker` de un
[despliegue dividido](/docs/deployment/split-processes/). Una reconexión que
aterrice en otra instancia reemplaza la ventana en lugar de mezclar los dos registros.

## Activación de Studio

Un único componente, en cualquier lugar dentro de `<Rebase>`. No renderiza nada — registra
las herramientas y `<RebaseShell>` las dibuja:

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

Las herramientas aparecen en el drawer mientras el modo Studio está activo. Omita
`<RebaseStudio>` por completo y distribuirá un CMS exclusivo para contenido:
sin modo Studio, sin selector y sin nada cargado de forma diferida.

## Añadir su propia herramienta

`devViews` coloca sus propias vistas junto a las integradas. Son
[`AppView`](/docs/frontend#custom-views)s ordinarias — lo único que convierte a una
en una herramienta de Studio en lugar de una vista del CMS es el componente en el
que está registrada:

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
| `<RebaseCMS views>` | modo de contenido | cosas que utilizan las personas que editan contenido |
| `<RebaseStudio devViews>` | modo Studio | cosas que utiliza usted para administrar el backend |

Una vista va exactamente en uno de ellos — el drawer la ordena según cuál la
haya registrado, por lo que listar un slug en ambos la oculta del modo de contenido.

Al igual que `tools`, la lista se lee por su *contenido*: escribirla en línea (inline) es
seguro, y una nueva renderización del host no vuelve a montar la herramienta que esté
en pantalla. Cambiar el nombre de una vista o cambiar su grupo sí vuelve a registrarla.

### Elegir qué herramientas aparecen

Omita `tools` y se registrarán todas las herramientas mencionadas anteriormente. Páselo
para registrar un subconjunto — por ejemplo, una consola alojada que ya tenga su propio
explorador de almacenamiento puede omitir esa:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, la herramienta Collections, ya no se acepta: la herramienta fue eliminada.

La lista se lee por *contenido*, no por identidad, por lo que escribirla en línea es
seguro: una nueva renderización del host no desmonta ni vuelve a montar la herramienta
que esté en pantalla.

## Pasos siguientes

- **[Plugins](/docs/plugins)** — Extienda el framework con plugins
- **[Tablas](/docs/schema/)** — Declaración de las tablas que lee Studio
- **[Personalizar una tabla](/docs/frontend/customize-table/)** — Cómo las muestra el panel
