---
sourceHash: f66784a0d8158afb
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al inicio. Si
> falta algo obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto
> que no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecute el backend. Un proyecto iniciado por
> el runtime — `rebase dev`, `rebase start`, la imagen publicada — utiliza el
> esquema que posee el runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de cada tabla a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede agregar sus propias
> variables tipadas allí.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utilice una cadena aleatoria segura (mínimo 32 caracteres). **Obligatoria en producción** (se genera automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis de node-postgres, no de libpq.**
>
> Rebase y el controlador de Node la aceptan: cifra, pero no verifica el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no lo hacen, y no se
> degradan de forma tolerante: se niegan a iniciar con `invalid sslmode value: "no-verify"`.
>
> Los propios comandos de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben a la equivalente `sslmode=require` antes de invocar la terminal,
> por lo que funcionan con la URL tal como está configurada. Usar `psql` manualmente no lo
> hace: sustitúyala por `sslmode=require` allí, lo que cifra sin verificar exactamente de
> la misma manera.

### Frontend

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Configúrela solo en desarrollo** — consulte más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de OAuth de Google. Habilita "Iniciar sesión con Google". | — |

> **Deje `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend son orígenes independientes, por lo que el
> servidor de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo
> que la API es el propio origen de la página y el cliente la resuelve de esa manera por su cuenta.
>
> Incrustar una URL absoluta en un paquete de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga entonces la página desde
> `example.com` y llama a la API en `example.rebase.website`, que es de origen cruzado (cross-origin),
> por lo que cada solicitud falla en el preflight. Permitir el origen en CORS
> **tampoco** lo soluciona: la cookie de actualización (refresh) es `SameSite=Lax` y no se
> envía entre sitios cruzados, por lo que eliminaría los errores de consola pero la autenticación
> seguiría rota. Al no definirla, cualquier dominio que apunte a la aplicación funciona sin
> necesidad de configuración CORS alguna.

### Backend

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de que se cargue ese archivo — y, de lo contrario, se vincula a un puerto derivado de la ruta del proyecto, de modo que varios proyectos pueden ejecutarse a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica el nivel que utilizó. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de los registros: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia con error se oculta de forma predeterminada, porque una consulta fallida incluye sus parámetros enlazados (un correo electrónico, un hash de contraseña). Establézcalo en `true` mientras diagnostica un fallo de DDL, RLS o de captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** si difiere del dominio del backend. En desarrollo se *añade a* localhost — consulte más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos a nivel de administrador (utilizada para la introspección de esquemas y operaciones administrativas). La base de datos que indica no es la que la consola SQL considera actual, ni lo que copia una nueva rama por defecto: ambas corresponden a la base de datos en la que se encuentra la conexión propia de la aplicación (consulte `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desactiva el cambio de roles de PostgreSQL en el Editor SQL (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos a partir de la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas de ella por defecto, de modo que el panel de Ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El desarrollo permite **localhost, además de lo que indique `CORS_ORIGINS` (o `FRONTEND_URL`)**
— la misma lista que usa producción, con localhost añadido en lugar de sustituido.
Por lo tanto, la variable funciona de la misma manera en ambos entornos, y los
casos que la necesitan en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Se rechaza cualquier origen que no sea localhost ni esté en la lista, y el rechazo se
registra en los logs **una vez por origen** con la línea exacta que lo permitiría. Rechazarlo
no es una mera precaución innecesaria: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría a cualquier sitio que el desarrollador visite realizar
solicitudes autenticadas contra el servidor de desarrollo utilizando su sesión y leer las
respuestas.

### Autenticación

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `JWT_SECRET` | Clave secreta para la firma de JWT (obligatoria en producción, autogenerada en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), de modo que cualquiera que disponga del JWKS pueda verificar una sesión sin poder acuñar una nueva. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el PEM completo en base64. Sin ella, los tokens permanecen en HS256. | — |
| `JWT_KEY_ID` | Asigna un nombre a `JWT_PRIVATE_KEY` en el encabezado del token y en el JWKS. Cámbielo cada vez que cambie la clave; la rotación depende de que la antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización (refresh). Deslizante: cada rotación lo renueva, por lo que determina cuánto tiempo sobrevive una sesión a la **inactividad**. Establezca `400d` para sesiones que deban perdurar tras una larga ausencia; los navegadores limitan la cookie de actualización a ese valor. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar lo que indique este valor: una tabla de usuarios vacía debe admitir a alguien, y esa persona se convierte en administrador. En producción (`NODE_ENV=production`), esa ventana está cerrada: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se define con `REBASE_ADMIN_EMAIL` a continuación o se asigna con la clave de servicio. El archivo `.env.example` del scaffold lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de apagado de emergencia (kill switch). Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja deliberadamente abierta fuera de producción, de modo que el registro queda deshabilitado incluso en una base de datos vacía. Combínelo con `REBASE_ADMIN_EMAIL` a continuación, o el despliegue no tendrá forma de generar su primer usuario autenticado. Todos los artefactos de despliegue distribuidos lo configuran. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada en el arranque **mientras la tabla de usuarios aún está vacía** y nunca después. Así es como un despliegue de producción obtiene su administrador: el operador define la primera cuenta en lugar de competir contra internet por ella. El arranque emite una advertencia cuando la tabla está vacía en producción y esto no está configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Al menos 12 caracteres, o de lo contrario será rechazada y la cuenta no se creará. Cámbiela después del primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque advertirá una vez; por lo tanto, rotar `JWT_SECRET` cerrará la sesión de todos *y además* dejará inaccesible cualquier autenticador registrado. Configure una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave de la que se está rotando. Configure ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, por lo que nadie quedará bloqueado de su cuenta a mitad de la rotación. Elimínela una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional (opt-in) y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establézcalo en `false` para una superficie de lectura totalmente pública; RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para emisores autenticados, y nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto: constituye una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo se utiliza para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Seguro por defecto; `AUTH_COOKIE_SECURE=false` para HTTP simple: un despliegue en una dirección LAN donde, de lo contrario, el navegador descartaría la cookie y la sesión caducaría al vencer el token de acceso sin mostrar ningún error. Advierte en el arranque. `http://localhost` no lo necesita. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente de OAuth de Google (validación en backend) | — |
| `GOOGLE_CLIENT_SECRET` | Secreto de cliente de OAuth de Google | — |
| `GITHUB_CLIENT_ID` | ID de cliente de OAuth de GitHub | — |
| `GITHUB_CLIENT_SECRET` | Secreto de cliente de OAuth de GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID de cliente de OAuth de Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Secreto de cliente de OAuth de Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID de cliente de OAuth de LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Secreto de cliente de OAuth de LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID de cliente de OAuth de Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Secreto de cliente de OAuth de Facebook | — |
| `TWITTER_CLIENT_ID` | ID de cliente de OAuth de X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Secreto de cliente de OAuth de X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID de cliente de OAuth de Discord | — |
| `DISCORD_CLIENT_SECRET` | Secreto de cliente de OAuth de Discord | — |
| `GITLAB_CLIENT_ID` | ID de cliente de OAuth de GitLab. El `baseUrl` de una instancia autoalojada no tiene variable de entorno: configure GitLab en el bloque `auth` para ello. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de OAuth de GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de OAuth de Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de OAuth de Bitbucket | — |
| `SLACK_CLIENT_ID` | ID de cliente de OAuth de Slack | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de OAuth de Slack | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de OAuth de Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de OAuth de Spotify | — |
| `APPLE_CLIENT_ID` | ID de servicios de Apple. Apple no dispone de un secreto de cliente estático — Rebase firma un JWT ES256 de corta duración por cada intercambio de tokens —, por lo que requiere los cuatro valores `APPLE_*` y no configura nada sin ellos. | — |
| `APPLE_TEAM_ID` | ID del equipo de desarrolladores de Apple, el emisor del JWT. | — |
| `APPLE_KEY_ID` | ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan secuencias de escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API de administrador estática. Omite la autenticación JWT normal para llamadas de servidor a servidor cuando se pasa como `Authorization: Bearer <key>`. (Autogenerada en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante una rotación de clave. La plataforma la establece al desplegar y no contiene secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la puerta de administración acepte un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto con el que debe coincidir el `aud` de un token de plataforma, de modo que se rechace un token acuñado para otro proyecto. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa (rate-limit) de autenticación: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede ver su propio número de réplicas, por lo que un despliegue con réplicas debe indicarlo; tres réplicas con el valor por defecto aplican el triple del límite. Cualquier otro valor **rechaza el arranque** en lugar de recurrir a un valor por defecto, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta el flujo de enlace de inicio de sesión sin contraseña. Requiere un servicio de correo electrónico configurado, o el enlace no tendrá a dónde enviarse. | `false` |
| `AUTH_EMAIL_OTP` | Monta el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo. El mismo requisito de correo anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de magic-link o código por correo para una dirección desconocida crea la cuenta, mientras el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Qué hace un token de actualización reutilizado después de su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar la sesión). Cualquier otro valor hace fallar el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite iniciar sesión con contraseña hasta verificar la dirección. Requiere correo; el arranque se negará a iniciar sin él. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Si no se define, significa sin captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token que envía el navegador. Obligatorio una vez configurado `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas que se protegerán (por ejemplo `register,login`). Si no se define, protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no cuenta con seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las colecciones están protegidas por el RLS de Postgres. El almacenamiento de objetos no tiene un equivalente —las
claves comparten un único espacio de nombres plano—, por lo que con un bucket configurado y sin un modelo de acceso,
el servidor **se niega a arrancar en producción**. Complételo con exactamente uno de los siguientes:
un hook `storageAuthorize` exportado desde `config/index.ts` (lo que incluye el scaffold),
`STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` deshabilita el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor: la raíz del proyecto bajo `rebase dev`, `backend/` en un servidor generado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción — solo con un volumen persistente que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de los buckets locales nombrados junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales la URL de descarga de un archivo privado es válida — el token que `getSignedUrl()` incluye en ella. Como máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo que acepta la fuente, en bytes, en cada ruta de subida — `__<KEY>` para una fuente con nombre. Si no es un número entero de bytes, rechaza el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket de S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta para el bucket de S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general, se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio. Omitir en GCP, donde Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve cualquier objeto a cualquier usuario, sin token. Solo para un bucket que sea genuinamente una CDN pública. Una de las tres formas de satisfacer la validación de arranque indicada anteriormente. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar cualquier objeto. Nombrado `INSECURE` en el objeto de configuración con razón: solo es justificable en una aplicación de un solo inquilino donde se confía en que todas las cuentas tengan acceso a todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las representaciones de imágenes generadas (redimensionamientos, conversiones de formato) en lugar de producirlas en cada solicitud. | `false` |

### Correo electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Servidor host de SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Nombre de usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre visible en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de los correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo predeterminadas. PNG o JPG absoluto `http(s)` — los clientes eliminan SVG y bloquean los URI `data:`. Si no se define, una aplicación que aún se llame `Rebase` obtiene la marca de Rebase y una con otro nombre no obtiene ninguno |

### Grupo de conexiones de base de datos (Pool)

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `DB_POOL_MAX` | Conexiones máximas en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) necesita una: `LISTEN`/`NOTIFY` no sobrevive a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambios se desactivan con una advertencia en lugar de perderse silenciosamente. El [trabajador de tareas (job worker)](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Rellena el `directConnectionString` del adaptador de Postgres cuando no está configurado. | — |
| `DATABASE_READ_URL` | Réplica de lectura. Las lecturas se dirigen allí cuando está configurada y difiere de `DATABASE_URL`; si la conexión falla, todo recurre a la principal con una advertencia. Rellena el `readConnectionString` del adaptador de Postgres cuando no está configurado; en 0.24 esa opción se ignora. | — |
| `REBASE_DB_POOL_MAX` | Un límite superior para cada pool del proceso, aplicado sin importar lo solicitado por cada uno. Solo dígitos simples: un valor mal formado se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento en tiempo de ejecución

Leído por el runtime — `rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho `eject` gestiona estas decisiones en su propio
código en su lugar.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría programada de seguridad a nivel de fila (RLS)](/docs/rls-check#running-it-on-a-schedule), que informa las tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye ninguna copia, y sin el paquete el arranque se niega a iniciar, nombrándolo. `false` mantiene el escaneo desactivado en este proceso. | — |
| `REBASE_BASE_PATH` | Ruta base para cada ruta de la API. Se le debe indicar lo mismo al cliente — consulte [Modificar `basePath`](#modificar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos y de administración del bundle desde este proceso. Desactívelo cuando haya una CDN delante. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas comprimidas con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la solicitud, **en bytes** (`10485760`, no `10MB` — un valor que no sea un número rechaza el arranque en lugar de eliminar silenciosamente el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie de OpenAPI. Tres estados: sin definir significa activo en desarrollo, inactivo en producción; `false` desactiva ambos en cualquier lugar. Tenga en cuenta que `true` en producción sirve la **especificación** en `/api/docs` pero no la **UI** de Swagger en `/api/swagger` — la UI se restringe según `NODE_ENV` por separado. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` al encabezado `Strict-Transport-Security`, de modo que los navegadores rechacen HTTP simple en cada subdominio del host durante seis meses — incluidos los hosts que este proceso no sirve. Actívelo solo cuando cada subdominio del dominio sea exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` rechaza el arranque. Consulte [Encabezados de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, deja el endpoint abierto a cualquiera que pueda alcanzar el puerto — aceptable en una red privada, no en una pública, y los registros de arranque lo advertirán. | — |
| `REBASE_MIGRATE_ON_BOOT` | Lo que el runtime puede hacer con el esquema en el arranque. `ensure` (el predeterminado en todas partes, incluida la producción) ejecuta la pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, y nunca elimina ni reescribe uno existente. `none` deja intacto el esquema de las colecciones, pero las tablas propias del framework (auth, claves de API, jobs, cron) se siguen creando y manteniendo al día; <span class="since-badge" data-since="0.26">Desde 0.26</span> `REBASE_PROVISION=false` desactiva también esas. La imagen publicada solo acepta esos dos y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cada uno de los otros roles debe establecer `none` o se negará a arrancar. | `ensure` |
| `REBASE_PROVISION` | <span class="since-badge" data-since="0.26">Desde 0.26</span> `false` hace que el runtime no cambie nada en su base de datos: ninguna tabla, columna, índice, función, trigger, política, rol ni permiso, ni en el arranque ni después, incluidas las tablas propias del framework. En su lugar, informa por nombre de lo que falta. Para una base de datos que solo su proceso de cambios puede modificar. Consulte [Cuando solo su proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar cuando la base de datos se aprovisionó por última vez a partir de un conjunto de colecciones diferente de aquel a partir del cual se construyó este proceso. Si no se define (o cualquier valor distinto de `true`/`1`), emite una advertencia en su lugar. | warn |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (habilitar donde la conexión lo soporte, recurrir silenciosamente a la alternativa si no), `trigger` (forzarlo, advertir si es imposible), `wal` (actualmente se degrada a `trigger`), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tiene prioridad sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora cuando se proporcionó un transporte construido a `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un socket de tiempo real; la siguiente se rechaza con `TOO_MANY_SUBSCRIPTIONS`. Un número entero positivo; cualquier otro valor detiene el servidor en el arranque. Tiene prioridad sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cuántos sockets de tiempo real puede mantener abiertos un usuario en una instancia de servidor. El inicio de sesión del siguiente se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK continúa reintentando, por lo que entra cuando se cierra otro. Un número entero positivo; cualquier otro valor detiene el servidor en el arranque. Tiene prioridad sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | El tiempo máximo que espera un cambio antes de la recarga (refetch) que lo entrega a los suscriptores activos, en ms. Una recarga espera 300 ms sin cambios, y como máximo este tiempo bajo un flujo constante de escrituras. Un número entero positivo; cualquier otro valor detiene el servidor en el arranque. Tiene prioridad sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Cuánto tiempo se puede reutilizar el total de una suscripción de lista grande antes de que se vuelva a contar, en ms; los fotogramas que lo reutilizan llevan `meta.totalAsOf`. Si no se define, cada fotograma cuenta. Tiene prioridad sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | El total anterior más pequeño al que se aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada fotograma. Tiene prioridad sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback bajo `NODE_ENV=production`. Desactivado, de modo que un arranque en producción falle de forma visible y ruidosa en lugar de conectarse a una base de datos inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Qué hace el arranque con una clave en sus colecciones que esta versión no lee: `warn`, `error` (se niega a arrancar — vale la pena activarlo en CI), o `off`. Solo regula las claves que no *reconoce*, que suelen ser un error tipográfico y ocasionalmente metadatos deliberados; una clave que sabe que se ha movido siempre es fatal, ya que de lo contrario la característica que configuraba quedaría silenciosamente ausente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada de esquema y finaliza sin abrir un socket — la estructura requerida por un Job de migración, a partir de la misma imagen y el mismo bundle que el servidor que le sigue. Un valor vacío equivale a *sin definir*, por lo que un `${SOMETHING}` sin sustituir en un archivo compose no puede convertir un despliegue ordinario en uno que migra y se niega a servir. También crea las tablas que un proceso que sirve crearía en su primer uso, y no arranca cron ni la cola de jobs. Se rechaza junto con <span class="since-badge" data-since="0.26">Desde 0.26</span> `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | <span class="since-badge" data-since="0.26">Desde 0.26</span> Una ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribe en ella cada cambio de esquema que hizo, en orden, como un script SQL para revisar y aplicar con `psql`. Las filas que escribió no se incluyen. Se rechaza en un proceso que sirve. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina —un agente, un job de CI— *aplique* un cambio de esquema a través de `/api/admin/schema`, y no solo planificarlo. Desactivado a menos que se solicite: la credencial que realizaría dicho cambio es la que más probabilidades tiene de estar en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto tiempo puede ejecutarse una función personalizada antes de que se aborte su solicitud. El mismo control que la opción `functionsTimeoutMs`. `0` lo desactiva. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado termine el proceso en lugar de registrarlo. Activo bajo un orquestador que lo reiniciará; inactivo donde un reinicio sea peor que una fuga de memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene el programador cron en ejecución en una plataforma que el runtime de otro modo detecta como de escala a cero (scale-to-zero), donde un temporizador que se dispara en una instancia inactiva no se dispararía en ninguna instancia. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente desde `X-Forwarded-For`. Valor predeterminado a prueba de fallos `0`: sin proxy, confiar en el encabezado permitiría a cualquier emisor falsificar una identidad. | `0` |

:::note[El aprovisionamiento en el arranque es aditivo y no es una herramienta de migración]
La pasada de arranque se ejecuta de forma desatendida sin que nadie revise un diff,
por lo que nunca eliminará una columna, reducirá un tipo ni reescribirá una tabla.
Por esa razón la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`: un push completo
calcula un diff y ejecutará `DROP COLUMN` sin problema, y el reinicio de un
contenedor nunca debe ser capaz de destruir una columna de producción como efecto
secundario de una reprogramación.

Los cambios destructivos o de reestructuración se reservan para donde puedan
revisarse: `rebase db generate` + `rebase db migrate`, o `rebase db push` desde
un checkout o CI, el cual realiza una prueba en seco (dry-run) del cambio, rechaza
los destructivos sin confirmación y puede realizar una copia de seguridad antes.
:::

### Despliegues divididos (Split deployments)

Una sola imagen y un único bundle se pueden arrancar varias veces, cada una
sirviendo una parte diferente del proyecto. Una línea para cada uno aquí, ya que
esta página busca listar cada variable; lo que cada combinación *monta y administra*
—y qué combinaciones se niegan a arrancar— está en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores cron. Si no se define, sigue al rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta los trabajadores de la cola de tareas (job-queue). Si no se define, sigue al rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve únicamente las funciones personalizadas nombradas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | A dónde reenvía el proceso de API una solicitud de función que no sirve él mismo. | — |

### Superficie MCP

Un endpoint opcional (opt-in) del Model Context Protocol en `/mcp`, para que un
cliente de IA pueda leer y escribir en este proyecto **como el usuario autenticado**.
Desactivado a menos que se configure, y —a diferencia de cualquier otra superficie—
ningún `REBASE_ROLE` lo activa: los demás describen la estructura del proceso, mientras
que este representa la decisión de otorgar credenciales a software de terceros, y
debe tomarla una persona en lugar de heredarla de la función asignada a un contenedor.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie se niega a montarse y lo indica en el registro de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede derivarlo: tomar el origen del encabezado `Host` convertiría la identidad del emisor, y la audiencia contra la que se validan sus propios tokens, en un valor proporcionado por quien realiza la solicitud. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse por sí mismo. Establézcalo en `false` para requerir que los clientes se registren previamente. | `true` |

### Edición de esquema en vivo desde un bundle

Desactivado a menos que se configure `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle
compilado no tiene el código fuente de las colecciones para editar, por lo que con
estas variables configuradas, el editor de colecciones del administrador lee el
código fuente del repositorio, confirma cada cambio de vuelta en él y ejecuta su
DDL en esta base de datos. Solo para administradores, y aplicado por una persona
a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Un
repositorio configurado sin una credencial utilizable se niega a arrancar. Consulte
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub en el que se confirmarán los cambios de esquema, en formato `owner/name`. Definirlo es lo que activa la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se aplicará el commit. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Dónde reside el código fuente de las colecciones en ese repositorio, relativo al repo. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token de grano fino con acceso de lectura y escritura al contenido del repositorio. Configure esta variable o las tres variables `_GITHUB_APP_*`, pero no ambas opciones. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de una GitHub App, para hacer commit como la aplicación en lugar de con un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | La instalación de la aplicación en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clave privada de la aplicación: PEM, PEM con saltos de línea escapados o base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Si no se define, las copias de seguridad programadas están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N copias de seguridad más recientes, sin importar lo que indique la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe el binario `pg_dump`: debe ser de la versión principal del servidor o más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe el binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe el binario `psql` que ejecuta `rebase db restore --clean` para que la restauración sea una sola transacción. | — |
| `PG_DUMPALL_PATH` | Dónde reside `pg_dumpall`, cuando no está en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas—, una copia de seguridad de variables globales falla con un error que nombra esta variable. | — |

La imagen oficial de runtime (`rebasepro/server`) incluye las herramientas de
cliente de PostgreSQL 18, por lo que una copia de seguridad programada se ejecuta
en ella contra cualquier servidor hasta Postgres 18. Fuera de la imagen,
instálelas usted mismo (`apt-get install postgresql-client-18`, `brew install libpq`).

Las copias de seguridad contienen secretos y datos de identificación personal (PII).
Utilice un destino privado con cifrado en reposo.

### Entrega del paquete (bundle)

Un despliegue gestionado no incluye su código en la imagen: el runtime obtiene un
bundle en el arranque. Estas variables deciden cuál y cómo.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Lo que establece `rebase start` localmente. | — |
| `REBASE_BUNDLE_URL` | Desde dónde descargar el archivo del bundle, cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial de tipo Bearer para esa descarga. Trátela como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe ser accesible para escritura y sobrevivir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los que declara por sí mismo. | — |

### Vinculaciones de recursos (Resource bindings)

Cada base de datos, bucket y topic que un proyecto declara en `config/resources.ts`
se vincula mediante variables de entorno nombradas a partir de él. Los nombres base
se encuentran a continuación; un recurso que no sea el predeterminado añade `__` y
su clave en mayúsculas, por lo que un bucket llamado `media` lee `S3_BUCKET__MEDIA`.
`rebase status` imprime, por cada recurso, la variable exacta que está leyendo y
si está configurada.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_DRIVER` | El paquete npm que implementa el controlador de una fuente de datos, cuando no es el de Postgres predeterminado. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### El entorno propio de la CLI

Leído por `rebase`, no por el servidor. Nada de lo que está aquí afecta a un despliegue.

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `REBASE_BASE_URL` | A dónde envían la clave de servicio `rebase api-keys`, `rebase storage` y `rebase auth reset-password`, en la shell o en `.env`. Configúrelo cuando el servidor se ejecute de otra manera que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Si no se define, usan el servidor que `rebase dev` registró mientras ese servidor está en ejecución, y no envían nada cuando no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican esos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Un nombre anterior para esa clave. Cuando `.env` la establece, `rebase api-keys` y `rebase storage` la leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla de forma interactiva. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un almacén de secretos pueda suministrarla sin que llegue al historial de la shell. | — |
| `REBASE_TOKEN` | Un token obtenido con `rebase cloud tokens create`. Si se define, cada comando de `rebase cloud` se autentica con él en lugar de la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión guardada. Es la forma de ejecutar `rebase cloud` en CI — consulte [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lee el mismo nombre como un alias de `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la solicitud en lugar del mensaje breve. Es lo primero que debe configurar cuando un comando de `rebase cloud` falle sin suficiente información. | — |
| `REBASE_ATLAS_DEV_URL` | La base de datos vacía contra la que planifican `rebase db push`, `db generate` y `db migrate`, en lugar de la base `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no crea ni elimina una base de datos nombrada aquí, y rechaza una que sea igual a `DATABASE_URL`. En la base de datos de desarrollo administrada, la CLI la establece en un PGlite desechable en memoria propio. Configúrela donde no se conceda el permiso `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada: usted proporciona la suya. Equivale a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que de otro modo `rebase dev` deriva de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend se anuncie antes de indicar que no ha iniciado. `0` desactiva este reporte. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` incluye en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convención compartida entre herramientas. Establézcala en cualquier valor distinto de `0` y la CLI no enviará telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No necesita un archivo, por lo que es la opción indicada para usar en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Dónde se envía la telemetría, para un recolector autoalojado. | — |

## Secretos en desarrollo

`JWT_SECRET` y `REBASE_SERVICE_KEY` son obligatorios en producción y se generan
automáticamente fuera de ella, para que pueda empezar sin tener que configurar nada.

Esos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, e ignorados por git junto con ellos. Anteriormente,
se regeneraban en cada arranque, por lo que reiniciar el servidor de desarrollo cerraba
la sesión en su propia aplicación e invalidaba cualquier clave de API recién creada.

- Si define cualquiera de las dos variables explícitamente, se utilizará la suya; no se guarda ni lee nada de la caché.
- Apunte la caché a otra ubicación con `REBASE_DEV_SECRETS_FILE` — una ruta, y la
  única variable de esta sección que configuraría deliberadamente.
- Elimine el archivo para renovar ambos secretos. El siguiente arranque escribirá uno nuevo.
- Si no se puede escribir el archivo —por ejemplo, en un contenedor de solo lectura—, el servidor
  arranca de todos modos con un secreto efímero, exactamente como solía hacerlo.

Nada se almacena en caché en producción, ni bajo un ejecutor de pruebas. En producción, un
arranque que deba generar cualquiera de los secretos seguirá fallando, nombrando la
variable correspondiente, y eso no cambia:

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

Las mismas opciones,
sin `app`, `server` ni `basePath` y con un `provision` obligatorio, construyen un
backend que no sirve nada hasta que lo monte: `createRebaseBackend`. Consulte
[Integración de servidor personalizado](/docs/backend/custom-server/).

### Modificar `basePath`

`basePath` mueve cada ruta de la API, por lo que se le debe indicar lo mismo al cliente;
de lo contrario, seguirá solicitando `/api/...` y recibirá un error 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma esto automáticamente del cliente que se le proporciona; no requiere
más configuración. Si construye una URL de solicitud manualmente, únala desde el cliente en lugar
de escribir `/api` directamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista CMS en hoja de cálculo carga los datos correctamente.
* **Causa:** De forma predeterminada, Rebase intenta ejecutar las consultas del Editor SQL cambiando temporalmente los roles de la base de datos para que coincidan con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utiliza autenticación personalizada donde los roles solo existen en tablas de la base de datos en lugar de ser roles reales de PostgreSQL, el cambio de rol falla o faltan privilegios en la base de datos. La vista de hoja de cálculo del CMS se ejecuta con el usuario propietario de la conexión predeterminado y omite esto.
* **Solución:** Añada `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de su backend. Esto obliga a Rebase a ejecutar las consultas del Editor SQL utilizando los privilegios del propietario de la conexión (normalmente un superusuario/owner). El Editor SQL indicará entonces, sobre los resultados, que se leyeron como el propietario de la conexión y deshabilitará el selector de roles.

### Error al obtener el esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no puede cargar el árbol del esquema, o el Editor SQL arroja `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se proporciona `adminConnectionString` al bootstrapper, o si se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
* **Solución:** Asegúrese de que `adminConnectionString` esté configurado durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Pasos siguientes

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Descripción general del backend](/docs/backend)** — Referencia completa de configuración del backend
