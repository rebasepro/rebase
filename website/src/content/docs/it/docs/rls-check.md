---
sourceHash: 313f8530404811bc
slug: it/docs/rls-check
title: rls-check
description: Esegui l'audit della row-level security su qualsiasi database PostgreSQL — Supabase, Neon, RDS o il tuo server. Sola lettura, nessuna registrazione, Rebase non richiesto.
---

# rls-check

`rls-check` legge il catalogo di un database PostgreSQL e segnala cosa è effettivamente esposto:
tabelle servite con la row-level security disattivata, policy che restituiscono true per
chiunque, viste che leggono direttamente oltre l'RLS delle rispettive tabelle di base e tabelle
di join dimenticate mentre entrambi i relativi endpoint sono stati bloccati.

Funziona su **qualsiasi** Postgres — Supabase, Neon, RDS, Cloud SQL o un server gestito direttamente da te. Non richiede Rebase ed è utile sia che tu decida di adottarlo o meno.

```bash
npx @rebasepro/rls-check
```

Eseguilo nella directory del tuo progetto e troverà il database da solo: prima controlla `DATABASE_URL`,
poi `POSTGRES_URL`, quindi un file `.env` locale. Passa la stringa di connessione come
argomento solo quando non puoi fare altrimenti — npm mostra il comando nella riga di comando prima
dell'avvio del programma e la tua shell lo registra, quindi una password passata come argomento finisce in
due punti che `rls-check` non può oscurare. `$DATABASE_URL` non è più sicuro in quel caso: la shell
lo espande prima ancora che npm lo riceva.

È in sola lettura per progettazione: apre una transazione di sola lettura ed esegue query sul catalogo.
Non scrive nulla e non invia nulla da nessuna parte — non è presente alcuna telemetria né alcuna
chiamata di rete oltre a quella verso il tuo database.

## Esecuzione

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Se la tua password contiene `/`, `?` o `#`, codificala in percent-encoding. Questi tre caratteri terminano
la sezione dell'authority dell'URL, pertanto la separazione avverrebbe all'interno delle credenziali — invece di stampare frammenti di
una password, `rls-check` rifiuta la stringa e lo segnala.

`@` e `:` non richiedono codifica: le informazioni utente vengono suddivise all'**ultima** `@` e l'utente al
**primo** `:`, che è esattamente ciò che fa anche `pg`; pertanto `postgres://user:pa@ss@host:5432/db` si connette
all'host `host` con la password `pa@ss`. Codificarli comunque non è mai sbagliato.

### Opzioni

| Opzione | Significato |
| --- | --- |
| `--json` | Output machine-readable su stdout, e nient'altro su stdout |
| `--format <name>` | `text` (predefinito), `json` (equivalente a `--json`) o `agent`: un documento JSON per un coding agent, in cui ogni risultato include la tabella e la policy interessate, l'SQL correttivo e le regole Rebase `securityRules` equivalenti |
| `--html <path>` | Scrive anche un report HTML autonomo nel percorso specificato. Un unico file, nessuna richiesta di rete |
| `--schema <name>` | Limita la scansione a uno schema. Ripetibile o separato da virgole |
| `--role <name>` | Tratta questo ruolo come un ruolo con cui può presentarsi un chiamante non attendibile, oltre ad `anon`, `authenticated`, `web_anon` e `rebase_user`. Ripetibile o separato da virgole |
| `--request-role <name>` | Il ruolo con cui un'app Rebase su questo database esegue le richieste, invece di `rebase_user` (l'impostazione `rls.requestRole`). In assenza di questo flag, vengono usati i ruoli registrati dal database in `rebase.schema_meta`, poi `rebase_user`. Ripetibile o separato da virgole |
| `--fail-on <severity>` | Termina con exit code 1 a questo livello di gravità o superiore. Predefinito `high`; `none` non fallisce mai |
| `--only <id>` | Esegue solo questi controlli. Ripetibile o separato da virgole |
| `--skip <id>` | Salta questi controlli. Ripetibile o separato da virgole |
| `--list-checks` | Stampa il catalogo dei controlli ed esce |
| `--timeout <ms>` | Timeout per istruzione, predefinito 15000 |
| `--quiet` | Solo i problemi rilevati — nessun banner, nessun riepilogo |
| `--no-color` | Disabilita i colori ANSI (rispetta anche `NO_COLOR` e uno stdout non-TTY) |

Un id sconosciuto passato a `--only` o `--skip` genera un errore anziché essere ignorato silenziosamente, poiché
un refuso indebolirebbe in modo silenzioso la scansione. Un `--role` o `--request-role` non presente in `pg_roles`
è un errore per la stessa ragione: ogni controllo si basa su un grant concesso a un ruolo esposto, per cui un nome
che non corrisponde a nulla rimuoverebbe la copertura senza avviso. Lo stesso vale per uno `--schema` che non identifica alcuno schema,
il quale altrimenti non scansionerebbe nulla riportando falsamente che tutto è a posto. I nomi degli schemi sono case-sensitive.

L'intestazione del report indica i ruoli che l'esecuzione ha trattato come esposti, così da poter verificare a colpo d'occhio
se l'esito `No findings` includeva il ruolo con cui la tua applicazione si connette:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Quando la scansione si connette con un ruolo che la row-level security *può* limitare — non un superuser, non
un proprietario, nessun flag `BYPASSRLS` — tale ruolo viene aggiunto al set e il report lo segnala. Eseguire la scansione con
il ruolo stesso della tua applicazione è la cosa più vicina a chiedere al database cosa vede effettivamente la tua API.

### Codici di uscita

| Codice | Significato |
| --- | --- |
| `0` | Nessun problema riscontrato alla soglia `--fail-on` o superiore |
| `1` | Almeno un problema riscontrato alla soglia o superiore |
| `2` | Impossibile eseguire la scansione — argomenti non validi, connessione rifiutata, errore di autenticazione, timeout — oppure scansione incompleta: lettura del catalogo non riuscita o arresto anomalo di un controllo (`diagnostics.degraded`). Questo vale anche con `--fail-on none` |

I codici `1` e `2` sono volutamente distinti: un errore di connessione non deve mai sembrare un database privo di problemi.

### In CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Un nuovo progetto Rebase non supererà questo controllo al primo avvio, e non è previsto che lo faccia.** Il
`defaultRls` dello scaffold apre le letture a chiunque — `{ operation: "select", access:
"public" }` in `backend/schema/index.ts`, che `authors` e `tags` adottano con
`rls: "inherit"` — pertanto ciascuno segnala un problema critico `policy-always-true`. (`posts` dichiara le proprie regole e legge solo le righe pubblicate.) `access: "public"` riguarda le *righe*, non chi può chiamare l'API:
a una richiesta priva di token viene comunque risposto 401 finché `AUTH_REQUIRE` è attivo. La segnalazione è
corretta in ogni caso, poiché questa è l'unica barriera a protezione dei dati.

Stabilisci quale sia la tua situazione prima di integrare questo passaggio nella CI:

- **le regole sono provvisorie** — sostituiscile con quelle effettivamente necessarie per i tuoi dati
  ([row-level security](/docs/collections/security-rules)), e le segnalazioni scompariranno;
- **le righe sono realmente leggibili da chiunque** — dichiaralo esplicitamente una volta, con
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, sapendo a cosa rinunci:
  `--skip` disabilita il controllo ovunque, compresa la tabella che aggiungerai il mese prossimo.

### Output JSON

`--json` restituisce un oggetto stabile: `scannedAt`, `database` (solo host e nome — mai
credenziali), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` e `diagnostics`. Ogni elemento di findings include `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` e `confidence`.

`exposedRoles` e `diagnostics` fanno parte del contratto, non sono dettagli opzionali: ogni controllo si basa
sull'insieme dei ruoli esposti, e `diagnostics.degraded` è il modo in cui un consumer distingue "nessun problema riscontrato"
da "impossibile effettuare la scansione". Leggere `findings: []` senza verificare entrambi equivale a leggere solo metà della risposta.

### Output agent

`--format agent` stampa un singolo documento JSON destinato a un coding agent per correggere quanto rilevato. Ogni
segnalazione specifica l'id del controllo e l'oggetto interessato (`target.table`, `target.policy`, …) e include
una `remediation`: `apply` (`sql`; `rebase-config` quando Rebase ricompila la policy a partire da `rls` della
tabella a ogni avvio; oppure `manual`), il codice `sql` eseguibile preparato per ciascun controllo, i
`placeholders` da compilare prima dell'esecuzione, e `rebase` — la medesima correzione espressa come `rls` della tabella, con un
estratto `defineTable(…, { rls })` per `backend/schema/`, oppure la spiegazione del perché le regole non possono esprimerla. Dalla
versione 0.31 questa chiave è `rebase.rls` (in precedenza era `rebase.securityRules`) e la versione del formato del documento è 2. La
`key` di ciascuna segnalazione è stabile tra un'esecuzione e l'altra, così da evidenziare cosa è stato risolto con una nuova scansione. `--json` rimane invariato.

## Esecuzione pianificata

Un controllo che bisogna ricordarsi di eseguire a mano è un controllo che segnalerà un database pulito
fino al giorno esatto in cui si verificherà un problema. Il backend può eseguirlo per te e
mostrarne il risultato nel pannello di amministrazione:

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // the default
    warnAtSeverity: "high"            // the default
};
```

Passalo come `rlsAudit` nell'oggetto fornito a `initializeRebaseBackend`.

Nel runtime — `rebase dev`, `rebase start` e l'immagine server pubblicata —
non c'è un oggetto di questo tipo da passare, quindi imposta invece `REBASE_RLS_AUDIT=true`,
con intervallo e soglia predefiniti. Lo scanner deve comunque provenire dal tuo
progetto: aggiungi `@rebasepro/rls-check` alle relative dipendenze affinché il bundle lo includa.
Il runtime non include alcuna copia interna, e un avvio che richiede l'audit senza
il pacchetto fallisce prima ancora di aprire la connessione, specificando il pacchetto da aggiungere.

Il risultato è disponibile all'endpoint `GET /api/admin/rls-audit`, protetto dallo scope
`schema:read`, e ogni esecuzione scrive una riga di log — a livello `warn` quando un risultato raggiunge
`warnAtSeverity`, a livello `info` negli altri casi:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit, or run
    `npx @rebasepro/rls-check` for the full report.
```

### Perché passare `scan`

`@rebasepro/server` non include un driver di database proprio; `@rebasepro/rls-check`
include `pg`, poiché si connette a Postgres. Importarlo all'interno del pacchetto server
introdurrebbe un secondo driver Postgres in ogni installazione, a fronte di una funzionalità usata solo da
alcune di esse; per questo motivo si passa direttamente la funzione.

### In un deployment distribuito

L'audit è un singleton con *ownership*, come lo scheduler di cron. Ogni processo a cui è
assegnata la proprietà esegue la propria scansione, operazione in sola lettura e innocua ma ridondante — assegnala
a un unico processo:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

oppure, per un runtime configurato tramite variabili d'ambiente:

```bash
REBASE_RLS_AUDIT=false
```

Il ruolo `functions` lo possiede già impostato su `false` — tale processo non esegue alcun timer.
L'override esplicito di una singola ownership non altera le altre: disabilitare cron lascia
invariato l'audit, e viceversa.

Un processo che serve l'interfaccia di amministrazione senza essere proprietario della scansione risponde
all'endpoint in modo trasparente, segnalando che la scansione non viene eseguita su tale nodo.

### È una rete di sicurezza, non uno strumento di monitoraggio

L'intervallo predefinito è di un giorno, poiché l'oggetto del controllo è lo schema:
cambia in occasione dei deploy, non in base al traffico. Una scansione fallita viene registrata nei log e salvata
nello stato — non genera mai un'eccezione non gestita. Trasformare un controllo di sicurezza in un nuovo motivo
di crash del server sarebbe una scelta controproducente sotto ogni aspetto.

## Come interpretare il report

**I problemi accertati compaiono per primi; le segnalazioni euristiche si trovano in una sezione separata ("worth checking").** Un controllo euristico non può dedurre l'intento — una tabella di giunzione lasciata volutamente
accessibile non è necessariamente un bug — pertanto tali segnalazioni sono formulate come verifiche suggerite e non vengono mai mescolate alle certezze.

**Presta attenzione alla nota sui privilegi.** Se la scansione si connette come superuser, proprietario della tabella o
ruolo dotato di `BYPASSRLS`, ciò viene indicato espressamente. Tale ruolo vede il catalogo reale, condizione che rende
possibile l'audit, ma significa anche che nulla nel report descrive l'esperienza vissuta da *quella specifica* connessione.
I risultati riguardano ciò a cui hanno accesso gli altri ruoli.

### Su un database Rebase, modifica la regola, non la policy

Ogni policy in un deployment Rebase viene compilata a partire dall'`rls` della tabella, e il
runtime **le verifica a ogni avvio**: ciascuna policy generata include un'impronta (un
commento `rebase:<hash>`) di ciò che è stato compilato e di ciò che Postgres ha memorizzato; una tabella le cui
policy non corrispondono più viene riallineata in base alla configurazione. Un'istruzione `ALTER POLICY` eseguita direttamente su
una di esse sopravvive quindi solo fino al successivo riavvio, dopo il quale la segnalazione ricompare —
anche dopo aver visto che era scomparsa.

`rls-check` riconosce queste policy (da un nome del tipo `<table>_<operation>_<hash>`, o da una chiamata a
`rebase.uid()` / `rebase.roles()` nell'espressione) e suggerisce la regola da modificare anziché l'istruzione SQL.
Quando trovi un fix di questo tipo:

1. individua la tabella indicata, all'interno di `backend/schema/`;
2. modifica il relativo `rls` — consulta [row-level security](/docs/collections/security-rules);
3. se la tabella specifica `rls: "inherit"`, eredita `defaultRls` da
   `backend/schema/index.ts`, che è quindi il file da modificare;
4. esegui nuovamente il deploy — l'avvio riapplica le policy — oppure esegui `rebase db push`.

Una policy creata a mano, all'interno di una migrazione, non viene toccata da questo meccanismo e la relativa soluzione rimane l'SQL da eseguire.

## I controlli

I livelli di gravità sotto indicati sono quelli predefiniti; diversi controlli adeguano la propria gravità in base a
quanto rilevato, e il report ne illustra sempre la motivazione.

### rls-disabled

**Tabella esposta senza row-level security.** Critico.

La tabella ha l'RLS disabilitato *e* concede privilegi `SELECT`/`INSERT`/`UPDATE`/`DELETE` a un ruolo a cui può
accedere un chiamante non attendibile (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres non applica
alcun filtro per riga, per cui le policy — qualora presenti — non vengono mai interpellate.

Viene segnalata anche una foreign table a cui sia stato concesso un simile grant. Postgres non supporta l'RLS sulle foreign table,
quindi il grant espone qualsiasi dato restituito dal server remoto; la correzione proposta provvede pertanto a revocare
il grant.

Una tabella con RLS disattivato ma priva di grant verso un ruolo esposto *non* viene segnalata, così come una tabella situata
in uno schema su cui tale ruolo non possiede il privilegio `USAGE` — Postgres risponde "permission denied for schema" prima
ancora di accedere alla tabella. Non essendo raggiungibile, segnalarla genererebbe solo rumore.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Abilitare l'RLS in assenza di policy nega l'accesso a ogni riga a chiunque tranne che al proprietario; aggiungi quindi la policy
prevista all'interno della stessa migrazione — altrimenti avrai sostituito un'esposizione di dati con un
disservizio silenzioso. Consulta [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La policy concede accesso incondizionato.** Critico.

Una policy permissiva la cui espressione `USING` o `WITH CHECK` è una costante booleana vera: `true`,
`(true)`, `1 = 1`, `1 > 0`, `NOT false`, `true OR <anything>`, oppure una costante confrontata con
se stessa tramite cast. Le policy permissive vengono valutate in logica OR, pertanto ne basta una sola per
soddisfare il filtro di riga della tabella indipendentemente da quanto siano restrittive le altre policy.

Come ogni controllo, segnala un'esposizione solo se un ruolo a cui si applica può effettivamente accedere alla tabella:
ovvero possiede il privilegio richiesto dal comando e il privilegio `USAGE` sullo schema. Una condizione `USING (true) TO anon` su una
tabella su cui `anon` non possiede alcun diritto riceve l'errore "permission denied" prima ancora che la policy venga consultata.
Tale policy viene riportata a livello **info**, contrassegnata come *latente*: attualmente non permette ad alcuno di accedere
alla tabella, ma un singolo `GRANT` la trasformerebbe in un'esposizione critica senza alcuna modifica alla policy stessa. Il livello info
è inferiore a qualsiasi soglia `--fail-on` eccetto `info`, pertanto non blocca mai un'esecuzione predefinita.

Quando solo l'espressione `WITH CHECK` di una policy di `UPDATE` è costante — `USING (user_id = rebase.uid())
WITH CHECK (true)` — la gravità è **high**: `USING` determina comunque quali righe possono essere modificate, mentre
il check consente alla riga modificata di assumere qualsiasi valore, ad esempio l'ID di un altro utente. In una policy `FOR ALL` lo
stesso check consente anche qualsiasi `INSERT`, rimanendo pertanto critica.

Se policy di tipo `RESTRICTIVE` relative allo stesso comando (`ALL` per una permissiva `ALL`) si applicano a ogni
ruolo esposto raggiunto dalla policy permissiva, la gravità viene ridotta a media e indicata come elemento
da verificare anziché come certezza, poiché le policy restrittive vengono applicate in AND dopo l'OR delle
permissive. Una policy restrittiva che vincola altri ruoli o un altro comando non è considerata sufficiente: lascia aperta
quella permissiva a tutti gli altri.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Su un database Rebase la soluzione consiste nella regola della tabella piuttosto che in tale istruzione — vedi
[modifica la regola, non la policy](#su-un-database-rebase-modifica-la-regola-non-la-policy). Uno scaffold
iniziale standard riporta questo controllo su `posts`, `authors` e `tags` per impostazione predefinita.

### policy-anonymous-tautology

**La policy verifica solo l'esistenza di un identificativo del chiamante.** La gravità dipende dalla piattaforma.

L'espressione segue la forma `rebase.uid() IS NOT NULL` (o `auth.uid()` su Supabase, e sui database
Rebase configurati prima della versione 1.0): distingue i chiamanti autenticati da quelli anonimi, ma
non limita l'ambito a determinate righe. Ogni utente autenticato può accedere a qualsiasi riga coperta dalla policy.

La gravità dipende dalla piattaforma e la distinzione è importante:

- **Su Supabase**, `auth.uid()` restituisce `NULL` per i chiamanti anonimi, rappresentando quindi un controllo
  funzionante per soli utenti autenticati. Viene segnalato come **low** — una mancata limitazione dei dati tra
  utenti autenticati, non una falla di accesso anonimo. Questo vale unicamente per `auth.uid()` (e per il claim `sub`
  da cui legge): una richiesta non autenticata trasmette comunque la chiave anon del progetto, quindi `auth.role()`
  è `'anon'` e `auth.jwt()` corrisponde ai claim di tale chiave. La medesima struttura basata su uno di questi ultimi
  è *vera per i chiamanti non autenticati* e viene segnalata come **critical**.
- **Su Rebase o PostgREST**, dove un caller id vuoto viene convertito nella sentinella `'anonymous'`,
  l'espressione è *vera anche per i chiamanti non autenticati*. Viene segnalata come **critical**.
- **Su una piattaforma non riconosciuta**, viene segnalata come **medium**, poiché l'effettiva presenza di
  una vulnerabilità dipende dall'uso o meno di una tale sentinella nel tuo stack.

Un database viene considerato Rebase quando contiene lo schema `rebase`. La presenza del ruolo
`rebase_user` non è determinante, poiché i ruoli appartengono all'intero server e un'istanza che ospita
un'applicazione Rebase può contenere altri database.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

L'SQL suggerito viene stampato con la funzione di identificazione del chiamante effettivamente presente nel tuo database:
`rebase.uid()` su database Rebase, `auth.uid()` su Supabase e PostgREST. Entrambe le
forme vengono riconosciute in fase di analisi delle policy, per cui anche un database Rebase nel corso della migrazione
dallo schema `auth` precedente alla 1.0 viene regolarmente controllato.

### policy-authenticated-tautology

**La policy consente a ogni chiamante autenticato l'accesso a ogni riga.** Gravità High; Critical per la variante con verifica del ruolo descritta sotto.

La forma corretta del controllo precedente — `rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'` — che corrisponde al punto in cui molti si fermano. Esclude effettivamente i chiamanti non autenticati. Quello che
non fa è circoscrivere l'accesso alle righe: ciò che resta è che *ogni account registrato può leggere ogni riga di
questa tabella*, che è un comportamento molto diverso da quello solitamente voluto. Su un
progetto Rebase si tratta di una regola la cui `condition` è unicamente `policy.authenticated()`,
che il database memorizza come `rebase.uid() <> ALL (ARRAY['anonymous', 'anon'])`.
Viene segnalata anche una regola la cui condizione è
esclusivamente `policy.registered()`: il controllo aggiuntivo `NOT rebase.is_anonymous()` esclude
gli ospiti ma non applica alcun filtro sulle righe, permettendo a qualsiasi account non ospite di leggere ogni
riga. Con il valore predefinito `--fail-on high`, un'esecuzione in CI che rileva tale policy ora fallirà.

Anche una policy la cui espressione verifica unicamente il ruolo del chiamante — `auth.role() = 'authenticated'`, `(auth.jwt() ->> 'role') =
'authenticated'`, in entrambi gli ordini — viene segnalata sotto questo id. Equivale a `TO authenticated
USING (true)` formulato come espressione, acquisendo quindi la gravità prevista da
[`policy-always-true`](#policy-always-true): critical, oppure high nel caso in cui solo la clausola
`WITH CHECK` di una policy di `UPDATE` effettui la verifica del ruolo.

È la classica struttura che trasforma una tabella `users` in un elenco pubblico di tutti gli indirizzi della
piattaforma, visibile a chiunque si sia registrato — e nei sistemi con registrazione aperta, "chiunque si sia
registrato" equivale a chiunque. La segnalazione è separata da quella per utenti anonimi perché
sia la soluzione che la gravità sono differenti, e potresti voler ignorare
legittimamente l'una e non l'altra.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Se la tabella deve essere effettivamente leggibile da ogni account — un listino prezzi condiviso, un elenco
di paesi — mantieni la policy e disattiva la segnalazione con
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**La vista scavalca l'RLS della tabella di base.** Critico.

Una vista concessa a un ruolo non attendibile che esegue una select da una tabella protetta da RLS senza
`security_invoker = true`. La vista viene eseguita con i privilegi del suo **proprietario**, leggendo la
tabella di base con tali diritti e impedendo che le policy del chiamante vengano applicate. È la causa più comune
di fuga di dati da una tabella protetta con cura.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Nelle versioni di PostgreSQL inferiori alla 15 questa opzione non è disponibile, pertanto ogni vista di questo tipo si
comporta così. In tal caso il riscontro viene segnalato come euristico e la soluzione consiste nello spostare la logica all'interno di
una funzione o nell'aggiornare il database.

Di norma il proprietario è esente dalle policy della tabella di base, ma non sempre. Quando il proprietario
della vista non è superuser, non possiede `BYPASSRLS` e non è proprietario della tabella di base (oppure ne è proprietario
ma con `FORCE ROW LEVEL SECURITY`), le policy si applicano al proprietario. La vista restituisce quindi a qualsiasi
chiamante le righe accessibili al proprietario in base a tali policy. Questo insieme può contenere meno righe di quelle che
il chiamante dovrebbe vedere, oppure di più. Il problema viene comunque segnalato, poiché le righe restituite non dipendono da
chi le richiede, ma con carattere euristico anziché certo. La correzione rimane la stessa.

### matview-bypasses-rls

**La vista materializzata espone dati protetti da RLS.** High.

Le viste materializzate non supportano la row-level security e i dati al loro interno costituiscono uno
snapshot memorizzato generato dall'utente che ne ha effettuato il refresh. Se una vista materializzata è concessa a un ruolo non attendibile e la sua
query di definizione legge da una tabella protetta da RLS, nessuna policy può impedire la fuga — è necessario revocare il grant, oppure spostare
la vista materializzata in uno schema non accessibile ai ruoli non attendibili. La soluzione proposta revoca ogni
grant che raggiunge un ruolo non attendibile, rimuovendolo dal ruolo specificato dal grant stesso: un grant assegnato a un ruolo
ereditato da `anon` non viene revocato tramite `REVOKE … FROM anon`.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**I chiamanti non autenticati possono scrivere.** High.

Una policy permissiva `INSERT`/`UPDATE`/`DELETE`/`ALL` raggiungibile senza autenticazione la cui
espressione di verifica accetta qualsiasi riga, accompagnata da un grant corrispondente.

La condizione di "accettare qualsiasi riga" è fondamentale e volutamente circoscritta. Supabase assegna ad `anon`
e `authenticated` pieni permessi DML per impostazione predefinita, quindi una policy destinata a questi ruoli non costituisce di per sé
un problema — una classica istruzione `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` è corretta
e non viene segnalata.

Una policy è accessibile a un chiamante non autenticato tramite `TO public`, tramite un ruolo denominato
`anon` o `web_anon`, o tramite un ruolo di cui uno di questi è membro: `TO app_writer`
è considerata accessibile se `anon` eredita `app_writer`.

In Rebase non esiste il ruolo `anon`. Ogni richiesta viene eseguita come `rebase_user`, comprese quelle
non autenticate qualora l'API le ammetta (`AUTH_REQUIRE=false`, o `auth.requireAuth: false`)
e gli account guest derivanti dall'accesso anonimo. Il database non può rilevare questa impostazione, pertanto su
Rebase una scrittura accessibile solo da `rebase_user` viene segnalata a titolo euristico. Con la protezione dell'API attiva
e l'accesso guest disabilitato, solo gli utenti autenticati raggiungono la policy, ma possono comunque scrivere qualsiasi
riga. Limita l'ambito della regola di scrittura della tabella al chiamante (tramite un `ownerField`) o ai `roles`.

### unqualified-column-in-subquery

**Colonna non qualificata all'interno di una sottoquery di policy.** High, euristico.

Il nome semplice di una colonna all'interno di una sottoquery `EXISTS`/`IN` presente su *entrambe* le relazioni:
quella interna e la tabella della policy stessa. Postgres la associa alla tabella **interna**, eliminando silenziosamente
la correlazione con la riga esterna che si intendeva verificare; il predicato diventa così banalmente
soddisfatto — oppure banalmente insoddisfacibile, negando qualsiasi riga a chiunque.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**Ciò che appare nel catalogo non è ciò che hai scritto.** `pg_policies.qual` è la rappresentazione
rigenerata da Postgres a partire dal parse tree, e all'interno di una sottoquery qualifica sempre i riferimenti
alle colonne; per tale motivo il nome non qualificato non è più visibile nel momento in cui il catalogo viene letto. Ciò che
permane è il suo effetto: la colonna `org_id` non qualificata è stata associata alla tabella interna, e il predicato
memorizzato confronta la colonna di quella tabella con se stessa —
`m.org_id = m.org_id`. È proprio questo auto-confronto ciò che questo controllo individua su un database attivo.

**L'assenza di questa segnalazione non garantisce la sicurezza.** Un nome non qualificato confrontato con una
colonna interna *diversa* (`organization_id = id`) viene memorizzato come `m.organization_id = m.id`,
il che appare a tutti gli effetti come un confronto intenzionale. Quando questo controllo rileva un'anomalia costituisce una prova solida;
quando non rileva nulla, non prova nulla.

### junction-table-unprotected

**Tabella di giunzione many-to-many senza RLS.** High, euristico.

Una tabella costituita essenzialmente dai soli endpoint di due foreign key, entrambi facenti riferimento a
tabelle protette da RLS, ma priva essa stessa di row-level security — e accessibile in lettura o scrittura
da un ruolo con cui può agire un chiamante non attendibile. Entrambi i lati della relazione
sono protetti mentre la giunzione tra di essi resta aperta — consentendo di enumerare le relazioni
anche quando nessuno dei due endpoint può essere letto direttamente.

La segnalazione è euristica poiché una tabella di giunzione viene dedotta dalla propria struttura. Se la tua tabella è volutamente
pubblica, usa `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS abilitato ma non forzato per il proprietario della tabella.** Medium, high o critical.

Senza l'opzione `FORCE`, il proprietario della tabella è esente dalle proprie policy, così come ogni membro
del ruolo proprietario. Ciò è innocuo se il proprietario è un ruolo dedicato al provisioning con cui non si connette
nessuno, ma diventa un rischio grave quando l'applicazione si connette come proprietario — pertanto la gravità è **critical** quando un
ruolo con cui si presenta un chiamante non attendibile possiede la tabella o fa parte del ruolo proprietario,
**high** quando il ruolo proprietario può effettuare il login o ne fa parte un ruolo con facoltà di login, e
**medium** in tutti gli altri casi.

Se il proprietario è un superuser o dispone del flag `BYPASSRLS`, la gravità rimane medium e viene esplicitato: la clausola `FORCE` non può
vincolare tale ruolo, e suggerire il contrario risulterebbe fuorviante.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS abilitato in assenza di policy.** Medium.

Non si tratta di una falla di sicurezza — al contrario. L'RLS attivo senza alcuna policy nega l'accesso a qualsiasi riga
a chiunque tranne che al proprietario. Viene segnalato in quanto si tratta di un malfunzionamento *invisibile*: l'API restituisce `[]`, e
una tabella priva di dati è indistinguibile da una tabella filtrata. Questa configurazione ha provocato il rilascio silenzioso
di tabelle vuote in produzione per settimane consecutive.

### policy-role-unreachable

**Le policy fanno riferimento a ruoli a cui nessuno si connette.** Medium.

Tutte le policy della tabella indicano ruoli che non esistono, non possono effettuare il login e che nessun
ruolo di login eredita in modo transitivo. Le policy sembrano corrette ma non si applicano a nessuno, per cui la tabella risulta
completamente vuota.

Il caso tipico è rappresentato da policy scritte con `TO authenticated` — un ruolo tipico di Supabase — su un database
in cui le richieste arrivano in realtà con un ruolo differente.

### grant-to-public

**Privilegi della tabella concessi a PUBLIC.** Medium.

Un privilegio DML concesso a `PUBLIC`, su una tabella ordinaria o su una foreign table. Anche con l'RLS abilitato, questo
amplia la platea dei soggetti per cui le policy devono essere valutate, e non si tratta quasi mai di una scelta intenzionale.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Routine SECURITY DEFINER con search_path modificabile.** Medium.

La routine viene eseguita con i privilegi del suo proprietario — spesso un superuser — mentre il chiamante controlla la modalità di risoluzione
dei relativi identificatori. Si tratta del classico schema di privilege-escalation, in cui qualsiasi entità
toccata dalla routine viene letta con i diritti del proprietario, bypassando l'RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La policy invoca `current_setting()` senza `missing_ok`.** Low, euristico.

L'invocazione di `current_setting('app.tenant_id')` con un solo argomento *genera un'eccezione* qualora il parametro non sia impostato,
anziché restituire `NULL`. Di conseguenza, invece di negare l'accesso alla riga, la richiesta genera un errore — il chiamante
riceve un 500 anziché un risultato vuoto, e un eventuale middleware configurato per ritentare gli errori 5xx ripeterà una richiesta
destinata comunque a fallire.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Cosa questo strumento non fa

Definire con chiarezza i limiti è fondamentale — uno strumento di sicurezza che sovrastima la propria copertura è
peggiore di nessuno strumento.

- **È un audit statico del catalogo.** Esamina `pg_class`, `pg_policies`, `pg_depend` e tabelle
  simili. Non si connette impersonando il tuo ruolo `anon` per tentare di estrarre dati, pertanto non può
  confermare se una vulnerabilità sia effettivamente sfruttabile attraverso la tua API.
- **Non può garantire che una policy sia corretta.** Individua strutture note per essere errate. Una
  policy che supera tutti i controlli qui descritti può comunque implementare una regola di business sbagliata.
- **Un report senza segnalazioni non costituisce una certificazione di sicurezza.** In particolare, si veda la nota su
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres riscrive le espressioni delle
  policy, quindi alcuni bug non risultano più visibili nel catalogo.
- **Non verifica l'autorizzazione a livello applicativo**, le chiavi API, l'esposizione di rete,
  la gestione dei secret né alcun altro aspetto esterno al database.

## Correlati

- [Row-level security](/docs/collections/security-rules) — l'impostazione `rls` delle tabelle Rebase, che
  compila nelle policy analizzate da questo strumento.
- [Backend only](/docs/getting-started/headless/) — perché una tabella priva di policy non viene
  esposta affatto in un progetto headless.
- [REST API](/docs/backend/api/) — la superficie esposta da una policy permissiva.
