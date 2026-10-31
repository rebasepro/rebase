---
sourceHash: a1afbafa7c27ef28
title: SDK tipado — Primeros pasos
sidebar_label: Primeros pasos
description: Instala y configura el SDK tipado de Rebase para interactuar con tu backend desde cualquier aplicación JavaScript o TypeScript.
---

## Descripción general

El paquete `@rebasepro/client` proporciona un SDK de JavaScript con seguridad de tipos para interactuar con tu backend de Rebase. Gestiona:

- **Operaciones de datos** — CRUD con filtrado, ordenación y paginación
- **Obtención de relaciones** — Incluye entidades relacionadas con `.include()`
- **Suscripciones en tiempo real** — Actualizaciones en vivo basadas en WebSocket
- **Sincronización offline y local-first** — Base de datos local de filas opcional (opt-in), escrituras offline instantáneas, consultas en vivo
- **Autenticación** — Gestión de tokens, inicio de sesión, registro, OAuth
- **Almacenamiento** — Subida, descarga y gestión de archivos
- **Funciones personalizadas** — Llama a endpoints personalizados del servidor

## Instalación

```bash
pnpm add @rebasepro/client
```

## Creación de un cliente

`rebase dev` deriva un puerto libre a partir de la ruta del proyecto en lugar de usar uno
fijo, por lo que debes **leer `baseUrl` de la URL que imprimió** — no hay un puerto
compartido por todos los proyectos. En un frontend con Vite, esa es la variable `VITE_API_URL` que
el scaffold escribe en `.env`; en un script, una variable de entorno propia.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

La propiedad `websocketUrl` se deriva automáticamente de `baseUrl` (`http → ws`, `https → wss`). Puedes sobrescribirla explícitamente si es necesario:

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
| `websocketUrl` | `string` | URL de WebSocket — derivada automáticamente de `baseUrl` si se omite |
| `token` | `string` | Token JWT estático para llamadas de servidor a servidor |
| `apiPath` | `string` | Prefijo de la API (por defecto: `"/api"`) |
| `fetch` | `typeof fetch` | Implementación personalizada de fetch (p. ej., para SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Manejador personalizado de 401 — devuelve `true` para reintentar |
| `realtime` | `boolean \| RealtimeClientOptions` | Abre el WebSocket (por defecto `true`) — establécelo en `false` en scripts de un solo uso. `{ affinity }` [nombra el grupo al que pertenece el socket](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `collections` | `Record<string, string>` | Mapea nombres de accesores a slugs de colecciones |
| `offline` | `boolean \| OfflineConfig` | [Sincronización local-first](/docs/sdk/offline) — desactivada por defecto |
| `impersonate` | `string` | Ejecuta cada solicitud como este usuario, mediante uid, para comprobar lo que puede ver un usuario. Solo una sesión de administrador puede hacerlo: la API de datos, las funciones y realtime se ejecutan como ese usuario, y cualquier otra ruta lo rechaza |
| `debug` | `boolean` | Registra el progreso de la conexión en tiempo real con `console.debug` (por defecto `false`) — consulta [Registro de conexión](#registro-de-conexión) |

### Registro de conexión

Por defecto, el cliente no imprime nada sobre su conexión en tiempo real, por lo que una página pública no muestra nada sobre su backend en la consola de un visitante. Las advertencias y los errores siempre se imprimen. Para ver cómo se abre la conexión, inicia sesión, se interrumpe y se vuelve a conectar, pasa `debug: true`, o actívalo en un navegador sin cambiar el sitio ejecutando esto en su consola:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Se aplica a partir de la siguiente línea que el cliente registre, por lo que una página que ya está conectada no necesita recargarse. Fuera de un navegador, establece `globalThis.__REBASE_DEBUG__ = true`. Los navegadores muestran `console.debug` únicamente en el nivel Verbose (Detallado).

## Generación del SDK tipado

Genera un cliente totalmente tipado a partir de las definiciones de tus colecciones:

```bash
rebase generate-sdk
```

Mientras `rebase dev` se esté ejecutando no necesitas hacerlo: regenera los tipos en
`generated/sdk/` al iniciar y en cada guardado dentro de `config/collections/`. Ejecuta el
comando tú mismo en CI, en un repositorio de frontend que no tenga colecciones
(`rebase generate-sdk --from link`), o en cualquier lugar donde no se esté ejecutando `rebase dev`.
En 0.23, `rebase dev` no modifica los tipos del SDK, por lo que debes ejecutar el comando después de
cada cambio en las colecciones.

Luego pasa el parámetro de tipo `Database` a `createRebaseClient` para obtener autocompletado completo:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full autocomplete on collection names and field types
const { data } = await client.data.products.find();
```

Cuando se proporciona `Database`, `createRebaseClient` devuelve una instancia de `CreateRebaseClientResult<DB>`. Esto mapea los accesores de colecciones en camelCase directamente en `client.data` con sus tipos correspondientes, brindándote autocompletado completo en las operaciones y tipos de las colecciones (p. ej., `client.data.products.find()`).

`collectionsDictionary` mapea cada accesor al slug que se utiliza en la red (wire). **`collections` es obligatorio para un cliente tipado.** Los tipos ofrecen cada accesor independientemente de si lo pasas o no, pero sin él `client.data.myNotes` se envía a `/data/my_notes`, el accesor en snake_case, por lo que un slug como `my-notes` o un accesor renombrado responderá con un error 404. El cliente emitirá una advertencia una sola vez, indicando el accesor y la solución. Una versión posterior hará que `collections` sea obligatorio en los tipos cuando se proporcione `Database`.

Algunos nombres en `client.data` están reservados: `collection` es la función dinámica `collection(slug)`, y `then`, `toJSON` y `$$typeof` se reservan para comprobaciones de promesas y serialización. Una colección cuyo accesor coincida con uno de ellos se genera como `<name>Collection` —el slug `collection` es `client.data.collectionCollection`— y `generate-sdk` muestra una advertencia indicando ambos. `client.data.collection("collection")` también permite acceder a ella.

### Nombres de campos

**El nombre de un campo en la red (wire) es su clave de propiedad**, y la API utiliza camelCase en todas partes. Una propiedad `createdAt` almacenada en una columna `created_at` es `row.createdAt`, y la clave foránea de una relación es `authorId` aunque la columna siga siendo `author_id`. `where` y `orderBy` se basan en el mismo tipo `Row`, por lo que lo que compila es a lo que el backend responde.

Una clave de propiedad que *tú* escribiste es tu clave, cualquiera que sea su formato — nada renombra un nombre que hayas elegido. Las dos claves que se derivan en lugar de declararse, la clave foránea de una relación y una columna leída mediante introspección, están en camelCase.

`Row` describe una lectura, `Insert` un `create()` y `Update` un `update()` — no tienen la misma forma. Una columna que no es obligatoria es `T | null` en las tres, por lo que una escritura puede vaciarla; la clave primaria siempre está presente en una lectura y nunca se puede definir en una actualización; el destino de un `belongsTo` se puede escribir ya sea como la relación (`{ author: 5 }`) o como su clave foránea (`{ authorId: 5 }`), y uno obligatorio se satisface con cualquiera de las dos; un `hasOne` se escribe indicando la fila de destino (`{ profile: 9 }`), o `null` para desvincularlo; un `via` de un solo salto (single-hop) se escribe según el tipo que representa (to-one: el id de destino o `null`; to-many: una lista de ids), y uno de múltiples saltos (multi-hop) es de solo lectura y no está en ninguno de los dos; y la pertenencia a un `hasMany` o `manyToMany` se escribe como una lista de ids de destino u objetos `{ id }` (`{ tags: ["t-1"] }`), incluyendo cada uno un `_pivot` cuando la tabla de unión declara columnas de carga útil (payload). Un campo que nadie puede escribir (`access: { write: [] }`) no está ni en `Insert` ni en `Update`. Una columna `date` se lee como una cadena ISO, y una escritura acepta ya sea esa cadena o un `Date`.

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

- **[Consultar datos](/docs/sdk/querying)** — CRUD, filtros, paginación y relaciones
- **[Autenticación](/docs/sdk/authentication)** — Iniciar sesión, registrarse, OAuth, sesiones
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Sincronización offline y local-first](/docs/sdk/offline)** — Trabaja sin conexión y sincroniza cuando regrese
- **[Almacenamiento y archivos](/docs/sdk/storage)** — Subir, descargar y gestionar archivos
