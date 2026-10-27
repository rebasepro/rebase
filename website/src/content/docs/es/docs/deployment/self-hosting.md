---
sourceHash: c6f65640f646f804
title: Autoalojamiento (Self-Hosting)
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen oficial de runtime y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS convencional.
---

## Visión general

Autoalojar Rebase implica ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que compilar**. Tu proyecto viaja como un bundle,
el runtime ya está publicado y actualizar Rebase es tan simple como cambiar una etiqueta en lugar de
recompilar. Consulta [Runtime y bundles](/docs/architecture/runtime-and-bundles/) para
entender por qué está dividido de esta forma.

## Docker Compose

**Si tu proyecto se creó a partir de `rebase init`, utiliza su propio `docker-compose.yml`.**
Está en tu repositorio, `init` completó sus secretos, su primera cuenta de administrador
y su versión fija del runtime, y es el archivo que describe
[Despliegue](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

El resto de esta página aborda el mismo despliegue sin una estructura inicial generada —
el proyecto de otra persona, un bundle compilado en CI o las dos cosas que el archivo
generado omite deliberadamente: un gestor de grupos de conexiones (connection pooler) y las configuraciones de procesos divididos.
Ese archivo reside en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Úsalo en lugar de copiar un fragmento de esta página: ambos archivos son validados por
la propia puerta de aceptación del proyecto en cada push, por lo que ninguno puede desviarse de lo que
realmente funciona.

Ambos coinciden en todas las variables de entorno excepto en la contraseña de la base de datos, y
eso se debe a que cada uno está diseñado para su propio generador: este lee
`POSTGRES_PASSWORD`, que genera `quickstart.sh`; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incrusta en la `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas evidentes y muestra ambas en pantalla. La
forma detallada, si prefieres controlar cada paso manualmente:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado — `api` espera a que pase su
comprobación de salud (healthcheck).

### Los seis valores requeridos

`quickstart.sh` los genera por ti. Para escribir el archivo `.env` tú mismo:

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

Tres secretos, un dato informativo y la cuenta con la que inicias sesión:

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más adelante significa
  cambiarla también en el volumen, así que elígela de forma definitiva.
- **`JWT_SECRET`** — firma cada sesión. Rotarla cerrará la sesión de todos los usuarios.
- **`REBASE_SERVICE_KEY`** — la credencial que elude la seguridad a nivel de filas (RLS) para
  llamadas de servidor a servidor. Trátala como una contraseña de root: cualquier entidad que la posea puede
  leer todas las filas.
- **`CORS_ORIGINS`** — los orígenes desde los que se sirve tu frontend, separados por comas.
  No es un secreto y no es opcional: el runtime se niega a iniciar en producción
  sin ella en lugar de intentar adivinarla, porque una API que adivina sus orígenes
  permitidos tarde o temprano permitirá el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — el primer
  administrador. Una base de datos nueva no tiene usuarios, y fuera de producción la
  política de registro admite el primer registro y lo asciende a administrador —
  de lo contrario, una base de datos vacía es un callejón sin salida, porque inicializar a un admin
  requiere un emisor que ya haya iniciado sesión. En el momento en que este stack responde en un
  nombre de host, esa facilidad se convierte en una carrera que el operador puede perder, por lo que en producción
  la ventana se cierra y la cuenta se define aquí explícitamente. El runtime la crea
  una sola vez, mientras la tabla de usuarios está vacía, y no hace nada en cada arranque
  posterior.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener cada uno al menos 32 caracteres, y la
contraseña de administrador al menos 12. Utiliza una dirección con un punto en su dominio:
`POST /auth/login` valida su cuerpo con `z.string().email()`, por lo que el runtime
se niega a crear `admin@localhost` —una cuenta en la que nadie podría iniciar sesión— y registra
el motivo en su lugar. El archivo compose declara los seis con
`${VAR:?…}`, por lo que si falta alguno, detendrá el stack con un mensaje indicando cuál falta en
lugar de iniciar algo a medio configurar — y el autoregistro viene desactivado
(`DISABLE_SELF_REGISTRATION`, por defecto `true`), por lo que no queda nada abierto para ser reclamado.

Inicia sesión con esas credenciales y cambia la contraseña: se encuentran en texto plano dentro de un
archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto dentro del bundle** por
defecto, por lo que `dist-bundle` se genera con un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle con dependencias empaquetadas (vendored) inicia en unos cinco segundos.

Dado que ya están allí, puedes montar el bundle en modo de solo lectura — algo que vale la
pena hacer, ya que un hook comprometido no podrá sobrescribir el código que se ejecutará tras el
próximo reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y genera un bundle que instala sus
dependencias en el primer inicio, lo que toma entre 40 y 60 segundos por arranque y
requiere que el punto de montaje tenga permisos de escritura.

Para un despliegue real, es preferible integrar ambos dentro de una imagen, lo que también fija exactamente
lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.25.1
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas que falten al arrancar, incluidas las de tus colecciones.**
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, el cual es aditivo en todo el
esquema: crea tablas, columnas y tipos enum faltantes, y aplica su
seguridad a nivel de fila. Un primer arranque contra una base de datos vacía se inicia sirviendo
tus colecciones, sin necesidad de ningún paso intermedio.

Lo que `ensure` deliberadamente nunca hace es modificar algo que ya existe. No
altera el tipo de una columna, no elimina una tabla o columna y no
edita las etiquetas de un enum existente — porque el reinicio de un contenedor no debe ser capaz de
reestructurar un esquema como efecto secundario de un despliegue.

Por lo tanto, sigue valiendo la pena ejecutar `rebase db push` para aquello que el arranque no toca — cualquier
cambio que no sea puramente aditivo: una columna renombrada, un tipo más restrictivo, un
campo eliminado.

```bash
rebase db push
```

Ejecútalo desde una copia local o una tarea de CI, apuntando a la base de datos del despliegue. Primero
hará una simulación (dry-run) del cambio, rechazará los destructivos sin una confirmación explícita
y podrá realizar una copia de seguridad antes de aplicarlo. La base de datos expone un
puerto en el archivo compose para que este comando pueda alcanzarla desde el host; elimina ese mapeo
una vez que el esquema esté aplicado si la base de datos no debe ser accesible desde el
exterior.

`REBASE_MIGRATE_ON_BOOT` solo acepta `ensure` y `none`, nada más — la
imagen **se negará a arrancar** si se establece en `push`, por la razón mencionada anteriormente.

## Cuando solo su proceso de cambios puede modificar la base de datos

<span class="since-badge" data-since="0.26">Desde 0.26</span>

`REBASE_MIGRATE_ON_BOOT=none` deja en paz sus colecciones. No deja en paz la base de datos: las tablas propias del framework (auth, claves de API, jobs, cron) se siguen creando y manteniendo al día en cada arranque. Cuando la base de datos solo puede cambiar mediante un proceso de cambios revisado, establezca `REBASE_PROVISION=false` en cada proceso que sirve:

| Ajuste | Tablas y políticas de las colecciones | Tablas del framework |
|---|---|---|
| predeterminado (`REBASE_MIGRATE_ON_BOOT=ensure`) | se crean y se mantienen al día en el arranque | se crean y se mantienen al día |
| `REBASE_MIGRATE_ON_BOOT=none` | intactas | se crean y se mantienen al día |
| `REBASE_PROVISION=false` | intactas | intactas; lo que falte se nombra en el log |

Con el aprovisionamiento desactivado, el runtime no crea ni altera nada: ninguna tabla, columna, índice, función, trigger, política, rol ni permiso. Eso vale en el arranque y después, incluidas las tablas que un proceso que sirve crea en su primer uso (claves de idempotencia, claims de cron, los contadores compartidos de rate limit). En su lugar, lee lo que hay:

- **Faltan tablas de auth, o una columna que auth lee:** el arranque se rechaza y las enumera una por una.
- **El rol de las peticiones alcanza una tabla del framework** como `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza e imprime el `REVOKE` que hay que ejecutar. Un arranque que aprovisiona retira esos privilegios por sí mismo. Con el aprovisionamiento desactivado, nada lo hace.
- **Falta una tabla opcional** (claves de API, claves de idempotencia, claims de cron, contadores de rate limit, presencia, historial de métricas): esa función queda desactivada y el log dice qué tabla necesita.

Las filas siguen cambiando, como en cualquier base de datos: inicios de sesión, sesiones, uso de claves de API, claves de idempotencia, claims de cron. La primera cuenta de administrador (`REBASE_ADMIN_EMAIL`) la crea la ejecución de aprovisionamiento, no los procesos que sirven. La [edición del esquema en vivo](/docs/backend/live-schema-editing) puede seguir haciendo commit de un cambio como código fuente, pero se niega a aplicarlo a la base de datos.

### La ejecución de aprovisionamiento

<span class="since-badge" data-since="0.26">Desde 0.26</span>

El esquema proviene de una ejecución que controla su proceso de cambios. Use la misma imagen y el mismo bundle que el servidor, con `REBASE_PROVISION_ONLY=true`, conectado como un rol que puede crear en la base de datos. `REBASE_PROVISION_SQL_OUT` conserva cada cambio de esquema que hizo la ejecución, como un script SQL:

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

El script es un registro, no un plan: cada sentencia que contiene se ejecutó, en orden, y tuvo éxito. Registrado contra una base de datos vacía, es todo el esquema que necesita la versión. Registrado contra una copia restaurada de producción, es exactamente la actualización. Las filas que escribió la ejecución no están en él. Revíselo y luego aplíquelo a la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Hágalo de nuevo en cada actualización de Rebase, antes de desplegar los procesos que sirven. Una versión puede añadir una tabla o una columna, y un proceso que no puede crearla la informa como ausente en lugar de crearla.

Un servidor que construya usted mismo sigue la misma regla: `initializeRebaseBackend` lee `REBASE_PROVISION`, y `createRebaseBackend` acepta [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es intencionado: la
alternativa por defecto sería el sistema de archivos del contenedor, el cual perdería silenciosamente cada
archivo subido tras el siguiente reinicio. Las subidas se rechazan con
`501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) junto con su bucket y credenciales —
el archivo compose lista estas variables comentadas. `gcs` carga
`@google-cloud/storage`, que la imagen oficial no incluye, así que en esa imagen
accede a Google Cloud Storage a través de su endpoint compatible con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, claves HMAC).

Para almacenamiento en disco local, que solo es apropiado cuando la ruta es un volumen real que
persiste tras la eliminación del contenedor:

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
hacia un sistema de archivos que está a punto de destruirse. Esta variable es la forma en que confirmas que el montaje
es persistente.

Monta el volumen **por encima** de `STORAGE_PATH`, no directamente en él. `STORAGE_PATH` es el
directorio del bucket predeterminado, y cada bucket declarado en `config/resources.ts`
obtiene el suyo propio junto a este, `<STORAGE_PATH>__<key>`. Un volumen en el propio
`STORAGE_PATH` solo contendrá el bucket predeterminado. Cualquier otro bucket escribirá en el
sistema de archivos del contenedor y perderá sus archivos cuando este se vuelva a crear.
`STORAGE_PATH__MEDIA` puede mover un bucket a otra parte del volumen. Lo que no puede hacer es
ubicarlo dentro del directorio de otro bucket, como `/storage/uploads/media`,
ya que el bucket predeterminado podría listar, servir y eliminar sus archivos.

La imagen crea
`/storage` para el usuario sin privilegios `node` bajo el que se ejecuta, motivo por el cual el volumen
debe ir allí. Un volumen montado en una ruta donde la imagen no tiene un directorio pertenecerá a root,
y cualquier subida fallará con `EACCES`. El archivo compose que genera `rebase init` lo
monta de esta manera.

### El almacenamiento necesita un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue especifique cómo se protegen los objetos. El almacenamiento no está protegido mediante
seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que sin una regla lo
único que separaría los archivos de dos usuarios sería la imposibilidad de adivinar las claves — lo cual
se anula mediante `GET /storage/list?prefix=`. Cualquiera de las siguientes opciones satisface este requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto,
  lo cual es la solución real y lo que incluye la plantilla inicial en `config/storage.ts` —
  ninguna variable de entorno puede expresar "este usuario puede leer esta clave";
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que es genuinamente una CDN pública
  de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino (single-tenant) donde
  se confía el acceso a todos los archivos a cualquier cuenta que haya iniciado sesión.

Fuera de producción, esta misma condición genera una advertencia visible en lugar de un rechazo,
por lo que este es un error de arranque que verás durante el despliegue y no en tu entorno local.
Es intencionado: el fallo al que reemplaza es silencioso.

Configura también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se establece, los secretos
almacenados del autenticador se cifran con `JWT_SECRET` — por lo que rotar esa clave cerrará la sesión de todos
*e* impedirá descifrar todos los dispositivos vinculados.

## Otras plataformas

El runtime es un contenedor convencional que escucha en `$PORT`, por lo que cualquier servicio que ejecute
contenedores funcionará. Hay dos aspectos clave que debes configurar correctamente en cualquier entorno:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él — consulta [Dependencias](#dependencias).
2. Define `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega a
   iniciar en producción sin ellas en lugar de intentar adivinarlas.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.25.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utiliza el método de imagen derivada mostrado anteriormente para que el bundle se envíe junto con la aplicación, y luego ejecuta
`fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, configura las variables de entorno y define
la ruta de comprobación de salud en `/livez`.

### Un VPS convencional

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` muestra las variables que puede leer. Bajo systemd — las
dos líneas `REBASE_ADMIN_*` requieren la 0.18 o posterior, y en la versión 0.17.3 la primera cuenta en
registrarse se convierte en la administradora:

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
**deja abierta la ventana del primer administrador** — por lo que el primer desconocido que encuentre el
formulario de registro se convertirá en administrador. Las dos líneas `REBASE_ADMIN_*` son las que
sustituyen esa ventana; consulta [Tu primer
administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque la base de datos se encuentra en la
misma máquina. En producción, el runtime rechaza cualquier variable que apunte a
localhost — dentro de un contenedor, la interfaz loopback es el propio contenedor, por lo que esa dirección
siempre es un error — y esta línea le indica explícitamente que la dirección es intencionada. Elimínala cuando la
base de datos se ejecute en otro servidor.

Es preferible usar `EnvironmentFile=/etc/rebase.env` con permisos de archivo en modo 0600 en lugar de
las líneas `Environment=` para los secretos: un archivo de unidad puede ser leído por cualquier usuario del sistema, y
`systemctl show` muestra todos los valores de `Environment=`.

## Agrupación de conexiones (Connection pooling)

El runtime mantiene un grupo de conexiones pequeño y de larga duración, por lo que no necesita un pooler. Quienes sí
lo necesitan son todos los demás servicios que se comunican con la misma base de datos y no pueden mantener una conexión abierta:
una función serverless, un script programado, una herramienta de BI o un worker de colas que escala
a cincuenta instancias. El parámetro `max_connections` de Postgres es un límite estricto de unos pocos cientos y
cada conexión es un *proceso*, por lo que una dispersión (fan-out) de lambdas lo agotará mucho antes de que la
base de datos esté realmente ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, protegido bajo un perfil
para que un despliegue sin este tipo de clientes no ejecute un proceso innecesario:

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

La autenticación del cliente se genera a partir de `DATABASE_URL` durante el inicio, por lo que la
contraseña no se escribe dos veces. El pooler se autentica en Postgres usando
`scram-sha-256`, que es lo que almacena Postgres 18 — el valor predeterminado `md5` de la imagen hace fallar el
inicio de sesión del *servidor* con `FATAL: server login failed: wrong password type`, lo cual
parece un error de contraseña incorrecta cuando en realidad no lo es.

Asegúrate de que la suma de `PGBOUNCER_POOL_SIZE` entre todos los poolers se mantenga holgadamente por debajo
del `max_connections` de la base de datos — el runtime consume recursos de ese mismo límite.

### Qué cambia con el pooling de transacciones

Un cliente conectado mediante el pool retiene una conexión del servidor durante la duración de una transacción y
luego la libera, lo que permite que 500 clientes compartan 20 conexiones. Hay tres
cosas que dejan de funcionar a través de ese puerto, y cada una de ellas es algo que Rebase utiliza internamente
— razón exacta por la cual el runtime se conecta directamente y este puerto queda reservado para otros
emisores:

- **`LISTEN`/`NOTIFY`.** La funcionalidad en tiempo real se basa en esto, y un listener necesita una
  conexión que perdure más allá de una transacción. `LISTEN` es *aceptado* a través del
  pooler — responderá afirmativamente a `LISTEN`, pero ninguna notificación llegará jamás.
- **Estado de la sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos (advisory locks) mantenidos
  entre sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción
  puede asignarse a una conexión de servidor diferente, la cual no verá nada de lo anterior. Ambos
  casos fallan de la misma manera engañosa: con un solo cliente inactivo el estado
  suele permanecer allí, por lo que funciona durante las pruebas y deja de funcionar bajo
  la concurrencia real para la cual introdujiste el pooler.
- **Sentencias preparadas a nivel de protocolo.** A la mayoría de los controladores se les puede indicar que no las
  utilicen — node-postgres no las usa por defecto; asyncpg requiere
  `statement_cache_size=0`.

`SET LOCAL` tiene alcance de transacción y funciona correctamente, que es el mecanismo con el que se
establece la seguridad a nivel de fila — por lo que RLS se comporta de forma idéntica a través del puerto del pool.

Deja el perfil desactivado si no hay nada fuera del runtime que se conecte a tu base de datos.
Un puerto sin uso representa una superficie de exposición innecesaria.

## Comprobaciones de salud (Health checks)

| Ruta | Uso |
| --- | --- |
| `/livez` | Liveness (Supervivencia). Responde a "¿está vivo este proceso?" sin consultar la base de datos. |
| `/health` | Readiness (Disponibilidad). Realiza un ciclo completo a la base de datos y reporta la latencia. |

Apunta las sondas de liveness a `/livez`. Una sonda de liveness en `/health` reiniciará un
proceso perfectamente sano durante una breve interrupción de la base de datos, lo cual es opuesto
al propósito de esta comprobación.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuento de solicitudes e histogramas de latencia
desglosados por área de la API (data, auth, storage, functions) y colección, además de
indicadores (gauges) del proceso. Sin un token, el endpoint puede ser leído por cualquiera que pueda alcanzar
el puerto, así que define uno a menos que se encuentre en una red privada.

`rebase_db_pool_wait_ms` es un histograma que mide cuánto tiempo esperó cada consulta por una
conexión del grupo de la base de datos, incluida la apertura de una nueva, etiquetado por la clave de la
fuente de datos (`source="(default)"` en proyectos que no declaran fuentes de datos). Un
pool saludable mantiene este valor cerca de cero. Un incremento pronunciado en los valores extremos
a medida que aumenta el tráfico significa que las solicitudes están haciendo cola para obtener conexiones — a menudo
retenidas por callbacks de escritura que esperan operaciones lentas; consulta
[Un callback retiene una conexión](/docs/collections/context-data-api/#a-callback-holds-a-connection).

## Cabeceras de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000`
(180 días). La cabecera HSTS omite `includeSubDomains`: incluirlo indicaría a los
navegadores que rechacen HTTP plano en todos los subdominios de tu dominio, incluidos aquellos con
los que este servidor no tiene relación alguna, y los navegadores conservan esa directiva durante todo el tiempo que
indique la cabecera.
Establece `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios sean exclusivamente HTTPS;
hasta la versión 0.23 inclusive, la cabecera siempre contenía `includeSubDomains`.

`strict-origin-when-cross-origin` es el valor por defecto de los propios
navegadores: una petición a otro sitio lleva tu origen y nunca la ruta ni la
query de la página. No es `no-referrer` porque las comprobaciones de origen
necesitan el origen: el botón de inicio de sesión de Google lo compara con los
orígenes de JavaScript autorizados del cliente OAuth, y con `no-referrer`
respondía "The given origin is not allowed for the given client ID" en todas las
apps, permitiera lo que permitiera el cliente. Una respuesta que fija su propia
política la conserva (la página de consentimiento de MCP envía `no-referrer`);
una página que quiera una más estricta puede indicarlo con
`<meta name="referrer" content="no-referrer">`.

Las aplicaciones estáticas — el panel de administración del CMS y cualquier frontend que sirva el bundle — también incluyen
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Esto define quién puede incrustar la app en frames, bloquea plugins y restringe `<base>`
a tu propio origen, sin imponer restricciones sobre nada más, por lo que los scripts inline, workers e
inicios de sesión de terceros seguirán funcionando. Cualquier respuesta que configure su propia directiva la mantendrá.
Si requieres restricciones más estrictas, configura la directiva en el proxy inverso intermedio.

## Más de una instancia

Un único contenedor es la configuración predeterminada y no requiere nada más. Antes de que una segunda réplica
comience a recibir tráfico — o de que un despliegue progresivo (rolling deploy) ejecute dos instancias en paralelo — revisa
[Ejecutar más de una instancia](/docs/deployment/multiple-instances/): los límites de tasa
(rate limits), los canales de difusión (broadcast channels), los archivos locales, las subidas reanudables y la caché de imágenes
funcionan de forma aislada por proceso a menos que una configuración específica los comparta.

## Ejecución de funciones en su propio proceso

Todo lo expuesto anteriormente contempla un solo contenedor sirviendo el proyecto completo, lo cual es la
arquitectura adecuada para casi cualquier despliegue. Cuando una función personalizada deba dejar de competir
por el bucle de eventos (event loop) con la API de datos — o requiera escalar, reiniciarse y fallar de forma
independiente —, la misma imagen y el mismo bundle pueden iniciarse como múltiples procesos
cooperativos. Consulta [Procesos divididos](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.25.1
```

Reinicia. Tu bundle permanece inalterado. Dentro de una misma versión mayor del contrato del runtime, un bundle que
haya sido validado continuará funcionando sin problemas — consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
