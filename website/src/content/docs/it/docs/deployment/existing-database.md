---
sourceHash: 3bff62ceb5aceb62
title: Esecuzione su un database esistente o condiviso
sidebar_label: Database esistente o condiviso
description: Esegui Rebase su un database PostgreSQL di cui non è proprietario — un cluster condiviso con altre app, un secondo progetto Rebase, Supabase o un database bloccato da un DBA — con le impostazioni rls, rebase doctor --database e rebase db request-role migrate.
---

## Il problema

Rebase esegue ogni richiesta autenticata e anonima come un unico ruolo Postgres
limitato, `rebase_user`, e lascia che la row-level security decida quali righe
la richiesta può vedere. Il ruolo di connessione è proprietario delle tabelle e scavalca RLS; ogni richiesta
passa a `rebase_user` all'interno della propria transazione.

Questo approccio funziona su un database di proprietà esclusiva di Rebase: Rebase Cloud, la configurazione Docker
predisposta da `rebase init`, il database di sviluppo gestito. Si basa su due
presupposti:

1. Solo il server di questo progetto può assumere l'identità di `rebase_user`.
2. Solo `rebase_user` e il proprietario della tabella interagiscono con le tabelle di Rebase.

Un database già gestito da qualcun altro spesso infrange entrambi:

- **I ruoli appartengono all'intero cluster, non a un singolo database.** Due progetti
  Rebase sullo stesso cluster condividono lo stesso `rebase_user`. Per impostazione predefinita ogni ruolo
  può connettersi a qualsiasi database, e chiunque può impostare i parametri di sessione
  letti dalle policy di Rebase; quindi la connessione del progetto A può aprire il database
  del progetto B, passare a `rebase_user` e superare le policy di B come amministratore di B.
- **I grant coprono interi schemi.** Per impostazione predefinita, Rebase assegna al ruolo di richiesta
  `SELECT, INSERT, UPDATE, DELETE` su ogni tabella in `public` su cui può concedere permessi,
  incluse tabelle di proprietà di un'altra applicazione.
- **Le policy predefinite si applicano `TO public`.** La policy di base aggiunta da Rebase a
  ogni tabella consente l'accesso a qualsiasi sessione che non abbia mai impostato l'identità di Rebase. È
  così che le query del server stesso passano, ma ciò consente l'accesso anche a qualsiasi altro ruolo
  in possesso di un grant sulla tabella, come l'`anon` di Supabase tramite la sua Data API.
- **Le policy esistenti basate sui ruoli non vengono mai applicate.** Una policy scritta
  `TO authenticated` non si applica a `rebase_user`, perché `rebase_user` non
  eredita i privilegi di altri ruoli.
- **Alcuni database non consentono all'app di creare ruoli.** Un DBA crea
  ogni ruolo manualmente, oppure i ruoli sono gestiti tramite Terraform.

Ognuno di questi scenari dispone di un'impostazione dedicata. Ciascuna impostazione ha come valore predefinito ciò che Rebase fa
in sua assenza, quindi un progetto che non imposta nulla si comporta esattamente come prima.

## Controlla prima il database

```bash
rebase doctor --database
```

Questo comando legge il catalogo del database del progetto e non modifica nulla.
Riporta:

- se ciascun ruolo di richiesta esiste, se è limitato e se questa connessione
  può passare ad esso;
- altri ruoli di login che possono assumere il ruolo di richiesta;
- se ogni ruolo sul cluster può connettersi a questo database;
- tabelle negli schemi di Rebase che Rebase non gestisce;
- altri ruoli che possiedono privilegi sulle tabelle di Rebase;
- policy sulle tabelle di Rebase scritte `TO` per un ruolo che il ruolo di richiesta non
  eredita;
- privilegi predefiniti che assegnano nuove tabelle ad altri ruoli.

Ogni riscontro include l'SQL da eseguire come amministratore di database, l'impostazione
per adattare Rebase al database, oppure entrambi. Il comando esce con codice 1 quando un
riscontro è un errore bloccante, permettendo di utilizzarlo come gate per i deployment. Verifica il database
rispetto alle impostazioni visibili: le variabili `REBASE_RLS_*`, poi i ruoli di
richiesta registrati nel database all'avvio del server.

`npx @rebasepro/rls-check` esegue l'audit delle policy stesse, su qualsiasi Postgres. Su
un database Rebase legge il ruolo di richiesta nello stesso modo; specificalo con
`--request-role` quando non è ancora stato registrato.

## Le impostazioni

Impostale nella dichiarazione del database in `backend/resources.ts`:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

Oppure dall'ambiente, che ha la precedenza sulla dichiarazione. L'ambiente è
la scelta ideale per un valore che differisce tra due deployment dello stesso
codice, come il nome del ruolo quando staging e produzione condividono un cluster.

| Impostazione | Variabile d'ambiente | Predefinito | Alternative |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un singolo nome) | `"rebase_user"` | Qualsiasi nome di ruolo. `{ anonymous, signedIn }` per eseguire i chiamanti senza sessione con un ruolo e i chiamanti autenticati con un altro. Nel codice del driver, una funzione dell'identità della richiesta. |
| `requestRoles` | nessuna | derivato da `requestRole` | Ogni ruolo che un `requestRole` basato su funzione può restituire, in modo che ciascuno possa essere predisposto, autorizzato e controllato. Obbligatorio in presenza di una funzione. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: crea il ruolo se mancante e concede a questa connessione il diritto di passare ad esso | `"never"`: il ruolo e l'appartenenza sono a tuo carico. L'avvio li verifica entrambi e fallisce mostrando l'SQL da eseguire. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: ogni tabella e sequenza negli schemi serviti da Rebase su cui la connessione può concedere grant, oltre ai privilegi predefiniti per le tabelle create successivamente | `"managed"`: solo le tabelle servite da Rebase e nessun privilegio predefinito. `"none"`: Rebase non concede nulla; una tabella priva di grant viene rifiutata. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: le policy permissive si applicano solo ai ruoli di richiesta. Le policy restrittive continuano ad applicarsi a tutti. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: le policy superabili solo dal contesto server o da un admin (la baseline, `roles: ["admin"]`) sono scritte `TO rebase_admin`, e le richieste admin vengono eseguite come `<request role>_admin` | `"public"`: quelle policy sono `TO public` e gli admin vengono eseguiti come il ruolo di richiesta, come accadeva prima dell'introduzione di questa impostazione. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: nessuna tabella riceve la baseline server-o-admin. L'impostazione `defaultPolicies: false` della singola tabella mantiene la precedenza. |
| `inheritRoles` | nessuna | `[]` | Ruoli concessi al ruolo di richiesta `WITH INHERIT TRUE`, affinché le policy scritte `TO` per essi siano applicate. Con un ruolo di richiesta `{ anonymous, signedIn }`, solo quello autenticato li riceve; con una funzione, l'impostazione viene rifiutata. Richiede PostgreSQL 16 o superiore; rifiutato su 15 e versioni precedenti. |
| `identity` | `REBASE_RLS_IDENTITY` (forme denominate) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: anche `request.jwt.claims`, `request.jwt.claim.sub` e `request.jwt.claim.role`, in modo che `auth.uid()` e `auth.jwt()` vedano il chiamante. Nel codice del driver, una funzione che restituisce impostazioni aggiuntive. I parametri `app.*` sono sempre impostati. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` quando un altro login può passare al ruolo di richiesta | `"refuse"`: fallisce l'avvio. `"ignore"`: non segnala nulla. |

Le forme funzionali di `requestRole` e `identity` sono accettate solo nel
blocco `rls` del driver, che accetta le stesse impostazioni. `policyTarget`,
`adminPolicies` e `defaultPolicies` modificano l'SQL delle policy generato da `rebase db
generate`, e la CLI non può leggere il codice del driver, quindi impostale
nella dichiarazione o nell'ambiente. Un avvio che le rileva solo nel codice del driver si rifiuterà
di partire.

All'avvio, la riga che segnala come sono isolate le richieste elenca ogni impostazione
che differisce dal valore predefinito. Un'impostazione che delega un compito all'utente, come
`grants: "none"`, indica una volta sola di quale compito si tratta.

Il primo avvio di provisioning registra i ruoli di richiesta in
`rebase.schema_meta`. Un avvio successivo configurato con un ruolo differente rifiuta di
avviarsi e indica il comando per migrare il database, descritto di seguito. Senza questo
controllo, il vecchio ruolo manterrebbe i suoi grant mentre ne verrebbe configurato uno nuovo
accanto ad esso.

## Ricette

### Un cluster condiviso con altre app o progetti

Assegna a ciascun progetto, e a ogni deployment che condivide un cluster, un ruolo
dedicato:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Un database che è già stato eseguito come `rebase_user` conserva tale registrazione, quindi prima migralo:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

Il comando crea il nuovo ruolo se mancante, riassegna solo in questo database
ogni grant posseduto dal vecchio ruolo (tabelle, colonne, sequenze, schemi,
funzioni, i privilegi predefiniti impostati da questa connessione e le appartenenze),
reindirizza le policy che menzionano il vecchio ruolo e registra il nuovo ruolo. Viene eseguito
in un'unica transazione. Il vecchio ruolo viene lasciato inalterato, poiché un altro database sul
cluster potrebbe ancora utilizzarlo. Al termine, stampa le istruzioni `REVOKE`
per revocare i grant del vecchio ruolo in questo database, da eseguire non appena
non saranno più necessari. `--dry-run` stampa le stesse istruzioni senza modificare
nulla. In un terminale chiede conferma prima di procedere; in assenza di terminale rifiuta l'esecuzione
se non viene specificato `--yes`.

Quindi imposta `REBASE_RLS_REQUEST_ROLE` su ogni server che utilizza il database.

`rebase doctor --database` segnala inoltre se ogni ruolo sul cluster può
connettersi al database, fornendo l'istruzione `REVOKE CONNECT … FROM PUBLIC` per impedirlo.
Rebase non la esegue autonomamente su un database di cui non è proprietario.

### Supabase

Uno schema Supabase esistente possiede già `anon` e `authenticated`, e
policy scritte per essi con `auth.uid()`. Per fare in modo che tali policy si applichino
invariate alle richieste di Rebase:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: { anonymous: "anon", signedIn: "authenticated" },
        identity: "supabase",
        policyTarget: "requestRole"
    }
});
```

- `requestRole` esegue i chiamanti senza sessione come `anon` e tutti gli utenti autenticati
  (inclusi gli ospiti) come `authenticated`.
- `identity: "supabase"` imposta i parametri `request.jwt.*` letti da `auth.uid()`.
  Senza di essi, ogni verifica `auth.uid() = owner_id` fallisce, oppure ha esito positivo
  quando non dovrebbe.
- `policyTarget: "requestRole"` impedisce che le policy proprie di Rebase si applichino a
  sessioni che non sono richieste Rebase, come la Data API di Supabase.

Poiché le richieste vengono eseguite direttamente come `anon` e `authenticated`, le policy
scritte `TO anon` o `TO authenticated` si applicano così come sono, e `inheritRoles`
non è necessario. Quest'ultimo serve per un progetto le cui richieste vengono eseguite con un ruolo proprio,
come `requestRole: "acme_user", inheritRoles: ["authenticated"]`. Con una
coppia `{ anonymous, signedIn }` viene concesso solo al ruolo autenticato, mai
a quello anonimo.

I privilegi predefiniti standard di Supabase concedono le tabelle create in `public` ad
`anon` e `authenticated`; controlla quelli del tuo progetto. Esegui `rebase doctor --database`
e `rls-check` dopo il primo avvio per verificare a cosa possono accedere tali ruoli.

### Un amministratore di database crea i ruoli

Quando la connessione non dispone dei permessi per creare ruoli, o i ruoli sono gestiti in Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

L'avvio verifica quindi il ruolo e l'appartenenza e fallisce mostrando l'SQL da eseguire,
invece di tentare di crearli. Per fornire quell'SQL all'amministratore
in anticipo:

```bash
rebase db provision --print > request-role.sql
```

Il comando stampa, per ciascun ruolo di richiesta, le istruzioni per crearlo
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), concedere al ruolo di connessione il
diritto di passare ad esso (`WITH SET TRUE, INHERIT FALSE` su PostgreSQL 16 e
versioni successive), e concedergli gli schemi con `grants: "schema"`. Le spiegazioni sono
scritte sotto forma di commenti SQL, in modo che il file possa essere eseguito così com'è. Legge il
ruolo di connessione dal database e non esegue nient'altro. Ogni istruzione può essere
eseguita nuovamente in totale sicurezza.

### Richieste admin e `rebase_admin`

Postgres combina le policy permissive che si applicano a un ruolo con un OR. Se scritta
`TO public`, la baseline presente su ogni tabella (`rebase.uid() IS NULL OR`
il ruolo `admin`) si applicherebbe anche agli utenti autenticati, e un OR il cui secondo ramo
è costante per l'intera istruzione non può utilizzare un indice: una lista o un conteggio
delimitati dal proprietario per un utente eseguirebbero una scansione dell'intera tabella. Pertanto, le policy superabili solo
dal contesto server o da un admin sono scritte `TO rebase_admin`, e non compaiono mai
nel piano di query di un utente.

`rebase_admin` non possiede privilegi e non può eseguire il login. Un chiamante in possesso del
ruolo `admin`, incluso `rebase.dataAsAdmin`, viene eseguito come `<request role>_admin`
(`rebase_user_admin` per impostazione predefinita), che eredita il ruolo di richiesta e
`rebase_admin`. Una connessione soggetta a sua volta a row-level security
eredita `rebase_admin` per il contesto server. L'avvio crea tutta questa struttura quando
la connessione può creare ruoli. Con `provisionRole: "never"`, creali
manualmente:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Su PostgreSQL 15 e versioni precedenti, crea `rebase_user_admin` con `INHERIT` e
ometti le opzioni `WITH`. Nei casi in cui `rebase_admin` non possa essere creato affatto,
l'avvio e `rebase db push` scrivono tali policy `TO public`, come in precedenza,
e gli admin continuano a essere eseguiti come il ruolo di richiesta. `rebase doctor --database`
segnala quale di queste configurazioni è presente.

#### Le letture admin usano gli indici del proprietario

Una policy non costante impedisce a Postgres di utilizzare un indice per un
operatore che non sia leakproof, come `&&` su un array, `~` o un operatore jsonb.
Senza il passaggio descritto di seguito, un'istruzione `tags && $1` eseguita da un admin scansionava l'intera
tabella, mentre la stessa query eseguita come proprietario utilizzava l'indice GIN. Questo comportamento riguardava
indifferentemente `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` e gli utenti admin.

Per questo motivo, all'avvio viene associata a ciascuna policy riservata agli admin superabile da ogni admin una policy companion
`TO rebase_admin_request USING (true)`, denominata `<policy>_ar_<hash>`. Per una
richiesta admin, Postgres semplifica le policy a `true` e pianifica la query esattamente
come farebbe per il proprietario. Le policy restrittive continuano ad applicarsi. Solo i
ruoli `<request role>_admin` possono possedere `rebase_admin_request`. A ogni avvio,
Rebase verifica quali ruoli dispongono dei suoi privilegi. Se qualsiasi altro ruolo
soggetto a row-level security li possiede, l'avvio non crea companion ed elimina
quelle eventualmente trovate. Le companion richiedono PostgreSQL 16 o versioni successive, poiché su 15 e versioni
precedenti la connessione erediterebbe il ruolo. Solo l'avvio del server le crea. `policies.sql`
e le migrazioni non ne creano mai, ma eliminano la companion di ogni policy
riscritta che non ne ha più diritto. Anche `rebase db push` e `rebase db migrate`
eliminano qualsiasi companion la cui regola sia stata rimossa. Una regola admin ristretta o rimossa
smette quindi di ammettere indiscriminatamente ogni admin anche nei casi in cui l'avvio non effettui alcun provisioning.
Con `provisionRole: "never"`, crea il ruolo manualmente:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Prima di eseguire il rollback a una versione precedente a quella che ha introdotto
le companion, rendile inattive. Un runtime precedente non le riconosce e
non ne elimina alcuna, pertanto una regola modificata in seguito lascerebbe la sua companion
ad ammettere ogni admin a qualsiasi riga. Un'istruzione per ciascun ruolo di richiesta admin fa sì
che ogni companion non ammetta nessuno:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

In alternativa, eliminale: ogni policy il cui nome termina in `_ar_` seguito da otto cifre esadecimali, e
il cui ruolo è `rebase_admin_request`.

### Uno schema `public` condiviso

<span class="since-badge" data-since="0.31">Da 0.31</span>

Quando `public` contiene tabelle che Rebase non deve gestire:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase assegna quindi al ruolo di richiesta solo le tabelle che gestisce: tabelle
dichiarate, tabelle di giunzione e le proprie tabelle protette da row-level security. Non imposta privilegi
predefiniti negli schemi condivisi e non revoca nulla di già concesso.
`rebase doctor --database` elenca le tabelle negli schemi di Rebase non gestite
da Rebase.

Un'altra soluzione consiste nell'utilizzare uno schema dedicato a Rebase: imposta `schema` su ogni `defineTable`.

## Provider

Ciò che il ruolo di connessione è autorizzato a fare varia a seconda del provider e determina
se Rebase possa creare autonomamente il ruolo di richiesta. Le note seguenti rappresentano
ciò che ci aspettiamo; verificalo con il tuo provider.

| Provider | Ruolo di connessione tipico | Note |
|---|---|---|
| Supabase | `postgres` (non è superuser, possiede CREATEROLE) | Un database per progetto. Esistono `anon`, `authenticated` e `authenticator`, con privilegi predefiniti in `public`. Consulta la ricetta per Supabase sopra. |
| Neon | il proprietario del progetto, membro di `neon_superuser` | I ruoli appartengono a un branch, e ogni database su un branch li condivide. Due database Rebase in un unico progetto Neon condividono `rebase_user`, quindi imposta `requestRole` per ciascun database. |
| AWS RDS / Aurora | l'utente master, membro di `rds_superuser` | Possiede CREATEROLE ma non è superuser. Le istanze sono spesso condivise tra più app. |
| Google Cloud SQL | `postgres`, membro di `cloudsqlsuperuser` | Come RDS. |
| Azure Flexible Server | l'utente admin, membro di `azure_pg_admin` | Come RDS. |
| InstaPods | `instapod`; superuser tramite `sudo -u postgres` | [La guida di InstaPods](/docs/deployment/instapods/) crea il ruolo in anticipo. |
| Hostman | `gen_user`; CREATE ROLE concesso dal pannello | Non disponibile sul piano più piccolo. [La guida di Hostman](/docs/deployment/hostman/) crea il ruolo in anticipo. |

## Correlati

- [Comandi Database](/docs/cli/database/): `rebase db request-role` e
  `rebase db provision`
- [Riferimento CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): esegui l'audit delle policy su qualsiasi Postgres
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/): le policy
  scritte da Rebase per ciascuna tabella
