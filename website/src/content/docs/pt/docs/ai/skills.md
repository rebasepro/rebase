---
sourceHash: 961bf86d4efda8bf
title: Agent Skills
sidebar_label: Agent Skills
description: O comando rebase skills install grava 21 skills de referência do Rebase no seu repositório, no layout esperado pelo seu assistente de IA — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Um assistente de IA que leu a documentação do Rebase escreve um código Rebase melhor
do que um que tenta adivinhar com base no formato da API. O comando `rebase skills install` copia 21
arquivos de skill em Markdown para o seu repositório, no layout que o seu assistente
espera:

```bash
rebase skills install
```

As skills são **material de referência, não ferramentas**. Elas ensinam a um assistente como
as coleções são definidas, por que as migrações têm duas etapas e quais erros o
framework não detectará para ele. Para ferramentas que operam sobre os seus dados, consulte o
[MCP server](/docs/ai/mcp).

## Qual assistente

O comando aceita `--agent` (ou `-a`), repetível e separado por vírgulas:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sete destinos são suportados — um para cada arquivo de ponteiro que o `rebase init` escreve:

| `--agent` | Assistente | Gravado em |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.codex/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro e Copilot recebem um único arquivo sempre ativo]
Esses quatro carregam todo o diretório de regras em cada requisição. Um arquivo
de regras por skill significava cerca de **84.000 caracteres** de referência do
Rebase na frente de cada pergunta, fosse ela sobre Rebase ou não — e uma
instrução que um assistente apenas folheia é uma instrução que ele não segue.

Em vez disso recebem `rebase.mdc` (ou `rebase.md`): um índice de cerca de 3 KB
com `alwaysApply: true`, listando o que cada skill cobre e o arquivo a ler. Os
corpos ficam em subdiretórios por skill e são abertos sob demanda.
:::

O `gemini` cobre **tanto** o Gemini CLI quanto o Antigravity — eles leem o mesmo
diretório `.agents/`, portanto não há um valor `antigravity` separado.

Sem o `--agent`, o comando detecta quais assistentes um projeto já usa
procurando por `.cursor/`, `.claude/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se não encontrar nenhum, ele solicitará que você escolha.

**O GitHub Copilot nunca é detectado.** O diretório dele seria `.github/`, e
`.github/` não é prova de que alguém use o Copilot: o `rebase init` escreve
`.github/copilot-instructions.md` em todo projeto gerado, e a maioria dos
repositórios tem um `.github/` para workflows. Instale-o com
`--agent copilot`.

:::note[Um projeto recém-criado sempre solicita confirmação]
O `rebase init` cria `CLAUDE.md`, `.cursorrules` e afins, mas nenhum dos
*diretórios* que a detecção procura. Portanto, a primeira execução em um novo projeto
recorre ao prompt interativo — e no CI, onde não há TTY, ele é encerrado com um erro.
Passe `--agent` explicitamente em qualquer contexto não interativo.
:::

## Local ao projeto e feito para ser commitado

As skills são gravadas **relativamente à raiz do seu projeto** — o ancestral mais próximo
que contém `rebase.json` — e não no seu diretório home nem no diretório de trabalho
atual. Nada é instalado globalmente.

Faça o commit delas. Elas fazem parte do repositório da mesma forma que uma configuração de linter:
o assistente de cada colaborador passa a trabalhar a partir do mesmo entendimento da base de código,
incluindo colaboradores que nunca executaram o comando.

**Execute o comando novamente para atualizar.** Os arquivos são sobrescritos incondicionalmente, portanto,
após uma atualização do Rebase:

```bash
rebase skills install --agent all
```

Duas consequências de "incondicionalmente": edições locais em uma skill instalada são
perdidas na próxima execução — em vez disso, mantenha orientações específicas do projeto em
[`ai-instructions.md`](/docs/ai/instruction-files), que é seu e nunca é
sobrescrito. E as skills removidas em uma versão mais recente não são excluídas do
seu repositório; apenas os arquivos que ainda existem são reescritos.

O comando também funciona fora de um projeto Rebase, usando o diretório de trabalho
como fallback — útil para um repositório de frontend separado que se comunica com um backend Rebase.

## As 21 skills

| Skill | O que aborda |
|---|---|
| `rebase-basics` | Princípios fundamentais, fluxo de trabalho e manutenção — o ponto de entrada que os outros assumem |
| `rebase-collections` | Definição de coleções, tipos de propriedades, validação, capacidade de busca |
| `rebase-backend-postgres` | O backend Postgres: configuração, geração de schema, migrações, pooling, réplicas de leitura |
| `rebase-api` | A API REST gerada — endpoints, filtragem, ordenação, paginação |
| `rebase-sdk` | O SDK TypeScript gerado: CRUD, filtragem, busca, autenticação, realtime, offline, armazenamento |
| `rebase-auth` | Autenticação, funções (roles), políticas de RLS, MFA, chaves de API, OAuth, adaptadores personalizados |
| `rebase-security` | Controle de acesso, interceptação, design fail-closed, mascaramento de PII, isolamento de tenant |
| `rebase-realtime` | O motor de WebSocket: sincronização, canais de broadcast, presença, broadcasts de alterações em tabelas |
| `rebase-storage` | Armazenamento S3/GCS/local, uploads, uploads retomáveis via TUS, transformações de imagem |
| `rebase-custom-functions` | Endpoints de API personalizados por meio de descoberta de funções baseada em arquivos |
| `rebase-cron-jobs` | Agendamento de tarefas recorrentes em segundo plano |
| `rebase-webhooks` | Webhooks HTTP de saída, assinaturas HMAC, novas tentativas (retry) e backoff |
| `rebase-email` | SMTP, templates, provedores personalizados, o singleton `rebase.email` |
| `rebase-entity-history` | Versionamento de entidades, rastreamento de alterações, logs de auditoria, reversão |
| `rebase-admin` | Navegação no painel administrativo, gavetas laterais (side drawers), URLs, incorporação de painéis de coleções |
| `rebase-ui-components` | A biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | A linguagem de design da UI: tokens, cores, tipografia, espaçamento, anti-padrões |
| `rebase-studio` | A camada de ferramentas para desenvolvedores do Studio — SQL, RLS, storage, cron, visualizador de schema, logs |
| `rebase-cloud` | Deploy e operação no Rebase Cloud — projetos, bancos de dados gerenciados, variáveis de ambiente, domínios, logs, rollbacks |
| `rebase-deployment` | Auto-hospedagem: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configuração inicial do ambiente: Node.js, pnpm, PostgreSQL, Docker |

Duas delas solicitam leitura automática (unprompted). O `rebase-basics` indica que deve ser usado
sempre que um assistente interagir com o Rebase, e o `rebase-design-language` indica que
o agente deve lê-lo antes de criar ou modificar qualquer interface visual — este último existe
porque a UI gerada se desvia de um design system mais rápido do que qualquer outra coisa em uma
base de código.

## Como é uma execução

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

As skills são distribuídas a partir do pacote `@rebasepro/agent-skills`, do qual a CLI depende,
portanto, o conjunto obtido corresponde à versão instalada da sua CLI.

---
