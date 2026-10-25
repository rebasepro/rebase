---
sourceHash: 1959160bec263545
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye todavía la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la misma
imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Actualmente ejecuta tenants reales y se habilita
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta a la que se le haya concedido acceso.
Todo lo demás en este sitio funciona sin necesidad de una.
:::

## Qué es

Un **proyecto** en Cloud son tres elementos que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no la compilación de un contenedor |
| **Base de datos** | Un PostgreSQL gestionado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Almacenamiento** | Un bucket propio, en caso de que tu proyecto utilice almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y cada uno se factura por lo que
reserva en lugar de por usuario (seat).

**Nada de tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que arranca en cualquier lugar donde se ejecute la imagen del runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` no recibe argumentos posicionales. El nombre y el subdominio son
flags y ambos son obligatorios: en una terminal se solicitan interactivamente, y una
ejecución no interactiva (headless) que omita cualquiera de los dos finaliza con `input_required` en lugar de
inventar uno. **El subdominio no se puede editar después:** es el host
`<slug>.rebase.website` en el que responde el proyecto, así que elígelo deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un
paso de `link` por separado. Escribe `.rebase/cloud.json`, que registra el id y el
slug del proyecto. Ese archivo no es un secreto ni contiene tus credenciales; estas residen
en `~/.rebase/credentials.json`, generado por `login`.

Sin embargo, se incluye en el control de versiones con el código, por lo que un repositorio clonado puede indicar
cualquier plano de control (control plane). Cuando el host proviene únicamente de ese archivo y no es
ni el propio de la plataforma ni uno en el que hayas iniciado sesión previamente, `login` lo indica y
solicita confirmación antes de enviar tu correo electrónico y contraseña allí. Sin una terminal, o con
`--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí intencionadamente.

`billing setup` vincula una tarjeta a la organización, una sola vez. Se ubica al principio
de la secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una tarjeta asociada,
y descubrirlo después de que un bundle haya terminado de subirse es el peor escenario.

Un proyecto existente se vincula sin necesidad de crear uno nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando, y ningún flag que recordar. El archivo `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo indica
durante el proceso (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la aplicación en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta alcanzar un estado terminal. El código de
salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Termina indicando dónde responde ahora cada aplicación y si la nueva versión está en vivo allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que la dirección respondió después del build: el `/api/health` del backend devolvió `ok` y la página de una aplicación estática cargó (desde este despliegue, cuando la sirve la plataforma). La comprobación espera hasta `--live-timeout` segundos, 60 por defecto; `0` la omite. Si una aplicación no responde a tiempo, el despliegue sale igualmente con código cero, porque el despliegue tuvo éxito, y la última línea dice qué aplicación no respondió y por qué. Un despliegue fallido termina en cambio con una línea que nombra la aplicación y el motivo, con `rebase cloud logs` para el log completo del build.

Los scripts pasan `--json` para obtener un objeto con los mismos datos: `apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de `rebase cloud`, `deploy` no cambia a JSON por sí solo en una tubería.

Lo que permite ese runtime (paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños del cuerpo de la petición, el sistema de archivos, secretos, almacenamiento y red
saliente) se encuentra en su propia página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para enviar un artefacto compilado previamente —por ejemplo, un trabajo de CI que compila
una vez y despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime gestionado requiere su propio flag, `--eject`, y nada más lo
solicita: una compilación que trasladaría un proyecto gestionado a una imagen de contenedor que luego
administre por su cuenta es rechazada hasta que lo indiques explícitamente. `--force` solía significar esto, lo cual
situaba la acción menos reversible que puede realizar la CLI bajo la misma palabra que "sobrescribir este
archivo"; ahora es una opción desconocida en lugar de un alias, por lo que un script que la utilice se
detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una aplicación estática se sirven tal cual. Cuando su `build` solo copia scripts escritos a mano en `output`, nadie los ha analizado, y un archivo con una errata se publica e impide que la página cargue. Por eso, antes de subir nada, `deploy` analiza cada archivo `.js`, `.mjs` y `.cjs` del `output` de cada aplicación estática, junto con cada `<script>` en línea de sus archivos `.html`. Esto cubre tanto una aplicación estática desplegada por separado como las aplicaciones estáticas integradas en el bundle del backend. Un error de sintaxis detiene el despliegue con el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Se omiten los scripts en línea que un navegador no ejecuta como JavaScript: JSON, import maps, plantillas y cualquier otro `type` que no sea JavaScript, un `<script src>` y un script que aún contiene marcado de plantilla sin renderizar, como `{{ }}`. Un archivo `.js` pasa si se puede analizar como script clásico o como módulo, porque eso lo decide la página. No se lee nada dentro de `node_modules`, ni tampoco un `--bundle-dir` ya compilado. `--no-verify` omite la comprobación en un despliegue.

Síguelo:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está operando realmente y consultar periódicamente (polling) es lo correcto; cuando nombra
algo, ese algo te está esperando a ti.

## Previsualizar un cambio

<span class="since-badge" data-since="0.26">Desde 0.26</span>

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo que subiría `deploy`, pero lo sirve en una dirección
propia, como `https://shop--k3x9ab.rebase.website`. La producción sigue sirviendo lo que
servía antes. El despliegue imprime la dirección de la previsualización cuando termina
la compilación.

Para conservar una misma dirección entre despliegues, ponle nombre a la previsualización. Desplegar el mismo nombre
de nuevo la actualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

A qué se conecta una previsualización depende de lo que desplegaste:

- **`rebase cloud deploy web --preview`** previsualiza una aplicación estática. Sus páginas llaman
  al backend de **producción**: un inicio de sesión allí es una sesión real, y todo lo que se
  escriba allí son datos de producción.
- **`rebase cloud deploy --preview`** previsualiza el backend, con sus aplicaciones estáticas
  integradas, igual que las ejecuta la producción. Obtiene un backend propio sobre una
  **base de datos vacía y propia**, nunca la de producción. Arrancar contra la base de datos
  de producción le aplicaría el esquema y las reglas de acceso de la previsualización.

Una previsualización no sube el código fuente ni registra aplicaciones ni hostnames, porque cada
una de esas cosas cambiaría el proyecto de producción. `--source` y `--eject` no se pueden
combinar con `--preview`. Cada uno construye una imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

Una previsualización caduca una semana después de su último despliegue.

Las previsualizaciones se están desplegando de forma gradual. Un plano de control que aún no las sirve rechaza
`--preview` con `previews_unavailable` y no despliega nada.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso
anterior, y nunca recompila: el valor de un rollback reside en que envía un
artefacto que ya se ha ejecutado.

Los despliegues que califican dependen de la forma en que se despliegue el proyecto, y ambos tipos
son válidos:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión del runtime que el proyecto esté ejecutando actualmente |

Las aplicaciones estáticas integradas en el bundle del backend (un `rebase cloud deploy` sin más en un proyecto con backend) forman parte de ese bundle, así que hacen rollback con él.

Una aplicación estática desplegada por separado (`rebase cloud deploy <app>`) todavía no admite rollback. Su despliegue registra qué aplicación publicó, pero no un bundle, así que el plano de control no tiene de dónde restaurarla. La solución es volver a desplegar la última versión buena, por ejemplo desde el commit anterior al defectuoso. Tras un despliegue así, `deploy` lo indica en lugar de remitir a `rollback`.

Por tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que significa un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments` marca los que califican, y `--json` informa de `rollbackable` por fila junto con la `image` o `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál es el caso: uno que no haya sido exitoso
y uno previo al momento en que la plataforma comenzó a registrar artefactos. No hay nada que
asumir en ninguno de los dos casos —suponerlo enviaría lo que se haya compilado o subido más
recientemente mientras se afirma restaurar este—; en su lugar, despliega la versión que desees.

Todo despliegue exitoso termina indicando el camino de vuelta (`rebase cloud rollback`), para que esté a la vista en el momento en que se detecta una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que la versión restaurada empiece a responder antes de reportar éxito. Puedes seguirlo con `rebase cloud logs -f`.

## CI y agentes

Un trabajo de CI o un agente no deberían contener tu contraseña. Proporciónale un
token en su lugar: una clave que actúa en nombre de tu cuenta, limitada a unas pocas acciones en un
proyecto concreto. Créalo desde una terminal con sesión iniciada:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

El token se muestra una sola vez, como una línea `export REBASE_TOKEN=rk_live_…`. Con
`REBASE_TOKEN` definido, cada comando de `rebase cloud` se autentica con él en lugar de
tu inicio de sesión, y nunca lee ni escribe la sesión guardada. En GitHub Actions,
almacénalo como un secreto del repositorio y exponlo bajo ese nombre:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` acepta una o más capacidades (capabilities), separadas por comas o repetidas:

| Capacidad | Lo que el token puede hacer |
|---|---|
| `deploy` | Desplegar el proyecto y seguir sus compilaciones: `deploy`, `deployments` |
| `logs` | Leer registros de compilación y runtime, el historial de cron y métricas en tiempo real: `logs`, `cron`, `metrics` |
| `env` | Leer y modificar variables de entorno, incluidos los secretos |
| `database` | `db list`, `db info` y `db connect`, lo cual incluye la contraseña de la base de datos |
| `backups` | Listar, crear, inspeccionar y descargar copias de seguridad, y leer la ventana de point-in-time |

Internamente, un token es una [clave de API personal](/docs/backend/api-keys/#personal-keys)
en el plano de control. Cada capacidad se traduce en unos pocos
[scopes](/docs/backend/roles-and-scopes/): `deploy` en `shop` posee
`project:deploy:<id>`, con el id del proyecto, además de los scopes de datos y funciones
que llaman los comandos de despliegue. El token nunca tiene más permisos de los que tiene tu cuenta en el momento
en que se utiliza, por lo que pierde cualquier permiso que pierda tu cuenta.

Hay dos acciones que permanecen exclusivamente en manos de una persona con sesión iniciada:

- **Gestionar tokens.** `rebase cloud tokens list`, `create` y `revoke <id>` requieren
  tu sesión de `rebase cloud login`. Un token no puede listar, crear ni revocar
  tokens, ya que un token que pudiera emitir tokens podría generar su propio sucesor.
- **Restaurar.** Ninguna capacidad concede la restauración de copias de seguridad ni un
  `restore` y `cutover` de point-in-time. Sobrescribir una base de datos en producción con datos antiguos
  sigue reservado para un propietario o administrador con sesión iniciada.

`rebase cloud whoami` con un token configurado muestra lo que puede hacer y en qué
proyecto. `rebase cloud tokens revoke <id> --yes` lo revoca de inmediato.

## Un backend sin cuenta

Un agente que ha construido una app puede darle un backend en vivo antes de que nadie se haya registrado, y entregar a la persona para la que trabaja un enlace para quedárselo:

```bash
rebase cloud init --claim
```

Eso aprovisiona un proyecto en Rebase Cloud, define `REBASE_BASE_URL` en `.env` con su dirección en vivo, vincula el directorio y despliega las colecciones locales con `rebase cloud deploy --bundle`. Imprime la URL en vivo, la URL del panel de administración y una **URL de reclamación**. Quien abra la URL de reclamación e inicie sesión puede mover el proyecto a una de sus organizaciones. El enlace funciona una sola vez. Un proyecto que nadie reclama en 72 horas se elimina, base de datos incluida. La herramienta `rebase_cloud_provision` del servidor MCP ejecuta el mismo comando y devuelve las mismas URL.

Hasta que se reclama, el proyecto no pertenece a ninguna cuenta. Su token está limitado a ese proyecto y a `deploy`, `logs`, `env` y `database`. Se guarda en `~/.rebase/credentials.json`, nunca en el repositorio, y los comandos `rebase cloud` del directorio vinculado lo usan por sí solos. Caduca con el proyecto.

Cuando el despliegue ha construido la app, el comando también define `REBASE_API_TOKEN` en `.env`: una clave creada en la propia app, que es lo que el servidor MCP y el SDK le envían. Lee y escribe datos (`data:read`, `data:write`) a través de la seguridad a nivel de fila de la app, como un llamante que no es ni una persona ni un administrador. No tiene ningún permiso del plano de administración y caduca con el plazo de reclamación. Con `--no-deploy`, o si ese primer despliegue falla, todavía no hay clave: el siguiente `rebase cloud deploy` que tenga éxito en el directorio la pide, mientras el proyecto no se haya reclamado y `.env` no defina ya `REBASE_API_TOKEN`. Cuando el proyecto sea tuyo, crea las claves que quieras en su panel de administración.

Reclamar requiere una sesión iniciada en el navegador, no un token, y un método de pago en la organización a la que pasa el proyecto. Desde la reclamación, el proyecto se factura como cualquier otro. Reclamarlo también revoca el token del agente: inicia sesión con `rebase cloud login` o crea un token nuevo con `rebase cloud tokens create`.

El aprovisionamiento sin cuenta está limitado por dirección y en total, y un plano de control que no lo ha activado lo rechaza con un mensaje que lo dice.

## Cómputo y lo que cuesta

El precio de un proyecto se calcula en función de lo que reserva, no de un plan fijo. `compute` imprime
cada parámetro ajustable y el presupuesto desglosado del propio plano de control para ellos. (`rebase cloud
resources` es diferente: son las bases de datos y buckets que declara el código,
y si cada uno está aprovisionado; consulta la [referencia de la CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, p. ej., `500m` y `2Gi`. Vacío significa el valor por defecto de la plataforma: `100m` y `384Mi`, con picos de hasta 2 CPU y `2Gi` |
| `--replicas` | Instancias que existen en todo momento: el suelo del escalador automático (autoscaler), y lo que se factura al proyecto en reposo |
| `--autoscale-max` | 1–16. El techo que puede alcanzar, y el caso máximo por el que se le puede facturar. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. El porcentaje de utilización de CPU que el autoscaler mantiene, en relación con la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (spot): más económica, y reiniciada sin previo aviso |
| `--db-instances` | 1–3. `1` es una instancia única sin tolerancia a fallos (failover); `2` añade un nodo de respaldo automático (standby) |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no es lo mismo que fijarlo al mismo número: un parámetro vacío
sigue el valor por defecto de la plataforma y varía cuando este varía.

La CLI no valida ningún valor, a propósito: los límites corresponden al clúster en el que
se ejecuta un proyecto y difieren entre proveedores. El plano de control rechaza cualquier
valor que no pueda asumir e indica el campo en cuestión. Ejecuta `rebase cloud compute` para ver
el importe en €/mes antes y después; cualquier cambio se aplica inmediatamente, prorrateado desde hoy,
excepto aquel que reinicie la base de datos, el cual esperará a una ventana de mantenimiento.

## El resto de comandos

| Grupo de comandos | Lo que cubre |
|---|---|
| `login`, `logout`, `whoami` | Tu sesión |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](#ci-y-agentes) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `init` | Con `--claim`: un backend en vivo sin cuenta y un enlace para reclamarlo. Consulta [Un backend sin cuenta](#un-backend-sin-cuenta) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitorización |
| `previews` | Compilaciones servidas en su propia dirección por `deploy --preview`, y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reactivarlo |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `cron` | Las tareas cron de la aplicación desplegada y sus ejecuciones registradas, consultadas con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `domains` | Dominios personalizados, los registros DNS que se deben añadir y su verificación. Un proyecto puede responder en varios, cada uno verificado de forma independiente; `verify` y `remove` aceptan el dominio sobre el que actuar, el cual solo puede omitirse si solo existe uno (para `verify`, uno aún pendiente). `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu equipo, copias de seguridad, restauración y recuperación a un punto en el tiempo (point-in-time recovery) |
| `extensions` | Lista de extensiones de Postgres permitidas (allowlist) |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo modificarlo |
| `clusters` | Los clústeres en los que corren los tenants. Solo para administradores de la plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configuración del proyecto, organizaciones, deploy hooks y facturación |

Cada grupo de esa tabla responde a `--help` con su propia página —una línea de uso,
sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Una prueba automatizada mantiene el
índice de estas páginas, por lo que un grupo añadido sin una hace fallar la compilación en lugar de
responder con la tabla de contenidos. `verify:docs` somete la propia tabla a
dicho índice: cada grupo gestionado por la CLI aparece aquí exactamente una vez, por lo que un grupo
añadido sin su fila correspondiente también hará fallar la compilación.

Si se redirige mediante una tubería (pipe), `--help` responde en JSON: la misma línea de uso, flags y ejemplos
estructurados para ser leídos mediante código en lugar de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Dicho con total claridad, porque enterarse más tarde es peor:

- **Sin selección de región.** Actualmente todo se ejecuta en una sola región. El modelo
  de ubicación existe en la plataforma, pero un proyecto no puede seleccionar una región.
  `projects create --provider` y `--region` no son la excepción que parecen ser:
  registran a cuál de los destinos de despliegue registrados del plano de control pertenece un
  proyecto; como solo hay uno, ambos toman ese valor por defecto y ninguno mueve un
  proyecto a otra parte. `rebase cloud projects create --help` indica lo mismo.
- **No es de autoservicio.** El acceso se concede por lotes; no existe el flujo de registro y pago inmediato.
- **Sin SLA publicado** ni certificación SOC 2. Si necesitas alguno de los dos, indícalo
  al solicitar acceso en lugar de asumirlo.
- **Sin despliegues por rama**, y sin GitHub App oficial. Los deploy hooks —URLs
  secretas a las que apuntas un webhook de repositorio— son el método de automatización soportado. Los
  [despliegues de previsualización](#previsualizar-un-cambio) se están desplegando de forma gradual y se inician desde la CLI.
- **Los tokens actúan como una persona.** Un [token](#ci-y-agentes) es emitido por una cuenta
  y actúa en su nombre; todavía no existen identidades de máquina administradas por la organización. Si
  en su lugar inicias sesión desde CI, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD`
  desde un gestor de secretos: `--password` guarda la contraseña en el historial de tu shell y
  en la tabla de procesos, y emite una advertencia antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio nombra un plano de control distinto al de la plataforma,
  pásalo también mediante `--url`: sin una terminal, `login` se negará a enviar una contraseña a un
  host especificado únicamente por el archivo obtenido del repositorio.
- **La recuperación a un punto en el tiempo (PITR) es exclusiva de la CLI.** La consola muestra copias de seguridad;
  el flujo de trabajo por etapas de PITR es `rebase cloud db pitr`.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no está expuesta a
  internet, por lo que el host mostrado en la consola es la dirección que tu backend usa para acceder a ella y
  no resuelve a nada desde tu máquina local. `rebase cloud db connect` abre un puerto
  local conectado a esa base de datos a través de un túnel por el plano de control mientras
  lo mantengas en ejecución; no obstante, no existe un hostname permanente al que un servicio
  de terceros pueda conectarse. Dicho túnel, junto con la contraseña expuesta por
  `rebase cloud db info --reveal`, requieren el rol de propietario o administrador de la organización:
  el mismo que requiere el editor SQL de Studio, ya que los tres desembocan en una
  sesión directa sobre tus datos de producción.

## Autoalojamiento como alternativa

Nada de esto genera un bloqueo de proveedor (lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/)
utiliza la misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) despliega la misma topología a través
del Helm chart.
