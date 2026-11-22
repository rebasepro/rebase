---
sourceHash: e7c1160ad556017c
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, vínculo de projeto, deploys, notificações, configuração, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculação.

Três opções se aplicam a todos os lugares: `--json` para saída legível por máquina (também o
padrão quando canalizado via pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a
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
(`--project`, ou no vinculado), e `billing`, `audit` e
`notifications` em uma organização: `--org`, caso contrário a organização do projeto,
caso contrário a selecionada. Um token pode conter apenas permissões de organização.
`logs` também cobre `usage`. O que cada uma alcança está em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents). Quando o plano de
controle marca uma resposta a um token como obsoleta (um token anterior a `billing`
lendo faturamento), a CLI imprime o aviso uma vez no stderr, nunca no
valor de `--json`.

Sem flags, o `login` autentica através do navegador. Ele imprime um código curto e
um link para o console, abre o navegador e aguarda enquanto você aprova o
login lá. Você já deve estar conectado ao console ou conectar-se usando
qualquer método oferecido (senha, Google, GitHub, LinkedIn). Verifique se o
navegador mostra o mesmo código antes de aprová-lo. O link expira após dez
minutos e funciona apenas uma vez. Sem um terminal, ou com `--json`, o link e o código
vão para o stderr e o `login` continua aguardando, para que um agente possa fornecer o link a você. Um
login negado encerra com `access_denied`, e um expirado com `expired_token`.

Com `--email`, o `login` pergunta se deseja usar sua senha ou um código enviado por e-mail pelo plano de
controle. Com a autenticação de dois fatores ativada, ele solicita o código do seu
autenticador (ou um código de recuperação); pelo navegador, aprove a partir de uma
sessão do console que o tenha utilizado. Sem um terminal, nenhum dos códigos pode ser digitado: defina
`REBASE_TOKEN` com um token de acesso criado no console em Settings → Access
tokens. Consulte [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Vínculo de projeto

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Os comandos de organização (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) atuam em `--org <id>`, caso contrário na
organização selecionada por `cloud use`, caso contrário na organização do projeto vinculado. Nesse
último caso, eles informam qual foi utilizada. O `orgs delete` nunca a obtém a partir
do vínculo: ele requer `--org` ou uma organização selecionada.

### Conectar uma instância auto-hospedada ao Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

O [conector do Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
passa então a alcançá-la ao lado dos seus projetos Cloud. O comando `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; defina-os no
servidor e reinicie-o. Na pasta do projeto, ele oferece a opção de gravá-los no
`.env`. Executá-lo novamente é seguro. `--name` define o nome da instância, `--org` escolhe a
organização, `--no-wait` retorna sem esperar. Apenas proprietários e administradores.

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
controle armazena um hash dele e não pode imprimi-lo novamente. Antes de responder, o `claim`
pergunta ao plano de controle se o próprio token do projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, uma vez que alguém reivindicou o projeto, o `claim` recusa
com `already_claimed` em vez de imprimir um link quebrado. Ele também recusa quando o
período expira (`claim_expired`) e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostram o mesmo
link enquanto o projeto não for reivindicado.

`projects transfer` move um projeto para outra organização, sem alterações: o
mesmo id, endereço, domínios personalizados, banco de dados, armazenamento, variáveis de ambiente e
deploys. Apenas quem o possui, quem pode vê-lo e quem paga por ele mudam. Você
deve ser proprietário ou administrador de ambas as organizações e estar autenticado com `rebase cloud login`;
um token de acesso não pode mover um projeto. O destino passa a ser faturado a partir de então,
portanto, uma organização sem cartão cadastrado (e não faturada internamente) recusará a transferência e
nada mudará. Um projeto que ainda aguarda para ser reivindicado é movido pelo seu link de reivindicação.
O console possui a mesma ação em Settings do projeto, na danger zone.

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

`deploy` sem o nome do aplicativo faz o deploy do backend. Um deploy de bundle
do backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma
atualização da plataforma possa recompilá-lo; `--no-source` ignora isso nessa execução, e `cloud settings set
--platform-rebuilds off` desativa essa função e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão anterior.

Uma atualização da plataforma pode reconstruir um aplicativo gerenciado em uma versão do `@rebasepro` mais recente
do que a fixada em seu checkout local. Um deploy a partir desse checkout recolocaria o painel de
administração e o driver mais antigos, portanto, ele é recusado antes que qualquer coisa seja construída, informando o
comando que corrige isso (`rebase upgrade --to <version>`). O `rebase cloud status`
informa a mesma coisa antecipadamente: uma linha `Rebuilt on` e, em `--json`,
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Um `deploy` acompanhado termina com um resumo: cada aplicativo enviado com sua URL, o
id do deployment, quanto tempo levou e se a nova versão responde lá. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` pula a verificação) para que o
`/health` do backend e o endereço de cada aplicativo estático respondam. Um deploy com falha
termina com uma única linha informando o aplicativo e o motivo, saindo com código diferente de zero. O resumo
é impresso mesmo via pipe; `--json` (ou `REBASE_JSON=1`) imprime um objeto,
com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Um host cujo certificado
HTTPS ainda não foi emitido é reportado como não ativo (not live), com esse motivo.

Antes de fazer o upload, o `deploy` analisa o JavaScript de cada aplicativo estático enviado:
os arquivos `.js`/`.mjs`/`.cjs` em seu diretório `output` e os blocos `<script>` inline em
seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código
`syntax_error` sob `--json`), e `--no-verify` ignora a verificação. Um deploy bem-sucedido
termina informando o caminho de retorno, `rebase cloud rollback`. Um aplicativo estático implantado
individualmente ainda não pode sofrer rollback; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza o build em `https://<project>--<name>.rebase.website` e
não altera a produção. Uma prévia do backend executa seu próprio backend, em um
banco de dados vazio exclusivo, com seus aplicativos estáticos integrados. Um aplicativo estático não pode ser
pré-visualizado isoladamente no Rebase Cloud ainda: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Uma prévia do backend
é faturada como mais uma unidade de aplicativo no tamanho padrão enquanto existir, e
o deploy informa quanto isso custará por mês, de acordo com o orçamento do próprio plano de controle
(`cost` sob `--json`; apenas a regra e este link quando o plano de controle não puder
calcular o preço); `rebase cloud previews delete <name>` encerra a prévia. `rebase cloud previews`
mostra uma prévia pausada pela plataforma (seu banco de dados ultrapassou o limite de prévia) como
`paused`, com o motivo (`statusMessage` sob `--json`). Um novo endereço de prévia
pode ser recusado com `preview_cert_budget` quando o orçamento semanal de
certificados de prévia da plataforma for esgotado; a mensagem informa até quando.
Consulte [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime o log de build mais recente, e `-f` acompanha um build que
ainda esteja em execução. `--runtime` lê o que o aplicativo imprime, de cada pod
por trás dele, com cada linha identificada por seu pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário RFC3339.
- `--tail <n>` indica as linhas por pod a partir das quais iniciar (o plano de controle limita a 2000).
- `--grep` mantém as linhas que contêm o texto, sem diferenciar maiúsculas/minúsculas; use `/re/flags` para uma
  expressão regular.
- Com `--grep` ou `--level`, o filtro pesquisa todas as linhas retornadas pelo plano de controle
  para a janela (as 2000 mais recentes de cada pod), e `--tail` conta as linhas correspondentes:
  as `n` correspondências mais recentes por pod, 500 por padrão. Quando um pod tiver mais
  linhas na janela do que isso, a saída informará que as mais antigas não foram
  pesquisadas (`filter.scanCapped` sob `--json`).
- `--level error|warn|info|debug` mantém as linhas nessa severidade ou superior. Ele lê
  o campo estruturado `severity` registrado pelo backend do Rebase, uma palavra de nível no início de uma
  linha simples ou um padrão de erro como `TypeError:`. Linhas sem isso são omitidas.

O acompanhamento faz polling a cada dois segundos e imprime cada linha uma única vez. Ele anuncia pods
que iniciam, param ou reiniciam. Quando um container reinicia, ele também imprime as últimas
linhas da instância encerrada, onde o motivo geralmente se encontra. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma queda de conexão, tenta novamente com backoff e
retoma de onde parou. Com `--json`, o acompanhamento imprime um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para os demais eventos.

`--preview <name>` lê uma prévia em vez da produção. Use o nome da
prévia ou o id do deployment impresso no deploy da prévia. Sozinho, `--preview`
lê a única prévia do projeto. Uma prévia estática tem log de build, mas nenhum
log de runtime, pois não executa um servidor.

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
a partir do `rebase.json`, imprime os registros DNS e o estado daquele host da mesma forma que
uma nova adição faz; `--json` adiciona `alreadyRegistered: true`. Um host verificado é
servido por HTTPS assim que seu certificado é emitido, alguns minutos após a
verificação. Até lá, o ingress responde com um certificado temporário,
e `domains list`, `domains verify` e `status` indicam
`verified, certificate pending` em vez de live. A CLI identifica isso através de
um handshake TLS com cada host verificado; `--json` traz essa informação em `certificate`
(`ready`, `pending` ou `unreachable`, com um `reason`).

`app-key` lista a chave
que `rebase cloud init --claim` gerou no aplicativo e gravou no `.env` como
`REBASE_API_TOKEN`, exibindo seu prefixo e nunca seu valor. Ao reivindicar o projeto,
essa chave é transferida e deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agente anteriores de uma só vez. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN` e a omite do `--json` nesse caso. Em
qualquer outro diretório, ele imprime a chave uma vez. As chaves criadas no painel de administração do aplicativo
não são afetadas. Ele é executado com seu login: nenhuma permissão de token o autoriza.

`service-key`
imprime a geração da `REBASE_SERVICE_KEY` do projeto, quando foi rotacionada pela última vez
e se o aplicativo ainda está reiniciando para carregar a mais recente. Ele nunca
imprime a chave: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia o aplicativo com ela. A chave antiga funciona até que o
reinício tenha terminado, e deixa de funcionar depois. Esse comando é recusado enquanto um deploy estiver em
execução, e roda com o seu login. Reivindicar um projeto também rotaciona sua service
key.

Uma prévia de backend tem uma service key própria. Seu primeiro deploy a cria,
novos deploys a mantêm, e a chave de produção retorna 401 na prévia.
`service-key --preview <name>` a imprime, assim como `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
grava uma nova e reinicia apenas o pod daquela prévia; a chave antiga funciona até que
o novo pod esteja pronto. Ele pede confirmação primeiro, e `--yes` pula a pergunta. Ambos exigem
o mesmo que `env reveal`: a função de owner ou admin da organização e, para um
token de acesso, a permissão `env` em um projeto reivindicado. A chave e o
pod de produção não são tocados.

Uma prévia de backend começa com as variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` define valores próprios para prévias, `env unset KEY
--preview` remove a variável delas, `env reset KEY --preview` restaura
o valor de produção, e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum deles.

`env set KEY --stdin` lê o valor a partir da entrada padrão em vez da
linha de comando, onde `ps` e o histórico do seu shell o exporiam:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é descartada. A ferramenta `rebase_cloud_env_set` do servidor MCP define
valores dessa maneira.

`env set KEY --prompt` solicita o valor em um prompt oculto no seu terminal.
Nada é exibido na tela, e o valor é armazenado como um secret, como em `--stdin
--secret`. Um agente pode fornecer o comando para você executar, de modo que o valor nunca passe
pelo chat. Sem um terminal, ele recusa (`input_required`) e sugere o uso de `--stdin`.

## Organizações

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` adiciona alguém que já possui uma conta Rebase com um
endereço de e-mail verificado, assim como a opção Add member do console faz. A pessoa obtém acesso
imediatamente e nenhum e-mail é enviado. O Rebase Cloud ainda não envia convites por e-mail, portanto, uma
pessoa sem conta não recebe link: o comando recusa com `no_account` e
pede que você solicite o cadastro prévio dela para depois executar o comando novamente. Um plano de controle que
ofereça convites cria um e imprime seu link (uso único, válido por 7
dias, aceito apenas por uma conta que tenha verificado aquele endereço); `invites`
lista, revoga e reenvia esses convites, e responde `not_served` em outros casos.
`--role` pode ser `admin` ou `member` (padrão). Ninguém é adicionado como `owner`: adicione
como admin, e um owner pode promover o usuário com `members role <email> owner`.
Adicionar membros e `invites` exigem uma sessão ativa de `rebase cloud login`;
`REBASE_TOKEN` é recusado. Ambos requerem o papel de owner ou admin; um membro é avisado
disso.
`members remove` pede confirmação primeiro (`--yes` pula); remover ou rebaixar um owner
exige privilégios de owner, e o último owner permanece. `--org <id>` seleciona uma organização
diferente da selecionada atualmente.

### Acesso ao projeto

<span class="since-badge" data-since="0.35">Desde 0.35</span>

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` gerencia quem acessa um projeto específico, o vinculado ou `--project`. Os
proprietários e administradores de uma organização são `admin` em todos os projetos que ela possui e seus
membros são `developer`; `access` concede uma função a alguém exclusivamente neste projeto,
independentemente de pertencer ou não à organização. A função efetiva do usuário é a
mais alta entre as duas, e `access` a lista com sua origem. `admin` tem acesso a
tudo, incluindo controle de acesso e configurações; `developer` faz deploys e utiliza o Studio,
logs e o ambiente; `viewer` tem permissão apenas de leitura.

`invite` cria um convite para o projeto (`--role` tem como padrão `developer`)
e imprime seu link: uso único, válido por 7 dias, aceito apenas por uma conta
que tenha verificado aquele endereço. `role` e `remove` alteram ou removem a
função própria do projeto e pedem confirmação primeiro (`--yes` pula); alguém que acessa o
projeto por meio da organização é removido com `orgs members remove`.
Perder o papel de `admin` em um projeto também revoga a função de `admin` concedida
por **Open admin panel** àquela pessoa dentro do aplicativo e encerra suas sessões nele. Qualquer
alteração requer uma sessão ativa de `rebase cloud login` e papel de `admin` no projeto; um
plano de controle sem suporte a acesso por projeto responde `not_served`.

`activity` é o log de auditoria da organização selecionada, do mais recente ao mais antigo: quem
fez deploy, rollback, definiu, removeu ou revelou uma variável de ambiente (por
nome, nunca por valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou a
função de um membro ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída imprime o cursor `--before` para a próxima página. `--json` retorna um único valor,
`{ org, events, nextCursor }`. Exige a função de owner ou admin da organização.
Um token só tem permissão de leitura com a capability `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
exibe o mesmo log.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint
público) até Ctrl-C; `--reveal` adiciona a senha. Apenas owner ou admin.

## Guests

Cada `signInAnonymously()` em um teste, bot ou visita abandonada deixa uma linha
na tabela de usuários do projeto. Esses comandos contam essas linhas e as removem, para que
ninguém precise passar por elas uma a uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita um período com unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
apenas conta e não exclui nada. Ele processa um projeto de qualquer tamanho em pequenos
lotes.

Apenas guests podem ser removidos. Um guest é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e o aplicativo aplica essa regra na instrução que exclui a
linha, de modo que o comando não possa atingir uma conta real, mesmo uma que tenha se registrado momentos
após a listagem. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Last seen** é quando a sessão do guest foi emitida ou atualizada pela última vez, ou quando
o guest foi criado, caso não reste nenhum refresh token. Um guest que continua retornando
não é considerado antigo, independentemente de quando foi criado. Os refresh tokens de um guest excluído
e quaisquer outras linhas de autenticação são removidos com ele.

As linhas nas suas próprias tabelas seguem a chave estrangeira:

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo limpo |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o guest junto com ela: o guest é reportado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída junto com o guest |
| Sem chave estrangeira (um campo `userSelect`, um id simples) | Mantida, contendo um id que não existe mais |

Verifique quais dos seus vínculos possuem exclusão em cascata antes de passar `--yes`: essa ação não pode ser desfeita.

O comando passa pelo proxy do Studio no console, que mantém a chave do aplicativo, portanto a chave nunca chega à sua
máquina. Ele exige a função de owner ou admin da organização, em um projeto cujo acesso ao Studio esteja ativado
(`rebase cloud settings set --studio on`). Um projeto em um runtime mais antigo é informado de que precisa de uma versão mais nova.
`rebase users guests --project <slug>` é o mesmo comando na família de comandos do projeto.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
seria apagar dados com um push. A plataforma o mantém, vincula e fatura até que alguém
o remova pelo nome.

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
`true` é recusado e `false` é ignorado com um aviso. Não há planos
em camadas: tudo é tarifado por recurso. Consulte
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
`{ "text" }` isolado em vez do JSON do evento, que também contém um campo `text`. A URL
é um argumento posicional porque `--url` especifica o plano de controle. `add` imprime
o segredo de assinatura uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` encerra com código 1 e `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem é aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem a função de owner ou admin. Um token os gerencia com a
capability `notifications` na organização, sob a mesma regra de função. Consulte
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` fornece ao cluster
próprio do cliente um registro de imagens exclusivo, utilizado somente para aquele cluster. Sem
ele, esse cluster usa o registro compartilhado da plataforma, e cada deploy nele
informa isso em seu log. Com ele, os builds realizam push para esse repositório com um token dessa
conta, os pods realizam pull exclusivamente com essa chave, e um rollback aceita as
imagens do projeto localizadas lá. Imagens
que o projeto compilou anteriormente no repositório compartilhado continuam disponíveis para pull e continuam
sendo alvos de rollback. Os três valores devem ser passados juntos; `--clear` os remove. A chave
é selada quando gravada e nunca mais é lida de volta. Assim como o restante de `clusters`,
exige a função de platform-admin. O operador cria o repositório e ambas as
contas com Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra capacidade operada pela Rebase: projetos
alocados em sua região são implantados lá assim que sua linha de base estiver pronta. Ele não disponibiliza
a região aos clientes. `--open-to-customers` faz isso, no momento do registro, ou posteriormente com
`clusters open <id-or-name>`; `clusters close <id-or-name>` deixa de oferecê-la.
Operadores podem fazer deploy em um cluster fechado. Mantenha um cluster fechado enquanto seu
domínio base for compartilhado com outro cluster: até que o registro curinga seja migrado, seus
hostnames são resolvidos apenas através de registros explícitos (`ingress.<baseDomain>`,
`s3.<baseDomain>` e um por projeto), e `clusters add` exibe quais registros
adicionar. Quando o domínio é compartilhado, `open` avisa que o registro wildcard já deve
estar apontando para o cluster. Ele não pede confirmação, portanto funciona em scripts.

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console e estão disponíveis apenas para owners e admins da organização.
Um token pode acessá-los, e ao restante de `billing`, com a
capability `billing` na organização; um token criado antes dessa capability continua
funcionando por uma versão, com um aviso a cada resposta. Os valores em `--json` estão na unidade fracionária da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a prévia é calculada pelo
Stripe e suas linhas medidas continuam aumentando até o encerramento do período.

`usage` lê o que o projeto vinculado (ou `--project`) consumiu em um mês
calendário, em UTC: requisições em relação ao limite incluído, erros 5xx, o excedente
até o momento em euros e, para o mês em andamento, a projeção nesse
ritmo (uma estimativa). O excedente é o cálculo do próprio relatório de excedentes, aquele
que informa ao Stripe o que cobrar, e entra na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use` e o total. Qualquer membro da organização pode lê-lo. Um token pode lê-lo
com a capability `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa permissão.
`--month` aceita um mês anterior. A resposta inclui `caveats`, cada um com um `code`: `storage_not_measured`
(o armazenamento de objetos registra 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods do aplicativo estão em execução não são contabilizadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (pods executados acima de `--replicas` e esta plataforma ainda não os
cobra). A resposta de um projeto com dimensionamento automático também traz `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` em suas respectivas taxas, e `charged`.

## Deploy hooks, alertas e outros

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

`domains redirect` é configurado por domínio e desativado por padrão, portanto um projeto que atende a um host `api.` ao lado de seu site mantém ambos; tem efeito enquanto o domínio estiver verificado e outro for o principal, e nunca se aplica a um domínio em que um aplicativo é servido. `deploy-hooks create` imprime a URL do hook uma única vez. `deploy --git` não pode ser combinado com as flags de um build local e, no runtime gerenciado, requer `--eject`, porque o plano de controle compila a partir do código-fonte. `settings set --studio` é a chave que os comandos de projeto (`rebase data`, `rebase users`, …) precisam que esteja ativada para `--project`: eles acessam o aplicativo por meio do proxy do Studio no console. Um comando cuja rota no plano de controle ainda não foi implantada responde com `not_served` e informa seu nome. Comandos destrutivos pedem confirmação primeiro e recusam com `confirmation_required` quando ninguém puder responder: passe `--yes`.
