---
sourceHash: 325c29335f5ae263
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye la beta privada todavía.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que autohospedarías: la misma
imagen publicada de `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia es quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Hoy en día ejecuta tenants reales y se abre por
lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación necesitan una cuenta a la que se le haya dado acceso.
Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Qué obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Base de datos** | Un PostgreSQL gestionado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo |
| **Almacenamiento** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y cada uno se factura por lo que
reserva en lugar de por usuario (seat).

**Nada de tu proyecto cambia para ejecutarse allí.** El mismo repositorio
se autohospeda con `docker compose`, y la vía de escape es real: `rebase build`
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
detecta la sesión y la escribe en `~/.rebase/credentials.json`. Si no has
iniciado sesión en la consola, inicia sesión allí primero con lo que uses, Google
y GitHub incluidos. A través de SSH, `rebase cloud login --no-browser` imprime el enlace
para abrirlo en tu propia máquina.

`projects create` no toma argumentos posicionales. El nombre y el subdominio son
flags, y ambos son obligatorios; en una terminal se solicitan interactivamente, y una
ejecución headless que omita cualquiera de ellos finaliza con `input_required` en lugar de inventar
uno. **El subdominio no se puede editar después:** es el
host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un
paso de `link` separado. Escribe `.rebase/cloud.json`, que registra el id del proyecto
y el slug. Ese archivo no es un secreto ni contiene tus credenciales; estas residen
en `~/.rebase/credentials.json`, escrito por `login`.

Sin embargo, se incluye en el control de versiones con el código, de modo que un repositorio clonado puede nombrar cualquier
plano de control (control plane). Cuando el host proviene únicamente de ese archivo, y no es ni el de la
propia plataforma ni uno en el que hayas iniciado sesión anteriormente, `login` lo nombra y pregunta
antes de enviar tu correo electrónico y contraseña allí. Sin una terminal, o con
`--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí intencionalmente.

Para iniciar sesión sin el navegador, pasa tu correo electrónico: `rebase cloud login --email
me@example.com` te pedirá tu contraseña. **¿Te registraste con Google, GitHub o
LinkedIn?** Tu cuenta no tiene contraseña, así que usa un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo un código de 6 dígitos, válido durante diez minutos, y lo introduces
en el prompt. Con `--email` y sin contraseña, `rebase cloud login` pregunta
si deseas usar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar
correos electrónicos; si no puede, `--code` lo indica y finaliza con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` te pedirá luego el código de
tu aplicación de autenticación o uno de tus códigos de recuperación, independientemente de cómo hayas iniciado
sesión. A través del navegador, la consola lo solicita al iniciar sesión allí. Ni un código de inicio de sesión ni un segundo factor se pueden ingresar sin una terminal.
Para un script, crea un token de acceso en la consola (**Settings → Access
tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde con `invalid_credentials` junto con las mismas dos vías de acceso, ya que
la causa habitual es una cuenta que nunca tuvo una.

`billing setup` vincula una tarjeta a la organización, una sola vez. Está primero en la
secuencia a propósito: el primer despliegue de un proyecto se rechaza sin una, y
descubrir eso después de que un bundle haya terminado de subirse es el peor orden posible.

Después de eso, la página **Billing** de la consola lista las facturas de la organización,
cada una con la página alojada de Stripe y su PDF, y muestra una vista previa de la próxima factura de cada
proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming`
imprimen lo mismo. Ambos son para los propietarios (owners) y administradores (admins) de la organización. Donde la
plataforma lo ofrezca, **Manage billing** abre el portal de clientes de Stripe para
la tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no solicita
un segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta
es rechazada o el banco requiere confirmación del pago, la consola te lleva a
**Billing**, donde **Fix your card** guarda otra tarjeta y **Complete the
payment** abre la factura de Stripe.

El uso de un proyecto se muestra en su resumen general, bajo **Usage this month**, y
para todos los proyectos a la vez en la página **Billing**: solicitudes frente a la
cuota incluida (la barra se vuelve ámbar al 80%), errores 5xx, el exceso (overage) hasta el momento
y la proyección para el final del mes a este ritmo. El exceso se calcula con
el mismo código que lo reporta a Stripe, por lo que es lo que figurará en la factura;
aparece en la factura del mes siguiente. `rebase cloud usage` imprime lo
mismo, y `rebase cloud usage org` lo hace para toda la organización. Cualquier miembro puede
consultarlo. Las cifras indican lo que aún no pueden medir: el almacenamiento de objetos no se mide,
por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecute dos o más pods de app,
sus solicitudes no se contabilizan; y un día con muestras perdidas subestima el cómputo. Un
proyecto con escalado automático también muestra los pods que ejecutó por encima de `--replicas`, en pod-horas,
cuánto cuestan a sus propias tarifas y si esta plataforma los cobra todavía. Un
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

Un solo comando y ningún flag que recordar. El `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo
notifica sobre la marcha (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la aplicación en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta un estado terminal. El código de
salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Finaliza indicando dónde responde ahora cada aplicación y si la nueva versión está
activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que la dirección respondió tras la compilación: el `/health` de un backend
devolvió `ok` y la página de una app estática se cargó (desde este despliegue, cuando la
plataforma la sirve). La comprobación espera hasta `--live-timeout` segundos, 60 por
defecto; `0` la omite. Si una app no responde a tiempo, el despliegue aun así finaliza con
código cero, porque el despliegue se realizó correctamente, y la última línea indica qué app no
respondió y por qué. Un despliegue fallido termina en una sola línea, indicando la app y el
motivo, con `rebase cloud logs` para ver el registro de compilación completo.

Los scripts pasan `--json` para obtener un solo objeto con los mismos datos: `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de
`rebase cloud`, `deploy` no cambia a JSON por sí solo cuando se usa en una tubería (pipe).

Lo que permite ese runtime —paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños del cuerpo de la petición, el sistema de archivos, secretos, almacenamiento y red de
salida— se encuentra en su propia página:
[Runtime de backend gestionado](/docs/deployment/managed-runtime/).

Para enviar un artefacto que se compiló previamente —por ejemplo, un trabajo de CI que compila una vez y
despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime gestionado tiene su propio flag, `--eject`, y nada más lo
solicita: una compilación que trasladaría un proyecto gestionado a una imagen de contenedor de la que luego sea
propietario se rechaza hasta que lo indiques explícitamente. `--force` solía significar esto, lo que colocaba la
acción menos reversible de la CLI bajo la misma palabra que "sobrescribir este
archivo"; ahora es una opción desconocida en lugar de un alias, por lo que un script que la contenga
se detendrá en su lugar.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente tal como son. Cuando su `build` solo
copia scripts escritos a mano en `output`, nada los ha analizado sintácticamente, y un archivo
con un error tipográfico puede publicarse y evitar que la página se cargue. Por tanto, antes de subir
nada, `deploy` analiza sintácticamente cada archivo `.js`, `.mjs` y `.cjs` en el `output` de cada
app estática, junto con cada `<script>` inline en sus archivos `.html`. Esto
cubre tanto una app estática desplegada por sí sola como apps estáticas integradas en el
bundle del backend. Un error de sintaxis detiene el despliegue indicando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Se omiten los scripts inline que el navegador
no ejecuta como JavaScript: JSON, import maps, plantillas y cualquier
otro `type` que no sea JavaScript, los `<script src>` y los scripts que aún contengan
marcado de plantillas sin renderizar como `{{ }}`. Un archivo `.js` pasa la validación si se analiza correctamente como
un script clásico o como un módulo, ya que la página decide cuál de los dos es. No se lee nada
dentro de `node_modules`, ni tampoco un `--bundle-dir` precompilado.
`--no-verify` omite la comprobación para un despliegue puntual.

Monitorízalo:

```bash
rebase cloud logs               # el registro de compilación
rebase cloud logs --runtime -f  # lo que la app en ejecución imprime, en vivo, hasta pulsar Ctrl-C
rebase cloud status             # lo que la plataforma considera que el proyecto está haciendo
```

`status` informa de `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando genuinamente y hacer sondeos (polling) es lo correcto; cuando
nombra algo, ese algo está esperando una acción tuya.

Uno de ellos es `email_not_configured`: la app activó el inicio de sesión mediante magic link o
código por correo electrónico (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) y no tiene servicio de correo configurado, por
lo que el despliegue está activo pero nadie puede iniciar sesión en él. Rebase Cloud no envía
correos por tu aplicación: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y
`SMTP_FROM` con `rebase cloud env set`, y luego despliega. `status` lo lee desde el
propio `GET /api/auth/config` de la aplicación (su campo `unavailable`), y `deploy` muestra
lo mismo bajo su comprobación de estado activo (live check).

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que haría `deploy`, pero lo sirve en una dirección
propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa
sirviendo lo que servía antes. El despliegue imprime la dirección de la preview cuando la
compilación finaliza.

Para mantener una misma dirección entre despliegues, asigna un nombre a la preview. Desplegar con el mismo
nombre de nuevo la actualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Con qué se comunica una preview depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus aplicaciones estáticas
  integradas, de la misma forma en que las ejecuta producción. Obtiene un backend propio en
  una **base de datos propia vacía**, nunca la de producción. Iniciar contra la
  base de datos de producción aplicaría el esquema y las reglas de acceso de la preview a esta.
- **`rebase cloud deploy web --preview`** previsualizaría una app estática por sí
  sola, con sus páginas llamando al backend de **producción**. Eso requiere un plano de control
  que sirva sitios estáticos por sí mismos, y Rebase Cloud aún no lo hace: lo
  rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. En su lugar, previsualiza el
  backend, que sirve las aplicaciones estáticas integradas en él; un proyecto sin
  backend gestionado aún no se puede previsualizar.

Una preview no sube código fuente ni registra aplicaciones ni nombres de host, ya que cualquiera
de esas acciones modificaría el proyecto de producción. `--source` y `--eject` no se pueden
combinar con `--preview`. Cada uno de ellos compila una imagen de contenedor para producción.

```bash
rebase cloud previews                      # nombre, dirección, app, backend, caducidad
rebase cloud logs --preview new-checkout   # su registro de compilación; -f sigue una compilación aún en curso
rebase cloud logs --runtime --preview new-checkout -f  # lo que imprime su backend
rebase cloud previews delete new-checkout  # deja de servirla y elimina su base de datos
```

`rebase cloud logs` sin `--preview` es siempre el de producción.

La página **Deployments** de la consola lista las mismas previews, y permite abrir, mostrar el
registro de compilación o eliminar cada una. Crearlas sigue siendo un paso exclusivo de la CLI.

Una preview caduca una semana después de su último despliegue.

Cuando finaliza, el despliegue comprueba que la dirección de la preview responda, igual que hace un
despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). El certificado de una nueva
preview puede tardar un minuto o dos, por lo que un despliegue exitoso puede
indicar que la dirección aún no responde.

Una preview de backend se factura como una unidad de app en el tamaño por defecto (100m de CPU
y 384 MiB de memoria, a la tarifa de tu app para su región y capacidad),
prorrateada durante el tiempo que exista, y aparece en la estimación mensual del
proyecto en la consola. `rebase cloud deploy --preview` imprime la misma estimación para
ella, por mes (`cost` bajo `--json`). Iniciar una requiere una tarjeta registrada, al igual que un despliegue de producción. Un primer despliegue que
falle antes de que nada se ejecute se elimina en lugar de facturarse. Un proyecto puede ejecutar hasta
tres previews de backend a la vez.

Cada nueva dirección de preview obtiene su propio certificado TLS de Let's Encrypt,
que permite a un dominio 50 nuevos certificados por semana, compartidos con todos los sitios de producción en él.
Las previews pueden tomar 20 de ellos en cualquier período de 7 días, en toda la plataforma. Pasado
ese límite, se rechaza una nueva preview (`429`, `preview_cert_budget`) indicando cuándo se podrá
desplegar; redesplegar una preview ya existente nunca cuenta para este límite.

La base de datos de una preview de backend es una segunda base de datos en el Postgres de **producción**:
sus propios datos, pero la misma instancia y el mismo disco. Está limitada a 10
conexiones, para que las previews no agoten las de producción, y a 2 GB: una preview
cuya base de datos supere ese tamaño se pausa. Su backend se detiene, su dirección deja de
responder, `rebase cloud previews` y la consola la muestran como `paused` con el
motivo, y los propietarios y administradores del proyecto reciben una notificación (`preview.paused`). Sus
datos se conservan hasta que expire. Despliégala de nuevo para iniciarla (se pausará de nuevo
si la base de datos sigue siendo demasiado grande) o elimínala. Una preview pausada se sigue
facturando hasta que se elimine o caduque. Elimina las previews que ya no necesites. Las extensiones instaladas en producción no se
instalan en la base de datos de una preview.

Las previews se están implementando gradualmente. Un plano de control que aún no las admita rechazará
`--preview` con `previews_unavailable` y no desplegará nada.

## Revertir un despliegue

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso
anterior, y nunca vuelve a compilar: el valor de un rollback reside en que envía un
artefacto que ya se ha ejecutado.

Qué despliegues califican depende de cómo se despliega el proyecto, y ambos tipos
funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión del runtime que el proyecto ejecuta actualmente |

Las apps estáticas integradas en el bundle del backend (un `rebase cloud deploy` estándar en un
proyecto con backend) forman parte de ese bundle, por lo que revierten junto con él.

Una app estática desplegada por sí sola (`rebase cloud deploy <app>`) todavía no se puede
revertir. Su despliegue registra qué app publicó, pero ningún bundle, por lo que el
plano de control no tiene nada a partir de lo cual restaurarla. La solución es desplegar de nuevo la última versión
correcta, por ejemplo desde el commit anterior al defectuoso. Tras dicho
despliegue, `deploy` indica esto en lugar de apuntar a `rollback`, y un `rollback`
sin id se rechaza en lugar de volver a desplegar el backend que está sirviendo.

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que implica un
proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments`
marca los que califican, y `--json` reporta `rollbackable` por cada fila junto
con la `image` o `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuáles: uno que no tuvo éxito
y uno anterior a que la plataforma registrara su artefacto. No hay nada que suponer
en ningún caso —suponer enviaría lo que se haya compilado o subido más
recientemente mientras afirma restaurar este—, así que en su lugar despliega la versión deseada.

Cada despliegue exitoso termina nombrando la forma de volver atrás (`rebase cloud rollback`),
de modo que esté a la vista en el momento en que se detecte una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que
la versión restaurada empiece a servir tráfico antes de informar del éxito. Puedes seguirlo con
`rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada se puede recuperar a cualquier minuto dentro de su ventana de recuperación,
desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Se realiza en dos pasos. En primer lugar, se prepara (stage) una copia recuperada junto a la base de datos activa;
tu aplicación sigue ejecutándose en la activa y el almacenamiento de la copia se factura hasta que
realices la transición (cutover) o la descartes.
Luego, una vez lista la copia, la transición redirige la aplicación hacia ella y la
reinicia. Todo lo escrito después del tiempo objetivo no estará en la copia. La base de datos
original se conserva como vía de retorno y continúa facturando almacenamiento; volver a cambiar a ella,
eliminarla o realizar una segunda restauración requiere contactar con soporte. Solo un propietario o administrador
puede preparar, realizar la transición o descartar, y la consola solicita el nombre del proyecto
antes de ejecutar la transición.

## Protege tu cuenta

Tu cuenta de la consola tiene acceso a bases de datos de producción, secretos y facturación, así
que protégela en consecuencia. Abre **Account security** desde el menú situado bajo tu avatar
en la consola (o ve a `/account`). La página es tuya, no de una
organización: lo que configures allí se aplica a todas las organizaciones a las que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password,
  Google Authenticator, Authy). La página muestra una clave de configuración para agregarla a la app, o un
  enlace que abre la app con la clave precargada en un teléfono, y luego solicita el
  código de 6 dígitos que muestra la app. A partir de entonces, cada inicio de sesión solicitará un código,
  ya sea que inicies sesión con contraseña, Google o GitHub.
- **Códigos de recuperación.** Activarla te proporciona diez códigos de un solo uso, que se muestran una única vez.
  Cada uno te permite iniciar sesión en lugar del código de autenticación si pierdes tu
  teléfono, así que guárdalos antes de cerrar el cuadro de diálogo. **New recovery codes**
  los reemplaza, y los anteriores dejan de funcionar. Tanto desactivar la verificación en dos pasos
  como obtener nuevos códigos solicitan un código previo para confirmar.
- **Contraseña.** Cambiarla cierra la sesión en todos los demás dispositivos. Una cuenta
  creada con Google, GitHub o LinkedIn no tiene contraseña; la página ofrece
  enviarte un enlace por correo para definir una.
- **Dispositivos con sesión iniciada.** Cada navegador y terminal con sesión iniciada en tu cuenta,
  con su dirección y la fecha en que inició sesión. Cierra la sesión en cualquier dispositivo que no
  reconozcas, o en todos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no solicitan un segundo
factor, por lo que CI continuará desplegando después de que lo actives. Revoca cualquier token en el que ya no
confíes en **Settings → Access tokens**.

## Invita a tu equipo

**Members → Add member** añade a alguien que ya tenga una cuenta de Rebase con una
dirección de correo verificada, como administrador (admin) o miembro (member); un propietario (owner) puede ascenderlo a propietario
después. Tienen acceso de inmediato y no se envía ningún correo electrónico. Rebase Cloud aún
no envía invitaciones, por lo que debes pedirle a un compañero de equipo sin cuenta que se registre y
verifique su dirección primero. Desde una terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), el cual
avisa si la dirección no tiene una cuenta asociada.

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los
propietarios y administradores de la organización quién desplegó, definió o reveló una variable de entorno
(por nombre, nunca por valor), cambió un dominio, restauró una copia de seguridad,
redimensionó, detuvo o eliminó un proyecto, cambió el rol de un miembro o creó un
token, y cuándo. La sección **Settings** de un proyecto enlaza a sus propias entradas; una entrada
sobre un proyecto eliminado se conserva. Un script puede leerlo con un token creado con
`--can audit` en la organización. Las entradas se conservan durante un año. Los filtros se encuentran en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no debería llevar tu contraseña. Otórgale un token limitado a
unas pocas acciones en un solo proyecto, creado desde una terminal con sesión iniciada mediante
`rebase cloud tokens create --project shop --can deploy,logs`, y establécelo como
`REBASE_TOKEN`. La facturación, el registro de actividad y la configuración de notificaciones
de una organización son capacidades propias (`--can billing`, `audit`,
`notifications`) que un token tiene únicamente cuando se solicitan explícitamente. Las capacidades, un
flujo de trabajo de GitHub Actions y lo que permanece restringido a una persona con sesión iniciada están en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` le da a una app un backend activo antes de que nadie se haya
registrado, e imprime una URL de reclamación (claim URL) para que la persona lo conserve; un proyecto que nadie reclame
en 72 horas se elimina. Lo que puede hacer el token de un proyecto no reclamado, el
`REBASE_API_TOKEN` que escribe y lo que cambia al reclamarlo se detallan en
[Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y lo que cuesta

El precio de un proyecto se calcula a partir de lo que reserva, no de un nivel fijo (tier). `compute` imprime
cada parámetro de ajuste y el presupuesto desglosado del propio plano de control para ellos. (`rebase cloud
resources` es algo diferente: las bases de datos y buckets que declara el código,
y si cada uno está aprovisionado; consulta la [referencia de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, ej. `500m` y `2Gi`. Vacío significa el valor predeterminado de la plataforma, que depende de la región (abajo) |
| `--replicas` | Instancias que siempre existen: el mínimo del autoescalador y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar. Las instancias que el autoescalador añade por encima de `--replicas` se miden por pod-segundo a las mismas tarifas y se cobran solo donde la plataforma lo tenga habilitado; **Usage this month** indica dónde. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoescalador, respecto a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (preemptible): más económica y reiniciada sin previo aviso |
| `--db-instances` | 1–3. `1` es una sola instancia sin conmutación por error (failover); `2` añade una réplica de respaldo automática (standby) |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no es lo mismo que uno fijado al mismo número: un parámetro vacío
sigue el valor predeterminado de la plataforma y cambia cuando este cambia.

En Bélgica (europe-west1), el valor predeterminado reserva 100m de CPU y 384Mi y puede alcanzar picos (burst)
de hasta 2 CPU y 2 GiB; en Falkenstein y Helsinki, la memoria puede extenderse hasta 1,4× la
solicitud y la CPU hasta 10× (máximo 1,7 vCPU). `rebase cloud compute` muestra las cifras de tu
proyecto.

La CLI no valida nada a propósito: los límites pertenecen al clúster en el que
se ejecuta un proyecto y difieren entre proveedores. El plano de control rechaza cualquier
valor que no pueda cumplir e indica el campo correspondiente. Ejecuta `rebase cloud compute` para ver
el importe en €/mes antes y después; un cambio se aplica de inmediato, prorrateado desde el día de hoy.
Un cambio en la base de datos se aplica al momento; se factura al tamaño actual hasta que esté en ejecución.
Una nueva asignación de CPU o memoria para la base de datos, o una reducción de instancias, reinicia la base de datos (aproximadamente
entre 30 segundos y 3 minutos; las conexiones se pierden y se vuelven a conectar): `compute set`
lo advierte y solicita confirmación, y fuera de una terminal `--yes` representa el consentimiento. Si ese reinicio
falla, `rebase cloud compute apply` vuelve a intentarlo.

## El resto de la superficie

| Grupo de comandos | Qué cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token bearer que la CLI enviaría ahora, para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Agregar un servidor Rebase autohospedado a tu cuenta, de modo que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude pueda acceder a él junto a tus proyectos de Cloud. `--list` los muestra, `--remove` elimina uno. Para propietarios y administradores |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta y un enlace para reclamarlo; `claim` imprime ese enlace de nuevo. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitorización |
| `deploy-hooks` | URLs secretas a las que un host de Git o CI llama para desplegar el proyecto: listar, crear (la URL se muestra una sola vez), revocar. |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y cómo eliminarlas. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `sleep` | Suspender cuando esté inactivo: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` y `status` (por defecto). Suspendido, un proyecto no retiene CPU ni memoria y la siguiente petición lo reactiva; los trabajos programados y tareas en segundo plano no se ejecutan mientras tanto. Donde un proyecto no pueda suspenderse, el plano de control lo rechaza e indica el motivo |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma facture a los proyectos detenidos solo por el almacenamiento y la tarifa de plataforma; la fila **Billing** de la consola lo indica cuando es así |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `alerts` | Los incidentes abiertos del proyecto, y cómo reconocerlos (acknowledge) o posponerlos (snooze). |
| `cron` | Los cron jobs de la app desplegada y sus ejecuciones registradas, leídos con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, transferida en la reclamación; `rotate` la reemplaza y revoca la anterior. Para propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin en la propia API de la app: cuándo se rotó por última vez; `rotate` le da una nueva a la aplicación. Para propietarios y administradores |
| `domains` | Dominios personalizados, los registros DNS a añadir y la verificación. Un proyecto puede responder en varios, cada uno verificado por separado; `verify` y `remove` toman el dominio sobre el que actuar, el cual solo puede omitirse cuando hay uno solo (para `verify`, uno aún pendiente). Cada dominio verificado sirve el proyecto como propio; `primary <domain>` elige el canónico y `redirect <domain>` responde a otro con una redirección 308 hacia él, manteniendo la ruta y la query (`--off` vuelve a servirlo directamente) —haz esto para `www.` junto a un dominio apex, ya que el inicio de sesión de Google, las cookies y las passkeys funcionan por origen. Un dominio en el que se sirve una app (una ruta `path` de app con un nombre de host) nunca redirige. Un dominio apex (`example.com`, sin subdominio) requiere un registro **A**, porque el DNS no permite CNAME allí. Esa dirección es el ingress de la plataforma y no se garantiza que permanezca invariable: si la plataforma se traslada, un registro A seguirá apuntando a la dirección antigua. Si tu proveedor de DNS ofrece registros ALIAS, ANAME o aplanamiento de CNAME (CNAME flattening) en el apex, apunta el apex al `tenantHost` del proyecto en su lugar, el cual sigue los cambios de la plataforma. El CNAME de un subdominio ya lo sigue automáticamente. `list` indica `verified, certificate pending` hasta que HTTPS responda con un certificado real. `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo |
| `guests` | Los usuarios invitados dejados por el inicio de sesión anónimo: contarlos, eliminar uno, purgar los que no se han visto durante mucho tiempo. Consulta [Guests](/docs/cli/cloud/#guests). Para propietarios y administradores |
| `extensions` | La lista de extensiones de Postgres permitidas |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Lo que reserva este proyecto, cuánto cuesta y cómo cambiarlo |
| `events` | Lo que ocurrió en el backend, del más reciente al más antiguo: escalado de la app, cambios de base de datos programados y aplicados, una réplica en espera asumiendo el control, crecimiento del disco |
| `usage` | Solicitudes utilizadas este mes respecto a la cuota incluida, y el exceso hasta ahora, tal como lo contabiliza la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Solo para administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, pago |
| `activity` | El registro de auditoría de la organización: quién desplegó, cambió una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Para propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications` | Dónde se envían (POST) los eventos del proyecto: Slack, Discord o cualquier URL https ([Notificaciones de Cloud](/docs/deployment/cloud-notifications/)) |

Cada grupo en esa tabla responde a `--help` con una página propia —una línea de uso,
sus flags y ejemplos— y `--help` nunca ejecuta el comando. Una prueba comprueba el
índice respecto a las páginas, de modo que un grupo añadido sin una falla la compilación en lugar de
responder con la tabla de contenidos. `verify:docs` vincula la tabla misma a
ese índice: cada grupo gestionado por la CLI aparece aquí exactamente una vez, por lo que un grupo
añadido sin una fila también hará fallar la compilación.

Al usarse mediante tubería (pipe), `--help` responde en JSON en su lugar: la misma línea de uso, flags y ejemplos
en forma de estructura legible en vez de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Expuesto con total claridad, porque enterarse más tarde es peor:

- **Sin elección de región.** Todo se ejecuta en una sola región a día de hoy. El modelo de ubicación
  existe en la plataforma, pero un proyecto no puede elegir una región.
  `projects create --provider` y `--region` no son la excepción que parecen
  ser: registran a cuál de los destinos de despliegue registrados del plano de control pertenece un
  proyecto, y solo hay uno, por lo que ambos toman ese valor por defecto y ninguno traslada un
  proyecto a otro lugar. `rebase cloud projects create --help` indica lo mismo.
- **No es de autoservicio.** El acceso se concede por lotes; no existe un flujo de registro y pago directo.
- **Sin SLA publicado** ni certificación SOC 2. Si necesitas alguno de ellos, indícalo al solicitar
  acceso en lugar de darlo por sentado.
- **Sin despliegues por rama** y sin GitHub App oficial de primera parte. Los deploy hooks —URLs secretas
  a las que apuntas un webhook de repositorio— son el mecanismo de automatización admitido. Los [despliegues de
  preview](#previsualizar-un-cambio) se están implementando gradualmente y se inician desde la CLI.
- **Los tokens actúan como una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) es emitido por una cuenta
  y actúa en su nombre; todavía no existe una identidad de máquina propiedad de la organización. Si
  inicias sesión desde CI en su lugar, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD`
  desde un gestor de secretos; `--password` coloca la contraseña en el historial de tu shell y
  en la tabla de procesos, y te lo advierte antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio especifica un plano de control distinto al de la propia plataforma, pásalo
  también como `--url`: sin una terminal, `login` se niega a enviar una contraseña a un
  host especificado únicamente en el archivo clonado.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no está expuesta a
  internet, por lo que el host que muestra la consola es la dirección interna que usa tu backend y
  no resuelve nada en tu máquina local. `rebase cloud db connect` abre un puerto local conectado a
  esa base de datos, canalizado a través de un túnel mediante el plano de control mientras
  lo mantengas en ejecución, pero no existe un nombre de host permanente al que pueda conectarse un servicio de terceros.
  Para ejecutar SQL sin un cliente de Postgres local,
  `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` abre el
  mismo túnel para una consulta, ejecuta el texto como un único script (deteniéndose ante el primer
  error) e imprime lo que respondió cada sentencia (`--json` para scripts). Ese túnel, y la contraseña tras
  `rebase cloud db info --reveal`, requieren el rol de propietario (owner) o administrador (admin)
  de la organización: el mismo que solicita el editor SQL de Studio, ya que los tres desembocan en una
  sesión sobre tus datos de producción.
- **Desplegar implica ejecutar código con los secretos de producción.** El entorno
  de la aplicación contiene `REBASE_SERVICE_KEY` (admin en su propia API),
  `DATABASE_URL` y `JWT_SECRET`, por lo que el código que un miembro despliegue puede leerlos,
  aunque solo los propietarios y administradores puedan revelarlos en la consola. Invita
  como miembro únicamente a personas a quienes confiarías esos valores.
- **La service key puede ser reemplazada.** La sección **Settings** del proyecto
  (o `rebase cloud service-key rotate`) emite una nueva `REBASE_SERVICE_KEY`
  y reinicia la aplicación con ella. La clave antigua funciona hasta que el reinicio haya
  finalizado, y no después, por lo que cualquier servicio que la haya copiado será rechazado a partir
  de ese momento. Reclamar un proyecto realiza la misma operación.

## Autohospedaje como alternativa

Nada de esto implica un bloqueo de proveedor (vendor lock-in). La [guía de autohospedaje](/docs/deployment/self-hosting/)
ejecuta la imagen y el bundle idénticos con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) representa la misma topología a partir del
Helm chart.
