---
sourceHash: 3f40bdbdc8b0c722
title: Runtime de backend administrado
sidebar_label: Runtime administrado
description: Qué puede y qué no puede hacer un backend con runtime "managed" en Rebase Cloud — paquetes y binarios, memoria y CPU, tiempos de espera y tamaños del cuerpo de la petición, el sistema de archivos, el estado en memoria, secretos, almacenamiento para archivos generados y red saliente.
---

Una aplicación de backend declarada de esta forma en `rebase.json` se ejecuta en el **runtime administrado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Administrado significa que envías un bundle, no una imagen. `rebase cloud deploy` compila tus tablas, `backend/functions/` y crons en `dist-bundle`, lo sube, y Rebase Cloud lo arranca en la imagen publicada `rebasepro/server`. Nunca escribes un Dockerfile y tampoco puedes cambiar lo que hay en la imagen. Esta página enumera lo que esto permite, para que puedas planificar una funcionalidad antes de construirla.

Los números mostrados aquí provienen del runtime y de la plataforma tal como son hoy en día. Algunos son parámetros que puedes cambiar, y la página indica cuáles. Las pocas cosas que aún no están garantizadas se recopilan [al final](#aún-no-garantizado).

## De un vistazo

| Pregunta | Respuesta |
|---|---|
| Versión de Node | Node 22, en Debian slim, `linux`/`x64` |
| Paquetes de npm | Sí, desde el registro público o uno privado. Se instalan en el bundle cuando realizas el despliegue |
| Módulos nativos (`.node`, node-gyp) | No. `rebase cloud deploy` rechaza el bundle |
| WebAssembly | Sí |
| Generar un proceso secundario (child process) | Sí, para un binario `linux`/`x64` que incluya un paquete npm. Consulta [Binarios](#binarios-y-procesos-secundarios) |
| Memoria y CPU | Se configura por proyecto con `rebase cloud compute`. Consulta [Cómputo](#cómputo-e-instancias) |
| Instancias | 1 por defecto, siempre activa. Puedes fijar hasta 5, o dejar que el escalador automático llegue hasta 16 |
| Tiempo de espera (timeout) de función | 30 segundos, luego `504 FUNCTION_TIMEOUT`. Configurable hasta 10 minutos |
| Cuerpo de la petición (request body) | 10 MiB, luego `413`. Configurable, hasta los 64 MiB que acepta el edge |
| Sistema de archivos con permisos de escritura | Sí, pero es temporal y pertenece a una sola instancia |
| Estado a nivel de módulo (una caché `Map`) | Sobrevive entre peticiones en una misma instancia. Se pierde en cada despliegue y reinicio, y no se comparte entre instancias |
| Variables de entorno y secretos | `rebase cloud env set`, aplicados en el siguiente despliegue |
| Almacenamiento de archivos | Un bucket por proyecto, servido por tu backend en `/api/storage/file/…` |
| HTTP saliente | Sí, en los puertos 80 y 443 (y 465, 587, 993 para correo). Los demás puertos están bloqueados. Una IP saliente fija: `207.175.138.15` |

## Código y paquetes

**Node y la imagen.** La imagen del runtime está basada en `node:22-slim` (Debian), y tu bundle se ejecuta en `linux`/`x64` como un usuario sin privilegios de root. Tu `tsconfig` y la versión de Node de tu máquina no cambian esto.

**Dependencias.** `rebase cloud deploy` instala en el bundle las dependencias declaradas en tus archivos `package.json`, para `linux`/`x64`, y las sube con él, de modo que una nueva instancia no tenga nada que instalar. Un bundle que superaría el límite de subida de 1 GB con ellas se sube sin ellas, y el despliegue lo indica: cada instancia las instala al iniciarse, con `npm ci` (o `npm install` si no hay lockfile). De su forma de instalación se derivan cuatro aspectos:

- **Los scripts de instalación nunca se ejecutan.** La instalación utiliza `--ignore-scripts`. Un paquete que descargue un binario o compile algo en `postinstall` se instala sin ello.
- **Solo se instalan versiones del registro.** Una dependencia `file:`, `link:`, `git+…` o `github:` hace que la compilación falle, ya que el runtime no tiene contra qué resolverla.
- **Algunos paquetes provienen de la imagen, no de ti.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` y `zod` se eliminan de las dependencias del bundle y se vinculan las copias propias de la imagen, por lo que tu versión de los mismos no se aplica. Otros paquetes `@rebasepro/*`, como el controlador de la base de datos, se instalan desde tu `package.json` como cualquier dependencia. `typescript` y `tsx` también se eliminan; son herramientas de compilación.
- **Los paquetes privados necesitan un `.npmrc`.** `rebase build` copia el archivo `.npmrc` del proyecto (y `backend/.npmrc`) en el bundle, para que la instalación use la misma configuración de registros que tu máquina. Cada credencial dentro de él debe ser una referencia a una variable de entorno, nunca el token en sí; un token literal provocará un fallo en la compilación, ya que el bundle se sube con tu código:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

La subida del bundle tiene un límite de 1 GB, comprimido.

**Se rechazan los módulos nativos.** Un paquete que incluya un binario compilado `.node` no se puede cargar en el runtime administrado. `rebase build` advertirá sobre ello y `rebase cloud deploy` se detendrá antes de subirlo:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La verificación busca paquetes nativos conocidos (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la presencia de `binding.gyp` o `gypfile`, scripts de instalación que llamen a `node-gyp` o `prebuild`, y archivos `.node`. La [guía de despliegue](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) enumera las soluciones habituales. La versión corta: realiza el trabajo en tiempo de compilación, llama a un servicio externo o despliega con `runtime: "custom"`.

**WebAssembly funciona.** Un paquete que incluye un archivo `.wasm` y lo carga desde JavaScript no se considera un módulo nativo, y Node 22 lo ejecuta. Verificado en la imagen base del runtime con la configuración de seguridad del pod, utilizando `esbuild-wasm`. Ten en cuenta el [límite de memoria](#cómputo-e-instancias) si el módulo es grande, como un modelo de voz o de machine learning.

### Binarios y procesos secundarios

`child_process` funciona. La imagen en sí tiene muy pocas herramientas para ejecutar: `node`, `npm`, `sh`, `tar` y las herramientas cliente de PostgreSQL (`pg_dump`, `pg_restore`). No hay `ffmpeg`, ni ImageMagick, ni Python ni compiladores, y no puedes agregar paquetes del sistema porque no hay un Dockerfile y el proceso no se ejecuta como root.

Un binario que un paquete de npm incluya **dentro de su propio tarball** se instala con el paquete y se ejecuta. Debe estar compilado para `linux`/`x64` contra glibc (Debian), y se ejecuta como un usuario sin privilegios y sin capacidades (capabilities) de Linux. Verificado con `@esbuild/linux-x64` en la imagen base del runtime. Un binario que un paquete *descarga* en `postinstall` nunca llegará, porque los scripts de instalación no se ejecutan; paquetes como `ffmpeg-static` funcionan de esa manera.

Si una funcionalidad necesita un binario, utiliza una API alojada externamente para ese trabajo o traslada el backend a `runtime: "custom"`, donde podrás construir tu propia imagen.

## Cómputo e instancias

Cada proyecto se ejecuta en sus propios pods. La memoria y la CPU son por instancia y se configuran mediante los [parámetros de cómputo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un proyecto que nunca haya configurado un parámetro se ejecuta como un pod con capacidad de ráfaga (burstable): reserva `100m` de CPU y `384Mi` de memoria, y puede alcanzar ráfagas de hasta 2 CPU y 2 GiB. Una solicitud ajustada mantiene esa proporción entre la reserva (request) y el límite (limit). Ejecuta `rebase cloud compute` para ver la asignación de tu proyecto.

Instancias:

- **Una por defecto, siempre en ejecución.** `--replicas` fija entre 1 y 5. Nada escala un backend a cero.
- **El escalado automático es opcional (opt-in).** `--autoscale-max` define un límite superior de hasta 16, y `--autoscale-cpu-target` (por defecto 70) el uso de CPU que persigue el escalador automático.
- **Los despliegues son progresivos (rolling).** Una nueva instancia se inicia y pasa a estar lista antes de que la anterior se detenga, por lo que durante un breve periodo dos versiones atenderán tráfico.

`--spot` está desactivado por defecto; las instancias spot son más económicas y se reinician sin previo aviso.

## Memoria y estado a nivel de módulo

Un valor a nivel de módulo, como `const cache = new Map()` en la parte superior de un archivo de función, reside en el proceso de Node. Sobrevive de una petición a la siguiente en la misma instancia. Se pierde cada vez que dicho proceso termina:

- en **cada despliegue**, ya que cada despliegue inicia nuevas instancias;
- cuando una **variable de entorno** cambia y se despliega;
- cuando una instancia se reinicia, se reprograma o (con `--spot`) se reclama.

Con más de una instancia, cada una tiene su propia copia, por lo que dos peticiones pueden ver cachés diferentes.

Utiliza un `Map` a nivel de módulo como una caché que puedas permitirte perder: una que haga que la siguiente petición sea más rápida pero que no sea la única copia de nada. Guarda cualquier cosa cuya producción haya costado recursos o dinero, como audio generado o una respuesta costosa de una API, en la base de datos o en el [almacenamiento](#almacenamiento-para-archivos-generados). Para clientes que se instancian una sola vez, como el SDK de una API, utiliza `lazyResource` para que el cliente se construya en el primer uso a partir del entorno de la petición. Consulta [Configuración y secretos](/docs/backend/custom-functions/#configuration-and-secrets).

[Ejecutar más de una instancia](/docs/deployment/multiple-instances/) enumera el estado que el propio Rebase mantiene por proceso, como los contadores de límite de tasa (rate-limit) y los canales en tiempo real.

## El sistema de archivos

El sistema de archivos del contenedor admite escritura, y `/tmp` funciona. Sin embargo, todo lo que se escriba allí:

- pertenece a una sola instancia, y las demás instancias no lo ven;
- se elimina cuando la instancia se detiene, es decir, a más tardar en el siguiente despliegue;
- comparte un límite de almacenamiento efímero de 6 GiB con el bundle y sus `node_modules` instalados. Una instancia que sobrepase este límite será desalojada (evicted).

Utilízalo para archivos temporales durante una petición. No lo utilices como caché entre despliegues ni como almacenamiento para subidas. Esa es también la razón por la que [`STORAGE_TYPE=local` está deshabilitado en producción](/docs/backend/storage/#environment-variables).

## Peticiones

| Límite | Por defecto | Modificarlo con |
|---|---|---|
| Tiempo de espera de función | 30 s, luego `504` con código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo desactiva), o en el propio `defineFunction(…, { timeoutMs })` de una función |
| Tiempo de espera propio de una función, como máximo | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Espera en tu instancia, en el edge | 10 minutos entre lecturas o escrituras | Fijo |
| Cuerpo de la petición, rutas `/api/*` sin un límite propio | 10 MiB, luego `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en bytes |
| Cuerpo de la petición en el edge | 64 MiB | Fijo |
| Un archivo a través de `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Llamadas anónimas a `/api/functions/*` | 3000 por IP cada 15 minutos | `rateLimit.anonymousFunctions` |

Algunos detalles:

- **El tiempo de espera libera al cliente que llama, no al trabajo.** A los 30 segundos, quien realiza la llamada recibe un `504` y `getSignal(c)` se aborta. Pasa esa señal a `fetch` y a cualquier otra función que acepte una, para que el trabajo también se detenga. Consulta [Tiempos de espera y límites de tasa](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **El edge espera más tiempo que el runtime.** El ingress situado delante de tus instancias espera hasta 10 minutos, por lo que el límite con el que se topa una petición es el del runtime, que responde con JSON y aborta la señal. Aumenta `REBASE_FUNCTIONS_TIMEOUT_MS` hasta ese valor, o asigna a la función concreta que lo necesite su propio [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits). Para tareas que tomen más tiempo, o que deban sobrevivir a un despliegue (una instancia drena tráfico durante 15 segundos), responde de inmediato y realiza el trabajo en un [job](/docs/backend/jobs/).
- **Las subidas de más de 64 MiB** requieren la subida reanudable (TUS), que envía el archivo por fragmentos. `client.storage.putObject()` cambia automáticamente a este método a partir de los 8 MiB.
- **Tamaño de la respuesta.** Ni el runtime ni el edge imponen un límite al tamaño de la respuesta. Aun así, una respuesta grande se mantiene en memoria si tu manejador la construye de una sola pieza, por lo que conviene transmitirla por streaming o servirla desde el almacenamiento.

## Variables de entorno y secretos

Configúralos con la CLI o en la consola. No hay un campo para ellos en `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Un cambio se aplica en el siguiente despliegue.** Las instancias en ejecución conservan los valores con los que se iniciaron. `set` y `unset` te lo recuerdan (`Pending redeploy`).
- **Límites:** hasta 100 variables por proyecto, 32 KiB por valor y 256 KiB en total. Los nombres siguen el patrón `[A-Za-z_][A-Za-z0-9_]*`.
- **Algunos nombres están reservados.** La plataforma establece `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` y `NODE_ENV` por sí misma, y fija cómo se ejecuta el proceso (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Intentar definir uno de estos será rechazado y el error los enumerará todos.
- **`CORS_ORIGINS` parte de tus dominios.** La plataforma lo establece en el host del proyecto y sus [dominios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados. Un valor de `CORS_ORIGINS` que tú definas se agregará a esa lista, para un frontend servido desde otra parte: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Las variables de almacenamiento son valores por defecto.** La plataforma escribe las variables `STORAGE_*` y `S3_*` para su bucket, y cualquier valor que definas tendrá prioridad.
- **Se rechazan los nombres para tiempo de compilación.** Las variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` y `REACT_APP_` son para frontends en tiempo de compilación, y el backend nunca llega a verlas a tiempo. `--force` almacena una de todos modos.

En una función, léelas dentro del manejador (handler), nunca en la parte superior del archivo:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Una lectura de `process.env` en el ámbito del módulo que resulte vacía hará que todo el archivo falle al cargarse y sus rutas responderán con `404`. Consulta [Configuración y secretos](/docs/backend/custom-functions/#configuration-and-secrets).

## Almacenamiento para archivos generados

Un proyecto de Cloud obtiene almacenamiento de archivos una vez que lo creas:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

O apunta el proyecto a un bucket que ya poseas con `rebase cloud storage attach` (S3, R2, MinIO o cualquier bucket compatible con S3). Sin ninguno de los dos, las subidas responderán con `501 STORAGE_NOT_CONFIGURED`. Se pueden declarar más buckets en `backend/resources.ts`; consulta [Varios buckets](/docs/backend/storage/#several-buckets).

Un despliegue con almacenamiento será rechazado hasta que el proyecto defina quién puede leer y escribir archivos. El archivo `backend/storage.ts` del scaffold exporta un hook `storageAuthorize` para esto. Consulta [Autorización por objeto](/docs/backend/storage-authorization/).

**Cómo se sirven los archivos.** Tu backend sirve cada archivo en `GET /api/storage/file/<key>`. Lee el objeto del bucket y lo transmite por streaming, incluyendo `Content-Type`, soporte para peticiones de rango (range requests) y cabeceras de caché. No existe una URL directa del bucket para compartir.

- Una clave bajo **`public/`** se sirve a cualquier persona, sin token, en una URL que nunca cambia. Utilízala para archivos que cualquier visitante pueda cargar, como audio generado para un juego público.
- Cualquier otra clave es privada. Un cliente solicita a `/api/storage/metadata/<key>` una URL de descarga que contiene un token, válido durante 300 segundos por defecto (`STORAGE_DOWNLOAD_TOKEN_TTL`, hasta una semana).

Desde una función, escribe con `rebase.storage` (el bucket por defecto) o `rebase.bucket(…)` (uno con nombre). Tu hook `storageAuthorize` sigue decidiendo si la escritura está permitida.

Las transformaciones de imágenes (`?width=`, `?format=`) necesitan `sharp`, que es un módulo nativo y no está incluido en la imagen administrada. En el runtime administrado, una petición de transformación recibirá la imagen original.

### Ejemplo: almacenar en caché audio generado

Una función que convierte texto a voz con una API externa, almacena cada resultado una sola vez y lo sirve desde el almacenamiento en adelante. El `Map` solo ahorra una búsqueda en el almacenamiento en una instancia activa (warm); el bucket es la verdadera caché, por lo que un despliegue no pierde nada.

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

La ruta es pública, como cualquier ruta en `backend/functions/` hasta que la protejas. Una implementación real verificaría quién puede crear nuevo audio, de modo que un desconocido no pueda agotar tu presupuesto de la API de voz.

## Red saliente

Las funciones pueden llamar a servicios externos. Las conexiones salientes desde tus instancias están permitidas hacia cualquier dirección de internet únicamente en estos puertos TCP:

| Puerto | Para |
|---|---|
| 80, 443 | HTTP y HTTPS |
| 465, 587 | Envío de correo mediante SMTP con TLS o STARTTLS |
| 993 | IMAP sobre TLS |

Todo lo demás está bloqueado. Esto incluye el puerto 25, IMAP sin cifrar y bases de datos o cachés en sus propios puertos: no se puede acceder a Redis en el 6379 ni a MongoDB en el 27017 fuera de Rebase Cloud. La dirección de metadatos de la nube (`169.254.169.254`) también está bloqueada.

La única excepción es tu propia base de datos. Si el proyecto aporta su propia base de datos PostgreSQL (BYODB), cada despliegue también permite conexiones al host de esa base de datos en el puerto indicado en su cadena de conexión, y a nada más en ese puerto. El host se resuelve a sus direcciones IP al desplegar, por lo que si tu proveedor traslada la base de datos a otra dirección, deberás desplegar de nuevo. La base de datos debe aceptar conexiones desde internet: la aplicación se conecta directamente a la cadena de conexión. La configuración del bastión SSH se utiliza únicamente para la prueba de conexión, no por la aplicación desplegada.

La plataforma no añade ningún proxy ni límite de tasa saliente; los servicios a los que llamas tienen los suyos propios. Pasa `getSignal(c)` a `fetch` para que una llamada se detenga cuando expire el tiempo de espera de su petición.

Todo el tráfico saliente parte de **una dirección IP fija, `207.175.138.15`**. Agrégala a una lista de permitidos (allowlist) de terceros cuando un servicio lo solicite. La dirección es compartida por todos los proyectos en Rebase Cloud, por lo que una lista de permitidos demuestra que el emisor se ejecuta en Rebase Cloud, no que se trate de tu proyecto específico: continúa autenticándote ante el servicio con una clave también.

## Inicio y apagado

- **Arranque en frío (cold start).** Una nueva instancia descarga y desempaqueta el bundle antes de servir tráfico, por lo que un árbol de dependencias grande ralentiza cada escalado. Un bundle subido sin sus dependencias también las instala, lo que añade entre 40 y 60 segundos. La plataforma espera hasta 300 segundos a que una instancia se active.
- **Comprobación de estado (health).** La plataforma comprueba `/livez` (el proceso está en ejecución) y `/health` (puede comunicarse con la base de datos). Ambos endpoints son servidos por el runtime, por lo que no necesitas escribirlos.
- **Apagado (shutdown).** En un despliegue o reinicio, la instancia deja de aceptar nuevas peticiones, espera 5 segundos a que el tráfico se desvíe y luego recibe `SIGTERM`. Las peticiones en curso tienen hasta 15 segundos para completarse. Las promesas pasadas a `waitUntil` disponen de hasta 5 segundos de ese margen. Una promesa que no hayas pasado a `waitUntil` se descartará. Consulta [Trabajo en segundo plano](/docs/backend/custom-functions/#background-work).

## Cuándo el runtime administrado no es el adecuado

Cambia el backend a `"runtime": "custom"` cuando necesite:

- un módulo nativo o un binario del sistema que ningún paquete npm proporcione, como `sharp`, ImageMagick o un motor de voz local;
- paquetes del sistema o una imagen base diferente;
- una conexión de larga duración a algo fuera de los puertos permitidos.

Un runtime personalizado compila tu propio Dockerfile, y tú eres el responsable de la imagen a partir de entonces. `rebase cloud deploy --eject` realiza el cambio. Consulta [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Aún no garantizado

- **Historial de logs.** `rebase cloud logs --runtime` lee de las instancias que están en ejecución, y `rebase cloud debug logs --previous` de la última ejecución de una que se haya reiniciado. La salida de una instancia que haya sido reemplazada por un despliegue se pierde. Escribe cualquier cosa que necesites conservar en la base de datos o en un servicio de logs propio.
- **Escalado a cero.** No se ofrece escalado a cero (scale to zero). Cada backend ejecuta al menos una instancia en todo momento.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculación, despliegue, parámetros de cómputo y lo que la beta no incluye
- [Funciones personalizadas](/docs/backend/custom-functions/): redacción de rutas en `backend/functions/`
- [Runtime y bundles](/docs/architecture/runtime-and-bundles/): qué es un bundle y cómo lo arranca el runtime
- [Almacenamiento](/docs/backend/storage/): buckets, endpoints, límites de tamaño y reglas de acceso
- [Ejecutar más de una instancia](/docs/deployment/multiple-instances/): el estado que Rebase mantiene por proceso
