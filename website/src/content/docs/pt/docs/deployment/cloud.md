---
sourceHash: 932f7373eaaf4e2e
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se vincula e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele já executa tenants reais hoje e abre em lotes. [Request access](https://rebase.pro/pricing).

Ele não é self-service, portanto os comandos abaixo exigem uma conta autorizada. Todo o restante deste site funciona sem uma.
:::

## O que é

Um **projeto** no Cloud é composto por três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são um upload de bundle, não o build de um container |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e point-in-time recovery |
| **Storage** | Um bucket próprio, caso seu projeto utilize armazenamento de arquivos |

Cada um é provisionado no seu primeiro deploy, e cada um é cobrado pelo que reserva, em vez de por usuário (seat).

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a rota de escape é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir de um diretório de projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre o console no seu navegador e exibe um código curto. Verifique se o console mostra o mesmo código e aprove o login lá: o terminal captura a sessão e a grava em `~/.rebase/credentials.json`. Se não estiver conectado ao console, faça login lá primeiro com o que você preferir usar, incluindo Google e GitHub. Via SSH, `rebase cloud login --no-browser` exibe o link para abrir em sua própria máquina.

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal eles serão solicitados, e uma execução headless que omitir qualquer um deles é encerrada com `input_required` em vez de inventar um. **O subdomínio não pode ser editado posteriormente:** ele é o host `<slug>.rebase.website` no qual o projeto responde, portanto, escolha-o com atenção.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma etapa de `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que registra o ID e o slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado junto com o código, portanto, um repositório clonado pode apontar para qualquer control plane. Quando o host vem apenas desse arquivo e não é o da própria plataforma nem um no qual você já tenha feito login anteriormente, o `login` informa o nome dele e pede confirmação antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login lá intencionalmente.

Para fazer login sem o navegador, passe seu e-mail: `rebase cloud login --email me@example.com` solicitará sua senha. **Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não tem senha, portanto use um código em vez disso:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia um código de 6 dígitos por e-mail, válido por dez minutos, e você o digita no prompt. Com `--email` e sem senha, o `rebase cloud login` pergunta se você deseja usar sua senha ou um código. Os códigos exigem que o control plane seja capaz de enviar e-mails; se não puder, o `--code` avisa e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente de como você fez login. Pelo navegador, o console solicita o código ao fazer login lá. Nem um código de login nem um segundo fator podem ser digitados sem um terminal. Para um script, crie um token de acesso no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials`, oferecendo as mesmas duas formas de entrada, já que a causa comum é uma conta que nunca teve senha.

`billing setup` vincula um cartão à organização uma única vez. Ele vem primeiro na sequência de propósito: o primeiro deploy de um projeto é recusado sem isso, e descobrir isso após o upload do bundle ter terminado é a pior ordem.

Depois disso, a página **Billing** do console lista as faturas da organização, cada uma com a página hospedada e o PDF da Stripe, e exibe uma prévia da próxima fatura de cada projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` exibem o mesmo. Ambos são destinados aos proprietários e administradores da organização. Onde a plataforma oferecer essa opção, **Manage billing** abre o portal do cliente da Stripe para gerenciar o cartão, os dados de faturamento e faturas anteriores.

Com um cartão já registrado, criar outro projeto no console não exige um segundo pagamento: o projeto é cobrado nesse cartão e o deploy é feito. Se o cartão for recusado ou o banco exigir confirmação do pagamento, o console redireciona você para **Billing**, onde **Fix your card** salva outro cartão e **Complete the payment** abre a fatura da Stripe.

O que um projeto consumiu é exibido na sua visão geral, em **Usage this month**, e para todos os projetos de uma vez na página **Billing**: requisições em relação à cota inclusa (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento e a projeção para o mês nesse ritmo. O excedente é calculado pelo mesmo código que o reporta à Stripe, portanto é exatamente o que virá na fatura; ele aparece na fatura do mês seguinte. `rebase cloud usage` exibe o mesmo, e `rebase cloud usage org` exibe o de toda a organização. Qualquer membro pode visualizar. Os números indicam o que ainda não conseguem medir: o armazenamento de objetos não é medido, portanto nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de aplicação, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um projeto com autoscaling também exibe os pods executados acima de `--replicas`, em pod-horas, quanto custaram em suas próprias tarifas e se esta plataforma já os está cobrando. Um projeto reivindicado a partir de um agente contabiliza apenas os dias a partir da reivindicação: antes disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando e nenhuma flag para memorizar. O `rebase.json` de um scaffold declara `runtime: "managed"` para seu backend, e o comando `deploy` lê essa declaração — avisando no processo (`rebase.json declares runtime: managed — deploying a bundle`), compila a aplicação em `dist-bundle`, faz o upload do bundle, o executa na imagem de runtime publicada e acompanha o deployment até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona sem intervenção em CI.

Ele termina informando onde cada app responde agora e se a nova versão está ativa (live) lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o `/health` de um backend retornou `ok`, e a página de uma app estática carregou (deste deployment, quando a plataforma o serve). A verificação aguarda até `--live-timeout` segundos, 60 por padrão; `0` pula a verificação. Se uma aplicação não responder a tempo, o deploy ainda assim termina com código zero, porque o deployment foi bem-sucedido, e a última linha informa qual app não respondeu e o motivo. Já um deploy com falha termina em uma única linha, indicando a aplicação e o motivo, com `rebase cloud logs` para o log completo de build.

Scripts passam `--json` para receber um único objeto contendo as mesmas informações — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o ID do deployment. Diferente do restante do `rebase cloud`, o `deploy` não alterna automaticamente para JSON quando usado com pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de body, sistema de arquivos, segredos, armazenamento e rede de saída — está em sua página própria: [Managed backend runtime](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e faz deploy duas vezes — aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais a solicita: um build que migraria um projeto gerenciado para uma imagem de container que ele próprio gerencia é recusado até que você determine isso expressamente. Antigamente, `--force` significava isso, o que colocava a ação menos reversível da CLI sob a mesma palavra que "sobrescrever este arquivo"; hoje é uma opção desconhecida em vez de um alias, portanto qualquer script que a utilize é interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de uma app estática são servidos exatamente como estão. Quando seu `build` apenas copia scripts escritos à mão para `output`, nada fez o parse deles, e um arquivo com um erro de digitação pode ir para produção e impedir o carregamento da página. Portanto, antes que qualquer coisa seja enviada, o `deploy` faz o parse de cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estática, juntamente com cada `<script>` inline nos seus arquivos `.html`. Isso cobre tanto uma app estática implantada individualmente quanto apps estáticas incorporadas ao bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` que não seja JavaScript, um `<script src>`, e um script que ainda contenha marcação de template não renderizada, como `{{ }}`. Um arquivo `.js` é aprovado se fizer o parse tanto como um script clássico quanto como um módulo, já que a página decide qual deles usar. Nada sob `node_modules` é lido, e o mesmo vale para um `--bundle-dir` pré-compilado. `--no-verify` pula essa verificação para um deploy específico.

Acompanhe a execução:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

O comando `status` informa `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está genuinamente trabalhando e fazer polling é a atitude correta; quando indicar algo, esse algo está esperando por você.

Um desses casos é `email_not_configured`: a aplicação ativou o login por magic link ou código de e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) e não possui serviço de e-mail configurado; assim, o deployment está no ar, mas ninguém consegue fazer login. O Rebase Cloud não envia e-mails pela sua aplicação: defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` com `rebase cloud env set` e, em seguida, faça o deploy. O `status` lê isso a partir do próprio `GET /api/auth/config` da aplicação (no campo `unavailable`), e o `deploy` informa o mesmo em sua verificação de live check.

## Pré-visualizar uma alteração

```bash
rebase cloud deploy --preview
```

Isso compila e faz o upload exatamente do que o `deploy` faria, mas disponibiliza o conteúdo em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que servia antes. O deploy exibe o endereço do preview quando o build termina.

Para manter um único endereço entre deploys, dê um nome ao preview. Fazer o deploy com o mesmo nome novamente o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** gera o preview do backend, com suas apps estáticas incorporadas, da mesma forma que a produção as executa. Ele recebe um backend próprio em um **banco de dados vazio próprio**, nunca o de produção. Inicializar contra o banco de dados de produção aplicaria o esquema e as regras de acesso do preview a ele.
- **`rebase cloud deploy web --preview`** geraria a pré-visualização de uma app estática isolada, com suas páginas chamando o backend de **produção**. Isso exige um control plane que sirva sites estáticos de forma independente, o que o Rebase Cloud ainda não faz: a operação é recusada com `PREVIEW_STATIC_UNSERVED` e nada é publicado. Em vez disso, faça o preview do backend, que serve as apps estáticas incorporadas a ele; um projeto sem backend gerenciado ainda não pode ser pré-visualizado.

Um preview não faz upload de código-fonte e não registra aplicações nem hostnames, pois qualquer uma dessas ações alteraria o projeto de produção. `--source` e `--eject` não podem ser combinados com `--preview`. Cada um deles constrói uma imagem de container para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` refere-se sempre à produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o log de build ou excluir cada um deles. Criar um preview continua sendo uma etapa exclusiva da CLI.

Um preview expira uma semana após o último deploy realizado nele.

Quando termina, o deploy verifica se o endereço do preview responde, assim como faz um deploy de produção (`--live-timeout <seconds>`, `0` para ignorar). O certificado de um novo preview pode levar um ou dois minutos, portanto um deploy bem-sucedido pode indicar que o endereço ainda não responde.

Um preview de backend é faturado como uma unidade de app no tamanho padrão (100m de CPU e 384 MiB de memória, na tarifa da sua app para sua região e capacidade), proporcional ao tempo em que existir, e aparece na estimativa mensal do projeto no console. `rebase cloud deploy --preview` exibe a mesma estimativa para ele, por mês (`cost` com `--json`). Iniciar um preview exige um cartão registrado, assim como um deploy de produção. Um primeiro deploy que falhe antes de qualquer execução é removido em vez de ser faturado. Um projeto pode executar três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio da Let's Encrypt, que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de produção nele. Previews podem utilizar 20 deles a cada 7 dias em toda a plataforma. Acima disso, um novo preview é recusado (`429`, `preview_cert_budget`) informando o horário em que poderá ser implantado; reimplantar um preview já existente nunca entra nessa contagem.

O banco de dados de um preview de backend é um segundo banco de dados no Postgres de **produção**: dados próprios, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, para que os previews não esgotem as de produção, e a 2 GB: um preview cujo banco de dados ultrapassar esse limite é pausado. Seu backend para, seu endereço deixa de responder, `rebase cloud previews` e o console o exibem como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até expirar. Faça o deploy dele novamente para iniciá-lo (ele será pausado novamente enquanto o banco de dados continuar grande demais) ou exclua-o. Um preview pausado continua sendo faturado até ser excluído ou expirar. Exclua previews que você não precisa mais. Extensões instaladas em produção não são instaladas no banco de dados de um preview.

Os previews estão sendo lançados gradualmente. Um control plane que ainda não os suporte recusa `--preview` com `previews_unavailable` e não implanta nada.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que um deployment anterior bem-sucedido entregou e nunca recompila — o valor de um rollback é entregar um artefato que já foi executado.

Quais deployments se qualificam depende de como o projeto realiza deploys, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que aquele build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle que aquele deploy entregou, na versão de runtime que o projeto está executando agora |

Apps estáticas incorporadas ao bundle do backend (um `rebase cloud deploy` comum em um projeto com backend) fazem parte desse bundle, portanto revertem junto com ele.

Uma app estática implantada de forma independente (`rebase cloud deploy <app>`) ainda não pode sofrer rollback. Seu deployment registra qual app publicou, mas nenhum bundle, portanto o control plane não tem de onde restaurá-la. A solução é fazer o deploy da última versão válida novamente, por exemplo a partir do commit anterior ao problemático. Após um deploy desse tipo, o `deploy` informa isso em vez de sugerir o `rollback`, e um `rollback` sem ID recusa a execução em vez de reimplantar o backend em execução.

Portanto, um rollback necessita de um deployment que tenha registrado um dos dois, o que significa um projeto que tenha feito deploy com sucesso pelo menos duas vezes. `rebase cloud deployments` sinaliza os que se qualificam, e `--json` relata `rollbackable` por linha juntamente com a `image` ou `bundle` que restauraria.

Dois tipos de deployments são recusados, e a CLI informa quais: um que não teve sucesso e um anterior ao momento em que a plataforma começou a registrar seus artefatos. Não há adivinhações em nenhum dos casos — adivinhar enviaria o que quer que tenha sido compilado ou enviado mais recentemente alegando restaurar este —, portanto, faça o deploy da versão desejada em vez disso.

Cada deploy bem-sucedido termina indicando o caminho de volta (`rebase cloud rollback`), para que esteja à vista no momento em que uma versão com problemas for detectada.

Um rollback adiciona um novo deployment em vez de reescrever o histórico e aguarda até que a versão restaurada esteja respondendo antes de relatar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, em **Database → Backups** no console ou pela CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo ocorre em duas etapas. Primeiro, uma cópia recuperada é preparada (staged) ao lado do banco de dados ativo; sua aplicação continua rodando no banco ativo, e o armazenamento da cópia é faturado até que você realize o cutover ou a descarte.
Depois, quando a cópia estiver pronta, realizar o cutover reaponta a aplicação para ela e a reinicia. Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados original é mantido como caminho de retorno e continua faturando o armazenamento; retornar a ele, removê-lo ou fazer uma segunda restauração requer contato com o suporte. Apenas um proprietário ou administrador pode preparar, fazer o cutover ou descartar, e o console solicita o nome do projeto antes de executar o cutover.

## Proteja sua conta

Sua conta do console pode acessar bancos de dados de produção, segredos e faturamento, portanto proteja-a adequadamente. Abra **Account security** no menu sob seu avatar no console (ou acesse `/account`). A página pertence a você, não a uma organização: o que você definir lá se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um link que abre o app com a chave preenchida no celular, e em seguida solicita o código de 6 dígitos exibido no app. A partir de então, todo login solicitará um código, quer você entre com senha, Google ou GitHub.
- **Códigos de recuperação.** Ativar a verificação gera dez códigos de uso único, exibidos apenas uma vez. Cada um deles permite fazer login no lugar do código do autenticador se você perder seu telefone, portanto, salve-os antes de fechar a janela. **New recovery codes** substitui os códigos atuais, e os antigos deixam de funcionar. Desativar a verificação em duas etapas e gerar novos códigos exigem um código prévio para confirmação.
- **Senha.** Alterá-la desconecta você de todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não tem senha; a página oferece o envio de um link por e-mail para você definir uma.
- **Dispositivos conectados.** Cada navegador e terminal conectado à sua conta, com seu endereço e quando fez login. Desconecte qualquer dispositivo que não reconhecer, ou todos de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não solicitam um segundo fator, portanto o CI continua fazendo deploys normalmente depois de você ativá-lo. Revogue qualquer token em que você não confie mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Invite member** gera um link para copiar (enviado por e-mail quando este control plane tiver envio de e-mails configurado) que funciona uma única vez, durante 7 dias, para uma conta que tenha verificado aquele endereço; ninguém entra até aceitar. Convide um administrador ou membro e promova-o a proprietário após a adesão. Proprietários e administradores podem visualizar, reenviar ou revogar convites em **Pending invitations**; a partir de um terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` mostram aos proprietários e administradores da organização quem fez deploy, definiu ou revelou uma variável de ambiente (por nome, nunca por valor), alterou um domínio, restaurou um backup, redimensionou, interrompeu ou excluiu um projeto, alterou o papel de um membro ou criou um token, e quando isso ocorreu. A seção **Settings** de um projeto inclui links para suas próprias entradas; entradas sobre um projeto excluído permanecem salvas. Um script pode lê-las com um token criado com `--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token restrito a algumas ações em um único projeto, criado a partir de um terminal autenticado com `rebase cloud tokens create --project shop --can deploy,logs`, e configure-o como `REBASE_TOKEN`. As configurações de faturamento, log de atividades e notificações de uma organização são permissões próprias (`--can billing`, `audit`, `notifications`) que um token possui apenas quando solicitado. As permissões, um workflow do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão em [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` fornece a uma aplicação um backend ativo antes mesmo de qualquer cadastro, exibindo uma URL de reivindicação para que a pessoa possa mantê-lo; um projeto que ninguém reivindicar dentro de 72 horas é excluído. O que o token do projeto não reivindicado pode fazer, o `REBASE_API_TOKEN` que ele grava e o que muda após a reivindicação estão em [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Recursos computacionais e custos

O preço de um projeto é calculado pelo que ele reserva, não por um plano fixo (tier). `compute` exibe cada parâmetro e a cotação detalhada do próprio control plane para eles. (`rebase cloud resources` é algo diferente: os bancos de dados e buckets que o código declara, e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e significado |
|---|---|
| `--cpu`, `--memory` | Solicitação (request) da app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `100m` e `384Mi`, com burst para 2 CPUs e `2Gi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que pode atingir. As instâncias adicionadas pelo autoscaler acima de `--replicas` são tarifadas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma ativou essa opção; **Usage this month** indica isso. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação ao request e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor: um parâmetro vazio segue o padrão da plataforma e muda quando ela mudar.

Nada é validado pela CLI, de propósito — os limites pertencem ao cluster em que o projeto é executado e variam entre provedores. O control plane recusa valores que não pode atender e indica o campo. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; qualquer alteração se aplica imediatamente, proporcional a partir de hoje, exceto as que reiniciam o banco de dados, que aguardam uma janela de manutenção.

## O restante da superfície

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` exibe o bearer token que a CLI enviaria agora, para scripts e para o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude o alcance ao lado de seus projetos no Cloud. `--list` os exibe, `--remove` remove um. Proprietários e administradores |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` exibe esse link novamente. Consulte [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Envio e monitoramento |
| `deploy-hooks` | URLs secretas que um git host ou CI chama para fazer o deploy do projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Builds servidos em endereço próprio via `deploy --preview`, e sua exclusão. Consulte [Pré-visualizar uma alteração](#pré-visualizar-uma-alteração) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto pausado mantém sua assinatura, a menos que a plataforma cobre projetos pausados apenas pelo armazenamento e pela taxa da plataforma; a linha **Billing** do console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que está fazendo e por que não está |
| `alerts` | Incidentes abertos do projeto, bem como confirmar (acknowledge) ou adiar (snooze) um deles. |
| `cron` | Tarefas cron da app implantada e suas execuções registradas, lidas com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente escrita |
| `app-key` | A chave que `init --claim` gravou no `.env` como `REBASE_API_TOKEN`, transferida na reivindicação; `rotate` a substitui e revoga a antiga. Proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API da app: quando foi rotacionada pela última vez; `rotate` fornece uma nova à aplicação. Proprietários e administradores |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em vários, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual agir, o qual só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). Cada domínio verificado serve o projeto diretamente; `primary <domain>` escolhe o canônico e `redirect <domain>` responde em outro com um redirecionamento 308 para ele, mantendo caminho e query (`--off` volta a servi-lo normalmente) — faça isso para `www.` ao lado de um apex domain, já que login do Google, cookies e passkeys são por origem. Um domínio em que uma app específica é servida (um `path` de app com hostname) nunca redireciona. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Conectar ou criar um banco de dados, conectar-se a ele a partir de sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Usuários convidados que o login anônimo deixou para trás: conte-os, exclua um, limpe os não vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Proprietários e administradores |
| `extensions` | A lista de permissões (allowlist) de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu com o backend, do mais recente para o mais antigo: escalonamento da app, alterações de banco de dados agendadas e aplicadas, um standby assumindo, o disco crescendo |
| `usage` | Requisições utilizadas este mês em relação à cota inclusa e o excedente até o momento, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters nos quais os tenants são executados. Apenas administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações e seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e administradores. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo nessa tabela responde ao `--help` com uma página própria — uma linha de uso, suas flags e exemplos —, e `--help` nunca executa o comando. Um teste mantém o índice dessas páginas, de modo que um grupo adicionado sem uma página falha o build em vez de responder com o índice. O `verify:docs` compara a própria tabela a esse índice: cada grupo que a CLI despacha aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha também causa falha no build.

Em pipes, `--help` responde em JSON: a mesma linha de uso, flags e exemplos como uma estrutura legível em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Falando abertamente, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo é executado em uma única região hoje. O modelo de posicionamento existe na plataforma, mas um projeto não pode escolher uma região. `projects create --provider` e `--region` não são a exceção que parecem ser: eles registram a qual dos alvos de deploy registrados no control plane o projeto pertence, e há apenas um, portanto ambos adotam esse padrão e nenhum deles move o projeto para outro lugar. `rebase cloud projects create --help` informa o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há cadastro imediato com pagamento direto.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de algum deles, informe ao solicitar acesso em vez de presumir que existam.
- **Sem deploys de branch** e sem GitHub App oficial de primeira parte. Deploy hooks — URLs secretas para as quais você aponta o webhook de um repositório — são a automação suportada. Os [deploys de preview](#pré-visualizar-uma-alteração) estão sendo lançados e são iniciados pela CLI.
- **Tokens agem como uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é gerado por uma conta e atua em nome dela; ainda não há identidade de máquina pertencente à organização. Se, em vez disso, você fizer login a partir do CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um cofre de segredos — `--password` expõe a senha no histórico do shell e na tabela de processos, e alerta sobre isso antes de autenticar. Se o arquivo `.rebase/cloud.json` do repositório indicar um control plane diferente do da própria plataforma, passe-o também como `--url`: sem um terminal, o `login` recusa enviar uma senha para um host apontado unicamente pelo arquivo clonado.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não é exposto à internet; portanto, o host exibido no console é o endereço interno do seu backend para ele e não resolve para nada na sua máquina local. O comando `rebase cloud db connect` abre uma porta local que se conecta a esse banco de dados, encapsulada em um túnel através do control plane, enquanto você a mantiver em execução — mas não existe um hostname permanente ao qual um serviço de terceiros possa se conectar. Para executar SQL sem um cliente Postgres local, `rebase cloud db query "<sql>"` ou `rebase cloud db query --file file.sql` abre o mesmo túnel para uma única consulta, executa o texto como um script único (interrompendo no primeiro erro) e exibe o que cada instrução respondeu (`--json` para scripts). Esse túnel e a senha por trás de `rebase cloud db info --reveal` exigem o papel de proprietário ou administrador na organização: o mesmo que o editor SQL do Studio solicita, pois todos os três resultam em uma sessão sobre os seus dados de produção.
- **Fazer deploy é executar código com os segredos de produção.** O ambiente da aplicação contém `REBASE_SERVICE_KEY` (admin na sua própria API), `DATABASE_URL` e `JWT_SECRET`, de modo que o código implantado por qualquer membro pode lê-los, mesmo que apenas proprietários e administradores possam revelá-los no console. Convide como membro apenas pessoas a quem você confiaria esses valores.
- **A service key pode ser substituída.** A seção **Settings** do projeto (ou `rebase cloud service-key rotate`) emite uma nova `REBASE_SERVICE_KEY` e reinicia a aplicação com ela. A chave antiga funciona até que a reinicialização seja concluída e deixa de funcionar imediatamente depois, de forma que qualquer chamada que a tenha copiado será recusada a partir de então. Reivindicar um projeto faz o mesmo.

## Hospedagem própria como alternativa

Nada aqui é um lock-in. O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a imagem e o bundle idênticos com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.
