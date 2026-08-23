---
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

Standardmäßig deaktiviert: Ein Worker pollt die Datenbank kontinuierlich, was kein Standardverhalten ist, das jeder möchte. Er benötigt einen Treiber, der SQL ausführen kann – bei einem Treiber, der dies nicht kann (MongoDB), ist die Warteschlange nicht verfügbar, und Sie werden bereits beim Start darauf hingewiesen und nicht erst beim ersten Einreihen.

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

Fehlgeschlagene Zeilen werden 30 Tage aufbewahrt; erfolgreiche 3 Tage.

## Was passiert, wenn ein Worker abstürzt

Ein Prozess, der mitten im Job beendet wird, kann seinen Anspruch (Claim) nicht freigeben, sodass nur ein Timeout die Zeile freigeben kann. Jobs, die länger als `visibilityTimeoutMs` (Standard: 5 Minuten) beansprucht wurden, werden zurückgefordert – zurück zu `pending`, wenn noch Versuche übrig sind, andernfalls werden sie als Dead-Letter mit einer entsprechenden Fehlermeldung markiert.

Aus diesem Grund muss der Timeout auch länger sein als Ihr langsamster Handler: Danach könnte ein zweiter Worker einen Job starten, den der erste noch ausführt.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // when the last look found nothing
    visibilityTimeoutMs: 300_000 // must exceed the slowest handler
}
```

## Mehrere Instanzen

Konstruktionsbedingt sicher. Worker beanspruchen Jobs mit `SELECT … FOR UPDATE SKIP LOCKED`, sodass jeder Job an genau einen von ihnen geht und die anderen zur nächsten Zeile übergehen, anstatt sich dahinter anzustellen. Es muss kein Leader gewählt werden.

Während eines Rolling Deployments erhält eine Instanz mit älterem Code möglicherweise Jobs, deren Task sie nicht implementiert. Diese werden an die Warteschlange zurückgegeben, anstatt als fehlgeschlagen markiert zu werden, sodass sie ausgeführt werden, sobald eine aktualisierte Instanz sie übernimmt.

## Zuverlässige Webhooks

[`WebhookDispatcher`](/docs/recipes/webhooks) reiht Zustellungen standardmäßig im Arbeitsspeicher ein. Das bedeutet, dass bei einem Absturz oder Deployment zwischen Änderung und Zustellung das Ereignis verloren geht. Übergibt man ihm die Warteschlange, wird jede Zustellung zu einer Zeile:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never));
```

Auf dem Job wird nur die **ID** des Webhooks gespeichert, niemals der Webhook selbst – das Signatur-Secret würde sonst für die Dauer der Aufbewahrungsfrist im Klartext in `rebase.jobs` liegen, und ein Webhook, der zwischen dem Einreihen und der Zustellung bearbeitet wurde, sollte im aktuellen Zustand gesendet werden.

## Herunterfahren

`shutdown()` verhindert, dass der Worker neue Jobs beansprucht, und wartet auf die aktuell laufenden, damit ein Deployment den Rest eines Batches nicht doppelt ausführt. Alles, was beim Beenden des Prozesses noch läuft, behält seinen Anspruch und wird über das Visibility-Timeout wiederhergestellt.

## Nächste Schritte

- **[Cron-Jobs](/docs/backend/cron-jobs)** — Aufgaben nach Zeitplan
- **[Webhooks](/docs/recipes/webhooks)** — andere Systeme bei Änderungen benachrichtigen

---
