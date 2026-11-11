---
sourceHash: 3c34341487182d4a
title: Autenticazione
sidebar_label: Autenticazione
description: Configura l'autenticazione JWT, i provider OAuth, le email SMTP, la protezione bot e la collection users sul backend Rebase.
---

L'autenticazione è suddivisa in tre pagine, poiché svolge tre compiti distinti. Questa pagina riguarda la **configurazione**: cosa inserire nel blocco `auth` e nell'ambiente.

- [Endpoint e token](/docs/backend/auth-endpoints/) — le route montate dal backend, le strutture di risposta, l'MFA, il contesto del database visibile da una policy, JWKS e chiavi di servizio.
- [Adattatori di autenticazione personalizzati](/docs/backend/auth-adapters/) — sostituzione del provider integrato con Clerk, Firebase Auth o una soluzione proprietaria.

## Panoramica

Rebase include un sistema completo di autenticazione backend:

- **Token JWT** — Flusso di token di accesso e refresh con scadenza configurabile
- **Provider OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e altri
- **Email SMTP** — Flussi di reimpostazione della password e verifica email
- **Hook di autenticazione** — Hook del ciclo di vita per la creazione degli utenti e altro
- **Adattatori di autenticazione personalizzati** — Integrazione con Firebase Auth, Auth0, Clerk o qualsiasi provider esterno
- **Chiave di servizio** — Chiave statica per l'autenticazione server-to-server
- **Auto-bootstrapping** — Al di fuori della produzione, il primo utente ottiene automaticamente il ruolo di amministratore; un deployment di produzione definisce il proprio amministratore tramite `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configurazione

:::note[Dove va inserito]
**Runtime gestito:** ambiente — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` e le coppie `*_CLIENT_ID` / `*_CLIENT_SECRET` dei provider, una per ciascuno dei dodici provider ([i formati delle variabili](#i-formati-delle-variabili-di-ambiente); Apple richiede quattro chiavi anziché una coppia). La collection users corrisponde a quella specificata dal bundle (per convenzione `collections/users`).
**Nessuna route gestita:** `auth.hooks`. Sono funzioni; effettua l'eject per trasmetterle.
**Con eject:** `initializeRebaseBackend({ auth })` in `backend/src/index.ts`.
:::

Il blocco `auth` in `initializeRebaseBackend` controlla l'intera autenticazione del backend:

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
                    timeoutMs: 30_000,                 // Connect, greeting and silence limit (the default)
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
| `collection` | `CollectionConfig` | — | La collection degli utenti. Consulta [Configurazione dell'autenticazione a livello di collection](#configurazione-dellautenticazione-a-livello-di-collection) |
| `jwtSecret` | `string` | — | Segreto di firma HS256. Obbligatorio in produzione |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Chiavi di firma asimmetriche — consulta [Token asimmetrici e JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | prima chiave | Quale tra i `signingKeys` genera i nuovi token |
| `accessExpiresIn` | `string` | `1h` | Durata del token di accesso |
| `refreshExpiresIn` | `string` | `30d` | Durata del refresh token. A scorrimento: ogni rotazione la rinnova, quindi indica per quanto tempo una sessione sopravvive all'**inattività**. Il runtime passa `JWT_REFRESH_EXPIRES_IN`, che per impostazione predefinita è anch'esso impostato su `30d`. I browser limitano il cookie di refresh a 400 giorni, pertanto un valore più lungo non offre vantaggi in modalità cookie |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Intervallo di tempo durante il quale un refresh token sostituito genera comunque un duplicato della sessione, in modo che un client che ha perso la risposta di refresh non venga disconnesso |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Cosa accade quando viene presentato un refresh token oltre tale finestra temporale. `"reject"` lo rifiuta (`TOKEN_ALREADY_USED`) e lo registra nei log, mantenendo attiva la sessione: non si tratta di rilevamento del riutilizzo, poiché chi ha effettuato il refresh per primo mantiene la sessione. `"revoke-session"` termina l'intero accesso in caso di replay di questo tipo (`SESSION_REVOKED`), come avviene in GoTrue, richiedendo al proprietario di eseguire nuovamente il login. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Richiede una sessione per l'API dei dati |
| `allowRegistration` | `boolean` | `false` | Abilita `POST /api/auth/register`. Al di fuori della produzione, il primo utente su una tabella vuota viene comunque accettato; in produzione l'amministratore viene specificato tramite `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Interruttore di emergenza (kill switch): chiude anche la finestra di bootstrap del primo utente lasciata aperta da `allowRegistration: false` |
| `allowAnonymous` | `boolean` | `false` | Abilita `POST /api/auth/anonymous`. Volutamente non vincolato da `allowRegistration` — un'applicazione pubblica prevalentemente in sola lettura potrebbe richiedere sessioni senza account. Trasformare un ospite in un account (`POST /api/auth/anonymous/link`) è una registrazione e richiede sia `allowRegistration` che `allowAnonymous` ancora abilitato: se disattivato, rifiuta anche gli ospiti già autenticati, impedendo a chiunque di convertirsi in un account (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` per i flussi di invito tramite email |
| `captcha` | `CaptchaConfig` | — | Protezione dai bot sulle route che inviano email — consulta [Protezione bot](#protezione-bot) |
| `defaultRole` | `string` | — | Ruolo assegnato a un utente appena registrato quando non ne viene specificato uno. Non può essere `admin` né un ruolo dichiarato con ambito del piano admin: l'avvio rifiuta entrambi |
| `serviceKey` | `string` | — | Chiave statica per chiamate server-to-server — consulta [Autenticazione con chiave di servizio](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, per la reimpostazione della password, la verifica, gli inviti e i magic link |
| `magicLink` | `boolean` | `false` | Abilita l'accesso senza password tramite email. Richiede la configurazione di `email`; in caso contrario, le route rispondono con `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Abilita i codici di accesso a sei cifre via email — consulta [Codici monouso via email](#codici-monouso-via-email). Stesso requisito per l'email |
| `deviceLogin` | `{ verificationUrl: string }` | — | Consente a un terminale o a un altro dispositivo privo di browser di autenticarsi tramite un browser — consulta [Accesso da dispositivo](/docs/backend/device-sign-in/). Richiede un database SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Registrazione senza password: una richiesta di magic link o di codice email per un indirizzo senza account ne crea uno (senza password, non verificato finché il link o il codice non vengono utilizzati), purché `allowRegistration` sia attivo. Esegue `beforeUserCreate` e applica il ruolo predefinito. Se disattivato, tali richieste non creano nulla e rispondono a un indirizzo sconosciuto esattamente come a uno noto. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Rifiuta l'accesso con password finché l'indirizzo non è verificato, e registra con conferma preliminare — consulta [Verifica dell'email](/docs/backend/email-verification/). Richiede `email`; l'avvio fallisce in sua assenza |
| `cookieAuth` | `CookieAuthConfig \| false` | attivo | Invia il refresh token come cookie `httpOnly` `Secure` `SameSite` invece che nel corpo JSON; `false` lo restituisce nel corpo — vedi sotto |
| `providers` | `OAuthProvider[]` | `[]` | L'array canonico di OAuth; i campi con il nome dei provider vengono risolti al suo interno |
| `allowedRedirectUris` | `string[]` | — | Limita gli URI di reindirizzamento accettati dalle route OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Token di refresh in un cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Il refresh token è la credenziale a lungo termine e, se presente nel corpo della richiesta, qualsiasi vulnerabilità XSS nella pagina potrebbe leggerlo. `cookieAuth` lo conserva in un cookie inaccessibile agli script della pagina: attivo per impostazione predefinita a meno che non venga configurato diversamente, sempre nel runtime e dalla versione 0.30 in `initializeRebaseBackend`. Il token di **accesso** rimane nel corpo, per l'header `Authorization`. Una richiesta con `x-rebase-auth-flow: json` riceve il refresh token nel corpo; con `cookieAuth: false` ciò avviene per ogni richiesta, e un client browser richiede `authFlowMode: "json"`.

Devono essere rispettate due condizioni, altrimenti l'autenticazione si interrompe anziché degradare normalmente: le chiamate fetch del client verso gli endpoint di autenticazione richiedono `credentials: "include"`, e CORS deve consentire le credenziali — il che significa un elenco esplicito di origini, mai `origin: "*"`. `AUTH_COOKIE_SAME_SITE` è la variabile di ambiente corrispondente a `sameSite`, mentre `AUTH_COOKIE_SECURE` corrisponde a `secure`.

Il cookie include il flag `Secure` a meno che non venga disattivato, e nulla nella richiesta può sovrascriverlo: basandosi sul protocollo della richiesta, che è `http` dietro qualsiasi proxy di terminazione TLS, invierebbe il token in chiaro. `AUTH_COOKIE_SECURE=false` è l'unica via d'uscita per un deployment erogato su semplice HTTP (un indirizzo LAN, un'appliance), e genera un avviso all'avvio. `http://localhost` non ne ha bisogno.

| Chiave | Predefinito | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | dominio corrente | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` è riservato solo a un frontend realmente cross-site |
| `secure` | `true` | Protetto per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per HTTP non crittografato |

:::caution[I callback delle collection non vengono eseguiti per gli utenti di autenticazione]
La creazione e gli aggiornamenti degli utenti tramite il sistema di autenticazione — registrazione, gestione utenti amministratore e OAuth — scrivono **direttamente** nello user store ed eludono la pipeline di salvataggio delle collection. Un callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` sulla collection di autenticazione (users) **non** verrà eseguito per questi percorsi. Per effetti collaterali come il provisioning di un team personale alla registrazione, usa gli hook del ciclo di vita dell'autenticazione (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), che ricevono il record utente completamente popolato.

OAuth esegue gli stessi hook degli altri accessi: `beforeLogin` (con l'indirizzo del provider e `"oauth"`), `beforeUserCreate` quando l'accesso crea l'account, `afterUserCreate` e `onAuthenticated`. `onAuthenticated` viene attivato anche al refresh del token (`"refresh"`), alla reimpostazione della password (`"password-reset"`) e al secondo fattore (`"mfa"`). `beforeLogin` non viene eseguito durante un refresh, che non è un accesso. Per bloccare un account già connesso, disabilitalo con `PUT /api/admin/users/:uid { disabled: true }`: questo rifiuterà ogni accesso e refresh, terminando ogni sessione e token associati.

`beforeEmailChange(user, newEmail)` viene eseguito quando un utente autenticato richiede di trasferire il proprio account a un altro indirizzo. Eventuali regole sull'indirizzo applicate alla registrazione in `beforeUserCreate` (ad esempio, solo il proprio dominio) devono essere inserite anche qui, altrimenti un membro potrebbe registrarsi con un indirizzo consentito per poi passare a un qualsiasi altro indirizzo.

Un hook che rifiuta l'operazione (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`) solleva un'eccezione (throw). Il chiamante riceve `400 HOOK_REJECTED` con il messaggio dell'errore, o lo status associato all'errore: un `ApiError` o qualsiasi errore con uno `status` 4xx.
:::

### Protezione bot

Il rate limiting limita un singolo chiamante. Mille indirizzi che inviano ciascuno una singola richiesta non supereranno mai una finestra per-IP — e `/auth/register`, `/auth/forgot-password` e `/auth/magic-link` inviano tutti email, quindi il costo di un form non protetto viene pagato in termini di reputazione del dominio di invio.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Oppure dalle variabili di ambiente, che è la modalità prevista per un deployment gestito:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Il client invia il token del widget come `captchaToken` nel corpo JSON, oppure nell'header proprietario del widget `cf-turnstile-response` / `h-captcha-response`. Sono accettati entrambi; imposta `tokenField` per utilizzare una chiave diversa nel corpo.

**`login` non è protetto per impostazione predefinita.** Un challenge a ogni accesso grava su tutti gli utenti reali, e la prevenzione del credential stuffing è affidata al rate limiter e al blocco dell'account. Aggiungilo a `routes` se desideri proteggerlo.

`POST /auth/anonymous/link`, in cui un ospite riceve un'email e una password, è considerato una registrazione: richiede il challenge `register` ed esegue `beforeUserCreate`, esattamente come `/auth/register`. L'accesso ospite in sé (`POST /auth/anonymous`) non richiede alcun challenge.

#### Modalità di fallimento protetto (Fail-closed)

Se il provider non è raggiungibile, la verifica fallisce e la richiesta viene rifiutata. Un attaccante in grado di causare tale disservizio potrebbe altrimenti disattivare la protezione, cosa che un challenge non deve assolutamente permettere.

Il prezzo da pagare è che un'interruzione del provider blocca le registrazioni. Si tratta di un problema evidente, visibile e risolvibile rimuovendo una singola chiave di configurazione — un fallimento preferibile a uno silenzioso, riscontrato solo quando il dominio di posta finisce in una blocklist.

#### Un errore di configurazione impedisce l'avvio

`enabled: true` senza provider, con un provider sconosciuto o senza segreto impedisce l'avvio. Un challenge silenziosamente assente quando la configurazione ne dichiara la presenza è l'unico errore inaccettabile in questo scenario.

Al chiamante viene solo comunicato che il challenge è fallito — mai se il token era assente, non valido, già utilizzato o non verificabile. Il motivo specifico viene registrato nei log, poiché comunicarlo a uno script gli indicherebbe come aggirare la protezione.

### Email durante lo sviluppo

Senza `SMTP_HOST`, le email di autenticazione non hanno una destinazione. Anziché rifiutare la richiesta, un server di sviluppo intercetta il messaggio e ne stampa i link:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Seguendo il link, il flusso si completa su qualsiasi pagina gestisca quel percorso: il CMS gestisce `/reset-password`, `/verify-email`, `/confirm-email-change` e `/auth/magic-link` per i magic link; un frontend differente necessita di una propria pagina dedicata per ciascuno (consulta la sezione [Magic Links](/docs/sdk/authentication/#magic-links) dell'SDK). Nulla cambia riguardo al token — viene generato, archiviato e validato esattamente come avverrebbe da una reale casella di posta; cambia unicamente la modalità di recapito.

Questa modalità è attiva quando sono soddisfatte tutte e tre le seguenti condizioni, e non esiste impostazione che possa modificarle:

- `SMTP_HOST` non è impostato — un mail server configurato ha sempre la precedenza;
- `NODE_ENV` non è `production`. Un'email intercettata di reimpostazione password contiene un token di reset funzionante, pertanto il buffer di cattura funge da archivio credenziali e non deve esistere in produzione;
- `FRONTEND_URL` è un URL `http(s)` assoluto, poiché altrimenti il link inviato via email non avrebbe una base valida e risulterebbe inutilizzabile.

Se una qualsiasi di queste condizioni non è soddisfatta, `POST /auth/magic-link` e `POST /auth/forgot-password` rispondono con `503 EMAIL_NOT_CONFIGURED` come in precedenza. In produzione, imposta `SMTP_HOST` (o `auth.email.sendEmail`) per inviare realmente le email.

#### Leggere le email intercettate senza terminale

I log sono utili solo per chi li sta monitorando direttamente. Un server in esecuzione su Docker, una seconda finestra o una riga scorsa via possono far perdere il link stampato — per questo motivo gli stessi messaggi intercettati sono accessibili via HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Ogni messaggio include `to`, `subject`, `at`, le parti `html` e `text`, e `links` — gli URL assoluti trovati nel corpo, nell'ordine del documento, che costituiscono la parte di effettivo interesse.

Richiede l'ambito `users:write`, attraverso lo stesso meccanismo di protezione utilizzato da cron, log e backup, e risponde con `501 DEV_MAILBOX_UNAVAILABLE` quando non c'è nulla da mostrare — con SMTP configurato, le email vengono recapitate anziché trattenute. `NODE_ENV=production` ne rifiuta l'accesso a prescindere da qualsiasi altra configurazione: il contenuto di questi messaggi consente un accesso funzionante.

### Codici monouso via email

Un magic link apre la sessione sul dispositivo in cui si trova la casella di posta. È il dispositivo ideale su un laptop, ma inadatto ovunque altrove — una televisione, un terminale, un secondo browser, un chiosco. Un codice supera questo limite, poiché è la persona stessa a trasferirlo.

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

L'indirizzo viene reinviato insieme al codice, e non si tratta di una semplice comodità. Ciò che viene memorizzato è un hash dell'indirizzo *e* del codice combinati, così un tentativo di indovinare è mirato contro un singolo account specifico — non contro tutti gli account della tabella contemporaneamente, come avverrebbe con una ricerca basata unicamente sul codice tra un milione di possibilità.

Gli altri fattori che rendono sufficienti sei cifre:

- **Dieci minuti** di validità e utilizzo singolo.
- **Cinque tentativi di verifica per indirizzo per finestra temporale**, indicizzati sull'indirizzo anziché sull'IP del chiamante: l'IP può essere facilmente ruotato dall'attaccante, mentre l'account sotto attacco no. I conteggi risiedono nello store di rate-limit del deployment — per replica per impostazione predefinita, condivisi con `REBASE_RATE_LIMIT_STORE=sql`.
- **Cifre uniformi**, generate da `randomInt` anziché da un'operazione di modulo su byte casuali.
- `POST /auth/otp` risponde in modo identico per un indirizzo che non ha un account, impedendo di verificare se qualcuno sia un cliente.

Leggere un codice dalla casella di posta dimostra il possesso dell'indirizzo, pertanto un accesso riuscito lo contrassegna come verificato — esattamente come accade seguendo un magic link. Su un account non ancora verificato, questa prima prova rimuove anche ciò che nessuno ha mai verificato: la password e ogni identità collegata il cui provider non ha confermato l'indirizzo. Consulta [Collegamento degli account tra metodi di accesso](#collegamento-degli-account-tra-metodi-di-accesso).

### Personalizzazione grafica delle email predefinite

I template predefiniti per la reimpostazione della password, la verifica, gli inviti, il benvenuto, i magic link e la modifica dell'email mostrano un logo sopra la scheda informativa. Questo proviene da `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Deve trattarsi di un file **PNG o JPG situato su un URL `http(s)` assoluto**. I client di posta non eseguono il rendering dei file SVG e bloccano gli URI `data:`, inoltre l'immagine viene recuperata dal client del destinatario anziché dal tuo server — quindi un percorso relativo, un data URI o un file locale non mostrerà alcun logo invece di un'immagine danneggiata. `appName` viene utilizzato come testo `alt`, consentendo ai client con immagini disattivate di visualizzare comunque il nome.

Il fallback è deliberatamente asimmetrico. `appName` ricade su `Rebase`, ma il logo ricade sul marchio Rebase solo finché l'installazione **non** è stata rinominata. Impostando `appName` su un qualsiasi altro valore, non verrà mostrato alcun logo finché non configuri `logoUrl` — altrimenti gli utenti di Acme riceverebbero il logo Rebase in email firmate dal dominio di Acme.

Se sostituisci un template tramite `email.templates`, nulla di tutto ciò si applica: la tua funzione gestisce l'intero corpo del messaggio. `templates.emailChange(confirmUrl, user, newEmail)` è il link inviato al nuovo indirizzo quando un utente modifica il proprio, e `templates.emailChangeNotice(user, newEmail)` è la notifica inviata al vecchio indirizzo; in entrambi i casi, `user.email` rappresenta l'indirizzo attuale.

### Provider OAuth

Ogni provider OAuth viene configurato almeno con un `clientId`. Alcuni provider richiedono anche un `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", bundleIds: ["..."], teamId: "...", keyId: "...", privateKey: "..." },
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

#### I formati delle variabili di ambiente

Un deployment gestito o basato su bundle non dispone di un blocco `auth` in cui scrivere — configura il server interamente tramite le variabili di ambiente — pertanto ogni provider sopra indicato prevede una coppia `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, ed entrambe le parti devono essere impostate affinché il provider sia effettivamente configurato:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` elenca quindi `discord` in `enabledProviders`, consentendo di verificare che la coppia sia stata caricata.

Google si configura unicamente tramite `GOOGLE_CLIENT_ID`: il suo flusso basato su ID token non richiede un secret, pertanto `GOOGLE_CLIENT_SECRET` è facoltativo.

Apple non prevede un client secret: Rebase firma un JWT ES256 per ogni scambio. Richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY` (il contenuto del file `.p8`, inclusi i ritorni a capo), oltre a `APPLE_CLIENT_ID` (il Services ID, per il web), `APPLE_BUNDLE_IDS` (gli ID separati da virgola delle tue app native iOS e macOS), o entrambi. Il Services ID è pubblico, quindi `/auth/config` lo espone per il pulsante **Sign in with Apple** del pannello di amministrazione.

Due opzioni non hanno una variabile di ambiente corrispondente e richiedono il blocco `auth` (quindi un backend sottoposto a eject o configurato via codice): `microsoft.tenantId`, che altrimenti ha come valore predefinito `common` e accetta qualsiasi tenant Entra (con qualsiasi tenant, un indirizzo è considerato verificato solo quando la registrazione dell'app emette il claim `xms_edov`), e `gitlab.baseUrl`, per un'istanza self-hosted.

Ogni campo denominato viene risolto all'avvio all'interno di `auth.providers`, che rappresenta l'array canonico e il punto di estensione per tutto ciò che i campi denominati non coprono. Le voci vengono create con le factory `create*Provider` e le due forme si uniscono — i campi denominati vengono aggiunti in coda alle voci esplicite:

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Limitare gli URI di reindirizzamento

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

Se non impostato, l'unico controllo sul reindirizzamento OAuth è la corrispondenza con gli URI registrati presso il provider stesso — il che autorizza **qualsiasi** URI registrato su quel client OAuth, inclusa la voce `localhost` aggiunta per lo sviluppo e l'host di staging che nessuno ha rimosso. Elencare le origini effettivamente gestite da questo backend ne limita l'accettazione a esse. Gli URI vengono confrontati in base a origine e percorso; query string, frammento e barra finale (trailing slash) vengono ignorati.

### Collegamento degli account tra metodi di accesso

Cosa succede quando qualcuno si registra con email/password come `ada@example.com`, e in seguito clicca su "Accedi con Google" con un account Google avente lo stesso indirizzo? Rebase **collega i due accessi in un unico account**, ma solo se il provider attesta che l'email è verificata. Non crea mai silenziosamente un secondo account per lo stesso indirizzo.

Su `POST /api/auth/<provider>` l'ordine di risoluzione è il seguente:

1. **Identità del provider nota**: se questa esatta identità del provider ha già effettuato l'accesso in precedenza, viene restituito quell'utente. L'email non viene consultata.
2. **Account esistente con la stessa email, provider ha verificato l'email**: l'identità viene associata e l'utente viene autenticato in quell'account. Un solo account, due modalità di accesso. Un account non verificato viene prima verificato (vedi sotto).
3. **Account esistente con la stessa email, provider non l'ha verificata**: rifiutato con `403 EMAIL_NOT_VERIFIED` e `details.reason` impostato su `provider-email-unverified`. Non viene creato o modificato nulla.
4. **Nessun account con quell'email**: viene creato un nuovo account, contrassegnato come verificato se il provider ne ha confermato l'email.

Il passaggio 3 rappresenta il caso critico per la sicurezza. Se un'email del provider non verificata fosse sufficiente per il collegamento, chiunque riuscisse a farsi emettere da un provider un indirizzo non proprio potrebbe assumere il controllo del corrispondente account Rebase. Google attesta sempre `email_verified` per i veri account Google, pertanto il passaggio 2 è il normale percorso per l'accesso con Google; il passaggio 3 intercetta principalmente quei provider che consentono agli utenti di specificare un indirizzo arbitrario non confermato.

Anche la situazione dell'account è fondamentale. Nulla verifica l'indirizzo fornito a `POST /auth/register`, quindi chiunque potrebbe registrare l'indirizzo di qualcun altro con una password, oppure accedervi tramite un provider che non ne garantisce la verifica, e attendere. Il collegamento dell'accesso Google del legittimo proprietario a tale account non deve lasciare attiva la via di accesso dell'altra persona.

Un provider che ha verificato l'indirizzo, un link di verifica, un magic link, un codice via email o una reimpostazione della password dimostrano tutti il possesso dell'indirizzo e verificano l'account. Su un account non ancora verificato, la prima prova di questo tipo rimuove la password (un reset ne imposta una nuova) e ogni identità collegata il cui provider non ha verificato quell'indirizzo, terminando inoltre tutte le sessioni prima di contrassegnare l'account come verificato: una password che nessuno ha verificato scompare dopo il primo accesso con Google.

Un link di verifica mantiene ciò che la persona che lo segue dimostra di possedere: una sessione attiva dell'account o la sua password. Consulta [Verifica dell'email](/docs/backend/email-verification/). Gli account creati da un amministratore con `POST /api/admin/users` vengono memorizzati come verificati, così un utente invitato può utilizzare immediatamente "Accedi con Google". Un repository di autenticazione personalizzato senza `unlinkUserIdentity` rifiuta tale verifica con `409 UNVERIFIED_IDENTITIES` qualora sia presente un'identità da rimuovere.

Questo comportamento non è configurabile — non esiste volutamente alcuna opzione per collegare account su email non verificate.

### Verifica dell'email

La registrazione invia al nuovo account un link di verifica; seguirlo mantiene solo ciò che la persona che lo segue è in grado di dimostrare. `requireEmailVerification` impone la conferma prima del completamento della registrazione. Consulta [Verifica dell'email](/docs/backend/email-verification/).

## Tabelle create automaticamente

Al primo avvio, Rebase effettua automaticamente il provisioning dello schema `rebase` e delle seguenti tabelle nel database (associate allo schema definito nella tua collection, ad es. `rebase`):

- **`rebase.users`** — Account utente con email, hash della password, metadati e una colonna text[] denominata `roles` (i ruoli sono archiviati come array di testo inline per ottimizzare le query ed evitare join).
- **`rebase.user_identities`** — Le identità OAuth collegate a ciascun account, una riga per identità del provider.
- **`rebase.refresh_tokens`** — Sessioni persistenti che contengono gli hash dei refresh token, user agent e indirizzi IP. Include un indice univoco su `token_hash`. Un accesso corrisponde a un `session_id`, condiviso da ogni token generato a seguito della rotazione; non esistono vincoli per dispositivo, quindi due browser associati allo stesso indirizzo rappresentano due sessioni distinte. Ogni token di una sessione include anche il relativo livello di garanzia (`aal`) e il metodo con cui è stato eseguito l'accesso (`method`, riportato da `providerId`).
- **`rebase.password_reset_tokens`** — Token monouso con scadenza per i flussi di recupero della password.
- **`rebase.magic_link_tokens`** — Token monouso con scadenza per l'accesso tramite magic link.
- **`rebase.mfa_factors`** — Metodi di autenticazione a più fattori registrati (ad es. segreti TOTP crittografati con AES-256).
- **`rebase.mfa_challenges`** — Log di verifica che tracciano i tentativi attivi di verifica MFA.
- **`rebase.recovery_codes`** — Codici di backup/recupero multi-fattore con hash.
- **`rebase.app_config`** — Archivio chiave-valore per le configurazioni di sistema.

I token soggetti a scadenza — link di reimpostazione, magic link e codici email, refresh token, challenge MFA — vengono eliminati un'ora dopo la loro scadenza. La pulizia (sweep) viene eseguita sui processi responsabili dei timer (tutti i ruoli tranne `functions` in un deployment suddiviso, a meno che `REBASE_CRON_SCHEDULER=false` non li rimuova da `api`) e su una sola istanza del cluster: ogni ora viene riservata in `rebase.cron_claims` con il job id `rebase:auth:expired-tokens`, proprio come uno slot cron. Con `cronPersistence: false` non è presente alcuna tabella di prenotazione delle esecuzioni (claims) e ogni istanza idonea esegue la pulizia. Un token scaduto viene rifiutato quando presentato, a prescindere dall'avvenuta esecuzione della pulizia; lo sweep serve unicamente a evitare l'aumento delle dimensioni delle tabelle.

## Bootstrap del primo utente

Quando non sono presenti utenti nel database e il server **non** è in esecuzione con `NODE_ENV=production`, la prima persona che si registra diventa automaticamente un amministratore. Successivamente, la registrazione è regolata dall'impostazione `allowRegistration`.

In produzione questa finestra è chiusa, poiché un host con un nome di dominio pubblico è raggiungibile prima che il suo operatore si sia registrato, e chiunque arrivasse per primo ne assumerebbe il controllo. Un deployment di produzione definisce invece il suo primo amministratore tramite l'ambiente — `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, creati all'avvio quando la tabella è ancora vuota — oppure assegna il ruolo tramite la chiave di servizio. Con la finestra chiusa, una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED` (segnalandolo espressamente), un primo account creato tramite registrazione aperta è un normale account utente, `GET /api/auth/config` non restituisce mai `needsSetup`, `POST /api/admin/bootstrap` viene rifiutata e il log di avvio segnala un avviso quando la tabella è vuota e nessun amministratore è stato specificato.

In ambiente locale (ad esempio su un laptop) questo significa poter sempre eseguire il bootstrap di un nuovo database senza doverlo popolare manualmente. Per prevenire esecuzioni concorrenti e race condition nella generazione dello schema durante l'hot reload (HMR) o l'avvio, le operazioni di bootstrap vengono sincronizzate tramite un advisory lock di Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configurazione dell'autenticazione a livello di collection

Anziché affidarsi unicamente alle regole di autenticazione predefinite del database, è possibile contrassegnare qualsiasi collection Postgres (come `users.ts` o una collection personalizzata `members.ts`) come collection di autenticazione. Questo si configura tramite la proprietà `auth` sulla collection stessa:

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
    },

    // What each role may do beyond its rows, the app's own scopes,
    // and whether accounts may create personal API keys
    roles: {
      support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] }
    },
    scopes: {
      "project:deploy": { label: "Deploy projects", target: "project" }
    },
    personalKeys: true
  },
  properties: { ... }
});
```

`roles`, `scopes` e `personalKeys` dichiarano il modello di accesso: quali ambiti del piano admin spettano a ciascun ruolo, gli ambiti definiti dall'applicazione per le proprie operazioni e se ciascun account può generare [chiavi API personali](/docs/backend/api-keys/#personal-keys). Consulta [Ruoli e ambiti](/docs/backend/roles-and-scopes/).

Un valore `temporaryPassword` restituito da `onResetPassword` diventa la password dell'account. Rebase ne calcola l'hash con l'algoritmo configurato, la salva, disconnette l'utente da ogni sessione attiva e la mostra all'amministratore per poterla comunicare. L'hook non la memorizza e non ha modo di farlo. Non restituire alcun `temporaryPassword` se l'hook invia invece un proprio link di reset via email: in questo caso la password rimane invariata finché l'utente non ne imposta una nuova, ma le sessioni vengono comunque terminate.

Quando gli hook personalizzati (`onCreateUser`, `onResetPassword`) vengono chiamati, ricevono una facciata `AuthCollectionContext` contenente:
- `hashPassword(password: string): Promise<string>` — Calcola l'hash della password utilizzando l'algoritmo di hashing configurato (ad es. scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Invia un'email (disponibile solo quando il servizio email è configurato). Si risolve con i dati restituiti dal provider — `messageId`, `accepted`, `rejected` — consentendo all'hook di memorizzare l'ID e successivamente tracciare una risposta collegata.
- `emailConfigured: boolean` — Indica se il servizio email è configurato.
- `appName: string` — Il nome dell'applicazione specificato nella configurazione email.
- `resetPasswordUrl: string` — L'URL di base per il link di reimpostazione della password.

## Prossimi passi

- **[Endpoint e token](/docs/backend/auth-endpoints/)** — tutte le route montate da questa configurazione
- **[Ruoli e ambiti](/docs/backend/roles-and-scopes/)** — cosa può fare ciascun ruolo, e come chiavi e token possono limitarlo
- **[Adattatori di autenticazione personalizzati](/docs/backend/auth-adapters/)** — integrazione del proprio identity provider
- **[Autenticazione frontend](/docs/frontend/authentication/)** — interfaccia di login, controller di autenticazione, gestione utenti
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — controllo degli accessi a livello di riga
- **[Autenticazione nell'SDK tipizzato](/docs/sdk/authentication/)** — metodi di autenticazione nell'SDK tipizzato
