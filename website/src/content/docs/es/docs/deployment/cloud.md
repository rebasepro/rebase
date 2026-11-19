---
sourceHash: 932f7373eaaf4e2e
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que hospedarías tú mismo: la misma
imagen publicada `rebasepro/server`, el mismo bundle y el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Actualmente ejecuta tenants reales y su acceso se abre
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es autoservicio, por lo que los comandos a continuación requieren una cuenta que haya sido admitida.
Todo lo demás en este sitio funciona sin necesidad de una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Base de datos** | Un PostgreSQL gestionado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo |
| **Almacenamiento** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y cada uno se factura por lo que
reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autohospeda con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre la consola en tu navegador y muestra un código corto. Comprueba que
la consola muestre el mismo código y aprueba el inicio de sesión allí: la terminal
recibe la sesión y la escribe en `~/.rebase/credentials.json`. Si no has
iniciado sesión en la consola, hazlo primero con el método que utilices, Google
y GitHub incluidos. Mediante SSH, `rebase cloud login --no-browser` imprime el enlace
para abrirlo en tu propia máquina.

`projects create` no admite argumentos posicionales. El nombre y el subdominio son
indicadores (flags) y ambos son obligatorios; en una terminal se solicitarán, y una
ejecución desatendida (headless) que omita cualquiera de ellos finalizará con `input_required` en lugar de inventar
uno. **El subdominio no se puede editar después:** es el host
`<slug>.rebase.website` en el que responde el proyecto, así que elígelo conscientemente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un
paso `link` por separado. Escribe `.rebase/cloud.json`, que registra el id del proyecto
y el slug. Ese archivo no es un secreto ni contiene tus credenciales; estas residen
en `~/.rebase/credentials.json`, generado por `login`.

Sin embargo, se commitea con el código, por lo que un repositorio clonado puede indicar cualquier
plano de control. Cuando el host proviene únicamente de ese archivo y no es ni el
propio de la plataforma ni uno en el que hayas iniciado sesión anteriormente, `login` lo nombra y pregunta
antes de enviar tu correo electrónico y contraseña allí. Sin una terminal, o con
`--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define
`REBASE_CLOUD_URL`) para iniciar sesión allí intencionadamente.

Para iniciar sesión sin el navegador, pasa tu correo electrónico: `rebase cloud login --email
me@example.com` te pedirá tu contraseña. **¿Te registraste con Google, GitHub o
LinkedIn?** Tu cuenta no tiene contraseña, así que utiliza un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te enviará por correo electrónico un código de 6 dígitos, válido durante diez minutos, y lo escribes
en el prompt. Con `--email` y sin contraseña, `rebase cloud login` te preguntará
si deseas usar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar
correos electrónicos; si no puede hacerlo, `--code` lo indicará y finalizará con `otp_unavailable`.

Si activaste la autenticación en dos pasos, `login` te pedirá el código de
tu aplicación de autenticación o uno de tus códigos de recuperación, independientemente del método con el que hayas iniciado
sesión. A través del navegador, la consola te lo pedirá al iniciar sesión allí. Ni un código de inicio de sesión ni un segundo factor se pueden escribir sin una terminal.
Para un script, crea un token de acceso en la consola (**Settings → Access
tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responderá `invalid_credentials` ofreciendo las mismas dos alternativas de acceso, ya que
la causa habitual suele ser una cuenta que nunca tuvo contraseña.

`billing setup` asocia una tarjeta a la organización, una sola vez. Es el primer paso de
la secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una tarjeta asociada, y
enterarse de ello después de que un bundle haya terminado de subirse es el peor escenario.

A partir de entonces, la página de **Billing** de la consola lista las facturas de la organización,
cada una con la página alojada de Stripe y su PDF, y previsualiza la próxima factura de cada
proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming`
muestran lo mismo. Ambos son para propietarios y administradores de la organización. Donde la
plataforma lo admita, **Manage billing** abre el portal de clientes de Stripe para gestionar
la tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no solicita
ningún segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta
es rechazada o el banco requiere confirmar el pago, la consola te redirige a
**Billing**, donde **Fix your card** guarda otra tarjeta y **Complete the
payment** abre la factura de Stripe.

El consumo de un proyecto se muestra en su resumen general, bajo **Usage this month**, y
para todos los proyectos a la vez en la página de **Billing**: peticiones respecto a la
cuota incluida (la barra cambia a ámbar al 80%), errores 5xx, el exceso de consumo acumulado hasta el momento
y la proyección estimada para el mes a este ritmo. El exceso se calcula con el
mismo código que lo reporta a Stripe, por lo que es lo que figurará en la factura;
aparece en la factura del mes siguiente. `rebase cloud usage` muestra
lo mismo, y `rebase cloud usage org` lo muestra para toda la organización. Cualquier miembro puede consultarlo.
Las cifras detallan lo que aún no pueden contemplar: el almacenamiento de objetos no se mide,
por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecute dos o más pods de app,
sus peticiones no se contabilizan; y un día con muestras perdidas infravalora el recuento. Un
proyecto con autoescalado también muestra los pods que ejecutó por encima de `--replicas`, en horas-pod,
cuánto cuestan según sus propias tarifas y si esta plataforma los cobra ya o no. Un
proyecto reclamado desde un agente cuenta únicamente los días a partir de la reclamación: antes
de ella, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crearlo de nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando, y ningún flag que recordar. El `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo
indica durante el proceso (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y monitoriza el despliegue hasta un estado final. El código
de salida es el veredicto, por lo que la misma línea funciona desatendida en CI.

Termina indicando dónde responde ahora cada aplicación y si la nueva versión está
activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que la dirección respondió tras la compilación: el `/health` de un backend
devolvió `ok`, y la página de una app estática se cargó (desde este despliegue, cuando la
plataforma la sirve). La comprobación espera hasta `--live-timeout` segundos, 60 por
defecto; `0` la omite. Si una app no responde a tiempo, el despliegue aún finaliza con código
cero, porque el despliegue tuvo éxito, y la última línea indica qué app no
respondió y por qué. En cambio, un despliegue fallido termina en una sola línea, indicando la app y el
motivo, remitiendo a `rebase cloud logs` para consultar el registro de compilación completo.

Los scripts pueden pasar `--json` para obtener un único objeto con los mismos datos: `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de
`rebase cloud`, `deploy` no cambia a JSON automáticamente cuando se usa en una tubería (pipe).

Lo que permite ese runtime —paquetes y módulos nativos, memoria e instancias,
tiempos de espera y tamaños de payload, el sistema de archivos, secretos, almacenamiento y red
saliente— se encuentra en su propia página:
[Runtime gestionado de backend](/docs/deployment/managed-runtime/).

Para enviar un artefacto que fue compilado previamente —por ejemplo, un job de CI que compila una vez y
despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime gestionado requiere su propio flag, `--eject`, y nada más
lo solicitará: una compilación que movería un proyecto gestionado a una imagen de contenedor que pasa
a ser de su propiedad se rechaza a menos que lo indiques explícitamente. Antes se usaba `--force` para esto, lo cual
asociaba la acción menos reversible de la CLI a la misma palabra que "sobrescribir este
archivo"; ahora es una opción desconocida en lugar de un alias, por lo que cualquier script que la incluya
se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente tal como están. Cuando su `build` únicamente
copia scripts escritos a mano en `output`, nada los ha analizado sintácticamente, y un archivo
con una errata pasaría a producción e impediría que la página se cargue. Por lo tanto, antes de que nada
se suba, `deploy` analiza cada archivo `.js`, `.mjs` y `.cjs` en el `output` de cada app
estática, junto con cada `<script>` en línea dentro de sus archivos `.html`. Esto
cubre tanto una app estática desplegada individualmente como las apps estáticas integradas en el
bundle del backend. Un error de sintaxis detiene el despliegue mostrando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Los scripts en línea que un navegador
no ejecuta como JavaScript se omiten: JSON, mapas de importación (import maps), plantillas y cualquier
otro `type` que no sea JavaScript, un `<script src>`, y scripts que aún contengan
sintaxis de plantillas sin renderizar como `{{ }}`. Un archivo `.js` se valida si se analiza
correctamente como script clásico o como módulo, ya que es la página la que decide cuál es. Nada
debajo de `node_modules` se lee, ni tampoco un `--bundle-dir` precompilado.
`--no-verify` omite la comprobación para un único despliegue.

Para monitorizarlo:

```bash
rebase cloud logs               # el registro de compilación
rebase cloud logs --runtime -f  # lo que la app en ejecución imprime, en vivo, hasta presionar Ctrl-C
rebase cloud status             # lo que la plataforma considera que está haciendo el proyecto
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando activamente y sondear el estado es lo correcto; cuando nombra
algo, ese algo está esperando una acción tuya.

Uno de ellos es `email_not_configured`: la app activó el inicio de sesión por enlace mágico o código por
correo (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) y no tiene un servicio de correo electrónico configurado, por lo que
el despliegue está activo pero nadie puede iniciar sesión. Rebase Cloud no envía
correos por tu aplicación: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y
`SMTP_FROM` mediante `rebase cloud env set`, y luego despliega. `status` lee esto desde el propio
`GET /api/auth/config` de la app (su campo `unavailable`), y `deploy` indica
lo mismo en su comprobación de estado en vivo.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que haría `deploy`, pero lo sirve en una dirección
propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa
sirviendo lo que servía antes. El despliegue imprime la dirección de la previsualización cuando
la compilación finaliza.

Para mantener una dirección fija entre despliegues, asigna un nombre a la previsualización. Desplegar con el mismo nombre
de nuevo la actualizará:

```bash
rebase cloud deploy --preview-name new-checkout
```

Aquello con lo que se comunica una previsualización depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps estáticas
  integradas, de la misma forma en que las ejecuta producción. Obtiene un backend propio en
  una **base de datos propia y vacía**, nunca la de producción. Iniciar contra la
  base de datos de producción aplicaría el esquema y las reglas de acceso de la previsualización a la misma.
- **`rebase cloud deploy web --preview`** previsualizaría una sola app estática de forma
  aislada, cuyas páginas llamarían al backend de **producción**. Esto requiere un plano de control
  que sirva sitios estáticos por sí mismos, y Rebase Cloud aún no lo hace:
  rechaza la operación con `PREVIEW_STATIC_UNSERVED` y no publica nada. En su lugar, previsualiza el
  backend, el cual sirve las apps estáticas integradas en él; un proyecto sin un
  backend gestionado no se puede previsualizar por ahora.

Una previsualización no sube código fuente ni registra apps o nombres de host, ya que cualquiera de
estas acciones modificaría el proyecto de producción. `--source` y `--eject` no se pueden
combinar con `--preview`. Cada uno de ellos compila una imagen de contenedor para producción.

```bash
rebase cloud previews                      # nombre, dirección, app, backend, expiración
rebase cloud logs --preview new-checkout   # su registro de compilación; -f sigue una compilación en curso
rebase cloud logs --runtime --preview new-checkout -f  # lo que imprime su backend
rebase cloud previews delete new-checkout  # deja de servirla y elimina su base de datos
```

`rebase cloud logs` sin `--preview` siempre muestra los registros de producción.

La página **Deployments** de la consola lista las mismas previsualizaciones, y permite abrir, mostrar el
registro de compilación o eliminar cada una de ellas. La creación de previsualizaciones se mantiene como un paso exclusivo de la CLI.

Una previsualización expira una semana después del último despliegue que recibió.

Al terminar, el despliegue comprueba que la dirección de previsualización responda, tal como hace un
despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). El certificado de una nueva
previsualización puede tardar uno o dos minutos, por lo que un despliegue exitoso podría
indicar que la dirección todavía no responde.

La previsualización de un backend se factura como una unidad de aplicación con el tamaño predeterminado (100m de CPU
y 384 MiB de memoria, a la tarifa de tu app según su región y capacidad),
prorrateada por el tiempo que exista, y aparece en la estimación
mensual del proyecto en la consola. `rebase cloud deploy --preview` muestra la misma estimación
para ella, por mes (`cost` bajo `--json`). Iniciar una previsualización requiere una tarjeta registrada, al igual que un
despliegue de producción. Un primer despliegue que
falle antes de que nada llegue a ejecutarse se elimina en lugar de facturarse. Un proyecto puede ejecutar hasta
tres previsualizaciones de backend simultáneamente.

Cada nueva dirección de previsualización obtiene un certificado TLS propio emitido por Let's Encrypt,
autoridad que permite a un dominio 50 certificados nuevos a la semana, compartidos entre todos los sitios
de producción en él. Las previsualizaciones pueden consumir hasta 20 de ellos en cualquier período de 7 días, en toda la plataforma. A partir
de ese límite, se rechazará una nueva previsualización (`429`, `preview_cert_budget`) indicando cuándo podrá
ser desplegada; volver a desplegar una previsualización ya existente nunca cuenta para este límite.

La base de datos de una previsualización de backend es una segunda base de datos en el Postgres de **producción**:
sus propios datos, pero en la misma instancia y en el mismo disco. Está limitada a 10
conexiones, para que las previsualizaciones no agoten las de producción, y a 2 GB: una previsualización
cuya base de datos supere ese tamaño se pausará. Su backend se detiene, su dirección deja de
responder, `rebase cloud previews` y la consola la muestran como `paused` indicando el
motivo, y se notifica a los propietarios y administradores del proyecto (`preview.paused`). Sus
datos se conservan hasta que expire. Despliégala de nuevo para reiniciarla (volverá a pausarse
si la base de datos sigue siendo demasiado grande) o elimínala. Una previsualización pausada se sigue
facturando hasta que se elimine o expire. Elimina las previsualizaciones que ya no necesites. Las extensiones instaladas en producción no se
instalan en la base de datos de una previsualización.

Las previsualizaciones se están implementando gradualmente. Un plano de control que aún no las admita rechazará
`--preview` con `previews_unavailable` y no desplegará nada.

## Revertir

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso anterior,
y nunca recompila: el valor de un rollback reside en que despliega un
artefacto que ya ha sido ejecutado previamente.

Qué despliegues califican depende de cómo se despliegue el proyecto, y ambos tipos
son válidos:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto está ejecutando ahora |

Las apps estáticas integradas en el bundle del backend (un `rebase cloud deploy` simple en un
proyecto con backend) forman parte de ese bundle, por lo que revierten junto con él.

Una app estática desplegada individualmente (`rebase cloud deploy <app>`) no se puede revertir
todavía. Su despliegue registra qué app se publicó, pero ningún bundle, por lo que el
plano de control no tiene nada a partir de lo cual restaurarla. La solución consiste en desplegar la última versión
correcta nuevamente, por ejemplo desde el commit anterior al erróneo. Después de un despliegue
de este tipo, `deploy` indicará esto en lugar de sugerir `rollback`, y un `rollback`
sin un id rechazará la operación en lugar de redesplegar el backend que está sirviendo.

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos artefactos, lo que implica un
proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments`
marca los que califican, y `--json` informa `rollbackable` por cada fila junto
con la `image` o `bundle` que restauraría.

Dos tipos de despliegues son rechazados, y la CLI especifica cuál de ellos es: uno que no tuvo éxito,
y uno anterior a que la plataforma comenzara a registrar sus artefactos. No hay nada que suponer
en ningún caso —asumirlo enviaría lo que se haya compilado o subido más
recientemente mientras se afirma restaurar este último—, por lo que deberás desplegar la versión que deseas
en su lugar.

Cada despliegue exitoso finaliza indicando el comando de regreso (`rebase cloud rollback`),
de modo que esté a la vista en el momento en que se detecte un lanzamiento defectuoso.

Un rollback añade un nuevo despliegue en lugar de retroceder en el historial, y espera a que
la versión restaurada esté sirviendo antes de confirmar el éxito. Síguelo con
`rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada se puede recuperar a cualquier minuto dentro de su ventana de retención,
desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Requiere dos pasos. En primer lugar, se prepara una copia recuperada junto a la base de datos en producción;
tu app continúa ejecutándose sobre la activa, y el almacenamiento de la copia se factura hasta
que realices la conmutación (cutover) o la descartes.
Luego, una vez que la copia esté lista, la conmutación redirige la app a ella y la
reinicia. Cualquier dato escrito después de la hora objetivo no estará en la copia. La base de datos
original se conserva como vía de retorno, y continúa facturando almacenamiento; volver a cambiar a ella,
eliminarla o un segundo restore requiere contactar a soporte. Solo un propietario o administrador
puede preparar, conmutar o descartar, y la consola solicitará el nombre del proyecto
antes de realizar el cutover.

## Protege tu cuenta

Tu cuenta de la consola tiene acceso a bases de datos de producción, secretos y facturación, por lo
que debes protegerla adecuadamente. Abre **Account security** desde el menú bajo tu avatar
en la consola (o ve a `/account`). Esta página es personal, no de la
organización: lo que configures allí se aplica en cada organización a la que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password,
  Google Authenticator, Authy). La página muestra una clave de configuración para agregar a la app, o un
  enlace que abre la app con la clave rellenada en un teléfono, y luego solicita el
  código de 6 dígitos que muestra la aplicación. A partir de entonces, cada inicio de sesión solicitará un código,
  tanto si inicias sesión con contraseña como con Google o GitHub.
- **Códigos de recuperación.** Activarlo te proporciona diez códigos de un solo uso, mostrados una única vez.
  Cada uno te permite iniciar sesión en sustitución del código del autenticador si pierdes tu
  teléfono, así que guárdalos antes de cerrar el cuadro de diálogo. **New recovery codes**
  los reemplaza, y los antiguos dejan de funcionar. Desactivar la verificación en dos pasos
  y solicitar nuevos códigos requerirán introducir un código primero.
- **Contraseña.** Cambiarla cerrará tu sesión en todos los demás dispositivos. Una cuenta
  creada con Google, GitHub o LinkedIn no tiene contraseña; la página te ofrece
  enviarte un enlace por correo para definir una.
- **Dispositivos conectados.** Cada navegador y terminal con sesión iniciada en tu cuenta,
  con su dirección y la fecha/hora en que inició sesión. Cierra la sesión de cualquier dispositivo que no
  reconozcas, o de todos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no solicitan un segundo
factor, por lo que CI continuará desplegando después de que lo actives. Revoca cualquier token en el que ya no
confíes en **Settings → Access tokens**.

## Invita a tu equipo

**Members → Invite member** proporciona un enlace para copiar (enviado por correo electrónico cuando este plano de control
pueda enviar emails) que funciona una sola vez, durante 7 días, para una cuenta que haya verificado esa
dirección; nadie se une hasta que acepte la invitación. Invita a un administrador o a un miembro, y conviértelo
en propietario una vez que se haya unido. Los propietarios y administradores pueden ver, reenviar o revocar la invitación en
**Pending invitations**; desde una terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los
propietarios y administradores de la organización quién desplegó, definió o reveló una variable de entorno
(por su nombre, nunca por su valor), cambió un dominio, restauró una copia de seguridad,
redimensionó, detuvo o eliminó un proyecto, cambió el rol de un miembro o creó un
token, y cuándo lo hizo. La sección **Settings** de un proyecto enlaza a sus propias entradas; los registros
relativos a un proyecto eliminado se conservan. Un script puede leerlos mediante un token creado con
`--can audit` en la organización. Las entradas se guardan durante un año. Los filtros se detallan en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no deberían contener tu contraseña. Proporciónale un token limitado a
unas pocas acciones en un único proyecto, creado desde una terminal con sesión iniciada mediante
`rebase cloud tokens create --project shop --can deploy,logs`, y establécelo como
`REBASE_TOKEN`. La facturación, el registro de actividad y las configuraciones de notificación de una organización
son permisos independientes (`--can billing`, `audit`,
`notifications`) que un token posee únicamente si se solicitan explícitamente. Los permisos, un
flujo de trabajo de GitHub Actions y lo que permanece asociado a una persona autenticada se detallan en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` dota a una aplicación de un backend en vivo antes de que nadie se haya
registrado, e imprime una URL de reclamación para que el usuario la conserve; un proyecto que nadie reclame
en un plazo de 72 horas es eliminado. Los permisos del token del proyecto no reclamado, el
`REBASE_API_TOKEN` que escribe y lo que cambia el proceso de reclamación se describen en
[Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y lo que cuesta

El precio de un proyecto se determina según lo que reserva, no por niveles fijos (tiers). `compute` muestra
cada parámetro configurable y el desglose presupuestario generado por el propio plano de control. (`rebase cloud
resources` es algo distinto: las bases de datos y buckets que declara el código,
y si cada uno de ellos está aprovisionado o no; consulta la [referencia de la CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, p. ej. `500m` y `2Gi`. Vacío significa el valor predeterminado de la plataforma: `100m` y `384Mi`, con picos (burst) de hasta 2 CPU y `2Gi` |
| `--replicas` | Instancias que siempre existen: el límite inferior del autoescalador y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El techo máximo que puede alcanzar. Las instancias que el autoescalador agrega por encima de `--replicas` se miden por segundo-pod a las mismas tarifas, y se cobran solo en las plataformas que hayan activado esa opción; **Usage this month** indica si aplica. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. El porcentaje de uso de CPU que mantiene el autoescalador, respecto a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (spot): más económica, pero se reinicia sin previo aviso |
| `--db-instances` | 1–3. `1` es una instancia única sin failover; `2` añade un nodo standby automático |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no equivale a fijarlo en el mismo número: un parámetro vacío
sigue el valor predeterminado de la plataforma y variará cuando este cambie.

La CLI no valida ninguno de estos valores a propósito; los límites corresponden al clúster en el que
se ejecuta el proyecto y difieren según los proveedores. El plano de control rechazará cualquier
valor que no pueda satisfacer e indicará el campo correspondiente. Ejecuta `rebase cloud compute` para ver
el importe en €/mes antes y después; un cambio se aplica inmediatamente, prorrateado desde hoy,
excepto aquel que requiera reiniciar la base de datos, el cual esperará a una ventana de mantenimiento.

## El resto de la superficie

| Grupo de comandos | Lo que cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token bearer que la CLI enviaría en ese momento, útil para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Agregar un servidor Rebase autohospedado a tu cuenta, para que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude acceda a él junto con tus proyectos de Cloud. `--list` los lista, `--remove` desconecta uno. Para propietarios y administradores |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta y un enlace para reclamarlo; `claim` vuelve a imprimir ese enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitorización |
| `deploy-hooks` | URLs secretas que un proveedor de Git o CI llama para desplegar el proyecto: listar, crear (la URL se muestra una sola vez), revocar |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y cómo eliminarlas. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma solo facture almacenamiento y la tarifa base a proyectos detenidos; la fila de **Billing** en la consola lo indica cuando corresponde |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `alerts` | Los incidentes abiertos del proyecto, y cómo confirmarlos o posponerlos |
| `cron` | Las tareas cron de la app desplegada y sus ejecuciones registradas, consultadas con tu inicio de sesión en `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, transferida al reclamar; `rotate` la reemplaza y revoca la anterior. Para propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegios de admin en la propia API de la app: cuándo se rotó por última vez; `rotate` asigna una nueva a la app. Para propietarios y administradores |
| `domains` | Dominios personalizados, registros DNS que se deben añadir y verificación. Un proyecto puede responder en varios dominios, verificándose cada uno por separado; `verify` y `remove` aceptan el dominio sobre el que actuar, el cual puede omitirse únicamente cuando hay uno solo (para `verify`, uno aún pendiente). Cada dominio verificado sirve el proyecto como propio; `primary <domain>` elige el canónico y `redirect <domain>` redirige cualquier otro hacia él con un código 308, conservando ruta y parámetros (`--off` vuelve a servirlo directamente); haz esto para `www.` junto al dominio apex, ya que el inicio de sesión de Google, las cookies y las passkeys funcionan por origen. Un dominio en el que se sirve una app específica (un `path` de app con nombre de host) nunca redirige. `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauraciones y recuperación a un punto en el tiempo |
| `guests` | Los usuarios invitados que dejó el inicio de sesión anónimo: contarlos, eliminar uno, purgar los que lleven mucho tiempo sin actividad. Consulta [Invitados](/docs/cli/cloud/#guests). Para propietarios y administradores |
| `extensions` | Lista de extensiones de Postgres permitidas |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo declarado en el código |
| `compute` | Qué recursos reserva este proyecto, cuánto cuesta y cómo modificarlos |
| `events` | Qué ha ocurrido en el backend, en orden cronológico inverso: escalado de la app, cambios de base de datos programados y aplicados, activación de un standby, crecimiento del disco |
| `usage` | Peticiones utilizadas este mes respecto a la cuota incluida, y el exceso acumulado hasta el momento, tal como lo contabiliza la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Exclusivo para administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones, sus miembros e invitaciones, pagos |
| `activity` | Registro de auditoría de la organización: quién desplegó, modificó una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Para propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications` | Dónde se envían los eventos del proyecto mediante peticiones POST: Slack, Discord o cualquier URL https ([Notificaciones de Cloud](/docs/deployment/cloud-notifications/)) |

Cada grupo de esa tabla responde a `--help` con una página propia —una línea de uso,
sus opciones (flags) y ejemplos—, y `--help` nunca ejecuta el comando. Una prueba comprueba
el índice de páginas, por lo que un grupo añadido sin ella provocará un fallo en la compilación en lugar de
responder con la tabla de contenidos. `verify:docs` vincula la propia tabla
a ese índice: cada grupo gestionado por la CLI aparece aquí exactamente una vez, de modo que un grupo
añadido sin su correspondiente fila también fallará la compilación.

Cuando se utiliza mediante una tubería (pipe), `--help` responde en formato JSON: la misma línea de uso, flags y ejemplos
estructurados para su lectura programática, en lugar de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Dicho claramente, porque enterarse después es peor:

- **Sin selección de región.** Todo se ejecuta en una sola región hoy en día. El modelo
  de ubicación existe en la plataforma, pero un proyecto no puede escoger una región.
  `projects create --provider` y `--region` no son la excepción que aparentan
  ser: registran a cuál de los destinos de despliegue configurados en el plano de control
  pertenece un proyecto, y como solo hay uno, ambos toman ese por defecto y ninguno
  traslada el proyecto a otra ubicación. `rebase cloud projects create --help` indica lo mismo.
- **No es autoservicio.** El acceso se concede por lotes; no existe un flujo de registro y pago directo.
- **Sin SLA publicado**, ni certificación SOC 2. Si necesitas alguno de ellos, indícalo al solicitar
  el acceso en lugar de darlo por sentado.
- **Sin despliegues por rama (branch deploys)**, ni GitHub App oficial. Los hooks de despliegue —URLs secretas
  a las que apuntas un webhook del repositorio— son el método de automatización soportado. Los [despliegues
  de previsualización](#previsualizar-un-cambio) se están implementando gradualmente y se inician desde la CLI.
- **Los tokens actúan como personas.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) es generado por una cuenta
  y actúa en su nombre; todavía no existe una identidad de máquina propia de la organización. Si
  inicias sesión desde CI en su lugar, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD`
  desde un gestor de secretos; usar `--password` incluye la contraseña en el historial de tu shell
  y en la tabla de procesos, y así te lo advertirá antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio define un plano de control distinto al oficial de la plataforma, pásalo
  también como `--url`: sin una terminal interactiva, `login` se negará a enviar una contraseña a un
  host especificado únicamente por el archivo descargado.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no se expone a
  internet, por lo que el host mostrado en la consola es la dirección que tu backend usa para acceder a ella y
  no resolverá a nada en tu máquina local. `rebase cloud db connect` abre un puerto local
  hacia esa base de datos, canalizado a través del plano de control mientras
  lo mantengas en ejecución; no existe un nombre de host permanente al que pueda conectarse un servicio
  de terceros. Para ejecutar SQL sin un cliente Postgres local,
  `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` abre el
  mismo túnel para una única consulta, ejecuta el texto como un único script (deteniéndose ante el primer
  error) e imprime la respuesta de cada sentencia (`--json` para scripts). Ese túnel y la contraseña protegida tras
  `rebase cloud db info --reveal` requieren el rol de propietario o administrador de la
  organización: el mismo que solicita el editor SQL de Studio, ya que los tres métodos dan acceso
  a una sesión directa sobre tus datos de producción.
- **Desplegar implica ejecutar código con los secretos de producción.** El entorno de la
  app contiene `REBASE_SERVICE_KEY` (administrador en su propia API),
  `DATABASE_URL` y `JWT_SECRET`, por lo que el código desplegado por cualquier miembro puede leerlos,
  a pesar de que solo los propietarios y administradores puedan revelarlos en la consola. Invita
  como miembro únicamente a personas a quienes confiarías esos valores.
- **La clave de servicio puede reemplazarse.** Los **Settings** del proyecto
  (o `rebase cloud service-key rotate`) generan una nueva `REBASE_SERVICE_KEY`
  y reinician la app utilizándola. La clave antigua sigue funcionando hasta que el reinicio haya
  finalizado, y dejará de ser válida a partir de ese momento, por lo que cualquier servicio que la haya copiado será
  rechazado. Reclamar un proyecto ejecuta la misma acción.

## Autohospedaje como alternativa

Nada de lo aquí expuesto implica un bloqueo de proveedor (vendor lock-in). La [guía de autohospedaje](/docs/deployment/self-hosting/)
ejecuta la misma imagen y el mismo bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) despliega la misma topología a partir
del chart de Helm.
