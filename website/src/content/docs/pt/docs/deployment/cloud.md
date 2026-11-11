---
sourceHash: de4684f207c4a8fd
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se vincula e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma
imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A
diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e é liberado em
lotes. [Solicite acesso](https://rebase.pro/pricing).

Não é autosserviço, portanto, os comandos abaixo precisam de uma conta que já tenha recebido acesso.
Todo o restante neste site funciona sem uma.
:::

## O que é

Um **projeto** Cloud é composto por três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são um upload de bundle, não o build de um container |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e point-in-time recovery |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é cobrado pelo que
reserva, e não por assento (per seat).

**Nada no seu projeto muda para rodar lá.** O mesmo repositório
é auto-hospedado com `docker compose`, e a alternativa de saída é real: `rebase build`
produz um bundle que inicializa em qualquer lugar onde a imagem de runtime execute.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre o console no seu navegador e exibe um código curto. Verifique se
o console mostra o mesmo código e aprove o login por lá: o terminal
assume a sessão e a grava em `~/.rebase/credentials.json`. Se você
não estiver conectado ao console, faça login lá primeiro com o método que preferir,
incluindo Google e GitHub. Via SSH, `rebase cloud login --no-browser` imprime o link
para você abrir na sua própria máquina.

`projects create` não recebe argumentos posicionais. O nome e o subdomínio são
flags, e ambos são obrigatórios — em um terminal eles serão solicitados, e uma
execução sem terminal (headless) que omita qualquer um deles sairá com `input_required` em vez de inventar
um. **O subdomínio não pode ser editado posteriormente:** ele é o host
`<slug>.rebase.website` no qual o projeto responde, portanto, escolha-o com atenção.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma
etapa `link` separada. Ele grava `.rebase/cloud.json`, que armazena o project id
e o slug. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam
em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado com o código, de modo que um repositório clonado pode apontar para qualquer
control plane. Quando o host vem apenas daquele arquivo e não é o
da própria plataforma nem um no qual você já tenha feito login antes, o `login` informa o nome dele e pede confirmação
antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com
`--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina
`REBASE_CLOUD_URL`) para fazer login intencionalmente nesse host.

Para fazer login sem o navegador, informe seu e-mail: `rebase cloud login --email
me@example.com` solicitará sua senha. **Cadastrou-se com Google, GitHub ou
LinkedIn?** Sua conta não tem senha, então use um código:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia por e-mail um código de 6 dígitos, válido por dez minutos, e você o digita
no prompt. Com `--email` e sem senha, `rebase cloud login` pergunta
se deseja usar sua senha ou um código. Os códigos exigem que o control plane seja capaz de enviar
e-mails; se não puder, `--code` avisa e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do
seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente de como fez
o login. Pelo navegador, o console solicita o código quando você faz login por lá. Nem um código de login nem um segundo fator podem ser digitados sem um terminal.
Para scripts, crie um token de acesso no console (**Settings → Access
tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta retorna `invalid_credentials` com as mesmas duas opções de entrada, já que
a causa habitual é uma conta que nunca teve senha.

`billing setup` vincula um cartão à organização, apenas uma vez. Ele vem primeiro
na sequência de propósito: o primeiro deploy de um projeto é recusado sem um cartão, e
descobrir isso após o upload de um bundle ter terminado é a pior ordem possível.

Depois disso, a página **Billing** do console lista as faturas da organização,
cada uma com a página hospedada do Stripe e o PDF, e exibe uma prévia da próxima fatura de cada
projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
exibem o mesmo. Ambos são destinados aos proprietários e administradores da organização. Onde a
plataforma permitir, **Manage billing** abre o portal do cliente do Stripe para gerenciar o
cartão, os dados de faturamento e faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não requer
nenhum pagamento adicional: o projeto é cobrado nesse cartão e implantado. Se o cartão
for recusado, ou o banco exigir confirmação do pagamento, o console direciona você para
**Billing**, onde **Fix your card** salva outro cartão e **Complete the
payment** abre a fatura do Stripe.

O consumo de um projeto é exibido em sua visão geral, em **Usage this month**, e
para todos os projetos de uma vez na página **Billing**: requisições em relação à
cota inclusa (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento
e a projeção para o mês nesse ritmo. O excedente é calculado pelo
mesmo código que o reporta ao Stripe, portanto é exatamente o que constará na fatura; ele
aparece na fatura do mês seguinte. `rebase cloud usage` imprime o
mesmo, e `rebase cloud usage org` mostra para toda a organização. Qualquer membro pode
visualizar. Os números indicam o que ainda não é possível visualizar: o object storage não é medido,
portanto nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de app,
suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um
projeto com dimensionamento automático também exibe os pods executados acima de `--replicas`, em horas-pod,
quanto custam nas suas taxas e se esta plataforma já os está cobrando. Um
projeto reivindicado a partir de um agente contabiliza apenas os dias a partir da reivindicação: antes
disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Fazer Deploy

```bash
rebase cloud deploy
```

Um comando, e nenhuma flag para lembrar. O `rebase.json` de um scaffold declara
`runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele
informa isso durante a execução (`rebase.json declares runtime: managed — deploying a
bundle`), compila a aplicação em `dist-bundle`, faz o upload do bundle, executa-o na
imagem de runtime publicada e acompanha a implantação até um estado final. O código de saída
é o veredito, portanto a mesma linha funciona sem intervenção humana no CI.

Ele termina informando onde cada aplicação agora responde e se a nova versão está
no ar lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o `/health` do backend
retornou `ok`, e a página da aplicação estática carregou (a partir deste deploy, quando a
plataforma a serve). A verificação aguarda até `--live-timeout` segundos, 60 por
padrão; `0` ignora essa etapa. Se uma aplicação não responder a tempo, o deploy ainda sairá com
código zero, porque a implantação foi bem-sucedida, e a última linha informará qual aplicação não
respondeu e o motivo. Um deploy com falha termina em uma linha, informando a aplicação e o
motivo, com `rebase cloud logs` para o log completo de build.

Scripts passam `--json` para receber um único objeto contendo os mesmos dados — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e o id do deployment. Diferente do restante do
`rebase cloud`, o `deploy` não muda para JSON automaticamente quando usado em pipes.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias,
timeouts e tamanhos de corpo de requisição, o sistema de arquivos, secrets, storage e rede
de saída — está em sua própria página:
[Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

Para publicar um artefato que foi compilado anteriormente — por exemplo, um job de CI que faz build uma vez e
deploy duas vezes — aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais a
solicita: um build que moveria um projeto gerenciado para uma imagem de container que ele próprio
gerencia é recusado até que você confirme explicitamente. `--force` costumava significar isso, o que colocava a
ação menos reversível que a CLI pode fazer sob a mesma palavra de "sobrescrever este
arquivo"; agora é uma opção desconhecida em vez de um alias, portanto, um script que a utilize
será interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de uma aplicação estática são servidos exatamente como estão. Quando seu `build` apenas
copia scripts manuais para `output`, nada os analisou, e um arquivo
com um erro de digitação vai para produção e impede a página de carregar. Por isso, antes de qualquer coisa
ser enviada, o `deploy` analisa sintaticamente cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada
aplicação estática, além de cada `<script>` inline em seus arquivos `.html`. Isso
abrange tanto uma aplicação estática implantada isoladamente quanto aplicações estáticas incluídas no
bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador
não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer
outro `type` não-JavaScript, tags `<script src>` e scripts que ainda contenham
marcações de template não renderizadas como `{{ }}`. Um arquivo `.js` passa se for analisado com sucesso
como script clássico ou como módulo, pois a página decide qual deles utilizar. Nada
dentro de `node_modules` é lido, e um `--bundle-dir` pré-compilado também não.
`--no-verify` pula essa verificação para uma execução de deploy.

Acompanhe com:

```bash
rebase cloud logs               # o log de build
rebase cloud logs --runtime -f  # o que a aplicação em execução imprime, em tempo real, até Ctrl-C
rebase cloud status             # o que a plataforma entende que o projeto está fazendo
```

`status` informa `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a
plataforma está realmente trabalhando e consultar novamente é a ação correta; quando ele especificar
algo, significa que esse algo está aguardando você.

## Visualizar uma alteração (Preview)

```bash
rebase cloud deploy --preview
```

Isso compila e envia exatamente o que o `deploy` enviaria, mas serve a aplicação em um endereço
próprio, como `https://shop--k3x9ab.rebase.website`. O ambiente de produção continua
servindo o que servia antes. O deploy imprime o endereço do preview quando o
build termina.

Para manter o mesmo endereço entre deploys, dê um nome ao preview. Fazer deploy com o mesmo nome
novamente o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

A qual serviço um preview se conecta depende do que você implantou:

- **`rebase cloud deploy --preview`** cria um preview do backend, com suas aplicações estáticas
  embutidas, da mesma forma que a produção as executa. Ele ganha um backend próprio em
  um **banco de dados próprio e vazio**, nunca o de produção. Inicializar contra o
  banco de dados de produção aplicaria o schema e as regras de acesso do preview a ele.
- **`rebase cloud deploy web --preview`** criaria um preview de uma aplicação estática de forma
  isolada, com suas páginas fazendo chamadas para o backend de **produção**. Isso exige um control plane
  que sirva sites estáticos sozinhos, o que o Rebase Cloud ainda não faz: ele
  recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça o preview do
  backend, que serve as aplicações estáticas embutidas nele; um projeto sem
  backend gerenciado ainda não pode receber preview.

Um preview não envia código-fonte e não registra aplicações ou hostnames, pois cada uma
dessas ações alteraria o projeto de produção. `--source` e `--eject` não podem ser
combinados com `--preview`. Cada um deles cria uma imagem de container para produção.

```bash
rebase cloud previews                      # nome, endereço, app, backend, expiração
rebase cloud logs --preview new-checkout   # seu log de build; -f acompanha um build ainda em execução
rebase cloud logs --runtime --preview new-checkout -f  # o que o backend dele imprime
rebase cloud previews delete new-checkout  # interrompe a disponibilização e descarta o banco de dados
```

`rebase cloud logs` sem `--preview` sempre se refere a produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o
log de build ou excluir cada um deles. Criar um preview continua sendo uma etapa via CLI.

Um preview expira uma semana após o último deploy realizado nele.

Ao terminar, o deploy verifica se o endereço do preview responde, exatamente como faz um deploy
de produção (`--live-timeout <seconds>`, `0` para pular). O certificado de um novo
preview pode levar um ou dois minutos, de modo que um deploy bem-sucedido pode
indicar que o endereço ainda não responde.

Um preview de backend é faturado como uma unidade de app no tamanho padrão (100m de CPU
e 384 MiB de memória, na taxa da sua aplicação para a região e capacidade correspondentes),
proporcional ao tempo em que existir, e aparece na
estimativa mensal do projeto no console. `rebase cloud deploy --preview` imprime a mesma estimativa para
ele, por mês (`cost` sob `--json`). Iniciar um preview exige um cartão cadastrado, assim como um deploy
de produção. Um primeiro deploy que
falhe antes que qualquer coisa seja executada é removido em vez de faturado. Um projeto pode executar
três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio do Let's Encrypt,
que limita um domínio a 50 novos certificados por semana, compartilhados com todos os sites
de produção nele. Os previews podem utilizar até 20 deles em qualquer período de 7 dias, em toda a plataforma. Acima
disso, um novo preview é recusado (`429`, `preview_cert_budget`) informando quando poderá
ser implantado; reimplantar um preview já existente nunca consome essa cota.

O banco de dados de um preview de backend é um segundo banco no Postgres de **produção**:
com seus próprios dados, mas na mesma instância e no mesmo disco. Ele é limitado a 10
conexões, para que os previews não esgotem as conexões de produção, e a 2 GB: um preview
cujo banco de dados ultrapassar esse limite é pausado. Seu backend para, seu endereço para de
responder, `rebase cloud previews` e o console o mostram como `paused` com o
motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus
dados são mantidos até ele expirar. Faça deploy dele novamente para iniciá-lo (ele será pausado novamente
se o banco ainda estiver grande demais) ou exclua-o. Um preview pausado continua sendo
faturado até ser excluído ou expirar. Exclua previews que você não precisa mais. Extensões instaladas em produção não são
instaladas no banco de dados de um preview.

Os previews estão sendo disponibilizados gradualmente. Um control plane que ainda não ofereça suporte a eles recusará
`--preview` com `previews_unavailable` e não implantará nada.

## Reverter (Rollback)

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que uma implantação anterior bem-sucedida
entregou, e nunca faz uma nova compilação — o valor de um rollback é entregar um
artefato que já foi executado anteriormente.

Quais implantações se qualificam depende de como o projeto é implantado, e ambos os tipos
funcionam:

| Como foi implantado | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que aquele deploy entregou, na versão de runtime que o projeto executa agora |

Aplicações estáticas embutidas no bundle do backend (um `rebase cloud deploy` comum em um
projeto com backend) fazem parte desse bundle, portanto sofrem rollback junto com ele.

Uma aplicação estática implantada de forma isolada (`rebase cloud deploy <app>`) ainda não pode sofrer
rollback. Sua implantação registra qual aplicação publicou, mas nenhum bundle, logo o
control plane não tem de onde restaurá-la. A solução é fazer deploy da última versão
estável novamente, por exemplo, a partir do commit anterior ao problemático. Após esse tipo de
deploy, o comando `deploy` avisa isso em vez de sugerir o `rollback`, e `rollback`
sem um id recusará a ação em vez de reimplantar o backend que estiver rodando.

Portanto, um rollback necessita de uma implantação que tenha registrado um dos dois, o que significa um
projeto que tenha sido implantado com sucesso pelo menos duas vezes. `rebase cloud deployments`
marca quais se qualificam, e `--json` reporta `rollbackable` por linha junto
com o `image` ou `bundle` que restauraria.

Dois tipos de implantação são recusados, e a CLI informa qual deles: uma que não obteve sucesso,
e uma de antes da plataforma começar a registrar seu artefato. Não há como adivinhar
em nenhum dos casos — tentar adivinhar publicaria o que quer que tenha sido compilado ou enviado mais
recentemente fingindo restaurar esta versão — portanto, faça o deploy da versão desejada
em vez disso.

Todo deploy bem-sucedido termina informando o caminho de volta (`rebase cloud rollback`),
para que ele esteja à vista no momento em que uma versão com problemas for identificada.

Um rollback adiciona uma nova implantação em vez de reescrever o histórico, e aguarda
a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com
`rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação,
a partir de **Database → Backups** no console ou via CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo leva duas etapas. Primeiro, uma cópia recuperada é preparada (staged) ao lado do banco de dados ativo;
sua aplicação continua rodando no banco ativo, e o armazenamento da cópia é faturado até
que você faça o cutover ou o descarte.
Depois, assim que a cópia estiver pronta, realizar o cutover redireciona a aplicação para ela e a
reinicia. Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados original
é mantido como caminho de retorno e continua faturando armazenamento; reverter a troca,
removê-lo ou realizar uma segunda restauração é feito via suporte. Apenas um proprietário ou administrador
pode preparar, fazer cutover ou descartar, e o console solicita o nome do projeto
antes de realizar o cutover.

## Proteja sua conta

Sua conta do console pode acessar bancos de dados de produção, secrets e faturamento, portanto
proteja-a adequadamente. Abra **Account security** a partir do menu sob seu avatar
no console (ou acesse `/account`). A página é sua, não de uma
organização: o que você definir lá se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password,
  Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um
  link que abre o aplicativo com a chave preenchida em um celular, e então solicita o
  código de 6 dígitos exibido pelo aplicativo. A partir daí, cada login solicitará um código,
  quer você entre com senha, Google ou GitHub.
- **Códigos de recuperação.** Ativar o recurso fornece dez códigos de uso único, exibidos apenas uma vez.
  Cada um permite seu login no lugar do código do autenticador se você perder seu
  celular, portanto salve-os antes de fechar a janela. **New recovery codes**
  os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas
  e gerar novos códigos exigem a digitação de um código primeiro.
- **Senha.** Alterá-la desconecta você de todos os outros dispositivos. Uma conta
  criada com Google, GitHub ou LinkedIn não tem senha; a página oferece o
  envio de um link por e-mail para definir uma.
- **Dispositivos conectados.** Todos os navegadores e terminais conectados à sua conta,
  com seus endereços e quando se conectaram. Desconecte qualquer dispositivo que você não
  reconhecer, ou todos de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo
fator, portanto o CI continuará realizando deploys após você ativar o 2FA. Revogue um token em que você não
confia mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Invite member** fornece um link para copiar (enviado por e-mail quando este control plane
tiver envio de e-mails habilitado) que funciona uma única vez, durante 7 dias, para uma conta que tenha verificado aquele
endereço; ninguém entra na organização até aceitar. Convide um administrador ou membro e promova-o
a proprietário assim que ele entrar. Proprietários e administradores visualizam, reenviam ou revogam o convite em
**Pending invitations**; a partir de um terminal, utilize [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Veja quem fez o quê

A página **Activity** do console e `rebase cloud activity` mostram aos
proprietários e administradores da organização quem realizou deploys, definiu ou revelou uma variável
de ambiente (pelo nome, nunca pelo valor), alterou um domínio, restaurou um backup,
redimensionou, interrompeu ou excluiu um projeto, alterou a função de um membro ou criou um
token, e quando isso ocorreu. A seção **Settings** de um projeto vincula-se às suas próprias entradas; uma entrada
sobre um projeto excluído permanece registrada. Um script pode ler essas informações com um token criado com
`--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token com permissões restritas a
algumas ações em um único projeto, criado a partir de um terminal autenticado com
`rebase cloud tokens create --project shop --can deploy,logs`, e configure-o como
`REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação
de uma organização são recursos próprios (`--can billing`, `audit`,
`notifications`) que um token detém apenas quando explicitamente solicitado. As permissões, um
workflow do GitHub Actions e o que permanece associado a uma pessoa física autenticada estão em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` concede a uma aplicação um backend ativo antes mesmo de qualquer pessoa ter se
cadastrado, e imprime uma URL de reivindicação para a pessoa mantê-lo; um projeto que ninguém reivindicar
dentro de 72 horas é excluído. O que o token de um projeto não reivindicado pode fazer, o
`REBASE_API_TOKEN` que ele grava e o que a reivindicação altera estão em
[Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação, e quanto custa

O preço de um projeto baseia-se no que ele reserva, e não em um plano pré-definido. `compute` imprime
cada parâmetro e a estimativa detalhada do próprio control plane para eles. (`rebase cloud
resources` é uma funcionalidade diferente: exibe os bancos de dados e buckets que o código declara,
e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade, e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação de recursos do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `100m` e `384Mi`, com burst de até 2 CPU e `2Gi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler, e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que pode alcançar. Instâncias que o autoscaler adiciona acima de `--replicas` são cobradas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma ativou essa cobrança; **Usage this month** indica isso. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação à solicitação (request) e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio
segue o padrão da plataforma e se ajusta quando ele mudar.

Nada é validado pela CLI, intencionalmente — os limites pertencem ao cluster no qual o
projeto executa, e variam entre provedores. O control plane recusa um
valor que não possa atender e indica o campo. Execute `rebase cloud compute` para ver
o valor em €/mês antes e depois; uma alteração é aplicada imediatamente, proporcional a partir de hoje,
exceto uma que reinicie o banco de dados, que aguardará uma janela de manutenção.

## O restante dos comandos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` imprime o token bearer que a CLI enviaria agora, para scripts e para o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [conector Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude o alcance junto aos seus projetos Cloud. `--list` os exibe, `--remove` remove um. Apenas proprietários e administradores |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` imprime esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Implantação e monitoramento |
| `previews` | Builds servidos em endereço próprio via `deploy --preview`, e sua exclusão. Consulte [Visualizar uma alteração (Preview)](#visualizar-uma-alteração-preview) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura, a menos que a plataforma cobre projetos interrompidos apenas pelo armazenamento e taxa da plataforma; a linha **Billing** do console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que eventualmente não está |
| `cron` | Cron jobs da aplicação implantada e suas execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca imprime valores; `--secret` é somente escrita |
| `app-key` | A chave que `init --claim` gravou no `.env` como `REBASE_API_TOKEN`, transferida no momento da reivindicação; `rotate` a substitui e revoga a antiga. Proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, permissão de admin na própria API da aplicação: quando foi rotacionada pela última vez; `rotate` gera uma nova para o app. Proprietários e administradores |
| `domains` | Domínios personalizados, registros de DNS a adicionar e verificação. Um projeto pode responder em múltiplos domínios, cada um verificado separadamente; `verify` e `remove` recebem o domínio para operar, o qual só pode ser omitido se houver apenas um (para `verify`, um ainda pendente). `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Conectar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Os usuários convidados deixados para trás pelo login anônimo: contabilizar, excluir um, limpar os não vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Proprietários e administradores |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu no backend, do mais recente para o mais antigo: escalonamento da aplicação, alterações agendadas e aplicadas no banco, um standby assumindo o controle, aumento de disco |
| `usage` | Requisições utilizadas neste mês em relação à cota inclusa e o excedente acumulado até agora, conforme apurado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters onde os tenants executam. Apenas administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações, seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem implantou, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e administradores. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications`, `webhooks` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` foi descontinuado e sai com código 1 e erro `command_retired` |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso,
suas flags e exemplos — e `--help` nunca executa o comando em si. Um teste mantém o
índice para as páginas, de modo que um grupo adicionado sem uma página falha o build em vez de
responder com o índice de conteúdos. O comando `verify:docs` valida a própria tabela contra
esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto, um grupo
adicionado sem uma linha correspondente também quebra o build.

Quando utilizado em pipes, `--help` responde em JSON: a mesma linha de uso, flags e exemplos
em formato de estrutura de dados legível em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Explicado de forma direta, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo executa em uma única região atualmente. O modelo de posicionamento
  existe na plataforma, mas um projeto não pode escolher uma região.
  `projects create --provider` e `--region` não são a exceção que parecem ser:
  eles registram a qual dos alvos de deploy registrados no control plane o
  projeto pertence, e existe apenas um, portanto ambos assumem o valor padrão dele e nenhum deles move um
  projeto para outro lugar. `rebase cloud projects create --help` informa o mesmo.
- **Não é autosserviço.** O acesso é concedido em lotes; não há opção de cadastrar-se e pagar diretamente.
- **Sem SLA público publicado**, e sem SOC 2. Se você precisar de algum dos dois, informe ao solicitar
  acesso em vez de assumir que estão disponíveis.
- **Sem deploys de branch**, e sem GitHub App oficial da plataforma. Deploy hooks — URLs secretas
  para as quais você aponta um webhook de repositório — são a automação suportada. [Deploys de
  preview](#visualizar-uma-alteração-preview) estão sendo liberados gradualmente e são iniciados pela CLI.
- **Tokens atuam em nome de uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é emitido por uma conta
  e age em nome dela; ainda não há uma identidade de máquina gerenciada pela organização. Se você
  fizer login a partir de um CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  a partir de um cofre de segredos — `--password` expõe a senha no histórico da sua shell e
  na tabela de processos, alertando sobre isso antes de autenticar você. Se o arquivo
  `.rebase/cloud.json` do repositório apontar para um control plane diferente do oficial da plataforma, passe-o
  também como `--url`: sem um terminal, o comando `login` se recusa a enviar uma senha para um
  host configurado apenas pelo arquivo baixado no repositório.
- **Sem endpoint público para o banco de dados.** Um banco de dados gerenciado não fica exposto à
  internet, portanto o host exibido no console é o endereço interno do seu backend para ele e
  não resolve na sua máquina local. `rebase cloud db connect` abre uma porta
  local tunelada até o banco através do control plane enquanto
  você mantiver o comando em execução — mas não existe um hostname permanente para o qual um
  serviço externo possa se conectar. Esse túnel e a senha exibida por
  `rebase cloud db info --reveal` exigem o papel de proprietário ou administrador da organização:
  a mesma permissão que o editor SQL do Studio solicita, pois todos os três resultam em
  uma sessão nos seus dados de produção.
- **Fazer deploy é executar código com as secrets de produção.** O ambiente
  da aplicação contém `REBASE_SERVICE_KEY` (permissão de admin em sua própria API),
  `DATABASE_URL` e `JWT_SECRET`, de modo que o código implantado por um membro pode lê-las,
  mesmo que apenas proprietários e administradores possam visualizá-las no console. Convide
  como membro apenas pessoas a quem você confiaria esses valores.
- **A service key pode ser substituída.** A seção **Settings** do projeto
  (ou `rebase cloud service-key rotate`) emite uma nova `REBASE_SERVICE_KEY`
  e reinicia a aplicação com ela. A chave antiga funciona até que a reinicialização
  tenha terminado, e nada depois disso, de forma que qualquer sistema que a tenha copiado será recusado a
  partir de então. Reivindicar um projeto faz o mesmo.

## Auto-hospedagem como alternativa

Nada aqui gera aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa a mesma imagem e o mesmo bundle com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir
do chart Helm.
