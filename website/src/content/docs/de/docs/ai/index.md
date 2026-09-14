---
sourceHash: ec9977f5b00dc133
title: KI & Agenten
sidebar_label: Übersicht
description: Was Rebase für KI-Coding-Assistenten und autonome Agenten bereitstellt – ein MCP-Server, projektlokale Agent Skills, gerüstartige Anweisungsdateien und das Berechtigungsmodell, das bestimmt, worauf ein Agent tatsächlich zugreifen kann.
---

Rebase liefert vier separate Dinge für KI-Assistenten, und sie lösen unterschiedliche
Probleme. Es lohnt sich zu wissen, wonach Sie greifen:

| | Was es ist | Wer es nutzt |
|---|---|---|
| [**MCP-Server**](/docs/ai/mcp) | Ein Stdio-Model-Context-Protocol-Server mit 42 Tools für Ihr Schema, Ihre Daten, Benutzer, Speicher, Cron und Dev-Server | Ein Assistent, zur Laufzeit |
| [**Agent Skills**](/docs/ai/skills) | 21 Markdown-Skill-Dateien, die durch `rebase skills install` in Ihr Repo geschrieben werden | Ein Assistent, als Referenzmaterial |
| [**Anweisungsdateien**](/docs/ai/instruction-files) | `ai-instructions.md` plus zeigerbasierte Dateien pro Assistent, geschrieben von `rebase init` | Ein Assistent, als dauerhaft aktive Regeln |
| [**API-Keys**](/docs/backend/api-keys) | Bereichsbezogene (scoped) Maschinen-Anmeldedaten, pro Collection und pro Operation | Alles, was die HTTP-API aufruft |

Bei den ersten dreien geht es darum, einem Assistenten *Wissen* und *Werkzeuge* an
die Hand zu geben. Das vierte ist das einzige, das entscheidet, was er tatsächlich
tun darf.

## Der entscheidende Teil: Worauf ein Agent zugreifen darf

Ein Agent mit Werkzeugen für Ihre Datenbank ist ein gewöhnlicher API-Aufrufer, der
zufällig seine eigene nächste Anfrage bestimmt. Rebase versucht nicht, ihn durch
Anweisungen einzuschränken – ein Prompt ist kein Zugriffskontrollmechanismus, und ein
Agent, der Ihre Zeilen liest, liest Text, den möglicherweise jemand anderes geschrieben
hat. Die Einschränkung muss unterhalb des Agenten ansetzen: in den Anmeldedaten, die er
mitführt.

Rebase versieht diese Anmeldedaten mit zwei unabhängigen Schranken:

1. **Die API-Key-Berechtigungsliste.** Deklariert pro Collection *und* pro Operation,
   wobei `delete` von `write` trennbar ist – was normalerweise die Operation ist,
   die Sie einem Agenten vorenthalten möchten, der ansonsten bearbeiten darf.
2. **Row-Level Security.** API-Keys umgehen RLS nicht. Ein Schlüssel verbindet sich wie
   jeder andere Aufrufer als die Postgres-Rolle `rebase_user`, sodass Ihre Richtlinien
   weiterhin bestimmen, welche Zeilen zurückgegeben werden.

Beide müssen eine Anfrage erlauben. Keine ersetzt die andere, und die zweite ist der
Grund, warum ein Schlüssel mit `"*"`-Berechtigungen dennoch eine leere Ergebnismenge
zurückgeben kann.

Ein Punkt, der oft übersehen wird: Das `access: "public"` einer Collection erweitert,
**welche Zeilen ein Aufrufer sehen darf**, nicht **wer aufrufen darf**. Es ist eine
Aussage über die Sichtbarkeit von Zeilen, nicht über die Authentifizierung. Die
Gewährung fügt einen Aufrufer nicht zur Berechtigungsliste hinzu, und das Verweigern
stoppt ihn nicht.

Die Funktionsweise – Erstellen von Schlüsseln, das Berechtigungs-JSON, Rotation, Ablauf,
Rate Limits – wird unter [REST API → API Keys](/docs/backend/api-keys) behandelt.
Überspringen Sie auf dem Weg dorthin nicht [Security Rules (RLS)](/docs/collections/security-rules);
die zweite Schranke ist nur so gut wie die von Ihnen geschriebenen Richtlinien.

:::caution[Der MCP-Server verwendet standardmäßig keinen bereichsbezogenen Schlüssel]
Das oben beschriebene Zwei-Schranken-Modell beschreibt die Funktionsweise eines API-Keys.
Es ist **nicht** das, was `@rebasepro/mcp` standardmäßig verwendet, es sei denn, Sie
konfigurieren es entsprechend. Ohne Konfiguration authentifiziert sich der MCP-Server mit
dem **Service Key** Ihres Dev-Servers – einem unbeschränkten Admin-Anmeldedatensatz, der
die Standard-Admin-Richtlinien für jede Collection erfüllt. Siehe
[What the MCP server can reach](/docs/ai/mcp#what-the-server-can-reach),
bevor Sie einen Assistenten auf wichtige Daten ansetzen.
:::

## Vektorsuche

Rebase verfügt über einen erstklassigen `vector`-Eigenschaftstyp auf Postgres und eine
`.vectorSearch()`-Abfragemethode mit `cosine`-, `l2`- und `inner_product`-Distanz.
Dies ist bereits dokumentiert, und zwar an zwei Stellen:

- [Querying Data → Vector Search](/docs/sdk/aggregates-and-search#vector-search) — die SDK-Methode,
  das `_distance`-Feld, das jeder Zeile hinzugefügt wird, und die Vorbehalte
- [REST API → Vector Search](/docs/backend/api#vector-search) — die
  Abfrageparameter `vector_search`, `vector`, `vector_distance` und `vector_threshold`

Drei Dinge, die Sie wissen sollten, bevor Sie darum herum planen. **Rebase speichert
und durchsucht Embeddings; es berechnet sie nicht** – es gibt in Rebase keinen
Embedding-Provider, keine Modelleinstellung und keinen API-Key; die Erstellung der
Vektoren ist also Ihre Aufgabe. **pgvector ist eine Voraussetzung, und die Installation
ist optional.** `database({ extensions: ["vector"] })` in `config/resources.ts`
ermöglicht es `rebase db push` und der Schema-Sicherstellung beim Booten,
`CREATE EXTENSION IF NOT EXISTS vector` für Sie auszuführen; ohne diese Angabe wird
die Spalte angelegt und die Extension Ihnen überlassen. In beiden Fällen benötigt der
Server ein Image, das die Bibliothek enthält, sowie eine Rolle, die berechtigt ist,
sie zu installieren. Und **jede Vektorspalte erhält einen HNSW-Index für die
Kosinus-Distanz**, da Kosinus das Maß ist, mit dem `vectorSearch` standardmäßig misst,
sofern Sie nicht `distance` übergeben – ein Index bedient genau einen Operator.
Sie können ihn optimieren oder deaktivieren: siehe [The index](/docs/sdk/aggregates-and-search#the-index).

Vektorabfragen können zudem nicht abonniert werden; `.vectorSearch(...).listen()`
wird mit `VECTOR_SEARCH_NOT_LIVE` abgewiesen.

Für die lexikalische Suche – gerankter Volltext über die von Ihnen benannten Felder,
einschließlich JSONB- und Array-Inhalten – siehe [Search](/docs/backend/search).
Es handelt sich um einen anderen Mechanismus, und die beiden interagieren nicht miteinander.

## Nächste Schritte

- [MCP Server](/docs/ai/mcp) — Verbinden Sie Claude Code, Cursor oder einen beliebigen MCP-Client
- [Agent Skills](/docs/ai/skills) — `rebase skills install` und die 21 Skills
- [AI Instruction Files](/docs/ai/instruction-files) — Das Gerüstmuster für Anweisungsdateien
