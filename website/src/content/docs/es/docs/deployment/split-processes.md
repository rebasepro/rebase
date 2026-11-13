---
sourceHash: f1296ae912e0725e
title: División en varios procesos
sidebar_label: Procesos divididos
description: Ejecute un bundle como varios procesos que cooperan entre sí (una API, un nivel de funciones, un worker) a partir de la misma imagen de runtime publicada, de modo que una función personalizada pesada deje de competir con la API de datos.
---

## Visión general

Un despliegue de Rebase normalmente es un solo proceso que sirve todo: la API de datos,
autenticación, almacenamiento, sus funciones personalizadas, cron y la cola de trabajos. Esa es la estructura
adecuada para casi cualquier despliegue y se mantiene como la opción predeterminada.

Cuando deja de ser la estructura adecuada —una función personalizada que bloquea el event loop,
un nivel de funciones que debería escalar o reiniciarse independientemente de la API—, puede
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
| `/api/admin` (registros y el editor de esquemas incluidos) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | reenvía (ver más abajo) | ✅ | — |
| `/api/admin/cron` (la superficie de administración) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sirve websockets, consume eventos de cambio | ✅ | ✅ | — | — |
| Crea el esquema al iniciar | ✅ | ✅ | — | — |
| Ejecuta el programador de cron | ✅ | ✅ | — | ✅ |
| Ejecuta los workers de la cola de trabajos | ✅ | ✅ | — | ✅ |

El estado de salud (health) y las métricas están en todos los roles sin excepción; `/metrics` responde únicamente con `REBASE_METRICS=true`. Un proceso que
un orquestador no puede sondear es un proceso que no puede desplegar gradualmente.

`GET /api/auth/config`,
lo que lee la pantalla de inicio de sesión, sigue al resto de `/api/auth`: solo `api` y
`all` lo sirven.

Realtime está en la lista porque tiene un costo independientemente de si alguien lo usa
o no: un proceso que consume eventos de cambio mantiene una conexión `LISTEN` fuera
del pool durante todo el tiempo que se ejecuta e instala los disparadores (triggers) de captura al iniciar. Solo
un proceso que sirve websockets tiene a quién entregar eventos, por lo que los dos roles que no
sirven ninguno no hacen ninguna de las dos cosas. **Las escrituras realizadas por esos procesos se siguen escuchando.** Con
la captura de cambios activada, la captura se realiza mediante triggers de base de datos, por lo que un cambio es publicado por
la base de datos en lugar de por el proceso que lo realizó. Con la captura desactivada
(`REALTIME_CDC=off`, o con `auto` recurriendo al fallback porque el rol de la base de datos no puede
crear triggers), un proceso `worker` o `functions` anuncia cada una de sus propias
escrituras en el canal entre instancias, sin mantener una conexión `LISTEN`.
De cualquier manera, una función que escribe una fila sigue despertando a cada
suscriptor en la `api`.

Asigne a cada proceso el mismo valor de `REALTIME_CDC`. Un proceso propietario del esquema
con `REALTIME_CDC=off` elimina los triggers de captura al iniciar, y una `api`
que todavía esté configurada en `auto` escucharía cambios que nadie anuncia.

## Docker Compose

Dos servicios a partir de una sola imagen, un bundle y una base de datos:

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
`REBASE_SERVICE_KEY`; son un solo despliegue, y un token emitido por uno debe
ser aceptado por el otro. Un proceso con `REBASE_FUNCTIONS_UPSTREAM` y sin
`REBASE_SERVICE_KEY` se negará a iniciar: sus propias llamadas a `rebase.functions.invoke(...)`,
desde un hook o un trabajo de cron, llegan al proceso de funciones con esa clave.

## Mantener las mismas URLs

`REBASE_FUNCTIONS_UPSTREAM` le indica al proceso `api` que reenvíe `/api/functions/*`
al proceso de funciones en lugar de servirlo. Debe ser una URL `http://` o
`https://`; cualquier otra cosa detendrá el inicio. Solo `api` y `worker` lo leen
(consulte [Cron y trabajos en segundo plano](#cron-y-trabajos-en-segundo-plano) para el worker). Los clientes, los SDK generados y las claves
de API ven exactamente la misma superficie que veían antes de la división, por lo que ningún código de la aplicación
cambia y no es necesario levantar un proxy inverso para probarlo.

Un despliegue en producción puede preferir enrutar la ruta en su ingress; en tal
caso, deje `REBASE_FUNCTIONS_UPSTREAM` sin configurar: el proceso `api`
responderá 404 para esas rutas y el proxy que esté por delante decidirá a dónde van.

### Saltos de proxy

Cuando la API reenvía, añade la dirección del emisor a `X-Forwarded-For`. Eso
hace que el proceso de funciones se encuentre detrás de **un salto de proxy más**
que la API, y se le debe indicar:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` es el número de proxies inversos que realmente ejecuta delante
de un proceso. Cada uno añade la dirección que vio a `X-Forwarded-For`, por lo que el
cliente real es la enésima entrada desde la derecha; todo lo que esté más a la izquierda es
proporcionado por el cliente y se ignora, lo que evita que un emisor falsifique la cabecera para
rotar las claves de límite de tasa. Por defecto es `0`: ningún proxy es de confianza.

Si se equivoca en esto, nada fallará de forma visible: los limitadores de tasa en el proceso de funciones
asociarán cada solicitud a la dirección del contenedor de la API, por lo que todos sus clientes compartirán un
mismo bucket, y la IP registrada en cada evento de autenticación será la misma.

## Un solo proceso es propietario del esquema

Exactamente un proceso en un despliegue dividido crea tablas y aplica políticas RLS
al iniciar, y ese es el proceso `api` (o `all`). Cualquier otro proceso debe
configurar:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Esto es **obligatorio**, no opcional: un proceso `functions` o `worker` con el valor por
defecto se negará a iniciar, e indicará el motivo. `CREATE … IF NOT EXISTS` lee el catálogo
y luego escribe en él en dos pasos separados, por lo que los procesos que inician juntos
colisionan; y un despliegue donde varios de ellos compiten para aprovisionar el mismo
esquema no es algo diseñado para funcionar.

En un
[servidor personalizado](/docs/backend/custom-server/), la misma decisión corresponde a la
opción `provision` de `createRebaseBackend`: `true` en el proceso propietario del
esquema, y `{ collections: false, realtime: false }` en todos los demás, lo que
conserva las tablas propias del framework. `REBASE_MIGRATE_ON_BOOT=none` desactiva el
esquema de tablas allí también. El trabajo en segundo plano se decide de la misma manera:
un proceso que nunca llama a `start()` no ejecuta ningún programador de cron ni workers de trabajos,
y uno que sí lo hace ejecuta aquellos que su opción `ownership` le asigne.

## Servir una función por proceso

Un proceso puede servir un subconjunto específico por nombre, que es cómo una función costosa obtiene su
propio número de réplicas sin mover su código a ninguna parte:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Los nombres corresponden a los nombres de archivo sin la extensión, el mismo nombre bajo el cual está montada
la función. Un nombre que el bundle no contenga **hace fallar el inicio**, y el error lista
los nombres que sí contiene. Un proceso configurado para una sola función existe para esa
función, por lo que un error tipográfico que silenciosamente no sirviera nada sería el peor resultado
posible.

## Cron y trabajos en segundo plano

Ambos ya son seguros para ejecutarse en más de un proceso: el programador de cron reclama
cada par `(job, slot)` en la base de datos, y la cola de trabajos reclama filas con
`FOR UPDATE SKIP LOCKED`. Por lo tanto, `api` sigue ejecutando ambos por defecto y una división en dos
servicios queda completa sin necesidad de un tercer contenedor.

Añada un proceso `worker` cuando desee que el trabajo programado quede fuera de la ruta de solicitudes (request path) y
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
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      # Only if a job calls rebase.functions:
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
```

Un trabajo que se traslada a un worker conserva `rebase.dataAsAdmin`, `rebase.sql`,
`rebase.storage` y `rebase.email`, los cuales se comunican directamente con la base de datos, los buckets y
el servidor de correo. También conserva:

- **`rebase.admin`** (usuarios, roles, restablecimientos de contraseña) **y `rebase.cron`.** Un
  worker no sirve ninguna superficie de administración en su puerto, pero mantiene ambos en el proceso,
  únicamente para sus propios trabajos.
- **`rebase.functions`, con `REBASE_FUNCTIONS_UPSTREAM`.** Un worker no sirve
  funciones. Con el upstream configurado, sus propias llamadas a `rebase.functions.invoke(...)`
  se reenvían al proceso de funciones, donde la función ve la llamada
  como el servicio. El worker sigue sin responder a nada bajo `/api/functions`
  en su puerto. El worker necesita la `REBASE_SERVICE_KEY` del despliegue para esto,
  al igual que la `api`.

Pierde `rebase.auth`: esos son los flujos de inicio de sesión de los usuarios, y un worker
no sirve ninguno. Para operaciones de cuentas desde un trabajo, use `rebase.admin`. También pierde el
resto de la API de administración (copias de seguridad, registros, el editor de esquemas, etc.) y
`rebase.functions` cuando no se configura un upstream. Cualquier llamada a estos responderá
con `404 NOT_FOUND` indicando la superficie desactivada y qué hacer en su lugar.

Un proceso `functions` nunca ejecuta ninguno de los dos. Se escala según la carga de solicitudes y se
reemplaza a voluntad, y asignarle trabajo programado haría que su número de réplicas signifique
algo que no debería.

Tenga en cuenta que encolar (`jobQueue.enqueue`, el `enqueue` de una cola declarada, el
`publish` de un topic) sigue funcionando en todas partes, incluso en un proceso que no
ejecuta workers: encolar es una escritura, ejecutar es un bucle de sondeo (poll loop), y solo
esto último es lo que un rol desactiva.

## Lo que la división no le proporciona

**Límites de tasa compartidos, a menos que los solicite.** El almacenamiento por defecto es por proceso, por lo que N
procesos multiplican el límite permitido de cada emisor por N sin que ningún registro lo advierta. Configure
`REBASE_RATE_LIMIT_STORE=sql` en cada proceso que sirva HTTP: realiza el conteo en Postgres, por lo que
el límite se mantiene sin importar cuántas réplicas existan. (El Helm chart lo configura por usted y se niega a renderizar una topología
de múltiples procesos que lo deje en `memory`).

**Canales entre instancias.** Broadcast y presence utilizan por defecto un bus en memoria,
el cual no cruza procesos. Esta es una cuestión del *número de réplicas*
más que de la división en sí (se aplica igualmente a un despliegue de un solo rol
escalado a tres réplicas), por lo que debe configurar `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` en
la configuración) siempre que más de un proceso sirva websockets.

**Escalado a cero.** Nada de lo aquí descrito reduce un proceso a cero ni lo inicia
bajo demanda. Esa es una capacidad de la plataforma, no del runtime.

Todo lo demás que un proceso mantiene aislado para sí mismo se encuentra en una lista:
[Ejecución de más de una instancia](/docs/deployment/multiple-instances/).

## Publicar una unidad por separado

Todo lo anterior divide *dónde se ejecuta el trabajo*. Todo se sigue enviando como una
sola build: una imagen, un bundle, desplegados juntos. Esa es la opción predeterminada adecuada, y
la mayoría de los despliegues deberían mantenerse así.

Una unidad también puede mantenerse en su propia compilación (build), por ejemplo, una corrección en una función que no
reinicia la API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.30.1"     # this unit only; the rest stay on the release-wide tag
```

Normalmente, solo vale la pena fijar el tag: el repositorio se hereda, por lo que se trata de
un solo proyecto y una sola imagen con una unidad modificada. `bundleUrl` cumple la misma función
cuando `bundle.mode: url`.

### La regla

Dos unidades en builds diferentes son dos conjuntos de tablas frente a **una**
base de datos, y solo una unidad la aprovisiona. Por lo tanto:

> **La unidad propietaria del esquema se despliega primero. Una unidad puede quedar rezagada;
> nunca debe adelantarse.**

Ese es el Job de migración, o la `api` cuando el Job está desactivado. Una unidad que se ejecuta
*por delante* del esquema consulta columnas que aún no existen y depende de políticas RLS
que nadie aplicó: lo primero es un error de SQL en una ruta, lo segundo es un
resultado vacío con un código 200. Una unidad que se ejecuta *por detrás* es el estado habitual de cualquier
despliegue progresivo en curso.

### Qué lo comprueba

El proceso que aprovisiona registra en la base de datos la versión del esquema que aplicó.
Todos los demás procesos calculan la suya a partir de las tablas que cargaron y
la comparan. En caso de discrepancia, lo indican mostrando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Muestra una advertencia y sigue sirviendo solicitudes, porque durante un despliegue progresivo esa discrepancia es *correcta*:
se supone que las unidades que aún no se han actualizado deben estar rezagadas. Configure
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` en el
chart) para rechazar el inicio, en un despliegue que prefiera no servir
nada antes que servir datos incorrectos.

Ambos lados de esa comparación son **calculados**, nunca leídos de un manifiesto. Una
versión que una build declara sobre sí misma no es prueba de que la base de datos coincida
con ella.

Nada comprueba la *dirección*: una versión de esquema es un hash, por lo que puede indicar que
ambos difieren, pero nunca cuál va por delante. Por eso, el orden del despliegue es una
regla que usted debe seguir en lugar de una que el runtime pueda hacer cumplir.

## Actualización

Sin cambios: cada proceso ejecuta la misma imagen publicada, por lo que una actualización consiste en el mismo
cambio de tag en cada uno de ellos. Despliegue primero el proceso propietario del esquema (la `api`
o el Job de migración), para que el esquema de la nueva versión esté listo antes de
que los demás procesos se ejecuten contra él: una unidad puede quedar rezagada, nunca adelantarse (consulte
[La regla](#la-regla)).

## Relacionado

- [Guía de despliegue](/docs/getting-started/deployment/) — el despliegue de un solo proceso que este divide
- [Entorno y configuración](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` y `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un despliegue por rol
