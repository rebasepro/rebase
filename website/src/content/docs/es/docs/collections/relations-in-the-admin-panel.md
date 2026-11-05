---
sourceHash: 0ca75b0fa4561a93
title: Relaciones en el panel de administración
sidebar_label: Relaciones en el panel de administración
description: Cómo cada relación a muchos se convierte en una pestaña bajo un registro: el segmento de la ruta, filas propias frente a compartidas, las mismas reglas por REST y qué no se convierte en pestaña.
---

Toda relación a muchos — `hasMany`, `manyToMany` o un `via` a muchos — se
convierte en una **pestaña** bajo un registro del panel de administración, que
lista las filas que ese registro alcanza.

## El segmento de ruta es el nombre de la relación

Una lista de hijos se direcciona como `parent/parentId/relationName`:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

El último segmento es el **nombre de la relación**, no el slug de la colección
destino. A menudo coinciden, porque una relación sin nombre toma el slug de su
destino — pero una propiedad de relación en línea toma la *clave de la
propiedad*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

Esto es también lo que hace que funcionen dos relaciones a la misma colección:
cada una tiene su propio nombre, así que cada una tiene su pestaña y su ruta.

## Filas propias frente a filas compartidas

Lo que una pestaña te deja hacer depende de cómo se almacena la relación, porque
los dos casos significan cosas distintas:

| | Uno a muchos (`foreignKeyOnTarget`) | Muchos a muchos (`through`) |
|---|---|---|
| El hijo pertenece a | solo a este padre | a todos los padres que lo enlazan |
| Crear | crea la fila bajo este padre | crea la fila y la enlaza |
| Añadir existente | — | enlaza una fila existente |
| Quitar | **borra** la fila | **desenlaza**; la fila queda intacta |

El panel de administración renderiza cada caso en consecuencia: una pestaña de
muchos a muchos ofrece **Añadir existente** y **Quitar de este registro**, y
nunca un borrado que arrancaría la fila a los demás padres.

## Las mismas reglas sobre REST

Las listas de hijos son consultas de colección normales restringidas a un padre,
así que aceptan todo lo que acepta una lista raíz — filtros, `orderBy`, `limit`,
`offset`, `include` — y `meta.total` cuenta las filas filtradas. Filtra por campo
(`?field=op.value`) o con un objeto completo `?where={"field":["op","value"]}`;
ambos llegan a la misma consulta:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

El segmento del padre se impone, no es decorativo. Direccionar una fila que no
está bajo ese padre devuelve `404`, y `PATCH` nunca mueve una fila de un padre a
otro — define la clave foránea explícitamente si eso es lo que quieres.

En un muchos a muchos, `PATCH parent/id/child/childId` es *pertenencia al
conjunto*: enlaza la fila si aún no lo está, y es idempotente. Así es como
adjuntas una fila que ya existe.

## Qué no se convierte en pestaña

- **Relaciones a uno** — son un campo del registro, no una lista. Escribir a
  través de una ruta a uno se rechaza: la clave foránea vive en la tabla del
  padre.
- **Relaciones declaradas dentro de un `map`** — son un campo de ese map.

## Próximos Pasos

- **[Relaciones](/docs/collections/relations/)** — los cinco tipos y cómo declarar cada uno
- **[Escritura por REST](/docs/backend/writes/)** — crear, actualizar y borrar más allá de una lista hija
