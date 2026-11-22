---
sourceHash: daa75b0f6ab9dbdf
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que autoalojarías: la misma
imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia es quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Hoy en día ejecuta inquilinos (tenants) reales y abre el acceso
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta a la que se le haya concedido acceso.
Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no la compilación de un contenedor |
| **Database** | Un PostgreSQL gestionado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Storage** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

La aplicación y la base de datos se aprovisionan cuando despliegas por primera vez; un bucket,
solo cuando lo pides ([Almacenamiento de archivos](#almacenamiento-de-archivos)). Cada uno se factura por lo que
reserva en lugar de por usuario (seat).

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio
se autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
genera un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre la consola en tu navegador e imprime un código corto. Comprueba que
la consola muestre el mismo código y aprueba el inicio de sesión allí: la terminal
recoge la sesión y la escribe en `~/.rebase/credentials.json`. Si no has
iniciado sesión en la consola, hazlo primero allí con lo que utilices, incluidos Google
y GitHub. Mediante SSH, `rebase cloud login --no-browser` imprime el enlace
para abrirlo en tu propia máquina.

`projects create` no toma ningún argumento posicional. El nombre y el subdominio son
flags, y ambos son obligatorios; en una terminal se solicitan interactivamente, y una
ejecución no interactiva (headless) que omita cualquiera de ellos finaliza con `input_required` en lugar de inventar
uno. **El subdominio no se puede editar posteriormente:** es el
host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un
paso de `link` por separado. Escribe `.rebase/cloud.json`, que registra el id y el slug del
proyecto. Ese archivo no es un secreto ni contiene tus credenciales; estas residen
en `~/.rebase/credentials.json`, escritas por `login`.

Sin embargo, se commitea con el código, por lo que un repositorio clonado puede nombrar cualquier
plano de control (control plane). Cuando el host proviene únicamente de ese archivo y no es
el propio de la plataforma ni uno en el que hayas iniciado sesión anteriormente, `login` lo menciona y te pide
confirmación antes de enviar tu correo y contraseña allí. Sin una terminal, o con
`--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí intencionalmente.

Para iniciar sesión sin el navegador, proporciona tu correo electrónico: `rebase cloud login --email
me@example.com` solicita tu contraseña. **¿Te registraste con Google, GitHub o
LinkedIn?** Tu cuenta no tiene contraseña, así que utiliza un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido durante diez minutos, y lo introduces
en el prompt. Con `--email` y sin contraseña, `rebase cloud login` pregunta
si deseas usar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar
correos electrónicos; si no puede, `--code` lo indica y finaliza con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` te pedirá el código de
tu aplicación de autenticación o uno de tus códigos de recuperación, independientemente de cómo hayas iniciado
sesión. A través del navegador, la consola lo solicita cuando inicias sesión allí. Ni un código de inicio de sesión ni un segundo factor se pueden ingresar sin una terminal.
Para un script, crea un token de acceso en la consola (**Settings → Access
tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde con `invalid_credentials` mostrando las mismas dos formas de acceso, ya
que la causa habitual es una cuenta que nunca tuvo una.

`billing setup` asocia una tarjeta a la organización, una sola vez. Es el primero
en la secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una, y
enterarse de eso después de que el bundle haya terminado de subirse es el peor escenario.

Después de eso, la página **Billing** de la consola lista las facturas de la organización,
cada una con la página alojada en Stripe y el PDF, y previsualiza la próxima factura de cada
proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming`
imprimen lo mismo. Ambos son para los propietarios (owners) y administradores (admins) de la organización. Donde la
plataforma lo ofrezca, **Manage billing** abre el portal de clientes de Stripe para
la tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no requiere
un segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta
es rechazada o el banco solicita confirmación del pago, la consola te redirige a
**Billing**, donde **Fix your card** guarda otra tarjeta y **Complete the
payment** abre la factura de Stripe.

Lo que ha consumido un proyecto se muestra en su vista general, bajo **Usage this month**, y
para todos los proyectos a la vez en la página **Billing**: solicitudes frente a la
cuota incluida (la barra se vuelve ámbar al 80%), errores 5xx, el exceso (overage) acumulado
y la proyección para el mes a este ritmo. El exceso se calcula con el
mismo código que lo reporta a Stripe, por lo que es exactamente lo que reflejará la factura;
aparece en la factura del mes siguiente. `rebase cloud usage` imprime lo
mismo, y `rebase cloud usage org` lo muestra para toda la organización. Cualquier miembro puede consultarlo.
Las cifras indican lo que aún no pueden medir: el almacenamiento de objetos no se mide,
por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecute dos o más pods de app,
sus solicitudes no se contabilizan; y un día con muestras perdidas subestima el cómputo. Un
proyecto autoescalado también muestra los pods que ejecutó por encima de `--replicas`, en pod-horas,
cuánto cuestan según sus propias tarifas y si esta plataforma los cobra ya. Un
proyecto reclamado desde un agente cuenta solo los días a partir de la reclamación: antes
de eso, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crear uno nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando y ningún flag que recordar. El `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo
indica durante el proceso (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la aplicación en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta un estado terminal. El código de
salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Termina indicando dónde responde ahora cada aplicación y si la nueva versión está
activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que la dirección respondió después de la compilación: el `/health` de un backend
devolvió `ok` y la página de una app estática se cargó (desde este despliegue, cuando
la plataforma la sirve). La comprobación espera hasta `--live-timeout` segundos, 60 de
forma predeterminada; `0` la omite. Si una app no responde a tiempo, el despliegue igualmente finaliza con
código cero porque el despliegue fue exitoso, y la última línea indica qué app no
respondió y por qué. En cambio, un despliegue fallido termina en una sola línea indicando la app y la
razón, con `rebase cloud logs` para ver el registro completo de la compilación.

Los scripts pueden pasar `--json` para obtener un único objeto con los mismos datos: `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de
`rebase cloud`, `deploy` no cambia a JSON automáticamente cuando se usa en un pipe.

Lo que permite ese runtime —paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños de cuerpo, el sistema de archivos, secretos, almacenamiento y red
de salida— se encuentra en su propia página:
[Runtime de backend gestionado](/docs/deployment/managed-runtime/).

Para enviar un artefacto compilado previamente —por ejemplo, un trabajo de CI que compila una vez y
despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Salir del runtime gestionado tiene su propio flag, `--eject`, y nada más lo
solicita: una compilación que trasladaría un proyecto gestionado a una imagen de contenedor que luego pasa
a ser de su propiedad se rechaza hasta que lo indiques explícitamente. Antes se usaba `--force` para esto, lo que colocaba
la acción menos reversible de la CLI bajo la misma palabra que "sobrescribir este
archivo"; ahora es una opción desconocida en lugar de un alias, por lo que cualquier script que la incluya
se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente tal como son. Cuando su `build` solo
copia scripts escritos a mano en `output`, nada los ha analizado, y un archivo
con un error tipográfico pasa a producción e impide que la página se cargue. Por lo tanto, antes de subir
nada, `deploy` analiza cada archivo `.js`, `.mjs` y `.cjs` en el `output` de cada app
estática, junto con cada `<script>` inline en sus archivos `.html`. Esto
cubre tanto una app estática desplegada por separado como apps estáticas integradas en el
bundle del backend. Un error de sintaxis detiene el despliegue mostrando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Los scripts inline que un navegador
no ejecuta como JavaScript se omiten: JSON, import maps, plantillas y cualquier
otro `type` que no sea JavaScript, etiquetas `<script src>`, y scripts que aún contengan
marcado de plantilla sin renderizar como `{{ }}`. Un archivo `.js` pasa la validación si se analiza correctamente
como script clásico o como módulo, ya que la página decide cuál es. No se lee
nada dentro de `node_modules`, ni tampoco un `--bundle-dir` precompilado.
`--no-verify` omite la comprobación para un despliegue.

Monitorízalo:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` informa `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando genuinamente y consultar periódicamente (polling) es lo adecuado; cuando
indica algo, ese algo te está esperando a ti.

Uno de ellos es `email_not_configured`: la aplicación activó el inicio de sesión por enlace mágico o por
código de correo (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) y no cuenta con un servicio de correo electrónico, por lo que
el despliegue está activo pero nadie puede iniciar sesión. Rebase Cloud no envía
correos para tu app: configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y
`SMTP_FROM` con `rebase cloud env set`, y luego despliega. `status` lo lee desde el
`GET /api/auth/config` de la propia aplicación (su campo `unavailable`), y `deploy` muestra
lo mismo bajo su comprobación de disponibilidad (live check).

## Almacenamiento de archivos

Un proyecto nuevo no tiene bucket: las subidas se rechazan con `501 STORAGE_NOT_CONFIGURED`,
y el resumen del despliegue lo dice, en lugar de escribirse en un disco que cada despliegue reemplaza.

Dale uno de los dos tipos y vuelve a desplegar para que la aplicación lo use:

```bash
# Un bucket que Rebase gestiona por ti. La página Storage de la consola hace lo mismo.
rebase cloud storage create

# O tu propio bucket compatible con S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omítelo para AWS; añade --force-path-style para MinIO

rebase cloud deploy
```

`rebase cloud storage` lista los buckets del proyecto. Un proyecto con varios
adjunta cada uno con `--source <key>`; uno que configura el almacenamiento en código no necesita ninguno.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que haría `deploy`, pero lo sirve en una dirección
propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa
sirviendo lo que servía antes. El despliegue imprime la dirección de la previsualización cuando
finaliza la compilación.

Para mantener una misma dirección entre despliegues, asigna un nombre a la previsualización. Desplegar de nuevo
con el mismo nombre la actualizará:

```bash
rebase cloud deploy --preview-name new-checkout
```

A qué se conecta una previsualización depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps estáticas
  integradas, del mismo modo en que las ejecuta producción. Obtiene un backend propio en
  una **base de datos vacía propia**, nunca la de producción. Arrancar contra
  la base de datos de producción aplicaría el esquema y las reglas de acceso de la previsualización sobre ella.
- **`rebase cloud deploy web --preview`** previsualizaría una sola app estática por
  su cuenta, haciendo que sus páginas llamen al backend de **producción**. Eso requiere un plano de control
  que sirva sitios estáticos por sí mismos, y Rebase Cloud aún no lo hace:
  rechaza la petición con `PREVIEW_STATIC_UNSERVED` y no publica nada. En su lugar, previsualiza
  el backend, que sirve las apps estáticas integradas en él; un proyecto
  sin backend gestionado aún no se puede previsualizar.

Una previsualización no sube código fuente ni registra apps o nombres de host, ya que cualquiera de
esas acciones alteraría el proyecto de producción. `--source` y `--eject` no se pueden
combinar con `--preview`. Cada uno de ellos compila una imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sin `--preview` siempre corresponde a producción.

La página **Deployments** de la consola lista las mismas previsualizaciones, y permite abrir, ver el
registro de compilación o eliminar cada una. Crearlas sigue siendo un paso exclusivo de la CLI.

Una previsualización caduca una semana después de su último despliegue.

Al finalizar, el despliegue comprueba que la dirección de la previsualización responda, al igual que un
despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). El certificado de una nueva
previsualización puede tardar uno o dos minutos, por lo que un despliegue exitoso puede
indicar que la dirección aún no responde.

Una previsualización de backend se factura como una unidad de app con el tamaño predeterminado (100m de CPU
y 384 MiB de memoria, a la tarifa de tu app para su región y capacidad),
prorrateada durante el tiempo que exista, y aparece en la estimación mensual
del proyecto en la consola. `rebase cloud deploy --preview` imprime la misma estimación mensual
(`cost` bajo `--json`). Iniciar una requiere una tarjeta registrada, al igual que un despliegue
de producción. Un primer despliegue que
falle antes de que se ejecute nada se elimina en lugar de facturarse. Un proyecto puede ejecutar hasta
tres previsualizaciones de backend simultáneamente.

Cada nueva dirección de previsualización obtiene su propio certificado TLS de Let's Encrypt,
que permite a un dominio 50 certificados nuevos por semana, compartidos con todos los sitios de producción en él.
Las previsualizaciones pueden consumir 20 de ellos en cualquier período de 7 días, en toda la plataforma. Superado
ese límite, se rechaza una nueva previsualización (`429`, `preview_cert_budget`) indicando cuándo se podrá
desplegar; redesplegar una previsualización existente nunca cuenta para este límite.

La base de datos de una previsualización de backend es una segunda base de datos en el Postgres de **producción**:
sus propios datos, pero la misma instancia y el mismo disco. Está limitada a 10
conexiones, para que las previsualizaciones no agoten las de producción, y a 2 GB: una previsualización
cuya base de datos supere ese tamaño se pausa. Su backend se detiene, su dirección deja de
responder, `rebase cloud previews` y la consola la muestran como `paused` con el
motivo, y se notifica a los owners y admins del proyecto (`preview.paused`).
Sus datos se conservan hasta que caduque. Despliégala de nuevo para iniciarla (volverá a pausarse
si la base de datos sigue siendo demasiado grande) o elimínala. Una previsualización pausada se sigue
facturando hasta que se elimine o caduque. Elimina las previsualizaciones que ya no necesites. Las extensiones
instaladas en producción no se instalan en la base de datos de una previsualización.

Las previsualizaciones se están implementando gradualmente. Un plano de control que aún no las admita rechazará
`--preview` con `previews_unavailable` y no desplegará nada.

## Revertir un despliegue

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso
anterior, y nunca recompila: el valor de un rollback reside en que envía un
artefacto que ya se ha ejecutado.

Qué despliegues califican depende de cómo se despliega el proyecto, y ambos tipos
funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto ejecuta actualmente |

Las apps estáticas integradas en el bundle del backend (un simple `rebase cloud deploy` en un
proyecto con backend) son parte de ese bundle, por lo que se revierten junto con él.

Una app estática desplegada por su cuenta (`rebase cloud deploy <app>`) aún no se puede
revertir. Su despliegue registra qué app publicó, pero ningún bundle, por lo que el
plano de control no tiene nada desde donde restaurarla. La solución es volver a desplegar la última
versión funcional, por ejemplo desde el commit anterior al fallido. Después de un
despliegue de este tipo, `deploy` indica esto en lugar de sugerir `rollback`, y un `rollback`
sin un id lo rechazará antes que volver a desplegar el backend que está sirviendo.

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que significa
un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments`
marca los que califican, y `--json` informa `rollbackable` por cada fila junto
con la `image` o `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál es el caso: uno que no tuvo éxito
y uno previo a que la plataforma registrara su artefacto. No hay nada que suponer
en ninguno de los dos casos —adivinar enviaría lo que se haya compilado o subido
más recientemente fingiendo restaurar este—, así que en su lugar despliega la versión que desees.

Cada despliegue exitoso termina indicando la vía de retorno (`rebase cloud rollback`),
de modo que esté a la vista en el instante en que se detecte una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a
que la versión restaurada comience a responder antes de reportar éxito. Síguelo
con `rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada se puede recuperar a cualquier minuto dentro de su ventana de recuperación,
desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Requiere dos pasos. En primer lugar, se prepara una copia recuperada (staged) junto a la base de datos activa;
tu app continúa ejecutándose sobre la activa, y el almacenamiento de la copia se factura hasta
que hagas el cutover o la descartes.
Luego, una vez lista la copia, el cutover redirige la aplicación hacia ella y la
reinicia. Cualquier dato escrito después de la hora objetivo no estará en la copia. La base de datos
original se conserva como vía de retorno y continúa facturando almacenamiento; volver a ella,
eliminarla o realizar una segunda restauración requiere contactar a soporte. Solo un owner o admin
puede preparar, realizar el cutover o descartar, y la consola solicita el nombre del proyecto
antes de ejecutar el cutover.

## Protege tu cuenta

Tu cuenta de la consola puede acceder a bases de datos de producción, secretos y facturación, así
que protégela en consecuencia. Abre **Account security** desde el menú bajo tu avatar
en la consola (o ve a `/account`). La página es tuya, no de una
organización: lo que configures allí se aplica en cada organización a la que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password,
  Google Authenticator, Authy). La página muestra una clave de configuración para añadir a la app, o un
  enlace que abre la app con la clave ya rellenada en un teléfono, y luego solicita el
  código de 6 dígitos que muestra la app. A partir de entonces, cada inicio de sesión solicitará un código,
  ya sea que inicies sesión con contraseña, Google o GitHub.
- **Códigos de recuperación.** Al activarla, obtendrás diez códigos de un solo uso, que se muestran una sola vez.
  Cada uno te permite iniciar sesión en lugar del código del autenticador si pierdes tu
  teléfono, así que guárdalos antes de cerrar el diálogo. **New recovery codes**
  los reemplaza y los anteriores dejan de funcionar. Desactivar la verificación en dos pasos
  y generar nuevos códigos requieren ingresar un código previamente.
- **Contraseña.** Cambiarla cerrará la sesión en todos los demás dispositivos. Una cuenta
  creada con Google, GitHub o LinkedIn no tiene contraseña; la página te ofrece
  enviarte un enlace por correo para definir una.
- **Dispositivos conectados.** Cada navegador y terminal con la sesión iniciada en tu cuenta,
  con su dirección y cuándo inició sesión. Cierra la sesión de cualquier dispositivo que no
  reconozcas o de todos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no solicitan un segundo
factor, por lo que CI continúa desplegando después de que la actives. Revoca un token en el que ya no
confíes en **Settings → Access tokens**.

## Invita a tu equipo

**Members → Add member** añade a alguien que ya tenga una cuenta de Rebase con una
dirección de correo verificada, como admin o member; un owner puede convertirlo en owner
posteriormente. Tienen acceso de inmediato y no se envía ningún correo. Rebase Cloud no
envía invitaciones aún, así que pide a un compañero de equipo sin cuenta que se registre y
verifique su dirección primero. Desde una terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que
lo indicará cuando la dirección no tenga una cuenta asociada.

## Consulta quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los
owners y admins de la organización quién desplegó, definió o reveló una variable de entorno
(por nombre, nunca por valor), cambió un dominio, restauró una copia de seguridad,
redimensionó, detuvo o eliminó un proyecto, modificó el rol de un miembro o creó un
token, y cuándo ocurrió. La sección **Settings** de un proyecto enlaza a sus propias entradas; los registros
sobre un proyecto eliminado se conservan. Un script puede leerlo con un token creado con
`--can audit` en la organización. Las entradas se conservan durante un año. Los filtros se detallan en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no debe llevar tu contraseña. Asígnale un token restringido a
unas pocas acciones en un único proyecto, creado desde una terminal con sesión iniciada mediante
`rebase cloud tokens create --project shop --can deploy,logs`, y establécelo como
`REBASE_TOKEN`. La facturación, el registro de actividad y la configuración de
notificaciones de una organización son capacidades independientes (`--can billing`, `audit`,
`notifications`) que un token posee solo si se solicitan explícitamente. Las capacidades, un
flujo de trabajo de GitHub Actions y lo que queda reservado a una persona autenticada se detallan en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` le proporciona a una app un backend activo antes de que nadie se haya
registrado, e imprime una URL de reclamación (claim) para que la persona lo conserve; un proyecto que nadie reclame
en 72 horas se elimina. Lo que puede hacer el token de un proyecto no reclamado, el
`REBASE_API_TOKEN` que escribe y lo que cambia al reclamarlo se explican en
[Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se calcula a partir de lo que reserva, no por niveles (tiers). `compute` muestra
cada parámetro de ajuste y la cotización detallada del propio plano de control para ellos. (`rebase cloud
resources` es algo distinto: las bases de datos y los buckets que el código declara,
y si cada uno está aprovisionado; consulta la [referencia de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud de recursos de la app por instancia, p. ej. `500m` y `2Gi`. Vacío significa el valor predeterminado de la plataforma: `100m` y `384Mi`, con picos (burst) de hasta 2 CPU y `2Gi` |
| `--replicas` | Instancias que existen siempre: el mínimo del autoescalador y lo que factura mensualmente la suscripción del proyecto |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar. Las instancias que el autoescalador añade por encima de `--replicas` se miden por pod-segundo a las mismas tarifas, y se cobran solo donde la plataforma lo tenga activado; **Usage this month** especifica cuál es el caso. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoescalador, respecto a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (spot): más económica y reiniciada sin previo aviso |
| `--db-instances` | 1–3. `1` es una única instancia sin conmutación por error (failover); `2` añade un nodo de respaldo (standby) automático |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no es lo mismo que fijarlo al mismo número: un parámetro vacío
sigue el valor predeterminado de la plataforma y cambia cuando este cambia.

La CLI no valida nada a propósito: los límites corresponden al clúster en el que
se ejecuta un proyecto y varían según el proveedor. El plano de control rechaza cualquier
valor que no pueda cumplir e indica el campo correspondiente. Ejecuta `rebase cloud compute` para ver
los €/mes antes y después; cualquier cambio se aplica de inmediato, prorrateado a partir de hoy,
excepto aquel que reinicie la base de datos, el cual esperará a una ventana de mantenimiento.

## El resto de la superficie

| Grupo de comandos | Lo que cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token bearer que la CLI enviaría en este momento, para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Añadir un servidor Rebase autoalojado a tu cuenta, para que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude acceda a él junto a tus proyectos de Cloud. `--list` los muestra, `--remove` quita uno. Owners y admins |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta y un enlace para reclamarlo; `claim` vuelve a imprimir ese enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Desplegar y monitorizar |
| `deploy-hooks` | URLs secretas a las que un host de git o CI llama para desplegar el proyecto: listar, crear (la URL se muestra una sola vez), revocar. |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma facture a los proyectos detenidos solo por el almacenamiento y la tarifa de plataforma; la fila **Billing** de la consola lo especifica cuando es así |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `alerts` | Los incidentes abiertos del proyecto, y cómo confirmarlos (acknowledge) o posponerlos (snooze). |
| `cron` | Las tareas cron de la aplicación desplegada y sus ejecuciones registradas, consultadas con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime los valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, transferida al reclamar; `rotate` la reemplaza y revoca la anterior. Owners y admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin en la propia API de la app: cuándo se rotó por última vez; `rotate` le proporciona a la app una nueva. Owners y admins |
| `domains` | Dominios personalizados, los registros DNS a añadir y la verificación. Un proyecto puede responder en varios, cada uno verificado por separado; `verify` y `remove` toman el dominio sobre el que actuar, que solo se puede omitir cuando solo hay uno (para `verify`, uno aún pendiente). Cada dominio verificado sirve el proyecto como tal; `primary <domain>` elige el canónico y `redirect <domain>` responde a otro con una redirección 308 hacia él, manteniendo la ruta y la query (`--off` vuelve a servirlo directamente); haz esto para `www.` junto a un dominio apex, ya que el inicio de sesión con Google, las cookies y las passkeys funcionan por origen. Un dominio en el que se sirve una app (un `path` de app con un hostname) nunca redirige. Un dominio apex (`example.com`, sin subdominio) requiere un registro **A**, ya que el DNS no permite CNAME allí. Esa dirección es el ingress de la plataforma y no se garantiza que permanezca invariable: si la plataforma se traslada, un registro A seguirá apuntando a la dirección antigua. Si tu proveedor de DNS ofrece ALIAS, ANAME o aplanamiento de CNAME (CNAME flattening) en el apex, apunta el apex al `tenantHost` del proyecto en su lugar, que sigue a la plataforma. El CNAME de un subdominio ya la sigue de por sí. `list` muestra `verified, certificate pending` hasta que HTTPS responda con un certificado real. `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo |
| `guests` | Los usuarios invitados que el inicio de sesión anónimo dejó atrás: contarlos, eliminar uno, purgar los que no se han visto en mucho tiempo. Consulta [Guests](/docs/cli/cloud/#guests). Owners y admins |
| `extensions` | La lista de permisos (allowlist) de extensiones de Postgres |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo cambiarlo |
| `events` | Qué sucedió en el backend, lo más reciente primero: escalado de la aplicación, cambios programados y aplicados a la base de datos, toma de control de un standby, crecimiento del disco |
| `usage` | Solicitudes consumidas este mes frente a la cuota incluida, y el exceso acumulado hasta ahora, tal como lo contabiliza la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que se ejecutan los inquilinos (tenants). Solo para administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, pago |
| `activity` | El registro de auditoría de la organización: quién desplegó, cambió una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Owners y admins. Consulta [Consulta quién hizo qué](#consulta-quién-hizo-qué) |
| `notifications` | Dónde se envían (POST) los eventos del proyecto: Slack, Discord o cualquier URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo de esa tabla responde a `--help` con una página propia —una línea de uso,
sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Un test contiene el
índice de las páginas, por lo que un grupo añadido sin una hace que la compilación falle en lugar de
responder con la tabla de contenidos. `verify:docs` vincula la propia tabla
a ese índice: cada grupo que despacha la CLI aparece aquí exactamente una vez, por lo que un grupo
añadido sin una fila también hace fallar la compilación.

Si se utiliza en un pipe, `--help` responde en JSON en su lugar: la misma línea de uso, flags y ejemplos
como una estructura para leer en vez de sesenta líneas de secuencias de escape de terminal.

## Lo que no incluye la beta

Explicado con claridad, porque enterarse más tarde es peor:

- **Sin elección de región.** Actualmente todo se ejecuta en una sola región. El modelo
  de ubicación (placement) existe en la plataforma, pero un proyecto no puede elegir una región.
  `projects create --provider` y `--region` no son la excepción que aparentan
  ser: registran a cuál de los destinos de despliegue registrados en el plano de control
  pertenece un proyecto, y solo hay uno, por lo que ambos toman ese valor por defecto y ninguno traslada
  un proyecto a otro lugar. `rebase cloud projects create --help` indica lo mismo.
- **No es de autoservicio.** El acceso se concede por lotes; no existe un flujo de registro y pago directo.
- **Sin SLA publicado** ni certificación SOC 2. Si necesitas cualquiera de los dos, indícalo
  al solicitar acceso en lugar de darlo por sentado.
- **Sin despliegues por rama (branch deploys)** y sin GitHub App oficial de primera parte. Los deploy hooks
  —URLs secretas a las que apuntas un webhook del repositorio— son la automatización admitida. Los [despliegues
  de previsualización](#previsualizar-un-cambio) se están implementando gradualmente y se inician desde la CLI.
- **Los tokens actúan en representación de una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents)
  es generado por una cuenta y actúa en su nombre; todavía no existe una identidad de máquina perteneciente a la organización. Si
  inicias sesión desde CI en su lugar, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD`
  desde un gestor de secretos; `--password` coloca la contraseña en el historial de tu shell y
  en la tabla de procesos, y así te lo advierte antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio especifica un plano de control distinto al de la propia plataforma,
  pásalo también con `--url`: sin una terminal, `login` se niega a enviar una contraseña a un
  host especificado únicamente por el archivo descargado.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no está expuesta a la
  internet, por lo que el host que muestra la consola es la dirección con la que tu backend accede a ella y
  no resuelve a nada en tu máquina. `rebase cloud db connect` abre un puerto local
  conectado a esa base de datos, canalizado a través del plano de control mediante un túnel, mientras
  lo dejes en ejecución; sin embargo, no existe un nombre de host permanente al que pueda conectarse un servicio
  de terceros. Para ejecutar SQL sin un cliente local de Postgres,
  `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` abre el
  mismo túnel para una sola consulta, ejecuta el texto como un único script (deteniéndose al primer
  error) e imprime la respuesta de cada sentencia (`--json` para scripts). Tanto ese túnel como la contraseña tras
  `rebase cloud db info --reveal` requieren el rol de owner o admin en la
  organización: el mismo que solicita el editor SQL de Studio, ya que los tres desembocan en una
  sesión sobre tus datos de producción.
- **Desplegar implica ejecutar código con los secretos de producción.** El entorno
  de la aplicación contiene `REBASE_SERVICE_KEY` (administrador en su propia API),
  `DATABASE_URL` y `JWT_SECRET`, por lo que el código que despliegue un miembro puede leerlos,
  aunque solo los owners y admins puedan revelarlos en la consola. Invita
  como miembro únicamente a personas a quienes confiarías esos valores.
- **La clave de servicio se puede reemplazar.** La sección **Settings** del proyecto
  (o `rebase cloud service-key rotate`) genera una nueva `REBASE_SERVICE_KEY`
  y reinicia la aplicación con ella. La clave antigua sigue funcionando hasta que el reinicio
  haya finalizado y queda invalidada inmediatamente después, por lo que cualquier servicio que la haya copiado será
  rechazado a partir de ese momento. Reclamar un proyecto realiza la misma acción.

## Autoalojamiento como alternativa

Nada de esto implica dependencia del proveedor (lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/)
ejecuta exactamente la misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) despliega la misma topología a partir
del chart de Helm.
