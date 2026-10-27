---
sourceHash: b5b66e5876dc7d9c
title: Autorizzazione dello storage
sidebar_label: Autorizzazione dello storage
description: Decidi chi può leggere, scrivere, eliminare o elencare ogni oggetto di storage con storagePolicies e l'hook storageAuthorize, e di quali scope di storage ha bisogno una chiave API.
---

Le collection sono protette dalla sicurezza a livello di riga; un bucket non ha un
equivalente per singolo oggetto, quindi lo storage si autorizza qui. La
[configurazione dello storage](/docs/backend/storage/) tratta i backend veri e propri.

## Policy

La forma dichiarativa. Un elenco di pattern di percorso, letto senza eseguire nulla:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una chiave che nessuna policy riconosce viene rifiutata**, a meno che un hook `storageAuthorize` non la consenta: l'hook viene interpellato solo quando nessuna policy ha trovato corrispondenza, e nessuno dei due può restringere l'altro. Ogni ampliamento è una riga esplicita, e un errore nega anziché concedere.

I pattern corrispondono **per segmento, mai per sottostringa** — `public/**` non corrisponde a
`publicity/secret.png`:

| Pattern | Corrisponde a |
|---|---|
| `avatars/logo.png` | esattamente quella chiave |
| `users/*/avatar.png` | esattamente un segmento dove si trova `*` |
| `users/:uid/**` | un segmento catturato, poi il resto — anche nulla |

`**` è ammesso solo come ultimo segmento. `:name` cattura un segmento e non
attraversa mai un `/`; le catture arrivano come `params` al predicato.

`allow` è `"public"` (chiunque), `"authenticated"` (qualsiasi chiamante con un uid) oppure un
predicato che riceve i parametri catturati, l'utente, l'operazione e il bucket.
`operations` per impostazione predefinita le comprende tutte e quattro — `read`, `write`, `delete`, `list`.

Le policy soddisfano da sole la protezione all'avvio in produzione, e un pattern malformato
fa fallire l'avvio anziché il primo upload.

## L'hook

`requireAuth` e `publicRead` sono interruttori *globali*: decidono se un chiamante deve essere autenticato, non cosa quel chiamante possa toccare. Senza un hook di autorizzazione, **qualsiasi utente autenticato può leggere qualsiasi chiave che sappia nominare** — l'unica cosa che separa i file di due tenant è l'impossibilità di indovinare la chiave, che non è un modello di controllo degli accessi. Peggio ancora, può prima eseguire `GET /storage/list?prefix=`, quindi le chiavi non devono nemmeno essere indovinate.

:::caution[In produzione lo storage non si avvia senza un'autorizzazione]
Le collection sono protette dalla sicurezza a livello di riga; lo storage no. Nel bucket non esiste
un equivalente per singolo oggetto, quindi questo hook *è* il modello — e
`initializeRebaseBackend` **genera un errore all'avvio** con `NODE_ENV=production` quando
lo storage è configurato e nessuna di queste impostazioni è presente:

- `storageAuthorize` — un hook, per singolo oggetto. Consigliato.
- `storagePublicRead: true` — il bucket è davvero una CDN pubblica in sola lettura.
- `storageInsecureAllowAnyAuthenticated: true` — un'app single-tenant in cui ogni
  utente autenticato è considerato attendibile per ogni file. Il nome è scelto perché lo si legga due volte.

In sviluppo registra invece un avviso, quindi un progetto può sbagliare su questo punto e
funzionare benissimo in locale fino al momento del deploy. Un progetto generato con lo scaffold include già un hook in
`config/storage.ts` — leggilo prima di sostituirlo, e tieni presente che modella
la *libreria di contenuti condivisa* di un CMS, che non ha la stessa forma dei file per singolo utente.
:::

`storageAuthorize` è l'analogo per lo storage delle regole di sicurezza di una collection, e viene eseguito dopo l'autenticazione su ogni route dello storage:

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
| `key` | Chiave dell'oggetto, privata del prefisso del bucket e ripulita da ogni tentativo di attraversamento dei percorsi |
| `bucket` | Bucket risolto (`"default"` se non specificato) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, oppure `null` dove la route consente l'accesso anonimo |
| `storageId` | Il backend con nome, quando la richiesta ne ha indicato uno — la sua chiave canonica (`storageId=%20media` è `"media"`). Assente per la sorgente predefinita, comunque la richiesta l'abbia indicata (nessun parametro, vuoto, o `(default)`) |
| `data` | Accesso in lettura attendibile che **aggira l'RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La proprietà risiede in una riga, non in un prefisso della chiave, quindi l'hook ha bisogno di un lettore per rispondere a "chi possiede questo oggetto?". Aggira deliberatamente la sicurezza a livello di riga: questo hook *è* la decisione di autorizzazione, e prenderla attraverso un lettore già ristretto dai permessi del chiamante sarebbe circolare. Di sola lettura per progettazione. |

Restituisci `false` per negare con un **403**. Anche un'eccezione nega — una ricerca di proprietà che fallisce non lascia passare.

Da sapere:

- **La route dei metadati è dove si decide davvero l'accesso in lettura.** Emette il token di download di breve durata, limitato al percorso, di cui si fida la route del file, quindi l'hook la controlla lì. Due letture saltano l'hook, di proposito. Una che porta un tale token: l'hook l'ha approvata quando il token è stato emesso, solo per quel percorso e quella sorgente, quindi un hook che ora la rifiuterebbe (un'appartenenza revocata da allora) non la ferma prima che il token scada — `storageDownloadTokenTtl`, 300 secondi per impostazione predefinita. E la lettura di una chiave sotto `public/` da parte di un chiamante senza credenziali: il prefisso è la dichiarazione che chiunque può leggerla, visitatori anonimi e CDN inclusi. La lettura da parte di un chiamante autenticato viene comunque sottoposta all'hook, ma quella anonima no, quindi un hook non può rendere privata una chiave `public/`; salva invece il file fuori da `public/`. Solo quelle due letture lo saltano: un utente che il tuo auth adapter chiama `public` viene sottoposto all'hook come chiunque altro.
- **Un bucket, un nome.** Su S3 e GCS il `bucket` dell'hook è sempre `"default"`, anche quando una richiesta indica il bucket del provider, che raggiunge gli stessi oggetti.
- **Un percorso è pubblico quando lo è la chiave che indica.** Il prefisso `public/` viene verificato sulla chiave canonica servita dalla route — dopo che un segmento `default/` iniziale del bucket è stato letto e che `//`, `./` e un `/` iniziale sono stati normalizzati — mai sull'URL così com'è scritto. `/api/storage/file/notes://public/x.txt` indica la chiave privata `notes:/public/x.txt`, e la chiave `default/public/x.txt` (raggiunta come `/api/storage/file/default/default/public/x.txt`) si trova in una cartella chiamata `default`; nessuna delle due è pubblica. In un hook, verifica la `key` che ti viene passata con `isPublicStorageKey` da `@rebasepro/types` — `isPublicStoragePath` legge un percorso o un URL lato client, e considera pubblici entrambi quei casi.
- **`list` è controllato sul prefisso.** Elencare è il modo per scoprire chiavi di cui nessuno ti ha parlato.
- **Gli upload ripristinabili (TUS) sono controllati al momento della creazione**, così un upload negato non lascia alcun file temporaneo.
- Omettere l'hook (e `storagePolicies`) non lascia alcun controllo per singolo oggetto, quindi la produzione rifiuta di avviarsi a meno che non sia impostato `storagePublicRead` o `storageInsecureAllowAnyAuthenticated`.

## Chiavi API e token

Una persona autenticata possiede ogni scope di storage, quindi decidono per lei l'hook e le policy
descritti sopra. Una [chiave API](/docs/backend/api-keys/) ha bisogno anche dello scope di
storage per l'operazione, sulla sorgente che la richiesta indica: `storage:read` per
download, metadati ed elenchi, `storage:write` per upload, cartelle e ogni
passaggio di un upload ripristinabile, `storage:delete` per le eliminazioni. Il target è
l'id della sorgente, e quello della sorgente predefinita è `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Senza di esso la risposta è `403 SCOPE_MISSING`. Con esso,
l'hook viene comunque eseguito, come chi agisce dietro la chiave.

## Passaggi successivi

- **[Configurazione dello storage](/docs/backend/storage/)** — backend, endpoint e limiti
- **[Chiavi API](/docs/backend/api-keys/)** — gli scope che una chiave possiede
