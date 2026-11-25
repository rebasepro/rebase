---
sourceHash: 5490764f32356e9d
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: Ejecuta Rebase en cualquier lugar con la imagen oficial del runtime y el bundle de tu proyecto — Docker Compose, Fly, Railway o un VPS estándar.
---

## Descripción general

Hospedar Rebase por tu cuenta implica ejecutar dos cosas: una base de datos Postgres y la imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que compilar**. Tu proyecto viaja como un bundle, el runtime está publicado, y actualizar Rebase es un cambio de etiqueta en lugar de una recompilación. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) para ver por qué se divide de esa manera.

## Docker Compose

**Si tu proyecto se originó a partir de `rebase init`, usa su propio `docker-compose.yml`.**
Está en tu repositorio, `init` completó sus secretos, su primera cuenta de administrador y su versión fijada del runtime, y es el archivo que describe [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

El resto de esta página trata sobre el mismo despliegue sin un scaffold detrás: el proyecto de otra persona, un bundle compilado en CI, o las dos cosas que el archivo generado omite deliberadamente: un agrupador de conexiones (connection pooler) y las variantes de procesos divididos. Este se encuentra en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Úsalo en lugar de copiar un fragmento de esta página: ambos archivos son arrancados por el propio control de aceptación del proyecto en cada push, por lo que ninguno puede desviarse de lo que realmente funciona.

Ambos coinciden en todas las variables de entorno excepto en la contraseña de la base de datos, y esto se debe a que cada uno está diseñado para su propio generador: este lee `POSTGRES_PASSWORD`, generado por `quickstart.sh`; el generado lee `DATABASE_PASSWORD`, que `rebase init` también inserta en la `DATABASE_URL` que escribe en tu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` es un único comando que hace dos cosas evidentes y muestra ambas en pantalla. La forma extendida, si prefieres controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No necesitas iniciar la base de datos por separado: `api` espera su healthcheck.

### Los seis valores que necesita

`quickstart.sh` los genera por ti. Para escribir el `.env` tú mismo:

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

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más adelante implica cambiarla también en el volumen, así que elígela una sola vez.
- **`JWT_SECRET`** — firma cada sesión. Rotarla cerrará la sesión de todos.
- **`REBASE_SERVICE_KEY`** — la credencial que omite la seguridad a nivel de fila (RLS) para llamadas de servidor a servidor. Trátala como una contraseña de root: cualquier cosa que la posea puede leer todas las filas.
- **`CORS_ORIGINS`** — los orígenes desde donde se sirve tu frontend, separados por comas. No es un secreto y no es opcional: el runtime se niega a arrancar en producción sin este valor en lugar de adivinar, porque una API que adivina sus orígenes permitidos tarde o temprano permite el equivocado.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — el primer administrador. Una base de datos nueva no tiene usuarios, y fuera de producción la política de registro admite el primer registro y lo asciende a admin; de lo contrario, una base de datos vacía es un callejón sin salida, porque inicializar un admin requiere un cliente que ya haya iniciado sesión. En el momento en que este stack responde en un nombre de host, esa comodidad se convierte en una carrera que el operador puede perder, por lo que en producción la ventana se cierra y la cuenta se define aquí. El runtime la crea una sola vez, mientras la tabla de usuarios esté vacía, y no hace nada en los arranques posteriores.

`JWT_SECRET` y `REBASE_SERVICE_KEY` deben tener al menos 32 caracteres cada uno, y la contraseña de administrador al menos 12. Usa una dirección con un punto en su dominio: `POST /auth/login` valida su cuerpo con `z.string().email()`, por lo que el runtime se niega a inicializar `admin@localhost` —una cuenta con la que nadie podría iniciar sesión— y en su lugar registra el motivo en los logs. El archivo compose declara los seis valores con `${VAR:?…}`, de modo que si falta uno, detiene el stack con un mensaje que lo identifica en lugar de iniciar algo a medio configurar; y el autorregistro viene deshabilitado (`DISABLE_SELF_REGISTRATION`, por defecto `true`), por lo que no queda nada vulnerable para ser reclamado.

Inicia sesión con esas credenciales y cambia la contraseña: se encuentran en un archivo en el host.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto dentro del bundle** por defecto, por lo que `dist-bundle` incluye un `node_modules` y un `package-lock.json` junto a su `package.json`. Un bundle con dependencias empaquetadas (vendored) se inicia en unos cinco segundos.

Dado que ya están allí, puedes montar el bundle en modo solo lectura; vale la pena hacerlo, ya que un hook comprometido no podrá reescribir el código que se ejecutará tras el próximo reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desactiva esto y genera un bundle que instala sus dependencias en el primer arranque, lo cual tarda entre 40 y 60 segundos por inicio y requiere que el montaje tenga permisos de escritura.

Para un despliegue real, es preferible empaquetar ambos dentro de una imagen, lo que también fija con exactitud lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.38.0
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas faltantes durante el arranque, incluidas las que declara `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema: crea tablas, columnas y tipos enum faltantes, y aplica su seguridad a nivel de fila. Un primer inicio frente a una base de datos vacía arranca sirviendo tus tablas, sin requerir ningún paso adicional.

Lo que `ensure` deliberadamente nunca hace es modificar algo que ya existe. No altera el tipo de una columna, no elimina tablas ni columnas, y no edita las etiquetas de un enum existente; ya que el reinicio de un contenedor no debe poder alterar la forma de un esquema como efecto secundario de un despliegue.

Por lo tanto, `rebase db push` sigue siendo útil para todo aquello que el arranque no toca: cualquier cambio que no sea puramente aditivo, como una columna renombrada, un tipo más restrictivo o un campo eliminado.

```bash
rebase db push
```

Ejecútalo desde una copia local del repositorio o un trabajo de CI, apuntando a la base de datos del despliegue. Realiza una simulación (dry-run) del cambio primero, rechaza cambios destructivos sin confirmación explícita y puede realizar una copia de seguridad antes de aplicarlos. La base de datos expone un puerto en el archivo compose para que se pueda acceder a ella desde el host; elimina ese mapeo una vez que el esquema esté aplicado si no se debe poder acceder a la base de datos desde el exterior.

`REBASE_MIGRATE_ON_BOOT` acepta `ensure` y `none`, y nada más; la imagen **se niega a arrancar** con `push`, por la razón mencionada anteriormente.

## Cuando solo tu proceso de cambios puede modificar la base de datos

`REBASE_MIGRATE_ON_BOOT=none` no toca tus tablas. Sin embargo, no deja intacta la base de datos: las tablas propias del framework (autenticación, API keys, trabajos, cron) se siguen creando y manteniendo actualizadas en cada arranque. Cuando la base de datos solo deba modificarse a través de un proceso de cambios revisado, establece `REBASE_PROVISION=false` en cada proceso que atienda peticiones:

| Configuración | Tablas y políticas declaradas | Tablas del framework |
|---|---|---|
| por defecto (`REBASE_MIGRATE_ON_BOOT=ensure`) | creadas y mantenidas actualizadas al arrancar | creadas y mantenidas actualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | sin cambios | creadas y mantenidas actualizadas |
| `REBASE_PROVISION=false` | sin cambios | sin cambios; lo que falte se detalla en el log |

Con el aprovisionamiento desactivado, el runtime no crea ni altera nada: ninguna tabla, columna, índice, función, trigger, política, rol o permiso (grant). Esto se aplica tanto en el arranque como posteriormente, incluidas las tablas que un proceso en ejecución crearía en su primer uso (claves de idempotencia, bloqueos de cron, contadores compartidos de límite de tasa). En su lugar, lee lo que ya existe:

- **Faltan tablas de autenticación o una columna que la autenticación lee:** el arranque se rechaza y se lista cada una.
- **El rol de solicitud puede acceder a una tabla del framework** como
  `rebase.refresh_tokens` o `rebase.api_keys`: el arranque se rechaza y muestra la sentencia `REVOKE` que se debe ejecutar. Un arranque con aprovisionamiento revoca esos privilegios automáticamente. Con el aprovisionamiento desactivado, nada lo hace.
- **Falta una tabla opcional** (API keys, claves de idempotencia, bloqueos de cron, contadores de límite de tasa, presencia, historial de métricas): esa funcionalidad queda deshabilitada y el log indica qué tabla necesita.
- **Una tabla declarada que la base de datos no protege** — seguridad a nivel de fila (RLS) deshabilitada, ninguna de las políticas que declara está presente, o falta una política restrictiva que declara: esa tabla no se servirá (si falta una política permisiva, sí se sirve, pero con una advertencia en el arranque que la menciona). Una solicitud a dicha tabla responderá `503 TABLE_WITHHELD`, y el log de arranque indicará el SQL que la protege (o `rebase db push`). Las demás tablas sí se sirven y el arranque continúa. Las tablas intermedias de relaciones muchos a muchos se verifican de la misma manera: si la base de datos no protege una de ellas, se retienen las tablas cuyas relaciones la utilicen, y `TABLE_WITHHELD` nombrará la unión. Una tabla cuya relación `via` pase por una tabla retenida también será retenida, y el mensaje nombrará la relación. Esto también aplica con `REBASE_MIGRATE_ON_BOOT=none` y durante una actualización del esquema en caliente. Una tabla cuyo acceso gestiona la propia aplicación puede especificar `rlsRequired: false` para servirse de todos modos ([cómo hacerlo](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

Las filas se siguen modificando como en cualquier base de datos: inicios de sesión, sesiones, uso de API keys, claves de idempotencia, bloqueos de cron. La primera cuenta de administrador (`REBASE_ADMIN_EMAIL`) es creada por la ejecución de aprovisionamiento, no por los procesos que sirven tráfico. La [Edición de esquema en vivo](/docs/backend/live-schema-editing) aún puede guardar cambios en el código fuente, pero se negará a aplicarlos a la base de datos.

### La ejecución de aprovisionamiento

El esquema proviene de una ejecución controlada por tu proceso de cambios. Usa la misma imagen y bundle que el servidor, con `REBASE_PROVISION_ONLY=true`, conectándote con un rol que tenga permisos de creación en la base de datos. `REBASE_PROVISION_SQL_OUT` guarda cada cambio de esquema realizado durante la ejecución en un script SQL:

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

La imagen se ejecuta con `NODE_ENV=production`, por lo que esta ejecución se somete a las mismas comprobaciones de entorno que el servidor, incluidas `CORS_ORIGINS` o `FRONTEND_URL`, a pesar de que no sirve nada.

El script es un registro, no un plan: cada sentencia en él se ejecutó, en orden, y tuvo éxito. Si se genera contra una base de datos vacía, contiene todo el esquema necesario para la versión. Si se genera contra una copia restaurada de producción, contiene exactamente la actualización. Las filas que la ejecución haya escrito no están incluidas. Revísalo y luego aplícalo a la base de datos real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repite este proceso para cada actualización de Rebase, antes de actualizar gradualmente los procesos que atienden tráfico. Una nueva versión puede agregar una tabla o una columna, y un proceso que no tiene permisos para crearla informará que falta en lugar de crearla.

Un servidor que compiles tú mismo sigue la misma regla: `initializeRebaseBackend` lee `REBASE_PROVISION` y `createRebaseBackend` acepta [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Almacenamiento de archivos

El almacenamiento está **desactivado** a menos que se configure un bucket, y esto es intencional: la alternativa predeterminada sería el sistema de archivos del contenedor, el cual perdería silenciosamente cada archivo subido en el siguiente reinicio. Las subidas se rechazarán con `501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para usar un bucket, define `STORAGE_TYPE=s3` (o `gcs`) junto con su bucket y credenciales; el archivo compose incluye estas variables comentadas. `gcs` carga `@google-cloud/storage`, que no se incluye en la imagen oficial, por lo que en esa imagen debes conectarte a Google Cloud Storage a través de su endpoint compatible con S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, claves HMAC).

Para disco local, que solo es apropiado cuando la ruta es un volumen real que persiste tras la destrucción del contenedor:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` no es opcional en este caso: en producción, un backend `local` se descarta en lugar de registrarse, porque la alternativa serían subidas exitosas a un sistema de archivos a punto de ser destruido. Esta variable es la forma de indicar que el montaje es persistente.

Monta el volumen **en el directorio superior** a `STORAGE_PATH`, no directamente en él. `STORAGE_PATH` es el directorio del bucket por defecto, y cada bucket declarado en `backend/resources.ts` obtiene el suyo junto a este, `<STORAGE_PATH>__<key>`. Un volumen montado directamente en `STORAGE_PATH` solo contendrá el bucket por defecto. Cualquier otro bucket escribirá en el sistema de archivos del contenedor y perderá sus archivos cuando este se recree. `STORAGE_PATH__MEDIA` puede reubicar un bucket en otra parte del volumen. Sin embargo, no puede ubicarlo dentro del directorio de otro bucket, como `/storage/uploads/media`, ya que el bucket por defecto listaría, serviría y eliminaría sus archivos.

La imagen crea `/storage` para el usuario sin privilegios `node` con el que se ejecuta, razón por la cual el volumen va allí. Un volumen montado en una ubicación donde la imagen no tiene un directorio pertenecerá a root, y cada subida fallará con `EACCES`. El archivo compose que genera `rebase init` lo monta de esta manera.

### El almacenamiento requiere un modelo de control de acceso

Una vez que un bucket **está** configurado, el runtime **se niega a arrancar en producción** hasta que el despliegue declare cómo se protegen los objetos. El almacenamiento no está cubierto por la seguridad a nivel de fila y sus claves comparten un único espacio de nombres plano, por lo que sin ninguna regla, lo único que separa los archivos de dos usuarios es la dificultad para adivinar las claves, algo que `GET /storage/list?prefix=` invalida. Cualquiera de las siguientes opciones satisface este requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) en la configuración de tu proyecto, que es lo que incluye el scaffold en `backend/storage.ts`;
- **`STORAGE_POLICIES`**, las mismas reglas en formato JSON: "owner" para una carpeta por usuario, roles para administradores (consulta [Storage authorization](/docs/backend/storage-authorization/#as-data-storage_policies));
- **`STORAGE_PUBLIC_READ=true`**, para un bucket que realmente funciona como un CDN público de solo lectura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para una aplicación de un solo inquilino donde cualquier cuenta autenticada tiene acceso a todos los archivos.

Fuera de producción, esta misma condición genera una advertencia visible en lugar de un error de arranque, por lo que este fallo solo se presenta en el despliegue y no en tu máquina local. Esto es intencional: el fallo que reemplaza ocurría de forma silenciosa.

Define también `MFA_ENCRYPTION_KEY` si utilizas TOTP. Si no se define, los secretos de autenticador almacenados se cifran con `JWT_SECRET`, por lo que rotarlo cerrará la sesión de todos *y además* hará que ningún dispositivo registrado pueda descifrarse.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier servicio que ejecute contenedores funcionará. Dos cosas que debes configurar correctamente en cualquier lugar:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`), con sus dependencias instaladas junto a él; consulta [Dependencies](#dependencias).
2. Configura `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se niega a iniciar en producción sin ellos en lugar de adivinar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.38.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa el formato de imagen derivada mostrado arriba para que el bundle se distribuya con la aplicación, y luego ejecuta `fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, configura las variables de entorno y define la ruta del health check en `/livez`.

### Un VPS estándar

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` lista las variables que lee. En systemd:

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

`NODE_ENV=production` no es un adorno. Si no se define, el proceso se ejecuta en modo de desarrollo: refleja los orígenes de localhost, sirve la especificación OpenAPI y **deja abierta la ventana del primer administrador**, de modo que la primera persona desconocida que encuentre el formulario de registro se convertirá en administrador. Las dos líneas `REBASE_ADMIN_*` son las que reemplazan esa ventana; consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque la base de datos se encuentra en la misma máquina. En producción, el runtime rechaza cualquier variable que apunte a localhost (en un contenedor, loopback es el propio contenedor, por lo que esa dirección siempre es un error) y esta línea le indica que esa dirección es intencional. Elimínala si la base de datos se ejecuta en otro lugar.

Es preferible usar `EnvironmentFile=/etc/rebase.env` con el archivo en modo 0600 en lugar de líneas `Environment=` para los secretos: un archivo de unidad puede ser leído por cualquier usuario del sistema y `systemctl show` imprime todos los valores de `Environment=`.

## Pool de conexiones

El runtime mantiene su propio pool pequeño y no requiere un pooler externo. Para todo lo demás que se comunique con la misma base de datos y no pueda mantener una conexión persistente —funciones serverless, scripts programados, un worker que escala horizontalmente—, el archivo compose incluye un servicio `pgbouncer` bajo el perfil `pooler`. Consulta [Connection pooling](/docs/deployment/connection-pooling/).

## Comprobaciones de salud (Health checks)

| Ruta | Uso |
| --- | --- |
| `/livez` | Liveness. Responde "¿está vivo este proceso?" sin consultar la base de datos. |
| `/health` | Readiness. Realiza un viaje de ida y vuelta a la base de datos e informa la latencia. |

Apunta los probes de liveness a `/livez`. Un probe de liveness hacia `/health` reiniciará un proceso perfectamente sano durante un breve fallo temporal de la base de datos, lo cual es lo opuesto a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuento de solicitudes e histogramas de latencia desglosados por superficie de la API (data, auth, storage, functions) y tabla, además de indicadores (gauges) del proceso. Sin un token, el endpoint es accesible para cualquiera que pueda conectarse al puerto, así que define uno a menos que se encuentre en una red privada.

`rebase_db_pool_wait_ms` es un histograma de cuánto tiempo esperó cada consulta por una conexión del pool de la base de datos, incluida la apertura de una nueva, etiquetado por clave de fuente de datos (`source="(default)"` en un proyecto que no declare fuentes de datos). Un pool saludable lo mantiene cerca de cero. Una cola que crece con el tráfico significa que las solicitudes están esperando conexiones, frecuentemente retenidas por hooks de escritura que esperan operaciones lentas; consulta [A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

La base de datos en sí, por fuente de datos:

| Métrica | Qué indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Conexiones de cada pool, etiquetadas como `pool="primary"`, `"read"` (la réplica) o `"session"` (el pool directo de la consola SQL detrás de un pooler). Un valor de `waiting` superior a cero durante mucho tiempo indica un pool demasiado pequeño para su carga. |
| `rebase_db_connection_errors_total` | Solicitudes que respondieron 503 por falta de conexión, según `code`: `53300` / `53400` (el servidor no tiene más conexiones), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexiones de clientes en el servidor, por `state`, frente a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | El tamaño de la base de datos. |
| `rebase_db_replica_lag_seconds` | Cuánto retraso lleva `DATABASE_READ_URL` respecto a la primaria. |

Las últimas cuatro se muestrean cada 30 segundos en la propia conexión de la instancia, por lo que un raspado (scrape) nunca se traduce en una consulta.

`rebase_realtime_*` informa sobre los sockets abiertos de cada instancia, los canales y las tramas enviadas al bus de canales o retenidas: consulta [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeceras de seguridad

Cada respuesta incluye `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `Strict-Transport-Security: max-age=15552000` (180 días). La cabecera HSTS omite `includeSubDomains`: de lo contrario, indicaría a los navegadores que rechacen HTTP plano en todos los subdominios de tu dominio, incluidos aquellos con los que este servidor no tiene relación alguna, y un navegador mantiene esta regla durante todo el tiempo indicado en la cabecera.
Establece `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` cuando todos los subdominios sean exclusivamente HTTPS.

`strict-origin-when-cross-origin` es el comportamiento predeterminado de los navegadores: una solicitud hacia otro sitio incluye tu origen y nunca la ruta o consulta de la página. No es `no-referrer` porque las verificaciones de origen necesitan conocer el origen (el botón de inicio de sesión de Google lo compara con los orígenes de JavaScript autorizados del cliente OAuth, y con `no-referrer` respondía "The given origin is not allowed for the given client ID" en cualquier aplicación, sin importar lo que el cliente permitiera). Una respuesta que configure su propia política la conserva (la página de consentimiento de MCP envía `no-referrer`); una página que requiera una política más estricta puede indicarlo con `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funciona del mismo modo: `SAMEORIGIN` a menos que la respuesta configure la suya propia, como hace la página de consentimiento de MCP con `DENY`.

Las aplicaciones estáticas —el panel de administración del CMS y cualquier frontend que sirva el bundle— también incluyen `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Esto determina quién puede incrustar la aplicación en un frame, descarta plugins y fija `<base>` a tu origen, sin restringir nada más, de modo que los scripts en línea, los workers y el inicio de sesión de terceros sigan funcionando. Una respuesta que defina su propia política la mantiene. Para cualquier restricción mayor, añade la política en el proxy inverso delantero.

### Permitir que otro origen incruste una aplicación en un frame

`frame-ancestors 'self'` significa que solo una página en el propio origen de la aplicación puede incrustarla en un iframe. Un CMS en `admin.example.com` que previsualiza el sitio en `www.example.com` necesita que el sitio lo autorice, usando `frameAncestors` en la aplicación del sitio dentro de `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

El sitio se servirá entonces con `frame-ancestors 'self' https://admin.example.com`, al igual que cualquier [route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) del sitio cuya función no envíe una política propia. Las demás aplicaciones mantienen `'self'`. A su lado se sigue enviando `X-Frame-Options: SAMEORIGIN`; un navegador que interpreta `frame-ancestors` ignora `X-Frame-Options`, tal como exige la especificación de CSP.

Cada entrada es un único origen escrito de forma exacta: `https://` con un nombre de host y un puerto opcional, o `http://` para `localhost`, `127.0.0.1` y `[::1]` mientras desarrollas. No se admiten comodines, rutas ni palabras clave; `'self'` siempre está en la lista y cualquier otra cosa será rechazada por la CLI y nuevamente por el runtime antes de llegar a la cabecera. Nada está permitido a menos que lo especifiques explícitamente.

## Más de una instancia

Un único contenedor es la configuración por defecto y no necesita nada más. Antes de que una segunda réplica reciba tráfico —o que un despliegue gradual ejecute dos en paralelo—, revisa [Running more than one instance](/docs/deployment/multiple-instances/): los límites de tasa, los canales de difusión, los archivos locales, las subidas reanudables y la caché de imágenes son independientes por proceso hasta que una configuración los comparta.

## Conectar Claude

Un solo comando añade este servidor al [Rebase connector](/docs/ai/rebase-connector/), el conector MCP unificado que accede a todos tus proyectos desde Claude:

```bash
rebase cloud connect https://your-app.com
```

Configura en este servidor las dos variables que muestra en pantalla y reinícialo. El servidor debe ejecutar Rebase 0.28.1 o posterior y responder a través de HTTPS en una dirección pública. Nada más cambia: no guarda ningún secreto y concede al conector los mismos permisos que otorgaría Studio.

## Ejecutar funciones en su propio proceso

Todo lo anterior consiste en un único contenedor que sirve todo el proyecto, que es la estructura adecuada para casi cualquier despliegue. Cuando una función personalizada deba dejar de competir con la API de datos por el bucle de eventos —o deba escalar, reiniciarse y fallar de forma independiente—, la misma imagen y el mismo bundle pueden arrancarse como varios procesos que cooperan entre sí. Consulta [Split processes](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.38.0
```

Reinicia. Tu bundle no cambia. Dentro de una misma versión principal del contrato del runtime, un bundle que haya sido validado seguirá funcionando; consulta [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
