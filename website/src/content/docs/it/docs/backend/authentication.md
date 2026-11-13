---
sourceHash: 71a134ba2ec7ae97
title: Autenticazione
sidebar_label: Autenticazione
description: Configura l'autenticazione JWT, i provider OAuth, le email SMTP, la protezione dai bot e la tabella utenti sul backend Rebase.
---

L'autenticazione è divisa in tre pagine, poiché comprende tre compiti distinti. Questa pagina riguarda la **configurazione**: cosa inserire nel blocco `auth` e nell'ambiente.

- [Endpoint e token](/docs/backend/auth-endpoints/) — le route montate dal backend, la struttura delle risposte, MFA, il contesto del database visibile a una policy, JWKS e chiavi di servizio.
- [Adattatori di autenticazione personalizzati](/docs/backend/auth-adapters/) — sostituire il provider integrato con Clerk, Firebase Auth o una soluzione proprietaria.

## Panoramica

Rebase include un sistema di autenticazione backend completo:

- **Token JWT** — Flusso di token di accesso e refresh con scadenza configurabile
- **Provider OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e altri
- **Email SMTP** — Flussi di reimpostazione della password e verifica dell'email
- **Hook di autenticazione** — Hook del ciclo di vita per la creazione dell'utente e altro
- **Adattatori di autenticazione personalizzati** — Integrazione con Firebase Auth, Auth0, Clerk o qualsiasi provider esterno
- **Service key** — Chiave statica per l'autenticazione server-to-server
- **Auto-bootstrapping** — Al di fuori della produzione, il primo utente riceve automaticamente il ruolo di amministratore; un deployment in produzione definisce il proprio admin tramite `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configurazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

:::note[Dove va inserito]
**Runtime gestito:** ambiente — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` e le coppie `*_CLIENT_ID` / `*_CLIENT_SECRET` dei provider, una per ciascuno dei dodici provider ([le sintassi](#le-variabili-dambiente); per Apple sono quattro chiavi, non una coppia). La tabella degli utenti è la [`defineAuthTable`](#la-tabella-utenti) esportata da `backend/schema/index.ts`.
**Nessuna route gestita:** `auth.hooks`. Sono funzioni; effettua l'eject per passarle.
**Con eject:** `initializeRebaseBackend({ auth })` in `backend/src/index.ts`.
:::

Il blocco `auth` in `initializeRebaseBackend` controlla l'intera autenticazione del backend:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
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
| `jwtSecret` | `string` | — | Chiave segreta di firma HS256. Obbligatoria in produzione |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Chiavi di firma asimmetriche — consulta [Token asimmetrici e JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | prima chiave | Quale tra le `signingKeys` emette nuovi token |
| `accessExpiresIn` | `string` | `1h` | Durata del token di accesso |
| `refreshExpiresIn` | `string` | `30d` | Durata del refresh token. A scorrimento: ogni rotazione lo rinnova, quindi rappresenta per quanto tempo una sessione sopravvive all'**inattività**. Il runtime passa `JWT_REFRESH_EXPIRES_IN`, che per impostazione predefinita è anch'esso `30d`. I browser limitano il cookie di refresh a 400 giorni, quindi un valore più lungo non porta alcun vantaggio in modalità cookie |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Per quanto tempo un refresh token già ruotato può ancora emettere un duplicato della sua sessione, in modo che un client che ha perso una risposta di refresh non venga disconnesso |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Cosa accade a un refresh token presentato oltre tale finestra temporale. `"reject"` lo rifiuta (`TOKEN_ALREADY_USED`) e lo registra nei log, mantenendo la sessione valida: non si tratta di reuse detection, poiché chi ha effettuato il refresh per primo mantiene la sessione. `"revoke-session"` termina l'intero accesso in caso di replay di questo tipo (`SESSION_REVOKED`), come fa GoTrue, e l'utente deve accedere nuovamente. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Richiede una sessione per le API dati |
| `allowRegistration` | `boolean` | `false` | Apre `POST /api/auth/register`. Al di fuori della produzione il primo utente su una tabella vuota viene ammesso in entrambi i casi; in produzione l'admin viene definito con `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Interruttore di emergenza (kill switch): chiude anche la finestra di bootstrap per il primo utente che `allowRegistration: false` lascerebbe aperta |
| `allowAnonymous` | `boolean` | `false` | Abilita `POST /api/auth/anonymous`. Volutamente non vincolato da `allowRegistration` — un'applicazione pubblica per lo più in sola lettura potrebbe richiedere sessioni senza account. Trasformare un ospite in un account (`POST /api/auth/anonymous/link`) è una registrazione e richiede anch'esso `allowRegistration` — e `allowAnonymous` ancora attivo: se disattivato, rifiuta anche gli ospiti già autenticati, impedendo a chiunque di convertirsi in un account (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` per i flussi di invito tramite email |
| `captcha` | `CaptchaConfig` | — | Protezione dai bot sulle route che inviano email — consulta [Protezione dai bot](#protezione-dai-bot) |
| `defaultRole` | `string` | — | Ruolo assegnato a un utente appena registrato quando non ne viene specificato alcuno. Non può essere `admin` né un ruolo dichiarato con uno scope a livello di amministrazione: l'avvio rifiuterà entrambi |
| `serviceKey` | `string` | — | Chiave statica per chiamate server-to-server — consulta [Autenticazione con Service Key](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, per reimpostazione della password, verifica, inviti e magic link |
| `magicLink` | `boolean` | `false` | Abilita l'accesso senza password tramite email. Richiede la configurazione di `email`; senza di essa le route rispondono con `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Abilita i codici di accesso a sei cifre via email — consulta [Codici monouso](#codici-monouso-via-email). Stesso requisito di configurazione email |
| `deviceLogin` | `{ verificationUrl: string }` | — | Consente a un terminale o a un altro dispositivo privo di browser di effettuare l'accesso tramite un browser — consulta [Accesso da dispositivo](/docs/backend/device-sign-in/). Richiede un database SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Registrazione senza password: una richiesta di magic-link o di codice email per un indirizzo senza account ne crea uno (senza password, non verificato finché il link o codice non viene utilizzato), purché `allowRegistration` sia attivo. Esegue `beforeUserCreate` e assegna il ruolo predefinito. Se disabilitato, queste richieste non creano nulla e rispondono a un indirizzo sconosciuto esattamente come a uno noto. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Rifiuta l'accesso con password finché l'indirizzo non è verificato, e impone la conferma preliminare alla registrazione — consulta [Verifica dell'email](/docs/backend/email-verification/). Richiede `email`; in caso contrario l'avvio viene rifiutato |
| `cookieAuth` | `CookieAuthConfig \| false` | attivo | Fornisce il refresh token come cookie `httpOnly` `Secure` `SameSite` invece che nel corpo JSON; `false` lo restituisce nel corpo — vedi sotto |
| `providers` | `OAuthProvider[]` | `[]` | L'array OAuth canonico; i campi dei provider denominati confluiscono in esso |
| `allowedRedirectUris` | `string[]` | — | Limita i redirect URI accettati dalle route OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh token in un cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Il refresh token è la credenziale a lunga durata e, se presente nel corpo della risposta, qualsiasi vulnerabilità XSS nella pagina potrebbe leggerlo. `cookieAuth` lo mantiene in un cookie inaccessibile agli script della pagina: attivo a meno che non venga disabilitato esplicitamente, sempre presente nel runtime e, a partire dalla versione 0.30, in `initializeRebaseBackend`. Il token di **accesso** rimane nel corpo della risposta, per essere usato nell'header `Authorization`. Una richiesta con `x-rebase-auth-flow: json` riceve il refresh token nel corpo; con `cookieAuth: false` lo riceve qualsiasi richiesta, e un client browser richiede `authFlowMode: "json"`.

Due aspetti devono necessariamente seguire, altrimenti l'accesso si interrompe invece di degradare normalmente: le chiamate fetch del client verso gli endpoint di autenticazione devono includere `credentials: "include"`, e CORS deve autorizzare le credenziali — il che implica un elenco esplicito di origini, mai `origin: "*"`. `AUTH_COOKIE_SAME_SITE` è la variabile d'ambiente per `sameSite`, e `AUTH_COOKIE_SECURE` per `secure`.

Il cookie include `Secure` a meno che non venga disattivato esplicitamente, e nessun elemento della richiesta può dedurlo: leggendolo dal protocollo della richiesta, che è `http` dietro a qualsiasi proxy con terminazione TLS, il token verrebbe inviato in testo non cifrato. `AUTH_COOKIE_SECURE=false` è l'unica via d'uscita per un deployment erogato su semplice protocollo http (un indirizzo LAN, un'appliance), e genera un avviso all'avvio. `http://localhost` non ne ha bisogno.

| Chiave | Predefinito | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | dominio corrente | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` è solo per un frontend genuinamente cross-site |
| `secure` | `true` | Protetto per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per http non cifrato |

:::caution[Gli hook di tabella non scattano per gli utenti di autenticazione]
La creazione e gli aggiornamenti degli utenti tramite il sistema di autenticazione — registrazione, gestione utenti da parte dell'admin e OAuth — scrivono **direttamente** nello store utenti e bypassano la pipeline di salvataggio della tabella. Un hook `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` sulla tabella utenti **non** verrà eseguito per questi percorsi. Per effetti collaterali come il provisioning di un team personale alla registrazione, usa gli hook del ciclo di vita dell'autenticazione (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), che ricevono il record utente completo.

OAuth esegue gli stessi hook degli altri tipi di accesso: `beforeLogin` (con l'indirizzo del provider e `"oauth"`), `beforeUserCreate` quando l'accesso crea l'account, `afterUserCreate`, e `onAuthenticated`. `onAuthenticated` viene attivato anche in occasione di un refresh del token (`"refresh"`), un reset della password (`"password-reset"`) e un secondo fattore (`"mfa"`). `beforeLogin` non viene eseguito al refresh, che non è un'operazione di accesso. Per bloccare un account già connesso, disabilitalo con `PUT /api/admin/users/:uid { disabled: true }`: questo rifiuterà ogni accesso e refresh e terminerà ogni sessione e token associati.

`beforeEmailChange(user, newEmail)` viene eseguito quando un utente autenticato richiede di trasferire il proprio account a un altro indirizzo. Un vincolo sull'indirizzo imposto alla registrazione in `beforeUserCreate` (ad esempio consentendo solo il proprio dominio) deve essere applicato anche qui, altrimenti un utente potrebbe registrarsi con un indirizzo valido e poi passare a un qualsiasi altro indirizzo.

Un hook che rifiuta l'operazione (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`) genera un'eccezione (throw). Il chiamante riceve `400 HOOK_REJECTED` con il messaggio di errore, oppure lo status associato all'errore: un `ApiError` o qualsiasi errore con uno `status` 4xx.
:::

### Protezione dai bot

Il rate limiting limita un singolo chiamante. Mille indirizzi che inviano una sola richiesta ciascuno non colpiranno mai una finestra basata sull'IP — e `/auth/register`, `/auth/forgot-password` e `/auth/magic-link` inviano tutti email, quindi il conto di un form non protetto si paga in termini di reputazione sul dominio di invio.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

O dall'ambiente, che è la modalità disponibile nei deployment gestiti:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Il client invia il token del widget come `captchaToken` nel corpo JSON, oppure nell'header proprio del widget `cf-turnstile-response` / `h-captcha-response`. Entrambi sono accettati; imposta `tokenField` per utilizzare una chiave diversa nel corpo.

**`login` non è protetto per impostazione predefinita.** Un challenge a ogni accesso penalizzerebbe ogni utente legittimo, e il credential stuffing è contrastato dal rate limiter e dal blocco dell'account (lockout). Aggiungilo a `routes` se desideri proteggerlo.

`POST /auth/anonymous/link`, con cui un utente anonimo riceve un'email e una password, conta come registrazione: applica il challenge di `register` ed esegue `beforeUserCreate`, proprio come `/auth/register`. L'accesso ospite in sé (`POST /auth/anonymous`) non richiede alcun challenge.

#### Comportamento fail-closed

Se il provider non è raggiungibile, la verifica fallisce e la richiesta viene rifiutata. Un aggressore in grado di provocare tale disservizio potrebbe altrimenti disattivare la protezione, che è esattamente ciò che un challenge non deve permettere.

Il costo è che un'interruzione del provider blocca le registrazioni. Si tratta di un problema evidente, visibile e risolvibile rimuovendo una singola chiave di configurazione — un fallimento migliore rispetto a uno silenzioso notato solo quando il dominio email finisce in una blocklist.

#### Una configurazione errata impedisce l'avvio

`enabled: true` senza alcun provider, con un provider sconosciuto o senza chiave segreta impedirà l'avvio del server. Un challenge assente in modo silente mentre la configurazione indica che è attivo è l'unico errore inammissibile in questo contesto.

Al chiamante viene comunicato solo che il challenge è fallito — mai se il token era assente, non valido, già utilizzato o non verificabile. Il motivo effettivo viene registrato nei log, poiché informare uno script significherebbe aiutarlo a perfezionare l'attacco.

### Email in fase di sviluppo

Senza `SMTP_HOST`, le email di autenticazione non hanno una destinazione. Anziché rifiutare la richiesta, un server di sviluppo cattura il messaggio e ne stampa i link:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Seguendo il link, il flusso si completa sulla pagina designata per quel percorso: il CMS gestisce `/reset-password`, `/verify-email`, `/confirm-email-change` e `/auth/magic-link` per i magic link; un altro frontend necessita di una pagina dedicata per ciascuno (consulta la sezione [Magic Links](/docs/sdk/authentication/#magic-links) dell'SDK). Nulla del token cambia — viene generato, memorizzato e validato esattamente come avverrebbe con una vera casella di posta; cambia solo la modalità di recapito.

Questa modalità è attiva ogniqualvolta sussistono tutte e tre le seguenti condizioni, e non esistono impostazioni per modificarle:

- `SMTP_HOST` non è impostato — un server di posta configurato ha sempre la precedenza;
- `NODE_ENV` non è `production`. Un'email di reset password catturata contiene un token di reset funzionante, pertanto il buffer di cattura costituisce un archivio di credenziali e non deve esistere in produzione;
- `FRONTEND_URL` è un URL assoluto `http(s)`, poiché altrimenti il link inviato via email non avrebbe una base e risulterebbe inutilizzabile all'arrivo.

Se una qualsiasi di esse non sussiste, `POST /auth/magic-link` e `POST /auth/forgot-password` rispondono con `503 EMAIL_NOT_CONFIGURED` come di consueto. In produzione, imposta `SMTP_HOST` (o `auth.email.sendEmail`) per inviare realmente le email.

#### Leggere le email catturate senza un terminale

I log sono utili solo a chi li sta osservando. Un server in Docker, una seconda finestra o una riga scorsa via rapidamente possono far perdere un link stampato — per questo la stessa cattura è disponibile via HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Ogni messaggio include `to`, `subject`, `at`, le parti `html` e `text`, e `links` — gli URL assoluti rilevati nel corpo del messaggio, nell'ordine del documento, che è la parte effettivamente d'interesse.

Richiede lo scope `users:write`, attraverso lo stesso controllo utilizzato da cron, log e backup, e risponde con `501 DEV_MAILBOX_UNAVAILABLE` quando non c'è nulla da servire — con SMTP configurato, la posta viene recapitata anziché trattenuta. `NODE_ENV=production` lo rifiuta a prescindere da qualsiasi altra cosa: ciò che questi messaggi contengono è un accesso funzionante.

### Codici monouso via email

Un magic link apre la sessione sul dispositivo che contiene la casella di posta. È il dispositivo giusto su un portatile ed è quello sbagliato in qualunque altro contesto — un televisore, un terminale, un secondo browser, un chiosco. Un codice supera questo divario, perché è la persona a trasportarlo.

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

L'indirizzo viene inviato nuovamente insieme al codice, e non si tratta di una comodità. Ciò che viene memorizzato è un hash dell'indirizzo *e* del codice combinati insieme, in modo che un tentativo di indovinare sia rivolto a un singolo account specificato — e non contro ogni account della tabella contemporaneamente, che è ciò a cui corrisponderebbe una ricerca basata solo sul codice tra un milione di possibilità.

Gli altri fattori che mantengono sufficienti sei cifre:

- **Dieci minuti**, e utilizzo singolo.
- **Cinque tentativi di verifica per indirizzo per finestra**, basati sull'indirizzo anziché sull'IP del chiamante: l'IP può essere ruotato dall'aggressore, mentre l'account preso di mira no. I conteggi risiedono ovunque si trovi lo store del rate-limit del deployment — per replica per impostazione predefinita, condiviso con `REBASE_RATE_LIMIT_STORE=sql`.
- **Cifre uniformi**, generate tramite `randomInt` anziché un modulo di byte casuali.
- `POST /auth/otp` risponde in modo identico per un indirizzo privo di account, evitando così che possa essere utilizzato per verificare se qualcuno è un cliente.

La lettura di un codice dalla casella di posta attesta la titolarità dell'indirizzo, per cui un accesso riuscito lo contrassegna come verificato — esattamente come accade seguendo un magic link. Su un account non ancora verificato, questa prima prova rimuove anche ciò che nessuno ha mai verificato: la password e ogni identità collegata il cui provider non ha verificato l'indirizzo. Consulta [Collegamento degli account](#collegamento-degli-account-tra-diversi-metodi-di-accesso).

### Personalizzare il branding delle email predefinite

I template predefiniti per reimpostazione della password, verifica, invito, benvenuto, magic link e modifica dell'email mostrano un logo sopra la card. Proviene da `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Deve trattarsi di un file **PNG o JPG su un URL assoluto `http(s)`**. I client di posta non supportano gli SVG e bloccano gli URI `data:`, e l'immagine viene scaricata dal client del destinatario anziché dal server — pertanto un percorso relativo, un URI dati o un file locale non mostrerà alcun logo invece di un'immagine corrotta. `appName` viene utilizzato come testo `alt`, cosicché un client con il caricamento delle immagini disattivato mostri comunque il nome.

Il fallback è deliberatamente asimmetrico. `appName` fa fallback su `Rebase`, ma il logo fa fallback sul marchio Rebase solo fintanto che l'installazione **non** è stata rinominata. Se imposti `appName` con un qualsiasi altro valore, non vedrai alcun logo finché non imposti `logoUrl` — altrimenti gli utenti di Acme riceverebbero il logo Rebase in email firmate dal dominio di Acme.

Se sostituisci un template tramite `email.templates`, nulla di tutto ciò si applica: la tua funzione gestisce l'intero corpo del messaggio. `templates.emailChange(confirmUrl, user, newEmail)` è il link inviato al nuovo indirizzo quando un utente modifica il proprio, e `templates.emailChangeNotice(user, newEmail)` è la notifica inviata al vecchio indirizzo; in entrambi i casi `user.email` rappresenta l'indirizzo attuale.

### Provider OAuth

Ciascun provider OAuth è configurato almeno con un `clientId`. Alcuni provider richiedono un `clientSecret`:

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

#### Le variabili d'ambiente

Un deployment gestito o bundled non ha un blocco `auth` in cui scrivere — configura il server interamente tramite le variabili d'ambiente — quindi ogni provider sopra elencato dispone di una coppia `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, ed entrambe le parti devono essere impostate affinché il provider risulti effettivamente configurato:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` elenca quindi `discord` in `enabledProviders`, consentendo di verificare che la coppia sia stata caricata correttamente.

Google è configurato con il solo `GOOGLE_CLIENT_ID`: il suo flusso basato su ID token non richiede segreti, quindi `GOOGLE_CLIENT_SECRET` è facoltativo.

Apple non prevede un client secret: Rebase firma un JWT ES256 per ciascuno scambio. Richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY` (il contenuto del file `.p8`, inclusi gli a capo), oltre a `APPLE_CLIENT_ID` (il Services ID, per il web), `APPLE_BUNDLE_IDS` (gli ID separati da virgola delle tue app native iOS e macOS), o entrambi. Il Services ID è pubblico, quindi `/auth/config` lo espone per il pulsante **Accedi con Apple** dell'amministratore.

Due opzioni non hanno una variabile d'ambiente equivalente e richiedono il blocco `auth` (dunque un backend con eject o configurato via codice): `microsoft.tenantId`, che altrimenti ha come valore predefinito `common` e accetta qualsiasi tenant Entra (con qualsiasi tenant, un indirizzo è considerato verificato solo se la registrazione dell'app emette il claim `xms_edov`), e `gitlab.baseUrl`, per un'istanza self-hosted.

Ogni campo denominato viene risolto all'avvio in `auth.providers`, che costituisce l'array canonico e il punto di estensione per tutto ciò che i campi denominati non coprono. Le voci vengono create con le factory `create*Provider`, e le due forme si uniscono — i campi denominati vengono aggiunti in coda alle voci esplicite:

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Limitare i redirect URI

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

Se lasciato non configurato, l'unico controllo sul redirect OAuth è la corrispondenza dell'URI registrato sul provider stesso — il che autorizza **qualsiasi** URI registrato su quel client OAuth, inclusa la voce `localhost` aggiunta da qualcuno per lo sviluppo e l'host di staging che nessuno ha rimosso. Elencare le origini effettivamente servite da questo backend restringe l'autorizzazione a esse. Gli URI vengono confrontati su origine più percorso; parametri di query, frammenti e trailing slash vengono ignorati.

### Collegamento degli account tra diversi metodi di accesso

Cosa succede quando qualcuno si registra con email/password come `ada@example.com`, e in seguito clicca su "Accedi con Google" con un account Google associato allo stesso indirizzo? Rebase **collega i due in un unico account**, ma solo quando il provider certifica l'email come verificata. Non crea mai silenziosamente un secondo account per lo stesso indirizzo.

Su `POST /api/auth/<provider>` l'ordine di risoluzione è:

1. **Identità provider nota**: se questa identità provider specifica ha già effettuato l'accesso in precedenza, viene restituito quell'utente. L'email non viene consultata.
2. **Account esistente con la stessa email, provider ha verificato l'email**: l'identità viene collegata e l'utente viene autenticato in quell'account. Un unico account, due modalità di accesso. Un account non verificato viene prima verificato (vedi sotto).
3. **Account esistente con la stessa email, provider non l'ha verificata**: rifiutato con `403 EMAIL_NOT_VERIFIED` e `details.reason` impostato su `provider-email-unverified`. Nulla viene creato o modificato.
4. **Nessun account con quell'email**: viene creato un nuovo account, verificato se il provider ha verificato l'email.

Il passaggio 3 è il caso critico per la sicurezza. Se un'email non verificata dal provider fosse sufficiente per effettuare il collegamento, chiunque fosse in grado di indurre un provider a emettere un indirizzo non di sua proprietà potrebbe appropriarsi del corrispondente account Rebase. Google certifica sempre `email_verified` per i veri account Google, quindi il passaggio 2 è il normale percorso per l'accesso Google; il passaggio 3 intercetta principalmente i provider che consentono agli utenti di specificare un indirizzo non confermato arbitrario.

Anche il lato account è importante. Nulla verifica l'indirizzo fornito a `POST /auth/register`, quindi chiunque può registrare l'indirizzo di qualcun altro con una password, o accedere con esso tramite un provider che non ne garantisce la titolarità, e attendere. Collegare l'accesso Google del legittimo proprietario a tale account non deve lasciare attiva la via d'accesso dell'altra persona.

Un provider che ha verificato l'indirizzo, un link di verifica, un magic link, un codice email o una reimpostazione della password attestano tutti la titolarità dell'indirizzo e verificano l'account. Su un account non ancora verificato, la prima prova di questo tipo rimuove la password (un reset imposta quella nuova) e ogni identità collegata il cui provider non ha verificato quell'indirizzo, e termina tutte le sessioni, prima di contrassegnare l'account come verificato: una password che nessuno ha verificato scompare dopo il primo accesso con Google.

Un link di verifica preserva solo ciò che la persona che lo segue è in grado di dimostrare: una sessione attiva dell'account, o la sua password. Consulta [Verifica dell'email](/docs/backend/email-verification/). Gli account creati da un amministratore con `POST /api/admin/users` vengono salvati come già verificati, cosicché un utente invitato possa utilizzare immediatamente "Accedi con Google". Un repository di autenticazione personalizzato privo di `unlinkUserIdentity` rifiuta tale prova con `409 UNVERIFIED_IDENTITIES` quando c'è un'identità da rimuovere.

Questo comportamento non è configurabile — non esiste volutamente alcuna opzione per consentire il collegamento su email non verificate.

### Verifica dell'email

La registrazione invia al nuovo account un link di verifica, e seguendolo viene preservato solo ciò che la persona che lo segue è in grado di dimostrare. `requireEmailVerification` impone che la registrazione richieda prima la conferma. Consulta [Verifica dell'email](/docs/backend/email-verification/).

## Tabelle create automaticamente

Al primo avvio, Rebase esegue automaticamente il provisioning dello schema `rebase` e delle seguenti tabelle nel database:

- **`rebase.users`** — Account utente con email, hash della password, metadati e una colonna `roles` text[] (i ruoli sono memorizzati come array di testo inline per ottimizzare le query ed evitare join).
- **`rebase.user_identities`** — Le identità OAuth collegate a ciascun account, una riga per identità di provider.
- **`rebase.refresh_tokens`** — Sessioni a lunga durata contenenti hash dei refresh token, user agent e indirizzi IP. Include un indice univoco su `token_hash`. Un accesso corrisponde a un `session_id`, condiviso da ogni token ruotato da esso; non vi è alcun vincolo per dispositivo, quindi due browser dietro lo stesso indirizzo costituiscono due sessioni. Ogni token di una sessione include anche il relativo livello di affidabilità (`aal`) e il metodo di accesso impiegato (`method`, riportato da `providerId`).
- **`rebase.password_reset_tokens`** — Token monouso con scadenza per i flussi di recupero password.
- **`rebase.magic_link_tokens`** — Token monouso con scadenza per l'accesso tramite magic link.
- **`rebase.mfa_factors`** — Metodi di autenticazione a più fattori registrati (es. segreti TOTP cifrati con AES-256).
- **`rebase.mfa_challenges`** — Log di verifica che tracciano i tentativi attivi di verifica MFA.
- **`rebase.recovery_codes`** — Codici di backup/recupero multi-fattore con hash.
- **`rebase.app_config`** — Store chiave-valore per le configurazioni di sistema.

I token che scadono — link di reset, magic link e codici email, refresh token, challenge MFA — vengono eliminati una volta ogni ora dopo la scadenza. La pulizia viene eseguita sui processi responsabili dei timer (tutti i ruoli tranne `functions` in un deployment suddiviso, a meno che `REBASE_CRON_SCHEDULER=false` non li rimuova da `api`) e su una sola istanza del cluster: ogni ora viene rivendicata in `rebase.cron_claims` sotto l'ID di job `rebase:auth:expired-tokens`, esattamente come uno slot cron. Con `cronPersistence: false` non è presente alcuna tabella di claim e ciascuna di queste istanze esegue la pulizia. Un token scaduto viene rifiutato se presentato, indipendentemente dal fatto che la pulizia sia stata eseguita o meno; la pulizia serve unicamente a evitare la crescita indefinita delle tabelle.

## Bootstrap del primo utente

Quando non esistono utenti nel database e il server **non** è in esecuzione con `NODE_ENV=production`, la prima persona che si registra diventa automaticamente amministratore. Dopodiché, la registrazione è controllata dall'impostazione `allowRegistration`.

In produzione questa finestra è chiusa, poiché un host con un nome pubblico è raggiungibile prima che il suo gestore si sia registrato, e chiunque arrivasse per primo ne assumerebbe il controllo. Un deployment in produzione definisce invece il suo primo amministratore nelle variabili d'ambiente — `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, creati all'avvio mentre la tabella è ancora vuota — oppure assegna il ruolo tramite la service key. Con la finestra chiusa, una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED` (segnalandolo espressamente), un primo account creato tramite registrazione aperta è un account ordinario, `GET /api/auth/config` non segnala mai `needsSetup`, `POST /api/admin/bootstrap` rifiuta la richiesta, e il log di avvio avverte quando la tabella è vuota e non è stato indicato alcun amministratore.

Su un portatile, ciò significa che puoi sempre effettuare il bootstrap di un nuovo database senza doverlo popolare manualmente. Per prevenire esecuzioni concorrenti e race condition nella generazione dello schema durante l'hot reloading (HMR) o all'avvio, le operazioni di bootstrap sono sincronizzate tramite un advisory lock di Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## La tabella utenti

<span class="since-badge" data-since="0.31">Da 0.31</span>

Gli utenti sono memorizzati nella tabella dichiarata con `defineAuthTable` in `backend/schema`. Si tratta di una tabella ordinaria a cui vengono aggiunte le colonne richieste dall'autenticazione, una policy che consente a ciascun utente di leggere la propria riga e un vincolo riservato agli amministratori sulla colonna `roles`. Il suo blocco `auth` dichiara i ruoli, gli scope dell'applicazione, le chiavi API personali e gli hook eseguiti quando un amministratore crea un utente o reimposta una password:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        roles: { support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] } },
        personalKeys: true,
    },
});
```

[La tabella utenti](/docs/schema/auth-table/) descrive le colonne, le policy iniettate, `onCreateUser` e `onResetPassword`; [Ruoli e scope](/docs/backend/roles-and-scopes/) illustra ciò che ciascun ruolo e scope concede.

## Prossimi passi

- **[Endpoint e token](/docs/backend/auth-endpoints/)** — tutte le route montate da questa configurazione
- **[Ruoli e scope](/docs/backend/roles-and-scopes/)** — cosa può fare ciascun ruolo, e come chiavi e token possono limitarlo
- **[Adattatori di autenticazione personalizzati](/docs/backend/auth-adapters/)** — integrare il proprio provider di identità
- **[Autenticazione frontend](/docs/frontend/authentication/)** — UI di login, controller di autenticazione, gestione utenti
- **[Sicurezza a livello di riga (RLS)](/docs/collections/security-rules/)** — controllo degli accessi a livello di riga
- **[Autenticazione con Typed SDK](/docs/sdk/authentication/)** — metodi di autenticazione nell'SDK tipizzato
