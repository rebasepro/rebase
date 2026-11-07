---
sourceHash: dd7f515c841c860b
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen oficial del runtime y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS básico.
---

## Descripción general

Autoalojar Rebase significa ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que construir**. Tu proyecto viaja como un bundle,
el runtime está publicado, y actualizar Rebase es un cambio de etiqueta (tag) en lugar de una
recompilación. Consulta [Runtime y bundles](/docs/architecture/runtime-and-bundles/) para
saber por qué está dividido de esta manera.

## Docker Compose

**Si tu proyecto provino de `rebase init`, usa su propio `docker-compose.yml`.**
Está en tu repositorio, `init` completó sus secretos, su primera cuenta de administrador
y su versión fija del runtime, y es el archivo que describe
[Despliegue](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

El resto de esta página es el mismo despliegue sin un scaffolding detrás —el
proyecto de otra persona, un bundle construido en CI, o las dos cosas que el
archivo generado omite deliberadamente: un pooler de conexiones y las arquitecturas
de procesos divididos. Ese archivo se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Úsalo en lugar de copiar un fragmento de esta página: ambos archivos son arrancados por
el propio acceptance gate del proyecto en cada push, por lo que ninguno puede desviarse
de lo que realmente funciona.

Los dos coinciden en cada variable de entorno excepto en la contraseña de la base de datos,
y eso se debe a que cada uno está escrito para su propio emisor: este lee
`POSTGRES_PASSWORD`, que `quickstart.sh` genera; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incrusta en la `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas obvias y muestra ambas en pantalla.
La forma larga, si prefieres controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado — `api` espera a su
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

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más tarde
  significa cambiarla también en el volumen, así que elígela una sola vez.
- **`JWT_SECRET`** — firma cada sesión. Rotarla cierra la sesión de todos.
- **`REBASE_SERVICE_KEY`** — la credencial que elude la seguridad a nivel de fila (RLS)
  para llamadas entre servidores. Trátala como una contraseña de root: cualquier cosa
  que la posea puede leer cada fila.
- **`CORS_ORIGINS`** — los orígenes desde los que se sirve tu frontend, separados por comas.
  No es un secreto y no es opcional: el runtime se niega a iniciar en producción sin él
  en lugar de adivinar, porque una API que adivina sus orígenes permitidos tarde o temprano
  permite el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — el primer
  administrador. Una base de datos nueva no tiene usuarios, y fuera de producción la
  política de registro admite el primer registro y lo asciende a admin; de lo contrario,
  una base de datos vacía es un callejón sin salida, porque iniciar un administrador requiere
  un cliente que ya haya iniciado sesión. En el momento en que este stack responde en un hostname,
  esa conveniencia se convierte en una carrera que el operador puede perder, por lo que en
  producción esa ventana se cierra y la cuenta se especifica aquí. El runtime la crea una vez,
  mientras la tabla de usuarios esté vacía, y no hace nada en cada arranque posterior.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener cada una al menos 32 caracteres, y la
contraseña de administrador al menos 12. Usa una dirección con un punto en su dominio:
`POST /auth/login` analiza su cuerpo con `z.string().email()`, por lo que el runtime
se niega a inicializar `admin@localhost` —una cuenta en la que nadie podría iniciar sesión—
y registra la razón en su lugar. El archivo compose declara los seis valores con
`${VAR:?…}`, de modo que la falta de uno detiene el stack con un mensaje que lo nombra en
lugar de iniciar algo a medio configurar —y el autorregistro viene deshabilitado
(`DISABLE_SELF_REGISTRATION`, por defecto `true`), por lo que nada queda disponible
para ser reclamado.

Inicia sesión con esas credenciales y cambia la contraseña: están guardadas en un
archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto en el bundle** de forma
predeterminada, por lo que `dist-bundle` llega con un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle con dependencias integradas (vendored) arranca en unos
cinco segundos.

Dado que ya están allí, puedes montar el bundle como de solo lectura —vale la pena
hacerlo, ya que un hook comprometido no podrá reescribir el código que se ejecuta tras el
siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esta opción y produce un bundle que instala sus
dependencias en el primer arranque, lo cual tarda entre 40 y 60 segundos por arranque y
requiere que el montaje tenga permisos de escritura.

Para un despliegue real, es preferible empaquetar ambos dentro de una imagen, lo cual
además fija exactamente lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.28.2
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas faltantes en el arranque, incluidas las de tus colecciones.**
`REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, que es aditivo en todo el
esquema: crea las tablas, columnas y tipos enum que falten, y aplica su seguridad a nivel
de fila. Un primer arranque contra una base de datos vacía se inicia sirviendo tus colecciones,
sin ningún paso adicional.

Lo que `ensure` deliberadamente nunca hace es cambiar nada que ya exista. No altera el tipo
de una columna, no elimina una tabla o columna, y no edita las etiquetas de un enum existente
—porque el reinicio de un contenedor no debe poder remodelar un esquema como efecto secundario
de un despliegue.

Por lo tanto, aún vale la pena ejecutar `rebase db push` para lo que el arranque no modifica
—cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restrictivo,
un campo eliminado.

```bash
rebase db push
```

Ejecútalo desde una copia local o un job de CI, apuntando a la base de datos del despliegue.
Primero realiza una simulación (dry-run) del cambio, rechaza los destructivos sin confirmación
explícita y puede realizar una copia de seguridad antes de aplicarlos. La base de datos expone
un puerto en el archivo compose para que se pueda acceder a ella desde el host; elimina ese mapeo
una vez que el esquema esté en su lugar si la base de datos no debe ser accesible desde el exterior.

`REBASE_MIGRATE_ON_BOOT` acepta `ensure` y `none`, y nada más —la imagen **se niega a arrancar**
con `push`, por la razón explicada anteriormente.

## Cuando solo tu proceso de cambios puede modificar la base de datos

`REBASE_MIGRATE_ON_BOOT=none` no modifica tus colecciones. Pero no deja intacta la base de
datos: las tablas propias del framework (autenticación, API keys, jobs, cron) se siguen creando
y manteniendo actualizadas en cada arranque. Cuando la base de datos solo deba modificarse
mediante un proceso de cambios revisado, establece `REBASE_PROVISION=false` en cada proceso
que sirva tráfico:

| Configuración | Tablas de colecciones y políticas | Tablas del framework |
|---|---|---|
| por defecto (`REBASE_MIGRATE_ON_BOOT=ensure`) | se crean y mantienen actualizadas al arrancar | se crean y mantienen actualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | no se modifican | se crean y mantienen actualizadas |
| `REBASE_PROVISION=false` | no se modifican | no se modifican; lo que falte se indica en los registros |

Con el aprovisionamiento desactivado, el runtime no crea ni altera nada: ninguna tabla, columna,
índice, función, trigger, política, rol o permiso (grant). Esto se aplica en el arranque y
posteriormente, incluidas las tablas que un proceso en servicio crearía en su primer uso
(claves de idempotencia, reservas de cron, contadores compartidos de límite de tasa). En su lugar,
lee lo que ya existe:

- **Faltan tablas de autenticación o una columna que la autenticación lee:** el arranque
  se rechaza y enumera cada una de ellas.
- **El rol de las peticiones puede acceder a una tabla del framework** como
  `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza e imprime el
  comando `REVOKE` que se debe ejecutar. Un arranque con aprovisionamiento revoca esos
  privilegios automáticamente. Con el aprovisionamiento desactivado, nada lo hace.
- **Falta una tabla opcional** (API keys, claves de idempotencia, reservas de cron,
  contadores de límite de tasa, presencia, historial de métricas): esa funcionalidad se
  desactiva y el registro indica qué tabla necesita.

Las filas continúan cambiando, como ocurriría en cualquier base de datos: inicios de sesión,
sesiones, uso de API keys, claves de idempotencia, reservas de cron. La primera cuenta de administrador
(`REBASE_ADMIN_EMAIL`) se inicializa mediante la ejecución de aprovisionamiento, no por los
procesos en servicio. La [edición de esquemas en vivo](/docs/backend/live-schema-editing) aún
puede guardar un cambio en el código fuente, pero se negará a aplicarlo a la base de datos.

### La ejecución de aprovisionamiento

El esquema proviene de una ejecución controlada por tu proceso de cambios. Usa la misma imagen
y el mismo bundle que el servidor, con `REBASE_PROVISION_ONLY=true`, conectado con un rol que
tenga permisos para crear en la base de datos. `REBASE_PROVISION_SQL_OUT` guarda cada cambio
de esquema realizado por la ejecución como un script SQL:

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
comprobaciones de entorno que el servidor, incluidas `CORS_ORIGINS` o `FRONTEND_URL`, aunque no
sirva nada.

El script es un registro, no un plan: cada sentencia en él se ejecutó, en orden, y tuvo éxito.
Registrado contra una base de datos vacía, constituye el esquema completo que la versión necesita.
Registrado contra una copia restaurada de producción, es exactamente la actualización. Las filas
que la ejecución escribió no están incluidas en él. Revísalo y luego aplícalo a la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Hazlo nuevamente para cada actualización de Rebase, antes de actualizar los procesos en servicio.
Una nueva versión puede agregar una tabla o columna, y un proceso que no tenga permisos para
crearla informará de que falta en lugar de crearla.

Un servidor que construyas tú mismo sigue la misma regla: `initializeRebaseBackend` lee
`REBASE_PROVISION`, y `createRebaseBackend` acepta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es deliberado:
la alternativa predeterminada es el sistema de archivos del contenedor, que pierde silenciosamente
cada archivo subido en el siguiente reinicio. Las subidas se rechazan con
`501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) además de su bucket y credenciales —el
archivo compose lista las variables, comentadas. `gcs` carga
`@google-cloud/storage`, que la imagen oficial no incluye, por lo que en esa imagen
debes acceder a Google Cloud Storage a través de su endpoint compatible con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, claves HMAC).

Para disco local, lo cual solo es apropiado cuando la ruta es un volumen real que
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
descarta en lugar de registrarse, porque la alternativa serían subidas exitosas en un sistema
de archivos a punto de ser destruido. Esta variable es la forma en que confirmas que el
montaje es duradero.

Monta el volumen **por encima** de `STORAGE_PATH`, no en él. `STORAGE_PATH` es el
directorio del bucket por defecto, y cada bucket declarado en `config/resources.ts`
obtiene el suyo propio al lado, `<STORAGE_PATH>__<key>`. Un volumen montado directamente en
`STORAGE_PATH` solo albergará el bucket por defecto. Cualquier otro bucket escribirá en el
sistema de archivos del contenedor y perderá sus archivos cuando este se vuelva a crear.
`STORAGE_PATH__MEDIA` puede mover un bucket a otra ubicación en el volumen. No puede
moverlo dentro del directorio de otro bucket, como `/storage/uploads/media`, porque entonces
el bucket por defecto listaría, serviría y eliminaría sus archivos.

La imagen crea
`/storage` para el usuario sin privilegios `node` con el que se ejecuta, por lo que el
volumen va allí. Un volumen montado donde la imagen no tiene un directorio pertenece a root,
y cada subida fallará con `EACCES`. El archivo compose que escribe `rebase init`
lo monta de esta manera.

### El almacenamiento necesita un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue defina cómo se protegen los objetos. El almacenamiento no está
protegido por seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano,
por lo que sin ninguna regla lo único que separa los archivos de dos usuarios es la impredecibilidad
de las claves —algo que `GET /storage/list?prefix=` invalida. Cualquiera de las siguientes
opciones satisface este requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto,
  que es la solución real y lo que el scaffolding incluye en `config/storage.ts` —ninguna
  variable de entorno puede expresar "este usuario puede leer esta clave";
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente funciona como una CDN pública
  de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino
  (single-tenant) donde se confía en cualquier cuenta autenticada para acceder a todos los archivos.

Fuera de producción, esta misma condición emite una advertencia visible en lugar de un rechazo,
por lo que este es un fallo de arranque con el que te encontrarás en el despliegue y no en tu máquina
local. Es deliberado: el fallo al que reemplaza es silencioso.

Define también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se establece, los secretos
almacenados del autenticador se cifran con `JWT_SECRET` —por lo que rotarlo cerrará la sesión
de todos *y además* hará que todos los dispositivos vinculados no se puedan descifrar.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier sistema que
ejecute contenedores funcionará. Dos cosas que deben configurarse correctamente en cualquier lugar:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`), con sus
   dependencias instaladas junto a él —consulta [Dependencias](#dependencias).
2. Define `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega a iniciar en
   producción sin ellos en lugar de adivinar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.28.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa el formato de imagen derivada anterior para que el bundle se distribuya con la aplicación,
y luego ejecuta `fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, define las variables de entorno y establece
la ruta del health check en `/livez`.

### Un VPS estándar

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` enumera las variables que lee. Bajo systemd —las
dos líneas `REBASE_ADMIN_*` requieren la versión 0.18 o posterior; en 0.17.3 la primera cuenta
en registrarse se convierte en administrador en su lugar:

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

`NODE_ENV=production` no es una mera decoración. Si no se establece, el proceso se ejecuta en
modo de desarrollo: refleja orígenes de localhost, sirve la especificación OpenAPI y
**deja abierta la ventana del primer administrador** —de modo que el primer desconocido en encontrar
el formulario de registro se convertirá en administrador. Las dos líneas `REBASE_ADMIN_*` son las
que reemplazan esa ventana; consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está ahí porque la base de datos se encuentra en la
misma máquina. En producción, el runtime rechaza cualquier variable que apunte a
localhost —en un contenedor, el bucle local (loopback) es el contenedor mismo, por lo que esa
dirección siempre es un error— y esta línea le indica que esa dirección es intencional.
Elimínala cuando la base de datos se ejecute en otro lugar.

Es preferible usar `EnvironmentFile=/etc/rebase.env` con el archivo en permisos 0600 en
lugar de líneas `Environment=` para los secretos: un archivo de unidad puede ser leído por
cualquiera y `systemctl show` muestra cada valor de `Environment=`.

## Connection pooling

El runtime mantiene un pool pequeño y de larga duración, por lo que no necesita un pooler. Lo
que sí lo necesita es todo lo demás que se comunica con la misma base de datos y no puede retener
una conexión: una función serverless, un script programado, una herramienta de BI, o un worker
de colas que escala a cincuenta instancias. El `max_connections` de Postgres es un límite estricto
en los cientos bajos y cada conexión es un *proceso*, por lo que un despliegue masivo de lambdas lo
agotará mucho antes de que la base de datos esté realmente ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, protegido tras un perfil para
que un despliegue sin tales clientes no ejecute un proceso que no necesita:

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

La autenticación del cliente se genera a partir de `DATABASE_URL` al iniciar, por lo que la
contraseña no se escribe dos veces. El pooler se autentica en Postgres con
`scram-sha-256`, que Postgres 18 almacena —el valor `md5` por defecto de la imagen provoca que el
inicio de sesión del *servidor* falle con `FATAL: server login failed: wrong password type`, lo
cual parece indicar una contraseña incorrecta sin serlo.

Mantén la suma de `PGBOUNCER_POOL_SIZE` en todos los poolers holgadamente por debajo del
`max_connections` de la base de datos —el runtime se nutre del mismo presupuesto de conexiones.

### Qué cambia con el pooling por transacciones

Un cliente bajo el pool retiene una conexión del servidor durante la duración de una transacción y
luego la devuelve, lo que permite que 500 clientes compartan 20 conexiones. Tres cosas dejan de
funcionar a través de ese puerto, y cada una de ellas es algo que el propio Rebase utiliza —razón
exacta por la cual el runtime se conecta directamente y este puerto queda reservado para otros
clientes:

- **`LISTEN`/`NOTIFY`.** Realtime está construido sobre esto, y un listener necesita una
  conexión que sobreviva a una transacción. `LISTEN` es *aceptado* a través del pooler —este
  responde a `LISTEN`, pero luego ninguna notificación llega jamás.
- **Estado de sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos (advisory locks)
  mantenidos entre sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción
  puede recaer en una conexión de servidor diferente, que no verá nada de eso. Ambos fallan de la
  misma manera engañosa: con un único cliente inactivo el estado suele permanecer, por lo que
  funciona mientras pruebas y deja de funcionar bajo la concurrencia para la cual introdujiste el pooler.
- **Prepared statements a nivel de protocolo.** A la mayoría de los controladores se les puede
  indicar que no los utilicen —node-postgres no lo hace por defecto; asyncpg necesita
  `statement_cache_size=0`.

`SET LOCAL` tiene alcance de transacción y sí funciona, que es con lo que se configura la
seguridad a nivel de fila —por lo que RLS se comporta de manera idéntica a través del puerto
con pool.

Deja el perfil desactivado si nada fuera del runtime se conecta a tu base de datos.
Un puerto sin uso es superficie de ataque.

## Health checks

| Ruta | Uso |
| --- | --- |
| `/livez` | Liveness. Responde "¿está vivo este proceso?" sin consultar la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta (round-trip) a la base de datos y reporta la latencia. |

Apunta los sondeos de liveness a `/livez`. Un sondeo de liveness en `/health` reiniciará un
proceso perfectamente sano durante una breve interrupción en la base de datos, lo cual es opuesto
a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuento de solicitudes e histogramas de latencia
desglosados por superficie de API (datos, autenticación, almacenamiento, funciones) y colección,
además de indicadores (gauges) del proceso. Sin un token, el endpoint es legible por cualquiera que
pueda acceder al puerto, así que define uno a menos que se encuentre en una red privada.

`rebase_db_pool_wait_ms` es un histograma de cuánto tiempo esperó cada consulta por una conexión
del pool de base de datos, incluyendo la apertura de una nueva conexión, etiquetado por la clave de la
fuente de datos (`source="(default)"` en un proyecto que no declare fuentes de datos). Un pool en buen
estado lo mantiene cerca de cero. Una cola que crece con el tráfico indica que las solicitudes están
esperando conexiones —con frecuencia retenidas por callbacks de escritura que esperan algo lento;
consulta [Un callback retiene una conexión](/docs/collections/context-data-api/#a-callback-holds-a-connection).

La propia base de datos, por fuente de datos:

| Métrica | Qué dice |
|---------|----------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Las conexiones de cada pool, etiquetadas `pool="primary"`, `"read"` (la réplica) o `"session"` (el pool directo de la consola SQL detrás de un pooler). `waiting` por encima de cero durante mucho tiempo es un pool demasiado pequeño para su carga. |
| `rebase_db_connection_errors_total` | Peticiones respondidas con 503 por falta de conexión, por `code`: `53300` / `53400` (el servidor se ha quedado sin conexiones), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexiones de clientes en el servidor, por `state`, frente a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | El tamaño de la base de datos. |
| `rebase_db_replica_lag_seconds` | Cuánto va `DATABASE_READ_URL` por detrás de la principal. |

Las cuatro últimas se muestrean cada 30 segundos en la propia conexión de la instancia, así que un scrape nunca se convierte en una consulta.

`rebase_realtime_*` reporta los sockets abiertos, los canales y las tramas enviadas al bus de canales o
retenidas de cada instancia: consulta [Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Encabezados de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000`
(180 días). El encabezado HSTS omite `includeSubDomains`: eso indicaría a los navegadores rechazar
HTTP plano en cada subdominio de tu dominio, incluidos aquellos con los que este servidor no tiene
relación alguna, y el navegador lo conservaría durante el tiempo que especifique el encabezado.
Establece `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios sean exclusivamente HTTPS;
hasta la versión 0.23 inclusive, el encabezado siempre incluía `includeSubDomains`.

`strict-origin-when-cross-origin` es el valor predeterminado de los propios navegadores: una solicitud a
otro sitio transmite tu origen y nunca la ruta o consulta de la página. No es `no-referrer` porque las
comprobaciones de origen necesitan el origen —el botón de inicio de sesión de Google lo compara con los
orígenes de JavaScript autorizados del cliente OAuth, y bajo `no-referrer` respondía "The given origin
is not allowed for the given client ID" en cada aplicación, sin importar lo que el cliente permitiera.
Una respuesta que define su propia política la conserva (la página de consentimiento de MCP envía
`no-referrer`); una página que desee una más estricta puede indicarlo con `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` funciona del mismo modo: `SAMEORIGIN` a menos que la respuesta defina el suyo propio, como
hace la página de consentimiento de MCP con `DENY`.

Las aplicaciones estáticas —la administración del CMS y cualquier frontend que sirva el bundle— también
llevan `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Esto
determina quién puede incrustar la aplicación en marcos, descarta complementos y fija `<base>` a tu origen,
sin restringir nada más, por lo que los scripts en línea, workers y el inicio de sesión de terceros continúan
funcionando. Una respuesta que defina su propia política la conserva. Para requerimientos más estrictos,
aplica la política en el proxy inverso situado delante.

## Más de una instancia

Un contenedor es el valor predeterminado y no necesita nada más. Antes de que una segunda réplica
reciba tráfico —o de que un despliegue progresivo (rolling deploy) ejecute dos en paralelo—, revisa
[Ejecutar más de una instancia](/docs/deployment/multiple-instances/): los límites de tasa,
canales de difusión, archivos locales, subidas reanudables y la caché de imágenes operan por proceso
hasta que una configuración los comparta.

## Conectar Claude

Un comando añade este servidor al [conector de Rebase](/docs/ai/rebase-connector/),
el conector MCP único que accede a todos tus proyectos desde Claude:

```bash
rebase cloud connect https://your-app.com
```

Establece las dos variables que muestra en este servidor y reinícialo. El servidor debe
ejecutar Rebase 0.28.1 o posterior y responder a través de https en una dirección pública. Nada
más cambia: no guarda ningún secreto y concede al conector los mismos permisos que otorgaría Studio.

## Ejecutar funciones en su propio proceso

Todo lo anterior consiste en un único contenedor que sirve el proyecto completo, lo cual es la
arquitectura adecuada para casi cualquier despliegue. Cuando una función personalizada deba dejar
de competir con la API de datos por el event loop —o deba escalar, reiniciarse y fallar de forma
independiente—, la misma imagen y el mismo bundle se pueden arrancar como varios procesos
cooperativos. Consulta [Procesos divididos](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.28.2
```

Reinicia. Tu bundle permanece inalterado. Dentro de una misma versión mayor del contrato del
runtime, un bundle que haya sido validado seguirá funcionando —consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
