---
sourceHash: 0d49afd8ac50f59e
title: Acceso a campos
sidebar_label: Acceso a campos
description: Permisos de lectura y escritura por propiedad según el rol. Un llamador al que las reglas de seguridad de la fila dejan pasar sigue sin recibir un campo que sus roles no pueden leer.
---

## Descripción general

[Las reglas de seguridad](/docs/collections/security-rules/) deciden a qué **filas** accede un llamador. `access` decide qué **campos de una fila alcanzada** ve y puede establecer.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const staff = defineCollection({
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        salary: {
            type: "number",
            // Read by HR (and admins). Set by nobody through the API.
            access: { read: ["hr"], write: [] }
        }
    },
    securityRules: [
        { operation: "select", access: "public" }
    ]
});
```

La regla anterior no impone ningún filtro de fila en `select`, por lo que todo llamador admitido por la API lee todas las filas de staff. Solo un llamador que posea el rol `hr` obtiene la columna `salary` de una de ellas, y nadie puede establecerla a través de HTTP.

## La regla

`access` tiene dos listas opcionales, y una lista omitida no es una lista vacía — esa diferencia es la esencia misma de la funcionalidad.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delega en la fila. Cualquiera a quien las reglas de seguridad de la colección le permitan leer (o escribir) la fila obtiene el campo. |
| `[]` | Nadie, a través de la API, con ningún privilegio — ni `admin`, ni la clave de servicio, ni una lectura en proceso. |
| `["hr"]` | Un llamador que posea `hr`, **o** `admin`, **o** código de servidor de confianza sin ninguna solicitud detrás. |

Los roles son roles de aplicación de Rebase — los mismos que devuelve `rebase.roles()` dentro de una política y contra los cuales compila `policy.rolesOverlap`. Proceden del contexto de la llamada: `user.roles` en la solicitud autenticada.

### Por qué `admin` siempre pasa

Cada política base que inyecta Rebase lleva una rama `rolesOverlap(['admin'])`, y `rebase.dataAsAdmin` se ejecuta como `{ uid: "service", roles: ["admin"] }`. Una regla de campo que pudiera bloquear a un administrador fuera de una columna de su propia base de datos también impediría que Studio la renderizara y que la CLI la exportara. Si necesitas una columna que ningún administrador pueda leer a través de la API, eso es `read: []`.

### Por qué pasa el plano de confianza

Una llamada `rebase.data` en proceso en un hook, una migración o el adaptador de autenticación que verifica una contraseña no tiene ninguna solicitud ni ningún rol detrás. Es código de servidor y una lista de roles no se aplica a él. `[]` todavía aplica: esa es una declaración sobre la superficie de la API más que sobre quién está llamando.

## `excludeFromApi` es el mismo mecanismo

`excludeFromApi: true` es azúcar sintáctico para `access: { read: [], write: [] }`. Hay un único predicado detrás de ambas sintaxis, por lo que todo lo que aparece en esta página también se aplica a este indicador. Escribe el que resulte más legible, pero no ambos en una misma propiedad, lo cual se rechaza en el arranque.

## Qué ve un llamador

### Lecturas

Un campo que no puedes leer está **ausente** de la respuesta. Ni `null`, ni una cadena vacía — la clave simplemente no está ahí.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Esto es deliberado. Un valor oculto servido como `null` es indistinguible de un `null` almacenado, por lo que un cliente podría mapear toda la columna contándolos — y un `update` que devolviera la fila recibida sobrescribiría el valor real con el null que se le entregó.

Se aplica en cada salida: listado, obtención individual, destinos de relaciones incluidos con `?include=`, resultados de `_batch`, tramas en tiempo real de `.listen()`, resultados agregados y capturas del [historial](#history).

### Consultas

Un `where`, `orderBy`, `fields`, un `select` de agregación o un `groupBy` que mencione un campo que no puedes leer devuelve un **400 `FIELD_NOT_READABLE`**:

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on 'staff' with your roles, so it cannot be used in a filter.",
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

Sin esto, el valor se podría leer predicado a predicado: veinte solicitudes equivaldrían a una búsqueda binaria sobre un salario.

El error **nombra el campo**. Esto es una decisión, no un descuido: el documento de OpenAPI publicado lista cada propiedad de cada colección — se sirve desde la aplicación, no desde el enrutador de datos autenticado —, por lo que los nombres de los campos ya son públicos. Ocultar el nombre aquí no protegería nada y respondería a un error tipográfico legítimo de un llamador con "unknown field", llevándolo a buscar un error tipográfico que no existe. **Los nombres de los campos son públicos; los valores de los campos no.**

### Escrituras

Un valor para un campo que no puedes escribir devuelve un **400**, nunca una clave descartada silenciosamente — una escritura que descarta un campo informaría éxito para una edición que nunca ocurrió.

| Código | Cuándo |
|--------|--------|
| `FIELD_NOT_WRITABLE` | `write` es una lista de roles que no cumples. Tu colega podría recibir un 200 con el mismo cuerpo. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` es `[]` (o `excludeFromApi`). Nadie puede escribirlo; la respuesta es la misma para todos los llamadores. |

Ambos contienen `details.violations` indexado por el nombre transmitido que enviaste. Se aplica en create, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operaciones de campo (`{ "salary": { "$inc": 1000 } }` nombra `salary` como lo hace cualquier valor) y en la trama `SAVE` de WebSocket.

## Búsqueda

La búsqueda por defecto — una colección sin bloque `search` — realiza coincidencias `ILIKE` en tus propiedades de cadena y omite aquellas que el llamador no puede leer. Nada se filtra a través de ella.

Una colección que **sí** declara un [bloque `search`](/docs/backend/api/) compila en una única columna `tsvector` generada compartida por todos los llamadores. No existe una variante por rol de la misma, por lo que un campo restringido nombrado en `search.fields` seguiría siendo *coincidente* para llamadores que nunca pueden ver su valor — recuperable término por término. Rebase rechaza esa combinación en el arranque: elimina el campo de `search.fields` o quita la restricción de lectura.

## Historial

El [historial de entidades](/docs/backend/api/) almacena la fila completa y se sirve a cualquiera que pueda leer la fila — el filtro es "¿puedes obtener esta entidad?", no "¿eres un administrador?". Por lo tanto, la regla de lectura también se aplica a cada instantánea almacenada: la entrada sigue listada, indicando quién la modificó y cuándo, y las columnas retenidas desaparecen de sus `values`.

La reversión no se ve afectada. La ruta de reversión lee la entrada almacenada en el servidor, por lo que un llamador puede restaurar una versión cuyos campos no pueda ver en su totalidad — exactamente igual a cómo ya puede sobrescribir una fila sin leerla por completo.

## Qué muestra el panel de administración

No hay nada que configurar. Studio lee a través de la misma API, por lo que un campo que el llamador no puede leer nunca llega y el formulario no lo dibuja; un campo que no puede escribir es rechazado si algo intenta enviarlo. Esta es una garantía del lado del servidor, a diferencia de `admin.hideFromCollection`, que solo evita que el panel *renderice* un campo y deja el valor en el JSON.

## Tipos generados y OpenAPI

Los tipos `Row`, `Insert` y `Update` del SDK tienen una única forma para todos los llamadores — no existe un tipo `Row` adecuado tanto para un lector que posee `hr` como para uno que no —, por lo que una regla de **rol** no los modifica. Un campo cerrado para todos (`[]` o `excludeFromApi`) está ausente de ellos, como siempre lo ha estado.

El documento de OpenAPI declara la regla en lugar de simular que es específica para cada llamador. Cada propiedad restringida lleva `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo que nadie puede leer está ausente del esquema de lectura y de los parámetros de filtro; un campo que nadie puede escribir está ausente del esquema de entrada. Ambas direcciones son esquemas separados y se evalúan por separado, por lo que un token que un administrador publica y nunca vuelve a leer aparece en el cuerpo de la solicitud y no en la fila.

## Escrituras en proceso

`rebase.data` y `rebase.dataAsAdmin` en un hook, una función o una tarea cron no pasan por la comprobación de escritura. Esa es la misma exención que `excludeFromApi` siempre ha tenido, y es lo que hace que la regla sea aplicable en primer lugar: algo tiene que ser capaz de almacenar el hash de la contraseña.

Las lecturas a través de `rebase.dataAsAdmin` tienen el rol `admin`, por lo que una regla de rol no les oculta nada. `[]` aún lo hace — incluso para `dataAsAdmin`. Utiliza [`rebase.sql()`](/docs/backend/api/) si necesitas la columna sin procesar.

## Validación

Esto se rechaza en el arranque, antes de que el servidor atienda solicitudes:

- `access` y `excludeFromApi` en la misma propiedad — son el mismo mecanismo y el indicador gana, por lo que el bloque adyacente quedaría inactivo;
- una cadena de texto simple donde corresponde una lista (`read: "admin"`), lo cual se interpreta como una regla no vacía que ningún llamador cumple y ocultaría el campo para todo el mundo;
- un rol que no sea una cadena de texto no vacía;
- un campo restringido nombrado en el `search.fields` de la colección.

Los *nombres* de los roles no se verifican contra un conjunto definido: los roles son datos de la aplicación, creados y eliminados mientras el servidor está en ejecución. Un error tipográfico en uno de ellos resulta en un campo que nadie puede leer, lo cual es la dirección segura de fallar.

## Véase también

- [Reglas de seguridad (RLS)](/docs/collections/security-rules/) — a qué filas accede un llamador
- [Propiedades](/docs/collections/properties/) — la tabla completa de opciones
- [Códigos de error](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

---
