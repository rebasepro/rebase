---
sourceHash: d2e9fbce6bf304f5
title: Ejecutar más de una instancia
sidebar_label: Más de una instancia
description: "Cada fragmento de estado que un proceso de Rebase mantiene para sí mismo y la configuración que lo comparte: qué configurar antes de que una segunda réplica, un despliegue progresivo o un despliegue dividido reciba tráfico."
---

## Descripción general

La mayor parte de un despliegue de Rebase ya reside en la base de datos: filas, usuarios y sesiones, claves de API, la cola de trabajos, los bloqueos de cron, claves de idempotencia, el historial de registros y los tokens del servidor OAuth de MCP. Un segundo proceso apuntando a la misma base de datos ve todo esto.

Algunas cosas no. Cada una es por proceso de forma predeterminada, porque un solo proceso es el despliegue predeterminado y compartir tiene un coste: una tabla, una escritura en un bucket, una conexión a la base de datos. Ejecutar dos procesos detrás de un balanceador de carga, escalar automáticamente más allá de uno, o un despliegue progresivo que ejecute brevemente la versión antigua y la nueva en paralelo te sitúan en esta página. También lo hace un [despliegue dividido](/docs/deployment/split-processes/), que por definición consta de varios procesos.

Revisa la lista a continuación antes de que el segundo reciba tráfico. Nada en ella falla de forma evidente: cada elemento se manifiesta como un límite aplicado tres veces más de lo debido, un evento que algunos clientes nunca ven o una página que muestra registros diferentes en cada actualización.

## Lista de verificación

| Qué | Por proceso de forma predeterminada | Qué lo comparte |
| --- | --- | --- |
| Secretos de firma | Generados por proceso en desarrollo | `JWT_SECRET` y `REBASE_SERVICE_KEY`, definidos explícitamente e **idénticos** en todas partes |
| Contadores de límite de tasa | En memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Dirección del cliente detrás de un proxy | `TRUSTED_PROXY_HOPS=0` | El número de proxies por delante, el mismo en todas partes |
| Suscripciones a tablas | Compartidas a través de la base de datos cuando CDC está activo | `REALTIME_CDC=auto` (el valor predeterminado) |
| Canales de difusión (broadcast) y presencia | En memoria | `REALTIME_CHANNEL_BUS=postgres` |
| Archivos subidos, `STORAGE_TYPE=local` | El propio disco de la instancia | S3 o GCS, o un volumen compartido en el directorio superior de `STORAGE_PATH` |
| Subidas reanudables (TUS) en progreso | El disco de la instancia, en `STORAGE_PATH/.tus-uploads` | Un volumen compartido en `STORAGE_PATH`, o sesiones persistentes (sticky sessions) |
| Transformaciones de imágenes | Una caché en el proceso | `STORAGE_RENDITION_CACHE=true` |
| Explorador de logs (Logs Explorer) | Un búfer circular con las últimas 10 000 líneas | Nada: envía stdout a un agregador de logs |
| Temporizadores de cron | Cada proceso que ejecuta el programador | Reclamado en la base de datos: una ejecución por intervalo. `REBASE_CRON_SCHEDULER` elige dónde residen los temporizadores |
| Auditoría programada de RLS | Cada proceso que la posee | `REBASE_RLS_AUDIT=false` en todos excepto en uno |
| El `index.html` de una aplicación estática | Leído una vez por proceso | Reiniciar cada instancia cuando cambie la compilación (build) |
| `/metrics` | Cada proceso cuenta lo suyo | Hacer scrape a cada instancia |

Las secciones a continuación explican qué hace cada elemento cuando se deja por proceso.

## Secretos de firma

`JWT_SECRET` firma cada sesión y `REBASE_SERVICE_KEY` autentica las llamadas entre servidores. En desarrollo, cada proceso genera el suyo si no están configurados, por lo que un token emitido por un proceso será rechazado por el siguiente. Producción ya se niega a iniciar sin `JWT_SECRET` (sin `REBASE_SERVICE_KEY` inicia sin ninguna clave de servicio); lo importante cuando hay varios procesos es que cada uno reciba los **mismos** valores: a partir de un único secreto, no uno por réplica.

## Límites de tasa y la dirección del cliente

Los limitadores de tasa —el presupuesto por emisor de solicitudes en las API de datos, almacenamiento y funciones, y los limitadores de autenticación en inicio de sesión, restablecimiento de contraseña, códigos de un solo uso e intentos de MFA— cuentan en memoria por defecto. Un proceso no puede ver cuántos pares (peers) tiene, por lo que tres réplicas con la configuración predeterminada aplicarán cada límite tres veces más de lo debido. Configura `REBASE_RATE_LIMIT_STORE=sql` y los contadores residirán en la base de datos en su lugar.

Detrás de un balanceador de carga, el limitador también necesita la dirección real del cliente, que llega en `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indica cuántos proxies omitir; con el valor predeterminado `0`, cada solicitud parece provenir del balanceador de carga y todos los clientes comparten un único bucket. Consulta [Configuración](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Las **suscripciones a tablas** funcionan entre instancias cuando la captura de cambios a nivel de base de datos (CDC) está activada, lo cual es así de forma predeterminada (`REALTIME_CDC=auto`): un trigger anuncia cada escritura confirmada (committed) y el listener de cada instancia vuelve a consultar los datos para sus propios suscriptores. Si CDC está desactivado o `auto` no pudo aprovisionarlo (el registro de arranque indica cuál de los dos casos es), una suscripción solo ve las escrituras realizadas a través de la instancia a la que está conectado su socket. Consulta [Realtime](/docs/backend/realtime-cdc/).

Los **canales de difusión (broadcast) y presencia** se procesan dentro de la instancia salvo que un bus los transporte: dos clientes en diferentes instancias en el mismo canal no se escucharán entre sí, y cada instancia responderá a "¿quién está aquí?" solo con su mitad correspondiente. Configura `REALTIME_CHANNEL_BUS=postgres`. El bus escucha en la base de datos, lo que requiere una conexión directa en lugar de un pooler de transacciones: configura `DATABASE_DIRECT_URL` cuando `DATABASE_URL` pase por pgBouncer. Consulta [Canales y presencia entre instancias](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Archivos

Con `STORAGE_TYPE=local`, las subidas son archivos en el disco de la instancia que las recibió, y otra instancia responderá con un error 404 para ellos. Usa S3 o GCS, o monta un volumen en cada instancia, en el directorio superior de `STORAGE_PATH`, para que también contenga el directorio `<STORAGE_PATH>__<key>` de cada bucket local con nombre. Consulta [Autohospedaje: almacenamiento de archivos](/docs/deployment/self-hosting/#file-storage).

Las **subidas reanudables** (el endpoint TUS) mantienen el archivo parcial de cada subida, y un registro de la subida junto a él, en el disco de la instancia que lo creó, bajo `STORAGE_PATH/.tus-uploads`, incluso cuando los archivos terminados van a S3 o GCS. Monta un volumen en `STORAGE_PATH` en cada instancia y cualquier instancia servirá cualquier subida; un reinicio o un despliegue progresivo reanudará la subida donde se quedó. Sin un volumen compartido, si un fragmento (chunk) llega a otra instancia, responderá con un 404: enruta las solicitudes de subida de un cliente a una sola instancia (sesiones persistentes o sticky sessions en el balanceador de carga). El SDK y el panel de administración, que usan este endpoint para archivos de más de 8 MiB, enviarán el archivo a través de `POST /upload` en su lugar, y continuarán haciéndolo durante el resto de la sesión. Las subidas ordinarias a través de `POST /upload` son de una sola solicitud y no se ven afectadas.

Las **transformaciones de imágenes** (`?width=400&format=webp`) se almacenan en la caché en memoria, por lo que cada instancia calcula cada variante una vez, y una nueva instancia comienza en frío. Configura `STORAGE_RENDITION_CACHE=true` para volver a escribir cada representación (rendition) en el bucket del que provino, donde cualquier instancia podrá encontrarla. Esto hace que un `GET` escriba en tu bucket, razón por la cual está desactivado a menos que se solicite expresamente. Consulta [Almacenamiento](/docs/backend/storage/).

## Explorador de logs

El explorador de logs de Studio lee un búfer circular de las últimas 10 000 líneas de registro mantenidas por el proceso que atiende la solicitud. Detrás de un balanceador de carga, cada actualización puede mostrar las líneas de una instancia diferente, y ninguna de ellas muestra el despliegue completo. El explorador indica el nombre de la instancia que está mostrando. No existe una configuración que comparta este búfer circular: el entorno de ejecución escribe una línea JSON por evento en stdout en producción, y eso es lo que se debe recopilar: el servicio de logs de tu plataforma, Loki o cualquier herramienta que lea la salida de contenedores.

## Cron y la cola de trabajos

Cada proceso que ejecuta el programador de cron activa sus propios temporizadores, y la ejecución se reclama primero en la base de datos, por lo que un intervalo se ejecuta **una sola vez** sin importar cuántos procesos se disparen para él. Pausar un trabajo, y el bloqueo temporal (lease) que evita que un desencadenante manual interfiera con una ejecución en progreso, se comparten de la misma manera. No hay nada que configurar, siempre que la base de datos sea Postgres. `REBASE_CRON_SCHEDULER` y `REBASE_JOB_WORKERS` deciden qué procesos ejecutan temporizadores y workers en absoluto; consulta [Procesos divididos](/docs/deployment/split-processes/).

La auditoría programada de RLS es la excepción: no se reclama, por lo que cada proceso que la posee realiza el análisis según su propio temporizador. Esto es redundante en lugar de inseguro; configura `REBASE_RLS_AUDIT=false` en todos los procesos excepto en uno.

## Aplicaciones estáticas

Un proceso que sirve el frontend o el CMS (`REBASE_SERVE_STATIC`, activado por defecto) lee el `index.html` de cada aplicación una vez y lo retiene en memoria. Reemplazar la compilación (build) en un volumen compartido no llega a un proceso en ejecución: este continúa sirviendo el documento anterior, el cual hace referencia a fragmentos (chunks) que podrían ya no existir. Despliega una nueva compilación reiniciando o actualizando progresivamente (rolling deploy) cada instancia, algo que una nueva imagen o paquete hace de todos modos. Con una CDN delante y `REBASE_SERVE_STATIC=false`, esto no aplica.

## Métricas

`/metrics` informa sobre el proceso que responde la solicitud. Realiza scraping a cada instancia —un trabajo de descubrimiento de servicios de Prometheus por pod, no un único destino detrás del balanceador de carga— y suma los resultados en la consulta.

## Aprovisionamiento en el arranque

Cada instancia ejecuta la pasada de esquema aditivo en el arranque (`REBASE_MIGRATE_ON_BOOT=ensure`). Las instancias con el mismo rol pueden ejecutarlo al mismo tiempo: está diseñado para tolerar que un par cree la misma tabla un momento antes. En un despliegue dividido, exactamente un rol realiza el aprovisionamiento y todos los demás se configuran en `none`; consulta [Procesos divididos](/docs/deployment/split-processes/).
