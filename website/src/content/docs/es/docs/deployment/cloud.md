---
sourceHash: 535999d55c2b1a7c
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye todavía la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la misma imagen publicada de `rebasepro/server`, el mismo bundle, el mismo Postgres. La diferencia es quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Actualmente opera tenants reales y se abre por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es de autoservicio, por lo que los comandos a continuación requieren una cuenta a la que se le haya concedido acceso. Todo lo demás en este sitio funciona sin ella.
:::

## Qué es

Un **proyecto** en Cloud son tres cosas que la plataforma opera para ti:

| | Lo que obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Base de datos** | Un PostgreSQL gestionado, con copias de seguridad automáticas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Almacenamiento** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando realizas el primer despliegue, y cada uno se factura por lo que reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se autogestiona con `docker compose`, y la vía de escape es real: `rebase build` genera un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` no admite argumentos posicionales. El nombre y el subdominio son flags, y ambos son obligatorios; en una terminal se solicitarán interactivamente, y una ejecución en modo headless que omita cualquiera de ellos saldrá con `input_required` en lugar de inventar uno. **El subdominio no se puede editar después:** es el host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo con cuidado.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un paso de `link` separado. Escribe `.rebase/cloud.json`, que registra el id y el slug del proyecto. Ese archivo no es un secreto ni son tus credenciales; esas residen en `~/.rebase/credentials.json`, creadas por `login`.

`billing setup` vincula una tarjeta a la organización, una sola vez. Está primero en la secuencia a propósito: el primer despliegue de un proyecto se rechazará si no hay una tarjeta asociada, y descubrirlo después de que un bundle haya terminado de subirse es el peor orden posible.

Un proyecto existente se vincula sin necesidad de crearlo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando, y ningún flag que recordar. El `rebase.json` de un scaffold declara `runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo indica sobre la marcha (`rebase.json declares runtime: managed — deploying a bundle`)—, compila la aplicación en `dist-bundle`, sube el bundle, lo ejecuta en la imagen de runtime publicada y sigue el despliegue hasta un estado terminal. El código de salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Para enviar un artefacto compilado previamente —por ejemplo, un trabajo de CI que compila una vez y despliega dos veces—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abandonar el runtime gestionado tiene su propio flag, `--eject`, y nada más lo solicita: una compilación que trasladaría un proyecto gestionado a una imagen de contenedor de la que luego se hace responsable es rechazada hasta que lo indiques explícitamente. Anteriormente, `--force` significaba esto, lo cual ponía la acción menos reversible de la CLI bajo la misma palabra que "sobrescribir este archivo"; ahora es una opción desconocida en lugar de un alias, por lo que cualquier script que la contenga se detendrá.

Monitoréalo:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` reporta `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la plataforma está trabajando realmente y hacer sondeo (polling) es lo correcto; cuando nombra algo, ese algo está esperando por ti.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que envió un despliegue exitoso anterior, y nunca recompila; el valor de un rollback es que envía un artefacto que ya se ha ejecutado.

Qué despliegues califican depende de cómo se despliega el proyecto, y ambos tipos funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que envió ese despliegue, en la versión de runtime que el proyecto está ejecutando ahora |

Por lo tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que significa un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments` marca los que califican, y `--json` reporta `rollbackable` por fila junto con la `image` o el `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuáles: uno que no tuvo éxito y uno previo a que la plataforma registrara su artefacto. No hay nada que suponer en ningún caso —suponer enviaría lo que se haya compilado o subido más recientemente mientras se afirma restaurar este—, así que en su lugar despliega la versión que deseas.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que la versión restaurada esté sirviendo tráfico antes de reportar éxito. Síguelo con `rebase cloud logs -f`.

## Cómputo y lo que cuesta

El precio de un proyecto se calcula en función de lo que reserva, no de un plan o nivel (tier). `compute` muestra cada parámetro de ajuste y la cotización detallada del propio plano de control para ellos. (`rebase cloud resources` es algo diferente: las bases de datos y buckets que declara el código, y si cada uno está aprovisionado; consulta la [referencia de la CLI](/docs/cli/#rebase-cloud)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la app por instancia, ej. `500m` y `2Gi`. Vacío significa el valor predeterminado de la plataforma: `250m` y `512Mi` |
| `--replicas` | Instancias que siempre existen: el límite inferior del autoescalador y lo que se factura por el proyecto en reposo |
| `--autoscale-max` | 1–16. El techo que puede alcanzar y el peor caso que se puede facturar. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoescalador, respecto a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (spot): más económica y reiniciada sin previo aviso |
| `--scale-to-zero` | `true` o `false`. Cómputo facturado por petición que se detiene cuando está inactivo, a costa de un arranque en frío (cold start) |
| `--db-mode` | `shared` (el clúster compartido) o `dedicated` (uno propio de este proyecto) |
| `--db-instances` | 1–3. `1` es una única instancia sin tolerancia a fallos (failover); `2` añade una réplica de reserva (standby) automática |
| `--db-cpu`, `--db-memory`, `--storage` | Por instancia de base de datos. Vacío significa `500m`, `2Gi` y el volumen por defecto |

Un parámetro vacío no es lo mismo que uno fijado al mismo número: un parámetro vacío sigue el valor predeterminado de la plataforma y cambia cuando este cambia.

Nada es validado por la CLI, a propósito: los límites pertenecen al clúster en el que se ejecuta un proyecto y varían según el proveedor. El plano de control rechaza cualquier valor que no pueda cumplir e indica el campo. Ejecuta `rebase cloud compute` para ver los €/mes antes y después; cualquier cambio se aplica de inmediato, prorrateado desde hoy, excepto aquel que reinicie la base de datos, el cual esperará una ventana de mantenimiento.

## El resto de la superficie

| Grupo de comandos | Lo que cubre |
|---|---|
| `login`, `logout`, `whoami` | Tu sesión |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Desplegar y monitorizar |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo hace |
| `env` | Variables de entorno. `list` nunca imprime los valores; `--secret` es de solo escritura |
| `domains` | Dominios personalizados, los registros DNS a añadir y verificación |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo (PITR) |
| `extensions` | La lista de extensiones permitidas (allowlist) de Postgres |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, frente a lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo cambiarlo |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Solo para administradores de la plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configuración del proyecto, organizaciones, deploy hooks, facturación y pagos |

Cada grupo en esa tabla responde a `--help` con una página propia —una línea de uso, sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Un test valida el índice de las páginas, por lo que un grupo añadido sin una de ellas falla la compilación en lugar de responder con la tabla de contenidos. `verify:docs` vincula la propia tabla a ese índice: cada grupo que despacha la CLI aparece aquí exactamente una vez, por lo que un grupo añadido sin una fila también hace fallar la compilación.

Canalizado (piped), `--help` responde en JSON en su lugar: la misma línea de uso, flags y ejemplos como una estructura para leer en lugar de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Dicho claramente, porque enterarse después es peor:

- **Sin elección de región.** Actualmente todo se ejecuta en una sola región. El modelo de ubicación existe en la plataforma, pero un proyecto no puede elegir una región. `projects create --provider` y `--region` no son la excepción que parecen ser: registran a cuál de los destinos de despliegue registrados del plano de control pertenece un proyecto, y solo hay uno, por lo que ambos toman ese valor por defecto y ninguno mueve un proyecto a otro lugar. `rebase cloud projects create --help` dice lo mismo.
- **No es de autoservicio.** El acceso se otorga por lotes; no existe un flujo de registro y pago automático.
- **Sin SLA publicado** y sin SOC 2. Si necesitas alguno de los dos, indícalo al solicitar acceso en lugar de asumirlo.
- **Sin despliegues de vista previa (preview) o por rama**, y sin GitHub App oficial. Los deploy hooks —URLs secretas a las que apuntas un webhook del repositorio— son la automatización admitida.
- **CI necesita credenciales humanas.** Todavía no hay tokens de máquina; `rebase cloud login` solicita un correo electrónico y una contraseña. Pásalos como `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD` desde un gestor de secretos; `--password` coloca la contraseña en el historial de tu shell y en la tabla de procesos, y te lo advierte antes de iniciar sesión.
- **La recuperación a un punto en el tiempo (PITR) es solo por CLI.** La consola muestra las copias de seguridad; el flujo de trabajo de PITR por etapas es `rebase cloud db pitr`.
- **Sin endpoint público de base de datos.** Una base de datos gestionada no está expuesta a internet, por lo que el host que muestra la consola es la dirección para tu backend y no resuelve a nada en tu máquina local. `rebase cloud db connect` abre un puerto local conectado a esa base de datos, canalizado a través del plano de control, mientras lo mantengas en ejecución; pero no hay un nombre de host permanente al que pueda conectarse un servicio de terceros.

## Autoalojamiento como alternativa

Nada de esto implica dependencia de un proveedor (vendor lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/) ejecuta la misma imagen y bundle con `docker compose`, y la [guía de Kubernetes](/docs/deployment/kubernetes/) genera la misma topología a partir del chart de Helm.

---
