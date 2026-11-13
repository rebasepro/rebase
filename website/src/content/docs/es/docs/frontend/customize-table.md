---
sourceHash: 749d3a5f47923f4d
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable indica cómo la colección de una tabla difiere de lo que el CMS infiere: etiquetas, icono, vistas, kanban, ranuras de visualización, diseño de formularios, acciones y opciones por campo con componentes de React importados por valor. Cada opción, con su tipo y efecto."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Si utilizas el CMS, cada tabla que sirve el backend ya tiene una colección en el
panel, derivada de la propia tabla (consulta
[cómo las tablas se convierten en colecciones](/docs/collections/)). `customizeTable` indica
qué debería diferir, y nada más. Reside en el frontend, junto al resto
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
Estas son las opciones de presentación del antiguo bloque `admin`, en el nivel superior
y bajo algunos nombres nuevos (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). Usar un nombre antiguo generará
un error indicando el nuevo.
:::

## Dónde se ubican los archivos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Los nombres son una convención. Lo importante es que los resultados lleguen a
`<RebaseCMS tableCustomizations>`. Una tabla sin archivo se muestra como derivada.

El frontend importa únicamente el **tipo** de la tabla: `import type { posts }`. Una
importación de tipo se elimina cuando se compila el bundle, por lo que los hooks y el código del servidor en
`backend/schema` nunca llegan al navegador. Una importación de valor desde `backend/` en
el código del frontend es lo único que no se debe escribir. El backend nunca importa nada
del frontend.

## El slug y el tipo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El primer argumento es el slug de la tabla: el nombre con el que se definió o el
`slug` que se le asignó. Con la tabla como argumento de tipo, el slug, cada clave
que nombra un campo y cada valor de enum se verifica contra la tabla:

| Comprobado contra `typeof posts` | Un error es |
|---|---|
| el primer argumento | un error de tipo a menos que sea el slug de la tabla |
| claves de `fields` | una clave de columna o un nombre de relación |
| entradas de `fieldOrder`, `listFields`, `form` | un campo, una ruta con puntos hacia uno (`"seo.title"`), `subcollection:<relation>`, o la clave de un campo adicional |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | un campo o una ruta hacia uno |
| `kanban.columnField` | una columna que contiene un conjunto cerrado de strings (`col.enum([...])` o `.oneOf([...])`) |
| `kanban.orderField` | una columna de texto |
| `enumLabels`, `enumOrder` | valores que la columna puede contener; una columna sin un conjunto cerrado no acepta ninguno |
| opciones de campo | las del tipo de la columna: `multiline` en una columna de texto, `format` en un número |
| `entityActions[].onClick` y similares | `row` es el `InferRow` de la tabla |

`defineTable("blog_posts", { slug: "posts", … })` se personaliza como
`customizeTable<typeof posts>("posts", …)`: sigue siendo un único argumento de tipo. Sin el
argumento de tipo, `customizeTable("posts", { … })` acepta las mismas opciones,
con tipado débil.

## Qué se rechaza y qué se omite

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`customizeTable` comprueba lo que el compilador no puede ver cuando se carga el módulo y
lanza un error indicando qué escribir en su lugar:

- una opción desconocida, sugiriendo la conocida más cercana, o con el nuevo nombre de una
  opción antigua de `admin`;
- un componente proporcionado como una ruta en string, un thunk perezoso `() => import(…)` o cualquier cosa
  que no sea un componente de React;
- una acción de entidad sin `name` u `onClick`, una vista personalizada sin
  `Builder`, un `kanban` sin `columnField`, un `referenceTo` que no sea un slug;
- `fields` dentro de los `overrides` de una relación: personaliza el estilo de la tabla de destino con su
  propio `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

El resultado es inmutable (frozen). Pasar dos personalizaciones del mismo slug a
`<RebaseCMS>` lanza un error: cuál prevalecería dependería del orden de importación.

Lo que sirve el servidor puede diferir de aquello contra lo que escribiste el código. Una columna puede
retenerse para este emisor (consulta [acceso a campos](/docs/collections/field-access/)),
o la tabla puede haber cambiado desde entonces. Eso no es un error en tiempo de ejecución. En
desarrollo, el panel imprime una advertencia por cada discrepancia y la omite:

- se ignora una personalización cuyo slug no coincida con ninguna tabla servida;
- se descarta un campo, entrada de columna, ranura de visualización, entrada de formulario o campo de kanban que la tabla
  no sirva;
- se ignora una opción que no aplique al tipo del campo (`format` en una columna de texto,
  `enumLabels` en un campo sin un conjunto cerrado).

El resto de la personalización se sigue aplicando.

## Opciones de tabla

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada clave es opcional. Una clave que omitas conserva lo que el panel infirió.

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
| `enabledViews` | `ViewMode[]` | Las vistas que se ofrecen en el selector. |
| `kanban` | `{ columnField, orderField? }` | El tablero: la columna por la que agrupa y la columna de texto donde almacena las claves de orden. Consulta [Modos de vista](/docs/frontend/view-modes/#kanban). |
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
| `fieldOrder` | `TableColumnId[]` | El orden en que se dibujan los campos. Los campos omitidos van a continuación, por lo que nada desaparece. |
| `listFields` | `TableColumnId[]` | Las columnas de la vista de lista. |
| `previewFields` | `TableFieldKey[]` | Los campos que se muestran cuando un registro de esta tabla se referencia desde otra. |
| `display` | `TableDisplay` | Lo que rellena `title`, `subtitle`, `image`, `status`, `date` y `tags` de un registro: una ruta de campo o un resolver. Consulta [ranuras de visualización](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Columnas calculadas. Consulta [Columnas adicionales](/docs/frontend/additional-columns/). |
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
| `sort` | `OrderBySpec` | La ordenación predeterminada: `["publishDate", "desc"]`, o varias claves en orden. |
| `fixedFilter` | `FilterValues` | Un filtro que el visitante no puede cambiar. |
| `defaultFilter` | `FilterValues` | El filtro con el que empieza el visitante. |
| `filterPresets` | `FilterPreset[]` | Filtros de un solo clic en la barra de herramientas: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Carga paginada (`true`, o el tamaño de página), o todo a la vez (`false`). |

Consulta [Filtros y ordenación](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportamiento

| Opción | Tipo | Efecto |
|---|---|---|
| `inlineEditing` | `boolean` | Edita celdas directamente en la tabla. |
| `selectionEnabled` | `boolean` | Las filas se pueden seleccionar. |
| `selectionController` | `SelectionController` | Una selección que mantienes fuera de la vista (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Indica si la barra de herramientas ofrece Exportar y columnas adicionales para ello. Consulta [Importación y exportación](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Cómo se abre un registro. |
| `defaultEntityAction` | `"view" \| "edit"` | Si al hacer clic en un registro se abre para lectura o para edición. |
| `sideDialogWidth` | `number \| string` | El ancho del panel lateral en el que se abre un registro. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | La pestaña en la que se abre un registro. |

### Formulario

| Opción | Tipo | Efecto |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Secciones y la barra lateral (rail) junto al formulario. Consulta [Diseño del formulario](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Un componente que reemplaza el formulario generado. `includeActions` mantiene Guardar y Descartar en la barra del registro. |
| `formAutoSave` | `boolean` | Guarda a medida que el visitante escribe. |
| `alwaysApplyDefaultValues` | `boolean` | Rellena los valores predeterminados declarados en los campos vacíos de un registro almacenado cuando se abre. |
| `includeJsonView` | `boolean` | Añade una pestaña con el registro en formato JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Mantiene las modificaciones no guardadas en el almacenamiento local. |
| `hideIdFromForm` | `boolean` | Oculta el id del formulario. |

`form` acepta:

| Clave | Tipo | Efecto |
|---|---|---|
| `sidebar` | IDs de campos | Los campos extraídos hacia la barra lateral junto al formulario. |
| `sections` | secciones | Las secciones de la columna principal, a continuación. |
| `showRecordMeta` | `boolean` | Muestra el id y las marcas de tiempo del registro en la barra lateral. |

Cada sección acepta:

| Clave | Tipo | Efecto |
|---|---|---|
| `key` | `string` | Identifica la sección; también es el `id` de su anclaje. |
| `title` | `string` | El encabezado. Ninguno cuando se omite. |
| `fields` | IDs de campos | Los campos de la sección, en orden. |
| `collapsed` | `boolean` | Comienza colapsada. |
| `collapsible` | `boolean` | Se puede colapsar. |
| `readVariant` | `"grid" \| "summary"` | Cómo se visualiza la sección cuando el registro se muestra en lugar de editarse. |

### Acciones, vistas y overrides

| Opción | Tipo | Efecto |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Acciones sobre un registro. Un objeto, o la clave de uno registrado en `<RebaseCMS entityActions>`. Consulta [Acciones de entidad](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Acciones integradas que esta tabla no ofrece. |
| `resetPasswordAction` | `false \| TableEntityAction` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Solo para la tabla de autenticación (`defineAuthTable`): `false` elimina la acción integrada de restablecer contraseña, una acción la reemplaza (ofrecida independientemente de lo que admita el adaptador de autenticación: el backend es tuyo). Se ignora, con una advertencia, en cualquier otra tabla. |
| `entityViews` | `(string \| TableEntityView)[]` | Pestañas adicionales en un registro. Consulta [Vistas de entidad](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Componentes renderizados en la barra de herramientas de la colección. |
| `components` | `TableComponentOverrides` | Overrides de componentes a nivel de colección, cada uno `{ Component, wrap? }`. Consulta [Overrides de componentes](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks que se ejecutan en el panel después de los hooks del servidor. Solo para presentación: se envían a todos los visitantes y no aportan seguridad. Consulta [React hooks](/docs/hooks/). |
| `fields` | `TableFields` | Opciones por campo, indexadas por columna o relación. A continuación. |

## Opciones de campo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`fields.<key>` acepta las opciones que admite cada campo, además de las de su tipo de
columna. [Campos](/docs/collections/properties/) muestra cada una junto al widget que
modifica.

### Todos los campos

| Opción | Tipo | Efecto |
|---|---|---|
| `name` | `string` | La etiqueta. De lo contrario, se infiere a partir de la clave (`publishDate` → "Publish Date"). |
| `description` | `string` | Texto de ayuda debajo del campo. |
| `hidden` | `boolean` | Se excluye de las vistas de tabla y tarjetas. Permanece en el formulario y sigue siendo leído y escrito por la API. |
| `hiddenInForm` | `boolean` | Se excluye del formulario. Permanece en las vistas. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | El control aparece deshabilitado (en gris). `disabledMessage` explica el motivo a su lado; `clearOnDisabled` borra el valor cuando pasa a estar deshabilitado. |
| `readOnly` | `boolean` | El valor se muestra como texto, sin control interactivo. |
| `Field` | `Component` | Reemplaza el control del formulario. El componente en sí. Consulta [Campos personalizados](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Reemplaza cómo se muestra el valor fuera del formulario. |
| `Filter` | `Component` | Reemplaza el control de filtro para este campo. |
| `columnWidth` | `number` | El ancho de la columna en la tabla, en píxeles. |
| `filledByServer` | `boolean` | Un hook del servidor lo completa en la creación: el formulario permite crear un registro sin él. |
| `span` | `1 \| 2 \| 3 \| 4` | Cuántas de las cuatro columnas de la cuadrícula del formulario ocupa. |
| `customProps` | `unknown` | Se pasa sin modificaciones a tu `Field` y `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Limita los operadores de filtro ofrecidos. `[]` desactiva el filtrado para este campo. |
| `propertyConfig` | `string` | La clave de un tipo de campo registrado en `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Reglas de JSON-logic que ocultan, deshabilitan o hacen requerido el campo a partir de los valores del registro. Solo para formularios. Consulta [condiciones](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Devuelve las opciones de campo que aplican en ese momento, a partir del registro que se está editando. Solo para formularios. |
| `metadata` | `Record<string, unknown>` | Tus propios datos. |

### Columnas de texto y uuid

| Opción | Tipo | Efecto |
|---|---|---|
| `multiline` | `boolean` | Un campo de entrada multilínea, que se expande con su contenido. |
| `markdown` | `boolean` | Un editor de markdown con vista previa. |
| `previewAsTag` | `boolean` | Se muestra como una etiqueta (chip) en lugar de texto. |
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `urlPreview` | `PreviewType \| boolean` | Cómo se previsualiza una URL en el valor: `"image"`, `"video"`, `"audio"`, `"file"` o `true` para un enlace. |
| `referenceTo` | `string` | La columna contiene la clave de un registro de otra colección, en cualquier fuente de datos: se dibuja y se selecciona como una referencia al slug de esa colección. Consulta [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Columnas con un conjunto cerrado de valores

Un `col.enum([...])`, un `.oneOf([...])` o un array de cualquiera de ellos:

| Opción | Tipo | Efecto |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Etiquetas para algunos de los valores. Los valores omitidos conservan su etiqueta y color inferidos. |
| `enumOrder` | `value[]` | El orden en que se ofrecen los valores y en que se dibujan las columnas de kanban. De lo contrario, el orden propio de la columna. |
| `previewAsTag` | `boolean` | En un `col.enum()`: se muestra como un chip. |
| `clearable` | `boolean` | En un `col.enum()`: añade un control que establece el valor en `null`. |

Un `EnumLabel` acepta:

| Clave | Tipo | Efecto |
|---|---|---|
| `label` | `string` | El texto en el chip y en el select. |
| `color` | `ColorKey \| ColorScheme` | Una clave de color de chip (`"green"`, `"orangeDark"`) o un esquema `{ color, text }`. Un valor sin definir conserva su color asignado por defecto. |
| `disabled` | `boolean` | Se muestra, pero no se ofrece para su selección. |

### Columnas numéricas

| Opción | Tipo | Efecto |
|---|---|---|
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `format` | `NumberFormatOptions` | Muestra el número como moneda, porcentaje o con decimales fijos. |

`format` acepta `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (un
código ISO, requerido con `"currency"`), `locale` (de lo contrario, el del visor),
`minimumFractionDigits`, `maximumFractionDigits` y `notation`
(`"standard"` o `"compact"`, que muestra `12000` como `12K`). Modifica lo que se
muestra, nunca lo que se almacena.

### Columnas de fecha, marca de tiempo y hora

| Opción | Tipo | Efecto |
|---|---|---|
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `mode` | `"date" \| "date_time"` | Selecciona y muestra solo un día, o un día y una hora. De lo contrario, se infiere del tipo de columna. |
| `timezone` | `string` | La zona horaria IANA en la que se muestra y selecciona el valor (`"Europe/Madrid"`). De lo contrario, la del visor. |

### Columnas vectoriales

| Opción | Tipo | Efecto |
|---|---|---|
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |

### Columnas de almacenamiento

| Opción | Tipo | Efecto |
|---|---|---|
| `storage` | `StorageCustomization` | Las funciones de subida que se ejecutan en el navegador. |
| `clearable` | `boolean` | Añade un control que establece el valor en `null`. |
| `urlPreview` | `PreviewType \| boolean` | Cómo se previsualiza la URL almacenada. |

`storage` solo acepta funciones; las opciones serializables permanecen en
`col.storage({ … })` (consulta [Subida de archivos](/docs/collections/file-uploads/)):

| Clave | Firma | Efecto |
|---|---|---|
| `path` | `(context) => string` | La carpeta a la que se sube un archivo, reemplazando la plantilla `path` de la columna. |
| `fileName` | `(context) => string \| Promise<string>` | El nombre del archivo almacenado, reemplazando la plantilla `fileName` de la columna. |
| `processFile` | `(file) => Promise<File>` | Transforma un archivo antes de subirlo. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transforma la ruta o URL almacenada antes de que se escriba en la columna. |
| `previewUrl` | `(fileName) => string` | La URL en la que previsualizar un archivo almacenado. |

### Columnas de array

| Opción | Tipo | Efecto |
|---|---|---|
| `expanded` | `boolean` | Cada elemento abierto al cargar. |
| `minimalistView` | `boolean` | Elementos sin su marco ni encabezado. |
| `sortable` | `boolean` | Los elementos se pueden reordenar arrastrándolos. |
| `canAddElements` | `boolean` | Se pueden añadir elementos. |
| `of` | opciones de campo | Las opciones de cada elemento. |
| `storage` | `StorageCustomization` | Las funciones de subida, para `col.storage().multiple()`. |

`enumLabels` y `enumOrder` definidos en un array se aplican a sus elementos.

### Columnas JSON

| Opción | Tipo | Efecto |
|---|---|---|
| `expanded` | `boolean` | Los campos del documento abiertos al cargar. |
| `minimalistView` | `boolean` | Los campos del documento sin su marco. |
| `spreadChildren` | `boolean` | Los campos del documento distribuidos como si fueran los propios del registro. |
| `keyValue` | `boolean` | Editado como pares clave/valor libres. |
| `previewFields` | `string[]` | Las claves del documento que se muestran en su vista previa. |
| `fields` | `{ [key]: opciones de campo }` | Las opciones de cada clave del documento. |
| `fieldOrder` | `string[]` | El orden en que se muestran las claves del documento. |
| `of` | opciones de campo | Las opciones de cada elemento, para un documento que es una lista. |
| `oneOf` | `{ [variant]: opciones de campo }` | Las opciones de cada variante de un bloque tipado (`json.oneOf`). |

Con `col.jsonb().$type<T>()` o una forma `json.object({…})`, `fields` y `fieldOrder`
están tipados según las claves del documento. Consulta [Arrays y JSON](/docs/collections/arrays-and-maps/).

### Relaciones

| Opción | Tipo | Efecto |
|---|---|---|
| `previewFields` | `string[]` | Los campos del destino que se muestran en el chip para una fila relacionada. Caben como máximo tres. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | La(s) fila(s) relacionada(s) con la(s) que comienza el formulario de un nuevo registro: `new EntityRelation(id, "<target slug>")` (`EntityRelation` de `@rebasepro/cms-types`), o una lista para una relación de uno a muchos (to-many). Se escribe únicamente al guardar el formulario. El valor predeterminado propio de una columna es `.default()` en la columna. |
| `widget` | `"select" \| "dialog"` | Cómo se selecciona una fila relacionada. |
| `fixedFilter` | `FilterValues` | Ofrece solo las filas que pasen este filtro. |
| `includeId` | `boolean` | Muestra el id de la fila relacionada en las vistas previas. |
| `includeEntityLink` | `boolean` | Muestra un enlace que abre la fila relacionada. |
| `renderInForm` | `boolean` | También dibuja una relación to-many como un selector en el formulario, junto a su pestaña. |
| `overrides` | opciones de tabla sin `fields` | Cómo se presenta el destino en la pestaña de esta relación. |

Consulta [Relaciones en el panel](/docs/collections/relations-in-the-admin-panel/).

## Personalizaciones, `ui-config.json` y preferencias

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Lo que el panel muestra para una tabla se compone en un orden fijo, superponiendo cada capa
sobre la anterior:

1. **La colección derivada**: lo que el panel lee de la tabla que sirve el
   servidor.
2. **Código**: los resultados de `customizeTable` que pasas como `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`**: la presentación del espacio de trabajo tal como la
   guardó el editor de colecciones en desarrollo, pasada como `uiConfig`. Es un
   archivo en el frontend, por lo que se revisa y despliega con él.
4. **Preferencias del espacio de trabajo**: lo que un administrador guarda en un despliegue, en la
   tabla `rebase.ui_preferences` a través de
   [`/api/admin/ui-config`](/docs/backend/endpoints/). Escribirlas requiere
   `schema:write`.
5. **Preferencias de usuario**: los anchos de columna propios de un usuario, cambios de vista y
   columnas ocultas. Se conservan en el navegador mientras la sesión esté cerrada.

Un `App.tsx` generado mediante scaffolding ya conecta este archivo:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Las preferencias solo contienen aspectos de presentación: etiquetas, icono, modos de vista, orden de columnas,
columnas ocultas, etiquetas y colores de enum, kanban y valores predeterminados de consulta. Ningún
dato del esquema termina allí; el [editor de colecciones](/docs/studio/) escribe esos aspectos en
`backend/schema` en su lugar.

`rebase build` traslada `frontend/src/cms/ui-config.json` al bundle
(`entry.uiConfig`), de modo que un backend desplegado también lo conoce: `GET /api/admin/ui-config`
lo sirve como `shipped` junto a las capas del espacio de trabajo y del usuario, y las vistas de MCP
y `describe_table` pliegan las mismas tres capas —el archivo, el espacio de trabajo y
la propia del emisor (ninguna para una API key)—, de modo que un agente ve las etiquetas, el orden,
las columnas ocultas y las etiquetas de enum que una persona ve en el panel.

`rebase verify` lee cada llamada a `customizeTable` en `frontend/src/cms` cotejándola con
las tablas, sin ejecutarla: detecta una personalización para una tabla o un
campo que no existe, una columna requerida que el formulario oculta, una tabla
personalizada dos veces, un `ui-config.json` que no se pasa a ningún `<RebaseCMS>` y una
configuración de Vite sin `rebaseBackendGuard()`. Consulta [`rebase verify`](/docs/cli/#rebase-verify).

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Cómo las tablas se convierten en colecciones](/docs/collections/): lo que el panel infiere antes de todo esto
- [Campos](/docs/collections/properties/): el widget y las opciones de cada tipo de columna
- [Modos de vista](/docs/frontend/view-modes/): tabla, tarjetas, kanban, ranuras de visualización, filtros
- [Acciones de entidad](/docs/frontend/entity-actions/): `entityActions` y `updateRecord`
- [Firestore junto a Postgres](/docs/frontend/firebase/): `externalCollections` y referencias entre motores
