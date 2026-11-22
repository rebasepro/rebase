---
sourceHash: a6cdd8811eca0897
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la misma
imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Ya gestiona tenants reales hoy en día y se abre
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta a la que se le haya concedido acceso.
Todo lo demás en este sitio funciona sin necesidad de una.
:::

## Qué es

Un **proyecto** en Cloud consta de tres elementos que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Database** | Un PostgreSQL gestionado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Storage** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

La aplicación y la base de datos se aprovisionan en el primer despliegue; un bucket únicamente
cuando lo solicitas ([Almacenamiento de archivos](#almacenamiento-de-archivos)). Cada recurso se factura por lo que
reserva y no por usuario/asiento.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se puede
autoalojar con `docker compose`, y la alternativa de salida es real: `rebase build`
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
captura la sesión y la guarda en `~/.rebase/credentials.json`. Si no has
iniciado sesión en la consola, hazlo primero con el método que utilices, incluidos
Google y GitHub. A través de SSH, `rebase cloud login --no-browser` imprime el enlace
para que lo abras en tu propia máquina.

`projects create` no acepta argumentos posicionales. El nombre y el subdominio son
flags y ambos son obligatorios; en un terminal se solicitan interactivamente, y una
ejecución desatendida (headless) que omita cualquiera de ellos finaliza con `input_required` en lugar de inventar
uno. **El subdominio no se puede editar posteriormente:** es el host
`<slug>.rebase.website` en el que responderá el proyecto, así que elígelo deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no existe un
paso `link` separado. Escribe `.rebase/cloud.json`, que registra el id del proyecto
y el slug. Ese archivo no es un secreto ni contiene tus credenciales; estas residen
en `~/.rebase/credentials.json`, escritas por `login`.

Sin embargo, se incluye en el control de versiones con el código, por lo que un repositorio clonado puede indicar cualquier plano de control.
Cuando el host proviene únicamente de ese archivo y no es el propio de la plataforma
ni uno en el que hayas iniciado sesión antes, `login` lo menciona y pide confirmación
antes de enviar tu correo electrónico y contraseña allí. Sin un terminal, o con
`--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí intencionadamente.

Para iniciar sesión sin el navegador, pasa tu correo electrónico: `rebase cloud login --email
me@example.com` te pedirá tu contraseña. **¿Te registraste con Google, GitHub o
LinkedIn?** Tu cuenta no tiene contraseña, así que utiliza un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido durante diez minutos, y lo introduces
en el prompt. Con `--email` y sin contraseña, `rebase cloud login` te preguntará
si deseas usar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar
correos electrónicos; si no es posible, `--code` lo advertirá y finalizará con `otp_unavailable`.

Si activaste la autenticación de dos factores, `login` te solicitará el código de
tu aplicación de autenticación, o uno de tus códigos de recuperación, independientemente del método con el que hayas
iniciado sesión. A través del navegador, la consola te lo pedirá al iniciar sesión allí. Ni un código de inicio de sesión ni un segundo factor se pueden introducir sin un terminal.
Para un script, crea un token de acceso en la consola (**Settings → Access
tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responderá `invalid_credentials` ofreciendo las mismas dos alternativas de acceso, ya que
la causa habitual suele ser una cuenta que nunca tuvo contraseña.

`billing setup` asocia una tarjeta a la organización, una sola vez. Se sitúa al
principio de la secuencia intencionadamente: el primer despliegue de un proyecto se rechaza si no hay una tarjeta registrada, y
descubrirlo después de haber terminado de subir un bundle es el peor orden posible.

A partir de ahí, la página **Billing** de la consola listará las facturas de la organización,
cada una con la página alojada de Stripe y su PDF, y mostrará la vista previa de la próxima factura de cada
proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming`
imprimen lo mismo. Ambos son para propietarios y administradores de la organización. Donde la
plataforma lo ofrezca, **Manage billing** abrirá el portal de clientes de Stripe para gestionar la
tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no solicitará
ningún pago adicional: el proyecto se facturará a esa tarjeta y se desplegará. Si la tarjeta
es rechazada o el banco exige confirmar el pago, la consola te redirigirá a
**Billing**, donde **Fix your card** guardará otra tarjeta y **Complete the
payment** abrirá la factura en Stripe.

El consumo de un proyecto se muestra en su vista general, bajo **Usage this month**, y
para todos los proyectos simultáneamente en la página **Billing**: solicitudes frente a la
cuota incluida (la barra cambia a color ámbar al alcanzar el 80%), errores 5xx, el exceso acumulado hasta el momento
y la proyección para el mes a este ritmo. El exceso se calcula con
el mismo código que lo notifica a Stripe, por lo que coincide exactamente con lo que figurará en la factura;
aparece en la factura del mes posterior. `rebase cloud usage` imprime
lo mismo, y `rebase cloud usage org` lo hace para toda la organización. Cualquier miembro puede
consultarlo. Las cifras indican lo que aún no pueden medir: el almacenamiento de objetos no se mide,
por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecute dos o más pods de app,
sus solicitudes no se contabilizan; y un día con muestras perdidas cuenta de menos. Un
proyecto con escalado automático también muestra los pods ejecutados por encima de `--replicas`, en horas de pod,
lo que costaron según sus propias tarifas y si esta plataforma los cobra todavía. Un
proyecto reclamado desde un agente solo contabiliza los días a partir de la reclamación: antes de
ella, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crearlo de nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando y ningún flag que recordar. El archivo `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo
indica sobre la marcha (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la aplicación en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta un estado terminal. El código de
salida es el veredicto, por lo que la misma instrucción funciona de forma desatendida en CI.

Termina indicando en qué dirección responde ahora cada aplicación y si la nueva versión está
activa en ella:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

«Live» significa que la dirección respondió tras la compilación: el endpoint `/health` de un backend
devolvió `ok`, y la página de una app estática cargó correctamente (desde este despliegue, cuando la
plataforma la sirve). La comprobación espera hasta un máximo de `--live-timeout` segundos, 60 por
defecto; `0` la omite. Si una app no responde a tiempo, el comando deploy finaliza igualmente con código
cero, porque el despliegue tuvo éxito, y la última línea especifica qué app no
respondió y por qué. Un despliegue fallido concluye en una sola línea, indicando la aplicación y la
causa, y remite a `rebase cloud logs` para consultar el registro de compilación completo.

Los scripts pueden pasar `--json` para recibir un único objeto con los mismos datos: `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de
`rebase cloud`, `deploy` no cambia automáticamente a JSON cuando se canaliza a través de un pipe.

Todo lo que ese runtime permite —paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños de cuerpo, sistema de archivos, secretos, almacenamiento y red
saliente— se detalla en su propia página:
[Runtime de backend gestionado](/docs/deployment/managed-runtime/).

Para desplegar un artefacto compilado previamente —por ejemplo, un pipeline de CI que compila una vez y
despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime gestionado requiere su propio flag, `--eject`, y ninguna otra acción lo
solicitará: una compilación que trasladaría un proyecto gestionado a una imagen de contenedor de la que luego sea
responsable será rechazada hasta que lo indiques explícitamente. Anteriormente `--force` significaba esto, lo cual situaba la acción
menos reversible de la CLI bajo la misma palabra que "sobrescribir este
archivo"; ahora es una opción desconocida en lugar de un alias, por lo que cualquier script que la incluya
se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una aplicación estática se sirven exactamente tal como están. Si su paso de `build` se limita
a copiar scripts manuales en `output`, ningún analizador los habrá procesado, y un archivo
con una errata puede llegar a producción e impedir que la página cargue. Por tanto, antes de
subir nada, `deploy` analiza sintácticamente cada archivo `.js`, `.mjs` y `.cjs` en el directorio `output`
de cada app estática, junto con cada `<script>` en línea dentro de sus archivos `.html`. Esto
abarca tanto aplicaciones estáticas desplegadas de forma individual como aquellas integradas en el
bundle del backend. Un error de sintaxis detendrá el despliegue mostrando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` el `code` del error será `syntax_error`. Se omiten los scripts en línea que un navegador
no ejecuta como JavaScript: JSON, import maps, plantillas y cualquier otro `type`
distinto de JavaScript, las etiquetas `<script src>`, y aquellos scripts que aún contengan
marcado de plantillas sin renderizar como `{{ }}`. Un archivo `.js` pasa la validación si se analiza
correctamente como script clásico o como módulo, ya que es la página quien determina cuál es. No
se analiza nada dentro de `node_modules`, ni tampoco un `--bundle-dir` precompilado.
`--no-verify` omite esta validación para un despliegue puntual.

Monitorización:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` informa de `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está operando con normalidad y esperar mediante sondeos (polling) es la acción correcta; cuando indica
algún valor, ese elemento está esperando tu intervención.

Uno de ellos es `email_not_configured`: la app habilitó el inicio de sesión por enlace mágico o
código por correo (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) pero carece de servicio de correo, por lo que
el despliegue está en vivo pero nadie puede autenticarse. Rebase Cloud no envía correos
por tu app: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y
`SMTP_FROM` mediante `rebase cloud env set`, y después despliega. `status` extrae esta información del
propio `GET /api/auth/config` de la aplicación (su campo `unavailable`), y `deploy` notificará
lo mismo en su comprobación activa.

## Almacenamiento de archivos

Un proyecto nuevo no incluye ningún bucket: las subidas se rechazarán con `501 STORAGE_NOT_CONFIGURED`,
y el resumen del despliegue así lo advertirá, evitando escribir en un disco efímero que cada despliegue sustituye.

Asígnale una de las dos alternativas y vuelve a desplegar para que la app la reconozca:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` lista los buckets del proyecto. Un proyecto con múltiples buckets
vincula cada uno mediante `--source <key>`; uno que configure el almacenamiento mediante código no necesita ninguno de los dos.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que `deploy`, pero lo sirve en una dirección
independiente, como `https://shop--k3x9ab.rebase.website`. El entorno de producción continúa
sirviendo lo que tenía antes. El comando deploy imprimirá la dirección de previsualización al
concluir la compilación.

Para mantener una dirección fija entre despliegues, asigna un nombre a la previsualización. Desplegar
con ese mismo nombre la actualizará:

```bash
rebase cloud deploy --preview-name new-checkout
```

El entorno con el que interactúa una previsualización dependerá de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus aplicaciones estáticas
  integradas, exactamente de la misma manera en que se ejecutan en producción. Obtiene un backend propio sobre una
  **base de datos vacía e independiente**, nunca la de producción. Iniciar contra
  la base de datos de producción aplicaría sobre ella el esquema y las reglas de acceso de la previsualización.
- **`rebase cloud deploy web --preview`** previsualizaría una aplicación estática aislada,
  cuyas páginas se comunicarían con el backend de **producción**. Esto requiere un plano de control
  capaz de servir sitios estáticos de forma autónoma, y Rebase Cloud aún no dispone de ello:
  rechazará la acción con `PREVIEW_STATIC_UNSERVED` y no publicará nada. En su lugar, previsualiza
  el backend, que servirá las aplicaciones estáticas integradas en él; un proyecto sin
  backend gestionado aún no puede previsualizarse.

Una previsualización no sube código fuente ni registra aplicaciones o hostnames, ya que cualquiera
de esas acciones alteraría el proyecto de producción. `--source` y `--eject` no pueden
combinarse con `--preview`. Ambos compilan una imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

Ejecutar `rebase cloud logs` sin `--preview` siempre mostrará los logs de producción.

La página **Deployments** de la consola lista estas mismas previsualizaciones, permitiendo abrirlas,
ver su log de compilación o eliminarlas. Su creación sigue requiriendo el uso de la CLI.

Una previsualización caduca una semana después de su último despliegue.

Al finalizar, el proceso comprueba que la dirección de la previsualización responda, al igual que en
un despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). La emisión del certificado
para una nueva previsualización puede tardar uno o dos minutos, por lo que un despliegue exitoso podría
indicar temporalmente que la dirección aún no responde.

Una previsualización de backend se factura como una unidad de aplicación en su tamaño predeterminado (100m de CPU
y 384 MiB de memoria, a la tarifa correspondiente a la región y capacidad de tu aplicación),
prorrateada por el tiempo que permanezca activa, figurando en la estimación
mensual del proyecto en la consola. `rebase cloud deploy --preview` muestra esa misma estimación mensual
(`cost` bajo `--json`). Iniciar una previsualización requiere una tarjeta registrada, al igual que un despliegue
de producción. Si el primer despliegue falla antes de iniciar la ejecución, se descarta y no se factura.
Un proyecto puede mantener hasta tres previsualizaciones de backend simultáneas.

Cada nueva dirección de previsualización recibe su propio certificado TLS de Let's Encrypt,
autoridad que concede un límite de 50 certificados nuevos por semana por dominio, compartidos con todos
los sitios de producción en él. Las previsualizaciones pueden consumir hasta 20 de ellos en cualquier período de 7 días
en toda la plataforma. Superado este límite, cualquier nueva previsualización será denegada (`429`, `preview_cert_budget`)
indicando el momento en que podrá desplegarse; volver a desplegar una previsualización ya existente no consume cuota.

La base de datos de una previsualización de backend es una segunda base de datos en el Postgres de **producción**:
cuenta con sus propios datos, pero comparte instancia y disco. Está restringida a 10
conexiones para evitar agotar las de producción, y a un espacio de 2 GB: una previsualización cuya
base de datos sobrepase dicho tamaño se pausará. Su backend se detendrá, su dirección dejará de
responder, `rebase cloud previews` y la consola la mostrarán en estado `paused` junto con el
motivo, y se notificará a los propietarios y administradores (`preview.paused`). Sus
datos se conservarán hasta su caducidad. Despliégala de nuevo para reiniciarla (volverá a pausarse
si la base de datos continúa excediendo el límite) o elimínala. Una previsualización pausada seguirá
facturándose hasta ser eliminada o expirar. Elimina aquellas previsualizaciones que ya no uses. Las extensiones instaladas en producción no se
instalan en la base de datos de una previsualización.

Las previsualizaciones se están desplegando de forma gradual. Un plano de control que aún no las soporte
rechazará `--preview` con el error `previews_unavailable` y no realizará ningún despliegue.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

Una reversión (rollback) vuelve a apuntar el proyecto a lo que entregó un despliegue exitoso
anterior y nunca recompila: el verdadero valor de un rollback reside en poner en marcha un
artefacto cuya ejecución previa ya ha sido contrastada.

Los despliegues que califican dependen del modo en que se despliega el proyecto, y ambos
son compatibles:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde origen) | La imagen publicada por esa compilación |
| `rebase cloud deploy --bundle` (runtime de la plataforma) | El bundle entregado en dicho despliegue, sobre la versión de runtime en ejecución |

Las apps estáticas integradas en el bundle del backend (un `rebase cloud deploy` estándar
en un proyecto con backend) forman parte de ese bundle y se revierten conjuntamente con él.

Una app estática desplegada individualmente (`rebase cloud deploy <app>`) aún no admite
rollback. Su registro almacena qué aplicación fue publicada, pero ningún bundle, impidiendo al
plano de control disponer de una base de restauración. La alternativa consiste en volver a desplegar la
última versión funcional, por ejemplo desde el commit previo al error. Tras un
despliegue de este tipo, `deploy` mostrará esta indicación en vez de sugerir `rollback`, y un
`rollback` sin un id específico se denegará para evitar re-desplegar el backend actualmente en servicio.

Por consiguiente, un rollback precisa de un despliegue que haya registrado uno de los dos artefactos,
lo que requiere que el proyecto se haya desplegado satisfactoriamente al menos dos veces. `rebase cloud deployments`
destaca aquellos que califican, y `--json` indica el campo booleano `rollbackable` por registro, acompañado de la
`image` o el `bundle` que restauraría.

Se rechazan dos tipos de despliegues y la CLI explicitará cuál de ellos es: los que no
concluyeron con éxito y los anteriores a la fecha en que la plataforma comenzó a registrar artefactos.
No se aplican suposiciones en ningún escenario —asumir un estado conllevaría entregar lo último compilado o subido
bajo la falsa premisa de restaurar un despliegue antiguo—; en su defecto, despliega manualmente la versión requerida.

Cada despliegue exitoso concluye recordando la vía de reversión (`rebase cloud rollback`),
garantizando su visibilidad inmediata ante cualquier fallo detectado en una nueva versión.

Un rollback registra un nuevo despliegue en lugar de retroceder en el historial, y aguarda a que
la versión restaurada esté en servicio activo antes de confirmar el éxito. Puedes monitorizarlo con
`rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada puede restaurarse a cualquier minuto comprendido dentro de su ventana de recuperación,
desde **Database → Backups** en la consola o a través de la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Requiere dos pasos. En primer lugar, se aprovisiona una copia recuperada en paralelo a la base de datos en producción;
tu app continúa operando con normalidad sobre la base activa, y el almacenamiento de la copia se factura hasta
que efectúes el traspaso (cutover) o la descartes.
Posteriormente, una vez que la copia esté lista, el traspaso reasigna la app hacia ella y la reinicia.
Cualquier escritura posterior al punto temporal indicado no figurará en la copia. La base de datos original
se preserva como salvaguarda y continúa facturando almacenamiento; revertir el cambio, eliminarla
o solicitar una segunda restauración requiere la intervención de soporte. Únicamente un propietario o administrador
puede preparar, ejecutar el traspaso o descartar, y la consola solicitará el nombre del proyecto
antes de confirmar el traspaso definitivo.

## Protege tu cuenta

Tu cuenta de la consola tiene acceso a bases de datos de producción, variables secretas y facturación;
protégela con el máximo rigor. Accede a **Account security** desde el menú situado bajo tu avatar
en la consola (o navega a `/account`). Esta configuración es personal y no pertenece a una
organización: lo que ajustes allí se aplicará a todas las organizaciones de las que formes parte.

- **Verificación en dos pasos.** Habilítala con cualquier app de autenticación (1Password,
  Google Authenticator, Authy). La página facilitará una clave de configuración para introducir en la app, o un
  enlace para abrirla en tu móvil con los datos precargados, y solicitará el
  código de 6 dígitos emitido por la app. A partir de ese momento, cada inicio de sesión exigirá un código,
  con independencia de si accedes mediante contraseña, Google o GitHub.
- **Códigos de recuperación.** Su activación genera diez códigos de un solo uso, mostrados una sola vez.
  Cada uno permite identificarte en sustitución del código de la aplicación si extravías tu
  teléfono, por lo que debes guardarlos antes de cerrar el modal. **New recovery codes**
  invalida los anteriores y genera una nueva serie. Desactivar la verificación en dos pasos
  o solicitar códigos nuevos requerirá la introducción previa de un código válido.
- **Contraseña.** Modificarla cerrará la sesión en todos los demás dispositivos. Una cuenta
  creada mediante Google, GitHub o LinkedIn carece de contraseña; la interfaz te permitirá
  solicitar por correo un enlace para establecer una.
- **Dispositivos conectados.** Lista todos los navegadores y terminales con sesiones activas en tu cuenta,
  mostrando su dirección y la fecha de inicio. Cierra la sesión de cualquier terminal
  no reconocido o de todos en una sola acción.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no constituyen sesiones interactivas y no exigen un segundo
factor, permitiendo a tus pipelines de CI continuar desplegando sin interrupción tras activar 2FA. Revoca cualquier token
sospechoso en **Settings → Access tokens**.

## Invita a tu equipo

**Members → Add member** permite incorporar a usuarios que dispongan previamente de una cuenta de Rebase con
correo electrónico verificado, asignándoles el rol de administrador o miembro; un propietario podrá ascenderlos a
propietarios posteriormente. El acceso es inmediato y no se envían correos. Rebase Cloud no
emite invitaciones por correo por el momento, por lo que debes indicar a tus compañeros que se registren
y verifiquen su dirección previamente. Desde el terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), el cual
advertirá si la dirección indicada carece de cuenta.

## Acceso a Cloud y los usuarios de tu aplicación

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Intervienen dos colectivos de usuarios independientes, de forma idéntica a Firebase y Supabase:

- **Acceso a Cloud:** define quién tiene permisos sobre el proyecto en Rebase Cloud. Los
  propietarios y administradores de una organización actúan como `admin` en cada uno de sus proyectos, y
  los miembros ordinarios como `developer`. Un proyecto puede asignar roles individuales
  propios (`admin`, `developer` o `viewer`) mediante invitación directa por correo, sin necesidad
  de darles acceso a la organización global. Prevalece siempre el rol de mayor privilegio.
  Se gestiona mediante [`rebase cloud access`](/docs/cli/cloud/#project-access).
- **Usuarios de tu aplicación:** residen exclusivamente en la base de datos propia de la app, sujetos
  a sus mecanismos de registro y roles internos. Cloud nunca expone ni modifica estos registros.

El único punto de enlace es el botón **Open admin panel**. Autentica a un usuario con privilegios de
`admin` en Cloud directamente en el panel de control interno de la app, emparejándolo por su correo verificado: la app
localiza o crea la cuenta bajo esa dirección, le otorga el rol `admin`
y deja constancia de que dicho privilegio procede de Rebase Cloud (en Usuarios y roles de Studio
se indicará esta procedencia). En el momento en que dicha persona pierda el acceso de `admin` en Cloud sobre el proyecto, Rebase
Cloud requerirá a la app revocar dicho rol de `admin`
y clausurar sus sesiones activas en la misma. Cualquier rol asignado manualmente dentro de la app,
incluido un rango de `admin` previo a la primera apertura desde el panel de Cloud, se respetará indefinidamente y la
cuenta nunca será eliminada.

## Ver quién hizo qué

La sección **Activity** de la consola y el comando `rebase cloud activity` proporcionan a los
propietarios y administradores un registro detallado de quién desplegó, definió o reveló una variable de entorno
(identificada por su nombre, nunca por su valor), modificó un dominio, restauró una copia,
cambió el tamaño, detuvo o eliminó un proyecto, alteró el rol de un miembro o generó un
token, junto con la fecha exacta. La sección **Settings** de cada proyecto enlaza a sus registros específicos;
los eventos asociados a un proyecto eliminado se preservan. Un script puede consultar este log mediante un token provisto
de la capacidad `--can audit` en la organización. El histórico se conserva durante un año. Consulta los filtros en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Ningún entorno de CI ni agente automatizado debe hacer uso de tu contraseña personal. Emite en su lugar un token
acotado a operaciones concretas sobre un único proyecto, generado desde un terminal autenticado mediante
`rebase cloud tokens create --project shop --can deploy,logs`, e instálalo como
`REBASE_TOKEN`. La facturación de la organización, el registro de auditoría y las preferencias
de notificación constituyen capacidades independientes (`--can billing`, `audit`,
`notifications`) que los tokens solo incorporan bajo petición expresa. El desglose de capacidades,
un ejemplo de workflow para GitHub Actions y los privilegios que permanecen ligados a usuarios individuales se detallan en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` dota a una aplicación de un backend plenamente funcional antes de formalizar
ningún registro, generando una URL de reclamación (claim URL) para que su autor tome posesión de él; un proyecto no reclamado
en el plazo de 72 horas se destruye automáticamente. Las atribuciones del token provisional, el
`REBASE_API_TOKEN` generado y las implicaciones del proceso de reclamación se describen en
[Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Capacidad de cómputo y costes

El coste de un proyecto se calcula en función de los recursos que reserva, no mediante planes prefijados. `compute` lista
cada parámetro de asignación junto con el desglose de precios emitido por el plano de control. (`rebase cloud
resources` cubre un propósito distinto: detalla las bases de datos y buckets declarados en el código y
el estado de su aprovisionamiento; consulta la [referencia de la CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y significado |
|---|---|
| `--cpu`, `--memory` | Asignación solicitada (request) por instancia de app, ej. `500m` y `2Gi`. Sin valor asume el predeterminado de la plataforma según la región (indicado abajo) |
| `--replicas` | Instancias base permanentes: suelo del autoescalador y base fija de facturación mensual |
| `--autoscale-max` | 1–16. Límite máximo admisible. Las instancias añadidas por encima de `--replicas` se tarifican por pod-segundo a los mismos precios, aplicándose solo donde la plataforma lo tenga activo; **Usage this month** especifica el estado. `--no-autoscale` desactiva el escalado dinámico |
| `--autoscale-cpu-target` | 10–95. Porcentaje medio de uso de CPU buscado por el autoescalador, calculado sobre la asignación solicitada y no sobre el límite máximo. Por defecto es 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible: más económica y sujeta a reinicios imprevistos |
| `--db-instances` | 1–3. `1` corresponde a una instancia única sin failover; `2` incorpora una réplica en standby con conmutación automática |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Sin valor asume `160m` y `1Gi` |

Un parámetro no establecido difiere de fijarlo manualmente al mismo valor: los parámetros sin valor
siguen las directrices por defecto de la plataforma y se adaptan si estas varían.

En Bélgica (europe-west1) la configuración base reserva 100m CPU y 384Mi pudiendo escalar puntualmente
(burst) hasta 2 CPU y 2 GiB; en Falkenstein y Helsinki la memoria puede incrementarse hasta 1.4× la
asignación base y la CPU hasta 10× (tope de 1.7 vCPU). `rebase cloud compute` refleja los parámetros particulares de tu proyecto.

La CLI no ejecuta validaciones de límites locales a propósito: estos dependen del clúster concreto
donde se aloja el proyecto y varían según el proveedor. El plano de control rechazará cualquier parámetro
incompatible identificando el campo conflictivo. Utiliza `rebase cloud compute` para verificar el coste en
€/mes resultante antes y después de cualquier cambio; la actualización tiene efecto inmediato, prorrateándose desde la fecha en curso.
Las modificaciones en bases de datos se aplican en el acto, facturándose al tamaño previo hasta culminar la transición.
Un ajuste de CPU, memoria o una reducción de instancias en la base de datos conllevará su reinicio (oscilando entre
30 segundos y 3 minutos; las conexiones activas caerán debiendo reconectar): `compute set`
advertirá de ello exigiendo confirmación, requiriéndose el flag `--yes` en entornos sin terminal interactivo. En caso de
fallo durante el reinicio, `rebase cloud compute apply` relanzará la operación.

## El resto de comandos

| Grupo de comandos | Lo que cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Gestión de sesión; `access-token` imprime el token bearer que la CLI utilizaría en el momento, útil para scripts y el servidor MCP |
| `tokens` | Emisión de tokens para CI y agentes acotados a proyectos concretos. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vinculación del directorio a un proyecto, alternancia de organizaciones y acceso web a la consola |
| `connect` | Conexión de servidores Rebase autoalojados a tu cuenta para que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude opere con ellos en paralelo a tus proyectos Cloud. `--list` los cataloga y `--remove` los desvincula. Reservado a propietarios y administradores |
| `init`, `claim` | Con `--claim`: aprovisiona un backend funcional sin cuenta y entrega una URL de reclamación; `claim` reexpone dicho enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creación, listado, inspección y borrado de proyectos |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicación de código y monitorización |
| `deploy-hooks` | URLs secretas accionables por servidores git o pipelines de CI para desencadenar despliegues: listado, creación (la URL se revela una sola vez) y revocación |
| `previews` | Despliegues alojados en URLs efímeras mediante `deploy --preview` y su supresión. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `sleep` | Hibernación por inactividad: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` y `status` (opción por defecto). Hibernado, el proyecto libera CPU y memoria hasta que una petición entrante lo reactive; las tareas cron y trabajos en segundo plano quedan suspendidos. Si el proyecto no es apto para hibernar, el plano de control lo notificará denegando la acción |
| `start`, `stop`, `restart` | Detención temporal y arranque de proyectos. Un proyecto detenido conserva su cuota mensual de suscripción salvo que la plataforma indique facturación exclusiva de almacenamiento y tasa base; la fila **Billing** de la consola lo confirmará cuando aplique |
| `status`, `metrics`, `debug` | Diagnóstico de actividad y causas de indisponibilidad |
| `alerts` | Incidentes pendientes del proyecto, permitiendo su acuse de recibo o silenciamiento temporal |
| `cron` | Relación de tareas cron y registros de ejecuciones de la app, consultables con tu sesión de `rebase cloud`. Modo solo lectura |
| `env` | Variables de entorno. `list` oculta deliberadamente los valores; `--secret` es de solo escritura |
| `app-key` | La clave volcada por `init --claim` en el archivo `.env` bajo el nombre `REBASE_API_TOKEN`, asignada al reclamar el proyecto; `rotate` la sustituye invalidando la anterior. Propietarios y administradores |
| `service-key` | Clave administrativa `REBASE_SERVICE_KEY` para interactuar con la API propia de la app: refleja su última rotación; `rotate` expide una nueva. Propietarios y administradores |
| `domains` | Dominios personalizados, configuración de registros DNS asociados y validación. Un proyecto admite múltiples dominios validados independientemente; `verify` y `remove` admiten el dominio diana, pudiendo omitirse si solo existe uno (o uno pendiente en `verify`). Cada dominio verificado atiende al proyecto autónomamente; `primary <domain>` fija el canónico y `redirect <domain>` redirige tráfico mediante 308 preservando paths y queries (`--off` cancela la redirección) —acción recomendada para subdominios `www.` frente al apex, ya que el login con Google, cookies y passkeys segregan por origen. Un dominio asociado a la ruta propia de una app nunca redirige. Un dominio raíz o apex (`example.com`, carente de subdominio) precisa un registro **A** ante la imposibilidad de aplicar CNAMEs en el vértice DNS. Dicha IP es el balanceador de entrada de la plataforma y está sujeta a cambios si esta migra de infraestructura. Si tu proveedor DNS tolera registros tipo ALIAS, ANAME o aplanamiento de CNAME en el apex, enlaza dicho vértice al `tenantHost` del proyecto, el cual se actualizará automáticamente con la plataforma. Los CNAMEs en subdominios operan así por defecto. `list` mostrará `verified, certificate pending` hasta que la emisión TLS culmine atendiendo peticiones HTTPS. `list --json` emite `{ projectId, tenantHost, domains: [...] }` |
| `db` | Vinculación o aprovisionamiento de bases de datos, túneles de conexión local, copias de seguridad, restauraciones y point-in-time recovery |
| `guests` | Usuarios invitados acumulados tras accesos anónimos: cómputo, supresión unitaria y purga por antigüedad. Consulta [Invitados (Guests)](/docs/cli/cloud/#guests). Propietarios y administradores |
| `extensions` | Lista blanca de extensiones habilitadas para Postgres |
| `storage` | Configuración de buckets asociados al proyecto |
| `resources` | Auditoría de bases de datos y buckets registrados por la plataforma frente a lo tipificado en el código |
| `compute` | Asignación computacional reservada, estructura de costes y comandos de ajuste |
| `events` | Historial cronológico del backend, ordenado descendentemente: escalado de pods, modificaciones programadas en base de datos, conmutaciones de réplicas secundarias o redimensionamiento de disco |
| `usage` | Peticiones computadas en el mes en curso frente a la cuota base y balance de excesos para facturación. `usage org` totaliza los datos a nivel de organización |
| `clusters` | Clústeres físicos de despliegue de tenants. Restringido a administradores de la plataforma |
| `settings`, `orgs`, `access`, `billing` | Parámetros globales del proyecto, estructura de la organización, invitaciones, ACLs de acceso y métodos de pago |
| `activity` | Registro de auditoría: quién desplegó, alteró variables de entorno (por nombre), dominios, backups, roles de miembros o tokens. Propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications` | Enrutamiento de eventos mediante webhooks POST: Slack, Discord o cualquier endpoint HTTPS genérico ([Notificaciones de Cloud](/docs/deployment/cloud-notifications/)) |

Cada uno de los grupos expuestos responde al parámetro `--help` con su documentación dedicada —sintaxis de llamada,
flags admitidos y ejemplos de uso—, garantizando que `--help` nunca ejecute la instrucción de forma accidental. Una batería de tests
verifica la integridad de estos índices, de modo que cualquier comando incorporado sin su ayuda asociada bloqueará la build en lugar de responder
con el índice general. `verify:docs` somete la tabla a este mismo índice: cada comando registrado en la CLI debe figurar
aquí de forma unívoca, provocando el fallo del pipeline si se añade una orden carente de fila explicativa.

Al canalizarse por pipe, `--help` entrega la respuesta formateada como JSON: la misma definición estructural, argumentos y
ejemplos dispuestos para su parseo automatizado sin lidiar con secuencias de escape ANSI de terminal.

## Qué no incluye la beta

Elección de regiones geográficas, registro desatendido abierto a terceros, compromisos formales de SLA publicados, despliegues automáticos por rama,
tokens con identidad delegada a nivel de usuario y cadenas de conexión públicas directas a la base de datos.
La sección [Qué no incluye la beta](/docs/deployment/cloud-beta-limits/) expone cada limitación de forma explícita,
detallando las precauciones requeridas al desplegar con variables y credenciales de producción.

## Autoalojamiento como alternativa

Ninguna decisión técnica en esta plataforma implica cautividad (lock-in). La
[guía de autoalojamiento](/docs/deployment/self-hosting/) permite ejecutar con `docker compose` exactamente la misma
imagen y paquete distribuible, mientras que la [guía de Kubernetes](/docs/deployment/kubernetes/) aprovisiona
una topología idéntica sirviéndose del chart oficial de Helm.
