---
sourceHash: 7bd4e27e22c6c53b
title: Colecciones
sidebar_label: Colecciones
description: Las colecciones son el bloque de construcción fundamental de Rebase; cada colección se asigna a una tabla de base de datos y define su esquema, relaciones, seguridad y comportamiento de la interfaz de usuario.
---

## ¿Qué es una Colección?

Una **colección** es un objeto TypeScript que describe una tabla de base de datos y cómo debe aparecer en la interfaz de usuario de administración. Define:

- **Esquema** — Propiedades (columnas), sus tipos y reglas de validación
- **Relaciones** — Claves foráneas, tablas intermedias (junction tables) y rutas de unión (join paths)
- **Seguridad** — Políticas de Seguridad a Nivel de Fila (Row Level Security o RLS)
- **Hooks del ciclo de vida** — Callbacks para operaciones de creación, actualización y eliminación
- **Comportamiento de la UI de administración** — Modos de visualización, edición en línea, vistas de entidad, acciones — todo bajo `admin`

## Declarar una: `defineCollection`

Envuelve el literal en `defineCollection`. En tiempo de ejecución es la función identidad (devuelve el objeto sin cambios), por lo que su costo es cero. Lo que aporta es inferencia: un parámetro de tipo `const` captura las claves de tus `properties` como tipos literales, y los campos con forma de clave del bloque `admin` se verifican contra ellos. Un nombre que no sea una de tus propiedades se convierte en un **error de compilación**, no solo en una sugerencia faltante.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },  // completion: "name" | "price"
        sort: ["price", "asc"],      // completion on the first element
        propertiesOrder: ["name", "price"]
    }
});
```

```typescript
    admin: {
        display: { title: "nmae" }
        //                ~~~~~~ Type '"nmae"' is not assignable to type
        //                       'PropertyPath<…>'. Did you mean '"name"'?
    }
```

Los campos verificados son `display`, `sort`, `propertiesOrder` y `listProperties`.
Se aceptan tres formas además de una clave de propiedad simple:

| Forma | Ejemplo | Notas |
| --- | --- | --- |
| Ruta con puntos dentro de un `map` | `"profile.displayName"` | La **raíz** debe ser una propiedad real; la ruta debajo de ella no se comprueba. |
| Columna de subcolección | `"subcollection:orders"` | Solo en `propertiesOrder` / `listProperties`. |
| Una clave de `additionalFields` | `"score" as AdditionalFieldKey` | Requiere el casteo (cast) — ver más abajo. |

`AdditionalFieldDelegate.key` es un `string` simple, por lo que el sistema de tipos no tiene forma de saber qué claves adicionales declara una colección. En lugar de reabrir estos campos a cualquier cadena, el casteo hace que la excepción sea explícita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Impórtalo desde `@rebasepro/cms-types` en un proyecto que cuente con panel de administración; esa es la copia que también comprueba los tipos del bloque `admin`. Un proyecto BaaS headless, que no tiene bloque admin, importa la misma función desde `@rebasepro/common` en su lugar.

Anotar el tipo directamente sigue funcionando y se sigue comprobando:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

pero una anotación solo *valida la forma*: no puede ver los nombres de tus propiedades, por lo que los campos clave de `admin` vuelven a aceptar cualquier cadena. Prefiere `defineCollection` a menos que necesites nombrar el tipo explícitamente.

:::note
`buildCollection` y `buildProperty` ya no existen. `buildCollection` es `defineCollection` sin la inferencia; `buildProperty` envolvía una propiedad en un tipo que ya tenía. Consulta el [registro de cambios](/docs/changelog) para ver la migración de una sola línea.
:::

## Anatomía: el contrato y el panel

Un solo archivo, dos destinatarios. Todo lo que le interesa a la *base de datos y a la API* se ubica en el nivel superior; todo lo que renderiza el *panel de administración* se encuentra dentro de `admin`.

```typescript
const posts = {
    // ── The backend reads these ──────────────────────────────
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    relations: [ /* … */ ],
    securityRules: [ /* … */ ],
    callbacks: { /* … */ },
    history: true,

    // ── The admin panel reads these ──────────────────────────
    admin: {
        icon: "FileText",
        listProperties: ["title", "status"],
        defaultViewMode: "table",
        entityViews: ["preview"]
    }
};
```

La separación no es meramente cosmética. Es lo que permite a Rebase funcionar como un backend por sí mismo:

- Un proyecto **BaaS o headless** nunca escribe un bloque `admin`. Sus colecciones —o ninguna colección, ya que el modo BaaS hace introspección de la base de datos— describen datos y autorización, nada más. `@rebasepro/types` no contiene código de interfaz de usuario, por lo que el árbol de dependencias de un proyecto headless se mantiene exclusivo del servidor.
- El **backend nunca lee dentro del bloque**. Este se descarta antes de que una colección se serialice para el endpoint de contrato o dentro de un bundle de compilación, y se excluye de la versión del esquema; por lo tanto, cambiar un icono no marcará cada SDK generado como desactualizado.

### El bloque `admin` solo existe si instalas los tipos de administración

`@rebasepro/types` no declara ningún campo `admin`, ni en una colección ni en una propiedad. En un proyecto BaaS, escribir uno genera un **error de tipo**. `@rebasepro/cms-types` lo añade mediante fusión de declaraciones (declaration merging), por lo que una sola línea por proyecto lo habilita:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

A partir de ahí, los tipos principales estándar contienen un bloque completamente tipado: un error tipográfico como `icoon` es un error, y dispones de autocompletado:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const posts = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", admin: { multiline: true } }
    },
    admin: { icon: "FileText" }
});
```

<!-- docs-verify: ignore -->
Una ampliación (augmentation) se aplica a todo el *programa* de TypeScript, y `config/` y `frontend/` son programas independientes, razón por la cual la referencia pertenece al paquete de configuración. No existe un tipo envoltorio `AdminCollectionConfig`: con el campo fusionado, `CollectionConfig` es el tipo de autoría.

:::note[Por qué un proyecto BaaS no asume ningún costo]
El tipo de una propiedad en una instalación BaaS no tiene `Field`, ni `columnWidth`, ni `hideFromCollection`; estos residen en `AdminPropertyOptions` dentro del paquete de administración. La garantía está probada, no solo afirmada: `e2e/baas-typecheck/src/admin_absent.ts` utiliza `@ts-expect-error` en `admin`, por lo que la compilación falla si el campo vuelve a ser modificable en el núcleo.
:::

### Migrar desde una colección plana

Antes de la versión 0.11, estos campos se encontraban en el nivel superior. Para moverlos:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

La herramienta reporta cualquier elemento que no pueda mover de forma segura —en particular, la presentación dentro de `relations[].overrides`, que requiere `overrides: { admin: { … } }` de forma manual.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            admin: { readOnly: true }
        }
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
});

```

## Propiedades clave

### Identificación

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `slug` | `string` | **Obligatorio.** Identificador seguro para URL. Utilizado en la URL de la UI de administración y en la ruta de la API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obligatorio.** Nombre visible (plural). Se muestra en la navegación y en los encabezados de página. |
| `singularName` | `string` | Nombre visible para una sola entidad. Se utiliza en "Nuevo producto", "Editar producto", etc. |
| `description` | `string` | Una frase sobre el contenido de esta colección, mostrada sobre la lista. Formato Markdown. |
| `table` | `string` | Nombre de la tabla de PostgreSQL. Por defecto es `toSnakeCase(slug)`; establécelo solo para desacoplar la URL de la tabla (por ejemplo, una tabla existente `blog_posts` servida en `/posts`). |
| `admin.icon` | `string` | Un nombre de icono de [Lucide](https://lucide.dev/icons), por ejemplo, `"FileText"`, `"ShoppingCart"`. Un elemento renderizado también funciona, pero el nombre sobrevive a la serialización, por lo que es lo que el editor de esquemas escribe de vuelta. |

### Esquema

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `properties` | `Properties` | **Obligatorio.** Mapa de clave de propiedad → definición de propiedad. Cada clave se convierte en una columna de la base de datos. |
| `relations` | `Relation[]` | Relaciones SQL — claves foráneas, tablas intermedias. Consulta [Relaciones](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Seguridad a Nivel de Fila (RLS). Consulta [Reglas de seguridad](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices de Postgres que requiere esta tabla. Consulta [Índices](/docs/backend/indexes). |
| `search` | `SearchConfig` | Búsqueda de texto completo clasificada sobre los campos que indiques, incluyendo contenido JSONB y arrays. Solo Postgres. Consulta [Búsqueda](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marca la colección como colección de autenticación (gestión de usuarios, restablecimiento de contraseña, etc.) |
| `schema` | `string` | Esquema de Postgres en el que reside la tabla — `"public"`, `"rebase"`, `"auth"`. Por defecto es `"public"`. |
| `disableDefaultPolicies` | `boolean` | Elimina las políticas base que inyecta el generador —un SELECT de admin/servidor y, en una colección de auth, una auto-lectura más una restricción de escritura solo para administradores— y asume la responsabilidad total del RLS de esta colección. `false` por defecto. Consulta [Reglas de seguridad](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Convierte la operación `delete` en una marca de tiempo y oculta las filas marcadas de cada lectura. `true` utiliza `deletedAt`; la forma de objeto renombra el campo. La colección debe declarar esa propiedad `date` por sí misma. Solo Postgres — consulta [Borrado suave](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rechaza con un 400 cualquier escritura que incluya un campo que esta colección no declare. `true` por defecto. Establécelo en `false` solo si la columna existe genuinamente y no está declarada (llenada por un trigger o descubierta por introspección en lugar de estar escrita). |

### Configuración de UI

Todo lo siguiente va dentro de `admin`.

| Propiedad | Tipo | Por defecto | Descripción |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modo de visualización por defecto |
| `enabledViews` | `ViewMode[]` | Las cuatro | Qué modos de visualización están disponibles |
| `kanban` | `KanbanConfig` | — | Configuración de Kanban (propiedad de columna). Emparéjalo siempre con `orderProperty` — consulta [Modos de visualización](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Clave de la propiedad **string** que almacena la clave de orden para arrastrar y soltar. Obligatorio para el funcionamiento del tablero Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Cómo se abren las entidades para su edición |
| `sideDialogWidth` | `number \| string` | — | Ancho del diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilitar edición en línea en la vista de hoja de cálculo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altura de fila por defecto en la tabla |
| `pagination` | `boolean \| number` | `true` (50) | Habilitar paginación y/o definir el tamaño de página |
| `listProperties` | `string[]` | — | Propiedades a mostrar en la vista de lista |
| `propertiesOrder` | `string[]` | — | Orden de columnas en la vista de tabla |
| `selectionEnabled` | `boolean` | `true` | Habilitar selección de filas |
| `hideFromNavigation` | `boolean` | `false` | Ocultar de la navegación de la barra lateral |
| `defaultSelectedView` | `string \| function` | — | Vista o subcolección por defecto a abrir |

### Opciones de entidad

Dentro de `admin`, excepto `history`, que es una característica de backend y permanece en el nivel superior.

| Propiedad | Tipo | Por defecto | Descripción |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Guardado automático al cambiar un campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Respaldo de cambios sin guardar |
| `hideIdFromForm` | `boolean` | `false` | Ocultar el ID de la entidad en el formulario |
| `hideIdFromCollection` | `boolean` | `false` | Ocultar la columna de ID en la tabla |
| `includeJsonView` | `boolean` | `true` | Ofrecer los valores crudos en el inspector de registros |
| `history` | `boolean` | `false` | Rastrear cambios en el historial de la entidad |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplicar valores por defecto en cada guardado |
| `previewProperties` | `string[]` | — | Propiedades a mostrar en las vistas previas de referencias |
| `display` | `EntityDisplay` | — | Qué llena cada rol de visualización — consulta [Visualización de entidades](#entity-display) |

### Avanzado

En el nivel superior, dado que el backend las lee:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | Las colecciones anidadas bajo una entidad de esta. Se completa durante la normalización a partir de lo que el controlador exprese — un `subcollections` de Firestore, una relación `hasMany` de Postgres — por lo que un controlador personalizado es la única razón para definirlo manualmente |
| `dataSource` | `string` | Qué fuente de datos registrada respalda esta colección (por defecto: la que no tiene nombre) |
| `engine` | `string` | El motor detrás de ella — `"postgres"`, `"firestore"`, `"mongodb"`. Resuelto desde `dataSource`; establécelo solo para sobrescribir |
| `databaseId` | `string` | Base de datos o esquema dentro del motor |
| `metadata` | `Record<string, unknown>` | Cualquier dato que tu propio código necesite vincular a una colección. Rebase no lo lee; sobrevive a la serialización sin cambios |
| `ownerId` | `string` | **Solo para el formulario de administración — no impuesto por la API ni por la base de datos.** El id de usuario que el editor de colecciones estampa en una colección creada, y que muestra junto a su nombre. Nada en la ruta de la solicitud lo consulta |

`subcollections` y `path` están presentes únicamente en las configuraciones para **bases de datos orientadas a documentos** — `FirebaseCollectionConfig` y, para `path`, `MongoDBCollectionConfig`:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Solo Firestore.** Colecciones anidadas bajo cada documento. Una colección de Postgres expresa lo mismo mediante una [relación](/docs/collections/relations) `hasMany`, que es lo que llena `childCollections` |
| `path` | `string` | **Solo Firestore y MongoDB.** La ruta o nombre de colección en el motor, cuando difiere del slug |

Y dentro de `admin`, ya que solo el panel los dibuja:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Acciones personalizadas sobre entidades (archivar, publicar, etc.) |
| `admin.Actions` | `React.ComponentType` | Componente personalizado para acciones en la barra de herramientas |
| `admin.entityViews` | `EntityCustomView[]` | Pestañas personalizadas en la vista detallada de la entidad |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Columnas virtuales/computadas |
| `admin.exportable` | `boolean \| ExportConfig` | Habilitar exportación de datos |
| `admin.components` | `CollectionComponentOverrideMap` | Sobrescrituras de componentes de UI con alcance a nivel de colección |

Escribir cualquiera de esos seis en el nivel superior es un error en tiempo de arranque, con un mensaje que indica la clave y hacia dónde se movió.

## Visualización de entidades

Cada superficie que muestra un registro dibuja un subconjunto de seis roles: **title** (título), **subtitle** (subtítulo), **image** (imagen), **status** (estado), **date** (fecha) y **tags** (etiquetas). Una fila de lista es imagen + título + subtítulo + estado + fecha; una tarjeta es lo mismo pero con la imagen arriba; un selector de referencias es título + subtítulo; y un encabezado de página es el título solo.

Cada rol se deriva de tus propiedades, y cada uno puede especificarse de forma explícita, ya sea como una ruta de propiedad o como una función:

```typescript
const exercises = defineCollection({
    name: "Exercises",
    slug: "exercises",
    table: "exercises",
    properties: {
        name: { name: "Name", type: "string" },
        cover: { name: "Cover", type: "string", storage: { storagePath: "covers/" } },
        city: { name: "City", type: "string" }
    },
    admin: {
        display: {
            title: "name",                                  // a property path
            image: "cover",
            subtitle: ({ entity }) => `in ${entity.values.city}`   // computed
        }
    }
});
```

Cualquier elemento que omitas mantiene su valor derivado, por lo que especificar un rol no significa tener que definir los seis.

### Roles computados y asíncronos

Un resolver puede ser `async`, lo que permite que un rol lea algo que el registro no contiene directamente —un documento en una subcolección, un valor detrás de una API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ entity, context }) => {
            const locale = await context.data.exercise_locales.get(`${entity.id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Mientras la promesa está en curso, la superficie muestra el valor derivado y lo reemplaza por el valor resuelto cuando llega: un título nunca es un spinner de carga. Los resultados se almacenan en caché por registro y por rol, y las peticiones concurrentes para el mismo par comparten una sola llamada; así, una lista de cincuenta filas resuelve cada fila una vez en lugar de una vez por renderizado.

Devuelve `undefined` cuando un registro no tenga nada para el rol; el valor de respaldo propio de la superficie está mejor informado sobre qué corresponde colocar allí en su lugar (un encabezado usa el nombre singular de la colección, un enlace usa el id). Si un resolver lanza un error, se trata como `undefined` y se registra una sola vez en los logs: un título que no se pueda obtener no debe romper la fila que lo muestra.

Prefiere una ruta siempre que el valor esté en el registro: una ruta conserva la renderización propia de la propiedad, por lo que un estado de tipo enum sigue siendo un chip de color y una fecha permanece formateada, algo que un resolver que devuelve un string simple no puede expresar.

:::note[`titleProperty` reemplazado]
`admin.titleProperty` fue eliminado a favor de `admin.display.title`. La misma cadena funciona allí, y el nuevo campo también acepta un resolver. Una colección que aún contenga la clave antigua es rechazada por `defineCollection` con el error habitual de clave desconocida.
:::

### Selección de la propiedad de título
Cuando `display.title` no está configurado, la propiedad utilizada como título visible de la entidad (vistas previas, encabezados) se resuelve automáticamente:
1. Si `propertiesOrder` está definido explícitamente, la primera propiedad que no sea de ID y sea de tipo `relation` o `string` se elige como título.
2. Si no hay ningún `propertiesOrder` definido, el framework busca las propiedades en orden y selecciona la primera propiedad de tipo string.

### Vistas previas de relaciones en tablas
Cuando `propertiesOrder` se define explícitamente, las propiedades de relación **no** se filtran automáticamente de las columnas de vista previa predeterminadas (mientras que sí se excluyen de los valores por defecto no ordenados para evitar operaciones join lentas).

### Cómo se renderiza el valor de un título
Independientemente de lo que contenga la propiedad de título, el panel renderiza una cadena de texto. Una fecha se formatea, un array se une, y una relación —que llega como `{ id, data: { values } }` en lugar de texto plano— se inspecciona buscando el primero de entre `name`, `title`, `label` o `displayName` en la fila relacionada, recurriendo a su id si no los encuentra. De este modo, un título puede apuntar a una propiedad `relation` y aun así mostrarse como un nombre legible en lugar de un uuid.

Este no es un helper exportado: es lo que cada superficie que dibuja un registro ya hace de forma nativa. No hay nada que llamar ni nada que importar.

## Constructor de colecciones (Collection Builder)

Para colecciones dinámicas que cambian según el usuario o datos externos, utiliza una función constructora (builder):

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    // `extra` is whatever your auth provider put there, so name its shape here.
    const extra = authController.extra as { role?: string };
    if (extra.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtrado y ordenación

Puedes definir filtros predeterminados o forzados. Los tres son elementos de presentación —con qué se abre el panel—, por lo que residen en `admin`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    properties: {
        active: { name: "Active", type: "boolean" },
        tenantId: { name: "Tenant", type: "string" },
        createdAt: { name: "Created", type: "date" }
    },
    admin: {
        // Default filter — users can change it
        defaultFilter: { active: ["==", true] },

        // Fixed filter — cannot be changed
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

Un `fixedFilter` restringe lo que el panel *solicita*; no es un límite de seguridad. Lo que un consumidor tiene permitido leer es una [regla de seguridad](/docs/collections/security-rules), la cual la base de datos impone para cada solicitante, sea el panel de administración o no.

## Próximos pasos

- **[Callbacks de entidad](/docs/collections/callbacks)** — Hooks de ciclo de vida para sincronizar datos entre colecciones, validación y efectos secundarios
- **[Propiedades](/docs/collections/properties)** — Todos los tipos de propiedades y opciones
- **[Relaciones](/docs/collections/relations)** — Claves foráneas, tablas intermedias, joins
- **[Reglas de seguridad](/docs/collections/security-rules)** — Row Level Security (RLS)
- **[Modos de visualización](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban

---
