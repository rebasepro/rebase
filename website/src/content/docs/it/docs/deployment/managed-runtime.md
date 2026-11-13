---
sourceHash: 9e1445cbb512338c
title: Runtime di backend gestito
sidebar_label: Runtime Gestito
description: Cosa può e non può fare un backend con runtime "managed" su Rebase Cloud — pacchetti e file binari, memoria e CPU, timeout e dimensioni del body, filesystem, stato in memoria, secret, storage per file generati e rete in uscita.
---

Un'applicazione backend dichiarata in questo modo in `rebase.json` viene eseguita sul **runtime gestito**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

"Gestito" significa che distribuisci un bundle, non un'immagine. `rebase cloud deploy` compila le tue tabelle, `backend/functions/` e i cron job in `dist-bundle`, lo carica e Rebase Cloud lo avvia sull'immagine pubblicata `rebasepro/server`. Non dovrai mai scrivere un Dockerfile, e allo stesso modo non puoi modificare ciò che è contenuto nell'immagine. Questa pagina elenca cosa è consentito, permettendoti di pianificare una funzionalità prima di svilupparla.

I valori numerici riportati qui derivano dal runtime e dalla piattaforma nello stato attuale. Alcuni sono parametri configurabili, e la pagina specifica quali. Le poche funzionalità non ancora garantite sono raccolte [alla fine](#non-ancora-garantito).

## Panoramica

| Domanda | Risposta |
|---|---|
| Versione di Node | Node 22, su Debian slim, `linux`/`x64` |
| Pacchetti npm | Sì, dal registro pubblico o da uno privato. Installati nel bundle al momento del deploy |
| Moduli nativi (`.node`, node-gyp) | No. `rebase cloud deploy` rifiuta il bundle |
| WebAssembly | Sì |
| Creazione di un processo figlio (spawn) | Sì, per un binario `linux`/`x64` fornito da un pacchetto npm. Vedi [Binari](#binari-e-processi-figlio) |
| Memoria e CPU | Impostati per progetto tramite `rebase cloud compute`. Vedi [Risorse di calcolo](#risorse-di-calcolo-e-istanze) |
| Istanze | 1 per impostazione predefinita, sempre attiva. Puoi bloccarne fino a 5, o consentire all'autoscaler di arrivare fino a 16 |
| Timeout delle funzioni | 30 secondi, poi `504 FUNCTION_TIMEOUT`. Configurabile fino a 10 minuti |
| Body della richiesta | 10 MiB, poi `413`. Configurabile, fino ai 64 MiB accettati dall'edge |
| Filesystem scrivibile | Sì, ma è temporaneo e appartiene a una singola istanza |
| Stato a livello di modulo (una cache `Map`) | Persiste tra le richieste su una singola istanza. Perso a ogni deploy e riavvio, e non condiviso tra istanze |
| Variabili d'ambiente e secret | `rebase cloud env set`, applicati al deploy successivo |
| Archiviazione file | Un bucket per progetto, servito dal tuo backend su `/api/storage/file/…` |
| HTTP in uscita | Sì, sulle porte 80 e 443 (e 465, 587, 993 per le email). Le altre porte sono bloccate. Un unico IP in uscita fisso: `207.175.138.15` |

## Codice e pacchetti

**Node e l'immagine.** L'immagine del runtime è basata su `node:22-slim` (Debian), e il tuo bundle viene eseguito su `linux`/`x64` come utente non-root. Il tuo file `tsconfig` e la versione di Node presente sul tuo computer non influiscono su questo aspetto.

**Dipendenze.** `rebase cloud deploy` installa nel bundle le dipendenze dichiarate nei tuoi file `package.json`, per `linux`/`x64`, e le carica insieme ad esso, in modo che una nuova istanza non debba installare nulla. Un bundle che supererebbe il limite di caricamento di 1 GB includendole viene caricato senza di esse, e l'operazione di deploy lo segnala: ogni istanza le installerà quindi all'avvio, tramite `npm ci` (o `npm install` in assenza di un lockfile). Dal modo in cui vengono installate derivano quattro conseguenze:

- **Gli script di installazione non vengono mai eseguiti.** L'installazione utilizza `--ignore-scripts`. Un pacchetto che scarica un binario o compila qualcosa durante `postinstall` verrà installato senza tale operazione.
- **Vengono installate solo le versioni del registro.** Una dipendenza `file:`, `link:`, `git+…` o `github:` fa fallire la build, poiché il runtime non ha modo di risolverla.
- **Alcuni pacchetti provengono dall'immagine, non dal tuo progetto.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` e `zod` vengono rimossi dalle dipendenze del bundle e sostituiti con collegamenti alle copie interne all'immagine; pertanto la tua versione non verrà applicata. Gli altri pacchetti `@rebasepro/*`, come il driver del database, vengono installati dal tuo `package.json` come qualsiasi altra dipendenza. Anche `typescript` e `tsx` vengono rimossi; sono strumenti di build.
- **I pacchetti privati richiedono un file `.npmrc`.** `rebase build` copia il file `.npmrc` del progetto (e `backend/.npmrc`) all'interno del bundle, affinché l'installazione utilizzi le stesse impostazioni di registro del tuo computer locale. Ogni credenziale al suo interno deve essere un riferimento a una variabile d'ambiente, mai il token in chiaro; un token letterale fa fallire la build, poiché il bundle viene caricato insieme al tuo codice:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

L'upload del bundle ha un limite massimo di 1 GB, compresso.

**I moduli nativi vengono rifiutati.** Un pacchetto che include un binario `.node` compilato non può essere caricato sul runtime gestito. `rebase build` mostrerà un avviso in merito, e `rebase cloud deploy` interromperà l'esecuzione prima dell'upload:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Il controllo cerca pacchetti nativi noti (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la presenza di `binding.gyp` o `gypfile`, script di installazione che richiamano `node-gyp` o `prebuild`, e file `.node`. La [guida al deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) elenca i modi consueti per aggirare il problema. In sintesi: esegui il lavoro in fase di build, chiama un servizio esterno oppure esegui il deploy con `runtime: "custom"`.

**WebAssembly è supportato.** Un pacchetto che distribuisce un file `.wasm` e lo carica da JavaScript non è un modulo nativo, e Node 22 è in grado di eseguirlo. Verificato nell'immagine di base del runtime con le impostazioni di sicurezza del pod, utilizzando `esbuild-wasm`. Tieni presente il [limite di memoria](#risorse-di-calcolo-e-istanze) se il modulo è di grandi dimensioni, come nel caso di modelli vocali o di machine learning.

### Binari e processi figlio

`child_process` è supportato. L'immagine in sé include pochissimi strumenti eseguibili: `node`, `npm`, `sh`, `tar` e gli strumenti client di PostgreSQL (`pg_dump`, `pg_restore`). Non sono presenti `ffmpeg`, ImageMagick, Python né alcun compilatore, e non è possibile aggiungere pacchetti di sistema poiché non è presente un Dockerfile e il processo non ha privilegi di root.

Un file binario distribuito da un pacchetto npm **all'interno del proprio tarball** viene installato insieme al pacchetto ed eseguito correttamente. Deve essere compilato per `linux`/`x64` contro glibc (Debian), e viene eseguito come utente non privilegiato privo di Linux capabilities. Verificato con `@esbuild/linux-x64` nell'immagine di base del runtime. Un binario che un pacchetto *scarica* durante `postinstall` non sarà mai presente, poiché gli script di installazione non vengono eseguiti; pacchetti come `ffmpeg-static` funzionano in questo modo.

Se una funzionalità richiede un binario, utilizza un'API ospitata per tale elaborazione, oppure sposta il backend a `runtime: "custom"`, dove potrai creare la tua immagine personalizzata.

## Risorse di calcolo e istanze

Ciascun progetto viene eseguito nei propri pod dedicati. La memoria e la CPU sono assegnate per istanza e possono essere configurate tramite i [parametri di calcolo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # risorse attualmente riservate dal progetto
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un progetto a cui non sono mai stati assegnati parametri specifici viene eseguito come pod "burstable": riserva `100m` di CPU e `384Mi` di memoria, con la possibilità di raggiungere temporaneamente fino a 2 CPU e 2 GiB. Una richiesta personalizzata mantiene questa proporzione tra richiesta e limite. Esegui `rebase cloud compute` per visualizzare la configurazione attuale del tuo progetto.

Istanze:

- **Una per impostazione predefinita, sempre attiva.** L'opzione `--replicas` consente di fissare un valore compreso tra 1 e 5. Non esiste una riduzione a zero istanze per il backend.
- **L'autoscaling è facoltativo.** Il parametro `--autoscale-max` definisce un limite massimo fino a 16, mentre `--autoscale-cpu-target` (valore predefinito: 70) indica l'utilizzo percentuale della CPU target a cui mira l'autoscaler.
- **I deploy avvengono in modalità rolling.** Una nuova istanza si avvia e diventa pronta a gestire il traffico prima che la vecchia istanza venga arrestata; pertanto, per un breve intervallo di tempo, due versioni differenti serviranno le richieste contemporaneamente.

L'opzione `--spot` è disabilitata per impostazione predefinita; le istanze spot sono più economiche ma possono essere riavviate senza preavviso.

## Memoria e stato a livello di modulo

Un valore definito a livello di modulo, come `const cache = new Map()` all'inizio di un file di funzione, risiede nel processo Node. Persiste tra richieste successive indirizzate alla medesima istanza. Tuttavia, viene perso ogni volta che il processo termina:

- a **ogni deploy**, poiché ciascun deploy avvia nuove istanze;
- quando una **variabile d'ambiente** viene modificata e distribuita;
- quando un'istanza viene riavviata, rischedulata o (con `--spot`) revocata.

Se sono presenti più istanze, ciascuna disporrà di una propria copia, il che significa che due richieste differenti potrebbero consultare cache disallineate.

Utilizza una `Map` a livello di modulo come una cache che puoi permetterti di perdere: utile per velocizzare la richiesta successiva, ma che non sia l'unica copia dei dati. Archivia tutto ciò che ha richiesto un costo per essere generato, come un file audio o una risposta onerosa da un'API, nel database o nello [storage](#storage-per-file-generati). Per i client creati una sola volta, come l'SDK di un'API, usa `lazyResource` affinché il client venga inizializzato al primo utilizzo attingendo all'ambiente della richiesta. Vedi [Configurazione e Secret](/docs/backend/custom-functions/#configuration-and-secrets).

La sezione [Esecuzione di più istanze](/docs/deployment/multiple-instances/) elenca lo stato gestito internamente da Rebase per processo, come i contatori di rate limit e i canali realtime.

## Filesystem

Il filesystem del container è accessibile in scrittura e la directory `/tmp` è utilizzabile. Tuttavia, qualsiasi dato scritto lì:

- appartiene esclusivamente a una singola istanza e non è visibile alle altre;
- viene cancellato nel momento in cui l'istanza si arresta, e al più tardi durante il deploy successivo;
- condivide un limite di archiviazione temporanea (ephemeral storage) di 6 GiB con il bundle e la cartella `node_modules` installata. Un'istanza che supera questo limite viene terminata (evicted).

Utilizzalo per file temporanei necessari durante l'elaborazione di una singola richiesta. Non usarlo come cache persistente tra i deploy o come storage per i file caricati dagli utenti. Questo è anche il motivo per cui [`STORAGE_TYPE=local` è disabilitato in produzione](/docs/backend/storage/#environment-variables).

## Richieste

| Limite | Predefinito | Come modificarlo |
|---|---|---|
| Timeout delle funzioni | 30 s, poi `504` con codice `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo disabilita) |
| Attesa sull'istanza, a livello di edge | 10 minuti tra letture o scritture | Fisso |
| Body della richiesta, rotte `/api/*` senza limite specifico | 10 MiB, poi `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in byte |
| Body della richiesta a livello di edge | 64 MiB | Fisso |
| Singolo file tramite `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chiamate anonime a `/api/functions/*` | 3000 per IP ogni 15 minuti | `rateLimit.anonymousFunctions` |

Alcuni dettagli:

- **Il timeout libera il chiamante, non arresta l'elaborazione.** Trascorsi 30 secondi, il chiamante riceve un `504` e `getSignal(c)` viene interrotto (aborted). Passa questo segnale a `fetch` e a qualsiasi altra operazione che ne accetti uno, in modo da interrompere anche il lavoro in background. Vedi [Timeout e Rate Limit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attende più a lungo del runtime.** Il layer di ingress a monte delle tue istanze attende fino a 10 minuti, pertanto il limite effettivo incontrato da una richiesta è quello del runtime, che risponde con un JSON e interrompe il segnale. Puoi aumentare `REBASE_FUNCTIONS_TIMEOUT_MS` fino a questa soglia. Per operazioni che richiedono più tempo o che devono sopravvivere a un deploy (un'istanza effettua il drain per 15 secondi), rispondi immediatamente ed esegui l'elaborazione in un [job](/docs/backend/jobs/).
- **I caricamenti superiori a 64 MiB** richiedono l'upload riprendibile (TUS), che invia il file a blocchi (chunk). `client.storage.putObject()` passa automaticamente a questa modalità per file superiori a 8 MiB.
- **Dimensioni della risposta.** Né il runtime né l'edge impongono limiti sulla dimensione della risposta. Tuttavia, una risposta di grandi dimensioni viene comunque mantenuta in memoria se il tuo handler la costruisce in un unico blocco; pertanto, è consigliabile trasmetterla in streaming o servirla direttamente dallo storage.

## Variabili d'ambiente e secret

Puoi impostarli tramite la CLI o dalla console. Non è presente un campo dedicato in `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # di sola scrittura: non verrà mai più mostrato
rebase cloud env list                            # solo i nomi, mai i valori
rebase cloud deploy                              # applica le modifiche
```

- **Una modifica viene applicata al deploy successivo.** Le istanze in esecuzione mantengono i valori con cui sono state avviate. I comandi `set` e `unset` lo segnalano esplicitamente (`Pending redeploy`).
- **Limiti:** fino a 100 variabili per progetto, 32 KiB per valore e 256 KiB complessivi. I nomi devono rispettare il pattern `[A-Za-z_][A-Za-z0-9_]*`.
- **Alcuni nomi sono riservati.** La piattaforma imposta autonomamente `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV`, e definisce i parametri di esecuzione del processo (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Il tentativo di impostare una di queste variabili verrà rifiutato con un errore che le elenca tutte.
- **`CORS_ORIGINS` include inizialmente i tuoi domini.** La piattaforma lo imposta con l'host del progetto e i suoi [domini personalizzati](/docs/deployment/cloud/#the-rest-of-the-surface) verificati. Eventuali valori assegnati a `CORS_ORIGINS` vengono aggiunti a tale elenco, utile nel caso di un frontend servito da una posizione esterna: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Le variabili di storage sono predefinite.** La piattaforma definisce le variabili `STORAGE_*` e `S3_*` per il proprio bucket; qualsiasi valore impostato manualmente ha la priorità.
- **I nomi tipici della fase di build vengono rifiutati.** Le variabili `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e `REACT_APP_` sono destinate ai frontend durante la fase di compilazione, e il backend non le riceverebbe in tempo utile. L'opzione `--force` consente comunque di memorizzarle.

All'interno di una funzione, leggi le variabili all'interno dell'handler, mai all'inizio del file:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Una lettura di `process.env` nello scope del modulo che restituisce un valore indefinito o vuoto provocherà il fallimento del caricamento dell'intero file, e le relative rotte risponderanno con un errore `404`. Vedi [Configurazione e Secret](/docs/backend/custom-functions/#configuration-and-secrets).

## Storage per file generati

Un progetto Cloud ottiene lo storage per i file non appena lo crei:

```bash
rebase cloud storage create   # crea un bucket gestito e le relative credenziali
rebase cloud deploy           # il backend in esecuzione riceve le credenziali al momento del deploy
```

In alternativa, puoi collegare il progetto a un bucket di tua proprietà con `rebase cloud storage attach` (S3, R2, MinIO o qualsiasi bucket compatibile con S3). Senza una di queste configurazioni, i caricamenti risponderanno con `501 STORAGE_NOT_CONFIGURED`. Ulteriori bucket possono essere dichiarati in `backend/resources.ts`; vedi [Bucket multipli](/docs/backend/storage/#several-buckets).

Un deploy con storage abilitato viene bloccato finché il progetto non specifica chi ha i permessi di lettura e scrittura dei file. Il file `backend/storage.ts` generato con lo scaffold esporta l'hook `storageAuthorize` a questo scopo. Vedi [Autorizzazione per oggetto](/docs/backend/storage-authorization/).

**Come vengono serviti i file.** Il tuo backend serve ciascun file all'indirizzo `GET /api/storage/file/<key>`. Legge l'oggetto dal bucket e lo trasmette in streaming, includendo `Content-Type`, supporto per range request e intestazioni di caching. Non viene fornito alcun URL diretto al bucket.

- Una chiave che si trova sotto **`public/`** viene servita pubblicamente a chiunque, senza token, tramite un URL permanente. È adatta a file che qualsiasi visitatore può caricare, come tracce audio generate per un gioco pubblico.
- Qualsiasi altra chiave è considerata privata. Il client richiede a `/api/storage/metadata/<key>` un URL di download contenente un token, valido per impostazione predefinita per 300 secondi (`STORAGE_DOWNLOAD_TOKEN_TTL`, configurabile fino a una settimana).

All'interno di una funzione, scrivi utilizzando `rebase.storage` (il bucket predefinito) o `rebase.bucket(…)` (un bucket con nome specifico). L'hook `storageAuthorize` continuerà a determinare se l'operazione di scrittura è consentita.

Le trasformazioni delle immagini (`?width=`, `?format=`) richiedono `sharp`, che è un modulo nativo e non è presente nell'immagine del runtime gestito. Sul runtime gestito, una richiesta di trasformazione restituirà l'immagine originale.

### Esempio: memorizzare in cache l'audio generato

Una funzione che converte testo in voce tramite un'API esterna, memorizza ogni risultato una sola volta e lo serve successivamente dallo storage. L'oggetto `Map` serve unicamente a evitare una ricerca nello storage sulle istanze già attive ("warm"); il bucket costituisce la vera cache, garantendo che un nuovo deploy non comporti perdite di dati.

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

La rotta è pubblica, come tutte le rotte in `backend/functions/` finché non viene protetta esplicitamente. In un'applicazione reale, dovresti verificare chi ha i permessi per generare nuovo audio, per evitare che utenti non autorizzati consumino il budget della tua API vocale.

## Rete in uscita

Le funzioni possono invocare servizi esterni. Le connessioni in uscita dalle tue istanze sono permesse verso qualsiasi indirizzo internet limitatamente a queste sole porte TCP:

| Porta | Utilizzo |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Invio di email tramite SMTP con TLS o STARTTLS |
| 993 | IMAP con TLS |

Tutte le altre porte sono bloccate. Questo include la porta 25, IMAP in chiaro, e database o sistemi di caching sulle loro porte standard: Redis sulla porta 6379 o MongoDB sulla 27017 situati al di fuori di Rebase Cloud non sono raggiungibili. Anche l'indirizzo dei metadati cloud (`169.254.169.254`) è bloccato.

L'unica eccezione riguarda il proprio database. Se il progetto utilizza un'istanza PostgreSQL esterna (BYODB), ciascun deploy abilita le connessioni verso l'host di quel database sulla porta specificata nella stringa di connessione, e a nient'altro su tale porta. L'host viene risolto nei relativi indirizzi IP al momento del deploy; pertanto, se il provider sposta il database su un altro indirizzo, sarà necessario eseguire nuovamente il deploy. Il database deve accettare connessioni da Internet: l'applicazione si connette direttamente tramite la stringa di connessione. I parametri del bastion host SSH vengono usati unicamente per il test di connessione, non dall'applicazione distribuita.

La piattaforma non aggiunge alcun proxy né limitazioni di frequenza (rate limit) in uscita; i servizi chiamati applicheranno i propri limiti. Assicurati di passare `getSignal(c)` a `fetch` in modo che la chiamata venga interrotta se la richiesta scade.

Tutto il traffico in uscita proviene da **un unico indirizzo IP fisso, `207.175.138.15`**. Aggiungilo all'allowlist dei servizi di terze parti quando richiesto. Questo indirizzo è condiviso da tutti i progetti su Rebase Cloud, quindi la presenza nell'allowlist certifica solo che la chiamata proviene da Rebase Cloud e non che appartenga al tuo specifico progetto: continua sempre ad autenticarti al servizio anche tramite una chiave o token.

## Avvio e arresto

- **Cold start.** Una nuova istanza scarica ed estrae il bundle prima di iniziare a servire richieste; di conseguenza, un albero di dipendenze molto esteso renderà più lento ogni scale-up. Un bundle caricato senza le dipendenze le installerà in questa fase, aggiungendo dai 40 ai 60 secondi. La piattaforma attende fino a 300 secondi affinché un'istanza sia attiva e pronta.
- **Health check.** La piattaforma verifica `/livez` (il processo è in esecuzione) e `/health` (il processo è in grado di raggiungere il database). Entrambi gli endpoint sono gestiti dal runtime, quindi non devi implementarli.
- **Arresto.** In caso di deploy o riavvio, l'istanza cessa di accettare nuove richieste, attende 5 secondi affinché il traffico venga reindirizzato, quindi riceve il segnale `SIGTERM`. Le richieste in corso hanno fino a 15 secondi per essere completate. Le Promise passate a `waitUntil` hanno a disposizione fino a 5 secondi all'interno di questo intervallo. Una Promise non registrata tramite `waitUntil` viene interrotta immediatamente. Vedi [Elaborazioni in background](/docs/backend/custom-functions/#background-work).

## Quando il runtime gestito non è la scelta adatta

Passa il backend a `"runtime": "custom"` se la tua applicazione necessita di:

- un modulo nativo o un binario di sistema non distribuito da pacchetti npm, come `sharp`, ImageMagick o un motore vocale locale;
- pacchetti di sistema o un'immagine di base differente;
- una connessione persistente a lungo termine verso servizi esterni alle porte consentite.

Un runtime personalizzato compila il tuo Dockerfile e ti affida il controllo completo dell'immagine da quel momento in poi. `rebase cloud deploy --eject` consente di effettuare questo passaggio. Vedi [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Non ancora garantito

- **Storico dei log.** `rebase cloud logs --runtime` legge i log delle istanze attualmente in esecuzione, e `rebase cloud debug logs --previous` recupera l'ultima esecuzione di un'istanza riavviata. L'output generato da un'istanza sostituita da un deploy va perso. Scrivi qualsiasi dato che necessiti di persistenza nel database o su un servizio di log esterno dedicato.
- **Riduzione a zero istanze (Scale to zero)** non è supportata. Ogni backend mantiene attiva almeno un'istanza in qualsiasi momento.

## Pagine correlate

- [Rebase Cloud](/docs/deployment/cloud/): collegamento, deploy, parametri di calcolo e limitazioni attuali della versione beta
- [Funzioni personalizzate](/docs/backend/custom-functions/): scrittura delle rotte in `backend/functions/`
- [Runtime e Bundle](/docs/architecture/runtime-and-bundles/): cos'è un bundle e come viene avviato dal runtime
- [Storage](/docs/backend/storage/): bucket, endpoint, limiti di dimensione e regole di accesso
- [Esecuzione di più istanze](/docs/deployment/multiple-instances/): lo stato mantenuto da Rebase per processo
