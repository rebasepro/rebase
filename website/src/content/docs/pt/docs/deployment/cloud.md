---
sourceHash: 8292c377d5271c6f
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se vincula e é implantado, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você auto-hospedaria — a mesma
imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A
diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e abre em
lotes. [Solicite acesso](https://rebase.pro/pricing).

Não é self-service, portanto os comandos abaixo exigem uma conta com acesso liberado.
Todo o restante deste site funciona sem ela.
:::

## O que é

Um **projeto** Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são um upload de bundle, não um build de contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação point-in-time |
| **Storage** | Um bucket próprio no [Rebase Storage](/docs/deployment/rebase-storage/), se o seu projeto usar armazenamento de arquivos |

O app e o banco de dados são provisionados quando você faz o deploy pela primeira vez; um bucket apenas
quando você solicita um ([Armazenamento de arquivos](#armazenamento-de-arquivos)). Cada um é cobrado pelo que
reserva, em vez de por usuário (seat).

**Nada no seu projeto muda para rodar lá.** O mesmo repositório
pode ser auto-hospedado com `docker compose`, e a rota de escape é real: `rebase build`
produz um bundle que inicializa em qualquer lugar onde a imagem de runtime execute.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O comando `login` abre o console no seu navegador e exibe um código curto. Verifique se
o console mostra o mesmo código e aprove o login lá: o terminal
assume a sessão e a grava em `~/.rebase/credentials.json`. Se você
não estiver autenticado no console, faça login lá primeiro usando o método de sua preferência,
inclusive Google e GitHub. Via SSH, `rebase cloud login --no-browser` exibe o link
para abrir em sua própria máquina.

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são
flags, e ambos são obrigatórios — em um terminal eles são solicitados, e uma
execução headless que omita qualquer um deles sai com `input_required` em vez de inventar
um. **O subdomínio não pode ser editado posteriormente:** é o
host `<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma
etapa `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que registra o id
e o slug do projeto. Esse arquivo não é um segredo e não são suas credenciais — estas
ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado com o código, portanto um repositório clonado pode nomear qualquer
control plane. Quando o host vem apenas desse arquivo, e não é o próprio da
plataforma nem um no qual você já tenha feito login anteriormente, o `login` o nomeia e pergunta
antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com
`--json`, ele recusa com `unknown_control_plane`; passe `--url <host>` (ou defina
`REBASE_CLOUD_URL`) para fazer login lá intencionalmente.

Para fazer login sem o navegador, passe seu e-mail: `rebase cloud login --email
me@example.com` solicitará sua senha. **Cadastrou-se com Google, GitHub ou
LinkedIn?** Sua conta não tem senha, portanto use um código:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia por e-mail um código de 6 dígitos, válido por dez minutos, e você
o digita no prompt. Com `--email` e nenhuma senha, `rebase cloud login` pergunta
se você deseja usar sua senha ou um código. Os códigos exigem que o control plane seja capaz de enviar
e-mails; se não puder, `--code` informa isso e sai com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do
seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente de como você fez
login. Pelo navegador, o console o solicitará quando você fizer login por lá. Nem um código de login nem um segundo fator podem ser digitados sem um terminal.
Para um script, crie um token de acesso no console (**Settings → Access
tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde `invalid_credentials` com os mesmos dois métodos de acesso, já
que a causa comum é uma conta que nunca teve uma senha.

`billing setup` vincula um cartão à organização, uma única vez. Ele está em primeiro lugar
na sequência de propósito: o primeiro deploy de um projeto é recusado sem um cartão, e
descobrir isso após o término do upload de um bundle é a pior ordem.

Depois disso, a página **Billing** do console lista as faturas da organização,
cada uma com a página hospedada e o PDF da Stripe, e exibe uma prévia da próxima fatura de cada
projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
exibem o mesmo. Ambos são destinados aos proprietários e administradores da organização. Onde a
plataforma disponibilizar, **Manage billing** abre o portal do cliente da Stripe para gerenciar o
cartão, os dados de faturamento e faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não exige
um segundo pagamento: o projeto é faturado nesse cartão e implantado. Se o cartão
for recusado ou o banco exigir a confirmação do pagamento, o console direciona você para
**Billing**, onde **Fix your card** salva outro cartão e **Complete the
payment** abre a fatura da Stripe.

O que um projeto utilizou é exibido em sua visão geral, em **Usage this month**, e
para todos os projetos de uma só vez na página **Billing**: requisições em relação à cota
incluída (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento
e qual a projeção para o mês nesse ritmo. O excedente é calculado pelo
mesmo código que o reporta à Stripe, portanto é o que constará na fatura; ele
aparece na fatura do mês seguinte. `rebase cloud usage` exibe o
mesmo, e `rebase cloud usage org` mostra para toda a organização. Qualquer membro pode
consultar. Os números mostram o que ainda não é possível ver: o armazenamento de objetos é medido, mas
ainda não faturado (o [Rebase Storage](/docs/deployment/rebase-storage/) informa seu
preço); enquanto um projeto executa dois ou mais pods de app,
suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um
projeto com autoscaling também exibe os pods executados acima de `--replicas`, em pod-horas,
quanto custam nas suas taxas e se esta plataforma já os cobra. Um
projeto resgatado de um agente conta apenas os dias a partir do resgate: antes
disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Fazer deploy

```bash
rebase cloud deploy
```

Um único comando, sem flags para memorizar. O `rebase.json` de um scaffold declara
`runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele
informa isso durante o processo (`rebase.json declares runtime: managed — deploying a
bundle`), compila o app em `dist-bundle`, faz o upload do bundle, o executa na
imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de
saída é o veredito, portanto a mesma linha funciona sem intervenção humana no CI.

Ele termina informando onde cada app agora responde e se a nova versão está
ativa (live) lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o `/health` de um backend
retornou `ok`, e a página de um app estático carregou (a partir desta implantação, quando a
plataforma a disponibiliza). A verificação aguarda até `--live-timeout` segundos, 60 por
padrão; `0` a ignora. Se um app não responder a tempo, o deploy ainda assim termina com código
zero, porque a implantação foi bem-sucedida, e a última linha informa qual app não
respondeu e o motivo. Um deploy com falha, por outro lado, termina em uma linha, indicando o app e o
motivo, com `rebase cloud logs` para o log completo do build.

Scripts podem passar `--json` para receber um único objeto com as mesmas informações — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e o id da implantação. Ao contrário do restante de
`rebase cloud`, o `deploy` não muda para JSON automaticamente quando usado em pipes.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias,
timeouts e tamanhos de corpo (body sizes), sistema de arquivos, secrets, armazenamento e rede de
saída — está em sua própria página:
[Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e
faz deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado requer sua própria flag, `--eject`, e nada mais solicitará
isso: um build que moveria um projeto gerenciado para uma imagem de contêiner que ele próprio passa a
possuir é recusado até que você determine. Antes, `--force` significava isso, o que colocava a ação
menos reversível que a CLI pode fazer sob a mesma palavra usada para "sobrescrever este
arquivo"; agora ela é uma opção desconhecida em vez de um alias, portanto um script que a utilize
é interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como são. Quando seu `build` apenas
copia scripts escritos à mão para `output`, nada os analisou sintaticamente (parse), e um arquivo
com um erro de digitação vai para o ar e impede o carregamento da página. Portanto, antes que qualquer
coisa seja enviada, o `deploy` analisa cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app
estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso
abrange tanto um app estático implantado sozinho quanto apps estáticos integrados ao
bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador
não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer
outro `type` que não seja JavaScript, um `<script src>`, e um script que ainda contenha
marcação de template não renderizada, como `{{ }}`. Um arquivo `.js` é aprovado se for validado como
um script clássico ou como um módulo, pois a página é quem decide qual deles é. Nada
sob `node_modules` é lido, e nem um `--bundle-dir` pré-compilado.
`--no-verify` ignora a verificação para um deploy.

Acompanhe:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` reporta `blockedOn` e `nextAction`. Quando `blockedOn` é `null`, a
plataforma está genuinamente trabalhando e fazer polling é a coisa certa a se fazer; quando indica
algo, esse algo está aguardando você.

Um desses casos é `email_not_configured`: o app ativou login por magic link ou
código por e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) e não possui serviço de e-mail, portanto
a implantação está ativa e ninguém consegue fazer login por meio dela. O Rebase Cloud não envia
e-mails para o seu app: defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e
`SMTP_FROM` com `rebase cloud env set`, e faça deploy em seguida. O `status` lê isso do
próprio `GET /api/auth/config` do app (seu campo `unavailable`), e o `deploy` informa
o mesmo sob sua verificação live.

## Mais de um banco de dados

Declare cada um no seu código (`database("analytics")`) e faça o deploy: ele é criado no servidor Postgres
do projeto como `DATABASE_URL__ANALYTICS`, compartilhando sua CPU, memória, disco, backups e fatura
([detalhes](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Armazenamento de arquivos

Um novo projeto não tem bucket: uploads são recusados com `501 STORAGE_NOT_CONFIGURED`,
e o resumo do deploy avisa isso, em vez de gravar em um disco que cada deploy substitui.

Forneça um de dois tipos e faça o deploy novamente para que o app o reconheça:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` lista os buckets do projeto; cada `bucket("media")` declarado recebe o seu ([Múltiplos Bancos de Dados e Buckets](/docs/backend/multiple-sources/#on-rebase-cloud)).
Com buckets próprios, conecte cada um com `--source <key>`; um que configura o armazenamento no código não precisa de nenhum dos dois.

## Visualizar alterações em preview

```bash
rebase cloud deploy --preview
```

Isso compila e envia exatamente o que o `deploy` enviaria, mas o disponibiliza em um endereço
próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua
servindo o que servia antes. O deploy exibe o endereço do preview quando o
build termina.

Para manter o mesmo endereço entre deploys, dê um nome ao preview. Fazer deploy com o mesmo nome
novamente o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** visualiza o backend, com seus apps estáticos
  integrados, da mesma forma que a produção os executa. Ele recebe um backend próprio em
  um **banco de dados vazio próprio**, nunca o de produção. Inicializar contra o
  banco de produção aplicaria o schema e as regras de acesso do preview a ele.
- **`rebase cloud deploy web --preview`** visualizaria um app estático isolado,
  com suas páginas chamando o backend de **produção**. Isso requer um control plane
  que sirva sites estáticos de forma independente, e o Rebase Cloud ainda não faz isso: ele
  recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça o preview do
  backend, que serve os apps estáticos integrados a ele; um projeto sem
  backend gerenciado ainda não pode ser visualizado em preview.

Um preview não faz upload de código-fonte nem registra apps ou hostnames, pois qualquer um
desses alteraria o projeto de produção. `--source` e `--eject` não podem ser
combinados com `--preview`. Cada um constrói uma imagem de contêiner para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` refere-se sempre à produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o
log de build ou excluir cada um deles. Criar um continua sendo uma etapa via CLI.

Um preview expira uma semana após o último deploy realizado nele.

Quando termina, o deploy verifica se o endereço do preview responde, como faz um
deploy de produção (`--live-timeout <seconds>`, `0` para ignorar). O certificado de um novo
preview pode levar um ou dois minutos, de modo que um deploy bem-sucedido pode
relatar que o endereço ainda não responde.

Um preview de backend é faturado como uma unidade de app no tamanho padrão (100m de CPU
e 384 MiB de memória, na taxa do seu app para sua região e capacidade),
proporcional ao tempo em que existir, e aparece na estimativa mensal do
projeto no console. `rebase cloud deploy --preview` exibe a mesma estimativa para
ele, por mês (`cost` sob `--json`). Iniciar um preview exige um cartão cadastrado, assim como um deploy de produção. Um primeiro deploy que
falhe antes de qualquer execução é removido em vez de faturado. Um projeto pode executar
três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio do Let's Encrypt,
que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de produção
nele. Os previews podem utilizar 20 deles em qualquer período de 7 dias, em toda a plataforma. Ultrapassado
isso, um novo preview é recusado (`429`, `preview_cert_budget`) informando o horário em que poderá
ser implantado; reimplantar um preview já existente nunca entra nessa contagem.

O banco de dados de um preview de backend é um segundo banco de dados no Postgres de **produção**:
seus próprios dados, mas na mesma instância e no mesmo disco. Ele é limitado a 10
conexões, para que os previews não esgotem as de produção, e a 2 GB: um preview
cujo banco de dados ultrapasse isso é pausado. Seu backend para, seu endereço deixa de
responder, `rebase cloud previews` e o console o mostram como `paused` com o
motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus
dados são mantidos até que expire. Faça deploy novamente para iniciá-lo (ele será pausado de novo
se o banco de dados continuar grande demais) ou exclua-o. Um preview pausado continua sendo
faturado até ser excluído ou expirar. Exclua previews que você não precisa mais. Extensões instaladas na produção não são
instaladas no banco de dados de um preview.

Os previews estão sendo disponibilizados gradualmente. Um control plane que ainda não os atenda recusa
`--preview` com `previews_unavailable` e não implanta nada.

## Fazer rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que uma implantação anterior bem-sucedida
entregou e nunca recompila — a vantagem de um rollback é que ele entrega um
artefato que já foi executado anteriormente.

Quais implantações se qualificam depende de como o projeto é implantado, e ambos os tipos
funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que aquele deploy enviou, na versão de runtime que o projeto está executando agora |

Apps estáticos integrados ao bundle do backend (um simples `rebase cloud deploy` em um
projeto com backend) fazem parte desse bundle, portanto sofrem rollback junto com ele.

Um app estático implantado isoladamente (`rebase cloud deploy <app>`) ainda não pode sofrer
rollback. Sua implantação registra qual app foi publicado, mas nenhum bundle, portanto o
control plane não tem de onde restaurá-lo. A solução é fazer deploy da última versão em bom
estado novamente, por exemplo a partir do commit anterior ao problemático. Após esse tipo de
deploy, o `deploy` informa isso em vez de indicar o `rollback`, e o `rollback`
sem um id recusa a ação em vez de reimplantar o backend em execução.

Portanto, um rollback necessita de uma implantação que tenha registrado um dos dois, o que significa um
projeto que tenha sido implantado com sucesso pelo menos duas vezes. `rebase cloud deployments`
marca as que se qualificam, e `--json` reporta `rollbackable` por linha juntamente
com a `image` ou `bundle` que ele restauraria.

Dois tipos de implantação são recusados, e a CLI informa quais: uma que não obteve sucesso
e uma anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há o que adivinhar
em nenhum dos casos — adivinhar enviaria o que quer que tenha sido compilado ou enviado mais
recentemente, enquanto alegaria restaurar este —, portanto implante a versão desejada
manualmente.

Todo deploy bem-sucedido termina indicando o caminho de volta (`rebase cloud rollback`),
para que fique visível no momento em que um release com problemas for percebido.

Um rollback anexa uma nova implantação em vez de retroceder o histórico, e aguarda que
a versão restaurada passe a responder antes de reportar sucesso. Acompanhe com
`rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo (PITR)

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação,
em **Database → Backups** no console ou via CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo ocorre em duas etapas. Primeiro, uma cópia recuperada é preparada (staged) ao lado do banco de dados ativo;
seu app continua rodando no banco ativo, e o armazenamento da cópia é cobrado até
que você faça o cutover ou a descarte.
Depois, quando a cópia estiver pronta, o cutover reaponta o app para ela e o
reinicia. Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados
original é mantido como caminho de retorno e continua cobrando armazenamento; reverter para ele,
removê-lo ou fazer uma segunda restauração requer contato com o suporte. Apenas um proprietário ou administrador
pode preparar, fazer o cutover ou descartar, e o console solicita o nome do projeto
antes de realizar o cutover.

## Proteja sua conta

Sua conta do console tem acesso a bancos de dados de produção, secrets e faturamento, portanto
proteja-a adequadamente. Abra **Account security** no menu sob seu avatar
no console (ou acesse `/account`). A página é sua, não de uma
organização: o que você configurar ali se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password,
  Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao app, ou um
  link que abre o app com a chave preenchida em um celular, e então solicita o
  código de 6 dígitos exibido pelo aplicativo. A partir de então, cada login solicitará um código,
  quer você faça login com senha, Google ou GitHub.
- **Códigos de recuperação.** Ao ativar, você recebe dez códigos de uso único, exibidos apenas uma vez.
  Cada um permite fazer login no lugar do código do autenticador caso perca o
  celular, portanto salve-os antes de fechar o diálogo. **New recovery codes**
  os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas
  ou gerar novos códigos exige um código antes.
- **Senha.** Alterá-la desconecta você em todos os outros dispositivos. Uma conta
  criada com Google, GitHub ou LinkedIn não possui senha; a página oferece o
  envio de um link por e-mail para definir uma.
- **Dispositivos conectados.** Cada navegador e terminal conectado à sua conta,
  com seu endereço e quando fez login. Desconecte qualquer dispositivo que você não
  reconheça ou todos de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo
fator, portanto o CI continuará realizando deploys depois que você ativá-lo. Revogue um token em que não
confia mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Add member** adiciona alguém que já possui uma conta Rebase com um
endereço de e-mail verificado, como admin ou member; um proprietário pode torná-lo proprietário
depois. O acesso é concedido imediatamente e nada é enviado por e-mail. O Rebase Cloud ainda
não envia convites, portanto peça a um colega de equipe sem conta para se cadastrar e
verificar o endereço primeiro. A partir de um terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que
informará isso caso o endereço não tenha conta.

## Acesso ao Cloud e os usuários do seu app

Dois grupos distintos de pessoas estão envolvidos, assim como no Firebase e Supabase:

- **Acesso ao Cloud** define quem pode trabalhar no projeto no Rebase Cloud. Os
  proprietários e administradores de uma organização são `admin` em todos os projetos pertencentes a ela, e
  seus membros são `developer`. Um projeto também pode conceder a uma pessoa uma função própria,
  `admin`, `developer` ou `viewer`, por meio de um convite por e-mail, sem
  torná-la membro da organização. A mais alta das duas se aplica.
  O comando [`rebase cloud access`](/docs/cli/cloud/#project-access) faz o gerenciamento.
- **Os usuários do seu app** residem no próprio banco de dados do app, com seu próprio cadastro e
  suas funções. O Cloud nunca lista ou edita esses usuários.

A única ponte é o botão **Open admin panel**. Ele conecta uma pessoa com acesso `admin`
ao Cloud no painel de administração do app, correspondendo pelo seu e-mail verificado: o app
encontra ou cria a conta com aquele endereço, atribui a ela a função `admin`
e registra que a função veio do Rebase Cloud (a seção Users & roles do Studio
indica isso). Quando essa pessoa perde o acesso `admin` ao Cloud no projeto, o Rebase
Cloud solicita ao app que revogue esse `admin`
e encerra suas sessões no app. Uma função concedida manualmente no app,
incluindo um papel de `admin` mantido antes do primeiro Open admin panel, permanece, e a
conta nunca é excluída.

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` mostram aos
proprietários e administradores da organização quem fez deploy, definiu ou revelou uma variável
de ambiente (por nome, nunca por valor), alterou um domínio, restaurou um backup,
redimensionou, interrompeu ou excluiu um projeto, alterou a função de um membro ou criou um
token, e quando. As configurações (**Settings**) de um projeto têm links para suas próprias entradas; uma entrada
sobre um projeto excluído permanece. Um script pode ler isso usando um token criado com
`--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token restrito a
algumas ações em um único projeto, criado a partir de um terminal autenticado com
`rebase cloud tokens create --project shop --can deploy,logs`, e defina-o como
`REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação
de uma organização são permissões (capabilities) próprias (`--can billing`, `audit`,
`notifications`) que um token detém apenas quando solicitado. As permissões, um
fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão em
[CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` fornece a um app um backend ativo antes que qualquer pessoa tenha se
cadastrado e exibe uma URL de resgate (claim URL) para que a pessoa possa mantê-lo; um projeto que ninguém resgata
dentro de 72 horas é excluído. O que o token de um projeto não resgatado pode fazer, o
`REBASE_API_TOKEN` que ele grava e o que o resgate altera estão em
[Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Recursos de computação e quanto custam

Um projeto é precificado pelo que reserva, e não por um plano (tier). O comando `compute` exibe
cada parâmetro e a cotação discriminada do próprio control plane para eles. (`rebase cloud
resources` é algo diferente: os bancos de dados e buckets declarados pelo código,
e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma, que depende da região (abaixo) |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que pode atingir. Instâncias que o autoscaler adiciona acima de `--replicas` são medidas por pod-segundo nas mesmas taxas e cobradas apenas onde a plataforma tiver ativado isso; **Usage this month** informa quais. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, calculada sobre a solicitação (request) em vez do limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio
segue o padrão da plataforma e muda quando ele muda.

Na Bélgica (europe-west1), o padrão reserva 100m de CPU e 384Mi e pode atingir picos (burst)
de até 2 CPUs e 2 GiB; em Falkenstein e Helsinque, a memória pode se estender até 1,4× a
solicitação e a CPU até 10× (no máximo 1,7 vCPU). `rebase cloud compute` mostra os
números do seu projeto.

Nada é validado pela CLI, propositalmente — os limites pertencem ao cluster em que o
projeto executa e diferem entre provedores. O control plane recusa um
valor que não pode atender e nomeia o campo. Execute `rebase cloud compute` para ver
o valor em €/mês antes e depois; uma alteração se aplica imediatamente, de forma proporcional a partir de hoje.
Uma alteração no banco de dados é aplicada agora; cobrada no tamanho atual até que esteja em execução.
Uma nova CPU ou memória de banco de dados, ou menos instâncias, reinicia o banco de dados (cerca
de 30 segundos a 3 minutos; as conexões são encerradas e reconectadas): `compute set`
informa isso e pede confirmação, e fora de um terminal `--yes` serve como consentimento. Se essa reinicialização
falhar, `rebase cloud compute apply` tenta novamente.

## O restante dos recursos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` exibe o bearer token que a CLI enviaria agora, para scripts e o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [conector Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude possa acessá-lo junto aos seus projetos Cloud. `--list` os exibe, `--remove` remove um deles. Proprietários e administradores |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para resgatá-lo; `claim` exibe esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Implantação e monitoramento |
| `deploy-hooks` | URLs secretas que um host git ou CI chama para implantar o projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Builds servidos em seu próprio endereço por `deploy --preview`, e sua exclusão. Consulte [Visualizar alterações em preview](#visualizar-alterações-em-preview) |
| `sleep` | Hibernar quando inativo: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` e `status` (o padrão). Hibernando, o projeto não retém CPU nem memória e a próxima requisição o desperta; tarefas agendadas e trabalho em segundo plano não são executados enquanto isso. Onde um projeto não puder hibernar, o control plane recusa e informa o motivo |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura, a menos que a plataforma cobre projetos interrompidos apenas pelo armazenamento e pela taxa da plataforma; a linha **Billing** do console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que não está |
| `alerts` | Os incidentes abertos do projeto, com opção de confirmação (acknowledge) ou adiamento (snooze). |
| `cron` | Os cron jobs do app implantado e suas execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente escrita |
| `app-key` | A chave que `init --claim` gravou em `.env` como `REBASE_API_TOKEN`, transferida no momento do resgate; `rotate` a substitui e revoga a antiga. Proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` fornece uma nova ao app. Proprietários e administradores |
| `domains` | Domínios personalizados, registros DNS a serem adicionados e verificação. Um projeto pode responder em vários domínios, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual agir, que só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). Cada domínio verificado serve o projeto como ele mesmo; `primary <domain>` seleciona o canônico e `redirect <domain>` responde a outro com um 308 para ele, mantendo caminho e query (`--off` volta a servi-lo) — faça isso para `www.` ao lado de um apex, já que login do Google, cookies e passkeys são por origem. Um domínio no qual um app é servido (um `path` de app com hostname) nunca redireciona. Um domínio apex (`example.com`, sem subdomínio) requer um registro **A**, pois o DNS não permite CNAME nele. Esse endereço é o ingress da plataforma e não há garantia de que permanecerá o mesmo: se a plataforma mudar de local, um registro A continuará apontando para o endereço antigo. Caso seu provedor DNS ofereça ALIAS, ANAME ou CNAME flattening no apex, aponte o apex para o `tenantHost` do projeto, que acompanha a plataforma. O CNAME de um subdomínio já o acompanha. `list` exibe `verified, certificate pending` até que o HTTPS responda com um certificado real. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Conectar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Os usuários convidados deixados pelo login anônimo: contá-los, excluir um, remover aqueles não vistos há muito tempo. Consulte [Convidados](/docs/cli/cloud/#guests). Proprietários e administradores |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | Os buckets do projeto e suas chaves, no [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu com o backend, do mais recente ao mais antigo: escalonamento do app, alterações de banco agendadas e aplicadas, um standby assumindo, crescimento do disco |
| `usage` | Requisições utilizadas neste mês em relação à cota incluída e o excedente até agora, conforme a fatura contabiliza. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters nos quais os tenants rodam. Apenas para administradores da plataforma |
| `settings`, `orgs`, `access`, `billing` | Configurações do projeto, organizações e seus membros e convites, quem acessa um projeto, pagamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e administradores. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications` | Onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Notificações do Cloud](/docs/deployment/cloud-notifications/)) |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso,
suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o
índice para as páginas, de modo que um grupo adicionado sem uma página falha o build em vez de
responder com o sumário. `verify:docs` vincula a própria tabela a
esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto um grupo
adicionado sem uma linha também causa falha no build.

Em pipes, `--help` responde em JSON: a mesma linha de uso, flags e exemplos
como uma estrutura para leitura em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Sem escolha de região, sem cadastro self-service, sem SLA publicado, sem deploys por branch,
sem tokens atuando como uma pessoa e sem endpoint público de banco de dados. [O que o beta
não inclui](/docs/deployment/cloud-beta-limits/) descreve cada um claramente,
explicando também o que significa fazer deploy com os secrets de produção.

## Em vez disso, auto-hospedagem

Nada aqui representa aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa a imagem e o bundle idênticos com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir
do Helm chart.
