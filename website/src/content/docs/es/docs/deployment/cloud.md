---
sourceHash: cbd1289dcc8b5347
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

**¿Te registraste con Google, GitHub o LinkedIn?** <span class="since-badge" data-since="0.26">Desde 0.26</span> Tu cuenta no tiene contraseña, así que
inicia sesión con un código:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo un código de 6 dígitos, válido durante diez minutos, y lo
escribes en el prompt. Ejecutado a secas en una terminal, `rebase cloud login` pregunta si
quieres usar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar
correo; si no puede, `--code` lo indica y termina con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` te pide después el código de tu
aplicación de autenticación, o uno de tus códigos de recuperación, sea cual sea la forma en que
iniciaste sesión. Ni un código de inicio de sesión ni un segundo factor se pueden escribir sin una terminal.
Para un script, crea un token de acceso en la consola (**Settings → Access
tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde `invalid_credentials` con las mismas dos vías de acceso, ya que
la causa habitual es una cuenta que nunca tuvo una.

`billing setup` vincula una tarjeta a la organización, una sola vez. Se ubica al principio
de la secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una tarjeta asociada,
y descubrirlo después de que un bundle haya terminado de subirse es el peor escenario.

Después, la página **Billing** de la consola lista las facturas de la organización,
cada una con la página alojada de Stripe y su PDF, y previsualiza la próxima factura de cada
proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming`
imprimen lo mismo. Ambas son para los propietarios y administradores de la organización. Donde la
plataforma lo ofrece, **Manage billing** abre el portal de clientes de Stripe para la
tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no pide un segundo
pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta es rechazada,
o el banco quiere que se confirme el pago, la consola te lleva a
**Billing**, donde **Fix your card** guarda otra tarjeta y **Complete the
payment** abre la factura de Stripe.

Lo que ha consumido un proyecto se muestra en su resumen, bajo **Usage this month**, y
para todos los proyectos a la vez en la página **Billing**: las peticiones frente a la
asignación incluida (la barra se vuelve ámbar al 80 %), los errores 5xx, el exceso acumulado
y hacia dónde se encamina el mes a este ritmo. El exceso lo calcula el mismo
código que lo informa a Stripe, así que es lo que llevará la factura; aparece
en la factura del mes siguiente. `rebase cloud usage` imprime lo
mismo, y `rebase cloud usage org` toda la organización. Cualquier miembro puede leerlo.
Las cifras indican lo que aún no pueden ver: el almacenamiento de objetos no se mide,
así que no se factura ningún exceso de almacenamiento; mientras un proyecto ejecuta dos o más pods de la app,
sus peticiones no se cuentan; y un día con muestras perdidas se subestima. Un
proyecto con autoescalado también muestra los pods que ejecutó por encima de `--replicas`, en horas-pod,
lo que cuestan a sus propias tarifas y si esta plataforma ya los cobra. Un
proyecto reclamado desde un agente cuenta solo los días desde la reclamación: antes,
el proyecto era de la plataforma.

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

"Live" significa que la dirección respondió después del build: el `/health` del backend devolvió `ok` y la página de una aplicación estática cargó (desde este despliegue, cuando la sirve la plataforma). La comprobación espera hasta `--live-timeout` segundos, 60 por defecto; `0` la omite. Si una aplicación no responde a tiempo, el despliegue sale igualmente con código cero, porque el despliegue tuvo éxito, y la última línea dice qué aplicación no respondió y por qué. Un despliegue fallido termina en cambio con una línea que nombra la aplicación y el motivo, con `rebase cloud logs` para el log completo del build.

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

<span class="since-badge" data-since="0.26">Desde 0.26</span>

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
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
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

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus aplicaciones estáticas
  integradas, igual que las ejecuta la producción. Obtiene un backend propio sobre una
  **base de datos vacía y propia**, nunca la de producción. Arrancar contra la base de datos
  de producción le aplicaría el esquema y las reglas de acceso de la previsualización.
- **`rebase cloud deploy web --preview`** previsualizaría una aplicación estática por sí sola,
  con sus páginas llamando al backend de **producción**. Eso requiere un plano de control
  que sirva sitios estáticos por separado, y Rebase Cloud todavía no lo hace: lo rechaza
  con `PREVIEW_STATIC_UNSERVED` y no publica nada. Previsualiza en su lugar el backend,
  que sirve las aplicaciones estáticas integradas en él; un proyecto sin backend
  gestionado todavía no se puede previsualizar.

Una previsualización no sube el código fuente ni registra aplicaciones ni hostnames, porque cada
una de esas cosas cambiaría el proyecto de producción. `--source` y `--eject` no se pueden
combinar con `--preview`. Cada uno construye una imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sin `--preview` es siempre el de producción.

La página **Deployments** de la consola lista las mismas previsualizaciones, y abre, muestra
el log de compilación de, o elimina cada una. Crear una sigue siendo un paso de la CLI.

Una previsualización caduca una semana después de su último despliegue.

Cuando termina, el despliegue comprueba que la dirección de la previsualización responde, como
hace un despliegue de producción (`--live-timeout <seconds>`, `0` para omitirlo). El certificado
de una previsualización nueva puede tardar uno o dos minutos, así que un despliegue que tuvo éxito
puede indicar que la dirección todavía no responde.

Un backend de previsualización se factura como una unidad de app al tamaño por defecto (100m de CPU
y 384 MiB de memoria, a la tarifa de tu app para su región y capacidad),
prorrateado por el tiempo que exista, y aparece en la cotización mensual del proyecto en la
consola. `rebase cloud deploy --preview` imprime la misma cotización para él, por mes (`cost`
con `--json`). Iniciar una requiere una tarjeta registrada, igual que un despliegue de producción. Un primer despliegue que
falla antes de que se ejecute nada se elimina en lugar de facturarse. Un proyecto puede ejecutar
tres backends de previsualización a la vez.

Cada dirección de previsualización nueva obtiene su propio certificado TLS de Let's Encrypt,
que permite 50 certificados nuevos por semana a un dominio, compartidos con todos los
sitios de producción en él. Las previsualizaciones pueden usar 20 de ellos en cualquier periodo de 7 días, en toda la plataforma. Superado
ese límite, una previsualización nueva se rechaza (`429`, `preview_cert_budget`) indicando cuándo se puede
desplegar; volver a desplegar una previsualización que ya existe nunca cuenta.

La base de datos de un backend de previsualización es una segunda base de datos en el Postgres de **producción**:
sus propios datos, pero la misma instancia y el mismo disco. Está limitada a 10
conexiones, para que las previsualizaciones no agoten las de producción, y a 2 GB: una previsualización
cuya base de datos crece más allá de eso se pausa. Su backend se detiene, su dirección deja de
responder, `rebase cloud previews` y la consola la muestran como `paused` con el
motivo, y se notifica a los propietarios y administradores del proyecto (`preview.paused`). Sus
datos se conservan hasta que caduca. Despliégala de nuevo para iniciarla (se vuelve a pausar
mientras la base de datos siga siendo demasiado grande), o elimínala. Una previsualización pausada se sigue
facturando hasta que se elimina o caduca. Elimina las previsualizaciones que ya no necesites. Las extensiones instaladas en producción no están
instaladas en la base de datos de una previsualización.

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

Una aplicación estática desplegada por separado (`rebase cloud deploy <app>`) todavía no admite rollback. Su despliegue registra qué aplicación publicó, pero no un bundle, así que el plano de control no tiene de dónde restaurarla. La solución es volver a desplegar la última versión buena, por ejemplo desde el commit anterior al defectuoso. Tras un despliegue así, `deploy` lo indica en lugar de remitir a `rollback`, y `rollback` sin un id se niega en lugar de volver a desplegar el backend que está sirviendo.

Por tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que significa un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments` marca los que califican, y `--json` informa de `rollbackable` por fila junto con la `image` o `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál es el caso: uno que no haya sido exitoso
y uno previo al momento en que la plataforma comenzó a registrar artefactos. No hay nada que
asumir en ninguno de los dos casos —suponerlo enviaría lo que se haya compilado o subido más
recientemente mientras se afirma restaurar este—; en su lugar, despliega la versión que desees.

Todo despliegue exitoso termina indicando el camino de vuelta (`rebase cloud rollback`), para que esté a la vista en el momento en que se detecta una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que la versión restaurada empiece a responder antes de reportar éxito. Puedes seguirlo con `rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada se puede recuperar a cualquier minuto dentro de su ventana de recuperación,
desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Se hace en dos pasos. Primero se prepara una copia recuperada junto a la base de datos activa;
tu app sigue ejecutándose sobre la activa, y el almacenamiento de la copia se factura hasta que
hagas el cutover o la descartes.
Después, cuando la copia está lista, el cutover vuelve a apuntar la app a ella y la reinicia.
Todo lo escrito después de la hora objetivo no está en la copia. La base de datos original
se conserva como vía de retorno, y sigue facturando almacenamiento; volver a ella, eliminarla
o una segunda restauración pasan por el soporte. Solo un propietario o administrador
puede preparar, hacer el cutover o descartar, y la consola pide el nombre del proyecto
antes de hacer el cutover.

## Protege tu cuenta

Tu cuenta de la consola puede acceder a bases de datos de producción, secretos y facturación, así que
protégela como tal. Abre **Account security** desde el menú bajo tu avatar
en la consola (o ve a `/account`). La página es tuya, no de una
organización: lo que configuras allí se aplica en todas las organizaciones a las que perteneces.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password,
  Google Authenticator, Authy). La página muestra una clave de configuración para añadir a la app, o un
  enlace que abre la app con la clave ya rellenada en un teléfono, y luego pide el
  código de 6 dígitos que muestra la app. A partir de entonces, cada inicio de sesión pide un código,
  tanto si inicias sesión con contraseña, Google o GitHub.
- **Códigos de recuperación.** Al activarla se te dan diez códigos de un solo uso, que se muestran una vez.
  Cada uno te permite iniciar sesión en lugar del código del autenticador si pierdes tu
  teléfono, así que guárdalos antes de cerrar el cuadro de diálogo. **New recovery codes**
  los reemplaza, y los anteriores dejan de funcionar. Desactivar la verificación en dos pasos
  y obtener códigos nuevos piden antes un código.
- **Contraseña.** Cambiarla cierra tu sesión en todos los demás dispositivos. Una cuenta
  creada con Google, GitHub o LinkedIn no tiene contraseña; la página ofrece enviarte
  por correo un enlace para establecer una.
- **Dispositivos con sesión iniciada.** Cada navegador y terminal con sesión iniciada en tu cuenta,
  con su dirección y cuándo inició sesión. Cierra la sesión de cualquier dispositivo que no
  reconozcas, o de todos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no piden un segundo
factor, así que CI sigue desplegando después de que lo actives. Revoca un token en el que ya no
confíes en **Settings → Access tokens**.

## Invita a tu equipo

**Members → Invite member** da un enlace para copiar (enviado por correo cuando este plano de control
envía correo) que funciona una vez, durante 7 días, para una cuenta que haya verificado esa
dirección; nadie se une hasta que acepta. Invita a un administrador o a un miembro, y conviértelo
en propietario una vez que se haya unido. Los propietarios y administradores lo ven, lo reenvían o lo revocan en
**Pending invitations**; desde una terminal, <span class="since-badge" data-since="0.26">Desde 0.26</span> [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Consulta quién hizo qué

La página **Activity** de la consola y <span class="since-badge" data-since="0.26">Desde 0.26</span> `rebase cloud activity` muestran a los
propietarios y administradores de la organización quién desplegó, definió o reveló una variable de
entorno (por nombre, nunca por valor), cambió un dominio, restauró una copia de seguridad,
redimensionó, detuvo o eliminó un proyecto, cambió el rol de un miembro o creó un
token, y cuándo. La página **Settings** de un proyecto enlaza a sus propias entradas; una entrada
sobre un proyecto eliminado permanece. Un script la lee con un token creado con
`--can audit` en la organización. Las entradas se conservan un año. Los filtros están en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no deberían contener tu contraseña. Proporciónale un token limitado a
unas pocas acciones en un proyecto, creado desde una terminal con sesión iniciada con
`rebase cloud tokens create --project shop --can deploy,logs`, y defínelo como
`REBASE_TOKEN`. La facturación de una organización, su registro de actividad y los ajustes de notificaciones
son capacidades propias (`--can billing`, `audit`,
`notifications`) que un token solo posee cuando se piden. Las capacidades, un
workflow de GitHub Actions y lo que permanece en manos de una persona con sesión iniciada están en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

<span class="since-badge" data-since="0.26">Desde 0.26</span>

`rebase cloud init --claim` da a una app un backend en vivo antes de que nadie se haya
registrado, e imprime una URL de reclamación para que la persona se lo quede; un proyecto que nadie reclama
en 72 horas se elimina. Lo que puede hacer el token del proyecto sin reclamar, el
`REBASE_API_TOKEN` que escribe y lo que cambia la reclamación están en
[Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

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
| `--replicas` | Instancias que existen en todo momento: el suelo del escalador automático (autoscaler), y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El techo que puede alcanzar. Las instancias que el autoscaler añade por encima de `--replicas` se miden por pod-segundo a las mismas tarifas, y solo se cobran donde la plataforma lo ha activado; **Usage this month** indica cuándo. `--no-autoscale` lo desactiva |
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
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `init`, `claim` | Con `--claim`: un backend en vivo sin cuenta y un enlace para reclamarlo; `claim` vuelve a imprimir ese enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitorización |
| `previews` | Compilaciones servidas en su propia dirección por `deploy --preview`, y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reactivarlo. Un proyecto detenido conserva su suscripción, salvo que la plataforma facture los proyectos detenidos solo por almacenamiento y la tarifa de la plataforma; la fila **Billing** de la consola lo indica cuando es así |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `cron` | Las tareas cron de la aplicación desplegada y sus ejecuciones registradas, consultadas con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, entregada al reclamar; `rotate` la reemplaza y revoca la anterior. Propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, administrador en la propia API de la app: cuándo se rotó por última vez; `rotate` le da a la app una nueva. Propietarios y administradores |
| `domains` | Dominios personalizados, los registros DNS que se deben añadir y su verificación. Un proyecto puede responder en varios, cada uno verificado de forma independiente; `verify` y `remove` aceptan el dominio sobre el que actuar, el cual solo puede omitirse si solo existe uno (para `verify`, uno aún pendiente). `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu equipo, copias de seguridad, restauración y recuperación a un punto en el tiempo (point-in-time recovery) |
| `extensions` | Lista de extensiones de Postgres permitidas (allowlist) |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo modificarlo |
| `usage` | Peticiones usadas este mes frente a la asignación incluida, y el exceso acumulado, tal como lo cuenta la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que corren los tenants. Solo para administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, facturación |
| `activity` | El registro de auditoría de la organización: quién desplegó, cambió una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Propietarios y administradores. Consulta [Consulta quién hizo qué](#consulta-quién-hizo-qué) |
| `notifications`, `webhooks` | Adónde se envían por POST los eventos del proyecto: Slack, Discord o cualquier URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` está retirado y termina con 1 y el código `command_retired` |

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
- **Los tokens actúan como una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) es emitido por una cuenta
  y actúa en su nombre; todavía no existen identidades de máquina administradas por la organización. Si
  en su lugar inicias sesión desde CI, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD`
  desde un gestor de secretos: `--password` guarda la contraseña en el historial de tu shell y
  en la tabla de procesos, y emite una advertencia antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio nombra un plano de control distinto al de la plataforma,
  pásalo también mediante `--url`: sin una terminal, `login` se negará a enviar una contraseña a un
  host especificado únicamente por el archivo obtenido del repositorio.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no está expuesta a
  internet, por lo que el host mostrado en la consola es la dirección que tu backend usa para acceder a ella y
  no resuelve a nada desde tu máquina local. `rebase cloud db connect` abre un puerto
  local conectado a esa base de datos a través de un túnel por el plano de control mientras
  lo mantengas en ejecución; no obstante, no existe un hostname permanente al que un servicio
  de terceros pueda conectarse. Dicho túnel, junto con la contraseña expuesta por
  `rebase cloud db info --reveal`, requieren el rol de propietario o administrador de la organización:
  el mismo que requiere el editor SQL de Studio, ya que los tres desembocan en una
  sesión directa sobre tus datos de producción.
- **Desplegar es ejecutar código con los secretos de producción.** El entorno de la app
  contiene `REBASE_SERVICE_KEY` (administrador en su propia API),
  `DATABASE_URL` y `JWT_SECRET`, así que el código que despliega un miembro puede leerlos,
  aunque solo los propietarios y administradores puedan revelarlos en la consola. Invita
  como miembro solo a alguien en quien confiarías con esos valores.
- **La clave de servicio se puede reemplazar.** <span class="since-badge" data-since="0.26">Desde 0.26</span> La página **Settings** del proyecto
  (o `rebase cloud service-key rotate`) emite un nuevo `REBASE_SERVICE_KEY`
  y reinicia la app con él. La clave anterior funciona hasta que el reinicio ha
  terminado, y nada después, así que cualquier cosa que la copiara es rechazada
  a partir de entonces. Reclamar un proyecto hace lo mismo.

## Autoalojamiento como alternativa

Nada de esto genera un bloqueo de proveedor (lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/)
utiliza la misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) despliega la misma topología a través
del Helm chart.
