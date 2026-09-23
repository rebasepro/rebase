---
sourceHash: d84680ca60bab8a4
title: SDK tipado — Primeros pasos
sidebar_label: Primeros pasos
description: Instala y configura el SDK de cliente de Rebase para interactuar con tu backend desde cualquier aplicación JavaScript o TypeScript.
---

## Descripción general

El paquete `@rebasepro/client` proporciona un SDK de JavaScript con seguridad de tipos para interactuar con tu backend de Rebase. Gestiona:

- **Operaciones de datos** — CRUD con filtrado, ordenación y paginación
- **Obtención de relaciones** — Incluye entidades relacionadas con `.include()`
- **Suscripciones en tiempo real** — Actualizaciones en vivo basadas en WebSocket
- **Sincronización local-first y offline** — Base de datos local de filas opcional, escrituras instantáneas offline, consultas en vivo
- **Autenticación** — Gestión de tokens, inicio de sesión, registro, OAuth
- **Almacenamiento** — Subida, descarga y gestión de archivos
- **Funciones personalizadas** — Llama a endpoints personalizados del servidor

## Instalación

```bash
pnpm add @rebasepro/client
```

## Creación de un cliente

`rebase dev` deriva un puerto libre a partir de la ruta del proyecto en lugar de usar uno fijo, por lo que debes **leer `baseUrl` de la URL que imprimió**; no hay un puerto compartido por todos los proyectos. En un frontend con Vite, ese es el `VITE_API_URL` que el scaffold escribe en `.env`; en un script, una variable de entorno propia.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

La `websocketUrl` se deriva automáticamente de `baseUrl` (`http → ws`, `https → wss`). Puedes sobrescribirla explícitamente si es necesario:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Opciones de configuración

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `baseUrl` | `string` | URL del backend. Léela de lo que imprimió `rebase dev`, o de tu despliegue |
| `websocketUrl` | `string` | URL de WebSocket — derivada automáticamente de `baseUrl` si se omite |
| `token` | `string` | Token JWT estático para llamadas de servidor a servidor |
| `apiPath` | `string` | Prefijo de la API (por defecto: `"/api"`) |
| `fetch` | `typeof fetch` | Implementación personalizada de fetch (p. ej. para SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Controlador personalizado para 401 — devuelve `true` para reintentar |
| `realtime` | `boolean` | Abre el WebSocket (por defecto `true`) — establece `false` en scripts de ejecución única |
| `collections` | `Record<string, string>` | Mapea nombres de accesores a slugs de colecciones |
| `offline` | `boolean \| OfflineConfig` | [Sincronización local-first](/docs/sdk/offline) — desactivada por defecto |

## Generación de SDK tipado

Genera un cliente totalmente tipado a partir de las definiciones de tus colecciones:

```bash
rebase generate-sdk
```

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

Cuando se proporciona `Database`, `createRebaseClient` devuelve una instancia de `CreateRebaseClientResult<DB>`. Esto mapea los accesores de colecciones en camelCase directamente en `client.data` a sus tipos correspondientes, brindándote autocompletado completo en las operaciones y tipos de colecciones (p. ej., `client.data.products.find()`).

`collectionsDictionary` mapea cada accesor de vuelta al slug que se usa en la transmisión de datos. Pásalo siempre que un slug no sea ya un nombre de propiedad válido — `my-notes` es accesible como `client.data.myNotes` solo porque el diccionario así lo indica.

### Nombres de campos

**El nombre de un campo en la transmisión es su clave de propiedad**, y la API utiliza camelCase en su totalidad. Una propiedad `createdAt` almacenada en una columna `created_at` es `row.createdAt`, y la clave foránea de una relación es `authorId` aunque la columna se mantenga como `author_id`. `where` y `orderBy` se basan en el mismo tipo `Row`, por lo que lo que compila es a lo que el backend responde.

Una clave de propiedad que *tú* escribiste es tu clave, cualquiera que sea su formato — nada renombra un nombre que hayas elegido. Las dos claves que se derivan en lugar de declararse, la clave foránea de una relación y una columna leída mediante introspección, están en camelCase.

`Row` describe una lectura, `Insert` un `create()` y `Update` un `update()` — no tienen la misma forma. Las columnas que admiten valores nulos son `T | null` en `Row`, la clave primaria siempre está presente en una lectura y nunca se puede establecer en una actualización, y un destino `belongsTo` se puede escribir tanto como la relación (`{ author: 5 }`) o como su clave foránea (`{ authorId: 5 }`).

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
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión, registro, OAuth, sesiones
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Sincronización local-first y offline](/docs/sdk/offline)** — Trabaja sin conexión y sincroniza cuando vuelva
- **[Almacenamiento y archivos](/docs/sdk/storage)** — Sube, descarga y gestiona archivos
