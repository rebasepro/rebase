---
sourceHash: f09c52453f45b58d
title: División en varios procesos
sidebar_label: Procesos divididos
description: Ejecute un bundle como varios procesos que cooperan —una API, un nivel de funciones, un worker— desde la misma imagen de runtime publicada, para que una función personalizada pesada deje de competir con la API de datos.
---

## Descripción general

Una implementación de Rebase normalmente es un único proceso que sirve todo: la API de datos,
la autenticación, el almacenamiento, sus funciones personalizadas, cron y la cola de trabajos. Esa es la estructura
adecuada para casi cualquier implementación y sigue siendo la predeterminada.

Cuando deja de ser la estructura adecuada —una función personalizada que satura el event loop,
un nivel de funciones que debería escalar o reiniciarse independientemente de la API— puede
iniciar **la misma imagen y el mismo bundle** varias veces y hacer que cada
proceso sirva una parte diferente del proyecto. No hay nada nuevo que compilar y
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
| `/api/admin` (logs y el editor de esquemas entre ellos) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | reenvía (ver más abajo) | ✅ | — |
| `/api/admin/cron` (la superficie de administración) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sirve websockets, consume eventos de cambio | ✅ | ✅ | — | — |
| Crea el esquema al iniciar | ✅ | ✅ | — | — |
| Ejecuta el programador de cron | ✅ | ✅ | — | ✅ |
| Ejecuta workers de la cola de trabajos | ✅ | ✅ | — | ✅ |

La salud y las métricas están en todos los roles sin excepción; `/metrics` responde solo con `REBASE_METRICS=true`. Un proceso que un
orquestador no puede sondear es un proceso que no puede desplegar de forma progresiva.

`GET /api/auth/config`,
lo que lee la pantalla de inicio de sesión, sigue al resto de `/api/auth`: solo `api` y
`all` lo sirven.

Realtime está en la lista porque tiene un costo, independientemente de si alguien lo usa
o no: un proceso que consume eventos de cambio mantiene una conexión `LISTEN` fuera
del pool durante todo el tiempo que se ejecuta, e instala los triggers de captura al arrancar. Solo
un proceso que sirve websockets tiene destinatarios a los que entregar datos, por lo que los dos roles que
no sirven ninguno no hacen ninguna de las dos cosas. **Las escrituras realizadas por esos procesos aún se escuchan.** Con
la captura de cambios activada, la captura se realiza mediante triggers de base de datos, por lo que la base de datos publica el cambio
en lugar del proceso que lo realizó. Con la captura desactivada
(`REALTIME_CDC=off`, o en `auto` recurriendo al fallback porque el rol de la base de datos no puede
crear triggers), un proceso `worker` o `functions` anuncia cada una de sus propias
escrituras en el canal entre instancias, sin mantener una conexión `LISTEN`.
De cualquier manera, una función que escribe una fila sigue despertando a cada
suscriptor en la `api`.

Asigne a cada proceso el mismo `REALTIME_CDC`. Un proceso que sea propietario del esquema
con `REALTIME_CDC=off` elimina los triggers de captura al arrancar, y una `api`
todavía configurada en `auto` escucharía cambios que nadie anuncia.

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
`REBASE_SERVICE_KEY`; son una única implementación, y un token emitido por uno debe ser
aceptado por el otro. Un proceso con `REBASE_FUNCTIONS_UPSTREAM` y sin
`REBASE_SERVICE_KEY` se negará a arrancar: sus propias llamadas
`rebase.functions.invoke(...)`, desde un hook o una tarea cron,
llegan al proceso de funciones con esa clave.

## Mantener las mismas URLs

`REBASE_FUNCTIONS_UPSTREAM` le indica al proceso `api` que reenvíe `/api/functions/*`
al proceso de funciones en lugar de servirlo. Debe ser una URL `http://` o
`https://`; cualquier otra cosa detiene el inicio. Solo `api` y `worker` lo leen
(consulte [Cron and background jobs](#cron-y-trabajos-en-segundo-plano) para el worker). Los clientes, los SDKs generados y las claves
de API ven exactamente la misma superficie que veían antes de la división, por lo que ningún código de aplicación
cambia y no tiene que configurar un proxy inverso para probarlo.

Una implementación en producción puede preferir enrutar la ruta en su ingress; en
ese caso, deje `REBASE_FUNCTIONS_UPSTREAM` sin definir: el proceso `api`
responderá con 404 para esas rutas y el proxy situado delante decidirá adónde van.

### Saltos de proxy

Cuando la API reenvía, añade la dirección del emisor a `X-Forwarded-For`. Esto
hace que el proceso de funciones se encuentre detrás de **un salto de proxy más**
que la API, y se le debe indicar:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` es la cantidad de proxies inversos que realmente ejecuta delante
de un proceso. Cada uno añade la dirección que vio a `X-Forwarded-For`, por lo que el
cliente real es la N-ésima entrada desde la derecha; todo lo que esté más a la izquierda lo proporciona
el cliente y se ignora, que es lo que impide que un emisor falsifique la cabecera para
rotar las claves de límite de tasa. Su valor predeterminado es `0`: no se confía en ningún proxy.

Si se equivoca en esto, nada fallará de forma visible: los limitadores de tasa en el proceso de funciones
asociarán cada solicitud a la dirección del contenedor de la API, por lo que todos sus emisores compartirán
el mismo bucket, y la IP registrada en cada evento de autenticación será la misma.

## Un proceso es el propietario del esquema

Exactamente un proceso en una implementación dividida crea tablas y aplica políticas RLS
al iniciar, y ese es el de la `api` (o `all`). Todos los demás procesos deben
configurar:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Esto es **obligatorio**, no una sugerencia: un proceso `functions` o `worker` que mantenga
el valor predeterminado se negará a iniciar e indicará el motivo. `CREATE … IF NOT EXISTS` lee el catálogo
y luego escribe en él en dos pasos separados, por lo que los procesos que se inician al mismo tiempo
colisionan; y una implementación donde varios compiten por aprovisionar el mismo
esquema no es algo que nadie haya diseñado.

En un
[servidor personalizado](/docs/backend/custom-server/), la misma decisión corresponde a la
opción `provision` de `createRebaseBackend`: `true` en el proceso propietario del
esquema, y `{ tables: false, realtime: false }` en todos los demás, lo que
aún conserva las tablas propias del framework. `REBASE_MIGRATE_ON_BOOT=none` desactiva el
esquema de tablas allí también. El trabajo en segundo plano se decide de la misma manera:
un proceso que nunca llama a `start()` no ejecuta ningún programador de cron ni workers de tareas,
y uno que sí lo hace ejecuta los que le otorga su opción `ownership`.

## Servir una función por proceso

Un proceso puede servir un subconjunto con nombre, que es cómo una función costosa
obtiene su propio número de réplicas sin mover su código a ninguna parte:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Los nombres son los nombres de archivo sin la extensión, el mismo nombre bajo el cual está montada
la función. Un nombre que el bundle no contenga **hace fallar el arranque**, y el error enumera
los nombres que sí contiene. Un proceso configurado para una sola función existe para esa
función, por lo que un error tipográfico que silenciosamente no sirviera nada sería el peor resultado
posible.

## Cron y trabajos en segundo plano

Ambos ya son seguros de ejecutar en más de un proceso: el programador de cron reclama
cada par `(job, slot)` en la base de datos, y la cola de trabajos reclama filas con
`FOR UPDATE SKIP LOCKED`. Así que `api` sigue ejecutando ambos de forma predeterminada y una
división en dos servicios está completa sin necesidad de un tercer contenedor.

Añada un proceso `worker` cuando desee que el trabajo programado quede fuera de la ruta de solicitudes, y
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
`rebase.storage` y `rebase.email`, que se comunican directamente con la base de datos, los buckets y
el servidor de correo. También conserva:

- **`rebase.admin`** (usuarios, roles, restablecimientos de contraseña) **y `rebase.cron`.** Un
  worker no sirve ninguna superficie de administración en su puerto, pero incluye estos dos en el proceso,
  únicamente para sus propios trabajos.
- **`rebase.functions`, con `REBASE_FUNCTIONS_UPSTREAM`.** Un worker no sirve
  funciones. Con el upstream configurado, sus propias llamadas `rebase.functions.invoke(...)`
  se reenvían al proceso de funciones, donde la función percibe la llamada
  como el servicio. El worker sigue sin responder a nada bajo `/api/functions`
  en su puerto. El worker necesita la `REBASE_SERVICE_KEY` de la implementación para esto,
  al igual que la `api`.

Pierde `rebase.auth`: esos son los flujos de inicio de sesión de personas, y un worker
no sirve ninguno. Para tareas de cuentas desde un trabajo, use `rebase.admin`. También pierde el
resto de la API de administración (copias de seguridad, logs, el editor de esquemas, etc.) y
`rebase.functions` cuando no se ha configurado un upstream. Una llamada a cualquiera de estos responderá con
`404 NOT_FOUND` indicando la superficie que está desactivada y qué hacer en su lugar.

Un proceso `functions` nunca ejecuta ninguno de los dos. Se escala según la carga de solicitudes y se
reemplaza a voluntad, y asignarle trabajo programado haría que su número de réplicas signifique
algo que no debería.

Tenga en cuenta que encolar —`jobQueue.enqueue`, el `enqueue` de una cola declarada, el
`publish` de un topic— sigue funcionando en todas partes, incluso en un proceso que no ejecuta
workers: encolar es una escritura, ejecutar es un bucle de sondeo, y solo
esto último es lo que desactiva un rol.

## Lo que no le proporciona la división

**Límites de tasa compartidos, a menos que lo solicite.** El almacenamiento predeterminado es por proceso, por lo que N
procesos multiplican la cuota permitida de cada emisor por N sin que nada en ningún registro lo
indique. Establezca `REBASE_RATE_LIMIT_STORE=sql` en cada proceso que sirva HTTP: realiza el
conteo en Postgres, por lo que el límite sigue siendo el límite independientemente de cuántas réplicas existan.
(El chart de Helm lo configura por usted y se niega a renderizar una topología multiproceso
que lo deje en `memory`).

**Canales entre instancias.** Broadcast y presence utilizan un bus en memoria de
forma predeterminada, el cual no cruza procesos. Esta es una cuestión de *número de réplicas*
más que de división —se aplica igualmente a una implementación de un solo rol
escalada a tres—, por lo que establezca `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` en
la configuración) siempre que más de un proceso sirva websockets.

**Escalar a cero.** Nada aquí reduce un proceso a cero ni levanta uno
bajo demanda. Esa es una capacidad de la plataforma, no del runtime.

Todo lo demás que un proceso mantiene para sí mismo se encuentra en una lista:
[Ejecución de más de una instancia](/docs/deployment/multiple-instances/).

## Lanzamiento de una unidad por separado

Todo lo anterior divide *dónde se ejecuta el trabajo*. Todo se sigue distribuyendo como una sola
compilación: una imagen, un bundle, desplegados juntos de forma progresiva. Ese es el valor predeterminado correcto, y
la mayoría de las implementaciones deberían mantenerse así.

Una unidad también puede mantenerse en una compilación propia; por ejemplo, una corrección en una función
que no reinicia la API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.30.1"     # this unit only; the rest stay on the release-wide tag
```

Por lo general, solo vale la pena fijar la etiqueta: el repositorio se hereda, por lo que se trata de
un solo proyecto y una sola imagen con una unidad desplazada. `bundleUrl` cumple la misma función
cuando `bundle.mode: url`.

### La regla

Dos unidades en compilaciones diferentes son dos conjuntos de tablas contra **una**
base de datos, y solo una unidad la aprovisiona. Por lo tanto:

> **La unidad propietaria del esquema se actualiza primero. Una unidad puede quedar rezagada; nunca debe ir por delante.**

Ese es el Job de migración, o la `api` cuando el Job está desactivado. Una unidad que se ejecuta
*por delante* del esquema consulta columnas que aún no existen y depende de políticas RLS
que nadie aplicó; lo primero es un error de SQL en una ruta, lo segundo es un
resultado vacío con un 200. Una unidad que se ejecuta *por detrás* es el estado habitual de cualquier
despliegue progresivo en curso.

### Qué lo comprueba

El proceso que aprovisiona registra en la base de datos la versión del esquema que aplicó.
Cada uno de los demás procesos calcula la suya a partir de las tablas que cargó y
las compara. Si hay una discrepancia, lo indica señalando ambas:

```
⚠️ [schema] The database was last provisioned from a different set of tables
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Advierte y continúa sirviendo, porque durante un despliegue progresivo esa discrepancia es *correcta*:
se espera que las unidades que aún no se han actualizado estén por detrás. Establezca
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` en el
chart) para rechazar el arranque en su lugar, en una implementación que prefiera no servir
nada antes que servir datos incorrectos.

Ambas partes de esa comparación son **calculadas**, nunca se leen de un manifiesto. Una
versión que una compilación declara sobre sí misma no es evidencia de que la base de datos coincida
con ella.

Nada comprueba la *dirección*: una versión de esquema es un hash, por lo que puede indicar que
ambas discrepan pero nunca cuál va por delante. Eso es lo que hace que el orden de despliegue sea
una regla que usted debe seguir en lugar de una que el runtime pueda imponer.

## Actualización

Sin cambios: cada proceso ejecuta la misma imagen publicada, por lo que una actualización consiste en el mismo
cambio de etiqueta en cada uno de ellos. Despliegue primero el proceso propietario del esquema —la `api`,
o el Job de migración— para que el esquema de la nueva versión esté listo antes de
que los demás procesos se ejecuten contra él: una unidad puede quedar rezagada, nunca ir por delante (consulte
[La regla](#la-regla)).

## Relacionado

- [Guía de implementación](/docs/getting-started/deployment/) — la implementación de un solo proceso que esto divide
- [Entorno y configuración](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` y `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — una implementación por rol
