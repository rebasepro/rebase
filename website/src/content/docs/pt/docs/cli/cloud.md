---
sourceHash: 9d048d537401732a
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos do Rebase Cloud na CLI — autenticação, vinculação de projeto, deploys, notificações, configuração, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um sem vinculação.

Três opções se aplicam a todos os lugares: `--json` para saída legível por máquina (também o
padrão quando redirecionado por pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um
plano de controle específico (ou `REBASE_CLOUD_URL`) e `--project, -p <id>`.

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
`logs` também cobre `usage`. O alcance de cada um está em
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando o plano de
controle marca uma resposta a um token como descontinuada (um token anterior a `billing`
lendo faturamento), a CLI imprime o aviso uma vez no stderr, nunca no
valor `--json`.

Sem flags, `login` faz a autenticação pelo navegador. Ele imprime um código curto e
um link para o console, abre o navegador e aguarda enquanto você aprova o
login lá. Você já deve estar conectado ao console ou faz login com
qualquer método oferecido (senha, Google, GitHub, LinkedIn). Verifique se o
navegador mostra o mesmo código antes de aprová-lo. O link expira após dez
minutos e funciona uma única vez. Sem um terminal, ou com `--json`, o link e o código
vão para o stderr e o `login` continua aguardando, para que um agente possa entregar o link a você. Um
login negado é encerrado com `access_denied`, e um expirado com `expired_token`.

Com `--email`, o `login` pergunta se deseja usar sua senha ou um código que o plano de
controle envia por e-mail. Com a autenticação de dois fatores ativada, ele solicita o
código do autenticador (ou um código de recuperação); pelo navegador, aprove a partir de uma
sessão do console que o utilizou. Sem um terminal, nenhum dos códigos pode ser digitado: defina
`REBASE_TOKEN` com um token de acesso criado no console em Settings → Access
tokens. Consulte [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Connect a self-hosted instance to Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

O [conector do Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
então o acessa junto com seus projetos do Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; defina-os no
servidor e reinicie-o. Na pasta do projeto, ele oferece gravá-los no
`.env`. Executá-lo novamente é seguro. `--name` nomeia a instância, `--org` seleciona a
organização, `--no-wait` retorna sem esperar. Proprietários e administradores.

## Projects

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
diretório e o tempo restante antes de ser excluído sem reivindicação (`Unclaimed: deleted
in 41h`). `--open` também o abre em um navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o plano de
controle armazena um hash dele e não pode imprimi-lo novamente. Antes de responder, o `claim`
pergunta ao plano de controle se o token do próprio projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, assim que alguém reivindicar o projeto, o `claim` recusa
com `already_claimed` em vez de imprimir um link inativo. Ele também recusa quando a
janela termina (`claim_expired`) e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostram o mesmo
link enquanto o projeto não for reivindicado.

## Deploy and observe

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

`deploy` sem o nome do app faz o deploy do backend. O deploy do bundle de backend
também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para
que uma atualização de plataforma possa recompilá-lo; `--no-source` pula isso uma vez, e `cloud settings set
--platform-rebuilds off` desativa essa função e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão anterior.

Um `deploy` acompanhado termina com um resumo: cada app enviado com sua URL, o
ID do deployment, quanto tempo levou e se a nova versão responde lá. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` pula a verificação) para o
`/health` de um backend e o endereço de cada app estático responderem. Um deploy com falha
termina em uma linha nomeando o app e o motivo, saindo com código diferente de zero. O resumo
é impresso mesmo quando redirecionado por pipe; `--json` (ou `REBASE_JSON=1`) imprime um único objeto,
com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Antes do upload, o `deploy` analisa o JavaScript de cada app estático enviado:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos `<script>` inline em
seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código
`syntax_error` com `--json`), e `--no-verify` pula a verificação. Um deploy bem-sucedido
termina com o caminho de volta, `rebase cloud rollback`. Um app estático implantado de
forma isolada ainda não pode sofrer rollback; consulte
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza o build em `https://<project>--<name>.rebase.website` e
mantém a produção intocada. Uma prévia do backend executa seu próprio backend, em um
banco de dados próprio e vazio, com seus apps estáticos integrados. Um app estático não pode ter
prévia isolada no Rebase Cloud ainda: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Uma prévia de backend
é cobrada como uma unidade de app adicional no tamanho padrão enquanto existir, e
o deploy informa quanto isso custa por mês, a partir da cotação do próprio plano de controle
(`cost` sob `--json`; apenas a regra e este link quando o plano de controle não puder
precificar); `rebase cloud previews delete <name>` a interrompe. `rebase cloud previews`
mostra uma prévia pausada pela plataforma (seu banco de dados cresceu além do limite de prévia) como
`paused`, com o motivo (`statusMessage` sob `--json`). Um novo endereço de prévia
pode ser recusado com `preview_cert_budget` quando o orçamento semanal de certificados
de prévia da plataforma for esgotado; a mensagem informa até quando.
Consulte [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime o log de build mais recente, e `-f` acompanha um build que
ainda está em execução. `--runtime` lê o que o app imprime, de cada pod
por trás dele, com cada linha identificada pelo seu pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário no formato RFC3339.
- `--tail <n>` é o número de linhas por pod a partir do qual iniciar (o plano de controle limita em 2000).
- `--grep` mantém linhas que contêm o texto, sem diferenciar maiúsculas/minúsculas; use `/re/flags` para
  uma expressão regular.
- `--level error|warn|info|debug` mantém linhas com essa severidade ou pior. Ele lê a
  `severity` estruturada registrada por um backend do Rebase, uma palavra de nível no início de uma
  linha simples ou um formato de erro como `TypeError:`. Linhas sem isso são omitidas.

O acompanhamento contínuo (follow) consulta a cada dois segundos e imprime cada linha uma vez. Ele anuncia pods
que iniciam, param ou reiniciam. Quando um contêiner reinicia, ele também imprime as últimas
linhas da instância que falhou, onde geralmente está o motivo. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma conexão perdida, tenta novamente com backoff e
retoma de onde parou. Com `--json`, o acompanhamento imprime um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para o restante.

`--preview <name>` lê uma prévia em vez da produção. Use o nome da
prévia ou o ID de deployment impresso pelo deploy da prévia. Sozinho, `--preview`
lê a única prévia do projeto. Uma prévia estática possui log de build, mas nenhum
log de runtime, pois não executa nenhum servidor.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` lista a
chave criada por `rebase cloud init --claim` no app e gravada no `.env` como
`REBASE_API_TOKEN`, pelo seu prefixo e nunca pelo seu valor. Reivindicar o projeto
transfere essa chave e ela deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agente anteriores de uma só vez. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN` e a mantém fora do `--json` nesse caso. Em
qualquer outro diretório, ele imprime a chave uma vez. As chaves criadas no painel de administração
do app não são alteradas. Ele roda com o seu login: nenhuma permissão de token a concede.

`service-key`
imprime a geração da `REBASE_SERVICE_KEY` do projeto, quando foi rotacionada pela
última vez e se o app ainda está reiniciando com a mais recente. Ele nunca
imprime a chave: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia o app com ela. A chave antiga funciona até a
conclusão da reinicialização, e nunca mais depois. O comando é recusado enquanto um deploy estiver
em andamento e roda com o seu login. Reivindicar um projeto também rotaciona sua
chave de serviço.

Uma prévia de backend começa a partir das variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` define um valor específico para prévias, `env unset KEY
--preview` remove a variável delas, `env reset KEY --preview` restaura
o valor de produção e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum deles.

`env set KEY --stdin` lê o valor da entrada padrão em vez da
linha de comando, onde `ps` e o histórico do seu shell poderiam exibi-lo:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é descartada. O `rebase_cloud_env_set` do servidor MCP define
valores dessa forma.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` cria um convite e imprime seu link: uso único,
válido por 7 dias, aceito apenas por uma conta que tenha verificado esse endereço.
Ninguém entra até aceitar, mesmo alguém que já tenha uma conta Rebase.
A saída (e `emailDelivery` no `--json`) informa se ele foi enviado por e-mail; quando
não tiver sido, um aviso indica para você mesmo enviar o link. `--role` é `admin` ou
`member` (padrão). Ninguém é convidado como `owner`: convide-os como admin, e
um proprietário os promove com `members role <email> owner` após terem entrado.
`invites resend` gera um novo link e o antigo para de funcionar.
Convidar e usar `invites` exigem uma sessão de `rebase cloud login`; `REBASE_TOKEN` é
recusado. Convidar, listar, reenviar e revogar exigem a função de owner ou admin;
um membro é avisado caso tente.
`members remove` solicita confirmação antes (`--yes` pula a pergunta); remover ou rebaixar um proprietário
exige ser um proprietário, e o último proprietário permanece. `--org <id>` escolhe uma organização
diferente da selecionada.

`activity` é o registro de auditoria da organização selecionada, do mais recente para o mais antigo: quem
fez deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (por
nome, nunca por valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou a
função de um membro, ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída imprime o cursor `--before` para a próxima página. `--json` é um único valor,
`{ org, events, nextCursor }`. Requer a função de proprietário ou administrador da organização.
Um token o lê apenas com a capacidade `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
mostra o mesmo registro.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint
público) até Ctrl-C; `--reveal` adiciona a senha. Apenas proprietário ou administrador.

## Guests

Cada `signInAnonymously()` em um teste, bot ou visita abandonada deixa uma linha
nos usuários do projeto. Esses comandos contam essas linhas e as removem, para
que ninguém precise clicar nelas uma a uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita um período com unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
conta e não exclui nada. Ele processa um projeto de qualquer tamanho em pequenos
lotes.

Apenas convidados podem ser removidos. Um convidado é uma linha com `is_anonymous` definido, sem senha e sem
identidade vinculada, e o app aplica essa regra na instrução que exclui a
linha, de modo que o comando não possa atingir uma conta, mesmo uma que tenha se cadastrado um
momento após ter sido listada. `delete` recusa uma conta com `NOT_ANONYMOUS`.

**Visto pela última vez** é quando a sessão do convidado foi emitida ou atualizada pela última vez, ou quando
o convidado foi criado se não restar nenhum refresh token. Um convidado que continua retornando
não é considerado antigo, independentemente de quando foi criado. Os refresh tokens e quaisquer outras linhas
de autenticação de um convidado excluído são removidos com ele.

Linhas em suas próprias tabelas seguem sua chave estrangeira:

| A coluna | O que acontece com a linha |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, o padrão) | Mantida, com o vínculo esvaziado |
| Vínculo obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantida, e o convidado com ela: o convidado é reportado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluída junto com o convidado |
| Sem chave estrangeira (um campo `userSelect`, um id simples) | Mantida, contendo um id que não existe mais |

Verifique quais de seus vínculos são em cascata antes de passar `--yes`: isso não pode ser desfeito.

O comando lê `REBASE_SERVICE_KEY` da mesma forma que `env reveal` faz, portanto, requer um
proprietário ou administrador (ou um token com a permissão `env` que pertença a um). A
chave permanece na memória e vai apenas para o endereço do próprio projeto. Um projeto em um
runtime mais antigo é avisado de que precisa de um mais recente.

## Resources

O que a plataforma mantém para o projeto, em comparação com o que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
seria apagar dados por meio de um push. Ele o mantém, vincula e cobra até que alguém
o remova pelo nome com prune.

## Compute

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` foi descontinuado: todo backend executa pelo menos uma instância, portanto,
`true` é recusado e `false` é ignorado com um aviso. Não há níveis de
plano: tudo é precificado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

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
apenas `{ "text" }` em vez do JSON do evento, que também contém um `text`. A URL
é um argumento posicional porque `--url` especifica o plano de controle. `add` imprime
o segredo de assinatura uma única vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` sai com código 1 e código de erro `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem é aberta a qualquer membro da organização; `add`, `test`
e `remove` exigem a função de proprietário ou administrador. Um token os gerencia com a
permissão `notifications` na organização, sob a mesma regra de função. Consulte
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` fornece ao cluster
próprio de um cliente um registro de imagens próprio, usado apenas para aquele cluster. Sem
um, tal cluster usa o registro compartilhado da plataforma, e cada deploy para ele
indica isso em seu log. Com um, os builds fazem push para esse repositório com um token para
essa conta, os pods fazem pull apenas com essa chave e um rollback aceita as
imagens do projeto lá. As imagens
que o projeto criou anteriormente no repositório compartilhado continuam disponíveis para pull e continuam
sendo alvos de rollback. Os três valores devem ser fornecidos juntos; `--clear` os remove. A chave
é selada quando gravada e nunca mais é lida de volta. Como o restante de `clusters`,
requer a função platform-admin. O operador cria o repositório e ambas as contas
com o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leem os mesmos dados da Stripe que a
página Billing do console e são abertos apenas para proprietários e administradores da
organização. Um token os acessa, assim como o restante de `billing`, com a
permissão `billing` na organização; um token criado antes dessa permissão continua
funcionando por mais uma versão, com um aviso a cada resposta. Os valores em `--json` estão na unidade fracionária da moeda (centavos), exatamente como a
Stripe os envia. Faturas em rascunho não são listadas; a prévia é calculada pela
Stripe e suas linhas medidas continuam crescendo até o fechamento do período.

`usage` lê o que o projeto vinculado (ou `--project`) utilizou em um mês
civil, em UTC: requisições em relação à cota incluída, erros 5xx, o excedente
até o momento em euros e, para o mês em andamento, para onde está caminhando nesse
ritmo (uma estimativa). O excedente é o cálculo do próprio relatório de excedentes,
aquele que informa à Stripe o que cobrar, e é lançado na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use`, além do total. Qualquer membro da organização pode lê-lo. Um token o lê
com a permissão `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa permissão.
`--month` aceita um mês anterior. A resposta traz `caveats`, cada um com um `code`: `storage_not_measured`
(o armazenamento de objetos lê 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods de app estão em execução não são contadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (os pods rodaram acima de `--replicas` e esta plataforma ainda não os
cobra). A resposta de um projeto com dimensionamento automático também traz `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` às suas taxas e `charged`.
