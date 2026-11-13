---
sourceHash: 26d38afcbfd02569
title: Endpoint di autenticazione e token
sidebar_label: Endpoint di autenticazione
description: Le route di autenticazione montate dal backend Rebase, la struttura delle loro risposte, l'autenticazione a più fattori, il contesto del database visibile da una policy, JWKS e chiavi di servizio.
---

Le route montate dal [blocco `auth`](/docs/backend/authentication/) e i token restituiti.

## Endpoint di autenticazione

Tutti gli endpoint di autenticazione sono montati su `/api/auth/`:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crea un nuovo account |
| `POST` | `/api/auth/login` | Accedi con email/password |
| `POST` | `/api/auth/refresh` | Aggiorna il token di accesso |
| `POST` | `/api/auth/<provider>` | Accesso OAuth (es. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Collega un provider OAuth all'account autenticato. Su un guest equivale alla registrazione: richiede `allowRegistration`, acquisisce l'indirizzo del provider quando quest'ultimo lo garantisce e risponde con una sessione per l'account in cui il guest si è trasformato |
| `POST` | `/api/auth/logout` | Revoca il refresh token |
| `POST` | `/api/auth/forgot-password` | Invia l'email per il ripristino della password |
| `POST` | `/api/auth/reset-password` | Reimposta la password con il token |
| `POST` | `/api/auth/find-user` | Risolve un'email in un profilo pubblico minimale (opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifica la password del chiamante stesso (autenticato). Termina tutte le altre sessioni e risponde con una nuova sessione per il chiamante |
| `GET` | `/api/auth/me` | Il profilo del chiamante stesso |
| `PATCH` | `/api/auth/me` | Aggiorna il profilo del chiamante stesso |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: sposta l'account del chiamante su un altro indirizzo. Invia un link al nuovo indirizzo e una notifica a quello vecchio; nulla cambia finché il link non viene aperto. Richiede `aal2` su un account con un secondo fattore. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` per un guest — vedi [Modifica di un indirizzo email](#modifica-di-un-indirizzo-email) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` dal link. Nessuna sessione richiesta. Sposta l'account sul nuovo indirizzo, verificato; `400 INVALID_TOKEN` per un link già utilizzato, sostituito o scaduto, `409 EMAIL_EXISTS` se l'indirizzo è stato occupato durante l'attesa |
| `GET` | `/api/auth/config` | Ciò che questo backend offre a una schermata di accesso — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, che indica se il backend gestisce l'archiviazione file. Non autenticato e calcolato dagli stessi predicati applicati dalle route, in modo che quanto mostrato dalla schermata corrisponda sempre a ciò che può fare |
| `POST` | `/api/auth/send-verification` | Invia al chiamante un link di verifica email |
| `GET` | `/api/auth/verify-email` | Consuma un link di verifica (l'URL nell'email). Mantiene ciò che una sessione attiva dell'account dimostra e rimuove ciò che nessuno ha dimostrato — vedi [Verifica email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo stesso con `{ token, password?, removeUnproven? }`: la password lo mantiene ed effettua l'accesso; senza alcuna prova, un account che ne possiede una risponde con `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Invia via email un link monouso per l'accesso. `503 EMAIL_NOT_CONFIGURED` senza SMTP |
| `POST` | `/api/auth/magic-link/verify` | Scambia un token magic-link con una sessione |
| `POST` | `/api/auth/otp` | Invia via email un codice di accesso a sei cifre. Risponde allo stesso modo indipendentemente dal fatto che l'indirizzo sia associato o meno a un account |
| `POST` | `/api/auth/otp/verify` | Scambia `{ email, code }` con una sessione |
| `POST` | `/api/auth/anonymous` | Crea una sessione anonima (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associa credenziali reali all'account anonimo già autenticato. Richiede sia `allowAnonymous` che la registrazione aperta: `403 ANONYMOUS_AUTH_DISABLED` una volta disattivato l'accesso anonimo (inclusi i guest autenticati in precedenza) e `403 REGISTRATION_DISABLED` quando la registrazione è chiusa |
| `GET` | `/api/auth/sessions` | Elenca le sessioni attive del chiamante, una per ciascun accesso. Quella del chiamante stesso è contrassegnata come `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revoca tutte le sessioni, inclusa questa — disconnessione remota su ogni dispositivo |
| `DELETE` | `/api/auth/sessions/:id` | Revoca una singola sessione: il relativo refresh token e il token di accesso presente su quel dispositivo |
| `GET` | `/api/auth/scopes` | Tutti gli [scope](/docs/backend/roles-and-scopes/) noti a questo backend e quelli posseduti dal chiamante |
| `GET` | `/api/auth/keys` | Le [chiavi API personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | Crea una chiave personale. `403 PERSONAL_KEYS_DISABLED` a meno che la collection users non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revoca una delle chiavi del chiamante |
| `GET` | `/.well-known/jwks.json` | Il JWKS pubblico — montato sulla root, non sotto `basePath`, perché è lì che un verificatore cerca. Montato ogni volta che il backend genera i propri token; un set di chiavi vuoto finché non viene configurata la [firma asimmetrica](#token-asimmetrici-e-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Avvia la registrazione TOTP (restituisce il segreto e i codici di recupero) |
| `POST` | `/api/auth/mfa/verify` | Conferma la registrazione con un codice dall'autenticatore |
| `GET` | `/api/auth/mfa/factors` | Elenca i fattori registrati del chiamante |
| `POST` | `/api/auth/mfa/challenge` | Apre una challenge per un fattore verificato |
| `POST` | `/api/auth/mfa/challenge/verify` | Risponde a una challenge — questa operazione emette la sessione |
| `DELETE` | `/api/auth/mfa/unenroll` | Rimuove un fattore (richiede una sessione `aal2` una volta che l'account dispone di un fattore verificato) |
| `POST` | `/api/auth/mfa/recovery-codes` | Sostituisce i codici di recupero del chiamante con dieci nuovi codici (richiede una sessione `aal2`) |

La gestione amministrativa degli utenti e dei ruoli è una **superficie separata**, montata su `/api/admin/` anziché su `/api/auth/`. La lettura richiede lo scope `users:read` e la modifica richiede `users:write`, fatta eccezione per la lettura ristretta dello user picker indicata di seguito. Un amministratore e la chiave di servizio possiedono entrambi; lo stesso vale per un ruolo che li dichiara. Nessuno può modificare un account che dispone di permessi superiori ai propri. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Elenca gli utenti (impaginato). `?search=` corrisponde a una parte (senza distinzione tra maiuscole e minuscole) dell'email o del nome visualizzato. Corrisponde anche a qualsiasi ruolo posseduto dall'utente e all'uid |
| `GET` | `/api/admin/users/pick` | La lettura per lo user picker: `uid`, `displayName`, `email` e `photoURL` per utente, nient'altro. Accetta `?search=`, `?limit=` (25 per impostazione predefinita) e `?offset=`, oppure `?ids=a,b` per gli utenti indicati da un valore memorizzato. Risponde a `users:read`, oltre a chiunque possa scrivere in una collection con un campo [`userSelect`](/docs/collections/properties/) — in modo che un editor possa compilarne uno. Una regola scritta come SQL grezzo (`using` / `withCheck` che il modello di policy non può leggere) non può essere valutata a priori, quindi viene considerata come rifiutata: su tale collection solo i titolari di `users:read` possono effettuare la selezione. Chiunque altro riceve `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Crea un utente |
| `GET` | `/api/admin/users/:uid` | Legge un singolo utente |
| `PUT` | `/api/admin/users/:uid` | Aggiorna un utente. `{ disabled: true }` disattiva l'account senza eliminarlo: ogni accesso e refresh viene rifiutato (`ACCOUNT_DISABLED`), le sue sessioni terminano e ogni token in suo possesso viene rifiutato; `false` lo riattiva |
| `DELETE` | `/api/admin/users/:uid` | Elimina un utente. Le sue sessioni terminano e qualsiasi token di accesso in suo possesso viene rifiutato a partire da quella richiesta |
| `POST` | `/api/admin/users/:uid/reset-password` | Reimposta la password di un utente senza richiedere quella attuale. `rebase auth reset-password` lo chiama e scrive direttamente sul database solo quando il backend non è raggiungibile; in entrambi i casi le sessioni dell'account terminano |
| `DELETE` | `/api/admin/users/:uid/mfa` | Rimuove i secondi fattori e i codici di recupero di un utente, terminandone le sessioni — per chi ha perso entrambi |
| `GET` | `/api/admin/roles` | `admin` e i ruoli dichiarati dalla collection users, con i relativi scope |
| `POST` | `/api/admin/bootstrap` | Consente al primo utente registrato di richiedere il ruolo admin finché non ne esiste nessuno. Rifiutato in produzione — vedi [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Tutti gli endpoint della data API richiedono un'intestazione `Authorization: Bearer <token>` valida quando `requireAuth: true` (il valore predefinito).

### Password policy

Una nuova password richiede almeno 8 caratteri, con una lettera maiuscola, una lettera minuscola e un numero. La registrazione, il ripristino e la modifica rifiutano una password non conforme con `400 WEAK_PASSWORD`, elencando ogni regola violata, così come accade per un amministratore che sceglie una password: `POST /api/admin/users`, una creazione sulla collection users tramite la data API (`POST /api/data/users`, il relativo `/bulk`, una scrittura socket o MCP), `PUT /api/admin/users/:uid` e `POST /api/admin/users/:uid/reset-password`. Su un `/bulk`, il messaggio inizia con `Row <n>: ` (conteggiato a partire da 0), come per gli altri errori di riga del bulk.

Per creare account le cui password sono state impostate da un altro sistema, come durante un'importazione, invia `skipPasswordPolicy: true` nel corpo della creazione (su ogni riga di un `/bulk`). Il server lo rispetta solo per un amministratore o per la chiave di servizio; per chiunque altro non concede eccezioni e il rifiuto lo segnala chiaramente. Non viene mai memorizzato. L'importazione del pannello di amministrazione lo invia per ogni riga contenente una `password`. L'accesso non verifica mai la policy, quindi una password meno recente continuerà a funzionare. Per impostare regole personalizzate, passa `auth.hooks.validatePasswordStrength` da un backend [espulso (ejected)](/docs/backend/authentication/#configuration). Il primo amministratore inizializzato tramite `REBASE_ADMIN_PASSWORD` segue una regola differente: almeno 12 caratteri e nient'altro.

### Formato della risposta

Ogni endpoint che emette una sessione risponde con la stessa struttura (envelope) — `register`, `login`, ciascun provider OAuth, `magic-link/verify`, `otp/verify`, `anonymous`, `anonymous/link` e `mfa/challenge/verify`:

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

Reinvia il token di accesso come `Authorization: Bearer <accessToken>`. `accessTokenExpiresAt` è espresso in millisecondi epoch.

`POST /api/auth/refresh` risponde con lo stesso envelope, eccetto che `user` viene omesso del tutto quando l'account non può essere riletto, quindi in questo caso va considerato opzionale.

`providerId` indica la modalità con cui è stata effettuata la sessione: `password`, `anonymous`, `magic-link`, `otp`, `mfa` (un accesso completato con un secondo fattore), oppure l'id del provider, come `google`. Viene memorizzato con la sessione al momento dell'accesso, quindi `refresh` e `GET /api/auth/me` forniscono la stessa risposta per l'intera durata della sessione. Una sessione avviata prima della versione 0.24 restituisce `password`.

:::caution[L'SDK tipizzato appiattisce questo envelope — le richieste HTTP raw no]
Il JSON sovrastante rappresenta il formato di trasmissione (wire format) ed è ciò che restituisce `fetch("/api/auth/login")`: il token si trova in **`body.tokens.accessToken`**.

L'[SDK tipizzato](/docs/sdk/authentication) decomprime `tokens` prima di restituire la sessione, quindi `auth.signInWithEmail()` si risolve invece in una struttura appiattita **`{ user, accessToken, refreshToken }`**.

Entrambe le strutture sono reali; appartengono a due livelli diversi. La lettura della struttura dell'SDK da una `fetch` diretta restituisce `undefined`, manifestandosi come "accesso riuscito ma nessun token di accesso disponibile" — l'accesso era andato a buon fine, ma il token si trovava un livello più sotto.
:::

### Modifica di un indirizzo email

Un utente autenticato può spostare il proprio account su un altro indirizzo in due passaggi:

1. `POST /api/auth/change-email { newEmail }` registra la modifica e invia via email un link, `<frontend>/confirm-email-change?token=…`, al nuovo indirizzo e una notifica senza link a quello attuale. Il link è valido per 24 ore e una nuova richiesta sostituisce la precedente. `GET /api/auth/me` segnala l'indirizzo in attesa come `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` trasferisce l'account: il nuovo indirizzo diventa il suo indirizzo verificato. Ogni identità OAuth il cui provider garantiva per il vecchio indirizzo viene scollegata (`removedProviders` ne elenca i nomi), poiché chiunque controlli il vecchio indirizzo potrebbe altrimenti continuare ad accedere tramite di esso, e qualsiasi link di ripristino inviato al vecchio indirizzo smette di funzionare. Le sessioni vengono mantenute.

Il nuovo indirizzo non viene riservato durante l'attesa del link: bloccarlo permetterebbe a qualsiasi account di impedire a un estraneo di registrarsi con il proprio indirizzo. Se un altro account acquisisce l'indirizzo prima che il link venga seguito, il link risponde con `409 EMAIL_EXISTS` e nulla viene trasferito; tra due account che richiedono lo stesso indirizzo, il primo a seguire il link lo ottiene. L'hook `beforeEmailChange` può rifiutare un indirizzo, come fa `beforeUserCreate` in fase di registrazione.

Nel CMS, l'indirizzo viene modificato da **Account settings → Profile**, e il link apre la schermata interna del CMS, indipendentemente dal fatto che l'utente sia autenticato o meno. Un frontend alternativo serve una pagina su `/confirm-email-change` che richiama la route con il token del link.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) abilitato (impostazione predefinita), il refresh token viaggia come cookie `httpOnly` e `tokens.refreshToken` è una stringa vuota nel corpo. Il token di accesso rimane inalterato.

### Autenticazione a più fattori (TOTP)

**Un secondo fattore regola l'accesso, non solo le singole operazioni.** Una volta che un account possiede un fattore TOTP *verificato*, nessuna route emette una sessione finché non viene presentato un codice — l'accesso tramite password, ogni provider OAuth, magic link, codice email e anonymous-link rifiutano tutti con `401 MFA_REQUIRED`:

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

`mfaToken` **non è una sessione**: ha un ambito limitato allo scopo, scade in cinque minuti e viene rifiutato da ogni route autenticata. Invialo come bearer token a `POST /api/auth/mfa/challenge` (con un `factorId`) e poi a `POST /api/auth/mfa/challenge/verify` (con il `challengeId` e il codice a sei cifre, o un codice di recupero). È quest'ultima chiamata a generare i token di accesso e di refresh, a livello `aal2`; il livello viene memorizzato sulla sessione e mantenuto attraverso `POST /api/auth/refresh`.

Anche la registrazione dei fattori è protetta. Il primo fattore di un account può essere registrato da una sessione ordinaria, ma una volta verificato, `enroll`, `verify` e `unenroll` richiedono tutti una sessione `aal2` — altrimenti una password rubata potrebbe consentire di registrare un fattore proprio, eseguire lo step-up ed eliminare quello legittimo.

La verifica è limitata su entrambi gli assi: una challenge scade dopo cinque tentativi falliti, ciascun account è limitato a dieci tentativi di verifica ogni 15 minuti (conteggiati per utente, quindi la rotazione degli IP non aiuta) e un codice accettato viene registrato per quel fattore in modo che non possa essere riutilizzato per il resto della sua finestra temporale di ±1 passaggio.

Nella tabella utenti del CMS, **Reset two-step verification** (`DELETE /api/admin/users/:uid/mfa`) e **Disable or enable account** (`PUT /api/admin/users/:uid { disabled }`) sono disponibili per chiunque detenga `users:write`, così come previsto per le relative route; lo switch non viene mai offerto per il proprio account e la modifica a un account di grado superiore viene rifiutata con la motivazione del server.

Imposta `MFA_ENCRYPTION_KEY` (almeno 32 caratteri casuali) per crittografare i segreti TOTP memorizzati. In sua assenza, il server ripiega su `JWT_SECRET` e genera un avviso. Impostalo **prima** che chiunque effettui la registrazione: i segreti memorizzati non includono un id chiave, quindi cambiare la chiave in seguito rende i fattori esistenti indecifrabili e impedisce ai relativi proprietari di completare la challenge.

### Invitare membri del team via email

I flussi di invito devono convertire un indirizzo email in un user id, ma la collection `users` è protetta da RLS dal lato client. Anziché implementare manualmente una funzione server di amministrazione, abilita la ricerca integrata:

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

L'endpoint è **solo per utenti autenticati** e restituisce esclusivamente `uid`, `displayName` e `photoURL` — mai l'email, i ruoli o i metadati dell'utente cercato. È **disattivato per impostazione predefinita** perché consente a qualsiasi utente autenticato di verificare quali indirizzi email hanno un account associato; attivalo solo se l'esperienza utente (UX) di invito lo richiede.

## Contesto del database per Row-Level Security (RLS)

Rebase collega l'autenticazione delle richieste direttamente alla Row-Level Security (RLS) di PostgreSQL. Ogni query di database eseguita tramite un driver con ambito utente viene eseguita all'interno di una transazione di database (`db.transaction()`) che imposta parametri di configurazione locali alla transazione:

*   `app.uid` — L'ID univoco (`uid`) dell'utente autenticato. Il valore predefinito è `'anonymous'` per le richieste non autenticate. La versione precedente alla ridenominazione `app.user_id` viene ancora registrata insieme ad esso, a supporto delle policy compilate prima della modifica.
*   `app.user_roles` — Una stringa separata da virgole che elenca i ruoli assegnati all'utente.
*   `app.is_anonymous` — `'true'` per una sessione guest (accesso anonimo), `'false'` altrimenti.
*   `app.jwt` — Una stringa JSON contenente i claim personalizzati del token oltre a `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Questi parametri vengono configurati localmente per la durata della transazione utilizzando la funzione `set_config` di Postgres:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Funzioni helper per le policy PostgreSQL

Per semplificare la scrittura delle policy di Row-Level Security, Rebase crea delle funzioni helper nello schema `rebase` durante il bootstrap del database:

*   **`rebase.uid()`** — Restituisce l'ID dell'utente autenticato come `text`, o `NULL` se non impostato:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Restituisce la stringa separata da virgole dei ruoli:
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
*   **`rebase.is_anonymous()`** — Indica se il chiamante è un guest, come `boolean` (`false` quando non impostato), permettendo a una policy di specificare `NOT rebase.is_anonymous()`.

Puoi utilizzare questi helper direttamente nelle tue regole di sicurezza personalizzate o nelle migrazioni del database:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Token asimmetrici e JWKS

Per impostazione predefinita, i token di accesso sono firmati con `jwtSecret` (HS256). Questo approccio funziona, ma implica che qualsiasi elemento che debba *verificare* un token debba possedere anche la chiave per *generarlo* — quindi un gateway o un edge worker che controlla una sessione potrebbe anche falsificarne uno — e modificare il segreto comporta la disconnessione immediata di tutti gli utenti.

Configurando una chiave di firma, Rebase firmerà invece i token di accesso in modo asimmetrico, pubblicando la componente pubblica su **`/.well-known/jwks.json`** affinché chiunque possa effettuare la verifica:

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

Funzionano anche le chiavi RSA, che firmano in `RS256`; le chiavi EC P-256 firmano in `ES256`. Viene configurata solo la chiave privata — la componente pubblica viene derivata da essa, evitando disallineamenti tra le due parti. `jwtSecret` rimane comunque obbligatorio: serve ancora a firmare i token con ambito specifico (link di download, MFA in attesa, reimpostazione password) che solo questo server leggerà.

### Rotazione di una chiave

Inserisci la nuova chiave per prima e mantieni elencata quella vecchia. I nuovi token verranno firmati con la nuova chiave; i token già in circolazione continueranno a essere verificati con quella precedente fino alla loro scadenza, senza provocare la disconnessione di alcun utente.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una volta trascorso il ciclo di vita massimo del token di accesso, rimuovi la voce precedente. Utilizza `activeKid` se desideri pubblicare una chiave prima di usarla per la firma.

### Verifica altrove

I token contengono il `kid` della chiave di firma nella propria intestazione; è in questo modo che un verificatore seleziona la chiave corretta dal JWKS e sa quando recuperarlo nuovamente dopo una rotazione. Qualsiasi libreria standard si occupa di questo processo — ad esempio, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Senza `signingKeys` configurate, `/.well-known/jwks.json` risponde `{"keys":[]}` e i token rimangono in HS256. Nulla cambia finché non viene aggiunta una chiave.
:::

## Autenticazione con chiave di servizio (Service Key)

Per la comunicazione server-to-server (ad es. cron job, servizi esterni), configura una chiave di servizio statica:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

I client si autenticano con l'intestazione `Authorization: Bearer <service-key>`. 

### Chiave interna generata a ogni avvio (Per-Boot Key)

Se `REBASE_SERVICE_KEY` non è fornita nella configurazione, Rebase genera automaticamente una **chiave interna a ogni avvio** casuale. 

Questa chiave non viene mai registrata nei log e non lascia mai il processo. Viene utilizzata dal singleton `rebase` per autenticarsi presso le API del control plane del server stesso (auth, storage, ecc.). Ciò garantisce che le attività amministrative (come l'invio di un'email di benvenuto o la generazione di un URL di storage) funzionino sempre fin da subito, sia in sviluppo che in produzione, senza richiedere la gestione manuale delle chiavi.

### Protezione dai timing attack e requisiti della chiave

Per prevenire i timing attack, Rebase convalida sia la chiave di servizio configurata dall'utente sia la chiave interna utilizzando una comparazione di stringhe a tempo costante (`safeCompare`). La chiave di servizio configurata dall'utente **deve essere lunga almeno 32 caratteri**; se viene configurata una chiave di lunghezza inferiore a 32 caratteri, Rebase genererà un errore di configurazione all'avvio con blocco di sicurezza (fail-closed).

## Passaggi successivi

- **[Authentication](/docs/backend/authentication/)** — la configurazione da cui derivano queste route
- **[Adattatori di autenticazione personalizzati](/docs/backend/auth-adapters/)** — sostituzione del provider sottostante
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — cosa fa una policy con `rebase.uid()`
- **[Autenticazione con l'SDK tipizzato](/docs/sdk/authentication/)** — chiamare queste route dall'SDK
