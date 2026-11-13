---
sourceHash: 1e1ed4905f58d5fd
title: Autorizzazione dello Storage
sidebar_label: Autorizzazione dello Storage
description: Decidi chi può leggere, scrivere, eliminare o elencare ciascun oggetto dello storage con storagePolicies e l'hook storageAuthorize, e di quali scope di storage ha bisogno una chiave API.
---

Le tabelle sono protette dalla sicurezza a livello di riga (row-level security); un bucket non ha un equivalente per singolo oggetto, quindi lo storage viene autorizzato qui. La sezione [Configurazione dello Storage](/docs/backend/storage/) tratta i backend stessi.

## Criteri (Policies)

La forma dichiarativa. Un elenco di pattern di percorso, letti senza eseguire nulla:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una chiave a cui non corrisponde alcun criterio viene rifiutata**, a meno che un hook `storageAuthorize` non la consenta: l'hook viene interpellato solo quando nessun criterio corrisponde alla chiave per quell'operazione, e nessuno dei due può restringere l'altro. Un criterio che ha trovato corrispondenza e non ha concesso l'accesso è definitivo. Ogni estensione dei permessi è una riga esplicita, e un errore nega piuttosto che concedere.

I pattern cercano corrispondenze **per segmento, mai per sottostringa** — `public/**` non corrisponde a
`publicity/secret.png`:

| Pattern | Corrispondenze |
|---|---|
| `avatars/logo.png` | esattamente quella chiave |
| `users/*/avatar.png` | esattamente un segmento dove si trova `*` |
| `users/:uid/**` | un segmento acquisito, poi il resto — compreso nulla |

`**` è valido solo come segmento finale. `:name` acquisisce un segmento e non si
estende mai oltre uno `/`; i valori acquisiti arrivano come `params` sul predicato.

`allow` può essere `"public"` (chiunque sia ammesso dalla route), `"authenticated"` (qualsiasi chiamante
con un uid), o un predicato che riceve i parametri acquisiti, l'utente,
l'operazione e il bucket.

Un criterio viene eseguito dopo l'autenticazione della route, quindi `"public"` da solo non apre
un percorso a chiamanti anonimi. Con `requireAuth` attivo, essi possono raggiungere solo le letture delle chiavi
`public/`, oppure ogni lettura con `storagePublicRead`; `/upload`, `/list`, le eliminazioni e
i caricamenti ripristinabili richiedono sempre un chiamante. Altrimenti la risposta è `401`.

`operations` include per impostazione predefinita tutte e quattro le operazioni — `read`, `write`, `delete`, `list`.

I criteri soddisfano da soli il controllo di avvio per la produzione, e un pattern malformato
fa fallire l'avvio anziché il primo caricamento.

## L'hook

`requireAuth` e `publicRead` sono selettori *globali*: decidono se un chiamante deve aver effettuato l'accesso, non cosa quel chiamante può toccare. Senza un hook di autorizzazione, **qualsiasi utente autenticato può leggere qualsiasi chiave di cui conosca il nome** — l'unica cosa che separa i file di due tenant è l'imprevedibilità della chiave, che non è un modello di controllo degli accessi. Peggio ancora, possono prima eseguire `GET /storage/list?prefix=`, quindi le chiavi non devono nemmeno essere indovinate.

:::caution[Lo storage non si avvia in produzione senza uno di questi]
Le tabelle sono protette dalla sicurezza a livello di riga; lo storage no. Non esiste un
equivalente per singolo oggetto nel bucket, quindi questo hook *è* il modello — e
`initializeRebaseBackend` **genera un'eccezione all'avvio** con `NODE_ENV=production` quando
lo storage è configurato e nessuno dei seguenti elementi è impostato:

- `storageAuthorize` — un hook, per oggetto. Consigliato.
- `storagePolicies` — le regole dichiarate sopra.
- `storagePublicRead: true` — il bucket è a tutti gli effetti un CDN pubblico di sola lettura.
- `storageInsecureAllowAnyAuthenticated: true` — un'app single-tenant in cui ci si fida di ogni
  utente che ha effettuato l'accesso per ogni file. Chiamato così per essere letto due volte.

In fase di sviluppo registra invece un avviso, quindi un progetto può essere configurato male
e funzionare correttamente in locale fino al momento della distribuzione. Un progetto generato tramite scaffolding include già un hook in
`backend/storage.ts` — leggilo prima di sostituirlo, e tieni presente che modella
la *libreria di contenuti condivisa* di un CMS, che non ha la stessa struttura dei file per singolo utente.
:::

`storageAuthorize` è l'analogo per lo storage dell'opzione `rls` di una tabella, e viene eseguito dopo l'autenticazione su ogni route di storage:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Campo | Descrizione |
|-------|-------------|
| `key` | Chiave dell'oggetto, con prefisso del bucket rimosso e directory traversal sanificato |
| `bucket` | Bucket risolto (`"default"` se non specificato) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, oppure `null` dove la route consente l'accesso anonimo |
| `storageId` | Il backend con nome, quando la richiesta ne ha preso di mira uno — la sua chiave canonica (`storageId=%20media` è `"media"`). Assente per la sorgente predefinita, indipendentemente da come la richiesta l'ha denominata (nessun parametro, vuoto, o `(default)`) |
| `data` | Accesso in lettura affidabile che **ignora l'RLS** — `data.table(slug).find(query)` / `.findById(id)`. La proprietà risiede in una riga, non nel prefisso di una chiave, quindi l'hook ha bisogno di un lettore per rispondere a "chi possiede questo oggetto?". Ignora deliberatamente la sicurezza a livello di riga: questo hook *è* la decisione di autorizzazione, e prenderla attraverso un lettore già ristretto dai permessi del chiamante stesso sarebbe circolare. Di sola lettura per progettazione. |

Restituisci `false` per negare con un **403**. Anche generare un'eccezione nega l'accesso: un controllo di proprietà che fallisce non apre l'accesso per errore.

Informazioni utili:

- **La route dei metadati è il punto in cui viene realmente deciso l'accesso in lettura.** Essa genera il token di download a breve durata con scope limitato al percorso di cui la route dei file si fida, quindi l'hook ne controlla l'accesso lì. Due tipi di letture saltano l'hook, per progettazione. Una che trasporta tale token: l'hook l'ha approvata quando il token è stato generato, solo per quel percorso e quella sorgente, quindi un hook che ora rifiuterebbe l'accesso (un'appartenenza revocata nel frattempo) non la blocca prima della scadenza del token — `storageDownloadTokenTtl`, 300 secondi per impostazione predefinita. E una lettura di una chiave sotto `public/` da parte di un chiamante senza credenziali: il prefisso è la dichiarazione che chiunque può leggerla, inclusi visitatori anonimi e CDN. La lettura della chiave da parte di un chiamante che ha effettuato l'accesso viene comunque verificata, ma quella di un visitatore anonimo no, quindi un hook non può rendere privata una chiave `public/`; memorizza invece il file all'esterno di `public/`. Solo queste due letture lo saltano: un utente che il tuo adapter di autenticazione per caso chiama `public` viene verificato come chiunque altro.
- **Un bucket, un nome.** Su S3 e GCS il `bucket` dell'hook è sempre `"default"`, anche quando una richiesta nomina il bucket del provider, che raggiunge gli stessi oggetti.
- **Un percorso è pubblico quando lo è la chiave a cui si riferisce.** Il prefisso `public/` viene verificato sulla chiave canonica servita dalla route — dopo che un segmento iniziale del bucket `default/` è stato rimosso e `//`, `./` e lo `/` iniziale sono stati normalizzati — mai sull'URL così come scritto. `/api/storage/file/notes://public/x.txt` fa riferimento alla chiave privata `notes:/public/x.txt`, e la chiave `default/public/x.txt` (raggiunta come `/api/storage/file/default/default/public/x.txt`) si trova in una cartella chiamata `default`; nessuna delle due è pubblica. In un hook, verifica la `key` che ti viene passata con `isPublicStorageKey` da `@rebasepro/types` — `isPublicStoragePath` legge un percorso o URL lato client, e interpreta entrambi come pubblici.
- **`list` è limitato dal prefisso.** L'elenco (listing) è il modo in cui scopri chiavi di cui nessuno ti ha parlato.
- **I caricamenti ripristinabili (TUS) sono controllati al momento della creazione**, quindi un caricamento negato non lascia dietro di sé alcun file temporaneo.
- Omettere l'hook (e `storagePolicies`) non lascia alcun controllo per singolo oggetto, quindi la produzione rifiuterà di avviarsi a meno che non sia impostato `storagePublicRead` o `storageInsecureAllowAnyAuthenticated`.

## Chiavi API e token

Una persona che ha effettuato l'accesso possiede ogni scope di storage, quindi l'hook e i criteri sopra indicati
decidono per lei. Una [chiave API](/docs/backend/api-keys/) necessita inoltre dello scope
di storage per l'operazione, sulla sorgente indicata dalla richiesta: `storage:read` per
download, metadati ed elenchi, `storage:write` per caricamenti, cartelle e ogni
passaggio di un caricamento ripristinabile, `storage:delete` per le eliminazioni. Il target è
l'id della sorgente, e quello della sorgente predefinita è `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Senza di esso la risposta è `403 SCOPE_MISSING`. Con esso,
l'hook viene comunque eseguito, con l'identità rappresentata dalla chiave.

## Passaggi successivi

- **[Configurazione dello Storage](/docs/backend/storage/)** — backend, endpoint e limiti
- **[Chiavi API](/docs/backend/api-keys/)** — gli scope associati a una chiave
