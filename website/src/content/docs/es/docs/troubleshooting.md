---
sourceHash: 1030bf24935489a6
slug: es/docs/troubleshooting
title: Solución de problemas
description: Los fallos que impiden que un backend de Rebase se inicie o preste servicio — una base de datos inaccesible, credenciales incorrectas, una extensión faltante, un rechazo de RLS, desfase de esquema (schema drift), un puerto ocupado, una función que no carga — y cómo se ve cada uno.
---

Los fallos que impiden que un backend de Rebase se inicie o preste servicio, cómo se ve realmente cada uno en pantalla y qué hacer al respecto.

El arranque falla de forma sonora y completa. Si la base de datos es inaccesible, las credenciales son incorrectas o no se puede aplicar el esquema de la colección, `initializeRebaseBackend` lanza un error, no se sirve nada y el proceso termina con código `1`. No existe un modo degradado: un servidor que se inicia respondiendo al inicio de sesión mientras todas las rutas `/api/data/*` fallan es más difícil de diagnosticar que uno que nunca llega a iniciarse.

Por lo tanto, el primer lugar donde buscar es siempre lo último que aparece en el log antes del cierre.

## Lectura de un error de arranque

Cada error de base de datos que ves es un contenedor (wrapper). Drizzle vuelve a lanzar los fallos de consulta como `Failed query: …` con una traza a través de sus propios componentes internos, y la frase que explica el error se encuentra debajo, en `.cause`, o dentro de un `AggregateError` cuando un host de doble pila intentó varias direcciones.

El runtime lo desenvuelve por ti. Un fallo de arranque registra:

- un **diagnóstico enmarcado** que indica el host, el puerto y la solución, y
- líneas `caused by:` que contienen la cadena, finalizando con el motivo proporcionado por el sistema operativo o Postgres.

Si estás leyendo logs en JSON (`NODE_ENV=production`), la misma cadena se encuentra bajo `error.cause`, con `code`, `address` y `port` en cada enlace.

### `Failed query: [redacted]`

No se trata de una línea de log truncada. Drizzle construye cada fallo de consulta como `Failed query: <sql>` seguido de los valores vinculados, de modo que la sentencia y sus parámetros —una dirección de correo electrónico, un hash de contraseña— viajan dentro del mensaje y la traza de cualquier cosa que el driver vuelva a lanzar. El registrador elimina ese fragmento de cada línea que escribe e imprime `[redacted]` en su lugar.

De todos modos, la sentencia rara vez es la respuesta: el motivo se encuentra en las líneas `caused by:` que están debajo. Cuando realmente lo necesites, establece `REBASE_LOG_RAW_QUERIES=true` en desarrollo y se imprimirá el SQL en su lugar. Esta variable se ignora fuera del entorno de desarrollo, por lo que una variable filtrada en producción no podrá desocultar nada allí.

## La base de datos no se está ejecutando

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

No hay nada escuchando en esa dirección. Inicia la base de datos:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

O ejecuta `rebase dev` sin ningún `DATABASE_URL`, lo que iniciará una base de datos PGlite gestionada automáticamente sin necesidad de instalar nada.

Si el host y el puerto del recuadro no son los que esperabas, la variable `DATABASE_URL` en `.env` no es la que leyó el proceso; comprueba si existe un segundo `.env`, una variable de shell ya exportada o un contenedor que se inició antes de que lo editaras.

## La contraseña o el nombre de la base de datos son incorrectos

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` indica una contraseña incorrecta, `28000` un rol que no puede conectarse desde aquí y `3D000` una base de datos que no existe. Los tres son hechos definitivos sobre la cadena de conexión: reintentar produce la misma respuesta, por lo que el arranque falla inmediatamente en lugar de reportar un pool que «podría recuperarse».

Comprueba las credenciales en `DATABASE_URL`. Una contraseña que contenga `@`, `/`, `?` o `#` debe codificarse en porcentaje (percent-encoded); una no codificada altera silenciosamente la URL y el host al que te terminas conectando no será el que escribiste.

## `type "vector" does not exist`

pgvector es una extensión del servidor, por lo que Rebase solo la instala donde un proyecto indica que puede hacerlo. Declárala en `config/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

La base de datos también necesita una imagen que incluya la biblioteca. La imagen del scaffold `pgvector/pgvector:pg18` la incluye; una `postgres:18` estándar, no. Si la instalación en sí es rechazada (`extension "vector" is not available` o un error de permisos), la configuración ya es correcta y lo que falta es la biblioteca en el servidor o un rol con permisos para ejecutar `CREATE EXTENSION vector;`.

## La base de datos rechazó la sentencia

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Se producen dos problemas distintos bajo este código, y el mensaje los diferencia:

- **Una directiva de seguridad a nivel de fila (RLS) denegó la fila.** El sistema de control de acceso está funcionando; el emisor solicitó algo que sus políticas no permiten. Revisa las `securityRules` de la colección y ejecuta `npx @rebasepro/rls-check` para realizar una auditoría de solo lectura sobre lo que la base de datos realmente aplicará.
- **El rol carece de un `GRANT`.** Nada en la solicitud ayudará: el rol de conexión no puede acceder a la tabla en absoluto. Este es un problema de despliegue.

Una lectura excluida por RLS no es un error: las filas se filtran y obtienes una página vacía. Si una colección se lee como vacía para un usuario autenticado que debería ver filas, el lugar donde mirar es la política, no la consulta.

## `SCHEMA_DRIFT` — una tabla o columna no existe

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

El código y la base de datos no coinciden. En desarrollo:

```bash
rebase db push        # apply the collections to the database
rebase doctor         # the full three-way drift report
```

En un tenant gestionado de Cloud, `db push` no puede conectarse a la base de datos; en su lugar, el runtime aplica el esquema durante el arranque, por lo que debes volver a desplegar en vez de hacer push.

Si una tabla existe pero una columna no, la causa habitual es un archivo de colección editado sin regenerar: ejecuta `rebase schema generate` y haz push de nuevo.

## El puerto ya está en uso

```
Port 3001 is in use — trying 3002.
```

El modo dev se vincula al siguiente puerto libre y lo notifica. El mensaje es importante porque todo lo demás —el `VITE_API_URL` de tu frontend, un marcador, un `curl`— seguirá apuntando al anterior. La causa habitual es una instancia previa de `rebase dev` que aún mantiene ocupado el socket.

Pasa `--port` para fijar uno o detén el otro proceso. En producción no hay reintentos: el puerto configurado es el puerto definitivo, y `EADDRINUSE` es fatal.

## El backend falló y `rebase dev` continuó ejecutándose

Un backend que arroja una excepción al arrancar no detiene el observador (watcher): imprime la traza de pila y espera un cambio de archivo. `rebase dev` reporta esto:

```
  ✗ The backend crashed on startup.
    Fix the error above; the watcher restarts it on the next change.
```

El error que aparece arriba es el verdadero. Las causas más comunes son un error de sintaxis en un archivo de colección, una importación que no se resuelve o una `DATABASE_URL` que no apunta a nada.

## Una función personalizada no se está sirviendo

Las funciones se cargan desde `backend/functions` durante el arranque, y un archivo que falla al cargarse se **omite, no es fatal** — el servidor se inicia sin él. Por lo tanto, el síntoma es un 404 en una ruta que acabas de escribir, y la explicación se encuentra dos líneas antes en el log de arranque:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Las causas habituales: una dependencia importada que no está en `package.json`, una importación relativa a la que le falta la extensión (`./util` en lugar de `./util.js` — el proyecto es ESM, por lo que la extensión es obligatoria) y un archivo que exporta algo que no es una aplicación Hono. Escribe funciones con `defineFunction(...)` de `@rebasepro/server/functions` para obtener esto último como un error de compilación —usa esa subruta, no la raíz del paquete, para que la función siga siendo portable.

No se escanean subdirectorios. `functions/admin/users.ts` se reporta como una entrada omitida en lugar de servirse.

Una vez que el servidor está en funcionamiento, una función que arroja una excepción en tiempo de solicitud responde con la estructura JSON de error y registra el motivo; una función que nunca retorna se interrumpe en `REBASE_FUNCTIONS_TIMEOUT_MS` y responde con `504 FUNCTION_TIMEOUT`.

## ¿Está en funcionamiento? `/livez` y `/health`

| Ruta | Accede a la base de datos | Respuesta |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mientras el proceso esté en ejecución. Utilízalo para una prueba de ejecución (liveness probe). |
| `/health` | Sí, a cada fuente de datos | `200 {"status":"ok"}` cuando responde cada fuente de datos configurada; `503 {"status":"degraded"}` cuando alguna no responde. Utilízalo para una prueba de preparación (readiness probe). |

No configures una prueba de ejecución (liveness probe) en `/health`: un fallo momentáneo de la base de datos haría que el orquestador elimine un proceso por lo demás saludable, convirtiendo una breve interrupción en un bucle de reinicios.

`/health` no requiere autenticación, por lo que fuera de desarrollo solo publica el veredicto y qué fuente de datos está degradada, y nada más. El texto de error del propio driver —que cita el host, el puerto, el nombre de la base de datos y el rol— se envía a los logs.

## Errores después del arranque

Cada fallo de la API responde con la misma estructura y contiene un `code`. La [referencia de códigos de error](/docs/backend/errors/) los lista todos junto con su estado y solución.

## A dónde ir a continuación

- [Códigos de error](/docs/backend/errors/) — cada `code` con el que la API puede responder, junto con su estado y solución.
- [Entorno y configuración](/docs/getting-started/configuration/) — cada variable que lee el runtime y aquellas sin las cuales producción se negará a iniciar.
- [Visión general del backend](/docs/backend/) — qué hace el arranque, en orden, y qué prueba responde a qué pregunta.

---
