---
sourceHash: 1e15534f9a5fc19a
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en su archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** durante el arranque. Si
> falta algún valor obligatorio o está mal formado (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a iniciar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecute el backend. Un proyecto iniciado por
> el runtime —`rebase dev`, `rebase start`, la imagen publicada— utiliza el
> esquema propiedad del runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de cada tabla mostrada a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede añadir allí sus propias
> variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utilice una cadena aleatoria segura (mínimo 32 caracteres). **Obligatoria en producción** (se genera automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis de node-postgres, no de libpq.**
>
> Rebase y el driver de Node la aceptan: cifran, pero no comprueban el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no lo hacen y no
> degradan su comportamiento: se niegan a iniciar mostrando `invalid sslmode value: "no-verify"`.
>
> Los comandos propios de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben a su equivalente `sslmode=require` antes de invocar la terminal,
> por lo que funcionan con la URL tal como está configurada. Usar `psql` manualmente no lo
> hace: sustitúyala por `sslmode=require` allí, lo que cifra sin verificar exactamente
> de la misma manera.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Defina esto solo en desarrollo**; consulte los detalles más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deje `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API comparte el mismo origen que la página y el cliente la resuelve de esa forma por sí mismo.
>
> Integrar una URL absoluta en un bundle de producción funciona hasta que un segundo
> hostname apunta a la misma aplicación: un dominio personalizado cargaría la página desde
> `example.com` y llamaría a la API en `example.rebase.website`, lo cual es
> cross-origin y causaría que cada petición falle en el preflight. Permitir el origen en CORS
> **no** lo soluciona: la cookie de actualización utiliza `SameSite=Lax` y no
> se envía entre sitios, por lo que eliminaría los errores de consola pero la autenticación
> seguiría rota. Al dejarlo sin definir, cualquier dominio que apunte a la aplicación funciona
> sin necesidad de configuración CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** —un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de cargar dicho archivo— y, de lo contrario, vincula un puerto derivado de la ruta del proyecto para que varios proyectos puedan ejecutarse a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica cuál se utilizó. | `3001` |
| `LOG_LEVEL` | Nivel de detalle del registro: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia fallida se oculta por defecto, ya que una consulta fallida incluye sus parámetros vinculados (un correo, un hash de contraseña). Establézcalo en `true` mientras diagnostica un fallo de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** si difiere del dominio del backend. En desarrollo se *añade a* localhost; consulte más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos a nivel de administrador (usada para introspección de esquemas y operaciones administrativas). La base de datos que indica no es la que la consola SQL considera actual, ni la que una nueva rama copia por defecto: ambas corresponden a la base de datos en la que se encuentra la conexión propia de la aplicación (consulte `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desactiva el cambio de roles de PostgreSQL en el Editor SQL (útil para autenticación personalizada donde los roles de base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la que se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas desde ella por defecto, permitiendo que el panel de ramas de Studio muestre las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, además de lo que indique `CORS_ORIGINS` (o `FRONTEND_URL`)**;
la misma lista que utiliza producción, con localhost añadido en lugar de
sustituido. Por lo tanto, la variable funciona de la misma manera en ambos entornos y
los casos en los que se necesita en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté listado será rechazado, y el rechazo se
registrará **una vez por origen** junto con la línea exacta que lo permitiría. Rechazarlo
no es una precaución innecesaria: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría que cualquier sitio que visite el desarrollador realice
peticiones autenticadas contra el servidor de desarrollo usando su sesión y lea las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (obligatorio en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), de modo que cualquiera que posea el JWKS pueda verificar una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n`, o el PEM completo en base64. Sin esto, los tokens se mantienen en HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbielo cada vez que cambie la clave; la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización (refresh token). Es deslizante: cada rotación lo renueva, por lo que esto rige cuánto tiempo sobrevive una sesión ante la **inactividad**. Establezca `400d` para sesiones que deban perdurar tras una larga ausencia; los navegadores limitan la cookie de actualización a ese período. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse sin importar este valor: una tabla de usuarios vacía debe admitir a alguien, y esa persona se convierte en administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se define mediante `REBASE_ADMIN_EMAIL` (abajo) o se asigna con la clave de servicio. El archivo `.env.example` de la plantilla lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de apagado de emergencia. Cierra la ventana de registro del primer usuario que `ALLOW_REGISTRATION=false` deja abierta deliberadamente fuera de producción, impidiendo el registro incluso con una base de datos vacía. Combínelo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de generar su primer usuario autenticado. Todos los artefactos de despliegue distribuidos lo configuran. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada durante el arranque **mientras la tabla de usuarios aún está vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador define la primera cuenta en lugar de competir contra internet por ella. El arranque advertirá si la tabla está vacía en producción y esto no está definido. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Debe tener al menos 12 caracteres, o será rechazada y la cuenta no se creará. Cámbiela tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` y el arranque emitirá una advertencia: rotar `JWT_SECRET` cerraría la sesión de todos *y* dejaría inaccesibles los autenticadores registrados. Defina una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre en MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave que se está reemplazando durante una rotación. Defina ambas durante el proceso: los nuevos secretos se escribirán con `MFA_ENCRYPTION_KEY` y los existentes seguirán siendo legibles, evitando que los usuarios queden bloqueados a mitad de la rotación. Elimínela una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Es opcional (opt-in) y deliberadamente no está condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establézcalo en `false` para una superficie de lectura totalmente pública; RLS se seguirá aplicando. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para usuarios autenticados, y nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto: representa una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo se utiliza para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Seguro por defecto; use `AUTH_COOKIE_SECURE=false` para HTTP simple —por ejemplo, un despliegue en una dirección LAN donde el navegador de lo contrario descartaría la cookie y la sesión moriría al expirar el token de acceso sin emitir ningún error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID de GitLab OAuth. La URL base (`baseUrl`) de una instancia autohospedada no se configura por variables de entorno: configure GitLab dentro del bloque `auth` para ese caso. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple. Apple no dispone de un client secret estático —Rebase firma un JWT ES256 de corta duración por cada intercambio de tokens— por lo que necesita los cuatro valores `APPLE_*` y no configurará nada sin ellos. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API estática de administración. Omite la autenticación JWT normal para llamadas entre servidores cuando se pasa como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; puede contener varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la puerta de administración acepte un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto con el que debe coincidir el `aud` de un token de plataforma, de modo que un token emitido para otro proyecto sea rechazado. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa (rate limit) de autenticación: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede conocer su propio recuento de réplicas, por lo que un despliegue con pares debe indicarlo; tres réplicas con el valor por defecto aplicarán tres veces el límite. Cualquier otro valor **impedirá el arranque** en lugar de degradarse, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de enlace de inicio de sesión sin contraseña (magic link). Requiere un servicio de correo electrónico configurado, o el enlace no tendrá a dónde enviarse. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo. Mismo requisito de correo electrónico que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de enlace mágico o código por correo electrónico para una dirección desconocida crea la cuenta mientras el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Qué hacer cuando un token de actualización se reutiliza fuera de su ventana de tolerancia: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar la sesión). Cualquier otro valor causará un error en el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: impide iniciar sesión con contraseña hasta que se verifique la dirección. Requiere servicio de correo; el arranque fallará si no está configurado. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token que envía el navegador. Obligatorio una vez definido `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación a proteger separadas por comas (por ejemplo `register,login`). Si no se define, protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no dispone de seguridad a nivel de fila, por lo que requiere un modelo de acceso]
Las colecciones están protegidas por RLS de Postgres. El almacenamiento de objetos no tiene un equivalente —las
claves comparten un único espacio de nombres plano— por lo que con un bucket configurado y sin un modelo de acceso
el servidor **se negará a arrancar en producción**. Debe satisfacerlo exactamente con una de las siguientes opciones:
un hook `storageAuthorize` exportado desde `config/index.ts` (lo que incluye
la plantilla inicial), `STORAGE_PUBLIC_READ`, o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` desactiva el almacenamiento a menos que se defina `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor: la raíz del proyecto con `rebase dev`, `backend/` en un servidor escrito por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción —solo con un volumen duradero que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de buckets locales nombrados junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales funciona la URL de descarga de un archivo privado (el token que `getSignedUrl()` incluye en ella). Máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo que acepta el origen, en bytes, en todas las rutas de subida (`__<KEY>` para un origen nombrado). Un valor que no sea un número entero de bytes impedirá el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de acceso de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general, se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio. Omitir en GCP, donde Workload Identity suministra las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Servir cada objeto públicamente a cualquiera, sin token. Solo para un bucket que sea genuinamente una CDN pública. Una de las tres formas de satisfacer la validación de arranque descrita anteriormente. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar todos los objetos. Denominado `INSECURE` en el objeto de configuración por una razón: solo es justificable en aplicaciones monoinquilino donde se confía en que cada cuenta acceda a todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las transformaciones de imágenes generadas (redimensionados, conversiones de formato) en lugar de producirlas por petición. | `false` |

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
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo por defecto. URL absoluta `http(s)` en formato PNG o JPG (los clientes de correo eliminan SVG y bloquean URIs `data:`). Si no se define, una aplicación llamada `Rebase` mostrará el logotipo de Rebase y una renombrada no mostrará ninguno |

### Pool de conexiones a la base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) la necesita: `LISTEN`/`NOTIFY` no sobrevive a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambios se desactivan con una advertencia en lugar de perderse silenciosamente. El [trabajador de tareas (job worker)](/docs/backend/jobs) mantiene su `LISTEN` de reactivación en ella también. <span class="since-badge" data-since="0.25">Desde 0.25</span> Rellena el valor `directConnectionString` del adaptador de Postgres cuando este no está definido. | — |
| `DATABASE_READ_URL` | Réplica de lectura. Las lecturas se dirigen allí cuando está configurada y difiere de `DATABASE_URL`; si la conexión falla, todo recurre a la principal con una advertencia. <span class="since-badge" data-since="0.25">Desde 0.25</span> Rellena `readConnectionString` del adaptador de Postgres cuando no está definido; en la versión 0.24 esta opción se ignora. | — |
| `REBASE_DB_POOL_MAX` | Límite máximo para cada pool en el proceso, aplicado independientemente de lo solicitado por cada uno. Solo dígitos simples: un valor mal formado se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento en tiempo de ejecución

Leído por el runtime: `rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho eject gestiona estas decisiones directamente en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría de seguridad a nivel de fila (RLS)](/docs/rls-check#running-it-on-a-schedule) programada, que reporta tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye una copia, y sin el paquete el arranque fallará indicándolo. `false` mantiene el análisis desactivado en este proceso. | — |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. El cliente debe configurarse con el mismo valor; consulte [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los activos estáticos/de administración del bundle desde este proceso. Desactívelo cuando haya una CDN delante. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas comprimidas con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la petición, **en bytes** (`10485760`, no `10MB`; un valor que no sea un número impedirá el arranque en lugar de eliminar el límite silenciosamente). | — |
| `REBASE_ENABLE_SWAGGER` | La superficie de OpenAPI. Estado triple: sin definir significa activado en desarrollo y desactivado en producción; `false` desactiva ambos en cualquier entorno. Tenga en cuenta que `true` en producción sirve la **especificación** en `/api/docs` pero no la **interfaz** Swagger en `/api/swagger`; la interfaz se condiciona por separado según `NODE_ENV`. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, haciendo que los navegadores rechacen HTTP simple en todos los subdominios del host durante seis meses, incluidos hosts que este proceso no sirve. Actívelo solo cuando todos los subdominios del dominio utilicen exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` impedirá el arranque. Consulte [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, deja el endpoint abierto a cualquiera que pueda alcanzar el puerto: aceptable en una red privada, pero no en una pública, y los registros de arranque lo advertirán. | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacer el runtime con el esquema al arrancar. `ensure` (por defecto en todas partes, incluida producción) ejecuta la pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, nunca elimina ni reescribe ninguno. `none` no modifica nada. La imagen publicada solo acepta estos dos y **rechaza arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes) exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe configurar `none` o se negará a iniciar. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar si la base de datos se aprovisionó por última vez a partir de un conjunto de colecciones diferente de aquel con el que se compiló este proceso. Si no está definido (o es distinto de `true`/`1`), solo emite una advertencia. | warn |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (habilitar donde la conexión lo soporte, degradar silenciosamente en caso contrario), `trigger` (forzarlo, advertir si es imposible), `wal` (se degrada a `trigger` actualmente), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). <span class="since-badge" data-since="0.25">Desde 0.25</span> Tiene prioridad sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión y presencia: `memory` o `postgres`. Se ignora cuando se pasa un transporte construido a `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un socket en tiempo real; la siguiente se rechaza con `TOO_MANY_SUBSCRIPTIONS`. Un número entero positivo; cualquier otro valor detiene el servidor en el arranque. Tiene prioridad sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | <span class="since-badge" data-since="0.25">Desde 0.25</span> Cuántos sockets en tiempo real puede mantener abiertos un usuario en una instancia de servidor. El inicio de sesión del siguiente se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK continuará reintentando, conectándose cuando otro se cierre. Un número entero positivo; cualquier otro valor detiene el servidor en el arranque. Tiene prioridad sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | <span class="since-badge" data-since="0.25">Desde 0.25</span> El tiempo máximo que espera un cambio para la nueva consulta (refetch) que lo entrega a los suscriptores activos, en ms. Un refetch espera 300 ms sin cambios, y como máximo este tiempo bajo un flujo constante de escrituras. Un número entero positivo; cualquier otro valor detiene el servidor en el arranque. Tiene prioridad sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | <span class="since-badge" data-since="0.25">Desde 0.25</span> Tiempo durante el cual se puede reutilizar el total de una suscripción de lista grande antes de contarlo nuevamente, en ms; los frames que lo reutilizan llevan `meta.totalAsOf`. Si no se define, cada frame realiza el recuento. Tiene prioridad sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | <span class="since-badge" data-since="0.25">Desde 0.25</span> El último total mínimo al que se aplica `REALTIME_RECOUNT_INTERVAL_MS`; listas más pequeñas se cuentan en cada frame. Tiene prioridad sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback bajo `NODE_ENV=production`. Desactivado por defecto, para que un arranque en producción falle visiblemente en lugar de conectarse a una base de datos inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Qué hace el arranque con una clave en sus colecciones que esta versión no lee: `warn`, `error` (se niega a arrancar, útil para activar en CI), u `off`. Solo rige para claves que no *reconoce*, las cuales suelen ser un error tipográfico y ocasionalmente metadatos intencionales; una clave que sabe que se ha movido siempre resulta fatal, ya que de lo contrario la característica configurada estaría ausente silenciosamente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta el aprovisionamiento del esquema y sale sin abrir un socket: la forma adecuada para un Job de migración, usando la misma imagen y el mismo bundle que el servidor que le sigue. Un valor vacío equivale a *sin definir*, por lo que un `${SOMETHING}` sin sustituir en un archivo compose no convertirá un despliegue ordinario en uno que migra y se niega a servir. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina (un agente, un job de CI) *aplique* un cambio de esquema a través de `/api/admin/schema`, no solo que lo planifique. Desactivado a menos que se solicite: la credencial que realizaría dicho cambio es la que con mayor probabilidad reside en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo máximo que puede ejecutarse una función personalizada antes de que se aborte su petición. Mismo ajuste que la opción `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado finalice el proceso en lugar de solo registrarlo. Útil bajo un orquestador que reiniciará el contenedor; desactivado donde un reinicio sea peor que una fuga de recursos. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene en ejecución el programador de cron en plataformas que el runtime detecta como escalado a cero (scale-to-zero), donde un temporizador que se dispara en una instancia inactiva no se ejecutaría en ninguna. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, permitiendo al limitador de tasa leer la dirección real del cliente desde `X-Forwarded-For`. Valor por defecto a prueba de fallos `0`: sin proxy, confiar en la cabecera permitiría a cualquier cliente falsificar su identidad. | `0` |

:::note[El aprovisionamiento de arranque es aditivo y no es una herramienta de migración]
La pasada de arranque se ejecuta de forma desatendida sin nadie revisando un diff,
por lo que nunca eliminará una columna, reducirá un tipo ni reescribirá una tabla. Por
esa razón la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff
y ejecutará `DROP COLUMN` sin reparos, y el reinicio de un contenedor nunca debe ser
capaz de destruir una columna de producción como efecto secundario de una reprogramación.

Los cambios destructivos o de reestructuración se mantienen donde puedan ser revisados: `rebase db
generate` + `rebase db migrate`, o `rebase db push` desde un entorno local o CI,
el cual realiza un simulacro del cambio, rechaza los destructivos sin confirmación previa
y puede realizar una copia de seguridad antes.
:::

### Despliegues divididos

Una misma imagen y un mismo bundle pueden iniciarse varias veces, sirviendo
cada una una parte diferente del proyecto. Se incluye una línea para cada variable aquí, ya que
esta página documenta todas las variables; para saber qué *monta y gestiona* cada combinación
—y qué combinaciones impiden el arranque— consulte
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir sigue el rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta los workers de colas de trabajos. Sin definir sigue el rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve únicamente las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al que el proceso de API reenvía una petición de función que no sirve por sí mismo. | — |

### Superficie MCP

Un endpoint opcional (opt-in) del Model Context Protocol en `/mcp`, que permite a un cliente de IA
leer y escribir en este proyecto **como el usuario autenticado**. Desactivado a menos que se configure,
y —a diferencia de cualquier otra superficie— ningún `REBASE_ROLE` lo activa: los demás describen
la forma del proceso, mientras que este representa la decisión de otorgar credenciales a software
de terceros, debiendo ser tomada por una persona en lugar de heredarse de la función de un contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie rechaza montarse y lo indica en el registro de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede derivarlo: tomar el origen de la cabecera `Host` haría que la identidad del emisor y la audiencia contra la que se comprueban sus propios tokens fueran valores suministrados por el cliente. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse por sí mismo. Establézcalo en `false` para requerir que los clientes se registren por adelantado. | `true` |

### Edición del esquema en vivo desde un bundle

Desactivado a menos que se configure `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado no
tiene código fuente de colecciones para editar, por lo que con estas variables configuradas el editor de
colecciones de administración lee el código fuente desde el repositorio, confirma cada cambio de vuelta
y ejecuta su DDL en esta base de datos. Solo para administradores, y aplicado por una persona a menos
que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Indicar un repositorio sin
credenciales válidas impedirá el arranque. Consulte
[Edición del esquema en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositorio de GitHub en el que confirmar cambios de esquema, en formato `owner/name`. Configurarlo es lo que activa la función. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Rama en la que se confirman los cambios. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Ubicación del código fuente de las colecciones en ese repositorio, relativa a la raíz del repositorio. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token de acceso detallado (fine-grained) con permisos de lectura y escritura sobre el contenido del repositorio. Configure este o las tres variables `_GITHUB_APP_*`, pero no ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de una GitHub App, para confirmar cambios como la aplicación en lugar de con un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Instalación de la aplicación en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clave privada de la aplicación: PEM, PEM con saltos de línea escapados, o base64. | — |

### Copias de seguridad

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir desactiva las copias programadas. | — |
| `BACKUP_DESTINATION` | Ruta local o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días de antigüedad. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N copias de seguridad más recientes, sin importar la política de retención. | — |
| `PG_DUMP_PATH` | Sobrescribe la ruta del binario `pg_dump`; debe ser de la versión mayor del servidor o más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe la ruta del binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe el binario `psql` que ejecuta `rebase db restore --clean` para que la restauración sea una sola transacción. | — |
| `PG_DUMPALL_PATH` | Ubicación de `pg_dumpall`, cuando no se encuentra en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas— una copia de seguridad de objetos globales fallará con un error indicando esta variable. | — |

La imagen oficial de runtime (`rebasepro/server`) incluye las herramientas de cliente
de PostgreSQL 18, por lo que una copia de seguridad programada se ejecuta en ella contra cualquier
servidor hasta Postgres 18. Fuera de la imagen, debe instalarlas manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos y datos personales (PII). Utilice un destino privado con
cifrado en reposo.

### Entrega de bundles

Un despliegue administrado no incluye su código en la imagen: el runtime obtiene un
bundle durante el arranque. Estas variables deciden cuál y cómo.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Lo que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | Ubicación desde donde descargar el archivo del bundle cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para dicha descarga. Trátela como un secreto: autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los declarados por este. | — |

### Vinculaciones de recursos

Cada base de datos, bucket y topic que un proyecto declara en `config/resources.ts` se
vincula mediante variables de entorno nombradas a partir de él. Los nombres base se detallan a continuación;
un recurso que no sea el predeterminado añade `__` y su clave en mayúsculas, de modo que un bucket llamado
`media` lee `S3_BUCKET__MEDIA`. El comando `rebase status`
imprime, por cada recurso,
la variable exacta que está leyendo y si está configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | El paquete npm que implementa el driver de un origen de datos, cuando no es el predeterminado de Postgres. Con sufijo por origen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### Entorno propio de la CLI

Leído por `rebase`, no por el servidor. Ninguno de estos valores afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | Adónde envían la clave de servicio `rebase api-keys`, `rebase storage` y `rebase auth reset-password`, en el shell o en `.env`. Defínela cuando el servidor se ejecute de otra forma que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Sin definir, usan el servidor que registró `rebase dev` mientras ese servidor está en marcha, y no envían nada cuando no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican esos comandos, leída de `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Un nombre antiguo de esa clave. Cuando `.env` la define, `rebase api-keys` y `rebase storage` la leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla interactivamente. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda proporcionarla sin que quede en el historial de la shell. | — |
| `REBASE_TOKEN` | Un token generado con `rebase cloud tokens create`. Al configurarse, cada comando `rebase cloud` se autentica con él en lugar de la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión almacenada. La forma recomendada de ejecutar `rebase cloud` en CI; consulte [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lee este mismo nombre como alias de `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la petición en lugar del mensaje corto. Lo primero que se debe activar cuando un comando `rebase cloud` falla sin suficiente información. | — |
| `REBASE_ATLAS_DEV_URL` | <span class="since-badge" data-since="0.25">Desde 0.25</span> La base de datos vacía contra la que planifican `rebase db push`, `db generate` y `db migrate`, en lugar de la base de datos `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no crea ni elimina una base de datos indicada aquí, y rechaza una que sea idéntica a `DATABASE_URL`. En la base de datos de desarrollo gestionada, la CLI la establece en una instancia PGlite efímera en memoria propia. Configúrela donde no se tengan permisos de `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada: debe proporcionar la suya propia. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que `rebase dev` de otro modo deriva de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tiempo que espera `rebase dev` a que el backend anuncie que está listo antes de indicar que no ha iniciado. `0` desactiva este reporte. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` incluye en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convención estándar entre herramientas. Con cualquier valor distinto de `0`, la CLI no envía telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No requiere archivos, por lo que es la opción ideal para usar en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destino al que se envía la telemetría, en caso de utilizar un recolector autohospedado. | — |

## Secretos en desarrollo

`JWT_SECRET` y `REBASE_SERVICE_KEY` son obligatorios en producción y se generan
automáticamente fuera de ella, para que pueda comenzar sin configurar nada.

Estos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url` e ignorados en git junto con ellos. Anteriormente,
se regeneraban en cada arranque, por lo que reiniciar el servidor de desarrollo cerraba
la sesión de su propia aplicación e invalidaba cualquier clave de API recién creada.

- Si define cualquiera de las dos variables explícitamente, se utilizará su valor; nada se almacena en caché ni se lee.
- Apunte la caché a otra ubicación con `REBASE_DEV_SECRETS_FILE` —una ruta, y la
  única variable de esta sección que configuraría deliberadamente.
- Elimine el archivo para rotar ambos secretos. El siguiente arranque escribirá uno nuevo.
- Si el archivo no se puede escribir —por ejemplo, en un contenedor de solo lectura—, el servidor arrancará
  de todos modos con un secreto efímero, exactamente como antes.

Nada se almacena en caché en producción ni bajo un ejecutor de pruebas. En producción, un arranque
que deba generar cualquiera de los secretos fallará indicando el nombre de la variable, comportamiento
que se mantiene sin cambios:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objeto de configuración del backend

El objeto `RebaseBackendConfig` pasado a `initializeRebaseBackend()` proporciona control programático:

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

<span class="since-badge" data-since="0.25">Desde 0.25</span> Las mismas opciones,
sin `app`, `server` ni `basePath` y con un parámetro obligatorio `provision`, permiten construir un
backend que no sirve nada hasta que lo monte: `createRebaseBackend`. Consulte
[Integración en servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

`basePath` traslada cada ruta de la API, por lo que el cliente debe ser configurado de la misma forma;
de lo contrario, continuará solicitando `/api/...` y recibirá un error 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración obtiene esto automáticamente a partir del cliente proporcionado; nada más requiere
configuración. Si construye una URL de petición manualmente, concaténela desde el cliente en lugar
de escribir `/api` directamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Resolución de problemas

### Permiso denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista CMS de hoja de cálculo carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del Editor SQL cambiando temporalmente de rol de base de datos para que coincida con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utiliza autenticación personalizada donde los roles solo existen en tablas de la base de datos y no como roles reales de PostgreSQL, el cambio de rol falla o faltan los privilegios de base de datos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión predeterminado y omite este mecanismo.
* **Solución:** Añada `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de su backend. Esto obliga a Rebase a ejecutar las consultas del Editor SQL utilizando los privilegios del propietario de la conexión (normalmente un superusuario/owner). El Editor SQL indicará entonces, sobre los resultados, que se leyeron como el propietario de la conexión y deshabilitará su selector de roles.

### Error al obtener el esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no carga el árbol de esquemas, o el Editor SQL arroja `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se suministra `adminConnectionString` al bootstrapper, o se sobrescribe `getAdmin()` para retornar `undefined`, estas operaciones fallan.
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
