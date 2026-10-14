---
sourceHash: cf996dc5a52fc912
title: Hintergrund-Jobs
sidebar_label: Hintergrund-Jobs
description: Eine dauerhafte, Postgres-gestützte Job-Warteschlange – Aufgaben, die einen Neustart überstehen, mit Backoff wiederholt werden und bei denen Fehler aufbewahrt statt verworfen werden.
---

## Übersicht

Ein Job ist eine Zeile in `rebase.jobs`. Er wird von genau einem Worker beansprucht, mit zunehmender Verzögerung wiederholt, wenn sein Handler einen Fehler wirft, und verbleibt in der Tabelle, wenn er schließlich aufgibt, damit sich jemand darum kümmern kann.

Es muss nichts installiert werden und nichts neben Postgres laufen. Ein Job, der innerhalb einer Transaktion eingereiht wurde, die zurückgerollt wird, wurde nie eingereiht.

Verwenden Sie dies für Aufgaben, die nicht verloren gehen dürfen und nicht innerhalb eines Requests stattfinden dürfen: E-Mails versenden, Drittanbieter aufrufen, Dateien generieren, Daten mit einem externen System abgleichen.

| | Ausführung | Übersteht einen Neustart |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Nach Zeitplan | Ja – der Zeitplan liegt im Code |
| **Jobs** | Einmal, sobald ein Worker frei ist | **Ja – der Job ist eine Zeile** |
| Ein `setTimeout` in einem Callback | Einmal, in diesem Prozess | Nein |

## Aktivierung

```typescript no-verify
await initializeRebaseBackend({
    jobs: {
        enabled: true,
        tasks: {
            "send-welcome": async ({ payload }) => {
                await sendEmail((payload as { email: string }).email);
            }
        }
    }
});
```

Standardmäßig deaktiviert: Ein Worker sucht so lange nach Arbeit, wie der Prozess lebt, was kein Standardverhalten ist, das jeder möchte. Er benötigt einen Treiber, der SQL ausführen kann – bei einem Treiber, der dies nicht kann (MongoDB), ist die Warteschlange nicht verfügbar, und Sie werden bereits beim Start darauf hingewiesen und nicht erst beim ersten Einreihen.

Ein untätiger Worker pollt nicht alle zwei Sekunden. Jedes Einreihen sendet beim Commit ein `NOTIFY` auf dem Kanal `rebase_jobs`, und ein Worker, der ein `LISTEN` darauf hält, beansprucht sofort – ein Job, der von einem anderen Prozess eingereiht wird (die `api`-Rolle, eine andere Replik), startet innerhalb von Millisekunden, ein verzögerter, wenn er fällig wird. Dahinter schaut er trotzdem alle 30 Sekunden nach. Ein Job, den dieser Prozess einreiht, ein Retry, den er geplant hat, und ein Job, den er zurückgefordert hat, wecken ihn ohne Benachrichtigung.

Das `LISTEN` braucht eine eigene Verbindung, die so gefunden wird wie bei Realtime: `DATABASE_DIRECT_URL`, wenn gesetzt, sonst `DATABASE_URL`. Setzen Sie hinter einem Pooler im Transaction-Modus wie PgBouncer `DATABASE_DIRECT_URL`: Ein Pooler hält kein `LISTEN`, und Jobs aus anderen Prozessen würden dann auf den 30-Sekunden-Blick warten. Wo es überhaupt keine solche Verbindung gibt (die In-Process-Entwicklungsdatenbank), fährt ein untätiger Worker stattdessen zurück: Er schaut nach `pollIntervalMs` (2 Sekunden) nach, danach nach jeweils doppelt so langer Zeit, wenn der Blick nichts fand, bis zu 30 Sekunden, und beginnt von vorn, sobald er Arbeit findet. Ein untätiger Worker macht etwa 2.900 Claims pro Tag statt 43.200.

## Jobs einreihen

```typescript no-verify
const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true, tasks } });

await jobQueue?.enqueue("send-welcome", { email: "ada@example.com" });
```

### Optionen

```typescript no-verify
await jobQueue?.enqueue("send-digest", { userId: "u7" }, {
    delayMs: 60_000,               // not before a minute from now
    maxAttempts: 5,                // default 3
    idempotencyKey: "digest:u7"    // at most one *unfinished* job with this key
});
```

`idempotencyKey` fasst einen Doppelklick, einen wiederholten Request und zwei Instanzen, die auf dasselbe Event reagieren, zu einem einzigen Job zusammen. Er bezieht sich auf unfertige Aufgaben, sodass der Schlüssel wiederverwendbar wird, sobald der Job abgeschlossen ist – andernfalls könnte „die nächtliche Zusammenfassung für Benutzer 7“ exakt ein einziges Mal überhaupt versendet werden. Ein doppeltes Einreihen wird zu `null` aufgelöst, anstatt einen Fehler zu werfen: Die angeforderte Aufgabe ist eingereiht, was dem gewünschten Ergebnis entspricht.

## Fehlerbehandlung

Ein Handler schlägt fehl, indem er eine Exception wirft. Es gibt kein `return false` – ein boolescher Wert würde von jedem Handler stillschweigend ignoriert, der die Rückgabe vergessen hat, und ein Fehlschlag muss das Standardverhalten bei Fehlern sein.

- **Verbleibende Versuche** → zurück auf `pending`, wobei `run_at` durch den Backoff nach hinten verschoben wird (1s, 5s, 25s … gedeckelt auf eine Stunde; überschreibbar mit `backoff`).
- **Keine Versuche mehr** → `failed`, und die Zeile *bleibt bestehen*. Eine Warteschlange, die nicht zustellbare Aufgaben stillschweigend verwirft, ist nicht von einer zu unterscheiden, die nichts zu tun hat.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Fehlgeschlagene Zeilen werden 30 Tage aufbewahrt; erfolgreiche 3 Tage. Jeder Worker löscht
die abgelaufenen Zeilen beim Start und danach jede Stunde, in Batches und abseits des
Request-Pfads.

## Was passiert, wenn ein Worker abstürzt

Ein Prozess, der mitten im Job beendet wird, kann seinen Anspruch (Claim) nicht freigeben, sodass nur ein Timeout die Zeile freigeben kann. Während ein Handler läuft, erneuert sein Worker den Anspruch nach jeweils einem Drittel von `visibilityTimeoutMs` (Standard: 5 Minuten). Ein Anspruch, der so lange nicht erneuert wurde, wird zurückgefordert – zurück zu `pending`, wenn der Job noch Versuche übrig hat, andernfalls wird er als Dead-Letter mit einer entsprechenden Fehlermeldung markiert.

Ein langsamer Handler auf einem lebenden Worker behält seinen Job also, egal wie lange er braucht, und der Timeout entscheidet nur, wie schnell die Jobs eines abgestürzten Workers zurückkommen. Ein Versuch, der seinen Anspruch verloren hat, kann auch das Ergebnis des Jobs nicht überschreiben: Sein Erfolg oder Fehlschlag wird protokolliert und verworfen, und es entscheidet derjenige Versuch, der den Anspruch hält.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### Ein Handler, der nie fertig wird

Die Kehrseite: Ein Handler, der auf ein `fetch` wartet, das nie antwortet, hält seinen Worker-Slot und seinen Claim, solange der Prozess lebt – bei fünf davon führt der Worker nichts anderes mehr aus, während `/health` grün bleibt.
`timeoutMs` begrenzt einen Versuch. Mit Ablauf der Frist schlägt der Versuch fehl — er wird wiederholt, solange Versuche übrig sind, wie bei jedem Throw —, sein Slot wird frei, und das `signal` des Handlers wird abgebrochen. Reichen Sie das Signal weiter, damit auch die Arbeit stoppt; ein Handler, der es ignoriert, läuft im Hintergrund weiter, ohne dass etwas sein Ergebnis aufzeichnet.

Ohne Angabe sind es 15 Minuten (`900_000`), und der Worker meldet das beim Start in einer Logzeile. Ein Job, der legitim länger läuft, setzt seinen eigenen Wert, und `timeoutMs: 0` hebt das Limit auf.

```typescript no-verify
jobs: {
    enabled: true,
    timeoutMs: 120_000,          // one attempt; 15 minutes when left out, 0 for no limit
    tasks: {
        "sync-crm": async ({ payload, signal }) => {
            await fetch(crmUrl, { method: "POST", body: JSON.stringify(payload), signal });
        }
    }
}
```

Queue-Handler und Topic-Subscriptions erhalten dasselbe `signal` in ihrem Kontext.

## Mehrere Instanzen

Konstruktionsbedingt sicher. Worker beanspruchen Jobs mit `SELECT … FOR UPDATE SKIP LOCKED`, sodass jeder Job an genau einen von ihnen geht und die anderen zur nächsten Zeile übergehen, anstatt sich dahinter anzustellen. Es muss kein Leader gewählt werden.

Eine Instanz beansprucht nur die Tasks, für die sie einen Handler hat. Während eines Rolling Deployments lässt eine Instanz mit älterem Code die Jobs liegen, deren Task nur der neuere Code implementiert: Sie bleiben `pending`, ohne dass ein Versuch verbraucht wird, bis eine aktualisierte Instanz sie beansprucht. Ein Task, den keine Instanz implementiert, bleibt ebenfalls `pending`, statt in die Dead-Letter-Ablage zu gehen.

## Zuverlässige Webhooks

[`WebhookDispatcher`](/docs/recipes/webhooks) reiht Zustellungen standardmäßig im Arbeitsspeicher ein. Das bedeutet, dass bei einem Absturz oder Deployment zwischen Änderung und Zustellung das Ereignis verloren geht. Übergibt man ihm die Warteschlange, wird jede Zustellung zu einer Zeile:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Auf dem Job wird nur die **ID** des Webhooks gespeichert, niemals der Webhook selbst – das Signatur-Secret würde sonst für die Dauer der Aufbewahrungsfrist im Klartext in `rebase.jobs` liegen, und ein Webhook, der zwischen dem Einreihen und der Zustellung bearbeitet wurde, sollte im aktuellen Zustand gesendet werden. Wird `ctx` als zweites Argument übergeben, sendet jeder Versuch seinen eigenen `X-Webhook-Attempt`; alle Versuche einer Zustellung senden denselben `X-Webhook-Delivery`, sodass ein Empfänger die Wiederholungen deduplizieren kann.

Eine Zustellung, die der Dispatcher verweigert (ein Loopback-, Link-Local-, privates oder Nicht-`http(s)`-Ziel), oder eine, auf die der Empfänger mit einer Weiterleitung antwortet, schlägt jedes Mal gleich fehl. Sie geht nach einem Versuch in die Dead-Letter-Ablage, mit dem Grund in `last_error`. Jeder andere Fehler wird wie bei jedem Job wiederholt.

## Herunterfahren

`shutdown()` verhindert, dass der Worker neue Jobs beansprucht, und wartet auf die aktuell laufenden, damit ein Deployment den Rest eines Batches nicht doppelt ausführt. Das Warten ist auf zwei Drittel des Shutdown-Timeouts begrenzt (10 Sekunden der standardmäßigen 15), damit ein Handler, der nie fertig wird, das Herunterfahren nicht aufhalten kann. Ein Job, der danach noch läuft, behält seinen Anspruch und wird über das Visibility-Timeout wiederhergestellt.

## Nächste Schritte

- **[Cron-Jobs](/docs/backend/cron-jobs)** — Aufgaben nach Zeitplan
- **[Webhooks](/docs/recipes/webhooks)** — andere Systeme bei Änderungen benachrichtigen
