---
sourceHash: 1959160bec263545
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

`billing setup` vincula um cartão à organização, apenas uma vez. Ele vem primeiro na
sequência de propósito: o primeiro deploy de um projeto é recusado sem isso, e
descobrir isso após a conclusão do upload de um bundle é a pior ordem possível.

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

"Live" significa que o endereço respondeu depois do build: o `/api/health` do backend retornou `ok` e a página de um app estático carregou (deste deploy, quando a plataforma a serve). A verificação espera até `--live-timeout` segundos, 60 por padrão; `0` a pula. Se um app não responder a tempo, o deploy ainda sai com código zero, porque o deployment teve sucesso, e a última linha diz qual app não respondeu e por quê. Um deploy que falhou termina, em vez disso, com uma linha que nomeia o app e o motivo, com `rebase cloud logs` para o log completo do build.

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
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

O comando `status` informa `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a
plataforma está genuinamente trabalhando e fazer polling é o correto; quando indicar
algo, esse algo está aguardando você.

## Pré-visualizar uma mudança

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span>

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

- **`rebase cloud deploy web --preview`** faz o preview de um app estático. Suas páginas chamam
  o backend de **produção**: um login ali é uma sessão real, e qualquer coisa
  gravada ali são dados de produção.
- **`rebase cloud deploy --preview`** faz o preview do backend, com seus apps estáticos
  incorporados, do mesmo jeito que a produção os executa. Ele recebe um backend próprio em
  um **banco de dados vazio e só dele**, nunca o da produção. Inicializar contra
  o banco de dados da produção aplicaria a ele o schema e as regras de acesso do preview.

Um preview não envia código-fonte e não registra apps nem hostnames, porque cada um
deles alteraria o projeto de produção. `--source` e `--eject` não podem ser
combinados com `--preview`. Cada um constrói uma imagem de contêiner para a produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

Um preview expira uma semana depois do último deploy feito nele.

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

Um app estático implantado sozinho (`rebase cloud deploy <app>`) ainda não pode ter rollback. O deployment registra qual app publicou, mas nenhum bundle, então o control plane não tem de onde restaurá-lo. A solução é implantar de novo a última versão boa, por exemplo a partir do commit anterior ao defeituoso. Depois de um deploy assim, `deploy` diz isso em vez de apontar para `rollback`.

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

## CI e agentes

Um job de CI ou um agente não deve utilizar a sua senha. Em vez disso, forneça a ele
um token: uma chave que atua em nome da sua conta, restrita a algumas ações em um
único projeto. Crie-o a partir de um terminal autenticado:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

O token é exibido apenas uma vez, como uma linha `export REBASE_TOKEN=rk_live_…`. Com
`REBASE_TOKEN` definido, todo comando `rebase cloud` se autentica com ele em vez do
seu login, e nunca lê ou grava a sessão armazenada. No GitHub Actions,
armazene-o como um repository secret e exponha-o com esse nome:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` aceita uma ou mais permissões (capabilities), separadas por vírgula ou repetidas:

| Permissão | O que o token pode fazer |
|---|---|
| `deploy` | Fazer deploy do projeto e acompanhar seus builds: `deploy`, `deployments` |
| `logs` | Ler logs de build e runtime, o histórico de crons e métricas em tempo real: `logs`, `cron`, `metrics` |
| `env` | Ler e alterar variáveis de ambiente, incluindo segredos |
| `database` | `db list`, `db info` e `db connect`, o que inclui a senha do banco de dados |
| `backups` | Listar, criar, inspecionar e baixar backups, e ler a janela de point-in-time |

Nos bastidores, um token é uma [chave de API pessoal](/docs/backend/api-keys/#personal-keys)
no plano de controle. Cada permissão é convertida em alguns
[escopos](/docs/backend/roles-and-scopes/): `deploy` no projeto `shop` contém
`project:deploy:<id>`, com o id do projeto, além dos escopos de dados e funções
que os comandos de deploy chamam. O token nunca possui mais permissões do que a sua conta no momento
em que é utilizado, perdendo automaticamente qualquer acesso que a sua conta venha a perder.

Duas ações permanecem exclusivas de uma pessoa autenticada:

- **Gerenciamento de tokens.** `rebase cloud tokens list`, `create` e `revoke <id>` exigem
  a sua sessão de `rebase cloud login`. Um token não pode listar, criar ou revogar
  tokens, pois um token capaz de gerar tokens poderia gerar seu próprio sucessor.
- **Restauração.** Nenhuma permissão concede a restauração de um backup ou as ações de point-in-time
  `restore` e `cutover`. Sobrescrever dados ativos de produção com dados antigos continua restrito a
  um proprietário (owner) ou administrador autenticado.

O comando `rebase cloud whoami` executado com um token definido exibe o que ele pode fazer e em qual
projeto. `rebase cloud tokens revoke <id> --yes` o revoga imediatamente.

## Um backend sem conta

Um agente que construiu um app pode dar a ele um backend no ar antes que alguém tenha se cadastrado, e entregar à pessoa para quem trabalha um link para ficar com ele:

```bash
rebase cloud init --claim
```

Isso provisiona um projeto no Rebase Cloud, define `REBASE_BASE_URL` no `.env` com o endereço no ar, vincula o diretório e faz o deploy das collections locais com `rebase cloud deploy --bundle`. O comando imprime a URL no ar, a URL do painel de administração e uma **URL de reivindicação**. Quem abrir a URL de reivindicação e entrar pode mover o projeto para uma das suas organizações. O link funciona uma única vez. Um projeto que ninguém reivindica em 72 horas é excluído, banco de dados incluído. A ferramenta `rebase_cloud_provision` do servidor MCP executa o mesmo comando e retorna as mesmas URLs.

Até ser reivindicado, o projeto não pertence a nenhuma conta. O token dele é restrito a esse único projeto e a `deploy`, `logs`, `env` e `database`. Ele fica em `~/.rebase/credentials.json`, nunca no repositório, e os comandos `rebase cloud` no diretório vinculado o usam sozinhos. Ele expira junto com o projeto.

Depois que o deploy constrói o app, o comando também define `REBASE_API_TOKEN` no `.env`: uma chave criada no próprio app, que é o que o servidor MCP e o SDK enviam a ele. Ela lê e grava dados (`data:read`, `data:write`) através da segurança em nível de linha do app, como um chamador que não é nem uma pessoa nem um administrador. Não tem nenhuma permissão do plano de administração e expira com o prazo de reivindicação. Com `--no-deploy`, ou se esse primeiro deploy falhar, ainda não há chave: o próximo `rebase cloud deploy` bem-sucedido no diretório pede uma, enquanto o projeto não for reivindicado e o `.env` ainda não definir `REBASE_API_TOKEN`. Quando o projeto for seu, crie as chaves que quiser no painel de administração dele.

Reivindicar exige uma sessão conectada no navegador, não um token, e um método de pagamento na organização para onde o projeto vai. A partir da reivindicação, o projeto é cobrado como qualquer outro. Reivindicar também revoga o token do agente: entre com `rebase cloud login` ou crie um novo token com `rebase cloud tokens create`.

O provisionamento sem conta é limitado por endereço e no total, e um plano de controle que não o ativou recusa com uma mensagem que diz isso.

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
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que é cobrado do projeto em repouso |
| `--autoscale-max` | 1–16. O teto máximo que pode atingir e o pior cenário de cobrança. `--no-autoscale` desativa o autoscaling |
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
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](#ci-e-agentes) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `init` | Com `--claim`: um backend no ar sem conta e um link para reivindicá-lo. Veja [Um backend sem conta](#um-backend-sem-conta) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicação e monitoramento |
| `previews` | Builds servidos em seu próprio endereço por `deploy --preview`, e a exclusão deles. Veja [Pré-visualizar uma mudança](#pré-visualizar-uma-mudança) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo |
| `status`, `metrics`, `debug` | O que está em execução e eventuais falhas |
| `cron` | Os cron jobs da aplicação implantada e suas execuções registradas, lidos com o seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente escrita |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em múltiplos domínios, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual agir, que só pode ser omitido caso exista apenas um (para `verify`, um ainda pendente). `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Vincular ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e recuperação point-in-time |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém em comparação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `clusters` | Os clusters onde os tenants executam. Exclusivo para administradores da plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configurações do projeto, organizações, deploy hooks, faturamento |

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
- **Tokens atuam em nome de uma pessoa.** Um [token](#ci-e-agentes) é gerado por uma conta
  e atua como ela; ainda não existe uma identidade de máquina de propriedade da organização. Caso
  faça login a partir do CI, forneça `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  a partir de um gerenciador de segredos — `--password` insere a senha no histórico do shell e
  na tabela de processos, alertando sobre isso antes de autenticar. Se o
  `.rebase/cloud.json` do repositório apontar para um plano de controle diferente do da plataforma, passe-o
  também como `--url`: sem um terminal, o `login` recusa enviar uma senha para um
  host que apenas o arquivo versionado indicou.
- **Recuperação point-in-time disponível apenas via CLI.** O console exibe backups; o fluxo
  preparatório de PITR é `rebase cloud db pitr`.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não fica exposto à
  internet, portanto o host exibido no console é o endereço interno do seu backend para ele e
  não resolve nada na sua máquina local. O comando `rebase cloud db connect` abre uma porta
  local que representa esse banco de dados, tunelada através do plano de controle enquanto
  você mantiver o processo em execução — mas não existe um hostname permanente ao qual um serviço
  de terceiros possa se conectar. Esse túnel e a senha protegida por
  `rebase cloud db info --reveal` exigem o papel de proprietário (owner) ou administrador da organização:
  o mesmo que o editor SQL do Studio exige, pois todos os três resultam em uma
  sessão com acesso aos seus dados de produção.

## Auto-hospedagem como alternativa

Nada aqui gera aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa exatamente a mesma imagem e bundle com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) reproduz a mesma topologia a partir
do Helm chart.
