---
sourceHash: 77b432f86f85bc82
title: Cosa non include la beta di Rebase Cloud
sidebar_label: Limiti della beta di Cloud
description: Cosa non fa ancora la beta privata di Rebase Cloud — regioni, accesso self-service, uno SLA, deploy dei branch, identità macchina, un endpoint di database pubblico — e cosa comporta il deploy con i segreti di produzione.
---

[Rebase Cloud](/docs/deployment/cloud/) è in versione beta privata. Detto chiaramente, perché scoprirlo più tardi è peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di posizionamento esiste nella piattaforma, ma un progetto non può scegliere una regione.
  `projects create --provider` e `--region` non sono l'eccezione che sembrano: registrano a quale delle destinazioni di deploy registrate del piano di controllo appartiene un progetto, e ce n'è solo una, quindi entrambi assumono tale valore predefinito e nessuno dei due sposta il progetto altrove. `rebase cloud projects create --help` indica la stessa cosa.
- **Nessun accesso self-service.** L'accesso viene concesso a scaglioni; non è possibile registrarsi e pagare direttamente.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno di uno dei due, segnalalo al momento della richiesta di accesso invece di darlo per scontato.
- **Nessun deploy dei branch** e nessuna GitHub App ufficiale. I deploy hook — URL segreti verso cui puntare un webhook del repository — sono l'automazione supportata. I [deploy di anteprima](/docs/deployment/cloud/#preview-a-change) sono in fase di rilascio e vengono avviati dalla CLI.
- **I token agiscono per conto di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account e agisce come tale; non esiste ancora un'identità macchina appartenente all'organizzazione. Se invece effettui l'accesso dalla CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un archivio di segreti — `--password` inserisce la password nella cronologia della shell e nella tabella dei processi, e lo segnala prima di effettuare l'accesso. Se il file `.rebase/cloud.json` del repository indica un piano di controllo diverso da quello della piattaforma, passalo anche come `--url`: senza un terminale, `login` rifiuta di inviare una password a un host specificato solo dal file del repository clonato.
- **Nessun endpoint di database pubblico.** Un database gestito non è esposto a Internet, quindi l'host mostrato dalla console è l'indirizzo usato dal tuo backend e non è raggiungibile sulla tua macchina locale. `rebase cloud db connect` apre una porta locale collegata a quel database, tramite un tunnel attraverso il piano di controllo, per tutto il tempo in cui lo lasci in esecuzione — ma non esiste un hostname permanente a cui un servizio di terze parti possa connettersi. Per eseguire SQL senza un client Postgres locale, `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` apre lo stesso tunnel per una singola query, esegue il testo come un unico script (interrompendosi al primo errore) e stampa la risposta di ciascuna istruzione (`--json` per uno script). Quel tunnel e la password dietro `rebase cloud db info --reveal` richiedono entrambi il ruolo di owner o admin dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutti e tre consentono di operare direttamente sui tuoi dati di produzione.
- **Effettuare il deploy significa eseguire codice con i segreti di produzione.** L'ambiente dell'applicazione contiene `REBASE_SERVICE_KEY` (amministratore sulla propria API), `DATABASE_URL` e `JWT_SECRET`, quindi il codice distribuito da un membro può leggerli, anche se solo owner e admin possono visualizzarli nella console. Invita come membro solo persone a cui affideresti tali valori.
- **La chiave di servizio può essere sostituita.** Dalle **Settings** del progetto (o tramite `rebase cloud service-key rotate`) viene emessa una nuova `REBASE_SERVICE_KEY` e l'applicazione viene riavviata con essa. La vecchia chiave rimane valida fino al termine del riavvio e mai oltre, quindi qualsiasi cosa l'abbia copiata verrà rifiutata da quel momento in poi. Anche il claim di un progetto comporta la stessa operazione.

## Prossimi passi

- [Rebase Cloud](/docs/deployment/cloud/): collegamento, deploy e il resto delle funzionalità.
- [Self-hosting](/docs/deployment/self-hosting/): la stessa immagine e lo stesso bundle, eseguiti direttamente da te.
