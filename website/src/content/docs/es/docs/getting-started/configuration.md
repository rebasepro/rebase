---
sourceHash: dae0d9a7e36f01c4
title: Entorno y Configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos de Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor requerido o está mal formado (una URL que no es una URL, un puerto que
> no es un número), el servidor rechaza el arranque e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime —`rebase dev`, `rebase start`, la imagen publicada— utiliza el
> esquema del que el runtime es propietario (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas mostradas a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que invoca `loadEnv({ extend })`, y puede añadir allí sus
> propias variables tipadas.

### Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo** — sin definir, `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos bajo `.rebase/`. Requerido en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Usa una cadena aleatoria segura (mínimo 32 caracteres). **Requerido en producción** (se autogenera en desarrollo). | `a1b2c3d4e5...` |

> **En una base de datos gestionada, `sslmode=require` puede no significar lo que parece.**
>
> Para `psql` y cualquier herramienta libpq, `require` significa "cifrado, certificado no
> comprobado". El controlador de Node sobre el que se ejecuta Rebase lo interpreta como `verify-full`, por lo que una
> base de datos cuyo certificado no haya sido firmado por una autoridad pública —común en Postgres
> gestionado— rechaza el runtime con el mensaje `self-signed certificate`, mientras que `psql`
> se conecta con la misma URL. El runtime y los comandos `rebase db` se detienen con un
> mensaje que advierte sobre esto.
>
> Elige una opción:
>
> - **`sslmode=no-verify`** — cifrado, no comprobado: lo que `require` significa para
>   libpq. Es una variante propia de node-postgres de la que libpq carece, por lo que `psql`, `pg_dump`
>   y Atlas la rechazan con `invalid sslmode value: "no-verify"`. Los comandos propios de Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la envían como
>   `sslmode=require`, funcionando correctamente con la URL configurada; para
>   usar `psql` manualmente, cámbialo por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — comprobado contra el
>   certificado de la CA del proveedor. Idéntico para cualquier herramienta.
>
> `uselibpqcompat=true&sslmode=require`, que es lo que sugiere la advertencia del propio controlador
> de Node, también funciona en el runtime; los comandos de Rebase eliminan `uselibpqcompat`
> antes de pasar la URL a las herramientas libpq, que de lo contrario lo rechazarían.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Configura esto solo en desarrollo** — consulta más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID de Google OAuth. Habilita "Iniciar sesión con Google". | — |

> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API reside en el propio origen de la página y el cliente la resuelve así automáticamente.
>
> Incrustar una URL absoluta en un bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma app: un dominio personalizado carga entonces la página desde
> `example.com` y llama a la API en `example.rebase.website`, lo cual es
> cross-origin, haciendo que cada petición falle en el preflight. Permitir el origen en CORS
> **no** lo soluciona — la cookie de actualización (refresh cookie) es `SameSite=Lax` y no se
> envía cross-site, por lo que eliminarías los errores de consola pero la
> autenticación seguiría rota. Al dejarlo sin definir, cualquier dominio que apunte a la app funciona sin
> necesidad de configurar CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de cargar dicho archivo — y, de lo contrario, se enlaza a un puerto derivado de la ruta del proyecto, permitiendo ejecutar varios proyectos a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner inicial muestra el puerto utilizado. | `3001` |
| `LOG_LEVEL` | Verbosidad de los logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL tras una línea `Failed query: [redacted]`. Cada sentencia que falla se oculta por defecto, ya que una consulta fallida incluye sus parámetros vinculados (un correo electrónico, un hash de contraseña). Establécelo en `true` mientras diagnosticas fallos de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Requerido en producción** a menos que `FRONTEND_URL` esté configurado: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *añade a* localhost — consulta más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos con nivel de administrador (usada para introspección de esquemas y operaciones administrativas). La base de datos que indica no es la que la consola SQL considera actual, ni la que copia una nueva rama por defecto: ambas corresponden a la base de datos en la que está la propia conexión de la app (consulta `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de rol de PostgreSQL en el SQL Editor (útil para autenticación personalizada donde los roles de la BD no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas desde ella por defecto, de modo que el panel de Ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, además de lo que indique `CORS_ORIGINS` (o `FRONTEND_URL`)**;
es la misma lista que usa producción, sumando localhost en lugar de
sustituirlo. De este modo, la variable funciona igual en ambos entornos, y los
casos que la requieren en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté en la lista será rechazado, y el rechazo se
registrará en el log **una vez por origen** junto con la línea exacta requerida para permitirlo. Rechazarlo
no es una precaución arbitraria: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría a cualquier sitio web que visite el desarrollador realizar
peticiones autenticadas contra el servidor de desarrollo con su sesión y leer las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (requerido en producción, autogenerado en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), permitiendo que cualquier entidad con el JWKS verifique una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el PEM completo en base64. Sin esto, los tokens se mantienen en HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo cada vez que la clave cambie: la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización (refresh token). Es deslizante —cada rotación lo renueva, por lo que determina cuánto sobrevive una sesión ante la **inactividad**. Establece `400d` para sesiones que deban persistir tras largas ausencias; los navegadores limitan la cookie de actualización a ese valor. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar este valor —una tabla de usuarios vacía debe admitir a alguien, y ese alguien pasa a ser el administrador. En producción (`NODE_ENV=production`) ese margen se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se define con `REBASE_ADMIN_EMAIL` más abajo o se asigna con la clave de servicio. El `.env.example` del scaffold lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de apagado (kill switch). Cierra el margen de inicialización del primer usuario que `ALLOW_REGISTRATION=false` deja abierto deliberadamente fuera de producción, impidiendo el registro incluso con una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de crear su primer usuario autenticado. Cada artefacto de despliegue entregado lo activa. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada al arrancar **mientras la tabla de usuarios aún esté vacía** y nunca después. Así es como un despliegue en producción obtiene a su administrador: el operador define la primera cuenta en lugar de exponerla al registro público. El arranque emite una advertencia si la tabla está vacía en producción y esto no se ha definido. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para dicha cuenta. Debe tener al menos 12 caracteres, o de lo contrario será rechazada y la cuenta no se creará. Cámbiala tras iniciar sesión por primera vez. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque muestra una advertencia; por tanto, rotar `JWT_SECRET` cerraría la sesión de todos *e* imposibilitaría descifrar cualquier autenticador registrado. Configura una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave que se está reemplazando durante una rotación. Configura ambas durante la rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, evitando que los usuarios queden bloqueados en sus cuentas a mitad del proceso. Elimínala una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional (opt-in), y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establécelo en `false` para una superficie de lectura totalmente pública; RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por email. Solo para emisores autenticados; nunca devuelve el email, roles o metadatos del usuario encontrado. Desactivado por defecto: constituye una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es solo para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` en la cookie de actualización. Seguro por defecto; `AUTH_COOKIE_SECURE=false` para http plano —un despliegue en una dirección LAN donde el navegador de lo contrario descartaría la cookie y la sesión moriría al expirar el token de acceso sin mostrar error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID de GitLab OAuth. El `baseUrl` de una instancia autohospedada no se configura por variables de entorno —configura GitLab en el bloque `auth` para ello. | — |
| `GITLAB_CLIENT_SECRET` | Client secret de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple, para inicio de sesión web. Es público y se expone en `GET /auth/config`. Apple no utiliza un client secret estático, ya que Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por ello, Apple requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de este valor o `APPLE_BUNDLE_IDS`, y no configurará nada sin ellos. | — |
| `APPLE_BUNDLE_IDS` | IDs de bundle separados por comas de las apps nativas de iOS/macOS cuyos códigos de Sign in with Apple son aceptados. | — |
| `APPLE_TEAM_ID` | Team ID de Apple Developer, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan secuencias de escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API estática de administrador. Omite la autenticación JWT habitual para llamadas servidor a servidor al pasarse como `Authorization: Bearer <key>`. (Autogenerada en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de hosting (PEM, EC P-256) contra la cual se verifican los tokens de plataforma `rpt_`; pueden ser varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene datos secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite al control de acceso de administración aceptar un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto con el que debe coincidir el `aud` de un token de plataforma, de modo que un token emitido para otro proyecto sea rechazado. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Adónde dirige el botón **Continue with Rebase Cloud** del panel de administración: la página del proyecto en la consola de la plataforma, que autentica a los propietarios del proyecto y regresa. La plataforma lo define al desplegar junto con las dos variables anteriores; con ellas, `POST /api/auth/platform-signin` acepta el token de un minuto `auth:admin-signin` de la plataforma y abre una sesión de administrador. Sin esto, el acceso sigue funcionando desde la opción **Open CMS** de la consola, y la pantalla de inicio de sesión simplemente lo explica. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa (rate limit), para las rutas de autenticación y para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede determinar su propio número de réplicas, por lo que un despliegue con pares debe indicarlo: tres réplicas con el valor por defecto impondrán el triple del límite. Cualquier otro valor **provoca un fallo al arrancar** en lugar de degradarse, incluyendo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de enlace de inicio de sesión sin contraseña. Requiere un servicio de email configurado, o el enlace no tendrá destino. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña mediante un código de seis dígitos enviado por correo. Mismo requisito de email que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de enlace mágico o código por email para una dirección desconocida crea la cuenta si el registro está abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamiento cuando un refresh token se reutiliza fuera de su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (cerrar la sesión). Cualquier otro valor detiene el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite el inicio de sesión con contraseña hasta verificar la dirección. Requiere servicio de email; de lo contrario, el arranque falla. | `false` |
| `CAPTCHA_PROVIDER` | Habilita la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token enviado por el navegador. Requerido una vez definido `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación a proteger separadas por comas (por ejemplo `register,login`). Si no se define, protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las tablas están protegidas por Postgres RLS. El almacenamiento de objetos no tiene un equivalente —las
claves comparten un único espacio de nombres plano—, por lo que con un bucket configurado y sin un modelo de acceso,
el servidor **rechazará el arranque en producción**. Debe satisfacerse con exactamente una de las siguientes opciones:
un hook `storageAuthorize` exportado desde `backend/storage.ts` (lo que incluye el scaffold
por defecto), `STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3`, `gcs` o `platform` (archivos bajo un prefijo perteneciente a la plataforma de alojamiento, transferidos mediante URLs que su agente de almacenamiento firma; definido por la plataforma). En producción, `local` desactiva el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true`. | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se resuelve desde el directorio en el que se ejecuta el servidor: la raíz del proyecto en `rebase dev`, `backend/` en un servidor generado con `rebase eject`. | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción —solo admisible con un volumen persistente que aloje `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de los buckets locales nombrados adyacentes a él. | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales la URL de descarga de un archivo privado es válida (el token que `getSignedUrl()` inserta en ella). Máximo `604800` (una semana). | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo aceptado por la fuente, en bytes, en cada ruta de subida — `__<KEY>` para una fuente con nombre. Un valor que no sea un número entero de bytes provocará un fallo en el arranque. | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Access key de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Secret key de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta (path-style) para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio (service account). Omitir en GCP si Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Servir todos los objetos públicamente, sin token. Solo para un bucket que actúe genuinamente como una CDN pública. Es una de las formas de satisfacer la validación de arranque mencionada arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar cualquier objeto. Nombrado `INSECURE` en el objeto de configuración por una razón: solo es justificable en una app de un solo inquilino (single-tenant) donde se confíe a cada cuenta el acceso a la totalidad de los archivos. | `false` |
| `STORAGE_POLICIES` | Reglas de acceso al almacenamiento en formato JSON: `[{ "path", "operations"?, "allow" }]`, donde `allow` puede ser `"public"`, `"authenticated"`, `"owner"` o `{ "roles": [...] }`. Denegado por defecto, y satisface la validación de arranque. Una lista inválida detendrá el arranque. Consulta [Autorización de almacenamiento](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | El broker de almacenamiento de la plataforma, para `STORAGE_TYPE=platform`. Configurado por la plataforma que ejecuta el broker. | — |
| `STORAGE_BROKER_PROJECT` | El ID de proyecto al que el broker asigna los archivos de este despliegue, para `STORAGE_TYPE=platform`. Configurado por la plataforma. | — |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las representaciones de imágenes generadas (redimensionados, conversiones de formato) en lugar de producirlas por petición. | `false` |

### Correo electrónico (Opcional)

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
| `EMAIL_LOGO_URL` | Logotipo mostrado en la cabecera de las plantillas de correo por defecto. Archivo PNG o JPG absoluto `http(s)` —los clientes de correo eliminan SVG y bloquean URIs `data:`. Sin definir, una app aún llamada `Rebase` mostrará el isotipo de Rebase y una con otro nombre no mostrará ninguno |
| `MAGIC_LINK_URL` | Destino al que apunta el enlace mágico enviado por correo. A una URL base se le añade `/auth/magic-link?token=…`; una URL que contenga `{token}` representa el enlace completo, para un frontend que no sirva `/auth/magic-link`. Envuélvelo entre comillas en `.env`, donde un `#` sin comillas inicia un comentario: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valor con un hash o una ruta de archivo sin `{token}` generará una advertencia al arrancar. Sin definir, la base es `FRONTEND_URL` |

### Pool de conexiones a la base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pooler). [Realtime](/docs/backend/realtime) requiere una: `LISTEN`/`NOTIFY` no funciona a través de un pooler en modo transacción como PgBouncer, y sin ella las notificaciones de cambio se deshabilitan con una advertencia en lugar de perderse en silencio. El [procesador de trabajos (job worker)](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Completa el valor `directConnectionString` del adaptador de Postgres cuando no está configurado. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando apunta a otro servidor, las lecturas autenticadas (listados, filas individuales, recuentos, agregaciones) se sirven allí bajo la misma seguridad a nivel de fila; las escrituras, inicio de sesión, tiempo real, crons, trabajos, la consola SQL y `rebase.sql` permanecen en el primario. Un lector que acaba de escribir leerá del primario durante `REBASE_READ_STICKY_MS`, y todos lo harán mientras la réplica tenga un retraso superior a `REBASE_READ_MAX_LAG_MS` o falle. Completa el valor `readConnectionString` del adaptador de Postgres cuando no está configurado; hasta la versión 0.28 inclusive, el pool de la réplica se abría pero nunca se leía de él. | — |
| `REBASE_READ_STICKY_MS` | Tras una escritura, cuánto tiempo se dirigen las lecturas del mismo usuario al primario, asegurando que un guardado seguido de un listado refleje los cambios guardados. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso de réplica a partir del cual todas las lecturas se redirigen al primario. | `1000` |
| `DATABASE_POOLED` | `true` cuando `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. En tal caso, el pool no envía `search_path` ni `statement_timeout` al conectarse (el pooler los rechazaría o descartaría) y define ambos en cada transacción; el arranque asigna al rol de base de datos un `search_path` por defecto de `public` para sentencias fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser obligatorio, y el tiempo real, la reactivación del job worker, la creación de índices, el branching y la consola SQL lo utilizarán. La URL de la réplica también se asume con pooler. Usa `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Límite máximo para todos los pools del proceso, aplicado sin importar lo solicitado por cada uno. Solo dígitos simples: un valor mal formado se ignora en lugar de serializar silenciosamente las peticiones al servidor. | — |

### Comportamiento en tiempo de ejecución

Leído por el runtime —`rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho eject gestiona estas decisiones directamente en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule) programada, que reporta tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye una copia, y sin el paquete el arranque fallará, señalándolo por su nombre. `false` mantiene el escaneo desactivado en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | El rol de Postgres con el que se ejecutan las peticiones autenticadas y anónimas. Asigna a cada proyecto en un clúster compartido el suyo propio. Una base de datos registra el rol con el que opera, y un arranque configurado para otro se negará a iniciar hasta que `rebase db request-role migrate` lo migre. Consulta [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de petición y permite que la conexión cambie a él; `never` deja ambos pasos bajo tu control y solo los verifica. | `auto` |
| `REBASE_RLS_GRANTS` | Qué permisos otorga Rebase al rol de petición: `schema` (todas las tablas en los esquemas que sirve, más privilegios por defecto), `managed` (solo las tablas que sirve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al rol o roles de petición, de modo que otros roles que lean las mismas tablas no obtengan nada de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` escribe las políticas que solo el contexto del servidor o un administrador pueden superar `TO public`, y ejecuta a los administradores como el rol de petición. Por defecto son `TO rebase_admin`, permitiendo que las lecturas acotadas al propietario de los usuarios autenticados utilicen el índice de propietarios. Consulta [Peticiones de administrador y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política base de servidor o administrador de todas las tablas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` también establece `request.jwt.claims` y `request.jwt.claim.*`, de modo que las políticas escritas con `auth.uid()` reconozcan al emisor. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Acción a tomar al arrancar cuando otro inicio de sesión puede cambiar al rol de petición: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. El cliente debe configurarse en consecuencia —consulta [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir los recursos estáticos/de administración del bundle desde este proceso. Desactívalo cuando haya una CDN delante. | `true` |
| `REBASE_STUDIO` | Sirve el panel de administración integrado en `/_studio` cuando su bundle estático esté disponible: las tablas de un proyecto como colecciones, sus usuarios y roles, y el Studio. Es el medio con el que se administra un proyecto sin código. Establece `false` para desactivarlo. | `true` |
| `REBASE_STUDIO_DIR` | Directorio que contiene el panel de administración precompilado servido en `/_studio`. Por defecto es `/studio` en la imagen del contenedor. | `/studio` |
| `REBASE_HISTORY` | Registrar el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas comprimidas con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` habilita las [notificaciones push](/docs/backend/push-notifications/): las rutas `/api/push`, la tabla `rebase.push_subscriptions` y `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | El par de claves VAPID con el que se firman los mensajes push. Fuera de producción, se genera un par y se almacena en `.rebase-dev-secrets.json` si no están definidos; en producción, las notificaciones push permanecen desactivadas sin ellos. | — |
| `REBASE_VAPID_SUBJECT` | Una dirección `mailto:` o URL `https://` con la que los servicios de push puedan contactar. Por defecto toma el origen de un `REBASE_PUBLIC_URL` con `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la petición, **en bytes** (`10485760`, no `10MB` —un valor que no sea un número provocará un fallo de arranque en lugar de eliminar silenciosamente el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. De tres estados. Sin definir, en cualquier entorno: `/api/docs` se sirve a los emisores a quienes `GET /api/schema/tables` describe tablas, cada uno con el documento de las tablas que le corresponden, y no hay interfaz de Swagger UI. `true` publica el documento completo para todos, con la **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento restringido al acceso de administrador. | — |
| `REBASE_DEPLOYMENT_ID` | El despliegue que ejecuta este proceso, según lo nombra la plataforma; indicado en la línea que notifica que el runtime está a la escucha. Rebase Cloud lo define. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, de modo que los navegadores rechacen HTTP plano en cada subdominio del host durante seis meses —incluidos hosts no servidos por este proceso. Actívalo solo si todos los subdominios funcionan exclusivamente bajo HTTPS. Cualquier valor distinto de `true`/`false` detendrá el arranque. Consulta [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Dejarlo sin definir deja el endpoint accesible a cualquiera que pueda alcanzar el puerto —aceptable en una red privada, no en una pública, y los logs de arranque advertirán sobre ello. | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacer el runtime con el esquema de tablas al arrancar. `ensure` (el valor por defecto en todos lados, producción incluida) ejecuta el pase **aditivo**: crea tablas, columnas y tipos enum faltantes, sin eliminar ni reescribir ninguno. `none` no modifica el esquema de las tablas declaradas, aunque las tablas propias del framework (autenticación, API keys, trabajos, cron) se siguen creando y manteniendo al día; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen publicada solo acepta estas dos opciones y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe configurarse en `none` o fallará al arrancar. | `ensure` |
| `REBASE_PROVISION` | `false` hace que el runtime no altere nada en la base de datos: ninguna tabla, columna, índice, función, trigger, política, rol o permiso, ni al arrancar ni después, incluidos los del framework. En su lugar, reporta por nombre los elementos faltantes. Pensado para bases de datos que solo tu proceso de cambios tiene permitido modificar. Consulta [Cuando solo tu proceso de cambios puede alterar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Impide el arranque cuando la base de datos fue aprovisionada por última vez a partir de un conjunto de tablas diferente del utilizado para construir este proceso. Si no está definido (o cualquier valor distinto de `true`/`1`), emite una advertencia en su lugar. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Impide el arranque cuando un archivo de función o de cron lanza un error o no se puede analizar al importarlo, indicando el nombre de cada archivo y la causa, de modo que un despliegue progresivo (rolling deploy) mantenga la versión anterior en servicio. Un reinicio también se somete a esta condición. Si no está definido (o cualquier valor distinto de `true`), omite el archivo y sirve el resto. Un archivo que se importa limpiamente y no exporta ninguna función o trabajo siempre se omite, sin rechazar el arranque. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos (CDC): `auto` (lee cambios del WAL si la base de datos lo permite; si no, usa triggers; en última instancia, recurre al nivel de aplicación, registrando cada degradación como info), `trigger` (fuerza triggers, advierte si es imposible), `wal` (lee cambios del write-ahead log en lugar de triggers; requiere `wal_level=logical` y un rol con permisos de replicación; de lo contrario, recurre a `trigger`), `off`. Consulta [Tiempo real](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora si se proporcionó un transporte ya instanciado en `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un único socket en tiempo real; las subsiguientes se rechazan con `TOO_MANY_SUBSCRIPTIONS`. Debe ser un número entero positivo —cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulta [Tiempo real](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cuántos sockets en tiempo real puede mantener abiertos un único usuario, o una clave de API, en una instancia de servidor. Los sockets de suplantación de identidad de un administrador computan contra el administrador. El siguiente intento de conexión se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK seguirá reintentando, logrando conectar cuando otro socket se cierre. Debe ser un número entero positivo —cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tiempo máximo que un cambio espera antes de la reconsulta (refetch) que lo entrega a los suscriptores activos, en ms. Una reconsulta espera 300 ms sin cambios, y como máximo este intervalo bajo un flujo constante de escrituras. Debe ser un número entero positivo —cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tiempo durante el cual el total de una suscripción a una lista grande puede reutilizarse antes de recalcularse, en ms; los frames que lo reutilizan incluyen `meta.totalAsOf`. Si no está definido, cada frame realiza el recuento. Prevalece sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | El último recuento total más pequeño al que aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada frame. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback bajo `NODE_ENV=production`. Desactivado por defecto, para que un arranque en producción falle de forma visible en lugar de intentar conectar a una base de datos inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta el pase de esquema y finaliza sin abrir ningún socket —el comportamiento que requiere un Job de migración, a partir de la misma imagen y el mismo bundle que el servidor que le sigue. También crea las tablas que un proceso en servicio generaría en su primer uso, y no inicia ningún cron ni cola de trabajos. Un valor vacío equivale a *no definido*, de modo que una variable `${SOMETHING}` no sustituida en un archivo compose no transforme un despliegue normal en uno que solo migra y no sirve tráfico. Se rechaza si se combina con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Ruta a un archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribe en él todos los cambios de esquema realizados, en orden, como un script SQL para su revisión y aplicación mediante `psql`. Las filas insertadas no se incluyen. Se rechaza en un proceso que sirve tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina —un agente, un job de CI— *aplique* un cambio de esquema a través de `/api/admin/schema`, y no solo que lo planifique. Desactivado a menos que se solicite explícitamente: las credenciales para realizar dicha modificación suelen ser las más expuestas en variables de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo que una función personalizada puede ejecutarse antes de que su petición sea abortada. Mismo ajuste que la opción `functionsTimeoutMs`. `0` lo desactiva. Una función que declare el suyo propio (`defineFunction(…, { timeoutMs })`) utilizará ese valor en su lugar. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | El tiempo de espera máximo que una función puede declarar para sí misma con `defineFunction(…, { timeoutMs })`, en ms; si solicita más, se le asigna este límite. Debe ser un número positivo; cualquier otro valor se interpreta como no definido. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado finalice el proceso en lugar de limitarse a registrarlo en los logs. Recomendado bajo un orquestador que reinicie el contenedor; desactivar si un reinicio es más perjudicial que una fuga. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en plataformas que el runtime detecta con escalado a cero, donde un temporizador activado en una instancia inactiva no se ejecutaría en ninguna. No modifica nada más: actívalo si mantienes al menos una instancia activa continuamente. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies preceden a este servidor, permitiendo al limitador de tasa obtener la dirección IP real del cliente a partir de `X-Forwarded-For`. Valor por defecto a prueba de fallos `0`: sin proxies, confiar en la cabecera permitiría a cualquier cliente falsificar su identidad. | `0` |

:::note[El aprovisionamiento al arrancar es aditivo y no es una herramienta de migración]
El pase de arranque se ejecuta de forma desatendida y sin supervisión humana de las diferencias (diff), por lo que nunca eliminará
una columna, reducirá un tipo ni reescribirá una tabla. Es por ello también que la imagen rechaza
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y ejecutaría
`DROP COLUMN` libremente, y el reinicio de un contenedor jamás debe ser capaz de destruir una
columna de producción como efecto secundario de una reprogramación.

Los cambios destructivos o de reestructuración deben realizarse donde puedan revisarse: `rebase db
generate` + `rebase db migrate`, o `rebase db push` desde un repositorio local o CI,
lo cual prueba el cambio en seco, rechaza acciones destructivas sin confirmación y
permite generar una copia de seguridad previa.
:::

### Despliegues divididos

Una misma imagen y un mismo bundle pueden ejecutarse varias veces en paralelo, sirviendo cada instancia
una parte distinta del proyecto. Se incluye una sola línea para cada variable aquí, ya que esta página busca
listar todas las variables; el detalle de qué *monta y administra* cada combinación —y qué
combinaciones impiden el arranque— se encuentra en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir, se rige según el rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta workers de la cola de trabajos. Sin definir, se rige según el rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Servir solo las funciones personalizadas nombradas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir todas las funciones personalizadas excepto las especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al que el proceso de la API redirige una petición de función que no sirve él mismo. En un `worker`, adonde se envían sus propias llamadas a `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Un endpoint opcional para el Model Context Protocol en `/mcp`, permitiendo a un cliente de IA leer
y escribir en este proyecto **en nombre del usuario autenticado**. Desactivado salvo que se configure explícitamente y —a
diferencia de otras superficies— ningún `REBASE_ROLE` lo activa automáticamente: los roles describen la
forma de un proceso, mientras que este endpoint representa la decisión de confiar credenciales a un software de
terceros, debiendo ser una decisión tomada por una persona en lugar de ser heredada del
propósito asignado a un contenedor.

`rebase dev` establece `REBASE_MCP_ENABLED=true` para el backend que inicia, a menos que
la shell o el archivo `.env` ya contengan una línea al respecto, y dicho backend asigna su propio
`http://localhost:<port>` como la URL pública cuando `REBASE_PUBLIC_URL` no está definida.
Ningún otro comando hace esto: un proceso en producción requiere ambas variables.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie declina montarse y lo notifica en el log de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente para este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede inferirlo: obtener el origen desde la cabecera `Host` convertiría la identidad del emisor y la audiencia con la que se comprueban sus propios tokens en un valor suministrado por el cliente. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista de MCP App propia del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), servida a Claude en lugar de la vista genérica para que renderice tus vistas, campos y acciones personalizadas. Sin ella, el backend busca junto al frontend que sirve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse por sí mismo. Configúralo en `false` para requerir que los clientes se registren con antelación. | `true` |

### Edición de esquemas en vivo desde un bundle

Desactivada a menos que se defina `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado carece del
código fuente en `backend/schema` para editar, por lo que con estas variables configuradas el editor de esquemas lee
el código fuente desde el repositorio, sube un commit con cada cambio y ejecuta su DDL en
esta base de datos. Solo para administradores, y aplicado por una persona a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Indicar un repositorio sin
credenciales válidas impedirá el arranque. Consulta
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub en el que confirmar los cambios de esquema, en formato `propietario/nombre`. Definirlo es lo que habilita la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se aplicará el commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Ubicación de `backend/schema` en dicho repositorio, relativa a la raíz del repositorio. Una ruta que apunte fuera del repositorio rechazará el arranque, al igual que la obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token de acceso con permisos específicos (fine-grained token) con permisos de lectura y escritura sobre el contenido del repositorio. Configura este token o las tres variables `_GITHUB_APP_*`, pero no ambos métodos a la vez. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de una GitHub App, para hacer commits en representación de la app en lugar de usar un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | La instalación de la app en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clave privada de la app: PEM, PEM con saltos de línea escapados o base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir significa que los backups automáticos están desactivados. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requerido junto con `BACKUP_SCHEDULE`, que no se ejecutará sin él. `rebase db backup` usa por defecto `./backups` en la ubicación donde se ejecutó. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días de antigüedad. Sin definir o `0` conserva todas. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N de las copias de seguridad más recientes, sin importar el tiempo de retención. | — |
| `PG_DUMP_PATH` | Sobrescribe la ruta al binario `pg_dump` —debe coincidir con la versión mayor del servidor o ser más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe la ruta al binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe la ruta al binario `psql` que ejecuta `rebase db restore --clean` para realizar la restauración en una sola transacción. | — |
| `PG_DUMPALL_PATH` | Ubicación de `pg_dumpall`, si no se encuentra en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas— una copia de seguridad de variables globales fallará indicando esta variable. | — |

La imagen de runtime oficial (`rebasepro/server`) incluye las herramientas de cliente
de PostgreSQL 18, por lo que una copia de seguridad programada puede ejecutarse en ella contra cualquier servidor hasta Postgres 18.
Fuera de dicha imagen, debes instalarlas manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos y datos confidenciales (PII). Utiliza un destino privado con
cifrado en reposo.

### Entrega de bundles

Un despliegue gestionado no incluye su código en la imagen: el runtime descarga un
bundle al arrancar. Estas variables determinan cuál y de qué forma.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Es lo que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | Ubicación desde donde descargar el archivo del bundle, cuando no haya uno local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para dicha descarga. Trátala como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae el bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen de runtime suministra al bundle, más allá de los que este declara por sí mismo. | — |

### Vinculaciones de recursos

Cada base de datos, bucket y topic que un proyecto declara en `backend/resources.ts` se
vincula mediante variables de entorno nombradas a partir de él. Los nombres base se detallan a continuación; un
recurso secundario añade `__` y su clave en mayúsculas, de modo que un bucket llamado
`media` leerá `S3_BUCKET__MEDIA`. `rebase status`
imprime, para cada recurso,
la variable exacta que está leyendo y si está definida.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | Paquete npm que implementa el controlador de una fuente de datos cuando no es el predeterminado de Postgres. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Cadena de conexión para un topic declarado. Con sufijo por cada topic. | — |

### El entorno propio de la CLI

Leído por `rebase`, no por el servidor. Ninguno de estos valores afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | Destino al que `rebase api-keys`, `rebase storage` y `rebase auth reset-password` envían la clave de servicio, en la shell o en `.env`. Defínelo cuando el servidor se ejecute de otra forma que no sea mediante `rebase dev` en este proyecto: `rebase start`, un contenedor u otro host. Sin definir, emplean el servidor registrado por `rebase dev` mientras esté en ejecución, y no envían nada si no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican dichos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Denominación anterior para dicha clave. Si está definida en `.env`, `rebase api-keys` y `rebase storage` la leerán en sustitución de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Archivo `.env` que la CLI lee y escribe, cuando no es el del propio proyecto. | — |
| `REBASE_ROOT_RULES` | `0` evita que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` en la raíz del repositorio, útil si mantienes manualmente los archivos de agentes. | on |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla interactivamente. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, permitiendo que un gestor de secretos la proporcione sin que quede expuesta en el historial de la shell. | — |
| `REBASE_TOKEN` | Token obtenido con `rebase cloud tokens create`. Al definirse, todos los comandos de `rebase cloud` se autentican con él en lugar de la sesión de `rebase cloud login`, sin leer ni escribir la sesión guardada. En un directorio vinculado con `rebase cloud init --claim`, se aparta en favor del token propio de dicho proyecto si este carece de permisos sobre él. Es la forma adecuada de ejecutar `rebase cloud` en CI —consulta [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI que invocan sus herramientas en la nube, y nunca lo envía a la app: usa `REBASE_API_TOKEN` para eso. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y el detalle de la petición en lugar del mensaje breve. Lo primero que se debe activar cuando un comando de `rebase cloud` falla de manera poco descriptiva. | — |
| `REBASE_ATLAS_DEV_URL` | La base de datos vacía contra la que planifican `rebase db push`, `db generate` y `db migrate`, en lugar de la base de datos `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no creará ni eliminará una base de datos nombrada aquí, y rechazará una idéntica a `DATABASE_URL`. En la base de datos de desarrollo gestionada, la CLI la configura en un PGlite en memoria efímero propio. Úsala cuando no se disponga del permiso `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada —tú proporcionas la tuya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que de lo contrario `rebase dev` deduce de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tiempo que `rebase dev` espera a que el backend anuncie su disponibilidad antes de notificar que no ha iniciado. `0` deshabilita el reporte. | `30000` |
| `DATABASE_PASSWORD` | Contraseña que `rebase dev --docker` asigna en la cadena de conexión generada a partir de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convención estándar entre herramientas. Al configurarse con cualquier valor distinto de `0`, la CLI no envía telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No necesita un archivo, por lo que es la opción ideal para entornos de CI y dentro de imágenes de contenedor. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destino al que se envía la telemetría, para un recolector autohospedado. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` impide que la CLI consulte al registro de npm (o `npm_config_registry`), una vez al día en segundo plano, por los dist-tags de `@rebasepro/cli`, y oculta la línea "Rebase X is out; this CLI is Y" con la que finalizan en stderr todos los comandos excepto `rebase upgrade`. La respuesta se guarda en `~/.rebase/release-check.json`, y la petición no envía ningún otro dato. Ya se desactiva en CI; `NO_UPDATE_NOTIFIER` produce el mismo efecto. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Definido por la CLI para los procesos que inicia, garantizando que un comando que invoque nuevamente la CLI solo imprima una vez el aviso de nueva versión disponible. Si lo defines manualmente, ocultarás el aviso en dicho proceso, tal como hace `REBASE_NO_UPDATE_CHECK`. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY` se
generan automáticamente fuera de producción para que puedas empezar sin configurar nada.

Estos valores autogenerados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y están incluidos en el `.gitignore`. Anteriormente,
se regeneraban en cada inicio, provocando que reiniciar el servidor de desarrollo cerrara la sesión en
tu propia aplicación e invalidara cualquier clave de API recién creada.

- Si defines alguna de las dos variables explícitamente, se usará tu valor; nada se guardará ni leerá de la caché.
- Puedes cambiar la ubicación de la caché con `REBASE_DEV_SECRETS_FILE` —una ruta, y la
  única variable de esta sección que configurarías deliberadamente.
- Elimina el archivo para rotar ambos secretos. El siguiente arranque generará uno nuevo.
- Si no es posible escribir en el archivo —por ejemplo, en un contenedor de solo lectura—, el servidor iniciará
  de todos modos con un secreto efímero, tal como funcionaba antes.

Nada se guarda en caché en producción ni bajo un ejecutor de pruebas. En producción tampoco
se genera ningún valor: un arranque sin `JWT_SECRET` fallará indicando el nombre de la variable,
manteniéndose este comportamiento intacto:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de configuración del backend

El objeto `RebaseBackendConfig` suministrado a `initializeRebaseBackend()` proporciona control programático:

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
sin `app`, `server` ni `basePath` y con un valor obligatorio para `provision`, construyen un
backend que no sirve nada hasta que lo montes manualmente: `createRebaseBackend`. Consulta
[Integración en servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

`basePath` traslada todas las rutas de la API, por lo que el cliente debe configurarse en consonancia;
de lo contrario, seguirá solicitando `/api/...` y obtendrá respuestas 404 en todas las peticiones:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma este valor del cliente que se le suministre; no es necesario
configurar nada más. Si construyes una URL de petición manualmente, concaténala desde el cliente en lugar
de escribir `/api` en el código:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el SQL Editor (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, aunque la vista tipo hoja de cálculo del CMS cargue los datos sin problemas.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del SQL Editor cambiando temporalmente los roles de base de datos para que coincidan con el rol de la aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas autenticación personalizada donde los roles solo existen en tablas de la base de datos y no como roles reales de PostgreSQL, el cambio de rol falla o faltan privilegios en la base de datos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión predeterminado y omite esta restricción.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de tu backend. Esto obliga a Rebase a ejecutar las consultas del SQL Editor utilizando los privilegios del propietario de la conexión (generalmente un superusuario/owner). El SQL Editor indicará entonces, sobre los resultados, que se leyeron como el propietario de la conexión y deshabilitará su selector de roles.

### Fallo al obtener el esquema en el SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol de esquemas, o el SQL Editor lanza el error `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos de administración. Si no se proporciona `adminConnectionString` al bootstrapper, o se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
* **Solución:** Asegúrate de configurar `adminConnectionString` durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
