---
sourceHash: 3f0338ecb589f00b
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se vincula e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você auto-hospedaria — a mesma
imagem publicada `rebasepro/server`, o mesmo bundle, o mesmo Postgres. A
diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e é liberado em
lotes. [Solicite acesso](https://rebase.pro/pricing).

Ele não é self-service, portanto os comandos abaixo exigem uma conta que tenha recebido acesso.
Todo o restante deste site funciona sem uma.
:::

## O que é

Um **projeto** Cloud é composto por três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, executando na imagem de runtime publicada. Deploys são o upload de um bundle, não a compilação de um contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação point-in-time |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é faturado pelo que
reserva, e não por assento.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório
é auto-hospedado com `docker compose`, e a rota de escape é real: `rebase build`
gera um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são
flags, e ambos são obrigatórios — em um terminal eles são solicitados interativamente, e uma
execução headless que omita qualquer um deles encerra com `input_required` em vez de inventar
um. **O subdomínio não é editável posteriormente:** ele é o host
`<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com atenção.

`--link` vincula este diretório ao projeto na mesma chamada, dispensando uma
etapa separada de `link`. Ele grava `.rebase/cloud.json`, que armazena o id e o
slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam
em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é comitado com o código, de modo que um repositório clonado pode apontar para qualquer
plano de controle. Quando o host provém apenas desse arquivo, e não é nem o da própria
plataforma nem um no qual você já tenha feito login anteriormente, o `login` informa o nome dele e solicita
confirmação antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com
`--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina
`REBASE_CLOUD_URL`) para autenticar-se lá intencionalmente.

**Criou a conta com Google, GitHub ou LinkedIn?** Sua conta não tem senha, então
entre com um código:

```bash
rebase cloud login --code --email me@example.com
```

O plano de controle envia um código de 6 dígitos por e-mail, válido por dez minutos, e você o digita
no prompt. Executado sem argumentos em um terminal, o `rebase cloud login` pergunta se
você quer usar a senha ou um código. Os códigos exigem que o plano de controle consiga enviar
e-mail; se não conseguir, `--code` informa isso e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` pede em seguida o código do
seu app autenticador, ou um dos seus códigos de recuperação, qualquer que tenha sido a forma de
entrada. Nem um código de login nem um segundo fator podem ser digitados sem um terminal.
Para um script, crie um token de acesso no console (**Settings → Access
tokens**) e defina `REBASE_TOKEN`; veja [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials` e com as mesmas duas formas de entrada, já que
a causa mais comum é uma conta que nunca teve uma senha.

`billing setup` vincula um cartão à organização, apenas uma vez. Ele vem primeiro na
sequência de propósito: o primeiro deploy de um projeto é recusado sem isso, e
descobrir isso após a conclusão do upload de um bundle é a pior ordem possível.

Depois disso, a página **Billing** do console lista as faturas da organização,
cada uma com a página hospedada e o PDF do Stripe, e mostra uma prévia da próxima fatura de cada
projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
imprimem o mesmo. Ambos são para os owners e admins da organização. Onde a
plataforma oferece, **Manage billing** abre o portal do cliente do Stripe para o
cartão, os dados de faturamento e as faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não pede
um segundo pagamento: o projeto é cobrado nesse cartão e faz o deploy. Se o cartão
for recusado, ou o banco quiser que o pagamento seja confirmado, o console leva você a
**Billing**, onde **Fix your card** salva outro cartão e **Complete the
payment** abre a fatura do Stripe.

O que um projeto usou aparece em sua visão geral, em **Usage this month**, e
para todos os projetos de uma vez na página **Billing**: requisições em relação à
franquia incluída (a barra fica âmbar a 80%), erros 5xx, o excedente até agora
e para onde o mês caminha neste ritmo. O excedente é calculado pelo
mesmo código que o reporta ao Stripe, então é o que a fatura trará; ele
aparece na fatura do mês seguinte. `rebase cloud usage` imprime o
mesmo, e `rebase cloud usage org` a organização inteira. Qualquer membro pode ler.
Os números dizem o que ainda não conseguem ver: o armazenamento de objetos não é medido,
então nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods do app,
suas requisições não são contadas; e um dia com amostras perdidas subconta. Um
projeto com autoscaling também mostra os pods que executou acima de `--replicas`, em pod-horas,
quanto eles custam nas tarifas do próprio projeto e se esta plataforma já os cobra. Um
projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação: antes
dela, o projeto era da plataforma.

Um projeto existente é vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um único comando, sem nenhuma flag para memorizar. O `rebase.json` de um scaffold declara
`runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele
avisa durante o processo (`rebase.json declares runtime: managed — deploying a
bundle`), compila a aplicação em `dist-bundle`, faz o upload do bundle, executa-o na
imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de
saída é o veredito, portanto a mesma linha funciona sem intervenção humana em CI.

Ele termina dizendo onde cada app responde agora e se a nova versão está no ar ali:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu depois do build: o `/health` do backend retornou `ok` e a página de um app estático carregou (deste deploy, quando a plataforma a serve). A verificação espera até `--live-timeout` segundos, 60 por padrão; `0` a pula. Se um app não responder a tempo, o deploy ainda sai com código zero, porque o deployment teve sucesso, e a última linha diz qual app não respondeu e por quê. Um deploy que falhou termina, em vez disso, com uma linha que nomeia o app e o motivo, com `rebase cloud logs` para o log completo do build.

Scripts passam `--json` para receber um objeto com os mesmos dados — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id do deploy. Diferente do resto de `rebase cloud`, o `deploy` não muda para JSON sozinho quando usado com pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias,
timeouts e tamanhos de corpo de requisição, o sistema de arquivos, segredos, armazenamento e rede
externa — está detalhado em sua própria página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para publicar um artefato que foi compilado anteriormente — por exemplo, em um job de CI que compila uma vez e
faz deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado exige sua própria flag, `--eject`, e nada mais solicita
isso: uma compilação que migraria um projeto gerenciado para uma imagem de contêiner sob sua
própria responsabilidade é recusada até que você confirme explicitamente. `--force` costumava ter esse significado, o que colocava
a ação menos reversível da CLI sob a mesma palavra usada para "sobrescrever este
arquivo"; agora ela é uma opção desconhecida em vez de um alias, de modo que scripts que a utilizem
serão interrompidos.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando o `build` dele só copia scripts escritos à mão para `output`, ninguém os analisou, e um arquivo com um erro de digitação vai ao ar e impede a página de carregar. Por isso, antes de enviar qualquer coisa, `deploy` analisa cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estático, junto com cada `<script>` inline dos seus arquivos `.html`. Isso vale tanto para um app estático implantado sozinho quanto para os apps estáticos incorporados ao bundle do backend. Um erro de sintaxe interrompe o deploy com o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` que não seja JavaScript, um `<script src>` e um script que ainda contém marcação de template não renderizada, como `{{ }}`. Um arquivo `.js` passa se puder ser analisado como script clássico ou como módulo, porque é a página que decide. Nada dentro de `node_modules` é lido, nem um `--bundle-dir` já compilado. `--no-verify` pula a verificação em um deploy.

Acompanhe:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

O comando `status` informa `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a
plataforma está genuinamente trabalhando e fazer polling é o correto; quando indicar
algo, esse algo está aguardando você.

## Pré-visualizar uma mudança

```bash
rebase cloud deploy --preview
```

Isso compila e envia exatamente o que o `deploy` enviaria, mas o serve em um endereço
próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua
servindo o que servia antes. O deploy imprime o endereço do preview quando o
build termina.

Para manter um mesmo endereço entre deploys, dê um nome ao preview. Fazer o deploy do mesmo nome
de novo o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview conversa depende do que você publicou:

- **`rebase cloud deploy --preview`** faz o preview do backend, com seus apps estáticos
  incorporados, do mesmo jeito que a produção os executa. Ele recebe um backend próprio em
  um **banco de dados vazio e só dele**, nunca o da produção. Inicializar contra
  o banco de dados da produção aplicaria a ele o schema e as regras de acesso do preview.
- **`rebase cloud deploy web --preview`** faria o preview de um app estático sozinho,
  com suas páginas chamando o backend de **produção**. Isso exige um plano de controle
  que sirva sites estáticos isoladamente, e o Rebase Cloud ainda não o faz: ele
  recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Faça o preview do
  backend, que serve os apps estáticos incorporados a ele; um projeto sem
  backend gerenciado ainda não pode ter preview.

Um preview não envia código-fonte e não registra apps nem hostnames, porque cada um
deles alteraria o projeto de produção. `--source` e `--eject` não podem ser
combinados com `--preview`. Cada um constrói uma imagem de contêiner para a produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` é sempre o da produção.

A página **Deployments** do console lista os mesmos previews e abre, mostra o
log de build de, ou exclui cada um. Criar um continua sendo uma etapa da CLI.

Um preview expira uma semana depois do último deploy feito nele.

Ao terminar, o deploy verifica se o endereço do preview responde, como faz um
deploy de produção (`--live-timeout <seconds>`, `0` para pular). O certificado de um novo
preview pode levar um ou dois minutos, então um deploy que teve sucesso pode
dizer que o endereço ainda não responde.

Um preview de backend é cobrado como uma unidade de app no tamanho padrão (100m de CPU
e 384 MiB de memória, na tarifa do seu app para a região e a capacidade),
rateado pelo tempo em que existir, e aparece na cotação mensal do projeto
no console. `rebase cloud deploy --preview` imprime a mesma cotação para ele,
por mês (`cost` com `--json`). Iniciar um exige um cartão cadastrado, como um deploy de produção.
Um primeiro deploy que
falha antes de qualquer coisa executar é removido em vez de cobrado. Um projeto pode executar
três previews de backend ao mesmo tempo.

Cada novo endereço de preview recebe um certificado TLS próprio do Let's Encrypt,
que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de
produção nele. Os previews podem usar 20 deles em quaisquer 7 dias, em toda a plataforma. Passado
esse limite, um novo preview é recusado (`429`, `preview_cert_budget`) com o horário em que pode
ser implantado; refazer o deploy de um preview que já existe nunca conta.

O banco de dados de um preview de backend é um segundo banco no Postgres da **produção**:
dados próprios, mas a mesma instância e o mesmo disco. Ele é limitado a 10
conexões, para que os previews não esgotem as da produção, e a 2 GB: um preview
cujo banco passe disso é pausado. Seu backend para, seu endereço deixa de
responder, `rebase cloud previews` e o console o mostram como `paused` com o
motivo, e os owners e admins do projeto são notificados (`preview.paused`). Seus
dados são mantidos até ele expirar. Faça o deploy dele de novo para iniciá-lo (ele é pausado outra vez
enquanto o banco ainda estiver grande demais), ou exclua-o. Um preview pausado continua sendo
cobrado até ser excluído ou expirar. Exclua os previews de que não precisa mais. As extensões instaladas na produção não são
instaladas no banco de dados de um preview.

Os previews estão sendo liberados gradualmente. Um plano de controle que ainda não os serve recusa
`--preview` com `previews_unavailable` e não faz deploy de nada.

## Fazer rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que foi publicado em um deploy bem-sucedido anterior,
e nunca recompila — a vantagem de um rollback é entregar um
artefato que já foi executado.

Quais deploys estão qualificados depende de como o projeto faz deploy, e ambos os tipos
funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que aquele deploy enviou, na versão de runtime que o projeto está executando agora |

Apps estáticos incorporados ao bundle do backend (um `rebase cloud deploy` simples em um projeto com backend) fazem parte desse bundle, então voltam junto com ele no rollback.

Um app estático implantado sozinho (`rebase cloud deploy <app>`) ainda não pode ter rollback. O deployment registra qual app publicou, mas nenhum bundle, então o control plane não tem de onde restaurá-lo. A solução é implantar de novo a última versão boa, por exemplo a partir do commit anterior ao defeituoso. Depois de um deploy assim, `deploy` diz isso em vez de apontar para `rollback`, e `rollback`
sem um id recusa em vez de refazer o deploy do backend que está servindo.

Portanto, um rollback precisa de um deployment que tenha registrado um dos dois, o
que significa um projeto que já foi implantado com sucesso pelo menos duas vezes.
O `rebase cloud deployments` marca os que se qualificam, e `--json` relata
`rollbackable` por linha junto com a `image` ou o `bundle` que seria restaurado.

Dois tipos de deployment são recusados, e a CLI informa qual deles: um que não
foi bem-sucedido e outro de antes da plataforma registrar seu artefato. Não há nada
a adivinhar em nenhum dos casos — adivinhar enviaria o que foi compilado ou carregado
mais recentemente alegando restaurar este —, então faça deploy da versão que desejar
em vez disso.

Todo deploy bem-sucedido termina indicando o caminho de volta (`rebase cloud rollback`), para que ele esteja à vista no momento em que uma versão ruim é percebida.

Um rollback anexa um novo deployment em vez de retroceder o histórico, e aguarda
a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com
`rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro da sua janela de recuperação,
em **Database → Backups** no console ou com a CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
São duas etapas. Primeiro, uma cópia recuperada é preparada ao lado do banco ativo;
seu app continua rodando no ativo, e o armazenamento da cópia é cobrado até
você fazer o cutover ou descartá-la.
Depois, quando a cópia estiver pronta, o cutover reaponta o app para ela e o reinicia.
Tudo o que foi gravado depois do horário alvo não está na cópia. O banco de dados
original é mantido como caminho de volta, e continua cobrando armazenamento; voltar a ele,
removê-lo ou fazer uma segunda restauração passa pelo suporte. Somente um owner ou admin
pode preparar, fazer o cutover ou descartar, e o console pede o nome do projeto
antes de fazer o cutover.

## Proteger sua conta

A conta do seu console alcança bancos de dados de produção, segredos e faturamento, então
proteja-a como tal. Abra **Account security** no menu sob o seu avatar
no console (ou vá para `/account`). A página é sua, não de uma
organização: o que você define ali vale em toda organização a que você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer app autenticador (1Password,
  Google Authenticator, Authy). A página mostra uma chave de configuração para adicionar ao app, ou um
  link que abre o app com a chave já preenchida em um celular, e depois pede o
  código de 6 dígitos que o app mostra. A partir daí, todo login pede um código,
  quer você entre com senha, Google ou GitHub.
- **Códigos de recuperação.** Ao ativá-la, você recebe dez códigos de uso único, exibidos uma só vez.
  Cada um faz o login no lugar do código do autenticador se você perder o
  celular, então guarde-os antes de fechar a caixa de diálogo. **New recovery codes**
  os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas
  e gerar novos códigos pedem um código antes.
- **Senha.** Alterá-la desconecta você em todos os outros dispositivos. Uma conta
  criada com Google, GitHub ou LinkedIn não tem senha; a página oferece enviar
  por e-mail um link para definir uma.
- **Dispositivos conectados.** Todo navegador e terminal conectado à sua conta,
  com seu endereço e quando entrou. Desconecte qualquer dispositivo que você não
  reconheça, ou todos de uma vez.

Os [tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não pedem um segundo
fator, então o CI continua fazendo deploy depois que você a ativa. Revogue um token em que você não
confia mais em **Settings → Access tokens**.

## Convidar sua equipe

**Members → Invite member** gera um link para copiar (enviado por e-mail quando este plano de controle
envia e-mail) que funciona uma única vez, por 7 dias, para uma conta que tenha verificado esse
endereço; ninguém entra até aceitar. Convide um admin ou um membro, e torne-o
owner depois que ele entrar. Owners e admins o veem, reenviam ou revogam em
**Pending invitations**; a partir de um terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Ver quem fez o quê

A página **Activity** do console e `rebase cloud activity` mostram aos
owners e admins da organização quem fez deploy, definiu ou revelou uma variável de ambiente
(pelo nome, nunca pelo valor), alterou um domínio, restaurou um backup,
redimensionou, parou ou excluiu um projeto, alterou o papel de um membro ou criou um
token, e quando. As **Settings** de um projeto levam às suas próprias entradas; uma entrada
sobre um projeto excluído permanece. Um script a lê com um token criado com
`--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar a sua senha. Dê a ele um token restrito a
algumas ações em um projeto, criado a partir de um terminal autenticado com
`rebase cloud tokens create --project shop --can deploy,logs`, e defina-o como
`REBASE_TOKEN`. O faturamento, o log de atividade e as configurações de notificação
de uma organização são permissões próprias (`--can billing`, `audit`,
`notifications`) que um token só possui quando são solicitadas. As permissões, um workflow do
GitHub Actions e o que continua restrito a uma pessoa autenticada estão em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` dá a um app um backend no ar antes que alguém tenha se
cadastrado, e imprime uma URL de reivindicação para a pessoa ficar com ele; um projeto que ninguém reivindica
em 72 horas é excluído. O que o token do projeto não reivindicado pode fazer, o
`REBASE_API_TOKEN` que ele grava e o que a reivindicação muda estão em
[Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação e quanto custa

Um projeto é precificado pelo que reserva, não por um plano fixo. `compute` exibe
cada parâmetro e a cotação discriminada do próprio plano de controle para eles. (`rebase cloud
resources` é algo diferente: são os bancos de dados e buckets que o código declara,
e se cada um foi provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e significado |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) da aplicação por instância, ex.: `500m` e `2Gi`. Vazio indica o padrão da plataforma — `100m` e `384Mi`, com bursting de até 2 CPUs e `2Gi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que pode atingir. As instâncias que o autoscaler adiciona acima de `--replicas` são medidas por pod-segundo nas mesmas tarifas, e cobradas apenas onde a plataforma tiver ativado isso; **Usage this month** diz onde. `--no-autoscale` desativa o autoscaling |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, calculada sobre o request em vez do limit. Vazio indica 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata, porém reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio indica `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor: um parâmetro vazio
segue o padrão da plataforma e é ajustado quando este mudar.

Nada é validado pela CLI, de propósito — os limites pertencem ao cluster no qual
o projeto é executado e variam entre provedores. O plano de controle recusa qualquer
valor que não possa atender e indica o campo correspondente. Execute `rebase cloud compute` para visualizar
o valor em €/mês antes e depois; as alterações entram em vigor imediatamente, rateadas a partir de hoje,
exceto alterações que reiniciem o banco de dados, que aguardam uma janela de manutenção.

## O restante dos comandos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami` | Sua sessão |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `init`, `claim` | Com `--claim`: um backend no ar sem conta e um link para reivindicá-lo; `claim` imprime esse link de novo. Veja [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicação e monitoramento |
| `previews` | Builds servidos em seu próprio endereço por `deploy --preview`, e a exclusão deles. Veja [Pré-visualizar uma mudança](#pré-visualizar-uma-mudança) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto parado mantém sua assinatura, a menos que a plataforma cobre projetos parados apenas pelo armazenamento e pela taxa da plataforma; a linha **Billing** do console informa quando isso acontece |
| `status`, `metrics`, `debug` | O que está em execução e eventuais falhas |
| `cron` | Os cron jobs da aplicação implantada e suas execuções registradas, lidos com o seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente escrita |
| `app-key` | A chave que o `init --claim` gravou no `.env` como `REBASE_API_TOKEN`, entregue na reivindicação; `rotate` a substitui e revoga a antiga. Owners e admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` dá ao app uma nova. Owners e admins |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em múltiplos domínios, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual agir, que só pode ser omitido caso exista apenas um (para `verify`, um ainda pendente). `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Vincular ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e recuperação point-in-time |
| `guests` | <span class="since-badge" data-since="0.27">A partir da versão 0.27</span> Os usuários convidados que o login anônimo deixou para trás: conte-os, exclua um, remova os que não são vistos há certa idade. Consulte [Guests](/docs/cli/cloud/#guests). Owners e admins |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém em comparação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `usage` | Requisições usadas neste mês em relação à franquia incluída, e o excedente até agora, como a fatura o conta. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters onde os tenants executam. Exclusivo para administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações e seus membros e convites, faturamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (pelo nome), um domínio, um backup, um membro ou um token. Owners e admins. Veja [Ver quem fez o quê](#ver-quem-fez-o-quê) |
| `notifications`, `webhooks` | Para onde os eventos do projeto são enviados por POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` foi aposentado e encerra com 1 e o código `command_retired` |

Cada grupo nessa tabela responde ao `--help` com uma página própria — com instrução de uso,
suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o
índice para as páginas, portanto um grupo adicionado sem uma página falha a compilação em vez de
responder com o sumário. `verify:docs` vincula a própria tabela
a esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto um grupo
adicionado sem uma linha correspondente também falhará a compilação.

Quando usado com pipe, `--help` responde em formato JSON: a mesma instrução de uso, flags e exemplos
como uma estrutura legível, em vez de sessenta linhas de códigos de escape de terminal.

## O que o beta não inclui

Explicado abertamente, porque descobrir depois é pior:

- **Sem escolha de região.** Tudo roda em uma única região atualmente. O modelo de posicionamento
  existe na plataforma, mas um projeto ainda não pode escolher uma região.
  `projects create --provider` e `--region` não são a exceção que aparentam
  ser: eles registram a qual dos destinos de deploy registrados no plano de controle um
  projeto pertence; como existe apenas um, ambos assumem esse valor padrão e nenhum deles move o
  projeto para outro lugar. `rebase cloud projects create --help` informa o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há cadastro com pagamento imediato.
- **Sem SLA publicado**, e sem SOC 2. Caso necessite de qualquer um deles, mencione
  ao solicitar acesso em vez de assumir que existem.
- **Sem deploys por branch**, e sem GitHub App oficial. Deploy hooks —
  URLs secretas para as quais você direciona um webhook do repositório — são a automação suportada. Os [deploys
  de preview](#pré-visualizar-uma-mudança) estão sendo liberados gradualmente e são iniciados pela CLI.
- **Tokens atuam em nome de uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é gerado por uma conta
  e atua como ela; ainda não existe uma identidade de máquina de propriedade da organização. Caso
  faça login a partir do CI, forneça `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  a partir de um gerenciador de segredos — `--password` insere a senha no histórico do shell e
  na tabela de processos, alertando sobre isso antes de autenticar. Se o
  `.rebase/cloud.json` do repositório apontar para um plano de controle diferente do da plataforma, passe-o
  também como `--url`: sem um terminal, o `login` recusa enviar uma senha para um
  host que apenas o arquivo versionado indicou.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não fica exposto à
  internet, portanto o host exibido no console é o endereço interno do seu backend para ele e
  não resolve nada na sua máquina local. O comando `rebase cloud db connect` abre uma porta
  local que representa esse banco de dados, tunelada através do plano de controle enquanto
  você mantiver o processo em execução — mas não existe um hostname permanente ao qual um serviço
  de terceiros possa se conectar. Esse túnel e a senha protegida por
  `rebase cloud db info --reveal` exigem o papel de proprietário (owner) ou administrador da organização:
  o mesmo que o editor SQL do Studio exige, pois todos os três resultam em uma
  sessão com acesso aos seus dados de produção.
- **Fazer deploy é executar código com os segredos de produção.** O ambiente do app
  contém `REBASE_SERVICE_KEY` (admin na própria API), `DATABASE_URL` e
  `JWT_SECRET`, então o código que um membro implanta pode lê-los,
  mesmo que somente owners e admins possam revelá-los no console. Convide
  como membro apenas alguém em quem você confiaria com esses valores.
- **A service key pode ser substituída.** As **Settings** do projeto
  (ou `rebase cloud service-key rotate`) emitem uma nova `REBASE_SERVICE_KEY`
  e reiniciam o app com ela. A chave antiga funciona até o fim da reinicialização,
  e nada depois, então tudo o que a copiou é recusado a partir
  daí. Reivindicar um projeto faz o mesmo.

## Auto-hospedagem como alternativa

Nada aqui gera aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa exatamente a mesma imagem e bundle com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) reproduz a mesma topologia a partir
do Helm chart.
