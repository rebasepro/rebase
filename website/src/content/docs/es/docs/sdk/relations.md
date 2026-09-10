---
sourceHash: c7ecc940df2e4680
title: Consultar relaciones
sidebar_label: Relaciones
description: "Incluye entidades relacionadas en una consulta y lee una colección secundaria a través de su elemento principal con los accesores de relaciones del SDK."
---

## Carga de filas relacionadas

Las relaciones se pueden incluir para que las entidades relacionadas se devuelvan junto con los datos principales, en lugar de solo sus IDs de clave foránea.

### Usando `include()` (Fluent)

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

### Usando `find({ include })` (Parámetros)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Anidamiento: relaciones de relaciones

Una ruta con puntos carga una relación de una relación, hasta **tres saltos**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .collection<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Nombrar el salto intermedio es opcional —`comments.author` ya implica
`comments`— y enviar ambos es la misma petición dos veces.

Cada salto es una consulta por lotes (batched query) para toda la página, no una por fila: una página de 50
publicaciones con `comments.author` son tres consultas, sin importar el número de comentarios.
El límite de profundidad es lo que evita que una relación autorreferencial se recorra indefinidamente;
superado este límite, la petición devuelve un 400 `INCLUDE_TOO_DEEP`.

### Delimitar lo que carga una relación

La forma de lista no tiene dónde colocar un `limit` por relación, por lo que una relación que
necesita delimitación acepta un objeto de opciones en su lugar:

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
| `limit` | Filas **por elemento principal**, no en toda la página: cinco comentarios en cada publicación, no cinco en total. |
| `where` | El mismo dialecto de filtrado que utiliza el `where` de nivel superior. Se inserta en la consulta, por lo que el `limit` se aplica a las filas que coinciden. |
| `logical` | Un grupo `or`/`and`/`not` sobre las filas relacionadas. |
| `orderBy` | La misma sintaxis de ordenación, incluyendo la [ubicación de NULL](/docs/sdk/querying#where-nulls-sort). |
| `fields` | Columnas de la fila *relacionada*. Su clave siempre se conserva, por lo que la fila sigue siendo direccionable. |
| `include` | Relaciones de la fila relacionada, a su vez; así es como se anida el árbol. |

`true` es la forma abreviada de "cargar por completo": `{ author: true }` y
`["author"]` son la misma petición.

### Se rechazan los nombres de relaciones desconocidos

Un nombre que no sea una relación de la colección genera un error **400
`UNKNOWN_RELATION`**, en todos los niveles del árbol, incluso dentro de un
`include` anidado. Anteriormente se ignoraba, respondiendo 200 con el campo simplemente
ausente, y un campo de relación ausente no se puede distinguir de una fila que
genuinamente no tiene ninguna fila relacionada. Por lo tanto, un error tipográfico se veía exactamente igual que datos vacíos.

Con un tipo `Database` generado, no se llega tan lejos: las claves de `include` se
comprueban recursivamente en tiempo de compilación contra las relaciones reales de la colección.
Consulta [Includes tipados](#typed-includes).

### A nivel de red

`include` es un único parámetro de consulta con dos formas de escritura, diferenciadas por una
llave inicial:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

La forma plana es la que escribe un humano y la que necesita la mayoría de las peticiones; la forma JSON
existe porque la plana no puede transportar opciones por relación, e inventar una
puntuación para ellas (`comments(limit:5)`) sería una tercera gramática que aprender
junto a las dos que esta API ya tiene. Ambas se aceptan en cada ruta de lista y
de obtención por ID (get-by-id), y el SDK elige la que la consulta requiera.

### Combinación con filtros

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lectura de datos de relaciones

Cuando se incluyen relaciones, la respuesta contiene **tanto** la clave foránea escalar como el objeto de la relación hidratado:

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
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

Una relación, tres lugares donde aparece, y el protocolo deliberadamente no es
simétrico al respecto, por lo que vale la pena conocer las tres:

| Dónde | Forma | Por qué |
|-------|-------|---------|
| **Escritura** | `{ author: id }` **o** `{ authorId: id }` | Se aceptan ambos. El transformador de escritura mapea la propiedad de la relación a la columna de clave foránea, por lo que ambos representan la misma escritura. |
| **Lectura** | `authorId` | Es una columna. Cada lectura la devuelve. |
| **Lectura con `include`** | `author`, la propia fila de destino | Solo se carga cuando la consulta la especifica, por lo que está ausente en cualquier otra lectura. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.collection<Post>("posts");

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
cualquiera de las dos formas de escritura, `Row` tiene `authorId` incondicionalmente, y `author` es
opcional en `Row` y **obligatorio** en la fila que devuelve una lectura con `include` —
consulta [Includes tipados](#typed-includes).

El único caso en el que las tres coinciden es una relación nombrada idénticamente a su
propia clave foránea. En ese caso, la fila incluida se sirve *sobre* la columna, y el
tipo generado lo refleja tipando esa clave como ambas cosas.

### Includes tipados

`rebase generate-sdk` escribe el grafo de relaciones en tu tipo `Database`, junto con
dos utilidades basadas en él:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` restringe las claves de un include a relaciones existentes, en cada
nivel. `RowWith<A, I>` es la fila devuelta por esa lectura, con cada relación incluida
convertida en **obligatoria**, de modo que después de solicitar el autor, `row.author.name`
no necesita `?.`.

Sin un `Database` generado, `include` sigue siendo un `string[]` simple o un árbol: un
tipo de fila escrito a mano no tiene relaciones con las que contrastarse, y el error
400 del servidor actúa como último recurso de seguridad.

### Nombres de relaciones

Los nombres de relación que pasas a `include()` deben coincidir con el `relationName` definido en el array `relations` de la colección:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Consultar a través de una relación

`include()` obtiene las filas relacionadas *después* de que se haya seleccionado la página. Las dos
funcionalidades siguientes seleccionan la página **junto con** ellas: se compilan a SQL, por lo que se ejecutan
antes de `limit` y `offset` en lugar de después.

Esto es lo que necesita una pantalla de cola (queue) —*quién está esperando, el que lleva más tiempo primero*— donde ambas
partes de la pregunta son respondidas por una tabla relacionada en lugar de por la fila que se está listando.

### Filtrar por una columna de la fila relacionada

Una clave con puntos accede a través de una relación a una de las columnas de destino:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Se compila a un `EXISTS` sobre la tabla relacionada, correlacionado con la fila que se está
listando, no a un join, lo que multiplicaría las filas y rompería silenciosamente el funcionamiento de `limit`.

Todos los operadores funcionan, porque lo que se compara es una columna ordinaria:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Los operadores negativos —`!=`, `not-in`, `not-like`, `not-ilike`— significan **"ninguna
fila relacionada coincide"**, no "alguna fila relacionada difiere":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Esa es la interpretación que se busca, y la única que hace que `==` y `!=`
particionen las filas. La otra interpretación —"alguna postulación no es 'hired'"— es
cierta para casi cualquier candidato con más de una postulación y no responde a
lo que nadie preguntó.

`is-null` e `is-not-null` **no** son deliberadamente un par complementario aquí.
Significan "tiene una fila relacionada cuya columna no está definida" y "tiene una donde sí está
definida"; ambas son ciertas para un candidato con dos postulaciones, una de cada tipo.

Un nombre de relación que no existe, o una columna que el destino no tiene, devuelve un
error 400 indicando las columnas reales del destino. Nunca es una condición omitida: omitir
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

El constructor fluent acepta la misma clave:

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` y `avg`. Todos ellos requieren `field`, excepto
`count`, que cuenta las filas relacionadas cuando se omite y cuenta
las filas con una columna no nula cuando se especifica.

Esta es la mitad de una cola que no se puede resolver en el cliente. Un filtro se
puede aproximar desnormalizando un indicador (flag) en la fila; una ordenación no se puede
aproximar en absoluto una vez que el conjunto de resultados está paginado, porque el cliente solo
tiene una página a la vez y la página fue seleccionada con el orden incorrecto.

Las filas con las que la relación no encuentra nada van a parar a un extremo definido: **al final en
orden ascendente, al principio en orden descendente**, la ubicación que Postgres asigna a un `NULL`. Un `count`
sobre nada es `0` en lugar de null, por lo que esas filas se ordenan como cero.

A través de HTTP, la clave es una sola cadena, por lo que encaja en `?orderBy=` sin cambios:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

La paginación por cursor funciona sobre esto. No hay ningún agregado almacenado en la fila del cursor
contra el cual comparar, por lo que el controlador recalcula el valor de la fila del cursor en SQL a partir
del ID que sí tiene.

### Seguridad a nivel de fila (Row-level security)

Ambos se compilan a una subconsulta que se ejecuta como el lector, por lo que una fila
relacionada que tus políticas oculten no coincide con un filtro ni contribuye a un agregado.

Una advertencia, únicamente en el sentido **negativo**: "ninguna fila relacionada coincide" y "ninguna
fila relacionada *que este lector pueda ver* coincide" son la misma frase. Una tabla de destino
con seguridad a nivel de fila y sin una política `SELECT` para `rebase_user` es opaca, por
lo que todas las filas parecen no coincidir y un filtro `!=` / `not-in` reporta de más. Nada
se filtra: las propias políticas de la tabla listada siguen decidiendo qué filas existen en absoluto,
y el sentido positivo no devuelve nada correctamente. La solución es una política `SELECT`
en el destino. Rebase deriva una para un many-to-many declarado; un esquema escrito a mano debe
proporcionarla.

### Compatibilidad de motores

Solo Postgres. Firestore y MongoDB declaran `filterableRelationKinds: []` y
no ofrecen ninguna de las dos funcionalidades; un almacén de documentos enlaza por referencia y no tiene
subconsultas a las que compilar estas operaciones. Consulta las
[capacidades de las fuentes de datos](/docs/backend/multiple-sources).

### ¿Por qué no `additionalFields`?

`AdditionalFieldDelegate.value()` es asíncrono y recibe todo el contexto, por lo que
*puede* leer otra colección, y aun así no sirve de ayuda aquí. Se ejecuta en el
navegador, una vez por fila, **después** de que la página haya sido recuperada y ordenada. Un valor
calculado allí se puede mostrar, pero nunca se puede filtrar, ordenar ni paginar.

Si un valor derivado no es un agregado sobre una relación, colócalo en la base de datos —una
columna generada o una mantenida mediante triggers— y se convertirá en una
propiedad ordinaria.

## Próximos pasos

- [Consultar datos](/docs/sdk/querying/) — el generador de consultas que devuelven estos accesores
- [Relaciones](/docs/collections/relations/) — declarar los enlaces que lee esta página
- [API REST](/docs/backend/api/) — el mismo `include` a través de HTTP

---
