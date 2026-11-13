---
sourceHash: 940a1c3ace06a8c3
title: Conecte o Claude ao Rebase
sidebar_label: Conector Rebase
description: Um único conector MCP para todos os seus projetos Rebase, no Rebase Cloud ou auto-hospedados — adicione-o uma vez no Claude, faça login com sua conta Rebase e leia, faça deploy e altere seus projetos com o acesso que você tem no console, com cada alteração confirmada previamente.
---

O conector Rebase é um servidor MCP único para cada projeto Rebase que você executa: no
Rebase Cloud e em seus próprios servidores. Você o adiciona uma vez no Claude, faz login com
sua conta Rebase e o Claude pode ver seus projetos, ler seus logs, fazer deploy
e rollbacks, definir suas variáveis de ambiente e ler e alterar seus
dados. Ele funciona no Claude na web, no aplicativo desktop e no celular.

Ele age como **você**, com o acesso que sua conta possui no console: os
projetos das organizações às quais você pertence, a função que você exerce em cada uma e o
acesso a dados que o Studio do console oferece. Ele não armazena nenhuma chave própria.

## Adicione-o

No Claude, abra **Settings → Connectors → Add custom connector** e insira:

```text
https://app.rebase.pro/mcp
```

O Claude abre a tela de consentimento do Rebase. Se você estiver conectado ao console no
mesmo navegador, ele sugerirá essa conta: clique em **Allow**. Caso contrário, faça login
por lá. A tela lista o que você está concedendo; você pode se conectar novamente mais tarde para
conceder menos permissões.

Seus projetos do Rebase Cloud já estarão lá. Essa é toda a configuração necessária para eles.

## Adicione suas instâncias auto-hospedadas

Execute isto uma vez para cada servidor que você mesmo hospeda:

```bash
rebase cloud connect https://admin.example.com
```

Isso adiciona a instância à sua conta Rebase e exibe duas variáveis. Defina-as
nesse servidor e reinicie-o; o comando aguarda até que o servidor responda e, em seguida,
informa que ele está conectado. Dentro da pasta do projeto, ele oferece a opção de gravá-las no
`.env` para você.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de então, o Claude lista a instância ao lado dos seus projetos Cloud, e você
se refere a ela da mesma forma: "mostre-me os pedidos em admin.example.com". Em uma instância auto-hospedada,
o conector lê e altera dados, lê seu esquema e executa suas
tarefas cron. Deploys, variáveis de ambiente e logs permanecem no seu próprio servidor.

- **O servidor precisa do Rebase 0.28.1 ou posterior**, acessível via HTTPS em um
  endereço público. O Rebase Cloud faz chamadas para ele, portanto, um servidor localizado apenas em uma rede privada não pode
  ser conectado.
- **As variáveis não contêm nenhum segredo.** A chave é a chave pública do Rebase Cloud; o
  audience identifica esta instância. Com elas, o servidor aceita tokens de curta duração
  que o Rebase Cloud assina exclusivamente para esta instância e concede a eles, no máximo,
  o que o Studio concederia: dados, sob a sua segurança em nível de linha (row-level security), e cron.
- **As chamadas passam pelo Rebase Cloud.** O Claude se comunica com o conector, e o
  conector com o seu servidor. Um servidor que você nunca conectar mantém seu próprio
  [endpoint MCP remoto](/docs/ai/remote-mcp/), sem intermediários.
- **Para desconectar uma**, execute `rebase cloud connect --remove https://admin.example.com`,
  ou remova as duas variáveis do servidor.

Adicionar uma instância exige a função de proprietário (owner) ou administrador (admin) da organização, assim como acessar
os dados de um projeto. O comando `rebase cloud connect --list` mostra as instâncias que você adicionou.

## O que o Claude pode fazer com ele

Treze ferramentas. As nove primeiras apenas realizam leitura:

| Ferramenta | O que faz |
|---|---|
| `projects` | Lista seus projetos, o status deles e sua função em cada um |
| `project_status` | O status e o deploy mais recente de um projeto; opcionalmente, seus deploys recentes, os **nomes** de suas variáveis de ambiente e suas tarefas cron |
| `logs` | A saída da aplicação em execução, o log de build de um deploy ou as execuções de uma tarefa cron |
| `schema` | As tabelas de um projeto, ou as colunas, relações e regras de segurança de uma tabela |
| `query` | Lê registros: um por ID, uma página filtrada ou uma contagem |
| `show_table` | Abre uma tabela na própria visualização do seu painel administrativo, dentro da conversa: uma tabela, lista, cards ou quadro kanban que você pode pesquisar, filtrar e paginar, onde uma linha abre seu formulário |
| `show_record` | Abre o formulário de um registro, ou um formulário para um novo registro preenchido pelo Claude, para você revisar e salvar |
| `show_app` | Constrói um pequeno aplicativo para a tarefa em questão, como uma fila de triagem ou um dashboard, e o executa com seus dados dentro da conversa. Ele pode usar as visualizações e formulários do seu painel administrativo e pede sua confirmação antes de alterar qualquer coisa |
| `show_app_guide` | Como escrever o código do `show_app`: os hooks, componentes e props que um aplicativo pode usar, com um exemplo. O Claude lê isso antes de criar um aplicativo |

As outras quatro realizam alterações em produção, e cada uma delas pede confirmação prévia:

| Ferramenta | O que faz |
|---|---|
| `write` | Cria, atualiza ou exclui um registro (usuários incluídos: eles são registros da sua tabela de usuários) |
| `deploy` | Faz deploy de uma branch git, reverte para um deploy anterior (rollback) ou cancela um em andamento |
| `env` | Define ou remove variáveis de ambiente; a alteração é aplicada no próximo deploy |
| `cron` | Executa uma tarefa cron agora, ou ativa/desativa uma tarefa |

O deploy de código a partir da sua máquina continua sendo feito pela CLI (`rebase cloud deploy`) e
pelo [servidor MCP local](/docs/ai/mcp/), que também abrange o desenvolvimento local,
geração de esquema e branches de banco de dados.

## Toda alteração é confirmada

Uma ferramenta que altera algo exige duas chamadas. A primeira não altera nada: ela
responde com um plano, como "Roll shop back to deployment d_81f2", e um
token de confirmação. O Claude mostra o plano a você e faz uma nova chamada com o token
apenas se você concordar. O token funciona por cinco minutos, uma única vez, exatamente para os
argumentos para os quais foi criado: se algo for diferente, nada é executado.

O Claude também solicita sua permissão antes de chamar qualquer uma dessas quatro ferramentas,
pois elas são marcadas como destrutivas. Nas visualizações, salvar um formulário exibe
o plano e aguarda que você clique em **Save**.

Os valores das variáveis de ambiente nunca são exibidos de volta: o plano mostra apenas seu comprimento,
e `project_status` lista apenas os nomes. Um valor que você define passa, de fato, pela
conversa.

## O que ele pode acessar

- **Projetos e operações de nuvem**: o que o console permite a você. Um membro de uma
  organização pode ler status e logs e, assim como no console, fazer deploy e definir
  variáveis.
- **Dados, esquemas e tarefas cron**: o que o Studio no console permite a você. Isso
  corresponde a um proprietário ou administrador da organização, em um projeto cujo acesso ao Studio esteja
  ativado, ou em uma instância auto-hospedada que a organização conectou. As chamadas são executadas dentro do projeto, sob sua segurança em nível de linha (row-level security), com
  a função de administrador que o Studio possui. Desativar o acesso ao Studio para um projeto também desativa
  isso.
- **O que você concedeu.** Você pode conceder ao conector menos permissões do que sua conta
  possui: somente leitura ou apenas um projeto. Ele nunca solicita backups,
  restaurações, credenciais de banco de dados ou configurações do projeto.

Um projeto acessa seus dados por meio do conector assim que estiver executando um runtime compatível
com as chamadas do conector. Até o próximo deploy ou atualização da plataforma,
essas ferramentas informarão isso.

## Desconexão

Remova o conector nas configurações do Claude. Seu token de acesso deixará de funcionar
dentro de uma hora. Excluir sua conta Rebase ou desconectar-se de todas as sessões o
desativará na próxima chamada.

O conector é destinado a quem desenvolve no Rebase. Para permitir que as pessoas
que **usam** seu aplicativo conectem o Claude a ele com suas próprias contas, forneça o
[endpoint MCP remoto](/docs/ai/remote-mcp/) a partir do seu próprio backend.
