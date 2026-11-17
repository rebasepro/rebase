---
sourceHash: 2450935032a5319f
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: "Ejecuta Rebase en cualquier lugar con la imagen oficial del runtime y el bundle de tu proyecto: Docker Compose, Fly, Railway o un VPS básico."
---

## Descripción general

Autoalojar Rebase implica ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

No hay **ninguna imagen de aplicación que compilar**. Tu proyecto viaja como un bundle,
el runtime está publicado y actualizar Rebase es simplemente un cambio de etiqueta (tag) en lugar de una
recompilación. Consulta [Runtime y bundles](/docs/architecture/runtime-and-bundles/) para
saber por qué está dividido de esa forma.

## Docker Compose

**Si tu proyecto se creó con `rebase init`, utiliza su propio `docker-compose.yml`.**
Está en tu repositorio; `init` completó sus secretos, su primera cuenta de administrador
y su versión fija de runtime, y es el archivo que
[Despliegue](/docs/getting-started/deployment/#docker-compose-recommended)
describe:

```bash
rebase build
docker compose up -d
```

El resto de esta página trata sobre el mismo despliegue pero sin un scaffold detrás:
el proyecto de otra persona, un bundle compilado en CI, o las dos cosas que el
archivo generado omite deliberadamente: un connection pooler y los esquemas de procesos divididos.
Ese archivo se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilízalo en lugar de copiar un fragmento de esta página: ambos archivos son arrancados por
el propio filtro de aceptación (acceptance gate) del proyecto en cada push, por lo que ninguno puede desfasarse de lo que
realmente funciona.

Ambos coinciden en cada variable de entorno excepto en la contraseña de la base de datos, y
esto se debe a que cada uno está escrito para su propio emisor: este lee
`POSTGRES_PASSWORD`, que genera `quickstart.sh`; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incluye en la `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas evidentes y muestra ambas por pantalla. La
forma extendida, si prefieres controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado; `api` espera a su
comprobación de estado (healthcheck).

### Los seis valores que necesita

`quickstart.sh` genera estos valores por ti. Para escribir el `.env` manualmente:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Tres secretos, un dato y la cuenta con la que inicias sesión:

- **`POSTGRES_PASSWORD`**: la contraseña de la base de datos. Cambiarla más
  tarde implica cambiarla también en el volumen, así que elígela una sola vez.
- **`JWT_SECRET`**: firma cada sesión. Rotarla cierra la sesión de todos los usuarios.
- **`REBASE_SERVICE_KEY`**: la credencial que elude la seguridad a nivel de fila (row-level security) para
  llamadas de servidor a servidor. Trátala como una contraseña de root: cualquier cosa que la posea puede
  leer cada fila.
- **`CORS_ORIGINS`**: los orígenes desde los que se sirve tu frontend, separados por comas.
  No es un secreto ni es opcional: el runtime se niega a arrancar en producción
  sin este valor en lugar de adivinarlo, porque una API que adivina sus orígenes permitidos
  tarde o temprano permite el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`**: el primer
  administrador. Una base de datos nueva no tiene usuarios, y fuera de producción la
  política de registro admite el primer registro y lo asciende a administrador;
  de lo contrario, una base de datos vacía es un callejón sin salida, porque inicializar un administrador
  requiere un cliente que ya haya iniciado sesión. En el momento en que este stack responde en un
  nombre de host, esa comodidad se convierte en una carrera que el operador puede perder, por lo que en producción
  esa ventana se cierra y la cuenta se define aquí. El runtime la crea
  una vez, mientras la tabla de usuarios esté vacía, y no hace nada en los arranques posteriores.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener al menos 32 caracteres cada una, y
la contraseña de administrador al menos 12. Utiliza una dirección con un punto en su dominio:
`POST /auth/login` valida su cuerpo con `z.string().email()`, por lo que el runtime
se niega a crear `admin@localhost` (una cuenta con la que nadie podría iniciar sesión) y
en su lugar registra el motivo en los logs. El archivo compose declara las seis variables con
`${VAR:?…}`, de modo que si falta alguna, el stack se detiene con un mensaje indicando cuál falta
en lugar de iniciar algo mal configurado, y el autorregistro viene desactivado por defecto
(`DISABLE_SELF_REGISTRATION`, valor predeterminado `true`), por lo que no queda nada susceptible de ser reclamado.

Inicia sesión con esas credenciales y cambia la contraseña: se encuentran almacenadas en un
archivo en el host.

## Dependencias

Por defecto, `rebase build` **instala las dependencias de tu proyecto dentro del bundle**,
por lo que `dist-bundle` viene con un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle con dependencias integradas (vendored) arranca en unos cinco segundos.

Dado que ya están allí, puedes montar el bundle en modo de solo lectura; vale la pena
hacerlo, ya que un hook comprometido no podrá sobrescribir el código que se ejecuta tras el
siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y genera un bundle que en su lugar instala sus
dependencias en el primer arranque, lo que toma entre 40 y 60 segundos por inicio y
requiere que el punto de montaje tenga permisos de escritura.

Para un despliegue real, es preferible empaquetar ambos dentro de una imagen, lo que además fija con exactitud
lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.33.2
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas que falten al arrancar, incluidas las que declara `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el
esquema: crea las tablas, columnas y tipos enum faltantes, y aplica su
seguridad a nivel de fila. Un primer arranque contra una base de datos vacía se inicia sirviendo
tus tablas, sin requerir ningún paso adicional.

Lo que `ensure` deliberadamente nunca hace es cambiar nada que ya exista. No
altera el tipo de una columna, no elimina una tabla ni una columna, y no
edita las etiquetas de un enum existente; porque el reinicio de un contenedor no debe poder
remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, sigue valiendo la pena ejecutar `rebase db push` para aquello que el arranque no toca:
cualquier cambio que no sea puramente aditivo, como una columna renombrada, un tipo más restringido o
un campo eliminado.

```bash
rebase db push
```

Ejecútalo desde una copia local del código o un trabajo de CI, apuntando a la base de datos del despliegue. Primero
realiza una simulación (dry-run) del cambio, rechaza los destructivos sin confirmación
explícita y puede realizar una copia de seguridad antes de aplicar. La base de datos expone un
puerto en el archivo compose para que este comando pueda comunicarse con ella desde el host; elimina ese mapeo
una vez que el esquema esté listo si la base de datos no debe ser accesible desde el
exterior.

`REBASE_MIGRATE_ON_BOOT` acepta `ensure` y `none`, y nada más; la
imagen **se niega a arrancar** con `push`, por el motivo indicado anteriormente.

## Cuando solo tu proceso de cambios puede modificar la base de datos

`REBASE_MIGRATE_ON_BOOT=none` no toca tus tablas. Sin embargo, no deja
la base de datos intacta: las tablas propias del framework (auth, claves de API, jobs, cron) se
siguen creando y manteniendo actualizadas en cada arranque. Cuando la base de datos solo deba modificarse
a través de un proceso de cambios revisado, establece `REBASE_PROVISION=false` en cada proceso
que atienda peticiones:

| Configuración | Tablas y políticas declaradas | Tablas del framework |
|---|---|---|
| predeterminado (`REBASE_MIGRATE_ON_BOOT=ensure`) | creadas y mantenidas actualizadas al arrancar | creadas y mantenidas actualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | no se tocan | creadas y mantenidas actualizadas |
| `REBASE_PROVISION=false` | no se tocan | no se tocan; lo que falte se indica en los logs |

Con el aprovisionamiento desactivado, el runtime no crea ni modifica nada: ninguna tabla, columna,
índice, función, disparador (trigger), política, rol o permiso (grant). Esto se aplica en el arranque y posteriormente,
incluidas las tablas que un proceso en servicio crearía en su primer uso
(claves de idempotencia, bloqueos de cron, contadores compartidos de límite de tasa). En su lugar, lee lo que
ya existe:

- **Si faltan tablas de autenticación o una columna que la autenticación lee:** el arranque se rechaza y enumera
  cada una.
- **Si el rol de la petición puede acceder a una tabla del framework** como
  `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza e imprime el
  comando `REVOKE` que se debe ejecutar. Un arranque con aprovisionamiento revoca esos privilegios por sí mismo.
  Con el aprovisionamiento desactivado, nada lo hace.
- **Si falta una tabla opcional** (claves de API, claves de idempotencia, bloqueos de cron,
  contadores de límite de tasa, presencia, historial de métricas): esa funcionalidad queda desactivada y el
  registro indica qué tabla necesita.
- **Si una tabla declarada no está protegida por la base de datos** (seguridad a nivel de fila
  desactivada, ninguna de las políticas que declara está presente o falta una política restrictiva
  que declara): esa tabla no se servirá (si falta una política permisiva,
  sí se sirve, mostrando una advertencia de arranque indicándola). Una petición a dicha tabla responderá con `503 TABLE_WITHHELD`, y el log de arranque
  indicará el SQL que la protege (o `rebase db push`). Las demás tablas se
  sirven con normalidad y el arranque continúa. Una tabla de unión many-to-many se comprueba de la misma
  manera: si la base de datos no protege una de ellas, se retienen las tablas cuyas relaciones
  la utilicen, y `TABLE_WITHHELD` indicará la unión. Una tabla cuya relación `via`
  pase a través de una tabla retenida también será retenida, y el mensaje nombrará la
  relación. Esto también aplica con `REBASE_MIGRATE_ON_BOOT=none` y en una actualización del esquema en caliente.
  Una tabla cuyo acceso gestiona la propia aplicación puede indicar `rlsRequired: false` para servirse de todos modos ([cómo hacerlo](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

Las filas se siguen modificando, como ocurriría en cualquier base de datos: inicios de sesión, sesiones, uso de claves de API,
claves de idempotencia, bloqueos de cron. La primera cuenta de administrador
(`REBASE_ADMIN_EMAIL`) se crea mediante la ejecución de aprovisionamiento, no mediante los
procesos en servicio. La [edición del esquema en vivo](/docs/backend/live-schema-editing) aún puede
confirmar un cambio en el código fuente, pero se negará a aplicarlo a la base de datos.

### La ejecución de aprovisionamiento

El esquema proviene de una ejecución controlada por tu proceso de cambios. Utiliza la misma imagen y
bundle que el servidor, con `REBASE_PROVISION_ONLY=true`, conectado con un rol que
tenga permisos de creación en la base de datos. `REBASE_PROVISION_SQL_OUT` guarda cada cambio de esquema
realizado durante la ejecución en un script SQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e CORS_ORIGINS="https://app.example.com" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

La imagen se ejecuta con `NODE_ENV=production`, por lo que esta ejecución se somete a las mismas
comprobaciones de entorno que el servidor, incluidas `CORS_ORIGINS` o `FRONTEND_URL`, a pesar
de que no atiende ninguna petición.

El script es un registro, no un plan: cada sentencia en él se ejecutó, en orden y
con éxito. Registrado contra una base de datos vacía, representa todo el esquema que la versión
necesita. Registrado contra una copia restaurada de producción, representa exactamente la actualización.
Las filas que la ejecución haya escrito no están en él. Revísalo y aplícalo a la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repite esto en cada actualización de Rebase, antes de desplegar gradualmente los procesos en servicio. Una
versión puede añadir una tabla o una columna, y un proceso que no tenga permisos para crearla
informará de que falta en lugar de crearla.

Un servidor que compiles tú mismo sigue la misma regla: `initializeRebaseBackend` lee
`REBASE_PROVISION`, y `createRebaseBackend` acepta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es deliberado: la
alternativa predeterminada sería el sistema de archivos del contenedor, que perdería silenciosamente cada
archivo subido en el siguiente reinicio. Las subidas se rechazan con
`501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) junto con su bucket y credenciales;
el archivo compose incluye estas variables comentadas. `gcs` carga
`@google-cloud/storage`, que la imagen oficial no incluye, por lo que en esa imagen
debes acceder a Google Cloud Storage mediante su endpoint compatible con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, claves HMAC).

Para almacenamiento en disco local, que solo es adecuado cuando la ruta es un volumen real que
persiste más allá de la vida del contenedor:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` no es opcional en este caso: en producción, un backend `local` se
descarta en lugar de registrarse, porque la alternativa serían subidas exitosas
en un sistema de archivos a punto de ser destruido. Esta variable es la forma de confirmar que el punto de montaje
es persistente.

Monta el volumen **por encima** de `STORAGE_PATH`, no directamente en él. `STORAGE_PATH` es el
directorio del bucket por defecto, y cada bucket declarado en `backend/resources.ts`
obtiene el suyo junto a este: `<STORAGE_PATH>__<key>`. Un volumen montado en el propio `STORAGE_PATH`
solo contendrá el bucket predeterminado. Cualquier otro bucket escribirá en el
sistema de archivos del contenedor y perderá sus archivos cuando este se vuelva a crear.
`STORAGE_PATH__MEDIA` permite mover un bucket a otra ubicación del volumen. No puede
ubicarlo dentro del directorio de otro bucket, como `/storage/uploads/media`,
porque entonces el bucket predeterminado listaría, serviría y eliminaría sus archivos.

La imagen crea
`/storage` para el usuario sin privilegios `node` con el que se ejecuta, motivo por el cual el volumen
se ubica allí. Un volumen montado donde la imagen no tiene ningún directorio pertenecerá a root,
y cada subida fallará con `EACCES`. El archivo compose que genera `rebase init`
lo monta de esta manera.

### El almacenamiento requiere un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue declare cómo se protegen los objetos. El almacenamiento no está protegido por
seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que sin ninguna regla lo
único que separa los archivos de dos usuarios es la imposibilidad de adivinar las claves, algo que
`GET /storage/list?prefix=` anula. Cualquiera de las siguientes opciones satisface este requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto,
  que es la solución adecuada y lo que incluye el scaffold en `backend/storage.ts`:
  ninguna variable de entorno puede expresar "este usuario puede leer esta clave";
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente funciona como una CDN
  pública de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación single-tenant en la que
  se confía a cada cuenta que haya iniciado sesión el acceso a todos los archivos.

Fuera de producción, esta misma condición muestra una advertencia llamativa en lugar de rechazar el arranque,
por lo que este es un fallo de inicio con el que te encontrarás al desplegar y no en tu máquina local.
Es deliberado: el fallo al que sustituye es silencioso.

Define también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se define, los secretos del autenticador
almacenados se cifran con `JWT_SECRET`, por lo que rotarla cerrará la sesión de todos
*e* impedirá descifrar los dispositivos vinculados.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier entorno que ejecute
contenedores funcionará. Hay dos aspectos que deben configurarse correctamente en todas partes:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él; consulta [Dependencias](#dependencias).
2. Configura `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega a
   arrancar en producción sin ellos en lugar de adivinarlos.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.33.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utiliza la variante de imagen derivada anterior para que el bundle se distribuya con la aplicación y luego ejecuta
`fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, define las variables de entorno y establece
la ruta de comprobación de estado (health check) en `/livez`.

### Un VPS básico

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` enumera las variables que lee. Con systemd:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=ALLOW_LOCALHOST_IN_PRODUCTION=true
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` no es meramente decorativo. Si no se define, el proceso se ejecuta en
modo de desarrollo: refleja orígenes de localhost, sirve la especificación OpenAPI y
**deja abierta la ventana del primer administrador**, de modo que el primer desconocido que encuentre el
formulario de registro se convertirá en administrador. Las dos líneas `REBASE_ADMIN_*` son las que
reemplazan esa ventana; consulta [Tu primer
administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` se incluye porque la base de datos está en la
misma máquina. En producción, el runtime rechaza cualquier variable que apunte a
localhost (en un contenedor, loopback es el contenedor mismo, por lo que esa dirección siempre es
un error) y esta línea le indica que la dirección es intencionada. Elimínala cuando la
base de datos se ejecute en otro lugar.

Es preferible usar `EnvironmentFile=/etc/rebase.env` con el archivo en modo 0600 en lugar de
líneas `Environment=` para los secretos: un archivo de unidad de systemd es legible por cualquier usuario y
`systemctl show` muestra todos los valores de `Environment=`.

## Agrupación de conexiones (Connection pooling)

El runtime mantiene un pool pequeño y duradero, por lo que no necesita un pooler. Lo que sí lo
necesita es todo lo demás que se comunique con la misma base de datos y no pueda retener una conexión:
una función serverless, un script programado, una herramienta de BI o un worker de colas que escale
a cincuenta instancias. El parámetro `max_connections` de Postgres es un límite estricto de unos pocos cientos
y cada conexión es un *proceso*, por lo que un despliegue masivo de lambdas lo agotará mucho antes de que la
base de datos esté ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, protegido tras un perfil
para que un despliegue sin este tipo de clientes no ejecute un proceso que no necesita:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

La autenticación de clientes se genera a partir de `DATABASE_URL` al iniciar, por lo que la
contraseña no se escribe dos veces. El pooler se autentica en Postgres mediante
`scram-sha-256`, que es lo que almacena Postgres 18; el valor por defecto `md5` de la imagen hace que el
inicio de sesión del *servidor* falle con `FATAL: server login failed: wrong password type`, lo
que parece un error de contraseña incorrecta pero no lo es.

Mantén la suma de `PGBOUNCER_POOL_SIZE` de todos los poolers holgadamente por debajo del
`max_connections` de la base de datos: el runtime consume del mismo cupo.

### Qué cambia con la agrupación por transacciones (transaction pooling)

Un cliente en el pool retiene una conexión al servidor durante la duración de una transacción y
luego la devuelve, que es lo que permite que 500 clientes compartan 20 conexiones. Hay tres
cosas que dejan de funcionar a través de ese puerto, y cada una de ellas es algo que el propio Rebase utiliza,
razón por la cual el runtime se conecta directamente y este puerto queda reservado para otros
clientes:

- **`LISTEN`/`NOTIFY`.** La funcionalidad en tiempo real (Realtime) se basa en esto, y un listener necesita una
  conexión que sobreviva a una transacción. `LISTEN` es *aceptado* a través del
  pooler: responde a `LISTEN`, pero luego nunca llega ninguna notificación.
- **Estado de sesión**: `SET` (a diferencia de `SET LOCAL`), advisory locks retenidos
  entre sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción
  puede recaer en una conexión de servidor diferente que no verá nada de esto. Ambas
  situaciones fallan de la misma forma engañosa: con un único cliente inactivo el estado suele
  permanecer, por lo que funciona mientras haces pruebas y deja de funcionar bajo
  la concurrencia para la cual introdujiste el pooler.
- **Sentencias preparadas a nivel de protocolo.** A la mayoría de los controladores se les puede indicar que no
  las utilicen: node-postgres no las usa por defecto; asyncpg necesita
  `statement_cache_size=0`.

`SET LOCAL` tiene alcance de transacción y sí funciona, que es con lo que se
configura la seguridad a nivel de fila, por lo que RLS se comporta de forma idéntica a través del puerto del pool.

Mantén el perfil desactivado si nada fuera del runtime se conecta a tu base de datos.
Un puerto sin uso es superficie de ataque.

## Comprobaciones de estado (Health checks)

| Ruta | Uso |
| --- | --- |
| `/livez` | Liveness. Responde "¿está vivo este proceso?" sin consultar la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta a la base de datos y reporta la latencia. |

Apunta las sondas de liveness a `/livez`. Una sonda de liveness en `/health` reiniciará un
proceso perfectamente sano ante un breve contratiempo de la base de datos, lo cual es justo lo
contrario de su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuentos de peticiones e histogramas de latencia
desglosados por área de la API (data, auth, storage, functions) y tabla, además de
indicadores del proceso. Sin un token, el endpoint es legible por cualquiera que pueda acceder
al puerto, así que define uno a menos que se encuentre en una red privada.

`rebase_db_pool_wait_ms` es un histograma del tiempo que cada consulta esperó por una
conexión del pool de la base de datos (incluida la apertura de una nueva), etiquetado por la clave de la
fuente de datos (`source="(default)"` en un proyecto que no declare fuentes de datos). Un pool
saludable lo mantiene cerca de cero. Una cola que
crece con el tráfico indica que las peticiones están esperando conexiones en cola, generalmente
retenidas por hooks de escritura que esperan operaciones lentas; consulta
[Un hook retiene una conexión](/docs/collections/context-data-api/#a-hook-holds-a-connection).

La propia base de datos, por fuente de datos:

| Métrica | Qué indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Las conexiones de cada pool, etiquetadas como `pool="primary"`, `"read"` (la réplica) o `"session"` (el pool directo de la consola SQL detrás de un pooler). Un valor de `waiting` superior a cero durante mucho tiempo indica un pool demasiado pequeño para su carga. |
| `rebase_db_connection_errors_total` | Peticiones que respondieron 503 por falta de conexión, según `code`: `53300` / `53400` (el servidor no tiene más conexiones disponibles), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexiones de clientes en el servidor, por `state`, frente a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | El tamaño de la base de datos. |
| `rebase_db_replica_lag_seconds` | Cuánto retraso lleva `DATABASE_READ_URL` con respecto a la primaria. |

Las últimas cuatro se muestrean cada 30 segundos en la propia conexión de la instancia, por lo
que un scrape nunca se convierte en una consulta adicional.

`rebase_realtime_*` reporta los sockets abiertos de cada instancia, los canales y las tramas
enviadas al bus de canales o retenidas: consulta
[Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Encabezados de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000`
(180 días). El encabezado HSTS omite `includeSubDomains`: eso indicaría a los
navegadores que rechacen HTTP plano en cada subdominio de tu dominio, incluidos aquellos
con los que este servidor no tiene relación alguna, y un navegador lo recordará durante todo el tiempo que
indique el encabezado.
Establece `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios sean exclusivamente HTTPS.

`strict-origin-when-cross-origin` es el valor por defecto de los propios navegadores: una petición a
otro sitio envía tu origen y nunca la ruta o consulta de la página. No es
`no-referrer` porque las verificaciones de origen necesitan el origen: el botón de inicio de sesión de Google
lo compara con los orígenes de JavaScript autorizados del cliente OAuth, y con
`no-referrer` respondía "The given origin is not allowed for the given client
ID" en cualquier aplicación, sin importar lo que el cliente permitiera. Una respuesta que define su propia
política la mantiene (la página de consentimiento de MCP envía `no-referrer`); una página que requiera una
más estricta puede indicarlo con `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` funciona del mismo modo: `SAMEORIGIN` a menos que la respuesta defina el
suyo propio, como hace la página de consentimiento de MCP con `DENY`.

Las aplicaciones estáticas (el administrador del CMS y cualquier frontend que sirva el bundle) también incluyen
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Esto determina quién puede incrustar la aplicación en un marco (frame), descarta plugins y fija `<base>`
a tu origen, sin restringir nada más, de modo que los scripts inline, workers y el
inicio de sesión de terceros sigan funcionando. Una respuesta que defina su propia política la mantiene.
Para cualquier cosa más estricta, coloca la política en el proxy inverso que esté delante.

### Permitir que otro origen incruste una aplicación en un marco

`frame-ancestors 'self'` significa que solo una página en el propio origen de la aplicación puede insertarla
en un iframe. Un CMS en `admin.example.com` que previsualiza el sitio en
`www.example.com` necesita que el sitio lo permita mediante `frameAncestors` en la
aplicación del sitio dentro de `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

El sitio se sirve entonces con `frame-ancestors 'self' https://admin.example.com`,
al igual que cualquier [ruta](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app)
del sitio cuya función no envíe una política propia. Las demás aplicaciones mantienen
`'self'`. `X-Frame-Options: SAMEORIGIN` se sigue enviando junto a este encabezado; un navegador que
interpreta `frame-ancestors` ignora `X-Frame-Options`, tal como exige la especificación de CSP.

Cada entrada es un único origen, escrito exactamente: `https://` con un nombre de host y un
puerto opcional, o `http://` para `localhost`, `127.0.0.1` y `[::1]` mientras
desarrollas. No se admiten comodines, rutas ni palabras clave: `'self'` siempre está en
la lista y cualquier otra cosa es rechazada por la CLI y nuevamente por el runtime
antes de que llegue al encabezado. No se permite nada a menos que lo especifiques explícitamente.

## Más de una instancia

Un único contenedor es la configuración por defecto y no requiere nada más. Antes de que una segunda réplica
reciba tráfico (o de que un despliegue continuo ejecute dos en paralelo), revisa
[Ejecutar más de una instancia](/docs/deployment/multiple-instances/): los límites de tasa,
los canales de difusión (broadcast), los archivos locales, las subidas reanudables y la caché de imágenes
son por proceso hasta que una opción de configuración los comparta.

## Conectar Claude

Un solo comando añade este servidor al [conector de Rebase](/docs/ai/rebase-connector/),
el conector MCP único que accede a todos tus proyectos desde Claude:

```bash
rebase cloud connect https://your-app.com
```

Configura las dos variables que muestra por pantalla en este servidor y reinícialo. El servidor debe
ejecutar Rebase 0.28.1 o posterior y responder a través de https en una dirección pública. Nada
más cambia: no almacena ningún secreto y concede al conector los mismos permisos que otorgaría Studio.

## Ejecutar funciones en su propio proceso

Todo lo anterior consiste en un único contenedor que sirve todo el proyecto, que es la estructura
adecuada para casi cualquier despliegue. Cuando una función personalizada deba dejar de competir
con la API de datos por el event loop (o deba escalar, reiniciarse y fallar de forma independiente),
la misma imagen y el mismo bundle pueden arrancarse como varios procesos cooperativos.
Consulta [Procesos divididos](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.33.2
```

Reinicia. Tu bundle permanece sin cambios. Dentro de una versión principal (major) del contrato del runtime, un bundle que
haya sido validado sigue funcionando; consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
