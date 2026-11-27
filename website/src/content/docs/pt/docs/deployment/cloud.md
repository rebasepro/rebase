---
sourceHash: 3594b5aeed9b6b44
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem publicada `rebasepro/server`, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e é liberado em lotes. [Request access](https://rebase.pro/pricing).

Ele não é autosserviço, portanto os comandos abaixo precisam de uma conta que tenha recebido acesso. Todo o restante deste site funciona sem uma.
:::

## O que é

Um **projeto** do Cloud é composto por três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são um upload de bundle, não um build de container |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação point-in-time |
| **Storage** | Um bucket próprio no [Rebase Storage](/docs/deployment/rebase-storage/), se o seu projeto usar armazenamento de arquivos |

O app e o banco de dados são provisionados no seu primeiro deploy; um bucket somente quando você solicitar um ([Armazenamento de arquivos](#armazenamento-de-arquivos)). Cada um é faturado pelo que reserva, em vez de por usuário (seat).

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a rota de escape é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Conectar um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O comando `login` abre o console no seu navegador e imprime um código curto. Verifique se o console exibe o mesmo código e aprove o login por lá: o terminal captura a sessão e a grava em `~/.rebase/credentials.json`. Se você não estiver conectado ao console, faça login lá primeiro usando o método de sua preferência, incluindo Google e GitHub. Via SSH, `rebase cloud login --no-browser` imprime o link para abrir em sua própria máquina.

`projects create` não recebe argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — no terminal, eles serão solicitados interativamente, e uma execução headless que omita qualquer um deles sairá com `input_required` em vez de inventar um. **O subdomínio não pode ser editado posteriormente:** é o host `<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com atenção.

`--link` vincula este diretório ao projeto na mesma chamada, de modo que não há uma etapa de `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que registra o id e o slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado com o código, de forma que um repositório clonado pode apontar para qualquer control plane. Quando o host provém apenas desse arquivo, e não é o da própria plataforma nem um no qual você já tenha feito login anteriormente, o `login` o identifica e solicita confirmação antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login deliberadamente nesse destino.

Para fazer login sem o navegador, informe seu e-mail: `rebase cloud login --email me@example.com` solicita sua senha. **Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não possui senha, portanto use um código:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia por e-mail um código de 6 dígitos, válido por dez minutos, e você o digita no prompt. Com `--email` e sem senha, `rebase cloud login` pergunta se você deseja usar sua senha ou um código. Os códigos exigem que o control plane consiga enviar e-mails; caso não consiga, `--code` avisa e é encerrado com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente de como você fez login. Pelo navegador, o console solicita isso quando você faz login por lá. Nem um código de login nem um segundo fator podem ser digitados sem um terminal. Para um script, crie um token de acesso no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials` e oferece as mesmas duas formas de acesso, já que a causa comum é uma conta que nunca teve uma senha configurada.

`billing setup` associa um cartão à organização, uma única vez. Ele está no início da sequência de propósito: o primeiro deploy de um projeto é recusado sem um cartão, e descobrir isso após o upload completo de um bundle é uma experiência pior.

Depois disso, a página **Billing** do console lista as faturas da organização, cada uma com a página hospedada da Stripe e PDF, e exibe uma prévia da próxima fatura de cada projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` imprimem as mesmas informações. Ambos são para proprietários e administradores da organização. Onde a plataforma disponibiliza, **Manage billing** abre o portal do cliente da Stripe para gerenciar o cartão, detalhes de faturamento e faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não requer um segundo pagamento: o projeto é faturado nesse cartão e o deploy é realizado. Se o cartão for recusado, ou se o banco exigir a confirmação do pagamento, o console direciona você para **Billing**, onde **Fix your card** salva outro cartão e **Complete the payment** abre a fatura da Stripe.

O que um projeto consumiu é exibido em sua visão geral, em **Usage this month**, e para todos os projetos de uma vez na página **Billing**: requisições em relação à cota incluída (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento e qual será a projeção para o mês nesse ritmo. O excedente é calculado pelo mesmo código que o reporta à Stripe, portanto é o que constará na fatura; ele aparece na fatura do mês seguinte. `rebase cloud usage` imprime o mesmo, e `rebase cloud usage org` mostra para toda a organização. Qualquer membro pode visualizar. Os números indicam o que ainda não conseguem contabilizar: o armazenamento de objetos é medido, mas ainda não é faturado ([Rebase Storage](/docs/deployment/rebase-storage/) informa o preço); enquanto um projeto executa dois ou mais pods de app, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem menor. Um projeto com autoscaling também exibe os pods executados acima de `--replicas`, em pod-horas, quanto custam nas suas taxas e se esta plataforma já os cobra. Um projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação: antes disso, o projeto pertencia à plataforma.

Um projeto existente é vinculado sem precisar criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Fazer deploy

```bash
rebase cloud deploy
```

Um único comando, sem flags para memorizar. O `rebase.json` de um scaffold declara `runtime: "managed"` para seu backend, e `deploy` lê essa declaração — ele avisa durante o processo (`rebase.json declares runtime: managed — deploying a bundle`), compila o app em `dist-bundle`, faz o upload do bundle, o executa na imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona sem intervenção em CI.

Ele termina informando onde cada app responde agora e se a nova versão está ativa lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o `/health` de um backend retornou `ok`, e a página de um app estático carregou (a partir deste deploy, quando a plataforma o serve). A verificação aguarda até `--live-timeout` segundos, 60 por padrão; `0` a ignora. Se um app não responder a tempo, o deploy ainda sai com código zero, porque a implantação foi bem-sucedida, e a última linha informa qual app não respondeu e o motivo. Um deploy que falha termina em uma linha, informando o app e o motivo, com `rebase cloud logs` para o log completo de build.

Scripts passam `--json` para receber um único objeto contendo as mesmas informações — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id do deploy. Diferente do restante do `rebase cloud`, `deploy` não muda para JSON automaticamente quando usado em pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de body, sistema de arquivos, segredos, armazenamento e rede de saída — está em sua página própria:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para publicar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e faz deploy duas vezes — aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado possui sua própria flag, `--eject`, e nada mais a solicita: um build que migraria um projeto gerenciado para uma imagem de container que ele passa a possuir é recusado até que você determine isso expressamente. Antes, `--force` significava isso, o que colocava a ação menos reversível da CLI sob a mesma palavra que "sobrescreva este arquivo"; agora é uma opção desconhecida em vez de um alias, de modo que um script que a utilize é interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando seu `build` apenas copia scripts escritos manualmente para `output`, nada os analisou sintaticamente, e um arquivo com um erro de digitação pode ir para o ar e impedir o carregamento da página. Portanto, antes de qualquer upload, `deploy` analisa sintaticamente cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso cobre tanto um app estático implantado sozinho quanto apps estáticos integrados ao bundle do backend. Um erro de sintaxe interrompe o deploy exibindo o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` não-JavaScript, um `<script src>` e scripts que ainda contenham marcações de template não renderizadas como `{{ }}`. Um arquivo `.js` passa se for analisado com sucesso como script clássico ou módulo, já que a página decide qual deles usar. Nada em `node_modules` é lido, assim como nenhum `--bundle-dir` pré-compilado. `--no-verify` pula a verificação para um deploy.

Acompanhe:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` relata `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está genuinamente trabalhando e fazer polling é a coisa certa a se fazer; quando indicar algo, esse algo está esperando por você.

Um desses casos é `email_not_configured`: o app ativou login por magic link ou código por e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) e não possui um serviço de e-mail, portanto a implantação está ativa, mas ninguém consegue fazer login. O Rebase Cloud não envia e-mails para o seu app: defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` com `rebase cloud env set`, e depois faça o deploy. `status` lê isso a partir do próprio endpoint `GET /api/auth/config` do app (seu campo `unavailable`), e `deploy` exibe o mesmo em sua verificação de disponibilidade.

## Mais de um banco de dados

Declare cada um (`database("analytics")`) e faça o deploy: ele é criado no servidor do projeto como `DATABASE_URL__ANALYTICS`, compartilhando seus recursos e fatura ([detalhes](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Armazenamento de arquivos

Um novo projeto não possui bucket: uploads são recusados com `501 STORAGE_NOT_CONFIGURED`, e o resumo do deploy avisa isso, em vez de gravar em um disco que cada deploy substitui.

Configure um dos dois tipos e faça o deploy novamente para que o app o reconheça:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` lista os buckets do projeto; cada `bucket("media")` declarado recebe o seu próprio ([Múltiplos Bancos de Dados e Buckets](/docs/backend/multiple-sources/#on-rebase-cloud)). Com buckets próprios, anexe cada um com `--source <key>`; um que configure o armazenamento no código não precisa de nenhum dos dois.

## Pré-visualizar uma alteração

```bash
rebase cloud deploy --preview
```

Isso compila e faz o upload exatamente do mesmo que `deploy` faria, mas serve em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que servia antes. O deploy imprime o endereço da preview quando o build termina.

Para manter o mesmo endereço entre deploys, dê um nome à preview. Fazer o deploy com o mesmo nome novamente a atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que uma preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** pré-visualiza o backend, com seus apps estáticos integrados, da mesma forma que a produção os executa. Ele recebe um backend próprio em um **banco de dados próprio e vazio**, nunca o de produção. Inicializar conectado ao banco de dados de produção aplicaria o schema e as regras de acesso da preview a ele.
- **`rebase cloud deploy web --preview`** pré-visualizaria um app estático isoladamente, com suas páginas chamando o backend de **produção**. Isso exige um control plane que sirva sites estáticos por conta própria, o que o Rebase Cloud ainda não faz: ele recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça a preview do backend, que serve os apps estáticos integrados a ele; um projeto sem backend gerenciado ainda não pode ser pré-visualizado.

Uma preview não faz upload de código-fonte e não registra apps ou hostnames, pois cada um deles alteraria o projeto de produção. `--source` e `--eject` não podem ser combinados com `--preview`. Cada um deles cria uma imagem de container para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` sempre se refere à produção.

A página **Deployments** do console lista as mesmas previews e abre, exibe o log de build ou exclui cada uma delas. A criação continua sendo uma etapa via CLI.

Uma preview expira uma semana após o último deploy realizado nela.

Quando termina, o deploy verifica se o endereço da preview responde, assim como faz um deploy de produção (`--live-timeout <seconds>`, `0` para ignorar). O certificado de uma nova preview pode levar um ou dois minutos, portanto um deploy bem-sucedido pode indicar que o endereço ainda não responde.

Uma preview de backend é faturada como uma unidade de app no tamanho padrão (100m de CPU e 384 MiB de memória, na taxa do seu app para sua região e capacidade), proporcional ao tempo em que existir, e aparece na cotação mensal do projeto no console. `rebase cloud deploy --preview` imprime a mesma cotação para ela, por mês (`cost` sob `--json`). Iniciar uma preview exige um cartão cadastrado, assim como um deploy de produção. Um primeiro deploy que falha antes de qualquer coisa executar é removido em vez de faturado. Um projeto pode executar três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio da Let's Encrypt, que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de produção nele. As previews podem consumir 20 deles em qualquer período de 7 dias, em toda a plataforma. Além disso, uma nova preview é recusada (`429`, `preview_cert_budget`) informando quando poderá ser implantada; reimplantar uma preview que já existe nunca consome essa cota.

O banco de dados de uma preview de backend é um segundo banco de dados no Postgres de **produção**: seus próprios dados, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, para que as previews não esgotem as conexões de produção, e a 2 GB: uma preview cujo banco de dados ultrapasse isso é pausada. Seu backend para, seu endereço para de responder, `rebase cloud previews` e o console a mostram como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até que ela expire. Faça o deploy novamente para iniciá-la (ela será pausada novamente se o banco ainda estiver grande demais), ou exclua-a. Uma preview pausada continua sendo faturada até ser excluída ou expirar. Exclua previews que não sejam mais necessárias. As extensões instaladas na produção não são instaladas no banco de dados de uma preview.

As previews estão sendo disponibilizadas gradualmente. Um control plane que ainda não as suporte recusa `--preview` com `previews_unavailable` e não implanta nada.

## Reverter (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que um deploy anterior bem-sucedido entregou, e nunca reconstrói — o valor de um rollback é entregar um artefato que já foi executado anteriormente.

Quais deploys se qualificam depende de como o projeto é implantado, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem publicada por esse build |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle entregue por esse deploy, na versão de runtime que o projeto está executando agora |

Apps estáticos integrados ao bundle do backend (um simples `rebase cloud deploy` em um projeto com backend) fazem parte desse bundle, portanto sofrem rollback junto com ele.

Um app estático implantado sozinho (`rebase cloud deploy <app>`) ainda não pode sofrer rollback. Seu deploy registra qual app foi publicado, mas nenhum bundle, portanto o control plane não tem de onde restaurá-lo. A solução é implantar a última versão em bom estado novamente, por exemplo a partir do commit anterior ao problemático. Após esse tipo de deploy, `deploy` avisa isso em vez de indicar o `rollback`, e `rollback` sem um id recusa a operação em vez de reimplantar o backend em execução.

Portanto, um rollback necessita de um deploy que tenha registrado um dos dois, o que significa um projeto que tenha sido implantado com sucesso pelo menos duas vezes. `rebase cloud deployments` marca os que se qualificam, e `--json` reporta `rollbackable` por linha juntamente com a `image` ou `bundle` que restauraria.

Dois tipos de deploy são recusados, e a CLI informa qual: um que não foi bem-sucedido e um anterior ao momento em que a plataforma passou a registrar seu artefato. Não há adivinhação em nenhum dos casos — adivinhar entregaria o que foi compilado ou enviado mais recentemente, enquanto alegaria estar restaurando este —, portanto implante a versão desejada em vez disso.

Todo deploy bem-sucedido termina indicando o caminho de volta (`rebase cloud rollback`), para que fique visível no momento em que um release ruim for percebido.

Um rollback anexa uma nova implantação em vez de retroceder o histórico, e aguarda a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, em **Database → Backups** no console ou via CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo leva duas etapas. Primeiro, uma cópia recuperada é preparada ao lado do banco de dados ativo; seu app continua rodando no banco ativo, e o armazenamento da cópia é faturado até que você realize o cutover ou a descarte.
Em seguida, assim que a cópia estiver pronta, realizar o cutover reaponta o app para ela e o reinicia. Qualquer coisa gravada após o horário-alvo não estará na cópia. O banco de dados original é mantido como caminho de volta e continua faturando o armazenamento; retornar a ele, removê-lo ou fazer uma segunda restauração requer contato com o suporte. Apenas um proprietário ou administrador pode preparar, fazer cutover ou descartar, e o console solicita o nome do projeto antes de realizar o cutover.

## Proteja sua conta

Sua conta do console pode acessar bancos de dados de produção, segredos e faturamento, portanto proteja-a adequadamente. Abra **Account security** no menu sob seu avatar no console (ou acesse `/account`). A página é sua, não de uma organização: o que você definir lá se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um link que abre o app com a chave preenchida no celular, e solicita o código de 6 dígitos exibido no app. A partir de então, todo login solicitará um código, quer você entre com senha, Google ou GitHub.
- **Códigos de recuperação.** Ativar a verificação fornece dez códigos de uso único, exibidos uma única vez. Cada um permite fazer login no lugar do código do autenticador caso você perca seu telefone, portanto salve-os antes de fechar a caixa de diálogo. **New recovery codes** os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas e gerar novos códigos exigem um código prévio.
- **Senha.** Alterá-la desconecta você em todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não tem senha; a página oferece o envio de um link por e-mail para definir uma.
- **Dispositivos conectados.** Cada navegador e terminal conectado à sua conta, com seu endereço e quando fez login. Desconecte qualquer dispositivo que você não reconhecer, ou todos de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo fator, permitindo que a CI continue fazendo deploys após a ativação. Revogue um token no qual você não confia mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Add member** adiciona alguém que já possui uma conta Rebase com endereço de e-mail verificado, como admin ou member; um proprietário pode torná-lo um proprietário posteriormente. O acesso é concedido imediatamente e nada é enviado por e-mail. O Rebase Cloud ainda não envia convites, portanto peça a um colega de equipe que não tenha conta para se cadastrar e verificar seu endereço primeiro. Pelo terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que informa caso o endereço não possua uma conta.

## Acesso ao Cloud e os usuários do seu app

Dois grupos separados de pessoas estão envolvidos, como no Firebase e no Supabase:

- **Acesso ao Cloud** define quem pode trabalhar no projeto no Rebase Cloud. Os proprietários e administradores de uma organização são `admin` em todos os projetos pertencentes a ela, e seus membros são `developer`. Um projeto também pode conceder a uma pessoa uma função própria, `admin`, `developer` ou `viewer`, por meio de um convite por e-mail, sem torná-la membro da organização. A função de maior privilégio prevalece. [`rebase cloud access`](/docs/cli/cloud/#project-access) faz o gerenciamento disso.
- **Os usuários do seu app** residem no próprio banco de dados do app, com seu próprio fluxo de cadastro e suas funções. O Cloud nunca os lista ou edita.

A única ponte é o **Open admin panel**. Ele faz o login de uma pessoa com acesso `admin` ao Cloud no painel de administração do app, fazendo a correspondência pelo e-mail verificado: o app localiza ou cria a conta com esse endereço, atribui a ela a função `admin` e registra que a função veio do Rebase Cloud (o campo `roles` da tabela de usuários no painel de administração indica isso). Quando essa pessoa perde o acesso `admin` ao Cloud no projeto, o Rebase Cloud solicita ao app que revogue esse privilégio de `admin` e encerra suas sessões no app. Uma função concedida manualmente no app, incluindo um `admin` concedido antes do primeiro "Open admin panel", permanece inalterada, e a conta nunca é excluída.

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` mostram aos proprietários e administradores da organização quem implantou, definiu ou revelou uma variável de ambiente (por nome, nunca por valor), alterou um domínio, restaurou um backup, redimensionou, interrompeu ou excluiu um projeto, alterou a função de um membro ou criou um token, e quando isso ocorreu. As **Settings** de um projeto fornecem links para suas próprias entradas; uma entrada sobre um projeto excluído permanece. Um script pode fazer essa leitura com um token criado com `--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token restrito a algumas ações em um único projeto, criado a partir de um terminal autenticado com `rebase cloud tokens create --project shop --can deploy,logs`, e defina-o como `REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação de uma organização são permissões próprias (`--can billing`, `audit`, `notifications`) que um token detém somente quando solicitadas explicitamente. As permissões, um fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão em [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem uma conta

`rebase cloud init --claim` fornece a um app um backend ativo antes de qualquer pessoa ter se cadastrado e imprime uma URL de reivindicação para que a pessoa possa mantê-lo; um projeto que ninguém reivindicar dentro de 72 horas é excluído. O que o token do projeto não reivindicado pode fazer, o `REBASE_API_TOKEN` que ele grava e o que a reivindicação altera estão em [Um backend sem uma conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação e quanto custa

O preço de um projeto é calculado a partir do que ele reserva, e não a partir de um plano. O comando `compute` exibe cada parâmetro e a cotação detalhada do próprio control plane para eles. (`rebase cloud resources` é algo diferente: os bancos de dados e buckets que o código declara, e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Request do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma, que depende da região (abaixo) |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto fatura mensalmente |
| `--autoscale-max` | 1–16. O teto que pode atingir. Instâncias que o autoscaler adiciona acima de `--replicas` são medidas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma ativou essa cobrança; **Usage this month** indica isso. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação ao request e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor: um parâmetro vazio segue o padrão da plataforma e se ajusta quando este mudar.

Na Bélgica (europe-west1), o padrão reserva 100m de CPU e 384Mi, podendo fazer burst para 2 CPU e 2 GiB; em Falkenstein e Helsinki, a memória pode se estender até 1,4× o request e a CPU até 10× (no máximo 1,7 vCPU). `rebase cloud compute` mostra os números do seu projeto.

Nada é validado pela CLI, propositalmente — os limites pertencem ao cluster em que o projeto é executado e variam entre provedores. O control plane recusa um valor que não pode atender e indica o campo. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; uma alteração se aplica imediatamente, calculada de forma proporcional a partir de hoje. Uma alteração no banco de dados é aplicada agora, sendo faturada no tamanho atual até estar em execução. Uma nova configuração de CPU ou memória de banco de dados, ou menos instâncias, reinicia o banco de dados (cerca de 30 segundos a 3 minutos; conexões são encerradas e reconectadas): `compute set` avisa isso e pede confirmação, e fora de um terminal `--yes` serve como consentimento. Se essa reinicialização falhar, `rebase cloud compute apply` tenta novamente.

## O restante dos comandos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` imprime o bearer token que a CLI enviaria agora, para scripts e para o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude possa alcançá-lo ao lado de seus projetos Cloud. `--list` os exibe, `--remove` remove um deles. Proprietários e administradores |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` imprime esse link novamente. Consulte [Um backend sem uma conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicar e monitorar |
| `deploy-hooks` | URLs secretas que um host git ou CI chama para fazer o deploy do projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Builds servidos em seu próprio endereço através de `deploy --preview`, e sua exclusão. Consulte [Pré-visualizar uma alteração](#pré-visualizar-uma-alteração) |
| `sleep` | Suspender quando ocioso: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` e `status` (o padrão). Suspenso, o projeto não consome CPU ou memória e a próxima requisição o desperta; tarefas agendadas e trabalhos em segundo plano não rodam nesse período. Onde um projeto não puder suspender, o control plane recusa e informa o motivo |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura e paga apenas pelo seu disco, ou o valor mínimo mensal quando o disco custar menos; a linha **Billing** do console informa o que ele paga |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que não está |
| `alerts` | Incidentes em aberto do projeto, além de confirmar ou adiar um deles. |
| `cron` | Os cron jobs do app implantado e suas execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente escrita |
| `app-key` | A chave gravada por `init --claim` no `.env` como `REBASE_API_TOKEN`, transferida no momento da reivindicação; `rotate` a substitui e revoga a anterior. Proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` fornece uma nova ao app. Proprietários e administradores |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em múltiplos domínios, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual atuar, que pode ser omitido apenas quando houver somente um (para `verify`, um que ainda esteja pendente). Cada domínio verificado serve o projeto por si próprio; `primary <domain>` define o canônico e `redirect <domain>` responde outro com um redirecionamento 308 para ele, mantendo caminho e query (`--off` volta a servi-lo) — faça isso para `www.` junto a um apex, já que login do Google, cookies e passkeys são por origem. Um domínio no qual um app é servido (um `path` de app com hostname) nunca redireciona. Um domínio apex (`example.com`, sem subdomínio) requer um registro **A**, pois o DNS não permite CNAME no apex. Esse endereço é o ingress da plataforma e não há garantia de que permaneça o mesmo: se a plataforma mudar de local, o registro A continuará apontando para o endereço antigo. Onde o seu provedor de DNS oferecer ALIAS, ANAME ou nivelamento de CNAME no apex, aponte o apex para o `tenantHost` do projeto, que acompanha a plataforma. O CNAME de um subdomínio já a acompanha automaticamente. `list` informa `verified, certificate pending` até que o HTTPS responda com um certificado real. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e recuperação point-in-time |
| `guests` | Os usuários convidados que o login anônimo deixou para trás: contá-los, excluir um, limpar os que não são vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Proprietários e administradores |
| `extensions` | A allowlist de extensões do Postgres |
| `storage` | Os buckets do projeto e suas chaves, no [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em comparação com o que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterá-lo |
| `events` | O que aconteceu com o backend, do mais recente para o mais antigo: escalonamento do app, alterações no banco agendadas e aplicadas, um standby assumindo o controle, crescimento do disco |
| `usage` | Requisições consumidas neste mês em relação à cota incluída, e o excedente até agora, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters em que os tenants são executados. Apenas para administradores da plataforma |
| `settings`, `orgs`, `access`, `billing` | Configurações do projeto, organizações e seus membros e convites, quem tem acesso a um projeto, pagamento |
| `activity` | O log de auditoria da organização: quem implantou, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e administradores. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso, suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o índice para as páginas, de forma que um grupo adicionado sem uma página falha o build em vez de responder com o índice. O comando `verify:docs` vincula a própria tabela a esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha na tabela também falha o build.

Quando usado com pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos como uma estrutura legível em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Sem escolha de região, sem cadastro por autosserviço, sem SLA publicado, sem branch deploys, sem tokens que atuam como uma pessoa física e sem endpoint público de banco de dados. [O que o beta não inclui](/docs/deployment/cloud-beta-limits/) especifica cada um detalhadamente, juntamente com o que significa fazer deploy com os segredos de produção.

## Auto-hospedagem como alternativa

Nada aqui gera dependência de fornecedor. O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a mesma imagem e bundle com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.
