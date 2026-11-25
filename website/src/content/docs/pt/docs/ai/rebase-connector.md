---
sourceHash: 94bd49dce72c5651
title: Conectar o Claude ao Rebase
sidebar_label: Conector Rebase
description: Um conector MCP para todos os seus projetos Rebase, no Rebase Cloud ou auto-hospedados — adicione-o uma vez no Claude, faça login com sua conta Rebase e leia, implante e altere seus projetos com o acesso que você tem no console, com cada alteração confirmada previamente.
---

O conector Rebase é um servidor MCP para todos os projetos Rebase que você executa: no Rebase Cloud e em seus próprios servidores. Você o adiciona uma vez no Claude, faz login com sua conta Rebase e o Claude pode visualizar seus projetos, ler seus logs, fazer deploy e rollback, definir variáveis de ambiente e ler e alterar seus dados. Funciona no Claude na web, no aplicativo para desktop e no celular.

Ele age como **você**, com o acesso que sua conta possui no console: os projetos das organizações às quais você pertence, o papel que você desempenha em cada uma e o acesso a dados que o Studio do console oferece. Ele não mantém nenhuma chave própria.

## Adicione-o

No Claude, abra **Settings → Connectors → Add custom connector** e insira:

```text
https://app.rebase.pro/mcp
```

O Claude abre a tela de consentimento do Rebase. Se você estiver conectado ao console no mesmo navegador, ele oferecerá essa conta: clique em **Allow**. Caso contrário, faça login nela. A tela lista o que você está concedendo; você pode se conectar novamente mais tarde para conceder menos.

Seus projetos do Rebase Cloud já estarão lá. Essa é toda a configuração necessária para eles.

## Adicione suas instâncias auto-hospedadas

Execute isto uma vez para cada servidor que você hospeda por conta própria:

```bash
rebase cloud connect https://admin.example.com
```

Ele adiciona a instância à sua conta Rebase e exibe duas variáveis. Defina-as nesse servidor e reinicie-o; o comando aguarda até que o servidor responda e então informa que está conectado. Dentro da pasta do projeto, ele oferece gravá-las no `.env` para você.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de então, o Claude lista a instância ao lado dos seus projetos do Cloud, e você se refere a ela da mesma forma: "mostre-me os pedidos em admin.example.com". Em uma instância auto-hospedada, o conector lê e altera dados, lê seu esquema e executa seus cron jobs. Deploys, variáveis de ambiente e logs permanecem no seu próprio servidor.

- **O servidor precisa do Rebase 0.28.1 ou posterior**, acessível via https em um endereço público. O Rebase Cloud faz chamadas para ele, portanto, um servidor apenas em uma rede privada não pode ser conectado.
- **As variáveis não contêm segredos.** A chave é a chave pública do Rebase Cloud; o audience nomeia esta instância. Com elas, o servidor aceita tokens de curta duração que o Rebase Cloud assina exclusivamente para esta instância e concede a eles, no máximo, o que o Studio concederia: dados, sob sua segurança em nível de linha (row-level security), e cron.
- **As chamadas passam pelo Rebase Cloud.** O Claude se comunica com o conector, e o conector com o seu servidor. Um servidor que você nunca conectar mantém seu próprio [remote MCP endpoint](/docs/ai/remote-mcp/), sem intermediários.
- **Para desconectar um**, execute `rebase cloud connect --remove https://admin.example.com`, ou remova as duas variáveis do servidor.

Adicionar uma instância requer a função de proprietário (owner) ou administrador (admin) da organização, assim como acessar os dados de um projeto. O comando `rebase cloud connect --list` exibe as que você adicionou.

## O que o Claude pode fazer com ele

Treze ferramentas. As nove primeiras realizam apenas leitura:

| Ferramenta | O que faz |
|---|---|
| `projects` | Lista seus projetos, o status deles e sua função em cada um |
| `project_status` | O status de um projeto e sua implantação mais recente; opcionalmente, suas implantações recentes, os **nomes** de suas variáveis de ambiente e seus cron jobs |
| `logs` | A saída da aplicação em execução, o log de build de uma implantação ou as execuções de um cron job |
| `schema` | As tabelas de um projeto, ou as colunas, relações e regras de segurança de uma tabela |
| `query` | Lê linhas: uma por id, uma página filtrada ou uma contagem |
| `show_table` | Abre uma tabela na própria visualização do seu painel de administração, na conversa: uma tabela, lista, cartões ou quadro kanban onde você pode pesquisar, filtrar e paginar, no qual uma linha abre seu formulário |
| `show_record` | Abre o formulário de uma linha, ou um formulário para uma nova linha preenchida pelo Claude, para você revisar e salvar |
| `show_app` | Cria um pequeno aplicativo para a tarefa em questão, como uma fila de triagem ou um painel, e o executa com seus dados na conversa. Ele pode usar as visualizações e formulários do seu painel de administração e solicita sua confirmação antes de alterar qualquer coisa |
| `show_app_guide` | Como escrever o código do `show_app`: os hooks, componentes e props que um aplicativo pode usar, com um exemplo. O Claude lê isso antes de criar um aplicativo |

As outras quatro alteram a produção, e cada uma solicita confirmação primeiro:

| Ferramenta | O que faz |
|---|---|
| `write` | Cria, atualiza ou exclui uma linha (usuários incluídos: eles são linhas da sua tabela de usuários) |
| `deploy` | Faz o deploy de uma branch git, reverte (rollback) para um deploy anterior ou cancela um em andamento |
| `env` | Define ou remove variáveis de ambiente; a alteração é aplicada no próximo deploy |
| `cron` | Executa um cron job agora, ou ativa/desativa um |

Fazer deploy de código a partir da sua máquina continua sendo feito via CLI (`rebase cloud deploy`) e pelo [servidor MCP local](/docs/ai/mcp/), que também abrange o desenvolvimento local, geração de esquema e branches de banco de dados.

## Skills

O conector também fornece as 24 [skills de agente do Rebase](/docs/ai/skills/), as mesmas que o comando `rebase skills install` copia para um projeto. O Claude carrega uma quando a tarefa exige: como definir uma tabela, escrever um hook, configurar autenticação, fazer deploy. Nada precisa ser instalado. O Claude Code as lista como `<connector>:rebase-tables` e assim por diante, sob o nome que você atribuiu ao conector. Skills via MCP requerem um cliente na revisão de protocolo 2026-07-28 ou posterior e estão em beta público no Claude Code.

## Todas as alterações são confirmadas

Uma ferramenta que altera algo requer duas chamadas. A primeira não altera nada: ela retorna um plano, como "Reverter loja para o deploy d_81f2", e um token de confirmação. O Claude mostra o plano a você e faz uma nova chamada com o token apenas se você concordar. O token funciona por cinco minutos, uma única vez, e exatamente para os argumentos para os quais foi criado: se algo for diferente, nada é executado.

O Claude também solicita sua permissão antes de chamar qualquer uma dessas quatro ferramentas, pois elas são marcadas como destrutivas. Nas visualizações, salvar um formulário exibe o plano e aguarda que você clique em **Save**.

Os valores das variáveis de ambiente nunca são exibidos de volta: um plano mostra apenas o comprimento delas, e o `project_status` lista somente os nomes. Um valor que você define, no entanto, passa pela conversa.

## O que ele pode acessar

- **Projetos e operações em nuvem**: o que o console permite a você. Um membro de uma organização pode ler status e logs e, como no console, fazer deploy e definir variáveis.
- **Dados, esquemas e cron jobs**: o que o Studio no console permite a você. Ou seja, ser proprietário (owner) ou administrador (admin) da organização, em um projeto cujo acesso ao Studio esteja ativado, ou em uma instância auto-hospedada que a organização conectou. As chamadas são executadas dentro do projeto, sob sua segurança em nível de linha (row-level security), com a função de admin que o Studio possui. Desativar o acesso ao Studio para um projeto também desativa isso.
- **O que você concedeu.** Você pode conceder ao conector menos permissões do que sua conta possui: apenas leitura ou apenas um projeto. Ele nunca solicita backups, restaurações, credenciais de banco de dados ou configurações do projeto.

Um projeto acessa seus dados por meio do conector assim que executa um runtime compatível com as chamadas do conector. Até o seu próximo deploy ou atualização da plataforma, essas ferramentas indicarão isso.

## Como desconectar

Remova o conector nas configurações do Claude. Seu token de acesso deixará de funcionar dentro de uma hora. Excluir sua conta Rebase ou desconectar-se de todas as sessões interrompe o funcionamento na próxima chamada.

O conector foi desenvolvido para as pessoas que criam no Rebase. Para permitir que as pessoas que **usam** seu aplicativo conectem o Claude a ele com suas próprias identidades, disponibilize o [remote MCP endpoint](/docs/ai/remote-mcp/) a partir do seu próprio backend.
