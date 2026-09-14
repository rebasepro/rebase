---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud es el mismo Rebase, operado para ti. Qué es, cómo se vincula y despliega un proyecto, y qué no incluye todavía la beta privada.
---

Rebase Cloud ejecuta el mismo Rebase de código abierto que alojarías tú mismo: la misma imagen publicada `rebasepro/server`, el mismo bundle, el mismo Postgres. La diferencia es quién lo opera.

:::note[Beta privada]
Rebase Cloud está en **beta privada**. Actualmente ejecuta tenants reales y abre el acceso por lotes. [Solicitar acceso](https://rebase.pro/pricing).

No es autoservicio, por lo que los siguientes comandos requieren una cuenta a la que se le haya concedido acceso. Todo lo demás en este sitio funciona sin ella.
:::

## Qué es

Un **proyecto** de Cloud son tres cosas que la plataforma opera para ti:

| | Qué obtienes |
|---|---|
| **App** | Tu bundle, ejecutándose en la imagen de runtime publicada. Los despliegues son una subida de bundle, no una compilación de contenedor |
| **Base de datos** | Un PostgreSQL administrado, con copias de seguridad automáticas y recuperación a un punto en el tiempo (point-in-time recovery) |
| **Almacenamiento** | Un bucket propio, si tu proyecto utiliza almacenamiento de archivos |

Cada uno se aprovisiona cuando despliegas por primera vez, y se factura por lo que reserva en lugar de por usuario.

**Nada en tu proyecto cambia para ejecutarse allí.** El mismo repositorio se autoaloja con `docker compose`, y la vía de escape es real: `rebase build` genera un bundle que arranca en cualquier lugar donde se ejecute la imagen de runtime.

## Vincular un proyecto

Desde el directorio de un proyecto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` no admite argumentos posicionales. El nombre y el subdominio son flags, y ambos son obligatorios; en una terminal se solicitan interactivamente, y una ejecución headless que omita cualquiera de ellos finaliza con `input_required` en lugar de inventar uno. **El subdominio no se puede editar después:** es el host `<slug>.rebase.website` en el que responde el proyecto, así que elígelo con cuidado.

`--link` vincula este directorio al proyecto en la misma llamada, por lo que no hay un paso `link` separado. Escribe `.rebase/cloud.json`, que registra el project id y el slug. Ese archivo no es un secreto ni contiene tus credenciales; estas residen en `~/.rebase/credentials.json`, creado por `login`.

`billing setup` asocia una tarjeta a la organización, una sola vez. Va primero en la secuencia a propósito: el primer despliegue de un proyecto se rechaza si no hay una, y descubrirlo después de que el bundle haya terminado de subirse es el peor orden posible.

Un proyecto existente se vincula sin necesidad de crearlo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Desplegar

```bash
rebase cloud deploy
```

Un solo comando y ningún flag que recordar. El archivo `rebase.json` de un scaffold declara `runtime: "managed"` para su backend, y `deploy` lee esa declaración —lo indica durante el proceso (`rebase.json declares runtime: managed — deploying a bundle`)—, compila la aplicación en `dist-bundle`, sube el bundle, lo ejecuta en la imagen de runtime publicada y sigue el despliegue hasta un estado final. El código de salida es el veredicto, por lo que la misma línea funciona de forma desatendida en CI.

Para desplegar un artefacto que se compiló previamente —por ejemplo, un trabajo de CI que compila una vez y despliega dos—, apunta al directorio en lugar de volver a compilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Salir del runtime administrado tiene su propio flag, `--eject`, y nada más lo solicita: una compilación que movería un proyecto administrado a una imagen de contenedor que luego pasa a ser de su propiedad se rechaza a menos que lo indiques explícitamente. Antes se usaba `--force` para esto, lo que ponía la acción menos reversible que la CLI puede realizar bajo la misma palabra que «sobrescribir este archivo»; ahora es una opción desconocida en lugar de un alias, por lo que un script que la incluya se detendrá.

Síguelo:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` informa de `blockedOn` y `nextAction`. Cuando `blockedOn` es `null`, la plataforma está trabajando realmente y hacer sondeo (polling) es lo correcto; cuando indica algo, ese algo te está esperando a ti.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback vuelve a apuntar el proyecto a lo que desplegó un despliegue anterior exitoso y nunca recompila; el valor de un rollback reside en que despliega un artefacto que ya se ha ejecutado.

Los despliegues que califican dependen de cómo se despliegue el proyecto, y ambos tipos funcionan:

| Cómo se desplegó | Qué se restaura |
|---|---|
| `rebase cloud deploy` (una compilación desde el código fuente) | La imagen que publicó esa compilación |
| `rebase cloud deploy --bundle` (el runtime de la plataforma) | El bundle que desplegó ese despliegue, en la versión de runtime que el proyecto ejecuta actualmente |

Por tanto, un rollback necesita un despliegue que haya registrado uno de los dos, lo que significa un proyecto que se haya desplegado con éxito al menos dos veces. `rebase cloud deployments` marca los que califican, y `--json` informa de `rollbackable` por fila junto con la `image` o `bundle` que restauraría.

Se rechazan dos tipos de despliegues, y la CLI indica cuál es: uno que no tuvo éxito y uno anterior a que la plataforma registrara su artefacto. En ningún caso se hacen suposiciones —adivinar enviaría lo que se haya compilado o subido más recientemente mientras se afirma restaurar este—, por lo que, en su lugar, despliega la versión que deseas.

Un rollback añade un nuevo despliegue en lugar de rebobinar el historial, y espera a que la versión restaurada empiece a responder antes de reportar éxito. Puedes seguirlo con `rebase cloud logs -f`.

## Cómputo y cuánto cuesta

El precio de un proyecto se calcula en función de lo que reserva, no de un plan o nivel (tier). `compute` muestra cada parámetro de configuración y el presupuesto desglosado del propio plano de control para ellos. (`rebase cloud resources` es algo diferente: las bases de datos y buckets que el código declara, y si cada uno está aprovisionado; consulta la [referencia de la CLI](/docs/cli/#rebase-cloud)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parámetro | Unidad y qué significa |
|---|---|
| `--cpu`, `--memory` | Solicitud (request) de la aplicación por instancia, p. ej., `500m` y `2Gi`. Vacío significa el valor por defecto de la plataforma: `250m` y `512Mi` |
| `--replicas` | Instancias que existen siempre: el mínimo del escalador automático (autoscaler) y por lo que se factura el proyecto en reposo |
| `--autoscale-max` | 1–16. El límite máximo que puede alcanzar y el peor caso por el que se puede facturar. `--no-autoscale` lo desactiva |
| `--autoscale-cpu-target` | 10–95. La utilización de CPU que mantiene el autoscaler, respecto a la solicitud (request) en lugar del límite. Vacío significa 70 |
| `--spot` | `true` o `false`. Capacidad interrumpible (preemptible): más económica y reiniciada sin previo aviso |
| `--scale-to-zero` | `true` o `false`. Cómputo facturado por petición que se detiene cuando está inactivo, a costa de un arranque en frío (cold start) |
| `--db-instances` | 1–3. `1` es una única instancia sin conmutación por error (failover); `2` añade una réplica en espera automática (standby) |
| `--db-cpu`, `--db-memory`, `--storage` | Por instancia de base de datos. Vacío significa `500m`, `2Gi` y el volumen predeterminado |

Un parámetro vacío no es lo mismo que uno fijado al mismo número: un parámetro vacío sigue el valor predeterminado de la plataforma y cambia cuando este cambia.

La CLI no valida nada intencionadamente: los límites pertenecen al clúster en el que se ejecuta el proyecto y varían según el proveedor. El plano de control rechaza cualquier valor que no pueda satisfacer e indica el campo. Ejecuta `rebase cloud compute` para ver el coste en €/mes antes y después; cualquier cambio se aplica de inmediato, prorrateado desde hoy, excepto aquel que reinicie la base de datos, que esperará a una ventana de mantenimiento.

## El resto de la superficie

| Grupo de comandos | Qué cubre |
|---|---|
| `login`, `logout`, `whoami` | Tu sesión |
| `link`, `unlink`, `use`, `open` | Vincular este directorio a un proyecto, seleccionar una organización, abrir la consola |
| `projects` | Crear, listar, inspeccionar, eliminar |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Despliegue y monitorización |
| `start`, `stop`, `restart` | Pausar un proyecto y reanudarlo |
| `status`, `metrics`, `debug` | Qué está haciendo y por qué no lo está haciendo |
| `env` | Variables de entorno. `list` nunca muestra valores; `--secret` es de solo escritura |
| `domains` | Dominios personalizados, registros DNS a añadir y verificación |
| `db` | Asociar o crear una base de datos, conectarse a ella desde tu máquina, copias de seguridad, restauración y recuperación a un punto en el tiempo (point-in-time recovery) |
| `extensions` | La lista de extensiones permitidas (allowlist) de Postgres |
| `storage` | El bucket del proyecto |
| `resources` | Qué bases de datos y buckets mantiene la plataforma, en contraste con lo que declara el código |
| `compute` | Qué reserva este proyecto, cuánto cuesta y cómo cambiarlo |
| `clusters` | Los clústeres en los que se ejecutan los tenants. Solo administradores de la plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configuración del proyecto, organizaciones, deploy hooks, facturación |

Cada grupo de esa tabla responde a `--help` con una página propia —una línea de uso, sus flags y ejemplos—, y `--help` nunca ejecuta el comando. Un test mantiene el índice de las páginas, por lo que un grupo añadido sin una página propia hace fallar la compilación en lugar de responder con la tabla de contenidos. `verify:docs` vincula la tabla misma a ese índice: cada grupo que despacha la CLI aparece aquí exactamente una vez, por lo que un grupo añadido sin su fila también hace fallar la compilación.

Si se redirige mediante una tubería (pipe), `--help` responde en JSON: la misma línea de uso, flags y ejemplos como una estructura para leer en lugar de sesenta líneas de secuencias de escape de terminal.

## Qué no incluye la beta

Dicho claramente, porque enterarse más tarde es peor:

- **Sin selección de región.** Hoy en día todo se ejecuta en una única región. El modelo de ubicación existe en la plataforma, pero un proyecto no puede elegir región. `projects create --provider` y `--region` no son la excepción que aparentan: registran a cuál de los destinos de despliegue registrados del plano de control pertenece un proyecto, y solo hay uno, por lo que ambos toman ese valor por defecto y ninguno mueve el proyecto a ningún otro sitio. `rebase cloud projects create --help` indica lo mismo.
- **No es autoservicio.** El acceso se concede por lotes; no existe la opción de registrarse y pagar directamente.
- **Sin SLA publicado** ni SOC 2. Si necesitas alguno de los dos, indícalo al solicitar acceso en lugar de darlo por sentado.
- **Sin despliegues de previsualización (preview) o por ramas**, ni aplicación de GitHub oficial (first-party). Los deploy hooks —URLs secretas a las que apuntas un webhook del repositorio— son la automatización soportada.
- **CI requiere las credenciales de una persona.** Todavía no existen tokens de máquina; `rebase cloud login` solicita un correo electrónico y una contraseña. Pásalos como `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD` desde un gestor de secretos —`--password` deja la contraseña en el historial de la shell y en la tabla de procesos, y así lo advierte antes de iniciar sesión.
- **La recuperación a un punto en el tiempo (PITR) solo está disponible en la CLI.** La consola muestra las copias de seguridad; el flujo de trabajo de PITR por etapas es `rebase cloud db pitr`.
- **Sin endpoint público de base de datos.** Una base de datos administrada no está expuesta a internet, por lo que el host que muestra la consola es la dirección que usa tu backend para ella y no resuelve a nada en tu máquina local. `rebase cloud db connect` abre un puerto local que representa esa base de datos, tunelizada a través del plano de control, mientras lo mantengas en ejecución —pero no existe un hostname permanente al que un servicio de terceros pueda conectarse—. Tanto ese túnel como la contraseña tras `rebase cloud db info --reveal` requieren el rol de propietario (owner) o administrador de la organización: el mismo que solicita el editor SQL de Studio, ya que los tres desembocan en una sesión sobre tus datos de producción.

## Autoalojamiento como alternativa

Nada de esto implica dependencia del proveedor (vendor lock-in). La [guía de autoalojamiento](/docs/deployment/self-hosting/) ejecuta exactamente la misma imagen y bundle con `docker compose`, y la [guía de Kubernetes](/docs/deployment/kubernetes/) genera la misma topología a partir del chart de Helm.
