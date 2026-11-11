---
sourceHash: de4684f207c4a8fd
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que autoalojarías: la misma
imagen `rebasepro/server` publicada, el mismo bundle, el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Ejecuta tenants reales hoy en día y se abre
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los siguientes comandos requieren una cuenta
a la que se le haya concedido acceso. Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud se compone de tres elementos que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Database** | Un PostgreSQL administrado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Storage** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y cada uno se factura
por lo que reserva en lugar de por usuario (seat).

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que se inicia en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre la consola en tu navegador e imprime un código corto. Comprueba que
la consola muestre el mismo código y aprueba el inicio de sesión allí: la terminal
retoma la sesión y la escribe en `~/.rebase/credentials.json`. Si no has iniciado
sesión en la consola, hazlo primero allí con el método que utilices, incluidos
Google y GitHub. A través de SSH, `rebase cloud login --no-browser` imprime el enlace
para abrirlo en tu propia máquina.

`projects create` no toma argumentos posicionales. El nombre y el subdominio son
flags, y ambos son obligatorios; en una terminal se solicitan de forma interactiva, y
una ejecución headless que omita cualquiera de ellos sale con `input_required` en lugar
de inventar uno. **El subdominio no se puede editar después:** es el host
`<slug>.rebase.website` en el que responde el proyecto, así que elígelo deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay
un paso de `link` por separado. Escribe `.rebase/cloud.json`, que registra el id del
proyecto y el slug. Ese archivo no es un secreto ni contiene tus credenciales; estas
residen en `~/.rebase/credentials.json`, generado por `login`.

Sin embargo, se commitea con el código, por lo que un repositorio clonado puede
nombrar cualquier plano de control. Cuando el host proviene únicamente de ese archivo,
y no es el propio de la plataforma ni uno en el que hayas iniciado sesión previamente,
`login` lo nombra y pregunta antes de enviar tu correo electrónico y contraseña allí.
Sin una terminal, o con `--json`, lo rechaza con `unknown_control_plane`; pasa
`--url <host>` (o define `REBASE_CLOUD_URL`) para iniciar sesión allí a propósito.

Para iniciar sesión sin el navegador, pasa tu correo: `rebase cloud login --email
me@example.com` te pedirá tu contraseña. **¿Te registraste con Google, GitHub o
LinkedIn?** Tu cuenta no tiene contraseña, así que utiliza un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido
durante diez minutos, y lo introduces en el prompt. Con `--email` y sin contraseña,
`rebase cloud login` te pregunta si deseas usar tu contraseña o un código. Los
códigos requieren que el plano de control pueda enviar correos; si no puede hacerlo,
`--code` lo indicará y saldrá con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` te pedirá a continuación el
código de tu aplicación de autenticación o uno de tus códigos de recuperación,
independientemente del método con el que hayas iniciado sesión. A través del navegador,
la consola te lo pide al iniciar sesión allí. Ni un código de inicio de sesión ni un
segundo factor se pueden escribir sin una terminal. Para un script, crea un token de
acceso en la consola (**Settings → Access tokens**) y define `REBASE_TOKEN`; consulta
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde `invalid_credentials` con las mismas dos vías
de acceso, ya que la causa común es una cuenta que nunca tuvo una.

`billing setup` vincula una tarjeta a la organización, una sola vez. Es el primer
paso de la secuencia a propósito: el primer despliegue de un proyecto se rechaza
sin una tarjeta registrada, y darse cuenta de ello tras haber terminado de subir un
bundle es el peor orden posible.

Tras esto, la página **Billing** de la consola lista las facturas de la organización,
cada una con la página alojada de Stripe y su PDF, y muestra una vista previa de la
próxima factura de cada proyecto. `rebase cloud billing invoices` y `rebase cloud
billing upcoming` imprimen lo mismo. Ambos son para propietarios y administradores
de la organización. Donde la plataforma lo ofrezca, **Manage billing** abre el portal
de clientes de Stripe para gestionar la tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no requiere ningún
segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta es
rechazada o el banco requiere confirmar el pago, la consola te redirige a **Billing**,
donde **Fix your card** permite guardar otra tarjeta y **Complete the payment** abre
la factura de Stripe.

El consumo de un proyecto se muestra en su vista general, bajo **Usage this month**,
y para todos los proyectos a la vez en la página **Billing**: solicitudes frente a la
cuota incluida (la barra se vuelve ámbar al 80%), errores 5xx, el exceso acumulado
hasta ahora y la estimación para el mes a este ritmo. El exceso se calcula con el
mismo código que lo reporta a Stripe, por lo que es exactamente lo que incluirá la
factura; aparece en la factura del mes siguiente. `rebase cloud usage` imprime lo mismo,
y `rebase cloud usage org` para toda la organización. Cualquier miembro puede consultarlo.
Las cifras indican lo que aún no pueden medir: el almacenamiento de objetos no se mide,
por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecute dos o más
pods de app, sus solicitudes no se contabilizan; y un día con muestras perdidas subestima
el cómputo. Un proyecto con escalado automático también muestra los pods que ejecutó por
encima de `--replicas`, en pod-horas, su coste según las tarifas correspondientes y si
esta plataforma los factura todavía. Un proyecto reclamado a partir de un agente solo
contabiliza los días transcurridos a partir del reclamo: antes de eso, el proyecto era
de la plataforma.

Un proyecto existente se vincula sin necesidad de crearlo de nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un único comando, sin flags que memorizar. El archivo `rebase.json` de un scaffold
declara `runtime: "managed"` para su backend, y `deploy` lee dicha declaración —lo
indica durante el proceso (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la imagen
de runtime publicada y realiza el seguimiento del despliegue hasta un estado terminal.
El código de salida es el veredicto, por lo que la misma línea funciona desatendida en CI.

Finaliza indicando dónde responde ahora cada app y si la nueva versión está activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que la dirección respondió tras la compilación: el `/health` de un
backend devolvió `ok` y la página de una app estática cargó (desde este despliegue,
cuando la plataforma la sirve). La comprobación espera hasta `--live-timeout` segundos,
60 por defecto; `0` la omite. Si una app no responde a tiempo, el deploy igualmente
finaliza con código cero, ya que el despliegue se completó con éxito, y la última línea
indica qué app no respondió y por qué. Un despliegue fallido termina en una sola línea,
nombrando la app y el motivo, permitiendo usar `rebase cloud logs` para consultar el
registro de compilación completo.

Los scripts pueden pasar `--json` para recibir un único objeto con la misma información:
`apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia
del resto de `rebase cloud`, `deploy` no conmuta a JSON por sí solo cuando se usa en un pipe.

Lo que permite ese runtime —paquetes y módulos nativos, memoria e instancias, tiempos
de espera y tamaños de payload, sistema de archivos, secretos, almacenamiento y red
saliente— está detallado en su propia página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para enviar un artefacto compilado previamente —por ejemplo, un trabajo de CI que
compila una sola vez y despliega dos—, apunta directamente al directorio en lugar de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime administrado requiere su propio flag, `--eject`, y nada más lo
solicitará: una compilación que trasladaría un proyecto administrado a una imagen de
contenedor propia se rechaza a menos que lo autorices explícitamente. `--force` solía
significar esto, lo que agrupaba la acción menos reversible que puede realizar la CLI
bajo la misma palabra que "sobrescribir este archivo"; ahora es una opción desconocida
en lugar de un alias, por lo que cualquier script que la incluya se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven tal como están. Cuando su comando `build`
únicamente copia scripts hechos a mano hacia `output`, nada los ha analizado sintácticamente,
por lo que un archivo con un error tipográfico podría publicarse e impedir la carga de la página.
Por tanto, antes de subir nada, `deploy` analiza cada archivo `.js`, `.mjs` y `.cjs` en
el `output` de cada app estática, junto con cada etiqueta `<script>` inline en sus archivos
`.html`. Esto abarca tanto una app estática desplegada individualmente como las apps estáticas
integradas en el bundle del backend. Un error de sintaxis detiene el despliegue señalando
el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Los scripts inline que un navegador
no ejecuta como JavaScript se omiten: JSON, mapas de importación (import maps), plantillas
y cualquier otro `type` distinto de JavaScript, un `<script src>`, o un script que aún
conserve sintaxis de plantillas sin renderizar como `{{ }}`. Un archivo `.js` pasa la
validación si se analiza correctamente como script clásico o como módulo, ya que la página
decide cuál es. No se lee nada dentro de `node_modules`, ni tampoco un `--bundle-dir`
precompilado. `--no-verify` omite esta verificación para un despliegue puntual.

Monitorización:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la plataforma
está trabajando legítimamente y consultar periódicamente (polling) es lo adecuado; cuando
menciona algún elemento, ese elemento está esperando por ti.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que haría `deploy`, pero lo sirve en una
dirección propia, como `https://shop--k3x9ab.rebase.website`. El entorno de producción
sigue sirviendo lo que servía antes. El despliegue imprime la dirección de la preview
cuando la compilación finaliza.

Para conservar una misma dirección a lo largo de varios despliegues, asigna un nombre
a la preview. Desplegar indicando el mismo nombre la actualizará:

```bash
rebase cloud deploy --preview-name new-checkout
```

El destino de comunicación de una preview depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps estáticas
  integradas, del mismo modo en que se ejecutan en producción. Obtiene un backend propio
  en una **base de datos vacía propia**, nunca en la de producción. Iniciar contra la
  base de datos de producción le aplicaría el esquema y las reglas de acceso de la preview.
- **`rebase cloud deploy web --preview`** previsualizaría una sola app estática por separado,
  cuyas páginas se comunicarían con el backend de **producción**. Eso requiere un plano
  de control capaz de servir sitios estáticos por sí mismos, algo que Rebase Cloud aún
  no hace: lo rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Previsualiza el
  backend en su lugar, el cual sirve las apps estáticas integradas en él; un proyecto
  sin backend administrado no se puede previsualizar por ahora.

Una preview no sube código fuente ni registra apps o nombres de host, ya que cualquiera
de esas acciones alteraría el proyecto de producción. `--source` y `--eject` no se pueden
combinar con `--preview`, ya que ambos generan una imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sin `--preview` siempre corresponde a producción.

La página **Deployments** de la consola lista las mismas previews, permitiendo abrir,
consultar el registro de compilación o eliminar cualquiera de ellas. Su creación sigue
siendo un paso exclusivo de la CLI.

Una preview expira una semana después del último despliegue que recibió.

Al terminar, el despliegue comprueba que la dirección de la preview responda, igual que
en un despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). La emisión
del certificado de una preview nueva puede demorarse uno o dos minutos, por lo que un
despliegue exitoso puede llegar a indicar que la dirección aún no responde.

Una preview de backend se factura como una unidad de app en el tamaño por defecto
(100m de CPU y 384 MiB de memoria, a la tarifa de tu app para su región y capacidad),
prorrateada durante el tiempo que exista, y se refleja en la estimación mensual del
proyecto en la consola. `rebase cloud deploy --preview` imprime la misma estimación
para ella, por mes (`cost` bajo `--json`). Iniciar una requiere una tarjeta registrada,
al igual que un despliegue de producción. Un primer despliegue que falle antes de que
nada llegue a ejecutarse se elimina en lugar de facturarse. Un proyecto puede ejecutar
hasta tres previews de backend de forma simultánea.

Cada nueva dirección de preview recibe su propio certificado TLS de Let's Encrypt,
autoridad que concede a un dominio 50 nuevos certificados por semana, compartidos con
todos los sitios de producción del mismo. Las previews pueden consumir hasta 20 de ellos
en cualquier período de 7 días, en toda la plataforma. Superado este límite, se rechazará
una nueva preview (`429`, `preview_cert_budget`) indicando cuándo podrá desplegarse;
redesplegar una preview existente nunca computa para este límite.

La base de datos de una preview de backend es una segunda base de datos en el Postgres
de **producción**: contiene sus propios datos, pero en la misma instancia y en el mismo
disco. Está limitada a 10 conexiones simultáneas (para no agotar las de producción) y
a 2 GB de tamaño: una preview cuya base de datos supere ese límite se pausa. Su backend
se detiene, su dirección deja de responder, `rebase cloud previews` y la consola la muestran
como `paused` junto al motivo, y se notifica a los propietarios y administradores del
proyecto (`preview.paused`). Sus datos se conservan hasta que expire. Despliégala de nuevo
para arrancarla (se pausará nuevamente si la base de datos sigue excediendo el límite), o
elimínala. Una preview pausada continúa facturándose hasta que sea eliminada o expire.
Elimina las previews que ya no necesites. Las extensiones instaladas en producción no se
instalan en la base de datos de una preview.

Las previews se están desplegando de forma progresiva. Un plano de control que aún no
las soporte rechazará `--preview` con `previews_unavailable` y no desplegará nada.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto al artefacto que entregó un despliegue
exitoso previo, sin volver a compilar jamás: el valor de un rollback reside en
publicar un artefacto que ya ha demostrado funcionar.

Los despliegues que califican dependen de la modalidad de despliegue del proyecto,
siendo válidas ambas:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde fuente) | La imagen publicada por esa compilación |
| `rebase cloud deploy --bundle` (runtime de la plataforma) | El bundle entregado por ese despliegue, sobre la versión de runtime que el proyecto ejecuta actualmente |

Las apps estáticas integradas en el bundle del backend (un simple `rebase cloud deploy`
en un proyecto con backend) forman parte de dicho bundle, por lo que se revierten junto a él.

Una app estática desplegada por separado (`rebase cloud deploy <app>`) todavía no
admite rollback. Su despliegue registra qué app se publicó, pero ningún bundle, por lo
que el plano de control no tiene nada a partir de lo cual restaurarla. La solución consiste
en desplegar de nuevo la última versión estable, por ejemplo desde el commit previo al
problemático. Tras un despliegue de este tipo, `deploy` indicará esto en lugar de sugerir
`rollback`, y un `rollback` sin id explícito se rechazará en lugar de redesplegar el
backend en servicio.

Por consiguiente, un rollback requiere un despliegue previo que haya registrado alguna
de las dos opciones, lo que implica que el proyecto debe haberse desplegado con éxito al
menos dos veces. `rebase cloud deployments` resalta los que califican, y `--json` reporta
`rollbackable` por cada fila junto con la `image` o el `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI especifica cuál: uno que no haya sido
exitoso, y uno anterior al momento en que la plataforma comenzó a registrar artefactos.
No hay nada que asumir en ninguno de los dos casos —hacer suposiciones enviaría lo que
se haya compilado o subido más recientemente fingiendo restaurar este—; despliega en su
lugar la versión exacta que deseas.

Cada despliegue exitoso concluye indicando el comando de retorno (`rebase cloud rollback`),
garantizando que esté a la vista en el instante en que se detecte una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de reescribir la historia, y espera a
que la versión restaurada esté sirviendo tráfico antes de confirmar el éxito. Puedes
seguirlo con `rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos administrada puede restaurarse a cualquier minuto dentro de su ventana
de recuperación, desde **Database → Backups** en la consola o mediante la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Consta de dos fases. Primero, se prepara (stage) una copia recuperada en paralelo a la
base de datos activa; tu app continúa ejecutándose sobre la activa, y el almacenamiento
de la copia se factura hasta que realices el cambio definitivo (cutover) o la descartes.
Posteriormente, cuando la copia esté lista, ejecutar cutover redirige la app a esta y
la reinicia. Todo dato escrito con posterioridad al momento objetivo no estará en la copia.
La base de datos original se conserva como mecanismo de retorno y continúa facturando
almacenamiento; volver a ella, eliminarla o efectuar una segunda restauración requiere
contactar a soporte. Solo un propietario o administrador puede preparar, ejecutar el
cutover o descartar, y la consola solicitará el nombre del proyecto antes de aplicar el cutover.

## Proteger tu cuenta

Tu cuenta de la consola tiene acceso a bases de datos de producción, secretos y facturación,
por lo que debes protegerla en consecuencia. Abre **Account security** desde el menú
bajo tu avatar en la consola (o navega a `/account`). La página es de carácter personal,
no de una organización: lo que configures allí aplica a todas las organizaciones a las
que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación
  (1Password, Google Authenticator, Authy). La página muestra una clave de configuración
  para introducir en la app, o un enlace que la abre con la clave preconfigurada en un
  teléfono, pidiéndote después el código de 6 dígitos generado por la app. A partir de
  entonces, cada inicio de sesión exigirá un código, ya sea que accedas mediante contraseña,
  Google o GitHub.
- **Códigos de recuperación.** Activarlo genera diez códigos de un solo uso, mostrados
  una única vez. Cada uno permite iniciar sesión en sustitución del código del autenticador
  si extravías tu teléfono; guárdalos antes de cerrar el diálogo. **New recovery codes**
  los invalida y genera nuevos. Desactivar la verificación en dos pasos y solicitar nuevos
  códigos requiere introducir un código previo en ambos casos.
- **Contraseña.** Modificarla cierra la sesión en todos los demás dispositivos. Una
  cuenta creada mediante Google, GitHub o LinkedIn carece de contraseña; la página te
  permite solicitar un enlace por correo para definir una.
- **Dispositivos con sesión iniciada.** Muestra cada navegador y terminal autenticados
  en tu cuenta, junto con su dirección y fecha de acceso. Cierra la sesión de cualquier
  dispositivo no reconocido, o de todos simultáneamente.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y
no solicitan un segundo factor, garantizando que el CI continúe desplegando tras activar
la protección. Revoca cualquier token que ya no consideres seguro en **Settings → Access tokens**.

## Invitar a tu equipo

**Members → Invite member** genera un enlace para copiar (enviado por correo cuando este
plano de control tiene el servicio de correo habilitado) de un solo uso y válido por 7 días,
destinado a una cuenta que haya verificado dicha dirección; nadie se incorpora hasta haberlo
aceptado. Invita a un administrador o miembro, pudiendo ascenderlo a propietario tras su
ingreso. Los propietarios y administradores pueden consultarlo, reenviarlo o revocarlo en
**Pending invitations**; desde una terminal, mediante [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Ver quién hizo qué

La página **Activity** de la consola y el comando `rebase cloud activity` muestran a los
propietarios y administradores de la organización quién desplegó, definió o reveló una
variable de entorno (por su nombre, nunca su valor), cambió un dominio, restauró una copia
de seguridad, redimensionó, detuvo o eliminó un proyecto, modificó el rol de un miembro
o creó un token, indicando el momento exacto. La sección **Settings** de un proyecto enlaza
a sus propios registros; las entradas relativas a un proyecto eliminado permanecen accesibles.
Un script puede consultar esta información mediante un token generado con `--can audit`
en la organización. Los registros se conservan durante un año. Los filtros disponibles
se detallan en [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no debe contener tu contraseña personal. Proporciónale un
token restringido a un conjunto acotado de acciones sobre un proyecto específico,
creado desde una terminal autenticada mediante `rebase cloud tokens create --project shop --can deploy,logs`,
y configúralo como `REBASE_TOKEN`. La facturación, el registro de actividad y las alertas
de una organización constituyen permisos independientes (`--can billing`, `audit`,
`notifications`) que un token solo incorpora si se solicitan explícitamente. La relación
de permisos, un flujo de trabajo para GitHub Actions y los privilegios que quedan reservados
a usuarios autenticados se describen en [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` dota a una aplicación de un backend activo antes de que nadie
se haya registrado, e imprime una URL de reclamo para que el usuario tome posesión del mismo;
cualquier proyecto no reclamado en un plazo de 72 horas es eliminado. Los permisos del
token de un proyecto sin reclamar, el `REBASE_API_TOKEN` que genera y las implicaciones
del proceso de reclamo se documentan en [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se determina en función de los recursos que reserva, no de planes
fijos (tiers). `compute` lista cada parámetro de configuración junto con el presupuesto
desglosado que el propio plano de control calcula para ellos. (`rebase cloud resources`
cumple una función distinta: enumera las bases de datos y buckets declarados en el código,
e indica si están aprovisionados; consulta la [referencia de la CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, ej. `500m` y `2Gi`. Dejarlo vacío adopta el valor por defecto de la plataforma: `100m` y `384Mi`, con capacidad de ráfaga (burst) de hasta 2 CPU y `2Gi` |
| `--replicas` | Instancias fijas permanentes: el suelo del autoescalador y la base mensual facturada en la suscripción del proyecto |
| `--autoscale-max` | 1–16. Límite superior alcanzable. Las instancias añadidas por el autoescalador sobre `--replicas` se miden por pod-segundo a las mismas tarifas, y se facturan únicamente donde la plataforma tenga activada dicha opción; **Usage this month** especifica el estado. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. Nivel de uso de CPU que el autoescalador procura mantener, medido respecto a la solicitud (request) y no al límite. Dejarlo vacío establece 70 |
| `--spot` | `true` o `false`. Capacidad preemptible (spot): más económica, sujeta a reinicios sin previo aviso |
| `--db-instances` | 1–3. `1` corresponde a una instancia única sin tolerancia a fallos; `2` incorpora una réplica standby automática |
| `--db-cpu`, `--db-memory` | Por cada instancia de base de datos. Dejarlo vacío establece `160m` y `1Gi` |

Un parámetro vacío no equivale a fijarlo manualmente al mismo valor: un parámetro vacío
hereda el estándar de la plataforma y se actualizará automáticamente si este cambia.

La CLI no realiza validaciones de forma deliberada: los límites dependen del clúster
en el que reside el proyecto y varían según el proveedor. El plano de control rechazará
cualquier valor inadmisible especificando el campo afectado. Ejecuta `rebase cloud compute`
para visualizar los €/mes antes y después del cambio; las modificaciones se aplican al
instante con prorrateo desde la fecha actual, a excepción de las que demanden reiniciar
la base de datos, las cuales aguardan a una ventana de mantenimiento.

## El resto de la superficie

| Grupo de comandos | Qué abarca |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el bearer token que la CLI enviaría en ese momento, útil para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, acotados a un proyecto individual. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vinculación del directorio actual a un proyecto, selección de organización y apertura de la consola |
| `connect` | Vinculación de un servidor Rebase autoalojado a tu cuenta, permitiendo que el [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude acceda a él junto a tus proyectos de Cloud. `--list` los lista, `--remove` desvincula uno. Propietarios y administradores |
| `init`, `claim` | Con `--claim`: aprovisiona un backend activo sin cuenta y genera un enlace para reclamarlo; `claim` reimprime dicho enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar y eliminar proyectos |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitorización |
| `previews` | Compilaciones publicadas en direcciones independientes mediante `deploy --preview`, y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido conserva su suscripción, salvo que la plataforma facture proyectos pausados únicamente por almacenamiento y cuota base; la fila **Billing** de la consola lo especifica en tales casos |
| `status`, `metrics`, `debug` | Estado operativo del proyecto y diagnóstico de fallos |
| `cron` | Tareas programadas (cron jobs) de la app desplegada y su histórico de ejecuciones, leídos con tu sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca expone valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` registró en `.env` bajo `REBASE_API_TOKEN`, transferida al completarse el reclamo; `rotate` la sustituye invalidando la anterior. Propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegios de administración sobre la API propia de la app: fecha de última rotación; `rotate` expide una nueva para la app. Propietarios y administradores |
| `domains` | Dominios personalizados, registros DNS requeridos y su validación. Un proyecto puede operar bajo múltiples dominios, verificados de forma independiente; `verify` y `remove` aceptan el dominio objetivo, el cual solo puede omitirse si existe uno solo (en `verify`, uno aún pendiente). `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Vincular o crear bases de datos, conexión remota desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo (PITR) |
| `guests` | Usuarios invitados generados por accesos anónimos: recuento, eliminación puntual y purga por inactividad prolongada. Consulta [Guests](/docs/cli/cloud/#guests). Propietarios y administradores |
| `extensions` | Lista de extensiones de Postgres permitidas |
| `storage` | El bucket de almacenamiento del proyecto |
| `resources` | Relación de bases de datos y buckets gestionados por la plataforma frente a lo declarado en el código |
| `compute` | Asignación de recursos del proyecto, costes asociados y su modificación |
| `events` | Historial cronológico inverso de eventos del backend: escalado de la app, modificaciones programadas y aplicadas en la base de datos, activación de réplicas standby o ampliaciones de disco |
| `usage` | Peticiones consumidas en el mes en curso frente a la cuota base y exceso acumulado, coincidiendo con el cómputo de facturación. `usage org` lista todos los proyectos de la organización |
| `clusters` | Clústeres sobre los que operan los tenants. Exclusivo para administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, gestión de organizaciones, miembros, invitaciones y pagos |
| `activity` | Registro de auditoría organizativo: autoría y fecha de despliegues, modificaciones de variables de entorno (por nombre), dominios, copias de seguridad, miembros o tokens. Propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications`, `webhooks` | Destinos de notificación vía POST de eventos del proyecto: Slack, Discord o cualquier URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` ha quedado obsoleto y finaliza con código 1 y error `command_retired` |

Todos los grupos de la tabla admiten `--help` devolviendo una página informativa
independiente —con sintaxis de uso, flags y ejemplos—, garantizando que `--help`
nunca ejecute la acción. Un test automatizado valida el índice de estas páginas,
de modo que cualquier grupo añadido sin documentación interrumpe la compilación.
`verify:docs` comprueba la tabla frente a dicho índice: cada comando soportado por
la CLI debe figurar en esta sección exactamente una vez, o la compilación fallará.

En pipes, `--help` entrega la respuesta formateada en JSON: la misma estructura de
sintaxis, flags y ejemplos en un formato procesable, prescindiendo de secuencias
de escape de terminal.

## Qué no incluye la beta

Detallado explícitamente, para prevenir sorpresas:

- **Sin selección de región.** Todo opera en una única región en la actualidad.
  Aunque la plataforma cuenta con el modelo interno de ubicación, los proyectos no
  pueden elegir región. Los flags `projects create --provider` y `--region` no son
  una excepción real: definen a cuál de los entornos de despliegue registrados pertenece
  el proyecto, y al haber uno solo, toman ese valor por defecto sin capacidad de reubicarlo.
  `rebase cloud projects create --help` expone esta misma advertencia.
- **Sin autoservicio abierto.** El acceso se aprueba por fases escalonadas; no existe
  un alta directa con pago inmediato.
- **Sin SLA público**, ni certificación SOC 2. En caso de requerir cualquiera de ellos,
  hazlo saber al formular tu solicitud de acceso.
- **Sin despliegues por rama**, ni aplicación oficial integrada de GitHub. La automatización
  disponible se basa en deploy hooks —URLs protegidas configurables como webhooks en el repositorio—.
  Las [previews de despliegue](#previsualizar-un-cambio) se encuentran en fase de despliegue
  gradual y se gestionan desde la CLI.
- **Los tokens asumen identidad de usuario.** Todo [token](/docs/deployment/cloud-agents/#ci-and-agents)
  emana de una cuenta concreta y actúa en su nombre; aún no existen identidades de servicio
  (machine identities) pertenecientes a organizaciones. Si te autenticas desde CI mediante
  credenciales, suministra `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD` desde un gestor de
  secretos; `--password` deja rastro en el historial del shell y en la tabla de procesos,
  lo cual la CLI advertirá antes de validar la sesión. Si el archivo `.rebase/cloud.json`
  del repositorio indica un plano de control ajeno al oficial, especifícalo también con
  `--url`: en ejecuciones sin terminal interactiva, `login` denegará remitir contraseñas a
  hosts definidos exclusivamente en archivos versionados.
- **Sin endpoint público a la base de datos.** Las bases de datos administradas carecen
  de exposición directa a internet, por lo que el host mostrado en consola representa la
  dirección interna accesible por tu backend y no resolverá en tu equipo local. `rebase cloud db connect`
  habilita un puerto local puenteado hacia la base de datos mediante un túnel a través del
  plano de control mientras mantengas el comando en ejecución; no existe, sin embargo, un
  nombre de host permanente apto para herramientas externas. Dicho túnel, junto con la
  contraseña expuesta por `rebase cloud db info --reveal`, exigen privilegios de propietario
  o administrador en la organización: el mismo nivel requerido por el editor SQL de Studio,
  al tratarse en los tres casos de sesiones directas sobre datos de producción.
- **Desplegar supone ejecutar código con los secretos de producción.** Las variables de
  entorno de la aplicación incluyen `REBASE_SERVICE_KEY` (control administrativo total
  sobre su API), `DATABASE_URL` y `JWT_SECRET`; por ende, el código que cualquier miembro
  despliegue tiene visibilidad sobre ellas, aun cuando solo propietarios y administradores
  puedan revelarlas en consola. Limita el rol de miembro a personas plenamente autorizadas
  a conocer dichos valores.
- **La clave de servicio puede reemplazarse.** Desde **Settings** en el proyecto
  (o con `rebase cloud service-key rotate`) es posible emitir una nueva `REBASE_SERVICE_KEY`,
  reiniciando la aplicación con ella. La clave previa permanece válida únicamente hasta
  completar el reinicio, quedando invalidada de inmediato a partir de ese momento. Reclamar
  un proyecto ejecuta esta misma rotación.

## Autoalojamiento como alternativa

Ninguna característica impone un bloqueo de proveedor (lock-in). La
[guía de autoalojamiento](/docs/deployment/self-hosting/) permite ejecutar exactamente
la misma imagen y bundle haciendo uso de `docker compose`, mientras que la
[guía de Kubernetes](/docs/deployment/kubernetes/) reproduce la misma arquitectura
mediante el Helm chart.
