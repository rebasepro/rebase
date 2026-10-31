---
sourceHash: caa4e79614f7401e
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen de runtime oficial y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS básico.
---

## Descripción general

Autoalojar Rebase significa ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que compilar**. Tu proyecto viaja como un
bundle, el runtime está publicado y actualizar Rebase es un simple cambio de
etiqueta en lugar de una recompilación. Consulta [Runtime y bundles](/docs/architecture/runtime-and-bundles/)
para saber por qué está dividido de esa manera.

## Docker Compose

**Si tu proyecto proviene de `rebase init`, usa su propio `docker-compose.yml`.**
Está en tu repositorio, `init` completó sus secretos, su primera cuenta de
administrador y su versión fija del runtime, y es el archivo que describe
[Despliegue](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

El resto de esta página trata sobre el mismo despliegue sin un andamiaje
(scaffold) detrás —el proyecto de otra persona, un bundle compilado en CI o las
dos cosas que el archivo generado omite deliberadamente: un concentrador de
conexiones (connection pooler) y las configuraciones de procesos divididos. Ese
archivo se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Úsalo en lugar de copiar un fragmento de esta página: ambos archivos son
arrancados por el propio control de aceptación (acceptance gate) del proyecto en
cada push, por lo que ninguno puede desfasarse de lo que realmente funciona.

Ambos coinciden en todas las variables de entorno excepto en la contraseña de la
base de datos, y eso se debe a que cada uno está diseñado para su propio origen:
este lee `POSTGRES_PASSWORD`, que `quickstart.sh` genera; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incrusta en la `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas evidentes y muestra ambas
por pantalla. La forma extendida, si prefieres controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado; `api` espera a su
comprobación de salud (healthcheck).

### Los seis valores que necesita

`quickstart.sh` genera estos valores por ti. Para escribir el `.env` tú mismo:

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

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más
  adelante implica cambiarla también en el volumen, así que elígela una sola vez.
- **`JWT_SECRET`** — firma cada sesión. Rotarla cerrará la sesión de todos.
- **`REBASE_SERVICE_KEY`** — la credencial que elude la seguridad a nivel de
  fila (row-level security) para llamadas entre servidores. Trátala como una
  contraseña de root: cualquier cosa que la posea puede leer todas las filas.
- **`CORS_ORIGINS`** — los orígenes desde los que se sirve tu frontend,
  separados por comas. No es un secreto y no es opcional: el runtime se niega a
  iniciar en producción sin él en lugar de adivinar, porque una API que adivina
  sus orígenes permitidos tarde o temprano permitirá el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — el primer
  administrador. Una base de datos nueva no tiene usuarios, y fuera de
  producción la política de registro admite el primer registro y lo asciende a
  administrador; de lo contrario, una base de datos vacía es un callejón sin
  salida, porque inicializar un administrador requiere un cliente que ya haya
  iniciado sesión. En el momento en que este stack responde en un nombre de host,
  esa comodidad se convierte en una carrera que el operador puede perder, por lo
  que en producción esa ventana se cierra y la cuenta se define aquí. El runtime
  la crea una vez, mientras la tabla de usuarios esté vacía, y no hace nada en
  cada arranque posterior.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener al menos 32 caracteres cada uno,
y la contraseña de administrador al menos 12. Usa una dirección con un punto en
su dominio: `POST /auth/login` analiza su cuerpo con `z.string().email()`, por lo
que el runtime se niega a sembrar `admin@localhost` —una cuenta en la que nadie
podría iniciar sesión— y en su lugar registra el motivo en los logs. El archivo
compose declara los seis con `${VAR:?…}`, por lo que si falta alguno, detiene el
stack con un mensaje indicando su nombre en lugar de iniciar algo a medio
configurar; además, el autorregistro viene desactivado
(`DISABLE_SELF_REGISTRATION`, valor predeterminado `true`), por lo que no queda
nada que pueda ser reclamado.

Inicia sesión con esas credenciales y cambia la contraseña: están guardadas en
un archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto dentro del bundle** de
forma predeterminada, por lo que `dist-bundle` llega con un `node_modules` y un
`package-lock.json` junto a su `package.json`. Un bundle empaquetado (vendored)
se inicia en unos cinco segundos.

Como ya están allí, puedes montar el bundle en modo de solo lectura; vale la pena
hacerlo, ya que un hook comprometido no podrá reescribir el código que se ejecuta
tras el siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y produce un bundle que, en su lugar,
instala sus dependencias en el primer arranque, lo que tarda entre 40 y 60
segundos por inicio y requiere que el montaje tenga permisos de escritura.

Para un despliegue real, es preferible incorporar ambos directamente en una
imagen, lo que además fija con exactitud lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.26.0
COPY dist-bundle /bundle
```

## Crear el esquema

**El runtime crea las tablas que faltan al arrancar, incluidas las de tus colecciones.**
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo
en todo el esquema: crea tablas, columnas y tipos enum faltantes, y aplica su
seguridad a nivel de fila. Un primer inicio contra una base de datos vacía
arranca sirviendo tus colecciones, sin ningún paso adicional.

Lo que `ensure` nunca hace deliberadamente es cambiar nada que ya exista. No
altera el tipo de una columna, no elimina una tabla ni una columna, y no edita
las etiquetas de un enum existente —porque el reinicio de un contenedor no debe
poder remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, aún vale la pena ejecutar `rebase db push` para lo que el arranque
no toca: cualquier cambio que no sea puramente aditivo, como una columna
renombrada, un tipo restringido o un campo eliminado.

```bash
rebase db push
```

Ejecútalo desde una copia local del repositorio o un trabajo de CI, apuntando a
la base de datos del despliegue. Realiza una prueba preliminar (dry-run) del
cambio primero, rechaza los cambios destructivos sin confirmación explícita y
puede realizar una copia de seguridad antes de aplicar. La base de datos expone
un puerto en el archivo compose para que se pueda acceder a ella desde el host;
elimina ese mapeo una vez que el esquema esté listo si la base de datos no debe
ser accesible desde el exterior.

`REBASE_MIGRATE_ON_BOOT` acepta `ensure` y `none`, y nada más: la imagen **se
niega a arrancar** con `push`, por la razón mencionada anteriormente.

## Cuando solo tu proceso de cambios puede modificar la base de datos

`REBASE_MIGRATE_ON_BOOT=none` no toca tus colecciones. Pero no deja intacta la
base de datos: las tablas propias del framework (autenticación, claves de API,
trabajos, cron) se siguen creando y manteniendo actualizadas en cada arranque.
Cuando la base de datos solo deba modificarse a través de un proceso de cambios
revisado, establece `REBASE_PROVISION=false` en cada proceso que atienda
peticiones:

| Configuración | Tablas y políticas de colecciones | Tablas del framework |
|---|---|---|
| por defecto (`REBASE_MIGRATE_ON_BOOT=ensure`) | creadas y mantenidas actualizadas al arrancar | creadas y mantenidas actualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | no se tocan | creadas y mantenidas actualizadas |
| `REBASE_PROVISION=false` | no se tocan | no se tocan; cualquier elemento faltante se indica en los logs |

Con el aprovisionamiento desactivado, el runtime no crea ni altera nada: ninguna
tabla, columna, índice, función, disparador (trigger), política, rol o permiso
(grant). Esto se aplica al arrancar y con posterioridad, incluidas las tablas que
un proceso en ejecución crearía habitualmente en su primer uso (claves de
idempotencia, reclamaciones de cron, contadores compartidos de límite de tasa).
En su lugar, lee lo que ya existe:

- **Faltan tablas de autenticación o una columna que la autenticación lee:** el
  arranque se rechaza y lista cada una de ellas.
- **El rol de petición puede acceder a una tabla del framework** como
  `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza e imprime
  la sentencia `REVOKE` que se debe ejecutar. Un arranque con aprovisionamiento
  revoca esos privilegios por su cuenta. Con el aprovisionamiento desactivado,
  nada lo hace.
- **Falta una tabla opcional** (claves de API, claves de idempotencia,
  reclamaciones de cron, contadores de límite de tasa, presencia, historial de
  métricas): esa función se desactiva y el log indica qué tabla necesita.

Las filas se siguen modificando, como ocurriría en cualquier base de datos:
inicios de sesión, sesiones, uso de claves de API, claves de idempotencia,
reclamaciones de cron. La primera cuenta de administrador (`REBASE_ADMIN_EMAIL`)
es sembrada por la ejecución de aprovisionamiento, no por los procesos que
atienden peticiones. La [edición de esquemas en vivo](/docs/backend/live-schema-editing)
todavía puede registrar un cambio en el código fuente, pero se niega a aplicarlo
a la base de datos.

### La ejecución de aprovisionamiento

El esquema proviene de una ejecución controlada por tu proceso de cambios. Usa
la misma imagen y bundle que el servidor, con `REBASE_PROVISION_ONLY=true`,
conectado como un rol con permisos de creación en la base de datos.
`REBASE_PROVISION_SQL_OUT` guarda cada cambio de esquema realizado durante la
ejecución en un script SQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

El script es un registro, no un plan: cada sentencia en él se ejecutó, en orden y
con éxito. Registrado contra una base de datos vacía, representa todo el esquema
que la versión necesita. Registrado contra una copia restaurada de producción, es
exactamente la actualización. Las filas que escribió la ejecución no están en
él. Revísalo y luego aplícalo a la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repite este proceso para cada actualización de Rebase, antes de actualizar los
procesos que atienden peticiones. Una versión puede añadir una tabla o una
columna, y un proceso que no tenga permisos para crearla informará de que falta
en lugar de crearla.

Un servidor que compiles tú mismo sigue la misma regla: `initializeRebaseBackend`
lee `REBASE_PROVISION`, y `createRebaseBackend` acepta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y
esto es deliberado: la alternativa predeterminada es el sistema de archivos del
contenedor, que pierde silenciosamente cada archivo subido en el siguiente
reinicio. Las subidas se rechazan con `501 STORAGE_NOT_CONFIGURED` hasta que
configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) junto con su bucket y
credenciales; el archivo compose lista las variables comentadas. `gcs` carga
`@google-cloud/storage`, paquete que la imagen oficial no incluye, por lo que en
esa imagen accede a Google Cloud Storage mediante su endpoint compatible con S3
en su lugar (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`,
claves HMAC).

Para disco local, que solo es apropiado cuando la ruta es un volumen real que
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

`FORCE_LOCAL_STORAGE` no es opcional allí: en producción, un backend `local` se
descarta en lugar de registrarse, porque la alternativa serían subidas exitosas
en un sistema de archivos a punto de ser destruido. Esta variable es la forma de
indicar que el montaje es duradero.

Monta el volumen **por encima** de `STORAGE_PATH`, no en él. `STORAGE_PATH` es el
directorio del bucket por defecto, y cada bucket declarado en
`config/resources.ts` obtiene el suyo junto a este, `<STORAGE_PATH>__<key>`. Un
volumen en el propio `STORAGE_PATH` solo almacena el bucket predeterminado.
Cualquier otro bucket escribirá en el sistema de archivos del contenedor y
perderá sus archivos cuando el contenedor se vuelva a crear.
`STORAGE_PATH__MEDIA` puede mover un bucket a otro lugar del volumen. No puede
moverlo dentro del directorio de otro bucket, como `/storage/uploads/media`,
porque entonces el bucket por defecto listaría, serviría y eliminaría sus
archivos.

La imagen crea `/storage` para el usuario sin privilegios `node` bajo el que se
ejecuta, motivo por el cual el volumen va allí. Un volumen montado donde la imagen
no tiene ningún directorio pertenecerá a root y cada subida fallará con
`EACCES`. El archivo compose que genera `rebase init` lo monta de esta manera.

### El almacenamiento necesita un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en
producción** hasta que el despliegue declare cómo se protegen los objetos. El
almacenamiento no está sujeto a la seguridad a nivel de fila y sus claves
comparten un único espacio de nombres plano, por lo que sin ninguna regla lo
único que separa los archivos de dos usuarios es la imposibilidad de adivinar las
claves —lo cual queda anulado por `GET /storage/list?prefix=`. Cualquiera de estas
opciones lo satisface:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu
  proyecto, que es la respuesta real y lo que incluye el andamiaje en
  `config/storage.ts` —ninguna variable de entorno puede expresar "este usuario
  puede leer esta clave";
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente funciona como una
  CDN pública de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo
  inquilino (single-tenant) donde se confía en cualquier cuenta que haya iniciado
  sesión para acceder a cada archivo.

Fuera de producción, esta misma condición genera una advertencia visible en lugar
de un rechazo, por lo que este es un fallo de arranque con el que te toparás en
el despliegue y no en tu máquina local. Es deliberado: el fallo que sustituye es
silencioso.

Configura también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se establece, los
secretos del autenticador almacenados se cifran con `JWT_SECRET`, por lo que
rotarlo cerrará la sesión de todos *y además* hará que todos los dispositivos
vinculados no se puedan descifrar.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que
cualquier sistema que ejecute contenedores sirve. Hay dos cosas que debes
configurar correctamente en cualquier lugar:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él —consulta [Dependencias](#dependencias).
2. Configura `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega
   a arrancar en producción sin ellos en lugar de adivinar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.26.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la forma de imagen derivada descrita anteriormente para que el bundle se
distribuya con la aplicación, y luego ejecuta `fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, define las variables de entorno y
establece la ruta de comprobación de salud (health check) en `/livez`.

### Un VPS básico

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` muestra las variables que lee. Bajo systemd —las dos
líneas `REBASE_ADMIN_*` requieren la versión 0.18 o posterior, y en la 0.17.3 la
primera cuenta en registrarse se convierte en el administrador en su lugar:

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

`NODE_ENV=production` no es un mero adorno. Si no se establece, el proceso se
ejecuta en modo de desarrollo: refleja orígenes de localhost, sirve la
especificación OpenAPI y **deja abierta la ventana del primer administrador**,
por lo que el primer desconocido que encuentre el formulario de registro se
convertirá en administrador. Las dos líneas `REBASE_ADMIN_*` son las que
reemplazan esa ventana; consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque la base de datos se
encuentra en la misma máquina. En producción, el runtime rechaza cualquier
variable que apunte a localhost —en un contenedor, loopback es el propio
contenedor, por lo que esa dirección siempre es un error— y esta línea le indica
que esa dirección es intencionada. Elimínala cuando la base de datos se ejecute en
otro lugar.

Prefiere `EnvironmentFile=/etc/rebase.env` con el archivo en modo 0600 en lugar de
líneas `Environment=` para los secretos: un archivo de unidad es legible por todos
los usuarios del sistema y `systemctl show` muestra cada valor de `Environment=`.

## Concentración de conexiones (Connection pooling)

El runtime mantiene un pool pequeño y persistente y no necesita un pooler. Lo
que sí lo necesita es todo lo demás que se comunica con la misma base de datos y
no puede retener una conexión: una función serverless, un script programado, una
herramienta de BI, un worker de cola que escala a cincuenta instancias. El
parámetro `max_connections` de Postgres es un límite estricto en el rango de los
cientos bajos y cada conexión es un *proceso*, por lo que un despliegue masivo de
lambdas lo agotará mucho antes de que la base de datos esté realmente ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, detrás de un
perfil para que un despliegue sin tales clientes no ejecute un proceso que no
necesita:

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

La autenticación del cliente se genera a partir de `DATABASE_URL` al iniciar, por
lo que la contraseña no se escribe dos veces. El pooler se autentica en Postgres
mediante `scram-sha-256`, que es lo que almacena Postgres 18 —el valor
predeterminado `md5` de la imagen hace fallar el inicio de sesión del *servidor*
con `FATAL: server login failed: wrong password type`, lo cual parece un error de
contraseña incorrecta pero no lo es.

Mantén la suma de `PGBOUNCER_POOL_SIZE` de todos los poolers holgadamente por
debajo de `max_connections` de la base de datos —el runtime consume del mismo
presupuesto.

### Qué cambia con la concentración a nivel de transacción (transaction pooling)

Un cliente conectado a través del pool retiene una conexión del servidor solo
durante la transacción y luego la devuelve, que es lo que permite que 500
clientes compartan 20 conexiones. Hay tres cosas que dejan de funcionar a través
de ese puerto, y cada una de ellas es algo que Rebase utiliza internamente —razón
por la cual el runtime se conecta directamente y este puerto queda reservado para
otros clientes:

- **`LISTEN`/`NOTIFY`.** El sistema Realtime se basa en ello, y un listener
  necesita una conexión que sobreviva a una transacción. `LISTEN` es *aceptado* a
  través del pooler —responde afirmativamente a `LISTEN`, pero después nunca llega
  ninguna notificación.
- **Estado de sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos
  consultivos (advisory locks) mantenidos a través de sentencias, cursores `WITH
  HOLD`, tablas temporales. La siguiente transacción puede recaer en una
  conexión de servidor diferente, que no verá nada de eso. Ambos casos fallan de
  la misma forma engañosa: con un único cliente inactivo, el estado generalmente
  sigue allí, por lo que funciona mientras haces pruebas y deja de funcionar bajo
  la concurrencia para la cual introdujiste el pooler.
- **Sentencias preparadas a nivel de protocolo (Protocol-level prepared statements).**
  A la mayoría de los controladores se les puede indicar que no las usen
  —node-postgres no las usa por defecto; asyncpg necesita
  `statement_cache_size=0`.

`SET LOCAL` tiene ámbito de transacción y funciona, que es con lo que se
configura la seguridad a nivel de fila —por lo que RLS se comporta de manera
idéntica a través del puerto del pool.

Deja el perfil desactivado si nada fuera del runtime se conecta a tu base de
datos. Un puerto sin usar es superficie de ataque.

## Comprobaciones de salud (Health checks)

| Ruta | Uso |
| --- | --- |
| `/livez` | Supervivencia (Liveness). Responde a "¿está vivo este proceso?" sin consultar la base de datos. |
| `/health` | Disponibilidad (Readiness). Realiza un ciclo completo de ida y vuelta a la base de datos e informa de la latencia. |

Apunta los sondeos de liveness (supervivencia) a `/livez`. Un sondeo de liveness
en `/health` reiniciará un proceso perfectamente sano durante un hipo momentáneo
de la base de datos, lo cual es lo opuesto a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuento de peticiones e histogramas
de latencia desglosados por superficie de API (datos, autenticación,
almacenamiento, funciones) y colección, además de indicadores (gauges) del
proceso. Sin un token, el endpoint es accesible por cualquiera que pueda alcanzar
el puerto, así que define uno a menos que esté en una red privada.

`rebase_db_pool_wait_ms` es un histograma de cuánto tiempo esperó cada consulta
por una conexión del pool de la base de datos, incluida la apertura de una nueva,
etiquetado por la clave del origen de datos (`source="(default)"` en un proyecto
que no declara fuentes de datos). Un pool saludable lo mantiene cerca de cero.
Una cola que crece con el tráfico indica que las peticiones están esperando
conexiones en cola —la mayoría de las veces retenidas por callbacks de escritura
que esperan algo lento; consulta [Un callback retiene una conexión](/docs/collections/context-data-api/#a-callback-holds-a-connection).

`rebase_realtime_*` informa sobre los sockets abiertos de cada instancia, los
canales y las tramas enviadas al bus de canales o retenidas: consulta [Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Encabezados de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000`
(180 días). El encabezado HSTS omite `includeSubDomains`: eso indicaría a los
navegadores que rechacen HTTP plano en cada subdominio de tu dominio, incluidos
aquellos con los que este servidor no tiene relación alguna, y un navegador lo
conserva durante todo el tiempo que especifique el encabezado.
Establece `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios sean
exclusivamente HTTPS; hasta la versión 0.23 inclusive, el encabezado siempre
incluía `includeSubDomains`.

`strict-origin-when-cross-origin` es el valor predeterminado de los propios
navegadores: una petición a otro sitio web transmite tu origen y nunca la ruta o
la consulta de la página. No es `no-referrer` porque las comprobaciones de origen
necesitan el origen —el botón de inicio de sesión de Google lo compara con los
orígenes de JavaScript autorizados del cliente OAuth, y bajo `no-referrer`
respondía "The given origin is not allowed for the given client ID" en todas las
aplicaciones, independientemente de lo que permitiera el cliente. Una respuesta
que define su propia política la conserva (la página de consentimiento de MCP
envía `no-referrer`); una página que requiera una más estricta puede indicarlo con
`<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funciona de la
misma manera: `SAMEORIGIN` a menos que la respuesta configure la suya propia,
como hace la página de consentimiento de MCP con `DENY`.

Las aplicaciones estáticas —el panel de administración del CMS y cualquier
frontend servido por el bundle— también incluyen `Content-Security-Policy:
frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Esto determina quién
puede incrustar la aplicación en marcos (iframes), descarta complementos (plugins)
y fija `<base>` a tu origen, sin restringir nada más, de modo que los scripts en
línea (inline scripts), workers y el inicio de sesión de terceros sigan
funcionando. Una respuesta que defina su propia política la conserva. Para
cualquier regla más estricta, configura la política en el proxy inverso situado
por delante.

## Más de una instancia

Un único contenedor es la opción por defecto y no necesita nada más. Antes de
que una segunda réplica reciba tráfico —o de que un despliegue continuo (rolling
deploy) ejecute dos en paralelo— revisa [Ejecutar más de una instancia](/docs/deployment/multiple-instances/):
los límites de tasa, los canales de difusión (broadcast), los archivos locales,
las subidas reanudables y la caché de imágenes son por proceso hasta que una
configuración los comparta.

## Ejecutar funciones en su propio proceso

Todo lo anterior consiste en un único contenedor que atiende a todo el proyecto,
que es la estructura adecuada para casi cualquier despliegue. Cuando una función
personalizada deba dejar de competir con la API de datos por el bucle de eventos
(event loop) —o deba escalar, reiniciarse y fallar de forma independiente— se
puede arrancar la misma imagen y el mismo bundle como varios procesos que
cooperan entre sí. Consulta [Procesos divididos](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.26.0
```

Reinicia. Tu bundle no cambia. Dentro de una versión principal (major) del
contrato del runtime, un bundle validado continúa funcionando —consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
