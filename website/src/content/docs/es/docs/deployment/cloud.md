---
sourceHash: 7f18ccdd99ad1dc9
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que autoalojarías: la misma
imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Opera tenants reales hoy en día y se abre
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos siguientes requieren una cuenta a la que
se le haya dado acceso. Todo lo demás en este sitio funciona sin necesidad de una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Qué obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son la subida de un bundle, no la compilación de un contenedor |
| **Base de datos** | Un PostgreSQL administrado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo |
| **Almacenamiento** | Tu propio bucket en [Rebase Storage](/docs/deployment/rebase-storage/), si tu proyecto utiliza almacenamiento de archivos |

La app y la base de datos se aprovisionan cuando despliegas por primera vez; un bucket
solo cuando lo solicitas ([Almacenamiento de archivos](#almacenamiento-de-archivos)). Cada uno se factura
por lo que reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que se inicia dondequiera que se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre la consola en tu navegador e imprime un código corto. Comprueba que
la consola muestre el mismo código y aprueba el inicio de sesión allí: la terminal
detecta la sesión y la escribe en `~/.rebase/credentials.json`. Si no has
iniciado sesión en la consola, hazlo primero allí con lo que uses habitualmente,
incluidos Google y GitHub. A través de SSH, `rebase cloud login --no-browser` imprime
el enlace para abrirlo en tu propia máquina.

`projects create` no toma ningún argumento posicional. El nombre y el subdominio
son flags, y ambos son obligatorios: en una terminal se solicitan interactivamente,
y una ejecución headless que omita cualquiera de ellos finaliza con `input_required`
en lugar de inventar uno. **El subdominio no se puede editar después:** es el host
`<slug>.rebase.website` en el que responde el proyecto, así que elígelo con cuidado.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay
un paso `link` por separado. Escribe `.rebase/cloud.json`, que registra el id del
proyecto y el slug. Ese archivo no es un secreto ni contiene tus credenciales; esas
residen en `~/.rebase/credentials.json`, escritas por `login`.

Sin embargo, se incluye en el control de versiones con el código, por lo que un
repositorio clonado puede apuntar a cualquier plano de control. Cuando el host proviene
únicamente de ese archivo, y no es el de la propia plataforma ni uno en el que hayas iniciado
sesión antes, `login` lo indica y solicita confirmación antes de enviar tu correo
electrónico y contraseña allí. Sin una terminal, o con `--json`, lo rechaza con
`unknown_control_plane`; pasa `--url <host>` (o define `REBASE_CLOUD_URL`) para iniciar
sesión allí intencionalmente.

Para iniciar sesión sin el navegador, pasa tu correo electrónico: `rebase cloud login --email
me@example.com` te pedirá tu contraseña. **¿Te registraste con Google, GitHub o
LinkedIn?** Tu cuenta no tiene contraseña, así que utiliza un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido durante diez
minutos, y lo introduces en el prompt. Con `--email` y sin contraseña, `rebase cloud login`
pregunta si deseas usar tu contraseña o un código. Los códigos requieren que el plano de
control pueda enviar correos electrónicos; si no puede, `--code` lo indicará y finalizará
con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` te pedirá el código de
tu aplicación de autenticación o uno de tus códigos de recuperación, independientemente
de la vía de inicio de sesión que hayas usado. A través del navegador, la consola lo solicitará
al iniciar sesión allí. Ni el código de inicio de sesión ni el segundo factor pueden introducirse
sin una terminal. Para un script, crea un token de acceso en la consola (**Settings → Access
tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responderá `invalid_credentials` ofreciendo las mismas dos
formas de acceso, ya que la causa común es una cuenta que nunca tuvo contraseña.

`billing setup` vincula una tarjeta a la organización, una sola vez. Está primero en
la secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una,
y descubrirlo después de que un bundle haya terminado de subirse es el peor escenario.

A partir de entonces, la página **Billing** de la consola muestra las facturas de la
organización, cada una con su página alojada en Stripe y su PDF, y previsualiza la próxima
factura de cada proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming`
imprimen lo mismo. Ambos son accesibles para los propietarios y administradores de la organización.
Donde la plataforma lo ofrezca, **Manage billing** abre el portal de clientes de Stripe para la
tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no requiere ningún
segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta es
rechazada, o el banco requiere confirmar el pago, la consola te redirige a **Billing**,
donde **Fix your card** permite guardar otra tarjeta y **Complete the payment** abre la
factura de Stripe.

El consumo de un proyecto se muestra en su vista general, bajo **Usage this month**, y
para todos los proyectos a la vez en la página **Billing**: solicitudes frente a la
cuota incluida (la barra cambia a ámbar al 80%), errores 5xx, el exceso consumido
hasta el momento y la proyección estimada para fin de mes. El exceso se calcula con
el mismo código que lo reporta a Stripe, por lo que es lo que figurará en la factura;
aparece en la factura del mes posterior. `rebase cloud usage` imprime lo mismo, y
`rebase cloud usage org` para toda la organización. Cualquier miembro puede consultarlo.
Las cifras aclaran lo que aún no se puede ver: el almacenamiento de objetos se mide
pero aún no se factura ([Rebase Storage](/docs/deployment/rebase-storage/) indica su
precio); mientras un proyecto ejecute dos o más pods de app, sus solicitudes no se
contabilizan; y un día con muestras perdidas cuenta por defecto a la baja. Un proyecto
con autoescalado también muestra los pods ejecutados por encima de `--replicas`, en
horas-pod, cuánto costaron a sus tarifas y si esta plataforma los cobra actualmente. Un
proyecto reclamado desde un agente cuenta únicamente los días a partir de la reclamación:
antes de ella, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crearlo de nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando y ninguna flag que recordar. El `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración; lo indica
durante el proceso (`rebase.json declares runtime: managed — deploying a bundle`),
compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la imagen de runtime
publicada y monitoriza el despliegue hasta alcanzar un estado terminal. El código de
salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Concluye indicando dónde responde ahora cada app y si la nueva versión está activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

«Live» significa que la dirección respondió tras la compilación: el `/health` de un
backend devolvió `ok`, y la página de una app estática cargó correctamente (desde este
despliegue, cuando la plataforma la sirve). La comprobación espera hasta `--live-timeout`
segundos, 60 por defecto; `0` la omite. Si una app no responde a tiempo, el despliegue
aún finaliza con código cero, dado que el despliegue tuvo éxito, y la última línea indica
qué app no respondió y el motivo. Un despliegue fallido concluye en una sola línea, indicando
la app y el motivo, con `rebase cloud logs` para consultar el registro de compilación completo.

Los scripts pueden pasar `--json` para obtener un solo objeto con los mismos datos:
`apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia
del resto de `rebase cloud`, `deploy` no conmuta a JSON por sí solo cuando se canaliza en un pipe.

Lo que ese runtime permite —paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños de cuerpo, sistema de archivos, secretos, almacenamiento
y red saliente— se encuentra en su propia página:
[Runtime de backend administrado](/docs/deployment/managed-runtime/).

Para publicar un artefacto compilado con anterioridad —por ejemplo, un flujo de CI que
compila una vez y despliega dos—, apunta al directorio en lugar de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime administrado requiere su propia flag, `--eject`, y nada más lo
solicitará: una compilación que trasladaría un proyecto administrado a una imagen de
contenedor que luego pasa a gestionar el usuario se rechaza hasta que lo confirmes.
Anteriormente `--force` significaba esto, lo cual ubicaba la acción menos reversible
que la CLI puede realizar bajo la misma palabra que «sobrescribir este archivo»; ahora es
una opción no reconocida en vez de un alias, por lo que un script que la contenga se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente como están. Cuando su `build`
solo copia scripts escritos a mano en `output`, nada los ha analizado sintácticamente, y un
archivo con un error tipográfico pasará a producción e impedirá que la página cargue. Por
lo tanto, antes de subir nada, `deploy` analiza cada archivo `.js`, `.mjs` y `.cjs` en el
`output` de cada app estática, junto con cada `<script>` en línea dentro de sus archivos
`.html`. Eso abarca tanto una app estática desplegada por separado como apps estáticas
integradas en el bundle del backend. Un error de sintaxis detiene el despliegue indicando
el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` el `code` del error es `syntax_error`. Se omiten los scripts en línea que un
navegador no ejecuta como JavaScript: JSON, import maps, plantillas y cualquier otro
`type` ajeno a JavaScript, un `<script src>`, y scripts que aún contengan marcado de
plantillas sin renderizar como `{{ }}`. Un archivo `.js` pasa la validación si se analiza
correctamente como un script clásico o como un módulo, ya que la página decide cuál es.
No se lee nada dentro de `node_modules`, ni tampoco un `--bundle-dir` precompilado.
`--no-verify` omite la comprobación durante un despliegue puntual.

Monitorización:

```bash
rebase cloud logs               # el registro de compilación
rebase cloud logs --runtime -f  # lo que imprime la app en ejecución, en vivo, hasta Ctrl-C
rebase cloud status             # el estado del proyecto según la plataforma
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la plataforma
está trabajando legítimamente y sondear el estado (polling) es la acción adecuada; cuando
nombra algo, ese algo está esperando tu intervención.

Uno de estos casos es `email_not_configured`: la app habilitó el inicio de sesión por
magic link o código por correo (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) pero carece de un servicio
de correo configurado, por lo que el despliegue está activo pero nadie puede iniciar sesión.
Rebase Cloud no envía correos en nombre de tu app: define `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` mediante `rebase cloud env set`, y luego despliega.
`status` lo lee del propio `GET /api/auth/config` de la app (en su campo `unavailable`), y
`deploy` indica lo mismo bajo su comprobación en vivo.

## Más de una base de datos

Declara cada una (`database("analytics")`) y despliega: se creará en el servidor del
proyecto como `DATABASE_URL__ANALYTICS`, compartiendo sus recursos y facturación ([detalles](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Almacenamiento de archivos

Un proyecto nuevo no tiene bucket: las subidas se rechazan con `501 STORAGE_NOT_CONFIGURED`,
y el resumen de despliegue lo indica, en lugar de escribirse en un disco que cada despliegue reemplaza.

Asígnale uno de dos tipos y vuelve a desplegar para que la app lo detecte:

```bash
# Un bucket que Rebase opera por ti. La página Storage de la consola hace lo mismo.
rebase cloud storage create

# O tu propio bucket compatible con S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omitir para AWS; añadir --force-path-style para MinIO

rebase cloud deploy
```

`rebase cloud storage` lista los buckets del proyecto; cada `bucket("media")` declarado
recibe el suyo ([Múltiples bases de datos y buckets](/docs/backend/multiple-sources/#on-rebase-cloud)).
Con buckets propios, adjunta cada uno mediante `--source <key>`; si el almacenamiento
se configura en código, no se requiere ninguno de los dos.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo que `deploy` subiría, pero lo sirve en una dirección
propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa sirviendo lo que
servía antes. El despliegue imprime la dirección de la preview cuando la compilación finaliza.

Para conservar una misma dirección a lo largo de varios despliegues, asigna un nombre a la
preview. Desplegar con el mismo nombre la actualizará:

```bash
rebase cloud deploy --preview-name new-checkout
```

Con qué interactúa una preview depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps estáticas
  integradas, del mismo modo en que producción las ejecuta. Obtiene un backend propio sobre
  una **base de datos vacía propia**, nunca la de producción. Iniciar contra la base de
  datos de producción aplicaría sobre ella el esquema y las reglas de acceso de la preview.
- **`rebase cloud deploy web --preview`** previsualizaría una sola app estática por su
  cuenta, realizando peticiones al backend de **producción**. Esto requiere un plano de control
  capaz de servir sitios estáticos de forma aislada, lo cual Rebase Cloud aún no soporta:
  lo rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Previsualiza el backend en su
  lugar, el cual sirve las apps estáticas integradas en él; un proyecto sin backend
  administrado no se puede previsualizar por ahora.

Una preview no sube código fuente ni registra apps o nombres de host, ya que cualquiera de
estas operaciones alteraría el proyecto de producción. `--source` y `--eject` no pueden
combinarse con `--preview`. Ambos compilan una imagen de contenedor para producción.

```bash
rebase cloud previews                      # nombre, dirección, app, backend, caducidad
rebase cloud logs --preview new-checkout   # su registro de compilación; -f sigue una compilación en curso
rebase cloud logs --runtime --preview new-checkout -f  # lo que imprime su backend
rebase cloud previews delete new-checkout  # deja de servirla y elimina su base de datos
```

`rebase cloud logs` sin `--preview` siempre corresponde a producción.

La página **Deployments** de la consola lista las mismas previews, y permite abrir, mostrar
el registro de compilación o eliminar cualquiera de ellas. Su creación continúa siendo un
paso exclusivo de la CLI.

Una preview caduca una semana después de su último despliegue.

Al finalizar, el despliegue comprueba que la dirección de la preview responda, del mismo
modo que en un despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). El
certificado de una preview nueva puede tardar un minuto o dos, por lo que un despliegue
que tuvo éxito puede indicar que la dirección aún no responde.

Una preview de backend se factura como una unidad de app en el tamaño predeterminado (100m
de CPU y 384 MiB de memoria, a la tarifa de tu app para su región y capacidad), prorrateada
durante el tiempo que exista, y aparece en el presupuesto mensual del proyecto en la consola.
`rebase cloud deploy --preview` imprime el mismo presupuesto mensual para ella (`cost` bajo
`--json`). Iniciar una requiere una tarjeta registrada, al igual que un despliegue de
producción. Un primer despliegue que falle antes de que algo se ejecute se elimina en lugar
de facturarse. Un proyecto puede ejecutar hasta tres previews de backend a la vez.

Cada nueva dirección de preview recibe su propio certificado TLS de Let's Encrypt, que
permite 50 certificados nuevos por dominio a la semana, compartidos con todos los sitios
de producción bajo el mismo dominio. Las previews pueden consumir hasta 20 de ellos en
cualquier ventana de 7 días en toda la plataforma. A partir de ese límite, se rechazará una
nueva preview (`429`, `preview_cert_budget`) indicando cuándo podrá desplegarse; redesplegar
una preview ya existente nunca consume este cupo.

La base de datos de una preview de backend es una segunda base de datos en el Postgres de
**producción**: contiene sus propios datos, pero comparte la misma instancia y disco. Está
limitada a 10 conexiones para evitar agotar las de producción, y a 2 GB: una preview cuya
base de datos supere ese límite se pausa. Su backend se detiene, su dirección deja de
responder, `rebase cloud previews` y la consola la muestran como `paused` con el motivo, y
los propietarios y administradores del proyecto reciben una notificación (`preview.paused`).
Sus datos se conservan hasta que caduque. Vuelve a desplegarla para reactivarla (se pausará
de nuevo si la base de datos sigue excediendo el límite), o elimínala. Una preview pausada
continúa facturándose hasta que se elimine o caduque. Elimina las previews que ya no necesites.
Las extensiones instaladas en producción no se instalan en la base de datos de una preview.

Las previews se están implementando progresivamente. Un plano de control que aún no las soporte
rechazará `--preview` con `previews_unavailable` y no desplegará nada.

## Revertir

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que publicó un despliegue exitoso anterior,
y nunca recompila: el valor de un rollback reside en que publica un artefacto que ya ha
sido ejecutado.

Cuáles despliegues califican depende de cómo se despliegue el proyecto, y ambos métodos
son válidos:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (runtime de la plataforma) | El bundle que publicó ese despliegue, sobre la versión de runtime que el proyecto ejecuta actualmente |

Las apps estáticas integradas en el bundle del backend (un simple `rebase cloud deploy` en
un proyecto con backend) forman parte de ese bundle, por lo que se revierten junto con él.

Una app estática desplegada por separado (`rebase cloud deploy <app>`) aún no se puede
revertir. Su despliegue registra qué app publicó, pero ningún bundle, por lo que el plano
de control no tiene de dónde restaurarla. La solución consiste en volver a desplegar la
última versión correcta, por ejemplo desde el commit anterior al defectuoso. Tras dicho
despliegue, `deploy` indicará esto en lugar de apuntar a `rollback`, y un `rollback` sin id
lo rechazará en lugar de redesplegar el backend que está prestando servicio.

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos casos,
lo que implica un proyecto que se haya desplegado con éxito al menos dos veces.
`rebase cloud deployments` destaca los que califican, y `--json` reporta `rollbackable` por
fila junto con la `image` o el `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál: uno que no culminó con éxito
y uno previo a que la plataforma comenzara a registrar sus artefactos. No hay margen para
adivinar en ningún caso —adivinar publicaría lo que se haya compilado o subido más recientemente
pretendiendo restaurar este—, por lo que deberás desplegar directamente la versión deseada.

Cada despliegue exitoso concluye mostrando la vía de retorno (`rebase cloud rollback`),
para que esté a la vista en el momento en que se detecte una publicación defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que la
versión restaurada esté en servicio antes de confirmar el éxito. Puedes seguirlo con
`rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos administrada puede recuperarse a cualquier minuto dentro de su ventana de
recuperación, desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Requiere dos pasos. Primero, se aprovisiona una copia recuperada junto a la base de datos
activa; tu app continúa funcionando sobre la activa, y el almacenamiento de la copia se
factura hasta que realices la transición (cutover) o la descartes.
Luego, una vez lista la copia, la transición redirige la app hacia ella y la reinicia. Todo
lo escrito con posterioridad a la hora indicada no figurará en la copia. La base de datos
original se preserva como vía de retorno y continúa facturando almacenamiento; volver a ella,
eliminarla o realizar una segunda restauración requiere la intervención de soporte. Solo un
propietario o administrador puede preparar, realizar la transición o descartar copias, y la
consola solicitará el nombre del proyecto antes de ejecutar el cutover.

## Proteger tu cuenta

Tu cuenta de la consola puede acceder a bases de datos de producción, secretos y facturación,
por lo que debes protegerla en consecuencia. Abre **Account security** desde el menú bajo tu
avatar en la consola (o ve a `/account`). La página es de carácter personal, no de una
organización: lo que configures allí aplica a todas las organizaciones a las que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password,
  Google Authenticator, Authy). La página muestra una clave de configuración para añadir a la app,
  o un enlace que abre la app con la clave completada en un teléfono, y luego solicita el
  código de 6 dígitos que la app muestra. A partir de entonces, cada inicio de sesión solicitará
  un código, ya sea que inicies sesión con contraseña, Google o GitHub.
- **Códigos de recuperación.** Activarlo genera diez códigos de un solo uso, mostrados una sola
  vez. Cada uno permite iniciar sesión en lugar del código de autenticación si pierdes tu
  teléfono, así que guárdalos antes de cerrar el diálogo. **New recovery codes** los reemplaza
  y anula los anteriores. Tanto desactivar la verificación en dos pasos como solicitar nuevos
  códigos exigen introducir un código previo.
- **Contraseña.** Cambiarla cerrará tu sesión en todos los demás dispositivos. Una cuenta
  creada con Google, GitHub o LinkedIn no posee contraseña; la página ofrece enviarte un enlace
  por correo para definir una.
- **Dispositivos conectados.** Cada navegador y terminal con sesión iniciada en tu cuenta, con
  su dirección y cuándo inició sesión. Cierra la sesión de cualquier dispositivo que no reconozcas,
  o de todos al mismo tiempo.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no
solicitan un segundo factor, por lo que CI continuará desplegando tras activarlo. Revoca los
tokens en los que dejes de confiar en **Settings → Access tokens**.

## Invitar a tu equipo

**Members → Add member** añade a alguien que ya disponga de una cuenta en Rebase con un correo
electrónico verificado, como administrador o miembro; un propietario puede otorgarle el rol
de propietario posteriormente. El acceso es inmediato y no se envía correo electrónico alguno.
Rebase Cloud aún no envía invitaciones automáticas, así que pide a los compañeros de equipo
sin cuenta que se registren y verifiquen su dirección previamente. Desde una terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que te avisará
si la dirección no posee una cuenta asociada.

## Acceso a Cloud y los usuarios de tu app

Hay dos grupos distintos de personas involucrados, al igual que en Firebase y Supabase:

- **El acceso a Cloud** define quién puede trabajar en el proyecto en Rebase Cloud. Los
  propietarios y administradores de una organización son `admin` en cada proyecto que esta
  posee, y sus miembros son `developer`. Un proyecto también puede otorgar a una persona un rol
  propio (`admin`, `developer` o `viewer`) mediante una invitación por correo, sin necesidad
  de hacerla miembro de la organización. Prevalece el rol más elevado de los dos.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) lo gestiona.
- **Los usuarios de tu app** residen en la base de datos propia de la app, con su registro y
  sus roles. Cloud jamás lista ni modifica a estos usuarios.

El único punto de enlace es **Open admin panel**. Inicia sesión a una persona con acceso `admin`
en Cloud dentro del panel de administración de la app, coincidiendo con su correo electrónico
verificado: la app busca o crea la cuenta con esa dirección, le asigna el rol `admin` y
registra que el rol se originó en Rebase Cloud (la sección Users & roles de Studio lo indica).
Cuando esa persona pierde el acceso `admin` en Cloud al proyecto, Rebase Cloud solicita a la app
que revoque ese permiso de `admin` y finalice sus sesiones en la app. Un rol otorgado manualmente
en la app, incluido un rol de `admin` obtenido con anterioridad al primer Open admin panel, se
mantiene, y la cuenta nunca se elimina.

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los propietarios y
administradores de la organización quién desplegó, definió o reveló una variable de entorno
(por nombre, nunca por valor), cambió un dominio, restauró una copia de seguridad, redimensionó,
detuvo o eliminó un proyecto, cambió el rol de un miembro o creó un token, y cuándo ocurrió.
La sección **Settings** de un proyecto enlaza a sus propios registros; las entradas de un
proyecto eliminado se conservan. Un script puede leerlo mediante un token creado con `--can audit`
en la organización. Los registros se almacenan durante un año. Los filtros se detallan en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no debe manejar tu contraseña personal. Proporciónale un token
restringido a unas pocas acciones en un proyecto específico, generado desde una terminal con
sesión iniciada mediante `rebase cloud tokens create --project shop --can deploy,logs`, y
configúralo como `REBASE_TOKEN`. La facturación, el registro de actividad y las notificaciones
de una organización son capacidades independientes (`--can billing`, `audit`, `notifications`)
que un token solo adquiere si se solicitan de forma explícita. Las capacidades, un flujo de
trabajo para GitHub Actions y los privilegios que permanecen ligados a una persona con sesión
iniciada se detallan en [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` dota a una app de un backend activo antes de que nadie se haya
registrado, e imprime una URL de reclamación para que el usuario pueda conservarlo; un proyecto
que nadie reclame en 72 horas se elimina. Lo que puede realizar el token de un proyecto sin
reclamar, el `REBASE_API_TOKEN` que escribe y qué cambia tras la reclamación se explica en
[Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se define por lo que reserva, no por tramos fijos (tiers). `compute`
imprime cada parámetro y el presupuesto desglosado del propio plano de control para ellos.
(`rebase cloud resources` es una función diferente: muestra las bases de datos y buckets que el
código declara, y si están aprovisionados; consulta la [referencia de la CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud de la app por instancia, p. ej. `500m` y `2Gi`. Vacío indica el valor por defecto de la plataforma, que depende de la región (ver más abajo) |
| `--replicas` | Instancias que existen de forma permanente: el umbral inferior del autoescalador y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El techo máximo que puede alcanzar. Las instancias que el autoescalador añada por encima de `--replicas` se miden por segundo-pod a las mismas tarifas, y solo se facturan si la plataforma ha habilitado dicho cobro; **Usage this month** indica su estado. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que el autoescalador mantiene, evaluada frente a la solicitud (request) y no contra el límite. Vacío equivale a 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (spot): más económica, pero sujeta a reinicios sin previo aviso |
| `--db-instances` | 1–3. `1` corresponde a una instancia única sin tolerancia a fallos; `2` añade una réplica de respaldo automática (standby) |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío equivale a `160m` y `1Gi` |

Un parámetro vacío no equivale a fijarlo manualmente en el mismo número: un parámetro vacío
adopta el valor predeterminado de la plataforma y evoluciona cuando este cambia.

En Bélgica (europe-west1) la configuración por defecto reserva 100m de CPU y 384Mi, pudiendo
alcanzar picos de 2 CPU y 2 GiB; en Falkenstein y Helsinki la memoria puede escalar hasta 1,4×
la solicitud y la CPU hasta 10× (como máximo 1,7 vCPU). `rebase cloud compute` muestra las
cifras exactas de tu proyecto.

La CLI no valida ningún valor de antemano de forma intencionada: los límites dependen del
clúster en el que opera el proyecto y varían según el proveedor. El plano de control rechazará
cualquier valor que no pueda satisfacer e indicará el campo. Ejecuta `rebase cloud compute`
para visualizar el costo en €/mes antes y después; un cambio se aplica de inmediato, prorrateado
desde el día en curso. Las modificaciones de bases de datos se aplican en el acto; facturándose
al tamaño actual hasta que estén en funcionamiento. Un cambio en la CPU o memoria de la base
de datos, o una reducción de instancias, reinicia la base de datos (toma de 30 segundos a
3 minutos; las conexiones se interrumpen y se vuelven a conectar): `compute set` lo advertirá
y pedirá confirmación; fuera de una terminal interactiva, `--yes` otorga el consentimiento.
Si ese reinicio falla, `rebase cloud compute apply` reintentará el proceso.

## El resto de la superficie

| Grupo de comandos | Qué cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token bearer que la CLI enviaría en ese momento, para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Añadir un servidor Rebase autoalojado a tu cuenta, para que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude pueda acceder a él junto con tus proyectos de Cloud. `--list` los lista, `--remove` desvincula uno. Propietarios y administradores |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta y un enlace para reclamarlo; `claim` vuelve a imprimir ese enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicación y monitorización |
| `deploy-hooks` | URLs secretas que un repositorio git o servicio de CI llama para desplegar el proyecto: listar, crear (la URL se muestra una sola vez), revocar. |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y cómo eliminarlas. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `sleep` | Suspender por inactividad: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, y `status` (por defecto). Suspendido, un proyecto no retiene CPU ni memoria y la siguiente petición lo despierta; las tareas programadas y en segundo plano no se ejecutan mientras tanto. Si un proyecto no puede suspenderse, el plano de control lo rechaza e indica la razón |
| `start`, `stop`, `restart` | Pausar un proyecto y reactivarlo. Un proyecto detenido mantiene su suscripción y abona únicamente su disco, o el mínimo mensual cuando el costo del disco es inferior; la fila **Billing** de la consola refleja lo que abona |
| `status`, `metrics`, `debug` | Qué está haciendo el proyecto y por qué motivo podría no responder |
| `alerts` | Los incidentes abiertos del proyecto, y cómo confirmarlos o posponerlos. |
| `cron` | Los cron jobs de la app desplegada y sus ejecuciones registradas, consultados con tu sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime los valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` guardó en `.env` como `REBASE_API_TOKEN`, entregada tras la reclamación; `rotate` la sustituye y revoca la anterior. Propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, con rol de administrador en la API propia de la app: cuándo se rotó por última vez; `rotate` genera una nueva para la app. Propietarios y administradores |
| `domains` | Dominios personalizados, registros DNS que deben añadirse y su verificación. Un proyecto puede atender peticiones en varios, cada uno verificado por separado; `verify` y `remove` aceptan el dominio sobre el cual operar, que solo puede omitirse si existe uno solo (para `verify`, uno aún pendiente). Cada dominio verificado sirve el proyecto como propio; `primary <domain>` designa el canónico y `redirect <domain>` redirige cualquier otro hacia este con un código 308, conservando ruta y parámetros (`--off` vuelve a servirlo directamente); aplícalo para `www.` junto a un dominio apex, dado que el inicio de sesión con Google, las cookies y las passkeys operan por origen. Un dominio asignado a una app específica (un `path` de app con hostname) nunca redirige. Un dominio apex (`example.com`, sin subdominio) requiere un registro **A**, pues el protocolo DNS no admite CNAME en la raíz. Dicha dirección corresponde al ingress de la plataforma y no se garantiza que permanezca inmutable: si la plataforma migra, un registro A seguirá apuntando a la dirección antigua. Si tu proveedor DNS ofrece ALIAS, ANAME o aplanamiento de CNAME (CNAME flattening) en el apex, apunta el apex al `tenantHost` del proyecto, el cual sigue a la plataforma automáticamente. El CNAME de un subdominio ya lo sigue por defecto. `list` indicará `verified, certificate pending` hasta que HTTPS responda con un certificado válido. `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Vincular o crear una base de datos, conectarse a ella desde tu máquina local, copias de seguridad, restauraciones y recuperación a un punto en el tiempo |
| `guests` | Usuarios invitados resultantes de inicios de sesión anónimos: contarlos, eliminar uno, purgar aquellos inactivos por un período prolongado. Consulta [Guests](/docs/cli/cloud/#guests). Propietarios y administradores |
| `extensions` | La lista de extensiones permitidas para Postgres (allowlist) |
| `storage` | Los buckets del proyecto y sus respectivas claves en [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Qué bases de datos y buckets aloja la plataforma, frente a lo declarado en el código |
| `compute` | Qué recursos reserva este proyecto, cuánto cuestan y cómo modificarlos |
| `events` | Historial de sucesos en el backend, los más recientes primero: escalado de la app, modificaciones de base de datos planificadas y aplicadas, conmutación a standby, expansión de disco |
| `usage` | Solicitudes consumidas este mes frente a la cuota incluida, y el exceso acumulado hasta el momento, tal como lo registra la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Clústeres sobre los que operan los tenants. Exclusivo para administradores de la plataforma |
| `settings`, `orgs`, `access`, `billing` | Configuración del proyecto, organizaciones, sus miembros e invitaciones, quién tiene acceso a un proyecto y pagos |
| `activity` | Registro de auditoría de la organización: quién desplegó, alteró una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications` | Destinos a los que se envían por POST los eventos del proyecto: Slack, Discord o cualquier URL https ([Notificaciones de Cloud](/docs/deployment/cloud-notifications/)) |

Cada grupo de esa tabla responde a `--help` con una página propia —una línea de
uso, sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Una prueba automatizada
supervisa el índice de las páginas, por lo que un grupo añadido sin ella hace fallar la
compilación en lugar de limitarse a mostrar la tabla de contenidos. `verify:docs` somete
la tabla misma a dicho índice: cada comando que la CLI despacha aparece aquí exactamente
una vez, de modo que un comando añadido sin su respectiva fila también hará fallar la compilación.

Cuando se canaliza por pipe, `--help` responde en formato JSON: la misma sintaxis de uso,
flags y ejemplos estructurados para su lectura programática en lugar de sesenta líneas
de caracteres de escape de terminal.

## Qué no incluye la beta

Sin selección de región, sin registro de autoservicio, sin SLA publicado, sin despliegues
por ramas, tokens que actúan en representación de personas, y sin endpoint de base de datos
público. [Qué no incluye la beta](/docs/deployment/cloud-beta-limits/) expone cada punto
con claridad, junto con lo que implica desplegar utilizando los secretos de producción.

## Autoalojamiento como alternativa

Nada de lo aquí expuesto genera dependencia obligatoria (vendor lock-in). La
[guía de autoalojamiento](/docs/deployment/self-hosting/) ejecuta la imagen y el bundle
idénticos con `docker compose`, y la [guía de Kubernetes](/docs/deployment/kubernetes/)
reproduce la misma topología a partir del chart de Helm.
