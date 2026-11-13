---
sourceHash: 1b7c64b3c001f57d
title: Tiempo real entre instancias
sidebar_label: Tiempo real entre instancias
description: "Cómo los canales de broadcast y presencia sobreviven a más de un proceso de servidor: el bus LISTEN/NOTIFY, qué posee cada instancia y cómo escribir tu propio transporte."
---

## Difusión entre instancias y arquitectura LISTEN/NOTIFY

Para entornos de clúster multinstancia (p. ej., ejecutándose dentro de contenedores de Kubernetes o Docker detrás de un balanceador de carga), Rebase se apoya en `LISTEN/NOTIFY` de PostgreSQL para sincronizar los **cambios de fila** entre instancias. Por lo tanto, las suscripciones a tablas y entidades abarcan varias instancias sin necesidad de configuración; eso es lo que describe esta sección.

**Los canales de broadcast y la presencia son independientes**, y funcionan por instancia hasta que activas un bus de canales. Consulta [Canales y presencia entre instancias](#canales-y-presencia-entre-instancias) más abajo.

### Omisión de los pools de pgBouncer

Debido a que los gestores de pools de conexiones (connection poolers) como **pgBouncer** no admiten el modelo de conexión persistente requerido para sesiones SQL `LISTEN` de larga duración, el supervisor en tiempo real abre un cliente de Postgres dedicado y sin pool (`PgClient`) directamente a la base de datos. Esta conexión directa utiliza la variable de entorno `DATABASE_DIRECT_URL` si está configurada, lo que garantiza la estabilidad y evita el agotamiento del pool o caídas abruptas.

### Mecánica de notificaciones y estructura del payload

Con la [captura de cambios en la base de datos](/docs/backend/realtime-cdc/) activa (el valor predeterminado siempre que el rol de la base de datos pueda crear triggers), cada instancia escucha cada commit en el canal `rebase_cdc` y no se envía nada de lo que se describe a continuación. Sin ella, cuando se modifica un registro en la Instancia A, esta transmite una notificación en el canal `rebase_entity_changes`. Para minimizar la sobrecarga en la base de datos y el ancho de banda de la red, el payload de la notificación se mantiene extremadamente compacto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` representa el ID de instancia aleatorio y único del servidor generado al iniciar, `p` es el slug de la tabla (ruta) y `eid` es el ID de la entidad objetivo.*

Los cambios realizados en el mismo momento (un guardado masivo anuncia cada fila que escribió) se envían juntos, en tantas pocas notificaciones como quepan bajo el límite de NOTIFY de 8000 bytes de Postgres, listando cada una sus cambios como tripletas `[p, eid, db]`:

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Un cambio individual mantiene la estructura anterior, de modo que una instancia más antigua aún pueda leerlo durante un despliegue gradual (rolling deploy).

- **Autofiltrado**: Al recibir un mensaje, cada instancia lee el `sid`. Si coincide con su propio ID de instancia, el servidor descarta la notificación para evitar bucles de enrutamiento infinitos.
- **Retransmisión y distribución (fan-out)**: Si la notificación provino de otra instancia, el servidor programa una nueva consulta con debounce (refetch) para sus suscriptores conectados localmente de cada cambio. No lee nada al recibirlo: cada frame es un refetch bajo el propio alcance (scope) de su suscriptor.
- **Bucle de reconexión del supervisor**: Si la conexión a la base de datos se cae, un supervisor de conexión en segundo plano monitorea el estado y activa una secuencia de reconexión automática tras un retraso fijo de **3 segundos**, restaurando el bucle `LISTEN` sin afectar el ciclo de vida de la aplicación principal de Hono. Luego se vuelven a consultar (refetch) todas las suscripciones activas en la instancia, ya que lo que se haya publicado mientras la conexión estaba caída no llegó a nadie. Si no se puede acceder a la base de datos al iniciar, la conexión se reintenta de la misma manera.
- **Heartbeat**: Una conexión `LISTEN` está inactiva por naturaleza, y un tiempo de espera de inactividad (idle timeout) en un balanceador de carga o un NAT puede cortarla sin ningún error en ninguno de los extremos (una conexión semiabierta o half-open). Por lo tanto, se ejecuta con TCP keepalive y debe responder a un `SELECT 1` cada 30 segundos dentro de un plazo de 10 segundos. Si falla, se reemplaza como se indicó anteriormente. Mientras la conexión está caída, `/health` la lista como `cross-instance`, y una vez que ha estado caída durante 60 segundos, la verificación falla.

## Canales y presencia entre instancias

Los cambios en las filas cruzan las instancias por sí mismos (explicado arriba). Los canales de broadcast y la presencia **no**: por defecto, solo se distribuyen a los clientes conectados a la instancia que los recibió.

En una sola instancia, esto es exactamente lo correcto y no cuesta nada. Detrás de un balanceador de carga, es un error que no verás durante el desarrollo: dos colaboradores caen en réplicas diferentes, se unen al mismo canal y ven una sala vacía mientras transmiten entre sí a la perfección. No se genera ningún error.

La solución es un **bus de canales** (channel bus): un transporte opcional que lleva los frames de canales y la presencia entre instancias:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | Cuándo usarlo                                                                                          |
|--------------|--------------------------------------------------------------------------------------------------------|
| `memory`     | **Por defecto.** Instancia única. Sin entrega entre instancias, sin sobrecarga.                       |
| `postgres`   | Dos o más instancias. Utiliza `LISTEN/NOTIFY` en la base de datos que ya tienes; sin nuevos servicios que desplegar. |

El transporte también se puede configurar por despliegue con
`REALTIME_CHANNEL_BUS=memory|postgres`, de modo que se puede cambiar sin necesidad de recompilar.
Sobrescribe un valor integrado **con nombre** (`bus: { type: "memory" }`), y se
**ignora** deliberadamente cuando a `realtime.bus` se le pasó una *instancia*
construida de `ChannelBus`; la variable solo puede nombrar transportes que este paquete
sabe cómo construir, por lo que respetarla en ese caso significaría descartar silenciosamente el
objeto suministrado por la aplicación. En ese caso, se registra una advertencia mencionando ambos, y un
valor no reconocido recurre a lo que estuviera configurado en lugar de a memory.

### Por qué no se incluye una opción con Redis de serie

Rebase se despliega como Postgres + backend + frontend. Un bus que necesitara un message broker agregaría un segundo servicio con estado (stateful) en cada `docker-compose.yml` generado por la CLI, para una característica que la mayoría de las aplicaciones nunca usan; por lo tanto, el criterio para añadir uno es que la base de datos realmente no pueda soportar la carga.

Y sí puede. Medido en dos instancias de backend frente a un único contenedor de Postgres, el bus de Postgres entregó **~10.000 mensajes entre instancias por segundo sin pérdidas**, y se mantuvo estable hasta **ocho instancias** (14.000 entregas, sin pérdidas). Veinte personas moviendo cursores a 60 fps generan alrededor de 1.200 mensajes por segundo, aproximadamente un octavo de eso.

El límite que vale la pena vigilar no es la capacidad, sino que cada notificación es una consulta contra tu base de datos principal, compitiendo con las consultas reales de tu aplicación. Por ello, el bus de Postgres **fusiona (coalesces)** los frames salientes (ver más abajo), que es lo que mantiene ese costo proporcional al tiempo transcurrido en lugar de al número de mensajes.

Por cliente, el socket acepta hasta **7.200 frames de canal por minuto** (120/s: 60 fps de emisiones de cursor más la actualización de presencia que lleva cada una), contabilizados por separado del límite compartido por consultas y suscripciones. Los frames que superen ese límite se rechazan con un error `RATE_LIMITED` en lugar de encolarse.

El rechazo llega a través de `channel.onError()`, no como un `broadcast()` rechazado; consulta [Cuándo se rechaza un frame de canal](/docs/backend/realtime#when-a-channel-frame-is-refused).

Si aún después de eso estás al límite, limita la frecuencia (throttle) de eventos de nivel de cursor en el cliente (el estado last-write-wins no necesita 60 actualizaciones por segundo) y considera enrutar a los colaboradores de un documento a la misma instancia con [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance); el enrutamiento persistente (sticky routing) reduce el tráfico entre instancias a casi nada, sin importar la cantidad de usuarios. Solo más allá de ese punto vale la pena otro transporte, y entonces la solución es un paquete de transporte, no un fork. Consulta [Escribir tu propio transporte](#escribir-tu-propio-transporte).

### Ver qué está haciendo el bus

Con `REBASE_METRICS=true`, cada instancia reporta lo que está transportando en `/metrics`:

| Métrica | Tipo | Significado |
|---|---|---|
| `rebase_realtime_sockets` | gauge | Sockets abiertos en esta instancia |
| `rebase_realtime_channels` | gauge | Canales con un miembro en esta instancia |
| `rebase_realtime_bus_frames_published_total` | counter | Frames que esta instancia envió al bus, por `kind`: `broadcast`, `broadcast_ref`, `presence_diff` y `channels`, indicando las instancias entre sí qué es lo que atienden |
| `rebase_realtime_bus_frames_skipped_total` | counter | Emisiones de broadcast y cambios de presencia no enviados porque ninguna otra instancia tenía miembros en el canal |

Los contadores comienzan desde cero cuando la instancia arranca y cuentan frames, de los cuales el bus puede unir varios en una sola notificación. Los mensajes retenidos siempre viajan, por lo que nunca se omiten. En el bus predeterminado de `memory`, ambos permanecen en cero.

Realiza el scraping en cada instancia en lugar de en un balanceador de carga frente a ellas: los números son por proceso. Un grupo que permanece en una sola instancia se refleja en un incremento de `skipped` mientras que `broadcast` y `presence_diff` se mantienen planos, y los sockets se distribuyen entre las instancias. Si las emisiones broadcast aumentan en todas las instancias, significa que los canales las abarcan. En Rebase Cloud, `rebase cloud metrics` muestra los mismos conteos por instancia.

### Coalescing

Los frames publicados mientras una ventana corta está abierta salen juntos en una sola notificación. La ventana es de **flanco inicial (leading-edge)**: un frame que llega cuando no hay ninguna ventana abierta se envía inmediatamente, por lo que un canal inactivo no sufre latencia adicional y solo se procesa por lotes (batch) un flujo sostenido.

Medido en dos instancias, 3.000 emisiones (broadcasts), todas entregadas en todos los casos:

| Patrón de tráfico | Coalescing desactivado | Coalescing activado | Reducción |
|---|---|---|---|
| Ráfaga (lo más rápido posible) | 3.000 consultas | 68 consultas | **44×** |
| Ritmo constante (~500 msg/s, espaciado) | 3.000 consultas | 240 consultas | **12.5×** |

El caso en ráfaga también finalizó ~11× más rápido en tiempo de reloj real (wall-clock), porque los viajes de ida y vuelta (round-trips) a la base de datos eran el cuello de botella y no el trabajo en sí.

La ventana tiene un valor predeterminado de 10 ms y no es una configuración crítica: 5 ms, 10 ms y 20 ms produjeron conteos de consultas idénticos en ambos patrones, porque un lote está limitado por el techo de payload de 8 KB o por el comportamiento natural del tráfico mucho antes de que el temporizador sea relevante. Cámbialo solo si tienes una razón para hacerlo:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Una nota sobre el despliegue: un lote viaja en un formato de transmisión (wire shape) diferente al de un solo frame, y una instancia que ejecuta una versión anterior no lo comprenderá. Los frames individuales siempre se envían sin empaquetar, por lo que un despliegue gradual solo corre el riesgo de perder frames si el clúster está bajo una carga sostenida *durante* el reinicio; y los canales retenidos se reparan solos mediante la reproducción del historial de todos modos.

## Escribir tu propio transporte

`realtime.bus` acepta cualquier objeto que implemente la interfaz `ChannelBus`, de modo que un transporte puede distribuirse como su propio paquete: `@rebasepro/types` declara el contrato y no se requiere nada más para implementarlo:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Connect. Reject if you cannot — the caller falls back to in-process
        // delivery, which is far better than a cluster that believes it is
        // connected and silently is not.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Reach every other instance, or reject.
    }

    async stop(): Promise<void> {
        // Idempotent; release anything holding the event loop open.
    }
}
```

Pasa la instancia donde iría el nombre integrado:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Lo que tu implementación debe garantizar:** `start()` rechaza la promesa si el transporte no se puede usar; `publish()` llega a todas las demás instancias o la rechaza; `stop()` es idempotente; y un mensaje con formato incorrecto se descarta y se registra en los logs en lugar de lanzar una excepción, para que un frame defectuoso no tire abajo al listener.

**Lo que no tiene que garantizar:** orden (los canales retenidos llevan un `seq` y el SDK los ordena según este), durabilidad (un frame perdido es una actualización en vivo perdida, reparada mediante la reproducción del historial por parte del cliente) o entrega de exactamente una vez (los frames retenidos se desduplican mediante `seq`; los diffs de presencia son idempotentes).

`maxFrameBytes` es la forma en que el framework sabe si debe enviar un mensaje retenido grande en línea (inline) o como un puntero. Devuelve `Infinity` cuando tu transporte no tenga un límite significativo, de modo que la ruta de puntero nunca se tome innecesariamente.

La entrega a los clientes locales no es tu responsabilidad: el servicio de tiempo real se encarga de determinar qué suscriptores reciben un frame. Un transporte únicamente traslada frames entre instancias.

### El límite de 8 KB en el bus de Postgres

`pg_notify` rechaza cualquier payload de 8000 bytes o más. Los cursores y la presencia caben con espacio de sobra; una captura completa (snapshot) de un documento no. Rebase gestiona esto de la misma manera en que maneja los cambios de entidad grandes: enviando una dirección en lugar de un cuerpo:

- **En un canal retenido** (consulta [Retención de canales](/docs/backend/realtime#channel-retention)), el mensaje ya está almacenado con un número de secuencia, por lo que la notificación solo transporta `(channel, seq)` y cada instancia receptora vuelve a leer el cuerpo. No existe ningún límite de tamaño. Esto aplica a cada mensaje retenido, sea pequeño o grande: cualquier inicio de sesión en la base de datos puede ejecutar `LISTEN`, por lo que el cuerpo nunca viaja dentro de la notificación. Esto cuesta una lectura por clave primaria por mensaje en cada instancia que tenga un miembro en el canal.
- **Las emisiones efímeras (broadcasts) y la presencia** aún viajan dentro de la notificación misma, por lo que cualquier inicio de sesión en la base de datos puede leerlas. Coloca cualquier cosa que no deba ser legible de esa manera en un canal retenido.
- **En un canal efímero**, no hay nada a lo que apuntar. La emisión se entrega localmente, el remitente recibe un error `CHANNEL_BUS_PAYLOAD_TOO_LARGE` en `channel.onError()`, y una advertencia nombra el canal, en lugar de que el mensaje llegue silenciosamente solo a la mitad del clúster.

Si transmites mensajes grandes, asígnale una regla de retención a ese canal. Esa es toda la solución.

### La presencia es un estado compartido, no solo distribución

`presence_state` tiene que responder "¿quién está en este canal?" para todo el clúster, algo que la memoria por instancia no puede hacer. Cuando un bus está activo, Rebase mantiene el listado (roster) en `rebase.channel_presence` (creado automáticamente) y responde a las solicitudes de listado a partir de él.

| Columna       | Contenido                                      |
|---------------|------------------------------------------------|
| `channel`     | Nombre del canal                               |
| `client_id`   | El cliente rastreado                           |
| `instance_id` | A qué instancia de backend está conectado      |
| `state`       | El estado de presencia del cliente             |
| `last_seen`   | Actualizado por el heartbeat de presencia del SDK |

El SDK envía un heartbeat de presencia cada ~20 segundos frente a un tiempo de espera (timeout) de 30 segundos. Las filas que dejan de actualizarse se eliminan (reaped) y las salidas se anuncian a cada instancia, lo que además sirve como recuperación ante fallos: un pod que se cae deja filas que, tras una ventana de tiempo de espera, se ven exactamente igual que cualquier otro cliente que se quedó en silencio. Un apagado ordenado (graceful shutdown) limpia sus propias filas inmediatamente, de modo que un despliegue gradual no muestre una ventana de usuarios fantasma.

:::caution[La conexión LISTEN debe omitir tu pooler]
`LISTEN` es un estado de sesión, por lo que el bus de Postgres necesita una conexión directa; no pgBouncer ni ningún gestor de pools en modo transacción. Rebase utiliza `DATABASE_DIRECT_URL` cuando está configurada; detrás de un pooler, apúntala al servicio de base de datos directamente. Sin una URL directa válida, el bus registra una advertencia y permanece en modo memory.
:::

## Próximos pasos

- [Realtime & WebSocket](/docs/backend/realtime/) — suscripciones, canales y presencia en una sola instancia
- [Procesos divididos](/docs/deployment/split-processes/) — el tipo de despliegue para el que esto es relevante
- [Autohospedaje (Self-hosting)](/docs/deployment/self-hosting/) — cómo ejecutar el runtime por ti mismo
