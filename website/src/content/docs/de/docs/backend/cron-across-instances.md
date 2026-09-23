---
sourceHash: cae06a81ae018c4f
title: Cron über mehrere Instanzen
sidebar_label: Cron über mehrere Instanzen
description: "Wie sich Cron-Jobs mit mehr als einem Server-Prozess verhalten: eine Ausführung pro Slot, ein Slot, den ein Neustart verloren hat, eine Pause, die jede Replik einhält, und Ausführungen, die sich nie überschneiden."
---

[Cron-Jobs](/docs/backend/cron-jobs) laufen in jedem Prozess, dessen Scheduler
eingeschaltet ist: standardmäßig in jeder Replik, bei einem
[aufgeteilten Deployment](/docs/deployment/split-processes/) nur im Worker. Jeder
dieser Prozesse stellt dieselben Timer, und die Datenbank verhindert, dass sie
sich gegenseitig in die Quere kommen — ein Claim pro `(job, slot)`, damit ein
Slot einmal läuft; ein Nachholen für einen Slot, den ein Neustart verloren hat;
und eine Zeile pro Job in `rebase.cron_job_state` mit der Pause, die jede Replik
liest, und der Lease, die eine Ausführung hält, solange sie läuft.

Das alles braucht eine SQL-Datenbank; die Tabellen stehen unter
[Datenbankschema für Persistenz](/docs/backend/cron-jobs/#database-persistence-schema).
Unter MongoDB oder mit `cronPersistence: false` koordiniert nichts die Prozesse:
Jeder führt jeden Job aus, schalten Sie den Scheduler also nur in einem davon ein
(`REBASE_CRON_SCHEDULER`).

## Wiederherstellung verpasster Slots

Da der Scheduler den nächsten Slot bei jedem Start ausgehend von *jetzt* berechnet, wird ein Slot nur ausgeführt, wenn eine Instanz aktiv war und lief, als er an der Reihe war. Alles, was den Prozess während eines Slots ersetzt – ein Rolling Deploy, ein Absturz, eine Plattform, die den Container recycelt – lässt diesen Durchlauf ausfallen, und der Ersatz plant den Slot *danach*. Es tritt kein Fehler auf; die Ausführung findet einfach nie statt.

Dies ist **nicht** nur ein Scale-to-Zero-Problem. Ein Dienst, der an eine Warm-Instanz gebunden ist, verliert dennoch Ausführungen, da es einer Plattform freisteht, die Instanz mit dem Timer zu beenden und eine neue zu starten.

Setzen Sie `catchUpWindowSeconds` auf ein Zeitfenster, das spürbar größer als ein Neustart ist, und der Startprozess führt einen Slot aus, den er innerhalb dieses Fensters als nicht beansprucht vorfindet:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Drei wichtige Dinge dazu:

- **Standardmäßig deaktiviert.** Ohne `catchUpWindowSeconds` bleibt das Verhalten unverändert.
- **Nur der jüngste verpasste Slot wird ausgeführt.** Ein Start nach einem sechsstündigen Ausfall holt einen stündlichen Job einmal nach, nicht sechsmal. Das Nachholen verhindert, dass eine Ausführung verloren geht; es spielt nicht die Historie erneut ab.
- **Ein Store mit Claim-Unterstützung ist erforderlich.** Das Nachholen beansprucht den Slot über denselben `(job_id, slot)`-Schlüssel, den auch der reguläre Zeitplanpfad verwendet. Dies ist das Einzige, was unterscheidet zwischen „dieser Slot wurde nie ausgeführt“ und „dieser Slot wurde bereits auf der Instanz ausgeführt, die ersetzt wird“. Wenn kein Store angebunden ist, wird das Nachholen übersprungen und eine Warnung protokolliert – andernfalls würde eine Instanz, die alle 30 Minuten recycelt wird, denselben stündlichen Job bei jedem Start erneut ausführen.

Im Normalfall – ein Neustart wenige Minuten nachdem ein Slot regulär ausgeführt wurde – ist der jüngste Slot bereits beansprucht, sodass das Nachholen lediglich eine Claim-Prüfung pro Job beim Start erfordert und nichts weiter unternimmt.

Beim Start werden Claims gelöscht, die älter als sieben Tage sind, der jüngste Claim jedes Jobs bleibt jedoch immer erhalten, unabhängig von seinem Alter. Dieser Claim ist der Nachweis, dass der Slot bereits ausgeführt wurde, sodass ein monatlicher Job mit einem monatsweiten Nachholfenster nicht durch ein Deployment am 10. erneut ausgeführt wird.

Ein nachgeholter Durchlauf ist ein normaler Eintrag in `cron_logs` (`manual` ist `false`), wobei die erste Log-Zeile den nachgeholten Slot und die Verspätung festhält:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Einen Job in allen Prozessen pausieren

<span class="since-badge" data-since="0.23">Since 0.23</span> Eine Pause wird in
`rebase.cron_job_state` gespeichert, nicht im Speicher des Prozesses, der die
Anfrage beantwortet hat. Sie erreicht daher jede Replik — und bei einem
[aufgeteilten Deployment](/docs/deployment/split-processes/) auch den Worker, wenn
die Anfrage von einem `api`-Prozess beantwortet wurde, der keine Timer ausführt.
Sie übersteht außerdem Neustarts und Redeploys: Ein in Studio pausierter Job
bleibt pausiert.

`$TOKEN` ist ein Admin-Access-Token und `$API_URL` die Adresse, die
`rebase dev` ausgegeben hat — siehe [REST-API](/docs/backend/cron-jobs/#rest-api).

```bash
# Pausieren, für jeden Prozess, bis jemand ihn fortsetzt
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Nicht mehr überschreiben: wieder dem `enabled` aus der Datei des Jobs folgen
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` und `false` überschreiben das `enabled` in der Datei des Jobs; `null`
entfernt die Überschreibung. Die Zeile hält fest, wer die Änderung wann
vorgenommen hat.

Jeder Scheduler liest den Zustand, wenn ein Slot fällig wird, bevor er den Slot
beansprucht — eine Abfrage pro Auslösung. Ein pausierter Job verbraucht seinen
Slot also nicht, und ein auf einer Replik fortgesetzter Job läuft beim nächsten
Slot auf der Replik, die ihn beansprucht. Das Nachholen beim Start liest ihn
ebenfalls.

Kann der Zustand nicht gelesen werden — die Tabelle fehlt, die Datenbank ist
kurz nicht erreichbar —, greift der Scheduler auf das `enabled` in der Datei des
Jobs zurück und protokolliert eine Warnung. Das ist Absicht: Eine geplante
Ausführung schlägt offen fehl, wie auch dann, wenn die Claims-Tabelle nicht
antworten kann, denn eine defekte Tabelle darf nicht stillschweigend jeden Job
anhalten. Kann die Änderung selbst nicht gespeichert werden, antwortet der `PUT`
mit `503`, und kein Prozess wird geändert.

Ohne SQL-Datenbank (MongoDB) oder mit `cronPersistence: false` gibt es keinen Ort
für den Zustand: Eine Pause gilt für den Prozess, der die Anfrage beantwortet
hat, und ist nach einem Neustart verloren.

---

## Concurrency Guarding

Um Stabilität bei ressourcenintensiven Vorgängen zu gewährleisten, implementiert Rebase eine strikte **Single-Concurrency-Ausführungssperre** pro Job-ID:
- **Geplante Überschneidungen**: Wenn der geplante Tick eines Jobs ausgelöst wird, während die vorherige Ausführung noch läuft, überspringt der Scheduler den Tick und plant sofort den nächsten Kandidatenlauf.
- **Kollisionen bei manuellem Trigger**: Wenn ein Operator einen laufenden Job manuell über Rebase Studio oder die REST-API auslöst, antwortet die Anfrage mit `409` und dem Code `CRON_JOB_ALREADY_EXECUTING`, um den aktiven Worker zu schützen. `details.log` ist der unten beschriebene Eintrag des Überspringens.

In beiden Fällen wird eine Zeile in `rebase.cron_logs` geschrieben, sodass das Überspringen im Ausführungsverlauf und nicht nur im Prozesslog sichtbar ist:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true`, weil nichts fehlgeschlagen ist – `result.skipped` kennzeichnet den Vorgang. Mehrere dieser Einträge hintereinander weisen darauf hin, dass ein Job über seinen Zeitplan hinausgewachsen ist – ein Muster, das man nur erkennt, wenn die Übersprünge protokolliert werden.

<span class="since-badge" data-since="0.23">Since 0.23</span> Die Sperre gilt prozessübergreifend,
nicht nur innerhalb eines Prozesses. Jede Ausführung — geplant, manuell oder
nachgeholt — nimmt vor dem Start ihres Handlers eine **Run-Lease** in
`rebase.cron_job_state` und gibt sie am Ende der Ausführung wieder frei. Ein
manueller Trigger aus dem `api`-Prozess, während der Worker den Job ausführt,
antwortet daher mit `409`, und ein Slot, der fällig wird, während eine manuelle
Ausführung in einem anderen Prozess die Lease hält, wird übersprungen. Die
Log-Zeile des Überspringens nennt den Prozess, der die Lease hält.

Eine Lease dauert `timeoutSeconds` des Jobs plus 30 Sekunden; das ist auch das,
was einen Job freigibt, dessen Prozess mitten in der Ausführung abgestürzt ist.
Ein Job mit `timeoutSeconds: Infinity` hält sie höchstens eine Stunde: Ein
Absturz blockiert den Job dann eine Stunde statt für immer, und eine Ausführung,
die nach einer Stunde noch läuft, hält einen anderen Prozess nicht mehr davon ab,
den Job zu starten. Ein Job, der legitimerweise stundenlang läuft, sollte ein
endliches `timeoutSeconds` angeben, dem seine Lease dann folgt. Kann die Lease
nicht genommen werden, weil die Datenbank nicht antwortet, läuft die Ausführung
mit einer Warnung weiter, so wie eine geplante Ausführung, deren Claim nicht
gelesen werden kann.
