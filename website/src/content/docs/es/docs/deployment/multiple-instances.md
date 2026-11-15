---
sourceHash: d156ac95aebe2dab
title: Ejecutar más de una instancia
sidebar_label: Más de una instancia
description: "Cada elemento de estado que un proceso de Rebase mantiene para sí mismo y la configuración que lo comparte: qué configurar antes de que una segunda réplica, un despliegue progresivo o un despliegue dividido reciba tráfico."
---

## Visión general

La mayor parte de un despliegue de Rebase ya reside en la base de datos: filas, usuarios y
sesiones, claves de API, la cola de trabajos, reservas de cron, claves de idempotencia,
historial de registros y los tokens del servidor MCP OAuth. Un segundo proceso apuntando a la
misma base de datos puede ver todo esto.

Algunas cosas no lo hacen. Cada una es por proceso de forma predeterminada, porque un solo proceso
es el despliegue predeterminado y compartir tiene un coste: una tabla, una escritura en un bucket, una
conexión a la base de datos. Ejecutar dos procesos detrás de un balanceador de carga, escalar automáticamente
más allá de uno, o un despliegue progresivo (rolling deploy) que ejecute brevemente la versión antigua y la nueva
en paralelo te sitúan en esta página. Lo mismo ocurre con un [despliegue dividido](/docs/deployment/split-processes/),
que por definición implica varios procesos.

Revisa la lista a continuación antes de que el segundo reciba tráfico. Ningún elemento
falla de forma evidente: cada uno se manifiesta como un límite aplicado tres veces más de lo debido,
un evento que algunos clientes nunca ven, o una página que muestra registros diferentes en cada actualización.

## Lista de verificación

| Qué | Por proceso de forma predeterminada | Qué lo comparte |
| --- | --- | --- |
| Secretos de firma | Generados por proceso en desarrollo | `JWT_SECRET` y `REBASE_SERVICE_KEY`, definidos explícitamente e **idénticos** en todas partes |
| Contadores de límite de tasa | En memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Dirección del cliente detrás de un proxy | `TRUSTED_PROXY_HOPS=0` | El número de proxies intermedios, igual en todas partes |
| Suscripciones a tablas | Compartidas a través de la base de datos cuando CDC está activo | `REALTIME_CDC=auto` (el valor predeterminado) |
| Canales de broadcast y presencia | En memoria | `REALTIME_CHANNEL_BUS=postgres` |
| Archivos subidos, `STORAGE_TYPE=local` | El disco propio de la instancia | S3 o GCS, o un volumen compartido en el directorio padre de `STORAGE_PATH` |
| Subidas reanudables (TUS) en curso | El disco de la instancia, en `STORAGE_PATH/.tus-uploads` | Un volumen compartido en `STORAGE_PATH`, o sesiones persistentes (sticky sessions) |
| Transformaciones de imágenes | Una caché en el proceso | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Un búfer circular con las últimas 10.000 líneas | Nada: envía stdout a un agregador de logs |
| Temporizadores de cron | Cada proceso que ejecuta el programador | Reservados en la base de datos: una ejecución por intervalo. `REBASE_CRON_SCHEDULER` define dónde residen los temporizadores |
| Auditoría programada de RLS | Cada proceso que la posee | `REBASE_RLS_AUDIT=false` en todos excepto uno |
| El `index.html` de una app estática | Leído una vez por proceso | Reiniciar cada instancia cuando la compilación cambie |
| `/metrics` | Cada proceso cuenta lo suyo | Hacer scrape de cada instancia |

Las secciones siguientes explican qué hace cada elemento cuando se mantiene por proceso.

## Secretos de firma

`JWT_SECRET` firma cada sesión y `REBASE_SERVICE_KEY` autentica las
llamadas entre servidores. En desarrollo, cada proceso genera el suyo propio cuando no
están definidos, por lo que un token emitido por un proceso es rechazado por el siguiente.
Producción ya se niega a iniciar sin `JWT_SECRET` (sin `REBASE_SERVICE_KEY` se inicia
sin ninguna clave de servicio); lo que importa cuando hay varios procesos es
que cada uno reciba los **mismos** valores, provenientes de un único secreto y no de uno por réplica.

## Límites de tasa y la dirección del cliente

Los limitadores de tasa —el presupuesto por solicitante en las API de datos, almacenamiento y funciones,
y los limitadores de autenticación en inicio de sesión, restablecimiento de contraseña, códigos de un solo uso
e intentos de MFA— cuentan en memoria de forma predeterminada. Un proceso no puede ver cuántos pares tiene,
por lo que tres réplicas con la configuración predeterminada aplican tres veces cada límite. Configura
`REBASE_RATE_LIMIT_STORE=sql` y los contadores residirán en la base de datos.

Detrás de un balanceador de carga, el limitador también necesita la dirección real del cliente, que
llega en `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indica cuántos proxies omitir;
con el valor predeterminado `0`, cada solicitud parece provenir del balanceador de carga
y todos los clientes comparten un único bucket. Consulta
[Configuración](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Las suscripciones a tablas** funcionan entre instancias cuando la captura de cambios a nivel de
base de datos está activada, lo cual ocurre de forma predeterminada (`REALTIME_CDC=auto`): el registro
de escritura previa (donde la base de datos permite la decodificación lógica) o un trigger anuncia cada
escritura confirmada, y el listener de cada instancia vuelve a consultar los datos para sus propios
suscriptores. Las instancias con captura por WAL mantienen los triggers activos mientras alguna
instancia aún los esté escuchando, por lo que una réplica que recurrió a triggers nunca se queda sin recibir eventos.
Si CDC está desactivado, o si `auto` no pudo aprovisionarlo (el registro de inicio indica
cuál fue el caso), una suscripción solo ve las escrituras realizadas a través de la instancia a la que
está conectado su socket. Consulta
[Realtime](/docs/backend/realtime-cdc/).

**Los canales de broadcast y presencia** operan dentro del proceso a menos que un bus los transporte:
dos clientes en diferentes instancias en el mismo canal no se escuchan entre sí,
y cada instancia responde "¿quién está aquí?" con su propia mitad. Configura
`REALTIME_CHANNEL_BUS=postgres`. El bus escucha en la base de datos, lo que requiere una
conexión directa en lugar de un pooler de transacciones; define `DATABASE_DIRECT_URL`
cuando `DATABASE_URL` pase por pgBouncer. Consulta
[Canales y presencia entre instancias](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Archivos

Con `STORAGE_TYPE=local`, las subidas son archivos en el disco de la instancia que
los recibió, y otra instancia responderá con un 404 ante ellos. Utiliza S3 o GCS, o
monta un volumen en cada instancia, en el directorio padre de `STORAGE_PATH` para que también
contenga el directorio `<STORAGE_PATH>__<key>` de cada bucket local con nombre. Consulta
[Autohospedaje: almacenamiento de archivos](/docs/deployment/self-hosting/#file-storage).

**Las subidas reanudables** (el endpoint de TUS) mantienen el archivo parcial de cada subida, y
un registro de la misma junto a él, en el disco de la instancia que
lo creó, bajo `STORAGE_PATH/.tus-uploads`, incluso cuando los archivos completados van a
S3 o GCS. Monta un volumen en `STORAGE_PATH` en cada instancia y cualquier instancia
servirá cualquier subida; un reinicio o un despliegue progresivo reanudará una subida en el punto
en que se detuvo. Sin un volumen compartido, a un fragmento que llega a otra instancia se le
responde con 404: enruta las solicitudes de subida de un cliente a una única instancia (sesiones persistentes
en el balanceador de carga). El SDK y el panel de administración, que usan este endpoint para
archivos de más de 8 MiB, enviarán entonces el archivo a través de `POST /upload`, y seguirán
haciéndolo durante el resto de la sesión. Las subidas ordinarias a través de `POST /upload` son una sola solicitud
y no se ven afectadas.

**Las transformaciones de imágenes** (`?width=400&format=webp`) se guardan en la caché en memoria, por lo que cada
instancia calcula cada variante una vez, y una nueva instancia comienza en frío. Configura
`STORAGE_RENDITION_CACHE=true` para volver a escribir cada representación en el bucket del
que provino, donde cada instancia puede encontrarla. Eso hace que una petición `GET` escriba en tu
bucket, razón por la cual está desactivado a menos que se configure explícitamente. Consulta
[Almacenamiento](/docs/backend/storage/).

## Logs Explorer

El Logs Explorer de Studio lee un búfer circular de las últimas 10.000 líneas de registro mantenidas por el
proceso que atiende la solicitud. Detrás de un balanceador de carga, cada actualización puede mostrar las líneas
de una instancia diferente, y ninguna de ellas muestra el despliegue completo.
El explorador muestra el nombre de la instancia que está visualizando.
No existe ninguna configuración para compartir este búfer circular: el entorno de ejecución escribe una línea JSON por evento en
stdout en producción, y eso es lo que se debe recopilar: el servicio de logs de tu
plataforma, Loki o cualquier herramienta que lea la salida de contenedores.

## Cron y la cola de trabajos

Cada proceso que ejecuta el programador de cron activa sus propios temporizadores, y la ejecución se
reserva primero en la base de datos, de modo que un intervalo se ejecuta **una sola vez** sin importar cuántos procesos
se disparen para él. Pausar un trabajo y el bloqueo temporal que impide que un disparador manual interfiera con una ejecución
en curso se comparten de la misma manera. No hay nada que configurar, siempre que la base de datos
sea Postgres. `REBASE_CRON_SCHEDULER` y `REBASE_JOB_WORKERS` deciden qué
procesos ejecutan temporizadores y workers; consulta
[Procesos divididos](/docs/deployment/split-processes/).

La auditoría programada de RLS es la excepción: no se reserva, por lo que cada proceso
que la tiene a cargo realiza el escaneo en su propio temporizador. Esto es redundante en lugar de inseguro; define
`REBASE_RLS_AUDIT=false` en todas las instancias excepto en una.

## Aplicaciones estáticas

Un proceso que sirve el frontend o el CMS (`REBASE_SERVE_STATIC`, activado de forma
predeterminada) lee el `index.html` de cada aplicación una vez y lo mantiene. Reemplazar la compilación
en un volumen compartido no afecta a un proceso en ejecución: continúa sirviendo el documento
antiguo, que hace referencia a fragmentos que quizás ya no existan. Despliega una nueva compilación
reiniciando o actualizando progresivamente cada instancia, algo que una nueva imagen o bundle hace de todos modos.
Con una CDN delante y `REBASE_SERVE_STATIC=false`, esto no aplica.

## Métricas

`/metrics` reporta los datos del proceso que responde. Haz scraping de cada instancia —un
trabajo de descubrimiento de servicios de Prometheus por pod, no un único destino detrás del balanceador de
carga— y suma los resultados en la consulta.

## Aprovisionamiento en el arranque

Cada instancia ejecuta la fase aditiva del esquema durante el arranque
(`REBASE_MIGRATE_ON_BOOT=ensure`). Las instancias con el mismo rol pueden ejecutarlo al
mismo tiempo: está diseñado para tolerar que otra instancia par cree la misma tabla un momento
antes. En un despliegue dividido, exactamente un rol realiza el aprovisionamiento y todos los demás se configuran en
`none`; consulta [Procesos divididos](/docs/deployment/split-processes/).
