---
sourceHash: 62b7632c6d62c832
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install grava 24 habilidades de referência do Rebase em seu repositório, no formato esperado pelo seu assistente de IA — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Um assistente de IA que leu a documentação do Rebase escreve um código Rebase melhor
do que um que tenta adivinhar a partir da estrutura da API. O comando `rebase skills install` copia 24
arquivos de habilidades em Markdown para o seu repositório, no formato que o seu assistente
espera:

```bash
rebase skills install
```

As habilidades são **material de referência, não ferramentas**. Elas informam ao assistente como
as tabelas são declaradas, por que as migrações ocorrem em duas etapas e quais erros o
framework não detectará por ele. Para ferramentas que operam sobre os seus dados, consulte o
[servidor MCP](/docs/ai/mcp).

## Via MCP, sem nada instalado

As mesmas habilidades chegam ao Claude via MCP. O [conector do Rebase](/docs/ai/rebase-connector/#skills)
e o [servidor MCP local](/docs/ai/mcp/#skills) disponibilizam todas as 24, e um
cliente no protocolo de revisão 2026-07-28 ou posterior carrega uma quando necessário.
O Claude Code as nomeia como `<server>:rebase-tables` e assim por diante. Instalá-las no
repositório, como mostrado abaixo, ainda é o que garante que cheguem a todos os assistentes, fixadas na
versão que o projeto executa.

Seu próprio aplicativo também pode fornecer habilidades para as pessoas que o utilizam: consulte
[o endpoint MCP remoto](/docs/ai/remote-mcp/#skills).

## Configurado pelo `rebase init`

Um novo projeto não precisa do comando. O `rebase init` pergunta
se você deseja configurar seus agentes de programação por IA e, em seguida, lista os que encontra na
máquina:

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

Os agentes encontrados já vêm pré-marcados. Para cada um que você mantiver, ele grava as habilidades
e registra o [servidor MCP](/docs/ai/mcp) na configuração de projeto daquele agente, tudo
antes do primeiro commit do projeto. Em CI, ou com `--yes`, especifique-os:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Em um projeto existente

O `rebase init` recusa um diretório que já contém um projeto, portanto, um projeto
criado antes da existência da configuração de agentes — ou cujo autor recusou a solicitação —
recebe a mesma configuração com `rebase skills install --mcp`: as habilidades e o
[servidor MCP](/docs/ai/mcp) registrado na configuração de projeto de cada agente. Servidores
que já estão no arquivo são mantidos, e uma nova execução preserva a entrada do Rebase como está.

```bash
rebase skills install --agent cursor --mcp
```

Sem `--mcp`, o comando grava apenas as habilidades e informa os agentes cuja
configuração ainda não possui o servidor.

## Qual assistente

O comando aceita `--agent` (ou `-a`), repetível e separado por vírgulas:

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

:::note[Cursor, Windsurf, Kiro e Copilot recebem um arquivo sempre ativo]
Esses quatro carregam todo o seu diretório de regras em cada requisição. Um arquivo de regra por
habilidade significaria cerca de **84.000 caracteres** de referência do Rebase antes de cada
pergunta feita por uma pessoa, tendo ou não relação com o Rebase — e uma
instrução que o assistente apenas lê superficialmente é uma instrução que ele não segue.

Em vez disso, eles recebem `rebase.mdc` (ou `rebase.md`): um índice de ~3 KB com
`alwaysApply: true`, listando o que cada habilidade abrange e o arquivo a ser lido. Os
conteúdos ficam em subdiretórios individuais por habilidade e são abertos sob demanda.
:::

O identificador `gemini` abrange **tanto** o Gemini CLI quanto o Antigravity — eles leem o mesmo
diretório `.agents/`, portanto não há um valor `antigravity` separado. O Codex também o lê;
especificar tanto `gemini` quanto `codex` grava o diretório apenas uma vez.

Sem o parâmetro `--agent`, o comando detecta quais assistentes o projeto já utiliza
procurando por `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se não encontrar nenhum, ele solicita que você escolha, trazendo os assistentes instalados
na máquina já marcados.

**O GitHub Copilot nunca é detectado.** Seu diretório seria `.github/`, e
`.github/` não é evidência de que alguém usa o Copilot: o `rebase init` grava
`.github/copilot-instructions.md` em toda estrutura gerada, e a maioria dos repositórios já tem um `.github/` para workflows. Instale-o com `--agent copilot`.

:::note[Um projeto recém-gerado sempre exibe a solicitação]
O `rebase init` grava `CLAUDE.md`, `.cursorrules` e similares, mas nenhum dos
*diretórios* que o processo de detecção procura. Portanto, a primeira execução em um novo projeto recai
no prompt interativo — e em CI, onde não há TTY, ele é encerrado com um erro.
Passe `--agent` explicitamente em qualquer contexto não interativo.
:::

## Local ao projeto e feito para ser versionado

As habilidades são gravadas **em relação à raiz do seu projeto** — o ancestral mais próximo
que contém `rebase.json` — e não no seu diretório de usuário (home) nem no diretório de
trabalho atual. Nada é instalado globalmente.

Faça commit delas. Elas fazem parte do repositório da mesma forma que uma configuração de linter:
o assistente de cada colaborador passa a trabalhar a partir do mesmo entendimento da base de código,
incluindo colaboradores que nunca executaram o comando.

## Atualizando as habilidades

**O `rebase upgrade` as atualiza.** As habilidades são distribuídas dentro do pacote `@rebasepro/cli`, então
depois de instalar a nova versão, o comando [`rebase upgrade`](/docs/cli/#rebase-upgrade)
executa o `rebase skills install` da nova CLI para cada assistente cujo diretório de habilidades foi
gerado por uma instalação anterior, mantendo os arquivos que você editou. Um projeto que já está na versão
atual também é atualizado. Uma atualização de habilidades que falhar nunca interrompe o upgrade principal. Sob
`--json`, o campo `skills` do documento informa o que aconteceu: `{ agents, refreshed }`, com
uma justificativa em `reason` quando não for atualizado (`dry_run`, `not_installed` após `--no-install`,
`no_project_cli` quando o projeto não instala o `@rebasepro/cli` diretamente,
`failed`), ou `null` se não houver habilidades instaladas.

Se você alterou as versões fixadas de outra forma (um bot de dependências, uma edição manual), execute
`rebase upgrade` mesmo assim, ou faça a instalação você mesmo:

```bash
rebase skills install
```

Sem `--agent`, ele atualiza os assistentes cujos diretórios o projeto já possui.
Os comandos também exibem uma linha ao final informando quando há uma versão mais recente do Rebase disponível,
para que um assistente que esteja trabalhando no projeto saiba da nova versão sem precisar ser avisado.

Cada diretório de destino contém um manifesto `.rebase-skills.json` com o registro do que o
comando gravou, permitindo que uma nova execução diferencie uma edição própria de uma cópia de uma versão anterior. Faça o commit
desse manifesto junto com as habilidades.

- Um arquivo que não foi editado é substituído pela cópia da nova versão.
- Um arquivo editado por você é mantido, e o comando o lista. O parâmetro `--force` força a substituição.
- Uma habilidade que não é mais incluída na nova versão é removida, a menos que você a tenha editado.
  Nesse caso, ela é mantida e listada.
- Arquivos que o comando nunca gravou não são modificados.

Instruções específicas do projeto continuam pertencendo ao arquivo
[`ai-instructions.md`](/docs/ai/instruction-files), que é de sua responsabilidade. Uma habilidade editada
deixa de receber atualizações até que você use o parâmetro `--force`.

O comando também funciona fora de um projeto Rebase, utilizando o diretório de trabalho atual
como alternativa — útil para um repositório de frontend separado que se comunica com um backend Rebase.

## As 24 habilidades

| Habilidade | Abrange |
|---|---|
| `rebase-basics` | Princípios fundamentais, fluxo de trabalho e manutenção — o ponto de entrada que as outras assumem |
| `rebase-tables` | Criação de tabelas: colunas, relações, `rls`, hooks e a camada de CMS sobreposta (`customizeTable`) |
| `rebase-backend-postgres` | O backend Postgres: configuração, geração de schema, migrações, pooling, réplicas de leitura |
| `rebase-api` | A API REST gerada — endpoints, filtragem, ordenação, paginação |
| `rebase-sdk` | O SDK TypeScript gerado: CRUD, filtragem, busca, autenticação, realtime, offline, armazenamento |
| `rebase-auth` | Autenticação, papéis (roles), políticas RLS, MFA, chaves de API, OAuth, adaptadores customizados |
| `rebase-security` | Controle de acesso, interceptação, design fail-closed, mascaramento de PII, isolamento de tenants |
| `rebase-realtime` | O motor WebSocket: sincronização, canais de transmissão, presença, transmissões de alterações em tabelas |
| `rebase-storage` | Armazenamento S3/GCS/local, uploads, uploads retomáveis com TUS, transformações de imagem |
| `rebase-custom-functions` | Endpoints de API customizados via descoberta de funções baseada em arquivos |
| `rebase-cron-jobs` | Agendamento de tarefas recorrentes em segundo plano |
| `rebase-webhooks` | Webhooks HTTP de saída, assinaturas HMAC, tentativas e backoff |
| `rebase-email` | SMTP, modelos (templates), provedores customizados, o singleton `rebase.email` |
| `rebase-entity-history` | Versionamento de entidades, rastreamento de alterações, logs de auditoria, reversão |
| `rebase-admin` | Navegação no painel de administração, gavetas laterais (drawers), URLs, incorporação de painéis de coleção |
| `rebase-customize-admin` | Customização do admin com componentes React — singletons, páginas de configurações, ações em massa, modos de visualização, campos customizados, substituição de partes integradas |
| `rebase-custom-views` | Telas customizadas dentro do admin — `rebase generate view`, visualizações de nível superior, abas de registros, widgets de campo |
| `rebase-dashboards` | KPIs, gráficos e painéis — métricas calculadas em SQL, desenhadas com `@rebasepro/ui`, inseridas em slots ou em uma página |
| `rebase-ui-components` | A biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | A linguagem de design da interface: tokens, cores, tipografia, espaçamento, antipadrões |
| `rebase-studio` | A camada de ferramentas de desenvolvedor do Studio — SQL, RLS, storage, cron, visualizador de schema, logs |
| `rebase-cloud` | Implantação e operação no Rebase Cloud — projetos, bancos de dados gerenciados, variáveis de ambiente, domínios, logs, rollbacks |
| `rebase-deployment` | Auto-hospedagem (self-hosting): Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configuração inicial do ambiente: Node.js, pnpm, PostgreSQL, Docker |

Duas delas pedem para ser lidas espontaneamente (sem solicitação direta). `rebase-basics` indica que deve ser consultada
sempre que um assistente for realizar qualquer ação no Rebase, e `rebase-design-language` indica que
o agente deve lê-la antes de criar ou modificar qualquer interface visual — ela existe
porque interfaces geradas se distanciam de um design system mais rápido do que qualquer outro elemento em uma base de código.

## Como é uma execução

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

As habilidades vêm empacotadas dentro de `@rebasepro/agent-skills`, dependência da CLI;
portanto, o conjunto fornecido corresponde à versão da CLI que você tem instalada.
