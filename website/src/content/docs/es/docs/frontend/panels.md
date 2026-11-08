---
sourceHash: 2db0eecc6b1d8e7d
title: Paneles en tu propia página
sidebar_label: Paneles en tus propias páginas
description: "Muestra una colección, el formulario de un registro, un registro o un valor en tu propia página: CollectionPanel, RecordForm, RecordDetail, FieldValue y CollectionsProvider, sin un shell de administración alrededor."
---

En 0.24
`CollectionPanel` solo acepta un `path` registrado y renderiza "Collection not
found" fuera del árbol completo de administración, y `EntityFormPanel` y
`CollectionsProvider` no existen.

No necesitas toda la administración para mostrar una tabla. `<CollectionPanel>` toma
la colección como un valor y funciona en cualquier lugar bajo `<Rebase>` y un enrutador
de React Router, sin `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un registro se abre sobre tu página, en un panel lateral o un cuadro de diálogo, y nunca por URL:
ninguna ruta de administración sirve la página, por lo que `full_screen` y `split` se abren como un
panel lateral, y `useUrlController().routesMounted` es `false` para tus propios
componentes allí. Cualquier enrutador funciona: un simple `<BrowserRouter>`, un
`<MemoryRouter>` o un enrutador de datos (data router). Aún se requiere un enrutador. Un enrutador de datos
también permite que un registro con cambios no guardados detenga la navegación dentro de la aplicación; en
los demás, solo el aviso del navegador para abandonar la página lo protege. Envuelve el panel en `<RebaseAuthGate>` si la página
debe mostrar primero el inicio de sesión de Rebase.

## Qué muestra un panel

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Un panel dibuja la colección tal como lo hace la administración. Estas props la adaptan
a lo que tu página necesita; ninguna de ellas modifica la propia página de la colección.

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

`collection` acepta el nombre de la colección, como aquí, o la colección misma como
un valor (`collection={ordersCollection}`); `path` también le da nombre y direcciona una
subcolección mediante su ruta completa.

- `fields` — las propiedades que muestra, en este orden y nada más. En la
  tabla son las columnas. En la lista, en una tarjeta y en una tarjeta kanban son
  de donde se llenan los espacios de la fila — título, imagen, subtítulo, estado, fecha,
  chips de relación, las columnas de la lista —, los primeros primero; un espacio que ninguno
  de ellos llena permanece vacío. Para este panel tiene prioridad sobre `propertiesOrder`, el
  orden de columnas guardado por un usuario y `listProperties`. Los anchos de columna que un usuario
  arrastra siguen persistiendo; el orden es tuyo, por lo que las columnas no se pueden arrastrar.
- `toolbar` — `"full"`, el valor predeterminado; `"compact"`, que es la búsqueda, el
  selector de modo de vista y Nuevo (donde el usuario puede crear); `"none"` (o `null`)
  para ninguno; o uno compuesto por sus piezas: `CollectionToolbar` (con `start` y `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  y `CollectionAddButton`. Leen el panel en el que están dibujados y lanzan un error
  en cualquier otro lugar. Los slots de plugins y la anulación `Collection.Actions` residen en la
  barra de herramientas predeterminada.
- `onRowClick` — se llama con la fila clicada y su id en lugar de que el panel
  la abra, desde una fila, una tarjeta, una tarjeta kanban y la acción de edición. La fila es
  la que envía el servidor, con la estructura que reciben `useRows`, `useRow` y `<FieldValue>`:
  exactamente sus columnas, cadenas de fecha ISO (`YYYY-MM-DD` para una columna de solo
  fecha) y una relación belongsTo como su clave foránea (`customerId`). Una relación cuyo destino
  cargó el panel llega anidada bajo su nombre, tal como la devuelve el `include` de REST
  (`order.customer` es la fila del cliente); su clave foránea también está allí. El
  id es la cadena con la que la administración se refiere al registro — su clave primaria, o
  las partes de una clave compuesta unidas por `:::` —, la cual reciben `highlightedIds` y
  `useSidePanel().open`. `row.id` es la columna `id` del registro, si la
  tabla tiene una, con el tipo de esa columna: `5` para una clave entera, cuyo id es
  `"5"`.
- `rowActions` — tu propio JSX en cada fila, tarjeta y tarjeta kanban, recibiendo
  la fila y su id: un "Aprobar", un "Enviar". En la tabla es la última columna,
  siempre visible; en una fila de lista, una tarjeta y una tarjeta kanban se sitúa junto a las
  propias acciones de la colección. Un clic sobre ella no abre el registro y se
  vuelve a dibujar con el estado de tu componente, por lo que una bandera `saving` la deshabilita.
- `orderBy` — el orden en que se abren las filas, `"placed_at:desc"` o
  `["placed_at", "desc"]`. El usuario aún puede ordenar por otra columna.
- `highlightedIds` — los ids de las filas dibujadas como seleccionadas, como la que una página
  muestra junto a la lista, por ejemplo: `highlightedIds={selected ? [selected] : []}`.
  `[]` no dibuja ninguna. Sin esto, el panel resalta la última fila abierta. Los ids
  se comparan como cadenas, por lo que `5` y `"5"` para una clave entera representan la misma fila.
- `where` — qué filas contiene, tal como lo recibe `useRows`:
  `where={{ status: ["==", "pending"] }}`. Los filtros que el usuario establece en otros
  campos se combinan con él, y sus propios campos no se pueden modificar ni borrar desde
  la barra de herramientas. Sigue la prop, por lo que una barra de pestañas o una barra de gráfico seleccionada
  pueden controlarlo desde el estado. Prevalece sobre el `fixedFilter` de la colección, campo por
  campo.
- `viewMode` — el modo en el que se abre, con prioridad sobre el de la URL y el
  último que eligió el usuario. Aún puede cambiarlo.
- `title={false}` — sin título sobre el panel, ni el encabezado propio de la vista de lista.
- `updateUrl` — desactivado por defecto: el panel no lee ni escribe los parámetros
  `__view`, de filtrado o de ordenación de la página.

Las `entityActions` de la colección se dibujan en cada fila, tarjeta y tarjeta kanban, como
botones cuando se declaran `collapsed: false` y en el menú de la fila en caso contrario; un
"Aprobar" en cada tarjeta es una acción.

Un panel se dimensiona según sus filas. Sin una altura proveniente de su elemento contenedor, o solo con un
`max-height`, una colección corta dibuja su barra de herramientas y sus filas, y una larga
hace scroll dentro del espacio que tiene, hasta la altura de la ventana. Asígnale una altura para
rellenarlo. Se distribuye según su propio ancho, no el de la ventana: en una columna
estrecha utiliza su diseño compacto, sin importar la pantalla.

`propertiesOrder` reordena y nunca oculta: una propiedad que omite se dibuja
después de las que nombra. Para ocultar una en todas partes, configúrale `admin.hideFromCollection`;
para mostrar solo algunas en un lugar determinado, pasa `fields`.

## Formulario de un registro

`<RecordForm>` hace lo mismo para el formulario de un solo registro (se llamaba `EntityFormPanel`
antes de la versión 0.29; ese nombre todavía funciona y emite una advertencia una vez). Carga el registro
por `id`, lo guarda a través de la capa de datos de `<Rebase>` tal como lo hace el propio
formulario de la administración, y llama a `onSaved` después de cada guardado con el registro guardado tal como
el servidor envía la fila, `row`, y su `id`. Omite `id` para crear un
registro. `onClose` se llama cuando el formulario solicita salir, por ejemplo
después de eliminar su registro:

```tsx
<RecordForm
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Al igual que `CollectionPanel`, el formulario y `RecordDetail` aceptan una
colección registrada mediante su nombre, sin necesidad de tener el objeto de configuración a mano:
`<RecordForm collection="posts" id={postId}/>` (`path="posts"` también funciona). Bajo `<RebaseCMS>` o un
`CollectionsProvider` que la registre, eso es todo lo que necesitan. Sin un ámbito
superior, pasa la colección como un valor, como aquí, y el panel aportará el
suyo propio; si se nombra mediante una ruta que nada registra, indicará que el registro no fue encontrado.

Si otra persona elimina el registro mientras el formulario está abierto, el formulario conserva
lo que se escribió y avisa que el registro fue eliminado en otro lugar. Su acción "Guardar como nuevo"
lo convierte en un formulario que crea un nuevo registro con esos valores;
luego, `onSaved` reporta el nuevo registro.

<span class="since-badge" data-since="0.29">Desde 0.29</span> El formulario puede mostrar
parte de un registro o distribuirlo a tu manera. `fields` muestra únicamente los campos que
nombra, en ese orden; las secciones y el riel (rail) mantienen su agrupación. Los elementos secundarios
reemplazan los campos generados con tu propio JSX, en el cual
`<FormField name="…"/>` dibuja un campo con la etiqueta, el tamaño y las reglas que el
formulario generado le asigna:

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

`compact` es la versión densa del formulario para una tarjeta lateral o un panel de 350–700px: sin riel
junto a los campos (su contenido se pliega en la columna), sin metadatos del registro,
controles de altura media y espaciado (padding) más ajustado:
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

De cualquier manera, el formulario solo valida los campos que muestra; el servidor sigue
comprobando todo el registro. Un formulario que crea un registro y omite un
campo obligatorio sin valor por defecto lo indica cuando se abre: un error nombra el
campo y el botón Guardar permanece bloqueado hasta que se muestre el campo o se le asigne un valor por defecto.
`collectionOverrides` modifica la colección solo para este formulario, tal como lo hace para
`CollectionPanel`.

Cada formulario aísla el alcance (scope) de sus IDs de DOM, por lo que dos formularios pueden compartir página. Para buscar un campo
desde una prueba, selecciona `[data-form-field="title"]` dentro de
`[data-form-path="posts"]` del formulario.

<span class="since-badge" data-since="0.29">Desde 0.29</span>
`<RecordDetail>` es el gemelo de solo lectura de `RecordForm`. Carga el
registro por `id` y lo dibuja tal como lo hace la página de registro de la administración:
las mismas secciones y etiquetas, con cada valor como su vista previa, de modo que un enum se muestra como su
chip, una fecha en su zona horaria y una relación como el título de su destino. Acepta
`fields` y `collectionOverrides` al igual que el formulario, y omite los campos
que el formulario omite: aquellos que una regla `conditions.hidden` oculta para este registro y
aquellos que el usuario autenticado no tiene permiso para leer.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` dibuja un valor de la misma manera, dentro de tu propio JSX: pásale el
valor tal como lo envía el servidor. Una relación belongsTo llega como su clave foránea
(`order.customerId`), por lo que `field="customer" value={order.customerId}` dibuja el
título del registro relacionado; nombrar la clave foránea directamente, `field="customerId"`,
hace lo mismo. Necesita que la colección esté registrada en un nivel superior, mediante `<RebaseCMS>`
o un `CollectionsProvider`. Una colección o campo desconocido lanza un error
que lo nombra.

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

## Varios paneles en un mismo ámbito

Los tres paneles traen su propio `CollectionsProvider` cuando no hay ninguno por encima de ellos. Ese es
el paso subyacente, y puedes montarlo tú mismo para compartir un único ámbito entre
varios paneles, o para usar las piezas de nivel inferior (`CollectionViewBinding`,
`useSidePanel`) debajo de él. Dentro de él, un panel puede nombrar su colección por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantiene un registro de las colecciones que le pasas, con los
`modifyCollection` e `injectCollections` de tus plugins aplicados como en la
administración, además de los paneles laterales y cuadros de diálogo en los que se abren los registros, y el
protector de cambios no guardados. Mantén estable el array `collections`: una constante de módulo
o `useMemo`.

## Siguiente

- [Personalización de la administración](/docs/frontend/customizing): los lugares
  donde puede ir un componente tuyo y las recetas creadas a partir de estos paneles.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` y
  `useRowWrites`, las filas que estos paneles y `FieldValue` leen.
- [Sustitución de componentes](/docs/frontend/component-overrides): reemplaza la vista
  o el formulario que dibuja un panel.
