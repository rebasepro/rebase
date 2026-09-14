---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, gestionado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye todavía la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que autoalojarías: la misma
imagen publicada de `rebasepro/server`, el mismo bundle, el mismo Postgres. La
diferencia es quién lo gestiona.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Ya ejecuta inquilinos reales y abre el acceso
por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos siguientes requieren una cuenta que haya sido admitida.
Todo lo demás en este sitio funciona sin ella.
:::

## Qué es

Un **proyecto** de Cloud se compone de tres cosas que la plataforma gestiona para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no la compilación de un contenedor |
| **Database** | Un PostgreSQL administrado, con copias de seguridad automatizadas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Storage** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada elemento se aprovisiona cuando realizas el primer despliegue, y cada uno se factura
en función de lo que reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se
autoaloja con `docker compose`, y la vía de escape es real: `rebase build`
genera un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` no admite argumentos posicionales. El nombre y el subdominio son
flags, y ambos son obligatorios; en una terminal se solicitarán de forma interactiva, y
una ejecución headless que omita cualquiera de los dos saldrá con `input_required` en lugar de inventar
uno. **El subdominio no se puede editar posteriormente:** es el host
`<slug>.rebase.website` en el que responderá el proyecto, así que elígelo a conciencia.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay
un paso `link` independiente. Escribe `.rebase/cloud.json`, que registra el id y el
slug del proyecto. Ese archivo no es un secreto ni contiene tus credenciales; estas
residen en `~/.rebase/credentials.json`, generado por `login`.

`billing setup` asocia una tarjeta a la organización, una sola vez. Está al principio
de la secuencia a propósito: el primer despliegue de un proyecto se rechazará sin ella,
y descubrirlo después de haber terminado de subir el bundle es el peor escenario.

Un proyecto existente se vincula sin necesidad de crearlo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando y ningún flag que recordar. El `rebase.json` de un scaffold declara
`runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo indica
sobre la marcha (`rebase.json declares runtime: managed — deploying a
bundle`)—, compila la aplicación en `dist-bundle`, sube el bundle, lo ejecuta en la
imagen de runtime publicada y sigue el despliegue hasta un estado final. El código de
salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Para enviar un artefacto compilado previamente —por ejemplo, un trabajo de CI que
compila una vez y despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime administrado tiene su propio flag, `--eject`, y nada más lo
solicita: una compilación que trasladaría un proyecto administrado a una imagen de
contenedor que pasa a controlar se rechaza hasta que tú lo indiques. Antes, `--force`
significaba esto, lo cual colocaba la acción menos reversible que puede realizar la CLI
bajo la misma palabra que «sobrescribir este archivo»; ahora es una opción desconocida
en lugar de un alias, por lo que cualquier script que la incluya se detendrá en su lugar.

Monitorízalo:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la
plataforma está trabajando realmente y hacer sondeo (polling) es lo correcto; cuando
nombra algo, ese algo te está esperando a ti.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso
anterior y nunca recompila; el valor de un rollback reside en que envía un
artefacto que ya se ha ejecutado previamente.

Los despliegues que califican dependen de cómo se despliega el proyecto, y ambos
tipos funcionan:

| Cómo se desplegó | Lo que se restaura |
|---|---|
| `rebase cloud deploy` (compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto esté ejecutando en ese momento |

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo
que implica un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments`
marca los que califican, y `--json` reporta `rollbackable` por fila junto con la
`image` o `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuáles: uno que no tuvo éxito
y uno anterior a que la plataforma registrara su artefacto. No hay nada que suponer
en ningún caso —hacer suposiciones enviaría lo que se haya compilado o subido más
recientemente mientras se afirma que se restaura este—, así que en su lugar despliega
la versión que deseas.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera
a que la versión restaurada esté lista para responder antes de reportar éxito.
Puedes seguirlo con `rebase cloud logs -f`.

## Cómputo y sus costes

El precio de un proyecto se calcula a partir de lo que reserva, no de un nivel o plan (tier).
`compute` muestra cada parámetro de ajuste y la cotización detallada del propio plano de
control para ellos. (`rebase cloud resources` es algo diferente: las bases de datos y
los buckets que el código declara, y si cada uno está aprovisionado; consulta la
[referencia de la CLI](/docs/cli/#rebase-cloud)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, p. ej. `500m` y `2Gi`. Vacío significa el valor por defecto de la plataforma: `250m` y `512Mi` |
| `--replicas` | Instancias que siempre existen: el mínimo del escalador automático (autoscaler) y lo que se le factura al proyecto en reposo |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar y el peor caso que se le puede facturar. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoscaler, frente a la solicitud (request) en lugar de frente al límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (preemptible): más barata y reiniciada sin previo aviso |
| `--scale-to-zero` | `true` o `false`. Cómputo facturado por petición que se detiene cuando está inactivo, a costa de un arranque en frío (cold start) |
| `--db-instances` | 1–3. `1` es una sola instancia sin conmutación por error (failover); `2` añade una réplica de respaldo automática (standby) |
| `--db-cpu`, `--db-memory`, `--storage` | Por instancia de base de datos. Vacío significa `500m`, `2Gi` y el volumen por defecto |

Un parámetro vacío no es lo mismo que uno fijado al mismo número: un parámetro
vacío sigue el valor por defecto de la plataforma y cambia cuando este cambia.

La CLI no valida nada, a propósito: los límites pertenecen al clúster en el que
se ejecuta un proyecto y difieren según el proveedor. El plano de control rechaza
cualquier valor que no pueda satisfacer e indica el campo. Ejecuta `rebase cloud compute`
para ver los €/mes antes y después; un cambio se aplica de inmediato, prorrateado desde
hoy, excepto uno que reinicie la base de datos, el cual esperará a una ventana de mantenimiento.

## El resto de la superficie

| Grupo de comandos | Lo que cubre |
|---|---|
| `login`, `logout`, `whoami` | Tu sesión |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Desplegar y monitorizar |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo hace |
| `env` | Variables de entorno. `list` nunca imprime valores; `--secret` es de solo escritura |
| `domains` | Dominios personalizados, los registros DNS que añadir y verificación |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo (point-in-time recovery) |
| `extensions` | Lista de extensiones de Postgres permitidas |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Lo que reserva este proyecto, lo que cuesta y cómo cambiarlo |
| `clusters` | Los clústeres en los que se ejecutan los inquilinos. Solo para administradores de la plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configuración del proyecto, organizaciones, webhooks de despliegue, facturación |

Cada grupo de esa tabla responde a `--help` con una página propia —una línea de uso,
sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Una prueba comprueba
el índice de las páginas, por lo que un grupo añadido sin ella hace que la compilación
falle en lugar de responder con la tabla de contenidos. `verify:docs` vincula la propia
tabla a ese índice: cada grupo gestionado por la CLI aparece aquí exactamente una vez,
por lo que un grupo añadido sin su fila correspondiente también hará que la compilación falle.

Si se canaliza mediante tubería (pipe), `--help` responde en JSON en su lugar: la
misma línea de uso, flags y ejemplos como una estructura fácil de leer en vez de
sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Dicho claramente, porque descubrirlo más tarde es peor:

- **Sin elección de región.** Actualmente todo se ejecuta en una sola región. El
  modelo de ubicación existe en la plataforma, pero un proyecto no puede elegir
  región. `projects create --provider` y `--region` no son la excepción que
  parecen ser: registran a cuál de los destinos de despliegue registrados en el plano
  de control pertenece un proyecto, y solo hay uno, por lo que ambos toman ese
  valor por defecto y ninguno mueve un proyecto a otro lugar. `rebase cloud projects create --help`
  indica lo mismo.
- **No es de autoservicio.** El acceso se otorga por lotes; no existe un sistema de registro directo y pago.
- **Sin SLA publicado** ni SOC 2. Si necesitas alguno de los dos, indícalo al solicitar
  acceso en lugar de darlo por sentado.
- **Sin despliegues de vista previa (preview) o por rama**, y sin GitHub App oficial de primera mano. Los
  webhooks de despliegue (deploy hooks) —URLs secretas a las que apuntas un webhook
  del repositorio— son la automatización admitida.
- **CI necesita las credenciales de un humano.** Todavía no existen tokens de máquina;
  `rebase cloud login` solicita un correo electrónico y una contraseña. Pásalos como
  `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD` desde un gestor de secretos;
  `--password` incluye la contraseña en el historial de tu shell y en la tabla de procesos,
  y te lo advertirá antes de iniciar sesión.
- **La recuperación a un punto en el tiempo (PITR) es solo por CLI.** La consola muestra las
  copias de seguridad; el flujo de trabajo de PITR por etapas es `rebase cloud db pitr`.
- **Sin endpoint público de base de datos.** Una base de datos administrada no está expuesta a
  internet, por lo que el host que muestra la consola es la dirección que utiliza tu backend
  para acceder a ella y no resuelve a nada en tu máquina. `rebase cloud db connect` abre un
  puerto local hacia esa base de datos, tunelizado a través del plano de control, mientras
  lo mantengas en ejecución; sin embargo, no existe un nombre de host permanente al que pueda
  conectarse un servicio de terceros. Tanto ese túnel como la contraseña detrás de
  `rebase cloud db info --reveal` requieren el rol de propietario o administrador de la
  organización: el mismo que solicita el editor SQL de Studio, ya que los tres desembocan
  en una sesión sobre tus datos de producción.

## Autoalojamiento en su lugar

Nada de esto supone un bloqueo de proveedor (lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/)
ejecuta la misma imagen y bundle con `docker compose`, y la
[guía de Kubernetes](/docs/deployment/kubernetes/) representa la misma topología a partir
del Helm chart.

---
