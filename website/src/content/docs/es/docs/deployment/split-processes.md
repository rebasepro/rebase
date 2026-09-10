---
sourceHash: ce7486bb141920aa
title: División en varios procesos
sidebar_label: Procesos divididos
description: Ejecuta un único bundle como varios procesos cooperativos —una API, una capa de funciones, un worker— a partir de la misma imagen de runtime publicada, para que una función personalizada pesada deje de competir con la API de datos.
---

## Descripción general

Un despliegue de Rebase normalmente es un único proceso que sirve todo: la API de datos,
autenticación, almacenamiento, tus funciones personalizadas, cron y la cola de trabajos. Esa es la
estructura adecuada para casi cualquier despliegue y sigue siendo la opción predeterminada.

Cuando deja de ser la estructura adecuada —una función personalizada que satura el bucle de eventos,
una capa de funciones que debería escalar o reiniciarse independientemente de la API— puedes
iniciar **la misma imagen y el mismo bundle** varias veces y hacer que cada
proceso sirva una parte diferente del proyecto. No hay nada nuevo que compilar ni
nada que el cliente deba saber: las URLs no cambian.

Una variable de entorno decide qué es cada proceso:

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
| `/api/functions/*` | ✅ | reenvía (ver más abajo) | ✅ | — |
| `/api/cron` (la superficie de administración) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sirve websockets, consume eventos de cambio | ✅ | ✅ | — | — |
| Crea el esquema al iniciar | ✅ | ✅ | — | — |
| Ejecuta el programador de cron | ✅ | ✅ | — | ✅ |
| Ejecuta workers de la cola de trabajos | ✅ | ✅ | — | ✅ |

Health y metrics están en todos los roles sin excepción. Un proceso que un
orquestador no puede sondear es un proceso que no puede actualizar gradualmente.

Realtime está en la lista porque tiene un coste, lo use alguien o no:
un proceso que consume eventos de cambio mantiene una conexión `LISTEN` fuera
del pool mientras esté en ejecución e instala los triggers de captura al iniciar. Solo
un proceso que sirve websockets tiene destinatarios a los que entregar datos, por lo que los dos roles que
no sirven ninguno no hacen ninguna de las dos cosas. **Las escrituras realizadas por esos procesos se siguen escuchando**: la
captura se basa en triggers de base de datos, por lo que el cambio lo publica la base de datos en lugar
del proceso que lo realizó. Una función que escribe una fila sigue despertando a
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
`REBASE_SERVICE_KEY`: forman un único despliegue, y un token emitido por uno debe
ser aceptado por el otro.

## Mantener las URLs iguales

`REBASE_FUNCTIONS_UPSTREAM` le indica al proceso `api` que reenvíe `/api/functions/*`
al proceso de funciones en lugar de servirlo. Los clientes, los SDKs generados y las claves
de API ven exactamente la misma superficie que veían antes de la división, por lo que ningún código de aplicación
cambia y no tienes que levantar un proxy inverso para probarlo.

Es posible que un despliegue en producción prefiera enrutar la ruta en su ingress; en
ese caso, deja `REBASE_FUNCTIONS_UPSTREAM` sin definir: el proceso `api` responderá
con 404 para esas rutas y el proxy que esté delante decidirá a dónde van.

### Saltos de proxy

Cuando la API reenvía, añade la dirección del emisor a `X-Forwarded-For`. Eso
hace que el proceso de funciones se encuentre detrás de **un salto de proxy más**
que la API, y es necesario indicárselo:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` es el número de proxys inversos que realmente ejecutas delante
de un proceso. Cada uno añade la dirección que vio a `X-Forwarded-For`, por lo que el
cliente real es la N-ésima entrada desde la derecha; todo lo que esté más a la izquierda es
proporcionado por el cliente y se ignora, lo que evita que un emisor falsifique la cabecera para
rotar las claves de límite de tasa. Por defecto es `0`: ningún proxy es de confianza.

Si configuras esto mal, nada se romperá de forma visible: los limitadores de tasa en el proceso de funciones
asociarán cada solicitud a la dirección del contenedor de la API, por lo que todos tus emisores compartirán
el mismo bucket, y la IP registrada en cada evento de autenticación será la misma.

## Un solo proceso es propietario del esquema

Exactamente un proceso en un despliegue dividido crea las tablas y aplica las
políticas RLS al iniciar, y ese es el de la `api` (o `all`). Todos los demás procesos deben
configurar:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Esto es **obligatorio**, no una recomendación: un proceso `functions` o `worker` que mantenga
el valor por defecto se negará a iniciar, y mostrará un mensaje indicándolo. `CREATE … IF NOT EXISTS` lee el catálogo
y luego escribe en él en dos pasos separados, por lo que los procesos que arrancan al mismo tiempo sí
colisionan; y un despliegue donde varios compiten en una carrera por aprovisionar el mismo
esquema no es algo diseñado por nadie.

## Servir una función por proceso

Un proceso puede servir un subconjunto con nombre específico, que es la forma en que una función costosa
obtiene su propio número de réplicas sin mover su código a ninguna parte:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Los nombres son los nombres de archivo sin la extensión, el mismo nombre bajo el cual está montada
la función. Un nombre que el bundle no contenga **hace fallar el arranque**, y el error lista
los nombres que sí contiene. Un proceso configurado para una función existe para esa
función, por lo que una errata que silenciosamente no sirviera nada sería el peor resultado
posible.

## Cron y trabajos en segundo plano

Ambos ya son seguros para ejecutarse en más de un proceso: el programador de cron reclama
cada par `(job, slot)` en la base de datos, y la cola de trabajos reclama filas con
`FOR UPDATE SKIP LOCKED`. Por lo tanto, `api` sigue ejecutando ambos por defecto y una división en
dos servicios queda completa sin necesidad de un tercer contenedor.

Añade un proceso `worker` cuando quieras sacar el trabajo programado de la ruta de solicitudes,
y desactívalo en la API:

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

Un proceso `functions` nunca ejecuta ninguno de los dos. Se escala según la carga de solicitudes y
se reemplaza a voluntad, y asignarle trabajo programado haría que su número de réplicas signifique
algo que no debería.

Ten en cuenta que `rebase.jobs.enqueue` sigue funcionando en todas partes, incluso en un proceso
que no ejecuta workers: encolar es una escritura, ejecutar es un bucle de sondeo, y solo
esto último es lo que desactiva un rol.

## Lo que la división no te da

**Límites de tasa compartidos, a menos que lo solicites.** El almacenamiento predeterminado es por proceso, por lo que N
procesos multiplican la cuota de cada emisor por N sin que ningún registro lo indique.
Establece `REBASE_RATE_LIMIT_STORE=sql` en cada proceso que sirva HTTP: realiza el recuento en Postgres,
por lo que el límite es el límite sin importar cuántas réplicas existan.
(El Helm chart lo configura por ti y se niega a renderizar una topología multiproceso
que lo deje en `memory`).

**Canales entre instancias.** Broadcast y presence utilizan un bus en memoria por
defecto, el cual no cruza procesos. Esta es una cuestión del *número de réplicas*
más que de división —es igualmente cierto para un despliegue de un solo rol
escalado a tres—, así que establece `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` en
la configuración) siempre que más de un proceso sirva websockets.

**Escalado a cero.** Nada de esto reduce un proceso a cero ni levanta uno bajo demanda.
Esa es una capacidad de la plataforma, no del runtime.

## Lanzar una unidad de forma independiente

Todo lo anterior divide *dónde se ejecuta el trabajo*. Todo se sigue distribuyendo como una
sola build: una imagen, un bundle, desplegados juntos en rollout. Ese es el valor predeterminado correcto, y
la mayoría de los despliegues deberían mantenerse así.

Una unidad también puede mantenerse en una build propia: por ejemplo, una corrección en una función
que no reinicia la API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

Por lo general, solo vale la pena fijar la etiqueta: el repositorio se hereda, por lo que este es
un proyecto y una imagen con una sola unidad modificada. `bundleUrl` hace lo mismo
cuando `bundle.mode: url`.

### La regla

Dos unidades en builds diferentes son dos conjuntos de colecciones contra **una**
base de datos, y solo una unidad la aprovisiona. Por lo tanto:

> **La unidad que posee el esquema se despliega primero. Una unidad puede quedarse atrás;
> nunca debe ir por delante.**

Ese es el Job de migración, o la `api` cuando el Job está desactivado. Una unidad que se ejecuta
*por delante* del esquema consulta columnas que aún no existen y depende de políticas RLS
que nadie ha aplicado; lo primero es un error SQL en una ruta, lo segundo es un
resultado vacío con código 200. Una unidad que se ejecuta *por detrás* es el estado habitual de cualquier
rollout en curso.

### Qué lo comprueba

El proceso que aprovisiona registra en la base de datos la versión del esquema que aplicó.
Todos los demás procesos calculan la suya a partir de las colecciones que cargaron y
las comparan. En caso de discrepancia, lo notifica mencionando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Advierte y continúa sirviendo, porque durante un rollout esa discrepancia es *correcta*:
se supone que las unidades que aún no se han desplegado están por detrás. Establece
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` en el
chart) para rechazar el arranque en su lugar, en un despliegue que prefiera no servir
nada antes que servir datos incorrectos.

Ambos lados de esa comparación son **calculados**, nunca leídos de un manifiesto. Una
versión que una build declara sobre sí misma no es evidencia de que la base de datos coincida
con ella.

Nada comprueba la *dirección*: una versión de esquema es un hash, por lo que puede indicar que
ambos discrepan, pero nunca cuál va por delante. Eso es lo que hace que el orden del rollout sea una
regla que tú debes seguir en lugar de una que el runtime pueda hacer cumplir.

## Actualización

Sin cambios: cada proceso ejecuta la misma imagen publicada, por lo que una actualización es el
mismo cambio de etiqueta en cada uno de ellos. Despliega la `api` en último lugar si deseas que el
aprovisionamiento del esquema se realice primero contra la nueva versión, aunque en la práctica el
orden no importa, ya que el paso del esquema es aditivo e idempotente.

## Relacionado

- [Guía de despliegue](/docs/getting-started/deployment/) — el despliegue de un solo proceso que este divide
- [Entorno y configuración](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` y `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un deployment por rol

---
