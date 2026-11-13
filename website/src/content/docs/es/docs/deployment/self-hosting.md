---
sourceHash: cfc9a95285da2353
title: Autohospedaje
sidebar_label: Autohospedaje
description: "Ejecute Rebase en cualquier lugar con la imagen de runtime oficial y el bundle de su proyecto: Docker Compose, Fly, Railway o un VPS básico."
---

## Descripción general

Autohospedar Rebase implica ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de su proyecto montado en ella.

**No hay ninguna imagen de aplicación que compilar**. Su proyecto se distribuye como un bundle,
el runtime está publicado y actualizar Rebase consiste en cambiar una etiqueta en lugar de
reconstruir la imagen. Consulte [Runtime and bundles](/docs/architecture/runtime-and-bundles/) para
saber por qué está dividido de esa manera.

## Docker Compose

**Si su proyecto se creó con `rebase init`, use su propio `docker-compose.yml`.**
Está en su repositorio, `init` rellenó sus secretos, su primera cuenta de administrador
y su versión fija del runtime, y es el archivo que describe
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

El resto de esta página trata sobre el mismo despliegue pero sin un scaffold detrás:
el proyecto de otra persona, un bundle compilado en CI o las dos cosas que el
archivo generado omite deliberadamente: un connection pooler y las configuraciones
de procesos divididos (split-process). Ese archivo reside en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilícelo en lugar de copiar un fragmento de esta página: ambos archivos son
iniciados por la propia puerta de aceptación (acceptance gate) del proyecto en cada push,
por lo que ninguno puede desviarse de lo que realmente funciona.

Ambos coinciden en todas las variables de entorno excepto en la contraseña de la
base de datos, y esto se debe a que cada uno está diseñado para su propio generador:
este lee `POSTGRES_PASSWORD`, que genera `quickstart.sh`; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incluye en el `DATABASE_URL` que
escribe en su `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas obvias y muestra ambas por pantalla.
La forma extendida, si prefiere controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesita iniciar la base de datos por separado: `api` espera a su healthcheck.

### Los seis valores que necesita

`quickstart.sh` genera estos valores por usted. Para escribir el `.env` usted mismo:

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

Tres secretos, un dato y la cuenta con la que inicia sesión:

- **`POSTGRES_PASSWORD`**: la contraseña de la base de datos. Cambiarla más
  adelante implica cambiarla también en el volumen, así que elíjala bien desde el principio.
- **`JWT_SECRET`**: firma cada sesión. Rotarlo cierra la sesión de todos los usuarios.
- **`REBASE_SERVICE_KEY`**: la credencial que elude la seguridad a nivel de fila
  (row-level security) para llamadas de servidor a servidor. Trátela como una contraseña
  de root: cualquier entidad que la posea puede leer todas las filas.
- **`CORS_ORIGINS`**: los orígenes desde los que se sirve su frontend, separados
  por comas. No es un secreto y no es opcional: en producción, el runtime se niega
  a iniciar sin este valor en lugar de intentar adivinarlo, porque una API que adivina
  sus orígenes permitidos tarde o temprano permitirá el equivocado.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`**: el primer
  administrador. Una base de datos nueva no tiene usuarios y, fuera de producción,
  la política de registro admite el primer registro y lo asciende a administrador;
  de lo contrario, una base de datos vacía es un callejón sin salida, porque configurar
  un administrador inicial requiere un emisor que ya haya iniciado sesión. En el
  momento en que este stack responde en un hostname, esa conveniencia se convierte en
  una carrera que el operador puede perder, por lo que en producción la ventana se
  cierra y la cuenta se define aquí. El runtime la crea una sola vez, mientras la
  tabla de usuarios esté vacía, y no hace nada en los inicios posteriores.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener al menos 32 caracteres cada uno, y
la contraseña de administrador al menos 12. Utilice una dirección con un punto en su
dominio: `POST /auth/login` valida su cuerpo con `z.string().email()`, por lo que el
runtime se niega a inicializar `admin@localhost` —una cuenta con la que nadie podría
iniciar sesión— y en su lugar registra el motivo en el log. El archivo compose
declara los seis con `${VAR:?…}`, de modo que si falta uno, el stack se detiene con
un mensaje indicándolo en lugar de iniciar algo a medio configurar, y el autoregistro
viene desactivado de fábrica (`DISABLE_SELF_REGISTRATION`, por defecto `true`), por lo
que no queda nada pendiente de reclamar.

Inicie sesión con esas credenciales y cambie la contraseña: están guardadas en un
archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de su proyecto en el bundle** por
defecto, por lo que `dist-bundle` se genera con un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle con dependencias integradas (vendored) se inicia en
unos cinco segundos.

Como ya están ahí, puede montar el bundle como de solo lectura; vale la pena
hacerlo, ya que un hook comprometido no podrá sobrescribir el código que se
ejecutará tras el siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y genera un bundle que instala sus
dependencias en el primer inicio, lo que tarda entre 40 y 60 segundos por inicio y
requiere que el montaje tenga permisos de escritura.

Para un despliegue real, es preferible empaquetar ambos en una imagen, lo que también
fija con exactitud lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Creación del esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que falten al arrancar, incluidas las que declara `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el
esquema: crea las tablas, columnas y tipos enum que falten, y aplica su seguridad a nivel
de fila. Un primer inicio con una base de datos vacía se pone en marcha sirviendo sus tablas,
sin ningún paso adicional.

Lo que `ensure` nunca hace deliberadamente es modificar nada que ya exista. No
altera el tipo de una columna, no elimina tablas ni columnas y no edita las etiquetas de un
enum existente; porque un reinicio de contenedor no debe poder alterar la estructura
de un esquema como efecto secundario de un despliegue.

Por lo tanto, aún vale la pena ejecutar `rebase db push` para lo que el arranque no
toca: cualquier cambio que no sea puramente aditivo (una columna renombrada, un tipo
restringido, un campo eliminado).

```bash
rebase db push
```

Ejecútelo desde una copia local del código o un trabajo de CI, apuntando a la base de
datos del despliegue. Primero realiza una simulación (dry-run) del cambio, rechaza los
cambios destructivos sin confirmación explícita y puede realizar una copia de seguridad
antes de aplicarlos. La base de datos expone un puerto en el archivo compose para que este
comando pueda alcanzarla desde el host; elimine ese mapeo una vez que el esquema esté
aplicado si la base de datos no debe ser accesible desde el exterior.

`REBASE_MIGRATE_ON_BOOT` solo admite `ensure` y `none` —la imagen **se niega a arrancar**
con `push`, por la razón mencionada anteriormente.

## Cuando solo su proceso de cambios puede modificar la base de datos

`REBASE_MIGRATE_ON_BOOT=none` no toca sus tablas. Pero no deja la base de datos
intacta: las tablas propias del framework (auth, API keys, jobs, cron) se siguen creando
y manteniendo actualizadas en cada arranque. Cuando la base de datos solo deba
modificarse a través de un proceso de control de cambios revisado, configure
`REBASE_PROVISION=false` en cada proceso que sirva peticiones:

| Configuración | Tablas y políticas declaradas | Tablas del framework |
|---|---|---|
| predeterminado (`REBASE_MIGRATE_ON_BOOT=ensure`) | se crean y se mantienen actualizadas al arrancar | se crean y se mantienen actualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | no se modifican | se crean y se mantienen actualizadas |
| `REBASE_PROVISION=false` | no se modifican | no se modifican; lo que falte se indica en el log |

Con el aprovisionamiento desactivado, el runtime no crea ni altera nada: ninguna tabla,
columna, índice, función, disparador (trigger), política, rol o permiso (grant). Esto se
aplica tanto en el arranque como posteriormente, incluidas las tablas que un proceso en
ejecución crearía habitualmente en su primer uso (claves de idempotencia, bloqueos de
cron, contadores compartidos de límite de peticiones). En su lugar, lee lo que ya existe:

- **Faltan tablas de autenticación o una columna que la autenticación necesita:** el
  arranque se rechaza y se enumeran cada una de ellas.
- **El rol de petición puede acceder a una tabla del framework** como
  `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza y muestra el
  `REVOKE` que se debe ejecutar. Un arranque con aprovisionamiento retira esos privilegios
  por sí mismo. Con el aprovisionamiento desactivado, nada lo hace.
- **Falta una tabla opcional** (API keys, claves de idempotencia, bloqueos de cron,
  contadores de límite de tasa, presencia, historial de métricas): esa funcionalidad se
  desactiva y el log indica qué tabla necesita.
- <span class="since-badge" data-since="0.31">Desde 0.31</span> **Una tabla declarada que la base de datos no protege**:
  seguridad a nivel de fila deshabilitada, ninguna de las políticas declaradas presente,
  o falta una política restrictiva declarada: esa tabla no se servirá (si falta una
  política permisiva, sí se sirve, emitiendo una advertencia en el arranque indicándola).
  Una petición a dicha tabla responderá con `503 TABLE_WITHHELD`, y el log de arranque
  indicará el SQL necesario para protegerla (o `rebase db push`). Las demás tablas se
  sirven con normalidad y el arranque continúa. Las tablas intermedias de muchos a muchos
  (junction tables) se verifican del mismo modo: si la base de datos no protege una de ellas,
  se retienen las tablas cuyas relaciones la utilicen, y `TABLE_WITHHELD` indicará el
  nombre de la unión. Una tabla cuya relación `via` pase por una tabla retenida también
  quedará retenida, y el mensaje nombrará la relación. Esto también aplica con
  `REBASE_MIGRATE_ON_BOOT=none` y durante una actualización del esquema en caliente
  (live schema refresh).

Las filas siguen cambiando, como ocurriría en cualquier base de datos: inicios de sesión,
sesiones, uso de API keys, claves de idempotencia, bloqueos de cron. La primera cuenta
de administrador (`REBASE_ADMIN_EMAIL`) es inicializada por la ejecución de
aprovisionamiento, no por los procesos que sirven peticiones. La
[edición del esquema en vivo](/docs/backend/live-schema-editing) aún puede confirmar un
cambio en el código fuente, pero se negará a aplicarlo a la base de datos.

### La ejecución de aprovisionamiento

El esquema proviene de una ejecución controlada por su proceso de cambios. Utilice
la misma imagen y bundle que el servidor, con `REBASE_PROVISION_ONLY=true`, conectado
como un rol con permisos de creación en la base de datos. `REBASE_PROVISION_SQL_OUT`
guarda cada cambio de esquema que realizó la ejecución como un script SQL:

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

La imagen se ejecuta con `NODE_ENV=production`, por lo que esta ejecución se somete a
las mismas comprobaciones de entorno que el servidor, incluidas `CORS_ORIGINS` o
`FRONTEND_URL`, aunque no sirva ninguna petición.

El script es un registro, no un plan: cada instrucción que contiene se ejecutó, en orden
y con éxito. Si se registra en una base de datos vacía, representa todo el esquema que
necesita la versión. Si se registra en una copia restaurada de producción, representa
exactamente la actualización. Las filas que la ejecución haya escrito no están en él.
Revíselo y luego aplíquelo a la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repita este proceso para cada actualización de Rebase, antes de desplegar gradualmente
los procesos que sirven tráfico. Una versión puede añadir una tabla o una columna, y un
proceso que no tenga permisos para crearla notificará que falta en lugar de crearla.

Un servidor que compile usted mismo sigue la misma regla: `initializeRebaseBackend` lee
`REBASE_PROVISION`, y `createRebaseBackend` acepta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es
deliberado: la alternativa por defecto sería el sistema de archivos del contenedor, que
perdería silenciosamente cada archivo subido en el siguiente reinicio. Las subidas se
rechazan con `501 STORAGE_NOT_CONFIGURED` hasta que configure uno.

Para un bucket, configure `STORAGE_TYPE=s3` (o `gcs`) además de su bucket y credenciales;
el archivo compose incluye estas variables comentadas. `gcs` carga
`@google-cloud/storage`, que no viene incluido en la imagen oficial, por lo que en esa imagen
debe conectarse a Google Cloud Storage a través de su endpoint compatible con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, claves HMAC).

Para disco local, lo cual solo es adecuado cuando la ruta es un volumen real que persiste
más allá de la vida del contenedor:

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
descarta en lugar de registrarse, porque la alternativa serían subidas exitosas en un
sistema de archivos que está a punto de destruirse. Esta variable es la forma de indicar
que el montaje es persistente.

Monte el volumen **por encima** de `STORAGE_PATH`, no directamente en él. `STORAGE_PATH`
es el directorio del bucket por defecto, y cada bucket declarado en `backend/resources.ts`
obtiene el suyo junto a este, `<STORAGE_PATH>__<key>`. Un volumen montado directamente en
`STORAGE_PATH` solo contendrá el bucket por defecto. Cualquier otro bucket escribirá en el
sistema de archivos del contenedor y perderá sus archivos cuando este se vuelva a crear.
`STORAGE_PATH__MEDIA` permite mover un bucket a otro lugar dentro del volumen. No puede
moverlo dentro del directorio de otro bucket, como `/storage/uploads/media`, porque entonces
el bucket por defecto listaría, serviría y eliminaría sus archivos.

La imagen crea
`/storage` para el usuario sin privilegios `node` bajo el que se ejecuta, motivo por el cual
el volumen se monta ahí. Un volumen montado donde la imagen no tiene un directorio pertenecerá
a root, y cada subida fallará con `EACCES`. El archivo compose que genera `rebase init`
lo monta de esta forma.

### El almacenamiento necesita un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue declare cómo se protegen los objetos. El almacenamiento no está
sujeto a la seguridad a nivel de fila y sus claves comparten un único espacio de nombres
plano, por lo que sin ninguna regla lo único que separa los archivos de dos usuarios es la
imposibilidad de adivinar las claves, algo que `GET /storage/list?prefix=` anula. Cualquiera
de las siguientes opciones satisface este requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de su proyecto,
  que es la solución auténtica y lo que incluye el scaffold en `backend/storage.ts` (ninguna
  variable de entorno puede expresar "este usuario puede leer esta clave");
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente actúa como una CDN pública
  de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino
  (single-tenant) donde se confía en cualquier cuenta que haya iniciado sesión para acceder a
  cualquier archivo.

Fuera de producción, esta misma condición genera una advertencia visible en lugar de un
rechazo, por lo que este es un fallo de arranque con el que se topará en el despliegue y no
en su equipo local. Es deliberado: el fallo al que reemplaza es silencioso.

Configure también `MFA_ENCRYPTION_KEY` si utiliza TOTP. Si no se establece, los secretos
del autenticador almacenados se cifran con `JWT_SECRET`, por lo que rotar esa clave
cerraría la sesión de todos los usuarios *y además* haría imposible descifrar los
dispositivos registrados.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier plataforma
que ejecute contenedores servirá. Dos cosas que deben configurarse correctamente en cualquier
lugar:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`), con sus
   dependencias instaladas junto a él; consulte [Dependencias](#dependencias).
2. Configure `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. En producción, el runtime se
   niega a arrancar sin ellos en lugar de intentar adivinarlos.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilice el formato de imagen derivada anterior para que el bundle se distribuya con la
aplicación y luego ejecute `fly deploy`.

### Railway / Render

Apunte el servicio a la imagen derivada, configure las variables de entorno y establezca
la ruta del health check en `/livez`.

### Un VPS estándar

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` lista las variables que lee. Bajo systemd:

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

`NODE_ENV=production` no es un adorno. Si no se define, el proceso se ejecuta en modo
de desarrollo: refleja los orígenes de localhost, sirve la especificación OpenAPI y
**deja abierta la ventana del primer administrador**, por lo que el primer desconocido
que encuentre el formulario de registro se convertirá en administrador. Las dos líneas
`REBASE_ADMIN_*` son las que reemplazan esa ventana; consulte [Su primer
administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` se incluye porque la base de datos está en la
misma máquina. En producción, el runtime rechaza cualquier variable que apunte a
localhost (en un contenedor, loopback es el propio contenedor, por lo que esa dirección
siempre es un error) y esta línea le indica que esa dirección es intencionada.
Elimínela cuando la base de datos se ejecute en otro lugar.

Prefiera `EnvironmentFile=/etc/rebase.env` con permisos de archivo en modo 0600 en
lugar de líneas `Environment=` para los secretos: cualquier usuario puede leer un
archivo unit y `systemctl show` muestra todos los valores de `Environment=`.

## Agrupación de conexiones (Connection pooling)

El runtime mantiene un pool pequeño y de larga duración, por lo que no necesita un pooler.
Lo que sí lo necesita es todo lo demás que se comunique con la misma base de datos y no pueda
retener una conexión: una función serverless, un script programado, una herramienta de BI
o un worker de colas que escale a cincuenta instancias. El `max_connections` de Postgres es
un límite estricto de unos pocos cientos y cada conexión es un *proceso*, por lo que un
despliegue masivo de lambdas lo agotará mucho antes de que la base de datos esté realmente
ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, protegido tras un
perfil para que un despliegue sin tales clientes no ejecute un proceso innecesario:

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

La autenticación del cliente se genera a partir de `DATABASE_URL` durante el inicio,
por lo que la contraseña no se escribe dos veces. El pooler se autentica en Postgres con
`scram-sha-256`, que es lo que almacena Postgres 18; el valor predeterminado `md5` de la
imagen hace fallar el inicio de sesión del *servidor* con `FATAL: server login failed: wrong password type`,
lo que parece un error de contraseña incorrecta cuando no lo es.

Mantenga la suma de `PGBOUNCER_POOL_SIZE` de todos los poolers holgadamente por debajo
del `max_connections` de la base de datos: el runtime consume del mismo cupo.

### Qué cambia la agrupación a nivel de transacciones

Un cliente agrupado (pooled) retiene una conexión de servidor solo durante la duración
de una transacción y luego la devuelve, lo que permite que 500 clientes compartan 20
conexiones. Hay tres cosas que dejan de funcionar a través de ese puerto, y cada una de
ellas es algo que Rebase utiliza internamente —razón exacta por la cual el runtime se
conecta directamente y este puerto queda reservado para otros clientes:

- **`LISTEN`/`NOTIFY`.** La funcionalidad de tiempo real está construida sobre esto,
  y un listener necesita una conexión que dure más allá de una transacción. El pooler
  *acepta* `LISTEN` —responde a `LISTEN`, pero ninguna notificación llega jamás.
- **Estado de sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos
  (advisory locks) mantenidos entre sentencias, cursores `WITH HOLD`, tablas temporales.
  La siguiente transacción puede aterrizar en una conexión de servidor diferente, que
  no verá nada de eso. Ambos casos fallan de la misma manera confusa: con un solo cliente
  inactivo el estado generalmente sigue ahí, por lo que funciona mientras realiza pruebas
  y deja de funcionar bajo la concurrencia para la cual introdujo el pooler.
- **Prepared statements a nivel de protocolo.** A la mayoría de los controladores se les
  puede indicar que no los utilicen: node-postgres no lo hace por defecto; asyncpg
  necesita `statement_cache_size=0`.

`SET LOCAL` tiene ámbito de transacción y sí funciona, que es con lo que se establece la
seguridad a nivel de fila (RLS), por lo que RLS se comporta de manera idéntica a través
del puerto del pooler.

Deje el perfil desactivado si nada fuera del runtime se conecta a su base de datos.
Un puerto sin usar es superficie de ataque expuesta.

## Verificaciones de estado (Health checks)

| Ruta | Uso |
| --- | --- |
| `/livez` | Liveness. Responde "está vivo este proceso" sin interactuar con la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta a la base de datos y reporta la latencia. |

Apunte las sondas de liveness a `/livez`. Una sonda de liveness en `/health` reiniciaría
un proceso perfectamente sano durante una breve interrupción de la base de datos, lo cual
es lo opuesto a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuentos de peticiones e histogramas
de latencia desglosados por superficie de la API (data, auth, storage, functions) y tabla,
además de indicadores (gauges) del proceso. Sin un token, el endpoint puede ser leído
por cualquiera que alcance el puerto, así que configure uno a menos que se encuentre en
una red privada.

`rebase_db_pool_wait_ms` es un histograma de cuánto tiempo esperó cada consulta por una
conexión del pool de la base de datos, incluida la apertura de una nueva, etiquetado por
la clave del origen de datos (`source="(default)"` en un proyecto que no declara orígenes
de datos). Un pool saludable lo mantiene cerca de cero. Una cola que
crece con el tráfico indica que las peticiones están esperando en cola por conexiones,
retenidas la mayoría de las veces por hooks de escritura que esperan algo lento; consulte
[A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

La base de datos en sí, por origen de datos:

| Métrica | Qué indica |
|---|---|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Las conexiones de cada pool, etiquetadas como `pool="primary"`, `"read"` (la réplica) o `"session"` (el pool directo de la consola SQL detrás de un pooler). Un valor de `waiting` por encima de cero durante mucho tiempo indica un pool demasiado pequeño para su carga. |
| `rebase_db_connection_errors_total` | Peticiones que respondieron 503 por falta de conexión, por `code`: `53300` / `53400` (el servidor no tiene conexiones disponibles), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexiones de clientes en el servidor, por `state`, frente a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | El tamaño de la base de datos. |
| `rebase_db_replica_lag_seconds` | Qué tan retrasada está `DATABASE_READ_URL` respecto a la primaria. |

Las últimas cuatro se muestrean cada 30 segundos en la propia conexión de la instancia,
por lo que un scrape nunca se convierte en una consulta.

`rebase_realtime_*` reporta los sockets abiertos de cada instancia, los canales y las
tramas enviadas al bus de canales o retenidas: consulte
[Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Encabezados de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000`
(180 días). El encabezado HSTS omite `includeSubDomains`: eso indicaría a los
navegadores que rechacen HTTP plano en todos los subdominios de su dominio, incluidos
aquellos con los que este servidor no tiene relación alguna, y un navegador lo conserva
durante el tiempo que indique el encabezado.
Establezca `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios sean exclusivamente HTTPS.

`strict-origin-when-cross-origin` es el valor predeterminado de los propios navegadores:
una petición a otro sitio envía su origen y nunca la ruta o la consulta de la página. No
se utiliza `no-referrer` porque las verificaciones de origen necesitan el origen: el botón
de inicio de sesión de Google lo compara con los orígenes de JavaScript autorizados del
cliente OAuth, y con `no-referrer` respondía "The given origin is not allowed for the given
client ID" en cualquier aplicación, sin importar lo que permitiera el cliente. Una
respuesta que defina su propia política la mantiene (la página de consentimiento de MCP
envía `no-referrer`); una página que requiera una más estricta puede indicarlo con
`<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funciona de la misma
manera: `SAMEORIGIN` a menos que la respuesta configure la suya propia, como hace la página
de consentimiento de MCP con `DENY`.

Las aplicaciones estáticas —el panel de administración del CMS y cualquier frontend que
sirva el bundle— también incluyen `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`.
Esto determina quién puede incrustar la aplicación en un marco (frame), descarta plugins y
fija `<base>` a su origen, sin restringir nada más, por lo que los scripts en línea, workers
y el inicio de sesión de terceros siguen funcionando. Una respuesta que configure su propia
política la mantiene. Para cualquier restricción más estricta, aplique la política en el
proxy inverso intermedio.

## Más de una instancia

Un único contenedor es la opción predeterminada y no necesita nada más. Antes de que
una segunda réplica reciba tráfico —o de que un despliegue continuo (rolling deploy) ejecute
dos en paralelo— revise [Running more than one instance](/docs/deployment/multiple-instances/):
los límites de peticiones (rate limits), los canales de difusión (broadcast channels), los
archivos locales, las subidas reanudables y la caché de imágenes funcionan por proceso hasta
que una configuración los comparta.

## Conectar Claude

Un solo comando añade este servidor al [conector de Rebase](/docs/ai/rebase-connector/),
el conector MCP único que accede a todos sus proyectos desde Claude:

```bash
rebase cloud connect https://your-app.com
```

Configure las dos variables que muestra en este servidor y reinícielo. El servidor debe
ejecutar Rebase 0.28.1 o posterior y responder a través de https en una dirección pública.
Nada más cambia: no almacena ningún secreto y concede al conector los mismos permisos que
otorgaría Studio.

## Ejecutar funciones en su propio proceso

Todo lo anterior contempla un único contenedor que sirve todo el proyecto, que es la
estructura adecuada para casi cualquier despliegue. Cuando una función personalizada deba
dejar de competir con la API de datos por el bucle de eventos (event loop) —o deba escalar,
reiniciarse y fallar de forma independiente—, la misma imagen y el mismo bundle pueden
arrancarse como varios procesos que cooperan entre sí. Consulte
[Split processes](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.30.1
```

Reinicie. Su bundle permanece intacto. Dentro de una misma versión mayor del contrato del
runtime, un bundle validado sigue funcionando; consulte
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
