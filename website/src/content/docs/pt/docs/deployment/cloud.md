---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que ele é, como um projeto se vincula e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e abre em lotes. [Solicitar acesso](https://rebase.pro/pricing).

Não é self-service, portanto os comandos abaixo exigem uma conta com acesso liberado. Todo o restante deste site funciona sem uma.
:::

## O que é

Um **projeto** no Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, executando na imagem de runtime publicada. Deploys são um upload de bundle, não a compilação de um container |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação pontual (point-in-time recovery) |
| **Storage** | Um bucket próprio, se o seu projeto usar armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é faturado pelo que reserva em vez de por usuário.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a rota de escape é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime execute.

## Vincular um projeto

A partir de um diretório de projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O `projects create` não recebe argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal, eles são solicitados interativamente, e uma execução headless que omita qualquer um deles é encerrada com `input_required` em vez de inventar um. **O subdomínio não pode ser editado posteriormente:** ele é o host `<slug>.rebase.website` no qual o projeto responde, portanto escolha-o deliberadamente.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma etapa de `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que armazena o id do projeto e o slug. Esse arquivo não é um segredo e não contém suas credenciais — estas residem em `~/.rebase/credentials.json`, gravado pelo `login`.

`billing setup` vincula um cartão à organização, uma única vez. Ele está em primeiro lugar na sequência de propósito: o primeiro deploy de um projeto é recusado sem ele, e descobrir isso após o término do upload de um bundle é a pior ordem possível.

Um projeto existente é vinculado sem criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando e nenhuma flag para memorizar. O `rebase.json` de um scaffold declara `runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele avisa durante a execução (`rebase.json declares runtime: managed — deploying a bundle`), compila o aplicativo em `dist-bundle`, faz o upload do bundle, o executa na imagem de runtime publicada e acompanha o deployment até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona sem intervenção humana no CI.

Para enviar um artefato que foi compilado anteriormente — um job de CI que compila uma vez e faz o deploy duas vezes, por exemplo — aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nenhuma outra opção solicita isso: uma compilação que moveria um projeto gerenciado para uma imagem de container que ele próprio gerencia é recusada até que você autorize explicitamente. Antes, `--force` significava isso, o que colocava a ação menos reversível que a CLI pode fazer sob a mesma palavra de "sobrescrever este arquivo"; agora, ela é uma opção desconhecida em vez de um alias, então qualquer script que a contenha simplesmente é interrompido.

Acompanhe:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` informa `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está genuinamente trabalhando e fazer polling é a coisa certa a fazer; quando houver algo indicado, esse algo está esperando por você.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que um deployment anterior bem-sucedido entregou e nunca recompila — o valor de um rollback é entregar um artefato que já foi executado.

Quais deployments se qualificam depende de como o projeto faz deploy, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (a source build) | A imagem publicada por essa compilação |
| `rebase cloud deploy --bundle` (the platform runtime) | O bundle entregue por esse deploy, na versão do runtime em que o projeto está rodando agora |

Portanto, um rollback precisa de um deployment que tenha registrado um dos dois, o que significa um projeto que fez deploy com sucesso pelo menos duas vezes. `rebase cloud deployments` marca os que se qualificam, e `--json` reporta `rollbackable` por linha junto com a `image` ou `bundle` que ele restauraria.

Dois tipos de deployments são recusados, e a CLI informa qual deles: um que não teve sucesso e um anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há adivinhação em nenhum dos casos — adivinhar enviaria o que foi compilado ou carregado mais recentemente alegando restaurar este —, portanto faça o deploy da versão desejada em vez disso.

Um rollback acrescenta um novo deployment em vez de voltar o histórico no tempo, e aguarda a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com `rebase cloud logs -f`.

## Computação e quanto custa

O preço de um projeto é calculado a partir do que ele reserva, e não a partir de um plano (tier). `compute` exibe cada parâmetro e o orçamento detalhado do próprio plano de controle para eles. (`rebase cloud resources` é algo diferente: os bancos de dados e buckets que o código declara, e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `250m` e `512Mi` |
| `--replicas` | Instâncias que sempre existem: o piso do escalador automático (autoscaler), e pelo que o projeto é cobrado em repouso |
| `--autoscale-max` | 1–16. O teto que ele pode atingir e o pior cenário em que pode ser faturado. `--no-autoscale` o desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação à solicitação (request) e não ao limite (limit). Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--scale-to-zero` | `true` ou `false`. Computação cobrada por requisição que é interrompida quando ociosa, ao custo de um cold start |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory`, `--storage` | Por instância de banco de dados. Vazio significa `500m`, `2Gi` e o volume padrão |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio segue o padrão da plataforma e muda quando ele mudar.

Nada é validado pela CLI, de propósito — os limites pertencem ao cluster no qual o projeto roda, e eles variam entre provedores. O plano de controle recusa qualquer valor que não consiga atender e aponta o campo correspondente. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; qualquer alteração se aplica imediatamente, proporcional a partir de hoje, exceto aquela que reinicia o banco de dados, que aguarda por uma janela de manutenção.

## O restante da superfície

| Grupo de comandos | O que cobre |
|---|---|
| `login`, `logout`, `whoami` | Sua sessão |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Envio e monitoramento |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que não está |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `domains` | Domínios personalizados, os registros DNS a adicionar e verificação |
| `db` | Conectar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em comparação com o que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterá-lo |
| `clusters` | Os clusters nos quais os tenants rodam. Apenas administradores da plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configurações do projeto, organizações, webhooks de deploy, faturamento |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso, suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o índice para as páginas, portanto um grupo adicionado sem uma página falha o build em vez de responder com o índice de conteúdo. O script `verify:docs` vincula a própria tabela a esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha correspondente também falha o build.

Quando direcionado via pipe, o `--help` responde em JSON: a mesma linha de uso, flags e exemplos estruturados para leitura em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta ainda não inclui

Dito claramente, porque descobrir depois é pior:

- **Sem escolha de região.** Hoje tudo roda em uma única região. O modelo de posicionamento existe na plataforma, mas um projeto não pode escolher uma região. `projects create --provider` e `--region` não são a exceção que parecem ser: eles registram a qual dos alvos de deploy cadastrados no plano de controle o projeto pertence, e existe apenas um, portanto ambos adotam esse padrão e nenhum move o projeto para qualquer outro lugar. O comando `rebase cloud projects create --help` diz o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há opção de cadastrar-se e pagar imediatamente.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de algum dos dois, informe ao solicitar acesso em vez de presumir que existam.
- **Sem deploys de preview ou de branch**, e sem GitHub App oficial. Deploy hooks — URLs secretas para as quais você aponta um webhook de repositório — são a automação suportada.
- **O CI precisa das credenciais de um usuário humano.** Ainda não existe token de máquina; `rebase cloud login` aceita um e-mail e uma senha. Passe-os como `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um gerenciador de segredos — `--password` expõe a senha no histórico do seu shell e na tabela de processos, e avisa sobre isso antes de autenticá-lo.
- **A recuperação pontual (point-in-time recovery) é exclusiva da CLI.** O console exibe os backups; o fluxo em etapas de PITR é `rebase cloud db pitr`.
- **Sem endpoint público para banco de dados.** Um banco de dados gerenciado não fica exposto à internet; portanto, o host exibido no console é o endereço interno do backend para ele e não resolve nada na sua máquina. O `rebase cloud db connect` abre uma porta local conectada a esse banco de dados por meio de um túnel pelo plano de controle enquanto você mantiver o comando em execução — mas não há um hostname permanente ao qual um serviço de terceiros possa se conectar. Esse túnel e a senha protegida por `rebase cloud db info --reveal` exigem a função de owner ou admin na organização: a mesma que o editor SQL do Studio solicita, pois todos os três levam a uma sessão direta com seus dados de produção.

## Auto-hospedagem como alternativa

Nada aqui gera dependência exclusiva (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a mesma imagem e o mesmo bundle com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.

---
