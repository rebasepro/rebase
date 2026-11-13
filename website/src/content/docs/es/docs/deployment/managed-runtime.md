---
sourceHash: 9e1445cbb512338c
title: Runtime de backend administrado
sidebar_label: Runtime administrado
description: Lo que un backend con el runtime "managed" puede y no puede hacer en Rebase Cloud — paquetes y binarios, memoria y CPU, tiempos de espera y tamaños del cuerpo, el sistema de archivos, estado en memoria, secretos, almacenamiento para archivos generados y red de salida.
---

Una aplicación de backend declarada de esta forma en `rebase.json` se ejecuta en el **runtime administrado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Administrado significa que envías un bundle, no una imagen. `rebase cloud deploy` compila tus
tablas, `backend/functions/` y crons en `dist-bundle`, lo sube y
Rebase Cloud lo arranca en la imagen publicada `rebasepro/server`. Nunca escribes
un Dockerfile y tampoco puedes cambiar lo que hay dentro de la imagen. Esta página enumera
lo que esto permite, para que puedas planificar una funcionalidad antes de construirla.

Los números que aparecen aquí proceden del runtime y de la plataforma tal y como son hoy. Algunos
son parámetros que puedes cambiar, y la página indica cuáles. Las pocas cosas que
aún no están prometidas se recopilan [al final](#aún-no-prometido).

## De un vistazo

| Pregunta | Respuesta |
|---|---|
| Versión de Node | Node 22, en Debian slim, `linux`/`x64` |
| Paquetes npm | Sí, desde el registro público o uno privado. Se instalan en el bundle cuando despliegas |
| Módulos nativos (`.node`, node-gyp) | No. `rebase cloud deploy` rechaza el bundle |
| WebAssembly | Sí |
| Generar un proceso secundario | Sí, para un binario `linux`/`x64` que incluya un paquete npm. Consulta [Binarios](#binarios-y-procesos-secundarios) |
| Memoria y CPU | Se configuran por proyecto con `rebase cloud compute`. Consulta [Cómputo](#cómputo-e-instancias) |
| Instancias | 1 por defecto, siempre activa. Puedes fijar hasta 5, o dejar que el escalador automático suba hasta 16 |
| Tiempo de espera de la función | 30 segundos, luego `504 FUNCTION_TIMEOUT`. Configurable hasta 10 minutos |
| Cuerpo de la solicitud | 10 MiB, luego `413`. Configurable, hasta los 64 MiB que acepta el edge |
| Sistema de archivos con escritura | Sí, pero es temporal y pertenece a una sola instancia |
| Estado a nivel de módulo (una caché `Map`) | Sobrevive entre solicitudes en una misma instancia. Se pierde en cada despliegue y reinicio, y no se comparte entre instancias |
| Variables de entorno y secretos | `rebase cloud env set`, aplicados en el siguiente despliegue |
| Almacenamiento de archivos | Un bucket por proyecto, servido por tu backend en `/api/storage/file/…` |
| HTTP de salida | Sí, en los puertos 80 y 443 (y 465, 587, 993 para correo). Los demás puertos están bloqueados. Una IP de salida fija: `207.175.138.15` |

## Código y paquetes

**Node y la imagen.** La imagen del runtime está basada en `node:22-slim`
(Debian), y tu bundle se ejecuta en `linux`/`x64` como un usuario sin privilegios de root. Tu
`tsconfig` y la versión de Node en tu máquina local no alteran esto.

**Dependencias.** `rebase cloud deploy` instala las dependencias declaradas en tus
archivos `package.json` dentro del bundle, para `linux`/`x64`, y las sube
junto con él, de modo que una nueva instancia no tenga nada que instalar. Un bundle que
superaría el límite de subida de 1 GB al incluirlas se sube sin ellas, y el despliegue
lo advierte: cada instancia las instala al iniciarse con `npm ci` (o
`npm install` si no hay un lockfile). Cuatro implicaciones se derivan de su forma de instalación:

- **Los scripts de instalación nunca se ejecutan.** La instalación utiliza `--ignore-scripts`. Un paquete
  que descargue un binario o compile algo en `postinstall` se instalará sin
  él.
- **Solo se instalan versiones de registros.** Una dependencia de tipo `file:`, `link:`, `git+…` o `github:`
  hará fallar la compilación, porque el runtime no tiene nada con qué resolverla.
- **Algunos paquetes provienen de la imagen, no de ti.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` y `zod` se eliminan de las
  dependencias del bundle y se vinculan las copias propias de la imagen, por lo que tu
  versión de ellos no se aplica. Otros paquetes `@rebasepro/*`, como el
  controlador de la base de datos, se instalan desde tu `package.json` como cualquier dependencia.
  `typescript` y `tsx` también se eliminan; son herramientas de compilación.
- **Los paquetes privados necesitan un `.npmrc`.** `rebase build` copia el archivo `.npmrc`
  del proyecto (y `backend/.npmrc`) dentro del bundle, de modo que la instalación utilice la misma
  configuración de registros que tu máquina local. Cada credencial dentro de él debe ser una
  referencia de entorno, nunca el token en sí; un token literal hará fallar
  la compilación, ya que el bundle se sube con tu código:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

La subida del bundle tiene un límite máximo de 1 GB, comprimido.

**Los módulos nativos son rechazados.** Un paquete que incluya un binario `.node` compilado
no se puede cargar en el runtime administrado. `rebase build` emite una advertencia, y
`rebase cloud deploy` se detiene antes de subir:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La verificación busca paquetes nativos conocidos (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
archivos `binding.gyp` o `gypfile`, scripts de instalación que llamen a `node-gyp` o
`prebuild`, y archivos `.node`. La
[guía de despliegue](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
enumera las alternativas habituales. La versión corta: realiza el trabajo en tiempo de compilación,
llama a un servicio externo o despliega con `runtime: "custom"`.

**WebAssembly funciona.** Un paquete que distribuya un archivo `.wasm` y lo cargue desde
JavaScript no es un módulo nativo, y Node 22 lo ejecuta. Verificado en la
imagen base del runtime con la configuración de seguridad del pod, utilizando `esbuild-wasm`.
Ten en cuenta el [límite de memoria](#cómputo-e-instancias) si el módulo es grande,
como un modelo de voz o de machine learning.

### Binarios y procesos secundarios

`child_process` funciona. La imagen en sí tiene muy pocas herramientas para ejecutar: `node`, `npm`,
`sh`, `tar`, y las herramientas de cliente de PostgreSQL (`pg_dump`, `pg_restore`). No hay
`ffmpeg`, no hay ImageMagick, no hay Python ni compiladores, y no puedes añadir
paquetes del sistema, ya que no hay un Dockerfile y el proceso no se ejecuta como root.

Un binario que un paquete npm transporte **dentro de su propio tarball** se instala con
el paquete y se ejecuta. Debe estar compilado para `linux`/`x64` contra glibc
(Debian), y se ejecuta como un usuario sin privilegios y sin capacidades de Linux (capabilities).
Verificado con `@esbuild/linux-x64` en la imagen base del runtime. Un binario que un
paquete *descarga* en `postinstall` nunca llega a existir, porque los scripts de instalación no
se ejecutan; paquetes como `ffmpeg-static` funcionan de esa manera.

Si una funcionalidad necesita un binario, utiliza una API externa para esa tarea, o mueve el
backend a `runtime: "custom"`, donde compilas tu propia imagen.

## Cómputo e instancias

Cada proyecto se ejecuta en sus propios pods. La memoria y la CPU se asignan por instancia, y las
defines mediante los [ajustes de cómputo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un proyecto que nunca haya configurado un parámetro se ejecuta como un pod burstable: reserva `100m` de CPU
y `384Mi` de memoria, y puede alcanzar ráfagas de hasta 2 CPU y 2 GiB. Una solicitud ajustada mantiene
esa proporción entre reserva (request) y límite (limit). Ejecuta `rebase cloud compute` para ver lo que
tiene asignado tu proyecto.

Instancias:

- **Una por defecto, siempre en ejecución.** `--replicas` fija entre 1 y 5.
  Nada escala un backend a cero.
- **El autoescalado es opcional.** `--autoscale-max` establece un techo de hasta 16, y
  `--autoscale-cpu-target` (por defecto 70) define el uso de CPU al que apunta el escalador automático.
- **Los despliegues son progresivos (rolling).** Una nueva instancia se inicia y pasa a estar lista antes de que la
  antigua se detenga, por lo que durante un breve periodo de tiempo dos versiones atienden tráfico simultáneamente.

`--spot` está desactivado por defecto; las instancias spot son más económicas y pueden reiniciarse sin
previo aviso.

## Memoria y estado a nivel de módulo

Un valor a nivel de módulo, como `const cache = new Map()` en la parte superior de un archivo
de funciones, reside en el proceso de Node. Sobrevive de una solicitud a la siguiente dentro
de la misma instancia. Se pierde cada vez que ese proceso termina:

- en **cada despliegue**, ya que cada despliegue inicia nuevas instancias;
- cuando una **variable de entorno** cambia y se despliega;
- cuando una instancia se reinicia, se reprograma o (con `--spot`) es revocada.

Al tener más de una instancia, cada una tiene su propia copia, por lo que dos solicitudes pueden ver
cachés diferentes.

Utiliza un `Map` a nivel de módulo como una caché que puedas permitirte perder: una que haga que la
siguiente solicitud sea más rápida pero que no sea la única copia de nada. Guarda cualquier cosa que
haya tenido un costo generar, como audio generado o una respuesta costosa de una API, en la
base de datos o en el [almacenamiento](#almacenamiento-para-archivos-generados). Para clientes que se inicializan
una sola vez, como el SDK de una API, utiliza `lazyResource` para que el cliente se construya en el primer
uso a partir del entorno de la solicitud. Consulta
[Configuración y Secretos](/docs/backend/custom-functions/#configuration-and-secrets).

[Ejecución de más de una instancia](/docs/deployment/multiple-instances/) detalla
el estado que el propio Rebase mantiene por proceso, como contadores de límites de tasa (rate limit) y
canales de tiempo real.

## El sistema de archivos

El sistema de archivos del contenedor admite escritura, y `/tmp` funciona. Sin embargo, todo lo
que se escriba allí:

- pertenece a una sola instancia, y las demás instancias no lo ven;
- se elimina cuando la instancia se detiene, es decir, a más tardar en el siguiente despliegue;
- comparte un límite de almacenamiento efímero de 6 GiB con el bundle y sus `node_modules`
  instalados. Una instancia que sobrepase ese límite es desalojada (evicted).

Úsalo para archivos temporales de trabajo durante una sola solicitud. No lo utilices como una caché entre
despliegues ni como almacenamiento para subidas de archivos. Esa es también la razón por la que
[`STORAGE_TYPE=local` está desactivado en producción](/docs/backend/storage/#environment-variables).

## Solicitudes

| Límite | Por defecto | Modifícalo con |
|---|---|---|
| Tiempo de espera de la función | 30 s, luego `504` con código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo desactiva) |
| Espera en tu instancia, en el edge | 10 minutos entre lecturas o escrituras | Fijo |
| Cuerpo de la solicitud, rutas `/api/*` sin un límite propio | 10 MiB, luego `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en bytes |
| Cuerpo de la solicitud en el edge | 64 MiB | Fijo |
| Un archivo a través de `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Llamadas anónimas a `/api/functions/*` | 3000 por IP cada 15 minutos | `rateLimit.anonymousFunctions` |

Algunos detalles:

- **El tiempo de espera libera al cliente que llama, no el trabajo en curso.** A los 30 segundos el cliente recibe
  un `504`, y `getSignal(c)` es abortado. Pasa esa señal a `fetch` y a
  cualquier otra operación que acepte una, para que el trabajo también se detenga. Consulta
  [Tiempos de espera y límites de tasa](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **El edge espera más tiempo que el runtime.** El ingress situado frente a tus
  instancias espera hasta 10 minutos, por lo que el límite con el que choca una solicitud es el del runtime,
  que responde con JSON y aborta la señal. Aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`
  hasta ese valor. Para tareas que tarden más, o que deban sobrevivir a un despliegue (una
  instancia dispone de 15 segundos de vaciado/drain), responde de inmediato y realiza el trabajo en un
  [trabajo en segundo plano (job)](/docs/backend/jobs/).
- **Las subidas de más de 64 MiB** requieren la subida reanudable (TUS), que envía
  el archivo en fragmentos. `client.storage.putObject()` cambia automáticamente a este modo
  por encima de 8 MiB.
- **Tamaño de respuesta.** Ni el runtime ni el edge imponen un límite en el tamaño de la
  respuesta. Una respuesta grande seguirá reteniéndose en memoria si tu manejador la genera de
  una sola pieza, así que envíala en streaming o sírvela desde el almacenamiento.

## Variables de entorno y secretos

Defínelos mediante la CLI o en la consola. No existe un campo para ellos en
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Un cambio se aplica en el siguiente despliegue.** Las instancias en ejecución conservan los valores
  con los que se iniciaron. `set` y `unset` te lo recuerdan
  (`Pending redeploy`).
- **Límites:** hasta 100 variables por proyecto, 32 KiB por valor y 256 KiB en
  total. Los nombres deben coincidir con el patrón `[A-Za-z_][A-Za-z0-9_]*`.
- **Algunos nombres están reservados.** La plataforma define `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` y `NODE_ENV` por su cuenta, y fija cómo se ejecuta
  el proceso (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Cualquier intento de asignar uno de ellos es
  rechazado, y el error los enumera todos.
- **`CORS_ORIGINS` parte de tus dominios.** La plataforma lo configura con el
  host del proyecto y sus [dominios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados.
  Cualquier `CORS_ORIGINS` que definas se añadirá a esa lista, para un frontend servido desde
  otra ubicación: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Las variables de almacenamiento son valores por defecto.** La plataforma escribe las variables `STORAGE_*`
  y `S3_*` para su bucket, y cualquier valor que configures prevalece sobre ellos.
- **Los nombres de tiempo de compilación son rechazados.** Las variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` y
  `REACT_APP_` son para frontends en tiempo de compilación, y el backend
  nunca las recibe a tiempo. Con `--force` se almacena una de todos modos.

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

Una lectura de `process.env` en el ámbito de módulo que devuelva un valor vacío provocará que todo el archivo
falle al cargarse, y sus rutas responderán con `404`. Consulta
[Configuración y Secretos](/docs/backend/custom-functions/#configuration-and-secrets).

## Almacenamiento para archivos generados

Un proyecto de Cloud obtiene almacenamiento de archivos una vez que lo creas:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

O apunta el proyecto a un bucket que ya poseas mediante
`rebase cloud storage attach` (S3, R2, MinIO o cualquier bucket compatible con S3).
Sin ninguno de los dos, las subidas responderán con `501 STORAGE_NOT_CONFIGURED`. Se pueden declarar
más buckets en `backend/resources.ts`; consulta
[Varios Buckets](/docs/backend/storage/#several-buckets).

Un despliegue con almacenamiento se rechaza hasta que el proyecto defina quién puede leer y escribir
archivos. El archivo `backend/storage.ts` del scaffold exporta un hook `storageAuthorize` para
este propósito. Consulta [Autorización por objeto](/docs/backend/storage-authorization/).

**Cómo se sirven los archivos.** Tu backend sirve cada archivo en
`GET /api/storage/file/<key>`. Lee el objeto desde el bucket y lo envía en
streaming, con `Content-Type`, soporte para solicitudes por rango (range requests) y cabeceras de caché. No existe una
URL directa del bucket para exponer al exterior.

- Una clave bajo **`public/`** se sirve a cualquier persona, sin necesidad de token, en una URL
  que nunca cambia. Úsala para archivos que cualquier visitante pueda cargar, como audio
  generado para un juego público.
- Cualquier otra clave es privada. Un cliente solicita a `/api/storage/metadata/<key>` una
  URL de descarga que contiene un token, válido por 300 segundos por defecto
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, configurable hasta una semana).

Desde una función, escribe con `rebase.storage` (el bucket por defecto) o
`rebase.bucket(…)` (uno con nombre específico). Tu hook `storageAuthorize` seguirá decidiendo
si la escritura está permitida.

Las transformaciones de imágenes (`?width=`, `?format=`) requieren `sharp`, que es un módulo nativo
y no está incluido en la imagen administrada. En el runtime administrado, una solicitud de transformación
recibe la imagen original.

### Ejemplo: almacenar en caché audio generado

Una función que convierte texto a voz con una API externa, almacena cada resultado
una vez y lo sirve desde el almacenamiento en adelante. El `Map` solo ahorra una
consulta de almacenamiento en una instancia caliente (warm); el bucket es la caché real, por lo que un despliegue no
pierde nada.

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

La ruta es pública, como cualquier ruta en `backend/functions/` hasta que la
protejas. Una implementación real verificaría quién puede crear nuevo audio, de modo que un tercero
no pueda agotar tu presupuesto de la API de voz.

## Red de salida

Las funciones pueden llamar a servicios externos. Las conexiones salientes desde tus instancias
están permitidas hacia cualquier dirección de internet únicamente en estos puertos TCP:

| Puerto | Para |
|---|---|
| 80, 443 | HTTP y HTTPS |
| 465, 587 | Envío de correo mediante SMTP con TLS o STARTTLS |
| 993 | IMAP sobre TLS |

Todo lo demás está bloqueado. Eso incluye el puerto 25, IMAP sin cifrar y bases de datos o
cachés en sus propios puertos: no se puede acceder a Redis en el 6379 ni a MongoDB en el 27017 fuera de Rebase
Cloud. La dirección de metadatos de la nube (`169.254.169.254`) también
está bloqueada.

La única excepción es tu propia base de datos. Si el proyecto aporta su propio
PostgreSQL (BYODB), cada despliegue también permite conexiones al host de esa base de
datos en el puerto indicado en su cadena de conexión, y a nada más en ese puerto.
El host se resuelve a sus direcciones IP cuando despliegas, por lo que si tu proveedor
mueve la base de datos a otra dirección, deberás desplegar de nuevo. La base de datos debe aceptar
conexiones desde internet: la aplicación se conecta a la cadena de conexión
directamente. Los ajustes de bastion SSH se utilizan únicamente para la prueba de conexión, no
por la aplicación desplegada.

La plataforma no añade ningún proxy ni límites de tasa de salida; los servicios a los que llamas
tienen los suyos propios. Pasa `getSignal(c)` a `fetch` para que una llamada se detenga cuando su solicitud
se agote por tiempo de espera.

Todo el tráfico saliente parte de **una dirección IP fija: `207.175.138.15`**.
Añádela a la lista de permitidos (allowlist) de terceros cuando un servicio la requiera. La dirección es
compartida por todos los proyectos en Rebase Cloud, por lo que una lista de permitidos demuestra que la llamada proviene
de Rebase Cloud, no que pertenezca a tu proyecto: asegúrate de seguir autenticándote ante el
servicio con una clave también.

## Inicio y apagado

- **Inicio en frío (cold start).** Una nueva instancia descarga y desempaqueta el bundle antes de
  empezar a servir tráfico, por lo que un árbol de dependencias grande hace que cada escalado sea más lento. Un bundle
  subido sin sus dependencias también las instala, lo que añade de 40 a 60
  segundos. La plataforma espera hasta 300 segundos a que una instancia esté lista.
- **Estado de salud (health checks).** La plataforma comprueba `/livez` (el proceso está en ejecución) y
  `/health` (puede comunicarse con la base de datos). Ambos son servidos por el runtime, por lo que no es
  necesario que los implementes.
- **Apagado.** Durante un despliegue o reinicio, la instancia deja de aceptar nuevas solicitudes,
  espera 5 segundos a que el tráfico se desvíe y luego recibe `SIGTERM`. Las solicitudes en
  curso tienen hasta 15 segundos para completarse. Las promesas pasadas a `waitUntil` reciben hasta
  5 segundos de ese margen. Una promesa que no hayas entregado a `waitUntil` se descarta.
  Consulta [Trabajo en segundo plano](/docs/backend/custom-functions/#background-work).

## Cuándo el runtime administrado no es la opción adecuada

Mueve el backend a `"runtime": "custom"` cuando necesite:

- un módulo nativo, o un binario del sistema que ningún paquete npm distribuya, como `sharp`,
  ImageMagick o un motor de voz local;
- paquetes del sistema o una imagen base diferente;
- una conexión de larga duración a algo fuera de los puertos permitidos.

Un runtime personalizado compila tu propio Dockerfile, y tú pasas a ser el propietario de la imagen a partir
de ese momento. `rebase cloud deploy --eject` realiza la transición. Consulta
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Aún no prometido

- **Historial de registros (logs).** `rebase cloud logs --runtime` lee desde las instancias que
  están en ejecución, y `rebase cloud debug logs --previous` desde la última ejecución de
  una que se haya reiniciado. La salida de una instancia que haya sido reemplazada por un despliegue desaparece. Escribe
  cualquier dato que necesites conservar en la base de datos o en un servicio de logs externo.
- **El escalado a cero** no está disponible. Cada backend mantiene al menos una instancia en ejecución en
  todo momento.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculación, despliegues, los parámetros de
  cómputo y lo que la beta no incluye
- [Funciones personalizadas](/docs/backend/custom-functions/): redacción de rutas en
  `backend/functions/`
- [Runtime y bundles](/docs/architecture/runtime-and-bundles/): qué es un bundle
  y cómo lo arranca el runtime
- [Almacenamiento](/docs/backend/storage/): buckets, endpoints, límites de tamaño y reglas
  de acceso
- [Ejecución de más de una instancia](/docs/deployment/multiple-instances/): el
  estado que Rebase mantiene por proceso
