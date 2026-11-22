---
sourceHash: 928eebeb904fa5e0
title: Endpoint di autenticazione e token
sidebar_label: Endpoint di autenticazione
description: Le route di autenticazione caricate dal backend di Rebase, le strutture delle risposte, l'autenticazione a più fattori, il contesto del database visualizzato da una policy, JWKS e chiavi di servizio.
---

Le route caricate dal [blocco `auth`](/docs/backend/authentication/) e i token che restituiscono.

## Endpoint di autenticazione

Tutti gli endpoint di autenticazione sono montati su `/api/auth/`:

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crea un nuovo account |
| `POST` | `/api/auth/login` | Accedi con email/password |
| `POST` | `/api/auth/refresh` | Aggiorna il token di accesso |
| `POST` | `/api/auth/<provider>` | Accesso OAuth (es. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Collega un provider OAuth all'account autenticato. Per un utente guest (ospite) si tratta di una registrazione: richiede `allowRegistration`, acquisisce l'indirizzo del provider quando il provider lo garantisce, e risponde con una sessione per l'account in cui il guest si è trasformato |
| `POST` | `/api/auth/logout` | Revoca il refresh token |
| `POST` | `/api/auth/forgot-password` | Invia l'email per il ripristino della password |
| `POST` | `/api/auth/reset-password` | Reimposta la password con il token |
| `POST` | `/api/auth/find-user` | Risolve un'email in un profilo pubblico minimale (opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifica la password del chiamante stesso (autenticato). Termina tutte le altre sessioni e ne restituisce una nuova per il chiamante |
| `GET` | `/api/auth/me` | Il profilo del chiamante stesso |
| `PATCH` | `/api/auth/me` | Aggiorna il profilo del chiamante stesso |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: sposta l'account del chiamante su un altro indirizzo. Invia un link al nuovo indirizzo e una notifica al vecchio; nulla cambia finché il link non viene seguito. Richiede `aal2` su un account con un secondo fattore. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` per un guest — vedi [Modifica di un indirizzo email](#modifica-di-un-indirizzo-email) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` dal link. Nessuna sessione richiesta. Sposta l'account sul nuovo indirizzo, verificato; `400 INVALID_TOKEN` per un link già utilizzato, sostituito o scaduto, `409 EMAIL_EXISTS` se l'indirizzo è stato occupato durante l'attesa |
| `GET` | `/api/auth/config` | Ciò che questo backend offre a una schermata di accesso — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, che indica se il backend gestisce l'archiviazione di file. Non autenticato e calcolato a partire dagli stessi predicati applicati dalle route, così che quanto pubblicizzato dalla schermata non possa divergere da ciò che può effettivamente fare |
| `POST` | `/api/auth/send-verification` | Invia al chiamante un link di verifica dell'email |
| `GET` | `/api/auth/verify-email` | Consuma un link di verifica (l'URL in quell'email). Mantiene ciò che una sessione attiva dell'account attesta e rimuove ciò che nessuno ha attestato — vedi [Verifica email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo stesso con `{ token, password?, removeUnproven? }`: la password lo mantiene e consente l'accesso; senza alcuna prova un account che ne possiede una risponde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Invia via email un link di accesso monouso. `503 EMAIL_NOT_CONFIGURED` senza SMTP |
| `POST` | `/api/auth/magic-link/verify` | Scambia un token magic-link con una sessione |
| `POST` | `/api/auth/otp` | Invia via email un codice di accesso a sei cifre. Risponde nello stesso modo a prescindere dal fatto che l'indirizzo abbia un account o meno |
| `POST` | `/api/auth/otp/verify` | Scambia `{ email, code }` con una sessione |
| `POST` | `/api/auth/anonymous` | Crea una sessione anonima (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associa credenziali reali all'account anonimo già autenticato. Richiede sia `allowAnonymous` sia la registrazione aperta: `403 ANONYMOUS_AUTH_DISABLED` una volta disattivato l'accesso anonimo, inclusi gli ospiti registrati in precedenza, e `403 REGISTRATION_DISABLED` quando la registrazione è chiusa |
| `GET` | `/api/auth/sessions` | Elenca le sessioni attive del chiamante, una per ciascun accesso. Quella del chiamante stesso è contrassegnata come `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revoca tutte le sessioni, inclusa questa — disconnessione remota su ogni dispositivo |
| `DELETE` | `/api/auth/sessions/:id` | Revoca una sessione: il suo refresh token e l'access token detenuto da quel dispositivo |
| `GET` | `/api/auth/scopes` | Ogni [scope](/docs/backend/roles-and-scopes/) noto a questo backend, e quelli detenuti dal chiamante |
| `GET` | `/api/auth/keys` | Le [chiavi API personali](/docs/backend/api-keys/#personal-keys) del chiamante |
| `POST` | `/api/auth/keys` | Crea una chiave personale. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella users non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revoca una delle chiavi del chiamante |
| `GET` | `/.well-known/jwks.json` | Il JWKS pubblico — montato nella root, non sotto `basePath`, perché è lì che un verificatore cerca. Montato ogni volta che il backend genera i propri token; un set di chiavi vuoto finché non viene configurata la [firma asimmetrica](#token-asimmetrici-e-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Avvia la registrazione TOTP (restituisce il segreto e i codici di recupero) |
| `POST` | `/api/auth/mfa/verify` | Conferma una registrazione con un codice dall'autenticatore |
| `GET` | `/api/auth/mfa/factors` | Elenca i fattori registrati del chiamante |
| `POST` | `/api/auth/mfa/challenge` | Apre una challenge (sfida) contro un fattore verificato |
| `POST` | `/api/auth/mfa/challenge/verify` | Risponde a una challenge — questo è ciò che rilascia la sessione |
| `DELETE` | `/api/auth/mfa/unenroll` | Rimuove un fattore (richiede una sessione `aal2` una volta che l'account ha un fattore verificato) |
| `POST` | `/api/auth/mfa/recovery-codes` | Sostituisce i codici di recupero del chiamante con dieci nuovi codici (richiede una sessione `aal2`) |

La gestione amministrativa di utenti e ruoli è una **superficie separata**, montata su
`/api/admin/` anziché `/api/auth/`. La lettura richiede lo scope `users:read` e
la modifica richiede `users:write`, a eccezione della lettura ristretta dello user picker riportata di seguito. Un amministratore e la service key detengono entrambi; lo stesso vale per un
ruolo che li dichiara. Nessuno può modificare un account che detiene più permessi di quelli che possiede.
Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Elenca gli utenti (con paginazione). `?search=` individua una corrispondenza senza distinzione tra maiuscole e minuscole nell'email o nel nome visualizzato (display name). Corrisponde anche a qualsiasi ruolo detenuto dall'utente e all'uid |
| `GET` | `/api/admin/users/pick` | La lettura per lo user picker: `uid`, `displayName`, `email` e `photoURL` per utente, nient'altro. Accetta `?search=`, `?limit=` (25 per impostazione predefinita) e `?offset=`, oppure `?ids=a,b` per gli utenti indicati da un valore memorizzato. Risponde a `users:read`, e anche a chiunque possa scrivere in una collection con un campo [`userSelect`](/docs/collections/properties/) — consentendo a un editor di compilarne uno. Una regola scritta come SQL grezzo (`using` / `withCheck` che il modello di policy non può interpretare) non può essere valutata a priori, quindi viene considerata come un rifiuto: su tale collection solo i possessori di `users:read` possono effettuare la selezione. Chiunque altro riceve `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Crea un utente. `invite: false` senza `password` lo crea privo di password e non invia nulla |
| `POST` | `/api/admin/users/import` | Importa account da un altro sistema, mantenendo i loro ID. Vedi [Importazione degli account](#importazione-degli-account) |
| `GET` | `/api/admin/users/:uid` | Legge un singolo utente |
| `PUT` | `/api/admin/users/:uid` | Aggiorna un utente. `{ disabled: true }` disattiva l'account senza eliminarlo: ogni accesso e aggiornamento viene rifiutato (`ACCOUNT_DISABLED`), le sue sessioni terminano e ogni token in suo possesso viene rifiutato; `false` lo riattiva |
| `DELETE` | `/api/admin/users/:uid` | Elimina un utente. Le sue sessioni terminano e ogni access token in suo possesso viene rifiutato a partire da quella richiesta |
| `POST` | `/api/admin/users/:uid/reset-password` | Reimposta la password di un utente senza richiedere quella corrente. `rebase auth reset-password` lo richiama, e scrive direttamente nel database solo quando il backend non è raggiungibile; in entrambi i casi le sessioni dell'account vengono terminate |
| `DELETE` | `/api/admin/users/:uid/mfa` | Rimuove i secondi fattori e i codici di recupero di un utente e termina le sue sessioni — per chi ha perso entrambi |
| `GET` | `/api/admin/roles` | `admin` e i ruoli dichiarati dalla tabella users, con i relativi scope |
| `POST` | `/api/admin/bootstrap` | Consente al primo utente registrato di reclamare il ruolo di amministratore finché non ne esiste alcuno. Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |

Tutti gli endpoint delle API dati richiedono un header `Authorization: Bearer <token>` valido quando `requireAuth: true` (impostazione predefinita).

### Importazione degli account

`POST /api/admin/users/import` crea account già esistenti in un altro sistema, mantenendo gli ID che avevano lì, in modo che ogni riga che ne cita uno faccia ancora riferimento allo stesso account. Richiede `users:write`, come `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

- **`id`** viene mantenuto ed è opzionale. Un uuid è il caso più comune; qualsiasi id composto da lettere, cifre e `_ - . : |`, che inizi con una lettera o una cifra, fino a 128 caratteri, è valido (ID di Firebase, Auth0, Clerk). `service`, `anonymous`, `anon` e `default` vengono rifiutati, così come qualsiasi altra cosa: `400 INVALID_ID` per quell'account. Una tabella users la cui colonna `id` è un `uuid` accetta solo uuid.
- **`email`** è obbligatoria. `displayName`, `photoUrl`, `createdAt` (ISO 8601) e `roles` sono opzionali; `emailVerified` è `false` se non specificato. Un account non verificato viene confermato dal primo magic link o link di reset che segue, e fino a quel momento non consente l'accesso tramite un provider.
- **Nessuna password, nessuna email.** Un campo `password` o `passwordHash` fa fallire quell'account e non viene inviato nulla via email. L'account accede tramite magic link, codice email, provider o reimpostazione della password.
- **Nulla viene aggiornato.** Un account il cui ID è già occupato viene impostato come `skipped` con `ID_EXISTS`, uno la cui email è occupata con `EMAIL_EXISTS` (incluso un account precedente nella stessa richiesta). Eseguire la stessa importazione due volte è sicuro.
- **Nessun ruolo superiore a quello del chiamante**, come per `POST /api/admin/users`, e `beforeUserCreate` viene eseguito per ciascun account e può rifiutarlo.
- **Al massimo 100 account per richiesta** (`400 TOO_MANY_USERS` se superiore). `dryRun: true` esegue tutti i controlli senza scrivere nulla.

La risposta è `200` con un esito per ciascun account, in ordine:

```json
{
  "dryRun": false, "created": 1, "skipped": 1, "failed": 1,
  "results": [
    { "index": 0, "status": "created", "uid": "5b0a3c9e-…", "email": "ada@example.com" },
    { "index": 1, "status": "skipped", "uid": "…", "email": "bob@example.com", "code": "EMAIL_EXISTS", "message": "…" },
    { "index": 2, "status": "failed", "email": "eve@example.com", "code": "INVALID_ID", "message": "…" }
  ]
}
```

`rebase users import <file>` invia un file CSV o JSON in questo modo, 100 account alla volta, e `client.admin.importUsers(users, { dryRun })` è la chiamata dell'SDK.

### Criteri per le password

Una nuova password richiede almeno 8 caratteri, con una lettera maiuscola, una lettera minuscola e una cifra. La registrazione, il reset e la modifica rifiutano una password non conforme con `400 WEAK_PASSWORD`, elencando ogni regola violata; lo stesso vale per un amministratore che sceglie una password: `POST /api/admin/users`, una creazione sulla tabella users tramite l'API dati (`POST /api/data/users`, il suo endpoint `/bulk`, una scrittura socket o MCP), `PUT /api/admin/users/:uid` e `POST /api/admin/users/:uid/reset-password`. Su un endpoint `/bulk`, il messaggio inizia con `Row <n>: ` (contando da 0), analogamente agli altri errori di riga delle operazioni bulk.

Per creare account le cui password sono state impostate da un altro sistema, come in un'importazione, invia `skipPasswordPolicy: true` nel corpo della creazione (su ciascuna riga di un `/bulk`). Il server lo rispetta solo per un amministratore o per la service key; per chiunque altro non concede alcuna deroga e il messaggio di rifiuto lo specifica. Non viene mai memorizzato. L'importazione del pannello di amministrazione lo invia per ogni riga contenente una `password`. L'accesso non verifica mai i criteri, quindi una vecchia password continuerà a funzionare. Per definire le tue regole, passa `auth.hooks.validatePasswordStrength` da un backend [espulso (ejected)](/docs/backend/authentication/#configuration). Il primo amministratore generato da `REBASE_ADMIN_PASSWORD` segue una regola diversa: almeno 12 caratteri, e nient'altro.

### Formato della risposta

Ogni endpoint che emette una sessione risponde con lo stesso envelope — `register`, `login`, ciascun provider OAuth, `magic-link/verify`, `otp/verify`, `anonymous`, `anonymous/link` e `mfa/challenge/verify`:

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

Invia l'access token nell'header `Authorization: Bearer <accessToken>`. `accessTokenExpiresAt` è espresso in millisecondi epoch.

`POST /api/auth/refresh` risponde con lo stesso envelope, eccetto per il fatto che `user` viene interamente omesso quando l'account non può essere riletto; consideralo quindi opzionale in questo caso.

`providerId` indica come è stato effettuato l'accesso alla sessione: `password`, `anonymous`, `magic-link`, `otp`, `mfa` (un accesso completato con un secondo fattore), o l'ID del provider, come `google`. Viene memorizzato con la sessione al momento dell'accesso, quindi `refresh` e `GET /api/auth/me` restituiscono la stessa risposta per tutta la durata della sessione. Una sessione avviata prima della versione 0.24 riporta `password`.

:::caution[L'SDK tipizzato appiattisce questo envelope — HTTP raw non lo fa]
Il JSON sopra riportato è il formato wire (di rete), ed è ciò che `fetch("/api/auth/login")` restituisce: il token si trova in **`body.tokens.accessToken`**.

L'[SDK tipizzato](/docs/sdk/authentication) estrae `tokens` prima di restituire la sessione, quindi `auth.signInWithEmail()` si risolve invece in una struttura appiattita **`{ user, accessToken, refreshToken }`**.

Entrambe le strutture sono reali; appartengono a due livelli differenti. Leggere la struttura dell'SDK da una `fetch` grezza restituisce `undefined`, manifestandosi come "l'accesso è riuscito ma non c'è alcun token di accesso" — l'accesso è andato a buon fine, il token si trovava solo a un livello inferiore.
:::

### Modifica di un indirizzo email

Un utente autenticato sposta il proprio account su un altro indirizzo in due passaggi:

1. `POST /api/auth/change-email { newEmail }` registra la modifica e invia un link, `<frontend>/confirm-email-change?token=…`, al nuovo indirizzo, nonché una notifica priva di link a quello attuale. Il link è valido per 24 ore e una nuova richiesta sostituisce la precedente. `GET /api/auth/me` segnala l'indirizzo in attesa come `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` sposta l'account: il nuovo indirizzo diventa il suo indirizzo, verificato. Ogni identità OAuth il cui provider garantiva per il vecchio indirizzo viene scollegata (`removedProviders` le elenca), poiché chiunque controlli il vecchio indirizzo potrebbe altrimenti continuare ad accedere tramite di esso, e qualsiasi link di ripristino inviato al vecchio indirizzo smette di funzionare. Le sessioni vengono mantenute.

Il nuovo indirizzo non viene riservato mentre il link è in attesa: bloccarlo permetterebbe a qualsiasi account di impedire a un estraneo di registrarsi con il proprio indirizzo. Se un altro account occupa l'indirizzo prima che il link venga seguito, il link risponde con `409 EMAIL_EXISTS` e nulla viene spostato; tra due account che richiedono lo stesso indirizzo, il primo a seguire il link lo ottiene. L'hook `beforeEmailChange` può rifiutare un indirizzo, così come fa `beforeUserCreate` al momento della registrazione.

Nel CMS, l'indirizzo viene modificato da **Impostazioni account → Profilo**, e il link apre la schermata specifica del CMS, con o senza sessione attiva. Un altro frontend gestisce una pagina su `/confirm-email-change` che richiama la route con il token del link.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) attivo (impostazione predefinita), il refresh token viaggia come cookie `httpOnly` e `tokens.refreshToken` è una stringa vuota nel corpo della risposta. L'access token non ne risente.

### Autenticazione a più fattori (TOTP)

**Un secondo fattore vincola l'accesso, non solo le singole operazioni.** Quando un account ha un fattore TOTP *verificato*, nessuna route emette una sessione finché non viene presentato un codice — l'accesso tramite password, ogni provider OAuth, magic link, codice email e anonymous-link rifiutano la richiesta con `401 MFA_REQUIRED`:

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

`mfaToken` **non è una sessione**: ha un ambito limitato allo scopo (purpose-scoped), scade in cinque minuti e viene rifiutato da ogni route autenticata. Invialo come bearer token a `POST /api/auth/mfa/challenge` (con un `factorId`) e poi a `POST /api/auth/mfa/challenge/verify` (con il `challengeId` e il codice a sei cifre, o un codice di recupero). Quest'ultima chiamata è ciò che genera i token di accesso e di aggiornamento, a livello `aal2`; il livello viene memorizzato nella sessione e mantenuto durante `POST /api/auth/refresh`.

Anche la registrazione dei fattori è protetta. Il primo fattore di un account può essere registrato da una sessione ordinaria, ma una volta verificatone uno, `enroll`, `verify` e `unenroll` richiedono tutti una sessione `aal2` — altrimenti una password rubata consentirebbe di registrare un nuovo fattore, aumentare i privilegi (step-up) ed eliminare quello legittimo.

La verifica è limitata su entrambi gli assi: una challenge decade dopo cinque tentativi falliti, ciascun account è limitato a dieci tentativi di verifica ogni 15 minuti (conteggiati per utente, quindi ruotare gli IP non serve), e un codice accettato viene registrato a fronte del fattore per evitare che possa essere riutilizzato per il resto della sua finestra di validità di ±1 intervallo.

Nella tabella utenti del CMS, **Reimposta la verifica in due passaggi** (`DELETE /api/admin/users/:uid/mfa`) e **Disabilita o abilita account** (`PUT /api/admin/users/:uid { disabled }`) sono disponibili per chiunque detenga lo scope `users:write`, analogamente alle route; l'opzione non è mai consentita sul proprio account, e la modifica di un account di rango superiore viene rifiutata con la motivazione del server.

Imposta `MFA_ENCRYPTION_KEY` (almeno 32 caratteri casuali) per crittografare i segreti TOTP memorizzati. Senza di essa, il server ripiega su `JWT_SECRET` e genera un avviso. Impostala **prima** che chiunque effettui la registrazione: i segreti memorizzati non includono alcun ID della chiave, pertanto modificare la chiave successivamente renderà i fattori esistenti indecifrabili e impedirà ai rispettivi proprietari di completare una challenge.

### Invito di colleghi via email

I flussi di invito richiedono di convertire un indirizzo email in un ID utente, ma la tabella `users` è protetta da RLS dal lato client. Anziché implementare manualmente una funzione server di amministrazione, puoi abilitare la ricerca integrata:

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

L'endpoint è **solo per utenti autenticati** e restituisce solo `uid`, `displayName` e `photoURL` — mai l'email, i ruoli o i metadati dell'utente cercato. È **disattivato per impostazione predefinita** perché consente a qualsiasi utente autenticato di verificare quali email dispongono di un account; abilitalo solo quando l'esperienza utente di invito lo richiede.

## Contesto del database per la Row-Level Security (RLS)

Rebase collega l'autenticazione delle richieste direttamente alla Row-Level Security (RLS) di PostgreSQL. Ogni query al database eseguita tramite un driver con ambito utente viene eseguita all'interno di una transazione di database (`db.transaction()`) che imposta parametri di configurazione locali alla transazione:

*   `app.uid` — L'ID univoco (`uid`) dell'utente autenticato. Il valore predefinito è `'anonymous'` per le richieste non autenticate. Il vecchio parametro pre-rinomina `app.user_id` viene ancora impostato contestualmente, per le policy compilate prima della rinomina.
*   `app.user_roles` — Una stringa separata da virgole che elenca i ruoli assegnati all'utente.
*   `app.is_anonymous` — `'true'` per una sessione guest (accesso anonimo), `'false'` altrimenti.
*   `app.jwt` — Una stringa JSON con i claim personalizzati del token più `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

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
*   **`rebase.roles()`** — Restituisce la stringa di ruoli separati da virgole:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Restituisce il payload JWT completo come oggetto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indica se il chiamante è un guest, come `boolean` (`false` se non impostato), in modo che una policy possa definire `NOT rebase.is_anonymous()`.

Puoi utilizzare questi helper direttamente nelle tue regole di sicurezza personalizzate o nelle migrazioni del database:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Token asimmetrici e JWKS

Per impostazione predefinita, gli access token sono firmati con `jwtSecret` (HS256). Questo funziona, ma significa che qualsiasi componente che debba *verificare* un token deve possedere la chiave che lo *genera* — pertanto un gateway o un edge worker che controlla una sessione può anche falsificarne uno — e cambiare il segreto disconnette tutti gli utenti contemporaneamente.

Configura una chiave di firma e Rebase firmerà gli access token in modo asimmetrico, pubblicando la metà pubblica su **`/.well-known/jwks.json`** affinché chiunque possa verificarli:

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

Funzionano anche le chiavi RSA, che firmano con `RS256`; le chiavi EC P-256 firmano con `ES256`. Viene configurata solo la chiave privata — la metà pubblica viene derivata da essa, evitando così qualsiasi disallineamento della coppia. `jwtSecret` rimane comunque obbligatorio in entrambi i casi: firma tuttora i token limitati allo scopo (link di download, stato MFA in sospeso, reimpostazione della password) che solo questo server legge.

### Rotazione di una chiave

Posiziona la nuova chiave per prima e mantieni elencata quella precedente. I nuovi token vengono firmati dalla nuova chiave; i token già in circolazione continuano a essere verificati con quella precedente fino alla loro scadenza, evitando che gli utenti vengano disconnessi.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una volta trascorso il ciclo di vita massimo dell'access token, elimina la voce obsoleta. Usa `activeKid` se desideri pubblicare una chiave prima di utilizzarla per firmare.

### Verifica su altri sistemi

I token contengono il `kid` della chiave di firma nel loro header: in questo modo il verificatore seleziona la chiave corretta dal JWKS e sa quando recuperarla nuovamente dopo una rotazione. Qualsiasi libreria standard gestisce questo meccanismo automaticamente — per esempio, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Se non viene configurato `signingKeys`, `/.well-known/jwks.json` risponde
con `{"keys":[]}` e i token rimangono HS256. Nulla cambia finché non viene aggiunta una chiave.
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

### Chiave interna generata a ogni avvio

Se `REBASE_SERVICE_KEY` non è fornita nella configurazione, Rebase genera automaticamente una **chiave interna casuale a ogni avvio**. 

Questa chiave non viene mai registrata nei log e non lascia mai il processo. Viene utilizzata dal singleton `rebase` per autenticarsi presso le API del control plane del server stesso (auth, storage, ecc.). Ciò assicura che le attività amministrative (come l'invio di un'email di benvenuto o la generazione di un URL di storage) funzionino sempre fin da subito, sia in sviluppo che in produzione, senza richiedere la gestione manuale delle chiavi.

### Protezione dai timing attack e requisiti della chiave

Per prevenire i timing attack (attacchi basati sui tempi di risposta), Rebase convalida sia la service key configurata dall'utente sia la chiave interna utilizzando un confronto di stringhe a tempo costante (`safeCompare`). La service key configurata dall'utente **deve contenere almeno 32 caratteri**; se viene configurata una chiave con meno di 32 caratteri, Rebase genererà un errore di configurazione all'avvio e adotterà una strategia fail-closed.

## Passaggi successivi

- **[Autenticazione](/docs/backend/authentication/)** — la configurazione da cui derivano queste route
- **[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters/)** — sostituzione del provider sottostante
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — cosa fa una policy con `rebase.uid()`
- **[Autenticazione con l'SDK tipizzato](/docs/sdk/authentication/)** — chiamata a queste route dall'SDK
