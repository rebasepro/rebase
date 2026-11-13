---
sourceHash: acc55c3c58895863
title: Entorno y configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos de Rebase.
---

## Variables de entorno

Toda la configuración se realiza a través de variables de entorno en el archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase valida las variables de entorno con **Zod** al inicio. Si
> falta algo obligatorio o tiene un formato incorrecto (una URL que no es una URL, un puerto que
> no es un número), el servidor se niega a arrancar e indica el nombre de la variable.
>
> Dónde reside el esquema depende de cómo ejecutes el backend. Un proyecto iniciado por
> el runtime (`rebase dev`, `rebase start`, la imagen publicada) utiliza el
> esquema que posee el runtime (`loadBootEnv` en `@rebasepro/server`), que es la
> unión de todas las tablas siguientes. Un proyecto que ha ejecutado [`rebase eject`](/docs/cli)
> posee un archivo `backend/src/env.ts` que llama a `loadEnv({ extend })`, y puede agregar allí
> sus propias variables tipadas.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. **Opcional en desarrollo**: si no se define, `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Obligatoria en cualquier otro entorno. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Usa una cadena aleatoria segura (mínimo 32 caracteres). **Obligatoria en producción** (se genera automáticamente en desarrollo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` es una sintaxis de node-postgres, no de libpq.**
>
> Rebase y el driver de Node la aceptan: cifran, pero no verifican el
> certificado. `psql`, `pg_dump`, `pg_restore` y Atlas no lo hacen, y no se
> degradan: se niegan a iniciar con `invalid sslmode value: "no-verify"`.
>
> Los comandos propios de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la reescriben a la equivalente `sslmode=require` antes de invocar el proceso,
> por lo que funcionan con la URL configurada. Usar `psql` manualmente no lo hace:
> cámbiala allí por `sslmode=require`, que cifra sin verificar exactamente de la misma manera.

### Frontend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `VITE_API_URL` | URL de la API del backend para el SDK tipado. **Configura esto solo en desarrollo**; consulta más abajo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |


> **Deja `VITE_API_URL` sin definir en las compilaciones de producción.**
>
> En desarrollo, el frontend y el backend son orígenes separados, por lo que el
> servidor de desarrollo la inyecta. En producción, el backend de Rebase sirve la
> SPA, por lo que la API es el propio origen de la página y el cliente la resuelve
> de esa manera por sí mismo.
>
> Incrustar una URL absoluta en un bundle de producción funciona hasta que un segundo
> nombre de host apunta a la misma aplicación: un dominio personalizado carga entonces
> la página desde `example.com` y llama a la API en `example.rebase.website`, lo cual es
> de origen cruzado (cross-origin), por lo que cada solicitud falla en el preflight. Permitir
> el origen en CORS **tampoco** lo soluciona: la cookie de actualización (refresh cookie) es
> `SameSite=Lax` y no se envía entre sitios (cross-site), por lo que eliminarías los errores
> de consola pero seguirías teniendo la autenticación rota. Si no se define, cualquier
> dominio que apunte a la aplicación funciona sin necesidad de configuración CORS alguna.

### Backend

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `PORT` | Puerto para el servidor HTTP del backend. Leído por `rebase start`. `rebase dev` lo lee **únicamente desde el entorno del shell** (un `PORT` en `.env` no se lee allí, porque el puerto se resuelve antes de cargar ese archivo) y, de lo contrario, vincula un puerto derivado de la ruta del proyecto, de modo que varios proyectos puedan ejecutarse a la vez. `rebase dev --port` tiene prioridad sobre ambos, y el banner de inicio indica qué nivel utilizó. | `3001` |
| `LOG_LEVEL` | Nivel de detalle de los logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Muestra el SQL detrás de una línea `Failed query: [redacted]`. Todas las sentencias fallidas se redactan por defecto, porque una consulta fallida contiene sus parámetros enlazados (un correo electrónico, un hash de contraseña). Establécelo en `true` al diagnosticar un fallo de DDL, RLS o captura de cambios. Se ignora cuando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Entorno: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Lista separada por comas de orígenes permitidos. **Obligatoria en producción** a menos que `FRONTEND_URL` esté definida: un arranque en producción sin ninguna de las dos se negará a iniciar. En desarrollo se *agrega a* localhost; consulta más abajo. | — |
| `FRONTEND_URL` | URL de la aplicación frontend. Se utiliza como alternativa a CORS_ORIGINS, en ambos entornos. | — |
| `ADMIN_CONNECTION_STRING` | Cadena de conexión a la base de datos de nivel de administrador (utilizada para introspección del esquema y operaciones de administración). La base de datos que nombra no es la que la consola SQL considera actual, ni la que copia una nueva rama por defecto: ambas corresponden a la base de datos en la que se encuentra la conexión propia de la aplicación (consulta `REBASE_BRANCH_PARENT_DATABASE` para un servidor en una rama). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Deshabilita el cambio de roles de PostgreSQL en el SQL Editor (útil para autenticación personalizada donde los roles de la base de datos no están mapeados). La consola SQL de Studio indicará entonces que las filas se leyeron como el propietario de la conexión, mostrará su nombre y deshabilitará su selector de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de datos desde la que se copió la rama en la que se ejecuta este servidor. `rebase dev` la establece en un checkout [cambiado a una rama](/docs/backend/branching/#cli-integration). Un servidor con esta variable mantiene el registro de ramas en esa base de datos y copia nuevas ramas desde ella por defecto, por lo que el panel de Ramas de Studio muestra las ramas de la base de datos principal. | — |

#### CORS en desarrollo

El desarrollo permite **localhost, más lo que especifique `CORS_ORIGINS` (o
`FRONTEND_URL`)**: la misma lista que usa producción, con localhost añadido en
lugar de sustituido. De este modo, la variable funciona de la misma manera en ambos
entornos, y los casos que la necesitan en desarrollo son los habituales:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un origen que no sea localhost ni esté en la lista es rechazado, y el rechazo se
registra en los logs **una vez por origen** con la línea exacta que lo permitiría.
Rechazarlo no es precaución por capricho: la API envía credenciales, por lo que
reflejar un `Origin` arbitrario permitiría a cualquier sitio que el desarrollador
visite realizar solicitudes autenticadas contra el servidor de desarrollo con su
sesión y leer las respuestas.

### Autenticación

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `JWT_SECRET` | Secreto para la firma de JWT (obligatorio en producción, generado automáticamente en desarrollo) | — |
| `JWT_PRIVATE_KEY` | Clave privada PEM para firmar tokens de acceso de forma asimétrica (RS256), de modo que cualquiera que posea el JWKS pueda verificar una sesión sin poder emitir una. Acepta un PEM con saltos de línea reales, un PEM con escapes `\n` o base64 del PEM completo. Sin esto, los tokens se mantienen en HS256. | — |
| `JWT_KEY_ID` | Nombra `JWT_PRIVATE_KEY` en la cabecera del token y en el JWKS. Cámbialo cada vez que cambie la clave: la rotación depende de que la clave antigua y la nueva sean distinguibles. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva, por lo que esto rige cuánto tiempo sobrevive una sesión ante la **inactividad**. Establece `400d` para sesiones que sobrevivan a una larga ausencia; los navegadores limitan la cookie de actualización a ese plazo. | `30d` |
| `ALLOW_REGISTRATION` | Permite el registro de nuevos usuarios (`true`/`false`). Fuera de producción, el **primer** usuario siempre puede registrarse, sin importar lo que diga esto: una tabla de usuarios vacía debe admitir a alguien, y ese alguien se convierte en administrador. En producción (`NODE_ENV=production`) esa ventana está cerrada: una tabla vacía rechaza el registro de arranque con `SETUP_REQUIRED`, una primera cuenta creada a través de registro abierto es una cuenta ordinaria, y el administrador se nombra con `REBASE_ADMIN_EMAIL` más abajo o se asigna con la clave de servicio. El `.env.example` del scaffold lo establece en `true`; el valor por defecto del framework es desactivado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor de corte total. Cierra la ventana de arranque del primer usuario que `ALLOW_REGISTRATION=false` deja abierta deliberadamente fuera de producción, de modo que el registro se cierra incluso ante una base de datos vacía. Combínalo con `REBASE_ADMIN_EMAIL` a continuación, o el despliegue no tendrá forma de producir su primer usuario autenticado. Todos los artefactos de despliegue distribuidos lo establecen. | — |
| `REBASE_ADMIN_EMAIL` | Correo electrónico de la primera cuenta de administrador, creada al iniciar **mientras la tabla de usuarios aún está vacía** y nunca después. Así es como un despliegue en producción obtiene su administrador: el operador nombra la primera cuenta en lugar de competir contra internet por ella. El arranque advierte cuando la tabla está vacía en producción y esto no está definido. | — |
| `REBASE_ADMIN_PASSWORD` | Contraseña para esa cuenta. Al menos 12 caracteres, o será rechazada y la cuenta no se creará. Cámbiala tras el primer inicio de sesión. | — |
| `MFA_ENCRYPTION_KEY` | Cifra todos los secretos TOTP almacenados. Si no se define, los secretos se cifran con `JWT_SECRET` en su lugar y el arranque muestra una advertencia; por lo tanto, rotar `JWT_SECRET` cerrará la sesión de todos *y* dejará indescifrable cada autenticador registrado. Establece una clave dedicada (más de 32 caracteres aleatorios) antes de que alguien se registre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clave desde la cual se está rotando. Establece ambas durante una rotación: los nuevos secretos se escriben con `MFA_ENCRYPTION_KEY` y los existentes siguen siendo legibles, por lo que nadie quedará bloqueado de su propia cuenta a mitad de la rotación. Elimínala una vez que todos los secretos hayan sido recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita el inicio de sesión anónimo (`POST /api/auth/anonymous`). Opcional (opt-in), y deliberadamente no condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Requiere autenticación para la API de datos. Establécelo en `false` para una superficie de lectura totalmente pública; RLS se sigue aplicando. | `true` |
| `AUTH_DEFAULT_ROLE` | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resuelve un correo electrónico a un perfil público mínimo (`uid`, `displayName`, `photoURL`) para flujos de invitación por correo electrónico. Solo para emisores autenticados, y nunca devuelve el correo, roles o metadatos del usuario encontrado. Desactivado por defecto: es una superficie de enumeración. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` en la cookie de actualización: `Strict`, `Lax` o `None`. `None` requiere HTTPS y es solo para un frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` en la cookie de actualización. Seguro por defecto; `AUTH_COOKIE_SECURE=false` para http simple: un despliegue en una dirección de red local (LAN) donde el navegador de lo contrario descartaría la cookie y la sesión moriría al expirar el token de acceso sin ningún error. Advierte al arrancar. `http://localhost` no lo necesita. | `true` |
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
| `GITLAB_CLIENT_ID` | ID de cliente de GitLab OAuth. La `baseUrl` de una instancia autohospedada no tiene variable de entorno equivalente; configura GitLab en el bloque `auth` para eso. | — |
| `GITLAB_CLIENT_SECRET` | Secreto de cliente de GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente de Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secreto de cliente de Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID de cliente de Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secreto de cliente de Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente de Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secreto de cliente de Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID, para inicio de sesión web. Es público y se expone en `GET /auth/config`. Apple no tiene un secreto de cliente estático, porque Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Por lo tanto, Apple necesita `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY`, además de esto o `APPLE_BUNDLE_IDS`, y no configura nada sin ellos. | — |
| `APPLE_BUNDLE_IDS` | Identificadores de paquete (bundle ids) separados por comas de las aplicaciones nativas de iOS/macOS cuyos códigos de Sign in with Apple son aceptados. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, el emisor del JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clave privada registrada en Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenido del archivo de clave privada `.p8`, con saltos de línea incluidos (se aceptan escapes `\n`). | — |
| `REBASE_SERVICE_KEY` | Clave de API estática de administrador. Omite la autenticación JWT normal para llamadas de servidor a servidor cuando se pasa como `Authorization: Bearer <key>`. (Generada automáticamente en desarrollo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La clave pública de la plataforma de alojamiento (PEM, EC P-256) contra la que se verifican los tokens de plataforma `rpt_`; varios bloques PEM durante una rotación de claves. La plataforma la define al desplegar y no contiene secretos. Junto con `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que la barrera de administración acepte un token de plataforma para `cron:read`, y para nada más. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | El ID de proyecto al que debe ser igual el `aud` de un token de plataforma, de modo que un token emitido para otro proyecto sea rechazado. Si solo una de las dos variables está configurada, el servidor arranca, registra una advertencia y responde a cada token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dónde residen los contadores de límite de tasa (rate-limit) de autenticación: `memory` (por proceso) o `sql` (compartido entre réplicas). Un proceso no puede ver su propio recuento de réplicas, por lo que un despliegue con pares debe indicarlo: tres réplicas con la opción por defecto aplican el triple del límite. Cualquier otro valor **se niega a arrancar** en lugar de degradarse, incluido `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta el flujo de enlace de inicio de sesión sin contraseña. Requiere un servicio de correo electrónico configurado, o el enlace no tendrá a dónde enviarse. | `false` |
| `AUTH_EMAIL_OTP` | Monta el inicio de sesión sin contraseña con un código de seis dígitos enviado por correo electrónico. Mismo requisito de correo electrónico que el anterior. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registro sin contraseña: una solicitud de enlace mágico o código por correo para una dirección desconocida crea la cuenta, mientras el registro esté abierto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Qué hace un token de actualización reutilizado después de su ventana de reutilización: `reject` (rechazarlo, mantener la sesión) o `revoke-session` (finalizar el inicio de sesión). Cualquier otra opción falla el arranque. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro con confirmación previa: no se permite el inicio de sesión con contraseña hasta que se verifique la dirección. Requiere correo electrónico; el arranque lo rechaza sin él. | `false` |
| `CAPTCHA_PROVIDER` | Activa la verificación por captcha en las rutas de autenticación: `turnstile` o `hcaptcha`. Sin definir significa sin captcha. | — |
| `CAPTCHA_SECRET` | El secreto del proveedor, utilizado en el servidor para verificar el token que envía el navegador. Obligatorio una vez definido `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rutas de autenticación separadas por comas para proteger (por ejemplo `register,login`). Sin definir protege el conjunto por defecto del proveedor. | — |

### Almacenamiento

:::caution[El almacenamiento no tiene seguridad a nivel de fila, por lo que necesita un modelo de acceso]
Las tablas están protegidas por RLS de Postgres. El almacenamiento de objetos no tiene
equivalente (las claves comparten un único espacio de nombres plano), por lo que con
un bucket configurado y sin un modelo de acceso el servidor **se niega a arrancar en producción**.
Cumple este requisito con exactamente uno de los siguientes:
un hook `storageAuthorize` exportado desde `backend/storage.ts` (lo que incluye la plantilla inicial),
`STORAGE_PUBLIC_READ`, o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local`, `s3` o `gcs`. En producción, `local` desactiva el almacenamiento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Ruta base para el almacenamiento local. Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor: la raíz del proyecto bajo `rebase dev`, `backend/` en un servidor generado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite el almacenamiento local en producción: solo con un volumen persistente que contenga `STORAGE_PATH` y los directorios `<STORAGE_PATH>__<key>` de los buckets locales nombrados junto a él | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante los cuales funciona la URL de descarga de un archivo privado (el token que `getSignedUrl()` incluye en ella). Como máximo `604800` (una semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Archivo más grande que acepta el origen, en bytes, en cada ruta de subida (`__<KEY>` para un origen con nombre). Si no es un número entero de bytes, rechaza el arranque | `52428800` (50 MB) |
| `S3_BUCKET` | Nombre del bucket S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forzar URLs de estilo ruta para el bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nombre del bucket GCS (cuando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Proyecto de GCP. Por lo general, se infiere de las credenciales. | — |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio. Omitir en GCP, donde Workload Identity suministra las credenciales. | — |
| `STORAGE_PUBLIC_READ` | Servir cada objeto a cualquiera, sin token. Solo para un bucket que realmente sea una CDN pública. Una de las tres formas de satisfacer la validación de arranque indicada abajo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permitir que cualquier emisor autenticado lea, escriba, liste y elimine cada objeto. Nombrado `INSECURE` en el objeto de configuración por una razón: solo es defendible en una aplicación de un solo inquilino (single-tenant) donde se confía en cada cuenta para cada archivo. | `false` |
| `STORAGE_RENDITION_CACHE` | Almacenar en caché las representaciones de imágenes generadas (cambios de tamaño, conversiones de formato) en lugar de producirlas por solicitud. | `false` |

### Correo electrónico (Opcional)

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
| `EMAIL_LOGO_URL` | Logo mostrado en la parte superior de las plantillas de correo por defecto. PNG o JPG absoluto `http(s)`; los clientes eliminan los SVG y bloquean las URIs `data:`. Si no se define, una aplicación que aún se llame `Rebase` obtiene la marca de Rebase y una renombrada no obtiene ninguno |

### Pool de conexiones de base de datos

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DB_POOL_MAX` | Máximo de conexiones en el pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milisegundos que se mantiene una conexión inactiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milisegundos de espera para una conexión | `10000` |
| `DATABASE_DIRECT_URL` | Conexión directa (sin pool). [Realtime](/docs/backend/realtime) necesita una: `LISTEN`/`NOTIFY` no sobrevive a un pooler de transacciones como PgBouncer, y sin ella las notificaciones de cambios se desactivan con una advertencia en lugar de perderse silenciosamente. El [job worker](/docs/backend/jobs) también mantiene su `LISTEN` de reactivación en ella. Completa el `directConnectionString` del adaptador de Postgres cuando no está configurado. | — |
| `DATABASE_READ_URL` | Réplica de lectura, como un hot standby. Cuando especifica otro servidor, las lecturas autenticadas (listas, filas individuales, recuentos, agregados) se sirven allí bajo la misma seguridad a nivel de fila; las escrituras, el inicio de sesión, tiempo real, crons, jobs, la consola SQL y `rebase.sql` permanecen en el primario. Un lector que acaba de escribir lee del primario durante `REBASE_READ_STICKY_MS`, y todos lo hacen mientras la réplica tenga más de `REBASE_READ_MAX_LAG_MS` de retraso o esté fallando. Completa el `readConnectionString` del adaptador de Postgres cuando no está definido; hasta la versión 0.28 incluida, el pool de la réplica se abría y nunca se leía de él. | — |
| `REBASE_READ_STICKY_MS` | Después de una escritura, cuánto tiempo van las lecturas del mismo usuario al primario, para que un guardado seguido de un listado muestre el guardado. Por instancia de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retraso de la réplica a partir del cual todas las lecturas van al primario. | `1000` |
| `DATABASE_POOLED` | `true` cuando `DATABASE_URL` pasa a través de un pooler en modo transacción como PgBouncer. El pool entonces no envía `search_path` o `statement_timeout` al conectarse (el pooler los rechazaría o descartaría) y establece ambos en cada transacción; el arranque le otorga al rol de base de datos un `search_path` por defecto de `public` para sentencias fuera de una transacción. `DATABASE_DIRECT_URL` pasa a ser obligatoria, y tiempo real, la reactivación del job worker, la creación de índices, ramificaciones y la consola SQL la utilizan. La URL de la réplica también se asume con pool. `DATABASE_POOLED__<KEY>` para otra fuente de datos. | — |
| `REBASE_DB_POOL_MAX` | Un límite máximo para cada pool en el proceso, aplicado sin importar lo que cada uno haya solicitado. Solo dígitos simples: un valor con formato incorrecto se ignora en lugar de serializar silenciosamente el servidor. | — |

### Comportamiento del runtime

Leído por el runtime: `rebase dev`, `rebase start` y la imagen de servidor
publicada. Un proyecto que ha hecho eject gestiona estas decisiones en su propio
código en su lugar.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` ejecuta la [auditoría de seguridad a nivel de fila](/docs/rls-check#running-it-on-a-schedule) programada, que reporta tablas que se sirven sin políticas. El proyecto debe declarar `@rebasepro/rls-check` entre sus dependencias: el runtime no incluye ninguna copia, y sin el paquete el arranque lo rechaza, indicando su nombre. `false` mantiene el escaneo desactivado en este proceso. | — |
| `REBASE_RLS_REQUEST_ROLE` | El rol de Postgres con el que se ejecutan las solicitudes autenticadas y anónimas. Asigna uno propio a cada proyecto en un clúster compartido. Una base de datos registra el rol con el que se ejecuta, y un arranque configurado para otro se niega a iniciar hasta que `rebase db request-role migrate` lo migre. Consulta [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea el rol de solicitud y permite que la conexión cambie a él; `never` te deja ambos a ti y solo los verifica. | `auto` |
| `REBASE_RLS_GRANTS` | Lo que Rebase otorga al rol de solicitud: `schema` (cada tabla en los esquemas que sirve, más privilegios por defecto), `managed` (solo las tablas que sirve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe las políticas permisivas de Rebase al/los rol(es) de solicitud, de modo que otros roles que lean las mismas tablas no obtengan nada de ellas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` escribe las políticas que solo el contexto del servidor o un administrador pueden pasar `TO public`, y ejecuta a los administradores como el rol de solicitud. Por defecto son `TO rebase_admin`, por lo que las lecturas con ámbito de propietario de usuarios autenticados pueden usar el índice de propietario. Consulta [Solicitudes de administrador y `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` elimina la política de referencia de servidor o administrador de cada tabla. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` también establece `request.jwt.claims` y `request.jwt.claim.*`, de modo que las políticas escritas con `auth.uid()` vean al emisor de la llamada. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Lo que hace un arranque cuando otro login puede cambiar al rol de solicitud: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Ruta base para cada ruta de la API. Se le debe indicar lo mismo al cliente; consulta [Cambio de `basePath`](#cambio-de-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir los recursos estáticos/de administración del bundle desde este proceso. Desactívalo cuando haya una CDN al frente. | `true` |
| `REBASE_HISTORY` | Registrar el [historial de cambios de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respuestas gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Cuerpo máximo de la solicitud, **en bytes** (`10485760`, no `10MB`; un valor que no sea un número rechaza el arranque en lugar de eliminar silenciosamente el límite). `0` desactiva el límite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. Tri-estado. <span class="since-badge" data-since="0.31">Desde 0.31</span> Sin definir, en todos los entornos: `/api/docs` se sirve a los emisores a los que `GET /api/schema/tables` describe las tablas, a cada uno el documento de las tablas que se le describen, y no hay UI de Swagger. `true` publica el documento completo para todos, con la **UI** de Swagger en `/api/swagger` fuera de producción (nunca en producción). `false` mantiene el documento tras la barrera de administración. | — |
| `REBASE_METRICS` | Expone métricas de Prometheus en `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Agrega `includeSubDomains` a la cabecera `Strict-Transport-Security`, por lo que los navegadores rechazan HTTP sin cifrar en cada subdominio del host durante seis meses, incluidos los hosts que este proceso no sirve. Actívalo solo cuando todos los subdominios del dominio sean exclusivamente HTTPS. Cualquier valor que no sea `true`/`false` rechaza el arranque. Consulta [Cabeceras de seguridad](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Si no se define, deja el endpoint abierto a cualquiera que pueda alcanzar el puerto: correcto en una red privada, pero no en una pública, y los registros de arranque así lo advierten. | — |
| `REBASE_MIGRATE_ON_BOOT` | Lo que el runtime puede hacer con el esquema de las tablas al arrancar. `ensure` (por defecto en todas partes, incluida producción) ejecuta la pasada **aditiva**: crea tablas, columnas y tipos enum faltantes, nunca elimina ni reescribe ninguno. `none` deja intacto el esquema de las tablas declaradas, pero las tablas propias del framework (auth, API keys, jobs, cron) se siguen creando y manteniendo actualizadas; `REBASE_PROVISION=false` también las desactiva. La imagen publicada solo acepta estas dos y **se niega a arrancar con `push`**. En un [despliegue dividido](/docs/deployment/split-processes), exactamente un proceso puede aprovisionar, por lo que cualquier otro rol debe establecer `none` o negarse a arrancar. | `ensure` |
| `REBASE_PROVISION` | `false` hace que el runtime no cambie nada en su base de datos: ninguna tabla, columna, índice, función, disparador, política, rol o privilegio, ni al arrancar ni después, incluidos los propios del framework. En su lugar, reporta por nombre lo que falta. Para una base de datos que solo tu proceso de cambios puede modificar. Consulta [Cuando solo tu proceso de cambios puede modificar la base de datos](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Solo se aceptan `true` y `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rechaza el arranque cuando la base de datos fue aprovisionada por última vez a partir de un conjunto de tablas diferente del cual se compiló este proceso. Si no está definido (o es cualquier cosa distinta de `true`/`1`), muestra una advertencia en su lugar. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rechaza el arranque cuando un archivo de función o cron lanza un error o no puede parsearse al importarse, indicando cada archivo y el motivo, de modo que un despliegue continuo (rolling deploy) deje la versión anterior en funcionamiento. Un reinicio también se sujeta a esto. Si no está definido (o es cualquier cosa distinta de `true`), omite el archivo y sirve el resto. Un archivo que se importa limpiamente y no exporta ninguna función o trabajo siempre se omite, no se rechaza. | skip |
| `REALTIME_CDC` | Captura de cambios a nivel de base de datos: `auto` (habilitar donde la conexión lo soporte, degradar silenciosamente en caso contrario), `trigger` (forzarlo, advertir si es imposible), `wal` (leer cambios del registro write-ahead en lugar de disparadores; requiere `wal_level=logical` y un rol que pueda replicar, recurre a `trigger` en caso contrario), `off`. Consulta [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instancias para canales de difusión (broadcast) y presencia: `memory` o `postgres`. Se ignora cuando a `realtime.bus` se le proporcionó un transporte construido. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Cuántas suscripciones puede mantener un socket de tiempo real; la siguiente se rechaza con `TOO_MANY_SUBSCRIPTIONS`. Un número entero positivo; cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulta [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Cuántos sockets de tiempo real puede mantener abiertos un usuario, o una clave de API, en una instancia del servidor. Los sockets de suplantación de un administrador cuentan para el administrador. El inicio de sesión del siguiente se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra (4002); el SDK continúa reintentando, por lo que entra cuando otro se cierra. Un número entero positivo; cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.maxSocketsPerUser`. | Sin límite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | El tiempo máximo que espera un cambio antes del refetch que lo entrega a los suscriptores activos, en ms. Un refetch espera 300 ms sin cambios, y como máximo este tiempo bajo un flujo constante de escrituras. Un número entero positivo; cualquier otra cosa detiene el servidor al arrancar. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Cuánto tiempo se puede reutilizar el total de una suscripción a una lista grande antes de contarlo nuevamente, en ms; los frames que lo reutilizan llevan `meta.totalAsOf`. Sin definir, se cuenta en cada frame. Prevalece sobre `realtime.recountIntervalMs`. | Sin definir |
| `REALTIME_RECOUNT_MIN_ROWS` | El último total más pequeño al que se aplica `REALTIME_RECOUNT_INTERVAL_MS`; las listas más pequeñas se cuentan en cada frame. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback bajo `NODE_ENV=production`. Desactivado por defecto, para que un arranque en producción falle de forma visible en lugar de conectarse a una base de datos que no existe. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` ejecuta la pasada de esquema y sale sin abrir un socket: la forma que necesita un Job de migración, desde la misma imagen y el mismo bundle que el servidor que le sigue. También crea las tablas que un proceso de servicio crearía en su primer uso, y no inicia ningún cron ni cola de jobs. Un valor vacío se considera *sin definir*, por lo que un `${SOMETHING}` no sustituido en un archivo compose no puede convertir un despliegue ordinario en uno que migre y se niegue a servir. Rechazado si se usa junto con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Una ruta de archivo. Una ejecución de aprovisionamiento (`REBASE_PROVISION_ONLY=true`) escribe en ella cada cambio de esquema que realizó, en orden, como un script SQL para revisar y aplicar con `psql`. Las filas que escribió no se incluyen. Se rechaza en un proceso que sirve tráfico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite a una máquina (un agente, un job de CI) *aplicar* un cambio de esquema a través de `/api/admin/schema`, no solo planificarlo. Desactivado a menos que se solicite: la credencial que realizaría dicho cambio es la que con mayor probabilidad se encuentre en una variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Cuánto tiempo puede ejecutarse una función personalizada antes de que se aborte su solicitud. El mismo control que la opción `functionsTimeoutMs`. `0` lo desactiva. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` hace que un rechazo de promesa no controlado finalice el proceso en lugar de registrarlo. Activado bajo un orquestador que te reiniciará; desactivado donde un reinicio sea peor que una fuga. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia la advertencia de arranque en una plataforma que el runtime detecta como escalado a cero (scale-to-zero), donde un temporizador que se dispara en una instancia inactiva no se dispara en ninguna instancia. No cambia nada más: configúralo cuando mantengas al menos una instancia en ejecución. | — |
| `TRUSTED_PROXY_HOPS` | Cuántos proxies se encuentran delante de este servidor, para que el limitador de tasa pueda leer la dirección real del cliente desde `X-Forwarded-For`. Valor por defecto seguro `0`: sin proxy, confiar en la cabecera permitiría a cualquier cliente falsificar una identidad. | `0` |

:::note[El aprovisionamiento al arrancar es aditivo y no es una herramienta de migración]
La pasada de arranque se ejecuta sin supervisión humana y sin que nadie revise un diff,
por lo que nunca eliminará una columna, restringirá un tipo ni reescribirá una tabla.
Esa es también la razón por la que la imagen rechaza `REBASE_MIGRATE_ON_BOOT=push`:
un push completo calcula un diff y ejecutaría alegremente un `DROP COLUMN`, y el reinicio
de un contenedor nunca debe ser capaz de destruir una columna de producción como efecto
secundario de una reprogramación.

Los cambios destructivos o de reestructuración se mantienen donde puedan revisarse:
`rebase db generate` + `rebase db migrate`, o `rebase db push` desde un checkout o CI,
lo cual realiza una simulación previa (dry-run), rechaza cambios destructivos sin confirmación
y permite generar una copia de seguridad primero.
:::

### Despliegues divididos

Una misma imagen y un mismo bundle se pueden iniciar varias veces, sirviendo
cada una una parte distinta del proyecto. Aquí se resume una línea por variable,
ya que esta página reúne todas las variables; para saber qué *monta y gestiona* cada
combinación (y qué combinaciones no pueden arrancar), consulta
**[Procesos divididos](/docs/deployment/split-processes)**.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_ROLE` | Qué parte sirve este proceso: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Invalida si *este* proceso ejecuta los temporizadores cron. Sin definir sigue el rol. | — |
| `REBASE_JOB_WORKERS` | Invalida si este proceso ejecuta workers de la cola de jobs. Sin definir sigue el rol. | — |
| `REBASE_FUNCTIONS_ONLY` | Servir solo las funciones personalizadas indicadas en este proceso. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir todas las funciones personalizadas excepto las indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Dónde reenvía el proceso de API una solicitud de función que no sirve él mismo. En un `worker`, a dónde van sus propias llamadas `rebase.functions`. Una URL `http(s)`. | — |

### Superficie MCP

Un endpoint opcional de Model Context Protocol en `/mcp`, para que un cliente de IA
pueda leer y escribir en este proyecto **como el usuario autenticado**. Desactivado
a menos que se configure, y —a diferencia de cualquier otra superficie— ningún
`REBASE_ROLE` lo activa: los demás describen la forma de un proceso, mientras que
este implica la decisión de otorgar credenciales a software de terceros, y debe ser
tomada por una persona en lugar de heredarse del rol asignado al contenedor.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Requiere `REBASE_PUBLIC_URL`; sin ella, la superficie se niega a montarse y lo indica en el log de arranque. | `false` |
| `REBASE_PUBLIC_URL` | El origen accesible externamente de este despliegue, por ejemplo `https://app.example.com`. La superficie MCP no puede derivarlo: tomar el origen de la cabecera `Host` haría que la identidad del emisor, y la audiencia contra la que se verifican sus propios tokens, dependan de un valor suministrado por quien hace la llamada. | — |
| `REBASE_MCP_VIEW` | Ruta a la vista propia de la MCP App del proyecto (`rebase-view.html`, generada por `rebaseMcpViewPlugin()`), que se sirve a Claude en lugar de la vista genérica para que dibuje tus vistas, campos y acciones personalizados. Sin ella, el backend busca junto al frontend que sirve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permitir el registro dinámico de clientes OAuth (RFC 7591), para que un cliente pueda registrarse por sí mismo. Establécelo en `false` para requerir que los clientes se registren previamente. | `true` |

### Edición de esquemas en vivo desde un bundle

Desactivado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esté configurado. Un bundle
compilado no tiene el código fuente `backend/schema` para editar, por lo que con
estas variables configuradas, el editor de esquemas lee el código fuente desde el
repositorio, envía un commit con cada cambio y ejecuta su DDL en esta base de datos.
Exclusivo para administradores y aplicado por una persona, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique lo contrario. Un repositorio indicado
sin credenciales utilizables rechazará el arranque. Consulta
[Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | El repositorio de GitHub en el que hacer commit de los cambios de esquema, en formato `owner/name`. Configurarlo es lo que activa la funcionalidad. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La rama en la que se registra el commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Dónde reside `backend/schema` en ese repositorio, relativo a la raíz del repositorio. Una ruta que apunte fuera del repositorio rechaza el arranque, al igual que la variable eliminada `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token de granularidad fina con acceso de lectura y escritura al contenido del repositorio. Configura esta variable o las tres variables `_GITHUB_APP_*`, no ambas opciones. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | El ID de una GitHub App, para hacer commits como la aplicación en lugar de usar un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | La instalación de la aplicación en el repositorio. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clave privada de la aplicación: PEM, PEM con saltos de línea escapados, o base64. | — |

### Copias de seguridad (Backups)

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Expresión cron para copias de seguridad programadas. Sin definir significa que están desactivadas. | — |
| `BACKUP_DESTINATION` | Ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obligatorio con `BACKUP_SCHEDULE`, que se niega a ejecutarse sin ella. `rebase db backup` recurre a `./backups` en el directorio donde se ejecutó. | — |
| `BACKUP_RETENTION_DAYS` | Elimina copias de seguridad con más de N días. Sin definir o `0` conserva todo. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos N copias de seguridad más recientes, sin importar la retención. | — |
| `PG_DUMP_PATH` | Sobrescribe el binario `pg_dump`: debe coincidir con la versión mayor del servidor o ser más reciente. | — |
| `PG_RESTORE_PATH` | Sobrescribe el binario `pg_restore`. | — |
| `PSQL_PATH` | Sobrescribe el binario `psql` que ejecuta `rebase db restore --clean` para que la restauración se realice en una sola transacción. | — |
| `PG_DUMPALL_PATH` | Dónde reside `pg_dumpall`, cuando no se encuentra en el `PATH`. Sin él —y sin las herramientas de cliente de PostgreSQL instaladas— una copia de seguridad global falla con un error que nombra esta variable. | — |

La imagen de runtime oficial (`rebasepro/server`) incluye las herramientas de cliente
de PostgreSQL 18, por lo que una copia de seguridad programada se ejecuta en ella contra
cualquier servidor hasta Postgres 18. Fuera de la imagen, instálalas manualmente
(`apt-get install postgresql-client-18`, `brew install libpq`).

Las copias de seguridad contienen secretos e información de identificación personal (PII).
Usa un destino privado con cifrado en reposo.

### Entrega de bundles

Un despliegue gestionado no incluye su código en la imagen: el runtime descarga un
bundle al arrancar. Estas variables deciden cuál y de qué forma.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BUNDLE` | Ruta a un directorio de bundle ya extraído. Es lo que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | Desde dónde descargar el archivo del bundle, cuando no hay uno local. | — |
| `REBASE_BUNDLE_TOKEN` | La credencial Bearer para esa descarga. Trátala como un secreto: es lo que autoriza a un inquilino a descargar su propio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dónde se extrae un bundle descargado. Debe tener permisos de escritura y persistir entre la descarga y el arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionales que la imagen del runtime proporciona al bundle, más allá de los que declara por sí misma. | — |

### Vinculaciones de recursos (Resource bindings)

Cada base de datos, bucket y topic que declara un proyecto en `backend/resources.ts`
se vincula mediante variables de entorno nombradas a partir de él. Los nombres base
se listan a continuación; un recurso que no sea el predeterminado añade `__` y su clave
en mayúsculas, por lo que un bucket llamado `media` lee `S3_BUCKET__MEDIA`. `rebase status`
imprime, por recurso, la variable exacta que está leyendo y si está configurada.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_DRIVER` | El paquete npm que implementa el driver de una fuente de datos, cuando no es el driver de Postgres por defecto. Lleva sufijo por fuente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La cadena de conexión para un topic declarado. Lleva sufijo por topic. | — |

### El entorno propio de la CLI

Leído por `rebase`, no por el servidor. Nada de lo que figura aquí afecta a un despliegue.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `REBASE_BASE_URL` | A dónde envían la clave de servicio comandos como `rebase api-keys`, `rebase storage` y `rebase auth reset-password`, ya sea en el shell o en `.env`. Defínela cuando el servidor se ejecute de otra forma que no sea `rebase dev` en este proyecto: `rebase start`, un contenedor u otro host. Sin definir, utilizan el servidor que `rebase dev` registró mientras ese servidor esté activo, y no envían nada cuando no lo está. | — |
| `REBASE_SERVICE_KEY` | La clave de servicio con la que se autentican dichos comandos, leída desde `.env`: la misma variable que lee el servidor (ver arriba). | — |
| `SERVICE_KEY` | Un nombre anterior para esa clave. Cuando `.env` la define, `rebase api-keys` y `rebase storage` la leen en lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qué archivo `.env` lee y escribe la CLI, cuando no es el del proyecto. | — |
| `REBASE_ROOT_RULES` | `0` evita que `rebase init` y `rebase skills install` escriban las reglas del proyecto en `CLAUDE.md` y `AGENTS.md` en la raíz del repositorio, útil cuando mantienes manualmente los archivos para agentes en la raíz. | on |
| `REBASE_CLOUD_URL` | El plano de control con el que se comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | La cuenta con la que inicia sesión `rebase cloud login`, en lugar de solicitarla interactivamente. | — |
| `REBASE_CLOUD_PASSWORD` | Su contraseña, para que un gestor de secretos pueda proporcionarla sin que quede registrada en el historial del shell. | — |
| `REBASE_TOKEN` | Un token obtenido con `rebase cloud tokens create`. Al configurarse, cada comando de `rebase cloud` se autentica con él en lugar de la sesión de `rebase cloud login`, y nunca lee ni escribe la sesión almacenada. En un directorio vinculado mediante `rebase cloud init --claim`, se aparta a favor del token propio de ese proyecto cuando no dispone de alcance sobre el proyecto. La forma indicada para ejecutar `rebase cloud` en CI; consulta [CI y agentes](/docs/deployment/cloud/#ci-and-agents). El [servidor MCP](/docs/ai/mcp/) lo pasa a la CLI que generan sus herramientas de cloud, y nunca lo envía a la aplicación: usa `REBASE_API_TOKEN` para eso. | — |
| `REBASE_DEBUG` | `1` imprime el error subyacente y los detalles de la solicitud en lugar del mensaje breve. Lo primero que se debe configurar cuando un comando de `rebase cloud` falla de forma poco descriptiva. | — |
| `REBASE_ATLAS_DEV_URL` | La base de datos vacía sobre la cual `rebase db push`, `db generate` y `db migrate` planifican los cambios, en lugar de la base de datos `<db>_dev_diff` que crean junto a `DATABASE_URL`. Rebase no crea ni elimina una base de datos nombrada aquí, y rechaza una que sea idéntica a `DATABASE_URL`. En la base de datos de desarrollo administrada, la CLI utiliza un PGlite desechable en memoria propio. Defínela cuando no se disponga del permiso `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` no inicia ninguna base de datos y no aprovisiona nada: tú proporcionas la tuya. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fija el puerto del servidor de desarrollo del frontend, que de lo contrario `rebase dev` deduce de la ruta del proyecto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Cuánto tiempo espera `rebase dev` a que el backend responda antes de indicar que no ha iniciado. `0` desactiva este reporte. | `30000` |
| `DATABASE_PASSWORD` | La contraseña que `rebase dev --docker` incluye en la cadena de conexión que deriva de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convención transversal entre herramientas. Establécelo en cualquier valor que no sea `0` y la CLI no enviará telemetría. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo mismo, específicamente para Rebase. No requiere archivo, motivo por el cual es la variable adecuada para usar en CI y dentro de una imagen. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Dónde se envía la telemetría, para un recolector autohospedado. | — |

## Secretos en desarrollo

`JWT_SECRET` es obligatorio en producción. Tanto esta variable como
`REBASE_SERVICE_KEY` se generan automáticamente fuera de producción,
de modo que puedas comenzar sin configurar nada.

Estos valores generados se guardan en `.rebase-dev-secrets.json`, junto a
`.rebase-dev-port` y `.rebase-dev-url`, y están incluidos en el `.gitignore` con ellos.
Anteriormente, se regeneraban en cada inicio; por tanto, reiniciar el servidor de
desarrollo cerraba la sesión en tu propia aplicación e invalidaba cualquier clave
de API que acabaras de crear.

- Configura cualquiera de las variables explícitamente y se utilizará tu valor;
  no se almacenará en caché ni se leerá nada del archivo.
- Apunta la caché a otra ubicación con `REBASE_DEV_SECRETS_FILE`: una ruta de archivo,
  y la única variable de esta sección que configurarías deliberadamente.
- Elimina el archivo para rotar ambos secretos. El siguiente arranque generará uno nuevo.
- Si el archivo no se puede escribir (por ejemplo, en un contenedor de solo lectura),
  el servidor se iniciará de todos modos con un secreto efímero, exactamente como antes.

Nada se guarda en caché en producción ni bajo un ejecutor de pruebas. En producción
tampoco se genera nada: un arranque sin `JWT_SECRET` fallará indicando el nombre
de la variable, comportamiento que se mantiene sin cambios:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de configuración del backend

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El `RebaseBackendConfig` que se pasa a `initializeRebaseBackend()` proporciona control programático:

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

Las mismas opciones, sin `app`, `server` ni `basePath` y con un `provision`
obligatorio, construyen un backend que no sirve nada hasta que lo montes:
`createRebaseBackend`. Consulta [Integración de servidor personalizado](/docs/backend/custom-server/).

### Cambio de `basePath`

`basePath` mueve cada ruta de la API, por lo que se debe indicar lo mismo al cliente;
de lo contrario, continuará solicitando `/api/...` y obtendrá un error 404 para todo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

El panel de administración toma este valor del cliente que se le proporciona; no
es necesario configurar nada más. Si construyes una URL de solicitud manualmente,
concatenala desde el cliente en lugar de escribir `/api` tú mismo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solución de problemas

### Permiso denegado en el SQL Editor (`permission denied for table <name>`)

* **Síntomas:** Las consultas personalizadas ejecutadas en el editor SQL de Rebase Studio fallan con `cause: error: permission denied for table <name>`, a pesar de que la vista CMS en hoja de cálculo carga los datos correctamente.
* **Causa:** Por defecto, Rebase intenta ejecutar las consultas del SQL Editor cambiando temporalmente de rol en la base de datos para coincidir con el rol de aplicación del usuario activo (por ejemplo, `SET LOCAL ROLE "admin"`). Si utilizas una autenticación personalizada donde los roles solo existen en tablas de la base de datos y no como roles reales de PostgreSQL, el cambio de rol falla o no se tienen los privilegios correspondientes en la base de datos. La vista de hoja de cálculo del CMS se ejecuta bajo el usuario propietario de la conexión por defecto y elude este mecanismo.
* **Solución:** Añade `DISABLE_DB_ROLE_SWITCHING=true` a la configuración de tu archivo `.env` del backend. Esto fuerza a Rebase a ejecutar las consultas del SQL Editor usando los privilegios del propietario de la conexión (generalmente un superusuario/propietario). El SQL Editor indicará entonces, sobre los resultados, que se leyeron como el propietario de la conexión y deshabilitará su selector de roles.

### Fallo al obtener el esquema en el SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Síntomas:** Studio no logra cargar el árbol de esquemas, o el SQL Editor lanza el error `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necesita privilegios administrativos para consultar los catálogos del sistema de la base de datos y ejecutar comandos de administración. Si no se proporciona `adminConnectionString` al bootstrapper, o si se sobrescribe `getAdmin()` para devolver `undefined`, estas operaciones fallan.
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
