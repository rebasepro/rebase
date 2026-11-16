---
sourceHash: 4b05c04581ef0b7d
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você auto-hospedaria — a mesma imagem publicada `rebasepro/server`, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e abre o acesso em lotes. [Request access](https://rebase.pro/pricing).

Não é self-service, portanto os comandos abaixo precisam de uma conta que tenha recebido acesso. Todo o restante deste site funciona sem uma conta.
:::

## O que é

Um **projeto** no Cloud é composto por três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são um upload de bundle, não um build de contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação a um ponto no tempo (point-in-time recovery) |
| **Storage** | Um bucket próprio, se o seu projeto usar armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é cobrado pelo que reserva, em vez de cobrança por assento.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a rota de escape é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir de um diretório de projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O comando `login` abre o console no seu navegador e exibe um código curto. Verifique se o console mostra o mesmo código e aprove o login lá: o terminal obtém a sessão e a grava em `~/.rebase/credentials.json`. Se você não estiver conectado ao console, faça login lá primeiro usando a opção que preferir, incluindo Google e GitHub. Via SSH, `rebase cloud login --no-browser` exibe o link para abrir em sua própria máquina.

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal interativo, eles são solicitados, e uma execução headless que omitir qualquer um deles é encerrada com `input_required` em vez de gerar um valor aleatório. **O subdomínio não pode ser editado posteriormente:** ele é o host `<slug>.rebase.website` no qual o projeto responde, portanto, escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma etapa de `link` separada. Ele grava `.rebase/cloud.json`, que registra o id e o slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

Ele é comitado com o código, no entanto, para que um repositório clonado possa nomear qualquer control plane. Quando o host vem apenas desse arquivo, e não é o da própria plataforma nem um no qual você já tenha feito login anteriormente, o `login` informa seu nome e pede confirmação antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login intencionalmente.

Para fazer login sem o navegador, informe seu e-mail: `rebase cloud login --email me@example.com` solicitará sua senha. **Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não tem senha, então use um código:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia a você um código de 6 dígitos por e-mail, válido por dez minutos, para você digitar no prompt. Com `--email` e sem senha, `rebase cloud login` pergunta se você deseja usar sua senha ou um código. Os códigos exigem que o control plane seja capaz de enviar e-mails; se não puder, `--code` relata isso e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente do método de login utilizado. Pelo navegador, o console solicita isso ao entrar lá. Nem um código de login nem um segundo fator podem ser digitados sem um terminal. Para um script, crie um token de acesso no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials` e oferece as mesmas duas formas de entrada, já que a causa comum é uma conta que nunca possuiu senha.

`billing setup` associa um cartão à organização, apenas uma vez. Ele é o primeiro na sequência intencionalmente: o primeiro deploy de um projeto é recusado sem um cartão, e descobrir isso depois que o bundle terminou o upload seria a pior experiência.

Depois disso, a página **Billing** do console lista as faturas da organização, cada uma com a página hospedada e o PDF da Stripe, além de exibir uma prévia da próxima fatura de cada projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` exibem o mesmo. Ambos são destinados aos proprietários (owners) e administradores da organização. Onde a plataforma disponibiliza, **Manage billing** abre o portal do cliente da Stripe para gerenciar o cartão, detalhes de faturamento e faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não requer um segundo pagamento: o projeto é cobrado nesse cartão e implantado. Se o cartão for recusado ou o banco solicitar confirmação do pagamento, o console direciona você para **Billing**, onde **Fix your card** salva outro cartão e **Complete the payment** abre a fatura da Stripe.

O consumo de um projeto é exibido em sua visão geral, em **Usage this month**, e para todos os projetos simultaneamente na página **Billing**: requisições em relação à cota incluída (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento e a projeção para o mês nesse ritmo. O excedente é calculado pelo mesmo código que o reporta à Stripe, portanto é o valor que constará na fatura; ele aparece na fatura do mês seguinte. `rebase cloud usage` exibe o mesmo, e `rebase cloud usage org` exibe para toda a organização. Qualquer membro pode visualizar. Os números indicam o que ainda não é possível contabilizar: o object storage não é medido, portanto nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de aplicativo, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um projeto com autoscaling também mostra os pods executados acima de `--replicas`, em pod-horas, quanto custaram em suas próprias taxas e se esta plataforma já os está cobrando. Um projeto reivindicado a partir de um agente contabiliza apenas os dias a partir da reivindicação: antes disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando e nenhuma flag para memorizar. O `rebase.json` de um scaffold declara `runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele informa isso durante o processo (`rebase.json declares runtime: managed — deploying a bundle`), compila o aplicativo em `dist-bundle`, faz o upload do bundle, executa-o na imagem de runtime publicada e acompanha o deployment até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona de forma autônoma em CI.

Ele finaliza informando onde cada app agora responde e se a nova versão está ativa lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o `/health` de um backend retornou `ok`, e a página de um app estático foi carregada (a partir deste deployment, quando a plataforma o serve). A verificação aguarda até `--live-timeout` segundos, sendo 60 o padrão; `0` pula a verificação. Se um app não responder a tempo, o deploy ainda assim sai com código zero, porque o deployment foi bem-sucedido, e a última linha informa qual app não respondeu e o motivo. Um deploy que falha termina em apenas uma linha, indicando o app e o motivo, com `rebase cloud logs` para o log completo de build.

Scripts podem passar `--json` para receber um único objeto contendo os mesmos dados — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o deployment id. Diferente do restante do `rebase cloud`, o `deploy` não alterna para JSON automaticamente quando encadeado em pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de body, sistema de arquivos, secrets, storage e tráfego de rede de saída — está em sua própria página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — como um job de CI que compila uma vez e faz deploy duas vezes — aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais a solicita: um build que migraria um projeto gerenciado para uma imagem de contêiner própria é recusado até que você confirme explicitamente. `--force` costumava significar isso, o que colocava a ação menos reversível da CLI sob a mesma palavra que "sobrescrever este arquivo"; agora ela é uma opção desconhecida em vez de um alias, de modo que um script que a contenha é interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando seu `build` apenas copia scripts escritos manualmente para `output`, nada os analisou, e um arquivo com erro de digitação vai para o ar e impede o carregamento da página. Portanto, antes que qualquer coisa seja enviada, o `deploy` analisa cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso cobre tanto um app estático implantado sozinho quanto apps estáticos integrados ao bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que o navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` que não seja JavaScript, tags `<script src>` e scripts que ainda contenham marcações de template não renderizadas, como `{{ }}`. Um arquivo `.js` é aprovado se for analisado com sucesso como um script clássico ou como um módulo, pois a página é quem decide qual deles é. Nada sob `node_modules` é lido, e o mesmo vale para um `--bundle-dir` pré-compilado. `--no-verify` pula a verificação para um deploy.

Acompanhe com:

```bash
rebase cloud logs               # o log de build
rebase cloud logs --runtime -f  # o que o app em execução exibe, ao vivo, até Ctrl-C
rebase cloud status             # o que a plataforma considera que o projeto está fazendo
```

`status` relata `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está realmente trabalhando e fazer polling é a atitude correta; quando indicar algo, esse algo está esperando por você.

## Visualizar uma alteração em preview

```bash
rebase cloud deploy --preview
```

Isso compila e envia exatamente o que o `deploy` enviaria, mas o disponibiliza em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que servia antes. O deploy exibe o endereço do preview quando o build termina.

Para manter um único endereço entre deploys, dê um nome ao preview. Fazer o deploy com o mesmo nome novamente o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** gera um preview do backend, com seus apps estáticos integrados, da mesma forma que a produção os executa. Ele recebe um backend próprio em um **banco de dados vazio próprio**, nunca o de produção. Inicializar contra o banco de produção aplicaria a ele o schema e as regras de acesso do preview.
- **`rebase cloud deploy web --preview`** geraria um preview de um app estático isolado, com suas páginas chamando o backend de **produção**. Isso requer um control plane que sirva sites estáticos de forma autônoma, e o Rebase Cloud ainda não faz isso: ele recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça o preview do backend, que serve os apps estáticos integrados a ele; um projeto sem backend gerenciado ainda não pode ser visualizado em preview.

Um preview não faz upload de código-fonte e não registra apps ou hostnames, pois qualquer uma dessas ações alteraria o projeto de produção. `--source` e `--eject` não podem ser combinados com `--preview`. Cada um deles cria uma imagem de contêiner para produção.

```bash
rebase cloud previews                      # nome, endereço, app, backend, expiração
rebase cloud logs --preview new-checkout   # log de build; -f acompanha um build ainda em execução
rebase cloud logs --runtime --preview new-checkout -f  # o que o backend exibe
rebase cloud previews delete new-checkout  # interrompe o serviço e exclui seu banco de dados
```

`rebase cloud logs` sem `--preview` é sempre o de produção.

A página **Deployments** do console lista os mesmos previews, permitindo abrir, visualizar o log de build ou excluir cada um deles. A criação de um preview continua sendo uma etapa via CLI.

Um preview expira uma semana após seu último deploy.

Quando termina, o deploy verifica se o endereço do preview responde, da mesma forma que um deploy de produção faz (`--live-timeout <seconds>`, `0` para pular). O certificado de um novo preview pode levar um ou dois minutos, portanto um deploy bem-sucedido pode relatar que o endereço ainda não está respondendo.

O preview de um backend é cobrado como uma unidade de aplicativo no tamanho padrão (100m de CPU e 384 MiB de memória, na taxa do seu app para sua região e capacidade), proporcional ao tempo em que existir, e aparece na estimativa mensal do projeto no console. `rebase cloud deploy --preview` exibe a mesma estimativa mensal para ele (`cost` sob `--json`). Iniciar um requer um cartão cadastrado, assim como um deploy de produção. Um primeiro deploy que falhar antes de qualquer execução é removido em vez de cobrado. Um projeto pode executar até três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio do Let's Encrypt, que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de produção nele contidos. Os previews podem consumir até 20 deles a cada período de 7 dias em toda a plataforma. Ultrapassado esse limite, um novo preview é recusado (`429`, `preview_cert_budget`) informando o momento em que poderá ser implantado; reimplantar um preview existente nunca consome essa cota.

O banco de dados de um preview de backend é um segundo banco no Postgres de **produção**: dados próprios, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, de modo que os previews não esgotem as de produção, e a 2 GB: um preview cujo banco cresça além disso é pausado. Seu backend para, seu endereço deixa de responder, `rebase cloud previews` e o console o mostram como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até expirar. Faça o deploy dele novamente para iniciá-lo (ele será pausado de novo se o banco ainda estiver grande demais) ou exclua-o. Um preview pausado continua sendo cobrado até ser excluído ou expirar. Exclua os previews de que não precisa mais. Extensões instaladas em produção não são instaladas no banco de dados de um preview.

Os previews estão sendo lançados gradualmente. Um control plane que ainda não os ofereça recusará `--preview` com `previews_unavailable` e não implantará nada.

## Fazer rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que um deployment anterior bem-sucedido entregou, e nunca recompila — o valor de um rollback é entregar um artefato que já foi executado anteriormente.

Quais deployments se qualificam depende de como o projeto faz o deploy, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que aquele deploy entregou, na versão de runtime que o projeto está executando agora |

Apps estáticos integrados ao bundle do backend (um simples `rebase cloud deploy` em um projeto com backend) fazem parte desse bundle, portanto revertem junto com ele.

Um app estático implantado isoladamente (`rebase cloud deploy <app>`) ainda não pode ser revertido por rollback. Seu deployment registra qual app publicou, mas nenhum bundle, portanto o control plane não tem de onde restaurá-lo. A solução é implantar a última versão em bom estado novamente, por exemplo a partir do commit anterior ao problemático. Após esse deploy, o comando `deploy` informa isso em vez de indicar o `rollback`, e o `rollback` sem um id recusa a ação em vez de reimplantar o backend em execução.

Portanto, um rollback precisa de um deployment que tenha registrado um dos dois, o que requer um projeto com pelo menos dois deploys bem-sucedidos. `rebase cloud deployments` marca os que se qualificam, e `--json` reporta `rollbackable` por linha juntamente com o `image` ou `bundle` que restauraria.

Dois tipos de deployment são recusados, e a CLI indica quais: um que não foi bem-sucedido e outro anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há adivinhação em nenhum dos casos — adivinhar enviaria o que foi compilado ou enviado mais recentemente fingindo restaurar este — então faça o deploy da versão desejada diretamente.

Cada deploy bem-sucedido termina informando o caminho de volta (`rebase cloud rollback`), mantendo-o visível no momento em que um lançamento com problemas for notado.

Um rollback adiciona um novo deployment em vez de reescrever o histórico, e aguarda a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, a partir de **Database → Backups** no console ou via CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo ocorre em duas etapas. Primeiro, uma cópia recuperada é preparada (staged) ao lado do banco de dados ativo; seu app continua rodando no ativo, e o armazenamento da cópia é cobrado até você fazer o cutover ou descartá-la.
Depois, assim que a cópia estiver pronta, o cutover reaponta o app para ela e o reinicia. Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados original é mantido como contingência para retorno e continua cobrando armazenamento; retornar para ele, removê-lo ou fazer uma segunda restauração requer suporte. Apenas um proprietário (owner) ou administrador pode preparar o ambiente, fazer o cutover ou descartar, e o console solicita o nome do projeto antes de executar o cutover.

## Proteger sua conta

Sua conta do console tem acesso a bancos de dados de produção, secrets e faturamento, portanto proteja-a adequadamente. Abra **Account security** a partir do menu sob seu avatar no console (ou acesse `/account`). A página pertence a você, não a uma organização: o que você configurar lá se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um link que abre o app com a chave preenchida no celular, e em seguida solicita o código de 6 dígitos exibido no app. A partir de então, todo login solicitará um código, quer você entre com senha, Google ou GitHub.
- **Códigos de recuperação.** A ativação fornece dez códigos de uso único, exibidos apenas uma vez. Cada um deles permite fazer login no lugar do código do autenticador caso perca seu celular, portanto guarde-os antes de fechar o diálogo. **New recovery codes** os substitui, e os antigos param de funcionar. Desativar a verificação em duas etapas e gerar novos códigos exigem a digitação prévia de um código.
- **Senha.** Alterá-la desconecta você em todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não possui senha; a página oferece o envio de um link por e-mail para definir uma.
- **Dispositivos conectados.** Cada navegador e terminal conectado à sua conta, com seu endereço e quando fez login. Desconecte qualquer dispositivo que você não reconheça ou todos de uma vez.

[Access tokens](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo fator, de modo que o CI continua fazendo deploys depois de ativá-la. Revogue um token no qual não confia mais em **Settings → Access tokens**.

## Convidar sua equipe

**Members → Invite member** gera um link para copiar (enviado por e-mail quando este control plane tiver envio de e-mails habilitado) que funciona uma única vez, durante 7 dias, para uma conta que tenha verificado esse endereço; ninguém entra até que aceite. Convide um administrador ou membro, e promova-o a proprietário (owner) após a adesão. Proprietários e administradores podem ver, reenviar ou revogar convites em **Pending invitations**; a partir de um terminal, utilize [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Ver quem fez o quê

A página **Activity** do console e `rebase cloud activity` mostram aos proprietários e administradores da organização quem fez deploy, definiu ou revelou uma variável de ambiente (por nome, nunca por valor), alterou um domínio, restaurou um backup, redimensionou, interrompeu ou excluiu um projeto, alterou o papel de um membro ou criou um token, e quando. A seção **Settings** de um projeto vincula às suas próprias entradas; entradas sobre projetos excluídos são mantidas. Um script pode lê-las com um token criado com `--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token restrito a algumas ações em um único projeto, criado a partir de um terminal autenticado com `rebase cloud tokens create --project shop --can deploy,logs`, e configure-o como `REBASE_TOKEN`. Faturamento da organização, log de atividades e configurações de notificação são permissões próprias (`--can billing`, `audit`, `notifications`) que um token só detém se expressamente solicitado. As permissões, um fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão em [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` fornece a um aplicativo um backend em execução antes mesmo de qualquer cadastro e exibe uma URL de reivindicação (claim URL) para a pessoa mantê-lo; um projeto que ninguém reivindicar dentro de 72 horas é excluído. O que o token de um projeto não reivindicado pode fazer, o `REBASE_API_TOKEN` que ele grava e o que a reivindicação altera estão em [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação e quanto custa

O preço de um projeto é baseado no que ele reserva, não em um plano ou nível. `compute` exibe cada parâmetro e a cotação detalhada do próprio control plane para eles. (`rebase cloud resources` é diferente: mostra os bancos de dados e buckets que o código declara e se cada um está provisionado — consulte a [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Request do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `100m` e `384Mi`, com burst para 2 CPU e `2Gi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que pode atingir. Instâncias que o autoscaler adiciona acima de `--replicas` são tarifadas por pod-segundo nas mesmas taxas e cobradas apenas onde a plataforma tiver ativado essa cobrança; **Usage this month** indica isso. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, calculada em relação ao request e não ao limit. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio segue o padrão da plataforma e muda quando o padrão mudar.

Nada é validado pela CLI, de propósito — os limites pertencem ao cluster no qual o projeto é executado e variam entre provedores. O control plane recusa valores que não pode atender e indica o campo. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; as alterações entram em vigor imediatamente, calculadas proporcionalmente a partir de hoje, exceto as que reiniciam o banco de dados, que aguardam uma janela de manutenção.

## O restante da superfície de comandos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` exibe o token bearer que a CLI enviaria agora, para scripts e o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude o alcance ao lado de seus projetos Cloud. `--list` os exibe, `--remove` remove um. Proprietários e administradores |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` exibe esse link novamente. Consulte [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Envio e monitoramento |
| `deploy-hooks` | URLs secretas que um host git ou CI chama para fazer o deploy do projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Builds servidos em endereço próprio via `deploy --preview` e como excluí-los. Consulte [Preview a change](#visualizar-uma-alteração-em-preview) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura, a menos que a plataforma cobre projetos interrompidos apenas pelo armazenamento e pela taxa da plataforma; a linha **Billing** do console indica quando for o caso |
| `status`, `metrics`, `debug` | O que está executando e o motivo quando não estiver |
| `alerts` | Incidentes abertos do projeto, com opção de confirmação ou adiamento. |
| `cron` | Tarefas cron do aplicativo implantado e suas execuções registradas, lidas com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente escrita |
| `app-key` | A chave que `init --claim` gravou em `.env` como `REBASE_API_TOKEN`, transferida na reivindicação; `rotate` a substitui e revoga a antiga. Proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, com privilégio admin na própria API do app: data da última rotação; `rotate` gera uma nova para o app. Proprietários e administradores |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em vários domínios, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual atuar, que só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). Cada domínio verificado serve o projeto diretamente; `primary <domain>` escolhe o canônico e `redirect <domain>` responde em outro domínio com um 308 para ele, preservando path e query (`--off` volta a servi-lo diretamente) — faça isso para `www.` ao lado de um apex domain, já que login do Google, cookies e passkeys são por origem. O domínio no qual um app é servido (um `path` de app com hostname) nunca redireciona. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir de sua máquina, backups, restauração e recuperação a um ponto no tempo (point-in-time recovery) |
| `guests` | Usuários anônimos deixados pelo login anônimo: conte-os, exclua um, limpe os não vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Proprietários e administradores |
| `extensions` | A allowlist de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu com o backend, do mais recente para o mais antigo: escalonamento do app, alterações de banco agendadas e aplicadas, ativação de standby, aumento de disco |
| `usage` | Requisições utilizadas neste mês em relação à cota incluída e o excedente até o momento, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters nos quais os tenants rodam. Apenas administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações e seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e administradores. Consulte [See who did what](#ver-quem-fez-o-quê) |
| `notifications` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo dessa tabela responde ao `--help` com uma página própria — uma linha de sintaxe de uso, suas flags e exemplos — e o `--help` nunca executa o comando. Um teste valida o índice dessas páginas, de modo que um grupo adicionado sem uma página falha o build em vez de responder com o sumário. O script `verify:docs` valida a própria tabela em relação a esse índice: cada grupo executado pela CLI aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha também falha o build.

Quando encadeado em pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos como uma estrutura legível, em vez de sessenta linhas de sequências de escape do terminal.

## O que o beta não inclui

Explicado de forma direta, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo roda em uma única região atualmente. O modelo de alocação existe na plataforma, mas um projeto não pode escolher a região. `projects create --provider` e `--region` não são as exceções que parecem: eles registram a qual dos alvos de deploy registrados no control plane um projeto pertence, e há apenas um, portanto ambos adotam o padrão e nenhum move o projeto para outro lugar. `rebase cloud projects create --help` informa o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há opção de cadastrar-se e pagar diretamente.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de qualquer um deles, mencione ao solicitar acesso em vez de assumir que existem.
- **Sem branch deploys** e sem GitHub App oficial. Deploy hooks — URLs secretas para as quais você aponta o webhook de um repositório — são a automação suportada. [Deploys de preview](#visualizar-uma-alteração-em-preview) estão sendo lançados e são iniciados via CLI.
- **Tokens atuam como uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é gerado por uma conta e atua em nome dela; ainda não há identidade de máquina pertencente à organização. Se, em vez disso, você fizer login a partir do CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um cofre de segredos — `--password` coloca a senha no histórico do seu shell e na tabela de processos, alertando sobre isso antes de autenticar. Se o arquivo `.rebase/cloud.json` do repositório indicar um control plane diferente do próprio da plataforma, passe-o também como `--url`: sem um terminal, o `login` se recusa a enviar uma senha para um host indicado apenas pelo arquivo versionado.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não é exposto à internet, portanto o host exibido pelo console é o endereço que o seu backend usa para acessá-lo e não resolve para nada na sua máquina. `rebase cloud db connect` abre uma porta local que representa esse banco, tunelada pelo control plane, enquanto você a mantiver em execução — mas não existe um hostname permanente ao qual um serviço de terceiros possa se conectar. Esse túnel e a senha exibida por `rebase cloud db info --reveal` exigem a função de proprietário (owner) ou administrador da organização: a mesma solicitada pelo editor SQL do Studio, pois todos os três resultam em uma sessão sobre os seus dados de produção.
- **Fazer deploy é executar código com as secrets de produção.** O ambiente do app contém `REBASE_SERVICE_KEY` (privilégio admin na sua própria API), `DATABASE_URL` e `JWT_SECRET`, de modo que o código que um membro implanta pode lê-los, mesmo que apenas proprietários e administradores possam visualizá-los no console. Convide como membro apenas pessoas em quem você confiaria esses valores.
- **A service key pode ser substituída.** A seção **Settings** do projeto (ou `rebase cloud service-key rotate`) emite uma nova `REBASE_SERVICE_KEY` e reinicia o aplicativo com ela. A chave antiga funciona até que o reinício seja concluído, e nada além disso; portanto, qualquer chamada que a tenha copiado será recusada a partir de então. Reivindicar um projeto faz o mesmo.

## Auto-hospedagem como alternativa

Nada aqui é aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a imagem e o bundle idênticos com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.
