---
sourceHash: 94bd49dce72c5651
title: Conectar Claude a Rebase
sidebar_label: Conector de Rebase
description: Un conector MCP para todos tus proyectos de Rebase, en Rebase Cloud o autoalojados — agrégalo una vez en Claude, inicia sesión con tu cuenta de Rebase, y lee, despliega y modifica tus proyectos con el acceso que tienes en la consola, confirmando primero cada cambio.
---

El conector de Rebase es un servidor MCP único para cada proyecto de Rebase que ejecutas: en Rebase Cloud y en tus propios servidores. Lo agregas una vez en Claude, inicias sesión con tu cuenta de Rebase y Claude puede ver tus proyectos, leer sus registros, desplegarlos y revertirlos, configurar sus variables de entorno, y leer y modificar sus datos. Funciona en Claude para la web, la aplicación de escritorio y dispositivos móviles.

Actúa como **tú**, con el acceso que tiene tu cuenta en la consola: los proyectos de las organizaciones a las que perteneces, el rol que tienes en cada una y el acceso a los datos que te otorga Studio en la consola. No almacena ninguna clave propia.

## Agrégalo

En Claude, abre **Settings → Connectors → Add custom connector** e introduce:

```text
https://app.rebase.pro/mcp
```

Claude abrirá la pantalla de consentimiento de Rebase. Si has iniciado sesión en la consola en el mismo navegador, te ofrecerá esa cuenta: presiona **Allow**. De lo contrario, inicia sesión allí. La pantalla enumera lo que estás autorizando; puedes conectarte de nuevo más tarde para otorgar menos permisos.

Tus proyectos de Rebase Cloud ya estarán allí. Esa es toda la configuración para ellos.

## Añade tus instancias autoalojadas

Ejecuta esto una vez para cada servidor que alojes tú mismo:

```bash
rebase cloud connect https://admin.example.com
```

Añade la instancia a tu cuenta de Rebase e imprime dos variables. Configúralas en ese servidor y reinícialo; el comando espera hasta que el servidor responda y luego indica que está conectado. Dentro de la carpeta del proyecto, te ofrecerá escribirlas en `.env` por ti.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de ese momento, Claude listará la instancia junto a tus proyectos de Cloud, y podrás referirte a ella de la misma manera: "muéstrame las órdenes en admin.example.com". En una instancia autoalojada, el conector lee y modifica datos, lee su esquema y ejecuta sus tareas cron. Los despliegues, las variables de entorno y los registros permanecen en tu propio servidor.

- **El servidor necesita Rebase 0.28.1 o posterior**, accesible a través de https en una dirección pública. Rebase Cloud se comunica con él, por lo que un servidor que solo esté en una red privada no se podrá conectar.
- **Las variables no contienen ningún secreto.** La clave es la clave pública de Rebase Cloud; la audiencia nombra a esta instancia. Con ellas, el servidor acepta tokens de corta duración que Rebase Cloud firma exclusivamente para esta instancia, y les otorga como máximo lo que Studio permitiría: datos, bajo su seguridad a nivel de fila (RLS), y cron.
- **Las llamadas pasan por Rebase Cloud.** Claude se comunica con el conector, y el conector con tu servidor. Un servidor que nunca conectes mantiene su propio [remote MCP endpoint](/docs/ai/remote-mcp/), sin intermediarios.
- **Para desconectar una**, ejecuta `rebase cloud connect --remove https://admin.example.com` o elimina las dos variables del servidor.

Para añadir una instancia se requiere el rol de propietario (owner) o administrador (admin) de la organización, al igual que para acceder a los datos de un proyecto. `rebase cloud connect --list` muestra las que has añadido.

## Lo que Claude puede hacer con él

Trece herramientas. Las primeras nueve solo son de lectura:

| Tool | What it does |
|---|---|
| `projects` | Lista tus proyectos, su estado y tu rol en cada uno |
| `project_status` | El estado y el último despliegue de un proyecto; opcionalmente sus despliegues recientes, los **nombres** de sus variables de entorno, sus tareas cron |
| `logs` | La salida de la aplicación en ejecución, el registro de compilación de un despliegue o las ejecuciones de una tarea cron |
| `schema` | Las tablas de un proyecto, o las columnas, relaciones y reglas de seguridad de una tabla |
| `query` | Lee filas: una por id, una página filtrada o un recuento |
| `show_table` | Abre una tabla en la propia vista de tu panel de administración, dentro de la conversación: una tabla, lista, tarjetas o tablero kanban en el que puedes buscar, filtrar y paginar, donde una fila abre su formulario |
| `show_record` | Abre el formulario de una fila, o un formulario para una nueva fila que Claude completó, para que lo revises y guardes |
| `show_app` | Crea una pequeña aplicación para la tarea en cuestión, como una cola de clasificación o un panel de control, y la ejecuta sobre tus datos en la conversación. Puede usar las vistas y formularios de tu panel de administración, y te pregunta antes de cambiar nada |
| `show_app_guide` | Cómo escribir el código de `show_app`: los hooks, componentes y props que una aplicación puede usar, con un ejemplo. Claude lo lee antes de crear una aplicación |

Las otras cuatro modifican producción, y cada una pide confirmación primero:

| Tool | What it does |
|---|---|
| `write` | Crea, actualiza o elimina una fila (usuarios incluidos: son filas de tu tabla de usuarios) |
| `deploy` | Despliega una rama de git, revierte a un despliegue anterior o cancela uno en curso |
| `env` | Establece o elimina variables de entorno; el cambio se aplica en el siguiente despliegue |
| `cron` | Ejecuta una tarea cron ahora, o activa/desactiva una |

El despliegue de código desde tu máquina sigue haciéndose con la CLI (`rebase cloud deploy`) y el [local MCP server](/docs/ai/mcp/), que también cubre el desarrollo local, la generación de esquemas y las ramas de bases de datos.

## Skills

El conector también ofrece las 24 [Rebase agent skills](/docs/ai/skills/), las mismas que `rebase skills install` copia en un proyecto. Claude carga una cuando la tarea lo requiere: cómo definir una tabla, escribir un hook, configurar autenticación, desplegar. No es necesario instalar nada. Claude Code las lista como `<connector>:rebase-tables` y así sucesivamente, bajo el nombre que le diste al conector. Las skills a través de MCP necesitan un cliente con la revisión de protocolo 2026-07-28 o posterior, y se encuentran en fase beta pública en Claude Code.

## Cada cambio se confirma

Una herramienta que modifica algo requiere dos llamadas. La primera no cambia nada: responde con un plan, como "Roll shop back to deployment d_81f2", y un token de confirmación. Claude te muestra el plan y vuelve a realizar la llamada con el token solo si estás de acuerdo. El token funciona durante cinco minutos, una sola vez y exactamente para los argumentos para los que fue creado: si algo difiere, no se ejecuta nada.

Claude también te pide permiso antes de llamar a cualquiera de estas cuatro herramientas, ya que están marcadas como destructivas. En las vistas, guardar un formulario muestra el plan y espera a que presiones **Save**.

Los valores de las variables de entorno nunca se devuelven: un plan muestra su longitud y `project_status` lista únicamente los nombres. Un valor que configures sí pasa por la conversación.

## A qué puede acceder

- **Proyectos y operaciones en la nube**: lo que te permite la consola. Un miembro de una organización puede leer el estado y los registros y, al igual que en la consola, desplegar y configurar variables.
- **Datos, esquemas y tareas cron**: lo que te permite Studio en la consola. Esto aplica a un propietario o administrador de la organización, en un proyecto cuyo acceso a Studio esté habilitado, o en una instancia autoalojada que la organización haya conectado. Las llamadas se ejecutan dentro del proyecto, bajo su seguridad a nivel de fila, con el rol de admin que tiene Studio. Desactivar el acceso a Studio en un proyecto también desactiva esto.
- **Lo que hayas concedido.** Puedes otorgar al conector menos permisos de los que tiene tu cuenta: solo lectura, o un único proyecto. Nunca solicita copias de seguridad, restauraciones, credenciales de base de datos ni configuraciones del proyecto.

Un proyecto accede a sus datos mediante el conector una vez que ejecuta un runtime compatible con las llamadas del conector. Hasta su próximo despliegue o actualización de la plataforma, dichas herramientas te lo indicarán.

## Cómo desconectarlo

Elimina el conector en la configuración de Claude. Su token de acceso dejará de funcionar en un plazo de una hora. Si eliminas tu cuenta de Rebase o cierras sesión en todos lados, dejará de funcionar en la siguiente llamada.

El conector está destinado a quienes construyen sobre Rebase. Para permitir que las personas que **usan** tu aplicación conecten Claude a ella en su propio nombre, expón el [remote MCP endpoint](/docs/ai/remote-mcp/) desde tu propio backend.
