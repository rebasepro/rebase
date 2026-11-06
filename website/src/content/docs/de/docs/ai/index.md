---
sourceHash: ff803e68f256ae11
title: KI & Agenten
sidebar_label: Übersicht
description: Was Rebase für KI-Coding-Assistenten und autonome Agenten bereitstellt – ein MCP-Server, projektlokale Agent-Skills, vorgefertigte Anweisungsdateien und das Berechtigungsmodell, das bestimmt, worauf ein Agent tatsächlich zugreifen kann.
---

**Um Claude mit Ihren Rebase-Projekten zu nutzen, fügen Sie den [Rebase connector](/docs/ai/rebase-connector/) hinzu.**
Öffnen Sie in Claude **Settings → Connectors → Add custom connector**, geben Sie
`https://app.rebase.pro/mcp` ein und melden Sie sich mit Ihrem Rebase-Konto an. Ihre Rebase
Cloud-Projekte sind sofort verfügbar; fügen Sie jeden selbst gehosteten Server einmalig mit
`rebase cloud connect https://your-app.com` hinzu. Ein einziger Connector erreicht sie alle.

Darüber hinaus bietet Rebase fünf separate Komponenten für KI-Assistenten, die
unterschiedliche Probleme lösen. Es lohnt sich zu wissen, welche Sie davon benötigen:

| | Was es ist | Wer es nutzt |
|---|---|---|
| [**Rebase connector**](/docs/ai/rebase-connector) | Ein gehosteter MCP-Connector unter `app.rebase.pro/mcp` für jedes Projekt, das Sie betreiben, in der Rebase Cloud oder selbst gehostet: Daten, Schema, Cron und bei Cloud-Deployments Umgebungsvariablen und Logs | Claude im Web, auf dem Desktop und mobil, in Ihrem Namen |
| [**MCP server**](/docs/ai/mcp) | Ein stdio-Model-Context-Protocol-Server mit 53 Tools für Ihr Schema, Ihre Daten, Benutzer, Storage, Cron, Dev-Server und Ihr Rebase Cloud-Projekt | Ein Assistent zur Laufzeit |
| [**Agent skills**](/docs/ai/skills) | 23 Markdown-Skill-Dateien, die durch `rebase skills install` in Ihr Repository geschrieben werden | Ein Assistent als Referenzmaterial |
| [**Instruction files**](/docs/ai/instruction-files) | `ai-instructions.md` plus assistentenspezifische Pointer-Dateien, erstellt durch `rebase init` | Ein Assistent als dauerhafte Regeln |
| [**API keys**](/docs/backend/api-keys) | Maschinen-Anmeldeinformationen mit [Scopes](/docs/backend/roles-and-scopes), pro Collection und pro Operation | Alles, was die HTTP-API aufruft |

Die ersten vier dienen dazu, einem Assistenten *Wissen* und *Tools* an die Hand zu geben. Die
fünfte ist die einzige, die bestimmt, was er tatsächlich tun darf.

## Der entscheidende Teil: Was ein Agent anfassen darf

Ein Agent mit Tools für Ihre Datenbank ist ein gewöhnlicher API-Aufrufer, der
lediglich seine nächste Anfrage selbst bestimmt. Rebase versucht nicht, ihn durch
Anweisungen einzuschränken – ein Prompt ist kein Zugriffssteuerungsmechanismus, und ein Agent,
der Ihre Zeilen liest, liest Text, den möglicherweise jemand anderes geschrieben hat. Die
Einschränkung muss unterhalb des Agenten liegen: in den Anmeldeinformationen, die er besitzt.

Rebase versieht diese Anmeldedaten mit zwei unabhängigen Schranken:

1. **Die Scopes des Schlüssels.** Definiert pro Operation *und*, wenn gewünscht, pro
   Collection: `data:read:articles`, `data:write:articles`. `data:delete` ist
   von `data:write` getrennt – meist die Berechtigung, die Sie einem Agenten vorenthalten
   möchten, der ansonsten bearbeiten darf.
2. **Row-Level Security.** API-Schlüssel umgehen RLS nicht. Ein Schlüssel verbindet sich
   wie jeder andere Aufrufer als Postgres-Rolle `rebase_user`, sodass Ihre Policies weiterhin
   entscheiden, welche Zeilen zurückgegeben werden.

Beide müssen eine Anfrage erlauben. Keines von beiden ersetzt das andere, und die zweite
Stufe ist der Grund, warum ein Schlüssel mit `data:read` auf jeder Collection dennoch
eine leere Ergebnismenge zurückliefern kann.

Ein Punkt, der oft übersehen wird: Das `access: "public"` einer Collection erweitert, **welche
Zeilen ein Aufrufer sehen darf**, nicht **wer aufrufen darf**. Es ist eine Aussage über die
Sichtbarkeit von Zeilen, nicht über Authentifizierung. Es zu gewähren, verleiht einem Schlüssel keinen Scope,
und es vorzuenthalten, entzieht ihm keinen.

Die Mechanismen – Erstellen von Schlüsseln, Auswählen von Scopes, Rotation, Ablauf, Rate
Limits – werden unter [API keys](/docs/backend/api-keys) behandelt.
Überspringen Sie nicht [Security Rules (RLS)](/docs/collections/security-rules);
die zweite Schranke ist nur so gut wie die von Ihnen geschriebenen Policies.

:::caution[Der MCP-Server verwendet standardmäßig keinen Scoped Key]
Das obige Zwei-Stufen-Modell beschreibt die Funktionsweise eines API-Schlüssels. Es ist **nicht** das,
was `@rebasepro/mcp` standardmäßig verwendet, es sei denn, Sie konfigurieren es entsprechend. Ohne Konfiguration
authentifiziert sich der MCP-Server mit dem **Service Key** Ihres Dev-Servers – einem unbeschränkten Admin-Credential,
das die Standard-Admin-Policies für jede Collection erfüllt. Lesen Sie
[What the MCP server can reach](/docs/ai/mcp#what-the-server-can-reach),
bevor Sie einen Assistenten auf produktive oder wichtige Daten ansetzen.
:::

## Vektorsuche

Rebase verfügt über einen nativen `vector`-Eigenschaftstyp auf Postgres und eine
`.vectorSearch()`-Abfragemethode mit den Distanzmetriken `cosine`, `l2` und `inner_product`.
Dies ist bereits dokumentiert, und zwar an zwei Stellen:

- [Querying Data → Vector Search](/docs/sdk/aggregates-and-search#vector-search) – die SDK-Methode,
  das `_distance`-Feld, das jeder Zeile hinzugefügt wird, und wichtige Hinweise
- [REST API → Vector Search](/docs/backend/api#vector-search) – die Abfrageparameter
  `vector_search`, `vector`, `vector_distance` und `vector_threshold`

Drei Dinge, die Sie wissen sollten, bevor Sie Ihre Architektur darauf aufbauen. **Rebase speichert und durchsucht
Embeddings; es berechnet sie nicht** – es gibt keinen Embedding-Provider, keine
Modelleinstellung und keinen API-Schlüssel in Rebase. Die Erzeugung der Vektoren ist also Ihre Aufgabe.
**pgvector ist eine Voraussetzung, und die Installation ist opt-in.**
`database({ extensions: ["vector"] })` in `config/resources.ts` sorgt dafür, dass `rebase db
push` und die Boot-Schema-Validierung `CREATE EXTENSION IF NOT EXISTS vector` für
Sie ausführen; andernfalls erstellen sie die Spalte und überlassen die Extension Ihnen. In beiden
Fällen benötigt der Server ein Image, das die Bibliothek enthält, sowie eine Rolle mit den Rechten,
sie zu installieren. Und: **Jede Vektorspalte erhält einen HNSW-Index für
Cosinus-Distanz**, da Cosinus der Standard ist, mit dem `vectorSearch` misst, sofern
Sie nicht `distance` übergeben – ein Index bedient genau einen Operator. Sie können ihn an der Property anpassen
oder deaktivieren: siehe [The index](/docs/sdk/aggregates-and-search#the-index).

Vektorabfragen können zudem nicht abonniert werden; `.vectorSearch(...).listen()` wird
mit `VECTOR_SEARCH_NOT_LIVE` abgelehnt.

Für die lexikalische Suche – gewichtete Volltextsuche über die von Ihnen angegebenen Felder, einschließlich JSONB-
und Array-Inhalten – siehe [Search](/docs/backend/search). Dies ist ein separater
Mechanismus, und die beiden interagieren nicht miteinander.

## Nächste Schritte

- [Rebase connector](/docs/ai/rebase-connector) — Claude, verbunden mit jedem Projekt, das Sie betreiben
- [MCP Server](/docs/ai/mcp) — Claude Code, Cursor oder beliebige MCP-Clients verbinden
- [Agent Skills](/docs/ai/skills) — `rebase skills install` und die 23 Skills
- [AI Instruction Files](/docs/ai/instruction-files) — Das Muster für vorgefertigte Regelsätze
