---
sourceHash: 3d6a5a62a25e5b8c
title: Verifica email
sidebar_label: Verifica email
description: "Come un account dimostra il proprio indirizzo email: il link inviato alla registrazione, cosa mantiene e rimuove seguirlo, e la registrazione confirm-first con requireEmailVerification."
---

Quando l'email è configurata, la registrazione
invia al nuovo account un link di verifica (`<frontend>/verify-email?token=…`, valido 24 ore),
così il proprietario dimostra l'indirizzo alla registrazione, con i propri tempi. `POST /api/auth/send-verification`
lo invia di nuovo. Non viene inviato nulla agli indirizzi sintetici di guest e account X (Twitter).

Il link dimostra la casella di posta, non chi ha registrato l'indirizzo. Chiunque può registrare
l'indirizzo di un'altra persona con una password e richiedere che il link venga inviato, quindi
seguirlo mantiene solo ciò che la richiesta dimostra anche:

| Seguendo il link con… | Cosa succede |
|---|---|
| una sessione attiva di quell'account (header `Authorization`) | Verificato. Nulla viene rimosso: solo chi ha registrato l'account può possedere la sua sessione |
| la password dell'account (`POST`, `password`) | Verificato, la password mantenuta, un'identità non garantita rimossa, e il chiamante autenticato |
| nessuna delle due | Verificato, e la password e ogni identità non garantita rimosse, ogni sessione terminata. `POST` chiede prima conferma (`409 PROOF_REQUIRED`) a meno che non sia `removeUnproven: true` |

Quindi un proprietario che segue il link da autenticato, o digita la password che ha scelto, la
mantiene; qualcuno il cui indirizzo è stato registrato da uno sconosciuto verifica senza di essa,
e la via d'accesso dello sconosciuto viene eliminata. La risposta indica `passwordRemoved` quando
ne ha rimossa una. Il CMS chiede la password prima di verificare.

## Registrazione confirm-first

`auth.requireEmailVerification: true` (oppure `AUTH_REQUIRE_EMAIL_VERIFICATION=true`) cambia due
cose:

- `POST /api/auth/register` non autentica nessuno. Risponde `200 { confirmationRequired: true }`
  indipendentemente dal fatto che l'indirizzo abbia già un account, nello stesso tempo, quindi non
  rivela a nessuno quali indirizzi sono registrati. A un account esistente che non ha mai
  confermato viene inviato di nuovo il suo link; la sua password non viene modificata.
- `POST /api/auth/login` risponde `403 EMAIL_NOT_CONFIRMED` per un account non verificato, e solo
  quando la password è corretta, quindi la risposta non rivela a nessuno tranne a chi possiede la
  password che l'indirizzo non è confermato. Invia di nuovo il link, al massimo una volta al
  minuto.

Chi si registra segue il link e inserisce la propria password
(`POST /api/auth/verify-email { token, password }`), il che verifica l'indirizzo e lo autentica.
Con l'opzione disattivata, che è il valore predefinito, un indirizzo che ha già un account riceve
risposta `409 EMAIL_EXISTS`, come prima.

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


## Vedi anche

- [Autenticazione](/docs/backend/authentication/): la configurazione dell'autenticazione, il
  collegamento degli account OAuth, e perché una prima prova dell'indirizzo rimuove ciò che
  nessuno ha dimostrato.
- [Endpoint di autenticazione](/docs/backend/auth-endpoints/): `POST /api/auth/verify-email`
  e `POST /api/auth/send-verification` con il resto delle route.
- [Autenticazione con l'SDK tipizzato](/docs/sdk/authentication/#email-verification):
  `verifyEmail` e `signUp` dal client.
