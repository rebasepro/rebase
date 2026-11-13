---
sourceHash: f7689301748e2ce5
title: Tablas en el CMS
sidebar_label: Tablas en el CMS
description: "Cómo muestra el CMS cada tabla de Postgres sin configuración en el frontend: etiquetas, el widget que recibe cada tipo de columna, campos obligatorios y de solo lectura, relaciones, display slots y controles de Crear, Editar y Eliminar que respetan la seguridad a nivel de fila (RLS) de la tabla."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Si usas el CMS, no necesitas describirle tus tablas. Cuando alguien inicia
sesión, el panel solicita al backend las tablas que esa persona puede ver y
muestra cada una como una **colección**: una página en la navegación con una
vista de tabla, un formulario, filtros y las filas relacionadas del registro.
Una tabla es el objeto del backend que declaras en [`backend/schema`](/docs/schema/);
una colección es cómo la muestra el panel.

```tsx
// frontend/src/App.tsx: nothing about posts, users or tags here.
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth/>
    <RebaseCMS/>
    <RebaseShell title="Acme"/>
</Rebase>
```

Todo lo que figura a continuación se deriva del descriptor de la tabla: sus
columnas con sus tipos de Postgres, nulabilidad, valores predeterminados,
reglas de validación y almacenamiento, sus relaciones y su configuración de
seguridad a nivel de fila. Para cambiar algo de esto, añade un archivo
[`customizeTable`](/docs/frontend/customize-table/); este indica únicamente lo
que difiere.

:::note[¿Vienes de collections?]
El panel solía leer `config/collections` a través de un plugin de Vite. Ahora lee
las tablas que sirve el backend, y la presentación reside en
`frontend/src/cms/*.tsx`.
:::

## De dónde provienen las tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`<RebaseCMS>` llama a `client.schema.tables()`, que lee
`GET /api/schema/tables`. La respuesta es la lista de descriptores de tablas,
redactada para quien realiza la llamada: una tabla que no puede leer no
aparece, al igual que una columna que sus roles no pueden leer (consulta
[Field access](/docs/collections/field-access/)). El código del hook nunca sale
del servidor; el descriptor solo indica qué hooks existen.

- El panel consulta una vez que alguien inicia sesión, y vuelve a consultar
  cuando el usuario que inició sesión o sus roles cambian. A un visitante que no
  ha iniciado sesión no se le envía ninguna tabla.
- El servidor etiqueta la respuesta con un `ETag`. El cliente conserva la última
  respuesta y devuelve la etiqueta, por lo que un esquema sin cambios solo cuesta
  un `304`.
- Recargar la navegación vuelve a consultar. El editor de esquemas hace esto
  después de modificar una tabla.

Los mismos descriptores impulsan Studio y las aplicaciones MCP, de modo que los
tres coinciden en lo que es una tabla.

## Etiquetas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada etiqueta se deriva de un identificador, por lo que una tabla se lee igual
para cualquier usuario y en cada carga:

| Identificador | Etiqueta |
|---|---|
| columna `first_name`, `firstName` o `FirstName` | First Name |
| columna `author_id`, `photoUrl`, `apiKey` | Author ID, Photo URL, API Key |
| columna `__order` | Order |
| tabla `order_items` | Order Items, un registro: Order Item |
| tabla `addresses`, `status_updates` | Addresses / Address, Status Updates / Status Update |
| valor de enum `needs_review` | Needs Review |

Las etiquetas de la tabla provienen del nombre bajo el cual fue definida, no de
su slug o nombre SQL. `ID`, `IDs`, `URL`, `URLs`, `UUID`, `API` e `IP`
conservan sus mayúsculas. El singular solo cambia la última palabra y no
modifica las palabras que simplemente terminan en `s` (`Status`, `Analysis`,
`Address`).

## El campo que recibe cada columna

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Columna | Campo en el formulario | Notas |
|---|---|---|
| `col.text()`, `col.varchar({ length })`, `col.char({ length })`, `col.uuid()` | input de texto | `varchar` y `char` limitan la longitud |
| una columna de texto con `.validate({ email: true })` | input de email | validado como email |
| una columna de texto con `.validate({ url: true })` | input de URL, con vista previa del enlace | validado como URL |
| una columna de texto con `{ enum: [...] }`, una columna numérica con `.oneOf([...])` | select | una opción por valor |
| una columna de texto o uuid con `.userId()` | selector de usuario | el valor es el id del usuario |
| `col.enum([...])`, una columna `pgEnum` | select, representado como un chip de color | un color por valor, determinado por el propio valor |
| `col.smallint()` … `col.bigserial({ mode: "number" })` | input numérico | solo números enteros |
| `col.real()`, `col.doublePrecision()`, `col.numeric({ precision, scale })` | input numérico | |
| `col.boolean()` | switch | |
| `col.timestamp({ withTimezone: true })` | selector de fecha y hora | |
| `col.date()` | selector de fecha | |
| `col.time()` | hora del día | |
| `col.storage(…)` | campo de subida con vista previa | `.multiple()` es un campo de múltiples archivos |
| `<item>.array()` | lista repetible del campo del elemento | un array de texto con `{ enum: [...] }` es una selección múltiple |
| `col.jsonb().$type<T>()`, `col.json().$type<T>()` | editor de clave/valor | el tipo `T` se borra en tiempo de ejecución |
| `col.jsonb(json.object({…}))` | un grupo de campos tipados | listas, bloques tipados y archivos en su interior, según la estructura |
| `col.geopoint()` | latitud y longitud | |
| `col.vector({ dimensions })` | input de vector | |
| `col.bytea()` | campo binario | base64 en la transmisión |

Un valor de enum conserva su color dondequiera que aparezca: en el select, en el
chip de la tabla y como columna de kanban. El color depende únicamente del
valor, por lo que añadir un valor nunca cambia el color de los demás.
`customizeTable` puede definir las etiquetas y los colores deseados con
`enumLabels`; un valor que no nombres conservará el derivado automáticamente.

Una columna `jsonb` declarada con una [estructura `json.*`](/docs/schema/json/)
obtiene un formulario real: un objeto es un grupo de campos, un array repite su
elemento, un array de `json.oneOf` es un editor de bloques y `json.storage()` es
un campo de subida dentro de él. Sin una estructura, el panel no puede
interpretar el documento y ofrece edición libre de clave/valor.

Cada tipo de columna, su widget y las opciones para modificarlo se encuentran
en [Campos](/docs/collections/properties/).

## Campos obligatorios, valores predeterminados y de solo lectura

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| La columna | En el formulario |
|---|---|
| `.notNull()` | obligatorio, con el `requiredMessage` de `.validate()` si lo tiene |
| `.default(literal)` | un nuevo registro se abre con ese valor; sigue siendo obligatorio al editar |
| `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()` | se puede dejar vacío al crear, para que la base de datos lo complete |
| `.unique()` | el formulario verifica que el valor no esté en uso antes de guardar |
| una clave primaria generada (`.defaultRandom()`, `.generatedByDefaultAsIdentity()`, un serial) | no editable; una clave sin valor predeterminado se ingresa manualmente al crear |
| `.onCreateNow()`, `.onUpdateNow()` | de solo lectura y excluida de las columnas de tabla por defecto |
| `.onCreateUser()`, `.onUpdateUser()` | de solo lectura |
| `.readOnly()`, `.generatedAlwaysAs(…)` | de solo lectura |
| el campo `tenant` de la tabla | completado por el servidor al crear y excluido de las columnas de tabla por defecto; sigue siendo editable para un usuario que tenga permisos de escritura |
| `.private()` | nunca se sirve, por lo que nunca se muestra |

Las reglas de `.validate()` de una columna son verificadas por el formulario
antes de guardar, tal como el servidor las verifica al recibirlas. Consulta
[Validación y condiciones](/docs/collections/validation-and-conditions/).

El id del registro y sus marcas de tiempo `.onCreateNow()` y `.onUpdateNow()` se
muestran en el bloque de solo lectura al pie de la barra lateral del formulario.

## Relaciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- Un `belongsTo` es un selector de la fila relacionada, en lugar de su columna
  de clave foránea: el formulario muestra **Author**, no **Author ID**. Es
  obligatorio cuando la clave foránea es `NOT NULL` sin valor predeterminado. Una
  clave foránea que forma parte de la clave primaria se mantiene como un campo
  propio, junto al selector.
- Un `hasOne` es un selector de la única fila relacionada.
- Un `hasMany`, un `manyToMany` y un `via` de tipo to-many son **pestañas** del
  registro que listan las filas relacionadas. El selector junto a la pestaña está
  oculto.
- Un `via` es de solo lectura a menos que sea escribible.
- Una relación con una tabla que no se sirve a quien realiza la llamada se
  omite: el panel no puede abrir una tabla que no tiene. En ese caso, un
  `belongsTo` deja su clave foránea como un campo simple, para que el valor siga
  siendo visible.

Consulta [Relaciones en el panel](/docs/collections/relations-in-the-admin-panel/).

## Display slots

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada superficie que dibuja un registro utiliza algunos de seis slots: title,
subtitle, image, status, date y tags (consulta [display slots](/docs/frontend/view-modes/#display-slots)).
Un slot se completa a partir de una columna solo cuando la columna claramente
pertenece allí; la primera columna coincidente, en orden de declaración, tiene
prioridad:

| Slot | Columna |
|---|---|
| title | una columna de texto sin conjunto cerrado de valores y sin archivo, cuya clave sea `title`, `name`, `label`, `displayName`, `fullName`, `heading`, `subject` o `username` (se ignoran mayúsculas/minúsculas y separadores) |
| image | una única columna `col.storage()` cuyo `accept` indique un tipo de imagen |
| status | una columna llamada `status` con un conjunto cerrado de valores |
| date | una columna de fecha o marca de tiempo que el servidor no genere automáticamente (`publishDate`); en su defecto, la marca de actualización y luego la marca de creación |

Un slot que ninguna columna complete se deja a la propia interpretación del
registro por parte del panel (para el título: el primer campo de texto corto).
`display` en `customizeTable` define cualquier slot de forma explícita.

## Quién ve qué controles

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El panel oculta **Create**, **Edit** y **Delete** cuando el usuario que inició
sesión no tiene permiso para realizarlos. Lo decide evaluando la seguridad a
nivel de fila (RLS) de la tabla en el navegador, con el mismo modelo de políticas
que se compila para Postgres:

- las reglas que declaraste en `rls`, más las políticas que Rebase añade junto a
  ellas: la línea base de admin (a menos que `defaultPolicies: false`), el
  permiso de auto-lectura y escritura de admin de la tabla de usuarios, y la
  regla de multi-inquilino (tenancy)
  (consulta [políticas que recibe una tabla](/docs/collections/security-rules/#policies-a-table-gets-without-writing-them));
- `rls: "admin-only"`: solo los administradores ven los controles;
- una regla escrita en SQL puro no se puede evaluar en el navegador, al igual que
  una cláusula que el servidor retuvo para quien realiza la llamada: el control
  se muestra y la base de datos decide cuando llega la escritura;
- una vista SQL es de solo lectura. Una vista simple se lista y las tablas que
  lee deciden qué filas se devuelven; una vista materializada se lista para los
  roles que especifica (`["admin"]` cuando no especifica ninguno).

Esto solo decide qué se dibuja. Cada escritura es verificada nuevamente por
Postgres, de modo que un control que no debió mostrarse provocará una
escritura rechazada, nunca una escritura que no debió haber ocurrido.

## Orden y valores predeterminados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las tablas aparecen en la navegación en el orden en que las sirve el backend, es
decir, el orden en que se exportan desde `backend/schema/index.ts`. Cada una se
abre en la vista de tabla. `customizeTable` configura `group`, `icon`,
`defaultViewMode` y el resto; `<RebaseCMS navigationGroupMappings>` organiza los
grupos entre las tablas.

## Carga y errores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **Mientras las tablas se cargan**, una ruta a una colección muestra el estado
  de carga, no "colección no encontrada", y un enlace profundo (deep link) se
  abre una vez que la colección existe.
- **Si las tablas no se pueden cargar**, la página principal y la ruta de la
  colección indican qué falló y ofrecen reintentar. Cuando el servidor ya no
  acepta la sesión, el mensaje solicita iniciar sesión de nuevo.
- **Un backend que no sirve tablas** (uno sin autenticación configurada o
  anterior a la ruta) no es un error: el panel muestra las
  [colecciones externas](/docs/frontend/firebase/) y nada más.

Las personalizaciones que nombran una tabla que no se sirve a quien realiza la
llamada se ignoran, mostrando una advertencia en desarrollo. Consulta
[qué se rechaza y qué se omite](/docs/frontend/customize-table/#what-is-refused-and-what-is-skipped).

## Muchas tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Nada limita la cantidad de tablas. El panel necesita todas las colecciones para
renderizar la navegación, por lo que los descriptores se obtienen tras iniciar
sesión, y lo necesario para abrir una colección (la tabla, las vistas de
registro, el formulario) se carga únicamente en ese momento. Un esquema grande
ralentiza más a `rebase db push` que al panel: con 400 o más tablas, un push
tarda decenas de segundos; consulta
[cuánto tarda un push](/docs/cli/schema#rebase-db-push).

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): modifica cualquiera de los puntos anteriores, por tabla
- [Fields](/docs/collections/properties/): widget y opciones para cada tipo de columna
- [View modes](/docs/frontend/view-modes/): tabla, tarjetas, kanban, display slots y filtros
- [Relations in the panel](/docs/collections/relations-in-the-admin-panel/): pestañas, selectores y pivots
- [Firestore beside Postgres](/docs/frontend/firebase/): colecciones desde otra fuente de datos
