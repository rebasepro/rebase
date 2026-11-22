---
sourceHash: 079933126e9be226
title: Ejecutar más de una instancia
sidebar_label: Más de una instancia
description: "Cada parte del estado que un proceso de Rebase mantiene para sí mismo y la configuración que lo comparte: qué configurar antes de que una segunda réplica, un despliegue progresivo (rolling deploy) o un despliegue dividido comience a recibir tráfico."
---

## Información general

La mayor parte de un despliegue de Rebase ya reside en la base de datos: filas, usuarios y sesiones, claves de API, la cola de trabajos, los bloqueos de cron (cron claims), claves de idempotencia, el historial de registros y los tokens del servidor OAuth de MCP. Un segundo proceso que apunte a la misma base de datos puede ver todo esto.

Algunas cosas no lo hacen. Cada una es por proceso de forma predeterminada, ya que un solo proceso es el despliegue predeterminado y compartir tiene un coste: una tabla, una escritura en un bucket, una conexión a la base de datos. Ejecutar dos procesos detrás de un balanceador de carga, el autoescalado más allá de uno, o un despliegue progresivo (rolling deploy) que ejecute brevemente la versión antigua y la nueva en paralelo, te traen a esta página. Lo mismo ocurre con un [split deployment](/docs/deployment/split-processes/), que por definición consta de varios procesos.

Revisa la lista a continuación antes de que el segundo comience a recibir tráfico. Nada en ella falla de forma evidente: cada elemento se manifiesta como un límite aplicado tres veces más de lo debido, un evento que algunos clientes nunca ven, o una página que muestra registros (logs) diferentes en cada actualización.

## Lista de verificación

| Qué | Por proceso de forma predeterminada | Qué lo comparte |
| --- | --- | --- |
| Secretos de firma | Generados por proceso en desarrollo | `JWT_SECRET` y `REBASE_SERVICE_KEY`, configurados explícitamente e **idénticos** en todas partes |
| Contadores de límite de tasa (rate-limit) | En memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Dirección del cliente detrás de un proxy | `TRUSTED_PROXY_HOPS=0` | El número de proxies intermedios, igual en todas partes |
| Suscripciones a tablas | Compartidas a través de la base de datos cuando CDC está activo | `REALTIME_CDC=auto` (por defecto) |
| Canales de difusión (broadcast) y presencia | En memoria | `REALTIME_CHANNEL_BUS=postgres` |
| Archivos subidos, `STORAGE_TYPE=local` | El propio disco de la instancia | S3 o GCS, o un volumen compartido en el directorio superior de `STORAGE_PATH` |
| Subidas reanudables (TUS) en progreso | El disco de la instancia, en `STORAGE_PATH/.tus-uploads` | Un volumen compartido en `STORAGE_PATH`, o sesiones persistentes (sticky sessions) |
| Transformaciones de imágenes | Una caché en el proceso | `STORAGE_RENDITION_CACHE=true` |
| Vista de logs de Studio | Un buffer circular de las últimas 10 000 líneas | Nada: envía stdout a un agregador de logs |
| Temporizadores de cron | Cada proceso que ejecuta el programador | Reclamados en la base de datos: una ejecución por intervalo. `REBASE_CRON_SCHEDULER` elige dónde residen los temporizadores |
| Auditoría programada de RLS | Cada proceso que la posee | `REBASE_RLS_AUDIT=false` en todos excepto uno |
| `index.html` de una aplicación estática | Se lee una vez por proceso | Reiniciar cada instancia cuando cambie la compilación (build) |
| `/metrics` | Cada proceso cuenta el suyo propio | Extraer métricas (scrape) de cada instancia |

Las secciones a continuación explican qué hace cada elemento cuando se deja por proceso.

## Secretos de firma

`JWT_SECRET` firma cada sesión y `REBASE_SERVICE_KEY` autentica las llamadas entre servidores. En desarrollo, cada proceso genera los suyos propios cuando no están configurados, por lo que un token emitido por un proceso es rechazado por el siguiente. En producción ya se rechaza el inicio sin `JWT_SECRET` (sin `REBASE_SERVICE_KEY` se inicia sin ninguna clave de servicio); lo importante con varios procesos es que cada uno obtenga los **mismos** valores: a partir de un único secreto, no uno por réplica.

## Límites de tasa y la dirección del cliente

Los limitadores de tasa (rate limiters) —el presupuesto por emisor en las API de datos, almacenamiento y funciones, y los limitadores de autenticación en el inicio de sesión, restablecimiento de contraseña, códigos de un solo uso e intentos de MFA— cuentan en memoria por defecto. Un proceso no puede ver cuántos pares tiene, por lo que tres réplicas con la configuración predeterminada aplican tres veces cada límite. Configura `REBASE_RATE_LIMIT_STORE=sql` y los contadores residirán en la base de datos.

Detrás de un balanceador de carga, el limitador también necesita la dirección real del cliente, que llega en `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indica cuántos proxies intermedios omitir; con el valor predeterminado `0`, cada petición parece provenir del balanceador de carga y todos los clientes comparten un único bucket. Consulta [Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Las **suscripciones a tablas** funcionan entre instancias cuando la captura de cambios a nivel de base de datos (CDC) está activada, lo cual ocurre de forma predeterminada (`REALTIME_CDC=auto`): el registro de escritura anticipada o WAL (donde la base de datos permite la decodificación lógica) o un disparador (trigger) anuncia cada escritura confirmada, y el listener de cada instancia vuelve a consultar los datos para sus propios suscriptores. Las instancias con captura por WAL mantienen los triggers mientras alguna instancia todavía los escuche, de modo que una réplica que recurrió a triggers nunca se quede sin recibir eventos. Si CDC está desactivado o si `auto` no pudo aprovisionarlo (el log de inicio indicará cuál fue el caso), una suscripción solo ve las escrituras realizadas a través de la instancia a la que está conectado su socket. Consulta [Realtime](/docs/backend/realtime-cdc/).

Los **canales de difusión (broadcast) y la presencia** se ejecutan en el propio proceso a menos que un bus los transporte: dos clientes en diferentes instancias en el mismo canal no se escucharán entre sí, y cada instancia responderá a "¿quién está aquí?" solo con su propia mitad. Configura `REALTIME_CHANNEL_BUS=postgres`. El bus escucha en la base de datos, lo cual requiere una conexión directa en lugar de un pooler de transacciones; configura `DATABASE_DIRECT_URL` cuando `DATABASE_URL` pase por pgBouncer. Consulta [Channels and presence across instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Archivos

Con `STORAGE_TYPE=local`, las subidas son archivos en el disco de la instancia que los recibió, y otra instancia responderá con un error 404 ante ellos. Usa S3 o GCS, o monta un volumen en cada instancia, en el directorio superior de `STORAGE_PATH`, para que también contenga el directorio `<STORAGE_PATH>__<key>` de cada bucket local con nombre. Consulta [Self-hosting: file storage](/docs/deployment/self-hosting/#file-storage).

Las **subidas reanudables** (el endpoint TUS) mantienen el archivo parcial de cada subida, y un registro de la subida junto a él, en el disco de la instancia que lo creó, bajo `STORAGE_PATH/.tus-uploads`, incluso cuando los archivos terminados van a S3 o GCS. Monta un volumen en `STORAGE_PATH` en cada instancia y cualquier instancia podrá servir cualquier subida; un reinicio o un despliegue progresivo (rolling deploy) reanudará la subida donde se quedó. Sin un volumen compartido, un fragmento (chunk) que llegue a otra instancia recibirá una respuesta 404: enruta las peticiones de subida de un cliente a una sola instancia (sesiones persistentes o sticky sessions en el balanceador de carga). El SDK y el panel de administración, que usan este endpoint para archivos de más de 8 MiB, enviarán entonces el archivo a través de `POST /upload` en su lugar, y continuarán haciéndolo durante el resto de la sesión. Las subidas ordinarias a través de `POST /upload` consisten en una sola petición y no se ven afectadas.

Las **transformaciones de imágenes** (`?width=400&format=webp`) se almacenan en caché en memoria, por lo que cada instancia calcula cada variante una vez y una nueva instancia comienza en frío. Configura `STORAGE_RENDITION_CACHE=true` para reescribir cada versión generada (rendition) de vuelta al bucket del que proviene, donde cualquier instancia podrá encontrarla. Esto hace que una petición `GET` escriba en tu bucket, razón por la cual está desactivado a menos que se solicite explícitamente. Consulta [Storage](/docs/backend/storage/).

## Vista de logs de Studio

La vista de registros (Logs) de Studio lee un buffer circular de las últimas 10 000 líneas de log mantenidas por el proceso que atiende la solicitud. Detrás de un balanceador de carga, cada actualización puede mostrar las líneas de una instancia diferente, y ninguna de ellas muestra todo el despliegue. El explorador indica el nombre de la instancia que está mostrando. No hay ninguna configuración para compartir este buffer circular: el entorno de ejecución escribe una línea JSON por evento en stdout en producción, y eso es lo que se debe recopilar: el servicio de logs de tu plataforma, Loki o cualquier herramienta que lea la salida del contenedor.

## Cron y la cola de trabajos

Cada proceso que ejecuta el programador de cron activa sus propios temporizadores, y la ejecución se reclama primero en la base de datos, por lo que un intervalo se ejecuta **una sola vez**, sin importar cuántos procesos se disparen para él. Pausar un trabajo y el bloqueo (lease) que evita que un desencadenador manual interfiera con una ejecución en curso se comparten de la misma manera. No hay nada que configurar, siempre que la base de datos sea Postgres. `REBASE_CRON_SCHEDULER` y `REBASE_JOB_WORKERS` deciden qué procesos ejecutan temporizadores y workers en absoluto; consulta [Split processes](/docs/deployment/split-processes/).

La auditoría programada de RLS es la excepción: no se reclama, por lo que cada proceso que la posee realiza el análisis según su propio temporizador. Esto es redundante en lugar de inseguro; configura `REBASE_RLS_AUDIT=false` en todos los procesos excepto en uno.

## Aplicaciones estáticas

Un proceso que sirve el frontend o el CMS (`REBASE_SERVE_STATIC`, activado por defecto) lee el archivo `index.html` de cada aplicación una vez y lo mantiene. Reemplazar la compilación en un volumen compartido no llega a un proceso en ejecución: este continúa sirviendo el documento antiguo, el cual hace referencia a chunks que podrían haber dejado de existir. Despliega una nueva compilación reiniciando o actualizando progresivamente (rolling deploy) cada instancia, algo que una nueva imagen o paquete hace de todos modos. Con un CDN delante y `REBASE_SERVE_STATIC=false`, esto no aplica.

## Métricas

`/metrics` informa sobre el proceso que responde a la solicitud. Extrae las métricas (scrape) de cada instancia —un trabajo de descubrimiento de servicios de Prometheus por pod, no un único destino detrás del balanceador de carga— y suma en la consulta.

## Aprovisionamiento en el arranque

Cada instancia ejecuta el pase de esquema aditivo en el arranque (`REBASE_MIGRATE_ON_BOOT=ensure`). Las instancias del mismo rol pueden ejecutarlo al mismo tiempo: está diseñado para tolerar que un par cree la misma tabla un instante antes. En un split deployment, exactamente un rol aprovisiona y todos los demás configuran `none`; consulta [Split processes](/docs/deployment/split-processes/).
