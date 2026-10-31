---
sourceHash: 3f0338ecb589f00b
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que autoalojarías: la misma
imagen `rebasepro/server` publicada, el mismo bundle, el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Ya ejecuta tenants reales y se abre por
lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es autoservicio, por lo que los comandos a continuación requieren una cuenta
a la que se le haya dado acceso. Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no la compilación de un contenedor |
| **Database** | Un PostgreSQL gestionado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Storage** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando realizas el primer despliegue, y cada uno se
factura por lo que reserva en lugar de por usuario (seat).

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que se inicia en cualquier lugar donde se ejecute la imagen de
runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` no toma ningún argumento posicional. El nombre y el subdominio
son flags, y ambos son obligatorios; en una terminal se solicitarán
interactivamente, y una ejecución no interactiva (headless) que omita cualquiera
de ellos saldrá con `input_required` en lugar de inventar uno. **El subdominio no
se puede editar después:** es el host `<slug>.rebase.website` en el que responde
el proyecto, así que elígelo conscientemente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no
hay un paso de `link` por separado. Escribe `.rebase/cloud.json`, que registra el
id del proyecto y el slug. Ese archivo no es un secreto ni son tus
credenciales; estas residen en `~/.rebase/credentials.json`, escrito por `login`.

Sin embargo, se commitea con el código, por lo que un repositorio clonado puede
nombrar cualquier plano de control (control plane). Cuando el host proviene
únicamente de ese archivo, y no es el propio de la plataforma ni uno en el que
hayas iniciado sesión anteriormente, `login` lo menciona y pregunta antes de
enviar tu correo y contraseña allí. Sin una terminal, o con `--json`, lo
rechazará con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí intencionalmente.

**¿Te registraste con Google, GitHub o LinkedIn?** Tu cuenta no tiene
contraseña, así que inicia sesión con un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te enviará un código de 6 dígitos por correo, válido durante
diez minutos, y lo ingresas en el prompt. Ejecutado normalmente en una terminal,
`rebase cloud login` te preguntará si deseas usar tu contraseña o un código. Los
códigos requieren que el plano de control pueda enviar correos electrónicos; si no
puede, `--code` lo indicará y saldrá con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` te pedirá el código de tu
aplicación de autenticación o uno de tus códigos de recuperación,
independientemente de cómo hayas iniciado sesión. Ni el código de inicio de
sesión ni el segundo factor se pueden ingresar sin una terminal. Para un script,
crea un token de acceso en la consola (**Settings → Access tokens**) y define
`REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde `invalid_credentials` ofreciendo las mismas
dos formas de acceso, ya que la causa habitual es una cuenta que nunca tuvo una.

`billing setup` asocia una tarjeta a la organización, una sola vez. Es el primer
paso de la secuencia a propósito: el primer despliegue de un proyecto se rechaza
si no hay una, y enterarse después de que el bundle haya terminado de subirse es
el peor orden posible.

Después de eso, la página **Billing** de la consola muestra las facturas de la
organización, cada una con la página alojada de Stripe y su PDF, y ofrece una
vista previa de la próxima factura de cada proyecto. `rebase cloud billing
invoices` y `rebase cloud billing upcoming` muestran lo mismo. Ambos son para
propietarios (owners) y administradores (admins) de la organización. Donde la
plataforma lo ofrezca, **Manage billing** abre el portal de clientes de Stripe
para gestionar la tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no solicita
ningún segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la
tarjeta es rechazada o el banco solicita confirmar el pago, la consola te
redirige a **Billing**, donde **Fix your card** permite guardar otra tarjeta y
**Complete the payment** abre la factura de Stripe.

Lo que ha consumido un proyecto se muestra en su resumen general, bajo **Usage
this month**, y para todos los proyectos a la vez en la página **Billing**:
solicitudes frente a la cuota incluida (la barra se vuelve ámbar al 80%),
errores 5xx, el exceso de uso (overage) acumulado hasta el momento y cómo
cerrará el mes a ese ritmo. El exceso se calcula con el mismo código que lo
reporta a Stripe, por lo que es lo que figurará en la factura; aparece en la
factura del mes siguiente. `rebase cloud usage` muestra lo mismo, y `rebase cloud
usage org` lo muestra para toda la organización. Cualquier miembro puede
consultarlo. Las cifras indican lo que aún no pueden ver: el almacenamiento de
objetos no se mide, por lo que no se factura exceso de almacenamiento; mientras
un proyecto ejecute dos o más pods de app, sus solicitudes no se contabilizan; y
un día con muestras perdidas cuenta de menos. Un proyecto con escalado automático
también muestra los pods que ejecutó por encima de `--replicas`, en pod-horas,
cuánto cuestan según sus propias tarifas y si esta plataforma los cobra todavía.
Un proyecto reclamado desde un agente cuenta solo los días a partir de la
reclamación: antes de ella, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crear uno nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando y ningún flag que recordar. El `rebase.json` de un scaffold
declara `runtime: "managed"` para su backend, y `deploy` lee esa declaración
—lo indica al procesarlo (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta un estado final
(terminal state). El código de salida es el veredicto, por lo que la misma línea
funciona de forma desatendida en CI.

Finaliza indicando en qué dirección responde ahora cada app y si la nueva versión
está activa (live) allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que la dirección respondió después de la compilación: el
`/health` de un backend devolvió `ok`, y la página de una app estática se cargó
(desde este despliegue, cuando la plataforma la sirve). La comprobación espera
hasta `--live-timeout` segundos, 60 por defecto; `0` la omite. Si una app no
responde a tiempo, el despliegue aún así finaliza con código cero, porque el
despliegue tuvo éxito, y la última línea indica qué app no respondió y por qué.
Un despliegue fallido termina en una sola línea, indicando la app y el motivo,
sugiriendo `rebase cloud logs` para ver el registro de compilación completo.

Los scripts pueden pasar `--json` para obtener un único objeto con los mismos
datos: `apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del
despliegue. A diferencia del resto de `rebase cloud`, `deploy` no cambia a JSON
automáticamente cuando se usa en tuberías (pipes).

Lo que permite ese runtime —paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños del cuerpo de la petición, el sistema de archivos,
secretos, almacenamiento y red de salida— se encuentra en su propia página:
[Runtime de backend gestionado](/docs/deployment/managed-runtime/).

Para enviar un artefacto compilado previamente —por ejemplo, un trabajo de CI
que compila una vez y despliega dos veces—, apunta al directorio en lugar de
volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime gestionado tiene su propio flag, `--eject`, y nada más lo
solicita: una compilación que trasladaría un proyecto gestionado a una imagen de
contenedor de la que luego sería responsable se rechaza hasta que lo indiques
explícitamente. `--force` solía significar esto, lo que ponía la acción menos
reversible de la CLI bajo la misma palabra que "sobrescribir este archivo"; ahora
es una opción desconocida en lugar de un alias, por lo que un script que la use
se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente tal como están. Cuando su
`build` solo copia scripts escritos a mano en `output`, nada los ha analizado
(parseado), y un archivo con un error tipográfico puede publicarse y evitar que
la página cargue. Por lo tanto, antes de subir nada, `deploy` analiza cada
archivo `.js`, `.mjs` y `.cjs` en el `output` de cada app estática, junto con
cada `<script>` inline en sus archivos `.html`. Esto cubre tanto una app
estática desplegada por su cuenta como las apps estáticas integradas en el
bundle del backend. Un error de sintaxis detiene el despliegue indicando el
archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Se omiten los scripts inline
que un navegador no ejecuta como JavaScript: JSON, import maps, plantillas y
cualquier otro `type` que no sea JavaScript, un `<script src>` y un script que
aún contenga marcado de plantillas sin renderizar como `{{ }}`. Un archivo `.js`
es válido si se analiza correctamente como script clásico o como módulo, ya que
la página decide cuál de los dos es. No se lee nada dentro de `node_modules`, ni
tampoco un `--bundle-dir` precompilado. `--no-verify` omite la comprobación para
un despliegue.

Monitoréalo:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` informa `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando activamente y sondear (polling) es lo adecuado;
cuando indica algo, ese algo te está esperando a ti.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que haría `deploy`, pero lo sirve en una
dirección propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa
sirviendo lo que servía antes. El despliegue imprime la dirección de la preview
cuando finaliza la compilación.

Para mantener una misma dirección entre despliegues, asigna un nombre a la
preview. Desplegar de nuevo con el mismo nombre la actualizará:

```bash
rebase cloud deploy --preview-name new-checkout
```

Con qué se comunica una preview depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps
  estáticas integradas, de la misma manera en que las ejecuta producción.
  Obtiene un backend propio en una **base de datos vacía propia**, nunca la de
  producción. Iniciar contra la base de datos de producción aplicaría el esquema
  y las reglas de acceso de la preview sobre ella.
- **`rebase cloud deploy web --preview`** previsualizaría una sola app estática
  de forma independiente, haciendo que sus páginas llamen al backend de
  **producción**. Eso requiere un plano de control que sirva sitios estáticos por
  sí mismos, y Rebase Cloud aún no lo hace: lo rechazará con
  `PREVIEW_STATIC_UNSERVED` y no publicará nada. Previsualiza el backend en su
  lugar, el cual sirve las apps estáticas integradas en él; un proyecto sin
  backend gestionado aún no se puede previsualizar.

Una preview no sube código fuente ni registra apps o nombres de host, ya que
cualquiera de estas acciones modificaría el proyecto de producción. `--source` y
`--eject` no se pueden combinar con `--preview`. Cada uno de ellos compila una
imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sin `--preview` siempre corresponde a producción.

La página **Deployments** de la consola lista las mismas previews, y permite
abrir, ver el registro de compilación o eliminar cada una. Crearlas sigue siendo
un paso exclusivo de la CLI.

Una preview expira una semana después del último despliegue en ella.

Al terminar, el despliegue comprueba que la dirección de la preview responda, tal
como lo hace un despliegue de producción (`--live-timeout <seconds>`, `0` para
omitir). El certificado de una preview nueva puede tardar uno o dos minutos, por
lo que un despliegue exitoso podría indicar que la dirección aún no responde.

Una preview de backend se factura como una unidad de app en el tamaño
predeterminado (100m de CPU y 384 MiB de memoria, a la tarifa de tu app para su
región y capacidad), prorrateada durante el tiempo que exista, y aparece en la
estimación mensual del proyecto en la consola. `rebase cloud deploy --preview`
imprime la misma estimación mensual para ella (`cost` bajo `--json`). Iniciar una
requiere una tarjeta registrada, al igual que un despliegue en producción. Un
primer despliegue que falla antes de que se ejecute algo se elimina en lugar de
facturarse. Un proyecto puede ejecutar hasta tres previews de backend
simultáneamente.

Cada nueva dirección de preview obtiene su propio certificado TLS de Let's
Encrypt, que permite a un dominio 50 certificados nuevos por semana, compartidos
con cada sitio de producción en él. Las previews pueden tomar 20 de ellos en
cualquier período de 7 días, en toda la plataforma. Pasado ese límite, se rechaza
una nueva preview (`429`, `preview_cert_budget`) indicando cuándo podrá
desplegarse; volver a desplegar una preview existente nunca cuenta para este
límite.

La base de datos de una preview de backend es una segunda base de datos en el
Postgres de **producción**: sus propios datos, pero en la misma instancia y en el
mismo disco. Está limitada a 10 conexiones, para que las previews no agoten las
de producción, y a 2 GB: una preview cuya base de datos supere ese límite se
pausa. Su backend se detiene, su dirección deja de responder, `rebase cloud
previews` y la consola la muestran como `paused` con el motivo, y se notifica a
los propietarios y administradores del proyecto (`preview.paused`). Sus datos se
conservan hasta que expire. Despliégala de nuevo para iniciarla (se pausará de
nuevo si la base de datos sigue siendo demasiado grande) o elimínala. Una preview
pausada sigue facturándose hasta que se elimine o expire. Elimina las previews
que ya no necesites. Las extensiones instaladas en producción no se instalan en la
base de datos de una preview.

Las previews se están implementando gradualmente. Un plano de control que aún no
las admita rechazará `--preview` con `previews_unavailable` y no desplegará
nada.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que entregó un despliegue exitoso
anterior, y nunca recompila: el valor de un rollback reside en que despliega un
artefacto que ya se ha ejecutado.

Qué despliegues califican depende de cómo se despliegue el proyecto, y ambos
tipos funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto ejecuta actualmente |

Las apps estáticas integradas en el bundle del backend (un `rebase cloud deploy`
simple en un proyecto con backend) forman parte de ese bundle, por lo que se
revierten junto con él.

Una app estática desplegada por su cuenta (`rebase cloud deploy <app>`) todavía no
se puede revertir mediante rollback. Su despliegue registra qué app publicó,
pero no guarda un bundle, por lo que el plano de control no tiene nada a partir
de lo cual restaurarla. La solución es volver a desplegar la última versión
correcta, por ejemplo desde el commit anterior al defectuoso. Tras dicho
despliegue, `deploy` indicará esto en lugar de sugerir `rollback`, y `rollback`
sin un id lo rechazará en vez de redesplegar el backend que está en servicio.

Por tanto, un rollback necesita un despliegue que haya registrado uno de los
dos, lo que significa un proyecto que se haya desplegado con éxito al menos dos
veces. `rebase cloud deployments` marca los que califican, y `--json` informa
`rollbackable` por cada fila junto con la `image` o `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál: uno que no tuvo éxito
y uno anterior a que la plataforma registrara su artefacto. No hay nada que
suponer en ningún caso —suponer implicaría desplegar lo que se haya compilado o
subido más recientemente mientras se afirma restaurar este—, así que despliega la
versión que deseas en su lugar.

Cada despliegue exitoso finaliza indicando la forma de volver atrás (`rebase
cloud rollback`), para tenerlo a la vista en el momento en que se detecte una
versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y
espera a que la versión restaurada esté lista para servir tráfico antes de
informar del éxito. Puedes seguirlo con `rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada se puede recuperar a cualquier minuto dentro de su
ventana de recuperación, desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Se realiza en dos pasos. Primero, se prepara (stage) una copia recuperada junto a
la base de datos en producción; tu app sigue ejecutándose sobre la activa, y el
almacenamiento de la copia se factura hasta que realices la transición (cutover)
o la descartes.
Luego, una vez que la copia está lista, la transición redirige la app hacia ella
y la reinicia. Cualquier dato escrito después de la hora objetivo no estará en
la copia. La base de datos original se conserva como vía de retorno y continúa
facturando almacenamiento; volver a la anterior, eliminarla o realizar una
segunda restauración requiere contactar a soporte. Solo un owner o admin puede
preparar, realizar la transición o descartar, y la consola solicita el nombre
del proyecto antes de ejecutar el cutover.

## Protege tu cuenta

Tu cuenta de la consola puede acceder a bases de datos de producción, secretos y
facturación, así que protégela en consecuencia. Abre **Account security** desde
el menú bajo tu avatar en la consola (o ve a `/account`). La página es tuya, no
de una organización: lo que configures allí se aplica en todas las organizaciones
a las que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de
  autenticación (1Password, Google Authenticator, Authy). La página muestra una
  clave de configuración para agregar a la app, o un enlace que abre la app con
  la clave precargada en un teléfono, y luego solicita el código de 6 dígitos que
  muestra la aplicación. A partir de ese momento, cada inicio de sesión solicitará
  un código, ya sea que inicies sesión con contraseña, Google o GitHub.
- **Códigos de recuperación.** Activarlo te proporciona diez códigos de un solo
  uso, que se muestran una única vez. Cada uno te permite iniciar sesión en
  lugar del código de autenticación si pierdes tu teléfono, así que guárdalos
  antes de cerrar el diálogo. **New recovery codes** los reemplaza y los
  anteriores dejan de funcionar. Desactivar la verificación en dos pasos y
  generar nuevos códigos requieren un código previo en ambos casos.
- **Contraseña.** Cambiarla cerrará la sesión en todos los demás dispositivos.
  Una cuenta creada con Google, GitHub o LinkedIn no tiene contraseña; la página
  ofrece enviarte un enlace por correo para definir una.
- **Dispositivos conectados.** Cada navegador y terminal con sesión iniciada en
  tu cuenta, con su dirección y la fecha y hora de inicio de sesión. Cierra la
  sesión de cualquier dispositivo que no reconozcas o de todos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son
sesiones y no solicitan un segundo factor, por lo que CI continuará desplegando
después de que lo actives. Revoca cualquier token en el que ya no confíes en
**Settings → Access tokens**.

## Invita a tu equipo

**Members → Invite member** genera un enlace para copiar (enviado por correo
cuando este plano de control tiene habilitado el envío) que funciona una sola vez
durante 7 días para una cuenta que haya verificado esa dirección; nadie se unirá
hasta que acepte. Invita a un admin o a un member, y conviértelo en owner una
vez que se haya unido. Los owners y admins pueden ver, reenviar o revocar
invitaciones en **Pending invitations**; desde una terminal, [`rebase cloud orgs
members invite`](/docs/cli/cloud/#organizations).

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los
owners y admins de la organización quién desplegó, definió o reveló una variable
de entorno (por nombre, nunca por valor), cambió un dominio, restauró una copia
de seguridad, redimensionó, detuvo o eliminó un proyecto, modificó el rol de un
miembro o creó un token, y cuándo lo hizo. La sección **Settings** de un proyecto
enlaza a sus propias entradas; las entradas sobre un proyecto eliminado se
conservan. Un script puede leerlas con un token creado con `--can audit` en la
organización. Las entradas se guardan durante un año. Los filtros están
detallados en [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no deberían llevar tu contraseña. Asígnale un token
limitado a unas pocas acciones en un proyecto específico, creado desde una
terminal con sesión iniciada mediante `rebase cloud tokens create --project
shop --can deploy,logs`, y establécelo como `REBASE_TOKEN`. La facturación, el
registro de actividad y la configuración de notificaciones de una organización
son permisos (capabilities) independientes (`--can billing`, `audit`,
`notifications`) que un token posee únicamente si se solicitan explícitamente.
Las capacidades, un flujo de trabajo de GitHub Actions y lo que permanece
reservado para una persona con sesión iniciada se encuentran en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` proporciona a una app un backend activo antes de que
nadie se haya registrado, e imprime una URL de reclamación (claim URL) para que
la persona pueda conservarlo; un proyecto que nadie reclame en 72 horas se
elimina. Lo que puede hacer el token de un proyecto no reclamado, el
`REBASE_API_TOKEN` que escribe y los cambios que implica reclamarlo se detallan
en [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se calcula en función de lo que reserva, no por niveles
(tiers). `compute` muestra cada parámetro de ajuste y la estimación desglosada
del propio plano de control para ellos. (`rebase cloud resources` es algo
diferente: las bases de datos y buckets que declara el código, y si cada uno
está aprovisionado; consulta la [referencia de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, ej. `500m` y `2Gi`. Vacío significa el valor predeterminado de la plataforma: `100m` y `384Mi`, con picos (bursting) de hasta 2 CPU y `2Gi` |
| `--replicas` | Instancias que siempre existen: el mínimo del autoscaler y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar. Las instancias que el autoscaler añade por encima de `--replicas` se miden por pod-segundo a las mismas tarifas, y se cobran únicamente donde la plataforma lo haya activado; **Usage this month** indica en cuáles. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoscaler, respecto a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (preemptible): más económica y sujeta a reinicios sin previo aviso |
| `--db-instances` | 1–3. `1` es una única instancia sin tolerancia a fallos (failover); `2` añade un standby automático |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no es lo mismo que uno fijado al mismo valor: un parámetro
vacío sigue el valor predeterminado de la plataforma y cambiará si este cambia.

La CLI no valida nada a propósito: los límites pertenecen al clúster en el que
se ejecuta un proyecto y varían según el proveedor. El plano de control
rechazará cualquier valor que no pueda satisfacer e indicará el campo
correspondiente. Ejecuta `rebase cloud compute` para ver el costo en €/mes antes
y después; los cambios se aplican de inmediato prorrateados desde hoy, salvo
aquellos que reinicien la base de datos, que esperarán a una ventana de
mantenimiento.

## El resto de comandos

| Grupo de comandos | Qué cubre |
|---|---|
| `login`, `logout`, `whoami` | Tu sesión |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta y un enlace para reclamarlo; `claim` imprime ese enlace nuevamente. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicación y monitorización |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma facture los proyectos detenidos únicamente por el almacenamiento y la tarifa de la plataforma; la fila de **Billing** en la consola lo indica cuando es así |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `cron` | Los cron jobs de la app desplegada y sus ejecuciones registradas, consultados con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, transferida en la reclamación; `rotate` la reemplaza y revoca la anterior. Owners y admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin en la propia API de la app: cuándo se rotó por última vez; `rotate` asigna una nueva a la app. Owners y admins |
| `domains` | Dominios personalizados, registros DNS que deben agregarse y verificación. Un proyecto puede responder en varios, cada uno verificado por separado; `verify` y `remove` reciben el dominio sobre el que actuar, el cual solo puede omitirse cuando hay uno solo (para `verify`, uno todavía pendiente). `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu equipo, copias de seguridad, restauración y recuperación a un punto en el tiempo (point-in-time recovery) |
| `guests` | <span class="since-badge" data-since="0.27">Desde 0.27</span> Los usuarios invitados que dejó el inicio de sesión anónimo: contarlos, eliminar uno, purgar los que no se han visto durante mucho tiempo. Consulta [Guests](/docs/cli/cloud/#guests). Owners y admins |
| `extensions` | La lista de extensiones permitidas (allowlist) de Postgres |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets aloja la plataforma, frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo modificarlo |
| `usage` | Solicitudes utilizadas este mes frente a la cuota incluida, y el exceso acumulado hasta ahora según lo contabiliza la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Solo para administradores de la plataforma (platform-admin) |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, pago |
| `activity` | El registro de auditoría de la organización: quién desplegó, cambió una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Owners y admins. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications`, `webhooks` | Dónde se envían por POST los eventos del proyecto: Slack, Discord o cualquier URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` está retirado y sale con código 1 y el error `command_retired` |

Cada grupo en esa tabla responde a `--help` con una página propia —una línea de
uso, sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Una prueba
comprueba el índice respecto a las páginas, por lo que un grupo añadido sin una
página hace fallar la compilación en lugar de responder con la tabla de
contenidos. `verify:docs` vincula la propia tabla a ese índice: cada grupo que
la CLI despacha aparece aquí exactamente una vez, de modo que un grupo añadido
sin su correspondiente fila también hace fallar la compilación.

Si se canaliza mediante tuberías (pipes), `--help` responde en JSON en su lugar:
la misma línea de uso, flags y ejemplos estructurados para ser leídos en vez de
sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Explicado con claridad, porque enterarse más tarde es peor:

- **Sin elección de región.** Actualmente todo se ejecuta en una sola región.
  El modelo de ubicación (placement) existe en la plataforma, pero un proyecto no
  puede elegir región. `projects create --provider` y `--region` no son la
  excepción que parecen: registran a cuál de los destinos de despliegue
  registrados en el plano de control pertenece un proyecto, y solo hay uno, por
  lo que ambos toman su valor por defecto y ninguno traslada el proyecto a otro
  lugar. `rebase cloud projects create --help` indica lo mismo.
- **No es autoservicio.** El acceso se otorga por lotes; no existe un flujo de
  registro y pago directo.
- **Sin SLA publicado**, ni certificación SOC 2. Si necesitas alguno de ellos,
  indícalo al solicitar acceso en lugar de asumirlo.
- **Sin despliegues por rama (branch deploys)**, ni GitHub App oficial de primera
  parte. Los deploy hooks —URLs secretas a las que apuntas un webhook del
  repositorio— son la automatización soportada. Los [despliegues de preview](#previsualizar-un-cambio)
  se están implementando gradualmente y se inician desde la CLI.
- **Los tokens actúan en representación de una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents)
  es emitido por una cuenta y actúa en su nombre; todavía no existe una identidad
  de máquina perteneciente a la organización. Si inicias sesión desde CI en su
  lugar, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD` desde un gestor de
  secretos —`--password` expone la contraseña en el historial de tu shell y en la
  tabla de procesos, y advierte sobre ello antes de iniciar sesión. Si el
  `.rebase/cloud.json` del repositorio nombra un plano de control distinto al
  propio de la plataforma, pásalo también como `--url`: sin una terminal, `login`
  rechazará enviar una contraseña a un host especificado únicamente en el archivo
  descargado.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no
  está expuesta a internet, por lo que el host que muestra la consola es la
  dirección que usa tu backend para comunicarse con ella y no resuelve a nada en
  tu máquina local. `rebase cloud db connect` abre un puerto local hacia esa
  base de datos, tunelizado a través del plano de control mientras lo mantengas en
  ejecución, pero no existe un hostname permanente al que un servicio de terceros
  pueda conectarse. Tanto ese túnel como la contraseña obtenida con `rebase cloud
  db info --reveal` requieren el rol de owner o admin de la organización: el
  mismo que solicita el editor SQL de Studio, ya que los tres desembocan en una
  sesión sobre tus datos de producción.
- **Desplegar implica ejecutar código con los secretos de producción.** El
  entorno de la app contiene `REBASE_SERVICE_KEY` (admin en su propia API),
  `DATABASE_URL` y `JWT_SECRET`, por lo que el código que despliegue cualquier
  miembro puede leerlos, aunque solo los owners y admins puedan revelarlos en la
  consola. Invita como miembro únicamente a personas a quienes confiarías esos
  valores.
- **La service key puede ser reemplazada.** La sección **Settings** del
  proyecto (o `rebase cloud service-key rotate`) emite una nueva
  `REBASE_SERVICE_KEY` y reinicia la app con ella. La clave antigua funciona
  hasta que el reinicio haya finalizado y queda invalidada después, por lo que
  cualquier elemento que la haya copiado será rechazado a partir de ese momento.
  Reclamar un proyecto realiza la misma operación.

## Autoalojar en su lugar

Nada de esto implica dependencia obligatoria (lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/)
ejecuta la misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) reproduce la misma topología a
partir del chart de Helm.
