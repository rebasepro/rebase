---
title: Caché de almacenamiento y CDN
sidebar_label: Caché de almacenamiento y CDN
description: Cómo sirve Rebase los archivos almacenados para que los navegadores y las CDN puedan almacenarlos en caché — ETags y 304, Cache-Control según quién puede leer un objeto, rangos de bytes para desplazarse en audio y vídeo, y qué configurar en una CDN por delante.
---

Cada objeto se reenvía a través del servidor mediante proxy en lugar de redirigirse a una
URL firmada — una URL firmada falla con contenido mixto (una página HTTPS, un MinIO por HTTP) y en
endpoints a los que solo puede acceder el clúster. Por lo tanto, las cabeceras de respuesta son las que hacen
que la caché funcione.

Cada respuesta incluye un `ETag` débil y `Last-Modified`, generados a partir del
tamaño del objeto y la hora de modificación. Un cliente que ya tiene el objeto envía
`If-None-Match` y recibe un **304 sin cuerpo**, por lo que una carga repetida cuesta un
viaje de ida y vuelta en lugar de una transferencia completa.

`Cache-Control` depende de quién puede leer el objeto:

| Objeto | Cabecera |
|---|---|
| Bajo el prefijo `public/`, o `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Cualquier otro caso | `private, max-age=60, must-revalidate` |
| Transformaciones de imágenes | lo mismo, con `max-age=3600` |

`private` es deliberado: un objeto que requirió credenciales para recuperarse no debe ser
almacenado por una caché compartida, o una CDN podría entregar el archivo de un usuario al siguiente solicitante.
`Vary: Authorization` se envía por la misma razón.

Nunca se marca nada como `immutable`. Una clave de almacenamiento se puede sobrescribir — escribir
en una clave existente es una operación ordinaria —, por lo que prometer no volver a validar nunca
haría que un archivo reemplazado fuera invisible hasta que expirase la ventana de tiempo.

## Búsqueda y desplazamiento (seeking) en audio y vídeo

Cada respuesta de objeto incluye `Accept-Ranges: bytes`, y una solicitud `Range` se
responde con `206 Partial Content` y un `Content-Range`. Sin esto, un navegador
no permitirá desplazarse en un elemento multimedia servido desde aquí —y Safari se niega
a reproducir un `<video>` cuya primera respuesta no sea un `206`—, por lo que para el contenido multimedia esta es
la diferencia entre un reproductor que funciona y uno roto.

- Un rango por solicitud: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Eso es lo que
  envían los navegadores para la reproducción.
- Múltiples rangos en una sola cabecera se responden con el objeto completo y un `200`,
  lo cual siempre es válido. Ningún cliente relevante los envía.
- Un rango que comienza más allá del final devuelve un `416` con `Content-Range: bytes */<size>`,
  no una respuesta silenciosa con el archivo completo.
- La revalidación prevalece sobre un rango: una solicitud que lleve tanto `If-None-Match` como
  `Range` recibe el `304`.

En el almacenamiento local solo se lee del disco la porción solicitada. En S3 y GCS, el
objeto se sigue recuperando por completo —un `StorageController` no tiene lectura por rangos—, por lo que el
ahorro se produce en la respuesta, no aguas arriba.

## Colocar una CDN por delante

Dado que los objetos públicos son `public` con una ventana de `stale-while-revalidate` y un
validador, cualquier proxy inverso o CDN ordinario puede almacenarlos en caché sin ninguna
configuración adicional. Apúntelo al origen de la API y deje que respete las cabeceras.

Dos cosas que debe configurar en la propia CDN:

- **Respetar `Vary: Authorization`**, o no almacenar en caché las rutas autenticadas en absoluto.
  Una CDN que ignore `Vary` y almacene en caché respuestas `private` es el fallo que
  esta cabecera busca prevenir.
- **Esperar revalidación.** El valor corto de `max-age` significa que la CDN volverá a preguntar
  periódicamente; esas solicitudes son 304 económicos, y son lo que evita que un
  objeto sobrescrito se sirva desactualizado.

## Relacionado

- [Configuración de almacenamiento](/docs/backend/storage/) — los backends desde los que se sirven estas cabeceras, y el prefijo `public/` y `publicRead` que hacen `public` a un objeto.
- [Autorización por objeto](/docs/backend/storage/#autorización-por-objeto) — quién puede leer un objeto, que es lo que decide entre `public` y `private`.
- [Campos de subida de archivos](/docs/collections/file-uploads/) — las propiedades de colección que almacenan archivos.
