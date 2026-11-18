---
sourceHash: 0309acf690d3fb3f
title: Entorno y Configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de Entorno

Toda la configuración se realiza mediante variables de entorno en su archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecute el backend. Un proyecto arrancado por
> el runtime (`rebase dev`, `rebase start`, la imagen publicada) utiliza el
> esquema del propio runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas mostradas abajo. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede añadir allí sus
> propias variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL. **Opcional en desarrollo** — si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utilice una cadena aleatoria robusta (mínimo 32 caracteres). **Obligatoria en producción** (se autogenera en desarrollo). | `a1b2c3d4e5...` |

> Por defecto, node-postgres comprueba el certificado con `sslmode=require`. Las
> herramientas de libpq, como `psql`, aceptan `require` con comprobaciones más
> débiles y rechazan `no-verify`. Usa
> `sslmode=verify-full&sslrootcert=/path/to/ca.pem` para verificar la CA y el nombre
> del servidor. Para cifrar sin verificar el certificado, configura
> `sslmode=no-verify` en Rebase. Rebase pasa `sslmode=require` a Ptah Compat y a las
> herramientas de copia y restauración de PostgreSQL. Usa `sslmode=require` en
> llamadas directas a libpq.

### Frontend

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Defina esto solo en desarrollo** — consulte más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID de Google OAuth. Habilita "Iniciar sesión con Google". | — |

> **Deje `VITE_API_URL` sin definir en las compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor de
> desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, de modo que la
> API comparte el mismo origen que la página y el cliente la resuelve así por sí mismo.
>
> Incrustar una URL absoluta en un bundle de producción funciona bien hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado cargaría la página desde
> `example.com` y llamaría a la API en `example.rebase.website`, lo que genera una petición
> cross-origin y hace que fallen las solicitudes preflight. Permitir el origen en CORS
> **no** lo soluciona — la cookie de actualización tiene `SameSite=Lax` y no se envía entre
> sitios distintos, por lo que eliminaría los errores de consola pero la autenticación seguiría
> rota. Sin definir, cualquier dominio que apunte a la aplicación funciona sin necesidad de
> configuración CORS.

### Backend

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — no lee `PORT` en `.env` porque el puerto se resuelve antes de cargar dicho archivo; en su defecto, vincula un puerto derivado de la ruta del proyecto para permitir ejecutar varios proyectos simultáneamente. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica el puerto utilizado. | `3001` |
| `LOG_LEVEL` | Nivel de detalle del log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL tras una línea `Failed query: [redacted]`. Cada sentencia fallida se oculta por defecto porque una consulta errónea incluye sus parámetros enlazados (un correo electrónico, un hash de contraseña). Establézcalo en `true` al diagnosticar un fallo de DDL, RLS o de captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** a menos que se defina `FRONTEND_URL`: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *añade a* localhost — consulte más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos con nivel de administrador (utilizada para introspección del esquema y operaciones administrativas). La base de datos que nombra no es la que la consola SQL considera actual, ni la que una nueva rama copia por defecto: ambas corresponden a la base de datos en la que reside la conexión de la propia aplicación (consulte `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desactiva el cambio de roles de PostgreSQL en el Editor SQL (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la define en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas a partir de ella por defecto, de modo que el panel de Ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, además de lo que defina `CORS_ORIGINS` (o `FRONTEND_URL`)** —la
misma lista que utiliza producción, agregando localhost en lugar de sustituirlo. De este modo,
la variable funciona igual en ambos entornos, y los casos que la requieren en desarrollo son los habituales:

```bash
# Un teléfono en la LAN, la máquina de un colega, un túnel de ngrok,
# un puerto redirigido de Codespaces — todos orígenes distintos a localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté en la lista será rechazado, y el rechazo se
registrará en el log **una vez por origen** junto con la línea exacta necesaria para permitirlo. El rechazo no
es una precaución infundada: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría a cualquier sitio web que visite el desarrollador realizar peticiones
autenticadas contra el servidor de desarrollo utilizando su sesión y leer las respuestas.

### Autenticación

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `JWT_SECRET` | Secreto para la firma de JWT (obligatorio en producción, autogenerado en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada en formato PEM para firmar tokens de acceso asimétricamente (RS256), de modo que cualquiera que disponga del JWKS pueda verificar una sesión sin poder emitirla. Acepta un PEM con saltos de línea reales, un PEM con secuencias de escape `\n` o el PEM completo en base64. Sin esto, los tokens se mantienen en HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Modifíquelo cada vez que cambie la clave: la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Deslizante — cada rotación lo renueva, por lo que rige cuánto tiempo sobrevive una sesión ante la **inactividad**. Defina `400d` para sesiones que deban perdurar tras una larga ausencia; los navegadores limitan la cookie de actualización a ese plazo. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar el valor de esta variable — una tabla de usuarios vacía debe admitir a alguien, y esa persona se convierte en administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto pasa a ser una cuenta corriente, y el administrador se especifica con `REBASE_ADMIN_EMAIL` más abajo o se asigna mediante la service key. El archivo `.env.example` del scaffold lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor general. Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja deliberadamente abierta fuera de producción, impidiendo el registro incluso contra una base de datos vacía. Combínelo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de generar su primer emisor autenticado. Todos los artefactos de despliegue distribuidos lo incluyen activado. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada en el arranque **mientras la tabla de usuarios siga vacía** y nunca después. Así es como un despliegue en producción obtiene a su administrador: el operador define la primera cuenta en lugar de exponerla al público en internet. El arranque advierte si la tabla está vacía en producción y esta variable no está definida. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Mínimo 12 caracteres; de lo contrario será rechazada y la cuenta no se creará. Modifíquela tras iniciar sesión por primera vez. | — |
| `MFA_ENCRYPTION_KEY` | Cifra todos los secretos TOTP almacenados. Si no se define, los secretos se cifran con `JWT_SECRET` y el arranque mostrará una advertencia única — por tanto, rotar `JWT_SECRET` cerrará la sesión de todos los usuarios *y* hará indescifrable cualquier autenticador vinculado. Configure una clave dedicada (más de 32 caracteres aleatorios) antes de que ningún usuario active MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave anterior desde la cual se está realizando la rotación. Defina ambas durante una rotación: los nuevos secretos se escribirán con `MFA_ENCRYPTION_KEY` y los existentes seguirán siendo legibles, evitando que nadie quede bloqueado fuera de su cuenta durante el proceso. Elimínela una vez que todos los secretos se hayan recifrado. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional por configuración y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establézcalo en `false` para una superficie de lectura completamente pública; RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se indica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para emisores autenticados; nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto: constituye una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Valor `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y solo debe utilizarse para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Valor `Secure` en la cookie de actualización. Activado por defecto; use `AUTH_COOKIE_SECURE=false` para http simple — por ejemplo, un despliegue en una dirección LAN donde el navegador descartaría la cookie y la sesión moriría al expirar el token de acceso sin emitir ningún error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID de Google OAuth (validación en el backend) | — |
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
| `GITLAB_CLIENT_ID` | Client ID de GitLab OAuth. La URL base (`baseUrl`) de una instancia autoalojada no se puede especificar por entorno — configure GitLab en el bloque `auth` para ese caso. | — |
| `GITLAB_CLIENT_SECRET` | Client secret de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple, para inicio de sesión web. Es público y se expone en `GET /auth/config`. Apple no utiliza un client secret estático, ya que Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por lo tanto, Apple requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, sumado a esta variable o a `APPLE_BUNDLE_IDS`, y no se configurará nada sin ellas. | — |
| `APPLE_BUNDLE_IDS` | Bundle IDs separados por comas de las aplicaciones nativas de iOS/macOS cuyos códigos de Sign in with Apple son aceptados. | — |
| `APPLE_TEAM_ID` | ID del equipo de desarrollo de Apple (emisor del JWT). | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se admiten secuencias `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave API estática de administrador. Omite la autenticación JWT habitual para llamadas entre servidores cuando se envía como `Authorization: Bearer <key>`. (Autogenerada en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene datos secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que el control de administración acepte un token de plataforma para `cron:read`, y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto con el que debe coincidir el valor `aud` de un token de plataforma, de modo que se rechace un token emitido para otro proyecto. Si solo se define una de las dos variables, el servidor arrancará, registrará una advertencia y responderá a cualquier token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde se guardan los contadores de límite de tasa, tanto para las rutas de autenticación como para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede conocer su propio recuento de réplicas, por lo que un despliegue distribuido debe indicarlo — tres réplicas con el valor por defecto aplicarán el triple del límite. Cualquier otro valor **impedirá el arranque** en lugar de usar un valor de reserva, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita el flujo de inicio de sesión con enlace mágico sin contraseña. Requiere un servicio de correo electrónico configurado para poder enviar el enlace. | `false` |
| `AUTH_EMAIL_OTP` | Habilita el inicio de sesión sin contraseña mediante un código de seis dígitos enviado por correo. Mismo requisito de correo electrónico que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de enlace mágico o código de correo para una dirección desconocida creará la cuenta, siempre que el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamiento cuando se reutiliza un token de actualización fuera de su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (cerrar la sesión). Cualquier otro valor impedirá el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite el inicio de sesión con contraseña hasta verificar la dirección de correo. Requiere servicio de correo; el arranque fallará si no está configurado. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación mediante captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | Secreto del proveedor, utilizado en el servidor para verificar el token enviado por el navegador. Obligatorio una vez definido `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas que se protegerán (por ejemplo `register,login`). Sin definir protege el conjunto predeterminado del proveedor. | — |

### Almacenamiento (Storage)

:::caution[Storage no dispone de seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las tablas están protegidas por Postgres RLS. El almacenamiento de objetos no tiene un equivalente —
las claves comparten un único espacio de nombres plano —, por lo que con un bucket configurado y sin modelo de acceso,
el servidor **se negará a arrancar en producción**. Debe cumplir exactamente con una de estas opciones:
un hook `storageAuthorize` exportado desde `backend/storage.ts` (incluido en el scaffold
por defecto), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` desactiva el almacenamiento a menos que se defina `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Las rutas relativas se resuelven desde el directorio donde se ejecuta el servidor: la raíz del proyecto en `rebase dev`, o `backend/` en un servidor generado tras `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción — solo mediante un volumen persistente que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` para buckets locales con nombre contiguos | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales la URL de descarga de un archivo privado es válida (el token generado por `getSignedUrl()`). Máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamaño máximo de archivo que acepta el origen, en bytes, para todas las rutas de subida (`__<KEY>` para orígenes con nombre). Un valor que no sea un número entero de bytes impedirá el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de acceso de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto GCP. Generalmente se deduce de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta al archivo de clave de la cuenta de servicio. Omitir en GCP si Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Servir todos los objetos a cualquiera, sin token. Solo para un bucket que actúe genuinamente como una CDN pública. Es una de las tres formas de satisfacer la validación de arranque descrita arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite a cualquier usuario autenticado leer, escribir, listar y eliminar todos los objetos. Denominado `INSECURE` en el objeto de configuración con motivo: solo es admisible en aplicaciones de un único inquilino donde todas las cuentas gozan de plena confianza sobre todos los archivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las representaciones de imágenes generadas (redimensionamientos, conversiones de formato) en lugar de procesarlas por cada petición. | `false` |

### Correo Electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre visible en la dirección del remitente |
| `APP_NAME` | Nombre del producto usado en asuntos y cuerpos de correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la cabecera de las plantillas de correo por defecto. URL absoluta `http(s)` en PNG o JPG — los clientes de correo eliminan SVG y bloquean URIs `data:`. Si no se define, una app llamada `Rebase` mostrará el logotipo de Rebase y una con otro nombre no mostrará ninguno |

### Pool de conexiones a la base de datos

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `DB_POOL_MAX` | Número máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) requiere una: `LISTEN`/`NOTIFY` no funciona a través de un pooler en modo transacción como PgBouncer, y sin ella las notificaciones de cambio se deshabilitan mostrando una advertencia en lugar de perderse en silencio. El [job worker](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Rellena el `directConnectionString` del adaptador de Postgres si este no está definido. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando apunta a otro servidor, las lecturas autenticadas (listados, filas individuales, recuentos, agregaciones) se sirven allí bajo la misma seguridad a nivel de fila; las escrituras, inicio de sesión, tiempo real, crons, jobs, la consola SQL y `rebase.sql` se mantienen en la base primaria. Un usuario que acaba de escribir leerá de la primaria durante `REBASE_READ_STICKY_MS`, y todos lo harán mientras la réplica tenga un retraso mayor a `REBASE_READ_MAX_LAG_MS` o presente fallos. Rellena el `readConnectionString` del adaptador de Postgres cuando no está definido; hasta la versión 0.28 incluida, el pool de la réplica se abría pero nunca se leía de él. | — |
| `REBASE_READ_STICKY_MS` | Tras una escritura, tiempo durante el cual las lecturas de ese mismo usuario se dirigen a la primaria, asegurando que un guardado seguido de un listado refleje los cambios. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso máximo de la réplica a partir del cual todas las lecturas se redirigen a la primaria. | `1000` |
| `DATABASE_POOLED` | `true` cuando `DATABASE_URL` pasa por un pooler en modo transacción como PgBouncer. El pool no enviará `search_path` ni `statement_timeout` al conectar (el pooler los rechazaría o descartaría) y configurará ambos en cada transacción; el arranque asigna al rol de base de datos un `search_path` por defecto de `public` para sentencias ejecutadas fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser obligatoria, y el tiempo real, la reactivación del job worker, la creación de índices, las ramas y la consola SQL la utilizarán. Se asume que la URL de la réplica también usa pool. Utilice `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Límite máximo para todos los pools del proceso, aplicado independientemente de lo solicitado por cada uno. Solo dígitos simples: un valor incorrecto se ignorará en lugar de serializar el servidor silenciosamente. | — |

### Comportamiento del Runtime

Leído por el runtime — `rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho eject gestiona estas decisiones en su propio código.

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría programada de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule), que reporta tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` en sus dependencias: el runtime no incluye una copia, y sin dicho paquete el arranque fallará indicando el motivo. `false` desactiva el escaneo en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | El rol de Postgres con el que se ejecutan las peticiones autenticadas y anónimas. Asigne uno propio a cada proyecto en un cluster compartido. La base de datos registra el rol con el que opera, y un arranque configurado para otro se negará a iniciar hasta que `rebase db request-role migrate` lo traslade. Consulte [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de petición y permite que la conexión cambie a él; `never` deja ambos pasos a su cargo y solo verifica su existencia. | `auto` |
| `REBASE_RLS_GRANTS` | Privilegios que Rebase otorga al rol de petición: `schema` (todas las tablas en los esquemas servidos, más privilegios por defecto), `managed` (solo las tablas que sirve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al rol o roles de petición, de modo que otros roles que lean las mismas tablas no obtengan acceso a través de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` crea las políticas que solo el contexto del servidor o un admin pueden superar con `TO public`, y ejecuta a los administradores bajo el rol de petición. Por defecto se definen como `TO rebase_admin`, permitiendo que las lecturas limitadas por propietario de los usuarios autenticados aprovechen el índice del propietario. Consulte [Peticiones de administrador y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política base de servidor o administrador de todas las tablas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` también establece `request.jwt.claims` y `request.jwt.claim.*`, permitiendo que las políticas escritas con `auth.uid()` reconozcan al emisor. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Acción a tomar durante el arranque si otro login puede cambiar al rol de petición: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para todas las rutas de la API. El cliente debe configurarse de la misma forma — consulte [Modificar `basePath`](#modificar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir los archivos estáticos/de administración del bundle desde este proceso. Desactívelo si tiene una CDN por delante. | `true` |
| `REBASE_HISTORY` | Registrar el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas comprimidas con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` activa las [notificaciones push](/docs/backend/push-notifications/): las rutas `/api/push`, la tabla `rebase.push_subscriptions` y `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Par de claves VAPID con las que se firman los mensajes push. Fuera de producción se genera un par en `.rebase-dev-secrets.json` si no se definen; en producción el servicio push no arrancará sin ellas. | — |
| `REBASE_VAPID_SUBJECT` | Dirección `mailto:` o URL `https://` con la que los servicios push puedan contactar. Por defecto toma el origen de un `REBASE_PUBLIC_URL` con `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la petición, **en bytes** (`10485760`, no `10MB` — un valor no numérico impedirá el arranque en lugar de eliminar el límite silenciosamente). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI. Tres estados. Sin definir, en cualquier entorno: `/api/docs` se sirve a los emisores a los que `GET /api/schema/tables` describe tablas (cada uno con la documentación de las tablas descritas) y no hay Swagger UI. `true` publica el documento completo para todo el mundo, con la **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento protegido tras el acceso de administración. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, obligando a los navegadores a rechazar HTTP plano en todos los subdominios del host durante seis meses —incluidos hosts no servidos por este proceso. Actívelo únicamente si todos los subdominios del dominio funcionan exclusivamente con HTTPS. Cualquier valor que no sea `true`/`false` impedirá el arranque. Consulte [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer de protección para `/metrics`. Sin definir deja el endpoint abierto a cualquiera que alcance el puerto —adecuado en una red privada, no en una pública; el log de arranque emitirá una advertencia. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operaciones permitidas sobre el esquema de las tablas en el arranque. `ensure` (por defecto en todas partes, incluida producción) ejecuta la pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, sin eliminar ni reescribir nunca nada. `none` no modifica el esquema de las tablas declaradas, aunque las tablas propias del framework (auth, API keys, jobs, cron) se siguen creando y manteniendo actualizadas; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen publicada solo acepta estas dos opciones y **se negará a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que los demás roles deben definirse como `none` o fallarán al iniciar. | `ensure` |
| `REBASE_PROVISION` | `false` hace que el runtime no altere nada en su base de datos: ninguna tabla, columna, índice, función, disparador, política, rol o privilegio, ni al arrancar ni después, incluidas las propias del framework. En su lugar, indicará por su nombre qué elementos faltan. Pensado para bases de datos donde solo su proceso de cambios tiene permisos para modificar la estructura. Consulte [Cuando solo su proceso de cambios puede alterar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Impide el arranque si la base de datos fue aprovisionada por última vez con un conjunto de tablas diferente al que compiló este proceso. Si no está definido (o es distinto de `true`/`1`), solo emitirá una advertencia. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Impide el arranque si un archivo de función o de cron genera un error o no se parsea al importar, indicando cada archivo y el motivo, de modo que un despliegue continuo mantenga activa la versión anterior. Los reinicios también están sujetos a esto. Si no está definido (o es distinto de `true`), se omite el archivo erróneo y se sirve el resto. Un archivo que se importa correctamente y no exporta funciones ni jobs siempre se omite sin detener el arranque. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (lee cambios del WAL si la base de datos lo permite; si no, usa disparadores; y en última instancia recurre al nivel de aplicación, registrando cada alternativa como info), `trigger` (fuerza disparadores, advierte si no es posible), `wal` (lee cambios del write-ahead log en lugar de usar disparadores; requiere `wal_level=logical` y un rol con permisos de replicación, recurriendo a `trigger` en su defecto), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tiene prioridad sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora si a `realtime.bus` se le proporcionó un transporte ya construido. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Número de suscripciones permitidas en un único socket de tiempo real; las siguientes se rechazan con `TOO_MANY_SUBSCRIPTIONS`. Debe ser un entero positivo; cualquier otro valor detiene el servidor al arrancar. Tiene prioridad sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cantidad de sockets de tiempo real que un usuario o API key puede mantener abiertos en una instancia de servidor. Los sockets de suplantación de identidad de un administrador computan contra el propio administrador. Las solicitudes adicionales verán rechazado su inicio de sesión con `TOO_MANY_SOCKETS` y el socket se cerrará (4002); el SDK continuará reintentando, conectándose cuando otro se cierre. Debe ser un entero positivo; cualquier otro valor detiene el servidor al arrancar. Tiene prioridad sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tiempo máximo en ms que un cambio espera por la recarga (refetch) que lo distribuye a los suscriptores activos. Espera 300 ms si no hay cambios, y a lo sumo este límite ante un flujo constante de escrituras. Debe ser un entero positivo; cualquier otro valor detiene el servidor al arrancar. Tiene prioridad sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tiempo en ms durante el cual se puede reutilizar el total de una suscripción a un listado grande antes de volver a contarlo; los frames que lo reutilizan incluyen `meta.totalAsOf`. Sin definir, se cuenta en cada frame. Tiene prioridad sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | Cantidad mínima de filas en el último total a partir de la cual aplica `REALTIME_RECOUNT_INTERVAL_MS`; los listados menores se cuentan en cada frame. Tiene prioridad sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback bajo `NODE_ENV=production`. Desactivado por defecto, haciendo que un arranque en producción falle de forma explícita en lugar de intentar conectar a una base de datos inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada de esquema y finaliza sin abrir un socket — el comportamiento esperado en un Job de migración, usando la misma imagen y bundle que el servidor posterior. También crea las tablas que un proceso activo generaría en su primer uso, y no inicia colas de jobs ni crons. Un valor vacío equivale a *no definido*, evitando que un `${VARIABLE}` no sustituido en un archivo compose convierta un despliegue normal en uno que migra y no sirve tráfico. Se rechaza si se combina con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribirá en él todos los cambios de esquema aplicados, en orden, en forma de script SQL listo para revisar y ejecutar con `psql`. Las filas insertadas no se incluyen. Se rechaza en un proceso que sirve tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina (un agente, un proceso de CI) no solo planifique, sino que también *aplique* un cambio de esquema a través de `/api/admin/schema`. Desactivado a menos que se solicite expresamente: las credenciales con permisos para realizar tales cambios son precisamente las más propensas a estar expuestas en variables de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tiempo máximo de ejecución para una función personalizada antes de abortar su petición. Mismo parámetro que la opción `functionsTimeoutMs`. `0` desactiva el límite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no gestionado termine el proceso en lugar de registrarlo únicamente en el log. Recomendado bajo orquestadores que reinicien el contenedor; desactivado donde un reinicio sea peor que una fuga de memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en plataformas identificadas como de escalado a cero, donde un temporizador que se dispare en una instancia inactiva nunca llegará a ejecutarse. No modifica nada más: actívelo solo si mantiene al menos una instancia en ejecución permanente. | — |
| `TRUSTED_PROXY_HOPS` | Número de proxies situados delante de este servidor, permitiendo al limitador de tasa extraer la dirección IP real del cliente desde `X-Forwarded-For`. Valor por defecto seguro `0`: sin un proxy, confiar en esta cabecera permitiría a cualquier cliente falsificar su identidad. | `0` |

:::note[El aprovisionamiento al arrancar es aditivo y no constituye una herramienta de migración]
La pasada de arranque se ejecuta de forma desatendida y sin revisión manual de diffs, por lo que nunca
eliminará una columna, reducirá el tamaño de un tipo de datos ni reescribirá una tabla. Esa es también la razón
por la que la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y ejecutará
sin problemas un `DROP COLUMN`, y un reinicio de contenedor jamás debe tener la capacidad de destruir
una columna en producción a consecuencia de una reprogramación.

Los cambios destructivos o estructurales deben mantenerse en entornos donde puedan revisarse:
`rebase db generate` + `rebase db migrate`, o `rebase db push` ejecutado desde local o CI,
el cual realiza un ensayo del cambio, rechaza operaciones destructivas sin confirmación previa
y permite generar una copia de seguridad antes de proceder.
:::

### Despliegues Divididos (Split Deployments)

Una misma imagen y un mismo bundle pueden arrancarse varias veces de forma independiente, sirviendo
cada instancia una parte distinta del proyecto. Aquí se listan brevemente; el detalle de qué
*monta y controla* cada combinación —y cuáles combinaciones no están permitidas— se encuentra en
**[Procesos Divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir, sigue la configuración del rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta los workers de la cola de jobs. Sin definir, sigue la configuración del rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Servir únicamente las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino al que el proceso API reenvía una petición de función que no sirve localmente. En un `worker`, determina a dónde van sus llamadas internas a `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Un endpoint opcional de Model Context Protocol en `/mcp`, que permite a un cliente de IA leer
y escribir en este proyecto **actuando como el usuario autenticado**. Desactivado por defecto, y
—a diferencia de otros servicios— ningún `REBASE_ROLE` lo habilita de forma implícita: los roles describen la
forma del proceso, mientras que esta opción implica conceder credenciales a software de
terceros, una decisión que debe tomar una persona y no heredarse del rol asignado a un contenedor.

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `REBASE_MCP_ENABLED` | Habilita la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, el endpoint no se montará e indicará la razón en el log de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, ej. `https://app.example.com`. La superficie MCP no puede derivarlo automáticamente: tomar el origen de la cabecera `Host` haría que la identidad del emisor y la audiencia de verificación de sus tokens fuesen valores suministrados por el cliente. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista personalizada de la MCP App del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), que se servirá a Claude en lugar de la vista genérica para renderizar sus vistas, campos y acciones personalizados. Si no se define, el backend la buscará junto al frontend que sirve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591) para que un cliente pueda registrarse de forma autónoma. Establézcalo en `false` para requerir que los clientes se registren previamente. | `true` |

### Edición de esquema en vivo desde un bundle

Desactivado a menos que se defina `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado carece del
código fuente en `backend/schema` para editar, por lo que con estas variables definidas el editor de esquemas
lee el código desde el repositorio, hace un commit de cada cambio y aplica su DDL en
esta base de datos. Solo administradores, y aplicado por un operador humano a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Indicar un repositorio sin
credenciales válidas impedirá el arranque. Consulte
[Edición de esquema en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub en el que registrar los cambios de esquema, en formato `propietario/nombre`. Definirlo es lo que activa esta funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se confirmará el commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Ubicación de `backend/schema` en dicho repositorio, relativa a la raíz del mismo. Una ruta que apunte fuera del repositorio impedirá el arranque, al igual que la obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token de acceso detallado (fine-grained) con permisos de lectura y escritura en los contenidos del repositorio. Configure esta variable o las tres de `_GITHUB_APP_*`, pero no ambas. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de una GitHub App para realizar commits como la aplicación en lugar de usar un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalación de la GitHub App en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clave privada de la aplicación: en formato PEM, PEM con saltos de línea escapados o en base64. | — |

### Copias de Seguridad (Backups)

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `BACKUP_SCHEDULE` | Expresión cron para programar copias de seguridad automáticas. Sin definir indica que están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obligatoria si se define `BACKUP_SCHEDULE`, que no se ejecutará sin ella. `rebase db backup` recurre a `./backups` en el directorio de ejecución si no se define. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días de antigüedad. Sin definir o en `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos las N copias de seguridad más recientes, independientemente del período de retención. | — |
| `PG_DUMP_PATH` | Sobrescribe la ruta al binario `pg_dump` — debe coincidir con la versión mayor del servidor o ser más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe la ruta al binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe la ruta al binario `psql` que `rebase db restore --clean` ejecuta para envolver la restauración en una sola transacción. | — |
| `PG_DUMPALL_PATH` | Ubicación del ejecutable `pg_dumpall` cuando no se encuentra en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas—, una copia de seguridad de variables globales fallará indicando esta variable. | — |

La imagen oficial del runtime (`rebasepro/server`) incluye las herramientas
de cliente de PostgreSQL 18, permitiendo ejecutar copias programadas contra cualquier servidor hasta Postgres 18.
Fuera de este contenedor, deberá instalarlas por su cuenta (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos y datos de carácter personal (PII). Utilice un destino privado con
cifrado en reposo.

### Distribución del Bundle

Un despliegue administrado no incluye su propio código dentro de la imagen: el runtime descarga el
bundle durante el arranque. Estas variables determinan cuál descargar y cómo procesarlo.

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle previamente descomprimido. Es lo que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | Origen desde donde descargar el archivo del bundle si no existe uno local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial Bearer para autorizar dicha descarga. Debe tratarse como un secreto: autoriza a un inquilino a descargar su propio código fuente. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directorio en el que se descomprime el bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el inicio. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime suministra al bundle, más allá de los declarados por este. | — |

### Vinculación de Recursos (Resource Bindings)

Cada base de datos, bucket y topic declarado en `backend/resources.ts` se
vincula mediante variables de entorno nombradas a partir de dicho recurso. Los nombres base se detallan a continuación;
un recurso que no sea el predeterminado añade `__` y su identificador en mayúsculas: por ejemplo, un bucket llamado
`media` leerá `S3_BUCKET__MEDIA`. El comando `rebase status`
imprime, para cada recurso,
la variable exacta que está leyendo y si se encuentra definida.

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `REBASE_DRIVER` | Paquete npm que implementa el controlador del origen de datos, si difiere del estándar de Postgres. Con sufijo por origen: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### Entorno propio de la CLI

Variables leídas por el comando `rebase`, no por el servidor. Ninguna de estas variables afecta a un despliegue en ejecución.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | A dónde envían `rebase api-keys`, `rebase storage` y `rebase auth reset-password` la clave de servicio, en la shell o en `.env`. Configúralo cuando el servidor se ejecute de otra manera que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Si no se define, usan el servidor que `rebase dev` registró mientras ese servidor está en ejecución, y no envían nada cuando no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican esos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Un nombre anterior para esa clave. Cuando `.env` la establece, `rebase api-keys` y `rebase storage` la leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI cuando no es el del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` impide que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` de la raíz del repositorio, para una raíz cuyos archivos de agentes mantienes manualmente. | on |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla interactivamente. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un almacén de secretos pueda proporcionarla sin que llegue al historial de la shell. | — |
| `REBASE_TOKEN` | Un token generado desde `rebase cloud tokens create`. Configurado, cada comando de `rebase cloud` se autentica con él en lugar de la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión almacenada. En un directorio vinculado mediante `rebase cloud init --claim`, se reserva para el token propio de ese proyecto cuando no tiene alcance sobre el proyecto. La forma de ejecutar `rebase cloud` en CI; consulta [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI que generan sus herramientas en la nube y nunca lo envía a la aplicación: usa `REBASE_API_TOKEN` para eso. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la solicitud en lugar del mensaje breve. Lo primero que se debe configurar cuando un comando de `rebase cloud` falla sin dar información útil. | — |
| `REBASE_ATLAS_DEV_URL` | Base de datos de desarrollo vacía para `db push` y `db generate`. El nombre se conserva para proyectos existentes. Rebase no administra una base indicada aquí y rechaza la URL de destino. PGlite administrado recibe una base desechable en memoria. Úsala si no tienes `CREATE DATABASE`; `db migrate` no la necesita. | `<db>_dev_diff` |
| `PTAH_TRUST_REPLAY_SQL` | Con PostgreSQL externo, incluido un servicio local de Docker Compose, Ptah puede reproducir SQL para `db push`, `db push --dry-run` y `db generate`. Usa `PTAH_DEV_SERVER_DISPOSABLE=1` solo si puedes desechar todo el servidor de desarrollo. En un servidor compartido, `PTAH_TRUST_REPLAY_SQL=1` permite reproducir SQL con los permisos de la conexión de desarrollo. Actívalo solo si confías en ese SQL. PGlite administrado ya es desechable. | — |
| `PTAH_DEV_SERVER_DISPOSABLE` | Establécelo en `1` solo si todo el servidor de desarrollo es desechable. Rebase lo configura automáticamente para su servidor PGlite de desarrollo administrado. | sin configurar |
| `PTAH_ATLAS_ALLOW_UNMATCHED_EXCLUDE` | Rebase lo configura para que una lista de exclusiones funcione aunque falte un objeto. No hace falta configurarlo manualmente. | `1` durante los comandos de base de datos |
| `PTAH_ATLAS_MIGRATE_DIFF_EXCLUDE` | Rebase lo configura a partir de los selectores de objetos protegidos durante `db generate`. No hace falta configurarlo manualmente. | generado |
| `PTAH_ATLAS_MIGRATE_DIFF_INCLUDE` | Rebase lo configura a partir de los selectores de objetos declarados durante `db generate`. No hace falta configurarlo manualmente. | generado |
| `REBASE_PTAH_DEV_PGLITE` | Indicador interno de la conexión de desarrollo PGlite administrada. Rebase lo configura automáticamente. | sin configurar |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada; tú aportas la tuya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo frontend, que de otro modo `rebase dev` deriva de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend se anuncie antes de indicar que no se ha iniciado. `0` desactiva el informe. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` coloca en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convención estándar entre herramientas. Si se establece en cualquier valor que no sea `0`, la CLI no envía telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No necesita ningún archivo, razón por la cual es la indicada para usar en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | A dónde se envía la telemetría, para un colector autoalojado. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY` se
generan automáticamente fuera de ella para que pueda empezar a trabajar sin configuración previa.

Los valores generados se almacenan en caché dentro de `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y están excluidos en git junto a ellos. Anteriormente,
se regeneraban en cada inicio — lo que provocaba que reiniciar el servidor de desarrollo cerrase la sesión en
su aplicación e invalidase cualquier clave de API recién creada.

- Si define cualquiera de estas variables manualmente, se utilizará su valor y no se guardará ni leerá nada de la caché.
- Puede apuntar la caché a otra ruta mediante `REBASE_DEV_SECRETS_FILE` — la única variable
  de esta sección que necesitaría configurar de forma deliberada.
- Borre el archivo para rotar ambos secretos. El siguiente arranque generará uno nuevo.
- Si el archivo no puede escribirse (por ejemplo, en un contenedor de solo lectura), el servidor arrancará
  igualmente con un secreto efímero en memoria, tal como operaba anteriormente.

En producción o bajo ejecutores de tests nunca se almacena nada en caché. En producción tampoco
se genera ningún valor: iniciar sin `JWT_SECRET` fallará indicando la variable faltante,
comportamiento que se mantiene invariable:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de Configuración del Backend

El objeto `RebaseBackendConfig` suministrado a `initializeRebaseBackend()` permite el control programático:

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
omitiendo `app`, `server` y `basePath` y requiriendo obligatoriamente `provision`, construyen un
backend que no atiende peticiones hasta que decida montarlo explícitamente: `createRebaseBackend`. Consulte
[Integración en Servidores Personalizados](/docs/backend/custom-server/).

### Modificar `basePath`

Al cambiar `basePath` se reubican todas las rutas de la API, por lo que el cliente debe actualizarse
consecuentemente; de lo contrario, seguirá haciendo peticiones a `/api/...` y recibirá respuestas 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración tomará este ajuste automáticamente a partir del cliente proporcionado, sin
requerir ajustes adicionales. Si compone URLs de petición de forma manual, constrúyalas usando el cliente en lugar
de escribir `/api` directamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de Problemas

### Permiso Denegado en el Editor SQL (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas en el editor SQL de Rebase Studio fallan con el error `cause: error: permission denied for table <name>`, a pesar de que la vista en hoja de cálculo del CMS carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del Editor SQL alternando temporalmente el rol de la base de datos para que coincida con el rol de aplicación del usuario activo (ej., `SET LOCAL ROLE "admin"`). Si utiliza autenticación personalizada donde los roles solo existen en tablas y no como roles reales de PostgreSQL, el cambio de rol fallará o faltarán privilegios en la base de datos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión predeterminado y omite este mecanismo.
* **Solución:** Añada `DISABLE_DB_ROLE_SWITCHING=true` en el archivo `.env` de su backend. Esto fuerza a Rebase a ejecutar las consultas del Editor SQL utilizando los privilegios del propietario de la conexión (generalmente superuser/owner). El Editor SQL indicará sobre los resultados que se leyeron como el propietario de la conexión y desactivará el selector de roles.

### Error al Obtener el Esquema en el Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no puede cargar el árbol de esquemas o el Editor SQL arroja el error `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios de administrador para consultar los catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se proporciona `adminConnectionString` al bootstrapper, o si se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones no podrán realizarse.
* **Solución:** Asegúrese de definir `adminConnectionString` durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Siguientes Pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Información General del Backend](/docs/backend)** — Referencia completa de configuración del backend
