---
sourceHash: 3816fd5da6e03bba
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen oficial del runtime y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS básico.
---

## Descripción general

El autoalojamiento de Rebase implica ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

No hay **ninguna imagen de aplicación para compilar**. Tu proyecto viaja como un bundle,
el runtime está publicado, y actualizar Rebase es un cambio de etiqueta en lugar de una
recompilación. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) para
ver por qué está dividido de esa manera.

## Docker Compose

**Si tu proyecto provino de `rebase init`, utiliza su propio `docker-compose.yml`.**
Está en tu repositorio, `init` completó sus secretos, su primera cuenta de administrador
y su versión fija del runtime, y es el archivo que describe
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

El resto de esta página es el mismo despliegue sin un scaffold detrás:
el proyecto de otra persona, un bundle compilado en CI o las dos cosas que el archivo
generado omite deliberadamente: un pooler de conexiones y las estructuras de procesos divididos.
Ese archivo se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilízalo en lugar de copiar un fragmento de esta página: ambos archivos se arrancan mediante
la propia compuerta de aceptación del proyecto en cada push, por lo que ninguno puede desviarse
de lo que realmente funciona.

Los dos coinciden en cada variable de entorno excepto en la contraseña de la base de datos, y
eso se debe a que cada uno está escrito para su propio emisor: este lee
`POSTGRES_PASSWORD`, que genera `quickstart.sh`; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incrusta en el `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas obvias e imprime ambas. La
versión extendida, si prefieres controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado: `api` espera a su
healthcheck.

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

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más adelante
  implica cambiarla también en el volumen, así que elígela una sola vez.
- **`JWT_SECRET`** — firma cada sesión. Rotarla cierra la sesión de todos.
- **`REBASE_SERVICE_KEY`** — la credencial que elude la seguridad a nivel de fila (row-level security)
  para llamadas de servidor a servidor. Trátala como una contraseña de root: cualquier cosa
  que la posea puede leer cada fila.
- **`CORS_ORIGINS`** — los orígenes desde los que se sirve tu frontend, separados por comas.
  No es un secreto y no es opcional: el runtime se niega a iniciar en producción
  sin él en lugar de adivinar, porque una API que adivina sus orígenes
  permitidos tarde o temprano permite el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — el primer
  administrador. Una base de datos nueva no tiene usuarios y, fuera de producción,
  la política de registro admite el primer registro y lo promueve a admin;
  de lo contrario, una base de datos vacía es un callejón sin salida, porque inicializar
  un admin requiere un llamador que ya haya iniciado sesión. En el momento en que
  este stack responde en un hostname, esa conveniencia se convierte en una carrera
  que el operador puede perder, por lo que en producción esa ventana se cierra
  y la cuenta se define aquí. El runtime la crea una vez, mientras la tabla de
  usuarios está vacía, y no hace nada en cada arranque posterior.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener al menos 32 caracteres cada una, y
la contraseña de administrador al menos 12. Utiliza una dirección con un punto en su dominio:
`POST /auth/login` parsea su cuerpo con `z.string().email()`, por lo que el runtime
se niega a inicializar `admin@localhost` —una cuenta en la que nadie podría iniciar sesión— y
registra el motivo en su lugar. El archivo compose declara los seis valores con
`${VAR:?…}`, por lo que si falta alguno, el stack se detiene con un mensaje indicando cuál es
en lugar de iniciar algo a medio configurar, y el autoregistro viene desactivado
(`DISABLE_SELF_REGISTRATION`, por defecto `true`), por lo que no queda nada por reclamar.

Inicia sesión con esas credenciales y cambia la contraseña: se encuentran en un
archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto en el bundle** por
defecto, por lo que `dist-bundle` llega con un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle con dependencias empaquetadas (vendored) se inicia en unos cinco segundos.

Dado que ya están allí, puedes montar el bundle en modo de solo lectura; vale la pena
hacerlo, ya que un hook comprometido no podrá reescribir el código que se ejecuta tras el
siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y genera un bundle que instala sus
dependencias en el primer arranque, lo que toma entre 40 y 60 segundos por inicio y
requiere que el montaje tenga permisos de escritura.

Para un despliegue real, es preferible integrar ambos en una imagen, lo que además fija con
exactitud lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.29.0
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas faltantes al arrancar, incluidas las de tus colecciones.**
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el
esquema: crea tablas, columnas y tipos enum faltantes, y aplica su seguridad a nivel de fila.
Un primer inicio contra una base de datos vacía arranca sirviendo tus colecciones,
sin ningún paso adicional.

Lo que `ensure` deliberadamente nunca hace es cambiar algo que ya existe. No
altera el tipo de una columna, no elimina una tabla ni una columna, y no
edita las etiquetas de un enum existente; esto se debe a que el reinicio de un contenedor
no debe poder alterar la forma de un esquema como efecto secundario de un despliegue.

Por lo tanto, todavía vale la pena ejecutar `rebase db push` para lo que el arranque no modifica:
cualquier cambio que no sea puramente aditivo, como una columna renombrada, un tipo más restringido
o un campo eliminado.

```bash
rebase db push
```

Ejecútalo desde una copia local o un job de CI, apuntando a la base de datos del despliegue.
Realiza primero una simulación (dry-run) del cambio, rechaza los destructivos sin confirmación
explícita y puede realizar una copia de seguridad antes de aplicar. La base de datos publica un
puerto en el archivo compose para que este pueda alcanzarla desde el host; elimina ese mapeo
una vez que el esquema esté listo si la base de datos no debe ser accesible desde el exterior.

`REBASE_MIGRATE_ON_BOOT` solo acepta `ensure` y `none` — la imagen **se niega a arrancar**
con `push`, por la razón mencionada anteriormente.

## Cuando solo tu proceso de cambios puede modificar la base de datos

`REBASE_MIGRATE_ON_BOOT=none` deja intactas tus colecciones. No deja intacta la base de
datos: las tablas propias del framework (autenticación, claves API, jobs, cron) se siguen creando
y manteniendo actualizadas en cada arranque. Cuando la base de datos solo deba modificarse
mediante un proceso de cambios revisado, establece `REBASE_PROVISION=false` en cada proceso
que atienda peticiones:

| Configuración | Tablas de colecciones y políticas | Tablas del framework |
|---|---|---|
| por defecto (`REBASE_MIGRATE_ON_BOOT=ensure`) | se crean y se mantienen actualizadas al arrancar | se crean y se mantienen actualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | no se tocan | se crean y se mantienen actualizadas |
| `REBASE_PROVISION=false` | no se tocan | no se tocan; lo que falte se indica en el registro |

Con el aprovisionamiento desactivado, el runtime no crea ni altera nada: ninguna tabla, columna,
índice, función, disparador (trigger), política, rol o permiso (grant). Esto se aplica tanto en el arranque como
posteriormente, incluidas las tablas que un proceso en servicio crearía en su primer uso
(claves de idempotencia, reservas de cron, contadores compartidos de límite de tasa). En su lugar, lee lo
que ya existe:

- **Faltan tablas de autenticación o una columna que la autenticación lee:** el arranque se rechaza y se lista
  cada una.
- **El rol de petición puede acceder a una tabla del framework** como
  `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza y muestra el
  `REVOKE` que debe ejecutarse. Un arranque con aprovisionamiento retira esos privilegios por su cuenta.
  Con el aprovisionamiento desactivado, nada lo hace.
- **Falta una tabla opcional** (claves API, claves de idempotencia, reservas de cron,
  contadores de límite de tasa, presencia, historial de métricas): esa función se desactiva y el
  registro indica qué tabla necesita.

Las filas siguen cambiando, como ocurriría en cualquier base de datos: inicios de sesión, sesiones, uso de claves API,
claves de idempotencia, reservas de cron. La primera cuenta de administrador
(`REBASE_ADMIN_EMAIL`) se inicializa mediante la ejecución de aprovisionamiento, no por los
procesos en servicio. La [edición de esquema en vivo](/docs/backend/live-schema-editing) aún puede
confirmar un cambio como código fuente, pero se niega a aplicarlo a la base de datos.

### La ejecución de aprovisionamiento

El esquema proviene de una ejecución que controla tu proceso de cambios. Utiliza la misma imagen y
bundle que el servidor, con `REBASE_PROVISION_ONLY=true`, conectado como un rol con permisos de
creación en la base de datos. `REBASE_PROVISION_SQL_OUT` guarda cada cambio de esquema que la
ejecución realizó como un script SQL:

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

La imagen se ejecuta con `NODE_ENV=production`, por lo que esta ejecución está sujeta a las mismas
comprobaciones de entorno que el servidor, incluidas `CORS_ORIGINS` o `FRONTEND_URL`,
aunque no sirva ninguna petición.

El script es un registro, no un plan: cada sentencia en él se ejecutó en orden y
con éxito. Registrado contra una base de datos vacía, representa el esquema completo que la
versión necesita. Registrado contra una copia restaurada de producción, es exactamente la actualización.
Las filas que la ejecución escribió no están incluidas en él. Revísalo y luego aplícalo a la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repite esto para cada actualización de Rebase, antes de reiniciar los procesos en servicio. Una
versión puede añadir una tabla o una columna, y un proceso que no tiene permisos para crearla
informará de que falta en lugar de crearla.

Un servidor que compiles tú mismo sigue la misma regla: `initializeRebaseBackend` lee
`REBASE_PROVISION`, y `createRebaseBackend` acepta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es deliberado: la
alternativa predeterminada es el sistema de archivos del contenedor, que pierde silenciosamente cada
archivo subido en el siguiente reinicio. Las subidas se rechazan con
`501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) además de su bucket y credenciales;
el archivo compose enumera las variables comentadas. `gcs` carga
`@google-cloud/storage`, que la imagen oficial no incluye, por lo que en esa imagen
debes conectarte a Google Cloud Storage a través de su endpoint compatible con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, claves HMAC).

Para disco local, lo cual solo es adecuado cuando la ruta es un volumen real que
sobrevive al contenedor:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` no es opcional en ese caso: en producción, un backend `local` se
descarta en lugar de registrarse, porque la alternativa son subidas que tienen éxito en un
sistema de archivos a punto de ser destruido. La variable es tu forma de indicar que el montaje
es persistente.

Monta el volumen **por encima** de `STORAGE_PATH`, no directamente en él. `STORAGE_PATH` es el
directorio del bucket por defecto, y cada bucket declarado en `config/resources.ts`
obtiene el suyo junto a este, `<STORAGE_PATH>__<key>`. Un volumen situado en el propio
`STORAGE_PATH` solo contendrá el bucket por defecto. Cualquier otro bucket escribirá en el
sistema de archivos del contenedor y perderá sus archivos cuando el contenedor se vuelva a crear.
`STORAGE_PATH__MEDIA` puede mover un bucket a otro lugar del volumen. No puede moverlo
dentro del directorio de otro bucket, como `/storage/uploads/media`, porque entonces el
bucket por defecto listaría, serviría y eliminaría sus archivos.

La imagen crea
`/storage` para el usuario sin privilegios `node` con el que se ejecuta, razón por la cual el volumen
va allí. Un volumen montado donde la imagen no tiene directorio pertenecerá a root,
y cada subida fallará con `EACCES`. El archivo compose que genera `rebase init`
lo monta de esta manera.

### El almacenamiento necesita un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue declare cómo se protegen los objetos. El almacenamiento no está bajo
seguridad a nivel de fila y sus claves comparten un espacio de nombres plano, por lo que sin ninguna regla
lo único que separa los archivos de dos usuarios es la imposibilidad de adivinar la clave, algo que
`GET /storage/list?prefix=` echa por tierra. Cualquiera de las siguientes opciones lo satisface:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto,
  que es la respuesta real y lo que el scaffold incluye en `config/storage.ts`:
  ninguna variable de entorno puede expresar "este usuario puede leer esta clave";
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente sea una CDN pública
  de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino (single-tenant)
  donde se confía en cualquier cuenta que haya iniciado sesión para acceder a cada archivo.

Fuera de producción, la misma condición es una advertencia sonora en lugar de una denegación,
por lo que este es un fallo de arranque que encontrarás en el despliegue y no en tu máquina local.
Es deliberado: el fallo al que reemplaza es silencioso.

Define también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se define, los secretos del autenticador
almacenados se cifran con `JWT_SECRET`, por lo que rotar este último cerrará la sesión de todos
*y* hará que ningún dispositivo registrado pueda descifrarse.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier cosa que ejecute
contenedores funciona. Dos cosas que deben configurarse correctamente en todas partes:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él; consulta [Dependencias](#dependencias).
2. Define `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega a
   iniciar en producción sin ellos en lugar de adivinarlos.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.29.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utiliza la forma de imagen derivada anterior para que el bundle se envíe con la aplicación, luego
ejecuta `fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, define las variables de entorno y establece
la ruta del health check en `/livez`.

### Un VPS básico

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` enumera las variables que lee. Bajo systemd (las dos
líneas `REBASE_ADMIN_*` requieren la versión 0.18 o posterior, y en la 0.17.3 la primera cuenta en
registrarse se convierte en administrador en su lugar):

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

`NODE_ENV=production` no está de adorno. Si no se define, el proceso se ejecuta en
modo de desarrollo: refleja orígenes de localhost, sirve la especificación OpenAPI y
**deja abierta la ventana del primer administrador**, por lo que el primer desconocido que encuentre el
formulario de registro se convertirá en administrador. Las dos líneas `REBASE_ADMIN_*` son lo que
sustituye esa ventana; consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está ahí porque la base de datos se encuentra en la
misma máquina. En producción, el runtime rechaza cualquier variable que apunte a localhost
(en un contenedor, loopback es el propio contenedor, por lo que esa dirección siempre es un error)
y esta línea le indica que esa dirección es intencionada. Elimínala cuando la base de datos se ejecute en otro lugar.

Prefiere `EnvironmentFile=/etc/rebase.env` con el archivo en modo 0600 en lugar de
líneas `Environment=` para los secretos: un archivo de unidad tiene permisos de lectura para todos y
`systemctl show` imprime cada valor de `Environment=`.

## Pool de conexiones (Connection pooling)

El runtime mantiene un pool pequeño y de larga duración, por lo que no necesita un pooler. Lo que
sí lo necesita es todo lo demás que se comunica con la misma base de datos y no puede mantener una conexión:
una función serverless, un script programado, una herramienta de BI, un worker de cola que escala
a cincuenta instancias. El `max_connections` de Postgres es un límite estricto de unos pocos cientos y
cada conexión es un *proceso*, por lo que un despliegue en abanico (fan-out) de lambdas lo agota mucho antes de que
la base de datos esté realmente ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, tras un perfil
para que un despliegue sin dichos llamadores no ejecute un proceso que no necesita:

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

La autenticación del cliente se genera a partir de `DATABASE_URL` al iniciar, por lo que
la contraseña no se escribe dos veces. El pooler se autentica en Postgres con
`scram-sha-256`, que es lo que almacena Postgres 18; el valor por defecto `md5` de la imagen falla en el
inicio de sesión del *servidor* con `FATAL: server login failed: wrong password type`, lo cual
parece un error de contraseña incorrecta pero no lo es.

Mantén la suma de `PGBOUNCER_POOL_SIZE` en todos los poolers holgadamente por debajo del
`max_connections` de la base de datos: el runtime se abastece del mismo presupuesto.

### Qué cambia con el pooling de transacciones

Un cliente en pool mantiene una conexión con el servidor durante la duración de una transacción y
luego la devuelve, que es lo que permite que 500 clientes compartan 20 conexiones. Hay tres
cosas que dejan de funcionar a través de ese puerto, y cada una de ellas es algo que el propio Rebase utiliza,
razón exacta por la que el runtime se conecta directamente y este puerto queda reservado para otros
llamadores:

- **`LISTEN`/`NOTIFY`.** Realtime está construido sobre esto, y un listener necesita una
  conexión que sobreviva a una transacción. `LISTEN` es *aceptado* a través del
  pooler: responde `LISTEN`, y luego nunca llega ninguna notificación.
- **Estado de sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos (advisory locks)
  mantenidos a través de sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción
  puede terminar en una conexión de servidor diferente, que no verá nada de eso. Ambos
  fallan de la misma forma poco útil: con un solo cliente inactivo, el estado suele
  seguir allí, por lo que funciona mientras pruebas y deja de funcionar bajo
  la concurrencia para la que introdujiste el pooler.
- **Sentencias preparadas a nivel de protocolo (prepared statements).** A la mayoría de los drivers se les puede indicar
  que no las utilicen: node-postgres no lo hace por defecto; asyncpg necesita
  `statement_cache_size=0`.

`SET LOCAL` tiene alcance de transacción y funciona, que es con lo que se configura la
seguridad a nivel de fila, por lo que RLS se comporta de manera idéntica a través del puerto con pool.

Deja el perfil desactivado si nada fuera del runtime se conecta a tu base de datos.
Un puerto sin usar es superficie de ataque.

## Comprobaciones de estado (Health checks)

| Ruta | Uso |
| --- | --- |
| `/livez` | Liveness. Responde "está vivo este proceso" sin tocar la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta a la base de datos e informa de la latencia. |

Apunta las sondas de liveness a `/livez`. Una sonda de liveness en `/health` reiniciará un
proceso perfectamente sano durante un breve fallo temporal de la base de datos, lo cual es lo opuesto
a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuentos de peticiones e histogramas de latencia
desglosados por superficie de API (datos, autenticación, almacenamiento, funciones) y colección, además de
indicadores (gauges) del proceso. Sin un token, el endpoint es legible por cualquiera que pueda acceder al
puerto, así que define uno a menos que se encuentre en una red privada.

`rebase_db_pool_wait_ms` es un histograma de cuánto tiempo esperó cada consulta por una
conexión del pool de la base de datos, incluida la apertura de una, etiquetado por la clave del origen
de datos (`source="(default)"` en un proyecto que no declara orígenes de datos). Un pool
saludable lo mantiene cerca de cero. Una cola que
crece con el tráfico significa que las peticiones están esperando conexiones en cola, generalmente
retenidas por callbacks de escritura que esperan algo lento; consulta
[Un callback retiene una conexión](/docs/collections/context-data-api/#a-callback-holds-a-connection).

La base de datos en sí, por origen de datos:

| Métrica | Qué indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Las conexiones de cada pool, etiquetadas como `pool="primary"`, `"read"` (la réplica) o `"session"` (el pool directo de la consola SQL tras un pooler). Un valor de `waiting` superior a cero durante mucho tiempo indica un pool demasiado pequeño para su carga. |
| `rebase_db_connection_errors_total` | Peticiones respondidas con 503 por falta de conexión, por `code`: `53300` / `53400` (el servidor se ha quedado sin conexiones), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexiones de cliente en el servidor, por `state`, frente a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | El tamaño de la base de datos. |
| `rebase_db_replica_lag_seconds` | Cuánto retraso tiene `DATABASE_READ_URL` respecto a la primaria. |

Las últimas cuatro se muestrean cada 30 segundos en la propia conexión de la instancia, por lo
que un raspado (scrape) nunca se convierte en una consulta.

`rebase_realtime_*` informa sobre los sockets abiertos de cada instancia, los canales y las tramas (frames)
que envió al bus de canales o que retuvo: consulta
[Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Encabezados de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000`
(180 días). El encabezado HSTS omite `includeSubDomains`: eso indicaría a los
navegadores que rechacen HTTP plano en todos los subdominios de tu dominio, incluidos aquellos
con los que este servidor no tiene nada que ver, y un navegador lo mantiene durante el tiempo que indique el encabezado.
Define `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios sean exclusivamente HTTPS;
hasta la versión 0.23 incluida, el encabezado siempre llevaba `includeSubDomains`.

`strict-origin-when-cross-origin` es el valor predeterminado de los propios navegadores: una petición a
otro sitio incluye tu origen y nunca la ruta o consulta de la página. No es
`no-referrer` porque las comprobaciones de origen necesitan el origen; el botón de inicio de sesión de Google
lo compara con los orígenes de JavaScript autorizados del cliente OAuth, y bajo
`no-referrer` respondía "The given origin is not allowed for the given client
ID" en cada aplicación, sin importar lo que el cliente permitiera. Una respuesta que define su propia
política la mantiene (la página de consentimiento de MCP envía `no-referrer`); una página que desee una
más estricta puede indicarlo con `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` funciona de la misma manera: `SAMEORIGIN` a menos que la respuesta establezca la
suya propia, como hace la página de consentimiento de MCP con `DENY`.

Las aplicaciones estáticas (el admin del CMS y cualquier frontend que sirva el bundle) también llevan
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Esto decide quién puede incrustar la aplicación en un marco (frame), descarta plugins y fija `<base>`
a tu origen, sin restringir nada más, de modo que los scripts en línea, los workers y el
inicio de sesión de terceros sigan funcionando. Una respuesta que define su propia política la mantiene.
Para cualquier cosa más estricta, coloca la política en el proxy inverso situado delante.

## Más de una instancia

Un único contenedor es la opción por defecto y no necesita nada más. Antes de que una segunda réplica
reciba tráfico —o de que un despliegue progresivo ejecute dos en paralelo—, revisa
[Ejecutar más de una instancia](/docs/deployment/multiple-instances/): los límites de tasa,
los canales de difusión (broadcast), los archivos locales, las subidas reanudables y la caché de imágenes
son por proceso hasta que una configuración los comparta.

## Conectar Claude

Un solo comando añade este servidor al [conector de Rebase](/docs/ai/rebase-connector/),
el conector MCP único que accede a todos tus proyectos desde Claude:

```bash
rebase cloud connect https://your-app.com
```

Define en este servidor las dos variables que imprime y reinícialo. El servidor debe
ejecutar Rebase 0.28.1 o posterior y responder a través de https en una dirección pública. Nada
más cambia: no almacena ningún secreto y concede al conector lo mismo que concedería Studio.

## Ejecutar funciones en su propio proceso

Todo lo anterior es un único contenedor que sirve todo el proyecto, que es la estructura
adecuada para casi cualquier despliegue. Cuando una función personalizada deba dejar de competir
con la API de datos por el bucle de eventos (event loop) —o deba escalar, reiniciarse y fallar por sí
sola—, la misma imagen y el mismo bundle pueden arrancarse como varios procesos que cooperan entre sí.
Consulta [Procesos divididos](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.29.0
```

Reinicia. Tu bundle no cambia. Dentro de una versión principal (major) del contrato del runtime, un bundle que
se haya validado sigue funcionando; consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
