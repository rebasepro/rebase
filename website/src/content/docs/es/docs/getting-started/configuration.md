---
sourceHash: df5e0441849e5e57
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de entorno

Toda la configuración se realiza mediante variables de entorno en tu archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al inicio. Si
> falta algo obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> Dónde reside el esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime — `rebase dev`, `rebase start`, la imagen publicada — utiliza el
> esquema propiedad del runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas siguientes. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede añadir allí sus
> propias variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo** — si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Usa una cadena aleatoria segura (mínimo 32 caracteres). **Obligatoria en producción** (autogenerada en desarrollo). | `a1b2c3d4e5...` |

> **En una base de datos administrada, `sslmode=require` puede no significar lo que parece.**
>
> Para `psql` y cualquier herramienta libpq, `require` significa "cifrado, certificado no
> verificado". El controlador de Node sobre el que se ejecuta Rebase lo interpreta como `verify-full`, por
> lo que una base de datos cuyo certificado no haya sido firmado por ninguna autoridad pública —algo
> común en Postgres administrado— rechaza el runtime con `self-signed certificate`, mientras que `psql`
> se conecta con la misma URL. El runtime y los comandos `rebase db` se detienen con un
> mensaje que indica esto.
>
> Elige una opción:
>
> - **`sslmode=no-verify`** — cifrado, no verificado: lo que `require` significa para
>   libpq. Es una sintaxis de node-postgres que no existe en libpq, por lo que `psql`, `pg_dump`
>   y Atlas la rechazan con `invalid sslmode value: "no-verify"`. Los comandos propios de Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) se la pasan como
>   `sslmode=require`, por lo que funcionan con la URL tal como está configurada; para usar
>   `psql` manualmente, cámbialo por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra el
>   certificado CA del proveedor. Lo mismo para todas las herramientas.
>
> `uselibpqcompat=true&sslmode=require`, que es lo que sugiere la advertencia del propio controlador
> de Node, también funciona para el runtime; los comandos de Rebase eliminan `uselibpqcompat`
> antes de pasar la URL a las herramientas libpq, que de lo contrario lo rechazarían.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Configura esto solo en desarrollo** — consulta más abajo. | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deja `VITE_API_URL` sin definir en compilaciones de producción.**
>
> En desarrollo, el frontend y el backend tienen orígenes distintos, por lo que el servidor de
> desarrollo inyecta esto. En producción, el backend de Rebase sirve la SPA, de modo que la
> API es el propio origen de la página y el cliente la resuelve de esa manera por sí mismo.
>
> Incrustar una URL absoluta en un bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado cargaría la página desde
> `example.com` y llamaría a la API en `example.rebase.website`, lo cual es
> cross-origin, por lo que cada solicitud fallaría en el preflight. Permitir el origen en CORS
> **no** lo soluciona tampoco — la cookie de actualización es `SameSite=Lax` y no se envía
> entre sitios (cross-site), por lo que eliminarías los errores de consola pero la autenticación
> seguiría rota. Si no se define, cualquier dominio que apunte a la aplicación funciona sin necesidad
> de configurar CORS.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `PORT` | Puerto para el servidor HTTP del backend. Lo lee `rebase start`. `rebase dev` lo lee **únicamente del entorno de la shell** — un `PORT` en `.env` no se lee allí porque el puerto se resuelve antes de cargar dicho archivo — y, de lo contrario, vincula un puerto derivado de la ruta del proyecto, para que se puedan ejecutar varios proyectos a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica cuál se utilizó. | `3001` |
| `LOG_LEVEL` | Verbosidad del registro: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Cada sentencia que falla se anonimiza por defecto, ya que una consulta fallida incluye sus parámetros vinculados (un correo electrónico, un hash de contraseña). Establécelo en `true` al diagnosticar un fallo de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** a menos que se defina `FRONTEND_URL`: un arranque en producción sin ninguno de los dos se negará a iniciar. En desarrollo se *añade a* localhost — consulta más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se usa como alternativa a CORS_ORIGINS, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos a nivel de administrador (utilizada para introspección de esquemas y operaciones de administración). La base de datos que indica no es la que la consola SQL considera actual, ni la que copia una nueva rama por defecto: ambas corresponden a la base de datos en la que está la propia conexión de la aplicación (consulta `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de roles de PostgreSQL en el SQL Editor (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará el selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos a partir de la cual se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor configurado con esto mantiene el registro de ramas en esa base de datos y copia nuevas ramas de ella por defecto, de modo que el panel de Ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El entorno de desarrollo permite **localhost, además de lo que indique `CORS_ORIGINS` (o `FRONTEND_URL`)**
—la misma lista que utiliza producción, pero añadiendo localhost en lugar de
reemplazarlo. De este modo, la variable funciona igual en ambos entornos y los
casos en que se necesita en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté listado será rechazado, y el rechazo se
registrará **una vez por origen** con la línea exacta que lo permitiría. Rechazarlo
no es una precaución sin sentido: la API envía credenciales, por lo que reflejar un
`Origin` arbitrario permitiría a cualquier sitio que el desarrollador visite hacer
solicitudes autenticadas contra el servidor de desarrollo con su sesión y leer las
respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `JWT_SECRET` | Secreto para la firma de JWT (obligatorio en producción, autogenerado en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso asimétricamente (RS256), de modo que cualquiera que tenga el JWKS pueda verificar una sesión sin poder emitir una. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o el PEM completo en base64. Sin esto, los tokens siguen siendo HS256. | — |
| `JWT_KEY_ID` | Nombra `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo cada vez que la clave cambie; la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva, por lo que esto rige cuánto tiempo sobrevive una sesión ante la **inactividad**. Establece `400d` para sesiones que deban sobrevivir a una ausencia prolongada; los navegadores limitan la cookie de actualización a ese valor. | `30d` |
| `ALLOW_REGISTRATION` | Permitir que nuevos usuarios se registren (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar lo que diga esto: una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en el administrador. En producción (`NODE_ENV=production`), esa ventana está cerrada: una tabla vacía rechaza el registro de arranque con `SETUP_REQUIRED`, una primera cuenta creada mediante registro abierto es una cuenta ordinaria, y el administrador se especifica con `REBASE_ADMIN_EMAIL` más abajo o se asigna mediante la service key. El `.env.example` del proyecto base lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de emergencia (kill switch). Cierra la ventana de arranque para el primer usuario que `ALLOW_REGISTRATION=false` deja deliberadamente abierta fuera de producción, de modo que el registro se bloquea incluso frente a una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` más abajo, o el despliegue no tendrá forma de generar su primer emisor de peticiones autenticado. Todos los artefactos de despliegue distribuidos lo incluyen activado. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada en el arranque **mientras la tabla de usuarios aún está vacía** y nunca después. Así es como un despliegue de producción obtiene a su administrador: el operador define la primera cuenta en lugar de competir contra internet por ella. El arranque advierte si la tabla está vacía en producción y esto no está definido. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Al menos 12 caracteres, de lo contrario se rechaza y no se crea la cuenta. Cámbiala tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra cada secreto TOTP almacenado. Si no se define, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque muestra una advertencia; por lo tanto, rotar `JWT_SECRET` cerraría la sesión de todos *y* dejaría indescifrable cualquier autenticador registrado. Define una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave desde la que se está rotando. Define ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, de modo que nadie se quede sin acceso a su propia cuenta a mitad de la rotación. Elimínala una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilitar el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional (opt-in), y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exigir autenticación para la API de datos. Establece `false` para una superficie de lectura completamente pública; RLS sigue aplicándose. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo. Solo para peticiones autenticadas, y nunca devuelve el correo, roles ni metadatos del usuario encontrado. Desactivado por defecto: es una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es solo para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` en la cookie de actualización. Seguro por defecto; `AUTH_COOKIE_SECURE=false` para HTTP simple — un despliegue en una dirección LAN donde el navegador de lo contrario descartaría la cookie y la sesión moriría al expirar el token de acceso sin ningún error. Muestra una advertencia al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. La `baseUrl` de una instancia autohospedada no tiene variable de entorno equivalente; configura GitLab en el bloque `auth` para ello. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID de Apple para inicio de sesión web. Es público y se expone en `GET /auth/config`. Apple no tiene un secreto de cliente estático, ya que Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por tanto, Apple requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de este o `APPLE_BUNDLE_IDS`, y no configura nada sin ellos. | — |
| `APPLE_BUNDLE_IDS` | IDs de paquete (bundle ids) separados por comas de las aplicaciones nativas de iOS/macOS cuyos códigos de Sign in with Apple se aceptan. | — |
| `APPLE_TEAM_ID` | Team ID de desarrollador de Apple, el emisor del JWT. | — |
| `APPLE_KEY_ID` | ID de la clave privada registrada con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, incluyendo saltos de línea (se aceptan escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API estática de administrador. Omite la autenticación JWT normal para llamadas de servidor a servidor cuando se envía como `Authorization: Bearer <key>`. (Autogenerada en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la barrera de administración acepte un token de plataforma para `cron:read` y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto al que debe equivaler el campo `aud` de un token de plataforma, de modo que se rechace un token emitido para otro proyecto. Si solo se define una de las dos variables, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Hacia dónde se dirige el botón **Continue with Rebase Cloud** del panel de administración: la página del proyecto en la consola de la plataforma, que autentica a los propietarios del proyecto y regresa. La plataforma lo define al desplegar junto con las dos anteriores; con ellas, `POST /api/auth/platform-signin` acepta el token de un minuto `auth:admin-signin` de la plataforma y abre una sesión de administrador. Sin esto, el acceso sigue funcionando desde el botón **Open CMS** de la consola, y la pantalla de inicio de sesión simplemente lo explica. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa, tanto para las rutas de autenticación como para `rateLimit` en funciones personalizadas: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede ver su propio recuento de réplicas, por lo que un despliegue con réplicas debe indicarlo; tres réplicas con el valor por defecto aplican el triple del límite. Cualquier otro valor **se niega a arrancar** en lugar de degradarse, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta el flujo de enlace de inicio de sesión sin contraseña. Requiere un servicio de correo electrónico configurado, o el enlace no tendrá a dónde enviarse. | `false` |
| `AUTH_EMAIL_OTP` | Monta el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo. Mismo requisito de correo que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de enlace mágico o código por correo para una dirección desconocida crea la cuenta, siempre que el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Qué hace un token de actualización reutilizado tras su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar la sesión). Cualquier otro valor hace fallar el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite iniciar sesión con contraseña hasta verificar la dirección. Requiere correo; el arranque lo rechaza si no está configurado. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación de captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | El secreto del proveedor, usado en el servidor para verificar el token que envía el navegador. Obligatorio si se define `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas que se protegerán (por ejemplo `register,login`). Sin definir protege el conjunto por defecto del proveedor. | — |

### Almacenamiento

<span class="since-badge" data-since="0.35">Desde 0.35</span>

:::caution[El almacenamiento no tiene seguridad a nivel de fila (RLS), por lo que necesita un modelo de acceso]
Las tablas están protegidas por Postgres RLS. El almacenamiento de objetos no tiene un equivalente —las claves comparten un único espacio de nombres plano—, por lo que con un bucket configurado y sin un modelo de acceso, el servidor **se negará a arrancar en producción**. Cumple con este requisito mediante exactamente una de las siguientes opciones: un hook `storageAuthorize` exportado desde `backend/storage.ts` (lo que incluye el proyecto base), `STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3`, `gcs` o `platform` (archivos en un prefijo propiedad de la plataforma de alojamiento, transferidos mediante URLs que firma su broker de almacenamiento; definido por la plataforma). En producción, `local` deshabilita el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor: la raíz del proyecto bajo `rebase dev`, `backend/` en un servidor generado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permitir almacenamiento local en producción — solo con un volumen persistente que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de buckets locales nombrados junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales funciona la URL de descarga de un archivo privado (el token que `getSignedUrl()` incluye en ella). Como máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Archivo más grande que acepta la fuente, en bytes, en cada ruta de subida (`__<KEY>` para una fuente nombrada). Un valor que no sea un número entero de bytes rechaza el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket de S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta (path-style) para el bucket de S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket de GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Generalmente se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio. Omitir en GCP, donde Workload Identity suministra las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Servir cada objeto a cualquiera, sin token. Solo para un bucket que sea genuinamente una CDN pública. Una de las formas de satisfacer la validación de arranque mencionada arriba. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permitir que cualquier usuario autenticado lea, escriba, liste y elimine cada objeto. Se llama `INSECURE` en el objeto de configuración por una razón: solo es defendible en una aplicación mono-inquilino donde se confíe a cada cuenta todos los archivos. | `false` |
| `STORAGE_POLICIES` | Reglas de acceso al almacenamiento en formato JSON: `[{ "path", "operations"?, "allow" }]`, donde `allow` puede ser `"public"`, `"authenticated"`, `"owner"` o `{ "roles": [...] }`. Deniega por defecto y satisface la validación de arranque. Una lista no válida rechaza el arranque. Consulta [Autorización de almacenamiento](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | El broker de almacenamiento de la plataforma, para `STORAGE_TYPE=platform`. Definido por la plataforma que ejecuta el broker. | — |
| `STORAGE_BROKER_PROJECT` | El ID de proyecto al que el broker asigna el ámbito de los archivos de este despliegue, para `STORAGE_TYPE=platform`. Definido por la plataforma. | — |
| `STORAGE_RENDITION_CACHE` | Almacenar en caché las representaciones (renditions) de imágenes generadas (redimensionamientos, conversiones de formato) en lugar de producirlas por solicitud. | `false` |

### Correo electrónico (Opcional)
`MAGIC_LINK_URL`.

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Habilitar conexión segura (`true`/`false`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Dirección del remitente para correos del sistema |
| `SMTP_NAME` | Nombre para mostrar en la dirección del remitente |
| `APP_NAME` | Nombre del producto utilizado en los asuntos y cuerpos de los correos (por defecto: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo mostrado en la parte superior de las plantillas de correo por defecto. PNG o JPG absoluto `http(s)` — los clientes eliminan SVG y bloquean URIs `data:`. Sin definir, una aplicación aún llamada `Rebase` muestra el isotipo de Rebase y una renombrada no muestra ninguno |
| `MAGIC_LINK_URL` | Hacia dónde apunta un enlace mágico enviado por correo. A una base se le añade `/auth/magic-link?token=…`; una URL que contenga `{token}` representa el enlace completo, para un frontend que no sirva `/auth/magic-link`. Enciérralo entre comillas en `.env`, donde un `#` sin comillas inicia un comentario: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valor con un hash o una ruta de archivo sin `{token}` genera una advertencia al arrancar. Sin definir, la base es `FRONTEND_URL` |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `DB_POOL_MAX` | Conexiones máximas en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos a esperar para obtener una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) necesita una: `LISTEN`/`NOTIFY` no sobreviven a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambios se desactivan con una advertencia en lugar de perderse en silencio. El [job worker](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Completa el `directConnectionString` del adaptador de Postgres cuando no está definido. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando especifica otro servidor, las lecturas autenticadas (listas, filas individuales, recuentos, agregaciones) se sirven allí bajo la misma seguridad a nivel de fila; las escrituras, inicio de sesión, tiempo real, crons, jobs, la consola SQL y `rebase.sql` permanecen en el primario. Un lector que acaba de escribir lee del primario durante `REBASE_READ_STICKY_MS`, y todos lo hacen mientras la réplica tenga más de `REBASE_READ_MAX_LAG_MS` de retraso o falle. Completa el `readConnectionString` del adaptador de Postgres cuando no está definido; hasta la versión 0.28 inclusive, el pool de la réplica se abría y nunca se leía de él. | — |
| `REBASE_READ_STICKY_MS` | Tras una escritura, cuánto tiempo van las lecturas del mismo usuario al primario, para que un guardado seguido de un listado refleje lo guardado. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso de la réplica a partir del cual todas las lecturas van al primario. | `1000` |
| `DATABASE_POOLED` | `true` cuando `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. El pool entonces no envía `search_path` ni `statement_timeout` al conectar (el pooler los rechazaría o descartaría) y establece ambos en cada transacción; el arranque asigna al rol de base de datos un `search_path` por defecto de `public` para sentencias fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser obligatorio, y el tiempo real, la reactivación del job worker, la creación de índices, las ramas y la consola SQL lo usan. La URL de la réplica también se asume con pool. `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Un límite máximo para cada pool en el proceso, aplicado sin importar lo que cada uno haya solicitado. Solo dígitos simples: un valor mal formado se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento del runtime

Leído por el runtime — `rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho eject gestiona estas decisiones en su propio código.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría programada de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule), que reporta tablas servidas sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye ninguna copia, y sin el paquete el arranque se rechaza, indicándolo. `false` mantiene el escaneo desactivado en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | El rol de Postgres con el que se ejecutan las solicitudes autenticadas y anónimas. Asigna a cada proyecto en un clúster compartido el suyo propio. Una base de datos registra el rol con el que se ejecuta, y un arranque configurado para otro se negará a iniciar hasta que `rebase db request-role migrate` lo migre. Consulta [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de solicitud y permite que la conexión cambie a él; `never` deja ambos bajo tu control y solo los comprueba. | `auto` |
| `REBASE_RLS_GRANTS` | Lo que Rebase otorga al rol de solicitud: `schema` (cada tabla en los esquemas que sirve, más privilegios por defecto), `managed` (solo las tablas que sirve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al rol o roles de solicitud, de modo que otros roles que lean las mismas tablas no obtengan nada de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` escribe las políticas que solo el contexto del servidor o un administrador pueden superar `TO public`, y ejecuta a los administradores como el rol de solicitud. Por defecto son `TO rebase_admin`, para que las lecturas con ámbito de propietario de usuarios autenticados puedan usar el índice de propietario. Consulta [Solicitudes de administrador y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política base de servidor o administrador de cada tabla. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` también define `request.jwt.claims` y `request.jwt.claim.*`, de modo que las políticas escritas con `auth.uid()` vean al emisor de la petición. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Qué hace el arranque cuando otro inicio de sesión puede cambiar al rol de solicitud: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para cada ruta de la API. Se le debe indicar lo mismo al cliente — consulta [Cambiar `basePath`](#cambiar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir los recursos estáticos/de administración del bundle desde este proceso. Desactívalo cuando haya una CDN delante. | `true` |
| `REBASE_STUDIO` | Servir la consola independiente integrada Rebase Studio en `/_studio` cuando haya un bundle estático de Studio disponible. Establece `false` para deshabilitar. | `true` |
| `REBASE_STUDIO_DIR` | Directorio que contiene la SPA independiente precompilada de Rebase Studio servida en `/_studio`. Por defecto es `/studio` en la imagen del contenedor. | `/studio` |
| `REBASE_HISTORY` | Registrar el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas con compresión gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` activa las [notificaciones push](/docs/backend/push-notifications/): las rutas `/api/push`, la tabla `rebase.push_subscriptions` y `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | El par de claves VAPID con el que se firman los mensajes push. Fuera de producción se genera un par y se guarda en `.rebase-dev-secrets.json` si no están definidos; en producción el servicio push permanece desactivado sin ellos. | — |
| `REBASE_VAPID_SUBJECT` | Una dirección `mailto:` o URL `https://` con la que los servicios push puedan contactar. Por defecto es el origen de un `REBASE_PUBLIC_URL` con `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamaño máximo del cuerpo de la solicitud, **en bytes** (`10485760`, no `10MB` — un valor que no sea un número se niega a arrancar en lugar de eliminar el límite en silencio). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie de OpenAPI. Tres estados. Sin definir, en cualquier entorno: `/api/docs` se sirve a los emisores a los que `GET /api/schema/tables` describe tablas, cada uno recibiendo el documento de las tablas descritas, y no hay UI de Swagger. `true` publica el documento completo para todos, con la **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento protegido tras la barrera de administración. | — |
| `REBASE_METRICS` | Exponer métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Añade `includeSubDomains` a la cabecera `Strict-Transport-Security`, de modo que los navegadores rechacen HTTP simple en cada subdominio del host durante seis meses —incluidos los hosts que este proceso no sirve. Actívalo solo cuando cada subdominio del dominio sea exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` se niega a arrancar. Consulta [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Sin definir deja el endpoint abierto a cualquiera que pueda alcanzar el puerto —aceptable en una red privada, no en una pública, y los logs de arranque así lo advierten. | — |
| `REBASE_MIGRATE_ON_BOOT` | Qué puede hacer el runtime con el esquema de las tablas al arrancar. `ensure` (por defecto en todas partes, incluida producción) ejecuta la pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, nunca elimina ni reescribe nada. `none` deja intacto el esquema de las tablas declaradas, pero las tablas propias del framework (auth, claves de API, jobs, cron) se siguen creando y manteniendo actualizadas; `REBASE_PROVISION=false` también desactiva estas últimas. La imagen publicada solo acepta estas dos opciones y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe configurar `none` o se negará a arrancar. | `ensure` |
| `REBASE_PROVISION` | `false` hace que el runtime no modifique nada en su base de datos: ninguna tabla, columna, índice, función, disparador, política, rol o privilegio, ni al arrancar ni después, incluidos los propios del framework. En su lugar, reporta por nombre lo que falta. Para una base de datos que solo tu proceso de cambios pueda modificar. Consulta [Cuando solo tu proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rechaza el arranque cuando la base de datos se aprovisionó por última vez a partir de un conjunto de tablas diferente de aquel a partir del cual se compiló este proceso. Sin definir (o cualquier valor distinto de `true`/`1`) emite una advertencia en su lugar. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rechaza el arranque cuando un archivo de función o de cron lanza un error o no se puede analizar al importarse, indicando el nombre de cada archivo y el motivo, para que un despliegue progresivo mantenga la versión anterior en servicio. Un reinicio también se somete a esta regla. Sin definir (o cualquier valor distinto de `true`), omite el archivo y sirve el resto. Un archivo que se importa limpiamente y no exporta ninguna función o job siempre se omite, no se rechaza. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos (CDC): `auto` (lee cambios del WAL donde la base de datos lo permita; de lo contrario, usa disparadores; si no, recurre a nivel de aplicación, registrando cada degradación como info), `trigger` (lo fuerza, advierte si no es posible), `wal` (lee cambios del write-ahead log en lugar de disparadores; requiere `wal_level=logical` y un rol que pueda replicar, recurre a `trigger` en caso contrario), `off`. Consulta [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora cuando se proporcionó a `realtime.bus` un transporte ya construido. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un socket de realtime; la siguiente se rechaza con `TOO_MANY_SUBSCRIPTIONS`. Un número entero positivo; cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulta [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cuántos sockets de realtime puede mantener abiertos un usuario, o una clave de API, en una instancia de servidor. Los sockets de suplantación de un administrador cuentan contra el administrador. El inicio de sesión del siguiente se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK sigue reintentando, por lo que entra cuando se cierra otro. Un número entero positivo; cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | El tiempo máximo que espera un cambio para la reobtención (refetch) que lo entrega a los suscriptores activos, en ms. Una reobtención espera 300 ms sin cambios, y como máximo este tiempo bajo un flujo constante de escrituras. Un número entero positivo; cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Cuánto tiempo se puede reutilizar el total de una suscripción de lista grande antes de volver a contarlo, en ms; los frames que lo reutilizan llevan `meta.totalAsOf`. Sin definir, cada frame cuenta. Prevalece sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | El último total más pequeño al que se aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada frame. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback bajo `NODE_ENV=production`. Desactivado, para que un arranque en producción falle de forma visible en lugar de conectarse a una base de datos inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada de esquema y sale sin abrir ningún socket —el formato que requiere un Job de migración, desde la misma imagen y el mismo bundle que el servidor posterior. También crea las tablas que un proceso de servicio crearía en su primer uso, y no inicia ningún cron ni cola de jobs. Un valor vacío equivale a *no definido*, por lo que un `${SOMETHING}` sin sustituir en un archivo compose no puede convertir un despliegue normal en uno que migra y se niega a servir. Incompatible con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Una ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribe en ella cada cambio de esquema que realizó, en orden, como un script SQL para revisar y aplicar con `psql`. Las filas que escribió no se incluyen. Se rechaza en un proceso que sirve peticiones. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que una máquina (un agente, un job de CI) *aplique* un cambio de esquema a través de `/api/admin/schema`, no solo que lo planifique. Desactivado a menos que se solicite expresamente: la credencial que realizaría dicho cambio es la que con mayor probabilidad reside en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto tiempo puede ejecutarse una función personalizada antes de que se aborte su solicitud. Mismo control que la opción `functionsTimeoutMs`. `0` lo desactiva. Una función que declare el suyo propio (`defineFunction(…, { timeoutMs })`) usará ese en su lugar. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | El tiempo de espera máximo que una función puede declarar para sí misma con `defineFunction(…, { timeoutMs })`, en ms; una que solicite más recibe este valor. Un número positivo; cualquier otra cosa se interpreta como no definido. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado finalice el proceso en lugar de registrarlo. Actívalo bajo un orquestador que te reinicie; desactívalo donde un reinicio sea peor que una fuga. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en una plataforma que el runtime detecta como escala a cero (scale-to-zero), donde un temporizador que se dispara en una instancia inactiva no se dispara en ninguna instancia. No cambia nada más: defínelo cuando mantengas al menos una instancia en ejecución. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente de `X-Forwarded-For`. Por defecto seguro `0`: sin proxy, confiar en la cabecera permitiría a cualquier emisor falsificar una identidad. | `0` |

:::note[El aprovisionamiento de arranque es aditivo y no es una herramienta de migración]
La pasada de arranque se ejecuta desatendida sin nadie leyendo un diff, por lo que nunca eliminará
una columna, restringirá un tipo ni reescribirá una tabla. Por eso también la imagen rechaza
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcula un diff y ejecutará gustosamente
`DROP COLUMN`, y el reinicio de un contenedor nunca debe ser capaz de destruir una
columna de producción como efecto secundario de una reprogramación.

Los cambios destructivos o de reestructuración se mantienen donde puedan revisarse: `rebase db
generate` + `rebase db migrate`, o `rebase db push` desde un checkout o CI,
lo cual simula el cambio en seco (dry-run), rechaza los cambios destructivos sin confirmación y
puede realizar una copia de seguridad primero.
:::

### Despliegues divididos

Una misma imagen y un mismo bundle pueden arrancarse varias veces, sirviendo cada uno una
parte diferente del proyecto. Se incluye una línea por cada uno aquí, ya que esta página pretende
listar todas las variables; lo que cada combinación *monta y gestiona* —y qué
combinaciones se niegan a arrancar— se encuentra en
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Invalida si *este* proceso ejecuta los temporizadores de cron. Sin definir sigue el rol. | — |
| `REBASE_JOB_WORKERS` | Invalida si este proceso ejecuta los workers de la cola de jobs. Sin definir sigue el rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Servir únicamente las funciones personalizadas nombradas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir todas las funciones personalizadas excepto las nombradas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Hacia dónde reenvía el proceso de API una solicitud de función que no sirve él mismo. En un `worker`, adónde van sus propias llamadas `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Un endpoint opcional de Model Context Protocol en `/mcp`, para que un cliente de IA pueda leer
y escribir en este proyecto **como el usuario autenticado**. Desactivado a menos que se defina y —a diferencia
de cualquier otra superficie— ningún `REBASE_ROLE` lo activa: los demás describen la estructura
de un proceso, mientras que este es una decisión de entregar credenciales a software de terceros,
y debe ser tomada por una persona en lugar de heredarse de la función de un
contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie rechaza montarse y lo indica en el registro de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede derivarlo: tomar el origen de la cabecera `Host` haría que la identidad del emisor y la audiencia contra la que se verifican sus propios tokens fueran valores suministrados por el emisor de la petición. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista MCP App propia del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), servida a Claude en lugar de la vista genérica para que represente tus vistas, campos y acciones personalizados. Sin ella, el backend busca junto al frontend que sirve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permitir el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse a sí mismo. Establece `false` para requerir que los clientes se registren previamente. | `true` |

### Edición de esquema en vivo desde un bundle

Desactivada a menos que se defina `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilado no tiene el
código fuente de `backend/schema` para editar, por lo que con estas variables definidas el editor de esquemas
lee la fuente del repositorio, confirma (commit) cada cambio de vuelta y ejecuta su DDL en
esta base de datos. Solo para administradores, y aplicado por una persona a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Un repositorio indicado sin
una credencial utilizable se niega a arrancar. Consulta
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub en el que confirmar los cambios de esquema, como `owner/name`. Definirlo es lo que activa la función. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se efectúa el commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Dónde reside `backend/schema` en ese repositorio, relativo al repositorio. Una ruta que salga del repositorio se niega a arrancar, y lo mismo ocurre con la eliminada `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token de acceso detallado con permisos de lectura y escritura en los contenidos del repositorio. Define este o las tres variables `_GITHUB_APP_*`, no ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | El ID de una GitHub App, para hacer commits como la app en lugar de con un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | La instalación de la app en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clave privada de la app: PEM, PEM con saltos de línea escapados o base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir significa que las copias programadas están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obligatoria con `BACKUP_SCHEDULE`, que se niega a ejecutarse sin ella. `rebase db backup` recurre a `./backups` en la ubicación donde se ejecutó. | — |
| `BACKUP_RETENTION_DAYS` | Eliminar copias de seguridad con más de N días de antigüedad. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conservar siempre al menos N de las copias de seguridad más recientes, sin importar lo que indique la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe el binario `pg_dump` —debe coincidir con la versión mayor del servidor o ser más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe el binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe el binario `psql` que ejecuta `rebase db restore --clean` para que la restauración sea una sola transacción. | — |
| `PG_DUMPALL_PATH` | Dónde reside `pg_dumpall`, cuando no está en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas—, una copia de seguridad de elementos globales falla con un error que nombra esta variable. | — |

La imagen oficial del runtime (`rebasepro/server`) incluye las herramientas de cliente de
PostgreSQL 18, por lo que una copia de seguridad programada se ejecuta en ella contra cualquier servidor hasta Postgres 18.
Fuera de la imagen, instálalas tú mismo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Las copias de seguridad contienen secretos e información de identificación personal (PII). Utiliza un destino privado con
cifrado en reposo.

### Entrega del bundle

Un despliegue administrado no incluye su código en la imagen: el runtime obtiene un
bundle al arrancar. Estas variables determinan cuál y cómo.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Lo que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De dónde obtener el archivo comprimido del bundle, cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial Bearer para esa descarga. Trátala como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los que declara por sí mismo. | — |

### Vinculación de recursos (Resource bindings)

Cada base de datos, bucket y topic que un proyecto declara en `backend/resources.ts` se
vincula mediante variables de entorno nombradas a partir de él. Los nombres base se muestran a
continuación; un recurso que no sea el predeterminado añade `__` y su clave en mayúsculas, por lo
que un bucket llamado `media` lee `S3_BUCKET__MEDIA`. `rebase status`
muestra, por recurso,
la variable exacta que está leyendo y si está definida.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_DRIVER` | El paquete npm que implementa el controlador de una fuente de datos, cuando no es el predeterminado de Postgres. Con sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un topic declarado. Con sufijo por topic. | — |

### El propio entorno de la CLI

Leído por `rebase`, no por el servidor. Nada de lo que hay aquí afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Adónde envían la service key `rebase api-keys`, `rebase storage` y `rebase auth reset-password`, en la shell o en `.env`. Defínelo cuando el servidor se ejecute de otra manera que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor, otro host. Sin definir, utilizan el servidor que `rebase dev` registró mientras ese servidor está en ejecución, y no envían nada cuando no lo está. | — |
| `REBASE_SERVICE_KEY` | La service key con la que se autentican esos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Un nombre anterior para esa clave. Cuando `.env` lo define, `rebase api-keys` y `rebase storage` lo leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` impide que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` de la raíz del repositorio, para una raíz cuyos archivos de agente gestionas manualmente. | on |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda proporcionarla sin que llegue al historial de la shell. | — |
| `REBASE_TOKEN` | Un token de `rebase cloud tokens create`. Si está definido, cada comando de `rebase cloud` se autentica con él en lugar de con la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión almacenada. En un directorio vinculado con `rebase cloud init --claim`, se reserva para el propio token de ese proyecto cuando no tiene permisos en el proyecto. La forma de ejecutar `rebase cloud` en CI — consulta [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI que generan sus herramientas en la nube, y nunca lo envía a la aplicación: define `REBASE_API_TOKEN` para eso. | — |
| `REBASE_DEBUG` | `1` muestra el error subyacente y los detalles de la solicitud en lugar del mensaje breve. Lo primero que se debe configurar cuando un comando de `rebase cloud` falla sin dar información útil. | — |
| `REBASE_ATLAS_DEV_URL` | La base de datos vacía contra la que planifican `rebase db push`, `db generate` y `db migrate`, en lugar de la `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no crea ni elimina una base de datos nombrada aquí, y rechaza una igual a `DATABASE_URL`. En la base de datos de desarrollo administrada, la CLI la establece en un PGlite en memoria desechable propio. Defínelo donde no se conceda `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos ni aprovisiona nada —tú aportas la tuya propia. Igual que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo frontend, que de lo contrario `rebase dev` deriva de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend se anuncie antes de indicar que no ha iniciado. `0` desactiva el reporte. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` coloca en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convención compartida entre herramientas. Establécelo en cualquier valor que no sea `0` y la CLI no enviará telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No necesita ningún archivo, por lo que es la que se debe usar en CI y en una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Adónde se envía la telemetría, para un colector autohospedado. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto este como `REBASE_SERVICE_KEY` se
generan automáticamente fuera de producción, para que puedas comenzar sin configurar nada.

Esos valores generados se almacenan en caché en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url` e ignorados en git con ellos. Antes, se
regeneraban en cada arranque —por lo que reiniciar el servidor de desarrollo cerraba tu sesión en
tu propia aplicación e invalidaba cualquier clave de API que acabaras de crear.

- Define cualquiera de las variables explícitamente y se usará la tuya; nada se guarda en caché ni se lee.
- Apunta la caché a otro lugar con `REBASE_DEV_SECRETS_FILE` —una ruta, y la
  única variable de esta sección que definirías deliberadamente.
- Elimina el archivo para rotar ambos secretos. El siguiente arranque generará uno nuevo.
- Si el archivo no se puede escribir —un contenedor de solo lectura, por ejemplo—, el servidor arranca
  de todos modos con un secreto efímero, exactamente como solía hacerlo.

Nada se almacena en caché en producción ni bajo un ejecutor de pruebas. En producción tampoco
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
sin `app`, `server` ni `basePath` y con un `provision` obligatorio, construyen un
backend que no sirve nada hasta que lo montes: `createRebaseBackend`. Consulta
[Integración con servidor personalizado](/docs/backend/custom-server/).

### Cambiar `basePath`

`basePath` mueve cada ruta de la API, por lo que se le debe indicar lo mismo al cliente; de
lo contrario, seguirá solicitando `/api/...` y obtendrá un 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma esto del cliente que se le proporciona; no es necesario
configurar nada más. Si construyes una URL de solicitud manualmente, constrúyela a partir del cliente en
lugar de escribir `/api` tú mismo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el SQL Editor (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista CMS tipo hoja de cálculo carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del SQL Editor cambiando temporalmente los roles de la base de datos para que coincidan con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si estás utilizando una autenticación personalizada donde los roles solo existen en tablas de la base de datos en lugar de ser roles reales de PostgreSQL, el cambio de rol falla o faltan privilegios en la base de datos. La vista CMS tipo hoja de cálculo se ejecuta con el usuario propietario de la conexión predeterminado y omite esto.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` a la configuración `.env` de tu backend. Esto obliga a Rebase a ejecutar las consultas del SQL Editor utilizando los privilegios del propietario de la conexión (normalmente un superusuario/owner). El SQL Editor indicará entonces, sobre los resultados, que se leyeron como el propietario de la conexión, y deshabilitará su selector de roles.

### Fallo al obtener el esquema en el SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no puede cargar el árbol del esquema, o el SQL Editor arroja `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase requiere privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos administrativos. Si no se proporciona `adminConnectionString` al bootstrapper, o si se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
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
- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
