---
sourceHash: a9be6e44e281baff
title: Paneles en una página propia
sidebar_label: Paneles en tus propias páginas
description: "Muestra una colección, el formulario de un registro, un registro o un valor en una página propia: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue y CollectionsProvider, sin un shell de administración a su alrededor."
---

En 0.24,
`CollectionPanel` solo acepta un `path` registrado y renderiza "Collection not
found" fuera del árbol de administración completo, y `EntityFormPanel` y
`CollectionsProvider` no existen.

No necesitas todo el panel de administración para mostrar una sola tabla. `<CollectionPanel>` toma
la colección como un valor y funciona en cualquier lugar bajo `<Rebase>` y un router de React
Router, sin `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>`:

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
componentes allí. Cualquier router funciona: un `<BrowserRouter>` convencional, un
`<MemoryRouter>` o un data router. Aún así, se requiere un router. Un data router
también permite que un registro con cambios sin guardar detenga la navegación dentro de la aplicación; en los
demás, solo el aviso de abandono de página del navegador lo protege. Envuelve el panel en `<RebaseAuthGate>` si la página
debe mostrar primero el inicio de sesión de Rebase.

## Qué muestra un panel

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Un panel dibuja la colección tal como lo hace el admin. Estas props lo limitan a lo que
tu página necesita; ninguna de ellas cambia la página propia de la colección.

```tsx
import {
    CollectionAddButton,
    CollectionFiltersButton,
    CollectionPanel,
    CollectionSearchBar,
    CollectionToolbar
} from "@rebasepro/cms";

<CollectionPanel
    collection={ordersCollection}
    viewMode="cards"
    fields={["number", "status", "total"]}
    toolbar={<CollectionToolbar
        start={<CollectionFiltersButton/>}
        end={<><CollectionSearchBar/><CollectionAddButton/></>}/>}
    onRowClick={(order) => setSelected(order.id)}
    className="max-h-[480px]"/>
```

- `fields` — las propiedades que muestra, en este orden y nada más. En la
  tabla son las columnas. En la lista, en una tarjeta y en una tarjeta kanban
  son aquello con lo que se rellenan las ubicaciones de la fila (título, imagen, subtítulo, estado, fecha,
  chips de relación, las columnas de la lista), las primeras primero; una ubicación que ninguna
  de ellas rellene permanece vacía. Para este panel, prevalece sobre `propertiesOrder`, el
  orden de columnas que un usuario guardó y `listProperties`. Los anchos de columna que un usuario arrastra
  siguen persistiendo; el orden es tuyo, por lo que las columnas no se arrastran.
- `toolbar` — la barra de herramientas completa por defecto, `null` para ninguna, o una compuesta por
  sus partes: `CollectionToolbar` (con `start` y `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  y `CollectionAddButton`. Leen el panel en el que están dibujados y lanzan un error
  en cualquier otro lugar. Los slots de plugins y la sobreescritura `Collection.Actions` residen en la
  barra de herramientas por defecto.
- `onRowClick` — se llama con la fila clicada en lugar de que el panel la abra,
  desde una fila, una tarjeta, una tarjeta kanban y la acción de edición. La fila es la que el
  servidor envía, la estructura que reciben `useRows`, `useRow` y `<FieldValue>`: `id`,
  cadenas de fecha ISO (`YYYY-MM-DD` para una columna de solo fecha) y una relación belongsTo
  como su clave foránea (`customerId`). Una relación cuyo destino fue cargado por el panel
  llega anidada bajo su nombre, tal como la devuelve el `include` de REST
  (`order.customer` es la fila del cliente); su clave foránea también está allí.
- `highlightedIds` — los ids de las filas mostradas como seleccionadas, por ejemplo la que una página
  muestra junto a la lista: `highlightedIds={selected ? [selected] : []}`.
  `[]` no dibuja ninguna. Sin esto, el panel resalta la última fila abierta.
- `viewMode` — el modo en el que se abre, con prioridad sobre el de la URL y el que la
  persona seleccionó por última vez. Aún así, pueden cambiar de modo.
- `title={false}` — sin título encima del panel, ni el encabezado propio de la vista de lista.
- `updateUrl` — desactivado por defecto: el panel no lee ni escribe los parámetros
  `__view`, de filtrado ni de ordenación de la página.

Las `entityActions` de la colección se dibujan en cada fila, tarjeta y tarjeta kanban, como
botones cuando se declaran `collapsed: false` y en el menú de la fila en caso contrario; un
"Approve" en cada tarjeta es una acción.

Un panel ajusta su tamaño a sus filas. Sin una altura proveniente de su padre, o solo con un
`max-height`, una colección corta dibuja su barra de herramientas y filas, y una larga
se desplaza dentro del espacio que tiene, hasta la altura de la ventana. Asígnale una altura para
llenarla. Se organiza según su propio ancho, no el de la ventana: en una columna
estrecha utiliza su diseño compacto, sin importar la pantalla.

`propertiesOrder` reordena y nunca oculta: una propiedad que omite se dibuja
después de las que nombra. Para ocultar una en todas partes, establece `admin.hideFromCollection`
en ella; para mostrar solo algunas en un solo lugar, pasa `fields`.

## El formulario de un registro

`<EntityFormPanel>` hace lo mismo para el formulario de un solo registro. Carga el registro
por `id`, lo guarda a través de la capa de datos de `<Rebase>` como lo hace el propio
formulario del admin, y llama a `onSaved` después de cada guardado con el registro guardado tal como el
servidor envía la fila, `row`, y su `id`. Omite `id` para crear un
registro. `onClose` se llama cuando el formulario solicita salir, por ejemplo después de
que su registro haya sido eliminado:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Si alguien más elimina el registro mientras el formulario está abierto, el formulario conserva
lo que se escribió e indica que el registro fue eliminado en otro lugar. Su acción "Save as new"
lo convierte en un formulario que crea un nuevo registro con esos valores;
`onSaved` luego informa el nuevo registro.

<span class="since-badge" data-since="0.29">Desde 0.29</span> El formulario puede mostrar
parte de un registro o distribuirlo a tu manera. `fields` muestra solo los campos que
nombra, en ese orden; las secciones y el rail mantienen su agrupación. `layout`
reemplaza los campos generados con tu propio JSX, en el que
`<FormField name="…"/>` dibuja un campo con la etiqueta, tamaño y reglas que el
formulario generado le asigna:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    id={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

De cualquier manera, el formulario solo valida los campos que muestra; el servidor aún
comprueba el registro completo. Un formulario que crea un registro y omite un
campo requerido sin valor por defecto lo indica al abrirse: un error nombra el
campo y la opción Guardar permanece bloqueada hasta que el campo se muestre o se le asigne un valor por defecto.
`collectionOverrides` modifica la colección solo para este formulario, tal como lo hace para
`CollectionPanel`.

Cada formulario delimita el alcance de sus IDs de DOM, por lo que dos formularios pueden compartir una página. Para encontrar un campo
desde una prueba, selecciona `[data-form-field="title"]` dentro de
`[data-form-path="posts"]` del formulario.

<span class="since-badge" data-since="0.29">Desde 0.29</span>
`<EntityViewPanel>` es el gemelo de solo lectura de `EntityFormPanel`. Carga el
registro por `id` y lo dibuja tal como lo hace la página de registro del admin: las mismas
secciones y etiquetas, con cada valor como su vista previa, de modo que un enum se muestra como su
chip, una fecha en su zona horaria y una relación como el título de su destino. Acepta
`fields` y `collectionOverrides` al igual que el formulario, y omite los campos
que el formulario omite: aquel que una regla `conditions.hidden` oculte para este registro y
aquel que el usuario que ha iniciado sesión no pueda leer.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` dibuja un solo valor de la misma manera, dentro de tu propio JSX. Toma la
fila completa, tal como la devuelven `useRows`, `useRow` y `client.data`, porque una
relación belongsTo llega bajo su columna de clave foránea (`customerId`), no
bajo el nombre de la propiedad; `field="customer"` la encuentra allí. Necesita que la
colección esté registrada por encima de él, mediante `<RebaseCMS>` o un `CollectionsProvider`.
Una colección o campo desconocido lanza un error que lo nombra.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} collection="orders" field="customer"/>
            <FieldValue row={row} collection="orders" field="status"/>
            <FieldValue row={row} collection="orders" field="placedAt"/>
        </div>
    ));
}
```

## Varios paneles en un mismo alcance

Los tres paneles incorporan su propio `CollectionsProvider` cuando no hay ninguno por encima de ellos. Ese es
el paso que está por debajo, y puedes montarlo tú mismo para compartir un alcance entre
varios paneles, o para utilizar las piezas de nivel inferior (`CollectionViewBinding`,
`useSidePanel`) debajo de él. Dentro de él, un panel puede nombrar su colección por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantiene un registro de las colecciones que le pasas, con
el `modifyCollection` e `injectCollections` de tus plugins aplicados como en el
admin, además de los paneles laterales y diálogos en los que se abren los registros, y la
protección contra cambios sin guardar. Mantén estable el array `collections`: una constante de módulo
o `useMemo`.

## Pasos siguientes

- [Personalizar el admin](/docs/frontend/customizing): los lugares donde puede
  ir un componente tuyo y las recetas creadas a partir de estos paneles.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` y
  `useRowWrites`, las filas que leen estos paneles y `FieldValue`.
- [Sobrescribir componentes](/docs/frontend/component-overrides): reemplaza la vista
  o el formulario que dibuja un panel.
