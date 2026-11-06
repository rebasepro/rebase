---
sourceHash: f5fcf560853b0193
title: Conectar o Claude ao Rebase
sidebar_label: Conector do Rebase
description: Um conector MCP para todos os seus projetos Rebase, no Rebase Cloud ou self-hosted — adicione-o uma vez no Claude, faça login com sua conta Rebase e leia, faça deploy e altere seus projetos com o acesso que você tem no console, com cada alteração confirmada primeiro.
---

O conector do Rebase é um único servidor MCP para todos os projetos Rebase que você executa: no Rebase Cloud e em seus próprios servidores. Você o adiciona uma vez no Claude, faz login com sua conta Rebase, e o Claude pode visualizar seus projetos, ler seus logs, fazer deploy e rollback, definir suas variáveis de ambiente e ler e alterar seus dados. Ele funciona no Claude na web, no aplicativo desktop e no celular.

Ele atua como **você**, com o mesmo acesso que sua conta possui no console: os projetos das organizações às quais você pertence, a função que você exerce em cada uma e o acesso a dados que o Studio do console oferece. Ele não possui chave própria.

## Adicione-o

No Claude, abra **Settings → Connectors → Add custom connector** e insira:

```text
https://app.rebase.pro/mcp
```

O Claude abre a tela de consentimento do Rebase. Se você estiver conectado ao console no mesmo navegador, ele oferecerá essa conta: clique em **Allow**. Caso contrário, faça login nessa tela. A tela lista o que você está concedendo; você pode se reconectar mais tarde para conceder menos permissões.

Seus projetos do Rebase Cloud já estarão lá. Essa é toda a configuração necessária para eles.

## Adicione suas instâncias self-hosted

Execute isto uma vez para cada servidor que você hospeda por conta própria:

```bash
rebase cloud connect https://admin.example.com
```

Isso adiciona a instância à sua conta Rebase e exibe duas variáveis. Defina-as nesse servidor e reinicie-o; o comando aguarda até que o servidor responda e então informa que está conectado. Dentro da pasta do projeto, ele oferece a opção de gravá-las no arquivo `.env` para você.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de então, o Claude listará a instância ao lado dos seus projetos Cloud, e você pode se referir a ela da mesma forma: "mostre-me os pedidos em admin.example.com". Em uma instância self-hosted, o conector lê e altera dados, lê seu esquema e executa seus cron jobs. Deploys, variáveis de ambiente e logs permanecem no seu próprio servidor.

- **O servidor precisa do Rebase 0.28.1 ou posterior**, acessível via HTTPS em um endereço público. O Rebase Cloud faz chamadas para ele, portanto, um servidor localizado apenas em uma rede privada não pode ser conectado.
- **As variáveis não contêm nenhum segredo.** A chave é a chave pública do Rebase Cloud; o audience identifica esta instância. Com elas, o servidor aceita tokens de curta duração que o Rebase Cloud assina exclusivamente para esta instância, concedendo a eles no máximo o que o Studio concederia: dados, sob a segurança em nível de linha (row-level security), e cron.
- **As chamadas passam pelo Rebase Cloud.** O Claude fala com o conector, e o conector com o seu servidor. Um servidor que você nunca conectar mantém seu próprio [remote MCP endpoint](/docs/ai/remote-mcp/), sem nada no meio.
- **Para desconectar um servidor**, execute `rebase cloud connect --remove https://admin.example.com` ou remova as duas variáveis do servidor.

Adicionar uma instância exige a função de proprietário (owner) ou administrador (admin) da organização, assim como acessar os dados de um projeto. O comando `rebase cloud connect --list` mostra as instâncias que você adicionou.

## O que o Claude pode fazer com ele

Dez ferramentas. As primeiras seis realizam apenas leitura:

| Ferramenta | O que faz |
|---|---|
| `projects` | Lista seus projetos, o status deles e sua função em cada um |
| `project_status` | O status de um projeto e a implantação mais recente; opcionalmente suas implantações recentes, os **nomes** de suas variáveis de ambiente e seus cron jobs |
| `logs` | A saída do aplicativo em execução, o log de build de um deploy ou as execuções de um cron job |
| `schema` | As coleções de um projeto ou os campos de uma coleção |
| `query` | Lê linhas: uma por id, uma página filtrada ou uma contagem |
| `show_collection` | Exibe linhas como uma tabela na conversa, onde você pode paginar e editar células |

As outras quatro alteram a produção, e cada uma solicita confirmação primeiro:

| Ferramenta | O que faz |
|---|---|
| `write` | Cria, atualiza ou exclui uma linha (incluindo usuários: eles são linhas da sua coleção de usuários) |
| `deploy` | Faz deploy de uma branch git, faz rollback para um deploy anterior ou cancela um em andamento |
| `env` | Define ou remove variáveis de ambiente; as alterações são aplicadas no próximo deploy |
| `cron` | Executa um cron job agora, ou ativa/desativa um cron job |

O deploy de código a partir da sua máquina continua sendo feito via CLI (`rebase cloud deploy`) e pelo [servidor MCP local](/docs/ai/mcp/), que também abrange o desenvolvimento local, geração de esquema e branches de banco de dados.

## Todas as alterações são confirmadas

Uma ferramenta que altera algo exige duas chamadas. A primeira não altera nada: ela responde com um plano, como "Roll shop back to deployment d_81f2", e um token de confirmação. O Claude mostra o plano a você e faz uma nova chamada com o token apenas se você concordar. O token funciona por cinco minutos, apenas uma vez, e estritamente para os argumentos para os quais foi gerado: se algo for diferente, nada é executado.

O Claude também pede sua permissão antes de chamar qualquer uma dessas quatro ferramentas, porque elas são marcadas como destrutivas. Na visualização em tabela, uma célula editada exibe o plano e aguarda você clicar em **Save**.

Os valores das variáveis de ambiente nunca são exibidos de volta: um plano mostra o tamanho delas, e o `project_status` lista apenas os nomes. Um valor que você definir passa pela conversa.

## O que ele pode acessar

- **Projetos e operações em nuvem**: o que o console permitir. Um membro de uma organização pode ler status e logs e, como no console, fazer deploys e definir variáveis.
- **Dados, esquemas e cron jobs**: o que o Studio no console permitir. Isso significa ser proprietário (owner) ou administrador (admin) da organização, em um projeto cujo acesso ao Studio esteja ativado, ou em uma instância self-hosted conectada pela organização. As chamadas são executadas dentro do projeto, sob sua segurança em nível de linha (row-level security), com a função de administrador que o Studio possui. Desativar o acesso ao Studio para um projeto também desativa isso.
- **O que você concedeu.** Você pode conceder ao conector menos permissões do que sua conta possui: apenas leitura ou apenas um projeto. Ele nunca solicita backups, restaurações, credenciais de banco de dados ou configurações do projeto.

Um projeto acessa seus dados por meio do conector assim que executa um runtime compatível com as chamadas do conector. Até o próximo deploy ou atualização da plataforma, essas ferramentas avisarão caso contrário.

## Desconectar

Remova o conector nas configurações do Claude. O token de acesso deixará de funcionar dentro de uma hora. Excluir sua conta Rebase ou encerrar a sessão em todos os lugares o interromperá na próxima chamada.

O conector é destinado àqueles que desenvolvem no Rebase. Para permitir que as pessoas que **usam** seu aplicativo conectem o Claude a ele em seu próprio nome, sirva o [endpoint MCP remoto](/docs/ai/remote-mcp/) a partir do seu próprio backend.
