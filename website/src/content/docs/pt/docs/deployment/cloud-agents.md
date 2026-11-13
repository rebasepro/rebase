---
sourceHash: b4a48b328135ef8c
title: CI, Agentes e Backends Reivindicáveis
sidebar_label: CI e Agentes
description: Faça deploy no Rebase Cloud a partir de CI ou de um agente com um token com escopo definido em vez de uma senha, e deixe um agente provisionar um backend ativo sem conta para que uma pessoa o reivindique mais tarde.
---

Um projeto do [Rebase Cloud](/docs/deployment/cloud/) não precisa de uma pessoa em um
terminal para fazer deploy. Um job de CI ou um agente atua com um token restrito a algumas
ações em um projeto, e um agente pode criar um projeto antes que alguém tenha uma
conta e, em seguida, entregar um link para reivindicá-lo.


## CI e agentes

Um job de CI ou um agente não deve portar sua senha. Em vez disso, forneça a ele
um token: uma chave que atua como sua conta, restrita a algumas ações em um único
projeto. Crie-o a partir de um terminal autenticado:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

O token é exibido apenas uma vez, como uma linha `export REBASE_TOKEN=rk_live_…`. Com a
variável `REBASE_TOKEN` definida, todo comando `rebase cloud` se autentica usando-a em vez
do seu login, e nunca lê ou grava a sessão armazenada. No GitHub Actions,
armazene-o como um segredo de repositório e exponha-o com esse nome:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` aceita uma ou mais capacidades, separadas por vírgula ou repetidas:

| Capacidade | O que o token pode fazer |
|---|---|
| `deploy` | Fazer deploy do projeto e acompanhar suas builds: `deploy` (`--preview` incluído), `deployments`, `previews` |
| `logs` | Ler logs de build e de execução, histórico de cron, métricas em tempo real e uso: `logs`, `cron`, `metrics`, `usage` |
| `env` | Ler e alterar variáveis de ambiente, incluindo segredos, e as próprias variáveis dos previews (`--preview`) |
| `database` | `db list`, `db info` e `db connect`, o que inclui a senha do banco de dados |
| `backups` | Listar, criar, inspecionar e baixar backups, e ler a janela de point-in-time |

Mais três capacidades atuam sobre uma organização em vez de um projeto. Um token
só possui uma delas quando `--can` a especifica, na organização definida por `--org` (ou,
sem `--org`, na organização do projeto e, em seguida, naquela selecionada com
`rebase cloud use`). Um token pode conter essas capacidades sem nenhuma capacidade de projeto:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capacidade | O que o token pode fazer |
|---|---|
| `billing` | Ler o cartão cadastrado, as faturas e a próxima fatura, e alterar o e-mail de faturamento: `billing`, `billing invoices`, `billing upcoming`. Apenas proprietários e administradores |
| `audit` | Ler o log de atividades da organização: `activity`. Apenas proprietários e administradores |
| `notifications` | Alterar as opções de e-mail do próprio proprietário e os webhooks de notificação dos projetos da organização: `notifications`. Adicionar, alterar e remover um webhook ainda exige o papel de proprietário ou administrador |

Um token criado antes da existência de `billing` ainda lê o faturamento durante
uma versão. Cada uma dessas respostas traz um cabeçalho `Deprecation: true` e uma
frase indicando o escopo que falta ao token, e a CLI a imprime uma vez, no stderr,
como um aviso. Substitua esse token por um criado com `--can billing` antes da
próxima versão, quando o faturamento começará a recusá-lo.

Por baixo dos panos, um token é uma [chave de API pessoal](/docs/backend/api-keys/#personal-keys)
no plano de controle. Cada capacidade se converte em alguns
[escopos](/docs/backend/roles-and-scopes/): `deploy` em `shop` possui
`project:deploy:<id>`, com o ID do projeto, além dos escopos de dados e funções
chamados pelos comandos de deploy. Uma capacidade de organização possui `org:billing:<id>`,
`org:audit:<id>` ou `org:notifications:<id>`, com o ID da organização. O token nunca tem
mais permissões do que a sua conta no momento em que é utilizado; portanto, ele perde
tudo o que a sua conta perder.

Duas coisas continuam restritas a uma pessoa autenticada:

- **Gerenciamento de tokens.** `rebase cloud tokens list`, `create` e `revoke <id>` exigem
  a sua sessão do `rebase cloud login`. Um token não pode listar, criar ou revogar
  tokens, pois um token capaz de gerar tokens poderia gerar seu próprio sucessor.
- **Restauração.** Nenhuma capacidade concede a restauração de backup ou um `restore`
  e `cutover` de point-in-time. Sobrescrever um banco de dados em produção com dados antigos
  permanece uma ação exclusiva de um proprietário ou administrador autenticado.

O comando `rebase cloud whoami` com um token definido mostra o que ele pode fazer e em qual
projeto ou organização. A tela **Access tokens** do console oferece as mesmas
capacidades, com as de organização sob **Organization access**. O comando `rebase cloud tokens revoke <id> --yes`
o revoga imediatamente.

## Um backend sem conta

Um agente que construiu uma aplicação pode fornecer a ela um backend ativo antes mesmo de
qualquer pessoa se cadastrar, entregando à pessoa para quem trabalha um link para mantê-lo:

```bash
rebase cloud init --claim
```

Isso provisiona um projeto no Rebase Cloud, define `REBASE_BASE_URL` no `.env` com
seu endereço ativo, vincula o diretório e faz o deploy das tabelas locais com
`rebase cloud deploy --bundle`. O comando exibe a URL pública, a URL do painel de administração e uma
**URL de reivindicação**. Qualquer pessoa que abrir a URL de reivindicação e fizer login poderá mover
o projeto para uma de suas organizações. O link funciona apenas uma vez. Um projeto que ninguém
reivindicar em até 72 horas é excluído, incluindo o banco de dados. `rebase cloud claim` exibe a URL
de reivindicação novamente junto com o tempo restante, e `--open` a abre no navegador. A ferramenta
`rebase_cloud_provision` do servidor MCP executa o mesmo comando e retorna as mesmas URLs;
suas outras ferramentas de nuvem podem então verificar, fazer deploy, ler logs, definir variáveis e reverter
o projeto sem necessidade de login (consulte [Servidor MCP](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` no `.env` também é para onde `rebase api-keys`, `rebase storage`
e `rebase auth reset-password` enviam a chave de serviço local. Portanto, após o `init
--claim`, eles apontam para o projeto na nuvem, que não aceita essa chave. Eles alertam
quando isso acontece; defina `REBASE_BASE_URL` no shell para acessar um backend local.

Até que o projeto seja reivindicado, ele não pertence a nenhuma conta. Seu token fica restrito
a esse único projeto: ele faz deploy, lê logs e métricas, define variáveis de ambiente
e executa `db info`. Ele não lê nada secreto de volta: nem o valor de uma variável (incluindo
a chave de serviço), nem a senha do banco de dados, e não pode abrir
`db connect` ou um preview. Ele é armazenado em
`~/.rebase/credentials.json`, nunca no repositório, e os comandos `rebase cloud`
no diretório vinculado o utilizam automaticamente. O `REBASE_TOKEN`, quando definido,
ainda tem precedência se possuir escopo nesse projeto, e esses comandos avisarão sobre isso;
quando não possuir nenhum (um token de CI criado para outros projetos), o token próprio do
projeto será usado e o primeiro comando informará isso. Um comando que receba `--project` para
outro projeto mantém o `REBASE_TOKEN`, e o deploy executado por `init --claim` sempre
usa o token próprio do projeto. Ele expira junto com o projeto. O comando `rebase cloud whoami`
nesse diretório exibe o projeto, o que o token pode fazer, a URL de reivindicação e quando o projeto expira.
Um comando que precise da sessão de uma pessoa é recusado com `session_required` e mantém o token;
ele só é esquecido quando o plano de controle o recusar em todos os lugares, após a reivindicação ou
na expiração, e a URL de reivindicação é impressa ao ser descartado. `rebase cloud status` mostra
a URL de reivindicação e a expiração também (`unclaimed` no `--json`). `rebase cloud unlink`
não exclui um projeto não reivindicado: ele avisa que o projeto continuará em execução
até expirar e exibe a URL de reivindicação, e o `init --claim` em um diretório
que já esteja vinculado a um projeto apontará para a sua URL de reivindicação em vez de provisionar
um segundo. Até a reivindicação, a aplicação acessa a internet apenas nas portas 80 e 443;
as portas de e-mail que todos os outros projetos possuem (465, 587 e 993) abrem quando o projeto
é reivindicado.

Assim que o deploy constrói a aplicação, o comando também define `REBASE_API_TOKEN` no
`.env`: uma chave gerada na própria aplicação, que é o que o servidor MCP e o SDK
enviam para ela. Se um `REBASE_API_TOKEN` já estiver presente no `.env`, ele será mantido e nenhum
outro será gerado; além disso, um arquivo `.env` criado pelo comando tem permissão de leitura apenas para você.
Ele lê e grava dados (`data:read`, `data:write`) através da segurança em nível de linha da
aplicação, como um chamador que não é uma pessoa nem um administrador. Ele
não detém nenhuma permissão do plano de administração e expira com a janela de reivindicação, a menos que
o projeto seja reivindicado antes. Com `--no-deploy`, ou quando esse primeiro deploy falha,
ainda não há uma chave: o próximo `rebase cloud deploy` bem-sucedido no
diretório solicitará uma, desde que o projeto não tenha sido reivindicado e o `.env` ainda não defina
um `REBASE_API_TOKEN`. Os comandos `init`, `deploy`, `status` e `whoami` exibem a
data em que ele expira.

A reivindicação transfere a chave: ela remove a expiração, para que o `.env` da aplicação
continue funcionando. O agente ainda mantém uma cópia; portanto, a pessoa que reivindicou o
projeto pode substituí-la. O comando `rebase cloud app-key rotate`, ou **Rotate app key** nas
Configurações do projeto, gera uma nova chave e revoga todas as chaves de agente anteriores de uma
só vez. Ele grava a nova chave em um `.env` que já defina `REBASE_API_TOKEN`,
ou a exibe uma única vez. Proprietários e administradores podem rotacioná-la estando autenticados.
Uma chave que não pôde ser transferida mantém sua expiração, o que acontece quando a aplicação não foi implantada
ou não estava respondendo no momento da reivindicação. A rotação a substitui por uma que não expira.

A reivindicação também substitui a `REBASE_SERVICE_KEY` do projeto, que possui privilégios de administrador
na API da própria aplicação e que o código implantado pelo agente podia ler. A aplicação
é reiniciada uma vez com uma nova chave, e tudo o que o agente guardou deixa de funcionar
assim que a reinicialização termina. Se um deploy estiver em execução no momento da reivindicação,
o deploy seguinte carregará a nova chave.

A reivindicação exige uma sessão autenticada no navegador, não um token, além de um método de pagamento
na organização para a qual o projeto for movido. A partir da reivindicação, o projeto é
faturado como qualquer outro. A reivindicação também revoga o token do agente: faça login com
`rebase cloud login` ou gere um novo token com `rebase cloud tokens create`.

O provisionamento sem conta é limitado por endereço, por rede (um IPv4
/24) e no total; um plano de controle que não tenha habilitado esse recurso recusará a operação
com uma mensagem informando isso. O consumo anterior à reivindicação não é faturado para quem
reivindicar o projeto.
