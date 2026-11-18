---
sourceHash: 69431837d4a9e199
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en el archivo `.env` ubicado en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime — `rebase dev`, `rebase start`, la imagen publicada — utiliza el
> esquema que posee el runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas mostradas abajo. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede añadir allí sus propias
> variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL. **Opcional en desarrollo** — si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utiliza una cadena aleatoria segura (mínimo 32 caracteres). **Obligatoria en producción** (se genera automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **En una base de datos administrada, `sslmode=require` puede no significar lo que parece.**
>
> Para `psql` y cualquier herramienta de libpq, `require` significa "cifrado, certificado no
> verificado". El controlador de Node sobre el que se ejecuta Rebase lo interpreta como `verify-full`, por lo que una
> base de datos cuyo certificado no fue firmado por una autoridad pública —algo común en Postgres
> administrado— rechaza el runtime con el error `self-signed certificate`, mientras que `psql`
> se conecta con la misma URL. El runtime y los comandos `rebase db` se detienen mostrando un
> mensaje que lo advierte.
>
> Elige una opción:
>
> - **`sslmode=no-verify`** — cifrado, no verificado: lo que `require` significa para
>   libpq. Es una sintaxis propia de node-postgres de la que libpq carece, por lo que `psql`, `pg_dump`
>   y Atlas la rechazan con `invalid sslmode value: "no-verify"`. Los comandos propios de Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la envían como
>   `sslmode=require`, funcionando correctamente con la URL configurada; para
>   usar `psql` manualmente, cámbialo por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra el
>   certificado CA del proveedor. Idéntico para todas las herramientas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido por la propia advertencia del controlador de Node,
> también funciona para el runtime; los comandos de Rebase eliminan `uselibpqcompat`
> antes de pasar la URL a las herramientas de libpq, las cuales la rechazan.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Definir solo en desarrollo** — ver más abajo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API comparte el mismo origen que la página y el cliente la resuelve de esa forma automáticamente.
>
> Incrustar una URL absoluta en un bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado cargaría la página desde
> `example.com` e invocaría la API en `example.rebase.website`, lo cual genera una petición
> cross-origin y hace que fallen los preflights. Permitir el origen en CORS
> **tampoco** lo soluciona: la cookie de actualización tiene `SameSite=Lax` y no se envía
> entre sitios (cross-site), por lo que eliminarías los errores de consola pero la
> autenticación seguiría rota. Al dejarla sin definir, cualquier dominio que apunte a la aplicación funciona
> sin necesidad de configurar CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — un `PORT` en `.env` no se lee allí, ya que el puerto se resuelve antes de cargar dicho archivo — y de lo contrario asigna un puerto derivado de la ruta del proyecto, permitiendo que varios proyectos se ejecuten a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica cuál se utilizó. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de los logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia fallida se oculta por defecto, ya que una consulta fallida incluye sus parámetros asociados (un correo electrónico, un hash de contraseña). Establécelo en `true` para diagnosticar fallos de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** a menos que se defina `FRONTEND_URL`: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *añade* a localhost — ver más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se usa como alternativa a CORS_ORIGINS, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos a nivel de administrador (usada para introspección del esquema y operaciones administrativas). La base de datos que designa no es la que la consola SQL considera actual, ni la que copia una nueva rama por defecto: ambas corresponden a la base de datos en la que está la conexión propia de la aplicación (ver `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desactiva el cambio de roles de PostgreSQL en el Editor SQL (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará su selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor configurado con ella mantiene el registro de ramas en esa base de datos y copia nuevas ramas desde allí por defecto, de modo que el panel de Ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, además de lo que defina `CORS_ORIGINS` (o `FRONTEND_URL`)**
—la misma lista utilizada en producción, con localhost añadido en lugar de
sustituido. De esta forma, la variable funciona igual en ambos entornos, cubriendo
los casos habituales que la requieren en desarrollo:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Cualquier origen que no sea localhost ni esté listado será rechazado, y el rechazo se
registrará en el log **una sola vez por origen** con la línea exacta necesaria para permitirlo. Rechazarlo
no es una precaución innecesaria: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría a cualquier sitio web visitado por el desarrollador realizar
peticiones autenticadas contra el servidor de desarrollo utilizando su sesión y leer las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `JWT_SECRET` | Clave secreta para la firma de JWT (obligatoria en producción, generada automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso asimétricamente (RS256), permitiendo que cualquier entidad con el JWKS verifique una sesión sin poder generarla. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el PEM completo en base64. Sin ella, los tokens permanecen en HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo cada vez que la clave se actualice: la rotación depende de poder diferenciar la clave antigua de la nueva. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización (refresh token). Es deslizante —cada rotación lo renueva, determinando cuánto tiempo sobrevive una sesión ante la **inactividad**. Configura `400d` para sesiones que deban tolerar una ausencia prolongada; los navegadores limitan la cookie de actualización a ese plazo. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar el valor de esta variable —una tabla de usuarios vacía debe admitir a alguien, y esa persona se convierte en administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto se considera normal, y el administrador debe indicarse mediante `REBASE_ADMIN_EMAIL` o asignarse con la clave de servicio. El archivo `.env.example` inicial la establece en `true`; por defecto en el framework está desactivada. | `false` |
| `DISABLE_SELF_REGISTRATION` | Mecanismo de corte. Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja deliberadamente abierta fuera de producción, impidiendo el registro incluso contra una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL`, o el despliegue no tendrá forma de generar su primer usuario autenticado. Todos los artefactos de despliegue distribuidos lo incluyen activado. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada durante el arranque **mientras la tabla de usuarios siga vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador define la primera cuenta en lugar de exponerla públicamente. El arranque advertirá si la tabla está vacía en producción y esta variable no está definida. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para dicha cuenta. Debe contener al menos 12 caracteres; de lo contrario, se rechazará y la cuenta no se creará. Cámbiala tras iniciar sesión por primera vez. | — |
| `MFA_ENCRYPTION_KEY` | Cifra todos los secretos TOTP almacenados. Si no se define, los secretos se cifrarán con `JWT_SECRET` y el arranque emitirá una advertencia: rotar `JWT_SECRET` cerrará la sesión de todos los usuarios *y* hará que cualquier autenticador registrado sea indescifrable. Establece una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre en MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave que se está reemplazando durante una rotación. Define ambas durante una rotación: los nuevos secretos se guardarán con `MFA_ENCRYPTION_KEY` y los existentes seguirán siendo legibles, evitando que los usuarios queden bloqueados a mitad del proceso. Elimínala una vez que todos los secretos se hayan vuelto a cifrar. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Requiere activación explícita y no está limitado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establécelo en `false` para permitir lectura totalmente pública (RLS se sigue aplicando). | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resuelve un correo en un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para usuarios autenticados; nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto al ser una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es exclusivo para frontends verdaderamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Activado por defecto; usa `AUTH_COOKIE_SECURE=false` para http simple —un despliegue en una dirección LAN donde de otro modo el navegador descartaría la cookie y la sesión moriría sin error al expirar el token de acceso. Emite una advertencia al arrancar. `http://localhost` no lo requiere. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID de Google OAuth (validación en backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret de Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID de GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client secret de GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID de Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret de Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID de LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret de LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID de Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret de Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID de X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client secret de X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID de Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client secret de Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID de GitLab OAuth. Para la `baseUrl` de una instancia autohospedada no hay variable de entorno — configúrala directamente en el bloque `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple, para inicio de sesión web. Es público y se expone en `GET /auth/config`. Apple no utiliza un client secret estático, ya que Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por tanto, Apple requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de este valor o `APPLE_BUNDLE_IDS`; sin ellos no se configura nada. | — |
| `APPLE_BUNDLE_IDS` | Identificadores de bundle separados por comas de las apps nativas iOS/macOS cuyos códigos de Sign in with Apple son aceptados. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se admiten escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API estática de administrador. Omite la autenticación JWT habitual para llamadas servidor a servidor al enviarse como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante la rotación de claves. La plataforma la define en el despliegue y no contiene ningún secreto. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que el filtro de administrador acepte un token de plataforma para `cron:read` y nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto con el que debe coincidir el `aud` del token de plataforma, evitando que se acepte un token emitido para otro proyecto. Si solo se define una de las dos variables, el servidor arrancará, registrará una advertencia y responderá a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde se almacenan los contadores de limitación de tasa (rate limiting), tanto para rutas de auth como para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no conoce su propio recuento de réplicas, por lo que un despliegue con réplicas debe indicarlo —tres réplicas con el valor por defecto permitirán el triple del límite. Cualquier otro valor **impedirá el arranque** en lugar de usar un fallback, incluyendo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de acceso sin contraseña por enlace (magic link). Requiere configurar un servicio de correo electrónico para poder enviarlo. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el acceso sin contraseña con un código de seis dígitos enviado por correo. Mismo requisito de correo que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de magic link o código OTP para una dirección desconocida creará la cuenta, siempre que el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamiento cuando un refresh token se reutiliza fuera de su ventana de reutilización permitida: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar la sesión). Cualquier otro valor impedirá el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: impide iniciar sesión con contraseña hasta verificar la dirección de correo. Requiere servicio de correo; el arranque fallará si no está configurado. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | Clave secreta del proveedor, utilizada en el backend para verificar el token que envía el navegador. Obligatoria si se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas que se desean proteger (por ejemplo `register,login`). Si no se define, protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las tablas están protegidas mediante Postgres RLS. El almacenamiento de objetos no tiene un equivalente —las claves comparten un único espacio de nombres plano—, por lo que con un bucket configurado y sin un modelo de acceso, el servidor **se negará a arrancar en producción**. Resuélvelo usando exactamente una de las siguientes opciones: un hook `storageAuthorize` exportado desde `backend/storage.ts` (incluido por defecto en el scaffold), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` desactiva el almacenamiento salvo que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que corre el servidor: la raíz del proyecto bajo `rebase dev`, o `backend/` en un servidor generado tras `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción — solo mediante un volumen duradero que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de buckets locales asignados junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos de validez de la URL de descarga de un archivo privado —el token que `getSignedUrl()` genera en ella. Máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo aceptado, en bytes, para todas las rutas de subida — `__<KEY>` para una fuente específica. Si no es un número entero de bytes, fallará el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Fuerza URLs de estilo de ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio. Omitir en GCP, donde Workload Identity suministra las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve todos los objetos de forma pública, sin token. Solo para un bucket que actúe realmente como un CDN público. Una de las tres vías para satisfacer la validación de arranque descrita arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar cualquier objeto. Nombrado `INSECURE` en el objeto de configuración por un motivo: solo es admisible en aplicaciones de un único inquilino (single-tenant) donde todas las cuentas tienen acceso total a todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las variantes de imagen generadas (redimensionados, conversiones de formato) en lugar de procesarlas en cada solicitud. | `false` |

### Correo electrónico (Opcional)
<span class="since-badge" data-since="0.34">Desde 0.34</span> `MAGIC_LINK_URL`.

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre visible en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de los correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo por defecto. Debe ser una URL absoluta `http(s)` hacia un PNG o JPG (los clientes de correo eliminan SVG y bloquean URIs `data:`). Si no se define, una app que conserve el nombre `Rebase` usará su logo, y si se le cambia el nombre no mostrará ninguno |
| `MAGIC_LINK_URL` | Destino del magic link enviado por correo. A una ruta base se le añadirá `/auth/magic-link?token=…`; si contiene `{token}`, conformará el enlace entero para frontends que no utilicen `/auth/magic-link`. Envuélvelo entre comillas en el archivo `.env`, ya que un `#` sin entrecomillar iniciará un comentario: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Se emitirá una advertencia al arrancar si el valor incluye un hash o ruta de archivo sin `{token}`. Si no se define, tomará `FRONTEND_URL` como base |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos de inactividad antes de cerrar una conexión | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pooler). [Realtime](/docs/backend/realtime) requiere una: las sentencias `LISTEN`/`NOTIFY` no funcionan a través de un pooler a nivel de transacción como PgBouncer, y sin ella las notificaciones de cambios se desactivan con una advertencia en lugar de perderse en silencio. El [job worker](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Rellena el valor `directConnectionString` del adaptador Postgres cuando este no esté definido. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Si apunta a otro servidor, las lecturas autenticadas (listados, filas individuales, recuentos, agregados) se servirán desde allí bajo la misma seguridad a nivel de fila; las escrituras, inicios de sesión, realtime, tareas programadas (crons), jobs, la consola SQL y `rebase.sql` permanecerán en el primario. Un lector que acabe de escribir leerá del primario durante `REBASE_READ_STICKY_MS`, y todos lo harán mientras la réplica tenga un retraso superior a `REBASE_READ_MAX_LAG_MS` o falle. Rellena `readConnectionString` en el adaptador Postgres si no está definido; hasta la versión 0.28 incluida, el pool de la réplica se abría pero nunca se leía. | — |
| `REBASE_READ_STICKY_MS` | Tiempo que las lecturas del mismo usuario se dirigen al primario tras una escritura, asegurando que un guardado seguido de una consulta muestre los cambios. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso máximo de la réplica tras el cual todas las lecturas se redirigen al primario. | `1000` |
| `DATABASE_POOLED` | `true` si `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. En tal caso, el pool no envía `search_path` ni `statement_timeout` al conectarse (el pooler los rechazaría o descartaría) y los define dentro de cada transacción; el arranque asigna al rol de la base de datos un `search_path` predeterminado de `public` para sentencias ejecutadas fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser obligatoria, siendo utilizada por realtime, la reactivación de los workers, creación de índices, ramificación y la consola SQL. La URL de la réplica también se asume con pooling. Usa `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Límite máximo para cada pool en el proceso, aplicado independientemente de lo configurado por cada uno. Solo dígitos: un valor incorrecto se ignorará en lugar de serializar el servidor silenciosamente. | — |

### Comportamiento en tiempo de ejecución

Leído por el runtime — `rebase dev`, `rebase start` y la imagen oficial
del servidor. Un proyecto que ha hecho eject gestiona estas decisiones desde su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría de row-level-security](/docs/rls-check#running-it-on-a-schedule) programada, reportando tablas servidas sin políticas activas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye una copia, y sin dicho paquete el arranque fallará indicándolo. `false` mantiene deshabilitado el escaneo en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | El rol de Postgres con el que se ejecutan las solicitudes autenticadas y anónimas. Asigna uno propio a cada proyecto si compartes un cluster. La base de datos registra el rol con el que se ejecuta; un arranque configurado para otro rol se negará a iniciar hasta que se ejecute `rebase db request-role migrate`. Consulta [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de petición y permite que la conexión cambie a él; `never` delega ambas tareas en ti y solo se encarga de verificarlas. | `auto` |
| `REBASE_RLS_GRANTS` | Qué permisos otorga Rebase al rol de petición: `schema` (todas las tablas en los esquemas que sirve, más privilegios por defecto), `managed` (solo las tablas que sirve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al rol (o roles) de petición, impidiendo que otros roles que lean las mismas tablas obtengan acceso a través de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` aplica las políticas que solo el contexto del servidor o un administrador pueden superar `TO public`, y ejecuta a los administradores bajo el rol de petición. Por defecto son `TO rebase_admin`, permitiendo que las lecturas de los usuarios autenticados acotadas por propietario utilicen el índice correspondiente. Ver [Peticiones de administrador y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política base de servidor-o-administrador de todas las tablas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` también define `request.jwt.claims` y `request.jwt.claim.*`, de modo que las políticas escritas con `auth.uid()` reconozcan al emisor. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamiento durante el arranque si otro login puede cambiar al rol de petición: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. Debe coincidir con la configuración del cliente —ver [Modificar `basePath`](#modificar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los activos estáticos y de administración del bundle desde este proceso. Desactívalo si hay una CDN intermediaria. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compresión de respuestas mediante gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` habilita las [notificaciones push](/docs/backend/push-notifications/): las rutas `/api/push`, la tabla `rebase.push_subscriptions` y `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Par de claves VAPID con las que se firman los mensajes push. Fuera de producción se genera un par y se guarda en `.rebase-dev-secrets.json` si no se especifican; en producción, las notificaciones push permanecerán desactivadas sin ellas. | — |
| `REBASE_VAPID_SUBJECT` | Dirección `mailto:` o URL `https://` de contacto para los servicios push. Por defecto toma el origen de una URL HTTPS en `REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la petición, **en bytes** (`10485760`, no `10MB`; un valor que no sea numérico impedirá el arranque en lugar de eliminar el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI. Tres estados posibles. Sin definir (en cualquier entorno): `/api/docs` se sirve a los clientes a los que `GET /api/schema/tables` describe tablas, mostrando a cada uno la documentación de las tablas autorizadas, sin interfaz Swagger. `true` publica el documento completo para todos, con la interfaz **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento restringido tras el acceso de administrador. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, haciendo que los navegadores rechacen HTTP plano en todos los subdominios del host durante seis meses (incluyendo hosts no servidos por este proceso). Actívalo únicamente si todos los subdominios del dominio funcionan exclusivamente con HTTPS. Cualquier valor distinto de `true`/`false` impedirá el arranque. Ver [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer para proteger `/metrics`. Sin definir deja el endpoint accesible para cualquiera que alcance el puerto —adecuado para redes privadas, pero no en públicas; los logs de arranque advertirán sobre esto. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operaciones que el runtime puede realizar sobre el esquema de las tablas al arrancar. `ensure` (por defecto en todos los entornos, incluido producción) realiza la comprobación **aditiva**: crea tablas, columnas y tipos enum faltantes, sin eliminar ni reescribir nada. `none` deja intacto el esquema de las tablas declaradas, aunque las tablas propias del framework (auth, api keys, jobs, cron) se crearán y mantendrán actualizadas; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen publicada solo admite estas dos opciones y **se negará a iniciar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso debe aprovisionar, por lo que los demás roles deben configurarse en `none` o rechazarán el arranque. | `ensure` |
| `REBASE_PROVISION` | `false` impide que el runtime modifique nada en la base de datos: ni tablas, columnas, índices, funciones, triggers, políticas, roles o permisos, tanto al inicio como después, incluyendo los propios del framework. En su lugar, notificará por nombre los elementos que falten. Diseñado para bases de datos donde solo los procesos de migración tienen permisos de cambio. Consulta [Cuando solo tu proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo admite `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Impide el arranque si la base de datos se aprovisionó por última vez a partir de un conjunto de tablas diferente al usado para compilar este proceso. Sin definir (o cualquier valor distinto de `true`/`1`) mostrará una advertencia. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Impide el arranque si un archivo de funciones o cron arroja un error o no puede parsearse al importarse, indicando el archivo y el motivo, garantizando que un despliegue progresivo (rolling deploy) mantenga la versión anterior activa. También se aplica durante reinicios. Sin definir (o cualquier valor distinto de `true`) omitirá el archivo y servirá el resto. Un archivo que se importe sin errores pero no exporte ninguna función o job siempre se omitirá, sin impedir el arranque. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (lee cambios desde el WAL si la base de datos lo permite; si no, usa triggers; si no es posible, recurre al nivel de aplicación, registrando cada fallback como info), `trigger` (fuerza triggers, advierte si no es posible), `wal` (lee cambios desde el write-ahead log en vez de triggers; requiere `wal_level=logical` y un rol con permisos de replicación, recurre a `trigger` en caso contrario), `off`. Ver [Realtime](/docs/backend/realtime-cdc/). Tiene prioridad sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora si `realtime.bus` recibió un transporte configurado explícitamente. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Límite de suscripciones por socket de realtime; las solicitudes adicionales se rechazan con `TOO_MANY_SUBSCRIPTIONS`. Debe ser un entero positivo —cualquier otro valor detendrá el servidor al iniciar. Tiene prioridad sobre `realtime.maxSubscriptionsPerSocket`. Consulta [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Límite de sockets de realtime abiertos para un mismo usuario o API key en una instancia de servidor. Los sockets de suplantación de identidad abiertos por un administrador computan para este. La siguiente conexión será rechazada con `TOO_MANY_SOCKETS` y el socket se cerrará (4002); el SDK seguirá reintentando hasta que otro socket se cierre. Debe ser un entero positivo —cualquier otro valor detendrá el servidor al iniciar. Tiene prioridad sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tiempo máximo en ms que un cambio espera antes de realizar la reconsulta (refetch) que lo entrega a los suscriptores activos. Espera 300 ms si no hay cambios, y como máximo este límite bajo un flujo constante de escrituras. Debe ser un número entero positivo —cualquier otro valor detiene el inicio. Tiene prioridad sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tiempo en ms durante el cual se puede reutilizar el total de una suscripción a listas grandes antes de recalcularlo; los frames que lo reutilizan incluyen `meta.totalAsOf`. Sin definir, recalcula en cada frame. Tiene prioridad sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | Cantidad mínima de filas previas requerida para que aplique `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se recalculan en cada frame. Tiene prioridad sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de tipo `localhost`/loopback bajo `NODE_ENV=production`. Desactivada por defecto para que un arranque en producción falle de forma explícita en lugar de intentar conectar a una base de datos inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la fase de validación del esquema y finaliza sin abrir ningún socket —el comportamiento requerido por un Job de migración, usando la misma imagen y el mismo bundle que el servidor posterior. También crea las tablas que un proceso en servicio generaría en su primer uso, y no inicia crons ni colas de jobs. Un valor vacío equivale a *no definido*, evitando que un `${VARIABLE}` sin sustituir en un docker-compose convierta un despliegue normal en uno que solo migra y rechaza servir peticiones. Incompatible con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribirá en él todas las modificaciones de esquema realizadas, en orden, como un script SQL listo para revisar y aplicar mediante `psql`. Las filas insertadas no se incluyen. No está permitido en procesos que sirvan tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que un proceso automatizado (un agente, un job de CI) *aplique* modificaciones de esquema mediante `/api/admin/schema`, en lugar de solo planificarlas. Desactivado por defecto: las credenciales con permisos para realizar tales cambios suelen residir en variables de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo máximo de ejecución permitido para una función personalizada antes de abortar la petición. Mismo control que la opción `functionsTimeoutMs`. `0` desactiva el límite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado finalice el proceso en lugar de solo registrarlo. Recomendado bajo orquestadores que reinicien el contenedor; no recomendado si reiniciar resulta más perjudicial que una fuga puntual. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en plataformas detectadas por el runtime como de escalado a cero (scale-to-zero), donde un temporizador que se active en una instancia inactiva no se ejecutaría en ninguna. No modifica nada más: actívalo si mantienes al menos una instancia siempre activa. | — |
| `TRUSTED_PROXY_HOPS` | Cantidad de proxys intermedios situados frente a este servidor, permitiendo al rate limiter identificar la dirección IP real del cliente a partir de `X-Forwarded-For`. Por defecto es `0` por seguridad: sin un proxy, confiar en esta cabecera permitiría falsear identidades fácilmente. | `0` |

:::note[El aprovisionamiento al inicio es aditivo y no es una herramienta de migración]
La fase de inicio se ejecuta de forma desatendida y sin intervención humana en los diffs, por lo que nunca eliminará columnas, reducirá tipos ni reescribirá tablas. Por este motivo la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula diferencias y ejecutaría gustosamente sentencias `DROP COLUMN`, y el reinicio de un contenedor jamás debería destruir una columna en producción a causa de una reprogramación.

Los cambios destructivos o que modifiquen estructuras deben gestionarse donde puedan ser supervisados: `rebase db generate` + `rebase db migrate`, o `rebase db push` desde un entorno local o CI, que prueba los cambios en seco, rechaza los destructivos si no hay confirmación previa y permite realizar copias de seguridad antes de aplicar.
:::

### Despliegues divididos

Una misma imagen y bundle pueden iniciarse múltiples veces, atendiendo cada instancia una parte distinta del proyecto. A continuación se resumen brevemente sus variables; los detalles sobre qué *monta y gestiona* cada combinación —y cuáles combinaciones no están permitidas— se encuentran en **[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_ROLE` | Define qué componente atiende este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores cron. Sin definir, sigue la configuración del rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta workers de colas de jobs. Sin definir, sigue la configuración del rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve exclusivamente las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al cual el proceso API redirige las peticiones de funciones que no sirve por sí mismo. En un rol `worker`, indica hacia dónde se dirigen sus llamadas internas a `rebase.functions`. URL de tipo `http(s)`. | — |

### Superficie MCP

Endpoint opcional de Model Context Protocol en `/mcp`, permitiendo a un cliente de IA interactuar con el proyecto **actuando como el usuario autenticado**. Desactivado salvo configuración explícita y —a diferencia de otras funcionalidades— ningún valor de `REBASE_ROLE` lo activa automáticamente: los roles modelan la arquitectura del proceso, mientras que este endpoint delega credenciales a software de terceros, decisión que debe tomar una persona y no ser heredada por el rol del contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Habilita la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, no se montará y se registrará un aviso en el log de inicio. | `false` |
| `REBASE_PUBLIC_URL` | Origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede deducirlo: inferirlo de la cabecera `Host` permitiría que el emisor y la audiencia contra la que se validan sus tokens fuesen manipulados por el cliente. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista MCP App propia del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), provista a Claude en lugar de la vista genérica para renderizar vistas, campos y acciones personalizados. Sin ella, el backend la buscará junto al frontend que sirve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse de forma autónoma. Establécelo en `false` para requerir registro previo de clientes. | `true` |

### Edición de esquemas en vivo desde un bundle

Desactivado a menos que se defina `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado carece del código fuente en `backend/schema` para editar, por lo que con estas variables el editor leerá el código fuente desde el repositorio, confirmará (commit) cada cambio y ejecutará las sentencias DDL correspondientes en esta base de datos. Exclusivo para administradores y aplicado por personas a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Configurar un repositorio sin credenciales válidas impedirá el arranque. Ver [Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositorio de GitHub en el que confirmar cambios de esquema, en formato `owner/name`. Definirla activa la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Rama en la que se aplicarán los commits. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Ubicación de `backend/schema` dentro de dicho repositorio, relativa a la raíz. Rutas que apunten fuera del repositorio impedirán el arranque, al igual que la ya obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token granular (fine-grained) con permisos de lectura y escritura sobre el repositorio. Configura este token o las tres variables `_GITHUB_APP_*`, pero no ambas opciones. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de una GitHub App para realizar commits en nombre de la app en lugar de usar un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalación de la app en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clave privada de la app: formato PEM, PEM con saltos de línea escapados o base64. | — |

### Copias de seguridad

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir desactiva los backups automáticos. | — |
| `BACKUP_DESTINATION` | Ruta local, o URL de tipo `s3://bucket/prefix` / `gs://bucket/prefix`. Requerida junto con `BACKUP_SCHEDULE`, que no se ejecutará sin ella. `rebase db backup` recurre a `./backups` en el directorio de ejecución. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días de antigüedad. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre un mínimo de N copias recientes, sin importar el límite de retención por días. | — |
| `PG_DUMP_PATH` | Sobrescribe la ruta al binario `pg_dump` — debe coincidir con la versión mayor del servidor o ser superior. | — |
| `PG_RESTORE_PATH` | Sobrescribe la ruta al binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe el binario `psql` utilizado por `rebase db restore --clean` para realizar la restauración en una sola transacción. | — |
| `PG_DUMPALL_PATH` | Ubicación de `pg_dumpall` cuando no se encuentra en el `PATH`. Sin ella —y sin las herramientas de cliente de PostgreSQL instaladas— las copias globales fallarán mostrando un error que indicará esta variable. | — |

La imagen oficial del runtime (`rebasepro/server`) incluye las herramientas
de cliente de PostgreSQL 18, por lo que una copia de seguridad programada puede ejecutarse dentro de ella contra cualquier servidor hasta Postgres 18.
Fuera de la imagen oficial deberás instalarlas manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos e información de identificación personal (PII). Utiliza destinos privados con cifrado en reposo.

### Entrega de bundles

Los despliegues administrados no incluyen su código dentro de la imagen: el runtime descarga
el bundle durante el arranque. Las siguientes variables definen cuál y cómo se obtiene.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle previamente extraído. Valor asignado localmente por `rebase start`. | — |
| `REBASE_BUNDLE_URL` | Ubicación desde la cual descargar el archivo del bundle si no existe uno local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para autorizar dicha descarga. Debe tratarse como un secreto, ya que permite a un tenant descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directorio en el que se extrae el bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el inicio. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime pone a disposición del bundle, más allá de los declarados por el propio bundle. | — |

### Vinculaciones de recursos

Cada base de datos, bucket y topic declarado en `backend/resources.ts` se
vincula mediante variables de entorno nombradas a partir de dicho recurso. Los nombres base se detallan a continuación; un
recurso secundario añade `__` y su clave en mayúsculas (por ejemplo, un bucket llamado
`media` leerá `S3_BUCKET__MEDIA`). `rebase status` muestra, para cada recurso,
la variable exacta que está consultando y si está definida.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_DRIVER` | Paquete npm que implementa el controlador de una fuente de datos alternativa al driver por defecto de Postgres. Con sufijo por recurso: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### El entorno propio de la CLI

Variables leídas por el comando `rebase`, no por el servidor. Ninguna de ellas afecta al despliegue en ejecución.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Destino al que `rebase api-keys`, `rebase storage` y `rebase auth reset-password` envían la clave de servicio, ya sea en la shell o en `.env`. Defínela si el servidor se ejecuta de forma distinta a `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Si no se define, usarán el servidor registrado por `rebase dev` mientras esté activo, y no enviarán nada si no lo está. | — |
| `REBASE_SERVICE_KEY` | Clave de servicio con la que se autentican dichos comandos, leída desde `.env`: la misma que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Nombre anterior para dicha clave. Si está definida en `.env`, `rebase api-keys` y `rebase storage` la leerán en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Archivo `.env` específico que la CLI leerá y modificará, si difiere del estándar del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` evita que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` en la raíz del repositorio, útil si mantienes manualmente dichos archivos para agentes. | on |
| `REBASE_CLOUD_URL` | Plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Cuenta con la que `rebase cloud login` inicia sesión automáticamente sin solicitar credenciales. | — |
| `REBASE_CLOUD_PASSWORD` | Contraseña correspondiente, permitiendo que un gestor de secretos la suministre sin exponerla en el historial de la shell. | — |
| `REBASE_TOKEN` | Token creado con `rebase cloud tokens create`. Si se define, todos los comandos `rebase cloud` se autenticarán con él omitiendo la sesión de `rebase cloud login`, sin leer ni alterar la sesión guardada. En un directorio vinculado mediante `rebase cloud init --claim`, se sustituirá por el token del propio proyecto si carece de alcance sobre él. Es el método idóneo para ejecutar `rebase cloud` en CI —ver [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo transfiere a la CLI ejecutada por sus herramientas cloud, sin enviarlo nunca a la aplicación: usa `REBASE_API_TOKEN` para ese propósito. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la petición en lugar de un mensaje resumido. Esencial para diagnosticar fallos en comandos de `rebase cloud`. | — |
| `REBASE_ATLAS_DEV_URL` | Base de datos vacía utilizada por `rebase db push`, `db generate` y `db migrate` para calcular diferencias, en lugar de crear `<db>_dev_diff` junto a `DATABASE_URL`. Rebase no creará ni eliminará una base de datos indicada aquí, y rechazará una que coincida con `DATABASE_URL`. Con la base de datos de desarrollo administrada, la CLI genera automáticamente una instancia PGlite volátil en memoria. Utilízala cuando no dispongas de permisos `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada —deberás proveer una externamente. Equivale a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que de otro modo `rebase dev` deriva de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tiempo máximo que `rebase dev` espera a que el backend responda antes de reportar que no ha iniciado. `0` deshabilita esta comprobación. | `30000` |
| `DATABASE_PASSWORD` | Contraseña asignada por `rebase dev --docker` en la cadena de conexión generada a partir de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convención estándar multiplataforma. Cualquier valor distinto de `0` desactiva el envío de telemetría por parte de la CLI. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente anterior específico para Rebase. No requiere archivos locales, siendo la opción ideal para entornos CI o imágenes de contenedores. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destino al que se envía la telemetría, útil para servidores de recolección autohospedados. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY` se
generan automáticamente en entornos de desarrollo para permitir comenzar a trabajar sin configuración previa.

Los valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y están incluidos en el `.gitignore`. Anteriormente,
se regeneraban en cada inicio —lo que provocaba que reiniciar el servidor cerrara la sesión
en tu propia aplicación e invalidara cualquier clave de API recién creada.

- Si defines cualquiera de las variables de forma explícita, se usará tu valor; nada se guardará ni leerá de la caché.
- Puedes cambiar la ubicación de la caché con `REBASE_DEV_SECRETS_FILE` —una ruta de archivo, y la
  única variable de esta sección que configurarías deliberadamente.
- Elimina el archivo si deseas renovar ambos secretos. El próximo inicio generará uno nuevo.
- Si el archivo no puede escribirse —por ejemplo, en un contenedor de solo lectura—, el servidor
  iniciará igualmente utilizando un secreto efímero en memoria, tal como hacía anteriormente.

No se almacena nada en caché en producción ni bajo un ejecutador de tests. En producción tampoco
se genera ningún valor automáticamente: arrancar sin definir `JWT_SECRET` fallará indicando la variable faltante:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de configuración del backend

El objeto `RebaseBackendConfig` suministrado a `initializeRebaseBackend()` permite configurar el sistema mediante código:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    schemaDir: "./schema",     // The backend/schema directory: the tables, and what the schema editor writes
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

    enableSwagger: true,     // Publish the whole OpenAPI document at /api/docs to everyone

    logging: {
        level: "info"
    }
});
```

Las mismas opciones,
omitiendo `app`, `server` y `basePath` y requiriendo obligatoriamente `provision`, permiten construir un
backend que no sirve tráfico hasta que tú decidas montarlo: `createRebaseBackend`. Consulta
[Integración en servidores personalizados](/docs/backend/custom-server/).

### Modificar `basePath`

`basePath` traslada todas las rutas de la API, por lo que el cliente debe configurarse en consecuencia;
de lo contrario seguirá realizando peticiones a `/api/...` recibiendo respuestas 404 en todas:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma este valor automáticamente a partir del cliente proporcionado, sin requerir
ajustes adicionales. Si compones URLs de petición manualmente, constrúyelas a través del cliente en lugar
de escribir `/api` directamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el SQL Editor (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista en hoja de cálculo del CMS carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del SQL Editor cambiando temporalmente los roles de la base de datos para que coincidan con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas autenticación personalizada donde los roles solo existen en tablas y no como roles reales de PostgreSQL, el cambio de rol falla o no existen privilegios en la base de datos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión predeterminada, omitiendo este paso.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` en la configuración `.env` del backend. Esto fuerza a Rebase a ejecutar las consultas del SQL Editor utilizando los privilegios del propietario de la conexión (habitualmente un superusuario o propietario). Tras esto, el SQL Editor indicará sobre los resultados que fueron leídos con los permisos del propietario de la conexión y deshabilitará el selector de roles.

### Error al obtener el esquema en el SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol del esquema, o el SQL Editor arroja el error `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema y ejecutar comandos administrativos. Si no se suministra `adminConnectionString` al bootstrapper o `getAdmin()` se sobrescribe devolviendo `undefined`, estas operaciones no podrán realizarse.
* **Solución:** Asegúrate de que `adminConnectionString` esté configurado durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Pasos siguientes

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
