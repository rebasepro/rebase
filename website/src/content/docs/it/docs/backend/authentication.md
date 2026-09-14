---
sourceHash: cd5be95034e39df6
title: Autenticazione
sidebar_label: Autenticazione
description: Configura l'autenticazione JWT, i provider OAuth, le email SMTP, la protezione dai bot e la collection users sul backend Rebase.
---

L'autenticazione si sviluppa su tre pagine, perché copre tre compiti distinti. Questa è la pagina di **configurazione**: cosa inserire nel blocco `auth` e nell'ambiente.

- [Endpoint e token](/docs/backend/auth-endpoints/) — le route montate dal backend, i formati delle risposte, l'MFA, il contesto del database visualizzato da una policy, JWKS e chiavi di servizio.
- [Adapter di autenticazione personalizzati](/docs/backend/auth-adapters/) — sostituire il provider integrato con Clerk, Firebase Auth o una soluzione proprietaria.

## Panoramica

Rebase include un sistema completo di autenticazione backend:

- **Token JWT** — Flusso di access e refresh token con scadenza configurabile
- **Provider OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e altri
- **Email SMTP** — Flussi di ripristino password e verifica email
- **Hook di autenticazione** — Hook del ciclo di vita per la creazione degli utenti e altro
- **Adapter di autenticazione personalizzati** — Integra Firebase Auth, Auth0, Clerk o qualsiasi provider esterno
- **Service key** — Chiave statica per l'autenticazione server-to-server
- **Auto-bootstrapping** — Al di fuori della produzione, il primo utente ottiene automaticamente il ruolo admin; un deployment di produzione specifica il proprio admin tramite `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configurazione

:::note[Dove va inserito]
**Managed runtime:** ambiente — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` e le coppie `*_CLIENT_ID` / `*_CLIENT_SECRET` dei provider, una per ciascuno dei dodici provider ([la sintassi esatta](#sintassi-delle-variabili-dambiente); per Apple sono quattro chiavi, non una coppia). La collection users è quella specificata dal bundle (per convenzione `collections/users`).
**Nessun percorso gestito:** `auth.hooks`. Sono funzioni; fai l'eject per passarle.
**Ejected:** `initializeRebaseBackend({ auth })` in `backend/src/index.ts`.
:::

Il blocco `auth` in `initializeRebaseBackend` controlla tutta l'autenticazione backend:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,         // Your users collection definition
        jwtSecret: env.JWT_SECRET,           // Required — signing secret
        accessExpiresIn: "1h",               // Access token lifetime (default: 1h)
        refreshExpiresIn: "30d",             // Refresh token lifetime (default: 30d)
        serviceKey: env.REBASE_SERVICE_KEY,  // Optional — for server-to-server calls
        allowRegistration: true,             // Allow new signups (default: false)

        // OAuth providers
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,

        // SMTP email (for password reset, email verification)
        email: env.SMTP_HOST
            ? {
                from: env.SMTP_FROM || `${env.APP_NAME} <noreply@example.com>`,
                smtp: {
                    host: env.SMTP_HOST,
                    port: env.SMTP_PORT,              // 587 for TLS, 465 for SSL
                    secure: env.SMTP_SECURE,           // true for port 465
                    auth: env.SMTP_USER
                        ? { user: env.SMTP_USER, pass: env.SMTP_PASS! }
                        : undefined,
                    name: env.SMTP_NAME,               // Optional EHLO/HELO hostname
                },
                appName: env.APP_NAME,
                logoUrl: env.EMAIL_LOGO_URL,           // Logo shown atop the default templates
                resetPasswordUrl: env.FRONTEND_URL,    // URL for password reset page
            }
            : undefined,

        // Lifecycle hooks
        hooks: {
            afterUserCreate: async (user) => {
                console.log(`New user registered: ${user.email}`);
            }
        }
    }
});
```

### Il blocco `auth`, nel dettaglio

| Chiave | Tipo | Predefinito | Descrizione |
|-----|------|---------|--------------|
| `collection` | `CollectionConfig` | — | La collection degli utenti. Vedi [Configurazione dell'autenticazione a livello di collection](#configurazione-dellautenticazione-a-livello-di-collection) |
| `jwtSecret` | `string` | — | Segreto di firma HS256. Obbligatorio in produzione |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Chiavi di firma asimmetriche — vedi [Token asimmetrici e JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | prima chiave | Quale chiave di `signingKeys` emette i nuovi token |
| `accessExpiresIn` | `string` | `1h` | Durata dell'access token |
| `refreshExpiresIn` | `string` | `30d` | Durata del refresh token. Scorrevole: ogni rotazione la rinnova. Il runtime passa `JWT_REFRESH_EXPIRES_IN`, il cui valore predefinito è `400d` |
| `requireAuth` | `boolean` | `true` | Richiede una sessione per le API dei dati |
| `allowRegistration` | `boolean` | `false` | Abilita `POST /api/auth/register`. Al di fuori della produzione, il primo utente su una tabella vuota viene ammesso in ogni caso; in produzione l'admin viene definito con `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Kill switch: chiude anche la finestra di bootstrap del primo utente lasciata aperta da `allowRegistration: false` |
| `allowAnonymous` | `boolean` | `false` | Abilita `POST /api/auth/anonymous`. Volutamente non vincolato a `allowRegistration`: un'app pubblica a prevalente lettura potrebbe richiedere sessioni senza account |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` per i flussi di invito via email |
| `defaultRole` | `string` | — | Ruolo assegnato a un nuovo utente registrato quando non ne viene specificato uno |
| `serviceKey` | `string` | — | Chiave statica per chiamate server-to-server — vedi [Autenticazione con Service Key](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, per ripristino password, verifiche, inviti e magic link |
| `magicLink` | `boolean` | `false` | Abilita l'accesso senza password via email. Richiede `email` configurata; in caso contrario le route rispondono con `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Abilita i codici di accesso a sei cifre via email — vedi [Codici monouso](#codici-monouso-via-email). Stesso requisito per l'email |
| `cookieAuth` | `CookieAuthConfig` | — | Fornisce il refresh token tramite cookie `httpOnly`, `Secure` e `SameSite` invece che nel corpo JSON — vedi sotto |
| `providers` | `OAuthProvider[]` | `[]` | L'array OAuth canonico; i campi dei provider denominati confluiscono qui |
| `allowedRedirectUris` | `string[]` | — | Limita gli URI di reindirizzamento accettati dalle route OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh token in un cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Il refresh token è la credenziale a lunga durata e, nella modalità predefinita con corpo JSON, qualsiasi vulnerabilità XSS sulla pagina può leggerlo. `cookieAuth` lo sposta in un cookie inaccessibile al JavaScript della pagina. L'**access** token rimane nel corpo JSON, poiché il client deve inserirlo in un header `Authorization`.

Due requisiti devono essere rispettati, altrimenti l'accesso si interrompe anziché degradare normalmente: le richieste fetch del client verso gli endpoint di autenticazione richiedono `credentials: "include"`, e CORS deve consentire le credenziali — il che richiede un elenco esplicito di origini, mai `origin: "*"`. `AUTH_COOKIE_SAME_SITE` è la variabile d'ambiente per `sameSite`, e `AUTH_COOKIE_SECURE` per `secure`.

Il cookie include il flag `Secure` a meno che non venga disattivato esplicitamente, e nessun elemento della richiesta può farlo: in passato il flag veniva letto dal protocollo della richiesta, che è `http` dietro a qualsiasi proxy con terminazione TLS, provocando il transito in chiaro del refresh token nella topologia di produzione più comune. `AUTH_COOKIE_SECURE=false` è l'unica via d'uscita per un deployment effettivamente servito su HTTP semplice — un indirizzo LAN, un'appliance — e genera un avviso all'avvio. `http://localhost` non ne ha bisogno: i browser lo trattano come un'origine attendibile e accettano cookie `Secure`.

| Chiave | Predefinito | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | dominio corrente | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` va usato solo per frontend autenticamente cross-site |
| `secure` | `true` | Secure per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per plain http |

:::caution[I callback delle collection non vengono eseguiti per gli utenti auth]
La creazione e l'aggiornamento degli utenti tramite il sistema di autenticazione — registrazione, gestione utenti admin e OAuth — scrivono **direttamente** nello store utenti e aggirano la pipeline di salvataggio della collection. Un callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` sulla collection di autenticazione (users) **non** verrà eseguito per questi percorsi. Per effetti collaterali come il provisioning di un team personale alla registrazione, usa gli hook del ciclo di vita dell'autenticazione (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), che ricevono il record utente completamente popolato.

OAuth ne esegue meno rispetto alla registrazione. L'accesso tramite provider attiva `afterUserCreate` quando crea l'account e nessun altro hook del ciclo di vita: `beforeUserCreate`, `beforeLogin` e `onAuthenticated` non vengono eseguiti sulla route OAuth, quindi controlli o audit trail associati a essi non intercetteranno mai un utente OAuth.
:::

### Protezione dai bot

Il rate limiting pone un limite a un singolo chiamante. Mille indirizzi che inviano una singola richiesta ciascuno non intaccheranno mai una finestra per-IP — e `/auth/register`, `/auth/forgot-password` e `/auth/magic-link` inviano tutti email, quindi il costo di un form non protetto si paga con la reputazione del dominio mittente.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Oppure tramite l'ambiente, come previsto in un deployment gestito:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Il client invia il token del widget come `captchaToken` nel corpo JSON o nell'header specifico del widget `cf-turnstile-response` / `h-captcha-response`. Entrambi sono accettati; imposta `tokenField` per utilizzare una chiave del body diversa.

**`login` non è protetto per impostazione predefinita.** Un controllo captcha a ogni accesso appesantisce l'esperienza di ogni utente reale; per contrastare il credential stuffing sono previsti il rate limiter e il blocco dell'account. Aggiungilo a `routes` se desideri abilitarlo.

#### Modalità fail-closed

Se il provider non è raggiungibile, la verifica fallisce e la richiesta viene rifiutata. Un attaccante in grado di provocare tale disservizio potrebbe altrimenti disattivare la protezione, ed è proprio ciò che un sistema di challenge deve impedire.

Il rovescio della medaglia è che un'interruzione del provider blocca le registrazioni. Questo comportamento è evidente, visibile e reversibile rimuovendo una sola chiave di configurazione — un fallimento preferibile a un problema silenzioso scoperto solo quando il dominio email finisce in una blocklist.

#### Un errore di configurazione impedisce l'avvio

`enabled: true` senza provider, con un provider sconosciuto o senza segreto bloccherà l'avvio. Un challenge assente in modo silenzioso mentre la configurazione ne dichiara la presenza è l'unico errore inaccettabile in questo contesto.

Al chiamante viene solo comunicato che la verifica è fallita — mai se il token era assente, non valido, già utilizzato o non verificabile. Il dettaglio specifico viene registrato nei log, perché informare uno script significherebbe aiutarlo ad aggirare il blocco.

### Email in ambiente di sviluppo

Senza `SMTP_HOST`, le email di autenticazione non possono essere inviate. Anziché rifiutare la richiesta, un server di sviluppo intercetta il messaggio e ne stampa i link:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Seguendo il link, il flusso viene completato. Non cambia nulla riguardo al token — viene generato, archiviato e convalidato esattamente come avverrebbe da una casella di posta reale; cambia soltanto la modalità di consegna.

Questa modalità è attiva ogni volta che si verificano tutte e tre le condizioni seguenti, senza alcuna impostazione che possa modificarle:

- `SMTP_HOST` non è impostato — un server di posta configurato ha sempre la priorità;
- `NODE_ENV` non è `production`. Un'email di reset password intercettata contiene un token di ripristino funzionante, quindi il buffer di cattura funge da archivio credenziali e non deve esistere in produzione;
- `FRONTEND_URL` è un URL `http(s)` assoluto, altrimenti il link inviato via email non avrebbe una base valida e risulterebbe inutilizzabile.

Se una qualsiasi di queste condizioni non è soddisfatta, `POST /auth/magic-link` e `POST /auth/forgot-password` rispondono con `503 EMAIL_NOT_CONFIGURED` come in precedenza. In produzione, imposta `SMTP_HOST` (o `auth.email.sendEmail`) per recapitare effettivamente le email.

#### Leggere le email intercettate senza terminale

Il log è utile solo a chi lo sta monitorando attivamente. Un server in esecuzione su Docker, una seconda finestra o una riga scorsa via possono far perdere il link stampato — per questo motivo gli stessi messaggi intercettati sono accessibili tramite HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Ogni messaggio include `to`, `subject`, `at`, le sezioni `html` e `text`, e `links` — gli URL assoluti rilevati nel corpo del messaggio in ordine di apparizione, che è l'informazione che realmente serve.

L'accesso è riservato agli amministratori, protetto dallo stesso meccanismo usato per cron, log e backup, e risponde con `501 DEV_MAILBOX_UNAVAILABLE` quando non c'è nulla da mostrare — con SMTP configurato, le email vengono recapitate anziché trattenute. `NODE_ENV=production` rifiuta l'endpoint a prescindere da qualsiasi altra configurazione: i messaggi contengono a tutti gli effetti credenziali di accesso attive.

### Codici monouso via email

Un magic link apre la sessione sul dispositivo in cui risiede la casella di posta. È il dispositivo giusto su un portatile, ma è quello sbagliato in tutti gli altri casi — una smart TV, un terminale, un secondo browser, un chiosco informativo. Un codice colma questo divario, perché è la persona stessa a trasferirlo.

```ts
auth: {
    emailOtp: true,   // or AUTH_EMAIL_OTP=true
    email: { /* … */ }
}
```

```ts
await rebase.auth.sendEmailOtp("someone@example.com");
// …the person reads six digits out of their inbox…
const { user } = await rebase.auth.verifyEmailOtp("someone@example.com", "384102");
```

L'indirizzo viene inviato nuovamente insieme al codice, e non per pura comodità. Ciò che viene memorizzato è un hash combinato di indirizzo *e* codice insieme, in modo che un tentativo sia mirato esclusivamente a un singolo account specifico — e non a tutti gli account della tabella contemporaneamente, cosa che accadrebbe con una ricerca limitata al solo codice su un milione di possibilità.

Gli altri elementi che rendono sufficienti sei cifre:

- **Dieci minuti**, e utilizzo singolo.
- **Cinque tentativi di verifica per indirizzo per finestra temporale**, basati sull'indirizzo anziché sull'IP del chiamante: l'IP può essere facilmente ruotato dall'attaccante, mentre l'account sotto attacco è fisso. I conteggi risiedono nello store di rate limiting del deployment — per replica come impostazione predefinita, condivisi impostando `REBASE_RATE_LIMIT_STORE=sql`.
- **Cifre uniformi**, generate tramite `randomInt` anziché con il modulo di byte casuali.
- `POST /auth/otp` risponde in modo identico se l'indirizzo non appartiene ad alcun account, impedendo che venga utilizzato per verificare l'esistenza di un cliente.

Leggere un codice dalla casella di posta dimostra la proprietà dell'indirizzo, pertanto un accesso riuscito lo contrassegna come verificato — esattamente come accade seguendo un magic link.

### Personalizzazione del brand nelle email predefinite

I template integrati per il ripristino della password, la verifica, gli inviti, il benvenuto e i magic link mostrano un logo sopra la card. Questo viene configurato tramite `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Deve trattarsi di un'immagine **PNG o JPG situata su un URL `http(s)` assoluto**. I client di posta non eseguono il rendering dei file SVG e bloccano gli URI `data:`, e l'immagine viene scaricata dal client del destinatario anziché dal server — di conseguenza, un percorso relativo, un URI data o un file locale farà sì che non venga mostrato alcun logo anziché mostrare un'immagine danneggiata. `appName` viene utilizzato come testo `alt`, garantendo che il nome venga comunque mostrato anche se il client ha le immagini disattivate.

Il fallback è volutamente asimmetrico. `appName` ricade su `Rebase`, ma il logo utilizza il simbolo Rebase solo fino a quando l'installazione **non** è stata rinominata. Se imposti `appName` con un altro nome, non visualizzerai alcun logo finché non configuri `logoUrl` — altrimenti gli utenti di Acme riceverebbero il logo di Rebase in email firmate dal dominio di Acme.

Se sostituisci un template tramite `email.templates`, nulla di tutto ciò si applica: la tua funzione gestisce l'intero corpo dell'email.

### Provider OAuth

Ciascun provider OAuth viene configurato come minimo con un `clientId`. Alcuni provider richiedono anche un `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

`gitlab` accetta anche un `baseUrl` opzionale, per un'istanza GitLab self-hosted.

#### Sintassi delle variabili d'ambiente

Un deployment gestito o basato su bundle non dispone di un blocco `auth` in cui scrivere — la configurazione del server avviene interamente tramite le variabili d'ambiente — pertanto ogni provider sopra elencato dispone di una coppia `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, ed entrambi i valori devono essere definiti affinché il provider sia configurato:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` elenca quindi `discord` in `enabledProviders`, consentendo di verificare la corretta acquisizione della coppia.

Apple fa eccezione: non dispone di un client secret statico, poiché Rebase firma un JWT ES256 a breve durata per ogni scambio di token. Richiede tutte e quattro le variabili: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY` — ovvero l'intero contenuto del file `.p8`, inclusi i ritorni a capo.

Due opzioni non dispongono di una variabile d'ambiente equivalente e richiedono il blocco `auth` (quindi un backend ejected o configurato da codice): `microsoft.tenantId`, che altrimenti ha come valore predefinito `common` e segnala ogni indirizzo come non verificato, e `gitlab.baseUrl`, per un'istanza self-hosted.

Ogni campo denominato viene risolto all'avvio in `auth.providers`, che rappresenta l'array canonico e il punto di estensione per tutto ciò che i campi denominati non coprono. Le voci vengono create con le factory `create*Provider` e le due modalità si fondono — i campi denominati vengono aggiunti in coda alle voci esplicite:

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Limitazione dei redirect URI

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

Se non configurata, l'unico controllo su un redirect OAuth è la corrispondenza con gli URI registrati presso il provider stesso — il che autorizza **ogni** URI registrato su quel client OAuth, inclusa la voce `localhost` aggiunta per lo sviluppo e l'host di staging che nessuno ha rimosso. Specificare le origini effettivamente servite da questo backend ne limita l'accettazione solo a esse. Il confronto degli URI avviene su origine e percorso; query, frammenti e barre finali vengono ignorati.

### Collegamento degli account tra diversi metodi di accesso

Cosa succede quando qualcuno si registra con email/password come `ada@example.com` e in seguito clicca su "Accedi con Google" con un account Google avente lo stesso indirizzo? Rebase **collega i due accessi in un unico account** — ma solo se il provider certifica l'email come verificata. Non crea mai silenziosamente un secondo account per lo stesso indirizzo.

Su `POST /api/auth/<provider>` l'ordine di risoluzione è:

1. **Identità del provider nota** — se questa esatta identità del provider ha già effettuato l'accesso in precedenza, viene restituito quell'utente. L'email non viene consultata.
2. **Account esistente con la stessa email, verificata dal provider** — l'identità viene associata all'account esistente e l'utente vi accede. Un solo account, due modalità di accesso.
3. **Account esistente con la stessa email, NON verificata dal provider** — la richiesta viene rifiutata con `403 EMAIL_NOT_VERIFIED`. Non viene creato o modificato nulla.
4. **Nessun account con quell'email** — viene creato un nuovo account.

Il punto 3 rappresenta il caso critico per la sicurezza. Se un'email del provider non verificata fosse sufficiente per il collegamento, chiunque riuscisse a farsi emettere da un provider un indirizzo non proprio potrebbe impossessarsi del relativo account Rebase. Google attesta sempre `email_verified` per i veri account Google, quindi il passaggio 2 è il percorso standard per l'accesso con Google; il passaggio 3 intercetta soprattutto i provider che consentono agli utenti di specificare un indirizzo arbitrario non confermato.

Questo comportamento non è configurabile — non esiste intenzionalmente alcuna opzione per collegare account sulla base di email non verificate.

Per risolvere un rifiuto al passaggio 3, l'utente effettua l'accesso con il metodo esistente e invoca l'endpoint esplicito di collegamento:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

Il collegamento da autenticati intenzionalmente **non** richiede un'email verificata, né richiede che le email coincidano — spesso l'indirizzo Google di un utente non corrisponde a quello dell'applicazione. L'asimmetria è voluta: durante l'accesso, l'email del provider è l'unica prova che associa l'identità in ingresso a un account, mentre in questo caso il chiamante ha già dimostrato la titolarità possedendo una sessione valida. Restituisce `409 IDENTITY_ALREADY_LINKED` se tale identità del provider appartiene a un altro utente, ed è idempotente se è già collegata al chiamante.

#### La direzione inversa

Un utente che si è registrato con Google e non possiede una password:

- **La registrazione con la stessa email** viene rifiutata con `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** restituisce `400 INVALID_ACCOUNT` — non esiste una password precedente con cui effettuare la verifica.
- **`forgot-password` → `reset-password` è il percorso supportato per aggiungerne una.** Questo dimostra nuovamente la proprietà dell'indirizzo tramite email, dopodiché l'account disporrà di entrambi i metodi di accesso.

## Tabelle create automaticamente

Al primo avvio, Rebase crea automaticamente lo schema `auth` e le seguenti tabelle nel database (associate allo schema definito nella collection, ad esempio `rebase`):

- **`rebase.users`** — Account utente con email, hash della password, metadati e una colonna text[] per `roles` (i ruoli sono memorizzati come array di testo inline per ottimizzare le query ed evitare join).
- **`rebase.refresh_tokens`** — Sessioni a lunga durata contenenti gli hash dei refresh token, user agent e indirizzi IP. Include un indice univoco su `token_hash` e un vincolo di unicità su `(user_id, user_agent, ip_address)` per tracciare le sessioni attive sui dispositivi.
- **`rebase.password_reset_tokens`** — Token monouso a scadenza per i flussi di recupero password.
- **`rebase.mfa_factors`** — Metodi di autenticazione a più fattori registrati (es. segreti TOTP crittografati con AES-256).
- **`rebase.mfa_challenges`** — Log di verifica che tracciano i tentativi attivi di verifica MFA.
- **`rebase.recovery_codes`** — Codici di backup/recupero multi-fattore con hash.
- **`rebase.app_config`** — Archivio chiave-valore per le configurazioni di sistema.

## Bootstrap del primo utente

Quando non sono presenti utenti nel database e il server **non** è in esecuzione con `NODE_ENV=production`, la prima persona che si registra diventa automaticamente un admin. Successivamente, la registrazione è controllata dall'impostazione `allowRegistration`.

In produzione tale finestra è chiusa, poiché un host con un nome pubblico è raggiungibile prima che il suo gestore si sia registrato, e chiunque arrivasse per primo ne acquisirebbe il controllo. Un deployment di produzione specifica invece il suo primo amministratore nell'ambiente — tramite `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, creati all'avvio quando la tabella è ancora vuota — oppure assegna il ruolo tramite la service key. Con la finestra chiusa, una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED` (segnalandolo esplicitamente), un primo account creato tramite registrazione aperta è un account ordinario, `GET /api/auth/config` non restituisce mai `needsSetup`, `POST /api/admin/bootstrap` rifiuta la richiesta e il log di avvio avverte se la tabella è vuota e nessun amministratore è specificato.

In locale ciò significa che è sempre possibile inizializzare un database pulito senza dover inserire dati manualmente. Per prevenire esecuzioni concorrenti e race condition nella generazione dello schema durante l'hot reloading (HMR) o all'avvio, le operazioni di bootstrap sono sincronizzate tramite un advisory lock di Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configurazione dell'autenticazione a livello di collection

Anziché affidarsi esclusivamente alle regole di autenticazione predefinite del database, è possibile contrassegnare qualsiasi collection Postgres (come `users.ts` o una collection personalizzata `members.ts`) come collection di autenticazione. Questo si configura tramite la proprietà `auth` sulla collection stessa:

```typescript
import { randomBytes } from "node:crypto";
import { defineCollection } from "@rebasepro/cms-types";

const membersCollection = defineCollection({
  name: "Members",
  slug: "members",
  table: "members",
  auth: {
    enabled: true,
    
    // Customize what happens when an admin creates a user via the REST API
    onCreateUser: async (values, ctx) => {
      const hash = await ctx.hashPassword("welcome123");
      return {
        values: { ...values, passwordHash: hash, emailVerified: true },
        temporaryPassword: "welcome123"
      };
    },

    // Customize what happens when an admin resets a user's password in the admin panel
    onResetPassword: async (userId, ctx) => {
      const tempPassword = randomBytes(12).toString("base64url");
      return {
        temporaryPassword: tempPassword, // saved as the new password, then shown to the admin
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    }
  },
  properties: { ... }
});
```

Un `temporaryPassword` restituito da `onResetPassword` diventa la password dell'account. Rebase ne esegue l'hash con l'algoritmo configurato, lo salva, disconnette l'utente da tutte le sessioni esistenti e lo mostra all'amministratore perché lo comunichi. L'hook non lo memorizza, né ha modo di farlo. Non restituire alcun `temporaryPassword` quando l'hook invia invece un proprio link di reimpostazione via email: la password resta allora invariata finché l'utente non ne imposta una nuova, anche se le sue sessioni terminano comunque.

Quando vengono chiamati hook personalizzati (`onCreateUser`, `onResetPassword`), ricevono una facciata `AuthCollectionContext` contenente:
- `hashPassword(password: string): Promise<string>` — Esegue l'hashing della password utilizzando l'algoritmo configurato (es. scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Invia un'email (disponibile solo quando il servizio email è configurato). Si risolve con i dati forniti dal provider — `messageId`, `accepted`, `rejected` — consentendo a un hook di memorizzare l'id e successivamente agganciare una risposta a esso.
- `emailConfigured: boolean` — Indica se il servizio email è configurato.
- `appName: string` — Il nome dell'applicazione derivato dalla configurazione email.
- `resetPasswordUrl: string` — L'URL di base del link per il ripristino della password.

## Passaggi successivi

- **[Endpoint e token](/docs/backend/auth-endpoints/)** — tutte le route montate da questa configurazione
- **[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters/)** — integrazione del proprio identity provider
- **[Autenticazione frontend](/docs/frontend/authentication/)** — interfaccia utente di login, controller di autenticazione, gestione utenti
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — controllo degli accessi a livello di riga
- **[Autenticazione client SDK](/docs/sdk/authentication/)** — metodi di autenticazione nell'SDK client
