---
sourceHash: 63d8ba53bb0e0c67
title: Runtime backend gestito
sidebar_label: Runtime gestito
description: Cosa può e non può fare un backend con runtime "managed" su Rebase Cloud — pacchetti e binari, memoria e CPU, timeout e dimensioni del body, il filesystem, lo stato in memoria, secret, storage per i file generati e rete in uscita.
---

Un'applicazione backend dichiarata in questo modo in `rebase.json` viene eseguita sul **runtime gestito**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Gestito significa che rilasci un bundle, non un'immagine. `rebase cloud deploy` compila le tue collection, `backend/functions/` e i cron job in `dist-bundle`, lo carica e Rebase Cloud lo avvia sull'immagine pubblicata `rebasepro/server`. Non scrivi mai un Dockerfile e non puoi nemmeno modificare ciò che si trova nell'immagine. Questa pagina elenca ciò che è consentito, permettendoti di pianificare una funzionalità prima di implementarla.

I valori qui riportati provengono dal runtime e dalla piattaforma così come sono oggi. Alcuni sono parametri che puoi modificare, e la pagina indica quali. Alcuni aspetti non sono ancora definiti; sono contrassegnati come **Non ancora definito** e raccolti [alla fine](#non-ancora-definito). Non basarti su di essi senza aver prima chiesto conferma.

## In breve

| Domanda | Risposta |
|---|---|
| Versione di Node | Node 22, su Debian slim, `linux`/`x64` |
| Pacchetti npm | Sì, solo in puro JavaScript. Installati all'avvio di ciascuna istanza |
| Moduli nativi (`.node`, node-gyp) | No. `rebase cloud deploy` rifiuta il bundle |
| WebAssembly | Non verificato né bloccato. **Non ancora definito** se sia supportato |
| Avviare un processo figlio | Non bloccato, ma non c'è quasi nulla da eseguire. Consulta [Binari](#binari-e-processi-figli) |
| Memoria e CPU | Configurate per progetto con `rebase cloud compute`. Consulta [Compute](#compute-e-istanze) |
| Istanze | 1 per impostazione predefinita. Puoi fissarne fino a 5, oppure lasciare che l'autoscaler arrivi fino a 16 |
| Timeout della funzione | 30 secondi, poi `504 FUNCTION_TIMEOUT`. Configurabile |
| Body della richiesta | 10 MiB, poi `413`. Configurabile, fino ai 64 MiB accettati dall'edge |
| Filesystem scrivibile | Sì, ma è temporaneo e appartiene a una singola istanza |
| Stato a livello di modulo (una cache `Map`) | Sopravvive tra le richieste sulla stessa istanza. Perso a ogni deploy e riavvio, e non condiviso tra le istanze |
| Variabili d'ambiente e secret | `rebase cloud env set`, applicate al deploy successivo |
| Archiviazione file | Un bucket per progetto, servito dal tuo backend su `/api/storage/file/…` |
| HTTP in uscita | Sì, sulle porte 80 e 443 (e 465, 587, 993 per le email). Le altre porte sono bloccate |

## Codice e pacchetti

**Node e l'immagine.** L'immagine di runtime è basata su `node:22-slim` (Debian) e il tuo bundle viene eseguito su `linux`/`x64` come utente non-root. Il tuo `tsconfig` e la versione di Node sulla tua macchina non modificano questo comportamento.

**Dipendenze.** Il bundle elenca le dipendenze dichiarate nei tuoi file `package.json`. Il caricamento non include `node_modules`. Ciascuna istanza installa le dipendenze dal registry pubblico di npm al momento dell'avvio, con `npm ci` (o `npm install` in assenza di un lockfile). Da ciò derivano tre conseguenze:

- **Gli script di installazione non vengono mai eseguiti.** L'installazione utilizza `--ignore-scripts`. Un pacchetto che scarica un binario o compila qualcosa in `postinstall` viene installato senza di esso.
- **Vengono installate solo versioni dal registry.** Una dipendenza `file:`, `link:`, `git+…` o `github:` fa fallire la build, poiché il runtime non ha modo di risolverla.
- **Alcuni pacchetti provengono dall'immagine, non da te.** `@rebasepro/*`, `hono`, `zod` e `typescript` vengono rimossi dalle dipendenze del bundle e vengono utilizzate le copie interne dell'immagine, pertanto la tua versione non viene applicata.

Il caricamento del bundle ha un limite massimo di 100 MB, compresso, senza dipendenze.

**I moduli nativi vengono rifiutati.** Un pacchetto che distribuisce un binario compilato `.node` non può essere caricato sul runtime gestito. `rebase build` segnala un avviso e `rebase cloud deploy` si interrompe prima del caricamento:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Il controllo cerca pacchetti nativi noti (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la presenza di `binding.gyp` o `gypfile`, script di installazione che invocano `node-gyp` o `prebuild` e file `.node`. La [guida al deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) elenca i metodi consueti per aggirare il problema. In breve: esegui il lavoro in fase di build, chiama un servizio esterno oppure esegui il deploy con `runtime: "custom"`.

**WebAssembly.** Nulla nella build o nel runtime esamina i file `.wasm`. Un pacchetto in puro JavaScript che carica un file `.wasm` non viene rifiutato e Node 22 è in grado di eseguirlo. Il fatto che funzioni non è stato testato sul runtime gestito, quindi consideralo come **non ancora definito**. Ricorda il [limite di memoria](#compute-e-istanze) se il modulo è di grandi dimensioni, come un modello vocale o di ML.

### Binari e processi figli

Nulla blocca `child_process`, ma l'immagine contiene pochissimo da eseguire: `node`, `npm`, `sh`, `tar` e gli strumenti client di PostgreSQL (`pg_dump`, `pg_restore`). Non ci sono `ffmpeg`, ImageMagick, Python né compilatori. Non puoi aggiungere pacchetti di sistema, poiché non esiste un Dockerfile e il processo non viene eseguito come root.

Un binario contenuto all'interno del tarball di un pacchetto npm viene installato con il pacchetto stesso. Se la sua esecuzione sia supportata è **non ancora definito**. Un binario scaricato da un pacchetto in `postinstall` non arriverà mai, poiché gli script di installazione non vengono eseguiti.

Se una funzionalità richiede un binario, utilizza un'API ospitata per tale operazione, oppure sposta il backend a `runtime: "custom"`, dove puoi compilare la tua immagine.

## Compute e istanze

Ciascun progetto viene eseguito nei propri pod. Memoria e CPU sono per istanza e si configurano tramite i [parametri di compute](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un progetto per il quale non è mai stato impostato alcun parametro viene eseguito come pod burstable: riserva una quantità limitata di risorse e può effettuare burst oltre tale soglia. Esegui `rebase cloud compute` per visualizzare la richiesta (request) e il limite (limit) effettivamente assegnati al tuo progetto. La richiesta predefinita documentata è `250m` CPU e `512Mi` di memoria; il codice della piattaforma attualmente ha impostazioni predefinite inferiori, con un limite di burst di 2 CPU e 2 GiB, quindi questo valore è **non ancora definito**.

Istanze:

- **Una per impostazione predefinita.** `--replicas` fissa un valore compreso tra 1 e 5.
- **L'autoscaling è facoltativo (opt-in).** `--autoscale-max` imposta un limite massimo fino a 16 e `--autoscale-cpu-target` (predefinito 70) indica l'utilizzo di CPU a cui mira l'autoscaler.
- **I deploy sono di tipo rolling.** Una nuova istanza si avvia e diventa pronta prima che la vecchia si arresti, pertanto per un breve periodo due versioni gestiscono il traffico contemporaneamente.

`--spot` e `--scale-to-zero` sono entrambi disattivati per impostazione predefinita. Le istanze spot vengono riavviate senza preavviso. Se `--scale-to-zero` sia attualmente effettivo è **non ancora definito**; pianifica considerando un'istanza sempre in esecuzione.

## Memoria e stato a livello di modulo

Un valore a livello di modulo, come `const cache = new Map()` all'inizio di un file di funzione, risiede nel processo Node. Sopravvive da una richiesta alla successiva sulla stessa istanza. Viene perso ogni volta che quel processo termina:

- a **ogni deploy**, poiché ciascun deploy avvia nuove istanze;
- quando una **variabile d'ambiente** viene modificata e sottoposta a deploy;
- quando un'istanza viene riavviata, rischedulata o (con `--spot`) recuperata.

In presenza di più istanze, ciascuna possiede la propria copia, quindi due richieste possono accedere a cache differenti.

Utilizza una `Map` a livello di modulo come una cache che puoi permetterti di perdere: una cache che velocizza la richiesta successiva ma che non è l'unica copia dei dati. Mantieni qualsiasi elemento la cui produzione abbia comportato un costo, come audio generato o una risposta costosa da un'API, nel database o nello [storage](#storage-per-i-file-generati). Per i client creati una sola volta, come un SDK API, usa `lazyResource` in modo che il client venga inizializzato al primo utilizzo a partire dall'ambiente della richiesta. Consulta [Configurazione e secret](/docs/backend/custom-functions/#configuration-and-secrets).

[Esecuzione di più istanze](/docs/deployment/multiple-instances/) elenca lo stato che Rebase stesso mantiene per processo, come i contatori di rate limit e i canali realtime.

## Il filesystem

Il filesystem del container è scrivibile e `/tmp` funziona. Tuttavia, tutto ciò che vi viene scritto:

- appartiene a una singola istanza e le altre istanze non possono vederlo;
- viene eliminato quando l'istanza si arresta, quindi al più tardi al deploy successivo;
- condivide un limite di 6 GiB di storage effimero con il bundle e i suoi `node_modules` installati. Un'istanza che supera tale limite viene espulsa.

Usalo per file temporanei durante una singola richiesta. Non usarlo come cache tra un deploy e l'altro né come storage per gli upload. Questo è anche il motivo per cui [`STORAGE_TYPE=local` è disattivato in produzione](/docs/backend/storage/#environment-variables).

## Richieste

| Limite | Predefinito | Modificalo con |
|---|---|---|
| Timeout della funzione | 30 s, poi `504` con codice `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` lo disattiva) |
| Body della richiesta, tutte le route `/api/*` | 10 MiB, poi `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in byte |
| Body della richiesta all'edge | 64 MiB | Fisso |
| Singolo file tramite `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chiamate anonime a `/api/functions/*` | 3000 per IP ogni 15 minuti | `rateLimit.anonymousFunctions` |

Alcuni dettagli:

- **Il timeout libera il chiamante, non il lavoro.** A 30 secondi il chiamante riceve un `504` e `getSignal(c)` viene interrotto. Passa questo segnale a `fetch` e a qualsiasi altra operazione che ne accetti uno, in modo che anche l'elaborazione si interrompa. Consulta [Timeout e rate limit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge ha un proprio timeout.** Le richieste raggiungono le tue istanze attraverso un ingress nginx che non imposta un proprio timeout di lettura, pertanto si applica il valore predefinito del controller (60 secondi in ingress-nginx). Incrementare `REBASE_FUNCTIONS_TIMEOUT_MS` oltre tale soglia è **non ancora definito**: l'edge potrebbe chiudere la connessione prima. Per operazioni che richiedono minuti, rispondi immediatamente ed esegui il lavoro in un [job](/docs/backend/jobs/) o in `waitUntil`.
- **Gli upload superiori a 64 MiB** richiedono l'upload con ripresa automatica (TUS), che invia il file a blocchi. `client.storage.putObject()` passa automaticamente a questo metodo al di sopra degli 8 MiB.
- **Dimensione della risposta.** Né il runtime né l'edge impongono un limite alla dimensione della risposta. Una risposta di grandi dimensioni viene comunque mantenuta in memoria se il tuo handler la costruisce in un unico blocco, quindi trasmettila in streaming o servila dallo storage.

## Variabili d'ambiente e secret

Impostale tramite CLI o nella console. Non esiste un campo dedicato in `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Una modifica viene applicata al deploy successivo.** Le istanze in esecuzione mantengono i valori con cui sono state avviate. `set` e `unset` lo ricordano (`Pending redeploy`).
- **Limiti:** fino a 100 variabili per progetto, 32 KiB per valore e 256 KiB complessivi. I nomi seguono il formato `[A-Za-z_][A-Za-z0-9_]*`.
- **Alcuni nomi sono riservati.** La piattaforma imposta autonomamente `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV`, e vincola le modalità di esecuzione del processo (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). L'impostazione di una di queste variabili viene rifiutata e l'errore ne elenca l'elenco completo.
- **`CORS_ORIGINS` deriva dai tuoi domini.** La piattaforma lo imposta con l'host del progetto e i suoi [domini personalizzati](/docs/deployment/cloud/#the-rest-of-the-surface) verificati, e tale valore ha la precedenza su uno impostato da te. Aggiungi un'origine con `rebase cloud domains`, non con `env set`.
- **Le variabili di storage sono predefinite.** La piattaforma compila le variabili `STORAGE_*` e `S3_*` per il proprio bucket, e un valore impostato da te ha la precedenza.
- **I nomi tipici del build-time vengono rifiutati.** Le variabili `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e `REACT_APP_` sono destinate ai frontend in fase di build e il backend non le riceve mai in tempo utile. L'opzione `--force` consente comunque di memorizzarle.

In una funzione, leggile all'interno dell'handler, mai all'inizio del file:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Una lettura di `process.env` nello scope del modulo che restituisce un valore vuoto causa il fallimento del caricamento dell'intero file, e le relative route restituiranno `404`. Consulta [Configurazione e secret](/docs/backend/custom-functions/#configuration-and-secrets).

## Storage per i file generati

Un progetto Cloud ottiene lo storage dei file non appena lo crei:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Oppure collega il progetto a un bucket di tua proprietà con `rebase cloud storage attach` (S3, R2, MinIO o qualsiasi bucket compatibile con S3). Senza l'uno o l'altro, gli upload risponderanno con `501 STORAGE_NOT_CONFIGURED`. Ulteriori bucket vengono dichiarati in `config/resources.ts`; consulta [Più bucket](/docs/backend/storage/#several-buckets).

Un deploy con storage viene rifiutato finché il progetto non definisce chi può leggere e scrivere i file. Il file `config/storage.ts` dello scaffold esporta un hook `storageAuthorize` a tale scopo. Consulta [Autorizzazione per oggetto](/docs/backend/storage/#per-object-authorization).

**Come vengono serviti i file.** Il tuo backend serve ciascun file all'indirizzo `GET /api/storage/file/<key>`. Legge l'oggetto dal bucket e lo trasmette in streaming, con `Content-Type`, supporto per range request e intestazioni di caching. Non viene fornito alcun URL diretto del bucket da distribuire.

- Una chiave che si trova sotto **`public/`** viene servita a chiunque, senza token, a un URL che non cambia mai. Usala per i file che qualsiasi visitatore può caricare, come l'audio generato per un gioco pubblico.
- Qualsiasi altra chiave è privata. Un client richiede a `/api/storage/metadata/<key>` un URL di download contenente un token, valido per 300 secondi per impostazione predefinita (`STORAGE_DOWNLOAD_TOKEN_TTL`, fino a una settimana).

Da una funzione, scrivi con `rebase.storage` (il bucket predefinito) o `rebase.bucket(…)` (uno con nome specifico). Il tuo hook `storageAuthorize` stabilisce comunque se la scrittura è consentita.

Le trasformazioni delle immagini (`?width=`, `?format=`) richiedono `sharp`, che è un modulo nativo e non è presente nell'immagine gestita. Sul runtime gestito, una richiesta di trasformazione restituisce l'immagine originale.

### Esempio: memorizzare nella cache l'audio generato

Una funzione che converte testo in voce tramite un'API ospitata, memorizza ciascun risultato una sola volta e lo serve successivamente dallo storage. La `Map` evita solo una ricerca nello storage su un'istanza già attiva (warm); il bucket è la vera cache, pertanto un deploy non perde nulla.

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

La route è pubblica, come ogni route in `backend/functions/` finché non viene protetta. Una route reale controllerebbe chi è autorizzato a creare nuovo audio, evitando che estranei consumino il budget della tua API vocale.

## Rete in uscita

Le funzioni possono chiamare servizi esterni. Le connessioni in uscita dalle tue istanze sono consentite verso qualsiasi indirizzo Internet esclusivamente sulle seguenti porte TCP:

| Porta | Utilizzo |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Invio di email tramite SMTP con TLS o STARTTLS |
| 993 | IMAP su TLS |

Tutto il resto è bloccato. Ciò include la porta 25, IMAP in chiaro, nonché database o cache sulle loro porte dedicate: un PostgreSQL su 5432, Redis su 6379 o MongoDB su 27017 all'esterno di Rebase Cloud non sono raggiungibili. Anche l'indirizzo dei metadati cloud (`169.254.169.254`) è bloccato.

La piattaforma non aggiunge alcun proxy né rate limit in uscita; i servizi chiamati dispongono dei propri. Passa `getSignal(c)` a `fetch` in modo che una chiamata si interrompa quando la richiesta va in timeout.

Il traffico esce attraverso un indirizzo condiviso, non dedicato per singolo progetto. Se tale indirizzo sia fisso e pubblicato, per i servizi che richiedono un'allowlist, è **non ancora definito**.

## Avvio e arresto

- **Cold start.** Una nuova istanza scarica il bundle e installa le sue dipendenze prima di iniziare a servire richieste. Tale installazione costituisce la maggior parte del cold start, che richiede tipicamente da 40 a 60 secondi. La piattaforma attende fino a 300 secondi affinché un'istanza diventi operativa. Un albero delle dipendenze voluminoso rende ogni deploy e ogni aumento di scala più lento.
- **Integrità (Health).** La piattaforma controlla `/livez` (il processo è in esecuzione) e `/health` (è in grado di raggiungere il database). Entrambi gli endpoint sono gestiti dal runtime, quindi non devi implementarli.
- **Arresto.** In caso di deploy o riavvio, l'istanza smette di accettare nuove richieste, attende 5 secondi affinché il traffico venga reindirizzato e riceve quindi `SIGTERM`. Le richieste in corso hanno fino a 15 secondi per completarsi. Le promise passate a `waitUntil` ottengono fino a 5 secondi di questo intervallo. Una promise non passata a `waitUntil` viene interrotta. Consulta [Attività in background](/docs/backend/custom-functions/#background-work).

## Quando il runtime gestito non è la scelta adatta

Passa il backend a `"runtime": "custom"` quando necessita di:

- un modulo nativo o un binario di sistema, come `sharp`, `ffmpeg` o un motore vocale locale;
- pacchetti di sistema o un'immagine di base differente;
- una connessione a lunga durata verso qualcosa al di fuori delle porte consentite.

Un runtime personalizzato compila il tuo Dockerfile e da quel momento l'immagine è sotto la tua gestione. `rebase cloud deploy --eject` esegue il passaggio. Consulta [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Non ancora definito

Queste questioni non hanno ancora una risposta definitiva nel codice della piattaforma. Chiedi chiarimenti prima di fare affidamento su di esse.

- **WebAssembly.** Non è bloccato, ma non è stato testato né ufficialmente garantito.
- **Esecuzione di un binario distribuito all'interno di un pacchetto npm.** Non è bloccato, ma non è nemmeno supportato.
- **CPU e memoria predefinite.** Il valore predefinito documentato (`250m`, `512Mi`) e quello attualmente predefinito della piattaforma (richiesta inferiore, burst fino a 2 CPU e 2 GiB) non coincidono. `rebase cloud compute` mostra le risorse effettive del tuo progetto.
- **Scale to zero.** Il parametro `--scale-to-zero` è accettato. Non è confermato se attualmente modifichi l'esecuzione del progetto.
- **Richieste superiori a 60 secondi.** Il timeout della funzione può essere aumentato, ma l'edge antistante potrebbe chiudere la connessione in base al proprio valore predefinito.
- **Un indirizzo IP in uscita fisso** utilizzabile per l'allowlist di terze parti.
- **Un'origine browser che non rientra nei domini del progetto**, come un frontend ospitato altrove. Il valore `CORS_ORIGINS` della piattaforma ha la precedenza sul tuo.
- **Registry npm privati.** L'installazione delle dipendenze non legge file `.npmrc` né token, pertanto i pacchetti privati sembrano non installarsi.
- **Conservazione dei log.** `rebase cloud logs --runtime` mostra l'output recente; la durata di conservazione dei log non è documentata.

## Pagine correlate

- [Rebase Cloud](/docs/deployment/cloud/): collegamento, deploy, parametri di compute e cosa non è incluso nella beta
- [Funzioni personalizzate](/docs/backend/custom-functions/): scrittura delle route in `backend/functions/`
- [Runtime e bundle](/docs/architecture/runtime-and-bundles/): cos'è un bundle e come il runtime lo avvia
- [Storage](/docs/backend/storage/): bucket, endpoint, limiti dimensionali e regole di accesso
- [Esecuzione di più istanze](/docs/deployment/multiple-instances/): lo stato mantenuto da Rebase per processo
