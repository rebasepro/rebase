---
sourceHash: b4a48b328135ef8c
title: CI, agenti e backend riscattabili
sidebar_label: CI e agenti
description: Esegui il deploy su Rebase Cloud da CI o da un agente con un token limitato invece di una password, e consenti a un agente di effettuare il provisioning di un backend live senza account che una persona potrà riscattare in seguito.
---

Un progetto [Rebase Cloud](/docs/deployment/cloud/) non richiede una persona al
terminale per effettuare il deploy. Un job di CI o un agente agisce con un token
limitato a poche azioni su un singolo progetto, e un agente può creare un progetto
prima che chiunque abbia un account, per poi consegnare un link per riscattarlo.


## CI e agenti

Un job di CI o un agente non dovrebbe contenere la tua password. Forniscigli
invece un token: una chiave che agisce per conto del tuo account, limitata a
poche azioni su un singolo progetto. Crealo da un terminale autenticato:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Il token viene stampato una sola volta, come riga `export REBASE_TOKEN=rk_live_…`. Con
`REBASE_TOKEN` impostato, ogni comando `rebase cloud` si autentica con esso invece che
con il tuo login, e non legge né scrive mai la sessione memorizzata. In GitHub Actions,
salvalo come secret del repository ed esponilo con quel nome:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` accetta una o più capability, separate da virgola o ripetute:

| Capability | Cosa può fare il token |
|---|---|
| `deploy` | Eseguire il deploy del progetto e seguire le relative build: `deploy` (`--preview` inclusa), `deployments`, `previews` |
| `logs` | Leggere i log di build e di runtime, la cronologia dei cron, le metriche live e l'utilizzo: `logs`, `cron`, `metrics`, `usage` |
| `env` | Leggere e modificare le variabili d'ambiente, inclusi i secret, e quelle delle preview (`--preview`) |
| `database` | `db list`, `db info` e `db connect`, che include la password del database |
| `backups` | Elencare, creare, ispezionare e scaricare backup, e leggere la finestra di point-in-time |

Altre tre capability agiscono su un'organizzazione anziché su un progetto. Un
token ne possiede una solo quando viene indicata da `--can`, sull'organizzazione
specificata da `--org` (o, senza `--org`, l'organizzazione del progetto, poi quella
selezionata con `rebase cloud use`). Un token può contenere queste e nessuna capability di progetto:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capability | Cosa può fare il token |
|---|---|
| `billing` | Leggere la carta registrata, le fatture e la fattura successiva, e modificare l'email di fatturazione: `billing`, `billing invoices`, `billing upcoming`. Solo per proprietari e amministratori |
| `audit` | Leggere il log delle attività dell'organizzazione: `activity`. Solo per proprietari e amministratori |
| `notifications` | Modificare le preferenze email del relativo proprietario e i webhook di notifica dei progetti dell'organizzazione: `notifications`. L'aggiunta, la modifica e la rimozione di un webhook richiedono comunque il ruolo di proprietario o amministratore |

Un token creato prima dell'introduzione di
`billing` continua a leggere i dati di fatturazione per una release. Ciascuna di queste risposte
include un header `Deprecation: true` e una frase che specifica lo scope mancante
nel token, e la CLI la stampa una sola volta su stderr come avviso. Sostituisci
tale token con uno creato con `--can billing` prima della release successiva, quando billing
inizierà a rifiutarlo.

Dietro le quinte, un token è una [chiave API personale](/docs/backend/api-keys/#personal-keys)
sul control plane. Ogni capability si traduce in alcuni
[scope](/docs/backend/roles-and-scopes/): `deploy` su `shop` contiene
`project:deploy:<id>`, con l'ID del progetto, oltre agli scope relativi a dati e funzioni
richiamati dai comandi di deploy. Una capability a livello di organizzazione contiene `org:billing:<id>`,
`org:audit:<id>` o `org:notifications:<id>`, con l'ID dell'organizzazione. Il token non detiene mai più permessi di quanti ne abbia il tuo account nel momento
in cui viene utilizzato, quindi perde qualsiasi permesso perda il tuo account.

Due operazioni rimangono riservate a una persona autenticata:

- **Gestione dei token.** `rebase cloud tokens list`, `create` e `revoke <id>` richiedono
  la sessione di `rebase cloud login`. Un token non può elencare, creare o revocare
  token, poiché un token che potesse generare token potrebbe generare il proprio successore.
- **Ripristino.** Nessuna capability concede il ripristino di un backup o un
  `restore` e `cutover` point-in-time. Sovrascrivere un database in produzione con dati
  precedenti rimane prerogativa di un proprietario o amministratore autenticato.

`rebase cloud whoami` con un token impostato mostra cosa questo può fare e su quale
progetto o organizzazione. La schermata **Access tokens** della console offre le stesse
capability, con quelle relative all'organizzazione nella sezione **Organization access**. `rebase cloud tokens revoke <id> --yes` lo revoca immediatamente.

## Un backend senza account

Un agente che ha sviluppato un'app può dotarla di un backend live prima ancora che qualcuno
si sia registrato, fornendo alla persona per cui lavora un link per conservarlo:

```bash
rebase cloud init --claim
```

Questo esegue il provisioning di un progetto su Rebase Cloud, imposta `REBASE_BASE_URL` in `.env`
con il suo indirizzo live, collega la directory ed esegue il deploy delle tabelle locali con
`rebase cloud deploy --bundle`. Stampa l'URL live, l'URL del pannello di amministrazione e un
**claim URL**. Chiunque apra il claim URL ed effettui l'accesso può spostare il progetto in
una delle proprie organizzazioni. Il link funziona una sola volta. Un progetto che nessuno riscatta entro
72 ore viene eliminato, database compreso. `rebase cloud claim` stampa nuovamente il claim
URL indicando il tempo rimanente, e `--open` lo apre. Il tool
`rebase_cloud_provision` del server MCP esegue lo stesso comando e restituisce gli stessi URL;
gli altri suoi tool cloud possono poi verificare, effettuare il deploy, leggere i log, impostare variabili ed eseguire il rollback
del progetto senza bisogno di login (consulta [MCP server](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` in `.env` è anche la destinazione a cui `rebase api-keys`, `rebase storage`
e `rebase auth reset-password` inviano la service key locale; pertanto, dopo `init
--claim` puntano al progetto cloud, che non accetta tale chiave. Quando ciò accade,
i comandi lo segnalano; imposta `REBASE_BASE_URL` nella shell per raggiungere invece
un backend locale.

Finché il progetto non viene riscattato, non appartiene ad alcun account. Il suo token è limitato
a quel singolo progetto: esegue deploy, legge log e metriche, imposta variabili d'ambiente
ed esegue `db info`. Non legge alcun dato segreto in risposta: né il valore di una variabile (inclusa
la service key), né la password del database, e non può aprire
`db connect` o una preview. Viene conservato in
`~/.rebase/credentials.json`, mai nel repository, e i comandi `rebase cloud`
nella directory collegata lo utilizzano autonomamente. `REBASE_TOKEN`, se impostato,
ha comunque la precedenza se detiene uno scope su quel progetto, e tali comandi avviseranno
che è stato utilizzato; se non ne detiene alcuno (un token di CI creato per altri progetti), viene utilizzato il token
del progetto stesso e il primo comando lo segnala. Un comando a cui viene passato `--project` per
un altro progetto mantiene `REBASE_TOKEN`, mentre il deploy eseguito da `init --claim`
usa sempre il token specifico del progetto. Il token scade insieme al progetto. `rebase cloud whoami` in quella directory mostra il progetto, cosa
può fare il token, il claim URL e la data di scadenza del progetto. Un comando che richiede la sessione di una
persona reale risponde negativamente con `session_required` e mantiene il token; quest'ultimo viene
rimosso solo quando il control plane lo rifiuta ovunque, dopo il riscatto o alla
scadenza, e contestualmente viene stampato il claim URL. Anche `rebase cloud status` mostra il
claim URL e la scadenza (`unclaimed` in `--json`). `rebase cloud unlink`
non elimina un progetto non riscattato: avvisa che il progetto continuerà a funzionare
fino alla scadenza e stampa il claim URL, e `init --claim` in una directory
già collegata a un progetto punterà al relativo claim URL invece di effettuarne il provisioning di un
secondo. Fino al riscatto, l'app è accessibile da Internet solo sulle porte 80 e 443;
le porte di posta disponibili per tutti gli altri progetti (465, 587 e 993) si aprono al momento
del riscatto del progetto.

Una volta che il deploy ha compilato l'app, il comando imposta anche `REBASE_API_TOKEN` in
`.env`: una chiave generata sull'app stessa, ossia ciò che il server MCP e l'SDK
le inviano. Un eventuale `REBASE_API_TOKEN` già presente in `.env` viene mantenuto e non ne viene generato uno nuovo,
e un file `.env` creato dal comando è leggibile solo da te. Questo token legge e scrive dati (`data:read`, `data:write`) tramite
la row-level security dell'app, agendo come chiamante che non è né una persona né un amministratore. Non
possiede privilegi sul piano di amministrazione e scade insieme alla finestra di claim, a meno che il
progetto non venga riscattato prima. Con `--no-deploy`, o quando il primo deploy fallisce,
la chiave non è ancora presente: il successivo comando `rebase cloud deploy` che ha esito positivo nella
directory ne richiede una, purché il progetto non sia stato riscattato e `.env` non definisca già
un `REBASE_API_TOKEN`. `init`, `deploy`, `status` e `whoami` stampano la data della sua scadenza.

Il riscatto trasferisce la chiave: l'operazione di claim rimuove la scadenza, quindi il file `.env` dell'app
continua a funzionare. L'agente conserva comunque una copia, pertanto la persona che ha riscattato
il progetto può sostituirla. `rebase cloud app-key rotate`, o l'opzione **Rotate app key** nelle
impostazioni del progetto, genera una nuova chiave e revoca contemporaneamente tutte le precedenti chiavi dell'agente.
Scrive la nuova chiave in un `.env` in cui `REBASE_API_TOKEN` è già configurato,
oppure la mostra una sola volta. Proprietari e amministratori possono ruotarla dopo essersi autenticati. Una chiave che non è stato
possibile trasferire mantiene la propria scadenza, cosa che accade se l'app non è stata distribuita o
non rispondeva al momento del riscatto. La rotazione la sostituisce con una senza scadenza.

Il riscatto sostituisce inoltre la `REBASE_SERVICE_KEY` del progetto, che ha privilegi di amministrazione
sull'API dell'app stessa e che il codice distribuito dall'agente potrebbe aver letto. L'app
si riavvia una volta con la nuova chiave, e qualsiasi cosa conservata dall'agente smette di funzionare una volta
completato il riavvio. Se un deploy è in corso al momento del riscatto,
il deploy successivo utilizzerà la nuova chiave.

Il riscatto richiede una sessione del browser autenticata, non un token, e un metodo di pagamento configurato
nell'organizzazione verso cui viene trasferito il progetto. Dal momento del riscatto in poi, il progetto viene
fatturato come qualsiasi altro. Il riscatto revoca inoltre il token dell'agente: effettua l'accesso con
`rebase cloud login` oppure genera un nuovo token con `rebase cloud tokens create`.

Il provisioning senza account è soggetto a limiti per indirizzo, per rete (un IPv4
/24) e complessivi; un control plane in cui tale funzionalità non è abilitata rifiuterà la
richiesta con un messaggio esplicativo. L'utilizzo precedente al riscatto non viene fatturato a chi
riscatta il progetto.
