---
sourceHash: f02c2b6d0bb6de5f
title: Runtime di backend gestito
sidebar_label: Runtime gestito
description: Cosa può e non può fare un backend con runtime "managed" su Rebase Cloud — pacchetti e binari, memoria e CPU, timeout e dimensioni del body, filesystem, stato in memoria, secret, storage per i file generati e rete in uscita.
---

Un'applicazione backend dichiarata in questo modo in `rebase.json` viene eseguita sul **runtime gestito**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

"Gestito" significa che distribuisci un bundle, non un'immagine. `rebase cloud deploy` compila le tue collection, `backend/functions/` e i cron job in `dist-bundle`, carica il bundle e Rebase Cloud lo avvia sull'immagine pubblicata `rebasepro/server`. Non dovrai mai scrivere un Dockerfile e non puoi modificare il contenuto dell'immagine. Questa pagina elenca cosa è consentito, permettendoti di pianificare una funzionalità prima di implementarla.

I numeri indicati qui si riferiscono al runtime e alla piattaforma allo stato attuale. Alcuni sono parametri configurabili e la pagina specifica quali. Le poche caratteristiche non ancora garantite sono raccolte [alla fine](#non-ancora-garantito).

## Panoramica

| Domanda | Risposta |
|---|---|
| Versione di Node | Node 22, su Debian slim, `linux`/`x64` |
| Pacchetti npm | Sì, dal registry pubblico o da uno privato. Installati all'avvio di ciascuna istanza |
| Moduli nativi (`.node`, node-gyp) | No. `rebase cloud deploy` rifiuta il bundle |
| WebAssembly | Sì |
| Creazione di child process | Sì, per un binario `linux`/`x64` distribuito da un pacchetto npm. Vedi [Binari](#binari-e-child-process) |
| Memoria e CPU | Definiti per progetto con `rebase cloud compute`. Vedi [Risorse di calcolo](#risorse-di-calcolo-e-istanze) |
| Istanze | 1 per impostazione predefinita, sempre attiva. Puoi fissarne fino a 5, o lasciare che l'autoscaler arrivi fino a 16 |
| Timeout della funzione | 30 secondi, poi `504 FUNCTION_TIMEOUT`. Configurabile fino a 10 minuti |
| Body della richiesta | 10 MiB, poi `413`. Configurabile, fino ai 64 MiB accettati dall'edge |
| Filesystem scrivibile | Sì, ma è temporaneo e appartiene a una singola istanza |
| Stato a livello di modulo (cache `Map`) | Persiste tra le richieste su una stessa istanza. Viene perso a ogni deploy e riavvio, e non è condiviso tra le istanze |
| Variabili d'ambiente e secret | `rebase cloud env set`, applicati al deploy successivo |
| Archiviazione file | Un bucket per progetto, servito dal tuo backend su `/api/storage/file/…` |
| HTTP in uscita | Sì, sulle porte 80 e 443 (e 465, 587, 993 per le email). Le altre porte sono bloccate. Nessun IP in uscita fisso |

## Codice e pacchetti

**Node e l'immagine.** L'immagine del runtime è basata su `node:22-slim`
(Debian), e il tuo bundle viene eseguito su `linux`/`x64` come utente non root. Il
tuo `tsconfig` e la versione di Node presente sulla tua macchina non modificano questo comportamento.

**Dipendenze.** Il bundle elenca le dipendenze dichiarate nei tuoi file `package.json`.
L'upload non include `node_modules`. Ciascuna istanza installa le dipendenze al
proprio avvio, tramite `npm ci` (o `npm install` in assenza di un lockfile).
Da ciò conseguono quattro aspetti:

- **Gli script di installazione non vengono mai eseguiti.** L'installazione utilizza `--ignore-scripts`. Un pacchetto che scarica un binario o compila qualcosa in `postinstall` verrà installato senza eseguire tale operazione.
- **Vengono installate solo versioni da registry.** Una dipendenza `file:`, `link:`, `git+…` o `github:` fa fallire la build, poiché il runtime non ha modo di risolverla.
- **Alcuni pacchetti provengono dall'immagine, non dal tuo progetto.** `@rebasepro/*`, `hono`, `@hono/node-server` e `zod` vengono rimossi dalle dipendenze del bundle e vengono collegate le copie interne all'immagine; pertanto la tua versione non verrà applicata. Anche `typescript` e `tsx` vengono rimossi, in quanto strumenti di build.
- **I pacchetti privati richiedono un file `.npmrc`.** `rebase build` copia il file `.npmrc` del progetto (e `backend/.npmrc`) all'interno del bundle, affinché l'installazione utilizzi le stesse impostazioni di registry della tua macchina. Ogni credenziale al suo interno deve essere un riferimento a una variabile d'ambiente, mai il token in chiaro; un token letterale farà fallire la build, poiché il bundle viene caricato insieme al tuo codice:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

L'upload del bundle ha un limite massimo di 100 MB, compresso, senza dipendenze.

**I moduli nativi vengono rifiutati.** Un pacchetto che distribuisce un binario compilato `.node` non può essere caricato sul runtime gestito. `rebase build` segnala un avviso e `rebase cloud deploy` si interrompe prima dell'upload:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Il controllo verifica la presenza di pacchetti nativi noti (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), di file `binding.gyp` o `gypfile`, di script di installazione che invocano `node-gyp` o `prebuild`, e di file `.node`. La [guida al deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) elenca le soluzioni abituali per ovviare a questo problema. In breve: esegui l'operazione in fase di build, richiama un servizio esterno oppure esegui il deploy con `runtime: "custom"`.

**WebAssembly è supportato.** Un pacchetto che distribuisce un file `.wasm` e lo carica da JavaScript non è considerato un modulo nativo, e Node 22 lo esegue senza problemi. Questo è stato verificato nell'immagine di base del runtime con le impostazioni di sicurezza del pod, usando `esbuild-wasm`. Ricorda il [limite di memoria](#risorse-di-calcolo-e-istanze) se il modulo è di grandi dimensioni, come ad esempio un modello vocale o di ML.

### Binari e child process

`child_process` funziona. L'immagine include pochissimi eseguibili: `node`, `npm`, `sh`, `tar` e gli strumenti client di PostgreSQL (`pg_dump`, `pg_restore`). Non sono presenti `ffmpeg`, ImageMagick, Python né compilatori, e non è possibile aggiungere pacchetti di sistema poiché non è presente un Dockerfile e il processo non viene eseguito come root.

Un binario incluso da un pacchetto npm **all'interno del proprio tarball** viene installato con il pacchetto ed eseguito correttamente. Deve essere compilato per `linux`/`x64` con glibc (Debian), e viene eseguito come utente senza privilegi e privo di Linux capabilities. Verificato con `@esbuild/linux-x64` nell'immagine di base del runtime. Un binario che un pacchetto *scarica* durante `postinstall` non sarà mai disponibile, poiché gli script di installazione non vengono eseguiti; pacchetti come `ffmpeg-static` funzionano in questo modo.

Se una funzionalità richiede un binario, utilizza un'API ospitata esternamente per tale operazione, oppure sposta il backend su `runtime: "custom"`, dove potrai creare la tua immagine personalizzata.

## Risorse di calcolo e istanze

Ogni progetto viene eseguito nei propri pod dedicati. Memoria e CPU sono allocate per istanza e possono essere configurate tramite i [parametri di calcolo](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # le risorse attualmente riservate dal progetto
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un progetto per cui non è mai stato impostato alcun parametro viene eseguito come pod "burstable": riserva `100m` di CPU e `384Mi` di memoria, con la possibilità di effettuare burst fino a 2 CPU e 2 GiB. Una configurazione manuale mantiene tale rapporto tra request e limit. Esegui `rebase cloud compute` per visualizzare le risorse assegnate al tuo progetto.

Istanze:

- **Una per impostazione predefinita, sempre attiva.** `--replicas` fissa un valore compreso tra 1 e 5. Nessun meccanismo riduce il backend a zero istanze.
- **L'autoscaling è facoltativo.** `--autoscale-max` definisce un limite massimo fino a 16 istanze, mentre `--autoscale-cpu-target` (predefinito 70) imposta l'utilizzo di CPU a cui mira l'autoscaler.
- **I deploy avvengono in modalità rolling.** Una nuova istanza viene avviata e diventa pronta prima che la precedente venga arrestata; per un breve periodo di tempo due versioni gestiranno contemporaneamente il traffico.

`--spot` è disattivato per impostazione predefinita; le istanze spot sono più economiche, ma possono essere riavviate senza preavviso.

## Memoria e stato a livello di modulo

Un valore a livello di modulo, come `const cache = new Map()` in cima a un file di funzione, risiede nel processo Node. Esso persiste da una richiesta alla successiva sulla medesima istanza, ma viene perso ogni volta che il processo termina:

- a **ogni deploy**, poiché ciascun deploy avvia nuove istanze;
- quando una **variabile d'ambiente** viene modificata e distribuita;
- quando un'istanza viene riavviata, rischedulata o (con `--spot`) revocata.

Se sono presenti più istanze, ciascuna possiede la propria copia; di conseguenza, due richieste distinte possono accedere a cache differenti.

Utilizza una `Map` a livello di modulo come una cache che puoi permetterti di perdere: utile per velocizzare la richiesta successiva, ma non come unica copia dei dati. Conserva tutto ciò che ha un costo di generazione elevato, come file audio generati o risposte API onerose, nel database o nello [storage](#storage-per-i-file-generati). Per i client inizializzati una sola volta, come un SDK per API, utilizza `lazyResource` in modo che il client venga creato al primo utilizzo a partire dall'ambiente della richiesta. Consulta [Configurazione e secret](/docs/backend/custom-functions/#configuration-and-secrets).

La guida [Esecuzione di più istanze](/docs/deployment/multiple-instances/) elenca lo stato gestito internamente da Rebase per singolo processo, come i contatori di rate limit e i canali realtime.

## Il filesystem

Il filesystem del container è scrivibile e `/tmp` è utilizzabile. Tuttavia, tutto ciò che vi viene scritto:

- appartiene a una singola istanza e non è visibile alle altre;
- viene eliminato all'arresto dell'istanza, e quindi al più tardi al deploy successivo;
- condivide un limite di 6 GiB di storage temporaneo (ephemeral storage) con il bundle e la relativa cartella `node_modules`. Un'istanza che supera tale soglia viene rimossa (evicted).

Utilizzalo per file temporanei durante la gestione di una singola richiesta. Non utilizzarlo come cache persistente tra i deploy né come storage per gli upload. Questo è anche il motivo per cui [`STORAGE_TYPE=local` è disattivato in produzione](/docs/backend/storage/#environment-variables).

## Richieste

| Limite | Predefinito | Modificabile con |
|---|---|---|
| Timeout della funzione | 30 s, poi `504` con codice `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo disattiva) |
| Attesa sulla tua istanza, a livello di edge | 10 minuti tra letture o scritture | Fisso |
| Body della richiesta, tutte le route `/api/*` | 10 MiB, poi `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in byte |
| Body della richiesta a livello di edge | 64 MiB | Fisso |
| Singolo file tramite `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chiamate anonime a `/api/functions/*` | 3000 per IP ogni 15 minuti | `rateLimit.anonymousFunctions` |

Alcuni dettagli:

- **Il timeout sblocca il chiamante, non l'esecuzione del task.** Allo scadere dei 30 secondi il chiamante riceve un `504` e il segnale restituito da `getSignal(c)` viene interrotto. Passa tale segnale a `fetch` e a qualsiasi altra operazione che ne accetti uno, in modo da interrompere anche il lavoro in background. Consulta [Timeout e rate limit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attende più a lungo del runtime.** L'ingress posizionato davanti alle tue istanze attende fino a 10 minuti; pertanto il limite riscontrato da una richiesta è quello del runtime, che risponde in formato JSON e interrompe il segnale. Puoi aumentare `REBASE_FUNCTIONS_TIMEOUT_MS` fino a questo valore. Per operazioni che richiedono più tempo, o che devono sopravvivere a un deploy (un'istanza effettua un drain di 15 secondi), rispondi immediatamente ed esegui l'elaborazione all'interno di un [job](/docs/backend/jobs/).
- **Gli upload superiori a 64 MiB** richiedono l'upload resumable (TUS), che invia il file a blocchi (chunks). `client.storage.putObject()` passa automaticamente a questa modalità sopra gli 8 MiB.
- **Dimensione della risposta.** Né il runtime né l'edge impongono un limite alla dimensione della risposta. Tuttavia, una risposta di grandi dimensioni viene comunque mantenuta in memoria se il tuo handler la compone per intero in un unico blocco; è consigliabile quindi trasmetterla in streaming o servirla direttamente dallo storage.

## Variabili d'ambiente e secret

Puoi impostarli tramite la CLI o dalla console. Non esiste un campo dedicato a essi all'interno di `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: non verrà mai più mostrato
rebase cloud env list                            # solo i nomi, mai i valori
rebase cloud deploy                              # applica le modifiche
```

- **Le modifiche vengono applicate al deploy successivo.** Le istanze in esecuzione mantengono i valori con cui sono state avviate. I comandi `set` e `unset` lo segnalano esplicitamente (`Pending redeploy`).
- **Limiti:** fino a 100 variabili per progetto, 32 KiB per valore e 256 KiB complessivi. I nomi devono rispettare il pattern `[A-Za-z_][A-Za-z0-9_]*`.
- **Alcuni nomi sono riservati.** La piattaforma imposta autonomamente `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV`, oltre a definire parametri di esecuzione del processo (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). L'impostazione di una di queste variabili viene rifiutata e il messaggio di errore le elenca tutte.
- **`CORS_ORIGINS` include automaticamente i tuoi domini.** La piattaforma lo imposta con l'host del progetto e i relativi [domini personalizzati](/docs/deployment/cloud/#the-rest-of-the-surface) verificati. Un valore di `CORS_ORIGINS` definito manualmente viene aggiunto a tale elenco, utile per frontend serviti altrove: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Le variabili di storage sono predefinite.** La piattaforma assegna le variabili `STORAGE_*` e `S3_*` per il proprio bucket; un eventuale valore configurato manualmente avrà la precedenza.
- **I nomi tipici del build-time vengono rifiutati.** I prefissi `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e `REACT_APP_` sono destinati ai frontend in fase di compilazione e il backend non potrebbe accedervi in tempo utile. L'opzione `--force` consente comunque di registrarli.

All'interno di una funzione, leggi le variabili all'interno dell'handler, mai in cima al file:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

La lettura di `process.env` nello scope del modulo che restituisca un valore vuoto causa il fallimento del caricamento dell'intero file, e le route corrispondenti risponderanno con `404`. Consulta [Configurazione e secret](/docs/backend/custom-functions/#configuration-and-secrets).

## Storage per i file generati

Un progetto Cloud ottiene lo storage per i file non appena viene creato:

```bash
rebase cloud storage create   # un bucket gestito e le relative credenziali
rebase cloud deploy           # il backend in esecuzione riceve le credenziali al deploy
```

In alternativa, puoi collegare il progetto a un bucket di tua proprietà tramite `rebase cloud storage attach` (S3, R2, MinIO o qualsiasi bucket compatibile con S3). Senza una di queste configurazioni, i tentativi di upload risponderanno con `501 STORAGE_NOT_CONFIGURED`. Ulteriori bucket possono essere dichiarati in `config/resources.ts`; consulta [Bucket multipli](/docs/backend/storage/#several-buckets).

Un deploy con storage viene rifiutato finché il progetto non specifica chi dispone dei permessi di lettura e scrittura sui file. Il file scaffold `config/storage.ts` esporta l'hook `storageAuthorize` a questo scopo. Consulta [Autorizzazione per singolo oggetto](/docs/backend/storage/#per-object-authorization).

**Modalità di distribuzione dei file.** Il tuo backend serve ciascun file all'indirizzo `GET /api/storage/file/<key>`. L'oggetto viene letto dal bucket e trasmesso in streaming, includendo `Content-Type`, gestione delle richieste range e intestazioni di caching. Non viene fornito un URL diretto al bucket.

- Una chiave che inizia con **`public/`** viene servita a chiunque, senza token, tramite un URL permanente. Utilizzala per file accessibili liberamente da qualsiasi visitatore, ad esempio l'audio generato per un gioco pubblico.
- Qualsiasi altra chiave è privata. Il client richiede a `/api/storage/metadata/<key>` un URL di download contenente un token, valido per impostazione predefinita per 300 secondi (`STORAGE_DOWNLOAD_TOKEN_TTL`, configurabile fino a una settimana).

Da una funzione, scrivi utilizzando `rebase.storage` (il bucket predefinito) o `rebase.bucket(…)` (un bucket con nome specifico). L'hook `storageAuthorize` continuerà a verificare se la scrittura è consentita.

Le trasformazioni delle immagini (`?width=`, `?format=`) richiedono `sharp`, che è un modulo nativo non incluso nell'immagine gestita. Sul runtime gestito, una richiesta di trasformazione restituirà l'immagine originale.

### Esempio: memorizzare nella cache l'audio generato

Una funzione che converte testo in voce tramite un'API remota, memorizza ciascun risultato una sola volta e successivamente lo serve dallo storage. La `Map` evita semplicemente una query di lookup allo storage sulle istanze già calde; il bucket funge da vera e propria cache persistente, evitando qualsiasi perdita di dati a seguito di un deploy.

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

La route è pubblica, così come tutte le route in `backend/functions/` finché non vengono protette. Un'implementazione reale dovrebbe verificare chi è autorizzato a generare nuovo audio, per evitare che utenti non autenticati consumino il budget della tua API vocale.

## Rete in uscita

Le funzioni possono effettuare chiamate verso servizi esterni. Le connessioni in uscita dalle tue istanze sono permesse verso qualsiasi indirizzo Internet esclusivamente sulle seguenti porte TCP:

| Porta | Destinazione |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Invio di posta tramite SMTP con TLS o STARTTLS |
| 993 | IMAP su TLS |

Qualsiasi altra porta è bloccata. Ciò include la porta 25, IMAP non crittografato, nonché database o cache che operano sulle proprie porte dedicate: non è possibile raggiungere istanze esterne a Rebase Cloud di PostgreSQL su 5432, Redis su 6379 o MongoDB su 27017. Anche l'indirizzo dei metadati cloud (`169.254.169.254`) è bloccato.

La piattaforma non introduce proxy né limiti di frequenza (rate limit) sul traffico in uscita; si applicano unicamente i limiti imposti dai servizi contattati. Assicurati di passare `getSignal(c)` a `fetch` in modo che la chiamata si interrompa qualora la richiesta vada in timeout.

**Non è previsto un indirizzo IP in uscita fisso**. Il traffico esce tramite un indirizzo condiviso tra tutti i progetti, assegnato dal provider cloud e soggetto a variazioni; non deve quindi essere aggiunto a whitelist di terze parti. Per l'autenticazione verso tali servizi, prediligi l'uso di chiavi o token API.

## Avvio e arresto

- **Cold start.** Una nuova istanza scarica il bundle e installa le relative dipendenze prima di iniziare a gestire il traffico. Tale installazione costituisce la maggior parte del cold start, che in genere richiede tra i 40 e i 60 secondi. La piattaforma attende fino a 300 secondi l'avvio completo di un'istanza. Un albero delle dipendenze voluminoso rallenta sia i deploy che le operazioni di scale-up.
- **Verifiche di integrità (Health).** La piattaforma monitora `/livez` (verifica che il processo sia attivo) e `/health` (verifica la raggiungibilità del database). Entrambi gli endpoint sono gestiti direttamente dal runtime e non richiedono alcuna implementazione manuale.
- **Arresto (Shutdown).** Durante un deploy o un riavvio, l'istanza cessa di accettare nuove richieste, attende 5 secondi affinché il traffico venga reindirizzato, e riceve quindi un segnale `SIGTERM`. Le richieste in corso hanno a disposizione fino a 15 secondi per concludersi. Le promise registrate tramite `waitUntil` possono sfruttare fino a 5 secondi di questo intervallo. Qualsiasi promise non associata a `waitUntil` verrà interrotta. Consulta [Task in background](/docs/backend/custom-functions/#background-work).

## Quando il runtime gestito non è la scelta adatta

Passa il backend a `"runtime": "custom"` quando necessita di:

- un modulo nativo o un binario di sistema non distribuito da un pacchetto npm, come `sharp`, ImageMagick o un motore vocale locale;
- pacchetti di sistema dedicati o un'immagine di base differente;
- connessioni persistenti verso servizi attivi su porte diverse da quelle consentite.

Un runtime personalizzato compila il tuo Dockerfile personale, lasciando a te la gestione completa dell'immagine da quel momento in avanti. Il comando `rebase cloud deploy --eject` esegue questa migrazione. Consulta [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Non ancora garantito

- **Cronologia dei log.** `rebase cloud logs --runtime` legge i log delle istanze attualmente in esecuzione, mentre `rebase cloud debug logs --previous` recupera quelli dell'ultima esecuzione di un'istanza riavviata. L'output prodotto da un'istanza sostituita da un nuovo deploy viene eliminato. Salva nel database o in un servizio esterno dedicato tutti i log che necessiti di conservare.
- **Scale-to-zero** non è attualmente disponibile. Ogni backend mantiene costantemente attiva almeno un'istanza.

## Pagine correlate

- [Rebase Cloud](/docs/deployment/cloud/): collegamento, deployment, parametri di calcolo e funzionalità non incluse nella versione beta
- [Funzioni personalizzate](/docs/backend/custom-functions/): scrittura delle route in `backend/functions/`
- [Runtime e bundle](/docs/architecture/runtime-and-bundles/): struttura del bundle e modalità di avvio da parte del runtime
- [Storage](/docs/backend/storage/): bucket, endpoint, limiti dimensionali e regole di accesso
- [Esecuzione di più istanze](/docs/deployment/multiple-instances/): stato gestito internamente da Rebase per processo
