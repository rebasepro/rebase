---
sourceHash: a04d0760ffb715cb
title: Captura de cambios en la base de datos
sidebar_label: Captura de cambios en la base de datos
description: "Eventos en tiempo real para cada escritura confirmada, sin importar cómo se haya realizado: los triggers de captura, la configuración REALTIME_CDC y lo que necesitan."
---

**Change Data Capture está activado por defecto.** Rebase captura los cambios en la base de datos y emite eventos en tiempo real para **cada escritura confirmada, independientemente de cómo se haya realizado**: REST, SDK, Studio, `psql`, un cron job en otro servicio, Drizzle/SQL directo o el **editor SQL** de Studio. Este es el mismo modelo que Supabase Realtime siguiendo el write-ahead log.

No se requiere configuración. En una conexión de base de datos que lo soporte, CDC se aprovisiona automáticamente al inicio; en una que no lo soporte (por ejemplo, un rol restringido que no puede crear triggers), Rebase utiliza silenciosamente tiempo real a nivel de aplicación en su lugar: nada que activar, nada que se rompa.

## Configuración

CDC se controla mediante la variable de entorno `REALTIME_CDC`:

| Valor | Comportamiento |
| --- | --- |
| `auto` *(por defecto)* | Lee los cambios del WAL cuando la base de datos lo permite; de lo contrario, usa los triggers de captura; de lo contrario, recurre al tiempo real a nivel de aplicación. Cada alternativa (fallback) es una línea de log informativa, no una advertencia. Configuración cero. Consulta [Captura desde el WAL](#captura-desde-el-wal). |
| `trigger` | Fuerza la captura basada en triggers. Funciona en cualquier PostgreSQL, incluidas instancias administradas sin replicación lógica. Advierte (en lugar de recurrir silenciosamente a una alternativa) si no se puede aprovisionar. |
| `wal` | Lee los cambios del write-ahead log a través de replicación lógica en lugar de triggers, por lo que una escritura no ejecuta ningún trigger ni envía ningún `NOTIFY`. Requiere `wal_level=logical` y un rol con permisos de replicación; recurre a `trigger`, con una advertencia, cuando falta alguno de ellos. Consulta [Captura desde el WAL](#captura-desde-el-wal). |
| `off` | Solo tiempo real a nivel de aplicación. Usa esto para evitar la sobrecarga del trigger por escritura en cargas de trabajo con muchas escrituras. Un arranque con `off` que sea propietario del esquema también **elimina** los triggers y funciones de captura que un arranque anterior instaló, y registra cuántos eliminó; desactiva esta variable y el siguiente arranque los instalará de nuevo. |

La misma configuración es la opción `realtime.cdc` del adaptador de Postgres, para un servidor que lo configura en el código. `REALTIME_CDC`, cuando está definida, tiene prioridad.

Al arrancar verás una línea de log indicando el modo activo, por ejemplo:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la conexión no puede soportarlo, `auto` registra una línea informativa en su lugar y continúa con tiempo real a nivel de aplicación:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Cómo funciona

1. **Aprovisionamiento automático** — Al inicio (contexto de servidor/propietario), Rebase instala triggers idempotentes `AFTER INSERT/UPDATE/DELETE/TRUNCATE` en cada tabla gestionada. Se disparan una vez por sentencia y emiten notificaciones de cambio en el canal `rebase_cdc` que identifican las filas modificadas por su clave (la clave primaria, más las dos columnas de id para una tabla de unión many-to-many) y no incluyen **ninguna otra columna**. Una sentencia que modificó muchas filas las identifica en lotes de alrededor de mil claves, por lo que un `UPDATE` de 1 millón de filas envía aproximadamente 1.000 notificaciones en lugar de un millón; una sentencia que modificó una fila envía una notificación, y una que no modificó ninguna no envía nada. Un `TRUNCATE` se anuncia como un cambio en cada fila de la tabla. Una tabla particionada mantiene un trigger por fila, porque PostgreSQL copia un trigger de fila en cada partición y una escritura realizada directamente en una partición aún se detecta. PostgreSQL no impone privilegios sobre `LISTEN`, por lo que cualquier rol que pueda conectarse a la base de datos puede leer este canal; se entera de qué claves cambiaron, pero nunca de qué contienen. Una clave demasiado grande para el límite de 8&nbsp;KB de `NOTIFY` de PostgreSQL se envía sin clave (un cambio en toda la tabla, lo que hace que cada suscripción a listas y a filas individuales vuelva a consultarla), por lo que CDC nunca puede abortar la escritura que originó el trigger. Las funciones se reemplazan en cada arranque que realiza el aprovisionamiento, por lo que una base de datos instrumentada por una versión anterior —cuyo trigger enviaba filas completas— se actualiza en el siguiente arranque; un arranque con `REALTIME_CDC=off` las elimina en su lugar.

   **Actualización.** Una base de datos instrumentada por una versión anterior al procesamiento por lotes tiene un trigger por fila; el primer arranque de una versión más reciente lo reemplaza por los triggers por sentencia. Durante las 24 horas posteriores, los nuevos triggers siguen enviando una notificación por fila, como lo hacían los antiguos, para que las instancias de la versión anterior que aún se ejecutan durante un despliegue progresivo (o tras un rollback) reciban cada fila. Pasada esa ventana, se agrupan por lotes. Cada versión que admite lotes lee ambos formatos.
2. **Captura** — Un cliente `LISTEN` dedicado y sin pool por instancia consume `rebase_cdc`, mapea la tabla modificada a la tabla a la que sirve y envía el cambio a la misma canalización de `RealtimeService` utilizada por las mutaciones de la API. Al igual que el listener entre instancias, prefiere `DATABASE_DIRECT_URL` y se reconecta automáticamente.
3. **Entrega segura con RLS** — La fila sin procesar del flujo de cambios **nunca** se reenvía a los suscriptores. El cambio se marca como invalidado y cada suscripción vuelve a leer la fila bajo su **propio** contexto de autenticación. Por lo tanto, el filtrado se realiza por suscriptor, nunca por emisor: un cliente solo recibe las filas que sus políticas de RLS permiten.
4. **Entre instancias** — Dado que cada instancia observa cada commit a través del flujo de cambios, CDC también *es* el canal entre instancias; la difusión heredada por mutación `rebase_entity_changes` no se utiliza mientras CDC está activo.
5. **Deduplicación** — Una mutación realizada a través de la API de Rebase programa una nueva consulta para los suscriptores locales en el instante en que se confirma y también se replica a través del flujo de cambios. La instancia de origen suprime un eco que llega dentro de la ventana de debounce de refetch (un registro de corta duración de sus propias emisiones), por lo que una escritura de API normalmente produce un solo fotograma. Un eco que llega más tarde desencadena una nueva consulta adicional, lo que entrega las mismas filas nuevamente: inofensivo, pero un suscriptor puede ver un fotograma idéntico dos veces.

## Captura desde el WAL

`REALTIME_CDC=wal`, y `auto` siempre que la base de datos lo permita, lee los cambios del write-ahead log de PostgreSQL a través de replicación lógica (el plugin integrado `pgoutput`) en lugar de triggers. Una escritura entonces no ejecuta ningún trigger ni envía ningún `NOTIFY`, lo cual importa cuando las escrituras son concurrentes: una transacción que invocó `NOTIFY` adquiere un bloqueo para todo el servidor durante el commit y lo mantiene hasta la escritura en disco, por lo que con la captura por triggers esos commits ocurren uno a la vez. Medido en PostgreSQL 18 con 32 escritores concurrentes y un vaciado en disco de 1&nbsp;ms, la captura por triggers limitó las inserciones a aproximadamente una décima parte de la tasa alcanzada por la captura por WAL.

Requiere:

- `wal_level = logical` en el servidor, lo que requiere un reinicio. En Amazon RDS configure `rds.logical_replication = 1`; en Cloud SQL, `cloudsql.logical_decoding = on`.
- Un rol que pueda replicar: `ALTER ROLE <role> REPLICATION`, o el equivalente del proveedor de alojamiento (en RDS, pertenencia a `rds_replication`).
- Un slot de replicación y un WAL sender libres por instancia de servidor (`max_replication_slots` y `max_wal_senders`, ambos con valor 10 por defecto).
- Una conexión directa (`DATABASE_DIRECT_URL`): un pooler no admite el protocolo de replicación.

Cuando falta alguno de estos requisitos, el arranque registra el motivo y usa la captura por triggers en su lugar: una advertencia bajo `wal`, una línea informativa bajo `auto`, ya que la mayoría de las bases de datos no están configuradas para decodificación lógica y ese es el resultado esperado en esos casos.

Lo que hace un arranque:

- Crea una publicación llamada `rebase_cdc` y le añade cada tabla servida y cada tabla de unión many-to-many. Las tablas solo se agregan, por lo que una versión anterior que aún se ejecute durante un despliegue progresivo no puede remover la tabla de una versión más nueva.
- Una tabla sin clave primaria, o con `REPLICA IDENTITY NOTHING`, se omite con una advertencia: PostgreSQL rechaza `UPDATE` y `DELETE` en una tabla publicada que no puede determinar qué fila cambió. Las escrituras realizadas en ella fuera de Rebase no se capturan.
- Cada instancia transmite la publicación a través de su propio slot de replicación **temporal**, el cual PostgreSQL elimina cuando la conexión se cierra, de modo que una instancia que falle no deje un slot reteniendo el WAL hasta llenar el disco. Una reconexión inicia un nuevo slot, y cada suscripción vuelve a consultar, ya que lo que se confirmó durante la interrupción no se reproduce.
- Una vez que su flujo está abierto, un arranque que aprovisiona y consume elimina los triggers de captura, tal como lo hace `off`, pero solo cuando ninguna otra instancia sigue escuchando en ellos. De lo contrario, una instancia que haya recurrido a la captura por triggers (por ejemplo, porque no encontró ningún slot de replicación libre) o una versión anterior que aún se ejecute durante un despliegue progresivo dejaría de recibir las escrituras realizadas en otros lugares. Cada conexión en tiempo real se identifica en `application_name` (`rebase-realtime:<instance>:cdc`, `:wal` o `:entity`), por lo que el arranque lee `pg_stat_activity` para ver quién sigue escuchando. La conexión de una versión anterior, que no lleva sufijo, se cuenta como que está escuchando. Mientras alguien esté escuchando, o cuando no se pueda realizar la comprobación, los triggers permanecen y se mantienen actualizados. Cada cinco minutos la instancia vuelve a comprobar, y los elimina una vez que nadie esté escuchando. Un proceso que solo aprovisiona, como el trabajo de migración de un [despliegue dividido](/docs/deployment/split-processes/), mantiene los triggers para los consumidores que no pueden transmitir y recurren a ellos.

Los escritores mantienen su máxima velocidad durante picos de carga, pero un solo WAL sender decodifica cada slot, por lo que si se superan de forma sostenida varios miles de escrituras por segundo, los eventos pueden llegar con retraso. Un rol con `REPLICATION` puede leer cada fila de una tabla publicada a través de un slot propio; el flujo permanece dentro del servidor, y los suscriptores aún vuelven a leer cada fila bajo su propio RLS.

## Requisitos y notas

- CDC requiere una cadena de conexión directa (`DATABASE_DIRECT_URL`, `directConnectionString` del adaptador o la conexión principal) para el cliente `LISTEN`; los poolers de conexiones en modo de transacción no admiten sesiones `LISTEN` de larga duración.
- Los triggers se instalan únicamente en las tablas a las que sirve el backend y en las tablas de unión de sus relaciones many-to-many. Se ignoran las escrituras en tablas no mapeadas.
- Una tabla servida que aún no se haya creado se omite con una advertencia en lugar de bloquear CDC para el resto.

## Próximos pasos

- [Tiempo real y WebSocket](/docs/backend/realtime) — suscripciones, canales y presencia, a los que alimentan estos eventos.
- [Tiempo real entre instancias](/docs/backend/realtime-transports) — el bus que transporta los cambios entre procesos de servidor.
