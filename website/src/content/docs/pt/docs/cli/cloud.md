---
sourceHash: bd97024430acdcb1
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos do Rebase Cloud na CLI — autenticação, vinculação de projeto, deploys, notificações, configuração, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em versão beta privada. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que a versão beta
não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam a todos os comandos: `--json` para saída legível por máquina (também
o padrão quando usada com pipes, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um
plano de controle específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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
(`--project` ou o vinculado) e `billing`, `audit` e
`notifications` em uma organização: `--org`, caso contrário, a organização do projeto ou
a selecionada. Um token pode conter apenas permissões de organização.
`logs` também abrange `usage`. O que cada uma alcança está em
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando o plano de
controle marca a resposta de um token como obsoleta (um token anterior a `billing`
lendo faturamento), a CLI exibe o aviso uma vez no stderr, nunca no
valor de `--json`.

Sem sinalizadores, `login` faz a autenticação pelo navegador. Ele exibe um código curto e
um link para o console, abre o navegador e aguarda enquanto você aprova o
login nele. Você pode já estar conectado ao console ou fazer login com
qualquer método disponível (senha, Google, GitHub, LinkedIn). Verifique se o
navegador mostra o mesmo código antes de aprová-lo. O link expira após dez
minutos e funciona apenas uma vez. Sem um terminal, ou com `--json`, o link e o código
vão para o stderr e o `login` continua aguardando, permitindo que um agente repasse o link para você. Um
login negado é encerrado com `access_denied`, e um expirado com `expired_token`.

Com `--email`, `login` pergunta se deseja usar sua senha ou um código enviado pelo plano de
controle por e-mail. Com a autenticação de dois fatores ativada, ele solicita o código do seu
autenticador (ou um código de recuperação); pelo navegador, aprove a partir de uma
sessão do console que o utilizou. Sem um terminal, nenhum dos códigos pode ser digitado: defina
`REBASE_TOKEN` com um token de acesso criado no console em Settings → Access
tokens. Consulte [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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

O [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
passa a acessá-la junto aos seus projetos Cloud. O comando `connect` exibe
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; configure-os
no servidor e reinicie-o. Na pasta do projeto, ele oferece a opção de gravá-los no
`.env`. Executá-lo novamente é seguro. `--name` define o nome da instância, `--org` escolhe a
organização e `--no-wait` retorna sem esperar. Exclusivo para proprietários (owners) e administradores.

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

`claim` exibe o link de reivindicação do projeto que `init --claim` provisionou neste
diretório, além do tempo restante antes que seja excluído se não for reivindicado (`Unclaimed: deleted
in 41h`). `--open` também o abre no navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o plano de
controle armazena um hash dele e não pode exibi-lo novamente. Antes de responder, `claim`
pergunta ao plano de controle se o token do próprio projeto ainda é válido. Uma reivindicação
revoga esse token, portanto, assim que alguém reivindica o projeto, `claim` recusa a operação
com `already_claimed` em vez de exibir um link inativo. Ele também recusa quando a
janela expira (`claim_expired`) e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` exibem o mesmo
link enquanto o projeto não for reivindicado.

## Deploy e monitoramento

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

`deploy` sem o nome do app faz o deploy do backend. Um deploy do pacote
(bundle) do backend também envia o código-fonte do projeto — o que o git rastreia, nunca um `.env` — para
que uma atualização da plataforma possa recompilá-lo; `--no-source` pula isso uma vez, e `cloud settings set
--platform-rebuilds off` interrompe esse envio e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão anterior.

Um `deploy` acompanhado termina com um resumo: cada app implantado com sua URL, o
ID do deploy, quanto tempo levou e se a nova versão responde nesse endereço. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` ignora a verificação) para que o
`/health` do backend e o endereço de cada app estático respondam. Um deploy com falha
termina em uma única linha indicando o app e o motivo, saindo com status diferente de zero. O resumo
é exibido mesmo quando usado em pipes; `--json` (ou `REBASE_JSON=1`) exibe um único objeto,
contendo `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Antes de fazer o upload, o `deploy` analisa o JavaScript de cada app estático enviado:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos inline `<script>` em
seu HTML. Um erro de sintaxe interrompe o deploy exibindo `file:line:column` (código
`syntax_error` sob `--json`), e `--no-verify` pula essa verificação. Um deploy bem-sucedido
termina indicando a opção de reversão: `rebase cloud rollback`. Um app estático implantado
isoladamente ainda não pode sofrer rollback; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza a compilação em `https://<project>--<name>.rebase.website` e
mantém a produção intocada. Um preview do backend executa seu próprio backend, em um
banco de dados vazio próprio, com seus apps estáticos integrados. Um app estático ainda não pode
ser visualizado em preview isoladamente no Rebase Cloud: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. O preview de um backend
é faturado como uma unidade adicional de app no tamanho padrão enquanto existir, e
o deploy informa o custo mensal estimado com base na cotação do próprio plano de controle
(`cost` sob `--json`; apenas a regra e este link caso o plano de controle não consiga
precificar); `rebase cloud previews delete <name>` o interrompe. `rebase cloud previews`
exibe um preview pausado pela plataforma (cujo banco de dados ultrapassou o limite de preview) como
`paused`, juntamente com o motivo (`statusMessage` sob `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando a cota semanal de certificados de preview
da plataforma for esgotada; a mensagem informa até quando.
Consulte [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` exibe o log de build mais recente, e `-f` acompanha um build que
ainda está em execução. `--runtime` lê o que o app imprime, a partir de cada pod
por trás dele, com cada linha identificada por seu pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário no formato RFC3339.
- `--tail <n>` indica as linhas por pod a partir de onde começar (o plano de controle limita em 2000).
- `--grep` mantém as linhas que contêm o texto, sem diferenciar maiúsculas de minúsculas; use `/re/flags` para
  uma expressão regular.
- Com `--grep` ou `--level`, o filtro pesquisa todas as linhas retornadas pelo plano de controle
  para a janela (as 2000 mais recentes de cada pod), e `--tail` conta as linhas correspondentes:
  as `n` correspondências mais recentes por pod, 500 por padrão. Quando um pod tiver mais
  linhas na janela do que isso, a saída informará que as mais antigas não foram
  pesquisadas (`filter.scanCapped` sob `--json`).
- `--level error|warn|info|debug` mantém as linhas com essa severidade ou mais grave. Ele lê
  a `severity` estruturada que um backend Rebase registra, uma palavra de nível no início de uma
  linha comum ou um formato de erro como `TypeError:`. Linhas sem esses elementos são omitidas.

O acompanhamento contínuo (follow) consulta a cada dois segundos e exibe cada linha uma única vez. Ele notifica os
pods que iniciam, param ou reiniciam. Quando um contêiner é reiniciado, ele também exibe as últimas
linhas da instância que falhou, onde geralmente está o motivo. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma queda de conexão, tenta novamente com recuo exponencial (backoff) e
retoma de onde parou. Com `--json`, o follow exibe um objeto JSON por linha
(NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log e
`{"type":"event","event":…}` para as demais informações.

`--preview <name>` lê os logs de um preview em vez de produção. Use o nome
do preview ou o ID de deployment exibido no deploy do preview. Sozinho, `--preview`
lê o único preview do projeto. Um preview estático tem um log de build, mas nenhum
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
`REBASE_API_TOKEN`, exibindo seu prefixo e nunca seu valor. Ao reivindicar o projeto,
essa chave é transferida e deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agente anteriores de uma só vez. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN` e a omite do `--json` nesse caso. Em
qualquer outro diretório, ele exibe a chave uma única vez. Chaves criadas no painel de administração do app
não são afetadas. Esse comando é executado com seu login: nenhuma permissão de token o autoriza.

`service-key`
exibe a geração da `REBASE_SERVICE_KEY` do projeto, quando foi rotacionada pela última vez
e se o app ainda está reiniciando para carregar a versão mais recente. Ele nunca exibe
a chave em si: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia o app com ela. A chave antiga funciona até que o
reinício seja concluído, deixando de funcionar em seguida. O comando é recusado enquanto um deploy estiver
em andamento e é executado com o seu login. Reivindicar um projeto também rotaciona sua
chave de serviço.

O preview de um backend inicia com as variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` define um valor próprio para os previews, `env unset KEY
--preview` remove a variável deles, `env reset KEY --preview` restaura o
valor de produção e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum desses comandos.

`env set KEY --stdin` lê o valor a partir da entrada padrão (stdin) em vez da
linha de comando, onde o `ps` e o histórico do seu shell poderiam exibi-lo:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é descartada. A ferramenta `rebase_cloud_env_set` do servidor MCP
define valores dessa forma.

## Organizações

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` cria um convite e exibe seu link: uso único,
válido por 7 dias, aceito apenas por uma conta que tenha verificado aquele endereço.
Ninguém entra na organização até aceitar, mesmo quem já possui uma conta Rebase.
A saída (e `emailDelivery` em `--json`) informa se o e-mail foi enviado; se não
foi, um aviso orienta você a enviar o link manualmente. `--role` pode ser `admin` ou
`member` (padrão). Ninguém pode ser convidado diretamente como `owner`: convide como admin e,
depois que a pessoa entrar, um proprietário pode promovê-la com `members role <email> owner`.
`invites resend` gera um novo link e invalida o anterior.
O envio de convites e o subcomando `invites` exigem uma sessão ativa de `rebase cloud login`; `REBASE_TOKEN` é
recusado. Convidar, listar, reenviar e revogar exigem a função de owner ou admin;
membros comuns são alertados sobre isso.
`members remove` pede confirmação antes (`--yes` ignora a pergunta); remover ou rebaixar um owner
requer privilégios de owner, e o último owner não pode ser removido. `--org <id>` seleciona uma organização
diferente da atualmente ativa.

`activity` é o log de auditoria da organização selecionada, do mais recente para o mais antigo: quem
fez deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (por
nome, nunca por valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou a
função de um membro, ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída exibe o cursor `--before` para a próxima página. `--json` é um único valor,
`{ org, events, nextCursor }`. Exige a função de owner ou admin da organização.
Um token só pode lê-lo com a permissão `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** no console
exibe o mesmo log.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint
público) até ser interrompido com Ctrl-C; `--reveal` inclui a senha. Exclusivo para owner ou admin.

## Guests

Cada chamada a `signInAnonymously()` em um teste, bot ou visita abandonada deixa uma
linha na tabela de usuários do projeto. Esses comandos contam essas linhas e as removem, para
que ninguém precise clicar nelas uma a uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita um período com unidade de tempo: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
apenas conta e não exclui nada. Ele processa projetos de qualquer tamanho em pequenos
lotes.

Apenas guests podem ser removidos. Um guest é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e a aplicação aplica essa regra na instrução que exclui a
linha, de forma que o comando não possa afetar uma conta real, mesmo que ela tenha se cadastrado logo
após ser listada. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Last seen** (visto por último) é o momento em que a sessão do guest foi emitida ou renovada pela última vez, ou quando
o guest foi criado, caso não reste nenhum token de atualização (refresh token). Um guest que continua
retornando não é considerado antigo, não importa há quanto tempo foi criado. Os tokens de atualização e
quaisquer outras linhas de autenticação de um guest excluído são removidos junto com ele.

As linhas nas suas próprias tabelas seguem a chave estrangeira:

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo esvaziado (nulo) |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o guest com ela: o guest é reportado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída junto com o guest |
| Sem chave estrangeira (um campo `userSelect`, um ID simples) | Mantida, contendo um ID que não existe mais |

Verifique quais dos seus vínculos utilizam exclusão em cascata (cascade) antes de passar `--yes`: essa ação não pode ser desfeita.

O comando passa pelo proxy do Studio no console, que armazena a chave do app, de forma que a chave nunca chega à sua
máquina. Requer um owner ou admin da organização, em um projeto cujo acesso ao Studio esteja ativado
(`rebase cloud settings set --studio on`). Um projeto em um runtime mais antigo será informado de que precisa de uma versão mais nova.
`rebase users guests --project <slug>` é o mesmo comando dentro do grupo de comandos do projeto.

## Recursos

O que a plataforma mantém para o projeto em comparação com o que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida do código —
isso equivaleria a dados sendo excluídos por um push. A plataforma o mantém, o vincula e o fatura até que alguém
o remova explicitamente pelo nome com o comando prune.

## Computação

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` foi descontinuado: todo backend executa pelo menos uma instância, portanto,
`true` é recusado e `false` é ignorado com um aviso. Não há níveis de planos
(tiers): tudo é tarifado por recurso. Consulte
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
apenas `{ "text" }` em vez do JSON do evento, que também inclui um `text`. A URL
é um argumento posicional porque `--url` especifica o plano de controle. `add` exibe
o segredo de assinatura uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` sai com código 1 e erro `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem está aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem a função de owner ou admin. Um token pode gerenciá-los com a
permissão `notifications` na organização, respeitando a mesma regra de funções. Consulte
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` atribui ao cluster
próprio de um cliente um registro de imagens exclusivo, utilizado apenas para esse cluster. Sem
ele, esse cluster usa o registro compartilhado da plataforma, e cada deploy realizado nele
informa isso em seu log. Com ele configurado, os builds enviam as imagens para esse repositório com um token para
aquela conta, os pods baixam as imagens apenas com essa chave e um rollback aceita as
imagens do projeto armazenadas lá. As imagens
que o projeto construiu anteriormente no repositório compartilhado continuam disponíveis para pull e permanecem
válidas como alvos de rollback. Os três valores devem ser fornecidos juntos; `--clear` os remove. A chave
é selada ao ser gravada e nunca mais pode ser lida. Como o restante dos comandos de `clusters`,
ele requer a função de platform-admin. O operador cria o repositório e ambas as
contas usando o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console e estão acessíveis apenas para owners e admins da
organização. Um token tem acesso a eles, e ao restante dos comandos de `billing`, com a permissão
`billing` na organização; um token criado antes dessa permissão continua
funcionando por uma versão, exibindo um aviso a cada resposta. Os valores em `--json` são expressos na menor unidade da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a prévia é calculada pelo
Stripe e seus itens tarifados por uso continuam crescendo até o fechamento do período.

`usage` lê o que o projeto vinculado (ou `--project`) utilizou em um mês
civil, em UTC: requisições em relação à cota inclusa, erros 5xx, o excedente
até o momento em euros e, para o mês em andamento, a projeção nesse
ritmo (uma estimativa). O excedente é o cálculo do próprio relatório de excedente —
aquele que informa ao Stripe o que cobrar e que constará na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use`, junto com o total. Qualquer membro da organização pode lê-lo. Um token pode lê-lo
com a permissão `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa permissão.
`--month` aceita um mês anterior. A resposta inclui `caveats`, cada um com um `code`: `storage_not_measured`
(o armazenamento de objetos retorna 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods de app estão em execução não são contadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (pods foram executados acima de `--replicas` e esta plataforma ainda não
os cobra). A resposta de um projeto com dimensionamento automático também inclui `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` em suas respectivas tarifas e `charged`.

## Deploy hooks, alertas e outros recursos

<span class="since-badge" data-since="0.32">Desde 0.32</span>

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`deploy-hooks create` exibe a URL do hook uma única vez. `deploy --git` não pode ser combinado com os sinalizadores de um build local e, no runtime gerenciado, exige `--eject`, pois o plano de controle compila a partir do código-fonte. `settings set --studio` é a opção que os comandos do projeto (`rebase data`, `rebase users`, …) precisam que esteja ativada para `--project`: eles acessam o app por meio do proxy do Studio no console. Um comando cuja rota no plano de controle ainda não foi implantada responde com `not_served` e informa o nome da rota. Comandos destrutivos pedem confirmação primeiro e recusam a execução com `confirmation_required` quando não há uma resposta interativa: use `--yes`.
