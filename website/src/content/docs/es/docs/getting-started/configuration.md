---
sourceHash: 9acb2b3f441697d7
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos de Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor rechaza el arranque e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime (`rebase dev`, `rebase start`, la imagen publicada) utiliza el
> esquema que posee el runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas que se muestran a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede agregar allí sus propias
> variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en todos los demás casos. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Usa una cadena aleatoria segura (mín. 32 caracteres). **Obligatoria en producción** (generada automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **En una base de datos gestionada, `sslmode=require` puede no significar lo que dice.**
>
> Para `psql` y cualquier herramienta basada en libpq, `require` significa "cifrado, certificado no
> verificado". El controlador de Node sobre el que se ejecuta Rebase lo interpreta como `verify-full`, por lo que una
> base de datos cuyo certificado no fue firmado por ninguna autoridad pública (habitual en Postgres
> gestionado) rechaza el runtime con `self-signed certificate`, mientras que `psql`
> se conecta con la misma URL. El runtime y los comandos `rebase db` se detienen con un
> mensaje que advierte sobre esto.
>
> Elige una opción:
>
> - **`sslmode=no-verify`** — cifrado, no verificado: lo que `require` significa para
>   libpq. Es una sintaxis propia de node-postgres de la que libpq carece, por lo que `psql`, `pg_dump`
>   y Atlas la rechazan con `invalid sslmode value: "no-verify"`. Los propios comandos
>   de Rebase (`rebase db push`, `rebase db backup`, `rebase db restore`) se la transmiten
>   como `sslmode=require`, funcionando correctamente con la URL configurada; para
>   usar `psql` manualmente, cámbialo por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra el
>   certificado de la CA del proveedor. Idéntico para todas las herramientas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido por la propia advertencia del controlador de Node,
> también funciona para el runtime; los comandos de Rebase eliminan `uselibpqcompat`
> antes de pasar la URL a las herramientas de libpq, que de otro modo la rechazarían.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Configura esto solo en desarrollo**; consulta a continuación. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita «Iniciar sesión con Google». | — |


> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API comparte el mismo origen que la página y el cliente la resuelve de esa forma automáticamente.
>
> Fijar una URL absoluta en un bundle de producción funciona bien hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga la página desde
> `example.com` y llama a la API en `example.rebase.website`, lo cual es
> cross-origin, provocando que cada petición falle en el preflight. Permitir el origen en CORS
> **tampoco** lo soluciona: la cookie de actualización (refresh) es `SameSite=Lax` y no se
> envía entre sitios (cross-site), por lo que eliminarías los errores de la consola pero
> la autenticación seguiría rota. Al dejarlo sin definir, cualquier dominio que apunte a la aplicación funciona
> sin necesidad de configurar CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `PORT` | Puerto para el servidor HTTP del backend. Lo lee `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** (un `PORT` en `.env` no se lee allí, ya que el puerto se resuelve antes de cargar dicho archivo) y, por defecto, vincula un puerto derivado de la ruta del proyecto para permitir ejecutar varios proyectos simultáneamente. `rebase dev --port` tiene prioridad sobre ambos, y el mensaje de inicio indica el nivel utilizado. | `3001` |
| `LOG_LEVEL` | Verbosidad del registro (logging): `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL tras una línea `Failed query: [redacted]`. Cada sentencia con error se oculta por defecto porque contiene sus parámetros vinculados (un correo electrónico, un hash de contraseña). Establécelo en `true` al diagnosticar un error de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** a menos que se configure `FRONTEND_URL`: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *añade a* localhost; consulta a continuación. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos con nivel de administrador (usada para la introspección del esquema y operaciones administrativas). La base de datos que indica no es la que la consola SQL considera actual, ni la que una nueva rama copia por defecto: ambas corresponden a la base de datos a la que apunta la conexión propia de la aplicación (consulta `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desactiva el cambio de roles de PostgreSQL en el Editor SQL (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará su selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Base de datos desde la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece al hacer checkout y [cambiar a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en dicha base de datos y copia nuevas ramas desde ella por defecto, permitiendo que el panel Branches de Studio muestre las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, más lo que `CORS_ORIGINS` (o `FRONTEND_URL`)
defina**: la misma lista que usa producción, con localhost añadido en lugar de
sustituido. De este modo, la variable funciona igual en ambos entornos y
los casos que la requieren en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté listado será rechazado, y el rechazo se
registrará **una vez por origen** indicando la línea exacta que lo permitiría. Rechazarlo
no es una precaución gratuita: la API transmite credenciales, por lo que reflejar un
`Origin` arbitrario permitiría a cualquier sitio web que visite el desarrollador realizar
peticiones autenticadas contra el servidor de desarrollo utilizando su sesión y leer las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `JWT_SECRET` | Secreto para la firma de JWT (obligatorio en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), permitiendo que cualquier entidad con el JWKS verifique una sesión sin poder emitir una. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n`, o en base64 del PEM completo. Sin esta variable, los tokens se mantienen en HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo siempre que cambie la clave: la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de expiración del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de expiración del token de actualización (refresh). Deslizante: cada rotación lo renueva, por lo que determina cuánto tiempo sobrevive una sesión ante la **inactividad**. Establece `400d` para sesiones que deban perdurar tras una larga ausencia; los navegadores limitan la cookie de actualización a ese periodo. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, independientemente de este valor: una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro de inicialización con `SETUP_REQUIRED`, la primera cuenta creada mediante registro abierto pasa a ser una cuenta ordinaria y el administrador debe indicarse mediante `REBASE_ADMIN_EMAIL` (ver más abajo) o asignarse con la clave de servicio. El archivo `.env.example` del proyecto base lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Mecanismo de corte de emergencia. Cierra la ventana de arranque para el primer usuario que `ALLOW_REGISTRATION=false` deja abierta deliberadamente fuera de producción, impidiendo el registro incluso con una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL`, o el despliegue no dispondrá de ninguna vía para generar su primer usuario autenticado. Todos los artefactos de despliegue empaquetados lo activan. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada durante el arranque **mientras la tabla de usuarios siga vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador define la primera cuenta en lugar de exponerse a que un tercero la cree primero en internet. El arranque emite una advertencia si la tabla está vacía en producción y no se define esta variable. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para dicha cuenta. Debe tener al menos 12 caracteres; de lo contrario, será rechazada y no se creará la cuenta. Cámbiala tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque muestra una advertencia; rotar `JWT_SECRET` cerraría la sesión de todos los usuarios *y además* dejaría inservible cualquier autenticador registrado. Configura una clave dedicada (más de 32 caracteres aleatorios) antes de que los usuarios comiencen a registrarse. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave anterior en un proceso de rotación. Define ambas variables durante una rotación: los nuevos secretos se escribirán con `MFA_ENCRYPTION_KEY` y los existentes seguirán siendo legibles, evitando bloqueos de cuenta durante la transición. Elimínala una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional por activación (opt-in), y deliberadamente independiente de `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticación para la API de datos. Establécelo en `false` para una superficie de lectura totalmente pública; RLS continuará aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta la ruta `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para usuarios autenticados; nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto: representa una superficie susceptible de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo debe emplearse en frontends genuinamente de orígenes distintos (cross-site). | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Activado por defecto; usa `AUTH_COOKIE_SECURE=false` para HTTP simple (un despliegue en una red local donde el navegador de lo contrario descartaría la cookie y la sesión expiraría al vencer el token de acceso sin mostrar error). Emite una advertencia al arrancar. `http://localhost` no lo requiere. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth (validación en el backend) | — |
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
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. La URL base (`baseUrl`) para una instancia autohospedada no se define por variable de entorno; configúrala en el bloque `auth` para ese fin. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID para el inicio de sesión web. Es público y se publica en `GET /auth/config`. Apple no utiliza un secreto de cliente estático, ya que Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por lo tanto, Apple requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de esta variable o `APPLE_BUNDLE_IDS`, sin los cuales no configura nada. | — |
| `APPLE_BUNDLE_IDS` | Lista separada por comas de bundle IDs de las aplicaciones nativas de iOS/macOS cuyos códigos de «Sign in with Apple» se aceptan. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, el emisor del JWT. | — |
| `APPLE_KEY_ID` | ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se admiten secuencias de escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API estática con privilegios de administrador. Omite la autenticación JWT habitual para llamadas entre servidores al enviarse como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la cual se verifican los tokens de plataforma `rpt_`; puede contener varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene datos confidenciales. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que el filtro de administración acepte un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto que el campo `aud` de un token de plataforma debe coincidir, asegurando que un token emitido para otro proyecto sea rechazado. Si solo se define una de las dos variables, el servidor arrancará, registrará una advertencia y responderá a cualquier token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destino del botón **Continue with Rebase Cloud** del panel de administración: la página del proyecto en la consola de la plataforma, que autentica a los propietarios del proyecto y los redirige de vuelta. La plataforma la configura en el despliegue junto con las dos anteriores; con ellas, `POST /api/auth/platform-signin` acepta el token de un minuto `auth:admin-signin` de la plataforma y crea una sesión de administrador. Sin ella, el acceso sigue disponible desde la opción **Open CMS** de la consola, y la pantalla de inicio de sesión se limitará a indicarlo. | — |
| `REBASE_RATE_LIMIT_STORE` | Almacén de contadores para la limitación de tasa (rate-limit), tanto para las rutas de autenticación como para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no conoce la cantidad de réplicas en ejecución, por lo que un despliegue con réplicas debe indicarlo; tres réplicas con el valor por defecto permitirán hasta tres veces el límite establecido. Cualquier otro valor **impedirá el arranque** en lugar de usar un valor de respaldo, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de enlace de inicio de sesión sin contraseña (magic link). Requiere tener un servicio de correo configurado para enviar el enlace. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña mediante un código de seis dígitos enviado por correo. Mismos requisitos de correo electrónico que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de magic-link o de código por correo para una dirección no registrada creará la cuenta, siempre que el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamiento cuando se reutiliza un token de actualización fuera de su ventana de tolerancia: `reject` (rechazar el token y mantener la sesión) o `revoke-session` (cerrar la sesión). Cualquier otro valor impedirá el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: impide el inicio de sesión con contraseña hasta verificar la dirección de correo. Requiere un servicio de correo; el arranque fallará si no está configurado. | `false` |
| `CAPTCHA_PROVIDER` | Habilita la verificación de captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir desactiva el captcha. | — |
| `CAPTCHA_SECRET` | Clave secreta del proveedor, utilizada en el backend para validar el token que envía el navegador. Obligatoria si se establece `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas que se protegerán (por ejemplo `register,login`). Si no se define, protege el conjunto de rutas predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las tablas están protegidas por Postgres RLS. El almacenamiento de objetos no tiene un equivalente (las claves comparten un espacio de nombres plano), por lo que si hay un bucket configurado sin un modelo de acceso, el servidor **se negará a arrancar en producción**. Debe satisfacerse con exactamente uno de los siguientes:
un hook `storageAuthorize` exportado desde `backend/storage.ts` (el método provisto por el proyecto base), `STORAGE_POLICIES`, `STORAGE_PUBLIC_READ`, o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3`, `gcs`, o `platform` (archivos en un prefijo gestionado por la plataforma, servidos mediante URLs firmadas por su broker; configurado por la plataforma). En producción, `local` desactiva el almacenamiento a menos que se defina `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio donde se ejecuta el servidor: la raíz del proyecto en `rebase dev`, o `backend/` en un servidor generado tras `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción: solo válido con un volumen persistente que monte `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de los buckets locales nombrados | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos de validez de la URL de descarga de un archivo privado (el token que `getSignedUrl()` genera). Máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo que la fuente admite, en bytes, para cualquier ruta de subida (`__<KEY>` para una fuente específica). Si no es un número entero de bytes, impedirá el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto GCP. Por lo general, se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de cuenta de servicio. Omitir en GCP si Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve todos los objetos de forma pública a cualquier usuario, sin necesidad de token. Solo para un bucket que realmente funcione como un CDN público. Una de las opciones válidas para el control de arranque anterior. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar cualquier objeto. Nombrado `INSECURE` en el objeto de configuración por una razón: solo es justificable en aplicaciones de un único inquilino (single-tenant) donde todas las cuentas tienen acceso total a todos los archivos. | `false` |
| `STORAGE_POLICIES` | Reglas de acceso al almacenamiento en formato JSON: `[{ "path", "operations"?, "allow" }]`, donde `allow` puede ser `"public"`, `"authenticated"`, `"owner"` o `{ "roles": [...] }`. Denegado por defecto; satisface el control de arranque. Una lista no válida impedirá el arranque. Consulta [Autorización de almacenamiento](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | El broker de almacenamiento de la plataforma, para `STORAGE_TYPE=platform`. Configurado por la plataforma que ejecuta el broker. | — |
| `STORAGE_BROKER_PROJECT` | El ID del proyecto al cual el broker delimita los archivos de este despliegue, para `STORAGE_TYPE=platform`. Configurado por la plataforma. | — |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las transformaciones de imágenes generadas (redimensionamiento, conversiones de formato) en lugar de procesarlas por petición. | `false` |

### Correo electrónico (opcional)
`MAGIC_LINK_URL`.

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre para mostrar del remitente |
| `APP_NAME` | Nombre del producto usado en asuntos y cuerpos de correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la cabecera de las plantillas de correo por defecto. PNG o JPG absoluto bajo `http(s)` (los clientes de correo eliminan SVG y bloquean URIs `data:`). Sin definir, una app nombrada `Rebase` usará el logo de Rebase y una renombrada no mostrará ninguno |
| `MAGIC_LINK_URL` | Destino al que apunta un enlace de inicio de sesión enviado por correo. A una URL base se le añade `/auth/magic-link?token=…`; una URL que contenga `{token}` se usará íntegramente como el enlace final, pensado para frontends que no manejen `/auth/magic-link`. Enciérralo entre comillas en el archivo `.env`, ya que un carácter `#` sin comillas inicia un comentario: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Si contiene un hash o una ruta de archivo sin `{token}`, se mostrará una advertencia al arrancar. Sin definir, la base predeterminada es `FRONTEND_URL` |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos de inactividad antes de cerrar una conexión | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pooler). [Realtime](/docs/backend/realtime) la necesita: las operaciones `LISTEN`/`NOTIFY` no sobreviven a través de un pooler a nivel de transacción como PgBouncer; sin ella, las notificaciones de cambios se desactivan con una advertencia en lugar de perderse en silencio. El [worker de tareas](/docs/backend/jobs) también la utiliza para su `LISTEN` de reactivación. Rellena la propiedad `directConnectionString` del adaptador de Postgres si no está definida. | — |
| `DATABASE_READ_URL` | Réplica de solo lectura (como un hot standby). Al indicar otro servidor, las lecturas autenticadas (listados, filas individuales, recuentos, agregaciones) se atienden desde allí bajo la misma seguridad a nivel de fila (RLS); las escrituras, inicios de sesión, realtime, crons, tareas, la consola SQL y `rebase.sql` permanecen en la base de datos principal. Si un usuario acaba de escribir, sus lecturas se dirigirán al primario durante `REBASE_READ_STICKY_MS`, y todos los usuarios lo harán si la réplica se atrasa más de `REBASE_READ_MAX_LAG_MS` o falla. Rellena la propiedad `readConnectionString` del adaptador de Postgres si no está definida; hasta la versión 0.28 inclusive, el pool de la réplica se inicializaba pero nunca se consultaba. | — |
| `REBASE_READ_STICKY_MS` | Tiempo posterior a una escritura durante el cual las lecturas del mismo usuario van al primario, asegurando que un guardado seguido de un listado refleje el cambio realizado. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Límite de desfase de la réplica a partir del cual todas las lecturas se dirigen a la base de datos primaria. | `1000` |
| `DATABASE_POOLED` | Debe ser `true` cuando `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. De este modo, el pool no enviará `search_path` ni `statement_timeout` durante la conexión (el pooler los rechazaría o descartaría) y los establecerá dentro de cada transacción; el arranque asignará al rol de la base de datos un `search_path` predeterminado de `public` para sentencias ejecutadas fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser obligatoria, y la utilizarán realtime, el mecanismo de reactivación del worker de tareas, la creación de índices, la gestión de ramas y la consola SQL. Se asume que la URL de la réplica también pasa por un pooler. Usa `DATABASE_POOLED__<KEY>` para fuentes de datos adicionales. | — |
| `REBASE_DB_POOL_MAX` | Límite máximo global para todos los pools en el proceso, aplicado sin importar lo solicitado individualmente por cada uno. Solo números enteros: un valor malformado se ignorará en lugar de serializar el servidor silenciosamente. | — |

### Comportamiento en tiempo de ejecución

Leído por el runtime (`rebase dev`, `rebase start` y la imagen de servidor
publicada). Un proyecto que ha hecho eject gestiona estas decisiones en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría de seguridad a nivel de fila programada](/docs/rls-check#running-it-on-a-schedule), que alerta sobre tablas expuestas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` en sus dependencias: el runtime no lo incluye, y sin dicho paquete el arranque fallará indicando el problema. `false` omite este escaneo en el proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | Rol de Postgres bajo el cual se ejecutan las peticiones anónimas y autenticadas. Asigna uno propio a cada proyecto en un clúster compartido. La base de datos registra el rol bajo el que corre; un arranque configurado con otro rol se negará a iniciar hasta que se ejecute `rebase db request-role migrate`. Consulta [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de petición y permite que la conexión cambie a él; `never` deja ambas tareas bajo tu responsabilidad y solo comprueba que existan. | `auto` |
| `REBASE_RLS_GRANTS` | Privilegios que Rebase otorga al rol de petición: `schema` (todas las tablas en los esquemas que expone, más privilegios por defecto), `managed` (solo las tablas que expone) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al rol o roles de petición, evitando que otros roles que lean las mismas tablas se beneficien de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` aplica las políticas que solo el servidor o un administrador pueden cumplir `TO public`, y ejecuta a los administradores bajo el rol de petición. Por defecto se aplican `TO rebase_admin`, permitiendo que las lecturas acotadas al propietario se beneficien del índice de propietario. Consulta [Peticiones de administrador y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política base de servidor-o-administrador de todas las tablas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` define también `request.jwt.claims` y `request.jwt.claim.*`, permitiendo que las políticas escritas con `auth.uid()` identifiquen al usuario emisor. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamiento del arranque si otro usuario de inicio de sesión puede asumir el rol de petición: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. Debe coincidir con la configurada en el cliente; consulta [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos y del panel de administración del bundle desde este proceso. Desactívalo si hay un CDN intermediario. | `true` |
| `REBASE_STUDIO` | Sirve la consola Rebase Studio independiente integrada en `/_studio` cuando exista un bundle estático de Studio. Configura en `false` para deshabilitarla. | `true` |
| `REBASE_STUDIO_DIR` | Directorio que contiene la SPA precompilada de Rebase Studio servida en `/_studio`. Por defecto es `/studio` en la imagen del contenedor. | `/studio` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Habilita la compresión gzip/brotli en las respuestas. | `true` |
| `REBASE_PUSH` | `true` activa las [notificaciones push](/docs/backend/push-notifications/): las rutas `/api/push`, la tabla `rebase.push_subscriptions` y `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Par de claves VAPID para firmar los mensajes push. Fuera de producción, se genera un par automáticamente y se guarda en `.rebase-dev-secrets.json` si no se definen; en producción las notificaciones push permanecen desactivadas sin ellas. | — |
| `REBASE_VAPID_SUBJECT` | Dirección `mailto:` o URL `https://` de contacto para los servicios push. Por defecto toma el origen de un `REBASE_PUBLIC_URL` con HTTPS. | — |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la petición, **en bytes** (`10485760`, no `10MB`; un valor no numérico impedirá el arranque en lugar de anular el límite silenciosamente). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI (estado tripartito). Sin definir en cualquier entorno: sirve `/api/docs` únicamente a los emisores a quienes `GET /api/schema/tables` describe tablas (mostrando solo las tablas que tienen visibles), sin UI de Swagger. `true` expone todo el documento a cualquier usuario, con la **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento restringido al acceso de administradores. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, haciendo que los navegadores rechacen HTTP simple en todos los subdominios durante seis meses (incluyendo hosts no atendidos por este proceso). Actívalo únicamente si todos los subdominios operan exclusivamente bajo HTTPS. Cualquier valor distinto de `true`/`false` impedirá el arranque. Consulta [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer de seguridad para `/metrics`. Si no se define, el endpoint queda expuesto a cualquier conexión entrante al puerto (apropiado para redes privadas, no para redes públicas; los registros de inicio mostrarán una advertencia). | — |
| `REBASE_MIGRATE_ON_BOOT` | Acciones permitidas sobre el esquema de las tablas al arrancar. `ensure` (por defecto en todas partes, incluida producción) ejecuta una fase exclusivamente **aditiva**: crea tablas, columnas y tipos enum faltantes, sin eliminar ni alterar estructuras existentes. `none` no modifica el esquema de las tablas declaradas, aunque las tablas internas del framework (auth, claves de API, jobs, cron) se crearán y actualizarán; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen oficial solo admite estas dos opciones y **se negará a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), solo un proceso debe realizar el aprovisionamiento; el resto de roles debe usar `none` o fallará el arranque. | `ensure` |
| `REBASE_PROVISION` | `false` impide que el runtime realice modificaciones en la base de datos: ninguna tabla, columna, índice, función, trigger, política, rol o permiso, al iniciar o más adelante, incluidas las propias del framework. En su lugar, informará de los elementos faltantes por su nombre. Útil para bases de datos gobernadas exclusivamente por tu propio flujo de migraciones. Consulta [Cuando solo tu proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo admite `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Impide el arranque si la base de datos fue aprovisionada por última vez con un conjunto de tablas diferente al empaquetado en este proceso. Sin definir (o con cualquier valor distinto de `true`/`1`) mostrará una advertencia. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Impide el arranque si un archivo de función o de cron arroja un error o no puede parsearse al importarse, indicando el archivo y el motivo, garantizando que un despliegue progresivo mantenga la versión anterior activa. También se aplica tras reiniciar. Sin definir (o con cualquier valor distinto de `true`) omitirá el archivo conflictivo y servirá el resto. Un archivo sin errores de importación que no exporte ninguna función o tarea siempre se omitirá, sin impedir el arranque. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (lee cambios del WAL si la base de datos lo permite; si no, usa triggers; en última instancia, recurre al nivel de aplicación, notificando cada fallback en los logs con nivel info), `trigger` (fuerza el uso de triggers y avisa si falla), `wal` (lee cambios directamente del write-ahead log en lugar de triggers; requiere `wal_level=logical` y permisos de replicación, usando fallback a `trigger` si no es posible), `off`. Consulta [Realtime](/docs/backend/realtime-cdc/). Tiene prioridad sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte inter-instancia para canales de broadcast y presencia: `memory` o `postgres`. Se ignora si a `realtime.bus` se le pasó un transporte explícito. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Límite de suscripciones simultáneas por socket de realtime; las suscripciones adicionales se rechazarán con `TOO_MANY_SUBSCRIPTIONS`. Debe ser un entero positivo; cualquier otro valor detendrá el servidor al arrancar. Tiene prioridad sobre `realtime.maxSubscriptionsPerSocket`. Consulta [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Límite de sockets de realtime abiertos simultáneamente por usuario o clave de API en una misma instancia de servidor. Los sockets de suplantación de un administrador computan para dicho administrador. El siguiente intento de inicio de sesión se rechazará con `TOO_MANY_SOCKETS` y el socket se cerrará (4002); el SDK continuará reintentando para conectarse en cuanto se libere otro socket. Debe ser un entero positivo; cualquier otro valor detendrá el servidor al arrancar. Tiene prioridad sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tiempo máximo en milisegundos que un cambio esperará la reconsulta (refetch) que lo distribuye a los suscriptores activos. Espera hasta 300 ms si no hay nuevos cambios, y como máximo este intervalo ante un flujo constante de escrituras. Debe ser un entero positivo; cualquier otro valor detendrá el servidor al arrancar. Tiene prioridad sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tiempo en milisegundos durante el cual puede reutilizarse el total de una suscripción a listados grandes antes de recalcularse; las respuestas que lo reutilizan incluyen `meta.totalAsOf`. Sin definir recalcula el total en cada frame. Tiene prioridad sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | Umbral mínimo del total anterior a partir del cual se aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada frame. Tiene prioridad sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost` o loopback bajo `NODE_ENV=production`. Desactivado por defecto para que un despliegue en producción falle de forma explícita en lugar de conectarse por error a una base de datos inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la fase de validación del esquema y finaliza el proceso sin abrir un socket HTTP, ideal para un Job de migración utilizando la misma imagen y bundle que el servidor final. También genera las tablas que el proceso principal crearía en su primer uso, omitiendo el arranque de crons o colas de trabajo. Un valor vacío equivale a *no definido*, evitando que un `${VARIABLE}` sin sustituir en un docker-compose convierta un despliegue normal en uno de solo migración. Incompatible con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Ruta de archivo. La ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribirá en él, de forma ordenada, todas las modificaciones de esquema realizadas como un script SQL listo para auditar y aplicar con `psql`. No incluye inserciones de datos. Incompatible en procesos que sirvan tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite a procesos automatizados (agentes, pipelines de CI) *aplicar* cambios de esquema mediante `/api/admin/schema`, en lugar de únicamente planificarlos. Desactivado por defecto: la credencial requerida para dicha operación suele ser la misma configurada en variables de integración continua. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo límite de ejecución de una función personalizada antes de abortar la petición. Mismo control que la opción `functionsTimeoutMs`. `0` desactiva el timeout. Si la función declara el suyo propio (`defineFunction(…, { timeoutMs })`), prevalece este último. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Timeout máximo que una función puede declarar para sí misma con `defineFunction(…, { timeoutMs })`, en milisegundos; peticiones que soliciten más recibirán este límite. Debe ser un número positivo; cualquier otro valor se interpretará como sin definir. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no gestionado finalice el proceso en lugar de solo registrarlo. Útil bajo un orquestador que reinicie el contenedor; desactívalo si un reinicio es más perjudicial que una fuga de recursos. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en plataformas detectadas como de escalado a cero (donde un temporizador activado en una instancia inactiva no se ejecutaría en ninguna parte). No altera ningún otro comportamiento: actívalo si garantizas al menos una instancia en ejecución permanente. | — |
| `TRUSTED_PROXY_HOPS` | Cantidad de balanceadores o proxys situados delante de este servidor, permitiendo al limitador de tasa obtener la IP real del cliente desde `X-Forwarded-For`. Valor seguro por defecto `0`: sin proxies intermedios, confiar en dicha cabecera permitiría falsear la identidad del cliente. | `0` |

:::note[El aprovisionamiento al iniciar es aditivo y no es una herramienta de migración]
La fase de arranque se ejecuta de forma desatendida y sin supervisión humana sobre las diferencias generadas, por lo que nunca eliminará columnas, restringirá tipos de datos ni reescribirá tablas. Por esta razón la imagen oficial rechaza
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula diferencias y ejecutaría sin problemas un
`DROP COLUMN`, y el reinicio de un contenedor nunca debe ser capaz de destruir una
columna en producción debido a una simple reprogramación del servicio.

Los cambios destructivos o de reestructuración deben realizarse bajo entornos controlados: mediante `rebase db
generate` + `rebase db migrate`, o con `rebase db push` desde un entorno local o CI,
los cuales simulan el cambio previamente, exigen confirmación ante operaciones destructivas y
permiten generar una copia de seguridad previa.
:::

### Despliegues divididos

Es posible arrancar la misma imagen y el mismo bundle en múltiples procesos independientes, cada uno atendiendo
una parte distinta del proyecto. Se detallan aquí brevemente dado el propósito exhaustivo de esta página; la explicación
completa de lo que cada combinación *monta y gestiona* (y qué combinaciones son incompatibles) se encuentra en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_ROLE` | Define qué parte atiende este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir se deriva del rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta los workers de colas de tareas. Sin definir se deriva del rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Atiende únicamente las funciones personalizadas especificadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atiende todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al que el proceso API redirige una petición de función que no atiende directamente. En un `worker`, destino al que se envían sus propias llamadas a `rebase.functions`. Debe ser una URL `http(s)`. | — |

### Superficie MCP

Endpoint opcional de Model Context Protocol en `/mcp`, permitiendo a clientes de IA consultar
y modificar datos de este proyecto **actuando como el usuario autenticado**. Desactivado a menos que se defina explícitamente y, a diferencia de otras superficies, ningún `REBASE_ROLE` lo activa automáticamente: los roles configuran la distribución de procesos, mientras que esta opción otorga credenciales a
software de terceros, decisión que debe tomar un operador humano en lugar de heredarse según el rol del contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Habilita la superficie MCP. Requiere configurar `REBASE_PUBLIC_URL`; sin ella, la superficie no se iniciará y lo notificará en el registro de arranque. | `false` |
| `REBASE_PUBLIC_URL` | Origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede inferirlo: obtener el origen desde la cabecera `Host` permitiría que el emisor de los tokens y la audiencia con la que se validan fueran manipulados por el cliente. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista personalizada de la MCP App del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), provista a Claude en lugar de la vista genérica para renderizar tus propias vistas, campos y acciones. Sin ella, el backend buscará junto al frontend servido. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Habilita el registro dinámico de clientes OAuth (RFC 7591), permitiendo la autoinscripción de clientes. Cambia a `false` para requerir el registro previo de clientes. | `true` |

### Edición de esquemas en vivo desde un bundle

Desactivado a menos que se defina `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado carece
del código fuente de `backend/schema` para su edición; al definir estas variables, el editor de esquemas
consulta el código fuente desde el repositorio, envía un commit con cada cambio y ejecuta el DDL resultante en
esta base de datos. Solo para administradores, y aplicado por un operador humano a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Indicar un repositorio sin
credenciales válidas impedirá el arranque. Consulta
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositorio de GitHub donde se registrarán los cambios de esquema, en formato `propietario/nombre`. Al definirlo se activa la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Rama en la que se aplicará el commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Ubicación de `backend/schema` dentro de dicho repositorio, relativa a la raíz. Rutas que apunten fuera del repositorio impedirán el arranque, al igual que el uso de la obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token con permisos granulares de lectura y escritura sobre el contenido del repositorio. Configura esta opción o las tres variables `_GITHUB_APP_*`, pero no ambas simultáneamente. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de una GitHub App para autenticar los commits como aplicación en lugar de usar un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalación de la aplicación en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clave privada de la aplicación: en formato PEM, PEM con saltos de línea escapados, o base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expresión cron para programar copias de seguridad periódicas. Sin definir desactiva los respaldos automáticos. | — |
| `BACKUP_DESTINATION` | Ruta local o una URL en formato `s3://bucket/prefix` o `gs://bucket/prefix`. Obligatoria junto a `BACKUP_SCHEDULE`, el cual no se ejecutará sin ella. `rebase db backup` recurre a `./backups` en el directorio de ejecución si no se define. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días de antigüedad. Sin definir o `0` conserva todos los respaldos. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos los N respaldos más recientes, independientemente del periodo de retención. | — |
| `PG_DUMP_PATH` | Ruta al binario `pg_dump` alternativo (debe ser igual o superior a la versión principal del servidor). | — |
| `PG_RESTORE_PATH` | Ruta al binario `pg_restore` alternativo. | — |
| `PSQL_PATH` | Ruta al binario `psql` utilizado por `rebase db restore --clean` para ejecutar la restauración dentro de una única transacción. | — |
| `PG_DUMPALL_PATH` | Ubicación de `pg_dumpall` cuando no se encuentra en el `PATH`. Sin este binario (y sin las herramientas de cliente de PostgreSQL instaladas), el respaldo de configuraciones globales fallará solicitando esta variable. | — |

La imagen de runtime oficial (`rebasepro/server`) incluye las herramientas de cliente
de PostgreSQL 18, permitiendo ejecutar copias de seguridad programadas contra cualquier servidor hasta Postgres 18.
Fuera de este contenedor, deberán instalarse manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos y datos confidenciales (PII). Utiliza siempre destinos privados
con cifrado en reposo.

### Entrega del bundle

Un despliegue gestionado no incluye su código dentro de la imagen: el runtime descarga el
bundle durante el arranque. Estas variables definen el origen y método de descarga.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. La define `rebase start` localmente. | — |
| `REBASE_BUNDLE_URL` | Dirección para descargar el archivo del bundle cuando no existe uno local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para autorizar la descarga. Trátala como un secreto: autoriza al inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directorio donde se extrae el bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime pone a disposición del bundle, además de los declarados por este. | — |

### Vinculaciones de recursos (Resource bindings)

Cada base de datos, bucket y topic que un proyecto declare en `backend/resources.ts` se
vincula mediante variables de entorno nombradas a partir de él. Los nombres base se muestran a continuación;
un recurso adicional añade `__` y su identificador en mayúsculas (por ejemplo, un bucket llamado
`media` leerá `S3_BUCKET__MEDIA`). El comando `rebase status`
imprime, para cada recurso,
la variable exacta que consulta y si se encuentra configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_DRIVER` | Paquete npm que implementa el controlador de la fuente de datos si no se utiliza el de Postgres por defecto. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### El entorno propio de la CLI

Leído por el comando `rebase`, no por el servidor. Ninguna de estas variables afecta al despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Dirección a la que comandos como `rebase api-keys`, `rebase storage` y `rebase auth reset-password` envían la clave de servicio, ya sea en la shell o en el archivo `.env`. Configúrala cuando el servidor no se ejecute mediante `rebase dev` en este proyecto: `rebase start`, un contenedor, u otro host. Si no se define, emplean la dirección guardada por `rebase dev` mientras dicho servidor esté en marcha, omitiendo el envío si está detenido. | — |
| `REBASE_SERVICE_KEY` | Clave de servicio para autenticar dichos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Nombre anterior para dicha clave. Si se define en `.env`, `rebase api-keys` y `rebase storage` la leerán en sustitución de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Ruta al archivo `.env` alternativo que la CLI debe leer y modificar. | — |
| `REBASE_ROOT_RULES` | El valor `0` impide que `rebase init` y `rebase skills install` escriban las reglas del proyecto en los archivos `CLAUDE.md` y `AGENTS.md` de la raíz del repositorio, útil si gestionas manualmente dichos archivos. | on |
| `REBASE_CLOUD_URL` | Dirección del plano de control con el que interactúa `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Cuenta con la que `rebase cloud login` iniciará sesión de forma automática, sin solicitarla interactivamente. | — |
| `REBASE_CLOUD_PASSWORD` | Contraseña correspondiente, permitiendo a un gestor de secretos suministrarla sin exponerla en el historial de la shell. | — |
| `REBASE_TOKEN` | Token generado con `rebase cloud tokens create`. Al configurarlo, todas las operaciones de `rebase cloud` se autenticarán con él omitiendo la sesión local de `rebase cloud login`, sin leer ni modificar las credenciales guardadas. En un directorio vinculado mediante `rebase cloud init --claim`, se ignorará en favor del token propio del proyecto si no cuenta con alcance sobre el mismo. Es la vía estándar para ejecutar `rebase cloud` en CI; consulta [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo transmite a la CLI que invocan sus herramientas en la nube, y nunca lo envía a la aplicación (usa `REBASE_API_TOKEN` para ese propósito). | — |
| `REBASE_DEBUG` | `1` muestra el detalle del error subyacente y de la petición en lugar de un mensaje resumido. El primer parámetro a activar si un comando de `rebase cloud` falla sin suficiente información. | — |
| `REBASE_ATLAS_DEV_URL` | Base de datos vacía contra la que planifican `rebase db push`, `db generate` y `db migrate`, en lugar de crear la base `<db>_dev_diff` junto a `DATABASE_URL`. Rebase no creará ni eliminará una base de datos indicada aquí, y rechazará una idéntica a `DATABASE_URL`. Con la base de datos de desarrollo gestionada, la CLI utiliza una instancia propia temporal en memoria de PGlite. Configúrala si no dispones del permiso `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no iniciará ninguna base de datos ni aprovisionará nada (debes proporcionar la tuya propia). Equivalente a la opción `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, el cual `rebase dev` deduce normalmente de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tiempo de espera en milisegundos de `rebase dev` para que el backend informe que está listo antes de advertir que no ha iniciado. `0` desactiva este aviso. | `30000` |
| `DATABASE_PASSWORD` | Contraseña que `rebase dev --docker` incorpora en la cadena de conexión generada desde `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convención estándar entre herramientas. Con cualquier valor distinto de `0`, la CLI desactiva el envío de telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Misma función, específica para Rebase. No requiere la existencia de archivos, siendo la opción indicada para CI o entornos de contenedores. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint de destino para la telemetría, utilizado con colectores autohospedados. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` impide que la CLI consulte una vez al día en segundo plano el registro npm (o `npm_config_registry`) sobre las etiquetas dist de `@rebasepro/cli`, ocultando el aviso "Rebase X is out; this CLI is Y" que muestran los comandos en stderr excepto `rebase upgrade`. La respuesta se guarda en `~/.rebase/release-check.json`, sin enviar ninguna otra información en la petición. Desactivado por defecto en entornos de CI; `NO_UPDATE_NOTIFIER` produce el mismo efecto. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Variable interna que la CLI define en los subprocesos que genera para asegurar que el aviso "Rebase X is out" se imprima una sola vez. Definirla manualmente oculta el aviso en ese proceso, al igual que `REBASE_NO_UPDATE_CHECK`. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY` se
generan automáticamente fuera de producción para facilitar el inicio sin configuraciones previas.

Dichos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y se ignoran en git junto a ellos. Anteriormente se
regeneraban en cada reinicio, lo que provocaba el cierre de sesión en tu
propia aplicación y la invalidación de cualquier clave de API recién creada.

- Define cualquiera de las variables explícitamente y se utilizará tu valor; nada se guardará ni se leerá de la caché.
- Redirige la caché a otra ubicación mediante `REBASE_DEV_SECRETS_FILE` (una ruta de archivo, siendo
  la única variable de esta sección pensada para configurarse manualmente).
- Elimina el archivo para rotar ambos secretos. El siguiente arranque generará uno nuevo.
- Si no es posible escribir el archivo (por ejemplo, en un contenedor de solo lectura), el servidor
  iniciará igualmente utilizando un secreto efímero, tal y como funcionaba anteriormente.

Nada se guarda en caché en producción ni bajo un entorno de pruebas. En producción tampoco
se genera ningún valor: un arranque sin `JWT_SECRET` fallará indicando la variable, y
este comportamiento no cambia:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de configuración del backend

El objeto `RebaseBackendConfig` suministrado a `initializeRebaseBackend()` ofrece control programático:

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
prescindiendo de `app`, `server` y `basePath` y requiriendo obligatoriamente `provision`, permiten construir un
backend que no atiende tráfico hasta que decidas montarlo: `createRebaseBackend`. Consulta
[Integración en servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

`basePath` desplaza todas las rutas de la API, por lo que el cliente debe configurarse en consecuencia;
de lo contrario, seguirá consultando en `/api/...` y obtendrá respuestas 404 en todas las peticiones:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración adopta esta configuración directamente del cliente suministrado; no requiere
ningún ajuste adicional. Si construyes URLs de petición manualmente, resuélvelas a partir del cliente en
lugar de escribir `/api` directamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Resolución de problemas

### Permiso denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista en hoja de cálculo del CMS cargue los datos sin problemas.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del Editor SQL alternando temporalmente el rol en la base de datos para que coincida con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas autenticación personalizada donde los roles solo existen en tablas de datos y no como roles reales de PostgreSQL, el cambio de rol falla o faltan permisos en la base de datos. La vista de datos tipo hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión por defecto y no se ve afectada por esto.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` en la configuración `.env` de tu backend. Esto fuerza a Rebase a ejecutar las consultas del Editor SQL utilizando los privilegios del propietario de la conexión (habitualmente un superusuario/owner). El Editor SQL indicará, sobre los resultados, que se leyeron con los privilegios del propietario de la conexión y deshabilitará el selector de roles.

### Error al obtener el esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol de esquema o el Editor SQL muestra el error `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios de administrador para consultar los catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se suministra `adminConnectionString` al inicializador (bootstrapper) o se redefine `getAdmin()` para devolver `undefined`, estas operaciones no podrán realizarse.
* **Solución:** Asegúrate de configurar `adminConnectionString` durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Pasos siguientes

- **[Despliegue](/docs/getting-started/deployment)** — Guía para despliegues en producción
- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
