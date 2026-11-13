---
sourceHash: d3a77712f89b7829
title: Autoalojamiento (Self-Hosting)
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen de runtime oficial y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS estándar.
---

## Visión general

Autoalojar Rebase implica ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que compilar**. Tu proyecto se transporta como un bundle,
el runtime está publicado y actualizar Rebase es simplemente cambiar una etiqueta en lugar de
recompilar. Consulta [Runtime y bundles](/docs/architecture/runtime-and-bundles/) para
conocer las razones de esta separación.

## Docker Compose

**Si tu proyecto se generó con `rebase init`, utiliza su propio `docker-compose.yml`.**
Está en tu repositorio; `init` completó sus secretos, su primera cuenta de administrador
y su versión fija del runtime, y es el archivo que
[Despliegue](/docs/getting-started/deployment/#docker-compose-recommended)
describe:

```bash
rebase build
docker compose up -d
```

El resto de esta página muestra el mismo despliegue sin un scaffolding por detrás:
el proyecto de otra persona, un bundle compilado en CI o las dos cosas que el archivo
generado omite deliberadamente: un connection pooler y las configuraciones de procesos divididos.
Ese archivo se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Úsalo en lugar de copiar un fragmento de esta página: ambos archivos son arrancados por
el acceptance gate del propio proyecto en cada push, por lo que ninguno puede desincronizarse
de lo que realmente funciona.

Ambos coinciden en cada variable de entorno excepto en la contraseña de la base de datos, y
esto se debe a que cada uno está diseñado para su propio mecanismo de generación: este lee
`POSTGRES_PASSWORD`, que genera `quickstart.sh`; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incluye en la `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produce ./dist-bundle
./infra/docker/quickstart.sh    # escribe infra/docker/.env si no existe, luego lo levanta
```

`quickstart.sh` es un único comando que hace dos cosas evidentes y muestra ambas por consola.
La versión explícita paso a paso, si prefieres controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado: `api` espera a que su
healthcheck responda.

### Los seis valores que necesita

`quickstart.sh` genera estos valores por ti. Para escribir el archivo `.env` tú mismo:

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

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más adelante implica
  cambiarla también en el volumen, así que elígela de forma definitiva.
- **`JWT_SECRET`** — firma cada sesión. Rotarlo cerrará la sesión de todos los usuarios.
- **`REBASE_SERVICE_KEY`** — la credencial que elude la seguridad a nivel de fila (RLS) para
  llamadas de servidor a servidor. Trátala como una contraseña de root: cualquiera que la tenga puede
  leer todas las filas.
- **`CORS_ORIGINS`** — los orígenes desde los que se sirve tu frontend, separados por comas.
  No es un secreto y no es opcional: el runtime se niega a iniciar en producción
  sin él en lugar de asumir uno por defecto, ya que una API que asume sus orígenes
  permitidos tarde o temprano permitirá el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — el primer
  administrador. Una base de datos nueva no tiene usuarios, y fuera de producción la
  política de registro admite el primer registro y lo promociona a admin;
  de lo contrario, una base de datos vacía es un callejón sin salida, porque inicializar
  un admin requiere un emisor que ya haya iniciado sesión. En el momento en que este stack responde en un
  nombre de host, esa facilidad se convierte en una condición de carrera que el operador puede perder,
  por lo que en producción esa ventana se cierra y la cuenta se define aquí explícitamente. El runtime
  la crea una sola vez, mientras la tabla de usuarios esté vacía, y no hace nada en los arranques
  posteriores.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener al menos 32 caracteres cada uno, y
la contraseña de administrador al menos 12. Utiliza una dirección con un punto en su dominio:
`POST /auth/login` valida su cuerpo con `z.string().email()`, por lo que el runtime
se niega a inicializar `admin@localhost` —una cuenta con la que nadie podría iniciar sesión— y registra
el motivo en su lugar. El archivo compose declara los seis con
`${VAR:?…}`, de modo que si falta alguno, el stack se detiene con un mensaje indicándolo
en lugar de iniciar a medio configurar, y el autoregistro viene desactivado
(`DISABLE_SELF_REGISTRATION`, por defecto `true`), por lo que no queda nada vulnerable a ser reclamado.

Inicia sesión con esas credenciales y cambia la contraseña: están guardadas en un
archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto dentro del bundle** por
defecto, por lo que `dist-bundle` incluye un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle empaquetado (vendored) arranca en unos cinco segundos.

Como ya están allí, puedes montar el bundle en modo de solo lectura; vale la
pena hacerlo, ya que un hook comprometido no podrá reescribir el código que se ejecuta tras el
siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y produce un bundle que instala sus
dependencias en el primer inicio, lo que tarda de 40 a 60 segundos por arranque y
requiere que el punto de montaje tenga permisos de escritura.

Para un despliegue real, es preferible empaquetar ambos dentro de una imagen, lo cual además fija exactamente
lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Creación del esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que falten al arrancar, incluidas las que declara `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` tiene el valor predeterminado `ensure`, que es aditivo en todo el
esquema: crea las tablas, columnas y tipos enum faltantes, y aplica su
seguridad a nivel de fila (RLS). Un primer inicio contra una base de datos vacía arranca sirviendo
tus tablas sin requerir ningún paso independiente.

Lo que `ensure` deliberadamente nunca hace es cambiar nada que ya exista. No
altera el tipo de una columna, no elimina una tabla ni una columna, y no
edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe poder
modificar la estructura de un esquema como efecto secundario de un despliegue.

Por lo tanto, sigue valiendo la pena ejecutar `rebase db push` para lo que el arranque no toca:
cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restringido,
un campo eliminado.

```bash
rebase db push
```

Ejecútalo desde una copia local o un trabajo de CI, apuntando a la base de datos del despliegue.
Primero simula el cambio (dry-run), rechaza los destructivos sin confirmación explícita
y puede realizar una copia de seguridad antes de aplicar. La base de datos expone un
puerto en el archivo compose para que se pueda acceder a ella desde el host; elimina ese mapeo
una vez que el esquema esté listo si la base de datos no debe ser accesible desde
el exterior.

`REBASE_MIGRATE_ON_BOOT` acepta `ensure` y `none`, y nada más; la
imagen **se niega a arrancar** con `push`, por la razón expuesta anteriormente.

## Cuando solo tu proceso de cambios puede modificar la base de datos

`REBASE_MIGRATE_ON_BOOT=none` no toca tus tablas. Sin embargo, no deja
intacta la base de datos: las tablas propias del framework (auth, claves de API, jobs, cron)
se siguen creando y manteniendo al día en cada arranque. Cuando la base de datos solo pueda modificarse
a través de un proceso de cambios auditado, establece `REBASE_PROVISION=false` en cada proceso
que sirva tráfico:

| Configuración | Tablas y políticas declaradas | Tablas del framework |
|---|---|---|
| por defecto (`REBASE_MIGRATE_ON_BOOT=ensure`) | creadas y mantenidas al día al arrancar | creadas y mantenidas al día |
| `REBASE_MIGRATE_ON_BOOT=none` | no se tocan | creadas y mantenidas al día |
| `REBASE_PROVISION=false` | no se tocan | no se tocan; lo que falte se indica en los registros |

Con el aprovisionamiento desactivado, el runtime no crea ni altera nada: ninguna tabla, columna,
índice, función, trigger, política, rol o permiso (grant). Esto aplica al arrancar y después,
incluidas las tablas que un proceso en ejecución normalmente crea en su primer uso
(claves de idempotencia, asignaciones de cron, contadores compartidos de límite de tasa). En su lugar, lee lo
que ya está presente:

- **Faltan tablas de autenticación o una columna que la autenticación lee:** el arranque se rechaza y se
  enumeran cada una de ellas.
- **El rol de las peticiones puede acceder a una tabla del framework** como
  `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza y se imprime el
  comando `REVOKE` a ejecutar. Un arranque con aprovisionamiento retira esos privilegios por su cuenta.
  Con el aprovisionamiento desactivado, nada lo hace de forma automática.
- **Falta una tabla opcional** (claves de API, claves de idempotencia, asignaciones de cron,
  contadores de límite de tasa, presencia, historial de métricas): esa funcionalidad se desactiva y el
  registro indica qué tabla necesita.
- <span class="since-badge" data-since="0.31">Desde 0.31</span> **Una tabla declarada que la base de datos no protege** — seguridad
  a nivel de fila deshabilitada, ninguna de las políticas que declara presentes, o falta una política
  restrictiva que declara: esa tabla no se sirve (si falta una política permisiva,
  se sirve con una advertencia de arranque que la nombra). Una petición a la misma responde `503 TABLE_WITHHELD`, y el registro de arranque
  indica el SQL que la protege (o sugiere `rebase db push`). Las demás tablas se
  sirven y el arranque continúa. Una tabla intermedia de muchos a muchos se comprueba de la misma
  manera: una que la base de datos no proteja retiene las tablas cuyas relaciones
  la utilicen, y `TABLE_WITHHELD` indica la tabla intermedia afectada. Esto aplica también con `REBASE_MIGRATE_ON_BOOT=none`,
  y durante una recarga de esquema en caliente.

Las filas siguen cambiando, como lo harían en cualquier base de datos: inicios de sesión, sesiones, uso de
claves de API, claves de idempotencia, asignaciones de cron. La primera cuenta de administrador
(`REBASE_ADMIN_EMAIL`) es creada por la ejecución de aprovisionamiento, no por los procesos
que sirven peticiones. La [edición de esquemas en vivo](/docs/backend/live-schema-editing) aún puede
confirmar un cambio en el código fuente, pero se niega a aplicarlo a la base de datos.

### La ejecución de aprovisionamiento

El esquema proviene de una ejecución controlada por tu proceso de cambios. Utiliza la misma imagen y
bundle que el servidor, con `REBASE_PROVISION_ONLY=true`, conectado como un rol que
tenga permisos de creación en la base de datos. `REBASE_PROVISION_SQL_OUT` almacena cada cambio de esquema
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
validaciones de entorno que el servidor, incluyendo `CORS_ORIGINS` o `FRONTEND_URL`, a pesar de
que no sirva ninguna petición.

El script es un registro, no un plan: cada sentencia en él se ejecutó, en orden, y
tuvo éxito. Si se genera contra una base de datos vacía, representa el esquema completo que la versión
necesita. Si se genera contra una copia restaurada de producción, es exactamente la migración necesaria.
Las filas que la ejecución haya escrito no están incluidas en él. Revísalo y aplícalo en la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repite este proceso para cada actualización de Rebase, antes de que los procesos que sirven tráfico se
actualicen gradualmente. Una nueva versión puede añadir una tabla o una columna, y un proceso que no tenga
permisos para crearla informará de que falta en lugar de crearla.

Un servidor compilado por ti mismo sigue la misma regla: `initializeRebaseBackend` lee
`REBASE_PROVISION`, y `createRebaseBackend` acepta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es deliberado: la
alternativa por defecto sería el sistema de archivos del contenedor, el cual perdería silenciosamente cada
archivo subido tras el siguiente reinicio. Las subidas se rechazan con
`501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) junto con su bucket y credenciales;
el archivo compose lista estas variables comentadas. `gcs` carga
`@google-cloud/storage`, paquete que la imagen oficial no incluye, por lo que en esa imagen
debes acceder a Google Cloud Storage a través de su endpoint compatible con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, claves HMAC).

Para disco local, lo cual solo es adecuado cuando la ruta es un volumen real que
persiste más allá del ciclo de vida del contenedor:

```yaml
      STORAGE_TYPE: local
      # Cada bucket declarado obtiene un directorio junto a este, bucket("media")
      # /storage/uploads__media, por lo que el volumen se coloca en su carpeta padre.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` no es opcional en este caso: en producción, un backend `local` se
descarta en lugar de registrarse, porque la alternativa serían subidas exitosas
hacia un sistema de archivos a punto de ser destruido. La variable es la forma de indicar que el montaje
es persistente.

Monta el volumen **por encima** de `STORAGE_PATH`, no en él. `STORAGE_PATH` es el
directorio del bucket por defecto, y cada bucket declarado en `backend/resources.ts`
obtiene el suyo junto a este, `<STORAGE_PATH>__<key>`. Un volumen en el propio `STORAGE_PATH`
solo contendrá el bucket por defecto. Cualquier otro bucket escribirá en el sistema
de archivos del contenedor y perderá sus archivos cuando este se vuelva a crear.
`STORAGE_PATH__MEDIA` permite mover un bucket a otro lugar dentro del volumen. No puede
moverse dentro del directorio de otro bucket, como `/storage/uploads/media`,
porque el bucket por defecto listaría, serviría y eliminaría sus archivos.

La imagen crea
`/storage` para el usuario sin privilegios `node` bajo el cual se ejecuta, razón por la cual el volumen
se ubica allí. Un volumen montado donde la imagen no tiene un directorio pertenecerá a root,
y cualquier subida fallará con `EACCES`. El archivo compose que genera `rebase init`
lo monta de esta forma.

### El almacenamiento requiere un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue defina cómo se protegen los objetos. El almacenamiento no está protegido por
la seguridad a nivel de fila (RLS) y sus claves comparten un único espacio de nombres plano, por lo que sin ninguna regla
lo único que separa los archivos de dos usuarios es la dificultad para adivinar las claves, algo que
`GET /storage/list?prefix=` invalida por completo. Cualquiera de las siguientes opciones lo satisface:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto,
  lo cual es la solución real y lo que el scaffolding incluye en `backend/storage.ts` —
  ninguna variable de entorno puede expresar "este usuario puede leer esta clave";
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que genuinamente funcione como una CDN pública
  de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino donde
  se confía en cualquier cuenta autenticada para acceder a cualquier archivo.

Fuera de producción, esta misma condición genera una advertencia llamativa en lugar de un rechazo,
por lo que este es un error de arranque con el que te toparás en el despliegue y no en tu máquina de desarrollo.
Es deliberado: el error que reemplaza ocurre de forma silenciosa.

Define también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se establece, los secretos de autenticador
guardados se cifran con `JWT_SECRET`, por lo que rotar esa clave cerrará la sesión de todos *y*
hará que todos los dispositivos vinculados no puedan descifrarse.

## Otras plataformas

El runtime es un contenedor estándar que escucha en `$PORT`, por lo que cualquier servicio que ejecute
contenedores servirá. Dos cosas que debes configurar correctamente en cualquier entorno:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él — consulta [Dependencias](#dependencias).
2. Define `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega a
   iniciar en producción sin ellos en lugar de asumir valores por defecto.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utiliza la variante de imagen derivada mostrada arriba para que el bundle se envíe junto con la aplicación, y luego ejecuta
`fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, define las variables de entorno y establece
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

`NODE_ENV=production` no es decorativo. Si no se define, el proceso se ejecuta en
modo de desarrollo: refleja orígenes localhost, sirve la especificación OpenAPI y
**deja abierta la ventana del primer administrador**, por lo que el primer desconocido que encuentre
el formulario de registro se convertirá en el administrador. Las dos líneas `REBASE_ADMIN_*` son las que
reemplazan esa ventana; consulta [Tu primer
administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque la base de datos se encuentra en la
misma máquina. En producción, el runtime rechaza cualquier variable que apunte a
localhost (en un contenedor, loopback es el propio contenedor, por lo que esa dirección
siempre es un error) y esta línea le indica que esa dirección es intencionada. Elimínala cuando la
base de datos se ejecute en otro lugar.

Es preferible usar `EnvironmentFile=/etc/rebase.env` con el archivo en modo 0600 en lugar de
líneas `Environment=` para los secretos: un archivo de unidad tiene permisos de lectura global y
`systemctl show` muestra todos los valores de `Environment=`.

## Connection pooling

El runtime mantiene un pool pequeño y persistente y no requiere un pooler. Lo que sí lo
requiere es todo lo demás que interactúe con la misma base de datos y no pueda mantener una conexión:
una función serverless, un script programado, una herramienta de BI, un worker de colas que escale
a cincuenta instancias. El parámetro `max_connections` de Postgres es un límite estricto de unos pocos cientos y
cada conexión es un *proceso*, por lo que un escalado masivo de lambdas lo agotará mucho antes de que
la base de datos esté realmente ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, protegido tras un perfil
para que un despliegue sin tales clientes no ejecute un proceso que no necesita:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # puerto en el host
PGBOUNCER_MAX_CLIENT_CONN=500 # conexiones de clientes aceptadas
PGBOUNCER_POOL_SIZE=20        # conexiones al servidor usadas para atenderlas
```

La autenticación de clientes se genera a partir de `DATABASE_URL` al iniciar, por lo que la
contraseña no se escribe dos veces. El pooler se autentica ante Postgres mediante
`scram-sha-256`, que es lo que almacena Postgres 18; el valor predeterminado `md5` de la imagen hace que falle el
inicio de sesión del *servidor* con `FATAL: server login failed: wrong password type`, lo cual
parece un error de contraseña incorrecta cuando en realidad no lo es.

Mantén la suma de `PGBOUNCER_POOL_SIZE` entre todos los poolers holgadamente por debajo del
`max_connections` de la base de datos: el runtime consume recursos de ese mismo límite.

### Qué cambia con el pooling a nivel de transacción

Un cliente conectado mediante pool retiene una conexión al servidor durante la duración de una transacción y
luego la libera, lo que permite que 500 clientes compartan 20 conexiones. Hay tres
cosas que dejan de funcionar a través de ese puerto, y todas son utilizadas por Rebase
—razón exacta por la cual el runtime se conecta directamente y este puerto queda reservado para otros
clientes:

- **`LISTEN`/`NOTIFY`.** El sistema de tiempo real se basa en esto, y un listener necesita una
  conexión que perdure más allá de una transacción. `LISTEN` es *aceptado* a través del
  pooler: responde afirmativamente a `LISTEN`, pero ninguna notificación llegará jamás.
- **Estado de sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos (advisory locks) retenidos
  a lo largo de varias sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción
  puede ejecutarse en una conexión de servidor diferente, la cual no tendrá constancia de nada de esto. Ambos
  casos fallan de la misma forma engañosa: con un único cliente inactivo el estado suele
  permanecer ahí, por lo que funciona durante las pruebas y deja de funcionar bajo
  la concurrencia para la cual introdujiste el pooler.
- **Prepared statements a nivel de protocolo.** A la mayoría de los drivers se les puede indicar que no los
  utilicen: node-postgres no lo hace por defecto; asyncpg necesita
  `statement_cache_size=0`.

`SET LOCAL` tiene alcance de transacción y funciona correctamente, que es con lo que se configura la
seguridad a nivel de fila; por lo tanto, RLS se comporta de forma idéntica a través del puerto con pooling.

Mantén el perfil desactivado si no hay nada fuera del runtime que se conecte a tu base de datos.
Un puerto sin uso representa superficie de ataque innecesaria.

## Health checks

| Ruta | Uso |
| --- | --- |
| `/livez` | Liveness. Responde si este proceso sigue vivo sin consultar la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta a la base de datos y reporta la latencia. |

Apunta las sondas de liveness a `/livez`. Una sonda de liveness en `/health` reiniciará un
proceso perfectamente sano durante una interrupción breve de la base de datos, lo cual es justo lo contrario
de su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<cadena aleatoria>
```

Expone métricas de Prometheus en `/metrics`: recuentos de peticiones e histogramas de latencia
desglosados por área de la API (datos, auth, almacenamiento, funciones) y tabla, además de
indicadores (gauges) del proceso. Sin un token, el endpoint es accesible para cualquiera que pueda llegar
al puerto, así que define uno a menos que se encuentre en una red privada.

`rebase_db_pool_wait_ms` es un histograma de cuánto tiempo esperó cada consulta por una
conexión del pool de la base de datos, incluyendo el tiempo de apertura de una nueva, etiquetado por la
clave del origen de datos (`source="(default)"` en un proyecto que no declare orígenes de datos). Un
pool saludable mantiene este valor cerca de cero. Una cola que
crece con el tráfico significa que las peticiones están esperando conexiones en cola, generalmente
retenidas por write hooks que esperan alguna operación lenta; consulta
[Un hook retiene una conexión](/docs/collections/context-data-api/#a-hook-holds-a-connection).

La base de datos en sí, por cada origen de datos:

| Métrica | Qué indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Conexiones de cada pool, etiquetadas como `pool="primary"`, `"read"` (la réplica) o `"session"` (el pool directo de la consola SQL tras un pooler). Un valor de `waiting` superior a cero de forma prolongada indica un pool insuficiente para su carga. |
| `rebase_db_connection_errors_total` | Peticiones que respondieron 503 por falta de conexión, por `code`: `53300` / `53400` (el servidor no tiene conexiones libres), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexiones de clientes en el servidor, por `state`, frente a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | El tamaño de la base de datos. |
| `rebase_db_replica_lag_seconds` | Cuánto retraso tiene `DATABASE_READ_URL` respecto a la primaria. |

Las últimas cuatro métricas se muestrean cada 30 segundos mediante la conexión propia de la instancia, de modo que
un scrape nunca se convierte en una consulta SQL adicional.

`rebase_realtime_*` reporta los sockets abiertos de cada instancia, los canales y las tramas
que envió al bus de canales o que retuvo: consulta
[Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeceras de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000`
(180 días). La cabecera HSTS omite `includeSubDomains`: incluirlo indicaría a los
navegadores que rechacen HTTP plano en todos los subdominios de tu dominio, incluidos aquellos con
los que este servidor no tiene relación alguna, y los navegadores mantendrán esa directiva durante el tiempo
que especifique la cabecera.
Define `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios funcionen exclusivamente por HTTPS.

`strict-origin-when-cross-origin` es el comportamiento predeterminado de los navegadores: una petición a
otro sitio web envía tu origen y nunca la ruta o los parámetros de consulta de la página. No es
`no-referrer` porque las validaciones de origen necesitan conocerlo; por ejemplo, el botón de inicio de sesión de Google
lo compara con los orígenes de JavaScript autorizados en el cliente OAuth, y con
`no-referrer` respondía "The given origin is not allowed for the given client
ID" en cualquier aplicación, sin importar lo que el cliente permitiera. Una respuesta que defina su propia
política la conserva (la página de consentimiento de MCP envía `no-referrer`); una página que requiera una
más estricta puede indicarlo con `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` funciona de la misma forma: `SAMEORIGIN` a menos que la respuesta defina la
suya propia, como hace la página de consentimiento de MCP con `DENY`.

Las aplicaciones estáticas —el panel de administración del CMS y cualquier frontend que sirva el bundle— también incluyen
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Esta directiva determina quién puede incrustar la app en un frame, bloquea plugins y restringe `<base>`
a tu origen, sin restringir nada más, de modo que los scripts en línea, los workers y el inicio de
sesión de terceros sigan funcionando. Una respuesta que defina su propia política la conserva.
Para reglas más estrictas, configura la política en el proxy inverso que esté delante.

## Más de una instancia

Un único contenedor es la opción por defecto y no requiere nada adicional. Antes de que una segunda réplica
reciba tráfico —o de que un despliegue continuo (rolling deploy) ejecute dos en paralelo—, revisa
[Ejecutar más de una instancia](/docs/deployment/multiple-instances/): los límites de
tasa, los canales de difusión (broadcast), los archivos locales, las subidas reanudables y la caché de imágenes
son independientes por proceso hasta que se configuren para compartirse.

## Conectar Claude

Un único comando vincula este servidor al [conector de Rebase](/docs/ai/rebase-connector/),
el conector MCP unificado que conecta todos tus proyectos con Claude:

```bash
rebase cloud connect https://your-app.com
```

Configura en este servidor las dos variables que devuelve y reinícialo. El servidor debe
ejecutar Rebase 0.28.1 o posterior y responder a través de https en una dirección pública. Nada
más cambia: no almacena ningún secreto y concede al conector los mismos permisos que otorgaría Studio.

## Ejecutar funciones en su propio proceso

Todo lo expuesto anteriormente contempla un único contenedor sirviendo todo el proyecto, que es la estructura
adecuada para casi cualquier despliegue. Cuando una función personalizada deba dejar de competir
con la API de datos por el event loop —o deba escalar, reiniciarse y fallar de forma
independiente—, la misma imagen y el mismo bundle pueden iniciarse como varios procesos
coordinados entre sí. Consulta [Procesos divididos](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.30.1
```

Reinicia. Tu bundle permanece inalterado. Dentro de una misma versión mayor del contrato del runtime, un bundle que
ha sido validado seguirá funcionando; consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
