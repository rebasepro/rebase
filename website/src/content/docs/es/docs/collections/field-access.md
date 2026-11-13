---
sourceHash: f55095351eb33abe
title: Acceso a campos
sidebar_label: Acceso a campos
description: "Permisos de lectura y escritura por columna según el rol con .access(), columnas que nunca salen del servidor con .private() y columnas que los clientes no pueden escribir con .readOnly(). Un emisor de llamada al que las políticas de fila le permiten el paso sigue sin recibir una columna que sus roles no pueden leer."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La [seguridad a nivel de fila](/docs/collections/security-rules/) decide a qué **filas** accede un
emisor de llamada. Tres modificadores de columna deciden qué **columnas de una fila alcanzada**
puede ver y establecer:

| Modificador | Lectura | Escritura |
|---|---|---|
| `.access({ read, write })` | los roles en `read`, cuando se especifican | los roles en `write`, cuando se especifican |
| `.private()` | nadie, a través de la API | nadie, a través de la API |
| `.readOnly()` | igual que la fila | nadie, a través de la API |

Las relaciones aceptan las mismas reglas como opciones: `rel.*(target, { access: { read, write } })`
y `rel.*(target, { private: true })`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Read by HR (and admins). Set by nobody through the API.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "public" }],
});
```

La regla anterior no aplica ningún filtro de fila en `select`, por lo que cualquier emisor de llamada
al que la API permita el paso lee todas las filas de staff. Solo un emisor de llamada que posea `hr`
obtiene la columna `salary` de una fila, y nadie puede establecerla mediante HTTP.

## La regla

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` recibe dos listas opcionales, y omitir una lista no equivale a una lista vacía;
esa diferencia es la base de toda la funcionalidad.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delega en la fila. Todo aquel a quien la `rls` de la tabla permita leer (o escribir) la fila obtiene la columna. |
| `[]` | Nadie, a través de la API, con ningún privilegio — ni `admin`, ni la clave de servicio, ni una lectura en proceso. |
| `["hr"]` | Un emisor de llamada que tenga `hr`, **o** `admin`, **o** código de servidor de confianza sin una solicitud detrás. |

Los roles son roles de aplicación de Rebase: los mismos que devuelve `rebase.roles()`
dentro de una política y contra los cuales compila `policy.rolesOverlap`. Provienen del
contexto de la llamada: `user.roles` en la solicitud autenticada.

### Por qué `admin` siempre pasa

Cada política base que Rebase inyecta incluye una rama `rolesOverlap(['admin'])`, y
`rebase.dataAsAdmin` se ejecuta como `{ uid: "service", roles: ["admin"] }`. Una regla de campo
que pudiera bloquear a un administrador el acceso a una columna de su propia base de datos
también bloquearía a Studio para renderizarla y a la CLI para exportarla. Si necesita
una columna que ningún administrador lea a través de la API, utilice `read: []`.

### Por qué el plano de confianza pasa

El código de servidor sin una solicitud detrás — una migración o el adaptador de autenticación
verificando una contraseña — lee sin ningún rol en absoluto, y una lista de roles no se
le aplica. `[]` todavía se aplica: se trata de una declaración sobre la superficie de la API
más que sobre quién está realizando la llamada.

El `context.data` de un hook no forma parte de ese plano. Dentro de una solicitud, lee con
los roles del emisor de llamada, por lo que las reglas de campo se aplican a lo que lee
exactamente igual que a la solicitud: el propio driver rechaza cualquier filtro, ordenación,
proyección, include, búsqueda vectorial, agregado o sondeo de unicidad que mencione una columna
que dichos roles no pueden leer (`FIELD_NOT_READABLE`), y responde a un nombre `.private()`
como si fuera una errata, de la misma forma que REST y el socket.

## `.private()` y `.readOnly()` son el mismo mecanismo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.private()` equivale a `.access({ read: [], write: [] })`, con una diferencia: una
columna privada también queda excluida de OpenAPI, de los tipos del SDK y de los
esquemas de herramientas MCP, por lo que su nombre tampoco es público (consulte [Consultas](#consultas)). Una
columna no puede ser `.private()` y declarar `.access()` a la vez; el esquema será rechazado.

`.readOnly()` equivale a `write: []`: nadie escribe en la columna a través de la API,
sea cual sea su rol, mientras que los valores predeterminados, disparadores (triggers) y
el código de servidor aún pueden rellenarla. Las lecturas se delegan a la fila, o a
`.access({ read })` cuando se definen ambos.

## Qué ve un emisor de llamada

### Lecturas

Un campo que no puede leer está **ausente** de la respuesta. Ni `null`, ni una cadena
vacía: la clave simplemente no está presente.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Esto es deliberado. Un valor retenido entregado como `null` es indistinguible de un
`null` almacenado, por lo que un cliente podría inferir toda la columna contándolos — y un
`update` que devuelva la fila recibida sobrescribiría el valor real con el null asignado.

Se aplica en cada vía de salida: listados, obtención individual, destinos de relaciones incluidos con
`?include=`, resultados de `_batch`, tramas en tiempo real de `.listen()`, resultados
de agregados e instantáneas del [historial](#historial).

El valor de una relación son sus filas relacionadas, por lo que una relación que no puede leer se
retiene por completo. `?include=` la omite de la fila, junto con su `_count`, desde
cualquier acceso: REST, el SDK, `.listen()` e includes anidados un nivel más abajo.
Mencionarla en cualquier otro lugar se rechaza al igual que un campo (consulte [Consultas](#consultas)).

### Consultas

Un `where`, `orderBy`, `fields`, `select` de agregado o `groupBy` que nombre un campo que
no puede leer devuelve un **400 `FIELD_NOT_READABLE`**. También lo hace un filtro a través de una relación
sobre un campo de su destino que no puede leer (`?author.salary=gt.1`), una ordenación
agregada sobre uno (`orderBy=max(staff.salary)`), y una relación que no puede leer
mencionada en una ruta anidada (`/departments/1/members`, `/departments/1/members/7`) o
en una ordenación agregada (`orderBy=count(members)`):

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on table 'staff' with your roles, so it cannot be used in a filter.",
    "details": {
      "collection": "staff",
      "fields": ["salary"],
      "violations": [
        { "field": "salary", "code": "access", "message": "'salary' is not readable with your roles." }
      ]
    }
  }
}
```

Sin esto, el valor sería legible comprobando predicado a predicado: veinte solicitudes
bastan para una búsqueda binaria sobre un salario.

El error **especifica el nombre del campo**. Esto es una decisión deliberada, no un descuido: el
documento OpenAPI publicado enumera cada columna de cada tabla (se sirve
desde la aplicación, no desde el enrutador de datos autenticado), por lo que los nombres de los campos
ya son públicos. Ocultar el nombre aquí no protegería nada y respondería a un
error tipográfico real del emisor con un "campo desconocido", haciendo que busque un
error ortográfico que no existe. **Los nombres de los campos son públicos; los valores de los campos no lo son.**

Excepto en el caso de una columna `.private()`. OpenAPI, `describe_table` y el SDK generado
la omiten, por lo que su nombre no es público, y un mensaje de "no legible" confirmaría
su existencia. Un filtro, `orderBy`, `fields`, `include`, `select` o `groupBy` de agregado,
o `vector_search` que mencione una de ellas recibe exactamente la respuesta que obtiene un nombre
mal escrito: `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`,
`UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`, con el mismo
mensaje y detalles, y ninguna respuesta de campo desconocido la incluye entre los
campos válidos.

### Escrituras

Un valor para un campo en el que no puede escribir devuelve un **400**, nunca una clave
descartada en silencio: una escritura que descarta un campo notificaría éxito en
una edición que no llegó a ocurrir.

| Código | Cuándo |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` es una lista de roles que usted no cumple. Un compañero suyo podría recibir un 200 con el mismo cuerpo. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` es `[]`, o la columna es `.private()` o `.readOnly()`. Nadie puede escribir en ella; la respuesta es la misma para cualquier emisor de llamada. |

Ambos incluyen `details.violations` indexado por el nombre transmitido en la llamada. Se aplica en
create, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operaciones de campo
(`{ "salary": { "$inc": 1000 } }` hace referencia a `salary` al igual que cualquier valor) y en
la trama `SAVE` de WebSocket.

Una operación de campo también necesita permisos de `read` sobre dicho campo. Una operación sobre un campo
que puede escribir pero no leer se rechaza con `FIELD_NOT_READABLE`: saber si superó
un límite le revelaría el valor que no tiene permitido ver.

### Un enlace sigue a su columna clave

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un `belongsTo` y la columna clave a la que está vinculado son un mismo campo con dos
formas de escritura. Escribir `{ "reviewer": 7 }` está sujeto a todas y cada una de las reglas de `reviewerId`
(su regla de escritura, `.readOnly()`, `.private()`, un sello de creación, la
columna tenant); enviar ambos con valores diferentes devuelve `400 VALIDATION_INVALID_VALUE`.
Un emisor de llamada que no puede leer `reviewerId` no recibe `reviewer` en un `include`,
y un filtro, ordenación o entrada en `fields` que lo mencione responde `FIELD_NOT_READABLE`;
tras una clave `.private()`, la relación directamente no existe para los clientes. El
endpoint de esquemas, OpenAPI y MCP describen a ambos conjuntamente.

Lo mismo aplica a cualquier relación, a través de lo que lea su join: un
`hasMany` / `hasOne` lee la clave foránea del destino, un `via` lee cada columna sobre la
que se unen sus pasos, en cada tabla por la que pasa. Un emisor de llamada que no puede leer una
de esas columnas no obtiene la relación en un `include` o un `_count`, recibe
`FIELD_NOT_READABLE` al filtrar u ordenar a través de ella (o una relación desconocida cuando
la columna es `.private()`), y no la ve descrita.

Un `via` a través de una tabla que el servidor no expone — una que retiene
(`TABLE_WITHHELD`) o una que sus tablas no declaran — está cerrado para cualquier
emisor de llamada, incluido el código de confianza: sus columnas de unión cuentan como no legibles y
no escribibles, por lo que se omite de `include`, y cualquier filtro, ordenación o ruta a través
de ella se rechaza (`FIELD_NOT_READABLE`, o `503 TABLE_WITHHELD` indicando la
tabla retenida).

Un `manyToMany` cuya tabla intermedia es una tabla declarada por usted (`through` hace referencia a
un `defineTable`) queda sujeto a las reglas de columna de dicha tabla: una escritura que establezca
una columna de enlace `.readOnly()`, `.private()` o bloqueada por `access.write` en la tabla intermedia
es rechazada (`VALIDATION_EXCLUDED_FIELDS` / `FIELD_NOT_WRITABLE`), al igual que un campo
`_pivot` que la tabla intermedia bloquee. Lo mismo ocurre en las rutas anidadas
(`POST`, `PATCH` y `DELETE /:table/:id/:relation/:targetId`, y en una edición de `_pivot`)
y a través del WebSocket. Una tabla intermedia creada automáticamente por Rebase no tiene reglas propias.

`strictWrites: false` en una tabla solo permite que una clave no declarada por la tabla
llegue al driver. Nunca relaja una regla sobre una columna declarada, un sello,
el tenant, la clave, un destino de relación o `_pivot`.

## Búsqueda

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La búsqueda de respaldo — una tabla sin un bloque `search` — busca coincidencias `ILIKE`
en sus columnas de texto y omite aquellas que el emisor de llamada no puede leer. Nada se
filtra a través de ella.

Una tabla que **sí** declara un [bloque `search`](/docs/backend/search) compila
en una única columna `tsvector` generada compartida por todos los emisores de llamada. No existe una
variante por rol de esta, por lo que una columna restringida incluida en `search.fields`
seguiría siendo *emparejable* para emisores de llamada que nunca pueden ver su valor (pudiendo
recuperarlo término a término). El esquema se rechaza si presenta esa combinación: elimine la columna
de `search.fields` o retire la restricción de lectura. Una columna `tenant` tampoco puede tener
restricciones de lectura.

## Historial

El [historial de entidades](/docs/backend/history) almacena la fila completa y se sirve a
cualquiera que pueda leer la fila; el criterio de acceso es "¿puede obtener esta entidad?", no "¿es
usted un administrador?". Por lo tanto, la regla de lectura también se aplica a cada instantánea almacenada: la
entrada sigue listada, junto con quién la modificó y cuándo, pero las columnas retenidas se
eliminan de sus `values`.

La reversión no se ve afectada. La ruta de reversión lee la entrada almacenada en el servidor, por lo que un
emisor de llamada puede restaurar una versión en la que no puede ver la totalidad de sus campos — exactamente
igual que como ya puede sobrescribir una fila sin leerla por completo.

## Qué muestra el CMS

No hay nada que configurar. El CMS lee a través de la misma API, por lo que una columna que el
emisor de llamada no puede leer nunca llega y el formulario no la dibuja; una columna que
no puede escribir se rechaza si se intenta enviar. Esta es una garantía del lado del
servidor, a diferencia de ocultar un campo en el CMS, lo cual solo evita que sea
*renderizado* pero deja el valor intacto en el JSON.

## Tipos generados y OpenAPI

Los tipos `Row`, `Insert` y `Update` del SDK tienen una única estructura para todos los emisores de llamada
— no existe un `Row` que sea adecuado tanto para un lector con el rol `hr` como para uno que
no lo tenga —, por lo que una regla de **rol** no los altera. Una columna `.private()` está ausente
en los tres, y una columna `.readOnly()` no aparece en `Insert` ni `Update`. Los
[tipos inferidos](/docs/schema/types/) siguen la misma regla.

El documento OpenAPI refleja la regla directamente en lugar de fingir que varía según el emisor de llamada.
Cada columna restringida incluye `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo que nadie puede leer está ausente del esquema de lectura y de los parámetros de
filtrado; un campo que nadie puede escribir está ausente del esquema de entrada. Ambas
direcciones son esquemas independientes y se evalúan por separado, de modo que un token que un administrador
envía y nunca vuelve a leer aparece en el cuerpo de la solicitud y no en la fila.

## Escrituras en proceso

Las escrituras en proceso — `context.data` en un hook, `rebase.dataAsAdmin` en un hook,
una función o un trabajo cron — no pasan por la verificación de escritura: `.readOnly()`,
un `access.write` por campo y `.private()` son reglas del límite de la API.
Eso es lo que permite que la regla sea aplicable: algo tiene que ser capaz de
almacenar el hash de la contraseña. Lo que sí se aplica en proceso, tanto para una columna
como para el enlace vinculado a ella: los sellos del servidor prevalecen sobre un valor proporcionado,
una fila no puede cambiar de tenant y su clave no puede modificarse. La seguridad a nivel de fila se aplica
en todas partes.

Las lecturas mediante `rebase.dataAsAdmin` cuentan con el rol `admin`, por lo que una regla de rol no
les oculta nada. `[]` sí lo sigue haciendo — incluso para `dataAsAdmin`. Utilice
[`rebase.sql()`](/docs/backend/custom-functions) si necesita consultar la columna directamente.

## Validación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` en una columna, y `access` en una relación, lanzan una excepción al cargar
el módulo a menos que `read` y `write` sean listas de nombres de roles no vacíos: un string
donde corresponde una lista (`read: "admin"`) se rechaza en lugar de interpretarse como
otra cosa.

Los siguientes casos son rechazados durante la compilación del esquema, antes de que el servidor empiece a atender peticiones:

- `.private()` y `.access()` en la misma columna: forman parte del mismo mecanismo;
- una columna con restricción de lectura nombrada en `search.fields` de la tabla, o utilizada como su
  campo `tenant`;
- una clave primaria `.private()`: la clave es el identificador con el que se referencia cada fila.

Los *nombres* de los roles no se validan contra un conjunto cerrado: los roles son datos de la aplicación,
creados y eliminados mientras el servidor está en funcionamiento. Un error tipográfico en uno de ellos da como resultado un campo que nadie puede leer, lo cual
es el comportamiento seguro ante fallos.

## Consulte también

- [Seguridad a nivel de fila](/docs/collections/security-rules/) — a qué filas accede un emisor de llamada
- [Columnas](/docs/schema/columns/) — todos los modificadores de columnas
- [Códigos de error](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
