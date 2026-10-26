---
sourceHash: 60c333829202e6eb
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, vínculo de projetos, deploys, notificações, configuração, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Todos os grupos respondem a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam globalmente: `--json` para saída legível por máquina (também o padrão quando usado com pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um control plane específico (ou `REBASE_CLOUD_URL`) e `--project, -p <id>`.

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
(`--project`, ou o vinculado), e <span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `billing`, `audit` e
`notifications` em uma organização: `--org`, senão a organização do projeto,
senão a selecionada. Um token pode conter apenas permissões de organização.
`logs` também cobre `usage`. O que cada uma alcança está em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents). Quando o plano
de controle marca uma resposta a um token como obsoleta (um token de antes de `billing`
passar a ler o faturamento), a CLI imprime o aviso uma vez no stderr, nunca no
valor de `--json`.

Em um terminal sem senha informada, <span class="since-badge" data-since="0.26">A partir da versão 0.26</span> o `login` pergunta se deve usar a sua senha
ou um código que o plano de controle envia por e-mail. Com a autenticação de dois fatores ativada, ele
então pede o seu código do autenticador (ou um código de recuperação). Sem um terminal,
nenhum dos dois pode ser digitado: defina `REBASE_TOKEN` com um token de acesso criado no console
em Settings → Access tokens. Veja [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Vínculo de projeto

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

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `claim` imprime o link de reivindicação do projeto que `init --claim` provisionou neste
diretório, e o tempo restante antes de ele ser excluído sem reivindicação (`Unclaimed: deleted
in 41h`). `--open` também o abre em um navegador. O link é guardado apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o plano de
controle armazena um hash dele e não pode imprimi-lo de novo. Antes de responder, `claim`
pergunta ao plano de controle se o token do próprio projeto ainda funciona. Uma reivindicação
revoga esse token, então, depois que alguém reivindica o projeto, `claim` recusa
com `already_claimed` em vez de imprimir um link morto. Também recusa quando a
janela terminou (`claim_expired`), e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostram o mesmo
link enquanto o projeto não é reivindicado.

## Deploy e observação

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
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sem o nome de uma aplicação faz o deploy do backend. Um deploy de
bundle do backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma
atualização da plataforma possa reconstruí-lo; `--no-source` ignora isso uma vez, e `cloud settings set
--platform-rebuilds off` desativa isso e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão anterior.

Um `deploy` acompanhado termina com um resumo: cada app implantado com sua URL, o id do deploy, quanto tempo levou e se a nova versão responde ali. Ele espera até `--live-timeout` segundos (60 por padrão; `0` pula a verificação) que o `/health` do backend e o endereço de cada app estático respondam. Um deploy que falhou termina com uma linha que nomeia o app e o motivo, e sai com código diferente de zero. O resumo é impresso também com pipe; `--json` (ou `REBASE_JSON=1`) imprime em vez disso um objeto com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Antes do upload, `deploy` analisa o JavaScript de cada app estático que publica: os arquivos `.js`/`.mjs`/`.cjs` no seu `output` e os blocos `<script>` inline do seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código `syntax_error` com `--json`), e `--no-verify` pula a verificação. Um deploy bem-sucedido termina com o caminho de volta, `rebase cloud rollback`. Um app estático implantado sozinho ainda não pode ter rollback; veja [Rollback](/docs/deployment/cloud#roll-back).

`--preview` serve o build em `https://<project>--<name>.rebase.website` e
deixa a produção intacta. Um preview do backend executa o seu próprio backend, em um
banco de dados vazio e só dele, com seus apps estáticos incorporados. Um app estático não pode ser
visualizado sozinho no Rebase Cloud ainda: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Um preview
de backend é cobrado como mais uma unidade de app no tamanho padrão enquanto existir, e
o deploy informa quanto isso dá por mês, a partir da própria cotação do plano de controle
(`cost` com `--json`; apenas a regra e este link quando o plano de controle não consegue
precificá-lo); `rebase cloud previews delete <name>` o interrompe. `rebase cloud previews`
mostra um preview que a plataforma pausou (seu banco de dados passou do limite de preview) como
`paused`, com o motivo (`statusMessage` com `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando o orçamento semanal de certificados
de preview da plataforma se esgota; a mensagem diz até quando.
Veja [Pré-visualizar uma mudança](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime o log de build mais recente, e `-f` acompanha um build que ainda
está em andamento. `--runtime` lê o que o app imprime, de todos os pods
por trás dele, cada linha marcada com o seu pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário RFC3339.
- `--tail <n>` é o número de linhas por pod a partir do qual começar (o plano de controle limita a 2000).
- `--grep` mantém as linhas que contêm o texto, sem distinguir maiúsculas de minúsculas; escreva `/re/flags` para uma
  expressão regular.
- `--level error|warn|info|debug` mantém as linhas com essa severidade ou pior. Ele lê
  o `severity` estruturado que um backend Rebase registra, uma palavra de nível no início de uma
  linha simples, ou um formato de erro como `TypeError:`. As linhas sem nenhum deles ficam de fora.

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> Um follow consulta a cada dois segundos e imprime cada linha uma vez. Ele avisa os pods
que iniciam, param ou reiniciam. Quando um contêiner reinicia, ele também imprime as últimas
linhas da instância que morreu, onde geralmente está o motivo. Ele espera enquanto nenhum
pod está em execução, e depois de uma conexão interrompida tenta de novo com backoff e
retoma de onde parou. Com `--json`, um follow imprime um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para o resto.

`--preview <name>` lê um preview em vez da produção. Use o nome do preview,
ou o id de deploy que um deploy de preview imprimiu. Sozinho, `--preview`
lê o único preview do projeto. Um preview estático tem um log de build, mas nenhum log
de runtime, porque não executa nenhum servidor.

## Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `app-key` lista a
chave que `rebase cloud init --claim` criou no app e gravou no `.env` como
`REBASE_API_TOKEN`, pelo prefixo e nunca pelo valor. Reivindicar o projeto
entrega essa chave e ela deixa de expirar. `app-key rotate` cria uma nova e
revoga de uma vez todas as chaves de agente anteriores. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN`, e a mantém fora do `--json` nesse caso. Em
qualquer outro diretório, imprime a chave uma vez. As chaves criadas no painel de administração
do app não são tocadas. Ele roda com o seu login: nenhuma permissão de token o concede.

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `service-key`
imprime a geração da `REBASE_SERVICE_KEY` do projeto, quando foi rotacionada
pela última vez, e se o app ainda está reiniciando para a mais recente. Ele nunca
imprime a chave: isso é `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia o app com ela. A chave antiga funciona até o fim
da reinicialização, e nada depois. Ele é recusado enquanto um deploy está
em andamento, e roda com o seu login. Reivindicar um projeto também rotaciona a
service key.

Um preview do backend parte das variáveis da produção, chaves live incluídas.
`env set KEY=VALUE --preview` dá aos previews o seu próprio valor, `env unset KEY
--preview` deixa a variável fora deles, `env reset KEY --preview` devolve
o valor da produção, e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum deles.

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `env set KEY --stdin` lê o valor da entrada padrão em vez da
linha de comando, onde `ps` e o histórico do seu shell o mostrariam:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é descartada. A ferramenta `rebase_cloud_env_set` do servidor MCP define
valores dessa forma.

## Organizações

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `members invite` abre um convite e imprime seu link: de uso único,
válido por 7 dias, aceito apenas por uma conta que tenha verificado esse endereço.
Ninguém entra até aceitar, nem mesmo quem já tem uma conta Rebase.
A saída (e `emailDelivery` em `--json`) diz se ele foi enviado por e-mail; quando
não foi, um aviso diz para enviar o link você mesmo. `--role` é `admin` ou
`member` (padrão). Ninguém é convidado como `owner`: convide-o como admin, e
um owner o promove com `members role <email> owner` depois que ele entrar.
`invites resend` gera um novo link e o antigo deixa de funcionar.
Convidar e `invites` exigem uma sessão de `rebase cloud login`; `REBASE_TOKEN` é
recusado. Convidar, listar, reenviar e revogar exigem o papel de owner ou admin;
um membro é informado disso.
`members remove` pergunta antes (`--yes` pula a pergunta); remover ou rebaixar um owner
exige um owner, e o último owner permanece. `--org <id>` escolhe uma organização
diferente da selecionada.

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `activity` é o log de auditoria da organização selecionada, do mais recente para o mais antigo: quem
fez deploy, rollback, definiu, excluiu ou revelou uma variável de ambiente (pelo
nome, nunca pelo valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou excluiu um projeto, alterou o papel de um
membro, ou criou ou revogou um token de acesso. `--action` aceita uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Uma página comporta até 100 entradas (`--limit`, padrão 50); a
saída imprime o cursor `--before` para a próxima. `--json` é um único valor,
`{ org, events, nextCursor }`. Exige o papel de owner ou admin da organização.
Um token só o lê com a permissão `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
mostra o mesmo log.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem
endpoint público) até Ctrl-C; `--reveal` adiciona a senha. Apenas para proprietário ou admin.

## Recursos

O que a plataforma mantém para o projeto, em comparação com o que seu código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração deixa de existir — isso
seria excluir dados por meio de um push. Ele o mantém, vincula e fatura até que alguém
faça a remoção (prune) pelo nome.

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
`true` é recusado e `false` é ignorado com um aviso. Não há níveis de
plano: tudo é precificado por recurso. Consulte o
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

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `notifications add <url>` envia os eventos do projeto vinculado a uma URL. `--events`
aceita uma lista separada por vírgulas de `deploy.failed` (o padrão),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` envia
apenas `{ "text" }` em vez do JSON do evento, que também carrega um `text`. A URL
é um argumento posicional porque `--url` nomeia o plano de controle. `add` imprime
o segredo de assinatura uma vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` encerra com 1 e o código `delivery_failed` quando o receptor não aceitou
o evento de teste. Listar é permitido a qualquer membro da organização; `add`, `test`
e `remove` exigem o papel de owner ou admin. Um token os gerencia com a
permissão `notifications` na organização, dentro da mesma regra de papel. Veja
[Cloud notifications](/docs/deployment/cloud-notifications/).

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` dá ao cluster próprio
de um cliente um registro de imagens só dele, usado apenas por esse cluster. Sem
um, esse cluster usa o registro compartilhado da plataforma, e todo deploy nele
diz isso em seu log. Com um, os builds fazem push para esse repositório com um token para
essa conta, os pods fazem pull somente com essa chave, e um rollback aceita as
imagens do projeto ali. As imagens
que o projeto construiu antes no repositório compartilhado continuam acessíveis para pull e continuam
sendo alvos de rollback. Os três valores andam juntos; `--clear` os esquece. A chave
é selada quando é gravada e nunca lida de volta. Como o resto de `clusters`,
exige o papel de administrador da plataforma. O operador cria o repositório e as duas
contas com Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console, e são abertos apenas aos owners e admins da organização.
Um token os alcança, e o resto de `billing`, com a permissão
`billing` na organização; um token criado antes dessa permissão continua
funcionando por uma versão, com um aviso em cada resposta. Os valores em `--json` estão na menor unidade da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a prévia é calculada pelo
Stripe e suas linhas medidas continuam crescendo até o período fechar.

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `usage` lê o que o projeto vinculado (ou `--project`) usou em um mês
civil, em UTC: requisições em relação à franquia incluída, erros 5xx, o excedente
até agora em euros e, para o mês em andamento, para onde ele caminha neste
ritmo (uma estimativa). O excedente é o cálculo do próprio relatório de excedente, aquele
que diz ao Stripe o que cobrar, e entra na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada com `rebase cloud
use`, e o total. Qualquer membro da organização pode lê-lo. Um token o lê
com a permissão `logs` no projeto; `usage org` lista os projetos em que o
token possui essa permissão.
`--month` aceita um mês passado. A resposta traz `caveats`, cada um com um `code`: `storage_not_measured`
(o armazenamento de objetos lê 0), `multi_pod_undercount` (requisições atendidas enquanto dois ou
mais pods do app executam não são contadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação) e
`autoscale_not_charged` (pods executaram acima de `--replicas` e esta plataforma ainda não
os cobra). A resposta de um projeto com autoscaling também traz `autoscale`:
`extraPodSeconds` acima do piso, `amountEur` nas suas tarifas, e `charged`.
