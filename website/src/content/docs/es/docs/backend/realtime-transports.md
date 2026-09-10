---
sourceHash: 8b0308f7ee06d77a
title: Tiempo real entre instancias
sidebar_label: Tiempo real entre instancias
description:"\"Cómo los canales de difusión (broadcast) y la presencia sobreviven a más de un proceso de servidor: el bus LISTEN/NOTIFY, qué posee cada instancia y cómo escribir tu propio transporte.\""
---

## Difusión entre instancias y arquitectura LISTEN/NOTIFY

Para entornos de clúster con múltiples instancias (por ejemplo, ejecutándose dentro de Kubernetes o contenedores Docker detrás de un balanceador de carga), Rebase se apoya en `LISTEN/NOTIFY` de PostgreSQL para sincronizar los **cambios en las filas** entre instancias. Por lo tanto, las suscripciones a colecciones y entidades abarcan varias instancias sin necesidad de configuración adicional; eso es lo que describe esta sección.

**Los canales de difusión (broadcast) y la presencia son independientes**, y funcionan por instancia hasta que activas un bus de canales. Consulta [Canales y presencia entre instancias](#canales-y-presencia-entre-instancias) más abajo.

### Omitir los pools de pgBouncer

Dado que los agrupadores de conexiones como **pgBouncer** no admiten el modelo de conexión persistente requerido para sesiones SQL `LISTEN` de larga duración, el supervisor de tiempo real abre un cliente Postgres dedicado y sin pool (`PgClient`) directamente a la base de datos. Esta conexión directa utiliza la variable de entorno `DATABASE_DIRECT_URL` si está configurada, lo que garantiza la estabilidad y evita el agotamiento del pool o desconexiones abruptas.

### Mecánica de notificaciones y estructura del payload

Cuando se modifica un registro en la Instancia A, esta transmite una notificación en el canal `rebase_entity_changes`. Para minimizar la sobrecarga en la base de datos y el ancho de banda de la red, el payload de la notificación se mantiene extremadamente compacto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` representa el ID de instancia aleatorio y único del servidor generado al iniciar, `p` es el slug de la colección (ruta) y `eid` es el ID de la entidad de destino.*

- **Autofiltrado**: Al recibir un mensaje, cada instancia lee el `sid`. Si coincide con su propio ID de instancia, el servidor descarta la notificación para evitar bucles infinitos de enrutamiento.
- **Retransmisión y distribución (Fan-out)**: Si la notificación proviene de otra instancia, el servidor programa una nueva consulta con debounce y retransmite la actualización a sus suscriptores WebSocket conectados localmente.
- **Bucle de reconexión del supervisor**: Si la conexión con la base de datos se interrumpe, un supervisor de conexión en segundo plano monitorea el estado y activa una secuencia de reconexión automática tras un retraso fijo de **3 segundos**, restaurando el bucle `LISTEN` sin afectar el ciclo de vida de la aplicación Hono principal.

## Canales y presencia entre instancias

Los cambios en las filas cruzan entre instancias de forma nativa (explicado arriba). Los canales de difusión y la presencia **no**: de forma predeterminada, solo se distribuyen a los clientes conectados a la instancia que los recibió.

En una sola instancia, esto es exactamente lo adecuado y no tiene costo adicional. Detrás de un balanceador de carga, es un error que no verás durante el desarrollo: dos colaboradores aterrizan en réplicas diferentes, se unen al mismo canal y ven una sala vacía mientras transmiten entre sí a la perfección. No se produce ningún error explícito.

La solución es un **bus de canales** (channel bus): un transporte opcional que lleva las tramas de los canales y la presencia entre instancias:

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
| `memory`     | **Predeterminado.** Una sola instancia. Sin entrega entre instancias, sin sobrecarga.                 |
| `postgres`   | Dos o más instancias. Usa `LISTEN/NOTIFY` en la base de datos que ya tienes — sin desplegar servicios nuevos. |

El transporte también se puede definir por despliegue con
`REALTIME_CHANNEL_BUS=memory|postgres`, de modo que pueda cambiarse sin necesidad de recompilar.
Sobrescribe un transporte integrado **con nombre** (`bus: { type: "memory" }`), y se
**ignora** deliberadamente cuando a `realtime.bus` se le pasa una *instancia* ya construida
de `ChannelBus`; la variable solo puede nombrar transportes que este paquete
sabe cómo construir, por lo que respetarla en ese caso significaría descartar silenciosamente el
objeto provisto por la aplicación. En ese caso, se registra una advertencia mencionando ambos, y un
valor no reconocido recurre a lo que estuviera configurado en lugar de pasar a memoria.

### Por qué no se incluye una opción con Redis de serie

Rebase se despliega como Postgres + backend + frontend. Un bus que necesitara un intermediario de mensajería añadiría un segundo servicio con estado en cada `docker-compose.yml` que genera la CLI, para una funcionalidad que la mayoría de las aplicaciones nunca utiliza; por lo tanto, el criterio para añadir uno es que la base de datos genuinamente no pueda soportar la carga.

Y puede soportarla. Medido a través de dos instancias de backend contra un único contenedor de Postgres, el bus de Postgres entregó **~10,000 mensajes entre instancias por segundo sin pérdidas**, y se mantuvo estable hasta alcanzar **ocho instancias** (14,000 entregas, sin pérdidas). Veinte personas moviendo cursores a 60 fps generan alrededor de 1,200 mensajes por segundo, aproximadamente un octavo de esa cifra.

El límite que vale la pena vigilar no es la capacidad, sino que cada notificación es una consulta contra tu base de datos principal, compitiendo con las consultas reales de tu aplicación. Por lo tanto, el bus de Postgres **fusiona (coalesces)** las tramas salientes (ver más abajo), lo que mantiene ese costo proporcional al tiempo transcurrido en lugar de a la cantidad de mensajes.

Por cada cliente, el socket acepta hasta **7,200 tramas de canal por minuto** (120/s: 60 fps de difusiones de cursor más la actualización de presencia que cada una transporta), contabilizadas por separado del presupuesto que comparten las consultas y suscripciones. Las tramas que superen ese límite se rechazan con un error `RATE_LIMITED` en lugar de encolarse.

El rechazo llega a `channel.onError()`, no como un `broadcast()` denegado; consulta [Cuándo se rechaza una trama de canal](#cuándo-se-rechaza-una-trama-de-canal).

Si aún necesitas más rendimiento después de eso, limita (throttle) los eventos de tipo cursor en el cliente (el estado donde la última escritura gana no necesita 60 actualizaciones por segundo) y considera enrutar a los colaboradores de un mismo documento a la misma instancia: el enrutamiento persistente (sticky routing) reduce el tráfico entre instancias a casi nada, independientemente del número de usuarios. Solo más allá de ese punto vale la pena considerar otro transporte, y entonces la solución es un paquete de transporte, no un fork. Consulta [Cómo escribir tu propio transporte](#cómo-escribir-tu-propio-transporte).

### Fusión de mensajes (Coalescing)

Las tramas publicadas mientras una ventana breve está abierta se envían juntas en una sola notificación. La ventana es de **flanco inicial (leading-edge)**: una trama que llega cuando no hay ninguna ventana abierta se envía de inmediato, de modo que un canal inactivo no paga latencia adicional y solo se procesan por lotes los flujos sostenidos.

Medido a través de dos instancias, 3,000 difusiones, todas entregadas en todos los casos:

| Patrón de tráfico | Fusión desactivada | Fusión activada | Reducción |
|---|---|---|---|
| Ráfaga (lo más rápido posible) | 3,000 consultas | 68 consultas | **44×** |
| Espaciado (~500 msg/s, distribuido) | 3,000 consultas | 240 consultas | **12.5×** |

El caso de ráfaga también finalizó ~11 veces más rápido en tiempo real transcurrido, debido a que los viajes de ida y vuelta a la base de datos eran el cuello de botella y no el trabajo en sí.

La ventana está configurada por defecto en 10 ms y no es un ajuste crítico: 5 ms, 10 ms y 20 ms produjeron recuentos de consultas idénticos en ambos patrones, debido a que un lote está limitado por el techo de payload de 8 KB o por la naturaleza misma del tráfico mucho antes de que el temporizador importe. Cámbialo solo si tienes un motivo:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 desactiva la fusión
}
```

Una nota sobre el despliegue: un lote viaja con un formato de red diferente al de una sola trama, y una instancia que ejecute una versión anterior no lo comprenderá. Las tramas individuales siempre se envían sin empaquetar, por lo que un despliegue progresivo (rolling deploy) solo corre el riesgo de perder tramas si el clúster está bajo una carga constante *durante* el reinicio; aun así, los canales retenidos se reparan por sí mismos mediante la reproducción del historial.

## Cómo escribir tu propio transporte

`realtime.bus` acepta cualquier objeto que implemente la interfaz `ChannelBus`, por lo que un transporte puede distribuirse como su propio paquete: `@rebasepro/types` declara el contrato y no se requiere nada más para implementarlo:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Conectar. Rechazar si no es posible; quien llama recurre a la entrega
        // dentro del proceso, lo cual es mucho mejor que un clúster que cree
        // estar conectado y silenciosamente no lo esté.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Alcanzar a todas las demás instancias, o rechazar.
    }

    async stop(): Promise<void> {
        // Idempotente; liberar cualquier elemento que mantenga abierto el bucle de eventos.
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

**Lo que tu implementación debe garantizar:** `start()` rechaza cuando el transporte no se puede utilizar; `publish()` alcanza a todas las demás instancias o rechaza; `stop()` es idempotente; y un mensaje mal formado se descarta y se registra en los registros en lugar de lanzar una excepción, de modo que una trama corrupta no pueda derribar al listener.

**Lo que no es necesario garantizar:** el orden (los canales retenidos incluyen `seq` y el SDK los ordena en función de este), la durabilidad (una trama perdida es una actualización en vivo omitida, reparada mediante la reproducción del historial del cliente) o la entrega exactamente una vez (las tramas retenidas se desduplican mediante `seq`; las diferencias de presencia son idempotentes).

`maxFrameBytes` es la forma en que el framework sabe si debe enviar un mensaje retenido grande en línea o como un puntero. Devuelve `Infinity` cuando tu transporte no tenga un límite significativo, de modo que la ruta del puntero nunca se tome innecesariamente.

La entrega a los clientes locales no es tu responsabilidad: el servicio en tiempo real es el encargado de decidir qué suscriptores reciben una trama. Un transporte solo traslada tramas entre instancias.

### El límite de 8 KB en el bus de Postgres

`pg_notify` rechaza cargas útiles de 8000 bytes o más. Los cursores y la presencia caben con espacio de sobra; una instantánea (snapshot) de un documento no. Rebase gestiona esto del mismo modo que gestiona cambios grandes en entidades: enviando una dirección en lugar de un cuerpo:

- **En un canal retenido** (ver [Retención de canales](#retención-de-canales)) el mensaje ya está almacenado con un número de secuencia, por lo que la notificación solo incluye `(channel, seq)` y cada instancia receptora vuelve a leer el cuerpo. No hay ningún límite de tamaño en absoluto.
- **En un canal efímero** no hay nada a lo que apuntar. La difusión se entrega localmente, el remitente recibe un error `CHANNEL_BUS_PAYLOAD_TOO_LARGE` en `channel.onError()`, y una advertencia especifica el nombre del canal, en lugar de que el mensaje llegue silenciosamente solo a la mitad del clúster.

Si vas a transmitir mensajes grandes, añade una regla de retención a ese canal. Esa es toda la solución.

### La presencia es un estado compartido, no solo distribución

`presence_state` debe responder "quién está en este canal" para todo el clúster, algo que la memoria por instancia no puede hacer. Cuando un bus está activo, Rebase mantiene la lista en `rebase.channel_presence` (creada automáticamente) y responde a las solicitudes de listas desde allí.

| Columna       | Contenido                                      |
|---------------|------------------------------------------------|
| `channel`     | Nombre del canal                               |
| `client_id`   | El cliente monitoreado                         |
| `instance_id` | A qué instancia del backend está conectado     |
| `state`       | El estado de presencia del cliente             |
| `last_seen`   | Actualizado por el heartbeat de presencia del SDK |

El SDK envía un heartbeat de presencia aproximadamente cada 20 segundos frente a un tiempo de espera de 30 segundos. Las filas que dejan de actualizarse se eliminan, y las salidas se anuncian a todas las instancias, lo que también sirve como recuperación ante fallos: un pod que se interrumpe deja filas atrás que, tras una ventana de tiempo de espera, se ven exactamente como cualquier otro cliente que quedó inactivo. Un apagado ordenado borra sus propias filas de inmediato, por lo que un despliegue progresivo no muestra una ventana de elementos fantasma.

:::caution[La conexión LISTEN debe omitir tu agrupador de conexiones (pooler)]
`LISTEN` es un estado de sesión, por lo que el bus de Postgres necesita una conexión directa, no pgBouncer ni ningún agrupador en modo transacción. Rebase utiliza `DATABASE_DIRECT_URL` cuando está definida; detrás de un agrupador de conexiones, apúntala al servicio de base de datos en sí. Sin una URL directa que sea válida, el bus registra una advertencia y permanece en modo memoria.
:::

## Siguientes pasos

- [Tiempo real y WebSocket](/docs/backend/realtime/) — suscripciones, canales y presencia en una sola instancia
- [Procesos divididos](/docs/deployment/split-processes/) — el modelo de despliegue donde esto resulta relevante
- [Autohospedaje](/docs/deployment/self-hosting/) — cómo ejecutar el entorno de ejecución por tu cuenta

---
