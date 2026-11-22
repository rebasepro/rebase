---
sourceHash: 8ba7c94e0a895b48
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, vinculação de projeto, deploys, notificações, configurações, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculação.

Três opções se aplicam a todos os comandos: `--json` para saída legível por máquina (também o
padrão quando em pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a
um control plane específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Auth

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
`logs` também cobre `usage`. O alcance de cada uma está em
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando o control
plane marca uma resposta para um token como obsoleta (um token anterior a `billing`
lendo faturamento), a CLI exibe o aviso uma vez no stderr, nunca no
valor `--json`.

Sem flags, `login` faz a autenticação pelo navegador. Ele exibe um código curto e
um link para o console, abre o navegador e aguarda enquanto você aprova o
login lá. Você já estará conectado ao console ou fará login com
qualquer método disponível (senha, Google, GitHub, LinkedIn). Verifique se o
navegador mostra o mesmo código antes de aprová-lo. O link expira após dez
minutos e funciona apenas uma vez. Sem um terminal, ou com `--json`, o link e o código
vão para o stderr e o `login` continua aguardando, permitindo que um agente passe o link para você. Um
login negado termina com `access_denied`, e um expirado com `expired_token`.

Com `--email`, o `login` pergunta se deseja usar sua senha ou um código enviado por e-mail pelo control
plane. Com a autenticação de dois fatores ativada, ele solicita o código do seu
aplicativo autenticador (ou um código de recuperação); pelo navegador, aprove a partir de uma
sessão do console que a utilizou. Sem um terminal, nenhum dos códigos pode ser digitado: defina
`REBASE_TOKEN` como um token de acesso criado no console em Settings → Access
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
`projects create`, `tokens create --can billing`) atuam em `--org <id>`, caso contrário na
organização selecionada por `cloud use`, caso contrário na organização do projeto vinculado. Nesse
último caso, eles informam qual foi utilizada. `orgs delete` nunca a obtém a partir
do vínculo: ele requer `--org` ou uma organização selecionada.

### Conectar uma instância auto-hospedada ao Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

O [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
então a acessa juntamente com seus projetos Cloud. `connect` exibe
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; defina-as no
servidor e reinicie-o. Na pasta do projeto, ele oferece gravá-las no
`.env`. Executá-lo novamente é seguro. `--name` nomeia a instância, `--org` escolhe a
organização, `--no-wait` retorna sem aguardar. Proprietários e administradores.

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

`claim` exibe o link de reivindicação do projeto provisionado por `init --claim` neste
diretório, e o tempo restante antes de ser excluído sem reivindicação (`Unclaimed: deleted
in 41h`). `--open` também o abre no navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o control
plane armazena um hash dele e não pode exibi-lo novamente. Antes de responder, `claim`
pergunta ao control plane se o próprio token do projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, quando alguém reivindica o projeto, `claim` recusa
com `already_claimed` em vez de exibir um link quebrado. Ele também recusa quando o
período expira (`claim_expired`), e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostram o mesmo
link enquanto o projeto não for reivindicado.

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

`deploy` sem o nome de uma aplicação faz o deploy do backend. Um deploy do
bundle de backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma
atualização da plataforma possa recompilá-lo; `--no-source` ignora isso uma vez, e `cloud settings set
--platform-rebuilds off` desativa isso e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão mais antiga.

Uma atualização da plataforma pode recompilar um app gerenciado em uma versão do `@rebasepro` mais recente
do que a fixada no seu checkout. Um deploy a partir desse checkout recolocaria o painel de
administração e o driver mais antigos, portanto ele é recusado antes de qualquer compilação ser iniciada, com o
comando que corrige o problema (`rebase upgrade --to <version>`). O comando `rebase cloud status`
informa isso com antecedência: uma linha `Rebuilt on` e, em `--json`,
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Um `deploy` acompanhado termina com um resumo: cada app implantado com sua URL, o
id do deployment, quanto tempo levou e se a nova versão está respondendo naquele endereço. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` ignora a verificação) para que o `/health`
do backend e o endereço de cada app estático respondam. Um deploy com falha
termina em uma linha informando o app e o motivo, e sai com código diferente de zero. O resumo
é exibido mesmo quando redirecionado por pipe; `--json` (ou `REBASE_JSON=1`) exibe um único objeto,
com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Um host cujo certificado
HTTPS ainda não foi emitido é relatado como não ativo, com esse motivo.

Antes de fazer o upload, o `deploy` analisa o JavaScript de cada app estático implantado:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos `<script>` inline no
seu HTML. Um erro de sintaxe interrompe o deploy indicando `arquivo:linha:coluna` (código
`syntax_error` em `--json`), e `--no-verify` pula a verificação. Um deploy bem-sucedido
termina exibindo a forma de revertê-lo, `rebase cloud rollback`. Um app estático implantado
isoladamente ainda não pode ser revertido; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza a compilação em `https://<project>--<name>.rebase.website` e
mantém a produção intacta. Uma pré-visualização (preview) do backend executa seu próprio backend, em um
banco de dados próprio vazio, com seus apps estáticos integrados. Um app estático ainda não pode ser
pré-visualizado de forma isolada no Rebase Cloud: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Uma pré-visualização
de backend é faturada como mais uma unidade de app no tamanho padrão enquanto existir, e
o deploy informa quanto isso custará por mês, de acordo com o orçamento do próprio control plane
(`cost` em `--json`; apenas a regra e este link caso o control plane não consiga
precificá-la); `rebase cloud previews delete <name>` a encerra. `rebase cloud previews`
mostra uma pré-visualização que a plataforma pausou (o banco de dados ultrapassou o limite de preview) como
`paused`, com o motivo (`statusMessage` em `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando a cota semanal de certificados de preview da
plataforma for esgotada; a mensagem informa até quando.
Consulte [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` exibe o log de compilação mais recente, e `-f` acompanha em tempo real um build que
ainda está em execução. `--runtime` lê o que a aplicação imprime, a partir de cada pod
por trás dela, com cada linha identificada pela tag do pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário RFC3339.
- `--tail <n>` é a quantidade de linhas por pod a partir da qual começar (o control plane limita a 2000).
- `--grep` mantém as linhas que contêm o texto, sem distinção de maiúsculas/minúsculas; use `/re/flags` para uma
  expressão regular.
- Com `--grep` ou `--level`, o filtro pesquisa em todas as linhas retornadas pelo control plane
  para o intervalo (as 2000 mais recentes de cada pod), e `--tail` conta as linhas
  correspondentes: as `n` correspondências mais recentes por pod, 500 por padrão. Quando um pod tiver mais
  linhas no intervalo do que isso, a saída indicará que as mais antigas não foram
  pesquisadas (`filter.scanCapped` em `--json`).
- `--level error|warn|info|debug` mantém as linhas com essa severidade ou pior. Ele lê
  a propriedade estruturada `severity` registrada pelo backend do Rebase, uma palavra de nível no início de uma
  linha simples ou um formato de erro como `TypeError:`. Linhas sem isso são omitidas.

Um acompanhamento contínuo (`follow`) consulta a cada dois segundos e exibe cada linha uma vez. Ele notifica pods
que iniciam, param ou reiniciam. Quando um contêiner reinicia, ele também exibe as últimas
linhas da instância encerrada, onde o motivo geralmente se encontra. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma queda de conexão, tenta novamente com backoff e
retoma de onde parou. Com `--json`, o acompanhamento exibe um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para os demais eventos.

`--preview <name>` lê uma pré-visualização em vez da produção. Use o nome
da preview ou o id do deployment exibido no deploy da preview. Usado sozinho, `--preview`
lê a única preview do projeto. Uma preview estática possui log de build, mas nenhum
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

`domains add` para um host que o projeto já possui, como um registrado pelo
deploy a partir de `rebase.json`, exibe os registros DNS e o status desse host como
em uma nova adição; `--json` inclui `alreadyRegistered: true`. Um host verificado é
servido via HTTPS assim que seu certificado for emitido, alguns minutos após a
verificação. Até lá, o ingress responde com um certificado temporário,
e `domains list`, `domains verify` e `status` exibem
`verified, certificate pending` em vez de ativo. A CLI detecta isso realizando
um handshake TLS em cada host verificado; `--json` retorna essa informação como `certificate`
(`ready`, `pending` ou `unreachable`, acompanhado de um `reason`).

`app-key` lista a
chave que `rebase cloud init --claim` gerou na aplicação e gravou em `.env` como
`REBASE_API_TOKEN`, pelo seu prefixo e nunca pelo seu valor. Reivindicar o projeto
transfere essa chave e ela deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agentes anteriores de uma só vez. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN`, e a mantém fora do `--json` nesse caso. Em
qualquer outro diretório, ele exibe a chave uma vez. As chaves criadas no painel de administração da aplicação
não são afetadas. Esse comando é executado com o seu login: nenhuma permissão de token a concede.

`service-key`
exibe a geração da `REBASE_SERVICE_KEY` do projeto, quando ela foi rotacionada pela última
vez e se a aplicação ainda está reiniciando para a versão mais recente. Ele nunca
exibe a chave: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia a aplicação com ela. A chave antiga funciona até que o
reinício seja concluído, deixando de funcionar em seguida. O comando é recusado enquanto um deploy estiver
em andamento e é executado com o seu login. Reivindicar um projeto também rotaciona sua service
key.

Uma pré-visualização de backend tem sua própria service key. O seu primeiro deploy a cria,
novos deploys a mantêm, e a chave de produção responde com 401 na preview.
`service-key --preview <name>` a exibe, assim como `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
grava uma nova e reinicia apenas o pod dessa preview; a chave antiga funciona até que
o novo pod esteja pronto. O comando pede confirmação antes, e `--yes` pula a pergunta. Ambos exigem
o mesmo que `env reveal`: a função de owner ou admin da organização e, no caso de um
token de acesso, a capability `env` em um projeto reivindicado. A chave e o
pod de produção não são afetados.

Uma pré-visualização de backend começa a partir das variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` atribui um valor próprio às previews, `env unset KEY
--preview` remove a variável delas, `env reset KEY --preview` restaura
o valor de produção, e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum desses comandos.

`env set KEY --stdin` lê o valor da entrada padrão em vez da
linha de comando, onde `ps` e o histórico da sua shell o mostrariam:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é descartada. O `rebase_cloud_env_set` do servidor MCP define
valores dessa maneira.

`env set KEY --prompt` solicita o valor em um prompt oculto no seu terminal.
Nada é exibido na tela, e o valor é armazenado como um secret, assim como em `--stdin
--secret`. Um agente pode fornecer o comando para você executar, garantindo que o valor nunca passe
pelo chat. Sem um terminal, o comando é recusado (`input_required`) e sugere o uso de `--stdin`.

## Organizações

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` adiciona alguém que já possui uma conta Rebase com um
endereço de e-mail verificado, assim como faz a opção Add member do console. Essa pessoa tem acesso
imediato e nenhum e-mail é enviado. O Rebase Cloud ainda não envia convites, portanto uma
pessoa sem conta não recebe link: o comando recusa com `no_account` e
pede para que ela se cadastre primeiro, para então executar o comando novamente. Um control plane que
suporta convites abre um convite e exibe o respectivo link (uso único, válido por 7
dias, aceito apenas por uma conta que tenha verificado esse endereço); `invites`
lista, revoga e reenvia esses convites, e responde `not_served` em outros casos.
`--role` pode ser `admin` ou `member` (padrão). Ninguém é adicionado como `owner`: adicione
a pessoa como admin, e um owner pode promovê-la com `members role <email> owner`.
Adicionar membros e usar `invites` requer uma sessão ativa de `rebase cloud login`;
`REBASE_TOKEN` é recusado. Ambos exigem a função de owner ou admin; membros comuns recebem
um aviso a esse respeito.
`members remove` pede confirmação antes (`--yes` pula a pergunta); remover ou rebaixar um owner
exige permissão de owner, e o último owner permanece. `--org <id>` seleciona uma organização
diferente da selecionada atualmente.

`activity` é o log de auditoria da organização selecionada, do mais recente ao mais antigo: quem
fez deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (por
nome, nunca pelo valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou o
papel de um membro, ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Uma página contém até 100 entradas (`--limit`, padrão 50); a
saída exibe o cursor `--before` para a próxima página. `--json` é um único valor,
`{ org, events, nextCursor }`. Exige a função de owner ou admin da organização.
Um token só tem permissão de leitura com a capability `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
mostra o mesmo log.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem
endpoint público) até Ctrl-C; `--reveal` adiciona a senha. Apenas owner ou admin.

## Guests

Cada `signInAnonymously()` em um teste, um bot ou uma visita abandonada deixa uma linha
na tabela de usuários do projeto. Esses comandos contam essas linhas e as removem, para
que ninguém precise excluí-las uma a uma manualmente.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita um período com uma unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
apenas conta e não exclui nada. Ele processa projetos de qualquer tamanho em pequenos
lotes.

Apenas guests podem ser removidos. Um guest é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e a aplicação aplica essa regra na instrução que exclui a
linha, de modo que o comando não consegue afetar uma conta regular, mesmo uma criada instantes
após ser listada. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Last seen** é quando a sessão do guest foi emitida ou atualizada pela última vez, ou quando
o guest foi criado, caso não tenha mais nenhum token de atualização. Um guest que continua retornando
não é considerado antigo, independentemente de quando foi criado. Os refresh tokens
de um guest excluído e quaisquer outras linhas de autenticação são removidos com ele.

As linhas nas suas próprias tabelas seguem a chave estrangeira delas:

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo esvaziado |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o guest junto: o guest é informado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída junto com o guest |
| Sem chave estrangeira (um campo `userSelect`, um id simples) | Mantida, contendo um id que não existe mais |

Verifique quais dos seus vínculos têm exclusão em cascata antes de passar `--yes`: essa ação não pode ser desfeita.

O comando passa pelo proxy do Studio no console, que detém a chave da aplicação, de forma que a chave nunca chega à sua
máquina. Ele exige a função de owner ou admin da organização, em um projeto cujo acesso ao Studio esteja ativado
(`rebase cloud settings set --studio on`). Um projeto em um runtime mais antigo é informado de que precisa de uma versão mais recente.
`rebase users guests --project <slug>` é o mesmo comando na família de projetos.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
seria perda de dados causada por um push. Ele o mantém, vincula e fatura até que alguém
o remova com o prune por nome.

## Computação

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` foi descontinuado: todo backend executa pelo menos uma instância, então
`true` é recusado e `false` é ignorado com um aviso. Não existem planos
em camadas: tudo é precificado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

## Armazenamento, notificações, clusters, faturamento e uso

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry   # the clusters tenants run on; `add` registers one from a kubeconfig
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
apenas `{ "text" }` em vez do JSON do evento, que também contém um campo `text`. A URL
é um argumento posicional porque `--url` especifica o control plane. `add` exibe
o signing secret uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` encerra com código 1 e `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem está aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem a função de owner ou admin. Um token pode gerenciá-los com a
capability `notifications` na organização, sob a mesma regra de função. Consulte
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` fornece ao cluster próprio
do cliente um registro de imagens dedicado, usado exclusivamente para aquele cluster. Sem
ele, esse cluster usa o registro compartilhado da plataforma, e cada deploy para ele
informa isso em seu log. Com ele, os builds fazem push para aquele repositório usando um token
dessa conta, os pods fazem pull apenas com essa chave, e um rollback aceita as
imagens do projeto existentes lá. Imagens
que o projeto compilou anteriormente no repositório compartilhado continuam disponíveis para pull e
permanecem como alvos de rollback. Os três valores devem ser fornecidos juntos; `--clear` os remove. A chave
é selada quando gravada e nunca é lida de volta. Assim como o restante de `clusters`,
exige a função platform-admin. O operador cria o repositório e ambas as
contas com o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console e estão disponíveis apenas para owners e admins da
organização. Um token tem acesso a eles, e ao restante de `billing`, com a capability
`billing` na organização; um token criado antes dessa capability continua
funcionando por mais uma versão, exibindo um aviso em cada resposta. Os valores em `--json` estão na menor unidade da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a pré-visualização é calculada pelo
Stripe e suas linhas medidas continuam aumentando até o fechamento do período.

`usage` lê o que o projeto vinculado (ou `--project`) utilizou em um mês
calendário, em UTC: requisições em relação à cota inclusa, erros 5xx, o excedente
acumulado até o momento em euros e, para o mês em andamento, a projeção nesse
ritmo (uma estimativa). O excedente é o cálculo do próprio relatório de excedentes,
aquele que informa ao Stripe o que faturar, constando na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use`, junto com o total. Qualquer membro da organização pode visualizá-lo. Um token pode
lê-lo com a capability `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa permissão.
`--month` aceita um mês anterior. A resposta inclui `caveats`, cada um com um `code`: `storage_not_measured`
(o object storage retorna 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods do app estão em execução não são contabilizadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (pods executados acima de `--replicas` e esta plataforma ainda não os
cobra). A resposta de um projeto com autoscaling também inclui `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` de acordo com as taxas aplicáveis e `charged`.

## Deploy hooks, alertas e demais comandos

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

`domains redirect` funciona por domínio e fica desativado por padrão, portanto um projeto que atende a um host `api.` além do seu site mantém ambos; ele entra em vigor quando o domínio está verificado e outro domínio é definido como primário, e nunca se aplica a um domínio onde uma aplicação está sendo servida. `deploy-hooks create` exibe a URL do hook uma única vez. `deploy --git` não pode ser combinado com as flags de um build local e, no runtime gerenciado, exige `--eject`, pois o control plane compila a partir do código-fonte. `settings set --studio` é a opção que os comandos do projeto (`rebase data`, `rebase users`, …) precisam ativada para `--project`: eles acessam a aplicação por meio do proxy do Studio no console. Um comando cuja rota no control plane ainda não foi implantada responde com `not_served` e informa o nome da rota. Comandos destrutivos pedem confirmação prévia e recusam com `confirmation_required` quando não for possível interagir: passe `--yes`.
