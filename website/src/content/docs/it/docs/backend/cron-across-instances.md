---
sourceHash: eb2b1e4f16ef2812
title: Cron su più istanze
sidebar_label: Cron su più istanze
description: "Come si comportano i cron job con più di un processo server: un'esecuzione per slot, uno slot perso a causa di un riavvio, una pausa rispettata da ogni replica ed esecuzioni che non si sovrappongono mai."
---

I [cron job](/docs/backend/cron-jobs) vengono eseguiti in ogni processo il cui scheduler è attivo:
ogni replica per impostazione predefinita, o solo il worker in un
[deployment suddiviso](/docs/deployment/split-processes/). Ciascuno di questi processi
imposta gli stessi timer e il database è ciò che impedisce loro di interferire tra
loro — un claim per `(job, slot)`, in modo che uno slot venga eseguito una sola volta; un
recupero (catch-up) per uno slot perso a causa di un riavvio; e una riga per job in `rebase.cron_job_state`,
che memorizza la pausa letta da ogni replica e il lease detenuto da un'esecuzione mentre è attiva.

Le tabelle sono elencate in
[Database Persistence Schema](/docs/backend/cron-jobs/#database-persistence-schema).
Con `cronPersistence: false`, nulla coordina i processi:
ciascuno di essi esegue ogni job, quindi attiva lo scheduler in uno solo di essi
(`REBASE_CRON_SCHEDULER`).

## Recupero degli slot persi

Poiché lo scheduler calcola il prossimo slot a partire da *adesso* a ogni avvio, uno slot viene attivato solo se qualche istanza era attiva e funzionante al momento opportuno. Qualsiasi evento che sostituisca il processo durante uno slot — un rolling deploy, un crash, una piattaforma che ricicla il container — perde tale esecuzione e il processo sostitutivo pianifica lo slot *successivo*. Non viene generato alcun errore; l'esecuzione semplicemente non ha mai luogo.

Questo **non** è solo un problema di scale-to-zero. Un servizio associato a un'istanza sempre attiva (warm) perde comunque esecuzioni, poiché una piattaforma è libera di dismettere l'istanza che gestisce il timer e avviarne una nuova.

Imposta `catchUpWindowSeconds` su un intervallo ampiamente superiore alla durata di un riavvio, e all'avvio verrà eseguito uno slot trovato non rivendicato all'interno di tale finestra:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Tre aspetti da tenere a mente:

- **Disattivato per impostazione predefinita.** Senza `catchUpWindowSeconds`, il comportamento rimane invariato.
- **Viene eseguito solo lo slot perso più recente.** Il riavvio dopo un'interruzione di sei ore recupera un job orario una sola volta, non sei volte. Il catch-up impedisce che un'esecuzione vada persa; non ripete la cronologia passata.
- **È richiesto uno store che supporti i claim.** Il catch-up rivendica lo slot tramite la stessa chiave `(job_id, slot)` utilizzata dal percorso pianificato, che è l'unico elemento in grado di distinguere "questo slot non è mai stato eseguito" da "questo slot è già stato eseguito sull'istanza in fase di sostituzione". In assenza di uno store collegato, il catch-up viene ignorato e viene registrato un avviso — altrimenti un'istanza riciclata ogni 30 minuti rieseguirebbe lo stesso job orario a ogni avvio.

Nel caso ordinario — un riavvio pochi minuti dopo la normale esecuzione di uno slot — lo slot più recente è già stato rivendicato, quindi il catch-up richiede un solo controllo del claim per job a ogni avvio e non fa nulla.

Lo scheduler elimina i claim più vecchi di sette giorni all'avvio e successivamente ogni ora, ma conserva sempre l'ultimo per ciascun job, indipendentemente dalla sua età. Quel claim è la prova che lo slot è già stato eseguito, quindi un job mensile con una finestra di catch-up di un mese non verrà rieseguito da un deploy il giorno 10.

Un'esecuzione recuperata è una normale voce in `cron_logs` (`manual` è `false`), con una prima riga di log che registra lo slot recuperato e il ritardo accumulato:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Sospendere un job su tutti i processi

Una pausa viene memorizzata
in `rebase.cron_job_state`, non nella memoria del processo che l'ha gestita, quindi
raggiunge ogni replica — e, in un [deployment suddiviso](/docs/deployment/split-processes/),
il worker, quando la richiesta è stata gestita da un processo `api` che non esegue timer.
Sopravvive inoltre a riavvii e nuovi deploy: un job sospeso in Studio rimane sospeso.

`$TOKEN` è un token di accesso di amministrazione e `$API_URL` l'indirizzo stampato da `rebase dev`
— vedi la [REST API](/docs/backend/cron-jobs-api/).

```bash
# Pause, for every process, until someone resumes it
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Stop overriding: follow the `enabled` the job's file declares again
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` e `false` sovrascrivono l'`enabled` nel file del job; `null` rimuove
l'override. La riga registra chi ha effettuato la modifica e quando.

Ogni scheduler legge lo stato quando uno slot giunge a scadenza, prima di
rivendicarlo — una query per attivazione — in modo che un job sospeso non consumi il
suo slot, e un job riattivato su una replica venga eseguito al suo prossimo slot su qualunque replica lo rivendichi.
Anche il catch-up all'avvio legge questo stato.

Se lo stato non può essere letto — la tabella non esiste, il database è temporaneamente
non raggiungibile — lo scheduler ricorre al valore di `enabled` definito nel file del job e
registra un avviso. Questo comportamento è intenzionale: un'esecuzione pianificata adotta una strategia di "fail-open", esattamente come quando la tabella dei claim non può rispondere, perché una tabella non funzionante non deve arrestare silenziosamente ogni job. Se la modifica stessa non può essere salvata, la richiesta `PUT` risponde con `503` e nessun processo viene modificato.

Con `cronPersistence: false` non c'è
alcun posto in cui conservare lo stato: una pausa si applica solo al processo che l'ha gestita e
svanisce al riavvio.

---

## Protezione dalla concorrenza

Per garantire stabilità durante l'esecuzione di operazioni che richiedono molte risorse, Rebase implementa un rigoroso **lock di esecuzione a concorrenza singola** per ID di job:
- **Sovrapposizioni pianificate**: Se il tick pianificato di un job scatta mentre l'esecuzione precedente è ancora in corso, lo scheduler salta il tick e pianifica immediatamente la successiva esecuzione candidata.
- **Collisioni da trigger manuale**: Se un operatore attiva manualmente un job già in esecuzione tramite Rebase Studio o la REST API, la richiesta risponde con `409` e con il codice `CRON_JOB_ALREADY_EXECUTING`, proteggendo il worker attivo. `details.log` contiene la voce di salto descritta di seguito.

In entrambi i casi viene scritta una riga in `rebase.cron_logs`, in modo che il salto sia presente
nella cronologia delle esecuzioni anziché solo nel log del processo:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` perché nulla è fallito — `result.skipped` è ciò che lo contrassegna. Una
sequenza consecutiva di questi eventi è il segno distintivo di un job che ha superato i limiti della sua pianificazione,
ed è un pattern visibile solo se i salti vengono registrati.

Il lock è valido
tra i processi, non solo all'interno di uno solo. Ogni esecuzione — pianificata, manuale o
di catch-up — acquisisce un **lease di esecuzione** in `rebase.cron_job_state` prima dell'avvio del
relativo handler, e lo rilascia al termine dell'esecuzione. Pertanto, un trigger manuale dal processo `api`
mentre il worker sta eseguendo il job risponde con `409`, e uno slot che scade mentre un'esecuzione manuale detiene il lease su un altro processo viene saltato. La riga di log del salto riporta il nome del processo che detiene il lease.

Un lease dura quanto il `timeoutSeconds` del job più 30 secondi, il che consente
anche di sbloccare un job il cui processo si è interrotto bruscamente durante l'esecuzione. Un job con `timeoutSeconds: Infinity`
lo detiene per un massimo di un'ora: un crash in questo caso blocca il job per un'ora anziché
indefinitamente, e un'esecuzione ancora attiva dopo un'ora non impedisce più a un altro processo di avviare il job. Un job che legittimamente richiede ore di esecuzione dovrebbe specificare un `timeoutSeconds` finito, a cui il lease si adeguerà. Se non è possibile acquisire il lease a causa dell'impossibilità del database di rispondere, l'esecuzione prosegue con un avviso, analogamente a quanto fa un'esecuzione pianificata quando il relativo claim non può essere letto.
