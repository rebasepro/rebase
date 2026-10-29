---
sourceHash: bf0e0428a86e411f
title: Notificaciones de Cloud
sidebar_label: Notificaciones
description: Cómo Rebase Cloud avisa a las personas cuando falla un despliegue, se detienen las copias de seguridad, se rechaza un pago o el uso supera el 80 % — webhooks firmados a Slack, Discord o cualquier URL, y correo por persona.
---

La plataforma avisa a las personas cuando falla un despliegue, una base de datos deja de
respaldarse, se rechaza un pago, o un proyecto supera el 80 % y luego el 100 % de su
asignación del mes.
Es parte de [Rebase Cloud](/docs/deployment/cloud/), y cada comando de aquí está
en la [referencia de cloud de la CLI](/docs/cli/cloud/).

## Webhooks

Un proyecto puede enviar estos eventos a un webhook entrante de Slack o Discord,
o a cualquier URL https, desde **Settings → Notifications** en la consola
o con la CLI:

```bash
rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX
rebase cloud notifications add https://ops.example.com/rebase --events deploy.failed,backup.unhealthy
rebase cloud notifications test <id>
rebase cloud notifications            # each destination, and how its last delivery went
rebase cloud notifications remove <id>
```

Los eventos son `deploy.failed` (el valor por defecto), `deploy.succeeded`,
`deploy.rolled_back`, `backup.unhealthy`, `billing.payment_failed`,
`usage.threshold` y `preview.paused` (se detuvo una previsualización de backend cuya
base de datos creció por encima del límite de previsualización). Cada POST es JSON con un `type`, el `project`, los datos del
evento, una `url` de la consola y un `text` de una línea. Slack muestra el `text` como
mensaje, así que la URL de un webhook entrante de Slack funciona sin ninguna configuración. Para Discord,
añade `/slack` al final de la URL de su webhook. `--format slack` envía solo `{ "text" }`,
para un receptor que rechaza los campos que no conoce. Un log de build nunca
va en un webhook.

Cada POST va firmado: `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw
body>`, con el secreto mostrado una sola vez cuando se añade el destino. También
lleva `X-Webhook-Event` y un id `X-Webhook-Delivery` que se mantiene igual
a lo largo de los reintentos de una misma entrega. Una entrega se intenta tres veces, con 1 y 5
segundos de separación y 5 segundos por intento. Un 4xx distinto de 429, una redirección o una dirección
rechazada no se reintenta. La URL debe ser https. El plano de control rechaza una que resuelva a
una dirección privada, de loopback, link-local o de metadatos de la nube, tanto cuando se
añade como en la dirección a la que se conecta cada entrega. Cualquier miembro de la
organización puede listar los destinos de un proyecto, con sus URLs enmascaradas.
Añadir, probar y eliminar uno requiere el rol de propietario o administrador.

## Correo electrónico

Cada miembro elige qué correos recibe, por organización, en
**Account → Notifications** de la consola. Los fallos están activados por defecto: un
despliegue fallido va a quien lo inició y a los propietarios y administradores. Un
despliegue correcto está desactivado por defecto, y cuando se activa va solo a quien lo
inició. Un pago rechazado va a los propietarios y al correo de facturación, una vez por
factura. Una copia de seguridad rota va a los propietarios y administradores como máximo una vez al día por
base de datos. Cada marca de uso se envía una vez al mes por proyecto. Un plano de control
sin correo saliente configurado no envía ningún correo, y esa página lo dice.
Los webhooks funcionan en cualquier caso.

Cada evento llega una sola vez a cada persona o destino, por muchas veces que se informe. No se informa de un
despliegue cancelado por una persona ni de una actualización de la plataforma que tuvo éxito.

`rebase cloud webhooks` está retirado. Nunca entregó nada, y ahora cada
acción termina con salida 1 y el código `command_retired`. Para recibir un POST cuando cambian filas
en las tablas de tu propia app, usa un `WebhookDispatcher` en el código de tu app (consulta
[la receta de webhooks](/docs/recipes/webhooks/)).
