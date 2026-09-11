---
sourceHash: a6ecab532bd0be01
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos de Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en tu archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor requerido o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime — `rebase dev`, `rebase start`, la imagen publicada — utiliza el
> esquema que pertenece al runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede añadir allí sus
> propias variables tipadas.

### Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**; si no se define, `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos bajo `.rebase/`. Requerida en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utiliza una cadena aleatoria segura (mínimo 32 caracteres). **Requerida en producción** (generada automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis específica de node-postgres, no de libpq.**
>
> Rebase y el controlador de Node la aceptan: cifran, pero no verifican el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no lo hacen y no
> se degradan: se niegan a iniciar con `invalid sslmode value: "no-verify"`.
>
> Los comandos propios de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben al equivalente `sslmode=require` antes de ejecutar el shell,
> por lo que funcionan con la URL tal como está configurada. Usar `psql` manualmente
> no lo hace; reemplázala allí por `sslmode=require`, que cifra sin verificar
> exactamente de la misma manera.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK del cliente. **Configura esto solo en desarrollo** — ver a continuación. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend son orígenes independientes, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API es el propio origen de la página y el cliente lo resuelve de esa manera por sí mismo.
>
> Integrar una URL absoluta en un bundle de producción funciona bien hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga entonces la página desde
> `example.com` y llama a la API en `example.rebase.website`, que es cross-origin,
> por lo que cada solicitud falla la verificación previa (preflight). Permitir el origen en CORS
> **no** lo soluciona tampoco — la cookie de actualización tiene `SameSite=Lax` y no se
> envía entre sitios, por lo que eliminarías los errores de la consola pero la autenticación
> seguiría rota. Al no definirla, cualquier dominio que apunte a la aplicación funciona sin necesidad
> de configuración de CORS en absoluto.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente desde el entorno del shell** — un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de que se cargue ese archivo — y, de lo contrario, vincula un puerto derivado de la ruta del proyecto, de modo que se puedan ejecutar varios proyectos a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio muestra el origen utilizado. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de los registros: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia fallida se oculta de forma predeterminada, porque una consulta fallida contiene sus parámetros vinculados — un correo electrónico, un hash de contraseña. Establécelo en `true` mientras diagnosticas un error de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Requerido en producción** si es diferente del dominio del backend. En desarrollo se *añade a* localhost — ver a continuación. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos con nivel de administrador (utilizada para la introspección del esquema y operaciones de administración). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desactiva el cambio de roles de PostgreSQL en el Editor SQL (útil para la autenticación personalizada donde los roles de la base de datos no están mapeados). | `false` |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, más lo que indique `CORS_ORIGINS` (o `FRONTEND_URL`)**
— la misma lista que usa producción, con localhost añadido en lugar de
sustituido. De este modo, la variable funciona de la misma manera en ambos entornos, y los
casos que la necesitan en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté listado es rechazado, y el rechazo se
registra **una vez por origen** con la línea exacta que lo permitiría. Rechazarlo
no es una precaución sin sentido: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría que cualquier sitio que el desarrollador visite realice
solicitudes autenticadas contra el servidor de desarrollo con su sesión y lea las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Clave secreta para la firma de JWT (requerida en producción, generada automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso asimétricamente (RS256), de modo que cualquier servicio con el JWKS pueda verificar una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el contenido del PEM completo en base64. Sin esto, los tokens se mantienen en HS256. | — |
| `JWT_KEY_ID` | Identifica la `JWT_PRIVATE_KEY` en el encabezado del token y en el JWKS. Cámbialo cada vez que la clave cambie; la rotación depende de que la antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de expiración del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de expiración del token de actualización. Es deslizante: cada rotación lo renueva, por lo que esto rige cuánto tiempo sobrevive una sesión ante la **inactividad**. | `400d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, independientemente de lo que diga este valor: una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en el administrador. En producción (`NODE_ENV=production`) esa ventana está cerrada: una tabla vacía rechaza el registro de inicialización con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se define con `REBASE_ADMIN_EMAIL` más abajo o se asigna con la clave de servicio. El archivo `.env.example` del scaffold lo establece en `true`; el valor predeterminado del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de apagado. Cierra la ventana de inicialización del primer usuario que `ALLOW_REGISTRATION=false` deja deliberadamente abierta fuera de producción, de modo que el registro se cierra incluso en una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de producir su primer usuario autenticado. Todos los artefactos de despliegue distribuidos lo configuran. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada en el arranque **mientras la tabla de usuarios aún esté vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador nombra la primera cuenta en lugar de competir con internet para hacerlo. El arranque advierte cuando la tabla está vacía en producción y esto no está configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Debe tener al menos 12 caracteres, de lo contrario se rechaza y la cuenta no se crea. Cámbiala después del primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se establece, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque muestra una advertencia; por lo tanto, rotar `JWT_SECRET` cerrará la sesión de todos *y además* dejará todos los autenticadores registrados ilegibles. Configura una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre en MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave que se está reemplazando *durante una rotación*. Configura ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, por lo que nadie se quedará sin acceso a su cuenta en plena rotación. Elimínala una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional por activación (opt-in), y deliberadamente no está condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establécelo en `false` para una superficie de lectura totalmente pública — RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para usuarios autenticados, y nunca devuelve el correo, roles o metadatos del usuario encontrado. Desactivado por defecto: representa una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es solo para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Seguro por defecto; usa `AUTH_COOKIE_SECURE=false` para HTTP simple — por ejemplo, un despliegue en una dirección LAN donde el navegador de lo contrario descartaría la cookie y la sesión moriría al expirar el token de acceso sin mostrar error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. El `baseUrl` de una instancia autohospedada no se configura mediante variable de entorno — configura GitLab en el bloque `auth` para ello. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | ID de servicios de Apple. Apple no tiene un secreto de cliente estático — Rebase firma un JWT ES256 de corta duración por intercambio de tokens —, por lo que requiere los cuatro valores `APPLE_*` y no configura nada sin ellos. | — |
| `APPLE_TEAM_ID` | ID del equipo de desarrolladores de Apple, el emisor del JWT. | — |
| `APPLE_KEY_ID` | ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan secuencias de escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave estática de la API de administración. Omite la autenticación JWT habitual para llamadas entre servidores cuando se pasa como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa de autenticación: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede ver el recuento de sus réplicas, por lo que un despliegue con réplicas debe indicarlo; tres réplicas con el valor predeterminado aplicarán el triple del límite. Cualquier otro valor **se niega a arrancar** en lugar de degradarse, incluyendo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de enlace de inicio de sesión sin contraseña. Requiere un servicio de correo electrónico configurado, de lo contrario el enlace no tendrá a dónde enviarse. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo electrónico. Requiere el mismo servicio de correo que el anterior. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Si no se define, significa que no hay captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token que envía el navegador. Requerido una vez que se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación a proteger separadas por comas (por ejemplo `register,login`). Si no se define, protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila (RLS), por lo que necesita un modelo de acceso]
Las colecciones están protegidas por las políticas RLS de Postgres. El almacenamiento de objetos no tiene un equivalente —
las claves comparten un único espacio de nombres plano —, por lo que con un bucket configurado y sin un modelo de acceso
el servidor **se niega a arrancar en producción**. Cumple con este requisito usando exactamente uno de los siguientes:
un hook `storageAuthorize` exportado desde `config/index.ts` (lo que incluye el scaffold),
`STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` desactiva el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción — solo con un volumen persistente montado en `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nombre del bucket de S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta para el bucket de S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general, se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio. Omitir en GCP, donde Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve todos los objetos a cualquiera, sin necesidad de token. Solo para un bucket que realmente sea una CDN pública. Una de las tres formas de satisfacer la validación de arranque descrita anteriormente. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar todos los objetos. Se llama `INSECURE` en el objeto de configuración por una razón: solo es justificable en una aplicación de un solo inquilino donde se confía en todas las cuentas para todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las representaciones de imágenes generadas (cambios de tamaño, conversiones de formato) en lugar de producirlas por cada solicitud. | `false` |

### Correo electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección de remitente para correos del sistema |
| `SMTP_NAME` | Nombre para mostrar en la dirección de remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de los correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo predeterminadas. PNG o JPG absoluto con `http(s)` — los clientes de correo descartan SVG y bloquean URIs `data:`. Sin definir, una aplicación llamada aún `Rebase` obtiene el isotipo de Rebase y una renombrada no obtiene ninguno |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos a esperar para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) requiere una: `LISTEN`/`NOTIFY` no funciona a través de un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambio se deshabilitan con una advertencia en lugar de perderse silenciosamente. | — |
| `DATABASE_READ_URL` | Réplica de lectura. Las lecturas se dirigen allí cuando se define y difiere de `DATABASE_URL`; si la conexión falla, todo vuelve a la primaria con una advertencia. | — |
| `REBASE_DB_POOL_MAX` | Un límite superior para cada pool en el proceso, aplicado sin importar lo que cada uno haya solicitado. Solo dígitos simples: un valor con formato incorrecto se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento del runtime

Leído por el runtime — `rebase dev`, `rebase start` y la imagen del servidor
publicada. Un proyecto que ha hecho `eject` toma estas decisiones en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | Ejecuta la auditoría de seguridad a nivel de fila al arrancar y monta su endpoint, que reporta tablas servidas sin políticas. | — |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. Debe informarse al cliente de la misma forma — ver [Cambiar `basePath`](#changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los activos estáticos/de administración del bundle desde este proceso. Desactívalo cuando haya una CDN delante. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la solicitud, **en bytes** (`10485760`, no `10MB` — un valor que no sea un número rechaza el arranque en lugar de eliminar silenciosamente el límite). | — |
| `REBASE_ENABLE_SWAGGER` | Superficie de OpenAPI. De tres estados: sin definir significa activado en desarrollo, desactivado en producción; `false` desactiva ambos en cualquier entorno. Ten en cuenta que `true` en producción sirve la **especificación** en `/api/docs` pero no la **UI** de Swagger en `/api/swagger` — la interfaz gráfica está condicionada por `NODE_ENV` por separado. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, deja el endpoint abierto a todo lo que pueda alcanzar el puerto — aceptable en una red privada, no en una pública, y los registros de arranque lo indicarán. | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacer el runtime con el esquema al arrancar. `ensure` (el valor por defecto en todas partes, incluida la producción) ejecuta el paso **aditivo**: crea tablas, columnas y tipos enum faltantes, nunca elimina ni reescribe ninguno. `none` no toca nada. La imagen publicada solo acepta esos dos y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe configurarse en `none` o se negará a arrancar. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar cuando la base de datos fue aprovisionada por última vez a partir de un conjunto de colecciones diferente al que construyó este proceso. Sin definir (o cualquier valor distinto de `true`/`1`) muestra una advertencia en su lugar. | warn |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (habilita donde la conexión lo admita, vuelve a alternativas silenciosamente si no), `trigger` (lo fuerza, advierte si no es posible), `wal` (actualmente se degrada a `trigger`), `off`. Consulta [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión y presencia: `memory` o `postgres`. Se ignora cuando se pasa un transporte construido a `realtime.bus`. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback bajo `NODE_ENV=production`. Desactivado por defecto, para que un arranque en producción falle de forma explícita en lugar de conectarse a una base de datos que no está allí. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Qué hace el arranque con una clave en tus colecciones que esta versión no lee: `warn`, `error` (se niega a arrancar — vale la pena activarlo en CI) o `off`. Solo rige las claves que no *reconoce*, que usualmente son un error tipográfico y ocasionalmente metadatos deliberados; una clave que sabe que ha sido movida siempre es fatal, porque de lo contrario la funcionalidad configurada estaría silenciosamente ausente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta el paso de esquema y finaliza sin abrir un socket — la estructura que requiere un Job de migración, desde la misma imagen y el mismo bundle que el servidor que le sigue. Un valor vacío equivale a *sin definir*, por lo que una variable `${SOMETHING}` sin sustituir en un archivo compose no puede convertir un despliegue ordinario en uno que migre y se niegue a servir tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina — un agente, un job de CI — *aplique* un cambio de esquema a través de `/api/admin/schema`, no solo que lo planifique. Desactivado a menos que se solicite: la credencial que aplicaría dicho cambio es la que con mayor probabilidad reside en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto tiempo puede ejecutarse una función personalizada antes de que se anule su solicitud. Mismo ajuste que la opción `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado termine el proceso en lugar de solo registrarlo. Úsalo bajo un orquestador que reinicie el proceso; déjalo apagado donde un reinicio sea peor que una fuga de memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene el programador de cron en funcionamiento en una plataforma que el runtime de otro modo detecta como escala-a-cero, donde un temporizador que se dispara en una instancia inactiva no se dispararía en ninguna instancia. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente desde `X-Forwarded-For`. Por seguridad, el valor predeterminado es `0`: sin proxy, confiar en el encabezado permitiría a cualquier cliente falsificar una identidad. | `0` |

:::note[El aprovisionamiento al arranque es aditivo y no es una herramienta de migración]
El paso de arranque se ejecuta de forma desatendida sin nadie leyendo un diff, por lo que nunca eliminará
una columna, limitará un tipo ni reescribirá una tabla. Es también por eso que la imagen rechaza
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y ejecutará con gusto
`DROP COLUMN`, y el reinicio de un contenedor nunca debe destruir una columna de producción
como efecto secundario de una reprogramación.

Los cambios destructivos o de reestructuración deben aplicarse donde puedan ser revisados: `rebase db
generate` + `rebase db migrate`, o `rebase db push` desde un checkout o CI,
que ejecuta el cambio en modo simulado (dry-run), rechaza cambios destructivos sin confirmación y
puede realizar una copia de seguridad antes.
:::

### Despliegues divididos

Una misma imagen y un mismo bundle pueden iniciarse varias veces, cada uno sirviendo
una parte diferente del proyecto. Se incluye una línea por cada variable aquí, ya que esta página
enumera todas las variables; lo que cada combinación *monta y gestiona* — y qué
combinaciones se niegan a arrancar — se detalla en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir, sigue el rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta trabajadores de la cola de tareas (job workers). Sin definir, sigue el rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve solo las funciones personalizadas especificadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | A dónde reenvía el proceso de API una solicitud de función que no sirve él mismo. | — |

### Superficie MCP

Un endpoint opcional del Protocolo de Contexto de Modelo (MCP) en `/mcp`, para que un cliente de IA pueda leer
y escribir en este proyecto **como el usuario autenticado**. Desactivado a menos que se configure y — a diferencia
de cualquier otra superficie — ningún `REBASE_ROLE` lo activa: los demás describen la estructura de un
proceso, mientras que este representa una decisión de entregar credenciales a software
de terceros, y debe ser tomado por una persona en lugar de heredarse de la función de un
contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie se niega a montarse y lo indica en el registro de inicio. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede derivarlo: tomar el origen del encabezado `Host` haría que la identidad del emisor y la audiencia con la que se comprueban sus propios tokens dependieran de un valor suministrado por el cliente. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse a sí mismo. Establécelo en `false` para exigir que los clientes se registren previamente. | `true` |

### Copias de seguridad

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir significa que las copias programadas están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad anteriores a N días. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N copias de seguridad más recientes, sin importar lo que indique la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe la ruta del binario `pg_dump` — debe coincidir con la versión mayor del servidor. | — |
| `PG_RESTORE_PATH` | Sobrescribe la ruta del binario `pg_restore`. | — |

Las copias de seguridad contienen secretos y datos personales (PII). Utiliza un destino privado con
cifrado en reposo.
| `PG_DUMPALL_PATH` | Dónde reside `pg_dumpall`, si no está en el `PATH`. Sin él — y sin las herramientas de cliente de PostgreSQL instaladas —, una copia de seguridad de globales falla con un error indicando esta variable. | — |

### Distribución del bundle

Un despliegue administrado no incluye su código en la imagen: el runtime descarga un
bundle durante el arranque. Estas variables deciden cuál y de qué forma.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle previamente extraído. Lo que establece `rebase start` localmente. | — |
| `REBASE_BUNDLE_URL` | De dónde descargar el archivo comprimido del bundle cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial Bearer para esa descarga. Trátala como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe ser escribible y debe persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los que declara por sí misma. | — |

### Enlace de recursos

Cada base de datos, bucket y topic que un proyecto declara en `config/resources.ts` se
vincula mediante variables de entorno nombradas según el recurso. Los nombres base se muestran a continuación;
un recurso no predeterminado agrega `__` y su clave en mayúsculas, por lo que un bucket llamado
`media` lee `S3_BUCKET__MEDIA`. `rebase status` muestra, por cada recurso,
la variable exacta que está leyendo y si está configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | El paquete npm que implementa el controlador de un origen de datos, cuando no es el de Postgres por defecto. Lleva sufijo según la fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### Entorno propio de la CLI

Leído por `rebase`, no por el servidor. Nada aquí afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | El backend con el que se comunican `rebase auth` y `rebase api-keys`, en lugar de derivarlo del proyecto. | — |
| `REBASE_PORT` | El puerto que esos comandos asumen al derivar esa URL. | — |
| `SERVICE_KEY` | La clave de servicio con la que se autentican, en lugar de solicitarla de forma interactiva. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda proporcionarla sin que llegue al historial del shell. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la solicitud en lugar del mensaje corto. Es lo primero que se debe configurar cuando un comando de `rebase cloud` falla sin aportar información útil. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada — tú aportas la tuya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que `rebase dev` de otro modo deriva de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend responda antes de indicar que no se ha iniciado. `0` desactiva este reporte. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` incluye en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convención estándar entre herramientas. Si se establece en cualquier valor distinto de `0`, la CLI no envía telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No necesita un archivo, por lo que es la que se recomienda usar en CI y dentro de una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | A dónde se envía la telemetría, para un colector autohospedado. | — |

## Secretos en desarrollo

`JWT_SECRET` y `REBASE_SERVICE_KEY` son obligatorios en producción y se generan
automáticamente fuera de ella, de modo que puedas comenzar sin configurar nada.

Esos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y están excluidos en git con ellos. Anteriormente,
se regeneraban en cada inicio, por lo que reiniciar el servidor de desarrollo cerraba la sesión
de tu propia aplicación e invalidaba cualquier clave de API que acabaras de crear.

- Configura cualquiera de las variables explícitamente y se utilizará la tuya; no se almacena ni se lee nada en caché.
- Apunta la caché a otra ubicación con `REBASE_DEV_SECRETS_FILE` — una ruta, y la
  única variable de esta sección que configurarías deliberadamente.
- Elimina el archivo para regenerar ambos secretos. El próximo inicio escribirá uno nuevo.
- Si el archivo no se puede escribir — por ejemplo, en un contenedor de solo lectura —, el servidor se inicia
  de todos modos con un secreto efímero, exactamente como solía hacerlo.

Nada se guarda en caché en producción o bajo un ejecutor de pruebas. En producción, un inicio
que deba generar cualquiera de los dos secretos fallará, indicando la variable correspondiente, y eso no ha cambiado:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objeto de configuración del Backend

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

`basePath` traslada cada ruta de la API, por lo que se le debe indicar lo mismo al cliente;
de lo contrario, continuará solicitando `/api/...` y obtendrá un error 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma esto del cliente que se le proporciona; no es necesario
configurar nada más. Si construyes una URL de solicitud de forma manual, constrúyela a partir del cliente en
lugar de escribir `/api` tú mismo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el Editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista CMS en hoja de cálculo carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del Editor SQL cambiando temporalmente los roles de la base de datos para que coincidan con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas una autenticación personalizada donde los roles solo existen en tablas de la base de datos y no como roles reales de PostgreSQL, el cambio de rol falla o faltan privilegios en la base de datos. La vista de hoja de cálculo del CMS se ejecuta con el usuario propietario de la conexión predeterminada y no se ve afectada por esto.
* **Solución:** Agrega `DISABLE_DB_ROLE_SWITCHING=true` a tu configuración `.env` del backend. Esto obliga a Rebase a ejecutar las consultas del Editor SQL utilizando los privilegios del propietario de la conexión (generalmente un superusuario o propietario).

### Fallo al obtener el esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no puede cargar el árbol del esquema, o el Editor SQL arroja `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos de administración. Si no se proporciona `adminConnectionString` al inicializador (bootstrapper), o si se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
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
- **[Descripción general del backend](/docs/backend)** — Referencia completa de configuración del backend

---
