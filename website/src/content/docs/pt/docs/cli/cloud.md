---
sourceHash: 5e278801233fce19
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, vinculação de projeto, deploys, notificações, configuração, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Todo grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam a todos os lugares: `--json` para saída legível por máquina (também o
padrão quando em pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a
um plano de controle específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Autenticação

```bash
rebase cloud login      # sign in through the browser: a link and a code, approved in the console
rebase cloud login --no-browser   # print the link instead of opening it, e.g. over SSH
rebase cloud login --email me@example.com   # with your password instead
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` aceita `deploy`, `logs`, `env`, `database` e `backups` em um projeto
(`--project`, ou o vinculado), e `billing`, `audit` e
`notifications` em uma organização: `--org`, caso contrário a organização do projeto,
caso contrário a selecionada. Um token pode conter apenas permissões de organização.
`logs` também cobre `usage`. O que cada um alcança está em
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando o plano
de controle marca uma resposta a um token como obsoleta (um token anterior a `billing`
lendo faturamento), a CLI imprime o aviso uma vez no stderr, nunca no
valor `--json`.

Sem flags, `login` faz o login pelo navegador. Ele imprime um código curto e
um link para o console, abre o navegador e aguarda enquanto você aprova o
login lá. Você já deve estar conectado ao console ou faz o login com
qualquer método oferecido (senha, Google, GitHub, LinkedIn). Verifique se o
navegador exibe o mesmo código antes de aprová-lo. O link expira após dez
minutos e funciona apenas uma vez. Sem um terminal, ou com `--json`, o link e o código
vão para o stderr e `login` continua aguardando, para que um agente possa fornecer o link a você. Um
login negado sai com `access_denied`, e um expirado com `expired_token`.

Com `--email`, `login` pergunta se deseja usar sua senha ou um código que o plano
de controle envia por e-mail. Com a autenticação de dois fatores ativada, ele solicita o código do
seu autenticador (ou um código de recuperação); pelo navegador, aprove a partir de uma
sessão do console que a utilizou. Sem um terminal, nenhum dos códigos pode ser digitado: defina
`REBASE_TOKEN` com um token de acesso criado no console em Settings → Access
tokens. Consulte [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Vinculação de projeto

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Os comandos de organização (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) atuam sobre `--org <id>`, caso contrário sobre a
organização selecionada por `cloud use`, caso contrário sobre a organização do projeto vinculado.
Nesse último caso, eles informam qual foi usada. `orgs delete` nunca obtém da
vinculação: requer `--org` ou uma organização selecionada.

### Conectar uma instância auto-hospedada ao Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

O [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
então a alcança junto aos seus projetos Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; defina-os no
servidor e reinicie-o. Na pasta do projeto, ele oferece a opção de gravá-los no
`.env`. Executá-lo novamente é seguro. `--name` dá nome à instância, `--org` escolhe a
organização, `--no-wait` retorna sem esperar. Proprietários e administradores.

## Projetos

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects transfer [id] --to-org <id|slug>
rebase cloud projects delete [id]
```

`claim` imprime o link de reivindicação do projeto que `init --claim` provisionou neste
diretório e o tempo restante antes que ele seja excluído sem reivindicação (`Unclaimed: deleted
in 41h`). `--open` também o abre em um navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o plano de
controle armazena um hash dele e não pode imprimi-lo novamente. Antes de responder, `claim`
pergunta ao plano de controle se o próprio token do projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, uma vez que alguém tenha reivindicado o projeto, `claim` recusa
com `already_claimed` em vez de imprimir um link inativo. Ele também recusa quando a
janela termina (`claim_expired`), e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostram o mesmo
link enquanto o projeto não for reivindicado.

`projects transfer` move um projeto para outra organização, sem alterações: o
mesmo id, endereço, domínios personalizados, banco de dados, armazenamento, variáveis de ambiente e
deploys. Apenas quem é proprietário, quem pode vê-lo e quem paga por ele mudam. Você
deve ser proprietário ou administrador de ambas as organizações e estar autenticado com `rebase cloud login`;
um token de acesso não pode mover um projeto. O destino passa a ser faturado a partir de então,
portanto, uma organização sem cartão cadastrado (e não faturada internamente) recusa a transferência e
nada muda. Um projeto ainda aguardando para ser reivindicado é movido pelo seu link de reivindicação.
O console possui a mesma ação nas Settings do projeto, na zona de perigo.

## Deploy e observabilidade

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sem o nome de um app faz o deploy do backend. O deploy do bundle de um backend
também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma
atualização da plataforma possa reconstruí-lo; `--no-source` pula isso uma vez, e `cloud settings set
--platform-rebuilds off` desativa isso e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão anterior.

Uma atualização de plataforma pode reconstruir um app gerenciado em uma versão do `@rebasepro` mais recente
do que a fixada no seu checkout. Um deploy a partir desse checkout recolocaria o painel de administração
e o driver mais antigos, portanto, ele é recusado antes que qualquer coisa seja construída, com o
comando que corrige isso (`rebase upgrade --to <version>`). O `rebase cloud status`
informa a mesma coisa antecipadamente: uma linha `Rebuilt on`, e em `--json`,
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Um `deploy` acompanhado termina com um resumo: cada app enviado com sua URL, o
id da implantação, quanto tempo levou e se a nova versão responde lá. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` ignora a verificação) para que o
`/health` de um backend e o endereço de cada app estático respondam. Um deploy com falha
termina em uma linha informando o app e o motivo, e sai com código diferente de zero. O resumo
é impresso mesmo em pipe; `--json` (ou `REBASE_JSON=1`) imprime um objeto,
com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Um host cujo certificado HTTPS
ainda não foi emitido é reportado como não ativo (not live), com esse motivo.

Antes de fazer o upload, o `deploy` analisa o JavaScript de cada app estático que envia:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos `<script>` inline no
seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código
`syntax_error` no `--json`), e `--no-verify` pula a verificação. Um deploy bem-sucedido
termina indicando o caminho de volta, `rebase cloud rollback`. Um app estático implantado
isoladamente ainda não pode sofrer rollback; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza o build em `https://<project>--<name>.rebase.website` e
mantém a produção intacta. Uma pré-visualização (preview) do backend executa seu próprio backend, em um
banco de dados vazio próprio, com seus apps estáticos integrados. Um app estático ainda não pode
ser pré-visualizado isoladamente no Rebase Cloud: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Uma pré-visualização de backend
é faturada como uma unidade de app adicional no tamanho padrão enquanto existir, e
o deploy informa quanto isso custa por mês, com base na cotação do próprio plano de controle
(`cost` no `--json`; apenas a regra e este link quando o plano de controle não puder
precificar); `rebase cloud previews delete <name>` a interrompe. `rebase cloud previews`
mostra uma pré-visualização que a plataforma pausou (o banco de dados ultrapassou o limite de preview) como
`paused`, com o motivo (`statusMessage` no `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando o orçamento semanal de certificados de
preview da plataforma se esgotar; a mensagem informa até quando.
Consulte [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime o log do build mais recente, e `-f` acompanha um build que ainda
está em execução. `--runtime` lê o que o app imprime em tempo de execução, de cada pod
por trás dele, com cada linha identificada pelo seu pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário no formato RFC3339.
- `--tail <n>` é o número de linhas por pod a partir do qual iniciar (o plano de controle limita a 2000).
- `--grep` mantém as linhas que contêm o texto, sem diferenciar maiúsculas/minúsculas; use `/re/flags` para uma
  expressão regular.
- Com `--grep` ou `--level`, o filtro pesquisa em cada linha que o plano de controle
  retorna para a janela (as 2000 mais recentes de cada pod), e `--tail` conta as linhas
  correspondentes: as `n` correspondências mais recentes por pod, 500 por padrão. Quando um pod tiver mais
  linhas na janela do que isso, a saída informará que as mais antigas não foram
  pesquisadas (`filter.scanCapped` no `--json`).
- `--level error|warn|info|debug` mantém as linhas com essa severidade ou pior. Ele lê
  o campo estruturado `severity` registrado por um backend Rebase, uma palavra de nível no início de uma
  linha de texto simples ou um padrão de erro como `TypeError:`. Linhas sem isso são omitidas.

O acompanhamento contínuo faz sondagens a cada dois segundos e imprime cada linha uma vez. Ele anuncia pods
que iniciam, param ou reiniciam. Quando um contêiner reinicia, ele também imprime as últimas
linhas da instância encerrada, onde o motivo geralmente se encontra. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma conexão perdida, tenta novamente com backoff e
retoma de onde parou. Com `--json`, o acompanhamento imprime um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para o restante.

`--preview <name>` lê uma pré-visualização em vez da produção. Use o nome da
pré-visualização ou o id da implantação que o deploy de preview imprimiu. Sozinho, `--preview`
lê a única pré-visualização do projeto. Uma pré-visualização estática tem log de build, mas não
log de tempo de execução (runtime), porque não executa um servidor.

## Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` para um host que o projeto já possui, como um registrado por um deploy
a partir do `rebase.json`, imprime os registros DNS e o estado daquele host assim como uma
nova adição faz; `--json` adiciona `alreadyRegistered: true`. Um host verificado é
servido via HTTPS assim que seu certificado é emitido, alguns minutos após
a verificação. Até lá, o ingress responde com um certificado temporário,
e `domains list`, `domains verify` e `status` indicam
`verified, certificate pending` em vez de live. A CLI descobre isso com
um handshake TLS para cada host verificado; `--json` traz isso como `certificate`
(`ready`, `pending` ou `unreachable`, com um `reason`).

`app-key` lista a
chave que `rebase cloud init --claim` gerou no app e gravou no `.env` como
`REBASE_API_TOKEN`, pelo seu prefixo e nunca pelo seu valor. Reivindicar o projeto
transfere essa chave e ela deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agente anteriores de uma vez. Ela grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN` e a mantém fora do `--json` ali. Em
qualquer outro diretório, ela imprime a chave uma vez. As chaves criadas no painel de administração do app
não são afetadas. Executa com seu login: nenhuma permissão de token a concede.

`service-key`
imprime a geração da `REBASE_SERVICE_KEY` do projeto, quando ela foi rotacionada
pela última vez e se o app ainda está reiniciando para a versão mais recente. Nunca
imprime a chave: isso é feito por `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia o app com ela. A chave antiga funciona até que o
reinício seja concluído, e não mais depois disso. O comando é recusado enquanto um deploy estiver
em andamento, e é executado com seu login. Reivindicar um projeto também rotaciona sua service
key.

Uma pré-visualização de backend tem uma service key própria. Seu primeiro deploy a cria,
novos deploys a mantêm, e a chave de produção responde 401 na pré-visualização.
`service-key --preview <name>` a imprime, assim como `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
grava uma nova e reinicia apenas o pod dessa pré-visualização; a chave antiga funciona até
que o novo pod esteja pronto. Ele pergunta primeiro, e `--yes` ignora a confirmação. Ambos exigem
o que `env reveal` exige: o papel de proprietário ou administrador da organização e, para um
token de acesso, a permissão `env` em um projeto reivindicado. A chave e o
pod de produção não são alterados.

Uma pré-visualização de backend começa a partir das variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` define um valor próprio para as pré-visualizações, `env unset KEY
--preview` remove a variável delas, `env reset KEY --preview` restaura
o valor de produção e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum deles.

`env set KEY --stdin` lê o valor da entrada padrão em vez da
linha de comando, onde o `ps` e o histórico do shell o exibiriam:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma nova linha final é descartada. O `rebase_cloud_env_set` do servidor MCP define
valores dessa maneira.

`env set KEY --prompt` solicita o valor em um prompt oculto no seu terminal.
Nada é exibido na tela, e o valor é armazenado como um segredo, assim como em `--stdin
--secret`. Um agente pode fornecer a você o comando a ser executado, para que o valor nunca passe
pelo chat. Sem um terminal, ele recusa (`input_required`) e aponta
para `--stdin`.

## Organizações

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` adiciona alguém que já possui uma conta Rebase com um
endereço de e-mail verificado, assim como o botão Add member do console faz. A pessoa obtém acesso
imediatamente e nenhum e-mail é enviado. O Rebase Cloud ainda não envia convites, portanto, uma
pessoa sem conta não recebe link: o comando recusa com `no_account` e
solicita que ela se cadastre primeiro para depois executar o comando novamente. Um plano de controle que
suporta convites abre um e imprime seu link (uso único, válido por 7
dias, aceito apenas por uma conta que tenha verificado aquele endereço); `invites`
lista, revoga e reenvia esses convites, e responde `not_served` em outros casos.
`--role` pode ser `admin` ou `member` (padrão). Ninguém é adicionado como `owner`: adicione-os
como admin, e um owner os promove com `members role <email> owner`.
Adicionar membros e `invites` exige uma sessão de `rebase cloud login`;
`REBASE_TOKEN` é recusado. Ambos exigem a função de owner ou admin; um membro é informado
disso.
`members remove` pede confirmação primeiro (`--yes` ignora); remover ou rebaixar um owner
exige um owner, e o último owner permanece. `--org <id>` seleciona uma organização
diferente da selecionada.

`activity` é o registro de auditoria da organização selecionada, do mais recente para o mais antigo: quem
fez deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (por
nome, nunca por valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou a
função de um membro, ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa,
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída imprime o cursor `--before` para a próxima. `--json` retorna um valor,
`{ org, events, nextCursor }`. Exige a função de proprietário ou administrador da organização.
Um token só a lê com a permissão `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
mostra o mesmo registro.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint
público) até Ctrl-C; `--reveal` adiciona a senha. Apenas proprietário ou administrador.

## Convidados

Cada `signInAnonymously()` em um teste, bot ou visita abandonada deixa uma linha
nos usuários do projeto. Esses comandos contam essas linhas e as removem, para que
ninguém precise passar por elas uma a uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita uma idade com uma unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
apenas conta e não exclui nada. Ele processa projetos de qualquer tamanho em pequenos
lotes.

Apenas convidados podem ser removidos. Um convidado é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e o app aplica essa regra na instrução que exclui a
linha, portanto o comando não pode afetar uma conta, mesmo que ela tenha se cadastrado um instante
depois de ter sido listada. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Visto por último** (Last seen) é quando a sessão do convidado foi emitida ou atualizada pela última vez, ou quando
o convidado foi criado caso não tenha mais nenhum token de atualização. Um convidado que continua
retornando não é considerado antigo, não importa há quanto tempo tenha sido criado. Os tokens de atualização
e quaisquer outras linhas de autenticação de um convidado excluído são removidos junto com ele.

As linhas em suas próprias tabelas seguem sua chave estrangeira:

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo esvaziado |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o convidado junto: o convidado é informado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída junto com o convidado |
| Sem chave estrangeira (um campo `userSelect`, um id simples) | Mantida, contendo um id que não existe mais |

Verifique quais dos seus relacionamentos possuem cascade antes de passar `--yes`: isso não pode ser desfeito.

O comando passa pelo proxy do Studio do console, que contém a chave do app, de modo que a chave nunca chega à sua
máquina. Exige a função de proprietário ou administrador da organização, em um projeto cujo acesso ao Studio esteja ativado
(`rebase cloud settings set --studio on`). Um projeto em um runtime mais antigo é informado de que precisa de um mais novo.
`rebase users guests --project <slug>` é o mesmo comando na família do projeto.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
seria perda de dados causada por um push. A plataforma o mantém, vincula e fatura até que alguém
o remova pelo nome com prune.

## Computação

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` foi descontinuado: todo backend executa pelo menos uma instância, portanto
`true` é recusado e `false` é ignorado com um aviso. Não existem planos em
camadas: tudo é precificado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

## Armazenamento, notificações, clusters, faturamento e uso

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry | open | close   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` envia os eventos do projeto vinculado para uma URL. `--events`
aceita uma lista separada por vírgulas de `deploy.failed` (o padrão),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` envia
apenas `{ "text" }` em vez do JSON do evento, que também carrega um `text`. A URL
é um argumento posicional porque `--url` especifica o plano de controle. `add` imprime
o segredo de assinatura uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` sai com código 1 e `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem está aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem o papel de proprietário ou administrador. Um token os gerencia com a
permissão `notifications` na organização, dentro da mesma regra de papel. Consulte
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` fornece ao cluster
próprio de um cliente um registro de imagens exclusivo, usado apenas para esse cluster. Sem
ele, esse cluster usa o registro compartilhado da plataforma, e cada deploy para ele
indica isso em seu log. Com um registro próprio, os builds fazem push para esse repositório com um token dessa
conta, os pods fazem pull apenas com essa chave, e um rollback aceita as
imagens do projeto ali presentes. As imagens
que o projeto construiu anteriormente no repositório compartilhado continuam disponíveis para pull e permanecem
como alvos de rollback. Os três valores são usados em conjunto; `--clear` os remove. A chave
é selada ao ser gravada e nunca é lida de volta. Assim como o restante de `clusters`,
isso requer a função platform-admin. O operador cria o repositório e ambas
as contas com o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra a capacidade operada pelo Rebase: projetos
alocados em sua região são implantados lá assim que sua linha de base (baseline) estiver pronta. Isso não disponibiliza
a região para os clientes. `--open-to-customers` disponibiliza, no momento do registro, ou posteriormente com
`clusters open <id-or-name>`; `clusters close <id-or-name>` deixa de oferecê-la.
Os operadores podem fazer deploy em um cluster fechado. Mantenha um cluster fechado enquanto seu
domínio base for compartilhado com outro cluster: até que o registro curinga (wildcard) seja migrado, seus
hostnames serão resolvidos apenas por registros explícitos (`ingress.<baseDomain>`,
`s3.<baseDomain>` e um por projeto), e `clusters add` imprime quais registros
devem ser adicionados. Quando o domínio é compartilhado, `open` avisa que o registro curinga já deve
apontar para o cluster. Ele não pede confirmação, portanto funciona em scripts.

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console e estão disponíveis apenas para proprietários e administradores da
organização. Um token os acessa, assim como o restante de `billing`, com a permissão `billing`
na organização; um token criado antes dessa permissão continua
funcionando por uma versão, com um aviso a cada resposta. Os valores em `--json` estão na unidade fracionária da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a pré-visualização é calculada pelo
Stripe e suas linhas medidas continuam aumentando até o fechamento do período.

`usage` lê o que o projeto vinculado (ou `--project`) utilizou em um mês
calendário, em UTC: requisições em relação ao limite incluído, erros 5xx, o excedente
até o momento em euros e, para o mês em andamento, para onde está caminhando nesse
ritmo (uma estimativa). O excedente é o cálculo do próprio relatório de uso excedente,
aquele que informa ao Stripe o que cobrar, e é lançado na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use`, e o total. Qualquer membro da organização pode lê-lo. Um token o lê
com a permissão `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa permissão.
`--month` aceita um mês passado. A resposta inclui `caveats`, cada um com um `code`: `storage_not_measured`
(o armazenamento de objetos lê 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods de app estavam em execução não são contabilizadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (pods executados acima de `--replicas` e esta plataforma ainda não
os cobra). A resposta de um projeto com dimensionamento automático também traz `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` em suas tarifas, e `charged`.

## Deploy hooks, alertas e o restante

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms|requests_<surface>|errors_<surface>] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` é configurado por domínio e desativado por padrão, portanto um projeto que atende a um host `api.` além do seu site mantém ambos; ele entra em vigor quando o domínio é verificado e outro é o principal, e nunca se aplica a um domínio no qual um app é servido. `deploy-hooks create` imprime a URL do hook uma única vez. `deploy --git` não pode ser combinado com as flags de um build local e, no runtime gerenciado, requer `--eject`, pois o plano de controle compila a partir do código-fonte. `settings set --studio` é a opção que os comandos de projeto (`rebase data`, `rebase users`, …) precisam ativada para `--project`: eles acessam o app por meio do proxy do Studio no console. Um comando cuja rota no plano de controle ainda não foi implantada responde `not_served` e informa o nome da rota. Comandos destrutivos pedem confirmação primeiro e recusam com `confirmation_required` quando ninguém puder responder: use `--yes`.
