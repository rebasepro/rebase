---
sourceHash: 4107937aed2a477c
title: Esecuzione su un database esistente o condiviso
sidebar_label: Database esistente o condiviso
description: Esegui Rebase su un database PostgreSQL di cui non è proprietario — un cluster condiviso con altre app, un secondo progetto Rebase, Supabase o un database bloccato da un DBA — con le impostazioni RLS, rebase doctor --database e rebase db request-role migrate.
---

## Il problema

Rebase esegue ogni richiesta autenticata e anonima come un unico ruolo Postgres
con restrizioni, `rebase_user`, e lascia che la row-level security decida quali
righe tale richiesta possa visualizzare. Il ruolo di connessione è proprietario
delle tabelle ed effettua il bypass di RLS; ciascuna richiesta passa a `rebase_user`
all'interno della propria transazione.

Ciò funziona su un database di cui Rebase è interamente proprietario: Rebase Cloud,
la configurazione Docker creata da `rebase init`, il database di sviluppo gestito.
Si basa su due presupposti:

1. Solo il server di questo progetto può assumere il ruolo `rebase_user`.
2. Solo `rebase_user` e il proprietario della tabella interagiscono con le tabelle di Rebase.

Un database già gestito da altri spesso infrange entrambi:

- **I ruoli appartengono all'intero cluster, non a un singolo database.** Due progetti
  Rebase sullo stesso cluster condividono lo stesso `rebase_user`. Per impostazione
  predefinita, ogni ruolo può connettersi a ogni database e chiunque può impostare
  i parametri di sessione letti dalle policy di Rebase; di conseguenza, la connessione
  del progetto A può aprire il database del progetto B, passare a `rebase_user`
  e superare le policy di B come amministratore di B.
- **I grant coprono interi schemi.** Per impostazione predefinita, Rebase assegna
  al ruolo di richiesta i permessi `SELECT, INSERT, UPDATE, DELETE` su ogni tabella in
  `public` su cui può concedere privilegi, incluse le tabelle di proprietà di un'altra
  applicazione.
- **Le policy predefinite si applicano `TO public`.** La policy di base aggiunta da Rebase
  a ciascuna tabella consente l'accesso a qualsiasi sessione che non abbia mai impostato
  l'identità di Rebase. È così che passano le query interne del server, ma in questo
  modo viene consentito l'accesso anche a qualsiasi altro ruolo che disponga di un grant
  sulla tabella, come `anon` di Supabase tramite la sua Data API.
- **Le policy esistenti basate sui ruoli non vengono mai applicate.** Una policy scritta
  con `TO authenticated` non si applica a `rebase_user`, poiché `rebase_user` non
  eredita i privilegi di altri ruoli.
- **Alcuni database non consentono affatto all'applicazione di creare ruoli.** Un DBA crea
  ogni ruolo manualmente, oppure i ruoli sono gestiti tramite Terraform.

A ciascuna di queste situazioni corrisponde un'impostazione. Il valore predefinito
di ogni impostazione coincide con il comportamento di Rebase in sua assenza, quindi
un progetto che non definisce nulla si comporterà esattamente come prima.

## Controllare prima il database

```bash
rebase doctor --database
```

Legge il catalogo del database del progetto senza modificare nulla. Segnala:

- se ciascun ruolo di richiesta esiste, se ha restrizioni e se questa connessione
  può passare ad esso;
- altri ruoli di login che possono passare al ruolo di richiesta;
- se ogni ruolo sul cluster può connettersi a questo database;
- tabelle negli schemi di Rebase che non sono gestite da Rebase;
- altri ruoli che detengono privilegi sulle tabelle di Rebase;
- policy sulle tabelle di Rebase scritte con `TO` verso un ruolo che il ruolo di
  richiesta non eredita;
- privilegi predefiniti che assegnano nuove tabelle ad altri ruoli.

Ciascuna segnalazione include il codice SQL da eseguire come amministratore del database,
l'impostazione con cui adattare Rebase al database, oppure entrambi. Restituisce il codice
di uscita 1 quando un controllo fallisce, potendo così bloccare un deployment. Verifica il
database a fronte delle impostazioni rilevabili: le variabili `REBASE_RLS_*`, quindi i
ruoli di richiesta registrati nel database all'avvio del server.

`npx @rebasepro/rls-check` esamina le policy stesse, su qualsiasi istanza Postgres. Su un
database Rebase legge il ruolo di richiesta allo stesso modo; specificalo con
`--request-role` se non è ancora stato registrato.

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

Oppure tramite l'ambiente, che ha la precedenza sulla dichiarazione. L'ambiente è
l'opzione ideale per un valore che varia tra due deployment dello stesso codice,
come il nome del ruolo quando staging e produzione condividono un cluster.

| Impostazione | Variabile d'ambiente | Predefinito | Alternative |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un singolo nome) | `"rebase_user"` | Qualsiasi nome di ruolo. `{ anonymous, signedIn }` per eseguire i chiamanti senza sessione con un ruolo e i chiamanti autenticati con un altro. Nel codice del driver, una funzione dell'identità della richiesta. |
| `requestRoles` | nessuno | derivato da `requestRole` | Ogni ruolo che un `requestRole` definito come funzione può restituire, in modo che ciascuno possa essere sottoposto a provisioning, concessione di grant e verifica. Obbligatorio quando si usa una funzione. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: crea il ruolo se mancante e concede a questa connessione il diritto di passare ad esso | `"never"`: il ruolo e l'appartenenza sono a tuo carico. L'avvio li verifica entrambi e fallisce mostrando l'SQL da eseguire. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: ogni tabella e sequenza negli schemi serviti da Rebase su cui la connessione può concedere grant, più i privilegi predefiniti per le tabelle create in seguito | `"managed"`: solo le tabelle servite da Rebase e nessun privilegio predefinito. `"none"`: Rebase non assegna alcun grant; una tabella per cui non sono stati concessi privilegi viene rifiutata. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: le policy permissive si applicano solo ai ruoli di richiesta. Le policy restrittive continuano ad applicarsi a tutti. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: le policy che solo il contesto server o un admin possono superare (la baseline, `roles: ["admin"]`) sono scritte come `TO rebase_admin`, e le richieste admin vengono eseguite come `<request role>_admin` | `"public"`: tali policy sono `TO public` e gli admin vengono eseguiti con il ruolo di richiesta, come accadeva prima dell'introduzione di questa impostazione. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: nessuna tabella riceve la baseline server-o-admin. L'opzione `defaultPolicies: false` a livello di tabella continua ad avere la priorità per quest'ultima. |
| `required` | nessuno | `true`: una tabella dichiarata che il database non protegge (row-level security disattivata, policy dichiarate mancanti) non viene servita quando l'avvio non effettua provisioning | `false`: serve comunque le tabelle di questo database e le elenca all'avvio. Utile per uno schema di proprietà di un altro strumento e per un'app che gestisce autonomamente il controllo degli accessi; vedi sotto "Un altro strumento è proprietario dello schema". L'opzione `rlsRequired` della singola tabella ha la priorità. |
| `inheritRoles` | nessuno | `[]` | Ruoli concessi al ruolo di richiesta `WITH INHERIT TRUE`, affinché le policy scritte con `TO` nei loro confronti siano applicate. Con un ruolo di richiesta `{ anonymous, signedIn }`, solo quello autenticato li riceve; con una funzione, l'impostazione viene rifiutata. PostgreSQL 16 e versioni successive; non consentito su 15 e versioni precedenti. |
| `identity` | `REBASE_RLS_IDENTITY` (forme denominate) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: anche `request.jwt.claims`, `request.jwt.claim.sub` e `request.jwt.claim.role`, affinché `auth.uid()` e `auth.jwt()` riconoscano il chiamante. Nel codice del driver, una funzione che restituisce impostazioni aggiuntive. Le impostazioni `app.*` sono sempre configurate. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` quando un altro login può passare al ruolo di richiesta | `"refuse"`: blocca l'avvio. `"ignore"`: non segnala nulla. |

Le forme funzionali di `requestRole` e `identity` sono accettate solo nel blocco `rls`
del driver, che accetta le medesime impostazioni. `policyTarget`, `adminPolicies` e
`defaultPolicies` modificano l'SQL delle policy generato da `rebase db generate`, e la
CLI non può leggere il codice del driver, pertanto impostali nella dichiarazione o
nell'ambiente. Un avvio che li trova unicamente nel codice del driver rifiuterà di
partire.

All'avvio, la riga che riporta il modo in cui le richieste sono isolate elenca ogni
impostazione non impostata sul valore predefinito. Un'impostazione che delega un compito
all'utente, come `grants: "none"`, indica chiaramente di quale compito si tratta.

Il primo avvio con provisioning registra i ruoli di richiesta in `rebase.schema_meta`.
Un avvio successivo configurato con un ruolo diverso rifiuterà di partire e indicherà
il comando per migrare il database, descritto di seguito. Senza questo controllo, il
vecchio ruolo manterrebbe i propri permessi mentre ne verrebbe configurato uno nuovo
accanto ad esso.

## Ricette

### Un cluster condiviso con altre app o progetti

Assegna a ciascun progetto, e a ciascun deployment che condivide un cluster, un ruolo
dedicato:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Un database che è già stato eseguito come `rebase_user` ne tiene traccia, quindi prima
è necessario migrarlo:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

Il comando crea il nuovo ruolo se mancante, riassegna solo in questo database ogni
grant posseduto dal vecchio ruolo (tabelle, colonne, sequenze, schemi, funzioni, i
privilegi predefiniti impostati da questa connessione e le appartenenze), riorienta le
policy che fanno riferimento al vecchio ruolo e registra il nuovo ruolo. Viene
eseguito in un'unica transazione. Il vecchio ruolo viene lasciato inalterato, poiché
un altro database sul cluster potrebbe ancora utilizzarlo. Al termine, stampa le
istruzioni `REVOKE` che revocano i grant del vecchio ruolo in questo database, da
eseguire non appena non saranno più necessari. `--dry-run` stampa le stesse istruzioni
senza modificare nulla. Da terminale richiede conferma prima dell'esecuzione; senza
terminale rifiuta l'esecuzione in assenza del flag `--yes`.

Quindi imposta `REBASE_RLS_REQUEST_ROLE` su ogni server che utilizza il database.

`rebase doctor --database` segnala inoltre se qualsiasi ruolo sul cluster può connettersi
al database, indicando l'istruzione `REVOKE CONNECT … FROM PUBLIC` necessaria per
impedirlo. Rebase non esegue questa operazione autonomamente su un database di cui non
è proprietario.

### Supabase

Uno schema Supabase esistente include già `anon` e `authenticated`, oltre a policy
scritte nei loro confronti mediante `auth.uid()`. Per fare in modo che tali policy
si applichino senza modifiche alle richieste di Rebase:

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

- `requestRole` esegue i chiamanti privi di sessione come `anon` e tutti gli utenti
  autenticati (guest inclusi) come `authenticated`.
- `identity: "supabase"` imposta i parametri `request.jwt.*` letti da `auth.uid()`.
  Senza di essi, ogni verifica `auth.uid() = owner_id` fallisce, oppure ha esito
  positivo quando non dovrebbe.
- `policyTarget: "requestRole"` evita che le policy interne di Rebase vengano applicate
  a sessioni che non sono richieste Rebase, come la Data API di Supabase.

Poiché le richieste vengono eseguite direttamente come `anon` e `authenticated`, le
policy scritte con `TO anon` o `TO authenticated` si applicano così come sono e non è
necessario ricorrere a `inheritRoles`. Tale opzione è riservata a progetti le cui
richieste vengono eseguite con un ruolo proprio, ad esempio
`requestRole: "acme_user", inheritRoles: ["authenticated"]`. Con una coppia
`{ anonymous, signedIn }`, viene concessa unicamente al ruolo autenticato, mai a
quello anonimo.

I privilegi predefiniti standard di Supabase concedono l'accesso alle tabelle create
in `public` ad `anon` e `authenticated`; verifica la configurazione del tuo progetto.
Esegui `rebase doctor --database` e `rls-check` dopo il primo avvio per verificare
quali risorse possono raggiungere tali ruoli.

### Un altro strumento è proprietario dello schema e l'app applica i controlli di accesso

Alcuni database non devono essere protetti da Rebase. Alembic, Prisma o un DBA
posseggono le tabelle, la row-level security non è abilitata e l'app decide
autonomamente chi può accedere a cosa: solo lo staff può autenticarsi, gli hook
verificano ogni operazione di scrittura, uno scope controlla ciascuna route.

Dichiara tale approccio direttamente sulla tabella:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "unmanaged"
});
```

Oppure per l'intero progetto tramite `defaultRls = "unmanaged"` in
`backend/schema/index.ts` insieme a `rls: "inherit"` su ciascuna tabella. Rebase
non genera alcun DDL di `ENABLE ROW LEVEL SECURITY` o di policy per le tabelle
`"unmanaged"` (su `db push` o durante gli avvii con provisioning), le gestisce senza
restrizioni e le elenca una sola volta all'avvio. Continua a utilizzare autenticazione,
ruoli, scope e hook per applicare i controlli di accesso.

Se invece Postgres **applica** la row-level security su tali tabelle, con policy
definite in migrazioni SQL, Supabase o Terraform anziché in Rebase, utilizza invece
`rls: "external"`:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "external"
});
```

Rebase non genera alcun DDL di RLS o policy per le tabelle `"external"` e non ne
rimuove mai le policy (`--prune-policies`), mentre l'avvio e `rebase doctor`
verificano comunque che `ENABLE ROW LEVEL SECURITY` sia attivo sulla tabella in
Postgres.

Per le tabelle che continuano a dichiarare regole di Rebase su un database di proprietà
di un altro strumento, `rlsRequired: false` (o `database({ rls: { required: false } })`
per l'intero database) le serve durante un avvio senza provisioning anche se le policy
dichiarate non sono presenti, segnalandole in un unico warning:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

L'opzione `rlsRequired: true` su una tabella la mantiene obbligatoria anche sotto
un database configurato con `required: false`. Con la row-level security disattivata,
una regola dichiarata non viene applicata da Postgres: mantieni l'autenticazione,
i ruoli e gli hook a presidio di tale compito.

### Un amministratore di database crea i ruoli

Quando la connessione non dispone dei permessi per creare ruoli, oppure i ruoli sono
gestiti in Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

L'avvio verifica quindi il ruolo e l'appartenenza e fallisce mostrando l'SQL da eseguire,
anziché tentare di crearli. Per fornire anticipatamente tale SQL all'amministratore:

```bash
rebase db provision --print > request-role.sql
```

Stampa, per ogni ruolo di richiesta, le istruzioni per crearlo
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), assegnare al ruolo di connessione il
diritto di passare ad esso (`WITH SET TRUE, INHERIT FALSE` su PostgreSQL 16 e versioni
successive) e concedergli i permessi sugli schemi con `grants: "schema"`. Le spiegazioni
sono inserite sotto forma di commenti SQL, in modo che il file possa essere eseguito
così com'è. Legge il ruolo di connessione dal database e non esegue nient'altro. Ciascuna
istruzione può essere rieseguita in sicurezza.

### Richieste admin e `rebase_admin`

Postgres combina con l'operatore OR le policy permissive che si applicano a un ruolo. Se
scritte come `TO public`, la baseline presente su ogni tabella (`rebase.uid() IS NULL OR`
il ruolo `admin`) si applicherebbe anche agli utenti autenticati, e un OR il cui secondo
ramo è costante per l'intera istruzione non può sfruttare un indice: una query di
elenco o conteggio con ambito proprietario per un utente finirebbe per scansionare
l'intera tabella. Pertanto, le policy superabili solo dal contesto server o da un admin
vengono scritte come `TO rebase_admin`, non entrando mai nel piano di esecuzione delle
query di un utente.

La tabella degli utenti fa eccezione. Auth la legge e la modifica nel contesto server
tramite il ruolo proprio della connessione, che non viene commutato su `rebase_admin`;
le relative policy rimangono quindi `TO public` indipendentemente dall'impostazione:
dietro a un ruolo di connessione che non è proprietario della tabella, la registrazione
e l'accesso continuano a funzionare normalmente.

`rebase_admin` non detiene alcun privilegio e non può effettuare il login. Un chiamante
che possiede il ruolo `admin`, compreso `rebase.dataAsAdmin`, viene eseguito come
`<request role>_admin` (`rebase_user_admin` per impostazione predefinita), che eredita
il ruolo di richiesta e `rebase_admin`. Una connessione soggetta essa stessa a row-level
security eredita `rebase_admin` per il contesto server. L'avvio crea tutta questa
configurazione se la connessione è abilitata alla creazione di ruoli. Con
`provisionRole: "never"`, crea i ruoli manualmente:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Su PostgreSQL 15 e versioni precedenti, crea `rebase_user_admin` con `INHERIT` e ometti
le opzioni `WITH`. Nel caso in cui `rebase_admin` non possa essere creato affatto,
l'avvio e `rebase db push` scriveranno tali policy come `TO public`, come in precedenza,
e gli amministratori continueranno a essere eseguiti con il ruolo di richiesta.
`rebase doctor --database` indica quale di queste configurazioni è attiva.

#### Le letture admin utilizzano gli indici del proprietario

Una policy che non sia una costante impedisce a Postgres di utilizzare un indice per
un operatore che non sia leakproof, come `&&` su un array, `~` o un operatore jsonb.
Senza il passaggio descritto di seguito, la query `tags && $1` eseguita da un admin
scansionava l'intera tabella, mentre la stessa query eseguita come owner utilizzava
l'indice GIN. Questo valeva sia per `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` che per
gli utenti con ruolo admin.

Pertanto, all'avvio viene assegnata a ogni policy riservata agli admin superabile da
tutti gli admin una policy complementare `TO rebase_admin_request USING (true)`,
denominata `<policy>_ar_<hash>`. Per una richiesta admin, Postgres riduce le policy
a `true` e pianifica la query esattamente come farebbe per il proprietario. Le policy
restrittive continuano ad applicarsi. Solo i ruoli `<request role>_admin` possono
disporre di `rebase_admin_request`. A ogni avvio, Rebase verifica quali ruoli possiedono
i suoi privilegi. Se un qualsiasi altro ruolo soggetto a row-level security li possiede,
l'avvio non crea alcuna policy complementare e rimuove quelle esistenti. Le policy
complementari richiedono PostgreSQL 16 o versioni successive, poiché sulle versioni 15
e precedenti la connessione erediterebbe il ruolo. Solo l'avvio le crea. `policies.sql`
e le migrazioni non ne creano mai, ma eliminano la policy complementare per ogni policy
riscritta che non ne ha più diritto. Anche `rebase db push` e `rebase db migrate`
eliminano le policy complementari la cui regola non esiste più. Di conseguenza, una
regola admin ristretta o rimossa smette di autorizzare tutti gli admin anche nei casi
in cui l'avvio non effettua provisioning. Con `provisionRole: "never"`, crea il ruolo
manualmente:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Prima di effettuare il rollback a una versione precedente a quella che ha introdotto
le policy complementari, rendile inattive. Un runtime più vecchio non le riconosce e
non le rimuove mai; pertanto, una regola modificata in seguito lascerebbe la policy
complementare ad autorizzare qualsiasi admin su ogni riga. Una singola istruzione per
ogni ruolo di richiesta admin farà sì che le policy complementari non autorizzino
nessuno:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Oppure eliminale: ogni policy il cui nome termina con `_ar_` seguito da otto cifre
esadecimali e il cui ruolo è `rebase_admin_request`.

### Uno schema `public` condiviso

Quando `public` contiene tabelle che Rebase non deve raggiungere:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase concede quindi al ruolo di richiesta solo le tabelle che gestisce: tabelle
dichiarate, tabelle di giunzione e le proprie tabelle protette a livello di riga. Non
imposta alcun privilegio predefinito negli schemi condivisi e non revoca nulla di
quanto già concesso. `rebase doctor --database` elenca le tabelle negli schemi di
Rebase che non sono servite da esso.

Un'altra soluzione consiste nell'utilizzare uno schema dedicato a Rebase: imposta
`schema` su ogni `defineTable`.

## Provider

Le operazioni consentite al ruolo di connessione variano a seconda del provider e
determinano se Rebase sia in grado di creare autonomamente il ruolo di richiesta.
Le note seguenti rappresentano quanto previsto; verificale con il tuo provider.

| Provider | Ruolo di connessione consueto | Note |
|---|---|---|
| Supabase | `postgres` (non superuser, dispone di CREATEROLE) | Un database per progetto. Esistono `anon`, `authenticated` e `authenticator`, con privilegi predefiniti in `public`. Vedi la ricetta per Supabase sopra. |
| Neon | il proprietario del progetto, membro di `neon_superuser` | I ruoli appartengono a un branch e ogni database del branch li condivide. Due database Rebase in un unico progetto Neon condividono `rebase_user`, quindi imposta `requestRole` per ciascun database. |
| AWS RDS / Aurora | l'utente master, membro di `rds_superuser` | Dispone di CREATEROLE ma non è un superuser. Le istanze sono spesso condivise tra più app. |
| Google Cloud SQL | `postgres`, membro di `cloudsqlsuperuser` | Come RDS. |
| Azure Flexible Server | l'utente admin, membro di `azure_pg_admin` | Come RDS. |
| InstaPods | `instapod`; superuser tramite `sudo -u postgres` | [La guida di InstaPods](/docs/deployment/instapods/) crea il ruolo in anticipo. |
| Hostman | `gen_user`; CREATE ROLE concesso dal pannello | Non disponibile nel piano base. [La guida di Hostman](/docs/deployment/hostman/) crea il ruolo in anticipo. |

## Contenuti correlati

- [Comandi del database](/docs/cli/database/): `rebase db request-role` e
  `rebase db provision`
- [Riferimento CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): verifica le policy su qualsiasi istanza Postgres
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/): le policy
  scritte da Rebase per ogni tabella
