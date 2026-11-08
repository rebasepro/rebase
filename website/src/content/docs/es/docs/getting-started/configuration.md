---
sourceHash: 0e81d6a2d1e7dc57
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en su archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto
> que no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecute el backend. Un proyecto iniciado por
> el runtime (`rebase dev`, `rebase start`, la imagen publicada) utiliza el
> esquema que pertenece al runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas mostradas abajo. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede agregar allí sus
> propias variables tipadas.

### Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos bajo `.rebase/`. Requerida en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utilice una cadena aleatoria segura (mínimo 32 caracteres). **Requerida en producción** (se genera automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis de node-postgres, no de libpq.**
>
> Rebase y el controlador de Node la aceptan: cifran, pero no verifican el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no la aceptan y no
> se degradan a un modo alternativo: se niegan a iniciar con `invalid sslmode value: "no-verify"`.
>
> Los comandos propios de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben a la equivalente `sslmode=require` antes de invocar la terminal,
> por lo que funcionan con la URL tal como está configurada. Usar `psql` manualmente no
> lo hace; sustitúyala por `sslmode=require` en ese caso, la cual cifra sin verificar
> exactamente de la misma manera.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Establézcala solo en desarrollo**; consulte a continuación. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID de Google OAuth. Habilita "Iniciar sesión con Google". | — |

> **Deje `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API comparte el mismo origen que la página y el cliente la resuelve de esa manera por su cuenta.
>
> Incluir una URL absoluta en el bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga la página desde
> `example.com` y llama a la API en `example.rebase.website`, lo que constituye una solicitud de
> origen cruzado (cross-origin), provocando que cada petición falle en el preflight. Permitir el origen en CORS
> **no** lo soluciona: la cookie de actualización tiene `SameSite=Lax` y no se envía entre distintos
> sitios, por lo que eliminaría los errores de consola pero mantendría la autenticación rota. Si no
> se define, cualquier dominio que apunte a la aplicación funciona sin necesidad de configuración CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente desde el entorno del shell** — un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de cargar dicho archivo — y de lo contrario se vincula a un puerto derivado de la ruta del proyecto, permitiendo ejecutar varios proyectos a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica el valor utilizado. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de registros: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia con error se oculta por defecto, ya que una consulta fallida contiene sus parámetros vinculados (un correo, un hash de contraseña). Establézcalo en `true` mientras diagnostica un fallo de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Requerida en producción** a menos que se defina `FRONTEND_URL`: un arranque en producción sin ninguna de las dos se negará a iniciar. En desarrollo se *añade a* localhost; consulte más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos de nivel administrativo (utilizada para introspección de esquemas y operaciones de administración). La base de datos indicada no es la que la consola SQL considera actual, ni la que una nueva rama copia por defecto: ambas corresponden a la base de datos a la que está conectada la propia aplicación (consulte `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de roles de PostgreSQL en el Editor SQL (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas desde ella por defecto, permitiendo que el panel de Ramas de Studio muestre las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, además de lo que defina `CORS_ORIGINS` (o `FRONTEND_URL`)**;
la misma lista que utiliza producción, sumando localhost en lugar de reemplazarlo. De este modo,
la variable funciona igual en ambos entornos, y los casos que la requieren en desarrollo son los habituales:

```bash
# Un teléfono en la LAN, la máquina de un colega, un túnel ngrok,
# un puerto redirigido de Codespaces: todos son orígenes distintos de localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Cualquier origen que no sea localhost ni esté incluido en la lista será rechazado, y el rechazo se
registrará **una vez por origen** junto con la línea exacta que lo permitiría. El rechazo no
es una precaución arbitraria: la API envía credenciales, por lo que reflejar un `Origin`
arbitrario permitiría que cualquier sitio que el desarrollador visite realice solicitudes
autenticadas contra el servidor de desarrollo utilizando su sesión y lea las respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (requerido en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), permitiendo que cualquier entidad con el JWKS verifique una sesión sin poder emitir una nueva. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n`, o en formato base64 de todo el PEM. Sin esto, los tokens se mantienen como HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en el encabezado del token y en el JWKS. Modifíquelo cada vez que cambie la clave: la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Es deslizante: cada rotación lo renueva, por lo que determina cuánto tiempo sobrevive una sesión ante la **inactividad**. Establezca `400d` para sesiones que deban persistir tras una ausencia prolongada; los navegadores limitan la cookie de actualización a ese período. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, independientemente de este valor: una tabla de usuarios vacía debe admitir a alguien, y esa persona se convierte en administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto se considera ordinaria, y el administrador se especifica mediante `REBASE_ADMIN_EMAIL` (abajo) o se asigna con la clave de servicio. El archivo `.env.example` del scaffold lo establece en `true`; el valor predeterminado del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de apagado completo. Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja abierta deliberadamente fuera de producción, impidiendo el registro incluso con una base de datos vacía. Debe combinarse con `REBASE_ADMIN_EMAIL` a continuación, o la instancia no tendrá forma de crear su primer usuario autenticado. Cada artefacto de despliegue distribuido lo incluye activado. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada al arrancar **mientras la tabla de usuarios permanezca vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador define la primera cuenta en lugar de exponerla al registro público. El arranque emite una advertencia si la tabla está vacía en producción y esto no está configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para dicha cuenta. Debe contener al menos 12 caracteres, o de lo contrario se rechazará y no se creará la cuenta. Cámbiela tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se establece, los secretos se cifran con `JWT_SECRET` y el arranque advertirá de ello: rotar `JWT_SECRET` cerraría la sesión de todos los usuarios *e* imposibilitaría descifrar cada autenticador registrado. Configure una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien active MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave que se está reemplazando durante una rotación. Defina ambas durante una rotación: los nuevos secretos se escribirán con `MFA_ENCRYPTION_KEY` y los existentes seguirán siendo legibles, evitando que los usuarios queden bloqueados en medio de la transición. Elimínela una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional, y no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establézcalo en `false` para una superficie de lectura completamente pública; RLS seguirá aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para emisores autenticados; nunca devuelve el correo, roles o metadatos del usuario encontrado. Desactivado por defecto: representa una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo debe utilizarse con un frontend en un dominio completamente diferente. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` en la cookie de actualización. Activado por defecto; `AUTH_COOKIE_SECURE=false` para HTTP simple, como un despliegue en una dirección LAN donde el navegador de otro modo descartaría la cookie y la sesión finalizaría al expirar el token de acceso sin emitir error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID de GitLab OAuth. La URL base (`baseUrl`) para una instancia autohospedada no se configura mediante variables de entorno; configure GitLab dentro del bloque `auth` para ese propósito. | — |
| `GITLAB_CLIENT_SECRET` | Client secret de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple, para inicio de sesión web. Es público y se expone en `GET /auth/config`. Apple no utiliza un client secret estático, ya que Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por lo tanto, Apple requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de esta variable o `APPLE_BUNDLE_IDS`; sin ellos, no se configurará nada. | — |
| `APPLE_BUNDLE_IDS` | Identificadores de bundle separados por comas de las aplicaciones nativas de iOS/macOS cuyos códigos de Sign in with Apple son aceptados. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, el emisor (issuer) del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se aceptan secuencias de escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave estática de API de administrador. Omite la autenticación JWT estándar para llamadas servidor a servidor cuando se envía como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) con la que se verifican los tokens de plataforma `rpt_`; puede contener varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la puerta de administración acepte un token de plataforma para `cron:read` y nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto con el que debe coincidir el `aud` de un token de plataforma, para rechazar tokens emitidos para otro proyecto. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa de autenticación: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede inferir su propio recuento de réplicas, por lo que un despliegue con pares debe indicarlo: tres réplicas con el valor por defecto permitirán el triple del límite. Cualquier otro valor **impedirá el arranque** en lugar de usar un fallback, incluyendo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de inicio de sesión con enlace sin contraseña (magic link). Requiere un servicio de correo electrónico configurado para poder enviar el enlace. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña mediante un código de seis dígitos enviado por correo. Mismo requisito de servicio de correo que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de magic link o código de correo para una dirección desconocida crea la cuenta, siempre que el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamiento cuando un token de actualización se reutiliza fuera de su ventana de tolerancia: `reject` (rechazarlo, manteniendo la sesión activa) o `revoke-session` (cerrar la sesión). Cualquier otro valor impedirá el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: impide el inicio de sesión por contraseña hasta verificar la dirección. Requiere servicio de correo; el arranque fallará si no está configurado. | `false` |
| `CAPTCHA_PROVIDER` | Habilita la verificación de captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token enviado por el navegador. Requerido una vez que se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación a proteger, separadas por comas (por ejemplo, `register,login`). Sin definir protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las colecciones están protegidas por RLS de Postgres. El almacenamiento de objetos no tiene un equivalente (las claves comparten un único espacio de nombres plano), por lo que si hay un bucket configurado sin un modelo de acceso, el servidor **se negará a arrancar en producción**. Debe satisfacerse con exactamente una de las siguientes opciones: un hook `storageAuthorize` exportado desde `config/index.ts` (incluido en el scaffold), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` deshabilita el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se resuelve desde el directorio en el que se ejecuta el servidor: la raíz del proyecto bajo `rebase dev`, o `backend/` en un servidor generado tras `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción, únicamente en combinación con un volumen persistente que aloje `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` para buckets locales con nombre | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales es válida la URL de descarga de un archivo privado (el token incluido por `getSignedUrl()`). Máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo que acepta la fuente, en bytes, en cada ruta de subida (`__<KEY>` para una fuente nombrada). Un valor que no sea un número entero de bytes impedirá el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de acceso de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs estilo ruta (path-style) para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Normalmente se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio. Omitir en GCP, donde Workload Identity suministra las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Servir cada objeto públicamente a cualquiera, sin token. Exclusivo para buckets que actúen genuinamente como un CDN público. Una de las tres formas de satisfacer la validación de arranque descrita arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar todos los objetos. Nombrado `INSECURE` en el objeto de configuración por un motivo: solo es admisible en aplicaciones de un único tenant donde se confía en que todas las cuentas tengan acceso total a todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las transformaciones de imágenes generadas (cambios de tamaño, conversiones de formato) en lugar de producirlas en cada petición. | `false` |

### Correo electrónico (opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre visible del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la cabecera de las plantillas de correo predeterminadas. PNG o JPG absoluto en `http(s)`; los clientes descartan SVG y bloquean URIs `data:`. Si no se define, una aplicación llamada `Rebase` mostrará el isotipo de Rebase, y una con nombre modificado no mostrará ninguno |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para establecer una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pooler). Requerida por [Realtime](/docs/backend/realtime): `LISTEN`/`NOTIFY` no funciona a través de un pooler a nivel de transacción como PgBouncer, y sin esta variable las notificaciones de cambio se deshabilitan con una advertencia en lugar de perderse silenciosamente. El [job worker](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Completa el valor `directConnectionString` del adaptador de Postgres cuando no está definido. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando apunta a otro servidor, las lecturas autenticadas (listas, registros individuales, conteos, agregaciones) se sirven desde allí bajo las mismas políticas de seguridad a nivel de fila; las escrituras, autenticación, tiempo real, crons, jobs, la consola SQL y `rebase.sql` se mantienen en la base de datos principal. Si un lector acaba de escribir, leerá de la principal durante `REBASE_READ_STICKY_MS`, y todos leerán de la principal mientras la réplica tenga un retraso superior a `REBASE_READ_MAX_LAG_MS` o falle. Completa `readConnectionString` en el adaptador de Postgres si no está definido; hasta la versión 0.28 inclusive, el pool de la réplica se abría pero nunca se leía de él. | — |
| `REBASE_READ_STICKY_MS` | Tras una escritura, cuánto tiempo se dirigen las lecturas del mismo usuario a la base de datos principal, garantizando que un guardado seguido de una lectura refleje los cambios. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso máximo de la réplica tras el cual todas las lecturas se redirigen a la base de datos principal. | `1000` |
| `DATABASE_POOLED` | `true` cuando `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. El pool omite el envío de `search_path` o `statement_timeout` al conectarse (el pooler los rechazaría o descartaría) y aplica ambos en cada transacción; el arranque asigna al rol de base de datos un `search_path` predeterminado de `public` para sentencias fuera de una transacción. `DATABASE_DIRECT_URL` se vuelve obligatoria, siendo utilizada por tiempo real, la reactivación de trabajadores de jobs, la creación de índices, la ramificación y la consola SQL. Se asume que la URL de la réplica también usa pooling. Utilice `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Límite máximo para todos los pools del proceso, aplicado independientemente de lo solicitado por cada uno. Solo dígitos numéricos: un valor mal formado se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento en tiempo de ejecución

Leído por el runtime: `rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho eject gestiona estas decisiones directamente en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | Si es `true`, ejecuta la [auditoría programada de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule), que reporta tablas servidas sin políticas activas. El proyecto debe declarar `@rebasepro/rls-check` en sus dependencias: el runtime no incluye una copia integrada, y sin el paquete el arranque fallará indicándolo. `false` mantiene deshabilitado el escaneo en este proceso. | — |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. Debe configurarse igual en el cliente; consulte [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir los recursos estáticos y del panel de administración del bundle desde este proceso. Desactívelo si tiene un CDN delante. | `true` |
| `REBASE_HISTORY` | Registrar el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprimir respuestas con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la petición, **en bytes** (`10485760`, no `10MB`; un valor que no sea numérico impedirá el arranque en lugar de eliminar silenciosamente el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI. Triestado: sin definir activa en desarrollo y desactiva en producción; `false` desactiva ambos en cualquier entorno. Tenga en cuenta que `true` en producción expone la **especificación** en `/api/docs` pero no la **interfaz de usuario** de Swagger en `/api/swagger`: la interfaz se condiciona por separado según `NODE_ENV`. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, haciendo que los navegadores rechacen HTTP simple en todos los subdominios del host durante seis meses, incluidos hosts que este proceso no sirve. Actívelo únicamente si todos los subdominios del dominio admiten exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` impedirá el arranque. Consulte [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, deja el endpoint abierto a cualquiera que pueda alcanzar el puerto (aceptable en una red privada, peligroso en una pública, lo cual se notificará en los registros de arranque). | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué acciones puede realizar el runtime sobre el esquema de colecciones al iniciar. `ensure` (predeterminado en todos los entornos, incluida producción) ejecuta el paso **aditivo**: crea tablas, columnas y tipos enum faltantes, sin eliminar ni reescribir nada. `none` no altera el esquema de colecciones, aunque las tablas propias del framework (auth, claves API, jobs, cron) se siguen creando y manteniendo actualizadas; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen publicada solo admite estas dos opciones y **se negará a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso debe aprovisionar, por lo que cualquier otro rol debe configurarse en `none` o impedirá el arranque. | `ensure` |
| `REBASE_PROVISION` | `false` impide que el runtime realice modificaciones en su base de datos: ninguna tabla, columna, índice, función, disparador, política, rol o privilegio, ni al iniciar ni posteriormente, incluidos los del propio framework. En su lugar, informará por nombre de los elementos faltantes. Indicado para bases de datos donde únicamente sus procesos de migración tienen autorización de cambio. Consulte [Cuando solo su proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Impide el arranque si la base de datos se aprovisionó por última vez a partir de un conjunto de colecciones diferente al utilizado para construir este proceso. Sin definir (o cualquier valor distinto de `true`/`1`) emitirá una advertencia en su lugar. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Impide el arranque si un archivo de funciones o cron genera un error o no puede parsearse al importarse, detallando cada archivo y la causa, garantizando que un despliegue progresivo mantenga la versión anterior activa. También aplica a los reinicios. Sin definir (o cualquier valor distinto de `true`) omite el archivo problemático y sirve el resto. Un archivo que se importa limpiamente pero no exporta funciones ni jobs siempre se omite sin detener el arranque. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (habilitar si la conexión lo admite, degradar silenciosamente en caso contrario), `trigger` (forzarlo, advertir si no es posible), `wal` (leer cambios desde el registro write-ahead log en lugar de disparadores; requiere `wal_level=logical` y un rol con permisos de replicación; degrada a `trigger` si falla), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora si se pasó un transporte explícito a `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Número máximo de suscripciones que puede albergar un socket de tiempo real; las adicionales se rechazan con `TOO_MANY_SUBSCRIPTIONS`. Debe ser un número entero positivo; cualquier otro valor detiene el servidor al arrancar. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cantidad de sockets de tiempo real que un usuario o clave de API puede mantener abiertos en una misma instancia de servidor. Los sockets de suplantación de identidad de un administrador computan contra el administrador. Al excederlo, la conexión se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK reintenta automáticamente, reconectando cuando otro socket se cierre. Debe ser un número entero positivo; cualquier otro valor detiene el servidor. Prevalece sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tiempo máximo en milisegundos que un cambio espera antes de volver a consultar los datos para entregarlos a los suscriptores activos. Espera 300 ms si no hay nuevos cambios, y como máximo este tiempo bajo un flujo constante de escrituras. Debe ser un número entero positivo; cualquier otro valor detiene el servidor. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervalo en ms durante el cual se puede reutilizar el total de una suscripción a listas grandes antes de recalcularlo; los frames que lo reutilizan incluyen `meta.totalAsOf`. Si no se define, se cuenta en cada frame. Prevalece sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | Cantidad mínima de filas a partir de la cual aplica `REALTIME_RECOUNT_INTERVAL_MS`; listas con menor cantidad se cuentan en cada frame. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost` o loopback bajo `NODE_ENV=production`. Desactivado por defecto, haciendo que un arranque en producción falle de forma visible en lugar de intentar conectar a una base de datos local inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Tratamiento en el arranque ante una clave en las colecciones que esta versión no reconoce: `warn`, `error` (rechazar el arranque, recomendado para entornos de CI) o `off`. Aplica únicamente a claves no *reconocidas*, que habitualmente son erratas o metadatos intencionales; una clave que se sabe que cambió de lugar siempre causará un fallo crítico, ya que de lo contrario la funcionalidad configurada quedaría inactiva en silencio. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta el paso de esquema y finaliza sin abrir un socket HTTP, ideal para Jobs de migración derivados de la misma imagen y bundle que el servidor posterior. También crea las tablas que un proceso en servicio generaría en su primer uso y omite el inicio de crons o colas de jobs. Un valor vacío equivale a *sin definir*, evitando que un `${SOMETHING}` sin sustituir en un docker-compose transforme un despliegue estándar en uno exclusivo de migración. Incompatible con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) guardará cada cambio de esquema realizado en orden cronológico como un script SQL para su revisión y aplicación manual con `psql`. No incluye las filas de datos insertadas. Incompatible con procesos que sirvan tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que un proceso automatizado (un agente, un flujo de CI) *aplique* cambios de esquema mediante `/api/admin/schema`, en lugar de solo planificarlos. Desactivado salvo configuración explícita: la credencial requerida para tal acción suele ser la más expuesta en variables de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo máximo que puede ejecutarse una función personalizada antes de abortar la petición. Mismo ajuste que la opción `functionsTimeoutMs`. `0` lo desactiva. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado termine el proceso en lugar de solo registrarlo. Recomendado bajo un orquestador que reinicie el contenedor; desaconsejado donde un reinicio sea más perjudicial que una fuga de memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Suprime la advertencia de arranque en plataformas detectadas como scale-to-zero (escalado a cero), donde un temporizador que se active en una instancia inactiva no se ejecutará. No modifica ningún otro comportamiento: actívelo si garantiza mantener siempre al menos una instancia en ejecución. | — |
| `TRUSTED_PROXY_HOPS` | Número de proxies intermedios delante de este servidor, permitiendo al limitador de tasa extraer la dirección IP real del cliente desde `X-Forwarded-For`. Por seguridad su valor por defecto es `0`: sin un proxy, confiar en la cabecera permitiría a cualquier cliente falsificar su identidad. | `0` |

:::note[El aprovisionamiento en el arranque es aditivo y no es una herramienta de migración]
El paso de arranque se ejecuta de forma desatendida sin supervisión humana de las diferencias (diff), por lo que nunca eliminará una columna, reducirá el alcance de un tipo ni reescribirá una tabla. Por este motivo, la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y aplicará libremente `DROP COLUMN`, y el reinicio de un contenedor jamás debe poder destruir columnas de producción por efectos colaterales de reprogramación.

Las modificaciones destructivas o estructurales deben realizarse donde puedan auditarse: mediante `rebase db generate` + `rebase db migrate`, o con `rebase db push` desde un entorno local o CI, el cual evalúa el cambio en seco, rechaza acciones destructivas sin confirmación y permite generar una copia de seguridad previa.
:::

### Despliegues divididos

Una misma imagen y bundle pueden iniciarse múltiples veces, atendiendo cada instancia una parte específica del proyecto. Se incluye una referencia rápida a continuación; el detalle de lo que cada combinación *monta y gestiona* (y qué combinaciones no están permitidas) se describe en **[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte atiende este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir adopta el comportamiento del rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta los workers de colas de jobs. Sin definir adopta el comportamiento del rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Atender únicamente las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atender todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al que el proceso API redirige una petición de función que no atiende localmente. En un `worker`, destino de sus propias llamadas a `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Endpoint opcional para Model Context Protocol en `/mcp`, que permite a un cliente de IA interactuar con este proyecto **en nombre del usuario autenticado**. Desactivado salvo configuración explícita y, a diferencia de otros servicios, ningún `REBASE_ROLE` lo habilita de forma automática: los roles describen la estructura del proceso, mientras que este endpoint implica delegar credenciales a software de terceros, decisión que debe tomar un operador humano.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Habilita la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, no se montará y se advertirá en el registro de inicio. | `false` |
| `REBASE_PUBLIC_URL` | Origen accesible públicamente de este despliegue, p. ej. `https://app.example.com`. No puede inferirse automáticamente: tomar el origen de la cabecera `Host` permitiría que el emisor y la audiencia contra la que se validan los tokens fueran determinados por el cliente. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista personalizada MCP App del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), servida a Claude para renderizar vistas, campos y acciones específicas en lugar de la vista genérica. Si no se define, el backend buscará junto al frontend servido. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Habilita el registro dinámico de clientes OAuth (RFC 7591), permitiendo que un cliente se registre a sí mismo. Establézcalo en `false` para requerir registro previo de clientes. | `true` |

### Edición de esquema en vivo desde un bundle

Desactivado a menos que se defina `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado carece del código fuente de las colecciones para editar, por lo que con estas variables activas, el editor de colecciones del panel de administración leerá el código desde el repositorio, confirmará (commit) los cambios directamente y ejecutará el DDL correspondiente en esta base de datos. Exclusivo para administradores y aplicado manualmente por una persona, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Configurar un repositorio sin credenciales válidas impedirá el arranque. Consulte [Edición de esquema en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositorio de GitHub donde confirmar cambios de esquema, en formato `propietario/nombre`. Al definirlo se activa la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Rama donde se aplicarán los commits. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Ubicación de las colecciones dentro del repositorio, relativa a su raíz. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token de acceso detallado (fine-grained) con permisos de lectura y escritura sobre el repositorio. Defina este token o las tres variables `_GITHUB_APP_*`, pero no ambos métodos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de una GitHub App, para hacer commits como la aplicación en lugar de usar un token personal. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalación de la aplicación en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clave privada de la aplicación: PEM, PEM con saltos de línea escapados, o en base64. | — |

### Copias de seguridad

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para programar copias de seguridad automáticas. Sin definir desactiva la programación. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obligatoria si se define `BACKUP_SCHEDULE`. `rebase db backup` recurre a `./backups` en el directorio de ejecución si no se define. | — |
| `BACKUP_RETENTION_DAYS` | Eliminar copias de seguridad anteriores a N días. Sin definir o `0` conserva todas. | — |
| `BACKUP_KEEP_MINIMUM` | Mantener siempre al menos N copias de seguridad más recientes, independientemente del período de retención. | — |
| `PG_DUMP_PATH` | Ruta alternativa al binario `pg_dump`: debe coincidir con la versión mayor del servidor o ser superior. | — |
| `PG_RESTORE_PATH` | Ruta alternativa al binario `pg_restore`. | — |
| `PSQL_PATH` | Ruta alternativa al binario `psql` que ejecuta `rebase db restore --clean` para realizar la restauración en una sola transacción. | — |
| `PG_DUMPALL_PATH` | Ubicación de `pg_dumpall`, si no está presente en el `PATH`. Sin este binario (y sin las herramientas de cliente de PostgreSQL instaladas), una copia de seguridad de variables globales fallará indicando esta variable. | — |

La imagen oficial de runtime (`rebasepro/server`) incluye las herramientas de cliente de PostgreSQL 18, por lo que las copias programadas funcionan directamente contra cualquier servidor hasta dicha versión. Fuera de la imagen, debe instalarlas manualmente (`apt-get install postgresql-client-18`, `brew install libpq`).

Las copias de seguridad contienen secretos y datos confidenciales. Utilice un destino privado con cifrado en reposo.

### Entrega de bundles

Un despliegue gestionado no incluye su código dentro de la imagen: el runtime descarga el bundle en el arranque. Estas variables controlan el origen y método de descarga.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. La utiliza internamente `rebase start` en local. | — |
| `REBASE_BUNDLE_URL` | Ubicación remota para descargar el archivo del bundle si no existe uno local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para la descarga. Debe tratarse como un secreto: autoriza al tenant a obtener su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directorio donde se extrae el bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el inicio. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime suministra al bundle, más allá de los declarados por este. | — |

### Vinculaciones de recursos

Cada base de datos, bucket y topic declarado en `config/resources.ts` se vincula mediante variables de entorno nombradas según su identificador. Los nombres base se detallan a continuación; los recursos secundarios añaden `__` y su clave en mayúsculas (por ejemplo, un bucket llamado `media` leerá `S3_BUCKET__MEDIA`). `rebase status` muestra, por cada recurso, la variable exacta que está consultando y si está definida.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | Paquete npm que implementa el controlador de una fuente de datos, cuando difiere del adaptador predeterminado de Postgres. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### El entorno propio de la CLI

Leído por `rebase`, no por el servidor. Ninguno de estos valores afecta a un despliegue en ejecución.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | Destino al que comandos como `rebase api-keys`, `rebase storage` y `rebase auth reset-password` envían la clave de servicio, ya sea en el shell o en `.env`. Defínalo si el servidor se ejecuta por medios distintos a `rebase dev` en este proyecto: `rebase start`, un contenedor o un host externo. Si no se define, usarán la instancia registrada por `rebase dev` mientras esté activa, o no enviarán nada si está detenida. | — |
| `REBASE_SERVICE_KEY` | Clave de servicio con la que se autentican dichos comandos, leída desde `.env`: la misma que utiliza el servidor (ver arriba). | — |
| `SERVICE_KEY` | Denominación anterior de dicha clave. Si existe en `.env`, `rebase api-keys` y `rebase storage` la leerán con prioridad sobre `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Ruta al archivo `.env` específico que la CLI debe leer y escribir si difiere del estándar del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` impide que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` en la raíz del repositorio, útil si mantiene dichos archivos manualmente. | on |
| `REBASE_CLOUD_URL` | Plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Cuenta con la que inicia sesión `rebase cloud login`, evitando solicitarla interactivamente. | — |
| `REBASE_CLOUD_PASSWORD` | Contraseña correspondiente, permitiendo suministrarla mediante gestores de secretos sin exponerla en el historial de comandos. | — |
| `REBASE_TOKEN` | Token generado mediante `rebase cloud tokens create`. Al definirse, cualquier comando de `rebase cloud` se autenticará con él en lugar de la sesión interactiva de `rebase cloud login`, sin leer ni alterar las credenciales almacenadas. En un directorio vinculado con `rebase cloud init --claim`, se sustituye por el token específico de dicho proyecto si este no cuenta con permisos sobre el mismo. Es el método recomendado para ejecutar `rebase cloud` en CI; consulte [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo delega a la CLI que invocan sus herramientas cloud y nunca lo transfiere a la aplicación: utilice `REBASE_API_TOKEN` para ese propósito. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la petición en lugar de un mensaje resumido. Recomendado como primer paso ante fallos inesperados de `rebase cloud`. | — |
| `REBASE_ATLAS_DEV_URL` | Base de datos vacía utilizada por `rebase db push`, `db generate` y `db migrate` para calcular diferencias, en sustitución de la base temporal `<db>_dev_diff` que suelen generar junto a `DATABASE_URL`. Rebase no creará ni eliminará una base de datos aquí indicada, y rechazará un valor idéntico a `DATABASE_URL`. Para la base de datos de desarrollo gestionada, la CLI utiliza una instancia interna descartable en memoria (PGlite). Configúrela en entornos donde no disponga del permiso `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona esquemas, requiriendo una instancia externa. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que de otro modo `rebase dev` deduce de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tiempo que `rebase dev` espera a que el backend reporte disponibilidad antes de notificar que no ha iniciado. `0` deshabilita esta comprobación. | `30000` |
| `DATABASE_PASSWORD` | Contraseña que `rebase dev --docker` incorpora en la cadena de conexión generada a partir de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Estándar global entre herramientas. Cualquier valor distinto de `0` desactiva completamente el envío de telemetría de la CLI. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente específico para Rebase. No requiere persistencia en archivos, siendo la opción indicada para entornos de CI y contenedores. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destino para el envío de métricas de telemetría si utiliza un recolector propio. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY`
se generan automáticamente en desarrollo para permitir comenzar a trabajar sin configuración previa.

Los valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y están excluidos del control de versiones mediante `.gitignore`.
Anteriormente se regeneraban en cada inicio, lo que provocaba que reiniciar el servidor de desarrollo
cerrara la sesión activa e invalidara cualquier clave de API recién creada.

- Si define cualquiera de las dos variables explícitamente, se usará su valor y no se leerá ni guardará nada en la caché.
- Puede redirigir el archivo de caché mediante `REBASE_DEV_SECRETS_FILE` indicando una ruta (la única variable de esta sección concebida para configurarse manualmente).
- Elimine el archivo si desea renovar ambos secretos: el siguiente arranque creará uno nuevo.
- Si el archivo no puede escribirse (por ejemplo, en un contenedor de solo lectura), el servidor iniciará de todos modos con un secreto efímero en memoria.

En producción o bajo ejecutores de pruebas nunca se almacena nada en caché ni se generan valores automáticos:
iniciar sin `JWT_SECRET` provocará un error indicando la variable faltante:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de configuración del backend

El objeto `RebaseBackendConfig` suministrado a `initializeRebaseBackend()` permite el control programático:

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

Las mismas opciones, omitiendo `app`, `server` y `basePath` y requiriendo `provision`,
permiten inicializar una instancia que no sirve tráfico hasta que decida montarla: `createRebaseBackend`.
Consulte [Integración de servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

Modificar `basePath` reubica todas las rutas de la API, por lo que el cliente debe actualizarse en consonancia;
de lo contrario continuará consultando `/api/...` recibiendo respuestas 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración adopta esta configuración a partir del cliente proporcionado,
sin requerir ajustes extra. Si construye URLs de petición de forma manual, resuélvalas mediante el cliente en lugar de concatenar `/api` estáticamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista en hoja de cálculo del CMS carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del Editor SQL alternando temporalmente el rol de base de datos para que coincida con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utiliza autenticación personalizada donde los roles solo existen en tablas y no como roles nativos de PostgreSQL, el cambio de rol falla o carece de permisos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión predeterminado y elude esta restricción.
* **Solución:** Añada `DISABLE_DB_ROLE_SWITCHING=true` al archivo `.env` del backend. Esto fuerza a Rebase a ejecutar las consultas del Editor SQL usando los privilegios del propietario de la conexión (habitualmente un superusuario o propietario). El Editor SQL reflejará sobre los resultados que fueron leídos con los privilegios del propietario de la conexión y deshabilitará el selector de roles.

### Fallo al obtener el esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol de esquema o el Editor SQL arroja `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos de gestión. Si no se define `adminConnectionString` en el bootstrapper o `getAdmin()` se sobrescribe para devolver `undefined`, estas operaciones fallarán.
* **Solución:** Asegúrese de definir `adminConnectionString` durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Siguientes pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía para despliegues en producción
- **[Información general del backend](/docs/backend)** — Referencia completa de configuración del backend
