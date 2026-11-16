---
sourceHash: bcfb0bd417433447
title: Notifications push
sidebar_label: Notifications push
description: Web Push vers les navigateurs de vos utilisateurs — Chrome, Firefox, Edge et Safari sur iPhone, iPad et Mac — envoyé depuis des fonctions et des tâches cron avec rebase.push.
---

## Vue d'ensemble

<span class="since-badge" data-since="0.32">Depuis 0.32</span>

Web Push affiche une notification sur l'écran de verrouillage ou le bureau d'un utilisateur lorsque votre application est fermée. Rebase prend en charge la partie serveur : il stocke l'abonnement de chaque navigateur, signe les messages avec vos clés VAPID, les chiffre afin que seul ce navigateur puisse les lire, et supprime les navigateurs qui se sont désabonnés.

Cela fonctionne dans tous les navigateurs prenant en charge l'API Push : Chrome et Android, Firefox, Edge, et Safari sur macOS, iPadOS et iOS. Sur iOS et iPadOS, l'application web doit d'abord être ajoutée à l'écran d'accueil.

Cela nécessite trois éléments :

1. Le serveur active le push et dispose d'une paire de clés.
2. Le navigateur enregistre un service worker et s'abonne via le SDK.
3. Votre code serveur effectue l'envoi avec `rebase.push`.

## Activation

Le push est désactivé jusqu'à ce que vous l'activiez.

:::note[Où placer ceci]
**Runtime managé** — `REBASE_PUSH=true` dans `.env`.

**Éjecté** — `push: true` sur `initializeRebaseBackend({ … })`.
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

Cela crée la table `rebase.push_subscriptions` au démarrage et monte les routes sous `/api/push`.

### Clés

<span class="since-badge" data-since="0.32">Depuis 0.32</span>

Un navigateur s'abonne avec la clé publique de votre serveur et n'accepte que les messages signés avec la clé privée correspondante. Définissez la paire, ainsi qu'une adresse de contact à laquelle les services de push peuvent vous joindre :

```bash
REBASE_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
REBASE_VAPID_PRIVATE_KEY=UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
REBASE_VAPID_SUBJECT=mailto:ops@example.com
```

Générez une paire une seule fois avec `npx web-push generate-vapid-keys`, et conservez-la. Si vous modifiez les clés, tous les abonnements existants cesseront de recevoir des messages ; chaque navigateur devra se réabonner, ce que `client.push.subscribe()` fait de lui-même lors de sa prochaine exécution.

`REBASE_VAPID_SUBJECT` est une adresse `mailto:` ou une URL `https://`. Apple refuse les messages qui n'en ont pas de valide. S'il n'est pas défini, l'origine de `REBASE_PUBLIC_URL` est utilisée lorsqu'il s'agit d'une URL `https`.

**En développement**, vous pouvez ignorer tout cela. Si aucune clé n'est définie, le serveur en génère une paire, la conserve dans `.rebase-dev-secrets.json` afin que les abonnements survivent à un redémarrage, et consigne une ligne dans les logs pour l'indiquer. **En production**, rien n'est généré. Le push reste désactivé, le log de démarrage indique les variables à définir, `/api/push/*` répond `503 PUSH_NOT_CONFIGURED`, et chaque tentative d'envoi lève la même erreur.

## Dans le navigateur

### Le service worker

Le navigateur transmet un message push à votre service worker, qui décide de ce qu'il faut afficher. Placez ce fichier à la racine de votre site, comme `public/sw.js` dans une application Vite :

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

La charge utile (payload) correspond à ce que votre serveur a envoyé. Ce worker lit `title`, `body`, `icon`, `tag` et `url`. Affichez une notification pour chaque push : les navigateurs peuvent révoquer l'autorisation d'un site qui reçoit des pushs et n'affiche rien.

### Abonnement

Une fois l'utilisateur connecté, enregistrez le worker et abonnez-le. Appelez `subscribe()` lors d'un clic, car Safari ne demande l'autorisation qu'à la suite d'un geste de l'utilisateur :

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

`subscribe()` demande l'autorisation, récupère la clé publique du serveur, abonne le navigateur et l'enregistre au nom de l'utilisateur connecté. `lang` est optionnel et vaut par défaut `navigator.language`. Le serveur vous le transmet lorsqu'il rédige le message de chaque navigateur. L'appeler à nouveau ne pose aucun risque : cela rafraîchit le même abonnement et remplace celui créé avec une ancienne clé.

Elle lève une erreur `RebaseClientError` avec l'un de ces codes :

| Code | Signification |
|------|---------------|
| `PUSH_UNSUPPORTED` | Le navigateur ne dispose pas de l'API Push. `isSupported()` vous l'indique à l'avance. |
| `PUSH_PERMISSION_DENIED` | L'utilisateur a bloqué les notifications pour le site. Seuls les paramètres de site du navigateur peuvent annuler cela. |
| `PUSH_NO_SERVICE_WORKER` | Aucun service worker n'est enregistré, et aucun n'a été transmis en tant que `registration`. |
| `PUSH_NOT_CONFIGURED` | Du serveur : le push y est désactivé ou n'a pas de clés. |

Pour arrêter les notifications sur ce navigateur :

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await client.push.unsubscribe();
const subscription = await client.push.getSubscription(); // null now
```

## Envoi

`rebase.push` est disponible dans les fonctions, les tâches cron, les hooks de table et les gestionnaires de jobs (job handlers), tout comme `rebase.email`.

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

`sendToUser` effectue l'envoi vers tous les navigateurs sur lesquels l'utilisateur a activé les notifications. `sendToSubscriptions(ids, payload, options)` envoie aux navigateurs que vous désignez par leur identifiant d'abonnement. Les deux renvoient un résultat détaillant ce qui s'est passé :

| Champ | Signification |
|-------|---------------|
| `sent` | Accepté par le service de push du navigateur. |
| `removed` | Le service de push a répondu 404 ou 410 : le navigateur s'est désabonné ou l'abonnement a expiré. Sa ligne est supprimée. |
| `failed` | Tout autre cas : limite de débit (rate limit), erreur du service de push, réseau. La ligne est conservée et l'échec consigné dans les logs. |

Un envoi se résout une fois que chaque service de push a répondu ; utilisez donc `await` lorsque le résultat importe, ou transmettez-le à `waitUntil` dans une fonction pour répondre d'abord à la requête.

### Un message dans la langue de chaque navigateur

Passez une fonction au lieu d'un objet, et elle sera appelée une fois par navigateur avec cet abonnement :

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

| Option | Par défaut | Signification |
|--------|------------|---------------|
| `ttl` | `86400` | Nombre de secondes pendant lesquelles le service de push continue d'essayer d'atteindre un navigateur hors ligne. `0` : maintenant ou jamais. Quatre semaines au maximum. |
| `urgency` | `"normal"` | `"very-low"`, `"low"`, `"normal"` ou `"high"`. Les téléphones en mode économie de batterie peuvent bloquer tout ce qui est inférieur à `high`. |
| `topic` | — | Un message plus récent avec le même topic remplace un message que le service de push n'a pas encore distribué. Jusqu'à 32 caractères parmi `A-Z a-z 0-9 - _`. |
| `tag` | — | Ajouté à la charge utile comme `tag`. Le service worker ci-dessus le transmet à `showNotification`, de sorte qu'une notification plus récente remplace une plus ancienne ayant le même tag sur l'appareil. |

Une charge utile ne doit pas dépasser 3993 octets en JSON, ce qui constitue la limite de Web Push. Une charge plus volumineuse lève une erreur avant tout envoi, tout comme une option non valide.

### Qui a activé les notifications

```typescript
import { rebase } from "@rebasepro/server";

const browsers = await rebase.push.subscriptionsOf("user-123");
// [{ id, userId, endpointHost: "web.push.apple.com", lang: "es", createdAt, lastSentAt }]
```

`endpointHost` indique de quel navigateur il s'agit : `fcm.googleapis.com` pour Chrome et Android, `updates.push.services.mozilla.com` pour Firefox, `*.push.apple.com` pour Safari, `*.notify.windows.com` pour Edge.

`rebase.push.isConfigured()` vaut `false` lorsque le push est désactivé ou n'a pas de clés. Vérifiez-le avant d'envoyer si votre code peut continuer à fonctionner sans le push.

## Vos propres données par navigateur

Rebase stocke ce dont il a besoin pour distribuer un message et rien d'autre. Pour vos propres paramètres par navigateur, comme une heure de rappel, conservez une table indexée par l'identifiant d'abonnement. `subscribe()` renvoie cet identifiant dans le navigateur, et `subscriptionsOf()` le renvoie sur le serveur.

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

Une tâche cron horaire lit ensuite les lignes prévues pour cette heure et effectue l'envoi exactement à ces navigateurs :

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

Lorsqu'un navigateur se désabonne ou que son service de push le supprime, sa ligne dans `rebase.push_subscriptions` disparaît, et `sendToSubscriptions` ignore un identifiant qu'il ne possède plus. Votre propre ligne persiste jusqu'à ce que vous la supprimiez. Comparez avec `subscriptionsOf(userId)` lors de vos opérations de nettoyage.

## Routes

Les trois nécessitent un utilisateur connecté. Les clés d'API et la clé de service sont refusées avec `403 PUSH_NEEDS_A_USER`, car un abonnement correspond au navigateur d'une personne. Le SDK les appelle pour vous.

| Route | Corps | Réponse |
|-------|-------|---------|
| `GET /api/push/key` | — | `{ key }` : la clé publique VAPID |
| `POST /api/push/subscriptions` | `{ subscription, lang? }`, où `subscription` correspond à `PushSubscription.toJSON()` | `{ id }` |
| `DELETE /api/push/subscriptions` | `{ endpoint }` | `{ removed }` : `false` lorsque l'appelant ne possédait pas un tel navigateur |

Un abonnement est enregistré sous l'identité de l'appelant. Si un navigateur qui était abonné sous un compte s'abonne sous un autre, il bascule sur le nouveau compte. Le désabonnement ne supprime que le navigateur de l'appelant lui-même.

Le serveur envoie une requête POST à l'adresse de chaque abonnement à chaque émission ; il n'accepte donc que les services de push utilisés par les navigateurs : `fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.push.apple.com` et `*.notify.windows.com`, via `https` sur le port par défaut. Tout autre endpoint est refusé avec `400 PUSH_ENDPOINT_REFUSED`, de sorte qu'un client ne peut pas contraindre votre serveur à envoyer des requêtes vers une adresse interne. Pour autoriser un autre service de push, par exemple une doublure de test locale, indiquez-le dans `push.allowedHosts` :

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    push: { allowedHosts: ["127.0.0.1:8443"] }
});
```

## La table

`rebase.push_subscriptions` comporte une ligne par navigateur : `id` (un hash de l'endpoint), `user_id`, `endpoint`, les clés `p256dh` et `auth` du navigateur, `lang`, `user_agent`, `created_at`, `updated_at` et `last_sent_at`.

Le serveur l'alimente. La sécurité au niveau des lignes (Row-Level Security ou RLS) limite les rôles de requête à la lecture et à la suppression de leurs propres lignes (`user_id = rebase.uid()`), ainsi [le SQL exécuté en tant qu'appelant](/docs/backend/scripts/) voit les navigateurs de cet utilisateur et ceux de personne d'autre, et ne peut rien insérer.

## Envoi via un autre service

La distribution passe par un `PushSender` : un message, vers un navigateur, avec en retour le statut du service de push. L'expéditeur intégré signe, chiffre et envoie par POST avec `fetch`. Pour envoyer via un relais ou enregistrer des messages lors des tests, passez votre propre implémentation :

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

`createWebPushSender(keys, subject)` de `@rebasepro/server` construit l'expéditeur intégré, si vous souhaitez l'encapsuler.

## Voir aussi

- [Fonctions personnalisées](/docs/backend/custom-functions/) et [Tâches Cron](/docs/backend/cron-jobs/) : d'où `rebase.push` est appelé.
- [Tâches en arrière-plan](/docs/backend/jobs/) : pour envoyer depuis une file d'attente avec des nouvelles tentatives (retries), mettez en file d'attente un job dont le gestionnaire appelle `rebase.push`.
- [Vérification d'e-mail](/docs/backend/email-verification/) : `rebase.email`, l'autre canal.
