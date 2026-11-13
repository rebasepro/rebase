---
sourceHash: b4a48b328135ef8c
title: CI, agentes y backends reclamables
sidebar_label: CI y agentes
description: Despliega en Rebase Cloud desde CI o un agente con un token acotado en lugar de una contraseña, y permite que un agente aprovisione un backend en vivo sin cuenta que una persona pueda reclamar más adelante.
---

Un proyecto de [Rebase Cloud](/docs/deployment/cloud/) no necesita a una persona frente a una terminal para desplegarse. Un trabajo de CI o un agente actúa con un token delimitado a unas pocas acciones en un proyecto, y un agente puede crear un proyecto antes de que alguien tenga una cuenta para luego entregar un enlace y reclamarlo.


## CI y agentes

Un trabajo de CI o un agente no debería llevar tu contraseña. En su lugar, proporciónale un token: una clave que actúa en nombre de tu cuenta, delimitada a unas pocas acciones en un proyecto. Créalo desde una terminal con la sesión iniciada:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

El token se muestra una sola vez, como una línea `export REBASE_TOKEN=rk_live_…`. Con `REBASE_TOKEN` configurado, cada comando de `rebase cloud` se autentica con él en lugar de tu inicio de sesión, y nunca lee ni escribe en la sesión almacenada. En GitHub Actions, guárdalo como un secreto del repositorio y exponlo bajo ese nombre:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` acepta una o más capacidades, separadas por comas o repetidas:

| Capacidad | Lo que el token puede hacer |
|---|---|
| `deploy` | Desplegar el proyecto y seguir sus compilaciones: `deploy` (incluido `--preview`), `deployments`, `previews` |
| `logs` | Leer registros de compilación y de ejecución, historial de cron, métricas en vivo y uso: `logs`, `cron`, `metrics`, `usage` |
| `env` | Leer y modificar variables de entorno, incluidos los secretos, y las de las vistas previas (`--preview`) |
| `database` | `db list`, `db info` y `db connect`, lo cual incluye la contraseña de la base de datos |
| `backups` | Listar, crear, inspeccionar y descargar copias de seguridad, y leer la ventana de restauración en un punto en el tiempo |

Otras tres capacidades actúan sobre una organización en lugar de un proyecto. Un token posee una solo cuando `--can` la especifica, en la organización que indique `--org` (o, sin `--org`, la organización del proyecto y luego la seleccionada con `rebase cloud use`). Un token puede poseerlas sin ninguna capacidad a nivel de proyecto:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capacidad | Lo que el token puede hacer |
|---|---|
| `billing` | Consultar la tarjeta registrada, las facturas y la próxima factura, y cambiar el correo electrónico de facturación: `billing`, `billing invoices`, `billing upcoming`. Solo propietarios y administradores |
| `audit` | Leer el registro de actividad de la organización: `activity`. Solo propietarios y administradores |
| `notifications` | Cambiar las preferencias de correo electrónico de su propio titular y los webhooks de notificación de los proyectos de la organización: `notifications`. Agregar, modificar y eliminar un webhook sigue requiriendo el rol de propietario o administrador |

Un token creado antes de que existiera `billing` seguirá leyendo la facturación durante una versión más. Cada una de esas respuestas incluye un encabezado `Deprecation: true` y una frase que indica el alcance (scope) del que carece el token, y la CLI lo muestra una vez, en stderr, como una advertencia. Reemplaza dicho token por uno creado con `--can billing` antes de la próxima versión, cuando la facturación comience a rechazarlo.

Por debajo, un token es una [clave de API personal](/docs/backend/api-keys/#personal-keys) en el plano de control. Cada capacidad se traduce en algunos [alcances (scopes)](/docs/backend/roles-and-scopes/): `deploy` en `shop` contiene `project:deploy:<id>`, con el ID del proyecto, además de los alcances de datos y funciones que invocan los comandos de despliegue. Una capacidad de organización contiene `org:billing:<id>`, `org:audit:<id>` u `org:notifications:<id>`, con el ID de la organización. El token nunca tiene más permisos de los que tiene tu cuenta en el momento en que se utiliza, por lo que pierde cualquier permiso que pierda tu cuenta.

Dos cosas permanecen exclusivamente para una persona con sesión iniciada:

- **Gestión de tokens.** `rebase cloud tokens list`, `create` y `revoke <id>` requieren tu sesión de `rebase cloud login`. Un token no puede listar, crear ni revocar tokens, ya que un token que pudiera generar tokens podría generar su propio sucesor.
- **Restauración.** Ninguna capacidad otorga la restauración de copias de seguridad o un `restore` y `cutover` en un punto en el tiempo. Sobrescribir una base de datos en producción con datos antiguos queda reservado para un propietario o administrador con sesión iniciada.

`rebase cloud whoami` con un token configurado muestra lo que puede hacer y sobre qué proyecto u organización. La pantalla **Access tokens** de la consola ofrece las mismas capacidades, figurando las de organización en **Organization access**. `rebase cloud tokens revoke <id> --yes` lo revoca de inmediato.

## Un backend sin cuenta

Un agente que ha creado una aplicación puede proporcionarle un backend en vivo antes de que nadie se haya registrado, y entregar a la persona para la que trabaja un enlace para conservarlo:

```bash
rebase cloud init --claim
```

Esto aprovisiona un proyecto en Rebase Cloud, configura `REBASE_BASE_URL` en `.env` con su dirección activa, vincula el directorio y despliega las tablas locales con `rebase cloud deploy --bundle`. Muestra la URL en vivo, la URL del panel de administración y una **URL para reclamar** (**claim URL**). Quien abra la URL de reclamo e inicie sesión podrá mover el proyecto a una de sus organizaciones. El enlace funciona una sola vez. Si nadie reclama el proyecto en un plazo de 72 horas, este se elimina, incluida la base de datos. `rebase cloud claim` vuelve a mostrar la URL de reclamo junto con el tiempo restante, y `--open` la abre. La herramienta `rebase_cloud_provision` del servidor MCP ejecuta el mismo comando y devuelve las mismas URL; sus otras herramientas de nube pueden entonces verificar, desplegar, leer registros, configurar variables y revertir el proyecto sin necesidad de iniciar sesión (consulta [MCP server](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` en `.env` es también hacia donde `rebase api-keys`, `rebase storage` y `rebase auth reset-password` envían la clave de servicio local, por lo que después de `init --claim` se dirigen al proyecto en la nube, el cual no acepta esa clave. Mostrarán un aviso al hacerlo; define `REBASE_BASE_URL` en la terminal para comunicarte con un backend local en su lugar.

Hasta que el proyecto sea reclamado, no pertenece a ninguna cuenta. Su token está acotado exclusivamente a ese proyecto: despliega, lee registros y métricas, define variables de entorno y ejecuta `db info`. No puede leer ningún dato secreto: ni el valor de una variable (incluida la clave de servicio) ni la contraseña de la base de datos, y tampoco puede abrir `db connect` ni una vista previa. Se almacena en `~/.rebase/credentials.json`, nunca en el repositorio, y los comandos de `rebase cloud` en el directorio vinculado lo utilizan automáticamente. Si `REBASE_TOKEN` está configurado, prevalecerá siempre que posea un alcance sobre ese proyecto, y dichos comandos advertirán de ello; si no tiene ninguno (un token de CI generado para otros proyectos), se utilizará el token propio del proyecto y el primer comando lo notificará. Un comando al que se le pase `--project` para otro proyecto conservará `REBASE_TOKEN`, y el despliegue que ejecuta `init --claim` siempre utiliza el token propio del proyecto. Este expira junto con el proyecto. `rebase cloud whoami` en ese directorio muestra el proyecto, lo que el token puede hacer, la URL de reclamo y la fecha de expiración del proyecto. Un comando que requiera la sesión de una persona fallará con `session_required` manteniendo el token; solo se descarta una vez que el plano de control lo rechaza por completo, tras reclamarse o expirar, mostrando la URL de reclamo al descartarlo. `rebase cloud status` también muestra la URL de reclamo y la expiración (`unclaimed` en `--json`). `rebase cloud unlink` no elimina un proyecto no reclamado: advierte que el proyecto sigue ejecutándose hasta que expire y muestra la URL de reclamo, y ejecutar `init --claim` en un directorio que ya está vinculado a uno apuntará a su URL de reclamo en lugar de aprovisionar un segundo proyecto. Hasta que se reclame, la aplicación solo se conecta a internet por los puertos 80 y 443; los puertos de correo que tienen todos los demás proyectos (465, 587 y 993) se abren una vez que el proyecto es reclamado.

Una vez que el despliegue ha compilado la aplicación, el comando también establece `REBASE_API_TOKEN` en `.env`: una clave generada en la propia aplicación, que es la que le envían el servidor MCP y el SDK. Si ya existe un `REBASE_API_TOKEN` en `.env`, se conserva y no se genera uno nuevo, y cualquier `.env` creado por el comando solo puede ser leído por ti. Lee y escribe datos (`data:read`, `data:write`) a través de la seguridad a nivel de fila (row-level security) de la aplicación, como un llamador que no es ni una persona ni un administrador. No tiene acceso al plano de administración y expira junto con la ventana de reclamo, a menos que el proyecto se reclame antes. Con `--no-deploy`, o si ese primer despliegue falla, aún no habrá clave: el siguiente `rebase cloud deploy` que tenga éxito en el directorio solicitará una, siempre y cuando el proyecto no haya sido reclamado y `.env` no defina ya un `REBASE_API_TOKEN`. `init`, `deploy`, `status` y `whoami` imprimen su fecha de expiración.

El reclamo transfiere la clave: reclamar el proyecto elimina su fecha de expiración, de modo que el `.env` de la aplicación sigue funcionando. Dado que el agente aún conserva una copia, la persona que reclamó el proyecto puede reemplazarla. `rebase cloud app-key rotate`, o **Rotate app key** en Settings del proyecto, genera una nueva clave y revoca de inmediato todas las claves anteriores del agente. Escribe la nueva clave en un `.env` que ya defina `REBASE_API_TOKEN`, o la muestra una sola vez. Los propietarios y administradores pueden rotarla iniciando sesión. Una clave que no pudo transferirse conserva su fecha de expiración, lo que ocurre si la aplicación no se desplegó o no respondía en el momento del reclamo. La rotación la reemplaza por una que no caduca.

Reclamar también reemplaza la `REBASE_SERVICE_KEY` del proyecto, que tiene permisos de administrador en la propia API de la aplicación y que el código desplegado por el agente podría leer. La aplicación se reinicia una vez con una nueva clave, y todo lo que el agente haya conservado deja de funcionar tan pronto finaliza ese reinicio. Si hay un despliegue en ejecución en el momento del reclamo, el siguiente despliegue llevará la nueva clave.

El reclamo requiere una sesión iniciada en el navegador, no un token, y un método de pago en la organización a la que se traslada el proyecto. A partir del reclamo, el proyecto se factura como cualquier otro. Reclamar también revoca el token del agente: inicia sesión con `rebase cloud login` o genera un nuevo token con `rebase cloud tokens create`.

El aprovisionamiento sin cuenta está limitado por dirección, por red (una IPv4 /24) y en total, y un plano de control que no lo tenga habilitado lo rechazará con un mensaje indicándolo. El uso anterior al reclamo no se factura a quien reclame el proyecto.
