---
sourceHash: 0dcbce5cfcf3e2de
title: Conectar o Claude ao Rebase
sidebar_label: Conector do Rebase
description: Um conector MCP para todos os seus projetos Rebase, no Rebase Cloud ou auto-hospedados — adicione-o uma vez no Claude, faça login com sua conta Rebase e leia, implante e altere seus projetos com o acesso que você tem no console, com cada alteração confirmada primeiro.
---

O conector do Rebase é um servidor MCP único para todos os projetos Rebase que você executa: no Rebase Cloud e em seus próprios servidores. Você o adiciona uma vez no Claude, faz login com sua conta do Rebase e o Claude pode ver seus projetos, ler seus logs, implantá-los e revertê-los, definir suas variáveis de ambiente e ler e alterar seus dados. Ele funciona no Claude na web, no aplicativo para desktop e no celular.

Ele atua como **você**, com o acesso que sua conta possui no console: os projetos das organizações às quais você pertence, a função que você exerce em cada uma e o acesso a dados que o Studio do console oferece. Ele não possui chave própria.

## Adicione-o

No Claude, abra **Settings → Connectors → Add custom connector** e insira:

```text
https://app.rebase.pro/mcp
```

O Claude abre a tela de consentimento do Rebase. Se você estiver conectado ao console no mesmo navegador, ele sugerirá essa conta: clique em **Allow**. Caso contrário, faça login nela. A tela lista o que você está concedendo; você pode se conectar novamente mais tarde para conceder menos permissões.

Seus projetos do Rebase Cloud já estarão lá. Essa é toda a configuração necessária para eles.

## Adicione suas instâncias auto-hospedadas

Execute isso uma vez para cada servidor que você mesmo hospeda:

```bash
rebase cloud connect https://admin.example.com
```

Isso adiciona a instância à sua conta do Rebase e exibe duas variáveis. Defina-as nesse servidor e reinicie-o; o comando aguarda até que o servidor responda e, em seguida, informa que ele está conectado. Dentro da pasta do projeto, ele oferece gravá-las no `.env` para você.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

A partir daí, o Claude lista a instância ao lado dos seus projetos do Cloud, e você se refere a ela da mesma forma: "mostre-me os pedidos em admin.example.com". Em uma instância auto-hospedada, o conector lê e altera dados, lê seu esquema e executa suas tarefas cron. Implantações, variáveis de ambiente e logs permanecem em seu próprio servidor.

- **O servidor precisa do Rebase 0.28.1 ou posterior**, acessível via https em um endereço público. O Rebase Cloud se comunica com ele, portanto, um servidor localizado apenas em uma rede privada não pode ser conectado.
- **As variáveis não contêm segredos.** A chave é a chave pública do Rebase Cloud; o audience identifica esta instância. Com elas, o servidor aceita tokens de curta duração que o Rebase Cloud assina exclusivamente para esta instância, concedendo a eles, no máximo, o que o Studio concederia: dados, sob sua segurança em nível de linha (row-level security), e cron.
- **As chamadas passam pelo Rebase Cloud.** O Claude fala com o conector, e o conector fala com o seu servidor. Um servidor que você nunca conectar mantém seu próprio [remote MCP endpoint](/docs/ai/remote-mcp/), sem intermediários.
- **Para desconectar um servidor**, execute `rebase cloud connect --remove https://admin.example.com` ou remova as duas variáveis do servidor.

Adicionar uma instância exige a função de proprietário (owner) ou administrador (admin) da organização, da mesma forma que o acesso aos dados de um projeto. O comando `rebase cloud connect --list` mostra as instâncias que você adicionou.

## O que o Claude pode fazer com ele

Dezesseis ferramentas. As doze primeiras apenas realizam leitura:

| Ferramenta | O que faz |
|---|---|
| `projects` | Lista seus projetos, o status deles e sua função em cada um |
| `project_status` | Status e implantação mais recente de um projeto; opcionalmente, suas implantações recentes, os **nomes** de suas variáveis de ambiente e suas tarefas cron |
| `logs` | A saída da aplicação em execução, o log de compilação de uma implantação ou as execuções de uma tarefa cron |
| `schema` | As tabelas de um projeto, ou as colunas, relações e regras de segurança de uma tabela |
| `query` | Lê linhas: uma por id, uma página filtrada ou uma contagem |
| `storage_list` | Lista uma pasta do armazenamento de arquivos de um projeto, uma página por vez, e indica suas fontes de armazenamento e o bucket que cada uma atende |
| `storage_head` | Informa se um arquivo existe, seu tamanho, tipo e última alteração. Aceita a chave ou o valor `s3://bucket/key` armazenado em uma linha |
| `storage_get` | Lê um arquivo: seu conteúdo quando for texto (os primeiros 64 KB por padrão) ou seu tamanho e tipo quando for binário |
| `show_table` | Abre uma tabela na própria visualização do seu painel de administração, dentro da conversa: uma tabela, lista, cards ou quadro kanban que você pode pesquisar, filtrar e paginar, onde uma linha abre seu formulário |
| `show_record` | Abre o formulário de uma linha, ou um formulário para uma nova linha preenchida pelo Claude, para você revisar e salvar |
| `show_app` | Cria um pequeno aplicativo para a tarefa em questão, como uma fila de triagem ou um painel, e o executa com seus dados dentro da conversa. Pode usar as visualizações e formulários do seu painel de administração e solicita sua confirmação antes de alterar qualquer coisa |
| `show_app_guide` | Como escrever o código do `show_app`: os hooks, componentes e props que um aplicativo pode usar, com um exemplo. O Claude lê este guia antes de criar um aplicativo |

As outras quatro alteram a produção, e cada uma delas pede confirmação primeiro:

| Ferramenta | O que faz |
|---|---|
| `write` | Cria, atualiza ou exclui uma linha (incluindo usuários: eles são linhas da sua tabela de usuários) |
| `deploy` | Implanta uma branch git, reverte para uma implantação anterior ou cancela uma implantação em andamento |
| `env` | Define ou remove variáveis de ambiente; a alteração é aplicada na próxima implantação |
| `cron` | Executa uma tarefa cron agora, ou ativa/desativa uma tarefa |

A implantação de código a partir da sua máquina continua sendo feita pela CLI (`rebase cloud deploy`) e pelo [servidor MCP local](/docs/ai/mcp/), que também abrange desenvolvimento local, geração de esquemas e branches de banco de dados.

## Skills

O conector também fornece as 24 [skills de agente do Rebase](/docs/ai/skills/), as mesmas que o comando `rebase skills install` copia para um projeto. O Claude carrega uma quando a tarefa exige: como definir uma tabela, escrever um hook, configurar autenticação, fazer deploy. Nada precisa ser instalado. O Claude Code as lista como `<connector>:rebase-tables` e assim por diante, sob o nome que você atribuiu ao conector. Skills via MCP requerem um cliente na revisão de protocolo 2026-07-28 ou posterior e estão em beta público no Claude Code.

## Cada alteração é confirmada

Uma ferramenta que altera algo requer duas chamadas. A primeira não altera nada: ela retorna um plano, como "Reverter loja para a implantação d_81f2", e um token de confirmação. O Claude mostra o plano a você e faz uma nova chamada com o token apenas se você concordar. O token funciona por cinco minutos, apenas uma vez, exatamente para os argumentos para os quais foi gerado: se algo diferir, nada será executado.

O Claude também solicita sua permissão antes de chamar qualquer uma dessas quatro ferramentas, pois elas são marcadas como destrutivas. Nas visualizações, salvar um formulário exibe o plano e aguarda você clicar em **Salvar**.

Os valores das variáveis de ambiente nunca são exibidos de volta: o plano mostra apenas seu comprimento, e o `project_status` lista apenas os nomes. Um valor que você define passa pela conversa.

## O que ele pode acessar

- **Projetos e operações de nuvem**: o que o console permite a você. Um membro de uma organização pode ler status e logs e, como no console, fazer deploy e definir variáveis.
- **Dados, arquivos, esquemas e tarefas cron**: o que o Studio no console permite a você. Isto é, um proprietário ou administrador da organização, em um projeto cujo acesso ao Studio esteja ativado, ou em uma instância auto-hospedada que a organização conectou. As chamadas são executadas dentro do projeto, sob sua segurança em nível de linha (row-level security), com a função de administrador que o Studio possui. Os arquivos são lidos por meio das próprias fontes de armazenamento do projeto (armazenamento do Rebase ou o bucket configurado por suas variáveis `S3_*`) sob suas regras de armazenamento, e nunca são gravados ou excluídos. Desativar o acesso ao Studio de um projeto também desativa isso.
- **O que você concedeu.** Você pode conceder ao conector menos permissões do que sua conta possui: somente leitura ou apenas um projeto. Ele nunca solicita backups, restaurações, credenciais de banco de dados ou configurações de projeto.

Um projeto acessa seus dados por meio do conector assim que executa um runtime compatível com as chamadas do conector, e seus arquivos assim que esse runtime dispõe das ferramentas de armazenamento. Até a próxima implantação ou atualização da plataforma, essas ferramentas informarão sobre essa necessidade.

## Desconexão

Remova o conector nas configurações do Claude. Seu token de acesso deixará de funcionar dentro de uma hora. Excluir sua conta do Rebase ou desconectar-se de todas as sessões o desativa na próxima chamada.

O conector foi feito para quem desenvolve no Rebase. Para permitir que as pessoas que **usam** seu aplicativo conectem o Claude a ele em seu próprio nome, sirva o [endpoint MCP remoto](/docs/ai/remote-mcp/) a partir do seu próprio backend.
