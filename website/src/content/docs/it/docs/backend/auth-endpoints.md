---
sourceHash: 3b130367f73c18c5
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
| `POST` | `/api/auth/link/<provider>` | Collega un provider OAuth all'account autenticato |
| `POST` | `/api/auth/logout` | Revoca il refresh token |
| `POST` | `/api/auth/forgot-password` | Invia l'email per reimpostare la password |
| `POST` | `/api/auth/reset-password` | Reimposta la password con un token |
| `POST` | `/api/auth/find-user` | Risolve un'email in un profilo pubblico minimo (opzionale — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifica la password del chiamante (autenticato) |
| `GET` | `/api/auth/me` | Il profilo del chiamante |
| `PATCH` | `/api/auth/me` | Aggiorna il profilo del chiamante |
| `GET` | `/api/auth/config` | Ciò che questo backend offre a una schermata di accesso — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`. Non autenticato e calcolato a partire dagli stessi predicati applicati dalle route, garantendo che ciò che la schermata mostra corrisponda esattamente a ciò che può fare |
| `POST` | `/api/auth/send-verification` | Invia al chiamante un link di verifica dell'email |
| `GET` | `/api/auth/verify-email` | Consuma un link di verifica (l'URL contenuto nell'email) |
| `POST` | `/api/auth/magic-link` | Invia via email un link di accesso monouso. `503 EMAIL_NOT_CONFIGURED` se SMTP non è configurato |
| `POST` | `/api/auth/magic-link/verify` | Scambia un token magic-link con una sessione |
| `POST` | `/api/auth/otp` | Invia via email un codice di accesso a sei cifre. Risponde allo stesso modo indipendentemente dal fatto che l'indirizzo sia associato a un account o meno |
| `POST` | `/api/auth/otp/verify` | Scambia `{ email, code }` con una sessione |
| `POST` | `/api/auth/anonymous` | Crea una sessione anonima (opzionale — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associa credenziali reali all'account anonimo già autenticato |
| `GET` | `/api/auth/sessions` | Elenca le sessioni attive del chiamante (refresh token) |
| `DELETE` | `/api/auth/sessions` | Revoca tutte le sessioni, inclusa quella corrente — disconnessione remota su tutti i dispositivi |
| `DELETE` | `/api/auth/sessions/:id` | Revoca una sessione |
| `GET` | `/.well-known/jwks.json` | Il JWKS pubblico — montato alla radice, non sotto `basePath`, perché è lì che cerca un verificatore. Presente quando la [firma asimmetrica](#asymmetric-tokens-and-jwks) è configurata |
| `POST` | `/api/auth/mfa/enroll` | Avvia la registrazione TOTP (restituisce il segreto e i codici di recupero) |
| `POST` | `/api/auth/mfa/verify` | Conferma la registrazione con un codice proveniente dall'app di autenticazione |
| `GET` | `/api/auth/mfa/factors` | Elenca i fattori registrati dal chiamante |
| `POST` | `/api/auth/mfa/challenge` | Avvia una verifica (challenge) su un fattore verificato |
| `POST` | `/api/auth/mfa/challenge/verify` | Risponde a una challenge — questo passaggio emette la sessione |
| `DELETE` | `/api/auth/mfa/unenroll` | Rimuove un fattore (richiede una sessione `aal2`) |

La gestione amministrativa di utenti e ruoli è una **superficie separata**, montata su
`/api/admin/` anziché `/api/auth/`, e vincolata al ruolo `admin` o alla
chiave di servizio (service key):

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Elenca gli utenti (con paginazione) |
| `POST` | `/api/admin/users` | Crea un utente |
| `GET` | `/api/admin/users/:uid` | Legge un singolo utente |
| `PUT` | `/api/admin/users/:uid` | Aggiorna un singolo utente |
| `DELETE` | `/api/admin/users/:uid` | Elimina un singolo utente |
| `POST` | `/api/admin/users/:uid/reset-password` | Reimposta la password di un utente senza richiedere quella attuale |
| `GET` | `/api/admin/roles` | Elenca i ruoli noti a questo backend |
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

`POST /api/auth/refresh` risponde con la stessa struttura, con due avvertenze: `user`
viene omesso completamente quando l'account non può essere riletto (quindi è da considerarsi
opzionale in questo caso) e `providerId` è sempre `password`, indipendentemente da come la sessione
è stata originariamente creata.

:::caution[L'SDK client appiattisce questo envelope — le richieste HTTP dirette no]
Il JSON sopra riportato rappresenta il formato di trasmissione (wire format) ed è ciò che
restituisce `fetch("/api/auth/login")`: il token si trova in **`body.tokens.accessToken`**.

L'[SDK client](/docs/sdk/authentication) estrae `tokens` prima di restituire la
sessione, per cui `auth.signInWithEmail()` si risolve invece in una struttura appiattita
**`{ user, accessToken, refreshToken }`**.

Entrambe le strutture sono corrette; appartengono a due livelli diversi. Tentare di leggere
la struttura dell'SDK da una `fetch` diretta restituisce `undefined`, il che si manifesta
come "accesso riuscito ma non c'è alcun access token" — l'accesso è andato a buon fine, il
token si trovava semplicemente un livello più sotto.
:::

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
- **[Autenticazione con l'SDK client](/docs/sdk/authentication/)** — come chiamare queste route dall'SDK

---
