---
sourceHash: 6a1d65000e50846a
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la misma imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La diferencia es quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Actualmente opera tenants reales y se abre por lotes. [Solicita acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta a la que se le haya concedido acceso. Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Qué obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Base de datos** | Un PostgreSQL administrado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo |
| **Almacenamiento** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

La app y la base de datos se aprovisionan la primera vez que despliegas; un bucket solo cuando lo solicitas ([Almacenamiento de archivos](#almacenamiento-de-archivos)). Cada uno se factura por lo que reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se autoaloja con `docker compose`, y la vía de escape es real: `rebase build` produce un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre la consola en tu navegador e imprime un código corto. Comprueba que la consola muestre el mismo código y aprueba el inicio de sesión allí: la terminal recoge la sesión y la escribe en `~/.rebase/credentials.json`. Si no has iniciado sesión en la consola, inicia sesión allí primero con lo que utilices, incluidos Google y GitHub. A través de SSH, `rebase cloud login --no-browser` imprime el enlace para abrirlo en tu propia máquina.

`projects create` no toma ningún argumento posicional. El nombre y el subdominio son flags y ambos son obligatorios: en una terminal se solicitan interactivamente, y una ejecución no interactiva (headless) que omita cualquiera de ellos finaliza con `input_required` en lugar de inventar uno. **El subdominio no se puede editar después:** es el host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo conscientemente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un paso `link` separado. Escribe `.rebase/cloud.json`, que registra el id y el slug del proyecto. Ese archivo no es un secreto ni son tus credenciales; estas residen en `~/.rebase/credentials.json`, escrito por `login`.

Sin embargo, se incluye en el control de versiones con el código, por lo que un repositorio clonado puede indicar cualquier plano de control. Cuando el host proviene únicamente de ese archivo y no es ni el propio de la plataforma ni uno en el que hayas iniciado sesión anteriormente, `login` lo menciona y pregunta antes de enviar tu correo electrónico y contraseña allí. Sin una terminal, o con `--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define `REBASE_CLOUD_URL`) para iniciar sesión allí intencionadamente.

Para iniciar sesión sin el navegador, pasa tu correo electrónico: `rebase cloud login --email me@example.com` te pedirá tu contraseña. **¿Te registraste con Google, GitHub o LinkedIn?** Tu cuenta no tiene contraseña, así que utiliza un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido durante diez minutos, y lo introduces en el prompt. Con `--email` y sin contraseña, `rebase cloud login` pregunta si deseas utilizar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar correos electrónicos; si no puede, `--code` lo indica y finaliza con `otp_unavailable`.

Si activaste la autenticación en dos pasos, `login` te pedirá a continuación el código de tu aplicación de autenticación o uno de tus códigos de recuperación, independientemente de cómo hayas iniciado sesión. A través del navegador, la consola lo solicita cuando inicias sesión allí. Ni un código de inicio de sesión ni un segundo factor se pueden introducir sin una terminal. Para un script, crea un token de acceso en la consola (**Settings → Access tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde `invalid_credentials` con las mismas dos vías de entrada, ya que la causa habitual es una cuenta que nunca tuvo una.

`billing setup` asocia una tarjeta a la organización, una sola vez. Va primero en la secuencia a propósito: el primer despliegue de un proyecto se rechaza sin ella, y enterarse de eso después de que un bundle haya terminado de subirse es el peor orden posible.

Después de eso, la página **Billing** de la consola enumera las facturas de la organización, cada una con la página alojada de Stripe y su PDF, y previsualiza la próxima factura de cada proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming` imprimen lo mismo. Ambos son para propietarios y administradores de la organización. Donde la plataforma lo ofrece, **Manage billing** abre el portal de clientes de Stripe para la tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no requiere un segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta es rechazada o el banco requiere confirmar el pago, la consola te lleva a **Billing**, donde **Fix your card** guarda otra tarjeta y **Complete the payment** abre la factura de Stripe.

El consumo de un proyecto se muestra en su resumen, en **Usage this month**, y para todos los proyectos a la vez en la página **Billing**: peticiones frente a la cuota incluida (la barra se vuelve ámbar al 80%), errores 5xx, el exceso hasta el momento y la proyección del mes a ese ritmo. El exceso se calcula con el mismo código que lo notifica a Stripe, por lo que es lo que figurará en la factura; aparece en la factura del mes siguiente. `rebase cloud usage` imprime lo mismo, y `rebase cloud usage org` lo muestra para toda la organización. Cualquier miembro puede consultarlo. Las cifras indican lo que aún no pueden ver: el almacenamiento de objetos no se mide, por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecuta dos o más pods de app, sus peticiones no se contabilizan; y un día con muestras perdidas contabiliza por debajo de lo real. Un proyecto con autoescalado también muestra los pods que ejecutó por encima de `--replicas`, en horas-pod, cuánto costaron a sus propias tarifas y si esta plataforma los cobra ya. Un proyecto reclamado desde un agente solo cuenta los días a partir de la reclamación: antes de ella, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crear uno:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un comando y ningún flag que recordar. El `rebase.json` de un scaffold declara `runtime: "managed"` para su backend, y `deploy` lee esa declaración: lo indica durante el proceso (`rebase.json declares runtime: managed — deploying a bundle`), compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la imagen de runtime publicada y sigue el despliegue hasta un estado terminal. El código de salida es el veredicto, por lo que la misma línea funciona desatendida en CI.

Termina indicando dónde responde ahora cada app y si la nueva versión está activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que la dirección respondió tras la compilación: el `/health` de un backend devolvió `ok` y la página de una app estática se cargó (desde este despliegue, cuando la plataforma la sirve). La comprobación espera hasta `--live-timeout` segundos, 60 por defecto; `0` la omite. Si una app no responde a tiempo, el despliegue sigue saliendo con código cero porque el despliegue fue exitoso, y la última línea indica qué app no respondió y por qué. Un despliegue fallido termina en una sola línea, indicando la app y el motivo, con `rebase cloud logs` para ver el log de compilación completo.

Los scripts pasan `--json` para obtener un solo objeto con los mismos datos: `apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de `rebase cloud`, `deploy` no cambia a JSON por sí solo cuando se usa en un pipe.

Lo que permite ese runtime (paquetes y módulos nativos, memoria e instancias, tiempos de espera y tamaños del body, el sistema de archivos, secretos, almacenamiento y red saliente) se encuentra en su propia página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para publicar un artefacto que se compiló previamente (por ejemplo, un trabajo de CI que compila una vez y despliega dos veces), apunta al directorio en lugar de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime administrado tiene su propio flag, `--eject`, y nada más lo solicita: una compilación que trasladaría un proyecto administrado a una imagen de contenedor que pasa a ser de su propiedad se rechaza hasta que tú lo indiques. `--force` solía significar esto, lo que colocaba la acción menos reversible de la CLI bajo la misma palabra que "sobrescribir este archivo"; ahora es una opción desconocida en lugar de un alias, por lo que un script que la contenga se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente tal como están. Cuando su `build` solo copia scripts escritos a mano en `output`, nada los ha analizado, y un archivo con un error tipográfico se publica e impide que la página se cargue. Por lo tanto, antes de subir nada, `deploy` analiza cada archivo `.js`, `.mjs` y `.cjs` en el `output` de cada app estática, junto con cada `<script>` inline en sus archivos `.html`. Eso cubre tanto una app estática desplegada por su cuenta como las apps estáticas integradas en el bundle del backend. Un error de sintaxis detiene el despliegue indicando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Los scripts inline que un navegador no ejecuta como JavaScript se omiten: JSON, import maps, plantillas y cualquier otro `type` que no sea JavaScript, un `<script src>` y un script que aún contenga marcado de plantillas sin renderizar como `{{ }}`. Un archivo `.js` pasa si se analiza correctamente como script clásico o como módulo, ya que la página decide cuál es. No se lee nada dentro de `node_modules`, ni tampoco un `--bundle-dir` precompilado. `--no-verify` omite la comprobación para un único despliegue.

Obsérvalo:

```bash
rebase cloud logs               # el log de compilación
rebase cloud logs --runtime -f  # lo que imprime la app en ejecución, en vivo, hasta Ctrl-C
rebase cloud status             # lo que la plataforma cree que está haciendo el proyecto
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la plataforma está trabajando realmente y sondear es lo adecuado; cuando indica algo, ese algo te está esperando a ti.

Uno de ellos es `email_not_configured`: la app activó el inicio de sesión mediante enlace mágico o código por correo (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) y no tiene configurado ningún servicio de correo, por lo que el despliegue está activo pero nadie puede iniciar sesión con él. Rebase Cloud no envía correos por tu app: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` con `rebase cloud env set`, y luego despliega. `status` lo lee desde el propio `GET /api/auth/config` de la app (su campo `unavailable`), y `deploy` indica lo mismo bajo su comprobación de estado en vivo.

## Almacenamiento de archivos

Un proyecto nuevo no tiene bucket: las subidas se rechazan con `501 STORAGE_NOT_CONFIGURED`, y el resumen del despliegue así lo indica, en lugar de escribirse en un disco que cada despliegue reemplaza.

Proporciónale uno de los dos tipos y luego despliega de nuevo para que la app lo detecte:

```bash
# Un bucket que Rebase gestiona por ti. La página Storage de la consola hace lo mismo.
rebase cloud storage create

# O tu propio bucket compatible con S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omitir para AWS; añadir --force-path-style para MinIO

rebase cloud deploy
```

`rebase cloud storage` lista los buckets del proyecto. Un proyecto con varios asocia cada uno con `--source <key>`; uno que configure el almacenamiento en código no necesita ninguno de los dos.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo que subiría `deploy`, pero lo sirve en una dirección propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa sirviendo lo que servía antes. El despliegue imprime la dirección de la previsualización cuando finaliza la compilación.

Para mantener una sola dirección entre despliegues, ponle nombre a la previsualización. Desplegar con el mismo nombre de nuevo la actualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Con qué se comunica una previsualización depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps estáticas integradas, de la misma forma en que producción las ejecuta. Obtiene un backend propio sobre una **base de datos vacía propia**, nunca la de producción. Arrancar contra la base de datos de producción aplicaría el esquema y las reglas de acceso de la previsualización sobre ella.
- **`rebase cloud deploy web --preview`** previsualizaría una sola app estática por su cuenta, con sus páginas llamando al backend de **producción**. Eso requiere un plano de control que sirva sitios estáticos por sí mismos, y Rebase Cloud aún no lo hace: rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Previsualiza el backend en su lugar, que sirve las apps estáticas integradas en él; un proyecto sin backend administrado no se puede previsualizar todavía.

Una previsualización no sube código fuente ni registra apps o nombres de host, ya que cada una de esas acciones modificaría el proyecto de producción. `--source` y `--eject` no se pueden combinar con `--preview`. Cada uno compila una imagen de contenedor para producción.

```bash
rebase cloud previews                      # nombre, dirección, app, backend, expiración
rebase cloud logs --preview new-checkout   # su log de compilación; -f sigue una compilación en curso
rebase cloud logs --runtime --preview new-checkout -f  # lo que imprime su backend
rebase cloud previews delete new-checkout  # deja de servirla y elimina su base de datos
```

`rebase cloud logs` sin `--preview` corresponde siempre a producción.

La página **Deployments** de la consola lista las mismas previsualizaciones, y permite abrir, ver el log de compilación o eliminar cada una de ellas. Crear una sigue siendo un paso de la CLI.

Una previsualización caduca una semana después de la última vez que se desplegó en ella.

Cuando finaliza, el despliegue comprueba que la dirección de la previsualización responda, al igual que hace un despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). El certificado de una nueva previsualización puede tardar uno o dos minutos, por lo que un despliegue exitoso puede indicar que la dirección aún no responde.

Una previsualización de backend se factura como una unidad de app en el tamaño predeterminado (100m de CPU y 384 MiB de memoria, a la tarifa de tu app según su región y capacidad), prorrateada durante el tiempo que exista, y aparece en el presupuesto mensual del proyecto en la consola. `rebase cloud deploy --preview` imprime el mismo presupuesto para ella, por mes (`cost` bajo `--json`). Iniciar una requiere tener una tarjeta registrada, al igual que un despliegue de producción. Un primer despliegue que falla antes de que nada se ejecute se elimina en lugar de facturarse. Un proyecto puede ejecutar hasta tres previsualizaciones de backend a la vez.

Cada nueva dirección de previsualización obtiene un certificado TLS propio de Let's Encrypt, que permite a un dominio 50 nuevos certificados por semana, compartidos con todos los sitios de producción en él. Las previsualizaciones pueden consumir 20 de ellos en cualquier período de 7 días, en toda la plataforma. A partir de ahí, una nueva previsualización se rechaza (`429`, `preview_cert_budget`) indicando cuándo podrá desplegarse; redesplegar una previsualización existente nunca cuenta para este límite.

La base de datos de una previsualización de backend es una segunda base de datos en el Postgres de **producción**: sus propios datos, pero la misma instancia y el mismo disco. Está limitada a 10 conexiones, para que las previsualizaciones no agoten las de producción, y a 2 GB: una previsualización cuya base de datos supere ese tamaño se pausa. Su backend se detiene, su dirección deja de responder, `rebase cloud previews` y la consola la muestran como `paused` con el motivo, y los propietarios y administradores del proyecto son notificados (`preview.paused`). Sus datos se conservan hasta que expire. Despliégala de nuevo para iniciarla (se pausará de nuevo si la base de datos sigue siendo demasiado grande) o elimínala. Una previsualización pausada se sigue facturando hasta que se elimine o expire. Elimina las previsualizaciones que ya no necesites. Las extensiones instaladas en producción no se instalan en la base de datos de una previsualización.

Las previsualizaciones se están implementando progresivamente. Un plano de control que aún no las admita rechazará `--preview` con `previews_unavailable` y no desplegará nada.

## Revertir (Rollback)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que publicó un despliegue exitoso anterior, y nunca recompila: el valor de un rollback reside en que publica un artefacto que ya se ha ejecutado.

Los despliegues que califican dependen de cómo se despliega el proyecto, y ambos tipos funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (runtime de la plataforma) | El bundle que publicó ese despliegue, en la versión de runtime que el proyecto está ejecutando ahora |

Las apps estáticas integradas en el bundle del backend (un `rebase cloud deploy` simple en un proyecto con backend) forman parte de ese bundle, por lo que revierten junto con él.

Una app estática desplegada por su cuenta (`rebase cloud deploy <app>`) aún no se puede revertir. Su despliegue registra qué app publicó, pero ningún bundle, por lo que el plano de control no tiene nada desde donde restaurarla. La solución es desplegar de nuevo la última versión correcta, por ejemplo desde el commit anterior al defectuoso. Tras dicho despliegue, `deploy` indica esto en lugar de sugerir `rollback`, y `rollback` sin un id lo rechaza en lugar de redesplegar el backend que está en servicio.

Por lo tanto, un rollback necesita un despliegue que haya registrado cualquiera de los dos, lo que significa un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments` marca los que califican, y `--json` reporta `rollbackable` por fila junto con la `image` o el `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál: uno que no tuvo éxito y uno anterior a que la plataforma registrara su artefacto. No hay nada que suponer en ninguno de los dos casos (suponer publicaría lo que se haya compilado o subido más recientemente mientras afirma restaurar este), así que despliega la versión que deseas en su lugar.

Cada despliegue exitoso finaliza indicando la forma de regresar (`rebase cloud rollback`), de modo que esté a la vista en el momento en que se detecta una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de retroceder el historial, y espera a que la versión restaurada esté prestando servicio antes de reportar éxito. Síguelo con `rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos administrada se puede recuperar a cualquier minuto dentro de su ventana de recuperación, desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Requiere dos pasos. Primero se prepara una copia recuperada junto a la base de datos en producción; tu app sigue ejecutándose sobre la activa y el almacenamiento de la copia se factura hasta que realices el cambio (cutover) o la descartes.
Luego, una vez que la copia esté lista, hacer el cutover redirige la app hacia ella y la reinicia. Cualquier dato escrito después de la hora objetivo no estará en la copia. La base de datos original se conserva como vía de retorno y continúa facturando almacenamiento; volver a la anterior, eliminarla o realizar una segunda restauración se gestiona a través de soporte. Solo un propietario o administrador puede preparar, hacer cutover o descartar, y la consola solicita el nombre del proyecto antes de realizar el cambio.

## Protege tu cuenta

Tu cuenta de la consola puede acceder a bases de datos de producción, secretos y facturación, así que protégela en consecuencia. Abre **Account security** desde el menú bajo tu avatar en la consola (o ve a `/account`). La página es tuya, no de una organización: lo que configures allí se aplica en todas las organizaciones a las que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password, Google Authenticator, Authy). La página muestra una clave de configuración para agregar a la app, o un enlace que abre la app con la clave completada en un teléfono, y luego solicita el código de 6 dígitos que muestra la app. A partir de entonces, cada inicio de sesión solicita un código, ya sea que inicies sesión con contraseña, Google o GitHub.
- **Códigos de recuperación.** Activarla te proporciona diez códigos de un solo uso, mostrados una sola vez. Cada uno te permite iniciar sesión en lugar del código de autenticación si pierdes tu teléfono, así que guárdalos antes de cerrar el diálogo. **New recovery codes** los reemplaza y los antiguos dejan de funcionar. Desactivar la verificación en dos pasos y obtener nuevos códigos requieren introducir un código primero.
- **Contraseña.** Cambiarla cierra tu sesión en todos los demás dispositivos. Una cuenta creada con Google, GitHub o LinkedIn no tiene contraseña; la página ofrece enviarte un enlace por correo para establecer una.
- **Dispositivos con sesión iniciada.** Cada navegador y terminal con sesión iniciada en tu cuenta, con su dirección y cuándo inició sesión. Cierra la sesión de cualquier dispositivo que no reconozcas o de todos ellos a la vez.

Los [Tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no solicitan un segundo factor, por lo que CI sigue desplegando después de que la actives. Revoca cualquier token en el que ya no confíes en **Settings → Access tokens**.

## Invita a tu equipo

**Members → Add member** añade a alguien que ya tenga una cuenta de Rebase con una dirección de correo verificada, como administrador o miembro; un propietario puede convertirlo en propietario después. Tienen acceso de inmediato y no se envía nada por correo. Rebase Cloud aún no envía invitaciones, así que pide a un compañero de equipo sin cuenta que se registre y verifique su dirección primero. Desde una terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que lo indicará cuando la dirección no tenga una cuenta asociada.

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los propietarios y administradores de la organización quién desplegó, estableció o reveló una variable de entorno (por nombre, nunca por valor), cambió un dominio, restauró una copia de seguridad, cambió el tamaño, detuvo o eliminó un proyecto, cambió el rol de un miembro o creó un token, y cuándo. La sección **Settings** de un proyecto enlaza a sus propias entradas; las entradas sobre un proyecto eliminado se conservan. Un script puede leerlo con un token creado con `--can audit` en la organización. Las entradas se conservan durante un año. Los filtros están en [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no deberían portar tu contraseña. Proporciónale un token limitado a unas pocas acciones en un solo proyecto, creado desde una terminal con sesión iniciada con `rebase cloud tokens create --project shop --can deploy,logs`, y establécelo como `REBASE_TOKEN`. La facturación, el registro de actividad y la configuración de notificaciones de una organización son permisos independientes (`--can billing`, `audit`, `notifications`) que un token posee únicamente si se solicitan. Los permisos, un flujo de trabajo de GitHub Actions y lo que permanece asociado a una persona identificada se detallan en [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` dota a una app de un backend en vivo antes de que nadie se haya registrado, e imprime una URL de reclamación para que la persona lo conserve; un proyecto que nadie reclame en 72 horas se elimina. Lo que puede hacer el token del proyecto no reclamado, el `REBASE_API_TOKEN` que escribe y lo que cambia al reclamarlo se detallan en [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se calcula a partir de lo que reserva, no a partir de un plan predefinido. `compute` imprime cada parámetro y el presupuesto detallado del propio plano de control para ellos. (`rebase cloud resources` es algo diferente: las bases de datos y los buckets que declara el código, y si cada uno está aprovisionado; consulta la [Referencia de la CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud de la app por instancia, ej. `500m` y `2Gi`. Vacío significa el valor por defecto de la plataforma, que depende de la región (abajo) |
| `--replicas` | Instancias que siempre existen: el mínimo del autoescalador y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar. Las instancias que el autoescalador añade por encima de `--replicas` se miden por pod-segundo a las mismas tarifas y solo se cobran donde la plataforma lo haya activado; **Usage this month** indica cuál es el caso. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoescalador, respecto a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad preemptible: más económica y reiniciada sin previo aviso |
| `--db-instances` | 1–3. `1` es una instancia única sin failover; `2` añade un standby automático |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no es lo mismo que uno fijado al mismo número: un parámetro vacío sigue el valor por defecto de la plataforma y cambia cuando este cambia.

En Bélgica (europe-west1), el valor predeterminado reserva 100m de CPU y 384Mi y puede escalar en ráfagas hasta 2 CPU y 2 GiB; en Falkenstein y Helsinki la memoria puede extenderse hasta 1.4× la solicitud y la CPU hasta 10× (como máximo 1.7 vCPU). `rebase cloud compute` muestra los números de tu proyecto.

La CLI no valida nada intencionadamente: los límites pertenecen al clúster en el que se ejecuta el proyecto y difieren entre proveedores. El plano de control rechaza cualquier valor que no pueda satisfacer e indica el campo. Ejecuta `rebase cloud compute` para ver los €/mes antes y después; un cambio se aplica de inmediato, prorrateado a partir de hoy. Un cambio en la base de datos se aplica de inmediato; se factura al tamaño actual hasta que esté en ejecución. Un nuevo valor de CPU o memoria para la base de datos, o menos instancias, reinicia la base de datos (aproximadamente de 30 segundos a 3 minutos; las conexiones se pierden y se vuelven a conectar): `compute set` lo advierte y pregunta, y fuera de una terminal `--yes` representa el consentimiento. Si ese reinicio falla, `rebase cloud compute apply` lo intenta de nuevo.

## El resto de las funciones

| Grupo de comandos | Qué cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token bearer que la CLI enviaría ahora, para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un solo proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Añadir un servidor Rebase autoalojado a tu cuenta, de modo que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude pueda acceder a él junto con tus proyectos de Cloud. `--list` los muestra, `--remove` quita uno. Propietarios y administradores |
| `init`, `claim` | Con `--claim`: un backend en vivo sin cuenta y un enlace para reclamarlo; `claim` imprime ese enlace de nuevo. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicación y monitorización |
| `deploy-hooks` | URLs secretas que un host de git o CI llama para desplegar el proyecto: listar, crear (la URL se muestra una sola vez), revocar. |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `sleep` | Suspender por inactividad: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` y `status` (por defecto). Suspendido, un proyecto no consume CPU ni memoria y la siguiente petición lo despierta; los trabajos programados y las tareas en segundo plano no se ejecutan mientras tanto. Donde un proyecto no pueda suspenderse, el plano de control lo rechaza e indica el motivo |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma facture a los proyectos detenidos solo por el almacenamiento y la tarifa de la plataforma; la fila **Billing** de la consola lo indica cuando es así |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `alerts` | Los incidentes abiertos del proyecto, y reconocerlos o posponerlos. |
| `cron` | Los cron jobs de la app desplegada y sus ejecuciones registradas, consultados con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, transferida en la reclamación; `rotate` la reemplaza y revoca la anterior. Propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, administración en la propia API de la app: cuándo se rotó por última vez; `rotate` proporciona una nueva a la app. Propietarios y administradores |
| `domains` | Dominios personalizados, registros DNS a añadir y verificación. Un proyecto puede responder en varios, cada uno verificado por separado; `verify` y `remove` toman el dominio sobre el que actuar, que solo se puede omitir cuando hay uno solo (para `verify`, uno aún pendiente). Cada dominio verificado sirve el proyecto como tal; `primary <domain>` elige el canónico y `redirect <domain>` responde a otro con una redirección 308 hacia él, manteniendo la ruta y la query (`--off` vuelve a servirlo directamente); hazlo para `www.` junto a un apex, ya que el inicio de sesión de Google, las cookies y las passkeys funcionan por origen. Un dominio en el que se sirve una app (un `path` de app con un nombre de host) nunca redirige. Un dominio apex (`example.com`, sin subdominio) requiere un registro **A**, porque el DNS no permite CNAME allí. Esa dirección es el ingress de la plataforma y no se garantiza que permanezca invariable: si la plataforma se traslada, un registro A seguirá apuntando a la dirección antigua. Donde tu proveedor de DNS ofrezca ALIAS, ANAME o aplanamiento de CNAME (CNAME flattening) en el apex, apunta el apex al `tenantHost` del proyecto en su lugar, el cual sigue a la plataforma. El CNAME de un subdominio ya la sigue de forma natural. `list` indica `verified, certificate pending` hasta que HTTPS responda con un certificado real. `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo |
| `guests` | Los usuarios invitados que dejó el inicio de sesión anónimo: contarlos, eliminar uno, purgar los que no se hayan visto en mucho tiempo. Consulta [Guests](/docs/cli/cloud/#guests). Propietarios y administradores |
| `extensions` | Lista de permitidos (allowlist) de extensiones de Postgres |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Lo que reserva este proyecto, cuánto cuesta y cómo modificarlo |
| `events` | Qué ocurrió en el backend, lo más reciente primero: el escalado de la app, cambios de base de datos programados y aplicados, una réplica standby tomando el control, el crecimiento del disco |
| `usage` | Peticiones consumidas este mes frente a la cuota incluida y el exceso acumulado hasta el momento, tal como lo contabiliza la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que operan los tenants. Solo para administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, pago |
| `activity` | Registro de auditoría de la organización: quién desplegó, modificó una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications` | Dónde se envían los eventos del proyecto mediante POST: Slack, Discord o cualquier URL https ([Notificaciones de Cloud](/docs/deployment/cloud-notifications/)) |

Cada grupo en esa tabla responde a `--help` con una página propia (una línea de uso, sus flags y ejemplos), y `--help` nunca ejecuta el comando. Un test mantiene el índice de las páginas, por lo que un grupo añadido sin una falla la compilación en lugar de responder con la tabla de contenido. `verify:docs` somete la tabla misma a ese índice: cada grupo que despacha la CLI aparece aquí exactamente una vez, por lo que un grupo añadido sin una fila también hace fallar la compilación.

Mediante pipes, `--help` responde en JSON en su lugar: la misma línea de uso, flags y ejemplos como una estructura fácil de procesar en lugar de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Sin selección de región, sin registro de autoservicio, sin SLA publicado, sin despliegues por rama, tokens que actúan como persona y sin endpoint público para la base de datos. [Qué no incluye la beta](/docs/deployment/cloud-beta-limits/) detalla cada uno claramente, explicando qué implica desplegar con los secretos de producción.

## Autoalojamiento en su lugar

Nada aquí implica un bloqueo de proveedor (lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/) ejecuta la imagen y el bundle idénticos con `docker compose`, y la [guía de Kubernetes](/docs/deployment/kubernetes/) genera la misma topología a partir del chart de Helm.
