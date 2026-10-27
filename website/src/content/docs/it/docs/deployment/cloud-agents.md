---
sourceHash: 582293a88fb2d626
title: CI, agenti e backend rivendicabili
sidebar_label: CI e agenti
description: Distribuisci su Rebase Cloud da una CI o da un agente con un token limitato anziché una password, e lascia che un agente crei un backend attivo senza account che una persona rivendica in seguito.
---

Un progetto [Rebase Cloud](/docs/deployment/cloud/) non ha bisogno di una persona davanti a un
terminale per essere distribuito. Un job di CI o un agente agisce con un token limitato a poche azioni
su un singolo progetto, e un agente può creare un progetto prima che qualcuno abbia un
account, per poi consegnare un link con cui rivendicarlo.

## CI e agenti

Un job di CI o un agente non dovrebbe portarsi dietro la tua password. Dagli invece un token:
una chiave che agisce come il tuo account, limitata a poche azioni su un singolo
progetto. Crealo da un terminale autenticato:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Il token viene stampato una sola volta, come riga `export REBASE_TOKEN=rk_live_…`. Con
`REBASE_TOKEN` impostato, ogni comando `rebase cloud` si autentica con esso anziché con
il tuo login, e non legge né scrive mai la sessione memorizzata. In GitHub Actions,
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

`--can` accetta una o più capacità, separate da virgole o ripetute:

| Capacità | Cosa può fare il token |
|---|---|
| `deploy` | Distribuire il progetto e seguirne le build: `deploy` (compreso `--preview`), `deployments`, `previews` |
| `logs` | Leggere i log di build e di runtime, la cronologia dei cron, le metriche in tempo reale e l'utilizzo: `logs`, `cron`, `metrics`, `usage` |
| `env` | Leggere e modificare le variabili d'ambiente, secret inclusi, e quelle proprie delle anteprime (`--preview`) |
| `database` | `db list`, `db info` e `db connect`, che include la password del database |
| `backups` | Elencare, creare, ispezionare e scaricare i backup, e leggere la finestra di point-in-time |

<span class="since-badge" data-since="0.26">Da 0.26</span> Altre tre capacità agiscono su un'organizzazione anziché su un progetto. Un token
ne possiede una solo quando `--can` la nomina, sull'organizzazione indicata da `--org` (oppure,
senza `--org`, quella del progetto, poi quella selezionata con
`rebase cloud use`). Un token può possedere queste e nessuna capacità di progetto:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capacità | Cosa può fare il token |
|---|---|
| `billing` | Leggere la carta registrata, le fatture e la prossima fattura, e cambiare l'email di fatturazione: `billing`, `billing invoices`, `billing upcoming`. Solo owner e admin |
| `audit` | Leggere il registro delle attività dell'organizzazione: `activity`. Solo owner e admin |
| `notifications` | Cambiare le scelte email del proprio titolare e i webhook di notifica dei progetti dell'organizzazione: `notifications`. Aggiungere, modificare e rimuovere un webhook richiede comunque il ruolo di owner o admin |

Un token creato prima che esistesse
`billing` legge comunque la fatturazione per una release. Ciascuna di queste risposte
porta un header `Deprecation: true` e una frase che nomina lo scope che manca al token, e la CLI la stampa
una volta, su stderr, come avviso. Sostituisci un token del genere
con uno creato con `--can billing` prima della prossima release, quando la fatturazione inizierà a
rifiutarlo.

Sotto il cofano un token è una [chiave API personale](/docs/backend/api-keys/#personal-keys)
sul control plane. Ogni capacità diventa alcuni
[scope](/docs/backend/roles-and-scopes/): `deploy` su `shop` possiede
`project:deploy:<id>`, con l'id del progetto, più gli scope di dati e funzioni
che i comandi di deploy richiamano. Una capacità di organizzazione possiede `org:billing:<id>`,
`org:audit:<id>` oppure `org:notifications:<id>`, con l'id dell'organizzazione. Il token non possiede mai più di quanto possieda il tuo account nel momento
in cui viene usato, quindi perde tutto ciò che perde il tuo account.

Due cose restano a una persona autenticata:

- **Gestire i token.** `rebase cloud tokens list`, `create` e `revoke <id>` richiedono
  la tua sessione di `rebase cloud login`. Un token non può elencare, creare né revocare
  token, perché un token in grado di emettere token potrebbe emettere il proprio successore.
- **Ripristinare.** Nessuna capacità concede il ripristino di un backup né un `restore` e
  un `cutover` point-in-time. Sovrascrivere un database attivo con dati vecchi resta a un
  owner o admin autenticato.

`rebase cloud whoami` con un token impostato mostra cosa può fare, e su quale
progetto o organizzazione. La schermata **Access tokens** della console offre le stesse
capacità, quelle di organizzazione sotto **Organization access**. `rebase cloud tokens revoke <id> --yes` lo ferma subito.

## Un backend senza account

<span class="since-badge" data-since="0.26">Da 0.26</span>

Un agente che ha costruito un'app può darle un backend attivo prima che qualcuno si sia
registrato, e consegnare alla persona per cui lavora un link per tenerlo:

```bash
rebase cloud init --claim
```

Questo effettua il provisioning di un progetto su Rebase Cloud, imposta `REBASE_BASE_URL` in `.env` sul suo
indirizzo attivo, collega la directory e distribuisce le collection locali con
`rebase cloud deploy --bundle`. Stampa l'URL attivo, l'URL del pannello di amministrazione e un
**URL di rivendicazione**. Chiunque apra l'URL di rivendicazione e acceda può spostare il progetto in
una delle proprie organizzazioni. Il link funziona una sola volta. Un progetto che nessuno rivendica entro
72 ore viene eliminato, database compreso. `rebase cloud claim` ristampa l'URL di
rivendicazione con il tempo rimasto, e `--open` lo apre. Il tool `rebase_cloud_provision` del server MCP esegue lo stesso comando e restituisce gli stessi URL;
i suoi altri tool cloud poi controllano, distribuiscono, leggono i log, impostano le variabili e fanno il rollback
del progetto senza un login (vedi [Server MCP](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` in `.env` è anche dove `rebase api-keys`, `rebase storage`
e `rebase auth reset-password` inviano la chiave di servizio locale, quindi dopo `init --claim`
puntano al progetto cloud, che non accetta quella chiave. Lo segnalano
quando succede; imposta `REBASE_BASE_URL` nella shell per raggiungere invece un backend locale.

Finché il progetto non viene rivendicato non appartiene ad alcun account. Il suo token è limitato a
quel solo progetto: distribuisce, legge log e metriche, imposta variabili d'ambiente
ed esegue `db info`. Non legge nulla di segreto: non il valore di una variabile (chiave di servizio
compresa), non la password del database, e non può aprire
`db connect` né un'anteprima. È conservato in
`~/.rebase/credentials.json`, mai nel repository, e i comandi `rebase cloud`
nella directory collegata lo usano da soli. `REBASE_TOKEN`, quando è impostato,
prevale comunque se possiede uno scope su quel progetto, e quei comandi avvisano che è successo;
quando non ne possiede nessuno (un token di CI creato per altri progetti), viene usato il token proprio del progetto
e il primo comando lo segnala. Un comando a cui viene passato `--project` per
un altro progetto mantiene `REBASE_TOKEN`, e il deploy che `init --claim` esegue usa sempre
il token proprio del progetto. Scade insieme al progetto. `rebase cloud whoami` in quella directory mostra il progetto, cosa può fare il
token, l'URL di rivendicazione e quando scade il progetto. Un comando che richiede la sessione di una
persona rifiuta con `session_required` e conserva il token; viene dimenticato
solo quando il control plane lo rifiuta ovunque, dopo una rivendicazione o alla scadenza, e
nel farlo viene stampato l'URL di rivendicazione. Anche `rebase cloud status` mostra l'URL di
rivendicazione e la scadenza (`unclaimed` in `--json`). `rebase cloud unlink`
non elimina un progetto non rivendicato: avvisa che il progetto continua a funzionare
fino alla scadenza e stampa l'URL di rivendicazione, e `init --claim` in una directory
già collegata a uno di essi rimanda al suo URL di rivendicazione anziché effettuare il provisioning di
un secondo. Fino alla rivendicazione, l'app raggiunge internet solo sulle porte 80 e 443;
le porte di posta che ogni altro progetto ha (465, 587 e 993) si aprono quando il progetto
viene rivendicato.

Una volta che il deploy ha eseguito la build dell'app, il comando imposta anche `REBASE_API_TOKEN` in
`.env`: una chiave emessa sull'app stessa, che è ciò che il server MCP e l'SDK
le inviano. Un `REBASE_API_TOKEN` già presente in `.env` viene mantenuto e non ne viene emesso nessuno,
e un `.env` creato dal comando è leggibile solo da te. Legge e scrive dati (`data:read`, `data:write`) attraverso la
sicurezza a livello di riga dell'app, come un chiamante che non è né una persona né un admin. Non possiede
nulla del piano di amministrazione e scade con la finestra di rivendicazione, a meno che il
progetto non venga rivendicato prima. Con `--no-deploy`, o quando quel primo deploy fallisce, non c'è
ancora nessuna chiave: il prossimo `rebase cloud deploy` che riesce nella
directory ne richiede una, purché il progetto non sia rivendicato e `.env` non imposti già
un `REBASE_API_TOKEN`. `init`, `deploy`, `status` e `whoami` stampano la
data di scadenza.

La rivendicazione consegna la chiave: elimina la sua scadenza, così il `.env` dell'app
continua a funzionare. L'agente ne conserva comunque una copia, quindi la persona che ha rivendicato il
progetto può sostituirla. `rebase cloud app-key rotate`, oppure **Rotate app key** nelle
Settings del progetto, emette una nuova chiave e revoca subito tutte le precedenti chiavi dell'agente.
Scrive la nuova chiave in un `.env` che imposta già `REBASE_API_TOKEN`,
oppure la mostra una sola volta. La ruotano owner e admin, autenticati. Una chiave che non è stato possibile
consegnare mantiene la propria scadenza, cosa che accade quando l'app non era stata distribuita o
non rispondeva al momento della rivendicazione. Ruotarla la sostituisce con una che non scade.

La rivendicazione sostituisce anche la `REBASE_SERVICE_KEY` del progetto, che è admin sull'API
dell'app stessa e che il codice distribuito dall'agente poteva leggere. L'app
si riavvia una volta su una nuova chiave, e tutto ciò che l'agente ha conservato smette di funzionare quando
il riavvio è terminato. Se un deploy è in corso al momento della rivendicazione,
il deploy successivo porta con sé la nuova chiave.

La rivendicazione richiede una sessione del browser autenticata, non un token, e un metodo di pagamento
sull'organizzazione in cui il progetto viene spostato. Dalla rivendicazione in poi il progetto viene
fatturato come qualsiasi altro. La rivendicazione revoca anche il token dell'agente: accedi con
`rebase cloud login`, oppure emetti un nuovo token con `rebase cloud tokens create`.

Il provisioning senza account è limitato per indirizzo, per rete (una /24 IPv4) e in totale, e un control plane che non lo ha attivato rifiuta con un
messaggio che lo dice. L'utilizzo precedente alla rivendicazione non viene fatturato a chi
rivendica il progetto.
