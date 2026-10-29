---
sourceHash: bf0e0428a86e411f
title: Notifiche di Cloud
sidebar_label: Notifiche
description: Come Rebase Cloud avvisa le persone quando un deploy fallisce, i backup si fermano, un pagamento viene rifiutato o l'utilizzo supera l'80% — webhook firmati verso Slack, Discord o qualsiasi URL, ed email per singola persona.
---

La piattaforma avvisa le persone quando un deploy fallisce, un database smette di essere
sottoposto a backup, un pagamento viene rifiutato, o un progetto supera l'80% e poi il 100%
della quota del mese.
Fa parte di [Rebase Cloud](/docs/deployment/cloud/), e ogni comando qui riportato
è nel [riferimento cloud della CLI](/docs/cli/cloud/).

## Webhook

Un progetto può inviare questi eventi a un webhook in ingresso di Slack o Discord,
o a qualsiasi URL https, da **Settings → Notifications** nella
console o con la CLI:

```bash
rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX
rebase cloud notifications add https://ops.example.com/rebase --events deploy.failed,backup.unhealthy
rebase cloud notifications test <id>
rebase cloud notifications            # each destination, and how its last delivery went
rebase cloud notifications remove <id>
```

Gli eventi sono `deploy.failed` (quello predefinito), `deploy.succeeded`,
`deploy.rolled_back`, `backup.unhealthy`, `billing.payment_failed`,
`usage.threshold` e `preview.paused` (un'anteprima del backend il cui database è cresciuto
oltre il limite delle anteprime è stata fermata). Ogni POST è JSON con un `type`, il `project`, i fatti
dell'evento, un `url` della console e un `text` di una riga. Slack mostra il `text` come
messaggio, quindi l'URL di un webhook in ingresso di Slack funziona senza alcuna configurazione. Per Discord,
aggiungi `/slack` alla fine dell'URL del suo webhook. `--format slack` invia solo `{ "text" }`,
per un ricevente che rifiuta i campi che non conosce. Il log di una build
non finisce mai in un webhook.

Ogni POST è firmato: `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>`
(l'HMAC-SHA256 del body grezzo, in esadecimale), con il secret mostrato una sola volta quando la destinazione viene aggiunta. Include anche
`X-Webhook-Event` e un id `X-Webhook-Delivery` che resta lo stesso
in tutti i tentativi di una stessa consegna. Una consegna viene tentata tre volte, a distanza di 1 e 5
secondi, con 5 secondi per ciascun tentativo. Un 4xx diverso da 429, un reindirizzamento o un indirizzo rifiutato
non viene ritentato. L'URL deve essere https. Il control plane rifiuta un URL che si risolve in un
indirizzo privato, di loopback, link-local o dei metadati cloud, sia quando viene
aggiunto sia sull'indirizzo a cui si connette ogni consegna. Qualsiasi membro
dell'organizzazione può elencare le destinazioni di un progetto, con i loro URL mascherati.
Aggiungerne, testarne e rimuoverne una richiede il ruolo di owner o admin.

## Email

Ogni membro sceglie quali email ricevere, per organizzazione, in
**Account → Notifications** nella console. I fallimenti sono attivi per impostazione predefinita: un
deploy fallito va a chi lo ha avviato e agli owner e agli admin. Un
deploy riuscito è disattivato per impostazione predefinita e, una volta attivato, va solo a chi lo
ha avviato. Un pagamento rifiutato va agli owner e all'email di fatturazione, una volta per
fattura. Un backup non funzionante va a owner e admin al massimo una volta al giorno per
database. Ogni soglia di utilizzo viene inviata una volta al mese per progetto. Un control plane
senza posta in uscita configurata non invia alcuna email, e quella pagina lo dice.
I webhook funzionano comunque.

Ogni evento raggiunge ogni persona o destinazione una sola volta, a prescindere da quante volte
venga segnalato. Un deploy annullato da una persona e un aggiornamento della piattaforma
riuscito non vengono segnalati.

`rebase cloud webhooks` è stato dismesso. Non ha mai consegnato nulla, e ora ogni
azione termina con codice 1 e `command_retired`. Per ricevere un POST quando cambiano righe
nelle tabelle della tua app, usa un `WebhookDispatcher` nel codice della tua app (vedi
[la ricetta sui webhook](/docs/recipes/webhooks/)).
