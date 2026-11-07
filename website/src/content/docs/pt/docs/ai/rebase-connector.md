---
sourceHash: 6940f9fb7bc79a85
title: Conectar o Claude ao Rebase
sidebar_label: Conector do Rebase
description: Um conector MCP para todos os seus projetos do Rebase, no Rebase Cloud ou auto-hospedados — adicione-o uma vez no Claude, faça login com sua conta do Rebase e leia, faça deploy e altere seus projetos com o acesso que você tem no console, com cada alteração confirmada primeiro.
---

O conector do Rebase é um servidor MCP para cada projeto do Rebase que você executa: no
Rebase Cloud e em seus próprios servidores. Você o adiciona uma vez no Claude, faz login com
sua conta do Rebase e o Claude pode ver seus projetos, ler seus logs, fazer deploy
e revertê-los, definir suas variáveis de ambiente e ler e alterar seus
dados. Ele funciona no Claude na web, no aplicativo para desktop e no celular.

Ele atua como **você**, com o acesso que a sua conta tem no console: os
projetos das organizações às quais você pertence, a função que você possui em cada uma e o
acesso a dados que o Studio do console oferece a você. Ele não possui nenhuma chave própria.

## Adicione-o

No Claude, abra **Settings → Connectors → Add custom connector** e insira:

```text
https://app.rebase.pro/mcp
```

O Claude abre a tela de consentimento do Rebase. Se você estiver conectado ao console no
mesmo navegador, ele oferecerá essa conta: clique em **Allow**. Caso contrário, faça login
por lá. A tela lista o que você está concedendo; você pode se conectar novamente mais tarde para
conceder menos.

Seus projetos do Rebase Cloud já estão lá. Essa é toda a configuração necessária para eles.

## Adicione suas instâncias auto-hospedadas

Execute isto uma vez para cada servidor que você mesmo hospeda:

```bash
rebase cloud connect https://admin.example.com
```

Ele adiciona a instância à sua conta do Rebase e exibe duas variáveis. Defina-as
nesse servidor e reinicie-o; o comando aguarda até que o servidor responda e então
informa que está conectado. Dentro da pasta do projeto, ele oferece gravá-las no
`.env` para você.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de então, o Claude lista a instância ao lado dos seus projetos do Cloud, e você
a referencia da mesma maneira: "mostre-me os pedidos em admin.example.com". Em uma instância auto-hospedada,
o conector lê e altera dados, lê seu schema e executa seus
cron jobs. Deploys, variáveis de ambiente e logs permanecem em seu próprio servidor.

- **O servidor precisa do Rebase 0.28.1 ou posterior**, acessível via https em um
  endereço público. O Rebase Cloud se comunica com ele, portanto, um servidor apenas em uma rede privada não pode
  ser conectado.
- **As variáveis não contêm nenhum segredo.** A chave é a chave pública do Rebase Cloud; o
  audience identifica esta instância. Com elas, o servidor aceita tokens de curta duração
  que o Rebase Cloud assina apenas para esta instância e concede a eles no máximo
  o que o Studio concederia: dados, sob sua segurança em nível de linha, e cron.
- **As chamadas passam pelo Rebase Cloud.** O Claude se comunica com o conector, e o
  conector com o seu servidor. Um servidor que você nunca conecta mantém seu próprio
  [remote MCP endpoint](/docs/ai/remote-mcp/), sem nada no meio.
- **Para desconectar uma**, execute `rebase cloud connect --remove https://admin.example.com`,
  ou remova as duas variáveis do servidor.

Adicionar uma instância requer a função de proprietário (owner) ou administrador (admin) da organização, como ao acessar
os dados de um projeto. O comando `rebase cloud connect --list` mostra as que você adicionou.

## O que o Claude pode fazer com ele

Doze ferramentas. As oito primeiras são apenas para leitura:

| Ferramenta | O que faz |
|---|---|
| `projects` | Lista seus projetos, o status deles e a sua função em cada um |
| `project_status` | O status e o deploy mais recente de um projeto; opcionalmente, seus deploys recentes, os **nomes** das suas variáveis de ambiente e seus cron jobs |
| `logs` | A saída da aplicação em execução, o log de build de um deploy ou as execuções de um cron job |
| `schema` | As coleções de um projeto ou os campos de uma coleção |
| `query` | Lê linhas: uma por id, uma página filtrada ou uma contagem |
| `show_collection` | Abre uma coleção na própria visualização do seu painel de administração, dentro da conversa: uma tabela, lista, cards ou quadro kanban que você pode pesquisar, filtrar e paginar, onde uma linha abre seu formulário |
| `show_record` | Abre o formulário de uma linha, ou um formulário para uma nova linha preenchida pelo Claude, para você revisar e salvar |
| `show_app` | Cria um pequeno aplicativo para a tarefa em questão, como uma fila de triagem ou um dashboard, e o executa com seus dados dentro da conversa. Ele pode usar as visualizações e formulários do seu painel de administração e solicita sua confirmação antes de alterar qualquer coisa |

As outras quatro alteram a produção, e cada uma delas pede confirmação primeiro:

| Ferramenta | O que faz |
|---|---|
| `write` | Cria, atualiza ou exclui uma linha (incluindo usuários: eles são linhas da sua coleção de usuários) |
| `deploy` | Faz o deploy de uma branch git, reverte para um deploy anterior ou cancela um em andamento |
| `env` | Define ou remove variáveis de ambiente; uma alteração é aplicada no próximo deploy |
| `cron` | Executa um cron job agora ou ativa/desativa um cron job |

O deploy de código a partir da sua máquina continua sendo feito pela CLI (`rebase cloud deploy`) e
pelo [servidor MCP local](/docs/ai/mcp/), que também abrange desenvolvimento local,
geração de schemas e branches de banco de dados.

## Toda alteração é confirmada

Uma ferramenta que altera algo requer duas chamadas. A primeira não altera nada: ela
responde com um plano, como "Roll shop back to deployment d_81f2", e um
token de confirmação. O Claude mostra o plano a você e faz uma nova chamada com o token
apenas se você concordar. O token funciona por cinco minutos, apenas uma vez, exatamente para
os argumentos para os quais foi criado: se algo for diferente, nada é executado.

O Claude também pede sua permissão antes de chamar qualquer uma dessas quatro ferramentas,
pois elas são marcadas como destrutivas. Nas visualizações, salvar um formulário mostra
o plano e espera que você clique em **Save**.

Os valores das variáveis de ambiente nunca são exibidos de volta: um plano mostra apenas o comprimento deles,
e `project_status` lista apenas os nomes. O valor que você define passa pela
conversa.

## O que ele pode acessar

- **Projetos e operações em nuvem**: o que o console permite a você. Um membro de uma
  organização pode ler status e logs e, como no console, fazer deploy e definir
  variáveis.
- **Dados, schemas e cron jobs**: o que o Studio no console permite a você. Isto
  é, um proprietário ou administrador da organização, em um projeto cujo acesso ao Studio esteja
  ativado, ou em uma instância auto-hospedada conectada pela organização. As chamadas são executadas dentro do projeto, sob sua segurança em nível de linha, com
  a função de administrador que o Studio possui. Desativar o acesso ao Studio para um projeto também desativa
  isso.
- **O que você concedeu.** Você pode conceder ao conector menos do que a sua conta
  possui: apenas leitura ou apenas um projeto. Ele nunca solicita backups,
  restaurações, credenciais de banco de dados ou configurações do projeto.

Um projeto acessa seus dados por meio do conector assim que executa um runtime que
aceite as chamadas do conector. Até o seu próximo deploy ou rollout de plataforma, essas
ferramentas indicarão isso.

## Como desconectar

Remova o conector nas configurações do Claude. O token de acesso deixará de funcionar
dentro de uma hora. Excluir sua conta do Rebase ou desconectar-se de todas as sessões o interrompe
na próxima chamada.

O conector é destinado a quem desenvolve no Rebase. Para permitir que as pessoas
que **usam** seu aplicativo conectem o Claude a ele como elas mesmas, disponibilize o
[remote MCP endpoint](/docs/ai/remote-mcp/) a partir do seu próprio backend.
