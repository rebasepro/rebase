---
sourceHash: 6d4a5f8b72b38f97
title: Endpoint di autenticazione e token
sidebar_label: Endpoint di autenticazione
description: Le route di autenticazione montate dal backend Rebase, la struttura delle loro risposte, l'autenticazione a più fattori, il contesto del database visualizzato da una policy, JWKS e chiavi di servizio.
---

Le route montate [dal blocco `auth`](/docs/backend/authentication/) e i token restituiti.

## Auth Endpoints

Tutti gli endpoint di autenticazione sono montati su `/api/auth/`:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crea un nuovo account |
| `POST` | `/api/auth/login` | Accedi con email/password |
| `POST` | `/api/auth/refresh` | Esegui il refresh dell'access token |
| `POST` | `/api/auth/<provider>` | Accesso OAuth (es. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Collega un provider OAuth all'account autenticato. Per un guest si tratta di registrazione: richiede `allowRegistration`, acquisisce l'indirizzo del provider quando quest'ultimo lo convalida e risponde con una sessione per l'account in cui il guest si è trasformato |
| `POST` | `/api/auth/logout` | Revoca il refresh token |
| `POST` | `/api/auth/forgot-password` | Invia l'email per il ripristino della password |
| `POST` | `/api/auth/reset-password` | Reimposta la password con il token |
| `POST` | `/api/auth/find-user` | Risolvi un'email in un profilo pubblico minimale (opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifica la password del chiamante stesso (autenticato). Termina tutte le altre sessioni e risponde con una nuova sessione per il chiamante |
| `GET` | `/api/auth/me` | Il profilo del chiamante stesso |
| `PATCH` | `/api/auth/me` | Aggiorna il profilo del chiamante stesso |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: sposta l'account del chiamante stesso verso un altro indirizzo. Invia un link per email al nuovo indirizzo e una notifica al vecchio; nulla cambia finché non viene seguito il link. Richiede `aal2` su un account con un secondo fattore. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` per un guest — vedi [Modifica di un indirizzo email](#modifica-di-un-indirizzo-email) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` dal link. Nessuna sessione necessaria. Sposta l'account sul nuovo indirizzo, verificato; `400 INVALID_TOKEN` per un link già utilizzato, sostituito o scaduto, `409 EMAIL_EXISTS` quando l'indirizzo è stato occupato durante l'attesa |
| `GET` | `/api/auth/config` | Cosa offre questo backend a una schermata di accesso — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, che indica se il backend gestisce lo storage di file. Non autenticato e calcolato a partire dagli stessi predicati applicati dalle route, affinché ciò che la schermata presenta non possa divergere da ciò che può effettivamente fare |
| `POST` | `/api/auth/send-verification` | Invia al chiamante un link di verifica email |
| `GET` | `/api/auth/verify-email` | Utilizza un link di verifica (l'URL contenuto nell'email). Conserva ciò che una sessione attiva dell'account attesta e rimuove ciò che nessuno ha attestato — vedi [Verifica email](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo stesso con `{ token, password?, removeUnproven? }`: la password lo mantiene ed effettua l'accesso; senza alcuna prova, un account che ne possiede una risponde con `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Invia tramite email un link di accesso monouso. `503 EMAIL_NOT_CONFIGURED` senza SMTP |
| `POST` | `/api/auth/magic-link/verify` | Scambia un token magic link con una sessione |
| `POST` | `/api/auth/otp` | Invia tramite email un codice di accesso a sei cifre. Risponde allo stesso modo indipendentemente dal fatto che l'indirizzo sia associato o meno a un account |
| `POST` | `/api/auth/otp/verify` | Scambia `{ email, code }` con una sessione |
| `POST` | `/api/auth/anonymous` | Crea una sessione anonima (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Collega credenziali reali all'account anonimo già autenticato. Richiede sia `allowAnonymous` che le registrazioni aperte: `403 ANONYMOUS_AUTH_DISABLED` se l'accesso anonimo è disattivato, inclusi i guest autenticati in precedenza, e `403 REGISTRATION_DISABLED` mentre la registrazione è chiusa |
| `GET` | `/api/auth/sessions` | Elenca le sessioni attive del chiamante, una per ciascun accesso. Quella corrente del chiamante è contrassegnata con `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revoca ogni sessione, inclusa quella corrente — logout remoto su ogni dispositivo |
| `DELETE` | `/api/auth/sessions/:id` | Revoca una sessione: il suo refresh token e l'access token detenuto da quel dispositivo |
| `GET` | `/api/auth/scopes` | Tutti gli [scope](/docs/backend/roles-and-scopes/) noti a questo backend e quelli detenuti dal chiamante |
| `GET` | `/api/auth/keys` | Le [chiavi API personali](/docs/backend/api-keys/#personal-keys) del chiamante stesso |
| `POST` | `/api/auth/keys` | Crea una chiave personale. `403 PERSONAL_KEYS_DISABLED` a meno che la tabella users non imposti `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revoca una delle chiavi del chiamante stesso |
| `GET` | `/.well-known/jwks.json` | Il JWKS pubblico — montato alla radice, non sotto `basePath`, perché è lì che un verificatore effettua la ricerca. Montato ogni volta che il backend emette i propri token; un set di chiavi vuoto fino a quando non viene configurata la [firma asimmetrica](#token-asimmetrici-e-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Avvia la registrazione (enrolment) TOTP (restituisce il segreto e i codici di recupero) |
| `POST` | `/api/auth/mfa/verify` | Conferma una registrazione con un codice dall'autenticatore |
| `GET` | `/api/auth/mfa/factors` | Elenca i fattori registrati dal chiamante |
| `POST` | `/api/auth/mfa/challenge` | Apre una verifica (challenge) su un fattore verificato |
| `POST` | `/api/auth/mfa/challenge/verify` | Risponde a una challenge — questa operazione emette la sessione |
| `DELETE` | `/api/auth/mfa/unenroll` | Rimuove un fattore (richiede una sessione `aal2` se l'account ha un fattore verificato) |
| `POST` | `/api/auth/mfa/recovery-codes` | Sostituisce i codici di recupero del chiamante con dieci nuovi codici (richiede una sessione `aal2`) |

La gestione amministrativa di utenti e ruoli è una **superficie separata**, montata su
`/api/admin/` anziché su `/api/auth/`. La lettura richiede lo scope `users:read` e
la modifica richiede `users:write`, ad eccezione della lettura ristretta dello user picker riportata di seguito. Un amministratore e la service key detengono entrambi gli scope; lo stesso vale per un
ruolo che li dichiara. Nessuno può modificare un account che detiene più permessi di quanti ne detenga
l'utente stesso. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Elenca gli utenti (con paginazione). `?search=` confronta in modo non sensibile alle maiuscole/minuscole parte dell'email o del display name. Trova corrispondenza anche con qualsiasi ruolo detenuto dall'utente e con l'uid |
| `GET` | `/api/admin/users/pick` | La lettura dello user picker: `uid`, `displayName`, `email` e `photoURL` per ciascun utente, nient'altro. Accetta `?search=`, `?limit=` (25 per impostazione predefinita) e `?offset=`, oppure `?ids=a,b` per gli utenti indicati da un valore memorizzato. Risponde a `users:read` e anche a chiunque possa scrivere in una collection con un campo [`userSelect`](/docs/collections/properties/) — consentendo così a un editor di compilarlo. Una regola scritta come SQL grezzo (`using` / `withCheck` che il modello di policy non è in grado di leggere) non può essere valutata preventivamente, pertanto viene considerata come rifiutata: su tale collection solo i possessori di `users:read` possono effettuare selezioni. Chiunque altro riceve `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Crea un utente. `invite: false` senza `password` lo crea senza password e non invia nulla |
| `POST` | `/api/admin/users/import` | Importa account da un altro sistema, conservando i relativi ID. Vedi [Importazione degli account](#importazione-degli-account) |
| `GET` | `/api/admin/users/:uid` | Legge un utente |
| `PUT` | `/api/admin/users/:uid` | Aggiorna un utente. `{ disabled: true }` disattiva l'account senza eliminarlo: ogni accesso e refresh viene rifiutato (`ACCOUNT_DISABLED`), le sue sessioni vengono terminate e ogni token in suo possesso viene rifiutato; `false` lo riattiva |
| `DELETE` | `/api/admin/users/:uid` | Elimina un utente. Le sue sessioni vengono terminate e qualsiasi access token in suo possesso viene rifiutato da quella richiesta in poi |
| `POST` | `/api/admin/users/:uid/reset-password` | Reimposta la password di un utente senza richiedere quella attuale. `rebase auth reset-password` effettua questa chiamata e scrive direttamente sul database solo quando il backend non è raggiungibile; in entrambi i casi le sessioni dell'account vengono terminate |
| `DELETE` | `/api/admin/users/:uid/mfa` | Rimuove i secondi fattori e i codici di recupero di un utente e termina le sue sessioni — per chi ha perso entrambi |
| `GET` | `/api/admin/roles` | `admin` e i ruoli dichiarati dalla tabella degli utenti, con i rispettivi scope |
| `POST` | `/api/admin/bootstrap` | Consente al primo utente registrato di richiedere il ruolo di admin se non ne esiste ancora nessuno. Rifiutato in produzione — vedi [Bootstrap del primo utente](/docs/backend/authentication/#first-user-bootstrap) |

Tutti gli endpoint delle API dati richiedono un header `Authorization: Bearer <token>` valido quando `requireAuth: true` (valore predefinito).

### Importazione degli account

`POST /api/admin/users/import` crea account che esistono già in un altro
sistema, mantenendo gli ID che avevano lì, in modo che ogni riga che ne cita uno
faccia ancora riferimento allo stesso account. Richiede `users:write`, proprio come `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

Con hash delle password:

```json
{
  "passwordHashAlgorithm": "bcrypt",
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "emailVerified": true,
      "passwordHash": "$2a$10$…" }
  ]
}
```

- **`id`** viene mantenuto ed è opzionale. Un UUID è il caso più comune;
  va bene anche qualsiasi ID composto da lettere, cifre e `_ - . : |`,
  che inizi con una lettera o una cifra, fino a 128 caratteri (ID Firebase,
  Auth0, Clerk). `service`, `anonymous`, `anon` e `default` vengono rifiutati,
  così come qualsiasi altro valore non conforme: `400 INVALID_ID` per quell'account.
  Una tabella users la cui colonna `id` è un `uuid` accetta solo UUID.
- **`email`** è obbligatoria. `displayName`, `photoUrl`, `createdAt` (ISO 8601) e
  `roles` sono opzionali; `emailVerified` è `false` a meno che non sia specificato
  diversamente. Un account non verificato viene confermato dal primo magic link o link
  di reset che segue, e fino ad allora non consente l'accesso tramite provider.
- **Nessuna email e nessuna password a meno che non si fornisca l'hash.** Non viene
  inviato nulla per posta elettronica. Un campo `password` fa fallire l'importazione
  di quell'account. Un account privo di `passwordHash` effettua l'accesso tramite
  magic link, codice email, provider o reimpostazione della password.
- **`passwordHash`** è l'hash memorizzato dall'altro sistema, accettato solo se
  la richiesta specifica il relativo formato in `passwordHashAlgorithm`. Attualmente
  è `"bcrypt"` (`$2a$`, `$2b$` o `$2y$`): ciò che Supabase conserva in
  `auth.users.encrypted_password` e ciò che memorizzano Auth0, Clerk e la maggior parte
  delle applicazioni Rails, Laravel e Django-bcrypt. L'account accede quindi con la
  password che già possedeva e il suo primo accesso sostituisce l'hash con lo scrypt
  proprietario di Rebase, senza terminare le altre sessioni. Un hash privo di
  `passwordHashAlgorithm`, o in un formato differente, fa fallire quell'account
  (`INVALID_INPUT`, `INVALID_PASSWORD_HASH`); l'hash non viene mai restituito.
  Un progetto con i propri hook `hashPassword` o `verifyPassword` mantiene l'hash
  così come importato e il relativo `verifyPassword` stabilisce cosa accettare.
- **Nulla viene aggiornato.** Un account il cui ID è già occupato viene ignorato
  (`skipped`) con `ID_EXISTS`, e uno la cui email è già occupata con `EMAIL_EXISTS`
  (incluso un account comparso prima nella stessa richiesta). Eseguire la stessa
  importazione due volte è sicuro.
- **Nessun ruolo superiore a quello del chiamante stesso**, come per `POST /api/admin/users`,
  e `beforeUserCreate` viene eseguito per ogni account e può rifiutarlo.
- **Al massimo 100 account per richiesta** (`400 TOO_MANY_USERS` se superato).
  `dryRun: true` esegue tutti i controlli senza scrivere nulla.

La risposta è `200` con un esito per account, in ordine:

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

`rebase users import <file>` invia un file CSV o JSON in questo modo, 100 account
alla volta, e `client.admin.importUsers(users, { dryRun })` è la chiamata corrispondente nell'SDK.

### Password policy

Una nuova password deve contenere almeno 8 caratteri, con una lettera maiuscola, una
lettera minuscola e una cifra. La registrazione, il reset e la modifica rifiutano una
password che non rispetti tali requisiti con `400 WEAK_PASSWORD`, elencando ciascuna
regola violata; lo stesso accade se è un amministratore a scegliere una password:
`POST /api/admin/users`, una creazione sulla tabella users tramite l'API dati
(`POST /api/data/users`, il rispettivo `/bulk`, una scrittura via socket o MCP),
`PUT /api/admin/users/:uid` e `POST /api/admin/users/:uid/reset-password`. Su un
`/bulk`, il messaggio inizia con `Row <n>: ` (conteggiato a partire da 0), come per
gli altri errori di riga del bulk.

Per creare account le cui password sono state impostate da un altro sistema, come nel
caso di un'importazione, invia `skipPasswordPolicy: true` nel corpo di creazione (su
ogni riga di un `/bulk`). Il server lo rispetta solo per un amministratore o per la
service key; per chiunque altro non applica deroghe e il messaggio di rifiuto lo
specifica. Non viene mai memorizzato. L'importazione del pannello di amministrazione
lo invia per ogni riga che contiene una `password`. L'accesso non verifica mai la
policy, quindi le password precedenti continuano a funzionare. Per impostare regole
personalizzate, passa `auth.hooks.validatePasswordStrength` da un backend [espulso (ejected)](/docs/backend/authentication/#configuration).
Il primo admin inizializzato da `REBASE_ADMIN_PASSWORD` è soggetto a una regola diversa:
almeno 12 caratteri e nient'altro.

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

Invia l'access token nell'header come `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` è espresso in millisecondi epoch.

`POST /api/auth/refresh` risponde con lo stesso envelope, tranne per il fatto che `user`
viene omesso completamente quando l'account non può essere riletto; pertanto, consideralo
opzionale in questo caso.

`providerId` indica la modalità con cui è stato effettuato l'accesso alla sessione: `password`,
`anonymous`, `magic-link`, `otp`, `mfa` (un accesso completato con un secondo fattore) o
l'ID del provider, come `google`. Viene memorizzato insieme alla sessione al momento dell'accesso,
quindi `refresh` e `GET /api/auth/me` restituiscono la stessa risposta per tutta la durata
della sessione. Una sessione avviata prima della versione 0.24 riporta `password`.

:::caution[L'SDK tipizzato appiattisce questo envelope — l'HTTP non elaborato no]
Il JSON precedente rappresenta il formato wire (sul canale di trasmissione) ed è ciò che
restituisce `fetch("/api/auth/login")`: il token si trova in **`body.tokens.accessToken`**.

L'[SDK tipizzato](/docs/sdk/authentication) estrae `tokens` prima di restituire la
sessione, quindi `auth.signInWithEmail()` si risolve invece in una struttura appiattita
**`{ user, accessToken, refreshToken }`**.

Entrambe le strutture sono reali; appartengono a due livelli diversi. Tentare di leggere la
struttura dell'SDK da una chiamata `fetch` diretta restituirà `undefined`, manifestandosi
come "login riuscito ma non c'è alcun token di accesso" — l'accesso è andato a buon fine,
ma il token si trovava a un livello inferiore.
:::

### Modifica di un indirizzo email

Un utente autenticato
può spostare il proprio account su un altro indirizzo in due passaggi:

1. `POST /api/auth/change-email { newEmail }` registra la modifica e invia tramite
   email un link, `<frontend>/confirm-email-change?token=…`, al nuovo indirizzo,
   nonché una notifica priva di link a quello attuale. Il link è valido per 24 ore
   e una nuova richiesta sostituisce la precedente. `GET /api/auth/me` segnala
   l'indirizzo in attesa come `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` sposta l'account: il nuovo
   indirizzo diventa il suo indirizzo ufficiale, verificato. Ogni identità OAuth il cui
   provider garantiva per il vecchio indirizzo viene scollegata (`removedProviders`
   ne riporta i nomi), poiché chiunque controlli il vecchio indirizzo potrebbe altrimenti
   continuare ad accedere tramite di esso, e qualsiasi link di ripristino inviato al
   vecchio indirizzo smette di funzionare. Le sessioni vengono mantenute.

Il nuovo indirizzo non viene riservato durante l'attesa del link: riservarlo consentirebbe
a qualsiasi account di impedire a un estraneo di registrarsi con il proprio indirizzo.
Se un altro account ha già occupato l'indirizzo nel momento in cui il link viene seguito,
il link risponde con `409 EMAIL_EXISTS` e non viene apportata alcuna modifica; tra due account
che richiedono lo stesso indirizzo, il primo a seguire il relativo link lo ottiene. L'hook
`beforeEmailChange` può rifiutare un indirizzo, esattamente come fa `beforeUserCreate`
durante la registrazione.

Nel CMS, l'indirizzo viene modificato da **Impostazioni account → Profilo**, e il
link apre la schermata specifica del CMS, con o senza sessione attiva. Un frontend diverso
può gestire una pagina all'indirizzo `/confirm-email-change` che chiama la route con il
token del link.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) attivo
(impostazione predefinita), il refresh token viaggia come cookie `httpOnly` e
`tokens.refreshToken` è una stringa vuota nel corpo della risposta. L'access token non subisce variazioni.

### Autenticazione a più fattori (TOTP)

**Un secondo fattore protegge l'accesso nel suo complesso, non solo le singole operazioni.**
Una volta che un account dispone di un fattore TOTP *verificato*, nessuna route emette una
sessione per quell'account finché non viene presentato un codice — l'accesso tramite password,
ogni provider OAuth, magic link, codice email e anonymous-link rifiutano la richiesta
restituendo `401 MFA_REQUIRED`:

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

`mfaToken` **non è una sessione**: ha un ambito limitato allo scopo (purpose-scoped),
scade dopo cinque minuti e viene rifiutato da ogni route autenticata. Invialo come bearer token
a `POST /api/auth/mfa/challenge` (con un `factorId`) e successivamente a
`POST /api/auth/mfa/challenge/verify` (con il `challengeId` e il codice a sei cifre, o un
codice di recupero). È quest'ultima chiamata che genera l'access token e il refresh token, a
livello `aal2`; questo livello viene memorizzato nella sessione e mantenuto anche durante
`POST /api/auth/refresh`.

Anche l'abilitazione (enrolment) è protetta. Il primo fattore su un account può essere configurato
a partire da una sessione ordinaria, ma una volta verificato, le operazioni `enroll`, `verify`
e `unenroll` richiedono tutte una sessione `aal2` — altrimenti una password rubata potrebbe
consentire di registrare un proprio fattore, effettuare l'escalation con esso ed eliminare
quello reale.

La verifica è limitata su entrambi gli assi: una challenge decade dopo cinque tentativi errati,
ogni account è limitato a dieci tentativi di verifica ogni 15 minuti (conteggiati per utente,
quindi la rotazione degli IP non aiuta) e un codice accettato viene registrato a fronte del
fattore per impedire che possa essere riutilizzato per il resto della sua finestra di tolleranza
di ±1 intervallo.

Nella tabella degli utenti del CMS, **Reimposta verifica in due passaggi**
(`DELETE /api/admin/users/:uid/mfa`) e **Disabilita o abilita account**
(`PUT /api/admin/users/:uid { disabled }`) sono disponibili per chiunque detenga lo scope
`users:write`, analogamente a quanto previsto per le route; l'opzione di modifica non viene mai offerta
per il proprio account e l'azione su un account di rango superiore al proprio viene rifiutata con
la motivazione del server.

Imposta `MFA_ENCRYPTION_KEY` (32+ caratteri casuali) per crittografare i segreti TOTP archiviati.
In sua assenza, il server ripiega su `JWT_SECRET` e genera un avviso. Impostalo **prima** che
qualsiasi utente esegua la registrazione: i segreti archiviati non contengono alcun ID chiave,
pertanto la modifica della chiave a posteriori renderà indecifrabili i fattori esistenti e
impedirà ai rispettivi proprietari di superare una challenge.

### Invitare i membri del team tramite email

I flussi di invito devono convertire un indirizzo email in un ID utente, ma la
tabella `users` è protetta da RLS per il client. Invece di implementare manualmente
una funzione server di amministrazione, puoi abilitare la ricerca integrata:

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
e `photoURL` — mai l'email, i ruoli o i metadati dell'utente cercato. È **disattivato per
impostazione predefinita** perché consente a qualsiasi utente autenticato di verificare quali
indirizzi email possiedono un account; attivalo solo se la UX dei tuoi inviti lo richiede.

## Contesto del database per la Row-Level Security (RLS)

Rebase collega direttamente l'autenticazione delle richieste alla Row-Level Security (RLS) di PostgreSQL. Ogni query al database eseguita tramite un driver associato all'ambito dell'utente viene eseguita all'interno di una transazione di database (`db.transaction()`) che imposta parametri di configurazione locali alla transazione:

*   `app.uid` — L'ID univoco dell'utente autenticato (`uid`). Il valore predefinito è `'anonymous'` per le richieste non autenticate. Il parametro precedente alla ridenominazione, `app.user_id`, viene comunque scritto al suo fianco per garantire la compatibilità con le policy compilate prima della modifica.
*   `app.user_roles` — Una stringa separata da virgole che elenca i ruoli assegnati all'utente.
*   `app.is_anonymous` — `'true'` per una sessione guest (accesso anonimo), `'false'` altrimenti.
*   `app.jwt` — Una stringa JSON contenente i claim personalizzati del token insieme a `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

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
*   **`rebase.roles()`** — Restituisce la stringa dei ruoli separati da virgole:
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
*   **`rebase.is_anonymous()`** — Indica se il chiamante è un guest, come valore `boolean` (`false` se non impostato), consentendo a una policy di specificare `NOT rebase.is_anonymous()`.

Puoi utilizzare questi helper direttamente nelle tue regole di sicurezza personalizzate o nelle migrazioni del database:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Token asimmetrici e JWKS

Per impostazione predefinita, gli access token vengono firmati con `jwtSecret` (HS256). Questo
approccio funziona, ma implica che qualsiasi elemento che debba *verificare* un token debba possedere
la chiave utilizzata per *emetterlo* — quindi un gateway o un edge worker che controlla una
sessione potrebbe anche contraffarla — e la modifica del segreto disconnette tutti gli utenti contemporaneamente.

Configurando una chiave di firma, Rebase firmerà invece gli access token in modo asimmetrico,
pubblicando la componente pubblica su **`/.well-known/jwks.json`** affinché chiunque possa eseguire
la verifica:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Oppure tramite variabili d'ambiente, per una singola chiave:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Genera una chiave con:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Anche le chiavi RSA sono supportate e firmano con `RS256`; le chiavi EC P-256 firmano con `ES256`.
Viene configurata unicamente la chiave privata — la metà pubblica viene derivata da essa, evitando
qualsiasi disallineamento della coppia. `jwtSecret` rimane comunque obbligatorio in entrambi i casi:
serve ancora a firmare i token con ambito specifico (link di download, stato MFA in sospeso, reimpostazione
della password) che solo questo server legge.

### Rotazione di una chiave

Posiziona la nuova chiave per prima e mantieni in elenco quella precedente. I nuovi token verranno
firmati con la nuova chiave; i token già in circolazione continueranno a essere verificati con quella
precedente fino alla loro scadenza, evitando che gli utenti vengano disconnessi.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una volta trascorso il ciclo di vita massimo dell'access token più longevo, rimuovi la voce precedente.
Utilizza `activeKid` se desideri pubblicare una chiave prima di iniziare a usarla per firmare.

### Verifica da altri sistemi

I token includono l'identificativo `kid` della chiave di firma nel rispettivo header; è così che
un verificatore individua la chiave corretta all'interno del JWKS e riconosce quando effettuare un nuovo
recupero (re-fetch) dopo una rotazione. Qualsiasi libreria standard esegue questa operazione
automaticamente — ad esempio, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Senza `signingKeys` configurate, `/.well-known/jwks.json` risponde con
`{"keys":[]}` e i token rimangono firmati con HS256. Nulla cambia finché non viene aggiunta una chiave.
:::

## Autenticazione con Service Key

Per la comunicazione server-to-server (es. cron job, servizi esterni), configura una chiave di servizio statica:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

I client si autenticano con l'header `Authorization: Bearer <service-key>`. 

### Chiave interna generata a ogni avvio (Per-Boot Key)

Se `REBASE_SERVICE_KEY` non è specificata nella configurazione, Rebase genera automaticamente una chiave casuale **interna per ciascun avvio (per-boot key)**. 

Questa chiave non viene mai registrata nei log e non lascia mai il processo. Viene utilizzata dal singleton `rebase` per autenticarsi presso le API del control-plane del server stesso (auth, storage, ecc.). Ciò garantisce che i task amministrativi (come l'invio di un'email di benvenuto o la generazione di un URL di storage) funzionino sempre fin dal primo momento sia in sviluppo che in produzione, senza richiedere la gestione manuale delle chiavi.

### Protezione contro attacchi di temporizzazione e requisiti delle chiavi

Per prevenire attacchi di temporizzazione (timing attack), Rebase convalida sia la service key configurata dall'utente sia la chiave interna utilizzando un confronto tra stringhe a tempo costante (`safeCompare`). La service key configurata dall'utente **deve essere lunga almeno 32 caratteri**; se viene configurata una chiave con meno di 32 caratteri, Rebase genererà un errore di configurazione all'avvio arrestandosi in sicurezza (fail-closed).

## Prossimi passi

- **[Autenticazione](/docs/backend/authentication/)** — la configurazione da cui derivano queste route
- **[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters/)** — sostituzione del provider sottostante
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — cosa fa una policy con `rebase.uid()`
- **[Autenticazione con l'SDK tipizzato](/docs/sdk/authentication/)** — chiamare queste route dall'SDK
