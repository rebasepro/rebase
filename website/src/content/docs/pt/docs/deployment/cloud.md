---
sourceHash: 535999d55c2b1a7c
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que ele é, como um projeto é vinculado e implantado, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem publicada `rebasepro/server`, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e é liberado em
lotes. [Solicitar acesso](https://rebase.pro/pricing).

Não é self-service, portanto, os comandos abaixo precisam de uma conta que tenha sido aprovada.
Tudo o mais neste site funciona sem uma.
:::

## O que é

Um **projeto** Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, executando na imagem de runtime publicada. Deploys são o upload de um bundle, não a compilação de um contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e point-in-time recovery |
| **Storage** | Um bucket próprio, se o seu projeto usar armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é cobrado pelo que
reserva, em vez de por usuário.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório
pode ser auto-hospedado com `docker compose`, e a rota de saída é real: `rebase build`
produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O comando `projects create` não recebe argumentos posicionais. O nome e o subdomínio são
flags e ambos são obrigatórios — em um terminal, eles são solicitados e uma
execução headless que omita qualquer um deles é encerrada com `input_required` em vez de inventar
um. **O subdomínio não pode ser editado posteriormente:** ele é o host
`<slug>.rebase.website` no qual o projeto responde, portanto, escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma
etapa de `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que registra o ID do projeto
e o slug. Esse arquivo não é um segredo e não contém suas credenciais — estas ficam
em `~/.rebase/credentials.json`, gravadas pelo `login`.

`billing setup` anexa um cartão à organização, uma única vez. Ele está em primeiro lugar na
sequência de propósito: o primeiro deploy de um projeto é recusado sem isso, e
descobrir isso após o término do upload do bundle é a pior ordem possível.

Um projeto existente se vincula sem criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando e nenhuma flag para lembrar. O `rebase.json` de um scaffold declara
`runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele
informa isso durante o processo (`rebase.json declares runtime: managed — deploying a
bundle`), compila o aplicativo em `dist-bundle`, faz o upload do bundle, executa-o na
imagem de runtime publicada e acompanha o deployment até um estado terminal. O código de
saída é o veredito, portanto a mesma linha funciona sem intervenção no CI.

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e
faz deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais solicita
isso: um build que moveria um projeto gerenciado para uma imagem de contêiner sob seu
próprio controle é recusado até que você confirme explicitamente. `--force` costumava significar isso, o que colocava
a ação menos reversível que a CLI pode fazer sob a mesma palavra que "sobrescrever este
arquivo"; agora é uma opção desconhecida em vez de um alias, portanto, um script que a utilize
será interrompido.

Acompanhe os logs e o status:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` relata `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a
plataforma está genuinamente trabalhando e fazer polling é a coisa certa a fazer; quando ele apontar
algo, esse algo está esperando por você.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que um deployment bem-sucedido anterior
enviou e nunca recompila — o valor de um rollback é que ele entrega um
artefato que já foi executado.

Quais deployments se qualificam depende de como o projeto faz o deploy, e ambos os tipos
funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que aquele deploy enviou, na versão de runtime que o projeto está executando agora |

Portanto, um rollback precisa de um deployment que tenha registrado um dos dois, o que significa um
projeto que tenha feito deploy com sucesso pelo menos duas vezes. `rebase cloud deployments`
marca os que se qualificam, e `--json` relata `rollbackable` por linha junto
com a `image` ou `bundle` que seria restaurado.

Dois tipos de deployments são recusados, e a CLI informa quais: um que não foi bem-sucedido
e outro de antes da plataforma registrar seu artefato. Não há o que adivinhar
em nenhum dos casos — adivinhar enviaria o que foi compilado ou carregado mais
recentemente alegando restaurar este —, portanto, faça o deploy da versão desejada.

Um rollback acrescenta um novo deployment em vez de voltar no histórico, e aguarda a
versão restaurada começar a responder antes de relatar sucesso. Acompanhe com
`rebase cloud logs -f`.

## Computação e custos

O preço de um projeto é baseado no que ele reserva, e não em um plano. `compute` exibe
cada parâmetro e a cotação detalhada do próprio plano de controle para eles. (`rebase cloud
resources` é uma coisa diferente: os bancos de dados e buckets que o código declara,
e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e significado |
|---|---|
| `--cpu`, `--memory` | Request do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `250m` e `512Mi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e pelo que o projeto é cobrado em repouso |
| `--autoscale-max` | 1–16. O teto que pode atingir e o pior cenário de cobrança. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação ao request e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--scale-to-zero` | `true` ou `false`. Computação cobrada por requisição que para quando ociosa, ao custo de um cold start |
| `--db-mode` | `shared` (cluster compartilhado) ou `dedicated` (dedicado exclusivamente a este projeto) |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory`, `--storage` | Por instância de banco de dados. Vazio significa `500m`, `2Gi` e o volume padrão |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio
segue o padrão da plataforma e muda quando este mudar.

Nada é validado pela CLI, intencionalmente — os limites pertencem ao cluster no qual o
projeto é executado e variam entre provedores. O plano de controle recusa um
valor que não pode atender e indica o campo. Execute `rebase cloud compute` para ver
o valor em €/mês antes e depois; uma alteração é aplicada imediatamente, proporcionalmente a partir de hoje,
exceto uma que reinicie o banco de dados, que aguardará uma janela de manutenção.

## O restante da superfície

| Grupo de comandos | O que cobre |
|---|---|
| `login`, `logout`, `whoami` | Sua sessão |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Envio e monitoramento |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo |
| `status`, `metrics`, `debug` | O que está fazendo e por que não está |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente escrita |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir de sua máquina, backups, restauração e point-in-time recovery |
| `extensions` | A allowlist de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em comparação com o que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `clusters` | Os clusters onde os tenants são executados. Apenas para administradores da plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configurações do projeto, organizações, deploy hooks, faturamento |

Cada grupo nessa tabela responde ao `--help` com uma página própria — uma linha de uso,
suas flags e exemplos —, e o `--help` nunca executa o comando. Um teste mantém o
índice para as páginas, de modo que um grupo adicionado sem uma página falha a compilação em vez
de responder com o índice. O `verify:docs` compara a própria tabela
com esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto, um grupo
adicionado sem uma linha correspondente também falha a compilação.

Ao usar pipes, o `--help` responde em JSON: a mesma linha de uso, flags e exemplos
como uma estrutura legível em vez de sessenta linhas de sequências de escape do terminal.

## O que o beta não inclui

Explicado de forma direta, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Hoje tudo roda em uma única região. O modelo de posicionamento
  existe na plataforma, mas um projeto não pode escolher uma região.
  `projects create --provider` e `--region` não são a exceção que parecem
  ser: eles registram a qual dos destinos de deploy registrados no plano de controle o
  projeto pertence, e há apenas um, portanto ambos adotam esse padrão e nenhum deles move o
  projeto para outro lugar. `rebase cloud projects create --help` confirma isso.
- **Não é self-service.** O acesso é liberado em lotes; não há cadastro com pagamento imediato.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de algum dos dois, informe ao solicitar
  acesso em vez de presumir.
- **Sem deploys de preview ou de branches** e sem GitHub App oficial. Deploy hooks —
  URLs secretas para as quais você aponta o webhook de um repositório — são a automação suportada.
- **O CI precisa de credenciais humanas.** Ainda não existe token de máquina;
  o `rebase cloud login` recebe um e-mail e uma senha. Passe-os como
  `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um gerenciador de segredos —
  `--password` coloca a senha no histórico do seu shell e na tabela de processos,
  alertando sobre isso antes de autenticar.
- **Point-in-time recovery é apenas via CLI.** O console exibe os backups; o fluxo
  em etapas de PITR é `rebase cloud db pitr`.
- **Sem endpoint público para o banco de dados.** Um banco de dados gerenciado não fica exposto à
  internet; portanto, o host exibido no console é o endereço interno usado pelo seu backend e
  não resolve para nada na sua máquina. `rebase cloud db connect` abre uma porta local
  que se conecta a esse banco, encapsulada pelo plano de controle enquanto você mantiver o
  comando em execução — mas não existe um hostname permanente ao qual um serviço
  externo possa se conectar.

## Auto-hospedagem como alternativa

Nada aqui gera lock-in. O [guia de auto-hospedagem](/docs/deployment/self-hosting/)
executa a imagem e o bundle idênticos com `docker compose`, e o
[guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir
do Helm chart.

---
