---
sourceHash: a0e8bb4006af2399
title: División en varios procesos
sidebar_label: Procesos divididos
description: Ejecute un bundle como varios procesos cooperativos —una API, una capa de funciones, un worker— desde la misma imagen de runtime publicada, para que una función personalizada pesada deje de competir con la API de datos.
---

## Visión general

Un despliegue de Rebase normalmente es un solo proceso que sirve todo: la API de datos,
autenticación, almacenamiento, sus funciones personalizadas, cron y la cola de tareas. Esa es la
estructura adecuada para casi cualquier despliegue y se mantiene como la predeterminada.

Cuando deja de ser la estructura adecuada —una función personalizada que satura el bucle de eventos,
una capa de funciones que debería escalar o reiniciarse independientemente de la API—, puede
iniciar **la misma imagen y el mismo bundle** varias veces y hacer que cada
proceso sirva una parte diferente del proyecto. No hay nada nuevo que compilar ni
nada que un cliente deba saber: las URLs no cambian.

Una sola variable de entorno decide qué es un proceso:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Qué sirve cada rol

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, el editor de esquemas | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | reenvía (ver abajo) | ✅ | — |
| `/api/cron` (la superficie de administración) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sirve websockets, consume eventos de cambio | ✅ | ✅ | — | — |
| Crea el esquema en el arranque | ✅ | ✅ | — | — |
| Ejecuta el programador de cron | ✅ | ✅ | — | ✅ |
| Ejecuta workers de la cola de tareas | ✅ | ✅ | — | ✅ |

El estado de salud (health) y las métricas están en cada rol sin excepción. Un proceso que un
orquestador no puede sondear es un proceso que no puede actualizar progresivamente (roll).

Realtime está en la lista porque tiene un coste, lo use alguien o no:
un proceso que consume eventos de cambio mantiene una conexión `LISTEN` fuera
del pool durante todo el tiempo que se ejecuta, e instala los disparadores de captura en el arranque. Solo
un proceso que sirve websockets tiene a quién entregarle eventos, por lo que los dos roles que
no sirven ninguno no hacen ninguna de las dos cosas. **Las escrituras realizadas por esos procesos aún se detectan**:
la captura se realiza mediante disparadores en la base de datos, por lo que el cambio lo publica la base de datos
en lugar del proceso que lo realizó. Una función que escribe una fila sigue despertando a
cada suscriptor en la `api`.

## Docker Compose

Dos servicios a partir de una sola imagen, un bundle y una sola base de datos:

```yaml
services:
  api:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

  functions:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
      TRUSTED_PROXY_HOPS: 1
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
```

```bash
docker compose up --scale functions=3
```

Ambos procesos necesitan la misma `DATABASE_URL`, el mismo `JWT_SECRET` y la misma
`REBASE_SERVICE_KEY`: forman un único despliegue, y un token emitido por uno debe
ser aceptado por el otro.

## Mantener las URLs iguales

`REBASE_FUNCTIONS_UPSTREAM` le indica al proceso `api` que reenvíe `/api/functions/*`
al proceso de funciones en lugar de servirlo él mismo. Los clientes, los SDKs generados y las claves
de API ven exactamente la misma superficie que veían antes de la división, por lo que ningún código de aplicación
cambia y no tiene que configurar un proxy inverso para probarlo.

Un despliegue en producción puede preferir enrutar la ruta en su ingress directamente, en
cuyo caso deje `REBASE_FUNCTIONS_UPSTREAM` sin definir; el proceso `api` entonces
responderá con un 404 para esas rutas y el proxy situado delante decidirá a dónde van.

### Saltos de proxy (proxy hops)

Cuando la API reenvía una petición, añade la dirección del cliente a `X-Forwarded-For`. Eso
hace que el proceso de funciones se encuentre tras **un salto de proxy más** que la API,
y se le debe indicar:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` es el número de proxies inversos que realmente ejecuta delante
de un proceso. Cada uno añade la dirección que vio a `X-Forwarded-For`, por lo que el
cliente real es la N-ésima entrada desde la derecha; todo lo que esté más a la izquierda es
proporcionado por el cliente y se ignora, que es lo que impide que un llamador falsifique la cabecera para
rotar claves de limitación de tasa (rate limit). Su valor predeterminado es `0`: ningún proxy es de confianza.

Si configura esto mal, nada fallará de forma visible: los limitadores de tasa en el proceso de funciones
asociarán cada petición a la dirección del contenedor de la API, por lo que todos sus clientes compartirán un
mismo cupo, y la IP registrada en cada evento de autenticación será la misma.

## Un proceso es dueño del esquema

Exactamente un proceso en un despliegue dividido crea las tablas y aplica las
políticas de RLS en el arranque, y ese es el proceso `api` (o `all`). Todos los demás procesos deben
configurar:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Esto es **obligatorio**, no una sugerencia: un proceso `functions` o `worker` que se deje con la
configuración predeterminada se negará a iniciar, y mostrará un mensaje indicándolo. `CREATE … IF NOT EXISTS` lee el catálogo
y luego escribe en él en dos pasos separados, por lo que los procesos que arrancan al mismo tiempo
colisionan; y un despliegue donde varios compiten por aprovisionar el mismo
esquema no es algo que nadie haya diseñado intencionadamente.

## Servir una función por proceso

Un proceso puede servir un subconjunto con nombre, que es como una función costosa
obtiene su propio número de réplicas sin mover su código a otra parte:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Los nombres son los nombres de archivo sin la extensión: el mismo nombre bajo el cual la
función está montada. Un nombre que el bundle no contenga **hace fallar el arranque**, y el error lista
los nombres que sí contiene. Un proceso configurado para una sola función existe para esa
función, por lo que un error tipográfico que silenciosamente no sirviera nada sería el peor resultado
posible.

## Cron y tareas en segundo plano

Ambos ya son seguros para ejecutarse en más de un proceso: el programador de cron reclama
cada par `(job, slot)` en la base de datos, y la cola de tareas reclama filas con
`FOR UPDATE SKIP LOCKED`. Por tanto, `api` sigue ejecutando ambos por defecto y una división
en dos servicios se completa sin necesidad de un tercer contenedor.

Añada un proceso `worker` cuando desee trabajo programado fuera de la ruta de peticiones, y
desactívelo en la API:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
```

Un proceso `functions` nunca ejecuta ninguno de los dos. Se escala según la carga de peticiones y
se reemplaza a voluntad, y darle trabajo programado haría que su número de réplicas signifique
algo que no debería.

Tenga en cuenta que `rebase.jobs.enqueue` sigue funcionando en todas partes, incluso en un proceso
que no ejecuta ningún worker: encolar es una escritura, ejecutar es un bucle de sondeo (poll loop), y solo
lo segundo es lo que un rol desactiva.

## Lo que la división no le proporciona

**Límites de tasa compartidos, a menos que los solicite.** El almacenamiento predeterminado es por proceso, por lo que N
procesos multiplican la cuota de cada llamador por N sin nada en ningún registro que lo
indique. Configure `REBASE_RATE_LIMIT_STORE=sql` en cada proceso que sirva HTTP:
hace el conteo en Postgres, por lo que el límite es el límite sin importar cuántas réplicas haya.
(El chart de Helm lo configura por usted y se niega a renderizar una topología de múltiples procesos
que lo deje en `memory`).

**Canales entre instancias.** Broadcast y presence utilizan un bus en memoria por
defecto, que no cruza procesos. Esta es una cuestión del *número de réplicas*
más que de la división en sí —se aplica igualmente a un despliegue de un solo rol
escalado a tres réplicas—, por lo que configure `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` en
la configuración) siempre que más de un proceso sirva websockets.

**Escalado a cero.** Nada de lo aquí descrito escala un proceso hasta cero ni inicia uno
bajo demanda. Esa es una capacidad de la plataforma, no del runtime.

## Desplegar una unidad por separado

Todo lo anterior divide *dónde se ejecuta el trabajo*. Todo se sigue distribuyendo como una
sola compilación: una imagen, un bundle, desplegados juntos. Ese es el valor predeterminado correcto, y
la mayoría de los despliegues deberían mantenerse así.

Una unidad también puede mantenerse en su propia compilación: una corrección en una función que no
reinicia la API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.21.0"     # this unit only; the rest stay on the release-wide tag
```

Normalmente solo vale la pena fijar la etiqueta (tag): el repositorio se hereda, por lo que se trata de
un solo proyecto y una sola imagen con una sola unidad modificada. `bundleUrl` hace lo mismo
cuando `bundle.mode: url`.

### La regla

Dos unidades en compilaciones diferentes son dos conjuntos de colecciones contra **una sola**
base de datos, y solo una unidad la aprovisiona. Por lo tanto:

> **La unidad que posee el esquema se actualiza primero. Una unidad puede retrasarse; nunca debe
> adelantarse.**

Ese es el Job de migración, o la `api` cuando el Job está desactivado. Una unidad que se ejecuta
*por delante* del esquema consulta columnas que aún no existen y confía en políticas de RLS
que nadie ha aplicado: lo primero es un error de SQL en una ruta, lo segundo es un
resultado vacío con un código 200. Una unidad que se ejecuta *por detrás* es el estado ordinario de cualquier
despliegue progresivo (rollout) en curso.

### Qué lo comprueba

El proceso que aprovisiona registra la versión del esquema que aplicó en la
base de datos. Cada uno de los demás procesos calcula la suya a partir de las colecciones que cargó y
las compara. En caso de discrepancia, lo notifica mencionando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Advierte y continúa sirviendo, porque durante un despliegue progresivo esa discrepancia es *correcta*:
se espera que las unidades que aún no se han actualizado vayan por detrás. Configure
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` en el
chart) para denegar el arranque en su lugar, en un despliegue que prefiera no servir
en absoluto antes que servir datos incorrectos.

Ambos lados de esa comparación son **calculados**, nunca leídos de un manifiesto. Una
versión que una compilación declara sobre sí misma no es prueba de que la base de datos concuerde
con ella.

Nada comprueba la *dirección*: la versión de un esquema es un hash, por lo que puede indicar que
ambas discrepan, pero nunca cuál va por delante. Esto es lo que convierte el orden de despliegue en una
regla que usted debe seguir en lugar de una que el runtime pueda hacer cumplir.

## Actualización

Sin cambios: cada proceso ejecuta la misma imagen publicada, por lo que una actualización es el mismo
cambio de etiqueta en cada uno de ellos. Actualice la `api` al final si desea que el
aprovisionamiento del esquema ocurra primero contra la nueva versión; aunque en la práctica el
orden no importa, porque el paso del esquema es aditivo e idempotente.

## Relacionado

- [Guía de despliegue](/docs/getting-started/deployment/): el despliegue de un solo proceso que este divide
- [Entorno y configuración](/docs/getting-started/configuration/): `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` y `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/): un despliegue por rol
