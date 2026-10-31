---
sourceHash: ec6f07e74d4a291d
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algo obligatorio o está mal formado (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime — `rebase dev`, `rebase start`, la imagen publicada — utiliza el
> esquema que pertenece al runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas siguientes. Un proyecto que haya ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede agregar allí
> sus propias variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Usa una cadena aleatoria segura (mínimo 32 caracteres). **Requerida en producción** (se genera automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis propia de node-postgres, no de libpq.**
>
> Rebase y el controlador de Node la aceptan: cifra, pero no verifica el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no lo hacen, y no se
> degradan gradualmente: se niegan a iniciar con `invalid sslmode value: "no-verify"`.
>
> Los propios comandos de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben a la equivalente `sslmode=require` antes de invocar la shell,
> por lo que funcionan con la URL tal como está configurada. Usar `psql` manualmente no
> lo hace; sustitúyela por `sslmode=require` allí, que cifra sin verificar exactamente
> de la misma manera.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Configura esto solo en desarrollo**; consulta a continuación. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend son orígenes separados, por lo que el
> servidor de desarrollo inyecta esto. En producción, el backend de Rebase sirve la
> SPA, por lo que la API es el propio origen de la página y el cliente la resuelve de
> esa manera por sí mismo.
>
> Integrar una URL absoluta en un bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga entonces
> la página desde `example.com` y llama a la API en `example.rebase.website`, lo cual es
> cross-origin, haciendo que cada solicitud falle en el preflight. Permitir el origen en
> CORS **tampoco** lo soluciona: la cookie de actualización (refresh cookie) es `SameSite=Lax`
> y no se envía entre sitios distintos, por lo que eliminarías los errores de consola pero la
> autenticación seguiría rota. Sin definir, cada dominio que apunte a la aplicación funciona
> sin ninguna configuración de CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de que se cargue ese archivo — y de lo contrario vincula un puerto derivado de la ruta del proyecto, de modo que varios proyectos puedan ejecutarse a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica el nivel que utilizó. | `3001` |
| `LOG_LEVEL` | Verbosidad del registro (logging): `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia que falla se oculta (redacta) por defecto, porque una consulta fallida incluye sus parámetros vinculados (un correo electrónico, un hash de contraseña). Establécelo en `true` al diagnosticar un error de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Requerida en producción** a menos que se defina `FRONTEND_URL`: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *agrega a* localhost — consulta a continuación. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos de nivel administrativo (utilizada para introspección del esquema y operaciones de administración). La base de datos que nombra no es la que la consola SQL considera actual, ni la que copia una nueva rama por defecto: ambas son la base de datos en la que se encuentra la propia conexión de la aplicación (consulta `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de roles de PostgreSQL en el Editor SQL (útil para autenticación personalizada donde los roles de BD no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas a partir de ella por defecto, por lo que el panel de Ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, más lo que especifique `CORS_ORIGINS` (o `FRONTEND_URL`)**
— la misma lista que usa producción, con localhost añadido en lugar de
sustituido. Por lo tanto, la variable funciona de la misma manera en ambos entornos, y los
casos que la necesitan en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Cualquier origen que no sea localhost ni esté en la lista es rechazado, y el rechazo se
registra **una vez por origen** indicando la línea exacta que lo permitiría. Rechazarlo
no es una precaución sin sentido: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría que cualquier sitio que visite el desarrollador realice
solicitudes autenticadas contra el servidor de desarrollo usando su sesión y lea las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (requerido en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso asimétricamente (RS256), de modo que cualquiera que posea el JWKS pueda verificar una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con secuencias de escape `\n`, o base64 del PEM completo. Sin esto, los tokens se mantienen en HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo cada vez que la clave cambie: la rotación depende de que la antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización (refresh token). Deslizante: cada rotación lo renueva, por lo que rige cuánto tiempo sobrevive una sesión a la **inactividad**. Configura `400d` para sesiones que sobrevivan a una larga ausencia; los navegadores limitan la cookie de actualización a ese valor. | `30d` |
| `ALLOW_REGISTRATION` | Permite que nuevos usuarios se registren (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar lo que indique este valor — una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en admin. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se especifica con `REBASE_ADMIN_EMAIL` abajo o se asigna con la clave de servicio. El archivo `.env.example` del scaffold lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de parada de emergencia (kill switch). Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja deliberadamente abierta fuera de producción, cerrando el registro incluso ante una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de producir su primer usuario autenticado. Cada artefacto de despliegue distribuido lo establece. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada al arrancar **mientras la tabla de usuarios aún esté vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador define la primera cuenta en lugar de competir contra internet por ella. El arranque advierte cuando la tabla está vacía en producción y esto no está definido. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Al menos 12 caracteres, o será rechazada y la cuenta no se creará. Cámbiala después del primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` y el arranque advierte una vez — por lo que rotar `JWT_SECRET` cerrará la sesión de todos *y además* dejará cada autenticador registrado indescifrable. Define una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre en MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave desde la que se está rotando. Define ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, evitando que alguien quede bloqueado de su propia cuenta a mitad de la rotación. Elimínala una vez que todos los secretos se hayan vuelto a cifrar. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional, y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establécelo en `false` para una superficie de lectura totalmente pública — RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para emisores autenticados, y nunca devuelve el correo, roles o metadatos del usuario encontrado. Desactivado por defecto: representa una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo sirve para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` en la cookie de actualización. Seguro por defecto; `AUTH_COOKIE_SECURE=false` para http sin cifrar — un despliegue en una dirección LAN donde de otro modo el navegador descartaría la cookie y la sesión moriría al expirar el token de acceso sin mostrar error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. El `baseUrl` de una instancia autohospedada no tiene una variable de entorno correspondiente — configura GitLab en el bloque `auth` para ello. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple. Apple no tiene un secreto de cliente estático — Rebase firma un JWT ES256 de corta duración por intercambio de tokens — por lo que necesita los cuatro valores `APPLE_*` y no configura nada sin ellos. | — |
| `APPLE_TEAM_ID` | Team ID de Apple Developer, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave API estática de administrador. Omite la autenticación JWT normal para llamadas entre servidores cuando se pasa como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la barrera de administración acepte un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto al que debe ser igual el `aud` de un token de plataforma, de modo que se rechace un token emitido para otro proyecto. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa (rate-limit) de autenticación: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede ver su propio conteo de réplicas, por lo que un despliegue con pares debe indicarlo — tres réplicas con el valor por defecto aplican el triple del límite. Cualquier otro valor **se niega a arrancar** en lugar de degradarse, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta el flujo de enlace de inicio de sesión sin contraseña. Requiere un servicio de correo electrónico configurado, o el enlace no tendrá a dónde enviarse. | `false` |
| `AUTH_EMAIL_OTP` | Monta el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo electrónico. Mismo requisito de correo electrónico que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de enlace mágico o código por correo para una dirección desconocida crea la cuenta, siempre que el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Qué ocurre cuando un token de actualización se reutiliza fuera de su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar el inicio de sesión). Cualquier otro valor causa un fallo al arrancar. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite el inicio de sesión con contraseña hasta verificar la dirección. Requiere correo electrónico; el arranque fallará sin él. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Si no se define, no habrá captcha. | — |
| `CAPTCHA_SECRET` | El secreto del proveedor, utilizado en el servidor para verificar el token que envía el navegador. Obligatorio si se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas a proteger (por ejemplo `register,login`). Si no se define, protege el conjunto por defecto del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las colecciones están protegidas por RLS de Postgres. El almacenamiento de objetos
no tiene un equivalente —las claves comparten un único espacio de nombres plano—,
por lo que si hay un bucket configurado sin un modelo de acceso, el servidor
**se negará a arrancar en producción**. Complétalo con exactamente uno de los
siguientes: un hook `storageAuthorize` exportado desde `config/index.ts` (lo que
incluye el scaffold por defecto), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` deshabilita el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor: la raíz del proyecto bajo `rebase dev`, `backend/` en un servidor generado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción — solo con un volumen persistente que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de buckets locales con nombre junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales funciona la URL de descarga de un archivo privado —el token que `getSignedUrl()` inserta en ella. Como máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo que acepta el origen, en bytes, en cada ruta de subida — `__<KEY>` para un origen con nombre. Si no es un número entero de bytes, se negará a arrancar | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo de ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio. Omitir en GCP, donde Workload Identity suministra las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve todos los objetos a cualquiera, sin token. Solo para un bucket que sea genuinamente una CDN pública. Una de las tres formas de satisfacer la validación de arranque descrita arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar cualquier objeto. Nombrado como `INSECURE` en el objeto de configuración por una razón: solo es justificable en una aplicación de un solo inquilino (single-tenant) donde se confía en que todas las cuentas tengan acceso a todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las representaciones (renditions) de imágenes generadas (redimensionamientos, conversiones de formato) en lugar de producirlas por cada solicitud. | `false` |

### Correo electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilita la conexión segura (`true`/`false`) |
| `SMTP_USER` | Nombre de usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos electrónicos del sistema |
| `SMTP_NAME` | Nombre mostrado en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de correo (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo por defecto. PNG o JPG `http(s)` absoluto — los clientes eliminan SVG y bloquean URIs `data:`. Si no se define, una aplicación que aún se llame `Rebase` obtiene el distintivo de Rebase y una con otro nombre no obtiene ninguno |

### Grupo de conexiones de base de datos (Pool)

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Conexiones máximas en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) necesita una: `LISTEN`/`NOTIFY` no sobreviven a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambio se deshabilitan con una advertencia en lugar de perderse en silencio. El [worker de trabajos](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Completa el `directConnectionString` del adaptador de Postgres cuando no está definido. | — |
| `DATABASE_READ_URL` | Réplica de lectura. Las lecturas van allí cuando está configurada y difiere de `DATABASE_URL`; si la conexión falla, todo recurre al primario con una advertencia. Completa el `readConnectionString` del adaptador de Postgres cuando no está configurado; en la versión 0.24 esa opción se ignora. | — |
| `REBASE_DB_POOL_MAX` | Un límite máximo para cada pool en el proceso, aplicado independientemente de lo que haya solicitado cada uno. Solo dígitos numéricos: un valor mal formado se ignora en lugar de serializar el servidor silenciosamente. | — |

### Comportamiento del runtime

Leído por el runtime: `rebase dev`, `rebase start` y la imagen del servidor
publicada. Un proyecto que haya hecho eject toma estas decisiones en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría programada de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule), que reporta tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye una copia, y sin el paquete el arranque se niega, indicándolo. `false` mantiene el escaneo desactivado en este proceso. | — |
| `REBASE_BASE_PATH` | Ruta base para cada ruta de la API. Debe indicarse lo mismo al cliente — consulta [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos/de administración del bundle desde este proceso. Desactívalo cuando haya una CDN delante. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas comprimidas con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Cuerpo máximo de la solicitud, **en bytes** (`10485760`, no `10MB` — un valor que no sea un número se negará a arrancar en lugar de eliminar silenciosamente el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie de OpenAPI. Tres estados: sin definir significa activado en desarrollo, desactivado en producción; `false` desactiva ambos en cualquier entorno. Ten en cuenta que `true` en producción sirve la **especificación** en `/api/docs` pero no la **UI** de Swagger en `/api/swagger` — la interfaz de usuario se restringe de forma independiente según `NODE_ENV`. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` al encabezado `Strict-Transport-Security`, por lo que los navegadores rechazarán HTTP sin cifrar en cada subdominio del host durante seis meses —incluidos los hosts que este proceso no sirve. Actívalo solo cuando cada subdominio del dominio sea exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` se negará a arrancar. Consulta [Encabezados de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, deja el endpoint abierto a cualquiera que pueda alcanzar el puerto —aceptable en una red privada, pero no en una pública, y los registros de arranque lo indican. | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacer el runtime con el esquema de las colecciones al arrancar. `ensure` (el valor por defecto en todas partes, incluida la producción) ejecuta la pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, nunca elimina ni reescribe ninguno. `none` deja intacto el esquema de las colecciones, pero las tablas propias del framework (autenticación, claves API, trabajos, cron) se siguen creando y manteniendo actualizadas; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen publicada solo acepta estas dos opciones y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cada uno de los demás roles debe establecerse en `none` o se negará a arrancar. | `ensure` |
| `REBASE_PROVISION` | `false` hace que el runtime no cambie nada en su base de datos: ninguna tabla, columna, índice, función, disparador, política, rol o privilegio, ni al arrancar ni después, incluidos los propios del framework. En su lugar, reporta por nombre lo que falta. Para una base de datos que solo tu proceso de cambios puede modificar. Consulta [Cuando solo tu proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar cuando la base de datos fue aprovisionada por última vez a partir de un conjunto de colecciones diferente de aquel con el que se compiló este proceso. Si no se define (o ante cualquier valor distinto de `true`/`1`), muestra una advertencia en su lugar. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Se niega a arrancar si un archivo de función o de cron genera un error o no se parsea al importarse, indicando cada archivo y el motivo, de modo que un despliegue progresivo (rolling deploy) mantenga la versión anterior en servicio. Un reinicio también se sujeta a esto. Si no se define (o ante cualquier valor distinto de `true`), se omite el archivo y se sirve el resto. Un archivo que se importa limpiamente y no exporta ninguna función o trabajo siempre se omite, no se rechaza. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (habilitar donde la conexión lo admita, degradarse silenciosamente de lo contrario), `trigger` (forzarlo, advertir si es imposible), `wal` (actualmente se degrada a `trigger`), `off`. Consulta [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión y presencia: `memory` o `postgres`. Se ignora cuando se proporciona un transporte construido a `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un único socket en tiempo real; la siguiente se rechaza con `TOO_MANY_SUBSCRIPTIONS`. Un número entero positivo —cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulta [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cuántos sockets en tiempo real puede mantener abiertos un único usuario, o una clave API, en una instancia de servidor. Los sockets de suplantación de un administrador cuentan contra el administrador. El inicio de sesión del siguiente se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK continúa reintentando, por lo que entra cuando se cierra otro. Un número entero positivo —cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | El tiempo máximo que espera un cambio para la reconsulta que lo entrega a los suscriptores activos, en ms. Una reconsulta espera 300 ms sin un cambio, y como máximo este tiempo bajo un flujo constante de escrituras. Un número entero positivo —cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Cuánto tiempo se puede reutilizar el total de una suscripción de lista grande antes de volver a contarlo, en ms; los fotogramas que lo reutilizan llevan `meta.totalAsOf`. Si no se define, cada fotograma cuenta. Prevalece sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | El total más pequeño al que se aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada fotograma. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback bajo `NODE_ENV=production`. Desactivado, de modo que un arranque en producción falle de forma visible y ruidosa en lugar de conectarse a una base de datos que no existe. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Qué hace el arranque con una clave en tus colecciones que esta versión no lee: `warn`, `error` (se niega a arrancar —útil para activar en CI) u `off`. Solo rige para claves que no *reconoce*, que suelen ser una errata y ocasionalmente metadatos deliberados; una clave que sabe que se ha movido siempre es fatal, porque la funcionalidad configurada estaría silenciosamente ausente de otro modo. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada del esquema y sale sin abrir un socket —la forma que necesita un Job de migración, desde la misma imagen y el mismo bundle que el servidor que le sigue. También crea las tablas que un proceso en servicio crearía en su primer uso, y no inicia ningún cron ni cola de trabajos. Un valor vacío equivale a *sin definir*, por lo que un `${SOMETHING}` sin sustituir en un archivo compose no puede convertir un despliegue normal en uno que migre y se niegue a servir. Se rechaza si se combina con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Una ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribe cada cambio de esquema realizado en ella, en orden, como un script SQL para revisar y aplicar con `psql`. Las filas escritas no se incluyen. Se rechaza en un proceso que sirve peticiones. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina —un agente, un trabajo de CI— *aplique* un cambio de esquema a través de `/api/admin/schema`, y no solo planificarlo. Desactivado a menos que se solicite: la credencial que realizaría dicho cambio es la que con mayor probabilidad reside en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto tiempo puede ejecutarse una función personalizada antes de que se aborte su solicitud. El mismo ajuste que la opción `functionsTimeoutMs`. `0` desactiva el límite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado termine el proceso en lugar de solo registrarlo. Activado bajo un orquestador que reiniciará el contenedor; desactivado donde un reinicio sea peor que una fuga de memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene en ejecución el programador de cron en una plataforma que el runtime de otro modo detectaría como de escalado a cero, donde un temporizador que se dispara en una instancia inactiva no se dispara en ninguna. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente desde `X-Forwarded-For`. Valor seguro por defecto `0`: sin proxy, confiar en el encabezado permitiría a cualquier cliente falsificar una identidad. | `0` |

:::note[El aprovisionamiento al arrancar es aditivo y no es una herramienta de migración]
La pasada de arranque se ejecuta de forma desatendida sin que nadie revise un diff,
por lo que nunca eliminará una columna, restringirá un tipo ni reescribirá una tabla.
Por eso la imagen también rechaza `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula
un diff y sin dudar ejecutará `DROP COLUMN`, y el reinicio de un contenedor nunca debe ser
capaz de destruir una columna de producción como efecto secundario de una reprogramación.

Los cambios destructivos o de reestructuración se mantienen donde puedan revisarse:
`rebase db generate` + `rebase db migrate`, o `rebase db push` desde un checkout o CI,
que prueba el cambio en modo simulado (dry-run), rechaza los cambios destructivos sin
confirmación y puede realizar una copia de seguridad antes.
:::

### Despliegues divididos (Split deployments)

Una sola imagen y un único bundle pueden arrancarse varias veces, sirviendo cada
uno una parte diferente del proyecto. Una línea para cada uno aquí, ya que esta
página pretende listar todas las variables; lo que cada combinación *monta y administra*
—y qué combinaciones se niegan a arrancar— está en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Si no se define, sigue al rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta trabajadores de la cola de tareas (job workers). Si no se define, sigue al rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve únicamente las funciones personalizadas especificadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Dónde reenvía el proceso de API una solicitud de función que no sirve él mismo. En un `worker`, a dónde van sus propias llamadas `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Un endpoint opcional de Model Context Protocol en `/mcp`, para que un cliente de
IA pueda leer y escribir en este proyecto **como el usuario autenticado**. Desactivado
a menos que se configure, y —a diferencia de cualquier otra superficie— ningún
`REBASE_ROLE` lo activa: los demás describen la estructura de un proceso, mientras que
este representa la decisión de otorgar credenciales a software de terceros, y debe ser
tomada por una persona en lugar de heredarse del rol de un contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie se niega a montarse y lo indica en el registro de inicio. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede derivarlo: tomar el origen del encabezado `Host` convertiría la identidad del emisor, y la audiencia contra la que se validan sus tokens, en un valor proporcionado por el solicitante. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse a sí mismo. Establécelo en `false` para requerir que los clientes se registren previamente. | `true` |

### Edición de esquemas en vivo desde un bundle

Desactivado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esté configurado. Un bundle
compilado no tiene el código fuente de las colecciones para editar, por lo que con
estas variables definidas, el editor de colecciones de administración lee el código
fuente del repositorio, hace commit de cada cambio de vuelta y ejecuta su DDL en
esta base de datos. Solo para administradores, y aplicado por una persona a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Si se define un
repositorio sin credenciales utilizables, se negará a arrancar. Consulta
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub en el que confirmar los cambios de esquema, con formato `propietario/nombre`. Configurarlo es lo que activa la función. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se aplicará el commit. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Dónde se encuentra el código fuente de las colecciones en ese repositorio, relativo al repo. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permisos detallados de lectura y escritura para el contenido del repositorio. Configura este o las tres variables `_GITHUB_APP_*`, no ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | El ID de una GitHub App, para hacer commit como la aplicación en lugar de con un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | La instalación de la aplicación en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clave privada de la aplicación: PEM, PEM con saltos de línea escapados, o base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Si no se define, las copias programadas están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días. Si no se define o es `0`, conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N de las copias de seguridad más recientes, sin importar la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe el binario `pg_dump` —debe coincidir con la versión mayor del servidor o ser más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe el binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe el binario `psql` que `rebase db restore --clean` ejecuta para hacer que la restauración sea una sola transacción. | — |
| `PG_DUMPALL_PATH` | Dónde reside `pg_dumpall`, si no está en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas—, una copia de seguridad global fallará con un error nombrando esta variable. | — |

La imagen oficial del runtime (`rebasepro/server`) incluye las herramientas de cliente
de PostgreSQL 18, por lo que una copia de seguridad programada se ejecuta en ella
contra cualquier servidor hasta Postgres 18. Fuera de la imagen, instálalas tú mismo
(`apt-get install postgresql-client-18`, `brew install libpq`).

Las copias de seguridad contienen secretos e información de identificación personal (PII).
Utiliza un destino privado con cifrado en reposo.

### Entrega de bundles

Un despliegue gestionado no incluye su código en la imagen: el runtime descarga un
bundle al arrancar. Estas variables deciden cuál y cómo.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle previamente extraído. Lo que `rebase start` establece localmente. | — |
| `REBASE_BUNDLE_URL` | De dónde descargar el archivo comprimido del bundle, si no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial de tipo bearer para dicha descarga. Trátala como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los que este declara por sí mismo. | — |

### Vinculación de recursos (Resource bindings)

Cada base de datos, bucket y tema (topic) que un proyecto declara en `config/resources.ts`
se vincula mediante variables de entorno nombradas a partir de él. Los nombres base
están a continuación; un recurso que no sea el predeterminado añade `__` y su clave
en mayúsculas, por lo que un bucket llamado `media` lee `S3_BUCKET__MEDIA`. `rebase status`
imprime, por cada recurso, la variable exacta que está leyendo y si está configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | El paquete npm que implementa el controlador de un origen de datos, cuando no es el de Postgres predeterminado. Con sufijo por origen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un tema declarado. Con sufijo por tema. | — |

### Entorno propio de la CLI

Leído por `rebase`, no por el servidor. Nada de esto afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | Dónde envían la clave de servicio `rebase api-keys`, `rebase storage` y `rebase auth reset-password`, en la shell o en `.env`. Defínelo cuando el servidor se ejecute de otra forma que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Si no se define, usan el servidor registrado por `rebase dev` mientras esté en ejecución, y no envían nada si no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican esos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Un nombre anterior para esa clave. Cuando `.env` lo define, `rebase api-keys` y `rebase storage` lo leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla de forma interactiva. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda proporcionarla sin que pase al historial de la shell. | — |
| `REBASE_TOKEN` | Un token generado con `rebase cloud tokens create`. Si se define, cada comando de `rebase cloud` se autentica con él en lugar de la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión almacenada. En un directorio vinculado con `rebase cloud init --claim`, se aparta para el token propio de ese proyecto si no contiene alcance (scope) en él. Es la forma de ejecutar `rebase cloud` en CI — consulta [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI que generan sus herramientas cloud, y nunca lo envía a la aplicación: usa `REBASE_API_TOKEN` para eso. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y el detalle de la solicitud en lugar del mensaje breve. Lo primero que se debe configurar cuando un comando de `rebase cloud` falla de forma poco descriptiva. | — |
| `REBASE_ATLAS_DEV_URL` | La base de datos vacía contra la que planifican `rebase db push`, `db generate` y `db migrate`, en lugar de la base `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no crea ni elimina una base de datos nombrada aquí, y rechaza una equivalente a `DATABASE_URL`. En la base de datos de desarrollo administrada, la CLI la establece a un PGlite temporal en memoria propio. Defínelo donde no se tengan permisos de `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada: tú aportas la tuya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que de otro modo `rebase dev` deduce de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend se anuncie antes de indicar que no ha iniciado. `0` desactiva el reporte. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` coloca en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convención global entre herramientas. Si se establece en cualquier valor que no sea `0`, la CLI no enviará telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No necesita un archivo, por lo que es la opción ideal para usar en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Dónde se envía la telemetría, para un recopilador autohospedado. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY` se
generan automáticamente fuera de ella, para que puedas empezar sin configurar nada.

Esos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url` e ignorados en git junto con ellos. Antes, se
regeneraban en cada inicio — por lo que reiniciar el servidor de desarrollo cerraba tu
sesión en tu propia aplicación e invalidaba cualquier clave de API recién creada.

- Define cualquiera de las variables explícitamente y se usará la tuya; nada se almacenará en caché ni se leerá.
- Apunta la caché a otro lugar con `REBASE_DEV_SECRETS_FILE` — una ruta, y la
  única variable en esta sección que alguna vez configurarías deliberadamente.
- Elimina el archivo para rotar ambos secretos. El siguiente arranque escribirá uno nuevo.
- Si el archivo no se puede escribir —por ejemplo, en un contenedor de solo lectura—, el servidor arrancará
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

Las mismas opciones,
sin `app`, `server` y `basePath` y con un `provision` requerido, construyen un
backend que no sirve nada hasta que lo montes: `createRebaseBackend`. Consulta
[Integración con servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

`basePath` traslada cada ruta de la API, por lo que se debe indicar lo mismo al
cliente; de lo contrario, seguirá solicitando `/api/...` y obtendrá un 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma esto del cliente que recibe; no es necesario
configurar nada más. Si construyes una URL de solicitud manualmente, únanla desde el cliente
en lugar de escribir `/api` tú mismo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista de hoja de cálculo del CMS carga los datos con éxito.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del Editor SQL cambiando temporalmente los roles de la base de datos para que coincidan con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas autenticación personalizada donde los roles solo existen en tablas de la base de datos en lugar de roles reales de PostgreSQL, el cambio de rol falla o faltan privilegios de base de datos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión por defecto y omite esto.
* **Solución:** Agrega `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de tu backend. Esto obliga a Rebase a ejecutar las consultas del Editor SQL utilizando los privilegios del propietario de la conexión (típicamente un superusuario/propietario). El Editor SQL indicará entonces, sobre los resultados, que se leyeron como el propietario de la conexión y deshabilitará su selector de roles.

### Fallo al obtener el esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol del esquema, o el Editor SQL arroja `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se proporciona `adminConnectionString` al bootstrapper, o se sobreescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
* **Solución:** Asegúrate de que `adminConnectionString` esté configurado durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Resumen del backend](/docs/backend)** — Referencia completa de configuración del backend
