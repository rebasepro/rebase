---
sourceHash: de9051fe769a602b
title: Ejecutar más de una instancia
sidebar_label: Más de una instancia
description: "Cada elemento de estado que un proceso de Rebase mantiene para sí mismo y la configuración que lo comparte: qué configurar antes de que una segunda réplica, un despliegue rolling o un despliegue dividido reciba tráfico."
---

## Descripción general

La mayor parte de un despliegue de Rebase ya reside en la base de datos: filas, usuarios y sesiones, claves de API, la cola de trabajos, reclamos de cron, claves de idempotencia, historial de registros, los tokens del servidor MCP OAuth. Un segundo proceso que apunte a la misma base de datos ve todo esto.

Algunas cosas no lo hacen. Cada una es por proceso de forma predeterminada, porque un solo proceso es el despliegue por defecto y compartir tiene un coste: una tabla, una escritura en un bucket, una conexión a la base de datos. Ejecutar dos procesos detrás de un balanceador de carga, escalar automáticamente más allá de uno, o un despliegue rolling que ejecute brevemente la versión antigua y la nueva en paralelo, son situaciones que le llevarán a esta página. Lo mismo ocurre con un [despliegue dividido](/docs/deployment/split-processes/), que por definición consta de varios procesos.

Revise la siguiente lista antes de que la segunda instancia reciba tráfico. Nada en ella falla de forma ruidosa: cada elemento se manifiesta como un límite aplicado tres veces, un evento que algunos clientes nunca ven, o una página que muestra registros diferentes en cada actualización.

## Lista de verificación

| Qué | Por proceso de forma predeterminada | Qué lo comparte |
| --- | --- | --- |
| Secretos de firma | Generados por proceso en desarrollo | `JWT_SECRET` y `REBASE_SERVICE_KEY`, establecidos explícitamente e **idénticos** en todas partes |
| Contadores de límite de tasa | En memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Dirección del cliente detrás de un proxy | `TRUSTED_PROXY_HOPS=0` | El número de proxies por delante, igual en todas partes |
| Suscripciones a colecciones | Compartidas a través de la base de datos cuando CDC está activado | `REALTIME_CDC=auto` (el valor por defecto) |
| Canales de difusión (broadcast) y presencia | En memoria | `REALTIME_CHANNEL_BUS=postgres` |
| Archivos subidos, `STORAGE_TYPE=local` | El propio disco de la instancia | S3 o GCS, o un volumen compartido en el directorio padre de `STORAGE_PATH` |
| Subidas reanudables (TUS) en progreso | El disco de la instancia, en `STORAGE_PATH/.tus-uploads` | Un volumen compartido en `STORAGE_PATH`, o sesiones persistentes (sticky sessions) |
| Transformaciones de imágenes | Una caché en el proceso | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Un búfer circular de las últimas 10.000 líneas | Nada: envíe stdout a un agregador de registros |
| Temporizadores de Cron | Cada proceso que ejecuta el programador | Reclamado en la base de datos: una ejecución por intervalo. `REBASE_CRON_SCHEDULER` elige dónde residen los temporizadores |
| Auditoría RLS programada | Cada proceso que la posee | `REBASE_RLS_AUDIT=false` en todos excepto uno |
| El `index.html` de una app estática | Leído una vez por proceso | Reiniciar cada instancia cuando cambie la compilación |
| `/metrics` | Cada proceso cuenta el suyo propio | Hacer scrape de cada instancia |

Las secciones siguientes detallan qué ocurre con cada uno cuando se mantiene a nivel de proceso.

## Secretos de firma

`JWT_SECRET` firma cada sesión y `REBASE_SERVICE_KEY` autentica las llamadas entre servidores. En desarrollo, cada proceso genera el suyo propio cuando no están establecidos, por lo que un token emitido por un proceso es rechazado por el siguiente. En producción ya se deniega el arranque sin ellos; lo que importa con varios procesos es que cada uno reciba los **mismos** valores: a partir de un único secreto, no uno por réplica.

## Límites de tasa y la dirección del cliente

Los limitadores de tasa —el presupuesto por emisor de llamadas en las API de datos, almacenamiento y funciones, y los limitadores de autenticación en el inicio de sesión, restablecimiento de contraseña, códigos de un solo uso e intentos de MFA— cuentan en memoria de forma predeterminada. Un proceso no puede ver cuántos pares tiene, por lo que tres réplicas con la configuración por defecto aplicarán tres veces cada límite. Establezca `REBASE_RATE_LIMIT_STORE=sql` y los contadores residirán en la base de datos en su lugar.

Detrás de un balanceador de carga, el limitador también necesita la dirección real del cliente, que llega en `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indica cuántos proxies omitir; con el valor predeterminado `0`, cada solicitud parece provenir del balanceador de carga y todos los clientes comparten un único bucket. Consulte [Configuración](/docs/getting-started/configuration/#runtime-behaviour).

## Tiempo real

**Las suscripciones a colecciones** funcionan entre instancias cuando la captura de cambios a nivel de base de datos (CDC) está activada, lo cual ocurre por defecto (`REALTIME_CDC=auto`): un trigger anuncia cada escritura confirmada, y el listener de cada instancia vuelve a consultar los datos para sus propios suscriptores. Si CDC está desactivado, o si `auto` no pudo aprovisionarlo (el registro de arranque indica cuál es el caso), una suscripción solo ve las escrituras realizadas a través de la instancia a la que está conectado su socket. Consulte [Tiempo real](/docs/backend/realtime-cdc/).

**Los canales de difusión (broadcast) y la presencia** se gestionan en el proceso a menos que un bus los transporte: dos clientes en diferentes instancias en el mismo canal no se escuchan entre sí, y cada instancia responde "¿quién está aquí?" con su propia mitad. Establezca `REALTIME_CHANNEL_BUS=postgres`. El bus escucha en la base de datos, lo que requiere una conexión directa en lugar de un pooler de transacciones; establezca `DATABASE_DIRECT_URL` cuando `DATABASE_URL` pase por pgBouncer. Consulte [Canales y presencia entre instancias](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Archivos

Con `STORAGE_TYPE=local`, las subidas son archivos en el disco de la instancia que las recibió, y otra instancia responderá 404 para ellos. Utilice S3 o GCS, o monte un volumen en cada instancia, en el directorio superior de `STORAGE_PATH` para que también contenga el directorio `<STORAGE_PATH>__<key>` de cada bucket local con nombre. Consulte [Autohospedaje: almacenamiento de archivos](/docs/deployment/self-hosting/#file-storage).

**Las subidas reanudables** (el endpoint TUS) conservan el archivo parcial de cada subida y, un registro de la subida junto a él, en el disco de la instancia que lo creó, bajo `STORAGE_PATH/.tus-uploads`, incluso cuando los archivos completados van a S3 o GCS. Monte un volumen en `STORAGE_PATH` en cada instancia y cualquier instancia servirá cualquier subida; un reinicio o un despliegue rolling reanudará una subida donde se quedó. Sin un volumen compartido, un fragmento (chunk) que llegue a otra instancia recibirá una respuesta 404: enrute las solicitudes de subida de un cliente a una sola instancia (sesiones persistentes o sticky sessions en el balanceador de carga). El SDK y el panel de administración, que usan este endpoint para archivos de más de 8 MiB, enviarán entonces el archivo a través de `POST /upload` en su lugar, y continuarán haciéndolo durante el resto de la sesión. Las subidas ordinarias a través de `POST /upload` consisten en una única solicitud y no se ven afectadas. En la versión 0.23, el estado de la subida estaba en la memoria del proceso, por lo que un volumen compartido no ayudaba y un reinicio devolvía la subida al byte 0.

**Las transformaciones de imágenes** (`?width=400&format=webp`) se almacenan en caché en memoria, por lo que cada instancia calcula cada variante una vez, y una nueva instancia comienza en frío. Establezca `STORAGE_RENDITION_CACHE=true` para escribir cada representación (rendition) de vuelta en el bucket del que provino, donde cada instancia la encontrará. Eso hace que una petición `GET` escriba en su bucket, motivo por el cual está desactivado a menos que se solicite. Consulte [Almacenamiento](/docs/backend/storage/).

## Logs Explorer

El Logs Explorer de Studio lee un búfer circular de las últimas 10.000 líneas de registro mantenidas por el proceso que atiende la solicitud. Detrás de un balanceador de carga, cada actualización puede mostrar las líneas de una instancia diferente, y ninguna de ellas muestra el despliegue completo. El explorador indica el nombre de la instancia que está mostrando. No existe ninguna configuración para compartir este búfer circular: en producción, el entorno de ejecución escribe una línea JSON por evento en stdout, y eso es lo que se debe recopilar: el servicio de registros de su plataforma, Loki o cualquier herramienta que lea la salida del contenedor.

## Cron y la cola de trabajos

Cada proceso que ejecuta el programador de cron activa sus propios temporizadores, y la ejecución se reclama primero en la base de datos, por lo que un intervalo se ejecuta **una sola vez**, sin importar cuántos procesos se disparen para él. Pausar un trabajo y el bloqueo (lease) que evita que un desencadenador manual interfiera con una ejecución en curso se comparten de la misma manera. No hay nada que configurar, siempre que la base de datos sea Postgres. `REBASE_CRON_SCHEDULER` y `REBASE_JOB_WORKERS` deciden qué procesos ejecutan temporizadores y workers en absoluto; consulte [Procesos divididos](/docs/deployment/split-processes/).

La auditoría RLS programada es la excepción: no se reclama, por lo que cada proceso que la posee realiza un escaneo en su propio temporizador. Esto es redundante en lugar de inseguro; establezca `REBASE_RLS_AUDIT=false` en todas partes excepto en una.

## Aplicaciones estáticas

Un proceso que sirve el frontend o el CMS (`REBASE_SERVE_STATIC`, activado por defecto) lee el `index.html` de cada aplicación una vez y lo mantiene en memoria. Reemplazar la compilación en un volumen compartido no llega a un proceso en ejecución: continúa sirviendo el documento antiguo, el cual referencia fragmentos (chunks) que tal vez ya no existan. Despliegue una nueva compilación reiniciando o actualizando progresivamente (rolling) cada instancia, algo que una nueva imagen o paquete hace de todos modos. Con una CDN por delante y `REBASE_SERVE_STATIC=false`, esto no aplica.

## Métricas

`/metrics` reporta la información del proceso que responde a la solicitud. Recopile las métricas (scrape) de cada instancia —un trabajo de descubrimiento de servicios de Prometheus por pod, no un único destino detrás del balanceador de carga— y súmelas en la consulta.

## Aprovisionamiento en el arranque

Cada instancia ejecuta el pase aditivo de esquema durante el arranque (`REBASE_MIGRATE_ON_BOOT=ensure`). Las instancias con el mismo rol pueden ejecutarlo al mismo tiempo: está diseñado para tolerar que una instancia par cree la misma tabla un momento antes. En un despliegue dividido, exactamente un rol aprovisiona y todos los demás establecen `none`; consulte [Procesos divididos](/docs/deployment/split-processes/).
