---
sourceHash: c783339baba900fc
title: Ejecutar más de una instancia
sidebar_label: Más de una instancia
description: Cada parte del estado que un proceso de Rebase guarda para sí mismo, y el ajuste que lo comparte — qué configurar antes de que una segunda réplica, un despliegue progresivo o un despliegue dividido reciban tráfico.
---

## Descripción general

La mayor parte de un despliegue de Rebase ya vive en la base de datos: filas,
usuarios y sesiones, claves de API, la cola de trabajos, las reclamaciones de
cron, las claves de idempotencia, el historial de registros, los tokens del
servidor OAuth de MCP. Un segundo proceso que apunte a la misma base de datos
ve todo esto.

Unas pocas cosas no. Cada una es por proceso de forma predeterminada, porque un
solo proceso es el despliegue por defecto y compartir cuesta algo — una tabla,
una escritura en un bucket, una conexión a la base de datos. Ejecutar dos
procesos detrás de un balanceador de carga, escalar automáticamente más allá de
uno, o un despliegue progresivo que ejecuta brevemente el antiguo y el nuevo en
paralelo te traen a esta página. También lo hace un
[despliegue dividido](/docs/deployment/split-processes/), que por definición
son varios procesos.

Revisa la lista siguiente antes de que el segundo reciba tráfico. Nada en ella
falla de forma ruidosa: cada elemento se manifiesta como un límite aplicado
tres veces, un evento que algunos clientes nunca ven, o un panel que muestra
registros distintos en cada actualización.

## La lista de comprobación

| Qué | Por proceso de forma predeterminada | Qué lo comparte |
| --- | --- | --- |
| Claves de firma | Generadas por proceso en desarrollo | `JWT_SECRET` y `REBASE_SERVICE_KEY`, definidas explícitamente e **idénticas** en todas partes |
| Contadores de límite de tasa | En memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Dirección del cliente detrás de un proxy | `TRUSTED_PROXY_HOPS=0` | El número de proxies por delante, el mismo en todas partes |
| Suscripciones a colecciones | Compartidas a través de la base de datos cuando el CDC está activo | `REALTIME_CDC=auto` (el valor por defecto) |
| Canales de difusión (broadcast) y presencia | En memoria | `REALTIME_CHANNEL_BUS=postgres` |
| Archivos subidos, `STORAGE_TYPE=local` | El disco propio de la instancia | S3 o GCS, o un volumen compartido en `STORAGE_PATH` |
| Subidas reanudables (TUS) en curso | La memoria y el disco de la instancia | Sesiones persistentes (sticky sessions); un reinicio las pierde igualmente |
| Transformaciones de imágenes | Una caché en proceso | `STORAGE_RENDITION_CACHE=true` |
| Explorador de logs | Un anillo con las últimas 10.000 líneas | Nada — envía la salida estándar (stdout) a un agregador de logs |
| Temporizadores de cron | Cada proceso que ejecuta el programador | Reclamados en la base de datos: una ejecución por franja. `REBASE_CRON_SCHEDULER` decide dónde viven los temporizadores |
| Auditoría de RLS programada | Cada proceso que la posee | `REBASE_RLS_AUDIT=false` en todos menos uno |
| El `index.html` de una app estática | Leído una vez por proceso | Reinicia cada instancia cuando cambie la compilación |
| `/metrics` | Cada proceso cuenta lo suyo | Recopila métricas de cada instancia |

Las secciones siguientes explican qué hace cada uno cuando se deja por proceso.

## Claves de firma

`JWT_SECRET` firma cada sesión y `REBASE_SERVICE_KEY` autentica las llamadas
entre servidores. En desarrollo, cada proceso genera la suya cuando no están
definidas, de modo que un token emitido por un proceso es rechazado por el
siguiente. Producción ya se niega a arrancar sin ellas; lo que importa con
varios procesos es que todos obtengan los **mismos** valores — a partir de un
solo secreto, no uno por réplica.

## Límites de tasa y la dirección del cliente

Los limitadores de tasa — el presupuesto por emisor en las API de datos,
almacenamiento y funciones, y los limitadores de autenticación en el inicio de
sesión, el restablecimiento de contraseña, los códigos de un solo uso y los
intentos de MFA — cuentan en memoria de forma predeterminada. Un proceso no
puede saber cuántos pares tiene, así que tres réplicas con el valor por
defecto aplican tres veces cada límite. Define `REBASE_RATE_LIMIT_STORE=sql` y
los contadores viven en la base de datos en su lugar.

Detrás de un balanceador de carga, el limitador también necesita la dirección
real del cliente, que llega en `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indica
cuántos proxies hay que ignorar; con el valor por defecto `0`, toda petición
parece provenir del balanceador de carga y todos los clientes comparten un
mismo cubo. Consulta
[Configuración](/docs/getting-started/configuration/#runtime-behaviour).

## Tiempo real

Las **suscripciones a colecciones** funcionan entre instancias cuando la
captura de cambios a nivel de base de datos está activa, lo cual ocurre de
forma predeterminada (`REALTIME_CDC=auto`): un trigger anuncia cada escritura
confirmada, y el listener de cada instancia vuelve a consultar para sus
propios suscriptores. Si el CDC está desactivado, o si `auto` no pudo
aprovisionarlo (el log de arranque indica por qué), una suscripción solo ve las
escrituras hechas a través de la instancia a la que está conectado su socket.
Consulta
[Tiempo real](/docs/backend/realtime/#database-level-change-capture-cdc).

Los **canales de difusión (broadcast) y la presencia** son en proceso a menos
que un bus los transporte: dos clientes en instancias distintas dentro del
mismo canal no se oyen entre sí, y cada instancia responde «¿quién está aquí?»
solo con su propia mitad. Define `REALTIME_CHANNEL_BUS=postgres`. El bus
escucha en la base de datos, lo cual necesita una conexión directa en lugar de
un pooler de transacciones — define `DATABASE_DIRECT_URL` cuando
`DATABASE_URL` pasa por pgBouncer. Consulta
[Canales y presencia entre instancias](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Archivos

Con `STORAGE_TYPE=local`, las subidas son archivos en el disco de la instancia
que las recibió, y otra instancia responde 404 para ellas. Usa S3 o GCS, o
monta un volumen compartido en `STORAGE_PATH` en todas las instancias.
Consulta
[Autoalojamiento: almacenamiento de archivos](/docs/deployment/self-hosting/#file-storage).

Las **subidas reanudables** (el endpoint TUS) mantienen el archivo parcial de
cada subida y su estado en el disco local de la instancia que la creó, bajo
`STORAGE_PATH/.tus-uploads` — incluso cuando los archivos terminados van a S3 o
GCS. Un fragmento (chunk) que llega a otra instancia se responde con 404 y el
cliente empieza de nuevo. Enruta las peticiones de subida de un cliente a una
sola instancia (sesiones persistentes en el balanceador de carga). Un volumen
compartido en `STORAGE_PATH` comparte los archivos parciales pero todavía no
el estado de la subida, que se guarda en la memoria del proceso — así que un
reinicio o un despliegue progresivo también devuelve al byte 0 una subida en
curso. Las subidas ordinarias a través de `POST /upload` son una sola petición
y no se ven afectadas.

Las **transformaciones de imágenes** (`?width=400&format=webp`) se guardan en
caché en memoria, así que cada instancia calcula cada variante una vez, y una
instancia nueva arranca en frío. Define `STORAGE_RENDITION_CACHE=true` para
escribir cada rendición de vuelta al bucket de origen, donde cualquier
instancia la encuentra. Eso hace que un `GET` escriba en tu bucket, por lo que
está desactivado salvo que se solicite. Consulta
[Storage](/docs/backend/storage/).

## Explorador de logs

El Explorador de logs de Studio lee un anillo con las últimas 10.000 líneas
que mantiene el proceso que atiende la petición. Detrás de un balanceador de
carga, cada actualización puede mostrar las líneas de una instancia distinta,
y ninguna de ellas muestra el despliegue completo.
<span class="since-badge" data-since="0.24">Desde 0.24</span> El explorador nombra la instancia que está mostrando.
No hay ningún ajuste que comparta el anillo: el runtime escribe una línea JSON por evento en la salida estándar
en producción, y eso es lo que hay que recopilar — el servicio de logs de tu
plataforma, Loki, o cualquier cosa que lea la salida del contenedor.

## Cron y la cola de trabajos

Cada proceso que ejecuta el programador de cron arma sus propios
temporizadores, y la ejecución se reclama primero en la base de datos, así que
una franja se ejecuta **una sola vez** sin importar cuántos procesos la
disparen. Pausar un trabajo, y la reserva que mantiene una activación manual
fuera de una ejecución en curso, se comparten de la misma manera. No hay nada
que configurar, siempre que la base de datos sea Postgres. `REBASE_CRON_SCHEDULER`
y `REBASE_JOB_WORKERS` deciden qué procesos ejecutan temporizadores y workers
en absoluto — consulta [Procesos divididos](/docs/deployment/split-processes/).

La auditoría de RLS programada es la excepción: no se reclama, así que cada
proceso que la posee escanea con su propio temporizador. Eso es redundante
pero no inseguro; define `REBASE_RLS_AUDIT=false` en todos menos uno.

## Apps estáticas

Un proceso que sirve el frontend o el CMS (`REBASE_SERVE_STATIC`, activo de
forma predeterminada) lee una vez el `index.html` de cada app y lo conserva.
Sustituir la compilación en un volumen compartido no llega a un proceso en
ejecución: sigue sirviendo el documento antiguo, que nombra fragmentos (chunks)
que ya pueden no existir. Despliega una compilación nueva reiniciando o
renovando cada instancia — algo que una imagen o un bundle nuevos hacen de
todos modos. Con una CDN por delante y `REBASE_SERVE_STATIC=false`, esto no
aplica.

## Métricas

`/metrics` reporta el proceso que responde. Recopila métricas de cada
instancia por separado — un trabajo de descubrimiento de servicio de
Prometheus por pod, no un único destino detrás del balanceador de carga — y
suma en la consulta.

## Aprovisionamiento al arrancar

Cada instancia ejecuta el paso de esquema aditivo al arrancar
(`REBASE_MIGRATE_ON_BOOT=ensure`). Varias instancias del mismo rol pueden
ejecutarlo a la vez: está escrito para tolerar que un par cree la misma tabla
un instante antes. En un despliegue dividido, exactamente un rol aprovisiona y
todos los demás definen `none` — consulta
[Procesos divididos](/docs/deployment/split-processes/).
