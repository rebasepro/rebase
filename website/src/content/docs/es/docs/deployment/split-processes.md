---
title: Dividir en varios procesos
sidebar_label: Procesos divididos
description: "Ejecuta un bundle como varios procesos que cooperan entre sí — una API, una capa de funciones, un worker — desde la misma imagen de runtime publicada, para que una función personalizada pesada deje de competir con la API de datos."
---

## Descripción general

Un despliegue de Rebase es normalmente un único proceso que sirve todo: la API de
datos, la autenticación, el almacenamiento, tus funciones personalizadas, el cron
y la cola de trabajos. Esa es la forma correcta para casi cualquier despliegue y
sigue siendo la predeterminada.

Cuando deja de serlo — una función personalizada que bloquea el bucle de eventos,
o una capa de funciones que debería escalar o reiniciarse independientemente de la
API — puedes arrancar **la misma imagen y el mismo bundle** varias veces y hacer
que cada proceso sirva una parte distinta del proyecto. No hay nada nuevo que
construir ni nada que el cliente deba saber: las URLs no cambian.

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
| `/api/admin`, `/api/logs`, el editor de esquema | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | reenvía (ver abajo) | ✅ | — |
| `/api/cron` (la superficie de administración) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sirve websockets, consume eventos de cambio | ✅ | ✅ | — | — |
| Crea el esquema al arrancar | ✅ | ✅ | — | — |
| Ejecuta el planificador de cron | ✅ | ✅ | — | ✅ |
| Ejecuta los workers de la cola de trabajos | ✅ | ✅ | — | ✅ |

Las métricas y el health están en todos los roles sin excepción. Un proceso que
un orquestador no puede sondear es un proceso que no puede desplegar.

El realtime está en la lista porque cuesta algo lo use alguien o no: un proceso
que consume eventos de cambio mantiene abierta una conexión `LISTEN` fuera del
pool mientras viva, e instala los triggers de captura al arrancar. Solo un
proceso que sirve websockets tiene a quién entregar, así que los dos roles que no
sirven ninguno no hacen ni lo uno ni lo otro. **Las escrituras hechas por esos
procesos se siguen oyendo**: la captura son triggers de base de datos, de modo
que un cambio lo publica la base de datos y no el proceso que lo hizo. Una
función que escribe una fila sigue despertando a todos los suscriptores del
`api`.

## Docker Compose

Dos servicios desde una imagen, un bundle y una base de datos:

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

Ambos procesos necesitan el mismo `DATABASE_URL`, el mismo `JWT_SECRET` y la
misma `REBASE_SERVICE_KEY`: son un único despliegue, y un token emitido por uno
tiene que ser aceptado por el otro.

## Mantener las mismas URLs

`REBASE_FUNCTIONS_UPSTREAM` le dice al proceso `api` que reenvíe
`/api/functions/*` al proceso de funciones en lugar de servirlo. Los clientes,
los SDK generados y las claves de API ven exactamente la misma superficie que
antes de la división, así que no cambia ningún código de aplicación y no hace
falta levantar un proxy inverso para probarlo.

Un despliegue en producción puede preferir enrutar esa ruta en su ingress; en ese
caso deja `REBASE_FUNCTIONS_UPSTREAM` sin definir — el proceso `api` responderá
404 en esas rutas y el proxy que tienes delante decidirá a dónde van.

### Saltos de proxy

Cuando la API reenvía, añade la dirección del llamante a `X-Forwarded-For`. Eso
hace que el proceso de funciones esté detrás de **un salto de proxy más** que la
API, y hay que decírselo:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` es el número de proxies inversos que realmente tienes
delante de un proceso. Cada uno añade la dirección que vio a `X-Forwarded-For`,
de modo que el cliente real es la N-ésima entrada desde la derecha; todo lo que
está más a la izquierda lo proporciona el cliente y se ignora, que es lo que
impide falsificar la cabecera para rotar las claves del limitador. Por defecto
es `0`: ningún proxy es de confianza.

Si te equivocas aquí no se rompe nada visible: los limitadores del proceso de
funciones asignan todas las peticiones a la dirección del contenedor de la API,
así que todos tus llamantes comparten un mismo cubo, y la IP registrada en cada
evento de autenticación es siempre la misma.

## Un solo proceso es dueño del esquema

Exactamente un proceso de un despliegue dividido crea las tablas y aplica las
políticas RLS al arrancar, y ese es el `api` (o el `all`). Todos los demás
procesos deben definir:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Esto es **obligatorio**, no un consejo: un proceso `functions` o `worker` que se
quede con el valor por defecto se niega a arrancar, y lo dice. `CREATE … IF NOT
EXISTS` lee el catálogo y luego escribe en él en dos pasos separados, así que los
procesos que arrancan a la vez sí colisionan — y un despliegue donde varios
compiten por crear el mismo esquema no es uno que nadie haya diseñado.

## Servir una función por proceso

Un proceso puede servir un subconjunto con nombre, que es como una función cara
consigue su propio número de réplicas sin que su código se mueva a ningún sitio:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Los nombres son nombres de archivo sin la extensión, el mismo nombre bajo el que
se monta la función. Un nombre que el bundle no contiene **hace fallar el
arranque**, y el error enumera los nombres que sí contiene. Un proceso
configurado para una función existe para esa función, así que una errata que
sirviera silenciosamente nada sería el peor resultado posible.

## Cron y trabajos en segundo plano

Ambos ya son seguros en más de un proceso: el planificador de cron reclama cada
par `(job, slot)` en la base de datos, y la cola de trabajos reclama filas con
`FOR UPDATE SKIP LOCKED`. Por eso `api` sigue ejecutando ambos por defecto y una
división en dos servicios está completa sin un tercer contenedor.

Añade un proceso `worker` cuando quieras sacar el trabajo programado de la ruta
de peticiones, y desactívalo en la API:

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

Un proceso `functions` nunca ejecuta ninguno de los dos. Escala según la carga de
peticiones y se reemplaza en cualquier momento, y darle trabajo programado haría
que su número de réplicas significara algo que no debería.

Ten en cuenta que `rebase.jobs.enqueue` sigue funcionando en todas partes,
incluso en un proceso que no ejecuta workers: encolar es una escritura, ejecutar
es un bucle de sondeo, y solo lo segundo es lo que desactiva un rol.

## Lo que dividir no te da

**Límites de tasa compartidos.** El almacén del limitador es por proceso por
defecto, así que N procesos multiplican por N la asignación de cada llamante.
Pon `REBASE_RATE_LIMIT_STORE=sql` en cada proceso que sirva HTTP: cuenta en
Postgres, así que el límite es el límite haya las réplicas que haya. (El chart de
Helm lo pone por ti y se niega a renderizar una topología de varios procesos que
lo deje en `memory`.)

**Canales entre instancias.** El broadcast y la presencia usan un bus en memoria
por defecto, que no cruza procesos. Esto es una cuestión de *número de réplicas*
más que de división — es igual de cierto en un despliegue de un solo rol escalado
a tres — así que define `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` en la
configuración) siempre que más de un proceso sirva websockets.

**Escalar a cero.** Nada de esto reduce un proceso a nada ni lo levanta bajo
demanda. Eso es una capacidad de la plataforma, no del runtime.

## Publicar una unidad por su cuenta

Todo lo anterior reparte *dónde* corre el trabajo. Todo ello se sigue publicando
como una sola build: una imagen, un bundle, desplegados juntos. Ese es el valor
por defecto correcto, y la mayoría de los despliegues deberían quedarse ahí.

Una unidad también puede quedarse en una build propia — un arreglo en una función
que no reinicia la API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.17.3"     # solo esta unidad; el resto sigue en el tag del release
```

Normalmente solo merece la pena fijar el tag: el repositorio se hereda, así que
es un proyecto y una imagen con una unidad movida. `bundleUrl` hace lo mismo
cuando `bundle.mode: url`.

### La regla

Dos unidades en builds distintas son dos conjuntos de colecciones contra **una**
base de datos, y solo una unidad la aprovisiona. Por tanto:

> **La unidad dueña del esquema se despliega primero. Una unidad puede ir por
> detrás; nunca por delante.**

Es el Job de migración, o la `api` cuando el Job está apagado. Una unidad que va
*por delante* del esquema consulta columnas que aún no existen y depende de
políticas RLS que nadie aplicó — lo primero es un error SQL en una ruta, lo
segundo un resultado vacío con un 200. Una unidad que va *por detrás* es el
estado normal de cualquier despliegue en curso.

### Qué lo comprueba

El proceso que aprovisiona registra en la base de datos la versión de esquema que
aplicó. Cualquier otro proceso calcula la suya a partir de las colecciones que
cargó y compara. Ante una discrepancia lo dice, nombrando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Avisa y sirve, porque durante un despliegue esa discrepancia es *correcta*: las
unidades que aún no se han desplegado deben ir por detrás. Pon
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` en el
chart) para que rechace el arranque, en un despliegue que prefiere no servir a
servir mal.

Ambos lados de esa comparación se **calculan**, nunca se leen de un manifiesto.
Una versión que una build afirma sobre sí misma no prueba que la base de datos
esté de acuerdo.

Nada comprueba la *dirección* — una versión de esquema es un hash, puede decir
que las dos difieren pero nunca cuál va por delante. Por eso el orden del
despliegue es una regla que sigues, no una que el runtime pueda imponer.

## Actualizar

Sin cambios: todos los procesos ejecutan la misma imagen publicada, así que
actualizar es el mismo cambio de etiqueta en cada uno. Despliega `api` el último
si quieres que el aprovisionamiento del esquema ocurra primero contra la nueva
versión — aunque en la práctica el orden no importa, porque el paso del esquema
es aditivo e idempotente.
