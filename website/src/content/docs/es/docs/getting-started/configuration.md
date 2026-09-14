---
sourceHash: 11b34d6efd4ef32e
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza a través de variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime (`rebase dev`, `rebase start`, la imagen publicada) utiliza el
> esquema del propio runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas mostradas a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede agregar allí sus propias
> variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Usa una cadena aleatoria segura (mínimo 32 caracteres). **Obligatoria en producción** (se autogenera en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis propia de node-postgres, no de libpq.**
>
> Rebase y el driver de Node la aceptan: cifran la conexión, pero no comprueban el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no la aceptan y no se
> degradan de forma tolerante: rechazan el inicio con `invalid sslmode value: "no-verify"`.
>
> Los comandos propios de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben a su equivalente `sslmode=require` antes de ejecutar comandos del sistema,
> por lo que funcionan con la URL tal como está configurada. Usar `psql` manualmente no
> funcionará: cámbiala por `sslmode=require` allí, lo que cifra sin verificar exactamente
> de la misma manera.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK del cliente. **Configura esto solo en desarrollo**; consulta más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |

> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend residen en orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API comparte el propio origen de la página y el cliente la resuelve de esa manera por sí mismo.
>
> Incrustar una URL absoluta en un bundle de producción funciona bien hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga la página desde
> `example.com` y llama a la API en `example.rebase.website`, lo cual constituye una solicitud entre orígenes distintos (cross-origin),
> haciendo que cada petición falle en la verificación preflight. Permitir el origen en CORS
> **tampoco** lo soluciona: la cookie de actualización tiene `SameSite=Lax` y no
> se envía entre sitios, por lo que limpiarías los errores de la consola pero seguirías teniendo
> una autenticación rota. Al dejarlo sin definir, cualquier dominio que apunte a la aplicación funciona sin necesidad
> de configuración de CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** (un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de que se cargue ese archivo) y, de lo contrario, asigna un puerto derivado de la ruta del proyecto, permitiendo ejecutar varios proyectos a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica el origen utilizado. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de los logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia fallida se oculta por defecto porque una consulta fallida incluye sus parámetros enlazados (un correo electrónico, un hash de contraseña). Establécelo en `true` mientras diagnosticas un fallo de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatorio en producción** si difiere del dominio del backend. En desarrollo se *agrega a* localhost (consulta más abajo). | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos con nivel de administrador (usada para introspección del esquema y operaciones administrativas). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de roles de PostgreSQL en el SQL Editor (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). | `false` |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, además de lo que especifique `CORS_ORIGINS` (o `FRONTEND_URL`)**:
la misma lista que utiliza producción, agregando localhost en lugar de
reemplazarlo. De este modo, la variable funciona de la misma manera en ambos entornos, y los
casos que la requieren en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Cualquier origen que no sea localhost ni esté incluido en la lista es rechazado, y el rechazo se
registra en los logs **una sola vez por origen** con la línea exacta que lo permitiría. Rechazarlo
no es una precaución innecesaria: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría que cualquier sitio que el desarrollador visite realice
solicitudes autenticadas contra el servidor de desarrollo usando su sesión y lea las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (obligatorio en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), de modo que cualquiera que posea el JWKS pueda verificar una sesión sin poder emitir una. Acepta un PEM con saltos de línea reales, un PEM con secuencias de escape `\n`, o en base64 de todo el PEM. Sin ella, los tokens permanecen en HS256. | — |
| `JWT_KEY_ID` | Identifica la `JWT_PRIVATE_KEY` en el encabezado del token y en el JWKS. Cámbialo cada vez que la clave cambie; la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización (refresh token). Deslizante: cada rotación lo renueva, por lo que determina cuánto tiempo sobrevive una sesión ante la **inactividad**. | `400d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar este valor: una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en el administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro de arranque inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se especifica con `REBASE_ADMIN_EMAIL` a continuación o se asigna con la clave de servicio. El archivo `.env.example` de la plantilla lo establece en `true`; el valor predeterminado del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Mecanismo de bloqueo total. Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja deliberadamente abierta fuera de producción, por lo que el registro se cierra incluso ante una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` a continuación, o el despliegue no tendrá forma de producir su primer usuario autenticado. Todos los artefactos de despliegue suministrados lo activan. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada al iniciar **mientras la tabla de usuarios aún esté vacía** y nunca después. Así es como un despliegue de producción obtiene su administrador: el operador define la primera cuenta en lugar de competir por ella públicamente en internet. El arranque advierte si la tabla está vacía en producción y esto no está configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Mínimo 12 caracteres, o será rechazada y la cuenta no se creará. Cámbiala después del primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra todos los secretos TOTP almacenados. Si no se define, los secretos se cifran con `JWT_SECRET` y el arranque muestra una advertencia; por lo tanto, rotar `JWT_SECRET` cerraría la sesión de todos *y además* dejaría inservible cualquier autenticador configurado al no poder descifrarse. Configura una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien configure MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave desde la que se está realizando la rotación. Configura ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, por lo que nadie pierde el acceso a su cuenta en mitad de la rotación. Elimínala una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional, y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establécelo en `false` para una superficie de lectura completamente pública; RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para usuarios autenticados, y nunca devuelve el correo, los roles o los metadatos del usuario encontrado. Desactivado por defecto: constituye una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo se utiliza para un frontend verdaderamente ubicado en otro sitio (cross-site). | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Activado por defecto; usa `AUTH_COOKIE_SECURE=false` para HTTP plano, como un despliegue en una dirección de red local (LAN) donde el navegador de lo contrario descartaría la cookie y la sesión moriría al vencer el token de acceso sin emitir ningún error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. La URL base (`baseUrl`) de una instancia autoalojada no tiene variable de entorno: configura GitLab en el bloque `auth` para ese caso. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple. Apple no tiene un secreto de cliente estático (Rebase firma un JWT ES256 de corta duración por cada intercambio de token), por lo que necesita los cuatro valores de `APPLE_*`, y no configura nada sin ellos. | — |
| `APPLE_TEAM_ID` | Team ID de desarrollador de Apple, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se aceptan secuencias de escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave estática de API para administración. Omite la autenticación normal por JWT para llamadas de servidor a servidor cuando se pasa como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa (rate limit) de autenticación: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede conocer su propio número de réplicas, por lo que un despliegue distribuido debe indicarlo explícitamente: tres réplicas con el valor por defecto aplicarían tres veces el límite permitido. Cualquier otro valor **rechaza el inicio** en lugar de degradarse a una alternativa, incluyendo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de inicio de sesión sin contraseña mediante enlace (magic link). Requiere un servicio de correo electrónico configurado, de lo contrario el enlace no tiene destino. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña mediante un código de seis dígitos enviado por correo electrónico. Mismo requisito de correo electrónico que el anterior. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Si no se define, no hay captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token enviado por el navegador. Obligatorio si se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas que se desean proteger (por ejemplo `register,login`). Si no se define, protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila (RLS), por lo que necesita un modelo de acceso]
Las colecciones están protegidas por las políticas RLS de Postgres. El almacenamiento de objetos no tiene un equivalente (las claves comparten un único espacio de nombres plano), por lo que con un bucket configurado y sin un modelo de acceso definido, el servidor **se niega a arrancar en producción**. Cumple este requisito con exactamente una de las siguientes opciones:
un hook `storageAuthorize` exportado desde `config/index.ts` (lo que incluye la plantilla inicial), `STORAGE_PUBLIC_READ`, o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` desactiva el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción (solo recomendado con un volumen duradero montado en `STORAGE_PATH`) | `false` |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general, se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio. Omitir en GCP si Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve todos los objetos a cualquier persona, sin token. Solo para un bucket que realmente funcione como una CDN pública. Es una de las tres formas de satisfacer la validación de arranque descrita arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar todos los objetos. Se llama `INSECURE` en el objeto de configuración por una razón: solo es justificable en una aplicación de un solo inquilino donde se confía en que cada cuenta tenga acceso a cada archivo. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las imágenes procesadas generadas (redimensionamientos, conversiones de formato) en lugar de producirlas en cada solicitud. | `false` |

### Correo electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección de remitente para correos del sistema |
| `SMTP_NAME` | Nombre visible en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de los correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo predeterminadas. PNG o JPG absoluto bajo `http(s)` (los clientes de correo eliminan SVG y bloquean URIs `data:`). Si no se define, una aplicación llamada `Rebase` mostrará el logotipo de Rebase, y una con un nombre personalizado no mostrará ninguno |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) requiere una: `LISTEN`/`NOTIFY` no sobrevive a un gestor de transacciones como PgBouncer, y sin ella las notificaciones de cambios se desactivan con una advertencia en lugar de perderse en silencio. | — |
| `DATABASE_READ_URL` | Réplica de lectura. Las lecturas se dirigen allí cuando está configurada y difiere de `DATABASE_URL`; si la conexión falla, todo recurre a la principal con una advertencia. | — |
| `REBASE_DB_POOL_MAX` | Un límite superior para todos los pools del proceso, aplicado sin importar lo solicitado individualmente. Solo dígitos: un valor con formato incorrecto se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento del runtime

Leído por el runtime (`rebase dev`, `rebase start` y la imagen de servidor
publicada). Un proyecto que ha hecho `eject` gestiona estas decisiones directamente en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | Ejecuta la auditoría de seguridad a nivel de fila (RLS) al arrancar y habilita su endpoint, el cual reporta las tablas servidas sin políticas. | — |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. Debe configurarse lo mismo en el cliente; consulta [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los activos estáticos y de administración del bundle desde este proceso. Desactívalo si hay una CDN intermediaria. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compresión gzip/brotli en las respuestas. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la petición, **en bytes** (`10485760`, no `10MB`; un valor que no sea numérico impedirá el arranque en lugar de eliminar el límite en silencio). | — |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. Tres estados: sin definir significa activado en desarrollo y desactivado en producción; `false` lo desactiva en cualquier entorno. Ten en cuenta que `true` en producción sirve la **especificación** en `/api/docs`, pero no la interfaz gráfica (**UI**) de Swagger en `/api/swagger` (la UI depende de `NODE_ENV` por separado). | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, el endpoint queda expuesto a cualquiera que pueda alcanzar el puerto (adecuado en una red privada, no en una pública, como advierten los logs de inicio). | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacer el runtime sobre el esquema al arrancar. `ensure` (por defecto en todas partes, incluida producción) ejecuta la fase **aditiva**: crea tablas, columnas y tipos enum faltantes, sin eliminar ni reescribir nada. `none` no modifica nada. La imagen publicada acepta únicamente esas dos opciones y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe establecerse en `none` o impedirá el arranque. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar si la base de datos fue aprovisionada por última vez a partir de un conjunto de colecciones distinto al usado para compilar este proceso. Si no se define (o con cualquier valor distinto de `true`/`1`), solo emite una advertencia. | warn |
| `REALTIME_CDC` | Captura de datos modificados (CDC) a nivel de base de datos: `auto` (se activa si la conexión lo admite, recurriendo silenciosamente al modo alternativo si no), `trigger` (lo fuerza, advierte si no es posible), `wal` (se degrada a `trigger` actualmente), `off`. Consulta [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora si a `realtime.bus` se le proporcionó un transporte ya construido. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost` o loopback bajo `NODE_ENV=production`. Desactivado por defecto, para que un inicio en producción falle visiblemente en lugar de intentar conectarse a una base de datos inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Qué hace el arranque ante una clave en las colecciones que esta versión no interpreta: `warn`, `error` (se niega a arrancar; útil en CI), u `off`. Solo aplica a claves que no *reconoce*, las cuales suelen ser un error tipográfico y ocasionalmente metadatos intencionales; una clave que el sistema sabe que ha cambiado de lugar siempre causa un error fatal, ya que la funcionalidad configurada quedaría ausente en silencio. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la fase del esquema y finaliza sin abrir ningún socket (el comportamiento esperado en un Job de migración, usando la misma imagen y bundle que el servidor que se ejecutará a continuación). Un valor vacío cuenta como *no definido*, por lo que un `${SOMETHING}` sin sustituir en un archivo compose no convertirá un despliegue normal en uno que migra y se niega a servir peticiones. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina (un agente, un job de CI) pueda *aplicar* un cambio de esquema mediante `/api/admin/schema`, en lugar de solo planificarlo. Desactivado a menos que se solicite expresamente: la credencial que aplicaría dicho cambio suele ser la más propensa a residir en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo máximo que puede ejecutarse una función personalizada antes de abortar su petición. Mismo ajuste que la opción `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que una promesa rechazada no controlada finalice el proceso en lugar de solo registrarla. Recomendado bajo un orquestador que reinicie el contenedor; desactivado donde un reinicio sea peor que una fuga de recursos. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene activo el planificador de cron en plataformas que el runtime detecta con escalado a cero, donde un temporizador disparado en una instancia inactiva no se ejecutaría en ninguna instancia. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, para que el limitador de tasa pueda obtener la dirección IP real del cliente desde `X-Forwarded-For`. Valor seguro por defecto `0`: sin proxy, confiar en la cabecera permitiría a cualquier cliente falsificar su identidad. | `0` |

:::note[El aprovisionamiento al arrancar es aditivo y no es una herramienta de migración]
La fase de arranque se ejecuta de forma desatendida sin supervisión humana de las diferencias (diff), por lo que nunca eliminará
una columna, restringirá un tipo ni reescribirá una tabla. Por esa misma razón la imagen rechaza
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y ejecutará sin problemas
`DROP COLUMN`, y un reinicio de contenedor nunca debe tener la capacidad de destruir una
columna en producción a raíz de una reprogramación de instancias.

Los cambios destructivos o de reestructuración deben realizarse donde puedan ser revisados: `rebase db
generate` + `rebase db migrate`, o `rebase db push` desde un entorno local o CI,
lo cual realiza una ejecución de prueba (dry-run) del cambio, rechaza los cambios destructivos si no hay confirmación previa, y
puede realizar una copia de seguridad antes de proceder.
:::

### Despliegues divididos

Una misma imagen y un mismo bundle pueden iniciarse varias veces, sirviendo
cada instancia una parte distinta del proyecto. Aquí se listan brevemente, ya que esta página documenta
todas las variables; los detalles sobre qué *monta y gestiona* cada combinación (y qué
combinaciones impiden el arranque) se encuentran en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Si no se define, sigue al rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta los workers de la cola de tareas. Si no se define, sigue al rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve únicamente las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al que el proceso de la API reenvía una solicitud de función que no sirve él mismo. | — |

### Superficie MCP

Un endpoint opcional para el Model Context Protocol en `/mcp`, que permite a un cliente de IA leer
y escribir en este proyecto **como el usuario autenticado**. Desactivado a menos que se defina, y
—a diferencia del resto de superficies— ningún `REBASE_ROLE` lo activa automáticamente: los demás describen la
forma de un proceso, mientras que este implica conceder credenciales a software de
terceros, una decisión que debe tomar una persona en lugar de heredarse del
propósito del contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Habilita la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie no se monta y lo indica en el log de inicio. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente para este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede deducirlo: inferir el origen desde el encabezado `Host` causaría que la identidad del emisor y la audiencia frente a la que se validan sus tokens fuesen valores controlados por quien realiza la solicitud. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), de forma que un cliente pueda registrarse por sí mismo. Configúralo en `false` para requerir que los clientes se registren por adelantado. | `true` |

### Copias de seguridad (Backups)

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir significa que están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad más antiguas de N días. Sin definir o `0` conserva todas. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N de las copias de seguridad más recientes, sin importar la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe la ruta al binario `pg_dump`: debe coincidir con la versión mayor del servidor. | — |
| `PG_RESTORE_PATH` | Sobrescribe la ruta al binario `pg_restore`. | — |

Las copias de seguridad contienen secretos y datos personales (PII). Utiliza un destino privado con
cifrado en reposo.
| `PG_DUMPALL_PATH` | Ubicación de `pg_dumpall`, cuando no está en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas—, una copia de seguridad de globales fallará indicando esta variable. | — |

### Entrega de bundles

Un despliegue gestionado no almacena su código dentro de la imagen: el runtime descarga un
bundle durante el arranque. Estas variables definen cuál y cómo.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Es lo que `rebase start` establece localmente. | — |
| `REBASE_BUNDLE_URL` | Ubicación desde donde descargar el archivo comprimido del bundle, si no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial Bearer para dicha descarga. Trátala como un secreto: autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae el bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los declarados por sí mismo. | — |

### Enlaces de recursos (Resource bindings)

Cada base de datos, bucket y topic que un proyecto declara en `config/resources.ts` se
vincula mediante variables de entorno nombradas en función de él. Los nombres base se muestran a continuación; un
recurso que no sea el predeterminado añade `__` y su identificador en mayúsculas (por ejemplo, un bucket llamado
`media` leerá `S3_BUCKET__MEDIA`). `rebase status` muestra, por cada recurso,
la variable exacta que está leyendo y si está configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | El paquete npm que implementa el driver de un origen de datos, cuando no es el de Postgres por defecto. Con sufijo por origen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### Entorno propio de la CLI

Leído por `rebase`, no por el servidor. Ninguno de estos valores afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | La URL del backend con el que se comunican `rebase auth` y `rebase api-keys`, en lugar de deducirla del proyecto. | — |
| `REBASE_PORT` | El puerto que asumen esos comandos al deducir dicha URL. | — |
| `SERVICE_KEY` | La clave de servicio con la que se autentican, en lugar de solicitarla de forma interactiva. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, si no es el del proyecto. | — |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda suministrarla sin que pase por el historial de la shell. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la petición en lugar de un mensaje abreviado. Lo primero a configurar si un comando de `rebase cloud` falla sin aportar información útil. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada; debes proveer la tuya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, el cual `rebase dev` deduce habitualmente a partir de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tiempo que `rebase dev` espera a que el backend anuncie que está listo antes de notificar que no ha iniciado. `0` desactiva este aviso. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` incluye en la cadena de conexión deducida desde `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convención estándar entre herramientas. Si tiene cualquier valor distinto de `0`, la CLI no envía telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específico para Rebase. No necesita un archivo, por lo que es la opción recomendada en CI y en imágenes de contenedores. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Dónde se envía la telemetría, para un colector autoalojado. | — |

## Secretos en desarrollo

`JWT_SECRET` y `REBASE_SERVICE_KEY` son obligatorios en producción y se generan
automáticamente fuera de ella, para que puedas comenzar a trabajar sin necesidad de configurar nada previamente.

Estos valores generados se almacenan en caché dentro de `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y están incluidos en el `.gitignore` al igual que ellos. Anteriormente,
se regeneraban en cada inicio, por lo que reiniciar el servidor de desarrollo cerraba tu sesión en
la aplicación e invalidaba cualquier clave de API recién creada.

- Si defines cualquiera de las dos variables explícitamente, se utilizará tu valor; nada se guardará ni se leerá de la caché.
- Apunta la caché a otra ubicación con `REBASE_DEV_SECRETS_FILE` (una ruta, y la
  única variable de esta sección que configurarías de forma intencional).
- Elimina el archivo para regenerar ambos secretos. El siguiente arranque generará uno nuevo.
- Si no es posible escribir el archivo (por ejemplo, en un contenedor de solo lectura), el servidor arranca
  de todos modos con un secreto efímero, exactamente como antes.

Nada se almacena en caché en producción ni bajo un ejecutador de pruebas. En producción, un inicio
que deba generar cualquiera de los secretos seguirá fallando e indicará el nombre de la variable:

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

### Cambiar `basePath`

`basePath` desplaza todas las rutas de la API, por lo que el cliente debe configurarse en consecuencia;
de lo contrario, continuará solicitando `/api/...` y recibirá un error 404 en todas las peticiones:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma esto directamente del cliente suministrado; no requiere ninguna otra
configuración. Si construyes una URL de solicitud de forma manual, concaténala desde el cliente en lugar
de escribir `/api` directamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en SQL Editor (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista de CMS en hoja de cálculo carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del SQL Editor cambiando temporalmente los roles de la base de datos para coincidir con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas autenticación personalizada donde los roles existen únicamente en tablas de la base de datos y no como roles reales de PostgreSQL, el cambio de rol falla o faltan privilegios en la base de datos. La vista de hoja de cálculo del CMS se ejecuta con el usuario propietario de la conexión predeterminada y evita este problema.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de tu backend. Esto obliga a Rebase a ejecutar las consultas del SQL Editor utilizando los privilegios del propietario de la conexión (habitualmente un superusuario/owner).

### Fallo al obtener el esquema en SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol del esquema, o el SQL Editor arroja el error `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos de administración. Si no se proporciona `adminConnectionString` al inicializador de arranque (bootstrapper), o se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
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
- **[Información general del backend](/docs/backend)** — Referencia completa de configuración del backend
