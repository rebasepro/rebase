---
sourceHash: eb2b1e4f16ef2812
title: Cron über Instanzen hinweg
sidebar_label: Cron über Instanzen hinweg
description: "Wie sich Cron-Jobs bei mehr als einem Serverprozess verhalten: ein Durchlauf pro Slot, Wiederherstellung von durch Neustarts verpassten Slots, Pause-Status für alle Replikate und sich niemals überschneidende Durchläufe."
---

[Cron-Jobs](/docs/backend/cron-jobs) laufen in jedem Prozess, dessen Scheduler aktiviert ist:
standardmäßig in jedem Replikat oder nur im Worker bei einem
[Split Deployment](/docs/deployment/split-processes/). Jeder dieser Prozesse
stellt dieselben Timer scharf, und die Datenbank verhindert, dass sie sich
gegenseitig in die Quere kommen – ein Claim (Anspruch) pro `(job, slot)`, sodass ein Slot nur einmal ausgeführt wird; ein Catch-up (Nachholen) für einen Slot, den ein
Neustart ausgelassen hat; und eine Zeile pro Job in `rebase.cron_job_state`, welche den
Pause-Status speichert, den jedes Replikat liest, sowie den Lease, den ein Durchlauf während der Ausführung hält.

Die Tabellen sind unter
[Database Persistence Schema](/docs/backend/cron-jobs/#database-persistence-schema) aufgeführt.
Mit `cronPersistence: false` koordiniert nichts die Prozesse:
Jeder einzelne führt jeden Job aus. Schalten Sie daher den Scheduler nur in einem davon ein
(`REBASE_CRON_SCHEDULER`).

## Verpasste Slots nachholen

Da der Scheduler den nächsten Slot bei jedem Start ausgehend von *jetzt* berechnet, wird ein Slot nur dann ausgelöst, wenn irgendeine Instanz aktiv war und lief, als der Zeitpunkt erreicht wurde. Alles, was den Prozess während eines Slots ersetzt – ein Rolling Deploy, ein Absturz oder das Recycling des Containers durch die Plattform –, verwirft diesen Durchlauf, und der Ersatzprozess plant den Slot *danach*. Es tritt kein Fehler auf; der Durchlauf findet einfach niemals statt.

Dies ist **nicht** nur ein Scale-to-Zero-Problem. Ein Dienst, der an eine Warm-Instanz gebunden ist, verliert dennoch Durchläufe, da es der Plattform freisteht, die den Timer haltende Instanz stillzulegen und eine neue zu starten.

Setzen Sie `catchUpWindowSeconds` auf ein Zeitfenster, das komfortabel größer als ein Neustart ist, und der Startprozess führt einen Slot aus, den er innerhalb dieses Fensters als nicht beansprucht vorfindet:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Drei Dinge, die Sie wissen sollten:

- **Standardmäßig deaktiviert.** Ohne `catchUpWindowSeconds` bleibt das Verhalten unverändert.
- **Nur der jüngste verpasste Slot wird ausgeführt.** Das Hochfahren nach einem sechsstündigen Ausfall holt einen stündlichen Job einmal nach, nicht sechsmal. Das Nachholen verhindert, dass ein Durchlauf verloren geht; es spielt nicht die Historie ab.
- **Ein Claim-fähiger Speicher ist erforderlich.** Catch-up beansprucht den Slot über denselben `(job_id, slot)`-Schlüssel, den auch der reguläre Pfad verwendet. Dies ist das Einzige, was „dieser Slot lief nie“ von „dieser Slot lief bereits auf der Instanz, die ersetzt wird“ unterscheidet. Wenn kein Speicher angebunden ist, wird Catch-up übersprungen und eine Warnung protokolliert – andernfalls würde eine Instanz, die alle 30 Minuten recycelt wird, denselben stündlichen Job bei jedem Start erneut ausführen.

Im Regelfall – ein Neustart Minuten nachdem ein Slot normal ausgeführt wurde – ist der jüngste Slot bereits beansprucht, sodass Catch-up lediglich eine Claim-Prüfung pro Job beim Booten erfordert und nichts weiter unternimmt.

Der Scheduler löscht Claims, die älter als sieben Tage sind, beim Start und danach stündlich, behält jedoch immer den neuesten Claim jedes Jobs bei, unabhängig von dessen Alter. Dieser Claim ist der Nachweis, dass der Slot bereits ausgeführt wurde, sodass ein monatlicher Job mit einem monatsweiten Catch-up-Fenster bei einem Deployment am 10. des Monats nicht erneut ausgeführt wird.

Ein nachgeholter Durchlauf ist ein normaler Eintrag in `cron_logs` (`manual` ist `false`), dessen erste Protokollzeile den wiederhergestellten Slot und die Verspätung festhält:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Einen Job über alle Prozesse hinweg pausieren

Eine Pause wird in `rebase.cron_job_state` gespeichert,
nicht im Speicher des Prozesses, der die Anfrage verarbeitet hat. Sie erreicht somit
jedes Replikat – und bei einem [Split Deployment](/docs/deployment/split-processes/)
auch den Worker, wenn die Anfrage von einem `api`-Prozess bedient wurde, auf dem keine Timer laufen.
Sie übersteht außerdem Neustarts und erneute Deployments: Ein in Studio pausierter Job bleibt pausiert.

`$TOKEN` ist ein Admin-Access-Token und `$API_URL` die Adresse, die `rebase dev`
ausgegeben hat – siehe die [REST API](/docs/backend/cron-jobs-api/).

```bash
# Pause, for every process, until someone resumes it
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Stop overriding: follow the `enabled` the job's file declares again
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` und `false` überschreiben das `enabled` in der Datei des Jobs; `null` entfernt die
Überschreibung. Die Zeile erfasst, wer die Änderung vorgenommen hat und wann.

Jeder Scheduler liest den Status, wenn ein Slot fällig wird, bevor er den
Slot beansprucht – eine Abfrage pro Auslösung –, sodass ein pausierter Job seinen Slot nicht verbraucht und ein
auf einem Replikat fortgesetzter Job bei seinem nächsten Slot auf dem Replikat ausgeführt wird, welches ihn beansprucht.
Auch Catch-up beim Systemstart liest diesen Status.

Falls der Status nicht gelesen werden kann – weil die Tabelle fehlt oder die Datenbank kurzzeitig
nicht erreichbar ist –, fällt der Scheduler auf das `enabled` in der Datei des Jobs zurück und
protokolliert eine Warnung. Dies ist beabsichtigt: Ein geplanter Durchlauf schlägt „fail-open“ fehl, genau wie wenn
die Claims-Tabelle nicht antworten kann, da eine defekte Tabelle nicht stillschweigend
jeden Job stoppen darf. Wenn die Änderung selbst nicht gespeichert werden kann, antwortet das `PUT` mit `503`, und kein
Prozess wird verändert.

Mit `cronPersistence: false` gibt es
keinen Ort, um den Status beizubehalten: Eine Pause gilt nur für den Prozess, der sie verarbeitet hat, und
geht beim Neustart verloren.

---

## Concurrency Guarding

Um die Stabilität bei der Ausführung ressourcenintensiver Vorgänge zu gewährleisten, implementiert Rebase eine strikte **Single-Concurrency-Ausführungssperre** pro Job-ID:
- **Geplante Überschneidungen (Scheduled Overlaps)**: Wenn der geplante Tick eines Jobs ausgelöst wird, während die vorherige Ausführung noch läuft, überspringt der Scheduler den Tick und plant sofort den nächsten Kandidatendurchlauf.
- **Kollisionen bei manueller Auslösung (Manual Trigger Collisions)**: Wenn ein Operator einen laufenden Job manuell über Rebase Studio oder die REST-API auslöst, antwortet die Anfrage mit `409` und dem Code `CRON_JOB_ALREADY_EXECUTING`, was den aktiven Worker schützt. `details.log` entspricht dem unten beschriebenen Skip-Eintrag.

In beiden Fällen wird eine Zeile in `rebase.cron_logs` geschrieben, sodass das Überspringen
in der Ausführungshistorie und nicht nur im Prozessprotokoll auftaucht:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true`, weil nichts fehlgeschlagen ist – `result.skipped` kennzeichnet dies. Eine
Reihe davon hintereinander ist das typische Muster eines Jobs, der seinem Zeitplan entwachsen ist,
und das ist ein Muster, das man nur erkennen kann, wenn die Überspringungen protokolliert werden.

Die Sperre gilt
über Prozesse hinweg, nicht nur innerhalb eines einzelnen. Jeder Durchlauf – ob geplant, manuell oder ein
Catch-up – bezieht vor dem Start seines Handlers einen **Run-Lease** in `rebase.cron_job_state`
und gibt ihn frei, sobald der Durchlauf endet. Daher antwortet ein manueller Auslöser aus dem `api`-Prozess,
während der Worker den Job ausführt, mit `409`, und ein Slot, der fällig wird,
während ein manueller Durchlauf den Lease auf einem anderen Prozess hält, wird übersprungen. Die Protokollzeile des
Überspringens nennt den Prozess, der den Lease hält.

Ein Lease dauert so lange wie `timeoutSeconds` des Jobs plus 30 Sekunden, was
auch einen Job freigibt, dessen Prozess mitten im Durchlauf abgestürzt ist. Ein Job mit `timeoutSeconds: Infinity`
hält ihn maximal eine Stunde lang: Ein Absturz blockiert den Job dann für eine Stunde anstatt
für immer, und ein Durchlauf, der nach einer Stunde immer noch aktiv ist, hindert keinen anderen
Prozess mehr daran, den Job zu starten. Ein Job, der berechtigterweise stundenlang läuft, sollte
ein endliches `timeoutSeconds` angeben, nach dem sich der Lease dann richtet. Wenn der Lease nicht
erhalten werden kann, weil die Datenbank nicht antwortet, wird der Durchlauf mit einer Warnung fortgesetzt,
genauso wie ein geplanter Durchlauf verfährt, wenn sein Claim nicht gelesen werden kann.
