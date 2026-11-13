---
sourceHash: 3db2d10879df1c44
title: Consultar relaciones
sidebar_label: Relaciones
description: "Incluye entidades relacionadas en una consulta y lee una tabla secundaria a través de su principal con los accesores de relaciones del SDK."
---

## Cargar filas relacionadas

Las relaciones se pueden incluir para que las entidades relacionadas se devuelvan junto con los datos principales, en lugar de solo los IDs de sus claves foráneas.

### Uso de `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations, one hop deep
const { data } = await client.data.posts
    .include("*")
    .find();
```

Las llamadas repetidas se **suman** entre sí en lugar de reemplazarse, por lo
que `.include("author").include("categories")` solicita ambas.

### Uso de `find({ include })` (Parámetros)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Anidamiento: relaciones de relaciones

Una ruta con puntos carga una relación de una relación, hasta un máximo de **tres saltos**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .table<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Nombrar el salto intermedio es opcional (`comments.author` ya implica
`comments`), y enviar ambos equivale a la misma solicitud dos veces.

Cada salto es una consulta por lotes para toda la página, no una por fila: una página de 50
publicaciones con `comments.author` son tres consultas, sin importar la cantidad de comentarios.
El límite de profundidad es lo que evita que una relación autorreferenciada recorra indefinidamente;
más allá de este, la solicitud devuelve un error 400 `INCLUDE_TOO_DEEP`.

### Delimitar lo que carga una relación

La forma de lista no tiene dónde colocar un `limit` por relación, por lo que una relación
que necesita restringirse acepta en su lugar un objeto de opciones:

```typescript
const { data } = await client.data.posts.include({
    comments: {
        limit: 5,
        where: { published: ["==", true] },
        orderBy: ["createdAt", "desc"],
        fields: ["id", "body"],
        include: { author: true }
    }
}).find();
```

| Opción | Qué hace |
|--------|----------|
| `limit` | Filas **por registro principal**, no en toda la página; cinco comentarios en cada publicación, no cinco en total. Se aplica mediante la consulta, por lo que las filas más allá de este límite nunca se leen de la base de datos. |
| `where` | El mismo dialecto de filtrado que utiliza el `where` de nivel superior. Se traslada a la consulta, por lo que el `limit` se aplica a las filas que coinciden. |
| `logical` | Un grupo `or`/`and`/`not` sobre las filas relacionadas. |
| `orderBy` | La misma sintaxis de ordenación, incluida la [ubicación de NULL](/docs/sdk/querying#where-nulls-sort). Los empates y un `limit` sin `orderBy` se ordenan por la clave de la fila relacionada, de forma ascendente. |
| `fields` | Columnas de la fila *relacionada*. Su clave siempre se conserva, por lo que la fila sigue siendo direccionable. |
| `include` | Relaciones de la fila relacionada, a su vez; así es como se anida el árbol. |
| `count` | También devuelve cuántas filas relacionadas hay en total, por registro principal, bajo el `_count` de la fila. Consulta [Contar lo que excluye un límite](#contar-lo-que-excluye-un-límite). |

`true` es la forma abreviada de "cargar todo": `{ author: true }` y
`["author"]` representan la misma solicitud.

### Contar lo que excluye un límite

Un `limit` restringe
lo que se envía, y `count: true` indica cuánto se omitió. Esto es lo que una lista
necesita para mostrar cuatro etiquetas y un "+33":

```typescript
const { data } = await client.data.posts.include({
    tags: { limit: 4, count: true }
}).find();

// data[0] → { id: 1, title: "…", tags: [ …4 rows ], _count: { tags: 37 } }
```

- `_count` es un objeto por fila, indexado por el nombre de la relación. Contar dos relaciones
  añade dos claves.
- El total se cuenta en la misma sentencia SQL que lee las filas. Cubre
  las mismas filas que devolvería una lectura sin el `limit`: se aplican el `where`
  del include, el borrado suave (soft delete) y la seguridad a nivel de fila. Solicitarlo no añade ninguna consulta adicional.
- Sin un `limit`, el total es el número de filas devueltas.
- `count` solo funciona en relaciones uno a muchos. En una relación uno a uno, devuelve un error
  400 `INVALID_INCLUDE`. Lo mismo ocurre con una tabla que tiene una columna llamada
  `_count`, porque el total la sobrescribiría.
- Una relación que el llamador no tiene permiso para leer (acceso a nivel de campo) se omite de `_count`,
  del mismo modo que se omiten sus filas.

### Los nombres de relación desconocidos son rechazados

Un nombre que no sea una relación de la tabla genera un error **400
`UNKNOWN_RELATION`**, en todos los niveles del árbol, incluso dentro de un
`include` anidado. Anteriormente se ignoraba, respondiendo 200 simplemente con
la ausencia del campo, y la ausencia de un campo de relación es indistinguible de una fila que
genuinamente no tiene una fila relacionada. Por lo tanto, un error tipográfico parecía exactamente un conjunto de datos vacío.

Con un tipo `Database` generado, ni siquiera llega a esa instancia: las claves de `include` se
verifican recursivamente contra las relaciones reales de la tabla en tiempo de compilación.
Consulta [Includes tipados](#includes-tipados).

### A nivel de red

`include` es un único parámetro de consulta con dos formas de escritura, que se diferencian
por una llave inicial:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

La forma plana es la que escribe un humano y la que necesitan la mayoría de las solicitudes; la forma JSON
existe porque la plana no puede incluir opciones por relación, e inventar una
puntuación para ellas (`comments(limit:5)`) implicaría una tercera gramática que aprender
además de las dos que ya tiene esta API. Ambas se aceptan en cada ruta de lista y
de obtención por ID, y el SDK elige la que la consulta requiera.

### Combinación con filtros

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lectura de datos de relación

Cuando se incluyen relaciones, la respuesta contiene **tanto** la clave foránea escalar como el objeto de relación hidratado:

```typescript
const { data } = await client.data
    .table<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Nota:** Sin `.include("author")`, solo se devuelve el campo escalar `authorId`. El objeto hidratado `author` será `undefined`.

### Un `belongsTo` tiene tres formas

Una relación, tres lugares donde aparece; y la comunicación por red deliberadamente no
es simétrica al respecto, por lo que vale la pena conocer las tres:

| Dónde | Forma | Por qué |
|-------|-------|---------|
| **Escritura** | `{ author: id }` **o** `{ authorId: id }` | Ambas se aceptan. El transformador de escritura asigna la propiedad de la relación a la columna de clave foránea, por lo que ambas representan la misma escritura. Un objeto (`{ author: { id } }`) devuelve un 400 que especifica la relación: envía la clave. |
| **Lectura** | `authorId` | Es una columna. Cada lectura la devuelve. |
| **Lectura con `include`** | `author`, la propia fila de destino | Se carga únicamente cuando la consulta la especifica, por lo que está ausente en cualquier otra lectura. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.table<Post>("posts");

// Write: either spelling.
await posts.create({ title: "Hello", author: authorId } as Partial<Post>);
await posts.create({ title: "Hello", authorId });

// Read: the key.
const post = await posts.get(id);
post.authorId;          // "uuid-1234"
post.author;            // undefined — nothing asked for it

// Read with include: the row.
const { data } = await posts.include("author").find();
data[0].authorId;       // "uuid-1234" — still there
data[0].author?.name;   // "Jane Doe"
```

Un tipo `Database` generado tipa las tres con precisión: `Insert` y `Update` aceptan
cualquiera de las dos formas de escritura, `Row` contiene `authorId` incondicionalmente, y `author` es
opcional en `Row`; `RowWith<"posts", ["author"]>` es la fila con esta propiedad como
**obligatoria**, para una lectura que la solicitó. Consulta [Includes tipados](#includes-tipados).

El único caso en el que las tres colapsan en una sola es una relación nombrada idénticamente a su
propia clave foránea. En ese caso, la fila incluida se sirve *sobre* la columna, y el
tipo generado lo refleja tipando esa clave como ambas cosas.

### Includes tipados

`rebase generate-sdk` escribe el grafo de relaciones en tu tipo `Database`, junto con
dos helpers construidos sobre él:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` restringe las claves de un include a relaciones que existen, en todos los
niveles; y un cliente tipado comprueba `include` de la misma manera, tanto en `find({ include })`
como en `.include(...)`, por lo que `posts.include("authr")` es un error de compilación en lugar
de un 400 `UNKNOWN_RELATION`. Las filas que devuelve una lectura aún tipan cada relación
como opcional; `RowWith<A, I>` es esa fila con cada relación incluida convertida en
**obligatoria**, para anotar lo que lees; de modo que después de solicitar el autor,
un `RowWith<"posts", ["author"]>` no necesita `?.` en `row.author.name`.

Sin un tipo `Database` generado, `include` sigue siendo un simple `string[]` o árbol: un
tipo de fila escrito a mano no contiene relaciones contra las cuales verificar, y el
400 del servidor actúa como mecanismo de seguridad.

### Nombres de relaciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los nombres que pasas a `include()` son las claves de `relations` de la tabla:

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { categories } from "./categories";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull()
    },
    relations: {
        author: rel.belongsTo(() => users),
        categories: rel.manyToMany(() => categories)
    },
    rls: "admin-only"
});
```

```typescript
// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Consultar a través de una relación

`include()` obtiene las filas relacionadas *después* de que se haya elegido la página. Las dos
funciones siguientes eligen la página **con** ellas: se compilan a SQL, por lo que se ejecutan
antes de `limit` y `offset` en lugar de después.

Esto es lo que necesita una pantalla de cola de espera —*quién está esperando, el que lleva más tiempo primero*—, donde
ambas partes de la pregunta son respondidas por una tabla relacionada en lugar de por la fila que se está listando.

### Filtrar por una columna de la fila relacionada

Una clave con puntos accede a través de una relación a una de las columnas del destino:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Se compila en un `EXISTS` sobre la tabla relacionada, correlacionado con la fila que se está
listando; no es un join, lo que multiplicaría las filas y rompería de forma silenciosa el `limit`.

Todos los operadores funcionan, porque lo que se compara es una columna común y corriente:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Los operadores negativos (`!=`, `not-in`, `not-like`, `not-ilike`) significan **"ninguna
fila relacionada coincide"**, no "alguna fila relacionada difiere":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Esa es la interpretación que deseas, y la única que hace que `==` y `!=`
particionen las filas. La otra interpretación ("alguna solicitud no es 'hired'") es
cierta para casi cualquier candidato con más de una solicitud, y no responde
a lo que nadie preguntó.

`is-null` e `is-not-null` deliberadamente **no** son un par complementario aquí.
Significan "tiene una fila relacionada cuya columna no está establecida" y "tiene una donde sí está
establecida"; ambas son ciertas para un candidato con dos solicitudes, una de cada tipo.

Un nombre de relación que no existe, o una columna que el destino no tiene, produce un error
400 que enumera las columnas reales del destino. Nunca es una condición omitida: omitir
una clave de filtro *ampliaría* la lectura a todas las filas.

### Ordenar por un agregado sobre una relación

```typescript
// Candidates, whoever has been waiting longest first.
const { data } = await client.data.talents.find({
    where: { "applications.status": ["in", ["applied", "reviewing"]] },
    orderBy: [[{ relation: "applications", field: "createdAt", agg: "min" }, "asc"]]
});

// Clients, busiest first.
orderBy: [[{ relation: "orders", agg: "count" }, "desc"]]
```

El generador fluido (fluent builder) acepta la misma clave:

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` y `avg`. `field` es requerido por todos ellos
excepto `count`, que cuenta las filas relacionadas cuando lo omites y cuenta
las filas con una columna no nula cuando lo incluyes.

Esta es la mitad de una cola que no puedes resolver en el cliente. Un filtro se
puede aproximar desnormalizando una bandera en la fila; una ordenación no se puede
aproximar en absoluto una vez que el conjunto de resultados está paginado, porque el cliente solo
tiene una página en cada momento y dicha página fue elegida con el orden incorrecto.

Las filas desde las cuales la relación no alcanza nada van a un extremo definido: **al
final en orden ascendente, al principio en descendente**, la ubicación que Postgres otorga a un `NULL`. Un `count`
de nada es `0` en lugar de null, por lo que esas filas se ordenan como cero.

A través de HTTP, la clave es una sola cadena de texto, por lo que encaja en `?orderBy=` sin cambios:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

La paginación por cursor funciona sobre esto. No hay ningún agregado almacenado en la fila del cursor
con el cual comparar, por lo que el controlador vuelve a calcular el valor de la fila del cursor en SQL a partir
del id que sí posee.

### Seguridad a nivel de fila

Ambos se compilan en una subconsulta que se ejecuta como el lector, por lo que una fila relacionada que tus
políticas ocultan no coincide con un filtro y no contribuye a un agregado.

Una advertencia, únicamente en la dirección **negativa**: "ninguna fila relacionada coincide" y "ninguna
fila relacionada *que este lector pueda ver* coincide" son la misma sentencia. Una tabla de destino
con seguridad a nivel de fila y sin una política `SELECT` para `rebase_user` es opaca, por
lo que todas las filas parecen no coincidentes y un filtro `!=` / `not-in` reporta de más. No se
filtra nada: las propias políticas de la tabla listada siguen decidiendo qué filas existen en absoluto,
y la dirección positiva no devuelve nada correctamente. La solución es una política `SELECT`
en el destino. Rebase deriva una para una relación muchos a muchos declarada; un
esquema escrito a mano debe proporcionarla.

### Soporte de motores

Solo Postgres. Una colección de Firestore en el CMS declara
`filterableRelationKinds: []` y no ofrece ninguna de las dos funciones; un almacén de documentos
enlaza por referencia y no tiene una subconsulta en la que compilar esto. Consulta
[Firebase](/docs/frontend/firebase/).

### ¿Por qué no `additionalFields`?

`AdditionalFieldDelegate.value()` es asíncrono y obtiene todo el contexto, por lo que
*puede* leer otra tabla; aun así, no puede ayudar aquí. Se ejecuta en el
navegador, una vez por fila, **después** de que la página haya sido obtenida y ordenada. Un valor
calculado allí se puede mostrar, pero nunca se puede filtrar, ordenar ni paginar sobre él.

Si un valor derivado no es un agregado sobre una relación, colócalo en la base de datos (una
columna generada o una mantenida mediante triggers) y se convertirá en una
propiedad ordinaria.

## Próximos pasos

- [Consultar datos](/docs/sdk/querying/) — el generador de consultas que devuelven estos accesores
- [Relaciones](/docs/collections/relations/) — cómo declarar los enlaces que lee esta página
- [API REST](/docs/backend/api/) — el mismo `include` a través de HTTP
