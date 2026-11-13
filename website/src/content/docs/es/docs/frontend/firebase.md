---
sourceHash: 6995a63f34afa39a
title: Firestore junto a Postgres
sidebar_label: Firebase
description: "Muestra colecciones de Firestore en el CMS junto a tus tablas de Postgres: defineFirestoreCollection, useFirestoreDataSource, externalCollections y referencias cruzadas entre documentos de Firestore y filas de Postgres en ambas direcciones."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`@rebasepro/firebase` permite al CMS leer y escribir colecciones de Firestore en el
navegador, a través del SDK de Firebase, junto a las tablas que sirve tu backend
de Rebase. Una sola navegación, una sola búsqueda, un solo selector de referencias: un
operador no necesita saber en qué motor reside un registro.

Aquí, Firestore es un asunto exclusivo del frontend. El backend no sabe nada al
respecto, y una colección de Firestore se declara en `frontend/src/cms/`, nunca en
`backend/schema`.

:::caution[Las colecciones de Firestore se leen directamente desde el navegador]
Nada de lo que hay entre el navegador y Firestore pertenece a Rebase: la seguridad a
nivel de fila (row-level security), la API REST, el SDK generado, las funciones, las
tareas programadas (crons) y el modelo de acceso al almacenamiento no se aplican a
una colección de Firestore. Quién puede leer y escribir sus documentos se decide
mediante las **Reglas de seguridad de Firebase**, escritas y desplegadas en Firebase.
:::

## Instalación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
pnpm add @rebasepro/firebase firebase
```

Dependencias peer: `firebase` (10, 11 o 12), `react` ≥ 19, `react-dom` ≥ 19 y,
opcionalmente, `typesense` para búsqueda de texto.

## Declarar una colección de Firestore

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
// frontend/src/cms/events.ts
import { defineFirestoreCollection } from "@rebasepro/firebase";

const eventTraces = defineFirestoreCollection({
    slug: "fs_event_traces",
    path: "traces",
    name: "Traces",
    dataSource: "firestore",
    fields: {
        step: { name: "Step", type: "string" },
        at:   { name: "At", type: "date" },
    },
});

export const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live Events (Firestore)",
    dataSource: "firestore",
    fields: {
        type:       { name: "Event Type", type: "string", required: true },
        payload:    { name: "Payload", type: "map" },
        // A reference to a row of the `customers` Postgres table.
        customerId: { name: "Customer", type: "reference", target: "customers" },
    },
    subcollections: () => [eventTraces],
});
```

| Clave | Qué hace |
|---|---|
| `slug` | El nombre de la colección en el panel: su URL y el destino al que apuntan otras referencias. Debe ser diferente del slug de cualquier tabla. |
| `path` | Dónde residen los documentos en Firestore, cuando no coincide con el slug. |
| `name` | La etiqueta en la navegación. |
| `dataSource` | La clave de la entrada `<Rebase dataSources>` que la lee: la `key` proporcionada a `useFirestoreDataSource`. Omítela solo cuando Firestore sea la fuente por defecto. |
| `databaseId` | Una base de datos de Firestore distinta de la predeterminada. |
| `fields` | Los campos del documento, por clave. |
| `subcollections` | Colecciones anidadas bajo cada documento, mostradas como pestañas del documento y almacenadas en `<path>/<id>/<child path>`. Cada una también es un `defineFirestoreCollection`. |

El `type` de un campo es uno de los que almacena Firestore: `string`, `number`, `boolean`,
`date`, `geopoint`, `map`, `array`, `reference` o `binary`. `required: true`
indica un campo obligatorio. Un `reference` indica la colección a la que apunta
mediante `target`, en cualquier fuente de datos. Una `relation` o un `vector`
pertenecen a una tabla de Postgres y no se admiten aquí, al igual que `properties` y `engine`.

El tipo del documento se infiere a partir de `fields`, por lo que las opciones propias
de la colección se validan contra sus claves. Las opciones de presentación que admite
una colección de Firestore (icono, grupo, vistas) son las del modelo de colección
del panel, no `customizeTable`, que está destinado a tablas.

## Montarla junto a las tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Dos pasos: registrar Firestore como fuente de datos en `<Rebase>` y pasar la
colección a `<RebaseCMS externalCollections>`.

```tsx
// frontend/src/App.tsx
import React from "react";
import { initializeApp } from "firebase/app";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { useFirestoreDataSource } from "@rebasepro/firebase";
import { postsCms } from "./cms/posts";
import { customersCms } from "./cms/customers";
import { firestoreEvents } from "./cms/events";

const rebaseClient = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });
const firebaseApp = initializeApp({ projectId: "acme-ops", apiKey: "…", appId: "…" });

export function App() {
    const authController = useRebaseAuthController({ client: rebaseClient });
    const firestoreSource = useFirestoreDataSource({ key: "firestore", firebaseApp });

    return (
        <Rebase
            client={rebaseClient}            // the default data source: the Postgres backend
            dataSources={[firestoreSource]}  // a second, direct source: Firestore
            authController={authController}
        >
            <RebaseAuth/>
            <RebaseCMS
                tableCustomizations={[postsCms, customersCms]}
                externalCollections={[firestoreEvents]}
            />
            <RebaseStudio/>
            <RebaseShell title="Acme Ops"/>
        </Rebase>
    );
}
```

El panel muestra cada tabla que sirve el backend, con `postsCms` y
`customersCms` aplicados, y luego `fs_events`, en la misma navegación. Un slug
nombra una sola colección: una colección externa con el slug de una tabla será
rechazada, indicando ambos nombres (ver [colisiones](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` devuelve el mismo objeto en cada renderizado mientras sus
opciones sigan siendo las mismas, por lo que puede declararse en línea dentro de `dataSources`. Sus opciones:

| Opción | Qué hace |
|---|---|
| `key` | **Obligatorio.** Lo que nombra el `dataSource` de una colección. |
| `firebaseApp` | La app de Firebase inicializada. Hasta que se defina, la fuente indicará que no está lista. |
| `databaseId` | La base de datos de Firestore, cuando no es la predeterminada de la app. El `databaseId` propio de una colección tiene prioridad. |
| `label` | Una etiqueta para la fuente, donde el panel nombra las fuentes de datos. |
| `textSearchControllerBuilder` | Responde a las búsquedas de texto con IDs de documentos (Algolia, Typesense, Pinecone, Rebase search). |
| `localTextSearchEnabled` | Busca en el navegador sobre los propios documentos cuando ningún controlador cubre una colección. Lee todos los documentos: adecuado para una colección pequeña. |
| `firestoreIndexesBuilder` | Los índices compuestos que tiene la base de datos, para que el panel ofrezca solo los filtros y ordenamientos a los que Firestore puede responder. |

También registra las capacidades de Firestore, de modo que a sus colecciones
nunca se les ofrezcan pestañas de relaciones ni filtros que Firestore no pueda ejecutar.

## Editarla en el editor de colecciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

En desarrollo, el [editor de colecciones](/docs/studio/#collection-editor) también edita
colecciones de Firestore: al guardar, se reescribe directamente la llamada a
`defineFirestoreCollection({...})` de la colección en `frontend/src/cms`,
modificando solo lo que hayas editado. Las funciones, los componentes personalizados, los
comentarios y las importaciones se mantienen intactos; los campos definidos en código se
muestran como de solo lectura. En producción, las colecciones de Firestore son de solo
lectura en el editor. Para eliminar una, borra su archivo y su entrada en `externalCollections`.

## De Firestore a una tabla

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`customerId: { type: "reference", target: "customers" }` apunta a la
tabla `customers`. Cuando un operador abre un evento y hace clic en el chip del cliente,
o selecciona un cliente, la búsqueda se enruta según la fuente de datos del destino: la
colección `customers` es una tabla, por lo que va al backend de Rebase, bajo la
seguridad a nivel de fila del emisor de la petición.

Una referencia a un registro en otra fuente de datos se almacena en el documento como el
**id** del registro (una cadena de texto), por lo que una consulta de Firestore con `customerId == "42"`
coincidirá con él. Una referencia a un documento en la misma base de datos de Firestore se almacena
como un `DocumentReference` de Firestore, tal como este espera.

## De una tabla a Firestore

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una columna de tabla que contiene el ID de un documento de Firestore es una simple columna
de texto en el backend. `referenceTo` en su `customizeTable` la convierte en una referencia
en el panel:

```ts
// backend/schema/customers.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        name:           col.text().notNull(),
        // The id of this customer's document in the Firestore `fs_events` collection.
        lastEventDocId: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/customers.tsx
import { customizeTable } from "@rebasepro/cms";
import type { customers } from "../../../backend/schema/customers";

export const customersCms = customizeTable<typeof customers>("customers", {
    fields: {
        lastEventDocId: { name: "Last event", referenceTo: "fs_events" },
    },
});
```

El campo se dibuja y se selecciona como una referencia a `fs_events`, y al abrirlo
se lee el documento a través de `firestoreSource`. La columna sigue almacenando el ID
como texto, y el backend sigue viendo una columna de texto. `referenceTo` se aplica a columnas
de texto y uuid; en cualquier otro tipo se omite, mostrando una advertencia en desarrollo.

## Un panel exclusivo para Firestore

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`RebaseFirebaseApp` es un panel completo únicamente sobre Firebase: inicio de sesión
con Firebase Auth, enrutamiento y las colecciones que le pases, sin ningún backend de Rebase.

```tsx
import React from "react";
import { RebaseFirebaseApp, defineFirestoreCollection } from "@rebasepro/firebase";

const firebaseConfig = { projectId: "acme-ops", apiKey: "…", appId: "…" };

// No `dataSource`: here Firestore is the default source.
const events = defineFirestoreCollection({
    slug: "events",
    name: "Events",
    fields: {
        type: { name: "Event Type", type: "string", required: true },
    },
});

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[events]}
    />;
}
```

Un ejemplo funcional se encuentra en
[`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).
En esa configuración, nada de lo que aparece en las páginas del backend de este sitio se
aplica: las reglas de seguridad de Firebase reemplazan la seguridad a nivel de fila, el SDK
de Firebase reemplaza la API REST y el SDK generado, Cloud Functions reemplaza las funciones
y las tareas programadas (crons), y Studio y `rls-check` no tienen nada que inspeccionar.

## Relacionado

- [Tablas en el CMS](/docs/collections/): qué muestra la parte de Postgres sin configuración previa
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` y todas las demás opciones de tabla
- [Visión general del frontend](/docs/frontend/): propiedades de `<Rebase dataSources>` y `<RebaseCMS>`
- [Autenticación e inicio de sesión](/docs/frontend/authentication/): la superficie de inicio de sesión
