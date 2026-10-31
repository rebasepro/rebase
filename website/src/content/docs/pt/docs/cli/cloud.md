---
sourceHash: 4b7b199f1aa18e8d
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos do Rebase Cloud na CLI — autenticação, vinculação de projeto, deploys, notificações, configurações, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam a todos os comandos: `--json` para saída legível por máquina (também o
padrão quando passado por pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a
um plano de controle específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Autenticação

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` aceita `deploy`, `logs`, `env`, `database` e `backups` em um projeto
(`--project`, ou no vinculado), e `billing`, `audit` e
`notifications` em uma organização: `--org`, caso contrário a organização do projeto,
caso contrário a selecionada. Um token pode conter apenas permissões de organização.
`logs` também cobre `usage`. O escopo de cada um está em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents). Quando o plano de controle
marca uma resposta a um token como obsoleta (um token anterior a `billing`
lendo faturamento), a CLI exibe o aviso uma vez no stderr, nunca no
valor de `--json`.

Em um terminal sem senha informada, `login` pergunta se deseja usar sua senha
ou um código enviado por e-mail pelo plano de controle. Com a autenticação de dois fatores ativada, ele
em seguida solicita o código do seu aplicativo autenticador (ou um código de recuperação). Sem um terminal,
nenhum dos dois pode ser digitado: defina `REBASE_TOKEN` com um token de acesso criado no console
em Settings → Access tokens. Consulte [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Vinculação de projeto

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projetos

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` exibe o link de reivindicação do projeto que `init --claim` provisionou neste
diretório e o tempo restante antes que ele seja excluído sem reivindicação (`Unclaimed: deleted
in 41h`). `--open` também o abre em um navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o plano de controle
armazena um hash dele e não pode exibi-lo novamente. Antes de responder, `claim`
pergunta ao plano de controle se o próprio token do projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, assim que alguém reivindicar o projeto, `claim` recusará
com `already_claimed` em vez de exibir um link inativo. Ele também recusa quando a
janela tiver expirado (`claim_expired`), e em um diretório sem link de reivindicação
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

`deploy` sem o nome do aplicativo faz o deploy do backend. Um deploy do bundle
do backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma
atualização da plataforma possa reconstruí-lo; `--no-source` pula isso uma vez, e `cloud settings set
--platform-rebuilds off` interrompe isso e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão anterior.

Um `deploy` acompanhado termina com um resumo: cada aplicativo enviado com sua URL, o
ID do deployment, quanto tempo levou e se a nova versão responde no endereço. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` pula a verificação) para que o
`/health` do backend e o endereço de cada aplicativo estático respondam. Um deploy com falha
termina em uma linha informando o aplicativo e o motivo, e sai com código diferente de zero. O resumo
é exibido mesmo quando redirecionado por pipe; `--json` (ou `REBASE_JSON=1`) gera um objeto em vez disso,
com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Antes de fazer o upload, `deploy` analisa o JavaScript de cada aplicativo estático que envia:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos `<script>` inline em
seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código
`syntax_error` sob `--json`), e `--no-verify` pula a verificação. Um deploy bem-sucedido
termina com o caminho de retorno, `rebase cloud rollback`. Um aplicativo estático implantado
isoladamente ainda não pode sofrer rollback; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza o build em `https://<project>--<name>.rebase.website` e
não altera a produção. Um preview do backend executa seu próprio backend, em um
banco de dados próprio e vazio, com seus aplicativos estáticos incorporados. Um aplicativo estático ainda não pode ser
visualizado em modo preview isoladamente no Rebase Cloud: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Um preview de backend
é faturado como uma unidade de aplicativo adicional no tamanho padrão enquanto existir, e
o deploy informa quanto isso custa por mês, a partir da cotação do próprio plano de controle
(`cost` sob `--json`; apenas a regra e este link quando o plano de controle não conseguir
precificá-lo); `rebase cloud previews delete <name>` o interrompe. `rebase cloud previews`
exibe um preview que a plataforma pausou (o banco de dados ultrapassou o limite de preview) como
`paused`, com o motivo (`statusMessage` sob `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando o orçamento semanal de certificados de
preview da plataforma se esgotar; a mensagem informa até quando.
Consulte [Visualizar uma alteração em preview](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` exibe o log de build mais recente, e `-f` acompanha em tempo real um build que
ainda está em execução. `--runtime` lê o que o aplicativo imprime, de cada pod
por trás dele, com cada linha identificada pela tag do seu pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário RFC3339.
- `--tail <n>` é a quantidade de linhas por pod para começar (o plano de controle limita a 2000).
- `--grep` mantém as linhas que contêm o texto, sem diferenciar maiúsculas/minúsculas; use `/re/flags` para uma
  expressão regular.
- `--level error|warn|info|debug` mantém as linhas nessa severidade ou pior. Ele lê
  a `severity` estruturada que um backend Rebase registra, uma palavra de nível no início de uma
  linha de texto simples ou um formato de erro como `TypeError:`. Linhas sem nenhuma dessas informações são omitidas.

O acompanhamento consulta a cada dois segundos e imprime cada linha uma vez. Ele anuncia pods
que iniciam, param ou reiniciam. Quando um contêiner reinicia, ele também imprime as últimas
linhas da instância finalizada, onde o motivo geralmente se encontra. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma queda de conexão, tenta novamente com backoff e
retoma de onde parou. Com `--json`, o acompanhamento imprime um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para o restante.

`--preview <name>` lê um preview em vez da produção. Use o nome do
preview ou o ID do deployment exibido pelo deploy de preview. Sozinho, `--preview`
lê o único preview do projeto. Um preview estático tem log de build, mas nenhum
log de tempo de execução, porque não executa nenhum servidor.

## Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` lista a chave que o comando `rebase cloud init --claim` gerou no aplicativo e gravou no `.env` como
`REBASE_API_TOKEN`, pelo seu prefixo e nunca pelo seu valor. Ao reivindicar o projeto,
essa chave é transferida e deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agente anteriores de uma só vez. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN`, e a mantém fora do `--json` nesse caso. Em
qualquer outro diretório, ele imprime a chave uma vez. As chaves criadas no painel de administração do aplicativo
não são modificadas. Ele é executado com o seu login: nenhuma permissão de token concede acesso a ele.

`service-key`
exibe a geração da `REBASE_SERVICE_KEY` do projeto, quando foi rotacionada
pela última vez e se o aplicativo ainda está reiniciando para aplicar a mais recente. Ele nunca
imprime a chave: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia o aplicativo com ela. A chave antiga funciona até que o
reinício seja concluído, e nada mais depois disso. A operação é recusada enquanto um deploy estiver
em andamento e é executada com seu login. Reivindicar um projeto também rotaciona sua
chave de serviço.

Um preview de backend inicia a partir das variáveis de produção, incluindo as chaves ativas.
`env set KEY=VALUE --preview` dá aos previews seus próprios valores, `env unset KEY
--preview` omite a variável deles, `env reset KEY --preview` restaura
o valor de produção e `env list --preview` exibe as diferenças.
A produção nunca é alterada por nenhum desses comandos.

`env set KEY --stdin` lê o valor da entrada padrão (stdin) em vez da
linha de comando, onde o `ps` e o histórico do seu shell poderiam exibi-lo:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é removida. O `rebase_cloud_env_set` do servidor MCP define
os valores dessa forma.

## Organizações

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` cria um convite e exibe seu link: uso único,
válido por 7 dias, aceito apenas por uma conta que tenha verificado esse endereço.
Ninguém entra até que aceite, mesmo quem já possui uma conta Rebase.
A saída (e `emailDelivery` em `--json`) informa se o e-mail foi enviado; se
não tiver sido, um aviso indica que você mesmo deve enviar o link. `--role` pode ser `admin` ou
`member` (padrão). Ninguém é convidado como `owner`: convide como admin, e
um owner poderá promovê-lo com `members role <email> owner` assim que ele tiver entrado.
`invites resend` gera um novo link e o antigo deixa de funcionar.
Convidar e gerenciar `invites` exigem uma sessão de `rebase cloud login`; `REBASE_TOKEN` é
recusado. Convidar, listar, reenviar e revogar exigem o papel de owner ou admin;
um member será informado disso.
`members remove` pede confirmação primeiro (`--yes` pula a pergunta); remover ou rebaixar um owner
exige ser owner, e o último owner permanece. `--org <id>` seleciona uma organização
diferente da selecionada.

`activity` é o log de auditoria da organização selecionada, do mais recente para o mais antigo: quem
fez deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (por
nome, nunca por valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou o
papel de um membro, ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída imprime o cursor `--before` para a próxima. `--json` retorna um único valor,
`{ org, events, nextCursor }`. É necessário o papel de owner ou admin da organização.
Um token só lê esse log com a permissão `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
mostra o mesmo log.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem
endpoint público) até que seja pressionado Ctrl-C; `--reveal` adiciona a senha. Apenas owner ou admin.

## Convidados

<span class="since-badge" data-since="0.27">Since 0.27</span>

Cada `signInAnonymously()` em um teste, um bot ou uma visita abandonada deixa uma linha
nos usuários do projeto. Esses comandos contam essas linhas e as removem, para que
ninguém precise clicar nelas uma a uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita um período de tempo com uma unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
apenas conta e não exclui nada. Ele processa projetos de qualquer tamanho em pequenos
lotes.

Apenas convidados podem ser removidos. Um convidado é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e o aplicativo aplica essa regra na instrução que exclui a
linha, portanto o comando não afeta contas normais, mesmo uma que tenha se registrado momentos
após ser listada. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Visto pela última vez (Last seen)** é quando a sessão do convidado foi emitida ou atualizada pela última vez, ou quando
o convidado foi criado, caso não reste nenhum token de atualização (refresh token). Um convidado que continua
retornando não é considerado antigo, independentemente de há quanto tempo foi criado. Os tokens de atualização e quaisquer
outras linhas de autenticação de um convidado excluído são removidos juntamente com ele.

As linhas nas suas próprias tabelas seguem suas chaves estrangeiras (foreign keys):

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo esvaziado |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o convidado junto com ela: o convidado é reportado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída junto com o convidado |
| Sem chave estrangeira (um campo `userSelect`, um ID simples) | Mantida, contendo um ID que não existe mais |

Verifique quais dos seus vínculos estão em cascata antes de passar `--yes`: isso não pode ser desfeito.

O comando lê `REBASE_SERVICE_KEY` da mesma forma que `env reveal`, portanto exige um
owner ou admin (ou um token com a permissão `env` pertencente a um deles). A
chave permanece na memória e é enviada apenas para o próprio endereço do projeto. Um projeto em um
runtime mais antigo é informado de que precisa de uma versão mais nova.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
seria perda de dados causada por um push. Ele o mantém, vincula e fatura até que alguém
o remova explicitamente pelo nome com o prune.

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
`true` é recusado e `false` é ignorado com um aviso. Não há níveis de planos:
tudo é precificado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

## Armazenamento, notificações, clusters, faturamento e uso

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud webhooks            # retired: exits 1 (`command_retired`) and names `notifications`
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
é um argumento posicional porque `--url` especifica o plano de controle. `add` exibe
o segredo de assinatura uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` encerra com código 1 e código `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem está aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem o papel de owner ou admin. Um token os gerencia com a
permissão `notifications` na organização, sob a mesma regra de papel. Consulte
[Notificações do Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` fornece ao cluster próprio
do cliente um registro de imagens exclusivo, usado apenas para esse cluster. Sem
ele, esse cluster usa o registro compartilhado da plataforma, e cada deploy realizado nele
informa isso em seu log. Com ele, os builds enviam imagens (push) para esse repositório com um token dessa
conta, os pods baixam imagens (pull) somente com essa chave, e um rollback aceita as
imagens do projeto lá armazenadas. As imagens
que o projeto compilou anteriormente no repositório compartilhado continuam disponíveis para pull e continuam
sendo alvos válidos de rollback. Os três valores devem ser fornecidos juntos; `--clear` os descarta. A chave
é selada quando gravada e nunca mais é lida. Assim como o restante de `clusters`,
isso exige o papel de platform-admin. O operador cria o repositório e ambas as
contas usando o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página de Faturamento (Billing) do console, e estão disponíveis apenas para owners e admins da
organização. Um token tem acesso a eles, e ao restante de `billing`, com a permissão
`billing` na organização; um token criado antes dessa permissão continuará
funcionando por mais uma versão, exibindo um aviso em cada resposta. Os valores em `--json` estão na unidade fracionária da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a prévia é calculada pelo
Stripe e seus itens medidos continuam aumentando até o fechamento do período.

`usage` lê o que o projeto vinculado (ou `--project`) utilizou em um mês
calendário, em UTC: requisições em relação à cota incluída, erros 5xx, o excedente
até o momento em euros e, para o mês em andamento, a projeção com base nesse
ritmo (uma estimativa). O excedente é o cálculo do próprio relatório de excedentes, o
mesmo que informa ao Stripe o que cobrar, e é lançado na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use`, juntamente com o total. Qualquer membro da organização pode lê-lo. Um token pode lê-lo
com a permissão `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa permissão.
`--month` aceita um mês passado. A resposta inclui `caveats`, cada um com um `code`: `storage_not_measured`
(armazenamento de objetos registra 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods do aplicativo estão em execução não são contabilizadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (pods foram executados acima de `--replicas` e esta plataforma ainda não
os cobra). A resposta de um projeto com escalonamento automático (autoscale) também inclui `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` nas suas tarifas e `charged`.
