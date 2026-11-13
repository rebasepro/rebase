---
sourceHash: 9c7b1e0ee0076030
title: Autenticazione e accesso
sidebar_label: Autenticazione e accesso
description: Configura l'auth controller, la vista di login e la simulazione dei ruoli nel tuo frontend React Rebase.
---

## Panoramica

Rebase fornisce componenti e hook React pronti all'uso per l'autenticazione:

- **`useRebaseAuthController`** — Gestisce lo stato di autenticazione, i token e la persistenza della sessione
- **`LoginView`** — Modulo predefinito di login/registrazione con supporto OAuth
- **Simulazione dei ruoli** — Testa diversi ruoli senza effettuare il logout

## Auth Controller

L'hook `useRebaseAuthController` è il fulcro dell'autenticazione lato frontend. Gestisce l'utente corrente, i token e la sessione:

```typescript
import { useRebaseAuthController } from "@rebasepro/app";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional — enables Google OAuth
});

// Available properties:
authController.user           // Current user object (or null)
authController.initialLoading // True while checking stored session
authController.signOut()      // Log out
authController.getAuthToken() // Get current JWT for API calls
```

Passa `authController` a `<Rebase authController>`. `<RebaseShell>` (o `<RebaseAuthGate>` in un layout manuale) lo legge da lì e protegge l'intero pannello di amministrazione richiedendo l'autenticazione.

## Il tuo provider di autenticazione

Se la tua app gestisce l'accesso degli utenti con il proprio provider (Clerk, Firebase Auth, una
sessione proprietaria), fornisci al client passato a `<Rebase client>` un getter per il token.
Sia le richieste HTTP del pannello sia il relativo socket in tempo reale invieranno ciò che restituisce,
facendo sì che le viste live vengano eseguite come lo stesso utente:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

L'`authController` accanto ad esso segnala quindi l'utente autenticato del tuo provider
(un `AuthController` da `@rebasepro/cms-types`) invece di eseguire il wrapping di
`client.auth`. Anche il backend deve accettare il token: consulta
[Adattatori di autenticazione personalizzati](/docs/backend/auth-adapters) e
[Il tuo provider di autenticazione](/docs/sdk/your-own-auth-provider/)
per la documentazione completa lato client.

## Login View

Il componente `LoginView` fornisce un modulo completo di accesso e registrazione:

```tsx
import { LoginView } from "@rebasepro/app";

function App() {
    if (!authController.user) {
        return (
            <LoginView
                authController={authController}
                googleClientId={GOOGLE_CLIENT_ID}
            />
        );
    }
    return <MyApp />;
}
```

La vista di login gestisce:
- Accesso e registrazione con email/password
- Accesso OAuth con Google, GitHub e LinkedIn (quando configurato)
- Flusso di reimpostazione della password
- Validazione dei moduli e stati di errore

## Modello dei ruoli

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

I ruoli sono memorizzati come colonna array `text[]` nella tabella degli utenti. Si definiscono i
ruoli che un utente può ricoprire come un insieme chiuso su tale colonna, nella tabella dichiarata
con [`defineAuthTable`](/docs/schema/auth-table/):

```typescript title="backend/schema/users.ts"
roles: col.text({ enum: ["admin", "editor", "viewer"] }).array(),
```

Per aggiungere o rimuovere un ruolo, modifica quell'elenco. Le etichette mostrate dal pannello per ciascun
valore appartengono al frontend: `enumLabels` sul campo in
`frontend/src/cms/users.tsx` (vedi [Personalizzare una tabella](/docs/frontend/customize-table/)).

Un ruolo in questo elenco è un nome che le tue [regole di sicurezza](/docs/collections/security-rules) possono verificare. Ciò che può fare oltre alle proprie righe (gestire utenti, leggere log, modificare lo schema) viene dichiarato separatamente, sotto `auth.roles` nella stessa tabella. `admin` è predefinito e dispone di tutti i permessi. Vedi [Ruoli e ambiti](/docs/backend/roles-and-scopes).

## Test dell'accesso: Simulazione dell'accesso

Per verificare cosa può leggere un ruolo, un utente o una chiave di servizio, un amministratore utilizza
**Simulate access**, il badge a pillola sopra il tuo avatar nel drawer del pannello di amministrazione (nella
barra dell'app su schermi di piccole dimensioni, o quando la shell non ha un drawer). Seleziona un ruolo
(con un ID utente opzionale, che non deve necessariamente corrispondere a un account), un utente o una
chiave di servizio attiva.
Ogni vista dati e la scheda Cronologia di un record leggono quindi tramite il server con
quell'identità, in base alle reali policy di row-level security: una griglia mostra
esattamente le righe che è possibile leggere,
i campi che i suoi ruoli non possono leggere vengono mascherati e il banner conteggia le tabelle
in cui non è visibile nulla. Il server verifica a ogni richiesta che tu sia un
amministratore.

L'accesso simulato è di sola lettura. Finché è attivo, le viste non consentono creazione, modifica,
eliminazione o ripristino della cronologia, e il server rifiuta qualsiasi scrittura che trasmetta una simulazione con
`403 SIMULATION_READ_ONLY`, garantendo che nulla venga salvato a nome di un altro utente. Interrompi la simulazione
per apportare modifiche.

Cosa non viene simulato: il gate `requireAuth` dell'API dei dati, che lascia passare un
chiamante anonimo simulato in modo da poter vedere cosa gli consentono le policy delle righe
(una funzione personalizzata lo rileva come assenza di sessione, esattamente come un vero chiamante anonimo);
lo storage, i cui file vengono letti con la tua identità, con i caricamenti disabilitati durante la simulazione; e
gli aggiornamenti in tempo reale, che restano in pausa finché non si interrompe la simulazione.

La stessa operazione tramite codice, nell'SDK, si ottiene con `client.simulate()`. Questo metodo genera un
client le cui richieste includono la simulazione, e solo la sessione di un amministratore
può utilizzarlo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.table("tickets").find();
asCustomer.close();
```

Il client derivato è tipizzato dallo stesso `Database` di quello da cui proviene ed
è un client a sé stante: usa `close()` al termine delle operazioni.

Il selettore del ruolo effettivo non è uno strumento di test per l'RLS: modifica soltanto le viste di Studio
elencate nella navigazione, non invia nulla al server e non valuta alcuna
policy. `useBuildEffectiveRoleController`, che ne creava uno, è deprecato e
genera un singolo avviso quando viene chiamato: `<Rebase>` crea il proprio controller quando non ne viene
passato alcuno, e Simulate access è la modalità indicata per verificare le autorizzazioni di un ruolo.

## Prossimi passi

- **[Autenticazione backend](/docs/backend/authentication)** — JWT, provider OAuth, configurazione SMTP
- **[Row-level security](/docs/collections/security-rules)** — Controllo degli accessi a livello di riga per tabella
- **[Autenticazione SDK tipizzato](/docs/sdk/authentication)** — Metodi di autenticazione programmatici
