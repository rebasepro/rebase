---
sourceHash: 8857009d4684b08b
title: Conectar Claude a Rebase
sidebar_label: Conector de Rebase
description: Un único conector MCP para todos tus proyectos de Rebase, en Rebase Cloud o autoalojados — añádelo una vez en Claude, inicia sesión con tu cuenta de Rebase y lee, despliega y modifica tus proyectos con el acceso que tienes en la consola, confirmando cada cambio previamente.
---

El conector de Rebase es un único servidor MCP para cada proyecto de Rebase
que ejecutes: en Rebase Cloud y en tus propios servidores. Lo añades una vez en
Claude, inicias sesión con tu cuenta de Rebase, y Claude podrá ver tus proyectos,
leer sus registros (logs), desplegarlos y revertirlos, configurar sus variables
de entorno, y leer y modificar sus datos. Funciona en Claude para la web, la
aplicación de escritorio y dispositivos móviles.

Actúa en **tu** nombre, con el acceso que tiene tu cuenta en la consola: los
proyectos de las organizaciones a las que perteneces, el rol que tienes en cada
una y el acceso a los datos que te otorga Studio en la consola. No posee ninguna
clave propia.

## Añádelo

En Claude, abre **Settings → Connectors → Add custom connector** e introduce:

```text
https://app.rebase.pro/mcp
```

Claude abrirá la pantalla de consentimiento de Rebase. Si has iniciado sesión
en la consola en el mismo navegador, te ofrecerá esa cuenta: pulsa **Allow**.
De lo contrario, inicia sesión allí. La pantalla lista los permisos que estás
concediendo; puedes volver a conectarte más tarde para conceder menos permisos.

Tus proyectos de Rebase Cloud ya estarán allí. Esa es toda la configuración para
ellos.

## Añade tus instancias autoalojadas

Ejecuta esto una vez para cada servidor que alojes tú mismo:

```bash
rebase cloud connect https://admin.example.com
```

Esto añade la instancia a tu cuenta de Rebase e imprime dos variables.
Configúralas en ese servidor y reinícialo; el comando esperará hasta que el
servidor responda y luego indicará que está conectado. Dentro de la carpeta del
proyecto, te ofrecerá escribirlas en `.env` por ti.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de ese momento, Claude listará la instancia junto a tus proyectos de
Cloud, y te referirás a ella de la misma manera: "muéstrame los pedidos en
admin.example.com". En una instancia autoalojada, el conector lee y modifica
datos, consulta su esquema y ejecuta sus tareas cron. Los despliegues, las
variables de entorno y los registros permanecen en tu propio servidor.

- **El servidor necesita Rebase 0.28.1 o posterior**, accesible a través de https
  en una dirección pública. Rebase Cloud se comunica con él, por lo que un
  servidor que esté únicamente en una red privada no se podrá conectar.
- **Las variables no contienen ningún secreto.** La clave es la clave pública de
  Rebase Cloud; la audiencia (audience) identifica a esta instancia. Con ellas,
  el servidor acepta tokens de corta duración que Rebase Cloud firma
  exclusivamente para esta instancia, y les otorga como máximo lo que Studio
  permitiría: datos, bajo su seguridad a nivel de fila (row-level security), y cron.
- **Las llamadas pasan a través de Rebase Cloud.** Claude se comunica con el
  conector, y el conector con tu servidor. Un servidor que nunca conectes conserva
  su propio [endpoint MCP remoto](/docs/ai/remote-mcp/), sin intermediarios.
- **Para desconectar una**, ejecuta `rebase cloud connect --remove https://admin.example.com`
  o elimina las dos variables del servidor.

Añadir una instancia requiere el rol de propietario (owner) o administrador
(admin) de la organización, al igual que acceder a los datos de un proyecto.
`rebase cloud connect --list` muestra las que has añadido.

## Qué puede hacer Claude con él

Trece herramientas. Las primeras nueve son de solo lectura:

| Herramienta | Qué hace |
|---|---|
| `projects` | Lista tus proyectos, su estado y tu rol en cada uno |
| `project_status` | El estado de un proyecto y su último despliegue; opcionalmente sus despliegues recientes, los **nombres** de sus variables de entorno, sus tareas cron |
| `logs` | La salida de la aplicación en ejecución, el registro de compilación de un despliegue o las ejecuciones de una tarea cron |
| `schema` | Las colecciones de un proyecto, o los campos de una colección |
| `query` | Lee filas: una por id, una página filtrada o un recuento (count) |
| `show_collection` | Abre una colección en la vista propia de tu panel de administración, dentro de la conversación: una tabla, lista, tarjetas o tablero kanban en el que puedes buscar, filtrar y paginar, donde una fila abre su formulario |
| `show_record` | Abre el formulario de una fila, o un formulario para una nueva fila que Claude haya rellenado, para que lo revises y guardes |
| `show_app` | Crea una pequeña aplicación para la tarea en cuestión, como una cola de triaje o un panel de control, y la ejecuta con tus datos dentro de la conversación. Puede utilizar las vistas y formularios de tu panel de administración, y te pedirá confirmación antes de cambiar nada |
| `show_app_guide` | Cómo escribir el código de `show_app`: los hooks, componentes y props que puede usar una aplicación, con un ejemplo. Claude lo lee antes de crear una aplicación |

Las otras cuatro modifican producción, y cada una pide confirmación primero:

| Herramienta | Qué hace |
|---|---|
| `write` | Crea, actualiza o elimina una fila (usuarios incluidos: son filas de tu colección de usuarios) |
| `deploy` | Despliega una rama de git, revierte a un despliegue anterior o cancela uno en curso |
| `env` | Establece o elimina variables de entorno; los cambios se aplican en el siguiente despliegue |
| `cron` | Ejecuta una tarea cron ahora, o activa/desactiva una |

El despliegue de código desde tu máquina sigue haciéndose con la CLI
(`rebase cloud deploy`) y el [servidor MCP local](/docs/ai/mcp/), que también
cubre el desarrollo local, la generación de esquemas y las ramas de base de datos.

## Cada cambio se confirma

Una herramienta que modifica algo requiere dos llamadas. La primera no cambia
nada: responde con un plan, como «Roll shop back to deployment d_81f2», y un token
de confirmación. Claude te muestra el plan y vuelve a llamar con el token solo si
estás de acuerdo. El token funciona durante cinco minutos, una sola vez,
exactamente para los argumentos para los que fue creado: si algo difiere, no se
ejecuta nada.

Claude también te pide permiso antes de llamar a cualquiera de estas cuatro
herramientas, ya que están marcadas como destructivas. En las vistas, al guardar
un formulario se muestra el plan y se espera a que pulses **Save**.

Los valores de las variables de entorno nunca se devuelven en las respuestas: un
plan muestra su longitud y `project_status` lista únicamente los nombres. El
valor que configures sí pasa a través de la conversación.

## A qué tiene acceso

- **Proyectos y operaciones en la nube**: lo que te permite la consola. Un
  miembro de una organización puede consultar el estado y los registros y, al
  igual que en la consola, desplegar y configurar variables.
- **Datos, esquemas y tareas cron**: lo que te permite Studio en la consola. Esto
  corresponde a un rol de propietario o administrador de la organización, en un
  proyecto cuyo acceso a Studio esté activado, o en una instancia autoalojada
  que la organización haya conectado. Las llamadas se ejecutan dentro del
  proyecto, bajo su seguridad a nivel de fila, con el rol de administrador que
  tiene Studio. Desactivar el acceso a Studio en un proyecto también desactiva esto.
- **Lo que hayas concedido.** Puedes conceder al conector menos permisos de los
  que tiene tu cuenta: solo lectura o solo un proyecto. Nunca solicita copias de
  seguridad, restauraciones, credenciales de base de datos ni configuraciones del
  proyecto.

Un proyecto tiene acceso a sus datos a través del conector una vez que ejecuta
un entorno de ejecución (runtime) que acepte las llamadas del conector. Hasta su
próximo despliegue o actualización de la plataforma, dichas herramientas te lo
indicarán.

## Desconexión

Elimina el conector en los ajustes de Claude. Su token de acceso dejará de
funcionar en un plazo de una hora. Si eliminas tu cuenta de Rebase o cierras
sesión en todas partes, dejará de funcionar en la siguiente llamada.

El conector está pensado para quienes desarrollan sobre Rebase. Para permitir
que las personas que **usan** tu aplicación conecten Claude a ella con su propia
identidad, expón el [endpoint MCP remoto](/docs/ai/remote-mcp/) desde tu propio
backend.
