---
sourceHash: d4b6c7f0879d6a75
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye la beta privada todavía.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la
misma imagen `rebasepro/server` publicada, el mismo bundle, el mismo Postgres. La
diferencia radica en quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Actualmente ejecuta inquilinos reales y se
abre por tandas. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta
a la que se le haya concedido acceso. Todo lo demás en este sitio funciona sin una.
:::

## Qué es

Un **proyecto** de Cloud se compone de tres cosas que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no la compilación de un contenedor |
| **Database** | Un PostgreSQL administrado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Storage** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y cada uno se factura
por lo que reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
produce un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` no acepta argumentos posicionales. El nombre y el subdominio son
flags, y ambos son obligatorios; en una terminal se solicitarán interactivamente,
y una ejecución desatendida (headless) que omita cualquiera de ellos saldrá con
`input_required` en lugar de inventar uno. **El subdominio no se puede editar después:**
es el host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo
deliberadamente.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay
un paso `link` por separado. Escribe `.rebase/cloud.json`, que registra el id y el slug
del proyecto. Ese archivo no es un secreto ni contiene tus credenciales; estas residen
en `~/.rebase/credentials.json`, creado por `login`.

Sin embargo, se incluye en el control de versiones con el código, de modo que un
repositorio clonado puede indicar cualquier plano de control. Cuando el host proviene
únicamente de ese archivo, y no es el de la propia plataforma ni uno en el que hayas
iniciado sesión previamente, `login` lo menciona y te pide confirmación antes de
enviar tu correo y contraseña allí. Sin una terminal, o con `--json`, lo rechaza con
`unknown_control_plane`; pasa `--url <host>` (o define `REBASE_CLOUD_URL`) para
iniciar sesión allí intencionadamente.

**¿Te registraste con Google, GitHub o LinkedIn?** Tu cuenta no tiene contraseña,
así que inicia sesión con un código en su lugar:

```bash
rebase cloud login --code --email me@example.com
```

El plano de control te envía por correo electrónico un código de 6 dígitos, válido
durante diez minutos, y lo introduces en la terminal. Si se ejecuta directamente en
una terminal, `rebase cloud login` pregunta si deseas usar tu contraseña o un código.
Los códigos requieren que el plano de control pueda enviar correos electrónicos; si
no puede, `--code` lo indica y sale con `otp_unavailable`.

Si activaste la autenticación en dos pasos, `login` te pedirá el código de tu
aplicación de autenticación o uno de tus códigos de recuperación, independientemente
de cómo hayas iniciado sesión. Ni el código de inicio de sesión ni el segundo factor
se pueden introducir sin una terminal. Para un script, crea un token de acceso en la
consola (**Settings → Access tokens**) y define `REBASE_TOKEN`; consulta
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Una contraseña incorrecta responde `invalid_credentials` con las mismas dos formas
de acceso, ya que la causa habitual es una cuenta que nunca tuvo una.

`billing setup` vincula una tarjeta a la organización, una sola vez. Va primero en
la secuencia deliberadamente: el primer despliegue de un proyecto se rechaza sin
ella, y descubrir eso después de que el bundle haya terminado de subirse es el peor
escenario.

Después de eso, la página **Billing** de la consola lista las facturas de la
organización, cada una con la página alojada de Stripe y su PDF, y muestra una vista
previa de la próxima factura de cada proyecto. `rebase cloud billing invoices` y
`rebase cloud billing upcoming` muestran lo mismo. Ambos son para propietarios y
administradores de la organización. Donde la plataforma lo ofrezca, **Manage billing**
abre el portal de clientes de Stripe para la tarjeta, los datos de facturación y las
facturas anteriores.

Con una tarjeta ya registrada, crear otro proyecto en la consola no requiere un
segundo pago: el proyecto se factura a esa tarjeta y se despliega. Si la tarjeta es
rechazada o el banco solicita confirmar el pago, la consola te lleva a **Billing**,
donde **Fix your card** guarda otra tarjeta y **Complete the payment** abre la
factura de Stripe.

Lo que ha utilizado un proyecto se muestra en su vista general, bajo **Usage this month**,
y para todos los proyectos a la vez en la página **Billing**: peticiones frente a la
cuota incluida (la barra se vuelve ámbar al 80%), errores 5xx, el exceso acumulado
hasta el momento y la proyección para el mes a este ritmo. El exceso se calcula con
el mismo código que lo reporta a Stripe, por lo que es lo que figurará en la factura;
aparece en la factura del mes posterior. `rebase cloud usage` imprime lo mismo, y
`rebase cloud usage org` para toda la organización. Cualquier miembro puede consultarlo.
Las cifras indican lo que aún no pueden ver: el almacenamiento de objetos no se mide,
por lo que no se factura exceso de almacenamiento; mientras un proyecto ejecute dos
o más pods de la app, sus peticiones no se contabilizan; y un día con muestras
perdidas registra menos de lo real. Un proyecto con autoescalado también muestra los
pods ejecutados por encima de `--replicas`, en horas-pod, cuánto costaron según sus
propias tarifas y si esta plataforma los cobra actualmente. Un proyecto reclamado
desde un agente solo cuenta los días a partir de la reclamación: antes de eso, el
proyecto pertenecía a la plataforma.

Un proyecto existente se vincula sin necesidad de crear uno nuevo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando, y ningún flag que recordar. El `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración; lo indica en
la salida (`rebase.json declares runtime: managed — deploying a bundle`), compila la
app en `dist-bundle`, sube el bundle, lo ejecuta en la imagen de runtime publicada
y sigue el despliegue hasta un estado final. El código de salida es el veredicto, por
lo que la misma línea funciona de forma desatendida en CI.

Finaliza indicando dónde responde ahora cada aplicación y si la nueva versión está
activa allí:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

«Live» significa que la dirección respondió tras la compilación: el `/health` de un
backend devolvió `ok` y la página de una aplicación estática se cargó (desde este
despliegue, cuando la plataforma la sirve). La comprobación espera hasta
`--live-timeout` segundos, 60 por defecto; `0` la omite. Si una app no responde a
tiempo, el despliegue aún termina con código cero, porque el despliegue tuvo éxito,
y la última línea indica qué app no respondió y por qué. Un despliegue fallido
termina en una sola línea en su lugar, indicando la aplicación y el motivo, con
`rebase cloud logs` para consultar el registro de compilación completo.

Los scripts pasan `--json` para obtener un solo objeto con los mismos datos:
`apps`, `hosts`, `live`, `liveChecks`, `durationMs` y el id del despliegue. A
diferencia del resto de `rebase cloud`, `deploy` no cambia automáticamente a JSON
cuando se redirige la salida por tubería (pipe).

Lo que permite ese runtime —paquetes y módulos nativos, memoria e instancias,
tiempos de espera (timeouts) y tamaños de cuerpo, sistema de archivos, secretos,
almacenamiento y red saliente— se encuentra en su propia página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para desplegar un artefacto compilado previamente —por ejemplo, en un trabajo de CI
que compila una vez y despliega dos— apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime administrado requiere su propio flag, `--eject`, y nada más lo
solicitará: una compilación que trasladaría un proyecto administrado a una imagen de
contenedor de la que luego se hace responsable se rechazará a menos que lo indiques
explícitamente. `--force` solía significar esto, lo que colocaba la acción menos
reversible de la CLI bajo la misma palabra que «sobrescribir este archivo»; ahora es
una opción desconocida en lugar de un alias, por lo que un script que la contenga se
detendrá.

### La comprobación de sintaxis antes de la subida

Los archivos de una aplicación estática se sirven exactamente tal como son. Cuando
su comando `build` solo copia scripts escritos a mano en `output`, nada los ha
analizado sintácticamente, y un archivo con un error tipográfico podría publicarse e
impedir que la página se cargue. Por lo tanto, antes de subir nada, `deploy` analiza
sintácticamente cada archivo `.js`, `.mjs` y `.cjs` en el `output` de cada app
estática, junto con cada `<script>` inline en sus archivos `.html`. Esto cubre tanto
una aplicación estática desplegada por su cuenta como aplicaciones estáticas
integradas en el bundle del backend. Un error de sintaxis detiene el despliegue
mostrando el archivo, la línea y la columna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, el `code` del error es `syntax_error`. Los scripts inline que un
navegador no ejecuta como JavaScript se omiten: JSON, mapas de importación (import maps),
plantillas y cualquier otro `type` que no sea JavaScript, un `<script src>` y scripts
que aún contienen marcado de plantillas sin renderizar como `{{ }}`. Un archivo `.js`
pasa si se analiza correctamente como script clásico o como módulo, ya que la página
decide cuál es. No se lee nada dentro de `node_modules`, ni tampoco un `--bundle-dir`
precompilado. `--no-verify` omite la comprobación para un único despliegue.

Monitóralo:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` informa de `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando realmente y hacer sondeos (polling) es lo adecuado;
cuando indica algo, ese algo está esperando una acción por tu parte.

## Previsualizar un cambio

```bash
rebase cloud deploy --preview
```

Esto compila y sube exactamente lo mismo que `deploy`, pero lo sirve en una dirección
propia, como `https://shop--k3x9ab.rebase.website`. Producción continúa sirviendo lo
que servía antes. El despliegue imprime la dirección de la vista previa cuando
termina la compilación.

Para mantener la misma dirección entre despliegues, asigna un nombre a la vista previa.
Desplegar con el mismo nombre de nuevo la actualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Con qué se comunica una vista previa depende de lo que hayas desplegado:

- **`rebase cloud deploy --preview`** previsualiza el backend, con sus aplicaciones
  estáticas integradas, de la misma forma en que las ejecuta producción. Obtiene un
  backend propio en una **base de datos vacía propia**, nunca la de producción.
  Arrancar contra la base de datos de producción aplicaría el esquema y las reglas de
  acceso de la vista previa sobre ella.
- **`rebase cloud deploy web --preview`** previsualizaría una aplicación estática por
  separado, haciendo que sus páginas llamen al backend de **producción**. Esto
  requiere un plano de control que sirva sitios estáticos por sí mismos, y Rebase
  Cloud aún no lo hace: lo rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada.
  Previsualiza el backend en su lugar, que sirve las aplicaciones estáticas integradas
  en él; un proyecto sin un backend administrado aún no se puede previsualizar.

Una vista previa no sube código fuente ni registra aplicaciones o nombres de host,
ya que cualquiera de esas acciones modificaría el proyecto de producción. `--source`
y `--eject` no se pueden combinar con `--preview`. Cada una de ellas compila una
imagen de contenedor para producción.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sin `--preview` siempre corresponde a producción.

La página **Deployments** de la consola lista las mismas vistas previas y permite
abrir, ver el registro de compilación o eliminar cada una de ellas. La creación
sigue siendo un paso de la CLI.

Una vista previa expira una semana después de su último despliegue.

Al finalizar, el despliegue comprueba que la dirección de la vista previa responda,
igual que un despliegue de producción (`--live-timeout <seconds>`, `0` para omitir).
El certificado de una nueva vista previa puede tardar uno o dos minutos, por lo que
un despliegue exitoso puede indicar que la dirección aún no responde.

Una vista previa de backend se factura como una unidad de aplicación al tamaño
predeterminado (100m de CPU y 384 MiB de memoria, a la tarifa de tu aplicación para
su región y capacidad), prorrateada durante el tiempo que exista, y aparece en el
presupuesto mensual del proyecto en la consola. `rebase cloud deploy --preview`
muestra la misma estimación de coste al mes (`cost` con `--json`). Iniciar una
requiere una tarjeta registrada, al igual que un despliegue de producción. Un primer
despliegue que falla antes de que se ejecute nada se elimina en lugar de facturarse.
Un proyecto puede ejecutar hasta tres vistas previas de backend a la vez.

Cada nueva dirección de vista previa obtiene un certificado TLS propio de Let's Encrypt,
que permite a un dominio 50 certificados nuevos a la semana, compartidos con todos
los sitios de producción en él. Las vistas previas pueden tomar 20 de ellos en cualquier
ventana de 7 días en toda la plataforma. A partir de ahí, se rechaza una nueva vista
previa (`429`, `preview_cert_budget`) indicando cuándo se podrá desplegar; redesplegar
una vista previa ya existente nunca descuenta del cupo.

La base de datos de una vista previa de backend es una segunda base de datos en el
Postgres de **producción**: sus propios datos, pero la misma instancia y el mismo disco.
Está limitada a 10 conexiones, para que las vistas previas no agoten las de
producción, y a 2 GB: una vista previa cuya base de datos supere ese límite se pausa.
Su backend se detiene, su dirección deja de responder, `rebase cloud previews` y la
consola la muestran como `paused` con el motivo, y se notifica a los propietarios y
administradores del proyecto (`preview.paused`). Sus datos se conservan hasta que
expire. Despliégala de nuevo para iniciarla (se pausará de nuevo si la base de datos
sigue siendo demasiado grande) o elimínala. Una vista previa pausada se sigue
facturando hasta que se elimine o expire. Elimina las vistas previas que ya no necesites.
Las extensiones instaladas en producción no se instalan en la base de datos de una vista previa.

Las vistas previas se están desplegando de forma gradual. Un plano de control que aún
no las admita rechazará `--preview` con `previews_unavailable` y no desplegará nada.

## Revertir cambios (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que publicó un despliegue exitoso
anterior, y nunca recompila: el valor de un rollback reside en que envía un
artefacto que ya se ha ejecutado previamente.

Los despliegues que califican dependen de cómo se haya desplegado el proyecto, y
ambos tipos funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que publicó ese despliegue, en la versión de runtime que el proyecto esté ejecutando ahora |

Las aplicaciones estáticas integradas en el bundle del backend (un `rebase cloud deploy`
simple en un proyecto con backend) forman parte de ese bundle, por lo que se
revierten junto con él.

Una aplicación estática desplegada por su cuenta (`rebase cloud deploy <app>`) aún no
se puede revertir. Su despliegue registra qué aplicación se publicó, pero no un bundle,
por lo que el plano de control no tiene nada a partir de lo cual restaurarla. La
solución es desplegar de nuevo la última versión correcta, por ejemplo desde el commit
anterior al defectuoso. Tras dicho despliegue, `deploy` indicará esto en lugar de
sugerir `rollback`, y un `rollback` sin un id se rechazará en lugar de redesplegar el
backend que está en servicio.

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos,
lo que significa un proyecto que se haya desplegado con éxito al menos dos veces.
`rebase cloud deployments` marca los que califican, y `--json` informa `rollbackable`
por cada fila junto con la `image` o el `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál es: uno que no tuvo éxito
y uno anterior a que la plataforma registrara su artefacto. No hay nada que suponer
en ninguno de los casos —suponer implicaría enviar lo que se haya compilado o subido
más recientemente mientras se afirma estar restaurando este despliegue—, así que
despliega la versión que deseas en su lugar.

Cada despliegue exitoso finaliza indicando el comando para revertir (`rebase cloud rollback`),
de modo que esté a la vista en el momento en que se detecte una versión defectuosa.

Un rollback añade un nuevo despliegue en lugar de retroceder en el historial, y espera
a que la versión restaurada esté en servicio antes de reportar éxito. Sigue su
progreso con `rebase cloud logs -f`.

## Restaurar la base de datos a un punto en el tiempo

Una base de datos administrada se puede recuperar a cualquier minuto dentro de su
ventana de recuperación, desde **Database → Backups** en la consola o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Se realiza en dos pasos. En primer lugar, se prepara una copia recuperada junto a la
base de datos activa; tu app continúa ejecutándose en la activa, y el almacenamiento
de la copia se factura hasta que realices el cutover o la descartes.
Luego, una vez que la copia está lista, realizar el cutover redirige la aplicación hacia
ella y la reinicia. Cualquier dato escrito después de la hora objetivo no estará en
la copia. La base de datos original se conserva como vía de retorno y continúa
facturando almacenamiento; volver a ella, eliminarla o realizar una segunda restauración
requiere contactar a soporte. Solo un propietario o administrador puede preparar,
realizar el cutover o descartar, y la consola solicita el nombre del proyecto antes
de ejecutar el cutover.

## Proteger tu cuenta

Tu cuenta de la consola puede acceder a bases de datos de producción, secretos y
facturación, así que protégela adecuadamente. Abre **Account security** desde el menú
situado bajo tu avatar en la consola (o ve a `/account`). La página te pertenece a ti,
no a una organización: lo que configures allí se aplica a todas las organizaciones a
las que pertenezcas.

- **Verificación en dos pasos.** Actívala con cualquier aplicación de autenticación
  (1Password, Google Authenticator, Authy). La página muestra una clave de configuración
  para agregar a la app, o un enlace que abre la app con la clave precargada en un
  teléfono, y luego solicita el código de 6 dígitos que muestra la aplicación. A partir
  de entonces, cada inicio de sesión solicitará un código, ya sea que inicies sesión
  con contraseña, Google o GitHub.
- **Códigos de recuperación.** Activarlo te proporciona diez códigos de un solo uso,
  que se muestran una única vez. Cada uno de ellos te permite iniciar sesión en lugar
  del código de autenticación si pierdes tu teléfono, así que guárdalos antes de cerrar
  el diálogo. **New recovery codes** los reemplaza, y los antiguos dejarán de funcionar.
  Desactivar la verificación en dos pasos y generar nuevos códigos requieren introducir
  un código primero.
- **Contraseña.** Cambiarla cierra la sesión en todos los demás dispositivos. Una
  cuenta creada con Google, GitHub o LinkedIn no tiene contraseña; la página ofrece
  enviarte un enlace por correo electrónico para configurar una.
- **Dispositivos con sesión iniciada.** Cada navegador y terminal con sesión iniciada
  en tu cuenta, con su dirección y el momento en que inició sesión. Cierra la sesión
  de cualquier dispositivo que no reconozcas, o de todos a la vez.

Los [tokens de acceso](/docs/deployment/cloud-agents/#ci-and-agents) no son sesiones
y no solicitan un segundo factor, por lo que CI continuará desplegando después de que
lo actives. Revoca cualquier token en el que ya no confíes en **Settings → Access tokens**.

## Invitar a tu equipo

**Members → Invite member** proporciona un enlace para copiar (enviado por correo
electrónico si este plano de control envía correos) que funciona una vez, durante
7 días, para una cuenta que haya verificado esa dirección; nadie se unirá hasta que
acepte. Invita a un administrador o miembro, y conviértelo en propietario una vez
que se haya unido. Los propietarios y administradores pueden verlo, reenviarlo o
revocarlo en **Pending invitations**; desde una terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Ver quién hizo qué

La página **Activity** de la consola y `rebase cloud activity` muestran a los
propietarios y administradores de la organización quién desplegó, definió o reveló
una variable de entorno (por nombre, nunca por valor), cambió un dominio, restauró
una copia de seguridad, cambió el tamaño, detuvo o eliminó un proyecto, cambió el rol
de un miembro o creó un token, y cuándo. La sección **Settings** de un proyecto enlaza
a sus propias entradas; las entradas relativas a un proyecto eliminado se conservan.
Un script puede leerlo con un token creado con `--can audit` en la organización.
Las entradas se conservan durante un año. Los filtros se encuentran en
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI y agentes

Un trabajo de CI o un agente no debería contener tu contraseña. Proporciónale un token
limitado a unas pocas acciones en un proyecto específico, creado desde una terminal
con sesión iniciada con `rebase cloud tokens create --project shop --can deploy,logs`,
y establécelo como `REBASE_TOKEN`. La facturación, el registro de actividad y la
configuración de notificaciones de una organización son capacidades independientes
(`--can billing`, `audit`, `notifications`) que un token solo posee cuando se solicitan
explícitamente. Las capacidades, un flujo de trabajo de GitHub Actions y lo que
permanece reservado a una persona con sesión iniciada se detallan en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sin cuenta

`rebase cloud init --claim` proporciona a una aplicación un backend activo antes de
que nadie se haya registrado, e imprime una URL de reclamación para que la persona lo
conserve; un proyecto que nadie reclame en 72 horas se elimina. Lo que puede hacer el
token del proyecto no reclamado, el `REBASE_API_TOKEN` que escribe y lo que cambia al
reclamarlo se explican en [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Cómputo y cuánto cuesta

El precio de un proyecto se calcula a partir de lo que reserva, no de un plan o nivel
fijo. `compute` imprime cada parámetro de configuración y el desglose presupuestario
del propio plano de control para ellos. (`rebase cloud resources` es algo diferente:
las bases de datos y buckets que declara el código, y si cada uno está aprovisionado;
consulta la [referencia de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, p. ej. `500m` y `2Gi`. Vacío significa el valor predeterminado de la plataforma: `100m` y `384Mi`, con picos de hasta 2 CPU y `2Gi` |
| `--replicas` | Instancias que siempre existen: el mínimo del autoescalador y lo que factura mensualmente la suscripción del proyecto |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar. Las instancias que el autoescalador agrega por encima de `--replicas` se miden por segundo-pod a las mismas tarifas, y se cobran solo donde la plataforma haya activado esa opción; **Usage this month** indica si aplica. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoescalador, respecto al request en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (preemptible): más económica y reiniciada sin previo aviso |
| `--db-instances` | 1–3. `1` es una sola instancia sin conmutación por error (failover); `2` agrega un nodo en espera (standby) automático |
| `--db-cpu`, `--db-memory` | Por instancia de base de datos. Vacío significa `160m` y `1Gi` |

Un parámetro vacío no equivale a fijarlo al mismo número: un parámetro vacío sigue el
valor predeterminado de la plataforma y varía cuando este cambia.

La CLI no valida nada deliberadamente: los límites pertenecen al clúster en el que se
ejecuta el proyecto y difieren entre proveedores. El plano de control rechaza cualquier
valor que no pueda cumplir e indica el campo correspondiente. Ejecuta `rebase cloud compute`
para ver el coste en €/mes antes y después; un cambio se aplica inmediatamente,
prorrateado a partir de hoy, excepto aquel que reinicie la base de datos, el cual
esperará a una ventana de mantenimiento.

## El resto de la superficie de comandos

| Grupo de comandos | Qué cubre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Tu sesión; `access-token` imprime el token de portador (bearer) que la CLI enviaría ahora, para scripts y el servidor MCP |
| `tokens` | Tokens para CI y agentes, cada uno limitado a un proyecto. Consulta [CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `connect` | Añadir un servidor Rebase autoalojado a tu cuenta, para que el [conector de Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) en Claude llegue a él junto a tus proyectos de Cloud. `--list` las muestra, `--remove` quita una. Propietarios y administradores |
| `init`, `claim` | Con `--claim`: un backend activo sin cuenta y un enlace para reclamarlo; `claim` vuelve a imprimir ese enlace. Consulta [Un backend sin cuenta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicación y monitoreo |
| `previews` | Compilaciones servidas en su propia dirección mediante `deploy --preview`, y su eliminación. Consulta [Previsualizar un cambio](#previsualizar-un-cambio) |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo. Un proyecto detenido mantiene su suscripción, a menos que la plataforma facture a los proyectos detenidos solo por el almacenamiento y la tarifa de plataforma; la fila **Billing** de la consola lo indica cuando corresponde |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `cron` | Las tareas programadas (cron jobs) de la app desplegada y sus ejecuciones registradas, consultadas con tu inicio de sesión de `rebase cloud`. Solo lectura |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `app-key` | La clave que `init --claim` escribió en `.env` como `REBASE_API_TOKEN`, transferida al reclamar; `rotate` la reemplaza y revoca la anterior. Propietarios y administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin en la propia API de la app: cuándo se rotó por última vez; `rotate` asigna una nueva a la app. Propietarios y administradores |
| `domains` | Dominios personalizados, registros DNS que se deben añadir y verificación. Un proyecto puede responder en varios, cada uno verificado por separado; `verify` y `remove` toman el dominio sobre el que actuar, el cual solo se puede omitir cuando hay uno solo (para `verify`, uno aún pendiente). `list --json` devuelve `{ projectId, tenantHost, domains: [...] }` |
| `db` | Adjuntar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo (point-in-time recovery) |
| `guests` | Los usuarios invitados que dejó el inicio de sesión anónimo: contarlos, eliminar uno, purgar los que no se han visto desde hace tiempo. Consulta [Guests](/docs/cli/cloud/#guests). Propietarios y administradores |
| `extensions` | La lista de permisos (allowlist) de extensiones de Postgres |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo modificarlo |
| `events` | Lo que le ha pasado al backend, lo más reciente primero: la app escalando, cambios de base de datos programados y aplicados, un standby que toma el relevo, el disco que crece |
| `usage` | Peticiones utilizadas este mes frente a la cuota incluida y el exceso acumulado, según lo computa la factura. `usage org` lista todos los proyectos de la organización |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Solo administradores de la plataforma |
| `settings`, `orgs`, `billing` | Configuración del proyecto, organizaciones y sus miembros e invitaciones, pagos |
| `activity` | El registro de auditoría de la organización: quién desplegó, modificó una variable de entorno (por nombre), un dominio, una copia de seguridad, un miembro o un token. Propietarios y administradores. Consulta [Ver quién hizo qué](#ver-quién-hizo-qué) |
| `notifications`, `webhooks` | Dónde se envían por POST los eventos del proyecto: Slack, Discord o cualquier URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` está en desuso (retired) y sale con código 1 y `command_retired` |

Cada grupo en esa tabla responde a `--help` con su propia página —una línea de uso,
sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Una prueba verifica el
índice de las páginas, por lo que un grupo añadido sin una falla la compilación en
lugar de responder con la tabla de contenidos. `verify:docs` somete la propia tabla
a ese índice: cada grupo despachado por la CLI aparece aquí exactamente una vez, por
lo que un grupo añadido sin su fila también hace fallar la compilación.

Cuando se pasa por una tubería (pipe), `--help` responde en JSON en su lugar: la
misma línea de uso, flags y ejemplos estructurados para su lectura, en lugar de
sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Explicado con claridad, porque enterarse más tarde es peor:

- **Sin selección de región.** Todo se ejecuta en una sola región hoy en día. El
  modelo de ubicación existe en la plataforma, pero un proyecto no puede elegir región.
  `projects create --provider` y `--region` no son la excepción que aparentan:
  registran a cuál de los destinos de despliegue registrados en el plano de control
  pertenece un proyecto, y como solo hay uno, ambos toman ese valor por defecto y
  ninguno traslada el proyecto a otra parte. `rebase cloud projects create --help`
  indica lo mismo.
- **No es autoservicio.** El acceso se concede por lotes; no existe un flujo de
  registro y pago directo.
- **Sin SLA publicado**, y sin certificación SOC 2. Si necesitas cualquiera de los
  dos, indícalo al solicitar acceso en lugar de darlo por sentado.
- **Sin despliegues por rama**, y sin GitHub App oficial de primera parte. Los deploy
  hooks —URLs secretas a las que apuntas un webhook de repositorio— son la
  automatización admitida. Los [despliegues de vista previa](#previsualizar-un-cambio) se están
  implementando gradualmente y se inician desde la CLI.
- **Los tokens actúan como una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents)
  es generado por una cuenta y actúa en su nombre; aún no existe una identidad de
  máquina propiedad de la organización. Si inicias sesión desde CI en su lugar, pasa
  `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD` desde un gestor de secretos;
  `--password` incluye la contraseña en el historial de tu shell y en la tabla de
  procesos, y así te lo advierte antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio nombra un plano de control distinto al oficial
  de la plataforma, pásalo también como `--url`: sin una terminal, `login` rechazará
  enviar una contraseña a un host especificado únicamente por el archivo descargado.
- **Sin endpoint público de base de datos.** Una base de datos administrada no está
  expuesta a internet, por lo que el host que muestra la consola es la dirección que
  usa tu backend para ella y no se resolverá a nada en tu máquina local.
  `rebase cloud db connect` abre un puerto local que conecta con esa base de datos
  a través de un túnel por el plano de control mientras lo mantengas en ejecución,
  pero no existe un hostname permanente al que pueda conectarse un servicio de
  terceros. Tanto ese túnel como la contraseña detrás de `rebase cloud db info --reveal`
  requieren el rol de propietario o administrador de la organización: el mismo que
  solicita el editor SQL de Studio, ya que los tres desembocan en una sesión sobre
  tus datos de producción.
- **Desplegar es ejecutar código con los secretos de producción.** El entorno de la
  aplicación contiene `REBASE_SERVICE_KEY` (admin en su propia API), `DATABASE_URL`
  y `JWT_SECRET`, por lo que el código que despliegue un miembro puede leerlos,
  aunque solo los propietarios y administradores puedan revelarlos en la consola.
  Invita como miembro únicamente a personas en las que confiarías esos valores.
- **La clave de servicio se puede reemplazar.** La sección **Settings** del proyecto
  (o `rebase cloud service-key rotate`) genera una nueva `REBASE_SERVICE_KEY` y
  reinicia la aplicación con ella. La clave antigua funciona hasta que el reinicio
  haya finalizado y deja de servir a partir de entonces, por lo que cualquier servicio
  que la haya copiado será rechazado desde ese momento. Reclamar un proyecto hace lo mismo.

## Alojamiento propio como alternativa

Nada de lo aquí descrito implica un bloqueo de proveedor (vendor lock-in). La
[guía de autoalojamiento (self-hosting)](/docs/deployment/self-hosting/) ejecuta la
misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) reproduce la misma topología a
partir del chart de Helm.
