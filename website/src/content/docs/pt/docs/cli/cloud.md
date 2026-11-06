---
sourceHash: 784025478be49fb3
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, vinculação de projeto, deploys, notificações, configurações, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em versão beta privada. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que a
versão beta não inclui.

Todos os grupos respondem a `--help`, e `--help` nunca executa o comando. A
maioria dos comandos opera no projeto vinculado em `.rebase/cloud.json`;
`--project <id>` opera em um projeto sem vinculá-lo.

Três opções se aplicam a todos os lugares: `--json` para saída legível por
máquina (também o padrão quando redirecionado por pipe, exceto para `deploy`, ou
com `REBASE_JSON=1`), `--url <origin>` para direcionar a um control plane
específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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
`logs` também cobre `usage`. O escopo de cada uma está em
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando o control
plane marca uma resposta para um token como obsoleta (um token anterior a `billing`
lendo billing), a CLI exibe o aviso uma vez no stderr, nunca no valor
`--json`.

Em um terminal sem senha fornecida, `login` pergunta se deseja usar sua senha
ou um código enviado por e-mail pelo control plane. Com a autenticação de dois
fatores ativada, ele solicita o código do autenticador (ou um código de recuperação).
Sem um terminal, nenhum dos dois pode ser digitado: defina `REBASE_TOKEN` como um
token de acesso criado no console em Settings → Access tokens. Consulte
[Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Vinculação de projeto

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Conectar uma instância auto-hospedada ao Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

O [conector Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
passa a alcançá-la ao lado de seus projetos Cloud. `connect` exibe
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; defina-os no
servidor e reinicie-o. Na pasta do projeto, ele oferece a opção de gravá-los no
`.env`. Executá-lo novamente é seguro. `--name` nomeia a instância, `--org` seleciona a
organização, `--no-wait` retorna sem esperar. Proprietários e administradores.

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

`claim` exibe o link de reivindicação do projeto provisionado por `init --claim` neste
diretório e o tempo restante antes que ele seja excluído sem reivindicação (`Unclaimed:
deleted in 41h`). `--open` também o abre em um navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o control
plane armazena um hash dele e não pode exibi-lo novamente. Antes de responder, `claim`
pergunta ao control plane se o próprio token do projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, assim que alguém reivindicar o projeto, `claim` recusará
com `already_claimed` em vez de imprimir um link inativo. Ele também recusa quando a
janela expira (`claim_expired`) e em um diretório sem link de reivindicação
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

`deploy` sem o nome do aplicativo faz o deploy do backend. O deploy do bundle
do backend também faz upload do código-fonte do projeto — o que o git rastreia,
nunca um `.env` — para que uma atualização da plataforma possa recompilá-lo;
`--no-source` ignora isso nessa execução, e `cloud settings set
--platform-rebuilds off` interrompe isso e exclui a cópia armazenada.
`--allow-downgrade` faz o deploy de uma versão anterior.

Um `deploy` acompanhado termina com um resumo: cada aplicativo enviado com sua URL, o
ID do deployment, quanto tempo levou e se a nova versão responde nesse endereço. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` ignora a verificação) para que o
`/health` do backend e o endereço de cada aplicativo estático respondam. Um deploy com falha
termina em uma linha nomeando o aplicativo e o motivo, e sai com status diferente de zero. O resumo
é impresso mesmo quando redirecionado por pipe; `--json` (ou `REBASE_JSON=1`) imprime um objeto,
contendo `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Antes do upload, `deploy` analisa o JavaScript de cada aplicativo estático que envia:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos `<script>` inline em
seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código
`syntax_error` sob `--json`), e `--no-verify` pula a verificação. Um deploy
bem-sucedido termina indicando o caminho de volta, `rebase cloud rollback`. Um aplicativo estático
implantado isoladamente ainda não pode sofrer rollback; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza a build em `https://<project>--<name>.rebase.website` e
mantém a produção intacta. Uma prévia do backend executa seu próprio backend, em um
banco de dados próprio e vazio, com seus aplicativos estáticos incorporados. Um aplicativo estático
ainda não pode ser visualizado em preview isoladamente no Rebase Cloud: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Uma prévia do backend é
cobrada como mais uma unidade de aplicativo no tamanho padrão enquanto existir, e
o deploy informa quanto isso custa por mês, com base na cotação do próprio control plane
(`cost` sob `--json`; apenas a regra e este link caso o control plane não consiga
calcular o preço); `rebase cloud previews delete <name>` a interrompe. `rebase cloud previews`
exibe uma prévia que a plataforma pausou (seu banco de dados ultrapassou o limite de preview) como
`paused`, juntamente com o motivo (`statusMessage` sob `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando o limite semanal de certificados de preview
da plataforma for atingido; a mensagem informa até quando.
Consulte [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime o log da build mais recente, e `-f` acompanha em tempo real uma build que
ainda está em execução. `--runtime` lê o que o aplicativo imprime, a partir de cada pod
por trás dele, com cada linha identificada pela tag do seu pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário no formato RFC3339.
- `--tail <n>` é a quantidade de linhas por pod a partir da qual iniciar (o control plane limita a 2000).
- `--grep` mantém as linhas que contêm o texto, sem diferenciar maiúsculas de minúsculas; use `/re/flags` para
  uma expressão regular.
- `--level error|warn|info|debug` mantém linhas com essa severidade ou pior. Ele lê
  a `severity` estruturada que um backend Rebase registra, uma palavra de nível no início de
  uma linha simples ou um formato de erro como `TypeError:`. Linhas sem nenhuma dessas informações são omitidas.

O acompanhamento (follow) faz consultas a cada dois segundos e imprime cada linha uma única vez. Ele notifica pods
que iniciam, param ou reiniciam. Quando um contêiner reinicia, ele também imprime as últimas
linhas da instância encerrada, onde o motivo geralmente se encontra. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma queda de conexão, tenta novamente com recuo exponencial (backoff) e
retoma de onde parou. Com `--json`, o acompanhamento imprime um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para o restante.

`--preview <name>` lê uma prévia em vez de produção. Use o nome do
preview ou o ID do deployment exibido pelo deploy de preview. Usado isoladamente, `--preview`
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
chave criada por `rebase cloud init --claim` no aplicativo e gravada no `.env` como
`REBASE_API_TOKEN`, pelo seu prefixo e nunca pelo seu valor. Reivindicar o projeto
transfere essa chave e ela deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agente anteriores de uma vez só. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN`, e a mantém fora do `--json`. Em
qualquer outro diretório, ele imprime a chave uma vez. As chaves criadas no painel de administração
do aplicativo não são alteradas. Ele é executado com o seu login: nenhuma permissão de token a concede.

`service-key`
imprime a geração da `REBASE_SERVICE_KEY` do projeto, quando foi rotacionada pela última
vez e se o aplicativo ainda está reiniciando para a versão mais recente. Ele nunca
imprime a chave: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia o aplicativo com ela. A chave antiga funciona até que o
reinício seja concluído, e deixa de funcionar depois. Esse comando é recusado enquanto um deploy estiver
em execução e é executado com seu login. Reivindicar um projeto também rotaciona sua service
key.

Uma prévia de backend começa com as variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` define valores próprios para as prévias, `env unset KEY
--preview` remove a variável delas, `env reset KEY --preview` restaura
o valor de produção e `env list --preview` exibe as diferenças.
A produção nunca é alterada por nenhum deles.

`env set KEY --stdin` lê o valor da entrada padrão (stdin) em vez da
linha de comando, onde `ps` e o histórico do shell o mostrariam:

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

`members invite` cria um convite e exibe seu link: de uso único,
válido por 7 dias, aceito apenas por uma conta que verificou esse endereço.
Ninguém entra até aceitar, mesmo alguém que já tenha uma conta Rebase.
A saída (e `emailDelivery` em `--json`) informa se o e-mail foi enviado; caso
não tenha sido, um aviso instrui você a enviar o link manualmente. `--role` é `admin` ou
`member` (padrão). Ninguém é convidado como `owner`: convide como admin, e
um proprietário poderá promovê-lo com `members role <email> owner` após a entrada.
`invites resend` gera um novo link e o antigo deixa de funcionar.
Convidar e usar `invites` exige uma sessão de `rebase cloud login`; `REBASE_TOKEN` é
recusado. Convidar, listar, reenviar e revogar exigem a função de owner ou admin;
um membro é informado disso se tentar.
`members remove` pede confirmação primeiro (`--yes` ignora a confirmação); remover ou rebaixar um proprietário
requer um proprietário, e o último proprietário permanece. `--org <id>` seleciona uma organização
diferente da selecionada.

`activity` é o log de auditoria da organização selecionada, do mais recente para o mais antigo: quem
realizou deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (por
nome, nunca por valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou o
papel de um membro ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa,
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída exibe o cursor `--before` para a próxima. `--json` retorna um valor,
`{ org, events, nextCursor }`. Requer a função de proprietário ou administrador da organização.
Um token o lê apenas com a capacidade `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
exibe o mesmo log.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint
público) até Ctrl-C; `--reveal` adiciona a senha. Apenas proprietário ou administrador.

## Guests

Cada `signInAnonymously()` em um teste, bot ou visita abandonada deixa uma linha
na tabela de usuários do projeto. Esses comandos contam essas linhas e as removem, para que
ninguém precise clicar nelas uma a uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita uma idade com unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
conta e não exclui nada. Ele processa projetos de qualquer tamanho em pequenos
lotes.

Apenas guests podem ser removidos. Um guest é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e a aplicação aplica essa regra na instrução que exclui a
linha, de modo que o comando não possa afetar uma conta regular, mesmo uma que tenha se registrado momentos
após ser listada. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Last seen** (Visto pela última vez) é quando a sessão do guest foi emitida ou atualizada pela última vez, ou quando
o guest foi criado se ele não tiver mais token de atualização (refresh token). Um guest que continua retornando
não é considerado antigo, independentemente de quando foi criado. Os tokens de atualização e quaisquer outras linhas
de autenticação de um guest excluído são removidos junto com ele.

As linhas nas suas próprias tabelas seguem suas chaves estrangeiras:

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo esvaziado |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o guest junto: o guest é reportado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída junto com o guest |
| Sem chave estrangeira (um campo `userSelect`, um ID simples) | Mantida, contendo um ID que não existe mais |

Verifique quais dos seus vínculos têm exclusão em cascata antes de passar `--yes`: isso não pode ser desfeito.

O comando lê `REBASE_SERVICE_KEY` da mesma forma que `env reveal`, portanto requer um
proprietário ou administrador (ou um token com a permissão `env` pertencente a um deles). A
chave permanece em memória e vai apenas para o endereço do próprio projeto. Um projeto em um
runtime mais antigo é informado de que precisa de uma versão mais nova.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que seu código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
seria excluir dados por meio de um push. Ele o mantém, vincula e fatura até que alguém
o elimine (prune) pelo nome.

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
em níveis (tiers): tudo é precificado por recurso. Consulte
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
apenas `{ "text" }` em vez do JSON do evento, que também carrega um `text`. A URL
é um argumento posicional porque `--url` especifica o control plane. `add` exibe
o segredo de assinatura uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` encerra com código 1 e `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem está aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem o papel de proprietário ou administrador. Um token pode gerenciá-los com a
capacidade `notifications` na organização, seguindo a mesma regra de papéis. Consulte
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` atribui ao cluster
próprio do cliente um registro de imagens próprio, usado exclusivamente para aquele cluster. Sem
isso, esse cluster usa o registro compartilhado da plataforma, e cada deploy para ele
indica isso em seu log. Com ele configurado, os builds realizam push para esse repositório usando um token para
aquela conta, os pods realizam pull usando exclusivamente aquela chave, e um rollback aceita as
imagens do projeto lá armazenadas. As imagens
que o projeto criou anteriormente no repositório compartilhado continuam disponíveis para pull e continuam
sendo alvos válidos de rollback. Os três valores devem ser fornecidos juntos; `--clear` os remove. A chave
é protegida ao ser gravada e nunca mais é lida. Assim como o restante de `clusters`,
requer a função de platform-admin. O operador cria o repositório e ambas as
contas usando o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console e estão disponíveis apenas para proprietários e administradores
da organização. Um token os acessa, assim como o restante de `billing`, com a capacidade `billing`
na organização; um token criado antes dessa capacidade continua funcionando por mais uma versão,
exibindo um aviso a cada resposta. Os valores em `--json` estão na menor unidade da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a prévia é calculada pelo
Stripe e seus itens medidos continuam aumentando até o fechamento do período.

`usage` lê o que o projeto vinculado (ou `--project`) utilizou em um mês civil,
em UTC: requisições em relação à cota incluída, erros 5xx, o excedente acumulado
até o momento em euros e, para o mês em andamento, a projeção nesse ritmo
(uma estimativa). O excedente é o cálculo do próprio relatório de excedente, aquele
que informa ao Stripe o que faturar, constando na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use` e o total. Qualquer membro da organização pode lê-lo. Um token o lê com a
capacidade `logs` no projeto; `usage org` lista os projetos nos quais o token
possui essa permissão.
`--month` aceita um mês passado. A resposta inclui `caveats`, cada um com um `code`: `storage_not_measured`
(armazenamento de objetos registra 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods de aplicativos são executados não são contabilizadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (pods foram executados acima de `--replicas` e esta plataforma ainda não
os cobra). A resposta de um projeto com escalonamento automático também inclui `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` de acordo com suas taxas e `charged`.
