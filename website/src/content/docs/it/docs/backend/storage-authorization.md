---
sourceHash: 31645b4c27077651
title: Autorizzazione dello storage
sidebar_label: Autorizzazione dello storage
description: Decidi chi può leggere, scrivere, eliminare o elencare ciascun oggetto dello storage con storagePolicies e l'hook storageAuthorize, e quali scope di storage sono necessari per una chiave API.
---

Le tabelle sono protette dalla row-level security; un bucket non ha un
equivalente per singolo oggetto, quindi l'autorizzazione dello storage avviene qui. [Configurazione
dello storage](/docs/backend/storage/) tratta i backend veri e propri.

## Policy

La forma dichiarativa. Un elenco di pattern di percorso, letti senza eseguire alcunché:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una chiave a cui non corrisponde alcuna policy viene rifiutata**, a meno che un hook `storageAuthorize` non la consenta: l'hook viene interpellato solo quando nessuna policy corrisponde alla chiave per quell'operazione, e nessuno dei due può restringere l'altro. Una policy che ha trovato corrispondenza e non ha concesso l'accesso è definitiva. Ogni estensione dei permessi è una riga esplicita, e un errore nega anziché concedere.

I pattern confrontano **per segmento, mai per sottostringa** — `public/**` non corrisponde a
`publicity/secret.png`:

| Pattern | Corrispondenza |
|---|---|
| `avatars/logo.png` | esattamente quella chiave |
| `users/*/avatar.png` | esattamente un segmento al posto di `*` |
| `users/:uid/**` | un segmento acquisito, poi il resto — incluso nulla |

`**` è consentito solo come segmento finale. `:name` acquisisce un segmento e non include
mai uno `/`; le acquisizioni arrivano come `params` sul predicato.

`allow` può essere `"public"` (chiunque sia ammesso dalla route), `"authenticated"` (qualsiasi chiamante
con un uid), oppure un predicato che riceve i parametri acquisiti, l'utente,
l'operazione e il bucket.

Una policy viene eseguita dopo l'autenticazione della route, quindi `"public"` da solo non apre
un percorso a chiamanti anonimi. Con `requireAuth` attivo, possono eseguire solo letture di
chiavi `public/`, oppure qualsiasi lettura con `storagePublicRead`; `/upload`, `/list`, le eliminazioni e
gli upload ripristinabili richiedono sempre un chiamante autenticato. Altrimenti la risposta è `401`.

`operations` ha come valore predefinito tutte e quattro le operazioni — `read`, `write`, `delete`, `list`.

Le policy soddisfano autonomamente il controllo di avvio per la produzione, e un pattern malformato
fa fallire l'avvio anziché il primo caricamento.

### Sotto forma di dati: `STORAGE_POLICIES`

<span class="since-badge" data-since="0.35">Da 0.35</span>

Il runtime gestito non può leggere un predicato dal tuo codice, e un progetto sul
backend predefinito di Rebase Cloud non ha codice da leggere. Pertanto le stesse regole possono essere impostate
come JSON nella variabile di ambiente `STORAGE_POLICIES`, con i due predicati
scritti da quasi ogni app specificati per nome anziché tramite codice:

```bash
STORAGE_POLICIES='[
  { "path": "public/**", "operations": ["read"], "allow": "public" },
  { "path": "users/:uid/**", "allow": "owner" },
  { "path": "**", "allow": { "roles": ["admin"] } }
]'
```

| `allow` | Concede |
|---|---|
| `"public"` | chiunque sia ammesso dalla route |
| `"authenticated"` | qualsiasi chiamante autenticato |
| `"owner"` | il chiamante autenticato il cui uid corrisponde al segmento `:uid` della chiave — il `path` deve acquisirne uno |
| `{ "roles": [...] }` | un chiamante autenticato che possiede uno qualsiasi di questi ruoli |

Vengono compilate in `storagePolicies`, quindi la corrispondenza, l'ordine e il fallback a
`storageAuthorize` corrispondono a quelli del codice: una chiave non coperta da alcuna regola viene demandata
all'hook se il progetto ne ha uno, e rifiutata altrimenti. Un valore che non sia un elenco
valido impedisce l'avvio, segnalando ciascun problema; Rebase Cloud rifiuta di salvarne uno non valido,
e la sua console modifica l'elenco in **File storage → Access rules**.

## L'hook

<span class="since-badge" data-since="0.35">Da 0.35</span>

`requireAuth` e `publicRead` sono selettori *globali*: decidono se un chiamante deve aver effettuato l'accesso, non cosa tale chiamante possa toccare. Senza un hook di autorizzazione, **qualsiasi utente autenticato può leggere qualsiasi chiave di cui conosca il nome** — l'unica cosa che separa i file di due tenant è l'imprevedibilità della chiave, che non rappresenta un modello di controllo degli accessi. Peggio ancora, possono prima eseguire `GET /storage/list?prefix=`, quindi non è nemmeno necessario indovinare le chiavi.

:::caution[Lo storage non si avvierà in produzione senza uno di questi]
Le tabelle sono protette dalla row-level security; lo storage no. Non esiste un
equivalente per singolo oggetto nel bucket, quindi questo hook *è* il modello — e
`initializeRebaseBackend` **genera un'eccezione all'avvio** con `NODE_ENV=production` quando
lo storage è configurato e nessuno dei seguenti elementi è impostato:

- `storageAuthorize` — un hook per singolo oggetto. Consigliato.
- `storagePolicies` — le regole dichiarate descritte sopra.
- `storagePublicRead: true` — il bucket è a tutti gli effetti una CDN pubblica di sola lettura.
- `storageInsecureAllowAnyAuthenticated: true` — un'app single-tenant in cui ci si fida
  di ogni utente autenticato per qualsiasi file. Nominato appositamente per richiedere una seconda lettura.

In fase di sviluppo registra invece un avviso, quindi un progetto può presentare questo errore e
funzionare correttamente in locale fino al momento del deploy. Un progetto creato da scaffold include già un hook in
`backend/storage.ts` — leggilo prima di sostituirlo, e tieni presente che modella
la *libreria di contenuti condivisi* di un CMS, che non ha la stessa struttura dei file per utente.
:::

`storageAuthorize` è l'analogo per lo storage della `rls` di una tabella, ed viene eseguito dopo l'autenticazione su ogni route di storage:

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
| `key` | Chiave dell'oggetto, privata del prefisso del bucket e ripulita da percorsi di traversal |
| `bucket` | Bucket risolto (`"default"` se non specificato) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, oppure `null` dove la route consente l'accesso anonimo |
| `storageId` | Il backend con nome, quando la richiesta ne ha preso di mira uno — la sua chiave canonica (`storageId=%20media` è `"media"`). Assente per la sorgente predefinita, a prescindere da come la richiesta l'abbia nominata (senza parametro, vuota, o `(default)`) |
| `data` | Accesso in sola lettura affidabile che **ignora la RLS** — `data.table(slug).find(query)` / `.findById(id)`. La proprietà risiede in una riga, non nel prefisso di una chiave, quindi l'hook necessita di un lettore per rispondere alla domanda "chi possiede questo oggetto?". Ignora deliberatamente la row-level security: questo hook *è* la decisione di autorizzazione, e prenderla tramite un lettore già ristretto dai permessi del chiamante stesso sarebbe circolare. Progettato come sola lettura. |

Restituisci `false` per negare con un **403**. Anche generare un'eccezione nega l'accesso — una ricerca di proprietà che fallisce non concede l'accesso per errore.

Informazioni utili:

- **La route dei metadati è il punto in cui viene realmente decisa la lettura.** Genera il token di download a breve durata con ambito limitato al percorso che la route dei file ritiene affidabile, quindi l'hook ne regola l'accesso lì. Due tipi di lettura ignorano l'hook, per impostazione predefinita. Una lettura che presenta un tale token: l'hook l'ha approvata al momento della generazione del token, limitatamente a quel percorso e a quella sorgente, quindi un hook che ora negherebbe l'accesso (un'adesione revocata nel frattempo) non la blocca prima della scadenza del token — `storageDownloadTokenTtl`, 300 secondi per impostazione predefinita. E una lettura di una chiave sotto `public/` da parte di un chiamante privo di credenziali: il prefisso è la dichiarazione che chiunque può leggerla, inclusi visitatori anonimi e CDN. La lettura da parte di un chiamante autenticato viene comunque verificata, ma quella di uno anonimo no, quindi un hook non può rendere privata una chiave in `public/`; archivia invece il file all'esterno di `public/`. Solo queste due letture lo ignorano: un utente che il tuo adapter di autenticazione chiama casualmente `public` viene verificato come chiunque altro.
- **Un bucket, un nome.** Su S3 e GCS il `bucket` dell'hook è sempre `"default"`, anche quando una richiesta menziona il bucket del provider, che raggiunge gli stessi oggetti.
- **Un percorso è pubblico se lo è la chiave che denomina.** Il prefisso `public/` viene verificato sulla chiave canonica servita dalla route — dopo che il segmento del bucket iniziale `default/` è stato eliminato e `//`, `./` e lo `/` iniziale sono stati rimossi — mai sull'URL così come scritto. `/api/storage/file/notes://public/x.txt` denomina la chiave privata `notes:/public/x.txt`, e la chiave `default/public/x.txt` (raggiunta come `/api/storage/file/default/default/public/x.txt`) si trova in una cartella chiamata `default`; nessuna delle due è pubblica. In un hook, verifica la `key` passata usando `isPublicStorageKey` da `@rebasepro/types` — `isPublicStoragePath` legge un percorso o URL lato client, e interpreta entrambi come pubblici.
- **`list` è limitato in base al prefisso.** L'elenco è il modo in cui si scoprono chiavi non note in precedenza.
- **I caricamenti ripristinabili (TUS) sono controllati al momento della creazione**, quindi un caricamento negato non lascia file temporanei.
- Omettere l'hook (e `storagePolicies`, e `STORAGE_POLICIES`) lascia lo storage senza controlli per singolo oggetto, per cui la produzione si rifiuterà di avviarsi a meno che non sia impostato `storagePublicRead` o `storageInsecureAllowAnyAuthenticated`.

## Chiavi API e token

Un utente che ha effettuato l'accesso possiede qualsiasi scope di storage, quindi l'hook e le policy di cui sopra
decidono per lui. Una [chiave API](/docs/backend/api-keys/) necessita inoltre dello
scope di storage per l'operazione, sulla sorgente identificata dalla richiesta: `storage:read` per
download, metadati ed elenchi, `storage:write` per upload, cartelle e qualsiasi
fase di un caricamento ripristinabile, `storage:delete` per le eliminazioni. La destinazione è
l'id della sorgente, e quello della sorgente predefinita è `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Senza di esso la risposta è `403 SCOPE_MISSING`. Con lo scope presente,
l'hook viene comunque eseguito, agendo con l'identità associata alla chiave.

## Passaggi successivi

- **[Configurazione dello storage](/docs/backend/storage/)** — backend, endpoint e limiti
- **[Chiavi API](/docs/backend/api-keys/)** — gli scope di cui dispone una chiave
