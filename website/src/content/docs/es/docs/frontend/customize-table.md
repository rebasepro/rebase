---
sourceHash: 43be070662fffefd
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable define cómo la colección de una tabla difiere de lo que el CMS infiere: etiquetas, icono, vistas, kanban, ranuras de visualización, diseño del formulario, acciones y opciones por campo con componentes de React importados por valor. Cada opción, con su tipo y efecto."
---

Si usas el CMS, cada tabla que sirve el backend ya tiene una colección en
el panel, derivada de la propia tabla (consulta
[cómo las tablas se convierten en colecciones](/docs/collections/)). `customizeTable` define
qué debe diferir y nada más. Reside en el frontend, junto al resto
de tu código de React, por lo que un campo personalizado es un componente que importas como cualquier otro.

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { CustomMarkdownEditor } from "../../../../../components/CustomMarkdownEditor";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",

    defaultViewMode: "cards",
    enabledViews: ["table", "cards", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },

    display: {
        title: "title",
        image: "heroImage",
        status: "status",
        date: "publishDate",
    },

    fields: {
        status: {
            enumLabels: {
                draft:        { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published:    { label: "Published", color: "green" },
                archived:     { label: "Archived", color: "red" },
            },
        },
        title:   { multiline: true },
        content: { Field: CustomMarkdownEditor },
        orgId:   { hidden: true },
        __order: { hidden: true, disabled: true },
    },

    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published"),
        },
    ],
});
```

Pasa el resultado a `<RebaseCMS tableCustomizations={[postsCms]}/>`; consulta
[la vista general del frontend](/docs/frontend/#rebasecms-props).

:::note[¿Vienes de collections?]
Estas son las opciones de presentación del antiguo bloque `admin`, en el nivel
superior y bajo algunos nombres nuevos (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). Usar un nombre antiguo lanza
un error indicando el nuevo.
:::

## Dónde residen los archivos

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Los nombres son una convención. Lo importante es que los resultados lleguen a
`<RebaseCMS tableCustomizations>`. Una tabla sin archivo se muestra tal como fue derivada.

El frontend importa únicamente el **tipo** de la tabla: `import type { posts }`. Una importación
de tipo se elimina cuando se compila el bundle, por lo que los hooks y el código del servidor en
`backend/schema` nunca llegan al navegador. Una importación por valor desde `backend/` en
el código del frontend es lo único que no se debe escribir. El backend nunca importa nada
del frontend.

## El slug y el tipo

El primer argumento es el slug de la tabla: el nombre con el que se definió o el
`slug` que se le asignó. Con la tabla como argumento de tipo, el slug, cada clave
que nombra un campo y cada valor de enum se verifican contra la tabla:

| Comprobado contra `typeof posts` | Un error es |
|---|---|
| el primer argumento | un error de tipo a menos que sea el slug de la tabla |
| claves de `fields` | una clave de columna o un nombre de relación |
| entradas de `fieldOrder`, `listFields`, `form` | un campo, una ruta con puntos hacia uno (`"seo.title"`), `subcollection:<relation>` o la clave de un campo adicional |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | un campo o una ruta hacia uno |
| `kanban.columnField` | una columna que contiene un conjunto cerrado de strings (`col.enum([...])` o `.oneOf([...])`) |
| `kanban.orderField` | una columna de texto |
| `enumLabels`, `enumOrder` | valores que la columna puede contener; una columna sin un conjunto cerrado no acepta ninguno de los dos |
| opciones de campo | las del tipo de columna: `multiline` en una columna de texto, `format` en un número |
| `entityActions[].onClick` y similares | `row` es el `InferRow` de la tabla |

`defineTable("blog_posts", { slug: "posts", … })` se personaliza como
`customizeTable<typeof posts>("posts", …)`: sigue siendo un único argumento de tipo. Sin el
argumento de tipo, `customizeTable("posts", { … })` acepta las mismas opciones,
con tipado flexible.

## Qué se rechaza y qué se omite

`customizeTable` comprueba lo que el compilador no puede ver cuando se carga el módulo y
lanza un error indicando qué escribir en su lugar:

- una opción desconocida, sugiriendo la más cercana conocida, o con el nuevo nombre de una
  opción antigua de `admin`;
- un componente proporcionado como una ruta de texto, un thunk perezoso `() => import(…)` o cualquier
  cosa que no sea un componente de React;
- una acción de entidad sin `name` u `onClick`, una vista personalizada sin
  `Builder`, un `kanban` sin `columnField`, un `referenceTo` que no sea un slug;
- `fields` dentro de los `overrides` de una relación: personaliza el estilo de la tabla de destino con su
  propio `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

El resultado queda congelado. Pasar dos personalizaciones del mismo slug a
`<RebaseCMS>` lanza un error: cuál prevalecería dependería del orden de importación.

Lo que sirve el servidor puede diferir de lo que utilizaste como base al escribir. Una columna puede
no estar disponible para este llamador (consulta [acceso a campos](/docs/collections/field-access/)),
o la tabla puede haber cambiado desde entonces. Eso no es un error en tiempo de ejecución. En
desarrollo, el panel imprime una advertencia por cada discrepancia y la omite:

- una personalización cuyo slug no coincida con ninguna tabla servida se ignora;
- un campo, entrada de columna, ranura de visualización, entrada de formulario o campo kanban que la tabla
  no sirva se descarta;
- una opción que no aplique al tipo del campo (`format` en una columna de texto,
  `enumLabels` en un campo sin un conjunto cerrado) se ignora.

El resto de la personalización se sigue aplicando.

## Opciones de tabla

Cada clave es opcional. Las claves que omitas mantendrán lo que el panel haya derivado.

### Identidad y navegación

| Opción | Tipo | Efecto |
|---|---|---|
| `name` | `string` | La etiqueta en plural: panel lateral (drawer), encabezado de página. De lo contrario, se infiere del nombre de la tabla. |
| `singularName` | `string` | La etiqueta de un registro individual. |
| `description` | `string` | Se muestra debajo del encabezado y en la tarjeta de inicio. |
| `metadata` | `Record<string, unknown>` | Tus propios datos, fusionados sobre los `metadata` de la tabla. |
| `icon` | `string \| ReactNode` | Un nombre de icono de Lucide (`"FileText"`) o un elemento. |
| `group` | `string` | El grupo de navegación. |
| `hideFromNavigation` | `boolean` | No aparece en el drawer. Sigue siendo accesible mediante URL y como destino de referencia. |
| `hideFromEntityViews` | `boolean` | No se ofrece como pestaña en los registros de las tablas que se relacionan con ella. |

### Vistas

| Opción | Tipo | Efecto |
|---|---|---|
| `defaultViewMode` | `ViewMode` | La vista en la que aterriza un visitante: `"list"`, `"table"`, `"cards"`, `"kanban"` o la clave de una vista personalizada. De lo contrario, `"list"`. |
| `enabledViews` | `ViewMode[]` | Las vistas disponibles en el selector. |
| `kanban` | `{ columnField, orderField? }` | El tablero: la columna por la que agrupa y la columna de texto donde guarda las claves de orden. Consulta [Modos de vista](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Más formas de renderizar las filas: `{ key, name, Builder }`, o la clave de una registrada en `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | La altura de fila predeterminada. |

`kanban` acepta dos claves:

| Clave | Tipo | Efecto |
|---|---|---|
| `columnField` | clave de columna | La columna de la que proceden las columnas del tablero: un `col.enum([...])` o `.oneOf([...])` de strings. |
| `orderField` | clave de columna de texto | Dónde se almacena la posición de una tarjeta dentro de su columna, como una clave de orden fraccional. Sin ella, el orden se restablece en cada lectura. |

### Columnas y ranuras

| Opción | Tipo | Efecto |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | El orden en que se dibujan los campos. Los campos no incluidos van a continuación, de modo que nada desaparece. |
| `listFields` | `TableColumnId[]` | Las columnas de la tabla y de la vista de lista: los campos que dibujan y ningún otro. La tabla los ordena según `fieldOrder` (o el orden al que los arrastre el visitante) cuando existe uno, o según `listFields` en caso contrario. Los campos que omite siguen estando en el registro. |
| `previewFields` | `TableFieldKey[]` | Los campos mostrados cuando un registro de esta tabla es referenciado desde otra. |
| `display` | `TableDisplay` | Qué llena los valores de `title`, `subtitle`, `image`, `status`, `date` y `tags` de un registro: una ruta de campo o un resolver. Consulta [ranuras de visualización](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Columnas calculadas de la tabla. No aparecen en el registro a menos que `form.sections` o `form.sidebar` nombren una. Consulta [Columnas adicionales](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Oculta la columna id. |

Una columna calculada acepta:

| Clave | Tipo | Efecto |
|---|---|---|
| `key` | `string` | Identifica la columna. Nómbrala en `fieldOrder` como `"total" as AdditionalFieldKey`. |
| `name` | `string` | El encabezado. |
| `width` | `number` | El ancho, en píxeles. |
| `Builder` | `(props) => ReactNode` | Renderiza la celda a partir de `{ row, id, context }`. |
| `dependencies` | ruta o rutas de campo | Los campos cuyo cambio vuelve a renderizar la celda. |
| `value` | `(props) => string \| number` | El valor de la celda, para exportación. Puede ser asíncrono. |

### Valores predeterminados de consulta

| Opción | Tipo | Efecto |
|---|---|---|
| `sort` | `OrderBySpec` | La ordenación predeterminada: `["publishDate", "desc"]` o varias claves en orden. |
| `fixedFilter` | `FilterValues` | Un filtro que el visitante no puede cambiar. |
| `defaultFilter` | `FilterValues` | El filtro con el que empieza un visitante. |
| `filterPresets` | `FilterPreset[]` | Filtros de un solo clic en la barra de herramientas: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Carga en páginas (`true` o el tamaño de página) o todo a la vez (`false`). |

Consulta [Filtros y ordenación](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportamiento

| Opción | Tipo | Efecto |
|---|---|---|
| `inlineEditing` | `boolean` | Edita celdas directamente en la tabla. |
| `selectionEnabled` | `boolean` | Las filas se pueden seleccionar. |
| `selectionController` | `SelectionController` | Una selección que mantienes fuera de la vista (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Si la barra de herramientas ofrece Exportar y columnas adicionales para ello. Consulta [Importación y exportación](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Cómo se abre un registro. |
| `defaultEntityAction` | `"view" \| "edit"` | Si al hacer clic en un registro se abre para lectura o edición. |
| `sideDialogWidth` | `number \| string` | El ancho del panel lateral en el que se abre un registro. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | La pestaña en la que se abre un registro. |

### Formulario

| Opción | Tipo | Efecto |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Secciones y la barra lateral (rail) junto al formulario. Consulta [Diseño del formulario](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Un componente que reemplaza el formulario generado. `includeActions` mantiene Guardar y Descartar en la barra del registro. |
| `formAutoSave` | `boolean` | Guarda mientras el visitante escribe. |
| `alwaysApplyDefaultValues` | `boolean` | Rellena los valores predeterminados declarados en los campos vacíos de un registro guardado cuando se abre. |
| `includeJsonView` | `boolean` | Añade una pestaña con el registro en formato JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Guarda las modificaciones no guardadas en el almacenamiento local. |
| `hideIdFromForm` | `boolean` | Oculta el id del formulario. |

`form` acepta:

| Clave | Tipo | Efecto |
|---|---|---|
| `sidebar` | ids de campo | Los campos extraídos a la barra lateral junto al formulario. |
| `sections` | secciones | Las secciones de la columna principal, a continuación. |
| `showRecordMeta` | `boolean` | Muestra el id y las marcas de tiempo del registro en la barra lateral. |

Cada sección acepta:

| Clave | Tipo | Efecto |
|---|---|---|
| `key` | `string` | Identifica la sección; también es el `id` de su ancla. |
| `title` | `string` | El encabezado. Ninguno si se omite. |
| `fields` | ids de campo | Los campos de la sección, en orden. |
| `collapsed` | `boolean` | Comienza colapsada. |
| `collapsible` | `boolean` | Se puede colapsar. |
| `readVariant` | `"grid" \| "summary"` | Cómo se presenta la sección cuando el registro se visualiza en lugar de editarse. |

### Acciones, vistas y anulaciones

| Opción | Tipo | Efecto |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Acciones sobre un registro. Un objeto o la clave de uno registrado en `<RebaseCMS entityActions>`. Consulta [Acciones de entidad](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Acciones integradas que esta tabla no ofrece. |
| `resetPasswordAction` | `false \| TableEntityAction` | Solo para la tabla de autenticación (`defineAuthTable`): `false` elimina la acción integrada de restablecer contraseña, una acción la reemplaza (ofrecida independientemente de lo que soporte el adaptador de auth: su backend es tuyo). Se ignora, con una advertencia, en cualquier otra tabla. |
| `entityViews` | `(string \| TableEntityView)[]` | Pestañas adicionales en un registro. Consulta [Vistas de entidad](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Componentes renderizados en la barra de herramientas de la colección. |
| `components` | `TableComponentOverrides` | Anulaciones de componentes a nivel de colección, cada una `{ Component, wrap? }`. Consulta [Anulaciones de componentes](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks que se ejecutan en el panel después de los hooks del servidor. Solo para presentación: se envían a todos los visitantes y no aportan seguridad. Consulta [React hooks](/docs/hooks/). |
| `fields` | `TableFields` | Opciones por campo, organizadas por columna o relación. A continuación. |

## Opciones de campo

`fields.<key>` acepta las opciones que admite cualquier campo, además de las de su tipo
de columna. [Campos](/docs/collections/properties/) muestra cada uno con el widget que
modifica.

### Cualquier campo

| Opción | Tipo | Efecto |
|---|---|---|
| `name` | `string` | La etiqueta. De lo contrario, se infiere de la clave (`publishDate` → "Publish Date"). |
| `description` | `string` | Texto de ayuda debajo del campo. |
| `hidden` | `boolean` | Se mantiene fuera de las vistas de tabla, lista y tarjetas, y fuera del registro: su formulario y su vista de lectura. La API sigue leyéndolo y escribiéndolo. |
| `hiddenInForm` | `boolean` | Se mantiene fuera del registro (su formulario y su vista de lectura). Sigue estando en las vistas. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | El control aparece deshabilitado (en gris). `disabledMessage` explica el motivo a su lado; `clearOnDisabled` limpia el valor cuando se deshabilita. |
| `readOnly` | `boolean` | El valor se muestra como texto, sin control de edición. |
| `Field` | `Component` | Reemplaza el control del formulario. El componente en sí. Consulta [Campos personalizados](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Replaces cómo se muestra el valor fuera del formulario. |
| `Filter` | `Component` | Reemplaza el control de filtrado para este campo. |
| `columnWidth` | `number` | El ancho de la columna en la tabla, en píxeles. |
| `filledByServer` | `boolean` | Un hook del servidor lo rellena al crear: el formulario permite crear un registro sin él. |
| `span` | `1 \| 2 \| 3 \| 4` | Cuántas de las cuatro columnas de la cuadrícula del formulario abarca. |
| `customProps` | `unknown` | Se pasa intacto a tus `Field` y `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Restringe los operadores de filtro ofrecidos. `[]` desactiva el filtrado para este campo. |
| `propertyConfig` | `string` | La clave de un tipo de campo registrado en `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Reglas de lógica JSON que ocultan, deshabilitan o exigen el campo según los valores del registro. Solo en formularios. Consulta [condiciones](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Devuelve las opciones de campo aplicables en el momento, a partir del registro que se está editando. Solo en formularios. |
| `metadata` | `Record<string, unknown>` | Tus propios datos. |

### Columnas de texto y uuid

| Opción | Tipo | Efecto |
|---|---|---|
| `multiline` | `boolean` | Una entrada multilínea, que se expande con su contenido. |
| `markdown` | `boolean` | Un editor de markdown con vista previa. |
| `previewAsTag` | `boolean` | Se muestra como una etiqueta (chip) en lugar de texto. |
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `urlPreview` | `PreviewType \| boolean` | Cómo se previsualiza una URL en el valor: `"image"`, `"video"`, `"audio"`, `"file"`, o `true` para un enlace. |
| `referenceTo` | `string` | La columna almacena la clave de un registro en otra colección, en cualquier fuente de datos: se muestra y selecciona como una referencia al slug de esa colección. Consulta [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Columnas con un conjunto cerrado de valores

Un `col.enum([...])`, un `.oneOf([...])` o un array de cualquiera de ellos:

| Opción | Tipo | Efecto |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Etiquetas para algunos de los valores. Los valores omitidos mantienen su etiqueta y color derivados. |
| `enumOrder` | `value[]` | El orden en el que se ofrecen los valores y en el que se dibujan las columnas del kanban. De lo contrario, el orden propio de la columna. |
| `previewAsTag` | `boolean` | En un `col.enum()`: se dibuja como un chip. |
| `clearable` | `boolean` | En un `col.enum()`: añade un control que establece el valor en `null`. |

Un `EnumLabel` acepta:

| Clave | Tipo | Efecto |
|---|---|---|
| `label` | `string` | El texto en el chip y en el select. |
| `color` | `ColorKey \| ColorScheme` | Una clave de color de chip (`"green"`, `"orangeDark"`) o un esquema `{ color, text }`. Un valor sin esto mantiene su color asignado por defecto. |
| `disabled` | `boolean` | Se muestra, pero no se ofrece para su selección. |

### Columnas numéricas

| Opción | Tipo | Efecto |
|---|---|---|
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `format` | `NumberFormatOptions` | Muestra el número como moneda, porcentaje o con decimales fijos. |

`format` acepta `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (un
código ISO, obligatorio con `"currency"`), `locale` (el del usuario en caso contrario),
`minimumFractionDigits`, `maximumFractionDigits` y `notation`
(`"standard"` o `"compact"`, que escribe `12000` como `12K`). Modifica lo que se
muestra, nunca lo que se almacena.

### Columnas de fecha, timestamp y hora

| Opción | Tipo | Efecto |
|---|---|---|
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `mode` | `"date" \| "date_time"` | Selecciona y muestra solo un día, o un día y una hora. De lo contrario, se infiere del tipo de columna. |
| `timezone` | `string` | La zona horaria IANA en la que se muestra y selecciona el valor (`"Europe/Madrid"`). De lo contrario, la del usuario. |

### Columnas vectoriales

| Opción | Tipo | Efecto |
|---|---|---|
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |

### Columnas de almacenamiento (storage)

| Opción | Tipo | Efecto |
|---|---|---|
| `storage` | `StorageCustomization` | Las funciones de subida que se ejecutan en el navegador. |
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `urlPreview` | `PreviewType \| boolean` | Cómo se previsualiza la URL almacenada. |

`storage` solo acepta funciones; las opciones serializables permanecen en
`col.storage({ … })` (consulta [Subidas de archivos](/docs/collections/file-uploads/)):

| Clave | Firma | Efecto |
|---|---|---|
| `path` | `(context) => string` | La carpeta a la que se sube un archivo, reemplazando la plantilla `path` de la columna. |
| `fileName` | `(context) => string \| Promise<string>` | El nombre de archivo almacenado, reemplazando la plantilla `fileName` de la columna. |
| `processFile` | `(file) => Promise<File>` | Transforma un archivo antes de subirlo. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transforma la ruta o URL almacenada antes de que se escriba en la columna. |
| `previewUrl` | `(fileName) => string` | La URL para previsualizar un archivo almacenado. |

### Columnas de tipo array

| Opción | Tipo | Efecto |
|---|---|---|
| `expanded` | `boolean` | Cada elemento abierto al cargar. |
| `minimalistView` | `boolean` | Elementos sin su marco ni encabezado. |
| `sortable` | `boolean` | Los elementos se pueden reordenar arrastrándolos. |
| `canAddElements` | `boolean` | Se pueden añadir elementos. |
| `of` | opciones de campo | Las opciones de cada elemento. |
| `storage` | `StorageCustomization` | Las funciones de subida, para `col.storage().multiple()`. |

`enumLabels` y `enumOrder` escritos en un array se aplican a sus elementos.

### Columnas JSON

| Opción | Tipo | Efecto |
|---|---|---|
| `expanded` | `boolean` | Los campos del documento abiertos al cargar. |
| `minimalistView` | `boolean` | Los campos del documento sin su marco. |
| `spreadChildren` | `boolean` | Los campos del documento dispuestos como si fueran del propio registro. |
| `keyValue` | `boolean` | Editado como pares clave/valor libres. |
| `previewFields` | `string[]` | Las claves del documento incluidas en su resumen de una línea, en este orden. |
| `fields` | `{ [key]: opciones de campo }` | Las opciones de cada clave del documento. |
| `fieldOrder` | `string[]` | El orden en el que se muestran las claves del documento. |
| `of` | opciones de campo | Las opciones de cada elemento, para un documento que es una lista. |
| `oneOf` | `{ [variant]: opciones de campo }` | Las opciones de cada variante de un bloque tipado (`json.oneOf`). |

Con `col.jsonb().$type<T>()` o una estructura `json.object({…})`, `fields` y `fieldOrder`
están tipados por las claves del documento. Consulta [Arrays y JSON](/docs/collections/arrays-and-maps/).

En una celda de tabla, una fila de lista o una tarjeta, un documento JSON es una sola línea: sus primeras
cuatro claves de nivel superior (o sus `previewFields`), etiquetadas con su `name`, cada
una con su valor si es texto corto, un número o un sí/no, `3 items` para una
lista y `4 fields` para un objeto anidado, el cual no se despliega. Una lista de
documentos muestra su recuento. El documento completo se encuentra en el registro y en el editor expandible
de la celda. Para una mejor presentación de la línea, especifica las claves relevantes en
`previewFields` o asigna al campo un componente `Preview`.

### Relaciones

| Opción | Tipo | Efecto |
|---|---|---|
| `previewFields` | `string[]` | Los campos del destino que se muestran en el chip para una fila relacionada. Caben como máximo tres. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | La(s) fila(s) relacionada(s) con la(s) que comienza el formulario de un nuevo registro: `new EntityRelation(id, "<target slug>")` (`EntityRelation` de `@rebasepro/cms-types`), o una lista para una relación de uno a muchos. Se escribe solo al guardar el formulario. El valor predeterminado propio de una columna es `.default()` en la columna. |
| `widget` | `"select" \| "dialog"` | Cómo se selecciona una fila relacionada. |
| `fixedFilter` | `FilterValues` | Ofrece solo filas que pasen este filtro. |
| `includeId` | `boolean` | Muestra el id de la fila relacionada en las previsualizaciones. |
| `includeEntityLink` | `boolean` | Muestra un enlace que abre la fila relacionada. |
| `renderInForm` | `boolean` | Muestra también una relación de uno a muchos como un selector en el formulario, junto a su pestaña. |
| `overrides` | opciones de tabla sin `fields` | Cómo se presenta el destino en la pestaña de esta relación. |

Consulta [Relaciones en el panel](/docs/collections/relations-in-the-admin-panel/).

## Personalizaciones, `ui-config.json` y preferencias

Lo que el panel muestra para una tabla se compone en un orden fijo, cada capa sobre
la anterior:

1. **La colección derivada**: lo que el panel lee de la tabla que el servidor
   sirve.
2. **Código**: los resultados de `customizeTable` que pasas como `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`**: la presentación del espacio de trabajo,
   pasada como `uiConfig`. Es un archivo en el frontend, editado a mano (o por
   tu agente), de modo que se revisa y despliega con él.
4. **Preferencias del espacio de trabajo**: lo que un administrador guarda en un despliegue, en la
   tabla `rebase.ui_preferences` a través de
   [`/api/admin/ui-config`](/docs/backend/endpoints/). Escribirlas requiere
   `schema:write`.
5. **Preferencias del usuario**: los anchos de columna propios de una persona, cambios de vista y
   columnas ocultas. Se conservan en el navegador mientras no se inicie sesión.

Un `App.tsx` generado con scaffolding ya conecta este archivo:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Las preferencias contienen únicamente la presentación: etiquetas, icono, modos de vista, orden de columnas,
columnas ocultas, etiquetas y colores de enum, kanban y valores predeterminados de consulta. Un dato
del esquema nunca va a parar allí; esos residen en `backend/schema`.

`rebase build` traslada `frontend/src/cms/ui-config.json` al bundle
(`entry.uiConfig`), por lo que un backend desplegado también lo conoce: `GET /api/admin/ui-config`
lo sirve como `shipped` junto a las capas del espacio de trabajo y del usuario, y las vistas de MCP
y `describe_table` combinan las mismas tres capas —el archivo, el espacio de trabajo y
la propia del llamador (ninguna en el caso de una clave de API)— para que un agente vea las etiquetas, el orden,
las columnas ocultas y las etiquetas de enum que una persona ve en el panel.

`rebase verify` lee cada llamada a `customizeTable` en `frontend/src/cms` contra
las tablas, sin ejecutarla: detecta una personalización para una tabla o un
campo que no existe, una columna requerida que el formulario oculta, una tabla
personalizada dos veces, un `ui-config.json` que no se pasa a ningún `<RebaseCMS>` y una
configuración de Vite sin `rebaseBackendGuard()`. Consulta [`rebase verify`](/docs/cli/#rebase-verify).

## Próximos pasos

- [Cómo las tablas se convierten en colecciones](/docs/collections/): lo que el panel infiere antes de todo esto
- [Campos](/docs/collections/properties/): el widget y las opciones de cada tipo de columna
- [Modos de vista](/docs/frontend/view-modes/): tabla, tarjetas, kanban, ranuras de visualización, filtros
- [Acciones de entidad](/docs/frontend/entity-actions/): `entityActions` y `updateRecord`
- [Firestore junto a Postgres](/docs/frontend/firebase/): `externalCollections` y referencias entre motores
