---
sourceHash: 7a427ea4f8f8b272
title: Paneles en tu propia página
sidebar_label: Paneles en tus propias páginas
description: "Muestra una tabla, el formulario de un registro, un registro o un valor en tu propia página: CollectionPanel, RecordForm, RecordDetail, FieldValue y CollectionsProvider, sin un shell de administración a su alrededor."
---

No necesitas todo el panel de administración para mostrar una sola tabla. `<CollectionPanel>` toma
una tabla por su slug y funciona en cualquier lugar bajo `<Rebase>` y un enrutador
de React Router, sin `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection="posts"/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un registro se abre sobre tu página, en un panel lateral o un diálogo, y nunca mediante una URL:
ninguna ruta del admin sirve la página, por lo que `full_screen` y `split` se abren como un panel
lateral, y `useUrlController().routesMounted` es `false` para tus propios
componentes allí. Cualquier enrutador funciona: un `<BrowserRouter>` estándar, un
`<MemoryRouter>` o un data router. Aún así se requiere un router. Un data router
también permite que un registro con cambios sin guardar detenga la navegación dentro de la aplicación; en los
demás, solo el aviso del navegador para abandonar la página lo protege. Envuelve el panel en `<RebaseAuthGate>` si la página
debe mostrar primero el inicio de sesión de Rebase.

## Qué muestra un panel

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un panel dibuja la tabla como lo hace el admin: a partir del descriptor que sirve
el servidor, con cualquier `customizeTable` que hayas registrado. Estas props lo adaptan a lo que
necesita tu página; ninguna de ellas cambia la página propia de la tabla en el admin.

```tsx
import { CollectionPanel } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

<CollectionPanel
    collection="orders"
    viewMode="table"
    fields={["number", "customer", "status", "total"]}
    where={{ status: ["==", "pending"] }}
    orderBy="placed_at:desc"
    toolbar="compact"
    rowActions={(order, id) => (
        <Button size="small" onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>
    )}
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

`collection` toma el slug de la tabla, como aquí, o una colección externa
(`defineFirestoreCollection`) como valor; `path` también le da nombre y direcciona una
colección anidada por su ruta completa.

- `fields`: las propiedades que muestra, en este orden y nada más. En la
  tabla son las columnas. En la lista, en una tarjeta y en una tarjeta kanban son
  aquello con lo que se rellenan las ubicaciones de la fila (título, imagen, subtítulo, estado, fecha,
  chips de relación, las columnas de la lista), las primeras primero; un lugar que ninguna
  de ellas llene se queda vacío. Para este panel tiene prioridad sobre `propertiesOrder`, el
  orden de columnas guardado por un usuario y `listProperties`. El ancho de columnas que un usuario arrastre
  sigue persistiendo; el orden es tuyo, por lo que las columnas no se arrastran.
- `toolbar`: `"full"`, el valor predeterminado; `"compact"`, que incluye la búsqueda, el
  selector de modo de vista y Nuevo (donde la persona puede crear); `"none"` (o `null`)
  para ninguno; o uno compuesto por sus partes: `CollectionToolbar` (con `start` y `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  y `CollectionAddButton`. Estos leen el panel en el que se dibujan y lanzan un error
  en cualquier otro lugar. Los slots de plugins y la sobreescritura de `Collection.Actions` residen en la
  barra de herramientas predeterminada.
- `onRowClick`: se llama con la fila clicada y su id en lugar de que el panel
  la abra, desde una fila, una tarjeta, una tarjeta kanban y la acción de edición. La fila es
  la que envía el servidor, con la estructura que reciben `useRows`, `useRow` y `<FieldValue>`:
  exactamente sus columnas, cadenas de fecha ISO (`YYYY-MM-DD` para una
  columna de solo fecha) y una relación belongsTo como su clave foránea (`customerId`). Una relación cuyo
  destino haya cargado el panel llega anidada bajo su nombre, tal como la devuelve `include` de REST
  (`order.customer` es la fila del cliente); su clave foránea también está allí. El
  id es la cadena mediante la cual el admin direcciona el registro (su clave primaria, o las
  partes de una clave compuesta unidas por `:::`) que reciben `highlightedIds` y
  `useSidePanel().open`. `row.id` es la columna `id` del registro, cuando la
  tabla tiene una, con el tipo de esa columna: `5` para una clave entera, cuyo id es
  `"5"`.
- `rowActions`: tu propio JSX en cada fila, tarjeta y tarjeta kanban, al que se le pasa
  la fila y su id: un "Aprobar", un "Enviar". En la tabla es la última columna,
  siempre visible; en una fila de lista, una tarjeta y una tarjeta kanban se sitúa junto a las
  acciones propias de la colección. Hacer clic en ella no abre el registro y se
  vuelve a dibujar con el estado de tu componente, por lo que un flag `saving` la deshabilita.
- `orderBy`: el orden en el que se abren las filas, `"placed_at:desc"` o
  `["placed_at", "desc"]`. El usuario aún puede ordenar por otra columna.
- `highlightedIds`: los ids de las filas dibujadas como seleccionadas, por ejemplo, la que una página
  muestra junto a la lista: `highlightedIds={selected ? [selected] : []}`.
  `[]` no dibuja ninguna. Sin esta prop, el panel resalta la última fila abierta. Los ids
  se comparan como cadenas, por lo que `5` y `"5"` para una clave entera representan la misma fila.
- `where`: qué filas contiene, tal como lo recibe `useRows`:
  `where={{ status: ["==", "pending"] }}`. Los filtros que el usuario define en otros
  campos se combinan con este, y sus propios campos no se pueden cambiar ni borrar desde
  la barra de herramientas. Sigue el valor de la prop, por lo que una barra de pestañas o una barra de gráfico clicada pueden
  controlarlo desde el estado. Se aplica sobre el `fixedFilter` de la colección, campo por
  campo.
- `viewMode`: el modo en el que se abre, con prioridad sobre el de la URL y el que
  el usuario eligió por última vez. Aun así, puede cambiarlo.
- `title={false}`: sin título sobre el panel, ni el encabezado propio de la vista de lista.
- `updateUrl`: desactivado por defecto: el panel no lee ni escribe los parámetros
  `__view`, de filtrado y de ordenamiento de la página.

Las `entityActions` de la colección se dibujan en cada fila, tarjeta y tarjeta kanban, como
botones cuando se declaran `collapsed: false` y en el menú de la fila en caso contrario; un
"Aprobar" en cada tarjeta es una sola acción.

El tamaño de un panel se adapta a sus filas. Sin una altura proveniente de su elemento padre, o solo con un
`max-height`, una colección corta dibuja su barra de herramientas y filas, y una larga hace
scroll dentro del espacio disponible, hasta la altura de la ventana. Asígnale una altura para
que lo llene. Su maquetación se basa en su propio ancho, no en el de la ventana: en una columna
estrecha utiliza su diseño compacto, sin importar la pantalla.

`fieldOrder` en el `customizeTable` de la tabla reordena y nunca oculta: un campo
que omite se dibuja después de los que nombra. Para excluir uno de la lista
en todas partes, establece `hidden: true` en sus opciones de campo; para mostrar solo algunos en un
lugar concreto, pasa `fields`.

## Formulario de un registro

`<RecordForm>` hace lo mismo para el formulario de un solo registro (se llamaba `EntityFormPanel`
antes de la versión 0.29; ese nombre todavía funciona y emite una advertencia una sola vez). Carga el registro
por `id`, lo guarda a través de la capa de datos de `<Rebase>` como lo hace el propio
formulario del admin y llama a `onSaved` después de cada guardado con el registro guardado tal como el
servidor envía la fila, `row`, y su `id`. Omite `id` para crear un
registro. `onClose` se llama cuando el formulario solicita salir, por ejemplo después de
eliminar su registro:

```tsx
<RecordForm
    collection="posts"
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Al igual que `CollectionPanel`, el formulario y `RecordDetail` toman una tabla por su slug
(`path="posts"` también funciona). Conocen cada tabla que sirve el servidor,
ya sea bajo `<RebaseCMS>`, bajo un `CollectionsProvider` o sin ningún scope superior, en
cuyo caso el panel incluye el suyo propio. Una colección externa se pasa
como valor. Si se nombra una mediante una ruta que nada sirve, indicará que el registro no fue encontrado.

Si otra persona elimina el registro mientras el formulario está abierto, el formulario conserva
lo que se escribió y avisa de que el registro fue eliminado en otro lugar. Su acción "Guardar como nuevo"
lo convierte en un formulario que crea un nuevo registro con esos valores;
a continuación, `onSaved` notifica el nuevo registro.

El formulario puede mostrar
parte de un registro o estructurarlo a tu manera. `fields` muestra solo los campos que
nombra, en ese orden; las secciones y el rail mantienen su agrupación. Los elementos secundarios (children)
reemplazan los campos generados con tu propio JSX, en el cual
`<FormField name="…"/>` dibuja un campo con la etiqueta, el tamaño y las reglas que le asigna el
formulario generado:

```tsx
import { RecordForm, FormField } from "@rebasepro/cms";

<RecordForm collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</RecordForm>
```

`compact` es la versión densa del formulario para una tarjeta lateral o un panel de 350–700px: sin rail
junto a los campos (su contenido se pliega en la columna), sin metadatos del registro,
controles de altura media y un padding más ajustado:
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

De cualquier manera, el formulario solo valida los campos que muestra; el servidor sigue
comprobando todo el registro. Un formulario que crea un registro y omite un
campo obligatorio sin un valor por defecto lo indica al abrirse: un error nombra el
campo y Guardar permanece bloqueado hasta que el campo se muestre o se le asigne un valor por defecto.
`collectionOverrides` modifica la presentación únicamente para este formulario, al igual que lo hace para
`CollectionPanel`.

Cada formulario delimita el alcance de sus IDs de DOM, por lo que dos formularios pueden compartir página. Para buscar un campo
desde una prueba, selecciona `[data-form-field="title"]` dentro de
`[data-form-path="posts"]` del formulario.

`<RecordDetail>` es el equivalente de solo lectura de `RecordForm`. Carga el
registro por `id` y lo dibuja como lo hace la página de registro del admin: las
mismas secciones y etiquetas, con cada valor mostrado como su vista previa, de modo que un enum se muestra como su
chip, una fecha en su zona horaria y una relación como el título de su destino. Acepta
`fields` y `collectionOverrides` al igual que el formulario, y omite los campos
que el formulario omite: aquel que una regla `conditions.hidden` oculta para este registro y
aquel que el usuario autenticado no tiene permisos para leer.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` dibuja un valor de la misma manera, dentro de tu propio JSX: pásale el
valor tal como lo envía el servidor. Un belongsTo llega como su clave foránea
(`order.customerId`), por lo que `field="customer" value={order.customerId}` dibuja el
título del registro relacionado; especificar la clave foránea en sí, `field="customerId"`,
hace lo mismo. Requiere que la tabla sea conocida en un nivel superior, ya sea mediante `<RebaseCMS>` o un
`CollectionsProvider`. Una colección o un campo desconocido lanza un error
indicando su nombre.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(order => (
        <div key={String(order.id)} className="flex gap-4">
            <FieldValue collection="orders" field="customer" value={order.customerId}/>
            <FieldValue collection="orders" field="status" value={order.status}/>
            <FieldValue collection="orders" field="placedAt" value={order.placedAt}/>
        </div>
    ));
}
```

## Varios paneles en un mismo scope

Los tres paneles incorporan su propio `CollectionsProvider` cuando no hay ninguno por encima de ellos. Ese es
el paso subyacente, y puedes montarlo tú mismo para compartir un mismo scope entre
varios paneles, o para utilizar las piezas de nivel inferior (`CollectionViewBinding`,
`useSidePanel`) debajo de él. Recibe las mismas entradas que `<RebaseCMS>`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";
import { postsCms } from "./cms/posts";

const tableCustomizations = [postsCms];

<CollectionsProvider tableCustomizations={tableCustomizations}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` contiene un registro de las tablas que sirve el servidor, con
tus `tableCustomizations` y cualquier `externalCollections`, y los
`modifyCollection` e `injectCollections` de tus plugins aplicados como en el admin, además de los
paneles laterales y diálogos en los que se abren los registros, y la protección para cambios sin guardar. Mantén
los arrays estables: una constante de módulo o `useMemo`. `tables` reemplaza las
tablas servidas con los descriptores que proporciones, para incrustaciones y pruebas.

## Siguiente

- [Personalizar el admin](/docs/frontend/customizing): los lugares donde
  puede ir un componente tuyo y las recetas creadas a partir de estos paneles.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` y
  `useRowWrites`, las filas que estos paneles y `FieldValue` leen.
- [Sobrescribir componentes](/docs/frontend/component-overrides): reemplaza la vista
  o el formulario que dibuja un panel.
