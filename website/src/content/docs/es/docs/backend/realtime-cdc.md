---
sourceHash: e3f0b557b79dc3c6
title: "Captura de cambios a nivel de base de datos (CDC)"
sidebar_label: "Captura de cambios a nivel de base de datos (CDC)"
description: "Eventos en tiempo real para cada escritura confirmada, sea cual sea su origen: los triggers de captura, el ajuste REALTIME_CDC y lo que necesitan."
---

**La captura de datos modificados (CDC) está activada por defecto.** Rebase captura los cambios en la base de datos y emite eventos en tiempo real para **cada escritura confirmada (committed), sin importar cómo se haya realizado**: REST, SDK, Studio, `psql`, un trabajo cron en otro servicio, Drizzle/SQL directo o el **editor SQL** de Studio. Este es el mismo modelo que utiliza Supabase Realtime al seguir el log de escritura previa (write-ahead log o WAL).

No requiere configuración. En una conexión de base de datos que lo soporte, CDC se aprovisiona automáticamente al inicio; en una que no lo haga (por ejemplo, un rol restringido que no pueda crear triggers), Rebase utiliza silenciosamente el tiempo real a nivel de aplicación: nada que encender, nada que se rompa.

## Configuración

CDC se controla mediante la variable de entorno `REALTIME_CDC`:

| Valor | Comportamiento |
| --- | --- |
| `auto` *(default)* | Habilita la captura a nivel de base de datos donde la conexión lo admita; de lo contrario, **recurre silenciosamente** al tiempo real a nivel de aplicación. Cero configuración. |
| `trigger` | Fuerza la captura basada en triggers. Funciona en cualquier PostgreSQL, incluidas instancias administradas sin replicación lógica. Emite una advertencia (en lugar de recurrir silenciosamente a la alternativa) si no puede aprovisionarse. |
| `wal` | Lee los cambios del registro de escritura anticipada (WAL) mediante replicación lógica en lugar de triggers, de modo que una escritura no ejecuta ningún trigger ni envía `NOTIFY`. Necesita `wal_level=logical` y un rol que pueda replicar; si falta alguno, recurre a `trigger` con una advertencia. Consulte [Captura desde el WAL](#captura-desde-el-wal). |
| `off` | Solo tiempo real a nivel de aplicación. Úsalo para evitar la sobrecarga de triggers por escritura en cargas de trabajo intensivas en escritura. Un arranque con `off` que es propietario del esquema también **elimina** los triggers y funciones de captura que instaló un arranque anterior, y registra cuántos quitó; quita el valor y el siguiente arranque los instala de nuevo. |

El mismo ajuste es la
opción `realtime.cdc` del adaptador de Postgres, para un servidor que lo configura en
código. `REALTIME_CDC`, cuando está definida, tiene prioridad.

Al arrancar verás una línea de registro que indica el modo activo, por ejemplo:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la conexión no lo soporta, `auto` muestra en su lugar una línea informativa en el log y continúa con el tiempo real a nivel de aplicación:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Cómo funciona

1. **Aprovisionamiento automático** — Al inicio (contexto de servidor/propietario), Rebase instala triggers idempotentes `AFTER INSERT/UPDATE/DELETE/TRUNCATE` en cada tabla administrada. Se disparan una vez por sentencia y emiten notificaciones de cambio en el canal `rebase_cdc` que identifican las filas modificadas por su clave — la clave primaria, más las dos columnas de id en el caso de una tabla de unión many-to-many — y no llevan **ninguna otra columna**. Una sentencia que cambió muchas filas las nombra en lotes de unas mil claves, así que un `UPDATE` de 1M de filas envía unas 1.000 notificaciones en lugar de un millón; una sentencia que cambió una fila envía una notificación, y una que no cambió ninguna no envía nada. Un `TRUNCATE` se anuncia como un cambio a todas las filas de la colección. Una tabla particionada mantiene un trigger por fila, porque PostgreSQL copia un trigger de fila en cada partición y una escritura hecha directamente en una partición también se ve. PostgreSQL no exige ningún privilegio para `LISTEN`, así que cualquier rol que pueda conectarse a la base de datos puede leer este canal; así se entera de qué claves cambiaron, nunca de qué contienen. Una clave demasiado grande para el límite de 8&nbsp;KB de `NOTIFY` en PostgreSQL se envía sin clave (un cambio a toda la colección, que vuelven a consultar todas las suscripciones de lista y de una sola fila sobre ella), de modo que CDC nunca pueda abortar la escritura desencadenante. Las funciones se reemplazan en cada arranque que aprovisiona, así que una base de datos instrumentada por una versión anterior — cuyo trigger enviaba filas completas — queda actualizada en el siguiente arranque; un arranque con `REALTIME_CDC=off` las elimina en su lugar.

   **Actualización.** Una base de datos instrumentada por una versión anterior al procesamiento por lotes tiene un trigger por fila; el primer arranque de una versión más nueva lo reemplaza por los triggers por sentencia. Durante las 24 horas siguientes, los nuevos triggers siguen enviando una notificación por fila, como hacían los antiguos, de modo que las instancias de la versión anterior que sigan ejecutándose durante un despliegue progresivo (o tras una reversión) oyen cada fila. Pasada la ventana, agrupan en lotes. Toda versión que agrupa en lotes lee ambas formas.
2. **Captura** — Un cliente `LISTEN` dedicado y no agrupado (unpooled) por instancia consume `rebase_cdc`, mapea la tabla modificada a su colección correspondiente e introduce el cambio en el mismo flujo de `RealtimeService` utilizado por las mutaciones de la API. Al igual que el listener entre instancias, prioriza `DATABASE_DIRECT_URL` y se reconecta automáticamente.
3. **Entrega segura con RLS** — La fila en bruto del flujo de cambios **nunca** se reenvía a los suscriptores. El cambio se marca como invalidado y cada suscripción vuelve a leer la fila bajo su **propio** contexto de autenticación. Por tanto, el filtrado es por suscriptor y nunca por emisor: un cliente solo recibe las filas que sus políticas RLS le permiten.
4. **Entre instancias** — Dado que cada instancia observa cada commit a través del flujo de cambios, CDC también *es* el canal entre instancias; la difusión heredada por mutación `rebase_entity_changes` no se utiliza mientras CDC esté activo.
5. **Desduplicación** — Una mutación realizada a través de la API de Rebase programa un refetch para los suscriptores locales en el instante en que se confirma (commits) y también se replica a través del flujo de cambios. La instancia de origen suprime un eco que llega dentro de la ventana de debounce del refetch (un registro efímero de sus propias emisiones), de modo que una escritura de la API normalmente produce una trama. Un eco que llega más tarde dispara un refetch más, que entrega de nuevo las mismas filas: es inocuo, pero un suscriptor puede ver una trama idéntica dos veces.

## Captura desde el WAL

`REALTIME_CDC=wal` lee los cambios del registro de escritura anticipada (write-ahead log) de PostgreSQL mediante replicación lógica (el plugin integrado `pgoutput`) en lugar de triggers. Así, una escritura no ejecuta ningún trigger ni envía `NOTIFY`, lo que importa en cuanto las escrituras son concurrentes: una transacción que llamó a `NOTIFY` toma al hacer commit un bloqueo para todo el servidor y lo mantiene durante la escritura a disco, de modo que con la captura por triggers esos commits ocurren de uno en uno. Medido en PostgreSQL 18 con 32 escritores concurrentes y un vaciado a disco de 1&nbsp;ms, la captura por triggers limitó las inserciones a alrededor de una décima parte del ritmo que alcanzó la captura desde el WAL.

Requisitos:

- `wal_level = logical` en el servidor, lo que exige un reinicio. En Amazon RDS, configure `rds.logical_replication = 1`; en Cloud SQL, `cloudsql.logical_decoding = on`.
- Un rol que pueda replicar: `ALTER ROLE <role> REPLICATION`, o el equivalente del proveedor (en RDS, pertenecer a `rds_replication`).
- Un slot de replicación y un WAL sender libres por cada instancia del servidor (`max_replication_slots` y `max_wal_senders`, ambos 10 por defecto).
- Una conexión directa (`DATABASE_DIRECT_URL`): un pooler no transporta el protocolo de replicación.

Si falta cualquiera de ellos, el arranque registra el motivo y usa la captura por triggers.

Qué hace un arranque:

- Crea una publicación llamada `rebase_cdc` y le añade la tabla de cada colección y cada tabla intermedia de una relación de muchos a muchos. Las tablas solo se añaden, de modo que una versión anterior que siga en ejecución durante un despliegue gradual no puede volver a sacar la tabla de una colección más nueva.
- Una tabla sin clave primaria, o con `REPLICA IDENTITY NOTHING`, queda fuera con una advertencia: PostgreSQL rechaza `UPDATE` y `DELETE` en una tabla publicada que no puede indicar qué fila cambió. Las escrituras en ella hechas fuera de Rebase no se capturan.
- Cada instancia recibe la publicación a través de su propio slot de replicación **temporal**, que PostgreSQL elimina al cerrarse la conexión, así que una instancia que se cae no puede dejar atrás un slot que retenga WAL hasta llenar el disco. Una reconexión inicia un slot nuevo y cada suscripción vuelve a consultar, porque lo que se confirmó durante la interrupción no se reproduce.
- Una vez abierto su flujo, un arranque que aprovisiona y consume a la vez elimina los triggers de captura, como hace `off`. Durante un despliegue gradual que abandona la captura por triggers, las instancias que aún la ejecutan dejan de oír las escrituras hechas en otro lugar hasta que se reemplazan; sus propias escrituras siguen llegando a sus suscriptores. Un proceso que solo aprovisiona, como el job de migración de un [despliegue dividido](/docs/deployment/split-processes/), conserva los triggers para los consumidores que no pueden recibir el flujo y recurren a ellos.

Los escritores mantienen toda su velocidad durante un pico, pero un único WAL sender decodifica cada slot, así que con varios miles de escrituras por segundo sostenidas los eventos pueden llegar con retraso. Un rol con `REPLICATION` puede leer cada fila de una tabla publicada a través de un slot propio; el flujo se queda dentro del servidor y los suscriptores siguen releyendo cada fila bajo su propio RLS.

## Requisitos y notas

`directConnectionString` es la opción del adaptador; en 0.24 usa `DATABASE_DIRECT_URL`.

- CDC requiere una cadena de conexión directa (`DATABASE_DIRECT_URL`, el `directConnectionString` del adaptador o la conexión principal) para el cliente `LISTEN`: los agrupadores de conexiones (connection poolers) en modo transacción no admiten sesiones `LISTEN` de larga duración.
- Los triggers solo se instalan en tablas respaldadas por una colección registrada, y en las tablas de unión de sus relaciones muchos a muchos. Las escrituras en tablas no asignadas se ignoran.
- Una colección cuya tabla aún no ha sido migrada se omite con una advertencia en lugar de bloquear CDC para el resto.

## Siguientes pasos

- [Realtime y WebSocket](/docs/backend/realtime) — suscripciones, canales y presencia, que estos eventos alimentan.
- [Realtime entre instancias](/docs/backend/realtime-transports) — el bus que transporta los cambios entre procesos del servidor.
