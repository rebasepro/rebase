---
sourceHash: ec133aedf22a0316
title: Conectar Claude a Rebase
sidebar_label: Conector de Rebase
description: Un conector MCP para todos tus proyectos de Rebase, en Rebase Cloud o autoalojados — añádelo una vez en Claude, inicia sesión con tu cuenta de Rebase y lee, despliega y modifica tus proyectos con el acceso que tienes en la consola, confirmando previamente cada cambio.
---

El conector de Rebase es un servidor MCP único para cada proyecto de Rebase que ejecutes: en Rebase Cloud y en tus propios servidores. Lo añades una vez en Claude, inicias sesión con tu cuenta de Rebase y Claude puede ver tus proyectos, leer sus registros (logs), desplegarlos y revertirlos, configurar sus variables de entorno, y leer y modificar sus datos. Funciona en Claude para la web, la aplicación de escritorio y dispositivos móviles.

Actúa como **tú**, con el acceso que tiene tu cuenta en la consola: los proyectos de las organizaciones a las que perteneces, el rol que tienes en cada una y el acceso a los datos que te otorga Studio en la consola. No almacena ninguna clave propia.

## Añádelo

En Claude, abre **Settings → Connectors → Add custom connector** e introduce:

```text
https://app.rebase.pro/mcp
```

Claude abrirá la pantalla de consentimiento de Rebase. Si has iniciado sesión en la consola en el mismo navegador, te ofrecerá esa cuenta: pulsa **Allow**. De lo contrario, inicia sesión allí. La pantalla lista lo que estás autorizando; puedes volver a conectarte más tarde para conceder menos permisos.

Tus proyectos de Rebase Cloud ya estarán ahí. Esa es toda la configuración necesaria para ellos.

## Añade tus instancias autoalojadas

Ejecuta esto una vez para cada servidor que alojes tú mismo:

```bash
rebase cloud connect https://admin.example.com
```

Añade la instancia a tu cuenta de Rebase e imprime dos variables. Configúralas en ese servidor y reinícialo; el comando esperará hasta que el servidor responda y luego indicará que está conectado. Dentro de la carpeta del proyecto, te ofrecerá escribirlas en `.env` por ti.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de ese momento, Claude listará la instancia junto a tus proyectos de Cloud, y podrás referirte a ella de la misma forma: «muéstrame los pedidos en admin.example.com». En una instancia autoalojada, el conector lee y modifica datos, lee su esquema y ejecuta sus tareas cron. Los despliegues, las variables de entorno y los registros permanecen en tu propio servidor.

- **El servidor necesita Rebase 0.28.1 o posterior**, accesible a través de https en una dirección pública. Rebase Cloud lo llama, por lo que un servidor que solo esté en una red privada no se puede conectar.
- **Las variables no contienen secretos.** La clave es la clave pública de Rebase Cloud; la audiencia nombra a esta instancia. Con ellas, el servidor acepta tokens de corta duración que Rebase Cloud firma exclusivamente para esta instancia, y les otorga como máximo lo que Studio permitiría: datos (bajo su seguridad a nivel de fila) y tareas cron.
- **Las llamadas pasan por Rebase Cloud.** Claude se comunica con el conector, y el conector con tu servidor. Un servidor que nunca conectes conserva su propio [endpoint MCP remoto](/docs/ai/remote-mcp/), sin nada de por medio.
- **Para desconectar una**, ejecuta `rebase cloud connect --remove https://admin.example.com` o elimina las dos variables del servidor.

Añadir una instancia requiere el rol de propietario (owner) o administrador (admin) de la organización, al igual que acceder a los datos de un proyecto. `rebase cloud connect --list` muestra las que has añadido.

## Qué puede hacer Claude con él

Dieciséis herramientas. Las primeras doce son solo de lectura:

| Herramienta | Qué hace |
|---|---|
| `projects` | Lista tus proyectos, su estado y tu rol en cada uno |
| `project_status` | El estado de un proyecto y su último despliegue; opcionalmente sus despliegues recientes, los **nombres** de sus variables de entorno y sus tareas cron |
| `logs` | La salida de la aplicación en ejecución, el registro de compilación de un despliegue o las ejecuciones de una tarea cron |
| `schema` | Las tablas de un proyecto, o las columnas, relaciones y reglas de seguridad de una tabla |
| `query` | Lee filas: una por id, una página filtrada o un recuento |
| `storage_list` | Lista una carpeta del almacenamiento de archivos de un proyecto, una página a la vez, e indica sus fuentes de almacenamiento y el bucket al que sirve cada una |
| `storage_head` | Indica si un archivo existe, así como su tamaño, tipo y última modificación. Admite la clave o el valor `s3://bucket/key` que almacena una fila |
| `storage_get` | Lee un archivo: su contenido cuando es texto (los primeros 64 KB por defecto), o su tamaño y tipo cuando es binario |
| `show_table` | Abre una tabla en la propia vista de tu panel de administración, dentro de la conversación: una tabla, lista, tarjetas o tablero kanban en el que puedes buscar, filtrar y paginar, donde una fila abre su formulario |
| `show_record` | Abre el formulario de una fila, o el formulario para una nueva fila que Claude haya rellenado, para que lo revises y lo guardes |
| `show_app` | Crea una pequeña aplicación para la tarea en cuestión, como una cola de clasificación (triage) o un panel de control, y la ejecuta con tus datos dentro de la conversación. Puede usar las vistas y formularios de tu panel de administración, y te pide confirmación antes de cambiar nada |
| `show_app_guide` | Cómo escribir el código para `show_app`: los hooks, componentes y props que una aplicación puede usar, con un ejemplo. Claude lo lee antes de crear una aplicación |

Las otras cuatro modifican producción, y cada una pide confirmación primero:

| Herramienta | Qué hace |
|---|---|
| `write` | Crea, actualiza o elimina una fila (usuarios incluidos: son filas de tu tabla de usuarios) |
| `deploy` | Despliega una rama de git, revierte a un despliegue anterior o cancela uno en curso |
| `env` | Configura o elimina variables de entorno; los cambios se aplican en el siguiente despliegue |
| `cron` | Ejecuta una tarea cron ahora, o la activa o desactiva |

El despliegue de código desde tu máquina sigue realizándose con la CLI (`rebase cloud deploy`) y el [servidor MCP local](/docs/ai/mcp/), que también cubre el desarrollo local, la generación de esquemas y las ramas de la base de datos.

## Cada cambio se confirma

Una herramienta que modifica algo requiere dos llamadas. La primera no cambia nada: responde con un plan, como «Revertir tienda al despliegue d_81f2», y un token de confirmación. Claude te muestra el plan y vuelve a realizar la llamada con el token solo si estás de acuerdo. El token es válido durante cinco minutos, para un solo uso y exactamente para los argumentos para los que fue creado: si algo difiere, no se ejecuta nada.

Claude también te pide permiso antes de llamar a cualquiera de estas cuatro herramientas, ya que están marcadas como destructivas. En las vistas, al guardar un formulario se muestra el plan y se espera a que pulses **Save**.

Los valores de las variables de entorno nunca se muestran de vuelta: el plan muestra su longitud y `project_status` lista únicamente los nombres. El valor que configures sí pasa por la conversación.

## A qué puede acceder

- **Proyectos y operaciones en la nube**: lo que te permita la consola. Un miembro de una organización puede leer el estado y los registros y, al igual que en la consola, desplegar y configurar variables.
- **Datos, archivos, esquemas y tareas cron**: lo que te permita Studio en la consola. Esto corresponde a un rol de propietario o administrador de la organización, en un proyecto cuyo acceso a Studio esté activado, o en una instancia autoalojada que la organización haya conectado. Las llamadas se ejecutan dentro del proyecto, bajo su seguridad a nivel de fila, con el rol de admin que tiene Studio. Los archivos se leen a través de las propias fuentes de almacenamiento del proyecto (el almacenamiento de Rebase o el bucket configurado en sus variables `S3_*`) bajo sus reglas de almacenamiento, y nunca se escriben ni se eliminan. Desactivar el acceso a Studio en un proyecto también desactiva esto.
- **Lo que hayas concedido.** Puedes otorgar al conector menos permisos de los que tiene tu cuenta: solo lectura o solo un proyecto. Nunca solicita copias de seguridad, restauraciones, credenciales de base de datos ni ajustes del proyecto.

Un proyecto accede a sus datos a través del conector una vez que ejecuta un runtime que admite las llamadas del conector, y a sus archivos una vez que dicho runtime dispone de las herramientas de almacenamiento. Hasta su próximo despliegue o actualización de la plataforma, esas herramientas te lo advertirán.

## Desconexión

Elimina el conector en la configuración de Claude. Su token de acceso dejará de funcionar en un plazo de una hora. Si eliminas tu cuenta de Rebase o cierras sesión en todos los dispositivos, dejará de funcionar en la siguiente llamada.

El conector está diseñado para las personas que desarrollan en Rebase. Para permitir que las personas que **usan** tu aplicación conecten Claude a ella en su propio nombre, sirve el [endpoint MCP remoto](/docs/ai/remote-mcp/) desde tu propio backend.
