---
sourceHash: 8bade8e09da44b98
title: Colecciones
sidebar_label: Colecciones
description: Las colecciones son el bloque de construcción fundamental de Rebase — cada colección se asigna a una tabla de base de datos y define su esquema, relaciones, seguridad y comportamiento en la interfaz de usuario.
---

## ¿Qué es una Colección?

Una **colección** es un objeto de TypeScript que describe una tabla de base de datos y cómo debe mostrarse en Rebase CMS. Define:

- **Esquema** — Propiedades (columnas), sus tipos y reglas de validación
- **Relaciones** — Claves foráneas, tablas de unión (junction tables) y rutas de join
- **Seguridad** — Políticas de Row Level Security (seguridad a nivel de fila)
- **Hooks de ciclo de vida** — Callbacks para operaciones de creación, actualización y eliminación
- **Comportamiento del CMS** — Modos de vista, edición en línea, vistas de entidad, acciones — todo bajo `admin`

## Cómo declarar una: `defineCollection`

Envuelve el literal en `defineCollection`. En tiempo de ejecución es la función identidad —devuelve
el objeto sin cambios— por lo que no tiene coste de rendimiento. La ventaja que aporta es la inferencia: un
parámetro de tipo `const` captura las claves de tus `properties` como tipos literales, y los campos
con forma de clave del bloque `admin` se verifican contra ellos. Un nombre que no pertenezca a tus
propiedades genera un **error de compilación**, y no simplemente una sugerencia ausente.

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
Se aceptan tres formatos además de una clave de propiedad simple:

| Formato | Ejemplo | Notas |
| --- | --- | --- |
| Ruta con puntos dentro de un `map` | `"profile.displayName"` | La **raíz** debe ser una propiedad real; la ruta anidada debajo de ella no se comprueba. |
| Columna de colección secundaria | `"subcollection:orders"` | Solo para `propertiesOrder` / `listProperties`. |
| Una clave de `additionalFields` | `"score" as AdditionalFieldKey` | Requiere el casteo (cast) — ver más abajo. |

`AdditionalFieldDelegate.key` es un `string` simple, por lo que el sistema de tipos no tiene forma de saber
qué claves adicionales declara una colección. En lugar de reabrir estos campos a cualquier cadena de texto,
el casteo hace explícita la excepción:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Impórtalo desde `@rebasepro/cms-types` en un proyecto que cuente con un panel de administración —esa es
la copia que también verifica los tipos del bloque `admin`. Un proyecto BaaS headless, que no tiene
bloque de admin, importa la misma función desde `@rebasepro/common` en su lugar.

Anotar el tipo directamente sigue funcionando y continúa verificándose:

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

sin embargo, una anotación solo *valida la estructura* —no puede deducir los nombres de tus propiedades, por lo que
los campos de clave de `admin` pasan a aceptar cualquier string. Da preferencia a `defineCollection` a menos que
necesites nombrar el tipo explícitamente.

:::note
`buildCollection` y `buildProperty` ya no existen. `buildCollection` es
`defineCollection` sin la inferencia; `buildProperty` envolvía una propiedad en un tipo que
ya poseía. Consulta el [changelog](/docs/changelog) para la migración de una sola línea.
:::

## Anatomía: el contrato y el panel

Un solo archivo, dos destinatarios. Todo lo que le concierne a la *base de datos y la API* se encuentra en el
nivel superior; todo lo que renderiza el *panel de administración* reside dentro de `admin`.

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

La división no es cosmética. Es lo que permite que Rebase funcione como backend por sí solo:

- Un proyecto **BaaS o headless** nunca escribe un bloque `admin`. Sus colecciones —o la ausencia total de
  colecciones, ya que el modo BaaS realiza introspección de la base de datos— describen datos y
  autorización, nada más. `@rebasepro/types` no contiene código de interfaz de usuario, por lo que el árbol de
  dependencias de un proyecto headless se mantiene exclusivamente del lado del servidor.
- El **backend nunca lee dentro del bloque**. Se elimina antes de que una colección sea
  serializada hacia el endpoint de contrato o dentro del bundle de build, y queda excluida de
  la versión del esquema —por lo que cambiar un icono no marcará todos los SDK generados como
  desactualizados.

### El bloque `admin` solo existe si instalas los tipos de administración

`@rebasepro/types` no declara ningún campo `admin`, ni en una colección ni en una propiedad. En
un proyecto BaaS, escribir uno genera un **error de tipo**. `@rebasepro/cms-types` lo reincorpora mediante
fusión de declaraciones (declaration merging), por lo que una sola línea por proyecto lo habilita:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

A partir de ese momento, los tipos principales estándar admiten un bloque con tipado completo —un error tipográfico como `icoon` genera un error,
y obtienes autocompletado:

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
Una aumentación se aplica a todo el *programa* de TypeScript, y `config/` y `frontend/`
son programas independientes —por esa razón la referencia corresponde al paquete de configuración. No
existe un tipo envoltorio `AdminCollectionConfig`: al fusionarse el campo, `CollectionConfig`
pasa a ser el tipo de autoría.

:::note[Por qué un proyecto BaaS no paga ningún coste]
Un tipo de propiedad en una instalación BaaS no contiene `Field`, `columnWidth` ni
`hideFromCollection` —estos residen en `AdminPropertyOptions` dentro del paquete admin. Esta
garantía se afirma en pruebas, no solo conceptualmente: `e2e/baas-typecheck/src/admin_absent.ts` utiliza
`@ts-expect-error` sobre `admin`, de modo que la compilación falla si el campo vuelve a ser modificable en
el núcleo (core).
:::

### Migrar desde una colección plana

Antes de la versión 0.11, estos campos se encontraban en el nivel superior. Para moverlos:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

La herramienta reportará cualquier elemento que no pueda mover de forma segura —especialmente aspectos de presentación dentro de
`relations[].overrides`, que requieren definir `overrides: { admin: { … } }` manualmente.

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

## Propiedades Clave

### Identificación

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `slug` | `string` | **Obligatorio.** Identificador seguro para URLs. Se utiliza en la URL de la interfaz de administración y en la ruta de la API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obligatorio.** Nombre visible (plural). Se muestra en la navegación y en los encabezados de página. |
| `singularName` | `string` | Nombre visible para una entidad individual. Se utiliza en "Nuevo Producto", "Editar Producto", etc. |
| `description` | `string` | Una frase sobre el contenido de esta colección, mostrada sobre la lista. Admite Markdown. |
| `table` | `string` | Nombre de la tabla en PostgreSQL. Por defecto es `toSnakeCase(slug)` —configúralo solo para desacoplar la URL de la tabla, por ejemplo, una tabla existente `blog_posts` expuesta en `/posts`. |
| `admin.icon` | `string` | Un nombre de icono de [Lucide](https://lucide.dev/icons), p. ej. `"FileText"`, `"ShoppingCart"`. Un elemento renderizado también funciona, pero el nombre persiste a la serialización, por lo que es lo que el editor de esquemas escribe de vuelta. |

### Esquema

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `properties` | `Properties` | **Obligatorio.** Mapa de clave de propiedad → definición de propiedad. Cada clave se convierte en una columna de la base de datos. |
| `relations` | `Relation[]` | Relaciones SQL — claves foráneas, tablas de unión. Consulta [Relaciones](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Row Level Security. Consulta [Reglas de Seguridad](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices de Postgres que requiere esta tabla. Consulta [Índices](/docs/backend/indexes). |
| `search` | `SearchConfig` | Búsqueda de texto completo (full-text) con ranking sobre los campos que especifiques, incluyendo contenido JSONB y arrays. Solo Postgres. Consulta [Búsqueda](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marca la colección como una colección de autenticación (gestión de usuarios, restablecimiento de contraseña, etc.) |
| `schema` | `string` | Esquema de Postgres en el que reside la tabla — `"public"`, `"rebase"`, `"auth"`. Por defecto es `"public"`. |
| `disableDefaultPolicies` | `boolean` | Elimina las políticas base que inyecta el generador —un SELECT para admin/servidor y, en colecciones de autenticación, una lectura propia más una barrera de escritura exclusiva para admin— y asume la responsabilidad completa del RLS de esta colección. `false` por defecto. Consulta [Reglas de Seguridad](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Convierte la operación `delete` en una marca temporal y oculta las filas marcadas de todas las lecturas. `true` usa `deletedAt`; la variante de objeto renombra el campo. La colección debe declarar esa propiedad `date` por sí misma. Solo Postgres — consulta [Borrado suave (Soft delete)](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rechaza con un error 400 cualquier escritura que mencione un campo no declarado por esta colección. `true` por defecto. Configúralo en `false` solo cuando la columna exista genuinamente pero no esté declarada —por ejemplo, si la llena un trigger o se obtiene por introspección en vez de declararse explícitamente. |

### Configuración de la Interfaz de Usuario

Todo lo siguiente se ubica dentro de `admin`.

| Propiedad | Tipo | Por defecto | Descripción |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modo de vista por defecto |
| `enabledViews` | `ViewMode[]` | Las cuatro | Qué modos de vista están disponibles |
| `kanban` | `KanbanConfig` | — | Configuración de Kanban (propiedad de columna). Debe combinarse siempre con `orderProperty` — consulta [Modos de Vista](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Clave de la propiedad de tipo **string** que almacena el orden para arrastrar y soltar. Requerido para el funcionamiento del tablero Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Cómo se abren las entidades para su edición |
| `sideDialogWidth` | `number \| string` | — | Ancho del panel lateral |
| `inlineEditing` | `boolean` | `true` | Habilita la edición en línea en la vista de hoja de cálculo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altura de fila por defecto en la tabla |
| `pagination` | `boolean \| number` | `true` (50) | Habilita la paginación y/o establece el tamaño de página |
| `listProperties` | `string[]` | — | Propiedades para mostrar en la vista de lista |
| `propertiesOrder` | `string[]` | — | Orden de las columnas en la vista de tabla |
| `selectionEnabled` | `boolean` | `true` | Habilita la selección de filas |
| `hideFromNavigation` | `boolean` | `false` | Oculta la colección de la barra de navegación lateral |
| `defaultSelectedView` | `string \| function` | — | Vista o subcolección seleccionada por defecto al abrir |

### Opciones de Entidad

Dentro de `admin`, excepto `history`, que es una característica de backend y permanece en el nivel superior.

| Propiedad | Tipo | Por defecto | Descripción |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Autoguardado al modificar un campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Respaldo de cambios no guardados |
| `hideIdFromForm` | `boolean` | `false` | Oculta el ID de la entidad en el formulario |
| `hideIdFromCollection` | `boolean` | `false` | Oculta la columna ID de la tabla |
| `includeJsonView` | `boolean` | `true` | Ofrece la visualización de valores en bruto en el inspector de registros |
| `history` | `boolean` | `false` | Realiza seguimiento de cambios en el historial de la entidad |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplica valores por defecto en cada guardado |
| `previewProperties` | `string[]` | — | Propiedades a mostrar en las vistas previas de referencias |
| `display` | `EntityDisplay` | — | Qué elemento llena cada rol visual — consulta [Visualización de entidades](#visualización-de-entidades) |

### Opciones Avanzadas

En el nivel superior, ya que el backend las lee:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | Las colecciones anidadas bajo una entidad de esta colección. Se completan durante la normalización a partir de cómo las exprese el driver —un `subcollections` de Firestore, una relación `hasMany` de Postgres— por lo que un driver personalizado es el único motivo para definirlas a mano |
| `dataSource` | `string` | Qué fuente de datos registrada respalda esta colección (por defecto: la no nombrada) |
| `engine` | `string` | El motor subyacente — `"postgres"`, `"firestore"`, `"mongodb"`. Se resuelve a partir de `dataSource`; establécelo únicamente para sobrescribirlo |
| `databaseId` | `string` | Base de datos o esquema dentro del motor |
| `metadata` | `Record<string, unknown>` | Cualquier dato que tu propio código necesite asociar a una colección. Rebase no lo lee; se mantiene inalterado tras la serialización |
| `ownerId` | `string` | **Solo en formularios de administración — no impuesto por la API ni la base de datos.** El ID de usuario que el editor de colecciones asigna a una colección creada y muestra junto a su nombre. Ninguna lógica en la ruta de peticiones lo consulta |

`subcollections` y `path` aplican únicamente a las configuraciones de **bases de datos orientadas a documentos** —
`FirebaseCollectionConfig` y, en el caso de `path`, `MongoDBCollectionConfig`:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Solo Firestore.** Colecciones anidadas bajo cada documento. Una colección de Postgres expresa lo mismo mediante una [relación](/docs/collections/relations) `hasMany`, que es la que alimenta `childCollections` |
| `path` | `string` | **Solo Firestore y MongoDB.** La ruta o nombre de la colección en el motor, cuando difiere del slug |

Y dentro de `admin`, ya que únicamente el panel las dibuja:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Acciones personalizadas sobre entidades (archivar, publicar, etc.) |
| `admin.Actions` | `React.ComponentType` | Componente personalizado para acciones en la barra de herramientas |
| `admin.entityViews` | `EntityCustomView[]` | Pestañas personalizadas en la vista de detalle de la entidad |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Columnas computadas/virtuales |
| `admin.exportable` | `boolean \| ExportConfig` | Habilita la exportación de datos |
| `admin.components` | `CollectionComponentOverrideMap` | Sobrescrituras de componentes de UI a nivel de colección |

Escribir cualquiera de estas seis en el nivel superior provocará un error durante el inicio, con un mensaje
indicando la clave y la ubicación a la que fue trasladada.

## Visualización de entidades

Cada superficie que renderiza un registro dibuja un subconjunto de seis roles: **title** (título),
**subtitle** (subtítulo), **image** (imagen), **status** (estado), **date** (fecha) y **tags** (etiquetas). Una fila de lista está compuesta por imagen +
título + subtítulo + estado + fecha; una tarjeta es lo mismo pero con la imagen en la parte superior; un
selector de referencias usa título + subtítulo; y el encabezado de una página es únicamente el título.

Cada rol se deriva de tus propiedades, y cada uno puede especificarse alternativamente como una
ruta de propiedad o como una función:

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

Cualquier elemento que omitas conservará su valor derivado, por lo que definir un rol no
te obliga a definir los seis.

### Roles computados y asíncronos

Un resolver puede ser `async`, lo cual permite que un rol consulte datos que el registro
no contiene directamente —un documento en una subcolección, un valor tras una API:

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

Mientras la promesa está en curso, la superficie muestra el valor derivado y lo sustituye por
el resuelto una vez recibido —un título nunca muestra un spinner. Los resultados se almacenan en caché
por registro y por rol, y las consultas concurrentes para el mismo par comparten una sola llamada, por lo
que una lista de cincuenta filas resuelve cada fila una sola vez en lugar de hacerlo en cada renderizado.

Devuelve `undefined` cuando un registro no tenga contenido para ese rol; el mecanismo de reserva (fallback)
propio de la superficie sabe mejor qué debe mostrarse en su lugar (un encabezado usa el
nombre singular de la colección, un enlace usa el ID). Un resolver que lance una excepción se trata
como `undefined` y se registra una sola vez —un título que no se puede obtener no debe
romper la fila que lo muestra.

Da preferencia a una ruta siempre que el valor esté presente en el registro: una ruta conserva la
forma de renderizado propia de la propiedad, de modo que un estado enum sigue siendo un chip de color y una fecha
se mantiene formateada, algo que un resolver que devuelve un string simple no puede expresar.

:::note[`titleProperty` reemplazado]
`admin.titleProperty` se eliminó en favor de `admin.display.title`. La misma
cadena funciona allí, y el nuevo campo también admite una función resolver. Si una colección
aún conserva la clave anterior, será rechazada por `defineCollection` con el error habitual
de clave desconocida.
:::

### Selección de la Propiedad de Título
Cuando `display.title` no está definido, la propiedad que se utiliza como título visible de la entidad (vistas previas, encabezados) se resuelve automáticamente:
1. Si `propertiesOrder` está definido explícitamente, se selecciona como título la primera propiedad que no sea un ID y que sea de tipo `relation` o `string`.
2. Si no se define `propertiesOrder`, el framework busca en las propiedades en orden y toma la primera propiedad de tipo string.

### Vistas previas de Relaciones en Tablas
Cuando `propertiesOrder` se define explícitamente, las propiedades de relación **no** se filtran automáticamente de las columnas de vista previa por defecto (a diferencia de lo que ocurre en los valores por defecto sin ordenar, donde se excluyen para evitar operaciones de join lentas).

### Cómo se renderiza el valor de un título
Independientemente de lo que contenga la propiedad de título, el panel renderiza una cadena de texto. Una fecha se formatea, un array se une mediante comas, y una relación —que llega como `{ id, data: { values } }` en lugar de como texto simple— se inspecciona buscando el primer valor existente entre `name`, `title`, `label` o `displayName` en la fila relacionada, recurriendo a su ID como alternativa. Por lo tanto, un título puede hacer referencia a una propiedad de tipo `relation` y seguir mostrándose como un nombre en lugar de un UUID.

Esto no es un helper exportado: es el comportamiento predeterminado que ya ejecuta cualquier superficie que dibuje un registro. No requiere invocar ni importar nada.

## Constructor de Colecciones (Collection Builder)

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

## Filtrado y Ordenación

Puedes definir filtros por defecto o forzados. Ambos corresponden a la presentación —con qué estado
se abre el panel—, por lo que residen en `admin`:

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

Un `fixedFilter` restringe lo que el panel *solicita*; no representa un límite de seguridad. Lo que un
cliente tiene permitido leer se define mediante una [regla de seguridad](/docs/collections/security-rules),
la cual es impuesta por la base de datos para cualquier solicitante, use o no el panel.

## Próximos Pasos

- **[Callbacks de Entidad](/docs/collections/callbacks)** — Hooks de ciclo de vida para sincronizar datos entre colecciones, validación y efectos secundarios
- **[Propiedades](/docs/collections/properties)** — Todos los tipos de propiedades y sus opciones
- **[Relaciones](/docs/collections/relations)** — Claves foráneas, tablas de unión, joins
- **[Reglas de Seguridad](/docs/collections/security-rules)** — Row Level Security
- **[Modos de Vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
