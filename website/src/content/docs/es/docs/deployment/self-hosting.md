---
sourceHash: 691ddcb4610e34e6
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen oficial del runtime y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS básico.
---

## Descripción general

Autoalojar Rebase implica ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que compilar**. Tu proyecto se distribuye como un bundle,
el runtime está publicado y actualizar Rebase es un cambio de etiqueta (tag) en lugar de una
recompilación. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) para
saber por qué está dividido de esa forma.

## Docker Compose

**Si tu proyecto proviene de `rebase init`, utiliza su propio `docker-compose.yml`.**
Está en tu repositorio, `init` completó sus secretos, su primera cuenta de administrador
y su versión fijada del runtime, y es el archivo que
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
describe:

```bash
rebase build
docker compose up -d
```

El resto de esta página describe el mismo despliegue sin un scaffold detrás:
el proyecto de otra persona, un bundle generado en CI, o las dos cosas que el
archivo generado omite deliberadamente: un connection pooler y las configuraciones de procesos separados.
Ese archivo se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Úsalo en lugar de copiar un fragmento de esta página: ambos archivos son arrancados por
el propio control de aceptación del proyecto en cada push, por lo que ninguno puede divergir de lo que
realmente funciona.

Ambos coinciden en todas las variables de entorno excepto en la contraseña de la base de datos, y
eso se debe a que cada uno está escrito para su propio emisor: este lee
`POSTGRES_PASSWORD`, que `quickstart.sh` genera; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también inserta en la `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas evidentes e imprime ambas. La
versión extendida, si prefieres controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado: `api` espera a su
healthcheck.

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

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más adelante
  implica cambiarla también en el volumen, así que elígela bien desde el principio.
- **`JWT_SECRET`** — firma cada sesión. Rotarla cerrará la sesión de todos los usuarios.
- **`REBASE_SERVICE_KEY`** — la credencial que elude la seguridad a nivel de fila (RLS) para
  llamadas de servidor a servidor. Trátala como una contraseña de root: cualquiera que la tenga puede
  leer todas las filas.
- **`CORS_ORIGINS`** — los orígenes desde los que se sirve tu frontend, separados por comas.
  No es un secreto ni es opcional: el runtime se niega a arrancar en producción
  sin este valor en lugar de intentar adivinarlo, porque una API que adivina sus orígenes
  permitidos tarde o temprano permitirá el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — el primer
  administrador. Una base de datos nueva no tiene usuarios y, fuera de producción, la
  política de registro admite el primer registro y lo asciende a administrador;
  de lo contrario, una base de datos vacía sería un callejón sin salida, ya que
  inicializar un administrador requiere un invocador que ya haya iniciado sesión. El momento en que
  este stack responde en un hostname, esa comodidad se convierte en una carrera que el operador
  puede perder, por lo que en producción esa ventana se cierra y la cuenta se define aquí.
  El runtime la crea una sola vez, mientras la tabla de usuarios está vacía, y
  no hace nada en los arranques posteriores.

Cada uno de los tres secretos debe tener al menos 32 caracteres, y la contraseña de administrador
al menos 12. Usa una dirección con un punto en su dominio: `POST /auth/login` valida
su cuerpo con `z.string().email()`, por lo que `admin@localhost` crearía una cuenta
y luego rechazaría cualquier intento de usarla. El archivo compose declara los seis valores con
`${VAR:?…}`, de modo que si falta alguno, detiene el stack con un mensaje indicando cuál falta
en lugar de iniciar algo a medio configurar; además, el autorregistro viene deshabilitado
(`DISABLE_SELF_REGISTRATION`, valor por defecto `true`), por lo que nadie podrá reclamar nada.

Inicia sesión con esas credenciales y cambia la contraseña: están almacenadas en un
archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto en el bundle** por
defecto, por lo que `dist-bundle` incluye un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle con dependencias integradas (vendored) arranca en unos cinco segundos.

Dado que ya están ahí, puedes montar el bundle en modo de solo lectura; vale la pena
hacerlo, ya que un hook comprometido no podrá sobrescribir el código que se ejecuta tras el
siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y genera un bundle que instala sus
dependencias en el primer inicio, lo que toma entre 40 y 60 segundos por arranque y
requiere que el montaje tenga permisos de escritura.

Para un despliegue real, es preferible empaquetar ambos dentro de una imagen, lo que además fija exactamente
lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.21.1
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas que falten durante el arranque, incluidas las de tus colecciones.**
`REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, el cual es aditivo en todo el
esquema: crea tablas, columnas y tipos enum faltantes, y aplica su
seguridad a nivel de fila. Un primer inicio sobre una base de datos vacía se levanta sirviendo
tus colecciones, sin ningún paso adicional.

Lo que `ensure` deliberadamente nunca hace es modificar nada que ya exista.
No altera el tipo de una columna, no elimina una tabla ni una columna, y no
edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe ser capaz de
alterar la estructura de un esquema como efecto secundario de un despliegue.

Por lo tanto, sigue valiendo la pena ejecutar `rebase db push` para las dos cosas que el arranque
no toca:

```bash
rebase db push
```

- **RLS en tablas de unión (junction tables)** para relaciones de muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo
  más restringido o un campo eliminado.

Ejecútalo desde una copia local del código o un job de CI, apuntando a la base de datos del despliegue.
Primero realiza una simulación (dry-run) del cambio, rechaza cambios destructivos sin
confirmación explícita y puede realizar un respaldo antes de aplicar. La base de datos expone un
puerto en el archivo compose para que se pueda acceder a ella desde el host; elimina ese mapeo
una vez que el esquema esté listo si la base de datos no debe ser accesible desde el exterior.

`REBASE_MIGRATE_ON_BOOT` solo acepta `ensure` y `none`, y nada más; la
imagen **se niega a arrancar** con `push`, por la razón explicada anteriormente.

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es deliberado: la
alternativa por defecto sería el sistema de archivos del contenedor, que perdería silenciosamente cada
archivo subido en el siguiente reinicio. Las subidas se rechazan con
`501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para usar un bucket, define `STORAGE_TYPE=s3` (o `gcs`) junto con su bucket y credenciales;
el archivo compose lista las variables comentadas.

Para disco local, lo cual solo es apropiado cuando la ruta es un volumen real que
persiste más allá del ciclo de vida del contenedor:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` no es opcional en ese caso: en producción, un backend `local` se
descarta en lugar de registrarse, porque la alternativa serían subidas exitosas
en un sistema de archivos a punto de ser destruido. La variable es tu forma de indicar que el montaje
es persistente.

### El almacenamiento necesita un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue defina cómo se protegen los objetos. El almacenamiento no está protegido por
seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que sin ninguna regla
lo único que separa los archivos de dos usuarios es la imposibilidad de adivinar las claves, algo que
`GET /storage/list?prefix=` echa por tierra. Cualquiera de las siguientes opciones cumple con este requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto,
  que es la solución real y lo que el scaffold incluye en `config/storage.ts` (ninguna
  variable de entorno puede expresar «este usuario puede leer esta clave»);
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente funciona como una CDN pública
  de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino (single-tenant) donde
  se confía en que cualquier cuenta autenticada pueda acceder a todos los archivos.

Fuera de producción, esta misma condición genera una advertencia llamativa en lugar de un rechazo,
por lo que este es un error de arranque con el que te toparás en el despliegue y no en tu máquina local.
Es deliberado: el fallo al que reemplaza ocurre de forma silenciosa.

Define también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se define, los secretos
del autenticador almacenados se cifran con `JWT_SECRET`, por lo que rotarlo cerrará la sesión de todos
*y además* hará que todos los dispositivos registrados sean indescifrables.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier entorno que
ejecute contenedores funcionará. Dos cosas que debes configurar correctamente en todas partes:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él; consulta [Dependencias](#dependencias).
2. Define `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se negará a
   iniciar en producción sin ellos en lugar de intentar adivinar.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.21.1"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la forma de imagen derivada mencionada anteriormente para que el bundle se distribuya con la aplicación y luego
ejecuta `fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, define las variables de entorno y
establece la ruta del health check en `/livez`.

### Un VPS básico

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` lista las variables que lee. Bajo systemd (las
tres líneas de administración son nuevas; en 0.17.3, la primera cuenta en
registrarse se convierte en administradora):

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` no está de adorno. Si no se define, el proceso se ejecuta en
modo de desarrollo: refleja los orígenes localhost, sirve la especificación OpenAPI y
**deja abierta la ventana del primer administrador**, por lo que el primer desconocido que encuentre el
formulario de registro se convertirá en administrador. Las dos líneas `REBASE_ADMIN_*` son las que
reemplazan esa ventana; consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

Es preferible usar `EnvironmentFile=/etc/rebase.env` con permisos 0600 en el archivo
en lugar de líneas `Environment=` para los secretos: un archivo de unidad tiene permisos de lectura para todos, y
`systemctl show` muestra todos los valores de `Environment=`.

## Connection pooling

El runtime mantiene un pool pequeño y de larga duración, por lo que no necesita un pooler. Lo que
sí lo necesita es todo lo demás que se comunica con la misma base de datos y no puede mantener una conexión persistente:
una función serverless, un script programado, una herramienta de BI, un worker de colas que escala
a cincuenta instancias. El parámetro `max_connections` de Postgres es un límite estricto en los cientos bajos y
cada conexión es un *proceso*, por lo que un despliegue masivo de lambdas lo agotará mucho antes de que
la base de datos esté realmente ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, bajo un perfil
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

La autenticación del cliente se genera a partir de `DATABASE_URL` al iniciar, por lo que
la contraseña no se escribe dos veces. El pooler se autentica en Postgres mediante
`scram-sha-256`, que es lo que almacena Postgres 18; el valor por defecto `md5` de la imagen falla el
inicio de sesión del *servidor* con `FATAL: server login failed: wrong password type`, lo cual
parece un error de contraseña incorrecta cuando no lo es.

Mantén la suma de `PGBOUNCER_POOL_SIZE` de todos los poolers holgadamente por debajo del
`max_connections` de la base de datos: el runtime consume del mismo presupuesto.

### Lo que cambia con el transaction pooling

Un cliente en el pool retiene una conexión al servidor durante la duración de una transacción y
luego la devuelve, lo que permite que 500 clientes compartan 20 conexiones. Tres
cosas dejan de funcionar a través de ese puerto, y cada una de ellas es algo que Rebase utiliza directamente
(motivo por el cual el runtime se conecta directamente y este puerto queda reservado para otros
clientes):

- **`LISTEN`/`NOTIFY`.** Realtime se basa en esto, y un listener necesita una
  conexión que dure más allá de una transacción. `LISTEN` es *aceptado* por el
  pooler (responde a `LISTEN`), pero luego nunca llega ninguna notificación.
- **Estado de sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos (advisory locks) mantenidos
  entre sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción
  puede recaer en una conexión de servidor diferente que no verá nada de esto. Ambas
  situaciones fallan de la misma manera confusa: con un solo cliente inactivo, el estado suele
  seguir ahí, por lo que funciona mientras haces pruebas y deja de funcionar bajo
  la concurrencia para la cual introdujiste el pooler.
- **Sentencias preparadas a nivel de protocolo (prepared statements).** A la mayoría de los drivers se les puede indicar que no las
  utilicen: node-postgres no lo hace por defecto; asyncpg necesita
  `statement_cache_size=0`.

`SET LOCAL` tiene alcance de transacción y sí funciona, que es como se configura la
seguridad a nivel de fila; por lo tanto, RLS se comporta de manera idéntica a través del puerto con pool.

Deja el perfil desactivado si nada fuera del runtime se conecta a tu base de datos.
Un puerto sin usar es superficie de ataque.

## Health checks

| Path | Use for |
| --- | --- |
| `/livez` | Liveness. Responde «¿está vivo este proceso?» sin interactuar con la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta (round-trip) a la base de datos e informa la latencia. |

Apunta los sondeos de liveness a `/livez`. Un sondeo de liveness en `/health` reiniciará un
proceso perfectamente sano durante una breve interrupción de la base de datos, lo cual es justo lo contrario
de su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: conteo de peticiones e histogramas de latencia
desglosados por superficie de API (data, auth, storage, functions) y colección,
además de indicadores (gauges) del proceso. Sin un token, el endpoint puede ser leído por cualquiera que alcance
el puerto, así que define uno a menos que esté en una red privada.

## Ejecutar funciones en su propio proceso

Todo lo anterior consiste en un único contenedor que sirve a todo el proyecto, lo cual es la estructura adecuada
para casi cualquier despliegue. Cuando una función personalizada deba dejar de competir
con la API de datos por el bucle de eventos (event loop) —o deba escalar, reiniciarse y fallar de forma
independiente—, la misma imagen y el mismo bundle pueden arrancarse como varios
procesos colaborativos. Consulta [Procesos separados](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.21.1
```

Reinicia. Tu bundle no cambia. Dentro de una versión principal (major) del contrato del runtime, un bundle que
se haya validado seguirá funcionando; consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
