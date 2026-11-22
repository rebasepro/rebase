---
sourceHash: 325c29335f5ae263
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você auto-hospedaria — a mesma
imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A
diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e abre em
lotes. [Solicite acesso](https://rebase.pro/pricing).

Não é autoatendimento, portanto os comandos abaixo precisam de uma conta com acesso liberado.
Tudo o mais neste site funciona sem uma.
:::

## O que é

Um **projeto** Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são um upload de bundle, não um build de container |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação pontual (point-in-time recovery) |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

Cada um é provisionado quando você faz o primeiro deploy, e cada um é faturado pelo que
reserva, em vez de por usuário.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório
pode ser auto-hospedado com `docker compose`, e a rota de fuga é real: `rebase build`
produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre o console no seu navegador e exibe um código curto. Verifique se
o console mostra o mesmo código e aprove o login lá: o terminal
captura a sessão e a grava em `~/.rebase/credentials.json`. Se você
não estiver conectado ao console, faça login lá primeiro com a opção que preferir,
incluindo Google e GitHub. Via SSH, `rebase cloud login --no-browser` exibe o link
para abrir em sua própria máquina.

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são
flags, e ambos são obrigatórios — em um terminal eles são solicitados interativamente, e
uma execução headless que omita qualquer um deles é encerrada com `input_required` em vez de inventar
um. **O subdomínio não é editável posteriormente:** ele é o host
`<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma
etapa de `link` separada. Ele grava `.rebase/cloud.json`, que registra o id e o slug
do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam
em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado com o código, de modo que um repositório clonado pode apontar para qualquer
plano de controle. Quando o host vem apenas desse arquivo, e não é o
próprio da plataforma nem um no qual você já tenha feito login antes, o `login` o nomeia e solicita confirmação
antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com
`--json`, ele recusa com `unknown_control_plane`; passe `--url <host>` (ou defina
`REBASE_CLOUD_URL`) para fazer login lá intencionalmente.

Para fazer login sem o navegador, passe seu e-mail: `rebase cloud login --email
me@example.com` solicitará sua senha. **Cadastrou-se com Google, GitHub ou
LinkedIn?** Sua conta não tem senha, portanto use um código:

```bash
rebase cloud login --code --email me@example.com
```

O plano de controle envia por e-mail um código de 6 dígitos, válido por dez minutos, e você o
digita no prompt. Com `--email` e sem senha, `rebase cloud login` pergunta
se você deseja usar sua senha ou um código. Os códigos exigem que o plano de controle seja capaz de enviar
e-mails; se ele não for, `--code` informa isso e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do
seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente de como você
fez login. Pelo navegador, o console solicita isso quando você faz login por lá. Nem um código de login nem um segundo fator podem ser digitados sem um terminal.
Para um script, crie um token de acesso no console (**Settings → Access
tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials` apresentando as mesmas duas formas de acesso, já
que a causa comum é uma conta que nunca teve senha.

`billing setup` vincula um cartão à organização, apenas uma vez. Ele vem primeiro na
sequência propositalmente: o primeiro deploy de um projeto é recusado sem um cartão, e
descobrir isso após o término do upload do bundle é a pior ordem possível.

Depois disso, a página **Billing** do console lista as faturas da organização,
cada uma com a página hospedada da Stripe e o PDF, e exibe uma prévia da próxima fatura de cada
projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
exibem o mesmo. Ambos são destinados aos proprietários e administradores da organização. Onde a
plataforma oferecer essa opção, **Manage billing** abre o portal de clientes da Stripe para gerenciar o
cartão, os dados de faturamento e faturas anteriores.

Com um cartão já registrado, criar outro projeto no console não solicita
nenhum pagamento adicional: o projeto é cobrado nesse cartão e o deploy é feito. Se o cartão
for recusado ou o banco exigir a confirmação do pagamento, o console direciona você para
**Billing**, onde **Fix your card** salva outro cartão e **Complete the
payment** abre a fatura da Stripe.

O que um projeto consumiu é exibido em sua visão geral, em **Usage this month**, e
para todos os projetos de uma só vez na página **Billing**: requisições em relação à
cota incluída (a barra fica âmbar aos 80%), erros 5xx, o excedente acumulado
e a projeção para o mês nesse ritmo. O excedente é calculado pelo
mesmo código que o reporta à Stripe, portanto é o que constará na fatura; ele
aparece na fatura do mês seguinte. `rebase cloud usage` exibe o
mesmo, e `rebase cloud usage org` mostra para toda a organização. Qualquer membro pode
visualizar. Os números informam o que ainda não conseguem contabilizar: o armazenamento de objetos não é medido,
portanto nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de app,
suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um
projeto com autoscaling também exibe os pods executados acima de `--replicas`, em pod-horas,
quanto custaram em suas próprias tarifas e se esta plataforma já os está cobrando. Um
projeto resgatado a partir de um agente conta apenas os dias a partir do resgate: antes
disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a criação de um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando e nenhuma flag para memorizar. O `rebase.json` do scaffold declara
`runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele
avisa isso durante o processo (`rebase.json declares runtime: managed — deploying a
bundle`), compila o app em `dist-bundle`, faz o upload do bundle, o executa na
imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de
saída é o veredito, portanto a mesma linha funciona sem intervenção em CI.

Ele termina informando onde cada app está respondendo agora e se a nova versão está
ativa lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o `/health` do backend
retornou `ok`, e a página de um app estático carregou (a partir deste deploy, quando a
plataforma o serve). A verificação aguarda até `--live-timeout` segundos, 60 por
padrão; `0` pula a verificação. Se um app não responder a tempo, o deploy ainda assim termina com código
zero, porque a implantação foi bem-sucedida, e a última linha informa qual app não
respondeu e o motivo. Um deploy com falha termina em uma única linha, indicando o app e o
motivo, com `rebase cloud logs` para o log completo de compilação.

Scripts passam `--json` para obter um único objeto contendo os mesmos dados — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e o id do deploy. Diferente do restante do
`rebase cloud`, o `deploy` não muda para JSON automaticamente quando usado em um pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias,
timeouts e tamanhos de corpo, sistema de arquivos, segredos, armazenamento e rede
de saída — está em sua página própria:
[Runtime gerenciado de backend](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — por exemplo, em um job de CI que compila uma vez e
faz deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais solicita
isso: um build que moveria um projeto gerenciado para uma imagem de container da qual ele próprio
passe a ser responsável é recusado até que você determine expressamente. Antigamente `--force` significava isso, o que colocava
a ação menos reversível da CLI sob a mesma palavra que "sobrescrever este
arquivo"; agora ela é uma opção desconhecida em vez de um alias, então um script que a utilize
é interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando o seu `build` apenas
copia scripts escritos à mão para `output`, nada os analisou sintaticamente, e um arquivo
com um erro de digitação vai para produção e impede a página de carregar. Por isso, antes de fazer qualquer
upload, o `deploy` analisa sintaticamente cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app
estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso
cobre tanto um app estático publicado de forma independente quanto apps estáticos incorporados ao
bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador
não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer
outro `type` não-JavaScript, um `<script src>`, e scripts que ainda contêm
marcações de template não renderizadas como `{{ }}`. Um arquivo `.js` passa se for analisado
tanto como um script clássico quanto como um módulo, já que a página decide qual deles é. Nada
dentro de `node_modules` é lido, assim como um `--bundle-dir` pré-compilado.
`--no-verify` pula a verificação em um deploy específico.

Monitore:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

O comando `status` relata `blockedOn` e `nextAction`. Quando `blockedOn` é `null`, a
plataforma está genuinamente trabalhando e fazer polling é a coisa certa a fazer; quando ele indica
algo, esse algo está esperando por você.

Um desses casos é `email_not_configured`: o app ativou o login por magic link ou código de
e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) e não possui serviço de e-mail configurado; assim,
o deploy está ativo, mas ninguém consegue fazer login. O Rebase Cloud não envia
e-mails pelo seu app: configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e
`SMTP_FROM` com `rebase cloud env set`, e então faça o deploy. O `status` lê isso a partir do
próprio `GET /api/auth/config` do app (seu campo `unavailable`), e o `deploy` informa o
mesmo sob a sua verificação de disponibilidade (live check).

## Pré-visualizar uma alteração

```bash
rebase cloud deploy --preview
```

Isso compila e faz o upload exatamente do que o `deploy` faria, mas disponibiliza em um endereço
próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua
servindo o que servia antes. O deploy exibe o endereço da pré-visualização quando o
build termina.

Para manter o mesmo endereço entre deploys, dê um nome ao preview. Fazer deploy com o mesmo nome
novamente irá atualizá-lo:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** pré-visualiza o backend, com seus apps estáticos
  incorporados, da mesma forma que a produção os executa. Ele recebe um backend próprio em um
  **banco de dados próprio vazio**, nunca o de produção. Inicializar apontando para o
  banco de produção aplicaria o esquema e as regras de acesso do preview nele.
- **`rebase cloud deploy web --preview`** pré-visualizaria um app estático
  isoladamente, com suas páginas chamando o backend de **produção**. Isso requer um plano de controle
  que sirva sites estáticos sozinhos, e o Rebase Cloud ainda não faz isso: ele
  recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça o preview do
  backend, que serve os apps estáticos incorporados a ele; um projeto sem backend
  gerenciado ainda não pode ser pré-visualizado.

Um preview não faz upload de código-fonte e não registra apps ou hostnames, pois cada um
desses alteraria o projeto de produção. `--source` e `--eject` não podem ser
combinados com `--preview`. Cada um deles cria uma imagem de container para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` é sempre o de produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o
log de build ou excluir cada um deles. Criar um continua sendo uma etapa via CLI.

Um preview expira uma semana após o último deploy realizado nele.

Quando termina, o deploy verifica se o endereço do preview responde, da mesma forma que
um deploy de produção faz (`--live-timeout <seconds>`, `0` para pular). O certificado de um novo
preview pode levar um ou dois minutos, de modo que um deploy bem-sucedido pode
relatar que o endereço ainda não responde.

Um preview de backend é cobrado como uma unidade de app no tamanho padrão (100m de CPU
e 384 MiB de memória, na tarifa do seu app para sua região e capacidade),
proporcional ao tempo em que existir, e aparece na estimativa mensal do
projeto no console. `rebase cloud deploy --preview` exibe a mesma estimativa para
ele por mês (`cost` com `--json`). Iniciar um requer um cartão cadastrado, assim como um deploy de produção. Um primeiro deploy que
falha antes de qualquer coisa executar é removido em vez de cobrado. Um projeto pode executar
três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio da Let's Encrypt,
que permite 50 novos certificados por semana por domínio, compartilhados com todos os sites de produção
nele. Os previews podem consumir 20 deles em qualquer período de 7 dias, em toda a plataforma. Além
disso, um novo preview é recusado (`429`, `preview_cert_budget`) com o horário em que poderá
ser implantado; reimplantar um preview já existente nunca entra nessa contagem.

O banco de dados de um preview de backend é um segundo banco de dados no Postgres de **produção**:
seus próprios dados, mas na mesma instância e no mesmo disco. Ele é limitado a 10
conexões, de modo que os previews não esgotem as de produção, e a 2 GB: um preview
cujo banco de dados ultrapasse isso é pausado. Seu backend é interrompido, seu endereço deixa de
responder, o `rebase cloud previews` e o console o exibem como `paused` com o
motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus
dados são mantidos até que ele expire. Faça um novo deploy para iniciá-lo (ele será pausado novamente
enquanto o banco continuar grande demais) ou exclua-o. Um preview pausado continua sendo
cobrado até ser excluído ou expirar. Exclua previews que você não precisa mais. As extensões instaladas em produção não são
instaladas no banco de dados de um preview.

Os previews estão sendo disponibilizados gradualmente. Um plano de controle que ainda não os suporte recusa
`--preview` com `previews_unavailable` e não faz nenhum deploy.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que uma implantação anterior bem-sucedida
enviou e nunca recompila — o valor de um rollback é que ele entrega um
artefato que já foi executado anteriormente.

Quais implantações se qualificam depende de como o projeto faz o deploy, e ambos os tipos
funcionam:

| Como foi implantado | O que é restaurado |
|---|---|
| `rebase cloud deploy` (build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (runtime da plataforma) | O bundle que aquele deploy enviou, na versão de runtime que o projeto está executando agora |

Apps estáticos incorporados ao bundle do backend (um simples `rebase cloud deploy` em um
projeto com backend) fazem parte desse bundle, portanto sofrem rollback junto com ele.

Um app estático implantado isoladamente (`rebase cloud deploy <app>`) ainda não pode sofrer
rollback. Sua implantação registra qual app foi publicado, mas nenhum bundle, de modo que o
plano de controle não tem de onde restaurá-lo. A solução é fazer o deploy da última
versão válida novamente, por exemplo a partir do commit anterior ao problemático. Após esse tipo de
deploy, o `deploy` informa isso em vez de indicar o `rollback`, e um `rollback`
sem ID recusa em vez de reimplantar o backend em execução.

Portanto, um rollback necessita de uma implantação que tenha registrado um dos dois, o que significa um
projeto que tenha sido implantado com sucesso pelo menos duas vezes. O comando `rebase cloud deployments`
marca as que se qualificam, e `--json` relata `rollbackable` por linha junto
com a `image` ou `bundle` que restauraria.

Dois tipos de implantações são recusados, e a CLI indica qual: uma que não teve sucesso
e outra de antes da plataforma registrar seus artefatos. Não há o que adivinhar
em nenhum dos casos — adivinhar enviaria o que foi compilado ou enviado
mais recentemente fingindo restaurar esta versão —, portanto, em vez disso, faça o deploy da versão desejada.

Todo deploy bem-sucedido termina informando o caminho de volta (`rebase cloud rollback`),
para que fique visível no momento em que uma versão com problemas for notada.

Um rollback acrescenta uma nova implantação em vez de retroceder o histórico, e aguarda
a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com
`rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação,
a partir de **Database → Backups** no console ou com a CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo leva duas etapas. Primeiro, uma cópia recuperada é preparada ao lado do banco de dados em produção;
seu app continua rodando no banco em produção, e o armazenamento da cópia é faturado até
que você faça o cutover ou a descarte.
Depois, assim que a cópia estiver pronta, a transição (cutover) reaponta o app para ela e o reinicia.
Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados original
é mantido como opção de retorno e continua cobrando armazenamento; voltar atrás,
removê-lo ou fazer uma segunda restauração requer suporte. Apenas um proprietário ou administrador
pode preparar, fazer o cutover ou descartar, e o console solicita o nome do projeto
antes de realizar o cutover.

## Proteja sua conta

Sua conta do console tem acesso a bancos de dados de produção, segredos e faturamento, portanto
proteja-a como tal. Abra **Account security** no menu sob seu avatar
no console (ou acesse `/account`). A página é sua, não de uma
organização: o que você configurar ali se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password,
  Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um
  link que abre o app com a chave já preenchida em um celular, solicitando em seguida o
  código de 6 dígitos que o app exibe. A partir de então, cada login solicitará um código,
  quer você faça login com senha, Google ou GitHub.
- **Códigos de recuperação.** A ativação gera dez códigos de uso único, exibidos apenas uma vez.
  Cada um deles permite fazer login no lugar do código do autenticador caso você perca seu
  telefone, portanto salve-os antes de fechar a janela. **New recovery codes**
  os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas
  e gerar novos códigos exigem um código prévio para confirmação.
- **Senha.** Alterá-la desconecta você de todos os outros dispositivos. Uma conta
  criada com Google, GitHub ou LinkedIn não possui senha; a página oferece a opção de
  enviar por e-mail um link para definir uma.
- **Dispositivos conectados.** Cada navegador e terminal conectado à sua conta,
  com seu endereço e quando realizou o login. Desconecte qualquer dispositivo que você não
  reconheça ou todos de uma só vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo
fator, permitindo que a CI continue fazendo deploys após a ativação. Revogue tokens em que você não
confia mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Add member** adiciona alguém que já tenha uma conta Rebase com um
endereço de e-mail verificado, como admin ou member; um proprietário pode torná-lo proprietário
depois. Eles passam a ter acesso imediatamente e nada é enviado por e-mail. O Rebase Cloud ainda
não envia convites, portanto peça a um colega de equipe sem conta para se cadastrar e
verificar o endereço primeiro. A partir de um terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que
avisará caso o endereço não possua uma conta.

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` mostram aos
proprietários e administradores da organização quem fez deploy, definiu ou revelou uma variável de
ambiente (pelo nome, nunca pelo valor), alterou um domínio, restaurou um backup,
redimensionou, interrompeu ou excluiu um projeto, alterou a função de um membro ou criou um
token, e quando. As **Settings** de um projeto vinculam às suas próprias entradas; um registro
sobre um projeto excluído permanece salvo. Um script pode ler isso com um token gerado com
`--can audit` na organização. Os registros são mantidos por um ano. Os filtros estão em
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Dê a ele um token restrito a
algumas ações em um único projeto, criado a partir de um terminal autenticado com
`rebase cloud tokens create --project shop --can deploy,logs`, e configure-o como
`REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação
de uma organização são permissões próprias (`--can billing`, `audit`,
`notifications`) que um token só detém se expressamente solicitado. As permissões, um
fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` concede ao app um backend ativo antes que alguém tenha se
cadastrado, e exibe uma URL de resgate para que a pessoa possa mantê-lo; um projeto que ninguém resgata
dentro de 72 horas é excluído. O que o token do projeto não resgatado pode fazer, o
`REBASE_API_TOKEN` que ele grava e o que o resgate altera estão em
[Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação e quanto custa

O preço de um projeto é baseado no que ele reserva, não em um plano pré-definido. O comando `compute` exibe
cada parâmetro e a cotação discriminada do próprio plano de controle para eles. (`rebase cloud
resources` é algo diferente: são os bancos de dados e buckets que o código declara,
e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma, que depende da região (abaixo) |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto fatura mensalmente |
| `--autoscale-max` | 1–16. O teto que pode atingir. Instâncias que o autoscaler adiciona acima de `--replicas` são tarifadas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma tiver isso ativado; **Usage this month** informa isso. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação à solicitação e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor: um parâmetro vazio
segue o padrão da plataforma e muda quando ela muda.

Na Bélgica (europe-west1), o padrão reserva 100m de CPU e 384Mi, podendo fazer burst para
até 2 CPUs e 2 GiB; em Falkenstein e Helsinque, a memória pode se estender até 1,4× a
solicitação e a CPU até 10× (no máximo 1,7 vCPU). `rebase cloud compute` exibe os números do seu projeto.

Nada é validado pela CLI, intencionalmente — os limites pertencem ao cluster no qual o
projeto é executado e variam entre provedores. O plano de controle recusa um
valor que não pode atender e indica o campo. Execute `rebase cloud compute` para ver o
valor em €/mês antes e depois; uma alteração se aplica imediatamente, com cobrança proporcional a partir de hoje.
Uma alteração de banco de dados é aplicada na hora; faturada no tamanho atual até que esteja em execução.
Uma nova CPU ou memória para o banco de dados, ou redução de instâncias, reinicia o banco (cerca de
30 segundos a 3 minutos; as conexões caem e se reconectam): `compute set`
avisa isso e pede confirmação; fora de um terminal interativo, `--yes` serve como consentimento. Se esse reinício
falhar, `rebase cloud compute apply` tenta novamente.

## O restante dos recursos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` exibe o bearer token que a CLI enviaria agora, para scripts e para o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude o alcance ao lado dos seus projetos Cloud. `--list` os exibe, `--remove` remove um deles. Apenas proprietários e admins |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para resgatá-lo; `claim` exibe esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicação e monitoramento |
| `deploy-hooks` | URLs secretas que um host git ou CI chama para fazer deploy do projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Builds servidos em seu próprio endereço por `deploy --preview`, e sua exclusão. Consulte [Pré-visualizar uma alteração](#pré-visualizar-uma-alteração) |
| `sleep` | Dormir quando ocioso: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, e `status` (o padrão). Adormecido, o projeto não consome CPU ou memória e a próxima requisição o acorda; tarefas agendadas e trabalho em segundo plano não são executados nesse período. Onde um projeto não puder dormir, o plano de controle recusa e explica o motivo |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura, a menos que a plataforma fature projetos interrompidos apenas pelo armazenamento e taxa da plataforma; a linha **Billing** do console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que não está |
| `alerts` | Os incidentes abertos do projeto, com opção de confirmação ou adiamento. |
| `cron` | Os cron jobs do app implantado e suas execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `app-key` | A chave que `init --claim` gravou em `.env` como `REBASE_API_TOKEN`, transferida no resgate; `rotate` a substitui e revoga a antiga. Proprietários e admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` gera uma nova para o app. Proprietários e admins |
| `domains` | Domínios personalizados, os registros DNS a serem adicionados e a verificação. Um projeto pode responder em vários, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual atuar, o qual só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). Todo domínio verificado serve o projeto diretamente; `primary <domain>` escolhe o canônico e `redirect <domain>` responde a outro com um 308 para ele, mantendo caminho e query (`--off` volta a servi-lo) — faça isso para `www.` junto a um apex, já que o login com Google, cookies e passkeys são por origem. Um domínio no qual um app é servido (um `path` de app com hostname) nunca redireciona. Um domínio apex (`example.com`, sem subdomínio) requer um registro **A**, porque o DNS não permite CNAME ali. Esse endereço é o ingress da plataforma, e não há garantia de que permanecerá o mesmo: se a plataforma mudar, um registro A continuará apontando para o endereço antigo. Onde seu provedor de DNS oferecer ALIAS, ANAME ou CNAME flattening no apex, aponte o apex para o `tenantHost` do projeto, que acompanha a plataforma. O CNAME de um subdomínio já a acompanha automaticamente. `list` diz `verified, certificate pending` até que o HTTPS responda com um certificado real. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir de sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Os usuários convidados deixados para trás pelo login anônimo: conte-os, exclua um, limpe os não vistos há muito tempo. Consulte [Convidados](/docs/cli/cloud/#guests). Proprietários e admins |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu com o backend, do mais recente para o mais antigo: escalonamento do app, alterações de banco agendadas e aplicadas, um standby assumindo, crescimento do disco |
| `usage` | Requisições utilizadas neste mês em relação à franquia incluída e o excedente acumulado, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters nos quais os tenants rodam. Apenas para platform-admin |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações, seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem implantou, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e admins. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications` | Onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Notificações da Cloud](/docs/deployment/cloud-notifications/)) |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso,
suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o
índice para as páginas, portanto um grupo adicionado sem uma página falha a compilação em vez de
responder com o índice. O comando `verify:docs` vincula a própria tabela a
esse índice: todo grupo disparado pela CLI aparece aqui exatamente uma vez, de forma que um grupo
adicionado sem uma linha também causa falha no build.

Quando usado em pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos
em uma estrutura para ser lida, em vez de sessenta linhas de caracteres de escape do terminal.

## O que o beta ainda não inclui

Declarado abertamente, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo roda em uma única região atualmente. O modelo de alocação
  existe na plataforma, mas um projeto não pode escolher uma região.
  `projects create --provider` e `--region` não são a exceção que aparentam
  ser: eles apenas registram a qual dos alvos de deploy cadastrados no plano de controle um
  projeto pertence, e há apenas um, portanto ambos adotam esse padrão e nenhum deles move um
  projeto para outro lugar. `rebase cloud projects create --help` informa o mesmo.
- **Sem autoatendimento.** O acesso é concedido em lotes; não há opção de apenas cadastrar e pagar.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de algum dos dois, informe ao solicitar
  acesso em vez de presumir que existam.
- **Sem deploys por branch** e sem GitHub App oficial. Deploy hooks — URLs secretas
  para as quais você aponta o webhook de um repositório — são a automação suportada. [Deploys de
  preview](#pré-visualizar-uma-alteração) estão sendo lançados e são iniciados a partir da CLI.
- **Tokens agem em nome de uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é gerado por uma conta
  e atua como ela; ainda não existe uma identidade de máquina de propriedade da organização. Se você
  fizer login via CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  a partir de um cofre de segredos — `--password` coloca a senha no histórico do seu shell e
  na tabela de processos, avisando antes de realizar o login. Se o arquivo
  `.rebase/cloud.json` do repositório indicar um plano de controle diferente do próprio da plataforma, passe-o
  também como `--url`: sem um terminal, o `login` recusa enviar uma senha para um
  host nomeado apenas pelo arquivo baixado do repositório.
- **Sem endpoint público para o banco de dados.** Um banco de dados gerenciado não é exposto à
  internet, portanto o host exibido pelo console é o endereço que o seu backend usa para acessá-lo e
  não resolve para nada na sua máquina. `rebase cloud db connect` abre uma porta local
  que se conecta a esse banco, tunelada pelo plano de controle, enquanto
  você a mantiver em execução — mas não há um hostname permanente ao qual um serviço terceiro
  possa se conectar. Para rodar SQL sem um cliente Postgres local,
  `rebase cloud db query "<sql>"` ou `rebase cloud db query --file file.sql` abre o
  mesmo túnel para uma única consulta, executa o texto como um script (parando no primeiro
  erro) e exibe a resposta de cada declaração (`--json` para scripts). Tanto esse túnel quanto a senha por trás de
  `rebase cloud db info --reveal` exigem a função de proprietário ou administrador da
  organização: a mesma solicitada pelo editor SQL do Studio, pois todos os três resultam em uma
  sessão sobre os seus dados de produção.
- **Fazer deploy é executar código com os segredos de produção.** O ambiente
  do app contém `REBASE_SERVICE_KEY` (admin em sua própria API),
  `DATABASE_URL` e `JWT_SECRET`, portanto qualquer código implantado por um membro pode lê-los,
  embora apenas proprietários e admins possam revelá-los no console. Convide
  como membro apenas quem você confiaria para ter acesso a esses valores.
- **A chave de serviço pode ser substituída.** As **Settings** do projeto
  (ou `rebase cloud service-key rotate`) emitem uma nova `REBASE_SERVICE_KEY`
  e reiniciam o app utilizando-a. A chave antiga funciona até que o reinício seja
  concluído, e nada além disso, de modo que qualquer serviço que a tenha copiado será recusado a
  partir de então. Resgatar um projeto faz o mesmo.

## Auto-hospedagem como alternativa

Nada aqui é um aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa a mesma imagem e bundle idênticos com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do
Helm chart.
