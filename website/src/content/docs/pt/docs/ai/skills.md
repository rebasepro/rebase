---
sourceHash: dd9c77451521c040
title: Skills do Agente
sidebar_label: Skills do Agente
description: O rebase skills install grava 24 skills de referência do Rebase no seu repositório, no formato que seu assistente de IA espera — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Um assistente de IA que leu a documentação do Rebase escreve código Rebase melhor
do que um que apenas deduz a partir da estrutura da API. O `rebase skills install` copia 24
arquivos de skills em Markdown para o seu repositório, no formato exato que seu assistente
espera:

```bash
rebase skills install
```

As skills são **material de referência, não ferramentas**. Elas ensinam ao assistente como
as tabelas são declaradas, por que as migrações ocorrem em duas etapas e quais erros o
framework não detectará por ele. Para ferramentas que operam sobre seus dados, consulte o
[servidor MCP](/docs/ai/mcp).

## Configurado pelo `rebase init`

Um novo projeto não precisa desse comando. O `rebase init` pergunta
se você deseja configurar seus agentes de programação com IA e, em seguida, lista os que encontrar
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

Os agentes encontrados já vêm pré-selecionados. Para cada um que você mantiver, ele grava as skills
e registra o [servidor MCP](/docs/ai/mcp) na configuração de projeto desse agente, tudo
antes do primeiro commit do projeto. No CI, ou com `--yes`, especifique-os nominalmente:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Um projeto existente

O `rebase init` recusa um diretório que já contenha um projeto; portanto, um projeto
criado antes da existência da configuração de agentes — ou cujo autor tenha recusado o prompt —
obtém a mesma configuração com `rebase skills install --mcp`: as skills e o
[servidor MCP](/docs/ai/mcp) registrado na configuração de projeto de cada agente. Servidores
que já estiverem no arquivo são mantidos, e uma nova execução mantém a entrada do Rebase como está.

```bash
rebase skills install --agent cursor --mcp
```

Sem `--mcp`, o comando grava apenas as skills e indica os agentes cuja
configuração ainda não possui o servidor.

## Qual assistente

O comando aceita `--agent` (ou `-a`), que pode ser repetido e separado por vírgulas:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sete destinos são suportados — um para cada arquivo de referência que o `rebase init` grava:

| `--agent` | Assistente | Gravado em |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.agents/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro e Copilot recebem um único arquivo sempre ativo]
Esses quatro carregam todo o seu diretório de regras em cada requisição. Um arquivo de regra por
skill significaria cerca de **84.000 caracteres** de referência do Rebase antes de cada
pergunta feita por uma pessoa, seja ela sobre o Rebase ou não — e uma
instrução que o assistente lê superficialmente é uma instrução que ele não segue.

Em vez disso, eles recebem `rebase.mdc` (ou `rebase.md`): um índice de ~3 KB com
`alwaysApply: true`, listando o que cada skill aborda e o arquivo a ser lido. Os
conteúdos completos ficam em subdiretórios individuais por skill e são abertos sob demanda.
:::

O `gemini` cobre **tanto** o Gemini CLI quanto o Antigravity — eles leem o mesmo
diretório `.agents/`, portanto não há um valor `antigravity` separado. O Codex também o
lê; especificar tanto `gemini` quanto `codex` grava o diretório apenas uma vez.

Sem `--agent`, o comando detecta quais assistentes o projeto já utiliza
procurando por `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se nenhum for encontrado, ele solicita que você escolha, com os assistentes instalados
na máquina já marcados.

**O GitHub Copilot nunca é detectado.** Seu diretório seria `.github/`, e
`.github/` não é evidência de que alguém utiliza o Copilot: o `rebase init` grava
`.github/copilot-instructions.md` em todo scaffolding, e a maioria dos repositórios possui
um `.github/` para workflows. Instale-o com `--agent copilot`.

:::note[Um projeto recém-criado sempre exibe o prompt]
O `rebase init` grava `CLAUDE.md`, `.cursorrules` e similares, mas nenhum dos
*diretórios* que a detecção procura. Portanto, a primeira execução em um novo projeto recai
no prompt — e no CI, onde não há TTY, ele é encerrado com um erro.
Passe `--agent` explicitamente em qualquer contexto não interativo.
:::

## Local ao projeto e feito para ser commitado

As skills são gravadas **em relação à raiz do seu projeto** — o diretório ancestral mais
próximo que contém `rebase.json` — e não no seu diretório home nem no diretório de
trabalho atual. Nada é instalado globalmente.

Faça o commit delas. Elas fazem parte do repositório da mesma forma que a configuração de um linter:
o assistente de cada colaborador trabalhará a partir do mesmo entendimento da base de código,
incluindo colaboradores que nunca executaram o comando.

**Execute o comando novamente para atualizar** após um upgrade do Rebase:

```bash
rebase skills install --agent all
```

Cada diretório de destino contém um manifesto `.rebase-skills.json` com o que o
comando gravou, de modo que uma nova execução possa distinguir uma edição de uma cópia de uma versão mais antiga. Faça
o commit dele junto com as skills.

- Um arquivo que ninguém editou é substituído pela cópia da nova versão.
- Um arquivo que você editou é mantido, e o comando o lista. O `--force` o substitui.
- Uma skill que uma versão mais recente não inclui mais é removida, a menos que você a tenha editado.
  Nesse caso, ela é mantida e listada.
- Arquivos que o comando nunca gravou não são tocados.

Diretrizes específicas do projeto ainda pertencem ao
[`ai-instructions.md`](/docs/ai/instruction-files), que é seu. Uma skill editada
deixa de receber atualizações até que você utilize `--force`.

O comando também funciona fora de um projeto Rebase, recorrendo ao diretório de trabalho atual —
útil para um repositório de frontend separado que se comunica com um backend Rebase.

## As 24 skills

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Skill | Aborda |
|---|---|
| `rebase-basics` | Princípios fundamentais, fluxo de trabalho e manutenção — o ponto de entrada que os outros assumem |
| `rebase-tables` | Criação de tabelas: colunas, relações, `rls`, hooks e a camada de CMS sobreposta (`customizeTable`) |
| `rebase-backend-postgres` | O backend Postgres: configuração, geração de schema, migrações, pooling, réplicas de leitura |
| `rebase-api` | A API REST gerada — endpoints, filtragem, ordenação, paginação |
| `rebase-sdk` | O SDK TypeScript gerado: CRUD, filtragem, busca, autenticação, realtime, offline, storage |
| `rebase-auth` | Autenticação, papéis (roles), políticas de RLS, MFA, chaves de API, OAuth, adaptadores personalizados |
| `rebase-security` | Controle de acesso, interceptação, design fail-closed, mascaramento de PII, isolamento de tenants |
| `rebase-realtime` | O mecanismo WebSocket: sincronização, canais de broadcast, presença, broadcasts de alterações em tabelas |
| `rebase-storage` | Armazenamento S3/GCS/local, uploads, uploads retomáveis via TUS, transformações de imagem |
| `rebase-custom-functions` | Endpoints de API personalizados por meio de descoberta de funções baseada em arquivos |
| `rebase-cron-jobs` | Agendamento de tarefas recorrentes em segundo plano |
| `rebase-webhooks` | Webhooks HTTP de saída, assinaturas HMAC, novas tentativas (retry) e backoff |
| `rebase-email` | SMTP, templates, provedores personalizados, o singleton `rebase.email` |
| `rebase-entity-history` | Versionamento de entidades, rastreamento de alterações, logs de auditoria, reversão |
| `rebase-admin` | Navegação no painel de administração, gavetas laterais (drawers), URLs, incorporação de painéis de coleção |
| `rebase-customize-admin` | Personalização do admin com componentes React — singletons, páginas de configurações, ações em lote, modos de visualização, campos personalizados, substituição de partes nativas |
| `rebase-custom-views` | Telas personalizadas dentro do admin — `rebase generate view`, visualizações de nível superior, abas de registros, widgets de campo |
| `rebase-dashboards` | KPIs, gráficos e dashboards — números calculados em SQL, renderizados com `@rebasepro/ui`, posicionados em slots ou em uma página |
| `rebase-ui-components` | A biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | A linguagem de design de UI: tokens, cores, tipografia, espaçamento, antipadrões |
| `rebase-studio` | A camada de ferramentas de desenvolvedor do Studio — SQL, RLS, storage, cron, visualizador de schema, logs |
| `rebase-cloud` | Implantação e operação no Rebase Cloud — projetos, bancos de dados gerenciados, variáveis de ambiente, domínios, logs, rollbacks |
| `rebase-deployment` | Auto-hospedagem: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configuração inicial do ambiente: Node.js, pnpm, PostgreSQL, Docker |

Duas dessas solicitam ser lidas de forma espontânea. A `rebase-basics` indica que deve ser usada
sempre que um assistente interagir com o Rebase, e a `rebase-design-language` indica que o
agente deve lê-la antes de criar ou modificar qualquer interface visual — ela existe
porque interfaces de usuário geradas se desviam de um design system mais rápido do que qualquer outra coisa em uma
base de código.

## Como é uma execução

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

As skills são distribuídas a partir do pacote `@rebasepro/agent-skills`, do qual a CLI depende,
de modo que o conjunto que você obtém corresponde à versão instalada da sua CLI.
