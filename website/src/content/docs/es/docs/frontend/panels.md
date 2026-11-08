---
sourceHash: 29030083cf83fb27
title: Paneles en una página propia
sidebar_label: Paneles en tus propias páginas
description: "Muestra una colección, el formulario de un registro, un registro o un valor en una página propia: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue y CollectionsProvider, sin el shell de administración alrededor."
---

En 0.24,
`CollectionPanel` solo acepta un `path` registrado y muestra "Collection not
found" fuera del árbol de administración completo, y `EntityFormPanel` y
`CollectionsProvider` no existen.

No necesitas todo el panel de administración para mostrar una sola tabla. `<CollectionPanel>` toma
la colección como un valor y funciona en cualquier lugar bajo `<Rebase>` y un enrutador de React
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

Un registro se abre sobre tu página, en un panel lateral o un diálogo, y nunca por URL:
ninguna ruta de administración sirve la página, por lo que `full_screen` y `split` se abren como un panel
lateral, y `useUrlController().routesMounted` es `false` para tus propios componentes
allí. Cualquier enrutador funciona: un `<BrowserRouter>` simple, un
`<MemoryRouter>` o un enrutador de datos. Aún se requiere un enrutador. Un enrutador de datos
también permite que un registro con cambios sin guardar detenga la navegación dentro de la aplicación; con los
demás, solo el aviso del navegador para abandonar la página lo protege. Envuelve el panel en `<RebaseAuthGate>` si la página
debe mostrar primero el inicio de sesión de Rebase.

## Qué muestra un panel

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Un panel dibuja la colección tal como lo hace el administrador. Estas props la restringen a lo
que tu página necesita; ninguna de ellas cambia la página propia de la colección.

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

- `fields` — las propiedades que muestra, en este orden, y nada más. En la
  tabla son las columnas. En la lista, en una tarjeta y en una tarjeta kanban
  son de donde se rellenan las ubicaciones de la fila (título, imagen, subtítulo, estado, fecha,
  chips de relación, las columnas de la lista), las primeras primero; una ubicación que ninguna
  de ellas llene se queda vacía. Para este panel, tiene prioridad sobre `propertiesOrder`, el
  orden de columnas guardado por el usuario y `listProperties`. Los anchos de columna arrastrados por un usuario
  aún persisten; el orden es tuyo, por lo que las columnas no se pueden arrastrar.
- `toolbar` — la barra de herramientas completa por defecto, `null` para ninguna, o una compuesta por
  sus partes: `CollectionToolbar` (con `start` y `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  y `CollectionAddButton`. Leen el panel en el que están dibujados y lanzan un error
  en cualquier otro lugar. Los slots de plugins y la sobreescritura de `Collection.Actions` residen en la
  barra de herramientas predeterminada.
- `onRowClick` — se llama con la fila clicada en lugar de que el panel la abra,
  desde una fila, una tarjeta, una tarjeta kanban y la acción de edición. La fila es la que
  envía el servidor, la forma que aceptan `useRows`, `useRow` y `<FieldValue>`: cadenas de
  fecha ISO (`YYYY-MM-DD` para una columna solo de fecha), y una relación belongsTo
  como su clave foránea (`customerId`), no bajo el nombre de la relación.
- `viewMode` — el modo en el que se abre, con prioridad sobre el de la URL y el último que la
  persona eligió. Aún pueden cambiar de modo.
- `title={false}` — sin título encima del panel, ni el propio encabezado de la vista de lista.
- `updateUrl` — desactivado por defecto: el panel no lee ni escribe los parámetros
  `__view`, de filtro y de ordenación de la página.

Las `entityActions` de la colección se dibujan en cada fila, tarjeta y tarjeta kanban, como
botones cuando se declaran con `collapsed: false` y en el menú de la fila en caso contrario; un
"Aprobar" en cada tarjeta es una acción.

Un panel se dimensiona según sus filas. Sin una altura proveniente de su elemento padre, o solo con un
`max-height`, una colección corta dibuja su barra de herramientas y filas, y una larga
se desplaza dentro del espacio que tiene, hasta la altura de la ventana. Asígnale una altura para
llenarla. Se adapta a su propio ancho, no al de la ventana: en una columna
estrecha utiliza su diseño compacto, sin importar la pantalla.

`propertiesOrder` reordena y nunca oculta: una propiedad que omita se dibuja
después de las que nombra. Para ocultar una en todas partes, configúrale `admin.hideFromCollection`;
para mostrar solo algunas en un lugar, pasa `fields`.

## Formulario de un registro

`<EntityFormPanel>` hace lo mismo para el formulario de un registro. Carga el registro
mediante `entityId`, lo guarda a través de la capa de datos de `<Rebase>` como lo hace el
propio formulario de administración, y llama a `onSaved` después de cada guardado. Omite `entityId` para crear un
registro. `onClose` se llama cuando el formulario solicita salir, por ejemplo después de
que se elimina su registro:

```tsx
<EntityFormPanel
    collection={postsCollection}
    entityId={postId}
    onSaved={({ entity }) => console.log("saved", entity.id)}
    onClose={() => navigate("/posts")}/>
```

Si alguien más elimina el registro mientras el formulario está abierto, el formulario conserva
lo que se escribió e indica que el registro fue eliminado en otro lugar. Su acción "Guardar como nuevo"
lo convierte en un formulario que crea un nuevo registro con esos valores;
luego, `onSaved` reporta el nuevo registro.

<span class="since-badge" data-since="0.29">Desde 0.29</span> El formulario puede mostrar
parte de un registro o estructurarlo a tu manera. `fields` solo muestra los campos que
nombra, en ese orden; las secciones y el rail mantienen su agrupación. `layout`
reemplaza los campos generados con tu propio JSX, en el cual
`<FormField name="…"/>` dibuja un campo con la etiqueta, el tamaño y las reglas que
le da el formulario generado:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    entityId={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

De cualquier manera, el formulario solo valida los campos que muestra; el servidor sigue
comprobando todo el registro. Un formulario que crea un registro y omite un
campo requerido sin un valor por defecto lo avisa al abrirse: un error indica el nombre del
campo, y la opción Guardar permanece bloqueada hasta que el campo se muestre o se le asigne un valor por defecto.
`collectionOverrides` cambia la colección solo para este formulario, como lo hace para
`CollectionPanel`.

Cada formulario delimita sus IDs del DOM, por lo que dos formularios pueden compartir una página. Para encontrar un campo
desde una prueba, selecciona `[data-form-field="title"]` dentro del
`[data-form-path="posts"]` del formulario.

<span class="since-badge" data-since="0.29">Desde 0.29</span>
`<EntityViewPanel>` es el gemelo de solo lectura de `EntityFormPanel`. Carga el
registro por `entityId` y lo dibuja tal como lo hace la página de registros de administración: las
mismas secciones y etiquetas, con cada valor como su vista previa, de modo que un enum se muestra como su
chip, una fecha en su zona horaria y una relación como el título de su destino. Acepta
`fields` y `collectionOverrides` tal como lo hace el formulario, y omite los campos
que el formulario omite: aquellos que una regla `conditions.hidden` oculta para este registro, y
aquellos que el usuario autenticado no tiene permiso para leer.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    entityId={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` dibuja un valor de la misma manera, dentro de tu propio JSX. Toma la
fila completa, tal como la devuelven `useRows`, `useRow` y `client.data`, porque una
relación belongsTo llega bajo su columna de clave foránea (`customerId`), no
bajo el nombre de la propiedad; `field="customer"` la encuentra allí. Requiere que la
colección esté registrada por encima de él, mediante `<RebaseCMS>` o un `CollectionsProvider`.
Una colección o campo desconocido lanza un error que indica su nombre.

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

## Varios paneles en un mismo ámbito

Los tres paneles incluyen su propio `CollectionsProvider` cuando no hay ninguno por encima de ellos. Ese es
el paso subyacente, y puedes montarlo tú mismo para compartir un mismo ámbito entre
varios paneles, o para usar las piezas de nivel inferior (`CollectionViewBinding`,
`useSidePanel`) debajo de él. Dentro de él, un panel puede nombrar su colección por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantiene un registro de las colecciones que le pasas, con los
`modifyCollection` e `injectCollections` de tus plugins aplicados como en el
administrador, además de los paneles laterales y diálogos en los que se abren los registros, y la
protección contra cambios no guardados. Mantén estable el array `collections`: una constante de módulo
o `useMemo`.

## A continuación

- [Personalizar la administración](/docs/frontend/customizing): los lugares donde puede ir un componente
  tuyo y las recetas creadas a partir de estos paneles.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` y
  `useRowWrites`, las filas que leen estos paneles y `FieldValue`.
- [Reemplazos de componentes](/docs/frontend/component-overrides): reemplaza la vista
  o el formulario que dibuja un panel.
