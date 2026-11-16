---
sourceHash: bcfb0bd417433447
title: Push-Benachrichtigungen
sidebar_label: Push-Benachrichtigungen
description: Web Push an die Browser Ihrer Benutzer – Chrome, Firefox, Edge und Safari auf iPhone, iPad und Mac – gesendet aus Funktionen und Cron-Jobs mit rebase.push.
---

## Übersicht

<span class="since-badge" data-since="0.32">Seit 0.32</span>

Web Push zeigt eine Benachrichtigung auf dem Sperrbildschirm oder Desktop eines Benutzers an,
während Ihre App geschlossen ist. Rebase kümmert sich um die Serverseite: Es speichert
das Abonnement jedes Browsers, signiert Nachrichten mit Ihren VAPID-Schlüsseln, verschlüsselt
sie, sodass nur dieser Browser sie lesen kann, und entfernt Browser, die das Abonnement abbestellt haben.

Es funktioniert in jedem Browser, der die Push-API unterstützt: Chrome und Android, Firefox,
Edge sowie Safari unter macOS, iPadOS und iOS. Unter iOS und iPadOS muss die Web-App
zuerst zum Startbildschirm hinzugefügt werden.

Dafür sind drei Schritte erforderlich:

1. Der Server aktiviert Push und verfügt über ein Schlüsselpaar.
2. Der Browser registriert einen Service Worker und abonniert Push-Nachrichten über das SDK.
3. Ihr Servercode sendet Benachrichtigungen mit `rebase.push`.

## Aktivierung

Push ist deaktiviert, bis Sie es einschalten.

:::note[Wo dies konfiguriert wird]
**Verwaltete Laufzeit** — `REBASE_PUSH=true` in der `.env`.

**Ejected** — `push: true` bei `initializeRebaseBackend({ … })`.
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

Dadurch wird die Tabelle `rebase.push_subscriptions` beim Systemstart erstellt und
die Routen unter `/api/push` bereitgestellt.

### Schlüssel

<span class="since-badge" data-since="0.32">Seit 0.32</span>

Ein Browser abonniert Benachrichtigungen mit dem öffentlichen Schlüssel Ihres Servers und akzeptiert nur Nachrichten,
die mit dem passenden privaten Schlüssel signiert sind. Legen Sie das Schlüsselpaar sowie eine Kontaktadresse fest,
über die die Push-Dienste Sie erreichen können:

```bash
REBASE_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
REBASE_VAPID_PRIVATE_KEY=UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
REBASE_VAPID_SUBJECT=mailto:ops@example.com
```

Generieren Sie ein Schlüsselpaar einmalig mit `npx web-push generate-vapid-keys` und bewahren Sie es auf. Wenn Sie
die Schlüssel ändern, empfängt kein bestehendes Abonnement mehr Nachrichten; jeder
Browser muss sich erneut registrieren, was `client.push.subscribe()` beim nächsten
Aufruf automatisch erledigt.

`REBASE_VAPID_SUBJECT` ist eine `mailto:`-Adresse oder eine `https://`-URL. Apple weist
Nachrichten ohne eine gültige Angabe ab. Wenn die Variable nicht gesetzt ist, wird der Origin von `REBASE_PUBLIC_URL`
verwendet, sofern es sich um `https` handelt.

**In der Entwicklungsumgebung** können Sie all dies überspringen. Wenn keine Schlüssel gesetzt sind, generiert
der Server ein Schlüsselpaar, speichert es in `.rebase-dev-secrets.json`, damit Abonnements
einen Neustart überstehen, und gibt eine entsprechende Protokollzeile aus. **In der Produktionsumgebung** wird nichts generiert.
Push bleibt deaktiviert, das Boot-Protokoll nennt die zu setzenden Variablen, `/api/push/*` antwortet
mit `503 PUSH_NOT_CONFIGURED`, und jeder Sendeversuch schlägt mit derselben Fehlermeldung fehl.

## Im Browser

### Der Service Worker

Der Browser leitet eine Push-Nachricht an Ihren Service Worker weiter, der entscheidet, was
angezeigt werden soll. Platzieren Sie diese Datei im Stammverzeichnis Ihrer Website, z. B. als `public/sw.js` in einer
Vite-App:

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

Die Payload ist das, was Ihr Server gesendet hat. Dieser Worker liest `title`, `body`,
`icon`, `tag` und `url`. Zeigen Sie für jeden Push eine Benachrichtigung an: Browser können
die Berechtigung einer Website widerrufen, die Push-Nachrichten empfängt, aber nichts anzeigt.

### Abonnieren

Registrieren Sie den Worker und abonnieren Sie die Benachrichtigungen bei angemeldetem Benutzer. Rufen Sie `subscribe()`
über einen Klick-Event auf, da Safari die Berechtigung nur innerhalb einer Benutzergeste abfragt:

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

`subscribe()` fragt nach der Berechtigung, ruft den öffentlichen Schlüssel des Servers ab, abonniert
den Browser und registriert ihn für den angemeldeten Benutzer. `lang` ist optional und
ist standardmäßig auf `navigator.language` eingestellt. Der Server gibt diesen Wert an Sie zurück, wenn er die
Nachricht für den jeweiligen Browser erstellt. Ein erneuter Aufruf ist sicher: Er aktualisiert dasselbe
Abonnement und ersetzt ein Abonnement, das mit einem alten Schlüssel erstellt wurde.

Die Methode wirft einen `RebaseClientError` mit einem der folgenden Codes:

| Code | Bedeutung |
|------|-----------|
| `PUSH_UNSUPPORTED` | Der Browser unterstützt die Push-API nicht. `isSupported()` teilt Ihnen dies vorab mit. |
| `PUSH_PERMISSION_DENIED` | Der Benutzer hat Benachrichtigungen für die Website blockiert. Dies kann nur in den Website-Einstellungen des Browsers rückgängig gemacht werden. |
| `PUSH_NO_SERVICE_WORKER` | Es ist kein Service Worker registriert und es wurde keiner als `registration` übergeben. |
| `PUSH_NOT_CONFIGURED` | Vom Server: Push ist dort deaktiviert oder es sind keine Schlüssel vorhanden. |

So stoppen Sie Benachrichtigungen auf diesem Browser:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await client.push.unsubscribe();
const subscription = await client.push.getSubscription(); // null now
```

## Senden

`rebase.push` ist in Funktionen, Cron-Jobs, Tabellen-Hooks und Job-Handlern
verfügbar, ähnlich wie `rebase.email`.

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

`sendToUser` sendet an jeden Browser, in dem der Benutzer Benachrichtigungen aktiviert hat.
`sendToSubscriptions(ids, payload, options)` sendet an die Browser, die Sie über deren
Abonnement-ID angeben. Beide Methoden lösen mit dem Ergebnis auf:

| Feld | Bedeutung |
|------|-----------|
| `sent` | Vom Push-Dienst des Browsers akzeptiert. |
| `removed` | Der Push-Dienst hat mit 404 oder 410 geantwortet: Der Browser hat das Abonnement abbestellt oder das Abonnement ist abgelaufen. Der entsprechende Datensatz wird gelöscht. |
| `failed` | Alles andere: ein Rate-Limit, ein Fehler des Push-Dienstes, Netzwerkprobleme. Der Datensatz bleibt erhalten und der Fehler wird protokolliert. |

Ein Sendevorgang wird abgeschlossen, sobald jeder Push-Dienst geantwortet hat. Verwenden Sie daher `await`,
wenn das Ergebnis wichtig ist, oder übergeben Sie den Vorgang an `waitUntil` in einer Funktion, um die Anfrage
zuerst zu beantworten.

### Eine Nachricht in der Sprache des jeweiligen Browsers

Übergeben Sie eine Funktion anstelle eines Objekts; diese wird einmal pro Browser mit
diesem Abonnement aufgerufen:

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

### Optionen

| Option | Standard | Bedeutung |
|--------|----------|-----------|
| `ttl` | `86400` | Sekunden, die der Push-Dienst versucht, einen Offline-Browser zu erreichen. `0`: jetzt oder nie. Maximal vier Wochen. |
| `urgency` | `"normal"` | `"very-low"`, `"low"`, `"normal"` oder `"high"`. Telefone im Energiesparmodus halten Benachrichtigungen unterhalb von `high` möglicherweise zurück. |
| `topic` | — | Eine neuere Nachricht mit demselben Topic ersetzt eine Nachricht, die der Push-Dienst noch nicht zugestellt hat. Bis zu 32 Zeichen aus `A-Z a-z 0-9 - _`. |
| `tag` | — | Wird der Payload als `tag` hinzugefügt. Der oben gezeigte Service Worker übergibt diesen an `showNotification`, sodass eine neuere Benachrichtigung eine ältere mit demselben Tag auf dem Gerät ersetzt. |

Eine Payload darf als JSON maximal 3993 Bytes groß sein (das Limit von Web Push). Eine größere Payload führt zu einem
Fehler, bevor etwas gesendet wird, ebenso wie eine ungültige Option.

### Wer Benachrichtigungen aktiviert hat

```typescript
import { rebase } from "@rebasepro/server";

const browsers = await rebase.push.subscriptionsOf("user-123");
// [{ id, userId, endpointHost: "web.push.apple.com", lang: "es", createdAt, lastSentAt }]
```

`endpointHost` gibt an, um welchen Browser es sich handelt: `fcm.googleapis.com` für Chrome und
Android, `updates.push.services.mozilla.com` für Firefox, `*.push.apple.com` für
Safari, `*.notify.windows.com` für Edge.

`rebase.push.isConfigured()` ist `false`, wenn Push deaktiviert ist oder keine Schlüssel hinterlegt sind. Überprüfen
Sie dies vor dem Senden, falls Ihr Code auch ohne Push fortfahren kann.

## Eigene Daten pro Browser

Rebase speichert nur, was für die Zustellung einer Nachricht erforderlich ist, und nichts weiter. Für eigene
Einstellungen pro Browser, wie beispielsweise eine Erinnerungszeit, führen Sie eine Tabelle, die den
Schlüssel der Abonnement-ID verwendet. `subscribe()` gibt diese ID im Browser zurück, und
`subscriptionsOf()` gibt sie auf dem Server zurück.

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

Ein stündlicher Cron-Job liest dann die Datensätze aus, die in dieser Stunde fällig sind, und sendet Benachrichtigungen an genau diese
Browser:

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

Wenn ein Browser das Abonnement beendet oder dessen Push-Dienst es verwirft, wird sein Datensatz in
`rebase.push_subscriptions` entfernt, und `sendToSubscriptions` überspringt eine ID, die
nicht mehr existiert. Ihr eigener Datensatz bleibt erhalten, bis Sie ihn löschen. Vergleichen Sie Ihre Daten beim
Aufräumen mit `subscriptionsOf(userId)`.

## Routen

Alle drei Routen erfordern einen angemeldeten Benutzer. API-Schlüssel und der Service-Schlüssel werden mit
`403 PUSH_NEEDS_A_USER` abgewiesen, da ein Abonnement an den Browser einer Person gebunden ist. Das SDK
ruft diese Routen für Sie auf.

| Route | Body | Antwort |
|-------|------|---------|
| `GET /api/push/key` | — | `{ key }`: der öffentliche VAPID-Schlüssel |
| `POST /api/push/subscriptions` | `{ subscription, lang? }`, wobei `subscription` dem Format `PushSubscription.toJSON()` entspricht | `{ id }` |
| `DELETE /api/push/subscriptions` | `{ endpoint }` | `{ removed }`: `false`, wenn der Aufrufer keinen solchen Browser registriert hatte |

Ein Abonnement wird unter dem Aufrufer gespeichert. Wenn ein Browser, der unter
einem Konto abonniert war, unter einem anderen angemeldet wird, wechselt er zum neuen Konto.
Das Abbestellen entfernt nur den Browser des jeweiligen Aufrufers.

Der Server sendet bei jedem Vorgang an die im jeweiligen Abonnement hinterlegte Adresse. Daher
akzeptiert er ausschließlich die von gängigen Browsern genutzten Push-Dienste: `fcm.googleapis.com`,
`android.googleapis.com`, `updates.push.services.mozilla.com`,
`web.push.apple.com`, `*.push.apple.com` und `*.notify.windows.com` über
`https` auf dem Standardport. Jeder andere Endpunkt wird mit
`400 PUSH_ENDPOINT_REFUSED` abgewiesen, damit kein Client Ihren Server dazu veranlassen kann, Anfragen an
eine interne Adresse zu senden. Um einen anderen Push-Dienst zuzulassen, beispielsweise einen lokalen Test-Double,
führen Sie diesen in `push.allowedHosts` auf:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    push: { allowedHosts: ["127.0.0.1:8443"] }
});
```

## Die Tabelle

`rebase.push_subscriptions` enthält eine Zeile pro Browser: `id` (ein Hash des
Endpunkts), `user_id`, `endpoint`, die Schlüssel `p256dh` und `auth` des Browsers, `lang`,
`user_agent`, `created_at`, `updated_at` und `last_sent_at`.

Der Server beschreibt diese Tabelle. Zeilenbasierte Sicherheit (Row-Level Security) beschränkt die Rollen von Anfragen auf das Lesen und
Löschen ihrer eigenen Zeilen (`user_id = rebase.uid()`), sodass
[als Aufrufer ausgeführtes SQL](/docs/backend/scripts/) nur die Browser dieses Benutzers sieht und
keine anderen, und keine Datensätze einfügen kann.

## Über einen anderen Dienst senden

Die Zustellung erfolgt über einen `PushSender`: eine Nachricht an einen Browser, beantwortet mit
dem Status des Push-Dienstes. Der integrierte Sender signiert, verschlüsselt und sendet per
`fetch`. Um über ein Relay zu senden oder Nachrichten in Tests aufzuzeichnen, können Sie einen eigenen Sender übergeben:

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

`createWebPushSender(keys, subject)` aus `@rebasepro/server` instanziiert den standardmäßigen
Sender, falls Sie diesen umschließen möchten.

## Verwandte Themen

- [Eigene Funktionen](/docs/backend/custom-functions/) und [Cron-Jobs](/docs/backend/cron-jobs/): Von wo aus `rebase.push` aufgerufen wird.
- [Hintergrund-Jobs](/docs/backend/jobs/): Um aus einer Warteschlange mit Wiederholungsversuchen zu senden, reihen Sie einen Job ein, dessen Handler `rebase.push` aufruft.
- [E-Mail-Verifizierung](/docs/backend/email-verification/): `rebase.email`, der andere Kommunikationskanal.
