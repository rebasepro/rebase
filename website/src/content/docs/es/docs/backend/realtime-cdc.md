---
sourceHash: 5f05a6b3c8a0e4b3
title: Captura de cambios en la base de datos
sidebar_label: Captura de cambios en la base de datos
description: "Eventos en tiempo real para cada escritura confirmada, sin importar cómo se haya realizado: los triggers de captura, la configuración REALTIME_CDC y lo que necesitan."
---

**Change Data Capture está activado por defecto.** Rebase captura los cambios en la base de datos y emite eventos en tiempo real para **cada escritura confirmada, independientemente de cómo se haya realizado** — REST, SDK, Studio, `psql`, una tarea cron en otro servicio, Drizzle/SQL sin procesar o el **editor SQL** de Studio. Este es el mismo modelo que Supabase Realtime siguiendo el write-ahead log.

No se requiere configuración. En una conexión de base de datos que lo soporte, CDC se autoaprovisiona al inicio; en una que no (por ejemplo, un rol restringido que no puede crear triggers), Rebase utiliza discretamente tiempo real a nivel de aplicación en su lugar — nada que activar, nada que se rompa.

## Configuración

CDC se controla mediante la variable de entorno `REALTIME_CDC`:

| Valor | Comportamiento |
| --- | --- |
| `auto` *(por defecto)* | Habilita la captura a nivel de base de datos donde la conexión lo admita; **recurre silenciosamente** a tiempo real a nivel de aplicación en caso contrario. Configuración cero. |
| `trigger` | Fuerza la captura basada en triggers. Funciona en cualquier PostgreSQL, incluidas instancias administradas sin replicación lógica. Advierte (en lugar de recurrir silenciosamente) si no se puede aprovisionar. |
| `wal` | Lee los cambios del write-ahead log a través de replicación lógica en lugar de triggers, por lo que una escritura no ejecuta ningún trigger ni envía ningún `NOTIFY`. Requiere `wal_level=logical` y un rol que pueda replicar; recurre a `trigger`, con una advertencia, cuando falta alguno de ellos. Consulta [Captura desde el WAL](#captura-desde-el-wal). |
| `off` | Solo tiempo real a nivel de aplicación. Utiliza esto para evitar la sobrecarga del trigger por escritura en cargas de trabajo con muchas escrituras. Un arranque con `off` que sea propietario del esquema también **elimina** los triggers y funciones de captura que un arranque anterior haya instalado, y registra cuántos quitó; anula su definición y el siguiente arranque los instalará de nuevo. |

La misma configuración es la opción `realtime.cdc` del adaptador de Postgres, para un servidor que lo configure en código. `REALTIME_CDC`, cuando se define, tiene prioridad.

Al arrancar verás una línea de registro indicando el modo activo, por ejemplo:

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

1. **Autoaprovisionamiento** — Al inicio (contexto de servidor/propietario), Rebase instala triggers idempotentes `AFTER INSERT/UPDATE/DELETE/TRUNCATE` en cada tabla gestionada. Se disparan una vez por sentencia y emiten notificaciones de cambio en el canal `rebase_cdc` que identifican las filas modificadas por su clave —la clave primaria, más las dos columnas de id para una tabla de unión de muchos a muchos— y no transportan **ninguna otra columna**. Una sentencia que modificó muchas filas las identifica en lotes de alrededor de mil claves, por lo que un `UPDATE` de 1 millón de filas envía aproximadamente 1.000 notificaciones en lugar de un millón; una sentencia que cambió una fila envía una notificación, y una que no cambió ninguna no envía nada. Un `TRUNCATE` se anuncia como un cambio en cada fila de la tabla. Una tabla particionada mantiene un trigger por fila, porque PostgreSQL copia un trigger de fila en cada partición y una escritura realizada directamente en una partición sigue siendo visible. PostgreSQL no impone ningún privilegio sobre `LISTEN`, por lo que cualquier rol que pueda conectarse a la base de datos puede leer este canal; se entera de qué claves cambiaron, nunca de lo que contienen. Una clave demasiado grande para el límite de 8&nbsp;KB de `NOTIFY` de PostgreSQL se envía sin clave (un cambio en toda la tabla, lo cual hace que cada suscripción de lista o de una sola fila vuelva a consultar), por lo que CDC nunca puede abortar la escritura desencadenante. Las funciones se reemplazan en cada arranque que aprovisiona, por lo que una base de datos instrumentada por una versión anterior —cuyo trigger enviaba filas completas— se actualiza en el siguiente arranque; un arranque con `REALTIME_CDC=off` las elimina en su lugar.

   **Actualización.** Una base de datos instrumentada por una versión anterior al procesamiento por lotes tiene un trigger por fila; el primer arranque de una versión más reciente lo reemplaza con los triggers por sentencia. Durante las 24 horas posteriores a eso, los nuevos triggers siguen enviando una notificación por fila, como lo hacían los antiguos, para que las instancias de la versión anterior que aún se ejecuten durante un despliegue continuo (o después de un rollback) reciban cada fila. Tras esa ventana de tiempo, se agrupan en lotes. Cada versión que agrupa en lotes puede leer ambos formatos.
2. **Captura** — Un cliente `LISTEN` dedicado y sin pool por instancia consume `rebase_cdc`, asigna la tabla modificada de nuevo a la tabla a la que sirve e introduce el cambio en la misma canalización de `RealtimeService` utilizada por las mutaciones de la API. Al igual que el listener entre instancias, prefiere `DATABASE_DIRECT_URL` y se reconecta automáticamente.
3. **Entrega segura con RLS** — La fila en crudo del flujo de cambios **nunca** se reenvía a los suscriptores. El cambio se marca como invalidado y cada suscripción vuelve a leer la fila bajo su **propio** contexto de autenticación. Por lo tanto, el filtrado se realiza por suscriptor, nunca por emisor: un cliente solo recibe las filas que sus políticas RLS le permiten.
4. **Entre instancias** — Debido a que cada instancia observa cada commit a través del flujo de cambios, CDC también *es* el canal entre instancias; la difusión heredada por mutación `rebase_entity_changes` no se utiliza mientras CDC está activo.
5. **Deduplicación** — Una mutación realizada a través de la API de Rebase programa una nueva consulta (refetch) para los suscriptores locales en el instante en que se confirma y también se replica a través del flujo de cambios. La instancia de origen suprime un eco que llegue dentro de la ventana de debounce de refetch (un registro de corta duración de sus propias emisiones), por lo que una escritura mediante la API normalmente produce un solo fotograma. Un eco que llegue más tarde desencadena una nueva consulta adicional, la cual entrega las mismas filas nuevamente: inofensivo, pero un suscriptor puede ver un fotograma idéntico dos veces.

## Captura desde el WAL

`REALTIME_CDC=wal` lee los cambios del write-ahead log de PostgreSQL mediante replicación lógica (el plugin integrado `pgoutput`) en lugar de triggers. En este caso, una escritura no ejecuta ningún trigger ni envía ningún `NOTIFY`, lo cual es relevante cuando las escrituras son concurrentes: una transacción que invocó `NOTIFY` toma un bloqueo para todo el servidor al momento de hacer commit y lo mantiene durante la escritura en disco, por lo que con la captura mediante triggers esos commits se realizan de uno en uno. Medido en PostgreSQL 18 con 32 escritores concurrentes y un vaciado a disco de 1&nbsp;ms, la captura por triggers limitó las inserciones a aproximadamente una décima parte de la tasa que alcanzó la captura por WAL.

Requiere:

- `wal_level = logical` en el servidor, lo que requiere un reinicio. En Amazon RDS, configure `rds.logical_replication = 1`; en Cloud SQL, `cloudsql.logical_decoding = on`.
- Un rol que pueda replicar: `ALTER ROLE <role> REPLICATION`, o el equivalente del proveedor de alojamiento (en RDS, pertenencia a `rds_replication`).
- Un slot de replicación libre y un WAL sender por cada instancia de servidor (`max_replication_slots` y `max_wal_senders`, ambos 10 por defecto).
- Una conexión directa (`DATABASE_DIRECT_URL`): un pooler no admite el protocolo de replicación.

Cuando falta alguno de estos requisitos, el arranque registra el motivo y utiliza la captura mediante triggers en su lugar.

Lo que hace el arranque:

- Crea una publicación llamada `rebase_cdc` y añade a ella cada tabla servida y cada tabla de unión de muchos a muchos. Las tablas solo se añaden, por lo que una versión anterior que aún se ejecute durante un despliegue continuo no puede volver a quitar la tabla de una versión más nueva.
- Una tabla sin clave primaria, o con `REPLICA IDENTITY NOTHING`, se omite con una advertencia: PostgreSQL rechaza `UPDATE` y `DELETE` en una tabla publicada que no puede determinar qué fila cambió. Las escrituras en ella realizadas fuera de Rebase no se capturan.
- Cada instancia transmite la publicación a través de su propio slot de replicación **temporal**, el cual PostgreSQL elimina cuando se cierra la conexión, por lo que una instancia que falle no puede dejar atrás un slot reteniendo WAL hasta llenar el disco. Una reconexión inicia un nuevo slot y cada suscripción vuelve a consultar, ya que lo confirmado durante la interrupción no se reproduce.
- Una vez que su flujo está abierto, un arranque que tanto aprovisiona como consume elimina los triggers de captura, tal como hace `off`. Durante un despliegue continuo para abandonar la captura mediante triggers, las instancias que aún la ejecutan dejan de recibir las escrituras realizadas en otros lugares hasta que sean reemplazadas; sus propias escrituras aún llegan a sus suscriptores. Un proceso que solo aprovisiona, como el trabajo de migración de un [split deployment](/docs/deployment/split-processes/), conserva los triggers para los consumidores que no pueden transmitir y recurren a ellos.

Los procesos de escritura mantienen su velocidad máxima durante ráfagas de carga, pero un solo WAL sender decodifica cada slot, por lo que por encima de varios miles de escrituras sostenidas por segundo, los eventos pueden llegar con retraso. Un rol con `REPLICATION` puede leer cada fila de una tabla publicada a través de un slot propio; el flujo permanece dentro del servidor y los suscriptores continúan releyendo cada fila bajo su propia política RLS.

## Requisitos y notas

- CDC requiere una cadena de conexión directa (`DATABASE_DIRECT_URL`, el `directConnectionString` del adaptador o la conexión principal) para el cliente `LISTEN` — los connection poolers en modo de transacción no admiten sesiones `LISTEN` de larga duración.
- Los triggers se instalan únicamente en las tablas que sirve el backend y en las tablas de unión de sus relaciones de muchos a muchos. Las escrituras en tablas no mapeadas se ignoran.
- Una tabla servida que aún no ha sido creada se omite con una advertencia en lugar de bloquear CDC para el resto.

## Próximos pasos

- [Realtime & WebSocket](/docs/backend/realtime) — suscripciones, canales y presencia, a los que estos eventos alimentan.
- [Realtime across instances](/docs/backend/realtime-transports) — el bus que transporta los cambios entre procesos de servidor.
