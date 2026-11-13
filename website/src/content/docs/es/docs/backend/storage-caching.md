---
sourceHash: 5711b13e11b0b4c4
title: Caché de almacenamiento y CDNs
sidebar_label: Caché de almacenamiento y CDNs
description: "Cómo Rebase sirve archivos almacenados para que navegadores y CDNs puedan almacenarlos en caché: ETags y 304s, Cache-Control según quién puede leer un objeto, rangos de bytes para desplazamiento en audio y video, y qué configurar en una CDN delante."
---

Cada objeto se transmite a través de un proxy en el servidor en lugar de redirigirse a una
URL firmada: una URL firmada falla con contenido mixto (una página HTTPS, un
MinIO en HTTP) y en endpoints a los que solo el clúster puede acceder. Por lo
tanto, los encabezados de respuesta son los que hacen que el almacenamiento en
caché funcione.

Cada respuesta incluye un `ETag` débil y `Last-Modified`, generados a partir del
tamaño y la fecha de modificación del objeto. Un cliente que ya tiene el objeto
envía `If-None-Match` y recibe un **304 sin cuerpo**, por lo que una carga
repetida cuesta un viaje de ida y vuelta en lugar de una transferencia.

`Cache-Control` depende de quién puede leer el objeto:

| Objeto | Encabezado |
|---|---|
| Bajo el prefijo `public/` o `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Cualquier otra cosa | `private, max-age=60, must-revalidate` |
| Transformaciones de imagen | lo mismo, con `max-age=3600` |

`private` es deliberado: un objeto que requirió credenciales para obtenerse no
debe ser almacenado por una caché compartida, o una CDN podría entregar el
archivo de un usuario al siguiente solicitante. Por la misma razón se envía
`Vary: Authorization`.

Nada se marca jamás como `immutable`. Una clave de almacenamiento puede
sobrescribirse —escribir en una clave existente es una operación ordinaria—, por
lo que la promesa de no revalidar nunca haría que un archivo reemplazado sea
invisible hasta que venza el plazo.

## Desplazamiento en audio y video

Cada respuesta de un objeto incluye `Accept-Ranges: bytes`, y una solicitud con
`Range` se responde con `206 Partial Content` y un `Content-Range`. Sin esto, un
navegador no permitirá desplazarse por un elemento multimedia servido desde aquí
—y Safari se niega a reproducir un `<video>` cuya primera respuesta no sea un
`206`—, por lo que para el contenido multimedia esta es la diferencia entre un
reproductor que funciona y uno roto.

- Un rango por solicitud: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Eso es lo
  que envían los navegadores para la reproducción.
- Los rangos múltiples en un solo encabezado se responden con el objeto completo
  y un `200`, lo cual siempre es válido según la especificación. Nada relevante
  los envía.
- Un rango que comienza más allá del final resulta en un `416` con `Content-Range:
  bytes */<size>`, no en una respuesta silenciosa de todo el archivo.
- La revalidación prevalece sobre un rango: una solicitud que incluye tanto
  `If-None-Match` como `Range` recibe el `304`.

Solo se leen los bytes solicitados —desde el disco en el almacenamiento local y
mediante una lectura por rango desde S3 y GCS—, y cada objeto se transmite al
cliente a medida que se lee en lugar de retenerse primero en memoria, por lo que
servir un video grande le cuesta al servidor la misma memoria que servir una
miniatura. Una revalidación que finaliza en un `304`, un `HEAD`, un `416` y una
representación de imagen en caché se responden a partir de los metadatos del
objeto sin leer sus bytes en absoluto.

Un `StorageController` personalizado obtiene el mismo comportamiento
implementando los métodos opcionales `statObject` y `getObjectStream`. Uno sin
ellos se sirve a través de `getObject`, que lee el objeto completo en cada
solicitud, incluidos los rangos.

## Colocar una CDN delante

Dado que los objetos públicos son `public` con una ventana de
`stale-while-revalidate` y un validador, cualquier proxy inverso o CDN común
puede almacenarlos en caché sin configuración adicional. Apúntelo al origen de la
API y deje que respete los encabezados.

Dos cosas a configurar en la propia CDN:

- **Respetar `Vary: Authorization`**, o no almacenar en caché rutas autenticadas
  en absoluto. Una CDN que ignora `Vary` y almacena en caché respuestas `private`
  es el fallo que este encabezado fue creado para prevenir.
- **Esperar revalidaciones.** El `max-age` corto significa que la CDN volverá a
  consultar periódicamente; esas solicitudes son 304 económicos y son lo que
  evita que se sirva un objeto sobrescrito desactualizado.

## Relacionado

- [Configuración de almacenamiento](/docs/backend/storage/) — los backends desde donde se sirven estos encabezados, y el prefijo `public/` y `publicRead` que hacen que un objeto sea `public`.
- [Autorización por objeto](/docs/backend/storage-authorization/) — quién puede leer un objeto, que es lo que determina entre `public` y `private`.
- [Cargas de archivos](/docs/collections/file-uploads/) — las columnas de almacenamiento que contienen archivos y cómo los sube el panel.
