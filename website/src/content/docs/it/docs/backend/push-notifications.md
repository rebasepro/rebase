---
sourceHash: 1decbd73d73d8d9b
title: Notifiche push
sidebar_label: Notifiche push
description: Web Push per i browser dei tuoi utenti — Chrome, Firefox, Edge e Safari su iPhone, iPad e Mac — inviate da funzioni e cron job con rebase.push.
---

## Panoramica

Il Web Push mostra una notifica sulla schermata di blocco o sul desktop dell'utente mentre l'app è chiusa. Rebase si occupa del lato server: memorizza la sottoscrizione di ogni browser, firma i messaggi con le tue chiavi VAPID, li crittografa in modo che solo quel browser possa leggerli e rimuove i browser che si sono disiscritti.

Funziona in ogni browser che supporta la Push API: Chrome e Android, Firefox, Edge e Safari su macOS, iPadOS e iOS. Su iOS e iPadOS la web app deve essere prima aggiunta alla schermata Home.

Sono necessari tre elementi:

1. Il server attiva il push e dispone di una coppia di chiavi.
2. Il browser registra un service worker e si iscrive tramite l'SDK.
3. Il codice del tuo server invia con `rebase.push`.

## Attivazione

Il push è disattivato finché non lo attivi.

:::note[Dove va inserito]
**Managed runtime** — `REBASE_PUSH=true` in `.env`.

**Ejected** — `push: true` su `initializeRebaseBackend({ … })`.
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

Questo crea la tabella `rebase.push_subscriptions` all'avvio e monta le route sotto `/api/push`.

### Chiavi

Un browser si iscrive con la chiave pubblica del tuo server e accetta solo messaggi firmati con la chiave privata corrispondente. Configura la coppia e un indirizzo di contatto al quale i servizi push possono raggiungerti:

```bash
REBASE_VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
REBASE_VAPID_PRIVATE_KEY=UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
REBASE_VAPID_SUBJECT=mailto:ops@example.com
```

Genera una coppia una sola volta con `npx web-push generate-vapid-keys` e conservala. Se modifichi le chiavi, tutte le sottoscrizioni esistenti smetteranno di ricevere messaggi; ogni browser dovrà iscriversi nuovamente, operazione che `client.push.subscribe()` esegue automaticamente alla successiva esecuzione.

`REBASE_VAPID_SUBJECT` è un indirizzo `mailto:` o un URL `https://`. Apple rifiuta i messaggi senza un valore valido. Se non è impostato, viene utilizzata l'origine di `REBASE_PUBLIC_URL` quando questa è `https`.

**In fase di sviluppo** puoi saltare tutto questo. Senza chiavi impostate, il server genera una coppia, la mantiene in `.rebase-dev-secrets.json` in modo che le sottoscrizioni sopravvivano al riavvio, e registra una riga di log indicandolo. **In produzione** non viene generato nulla. Il push rimane disattivato, il log di avvio indica le variabili da impostare, `/api/push/*` risponde `503 PUSH_NOT_CONFIGURED`, e ogni tentativo di invio genera lo stesso messaggio di errore.

## Nel browser

### Il service worker

Il browser recapita un messaggio push al tuo service worker, che decide cosa mostrare. Posiziona questo file nella root del tuo sito, come `public/sw.js` in un'app Vite:

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

Il payload corrisponde a qualunque cosa inviata dal server. Questo worker legge `title`, `body`, `icon`, `tag` e `url`. Mostra una notifica per ogni push: i browser potrebbero revocare l'autorizzazione a un sito che riceve notifiche push e non mostra nulla.

### Sottoscrizione

Con un utente autenticato, registra il worker ed effettua la sottoscrizione. Chiama `subscribe()` a seguito di un clic, poiché Safari richiede l'autorizzazione solo all'interno di un'azione avviata dall'utente (user gesture):

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

`subscribe()` richiede l'autorizzazione, recupera la chiave pubblica del server, iscrive il browser e lo registra sotto l'utente autenticato. `lang` è opzionale e il valore predefinito è `navigator.language`. Il server te lo restituisce quando compone il messaggio per ciascun browser. Chiamarlo nuovamente è sicuro: aggiorna la stessa sottoscrizione e ne sostituisce una creata con una vecchia chiave.

Genera un errore `RebaseClientError` con uno dei seguenti codici:

| Codice | Significato |
|--------|-------------|
| `PUSH_UNSUPPORTED` | Il browser non supporta la Push API. `isSupported()` te lo segnala in anticipo. |
| `PUSH_PERMISSION_DENIED` | L'utente ha bloccato le notifiche per il sito. Solo le impostazioni del sito nel browser possono annullare questa scelta. |
| `PUSH_NO_SERVICE_WORKER` | Nessun service worker è registrato e nessuno è stato passato come `registration`. |
| `PUSH_NOT_CONFIGURED` | Dal server: il push è disattivato oppure non ha chiavi configurate. |

Per interrompere le notifiche su questo browser:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "https://api.example.com" });

await client.push.unsubscribe();
const subscription = await client.push.getSubscription(); // null now
```

## Invio

`rebase.push` è disponibile in funzioni, cron job, hook di tabella e gestori di job, proprio come `rebase.email`.

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

`sendToUser` invia a ogni browser in cui l'utente ha attivato le notifiche. `sendToSubscriptions(ids, payload, options)` invia ai browser specificati tramite id di sottoscrizione. Entrambi restituiscono una promise che risolve con l'esito dell'operazione:

| Campo | Significato |
|-------|-------------|
| `sent` | Accettato dal servizio push del browser. |
| `removed` | Il servizio push ha risposto con 404 o 410: il browser si è disiscritto o la sottoscrizione è scaduta. La riga corrispondente viene eliminata. |
| `failed` | Qualsiasi altra evenienza: rate limit, errore del servizio push, problemi di rete. La riga viene mantenuta e il fallimento registrato nei log. |

L'operazione di invio si risolve una volta che ciascun servizio push ha risposto; pertanto, usa `await` se il risultato è importante, oppure passala a `waitUntil` all'interno di una funzione per rispondere prima alla richiesta.

### Un messaggio nella lingua di ciascun browser

Passa una funzione anziché un oggetto, e verrà chiamata una volta per ciascun browser con quella sottoscrizione:

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

### Opzioni

| Opzione | Predefinito | Significato |
|---------|-------------|-------------|
| `ttl` | `86400` | Secondi durante i quali il servizio push continua a tentare di raggiungere un browser non in linea. `0`: subito o mai più. Al massimo quattro settimane. |
| `urgency` | `"normal"` | `"very-low"`, `"low"`, `"normal"` o `"high"`. I telefoni con risparmio energetico attivo potrebbero trattenere qualsiasi valore inferiore a `high`. |
| `topic` | — | Un messaggio più recente con lo stesso topic sostituisce uno non ancora recapitato dal servizio push. Fino a 32 caratteri composti da `A-Z a-z 0-9 - _`. |
| `tag` | — | Aggiunto al payload come `tag`. Il service worker sopra lo passa a `showNotification`, in modo che una notifica più recente sostituisca una precedente con lo stesso tag sul dispositivo. |

Il payload può essere al massimo di 3993 byte in formato JSON, il limite di Web Push. Un payload di dimensioni superiori genera un errore prima dell'invio, così come un'opzione non valida.

### Chi ha le notifiche attive

```typescript
import { rebase } from "@rebasepro/server";

const browsers = await rebase.push.subscriptionsOf("user-123");
// [{ id, userId, endpointHost: "web.push.apple.com", lang: "es", createdAt, lastSentAt }]
```

`endpointHost` indica di quale browser si tratta: `fcm.googleapis.com` per Chrome e Android, `updates.push.services.mozilla.com` per Firefox, `*.push.apple.com` per Safari, `*.notify.windows.com` per Edge.

`rebase.push.isConfigured()` restituisce `false` quando il push è disattivato o non ha chiavi configurate. Verificalo prima dell'invio se il tuo codice può procedere anche senza push.

## Dati personalizzati per browser

Rebase memorizza ciò di cui ha bisogno per recapitare un messaggio e nient'altro. Per memorizzare impostazioni personalizzate per browser, come l'orario di un promemoria, mantieni una tabella la cui chiave primaria sia l'id di sottoscrizione. `subscribe()` restituisce tale id nel browser e `subscriptionsOf()` lo restituisce sul server.

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

Un cron orario legge quindi le righe previste per quest'ora e invia le notifiche esattamente a quei browser:

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

Quando un browser annulla l'iscrizione o il suo servizio push la elimina, la riga corrispondente in `rebase.push_subscriptions` viene rimossa e `sendToSubscriptions` ignora gli id non più presenti. La tua riga personalizzata rimane finché non la rimuovi. Effettua un confronto con `subscriptionsOf(userId)` durante le operazioni di pulizia.

## Route

Tutte e tre richiedono un utente autenticato. Le chiavi API e la service key vengono rifiutate con `403 PUSH_NEEDS_A_USER`, poiché una sottoscrizione appartiene al browser di una persona. L'SDK le chiama automaticamente.

| Route | Corpo | Risposta |
|-------|-------|----------|
| `GET /api/push/key` | — | `{ key }`: la chiave pubblica VAPID |
| `POST /api/push/subscriptions` | `{ subscription, lang? }`, dove `subscription` è `PushSubscription.toJSON()` | `{ id }` |
| `DELETE /api/push/subscriptions` | `{ endpoint }` | `{ removed }`: `false` quando il chiamante non possiede tale browser |

Una sottoscrizione viene memorizzata sotto il chiamante. Se un browser iscritto con un account effettua l'iscrizione con un altro account, viene trasferito al nuovo account. La cancellazione dell'iscrizione rimuove solo il browser appartenente al chiamante.

Il server effettua una richiesta POST all'indirizzo presente in ogni sottoscrizione a ogni invio, pertanto accetta solo i servizi push utilizzati dai browser: `fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.push.apple.com` e `*.notify.windows.com`, tramite `https` sulla porta predefinita. Qualsiasi altro endpoint viene rifiutato con `400 PUSH_ENDPOINT_REFUSED`, impedendo così a un client di costringere il server a inviare richieste a un indirizzo interno. Per consentire un altro servizio push, ad esempio un test double locale, elencalo in `push.allowedHosts`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    push: { allowedHosts: ["127.0.0.1:8443"] }
});
```

## La tabella

`rebase.push_subscriptions` contiene una riga per browser: `id` (un hash dell'endpoint), `user_id`, `endpoint`, le chiavi `p256dh` e `auth` del browser, `lang`, `user_agent`, `created_at`, `updated_at` e `last_sent_at`.

Viene popolata dal server. La Row-level security limita i ruoli della richiesta alla sola lettura ed eliminazione delle proprie righe (`user_id = rebase.uid()`), quindi le [query SQL eseguite come chiamante](/docs/backend/scripts/) vedono solo i browser di quell'utente e di nessun altro, e non possono effettuare inserimenti.

## Invio tramite un servizio alternativo

Il recapito avviene tramite un `PushSender`: un messaggio per un browser, con esito corrispondente allo stato restituito dal servizio push. Il sender integrato firma, crittografa e invia con `fetch`. Per inviare tramite un relay, o registrare i messaggi nei test, passane uno personalizzato:

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

`createWebPushSender(keys, subject)` di `@rebasepro/server` crea il sender predefinito, qualora volessi incapsularlo.

## Risorse correlate

- [Funzioni personalizzate](/docs/backend/custom-functions/) e [Cron Job](/docs/backend/cron-jobs/): da dove viene chiamato `rebase.push`.
- [Job in background](/docs/backend/jobs/): per inviare da una coda con tentativi di riesecuzione (retry), accoda un job il cui gestore chiama `rebase.push`.
- [Verifica email](/docs/backend/email-verification/): `rebase.email`, l'altro canale.
