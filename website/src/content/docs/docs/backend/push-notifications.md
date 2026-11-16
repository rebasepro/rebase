---
title: Push notifications
sidebar_label: Push notifications
description: Web Push to your users' browsers — Chrome, Firefox, Edge and Safari on iPhone, iPad and Mac — sent from functions and cron jobs with rebase.push.
---

## Overview

<span class="since-badge" data-since="0.32">Since 0.32</span>

Web Push puts a notification on a user's lock screen or desktop while your app
is closed. Rebase takes care of the server side: it stores each browser's
subscription, signs messages with your VAPID keys, encrypts them so only that
browser can read them, and removes browsers that unsubscribed.

It works in every browser that supports the Push API: Chrome and Android, Firefox,
Edge, and Safari on macOS, iPadOS and iOS. On iOS and iPadOS the web app must be
added to the Home Screen first.

It takes three pieces:

1. The server switches push on and has a key pair.
2. The browser registers a service worker and subscribes through the SDK.
3. Your server code sends with `rebase.push`.

## Turning it on

Push is off until you turn it on.

:::note[Where this goes]
**Managed runtime** — `REBASE_PUSH=true` in `.env`.

**Ejected** — `push: true` on `initializeRebaseBackend({ … })`.
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

That creates the `rebase.push_subscriptions` table at boot and mounts the
routes under `/api/push`.

### Keys

<span class="since-badge" data-since="0.32">Since 0.32</span>

A browser subscribes with your server's public key and only accepts messages
signed with the matching private key. Set the pair, and a contact address the
push services can reach you at:

```bash
REBASE_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
REBASE_VAPID_PRIVATE_KEY=UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
REBASE_VAPID_SUBJECT=mailto:ops@example.com
```

Generate a pair once with `npx web-push generate-vapid-keys`, and keep it. If you
change the keys, every existing subscription stops receiving messages; each
browser has to subscribe again, which `client.push.subscribe()` does by itself
the next time it runs.

`REBASE_VAPID_SUBJECT` is a `mailto:` address or an `https://` URL. Apple refuses
messages without a valid one. If it is unset, the origin of `REBASE_PUBLIC_URL` is
used when that is `https`.

**In development** you can skip all of this. With no keys set, the server
generates a pair, keeps it in `.rebase-dev-secrets.json` so subscriptions survive
a restart, and logs one line saying so. **In production** nothing is generated.
Push stays off, the boot log names the variables to set, `/api/push/*` answers
`503 PUSH_NOT_CONFIGURED`, and every send throws the same message.

## In the browser

### The service worker

The browser delivers a push message to your service worker, which decides what
to show. Put this file at the root of your site, as `public/sw.js` in a Vite
app:

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

The payload is whatever your server sent. This worker reads `title`, `body`,
`icon`, `tag` and `url`. Show a notification for every push: browsers may revoke
the permission of a site that receives pushes and shows nothing.

### Subscribing

With a signed-in user, register the worker and subscribe. Call `subscribe()` from
a click, because Safari only asks for permission inside a user gesture:

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

`subscribe()` asks for permission, fetches the server's public key, subscribes
the browser and registers it under the signed-in user. `lang` is optional and
defaults to `navigator.language`. The server hands it back to you when it writes
each browser's message. Calling it again is safe: it refreshes the same
subscription, and replaces one made with an old key.

It throws `RebaseClientError` with one of these codes:

| Code | Meaning |
|------|---------|
| `PUSH_UNSUPPORTED` | The browser has no Push API. `isSupported()` tells you in advance. |
| `PUSH_PERMISSION_DENIED` | The user blocked notifications for the site. Only the browser's site settings can undo that. |
| `PUSH_NO_SERVICE_WORKER` | No service worker is registered, and none was passed as `registration`. |
| `PUSH_NOT_CONFIGURED` | From the server: push is off there, or has no keys. |

To stop notifications on this browser:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await client.push.unsubscribe();
const subscription = await client.push.getSubscription(); // null now
```

## Sending

`rebase.push` is there in functions, cron jobs, table hooks and job
handlers, like `rebase.email`.

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

`sendToUser` sends to every browser the user turned notifications on in.
`sendToSubscriptions(ids, payload, options)` sends to the browsers you name by
subscription id. Both resolve with what happened:

| Field | Meaning |
|-------|---------|
| `sent` | Accepted by the browser's push service. |
| `removed` | The push service answered 404 or 410: the browser unsubscribed or the subscription expired. Its row is deleted. |
| `failed` | Anything else: a rate limit, a push service error, the network. The row is kept and the failure logged. |

A send resolves once every push service has answered, so `await` it when the
result matters, or hand it to `waitUntil` in a function to answer the request
first.

### A message in each browser's language

Pass a function instead of an object, and it is called once per browser with
that subscription:

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

### Options

| Option | Default | Meaning |
|--------|---------|---------|
| `ttl` | `86400` | Seconds the push service keeps trying to reach a browser that is offline. `0`: now or never. At most four weeks. |
| `urgency` | `"normal"` | `"very-low"`, `"low"`, `"normal"` or `"high"`. Phones on battery saver may hold back anything below `high`. |
| `topic` | — | A newer message with the same topic replaces one the push service has not delivered yet. Up to 32 characters of `A-Z a-z 0-9 - _`. |
| `tag` | — | Added to the payload as `tag`. The service worker above passes it to `showNotification`, so a newer notification replaces an older one with the same tag on the device. |

A payload is at most 3993 bytes as JSON, Web Push's limit. A larger one throws
before anything is sent, as does an invalid option.

### Who has notifications on

```typescript
import { rebase } from "@rebasepro/server";

const browsers = await rebase.push.subscriptionsOf("user-123");
// [{ id, userId, endpointHost: "web.push.apple.com", lang: "es", createdAt, lastSentAt }]
```

`endpointHost` says which browser it is: `fcm.googleapis.com` for Chrome and
Android, `updates.push.services.mozilla.com` for Firefox, `*.push.apple.com` for
Safari, `*.notify.windows.com` for Edge.

`rebase.push.isConfigured()` is `false` when push is off or has no keys. Check
it before sending if your code can carry on without push.

## Your own data per browser

Rebase stores what it needs to deliver a message and nothing else. For your own
settings per browser, such as a reminder hour, keep a table keyed by the
subscription id. `subscribe()` returns that id in the browser, and
`subscriptionsOf()` returns it on the server.

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

An hourly cron then reads the rows due at this hour and sends to exactly those
browsers:

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

When a browser unsubscribes or its push service drops it, its row in
`rebase.push_subscriptions` goes, and `sendToSubscriptions` skips an id it no
longer has. Your own row stays until you remove it. Compare against
`subscriptionsOf(userId)` when you tidy up.

## Routes

All three need a signed-in user. API keys and the service key are refused with
`403 PUSH_NEEDS_A_USER`, because a subscription is a person's browser. The SDK
calls them for you.

| Route | Body | Answer |
|-------|------|--------|
| `GET /api/push/key` | — | `{ key }`: the VAPID public key |
| `POST /api/push/subscriptions` | `{ subscription, lang? }`, where `subscription` is `PushSubscription.toJSON()` | `{ id }` |
| `DELETE /api/push/subscriptions` | `{ endpoint }` | `{ removed }`: `false` when the caller had no such browser |

A subscription is stored under the caller. If a browser that was subscribed
under one account subscribes under another, it moves to the new account.
Unsubscribing removes only the caller's own browser.

The server posts to the address in each subscription every time it sends, so it
accepts only the push services browsers use: `fcm.googleapis.com`,
`android.googleapis.com`, `updates.push.services.mozilla.com`,
`web.push.apple.com`, `*.push.apple.com` and `*.notify.windows.com`, over
`https` on the default port. Any other endpoint is refused with
`400 PUSH_ENDPOINT_REFUSED`, so a client cannot make your server send requests to
an internal address. To allow another push service, for example a local test
double, list it in `push.allowedHosts`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    push: { allowedHosts: ["127.0.0.1:8443"] }
});
```

## The table

`rebase.push_subscriptions` has one row per browser: `id` (a hash of the
endpoint), `user_id`, `endpoint`, the browser's `p256dh` and `auth` keys, `lang`,
`user_agent`, `created_at`, `updated_at` and `last_sent_at`.

The server writes it. Row-level security limits the request roles to reading and
deleting their own rows (`user_id = rebase.uid()`), so
[SQL run as the caller](/docs/backend/scripts/) sees that user's browsers and no
one else's, and cannot insert.

## Sending through something else

Delivery goes through a `PushSender`: one message, to one browser, answered with
the push service's status. The built-in sender signs, encrypts and posts with
`fetch`. To send through a relay, or record messages in tests, pass your own:

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

`createWebPushSender(keys, subject)` from `@rebasepro/server` builds the built-in
sender, if you want to wrap it.

## Related

- [Custom Functions](/docs/backend/custom-functions/) and [Cron Jobs](/docs/backend/cron-jobs/): where `rebase.push` is called from.
- [Background Jobs](/docs/backend/jobs/): to send from a queue with retries, enqueue a job whose handler calls `rebase.push`.
- [Email verification](/docs/backend/email-verification/): `rebase.email`, the other channel.
