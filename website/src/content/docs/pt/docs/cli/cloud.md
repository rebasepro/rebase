---
sourceHash: ea9a6d9deb4ba31b
title: rebase cloud
sidebar_label: rebase cloud
description: Os grupos de comandos para o Rebase Cloud na CLI — autenticação, link de projetos, deploys, notificações, configuração, organizações, bancos de dados, recursos, computação, armazenamento, clusters, faturamento e uso.
---

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um sem vinculação.

Três opções se aplicam a todos os lugares: `--json` para saída legível por máquina (também o
padrão quando redirecionado por pipe, exceto para `deploy`, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a
um control plane específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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
`logs` também abrange `usage`. O alcance de cada um está em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents). Quando o control
plane marca uma resposta a um token como obsoleta (um token anterior a `billing`
lendo faturamento), a CLI exibe o aviso uma vez no stderr, nunca no
valor de `--json`.

Sem flags, `login` faz a autenticação pelo navegador. Ele exibe um código curto e
um link para o console, abre o navegador e aguarda enquanto você aprova o
login lá. Você já deve estar autenticado no console, ou pode entrar com
qualquer método oferecido (senha, Google, GitHub, LinkedIn). Verifique se o
navegador mostra o mesmo código antes de aprová-lo. O link expira após dez
minutos e funciona apenas uma vez. Sem um terminal, ou com `--json`, o link e o código
vão para o stderr e o `login` continua aguardando, para que um agente possa fornecer o link a você. Um
login negado encerra com `access_denied`, e um expirado com `expired_token`.

Com `--email`, o `login` pergunta se deseja usar sua senha ou um código enviado por e-mail pelo
control plane. Com a autenticação de dois fatores ativada, ele solicita o código do seu
autenticador (ou um código de recuperação); pelo navegador, aprove a partir de uma
sessão do console que a utilizou. Sem um terminal, nenhum código pode ser digitado: defina
`REBASE_TOKEN` para um token de acesso criado no console em Settings → Access
tokens. Consulte [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Link de projeto

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
último caso, eles informam qual foi utilizada. `orgs delete` nunca obtém a organização
a partir do vínculo: ele precisa de `--org` ou de uma organização selecionada.

### Conectar uma instância auto-hospedada ao Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

O [conector do Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
então a alcança junto aos seus projetos Cloud. O comando `connect` exibe
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; defina-as no
servidor e reinicie-o. Na pasta do projeto, ele oferece gravá-las no
`.env`. Executá-lo novamente é seguro. `--name` nomeia a instância, `--org` seleciona a
organização, `--no-wait` retorna sem aguardar. Exclusivo para proprietários (owners) e administradores (admins).

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
diretório, e o tempo restante antes que ele seja excluído sem reivindicação (`Unclaimed: deleted
in 41h`). `--open` também o abre em um navegador. O link é mantido apenas na
máquina que executou `init --claim`, em `~/.rebase/credentials.json`; o control
plane armazena um hash dele e não pode exibi-lo novamente. Antes de responder, `claim`
pergunta ao control plane se o próprio token do projeto ainda funciona. Uma reivindicação
revoga esse token, portanto, assim que alguém reivindica o projeto, `claim` recusa
com `already_claimed` em vez de exibir um link inativo. Ele também recusa após o término
da janela de tempo (`claim_expired`), e em um diretório sem link de reivindicação
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` exibem o mesmo
link enquanto o projeto não for reivindicado.

`projects transfer` move um projeto para outra organização, sem alterações: o
mesmo id, endereço, domínios personalizados, banco de dados, armazenamento, variáveis de ambiente e
deploys. Apenas quem o possui, quem pode vê-lo e quem paga por ele mudam. Você
deve ser proprietário ou administrador de ambas as organizações e estar autenticado com `rebase cloud login`;
um token de acesso não pode mover um projeto. O destino será cobrado a partir de então,
portanto, uma organização sem cartão cadastrado (e não faturada internamente) recusa a transferência e
nada muda. Um projeto que ainda aguarda para ser reivindicado é transferido pelo seu link de reivindicação.
O console possui a mesma ação em Settings do projeto, na danger zone.

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
rebase cloud sleep [status|on|off|wake]  # sleep when idle; `on --after 15m|30m|1h|4h`
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sem o nome de uma aplicação faz o deploy do backend. Um deploy de pacote
do backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma
atualização da plataforma possa reconstruí-lo; `--no-source` ignora isso uma vez, e `cloud settings set
--platform-rebuilds off` desativa isso e exclui a cópia armazenada. `--allow-downgrade` faz o deploy de uma versão mais antiga.

Uma atualização da plataforma pode reconstruir uma aplicação gerenciada em uma versão do `@rebasepro` mais recente
do que a versão fixada no seu repositório local. Um deploy a partir desse repositório colocaria o painel de administração
e o driver mais antigos de volta, portanto ele é recusado antes de qualquer compilação, com o
comando que corrige isso (`rebase upgrade --to <version>`). `rebase cloud status`
informa a mesma coisa antecipadamente: uma linha `Rebuilt on` e, em `--json`,
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Um `deploy` acompanhado termina com um resumo: cada aplicação entregue com sua URL, o
id do deployment, quanto tempo levou e se a nova versão responde nesse endereço. Ele
aguarda até `--live-timeout` segundos (padrão 60; `0` ignora a verificação) para que o `/health`
de um backend e o endereço de cada aplicação estática respondam. Um deploy que falha
termina com uma linha informando a aplicação e o motivo, e encerra com código diferente de zero. O resumo
é exibido mesmo em pipe; `--json` (ou `REBASE_JSON=1`) gera um único objeto,
com `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Um host cujo certificado
HTTPS ainda não foi emitido é reportado como não ativo (not live), com o respectivo motivo.

Antes do upload, `deploy` analisa o JavaScript de cada aplicação estática enviada:
os arquivos `.js`/`.mjs`/`.cjs` em seu `output` e os blocos `<script>` inline
em seu HTML. Um erro de sintaxe interrompe o deploy com `file:line:column` (código
`syntax_error` em `--json`), e `--no-verify` ignora essa verificação. Um deploy
bem-sucedido termina mostrando o caminho de retorno, `rebase cloud rollback`. Uma aplicação estática publicada
individualmente ainda não pode sofrer rollback; consulte
[Reverter alterações](/docs/deployment/cloud#roll-back).

`--preview` disponibiliza o build em `https://<project>--<name>.rebase.website` e
mantém a produção intocada. Um preview do backend executa seu próprio backend, em um
banco de dados próprio e vazio, com suas aplicações estáticas integradas. Uma aplicação estática não pode ser
pré-visualizada individualmente no Rebase Cloud ainda: `rebase cloud deploy <app> --preview`
é recusado com `PREVIEW_STATIC_UNSERVED` e não publica nada. Um preview
de backend é cobrado como mais uma unidade de aplicação no tamanho padrão enquanto existir, e
o deploy informa quanto isso custa por mês, a partir da cotação do próprio control plane
(`cost` sob `--json`; apenas a regra e este link quando o control plane não puder
calcular o preço); `rebase cloud previews delete <name>` o interrompe. `rebase cloud previews`
mostra um preview pausado pela plataforma (cujo banco de dados ultrapassou o limite de preview) como
`paused`, acompanhado do motivo (`statusMessage` sob `--json`). Um novo endereço de preview
pode ser recusado com `preview_cert_budget` quando a cota semanal de certificados de preview
da plataforma for atingida; a mensagem informa até quando.
Consulte [Pré-visualizar uma alteração](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` exibe o log de build mais recente, e `-f` acompanha um build que
ainda está em execução. `--runtime` lê o que a aplicação imprime em tempo de execução, de cada pod
ativo, com cada linha identificando seu pod quando mais de um tiver gravado:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
rebase cloud logs --runtime --raw                 # the lines exactly as the pods wrote them
```

- `--since` aceita uma duração (`30s`, `5m`, `1h`) ou um horário no formato RFC3339.
- `--tail <n>` define a quantidade de linhas por pod para iniciar (o control plane limita em 2000).
- `--grep` mantém as linhas que contêm o texto, sem diferenciar maiúsculas de minúsculas; use `/re/flags` para uma
  expressão regular.
- Com `--grep` ou `--level`, o filtro pesquisa em todas as linhas retornadas pelo control plane
  para o intervalo (as 2000 mais recentes de cada pod), e `--tail` conta as linhas
  correspondentes: as `n` correspondências mais recentes por pod, 500 por padrão. Quando um pod tiver mais
  linhas no intervalo do que isso, a saída informará que as mais antigas não foram
  pesquisadas (`filter.scanCapped` sob `--json`).
- `--level error|warn|info|debug` mantém as linhas com essa severidade ou pior. Ele interpreta
  a `severity` estruturada registrada por um backend Rebase, uma palavra de nível no início de uma
  linha simples, ou um padrão de erro como `TypeError:`. Linhas sem nenhuma dessas informações são omitidas.
- Uma linha estruturada é exibida de forma legível: `14:30:32.126 WARN  [boot] Driver version skew …  fix="bump …"`, e uma requisição como `GET /api/data/rooms/RCTF 404 16ms  requestId=…`. `--raw` imprime cada linha exatamente como o pod gravou; linhas em texto simples são impressas sem alterações em ambos os casos, e `--json` sempre transporta as linhas originais.

Um acompanhamento contínuo (`follow`) faz verificações a cada dois segundos e imprime cada linha uma vez. Ele anuncia pods
que iniciam, param ou reiniciam. Quando um contêiner reinicia, ele também imprime as últimas
linhas da instância encerrada, onde o motivo geralmente se encontra. Ele aguarda enquanto nenhum
pod estiver em execução e, após uma queda de conexão, tenta reconectar com backoff e
retoma de onde parou. Com `--json`, o acompanhamento gera um objeto JSON por
linha (NDJSON): `{"type":"line","ts","pod","text"}` para cada linha de log, e
`{"type":"event","event":…}` para o restante.

`--preview <name>` lê um preview em vez da produção. Use o nome do
preview ou o id de deployment informado pelo deploy de preview. Isoladamente, `--preview`
lê o único preview do projeto. Um preview estático tem log de build, mas não tem
log de runtime, pois não executa nenhum servidor.

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

`domains add` para um host que o projeto já possui, como um que um deploy
registrou a partir do `rebase.json`, imprime os registros DNS e o status do host assim como
uma nova adição faria; `--json` adiciona `alreadyRegistered: true`. Um host verificado passa a ser
atendido via HTTPS assim que seu certificado for emitido, alguns minutos após a
verificação. Até lá, o ingress responde com um certificado temporário,
e `domains list`, `domains verify` e `status` informam
`verified, certificate pending` em vez de ativos. A CLI detecta isso por meio de
um handshake TLS com cada host verificado; `--json` inclui isso como `certificate`
(`ready`, `pending` ou `unreachable`, com um `reason`).

`app-key` lista a
chave que `rebase cloud init --claim` gerou na aplicação e salvou no `.env` como
`REBASE_API_TOKEN`, exibindo seu prefixo e nunca seu valor. Ao reivindicar o projeto,
essa chave é transferida e deixa de expirar. `app-key rotate` gera uma nova chave e
revoga todas as chaves de agentes anteriores simultaneamente. Ele grava a nova chave em um `.env`
que já define `REBASE_API_TOKEN`, e a oculta do `--json` nesse local. Em
qualquer outro diretório, ele imprime a chave apenas uma vez. As chaves criadas no painel de administração da aplicação
não são modificadas. Ele opera com seu login: nenhuma permissão de token concede acesso a ele.

`service-key`
informa a geração da `REBASE_SERVICE_KEY` do projeto, quando foi
rotacionada pela última vez e se a aplicação ainda está reiniciando para a mais recente. Ele nunca
imprime a chave: para isso use `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite uma nova chave e reinicia a aplicação com ela. A chave antiga funciona até que a
reinicialização seja concluída, perdendo a validade em seguida. É recusado durante a execução de um deploy
e opera com seu login. Ao reivindicar um projeto, sua chave de serviço
também é rotacionada.

Um preview de backend possui uma chave de serviço própria. Seu primeiro deploy a cria,
novos deploys a mantêm, e a chave de produção responde 401 no preview.
`service-key --preview <name>` a exibe, assim como `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
gera uma nova e reinicia apenas o pod daquele preview; a chave antiga funciona até que
o novo pod esteja pronto. Uma confirmação é solicitada antes, e `--yes` ignora a pergunta. Ambos exigem
o que `env reveal` exige: papel de owner ou admin na organização e, no caso de um
token de acesso, a permissão `env` em um projeto reivindicado. A chave e o
pod de produção não são afetados.

Um preview de backend é iniciado a partir das variáveis de produção, incluindo chaves ativas.
`env set KEY=VALUE --preview` atribui um valor específico aos previews, `env unset KEY
--preview` remove a variável deles, `env reset KEY --preview` restaura o
valor de produção, e `env list --preview` mostra as diferenças.
A produção nunca é alterada por nenhum desses comandos.

`env set KEY --stdin` lê o valor a partir da entrada padrão (stdin) em vez da
linha de comando, onde o `ps` e o histórico do seu shell o exporiam:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Uma quebra de linha final é descartada. O `rebase_cloud_env_set` do servidor MCP
define valores dessa forma.

`env set KEY --prompt` solicita o valor em um prompt oculto no seu terminal.
Nada é exibido na tela, e o valor é armazenado como secret, assim como com `--stdin
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
endereço de e-mail verificado, da mesma forma que o Add member do console faz. O acesso é liberado
imediatamente e nenhum e-mail é enviado. O Rebase Cloud ainda não envia convites, portanto uma
pessoa sem conta não recebe link: o comando recusa com `no_account` e
solicita que ela se cadastre primeiro, para então executá-lo novamente. Um control plane que
oferece suporte a convites cria um e exibe seu link (uso único, válido por 7
dias, aceito apenas por uma conta que tenha verificado aquele endereço); `invites`
lista, revoga e reenvia esses convites, e responde `not_served` em outros casos.
`--role` pode ser `admin` ou `member` (padrão). Ninguém é adicionado como `owner`: adicione-o
como admin, e um owner pode promovê-lo com `members role <email> owner`.
A adição de membros e o gerenciamento de `invites` requerem uma sessão iniciada via `rebase cloud login`;
`REBASE_TOKEN` é recusado. Ambos exigem a função de owner ou admin; um membro é avisado
sobre isso.
`members remove` solicita confirmação antes (`--yes` pula a pergunta); remover ou rebaixar um owner
exige privilégios de owner, e o último owner permanece. `--org <id>` seleciona uma organização
diferente da selecionada no momento.

### Acesso ao projeto

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` gerencia quem pode acessar um projeto específico, o vinculado ou o especificado em `--project`. Os
proprietários e administradores de uma organização são `admin` em todos os projetos pertencentes a ela e seus
membros são `developer`; `access` concede a alguém uma função exclusiva neste projeto,
independentemente de fazer parte ou não da organização. A função efetiva é a
mais alta entre as duas, e `access` a lista informando sua origem. `admin` tem
acesso a tudo, incluindo permissões e configurações; `developer` faz deploys e usa o Studio,
logs e variáveis de ambiente; `viewer` tem permissão apenas de leitura.

`invite` cria um convite para o projeto (`--role` tem como padrão `developer`)
e exibe seu link: uso único, válido por 7 dias, aceito apenas por uma conta
que tenha verificado aquele endereço. `role` e `remove` alteram ou removem o
papel do usuário no próprio projeto e pedem confirmação prévia (`--yes` pula a pergunta); alguém que acessa o
projeto por meio da organização é removido com `orgs members remove`.
Perder o papel de `admin` em um projeto também revoga o papel de `admin` que a opção **Open admin
panel** concedeu àquela pessoa dentro da aplicação, encerrando suas sessões lá. Qualquer
alteração requer uma sessão ativa de `rebase cloud login` e papel de `admin` no projeto; um
control plane sem suporte a acesso por projeto responde com `not_served`.

`activity` é o registro de auditoria da organização selecionada, do mais recente para o mais antigo: quem
fez deploy, rollback, definiu, removeu ou revelou uma variável de ambiente (por
nome, nunca por valor), alterou um domínio, criou, restaurou ou baixou um
backup, alterou a computação de um projeto, parou ou removeu um projeto, alterou o
papel de um membro, ou criou ou revogou um token de acesso. `--action` recebe uma área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou uma ação completa
como `env.set`. Cada página contém até 100 entradas (`--limit`, padrão 50); a
saída exibe o cursor `--before` para a próxima página. `--json` retorna um valor único,
`{ org, events, nextCursor }`. Requer a função de owner ou admin na organização.
Um token só tem permissão de leitura se tiver o escopo `audit` na organização
(`rebase cloud tokens create --can audit`). A página **Activity** do console
exibe o mesmo registro.

## Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db query [sql] [--file <path>]
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint
público) até Ctrl-C; `--reveal` adiciona a senha. Apenas owner ou admin.

`db query` executa instruções SQL no banco de dados gerenciado e imprime o resultado
de cada uma, sem exigir um `psql` local: ele abre o mesmo túnel durante o período de
uma consulta. Um arquivo com várias instruções roda como um script único e para no primeiro
erro; nenhuma transação é criada automaticamente, portanto envolva o arquivo em `BEGIN`/`COMMIT` para torná-lo
atômico. `COPY … FROM STDIN` é recusado. Apenas owner ou admin. Com
`--json`, ele retorna `{ projectId, results: [{ command, rowCount, rows }] }`.

`db connect`, `db query` e `db backup` aceitam `--database <key>` para um dos
[outros bancos de dados](/docs/backend/multiple-sources/) do projeto, referente à `key`
de uma declaração `database("<key>")`. Sem isso, eles atuam no banco padrão.

## Convidados

Cada `signInAnonymously()` executado em testes, bots ou acessos abandonados gera uma linha
na tabela de usuários do projeto. Estes comandos contabilizam essas linhas e as removem, para
que ninguém precise excluí-las manualmente uma a uma.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` aceita uma idade acompanhada de unidade: `45m`, `12h`, `30d` ou `2w`. Sem `--yes`, ele
apenas contabiliza e não exclui nada. Ele opera em projetos de qualquer tamanho em pequenos
lotes.

Apenas convidados podem ser removidos. Um convidado é um registro com `is_anonymous` definido, sem senha e sem
identidade vinculada, e a aplicação aplica essa regra na própria instrução que deleta o
registro, impedindo que o comando atinja uma conta real, mesmo que ela tenha se cadastrado logo
após a listagem. `delete` recusa uma conta comum com `NOT_ANONYMOUS`.

**Last seen** representa quando a sessão do convidado foi emitida ou renovada pela última vez, ou quando
o convidado foi criado, caso não reste nenhum refresh token. Um convidado que continua retornando
não é considerado antigo, independentemente de quando foi criado. Os refresh tokens
de um convidado excluído e quaisquer outros registros de autenticação associados são removidos juntos.

Registros em suas tabelas próprias seguem suas restrições de chave estrangeira:

| A coluna | O que acontece com o registro |
|---|---|
| Link opcional (`ON DELETE SET NULL`, o padrão) | Mantido, com a referência esvaziada |
| Link obrigatório (`ON DELETE RESTRICT`, o padrão) | Mantido, juntamente com o convidado: o convidado é reportado como ignorado, com `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Excluído juntamente com o convidado |
| Sem chave estrangeira (um campo `userSelect`, um id simples) | Mantido, armazenando um id que não existe mais |

Verifique quais das suas relações estão configuradas em cascata antes de passar `--yes`: a operação não pode ser desfeita.

O comando é executado por meio do proxy do Studio no console, que mantém a chave da aplicação, de modo que a chave nunca chega à
sua máquina. Ele requer papel de owner ou admin na organização, em um projeto cujo acesso ao Studio esteja ativo
(`rebase cloud settings set --studio on`). Um projeto em um runtime mais antigo será informado de que precisa de uma versão mais nova.
`rebase users guests --project <slug>` é o comando equivalente na família do projeto.

## Recursos

O que a plataforma mantém para o projeto, em comparação ao que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é retirada — isso
significaria apagar dados por meio de um push. A plataforma o mantém, o vincula e o fatura até que alguém
o remova explicitamente pelo nome.

## Computação

O que o projeto reserva e o custo correspondente.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` foi descontinuado: todo backend executa pelo menos uma instância, portanto
`true` é recusado e `false` é ignorado com um aviso. Não existem planos
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
apenas `{ "text" }` em vez do JSON do evento, que também traz um `text`. A URL
é um argumento posicional porque `--url` define o control plane. `add` exibe
o signing secret apenas uma vez; `--json` retorna `{ projectId, webhook, secret }`.
`test <id>` encerra com código 1 e `delivery_failed` quando o destinatário não aceita
o evento de teste. A listagem está disponível para qualquer membro da organização; `add`, `test`
e `remove` exigem o papel de owner ou admin. Um token os gerencia com a
permissão `notifications` na organização, sob a mesma regra de papéis. Consulte
[Notificações Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` configura para o cluster
próprio do cliente um registro de imagens exclusivo, utilizado apenas por aquele cluster. Sem
ele, esse cluster usa o registro compartilhado da plataforma, e cada deploy para ele
informa isso em seu log. Com ele, os builds realizam push para aquele repositório com um token
daquela conta, os pods realizam pull apenas com aquela chave, e o rollback aceita
as imagens do projeto localizadas lá. Imagens
que o projeto compilou no repositório compartilhado anteriormente continuam acessíveis para pull e continuam
aptas para rollback. Os três valores devem ser fornecidos em conjunto; `--clear` os remove. A chave
é selada no momento em que é gravada e nunca pode ser lida novamente. Assim como o restante de `clusters`,
este comando requer a função de platform-admin. O operador cria o repositório e ambas
as contas usando o Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra a capacidade operada pelo Rebase: projetos
alocados em sua região são implantados lá assim que sua infraestrutura base estiver pronta. Ele não disponibiliza
a região para clientes. `--open-to-customers` disponibiliza, no momento do registro ou posteriormente
com `clusters open <id-or-name>`; `clusters close <id-or-name>` encerra a disponibilização.
Operadores podem realizar deploy em um cluster fechado. Mantenha um cluster fechado enquanto seu
domínio base for compartilhado com outro cluster: até que o registro wildcard seja migrado, seus
hostnames só serão resolvidos por meio de registros explícitos (`ingress.<baseDomain>`,
`s3.<baseDomain>` e um por projeto), e `clusters add` exibe quais registros
adicionar. Quando o domínio é compartilhado, `open` avisa que o registro wildcard já
deve estar apontando para o cluster. Ele não solicita confirmação, facilitando o uso em scripts.

`billing invoices` e `billing upcoming` leem os mesmos dados do Stripe que a
página Billing do console, e são acessíveis apenas para owners e admins da
organização. Um token pode acessá-los, assim como o restante de `billing`, com a
permissão `billing` na organização; um token gerado antes da introdução dessa permissão continua
funcionando por uma versão, emitindo um aviso em cada resposta. Os valores em `--json` são expressos na menor unidade da moeda (centavos), exatamente como
o Stripe os envia. Faturas em rascunho não são listadas; a prévia é calculada pelo
Stripe e suas linhas medidas continuam acumulando até o fechamento do período.

`usage` lê o consumo do projeto vinculado (ou especificado em `--project`) em um mês
calendário, em UTC: requisições em relação à cota incluída, erros 5xx, o excedente
acumulado até o momento em euros e, para o mês corrente, a projeção com base
no ritmo atual (uma estimativa). O excedente é o cálculo do próprio relatório de overage,
o mesmo que instrui o Stripe sobre o que faturar, sendo lançado na fatura do mês seguinte.
`usage org` lista todos os projetos da organização selecionada via `rebase cloud
use`, acompanhados do total consolidado. Qualquer membro da organização pode visualizá-lo. Um token pode
lê-lo com a permissão `logs` no projeto; `usage org` lista os projetos nos quais o
token possui essa autorização.
`--month` aceita um mês anterior. A resposta traz `caveats`, cada um acompanhado de um `code`: `storage_not_measured`
(o armazenamento de objetos é reportado como 0), `multi_pod_undercount` (requisições atendidas enquanto dois
ou mais pods da aplicação operam não são contabilizadas), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (um
projeto reivindicado a partir de um agente contabiliza apenas os dias decorridos a partir da reivindicação) e
`autoscale_not_charged` (pods operaram acima de `--replicas` e esta plataforma ainda não
os cobra). A resposta de um projeto com autoescalonamento também inclui `autoscale`:
`extraPodSeconds` acima da base, `amountEur` de acordo com as taxas aplicáveis e `charged`.

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

`domains redirect` funciona por domínio e fica desativado por padrão, permitindo que um projeto que atende um host `api.` junto ao seu site mantenha ambos; ele tem efeito enquanto o domínio estiver verificado e outro estiver configurado como primário, e nunca se aplica a um domínio no qual uma aplicação esteja em execução. `deploy-hooks create` exibe a URL do hook apenas uma vez. `deploy --git` não pode ser combinado com as opções de build local e, no runtime gerenciado, requer `--eject`, pois o control plane compila a partir do código-fonte. `settings set --studio` é a chave que os comandos de projeto (`rebase data`, `rebase users`, …) exigem ativada para `--project`: eles acessam a aplicação por meio do proxy do Studio no console. Um comando cuja rota no control plane ainda não tenha sido implantada responde `not_served` e informa o nome da rota. Comandos destrutivos pedem confirmação antes e recusam a execução com `confirmation_required` caso não haja resposta: utilize `--yes`.
