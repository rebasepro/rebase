---
sourceHash: 6f0489ae490ff4b1
title: Colecciones
sidebar_label: Colecciones
description: Las colecciones son el bloque de construcción fundamental de Rebase — cada colección se asigna a una tabla de base de datos y define su esquema, relaciones, seguridad y comportamiento de interfaz de usuario.
---

## ¿Qué es una Colección?

Una **colección** es un objeto de TypeScript que describe una tabla de base de datos y cómo debe aparecer en Rebase CMS. Define:

- **Esquema** — Propiedades (columnas), sus tipos y reglas de validación
- **Relaciones** — Claves foráneas (foreign keys), tablas de unión y rutas de join
- **Seguridad** — Políticas de Row Level Security
- **Hooks de ciclo de vida** — Callbacks para operaciones de creación, actualización y eliminación
- **Comportamiento del CMS** — Modos de vista, edición en línea, vistas de entidad, acciones — todo bajo `admin`

## Declarar una: `defineCollection`

Envuelve el literal en `defineCollection`. En tiempo de ejecución es la función identidad —devuelve el objeto sin cambios—, por lo que no tiene costo. Lo que aporta es inferencia: un parámetro de tipo `const` captura las claves de tus `properties` como tipos literales, y los campos con forma de clave del bloque `admin` se verifican contra ellas. Un nombre que no sea una de tus propiedades es un **error de compilación**, no solo una sugerencia faltante.

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

Los campos verificados son `display`, `sort`, `propertiesOrder`, `listProperties`,
`previewProperties`, `orderProperty` y los filtros `defaultFilter`, `fixedFilter`
y `filterPresets`. Se aceptan tres formas además de una clave de propiedad simple:

| Forma | Ejemplo | Notas |
| --- | --- | --- |
| Ruta con puntos dentro de un `map` | `"profile.displayName"` | La **raíz** debe ser una propiedad real; la ruta por debajo de ella no se verifica. No aplica en `previewProperties` / `orderProperty`, que toman una clave de nivel superior. |
| Columna de colección secundaria | `"subcollection:orders"` | Solo `propertiesOrder` / `listProperties`. |
| Una clave de `additionalFields` | `"score" as AdditionalFieldKey` | Solo `propertiesOrder` / `listProperties`. Requiere el casteo (cast) — ver abajo. |

`AdditionalFieldDelegate.key` es un `string` plano, por lo que el sistema de tipos no tiene forma de saber qué claves adicionales declara una colección. En lugar de reabrir estos campos a cualquier string, el casteo hace explícita la excepción:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Impórtalo desde `@rebasepro/cms-types` en un proyecto que tenga un panel de administración — esa es la copia que también verifica los tipos del bloque `admin`. Un proyecto BaaS headless, que no tiene bloque admin, importa la misma función desde `@rebasepro/common` en su lugar.

Anotar el tipo directamente sigue funcionando y se sigue verificando:

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

pero una anotación solo *valida la forma* — no puede ver los nombres de tus propiedades, por lo que los campos clave de `admin` recurren a aceptar cualquier string. Prefiere `defineCollection` a menos que necesites nombrar el tipo.

:::note
`buildCollection` y `buildProperty` ya no existen. `buildCollection` es
`defineCollection` sin la inferencia; `buildProperty` envolvía una propiedad en un tipo que
ya tenía. Consulta el [registro de cambios](/docs/changelog) para la migración de una sola línea.
:::

## Anatomía: el contrato y el panel

Un archivo, dos audiencias. Todo lo que le importa a la *base de datos y a la API* se encuentra en el
nivel superior; todo lo que renderiza el *panel de administración* se ubica dentro de `admin`.

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

La separación no es cosmética. Es lo que permite a Rebase ser un backend por sí solo:

- Un proyecto **BaaS o headless** nunca escribe un bloque `admin`. Sus colecciones —o ninguna
  colección en absoluto, ya que el modo BaaS introspecciona la base de datos— describen datos y
  autorización, nada más. `@rebasepro/types` no contiene código de interfaz de usuario, por lo que el
  árbol de dependencias de un proyecto headless se mantiene exclusivo del servidor.
- El **backend nunca lee dentro del bloque**. Se descarta antes de que una colección se
  serialice para el endpoint de contrato o en un bundle de compilación, y se excluye de
  la versión del esquema — por lo que cambiar un icono no reporta cada SDK generado como
  desactualizado.

### El bloque `admin` solo existe si instalas los tipos de admin

`@rebasepro/types` no declara ningún campo `admin` — ni en una colección, ni en una propiedad. En
un proyecto BaaS, escribir uno es un **error de tipo**. `@rebasepro/cms-types` lo vuelve a agregar mediante
declaration merging, por lo que una línea por proyecto lo habilita:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Después de eso, los tipos principales planos incluyen un bloque con tipado completo — un error tipográfico como `icoon` es un error,
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
Una aumentación (augmentation) se aplica a todo el *programa* de TypeScript, y `config/` y `frontend/`
son programas separados — razón por la cual la referencia pertenece al paquete de configuración. No
existe un tipo contenedor `AdminCollectionConfig`: con el campo fusionado, `CollectionConfig`
es el tipo de autoría.

:::note[Por qué un proyecto BaaS no paga nada]
Un tipo de propiedad en una instalación BaaS no tiene `Field`, ni `columnWidth`, ni
`hideFromCollection` — esos residen en `AdminPropertyOptions` en el paquete admin. La
garantía está asegurada, no simplemente asumida: `tests/e2e/baas-typecheck/src/admin_absent.ts` usa
`@ts-expect-error` en `admin`, por lo que la compilación falla si el campo vuelve a ser modificable en
core en algún momento.
:::

### Migrar desde una colección plana

Antes de la versión 0.11, estos campos se encontraban en el nivel superior. Para moverlos:

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

Reporta cualquier cosa que no pueda mover de forma segura — en particular, la presentación dentro de
`relations[].overrides`, que requiere `overrides: { admin: { … } }` manualmente.

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
        icon: "Package"               // Lucide icon name
    }
});

```

## Propiedades clave

### Identificación

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `slug` | `string` | **Requerido.** Identificador seguro para URL. Se utiliza en la URL de la interfaz de administración y en la ruta de la API REST (`/api/data/{slug}`). |
| `name` | `string` | **Requerido.** Nombre para mostrar (plural). Se muestra en la navegación y en los encabezados de página. |
| `singularName` | `string` | Nombre para mostrar para una sola entidad. Se utiliza en "Nuevo producto", "Editar producto", etc. |
| `description` | `string` | Una oración sobre el contenido de esta colección, mostrada arriba de la lista. Markdown. |
| `table` | `string` | Nombre de la tabla de PostgreSQL. Por defecto es `toSnakeCase(slug)` — configúralo solo para desacoplar la URL de la tabla, p. ej., una tabla `blog_posts` existente servida en `/posts`. |
| `admin.icon` | `string` | Un nombre de icono de [Lucide](https://lucide.dev/icons), p. ej., `"FileText"`, `"ShoppingCart"`. Un elemento renderizado también funciona, pero el nombre sobrevive a la serialización, por lo que es lo que el editor de esquema escribe de vuelta. |

### Esquema

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `properties` | `Properties` | **Requerido.** Mapa de clave de propiedad → definición de propiedad. Cada clave se convierte en una columna de base de datos. |
| `relations` | `Relation[]` | Relaciones SQL — claves foráneas, tablas de unión. Consulta [Relaciones](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Row Level Security. Consulta [Reglas de seguridad](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices de Postgres que necesita esta tabla. Consulta [Índices](/docs/backend/indexes). |
| `search` | `SearchConfig` | Búsqueda de texto completo clasificada sobre los campos que especifiques, incluido el contenido JSONB y de arrays. Solo Postgres. Consulta [Búsqueda](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marca la colección como colección de autenticación (gestión de usuarios, restablecimiento de contraseña, etc.) |
| `schema` | `string` | Esquema de Postgres en el que reside la tabla — `"public"`, `"rebase"`, `"auth"`. Por defecto es `"public"`. |
| `disableDefaultPolicies` | `boolean` | Elimina las políticas base que inyecta el generador — un SELECT de admin/servidor y, en una colección de autenticación, una autoléctura más un control de escritura exclusivo para administradores — y asume la responsabilidad total de RLS para esta colección. `false` por defecto. Consulta [Reglas de seguridad](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Convierte `delete` en una marca de tiempo y oculta las filas marcadas de cada lectura. `true` usa `deletedAt`; la forma de objeto renombra el campo. La colección debe declarar esa propiedad `date` por sí misma. Solo Postgres — consulta [Borrado suave](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rechaza una escritura que mencione un campo que esta colección no declara, con un 400. `true` por defecto. Establécelo en `false` solo donde la columna realmente existe y no está declarada — completada por un trigger o introspeccionada en lugar de escrita explícitamente. |

### Configuración de la interfaz de usuario

Todo lo siguiente va dentro de `admin`.

| Propiedad | Tipo | Predeterminado | Descripción |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modo de vista predeterminado |
| `enabledViews` | `ViewMode[]` | Las cuatro integradas más cada vista personalizada declarada (kanban solo cuando existe una propiedad `enum`) | Qué modos de vista están disponibles |
| `kanban` | `KanbanConfig` | — | Configuración de Kanban (propiedad de columna). Emparéjalo siempre con `orderProperty` — consulta [Modos de vista](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Clave de la propiedad de tipo **string** que contiene la clave de ordenamiento por arrastrar y soltar. Requerido para un tablero Kanban funcional |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Desde la vista: `"split"` para lista, `"full_screen"` para tabla y tarjetas, `"side_panel"` para kanban y vistas personalizadas | Cómo se abren las entidades para su edición |
| `sideDialogWidth` | `number \| string` | — | Ancho del diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilita la edición en línea en la vista de hoja de cálculo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Densidad predeterminada de las vistas de lista, tabla y tarjetas (la altura de fila de la tabla) |
| `pagination` | `boolean \| number` | `true` (50) | Habilita la paginación y/o define el tamaño de página. `false` carga cada fila; en desarrollo, la consola advierte una vez cuando son más de 10.000 filas |
| `listProperties` | `string[]` | — | Propiedades para mostrar en la vista de lista |
| `propertiesOrder` | `string[]` | — | Orden de columnas en la vista de tabla |
| `selectionEnabled` | `boolean` | `true` | Habilita la selección de filas |
| `hideFromNavigation` | `boolean` | `false` | Oculta de la navegación de la barra lateral |
| `defaultSelectedView` | `string \| function` | — | Vista o subcolección predeterminada para abrir |

### Opciones de entidad

Dentro de `admin`, excepto `history`, que es una característica de backend y permanece en el nivel superior.

| Propiedad | Tipo | Predeterminado | Descripción |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Guardado automático dos segundos después de una edición, una vez que el formulario valida. Un formulario Nuevo no se guarda hasta que se ingresa algo. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Respaldo de cambios no guardados |
| `hideIdFromForm` | `boolean` | `false` | Oculta el ID de entidad del formulario |
| `hideIdFromCollection` | `boolean` | `false` | Oculta la columna de ID de la tabla |
| `includeJsonView` | `boolean` | `true` | Ofrece los valores sin procesar en el inspector de registros |
| `history` | `boolean` | `false` | Registra cambios en el historial de la entidad |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Cuando se abre un registro existente en el formulario, completa el `defaultValue` declarado de cada propiedad en un valor que el registro deja vacío (`null` o ausente), de modo que la siguiente acción de guardar lo escriba |
| `previewProperties` | `string[]` | — | Propiedades para mostrar en vistas previas de referencia |
| `display` | `EntityDisplay` | — | Qué completa cada rol de visualización — consulta [Visualización de entidad](#visualización-de-entidad) |

### Avanzado

En el nivel superior, porque el backend los lee:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | Las colecciones anidadas bajo una entidad de esta. Se completan durante la normalización a partir de lo que el controlador exprese con ellas — un `subcollections` de Firestore, una relación `hasMany` de Postgres —, por lo que un controlador personalizado es la única razón para configurarlo manualmente |
| `dataSource` | `string` | Qué fuente de datos registrada respalda esta colección (por defecto: la no nombrada) |
| `engine` | `string` | El motor detrás de ella — `"postgres"`, `"firestore"`, `"mongodb"`. Resuelto a partir de `dataSource`; configúralo solo para anularlo |
| `databaseId` | `string` | Base de datos o esquema dentro del motor |
| `metadata` | `Record<string, unknown>` | Cualquier cosa que tu propio código necesite asociar a una colección. Rebase no lo lee; sobrevive a la serialización sin cambios |
| `ownerId` | `string` | **Solo formulario de administración — no aplicado por la API ni por la base de datos.** El id de usuario que el editor de colecciones estampa en una colección que crea y muestra junto a su nombre. Nada en la ruta de solicitud lo consulta |

`subcollections` y `path` están únicamente en las configuraciones de **bases de datos orientadas a documentos** —
`FirebaseCollectionConfig` y, para `path`, `MongoDBCollectionConfig`:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Solo Firestore.** Colecciones anidadas bajo cada documento. Una colección de Postgres expresa lo mismo con una [relación](/docs/collections/relations) `hasMany`, que es lo que completa `childCollections` |
| `path` | `string` | **Solo Firestore y MongoDB.** La ruta o el nombre de la colección en el motor, cuando difiere del slug |

Y dentro de `admin`, porque solo el panel los dibuja:

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Acciones personalizadas en entidades (archivar, publicar, etc.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Componentes de acciones de barra de herramientas personalizadas |
| `admin.entityViews` | `EntityCustomView[]` | Pestañas personalizadas en la vista de detalle de la entidad |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Columnas calculadas/virtuales |
| `admin.exportable` | `boolean \| ExportConfig` | Habilita la exportación de datos |
| `admin.components` | `CollectionComponentOverrideMap` | Anulaciones de componentes de interfaz de usuario a nivel de colección |

Escribir cualquiera de esos seis en el nivel superior es un error en tiempo de arranque, con un mensaje
que indica la clave y hacia dónde se movió.

## Visualización de entidad

Cada superficie que dibuja un registro representa algún subconjunto de seis roles: **title**,
**subtitle**, **image**, **status**, **date** y **tags**. Una fila de lista es imagen +
título + subtítulo + estado + fecha, una tarjeta es lo mismo con la imagen arriba, un
selector de referencias es título + subtítulo, y el encabezado de una página es el título solo.

Cada rol se deriva de tus propiedades y cada uno se puede definir explícitamente en su lugar — como una
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
            subtitle: ({ row }) => `in ${String(row.city)}`        // computed
        }
    }
});
```

Cualquier cosa que omitas conserva su valor derivado, por lo que declarar un rol no
implica tener que declarar los seis.

A un resolver se le pasa `{ row, context }`. `row` es el registro tal como lo
envía el servidor, la forma que devuelven `useRows` y `context.data`: fechas como strings ISO,
un belongsTo como su columna de clave foránea (`authorId`), y con `id` incluido. Una
relación que el admin cargó llega anidada bajo su nombre, tal como la devuelve el `include`
de REST — `row.author` es la fila del autor, junto a `authorId` —, por lo que un
resolver lee el campo de un registro relacionado sin realizar una petición propia:

```typescript
admin: {
    display: {
        // Undefined where the row holds only the author's id.
        subtitle: ({ row }) => typeof row.author === "object" && row.author !== null && "name" in row.author
            ? String(row.author.name)
            : undefined
    }
}
```

### Roles calculados y asíncronos

Un resolver puede ser `async`, lo cual permite que un rol lea algo que el registro
no contiene — un documento en una subcolección, un valor detrás de una API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ row, context }) => {
            const locale = await context.data.exercise_locales.findById(`${String(row.id)}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Mientras la promesa está en curso, la superficie muestra el valor derivado e intercambia el
resuelto cuando llega — un título nunca es un spinner. Los resultados se almacenan en caché
por registro y por rol, y las solicitudes concurrentes para el mismo par comparten una sola llamada, por
lo que una lista de cincuenta filas resuelve cada fila una sola vez en lugar de una vez por renderizado.

Devuelve `undefined` cuando un registro no tenga nada para el rol; el propio fallback
de la superficie está mejor informado sobre lo que corresponde colocar allí en su lugar (un encabezado usa el
nombre singular de la colección, un enlace usa el id). Un resolver que arroja un error se trata
como `undefined` y se registra en log una sola vez — un título que no se puede obtener no debe
romper la fila que lo muestra.

Prefiere una ruta siempre que el valor esté en el registro: una ruta conserva la propia
renderización de la propiedad, por lo que un estado enum se mantiene como un chip coloreado y una fecha permanece
formateada, lo cual un resolver que devuelve un string simple no puede expresar.

:::note[`titleProperty` reemplazado]
`admin.titleProperty` fue eliminado a favor de `admin.display.title`. El mismo
string funciona allí, y el nuevo campo también admite un resolver. Una colección que todavía
conserve la clave antigua es rechazada por `defineCollection` con el error habitual de
clave desconocida.
:::

### Selección de la propiedad de título
Cuando `display.title` no está configurado, la propiedad utilizada como título de visualización de la entidad (vistas previas, encabezados) se resuelve automáticamente:
1. Si `propertiesOrder` está definido explícitamente, se elige la primera propiedad en ese orden que pueda ser un título: un `string`, una `relation` de cardinalidad única o una `reference`. Los identificadores (claves primarias y foráneas, columnas `uuid`, `isId`), campos de subida de archivos y propiedades ocultas nunca califican.
2. Si no se define `propertiesOrder`, se clasifican los mismos candidatos: un string cuya clave nombre una etiqueta (`name`, `title`, `label`, …) primero, luego texto corto simple, un correo electrónico, un enum, texto largo, una relación o selector de usuario, y una referencia al final. Los empates se resuelven según el orden de declaración.

### Vistas previas de relaciones en tablas
Cuando `propertiesOrder` se establece explícitamente, las propiedades de relación **no** se filtran automáticamente de las columnas de vista previa predeterminadas (mientras que sí se excluyen de los valores predeterminados sin ordenar para evitar operaciones de unión lentas).

### Cómo se renderiza el valor de un título
Sin importar lo que contenga la propiedad de título, el panel renderiza un string. Una fecha se formatea, un array se une mediante join, y una relación —que llega como `{ id, data: { values } }` en lugar de texto— se examina en busca del primero de `name`, `title`, `label` o `displayName` en la fila relacionada, luego por su primer valor de texto corto, recurriendo a su id como última opción. De este modo, un título puede nombrar una propiedad `relation` y aun así leerse como un nombre en lugar de un uuid.

Este no es un helper exportado: es lo que cada superficie que dibuja un registro ya hace. No hay nada que invocar ni nada que importar.

## Collection Builder

Para colecciones dinámicas que cambian según el usuario o datos externos, usa una función constructora (builder):

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

El builder también recibe `data`, que lee filas tal como las envía el servidor,
igual que `context.data`: `await data.collection("tenants").find()` se resuelve en
`{ data: rows, meta }`.

## Filtrado y ordenamiento

Puedes establecer filtros predeterminados o forzados. Los tres son presentación —con lo
que se abre el panel—, por lo que residen en `admin`:

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

        // Fixed filter — cannot be changed; filters the user applies
        // on other fields combine with it
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

El usuario todavía puede filtrar una colección que tenga un `fixedFilter`: lo que
aplique en otros campos se combina con él (AND), y los campos fijos permanecen bloqueados.

Un `fixedFilter` restringe lo que el panel *solicita*; no es un límite de seguridad. Lo que un
llamador tiene permitido leer es una [regla de seguridad](/docs/collections/security-rules),
la cual la base de datos aplica para cada invocador, sea el panel o no.

## Gran cantidad de colecciones

Nada en Rebase limita la cantidad de colecciones, pero dos costos aumentan con ella:

- **La primera descarga del admin.** El panel necesita su navegación en el momento en
  que alguien inicia sesión, por lo que la configuración de cada colección se incluye en lo que el
  navegador descarga para la pantalla de inicio de sesión — aproximadamente 2.4 KB minificados cada una, por lo que 200
  colecciones añaden alrededor de 480 KB, cerca de 80 KB comprimidos con gzip. Lo que requiere
  abrir una colección (la tabla, las vistas de registros, el formulario) se carga únicamente en ese momento.
- **`rebase db push`.** Atlas planifica un push calculando las diferencias de todo el esquema, y eso
  crece más rápido que el recuento de tablas: con 400 o más tablas, un push toma decenas de
  segundos — consulta [cuánto tarda un push](/docs/cli/schema#rebase-db-push).

## Próximos pasos

- **[Callbacks de entidad](/docs/collections/callbacks)** — Hooks de ciclo de vida para sincronizar datos entre colecciones, validación y efectos secundarios
- **[Propiedades](/docs/collections/properties)** — Todos los tipos de propiedades y opciones
- **[Relaciones](/docs/collections/relations)** — Claves foráneas, tablas de unión, joins
- **[Reglas de seguridad](/docs/collections/security-rules)** — Row Level Security
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
