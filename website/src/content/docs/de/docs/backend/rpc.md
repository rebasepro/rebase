---
sourceHash: 690d0ebb30684b40
title: SQL-Funktionen als RPC
sidebar_label: SQL-Funktionen (RPC)
description: "Stellen Sie eine Postgres-Funktion unter POST /api/rpc/<name> mit defineRpc bereit: pro Funktion deklariert, Argumente validiert, Ausführung als Aufrufer unter Row-Level Security, öffentliche Funktionen ratenbegrenzt."
---

Eine mit `defineRpc` deklarierte SQL-Funktion wird unter `POST /api/rpc/<name>` bereitgestellt,
mit ihren benannten Argumenten als JSON-Body. Sie wird wie bei
`getSql(c)` als der Aufrufer ausgeführt: ein anonymer Aufrufer mit anonymer Identität, ein angemeldeter Benutzer
als er selbst, sodass die Row-Level Security der Tabellen innerhalb der Funktion greift,
und eine `SECURITY DEFINER`-Funktion wird als ihr Eigentümer ausgeführt. Dies entspricht der Funktionsweise von
`supabase.rpc('fn', args)`, ohne dass für jede Funktion ein eigener Handler geschrieben werden muss.

Nur deklarierte Funktionen sind aufrufbar. Eine Funktion, die in der Datenbank vorhanden ist, aber von niemandem
deklariert wurde, antwortet mit `404 RPC_NOT_FOUND`.

## Eine Funktion deklarieren

Deklarationen befinden sich neben den Tabellen in `backend/schema/`, und der Schema-Index
exportiert sie:

```typescript
// backend/schema/rpc.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",
    args: { token: json.string().required() }
});

export const myTrips = defineRpc("my_trips", {
    access: "authenticated",
    args: { from: json.date(), limit: json.number().validate({ integer: true, max: 100 }) }
});

export const bookTrip = defineRpc("book_trip", {
    access: "authenticated",
    write: true,
    args: { trip_id: json.number().required() }
});
```

```typescript
// backend/schema/index.ts
export * from "./rpc";
```

Die Funktion selbst ist SQL, das Sie in der Datenbank erstellen, beispielsweise aus einer Datei
unter `backend/sql/`:

```sql
CREATE OR REPLACE FUNCTION public.get_public_proposal(token text)
RETURNS public.proposals
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.proposals p WHERE p.share_token = get_public_proposal.token $$;
```

Der Name ist der Name der Funktion, wie Postgres ihn speichert (ein nicht in Anführungszeichen gesetztes
`CREATE FUNCTION getProposal` wird als `getproposal` gespeichert), und gleichzeitig das URL-Segment.
`schema` ist standardmäßig `"public"`. Wie bei einer Tabelle verhindert eine in einer Datei
unter `backend/schema/` definierte RPC, die vom Index nicht exportiert wird, den Systemstart; dasselbe gilt für
einen doppelt deklarierten Namen.

| Option | Bedeutung |
|---|---|
| `access` | Erforderlich. `"public"`: Jeder, angemeldet oder nicht, immer ratenbegrenzt. `"authenticated"`: Jeder Aufrufer mit einer Identität (eine Sitzung, eine Gastsitzung, ein API-Schlüssel, der Service-Schlüssel); ein anonymer Aufrufer erhält `401` |
| `args` | Die benannten Argumente, ein `json.*`-Feld pro SQL-Parameter. Fehlt: Die Funktion nimmt keine Argumente entgegen |
| `schema` | Das Postgres-Schema, in dem sich die Funktion befindet. Standardmäßig `"public"` |
| `write` | Führt den Aufruf als Lese- und Schreibvorgang (read-write) aus. Standardmäßig deaktiviert: Der Aufruf ist schreibgeschützt (read-only) und kann von einem Read Replica bedient werden |
| `rateLimit` | `{ limit, windowMs }` pro Aufrufer für diese Funktion. Eine öffentliche RPC ohne Angabe ist auf 120 Aufrufe pro Minute beschränkt |
| `description` | Was sie tut, für jeden, der die Deklarationen liest |

## Eine Funktion aufrufen

Über das SDK:

```typescript
const proposal = await rebase.rpc<Proposal | null>("get_public_proposal", { token });
const trips = await rebase.rpc<Trip[]>("my_trips", { limit: 20 });
```

Über HTTP:

```bash
curl -X POST https://your-app.example.com/api/rpc/get_public_proposal \
  -H "content-type: application/json" \
  -d '{"token": "f1c2…"}'
```

Ein authentifizierter Aufruf sendet sein Token wie auf jeder anderen Route. Die Argumente können
anhand der Deklaration typisiert werden, die das Frontend als reinen Typ importiert:

```typescript
import type { RpcArgs } from "@rebasepro/server/schema";
import type { myTrips } from "../../backend/schema/rpc";

const args: RpcArgs<typeof myTrips> = { limit: 20 };
const trips = await rebase.rpc<Trip[]>("my_trips", args);
```

## Argumente

Der Body wird gegen `args` geprüft, bevor etwas die Datenbank erreicht. Ein Schlüssel,
der in `args` nicht benannt ist, ein fehlendes `.required()`-Argument und ein Wert
des falschen Typs (eine Zahl für `json.string()`, eine Zeichenkette, die kein Datum ist, für
`json.date()`) werden zusammen mit `400 VALIDATION_CONSTRAINT` abgewiesen, wobei jede
Verletzung das entsprechende Feld benennt (`filters.from`, `tags[2]`). Die Regeln,
die für eine JSON-Spalte gelten, greifen ebenfalls: `.validate({ min, max, pattern, … })`, `.oneOf([...])`.

Ein weggelassenes Argument wird nicht übergeben, sodass der eigene `DEFAULT`-Wert
der SQL-Funktion gilt; ein `.default(value)` auf dem Feld füllt es stattdessen aus. Ein als
`null` gesendetes Argument wird als `NULL` übergeben.

Die Werte erreichen die Funktion als ein einziger gebundener Parameter, ein JSON-Objekt, das
Postgres in die Parametertypen der Funktion konvertiert (`json_to_record`), sodass ein
Array zu einem `integer[]`, ein Objekt zu einem `jsonb` und ein ISO-String zu einem
`timestamptz` wird. Sie werden niemals direkt in den Text des Statements geschrieben. Ein Wert,
den Postgres nicht als Typ des Parameters lesen kann, führt zu `400 RPC_INVALID_ARGUMENT`.

## Was zurückgegeben wird

Die Antwort richtet sich nach dem Rückgabetyp der Funktion, ähnlich wie bei PostgREST:

| Die Funktion gibt zurück | Die Antwort |
|---|---|
| `SETOF <table>`, `TABLE (…)` | ein Array von Zeilen |
| `SETOF integer` (jeder Einzelwert) | ein Array von Werten |
| ein Zeilentyp oder `OUT`-Parameter | die Zeile oder `null`, wenn sie `NULL` ist |
| ein Einzelwert (`bigint`, `text`, `jsonb`, …) | der Wert |
| `void` | `null` |

Werte werden so formatiert, wie `/api/data` sie formatiert: ein `timestamptz` in RFC 3339, ein
`bigint` als Zahl, sofern es hineinpasst.

## Ausführungskontext

Jeder Aufruf öffnet eine Transaktion als der Aufrufer mit derselben Identität, die auch die
Data-API verwendet. Eine `SECURITY INVOKER`-Funktion (Standard) sieht daher genau die Zeilen,
die die Policies des Aufrufers freigeben, und `rebase.uid()` innerhalb der Funktion entspricht dem Aufrufer.
Ein anonymer Aufrufer einer öffentlichen RPC wird unter der anonymen Identität ausgeführt: Eine Policy,
die einen Benutzer voraussetzt, blendet jede Zeile vor ihm aus. Eine `SECURITY DEFINER`-Funktion
wird als die Rolle ausgeführt, der sie gehört. So kann eine Funktion einem anonymen
Aufrufer eine Zeile anhand eines Tokens bereitstellen, ohne die gesamte Tabelle für ihn freizugeben.

Ein API-Schlüssel, der die Berechtigungen einschränkt, benötigt `data:read`, um eine RPC aufzurufen,
bzw. `data:write` für eine als `write: true` deklarierte Funktion – ohne Einschränkungen: Eine Funktion
liest alle Tabellen, auf die sie zugreift.

## Schreiboperationen

Ein Aufruf wird schreibgeschützt ausgeführt, es sei denn, die RPC deklariert `write: true`. Eine Funktion, die
ohne dieses Flag Daten einfügt, aktualisiert oder löscht, schlägt mit `500 RPC_READ_ONLY` fehl. Eine Schreiboperation
unterliegt weiterhin den INSERT- und UPDATE-Policies der Tabellen als Aufrufer.

## Ratenbegrenzung

Jede `public`-RPC ist pro Aufrufer beschränkt (bei angemeldeten Benutzern nach Benutzer-ID,
andernfalls nach IP-Adresse): 120 Aufrufe pro Minute, sofern sie kein `rateLimit` deklariert. Der Zähler
wird dort verwaltet, wo das Backend seine [Funktions-Ratenbegrenzungen](/docs/backend/function-rate-limits/) speichert,
sodass `REBASE_RATE_LIMIT_STORE=sql` ihn über Replikate hinweg teilt. Bei Überschreitung antwortet der Aufruf
mit `429 RATE_LIMITED` und `Retry-After`. Aufrufe verbrauchen außerdem das Data-API-Budget
des Aufrufers. Eine `authenticated`-RPC ist nur dann beschränkt, wenn sie
`rateLimit` deklariert.

## Fehler aus der Funktion

`RAISE EXCEPTION 'This proposal has expired'` antwortet mit `400 RPC_EXCEPTION`
zusammen mit dieser Nachricht sowie `details.sqlState`, `detail` und `hint`.
`RAISE SQLSTATE 'PT404'` antwortet mit dem Statuscode nach `PT`, wie in PostgREST.
Alle RPC-Codes sind unter [Fehler](/docs/backend/errors/#sql-functions-as-rpc) aufgeführt.

## Auf der Managed Runtime und Rebase Cloud

Es muss nichts konfiguriert werden: Die Deklarationen sind Teil von `backend/schema`,
das von `rebase build` in das Bundle aufgenommen wird, und die Runtime liest sie dort, wo sie auch
die Tabellen liest. Die Funktion selbst muss in der von dem Deployment verwendeten Datenbank existieren.

Ein ejected Backend, das `schemaDir` übergibt, liest sie aus demselben Index; ein Backend,
das seine Tabellen als Werte übergibt, übergibt seine RPCs auf die gleiche Weise:

```typescript
await initializeRebaseBackend({ app, server, tables, rpc: [getPublicProposal, myTrips], /* … */ });
```

RPCs sind Teil der Datenoberfläche: Ein Prozess, der `/api/data` nicht bereitstellt
(`REBASE_ROLE=functions`), stellt auch `/api/rpc` nicht bereit, und sie werden auf der
Standarddatenbank ausgeführt.

## Was nicht unterstützt wird

- Aufrufe sind nur per `POST` möglich; ein `GET` auf einen deklarierten Namen antwortet mit `405`.
- Es können nur benannte Parameter übergeben werden. Eine Funktion, deren Parameter keine
  Namen haben oder die `SETOF record` ohne `OUT`-Parameter zurückgibt, kann auf diese
  Weise nicht aufgerufen werden.
- Bei Überladungen desselben Namens erreicht der Aufruf diejenige Funktion, deren benannte Parameter
  genau den gesendeten Argumenten entsprechen; treffen zwei Überladungen zu, führt dies zu `500 RPC_AMBIGUOUS`.

Für Logik, die nicht aus einer einzelnen SQL-Funktion besteht, schreiben Sie eine [benutzerdefinierte Funktion](/docs/backend/custom-functions/)
und führen darin SQL mit `getSql(c)` aus.
