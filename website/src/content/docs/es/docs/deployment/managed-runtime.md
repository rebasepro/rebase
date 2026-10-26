---
sourceHash: ba40edd634e01a84
title: Runtime de backend administrado
sidebar_label: Runtime administrado
description: Lo que un backend con runtime "managed" puede y no puede hacer en Rebase Cloud — paquetes y binarios, memoria y CPU, tiempos de espera y tamaños de cuerpo, el sistema de archivos, el estado en memoria, secretos, almacenamiento para archivos generados y red de salida.
---

Una aplicación de backend declarada de esta manera en `rebase.json` se ejecuta en el **runtime administrado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Administrado significa que envías un bundle, no una imagen. `rebase cloud deploy` compila tus colecciones, `backend/functions/` y crons en `dist-bundle`, lo sube y Rebase Cloud lo inicia sobre la imagen publicada `rebasepro/server`. Nunca escribes un Dockerfile y tampoco puedes cambiar lo que hay en la imagen. Esta página detalla lo que esto permite, para que puedas planificar una funcionalidad antes de construirla.

Los números aquí provienen del runtime y de la plataforma tal como son hoy. Algunos son parámetros que puedes cambiar, y la página indica cuáles. Las pocas cosas que aún no están garantizadas se recopilan [al final](#aún-no-garantizado).

## De un vistazo

| Pregunta | Respuesta |
|---|---|
| Versión de Node | Node 22, en Debian slim, `linux`/`x64` |
| Paquetes npm | Sí, desde el registro público o uno privado. Se instalan cuando cada instancia inicia |
| Módulos nativos (`.node`, node-gyp) | No. `rebase cloud deploy` rechaza el bundle |
| WebAssembly | Sí |
| Generar un proceso secundario (child process) | Sí, para un binario `linux`/`x64` que incluya un paquete npm. Consulta [Binarios](#binarios-y-procesos-secundarios) |
| Memoria y CPU | Se configuran por proyecto con `rebase cloud compute`. Consulta [Cómputo](#cómputo-e-instancias) |
| Instancias | 1 por defecto, siempre activa. Puedes fijar hasta 5, o dejar que el escalador automático suba hasta 16 |
| Tiempo de espera de funciones | 30 segundos, luego `504 FUNCTION_TIMEOUT`. Configurable hasta 10 minutos |
| Cuerpo de la solicitud | 10 MiB, luego `413`. Configurable, hasta los 64 MiB que acepta el edge |
| Sistema de archivos con permisos de escritura | Sí, pero es temporal y pertenece a una sola instancia |
| Estado a nivel de módulo (una caché `Map`) | Sobrevive entre solicitudes en una misma instancia. Se pierde en cada despliegue y reinicio, y no se comparte entre instancias |
| Variables de entorno y secretos | `rebase cloud env set`, aplicadas en el siguiente despliegue |
| Almacenamiento de archivos | Un bucket por proyecto, servido por tu backend en `/api/storage/file/…` |
| HTTP de salida | Sí, en los puertos 80 y 443 (y 465, 587, 993 para correo). Otros puertos están bloqueados. Sin IP de salida fija |

## Código y paquetes

**Node y la imagen.** La imagen del runtime está construida sobre `node:22-slim` (Debian), y tu bundle se ejecuta en `linux`/`x64` como un usuario no root. Tu `tsconfig` y la versión de Node en tu máquina no cambian esto.

**Dependencias.** El bundle lista las dependencias que declaran tus archivos `package.json`. La subida no incluye `node_modules`. Cada instancia instala las dependencias cuando inicia, con `npm ci` (o `npm install` sin un lockfile). De esto se derivan cuatro cosas:

- **Los scripts de instalación nunca se ejecutan.** La instalación utiliza `--ignore-scripts`. Un paquete que descarga un binario o compila algo en `postinstall` se instala sin ello.
- **Solo se instalan versiones del registro.** Una dependencia `file:`, `link:`, `git+…` o `github:` hace que la compilación falle, porque el runtime no tiene contra qué resolverla.
- **Algunos paquetes provienen de la imagen, no de ti.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` y `zod` se eliminan de las dependencias del bundle y se vinculan las copias propias de la imagen, por lo que tu versión de ellos no aplica. Los demás paquetes `@rebasepro/*`, como el driver de base de datos, se instalan desde tu `package.json` como cualquier dependencia. `typescript` y `tsx` también se eliminan; son herramientas de compilación.
- **Los paquetes privados necesitan un `.npmrc`.** `rebase build` copia el `.npmrc` del proyecto (y `backend/.npmrc`) en el bundle, para que la instalación use la misma configuración de registro que tu máquina. Cada credencial dentro de él debe ser una referencia a una variable de entorno, nunca el token en sí; un token literal hace que la compilación falle, ya que el bundle se sube con tu código:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

La subida del bundle está limitada a 100 MB, comprimido, sin dependencias.

**Los módulos nativos son rechazados.** Un paquete que incluye un binario compilado `.node` no se puede cargar en el runtime administrado. `rebase build` advierte sobre esto, y `rebase cloud deploy` se detiene antes de subirlo:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La verificación busca paquetes nativos conocidos (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la presencia de `binding.gyp` o `gypfile`, scripts de instalación que llamen a `node-gyp` o `prebuild`, y archivos `.node`. La [guía de despliegue](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) enumera las alternativas habituales. La versión corta: realiza el trabajo en tiempo de compilación, llama a un servicio o despliega con `runtime: "custom"`.

**WebAssembly funciona.** Un paquete que incluye un archivo `.wasm` y lo carga desde JavaScript no es un módulo nativo, y Node 22 lo ejecuta. Verificado en la imagen base del runtime con la configuración de seguridad del pod, utilizando `esbuild-wasm`. Recuerda el [límite de memoria](#cómputo-e-instancias) si el módulo es grande, como un modelo de voz o de ML.

### Binarios y procesos secundarios

`child_process` funciona. La imagen en sí tiene muy poco para ejecutar: `node`, `npm`, `sh`, `tar` y las herramientas cliente de PostgreSQL (`pg_dump`, `pg_restore`). No hay `ffmpeg`, ni ImageMagick, ni Python ni compilador, y no puedes añadir paquetes del sistema porque no hay Dockerfile y el proceso no es root.

Un binario que un paquete npm incluye **dentro de su propio tarball** se instala con el paquete y se ejecuta. Debe estar compilado para `linux`/`x64` contra glibc (Debian), y se ejecuta como un usuario sin privilegios y sin capacidades de Linux. Verificado con `@esbuild/linux-x64` en la imagen base del runtime. Un binario que un paquete *descarga* en `postinstall` nunca llega, porque los scripts de instalación no se ejecutan; paquetes como `ffmpeg-static` funcionan de esa manera.

Si una funcionalidad necesita un binario, utiliza una API alojada para ese trabajo o traslada el backend a `runtime: "custom"`, donde compilas tu propia imagen.

## Cómputo e instancias

Cada proyecto se ejecuta en sus propios pods. La memoria y la CPU son por instancia, y las configuras con los [parámetros de cómputo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un proyecto que nunca configuró un parámetro se ejecuta como un pod con capacidad de ráfaga (burstable): reserva `100m` de CPU y `384Mi` de memoria, y puede alcanzar ráfagas de hasta 2 CPU y 2 GiB. Una solicitud configurada mantiene esa proporción entre la reserva y el límite. Ejecuta `rebase cloud compute` para ver qué tiene tu proyecto.

Instancias:

- **Una por defecto, siempre en ejecución.** `--replicas` fija entre 1 y 5. Nada escala un backend a cero.
- **El escalado automático es opcional.** `--autoscale-max` establece un tope de hasta 16, y `--autoscale-cpu-target` (por defecto 70) el uso de CPU al que apunta el escalador automático.
- **Los despliegues son progresivos.** Una nueva instancia se inicia y pasa a estar lista antes de que la anterior se detenga, por lo que durante un breve periodo dos versiones sirven tráfico.

`--spot` está desactivado por defecto; las instancias spot son más económicas y se reinician sin previo aviso.

## Memoria y estado a nivel de módulo

Un valor a nivel de módulo, como `const cache = new Map()` al principio de un archivo de función, vive en el proceso de Node. Sobrevive de una solicitud a la siguiente en la misma instancia. Se pierde cada vez que ese proceso termina:

- en **cada despliegue**, porque cada despliegue inicia nuevas instancias;
- cuando una **variable de entorno** cambia y se despliega;
- cuando una instancia se reinicia, se reprograma o (con `--spot`) es reclamada.

Con más de una instancia, cada una tiene su propia copia, por lo que dos solicitudes pueden ver cachés diferentes.

Utiliza un `Map` a nivel de módulo como una caché que puedas permitirte perder: una que haga que la siguiente solicitud sea más rápida pero que no sea la única copia de nada. Guarda cualquier cosa que haya costado producir, como audio generado o una respuesta costosa de una API, en la base de datos o en el [almacenamiento](#almacenamiento-para-archivos-generados). Para clientes que construyes una sola vez, como el SDK de una API, usa `lazyResource` para que el cliente se construya en su primer uso a partir del entorno de la solicitud. Consulta [Configuración y secretos](/docs/backend/custom-functions/#configuration-and-secrets).

[Ejecutar más de una instancia](/docs/deployment/multiple-instances/) enumera el estado que el propio Rebase mantiene por proceso, como los contadores de límites de tasa y los canales de tiempo real.

## El sistema de archivos

El sistema de archivos del contenedor es de lectura y escritura, y `/tmp` funciona. Pero todo lo que se escribe allí:

- pertenece a una instancia, y las demás instancias no lo ven;
- se elimina cuando la instancia se detiene, a más tardar en el siguiente despliegue;
- comparte un límite de almacenamiento efímero de 6 GiB con el bundle y sus `node_modules` instalados. Una instancia que lo sobrepase es desalojada.

Úsalo para archivos temporales durante una solicitud. No lo uses como caché entre despliegues ni como almacenamiento para subidas. Por esa razón también [`STORAGE_TYPE=local` está desactivado en producción](/docs/backend/storage/#environment-variables).

## Solicitudes

| Límite | Por defecto | Modifícalo con |
|---|---|---|
| Tiempo de espera de funciones | 30 s, luego `504` con código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo desactiva) |
| Espera en tu instancia, en el edge | 10 minutos entre lecturas o escrituras | Fijo |
| Cuerpo de la solicitud, rutas `/api/*` sin un límite propio | 10 MiB, luego `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en bytes |
| Cuerpo de la solicitud en el edge | 64 MiB | Fijo |
| Un archivo mediante `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Llamadas anónimas a `/api/functions/*` | 3000 por IP cada 15 minutos | `rateLimit.anonymousFunctions` |

Algunos detalles:

- **El tiempo de espera libera al emisor, no al trabajo.** A los 30 segundos, el emisor recibe un `504` y `getSignal(c)` se cancela. Pasa esa señal a `fetch` y a cualquier otra función que la acepte, para que el trabajo también se detenga. Consulta [Tiempos de espera y límites de tasa](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **El edge espera más tiempo que el runtime.** El ingress delante de tus instancias espera hasta 10 minutos, por lo que el límite con el que choca una solicitud es el del runtime, que responde en JSON y cancela la señal. Aumenta `REBASE_FUNCTIONS_TIMEOUT_MS` hasta ese valor. Para tareas que tarden más, o que deban sobrevivir a un despliegue (una instancia drena conexiones durante 15 segundos), responde de inmediato y realiza el trabajo en un [job](/docs/backend/jobs/).
- **Las subidas de más de 64 MiB** necesitan la subida reanudable (TUS), que envía el archivo en partes. `client.storage.putObject()` cambia a este método automáticamente a partir de 8 MiB.
- **Tamaño de respuesta.** Ni el runtime ni el edge establecen un límite en el tamaño de respuesta. Aun así, una respuesta grande se mantiene en memoria si tu controlador la construye en una sola pieza, por lo que conviene transmitirla o servirla desde el almacenamiento.

## Variables de entorno y secretos

Configúralas con la CLI o en la consola. No hay ningún campo para ellas en `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Un cambio se aplica en el siguiente despliegue.** Las instancias en ejecución mantienen los valores con los que iniciaron. `set` y `unset` te recuerdan esto (`Pending redeploy`).
- **Límites:** hasta 100 variables por proyecto, 32 KiB por valor y 256 KiB en total. Los nombres siguen el patrón `[A-Za-z_][A-Za-z0-9_]*`.
- **Algunos nombres están reservados.** La plataforma establece por sí misma `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` y `NODE_ENV`, y fija cómo se ejecuta el proceso (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Si intentas configurar uno de ellos, será rechazado y el error los enumerará todos.
- **`CORS_ORIGINS` parte de tus dominios.** La plataforma lo establece con el host del proyecto y sus [dominios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados. Un `CORS_ORIGINS` que configures se añade a esa lista, para un frontend servido desde otro lugar: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Las variables de almacenamiento son valores por defecto.** La plataforma escribe las variables `STORAGE_*` y `S3_*` para su bucket, y cualquier valor que configures tiene prioridad.
- **Los nombres de tiempo de compilación se rechazan.** Las variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` y `REACT_APP_` son para frontends en tiempo de compilación, y el backend nunca las ve a tiempo. `--force` almacena una de todos modos.

En una función, léelas dentro del controlador, nunca al principio del archivo:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Una lectura de `process.env` en el ámbito del módulo que resulte vacía provoca que todo el archivo falle al cargarse y que sus rutas respondan `404`. Consulta [Configuración y secretos](/docs/backend/custom-functions/#configuration-and-secrets).

## Almacenamiento para archivos generados

Un proyecto de Cloud obtiene almacenamiento de archivos una vez que lo creas:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

O apunta el proyecto a un bucket que ya poseas con `rebase cloud storage attach` (S3, R2, MinIO, cualquier bucket compatible con S3). Sin ninguno de los dos, las subidas responderán `501 STORAGE_NOT_CONFIGURED`. Se declaran más buckets en `config/resources.ts`; consulta [Varios buckets](/docs/backend/storage/#several-buckets).

Un despliegue con almacenamiento se rechaza hasta que el proyecto defina quién puede leer y escribir archivos. El archivo `config/storage.ts` del scaffold exporta un hook `storageAuthorize` para esto. Consulta [Autorización por objeto](/docs/backend/storage-authorization/).

**Cómo se sirven los archivos.** Tu backend sirve cada archivo en `GET /api/storage/file/<key>`. Lee el objeto desde el bucket y lo transmite, con `Content-Type`, solicitudes de rango y cabeceras de caché. No hay una URL directa del bucket para compartir.

- Una clave bajo **`public/`** se sirve a cualquiera, sin token, en una URL que nunca cambia. Úsala para archivos que cualquier visitante pueda cargar, como audio generado para un juego público.
- Cualquier otra clave es privada. Un cliente solicita a `/api/storage/metadata/<key>` una URL de descarga que contiene un token, válido por defecto durante 300 segundos (`STORAGE_DOWNLOAD_TOKEN_TTL`, hasta una semana).

Desde una función, escribe con `rebase.storage` (el bucket predeterminado) o `rebase.bucket(…)` (uno con nombre). Tu hook `storageAuthorize` sigue decidiendo si la escritura está permitida.

Las transformaciones de imagen (`?width=`, `?format=`) necesitan `sharp`, que es un módulo nativo y no está en la imagen administrada. En el runtime administrado, una solicitud de transformación recibe la imagen original.

### Ejemplo: almacenar en caché audio generado

Una función que convierte texto a voz con una API alojada, guarda cada resultado una sola vez y lo sirve desde el almacenamiento en adelante. El `Map` solo ahorra una consulta al almacenamiento en una instancia activa; el bucket es la verdadera caché, por lo que un despliegue no pierde nada.

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

La ruta es pública, como cualquier ruta en `backend/functions/` hasta que la protejas. Una real verificaría quién puede crear nuevo audio, de modo que un desconocido no pueda consumir el presupuesto de tu API de voz.

## Red de salida

Las funciones pueden llamar a servicios externos. Las conexiones salientes desde tus instancias solo están permitidas hacia cualquier dirección de internet en estos puertos TCP:

| Puerto | Para |
|---|---|
| 80, 443 | HTTP y HTTPS |
| 465, 587 | Envío de correo mediante SMTP con TLS o STARTTLS |
| 993 | IMAP sobre TLS |

Todo lo demás está bloqueado. Esto incluye el puerto 25, IMAP sin cifrar y bases de datos o cachés en sus propios puertos: no se puede acceder a Redis en el 6379 o MongoDB en el 27017 fuera de Rebase Cloud. La dirección de metadatos de la nube (`169.254.169.254`) también está bloqueada.

La única excepción es tu propia base de datos. Si el proyecto trae su propio PostgreSQL (BYODB), cada despliegue permite además las conexiones al host de esa base de datos en el puerto de su cadena de conexión, y a nada más en ese puerto. El host se resuelve a sus direcciones IP cuando despliegas, así que si tu proveedor mueve la base de datos a otra dirección, vuelve a desplegar. La base de datos debe aceptar conexiones desde internet: la app se conecta directamente a la cadena de conexión. Los ajustes del bastión SSH solo los usa la prueba de conexión, no la app desplegada.

La plataforma no añade ningún proxy ni límite de tasa saliente; los servicios a los que llamas tienen los suyos propios. Pasa `getSignal(c)` a `fetch` para que una llamada se detenga cuando se agote el tiempo de espera de su solicitud.

**No hay una dirección IP de salida fija**. El tráfico sale a través de una dirección compartida por todos los proyectos, asignada por el proveedor de la nube y sujeta a cambios, por lo que no debes añadirla a una lista de permitidos de terceros. En su lugar, autentícate ante dicho servicio con una clave.

## Inicio y apagado

- **Arranque en frío (cold start).** Una nueva instancia descarga el bundle e instala sus dependencias antes de servir tráfico. Esa instalación representa la mayor parte de un arranque en frío, que normalmente tarda de 40 a 60 segundos. La plataforma espera hasta 300 segundos a que una instancia se levante. Un árbol de dependencias grande hace que cada despliegue y cada escalado sea más lento.
- **Salud (health).** La plataforma comprueba `/livez` (el proceso está en ejecución) y `/health` (puede comunicarse con la base de datos). Ambos endpoints son servidos por el runtime, por lo que no necesitas escribirlos.
- **Apagado (shutdown).** En un despliegue o reinicio, la instancia deja de aceptar nuevas solicitudes, espera 5 segundos a que el tráfico se desvíe y luego recibe `SIGTERM`. Las solicitudes en curso tienen hasta 15 segundos para completarse. Las promesas pasadas a `waitUntil` reciben hasta 5 segundos de ese tiempo. Cualquier promesa que no hayas entregado a `waitUntil` se descarta. Consulta [Trabajo en segundo plano](/docs/backend/custom-functions/#background-work).

## Cuándo el modo administrado no es el adecuado

Mueve el backend a `"runtime": "custom"` cuando necesite:

- un módulo nativo o un binario del sistema que ningún paquete npm incluya, como `sharp`, ImageMagick o un motor de voz local;
- paquetes del sistema o una imagen base diferente;
- una conexión de larga duración a algo fuera de los puertos permitidos.

Un runtime personalizado compila tu propio Dockerfile, y a partir de ese momento la imagen es tuya. `rebase cloud deploy --eject` realiza el cambio. Consulta [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Aún no garantizado

- **Historial de registros (logs).** `rebase cloud logs --runtime` lee desde las instancias que están en ejecución, y `rebase cloud debug logs --previous` desde la última ejecución de una que se haya reiniciado. La salida de una instancia reemplazada por un despliegue desaparece. Escribe cualquier información que necesites conservar en la base de datos o en tu propio servicio de logs.
- **Escalado a cero** no está disponible. Cada backend ejecuta al menos una instancia en todo momento.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculación, despliegue, parámetros de cómputo y lo que la versión beta no incluye
- [Funciones personalizadas](/docs/backend/custom-functions/): escribir las rutas en `backend/functions/`
- [Runtime y bundles](/docs/architecture/runtime-and-bundles/): qué es un bundle y cómo lo inicia el runtime
- [Almacenamiento](/docs/backend/storage/): buckets, endpoints, límites de tamaño y reglas de acceso
- [Ejecutar más de una instancia](/docs/deployment/multiple-instances/): el estado que Rebase mantiene por proceso
