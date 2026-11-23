---
sourceHash: 2f5cbd6a266650c4
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que autoalojarías — la misma
imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia es quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Opera tenants reales hoy en día y se abre por
lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación necesitan una cuenta a la que se le haya dado acceso.
Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Qué obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Database** | Un PostgreSQL gestionado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo |
| **Storage** | Un bucket propio en [Rebase Storage](/docs/deployment/rebase-storage/), si tu proyecto utiliza almacenamiento de archivos |

La app y la base de datos se aprovisionan cuando despliegas por primera vez; un bucket solo
cuando lo solicitas ([Almacenamiento de archivos](#almacenamiento-de-archivos)). Cada uno se factura por lo que
reserva en lugar de por usuario.

**Nada de tu proyecto cambia para ejecutarse allí.** El mismo repositorio
se autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre la consola en tu navegador e imprime un código corto. Comprueba que
la consola muestre el mismo código y aprueba el inicio de sesión allí: el terminal
recoge la sesión y la escribe en `~/.rebase/credentials.json`. Si no has
iniciado sesión en la consola, inicia sesión allí primero con lo que utilices, Google
y GitHub incluidos. A través de SSH, `rebase cloud login --no-browser` imprime el enlace
para abrirlo en tu propia máquina.

`projects create` no toma argumentos posicionales. El nombre y el subdominio son
flags, y ambos son obligatorios — en una terminal se solicitan interactivamente, y una
ejecución sin interfaz interactiva que omita cualquiera de ellos sale con `input_required` en lugar de inventar
uno. **El subdominio no es editable después:** es el host
`<slug>.rebase.website` en el que responde el proyecto, así que elígelo con cuidado.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un
paso `link` por separado. Escribe `.rebase/cloud.json`, que registra el id del proyecto
y el slug. Ese archivo no es un secreto ni son tus credenciales — esas residen
en `~/.rebase/credentials.json`, escritas por `login`.

Sin embargo, se commitea con el código, por lo que un repositorio clonado puede nombrar cualquier
plano de control. Cuando el host proviene únicamente de ese archivo, y no es el de la
propia plataforma ni uno en el que hayas iniciado sesión anteriormente, `login` lo nombra y pregunta
antes de enviar tu correo electrónico y contraseña allí. Sin un terminal, o con
`--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí a propósito.

Para iniciar sesión sin el navegador, pasa tu correo electrónico: `rebase cloud login --email
me@example.com` solicita tu contraseña. **¿Te registraste con Google, GitHub o
LinkedIn?** Tu cuenta no tiene contraseña, así que usa un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido durante diez minutos, y lo
escribes en el prompt. Con `--email` y sin contraseña, `rebase cloud login` te pregunta
si deseas usar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar
correos electrónicos; si no puede, `--code` lo indica y sale con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` solicita entonces el código de
tu aplicación de autenticación, o uno de tus códigos de recuperación, independientemente de cómo hayas iniciado
sesión. A través del navegador, la consola lo solicita al iniciar sesión allí. Ni un código de inicio de sesión ni un segundo factor se pueden escribir sin un terminal.
Para un script, crea un token de acceso en la consola (**Settings → Access
tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde `invalid_credentials` con las mismas dos formas de entrada, ya
que la causa habitual es una cuenta que nunca tuvo una.

`billing setup` asocia una tarjeta a la organización, una sola vez. Está primero en la
secuencia a propósito: el primer despliegue de un proyecto se rechaza sin ella, y
enterarse de eso después de que un bundle haya terminado de subirse es el peor orden posible.

Después de eso, la página **Billing** de la consola enumera las facturas de la organización,
cada una con la página alojada y el PDF de Stripe, y muestra una vista previa de la próxima factura de cada
proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming`
imprimen lo mismo. Ambos son para los propietarios y administradores de la organización. Donde la
plataforma lo ofrece, **Manage billing** abre el portal de clientes de Stripe para la
tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no solicita
un segundo pago: el proyecto se factura en esa tarjeta y se despliega. Si la tarjeta
es rechazada, o el banco solicita confirmar el pago, la consola te lleva a
**Billing**, donde **Fix your card** guarda otra tarjeta y **Complete the
payment** abre la factura de Stripe.

Lo que ha utilizado un proyecto se muestra en su vista general, bajo **Usage this month**, y
para todos los proyectos a la vez en la página **Billing**: solicitudes frente a la
cuota incluida (la barra se vuelve ámbar al 80%), errores 5xx, el exceso hasta el momento
y hacia dónde se dirige el mes a este ritmo. El exceso se calcula mediante el
mismo código que lo reporta a Stripe, por lo que es lo que incluirá la factura;
aparece en la factura del mes siguiente. `rebase cloud usage` imprime lo
mismo, y `rebase cloud usage org` lo de toda la organización. Cualquier miembro puede leerlo.
Las cifras indican lo que aún no pueden ver: el almacenamiento de objetos se mide pero
aún no se factura ([Rebase Storage](/docs/deployment/rebase-storage/) indica su
precio); mientras un proyecto ejecute dos o más pods de app,
sus solicitudes no se contabilizan; y un día con muestras perdidas subcuenta. Un
proyecto con escalado automático también muestra los pods que ejecutó por encima de `--replicas`, en pod-horas,
cuánto cuestan a sus propias tarifas y si esta plataforma los cobra ya. Un
proyecto reclamado desde un agente cuenta solo los días a partir de la reclamación: antes
de ella, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crear uno:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando, y ningún flag que recordar. El `rebase.json` de una plantilla declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración — lo
indica sobre la marcha (`rebase.json declares runtime: managed — deploying a
bundle`), compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta un estado terminal. El código de
salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Termina indicando dónde responde ahora cada app y si la nueva versión está
activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

«Live» significa que la dirección respondió después de la compilación: el `/health` de un backend
devolvió `ok`, y la página de una app estática se cargó (desde este despliegue, cuando la
plataforma la sirve). La comprobación espera hasta `--live-timeout` segundos, 60 por
defecto; `0` la omite. Si una app no responde a tiempo, el despliegue aun así finaliza con código
cero, porque el despliegue tuvo éxito, y la última línea indica qué app no
respondió y por qué. Un despliegue fallido termina en una sola línea en su lugar, indicando la app y el
motivo, con `rebase cloud logs` para el registro completo de la compilación.

Los scripts pasan `--json` para obtener un solo objeto con los mismos datos: `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de
`rebase cloud`, `deploy` no cambia a JSON por sí solo cuando se redirige con un pipe.

Lo que ese runtime permite — paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños de cuerpo, el sistema de archivos, secretos, almacenamiento y red
saliente — está en su propia página:
[Runtime de backend gestionado](/docs/deployment/managed-runtime/).

Para enviar un artefacto compilado previamente — por ejemplo, un trabajo de CI que compila una vez y
despliega dos veces —, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime gestionado tiene su propio flag, `--eject`, y nada más lo
solicita: una compilación que movería un proyecto gestionado a una imagen de contenedor de la que luego sea
dueño se rechaza hasta que lo indiques explícitamente. Anteriormente, `--force` significaba esto, lo que ponía
la acción menos reversible que la CLI puede hacer bajo la misma palabra que «sobrescribir este
archivo»; ahora es una opción desconocida en lugar de un alias, por lo que un script que la contenga
se detiene.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente tal como son. Cuando su `build` solo
copia scripts escritos a mano en `output`, nada los ha analizado sintácticamente, y un archivo
con un error tipográfico pasa a producción e impide que la página se cargue. Por lo tanto, antes de subir
nada, `deploy` analiza sintácticamente cada archivo `.js`, `.mjs` y `.cjs` en el `output` de cada app
estática, junto con cada `<script>` inline en sus archivos `.html`. Eso
cubre tanto una app estática desplegada por sí sola como las apps estáticas integradas en el
bundle del backend. Un error de sintaxis detiene el despliegue indicando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Los scripts inline que un navegador
no ejecuta como JavaScript se omiten: JSON, import maps, plantillas y cualquier
otro `type` que no sea JavaScript, un `<script src>`, y un script que aún contenga
marcado de plantilla sin renderizar como `{{ }}`. Un archivo `.js` pasa si se analiza correctamente como
script clásico o como módulo, ya que la página decide cuál de los dos es. Nada
bajo `node_modules` se lee, ni tampoco un `--bundle-dir` precompilado.
`--no-verify` omite la comprobación para un despliegue.

Obsérvalo:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando realmente y hacer polling es lo adecuado; cuando indica
algo, ese algo está esperando por ti.

Uno de ellos es `email_not_configured`: la app activó el inicio de sesión mediante enlace mágico o
código por correo electrónico (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) y no tiene servicio de correo electrónico configurado, por lo
que el despliegue está activo y nadie puede iniciar sesión con él. Rebase Cloud no envía
correos para tu app: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y
`SMTP_FROM` con `rebase cloud env set`, y luego despliega. `status` lo lee del
propio `GET /api/auth/config` de la app (su campo `unavailable`), y `deploy` dice
lo mismo bajo su comprobación en vivo.

## Almacenamiento de archivos

Un proyecto nuevo no tiene bucket: las subidas se rechazan con `501 STORAGE_NOT_CONFIGURED`,
y el resumen del despliegue así lo indica, en lugar de escribirse en un disco que cada despliegue reemplaza.

Proporciónale uno de los dos tipos y luego vuelve a desplegar para que la app lo detecte:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` enumera los buckets del proyecto. Un proyecto con varios
asocia cada uno con `--source <key>`; uno que configure el almacenamiento en código no necesita ninguno de los dos.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que haría `deploy`, pero lo sirve en una dirección
propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa
sirviendo lo que servía antes. El despliegue imprime la dirección de la previsualización cuando
finaliza la compilación.

Para mantener una misma dirección entre despliegues, asigna un nombre a la previsualización. Desplegar el mismo nombre
de nuevo la actualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Con qué se comunica una previsualización depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps estáticas
  integradas, de la misma manera en que producción las ejecuta. Obtiene un backend propio en
  una **base de datos propia vacía**, nunca la de producción. Arrancar contra
  la base de datos de producción aplicaría el esquema y las reglas de acceso de la previsualización sobre ella.
- **`rebase cloud deploy web --preview`** previsualizaría una sola app estática por su
  cuenta, con sus páginas llamando al backend de **producción**. Eso requiere un plano de control
  que sirva sitios estáticos por sí mismos, y Rebase Cloud aún no lo hace: lo
  rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Previsualiza el
  backend en su lugar, que sirve las apps estáticas integradas en él; un proyecto
  sin un backend gestionado no se puede previsualizar todavía.

Una previsualización no sube código fuente y no registra apps ni nombres de host, ya que cualquiera
de ellos modificaría el proyecto de producción. `--source` y `--eject` no se pueden
combinar con `--preview`. Cada uno compila una imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sin `--preview` corresponde siempre a producción.

La página **Deployments** de la consola enumera las mismas previsualizaciones, y permite abrir, mostrar el
registro de compilación o eliminar cada una. Crear una sigue siendo un paso exclusivo de la CLI.

Una previsualización expira una semana después del último despliegue en ella.

Al finalizar, el despliegue comprueba que la dirección de la previsualización responda, al igual que hace
un despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). El certificado de una
nueva previsualización puede tardar uno o dos minutos, por lo que un despliegue exitoso puede
indicar que la dirección aún no responde.

Una previsualización de backend se factura como una unidad de app en el tamaño por defecto (100m de CPU
y 384 MiB de memoria, a la tarifa de tu app para su región y capacidad),
prorrateada durante el tiempo que exista, y aparece en la estimación mensual del
proyecto en la consola. `rebase cloud deploy --preview` imprime la misma estimación para
ella, por mes (`cost` bajo `--json`). Iniciar una requiere una tarjeta registrada, al igual que un despliegue
de producción. Un primer despliegue que
falle antes de que se ejecute algo se elimina en lugar de facturarse. Un proyecto puede ejecutar hasta
tres previsualizaciones de backend a la vez.

Cada nueva dirección de previsualización obtiene su propio certificado TLS de Let's Encrypt,
que permite a un dominio 50 certificados nuevos a la semana, compartidos con todos los sitios de producción
en él. Las previsualizaciones pueden tomar 20 de ellos en cualquier período de 7 días, en toda la plataforma. Pasado
ese límite, una nueva previsualización se rechaza (`429`, `preview_cert_budget`) indicando la hora a la que se podrá
desplegar; redesplegar una previsualización que ya existe nunca cuenta.

La base de datos de una previsualización de backend es una segunda base de datos en el Postgres de **producción**:
sus propios datos, pero la misma instancia y el mismo disco. Está limitada a 10
conexiones, por lo que las previsualizaciones no pueden agotar las de producción, y a 2 GB: una
previsualización cuya base de datos crezca más allá de eso se pausa. Su backend se detiene, su dirección deja de
responder, `rebase cloud previews` y la consola la muestran como `paused` con el
motivo, y se notifica a los propietarios y administradores del proyecto (`preview.paused`). Sus
datos se conservan hasta que expire. Despliégala de nuevo para iniciarla (se pausará de nuevo
si la base de datos sigue siendo demasiado grande) o elimínala. Una previsualización pausada se sigue
facturando hasta que se elimine o expire. Elimina las previsualizaciones que ya no necesites. Las extensiones instaladas en producción no se
instalan en la base de datos de una previsualización.

Las previsualizaciones se están desplegando progresivamente. Un plano de control que aún no las sirva rechazará
`--preview` con `previews_unavailable` y no desplegará nada.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso
anterior, y nunca recompila — el valor de un rollback radica en que entrega un
artefacto que ya se ha ejecutado.

Qué despliegues califican depende de cómo se despliega el proyecto, y ambos tipos
funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación desde código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto ejecuta actualmente |

Las apps estáticas integradas en el bundle del backend (un `rebase cloud deploy` simple en un
proyecto con un backend) forman parte de ese bundle, por lo que se revierten junto con él.

Una app estática desplegada por sí sola (`rebase cloud deploy <app>`) aún no se puede revertir
mediante rollback. Su despliegue registra qué app publicó, pero ningún bundle, por lo que el
plano de control no tiene nada desde donde restaurarla. La solución es desplegar de nuevo la última
versión correcta, por ejemplo desde el commit anterior al defectuoso. Después de dicho
despliegue, `deploy` indica esto en lugar de señalar a `rollback`, y un `rollback`
sin un id lo rechaza en lugar de volver a desplegar el backend que está sirviendo.

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que significa
un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments`
marca los que califican, y `--json` reporta `rollbackable` por cada fila junto con la
`image` o el `bundle` que restauraría.

Dos tipos de despliegues son rechazados, y la CLI indica cuál de ellos: uno que no tuvo éxito
y uno anterior a que la plataforma registrara su artefacto. No hay nada que suponer
en ningún caso — suponer enviaría lo que se haya compilado o subido más
recientemente mientras afirma restaurar este —, así que despliega la versión que deseas
en su lugar.

Cada despliegue exitoso termina indicando la forma de volver atrás (`rebase cloud rollback`),
para que esté a la vista en el momento en que se detecte una publicación defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que
la versión restaurada esté sirviendo antes de reportar éxito. Síguelo con
`rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada se puede recuperar a cualquier minuto dentro de su ventana de recuperación,
desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Consta de dos pasos. Primero, se prepara una copia recuperada junto a la base de datos activa;
tu app continúa ejecutándose en la activa, y el almacenamiento de la copia se factura hasta
que realices el cutover o la descartes.
Luego, una vez que la copia está lista, realizar el cutover vuelve a apuntar la app hacia ella y la
reinicia. Cualquier dato escrito después del tiempo objetivo no estará en la copia. La base de datos
original se conserva como vía de retorno y continúa facturando almacenamiento; volver a cambiar a ella,
eliminarla o una segunda restauración requiere contactar a soporte. Solo un owner o admin
puede preparar, realizar el cutover o descartar, y la consola solicita el nombre del proyecto
antes de realizar el cutover.

## Proteger tu cuenta

Tu cuenta de consola puede acceder a bases de datos de producción, secretos y facturación, así
que protégela como corresponde. Abre **Account security** desde el menú debajo de tu avatar
en la consola (o ve a `/account`). La página es tuya, no de una
organización: lo que configures allí se aplica en cada organización a la que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password,
  Google Authenticator, Authy). La página muestra una clave de configuración para agregar a la app, o un
  enlace que abre la app con la clave completada en un teléfono, y luego solicita el
  código de 6 dígitos que muestra la app. A partir de entonces, cada inicio de sesión solicitará un código,
  ya sea que inicies sesión con contraseña, Google o GitHub.
- **Códigos de recuperación.** Activarlo te proporciona diez códigos de un solo uso, mostrados una sola vez.
  Cada uno te permite iniciar sesión en lugar del código de autenticación si pierdes tu
  teléfono, así que guárdalos antes de cerrar el cuadro de diálogo. **New recovery codes**
  los reemplaza, y los antiguos dejan de funcionar. Desactivar la verificación en dos pasos
  y obtener códigos nuevos requieren ingresar un código primero en ambos casos.
- **Contraseña.** Cambiarla cierra tu sesión en todos los demás dispositivos. Una cuenta
  creada con Google, GitHub o LinkedIn no tiene contraseña; la página te ofrece
  enviarte un enlace por correo electrónico para definir una.
- **Dispositivos con sesión iniciada.** Cada navegador y terminal con sesión iniciada en tu cuenta,
  con su dirección y la fecha/hora en que inició sesión. Cierra la sesión de cualquier dispositivo que no
  reconozcas, o de todos ellos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no solicitan un segundo
factor, por lo que CI continuará desplegando después de que lo actives. Revoca un token en el que ya no
confíes en **Settings → Access tokens**.

## Invitar a tu equipo

**Members → Add member** añade a alguien que ya tenga una cuenta de Rebase con una
dirección de correo electrónico verificada, como admin o member; un owner puede convertirlo en owner
posteriormente. Tienen acceso de inmediato y no se envía ningún correo electrónico. Rebase Cloud no
envía invitaciones aún, así que pide a un compañero de equipo que no tenga cuenta que se registre y
verifique su dirección primero. Desde un terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que
lo indica cuando la dirección no tiene cuenta.

## Acceso a Cloud y los usuarios de tu app

<span class="since-badge" data-since="0.35">Since 0.35</span>

Hay dos grupos independientes de personas involucrados, al igual que en Firebase y Supabase:

- **Acceso a Cloud** es quién puede trabajar en el proyecto en Rebase Cloud. Los
  owners y admins de una organización son `admin` en cada proyecto que esta posea, y
  sus miembros son `developer`. Un proyecto también puede otorgar a una persona un rol
  propio, `admin`, `developer` o `viewer`, a través de una invitación por correo electrónico, sin
  convertirla en miembro de la organización. Se aplica el mayor de los dos.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) lo administra.
- **Los usuarios de tu app** residen en la propia base de datos de la app, con su registro y
  sus roles. Cloud nunca los lista ni los edita.

El único puente es **Open admin panel**. Inicia la sesión de una persona con acceso
`admin` en Cloud en el panel de administración de la app, coincidiendo por su correo electrónico verificado: la app
encuentra o crea la cuenta con esa dirección y le asigna el rol `admin`,
y registra que el rol provino de Rebase Cloud (Users & roles de Studio
lo marca). Cuando esa persona pierde el acceso `admin` de Cloud al proyecto, Rebase
Cloud solicita a la app que retire ese `admin`
y finaliza sus sesiones en la app. Un rol otorgado manualmente en la app,
incluido un `admin` que se tuviera antes del primer Open admin panel, se mantiene, y la
cuenta nunca se elimina.

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los
owners y admins de la organización quién desplegó, definió o reveló una variable de
entorno (por nombre, nunca por valor), cambió un dominio, restauró una copia de seguridad,
redimensionó, detuvo o eliminó un proyecto, cambió el rol de un miembro o creó un
token, y cuándo. La sección **Settings** de un proyecto enlaza a sus propias entradas; una entrada
sobre un proyecto eliminado se conserva. Un script lo lee con un token creado con
`--can audit` en la organización. Las entradas se conservan durante un año. Los filtros se encuentran en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no deberían llevar tu contraseña. Asígnale un token restringido a
unas pocas acciones en un proyecto, creado desde un terminal con sesión iniciada con
`rebase cloud tokens create --project shop --can deploy,logs`, y establécelo como
`REBASE_TOKEN`. La facturación, el registro de actividad y la configuración de notificaciones
de una organización son capacidades propias (`--can billing`, `audit`,
`notifications`) que un token posee solo cuando se solicitan explícitamente. Las capacidades, un
flujo de trabajo de GitHub Actions y lo que permanece asociado a una persona con sesión iniciada están en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` proporciona a una app un backend activo antes de que nadie se haya
registrado, e imprime una URL de reclamación para que la persona lo conserve; un proyecto que nadie reclame
en un plazo de 72 horas se elimina. Lo que puede hacer el token del proyecto no reclamado, el
`REBASE_API_TOKEN` que escribe y los cambios que produce la reclamación se encuentran en
[Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se calcula a partir de lo que reserva, no de un nivel predefinido. `compute` imprime
cada parámetro de ajuste y la estimación detallada del propio plano de control para ellos. (`rebase cloud
resources` es algo diferente: las bases de datos y los buckets que declara el código,
y si cada uno está aprovisionado — consulta la [referencia de la CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud de la app por instancia, p. ej. `500m` y `2Gi`. Vacío significa el valor por defecto de la plataforma, que depende de la región (más abajo) |
| `--replicas` | Instancias que siempre existen: el mínimo del autoescalador, y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El techo que puede alcanzar. Las instancias que el autoescalador añade por encima de `--replicas` se miden por pod-segundo a las mismas tarifas, y se cobran solo donde la plataforma haya activado eso; **Usage this month** indica en cuáles. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoescalador, frente a la solicitud en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (preemptible): más económica y reiniciada sin previo aviso |
| `--db-instances` | 1–3. `1` es una sola instancia sin conmutación por error; `2` añade una instancia en espera (standby) automática |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no es lo mismo que uno fijado al mismo número: un parámetro vacío
sigue el valor por defecto de la plataforma y cambia cuando este cambia.

En Bélgica (europe-west1), el valor por defecto reserva 100m de CPU y 384Mi y puede alcanzar picos de
hasta 2 CPU y 2 GiB; en Falkenstein y Helsinki la memoria puede extenderse hasta 1,4× la
solicitud y la CPU hasta 10× (como máximo 1,7 vCPU). `rebase cloud compute` muestra los números de tu
proyecto.

La CLI no valida nada, a propósito — los límites pertenecen al clúster en el que
se ejecuta un proyecto, y difieren entre proveedores. El plano de control rechaza un
valor que no puede satisfacer e indica el campo. Ejecuta `rebase cloud compute` para ver
los €/mes antes y después; un cambio se aplica inmediatamente, prorrateado desde hoy.
Un cambio en la base de datos se aplica de inmediato; se factura al tamaño actual hasta que esté en ejecución.
Una nueva CPU o memoria para la base de datos, o menos instancias, reinicia la base de datos (aproximadamente
de 30 segundos a 3 minutos; las conexiones se pierden y se vuelven a conectar): `compute set`
lo advierte y solicita confirmación, y fuera de un terminal `--yes` actúa como consentimiento. Si ese reinicio
falla, `rebase cloud compute apply` lo vuelve a intentar.

## El resto de la superficie

| Grupo de comandos | Qué cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token bearer que la CLI enviaría ahora, para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Agregar un servidor Rebase autoalojado a tu cuenta, para que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude pueda acceder a él junto a tus proyectos de Cloud. `--list` los muestra, `--remove` elimina uno. Owners y admins |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta, y un enlace para reclamarlo; `claim` vuelve a imprimir ese enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Enviar y monitorear |
| `deploy-hooks` | URLs secretas que un proveedor de Git o CI llama para desplegar el proyecto: listar, crear (la URL se muestra una sola vez), revocar |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y cómo eliminarlas. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `sleep` | Suspender por inactividad: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, y `status` (por defecto). En suspensión, un proyecto no consume CPU ni memoria y la siguiente solicitud lo despierta; los trabajos programados y tareas en segundo plano no se ejecutan mientras tanto. Donde un proyecto no pueda suspenderse, el plano de control lo rechaza e indica el motivo |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma solo facture a los proyectos detenidos por el almacenamiento y la tarifa de la plataforma; la fila **Billing** de la consola lo indica cuando es así |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `alerts` | Los incidentes abiertos del proyecto, y cómo reconocerlos o posponerlos |
| `cron` | Los cron jobs de la app desplegada y sus ejecuciones registradas, leídos con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es solo de escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, entregada al reclamar; `rotate` la reemplaza y revoca la anterior. Owners y admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin en la propia API de la app: cuándo se rotó por última vez; `rotate` le da a la app una nueva. Owners y admins |
| `domains` | Dominios personalizados, los registros DNS a añadir y su verificación. Un proyecto puede responder en varios, cada uno verificado por separado; `verify` y `remove` toman el dominio sobre el cual actuar, el cual puede omitirse solo cuando hay uno (en el caso de `verify`, uno aún pendiente). Cada dominio verificado sirve el proyecto como tal; `primary <domain>` elige el canónico y `redirect <domain>` responde a otro con una redirección 308 hacia él, manteniendo la ruta y los parámetros de consulta (`--off` vuelve a servirlo directamente) — haz esto para `www.` junto a un dominio apex, ya que el inicio de sesión de Google, las cookies y las passkeys funcionan por origen. Un dominio en el que se sirve una app (un `path` de app con un nombre de host) nunca redirige. Un dominio apex (`example.com`, sin subdominio) requiere un registro **A**, porque el DNS no permite CNAME allí. Esa dirección es el ingress de la plataforma y no se garantiza que permanezca invariable: si la plataforma se traslada, un registro A seguirá apuntando a la dirección antigua. Si tu proveedor de DNS ofrece aplanamiento ALIAS, ANAME o CNAME en el apex, apunta el apex al `tenantHost` del proyecto en su lugar, el cual sigue a la plataforma. El CNAME de un subdominio ya la sigue automáticamente. `list` indica `verified, certificate pending` hasta que HTTPS responda con un certificado real. `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo |
| `guests` | Los usuarios invitados que dejó el inicio de sesión anónimo: contarlos, eliminar uno, purgar los que no se han visto durante mucho tiempo. Consulta [Guests](/docs/cli/cloud/#guests). Owners y admins |
| `extensions` | La lista de extensiones de Postgres permitidas |
| `storage` | Los buckets del proyecto y sus claves, en [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo modificarlo |
| `events` | Qué ocurrió en el backend, lo más reciente primero: el escalado de la app, cambios programados y aplicados en la base de datos, un standby tomando el control, el crecimiento del disco |
| `usage` | Solicitudes utilizadas este mes frente a la cuota incluida, y el exceso hasta el momento, tal como lo contabiliza la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Solo para administradores de la plataforma |
| `settings`, `orgs`, `access`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, quién accede a un proyecto, pago |
| `activity` | El registro de auditoría de la organización: quién desplegó, cambió una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Owners y admins. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications` | Dónde se envían por POST los eventos del proyecto: Slack, Discord o cualquier URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo de esa tabla responde a `--help` con una página propia — una línea de uso,
sus flags y ejemplos — y `--help` nunca ejecuta el comando. Una prueba verifica el
índice de las páginas, por lo que un grupo añadido sin una hace fallar la compilación en lugar de
responder con la tabla de contenidos. `verify:docs` vincula la propia tabla a
ese índice: cada grupo que despacha la CLI aparece aquí exactamente una vez, por lo que un grupo
añadido sin una fila también hace fallar la compilación.

Mediante una tubería (pipe), `--help` responde en JSON en su lugar: la misma línea de uso, flags y ejemplos
como una estructura para leer en vez de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Sin elección de región, sin registro de autoservicio, sin SLA publicado, sin despliegues por rama,
tokens que actúan como una persona y sin endpoint público de base de datos. [Qué no incluye la
beta](/docs/deployment/cloud-beta-limits/) expone cada uno de forma clara,
junto con lo que significa desplegar con los secretos de producción.

## Autoalojar en su lugar

Nada de esto implica dependencia del proveedor. La [guía de autoalojamiento](/docs/deployment/self-hosting/)
ejecuta la misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) renderiza la misma topología a partir
del chart de Helm.
