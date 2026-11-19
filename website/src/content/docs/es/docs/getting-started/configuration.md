---
sourceHash: 1aa92066ee4f7422
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
> La ubicación del esquema depende de cómo ejecute el backend. Un proyecto iniciado por
> el runtime (`rebase dev`, `rebase start`, la imagen publicada) utiliza el
> esquema del propio runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas mostradas a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que invoca `loadEnv({ extend })`, donde puede añadir sus propias
> variables tipadas.

### Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utilice una cadena aleatoria segura (mínimo 32 caracteres). **Obligatoria en producción** (se genera automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **En una base de datos administrada, `sslmode=require` puede no significar lo que parece.**
>
> Para `psql` y cualquier herramienta basada en libpq, `require` significa "cifrado, certificado no
> verificado". El controlador de Node sobre el que se ejecuta Rebase lo interpreta como `verify-full`, por lo que una
> base de datos cuyo certificado no esté firmado por una autoridad pública —algo habitual en Postgres
> administrado— rechaza el runtime con el error `self-signed certificate`, mientras que `psql`
> se conecta con la misma URL. El runtime y los comandos de `rebase db` se detendrán mostrando un
> mensaje que advierte de esto.
>
> Elija una opción:
>
> - **`sslmode=no-verify`**: cifrado, sin verificar: lo que `require` significa para
>   libpq. Es una sintaxis de node-postgres que no existe en libpq, por lo que `psql`, `pg_dump`
>   y Atlas la rechazarán con `invalid sslmode value: "no-verify"`. Los comandos propios de Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la envían como
>   `sslmode=require`, funcionando correctamente con la URL configurada; para ejecutar
>   `psql` manualmente, cámbielo a `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`**: verificado contra el
>   certificado de la CA del proveedor. Funciona igual para todas las herramientas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido por la advertencia del controlador de Node,
> también funciona para el runtime; los comandos de Rebase eliminan `uselibpqcompat`
> antes de pasar la URL a las herramientas de libpq, que de lo contrario lo rechazarían.

### Frontend

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Defina esto solo en desarrollo**; consulte los detalles más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID de Google OAuth. Habilita "Iniciar sesión con Google". | — |

> **Deje `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend residen en orígenes distintos, por lo que el servidor de
> desarrollo inyecta este valor. En producción, el backend de Rebase sirve la SPA, por lo que la
> API comparte el mismo origen que la página y el cliente la resuelve directamente de forma automática.
>
> Incluir una URL absoluta en un bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado cargaría la página desde
> `example.com` y llamaría a la API en `example.rebase.website`, lo cual es
> cross-origin y provocará que fallen las comprobaciones preflight. Permitir el origen en CORS
> **no** lo soluciona: la cookie de actualización tiene `SameSite=Lax` y no se
> envía cross-site, por lo que desaparecerían los errores de consola pero la
> autenticación seguiría rota. Dejándola sin definir, cualquier dominio que apunte a la aplicación funcionará
> sin necesidad de configurar CORS.

### Backend

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente desde el entorno del shell** (un `PORT` en `.env` no se tiene en cuenta, ya que el puerto se resuelve antes de cargar dicho archivo); de lo contrario, asigna un puerto derivado de la ruta del proyecto para permitir ejecutar varios a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el mensaje de inicio indica qué opción se utilizó. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL tras una línea `Failed query: [redacted]`. Cada sentencia que falla se oculta por defecto porque contiene parámetros enlazados (un correo electrónico, un hash de contraseña). Establézcalo en `true` para diagnosticar fallos en DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** salvo que se defina `FRONTEND_URL`: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *añade* a localhost; consulte los detalles más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos con privilegios de administrador (utilizada para introspección del esquema y operaciones administrativas). La base de datos especificada no es la que la consola SQL considera actual, ni la que una nueva rama copia por defecto: ambas corresponden a la base de datos de la conexión de la aplicación (consulte `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de rol de PostgreSQL en el SQL Editor (útil para autenticación personalizada donde los roles de BD no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron con el usuario propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Base de datos a partir de la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece al hacer checkout y [cambiar a una rama](/docs/backend/branching/#cli-integration). Un servidor configurado con ella mantiene el registro de ramas en dicha base de datos y copia nuevas ramas desde allí por defecto, haciendo que el panel de ramas de Studio muestre las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, más cualquier origen definido en `CORS_ORIGINS` (o `FRONTEND_URL`)**;
es la misma lista utilizada en producción, agregando localhost en lugar de reemplazarlo.
De este modo, la variable opera igual en ambos entornos, cubriendo los casos habituales en desarrollo:

```bash
# Un teléfono en la LAN, el equipo de un colega, un túnel ngrok,
# un puerto redirigido en Codespaces: cualquier origen distinto de localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Cualquier origen que no sea localhost ni esté incluido en la lista será rechazado, registrándose dicho rechazo
**una sola vez por origen** junto con la línea exacta necesaria para permitirlo. Esta restricción no es una
simple precaución: dado que la API envía credenciales, reflejar un encabezado `Origin` arbitrario
permitiría que cualquier sitio web visitado por el desarrollador hiciera peticiones autenticadas
contra el servidor de desarrollo usando su sesión y leyera las respuestas.

### Autenticación

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `JWT_SECRET` | Secreto para la firma de JWT (obligatorio en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada en formato PEM para firmar tokens de acceso asimétricamente (RS256), de modo que cualquier servicio con el JWKS pueda verificar una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el contenido completo en base64. Sin este valor, los tokens permanecen en HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en el encabezado del token y en el JWKS. Modifíquelo cada vez que cambie la clave; la rotación requiere poder distinguir entre la clave anterior y la nueva. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Es deslizante (cada rotación renueva el plazo), por lo que determina cuánto sobrevive una sesión ante la **inactividad**. Especifique `400d` para sesiones que deban persistir tras ausencias prolongadas; los navegadores limitan la cookie de actualización a ese periodo. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse sin importar este valor: una tabla de usuarios vacía debe admitir a alguien, y ese usuario se convierte en admin. En producción (`NODE_ENV=production`) ese acceso se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto pasa a ser una cuenta común, y el admin se define mediante `REBASE_ADMIN_EMAIL` o se asigna con la clave de servicio. El archivo `.env.example` de la plantilla lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de bloqueo total. Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja abierta deliberadamente fuera de producción, bloqueando el registro incluso en una base de datos vacía. Combínelo con `REBASE_ADMIN_EMAIL`, de lo contrario el despliegue no tendrá forma de crear su primer usuario autenticado. Cada artefacto de despliegue generado lo incluye activado. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada durante el arranque **mientras la tabla de usuarios esté vacía** y nunca después. Es el mecanismo para establecer un administrador en producción: el operador define la primera cuenta evitando accesos no autorizados. El arranque emitirá una advertencia si la tabla está vacía en producción y esta variable no está configurada. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para dicha cuenta. Debe contener al menos 12 caracteres; de lo contrario se rechazará y la cuenta no se creará. Modifíquela tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra todos los secretos TOTP almacenados. Si no se define, se cifran usando `JWT_SECRET` y el arranque emitirá una advertencia; rotar `JWT_SECRET` cerrará la sesión de todos los usuarios *y* hará que los autenticadores registrados sean indescifrables. Configure una clave exclusiva (más de 32 caracteres aleatorios) antes de que los usuarios comiencen a registrarse. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave anterior que se está reemplazando durante una rotación. Defina ambas durante el proceso: los nuevos secretos se guardarán con `MFA_ENCRYPTION_KEY` y los existentes seguirán siendo legibles, evitando que los usuarios pierdan el acceso a sus cuentas. Elimínela una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Requiere activación explícita y deliberadamente no depende de `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticación para la API de datos. Establézcalo en `false` para exponer una superficie de lectura completamente pública (las políticas RLS seguirán aplicando). | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita el endpoint `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación. Solo para clientes autenticados; nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto al ser una superficie susceptible de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` de la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo debe emplearse en frontends que sean auténticamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Activado por defecto; establezca `AUTH_COOKIE_SECURE=false` para HTTP plano (por ejemplo, en una dirección LAN donde el navegador descartaría la cookie y la sesión expiraría silenciosamente al vencer el token de acceso). Emite una advertencia en el arranque. `http://localhost` no lo requiere. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID de Google OAuth (validación en backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret de Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID de GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client Secret de GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID de Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client Secret de Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID de LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client Secret de LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID de Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client Secret de Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID de X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client Secret de X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID de Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client Secret de Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID de GitLab OAuth. Para una instancia autoalojada, configure GitLab en el bloque `auth`, ya que su `baseUrl` no se parametriza mediante variables de entorno. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple para inicio de sesión web. Es público y se expone en `GET /auth/config`. Apple no utiliza un client secret estático; Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por tanto, Apple requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de esta variable o `APPLE_BUNDLE_IDS`; sin ellas, el proveedor no se configurará. | — |
| `APPLE_BUNDLE_IDS` | Lista separada por comas de bundle IDs de aplicaciones nativas de iOS/macOS cuyos códigos de Sign in with Apple son aceptados. | — |
| `APPLE_TEAM_ID` | Team ID de Apple Developer, emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se admiten escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave estática de la API de administración. Omite la autenticación JWT estándar en llamadas entre servidores cuando se envía como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de hosting (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; admite varios bloques PEM durante la rotación de claves. La plataforma la define al desplegar y no contiene datos secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la barrera de administración admita tokens de plataforma para `cron:read`, y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | ID del proyecto con el que debe coincidir el claim `aud` de un token de plataforma para impedir el uso de tokens emitidos para otros proyectos. Si solo se define una de las dos variables, el servidor arrancará, registrará una advertencia y responderá a cualquier token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destino del botón **Continue with Rebase Cloud** en el panel de administración: la página del proyecto en la consola de la plataforma, que autentica a los propietarios del proyecto y los redirige de vuelta. La plataforma la define al desplegar junto con las dos anteriores; con ellas, `POST /api/auth/platform-signin` acepta el token de un minuto `auth:admin-signin` de la plataforma e inicia una sesión de administrador. Sin ella, el acceso sigue funcionando desde el botón **Open CMS** de la consola, y la pantalla de inicio de sesión simplemente lo explica. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde se guardan los contadores de límites de peticiones (rate limit), tanto para las rutas de autenticación como para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede inferir su propio número de réplicas, por lo que un despliegue distribuido debe declararlo explícitamente; de lo contrario, tres réplicas con la configuración predeterminada triplicarían el límite global permitido. Cualquier otro valor **impedirá el arranque** en lugar de degradar la configuración (incluido `postgres`). | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de inicio de sesión sin contraseña mediante enlace mágico. Requiere un servicio de correo electrónico configurado para poder enviar el enlace. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña mediante un código de seis dígitos enviado por correo. Aplica el mismo requisito de servicio de correo. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una petición de magic link o código de correo para una dirección desconocida crea la cuenta si el registro está abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamiento cuando un token de actualización se reutiliza fuera de su ventana de tolerancia: `reject` (rechazarlo, mantener la sesión activa) o `revoke-session` (cerrar la sesión). Cualquier otro valor impedirá el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: impide el inicio de sesión con contraseña hasta verificar la dirección. Requiere correo electrónico; el sistema rechazará el arranque si no está configurado. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación mediante captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir desactiva el captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token enviado por el navegador. Obligatorio si se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación a proteger, separadas por comas (por ejemplo `register,login`). Sin definir protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las tablas están protegidas por RLS en Postgres. El almacenamiento de objetos no tiene un equivalente nativo —las claves comparten un espacio de nombres plano—, por lo que si hay un bucket configurado sin un modelo de acceso definido, el servidor **se negará a arrancar en producción**. Cumpla este requisito mediante exactamente una de las siguientes opciones: un hook `storageAuthorize` exportado desde `backend/storage.ts` (incluido en la plantilla base), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` deshabilita el almacenamiento a menos que se defina `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Las rutas relativas se resuelven desde el directorio donde corre el servidor: la raíz del proyecto en `rebase dev`, o `backend/` en un servidor generado tras `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción: utilícelo únicamente con un volumen persistente montado en `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de buckets locales contiguos | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos de validez de la URL de descarga de un archivo privado (el token generado por `getSignedUrl()`). Máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo aceptado en bytes para cada ruta de subida (`__<KEY>` para un recurso específico). Un valor que no sea un número entero detendrá el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket de S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Access key de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Secret key de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs en estilo path-style para el bucket de S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio. Omítalo en GCP si Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Servir todos los objetos públicamente sin requerir token. Exclusivo para buckets que operen verdaderamente como un CDN público. Es una de las tres formas de satisfacer la validación de arranque descrita arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar cualquier objeto. Nombrado `INSECURE` en el objeto de configuración por una razón: solo es justificable en aplicaciones monousuario o single-tenant donde todas las cuentas tienen acceso total y confiable a todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las transformaciones de imágenes generadas (redimensionado, cambio de formato) en lugar de procesarlas en cada petición. | `false` |

### Correo electrónico (Opcional)
`MAGIC_LINK_URL`.

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre para mostrar en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de correo (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo que encabeza las plantillas de correo por defecto. URL absoluta `http(s)` en formato PNG o JPG (los clientes de correo descartan SVGs y bloquean URIs `data:`). Si no se define, una app con nombre `Rebase` mostrará el logotipo de Rebase y una app renombrada no mostrará ninguno |
| `MAGIC_LINK_URL` | Destino al que apunta el enlace mágico enviado por correo. A una URL base se le añade `/auth/magic-link?token=…`; si contiene `{token}`, se toma como el enlace completo (útil si el frontend no sirve la ruta `/auth/magic-link`). Enciérrelo entre comillas en el `.env`, ya que un `#` sin entrecomillar inicia un comentario: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valor con un hash o una ruta de archivo sin `{token}` provocará una advertencia en el arranque. Sin definir, la base predeterminada es `FRONTEND_URL` |

### Pool de conexiones de base de datos

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos de inactividad antes de cerrar una conexión | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera máxima para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pooler). Requerida por [Realtime](/docs/backend/realtime): `LISTEN`/`NOTIFY` no sobreviven en poolers en modo transacción como PgBouncer; sin ella, las notificaciones de cambios se desactivan con una advertencia en lugar de perderse en silencio. El [procesador de trabajos (job worker)](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación sobre esta conexión. Rellena el campo `directConnectionString` del adaptador de Postgres cuando no está definido. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando apunta a otro servidor, las lecturas autenticadas (listas, registros individuales, conteos, agregaciones) se atienden allí bajo las mismas reglas de RLS; las escrituras, inicios de sesión, realtime, crons, jobs, la consola SQL y `rebase.sql` permanecen en el nodo principal. Si un usuario realiza una escritura, sus lecturas posteriores se dirigirán al nodo principal durante `REBASE_READ_STICKY_MS`, al igual que las de todos los usuarios si la réplica supera el retraso configurado en `REBASE_READ_MAX_LAG_MS` o presenta fallos. Rellena `readConnectionString` en el adaptador de Postgres si no está definido; hasta la versión 0.28 inclusive, el pool de la réplica se inicializaba pero nunca se consultaba. | — |
| `REBASE_READ_STICKY_MS` | Tiempo posterior a una escritura durante el cual las lecturas del mismo usuario se dirigen al nodo principal, garantizando consistencia inmediata al listar tras guardar. Configurado por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso máximo permitido en la réplica tras el cual todas las lecturas se redirigen al nodo principal. | `1000` |
| `DATABASE_POOLED` | `true` si `DATABASE_URL` pasa por un pooler en modo transacción (como PgBouncer). El pool no enviará `search_path` ni `statement_timeout` durante la conexión (el pooler los rechazaría o ignoraría) y configurará ambos en cada transacción; el arranque asignará al rol de base de datos un `search_path` por defecto de `public` para sentencias ejecutadas fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser obligatoria, utilizándose para realtime, la reactivación del worker de tareas, la creación de índices, el branching y la consola SQL. Se asumirá que la URL de la réplica también usa un pooler. Para fuentes de datos adicionales, utilice `DATABASE_POOLED__<KEY>`. | — |
| `REBASE_DB_POOL_MAX` | Límite máximo global para todos los pools del proceso, aplicado independientemente de lo solicitado por cada uno. Solo números enteros: un valor inválido se ignora en lugar de bloquear el servidor. | — |

### Comportamiento del runtime

Leído por el runtime: `rebase dev`, `rebase start` y la imagen de servidor publicada.
Un proyecto que ha ejecutado eject gestiona estas decisiones directamente en su propio código.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría periódica de seguridad a nivel de fila (RLS)](/docs/rls-check#running-it-on-a-schedule), que alerta sobre tablas expuestas sin políticas activas. El proyecto debe incluir `@rebasepro/rls-check` en sus dependencias: el runtime no incluye una copia por defecto, y sin este paquete el arranque fallará indicando el problema. `false` desactiva el escaneo en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | Rol de Postgres bajo el cual se ejecutan las peticiones autenticadas y anónimas. Asigne uno distinto a cada proyecto en un clúster compartido. La base de datos registra el rol con el que opera, y un arranque configurado con un rol distinto se detendrá hasta ejecutar `rebase db request-role migrate`. Consulte [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de petición y permite que la conexión cambie a él; `never` delega la creación y asignación al administrador, limitándose a verificarlos. | `auto` |
| `REBASE_RLS_GRANTS` | Privilegios otorgados por Rebase al rol de petición: `schema` (todas las tablas en los esquemas servidos, más privilegios predeterminados), `managed` (únicamente las tablas administradas) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase exclusivamente a los roles de petición, evitando que otros roles que lean las mismas tablas se beneficien de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` aplica las políticas exclusivas del servidor o admin `TO public`, y ejecuta las peticiones de administradores bajo el rol de petición. Por defecto se definen como `TO rebase_admin`, permitiendo que las lecturas filtradas por propietario de usuarios autenticados aprovechen el índice del propietario. Consulte [Peticiones administrativas y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política base de servidor o administrador de todas las tablas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` define adicionalmente `request.jwt.claims` y `request.jwt.claim.*`, permitiendo que las políticas escritas con `auth.uid()` identifiquen al usuario. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Acción del arranque cuando otro inicio de sesión puede asumir el rol de petición: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. El cliente debe configurarse con el mismo valor; consulte [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los activos estáticos y del panel de administración del bundle desde este proceso. Desactívelo si hay un CDN intermediario. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compresión de respuestas mediante gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` habilita las [notificaciones push](/docs/backend/push-notifications/): rutas `/api/push`, la tabla `rebase.push_subscriptions` y el servicio `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Par de claves VAPID para la firma de notificaciones push. En entornos fuera de producción, si no están definidas se genera un par automáticamente en `.rebase-dev-secrets.json`; en producción, las notificaciones push permanecen desactivadas sin ellas. | — |
| `REBASE_VAPID_SUBJECT` | Dirección `mailto:` o URL `https://` de contacto para los servicios push. Por defecto toma el origen de una URL `https` configurada en `REBASE_PUBLIC_URL`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo permitido para el cuerpo de las peticiones, **en bytes** (`10485760`, no `10MB`; valores no numéricos provocarán error de arranque en lugar de omitir el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI (tres estados posibles). Sin definir, en cualquier entorno: `/api/docs` se sirve a los clientes a los que `GET /api/schema/tables` describe tablas (cada uno con la documentación de sus respectivas tablas) y no se expone la interfaz Swagger UI. `true` publica el documento completo para todos y monta la **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` restringe el acceso al documento detrás de la autenticación de administrador. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, haciendo que los navegadores rechacen HTTP plano en todos los subdominios durante seis meses (incluidos los que no atienda este proceso). Actívelo únicamente si todos los subdominios del dominio usan exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` detendrá el arranque. Consulte [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer para proteger el endpoint `/metrics`. Dejarlo sin definir expone el endpoint a cualquier origen con acceso al puerto (aceptable en redes privadas, inseguro en redes públicas; los logs de arranque advertirán sobre esto). | — |
| `REBASE_MIGRATE_ON_BOOT` | Comportamiento del runtime respecto al esquema de tablas durante el arranque. `ensure` (valor predeterminado universal, incluida producción) ejecuta una pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, sin eliminar ni reescribir nada. `none` no altera las tablas declaradas, aunque sí crea y actualiza las tablas del propio framework (auth, API keys, jobs, cron); `REBASE_PROVISION=false` desactiva también estas últimas. La imagen oficial solo admite estos dos valores y **rechaza arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), solo un proceso debe realizar aprovisionamiento, debiendo el resto establecer `none` para evitar errores al iniciar. | `ensure` |
| `REBASE_PROVISION` | `false` impide que el runtime altere la base de datos: ninguna tabla, columna, índice, función, disparador, política, rol o permiso se modificará, ni en el arranque ni posteriormente (incluidas las del framework). En su lugar, reportará por nombre los elementos que falten. Indicado para bases de datos cuyos esquemas se gestionan exclusivamente mediante procesos de migración externos. Consulte [Cuando solo sus procesos de cambio gestionan la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo admite `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Detiene el arranque si la base de datos fue aprovisionada por última vez con un esquema de tablas distinto al compilado en este proceso. Sin definir (o con cualquier valor distinto de `true`/`1`), solo emitirá una advertencia. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Detiene el arranque si un archivo de funciones o cron arroja un error o falla al analizarse durante la importación, detallando los archivos afectados y las causas, lo que garantiza que un despliegue progresivo mantenga la versión anterior activa. También aplica en reinicios. Sin definir (o con valor distinto de `true`), se omitirá el archivo fallido y se continuará con el resto. Un archivo que se importe limpiamente sin exportar funciones o tareas se omite siempre sin detener el arranque. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (lee cambios desde el WAL si la BD lo permite, recurriendo si no a disparadores o finalmente a la capa de aplicación, registrando cada degradación en logs), `trigger` (fuerza el uso de disparadores, advirtiendo si falla), `wal` (lee cambios desde el WAL en lugar de usar disparadores; requiere `wal_level=logical` y un rol con permisos de replicación, degradando a `trigger` si no es posible), `off`. Consulte [Tiempo real](/docs/backend/realtime-cdc/). Tiene prioridad sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Mecanismo de transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora si se proporcionó un transporte explícito en `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Número máximo de suscripciones permitidas en un socket de tiempo real; peticiones posteriores se rechazarán con `TOO_MANY_SUBSCRIPTIONS`. Requiere un entero positivo (cualquier otro valor detendrá el arranque). Sobrescribe `realtime.maxSubscriptionsPerSocket`. Consulte [Tiempo real](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Límite de sockets de tiempo real que un usuario o API key puede mantener abiertos en una misma instancia. Los sockets de suplantación abiertos por administradores computan contra el administrador. Al excederlo, la conexión se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (código 4002); el SDK continuará reintentando hasta que otro socket se cierre. Requiere un entero positivo (cualquier otro valor detendrá el arranque). Sobrescribe `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tiempo máximo de espera (en ms) antes de ejecutar la reconsulta que envía los cambios a los suscriptores activos. Espera hasta 300 ms si no hay cambios, y como máximo este intervalo durante flujos continuos de escritura. Requiere un entero positivo (cualquier otro valor detendrá el arranque). Sobrescribe `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tiempo (en ms) durante el cual el total de una suscripción a listas grandes puede reutilizarse antes de recalcularse; las tramas que reutilizan el dato incluyen `meta.totalAsOf`. Sin definir, cada trama efectúa el recuento. Sobrescribe `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | Tamaño mínimo de filas a partir del cual aplica `REALTIME_RECOUNT_INTERVAL_MS`; colecciones menores se cuentan en cada trama. Sobrescribe `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite el uso de valores `localhost`/loopback bajo `NODE_ENV=production`. Desactivado por defecto, provocando que un inicio en producción falle explícitamente en lugar de conectarse a servicios locales inexistentes. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta el proceso de esquema y finaliza sin levantar el socket HTTP (ideal para Jobs de migración en contenedores, usando la misma imagen y bundle que el servidor final). Genera además las tablas que el proceso principal crearía en su primer uso, omitiendo el inicio de colas de trabajos o tareas cron. Una variable vacía equivale a *no definida*, evitando que un `${VARIABLE}` no interpolado en Docker Compose active este modo accidentalmente. Incompatible con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Ruta de archivo donde una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) volcará todas las modificaciones de esquema aplicadas, en orden, como script SQL para su revisión manual con `psql`. Las filas insertadas no se incluyen. Prohibido en procesos que sirvan tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que procesos automatizados (agentes, pipelines de CI) no solo planifiquen sino que *apliquen* cambios de esquema mediante `/api/admin/schema`. Desactivado por defecto como medida de seguridad ante credenciales expuestas en CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo máximo de ejecución permitido para una función personalizada antes de abortar la petición. Mismo control que la opción `functionsTimeoutMs`. `0` desactiva el límite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que una promesa rechazada no capturada termine el proceso inmediatamente en lugar de solo registrarla. Recomendado en entornos con orquestadores que reinician contenedores automáticamente; desactívelo si reiniciar resulta más perjudicial que una fuga puntual de memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Suprime la advertencia de arranque en plataformas identificadas como de escalado a cero (scale-to-zero), donde temporizadores activados en instancias inactivas no llegarían a dispararse. No altera ningún otro comportamiento: actívelo si garantiza al menos una instancia en ejecución permanente. | — |
| `TRUSTED_PROXY_HOPS` | Cantidad de balanceadores o proxys situados delante del servidor, permitiendo al limitador de peticiones identificar la IP real del cliente mediante `X-Forwarded-For`. Su valor seguro predeterminado es `0`: sin un proxy intermedio, confiar en este encabezado permitiría a clientes maliciosos falsificar su dirección IP. | `0` |

:::note[El aprovisionamiento de arranque es aditivo y no es una herramienta de migración]
La pasada de arranque se ejecuta de forma desatendida sin supervisión humana de los diffs generados, por lo que nunca eliminará una columna, restringirá tipos de datos ni reescribirá tablas. Por este motivo la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`: un comando push completo calcula diferencias y ejecutaría instrucciones destructivas como `DROP COLUMN`, y el reinicio de un contenedor jamás debe arriesgarse a destruir datos en producción.

Las operaciones destructivas o de reestructuración deben realizarse en entornos controlados: mediante `rebase db generate` + `rebase db migrate`, o con `rebase db push` desde un entorno local o CI, el cual ejecuta un simulacro, exige confirmación explícita para cambios destructivos y permite generar una copia de seguridad previa.
:::

### Despliegues divididos

Una misma imagen y bundle pueden ejecutarse en múltiples procesos, asumiendo cada uno una responsabilidad específica del proyecto. A continuación se listan las variables relacionadas; para comprender qué *monta y ejecuta* cada combinación (y cuáles combinaciones no están permitidas), consulte **[Procesos divididos (Split Processes)](/docs/deployment/split-processes)**.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_ROLE` | Rol del proceso en cuestión: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los planificadores cron. Sin definir, se ajusta al rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso procesa workers de la cola de tareas. Sin definir, se ajusta al rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Atiende exclusivamente las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atiende todas las funciones personalizadas excepto las especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al cual el proceso API redirige peticiones de funciones no alojadas localmente. En un nodo `worker`, indica a dónde se dirigen sus llamadas internas a `rebase.functions`. URL `http(s)`. | — |

### Superficie MCP

Endpoint opcional para el protocolo Model Context Protocol ubicado en `/mcp`, que permite a clientes de IA consultar y modificar datos del proyecto **actuando como el usuario autenticado**. Está desactivado por defecto y ningún `REBASE_ROLE` lo habilita automáticamente: mientras los roles definen la arquitectura operativa, habilitar MCP implica exponer credenciales a software de terceros, decisión que debe ser tomada explícitamente por un operador.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_MCP_ENABLED` | Habilita la superficie MCP. Requiere definir `REBASE_PUBLIC_URL`; sin ella, el endpoint no se montará, registrando un mensaje explicativo en los logs de arranque. | `false` |
| `REBASE_PUBLIC_URL` | Origen público accesible externamente para este despliegue (ej. `https://app.example.com`). La superficie MCP no puede inferirlo dinámicamente: deducirlo del encabezado `Host` permitiría que el cliente defina arbitrariamente la identidad del emisor y la audiencia contra la que se validan sus tokens. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista personalizada de la aplicación MCP (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), provista a Claude en reemplazo de la vista genérica para renderizar vistas, campos y acciones propios. Si no se especifica, el backend la buscará junto a los activos estáticos del frontend. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591) para que los clientes se registren por sí mismos. Establézcalo en `false` para requerir el registro previo de clientes. | `true` |

### Edición de esquema en vivo desde un bundle

Desactivada a menos que se defina `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado carece del código fuente original en `backend/schema`, por lo que al definir estas variables, el editor de esquemas descarga el código desde el repositorio, confirma los cambios mediante commits y ejecuta el DDL resultante en la base de datos. Función exclusiva para administradores y aplicada manualmente por un operador, salvo que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Configurar un repositorio sin credenciales válidas detendrá el arranque del servidor. Consulte [Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositorio de GitHub donde se confirman las modificaciones del esquema (`propietario/repositorio`). Definir esta variable habilita la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Rama donde se realizan los commits. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Ubicación relativa de `backend/schema` dentro del repositorio. Rutas que intenten escapar del directorio del repositorio provocarán error de arranque, al igual que el uso de la directiva obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token con permisos granulares de lectura y escritura en el contenido del repositorio. Utilice esta opción o las tres variables `_GITHUB_APP_*`, pero no ambas simultáneamente. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identificador de la GitHub App para autenticar los commits como aplicación. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalación de la GitHub App en el repositorio objetivo. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clave privada de la aplicación: en formato PEM, PEM con caracteres de nueva línea escapados o codificada en base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `BACKUP_SCHEDULE` | Expresión cron para programar copias de seguridad automáticas. Sin definir desactiva la programación. | — |
| `BACKUP_DESTINATION` | Ruta del sistema de archivos local o URI de almacenamiento remoto (`s3://bucket/prefix` / `gs://bucket/prefix`). Obligatoria si se define `BACKUP_SCHEDULE` (el proceso fallará sin ella). El comando `rebase db backup` recurre a `./backups` en el directorio de ejecución si no se define. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad anteriores a N días. Sin definir o en `0` conserva todos los respaldos indefinidamente. | — |
| `BACKUP_KEEP_MINIMUM` | Cantidad mínima de copias de seguridad recientes a preservar siempre, independientemente de la política de retención. | — |
| `PG_DUMP_PATH` | Ruta al binario `pg_dump` ejecutable; debe coincidir con la versión mayor de la base de datos o ser superior. | — |
| `PG_RESTORE_PATH` | Ruta al binario `pg_restore` ejecutable. | — |
| `PSQL_PATH` | Ruta al binario `psql` que `rebase db restore --clean` ejecuta para procesar la restauración en una única transacción. | — |
| `PG_DUMPALL_PATH` | Ubicación de `pg_dumpall` cuando no se encuentra en el `PATH` del sistema. Sin él (y sin las herramientas de cliente de PostgreSQL instaladas), las copias de seguridad globales fallarán reportando esta variable. | — |

La imagen oficial del runtime (`rebasepro/server`) incluye las herramientas de cliente de PostgreSQL 18,
permitiendo programar copias de seguridad sobre servidores de hasta PostgreSQL 18 sin configuración adicional.
En entornos fuera de esta imagen, instálelas manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen credenciales e información de identificación personal (PII).
Utilice destinos privados con cifrado en reposo.

### Entrega de bundles

En implementaciones administradas, el código de la aplicación no se incluye dentro de la imagen: el runtime descarga
el bundle durante el arranque. Las siguientes variables regulan esta operación:

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_BUNDLE` | Ruta local a un directorio de bundle previamente extraído. Asignada automáticamente por `rebase start` en entornos locales. | — |
| `REBASE_BUNDLE_URL` | Endpoint desde el cual descargar el archivo comprimido del bundle cuando no se cuenta con una copia local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para autorizar la descarga del bundle. Trátela como un secreto confidencial, ya que autoriza la descarga del código fuente del proyecto. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directorio donde se descomprime el bundle descargado. Debe ser escribible y persistir entre la fase de descarga y el arranque del proceso. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime pone a disposición del bundle, más allá de los declarados por este. | — |

### Vinculaciones de recursos

Cada base de datos, bucket o topic definido en `backend/resources.ts` se vincula
mediante variables de entorno asociadas a su nombre. Las variables base se muestran abajo;
los recursos secundarios sufijan su identificador precedido por `__` en mayúsculas (por ejemplo,
un bucket denominado `media` leerá `S3_BUCKET__MEDIA`). El comando `rebase status`
imprime, para cada recurso, la variable exacta leída y si está definida actualmente.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_DRIVER` | Paquete npm que implementa el controlador de una fuente de datos cuando no se usa el predeterminado de Postgres. Añade el identificador como sufijo: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Cadena de conexión para un topic declarado. Añade el nombre del topic como sufijo. | — |

### Entorno propio de la CLI

Variables leídas exclusivamente por la utilidad `rebase`, sin impacto en la ejecución del servidor o despliegue.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_BASE_URL` | Endpoint al que `rebase api-keys`, `rebase storage` y `rebase auth reset-password` envían la clave de servicio, en el shell o mediante `.env`. Utilícelo si el servidor se ejecuta por medios distintos a `rebase dev` en el proyecto actual (`rebase start`, en un contenedor o en un host remoto). Sin definir, consultan la instancia detectada por `rebase dev` mientras esté activa, omitiendo el envío si no lo está. | — |
| `REBASE_SERVICE_KEY` | Clave de servicio utilizada por dichos comandos para autenticarse, leída de `.env`: corresponde a la misma variable empleada por el servidor (ver arriba). | — |
| `SERVICE_KEY` | Denominación previa de la variable anterior. Si existe en `.env`, comandos como `rebase api-keys` y `rebase storage` la leerán con prioridad sobre `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Ruta al archivo `.env` específico que la CLI debe leer y modificar cuando difiera del predeterminado del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` evita que `rebase init` y `rebase skills install` agreguen las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` en la raíz del repositorio, útil cuando se gestionan estos archivos manualmente. | on |
| `REBASE_CLOUD_URL` | Endpoint del plano de control con el que interactúa `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Cuenta empleada por `rebase cloud login` para autenticarse sin solicitar interactivamente el correo. | — |
| `REBASE_CLOUD_PASSWORD` | Contraseña para dicha cuenta, permitiendo inyectarla desde un gestor de secretos sin dejar rastro en el historial del shell. | — |
| `REBASE_TOKEN` | Token emitido por `rebase cloud tokens create`. Al configurarse, las operaciones de `rebase cloud` se autentican con este token en lugar de usar la sesión de usuario de `rebase cloud login`, sin leer ni alterar las sesiones almacenadas localmente. En directorios vinculados mediante `rebase cloud init --claim`, se omite a favor del token del propio proyecto si este no incluye los permisos requeridos. Es el método recomendado para operar `rebase cloud` en CI; consulte [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI en las herramientas en la nube que invoca, y nunca lo envía a la aplicación (utilice `REBASE_API_TOKEN` para ello). | — |
| `REBASE_DEBUG` | `1` imprime el detalle completo del error y peticiones HTTP en lugar de mensajes resumidos. Muy útil al depurar fallos imprevistos en comandos de `rebase cloud`. | — |
| `REBASE_ATLAS_DEV_URL` | Base de datos vacía utilizada por `rebase db push`, `db generate` y `db migrate` para calcular esquemas y diferencias, en sustitución de la BD `<db>_dev_diff` que suelen generar junto a `DATABASE_URL`. Rebase no creará ni destruirá la base de datos aquí indicada, y rechazará la operación si es idéntica a `DATABASE_URL`. En la base de desarrollo administrada, la CLI utiliza por defecto una instancia efímera de PGlite en memoria. Indíquela en entornos donde no se cuente con privilegios de `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` omite el inicio y aprovisionamiento de bases de datos locales, asumiendo que usted provee la suya. Equivale a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, el cual `rebase dev` calcula normalmente a partir de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tiempo que `rebase dev` espera a que el backend confirme su inicialización antes de reportar un fallo en el arranque. `0` deshabilita el timeout. | `30000` |
| `DATABASE_PASSWORD` | Contraseña inyectada por `rebase dev --docker` en la cadena de conexión generada desde `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Estándar común entre herramientas de desarrollo. Si toma cualquier valor distinto de `0`, la CLI desactivará el envío de telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Desactiva específicamente la telemetría de Rebase sin requerir archivos adicionales; es la variable recomendada para imágenes de contenedores y pipelines de CI. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint alternativo de recolección de telemetría para servidores autoalojados. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto esta clave como `REBASE_SERVICE_KEY`
se generan automáticamente fuera de entornos de producción, facilitando iniciar proyectos sin pasos previos.

Los valores autogenerados se conservan en `.rebase-dev-secrets.json`, ubicado junto a
`.rebase-dev-port` y `.rebase-dev-url` e ignorado en git con ellos. Anteriormente se
regeneraban en cada reinicio, lo que invalidaba las sesiones activas en la app y las claves
de API creadas durante la sesión previa.

- Si define cualquiera de estas variables de forma explícita, se utilizará su valor configurado y no se leerá ni escribirá la caché.
- Modifique la ruta del archivo de caché asignando `REBASE_DEV_SECRETS_FILE` (es la única variable de este apartado pensada para configurarse manualmente).
- Borre el archivo si desea rotar ambos secretos; el siguiente arranque creará uno nuevo.
- Si el entorno impide la creación del archivo (por ejemplo, en un contenedor montado en solo lectura), el servidor iniciará usando secretos efímeros en memoria, tal como operaba anteriormente.

En entornos de producción o bajo runners de tests, los secretos nunca se almacenan en caché ni se generan
automáticamente: un arranque productivo carente de `JWT_SECRET` fallará indicando la variable faltante:

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

Las mismas opciones, omitiendo `app`, `server` y `basePath` y requiriendo obligatoriamente
la directiva `provision`, permiten construir un backend desmontado que no sirve rutas hasta ser
incorporado en un servidor externo mediante `createRebaseBackend`. Consulte
[Integración en servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

Modificar `basePath` reubica todas las rutas servidas por la API, por lo que el cliente frontend debe
estar al tanto de este prefijo; de lo contrario, solicitará `/api/...` y obtendrá respuestas 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración hereda esta configuración del cliente suministrado; no se precisa ninguna
acción adicional. Al construir endpoints manualmente, concaténelos desde la instancia del cliente en vez de
escribir `/api` de forma fija:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en SQL Editor (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, aun cuando la vista de datos tipo hoja de cálculo del CMS carga los registros sin inconvenientes.
* **Causa:** Por defecto, Rebase ejecuta las consultas del editor SQL alternando temporalmente los roles de la base de datos para simular el rol de aplicación del usuario en sesión (por ejemplo, mediante `SET LOCAL ROLE "admin"`). Si implementa autenticación personalizada donde los roles solo existen en tablas de datos y no como roles reales de PostgreSQL, el cambio de rol fallará o carecerá de permisos en la base de datos. Por contra, la vista CMS opera directamente bajo el usuario propietario de la conexión de base de datos, sorteando este paso.
* **Solución:** Añada `DISABLE_DB_ROLE_SWITCHING=true` al archivo `.env` del backend. Esto forzará al editor SQL a consultar siempre usando los permisos del propietario de la conexión (generalmente un superusuario/owner). El editor SQL indicará entonces sobre los resultados que fueron leídos como el propietario de la conexión y deshabilitará el selector interactivo de roles.

### Error al obtener el esquema en SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol de esquemas, o el editor SQL arroja el error `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase precisa privilegios de administrador para inspeccionar los catálogos del sistema y ejecutar directivas de gestión interna. Si no se pasa `adminConnectionString` al bootstrapper, o si se sobrescribe `getAdmin()` devolviendo `undefined`, dichas operaciones son rechazadas.
* **Solución:** Cerciórese de suministrar `adminConnectionString` durante la inicialización del bootstrapper en el backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía para despliegues en producción
- **[Visión general del backend](/docs/backend)** — Documentación integral sobre la configuración del backend
