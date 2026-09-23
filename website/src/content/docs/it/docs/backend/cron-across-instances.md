---
sourceHash: cae06a81ae018c4f
title: Cron su più istanze
sidebar_label: Cron su più istanze
description: "Come si comportano i cron job con più di un processo server: un'esecuzione per slot, uno slot perso per un riavvio, una pausa rispettata da ogni replica ed esecuzioni che non si sovrappongono mai."
---

I [cron job](/docs/backend/cron-jobs) girano in ogni processo il cui scheduler è
attivo: in ogni replica per impostazione predefinita, o solo nel worker in un
[deployment suddiviso](/docs/deployment/split-processes/). Ognuno di questi
processi arma gli stessi timer, ed è il database a impedire che si pestino i
piedi — un claim per `(job, slot)`, così uno slot viene eseguito una sola volta;
un recupero per uno slot perso per un riavvio; e una riga per job in
`rebase.cron_job_state`, con la pausa che ogni replica legge e il lease che
un'esecuzione detiene finché dura.

Tutto questo richiede un database SQL; le tabelle sono elencate in
[Schema di persistenza nel database](/docs/backend/cron-jobs/#database-persistence-schema).
Su MongoDB, o con `cronPersistence: false`, nulla coordina i processi: ognuno
esegue ogni job, quindi attiva lo scheduler in uno solo di essi
(`REBASE_CRON_SCHEDULER`).

## Recupero degli slot mancati

Poiché lo scheduler calcola lo slot successivo a partire da *adesso* a ogni avvio, uno slot viene eseguito solo se un'istanza era attiva e in esecuzione quando è giunto il momento. Qualsiasi evento che sostituisca il processo durante uno slot — un rolling deploy, un arresto anomalo, una piattaforma che ricicla il container — perde tale esecuzione e l'istanza sostitutiva pianifica lo slot *successivo*. Non si verificano errori; semplicemente l'esecuzione non ha mai luogo.

Questo **non** è un problema esclusivo dello scale-to-zero. Anche un servizio vincolato a un'istanza sempre attiva può perdere esecuzioni, poiché la piattaforma è libera di dismettere l'istanza che gestisce il timer e avviarne una nuova.

Imposta `catchUpWindowSeconds` su un intervallo ampiamente superiore al tempo di riavvio, e all'avvio verrà eseguito qualsiasi slot trovato non reclamato all'interno di tale finestra:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Tre cose da sapere:

- **Disattivato per impostazione predefinita.** Senza `catchUpWindowSeconds`, il comportamento resta invariato.
- **Viene eseguito solo lo slot mancato più recente.** Un riavvio dopo sei ore di inattività recupererà un job orario una sola volta, non sei. Il recupero evita che una singola esecuzione vada persa; non riesegue l'intera cronologia.
- **È richiesto uno store che supporti i claim.** Il recupero reclama lo slot tramite la stessa chiave `(job_id, slot)` utilizzata dal percorso pianificato, che è l'unico elemento che distingue "questo slot non è mai stato eseguito" da "questo slot è già stato eseguito sull'istanza che è stata sostituita". In assenza di uno store collegato, il recupero viene ignorato e viene registrato un avviso — altrimenti un'istanza riciclata ogni 30 minuti rieseguirebbe lo stesso job orario a ogni avvio.

Nel caso tipico — un riavvio pochi minuti dopo la normale esecuzione di uno slot — lo slot più recente è già stato reclamato, quindi il recupero costa un solo controllo di claim per job a ogni avvio e non intraprende alcuna azione.

All'avvio vengono eliminati i claim più vecchi di sette giorni, ma quello più recente di ogni job viene sempre mantenuto, qualunque sia la sua età. Quel claim è la prova che lo slot è già stato eseguito, quindi un job mensile con una finestra di recupero di un mese non viene rieseguito da un deploy il giorno 10.

Un'esecuzione recuperata è una voce normale in `cron_logs` (`manual` è `false`), con una prima riga di log che indica lo slot recuperato e il relativo ritardo:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Mettere in pausa un job in tutti i processi

<span class="since-badge" data-since="0.23">Since 0.23</span> Una pausa viene salvata in
`rebase.cron_job_state`, non nella memoria del processo che ha servito la
richiesta, quindi raggiunge ogni replica — e, in un
[deployment suddiviso](/docs/deployment/split-processes/), il worker, quando la
richiesta è stata servita da un processo `api` che non esegue timer. Sopravvive
anche a riavvii e nuovi deploy: un job messo in pausa in Studio resta in pausa.

`$TOKEN` è un token di accesso da amministratore e `$API_URL` l'indirizzo
stampato da `rebase dev`; vedi l'[API REST](/docs/backend/cron-jobs/#rest-api).

```bash
# Mettere in pausa, per ogni processo, finché qualcuno non lo riprende
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Smettere di sovrascrivere: tornare a seguire l'`enabled` dichiarato nel file del job
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` e `false` sovrascrivono l'`enabled` nel file del job; `null` rimuove la
sovrascrittura. La riga registra chi ha fatto la modifica e quando.

Ogni scheduler legge lo stato quando uno slot arriva a scadenza, prima di
rivendicarlo — una query per esecuzione —, così un job in pausa non consuma il
suo slot, e un job ripreso su una replica viene eseguito allo slot successivo
sulla replica che lo rivendica. Anche il recupero all'avvio lo legge.

Se lo stato non può essere letto — tabella mancante, database momentaneamente
irraggiungibile —, lo scheduler ricade sull'`enabled` nel file del job e registra
un avviso. È voluto: un'esecuzione pianificata fallisce in modo aperto, come
quando la tabella dei claim non può rispondere, perché una tabella guasta non
deve fermare in silenzio tutti i job. Se la modifica stessa non può essere
salvata, il `PUT` risponde `503` e nessun processo viene modificato.

Senza un database SQL (MongoDB) o con `cronPersistence: false` non c'è dove
conservare lo stato: una pausa si applica al processo che l'ha servita e si perde
al riavvio.

---

## Protezione della concorrenza

Per garantire la stabilità durante l'esecuzione di operazioni ad alta intensità di risorse, Rebase implementa un rigoroso **blocco di esecuzione a concorrenza singola** per ID job:
- **Sovrapposizioni pianificate**: se il tick pianificato di un job scatta mentre l'esecuzione precedente è ancora in corso, lo scheduler ignora il tick e pianifica immediatamente la successiva esecuzione candidata.
- **Collisioni con avvio manuale**: se un operatore avvia manualmente un job già in esecuzione tramite Rebase Studio o l'API REST, la richiesta risponde `409` con il codice `CRON_JOB_ALREADY_EXECUTING`, proteggendo il worker attivo. `details.log` è la voce di esecuzione saltata descritta sotto.

In entrambi i casi viene scritta una riga in `rebase.cron_logs`, così che l'omissione rimanga tracciata nella cronologia delle esecuzioni anziché solo nei log di processo:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` perché nulla è fallito — è `result.skipped` a contrassegnarlo. Una sequenza consecutiva di questi eventi indica chiaramente che un job richiede più tempo rispetto all'intervallo pianificato, un pattern che può essere individuato solo se le omissioni vengono registrate.

<span class="since-badge" data-since="0.23">Since 0.23</span> Il blocco vale tra processi, non solo
all'interno di uno. Ogni esecuzione — pianificata, manuale o di recupero — prende
un **lease di esecuzione** in `rebase.cron_job_state` prima che il suo handler
parta, e lo rilascia quando l'esecuzione termina. Così un avvio manuale dal
processo `api` mentre il worker sta eseguendo il job risponde `409`, e uno slot
che arriva a scadenza mentre un'esecuzione manuale detiene il lease in un altro
processo viene saltato. La riga di log del salto indica il processo che detiene
il lease.

Un lease dura il `timeoutSeconds` del job più 30 secondi, ed è anche ciò che
libera un job il cui processo è andato in crash a metà esecuzione. Un job con
`timeoutSeconds: Infinity` lo detiene al massimo per un'ora: un crash blocca
allora il job per un'ora invece che per sempre, e un'esecuzione ancora in corso
dopo un'ora non impedisce più a un altro processo di avviare il job. Un job che
legittimamente dura ore dovrebbe indicare un `timeoutSeconds` finito, che il suo
lease segue. Se il lease non può essere preso perché il database non risponde,
l'esecuzione procede con un avviso, come un'esecuzione pianificata il cui claim
non può essere letto.
