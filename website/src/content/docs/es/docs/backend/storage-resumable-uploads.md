---
sourceHash: 77d34fca08a6a305
title: Cargas reanudables (TUS)
sidebar_label: Cargas reanudables (TUS)
description: El endpoint TUS v1.0.0 bajo /api/storage/tus — cómo sube un archivo grande a trozos, qué responde cada petición, cómo lo usan el SDK y el panel de administración, y cómo se comporta ante reinicios y varias instancias.
---

Para subir archivos grandes o gestionar condiciones de red inestables, Rebase implementa el protocolo abierto **TUS v1.0.0**, incluidas las extensiones `Creation` y `Termination`.
Sus límites son los del origen, como en toda subida — consulta
[Qué tamaño puede tener un archivo](/docs/backend/storage/#how-large-a-file-may-be).

## Por qué los archivos grandes van por aquí

`POST /api/storage/upload` es un único cuerpo multipart, que el servidor analiza entero
antes de almacenarlo: entre tres y cinco veces el archivo en su memoria (unos 340 MB
para un archivo de 100 MB). Una subida reanudable mantiene un trozo a la vez — cada `PATCH`
queda por debajo del límite global de cuerpo, 10 MB por defecto — y se escribe en el almacén
desde disco: unos 50 MB para ese archivo, y 80 MB para uno de 400 MB. Así que ajusta el
límite del origen a la memoria del servidor si los clientes usan `POST /api/storage/upload`
para archivos grandes, y no en caso contrario.

<span class="since-badge" data-since="0.25">Desde 0.25</span> `client.storage.putObject()` y el panel de administración envían un archivo de más de
8 MiB por el endpoint reanudable, en trozos de 8 MiB, y reanudan un trozo que
falla por el camino desde el desplazamiento que tiene el servidor. El archivo llega
tal como lo almacenaría `POST /api/storage/upload` — la misma clave, bucket, tipo, metadatos
personalizados, límites, comprobación `storageAuthorize` y disparador `finalize` — y la
llamada devuelve el mismo `{ key, bucket, storageUrl }`. Cuando la ruta reanudable
no puede llevarlo — un servidor sin el endpoint, un trozo que supera el límite de cuerpo del servidor,
o una instancia que no tiene la subida (consulta
[Ejecutar varias instancias](/docs/deployment/multiple-instances/#files)) — el
archivo pasa por `POST /api/storage/upload` en su lugar, y ese origen envía
también así todos los archivos posteriores.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

## Ciclo de vida de la subida

1. **Inicio de sesión (`POST`)**: El cliente envía el tamaño total del archivo en la cabecera `Upload-Length` y metadatos en base64 mediante `Upload-Metadata`: `key` (o `filename`), `filetype`, `bucket`, `storageId`, `collection` y `property`, tal como los toma `POST /api/storage/upload` como campos de formulario, y <span class="since-badge" data-since="0.25">Desde 0.25</span> entradas `metadata_<name>`, que pasan a ser los metadatos personalizados del objeto como lo hacen los campos `metadata_<name>`. El servidor crea un archivo marcador vacío en un directorio temporal oculto `.tus-uploads/`, <span class="since-badge" data-since="0.25">Desde 0.25</span> con un registro de la subida a su lado (`<id>.json`: su clave, bucket, origen, tipo, tamaño y propietario), y devuelve la URL de subida. <span class="since-badge" data-since="0.25">Desde 0.25</span> También responde `Rebase-Upload-Result: on-complete`: este servidor informa de lo que almacenó cuando termina la subida. La subida vive en ese directorio, no en el proceso: un servidor reiniciado la reanuda, y toda instancia que comparta `STORAGE_PATH` la sirve — consulta [Ejecutar varias instancias](/docs/deployment/multiple-instances/#files).
2. **Consultas de progreso (`HEAD`)**: Si una subida se interrumpe, el cliente consulta la URL de subida con una petición `HEAD`. El servidor devuelve la posición actual en bytes en la cabecera `Upload-Offset`.
3. **Añadir datos (`PATCH`)**: El cliente reanuda el envío de datos binarios desde el desplazamiento devuelto con `Content-Type: application/offset+octet-stream`. El servidor escribe cada trozo en el archivo temporal en el desplazamiento de bytes que declara la petición, que debe ser el que tiene el servidor (`409` en caso contrario). Se recibe un trozo a la vez: un `PATCH` que llega mientras otro de la misma subida aún se está recibiendo — normalmente un cliente que reenvía un trozo que se quedó parado — se responde con `423 UPLOAD_LOCKED`, y el cliente reanuda desde el desplazamiento que informa `HEAD`.
4. **Finalización**: Cuando el `Upload-Offset` acumulado coincide con el `Upload-Length` declarado, Rebase lee el archivo temporal completo, lo envuelve como un objeto `File` estándar de JavaScript y lo guarda en el backend de almacenamiento configurado (disco local o S3). Después se elimina el archivo temporal. <span class="since-badge" data-since="0.25">Desde 0.25</span> Ese último `PATCH` responde `Rebase-Upload-Result` con el objeto almacenado — `{ key, bucket, storageUrl }`, lo que `POST /api/storage/upload` responde bajo `data` — como JSON codificado en URI. Un frontend en otro origen puede leerlo, y también `Location` y `Upload-Offset`, solo cuando el servidor los expone en `Access-Control-Expose-Headers`: el runtime de Rebase y el backend con eject lo hacen; un [servidor personalizado](/docs/backend/custom-server/) tiene que hacerlo.
5. **Barrido periódico**: Un limpiador en segundo plano se ejecuta cada **60 segundos** para eliminar las subidas temporales incompletas que empezaron hace más de **24 horas** — también las que inició otro proceso, leídas del directorio.

## Quién puede acceder a una subida

Una subida iniciada por una persona con sesión iniciada solo responde a esa persona y a los administradores;
cualquier otra recibe `404`, como si el id no existiera. Una subida iniciada sin sesión no tiene
propietario, así que su id es una capacidad: quien tenga la URL de la subida puede leer su progreso, añadirle
datos y cancelarla. Mantén esa URL en secreto, como harías con un token de descarga. Solo un despliegue
que ejecute el almacenamiento con `requireAuth: false` puede iniciar una: con `requireAuth` activado, que es el
valor por defecto, un `POST` sin sesión se rechaza con `401`.

## Relacionado

- [Configuración del almacenamiento](/docs/backend/storage/) — orígenes, límites, endpoints y autorización
- [Ejecutar varias instancias](/docs/deployment/multiple-instances/#files) — dónde vive una subida en curso
- [SDK de almacenamiento](/docs/sdk/storage/) — `putObject()`, que usa este endpoint para archivos de más de 8 MiB
