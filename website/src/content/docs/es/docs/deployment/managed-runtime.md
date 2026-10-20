---
sourceHash: 63d8ba53bb0e0c67
title: Runtime de backend administrado
sidebar_label: Runtime administrado
description: Qué puede y qué no puede hacer un backend con runtime "managed" en Rebase Cloud — paquetes y binarios, memoria y CPU, tiempos de espera y tamaños del cuerpo, el sistema de archivos, el estado en memoria, secretos, almacenamiento para archivos generados y red saliente.
---

Una aplicación de backend declarada de esta manera en `rebase.json` se ejecuta en el **runtime administrado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Administrado significa que envías un bundle, no una imagen. `rebase cloud deploy` compila tus colecciones, `backend/functions/` y crons en `dist-bundle`, lo sube, y Rebase Cloud lo arranca sobre la imagen publicada `rebasepro/server`. Nunca escribes un Dockerfile y tampoco puedes cambiar lo que hay dentro de la imagen. Esta página detalla lo que esto permite, para que puedas planificar una funcionalidad antes de implementarla.

Los valores aquí descritos provienen del runtime y de la plataforma tal y como son hoy en día. Algunos son parámetros que puedes ajustar, y la página indica cuáles de ellos. Algunas cosas aún no están resueltas por completo; están marcadas como **Sin definir** y se recopilan [al final](#sin-definir-aún). No desarrolles basándote en ellas sin antes consultar.

## De un vistazo

| Pregunta | Respuesta |
|---|---|
| Versión de Node | Node 22, en Debian slim, `linux`/`x64` |
| Paquetes npm | Sí, los de JavaScript puro. Se instalan cuando se inicia cada instancia |
| Módulos nativos (`.node`, node-gyp) | No. `rebase cloud deploy` rechaza el bundle |
| WebAssembly | No se verifica ni se bloquea. **Sin definir** si está soportado |
| Generar un proceso secundario (spawn) | No se bloquea, pero casi no hay nada que ejecutar. Consulta [Binarios](#binarios-y-procesos-secundarios) |
| Memoria y CPU | Se configuran por proyecto con `rebase cloud compute`. Consulta [Cómputo](#cómputo-e-instancias) |
| Instancias | 1 por defecto. Puedes fijar hasta 5, o dejar que el escalador automático aumente hasta 16 |
| Tiempo de espera de función | 30 segundos, luego `504 FUNCTION_TIMEOUT`. Configurable |
| Cuerpo de la petición (Request body) | 10 MiB, luego `413`. Configurable, hasta los 64 MiB que acepta el edge |
| Sistema de archivos con permisos de escritura | Sí, pero es temporal y pertenece a una sola instancia |
| Estado a nivel de módulo (una caché `Map`) | Sobrevive entre peticiones en una misma instancia. Se pierde en cada despliegue y reinicio, y no se comparte entre instancias |
| Variables de entorno y secretos | `rebase cloud env set`, aplicadas en el siguiente despliegue |
| Almacenamiento de archivos | Un bucket por proyecto, servido por tu backend en `/api/storage/file/…` |
| HTTP saliente | Sí, en los puertos 80 y 443 (y 465, 587, 993 para correo). Los demás puertos están bloqueados |

## Código y paquetes

**Node y la imagen.** La imagen del runtime está construida sobre `node:22-slim` (Debian), y tu bundle se ejecuta en `linux`/`x64` como usuario sin privilegios de root. Tu `tsconfig` y la versión de Node de tu máquina local no alteran esto.

**Dependencias.** El bundle lista las dependencias declaradas en tus archivos `package.json`. La subida no incluye `node_modules`. Cada instancia instala las dependencias desde el registro público de npm cuando inicia, con `npm ci` (o `npm install` si no hay archivo lockfile). De esto se derivan tres aspectos:

- **Los scripts de instalación nunca se ejecutan.** La instalación utiliza `--ignore-scripts`. Un paquete que descargue un binario o compile algo en `postinstall` se instalará sin ello.
- **Solo se instalan versiones del registro.** Una dependencia `file:`, `link:`, `git+…` o `github:` provocará un fallo en la compilación, ya que el runtime no tiene forma de resolverla.
- **Algunos paquetes provienen de la imagen, no de ti.** `@rebasepro/*`, `hono`, `zod` y `typescript` se eliminan de las dependencias del bundle y se utilizan las copias de la propia imagen, por lo que tu versión de ellos no se aplica.

La subida del bundle tiene un límite de 100 MB, comprimido, sin dependencias.

**Se rechazan los módulos nativos.** Un paquete que incluya un binario `.node` compilado no puede cargarse en el runtime administrado. `rebase build` emitirá una advertencia al respecto y `rebase cloud deploy` se detendrá antes de subir:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La comprobación busca paquetes nativos conocidos (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la presencia de `binding.gyp` o `gypfile`, scripts de instalación que llamen a `node-gyp` o `prebuild`, y archivos `.node`. La [guía de despliegue](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) enumera las alternativas habituales para solventarlo. En resumen: realiza el trabajo durante la compilación, recurre a un servicio externo o despliega con `runtime: "custom"`.

**WebAssembly.** Nada en la compilación ni en el runtime analiza archivos `.wasm`. Un paquete de JavaScript puro que cargue un archivo `.wasm` no es rechazado, y Node 22 puede ejecutarlo. Que funcione correctamente no ha sido probado en el runtime administrado, por lo que debes considerarlo como **sin definir**. Ten en cuenta el [límite de memoria](#cómputo-e-instancias) si el módulo es grande, como un modelo de ML o de voz.

### Binarios y procesos secundarios

Nada bloquea `child_process`, pero la imagen contiene muy poco para ejecutar: `node`, `npm`, `sh`, `tar` y las herramientas cliente de PostgreSQL (`pg_dump`, `pg_restore`). No hay `ffmpeg`, ni ImageMagick, ni Python, ni compiladores. No puedes añadir paquetes del sistema, ya que no hay Dockerfile y el proceso no se ejecuta como root.

Un binario incluido dentro del propio archivo tarball de un paquete npm se instalará junto con el paquete. Si su ejecución está soportada está **sin definir**. Un binario que un paquete descargue durante el `postinstall` nunca llegará a estar disponible, ya que los scripts de instalación no se ejecutan.

Si una funcionalidad requiere un binario, recurre a una API externa alojada para realizar ese trabajo, o migra el backend a `runtime: "custom"`, donde podrás crear tu propia imagen.

## Cómputo e instancias

Cada proyecto se ejecuta en sus propios pods. La memoria y la CPU se asignan por instancia y se configuran mediante los [parámetros de cómputo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un proyecto que nunca haya configurado un parámetro se ejecuta como un pod con capacidad de ráfaga (burstable): reserva una pequeña cantidad y puede superarla temporalmente en picos de demanda. Ejecuta `rebase cloud compute` para ver la solicitud (request) y el límite que realmente tiene tu proyecto. La solicitud documentada por defecto es de `250m` de CPU y `512Mi` de memoria; el código de la plataforma actualmente establece valores por defecto inferiores, con un límite de ráfaga de 2 CPU y 2 GiB, por lo que esta cifra está **sin definir**.

Instancias:

- **Una por defecto.** `--replicas` fija entre 1 y 5.
- **El autoescalado es opcional.** `--autoscale-max` establece un techo de hasta 16, y `--autoscale-cpu-target` (por defecto 70) define el uso de CPU que persigue el autoescalador.
- **Los despliegues son progresivos (rolling).** Una nueva instancia se inicia y pasa a estar lista antes de que la anterior se detenga, por lo que durante un breve periodo de tiempo dos versiones atenderán tráfico simultáneamente.

`--spot` y `--scale-to-zero` están desactivados por defecto. Las instancias spot se reinician sin previo aviso. Si `--scale-to-zero` surte efecto actualmente está **sin definir**; planifica considerando una instancia que siempre esté en ejecución.

## Memoria y estado a nivel de módulo

Un valor a nivel de módulo, como `const cache = new Map()` al inicio del archivo de una función, reside en el proceso de Node. Permanece de una petición a otra dentro de la misma instancia. Se pierde cada vez que ese proceso finaliza:

- en **cada despliegue**, ya que cada despliegue inicia nuevas instancias;
- cuando una **variable de entorno** cambia y se despliega;
- cuando una instancia se reinicia, se reprograma o (con `--spot`) es reclamada.

Si hay más de una instancia, cada una tiene su propia copia, por lo que dos peticiones distintas pueden encontrarse con cachés diferentes.

Utiliza un `Map` a nivel de módulo como una caché que puedas permitirte perder: algo que agilice la siguiente petición pero que no constituya la única copia de ningún dato. Conserva cualquier dato cuyo procesamiento haya tenido un coste, como audio generado o una respuesta costosa de una API, en la base de datos o en el [almacenamiento](#almacenamiento-para-archivos-generados). Para clientes que construyes una sola vez, como el SDK de una API, utiliza `lazyResource` para que el cliente se inicialice en el primer uso a partir del entorno de la petición. Consulta [Configuración y Secretos](/docs/backend/custom-functions/#configuration-and-secrets).

[Ejecución de más de una instancia](/docs/deployment/multiple-instances/) enumera el estado que Rebase mantiene por proceso, como los contadores de límites de velocidad (rate-limit) y los canales en tiempo real.

## El sistema de archivos

El sistema de archivos del contenedor permite escritura, y `/tmp` funciona. Sin embargo, todo lo que se escriba allí:

- pertenece a una única instancia, y las demás instancias no pueden verlo;
- se elimina cuando la instancia se detiene, es decir, a más tardar en el siguiente despliegue;
- comparte un límite de almacenamiento efímero de 6 GiB con el bundle y sus `node_modules` instalados. Una instancia que sobrepase este límite será desalojada (evicted).

Úsalo para archivos temporales de trabajo durante una petición concreta. No lo utilices como caché persistente entre despliegues ni como almacenamiento para subidas de archivos. Por esa misma razón [`STORAGE_TYPE=local` está deshabilitado en producción](/docs/backend/storage/#environment-variables).

## Peticiones

| Límite | Por defecto | Modifícalo con |
|---|---|---|
| Tiempo de espera de función | 30 s, luego `504` con código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo desactiva) |
| Cuerpo de la petición, todas las rutas `/api/*` | 10 MiB, luego `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en bytes |
| Cuerpo de la petición en el edge | 64 MiB | Fijo |
| Un archivo mediante `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Llamadas anónimas a `/api/functions/*` | 3000 por IP cada 15 minutos | `rateLimit.anonymousFunctions` |

Algunos detalles:

- **El tiempo de espera libera al cliente que llama, no al proceso en ejecución.** A los 30 segundos, quien realiza la llamada recibe un `504` y `getSignal(c)` se aborta. Pasa esa señal a `fetch` y a cualquier otro elemento que la admita, de modo que el trabajo también se detenga. Consulta [Tiempos de espera y límites de velocidad](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **El edge tiene su propio tiempo de espera.** Las peticiones llegan a tus instancias a través de un ingress de nginx que no define un tiempo de espera de lectura propio, por lo que se aplica el valor por defecto del controlador (60 segundos en ingress-nginx). Incrementar `REBASE_FUNCTIONS_TIMEOUT_MS` por encima de ese valor está **sin definir**: el edge podría cerrar la conexión antes. Para tareas que tomen minutos, responde inmediatamente y procesa el trabajo en un [job](/docs/backend/jobs/) o mediante `waitUntil`.
- **Subidas mayores a 64 MiB** requieren la subida reanudable (TUS), la cual envía el archivo por fragmentos (chunks). `client.storage.putObject()` cambia automáticamente a esta modalidad por encima de los 8 MiB.
- **Tamaño de la respuesta.** Ni el runtime ni el edge imponen un límite al tamaño de las respuestas. Sin embargo, una respuesta grande se mantendrá en memoria si tu manejador la construye en un solo bloque, por lo que es preferible transmitirla por streaming o servirla desde el almacenamiento.

## Variables de entorno y secretos

Configúralos mediante la CLI o en la consola. No existe un campo para ellos en `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Un cambio se aplica en el siguiente despliegue.** Las instancias en ejecución mantienen los valores con los que iniciaron. `set` y `unset` te recordarán esto (`Pending redeploy`).
- **Límites:** hasta 100 variables por proyecto, 32 KiB por valor y 256 KiB en total. Los nombres deben seguir el patrón `[A-Za-z_][A-Za-z0-9_]*`.
- **Algunos nombres están reservados.** La plataforma define por sí misma `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` y `NODE_ENV`, y fija cómo debe ejecutarse el proceso (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Se rechazará cualquier intento de configurar uno de estos, y el mensaje de error los listará todos.
- **`CORS_ORIGINS` proviene de tus dominios.** La plataforma lo establece con el host del proyecto y sus [dominios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados, y ese valor prevalece sobre cualquiera que configures manualmente. Añade un origen con `rebase cloud domains`, no con `env set`.
- **Las variables de almacenamiento son valores por defecto.** La plataforma asigna las variables `STORAGE_*` y `S3_*` para su propio bucket, pero cualquier valor que definas tendrá prioridad.
- **Se rechazan nombres de tiempo de compilación.** Las variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` y `REACT_APP_` están destinadas a frontends durante la compilación, y el backend nunca llega a recibirlas a tiempo. `--force` almacenará una de ellas de todos modos.

Dentro de una función, léelas dentro del manejador, nunca en la parte superior del archivo:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Una lectura de `process.env` en el ámbito global del módulo que devuelva un valor vacío provocará que el archivo completo falle al cargarse, y sus rutas responderán con `404`. Consulta [Configuración y Secretos](/docs/backend/custom-functions/#configuration-and-secrets).

## Almacenamiento para archivos generados

Un proyecto de Cloud obtiene almacenamiento de archivos una vez que lo creas:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

O bien vincula el proyecto a un bucket que ya poseas mediante `rebase cloud storage attach` (S3, R2, MinIO o cualquier bucket compatible con S3). Si no se utiliza ninguna de las dos opciones, las subidas responderán `501 STORAGE_NOT_CONFIGURED`. Se pueden declarar buckets adicionales en `config/resources.ts`; consulta [Varios Buckets](/docs/backend/storage/#several-buckets).

Un despliegue con almacenamiento configurado será rechazado hasta que el proyecto defina quién tiene permisos para leer y escribir archivos. El archivo base `config/storage.ts` exporta un hook `storageAuthorize` para este propósito. Consulta [Autorización por objeto](/docs/backend/storage/#per-object-authorization).

**Cómo se sirven los archivos.** Tu backend sirve cada archivo en `GET /api/storage/file/<key>`. Lee el objeto desde el bucket y lo envía por streaming, incluyendo cabeceras `Content-Type`, soporte para solicitudes de rango (range requests) y cabeceras de caché. No existe una URL directa del bucket que se pueda compartir públicamente.

- Una clave bajo **`public/`** se sirve a cualquier usuario, sin necesidad de token, en una URL permanente que nunca cambia. Utilízala para archivos que cualquier visitante pueda cargar, como audios generados para un juego de acceso público.
- Cualquier otra clave es privada. Un cliente solicita a `/api/storage/metadata/<key>` una URL de descarga que contiene un token, válido por defecto durante 300 segundos (`STORAGE_DOWNLOAD_TOKEN_TTL`, configurable hasta una semana).

Desde una función, escribe utilizando `rebase.storage` (el bucket por defecto) o `rebase.bucket(…)` (uno con nombre específico). Tu hook `storageAuthorize` seguirá determinando si la escritura está autorizada.

Las transformaciones de imágenes (`?width=`, `?format=`) requieren `sharp`, que es un módulo nativo y no está presente en la imagen administrada. En el runtime administrado, una solicitud de transformación devolverá la imagen original.

### Ejemplo: cachear audio generado

Una función que convierte texto a voz utilizando una API externa, almacena cada resultado una sola vez y lo sirve desde el almacenamiento en adelante. El `Map` solo ahorra una consulta al almacenamiento en una instancia caliente (warm); el bucket es la verdadera caché, por lo que un despliegue no pierde ningún dato.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

Esta ruta es pública, al igual que cualquier ruta en `backend/functions/` hasta que la protejas. Una implementación real validaría quién está autorizado a generar nuevo audio, evitando así que un desconocido agote el presupuesto de tu API de síntesis de voz.

## Red saliente

Las funciones pueden invocar servicios externos. Las conexiones salientes desde tus instancias están permitidas hacia cualquier dirección de internet únicamente en estos puertos TCP:

| Puerto | Uso |
|---|---|
| 80, 443 | HTTP y HTTPS |
| 465, 587 | Envío de correo mediante SMTP con TLS o STARTTLS |
| 993 | IMAP sobre TLS |

Cualquier otro puerto está bloqueado. Esto incluye el puerto 25, IMAP sin cifrar y bases de datos o cachés en sus puertos habituales: no es posible conectarse a un PostgreSQL en el 5432, un Redis en el 6379 o un MongoDB en el 27017 fuera de Rebase Cloud. La dirección de metadatos de la nube (`169.254.169.254`) también se encuentra bloqueada.

La plataforma no añade ningún proxy ni límite de velocidad saliente; los servicios a los que llames aplicarán los suyos propios. Pasa `getSignal(c)` a `fetch` para que una llamada se interrumpa si su petición agota el tiempo de espera.

Tu tráfico saliente utiliza una dirección IP compartida, no una exclusiva por proyecto. Si dicha dirección es fija y se encuentra documentada para servicios que requieren una lista de permitidos (allowlist) es algo **sin definir**.

## Inicio y apagado

- **Inicio en frío (cold start).** Una nueva instancia descarga el bundle e instala sus dependencias antes de empezar a servir peticiones. Esa instalación constituye la mayor parte de un inicio en frío, el cual suele demorar entre 40 y 60 segundos. La plataforma espera hasta 300 segundos a que una instancia esté disponible. Un árbol de dependencias extenso ralentizará cada despliegue y cada escalado hacia arriba.
- **Comprobación de salud (health check).** La plataforma verifica `/livez` (el proceso está ejecutándose) y `/health` (puede conectarse a la base de datos). Ambas rutas son servidas automáticamente por el runtime, por lo que no necesitas implementarlas.
- **Apagado.** Durante un despliegue o reinicio, la instancia deja de aceptar nuevas peticiones, espera 5 segundos para que el tráfico se redirija y luego recibe una señal `SIGTERM`. Las peticiones en curso disponen de hasta 15 segundos para completarse. Las promesas pasadas a `waitUntil` obtienen hasta 5 segundos de ese periodo. Cualquier promesa que no hayas delegado a `waitUntil` será descartada. Consulta [Trabajo en segundo plano](/docs/backend/custom-functions/#background-work).

## Cuándo el runtime administrado no es la opción adecuada

Migra el backend a `"runtime": "custom"` cuando requiera:

- un módulo nativo o un binario del sistema, como `sharp`, `ffmpeg` o un motor local de síntesis de voz;
- paquetes a nivel de sistema operativo o una imagen base diferente;
- una conexión persistente hacia servicios fuera de los puertos permitidos.

Un runtime personalizado compila tu propio Dockerfile, y a partir de ese momento la imagen pasa a ser de tu total gestión. `rebase cloud deploy --eject` realiza la transición. Consulta [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Sin definir aún

Estas cuestiones aún no cuentan con una respuesta definitiva en el código de la plataforma. Realiza las consultas pertinentes antes de depender de alguna de ellas.

- **WebAssembly.** No está bloqueado, pero no ha sido probado ni garantizado formalmente.
- **Ejecución de un binario incluido dentro de un paquete npm.** No está bloqueado, pero tampoco está soportado.
- **Valores por defecto de CPU y memoria.** El valor por defecto documentado (`250m`, `512Mi`) y el valor por defecto actual de la plataforma (una solicitud menor, con ráfaga hasta 2 CPU y 2 GiB) no coinciden. `rebase cloud compute` muestra los valores reales asignados a tu proyecto.
- **Escalado a cero.** El parámetro `--scale-to-zero` es aceptado. No se ha confirmado si actualmente altera el comportamiento de ejecución del proyecto.
- **Peticiones de más de 60 segundos.** El tiempo de espera de las funciones puede aumentarse, pero el edge situado al frente podría cerrar la conexión según su propio valor predeterminado.
- **Una dirección IP saliente fija** que pueda utilizarse para listas de permitidos en servicios de terceros.
- **Un origen de navegador que no sea uno de los dominios del proyecto**, como un frontend alojado en otro proveedor. `CORS_ORIGINS` de la plataforma tiene prioridad sobre el tuyo.
- **Registros npm privados.** El proceso de instalación de dependencias no lee tokens ni archivos `.npmrc`, por lo que los paquetes privados no parecen poder instalarse.
- **Retención de logs.** `rebase cloud logs --runtime` muestra la salida reciente; el tiempo durante el cual se conservan los logs no está documentado.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculación, despliegue, parámetros de cómputo y qué aspectos no incluye la beta
- [Funciones personalizadas](/docs/backend/custom-functions/): escritura de rutas en `backend/functions/`
- [Runtime y Bundles](/docs/architecture/runtime-and-bundles/): qué es un bundle y cómo lo arranca el runtime
- [Almacenamiento](/docs/backend/storage/): buckets, endpoints, límites de tamaño y reglas de acceso
- [Ejecución de más de una instancia](/docs/deployment/multiple-instances/): el estado que Rebase conserva por proceso
