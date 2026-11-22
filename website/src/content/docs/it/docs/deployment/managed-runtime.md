---
sourceHash: 3f40bdbdc8b0c722
title: Runtime gestito del backend
sidebar_label: Runtime gestito
description: Cosa può e non può fare un backend con runtime "managed" su Rebase Cloud — pacchetti e binari, memoria e CPU, timeout e dimensioni del body, filesystem, stato in memoria, segreti, storage per i file generati e rete in uscita.
---

Un'app backend dichiarata in questo modo in `rebase.json` viene eseguita sul **runtime gestito**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Gestito significa che rilasci un bundle, non un'immagine. `rebase cloud deploy` compila le tabelle, `backend/functions/` e i cron job in `dist-bundle`, lo carica e Rebase Cloud lo avvia sull'immagine pubblicata `rebasepro/server`. Non scrivi mai un Dockerfile e non puoi nemmeno modificare ciò che si trova nell'immagine. Questa pagina elenca cosa è consentito, permettendoti di pianificare una funzionalità prima di svilupparla.

I valori numerici riportati qui derivano dal runtime e dalla piattaforma allo stato attuale. Alcuni sono parametri configurabili, e la pagina indica quali. Le poche funzionalità non ancora garantite sono raccolte [alla fine](#non-ancora-garantito).

## In sintesi

| Domanda | Risposta |
|---|---|
| Versione di Node | Node 22, su Debian slim, `linux`/`x64` |
| Pacchetti npm | Sì, dal registro pubblico o da uno privato. Installati nel bundle durante il deploy |
| Moduli nativi (`.node`, node-gyp) | No. `rebase cloud deploy` rifiuta il bundle |
| WebAssembly | Sì |
| Creazione di processi figli (spawn) | Sì, per un binario `linux`/`x64` fornito da un pacchetto npm. Vedi [Binari](#binari-e-processi-figli) |
| Memoria e CPU | Impostate per progetto con `rebase cloud compute`. Vedi [Risorse di calcolo](#risorse-di-calcolo-e-istanze) |
| Istanze | 1 per impostazione predefinita, sempre attiva. Puoi fissarne fino a 5, oppure lasciare che l'autoscaler arrivi fino a 16 |
| Timeout delle funzioni | 30 secondi, poi `504 FUNCTION_TIMEOUT`. Configurabile fino a 10 minuti |
| Body della richiesta | 10 MiB, poi `413`. Configurabile, fino ai 64 MiB accettati dall'edge |
| Filesystem scrivibile | Sì, ma è temporaneo e appartiene a una singola istanza |
| Stato a livello di modulo (una cache `Map`) | Sopravvive tra le richieste sulla stessa istanza. Perso a ogni deploy e riavvio, e non condiviso tra le istanze |
| Variabili d'ambiente e segreti | `rebase cloud env set`, applicate al deploy successivo |
| Archiviazione file | Un bucket per progetto, servito dal tuo backend su `/api/storage/file/…` |
| HTTP in uscita | Sì, sulle porte 80 e 443 (e 465, 587, 993 per le email). Le altre porte sono bloccate. Un singolo IP fisso in uscita: `207.175.138.15` |

## Codice e pacchetti

**Node e l'immagine.** L'immagine del runtime è basata su `node:22-slim` (Debian) e il tuo bundle viene eseguito su `linux`/`x64` come utente non root. Il tuo `tsconfig` e la versione di Node sulla tua macchina non cambiano questo comportamento.

**Dipendenze.** `rebase cloud deploy` installa nel bundle le dipendenze dichiarate nei tuoi file `package.json`, per `linux`/`x64`, e le carica insieme ad esso, in modo che una nuova istanza non debba installare nulla. Un bundle che supererebbe il limite di caricamento di 1 GB includendole viene caricato senza di esse, e il deploy lo segnala: ogni istanza le installerà quindi all'avvio con `npm ci` (o `npm install` in assenza di un lockfile). Dal modo in cui vengono installate derivano quattro conseguenze:

- **Gli script di installazione non vengono mai eseguiti.** L'installazione usa `--ignore-scripts`. Un pacchetto che scarica un binario o compila qualcosa in `postinstall` verrà installato senza eseguire tali operazioni.
- **Vengono installate solo versioni dal registro.** Una dipendenza di tipo `file:`, `link:`, `git+…` o `github:` fa fallire la build, poiché il runtime non ha nulla con cui risolverla.
- **Alcuni pacchetti provengono dall'immagine, non da te.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` e `zod` vengono rimossi dalle dipendenze del bundle e vengono collegate le copie interne dell'immagine, quindi la tua versione specifica non viene applicata. Gli altri pacchetti `@rebasepro/*`, come il driver del database, vengono installati dal tuo `package.json` come qualsiasi altra dipendenza. Vengono rimossi anche `typescript` e `tsx`, trattandosi di strumenti di build.
- **I pacchetti privati richiedono un file `.npmrc`.** `rebase build` copia il file `.npmrc` del progetto (e `backend/.npmrc`) nel bundle, in modo che l'installazione utilizzi le stesse impostazioni di registro della tua macchina. Ogni credenziale al suo interno deve essere un riferimento a una variabile d'ambiente, mai il token in chiaro; un token letterale fa fallire la build, poiché il bundle viene caricato insieme al tuo codice:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Il caricamento del bundle ha un limite massimo di 1 GB, compresso.

**I moduli nativi vengono rifiutati.** Un pacchetto che include un binario `.node` compilato non può essere caricato sul runtime gestito. `rebase build` segnala un avviso al riguardo e `rebase cloud deploy` si interrompe prima del caricamento:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Il controllo verifica la presenza di pacchetti nativi noti (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), di file `binding.gyp` o `gypfile`, di script di installazione che invocano `node-gyp` o `prebuild` e di file `.node`. La [guida al deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) elenca i modi consueti per aggirare il problema. In sintesi: esegui il lavoro in fase di build, chiama un servizio esterno o effettua il deploy con `runtime: "custom"`.

**WebAssembly funziona.** Un pacchetto che include un file `.wasm` e lo carica da JavaScript non è considerato un modulo nativo, e Node 22 lo esegue senza problemi. Verificato nell'immagine di base del runtime con le impostazioni di sicurezza del pod, utilizzando `esbuild-wasm`. Ricorda il [limite di memoria](#risorse-di-calcolo-e-istanze) se il modulo è di grandi dimensioni, come ad esempio un modello vocale o di machine learning.

### Binari e processi figli

`child_process` funziona. L'immagine stessa include pochissimi eseguibili: `node`, `npm`, `sh`, `tar` e gli strumenti client di PostgreSQL (`pg_dump`, `pg_restore`). Non sono presenti `ffmpeg`, ImageMagick, Python o compilatori, e non è possibile aggiungere pacchetti di sistema, poiché non esiste un Dockerfile e il processo non è root.

Un binario che un pacchetto npm include **all'interno del proprio tarball** viene installato insieme al pacchetto ed eseguito. Deve essere compilato per `linux`/`x64` contro glibc (Debian) e viene eseguito come utente non privilegiato senza Linux capabilities. Verificato con `@esbuild/linux-x64` nell'immagine di base del runtime. Un binario che un pacchetto *scarica* durante `postinstall` non sarà mai presente, poiché gli script di installazione non vengono eseguiti; pacchetti come `ffmpeg-static` funzionano in questo modo.

Se una funzionalità richiede un binario, utilizza un'API ospitata per quel carico di lavoro oppure sposta il backend su `runtime: "custom"`, dove puoi compilare la tua immagine personalizzata.

## Risorse di calcolo e istanze

Ogni progetto viene eseguito nei propri pod. Memoria e CPU sono definite per istanza e possono essere configurate tramite i [parametri di calcolo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un progetto per cui non è mai stato configurato alcun parametro viene eseguito come pod burstable: riserva `100m` di CPU e `384Mi` di memoria, e può raggiungere picchi (burst) fino a 2 CPU e 2 GiB. Una richiesta configurata mantiene questo rapporto tra request e limit. Esegui `rebase cloud compute` per vedere la configurazione attuale del tuo progetto.

Istanze:

- **Una per impostazione predefinita, sempre attiva.** `--replicas` fissa il numero tra 1 e 5. Nessun meccanismo riduce il backend a zero istanze.
- **L'autoscaling è opzionale.** `--autoscale-max` imposta un limite massimo fino a 16 e `--autoscale-cpu-target` (predefinito 70) indica l'utilizzo di CPU target a cui mira l'autoscaler.
- **I deploy sono di tipo rolling.** Una nuova istanza si avvia e diventa pronta prima che quella precedente venga arrestata; pertanto, per un breve periodo di tempo entrambe le versioni gestiscono il traffico.

`--spot` è disattivato per impostazione predefinita; le istanze spot sono più economiche ma possono essere riavviate senza preavviso.

## Memoria e stato a livello di modulo

Un valore a livello di modulo, come `const cache = new Map()` in cima al file di una funzione, risiede nel processo Node. Sopravvive da una richiesta all'altra sulla stessa istanza. Viene perso ogni volta che il processo termina:

- a **ogni deploy**, poiché ciascun deploy avvia nuove istanze;
- quando una **variabile d'ambiente** viene modificata e distribuita;
- quando un'istanza viene riavviata, rischedulata o (con `--spot`) revocata.

Con più di un'istanza, ognuna possiede la propria copia, quindi due richieste possono accedere a cache diverse.

Usa una `Map` a livello di modulo come una cache che puoi permetterti di perdere: qualcosa che velocizza la richiesta successiva ma che non costituisce l'unica copia dei dati. Conserva tutto ciò che ha richiesto risorse o costi per essere prodotto, come audio generato o risposte onerose da API, nel database o nello [storage](#storage-per-i-file-generati). Per i client creati una sola volta, come l'SDK di un'API, usa `lazyResource` in modo che il client venga inizializzato al primo utilizzo a partire dall'ambiente della richiesta. Vedi [Configurazione e segreti](/docs/backend/custom-functions/#configuration-and-secrets).

[Esecuzione di più istanze](/docs/deployment/multiple-instances/) elenca lo stato che Rebase stesso mantiene per processo, come i contatori di rate limit e i canali realtime.

## Il filesystem

Il filesystem del container è scrivibile e `/tmp` è utilizzabile. Tuttavia, qualsiasi dato scritto lì:

- appartiene a una singola istanza e le altre istanze non possono vederlo;
- viene eliminato all'arresto dell'istanza, quindi al più tardi al deploy successivo;
- condivide un limite di archiviazione effimera (ephemeral storage) di 6 GiB con il bundle e i relativi `node_modules` installati. Un'istanza che supera questo limite viene espulsa (evicted).

Usalo solo per file temporanei di appoggio durante una singola richiesta. Non usarlo come cache persistente tra i deploy o per conservare file caricati. Questo è anche il motivo per cui [`STORAGE_TYPE=local` è disabilitato in produzione](/docs/backend/storage/#environment-variables).

## Richieste

| Limite | Predefinito | Modificabile con |
|---|---|---|
| Timeout delle funzioni | 30 s, poi `504` con codice `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo disattiva), o tramite `defineFunction(…, { timeoutMs })` della singola funzione |
| Timeout massimo per una singola funzione | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Attesa sull'istanza, a livello di edge | 10 minuti tra letture o scritture | Fisso |
| Body della richiesta, rotte `/api/*` senza un proprio limite | 10 MiB, poi `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in byte |
| Body della richiesta sull'edge | 64 MiB | Fisso |
| Singolo file tramite `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chiamate anonime a `/api/functions/*` | 3000 per IP ogni 15 minuti | `rateLimit.anonymousFunctions` |

Alcuni dettagli:

- **Il timeout libera il chiamante, non il lavoro.** Dopo 30 secondi il chiamante riceve un `504` e `getSignal(c)` viene interrotto (aborted). Passa questo segnale a `fetch` e a qualsiasi altra operazione che ne accetti uno, in modo da interrompere anche l'elaborazione. Vedi [Timeout e rate limit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attende più a lungo del runtime.** L'ingress davanti alle tue istanze attende fino a 10 minuti, quindi il limite che una richiesta raggiunge è quello del runtime, che risponde con JSON e interrompe il segnale. Puoi aumentare `REBASE_FUNCTIONS_TIMEOUT_MS` fino a tale valore, oppure assegnare alla funzione che lo richiede un proprio [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits). Per i lavori che richiedono più tempo, o che devono sopravvivere a un deploy (un'istanza effettua il drain per 15 secondi), rispondi immediatamente ed esegui il lavoro in un [job](/docs/backend/jobs/).
- **I caricamenti superiori a 64 MiB** richiedono l'upload riprendibile (TUS), che invia il file a blocchi (chunks). `client.storage.putObject()` passa automaticamente a questa modalità sopra gli 8 MiB.
- **Dimensione della risposta.** Né il runtime né l'edge impongono un limite alla dimensione della risposta. Una risposta di grandi dimensioni viene comunque allocata in memoria se il tuo gestore la costruisce in un unico blocco; pertanto, trasmettila in streaming o servila dallo storage.

## Variabili d'ambiente e segreti

Configurali tramite CLI o nella console. Non esiste un campo dedicato in `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Le modifiche vengono applicate al deploy successivo.** Le istanze in esecuzione mantengono i valori con cui sono state avviate. I comandi `set` e `unset` lo ricordano (`Pending redeploy`).
- **Limiti:** fino a 100 variabili per progetto, 32 KiB per valore e 256 KiB in totale. I nomi seguono l'espressione regolare `[A-Za-z_][A-Za-z0-9_]*`.
- **Alcuni nomi sono riservati.** La piattaforma imposta autonomamente `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV`, e definisce i parametri di esecuzione del processo (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Il tentativo di impostare una di queste variabili viene rifiutato e l'errore le elenca tutte.
- **`CORS_ORIGINS` include inizialmente i tuoi domini.** La piattaforma lo imposta con l'host del progetto e i suoi [domini personalizzati](/docs/deployment/cloud/#the-rest-of-the-surface) verificati. Un valore di `CORS_ORIGINS` impostato da te viene aggiunto a tale elenco, utile per un frontend ospitato altrove: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Le variabili di storage sono predefinite.** La piattaforma compila le variabili `STORAGE_*` e `S3_*` per il proprio bucket, e qualsiasi valore impostato da te ha la priorità.
- **I nomi di variabili per la fase di build vengono rifiutati.** Le variabili `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e `REACT_APP_` sono destinate ai frontend durante la fase di build, e il backend non le riceverà mai in tempo utile. L'opzione `--force` consente comunque di salvarle.

All'interno di una funzione, leggile dentro l'handler, mai in cima al file:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Una lettura di `process.env` nello scope del modulo che risulta vuota impedisce il caricamento dell'intero file, facendo rispondere le relative rotte con un errore `404`. Vedi [Configurazione e segreti](/docs/backend/custom-functions/#configuration-and-secrets).

## Storage per i file generati

Un progetto Cloud ottiene lo storage dei file non appena viene creato:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

In alternativa, puoi collegare il progetto a un bucket già esistente tramite `rebase cloud storage attach` (S3, R2, MinIO o qualsiasi bucket compatibile con S3). Senza una di queste configurazioni, i caricamenti risponderanno con `501 STORAGE_NOT_CONFIGURED`. È possibile dichiarare ulteriori bucket in `backend/resources.ts`; vedi [Bucket multipli](/docs/backend/storage/#several-buckets).

Un deploy che include lo storage viene rifiutato finché il progetto non specifica chi è autorizzato a leggere e scrivere i file. Il file scaffold `backend/storage.ts` esporta un hook `storageAuthorize` a questo scopo. Vedi [Autorizzazione per oggetto](/docs/backend/storage-authorization/).

**Come vengono serviti i file.** Il tuo backend serve ciascun file tramite `GET /api/storage/file/<key>`. Legge l'oggetto dal bucket e lo trasmette in streaming, includendo `Content-Type`, supporto per le range request e header di caching. Non viene fornito alcun URL diretto al bucket.

- Una chiave sotto **`public/`** viene servita a chiunque, senza bisogno di token, a un URL immutabile. Usala per i file accessibili a qualsiasi visitatore, come l'audio generato per un gioco pubblico.
- Qualsiasi altra chiave è privata. Il client richiede a `/api/storage/metadata/<key>` un URL di download contenente un token, valido per impostazione predefinita per 300 secondi (`STORAGE_DOWNLOAD_TOKEN_TTL`, estendibile fino a una settimana).

All'interno di una funzione, scrivi utilizzando `rebase.storage` (il bucket predefinito) o `rebase.bucket(…)` (uno specifico con nome). L'hook `storageAuthorize` continuerà a stabilire se la scrittura è consentita.

Le trasformazioni delle immagini (`?width=`, `?format=`) richiedono `sharp`, che è un modulo nativo e non è incluso nell'immagine gestita. Sul runtime gestito, una richiesta di trasformazione restituisce l'immagine originale.

### Esempio: memorizzare in cache l'audio generato

Una funzione che converte testo in voce tramite un'API remota, memorizza ciascun risultato una sola volta e successivamente lo serve dallo storage. La `Map` evita solo una ricerca nello storage su un'istanza già avviata (warm); il bucket costituisce la vera cache, garantendo che un deploy non perda alcun dato.

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

La rotta è pubblica, come qualsiasi altra rotta in `backend/functions/` finché non viene protetta. Un'implementazione reale dovrebbe verificare chi è autorizzato a creare nuovo audio, evitando che utenti sconosciuti consumino il budget della tua API vocale.

## Rete in uscita

Le funzioni possono chiamare servizi esterni. Le connessioni in uscita dalle tue istanze sono consentite verso qualsiasi indirizzo Internet esclusivamente sulle seguenti porte TCP:

| Porta | Destinazione |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Invio di email tramite SMTP con TLS o STARTTLS |
| 993 | IMAP su TLS |

Tutto il resto è bloccato. Ciò include la porta 25, IMAP non crittografato e database o cache sulle loro porte dedicate: Redis sulla porta 6379 o MongoDB sulla 27017 al di fuori di Rebase Cloud non sono raggiungibili. Anche l'indirizzo dei metadati cloud (`169.254.169.254`) è bloccato.

L'unica eccezione riguarda il proprio database. Se il progetto utilizza un database PostgreSQL esterno (BYODB), ogni deploy consente anche le connessioni verso l'host di quel database sulla porta specificata nella stringa di connessione, e a nient'altro su tale porta. L'host viene risolto nei relativi indirizzi IP al momento del deploy; pertanto, se il provider sposta il database su un altro indirizzo, è necessario eseguire nuovamente il deploy. Il database deve accettare connessioni da Internet: l'applicazione si connette direttamente alla stringa di connessione. Le impostazioni del bastion host SSH vengono utilizzate unicamente dal test di connessione, non dall'applicazione distribuita.

La piattaforma non applica proxy né rate limit in uscita; i servizi chiamati avranno le proprie limitazioni. Passa `getSignal(c)` a `fetch` in modo che la chiamata si interrompa se la richiesta scade.

Tutto il traffico in uscita proviene da **un unico indirizzo IP fisso: `207.175.138.15`**. Aggiungilo all'allowlist dei servizi di terze parti quando richiesto. Questo indirizzo è condiviso da tutti i progetti su Rebase Cloud, quindi una allowlist certifica solo che il chiamante risiede su Rebase Cloud, non che si tratti del tuo specifico progetto: continua pertanto ad autenticarti al servizio anche tramite chiave.

## Avvio e arresto

- **Cold start (avvio a freddo).** Una nuova istanza scarica ed estrae il bundle prima di iniziare a servire richieste; pertanto, un albero di dipendenze voluminoso rallenta ogni operazione di scale-up. Un bundle caricato senza dipendenze deve anche installarle, aggiungendo dai 40 ai 60 secondi. La piattaforma attende fino a 300 secondi prima che un'istanza diventi operativa.
- **Health check.** La piattaforma controlla `/livez` (il processo è in esecuzione) e `/health` (è possibile raggiungere il database). Entrambi gli endpoint sono gestiti dal runtime, quindi non devi scriverli.
- **Arresto.** In caso di deploy o riavvio, l'istanza smette di accettare nuove richieste, attende 5 secondi affinché il traffico venga reindirizzato e poi riceve `SIGTERM`. Le richieste in corso hanno fino a 15 secondi per terminare. Le promise passate a `waitUntil` ottengono fino a 5 secondi di questo intervallo. Una promise non passata a `waitUntil` viene interrotta. Vedi [Attività in background](/docs/backend/custom-functions/#background-work).

## Quando la modalità gestita non è adatta

Passa il backend a `"runtime": "custom"` se sono necessari:

- un modulo nativo, oppure un binario di sistema non fornito da alcun pacchetto npm, come `sharp`, ImageMagick o un motore vocale locale;
- pacchetti di sistema o un'immagine di base differente;
- una connessione persistente verso destinazioni al di fuori delle porte consentite.

Un runtime personalizzato esegue la build del tuo Dockerfile, lasciandoti la gestione dell'immagine da quel momento in poi. `rebase cloud deploy --eject` esegue questa transizione. Vedi [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Non ancora garantito

- **Cronologia dei log.** `rebase cloud logs --runtime` legge dalle istanze attualmente in esecuzione e `rebase cloud debug logs --previous` dall'ultima esecuzione di un'istanza riavviata. L'output di un'istanza sostituita da un deploy viene perso. Salva qualsiasi dato necessario nel database o in un servizio di logging esterno dedicato.
- **Scale to zero** non è supportato. Ogni backend mantiene sempre attiva almeno un'istanza.

## Pagine correlate

- [Rebase Cloud](/docs/deployment/cloud/): collegamento, deployment, parametri di calcolo e cosa non include la beta
- [Funzioni personalizzate](/docs/backend/custom-functions/): scrittura delle rotte in `backend/functions/`
- [Runtime e bundle](/docs/architecture/runtime-and-bundles/): cosa costituisce un bundle e come viene avviato dal runtime
- [Storage](/docs/backend/storage/): bucket, endpoint, limiti di dimensione e regole di accesso
- [Esecuzione di più istanze](/docs/deployment/multiple-instances/): lo stato mantenuto da Rebase per processo
