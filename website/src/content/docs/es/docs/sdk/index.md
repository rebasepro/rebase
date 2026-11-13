---
sourceHash: d3b3f413d231c3d0
title: SDK tipado — Primeros pasos
sidebar_label: Primeros pasos
description: Instala y configura el SDK tipado de Rebase para interactuar con tu backend desde cualquier aplicación JavaScript o TypeScript.
---

## Descripción general

El paquete `@rebasepro/client` proporciona un SDK de JavaScript con seguridad de tipos para interactuar con tu backend de Rebase. Se encarga de:

- **Operaciones de datos** — CRUD con filtrado, ordenación y paginación
- **Obtención de relaciones** — Incluye entidades relacionadas con `.include()`
- **Suscripciones en tiempo real** — Actualizaciones en vivo basadas en WebSocket
- **Sincronización offline y local-first** — Base de datos local de filas opcional, escrituras offline instantáneas, consultas en vivo
- **Autenticación** — Gestión de tokens, inicio de sesión, registro, OAuth
- **Almacenamiento** — Subida, descarga y gestión de archivos
- **Funciones personalizadas** — Llamada a endpoints de servidor personalizados

## Instalación

```bash
pnpm add @rebasepro/client
```

## Creación de un cliente

`rebase dev` deduce un puerto libre a partir de la ruta del proyecto en lugar de usar uno
fijo, por lo que debes **leer `baseUrl` de la URL que imprimió**; no hay un puerto
que todos los proyectos compartan. En un frontend de Vite, ese es el `VITE_API_URL` que el scaffold
escribe en `.env`; en un script, una variable de entorno propia.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

`websocketUrl` se deduce automáticamente de `baseUrl` (`http → ws`, `https → wss`). Puedes sobrescribirlo explícitamente si es necesario:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Opciones de configuración

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `baseUrl` | `string` | URL del backend. Léela de lo que imprimió `rebase dev` o de tu despliegue |
| `websocketUrl` | `string` | URL de WebSocket — deducida automáticamente de `baseUrl` si se omite |
| `token` | `string` | Token JWT estático para llamadas entre servidores |
| `apiPath` | `string` | Prefijo de la API (por defecto: `"/api"`) |
| `fetch` | `typeof fetch` | Implementación personalizada de fetch (p. ej., para SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Manejador personalizado para 401 — devuelve `true` para reintentar |
| `realtime` | `boolean \| RealtimeClientOptions` | Abre el WebSocket (por defecto `true`) — establécelo en `false` en scripts de ejecución única. `{ affinity }` [nombra el grupo al que pertenece el socket](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `tables` | `Record<string, string>` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Mapea nombres de accesores a slugs de tablas — el `tablesDictionary` generado |
| `offline` | `boolean \| OfflineConfig` | [Sincronización local-first](/docs/sdk/offline) — desactivada por defecto |
| `impersonate` | `string` | Ejecuta cada petición como este usuario, por uid, para comprobar qué puede ver un usuario. Solo una sesión de administrador puede hacerlo: la API de datos, las funciones y el realtime se ejecutan como ese usuario, y cualquier otra ruta lo rechaza |
| `debug` | `boolean` | Registra el progreso de la conexión en tiempo real con `console.debug` (por defecto `false`) — consulta [Registro de conexión](#registro-de-conexión) |

### Registro de conexión

El cliente no imprime nada sobre su conexión en tiempo real de forma predeterminada, por lo que una página pública no muestra nada sobre su backend en la consola de un visitante. Las advertencias y errores siempre se imprimen. Para ver la conexión abrirse, iniciar sesión, caerse y reconectarse, pasa `debug: true`, o actívalo en un navegador sin modificar el sitio ejecutando esto en su consola:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Se aplica a partir de la siguiente línea que el cliente registre, por lo que una página que ya esté conectada no necesita recargarse. Fuera del navegador, define `globalThis.__REBASE_DEBUG__ = true`. Los navegadores solo muestran `console.debug` en el nivel Detallado (Verbose).

## Generación del SDK tipado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Genera un cliente totalmente tipado a partir de tus tablas:

```bash
rebase generate-sdk
```

Mientras `rebase dev` esté en ejecución no necesitas hacerlo: regenera los tipos en
`generated/sdk/` al iniciar y con cada guardado en `backend/schema/`. Ejecuta el
comando tú mismo en CI, en un repositorio de frontend que no tenga tablas propias
(`rebase generate-sdk --from link`), o en cualquier lugar donde `rebase dev` no se esté ejecutando.
`generate-sdk` lee las tablas que exporta `backend/schema/index.ts`, mediante el
mismo cargador desde el que arranca el backend; `--from` lee en su lugar las `tables` del
`/api/meta/contract` de un backend en ejecución.

Luego pasa el parámetro de tipo `Database` a `createRebaseClient` para obtener autocompletado completo:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full autocomplete on table names and field types
const { data } = await client.data.products.find();
```

Cuando se proporciona `Database`, `createRebaseClient` devuelve una instancia de `CreateRebaseClientResult<DB>`. Esto mapea los accesores de tabla en camelCase directamente en `client.data` a sus tipos correspondientes, brindándote un autocompletado completo en las operaciones y tipos de tabla (p. ej., `client.data.products.find()`).

`tablesDictionary` mapea cada accesor al slug que se utiliza en la transmisión de red. El módulo generado también exporta `TableName`, la unión de cada slug, y el tipo `TablesDictionary`. **`tables` es obligatorio para un cliente tipado.** Los tipos ofrecen cada accesor independientemente de si lo pasas o no, pero sin él `client.data.myNotes` se envía a `/data/my_notes`, el accesor en snake_case, por lo que un slug como `my-notes` o un accesor renombrado responderá 404. El cliente advierte una vez, indicando el accesor y la solución. Con el diccionario, un accesor que no se encuentre en él lanza un error `RebaseClientError` con el código `UNKNOWN_TABLE` y una sugerencia. Una versión posterior hará que `tables` sea obligatorio en los tipos cuando se proporcione `Database`.

Algunos nombres en `client.data` ya están reservados: `table` es la función dinámica `table(slug)`, `batch` es [`client.batch`](/docs/sdk/writing/#writing-across-tables), y `then`, `toJSON` y `$$typeof` se reservan para comprobaciones de promesas y serialización. Una tabla cuyo accesor sería `table`, `then`, `toJSON` o `$$typeof` se genera como `<name>Table` —el slug `table` es `client.data.tableTable`— y `generate-sdk` imprime una advertencia mencionando ambos. `client.data.table("table")` también permite acceder a ella, y es la forma de acceder a una tabla cuyo accesor sería `batch`. `data.table(slug)` rechaza un slug con un segmento `.` o `..`, que saldría de `/data`, con `INVALID_TABLE_PATH`.

### Nombres de campos

**El nombre de un campo en la transmisión es la clave de su columna**, y la API utiliza camelCase en todas partes. Una columna `createdAt` almacenada como `created_at` es `row.createdAt`, y la clave foránea de una relación es `authorId` aunque la columna siga siendo `author_id`. `where` y `orderBy` se basan en el mismo tipo `Row`, por lo que lo que compila es exactamente a lo que responde el backend.

Una clave de columna que *tú* escribiste es tu clave, cualquiera que sea su formato —nada renombra un nombre que hayas elegido—. Las dos claves que se derivan en lugar de declararse, la clave foránea de una relación y una columna leída mediante introspección, están en camelCase.

`Row` describe una lectura, `Insert` un `create()` y `Update` un `update()` —no tienen la misma estructura—. Una columna que no es obligatoria es `T | null` en los tres casos, por lo que una escritura puede vaciarla; la clave primaria siempre está presente en una lectura y nunca se puede establecer en una actualización; un destino `belongsTo` se puede escribir ya sea como la relación (`{ author: 5 }`) o como su clave foránea (`{ authorId: 5 }`), y uno obligatorio se satisface con cualquiera de los dos; un `hasOne` se escribe indicando la fila de destino (`{ profile: 9 }`), o `null` para desvincularlo; un `via` de un solo salto se escribe según el tipo que representa (to-one: el id de destino o `null`; to-many: una lista de ids), y uno de múltiples saltos es de solo lectura y no aparece en ninguno; y una pertenencia `hasMany` o `manyToMany` se escribe como una lista de ids de destino u objetos `{ id }` (`{ tags: ["t-1"] }`), llevando cada uno un `_pivot` cuando la tabla de unión declara columnas de carga útil (payload). Un campo que nadie puede escribir (`.access({ write: [] })`) no está ni en `Insert` ni en `Update`. Una columna `date` se lee como una cadena ISO, y una escritura acepta tanto esa cadena como un objeto `Date`.

## Ejemplo rápido

```typescript
// Create
const product = await client.data.products.create({
    name: "Camera",
    price: 299,
});

// Query with filters
const { data } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();

// Real-time subscription
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] } },
    (response) => console.log("Updated:", response.data)
);
```

## Uso con React

En un frontend de Rebase, el cliente se crea una vez y se comparte a través del contexto:

```tsx no-verify
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL });

<Rebase client={client} ...>
```

Accede a él desde cualquier componente:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // client.data, client.auth, client.storage, client.functions
}
```

## Siguientes pasos

- **[Consulta de datos](/docs/sdk/querying)** — CRUD, filtros, paginación y relaciones
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión, registro, OAuth, sesiones
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Sincronización offline y local-first](/docs/sdk/offline)** — Trabaja sin conexión y sincroniza cuando regrese
- **[Almacenamiento y archivos](/docs/sdk/storage)** — Sube, descarga y administra archivos
