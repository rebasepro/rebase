---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase open source que você auto-hospedaria — a mesma
imagem publicada de `rebasepro/server`, o mesmo bundle, o mesmo Postgres. A
diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e abre
em lotes. [Solicite acesso](https://rebase.pro/pricing).

Não é self-service, portanto os comandos abaixo exigem uma conta com acesso liberado.
Todo o restante deste site funciona sem uma.
:::

## O que é

Um **projeto** no Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, executando na imagem de runtime publicada. Deploys são o upload de um bundle, não a compilação de um contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação pontual (point-in-time recovery) |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

Cada um é provisionado no seu primeiro deploy, e cada um é faturado pelo que
reserva, em vez de cobrança por assento.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser
auto-hospedado com `docker compose`, e a válvula de escape é real: `rebase build`
gera um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Conectar um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` não recebe argumentos posicionais. O nome e o subdomínio são
flags, e ambos são obrigatórios — no terminal eles são solicitados e, em uma
execução headless que omita qualquer um deles, o comando encerra com `input_required`
em vez de inventar um. **O subdomínio não é editável posteriormente:** ele é o
host `<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma
etapa separada de `link`. Ele grava `.rebase/cloud.json`, que registra o id e o
slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais —
elas ficam em `~/.rebase/credentials.json`, gravado pelo `login`.

`billing setup` vincula um cartão à organização uma única vez. Ele vem primeiro na
sequência propositalmente: o primeiro deploy de um projeto é recusado sem isso, e
descobrir isso depois que o upload de um bundle terminou seria a pior ordem possível.

Um projeto existente pode ser vinculado sem criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um único comando, sem flags para memorizar. O `rebase.json` de um scaffold declara
`runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele
informa isso durante o processo (`rebase.json declares runtime: managed — deploying a
bundle`), compila o app em `dist-bundle`, faz o upload do bundle, o executa na
imagem de runtime publicada e acompanha o deployment até um estado final. O código
de saída é o veredito, portanto a mesma linha funciona de forma não assistida em CI.

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de
CI que compila uma vez e faz deploy duas vezes —, aponte para o diretório em vez
de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais solicita
isso: um build que migraria um projeto gerenciado para uma imagem de contêiner
própria é recusado até que você determine explicitamente. Antigamente, `--force`
significava isso, o que colocava a ação menos reversível que a CLI pode fazer sob a
mesma palavra que "sobrescrever este arquivo"; agora é uma opção desconhecida em
vez de um alias, portanto scripts que a utilizem serão interrompidos.

Acompanhe:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

O `status` informa `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a
plataforma está genuinamente trabalhando e fazer polling é o correto; quando ele
indicar algo, esse algo está esperando por você.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que uma implantação bem-sucedida anterior
enviou e nunca recompila — o valor de um rollback é entregar um artefato que já
foi executado.

Quais deployments se qualificam depende de como o projeto é implantado, e ambos os
tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que aquele deploy enviou, na versão de runtime que o projeto está executando agora |

Portanto, um rollback precisa de um deployment que tenha registrado um dos dois, o
que significa um projeto que já foi implantado com sucesso pelo menos duas vezes.
O `rebase cloud deployments` marca os que se qualificam, e `--json` relata
`rollbackable` por linha junto com a `image` ou o `bundle` que seria restaurado.

Dois tipos de deployment são recusados, e a CLI informa qual deles: um que não
foi bem-sucedido e outro de antes da plataforma registrar seu artefato. Não há nada
a adivinhar em nenhum dos casos — adivinhar enviaria o que foi compilado ou carregado
mais recentemente alegando restaurar este —, então faça deploy da versão que desejar
em vez disso.

Um rollback anexa um novo deployment em vez de retroceder o histórico, e aguarda
a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com
`rebase cloud logs -f`.

## Computação e custos

O preço de um projeto é calculado a partir do que ele reserva, e não por um plano
fixo. O comando `compute` exibe cada parâmetro e a cotação detalhada do próprio
control plane para eles. (`rebase cloud resources` é uma coisa diferente: os
bancos de dados e buckets que o código declara e se cada um está provisionado —
consulte a [referência da CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) do app por instância, por ex., `500m` e `2Gi`. Vazio significa o padrão da plataforma — `250m` e `512Mi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e pelo que o projeto é cobrado em repouso |
| `--autoscale-max` | 1–16. O teto que pode atingir e o pior cenário de cobrança. `--no-autoscale` o desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação ao request em vez do limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--scale-to-zero` | `true` ou `false`. Computação cobrada por requisição que para quando ociosa, ao custo de um cold start |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory`, `--storage` | Por instância de banco de dados. Vazio significa `500m`, `2Gi` e o volume padrão |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro
vazio segue o padrão da plataforma e muda quando ele mudar.

Nada é validado pela CLI, de propósito — os limites pertencem ao cluster em que o
projeto roda e variam entre provedores. O control plane recusa valores que não
pode atender e indica o campo. Execute `rebase cloud compute` para ver o valor
em €/mês antes e depois; as alterações são aplicadas imediatamente, proporcionais
a partir de hoje, exceto mudanças que reiniciem o banco de dados, que aguardam uma
janela de manutenção.

## O restante dos recursos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami` | Sua sessão |
| `link`, `unlink`, `use`, `open` | Vinculação deste diretório a um projeto, seleção de organização, abertura do console |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Envio e monitoramento |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo |
| `status`, `metrics`, `debug` | O que está fazendo e por que não está |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `extensions` | Lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterá-lo |
| `clusters` | Os clusters nos quais os tenants rodam. Apenas para platform-admin |
| `settings`, `orgs`, `webhooks`, `billing` | Configurações do projeto, organizações, deploy hooks, pagamento |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de
uso, suas flags e exemplos —, e `--help` nunca executa o comando. Um teste mantém
o índice para essas páginas; portanto, um grupo adicionado sem uma página falha a
compilação em vez de responder com o índice. O `verify:docs` vincula a própria
tabela a esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma
vez, portanto um grupo adicionado sem uma linha também falhará a compilação.

Quando usado em um pipe, o `--help` responde em JSON: a mesma linha de uso, flags
e exemplos como uma estrutura legível, em vez de sessenta linhas de sequências
de escape de terminal.

## O que o beta ainda não inclui

Dito de forma direta, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Hoje, tudo roda em uma única região. O modelo de
  posicionamento existe na plataforma, mas um projeto não pode escolher uma
  região. `projects create --provider` e `--region` não são a exceção que parecem
  ser: eles registram a qual dos alvos de deploy cadastrados no control plane o
  projeto pertence, e há apenas um; portanto, ambos adotam o padrão dele e nenhum
  dos dois move o projeto para outro lugar. `rebase cloud projects create --help`
  informa o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há cadastro e
  pagamento imediato.
- **Nenhum SLA publicado** e sem SOC 2. Se você precisar de qualquer um deles,
  mencione ao solicitar acesso em vez de assumir que existem.
- **Sem deploys de preview ou branch**, e sem GitHub App oficial. Deploy hooks —
  URLs secretas para as quais você aponta o webhook de um repositório — são a
  automação suportada.
- **A CI precisa das credenciais de uma pessoa.** Ainda não há tokens de máquina;
  `rebase cloud login` requer e-mail e senha. Passe-os como
  `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um cofre de segredos —
  o uso de `--password` insere a senha no histórico da sua shell e na tabela de
  processos, alertando sobre isso antes de autenticar.
- **Recuperação pontual (point-in-time recovery) apenas via CLI.** O console
  exibe backups; o fluxo em etapas de PITR é `rebase cloud db pitr`.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não
  fica exposto à internet, de modo que o host mostrado pelo console é o endereço
  interno usado pelo seu backend e não resolve para nada na sua máquina.
  `rebase cloud db connect` abre uma porta local que se conecta a esse banco,
  tunelada pelo control plane, enquanto você mantiver o comando em execução —
  mas não há um hostname permanente ao qual serviços terceiros possam se conectar.
  Esse túnel e a senha protegida por `rebase cloud db info --reveal` exigem a
  função de owner ou admin na organização: a mesma que o editor SQL do Studio
  solicita, pois todos os três resultam em uma sessão sobre os seus dados de produção.

## Auto-hospedagem como alternativa

Nada aqui é um aprisionamento a fornecedor. O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa a mesma imagem e bundle idênticos com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a
partir do Helm chart.
