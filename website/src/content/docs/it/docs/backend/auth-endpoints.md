---
sourceHash: abb4fea850cf0823
title: Endpoint e token di autenticazione
sidebar_label: Endpoint di autenticazione
description: Le route di autenticazione montate dal backend Rebase, la struttura delle loro risposte, l'autenticazione a più fattori, il contesto del database visibile a una policy, JWKS e chiavi di servizio.
---

Le route montate [dal blocco `auth`](/docs/backend/authentication/) e i token che restituiscono.

## Endpoint di autenticazione

Tutti gli endpoint di autenticazione sono montati su `/api/auth/`:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crea un nuovo account |
| `POST` | `/api/auth/login` | Accedi con email/password |
| `POST` | `/api/auth/refresh` | Rinnova l'access token |
| `POST` | `/api/auth/<provider>` | Accesso OAuth (ad es. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Collega un provider OAuth all'account autenticato. Su un guest questa è una registrazione: richiede `allowRegistration`, prende l'indirizzo del provider quando il provider lo garantisce, e risponde con una sessione per l'account che il guest è diventato |
| `POST` | `/api/auth/logout` | Revoca il refresh token |
| `POST` | `/api/auth/forgot-password` | Invia l'email per reimpostare la password |
| `POST` | `/api/auth/reset-password` | Reimposta la password con un token |
| `POST` | `/api/auth/find-user` | Risolve un'email in un profilo pubblico minimo (opzionale — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifica la password del chiamante (autenticato). Termina ogni altra sessione e risponde con una nuova per il chiamante |
| `GET` | `/api/auth/me` | Il profilo del chiamante |
| `PATCH` | `/api/auth/me` | Aggiorna il profilo del chiamante |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: sposta l'account del chiamante su un altro indirizzo. Invia via email un link al nuovo indirizzo e un avviso a quello vecchio; nulla cambia finché il link non viene seguito. Richiede `aal2` su un account con un secondo fattore. `409 EMAIL_EXISTS` oppure `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` per un guest — vedi [Cambiare un indirizzo email](#cambiare-un-indirizzo-email) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` dal link. Non richiede alcuna sessione. Sposta l'account sul nuovo indirizzo, verificato; `400 INVALID_TOKEN` per un link consumato, sostituito o scaduto, `409 EMAIL_EXISTS` quando l'indirizzo è stato preso mentre era in attesa |
| `GET` | `/api/auth/config` | Ciò che questo backend offre a una schermata di accesso — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`. Non autenticato e calcolato a partire dagli stessi predicati applicati dalle route, garantendo che ciò che la schermata mostra corrisponda esattamente a ciò che può fare |
| `POST` | `/api/auth/send-verification` | Invia al chiamante un link di verifica dell'email |
| `GET` | `/api/auth/verify-email` | Consuma un link di verifica (l'URL contenuto nell'email). Mantiene ciò che una sessione attiva dell'account dimostra e rimuove ciò che nessuno ha dimostrato — vedi [Verifica email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo stesso con `{ token, password?, removeUnproven? }`: la password lo mantiene e accede; senza nessuna delle due prove un account che ne possiede una risponde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Invia via email un link di accesso monouso. `503 EMAIL_NOT_CONFIGURED` se SMTP non è configurato |
| `POST` | `/api/auth/magic-link/verify` | Scambia un token magic-link con una sessione |
| `POST` | `/api/auth/otp` | Invia via email un codice di accesso a sei cifre. Risponde allo stesso modo indipendentemente dal fatto che l'indirizzo sia associato a un account o meno |
| `POST` | `/api/auth/otp/verify` | Scambia `{ email, code }` con una sessione |
| `POST` | `/api/auth/anonymous` | Crea una sessione anonima (opzionale — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associa credenziali reali all'account anonimo già autenticato |
| `GET` | `/api/auth/sessions` | Elenca le sessioni attive del chiamante, una per accesso. Quella del chiamante stesso è contrassegnata `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revoca tutte le sessioni, inclusa quella corrente — disconnessione remota su tutti i dispositivi |
| `DELETE` | `/api/auth/sessions/:id` | Revoca una sessione: il suo refresh token, e l'access token posseduto da quel dispositivo |
| `GET` | `/api/auth/scopes` | Ogni [scope](/docs/backend/roles-and-scopes/) noto a questo backend, e quelli che possiede il chiamante |
| `GET` | `/api/auth/keys` | Le [chiavi API personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | Crea una chiave personale. `403 PERSONAL_KEYS_DISABLED` a meno che la collezione users non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revoca una delle chiavi del chiamante |
| `GET` | `/.well-known/jwks.json` | Il JWKS pubblico — montato alla radice, non sotto `basePath`, perché è lì che cerca un verificatore. Presente quando la [firma asimmetrica](#asymmetric-tokens-and-jwks) è configurata |
| `POST` | `/api/auth/mfa/enroll` | Avvia la registrazione TOTP (restituisce il segreto e i codici di recupero) |
| `POST` | `/api/auth/mfa/verify` | Conferma la registrazione con un codice proveniente dall'app di autenticazione |
| `GET` | `/api/auth/mfa/factors` | Elenca i fattori registrati dal chiamante |
| `POST` | `/api/auth/mfa/challenge` | Avvia una verifica (challenge) su un fattore verificato |
| `POST` | `/api/auth/mfa/challenge/verify` | Risponde a una challenge — questo passaggio emette la sessione |
| `DELETE` | `/api/auth/mfa/unenroll` | Rimuove un fattore (richiede una sessione `aal2`) |
| `POST` | `/api/auth/mfa/recovery-codes` | Sostituisce i codici di recupero del chiamante con dieci nuovi (richiede una sessione `aal2`) |

La gestione amministrativa di utenti e ruoli è una **superficie separata**, montata su
`/api/admin/` anziché `/api/auth/`. La lettura richiede lo scope `users:read` e
la modifica richiede `users:write`. Un admin e la chiave di servizio (service key) li possiedono entrambi; li possiede
anche un ruolo che li dichiara. Nessuno può modificare un account che possiede più di quanto possieda
lui. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Elenca gli utenti (con paginazione) |
| `POST` | `/api/admin/users` | Crea un utente |
| `GET` | `/api/admin/users/:uid` | Legge un singolo utente |
| `PUT` | `/api/admin/users/:uid` | Aggiorna un singolo utente. `{ disabled: true }` disattiva l'account senza eliminarlo: ogni accesso e refresh viene rifiutato (`ACCOUNT_DISABLED`), le sue sessioni terminano e ogni token che possiede viene rifiutato; `false` lo riattiva |
| `DELETE` | `/api/admin/users/:uid` | Elimina un singolo utente. Le sue sessioni terminano, e ogni access token che possiede viene rifiutato da quella richiesta in avanti |
| `POST` | `/api/admin/users/:uid/reset-password` | Reimposta la password di un utente senza richiedere quella attuale. `rebase auth reset-password` la richiama, e scrive direttamente nel database solo quando il backend non è raggiungibile; in entrambi i casi le sessioni dell'account terminano |
| `DELETE` | `/api/admin/users/:uid/mfa` | Rimuove i secondi fattori e i codici di recupero di un utente, e termina le sue sessioni — per chi ha perso entrambi |
| `GET` | `/api/admin/roles` | `admin` e i ruoli dichiarati dalla collezione users, con i loro scope |
| `POST` | `/api/admin/bootstrap` | Consente al primo utente registrato di rivendicare il ruolo di amministratore quando non ne esiste alcuno. Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |

Tutti gli endpoint delle API dati richiedono un header `Authorization: Bearer <token>` valido quando `requireAuth: true` (impostazione predefinita).

### Formato della risposta

Ogni endpoint che emette una sessione risponde con la stessa struttura (envelope) — `register`,
`login`, ciascun provider OAuth, `magic-link/verify`, `otp/verify`, `anonymous`,
`anonymous/link` e `mfa/challenge/verify`:

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Invia l'access token nell'header `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` è espresso in millisecondi epoch.

`POST /api/auth/refresh` risponde con la stessa struttura, con l'eccezione che `user`
viene omesso completamente quando l'account non può essere riletto, quindi è da
considerarsi opzionale in questo caso.

`providerId` indica come è stato effettuato l'accesso della sessione: `password`,
`anonymous`, `magic-link`, `otp`, `mfa` (un accesso completato con un secondo
fattore), oppure l'id del provider, ad esempio `google`. Viene memorizzato insieme
alla sessione al momento dell'accesso, quindi `refresh` e `GET /api/auth/me`
restituiscono la stessa risposta per tutta la durata della sessione. Una sessione
il cui accesso è avvenuto prima della 0.24 legge `password`.

:::caution[L'SDK tipizzato appiattisce questo envelope — le richieste HTTP dirette no]
Il JSON sopra riportato rappresenta il formato di trasmissione (wire format) ed è ciò che
restituisce `fetch("/api/auth/login")`: il token si trova in **`body.tokens.accessToken`**.

L'[SDK tipizzato](/docs/sdk/authentication) estrae `tokens` prima di restituire la
sessione, per cui `auth.signInWithEmail()` si risolve invece in una struttura appiattita
**`{ user, accessToken, refreshToken }`**.

Entrambe le strutture sono corrette; appartengono a due livelli diversi. Tentare di leggere
la struttura dell'SDK da una `fetch` diretta restituisce `undefined`, il che si manifesta
come "accesso riuscito ma non c'è alcun access token" — l'accesso è andato a buon fine, il
token si trovava semplicemente un livello più sotto.
:::

### Cambiare un indirizzo email

<span class="since-badge" data-since="0.24">Da 0.24</span> Un utente autenticato
sposta il proprio account su un altro indirizzo in due passaggi:

1. `POST /api/auth/change-email { newEmail }` registra la modifica e invia via
   email un link, `<frontend>/confirm-email-change?token=…`, al nuovo indirizzo,
   e un avviso senza link a quello attuale. Il link vive 24 ore, e una nuova
   richiesta sostituisce l'ultima. `GET /api/auth/me` segnala l'indirizzo in
   attesa come `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` sposta l'account: il nuovo
   indirizzo diventa il suo indirizzo, verificato. Ogni identità OAuth il cui
   provider garantiva per il vecchio indirizzo viene scollegata
   (`removedProviders` le elenca), perché altrimenti chiunque controlli il
   vecchio indirizzo potrebbe ancora accedere tramite esso, e qualsiasi link di
   reset inviato al vecchio indirizzo smette di funzionare. Le sessioni vengono
   mantenute.

Il nuovo indirizzo non viene riservato mentre il link è in attesa: tenerlo
riservato permetterebbe a qualsiasi account di impedire a un estraneo di
registrarsi con il proprio indirizzo. Se un altro account ha già quell'indirizzo
nel momento in cui il link viene seguito, il link risponde `409 EMAIL_EXISTS` e
nulla viene spostato; tra due account che richiedono lo stesso indirizzo, lo
ottiene il primo che segue il proprio link. L'hook `beforeEmailChange` può
rifiutare un indirizzo, come fa `beforeUserCreate` alla registrazione.

Nel CMS, l'indirizzo si cambia da **Account settings → Profile**, e il link apre
la schermata del CMS stesso, autenticato o no. Un altro frontend serve una
pagina su `/confirm-email-change` che richiama la route con il token del link.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) abilitato, il refresh
token viene trasmesso come cookie `httpOnly` e `tokens.refreshToken` è una stringa vuota
nel body. L'access token non subisce variazioni.

### Autenticazione a più fattori (TOTP)

**Un secondo fattore vincola l'accesso, non solo singole operazioni.** Una volta che un
account ha un fattore TOTP *verificato*, nessuna route emette una sessione finché non
viene fornito un codice — l'accesso tramite password, ogni provider OAuth, magic link e
anonymous-link rifiutano tutti con `401 MFA_REQUIRED`:

```json
{
  "error": {
    "code": "MFA_REQUIRED",
    "message": "Multi-factor authentication is required to complete sign-in.",
    "details": {
      "mfaToken": "<short-lived pre-auth token>",
      "factors": [{ "id": "…", "factorType": "totp", "friendlyName": "Phone" }]
    }
  }
}
```

`mfaToken` **non è una sessione**: ha uno scopo specifico, scade dopo cinque minuti
e viene rifiutato da qualsiasi route autenticata. Invialo come bearer token a
`POST /api/auth/mfa/challenge` (con un `factorId`) e successivamente a
`POST /api/auth/mfa/challenge/verify` (con il `challengeId` e il codice a sei cifre,
o un codice di recupero). Quest'ultima chiamata è quella che genera i token di accesso
e di aggiornamento, con livello `aal2`; il livello viene memorizzato nella sessione e
mantenuto durante le chiamate a `POST /api/auth/refresh`.

Anche la registrazione dei fattori è protetta. Il primo fattore di un account può essere
registrato da una sessione ordinaria, ma una volta verificato, `enroll`, `verify` e `unenroll`
richiedono tutti una sessione `aal2` — altrimenti una password rubata permetterebbe di registrare
un fattore secondario proprio, effettuare l'escalation e cancellare quello legittimo.

La verifica è limitata su entrambi i fronti: una challenge scade dopo cinque tentativi
errati, ogni account è limitato a dieci tentativi di verifica ogni 15 minuti (conteggiati per
utente, quindi cambiare IP non serve a nulla) e un codice accettato viene registrato per il
fattore in modo che non possa essere riutilizzato (replay attack) per il resto della sua
finestra di tolleranza di ±1 step.

<span class="since-badge" data-since="0.24">Da 0.24</span> Nel CMS, **Account
settings → Two-step verification** registra un'app di autenticazione (la sua
chiave, e un link che la apre nell'app, poi il codice che mostra), elenca i
fattori dell'account, ne rimuove uno e sostituisce i codici di recupero.
Quando una modifica richiede `aal2`, chiede prima un codice ed esegue lo
step-up della sessione con esso. I codici di recupero vengono mostrati una
sola volta, dopo che il primo fattore è stato confermato. Nella tabella degli
utenti, **Reset two-step verification** (`DELETE /api/admin/users/:uid/mfa`) e
**Disable or enable account** (`PUT /api/admin/users/:uid { disabled }`) sono
offerti a chiunque possieda `users:write`, così come lo sono le route;
l'interruttore non viene mai offerto sul proprio account, e un account che
supera il tuo viene rifiutato con il motivo fornito dal server.

Imposta `MFA_ENCRYPTION_KEY` (almeno 32 caratteri casuali) per crittografare i segreti TOTP
memorizzati. Senza di esso, il server ripiega su `JWT_SECRET` emettendo un avviso. Impostalo
**prima** che qualsiasi utente si registri: i segreti salvati non includono un identificativo
di chiave, quindi modificare la chiave in un secondo momento renderà indecifrabili i fattori
esistenti e i rispettivi proprietari non potranno completare la verifica.

### Invitare i membri del team via email

I flussi di invito richiedono la conversione di un indirizzo email in un user id, ma la collection
`users` è protetta da RLS per le richieste client. Invece di creare manualmente una funzione
server di amministrazione, puoi abilitare la funzione di ricerca integrata:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Poi, dal client:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

L'endpoint è **riservato ai soli utenti autenticati** e restituisce esclusivamente `uid`, `displayName`
e `photoURL` — mai l'email, i ruoli o i metadati dell'utente cercato. È **disabilitato per
impostazione predefinita** poiché consente a qualsiasi utente autenticato di verificare quali
indirizzi email possiedono un account; abilitalo solo se richiesto dalla UX dei tuoi inviti.

## Contesto del database per Row-Level Security (RLS)

Rebase collega direttamente l'autenticazione delle richieste alla Row-Level Security (RLS) di PostgreSQL. Ogni query di database eseguita tramite un driver con ambito utente (user-scoped) viene eseguita all'interno di una transazione di database (`db.transaction()`) che imposta parametri di configurazione locali alla transazione:

*   `app.user_id` — L'ID univoco dell'utente autenticato (`uid`). Il valore predefinito è `'anon'` per le richieste non autenticate.
*   `app.user_roles` — Una stringa separata da virgole che elenca i ruoli assegnati all'utente.
*   `app.jwt` — Una stringa JSON contenente l'intero payload dei claim JWT (`{"sub": "<uid>", "roles": [...]}`).

Questi parametri vengono configurati localmente per la durata della transazione utilizzando la funzione `set_config` di Postgres:
```sql
SELECT 
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Funzioni helper per le policy PostgreSQL

Per semplificare la scrittura delle policy di Row-Level Security, Rebase crea delle funzioni helper nello schema `auth` durante il bootstrap del database:

*   **`rebase.uid()`** — Restituisce l'ID dell'utente autenticato come `text`, oppure `NULL` se non impostato:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Restituisce la stringa dei ruoli separati da virgole:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Restituisce l'intero payload JWT come oggetto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

Puoi utilizzare queste funzioni helper direttamente nelle tue regole di sicurezza personalizzate o nelle migrazioni del database:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Token asimmetrici e JWKS

Per impostazione predefinita, gli access token sono firmati con `jwtSecret` (HS256). Questo approccio
funziona, ma comporta che qualsiasi entità debba *verificare* un token debba possedere la chiave che lo
*emette* — quindi un gateway o un edge worker che controlla una sessione può anche contraffarla — e
la modifica del segreto disconnette tutti gli utenti contemporaneamente.

Configurando una chiave di firma, Rebase firmerà invece gli access token in modo asimmetrico,
pubblicando la chiave pubblica su **`/.well-known/jwks.json`** affinché chiunque possa verificarli:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Oppure dalle variabili d'ambiente, per una singola chiave:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Genera una chiave con:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Anche le chiavi RSA sono supportate e firmano con `RS256`; le chiavi EC P-256 firmano con `ES256`. Viene
configurata solo la chiave privata — la parte pubblica viene derivata da essa, impedendo disallineamenti
tra la coppia. `jwtSecret` rimane comunque obbligatorio: serve ancora a firmare i token con scopo specifico
(link di download, MFA in sospeso, reimpostazione della password) che solo questo server legge.

### Rotazione di una chiave

Inserisci la nuova chiave per prima e mantieni elencata quella vecchia. I nuovi token verranno firmati
dalla nuova chiave; i token già in circolazione continueranno a essere verificati con quella precedente
fino alla loro scadenza, evitando la disconnessione degli utenti.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una volta trascorso il tempo di vita dell'access token più longevo, rimuovi la voce precedente. Usa
`activeKid` se desideri pubblicare una chiave prima di iniziare a usarla per firmare.

### Verifica altrove

I token contengono il `kid` della chiave di firma nel loro header: è così che un verificatore
seleziona la chiave corretta dal JWKS e sa quando riscaricarlo dopo una rotazione. Qualsiasi
libreria standard esegue questa operazione automaticamente — ad esempio con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Senza `signingKeys` configurate, `/.well-known/jwks.json` risponde con `{"keys":[]}` e i
token rimangono HS256. Nulla cambia finché non aggiungi una chiave.
:::

## Autenticazione con Service Key

Per la comunicazione server-to-server (ad es. cron job, servizi esterni), configura una chiave di servizio (service key) statica:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

I client si autenticano con l'header `Authorization: Bearer <service-key>`. 

### Chiave interna per ogni avvio

Se `REBASE_SERVICE_KEY` non viene fornita nella configurazione, Rebase genera automaticamente una **chiave interna per ogni avvio** casuale. 

Questa chiave non viene mai registrata nei log e non lascia mai il processo. Viene utilizzata dal singleton `rebase` per autenticarsi rispetto alle API di control-plane del server stesso (auth, storage, ecc.). Ciò garantisce che i task amministrativi (come l'invio di un'email di benvenuto o la generazione di un URL di archiviazione) funzionino sempre fin da subito, sia in fase di sviluppo che in produzione, senza richiedere la gestione manuale delle chiavi.

### Protezione da timing attack e requisiti delle chiavi

Per prevenire timing attack (attacchi basati sui tempi di esecuzione), Rebase convalida sia la chiave di servizio configurata dall'utente sia la chiave interna utilizzando un confronto tra stringhe a tempo costante (`safeCompare`). La chiave di servizio configurata dall'utente **deve essere lunga almeno 32 caratteri**; se viene configurata una chiave più corta di 32 caratteri, Rebase genererà un errore di configurazione all'avvio e adotterà un comportamento fail-closed (blocco di sicurezza).

## Passaggi successivi

- **[Autenticazione](/docs/backend/authentication/)** — la configurazione da cui derivano queste route
- **[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters/)** — come sostituire il provider sottostante
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — cosa fa una policy con `rebase.uid()`
- **[Autenticazione con l'SDK tipizzato](/docs/sdk/authentication/)** — come chiamare queste route dall'SDK
