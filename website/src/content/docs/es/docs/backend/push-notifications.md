---
sourceHash: 1decbd73d73d8d9b
title: Notificaciones push
sidebar_label: Notificaciones push
description: Web Push para los navegadores de tus usuarios — Chrome, Firefox, Edge y Safari en iPhone, iPad y Mac — enviado desde funciones y tareas cron con rebase.push.
---

## Visión general

Web Push coloca una notificación en la pantalla de bloqueo o en el escritorio de un usuario
mientras tu aplicación está cerrada. Rebase se encarga del lado del servidor: almacena la
suscripción de cada navegador, firma los mensajes con tus claves VAPID, los cifra para que solo
ese navegador pueda leerlos y elimina los navegadores que hayan cancelado la suscripción.

Funciona en todos los navegadores compatibles con la API Push: Chrome y Android, Firefox,
Edge y Safari en macOS, iPadOS e iOS. En iOS y iPadOS, la aplicación web debe
agregarse primero a la pantalla de inicio.

Requiere tres piezas:

1. El servidor activa push y dispone de un par de claves.
2. El navegador registra un service worker y se suscribe a través del SDK.
3. El código de tu servidor realiza el envío mediante `rebase.push`.

## Activación

Push está desactivado hasta que lo habilites.

:::note[Dónde va esto]
**Runtime gestionado** — `REBASE_PUSH=true` en `.env`.

**Ejected** — `push: true` en `initializeRebaseBackend({ … })`.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    // …
    push: true
});
```

Esto crea la tabla `rebase.push_subscriptions` al arrancar y monta las
rutas bajo `/api/push`.

### Claves

Un navegador se suscribe con la clave pública de tu servidor y solo acepta mensajes
firmados con la clave privada correspondiente. Configura el par y una dirección de contacto en la
que los servicios push puedan comunicarse contigo:

```bash
REBASE_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
REBASE_VAPID_PRIVATE_KEY=UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
REBASE_VAPID_SUBJECT=mailto:ops@example.com
```

Genera un par una sola vez con `npx web-push generate-vapid-keys` y consérvalo. Si
cambias las claves, todas las suscripciones existentes dejarán de recibir mensajes; cada
navegador tendrá que suscribirse de nuevo, lo cual hace `client.push.subscribe()` por sí
mismo la próxima vez que se ejecute.

`REBASE_VAPID_SUBJECT` es una dirección `mailto:` o una URL `https://`. Apple rechaza
los mensajes que no incluyan una válida. Si no está configurado, se utilizará el origen de `REBASE_PUBLIC_URL`
cuando este sea `https`.

**En desarrollo** puedes omitir todo esto. Si no hay claves configuradas, el servidor
genera un par, lo guarda en `.rebase-dev-secrets.json` para que las suscripciones sobrevivan
a un reinicio y registra una línea en el log indicándolo. **En producción** no se genera nada.
Push permanece desactivado, el registro de arranque indica los nombres de las variables que se deben configurar, `/api/push/*` responde
`503 PUSH_NOT_CONFIGURED` y cada envío arroja el mismo mensaje de error.

## En el navegador

### El service worker

El navegador entrega un mensaje push a tu service worker, el cual decide qué
mostrar. Coloca este archivo en la raíz de tu sitio, como `public/sw.js` en una
aplicación Vite:

```javascript no-verify
// sw.js — shows what the server sent, and opens its url when tapped.
self.addEventListener("push", (event) => {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(self.registration.showNotification(data.title ?? "", {
        body: data.body,
        icon: data.icon ?? "/icon-192.png",
        tag: data.tag,
        data: { url: data.url ?? "/" }
    }));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
```

La carga útil (payload) es cualquier cosa que tu servidor haya enviado. Este worker lee `title`, `body`,
`icon`, `tag` y `url`. Muestra una notificación por cada push: los navegadores pueden revocar
el permiso a un sitio que recibe mensajes push pero no muestra nada.

### Suscripción

Con un usuario que haya iniciado sesión, registra el worker y suscríbete. Llama a `subscribe()` a partir de
un clic, ya que Safari solo solicita permisos dentro de un gesto de usuario:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await navigator.serviceWorker.register("/sw.js");

async function turnOnNotifications() {
    if (!client.push.isSupported()) return;
    const { id } = await client.push.subscribe({ lang: "es" });
    console.log("this browser is subscription", id);
}
```

`subscribe()` solicita permiso, obtiene la clave pública del servidor, suscribe
al navegador y lo registra bajo el usuario autenticado. `lang` es opcional y
su valor predeterminado es `navigator.language`. El servidor te lo devolverá cuando redacte
el mensaje de cada navegador. Llamarlo de nuevo es seguro: actualiza la misma
suscripción y reemplaza una que haya sido creada con una clave antigua.

Arroja un `RebaseClientError` con uno de los siguientes códigos:

| Código | Significado |
|------|---------|
| `PUSH_UNSUPPORTED` | El navegador no dispone de la API Push. `isSupported()` te informa con antelación. |
| `PUSH_PERMISSION_DENIED` | El usuario bloqueó las notificaciones para el sitio. Solo la configuración del sitio en el navegador puede revertirlo. |
| `PUSH_NO_SERVICE_WORKER` | No hay ningún service worker registrado y no se pasó ninguno como `registration`. |
| `PUSH_NOT_CONFIGURED` | Desde el servidor: push está desactivado allí o no tiene claves. |

Para detener las notificaciones en este navegador:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await client.push.unsubscribe();
const subscription = await client.push.getSubscription(); // ahora es null
```

## Envío

`rebase.push` está disponible en funciones, tareas cron, hooks de tablas y gestores
de trabajos (job handlers), al igual que `rebase.email`.

```typescript
import { defineCron, rebase } from "@rebasepro/server";

export default defineCron({
    schedule: "0 9 * * *",
    name: "Morning nudge",
    async handler() {
        const result = await rebase.push.sendToUser("user-123", {
            title: "Your daily puzzle is ready",
            body: "Tap to play",
            url: "/daily"
        }, { tag: "daily", ttl: 4 * 60 * 60 });
        return `sent ${result.sent}, removed ${result.removed}, failed ${result.failed}`;
    }
});
```

`sendToUser` envía a cada navegador en el que el usuario haya activado las notificaciones.
`sendToSubscriptions(ids, payload, options)` envía a los navegadores especificados por
el id de suscripción. Ambos devuelven una promesa que resuelve con lo ocurrido:

| Campo | Significado |
|-------|---------|
| `sent` | Aceptado por el servicio push del navegador. |
| `removed` | El servicio push respondió 404 o 410: el navegador canceló la suscripción o esta expiró. Su fila se elimina. |
| `failed` | Cualquier otra causa: un límite de tasa (rate limit), un error del servicio push, la red. La fila se conserva y el fallo se registra. |

Un envío se resuelve una vez que cada servicio push ha respondido, así que usa `await` cuando
el resultado sea importante, o pásalo a `waitUntil` en una función para responder primero
a la solicitud.

### Un mensaje en el idioma de cada navegador

Pasa una función en lugar de un objeto y se llamará una vez por cada navegador con
esa suscripción:

```typescript
import { rebase } from "@rebasepro/server";

const words: Record<string, { title: string; body: string }> = {
    en: { title: "Ada is asking you to a game", body: "Tap to join" },
    es: { title: "Ada te invita a una partida", body: "Toca para unirte" }
};

await rebase.push.sendToUser("user-123", (subscription) => ({
    ...(words[subscription.lang ?? "en"] ?? words.en),
    url: "/join?room=ABCD"
}), { urgency: "high", ttl: 30 * 60, topic: "invite-ada", tag: "invite-ada" });
```

### Opciones

| Opción | Valor por defecto | Significado |
|--------|---------|---------|
| `ttl` | `86400` | Segundos que el servicio push sigue intentando comunicarse con un navegador que está desconectado. `0`: ahora o nunca. Como máximo cuatro semanas. |
| `urgency` | `"normal"` | `"very-low"`, `"low"`, `"normal"` o `"high"`. Los teléfonos en modo de ahorro de batería pueden retrasar cualquier notificación por debajo de `high`. |
| `topic` | — | Un mensaje más nuevo con el mismo tema reemplaza a uno que el servicio push aún no haya entregado. Hasta 32 caracteres de `A-Z a-z 0-9 - _`. |
| `tag` | — | Se agrega al payload como `tag`. El service worker anterior lo pasa a `showNotification`, de modo que una notificación más reciente reemplaza a una más antigua con la misma etiqueta en el dispositivo. |

Un payload tiene un tamaño máximo de 3993 bytes como JSON, el límite de Web Push. Uno más grande arrojará un error
antes de enviar nada, al igual que una opción no válida.

### Quién tiene las notificaciones activadas

```typescript
import { rebase } from "@rebasepro/server";

const browsers = await rebase.push.subscriptionsOf("user-123");
// [{ id, userId, endpointHost: "web.push.apple.com", lang: "es", createdAt, lastSentAt }]
```

`endpointHost` indica de qué navegador se trata: `fcm.googleapis.com` para Chrome y
Android, `updates.push.services.mozilla.com` para Firefox, `*.push.apple.com` para
Safari, `*.notify.windows.com` para Edge.

`rebase.push.isConfigured()` devuelve `false` cuando push está desactivado o no tiene claves. Compruébalo
antes de enviar si tu código puede continuar sin notificaciones push.

## Tus propios datos por navegador

Rebase almacena lo necesario para entregar un mensaje y nada más. Para tus propios
ajustes por navegador, como una hora para un recordatorio, mantén una tabla indexada por el
id de suscripción. `subscribe()` devuelve ese id en el navegador y
`subscriptionsOf()` lo devuelve en el servidor.

```typescript
// backend/schema/reminder-settings.ts
import { col, defineTable } from "@rebasepro/server/schema";

export const reminderSettings = defineTable("reminder_settings", {
    columns: {
        // the subscription id, from client.push.subscribe() or rebase.push.subscriptionsOf()
        id: col.text().primaryKey(),
        userId: col.text().notNull(),
        remindAt: col.integer().validate({ min: 0, max: 23 })
    },
    rls: [{ operations: ["select", "insert", "update", "delete"], ownerField: "userId" }],
    indexes: [{ columns: ["remindAt"], reason: "the browsers due a reminder, every hour" }]
});
```

Una tarea cron cada hora lee entonces las filas programadas para esa hora y envía exactamente a esos
navegadores:

```typescript
import { defineCron, rebase } from "@rebasepro/server";

export default defineCron({
    schedule: "0 * * * *",
    name: "Reminders",
    async handler(ctx) {
        const hour = (ctx.scheduledAt ?? new Date()).getUTCHours();
        const due = await rebase.dataAsAdmin.reminder_settings.findAll({ where: { remindAt: ["==", hour] } });
        const result = await rebase.push.sendToSubscriptions(due.map((row) => String(row.id)), { title: "Time to play" });
        return `sent ${result.sent}`;
    }
});
```

Cuando un navegador cancela la suscripción o su servicio push la descarta, su fila en
`rebase.push_subscriptions` se elimina, y `sendToSubscriptions` omite cualquier id que
ya no exista. Tu propia fila permanece hasta que la elimines. Compáralo con
`subscriptionsOf(userId)` cuando hagas limpieza.

## Rutas

Las tres necesitan un usuario que haya iniciado sesión. Las claves de API y la service key son rechazadas con
`403 PUSH_NEEDS_A_USER`, porque una suscripción pertenece al navegador de una persona. El SDK
las llama por ti.

| Ruta | Cuerpo | Respuesta |
|-------|------|--------|
| `GET /api/push/key` | — | `{ key }`: la clave pública VAPID |
| `POST /api/push/subscriptions` | `{ subscription, lang? }`, donde `subscription` es `PushSubscription.toJSON()` | `{ id }` |
| `DELETE /api/push/subscriptions` | `{ endpoint }` | `{ removed }`: `false` cuando el emisor de la llamada no tenía tal navegador |

Una suscripción se almacena bajo el emisor de la llamada. Si un navegador que estaba suscrito
bajo una cuenta se suscribe bajo otra, se traslada a la nueva cuenta.
Cancelar la suscripción solo elimina el navegador propio del emisor.

El servidor envía una petición POST a la dirección de cada suscripción cada vez que realiza un envío, por lo que
solo acepta los servicios push que utilizan los navegadores: `fcm.googleapis.com`,
`android.googleapis.com`, `updates.push.services.mozilla.com`,
`web.push.apple.com`, `*.push.apple.com` y `*.notify.windows.com`, sobre
`https` en el puerto predeterminado. Cualquier otro endpoint es rechazado con
`400 PUSH_ENDPOINT_REFUSED`, de modo que un cliente no puede obligar a tu servidor a enviar peticiones a
una dirección interna. Para permitir otro servicio push, por ejemplo un doble de prueba local,
inclúyelo en `push.allowedHosts`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    push: { allowedHosts: ["127.0.0.1:8443"] }
});
```

## La tabla

`rebase.push_subscriptions` tiene una fila por navegador: `id` (un hash del
endpoint), `user_id`, `endpoint`, las claves `p256dh` y `auth` del navegador, `lang`,
`user_agent`, `created_at`, `updated_at` y `last_sent_at`.

El servidor escribe en ella. La seguridad a nivel de fila (RLS) limita a los roles de la petición para leer y
eliminar únicamente sus propias filas (`user_id = rebase.uid()`), por lo que el
[SQL ejecutado como el emisor](/docs/backend/scripts/) ve los navegadores de ese usuario y los de nadie
más, y no puede insertar.

## Envío a través de otro servicio

La entrega se realiza a través de un `PushSender`: un mensaje, a un navegador, respondido con
el estado del servicio push. El remitente integrado firma, cifra y envía con
`fetch`. Para enviar a través de un relay o registrar mensajes en pruebas, pasa el tuyo propio:

```typescript
import { initializeRebaseBackend, type PushSender } from "@rebasepro/server";

const recorded: string[] = [];
const sender: PushSender = {
    async send(target, payload, options) {
        recorded.push(`${target.endpoint} ttl=${options.ttl} ${payload}`);
        return { statusCode: 201 };
    }
};

await initializeRebaseBackend({
    app,
    server,
    push: { sender }
});
```

`createWebPushSender(keys, subject)` de `@rebasepro/server` construye el remitente
integrado, en caso de que desees envolverlo.

## Relacionado

- [Funciones personalizadas](/docs/backend/custom-functions/) y [Tareas Cron](/docs/backend/cron-jobs/): desde donde se llama a `rebase.push`.
- [Trabajos en segundo plano](/docs/backend/jobs/): para enviar desde una cola con reintentos, encola un trabajo cuyo gestor llame a `rebase.push`.
- [Verificación de correo electrónico](/docs/backend/email-verification/): `rebase.email`, el otro canal.
