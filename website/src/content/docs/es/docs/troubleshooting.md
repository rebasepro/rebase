---
sourceHash: ff162864c3d1600b
slug: es/docs/troubleshooting
title: Solución de problemas
description: Los fallos que impiden que un backend de Rebase se inicie o preste servicio — una base de datos inaccesible, credenciales incorrectas, una extensión faltante, un rechazo de RLS, desfase de esquema (schema drift), un puerto ocupado, una función que no carga — y el aspecto de cada uno de ellos.
---

Los fallos que impiden que un backend de Rebase se inicie o preste servicio, cómo se ve realmente cada uno en pantalla y qué hacer al respecto.

El arranque falla de forma ruidosa y completa. Si la base de datos es inaccesible, las credenciales son incorrectas o el esquema no se puede compilar o aplicar, `initializeRebaseBackend` lanza una excepción, no se sirve nada y el proceso termina con código `1`. No hay modo degradado: un servidor que se inicia respondiendo al inicio de sesión mientras cada ruta `/api/data/*` falla es más difícil de diagnosticar que uno que nunca llega a iniciarse.

Por lo tanto, el primer lugar donde buscar es siempre lo último en el registro antes de la salida.

## Lectura de un error de arranque

Cada error de base de datos que ves es un wrapper. Drizzle vuelve a lanzar los fallos de consulta como `Failed query: …` con una traza a través de sus propios componentes internos, y la frase que explica qué está mal se encuentra debajo, en `.cause` — o dentro de un `AggregateError` cuando un host dual-stack intentó varias direcciones.

El runtime lo desenvuelve por ti. Un fallo de arranque registra:

- un **diagnóstico enmarcado** que indica el host, el puerto y la solución, y
- líneas `caused by:` que contienen la cadena de errores, terminando en la razón proporcionada por el sistema operativo o Postgres.

Si estás leyendo registros en JSON (`NODE_ENV=production`), la misma cadena se encuentra bajo `error.cause`, con `code`, `address` y `port` en cada enlace.

### `Failed query: [redacted]`

Esa no es una línea de registro truncada. Drizzle construye cada fallo de consulta como `Failed query: <sql>` seguido de los valores vinculados, por lo que la sentencia y sus parámetros —una dirección de correo electrónico, un hash de contraseña— viajan en el mensaje y en la traza de cualquier cosa que el driver vuelva a lanzar. El registrador elimina ese fragmento de cada línea que escribe y muestra `[redacted]` en su lugar.

De todos modos, la sentencia rara vez es la respuesta: la razón se encuentra en las líneas `caused by:` que aparecen debajo. Cuando la necesites, define `REBASE_LOG_RAW_QUERIES=true` en desarrollo y se imprimirá el SQL en su lugar. Se ignora fuera de desarrollo, por lo que una variable que se filtre en un entorno de producción no puede desproteger nada allí.

## La base de datos no se está ejecutando

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Nada está escuchando en esa dirección. Inicia la base de datos:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

O ejecuta `rebase dev` sin ninguna `DATABASE_URL`, lo que iniciará una base de datos PGlite administrada por ti y no necesita nada instalado.

Si el host y el puerto en el recuadro no son los que esperabas, la `DATABASE_URL` en `.env` no es la que leyó el proceso; busca un segundo `.env`, una variable de shell ya exportada o un contenedor que se inició antes de que lo editaras.

## La contraseña o el nombre de la base de datos son incorrectos

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` es una contraseña incorrecta, `28000` un rol que no puede conectarse desde aquí y `3D000` una base de datos que no existe. Los tres son hechos comprobados sobre la cadena de conexión: reintentar produce la misma respuesta, por lo que el arranque falla inmediatamente en lugar de reportar un pool que «podría recuperarse».

Comprueba las credenciales en `DATABASE_URL`. Una contraseña que contenga `@`, `/`, `?` o `#` debe estar codificada en porcentaje (percent-encoded); una que no esté codificada altera silenciosamente la URL y el host al que terminas conectándote no será el que escribiste.

## `SchemaDefinitionError` — el esquema no compila

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El arranque, `rebase db generate`, `db push`, `generate-sdk` y `doctor` compilan las tablas que exporta `backend/schema/index.ts` antes que cualquier otra cosa, y se detienen cuando alguna tabla no compila — sin `rls`, `"inherit"` sin `defaultRls`, una relación con una tabla que el index no exporta, un `defineTable` en un archivo hermano que el index omite —, nombrando cada tabla, clave y problema a la vez. Corrige cada uno; `rebase verify` reporta la misma lista sin iniciar nada.

## Se rechaza `config/collections`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un proyecto anterior a la versión 0.31 mantiene su modelo de datos en `config/collections`, el cual ya nada lee: el runtime, cada comando de la CLI y un bundle format-2 son rechazados con `rebase migrate collections-to-tables` en el mensaje. Ejecútalo en un árbol de git limpio; reescribe el proyecto como `backend/schema` y `frontend/src/cms`, demuestra que el SQL generado no ha cambiado y muestra los pasos que te quedan por hacer. Consulta [Actualización de 0.30 a 0.31](https://rebase.pro/docs/upgrading/0-30-to-0-31/).

## `type "vector" does not exist`

pgvector es una extensión de servidor, por lo que Rebase la instala solo donde el proyecto indica que puede hacerlo. Declárala en `backend/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

La base de datos también necesita una imagen que incluya la biblioteca. La del scaffold, `pgvector/pgvector:pg18`, la incluye; una `postgres:18` genérica no. Si la instalación en sí es rechazada (`extension "vector" is not available`, o un error de permisos), la configuración ya es correcta y lo que falta es la biblioteca en el servidor o un rol autorizado para ejecutar `CREATE EXTENSION vector;`.

## La base de datos rechazó la sentencia

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Dos problemas diferentes se presentan bajo este código, y el mensaje los distingue:

- **Una política de seguridad a nivel de fila (RLS) denegó la fila** — el mensaje anterior. El sistema de control de acceso está funcionando; el llamador solicitó algo que sus políticas no permiten. Comprueba el `rls` de la tabla en `backend/schema` y ejecuta `npx @rebasepro/rls-check` para una auditoría de solo lectura de lo que la base de datos realmente aplicará.
- **El rol carece de un `GRANT`.** El mensaje nombra el objeto en su lugar:

  ```
  DB_PERMISSION_DENIED — Permission denied by the database: the role this request
  runs as has no privilege on schema "rebase". That is a missing GRANT to that
  role, not a row-level security policy.
  ```

  Nada en la solicitud servirá de ayuda — el rol con el que se ejecutan las solicitudes no puede tocar ese objeto en absoluto. El servidor otorga permisos a su rol de solicitud en los esquemas que aprovisiona, en el arranque; un objeto creado fuera de él (por otro rol, o en un esquema que ninguna tabla declara) necesita su propio `GRANT`. Este es un problema de despliegue.

Una lectura que RLS excluye no es un error: las filas se filtran y obtienes una página vacía. Si una tabla se lee vacía para un usuario autenticado que debería ver filas, el lugar donde buscar es la política, no la consulta.

## `SCHEMA_DRIFT` — una tabla o columna no existe

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

El código y la base de datos no coinciden. En desarrollo:

```bash
rebase db push        # apply the tables to the database
rebase doctor         # the full three-way drift report
```

En un tenant administrado de Cloud, `db push` no puede conectarse a la base de datos; el runtime aplica el esquema durante el arranque en su lugar, así que vuelve a desplegar en vez de hacer push.

Si una tabla existe pero una columna no, la causa habitual es un archivo de tabla que se editó sin volver a generar: ejecuta `rebase schema generate` y haz push de nuevo.

## `Error: EOF` de `db push` en la base de datos administrada

```
Error: EOF
✗ atlas schema apply --to file://.rebase/sql/schema.sql --dry-run failed.
```

La base de datos de desarrollo administrada admite pocas conexiones a la vez, y una instancia en ejecución de `rebase dev` retiene algunas de ellas. Atlas, que planifica el push, abre dos más, y una se cerró repentinamente. No se aplicó nada, por lo que es seguro volver a ejecutar el comando; el servidor de desarrollo cierra las conexiones inactivas tras 30 segundos. Si sigue fallando, detén `rebase dev` mientras haces el push.

El push cierra sus propias conexiones antes de que Atlas comience, lo que deja espacio a Atlas en el caso habitual, y el error explica lo ocurrido.

## El puerto ya está en uso

```
Port 3001 is in use — trying 3002.
```

El entorno de desarrollo se vincula al siguiente puerto libre y lo notifica. El mensaje importa porque todo lo demás — la variable `VITE_API_URL` de tu frontend, un marcador, un `curl` — todavía apunta al anterior. La causa habitual es un `rebase dev` previo que aún mantiene ocupado el socket.

Pasa `--port` para fijar uno, o detén el otro proceso. En producción no hay reintentos: el puerto configurado es el puerto, y `EADDRINUSE` es fatal.

## El backend falló y `rebase dev` siguió ejecutándose

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un backend que lanza una excepción en el arranque no detiene el watcher: imprime la traza de error y espera un cambio de archivo. Cuando el backend no se ha anunciado dentro de `REBASE_DEV_READY_TIMEOUT_MS` (30 segundos por defecto), `rebase dev` reporta esto:

```
  ✗ The backend has not started after 30s.
    Fix the error above; the watcher restarts it on the next change.
```

El error que aparece arriba es el verdadero. Las causas más comunes son un error de sintaxis en un archivo dentro de `backend/schema`, una importación que no se resuelve y una `DATABASE_URL` que no apunta a nada.

## Una función personalizada no se está sirviendo

Las funciones se cargan desde `backend/functions` durante el arranque, y un archivo que no se carga se **omite, no es fatal** — el servidor se inicia sin él. Por lo tanto, el síntoma es un 404 en una ruta que acabas de escribir, y la explicación está dos líneas antes en el registro de arranque:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Las causas habituales: una dependencia importada pero no presente en `package.json`, una importación relativa a la que le falta su extensión (`./util` en lugar de `./util.js` — el proyecto es ESM, por lo que la extensión es obligatoria) y un archivo que exporta algo distinto a una aplicación de Hono. Escríbela con `defineFunction(...)` de `@rebasepro/server/functions` para obtener este último caso como un error de compilación en su lugar — esa subruta, no la raíz del paquete, para que la función siga siendo portable.

No se escanean los subdirectorios. `functions/admin/users.ts` se reporta como una entrada omitida en lugar de servirse.

Una vez que el servidor está en funcionamiento, una función que lanza una excepción en el momento de la solicitud responde con la estructura de error JSON y registra el motivo; una función que nunca retorna se interrumpe tras `REBASE_FUNCTIONS_TIMEOUT_MS` y responde `504 FUNCTION_TIMEOUT`.

## ¿Está funcionando? `/livez` y `/health`

| Ruta | Accede a la base de datos | Respuesta |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mientras el proceso esté en ejecución. Úsalo para una sonda de ejecución (liveness probe). |
| `/health` | Sí, a cada fuente de datos | `200 {"status":"ok"}` cuando responde cada fuente de datos configurada; `503 {"status":"degraded"}` cuando una de ellas no responde. Úsalo para una sonda de preparación (readiness probe). |

No configures una sonda de liveness en `/health`: un fallo momentáneo de la base de datos haría que el orquestador termine un proceso que por lo demás está sano, convirtiendo una breve interrupción en un bucle de reinicios.

`/health` no requiere autenticación, por lo que fuera de desarrollo solo publica el veredicto y qué fuente de datos está degradada, y nada más. El texto de error propio del driver —que incluye el host, el puerto, el nombre de la base de datos y el rol— se envía a los registros.

## Errores tras el arranque

Cada fallo de la API responde con la misma estructura y contiene un `code`. La [referencia de códigos de error](/docs/backend/errors/) los enumera todos con el estado y la solución.

## A dónde ir después

- [Códigos de error](/docs/backend/errors/) — cada `code` que la API puede responder, con el estado y la solución.
- [Entorno y configuración](/docs/getting-started/configuration/) — cada variable que lee el runtime y aquellas sin las cuales producción se niega a iniciar.
- [Visión general del backend](/docs/backend/) — lo que hace el arranque, en orden, y qué sonda responde a qué pregunta.
