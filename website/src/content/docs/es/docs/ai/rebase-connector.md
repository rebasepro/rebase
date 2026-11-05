---
sourceHash: 97232ebc628a975c
title: Conecta Claude a Rebase Cloud
sidebar_label: Conector de Rebase Cloud
description: Un solo conector MCP para todos tus proyectos de Rebase Cloud — añádelo una vez en Claude, inicia sesión con tu cuenta de Rebase, y lee, despliega y cambia tus proyectos con el acceso que tienes en la consola, confirmando antes cada cambio.
---

El conector de Rebase es un único servidor MCP para todo lo que ejecutas en
Rebase Cloud. Lo añades una vez en Claude, inicias sesión con tu cuenta de
Rebase, y Claude puede ver tus proyectos, leer sus logs, desplegarlos y
revertirlos, definir sus variables de entorno, y leer y cambiar sus datos.
Funciona en Claude en la web, en la app de escritorio y en el móvil.

Actúa como **tú**, con el acceso que tu cuenta tiene en la consola: los
proyectos de las organizaciones a las que perteneces, el rol que tienes en cada
una, y el acceso a datos que te da el Studio de la consola. No tiene ninguna
clave propia.

## Añádelo

En Claude, abre **Configuración → Conectores → Añadir conector personalizado**
e introduce:

```text
https://app.rebase.pro/mcp
```

Claude abre la pantalla de consentimiento de Rebase. Si tienes la sesión
iniciada en la consola en el mismo navegador, ofrece esa cuenta: pulsa
**Permitir**. Si no, inicia sesión ahí. La pantalla enumera lo que concedes;
puedes volver a conectar más tarde para conceder menos.

## Qué puede hacer Claude con él

Diez herramientas. Las seis primeras solo leen:

| Herramienta | Qué hace |
|---|---|
| `projects` | Lista tus proyectos, su estado y tu rol en cada uno |
| `project_status` | El estado y el último despliegue de un proyecto; opcionalmente sus despliegues recientes, los **nombres** de sus variables de entorno, sus tareas cron |
| `logs` | La salida de la app en ejecución, el log de compilación de un despliegue o las ejecuciones de una tarea cron |
| `schema` | Las colecciones de un proyecto, o los campos de una colección |
| `query` | Lee filas: una por id, una página filtrada o un recuento |
| `show_collection` | Muestra filas como una tabla en la conversación, donde puedes paginar y editar celdas |

Las otras cuatro cambian producción, y cada una pregunta primero:

| Herramienta | Qué hace |
|---|---|
| `write` | Crea, actualiza o elimina una fila (usuarios incluidos: son filas de tu colección de usuarios) |
| `deploy` | Despliega una rama de git, revierte a un despliegue anterior o cancela uno en curso |
| `env` | Define o elimina variables de entorno; un cambio se aplica en el siguiente despliegue |
| `cron` | Ejecuta una tarea cron ahora, o la activa o desactiva |

Desplegar código desde tu máquina sigue siendo cosa de la CLI
(`rebase cloud deploy`) y del [servidor MCP local](/docs/ai/mcp/), que también
cubre el desarrollo local, la generación del esquema y las ramas de base de
datos.

## Cada cambio se confirma

Una herramienta que cambia algo necesita dos llamadas. La primera no cambia
nada: responde con un plan, como "Revertir shop al despliegue d_81f2", y un
token de confirmación. Claude te muestra el plan y vuelve a llamar con el token
solo si estás de acuerdo. El token sirve durante cinco minutos, una vez, para
exactamente los argumentos para los que se creó: si algo difiere, no se ejecuta
nada.

Claude también te pide permiso antes de llamar a cualquiera de estas cuatro
herramientas, porque están marcadas como destructivas. En la vista de tabla,
una celda editada muestra el plan y espera a que pulses **Guardar**.

Los valores de las variables de entorno nunca se muestran de vuelta: un plan
muestra su longitud, y `project_status` solo lista nombres. Un valor que
defines sí pasa por la conversación.

## Hasta dónde llega

- **Proyectos y operaciones en la nube**: lo que te permite la consola. Un
  miembro de una organización puede leer el estado y los logs y, como en la
  consola, desplegar y definir variables.
- **Datos, esquemas y tareas cron**: lo que te permite Studio en la consola. Es
  decir, un owner o admin de la organización, en un proyecto con el acceso de
  Studio activado. Las llamadas se ejecutan dentro del proyecto, bajo su
  seguridad a nivel de fila, con el rol de admin que tiene Studio. Desactivar el
  acceso de Studio para un proyecto también desactiva esto.
- **Lo que concediste.** Puedes conceder al conector menos de lo que tiene tu
  cuenta: solo lectura, o un solo proyecto. Nunca pide copias de seguridad,
  restauraciones, credenciales de la base de datos ni ajustes del proyecto.

Un proyecto da acceso a sus datos a través del conector en cuanto ejecuta un
runtime que acepta las llamadas del conector. Hasta su próximo despliegue o
actualización de la plataforma, esas herramientas lo indican.

## Desconectar

Quita el conector en la configuración de Claude. Su token de acceso deja de
funcionar en menos de una hora. Si eliminas tu cuenta de Rebase o cierras la
sesión en todas partes, se detiene en la siguiente llamada.

El conector es para quienes construyen en Rebase Cloud. Para que las personas
que **usan** tu app conecten Claude a ella en su propio nombre, sirve el
[punto de conexión MCP remoto](/docs/ai/remote-mcp/) desde tu propio backend.
