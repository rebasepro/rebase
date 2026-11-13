---
sourceHash: 9e21b0515cf58869
title: Hintergrund-Jobs
sidebar_label: Hintergrund-Jobs
description: Eine dauerhafte, Postgres-gestützte Job-Queue – Arbeit, die einen Neustart übersteht, mit Backoff wiederholt wird und bei Fehlschlägen erhalten bleibt, anstatt verworfen zu werden.
---

## Übersicht

Ein Job ist eine Zeile in `rebase.jobs`. Er wird von genau einem Worker beansprucht, mit einer zunehmenden Verzögerung wiederholt, wenn sein Handler einen Fehler wirft, und verbleibt in der Tabelle, wenn er endgültig aufgibt, damit jemand ihn untersuchen kann.

Es muss nichts installiert und nichts neben Postgres ausgeführt werden. Ein Job, der innerhalb einer Transaktion eingereiht wird, die zurückgerollt wird, wurde nie eingereiht.

Nutzen Sie dies für Aufgaben, die nicht verloren gehen dürfen und nicht innerhalb eines Requests stattfinden dürfen: E-Mails versenden, Drittanbieter aufrufen, Dateien generieren, Abgleich mit externen Systemen.

| | Ausführung | Übersteht einen Neustart |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Nach Zeitplan | Ja – der Zeitplan liegt im Code |
| **Jobs** | Einmalig, sobald ein Worker frei ist | **Ja – der Job ist eine Zeile** |
| Ein `setTimeout` in einem Callback | Einmalig, in diesem Prozess | Nein |

## Aktivierung

:::note[Wo dies platziert wird]
**Managed Runtime** – nirgends. `jobs` akzeptiert Handler-*Funktionen*, die weder über eine Umgebungsvariable noch über einen Export aus `backend/storage.ts` oder `backend/hooks.ts` übergeben werden können, sodass ein scaffolded Projekt die Queue nicht aktivieren kann. Führen Sie `rebase eject` aus (oder schreiben Sie einen [Custom Server](/docs/backend/custom-server/)), um darauf zuzugreifen. `REBASE_JOB_WORKERS` in `.env` bestimmt lediglich, ob die Worker einer bereits aktivierten Queue in *diesem* Prozess ausgeführt werden.

**Ejected** – der `jobs`-Block in `initializeRebaseBackend({ … })`, wie unten dargestellt.

Die vollständige Übersicht finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

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

Standardmäßig deaktiviert: Ein Worker sucht solange nach Arbeit, wie der Prozess läuft – ein Verhalten, das nicht ungefragt als Standard gesetzt werden sollte. Er benötigt einen Treiber, der SQL ausführen kann – bei einem Treiber, der dies nicht kann, ist die Queue nicht verfügbar, und Sie werden bereits beim Booten darüber informiert, statt erst beim ersten Einreihen.

Ein untätiger Worker pollt nicht alle zwei Sekunden. Jedes Einreihen sendet ein `NOTIFY` auf dem Kanal `rebase_jobs`, sobald der Commit erfolgt, und ein Worker, der ein `LISTEN` darauf hält, beansprucht den Job sofort – ein Job, der von einem anderen Prozess eingereiht wurde (der `api`-Rolle, einem anderen Replikat), startet innerhalb von Millisekunden, und ein verzögerter Job, sobald er fällig wird. Unabhängig davon prüft er ohnehin alle 30 Sekunden nach. Ein Job, den dieser Prozess selbst einreiht, ein von ihm geplanter Wiederholungsversuch und ein von ihm zurückgeholter Job wecken ihn auch ohne Benachrichtigung auf.

Das `LISTEN` benötigt eine eigene Verbindung, die so ermittelt wird, wie Realtime eine findet: `DATABASE_DIRECT_URL`, falls gesetzt, andernfalls `DATABASE_URL`. Hinter einem Pooler im Transaction-Modus wie PgBouncer sollte `DATABASE_DIRECT_URL` gesetzt werden: Ein Pooler hält kein `LISTEN` aufrecht, und Jobs von anderen Prozessen würden dann auf die 30-Sekunden-Prüfung warten. Wo es überhaupt keine solche Verbindung gibt (die In-Process-Entwicklungsdatenbank), zieht sich ein untätiger Worker stattdessen per Backoff zurück: Er prüft nach `pollIntervalMs` (2 Sekunden), danach nach jedem erfolglosen Prüfen doppelt so lange bis zu 30 Sekunden, und beginnt von vorn, sobald er Arbeit findet. Ein untätiger Worker führt so etwa 2.900 Abfragen pro Tag statt 43.200 durch.

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

`idempotencyKey` fasst einen Doppelklick, einen wiederholten Request und zwei Instanzen, die auf dasselbe Event reagieren, zu einem einzigen Job zusammen. Er beschränkt sich auf unfertige Arbeit, sodass der Schlüssel wiederverwendbar wird, sobald der Job abgeschlossen ist – andernfalls könnte „der nächtliche Digest für Benutzer 7“ exakt ein einziges Mal überhaupt gesendet werden. Ein dupliziertes Einreihen löst sich zu `null` auf, anstatt einen Fehler zu werfen: Die angeforderte Arbeit ist eingereiht, was das gewünschte Ergebnis ist.

## Fehlschläge

Ein Handler schlägt fehl, indem er einen Fehler wirft (`throw`). Es gibt kein `return false` – ein Boolean würde von jedem Handler stillschweigend ignoriert, der vergessen hat, einen zurückzugeben, und ein Fehlschlag muss das sein, was standardmäßig eintritt.

- **Verbleibende Versuche** → zurück auf `pending`, wobei `run_at` durch den Backoff nach hinten verschoben wird (1s, 5s, 25s … gedeckelt auf eine Stunde; überschreibbar mit `backoff`).
- **Keine Versuche mehr** → `failed`, und die Zeile *bleibt bestehen*. Eine Queue, die stillschweigend verwirft, was sie nicht zustellen konnte, ist nicht von einer zu unterscheiden, die nichts zu tun hat.
- **Ein Fehler, den kein erneuter Versuch beheben kann** → werfen Sie `PermanentJobError` aus `@rebasepro/server`: Der Job wechselt bei diesem Versuch direkt zu `failed`, mit der Meldung als `last_error`, anstatt seine verbleibenden Versuche aufzubrauchen.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Fehlgeschlagene Zeilen werden 30 Tage lang aufbewahrt; erfolgreiche 3 Tage. Jeder Worker löscht die abgelaufenen Zeilen beim Start und danach stündlich, stapelweise und außerhalb des Request-Pfads.

## Was passiert, wenn ein Worker abstürzt

Ein Prozess, der mitten im Job beendet wird, kann seinen Anspruch (Claim) nicht freigeben, sodass nur ein Timeout die Zeile wieder freigibt. Während ein Handler läuft, erneuert sein Worker den Claim alle ein Drittel von `visibilityTimeoutMs` (Standard: 5 Minuten). Ein Claim, der so lange nicht erneuert wurde, wird zurückgefordert – zurück auf `pending`, falls der Job noch Versuche übrig hat, andernfalls als Dead-Letter markiert mit einem Fehler, der beschreibt, was passiert ist.

Ein langsamer Handler auf einem lebenden Worker behält also seinen Job, egal wie lange es dauert, und der Timeout entscheidet lediglich darüber, wie schnell die Jobs eines abgestürzten Workers zurückkehren. Ein Versuch, der seinen Claim verloren hat, kann das Ergebnis des Jobs auch nicht mehr überschreiben: Sein Erfolg oder Fehlschlag wird protokolliert und verworfen, und der Versuch, der den Claim aktuell hält, entscheidet.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### Ein Handler, der nie fertig wird

Die Kehrseite: Ein Handler, der auf ein `fetch` wartet, das nie antwortet, belegt seinen Worker-Slot und seinen Claim solange der Prozess läuft – fünf davon, und der Worker führt nichts anderes mehr aus, während `/health` weiterhin grün bleibt. `timeoutMs` begrenzt einen Versuch. Nach Ablauf der Frist schlägt der Versuch fehl – wird wiederholt, solange noch Versuche verbleiben, wie bei jedem Fehlerwurf –, sein Slot wird freigegeben und das `signal` des Handlers wird abgebrochen. Leiten Sie das Signal weiter, damit auch die Arbeit stoppt; ein Handler, der es ignoriert, läuft im Hintergrund weiter, ohne dass irgendetwas sein Ergebnis erfasst.

Wird er weggelassen, beträgt er 15 Minuten (`900_000`), was der Worker beim Start in einer Logzeile meldet. Ein Job, der berechtigterweise länger läuft, setzt seinen eigenen Wert, und `timeoutMs: 0` hebt das Limit auf.

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

Konstruktionsbedingt sicher. Worker beanspruchen Jobs mittels `SELECT … FOR UPDATE SKIP LOCKED`, sodass jeder Job an genau einen von ihnen geht und die anderen zur nächsten Zeile übergehen, anstatt sich dahinter einzureihen. Es muss kein Leader gewählt werden.

Eine Instanz beansprucht nur die Tasks, für die sie einen Handler hat. Während eines Rolling Deployments rührt eine Instanz mit älterem Code diejenigen Jobs nicht an, deren Task nur vom neueren Code implementiert wird: Sie bleiben auf `pending`, ihre Versuche unberührt, bis ein aktualisierter Peer sie beansprucht. Ein Task, den keine Instanz implementiert, bleibt ebenfalls auf `pending`, anstatt als Dead-Letter markiert zu werden.

## Scans verwaister Storage-Dateien

`rebase storage orphans` wird über diese Queue ausgeführt, wenn sie aktiviert ist: Jeder Scan und jeder Löschvorgang aus einem Scan ist ein `storage.orphans`-Job mit einem Versuch. Das Backend registriert den Handler selbst in jedem Prozess, in dem Storage konfiguriert ist, und nur Prozesse mit aktivierten Job-Workern führen ihn aus. Ein Scan ist wie jeder Job an `timeoutMs` gebunden, daher benötigt eine Quelle, die zu groß ist, um in 15 Minuten gescannt zu werden, ein höheres `timeoutMs` oder 0. Ohne die Queue führt der Server den Scan stattdessen in seinem eigenen Prozess aus. Siehe [die CLI](/docs/cli/#rebase-storage).

## Dauerhafte Webhooks

[`WebhookDispatcher`](/docs/recipes/webhooks) reiht seine Zustellungen standardmäßig im Arbeitsspeicher ein, was bedeutet, dass ein Absturz oder ein Deployment zwischen der Änderung und der Zustellung das Event verwirft. Übergeben Sie ihm die Queue, wird jede Zustellung zu einer Zeile:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Nur die **ID** des Webhooks wird im Job gespeichert, niemals der Webhook selbst – dessen Signierungsgeheimnis (Signing Secret) würde sonst so lange im Klartext in `rebase.jobs` verbleiben, wie die Retention die Zeile aufbewahrt; zudem sollte ein Webhook, der zwischen dem Einreihen und der Zustellung bearbeitet wurde, mit dem aktuellen Stand gesendet werden. Die Übergabe von `ctx` als zweites Argument sorgt dafür, dass jeder Versuch sein eigenes `X-Webhook-Attempt` sendet; jeder Versuch einer bestimmten Zustellung sendet dasselbe `X-Webhook-Delivery`, sodass ein Empfänger die Wiederholungsversuche deduplizieren kann.

Eine Zustellung, die der Dispatcher verweigert (ein Loopback-, Link-Local-, privates oder Nicht-`http(s)`-Ziel), oder eine, die der Empfänger mit einem Redirect beantwortet, schlägt jedes Mal auf die gleiche Weise fehl. Sie wird nach einem Versuch als Dead-Letter markiert, mit der Begründung in `last_error`. Jeder andere Fehlschlag wird wie jeder andere Job wiederholt.

## Herunterfahren

`shutdown()` stoppt den Worker dabei, neue Jobs zu beanspruchen, und wartet auf die bereits laufenden Jobs, sodass ein Deployment das Ende eines Batches nicht doppelt ausführt. Die Wartezeit ist auf zwei Drittel des Shutdown-Timeouts gedeckelt (10 Sekunden der standardmäßigen 15 Sekunden), damit ein einzelner Handler, der nie abschließt, das Herunterfahren nicht blockieren kann. Ein Job, der danach immer noch läuft, behält seinen Claim und wird über das Visibility-Timeout wiederhergestellt.

## Nächste Schritte

- **[Cron Jobs](/docs/backend/cron-jobs)** – Aufgaben nach Zeitplan
- **[Webhooks](/docs/recipes/webhooks)** – andere Systeme bei Änderungen benachrichtigen
