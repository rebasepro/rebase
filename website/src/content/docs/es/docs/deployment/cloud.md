---
sourceHash: a32dc82ba7002b52
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye todavía la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la misma
imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Actualmente opera tenants reales y se habilita
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta a la que se le haya otorgado acceso.
Todo lo demás en este sitio funciona sin ella.
:::

## Qué es

Un **proyecto** de Cloud se compone de tres elementos que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no la compilación de un contenedor |
| **Base de datos** | Un PostgreSQL administrado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo |
| **Almacenamiento** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y cada uno se factura por lo que
reserva en lugar de por usuario (per seat).

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autoaloga con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` no toma argumentos posicionales. El nombre y el subdominio son
flags, y ambos son obligatorios: en una terminal se solicitan interactivamente, y una
ejecución sin interfaz gráfica (headless) que omita cualquiera de los dos termina con `input_required` en lugar de inventar
uno. **El subdominio no se puede editar posteriormente:** es el
host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un paso
`link` por separado. Escribe `.rebase/cloud.json`, que registra el id del proyecto
y el slug. Ese archivo no es un secreto y no contiene tus credenciales; estas residen
en `~/.rebase/credentials.json`, creado por `login`.

Sin embargo, se commitea con el código, por lo que un repositorio clonado puede apuntar a cualquier
plano de control. Cuando el host proviene únicamente de ese archivo, y no es ni el propio
de la plataforma ni uno en el que hayas iniciado sesión anteriormente, `login` lo menciona y pregunta
antes de enviar tu correo electrónico y contraseña allí. Sin una terminal, o con
`--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí intencionalmente.

`billing setup` asocia una tarjeta a la organización, una sola vez. Se encuentra al inicio de la
secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una, y
enterarse de eso después de que el bundle ha terminado de subirse es el peor escenario.

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
`runtime: "managed"` para su backend, y `deploy` lee esa declaración;
lo indica en el proceso (`rebase.json declares runtime: managed — deploying a
bundle`), compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta un estado terminal. El código de
salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Termina indicando dónde responde ahora cada aplicación y si la nueva versión está en vivo allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
```

"Live" significa que la dirección respondió después del build: el `/api/health` del backend devolvió `ok` y la página de una aplicación estática cargó (desde este despliegue, cuando la sirve la plataforma). La comprobación espera hasta `--live-timeout` segundos, 60 por defecto; `0` la omite. Si una aplicación no responde a tiempo, el despliegue sale igualmente con código cero, porque el despliegue tuvo éxito, y la última línea dice qué aplicación no respondió y por qué. Un despliegue fallido termina en cambio con una línea que nombra la aplicación y el motivo, con `rebase cloud logs` para el log completo del build.

Los scripts pasan `--json` para obtener un objeto con los mismos datos: `apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de `rebase cloud`, `deploy` no cambia a JSON por sí solo en una tubería.

Para desplegar un artefacto que se compiló previamente —por ejemplo, un trabajo de CI que compila una vez y despliega dos—, apunta al directorio en lugar de volver a compilar:

Lo que permite ese runtime (paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños del cuerpo de la petición, el sistema de archivos, secretos, almacenamiento y red
saliente) se encuentra en su propia página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para enviar un artefacto compilado previamente (por ejemplo, un trabajo de CI que compila una vez y
despliega dos veces), apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime administrado requiere su propio flag, `--eject`, y nada más lo
solicitará: una compilación que movería un proyecto administrado a una imagen de contenedor de la que luego se hace
responsable se rechaza hasta que lo indiques explícitamente. Anteriormente `--force` significaba esto, lo cual situaba
la acción menos reversible que puede realizar la CLI bajo la misma palabra que "sobrescribir este
archivo"; ahora es una opción desconocida en lugar de un alias, por lo que cualquier script que la incluya
se detendrá.

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
rebase cloud logs            # el log de compilación
rebase cloud logs --runtime  # lo que está imprimiendo el contenedor en ejecución
rebase cloud status          # lo que la plataforma considera que está haciendo el proyecto
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando activamente y consultar el estado periódicamente (polling) es lo adecuado; cuando indica
algo, ese algo está esperando por ti.

## Revertir (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que se envió en un despliegue exitoso
anterior, y nunca vuelve a compilar: el valor de un rollback reside en que envía un
artefacto que ya se ha ejecutado.

Los despliegues que califican dependen de cómo se despliega el proyecto, y ambos tipos
funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto está ejecutando actualmente |

Las aplicaciones estáticas integradas en el bundle del backend (un `rebase cloud deploy` sin más en un proyecto con backend) forman parte de ese bundle, así que hacen rollback con él.

Una aplicación estática desplegada por separado (`rebase cloud deploy <app>`) todavía no admite rollback. Su despliegue registra qué aplicación publicó, pero no un bundle, así que el plano de control no tiene de dónde restaurarla. La solución es volver a desplegar la última versión buena, por ejemplo desde el commit anterior al defectuoso. Tras un despliegue así, `deploy` lo indica en lugar de remitir a `rollback`.

Por tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que significa un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments` marca los que califican, y `--json` informa de `rollbackable` por fila junto con la `image` o `bundle` que restauraría.

Dos tipos de despliegues son rechazados, y la CLI indica cuál es el caso: uno que no tuvo éxito
y uno anterior a que la plataforma comenzara a registrar su artefacto. En ningún caso se hacen
suposiciones (suponer implicaría enviar lo que se haya compilado o subido más
recientemente mientras se afirma restaurar este), así que, en su lugar, despliega la versión que deseas.

Todo despliegue exitoso termina indicando el camino de vuelta (`rebase cloud rollback`), para que esté a la vista en el momento en que se detecta una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que la versión restaurada empiece a responder antes de reportar éxito. Puedes seguirlo con `rebase cloud logs -f`.

## CI y agentes

Un trabajo de CI o un agente no debería contener tu contraseña. Proporciónale un
token en su lugar: una clave que actúa en nombre de tu cuenta, limitada a unas pocas acciones en un
solo proyecto. Créalo desde una terminal con la sesión iniciada:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

El token se muestra una sola vez, en una línea con el formato `export REBASE_TOKEN=rk_live_…`. Con
`REBASE_TOKEN` configurado, cada comando de `rebase cloud` se autentica con él en lugar de
tu inicio de sesión, y nunca lee ni escribe la sesión guardada. En GitHub Actions,
almacénalo como un secreto de repositorio y exponlo bajo ese nombre:

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

`--can` acepta una o más capacidades, separadas por comas o repetidas:

| Capacidad | Lo que el token puede hacer |
|---|---|
| `deploy` | Desplegar el proyecto y seguir sus compilaciones: `deploy`, `deployments` |
| `logs` | Leer logs de compilación y de runtime, así como métricas en tiempo real: `logs`, `metrics` |
| `env` | Leer y modificar variables de entorno, incluidos los secretos |
| `database` | `db list`, `db info` y `db connect`, lo cual incluye la contraseña de la base de datos |
| `backups` | Listar, crear, inspeccionar y descargar copias de seguridad, y leer la ventana de recuperación a un punto en el tiempo |

Por debajo, un token es una [clave de API personal](/docs/backend/api-keys/#personal-keys)
en el plano de control. Cada capacidad se traduce en varios
[scopes](/docs/backend/roles-and-scopes/): `deploy` en `shop` posee
`project:deploy:<id>`, con el id del proyecto, más los scopes de datos y funciones
que llaman los comandos de despliegue. El token nunca tiene más permisos de los que tiene tu cuenta en el momento
en que se utiliza, por lo que pierde cualquier permiso que pierda tu cuenta.

Dos operaciones quedan restringidas exclusivamente a una persona con sesión iniciada:

- **Gestionar tokens.** `rebase cloud tokens list`, `create` y `revoke <id>` requieren
  tu sesión de `rebase cloud login`. Un token no puede listar, crear ni revocar
  tokens, porque un token que pudiera generar tokens podría generar su propio sucesor.
- **Restaurar.** Ninguna capacidad otorga la restauración de una copia de seguridad o un
  `restore` y `cutover` a un punto en el tiempo. Sobrescribir una base de datos en producción con datos antiguos sigue
  reservado a un propietario (owner) o administrador (admin) con sesión iniciada.

Ejecutar `rebase cloud whoami` con un token configurado muestra lo que puede hacer y en qué
proyecto. `rebase cloud tokens revoke <id> --yes` lo revoca de inmediato.

## Cómputo y sus costos

El precio de un proyecto se determina en función de lo que reserva, no a partir de un plan predefinido. `compute` imprime
cada parámetro y la cotización desglosada del propio plano de control para ellos. (`rebase cloud
resources` es algo diferente: las bases de datos y los buckets que el código declara,
y si cada uno está aprovisionado; consulta la [referencia de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, ej. `500m` y `2Gi`. Vacío significa el valor predeterminado de la plataforma: `250m` y `512Mi` |
| `--replicas` | Instancias que existen permanentemente: el límite inferior del autoscaler y por lo que se factura el proyecto en reposo |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar y el peor caso en términos de facturación. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que el autoscaler mantiene, en relación con la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (spot): más económica y reiniciada sin previo aviso |
| `--scale-to-zero` | `true` o `false`. Cómputo facturado por petición que se detiene cuando está inactivo, a costa de un arranque en frío (cold start) |
| `--db-instances` | 1–3. `1` es una única instancia sin tolerancia a fallos; `2` añade una réplica de respaldo automática (standby) |
| `--db-cpu`, `--db-memory`, `--storage` | Por instancia de base de datos. Vacío significa `500m`, `2Gi` y el volumen predeterminado |

Un parámetro vacío no es lo mismo que uno fijado al mismo valor: un parámetro vacío
sigue el valor predeterminado de la plataforma y cambia cuando este cambia.

La CLI no valida nada intencionalmente: los límites pertenecen al clúster en el que
se ejecuta un proyecto y varían entre proveedores. El plano de control rechaza un
valor que no puede satisfacer e indica el campo correspondiente. Ejecuta `rebase cloud compute` para ver
el costo en €/mes antes y después; un cambio se aplica inmediatamente, prorrateado a partir de hoy,
excepto uno que reinicie la base de datos, el cual espera a una ventana de mantenimiento.

## El resto de la superficie de comandos

| Grupo de comandos | Lo que cubre |
|---|---|
| `login`, `logout`, `whoami` | Tu sesión |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](#ci-y-agentes) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitoreo |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `cron` | Los cron jobs de la aplicación desplegada y sus ejecuciones registradas, consultados con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime los valores; `--secret` es solo de escritura |
| `domains` | Dominios personalizados, registros DNS que se deben añadir y verificación. Un proyecto puede responder en varios dominios, cada uno verificado por separado; `verify` y `remove` reciben el dominio sobre el que actuar, el cual solo puede omitirse cuando existe uno solo (para `verify`, uno aún pendiente). `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo |
| `extensions` | La lista de extensiones de Postgres permitidas |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets gestiona la plataforma, en comparación con lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo modificarlo |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Solo para administradores de la plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configuración del proyecto, organizaciones, deploy hooks, pagos |

Cada grupo de esa tabla responde a `--help` con una página propia (una línea de uso,
sus flags y ejemplos), y `--help` nunca ejecuta el comando. Una prueba contiene el
índice de las páginas, de modo que un grupo añadido sin ella hace fallar la compilación en lugar de
responder con la tabla de contenidos. `verify:docs` somete la tabla misma a
dicho índice: cada grupo despachado por la CLI aparece aquí exactamente una vez, por lo que un grupo
añadido sin una fila también hace fallar la compilación.

Mediante una redirección o pipe, `--help` responde en formato JSON: la misma línea de uso, flags y ejemplos
como una estructura para leer en lugar de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Dicho con total claridad, porque enterarse más tarde es peor:

- **Sin selección de región.** Actualmente todo se ejecuta en una única región. El modelo
  de asignación existe en la plataforma, pero un proyecto no puede elegir región.
  `projects create --provider` y `--region` no son la excepción que aparentan
  ser: registran a cuál de los destinos de despliegue registrados en el plano de control
  pertenece un proyecto, y como solo hay uno, ambos toman ese por defecto y ninguno traslada
  un proyecto a otro lugar. `rebase cloud projects create --help` indica lo mismo.
- **No es de autoservicio.** El acceso se otorga por lotes; no existe un flujo de registro y pago inmediato.
- **Sin SLA publicado** ni certificación SOC 2. Si necesitas alguno de ellos, indícalo al solicitar
  acceso en lugar de darlo por sentado.
- **Sin despliegues de previsualización (preview) ni por ramas (branch deploys)**, y sin GitHub App oficial de primera parte. Los deploy hooks
  (URLs secretas a las que apuntas un webhook de repositorio) son el mecanismo de automatización admitido.
- **Los tokens actúan como una persona.** Un [token](#ci-y-agentes) es emitido por una cuenta
  y actúa en su nombre; aún no existe una identidad de máquina perteneciente a la organización. Si
  inicias sesión desde CI en su lugar, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD`
  desde un gestor de secretos; `--password` coloca la contraseña en tu historial de terminal y
  en la tabla de procesos, y te lo advierte antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio especifica un plano de control distinto al propio de la plataforma, pásalo
  también como `--url`: sin una terminal, `login` se niega a enviar una contraseña a un
  host especificado únicamente por el archivo descargado.
- **La recuperación a un punto en el tiempo es exclusiva de la CLI.** La consola muestra copias de seguridad; el flujo de trabajo
  por etapas de PITR es `rebase cloud db pitr`.
- **Sin endpoint público de base de datos.** Una base de datos administrada no está expuesta a
  Internet, por lo que el host mostrado en la consola es la dirección que utiliza tu backend para acceder a ella y
  no se resolverá en tu máquina. `rebase cloud db connect` abre un puerto
  local hacia esa base de datos, canalizado a través del plano de control, mientras lo
  mantengas en ejecución; sin embargo, no existe un hostname permanente al que un servicio
  de terceros pueda conectarse. Tanto ese túnel como la contraseña obtenida mediante
  `rebase cloud db info --reveal` requieren el rol de owner o admin de la organización:
  el mismo que requiere el editor SQL de Studio, ya que los tres desembocan en una
  sesión sobre tus datos de producción.

## Autoalojamiento como alternativa

Nada aquí implica un bloqueo de proveedor (lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/)
ejecuta la misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) despliega la misma topología a partir
del chart de Helm.
