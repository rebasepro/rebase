---
sourceHash: 9e0f8ddeef2c5dcb
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e é liberado em lotes. [Solicitar acesso](https://rebase.pro/pricing).

Não é autosserviço (self-serve), portanto os comandos abaixo exigem uma conta com acesso concedido. Todo o restante neste site funciona sem uma conta.
:::

## O que é

Um **projeto** no Cloud é composto por três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, executando na imagem de runtime publicada. Deploys são o upload de um bundle, não a compilação de um contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e recuperação point-in-time |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é cobrado pelo que reserva, em vez de ser cobrado por usuário (per seat).

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a alternativa de saída (escape hatch) é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir do diretório do projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — no terminal, eles serão solicitados interativamente, e uma execução não interativa (headless) que omitir qualquer um deles sairá com `input_required` em vez de inventar um valor. **O subdomínio não pode ser editado posteriormente:** ele é o host `<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma etapa `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que registra o id e o slug do projeto. Esse arquivo não é confidencial e não contém suas credenciais — elas ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

`billing setup` vincula um cartão à organização, uma única vez. Ele vem primeiro na sequência propositalmente: o primeiro deploy de um projeto é recusado sem um cartão, e descobrir isso após o término do upload do bundle é a pior ordem.

Um projeto existente pode ser vinculado sem a criação de um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando, sem nenhuma flag para lembrar. O `rebase.json` de um scaffold declara `runtime: "managed"` para o seu backend, e o comando `deploy` lê essa declaração — ele informa isso durante a execução (`rebase.json declares runtime: managed — deploying a bundle`), compila o app no diretório `dist-bundle`, faz o upload do bundle, executa-o na imagem de runtime publicada e acompanha o deploy até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona de forma autônoma no CI.

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e faz deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais a solicita: uma compilação que moveria um projeto gerenciado para uma imagem de contêiner sob sua própria responsabilidade é recusada até que você confirme. Antigamente, `--force` tinha esse significado, o que colocava a ação menos reversível que a CLI pode executar sob a mesma palavra que "sobrescrever este arquivo"; agora essa opção é desconhecida em vez de ser um alias, de modo que qualquer script que a contenha é interrompido.

Acompanhe a execução:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` informa `blockedOn` e `nextAction`. Quando `blockedOn` é `null`, a plataforma está genuinamente trabalhando e fazer polling é a coisa certa a fazer; quando indica algo, esse algo está esperando por você.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback redireciona o projeto para o que um deploy bem-sucedido anterior publicou e nunca recompila — o valor de um rollback é entregar um artefato que já foi executado.

Quais deploys se qualificam depende de como o projeto é implantado, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (uma compilação a partir do código-fonte) | A imagem que essa compilação publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que esse deploy publicou, na versão de runtime que o projeto está executando agora |

Portanto, um rollback precisa de um deploy que tenha registrado um dos dois, o que significa um projeto que já teve deploy realizado com sucesso pelo menos duas vezes. O comando `rebase cloud deployments` marca os que se qualificam, e `--json` informa `rollbackable` por linha junto com a `image` ou `bundle` que seria restaurado.

Dois tipos de deploys são recusados, e a CLI informa qual deles: um que não teve sucesso e outro anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há o que adivinhar em nenhum dos casos — adivinhar enviaria o que foi compilado ou carregado mais recentemente alegando restaurar este —, portanto, faça o deploy diretamente da versão desejada.

Um rollback adiciona um novo deploy em vez de retroceder o histórico e aguarda até que a versão restaurada esteja respondendo antes de relatar sucesso. Acompanhe com `rebase cloud logs -f`.

## Computação e quanto custa

O preço de um projeto é calculado com base no que ele reserva, não a partir de um plano pré-definido (tier). O comando `compute` exibe cada parâmetro e a cotação detalhada do próprio plano de controle para eles. (`rebase cloud resources` é algo diferente: os bancos de dados e buckets que o código declara e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `250m` e `512Mi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e pelo que o projeto é cobrado em repouso |
| `--autoscale-max` | 1–16. O teto que pode atingir e o pior cenário de cobrança. `--no-autoscale` desativa o recurso |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação à solicitação (request) e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--scale-to-zero` | `true` ou `false`. Computação cobrada por requisição que para quando ociosa, ao custo de um cold start |
| `--db-mode` | `shared` (cluster compartilhado em pool) ou `dedicated` (um exclusivo para este projeto) |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory`, `--storage` | Por instância de banco de dados. Vazio significa `500m`, `2Gi` e o volume padrão |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio segue o padrão da plataforma e muda quando o padrão muda.

Nada é validado pela CLI, de forma proposital — os limites pertencem ao cluster em que o projeto é executado e variam entre provedores. O plano de controle recusa qualquer valor que não consiga atender e indica o campo correspondente. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; as alterações entram em vigor imediatamente, calculadas proporcionalmente a partir de hoje, com exceção daquelas que reiniciam o banco de dados, que aguardam uma janela de manutenção.

## O restante da interface de comandos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami` | Sua sessão |
| `link`, `unlink`, `use`, `open` | Vinculação deste diretório a um projeto, seleção de uma organização, abertura do console |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicação e monitoramento |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo |
| `status`, `metrics`, `debug` | O que está fazendo e por que não está funcionando |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação |
| `db` | Conectar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `clusters` | Os clusters onde os tenants executam. Apenas para administradores da plataforma |
| `settings`, `orgs`, `webhooks`, `billing` | Configurações do projeto, organizações, deploy hooks, pagamento |

Cada grupo nessa tabela responde ao `--help` com uma página própria — uma linha de uso, suas flags e exemplos — e `--help` nunca executa o comando. Um teste valida o índice dessas páginas, portanto um grupo adicionado sem uma página falha a compilação em vez de responder com o índice geral. O comando `verify:docs` valida a própria tabela em relação a esse índice: todo grupo despachado pela CLI aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha também falha a compilação.

Em um pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos como uma estrutura legível em vez de sessenta linhas de sequências de escape do terminal.

## O que o beta não inclui

Explicado de forma direta, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo é executado em uma única região hoje. O modelo de posicionamento existe na plataforma, mas um projeto não pode escolher uma região. `projects create --provider` e `--region` não são a exceção que parecem ser: eles registram a qual dos alvos de deploy registrados do plano de controle um projeto pertence, e existe apenas um, portanto ambos adotam esse padrão e nenhum dos dois move o projeto para outro lugar. `rebase cloud projects create --help` indica o mesmo.
- **Não é autosserviço (self-serve).** O acesso é concedido em lotes; não há opção de se cadastrar e pagar diretamente.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de algum deles, informe ao solicitar acesso em vez de presumir que estão disponíveis.
- **Sem deploys de pré-visualização (preview) ou de branch**, e sem GitHub App oficial. Deploy hooks — URLs secretas para as quais você aponta o webhook de um repositório — são a automação com suporte.
- **O CI necessita de credenciais humanas.** Ainda não existe token de máquina; `rebase cloud login` requer um e-mail e uma senha. Passe-os como `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um cofre de segredos — `--password` coloca a senha no histórico do seu shell e na tabela de processos, alertando sobre isso antes de fazer o login.
- **Point-in-time recovery é exclusivo da CLI.** O console exibe backups; o fluxo de trabalho de PITR em etapas é feito via `rebase cloud db pitr`.
- **Sem endpoint público para o banco de dados.** Um banco de dados gerenciado não fica exposto à internet, de modo que o host exibido pelo console é o endereço que seu backend utiliza para acessá-lo e não resolve para nada na sua máquina. O comando `rebase cloud db connect` abre uma porta local conectada a esse banco de dados, tunelada pelo plano de controle, enquanto você a mantiver em execução — mas não existe um hostname permanente ao qual um serviço de terceiros possa se conectar. Esse túnel e a senha revelada por `rebase cloud db info --reveal` exigem a função (role) de owner ou admin da organização: a mesma exigida pelo editor SQL do Studio, pois os três acessos terminam em uma sessão sobre os seus dados de produção.

## Auto-hospedagem como alternativa

Nada aqui causa aprisionamento tecnológico (vendor lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa exatamente a mesma imagem e o mesmo bundle com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.

---
