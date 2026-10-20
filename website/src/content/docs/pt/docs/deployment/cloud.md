---
sourceHash: a32dc82ba7002b52
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se vincula e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma
imagem publicada `rebasepro/server`, o mesmo bundle, o mesmo Postgres. A
diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e abre em
lotes. [Solicite acesso](https://rebase.pro/pricing).

Ele não é self-service, portanto os comandos abaixo precisam de uma conta que tenha recebido acesso.
Todo o restante neste site funciona sem ela.
:::

## O que é

Um **projeto** Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são o upload de um bundle, não o build de um contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e point-in-time recovery |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é cobrado pelo que
reserva, em vez de por usuário (seat).

**Nada no seu projeto muda para rodar lá.** O mesmo repositório
pode ser auto-hospedado com `docker compose`, e a rota de saída é real: `rebase build`
produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir de um diretório de projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O `projects create` não recebe argumentos posicionais. O nome e o subdomínio são
flags, e ambos são obrigatórios — em um terminal, eles são solicitados, e uma
execução headless que omita qualquer um deles encerra com `input_required` em vez de inventar
um. **O subdomínio não pode ser editado posteriormente:** é o host
`<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com atenção.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma
etapa `link` separada. Ele grava `.rebase/cloud.json`, que registra o id e o
slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam
em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado junto com o código, de modo que um repositório clonado pode apontar para qualquer
plano de controle. Quando o host vem apenas desse arquivo e não é o próprio da
plataforma nem um no qual você já tenha feito login anteriormente, o `login` informa o nome dele e pede
confirmação antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com
`--json`, ele recusa com `unknown_control_plane`; passe `--url <host>` (ou defina
`REBASE_CLOUD_URL`) para fazer login deliberadamente nesse destino.

O `billing setup` associa um cartão à organização, uma única vez. Ele está no início da
sequência por um motivo: o primeiro deploy de um projeto é recusado sem isso, e
descobrir isso após o upload de um bundle terminar é a pior ordem possível.

Um projeto existente pode ser vinculado sem criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando, e nenhuma flag para lembrar. O `rebase.json` de um scaffold declara
`runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele
informa isso durante a execução (`rebase.json declares runtime: managed — deploying a
bundle`), compila a aplicação em `dist-bundle`, faz o upload do bundle, o executa na
imagem de runtime publicada e acompanha a implantação até um estado final. O código de
saída (exit code) é o veredito, portanto a mesma linha funciona de forma autônoma no CI.

Ele termina dizendo onde cada app responde agora e se a nova versão está no ar ali:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
```

"Live" significa que o endereço respondeu depois do build: o `/api/health` do backend retornou `ok` e a página de um app estático carregou (deste deploy, quando a plataforma a serve). A verificação espera até `--live-timeout` segundos, 60 por padrão; `0` a pula. Se um app não responder a tempo, o deploy ainda sai com código zero, porque o deployment teve sucesso, e a última linha diz qual app não respondeu e por quê. Um deploy que falhou termina, em vez disso, com uma linha que nomeia o app e o motivo, com `rebase cloud logs` para o log completo do build.

Scripts passam `--json` para receber um objeto com os mesmos dados — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id do deploy. Diferente do resto de `rebase cloud`, o `deploy` não muda para JSON sozinho quando usado com pipe.

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de
CI que compila uma vez e faz deploy duas vezes —, aponte para o diretório em vez
de recompilar:

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias,
timeouts e tamanhos de body, sistema de arquivos, segredos, armazenamento e tráfego de rede
de saída — está em sua própria página:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de CI que faz o build uma vez e
o deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais pede
por isso: um build que moveria um projeto gerenciado para uma imagem de contêiner própria
é recusado até que você determine explicitamente. Antigamente `--force` significava isso, o que colocava a
ação menos reversível que a CLI pode fazer sob a mesma palavra usada para "sobrescrever este
arquivo"; agora ela é uma opção desconhecida em vez de um alias, de modo que um script que a utilize
será interrompido.

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

O `status` relata `blockedOn` e `nextAction`. Quando `blockedOn` é `null`, a
plataforma está realmente trabalhando e fazer polling é a atitude correta; quando ele indica
algo, esse algo está esperando por você.

## Reverter (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que um deploy bem-sucedido anterior
entregou, e nunca recompila — o valor de um rollback é que ele entrega um
artefato que já foi executado.

Quais deployments se qualificam depende de como o projeto faz deploy, e ambos os tipos
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

Um job de CI ou um agente não deve carregar sua senha. Em vez disso, forneça a ele um token:
uma chave que atua como sua conta, restrita a algumas ações em um
projeto. Crie-o a partir de um terminal autenticado:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

O token é exibido apenas uma vez, como uma linha `export REBASE_TOKEN=rk_live_…`. Com
o `REBASE_TOKEN` definido, todo comando `rebase cloud` se autentica com ele em vez do
seu login, e nunca lê ou grava a sessão armazenada. No GitHub Actions,
armazene-o como um secret do repositório e exponha-o com esse nome:

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
| `logs` | Ler logs de build e runtime, e métricas em tempo real: `logs`, `metrics` |
| `env` | Ler e alterar variáveis de ambiente, incluindo segredos |
| `database` | `db list`, `db info` e `db connect`, o que inclui a senha do banco de dados |
| `backups` | Listar, criar, inspecionar e baixar backups, e ler a janela de point-in-time |

Por baixo dos panos, um token é uma [chave de API pessoal](/docs/backend/api-keys/#personal-keys)
no plano de controle. Cada capability é mapeada para alguns
[escopos](/docs/backend/roles-and-scopes/): `deploy` em `shop` possui
`project:deploy:<id>`, com o id do projeto, além dos escopos de dados e funções
que os comandos de deploy chamam. O token nunca possui mais permissões do que sua conta no momento
em que é usado, portanto ele perde tudo o que sua conta perder.

Duas coisas continuam restritas a uma pessoa autenticada:

- **Gerenciamento de tokens.** `rebase cloud tokens list`, `create` e `revoke <id>` exigem
  sua sessão do `rebase cloud login`. Um token não pode listar, criar ou revogar
  tokens, pois um token capaz de emitir tokens poderia emitir seu próprio sucessor.
- **Restauração.** Nenhuma capability concede a restauração de backup ou um `restore`
  e `cutover` point-in-time. Sobrescrever um banco de dados ativo com dados antigos continua restrito a um
  proprietário (owner) ou administrador (admin) autenticado.

`rebase cloud whoami` com um token definido mostra o que ele pode fazer e em qual
projeto. `rebase cloud tokens revoke <id> --yes` o revoga imediatamente.

## Computação e quanto custa

Um projeto é precificado pelo que reserva, não por um plano predefinido (tier). O comando `compute` exibe
cada ajuste e a cotação detalhada do próprio plano de controle para eles. (`rebase cloud
resources` é algo diferente: os bancos de dados e buckets declarados pelo código,
e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) da aplicação por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `250m` e `512Mi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler, e pelo que o projeto é faturado em repouso |
| `--autoscale-max` | 1–16. O teto que pode alcançar, e o pior caso de faturamento. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação ao request em vez do limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--scale-to-zero` | `true` ou `false`. Computação faturada por requisição que é pausada quando ociosa, ao custo de um cold start |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory`, `--storage` | Por instância de banco de dados. Vazio significa `500m`, `2Gi` e o volume padrão |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor: um parâmetro vazio
segue o padrão da plataforma e muda quando este mudar.

Nada é validado pela CLI, intencionalmente — os limites pertencem ao cluster onde o
projeto é executado, e eles variam entre provedores. O plano de controle recusa um
valor que não pode atender e indica o campo. Execute `rebase cloud compute` para ver
o valor em €/mês antes e depois; uma alteração é aplicada imediatamente, proporcional (prorated) a partir de hoje,
exceto uma que reinicie o banco de dados, que aguarda uma janela de manutenção.

## O restante dos recursos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami` | Sua sessão |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](#ci-e-agentes) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Envio e monitoramento |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo |
| `status`, `metrics`, `debug` | O que está fazendo, e por que não está |
| `cron` | Os cron jobs da aplicação implantada e suas execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em vários, cada um verificado separadamente; `verify` e `remove` recebem o domínio sobre o qual agir, que só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir de sua máquina, backups, restore e point-in-time recovery |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterá-lo |
| `clusters` | Os clusters nos quais os tenants rodam. Apenas administradores da plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configurações do projeto, organizações, deploy hooks, pagamento |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso,
suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o
índice para as páginas, de modo que um grupo adicionado sem uma página falha o build em vez de
responder com o sumário. `verify:docs` vincula a própria tabela a
esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto um grupo
adicionado sem uma linha também falha o build.

Quando usado em pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos
como uma estrutura legível, em vez de sessenta linhas de caracteres de escape de terminal.

## O que o beta não inclui

Explicado com clareza, pois descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo roda em uma única região hoje. O modelo de distribuição geográfica
  existe na plataforma, mas um projeto não pode escolher uma região.
  `projects create --provider` e `--region` não são a exceção que parecem
  ser: eles registram a qual dos alvos de deploy cadastrados no plano de controle um
  projeto pertence, e há apenas um, portanto ambos adotam esse padrão e nenhum move um
  projeto para outro lugar. `rebase cloud projects create --help` diz o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há opção de cadastrar-se e pagar imediatamente.
- **Sem SLA publicado**, e sem SOC 2. Se você precisar de qualquer um deles, mencione isso ao solicitar
  acesso em vez de presumir que existam.
- **Sem deploys de preview ou de branch**, e sem GitHub App oficial de primeira parte. Deploy hooks —
  URLs secretas para as quais você aponta um webhook de repositório — são a automação suportada.
- **Tokens atuam como uma pessoa.** Um [token](#ci-e-agentes) é emitido por uma conta
  e atua em nome dela; ainda não há identidade de máquina pertencente à organização. Se você
  fizer login a partir do CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  de um cofre de segredos — `--password` coloca a senha no histórico do seu shell e
  na tabela de processos, alertando sobre isso antes de autenticar. Se o arquivo
  `.rebase/cloud.json` do repositório indicar um plano de controle diferente do próprio da
  plataforma, passe-o como `--url` também: sem um terminal, o `login` se recusa a enviar uma senha para um
  host que apenas o arquivo versionado nomeou.
- **Point-in-time recovery é apenas via CLI.** O console exibe backups; o fluxo
  PITR em etapas é executado com `rebase cloud db pitr`.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não fica exposto à
  internet, portanto o host que o console exibe é o endereço dele para o seu backend e
  não resolve para nada na sua máquina. `rebase cloud db connect` abre uma porta
  local que representa esse banco de dados, tunelada pelo plano de controle, enquanto
  você a mantiver em execução — mas não há um hostname permanente ao qual um serviço
  de terceiros possa se conectar. Esse túnel e a senha por trás de
  `rebase cloud db info --reveal` exigem o papel de owner ou admin da organização:
  o mesmo exigido pelo editor SQL do Studio, pois todos os três resultam em uma
  sessão com seus dados de produção.

## Auto-hospedagem como alternativa

Nada aqui gera aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa a mesma imagem e bundle com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir
do Helm chart.
