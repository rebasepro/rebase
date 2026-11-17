---
sourceHash: 5bab946153902c64
title: Esecuzione su un database esistente o condiviso
sidebar_label: Database esistente o condiviso
description: Esegui Rebase su un database PostgreSQL di cui non è proprietario — un cluster condiviso con altre app, un secondo progetto Rebase, Supabase o un database bloccato da un DBA — con le impostazioni rls, rebase doctor --database e rebase db request-role migrate.
---

## Il problema

Rebase esegue ogni richiesta autenticata e anonima come un unico ruolo Postgres
con restrizioni, `rebase_user`, e lascia che la row-level security decida quali
righe quella richiesta può visualizzare. Il ruolo di connessione è proprietario delle tabelle e
bypassa la RLS; ciascuna richiesta passa a `rebase_user` all'interno della
propria transazione.

Questo approccio funziona su un database di proprietà esclusiva di Rebase: Rebase Cloud,
l'ambiente Docker creato da `rebase init`, il database di sviluppo gestito.
Si basa su due presupposti:

1. Solo il server di questo progetto può diventare `rebase_user`.
2. Solo `rebase_user` e il proprietario delle tabelle interagiscono con le tabelle di Rebase.

Un database già gestito da altri spesso viola entrambi:

- **I ruoli appartengono all'intero cluster, non a un singolo database.** Due
  progetti Rebase sullo stesso cluster condividono lo stesso `rebase_user`. Per impostazione
  predefinita ogni ruolo può connettersi a ogni database e chiunque può impostare le
  impostazioni di sessione lette dalle policy di Rebase; quindi la connessione del progetto A
  può aprire il database del progetto B, passare a `rebase_user` e superare le policy di B
  come amministratore di B.
- **I privilegi coprono interi schemi.** Per impostazione predefinita Rebase concede al ruolo
  di richiesta i permessi `SELECT, INSERT, UPDATE, DELETE` su ogni tabella in `public` su cui
  ha facoltà di concederli, incluse le tabelle di proprietà di un'altra applicazione.
- **Le policy predefinite si applicano `TO public`.** La policy di base che Rebase aggiunge
  a ogni tabella consente l'accesso a qualsiasi sessione che non abbia mai impostato l'identità
  di Rebase. È così che passano le query del server stesso, ma permette l'accesso anche a
  qualsiasi altro ruolo in possesso di privilegi sulla tabella, come `anon` di Supabase
  tramite la sua Data API.
- **Le policy esistenti basate sui ruoli non si applicano mai.** Una policy scritta
  `TO authenticated` non si applica a `rebase_user`, perché `rebase_user` non
  eredita i privilegi di altri ruoli.
- **Alcuni database non consentono affatto all'app di creare ruoli.** Un DBA crea
  ogni ruolo manualmente, oppure i ruoli sono gestiti tramite Terraform.

Ognuno di questi aspetti dispone di un'impostazione dedicata. Ogni impostazione ha come valore
predefinito il comportamento standard di Rebase in sua assenza, quindi un progetto che non
configura nulla si comporta esattamente come prima.

## Prima controlla il database

```bash
rebase doctor --database
```

Legge il catalogo del database del progetto senza modificare nulla. Segnala:

- se ciascun ruolo di richiesta esiste, se ha restrizioni e se questa connessione
  può passare ad esso;
- altri ruoli di login che possono passare al ruolo di richiesta;
- se ogni ruolo presente sul cluster può connettersi a questo database;
- tabelle negli schemi di Rebase che Rebase non gestisce;
- altri ruoli che detengono privilegi sulle tabelle di Rebase;
- policy sulle tabelle di Rebase scritte `TO` un ruolo che il ruolo di richiesta
  non eredita;
- privilegi predefiniti che assegnano nuove tabelle ad altri ruoli.

Ogni riscontro è accompagnato dall'SQL da eseguire come amministratore del database,
dall'impostazione con cui adattare Rebase al database, o da entrambi. Termina con codice
di uscita 1 quando un riscontro indica un errore, permettendo di bloccare un deployment.
Controlla il database rispetto alle impostazioni visibili: le variabili `REBASE_RLS_*`,
e successivamente i ruoli di richiesta registrati nel database all'avvio del server.

`npx @rebasepro/rls-check` verifica le policy stesse, su qualsiasi Postgres. Su un
database Rebase legge il ruolo di richiesta nello stesso modo; indicalo con
`--request-role` quando non è ancora registrato.

## Le impostazioni

Configurale nella dichiarazione del database in `backend/resources.ts`:

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
la scelta ideale per un valore che differisce tra due deployment dello stesso codice,
come il nome del ruolo quando staging e produzione condividono un cluster.

| Impostazione | Variabile d'ambiente | Predefinito | Alternative |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un singolo nome) | `"rebase_user"` | Qualsiasi nome di ruolo. `{ anonymous, signedIn }` per eseguire i chiamanti senza sessione come un ruolo e i chiamanti autenticati come un altro. Nel codice del driver, una funzione dell'identità della richiesta. |
| `requestRoles` | nessuna | derivato da `requestRole` | Ogni ruolo che un `requestRole` basato su funzione può restituire, affinché ciascuno possa essere predisposto, autorizzato e verificato. Obbligatorio in presenza di una funzione. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: crea il ruolo se mancante e concede a questa connessione il diritto di passare ad esso | `"never"`: il ruolo e l'appartenenza sono a tuo carico. L'avvio controlla entrambi e fallisce mostrando l'SQL da eseguire. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: ogni tabella e sequenza negli schemi serviti da Rebase su cui la connessione può concedere permessi, più i privilegi predefiniti per le tabelle create successivamente | `"managed"`: solo le tabelle servite da Rebase e nessun privilegio predefinito. `"none"`: Rebase non concede nulla; una tabella priva di permessi viene rifiutata. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: le policy permissive si applicano solo ai ruoli di richiesta. Le policy restrittive continuano ad applicarsi a tutti. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: le policy superabili solo dal contesto server o da un admin (la baseline, `roles: ["admin"]`) sono scritte `TO rebase_admin`, e le richieste admin vengono eseguite come `<request role>_admin` | `"public"`: quelle policy sono `TO public` e gli admin vengono eseguiti con il ruolo di richiesta, come prima dell'introduzione di questa impostazione. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: nessuna tabella riceve la baseline server-o-admin. L'opzione `defaultPolicies: false` della singola tabella mantiene la precedenza. |
| `required` | nessuna | `true`: una tabella dichiarata che il database non protegge (row-level security disattivata, policy dichiarate mancanti) non viene servita quando l'avvio non effettua provisioning | `false`: serve comunque le tabelle di questo database e le elenca all'avvio. Utile per schemi di proprietà di un altro strumento con un'app che gestisce autonomamente l'accesso; vedi "Un altro strumento è proprietario dello schema" sotto. L'opzione `rlsRequired` della singola tabella mantiene la precedenza. |
| `inheritRoles` | nessuna | `[]` | Ruoli concessi al ruolo di richiesta `WITH INHERIT TRUE`, affinché le policy scritte `TO` essi si applichino. Con un ruolo di richiesta `{ anonymous, signedIn }`, solo quello autenticato li riceve; con una funzione, l'impostazione viene rifiutata. PostgreSQL 16 e successivi; rifiutata su 15 e precedenti. |
| `identity` | `REBASE_RLS_IDENTITY` (forme nominate) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: anche `request.jwt.claims`, `request.jwt.claim.sub` e `request.jwt.claim.role`, affinché `auth.uid()` e `auth.jwt()` vedano il chiamante. Nel codice del driver, una funzione che restituisce impostazioni aggiuntive. Le impostazioni `app.*` sono sempre definite. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` quando un altro login può passare al ruolo di richiesta | `"refuse"`: blocca l'avvio con errore. `"ignore"`: non segnala nulla. |

Le forme a funzione di `requestRole` e `identity` sono accettate solo nel blocco
`rls` del driver, che accetta le medesime impostazioni. `policyTarget`,
`adminPolicies` e `defaultPolicies` modificano l'SQL delle policy generato da `rebase db
generate`, e la CLI non può leggere il codice del driver; impostali quindi nella
dichiarazione o nell'ambiente. Un avvio che li trova solo nel codice del driver rifiuterà
di partire.

All'avvio, la riga che descrive come vengono isolate le richieste elenca ogni impostazione
che differisce dal suo valore predefinito. Un'impostazione che delega un compito a te, come
`grants: "none"`, specifica una volta sola di quale compito si tratta.

Il primo avvio con provisioning registra i ruoli di richiesta in
`rebase.schema_meta`. Un avvio successivo configurato con un ruolo diverso rifiuta di
partire e indica il comando da eseguire per migrare il database, descritto di seguito.
Senza questo controllo, il vecchio ruolo manterrebbe i suoi privilegi mentre ne verrebbe
configurato uno nuovo accanto ad esso.

## Ricette

### Un cluster condiviso con altre app o progetti

Assegna a ciascun progetto, e a ciascun deployment che condivide un cluster, un ruolo
dedicato:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Un database che è già stato eseguito come `rebase_user` tiene traccia di questa informazione,
quindi per prima cosa va migrato:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

Il comando crea il nuovo ruolo se mancante, riassegna solo in questo database tutti i
privilegi detenuti dal vecchio ruolo (tabelle, colonne, sequenze, schemi, funzioni, i
privilegi predefiniti impostati da questa connessione e le appartenenze), aggiorna le policy
che fanno riferimento al vecchio ruolo e registra il nuovo ruolo. Viene eseguito in
un'unica transazione. Il vecchio ruolo viene lasciato inalterato, poiché un altro database
sul cluster potrebbe ancora utilizzarlo. Al termine, stampa le istruzioni `REVOKE` per
revocare i privilegi del vecchio ruolo in questo database, da eseguire quando non saranno
più necessari. `--dry-run` stampa le stesse istruzioni senza modificare nulla. Su un terminale
richiede conferma prima di procedere; in assenza di un terminale rifiuta l'operazione se
non viene passato `--yes`.

Successivamente, imposta `REBASE_RLS_REQUEST_ROLE` su ogni server che utilizza il database.

`rebase doctor --database` segnala inoltre se ogni ruolo sul cluster può connettersi
al database, fornendo l'istruzione `REVOKE CONNECT … FROM PUBLIC` per impedirlo.
Rebase non esegue questa operazione autonomamente su un database di cui non è proprietario.

### Supabase

Uno schema Supabase esistente possiede già i ruoli `anon` e `authenticated`, nonché
policy definite su di essi tramite `auth.uid()`. Per fare in modo che tali policy si applichino
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

- `requestRole` esegue i chiamanti senza sessione come `anon` e tutti gli utenti
  autenticati (inclusi gli ospiti) come `authenticated`.
- `identity: "supabase"` imposta le variabili `request.jwt.*` lette da `auth.uid()`.
  Senza di esse, ogni verifica `auth.uid() = owner_id` fallisce, oppure ha esito
  positivo quando non dovrebbe.
- `policyTarget: "requestRole"` impedisce che le policy interne di Rebase vengano applicate
  a sessioni che non provengono da richieste Rebase, come la Data API di Supabase.

Dato che le richieste vengono eseguite direttamente come `anon` e `authenticated`, le
policy scritte `TO anon` o `TO authenticated` si applicano senza modifiche, rendendo superfluo
`inheritRoles`. Tale opzione è pensata per progetti le cui richieste vengono eseguite con
un ruolo proprio, come `requestRole: "acme_user", inheritRoles: ["authenticated"]`. In caso
di coppia `{ anonymous, signedIn }`, viene concesso solo al ruolo autenticato, mai a quello
anonimo.

I privilegi predefiniti forniti di serie da Supabase assegnano le tabelle create in `public`
ad `anon` e `authenticated`; verifica la configurazione del tuo progetto. Esegui
`rebase doctor --database` e `rls-check` dopo il primo avvio per verificare quali risorse
questi ruoli possono raggiungere.

### Un altro strumento è proprietario dello schema e l'app gestisce l'accesso

Alcuni database non sono sotto la gestione di sicurezza di Rebase. Tabelle gestite da
Alembic, Prisma o da un DBA, in cui la row-level security non è abilitata e l'app stessa
decide chi può vedere cosa: solo il personale può accedere, gli hook convalidano ogni scrittura,
uno scope protegge ciascuna route. Un avvio che non esegue alcun provisioning
(`REBASE_PROVISION=false`, `REBASE_MIGRATE_ON_BOOT=none`) blocca tutte queste tabelle per
impostazione predefinita (`503 TABLE_WITHHELD`), poiché Postgres restituirebbe ogni riga a
qualsiasi chiamante autenticato.

È possibile specificare che l'accesso è gestito dall'applicazione per l'intero database:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

oppure per una singola tabella:

```ts
export const invoices = defineTable("invoices", {
    columns: { /* … */ },
    rls: "admin-only",
    rlsRequired: false
});
```

Le tabelle verranno quindi servite indipendentemente da quanto presente nel catalogo, e
l'avvio le elencherà in un unico avviso. L'indicazione `rlsRequired: true` su una tabella la
mantiene obbligatoria anche all'interno di un database impostato su `required: false`. Nel
database non viene alterato nulla: un avvio configurato per effettuare provisioning continuerà
ad abilitare la row-level security e a creare le policy dichiarate, e `rebase doctor` continuerà
a segnalare le tabelle come non protette.

Con la row-level security disattivata, l'`rls` dichiarato non viene applicato da Postgres:
`"admin-only"` non impedirà l'accesso a un utente autenticato non amministratore. Mantieni
questo controllo delegato a meccanismi di autenticazione, ruoli e hook.

### Un amministratore di database crea i ruoli

Nel caso in cui la connessione non abbia i permessi per creare ruoli, o i ruoli siano definiti
in Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

L'avvio verifica quindi il ruolo e l'appartenenza e termina con un errore mostrando l'SQL
da eseguire, anziché tentare di crearli. Per fornire questo SQL in anticipo all'amministratore:

```bash
rebase db provision --print > request-role.sql
```

Questo comando genera, per ciascun ruolo di richiesta, le istruzioni atte a crearlo
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), concedere al ruolo di connessione il diritto
di passare ad esso (`WITH SET TRUE, INHERIT FALSE` su PostgreSQL 16 e successivi) e
assegnargli gli schemi secondo `grants: "schema"`. Le spiegazioni sono inserite sotto forma di
commenti SQL, rendendo il file pronto all'esecuzione. Il comando legge il ruolo di connessione
dal database senza eseguire alcuna modifica. Tutte le istruzioni possono essere rieseguite
in sicurezza.

### Richieste admin e `rebase_admin`

Postgres combina con l'operatore OR le policy permissive applicate a un ruolo. Se scritta
`TO public`, la baseline presente su ogni tabella (`rebase.uid() IS NULL OR` il ruolo `admin`)
si applicherebbe anche agli utenti autenticati, e un OR il cui secondo ramo è costante
per l'intera istruzione non può utilizzare un indice: una ricerca o un conteggio limitato alle
risorse del proprietario eseguito da un utente comporterebbe una scansione completa della tabella.
Pertanto, le policy superabili esclusivamente dal contesto server o da un admin vengono
scritte `TO rebase_admin`, non entrando mai nel piano di esecuzione delle query di un utente.

`rebase_admin` non detiene alcun privilegio e non può effettuare l'accesso. Un chiamante in
possesso del ruolo `admin`, compreso `rebase.dataAsAdmin`, viene eseguito come
`<request role>_admin` (`rebase_user_admin` per impostazione predefinita), che eredita il
ruolo di richiesta e `rebase_admin`. Una connessione essa stessa soggetta a row-level security
eredita `rebase_admin` per il contesto server. L'avvio configura tutto questo se la connessione
ha i permessi di creazione dei ruoli. Con `provisionRole: "never"`, la creazione va eseguita
manualmente:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Su PostgreSQL 15 e precedenti, crea `rebase_user_admin` con `INHERIT` omettendo le opzioni
`WITH`. Qualora non sia possibile creare `rebase_admin`, l'avvio e `rebase db push` scrivono
tali policy `TO public`, come in precedenza, e gli admin continueranno a essere eseguiti con il
ruolo di richiesta. `rebase doctor --database` segnala quale di queste configurazioni è presente.

#### Le letture admin utilizzano gli indici del proprietario

Una policy non costante impedisce a Postgres di utilizzare un indice per un operatore che
non sia leakproof, come `&&` su un array, `~` o un operatore jsonb. Senza la procedura descritta
di seguito, una clausola `tags && $1` eseguita da un admin comporterebbe una scansione completa
della tabella, mentre la medesima query eseguita dal proprietario utilizzerebbe l'indice GIN.
Questo fenomeno interessava sia `rebase.sqlAsAdmin` e `rebase.dataAsAdmin`, sia gli utenti admin.

All'avvio viene quindi associata a ciascuna policy riservata agli admin superabile da tutti
gli admin una policy complementare `TO rebase_admin_request USING (true)`, denominata
`<policy>_ar_<hash>`. In una richiesta admin, Postgres semplifica le policy a `true` e
pianifica la query come farebbe per il proprietario. Le policy restrittive restano comunque
valide. Solo i ruoli `<request role>_admin` possono detenere `rebase_admin_request`. Ad ogni avvio,
Rebase verifica quali ruoli possiedono i suoi privilegi. Se qualsiasi altro ruolo soggetto a
row-level security li possiede, l'avvio non genera policy complementari e rimuove quelle trovate.
Le policy complementari richiedono PostgreSQL 16 o versioni successive, poiché su 15 e precedenti
la connessione erediterebbe il ruolo. Vengono create unicamente all'avvio. `policies.sql` e le
migrazioni non ne creano mai, ma rimuovono la complementare di ogni policy riscritta che non ne
abbia più diritto. Anche `rebase db push` e `rebase db migrate` rimuovono le policy complementari
la cui regola di riferimento è stata eliminata. Una regola admin ristretta o rimossa smette di
concedere l'accesso a tutti gli admin anche qualora l'avvio non effettui alcun provisioning.
Con `provisionRole: "never"`, crea il ruolo manualmente:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Prima di eseguire un rollback a una versione precedente a quella che ha introdotto le policy
complementari, rendile inattive. Un runtime precedente non le riconosce e non le rimuove,
quindi una regola modificata in seguito lascerebbe la sua complementare ad autorizzare ogni admin
su ogni riga. Una singola istruzione per ciascun ruolo di richiesta admin impedisce a tutte le
complementari di autorizzare accessi:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

In alternativa è possibile eliminarle: rimuovi ogni policy il cui nome termina con `_ar_`
seguito da otto caratteri esadecimali e il cui ruolo è `rebase_admin_request`.

### Uno schema `public` condiviso

Quando lo schema `public` include tabelle a cui Rebase non dovrebbe accedere:

```bash
REBASE_RLS_GRANTS=managed
```

In questo modo Rebase concede al ruolo di richiesta solo le tabelle che gestisce direttamente:
tabelle dichiarate, tabelle di giunzione e le proprie tabelle protette a livello di riga. Non
imposta alcun privilegio predefinito negli schemi condivisi e non revoca nulla di quanto già
concesso. `rebase doctor --database` elenca le tabelle negli schemi di Rebase non gestite
dall'applicazione.

Una soluzione alternativa consiste nell'utilizzare uno schema dedicato a Rebase: imposta
`schema` all'interno di ciascun `defineTable`.

## Provider

Le capacità del ruolo di connessione variano a seconda del provider e determinano se Rebase
può creare autonomamente il ruolo di richiesta. Le note seguenti descrivono le configurazioni
previste; verifica i dettagli presso il tuo provider.

| Provider | Ruolo di connessione tipico | Note |
|---|---|---|
| Supabase | `postgres` (non è un superuser, possiede CREATEROLE) | Un database per progetto. Esistono `anon`, `authenticated` e `authenticator`, con privilegi predefiniti in `public`. Fai riferimento alla ricetta Supabase sopra. |
| Neon | il proprietario del progetto, membro di `neon_superuser` | I ruoli appartengono a un branch e ogni database del branch li condivide. Due database Rebase all'interno dello stesso progetto Neon condividono `rebase_user`; imposta pertanto un `requestRole` specifico per database. |
| AWS RDS / Aurora | l'utente master, membro di `rds_superuser` | Dispone di CREATEROLE ma non è un superuser. Le istanze sono spesso condivise tra più app. |
| Google Cloud SQL | `postgres`, membro di `cloudsqlsuperuser` | Comportamento analogo a RDS. |
| Azure Flexible Server | l'utente admin, membro di `azure_pg_admin` | Comportamento analogo a RDS. |
| InstaPods | `instapod`; superuser tramite `sudo -u postgres` | [La guida di InstaPods](/docs/deployment/instapods/) descrive come creare il ruolo preventivamente. |
| Hostman | `gen_user`; CREATE ROLE assegnato dal pannello | Non disponibile nel piano più economico. [La guida di Hostman](/docs/deployment/hostman/) descrive come creare il ruolo preventivamente. |

## Contenuti correlati

- [Comandi del database](/docs/cli/database/): `rebase db request-role` e
  `rebase db provision`
- [Riferimento CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): analizza le policy su qualsiasi istanza Postgres
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/): le policy
  generate da Rebase per ciascuna tabella
