---
sourceHash: 52757f5185d7d81b
title: Conectar o Claude ao Rebase
sidebar_label: Conector do Rebase
description: Um conector MCP para todos os seus projetos Rebase, no Rebase Cloud ou auto-hospedados — adicione-o uma vez no Claude, faça login com sua conta Rebase e leia, implante e altere seus projetos com o acesso que você tem no console, com cada alteração confirmada previamente.
---

O conector do Rebase é um servidor MCP para todos os projetos Rebase que você executa: no Rebase Cloud e nos seus próprios servidores. Você o adiciona uma vez no Claude, faz login com sua conta Rebase, e o Claude pode ver seus projetos, ler seus logs, implantar e fazer rollback, definir suas variáveis de ambiente, além de ler e alterar seus dados. Funciona no Claude na web, no aplicativo para desktop e em dispositivos móveis.

Ele atua como **você**, com o acesso que sua conta possui no console: os projetos das organizações às quais você pertence, a função que ocupa em cada uma e o acesso a dados concedido pelo Studio do console. Ele não possui chave própria.

## Adicione-o

No Claude, abra **Settings → Connectors → Add custom connector** e insira:

```text
https://app.rebase.pro/mcp
```

O Claude abre a tela de consentimento do Rebase. Se você estiver conectado ao console no mesmo navegador, ele oferecerá essa conta: clique em **Allow**. Caso contrário, faça login por lá. A tela lista o que você está autorizando; você pode se conectar novamente mais tarde para conceder menos permissões.

Seus projetos no Rebase Cloud já estarão lá. Essa é toda a configuração necessária para eles.

## Adicione suas instâncias auto-hospedadas

Execute isto uma vez para cada servidor que você mesmo hospeda:

```bash
rebase cloud connect https://admin.example.com
```

Isso adiciona a instância à sua conta Rebase e exibe duas variáveis. Configure-as nesse servidor e reinicie-o; o comando aguarda até que o servidor responda e então informa que ele está conectado. Dentro da pasta do projeto, ele oferece a opção de gravá-las no arquivo `.env` para você.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir de então, o Claude listará a instância ao lado dos seus projetos do Cloud, e você poderá se referir a ela da mesma forma: "mostre-me os pedidos em admin.example.com". Em uma instância auto-hospedada, o conector lê e altera dados, lê seu schema e executa seus cron jobs. Deploys, variáveis de ambiente e logs permanecem no seu próprio servidor.

- **O servidor precisa do Rebase 0.28.1 ou posterior**, acessível via HTTPS em um endereço público. Como o Rebase Cloud faz chamadas para ele, um servidor restrito a uma rede privada não pode ser conectado.
- **As variáveis não contêm nenhum segredo.** A chave é a chave pública do Rebase Cloud; o audience identifica esta instância. Com eles, o servidor aceita tokens de curta duração que o Rebase Cloud assina exclusivamente para esta instância e concede, no máximo, o que o Studio concederia: dados, sob a sua segurança em nível de linha, e cron.
- **As chamadas passam pelo Rebase Cloud.** O Claude conversa com o conector, e o conector com o seu servidor. Um servidor que você nunca conectar mantém seu próprio [remote MCP endpoint](/docs/ai/remote-mcp/), sem intermediários.
- **Para desconectar uma instância**, execute `rebase cloud connect --remove https://admin.example.com` ou remova as duas variáveis do servidor.

Adicionar uma instância exige a função de proprietário (owner) ou administrador (admin) da organização, da mesma forma que acessar os dados de um projeto. O comando `rebase cloud connect --list` exibe as instâncias adicionadas.

## O que o Claude pode fazer com ele

Doze ferramentas. As oito primeiras são apenas de leitura:

| Ferramenta | O que faz |
|---|---|
| `projects` | Lista seus projetos, o status deles e sua função em cada um |
| `project_status` | O status e o deployment mais recente de um projeto; opcionalmente, seus deployments recentes, os **nomes** das suas variáveis de ambiente e seus cron jobs |
| `logs` | A saída do aplicativo em execução, o log de build de uma implantação ou as execuções de um cron job |
| `schema` | As collections de um projeto ou os campos de uma collection |
| `query` | Lê registros: um por ID, uma página filtrada ou uma contagem |
| `show_collection` | Abre uma collection na visualização própria do seu painel de administração, diretamente na conversa: uma tabela, lista, cards ou quadro kanban que você pode pesquisar, filtrar e paginar, onde um registro abre seu formulário |
| `show_record` | Abre o formulário de um registro ou um formulário para um novo registro preenchido pelo Claude, para você revisar e salvar |
| `show_app` | Abre uma pequena tela para a tarefa em questão: visualizações de collections, formulários e contagens, onde uma visualização pode acompanhar o registro selecionado em outra |

As outras quatro realizam alterações em produção, e cada uma solicita confirmação antes:

| Ferramenta | O que faz |
|---|---|
| `write` | Cria, atualiza ou exclui um registro (usuários inclusos: são registros da sua collection de usuários) |
| `deploy` | Faz deploy de uma branch do git, reverte para uma implantação anterior ou cancela uma em andamento |
| `env` | Define ou remove variáveis de ambiente; a alteração é aplicada no próximo deploy |
| `cron` | Executa um cron job agora, ou ativa/desativa um cron job |

A implantação de código a partir da sua máquina continua sendo feita via CLI (`rebase cloud deploy`) e pelo [servidor MCP local](/docs/ai/mcp/), que também abrange o desenvolvimento local, geração de schema e branches do banco de dados.

## Toda alteração é confirmada

Uma ferramenta que altera algo exige duas chamadas. A primeira não altera nada: ela responde com um plano, como "Reverter shop para o deployment d_81f2", e um token de confirmação. O Claude mostra o plano a você e faz uma nova chamada com o token apenas se você concordar. O token funciona por cinco minutos, apenas uma vez, e exatamente para os argumentos para os quais foi gerado: se algo diferir, nada será executado.

O Claude também solicita sua permissão antes de chamar qualquer uma dessas quatro ferramentas, pois elas são marcadas como destrutivas. Nas visualizações, ao salvar um formulário, o plano é exibido e aguarda que você clique em **Save**.

Os valores das variáveis de ambiente nunca são exibidos de volta: o plano mostra o tamanho delas, e o `project_status` lista apenas os nomes. Um valor que você define, no entanto, passa pela conversa.

## O que ele pode acessar

- **Projetos e operações em nuvem**: o que o console permite a você. Um membro de uma organização pode ler status e logs e, como no console, fazer deploys e definir variáveis.
- **Dados, schemas e cron jobs**: o que o Studio no console permite a você. Ou seja, ser um proprietário ou administrador da organização, em um projeto cujo acesso ao Studio esteja ativado, ou em uma instância auto-hospedada que a organização conectou. As chamadas são executadas dentro do projeto, sob a sua segurança em nível de linha, com a função de admin que o Studio possui. Desativar o acesso ao Studio em um projeto também desativa isso.
- **O que você autorizou.** Você pode conceder ao conector menos permissões do que sua conta possui: somente leitura ou apenas um projeto. Ele nunca solicita backups, restaurações, credenciais do banco de dados ou configurações do projeto.

Um projeto acessa seus dados por meio do conector assim que executa um runtime compatível com as chamadas do conector. Até o próximo deploy ou atualização da plataforma, essas ferramentas informarão caso ainda não seja compatível.

## Como desconectar

Remova o conector nas configurações do Claude. O token de acesso deixará de funcionar dentro de uma hora. Excluir sua conta Rebase ou desconectar-se de todas as sessões o desativa na próxima chamada.

O conector é destinado a quem desenvolve no Rebase. Para permitir que as pessoas que **usam** seu aplicativo conectem o Claude a ele com suas próprias identidades, disponibilize o [remote MCP endpoint](/docs/ai/remote-mcp/) a partir do seu próprio backend.
