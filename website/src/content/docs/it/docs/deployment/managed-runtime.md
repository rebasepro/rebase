---
sourceHash: 6cf201fcae853f37
title: Runtime backend gestito
sidebar_label: Runtime gestito
description: Cosa può e non può fare un backend con runtime "managed" su Rebase Cloud — pacchetti e binari, memoria e CPU, timeout e dimensioni del body, filesystem, stato in memoria, segreti, archiviazione per i file generati e rete in uscita.
---

Un'app backend dichiarata in questo modo in `rebase.json` viene eseguita sul **runtime
gestito**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

"Gestito" significa che distribuisci un bundle, non un'immagine. `rebase cloud deploy` compila le
tabelle, `backend/functions/` e i cron job in `dist-bundle`, lo carica e
Rebase Cloud lo avvia sull'immagine pubblicata `rebasepro/server`. Non dovrai mai scrivere
un Dockerfile, né potrai modificare ciò che si trova nell'immagine. Questa pagina elenca
cosa è consentito, in modo da poter pianificare una funzionalità prima di implementarla.

I valori riportati qui provengono dal runtime e dalla piattaforma così come sono oggi. Alcuni
sono parametri configurabili e la pagina indica quali. I pochi aspetti che non sono
ancora garantiti sono raccolti [alla fine](#non-ancora-garantito).

## Panoramica rapida

| Domanda | Risposta |
|---|---|
| Versione di Node | Node 22, su Debian slim, `linux`/`x64` |
| Pacchetti npm | Sì, dal registry pubblico o da uno privato. Installati nel bundle durante il deploy |
| Moduli nativi (`.node`, node-gyp) | No. `rebase cloud deploy` rifiuta il bundle |
| WebAssembly | Sì |
| Avviare un processo figlio | Sì, per un binario `linux`/`x64` fornito da un pacchetto npm. Consulta [Binari](#binari-e-processi-figli) |
| Memoria e CPU | Impostati per progetto con `rebase cloud compute`. Consulta [Risorse di calcolo](#risorse-di-calcolo-e-istanze) |
| Istanze | 1 per impostazione predefinita, sempre attiva. Puoi bloccarne fino a 5 o lasciare che l'autoscaler arrivi fino a 16 |
| Timeout della funzione | 30 secondi, poi `504 FUNCTION_TIMEOUT`. Configurabile fino a 10 minuti |
| Corpo della richiesta | 10 MiB, poi `413`. Configurabile, fino ai 64 MiB accettati dall'edge |
| Filesystem scrivibile | Sì, ma è temporaneo e appartiene a una singola istanza |
| Stato a livello di modulo (una cache `Map`) | Sopravvive tra le richieste su una singola istanza. Viene perso a ogni deploy e riavvio, e non è condiviso tra le istanze |
| Variabili d'ambiente e segreti | `rebase cloud env set`, applicati al deploy successivo |
| Archiviazione file | Un bucket per progetto, servito dal tuo backend su `/api/storage/file/…` |
| HTTP in uscita | Sì, sulle porte 80 e 443 (e 465, 587, 993 per le email). Le altre porte sono bloccate. Un singolo IP fisso in uscita: `207.175.138.15` |

## Codice e pacchetti

**Node e l'immagine.** L'immagine del runtime è basata su `node:22-slim`
(Debian), e il tuo bundle viene eseguito su `linux`/`x64` come utente non root. Il tuo
`tsconfig` e la versione di Node sulla tua macchina non modificano questo comportamento.

**Dipendenze.** `rebase cloud deploy` installa nel bundle le dipendenze dichiarate
nei tuoi file `package.json`, per `linux`/`x64`, e le carica insieme ad esso,
in modo che una nuova istanza non debba installare nulla. Un bundle che supererebbe
il limite di caricamento di 1 GB includendole viene caricato senza di esse, e il deploy
lo segnala: ogni istanza le installerà quindi all'avvio, con `npm ci` (o
`npm install` in assenza di un lockfile). Dal modo in cui vengono installate derivano quattro conseguenze:

- **Gli script di installazione non vengono mai eseguiti.** L'installazione utilizza `--ignore-scripts`. Un pacchetto
  che scarica un binario o compila qualcosa in `postinstall` verrà installato
  senza eseguire tale operazione.
- **Vengono installate solo le versioni da registry.** Una dipendenza `file:`, `link:`, `git+…` o `github:`
  fa fallire la build, poiché il runtime non ha modo di risolverla.
- **Alcuni pacchetti provengono dall'immagine, non da te.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` e `zod` vengono rimossi dalle
  dipendenze del bundle e vengono collegate le copie interne dell'immagine, quindi la tua
  versione non viene applicata. Altri pacchetti `@rebasepro/*`, come il driver del
  database, vengono installati dal tuo `package.json` come qualsiasi altra dipendenza.
  Anche `typescript` e `tsx` vengono rimossi; sono strumenti di build.
- **I pacchetti privati richiedono un file `.npmrc`.** `rebase build` copia il file
  `.npmrc` del progetto (e `backend/.npmrc`) nel bundle, in modo che l'installazione utilizzi le stesse
  impostazioni di registry della tua macchina. Ogni credenziale al suo interno deve essere un
  riferimento a una variabile d'ambiente, mai il token in chiaro; un token letterale fa fallire
  la build, poiché il bundle viene caricato insieme al tuo codice:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Il caricamento del bundle ha un limite massimo di 1 GB, compresso.

**I moduli nativi vengono rifiutati.** Un pacchetto che include un binario compilato `.node`
non può essere caricato sul runtime gestito. `rebase build` segnala un avviso e
`rebase cloud deploy` si interrompe prima del caricamento:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Il controllo cerca pacchetti nativi noti (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
file `binding.gyp` o `gypfile`, script di installazione che invocano `node-gyp` o
`prebuild` e file `.node`. La
[guida al deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
elenca i metodi più comuni per aggirare questo problema. In breve: esegui il lavoro in fase di compilazione,
chiama un servizio esterno o distribuisci con `runtime: "custom"`.

**WebAssembly funziona.** Un pacchetto che include un file `.wasm` e lo carica da
JavaScript non è un modulo nativo, e Node 22 lo esegue. Verificato
nell'immagine di base del runtime con le impostazioni di sicurezza del pod, utilizzando `esbuild-wasm`.
Ricorda il [limite di memoria](#risorse-di-calcolo-e-istanze) se il modulo è di grandi dimensioni,
come un modello vocale o di ML.

### Binari e processi figli

`child_process` funziona. L'immagine stessa include pochissimi eseguibili: `node`, `npm`,
`sh`, `tar` e gli strumenti client di PostgreSQL (`pg_dump`, `pg_restore`). Non sono
presenti `ffmpeg`, ImageMagick, Python né compilatori, e non è possibile aggiungere
pacchetti di sistema, poiché non esiste un Dockerfile e il processo non viene eseguito come root.

Un binario contenuto da un pacchetto npm **all'interno del proprio tarball** si installa
con il pacchetto ed è eseguibile. Deve essere compilato per `linux`/`x64` con glibc
(Debian), e viene eseguito come utente non privilegiato senza Linux capabilities.
Verificato con `@esbuild/linux-x64` nell'immagine di base del runtime. Un binario che un
pacchetto *scarica* in fase di `postinstall` non arriverà mai, poiché gli script di installazione
non vengono eseguiti; pacchetti come `ffmpeg-static` funzionano in questo modo.

Se una funzionalità richiede un binario, utilizza un'API hosted per quel carico di lavoro oppure
sposta il backend a `runtime: "custom"`, dove puoi compilare la tua immagine.

## Risorse di calcolo e istanze

Ogni progetto viene eseguito nei propri pod. Memoria e CPU sono definite per istanza e
possono essere configurate tramite i [parametri di calcolo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un progetto che non ha mai impostato questi parametri viene eseguito come pod burstable. In Belgio
(europe-west1) il valore predefinito riserva 100m CPU e 384Mi e può estendersi (burst) fino a 2 CPU
e 2 GiB; a Falkenstein e Helsinki la memoria può estendersi fino a 1,4× rispetto alla richiesta
e la CPU fino a 10× (al massimo 1,7 vCPU). `rebase cloud compute` mostra i valori del tuo progetto.

Istanze:

- **Una per impostazione predefinita, sempre in esecuzione.** `--replicas` fissa un valore compreso tra 1 e 5.
  Nulla riduce le istanze di un backend a zero.
- **L'autoscaling è opzionale.** `--autoscale-max` imposta un limite massimo fino a 16, e
  `--autoscale-cpu-target` (valore predefinito 70) l'utilizzo della CPU a cui mira l'autoscaler.
- **I deploy sono di tipo rolling.** Una nuova istanza si avvia e diventa pronta prima che
  la vecchia si arresti, quindi per un breve periodo due versioni gestiscono contemporaneamente il traffico.

`--spot` è disattivato per impostazione predefinita; le istanze spot sono più economiche e vengono riavviate senza
preavviso.

## Memoria e stato a livello di modulo

Un valore a livello di modulo, come `const cache = new Map()` all'inizio di un
file di funzione, risiede nel processo Node. Sopravvive da una richiesta all'altra
sulla stessa istanza. Viene perso ogni volta che il processo termina:

- a **ogni deploy**, poiché ogni deploy avvia nuove istanze;
- quando una **variabile d'ambiente** viene modificata e distribuita;
- quando un'istanza viene riavviata, rischedulata o (con `--spot`) reclamata.

Con più di un'istanza, ciascuna dispone della propria copia, quindi due richieste possono
accedere a cache differenti.

Utilizza una `Map` a livello di modulo come una cache che puoi permetterti di perdere: una che
rende più veloce la richiesta successiva ma non costituisce l'unica copia del dato. Conserva qualsiasi
elemento costoso da produrre, come audio generato o risposte onerose da API esterne,
nel database o nello [storage](#archiviazione-per-i-file-generati). Per i client creati
una sola volta, come un SDK per API, utilizza `lazyResource` in modo che il client venga inizializzato
al primo utilizzo dall'ambiente della richiesta. Consulta
[Configurazione e segreti](/docs/backend/custom-functions/#configuration-and-secrets).

[Esecuzione di più istanze](/docs/deployment/multiple-instances/) elenca
lo stato che Rebase stesso mantiene per processo, come i contatori di rate limiting e
i canali realtime.

## Il filesystem

Il filesystem del container è scrivibile e `/tmp` funziona. Tuttavia, tutto ciò
che viene scritto al suo interno:

- appartiene a una singola istanza e le altre istanze non possono vederlo;
- viene eliminato quando l'istanza si arresta, quindi al più tardi al deploy successivo;
- condivide un limite di archiviazione temporanea (ephemeral storage) di 6 GiB con il bundle e i relativi
  `node_modules` installati. Un'istanza che supera tale limite viene terminata (evicted).

Usalo per file temporanei di appoggio durante una singola richiesta. Non usarlo come cache tra un deploy
e l'altro o come archivio per i caricamenti. Questo è anche il motivo per cui
[`STORAGE_TYPE=local` è disabilitato in produzione](/docs/backend/storage/#environment-variables).

## Richieste

| Limite | Predefinito | Come modificarlo |
|---|---|---|
| Timeout della funzione | 30 s, poi `504` con codice `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo disattiva), o `defineFunction(…, { timeoutMs })` per una specifica funzione |
| Timeout massimo per singola funzione | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Attesa sull'istanza, all'edge | 10 minuti tra letture o scritture | Fisso |
| Corpo della richiesta, route `/api/*` prive di limite dedicato | 10 MiB, poi `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in byte |
| Corpo della richiesta all'edge | 64 MiB | Fisso |
| Singolo file tramite `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chiamate anonime a `/api/functions/*` | 3000 per IP ogni 15 minuti | `rateLimit.anonymousFunctions` |

Alcuni dettagli:

- **Il timeout sblocca il chiamante, non il lavoro in corso.** A 30 secondi il chiamante riceve
  un errore `504` e `getSignal(c)` viene interrotto (aborted). Passa tale signal a `fetch` e
  a qualsiasi altra operazione che ne accetti uno, in modo da interrompere anche l'elaborazione. Consulta
  [Timeout e rate limit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attende più a lungo del runtime.** L'ingress a monte delle tue
  istanze attende fino a 10 minuti, quindi il limite raggiunto da una richiesta è quello del runtime,
  che restituisce JSON e interrompe il signal. Aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`
  fino a tale soglia, oppure assegna alla specifica funzione che ne ha bisogno il proprio
  [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits). Per le operazioni che richiedono più tempo o che devono sopravvivere a un deploy (un'istanza
  effettua il drain per 15 secondi), rispondi immediatamente ed esegui l'elaborazione in un
  [job](/docs/backend/jobs/).
- **I caricamenti superiori a 64 MiB** richiedono il caricamento ripristinabile (TUS), che invia
  il file a blocchi (chunks). `client.storage.putObject()` vi passa automaticamente
  al di sopra di 8 MiB.
- **Dimensione della risposta.** Né il runtime né l'edge impongono un limite alla dimensione
  della risposta. Tuttavia, una risposta di grandi dimensioni viene comunque allocata in memoria se il tuo handler la costruisce
  per intero: inviala quindi in streaming o servila dallo storage.

### Monitor e attività pianificate in `/metrics`

Una richiesta proveniente da un noto monitor di uptime (riconosciuto tramite `User-Agent`), o che contiene un header `x-rebase-probe` con qualsiasi valore, viene servita ma conteggiata in `rebase_probe_requests_total` anziché in `rebase_requests_total`, evitando così che un monitor venga conteggiato come traffico effettivo. `rebase_scheduled_jobs` rappresenta il numero di cron job abilitati e registrati nell'app e `rebase_background_workers` è pari a 1 mentre questo processo esegue un worker della coda di job; entrambi si arrestano quando una distribuzione viene scalata a zero, motivo per cui una piattaforma che sospende i progetti inattivi legge questi valori.

## Variabili d'ambiente e segreti

Impostali tramite la CLI o nella console. Non è presente alcun campo dedicato in
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Una modifica si applica al deploy successivo.** Le istanze in esecuzione mantengono
  i valori con cui sono state avviate. `set` e `unset` lo ricordano
  (`Pending redeploy`).
- **Limiti:** fino a 100 variabili per progetto, 32 KiB per valore e 256 KiB in
  totale. I nomi seguono l'espressione `[A-Za-z_][A-Za-z0-9_]*`.
- **Alcuni nomi sono riservati.** La piattaforma imposta autonomamente `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV`, e definisce i vincoli di esecuzione
  del processo (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). L'impostazione di una di queste variabili
  viene rifiutata e l'errore le elenca tutte.
- **`CORS_ORIGINS` parte dai tuoi domini.** La piattaforma la imposta sull'host del
  progetto e sui suoi [domini personalizzati](/docs/deployment/cloud/#the-rest-of-the-surface) verificati.
  Un valore `CORS_ORIGINS` impostato dall'utente viene aggiunto a tale elenco, utile per un frontend ospitato
  altrove: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Le variabili di storage sono predefinite.** La piattaforma definisce le variabili `STORAGE_*`
  e `S3_*` per il proprio bucket, e qualsiasi valore configurato dall'utente ha la precedenza.
- **I nomi per il build-time vengono rifiutati.** Le variabili `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e
  `REACT_APP_` sono destinate ai frontend in fase di build e il backend
  non le riceve comunque in tempo utile. L'opzione `--force` ne forza comunque il salvataggio.

All'interno di una funzione, leggile all'interno dell'handler, mai all'inizio del file:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Una lettura di `process.env` a livello di modulo che restituisce un valore vuoto causa
il mancato caricamento dell'intero file, e le relative route restituiranno un `404`. Consulta
[Configurazione e segreti](/docs/backend/custom-functions/#configuration-and-secrets).

## Archiviazione per i file generati

Un progetto Cloud riceve lo storage di file una volta creato:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

In alternativa, puoi collegare il progetto a un bucket di tua proprietà con
`rebase cloud storage attach` (S3, R2, MinIO o qualsiasi bucket compatibile con S3).
Senza nessuno dei due, i caricamenti risponderanno con `501 STORAGE_NOT_CONFIGURED`. È possibile dichiarare
altri bucket in `backend/resources.ts`; consulta
[Bucket multipli](/docs/backend/storage/#several-buckets).

Un deploy che include lo storage viene rifiutato finché il progetto non specifica chi può leggere e scrivere
i file. Il file `backend/storage.ts` generato dallo scaffold esporta un hook `storageAuthorize` per
questo scopo. Consulta [Autorizzazione per singolo oggetto](/docs/backend/storage-authorization/).

**Come vengono serviti i file.** Il tuo backend serve ciascun file all'indirizzo
`GET /api/storage/file/<key>`. Legge l'oggetto dal bucket e lo trasmette in streaming,
includendo `Content-Type`, supporto per richieste range e intestazioni di caching. Non è disponibile
un URL diretto del bucket da distribuire.

- Una chiave che si trova sotto **`public/`** viene servita a chiunque, senza token, tramite un URL
  permanente. Usala per i file che qualsiasi visitatore può scaricare, come l'audio generato
  per un gioco pubblico.
- Qualsiasi altra chiave è privata. Un client richiede a `/api/storage/metadata/<key>` un
  URL di download contenente un token, valido per impostazione predefinita per 300 secondi
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, fino a un massimo di una settimana).

Da una funzione, puoi scrivere con `rebase.storage` (il bucket predefinito) o
`rebase.bucket(…)` (un bucket specifico). Il tuo hook `storageAuthorize` determina comunque
se la scrittura è consentita.

Le trasformazioni di immagini (`?width=`, `?format=`) richiedono `sharp`, che è un modulo nativo
e non è presente nell'immagine gestita. Sul runtime gestito, una richiesta di trasformazione
restituirà l'immagine originale.

### Esempio: memorizzare nella cache l'audio generato

Una funzione che converte il testo in parlato tramite un'API remota, memorizza ciascun risultato
una sola volta e successivamente lo serve dallo storage. La `Map` evita semplicemente una ricerca nello storage
su un'istanza già avviata (warm); il bucket rappresenta la vera cache, pertanto un deploy non comporta alcuna perdita.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

La route è pubblica, come ogni route in `backend/functions/` finché non viene protetta.
Un'implementazione reale verificherebbe chi è autorizzato a generare nuovo audio, per evitare che utenti
non autorizzati consumino il budget della tua API vocale.

## Rete in uscita

Le funzioni possono chiamare servizi esterni. Le connessioni in uscita dalle tue istanze
sono consentite verso qualsiasi indirizzo Internet solo sulle seguenti porte TCP:

| Porta | Utilizzo |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Invio di email tramite SMTP con TLS o STARTTLS |
| 993 | IMAP su TLS |

Tutto il resto è bloccato. Ciò include la porta 25, IMAP in chiaro e database o
cache sulle loro porte dedicate: Redis sulla 6379 o MongoDB sulla 27017 all'esterno di Rebase
Cloud non sono raggiungibili. Anche l'indirizzo dei metadati cloud (`169.254.169.254`) è
bloccato.

L'unica eccezione è il proprio database. Se il progetto utilizza un'istanza
PostgreSQL personalizzata (BYODB), ogni deploy consente anche le connessioni all'host di quel database
sulla porta specificata nella stringa di connessione, e a nessun altro servizio su quella porta.
L'host viene risolto nei suoi indirizzi IP al momento del deploy; pertanto, se il provider
sposta il database su un altro indirizzo, sarà necessario effettuare nuovamente il deploy. Il database deve accettare
connessioni da Internet: l'app si connette direttamente alla stringa di connessione. Le
impostazioni del bastion SSH vengono utilizzate solo per il test di connessione, non
dall'app distribuita.

La piattaforma non aggiunge alcun proxy né limiti di frequenza (rate limit) in uscita; i servizi chiamati
dispongono dei propri. Passa `getSignal(c)` a `fetch` affinché una chiamata si interrompa se la relativa
richiesta scade per timeout.

Tutto il traffico in uscita proviene da **un unico indirizzo IP fisso, `207.175.138.15`**.
Aggiungilo all'allowlist di terze parti quando un servizio ne richiede una. L'indirizzo è
condiviso da tutti i progetti su Rebase Cloud, quindi una allowlist dimostra che il chiamante è in esecuzione
su Rebase Cloud, ma non che si tratti specificamente del tuo progetto: continua quindi ad autenticarti al
servizio anche tramite chiave.

## Avvio e arresto

- **Cold start.** Una nuova istanza scarica ed estrae il bundle prima di iniziare
  a servire richieste, quindi un albero di dipendenze corposo rallenta ogni operazione di scale-up. Un bundle
  caricato senza le sue dipendenze deve anche installarle, aggiungendo dai 40 ai 60
  secondi. La piattaforma attende fino a 300 secondi prima che un'istanza diventi operativa.
- **Health check.** La piattaforma controlla `/livez` (il processo è in esecuzione) e
  `/health` (è in grado di raggiungere il database). Entrambi gli endpoint sono gestiti dal runtime, quindi non
  devi implementarli.
- **Arresto.** In caso di deploy o riavvio, l'istanza cessa di accettare nuove richieste,
  attende 5 secondi affinché il traffico venga deviato e riceve `SIGTERM`. Le richieste in
  corso hanno fino a 15 secondi per essere completate. Le promise passate a `waitUntil` dispongono di
  un massimo di 5 secondi di tale intervallo. Una promise non passata a `waitUntil` viene interrotta.
  Consulta [Attività in background](/docs/backend/custom-functions/#background-work).

## Quando il runtime gestito non è la scelta ideale

Passa il backend a `"runtime": "custom"` quando richiede:

- un modulo nativo o un binario di sistema non distribuito da alcun pacchetto npm, come `sharp`,
  ImageMagick o un motore vocale locale;
- pacchetti di sistema o un'immagine di base differente;
- una connessione persistente verso qualcosa al di fuori delle porte consentite.

Un runtime custom compila il tuo Dockerfile e da quel momento sarai tu a gestire l'immagine.
`rebase cloud deploy --eject` esegue il passaggio. Consulta
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Non ancora garantito

- **Cronologia dei log.** `rebase cloud logs --runtime` legge dalle istanze in
  esecuzione, e `rebase cloud debug logs --previous` dall'ultima esecuzione di
  un'istanza riavviata. L'output generato da un'istanza sostituita da un nuovo deploy viene perso. Scrivi
  qualsiasi informazione da conservare nel database o in un servizio di logging esterno.
- **Lo scale to zero** non è supportato. Ogni backend mantiene sempre almeno
  un'istanza attiva.

## Pagine correlate

- [Rebase Cloud](/docs/deployment/cloud/): collegamento, deployment, parametri
  di calcolo e cosa non è incluso nella beta
- [Funzioni personalizzate](/docs/backend/custom-functions/): scrittura delle route in
  `backend/functions/`
- [Runtime e bundle](/docs/architecture/runtime-and-bundles/): cos'è un bundle
  e come viene avviato dal runtime
- [Storage](/docs/backend/storage/): bucket, endpoint, limiti dimensionali e regole
  di accesso
- [Esecuzione di più istanze](/docs/deployment/multiple-instances/): lo stato
  mantenuto da Rebase per ciascun processo
