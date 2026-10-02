---
sourceHash: 8fee7de68fa81701
title: Agent Skills
sidebar_label: Agent Skills
description: O comando rebase skills install grava 21 habilidades de referência do Rebase em seu repositório, no layout que seu assistente de IA espera — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Um assistente de IA que leu a documentação do Rebase escreve um código Rebase melhor
do que um que tenta adivinhar pelo formato da API. O comando `rebase skills install` copia 21
arquivos de habilidades em Markdown para o seu repositório, no layout que seu assistente
espera:

```bash
rebase skills install
```

As habilidades são **material de referência, não ferramentas**. Elas informam a um assistente como
as coleções são definidas, por que as migrações ocorrem em duas etapas e quais erros o
framework não detectará por ele. Para ferramentas que atuam sobre seus dados, consulte o
[servidor MCP](/docs/ai/mcp).

## Configurado pelo `rebase init`

<span class="since-badge" data-since="0.24">Desde 0.24</span> Um novo projeto não precisa do comando. O `rebase init` pergunta
se você deseja configurar seus agentes de programação com IA e, em seguida, lista aqueles que encontrar
na máquina:

```text
? Set up Rebase skills and the Rebase MCP server for your AI coding agent(s)? Yes

Detecting installed AI coding agents...
  ✓ Claude Code — ~/.claude
  ✓ Gemini CLI / Antigravity — ~/.gemini
  ✗ Cursor — ~/.cursor (not found)
  ✗ Windsurf — ~/.codeium/windsurf (not found)
  ✗ Codex CLI — ~/.codex (not found)
  ✗ Kiro — ~/.kiro (not found)
  · GitHub Copilot — can't be detected; tick it below if you use it
```

Os agentes encontrados já vêm pré-selecionados. Para cada um que você mantiver, ele grava as habilidades
e registra o [servidor MCP](/docs/ai/mcp) na configuração de projeto daquele agente, tudo
antes do primeiro commit do projeto. Em CI, ou com `--yes`, especifique-os:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Um projeto existente

<span class="since-badge" data-since="0.24">Desde 0.24</span> O `rebase init` se recusa a rodar em um diretório que já contém um projeto,
então um projeto criado antes de essa configuração de agentes existir — ou um
cujo autor recusou o prompt — recebe a mesma configuração com
`rebase skills install --mcp`: as habilidades, e o [servidor MCP](/docs/ai/mcp)
registrado na configuração de projeto de cada agente. Servidores já presentes
no arquivo são mantidos, e executar o comando novamente deixa a entrada do
Rebase como está.

```bash
rebase skills install --agent cursor --mcp
```

Sem `--mcp` o comando grava apenas as habilidades, e informa quais agentes
ainda não têm o servidor na configuração.

## Qual assistente

O comando aceita `--agent` (ou `-a`), repetível e separado por vírgulas:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sete destinos são suportados — um para cada arquivo ponteiro que o `rebase init` grava:

| `--agent` | Assistente | Gravado em |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.agents/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro e Copilot recebem um arquivo sempre ativo]
Esses quatro carregam todo o seu diretório de regras em cada requisição. Um arquivo de regra por
habilidade significava cerca de **84.000 caracteres** de referência do Rebase antes de cada
pergunta que uma pessoa fizesse, tendo ela relação com o Rebase ou não — e uma
instrução lida superficialmente pelo assistente é uma instrução que ele não segue.

Em vez disso, eles recebem `rebase.mdc` (ou `rebase.md`): um índice de ~3 KB com
`alwaysApply: true`, listando o que cada habilidade abrange e o arquivo a ser lido. Os
conteúdos principais ficam em subdiretórios por habilidade e são abertos sob demanda.
:::

O `gemini` cobre **tanto** o Gemini CLI quanto o Antigravity — ambos leem o mesmo
diretório `.agents/`, portanto não há um valor `antigravity` separado. O Codex também o
lê; especificar tanto `gemini` quanto `codex` grava o diretório apenas uma vez.

Sem `--agent`, o comando detecta quais assistentes o projeto já utiliza
procurando por `.cursor/`, `.claude/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se não encontrar nenhum, ele solicita que você escolha, trazendo os assistentes instalados
na máquina já marcados.

**O GitHub Copilot nunca é detectado.** Seu diretório seria `.github/`, e
`.github/` não é evidência de que alguém usa o Copilot: o `rebase init` grava
`.github/copilot-instructions.md` em toda estrutura inicial gerada, e a maioria dos repositórios tem
um `.github/` para workflows. Instale-o com `--agent copilot`.

:::note[Um projeto recém-criado sempre solicita confirmação]
O `rebase init` grava `CLAUDE.md`, `.cursorrules` e similares, mas nenhum dos
*diretórios* que a detecção procura. Portanto, a primeira execução em um novo projeto recai
no prompt interativo — e em CI, onde não há TTY, ele é encerrado com um erro.
Passe `--agent` explicitamente em qualquer contexto não interativo.
:::

## Local ao projeto e destinado a ser commitado

As habilidades são gravadas **em relação à raiz do seu projeto** — o ancestral mais próximo
contendo `rebase.json` — e não no seu diretório home nem no diretório de trabalho atual.
Nada é instalado globalmente.

Faça o commit delas. Elas fazem parte do repositório da mesma forma que a configuração de um linter:
assim, o assistente de cada colaborador trabalhará com o mesmo entendimento da base de código,
incluindo colaboradores que nunca executaram o comando.

**Execute novamente o comando para atualizar.** Os arquivos são sobrescritos incondicionalmente, então
após uma atualização do Rebase:

```bash
rebase skills install --agent all
```

Duas consequências de "incondicionalmente": edições locais em uma habilidade instalada são
perdidas na próxima execução — em vez disso, mantenha orientações específicas do projeto em
[`ai-instructions.md`](/docs/ai/instruction-files), que pertence a você e
nunca é sobrescrito. E habilidades removidas em uma versão mais recente não são excluídas do
seu repositório; apenas os arquivos que ainda existem são regravados.

O comando também funciona fora de um projeto Rebase, usando como fallback o diretório de trabalho —
útil para um repositório frontend separado que se comunica com um backend Rebase.

## As 21 habilidades

| Habilidade | Abrange |
|---|---|
| `rebase-basics` | Princípios fundamentais, fluxo de trabalho e manutenção — o ponto de entrada que os outros assumem |
| `rebase-collections` | Definição de coleções, tipos de propriedades, validação, capacidade de busca |
| `rebase-backend-postgres` | O backend Postgres: configuração, geração de schema, migrações, pooling, réplicas de leitura |
| `rebase-api` | A API REST gerada — endpoints, filtragem, ordenação, paginação |
| `rebase-sdk` | O SDK TypeScript gerado: CRUD, filtragem, busca, autenticação, tempo real, offline, armazenamento |
| `rebase-auth` | Autenticação, papéis (roles), políticas RLS, MFA, chaves de API, OAuth, adaptadores personalizados |
| `rebase-security` | Controle de acesso, interceptação, design com falha segura (fail-closed), mascaramento de PII, isolamento de tenants |
| `rebase-realtime` | O mecanismo WebSocket: sincronização, canais de broadcast, presença, transmissões de alterações de tabelas |
| `rebase-storage` | Armazenamento S3/GCS/local, uploads, uploads resumíveis com TUS, transformações de imagem |
| `rebase-custom-functions` | Endpoints de API personalizados por meio de descoberta de funções baseada em arquivos |
| `rebase-cron-jobs` | Agendamento de tarefas recorrentes em segundo plano |
| `rebase-webhooks` | Webhooks HTTP de saída, assinaturas HMAC, novas tentativas (retry) e backoff |
| `rebase-email` | SMTP, templates, provedores personalizados, o singleton `rebase.email` |
| `rebase-entity-history` | Versionamento de entidades, rastreamento de alterações, logs de auditoria, reversão |
| `rebase-admin` | Navegação no painel de administração, gavetas laterais (side drawers), URLs, incorporação de painéis de coleção |
| `rebase-ui-components` | A biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | A linguagem de design de UI: tokens, cor, tipografia, espaçamento, antipadrões |
| `rebase-studio` | A camada de ferramentas de desenvolvedor do Studio — SQL, RLS, armazenamento, cron, visualizador de schema, logs |
| `rebase-cloud` | Implantação e operação no Rebase Cloud — projetos, bancos de dados gerenciados, variáveis de ambiente, domínios, logs, rollbacks |
| `rebase-deployment` | Auto-hospedagem (self-hosting): Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configuração inicial: Node.js, pnpm, PostgreSQL, Docker |

Duas delas solicitam leitura automática (sem solicitação prévia). `rebase-basics` indica que deve ser usada
sempre que um assistente interagir com o Rebase, e `rebase-design-language` indica que um
agente deve lê-la antes de criar ou modificar qualquer interface visual — esta última existe
porque interfaces geradas se desviam de um design system mais rápido do que qualquer outra coisa em uma base de código.

## Como é uma execução

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

As habilidades são distribuídas a partir do pacote `@rebasepro/agent-skills`, do qual a CLI depende,
de modo que o conjunto obtido corresponde à versão instalada da sua CLI.
