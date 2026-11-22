---
sourceHash: a6cdd8811eca0897
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e abre em lotes. [Solicite acesso](https://rebase.pro/pricing).

Ele não é self-service, portanto os comandos abaixo exigem uma conta com acesso liberado. Tudo o mais neste site funciona sem ela.
:::

## O que é

Um **projeto** Cloud consiste em três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, executando na imagem de runtime publicada. Deploys são o upload de um bundle, não a compilação de um contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e point-in-time recovery |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

O app e o banco de dados são provisionados no primeiro deploy; um bucket somente quando você solicitar um ([Armazenamento de arquivos](#armazenamento-de-arquivos)). Cada um é faturado pelo que reserva, em vez de por usuário.

**Nada em seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a válvula de escape é real: o `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Conectar um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre o console no seu navegador e exibe um código curto. Verifique se o console mostra o mesmo código e aprove o login lá: o terminal assume a sessão e a grava em `~/.rebase/credentials.json`. Se você não estiver conectado ao console, faça login lá primeiro com o que você preferir, Google e GitHub incluídos. Via SSH, `rebase cloud login --no-browser` imprime o link para abrir em sua própria máquina.

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal eles serão solicitados interativamente, e uma execução headless que omitir qualquer um deles é encerrada com `input_required` em vez de inventar um valor. **O subdomínio não é editável posteriormente:** é o host `<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, sem a necessidade de uma etapa `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que registra o id e o slug do projeto. Esse arquivo não é secreto e não contém suas credenciais — estas ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é comitado junto com o código, de forma que um repositório clonado pode apontar para qualquer control plane. Quando o host vem apenas desse arquivo e não é o da própria plataforma nem um no qual você já tenha feito login anteriormente, o `login` informa seu nome e pergunta antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login intencionalmente.

Para fazer login sem o navegador, passe seu e-mail: `rebase cloud login --email me@example.com` solicitará sua senha. **Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não tem senha, então use um código:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia por e-mail um código de 6 dígitos, válido por dez minutos, que você digita no prompt. Com `--email` e sem senha, o `rebase cloud login` pergunta se você deseja usar sua senha ou um código. Os códigos exigem que o control plane seja capaz de enviar e-mails; se não puder, o `--code` avisa e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente de como você entrou. Pelo navegador, o console solicita isso quando você faz login nele. Nem o código de login nem o segundo fator podem ser digitados sem um terminal. Para scripts, crie um access token no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials`, indicando os dois caminhos possíveis, já que a causa comum é uma conta que nunca teve senha configurada.

`billing setup` associa um cartão à organização, uma única vez. Ele está em primeiro lugar na sequência de propósito: o primeiro deploy de um projeto é recusado sem ele, e descobrir isso após o término do upload do bundle seria a pior experiência.

Depois disso, a página **Billing** do console lista as faturas da organização, cada uma com a página hospedada pelo Stripe e PDF, e exibe uma prévia da próxima fatura de cada projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` imprimem o mesmo. Ambos são destinados aos proprietários e administradores da organização. Onde a plataforma disponibilizar, **Manage billing** abre o portal do cliente do Stripe para gerenciar o cartão, os dados de faturamento e faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não exige um segundo pagamento: o projeto é faturado nesse cartão e faz o deploy. Se o cartão for recusado ou o banco exigir confirmação do pagamento, o console levará você para **Billing**, onde **Fix your card** salva outro cartão e **Complete the payment** abre a fatura do Stripe.

O que um projeto utilizou é exibido em sua visão geral, em **Usage this month**, e para todos os projetos de uma só vez na página **Billing**: requisições em relação à cota incluída (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento e qual será a projeção para o mês nesse ritmo. O excedente é calculado pelo mesmo código que o reporta ao Stripe, sendo exatamente o valor cobrado na fatura; ele aparece na fatura do mês seguinte. `rebase cloud usage` exibe o mesmo, e `rebase cloud usage org` exibe para toda a organização. Qualquer membro pode visualizar. Os números indicam o que ainda não conseguem mensurar: o object storage não é medido, portanto nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de app, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um projeto com autoscaling também exibe os pods executados acima de `--replicas`, em pod-horas, quanto custaram em suas próprias tarifas e se esta plataforma já os está cobrando. Um projeto reivindicado de um agente conta apenas os dias a partir da reivindicação: antes disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um único comando, sem nenhuma flag para memorizar. O `rebase.json` de um scaffold declara `runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — avisando no processo (`rebase.json declares runtime: managed — deploying a bundle`), compila o app em `dist-bundle`, faz o upload do bundle, o executa na imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona de forma autônoma em CI.

Ele termina informando onde cada app agora responde e se a nova versão está ativa lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após a compilação: o `/health` de um backend retornou `ok`, e a página de um app estático foi carregada (a partir desta implantação, quando a plataforma o serve). A verificação aguarda até `--live-timeout` segundos, 60 por padrão; `0` a ignora. Se um app não responder a tempo, o deploy ainda sairá com código zero, porque a implantação foi bem-sucedida, e a última linha indicará qual app não respondeu e o motivo. Já um deploy com falha termina em uma única linha, indicando o app e o motivo, com `rebase cloud logs` para o log completo de compilação.

Scripts passam `--json` para receber um único objeto contendo as mesmas informações — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id da implantação. Ao contrário do restante do `rebase cloud`, o `deploy` não alterna automaticamente para JSON quando redirecionado em um pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de body, sistema de arquivos, secrets, storage e rede de saída — está em sua própria página: [Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — por exemplo, em um job de CI que compila uma vez e faz deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais solicita isso: uma compilação que migraria um projeto gerenciado para uma imagem de contêiner que ele passaria a gerenciar é recusada até que você confirme explicitamente. `--force` costumava significar isso, o que colocava a ação menos reversível que a CLI pode executar sob a mesma palavra de "sobrescrever este arquivo"; agora ela é uma opção desconhecida em vez de um alias, portanto um script que a utilize será interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando seu `build` apenas copia scripts escritos à mão para `output`, nada os analisa previamente, e um arquivo com um erro de digitação pode ir para produção e impedir o carregamento da página. Portanto, antes que qualquer coisa seja enviada, o `deploy` faz o parse de cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso cobre tanto um app estático implantado isoladamente quanto apps estáticos integrados ao bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` que não seja JavaScript, tags `<script src>` e scripts que ainda contenham marcações de template não renderizadas como `{{ }}`. Um arquivo `.js` é aprovado se fizer o parse tanto como um script clássico quanto como um módulo, pois a página é quem decide. Nada dentro de `node_modules` é lido, e nem um `--bundle-dir` pré-compilado. `--no-verify` ignora a verificação para uma implantação específica.

Acompanhe:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` relata `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está genuinamente trabalhando e o polling é a ação correta; quando ele indica algo, significa que esse algo está aguardando você.

Um deles é `email_not_configured`: o app ativou o login por magic link ou código por e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) e não possui serviço de e-mail, de forma que o deploy está ativo, mas ninguém consegue fazer login. O Rebase Cloud não envia e-mails para o seu app: configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` com `rebase cloud env set` e, em seguida, faça o deploy. O `status` lê isso do próprio `GET /api/auth/config` do app (em seu campo `unavailable`), e o `deploy` informa o mesmo em sua verificação de disponibilidade.

## Armazenamento de arquivos

Um novo projeto não tem nenhum bucket: os uploads são recusados com `501 STORAGE_NOT_CONFIGURED`, e o resumo do deploy avisa isso, em vez de gravar em um disco que cada deploy substitui.

Adicione um dos dois tipos e, em seguida, faça o deploy novamente para que o app o reconheça:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` lista os buckets do projeto. Um projeto com vários buckets anexa cada um com `--source <key>`; um que configure o armazenamento via código não precisa de nenhum deles.

## Pré-visualizar uma alteração

```bash
rebase cloud deploy --preview
```

Isso compila e faz o upload exatamente como o `deploy` faria, mas disponibiliza o app em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que servia antes. O deploy exibe o endereço do preview quando a compilação termina.

Para manter um único endereço entre deploys, dê um nome ao preview. Fazer o deploy com o mesmo nome novamente irá atualizá-lo:

```bash
rebase cloud deploy --preview-name new-checkout
```

A quem um preview se conecta depende do que você implantou:

- **`rebase cloud deploy --preview`** pré-visualiza o backend, com seus apps estáticos integrados, da mesma forma que a produção os executa. Ele obtém um backend próprio em um **banco de dados vazio próprio**, nunca o de produção. Inicializar contra o banco de dados de produção aplicaria o esquema e as regras de acesso do preview a ele.
- **`rebase cloud deploy web --preview`** pré-visualizaria um app estático isoladamente, com suas páginas chamando o backend de **produção**. Isso exige um control plane que sirva sites estáticos de forma independente, o que o Rebase Cloud ainda não faz: ele recusa a operação com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, pré-visualize o backend, que serve os apps estáticos integrados a ele; um projeto sem backend gerenciado ainda não pode ser pré-visualizado.

Um preview não faz upload de código-fonte e não registra apps ou hostnames, pois cada um deles alteraria o projeto de produção. `--source` e `--eject` não podem ser combinados com `--preview`. Cada um compila uma imagem de contêiner para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` é sempre o de produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o log de compilação ou excluir cada um deles. Criar um continua sendo uma etapa via CLI.

Um preview expira uma semana após a data do seu último deploy.

Quando termina, o deploy verifica se o endereço do preview responde, assim como faz um deploy de produção (`--live-timeout <seconds>`, `0` para ignorar). O certificado de um novo preview pode levar um ou dois minutos, de modo que um deploy bem-sucedido pode relatar que o endereço ainda não responde.

Um preview de backend é faturado como uma unidade de app no tamanho padrão (100m de CPU e 384 MiB de memória, na taxa do seu app para a região e capacidade correspondentes), proporcional ao tempo em que existir, e aparece na estimativa mensal do projeto no console. `rebase cloud deploy --preview` imprime a mesma estimativa para ele, por mês (`cost` sob `--json`). Iniciar um preview exige um cartão cadastrado, assim como um deploy de produção. Um primeiro deploy que falhar antes que qualquer coisa seja executada é removido em vez de faturado. Um projeto pode executar até três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio do Let's Encrypt, que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de produção nele contidos. Os previews podem consumir até 20 deles a cada 7 dias em toda a plataforma. Acima disso, um novo preview é recusado (`429`, `preview_cert_budget`), informando o momento em que poderá ser implantado; reimplantar um preview existente nunca consome essa cota.

O banco de dados de um preview de backend é um segundo banco de dados no Postgres de **produção**: seus próprios dados, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, para que os previews não esgotem as conexões de produção, e a 2 GB: um preview cujo banco de dados ultrapassar esse limite é pausado. Seu backend é interrompido, seu endereço para de responder, o `rebase cloud previews` e o console o mostram como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até que expire. Faça o deploy novamente para iniciá-lo (ele será pausado novamente enquanto o banco de dados continuar grande demais) ou exclua-o. Um preview pausado ainda é faturado até ser excluído ou expirar. Exclua previews que você não precisa mais. Extensões instaladas na produção não são instaladas no banco de dados de um preview.

Os previews estão sendo lançados gradualmente. Um control plane que ainda não os suporte recusará `--preview` com `previews_unavailable` e não implantará nada.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback redireciona o projeto para o que uma implantação anterior bem-sucedida entregou, e nunca recompila — o valor de um rollback é entregar um artefato que já foi executado.

Quais implantações se qualificam depende de como o projeto faz deploy, e ambos os tipos funcionam:

| Como foi implantado | O que é restaurado |
|---|---|
| `rebase cloud deploy` (uma compilação a partir do código-fonte) | A imagem que essa compilação publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que essa implantação enviou, na versão de runtime que o projeto está executando agora |

Apps estáticos integrados ao bundle do backend (um simples `rebase cloud deploy` em um projeto com backend) fazem parte desse bundle, portanto sofrem rollback junto com ele.

Um app estático implantado isoladamente (`rebase cloud deploy <app>`) ainda não pode sofrer rollback. Sua implantação registra qual app foi publicado, mas nenhum bundle, de modo que o control plane não tem de onde restaurá-lo. A solução é implantar a última versão válida novamente, por exemplo a partir do commit anterior ao problemático. Após esse deploy, o comando `deploy` avisa isso em vez de sugerir o `rollback`, e o `rollback` sem um id recusa a operação em vez de reimplantar o backend em execução.

Portanto, um rollback necessita de uma implantação que tenha registrado um dos dois, o que significa um projeto que tenha sido implantado com sucesso pelo menos duas vezes. O `rebase cloud deployments` marca as que se qualificam, e `--json` reporta `rollbackable` por linha junto com a `image` ou `bundle` que restauraria.

Dois tipos de implantação são recusados, e a CLI informa qual: uma que não teve sucesso e outra anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há o que adivinhar em nenhum dos casos — adivinhar enviaria o que foi compilado ou enviado mais recentemente alegando estar restaurando esta —, portanto implante a versão desejada em vez disso.

Cada deploy bem-sucedido termina informando o caminho de volta (`rebase cloud rollback`), ficando visível no exato momento em que uma versão com problemas for detectada.

Um rollback adiciona uma nova implantação em vez de retroceder o histórico, e aguarda a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, em **Database → Backups** no console ou via CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo ocorre em duas etapas. Primeiro, uma cópia recuperada é preparada ao lado do banco de dados ativo; seu app continua rodando no banco ativo, e o armazenamento da cópia é faturado até que você faça o cutover ou a descarte.
Depois, quando a cópia estiver pronta, o cutover redireciona o app para ela e o reinicia. Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados original é mantido como caminho de retorno e continua faturando armazenamento; voltar atrás, removê-lo ou fazer uma segunda restauração exige contato com o suporte. Apenas um proprietário ou administrador pode preparar, fazer o cutover ou descartar, e o console solicita o nome do projeto antes de realizar o cutover.

## Proteja sua conta

Sua conta do console pode acessar bancos de dados de produção, secrets e faturamento, portanto proteja-a adequadamente. Abra **Account security** no menu sob seu avatar no console (ou acesse `/account`). A página é sua, não de uma organização: o que você configurar ali se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um link que abre o app com a chave já preenchida no celular, e em seguida solicita o código de 6 dígitos exibido no app. A partir de então, todo login solicitará um código, quer você faça login com senha, Google ou GitHub.
- **Códigos de recuperação.** Ativá-la gera dez códigos de uso único, exibidos apenas uma vez. Cada um permite fazer login no lugar do código do autenticador caso perca seu telefone, portanto salve-os antes de fechar o diálogo. **New recovery codes** os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas e obter novos códigos exigem a digitação de um código prévio.
- **Senha.** Alterá-la desconecta você de todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não possui senha; a página oferece o envio de um link por e-mail para definir uma.
- **Dispositivos conectados.** Cada navegador e terminal conectado à sua conta, com seu endereço e o momento em que fez login. Desconecte qualquer dispositivo que não reconhecer, ou todos de uma vez.

[Access tokens](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não solicitam um segundo fator, de modo que o CI continua implantando após a ativação. Revogue tokens em que você não confia mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Add member** adiciona alguém que já tenha uma conta Rebase com endereço de e-mail verificado, como admin ou member; um owner pode torná-lo owner depois. O acesso é imediato e nada é enviado por e-mail. O Rebase Cloud ainda não envia convites, portanto peça a um colega de equipe que não possua conta para se cadastrar e verificar seu endereço primeiro. A partir de um terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que avisa caso o endereço não possua uma conta.

## Acesso ao Cloud e os usuários do seu app

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Dois grupos distintos de pessoas estão envolvidos, como no Firebase e no Supabase:

- **Cloud access** diz respeito a quem pode trabalhar no projeto no Rebase Cloud. Os owners e admins de uma organização são `admin` em todos os projetos que ela possui, e seus membros são `developer`. Um projeto também pode conceder a uma pessoa uma role própria, `admin`, `developer` ou `viewer`, por meio de um convite por e-mail, sem torná-la membro da organização. A permissão mais alta entre as duas prevalece.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) gerencia isso.
- **Os usuários do seu app** residem no próprio banco de dados do aplicativo, com seu fluxo de cadastro e suas próprias roles. O Cloud nunca os lista nem os edita.

A única ponte é o botão **Open admin panel**. Ele conecta uma pessoa com acesso `admin` no Cloud ao painel de administração do app, fazendo a correspondência pelo seu e-mail verificado: o app localiza ou cria a conta com esse endereço, atribui a ela a role `admin` e registra que a role teve origem no Rebase Cloud (marcado em Utilizadores e funções do Studio). Quando essa pessoa perde o acesso `admin` no Cloud ao projeto, o Rebase Cloud solicita ao app que revogue esse `admin` e encerra suas sessões no app. Uma role concedida manualmente no app, inclusive um `admin` concedido antes do primeiro uso do Open admin panel, permanece, e a conta nunca é excluída.

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` mostram aos owners e admins da organização quem implantou, definiu ou visualizou uma variável de ambiente (pelo nome, nunca pelo valor), alterou um domínio, restaurou um backup, redimensionou, interrompeu ou excluiu um projeto, alterou a role de um membro ou criou um token, e quando. A seção **Settings** de um projeto inclui links para suas próprias entradas; registros sobre projetos excluídos são mantidos. Um script pode lê-los com um token criado com `--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão documentados em
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve conter sua senha. Forneça a ele um token com escopo restrito a algumas ações em um único projeto, criado a partir de um terminal autenticado com
`rebase cloud tokens create --project shop --can deploy,logs`, e configure-o como
`REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação de uma organização são permissões específicas (`--can billing`, `audit`, `notifications`) que um token só possui quando solicitado explicitamente. As permissões, um fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão descritos em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` fornece a um app um backend ativo antes mesmo de qualquer pessoa se cadastrar e imprime uma URL de reivindicação para que a pessoa possa mantê-lo; um projeto que ninguém reivindicar dentro de 72 horas é excluído. O que o token do projeto não reivindicado pode fazer, o
`REBASE_API_TOKEN` que ele grava e o que a reivindicação altera estão descritos em
[Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Recursos de computação e quanto custam

O preço de um projeto é calculado a partir do que ele reserva, e não a partir de um plano fixo. `compute` exibe cada parâmetro e a cotação detalhada do próprio control plane para eles. (`rebase cloud resources` é algo diferente: são os bancos de dados e buckets declarados pelo código, e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma, que depende da região (abaixo) |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto fatura mensalmente |
| `--autoscale-max` | 1–16. O teto que pode alcançar. As instâncias adicionadas pelo autoscaler acima de `--replicas` são medidas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma tiver ativado essa opção; **Usage this month** indica isso. `--no-autoscale` o desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação ao request em vez do limit. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor numérico: um parâmetro vazio segue o padrão da plataforma e muda quando este mudar.

Na Bélgica (europe-west1), o padrão reserva 100m de CPU e 384Mi e pode atingir picos de até 2 CPU e 2 GiB; em Falkenstein e Helsinque, a memória pode se estender até 1,4× o request e a CPU até 10× (no máximo 1,7 vCPU). O comando `rebase cloud compute` mostra os números do seu projeto.

Nada é validado pela CLI, de propósito — os limites pertencem ao cluster no qual o projeto é executado e variam entre os provedores. O control plane recusa um valor que não pode atender e indica o campo correspondente. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; qualquer alteração se aplica imediatamente, proporcional a partir de hoje. Uma alteração no banco de dados se aplica agora; faturada no tamanho atual até que esteja em execução. Uma nova configuração de CPU ou memória do banco de dados, ou redução de instâncias, reinicia o banco de dados (cerca de 30 segundos a 3 minutos; as conexões são encerradas e reconectadas): `compute set` avisa sobre isso e pede confirmação, e fora de um terminal `--yes` serve como consentimento. Se essa reinicialização falhar, `rebase cloud compute apply` tenta novamente.

## O restante da superfície

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` imprime o token bearer que a CLI enviaria agora, para scripts e para o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um com escopo restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vinculação deste diretório a um projeto, seleção de uma organização, abertura do console |
| `connect` | Adição de um servidor Rebase self-hosted à sua conta, para que o [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude possa acessá-lo junto com seus projetos Cloud. `--list` os exibe, `--remove` remove um deles. Owners e admins |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` imprime esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Implantação e monitoramento |
| `deploy-hooks` | URLs secretas que um host git ou CI chama para implantar o projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Compilações servidas em um endereço próprio via `deploy --preview` e sua exclusão. Consulte [Pré-visualizar uma alteração](#pré-visualizar-uma-alteração) |
| `sleep` | Suspender quando inativo: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` e `status` (o padrão). Quando suspenso, um projeto não consome CPU ou memória e a próxima requisição o desperta; tarefas agendadas e trabalhos em segundo plano não são executados enquanto estiver suspenso. Onde um projeto não puder ser suspenso, o control plane recusa e informa o motivo |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto pausado mantém sua assinatura, a menos que a plataforma fature projetos parados apenas pelo armazenamento e pela taxa da plataforma; a linha **Billing** do console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que não está |
| `alerts` | Incidentes abertos do projeto, e confirmação ou adiamento de um incidente. |
| `cron` | Os cron jobs do app implantado e o histórico de execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca imprime valores; `--secret` é somente escrita |
| `app-key` | A chave gravada por `init --claim` no `.env` como `REBASE_API_TOKEN`, transferida na reivindicação; `rotate` a substitui e revoga a antiga. Owners e admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` fornece uma nova ao app. Owners e admins |
| `domains` | Domínios personalizados, os registros DNS a serem adicionados e a verificação. Um projeto pode responder em múltiplos domínios, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual atuar, que pode ser omitido apenas quando houver somente um (para `verify`, um ainda pendente). Cada domínio verificado serve o projeto de forma autônoma; `primary <domain>` escolhe o canônico e `redirect <domain>` responde em outro com um redirecionamento 308 para ele, preservando path e query (`--off` volta a servi-lo normalmente) — faça isso para `www.` junto a um apex, já que login do Google, cookies e passkeys são por origem. Um domínio no qual um app específico é servido (um `path` de app com hostname) nunca redireciona. Um domínio apex (`example.com`, sem subdomínio) exige um registro **A**, pois o DNS não permite CNAME no apex. Esse endereço é o ingress da plataforma e não há garantia de que permaneça o mesmo: se a plataforma mudar de infraestrutura, um registro A continuará apontando para o endereço antigo. Onde o seu provedor DNS oferecer ALIAS, ANAME ou CNAME flattening no apex, aponte o apex para o `tenantHost` do projeto, que acompanha a plataforma automaticamente. O CNAME de um subdomínio já o acompanha nativamente. `list` informa `verified, certificate pending` até que o HTTPS responda com um certificado real. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Usuários convidados que o login anônimo deixou para trás: contá-los, excluir um, remover aqueles não vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Owners e admins |
| `extensions` | A lista de permissões de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em comparação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu com o backend, do mais recente para o mais antigo: escalonamento do app, alterações de banco de dados agendadas e aplicadas, um standby assumindo, expansão do disco |
| `usage` | Requisições utilizadas este mês em relação à cota incluída e o excedente até o momento, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters nos quais os tenants são executados. Apenas para platform-admin |
| `settings`, `orgs`, `access`, `billing` | Configurações do projeto, organizações e seus membros e convites, quem tem acesso a um projeto, pagamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Owners e admins. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo nessa tabela responde ao `--help` com uma página própria — uma linha de uso, suas flags e exemplos —, e `--help` nunca executa o comando. Um teste mantém o índice para as páginas, de modo que um grupo adicionado sem uma página correspondente quebra o build em vez de responder com o índice geral. `verify:docs` vincula a própria tabela a esse índice: todo grupo que a CLI despacha aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha também quebra o build.

Quando redirecionado via pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos estruturados para leitura em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Sem escolha de região, sem cadastro self-service, sem SLA publicado, sem branch deploys, tokens que atuam em nome de uma pessoa e sem endpoint público de banco de dados. [O que o beta não inclui](/docs/deployment/cloud-beta-limits/) detalha cada um desses pontos claramente, explicando o que significa fazer deploy com os secrets de produção.

## Auto-hospedagem como alternativa

Nada aqui gera lock-in. O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a imagem e o bundle idênticos com `docker compose`, e o [guia do Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.
