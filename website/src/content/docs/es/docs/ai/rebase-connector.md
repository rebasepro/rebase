---
sourceHash: f5fcf560853b0193
title: Conectar Claude a Rebase
sidebar_label: Conector de Rebase
description: Un conector MCP para todos tus proyectos de Rebase, en Rebase Cloud o autoalojados — añádelo una vez en Claude, inicia sesión con tu cuenta de Rebase y lee, despliega y modifica tus proyectos con el acceso que tienes en la consola, confirmando cada cambio primero.
---

El conector de Rebase es un servidor MCP para cada proyecto de Rebase que ejecutes: en Rebase Cloud y en tus propios servidores. Lo añades una vez en Claude, inicias sesión con tu cuenta de Rebase, y Claude podrá ver tus proyectos, leer sus logs, desplegarlos y revertirlos, configurar sus variables de entorno, y leer y modificar sus datos. Funciona en Claude en la web, la aplicación de escritorio y móvil.

Actúa como **tú**, con el acceso que tiene tu cuenta en la consola: los proyectos de las organizaciones a las que perteneces, el rol que tienes en cada una y el acceso a los datos que te da Studio en la consola. No almacena ninguna clave propia.

## Añádelo

En Claude, abre **Settings → Connectors → Add custom connector** e introduce:

```text
https://app.rebase.pro/mcp
```

Claude abrirá la pantalla de consentimiento de Rebase. Si has iniciado sesión en la consola en el mismo navegador, te ofrecerá esa cuenta: pulsa **Allow**. De lo contrario, inicia sesión allí. La pantalla muestra lo que estás concediendo; puedes volver a conectarte más tarde para conceder menos permisos.

Tus proyectos de Rebase Cloud ya estarán allí. Esa es toda la configuración necesaria para ellos.

## Añade tus instancias autoalojadas

Ejecuta esto una vez para cada servidor que alojes tú mismo:

```bash
rebase cloud connect https://admin.example.com
```

Esto añade la instancia a tu cuenta de Rebase y muestra dos variables. Configúralas en ese servidor y reinícialo; el comando esperará hasta que el servidor responda y luego indicará que está conectado. Dentro de la carpeta del proyecto, te ofrecerá escribirlas en `.env` por ti.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de ese momento, Claude listará la instancia junto a tus proyectos de Cloud, y podrás referirte a ella de la misma forma: «muéstrame los pedidos en admin.example.com». En una instancia autoalojada, el conector lee y modifica datos, lee su esquema y ejecuta sus tareas cron. Los despliegues, las variables de entorno y los logs permanecen en tu propio servidor.

- **El servidor necesita Rebase 0.28.1 o posterior**, accesible a través de https en una dirección pública. Rebase Cloud lo invoca, por lo que un servidor que solo esté en una red privada no se puede conectar.
- **Las variables no contienen ningún secreto.** La clave es la clave pública de Rebase Cloud; la audiencia nombra a esta instancia. Con ellas, el servidor acepta tokens de corta duración que Rebase Cloud firma únicamente para esta instancia, y les otorga como máximo lo que Studio permitiría: datos, bajo su seguridad a nivel de fila (row-level security), y cron.
- **Las llamadas pasan a través de Rebase Cloud.** Claude se comunica con el conector, y el conector con tu servidor. Un servidor que nunca conectes conserva su propio [endpoint MCP remoto](/docs/ai/remote-mcp/), sin intermediarios.
- **Para desconectar una**, ejecuta `rebase cloud connect --remove https://admin.example.com`, o elimina las dos variables del servidor.

Añadir una instancia requiere el rol de propietario o administrador de la organización, al igual que para acceder a los datos de un proyecto. `rebase cloud connect --list` muestra las que has añadido.

## Qué puede hacer Claude con él

Diez herramientas. Las primeras seis son solo de lectura:

| Herramienta | Qué hace |
|---|---|
| `projects` | Lista tus proyectos, su estado y tu rol en cada uno |
| `project_status` | El estado y último despliegue de un proyecto; opcionalmente sus despliegues recientes, los **nombres** de sus variables de entorno, sus tareas cron |
| `logs` | La salida de la aplicación en ejecución, el log de compilación de un despliegue o las ejecuciones de una tarea cron |
| `schema` | Las colecciones de un proyecto, o los campos de una colección |
| `query` | Lee filas: una por id, una página filtrada o un conteo |
| `show_collection` | Muestra filas como una tabla en la conversación, donde puedes paginar y editar celdas |

Las otras cuatro modifican producción, y cada una solicita confirmación primero:

| Herramienta | Qué hace |
|---|---|
| `write` | Crea, actualiza o elimina una fila (usuarios incluidos: son filas de tu colección de usuarios) |
| `deploy` | Despliega una rama de git, revierte a un despliegue anterior o cancela uno en curso |
| `env` | Establece o elimina variables de entorno; los cambios se aplican en el siguiente despliegue |
| `cron` | Ejecuta una tarea cron ahora, o la activa o desactiva |

El despliegue de código desde tu máquina sigue haciéndose con la CLI (`rebase cloud deploy`) y el [servidor MCP local](/docs/ai/mcp/), que también cubre el desarrollo local, la generación de esquemas y las ramas de base de datos.

## Cada cambio se confirma

Una herramienta que modifica algo requiere dos llamadas. La primera no cambia nada: responde con un plan, como «Revertir tienda al despliegue d_81f2», y un token de confirmación. Claude te muestra el plan y vuelve a llamar con el token solo si estás de acuerdo. El token funciona durante cinco minutos, una sola vez, exactamente para los argumentos para los que fue creado: si algo difiere, no se ejecuta nada.

Claude también te pide permiso antes de llamar a cualquiera de estas cuatro herramientas, ya que están marcadas como destructivas. En la vista de tabla, una celda editada muestra el plan y espera a que pulses **Save**.

Los valores de las variables de entorno nunca se devuelven en pantalla: un plan muestra su longitud y `project_status` solo lista sus nombres. Un valor que configures sí pasa a través de la conversación.

## A qué puede acceder

- **Proyectos y operaciones en la nube**: lo que te permita la consola. Un miembro de una organización puede leer el estado y los logs y, al igual que en la consola, desplegar y configurar variables.
- **Datos, esquemas y tareas cron**: lo que Studio en la consola te permita. Esto corresponde a un propietario o administrador de la organización, en un proyecto cuyo acceso a Studio esté activado, o en una instancia autoalojada que la organización haya conectado. Las llamadas se ejecutan dentro del proyecto, bajo su seguridad a nivel de fila, con el rol de administrador que tiene Studio. Desactivar el acceso a Studio para un proyecto también desactiva esto.
- **Lo que hayas concedido.** Puedes conceder al conector menos permisos de los que tiene tu cuenta: solo lectura, o solo un proyecto. Nunca solicita copias de seguridad, restauraciones, credenciales de base de datos ni ajustes del proyecto.

Un proyecto accede a sus datos a través del conector una vez que ejecuta un entorno de ejecución (runtime) que acepte las llamadas del conector. Hasta su próximo despliegue o actualización de la plataforma, esas herramientas lo indicarán así.

## Desconexión

Elimina el conector en la configuración de Claude. Su token de acceso dejará de funcionar en cuestión de una hora. Si eliminas tu cuenta de Rebase o cierras sesión en todas partes, dejará de funcionar en la siguiente llamada.

El conector está pensado para quienes desarrollan en Rebase. Para permitir que las personas que **usan** tu aplicación conecten Claude a ella con sus propias identidades, sirve el [endpoint MCP remoto](/docs/ai/remote-mcp/) desde tu propio backend.
