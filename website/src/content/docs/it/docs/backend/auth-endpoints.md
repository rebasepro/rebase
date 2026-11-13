---
sourceHash: 51c0059da14c6fd7
title: Endpoint di autenticazione e token
sidebar_label: Endpoint auth
description: Le route di autenticazione montate dal backend Rebase, la struttura delle loro risposte, l'autenticazione a più fattori, il contesto del database visibile a una policy, JWKS e chiavi di servizio.
---

Le route montate [dal blocco `auth`](/docs/backend/authentication/) e i token che restituiscono.

## Endpoint di autenticazione

Tutti gli endpoint di autenticazione sono montati su `/api/auth/`:

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Crea un nuovo account |
| `POST` | `/api/auth/login` | Accedi con email/password |
| `POST` | `/api/auth/refresh` | Aggiorna l'access token |
| `POST` | `/api/auth/<provider>` | Accesso OAuth (es. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Collega un provider OAuth all'account autenticato. Per un guest si tratta di una registrazione: richiede `allowRegistration`, accetta l'indirizzo del provider quando quest'ultimo ne garantisce la validità e risponde con una sessione per l'account in cui il guest si è trasformato |
| `POST` | `/api/auth/logout` | Revoca il refresh token |
| `POST` | `/api/auth/forgot-password` | Invia un'email di reimpostazione della password |
| `POST` | `/api/auth/reset-password` | Reimposta la password con il token |
| `POST` | `/api/auth/find-user` | Risolve un'email in un profilo pubblico minimale (opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifica la password del chiamante stesso (autenticato). Termina ogni altra sessione e risponde con una nuova sessione per il chiamante |
| `GET` | `/api/auth/me` | Il profilo del chiamante stesso |
| `PATCH` | `/api/auth/me` | Aggiorna il profilo del chiamante stesso |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: sposta l'account del chiamante stesso su un altro indirizzo. Invia un link al nuovo indirizzo e un avviso a quello precedente; non cambia nulla finché non si segue il link. Richiede `aal2` per un account con un secondo fattore. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` per un guest — vedi [Modifica di un indirizzo email](#modifica-di-un-indirizzo-email) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` dal link. Nessuna sessione richiesta. Sposta l'account sul nuovo indirizzo, verificato; `400 INVALID_TOKEN` per un link già utilizzato, sostituito o scaduto, `409 EMAIL_EXISTS` quando l'indirizzo è già stato occupato durante l'attesa |
| `GET` | `/api/auth/config` | Ciò che questo backend offre a una schermata di accesso — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, che indica se il backend gestisce l'archiviazione dei file. Non autenticato e calcolato a partire dagli stessi predicati applicati dalle route, garantendo che quanto mostrato dalla schermata sia sempre allineato a ciò che può effettivamente eseguire |
| `POST` | `/api/auth/send-verification` | Invia al chiamante un link di verifica dell'email |
| `GET` | `/api/auth/verify-email` | Consuma un link di verifica (l'URL in quell'email). Mantiene ciò che una sessione attiva dell'account attesta e rimuove ciò che non è stato attestato — vedi [Verifica dell'email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo stesso con `{ token, password?, removeUnproven? }`: la password lo mantiene ed effettua l'accesso; senza alcuna prova, un account che ne possiede una risponde con `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Invia tramite email un link monouso per l'accesso. `503 EMAIL_NOT_CONFIGURED` senza SMTP |
| `POST` | `/api/auth/magic-link/verify` | Scambia un token magic-link con una sessione |
| `POST` | `/api/auth/otp` | Invia tramite email un codice di accesso a sei cifre. Risponde allo stesso modo indipendentemente dal fatto che l'indirizzo sia associato o meno a un account |
| `POST` | `/api/auth/otp/verify` | Scambia `{ email, code }` con una sessione |
| `POST` | `/api/auth/anonymous` | Crea una sessione anonima (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associa credenziali reali all'account anonimo già autenticato. Richiede sia `allowAnonymous` sia la registrazione aperta: `403 ANONYMOUS_AUTH_DISABLED` una volta disattivato l'accesso anonimo (inclusi i guest già autenticati) e `403 REGISTRATION_DISABLED` mentre le registrazioni sono chiuse |
| `GET` | `/api/auth/sessions` | Elenca le sessioni attive del chiamante, una per ciascun accesso. Quella corrente del chiamante è contrassegnata come `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revoca tutte le sessioni, inclusa questa — disconnessione remota su tutti i dispositivi |
| `DELETE` | `/api/auth/sessions/:id` | Revoca una singola sessione: il suo refresh token e l'access token posseduto da quel dispositivo |
| `GET` | `/api/auth/scopes` | Tutti gli [scope](/docs/backend/roles-and-scopes/) noti a questo backend e quelli posseduti dal chiamante |
| `GET` | `/api/auth/keys` | Le [chiavi API personali](/docs/backend/api-keys/#personal-keys) del chiamante stesso |
| `POST` | `/api/auth/keys` | Crea una chiave personale. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella users non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revoca una delle chiavi del chiamante stesso |
| `GET` | `/.well-known/jwks.json` | Il JWKS pubblico — montato alla radice, non sotto `basePath`, perché è lì che un verificatore cerca. Montato ogni volta che il backend genera i propri token; un set di chiavi vuoto finché non viene configurata la [firma asimmetrica](#token-asimmetrici-e-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Avvia la registrazione TOTP (restituisce il secret e i codici di recupero) |
| `POST` | `/api/auth/mfa/verify` | Conferma una registrazione con un codice dall'app di autenticazione |
| `GET` | `/api/auth/mfa/factors` | Elenca i fattori registrati dal chiamante |
| `POST` | `/api/auth/mfa/challenge` | Apre una verifica (challenge) per un fattore verificato |
| `POST` | `/api/auth/mfa/challenge/verify` | Risponde a una challenge — questo genera la sessione |
| `DELETE` | `/api/auth/mfa/unenroll` | Rimuove un fattore (richiede una sessione `aal2` una volta che l'account dispone di un fattore verificato) |
| `POST` | `/api/auth/mfa/recovery-codes` | Sostituisce i codici di recupero del chiamante con dieci nuovi codici (richiede una sessione `aal2`) |

La gestione amministrativa di utenti e ruoli è una **superficie separata**, montata su
`/api/admin/` anziché su `/api/auth/`. La lettura richiede lo scope `users:read` e
la modifica richiede `users:write`, ad eccezione della lettura ristretta dello user picker descritta di seguito. Un admin e la service key possiedono entrambi; lo stesso vale per un
ruolo che li dichiara. Nessuno può modificare un account che dispone di privilegi superiori ai propri.
Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | Elenca gli utenti (con paginazione). `?search=` confronta una porzione case-insensitive dell'email o del nome visualizzato. Corrisponde anche a qualsiasi ruolo assegnato all'utente e all'uid |
| `GET` | `/api/admin/users/pick` | La lettura per lo user picker: `uid`, `displayName`, `email` e `photoURL` per ogni utente, nient'altro. Accetta `?search=`, `?limit=` (25 per impostazione predefinita) e `?offset=`, oppure `?ids=a,b` per gli utenti indicati da un valore memorizzato. Risponde a `users:read` e a chiunque possa scrivere in una collection dotata di un campo [`userSelect`](/docs/collections/properties/) — consentendo a un editor di compilarlo. Una regola scritta in SQL non elaborato (`using` / `withCheck` che il modello delle policy non può analizzare) non può essere valutata preventivamente, pertanto in questo caso viene considerata come un rifiuto: su tale collection solo i possessori di `users:read` possono effettuare la selezione. Chiunque altro riceve `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Crea un utente |
| `GET` | `/api/admin/users/:uid` | Legge un utente |
| `PUT` | `/api/admin/users/:uid` | Aggiorna un utente. `{ disabled: true }` disattiva l'account senza eliminarlo: ogni accesso e refresh viene rifiutato (`ACCOUNT_DISABLED`), le sue sessioni terminano e ogni token in suo possesso viene rifiutato; `false` lo riattiva |
| `DELETE` | `/api/admin/users/:uid` | Elimina un utente. Le sue sessioni terminano e qualsiasi access token in suo possesso viene rifiutato a partire da quella richiesta |
| `POST` | `/api/admin/users/:uid/reset-password` | Reimposta la password di un utente senza richiedere quella attuale. `rebase auth reset-password` lo richiama e scrive direttamente nel database solo quando il backend non è raggiungibile; in entrambi i casi le sessioni dell'account terminano |
| `DELETE` | `/api/admin/users/:uid/mfa` | Rimuove i secondi fattori e i codici di recupero di un utente e termina le sue sessioni — per chi ha perso entrambi |
| `GET` | `/api/admin/roles` | `admin` e i ruoli dichiarati dalla tabella users, con i relativi scope |
| `POST` | `/api/admin/bootstrap` | Consente al primo utente registrato di rivendicare il ruolo di admin finché non ne esiste alcuno. Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |

Tutti gli endpoint delle data API richiedono un header `Authorization: Bearer <token>` valido quando `requireAuth: true` (impostazione predefinita).

### Criteri per le password

Una nuova password richiede almeno 8 caratteri, con una lettera maiuscola, una
minuscola e una cifra numerica. Registrazione, reimpostazione e modifica rifiutano quelle che
non soddisfano i requisiti con `400 WEAK_PASSWORD`, elencando ciascuna regola violata, così come un
amministratore che sceglie una password: `POST /api/admin/users`, una creazione sulla
tabella users tramite la data API (`POST /api/data/users`, il suo endpoint `/bulk`, una
scrittura socket o MCP), `PUT /api/admin/users/:uid` e
`POST /api/admin/users/:uid/reset-password`. Su `/bulk`, il messaggio inizia con
`Row <n>: ` (conteggiato a partire da 0), come per gli altri errori di riga delle operazioni bulk.

Per creare account le cui password sono state impostate da un altro sistema, ad esempio durante un'importazione, invia
`skipPasswordPolicy: true` nel corpo della creazione (su ogni riga di un `/bulk`). Il
server lo rispetta solo per un amministratore o per la chiave di servizio; da chiunque
altro non applica deroghe e il messaggio di rifiuto lo specifica. Non viene mai memorizzato. L'importazione
del pannello di amministrazione lo invia per ogni riga contenente una `password`. L'accesso
non verifica mai questi criteri, quindi una password più vecchia continuerà a funzionare. Per impostare le tue regole personalizzate, passa
`auth.hooks.validatePasswordStrength` da un backend [espulso (ejected)](/docs/backend/authentication/#configuration).
Il primo admin inizializzato da `REBASE_ADMIN_PASSWORD` è soggetto a una
regola diversa: almeno 12 caratteri, senza ulteriori vincoli.

### Formato della risposta

Ogni endpoint che rilascia una sessione risponde con lo stesso envelope — `register`,
`login`, ogni provider OAuth, `magic-link/verify`, `otp/verify`, `anonymous`,
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

Invia nuovamente l'access token nell'header `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` è espresso in millisecondi epoch.

`POST /api/auth/refresh` risponde con lo stesso envelope, tranne per il fatto che `user` viene
interamente omesso quando l'account non può essere riletto, quindi è da considerarsi opzionale
in quel contesto.

`providerId` indica come è stato effettuato l'accesso alla sessione: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (un accesso completato con un secondo fattore), o l'ID del
provider, come ad esempio `google`. Viene memorizzato con la sessione al momento dell'accesso, quindi
`refresh` e `GET /api/auth/me` restituiscono la stessa risposta per tutta la durata della
sessione. Una sessione avviata prima della versione 0.24 indicherà `password`.

:::caution[L'SDK tipizzato appiattisce questo envelope — le richieste HTTP raw no]
Il JSON sopra rappresenta il formato di trasmissione (wire format) ed è ciò che restituisce `fetch("/api/auth/login")`:
il token si trova in **`body.tokens.accessToken`**.

L'[SDK tipizzato](/docs/sdk/authentication) spacchetta `tokens` prima di restituire la
sessione, quindi `auth.signInWithEmail()` restituisce invece un oggetto appiattito
**`{ user, accessToken, refreshToken }`**.

Entrambe le strutture sono reali; appartengono a due livelli diversi. Tentare di leggere la
struttura dell'SDK da una chiamata `fetch` raw produrrà `undefined`, manifestandosi come "login riuscito
ma nessun access token presente" — il login è andato a buon fine, il token era semplicemente un livello più sotto.
:::

### Modifica di un indirizzo email

Un utente autenticato
sposta il proprio account su un altro indirizzo in due passaggi:

1. `POST /api/auth/change-email { newEmail }` registra la modifica e invia un
   link, `<frontend>/confirm-email-change?token=…`, al nuovo indirizzo e un
   avviso senza link a quello attuale. Il link è valido per 24 ore e una
   nuova richiesta sostituisce la precedente. `GET /api/auth/me` segnala l'indirizzo
   in attesa come `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` sposta l'account: il nuovo
   indirizzo diventa il suo indirizzo ufficiale, verificato. Ogni identità OAuth il cui provider
   garantiva per il vecchio indirizzo viene scollegata (`removedProviders` ne elenca i dettagli),
   poiché chiunque controlli il vecchio indirizzo potrebbe altrimenti continuare ad accedere
   tramite di esso, e qualsiasi link di reimpostazione inviato al vecchio indirizzo smette di funzionare.
   Le sessioni vengono mantenute.

Il nuovo indirizzo non viene riservato durante l'attesa del link: bloccarlo permetterebbe a qualsiasi
account di impedire a un estraneo di registrarsi con il proprio indirizzo. Se un altro
account acquisisce l'indirizzo prima che il link venga seguito, il link risponde
`409 EMAIL_EXISTS` e non viene applicata alcuna modifica; tra due account che richiedono lo stesso
indirizzo, il primo a seguire il relativo link lo ottiene. L'hook `beforeEmailChange` può
rifiutare un indirizzo, esattamente come fa `beforeUserCreate` al momento della registrazione.

Nel CMS, l'indirizzo viene modificato da **Account settings → Profile** e il
link apre la schermata specifica del CMS, con o senza sessione attiva. Un altro frontend gestisce una pagina
su `/confirm-email-change` che chiama la route con il token del link.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) attivo (impostazione predefinita), il refresh
token viaggia come cookie `httpOnly` e `tokens.refreshToken` è una stringa vuota
nel body. L'access token non subisce modifiche.

### Autenticazione a più fattori (TOTP)

**Un secondo fattore protegge l'accesso, non solo le singole operazioni.** Quando un
account ha un fattore TOTP *verificato*, nessuna route emette una sessione fino alla
presentazione di un codice — login tramite password, ogni provider OAuth, magic link,
codice email e anonymous-link rifiutano tutti con `401 MFA_REQUIRED`:

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

`mfaToken` **non è una sessione**: ha uno scopo specifico (purpose-scoped), scade dopo cinque minuti
e viene rifiutato da ogni route autenticata. Invialo come bearer token a
`POST /api/auth/mfa/challenge` (con un `factorId`) e poi a
`POST /api/auth/mfa/challenge/verify` (con il `challengeId` e il codice a sei cifre,
o un codice di recupero). È quest'ultima chiamata a generare i token di accesso e di refresh,
a livello `aal2`; il livello viene memorizzato sulla sessione e mantenuto anche attraverso
`POST /api/auth/refresh`.

Anche la registrazione (enrolment) è protetta. Il primo fattore su un account può essere registrato a partire da
una sessione ordinaria, ma una volta verificato, `enroll`, `verify` e `unenroll`
richiedono tutti una sessione `aal2` — altrimenti una password sottratta potrebbe consentire di registrare un
proprio fattore, effettuare l'escalation su di esso ed eliminare quello reale.

La verifica è limitata su entrambi i fronti: una challenge scade dopo cinque tentativi
falliti, ciascun account è limitato a dieci tentativi di verifica ogni 15 minuti
(conteggiati per utente, quindi la rotazione degli IP non aiuta) e un codice accettato viene
registrato per il fattore in modo che non possa essere riutilizzato per il resto della sua
finestra temporale di ±1 passaggio.

Nella tabella degli utenti del CMS, **Reset two-step verification**
(`DELETE /api/admin/users/:uid/mfa`) e **Disable or enable account**
(`PUT /api/admin/users/:uid { disabled }`) sono disponibili per chiunque possieda
`users:write`, esattamente come le relative route; l'opzione non è mai disponibile per il proprio
account e la modifica di un account di rango superiore viene rifiutata con la motivazione del server.

Imposta `MFA_ENCRYPTION_KEY` (32+ caratteri casuali) per crittografare i
secret TOTP memorizzati. In sua assenza, il server ripiega su `JWT_SECRET` emettendo un avviso. Impostalo
**prima** che chiunque effettui la registrazione: i secret memorizzati non contengono alcun ID di chiave, pertanto la modifica
successiva della chiave renderà i fattori esistenti non decifrabili e impedirà ai rispettivi proprietari di
completare una verifica (challenge).

### Invitare membri del team tramite email

I flussi di invito devono convertire un indirizzo email in un ID utente, ma la
tabella `users` è protetta da RLS dal lato client. Invece di implementare manualmente
una funzione server di amministrazione, abilita la ricerca integrata:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Quindi, dal client:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

L'endpoint è **solo per utenti autenticati** e restituisce esclusivamente `uid`, `displayName`
e `photoURL` — mai l'email, i ruoli o i metadati dell'utente cercato. È
**disattivato per impostazione predefinita** poiché consente a qualsiasi utente autenticato di verificare quali email dispongono di
un account; attivalo solo se l'esperienza utente (UX) di invito lo richiede.

## Contesto del database per la Row-Level Security (RLS)

Rebase collega direttamente l'autenticazione delle richieste alla Row-Level Security (RLS) di PostgreSQL. Ogni query al database eseguita tramite un driver con ambito utente viene eseguita all'interno di una transazione di database (`db.transaction()`) che configura parametri locali alla transazione:

*   `app.uid` — L'ID univoco (`uid`) dell'utente autenticato. Il valore predefinito è `'anonymous'` per le richieste non autenticate. La versione precedente alla ridenominazione, `app.user_id`, viene ancora scritta al suo fianco per le policy compilate prima della modifica.
*   `app.user_roles` — Una stringa separata da virgole che elenca i ruoli assegnati all'utente.
*   `app.is_anonymous` — `'true'` per una sessione guest (accesso anonimo), `'false'` altrimenti.
*   `app.jwt` — Una stringa JSON con i claim personalizzati del token più `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Questi parametri sono configurati localmente per la durata della transazione utilizzando la funzione `set_config` di Postgres:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Funzioni helper per le policy PostgreSQL

Per semplificare la scrittura delle policy di Row-Level Security, Rebase crea funzioni helper all'interno dello schema `rebase` durante il bootstrap del database:

*   **`rebase.uid()`** — Restituisce l'ID dell'utente autenticato come `text`, oppure `NULL` se non impostato:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Restituisce la stringa dei ruoli separata da virgole:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Restituisce l'intero payload del JWT come oggetto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indica se il chiamante è un guest, come `boolean` (`false` quando non impostato), consentendo a una policy di verificare `NOT rebase.is_anonymous()`.

Puoi utilizzare questi helper direttamente nelle tue regole di sicurezza personalizzate o nelle migrazioni del database:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Token asimmetrici e JWKS

Per impostazione predefinita, gli access token sono firmati con `jwtSecret` (HS256). Questo
approccio funziona, ma implica che qualsiasi elemento che debba *verificare* un token deve possedere la chiave che lo
*genera* — pertanto un gateway o un edge worker che controlla una sessione potrebbe anche falsificarne uno — e
la modifica del secret disconnette tutti gli utenti contemporaneamente.

Configurando una chiave di firma, Rebase firmerà invece gli access token in modo asimmetrico,
pubblicando la controparte pubblica su **`/.well-known/jwks.json`** affinché chiunque possa
verificarli:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Oppure dalle variabili di ambiente, per una singola chiave:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Genera una chiave con:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Anche le chiavi RSA sono supportate e firmano con `RS256`; le chiavi EC P-256 firmano con `ES256`. Viene configurata solo la
chiave privata — la parte pubblica viene derivata da essa, impedendo così discrepanze
tra la coppia di chiavi. `jwtSecret` rimane comunque obbligatorio: serve ancora a firmare i
token con ambito specifico (link di download, MFA in sospeso, reimpostazione della password) che solo
questo server legge.

### Rotazione di una chiave

Posiziona la nuova chiave per prima e mantieni elencata quella precedente. I nuovi token vengono firmati con la
nuova chiave; i token già in circolazione continuano a essere verificati con quella precedente fino alla loro
scadenza, evitando che gli utenti vengano disconnessi.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una volta trascorso il tempo di vita massimo degli access token, rimuovi la voce precedente. Utilizza
`activeKid` se desideri pubblicare una chiave prima di iniziare a firmare con essa.

### Verifica altrove

I token contengono il `kid` della chiave di firma nel rispettivo header; in questo modo il verificatore
seleziona la chiave corretta dal JWKS e rileva quando eseguire un nuovo recupero (re-fetch) dopo una
rotazione. Qualsiasi libreria standard esegue questa operazione automaticamente — ad esempio, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Se `signingKeys` non è configurato, `/.well-known/jwks.json` risponde
`{"keys":[]}` e i token restano in formato HS256. Nulla cambia finché non aggiungi una chiave.
:::

## Autenticazione con Service Key

Per la comunicazione server-to-server (es. cron job, servizi esterni), configura una service key statica:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

I client si autenticano con l'header `Authorization: Bearer <service-key>`. 

### Chiave interna per-boot

Se `REBASE_SERVICE_KEY` non viene fornita nella configurazione, Rebase genera automaticamente una **chiave interna casuale a ogni avvio** (per-boot). 

Questa chiave non viene mai registrata nei log e non lascia mai il processo. Viene utilizzata dal singleton `rebase` per autenticarsi con le API del control-plane del server stesso (auth, storage, ecc.). Ciò garantisce che i task amministrativi (come l'invio di un'email di benvenuto o la generazione di un URL di storage) funzionino sempre out-of-the-box sia in ambiente di sviluppo che in produzione, senza richiedere la gestione manuale delle chiavi.

### Protezione contro gli attacchi di timing e requisiti delle chiavi

Per prevenire attacchi di timing (timing attacks), Rebase convalida sia la service key configurata dall'utente sia la chiave interna utilizzando un confronto tra stringhe a tempo costante (`safeCompare`). La service key configurata dall'utente **deve contenere almeno 32 caratteri**; se viene configurata una chiave con meno di 32 caratteri, Rebase genererà un errore di configurazione all'avvio bloccando l'esecuzione (fail-closed).

## Prossimi passi

- **[Autenticazione](/docs/backend/authentication/)** — la configurazione da cui derivano queste route
- **[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters/)** — sostituire il provider sottostante
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — cosa fa una policy con `rebase.uid()`
- **[Autenticazione con l'SDK tipizzato](/docs/sdk/authentication/)** — chiamare queste route dall'SDK
