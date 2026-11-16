---
sourceHash: 4b05c04581ef0b7d
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye aún la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la misma imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La diferencia es quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Hoy en día ejecuta inquilinos reales y se abre por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta que haya sido admitida. Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Base de datos** | Un PostgreSQL gestionado, con copias de seguridad automáticas y recuperación a un punto en el tiempo |
| **Almacenamiento** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y cada uno se factura por lo que reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se aloja localmente con `docker compose`, y la vía de escape es real: `rebase build` genera un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre la consola en tu navegador e imprime un código corto. Comprueba que la consola muestre el mismo código y aprueba el inicio de sesión allí: la terminal retoma la sesión y la escribe en `~/.rebase/credentials.json`. Si no has iniciado sesión en la consola, inicia sesión allí primero con lo que utilices, incluidos Google y GitHub. Mediante SSH, `rebase cloud login --no-browser` imprime el enlace para abrirlo en tu propia máquina.

`projects create` no acepta argumentos posicionales. El nombre y el subdominio son flags y ambos son obligatorios; en una terminal se te solicitarán, y una ejecución headless que omita cualquiera de ellos finaliza con `input_required` en lugar de inventar uno. **El subdominio no se puede editar después:** es el host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un paso de `link` independiente. Escribe `.rebase/cloud.json`, que registra el id del proyecto y el slug. Ese archivo no es un secreto ni son tus credenciales; esas se encuentran en `~/.rebase/credentials.json`, escrito por `login`.

Sin embargo, se commitea con el código, de modo que un repositorio clonado puede indicar cualquier plano de control. Cuando el host proviene únicamente de ese archivo y no es el propio de la plataforma ni uno en el que hayas iniciado sesión previamente, `login` lo menciona y pregunta antes de enviar tu correo electrónico y contraseña allí. Sin una terminal, o con `--json`, lo rechaza con `unknown_control_plane`; pasa `--url <host>` (o define `REBASE_CLOUD_URL`) para iniciar sesión allí intencionalmente.

Para iniciar sesión sin el navegador, pasa tu correo electrónico: `rebase cloud login --email me@example.com` te pedirá tu contraseña. **¿Te registraste con Google, GitHub o LinkedIn?** Tu cuenta no tiene contraseña, así que utiliza un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido durante diez minutos, y lo introduces en el prompt. Con `--email` y sin contraseña, `rebase cloud login` te pregunta si deseas usar tu contraseña o un código. Los códigos requieren que el plano de control pueda enviar correos electrónicos; si no puede, `--code` lo indica y finaliza con `otp_unavailable`.

Si activaste la autenticación en dos pasos, `login` solicitará entonces el código de tu aplicación de autenticación o uno de tus códigos de recuperación, independientemente del método con el que hayas iniciado sesión. A través del navegador, la consola lo solicitará cuando inicies sesión allí. Ni un código de inicio de sesión ni un segundo factor se pueden escribir sin una terminal. Para un script, crea un token de acceso en la consola (**Settings → Access tokens**) y define `REBASE_TOKEN`; consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde `invalid_credentials` con las mismas dos formas de acceso, ya que la causa habitual es una cuenta que nunca tuvo una.

`billing setup` asocia una tarjeta a la organización, una sola vez. Está al principio de la secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una tarjeta asociada, y descubrirlo después de que un bundle haya terminado de subirse es el peor orden posible.

Después de eso, la página **Billing** de la consola lista las facturas de la organización, cada una con la página alojada de Stripe y su PDF, y previsualiza la próxima factura de cada proyecto. `rebase cloud billing invoices` y `rebase cloud billing upcoming` muestran lo mismo. Ambos son para los propietarios y administradores de la organización. Donde la plataforma lo ofrece, **Manage billing** abre el portal de clientes de Stripe para la tarjeta, los datos de facturación y las facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no requiere un segundo pago: el proyecto se factura en esa tarjeta y se despliega. Si la tarjeta es rechazada, o el banco solicita confirmar el pago, la consola te redirige a **Billing**, donde **Fix your card** guarda otra tarjeta y **Complete the payment** abre la factura de Stripe.

El uso de un proyecto se muestra en su resumen, en **Usage this month**, y para todos los proyectos a la vez en la página **Billing**: peticiones frente a la cuota incluida (la barra se vuelve ámbar al 80%), errores 5xx, el exceso (overage) hasta el momento y la proyección del mes a este ritmo. El exceso se calcula con el mismo código que lo notifica a Stripe, por lo que es lo que figurará en la factura; aparece en la factura del mes siguiente. `rebase cloud usage` imprime lo mismo, y `rebase cloud usage org` para toda la organización. Cualquier miembro puede consultarlo. Las cifras indican lo que aún no pueden medir: el almacenamiento de objetos no se mide, por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecute dos o más pods de app, sus peticiones no se contabilizan; y un día con muestras perdidas subestima el cómputo. Un proyecto con escalado automático también muestra los pods que ejecutó por encima de `--replicas`, en pod-horas, cuánto cuestan según sus propias tarifas y si esta plataforma los cobra ya. Un proyecto reclamado desde un agente solo cuenta los días a partir de la reclamación: antes de ella, el proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crear uno:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando y ningún flag que recordar. El `rebase.json` de un scaffold declara `runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo indica durante el proceso (`rebase.json declares runtime: managed — deploying a bundle`)—, compila la app en `dist-bundle`, sube el bundle, lo ejecuta en la imagen de runtime publicada y sigue el despliegue hasta un estado final. El código de salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Finaliza indicando dónde responde ahora cada aplicación y si la nueva versión está activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

«Live» significa que la dirección respondió después de la compilación: el `/health` de un backend devolvió `ok`, y la página de una app estática se cargó (desde este despliegue, cuando la plataforma la sirve). La comprobación espera hasta `--live-timeout` segundos, 60 por defecto; `0` la omite. Si una app no responde a tiempo, el despliegue sigue saliendo con código cero porque el despliegue tuvo éxito, y la última línea indica qué app no respondió y por qué. En cambio, un despliegue fallido termina en una sola línea, indicando la app y el motivo, con `rebase cloud logs` para ver el registro de compilación completo.

Los scripts pueden pasar `--json` para obtener un único objeto con los mismos datos: `apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del despliegue. A diferencia del resto de `rebase cloud`, `deploy` no cambia a JSON automáticamente cuando se usa en una tubería.

Lo que permite ese runtime (paquetes y módulos nativos, memoria e instancias, tiempos de espera y tamaños del body, el sistema de archivos, secretos, almacenamiento y red de salida) se encuentra en su propia página: [Managed backend runtime](/docs/deployment/managed-runtime/).

Para desplegar un artefacto compilado previamente —por ejemplo, un trabajo de CI que compila una vez y despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Salir del runtime gestionado tiene su propio flag, `--eject`, y nada más lo solicita: una compilación que trasladaría un proyecto gestionado a una imagen de contenedor que luego pasa a ser de su propiedad se rechaza hasta que tú lo indiques. Antes se usaba `--force` para esto, lo que colocaba la acción menos reversible de la CLI bajo la misma palabra que «sobrescribir este archivo»; ahora es una opción desconocida en lugar de un alias, por lo que un script que la incluya se detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una app estática se sirven exactamente tal como son. Cuando su `build` solo copia scripts escritos a mano en `output`, nada los ha analizado sintácticamente, y un archivo con un error tipográfico puede pasar a producción e impedir que la página se cargue. Por lo tanto, antes de subir nada, `deploy` analiza sintácticamente cada archivo `.js`, `.mjs` y `.cjs` en el `output` de cada app estática, junto con cada `<script>` inline en sus archivos `.html`. Esto cubre tanto una app estática desplegada por separado como apps estáticas integradas en el bundle del backend. Un error de sintaxis detiene el despliegue mostrando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Los scripts inline que un navegador no ejecuta como JavaScript se omiten: JSON, import maps, plantillas y cualquier otro `type` que no sea JavaScript, etiquetas `<script src>` y scripts que aún contengan marcado de plantillas sin renderizar como `{{ }}`. Un archivo `.js` es válido si se analiza como un script clásico o como un módulo, ya que la página decide cuál de ellos es. No se lee nada dentro de `node_modules`, ni tampoco un `--bundle-dir` precompilado. `--no-verify` omite la comprobación para un despliegue.

Monitorízalo:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` informa de `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la plataforma está trabajando realmente y hacer sondeo (polling) es lo adecuado; cuando indica algo, ese algo te está esperando a ti.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que haría `deploy`, pero lo sirve en una dirección propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa sirviendo lo que servía antes. El despliegue imprime la dirección de la preview cuando finaliza la compilación.

Para mantener una misma dirección entre despliegues, asigna un nombre a la preview. Desplegar de nuevo con el mismo nombre la actualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Con qué se comunica una preview depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus apps estáticas integradas, de la misma manera en que las ejecuta producción. Obtiene un backend propio en una **base de datos vacía propia**, nunca la de producción. Arrancar contra la base de datos de producción aplicaría el esquema y las reglas de acceso de la preview sobre ella.
- **`rebase cloud deploy web --preview`** previsualizaría una app estática por separado, llamando sus páginas al backend de **producción**. Eso requiere un plano de control que sirva sitios estáticos por sí mismos, y Rebase Cloud aún no lo hace: lo rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. En su lugar, previsualiza el backend, que sirve las apps estáticas integradas en él; un proyecto sin backend gestionado aún no se puede previsualizar.

Una preview no sube código fuente y no registra apps ni nombres de host, ya que cualquiera de esas acciones alteraría el proyecto de producción. `--source` y `--eject` no se pueden combinar con `--preview`. Cada uno de ellos compila una imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sin `--preview` siempre corresponde a producción.

La página **Deployments** de la consola lista las mismas previews, y permite abrir, mostrar el registro de compilación o eliminar cada una de ellas. Crearla sigue siendo un paso de la CLI.

Una preview caduca una semana después de su último despliegue.

Cuando finaliza, el despliegue comprueba que la dirección de la preview responda, al igual que un despliegue de producción (`--live-timeout <seconds>`, `0` para omitir). El certificado de una nueva preview puede tardar un minuto o dos, por lo que un despliegue que tuvo éxito puede indicar que la dirección aún no responde.

Una preview de backend se factura como una unidad de app en el tamaño por defecto (100m de CPU y 384 MiB de memoria, a la tarifa de tu app para su región y capacidad), prorrateada durante el tiempo que exista, y aparece en la estimación mensual del proyecto en la consola. `rebase cloud deploy --preview` imprime la misma estimación para ella, por mes (`cost` con `--json`). Iniciar una requiere una tarjeta registrada, al igual que un despliegue de producción. Un primer despliegue que falle antes de que se ejecute nada se elimina en lugar de facturarse. Un proyecto puede ejecutar hasta tres previews de backend a la vez.

Cada nueva dirección de preview obtiene su propio certificado TLS de Let's Encrypt, que permite a un dominio 50 certificados nuevos a la semana, compartidos con todos los sitios de producción en él. Las previews pueden consumir 20 de ellos en cualquier período de 7 días, en toda la plataforma. Pasado ese límite, una nueva preview es rechazada (`429`, `preview_cert_budget`) indicando cuándo se podrá desplegar; redesplegar una preview ya existente nunca cuenta.

La base de datos de una preview de backend es una segunda base de datos en el Postgres de **producción**: sus propios datos, pero la misma instancia y el mismo disco. Está limitada a 10 conexiones, por lo que las previews no pueden agotar las de producción, y a 2 GB: una preview cuya base de datos supere ese tamaño se pausa. Su backend se detiene, su dirección deja de responder, `rebase cloud previews` y la consola la muestran como `paused` con el motivo, y se notifica a los propietarios y administradores del proyecto (`preview.paused`). Sus datos se conservan hasta que caduca. Despliégala de nuevo para iniciarla (se pausará de nuevo si la base de datos sigue siendo demasiado grande) o elimínala. Una preview pausada se sigue facturando hasta que se elimina o caduca. Elimina las previews que ya no necesites. Las extensiones instaladas en producción no se instalan en la base de datos de una preview.

Las previews se están desplegando gradualmente. Un plano de control que aún no las admita rechazará `--preview` con `previews_unavailable` y no desplegará nada.

## Revertir un despliegue (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso anterior, y nunca recompila: el valor de un rollback reside en que envía un artefacto que ya se ha ejecutado.

Cuáles despliegues son aptos depende de cómo se despliegue el proyecto, y ambos métodos son válidos:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación de código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto está ejecutando ahora |

Las apps estáticas integradas en el bundle del backend (un `rebase cloud deploy` simple en un proyecto con backend) son parte de ese bundle, por lo que se revierten con él.

Una app estática desplegada por separado (`rebase cloud deploy <app>`) aún no se puede revertir. Su despliegue registra qué app publicó, pero ningún bundle, por lo que el plano de control no tiene nada desde donde restaurarla. La solución es desplegar de nuevo la última versión correcta, por ejemplo desde el commit anterior al defectuoso. Tras dicho despliegue, `deploy` indica esto en lugar de sugerir `rollback`, y `rollback` sin un id lo rechaza en lugar de redesplegar el backend que está en servicio.

Por lo tanto, un rollback necesita un despliegue que haya registrado cualquiera de las dos cosas, lo que significa un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments` marca los que cumplen los requisitos, y `--json` informa de `rollbackable` por cada fila junto con la `image` o el `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál: uno que no tuvo éxito y uno anterior a que la plataforma registrara su artefacto. No hay nada que suponer en ninguno de los dos casos —adivinar enviaría lo que se haya compilado o subido más recientemente mientras se afirma restaurar este—, así que en su lugar despliega la versión que desees.

Cada despliegue exitoso finaliza indicando la forma de volver atrás (`rebase cloud rollback`), de modo que esté a la vista en el momento en que se detecte una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que la versión restaurada empiece a responder antes de reportar éxito. Puedes seguirlo con `rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos gestionada se puede recuperar a cualquier minuto dentro de su ventana de recuperación, desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Consta de dos pasos. Primero se prepara una copia recuperada junto a la base de datos en producción; tu aplicación sigue ejecutándose en la activa, y el almacenamiento de la copia se factura hasta que realices el cambio (cutover) o la descartes.
Luego, una vez que la copia está lista, realizar el cutover vuelve a apuntar la app hacia ella y la reinicia. Cualquier dato escrito después del momento objetivo no estará en la copia. La base de datos original se conserva como vía de retorno y continúa facturando almacenamiento; volver a cambiar a ella, eliminarla o realizar una segunda restauración se gestiona a través de soporte. Solo un propietario o administrador puede preparar, realizar el cutover o descartar, y la consola solicita el nombre del proyecto antes de ejecutar el cambio.

## Protege tu cuenta

Tu cuenta de la consola puede acceder a bases de datos de producción, secretos y facturación, así que protégela debidamente. Abre **Account security** desde el menú situado bajo tu avatar en la consola (o ve a `/account`). La página es tuya, no de una organización: lo que configures allí se aplica en cada organización a la que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación (1Password, Google Authenticator, Authy). La página muestra una clave de configuración para agregarla a la app, o un enlace que abre la aplicación con la clave completada en un teléfono, y luego solicita el código de 6 dígitos que muestra la aplicación. A partir de ese momento, cada inicio de sesión solicitará un código, tanto si inicias sesión con contraseña como con Google o GitHub.
- **Códigos de recuperación.** Activarlo te proporciona diez códigos de un solo uso, que se muestran una única vez. Cada uno de ellos te permite iniciar sesión en lugar del código de autenticación si pierdes tu teléfono, así que guárdalos antes de cerrar el cuadro de diálogo. **New recovery codes** los reemplaza y los antiguos dejan de funcionar. Desactivar la verificación en dos pasos y obtener nuevos códigos requieren ingresar un código primero.
- **Contraseña.** Cambiarla cerrará la sesión en todos los demás dispositivos. Una cuenta creada con Google, GitHub o LinkedIn no tiene contraseña; la página te ofrece enviarte un enlace por correo para definir una.
- **Dispositivos conectados.** Cada navegador y terminal con la sesión iniciada en tu cuenta, con su dirección y la fecha y hora de inicio de sesión. Cierra la sesión en cualquier dispositivo que no reconozcas, o en todos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones y no solicitan un segundo factor, por lo que CI continuará desplegando después de que lo actives. Revoca cualquier token en el que ya no confíes en **Settings → Access tokens**.

## Invitar a tu equipo

**Members → Invite member** proporciona un enlace para copiar (enviado por correo electrónico cuando este plano de control envía emails) que funciona una vez, durante 7 días, para una cuenta que haya verificado esa dirección; nadie se une hasta que acepte. Invita a un administrador o miembro, y conviértelo en propietario una vez que se haya unido. Los propietarios y administradores pueden verla, reenviarla o revocarla en **Pending invitations**; desde una terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los propietarios y administradores de la organización quién desplegó, definió o reveló una variable de entorno (por nombre, nunca por valor), cambió un dominio, restauró una copia de seguridad, redimensionó, detuvo o eliminó un proyecto, cambió el rol de un miembro o creó un token, y cuándo. La sección **Settings** de un proyecto enlaza a sus propias entradas; las entradas de un proyecto eliminado se conservan. Un script puede leerlo con un token creado con `--can audit` en la organización. Las entradas se conservan durante un año. Los filtros están en [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no debería llevar tu contraseña. Otórgale un token limitado a unas pocas acciones en un proyecto, creado desde una terminal con sesión iniciada mediante `rebase cloud tokens create --project shop --can deploy,logs`, y establécelo como `REBASE_TOKEN`. La facturación, el registro de actividad y la configuración de notificaciones de una organización son capacidades independientes (`--can billing`, `audit`, `notifications`) que un token solo posee si se solicitan expresamente. Las capacidades, un flujo de trabajo de GitHub Actions y lo que permanece asociado a una persona identificada se detallan en [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` le da a una app un backend activo antes de que nadie se haya registrado e imprime una URL de reclamación para que la persona se quede con él; un proyecto que nadie reclame en 72 horas se elimina. Lo que puede hacer el token del proyecto no reclamado, el `REBASE_API_TOKEN` que escribe y lo que cambia al reclamarlo se detallan en [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se basa en lo que reserva, no en un plan fijo. `compute` muestra cada parámetro y el desglose de costes detallado del plano de control para ellos. (`rebase cloud resources` es algo diferente: las bases de datos y buckets que declara el código, y si cada uno está aprovisionado; consulta la [referencia de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, p. ej. `500m` y `2Gi`. Vacío significa el valor por defecto de la plataforma: `100m` y `384Mi`, con picos (bursting) de hasta 2 CPU y `2Gi` |
| `--replicas` | Instancias que siempre existen: el mínimo del escalador automático y lo que la suscripción del proyecto factura mensualmente |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar. Las instancias que el escalador automático añade por encima de `--replicas` se miden por segundo de pod a las mismas tarifas, y se cobran solo donde la plataforma lo haya activado; **Usage this month** indica si aplica. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el escalador automático, frente a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (spot): más económica y reiniciada sin previo aviso |
| `--db-instances` | 1–3. `1` es una instancia única sin tolerancia a fallos (failover); `2` añade una réplica en espera automática (standby) |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no es lo mismo que uno fijado al mismo número: un parámetro vacío sigue el valor por defecto de la plataforma y cambia cuando este cambia.

La CLI no valida nada a propósito: los límites pertenecen al clúster en el que se ejecuta el proyecto y varían entre proveedores. El plano de control rechaza cualquier valor que no pueda cumplir e indica el campo correspondiente. Ejecuta `rebase cloud compute` para ver el coste en €/mes antes y después; un cambio se aplica de inmediato, prorrateado desde hoy, excepto uno que reinicie la base de datos, el cual esperará a una ventana de mantenimiento.

## El resto de la superficie

| Grupo de comandos | Lo que abarca |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token bearer que la CLI enviaría ahora, para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Añadir un servidor Rebase autoalojado a tu cuenta, para que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude acceda a él junto con tus proyectos de Cloud. `--list` los muestra, `--remove` elimina uno. Solo propietarios y administradores |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta y un enlace para reclamarlo; `claim` vuelve a imprimir ese enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitorización |
| `deploy-hooks` | URLs secretas a las que llama un host de git o CI para desplegar el proyecto: listar, crear (la URL se muestra una sola vez), revocar. |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview` y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma facture los proyectos detenidos únicamente por el almacenamiento y la tarifa de plataforma; la fila **Billing** de la consola lo indica cuando corresponde |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo hace |
| `alerts` | Los incidentes abiertos del proyecto, y cómo reconocerlos o posponerlos. |
| `cron` | Los cron jobs de la aplicación desplegada y sus ejecuciones registradas, leídos con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, entregada en la reclamación; `rotate` la sustituye y revoca la anterior. Propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, administración sobre la propia API de la app: cuándo se rotó por última vez; `rotate` le da una nueva a la app. Propietarios y administradores |
| `domains` | Dominios personalizados, los registros DNS que se deben añadir y verificación. Un proyecto puede responder en varios, cada uno verificado por separado; `verify` y `remove` aceptan el dominio sobre el que actuar, el cual solo puede omitirse cuando existe uno solo (para `verify`, uno todavía pendiente). Cada dominio verificado sirve el proyecto por sí mismo; `primary <domain>` elige el canónico y `redirect <domain>` responde a otro con un 308 hacia él, conservando ruta y query (`--off` vuelve a servirlo directamente) —haz esto para `www.` junto a un dominio apex, ya que el inicio de sesión de Google, las cookies y las passkeys funcionan por origen. Un dominio en el que se sirve una app (un `path` de app con un nombre de host) nunca redirige. `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Vincular o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo |
| `guests` | Los usuarios invitados que dejó el inicio de sesión anónimo: contarlos, eliminar uno, purgar los que no se han visto en mucho tiempo. Consulta [Guests](/docs/cli/cloud/#guests). Propietarios y administradores |
| `extensions` | La lista de extensiones de Postgres permitidas |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo cambiarlo |
| `events` | Qué le ocurrió al backend, lo más reciente primero: escalado de la app, cambios de base de datos programados y aplicados, una réplica en espera (standby) tomando el control, el disco creciendo |
| `usage` | Peticiones utilizadas este mes frente a la cuota incluida y el exceso acumulado hasta ahora, tal como lo contabiliza la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que se ejecutan los inquilinos. Solo para administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, pago |
| `activity` | El registro de auditoría de la organización: quién desplegó, cambió una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications` | Dónde se envían los eventos del proyecto mediante POST: Slack, Discord o cualquier URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo de esa tabla responde a `--help` con una página propia —una línea de uso, sus flags y ejemplos— y `--help` nunca ejecuta el comando. Un test mantiene el índice de las páginas, por lo que un grupo añadido sin una falla la compilación en lugar de responder con la tabla de contenidos. `verify:docs` vincula la tabla misma a ese índice: cada grupo que despacha la CLI aparece aquí exactamente una vez, por lo que un grupo añadido sin una fila también hace fallar la compilación.

En una tubería, `--help` responde en JSON en su lugar: la misma línea de uso, flags y ejemplos en forma de estructura legible en vez de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Dicho claramente, porque enterarse más tarde es peor:

- **Sin elección de región.** Actualmente todo se ejecuta en una sola región. El modelo de ubicación existe en la plataforma, pero un proyecto no puede elegir región. `projects create --provider` y `--region` no son la excepción que parecen ser: registran a cuál de los destinos de despliegue registrados del plano de control pertenece un proyecto, y solo hay uno, por lo que ambos toman ese valor por defecto y ninguno mueve un proyecto a ningún otro sitio. `rebase cloud projects create --help` indica lo mismo.
- **No es autoservicio.** El acceso se otorga por lotes; no existe un sistema de registro y pago directo.
- **Sin SLA publicado** ni SOC 2. Si necesitas alguno de ellos, indícalo al solicitar acceso en lugar de darlo por sentado.
- **Sin despliegues por rama** ni GitHub App propia. Los deploy hooks —URLs secretas a las que apuntas un webhook del repositorio— son la automatización admitida. Los [despliegues de preview](#previsualizar-un-cambio) se están implementando gradualmente y se inician desde la CLI.
- **Los tokens actúan como una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) lo emite una cuenta y actúa en su nombre; todavía no existe una identidad de máquina perteneciente a la organización. Si en su lugar inicias sesión desde CI, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD` desde un gestor de secretos; `--password` incluye la contraseña en el historial de tu shell y en la tabla de procesos, y así lo advierte antes de iniciar sesión. Si el archivo `.rebase/cloud.json` del repositorio nombra un plano de control distinto al propio de la plataforma, pásalo también como `--url`: sin una terminal, `login` se niega a enviar una contraseña a un host especificado únicamente por el archivo descargado.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no está expuesta a internet, por lo que el host que muestra la consola es la dirección que tu backend usa para ella y no resuelve a nada en tu máquina. `rebase cloud db connect` abre un puerto local conectado a esa base de datos mediante un túnel a través del plano de control mientras lo dejes en ejecución, pero no existe un nombre de host permanente al que pueda conectarse un servicio de terceros. Tanto ese túnel como la contraseña detrás de `rebase cloud db info --reveal` requieren el rol de propietario o administrador de la organización: el mismo que solicita el editor SQL de Studio, ya que los tres desembocan en una sesión sobre tus datos de producción.
- **Desplegar es ejecutar código con los secretos de producción.** El entorno de la app contiene `REBASE_SERVICE_KEY` (administrador en su propia API), `DATABASE_URL` y `JWT_SECRET`, por lo que el código que despliegue un miembro puede leerlos, aun cuando solo los propietarios y administradores puedan revelarlos en la consola. Invita como miembro únicamente a personas a las que les confiarías esos valores.
- **La clave de servicio se puede reemplazar.** La sección **Settings** del proyecto (o `rebase cloud service-key rotate`) genera una nueva `REBASE_SERVICE_KEY` y reinicia la app con ella. La clave antigua funciona hasta que termina el reinicio y nunca después, por lo que cualquier elemento que la haya copiado será rechazado a partir de ese momento. Reclamar un proyecto hace lo mismo.

## Autoalojamiento como alternativa

Nada de esto implica dependencia de proveedor. La [guía de autoalojamiento](/docs/deployment/self-hosting/) ejecuta exactamente la misma imagen y bundle con `docker compose`, y la [guía de Kubernetes](/docs/deployment/kubernetes/) reproduce la misma topología a partir del chart de Helm.
