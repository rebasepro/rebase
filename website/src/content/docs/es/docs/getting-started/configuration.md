---
sourceHash: fa28c44bef748bed
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos de Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al iniciar. Si
> falta algún valor requerido o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> La ubicación del esquema depende de cómo ejecutes el backend. Un proyecto arrancado por
> el runtime — `rebase dev`, `rebase start`, la imagen publicada — utiliza el
> esquema que pertenece al runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de cada tabla a continuación. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede añadir allí sus propias
> variables tipadas.

### Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo** — si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Requerida en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utiliza una cadena aleatoria segura (mínimo 32 caracteres). **Requerida en producción** (se autogenera en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis de node-postgres, no de libpq.**
>
> Rebase y el controlador de Node la aceptan: cifran, pero no verifican el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no lo hacen y no
> degradan la conexión: se niegan a iniciar con `invalid sslmode value: "no-verify"`.
>
> Los comandos propios de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben a la equivalente `sslmode=require` antes de invocar la terminal,
> por lo que funcionan con la URL configurada. Usar `psql` manualmente no lo hace:
> sustitúyelo allí por `sslmode=require`, que cifra sin verificar exactamente
> de la misma manera.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Configura esto solo en desarrollo** — consulta más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor
> de desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, por lo que la
> API es el propio origen de la página y el cliente la resuelve de esa manera por sí mismo.
>
> Incrustar una URL absoluta en un bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga entonces la página desde
> `example.com` y llama a la API en `example.rebase.website`, lo cual es
> cross-origin, haciendo que cada solicitud falle en el preflight. Permitir el origen en CORS
> **tampoco** lo soluciona: la cookie de actualización es `SameSite=Lax` y no se
> envía cross-site, por lo que eliminarías los errores de la consola pero seguirías teniendo la
> autenticación rota. Si no se define, cualquier dominio que apunte a la aplicación funciona sin ninguna
> configuración de CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de que se cargue ese archivo — y de lo contrario vincula un puerto derivado de la ruta del proyecto, de modo que varios proyectos puedan ejecutarse a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica el nivel que utilizó. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de los logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia que falla se oculta por defecto, ya que una consulta fallida lleva sus parámetros vinculados (un correo electrónico, un hash de contraseña). Establécelo en `true` mientras diagnosticas un fallo de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Requerida en producción** a menos que `FRONTEND_URL` esté definida: un arranque en producción sin ninguna de las dos se negará a iniciar. En desarrollo se *añade a* localhost — consulta más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos a nivel de administrador (usada para introspección de esquemas y operaciones de administración). La base de datos que indica no es la que la consola SQL considera actual, ni la que una nueva rama copia por defecto: ambas son la base de datos en la que se encuentra la propia conexión de la aplicación (consulta `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de roles de PostgreSQL en el SQL Editor (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la que se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas desde ella por defecto, de modo que el panel Branches de Studio muestre las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, más lo que indique `CORS_ORIGINS` (o `FRONTEND_URL`)**
— la misma lista que usa producción, con localhost añadido en lugar de
sustituido. Así, la variable funciona de la misma manera en ambos entornos, y los
casos que la necesitan en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté listado será rechazado, y el rechazo se
registra en los logs **una vez por origen** con la línea exacta que lo permitiría. Rechazarlo
no es precaución injustificada: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría que cualquier sitio que el desarrollador visite realice
solicitudes autenticadas contra el servidor de desarrollo con su sesión y lea las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (requerido en producción, autogenerado en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), de modo que cualquiera que posea el JWKS pueda verificar una sesión sin poder emitir una. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el PEM completo en base64. Sin esto, los tokens siguen siendo HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo cada vez que la clave cambie: la rotación depende de que lo antiguo y lo nuevo sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva, por lo que esto rige cuánto tiempo sobrevive una sesión ante la **inactividad**. Establece `400d` para sesiones que sobrevivan a una larga ausencia; los navegadores limitan la cookie de actualización a ese valor. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar lo que diga esto: una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en el administrador. En producción (`NODE_ENV=production`) esa ventana se cierra: una tabla vacía rechaza el registro inicial con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se especifica con `REBASE_ADMIN_EMAIL` más abajo o se asigna con la clave de servicio. El archivo `.env.example` del scaffold lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de apagado de emergencia. Cierra la ventana de inicio del primer usuario que `ALLOW_REGISTRATION=false` deja abierta deliberadamente fuera de producción, por lo que el registro queda cerrado incluso contra una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de producir su primer usuario autenticado. Cada artefacto de despliegue distribuido lo establece. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada al arrancar **mientras la tabla de usuarios aún está vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador nombra la primera cuenta en lugar de competir contra internet por ella. El arranque advierte cuando la tabla está vacía en producción y esto no está configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Al menos 12 caracteres, o será rechazada y la cuenta no se creará. Cámbiala tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque advertirá una vez; por lo tanto, rotar `JWT_SECRET` cerrará la sesión de todos *y* dejará cada autenticador registrado indescifrable. Establece una clave dedicada (32+ caracteres aleatorios) antes de que alguien se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave desde la cual se está rotando (*anterior*). Define ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, de modo que nadie quede bloqueado fuera de su cuenta a mitad de la rotación. Elimínala una vez que todos los secretos se hayan vuelto a cifrar. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional (opt-in), y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establece `false` para una superficie de lectura completamente pública; RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para usuarios autenticados, y nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto: es una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es solo para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` en la cookie de actualización. Seguro por defecto; `AUTH_COOKIE_SECURE=false` para http simple: un despliegue en una dirección LAN donde el navegador de lo contrario descartaría la cookie y la sesión moriría al expirar el token de acceso sin mostrar error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID de GitLab OAuth. La `baseUrl` de una instancia autohospedada no tiene variable de entorno: configura GitLab en el bloque `auth` para eso. | — |
| `GITLAB_CLIENT_SECRET` | Client secret de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple, para inicio de sesión web. Es público y se publica en `GET /auth/config`. Apple no tiene un client secret estático, porque Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por lo tanto, Apple necesita `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de esto o `APPLE_BUNDLE_IDS`, y no configura nada sin ellos. | — |
| `APPLE_BUNDLE_IDS` | Lista separada por comas de bundle IDs de las aplicaciones nativas de iOS/macOS cuyos códigos de Sign in with Apple se aceptan. | — |
| `APPLE_TEAM_ID` | Team ID de Apple Developer, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API estática de administración. Omite la autenticación JWT normal para llamadas entre servidores cuando se pasa como `Authorization: Bearer <key>`. (Autogenerada en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La clave pública de la plataforma de hosting (PEM, EC P-256) contra la cual se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene nada secreto. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la barrera de administración acepte un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto con el que debe coincidir el `aud` de un token de plataforma, para rechazar tokens emitidos para otro proyecto. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa (rate limit), para las rutas de autenticación y para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede ver su propio número de réplicas, por lo que un despliegue con pares debe especificarlo: tres réplicas con la configuración por defecto aplican tres veces el límite. Cualquier otro valor **se niega a arrancar** en lugar de degradarse, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta el flujo de enlace de inicio de sesión sin contraseña. Necesita un servicio de correo electrónico configurado, o el enlace no tendrá a dónde enviarse. | `false` |
| `AUTH_EMAIL_OTP` | Monta el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo electrónico. Mismo requisito de correo electrónico que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de magic link o código de correo para una dirección desconocida crea la cuenta, mientras el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Qué hace un token de actualización reutilizado después de su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar la sesión). Cualquier otro valor hace fallar el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite el inicio de sesión con contraseña hasta que se verifique la dirección. Requiere correo electrónico; el arranque lo rechaza sin él. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación de captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | El secreto del proveedor, utilizado en el servidor para verificar el token que envía el navegador. Requerido una vez configurado `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas a proteger (por ejemplo `register,login`). Sin definir protege el conjunto por defecto del proveedor. | — |

### Almacenamiento (Storage)

:::caution[El almacenamiento no tiene seguridad a nivel de filas (RLS), por lo que necesita un modelo de acceso]
Las tablas están protegidas por RLS de Postgres. El almacenamiento de objetos no tiene un equivalente —
las claves comparten un único espacio de nombres plano — por lo que con un bucket configurado y ningún modelo de acceso
el servidor **se niega a arrancar en producción**. Complácelo con exactamente uno de los siguientes:
un hook `storageAuthorize` exportado desde `backend/storage.ts` (lo que incluye el scaffold por defecto),
`STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` deshabilita el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor: la raíz del proyecto en `rebase dev`, `backend/` en un servidor generado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción — solo con un volumen duradero que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de buckets locales nombrados junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales funciona la URL de descarga de un archivo privado: el token que `getSignedUrl()` coloca en ella. Como máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Archivo más grande que la fuente acepta, en bytes, en cada ruta de subida — `__<KEY>` para una fuente con nombre. Un valor que no sea un número entero de bytes hace que falle el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Fuerza URLs estilo ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio. Omitir en GCP, donde Workload Identity proporciona las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Sirve cada objeto a cualquiera, sin token. Solo para un bucket que sea genuinamente un CDN público. Una de las tres formas de satisfacer la validación de arranque descrita arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que cualquier usuario autenticado lea, escriba, liste y elimine cada objeto. Nombrado `INSECURE` en el objeto de configuración por una razón: solo es defendible en una aplicación mono-inquilino (single-tenant) donde se confía en cada cuenta para cada archivo. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacena en caché las reproducciones de imágenes generadas (redimensionamientos, conversiones de formato) en lugar de producirlas por solicitud. | `false` |

### Correo electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Nombre de usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre visible en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de correo (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo por defecto. PNG o JPG `http(s)` absoluto — los clientes eliminan SVG y bloquean URIs `data:`. Si no se define, una app llamada aún `Rebase` obtiene el distintivo de Rebase y una renombrada no obtiene ninguno |

### Pool de conexiones a la base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos a esperar para una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) necesita una: `LISTEN`/`NOTIFY` no sobrevive a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambios se desactivan con una advertencia en lugar de perderse silenciosamente. El [job worker](/docs/backend/jobs) mantiene su `LISTEN` de reactivación en ella también. Rellena `directConnectionString` del adaptador de Postgres cuando no está configurado. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando apunta a otro servidor, las lecturas autenticadas (listas, filas individuales, recuentos, agregaciones) se sirven allí bajo la misma seguridad a nivel de fila; las escrituras, inicios de sesión, realtime, crons, jobs, la consola SQL y `rebase.sql` permanecen en la primaria. Un lector que acaba de escribir lee de la primaria durante `REBASE_READ_STICKY_MS`, y todos lo hacen mientras la réplica tenga más retraso de `REBASE_READ_MAX_LAG_MS` o esté fallando. Rellena `readConnectionString` del adaptador de Postgres cuando no está configurado; hasta la versión 0.28 incluida, el pool de la réplica se abría y nunca se leía de él. | — |
| `REBASE_READ_STICKY_MS` | Tras una escritura, cuánto tiempo van las lecturas del mismo usuario a la primaria, para que un guardado seguido de un listado refleje el guardado. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso de réplica a partir del cual todas las lecturas van a la primaria. | `1000` |
| `DATABASE_POOLED` | `true` cuando `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. El pool entonces no envía `search_path` ni `statement_timeout` al conectar (el pooler los rechazaría o descartaría) y establece ambos en cada transacción; el arranque asigna al rol de base de datos un `search_path` por defecto de `public` para sentencias fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser requerida, y realtime, la reactivación del job worker, la creación de índices, ramificaciones (branching) y la consola SQL la usan. La URL de la réplica también se asume con pool. `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Límite superior para cada pool en el proceso, aplicado sin importar lo que cada uno haya solicitado. Solo dígitos simples: un valor mal formado se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento en tiempo de ejecución (Runtime)

Leído por el runtime — `rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho eject gestiona estas decisiones en su propio código en su lugar.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría programada de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule), que reporta tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye una copia, y sin el paquete el arranque se niega a iniciar, mencionándolo. `false` mantiene el escaneo desactivado en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | El rol de Postgres con el que se ejecutan las solicitudes autenticadas y anónimas. Asigna a cada proyecto en un clúster compartido el suyo propio. Una base de datos registra el rol con el que se ejecuta, y un arranque configurado para otro se negará a iniciar hasta que `rebase db request-role migrate` lo traslade. Consulta [Ejecutar en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de solicitud y permite que la conexión cambie a él; `never` deja ambos bajo tu control y solo los verifica. | `auto` |
| `REBASE_RLS_GRANTS` | Qué concede Rebase al rol de solicitud: `schema` (cada tabla en los esquemas que sirve, más privilegios por defecto), `managed` (solo las tablas que sirve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al rol o roles de solicitud, de modo que otros roles que lean las mismas tablas no obtengan nada de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` escribe las políticas que solo el contexto del servidor o un admin pueden superar `TO public`, y ejecuta a los administradores como el rol de solicitud. Por defecto son `TO rebase_admin`, para que las lecturas con ámbito de propietario de usuarios autenticados puedan usar el índice de propietario. Consulta [Solicitudes de administración y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la directiva base de servidor o administrador de cada tabla. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` también establece `request.jwt.claims` y `request.jwt.claim.*`, de modo que las políticas escritas con `auth.uid()` identifiquen al emisor de la llamada. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Qué hace el arranque cuando otro login puede cambiar al rol de solicitud: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para cada ruta de la API. El cliente debe configurarse con el mismo valor — consulta [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos y de administración del bundle desde este proceso. Desactívalo si hay un CDN delante. | `true` |
| `REBASE_HISTORY` | Registra el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas con compresión gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la solicitud, **en bytes** (`10485760`, no `10MB` — un valor que no sea un número hace que el servidor se niegue a arrancar en lugar de eliminar silenciosamente el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. De tres estados. Si no se define, en todos los entornos: `/api/docs` se sirve a los emisores a los que `GET /api/schema/tables` describe tablas, a cada uno el documento de las tablas que se le describen, y no hay Swagger UI. `true` publica el documento completo para todos, con la **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento tras la barrera de administración. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, de modo que los navegadores rechacen HTTP simple en cada subdominio del host durante seis meses — incluidos los hosts que este proceso no sirve. Actívalo solo cuando cada subdominio del dominio sea exclusivo para HTTPS. Cualquier valor que no sea `true`/`false` se niega a arrancar. Consulta [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, deja el endpoint abierto a cualquier cosa que pueda alcanzar el puerto — correcto en una red privada, no en una pública, y los logs de arranque lo advertirán. | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacer el runtime con el esquema de las tablas al arrancar. `ensure` (por defecto, en todas partes — incluida producción) ejecuta el paso **aditivo**: crea tablas, columnas y tipos enum faltantes, nunca elimina ni reescribe ninguno. `none` no altera el esquema de las tablas declaradas, pero las tablas del propio framework (auth, claves de API, jobs, cron) se siguen creando y manteniendo actualizadas; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen publicada solo acepta estas dos opciones y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe establecer `none` o rehusarse a arrancar. | `ensure` |
| `REBASE_PROVISION` | `false` hace que el runtime no cambie nada en su base de datos: ninguna tabla, columna, índice, función, trigger, política, rol o permiso, ni al arrancar ni después, incluidos los del propio framework. Reporta lo que falta por su nombre. Para una base de datos que solo tu proceso de cambios puede modificar. Consulta [Cuando solo tu proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Se niega a arrancar cuando la base de datos fue aprovisionada por última vez a partir de un conjunto de tablas diferente de aquel a partir del cual se compiló este proceso. Si no se define (o cualquier valor distinto de `true`/`1`), solo emite una advertencia. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Se niega a arrancar cuando un archivo de funciones o cron lanza un error o no se puede analizar al importar, indicando cada archivo y el motivo, para que un despliegue continuo (rolling deploy) mantenga la versión anterior en servicio. Un reinicio también se somete a esta regla. Si no se define (o cualquier valor distinto de `true`), omite el archivo y sirve el resto. Un archivo que se importa limpiamente y no exporta ninguna función o trabajo siempre se omite, no se rechaza. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (lee cambios del WAL donde la base de datos lo permite; si no, usa triggers; si no, recurre al nivel de aplicación, registrando cada degradación como info), `trigger` (lo fuerza, advierte si es imposible), `wal` (lee cambios del write-ahead log en lugar de triggers; necesita `wal_level=logical` y un rol con permisos de replicación, recurre a `trigger` en caso contrario), `off`. Consulta [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora cuando se proporcionó un transporte construido a `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un socket de realtime; la siguiente se rechaza con `TOO_MANY_SUBSCRIPTIONS`. Un número entero positivo — cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulta [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cuántos sockets de realtime puede mantener abiertos un usuario o una clave de API en una instancia de servidor. Los sockets de suplantación de un administrador cuentan para el administrador. El inicio de sesión del siguiente se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK continúa reintentando, de modo que entra cuando otro se cierra. Un número entero positivo — cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | El tiempo máximo que espera un cambio para la re-consulta (refetch) que lo entrega a los suscriptores activos, en ms. Una re-consulta espera 300 ms sin cambios, y como máximo este tiempo bajo un flujo constante de escrituras. Un número entero positivo — cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Cuánto tiempo puede reutilizarse el total de una suscripción a una lista grande antes de contarse de nuevo, en ms; los frames que lo reutilizan llevan `meta.totalAsOf`. Si no se define, cada frame cuenta. Prevalece sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | El último total más pequeño al que se aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada frame. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback bajo `NODE_ENV=production`. Desactivado por defecto, para que un arranque en producción falle visiblemente en lugar de conectarse a una base de datos inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada del esquema y sale sin abrir un socket — el comportamiento que requiere un Job de migración, desde la misma imagen y el mismo bundle que el servidor posterior. También crea las tablas que un proceso en ejecución crearía en su primer uso, y no inicia ninguna cola de cron o jobs. Un valor vacío equivale a *sin definir*, de modo que un `${SOMETHING}` sin sustituir en un archivo compose no convierta un despliegue normal en uno que migra y se niega a servir. Incompatible con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Una ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribe en él cada cambio de esquema que realizó, en orden, como un script SQL para revisar y aplicar con `psql`. Las filas escritas no se incluyen. No admitido en un proceso que sirve peticiones. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina (un agente, un job de CI) *aplique* un cambio de esquema a través de `/api/admin/schema`, no solo que lo planifique. Desactivado a menos que se solicite: la credencial que realizaría dicho cambio es la que con mayor probabilidad reside en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto tiempo puede ejecutarse una función personalizada antes de que se aborte su solicitud. La misma opción que `functionsTimeoutMs`. `0` lo desactiva. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no gestionado finalice el proceso en lugar de registrarlo en el log. Recomendado bajo un orquestador que reinicie el contenedor; desactivado donde un reinicio sea peor que una fuga de recursos. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en una plataforma que el runtime detecta como escalado a cero (scale-to-zero), donde un temporizador que se dispara en una instancia inactiva no se dispara en ninguna instancia. No cambia nada más: defínelo cuando mantengas al menos una instancia en ejecución continua. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente desde `X-Forwarded-For`. Valor por defecto seguro `0`: sin proxy, confiar en la cabecera permitiría que cualquier emisor falsifique una identidad. | `0` |

:::note[El aprovisionamiento de arranque es aditivo y no una herramienta de migración]
La pasada de arranque se ejecuta de forma desatendida sin nadie revisando un diff, por lo que nunca eliminará
una columna, reducirá un tipo ni reescribirá una tabla. Por esa misma razón la imagen rechaza
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y ejecutará con gusto
`DROP COLUMN`, y el reinicio de un contenedor nunca debe ser capaz de destruir una
columna en producción como efecto secundario de una reprogramación.

Los cambios destructivos o de reestructuración se mantienen donde puedan ser revisados: `rebase db
generate` + `rebase db migrate`, o `rebase db push` desde un checkout o CI,
el cual realiza un simulacro del cambio (dry-run), rechaza cambios destructivos sin confirmación y
puede tomar una copia de seguridad antes.
:::

### Despliegues divididos (Split deployments)

Una imagen y un bundle se pueden arrancar varias veces, sirviendo cada instancia
una parte diferente del proyecto. Se incluye una línea para cada una aquí porque esta página
recopila cada variable; lo que cada combinación *monta y administra* — y qué
combinaciones se niegan a arrancar — se detalla en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescribe si *este* proceso ejecuta los temporizadores de cron. Sin definir sigue el rol. | — |
| `REBASE_JOB_WORKERS` | Sobrescribe si este proceso ejecuta workers de colas de jobs. Sin definir sigue el rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Sirve solo las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sirve todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Dónde reenvía el proceso de API una solicitud de función que no sirve él mismo. En un `worker`, adónde van sus propias llamadas `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Un endpoint opcional (opt-in) de Model Context Protocol en `/mcp`, para que un cliente de IA pueda leer
y escribir en este proyecto **como el usuario autenticado**. Desactivado a menos que se configure, y — a diferencia
de cualquier otra superficie — ningún `REBASE_ROLE` lo activa: los otros describen la
forma de un proceso, mientras que este representa una decisión de entregar credenciales a software de
terceros, y debe ser tomado por una persona en lugar de heredarse del
rol asignado a un contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie rechaza montarse y lo indica en el log de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, ej. `https://app.example.com`. La superficie MCP no puede derivarlo: tomar el origen de la cabecera `Host` haría que la identidad del emisor, y la audiencia contra la que se verifican sus propios tokens, dependieran de un valor suministrado por quien hace la petición. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista de MCP App propia del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), servida a Claude en lugar de la vista genérica para que muestre tus vistas, campos y acciones personalizadas. Sin ella, el backend busca junto al frontend que sirve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite el registro dinámico de clientes OAuth (RFC 7591), de modo que un cliente pueda registrarse por sí mismo. Establece `false` para requerir que los clientes se registren con antelación. | `true` |

### Edición de esquema en vivo desde un bundle

Desactivado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esté configurado. Un bundle compilado no tiene
código fuente en `backend/schema` para editar, por lo que con estas variables configuradas el editor de esquemas lee
el código fuente del repositorio, envía cada cambio de vuelta mediante commit y ejecuta su DDL en
esta base de datos. Solo para administradores, y aplicado por una persona a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Un repositorio especificado sin
credenciales válidas se negará a arrancar. Consulta
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub donde hacer commit de los cambios de esquema, en formato `owner/name`. Definirla es lo que activa la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se registra el commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Dónde reside `backend/schema` en ese repositorio, relativo al repo. Una ruta que apunte fuera del repositorio se niega a arrancar, al igual que la ya obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token de grano fino con acceso de lectura y escritura al contenido del repositorio. Configura este o las tres variables `_GITHUB_APP_*`, no ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | El ID de una GitHub App, para hacer commit como la aplicación en lugar de usar un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | La instalación de la app en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clave privada de la app: PEM, PEM con saltos de línea escapados o base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir significa que las copias programadas están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requerida con `BACKUP_SCHEDULE`, el cual se niega a ejecutarse sin ella. `rebase db backup` recurre a `./backups` en la ubicación donde se ejecutó. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad más antiguas de N días. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N de las copias de seguridad más recientes, sin importar lo que indique la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe la ruta al binario `pg_dump`: debe ser de la versión principal del servidor o más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe la ruta al binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe la ruta al binario `psql` que `rebase db restore --clean` ejecuta para hacer de la restauración una sola transacción. | — |
| `PG_DUMPALL_PATH` | Dónde se encuentra `pg_dumpall`, cuando no está en el `PATH`. Sin él — y sin las herramientas de cliente de PostgreSQL instaladas —, una copia de seguridad de globales fallará con un error indicando esta variable. | — |

La imagen oficial del runtime (`rebasepro/server`) incluye las herramientas de cliente de
PostgreSQL 18, por lo que una copia de seguridad programada se ejecuta en ella contra cualquier servidor hasta Postgres 18.
Fuera de la imagen, instálalas por tu cuenta (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos y datos personales (PII). Utiliza un destino privado con
cifrado en reposo.

### Entrega de bundles

Un despliegue administrado no incluye su código en la imagen: el runtime obtiene un
bundle al arrancar. Estas variables deciden cuál y cómo.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Es lo que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De dónde descargar el archivo comprimido del bundle, cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial Bearer para esa descarga. Trátala como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los que este declara por sí mismo. | — |

### Vinculaciones de recursos (Resource bindings)

Cada base de datos, bucket y topic que un proyecto declara en `backend/resources.ts` se
vincula mediante variables de entorno nombradas a partir de él. Los nombres base están a continuación; un
recurso no predeterminado añade `__` y su clave en mayúsculas, por lo que un bucket llamado
`media` lee `S3_BUCKET__MEDIA`. `rebase status`
imprime, por cada recurso,
la variable exacta que está leyendo y si está configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | El paquete npm que implementa el controlador de una fuente de datos, cuando no es el de Postgres por defecto. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### El entorno propio de la CLI

Leído por `rebase`, no por el servidor. Nada aquí afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | Adónde envían la clave de servicio comandos como `rebase api-keys`, `rebase storage` y `rebase auth reset-password`, en la shell o en `.env`. Defínelo cuando el servidor se ejecute de otra manera que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Sin definir, utilizan el servidor que `rebase dev` registró mientras dicho servidor esté en ejecución, y no envían nada cuando no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican esos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Un nombre anterior para esa clave. Cuando `.env` la define, `rebase api-keys` y `rebase storage` la leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` evita que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` en la raíz del repositorio, para una raíz cuyos archivos de agentes mantienes manualmente. | on |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda proporcionarla sin que llegue al historial de la shell. | — |
| `REBASE_TOKEN` | Un token proveniente de `rebase cloud tokens create`. Configurado, cada comando `rebase cloud` se autentica con él en lugar de la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión guardada. En un directorio vinculado mediante `rebase cloud init --claim`, se aparta a favor del token de ese proyecto cuando no tiene permisos sobre el mismo. Es la forma recomendada de ejecutar `rebase cloud` en CI — consulta [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI que generan sus herramientas cloud, y nunca lo envía a la aplicación: usa `REBASE_API_TOKEN` para eso. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la solicitud en lugar del mensaje corto. Lo primero que debes activar cuando un comando de `rebase cloud` falle sin suficiente información. | — |
| `REBASE_ATLAS_DEV_URL` | La base de datos vacía contra la cual planifican `rebase db push`, `db generate` y `db migrate`, en lugar de la `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no crea ni elimina una base de datos nombrada aquí, y rechaza una equivalente a `DATABASE_URL`. En la base de datos de desarrollo administrada, la CLI la establece en un PGlite en memoria desechable propio. Configúrala donde no se conceda permiso para `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada; tú proporcionas la tuya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que `rebase dev` de otro modo deriva de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend se anuncie antes de indicar que no ha iniciado. `0` deshabilita el aviso. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` inserta en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convención transversal a varias herramientas. Si se establece en cualquier valor distinto de `0`, la CLI no envía telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No requiere ningún archivo, razón por la cual es la opción indicada para usar en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destino al que se envía la telemetría, para un colector autohospedado. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY` se
generan automáticamente fuera de ella, para que puedas comenzar sin configurar nada.

Estos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url` e ignorados en git junto a ellos. Anteriormente,
se regeneraban en cada arranque, por lo que reiniciar el servidor de desarrollo cerraba tu sesión
en tu propia aplicación e invalidaba cualquier clave de API que acabaras de crear.

- Define cualquiera de las variables explícitamente y se usará la tuya; nada se almacenará en caché ni se leerá de ella.
- Apunta la caché a otra ubicación con `REBASE_DEV_SECRETS_FILE` — una ruta, y la
  única variable de esta sección que configurarías deliberadamente.
- Elimina el archivo para rotar ambos secretos. El siguiente arranque generará uno nuevo.
- Si el archivo no se puede escribir — por ejemplo, en un contenedor de solo lectura —, el servidor arranca
  de todos modos con un secreto efímero, exactamente como solía hacerlo.

Nada se guarda en caché en producción ni bajo un ejecutor de pruebas. En producción tampoco
se genera nada: un arranque sin `JWT_SECRET` falla, indicando la variable, y
eso no ha cambiado:

```
The environment is not valid:
  JWT_SECRET: is required
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
sin `app`, `server` y `basePath` y con un `provision` obligatorio, compilan un
backend que no sirve nada hasta que lo montes: `createRebaseBackend`. Consulta
[Integración de servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

`basePath` traslada cada ruta de la API, por lo que el cliente debe ser configurado con la misma información;
de lo contrario, seguirá consultando `/api/...` y obtendrá un 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma este valor del cliente que se le proporciona; no es necesario
configurar nada más. Si construyes una URL de solicitud manualmente, concaténala desde el cliente en lugar
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

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista CMS en hoja de cálculo carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del SQL Editor cambiando temporalmente de rol de base de datos para coincidir con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas autenticación personalizada donde los roles solo existen en tablas de la base de datos y no como roles reales de PostgreSQL, el cambio de rol falla o faltan los privilegios de base de datos. La vista de hoja de cálculo CMS se ejecuta bajo el usuario propietario de la conexión predeterminado y elude esto.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de tu backend. Esto fuerza a Rebase a ejecutar las consultas del SQL Editor utilizando los privilegios del propietario de la conexión (normalmente un superusuario/owner). El SQL Editor indicará entonces, sobre los resultados, que se leyeron como el propietario de la conexión y deshabilitará su selector de roles.

### Error al obtener el esquema en SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol de esquemas, o el SQL Editor lanza `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se proporciona `adminConnectionString` al bootstrapper, o si se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
* **Solución:** Asegúrate de que `adminConnectionString` esté configurado durante la inicialización del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Siguientes pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Descripción general del backend](/docs/backend)** — Referencia completa de configuración del backend
