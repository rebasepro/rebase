---
sourceHash: 8ce5fe3122103e0c
title: Acceso a campos
sidebar_label: Acceso a campos
description: "Permisos de lectura y escritura por columna según el rol con .access(), columnas que nunca salen del servidor con .private() y columnas que los clientes no pueden escribir con .readOnly(). Un invocador al que las políticas de fila le permiten el acceso sigue sin recibir una columna que sus roles no pueden leer."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La [seguridad a nivel de fila (RLS)](/docs/collections/security-rules/) decide a qué **filas**
accede un invocador. Tres modificadores de columna deciden qué **columnas de una fila alcanzada**
ven y pueden establecer:

| Modificador | Lectura | Escritura |
|---|---|---|
| `.access({ read, write })` | los roles en `read`, cuando se especifiquen | los roles en `write`, cuando se especifiquen |
| `.private()` | nadie, a través de la API | nadie, a través de la API |
| `.readOnly()` | igual que la fila | nadie, a través de la API |

Las relaciones admiten las mismas reglas como opciones: `rel.*(target, { access: { read, write } })`
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

La regla anterior no impone ningún filtro de fila en `select`, por lo que cada invocador que la API
deje pasar lee cada fila de staff. Solo un invocador que posea `hr` obtiene la columna `salary`
de una de ellas, y nadie la establece a través de HTTP.

## La regla

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` recibe dos listas opcionales, y una lista omitida no es una lista vacía;
la diferencia radica en toda la funcionalidad.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delega a la fila. Todo aquel a quien la regla `rls` de la tabla le permita leer (o escribir) la fila, obtiene la columna. |
| `[]` | Nadie, a través de la API, con ningún privilegio; ni `admin`, ni la service key, ni una lectura en proceso. |
| `["hr"]` | Un invocador que posea `hr`, **o** `admin`, **o** código de servidor de confianza sin una petición detrás. |

Los roles son roles de aplicación de Rebase: los mismos que devuelve `rebase.roles()`
dentro de una directiva y contra los que compila `policy.rolesOverlap`. Provienen del
contexto de la llamada: `user.roles` en la petición autenticada.

### Por qué `admin` siempre pasa

Cada directiva base que Rebase inyecta incluye una rama `rolesOverlap(['admin'])`, y
`rebase.dataAsAdmin` se ejecuta como `{ uid: "service", roles: ["admin"] }`. Una regla de campo
que pudiera bloquear a un administrador impidiéndole ver una columna de su propia base de datos
también bloquearía al Studio para renderizarla y a la CLI para exportarla. Si
necesitas una columna que ningún administrador lea a través de la API, eso es `read: []`.

### Por qué el plano de confianza pasa

El código de servidor sin una petición detrás (una migración o el adaptador de autenticación
verificando una contraseña) lee sin ningún rol, y una lista de roles no
se le aplica. `[]` aún se aplica: se trata de una declaración sobre la superficie de la API
más que sobre quién está llamando.

El `context.data` de un hook no forma parte de ese plano. Dentro de una petición, lee con los
roles del invocador, por lo que las reglas de campo se aplican a lo que lee exactamente igual que
se aplican a la petición: el propio driver rechaza un filtro, ordenación, proyección, include,
búsqueda vectorial, agregado o sondeo de unicidad que mencione una columna que esos roles
no pueden leer (`FIELD_NOT_READABLE`), y responde ante un nombre `.private()` como
respondería ante un error tipográfico, de la misma forma que REST y el socket.

## `.private()` y `.readOnly()` son el mismo mecanismo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.private()` es `.access({ read: [], write: [] })`, con una diferencia: una
columna privada también se excluye de OpenAPI, de los tipos del SDK y de los esquemas
de herramientas MCP, por lo que su nombre tampoco es público (consulta [Consultas](#consultas)). Una columna
no puede ser a la vez `.private()` y declarar `.access()`; el esquema será rechazado.

`.readOnly()` es `write: []`: nadie escribe la columna a través de la API, sea cual sea
su rol, mientras que los valores predeterminados, los triggers y el código del servidor aún pueden completarla. Las lecturas se
dejan a criterio de la fila, o a `.access({ read })` cuando se declaran ambos.

## Lo que ve un invocador

### Lecturas

Un campo que no puedes leer está **ausente** de la respuesta. Ni `null`, ni una cadena
vacía: la clave no existe en el objeto.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Esto es intencionado. Un valor retenido que se devuelva como `null` es indistinguible de un
`null` almacenado, por lo que un cliente podría mapear toda la columna contándolos; además, una
operación `update` que devolviera la fila sobreescribiría el valor real con el null que
recibió.

Se aplica en cada salida: lista, obtención individual, destinos de relaciones incluidos con
`?include=`, resultados de `_batch`, tramas en tiempo real de `.listen()`, resultados de
agregados e instantáneas del [historial](#historial).

El valor de una relación son sus filas relacionadas, por lo que una relación que no puedes leer se
retiene por completo. `?include=` la omite de la fila, junto con su `_count`, desde
cualquier vía: REST, el SDK, `.listen()` e includes anidados un nivel más abajo.
Mencionarla en cualquier otro lugar se rechaza de la misma manera que un campo (consulta [Consultas](#consultas)).

### Consultas

Un `where`, `orderBy`, `fields`, `select` de agregado o `groupBy` que mencione un campo que
no puedes leer resulta en un **400 `FIELD_NOT_READABLE`**. También lo es un filtro a través de una relación
sobre un campo de su destino que no puedes leer (`?author.salary=gt.1`), una ordenación agregada
sobre uno de ellos (`orderBy=max(staff.salary)`), y una relación que no puedes leer
mencionada en una ruta anidada (`/departments/1/members`, `/departments/1/members/7`) o
una ordenación agregada (`orderBy=count(members)`):

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

Sin esto, el valor sería legible predicado a predicado: veinte peticiones equivalen a una
búsqueda binaria sobre un salario.

El error **menciona el campo**. Es una decisión deliberada, no un descuido: el
documento OpenAPI publicado lista cada columna de cada tabla (se sirve
desde la aplicación, no desde el enrutador de datos autenticado), por lo que los nombres de los campos
ya son públicos. Ocultar el nombre aquí no protegería nada y respondería a un
error tipográfico genuino de un invocador con un "unknown field", haciéndole buscar un error
de ortografía inexistente. **Los nombres de los campos son públicos; los valores de los campos no.**

Excepto los de una columna `.private()`. OpenAPI, `describe_table` y el SDK generado
la omiten, por lo que su nombre no es público, y un "not readable" confirmaría que
existe. Un filtro, `orderBy`, `fields`, `include`, `select` de agregado o
`groupBy`, o `vector_search` que mencione una de ellas recibe exactamente la misma respuesta que recibe un nombre mal escrito:
`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`,
`UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`, con el
mismo mensaje y detalles; además, ninguna respuesta de campo desconocido la incluye entre los
campos válidos.

### Escrituras

Un valor para un campo que no puedes escribir es un **400**, nunca una clave descartada silenciosamente:
una escritura que descarta un campo informaría del éxito de una edición que nunca se produjo.

| Código | Cuándo |
|--------|--------|
| `FIELD_NOT_WRITABLE` | `write` es una lista de roles que no cumples. Tu colega podría obtener un 200 con el mismo cuerpo. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` es `[]`, o la columna es `.private()` o `.readOnly()`. Nadie puede escribirla; la respuesta es la misma para cualquier invocador. |

Ambos incluyen `details.violations` indexados por el nombre transmitido que enviaste. Se aplica en
creación, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operaciones de campo
(`{ "salary": { "$inc": 1000 } }` nombra a `salary` como lo hace cualquier valor) y en la
trama `SAVE` de WebSocket.

Una operación de campo también necesita `read` sobre su campo. Una operación sobre un campo que puedes
escribir pero no leer se rechaza con `FIELD_NOT_READABLE`: si superó un
límite te indicaría el valor que no tienes permitido ver.

### Un enlace sigue a su columna clave

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un `belongsTo` y la columna clave a la que está vinculado son un solo campo con dos
formas de escritura. Escribir `{ "reviewer": 7 }` está sujeto a todas las reglas de `reviewerId`
(su regla de escritura, `.readOnly()`, `.private()`, una marca temporal de creación, la columna
de tenant); enviar ambos con valores diferentes devuelve `400 VALIDATION_INVALID_VALUE`.
Un invocador que no pueda leer `reviewerId` no obtiene `reviewer` en un `include`,
y un filtro, ordenación o entrada de `fields` que lo mencione responderá con `FIELD_NOT_READABLE`;
detrás de una clave `.private()`, la relación no existe en absoluto para los clientes. El
endpoint del esquema, OpenAPI y MCP describen ambos de forma conjunta.

Lo mismo aplica para cada relación, a través de lo que sea que lea su join: un
`hasMany` / `hasOne` lee la clave foránea del destino, un `via` cada columna sobre la que se unen
sus pasos, en cada tabla por la que pasa. Un invocador que no pueda leer una
de esas columnas no obtiene la relación en un `include` o un `_count`, recibe
`FIELD_NOT_READABLE` al filtrar u ordenar a través de ella (una relación desconocida cuando
la columna es `.private()`), y no la ve descrita.

`strictWrites: false` en una tabla solo deja pasar hacia el driver una clave que la tabla no declara.
Nunca relaja una regla sobre una columna declarada, una marca temporal,
el tenant, la clave, el destino de una relación o `_pivot`.

## Búsqueda

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La búsqueda alternativa (una tabla sin un bloque `search`) aplica `ILIKE` sobre
tus columnas de texto, y omite aquellas que el invocador no puede leer. Nada se filtra
a través de ella.

Una tabla que **sí** declara un [bloque `search`](/docs/backend/search) compila
en una única columna `tsvector` generada compartida por todos los invocadores. No existe
una variante de ella por rol, por lo que una columna restringida nombrada en `search.fields`
seguiría siendo *coincidente* para invocadores que nunca pueden ver su valor (pudiendo recuperarlo
término a término). El esquema se rechaza con esa combinación: elimina la columna de
`search.fields` o retira la restricción de lectura. Una columna `tenant` tampoco puede tener
restringida la lectura.

## Historial

El [historial de entidades](/docs/backend/history) almacena la fila completa, y se sirve a
cualquiera que pueda leer la fila; el criterio de acceso es "puedes obtener esta entidad", no "eres
un admin". De modo que la regla de lectura también se aplica a cada instantánea almacenada: la entrada
sigue listándose, con quién la cambió y cuándo, y las columnas restringidas desaparecen
de sus `values`.

La reversión no se ve afectada. La ruta de reversión lee la entrada almacenada en el lado del servidor, por lo que un
invocador puede restaurar una versión cuyos campos no pueda ver en su totalidad, exactamente igual a como
ya puede sobrescribir una fila sin leerla por completo.

## Lo que muestra el CMS

Nada que configurar. El CMS lee a través de la misma API, por lo que una columna que el
invocador no puede leer nunca llega y el formulario no la dibuja; una columna que
no puede escribir se rechaza si algo intenta enviarla. Esta es una garantía
del lado del servidor, a diferencia de ocultar un campo en el CMS, lo cual solo impide que sea
*renderizado* y deja el valor en el JSON.

## Tipos generados y OpenAPI

Los tipos `Row`, `Insert` y `Update` del SDK tienen una única forma para todos los invocadores;
no existe un `Row` que sea correcto tanto para un lector con el rol `hr` como para uno que no
lo tiene, por lo que una regla de **rol** no los altera. Una columna `.private()` está ausente
de los tres, y una columna `.readOnly()` está ausente de `Insert` y `Update`. Los
[tipos inferidos](/docs/schema/types/) siguen la misma regla.

El documento OpenAPI declara la regla en lugar de fingir estar adaptado a cada invocador.
Cada columna restringida incluye `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo que nadie puede leer está ausente del esquema de lectura y de los parámetros
de filtrado; un campo que nadie puede escribir está ausente del esquema de entrada. Ambas
direcciones son esquemas independientes y se evalúan por separado, de modo que un token que un admin
envía mediante POST y nunca vuelve a leer aparece en el cuerpo de la petición y no en la fila.

## Escrituras en proceso

Las escrituras en proceso (`context.data` en un hook, `rebase.dataAsAdmin` en un hook,
una función o un cron job) no pasan por la comprobación de escritura: `.readOnly()`,
un `access.write` por campo y `.private()` son reglas del límite de la API.
Eso es lo que permite que la regla sea ejecutable en absoluto: algo tiene que ser capaz de
almacenar el hash de la contraseña. Lo que sí se mantiene en proceso, tanto para una columna como para
el enlace vinculado a ella: las marcas temporales del servidor prevalecen sobre un valor suministrado, una fila no puede
cambiar de tenant y su clave no puede cambiar. La seguridad a nivel de fila se aplica
en todas partes.

Las lecturas mediante `rebase.dataAsAdmin` poseen el rol `admin`, por lo que una regla de rol no
les oculta nada. `[]` aún lo hace, incluso frente a `dataAsAdmin`. Utiliza
[`rebase.sql()`](/docs/backend/custom-functions) si necesitas la columna sin procesar.

## Validación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` en una columna y `access` en una relación lanzan un error cuando el módulo
se carga, a menos que `read` y `write` sean listas de nombres de roles no vacíos: una cadena
donde corresponde una lista (`read: "admin"`) se rechaza en lugar de interpretarse como
otra cosa.

Estos casos se rechazan cuando se compila el esquema, antes de que el servidor sirva
nada:

- `.private()` y `.access()` en la misma columna: son un mismo mecanismo;
- una columna con lectura restringida nombrada en el `search.fields` de la tabla, o usada como su
  campo `tenant`;
- una clave primaria `.private()`: la clave es el mecanismo por el cual se referencia cada fila.

Los *nombres* de los roles no se validan contra un conjunto predefinido: los roles son datos de la aplicación, creados
y eliminados mientras el servidor se ejecuta. Un error tipográfico en uno de ellos da como resultado un campo que nadie puede leer, lo
cual es la dirección segura ante un fallo.

## Consulta también

- [Seguridad a nivel de fila](/docs/collections/security-rules/) — a qué filas accede un invocador
- [Columnas](/docs/schema/columns/) — todos los modificadores de columna
- [Códigos de error](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
