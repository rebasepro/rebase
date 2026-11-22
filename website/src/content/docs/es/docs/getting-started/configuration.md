---
sourceHash: 21a2078200ddc8c0
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algo requerido o está mal formado (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar y nombra la variable.
>
> La ubicación del esquema depende de cómo ejecute el backend. Un proyecto iniciado por
> el runtime (`rebase dev`, `rebase start`, la imagen publicada) utiliza el
> esquema del runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas siguientes. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> tiene un `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede agregar sus propias
> variables tipadas allí.

### Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Requerido en todos los demás entornos. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utilice una cadena aleatoria segura (mínimo 32 caracteres). **Requerido en producción** (generado automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **En una base de datos administrada, `sslmode=require` puede no significar lo que parece.**
>
> Para `psql` y cualquier herramienta de libpq, `require` significa "cifrado, certificado no
> verificado". El controlador de Node sobre el que se ejecuta Rebase lo interpreta como `verify-full`, por lo que una
> base de datos cuyo certificado no haya sido firmado por una autoridad pública (algo común en Postgres
> administrado) rechaza el runtime con `self-signed certificate`, mientras que `psql`
> se conecta con la misma URL. El runtime y los comandos de `rebase db` se detienen con un
> mensaje que indica esto.
>
> Elija una opción:
>
> - **`sslmode=no-verify`** — cifrado, no verificado: lo que `require` significa para
>   libpq. Es una variante de escritura de node-postgres de la que carece libpq, por lo que `psql`, `pg_dump`
>   y Atlas la rechazan con `invalid sslmode value: "no-verify"`. Los comandos propios de Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) se la pasan
>   como `sslmode=require`, por lo que funcionan con la URL tal como está configurada; para
>   `psql` manual, sustitúyalo por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra el
>   certificado de la CA del proveedor. Lo mismo para todas las herramientas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido por la propia advertencia del controlador de Node,
> también funciona para el runtime; los comandos de Rebase descartan `uselibpqcompat`
> antes de pasar la URL a las herramientas de libpq, las cuales lo rechazan.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Establezca esto solo en desarrollo** — consulte más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deje `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API es el propio origen de la página y el cliente lo resuelve de esa manera por sí mismo.
>
> Integrar una URL absoluta en un bundle de producción funciona bien hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga entonces la página desde
> `example.com` y llama a la API en `example.rebase.website`, que es
> de origen cruzado (cross-origin), por lo que cada solicitud falla la verificación previa (preflight). Permitir el origen en CORS
> **no** lo soluciona tampoco — la cookie de actualización (refresh cookie) es `SameSite=Lax` y no
> se envía cross-site, por lo que limpiaría los errores de consola pero seguiría teniendo una
> autenticación rota. Sin definir, cada dominio que apunte a la aplicación funciona sin ninguna
> configuración de CORS en absoluto.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de cargar ese archivo — y de lo contrario vincula un puerto derivado de la ruta del proyecto, de modo que varios proyectos puedan ejecutarse a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica el nivel utilizado. | `3001` |
| `LOG_LEVEL` | Nivel de detalle del registro: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia fallida se oculta de forma predeterminada, porque una consulta fallida contiene sus parámetros vinculados (un correo electrónico, un hash de contraseña). Establézcalo en `true` mientras diagnostica un fallo de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Requerido en producción** a menos que se defina `FRONTEND_URL`: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *agrega a* localhost — consulte más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos a nivel de administrador (utilizada para la introspección del esquema y operaciones de administración). La base de datos que nombra no es la que la consola SQL considera actual, ni la que una nueva rama copia por defecto: ambas son la base de datos en la que se encuentra la conexión propia de la aplicación (consulte `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de roles de PostgreSQL en el SQL Editor (útil para autenticación personalizada donde los roles de BD no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, lo nombrará y deshabilitará su selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos a partir de la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en una copia de trabajo [cambiada a una rama](/docs/backend/branching/#cli-integration). Un servidor con ella mantiene el registro de ramas en esa base de datos y copia nuevas ramas de ella por defecto, por lo que el panel de ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El desarrollo permite **localhost, más lo que `CORS_ORIGINS` (o `FRONTEND_URL`)
especifique** — la misma lista que usa producción, agregando localhost en lugar de
sustituirlo. De modo que la variable funciona de la misma manera en ambos entornos, y los
casos que la necesitan en desarrollo son los habituales:

```bash
# Un teléfono en la LAN, la máquina de un colega, un túnel ngrok,
# un puerto redirigido de Codespaces — todos orígenes distintos de localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté en la lista es rechazado, y el rechazo se
registra **una vez por origen** con la línea exacta que lo permitiría. Rechazarlo
no es precaución injustificada: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría que cualquier sitio que visite el desarrollador realice
solicitudes autenticadas contra el servidor de desarrollo con su sesión y lea las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (requerido en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), de modo que cualquiera que posea el JWKS pueda verificar una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o base64 del PEM completo. Sin ella, los tokens permanecen como HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en el encabezado del token y en el JWKS. Cámbielo cada vez que cambie la clave — la rotación depende de que lo antiguo y lo nuevo sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva, por lo que esto rige cuánto tiempo sobrevive una sesión a la **inactividad**. Establezca `400d` para sesiones que superen una ausencia prolongada; los navegadores limitan la cookie de actualización allí. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, independientemente de lo que diga esto: una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en el administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada a través del registro abierto es una cuenta normal, y el administrador se especifica con `REBASE_ADMIN_EMAIL` a continuación o se asigna con la clave de servicio. El archivo `.env.example` del scaffold lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de apagado de emergencia (kill switch). Cierra la ventana de inicio del primer usuario que `ALLOW_REGISTRATION=false` deja abierta deliberadamente fuera de producción, de modo que el registro queda clausurado incluso frente a una base de datos vacía. Combínelo con `REBASE_ADMIN_EMAIL` a continuación, o el despliegue no tendrá forma de producir su primer invocador autenticado. Cada artefacto de despliegue distribuido lo establece. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada al arrancar **mientras la tabla de usuarios aún está vacía** y nunca después. Así es como un despliegue de producción obtiene su administrador: el operador nombra la primera cuenta en lugar de competir contra internet por ella. El arranque advierte cuando la tabla está vacía en producción y esto no está definido. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Al menos 12 caracteres, o se rechazará y la cuenta no se creará. Cámbiela tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque advierte una vez — por lo que rotar `JWT_SECRET` cierra la sesión de todos *y* deja indescifrable cada autenticador registrado. Establezca una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave desde la que se está rotando. Establezca ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, por lo que nadie se queda sin acceso a su propia cuenta a mitad de la rotación. Elimínela una vez que cada secreto haya sido recifrado. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional, y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establezca `false` para una superficie de lectura totalmente pública — RLS sigue aplicando. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se proporciona ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo invocadores autenticados, y nunca devuelve el correo, roles o metadatos del usuario encontrado. Desactivado por defecto: es una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es solo para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` en la cookie de actualización. Seguro por defecto; `AUTH_COOKIE_SECURE=false` para http simple — un despliegue en una dirección LAN donde el navegador de lo contrario descartaría la cookie y la sesión moriría al expirar el token de acceso sin ningún error. Advierte al arrancar. `http://localhost` no lo necesita. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth (validación en backend) | — |
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
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. La `baseUrl` de una instancia autohospedada no se define por variable de entorno — configure GitLab en el bloque `auth` para ello. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple, para inicio de sesión web. Es público y se publica en `GET /auth/config`. Apple no tiene un secreto de cliente estático, porque Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por lo tanto, Apple necesita `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, más esto o `APPLE_BUNDLE_IDS`, y no configura nada sin ellos. | — |
| `APPLE_BUNDLE_IDS` | Identificadores de bundle (bundle IDs) separados por comas de las aplicaciones nativas de iOS/macOS cuyos códigos de Sign in with Apple se aceptan. | — |
| `APPLE_TEAM_ID` | Team ID de desarrollador de Apple, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se aceptan escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API de administrador estática. Omite la autenticación JWT normal para llamadas de servidor a servidor cuando se pasa como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante una rotación de claves. La plataforma la establece al desplegar y no contiene nada secreto. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la barrera de administración acepte un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID del proyecto al que debe equivaler el `aud` de un token de plataforma, para rechazar tokens emitidos para otro proyecto. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Adónde conduce **Continue with Rebase Cloud** en el panel de administración: la página del proyecto en la consola de la plataforma, que autentica a los propietarios del proyecto y regresa. La plataforma lo establece al desplegar junto con los dos anteriores; con ellos, `POST /api/auth/platform-signin` acepta el token de un minuto `auth:admin-signin` de la plataforma y abre una sesión de administrador. Sin él, el acceso sigue funcionando desde **Open CMS** en la consola, y la pantalla de inicio de sesión solo lo explica. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde se almacenan los contadores de límite de tasa, para las rutas de autenticación y para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede ver su propio recuento de réplicas, por lo que un despliegue con réplicas debe indicarlo; tres réplicas con el valor por defecto imponen el triple del límite. Cualquier otro valor **se niega a arrancar** en lugar de degradarse, incluyendo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta el flujo de enlace de inicio de sesión sin contraseña. Requiere un servicio de correo electrónico configurado, o el enlace no tendrá a dónde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta el inicio de sesión sin contraseña mediante un código de seis dígitos enviado por correo. Mismo requisito de correo electrónico que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de magic-link o código de correo para una dirección desconocida crea la cuenta, mientras el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Qué hace un token de actualización reproducido después de su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar el inicio de sesión). Cualquier otro valor hace fallar el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite inicio de sesión con contraseña hasta verificar la dirección. Requiere correo; el arranque lo rechaza sin él. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | El secreto del proveedor, utilizado en el servidor para verificar el token que envía el navegador. Requerido una vez que se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas que se van a proteger (por ejemplo `register,login`). Sin definir protege el conjunto por defecto del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila (RLS), por lo que necesita un modelo de acceso]
Las tablas están protegidas por RLS de Postgres. El almacenamiento de objetos no tiene equivalente —
las claves comparten un único espacio de nombres plano — por lo que, con un bucket configurado y sin modelo de acceso,
el servidor **se niega a arrancar en producción**. Debe satisfacerse con exactamente uno de los siguientes:
un hook `storageAuthorize` exportado desde `backend/storage.ts` (lo que incluye
el scaffold), `STORAGE_PUBLIC_READ`, o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` deshabilita el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor: la raíz del proyecto bajo `rebase dev`, `backend/` en un servidor generado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción — solo con un volumen duradero que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de buckets locales nombrados junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales funciona la URL de descarga de un archivo privado — el token que `getSignedUrl()` coloca en ella. Máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo que acepta el origen, en bytes, en cada ruta de subida — `__<KEY>` para un origen nombrado. Si no es un número entero de bytes, rechaza el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de acceso de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo de ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio. Omitir en GCP, donde Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve cada objeto a cualquiera, sin token. Solo para un bucket que realmente sea una CDN pública. Una de las tres formas de satisfacer la comprobación de arranque a continuación. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier invocador autenticado leer, escribir, listar y eliminar todos los objetos. Nombrado `INSECURE` en el objeto de configuración por una razón: solo es defendible en una aplicación para un único inquilino donde se confía en cada cuenta para todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las representaciones de imágenes generadas (cambios de tamaño, conversiones de formato) en lugar de producirlas por solicitud. | `false` |

### Correo electrónico (Opcional)
`MAGIC_LINK_URL`.

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilita conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre para mostrar en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de los correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo por defecto. PNG o JPG absoluto `http(s)` — los clientes eliminan SVG y bloquean URIs `data:`. Sin definir, una aplicación aún llamada `Rebase` recibe el isotipo de Rebase y una renombrada no recibe ninguno |
| `MAGIC_LINK_URL` | Adónde apunta un enlace mágico enviado por correo. A una base se le añade `/auth/magic-link?token=…`; una URL que contenga `{token}` es el enlace completo, para un frontend que no sirva `/auth/magic-link`. Enciérrelo entre comillas en `.env`, donde un `#` sin comillas inicia un comentario: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valor con un hash o una ruta de archivo y sin `{token}` genera una advertencia al arrancar. Sin definir, la base es `FRONTEND_URL` |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos a esperar por una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) necesita una: `LISTEN`/`NOTIFY` no sobrevive a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambios se deshabilitan con una advertencia en lugar de perderse silenciosamente. El [job worker](/docs/backend/jobs) mantiene su `LISTEN` de reactivación en ella también. Rellena el `directConnectionString` del adaptador de Postgres cuando no está configurado. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando especifica otro servidor, las lecturas autenticadas (listas, filas individuales, recuentos, agregados) se atienden allí bajo la misma seguridad a nivel de fila; las escrituras, inicio de sesión, tiempo real, crons, trabajos, la consola SQL y `rebase.sql` se mantienen en el primario. Un lector que acaba de escribir lee del primario durante `REBASE_READ_STICKY_MS`, y todos lo hacen mientras la réplica tenga más retraso que `REBASE_READ_MAX_LAG_MS` o esté fallando. Rellena el `readConnectionString` del adaptador de Postgres cuando no está configurado; hasta la versión 0.28 inclusive, el pool de la réplica se abría y nunca se leía de él. | — |
| `REBASE_READ_STICKY_MS` | Tras una escritura, cuánto tiempo van las lecturas del mismo usuario al primario, para que un guardado seguido de un listado muestre el cambio guardado. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso de la réplica a partir del cual todas las lecturas van al primario. | `1000` |
| `DATABASE_POOLED` | `true` cuando `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. El pool entonces no envía `search_path` ni `statement_timeout` al conectar (el pooler los rechazaría o descartaría) y establece ambos en cada transacción; el arranque otorga al rol de la base de datos un `search_path` predeterminado de `public` para sentencias fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser requerido, y tiempo real, la reactivación del job worker, compilaciones de índices, ramificación (branching) y la consola SQL lo usan. La URL de la réplica se considera también en modo pool. `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Un límite máximo para cada pool en el proceso, aplicado sin importar lo que haya solicitado cada uno. Solo dígitos simples: un valor mal formado se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento del runtime

Leído por el runtime — `rebase dev`, `rebase start` y la imagen del servidor
publicada. Un proyecto que ha hecho eject maneja estas decisiones en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría programada de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule), que informa las tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye una copia, y sin el paquete el arranque se rechaza nombrándolo. `false` mantiene el análisis desactivado en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | El rol de Postgres con el que se ejecutan las solicitudes autenticadas y anónimas. Asigne a cada proyecto en un clúster compartido el suyo propio. Una base de datos registra el rol con el que se ejecuta, y un arranque configurado para otro se niega a iniciar hasta que `rebase db request-role migrate` lo traslade. Consulte [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de solicitud y permite que la conexión cambie a él; `never` deja ambos a su cargo y solo los comprueba. | `auto` |
| `REBASE_RLS_GRANTS` | Qué privilegios concede Rebase al rol de solicitud: `schema` (cada tabla en los esquemas que sirve, más privilegios por defecto), `managed` (solo las tablas que sirve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al rol (o roles) de solicitud, de modo que otros roles que lean las mismas tablas no obtengan nada de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` escribe las políticas que solo el contexto del servidor o un administrador pueden cumplir `TO public`, y ejecuta a los administradores como el rol de solicitud. Por defecto son `TO rebase_admin`, para que las lecturas de usuarios autenticados con ámbito de propietario puedan usar el índice de propietario. Consulte [Solicitudes de administración y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política de referencia de servidor o administrador de cada tabla. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` también establece `request.jwt.claims` y `request.jwt.claim.*`, para que las políticas escritas con `auth.uid()` vean al invocador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Qué hace el arranque cuando otro inicio de sesión puede cambiar al rol de solicitud: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para cada ruta de la API. Debe indicarse lo mismo al cliente — consulte [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos/de administración del bundle desde este proceso. Desactívelo cuando haya una CDN delante. | `true` |
| `REBASE_STUDIO` | Sirve la consola independiente integrada de Rebase Studio en `/_studio` cuando haya un bundle estático de Studio disponible. Establezca `false` para deshabilitar. | `true` |
| `REBASE_STUDIO_DIR` | Directorio que contiene la SPA independiente precompilada de Rebase Studio servida en `/_studio`. Por defecto es `/studio` en la imagen del contenedor. | `/studio` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas comprimidas con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` activa las [notificaciones push](/docs/backend/push-notifications/): las rutas `/api/push`, la tabla `rebase.push_subscriptions` y `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | El par de claves VAPID con el que se firman los mensajes push. Fuera de producción se genera un par y se conserva en `.rebase-dev-secrets.json` si no está definido; en producción las notificaciones push permanecen desactivadas sin ellas. | — |
| `REBASE_VAPID_SUBJECT` | Una dirección `mailto:` o URL `https://` con la que los servicios push puedan contactar. Por defecto es el origen de un `REBASE_PUBLIC_URL` con `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la solicitud, **en bytes** (`10485760`, no `10MB` — un valor que no sea un número rechaza el arranque en lugar de eliminar silenciosamente el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie de OpenAPI. Tres estados. Sin definir, en todos los entornos: `/api/docs` se sirve a los clientes a los que `GET /api/schema/tables` describe tablas, cada uno con el documento de las tablas descritas, y no hay interfaz de Swagger. `true` publica el documento completo para todos, con la **interfaz** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento tras la barrera de administración. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` al encabezado `Strict-Transport-Security`, de modo que los navegadores rechacen HTTP simple en cada subdominio del host durante seis meses — incluidos hosts a los que este proceso no sirve. Actívelo solo cuando cada subdominio del dominio sea exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` rechaza el arranque. Consulte [Encabezados de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no está definido, deja el endpoint abierto a cualquiera que pueda alcanzar el puerto — adecuado en una red privada, no en una pública, y los registros de arranque lo indican. | — |
| `REBASE_MIGRATE_ON_BOOT` | Lo que el runtime puede hacer con el esquema de las tablas al arrancar. `ensure` (el valor por defecto en todas partes, incluida producción) ejecuta la pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, nunca elimina ni reescribe ninguno. `none` no altera el esquema de las tablas declaradas, pero las tablas del propio framework (autenticación, claves de API, trabajos, cron) siguen creándose y manteniéndose actualizadas; `REBASE_PROVISION=false` desactiva esas también. La imagen publicada solo acepta estas dos y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes) exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe establecer `none` o rehusará el arranque. | `ensure` |
| `REBASE_PROVISION` | `false` hace que el runtime no cambie nada en su base de datos: ninguna tabla, columna, índice, función, disparador, política, rol o privilegio, ni al arrancar ni después, incluidos los del propio framework. En su lugar, reporta por nombre lo que falta. Para una base de datos que solo su proceso de cambios puede modificar. Consulte [Cuando solo su proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar cuando la base de datos fue aprovisionada por última vez desde un conjunto de tablas diferente de aquel para el que se construyó este proceso. Sin definir (o cualquier valor distinto de `true`/`1`) emite una advertencia en su lugar. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Se niega a arrancar cuando un archivo de función o de cron arroja un error o no se puede analizar al importar, indicando cada archivo y la razón, para que un despliegue continuo (rolling deploy) deje la versión anterior sirviendo. Un reinicio también se sujeta a esto. Sin definir (o cualquier valor distinto de `true`) omite el archivo y sirve el resto. Un archivo que se importa limpiamente y no exporta ninguna función o trabajo siempre se omite, no se rechaza. | skip |
| `REALTIME_CDC` | Captura de datos modificados (CDC) a nivel de base de datos: `auto` (lee cambios desde el WAL donde la base de datos lo permita; de lo contrario usa disparadores; de lo contrario recurre al nivel de aplicación, registrando cada retroceso como info), `trigger` (lo fuerza, advierte si no es posible), `wal` (lee cambios desde el registro write-ahead en lugar de disparadores; requiere `wal_level=logical` y un rol con permisos de replicación, retrocede a `trigger` si no es así), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión y presencia: `memory` o `postgres`. Se ignora cuando se pasa un transporte construido a `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un socket en tiempo real; la siguiente se rechaza con `TOO_MANY_SUBSCRIPTIONS`. Un número entero positivo — cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cuántos sockets en tiempo real puede mantener abiertos un usuario, o una clave de API, en una instancia del servidor. Los sockets de suplantación de un administrador cuentan para el administrador. El inicio de sesión del siguiente se rechaza con `TOO_MANY_SOCKETS` y se cierra el socket (4002); el SDK continúa reintentando, de modo que ingresa cuando otro se cierra. Un número entero positivo — cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | El tiempo máximo que espera un cambio para la reobtención (refetch) que lo entrega a los suscriptores activos, en ms. Una reobtención espera 300 ms si no hay cambios, y como máximo este tiempo bajo un flujo constante de escrituras. Un número entero positivo — cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tiempo que puede reutilizarse el total de una suscripción a una lista grande antes de volver a contarse, en ms; los fotogramas que lo reutilizan llevan `meta.totalAsOf`. Sin definir, cada fotograma cuenta. Prevalece sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | El último total más pequeño al que se aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada fotograma. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/bucle invertido (loopback) bajo `NODE_ENV=production`. Desactivado por defecto, para que un arranque en producción falle de forma visible en lugar de conectarse a una base de datos que no existe. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada de esquema y sale sin abrir un socket — el comportamiento esperado de un Job de migración, a partir de la misma imagen y el mismo bundle que el servidor que le sigue. También crea las tablas que un proceso de servicio crearía en su primer uso, y no inicia ningún cron ni cola de trabajos. Un valor vacío equivale a *sin definir*, por lo que un `${SOMETHING}` sin sustituir en un archivo de compose no puede convertir un despliegue ordinario en uno que migra y se niega a servir. Incompatible con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Una ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribe en ella cada cambio de esquema que realizó, en orden, como un script SQL para revisar y aplicar con `psql`. Las filas escritas no se incluyen. Se rechaza en un proceso que sirve peticiones. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina — un agente, un job de CI — *aplique* un cambio de esquema a través de `/api/admin/schema`, no solo que lo planifique. Desactivado a menos que se solicite: la credencial que realizaría dicho cambio es la que más probablemente se encuentre en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto tiempo puede ejecutarse una función personalizada antes de que se anule su solicitud. Mismo control que la opción `functionsTimeoutMs`. `0` lo desactiva. Una función que declare el suyo propio (`defineFunction(…, { timeoutMs })`) usa ese en su lugar. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | El tiempo de espera máximo que una función puede declarar para sí misma con `defineFunction(…, { timeoutMs })`, en ms; una que solicite más recibe este valor. Un número positivo; cualquier otro valor se interpreta como no definido. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que una promesa rechazada no controlada finalice el proceso en lugar de registrarla en el log. Activado bajo un orquestador que reiniciará el proceso; desactivado donde un reinicio sea peor que una fuga de memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en una plataforma que el runtime detecta como escala a cero, donde un temporizador que se dispara en una instancia inactiva no se dispara en ninguna instancia. No cambia nada más: actívelo cuando mantenga al menos una instancia en ejecución. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se interponen delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente desde `X-Forwarded-For`. Valor por defecto a prueba de fallos `0`: sin proxy, confiar en el encabezado permitiría a cualquier cliente falsificar su identidad. | `0` |

:::note[El aprovisionamiento de arranque es aditivo y no es una herramienta de migración]
La pasada de arranque se ejecuta de forma desatendida sin nadie revisando una diferencia (diff), por lo que nunca eliminará
una columna, reducirá un tipo o reescribirá una tabla. Es también por eso que la imagen rechaza
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y ejecutará gustosamente
`DROP COLUMN`, y el reinicio de un contenedor nunca debe ser capaz de destruir una
columna de producción como efecto secundario de una reprogramación.

Los cambios destructivos o de reestructuración se mantienen donde puedan ser revisados: `rebase db
generate` + `rebase db migrate`, o `rebase db push` desde un checkout o CI,
lo cual prueba el cambio (dry-run), rechaza los destructivos sin confirmación y
puede realizar una copia de seguridad primero.
:::

### Despliegues divididos

Una sola imagen y un único bundle se pueden iniciar varias veces, sirviendo cada uno
una parte diferente del proyecto. Se incluye una línea por cada uno aquí, ya que esta página busca
listar todas las variables; lo que cada combinación *monta y posee* — y qué
combinaciones se niegan a arrancar — se encuentra en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir sigue el rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta los workers de colas de trabajos. Sin definir sigue el rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve solo las funciones personalizadas especificadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Adónde reenvía el proceso de API una solicitud de función que no sirve él mismo. En un `worker`, adónde van sus propias llamadas `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Un endpoint opcional de Model Context Protocol en `/mcp`, para que un cliente de IA pueda leer
y escribir en este proyecto **como el usuario autenticado**. Desactivado a menos que se configure, y — a diferencia
de cualquier otra superficie — ningún `REBASE_ROLE` lo activa: los otros describen la
forma de un proceso, mientras que este es una decisión de entregar credenciales a software de
terceros, y debe ser tomada por una persona en lugar de heredarse del
título de trabajo de un contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella la superficie se niega a montarse y lo indica en el registro de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen externamente accesible de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede derivarlo — tomar el origen del encabezado `Host` haría que la identidad del emisor y la audiencia contra la que se verifican sus propios tokens fuera un valor suministrado por el invocador. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista de la aplicación MCP propia del proyecto (`rebase-view.html`, escrita por `rebaseMcpViewPlugin()`), servida a Claude en lugar de la vista genérica para que sus vistas, campos y acciones personalizados sean lo que se renderiza. Sin ella, el backend busca junto al frontend que sirve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse por sí mismo. Establezca en `false` para requerir que los clientes se registren por adelantado. | `true` |

### Edición de esquemas en vivo desde un bundle

Desactivado a menos que se configure `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado no tiene
el código fuente de `backend/schema` para editar, por lo que con estas variables configuradas el editor de esquemas lee
el código fuente desde el repositorio, hace un commit de cada cambio y ejecuta su DDL en
esta base de datos. Solo para administradores, y aplicado por una persona a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Un repositorio especificado
sin credenciales utilizables se niega a arrancar. Consulte
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub en el que se confirmarán (commit) los cambios de esquema, en formato `owner/name`. Configurarlo es lo que activa la función. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se aplica el commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Dónde reside `backend/schema` en ese repositorio, relativo al repo. Una ruta que salga del repositorio se niega a arrancar, y lo mismo ocurre con la variable obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token de grano fino con acceso de lectura y escritura al contenido del repositorio. Configure esta o las tres variables `_GITHUB_APP_*`, no ambas. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | El ID de una GitHub App, para hacer commits como la aplicación en lugar de usar un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | La instalación de la app en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clave privada de la app: PEM, PEM con saltos de línea escapados, o base64. | — |

### Copias de seguridad

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir significa que las copias programadas están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requerido con `BACKUP_SCHEDULE`, que se niega a ejecutarse sin él. `rebase db backup` retrocede a `./backups` en la ubicación donde se ejecutó. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N de las copias de seguridad más recientes, sin importar lo que indique la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe el binario `pg_dump` — debe ser de la versión mayor del servidor o más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe el binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe el binario `psql` que ejecuta `rebase db restore --clean` para que la restauración sea una sola transacción. | — |
| `PG_DUMPALL_PATH` | Dónde reside `pg_dumpall`, cuando no está en el `PATH`. Sin él — y sin las herramientas de cliente de PostgreSQL instaladas — una copia de seguridad de variables globales falla con un error que nombra esta variable. | — |

La imagen oficial del runtime (`rebasepro/server`) incluye las herramientas de cliente de PostgreSQL 18,
por lo que una copia de seguridad programada se ejecuta dentro de ella contra cualquier servidor hasta Postgres 18.
Fuera de la imagen, instálelas usted mismo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos y datos de identificación personal (PII). Utilice un destino privado con
cifrado en reposo.

### Entrega de bundles

Un despliegue administrado no transporta su código en la imagen: el runtime obtiene un
bundle al arrancar. Estas variables deciden cuál y cómo.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Lo que `rebase start` establece localmente. | — |
| `REBASE_BUNDLE_URL` | Desde dónde descargar el archivo del bundle, cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial Bearer para esa descarga. Trátela como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe ser escribible y debe persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los que declara por sí misma. | — |

### Enlaces de recursos

Cada base de datos, bucket y topic que un proyecto declara en `backend/resources.ts` se
vincula mediante variables de entorno nombradas a partir de él. Los nombres base están a continuación; un
recurso no predeterminado añade `__` y su clave en mayúsculas, por lo que un bucket llamado
`media` lee `S3_BUCKET__MEDIA`. `rebase status`
imprime, por recurso,
la variable exacta que está leyendo y si está configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | El paquete npm que implementa el controlador de una fuente de datos, cuando no es el de Postgres predeterminado. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### Entorno propio de la CLI

Leído por `rebase`, no por el servidor. Nada de esto afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | Adónde envían la clave de servicio `rebase api-keys`, `rebase storage` y `rebase auth reset-password`, en la shell o en `.env`. Establézcalo cuando el servidor se ejecute de otra forma que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Sin definir, usan el servidor que `rebase dev` registró mientras ese servidor esté en ejecución, y no envían nada cuando no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican esos comandos, leída desde `.env`: la misma variable que lee el servidor (consulte más arriba). | — |
| `SERVICE_KEY` | Un nombre anterior para esa clave. Cuando `.env` lo define, `rebase api-keys` y `rebase storage` lo leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` evita que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` de la raíz del repositorio, para una raíz cuyos archivos de agentes se gestionen manualmente. | on |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla de forma interactiva. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda proporcionarla sin que llegue al historial de la shell. | — |
| `REBASE_TOKEN` | Un token obtenido con `rebase cloud tokens create`. Configurado, cada comando de `rebase cloud` se autentica con él en lugar de la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión almacenada. En un directorio vinculado mediante `rebase cloud init --claim`, se aparta en favor del token propio de ese proyecto cuando no tiene alcance sobre el proyecto. La forma de ejecutar `rebase cloud` en CI — consulte [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI que generan sus herramientas cloud, y nunca lo envía a la aplicación: configure `REBASE_API_TOKEN` para eso. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y el detalle de la solicitud en lugar del mensaje breve. Lo primero que se debe configurar cuando un comando de `rebase cloud` falla sin dar información útil. | — |
| `REBASE_ATLAS_DEV_URL` | La base de datos vacía contra la que planifican `rebase db push`, `db generate` y `db migrate`, en lugar de la base de datos `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no crea ni elimina una base de datos nombrada aquí, y rechaza una equivalente a `DATABASE_URL`. En la base de datos de desarrollo administrada, la CLI la establece en un PGlite descartable en memoria propio. Configúrelo donde no se disponga de permisos para `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada — usted aporta la suya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que de otro modo `rebase dev` deduce de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend se anuncie antes de indicar que no ha iniciado. `0` deshabilita el informe. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` coloca en la cadena de conexión que deduce de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convención compartida entre herramientas. Establézcalo en cualquier valor distinto de `0` y la CLI no enviará telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No necesita ningún archivo, por lo que es la opción ideal para usar en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Adónde se envía la telemetría, para un recolector autohospedado. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Este y `REBASE_SERVICE_KEY` se
generan automáticamente fuera de ella, para que pueda comenzar sin configurar nada.

Estos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url` e ignorados en git junto a ellos. Anteriormente, se
regeneraban en cada arranque — por lo que reiniciar el servidor de desarrollo cerraba la sesión en
su propia aplicación e invalidaba cualquier clave de API recién creada.

- Configure cualquiera de las variables explícitamente y se usará la suya; nada se almacenará en caché ni se leerá.
- Apunte la caché a otra ubicación con `REBASE_DEV_SECRETS_FILE` — una ruta, y la
  única variable de esta sección que configuraría deliberadamente.
- Elimine el archivo para rotar ambos secretos. El siguiente arranque generará uno nuevo.
- Si el archivo no se puede escribir — por ejemplo, en un contenedor de solo lectura —, el servidor inicia
  de todos modos con un secreto efímero, exactamente como solía hacerlo.

Nada se guarda en caché en producción ni bajo un ejecutor de pruebas. En producción tampoco
se genera nada: un arranque sin `JWT_SECRET` falla, indicando la variable, y
eso no ha cambiado:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de configuración del backend

El `RebaseBackendConfig` pasado a `initializeRebaseBackend()` proporciona control programático:

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
sin `app`, `server` y `basePath` y con un `provision` requerido, construyen un
backend que no sirve nada hasta que usted lo monte: `createRebaseBackend`. Consulte
[Integración de servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

`basePath` traslada cada ruta de la API, por lo que el cliente debe configurarse en consecuencia —
de lo contrario seguirá solicitando `/api/...` y obtendrá un 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma esto del cliente que se le proporcione; nada más necesita
configuración. Si construye una URL de solicitud manualmente, compóngala desde el cliente en lugar
de escribir `/api` directamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista de hoja de cálculo del CMS carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del editor SQL cambiando temporalmente de rol de base de datos para que coincida con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utiliza una autenticación personalizada donde los roles solo existen en tablas de la base de datos en lugar de ser roles reales de PostgreSQL, el cambio de rol falla o faltan los privilegios de base de datos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión predeterminado y omite esto.
* **Solución:** Añada `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de su backend. Esto obliga a Rebase a ejecutar las consultas del editor SQL utilizando los privilegios del propietario de la conexión (normalmente un superusuario/owner). El editor SQL indicará entonces, sobre los resultados, que fueron leídos como el propietario de la conexión, y deshabilitará su selector de roles.

### Error al obtener el esquema en el editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol de esquema, o el editor SQL arroja `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se proporciona `adminConnectionString` al inicializador de arranque (bootstrapper), o se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
* **Solución:** Asegúrese de que `adminConnectionString` esté configurado durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Descripción general del backend](/docs/backend)** — Referencia completa de configuración del backend
