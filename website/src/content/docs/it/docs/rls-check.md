---
sourceHash: 3165c5299e4bc1f3
slug: it/docs/rls-check
title: rls-check
description: Esegui l'audit della row-level security su qualsiasi database PostgreSQL — Supabase, Neon, RDS o il tuo server. Di sola lettura, nessuna registrazione, nessun Rebase richiesto.
---

# rls-check

`rls-check` legge il catalogo di un database PostgreSQL e segnala cosa è effettivamente esposto:
tabelle servite con la row-level security disattivata, policy che valutano a true per
chiunque, viste che leggono ignorando direttamente la RLS sulle loro tabelle di base, e tabelle
di join dimenticate mentre entrambi i loro endpoint erano protetti.

Funziona su **qualsiasi** Postgres — Supabase, Neon, RDS, Cloud SQL o un server gestito
da te. Non richiede Rebase ed è utile a prescindere dal fatto che tu lo adotti o meno.

```bash
npx @rebasepro/rls-check
```

Eseguilo nella directory del tuo progetto e individuerà il database autonomamente: `DATABASE_URL`,
poi `POSTGRES_URL`, quindi un file `.env` presente nella cartella. Passa la stringa di connessione come
argomento solo quando non puoi fare altrimenti — npm ripete la riga di comando prima che
il programma si avvii e la tua shell la registra, quindi una password passata come argomento finisce in
due punti che `rls-check` non può oscurare. `$DATABASE_URL` non è più sicuro in quel contesto: la shell
lo espande prima ancora che npm possa vederlo.

È di sola lettura per progettazione: apre una transazione di sola lettura ed esegue query sul
catalogo. Non scrive nulla e non invia nulla all'esterno — non c'è telemetria né alcuna
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

Se la tua password contiene `/`, `?` o `#`, codificala con percent-encoding. Questi tre caratteri
terminano la sezione authority dell'URL, quindi la separazione finirebbe all'interno della credenziale — anziché
stampare frammenti di una password, `rls-check` rifiuta la stringa e lo segnala.

`@` e `:` non richiedono codifica: le informazioni utente vengono divise all'**ultima** `@` e l'utente al
**primo** `:`, che è esattamente ciò che fa anche `pg`, quindi `postgres://user:pa@ss@host:5432/db` si connette
all'host con la password `pa@ss`. Codificarli comunque non è mai sbagliato.

### Opzioni

| Opzione | Significato |
| --- | --- |
| `--json` | Output leggibile da macchina su stdout, e nient'altro su stdout |
| `--html <path>` | Scrive anche un report HTML autonomo a quel percorso. Un unico file, nessuna richiesta di rete |
| `--schema <name>` | Limita la scansione a uno schema. Ripetibile o separato da virgole |
| `--role <name>` | Considera questo ruolo come uno con cui arriva un chiamante non attendibile, oltre ad `anon`, `authenticated`, `web_anon` e `rebase_user`. Ripetibile o separato da virgole |
| `--fail-on <severity>` | Esce con codice 1 a partire da questo livello di gravità o superiore. Predefinito `high`; `none` non fallisce mai |
| `--only <id>` | Esegue solo questi controlli. Ripetibile o separato da virgole |
| `--skip <id>` | Salta questi controlli. Ripetibile o separato da virgole |
| `--list-checks` | Stampa il catalogo ed esce |
| `--timeout <ms>` | Timeout dell'istruzione, predefinito 15000 |
| `--quiet` | Mostra solo i problemi rilevati — nessun banner, nessun riepilogo |
| `--no-color` | Disabilita i colori ANSI (rispetta anche `NO_COLOR` e uno stdout non-TTY) |

Un ID sconosciuto passato a `--only` o `--skip` produce un errore anziché un'operazione ignorata
silenziosamente, poiché un errore di battitura indebolirebbe la scansione senza avvisare. Un
`--role` non presente in `pg_roles` genera un errore per lo stesso motivo: ogni controllo si basa su
privilegi concessi a un ruolo esposto, quindi un nome che non corrisponde a nulla rimuoverebbe
copertura in modo trasparente. Lo stesso vale per un `--schema` che non indica alcuno schema, che
altrimenti non scansionerebbe nulla e lo segnalerebbe come pulito. I nomi degli schemi distinguono
maiuscole e minuscole: `Public` non è `public`.

L'intestazione del report indica i ruoli che l'esecuzione ha considerato esposti, così puoi verificare a colpo d'occhio
se `No findings` includeva il ruolo con cui si connette la tua applicazione:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Quando la scansione si connette con un ruolo che la row-level security *può* vincolare — non un superuser, non
un proprietario, nessun `BYPASSRLS` — quel ruolo viene aggiunto all'insieme e il report lo segnala. Eseguire la scansione con
il ruolo stesso della tua applicazione è la cosa più vicina a chiedere al database ciò che vede la tua API.

### Codici di uscita

| Codice | Significato |
| --- | --- |
| `0` | Nessun problema rilevato pari o superiore alla soglia `--fail-on` |
| `1` | Almeno un problema rilevato pari o superiore alla soglia |
| `2` | Impossibile eseguire la scansione — argomenti non validi, connessione rifiutata, autenticazione fallita, timeout |

`1` e `2` sono volutamente distinti: una connessione interrotta non deve mai sembrare un database
privo di problemi.

### Nella CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Un nuovo progetto Rebase non supera questo controllo al primo giorno, e non è pensato per farlo.** Le
`defaultSecurityRules` dello scaffold aprono le letture a chiunque — `{ operation: "select", access:
"public" }` in `config/collections/index.ts` — quindi `posts`, `authors` e `tags` segnalano ciascuna un
errore critico `policy-always-true`. `access: "public"` riguarda le *righe*, non chi può chiamare
l'API: a una richiesta priva di token viene comunque risposto con 401 finché `AUTH_REQUIRE` è attivo. La segnalazione è
corretta in ogni caso, perché quella è l'unica difesa rimasta davanti ai dati.

Decidi quale di questi due scenari si applica prima di integrare questo strumento nella CI:

- **le regole sono un segnaposto** — sostituiscile con quelle di cui i tuoi dati hanno effettivamente bisogno
  ([regole di sicurezza](/docs/collections/security-rules)), e le segnalazioni spariranno;
- **le righe sono realmente accessibili a tutti** — dichiaralo esplicitamente con
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, e sii consapevole di cosa hai
  tralasciato: `--skip` disattiva il controllo ovunque, inclusa la tabella che aggiungerai il mese prossimo.

### Output JSON

`--json` genera un oggetto stabile: `scannedAt`, `database` (solo host e nome — mai
credenziali), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` e `diagnostics`. Ogni risultato include `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` e `confidence`.

`exposedRoles` e `diagnostics` fanno parte del contratto, non sono elementi opzionali: ogni controllo dipende
dall'insieme esposto, e `diagnostics.degraded` è il modo in cui chi consuma i dati distingue tra "nessun problema riscontrato" e
"la scansione non ha potuto verificare". Leggere `findings: []` senza entrambi equivale a leggere solo metà della risposta.

## Esecuzione pianificata

Un controllo che devi ricordarti di eseguire a mano è un controllo che segnalerà un database pulito
fino al giorno in cui si presenterà un problema reale. Il backend può eseguirlo per te e
mostrare il risultato nel pannello di amministrazione:

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

Il risultato è disponibile a `GET /api/admin/rls-audit`, protetto da autenticazione admin come ogni altra
superficie amministrativa, e ogni esecuzione scrive una riga di log — a livello `warn` quando un risultato raggiunge
`warnAtSeverity`, altrimenti a livello `info`:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit.
```

### Perché passare `scan`

`@rebasepro/server` non include un driver di database — questo è ciò che gli permette di rimanere utilizzabile con
Postgres, Mongo e Firebase indistintamente. `@rebasepro/rls-check` include `pg`, poiché
si connette a Postgres. Importarlo all'interno del pacchetto server inserirebbe un
driver Postgres in ogni installazione, per una funzionalità utilizzabile solo da alcuni; per questo motivo,
si passa direttamente la funzione dall'esterno.

### In un deployment suddiviso

L'audit è un singleton con *ownership*, come lo scheduler cron. Ogni processo che ne
ha la proprietà esegue la propria scansione, che è in sola lettura e innocua ma ridondante — assegnala
a un unico processo:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

oppure, per un runtime configurato tramite ambiente:

```bash
REBASE_RLS_AUDIT=false
```

Il ruolo `functions` la possiede già impostata su `false` — quel processo non esegue alcun timer.
Specificare un override di ownership non modifica mai gli altri: disattivare il cron lascia intatto
l'audit, e viceversa.

Un processo che serve la superficie di amministrazione senza possedere la scansione risponderà
all'endpoint indicando onestamente che la scansione non viene eseguita lì.

### È una rete di sicurezza, non un sistema di monitoraggio

L'intervallo predefinito è di un giorno, poiché l'oggetto monitorato è uno schema:
cambia in occasione dei deploy, non in base al traffico. Una scansione fallita viene registrata e memorizzata nello
stato — non genera mai un'eccezione non gestita. Trasformare un controllo di sicurezza in una nuova causa di crash
per il server sarebbe una scelta sfavorevole da entrambi i punti di vista.

## Come leggere il report

**I risultati confermati vengono mostrati per primi; quelli euristici si trovano in una sezione separata "da verificare".** Un controllo euristico non può dedurre l'intento — una tabella ponte lasciata intenzionalmente
aperta non è un bug — quindi queste segnalazioni sono formulate come domande e mai mescolate
alle certezze.

**Presta attenzione alla nota sui privilegi.** Se la scansione si connette come superuser, proprietario della tabella o
ruolo con `BYPASSRLS`, viene indicato esplicitamente. Quel ruolo vede il catalogo reale, il che rende
possibile l'audit, ma implica anche che nulla nel report descrive ciò che *quella* connessione
sperimenta. I risultati riguardano ciò a cui accedono gli altri ruoli.

### Su un database Rebase, modifica la regola, non la policy

Ogni policy in un deployment Rebase viene compilata a partire dalle `securityRules` di una collection, e il
runtime **le riapplica a ogni avvio**: rimuove ciascuna policy generata e la ricrea
dalla configurazione. Un comando `ALTER POLICY` eseguito su una di esse sopravvive quindi esattamente
fino al riavvio successivo, dopodiché la segnalazione ricomparirà — dopo averla vista sparire.

`rls-check` riconosce queste policy (un nome del tipo `<table>_<operation>_<hash>`, o una chiamata a
`rebase.uid()` / `rebase.roles()` nell'espressione) e suggerisce di modificare la regola anziché il codice SQL.
Quando vedi una correzione che indica questo:

1. trova la collection a cui appartiene la tabella indicata, sotto `config/collections/`;
2. modifica le sue `securityRules` — consulta [regole di sicurezza](/docs/collections/security-rules);
3. se la collection non ne dichiara di proprie, eredita le `defaultSecurityRules` da
   `config/collections/index.ts`, ed è quello il file da modificare;
4. effettua un nuovo deploy — l'avvio riapplicherà le policy — oppure esegui `rebase db push`.

Una policy scritta manualmente, all'interno di una migrazione, non viene intaccata da questo meccanismo, e la
sua correzione consisterà ancora nell'istruzione SQL da eseguire.

## I controlli

I livelli di gravità riportati di seguito sono quelli predefiniti; diversi controlli adattano la propria gravità in base a ciò
che rilevano, e il report indica sempre la motivazione.

### rls-disabled

**Tabella esposta senza row-level security.** Critico.

La tabella ha la RLS disabilitata *e* concede `SELECT`/`INSERT`/`UPDATE`/`DELETE` a un ruolo accessibile da
un chiamante non attendibile (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres non applica
alcun filtro per riga, quindi le policy — se presenti — non vengono mai consultate.

Viene segnalata anche una foreign table con un privilegio simile. Postgres non può abilitare la RLS
su di essa, quindi il privilegio consegna tutto ciò che restituisce il server remoto, e la
correzione suggerita revoca invece il privilegio.

Una tabella con RLS disattivata ma senza privilegi concessi a un ruolo esposto *non* viene segnalata. Non è raggiungibile,
e segnalarla genererebbe solo rumore.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Abilitare la RLS senza definire policy nega ogni riga a chiunque tranne al proprietario: aggiungi la policy
desiderata nella stessa migrazione, altrimenti avrai scambiato un'esposizione di sicurezza con un'interruzione
di servizio silenziosa. Vedi [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La policy concede accesso incondizionato.** Critico.

Una policy permissiva la cui espressione `USING` o `WITH CHECK` è una costante sempre vera — `true`,
`(true)`, `1 = 1`. Le policy permissive vengono combinate con operatore OR, pertanto una sola di esse soddisfa
il filtro di riga della tabella a prescindere da quanto siano restrittive tutte le altre.

Se policy `RESTRICTIVE` sullo stesso comando (`ALL` per un `ALL` permissivo) si applicano a ogni
ruolo esposto raggiunto dalla policy permissiva, la gravità viene declassata a media e segnalata
come elemento da verificare anziché come certezza, poiché le policy restrittive vengono applicate
con AND dopo che quelle permissive sono state valutate in OR. Una policy restrittiva che protegge
altri ruoli o un altro comando non conta: lascia la policy permissiva aperta a tutti quelli che non
copre.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Su un database Rebase la correzione consiste nella regola della collection anziché in tale istruzione — consulta
[modifica la regola, non la policy](#su-un-database-rebase-modifica-la-regola-non-la-policy). Uno
scaffold predefinito rileva questo controllo su `posts`, `authors` e `tags` per impostazione predefinita.

### policy-anonymous-tautology

**La policy verifica solo che esista un ID del chiamante.** La gravità dipende dalla piattaforma.

L'espressione ha la forma `rebase.uid() IS NOT NULL` (o `auth.uid()` su Supabase, e su un
database Rebase sottoposto a provisioning prima della versione 1.0): distingue i chiamanti autenticati da quelli non autenticati, ma
non circoscrive alcuna riga. Ogni utente autenticato può accedere a tutte le righe coperte dalla policy.

La gravità dipende dalla piattaforma, e questa distinzione è importante:

- **Su Supabase**, `auth.uid()` restituisce `NULL` per i chiamanti anonimi, quindi questo costituisce un controllo funzionante
  per i soli autenticati. Viene segnalato come **basso** — un mancato isolamento dei dati tra utenti
  autenticati, non una falla di accesso anonimo.
- **Su Rebase o PostgREST**, dove un ID chiamante vuoto viene convertito nel valore sentinella
  `'anonymous'`, l'espressione risulta *vera anche per i chiamanti non autenticati*. Segnalato come **critico**.
- **Su una piattaforma non riconosciuta**, segnalato come **medio**, poiché l'esistenza di una vulnerabilità
  dipende dal fatto che il tuo stack utilizzi o meno tale sentinella.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

Il codice SQL suggerito viene mostrato con la funzione per l'ID del chiamante effettivamente presente nel tuo database:
`rebase.uid()` su un database Rebase, `auth.uid()` su Supabase e PostgREST. Entrambe le
sintassi vengono riconosciute durante la lettura delle policy, pertanto un database Rebase in fase di migrazione dallo
schema `auth` precedente alla 1.0 viene comunque verificato.

### policy-authenticated-tautology

**La policy consente l'accesso a ogni riga a qualsiasi chiamante autenticato.** Alta.

La forma corretta del controllo precedente — `rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'` — e il punto in cui molti si fermano. Esclude i chiamanti non autenticati, ma
non circoscrive le righe: il risultato è che *ogni account registrato può leggere ogni riga di
questa tabella*, che è un'affermazione diversa da quella solitamente intesa.

Questo è il pattern che trasforma una tabella `users` in un elenco di tutti gli indirizzi della
piattaforma, leggibile da chiunque si sia registrato — e nei casi in cui la registrazione è aperta, "chiunque si sia
registrato" coincide con chiunque. Viene segnalato separatamente dalla forma anonima perché la
correzione è differente, così come la gravità, e perché potresti legittimamente voler silenziare
l'uno e non l'altro.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Se la tabella è realmente consultabile da qualsiasi account — un listino prezzi condiviso, un elenco di
paesi — mantieni la policy e silenzia la segnalazione con
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**La vista ignora la RLS della sua tabella di base.** Critico.

Una vista concessa a un ruolo non attendibile che esegue una query su una tabella protetta da RLS senza
`security_invoker = true`. La vista viene eseguita con i privilegi del suo **proprietario**, quindi legge la
tabella di base come proprietario e le policy del chiamante non vengono mai applicate. Questo è il modo più comune in cui
una tabella accuratamente protetta finisce per esporre dati.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Nelle versioni di PostgreSQL precedenti alla 15 l'opzione non esiste affatto, quindi qualsiasi vista di questo tipo si comporta
in questo modo. In quel caso la segnalazione viene indicata come euristica, e la correzione consiste nello spostare la logica all'interno di una
funzione o nell'aggiornare il database.

### matview-bypasses-rls

**La vista materializzata espone dati protetti da RLS.** Alta.

Le viste materializzate non possono disporre di row-level security, e i dati in esse contenuti rappresentano uno
snapshot statico salvato da chiunque ne abbia effettuato il refresh. Se una di esse viene concessa a un ruolo non attendibile e la sua
query di definizione legge una tabella protetta da RLS, nessuna policy può intervenire: revoca il privilegio, o sposta
la vista materializzata in uno schema non raggiungibile dai ruoli non attendibili.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**I chiamanti non autenticati possono scrivere.** Alta.

Una policy permissiva di tipo `INSERT`/`UPDATE`/`DELETE`/`ALL` accessibile senza autenticazione la cui
espressione di verifica accetta qualsiasi riga, supportata da un privilegio corrispondente.

La condizione "accetta qualsiasi riga" è fondamentale e volutamente circoscritta. Supabase concede ad `anon`
e `authenticated` pieni privilegi DML per impostazione predefinita, quindi una policy destinata a tali ruoli non rappresenta di per sé
un problema — una classica clausola `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` è corretta
e non viene segnalata.

### unqualified-column-in-subquery

**Colonna non qualificata all'interno della sottoquery di una policy.** Alta, euristico.

Un nome di colonna privo di qualificazione all'interno di una sottoquery `EXISTS`/`IN` che esiste su *entrambe* le relazioni,
sia quella interna che la tabella della policy. Postgres la associa alla tabella **interna**, quindi la correlazione con
la riga esterna che si intendeva scrivere scompare silenziosamente e il predicato diventa banalmente
soddisfacibile — o banalmente insoddisfacibile, negando ogni riga a chiunque.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**L'assenza di questo risultato non è una prova di sicurezza.** `pg_policies.qual` è la rappresentazione
dell'albero sintattico fornita da Postgres stesso, che solitamente ri-qualifica i riferimenti alle colonne — quindi il
nome originale non qualificato spesso non è più visibile al momento della lettura del catalogo. Quando
questo controllo scatta, costituisce una prova evidente; quando non scatta, non dimostra nulla.

### junction-table-unprotected

**Tabella di join molti-a-molti senza RLS.** Alta, euristico.

Una tabella che consiste essenzialmente nei due estremi di due foreign key, entrambe puntate verso
tabelle che *hanno* la RLS abilitata, senza avere una propria row-level security. Entrambi i lati della relazione
sono protetti mentre il collegamento tra loro è aperto — il che è sufficiente per enumerare la relazione
anche quando nessuno dei due endpoint può essere letto direttamente.

È euristico perché una tabella ponte viene dedotta dalla sua struttura. Se la tua è intenzionalmente
pubblica, usa `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS abilitata ma non forzata per il proprietario della tabella.** Media, alta o critica.

Senza `FORCE`, il proprietario della tabella è esente dalle proprie policy, e lo è anche ogni membro
del ruolo proprietario. Questo è innocuo quando il proprietario è un ruolo di provisioning con cui
non si connette nessuno, ma è grave se la tua applicazione si connette come proprietario — pertanto
è **critica** quando un ruolo con cui arriva un chiamante non attendibile possiede la tabella o è
membro del ruolo proprietario, **alta** quando il ruolo proprietario può effettuare il login o un
ruolo che può farlo ne è membro, e **media** in caso contrario.

Se il proprietario è un superuser o dispone di `BYPASSRLS`, rimane a livello medio e lo indica chiaramente: `FORCE` non può
vincolare un ruolo di questo tipo, e suggerire il contrario sarebbe fuorviante.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS abilitata senza alcuna policy.** Media.

Non si tratta di una falla di sicurezza, ma dell'esatto opposto. La RLS attiva con zero policy nega ogni riga a chiunque
tranne al proprietario. Viene segnalata perché costituisce un fallimento *invisibile*: l'API restituisce `[]`, e
una tabella vuota è indistinguibile da una filtrata. Questa configurazione ha servito silenziosamente
collection vuote in produzione anche per settimane consecutive.

### policy-role-unreachable

**Le policy fanno riferimento a ruoli con cui non si connette nessuno.** Media.

Tutte le policy sulla tabella indicano ruoli che non esistono, non possono effettuare il login e che nessun
ruolo di login eredita transitivamente. Le policy appaiono corrette ma non si applicano a nessuno, facendo sì che la tabella risulti
sempre vuota.

Il caso tipico è rappresentato da policy scritte con `TO authenticated` — un nome di ruolo specifico di Supabase — su un database
in cui le richieste arrivano in realtà con un altro ruolo.

### grant-to-public

**Privilegi di tabella concessi a PUBLIC.** Media.

Un privilegio DML concesso a `PUBLIC`, su una tabella o una foreign table. Anche con la RLS
abilitata, questo amplia i soggetti per i quali le policy vengono valutate, e quasi mai si tratta di
una scelta intenzionale.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Routine SECURITY DEFINER con search_path modificabile.** Media.

La routine viene eseguita con i privilegi del suo proprietario — spesso un superuser — mentre il chiamante controlla il modo in cui
vengono risolti gli identificatori. Questo rappresenta il classico pattern di escalation dei privilegi, e qualsiasi risorsa
toccata dalla routine viene letta con i diritti del proprietario, aggirando la RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La policy chiama `current_setting()` senza `missing_ok`.** Bassa, euristico.

`current_setting('app.tenant_id')` con un solo argomento solleva un'eccezione quando l'impostazione non è definita,
anziché restituire `NULL`. Di conseguenza, invece di negare l'accesso alla riga, la richiesta fallisce con un errore — il chiamante
riceve un errore 500 anziché un risultato vuoto, e i middleware configurati per riprovare sui 5xx ripeteranno una richiesta
che non potrà mai avere successo.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Cosa questo strumento non fa

Essere chiari sui limiti è fondamentale — uno strumento di sicurezza che sovrastima la propria copertura è
peggiore di nessuno strumento.

- **È un audit statico del catalogo.** Legge `pg_class`, `pg_policies`, `pg_depend` e
  tabelle correlate. Non si connette con il tuo ruolo `anon` per provare a leggere i tuoi dati, quindi non può
  confermare che un'esposizione sia effettivamente raggiungibile tramite la tua API.
- **Non può dimostrare che una policy sia corretta.** Rileva schemi strutturali noti per essere errati. Una
  policy che supera ogni controllo presente qui può comunque esprimere una regola di business sbagliata.
- **Un report senza errori non è una certificazione di sicurezza.** In particolare, consulta la nota su
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres riscrive le espressioni delle
  policy, quindi alcuni bug non risultano affatto visibili nel catalogo.
- **Non controlla l'autorizzazione a livello applicativo**, le chiavi API, l'esposizione di rete,
  la gestione dei secret o qualsiasi elemento esterno al database.

## Correlati

- [Regole di sicurezza (RLS)](/docs/collections/security-rules) — definizione della row-level security nelle
  collection Rebase, compilata nelle policy verificate da questo strumento.
- [Solo backend](/docs/getting-started/headless/) — perché una tabella priva di policy non viene
  esposta affatto in un progetto headless.
- [API REST](/docs/backend/api/) — la superficie esposta da una policy permissiva.
