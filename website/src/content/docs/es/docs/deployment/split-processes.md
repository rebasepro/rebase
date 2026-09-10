---
sourceHash: 1268d4bf9843a74b
title: División en varios procesos
sidebar_label: Procesos divididos
description: Ejecuta un bundle como varios procesos cooperativos (una API, una capa de funciones, un worker) a partir de la misma imagen de runtime publicada, para que una función personalizada pesada deje de competir con la API de datos.
---

## Descripción general

Una implementación de Rebase normalmente es un solo proceso que sirve todo: la API de datos,
autenticación, almacenamiento, tus funciones personalizadas, cron y la cola de trabajos. Esa es la estructura
adecuada para casi cualquier implementación y sigue siendo la predeterminada.

Cuando deja de ser la estructura adecuada —una función personalizada que bloquea el event loop,
una capa de funciones que debería escalar o reiniciarse independientemente de la API—, puedes
iniciar **la misma imagen y el mismo bundle** varias veces y hacer que cada
proceso sirva una parte diferente del proyecto. No hay nada nuevo que compilar y
nada de lo que un cliente deba enterarse: las URLs no cambian.

Una variable de entorno decide qué es un proceso:

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
| Crea el esquema al iniciar | ✅ | ✅ | — | — |
| Ejecuta el programador de cron | ✅ | ✅ | — | ✅ |
| Ejecuta workers de la cola de trabajos | ✅ | ✅ | — | ✅ |

El estado de salud (health) y las métricas están en todos los roles sin excepción. Un proceso que
un orquestador no puede sondear es un proceso que no puede actualizar de forma progresiva.

Realtime está en la lista porque tiene un coste, lo use alguien o no: un proceso
que consume eventos de cambio mantiene una conexión `LISTEN` fuera del pool durante
todo el tiempo que se ejecuta, e instala los disparadores (triggers) de captura al iniciar. Solo
un proceso que sirve websockets tiene destinatarios a los que entregar datos, por lo que los dos roles que
no sirven ninguno no hacen ninguna de las dos cosas. **Las escrituras realizadas por esos procesos se siguen escuchando**:
la captura se realiza mediante triggers de base de datos, por lo que los cambios son publicados por la base de datos
en lugar de por el proceso que los haya originado. Una función que escribe una fila sigue despertando a
cada suscriptor en la `api`.

## Docker Compose

Dos servicios a partir de una imagen, un bundle y una base de datos:

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
`REBASE_SERVICE_KEY`: forman una sola implementación, y un token emitido por uno debe
ser aceptado por el otro.

## Mantener las mismas URLs

`REBASE_FUNCTIONS_UPSTREAM` le indica al proceso `api` que reenvíe `/api/functions/*`
al proceso de funciones en lugar de servirlo. Los clientes, los SDK generados y las claves de
API ven exactamente la misma superficie que veían antes de la división, por lo que no hay cambios en el código de
la aplicación y no necesitas levantar un proxy inverso para probarlo.

Una implementación en producción puede preferir enrutar la ruta en su ingress; en
ese caso, deja `REBASE_FUNCTIONS_UPSTREAM` sin definir: el proceso `api`
responderá 404 para esas rutas y el proxy que esté delante decidirá adónde van.

### Saltos de proxy

Cuando la API reenvía, añade la dirección del emisor a `X-Forwarded-For`. Esto
hace que el proceso de funciones se encuentre detrás de **un salto de proxy más**
que la API, y se le debe indicar:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` es el número de proxys inversos que realmente ejecutas delante
de un proceso. Cada uno añade la dirección que vio a `X-Forwarded-For`, por lo que
el cliente real es la N-ésima entrada empezando por la derecha; todo lo que esté más a la izquierda es
proporcionado por el cliente y se ignora, lo que evita que un emisor falsifique la cabecera para
rotar las claves de limitación de tasa (rate limit). Por defecto es `0` (no se confía en ningún proxy).

Si configuras esto mal, nada fallará de forma visible: los limitadores de tasa en el proceso de funciones
asociarán cada petición a la dirección del contenedor de la API, por lo que todos los emisores compartirán
el mismo bucket, y la IP registrada en cada evento de autenticación será la misma.

## Un solo proceso es el propietario del esquema

Exactamente un proceso en una implementación dividida crea tablas y aplica
políticas RLS al iniciar, y ese es el proceso `api` (o `all`). Todos los demás procesos deben
definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Esto es **obligatorio**, no una recomendación: un proceso `functions` o `worker` que mantenga
el valor por defecto se negará a iniciar, y mostrará un mensaje indicándolo. `CREATE … IF NOT EXISTS` lee el catálogo
y luego escribe en él en dos pasos separados, por lo que los procesos que arrancan al mismo tiempo
colisionan, y una implementación donde varios compiten por aprovisionar el mismo
esquema no es algo deseable.

## Servir una función por proceso

Un proceso puede servir un subconjunto específico, que es como una función costosa
obtiene su propio número de réplicas sin mover su código a ninguna otra parte:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Los nombres son los nombres de archivo sin la extensión, el mismo nombre bajo el cual está montada
la función. Un nombre que el bundle no contenga **hará fallar el inicio**, y el error enumerará
los nombres que sí contiene. Un proceso configurado para una sola función existe para esa
función, por lo que un error tipográfico que silenciosamente no sirviera nada sería el peor resultado
posible.

## Cron y trabajos en segundo plano

Ambos son seguros de ejecutar en más de un proceso de manera predeterminada: el programador de cron
reclama cada par `(job, slot)` en la base de datos, y la cola de trabajos reclama filas con
`FOR UPDATE SKIP LOCKED`. Por tanto, `api` sigue ejecutando ambos por defecto y una división de dos
servicios está completa sin necesidad de un tercer contenedor.

Añade un proceso `worker` cuando quieras sacar el trabajo programado de la ruta de peticiones y
desactívalo en la API:

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

Un proceso `functions` nunca ejecuta ninguno de los dos. Se escala en función de la carga de peticiones y
se reemplaza a voluntad, y asignarle trabajo programado haría que su recuento de réplicas
signifique algo que no debería.

Ten en cuenta que `rebase.jobs.enqueue` sigue funcionando en todas partes, incluso en un proceso
que no ejecuta workers: encolar es una escritura, ejecutar es un bucle de sondeo (polling), y solo
lo segundo es lo que desactiva un rol.

## Lo que la división no te proporciona

**Límites de tasa compartidos, a menos que lo solicites.** El almacenamiento predeterminado es por proceso, por lo
que N procesos multiplican la cuota de cada emisor por N sin que ningún registro lo indique.
Establece `REBASE_RATE_LIMIT_STORE=sql` en cada proceso que sirva HTTP: realiza el conteo en
Postgres, por lo que el límite se mantiene sin importar cuántas réplicas haya.
(El chart de Helm lo configura por ti y se niega a renderizar una topología multiproceso
que lo deje en `memory`).

**Canales entre instancias.** Broadcast y presence usan un bus en memoria por
defecto, el cual no cruza procesos. Esta es una cuestión del *número de réplicas*
más que de la división (se aplica por igual a una implementación de un solo rol
escalada a tres), así que establece `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` en
la configuración) siempre que más de un proceso sirva websockets.

**Escalado a cero.** Nada de esto reduce un proceso a cero ni levanta uno
bajo demanda. Esa es una capacidad de la plataforma, no del runtime.

## Desplegar una unidad por separado

Todo lo anterior divide *dónde se ejecuta el trabajo*. Todo se sigue enviando como
una sola compilación (build): una imagen, un bundle, desplegados juntos. Esa es la opción predeterminada adecuada, y
la mayoría de las implementaciones deberían mantenerse así.

Una unidad también puede mantenerse en una compilación propia, por ejemplo, una corrección en una función
que no reinicia la API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

Por lo general, solo vale la pena fijar la etiqueta (tag): el repositorio se hereda, por lo que se trata de
un solo proyecto y una sola imagen con una unidad modificada. `bundleUrl` cumple la misma función
cuando `bundle.mode: url`.

### La regla

Dos unidades en compilaciones distintas representan dos conjuntos de colecciones frente a **una sola**
base de datos, y solo una unidad la aprovisiona. Por lo tanto:

> **La unidad propietaria del esquema se actualiza primero. Una unidad puede quedar rezagada;
> nunca debe ir por delante.**

Esa unidad es el Job de migración, o la `api` cuando el Job está desactivado. Una unidad que se ejecuta
*por delante* del esquema consulta columnas que aún no existen y depende de políticas RLS
que nadie ha aplicado: lo primero es un error de SQL en una ruta, lo segundo es un
resultado vacío con un código 200. Una unidad que se ejecuta *por detrás* es el estado habitual de cualquier
despliegue progresivo en curso.

### Qué lo comprueba

El proceso que aprovisiona registra en la base de datos la versión del esquema que aplicó.
Todos los demás procesos calculan la suya a partir de las colecciones que cargaron y
la comparan. Si hay discrepancias, lo notifican indicando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Advierte y continúa sirviendo, porque durante un despliegue esa discrepancia es *correcta*:
se espera que las unidades que aún no se han actualizado vayan por detrás. Establece
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` en el
chart) para impedir el arranque, en una implementación que prefiera no servir
nada antes que servir datos de forma incorrecta.

Ambos lados de esa comparación se **calculan**, nunca se leen de un manifiesto. La
versión que una compilación declara sobre sí misma no es prueba de que la base de datos coincida
con ella.

Nada comprueba la *dirección*: la versión del esquema es un hash, por lo que puede indicar que
ambos difieren, pero nunca cuál va por delante. Por eso el orden de despliegue es una
regla que debes seguir, más que una regla que el runtime pueda imponer.

## Actualizaciones

Sin cambios: cada proceso ejecuta la misma imagen publicada, por lo que una actualización consiste en el mismo
cambio de tag en cada uno de ellos. Actualiza `api` al final si deseas que el
aprovisionamiento del esquema se realice primero con la nueva versión, aunque en la práctica el
orden no importa, ya que el paso del esquema es aditivo e idempotente.

## Relacionado

- [Guía de despliegue](/docs/getting-started/deployment/) — la implementación de un solo proceso que esta guía divide
- [Entorno y configuración](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` y `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un deployment por rol

---
