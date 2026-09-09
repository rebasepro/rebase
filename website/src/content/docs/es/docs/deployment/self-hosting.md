---
sourceHash: aa153f3ab4c80526
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen de runtime oficial y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS convencional.
---

## Visión general

Autoalojar Rebase implica ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que compilar**. Tu proyecto viaja como un bundle,
el runtime está publicado y actualizar Rebase es un cambio de etiqueta en lugar de una
recompilación. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/)
para saber por qué está dividido de esa manera.

## Docker Compose

**Si tu proyecto proviene de `rebase init`, utiliza su propio `docker-compose.yml`.**
Está en tu repositorio, `init` completó sus secretos, su primera cuenta de administrador
y su versión fija de runtime, y es el archivo que describe
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

El resto de esta página es el mismo despliegue sin un scaffold detrás:
el proyecto de otra persona, un bundle compilado en CI o las dos cosas que el
archivo generado omite deliberadamente: un gestor de conexiones (connection pooler)
y las configuraciones de procesos divididos. Ese archivo se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilízalo en lugar de copiar un fragmento de esta página: ambos archivos son arrancados por
el propio filtro de aceptación del proyecto en cada push, por lo que ninguno puede desviarse
de lo que realmente funciona.

Ambos coinciden en todas las variables de entorno excepto en la contraseña de la base de datos,
y esto se debe a que cada uno está diseñado para su propio generador: este lee
`POSTGRES_PASSWORD`, generado por `quickstart.sh`; el generado lee
`DATABASE_PASSWORD`, que `rebase init` también incluye en la `DATABASE_URL` que
escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un solo comando que hace dos cosas evidentes e imprime ambas. La
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

- **`POSTGRES_PASSWORD`**: la contraseña de la base de datos. Cambiarla más adelante implica
  cambiarla también en el volumen, así que elígela una sola vez.
- **`JWT_SECRET`**: firma cada sesión. Rotarlo cierra la sesión de todos.
- **`REBASE_SERVICE_KEY`**: la credencial que omite la seguridad a nivel de fila (RLS) para
  llamadas de servidor a servidor. Trátala como una contraseña de root: cualquier cosa que la
  posea puede leer todas las filas.
- **`CORS_ORIGINS`**: los orígenes desde los que se sirve tu frontend, separados por comas.
  No es un secreto ni tampoco opcional: el runtime se niega a arrancar en producción
  sin él en lugar de adivinar, porque una API que adivina sus orígenes permitidos tarde o
  temprano permite el incorrecto.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`**: el primer
  administrador. Una base de datos nueva no tiene usuarios y, fuera de producción, la
  política de registro admite el primer registro y lo asciende a admin;
  de lo contrario, una base de datos vacía es un callejón sin salida, ya que
  inicializar un administrador requiere un emisor que ya haya iniciado sesión. El momento en
  que este stack responde en un nombre de host, esa conveniencia se convierte en una carrera
  que el operador puede perder, por lo que en producción esa ventana se cierra y la cuenta se
  define aquí. El runtime la crea una sola vez mientras la tabla de usuarios esté vacía,
  y no hace nada en los arranques posteriores.

Cada uno de los tres secretos debe tener al menos 32 caracteres, y la contraseña de administrador
al menos 12. Utiliza una dirección con un punto en su dominio: `POST /auth/login` valida
su cuerpo con `z.string().email()`, por lo que `admin@localhost` crearía una cuenta y
luego rechazaría cualquier intento de usarla. El archivo compose declara los seis con
`${VAR:?…}`, por lo que la ausencia de uno detiene el stack con un mensaje que lo identifica
en lugar de iniciar algo mal configurado; además, el autorregistro viene deshabilitado
(`DISABLE_SELF_REGISTRATION`, valor predeterminado `true`), por lo que nada queda expuesto a ser reclamado.

Inicia sesión con esas credenciales y cambia la contraseña: se encuentran en un
archivo en el host.

## Dependencias

De forma predeterminada, `rebase build` **instala las dependencias de tu proyecto en el bundle**,
por lo que `dist-bundle` incluye un `node_modules` y un `package-lock.json`
junto a su `package.json`. Un bundle empaquetado (vendored) se inicia en unos cinco segundos.

Dado que ya están allí, puedes montar el bundle en modo de solo lectura; vale la
pena hacerlo, ya que un hook comprometido no podrá reescribir el código que se ejecutará tras el
siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esta opción y genera un bundle que instala sus
dependencias en el primer inicio, lo que toma entre 40 y 60 segundos por arranque y
requiere que el montaje tenga permisos de escritura.

Para un despliegue real, es preferible integrar ambos en una imagen, lo que también fija
con exactitud qué es lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas que falten durante el arranque, incluidas las de tus colecciones.**
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, el cual es aditivo en todo el
esquema: crea las tablas, columnas y tipos enum faltantes, y aplica su
seguridad a nivel de fila. Un primer inicio contra una base de datos vacía se levanta
sirviendo tus colecciones sin ningún paso adicional.

Lo que `ensure` deliberadamente nunca hace es cambiar nada que ya exista. No
altera el tipo de una columna, no elimina una tabla o columna ni
edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe poder
modificar la estructura de un esquema como efecto secundario de un despliegue.

Por lo tanto, aún vale la pena ejecutar `rebase db push` para las dos cosas que el
arranque no toca:

```bash
rebase db push
```

- **RLS en tablas de unión** para relaciones many-to-many.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo
  más restrictivo, un campo eliminado.

Ejecútalo desde una copia local del repositorio o un trabajo de CI, apuntando a la base de datos
del despliegue. Realiza una prueba en seco (dry-run) del cambio primero, rechaza los cambios
destructivos sin confirmación explícita y puede realizar una copia de seguridad antes de aplicarlos.
La base de datos expone un puerto en el archivo compose para que este comando pueda comunicarse con
ella desde el host; elimina ese mapeo una vez que el esquema esté listo si la base de datos no debe ser
accesible desde el exterior.

`REBASE_MIGRATE_ON_BOOT` solo acepta `ensure` y `none`, nada más; la
imagen **se niega a arrancar** con `push`, por la razón antes mencionada.

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es
intencional: la alternativa por defecto sería el sistema de archivos del contenedor, el cual
perdería silenciosamente todos los archivos subidos tras el siguiente reinicio. Las subidas se rechazan con
`501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) junto con su bucket y credenciales;
el archivo compose enumera las variables comentadas.

Para almacenamiento local en disco, lo cual solo es adecuado cuando la ruta es un volumen real que
persiste tras la vida útil del contenedor:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` no es opcional en este caso: en producción, un backend `local` se
descarta en lugar de registrarse, porque la alternativa serían subidas exitosas en un sistema de
archivos a punto de destruirse. La variable es tu forma de indicar que el montaje
es persistente.

### El almacenamiento necesita un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción**
hasta que el despliegue declare cómo se protegen los objetos. El almacenamiento no está protegido por
seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que
sin ninguna regla lo único que separa los archivos de dos usuarios es la dificultad de adivinar las claves,
algo que `GET /storage/list?prefix=` echa por tierra. Cualquiera de estas opciones lo satisface:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto,
  que es la solución real y lo que el scaffold incluye en `config/storage.ts`:
  ninguna variable de entorno puede expresar "este usuario puede leer esta clave";
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente funciona como un CDN
  público de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino
  donde se confía en cualquier cuenta autenticada para acceder a cualquier archivo.

Fuera de producción, esta misma condición genera una advertencia visible en lugar de un rechazo,
por lo que es un error de arranque con el que te toparás en el despliegue y no en tu máquina local.
Es intencional: el fallo que reemplaza es silencioso.

Define también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si se deja sin configurar,
los secretos de autenticación almacenados se cifran con `JWT_SECRET`, por lo que rotarlo cerraría
la sesión de todos *y* haría que todos los dispositivos vinculados fuesen indescifrables.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier entorno
que ejecute contenedores funciona. Dos cosas que debes configurar correctamente en todas partes:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él; consulta [Dependencies](#dependencies).
2. Configura `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega a
   arrancar en producción sin ellos en lugar de adivinar.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.19.1"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utiliza el formato de imagen derivada anterior para que el bundle se incluya con la aplicación, y luego
`fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, configura las variables de entorno y define
la ruta del health check en `/livez`.

### Un VPS convencional

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` enumera las variables que lee. Bajo systemd —las
tres líneas de admin son nuevas, y en la versión 0.17.3 la primera cuenta en
registrarse se convierte en el administrador en su lugar:

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
reemplazan esa ventana; consulta [Your first
admin](/docs/getting-started/deployment/#your-first-admin).

Para los secretos, prefiere `EnvironmentFile=/etc/rebase.env` con el archivo en modo 0600 sobre
líneas `Environment=`: un archivo de unidad de systemd es legible por cualquier usuario y
`systemctl show` imprime todos los valores de `Environment=`.

## Connection pooling

El runtime mantiene un pool pequeño y de larga duración, por lo que no necesita un pooler. Lo que
sí lo necesita es todo lo demás que se comunica con la misma base de datos y no puede retener una conexión:
una función serverless, un script programado, una herramienta de BI, un worker de colas que escala
a cincuenta instancias. El parámetro `max_connections` de Postgres es un límite estricto de unos pocos cientos
y cada conexión es un *proceso*, por lo que un despliegue masivo de lambdas lo agotará mucho antes de que
la base de datos esté ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, protegido tras un perfil
para que un despliegue sin tales llamadas no ejecute un proceso que no necesita:

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

La autenticación del cliente se genera a partir de `DATABASE_URL` durante el inicio, por lo que
la contraseña no se escribe dos veces. El pooler se autentica en Postgres mediante
`scram-sha-256`, que es lo que almacena Postgres 18; el valor predeterminado `md5` de la imagen falla en el
inicio de sesión del *servidor* con `FATAL: server login failed: wrong password type`, lo
cual parece un error de contraseña incorrecta pero no lo es.

Mantén la suma de `PGBOUNCER_POOL_SIZE` de todos los poolers holgadamente por debajo
del `max_connections` de la base de datos; el runtime consume del mismo presupuesto.

### Qué cambia con el pooling de transacciones

Un cliente en el pool retiene una conexión del servidor durante la duración de una transacción y
luego la devuelve, lo que permite que 500 clientes compartan 20 conexiones. Tres
cosas dejan de funcionar a través de ese puerto, y cada una de ellas es algo que el propio Rebase utiliza,
razón por la cual el runtime se conecta directamente y este puerto queda reservado para otros
emisores:

- **`LISTEN`/`NOTIFY`.** Realtime se basa en esto, y un listener necesita una
  conexión que dure más que una transacción. `LISTEN` es *aceptado* a través del
  pooler: responde a `LISTEN`, pero nunca llega ninguna notificación.
- **Estado de la sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos mantenidos
  entre sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción
  puede recaer en una conexión de servidor diferente, la cual no verá nada de esto. Ambos
  fallan de la misma manera engañosa: con un solo cliente inactivo, el estado suele
  seguir ahí, por lo que funciona mientras pruebas y deja de funcionar bajo la
  concurrencia para la cual introdujiste el pooler.
- **Sentencias preparadas a nivel de protocolo.** A la mayoría de los controladores se les puede indicar
  que no las usen: node-postgres no lo hace por defecto; asyncpg necesita
  `statement_cache_size=0`.

`SET LOCAL` tiene alcance de transacción y funciona, que es con lo que se configura
la seguridad a nivel de fila; por lo tanto, RLS se comporta de manera idéntica a través del puerto del pool.

Deja el perfil desactivado si nada fuera del runtime se conecta a tu base de datos.
Un puerto sin usar es superficie de ataque.

## Health checks

| Path | Use for |
| --- | --- |
| `/livez` | Liveness. Responde a "¿sigue vivo este proceso?" sin consultar la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta a la base de datos y reporta la latencia. |

Apunta las sondas de liveness a `/livez`. Una sonda de liveness en `/health` reiniciaría un
proceso perfectamente sano durante un breve contratiempo de la base de datos, lo cual es lo opuesto
a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: conteo de peticiones e histogramas de latencia
desglosados por superficie de la API (data, auth, storage, functions) y colección, además de
indicadores (gauges) del proceso. Sin un token, cualquier persona que pueda alcanzar el puerto
puede leer el endpoint, así que define uno a menos que esté en una red privada.

## Ejecución de funciones en su propio proceso

Todo lo anterior consiste en un único contenedor que sirve a todo el proyecto, lo cual es la estructura
adecuada para casi cualquier despliegue. Cuando una función personalizada deba dejar de competir
con la API de datos por el event loop —o deba escalar, reiniciarse y fallar de forma independiente—,
la misma imagen y el mismo bundle pueden arrancarse como varios procesos cooperativos.
Consulta [Split processes](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.19.1
```

Reinicia. Tu bundle permanece sin cambios. Dentro de una versión principal del contrato del runtime,
un bundle validado continuará funcionando; consulta
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).

---
