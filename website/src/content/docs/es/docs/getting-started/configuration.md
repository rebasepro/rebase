---
sourceHash: f6312cfcb6187cea
title: Entorno y Configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de Entorno

Toda la configuración se realiza a través de variables de entorno en tu archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al arrancar.
> Si falta algo obligatorio o está mal formado (una URL que no lo es, un puerto que
> no es un número), el servidor se niega a arrancar y nombra la variable.
>
> Dónde vive el esquema depende de cómo ejecutes el backend. Un proyecto arrancado
> por el runtime — `rebase dev`, `rebase start`, la imagen publicada — usa el
> esquema del propio runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas de abajo. Un proyecto que ha ejecutado
> [`rebase eject`](/docs/cli) posee su propio `backend/src/env.ts` con
> `loadEnv({ extend })`, y puede añadir allí sus variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo** — sin definir, `rebase dev` ejecuta una PostgreSQL gestionada para el proyecto, con sus datos en `.rebase/`. Obligatoria en todo lo demás. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utiliza una cadena aleatoria fuerte (mín. 32 caracteres). **Obligatoria en producción** (se autogenera en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una grafía de node-postgres, no de libpq.**
>
> Rebase y el driver de Node la aceptan — cifrar, pero no comprobar el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no, y no degradan: se
> niegan a arrancar con `invalid sslmode value: "no-verify"`.
>
> Los comandos propios de Rebase (`rebase db push`, `rebase db backup`, `rebase
> db restore`) la reescriben al equivalente `sslmode=require` antes de invocarlos,
> así que funcionan con la URL tal como está configurada. Usar `psql` a mano no —
> cambia allí a `sslmode=require`, que cifra sin verificar exactamente igual.

### Frontend

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `VITE_API_URL` | URL de la API del backend para el SDK del cliente. **Defínela solo en desarrollo** — mira abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deja `VITE_API_URL` sin definir en las builds de producción.**
>
> En desarrollo el frontend y el backend son orígenes distintos, así que el
> servidor de desarrollo la inyecta. En producción el backend de Rebase sirve la
> SPA, así que la API es el propio origen de la página y el cliente la resuelve
> así por sí solo.
>
> Hornear una URL absoluta en un bundle de producción funciona justo hasta que un
> segundo hostname apunta a la misma app: un dominio propio carga entonces la
> página desde `example.com` y llama a la API en `example.rebase.website`, que es
> cross-origin, así que toda petición falla en el preflight. Permitir el origen
> en CORS tampoco **lo arregla**: la cookie de refresco es `SameSite=Lax` y no se
> envía entre sitios, así que habrías limpiado los errores de consola y seguirías
> con la autenticación rota. Sin definir, cualquier dominio que apunte a la app
> funciona sin ninguna configuración de CORS.

### Backend

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `PORT` | Puerto para el servidor HTTP del backend. Lo lee `rebase start`. `rebase dev` lo lee **solo del entorno del shell** — un `PORT` en `.env` no se lee ahí, porque el puerto se resuelve antes de cargar ese archivo — y en caso contrario usa un puerto derivado de la ruta del proyecto, para que varios proyectos puedan ejecutarse a la vez. `rebase dev --port` prevalece sobre ambos, y el banner de inicio indica qué nivel usó. | `3001` |
| `LOG_LEVEL` | Nivel de verbosidad del registro: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL que hay detrás de una línea `Failed query: [redacted]`. Toda sentencia fallida se redacta por defecto, porque una consulta fallida arrastra sus parámetros ligados — un correo, un hash de contraseña. Ponlo a `true` mientras diagnosticas un fallo de DDL, RLS o captura de cambios. Se ignora con `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista de orígenes permitidos separados por comas. **Obligatoria en producción** si difiere del dominio del backend. En desarrollo se *añade a* localhost — mira abajo. | — |
| `FRONTEND_URL` | URL de la app frontend. Se usa como alternativa a `CORS_ORIGINS`, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión de base de datos de nivel administrador (para la introspección del esquema y las operaciones administrativas). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desactiva el cambio de rol de PostgreSQL en el Editor SQL (útil con autenticación propia donde los roles de BD no están mapeados). | `false` |

#### CORS en desarrollo

Desarrollo permite **localhost, más lo que nombre `CORS_ORIGINS` (o
`FRONTEND_URL`)** — la misma lista que usa producción, con localhost añadido en
lugar de sustituido. Así la variable funciona igual en ambos entornos, y los
casos que la necesitan en desarrollo son los normales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no es localhost ni está listado se rechaza, y el rechazo se
registra **una vez por origen** con la línea exacta que lo permitiría. Rechazar
no es prudencia porque sí: la API envía credenciales, así que reflejar un
`Origin` arbitrario dejaría que cualquier sitio que la desarrolladora visite haga
peticiones autenticadas contra el servidor de desarrollo con su sesión y lea las
respuestas.

### Autenticación

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `JWT_SECRET` | Secreto para la firma JWT (obligatorio en producción, autogenerado en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar los tokens de acceso de forma asimétrica (RS256), de modo que cualquier cosa que tenga el JWKS pueda verificar una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el base64 del PEM entero. Sin ella los tokens siguen siendo HS256. | — |
| `JWT_KEY_ID` | Nombra `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo siempre que cambie la clave — la rotación depende de que la vieja y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva, así que rige cuánto sobrevive una sesión a la **inactividad**. | `400d` |
| `ALLOW_REGISTRATION` | Permitir que nuevos usuarios se registren (`true`/`false`). Fuera de producción el **primer** usuario siempre puede registrarse, diga lo que diga esto — una tabla de usuarios vacía tiene que admitir a alguien, y ese alguien pasa a ser el administrador. En producción (`NODE_ENV=production`) esa ventana está cerrada: una tabla vacía rechaza el registro de arranque con `SETUP_REQUIRED`, una primera cuenta creada por registro abierto es una cuenta corriente, y el administrador se nombra con `REBASE_ADMIN_EMAIL` más abajo o se asigna con la clave de servicio. El `.env.example` del scaffold la pone a `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` <span class="since-badge" data-since="0.18">Since 0.18</span> | Interruptor de emergencia. Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja abierta a propósito fuera de producción, de modo que el registro queda cerrado incluso frente a una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de producir su primer llamante autenticado. Todos los artefactos de despliegue publicados la definen. | — |
| `REBASE_ADMIN_EMAIL` <span class="since-badge" data-since="0.18">Since 0.18</span> | Correo de la primera cuenta de administrador, creada en el arranque **mientras la tabla de usuarios sigue vacía** y nunca después. Así consigue su administrador un despliegue de producción: el operador nombra la primera cuenta en lugar de competir con internet por ella. El arranque avisa cuando la tabla está vacía en producción y esto queda sin definir. | — |
| `REBASE_ADMIN_PASSWORD` <span class="since-badge" data-since="0.18">Since 0.18</span> | Contraseña de esa cuenta. Al menos 12 caracteres, o se rechaza y la cuenta no se crea. Cámbiala tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra todos los secretos TOTP almacenados. Sin definir, los secretos se cifran con `JWT_SECRET` y el arranque avisa una vez — así que rotar `JWT_SECRET` cierra la sesión de todo el mundo *y* deja indescifrable cada autenticador registrado. Define una clave dedicada (32+ caracteres aleatorios) antes de que nadie se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave de la que te estás *alejando* al rotar. Define ambas durante una rotación: los secretos nuevos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, así nadie se queda fuera de su propia cuenta a mitad de la rotación. Quítala cuando todos los secretos se hayan recifrado. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Es opt-in, y deliberadamente no depende de `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticación para la API de datos. Ponla a `false` para una superficie de lectura totalmente pública — la RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se indica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por email. Solo para llamantes autenticados, y nunca devuelve el correo, los roles ni los metadatos del usuario encontrado. Desactivado por defecto: es una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de refresco: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es solo para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` en la cookie de refresco. Activado por defecto; `AUTH_COOKIE_SECURE=false` para http sin cifrar — un despliegue en una dirección de red local donde, de lo contrario, el navegador descarta la cookie y la sesión muere al expirar el token de acceso, sin ningún error. El arranque avisa. `http://localhost` no lo necesita. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth (validación del backend) | — |
| `GOOGLE_CLIENT_SECRET` | Secreto de cliente de Google OAuth | — |
| `GITHUB_CLIENT_ID` | ID de cliente de GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Secreto de cliente de GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | ID de cliente de Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Secreto de cliente de Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | ID de cliente de LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Secreto de cliente de LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | ID de cliente de Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Secreto de cliente de Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | ID de cliente de X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Secreto de cliente de X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | ID de cliente de Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Secreto de cliente de Discord OAuth | — |
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. La `baseUrl` de una instancia autoalojada no tiene grafía como variable de entorno — configura GitLab en el bloque `auth` para eso. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple. Apple no tiene un secreto de cliente estático — Rebase firma un JWT ES256 de vida corta por cada intercambio de token —, así que necesita los cuatro valores `APPLE_*` y sin ellos no configura nada. | — |
| `APPLE_TEAM_ID` | Team ID de Apple Developer, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API de administrador estática. Salta la autenticación JWT normal para llamadas de servidor a servidor cuando se pasa como `Authorization: Bearer <key>`. (Autogenerada en desarrollo). | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde viven los contadores del límite de tasa de auth: `memory` (por proceso) o `sql` (compartidos entre réplicas). Un proceso no puede ver su propio número de réplicas, así que un despliegue con pares tiene que decirlo — tres réplicas con el valor por defecto imponen tres veces el límite. Cualquier otro valor **se niega a arrancar** en lugar de recurrir a otro, `postgres` incluido. | `memory` |
| `AUTH_MAGIC_LINK` | Monta el flujo de inicio de sesión sin contraseña por enlace. Necesita un servicio de correo configurado, o el enlace no tiene adónde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo. El mismo requisito de correo que arriba. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación de captcha en las rutas de auth: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | El secreto del proveedor, usado en el servidor para verificar el token que envía el navegador. Obligatorio una vez que `CAPTCHA_PROVIDER` está definido. | — |
| `CAPTCHA_ROUTES` | Rutas de auth a proteger, separadas por comas (por ejemplo `register,login`). Sin definir protege el conjunto por defecto del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, así que necesita un modelo de acceso]
Las colecciones están protegidas por la RLS de Postgres. El almacenamiento de
objetos no tiene equivalente — las claves comparten un espacio de nombres plano —
así que con un bucket configurado y sin modelo de acceso el servidor **se niega a
arrancar en producción**. Satisfazlo con exactamente uno de: un hook
`storageAuthorize` exportado desde `config/index.ts` (lo que incluye el
scaffold), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción `local` desactiva el almacenamiento salvo que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para almacenamiento local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Permite almacenamiento local en producción — solo con un volumen duradero montado en `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nombre del bucket de S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Fuerza URLs de estilo path para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Normalmente se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio. Omítela en GCP, donde Workload Identity aporta las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve cada objeto a cualquiera, sin token. Solo para un bucket que de verdad sea una CDN pública. Una de las tres formas de satisfacer la comprobación de arranque de arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Deja que cualquier llamante autenticado lea, escriba, liste y borre todos los objetos. Se llama `INSECURE` en el objeto de configuración por algo: solo es defendible en una app de un solo inquilino donde se confía cada archivo a cada cuenta. | `false` |
| `STORAGE_RENDITION_CACHE` | Cachea las representaciones de imagen generadas (redimensionados, conversiones de formato) en lugar de producirlas por petición. | `false` |

### Correo Electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Nombre de usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos electrónicos del sistema |
| `SMTP_NAME` | Nombre mostrado en la dirección del remitente |
| `APP_NAME` | Nombre del producto usado en los asuntos y cuerpos de los correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrado encima de las plantillas de correo por defecto. PNG o JPG `http(s)` absoluto — los clientes eliminan SVG y bloquean los URI `data:`. Sin definir, una app que sigue llamándose `Rebase` recibe la marca de Rebase y una renombrada no recibe ninguna |

### Pool de conexiones de la base de datos

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `DB_POOL_MAX` | Máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera por una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) necesita una: `LISTEN`/`NOTIFY` no sobrevive a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambio se desactivan con un aviso en lugar de perderse en silencio. | — |
| `DATABASE_READ_URL` | Réplica de lectura. Las lecturas van ahí cuando está definida y difiere de `DATABASE_URL`; si la conexión falla, todo recurre a la primaria con un aviso. | — |
| `REBASE_DB_POOL_MAX` | Un techo para todos los pools del proceso, aplicado sea cual sea lo que pidió cada uno. Solo dígitos: un valor mal formado se ignora en lugar de serializar el servidor en silencio. | — |

### Comportamiento del runtime

Lo lee el runtime — `rebase dev`, `rebase start` y la imagen publicada del
servidor. Un proyecto que ha hecho eject es dueño de estas decisiones en su
propio código.

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Ejecuta la auditoría de seguridad a nivel de fila en el arranque y monta su endpoint, que informa de las tablas servidas sin políticas. | — |
| `REBASE_BASE_PATH` | Ruta base de todas las rutas de la API. Hay que decirle lo mismo al cliente — consulta [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los assets estáticos/de administración del bundle desde este proceso. Desactívalo cuando hay una CDN delante. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Cuerpo máximo de la petición, **en bytes** (`10485760`, no `10MB` — un valor que no es un número se niega a arrancar en lugar de quitar el límite en silencio). | — |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. Triestado: sin definir significa activada en desarrollo y desactivada en producción; `false` las apaga ambas en cualquier sitio. Ten en cuenta que `true` en producción sirve la **especificación** en `/api/docs` pero no la **UI** de Swagger en `/api/swagger` — la UI depende de `NODE_ENV` por separado. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token bearer que protege `/metrics`. Sin definir deja el endpoint abierto a cualquier cosa que alcance el puerto — bien en una red privada, no en una pública, y los registros de arranque lo dicen. | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacerle el runtime al esquema en el arranque. `ensure` (el valor por defecto, en todas partes — producción incluida) ejecuta la pasada **aditiva**: crear tablas, columnas y tipos enum que falten, nunca eliminar ni reescribir uno. `none` no toca nada. La imagen publicada solo acepta esos dos y **se niega a arrancar con `push`**. En un [despliegue partido](/docs/deployment/split-processes) exactamente un proceso puede aprovisionar, así que cualquier otro rol debe poner `none` o negarse a arrancar. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar cuando la base de datos se aprovisionó por última vez a partir de un conjunto de colecciones distinto de aquel con el que se compiló este proceso. Sin definir (o con cualquier cosa que no sea `true`/`1`) avisa en su lugar. | avisa |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (activarla donde la conexión lo soporte, recurrir en silencio si no), `trigger` (forzarla, avisar si es imposible), `wal` (hoy degrada a `trigger`), `off`. Consulta [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para los canales de difusión y la presencia: `memory` o `postgres`. Se ignora cuando a `realtime.bus` se le dio un transporte ya construido. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback bajo `NODE_ENV=production`. Desactivado, para que un arranque de producción falle ruidosamente en vez de conectarse a una base de datos que no está. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Qué hace el arranque con una clave de tus colecciones que esta versión no lee: `warn`, `error` (negarse a arrancar — vale la pena activarlo en CI) u `off`. Solo rige las claves que no *reconoce*, que suelen ser una errata y en ocasiones metadatos deliberados; una clave que sabe que se ha movido siempre es fatal, porque si no la función que configuraba falta en silencio. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada de esquema y sale sin abrir un socket — la forma que quiere un Job de migración, desde la misma imagen y el mismo bundle que el servidor que viene después. Un valor vacío cuenta como *sin definir*, así que un `${SOMETHING}` sin sustituir en un archivo de compose no puede convertir un despliegue corriente en uno que migra y se niega a servir. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` deja que una máquina — un agente, un job de CI — *aplique* un cambio de esquema a través de `/api/admin/schema`, no solo planificarlo. Desactivado salvo que se pida: la credencial que haría ese cambio es la que más probablemente esté en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto puede ejecutarse una función propia antes de que se aborte su petición. El mismo mando que la opción `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no gestionado termine el proceso en lugar de registrarlo. Actívalo bajo un orquestador que te reinicie; desactívalo donde un reinicio sea peor que una fuga. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene el planificador de cron en marcha en una plataforma que el runtime detectaría como scale-to-zero, donde un temporizador que dispara en una instancia inactiva no dispara en ninguna instancia. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies hay delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente en `X-Forwarded-For`. Valor por defecto seguro `0`: sin proxy, fiarse de la cabecera dejaría que cualquier llamante falsificase una identidad. | `0` |

:::note[El aprovisionamiento en el arranque es aditivo, y no es una herramienta de migración]
La pasada de arranque corre desatendida, sin nadie leyendo un diff, así que nunca
eliminará una columna, estrechará un tipo ni reescribirá una tabla. Por eso
también la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula
un diff y hará un `DROP COLUMN` sin dudarlo, y el reinicio de un contenedor nunca
debe poder destruir una columna de producción como efecto colateral de una
reprogramación.

Los cambios destructivos o que reforman se quedan donde pueden revisarse:
`rebase db generate` + `rebase db migrate`, o `rebase db push` desde un checkout
o desde CI, que ensaya el cambio, rechaza los destructivos sin confirmación y
puede hacer antes una copia de seguridad.
:::

### Despliegues partidos

Una imagen y un bundle pueden arrancarse varias veces, sirviendo cada una una
parte distinta del proyecto. Una línea para cada variable aquí, porque esta
página afirma listarlas todas; qué *monta y posee* cada combinación — y qué
combinaciones se niegan a arrancar — está en
**[Procesos partidos](/docs/deployment/split-processes)**.

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Anula si *este* proceso ejecuta los temporizadores de cron. Sin definir sigue al rol. | — |
| `REBASE_JOB_WORKERS` | Anula si este proceso ejecuta workers de la cola de trabajos. Sin definir sigue al rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve en este proceso solo las funciones propias nombradas. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones propias excepto las nombradas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | A dónde reenvía el proceso de API una petición de función que no sirve él mismo. | — |

### Copias de seguridad

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expresión cron para las copias programadas. Sin definir significa que están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Borra las copias de más de N días. Sin definir o `0` lo conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N de las copias más recientes, diga lo que diga la retención. | — |
| `PG_DUMP_PATH` | Anula el binario `pg_dump` — debe coincidir con la versión mayor del servidor. | — |
| `PG_RESTORE_PATH` | Anula el binario `pg_restore`. | — |

Las copias de seguridad contienen secretos y datos personales. Usa un destino
privado con cifrado en reposo.
| `PG_DUMPALL_PATH` | Dónde vive `pg_dumpall`, cuando no está en el `PATH`. Sin él — y sin las herramientas cliente de PostgreSQL instaladas — una copia de los globals falla con un error que nombra esta variable. | — |

### Entrega del bundle

Un despliegue gestionado no lleva su código en la imagen: el runtime descarga un
bundle en el arranque. Estas variables deciden cuál y cómo.

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Lo que define `rebase start` en local. | — |
| `REBASE_BUNDLE_URL` | De dónde descargar el archivo del bundle, cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial bearer para esa descarga. Trátala como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe ser escribible y sobrevivir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime ofrece al bundle, más allá de los que declara ella misma. | — |

### Vínculos de recursos

Cada base de datos, bucket y topic que un proyecto declara en
`config/resources.ts` se vincula mediante variables de entorno con su nombre. Los
nombres base están abajo; un recurso que no es el predeterminado añade `__` y su
clave en mayúsculas, así que un bucket llamado `media` lee `S3_BUCKET__MEDIA`.
`rebase status` <span class="since-badge" data-since="0.18">Since 0.18</span>
imprime, por recurso, la variable exacta que está leyendo y si está definida.

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `REBASE_DRIVER` | El paquete npm que implementa el driver de una fuente de datos, cuando no es el de Postgres por defecto. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión de un topic declarado. Con sufijo por topic. | — |

### El entorno propio de la CLI

Lo lee `rebase`, no el servidor. Nada de aquí afecta a un despliegue.

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `REBASE_BASE_URL` | El backend con el que hablan `rebase auth` y `rebase api-keys`, en lugar de derivarlo del proyecto. | — |
| `REBASE_PORT` | El puerto que esos comandos asumen al derivar esa URL. | — |
| `SERVICE_KEY` | La clave de servicio con la que se autentican, en lugar de preguntar. | — |
| `REBASE_ENV_FILE_PATH` | Qué `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_CLOUD_URL` | El plano de control con el que habla `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de preguntar. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un almacén de secretos pueda entregarla sin que llegue al historial del shell. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y el detalle de la petición en lugar del mensaje corto. Lo primero que hay que definir cuando un comando `rebase cloud` falla sin ayudar. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` no arranca ninguna base de datos ni aprovisiona nada — la traes tú. Igual que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que `rebase dev` deriva si no de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto espera `rebase dev` a que el backend se anuncie antes de decir que no ha arrancado. `0` desactiva el informe. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` mete en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convención común entre herramientas. Ponla a cualquier cosa que no sea `0` y la CLI no envía telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específico de Rebase. No necesita ningún archivo, que es por lo que es la indicada en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | A dónde se envía la telemetría, para un colector autoalojado. | — |

## Secretos en desarrollo

`JWT_SECRET` y `REBASE_SERVICE_KEY` son obligatorios en producción y se generan
por ti fuera de ella, así que puedes empezar sin configurar nada.

Esos valores generados se cachean en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url` y gitignorados con ellos. Antes se
regeneraban en cada arranque — así que reiniciar el servidor de desarrollo te
cerraba la sesión de tu propia app e invalidaba cualquier clave de API que
acabaras de crear.

- Define cualquiera de las dos variables explícitamente y se usa la tuya; no se
  cachea ni se lee nada.
- Apunta la caché a otro sitio con `REBASE_DEV_SECRETS_FILE` — una ruta, y la
  única variable de esta sección que definirías a propósito.
- Borra el archivo para rotar ambos secretos. El siguiente arranque escribe uno
  nuevo.
- Si el archivo no se puede escribir — un contenedor de solo lectura, por
  ejemplo — el servidor arranca igualmente con un secreto efímero, exactamente
  como antes.

No se cachea nada en producción, ni bajo un ejecutor de tests. En producción un
arranque que haya tenido que generar cualquiera de los dos secretos sigue
fallando, nombrando la variable, y eso no ha cambiado:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objeto de Configuración del Backend

El `RebaseBackendConfig` pasado a `initializeRebaseBackend()` proporciona control programático:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

### Cambiar `basePath`

`basePath` mueve todas las rutas de la API, así que hay que decirle lo mismo al
cliente — de lo contrario sigue pidiendo `/api/...` y recibe un 404 en todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración lo toma del cliente que se le da; no hay nada más que
configurar. Si construyes una URL de petición a mano, únela a partir del cliente
en lugar de escribir `/api` tú mismo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Resolución de problemas

### Permiso denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el Editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, aunque la vista de hoja de cálculo del CMS carga los datos sin problema.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del Editor SQL cambiando temporalmente de rol de base de datos para que coincida con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si usas autenticación propia donde los roles existen solo en tablas de la base de datos y no como roles reales de PostgreSQL, el cambio de rol falla o faltan privilegios. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión y se salta esto.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de tu backend. Eso obliga a Rebase a ejecutar las consultas del Editor SQL con los privilegios del propietario de la conexión (normalmente un superusuario/propietario).

### Fallo al obtener el esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no carga el árbol de esquema, o el Editor SQL lanza `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necesita privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si `adminConnectionString` no se pasa al bootstrapper, o `getAdmin()` se sobrescribe para devolver `undefined`, esas operaciones fallan.
* **Solución:** Asegúrate de que `adminConnectionString` está configurado al inicializar el bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Visión General del Backend](/docs/backend)** — Referencia completa de la configuración del backend
