---
sourceHash: df522ef7c8309826
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install grava 24 skills de referência do Rebase no seu repositório, no formato que seu assistente de IA espera — Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity.
---

Um assistente de IA que leu a documentação do Rebase escreve um código Rebase melhor
do que um que tenta adivinhar pelo formato da API. O comando `rebase skills install` copia 24
arquivos Markdown de skills para o seu repositório, no formato que o seu assistente
espera:

```bash
rebase skills install
```

As skills são **material de referência, não ferramentas**. Elas ensinam a um assistente como
as tabelas são declaradas, por que as migrações têm duas etapas e quais erros o
framework não irá detectar para ele. Para ferramentas que operam sobre os seus dados, consulte o
[servidor MCP](/docs/ai/mcp).

## Configurado pelo `rebase init`

Um novo projeto não precisa desse comando. O `rebase init` pergunta
se deseja configurar seus agentes de codificação por IA e lista os que encontrar
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

Os agentes encontrados vêm pré-selecionados. Para cada um que mantiver, ele grava as skills
e registra o [servidor MCP](/docs/ai/mcp) na configuração de projeto daquele agente, tudo
antes do primeiro commit do projeto. No CI, ou com `--yes`, indique-os:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Um projeto existente

O `rebase init` recusa um diretório que já contenha um projeto, portanto, um projeto
criado antes de a configuração de agentes existir — ou um cujo autor recusou a solicitação —
recebe a mesma configuração a partir de `rebase skills install --mcp`: as skills e o
[servidor MCP](/docs/ai/mcp) registrado na configuração de projeto de cada agente. Servidores
já existentes no arquivo são mantidos, e uma nova execução mantém a entrada do Rebase intacta.

```bash
rebase skills install --agent cursor --mcp
```

Sem `--mcp`, o comando grava apenas as skills e lista os agentes cuja
configuração ainda não possui o servidor.

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
skill significava cerca de **84.000 caracteres** de referência do Rebase antes de cada
pergunta feita por alguém, fosse ela sobre o Rebase ou não — e uma
instrução lida superficialmente pelo assistente é uma instrução não seguida.

Em vez disso, eles recebem `rebase.mdc` (ou `rebase.md`): um índice de ~3 KB com
`alwaysApply: true`, listando o que cada skill aborda e o arquivo a ser lido. Os
conteúdos ficam em subdiretórios por skill e são abertos sob demanda.
:::

O `gemini` abrange **tanto** o Gemini CLI quanto o Antigravity — eles leem o mesmo
diretório `.agents/`, então não há um valor `antigravity` separado. O Codex também o
lê; especificar tanto `gemini` quanto `codex` grava o diretório apenas uma vez.

Sem nenhum `--agent`, o comando detecta quais assistentes o projeto já utiliza
procurando por `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` e
`.kiro/`. Se não encontrar nenhum, ele solicitará que você escolha, com os assistentes
instalados na máquina já marcados.

**O GitHub Copilot nunca é detectado.** O seu diretório seria `.github/`, e
`.github/` não é evidência de que alguém usa o Copilot: o `rebase init` grava
`.github/copilot-instructions.md` em todo scaffold, e a maioria dos repositórios tem
um `.github/` para workflows. Instale-o com `--agent copilot`.

:::note[Um projeto recém-criado sempre exibe o prompt]
O `rebase init` grava `CLAUDE.md`, `.cursorrules` e similares, mas nenhum dos
*diretórios* que a detecção procura. Portanto, a primeira execução em um novo projeto
cai na seleção interativa — e no CI, onde não há TTY, ele é encerrado com um erro.
Passe `--agent` explicitamente em qualquer contexto não interativo.
:::

## Local ao projeto e feito para ser commitado

As skills são gravadas **relativamente à raiz do seu projeto** — o ancestral mais próximo
que contenha `rebase.json` — não no seu diretório home e não no diretório
de trabalho atual. Nada é instalado globalmente.

Faça o commit delas. Elas fazem parte do repositório da mesma forma que a configuração de um linter:
o assistente de cada colaborador trabalhará a partir do mesmo entendimento da base de código,
incluindo colaboradores que nunca executaram o comando.

## Atualizando as skills

**O `rebase upgrade` as atualiza.** As skills vêm incluídas no `@rebasepro/cli`, portanto,
após instalar a nova versão, o [`rebase upgrade`](/docs/cli/#rebase-upgrade)
executa o `rebase skills install` da nova CLI para cada assistente cujo diretório de
skills tenha sido gravado por uma instalação, mantendo os arquivos que você editou. Um projeto que já esteja
na versão mais recente também é atualizado. Uma atualização que falha nunca interrompe o upgrade. Com
`--json`, a propriedade `skills` do documento informa o ocorrido: `{ agents, refreshed }`, com
um `reason` quando não atualizou (`dry_run`, `not_installed` após `--no-install`,
`no_project_cli` quando o projeto não instala o `@rebasepro/cli` localmente,
`failed`), ou `null` caso não haja skills instaladas.

Se você alterou as versões fixadas de outra forma (um bot de dependências, edição manual), execute
`rebase upgrade` de qualquer maneira, ou execute a instalação você mesmo:

```bash
rebase skills install
```

Sem `--agent`, ele atualiza os assistentes cujos diretórios o projeto
já possui. Os comandos também exibem uma linha ao final quando uma versão mais recente do Rebase estiver disponível, para que um
assistente trabalhando no projeto saiba do lançamento sem precisar ser avisado.

Cada diretório de destino contém um manifesto `.rebase-skills.json` com o que o
comando gravou, permitindo que uma nova execução diferencie uma edição da cópia de uma versão anterior.
Faça o commit dele junto com as skills.

- Um arquivo que ninguém editou é substituído pela cópia da nova versão.
- Um arquivo que você editou é mantido, e o comando o lista. O `--force` o substitui.
- Uma skill que uma nova versão não distribui mais é removida, a menos que você a tenha editado.
  Nesse caso, ela é mantida e listada.
- Arquivos que o comando nunca gravou não são tocados.

Orientações específicas do projeto continuam pertencendo ao
[`ai-instructions.md`](/docs/ai/instruction-files), que é de sua responsabilidade. Uma skill editada
deixa de receber atualizações até que você use `--force`.

O comando também funciona fora de um projeto Rebase, utilizando o diretório
de trabalho atual como fallback — útil para um repositório de frontend separado que se comunica com um backend Rebase.

## As 24 skills

| Skill | Aborda |
|---|---|
| `rebase-basics` | Princípios fundamentais, fluxo de trabalho e manutenção — o ponto de entrada que os outros assumem |
| `rebase-tables` | Criação de tabelas: colunas, relações, `rls`, hooks e a camada de CMS sobreposta (`customizeTable`) |
| `rebase-backend-postgres` | O backend Postgres: configuração, geração de esquema, migrações, pooling, réplicas de leitura |
| `rebase-api` | A API REST gerada — endpoints, filtragem, ordenação, paginação |
| `rebase-sdk` | O SDK TypeScript gerado: CRUD, filtragem, busca, autenticação, realtime, offline, storage |
| `rebase-auth` | Autenticação, papéis, políticas RLS, MFA, chaves de API, OAuth, adaptadores personalizados |
| `rebase-security` | Controle de acesso, interceptação, design fail-closed, mascaramento de PII, isolamento de tenants |
| `rebase-realtime` | O motor WebSocket: sincronização, canais de broadcast, presença, broadcasts de alterações em tabelas |
| `rebase-storage` | Armazenamento S3/GCS/local, uploads, uploads retomáveis TUS, transformações de imagem |
| `rebase-custom-functions` | Endpoints de API personalizados via descoberta de funções baseada em arquivos |
| `rebase-cron-jobs` | Agendamento de tarefas recorrentes em segundo plano |
| `rebase-webhooks` | Webhooks HTTP de saída, assinaturas HMAC, tentativas e backoff |
| `rebase-email` | SMTP, templates, provedores personalizados, o singleton `rebase.email` |
| `rebase-entity-history` | Versionamento de entidades, rastreamento de alterações, logs de auditoria, reversão |
| `rebase-admin` | Navegação no painel administrativo, gavetas laterais (drawers), URLs, incorporação de painéis de coleção |
| `rebase-customize-admin` | Personalização do admin com componentes React — singletons, páginas de configurações, ações em lote, modos de visualização, campos personalizados, substituição de partes integradas |
| `rebase-custom-views` | Telas personalizadas dentro do admin — `rebase generate view`, visualizações de nível superior, abas de registros, widgets de campos |
| `rebase-dashboards` | KPIs, gráficos e dashboards — números calculados em SQL, renderizados com `@rebasepro/ui`, posicionados em slots ou em uma página |
| `rebase-ui-components` | A biblioteca de componentes `@rebasepro/ui` |
| `rebase-design-language` | A linguagem de design de UI: tokens, cor, tipografia, espaçamento, anti-padrões |
| `rebase-studio` | A camada de ferramentas para desenvolvedores do Studio — SQL, RLS, storage, cron, visualizador de esquema, logs |
| `rebase-cloud` | Implantação e operação no Rebase Cloud — projetos, bancos de dados gerenciados, variáveis de ambiente, domínios, logs, rollbacks |
| `rebase-deployment` | Auto-hospedagem: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway e Render |
| `rebase-local-env-setup` | Configuração inicial do ambiente: Node.js, pnpm, PostgreSQL, Docker |

Duas delas pedem para ser lidas espontaneamente. A `rebase-basics` indica que deve ser usada
sempre que um assistente interagir com o Rebase de qualquer forma, e a `rebase-design-language` afirma que
o agente deve lê-la antes de criar ou modificar qualquer UI visual — esta última existe
porque uma interface gerada se distancia de um design system mais rápido do que qualquer outra coisa em uma
base de código.

## Exemplo de execução

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

As skills são distribuídas pelo pacote `@rebasepro/agent-skills`, do qual a CLI depende,
portanto, o conjunto obtido corresponde à versão instalada da sua CLI.
