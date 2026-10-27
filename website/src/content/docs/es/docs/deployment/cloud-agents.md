---
sourceHash: 582293a88fb2d626
title: CI, agentes y backends reclamables
sidebar_label: CI y agentes
description: Despliega en Rebase Cloud desde CI o un agente con un token acotado en lugar de una contraseña, y deja que un agente aprovisione un backend en vivo sin cuenta que una persona reclama después.
---

Un proyecto de [Rebase Cloud](/docs/deployment/cloud/) no necesita a una persona ante una
terminal para desplegar. Un job de CI o un agente actúa con un token acotado a unas pocas
acciones sobre un proyecto, y un agente puede crear un proyecto antes de que nadie tenga una
cuenta, y luego entregar un enlace para reclamarlo.


## CI y agentes

Un job de CI o un agente no debería llevar tu contraseña. Dale en su lugar un token:
una clave que actúa como tu cuenta, acotada a unas pocas acciones sobre un
proyecto. Créalo desde una terminal con sesión iniciada:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

El token se imprime una sola vez, como una línea `export REBASE_TOKEN=rk_live_…`. Con
`REBASE_TOKEN` definido, cada comando `rebase cloud` se autentica con él en lugar de con
tu inicio de sesión, y nunca lee ni escribe la sesión almacenada. En GitHub Actions,
guárdalo como un secreto del repositorio y expónlo con ese nombre:

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

| Capacidad | Qué puede hacer el token |
|---|---|
| `deploy` | Desplegar el proyecto y seguir sus builds: `deploy` (incluido `--preview`), `deployments`, `previews` |
| `logs` | Leer los logs de build y de runtime, el historial de cron, las métricas en vivo y el uso: `logs`, `cron`, `metrics`, `usage` |
| `env` | Leer y cambiar las variables de entorno, secretos incluidos, y las de las previsualizaciones (`--preview`) |
| `database` | `db list`, `db info` y `db connect`, que incluye la contraseña de la base de datos |
| `backups` | Listar, crear, inspeccionar y descargar copias de seguridad, y leer la ventana de recuperación a un punto en el tiempo |

<span class="since-badge" data-since="0.26">Desde 0.26</span> Tres capacidades más actúan sobre una organización en lugar de sobre un proyecto. Un token
tiene una únicamente cuando `--can` la nombra, sobre la organización que nombra `--org` (o,
sin `--org`, la organización del proyecto, y luego la seleccionada con
`rebase cloud use`). Un token puede tener estas y ninguna capacidad de proyecto:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capacidad | Qué puede hacer el token |
|---|---|
| `billing` | Leer la tarjeta registrada, las facturas y la próxima factura, y cambiar el correo de facturación: `billing`, `billing invoices`, `billing upcoming`. Solo propietarios y administradores |
| `audit` | Leer el registro de actividad de la organización: `activity`. Solo propietarios y administradores |
| `notifications` | Cambiar las opciones de correo del propio propietario del token, y los webhooks de notificaciones de los proyectos de la organización: `notifications`. Añadir, cambiar y eliminar un webhook sigue requiriendo el rol de propietario o administrador |

Un token creado antes de que existiera
`billing` sigue leyendo la facturación durante una versión. Cada una de esas respuestas
lleva una cabecera `Deprecation: true` y una frase que nombra el alcance que le falta
al token, y la CLI la imprime una vez, por stderr, como advertencia. Sustituye ese token
por uno creado con `--can billing` antes de la próxima versión, cuando la facturación
empiece a rechazarlo.

Por debajo, un token es una [clave de API personal](/docs/backend/api-keys/#personal-keys)
en el plano de control. Cada capacidad se convierte en unos pocos
[alcances](/docs/backend/roles-and-scopes/): `deploy` en `shop` tiene
`project:deploy:<id>`, con el id del proyecto, más los alcances de datos y de funciones
que llaman los comandos de despliegue. Una capacidad de organización tiene `org:billing:<id>`,
`org:audit:<id>` u `org:notifications:<id>`, con el id de la organización. El token nunca tiene más de lo que tiene tu cuenta en el momento
en que se usa, así que pierde lo que pierda tu cuenta.

Dos cosas quedan en manos de una persona con sesión iniciada:

- **Gestionar tokens.** `rebase cloud tokens list`, `create` y `revoke <id>` requieren
  tu sesión de `rebase cloud login`. Un token no puede listar, crear ni revocar
  tokens, porque un token que pudiera acuñar tokens podría acuñar a su propio sucesor.
- **Restaurar.** Ninguna capacidad concede una restauración de copia de seguridad ni un
  `restore` y `cutover` a un punto en el tiempo. Poner datos antiguos sobre una base de datos en vivo queda en manos de un
  propietario o administrador con sesión iniciada.

`rebase cloud whoami` con un token definido muestra qué puede hacer, y sobre qué
proyecto u organización. La pantalla **Access tokens** de la consola ofrece las mismas
capacidades, las de organización bajo **Organization access**. `rebase cloud tokens revoke <id> --yes` lo detiene al instante.

## Un backend sin cuenta

<span class="since-badge" data-since="0.26">Desde 0.26</span>

Un agente que ha construido una app puede darle un backend en vivo antes de que nadie
se haya registrado, y entregar a la persona para la que trabaja un enlace para quedárselo:

```bash
rebase cloud init --claim
```

Eso aprovisiona un proyecto en Rebase Cloud, define `REBASE_BASE_URL` en `.env` con
su dirección en vivo, vincula el directorio y despliega las colecciones locales con
`rebase cloud deploy --bundle`. Imprime la URL en vivo, la URL del panel de administración y una
**URL de reclamación**. Quien abra la URL de reclamación e inicie sesión puede mover el proyecto a
una de sus organizaciones. El enlace funciona una sola vez. Un proyecto que nadie reclama en
72 horas se elimina, base de datos incluida. `rebase cloud claim` vuelve a imprimir la URL
de reclamación con el tiempo que queda, y `--open` la abre. La herramienta
`rebase_cloud_provision` del servidor MCP ejecuta el mismo comando y devuelve las mismas URLs;
sus otras herramientas de cloud comprueban, despliegan, leen logs, definen variables y revierten
el proyecto sin un inicio de sesión (consulta [Servidor MCP](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` en `.env` es también adonde `rebase api-keys`, `rebase storage`
y `rebase auth reset-password` envían la clave de servicio local, así que tras `init --claim`
van al proyecto de cloud, que no acepta esa clave. Lo avisan cuando ocurre;
define `REBASE_BASE_URL` en el shell para llegar a un backend local
en su lugar.

Hasta que se reclama, el proyecto no pertenece a ninguna cuenta. Su token está acotado a
ese único proyecto: despliega, lee logs y métricas, define variables de entorno
y ejecuta `db info`. No devuelve nada secreto: ni el valor de una variable (la clave de servicio
incluida), ni la contraseña de la base de datos, y no puede abrir
`db connect` ni una previsualización. Se guarda en
`~/.rebase/credentials.json`, nunca en el repositorio, y los comandos `rebase cloud`
del directorio vinculado lo usan por su cuenta. `REBASE_TOKEN`, cuando está definido,
sigue prevaleciendo si tiene un alcance sobre ese proyecto, y esos comandos avisan de que
lo hizo; cuando no tiene ninguno (un token de CI hecho para otros proyectos), se usa el token propio del proyecto
y el primer comando lo dice. Un comando al que se le pasa `--project` para
otro proyecto conserva `REBASE_TOKEN`, y el despliegue que ejecuta `init --claim`
usa siempre el token propio del proyecto. Caduca con el proyecto. `rebase cloud whoami` en ese directorio muestra el proyecto, lo que puede hacer el
token, la URL de reclamación y cuándo caduca el proyecto. Un comando que necesita la
sesión de una persona se rechaza con `session_required` y conserva el token; solo se
olvida cuando el plano de control lo rechaza en todas partes, tras una reclamación o al
caducar, y la URL de reclamación se imprime en ese momento. `rebase cloud status` muestra
la URL de reclamación y la caducidad también (`unclaimed` en `--json`). `rebase cloud unlink`
no elimina un proyecto sin reclamar: avisa de que el proyecto sigue funcionando
hasta que caduca e imprime la URL de reclamación, y `init --claim` en un directorio
que ya está vinculado a uno apunta a su URL de reclamación en lugar de aprovisionar un
segundo. Hasta la reclamación, la app llega a internet solo por los puertos 80 y 443;
los puertos de correo que tiene todo otro proyecto (465, 587 y 993) se abren cuando se reclama
el proyecto.

Una vez que el despliegue ha construido la app, el comando también define `REBASE_API_TOKEN` en
`.env`: una clave acuñada en la propia app, que es lo que le envían el servidor MCP y el SDK.
Un `REBASE_API_TOKEN` que ya esté en `.env` se conserva y no se acuña ninguno,
y un `.env` que crea el comando es legible solo por ti. Lee y escribe datos (`data:read`, `data:write`) a través de la
seguridad a nivel de fila de la app, como un llamante que no es ni una persona ni un administrador. No
tiene nada del plano de administración, y caduca con la ventana de reclamación a menos que el
proyecto se reclame antes. Con `--no-deploy`, o cuando ese primer despliegue falla,
todavía no hay clave: el siguiente `rebase cloud deploy` que tenga éxito en el
directorio pide una, siempre que el proyecto siga sin reclamar y `.env` no defina ya
un `REBASE_API_TOKEN`. `init`, `deploy`, `status` y `whoami` imprimen la
fecha en que caduca.

Reclamar entrega la clave: la reclamación le quita la caducidad, así que el `.env` de la app
sigue funcionando. El agente conserva aun así una copia, por lo que la persona que reclamó el
proyecto puede sustituirla. `rebase cloud app-key rotate`, o **Rotate app key** en
la sección Settings del proyecto, acuña una clave nueva y revoca de inmediato todas las claves
anteriores del agente. Escribe la nueva clave en un `.env` que ya define `REBASE_API_TOKEN`,
o la muestra una sola vez. La rotan los propietarios y administradores, con sesión iniciada. Una clave que no se pudo
entregar conserva su caducidad, lo que ocurre cuando la app no estaba desplegada o
no respondía en el momento de la reclamación. Rotarla la sustituye por una que no caduca.

Reclamar también sustituye el `REBASE_SERVICE_KEY` del proyecto, que es de administrador en
la propia API de la app y que el código desplegado por el agente podía leer. La app
se reinicia una vez con una clave nueva, y todo lo que el agente conservó deja de funcionar cuando
ese reinicio ha terminado. Si hay un despliegue en curso en el momento de la reclamación,
el siguiente despliegue lleva la clave nueva.

Reclamar requiere una sesión de navegador con sesión iniciada, no un token, y un método de pago en
la organización a la que se traslada el proyecto. Desde la reclamación en adelante, el proyecto se
factura como cualquier otro. Reclamar también revoca el token del agente: inicia sesión con
`rebase cloud login`, o acuña un token nuevo con `rebase cloud tokens create`.

El aprovisionamiento sin cuenta está limitado por dirección, por red (un /24 de IPv4) y en total,
y un plano de control que no lo ha activado lo rechaza con un mensaje que lo indica. El uso anterior a la reclamación no se factura a quien
reclama el proyecto.
