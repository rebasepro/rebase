---
sourceHash: b3e463880abd2023
title: Acceso a campos
sidebar_label: Acceso a campos
description: Permisos de lectura y escritura por propiedad según el rol. Un emisor al que las reglas de seguridad de la fila permiten el paso aún así no recibe un campo que sus roles no pueden leer.
---

## Descripción general

[Las reglas de seguridad](/docs/collections/security-rules/) deciden a qué **filas** accede un emisor. `access` decide qué **campos de una fila alcanzada** puede ver y establecer.

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

La regla anterior no aplica ningún filtro de filas a `select`, por lo que cada emisor al que la API da acceso lee todas las filas de staff. Solo un emisor con el rol `hr` obtiene la columna `salary` de una de ellas, y nadie puede establecerla mediante HTTP.

## La regla

`access` tiene dos listas opcionales, y una lista omitida no es una lista vacía — esa diferencia es la clave de toda la funcionalidad.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delegar en la fila. Cualquier persona a quien las reglas de seguridad de la colección le permitan leer (o escribir) la fila obtiene el campo. |
| `[]` | Nadie, a través de la API, con ningún privilegio — ni `admin`, ni la clave de servicio, ni una lectura en proceso (in-process). |
| `["hr"]` | Un emisor con el rol `hr`, **o** `admin`, **o** código de servidor de confianza sin ninguna solicitud detrás. |

Los roles son roles de aplicación de Rebase — los mismos que `rebase.roles()` devuelve dentro de una política y contra los que compila `policy.rolesOverlap`. Proceden del contexto de la llamada: `user.roles` en la solicitud autenticada.

### Por qué `admin` siempre pasa

Cada política base que inyecta Rebase lleva una rama `rolesOverlap(['admin'])`, y `rebase.dataAsAdmin` se ejecuta como `{ uid: "service", roles: ["admin"] }`. Una regla de campo que pudiera bloquear a un administrador el acceso a una columna de su propia base de datos también impediría que Studio la renderice y que la CLI la exporte. Si necesitas una columna que ningún administrador lea a través de la API, eso es `read: []`.

### Por qué el plano de confianza pasa

El código de servidor sin una solicitud detrás — una migración, o el adaptador de autenticación verificando una contraseña — lee sin ningún rol en absoluto, y una lista de roles no se le aplica. `[]` todavía sí se aplica: es una declaración sobre la superficie de la API más que sobre quién está llamando.

El `context.data` de un callback no pertenece a ese plano. Dentro de una solicitud, lee con los roles del emisor, por lo que las reglas de campo se aplican a lo que lee exactamente igual que se aplican a la solicitud.

## `excludeFromApi` es el mismo mecanismo

`excludeFromApi: true` es azúcar sintáctico para `access: { read: [], write: [] }`. Hay un único predicado detrás de ambas formas de escribirlo, por lo que todo lo que aparece en esta página también se aplica al flag. Escribe la opción que mejor se lea — pero no ambas en una misma propiedad, lo cual se rechaza al arrancar.

## Lo que ve un emisor

### Lecturas

Un campo que no puedes leer está **ausente** de la respuesta. Ni `null`, ni una cadena vacía — la clave simplemente no está.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Esto es deliberado. Un valor retenido que se devolviera como `null` sería indistinguible de un `null` almacenado, por lo que un cliente podría mapear toda la columna contándolos — y un `update` que devolviera la fila completa sobrescribiría el valor real con el null que recibió.

Se aplica en cada punto de salida: listados, obtención individual, destinos de relaciones incluidos con `?include=`, resultados de `_batch`, tramas en tiempo real de `.listen()`, resultados agregados e instantáneas del [historial](#historial).

### Consultas

Un `where`, `orderBy`, `fields`, un `select` de agregación o un `groupBy` que mencione un campo que no puedes leer genera un **400 `FIELD_NOT_READABLE`**:

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

Sin esto, el valor sería legible predicado a predicado: veinte solicitudes equivaldrían a una búsqueda binaria sobre un salario.

El error **indica el nombre del campo**. Es una decisión de diseño, no un descuido: el documento OpenAPI publicado lista cada propiedad de cada colección — se sirve desde la aplicación, no desde el router de datos autenticado — por lo que los nombres de los campos ya son públicos. Ocultar el nombre aquí no protegería nada y respondería a un error tipográfico legítimo del emisor con un "campo desconocido", haciéndole buscar una errata que no existe. **Los nombres de los campos son públicos; los valores de los campos no lo son.**

### Escrituras

Un valor para un campo en el que no puedes escribir devuelve un **400**, nunca una clave descartada en silencio — una escritura que descarta un campo informaría de éxito para una edición que no ocurrió.

| Código | Cuándo |
|--------|--------|
| `FIELD_NOT_WRITABLE` | `write` es una lista de roles que no cumples. Tu colega podría recibir un 200 para el mismo cuerpo. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` es `[]` (o `excludeFromApi`). Nadie puede escribir en él; la respuesta es la misma para cualquier emisor. |

Ambos incluyen `details.violations` indexados por el nombre enviado en la petición. Se aplica en creaciones, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operaciones de campo (`{ "salary": { "$inc": 1000 } }` hace referencia a `salary` al igual que cualquier valor) y en la trama `SAVE` de WebSocket.

## Búsqueda

La búsqueda por defecto — una colección sin bloque `search` — coincide mediante `ILIKE` en tus propiedades de cadena, y omite aquellas que el emisor no puede leer. Nada se filtra a través de ella.

Una colección que **sí** declara un [bloque `search`](/docs/backend/api/) se compila en una única columna `tsvector` generada compartida por todos los emisores. No existe una variante por rol de la misma, por lo que un campo restringido incluido en `search.fields` seguiría siendo *coincidente* para emisores que nunca pueden ver su valor — recuperable término a término. Rebase rechaza esa combinación al arrancar: elimina el campo de `search.fields` o retira la restricción de lectura.

## Historial

El [historial de entidades](/docs/backend/api/) almacena la fila completa y se entrega a cualquiera que pueda leer la fila — la condición de acceso es "¿puedes consultar esta entidad?", no "¿eres administrador?". Por lo tanto, la regla de lectura también se aplica a cada instantánea almacenada: la entrada sigue listándose, indicando quién la modificó y cuándo, pero las columnas retenidas desaparecen de sus `values`.

La reversión no se ve afectada. La ruta de reversión lee la entrada almacenada en el lado del servidor, por lo que un emisor puede restaurar una versión cuyos campos no pueda ver en su totalidad — exactamente igual a como ya puede sobrescribir una fila sin leerla por completo.

## Qué muestra el panel de administración

No hay nada que configurar. Studio lee a través de la misma API, por lo que un campo que el emisor no puede leer nunca llega y el formulario no lo dibuja; un campo en el que no puede escribir se rechaza si algo intenta enviarlo. Esta es una garantía en el lado del servidor, a diferencia de `admin.hideFromCollection`, que solo impide que el panel *renderice* un campo pero deja el valor en el JSON.

## Tipos generados y OpenAPI

Los tipos `Row`, `Insert` y `Update` del SDK tienen una única forma para todos los emisores — no existe un `Row` que sea adecuado tanto para un lector con el rol `hr` como para uno que no lo tenga —, por lo que una regla basada en **roles** no los modifica. Un campo cerrado para todos (`[]` o `excludeFromApi`) está ausente de ellos, como siempre lo ha estado.

El documento OpenAPI expone la regla en lugar de fingir ser específico para cada emisor. Cada propiedad restringida incluye `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo que nadie puede leer está ausente del esquema de lectura y de los parámetros de filtrado; un campo que nadie puede escribir está ausente del esquema de entrada. Ambas direcciones son esquemas independientes y se evalúan por separado, de modo que un token que un administrador envía mediante POST y nunca vuelve a leer aparece en el cuerpo de la solicitud y no en la fila.

## Escrituras en proceso (in-process)

Las escrituras en proceso — `context.data` en un callback, `rebase.dataAsAdmin` en un callback, una función o un trabajo programado (cron job) — no pasan por la comprobación de escritura. Esa es la misma exención que `excludeFromApi` siempre ha tenido, y es lo que permite que la regla sea aplicable: algo tiene que ser capaz de almacenar el hash de la contraseña.

Las lecturas a través de `rebase.dataAsAdmin` poseen el rol `admin`, por lo que una regla de roles no les oculta nada. `[]` todavía sí lo hace — incluso para `dataAsAdmin`. Usa [`rebase.sql()`](/docs/backend/api/) si necesitas la columna sin procesar.

## Validación

Esto se rechaza al arrancar, antes de que el servidor sirva nada:

- `access` y `excludeFromApi` en la misma propiedad — son el mismo mecanismo y el flag tiene prioridad, por lo que el bloque junto a él quedaría inerte;
- una cadena de texto simple donde corresponde una lista (`read: "admin"`), lo cual se interpreta como una regla no vacía que ningún emisor cumple y ocultaría el campo a todo el mundo;
- un rol que no sea una cadena de texto no vacía;
- un campo restringido incluido en el `search.fields` de la colección.

Los *nombres* de los roles no se validan contra un conjunto cerrado: los roles son datos de la aplicación, creados y eliminados mientras el servidor está en ejecución. Una errata en uno de ellos resulta en un campo que nadie puede leer, lo cual es la dirección más segura para fallar.

## Consulta también

- [Reglas de seguridad (RLS)](/docs/collections/security-rules/) — a qué filas accede un emisor
- [Propiedades](/docs/collections/properties/) — la tabla completa de opciones
- [Códigos de error](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
