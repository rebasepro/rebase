---
sourceHash: 3e7cee199ce0ba69
slug: it/docs/rls-check
title: rls-check
description: Esegui l'audit della row-level security (sicurezza a livello di riga) su qualsiasi database PostgreSQL — Supabase, Neon, RDS o sul tuo server. In sola lettura, nessuna registrazione, Rebase non richiesto.
---

# rls-check

`rls-check` legge il catalogo di un database PostgreSQL e segnala ciò che è effettivamente esposto:
tabelle servite con la sicurezza a livello di riga (RLS) disattivata, criteri (policy) che valutano true per
chiunque, viste che leggono direttamente oltre la RLS delle loro tabelle di base e tabelle di giunzione
dimenticate mentre entrambi i loro endpoint sono stati bloccati.

Funziona su **qualsiasi** Postgres — Supabase, Neon, RDS, Cloud SQL o un server gestito da te.
Non richiede Rebase ed è utile indipendentemente dal fatto che tu decida di adottarlo o meno.

```bash
npx @rebasepro/rls-check
```

Eseguilo nella directory del tuo progetto e troverà il database da solo: `DATABASE_URL`, poi
`POSTGRES_URL`, poi un `.env` lì accanto. Passa la stringa di connessione come argomento solo quando
non puoi fare altrimenti — npm stampa la riga di comando prima che il programma parta, e la tua shell
la registra, quindi una password in un argomento finisce in due posti che `rls-check` non può
oscurare. `$DATABASE_URL` non è più sicuro lì: la shell lo espande prima ancora che npm lo veda.

È in sola lettura per progettazione: apre una transazione in sola lettura ed esegue query sul catalogo.
Non scrive nulla e non invia nulla da nessuna parte — non c'è telemetria né chiamate di rete oltre a
quella verso il tuo database.

## Esecuzione

```bash
# Dall'ambiente — DATABASE_URL, poi POSTGRES_URL, poi un file .env nella cwd
npx @rebasepro/rls-check

# Per un database diverso da quello nel tuo ambiente
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# Come argomento. Funziona, ma vedi sopra dove finisce la password
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Se la tua password contiene `@`, `:`, `/`, `?` o `#`, eseguine l'encoding percentuale (percent-encoding).
È di gran lunga la causa più comune di errore di autenticazione in questo contesto, e `rls-check` lo
indicherà chiaramente invece di farti tirare a indovinare.

### Opzioni

| Opzione | Significato |
| --- | --- |
| `--json` | Output leggibile da macchina su stdout, e nient'altro su stdout |
| `--html <percorso>` | Scrive anche un report HTML autonomo lì. Un solo file, nessuna richiesta di rete |
| `--schema <name>` | Limita la scansione a uno schema. Ripetibile o separato da virgole |
| `--role <name>` | Tratta questo ruolo come uno con cui arriva un chiamante non fidato, oltre a `anon`, `authenticated`, `web_anon` e `rebase_user`. Ripetibile o separato da virgole |
| `--fail-on <severity>` | Termina con codice di uscita 1 a questa gravità o superiore. Predefinito `high`; `none` non fallisce mai |
| `--only <id>` | Esegue solo questi controlli. Ripetibile o separato da virgole |
| `--skip <id>` | Salta questi controlli. Ripetibile o separato da virgole |
| `--list-checks` | Stampa il catalogo ed esce |
| `--timeout <ms>` | Timeout dello statement, predefinito 15000 |
| `--quiet` | Solo risultati — nessun banner, nessun riepilogo |
| `--no-color` | Disabilita i colori ANSI (rispetta anche `NO_COLOR` e stdout non-TTY) |

Un ID sconosciuto passato a `--only` o `--skip` genera un errore anziché essere ignorato silenziosamente,
poiché un refuso indebolirebbe silenziosamente la scansione. Un `--role` che non è in `pg_roles` è un errore
per lo stesso motivo: ogni controllo si basa su un privilegio concesso a un ruolo esposto, quindi un nome che
non corrisponde a nulla toglie copertura senza dirlo.

L'intestazione del report nomina i ruoli che l'esecuzione ha trattato come esposti, così vedi a colpo d'occhio
se `No findings` copriva il ruolo con cui si connette la tua applicazione:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Quando la scansione si connette con un ruolo che la row-level security *può* davvero vincolare — né superuser,
né proprietario, senza `BYPASSRLS` — quel ruolo viene aggiunto all'insieme e il report lo dichiara. Scansionare
con il ruolo della tua applicazione è la cosa più vicina a chiedere al database cosa vede la tua API.

### Codici di uscita

| Codice | Significato |
| --- | --- |
| `0` | Nessun risultato pari o superiore alla soglia `--fail-on` |
| `1` | Almeno un risultato pari o superiore alla soglia |
| `2` | La scansione non è stata eseguita — argomenti errati, connessione rifiutata, errore di autenticazione, timeout |

`1` e `2` sono volutamente distinti: una connessione interrotta non deve mai sembrare un database privo di problemi.

### In CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Output JSON

`--json` emette un oggetto stabile: `scannedAt`, `database` (solo host e nome — mai credenziali),
`serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`, `findings` e
`diagnostics`. Ogni risultato (finding) contiene `id`, `severity`, `title`, `target`, `detail`,
`impact`, `fix`, `docs` e `confidence`.

`exposedRoles` e `diagnostics` fanno parte del contratto, non sono extra: ogni controllo si basa
sull'insieme dei ruoli esposti, e `diagnostics.degraded` è ciò che permette di distinguere «non
c'era nulla che non andasse» da «la scansione non è riuscita a guardare».

## Come leggere il report

**I risultati confermati vengono visualizzati per primi; quelli euristici si trovano in una sezione
separata "da verificare" ("worth checking").** Un controllo euristico non può interpretare l'intenzione — una
tabella di giunzione lasciata aperta intenzionalmente non è un bug — pertanto questi controlli sono formulati
come domande e mai mescolati alle certezze.

**Fai attenzione alla nota sui privilegi.** Se la scansione si connette come superutente, proprietario della
tabella o un ruolo con `BYPASSRLS`, viene indicato. Quel ruolo vede il catalogo reale, il che rende possibile
l'audit, ma significa anche che nulla nel report descrive ciò che prova *quella* specifica connessione.
I risultati riguardano ciò a cui accedono gli altri ruoli.

## I controlli

Le gravità riportate di seguito sono quelle predefinite; diversi controlli regolano la propria gravità in
base a ciò che trovano, e il report indica sempre la motivazione.

### rls-disabled

**Tabella esposta senza sicurezza a livello di riga.** Critica.

La tabella ha l'RLS disabilitata *e* concede autorizzazioni `SELECT`/`INSERT`/`UPDATE`/`DELETE` a un ruolo
raggiungibile da un chiamante non attendibile (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres non applica
alcun filtro per riga, quindi le policy — se esistono — non vengono mai consultate.

Una tabella con RLS disattivata ma senza concessioni a un ruolo esposto *non* viene segnalata. Non è raggiungibile
e segnalarla produrrebbe solo rumore.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Abilitare l'RLS senza policy nega l'accesso a ogni riga a chiunque tranne al proprietario, quindi aggiungi la
policy desiderata nella stessa migrazione — altrimenti avrai scambiato un'esposizione con un'interruzione silenziosa
del servizio. Vedi [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La policy concede l'accesso incondizionato.** Critica.

Una policy permissiva la cui espressione `USING` o `WITH CHECK` è una verità costante — `true`, `(true)`, `1 = 1`.
Le policy permissive vengono combinate in OR, quindi è sufficiente una sola di esse per soddisfare il filtro di
riga della tabella, indipendentemente da quanto siano restrittive le altre policy.

Se una policy `RESTRICTIVE` copre lo stesso comando, questo controllo viene declassato a gravità media e segnalato
come elemento da verificare piuttosto che come una certezza, poiché le policy restrittive vengono applicate in
AND dopo che quelle permissive sono state combinate in OR.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

### policy-anonymous-tautology

**La policy verifica solo che esista un ID chiamante.** La gravità dipende dalla piattaforma.

L'espressione ha la forma `rebase.uid() IS NOT NULL` (o `auth.uid()` su Supabase e su un database Rebase fornito
prima della 1.0): separa i chiamanti autenticati da quelli non autenticati, ma non limita l'ambito di alcuna riga.
Ogni utente autenticato può accedere a tutte le righe coperte dalla policy.

La gravità dipende dalla piattaforma e questa distinzione è importante:

- **Su Supabase**, `auth.uid()` restituisce `NULL` per i chiamanti anonimi, quindi questo è un controllo funzionante
  riservato agli utenti autenticati. Segnalato come **bassa** gravità (low) — un problema di isolamento dei dati tra
  utenti autenticati, non una falla per l'accesso anonimo.
- **Su Rebase o PostgREST**, dove un ID chiamante vuoto viene convertito nella sentinella `'anonymous'`, l'espressione
  è *vera anche per i chiamanti non autenticati*. Segnalato come **critico**.
- **Su una piattaforma non riconosciuta**, segnalato come **medio**, poiché il fatto che sia una vulnerabilità
  dipende dal fatto che il tuo stack utilizzi o meno tale sentinella.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

L'SQL suggerito viene stampato con la funzione di ID chiamante effettivamente presente nel tuo database:
`rebase.uid()` su un database Rebase, `auth.uid()` su Supabase e PostgREST. Entrambe le grafie vengono
riconosciute durante la lettura delle policy, pertanto un database Rebase in fase di migrazione dallo
schema `auth` antecedente alla 1.0 viene comunque controllato.

### view-bypasses-rls

**La vista ignora l'RLS della sua tabella di base.** Critica.

Una vista concessa a un ruolo non attendibile che esegue una select da una tabella protetta da RLS senza
`security_invoker = true`. La vista viene eseguita con i privilegi del suo **proprietario**, quindi legge
la tabella di base come proprietario e le policy del chiamante non vengono mai applicate. Questo è il modo
più comune in cui una tabella accuratamente protetta subisce una perdita di dati.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Su PostgreSQL inferiore alla versione 15 l'opzione non esiste affatto, quindi ogni vista di questo tipo si
comporta in questo modo. In tal caso il risultato viene segnalato come euristico, e la soluzione consiste
nello spostare la logica in una funzione o nell'aggiornare il database.

### matview-bypasses-rls

**La vista materializzata espone dati protetti da RLS.** Alta.

Le viste materializzate non possono avere la sicurezza a livello di riga e i dati al loro interno costituiscono
uno snapshot memorizzato, scattato da chiunque l'abbia aggiornato. Se una vista materializzata viene concessa a un
ruolo non attendibile e la sua query di definizione legge una tabella protetta da RLS, nessuna policy potrà essere
d'aiuto — revoca la concessione o sposta la vista materializzata in uno schema non raggiungibile dai ruoli non attendibili.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**I chiamanti non autenticati possono scrivere.** Alta.

Una policy permissiva `INSERT`/`UPDATE`/`DELETE`/`ALL` raggiungibile senza autenticazione la cui espressione
di controllo accetta qualsiasi riga, supportata da una concessione corrispondente.

La condizione "accetta qualsiasi riga" è essenziale e volutamente restrittiva. Supabase concede a `anon` e `authenticated`
l'accesso DML completo per impostazione predefinita, quindi una policy rivolta a tali ruoli non rappresenta di per sé un
problema — un caso da manuale come `FOR INSERT TO public WITH CHECK (userId = auth.uid())` è corretto e non viene segnalato.

### unqualified-column-in-subquery

**Colonna non qualificata all'interno di una sottoquery di policy.** Alta, euristica.

Un nome di colonna semplice all'interno di una sottoquery `EXISTS`/`IN` presente su *entrambe* le relazioni (sia la
relazione interna che la tabella della policy). Postgres lo associa alla tabella **interna**, quindi la correlazione con
la riga esterna che intendevi scrivere scomplete silenziosamente e il predicato diventa banalmente soddisfacibile — oppure
banalmente insoddisfacibile, negando ogni riga a chiunque.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**L'assenza di questo risultato non è una prova di sicurezza.** `pg_policies.qual` è la ri-generazione da parte di Postgres
dell'albero di parsing, e di solito ri-qualifica i riferimenti alle colonne — quindi il nome semplice originale spesso non
è più visibile al momento della lettura del catalogo. Quando questo controllo si attiva, fornisce una prova solida; quando
non si attiva, non ha dimostrato nulla.

### junction-table-unprotected

**Tabella di giunzione molti-a-molti senza RLS.** Alta, euristica.

Una tabella che costituisce essenzialmente solo i due endpoint di due chiavi esterne (foreign key), entrambe rivolte a tabelle
che *hanno* l'RLS attivata, senza avere una propria sicurezza a livello di riga. Entrambi i lati della relazione sono bloccati
ma il collegamento tra di essi è aperto — il che è sufficiente per enumerare la relazione anche quando nessuno dei due endpoint
può essere letto.

Euristica perché una tabella di giunzione viene dedotta dalla sua struttura. Se la tua è volutamente pubblica,
usa `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS abilitata ma non forzata per il proprietario della tabella.** Media o alta.

Senza `FORCE`, il proprietario della tabella è esente dalle proprie policy. Ciò è innocuo quando il proprietario è un
ruolo di provisioning a cui nulla si connette, ma è grave quando la tua applicazione si connette come proprietario — pertanto
la gravità è **alta** se il ruolo proprietario può effettuare il login, e **media** in caso contrario.

Se il proprietario è un superutente o ha `BYPASSRLS`, la gravità rimane media e viene specificata la motivazione: `FORCE`
non può vincolare un tale ruolo e suggerire il contrario sarebbe fuorviante.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS abilitata senza alcuna policy.** Media.

Non si tratta di una falla di sicurezza — al contrario. L'RLS attiva senza policy nega ogni riga a chiunque tranne al
proprietario. Viene segnalata perché si tratta di un errore *invisibile*: l'API restituisce `[]` e una tabella vuota è
indistinguibile da una tabella filtrata. Questa configurazione ha servito silenziosamente collezioni vuote in produzione
anche per settimane intere.

### policy-role-unreachable

**Le policy sono rivolte a ruoli a cui non si connette nulla.** Media.

Ogni policy sulla tabella specifica ruoli che non esistono, non possono effettuare il login e che nessun ruolo di login
eredita in modo transitivo. Le policy sembrano corrette ma non si applicano a nessuno, quindi la tabella risulta vuota alla lettura.

Il caso classico è rappresentato da policy scritte con `TO authenticated` — un nome di ruolo di Supabase — su un database
in cui le richieste arrivano in realtà con un altro ruolo.

### grant-to-public

**Privilegi della tabella concessi a PUBLIC.** Media.

Un privilegio DML concesso a `PUBLIC`. Anche con l'RLS abilitata, questo amplia i ruoli per *i quali* le policy vengono
valutate, e non è quasi mai una scelta intenzionale.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Routine SECURITY DEFINER con un search_path modificabile.** Media.

La routine viene eseguita come il suo proprietario — spesso un superutente — mentre il chiamante controlla il modo in cui
i suoi identificatori vengono risolti. Questa è la classica struttura per l'escalation dei privilegi e qualsiasi elemento
toccatodalla routine viene letto con i diritti del proprietario, ignorando l'RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La policy chiama `current_setting()` senza `missing_ok`.** Bassa, euristica.

`current_setting('app.tenant_id')` con un solo argomento *genera un errore* quando l'impostazione non è definita, invece
di restituire `NULL`. Quindi, anziché negare la riga, la richiesta va in errore — il chiamante vede un errore 500 anziché un
risultato vuoto e il middleware che riprova in caso di errori 5xx riproverà una richiesta che non potrà mai avere successo.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Cosa non fa questo strumento

Essere chiari sui limiti è fondamentale — uno strumento di sicurezza che sopravvaluta la propria copertura è peggiore di
non averne alcuno.

- **È un audit statico del catalogo.** Legge `pg_class`, `pg_policies`, `pg_depend` e simili. Non si connette con il tuo
  ruolo `anon` né tenta di leggere i tuoi dati, quindi non può confermare se un'esposizione sia raggiungibile tramite la tua API.
- **Non può dimostrare che una policy sia corretta.** Individua strutture note per essere errate. Una policy che supera ogni
  controllo presente qui può comunque esprimere una regola aziendale errata.
- **Un report privo di problemi non è una certificazione di sicurezza.** In particolare, si veda la nota su
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres riscrive le espressioni delle policy, pertanto
  alcuni bug non sono più visibili nel catalogo.
- **Non controlla l'autorizzazione a livello di applicazione**, chiavi API, esposizione di rete, gestione dei segreti o qualsiasi
  altra cosa all'esterno del database.

## Risorse correlate

- [Regole di sicurezza (RLS)](/docs/collections/security-rules) — definire la sicurezza a livello di riga nelle collezioni Rebase,
  che vengono compilate nelle policy analizzate da questo strumento.

---
