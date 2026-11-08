---
sourceHash: 99297021573eef28
title: Paneles en una página propia
sidebar_label: Paneles en tus propias páginas
description: "Muestra una colección, el formulario de un registro, un registro o un valor en una página propia: CollectionPanel, EntityFormPanel, RecordDetail, FieldValue y CollectionsProvider, sin el shell de administración a su alrededor."
---

En 0.24
`CollectionPanel` solo acepta un `path` registrado y renderiza "Collection not
found" fuera del árbol de administración completo, y `EntityFormPanel` junto con
`CollectionsProvider` no existen.

No necesitas todo el panel de administración para mostrar una sola tabla. `<CollectionPanel>` toma
la colección como un valor y funciona en cualquier lugar bajo `<Rebase>` y un router de React
Router, sin necesidad de `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>`:

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

Un registro se abre sobre tu página, en un panel lateral o en un diálogo, y nunca mediante URL:
ninguna ruta de administración sirve la página, por lo que `full_screen` y `split` se abren como un panel
lateral, y `useUrlController().routesMounted` es `false` para tus propios
componentes allí. Cualquier router funciona: un simple `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Aún así, se requiere un router. Un data router
también permite que un registro con cambios no guardados detenga la navegación dentro de la aplicación; bajo
los demás, solo el aviso del navegador al abandonar la página lo protege. Envuelve el panel en `<RebaseAuthGate>` si la página
debe mostrar primero el inicio de sesión de Rebase.

## Qué muestra un panel

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Un panel dibuja la colección tal como lo hace el panel de administración. Estas props lo adaptan a lo que
tu página necesita; ninguna de ellas cambia la página propia de la colección.

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

`collection` toma el nombre de la colección, como aquí, o la colección misma como
un valor (`collection={ordersCollection}`); `path` también la nombra y hace referencia a una
subcolección mediante su ruta completa.

- `fields` — las propiedades que muestra, en este orden, y nada más. En la
  tabla son las columnas. En la lista, en una tarjeta y en una tarjeta kanban son
  los elementos a partir de los cuales se llenan los espacios de la fila (título, imagen, subtítulo, estado, fecha,
  chips de relación, las columnas de la lista), procesando los primeros antes; un espacio que ninguno
  de ellos llene permanece vacío. Para este panel, tiene prioridad sobre `propertiesOrder`, el
  orden de columnas que un usuario guardó y `listProperties`. Los anchos de columna que un usuario arrastra
  siguen persistiendo; el orden es el tuyo, por lo que las columnas no se arrastran.
- `toolbar` — `"full"`, el valor predeterminado; `"compact"`, que incluye la búsqueda, el
  selector de modo de vista y Nuevo (donde el usuario puede crear); `"none"` (o `null`)
  para ninguna; o una compuesta por sus partes: `CollectionToolbar` (con `start` y `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  y `CollectionAddButton`. Estos leen el panel en el que están dibujados y lanzan un error
  en cualquier otro lugar. Los slots de plugins y la sobreescritura de `Collection.Actions` residen en la
  barra de herramientas predeterminada.
- `onRowClick` — se llama con la fila clicada y su id en lugar de que el panel
  la abra, desde una fila, una tarjeta, una tarjeta kanban y la acción de edición. La fila es
  la que envía el servidor, la misma estructura que aceptan `useRows`, `useRow` y `<FieldValue>`:
  exactamente sus columnas, cadenas de fecha ISO (`YYYY-MM-DD` para una
  columna de solo fecha), y una relación belongsTo como su clave foránea (`customerId`). Una relación cuyo destino
  fue cargado por el panel llega anidada bajo su nombre, tal como la devuelve el `include` de REST
  (`order.customer` es la fila del cliente); su clave foránea también está allí. El
  id es la cadena con la que el administrador referencia el registro —su clave primaria, o las partes de una
  compuesta unidas por `:::`— que reciben `highlightedIds` y
  `useSidePanel().open`. `row.id` es la columna `id` del registro, donde la
  tabla tenga una, con el tipo de esa columna: `5` para una clave entera, cuyo id es
  `"5"`.
- `rowActions` — tu propio JSX en cada fila, tarjeta y tarjeta kanban, al que se le pasa la
  fila y su id: un "Approve", un "Ship". En la tabla es la última columna,
  siempre visible; en una fila de lista, una tarjeta y una tarjeta kanban se sitúa junto a las
  acciones propias de la colección. Hacer clic en ella no abre el registro, y se
  redibuja con el estado de tu componente, por lo que un indicador `saving` lo deshabilita.
- `orderBy` — el orden en que se abren las filas, `"placed_at:desc"` o
  `["placed_at", "desc"]`. El usuario aún puede ordenar por otra columna.
- `highlightedIds` — los ids de las filas dibujadas como seleccionadas, por ejemplo la que una página
  muestra junto a la lista: `highlightedIds={selected ? [selected] : []}`.
  `[]` no dibuja ninguna. Sin esto, el panel resalta la última fila abierta. Los ids
  se comparan como cadenas, por lo que el `5` de una clave entera y `"5"` son una misma fila.
- `where` — qué filas contiene, tal como lo recibe `useRows`:
  `where={{ status: ["==", "pending"] }}`. Los filtros que el usuario establece en otros
  campos se combinan con él, y sus propios campos no se pueden cambiar ni limpiar desde
  la barra de herramientas. Sigue a la prop, por lo que una barra de pestañas o una barra de gráfico clicada pueden
  controlarlo desde el estado. Prevalece sobre el `fixedFilter` de la colección, campo
  por campo.
- `viewMode` — el modo en el que se abre, por encima del que figure en la URL y del último que el
  usuario haya elegido. Aún pueden cambiarlo.
- `title={false}` — sin título sobre el panel, ni el encabezado propio de la vista de lista.
- `updateUrl` — desactivado por defecto: el panel ni lee ni escribe los parámetros
  `__view`, de filtrado y de ordenación de la página.

Las `entityActions` de la colección se dibujan en cada fila, tarjeta y tarjeta kanban, como
botones cuando se declaran con `collapsed: false` y en el menú de la fila en caso contrario —un
"Approve" en cada tarjeta es una acción.

Un panel ajusta su tamaño a sus filas. Sin una altura proveniente de su elemento padre, o solo con un
`max-height`, una colección corta dibuja su barra de herramientas y filas, y una larga
se desplaza dentro del espacio disponible, hasta la altura de la ventana. Asígnale una altura para
llenarla. Se distribuye según su propio ancho, no el de la ventana: en una columna
estrecha utiliza su diseño compacto, sin importar la pantalla.

`propertiesOrder` reordena y nunca oculta: una propiedad que omita se dibuja
después de las que nombra. Para ocultar una en todas partes, define `admin.hideFromCollection`
en ella; para mostrar solo algunas en un solo lugar, pasa `fields`.

## El formulario de un registro

`<EntityFormPanel>` hace lo mismo para el formulario de un solo registro. Carga el registro
por `id`, lo guarda a través de la capa de datos de `<Rebase>` tal como lo hace el propio
formulario del administrador, y llama a `onSaved` después de cada guardado con el registro guardado tal como el
servidor envía la fila, `row`, y su `id`. Omite `id` para crear un
registro. `onClose` se llama cuando el formulario solicita salir, por ejemplo después de
que su registro sea eliminado:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Al igual que `CollectionPanel`, el formulario y `RecordDetail` aceptan una colección
registrada por su nombre, sin necesidad de tener el objeto de configuración a mano:
`<EntityFormPanel collection="posts" id={postId}/>` (`path="posts"` también funciona). Bajo `<RebaseCMS>` o un
`CollectionsProvider` que la registre, eso es todo lo que necesitan. Sin un ámbito
superior, pasa la colección como un valor, como aquí, y el panel proporciona el
suyo propio; una nombrada por una ruta que nada registre indicará que el registro no fue encontrado.

Si alguien más elimina el registro mientras el formulario está abierto, el formulario conserva
lo que se escribió y notifica que el registro fue eliminado en otro lugar. Su acción "Save as new"
lo convierte en un formulario que crea un nuevo registro con esos valores;
`onSaved` luego informa el nuevo registro.

<span class="since-badge" data-since="0.29">Desde 0.29</span> El formulario puede mostrar
parte de un registro o distribuirlo a tu manera. `fields` muestra solo los campos que
nombra, en ese orden; las secciones y el rail conservan su agrupación. Los children
reemplazan los campos generados con tu propio JSX, en el cual
`<FormField name="…"/>` dibuja un campo con la etiqueta, el tamaño y las reglas que el
formulario generado le asigna:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</EntityFormPanel>
```

`compact` es el formulario denso para una tarjeta lateral o un panel de 350–700px: sin rail
junto a los campos (lo que contiene se pliega en la columna), sin metadatos del registro,
controles de altura media y un padding más ajustado:
`<EntityFormPanel collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

De cualquier manera, el formulario valida únicamente los campos que muestra; el servidor aún
comprueba el registro completo. Un formulario que crea un registro y omite un
campo requerido sin valor predeterminado lo avisa al abrirse: un error nombra el
campo y Guardar permanece bloqueado hasta que el campo se muestre o se le asigne un valor predeterminado.
`collectionOverrides` modifica la colección solo para este formulario, tal como lo hace para
`CollectionPanel`.

Cada formulario delimita el alcance de sus ids de DOM, por lo que dos formularios pueden compartir una página. Para encontrar un campo
desde una prueba, selecciona `[data-form-field="title"]` dentro del
`[data-form-path="posts"]` del formulario.

<span class="since-badge" data-since="0.29">Desde 0.29</span>
`<RecordDetail>` es el gemelo de solo lectura de `EntityFormPanel`. Carga el
registro por `id` y lo dibuja tal como lo hace la página de registro del administrador: las mismas
secciones y etiquetas, con cada valor como su vista previa, de modo que un enum se muestra como su
chip, una fecha en su zona horaria y una relación como el título de su destino. Acepta
`fields` y `collectionOverrides` al igual que el formulario, y omite los campos
que el formulario omite: uno que una regla de `conditions.hidden` oculta para este registro, y
uno que el usuario autenticado no puede leer.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` dibuja un solo valor de la misma manera, dentro de tu propio JSX: pásale el
valor tal como lo envía el servidor. Un belongsTo llega como su clave foránea
(`order.customerId`), por lo que `field="customer" value={order.customerId}` dibuja el
título del registro relacionado; nombrar la clave foránea en sí, `field="customerId"`,
hace lo mismo. Requiere que la colección esté registrada por encima de él, mediante `<RebaseCMS>`
o un `CollectionsProvider`. Una colección o campo desconocido lanza un error
que lo especifica.

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

Los tres paneles aportan su propio `CollectionsProvider` cuando no hay ninguno por encima de ellos. Ese es
el paso que está por debajo, y puedes montarlo tú mismo para compartir un ámbito entre
varios paneles, o para utilizar las partes de nivel inferior (`CollectionViewBinding`,
`useSidePanel`) debajo de él. Dentro de él, un panel puede nombrar su colección por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantiene un registro de las colecciones que le pasas, con el
`modifyCollection` y `injectCollections` de tus plugins aplicados como en el
administrador, además de los paneles laterales y diálogos en los que se abren los registros, y la
protección contra cambios sin guardar. Mantén el array `collections` estable: una constante de módulo,
o `useMemo`.

## Siguiente

- [Personalizar el admin](/docs/frontend/customizing): los lugares donde puede ir un componente
  tuyo, y las recetas construidas a partir de estos paneles.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` y
  `useRowWrites`, las filas que estos paneles y `FieldValue` leen.
- [Sustituciones de componentes](/docs/frontend/component-overrides): reemplaza la vista
  o el formulario que dibuja un panel.
