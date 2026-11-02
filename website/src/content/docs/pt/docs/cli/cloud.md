---
sourceHash: 279e0eca02e1be02
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, vínculo de projeto, deploys, notificações, configuração, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que a versão beta
não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam a todos os comandos: `--json` para saída legível por máquina (também o
padrão quando redirecionado por pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um
plano de controle específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Autenticação

```bash
rebase cloud login      # sign in to the control plane
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
caso contrário a selecionada. Um token pode conter apenas capacidades de organização.
`logs` também cobre `usage`. O escopo de acesso de cada um está em
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando o plano de
controle marca uma resposta a um token como obsoleta (um token anterior a `billing`
lendo faturamento), a CLI imprime o aviso uma vez no stderr, nunca no
valor `--json`.

Em um terminal sem senha informada, o `login` pergunta se você deseja usar sua senha
ou um código enviado pelo plano de controle por e-mail. Com a autenticação de dois fatores ativada, ele
solicita o código do seu autenticador (ou um código de recuperação). Sem um terminal
nenhum dos dois pode ser digitado: defina `REBASE_TOKEN` como um token de acesso criado no console
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
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` imprime o link de reivindicação do projeto provisionado por `init --claim` neste
diretório e o tempo restante antes que seja excluído sem reivindicação (`Unclaimed: deleted
in 41h`). `--open` também o abre em um navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o plano de
controle armazena um hash dele e não pode imprimi-lo novamente. Antes de responder, `claim`
pergunta ao plano de controle se o token do próprio projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, uma vez que alguém tenha reivindicado o projeto, `claim` recusa
com `already_claimed` em vez de imprimir um link quebrado. Ele também recusa quando o
período expira (`claim_expired`), e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` exibem o mesmo
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

`deploy` sem o nome de uma aplicação faz o deploy do backend. Um deploy de pacote
do backend também envia o código-fonte do projeto — o que o git monitora, nunca um `.env` — para que uma
atualização de plataforma possa reconstruí-lo; `--no-source` ignora isso nesta execução, e `cloud settings set
--platform-rebuilds off` desativa essa ação e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão mais antiga.

Um `deploy` acompanhado termina com um resumo: cada app implantada com sua URL, o
ID do deployment, o tempo decorrido e se a nova versão responde nesse endereço. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` ignora a verificação) para que o
`/health` do backend e o endereço de cada aplicação estática respondam. Um deploy com falha
termina com uma única linha informando o app e o motivo, e sai com código diferente de zero. O resumo
é impresso mesmo quando enviado via pipe; `--json` (ou `REBASE_JSON=1`) imprime um único objeto,
com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Antes de fazer o upload, o `deploy` analisa o JavaScript de cada aplicação estática enviada:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos inline `<script>` em
seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código
`syntax_error` sob `--json`), e `--no-verify` ignora a verificação. Um deploy
bem-sucedido termina indicando o comando de reversão, `rebase cloud rollback`. Uma aplicação estática implantada
isoladamente ainda não pode sofrer rollback; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza o build em `https://<project>--<name>.rebase.website` e
mantém a produção intacta. Uma prévia do backend executa seu próprio backend, em um
banco de dados vazio exclusivo, com suas aplicações estáticas integradas. Uma aplicação estática não pode ser
pré-visualizada isoladamente no Rebase Cloud ainda: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Uma prévia de backend
é faturada como uma unidade adicional de app no tamanho padrão enquanto existir, e
o deploy informa a quanto isso equivale por mês, a partir da cotação do próprio plano de controle
(`cost` sob `--json`; apenas a regra e este link quando o plano de controle não puder
precificá-lo); `rebase cloud previews delete <name>` o interrompe. `rebase cloud previews`
exibe uma prévia pausada pela plataforma (seu banco de dados cresceu além do limite de preview) como
`paused`, acompanhada do motivo (`statusMessage` sob `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando o orçamento semanal de certificados
de preview da plataforma for esgotado; a mensagem informa até quando.
Consulte [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime o log do build mais recente, e `-f` acompanha um build que
ainda está em execução. `--runtime` lê o que a aplicação imprime em tempo de execução, a partir de cada pod
por trás dela, com cada linha identificada com seu respectivo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário no formato RFC3339.
- `--tail <n>` define a quantidade de linhas por pod a partir da qual iniciar (o plano de controle limita a 2000).
- `--grep` filtra linhas que contêm o texto, sem diferenciar maiúsculas de minúsculas; use `/re/flags` para
  expressões regulares.
- `--level error|warn|info|debug` mantém linhas nessa severidade ou superior. Ele analisa
  a `severity` estruturada que um backend Rebase registra, uma palavra de nível no início de uma
  linha simples ou um padrão de erro como `TypeError:`. Linhas sem essas indicações são omitidas.

O acompanhamento em tempo real consulta a cada dois segundos e imprime cada linha uma única vez. Ele notifica pods
que iniciam, param ou reiniciam. Quando um container reinicia, ele também imprime as últimas
linhas da instância que caiu, onde geralmente se encontra a causa. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma conexão perdida, tenta novamente com recuo gradual (backoff) e
continua de onde parou. Com `--json`, o acompanhamento imprime um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para o restante.

`--preview <name>` lê uma prévia em vez de produção. Use o nome do
preview ou o ID do deployment informado no deploy do preview. Sozinho, `--preview`
lê a única prévia do projeto. Um preview estático tem um log de build, mas nenhum
log de runtime, pois não executa um servidor.

## Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` lista a
chave que o `rebase cloud init --claim` gerou na aplicação e gravou no `.env` como
`REBASE_API_TOKEN`, pelo seu prefixo e nunca pelo seu valor. Reivindicar o projeto
transfere essa chave e ela deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agente anteriores de uma só vez. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN`, omitindo-a do `--json` nesse caso. Em
qualquer outro diretório, ele imprime a chave uma vez. Chaves criadas no painel de administração da aplicação
não são afetadas. Ele é executado com suas credenciais de login: nenhuma permissão de token o concede.

`service-key`
exibe a geração da `REBASE_SERVICE_KEY` do projeto, quando ela foi rotacionada
pela última vez e se a aplicação ainda está reiniciando com a chave mais recente. Ele nunca
imprime a chave: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia a aplicação com ela. A chave antiga funciona até que a
reinicialização termine, e não tem mais validade após isso. O comando é recusado enquanto um deploy estiver
em andamento, e é executado com suas credenciais de login. Reivindicar um projeto também rotaciona sua
chave de serviço.

Uma prévia de backend inicia a partir das variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` atribui um valor próprio às prévias, `env unset KEY
--preview` remove a variável delas, `env reset KEY --preview` restaura
o valor de produção e `env list --preview` exibe as diferenças.
A produção nunca é alterada por nenhum desses comandos.

`env set KEY --stdin` lê o valor a partir da entrada padrão em vez da
linha de comando, onde `ps` e o histórico do seu shell poderiam exibi-lo:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é descartada. O `rebase_cloud_env_set` do servidor MCP
define valores dessa forma.

## Organizações

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` cria um convite e imprime seu link: de uso único,
válido por 7 dias, aceito apenas por uma conta que tenha verificado esse endereço.
Ninguém ingressa até aceitar o convite, mesmo quem já possui uma conta Rebase.
A saída (e `emailDelivery` em `--json`) informa se o e-mail foi enviado; se
não foi, um aviso instrui você a enviar o link manualmente. `--role` pode ser `admin` ou
`member` (padrão). Ninguém é convidado como `owner`: convide como admin, e
um proprietário pode promovê-lo com `members role <email> owner` assim que tiver ingressado.
`invites resend` gera um novo link e invalida o anterior.
Convidar e gerenciar `invites` requer uma sessão ativa de `rebase cloud login`; `REBASE_TOKEN` é
recusado. Convidar, listar, reenviar e revogar exigem a função de proprietário (owner) ou administrador;
um membro comum é informado sobre essa restrição.
`members remove` pede confirmação prévia (`--yes` pula a pergunta); remover ou rebaixar um proprietário
exige um proprietário, e o último proprietário não pode ser removido. `--org <id>` seleciona uma organização
diferente da selecionada atualmente.

`activity` é o log de auditoria da organização selecionada, do mais recente para o mais antigo: quem
fez deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (pelo
nome, nunca pelo valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou o
papel de um membro, ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída imprime o cursor `--before` para a próxima. `--json` retorna um único valor,
`{ org, events, nextCursor }`. Requer a função de proprietário ou administrador na organização.
Um token só tem permissão de leitura com a capacidade `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
exibe o mesmo log.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local conectada diretamente ao banco de dados gerenciado (sem endpoint
público) até Ctrl-C; `--reveal` inclui a senha. Exclusivo para proprietário ou administrador.

## Convidados

Cada `signInAnonymously()` em um teste, bot ou visita abandonada deixa uma linha
na tabela de usuários do projeto. Esses comandos contabilizam essas linhas e as removem, para
que ninguém precise excluí-las manualmente uma por uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` recebe um período de tempo com unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
apenas conta e não exclui nada. Ele processa projetos de qualquer tamanho em pequenos
lotes.

Apenas convidados podem ser removidos. Um convidado é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e a aplicação aplica essa regra na instrução que exclui a
linha, de modo que o comando não atinja contas reais, mesmo aquelas cadastradas instantes
após a listagem. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Visto pela última vez (Last seen)** é o momento em que a sessão do convidado foi emitida ou atualizada pela última vez, ou quando
o convidado foi criado se ele não tiver mais token de atualização. Um convidado que continua
retornando não é considerado antigo, independentemente de quando foi criado. Os tokens de atualização de um convidado excluído
e quaisquer outras linhas de autenticação são removidos com ele.

As linhas em suas próprias tabelas seguem suas respectivas chaves estrangeiras:

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo esvaziado |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o convidado também: o convidado é reportado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída juntamente com o convidado |
| Sem chave estrangeira (um campo `userSelect`, um simples id) | Mantida, contendo um id que não existe mais |

Verifique quais de seus relacionamentos possuem exclusão em cascata antes de passar `--yes`: esta ação não pode ser desfeita.

O comando lê `REBASE_SERVICE_KEY` da mesma forma que `env reveal`, portanto exige um
proprietário ou administrador (ou um token com a capacidade `env` pertencente a um deles). A
chave permanece em memória e é enviada apenas para o próprio endereço do projeto. Um projeto em uma
versão mais antiga do runtime é avisado de que precisa de uma versão mais nova.

## Recursos

O que a plataforma mantém para o projeto, em comparação ao que o seu código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é retirada — isso
significaria apagar dados por meio de um push. A plataforma o mantém, vincula e fatura até que alguém
faça a poda (prune) explicitamente pelo nome.

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
`true` é recusado e `false` é ignorado com um aviso. Não existem níveis de
planos (tiers): tudo é tarifado por recurso. Consulte
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
recebe uma lista separada por vírgulas de `deploy.failed` (o padrão),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` envia
apenas `{ "text" }` em vez do JSON completo do evento, que também inclui um `text`. A URL
é um argumento posicional porque `--url` especifica o plano de controle. `add` imprime
o segredo de assinatura uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` encerra com código 1 e `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem está aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem o papel de proprietário ou administrador. Um token pode gerenciá-los com a
capacidade `notifications` na organização, sob a mesma regra de papéis. Consulte
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` fornece ao cluster próprio
do cliente um registro de imagens exclusivo, utilizado apenas para aquele cluster. Sem
ele, esse cluster usa o registro compartilhado da plataforma, e cada deploy exibe
essa informação no log. Com ele configurado, os builds realizam push para aquele repositório com um token daquela
conta, os pods realizam pull exclusivamente com essa chave, e um rollback aceita as imagens
do projeto lá contidas. Imagens
que o projeto compilou anteriormente no repositório compartilhado continuam disponíveis para pull e permanecem como
alvos válidos para rollback. Os três valores devem ser fornecidos em conjunto; `--clear` os remove. A chave
é lacrada no momento da gravação e nunca mais pode ser lida. Assim como o restante do grupo `clusters`,
este comando requer a função platform-admin. O operador cria o repositório e ambas as
contas usando o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console, e são acessíveis somente para proprietários e administradores da organização.
Um token pode acessá-los, bem como o restante de `billing`, com a capacidade
`billing` na organização; um token gerado antes da introdução dessa capacidade continua
funcionando por uma versão, exibindo um aviso em cada resposta. Os valores em `--json` são informados na menor unidade da moeda (centavos), exatamente como
enviados pelo Stripe. Faturas em rascunho não são listadas; a prévia é calculada pelo
Stripe e suas linhas medidas continuam aumentando até o encerramento do período.

`usage` exibe o consumo do projeto vinculado (ou `--project`) em um mês
do calendário, em UTC: requisições em relação à cota inclusa, erros 5xx, o excedente
acumulado até o momento em euros e, para o mês em andamento, a projeção com base
no ritmo atual (uma estimativa). O excedente corresponde ao cálculo do próprio relatório de excedente,
o mesmo que informa ao Stripe o valor a cobrar, e que constará na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use`, junto ao total. Qualquer membro da organização pode visualizá-lo. Um token pode lê-lo
com a capacidade `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa capacidade.
`--month` aceita um mês anterior. A resposta traz `caveats`, cada um com um `code`: `storage_not_measured`
(armazenamento de objetos registra 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods da aplicação estão ativos não são contabilizadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente contabiliza apenas os dias posteriores à reivindicação) e
`autoscale_not_charged` (pods operaram acima de `--replicas` e esta plataforma ainda não
cobra por eles). A resposta de um projeto com escalonamento automático também inclui `autoscale`:
`extraPodSeconds` acima da base mínima, `amountEur` com suas respectivas taxas, e `charged`.
