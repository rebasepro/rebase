---
sourceHash: 6a1d65000e50846a
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se vincula e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e abre em lotes. [Solicite acesso](https://rebase.pro/pricing).

Ele não é de autoatendimento, portanto os comandos abaixo precisam de uma conta que foi liberada. Todo o restante neste site funciona sem uma.
:::

## O que é

Um **projeto** Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são um upload de bundle, não um build de container |
| **Banco de dados** | Um PostgreSQL gerenciado, com backups automatizados e point-in-time recovery |
| **Armazenamento** | Um bucket próprio, se o seu projeto usar armazenamento de arquivos |

O app e o banco de dados são provisionados no seu primeiro deploy; um bucket somente quando você solicitar um ([Armazenamento de arquivos](#armazenamento-de-arquivos)). Cada um é faturado pelo que reserva, em vez de por usuário.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a rota de escape é real: o `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime seja executada.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O `login` abre o console no seu navegador e exibe um código curto. Verifique se o console mostra o mesmo código e aprove o login lá: o terminal captura a sessão e a grava em `~/.rebase/credentials.json`. Se você não estiver logado no console, faça login lá primeiro com o método que preferir, incluindo Google e GitHub. Via SSH, `rebase cloud login --no-browser` exibe o link para abrir em sua própria máquina.

O `projects create` não recebe argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal, eles são solicitados interativamente, e uma execução headless que omita qualquer um deles é encerrada com `input_required` em vez de inventar um valor. **O subdomínio não pode ser editado posteriormente:** é o host `<slug>.rebase.website` no qual o projeto responde, portanto, escolha-o com atenção.

O `--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma etapa de `link` separada. Ele grava o arquivo `.rebase/cloud.json`, que armazena o id e o slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado com o código, de modo que um repositório clonado pode apontar para qualquer plano de controle. Quando o host provém apenas desse arquivo, e não é o da própria plataforma nem um no qual você já tenha feito login anteriormente, o `login` informa o nome e pergunta antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login intencionalmente.

Para fazer login sem o navegador, informe seu e-mail: `rebase cloud login --email me@example.com` solicita sua senha. **Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não tem senha, portanto use um código em vez disso:

```bash
rebase cloud login --code --email me@example.com
```

O plano de controle envia por e-mail um código de 6 dígitos, válido por dez minutos, e você o digita no prompt. Com `--email` e sem senha, o `rebase cloud login` pergunta se você deseja usar sua senha ou um código. Os códigos exigem que o plano de controle seja capaz de enviar e-mails; se não puder, o `--code` avisa e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do seu app autenticador ou um dos seus códigos de recuperação, independentemente de como você fez login. Pelo navegador, o console solicita isso ao fazer login lá. Nem o código de login nem o segundo fator podem ser digitados sem um terminal. Para um script, crie um token de acesso no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta retorna `invalid_credentials` com as mesmas duas opções de entrada, já que a causa mais comum é uma conta que nunca teve senha.

O `billing setup` vincula um cartão à organização, uma única vez. Ele está propositalmente em primeiro lugar na sequência: o primeiro deploy de um projeto é recusado sem um cartão, e descobrir isso depois que o upload do bundle terminou seria a pior ordem possível.

Depois disso, a página de **Billing** do console lista as faturas da organização, cada uma com a página hospedada da Stripe e o PDF, e exibe a prévia da próxima fatura de cada projeto. Os comandos `rebase cloud billing invoices` e `rebase cloud billing upcoming` exibem as mesmas informações. Ambos são destinados aos proprietários e administradores da organização. Onde a plataforma disponibiliza, **Manage billing** abre o portal de clientes da Stripe para gerenciar o cartão, os dados de faturamento e as faturas anteriores.

Com um cartão já registrado, criar outro projeto no console não exige um segundo pagamento: o projeto é cobrado nesse cartão e implantado. Se o cartão for recusado ou o banco exigir a confirmação do pagamento, o console levará você para **Billing**, onde **Fix your card** salva outro cartão e **Complete the payment** abre a fatura da Stripe.

O que um projeto consumiu é exibido em sua visão geral, em **Usage this month**, e para todos os projetos de uma só vez na página de **Billing**: requisições em relação à cota incluída (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento e qual será a projeção para o mês nesse ritmo. O excedente é calculado pelo mesmo código que o reporta à Stripe, portanto é o que constará na fatura; ele aparece na fatura do mês seguinte. `rebase cloud usage` exibe o mesmo, e `rebase cloud usage org` para toda a organização. Qualquer membro pode visualizar. Os números indicam o que ainda não conseguem medir: o armazenamento de objetos não é medido, portanto nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de app, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um projeto com escalonamento automático também mostra os pods executados acima de `--replicas`, em pod-horas, o custo nas suas próprias tarifas e se a plataforma já os cobra. Um projeto resgatado a partir de um agente conta apenas os dias a partir do resgate em diante: antes disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem precisar criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando, sem nenhuma flag para memorizar. O `rebase.json` de um scaffold declara `runtime: "managed"` para o seu backend, e o `deploy` lê essa declaração — ele avisa durante o processo (`rebase.json declares runtime: managed — deploying a bundle`), compila o app em `dist-bundle`, faz o upload do bundle, o executa na imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona de forma autônoma no CI.

Ele finaliza informando onde cada app agora responde e se a nova versão está ativa lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o `/health` de um backend retornou `ok`, e a página de um app estático carregou (a partir deste deployment, quando a plataforma o serve). A verificação aguarda até `--live-timeout` segundos, sendo 60 por padrão; `0` a ignora. Se um app não responder a tempo, o deploy ainda assim termina com código zero, porque a implantação foi bem-sucedida, e a última linha informa qual app não respondeu e o motivo. Um deploy com falha termina em uma linha, indicando o app e o motivo, com `rebase cloud logs` para o log completo de build.

Scripts podem passar `--json` para obter um único objeto contendo os mesmos fatos — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id do deployment. Diferente do restante do `rebase cloud`, o `deploy` não alterna para JSON automaticamente quando redirecionado via pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de corpo (body), sistema de arquivos, segredos, armazenamento e rede de saída — está detalhado em sua própria página: [Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

Para implantar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e faz deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais solicita isso: um build que moveria um projeto gerenciado para uma imagem de container da qual ele próprio passe a ser responsável é recusado até que você determine explicitamente. O `--force` costumava significar isso, o que colocava a ação menos reversível da CLI sob a mesma palavra que "sobrescrever este arquivo"; agora é uma opção desconhecida em vez de um alias, portanto um script que a utilize será interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando seu `build` apenas copia scripts escritos manualmente para o `output`, nada os analisou, e um arquivo com um erro de digitação vai para produção e impede o carregamento da página. Portanto, antes que qualquer coisa seja enviada, o `deploy` analisa cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso cobre tanto um app estático implantado isoladamente quanto apps estáticos integrados ao bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que o navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` que não seja JavaScript, um `<script src>` e scripts que ainda contenham marcações de template não renderizadas como `{{ }}`. Um arquivo `.js` é aprovado se for analisado com sucesso como um script clássico ou como um módulo, pois a página é quem decide. Nada dentro de `node_modules` é lido, e um `--bundle-dir` pré-compilado também não é. O `--no-verify` pula essa verificação em um deploy específico.

Acompanhe:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

O `status` relata `blockedOn` e `nextAction`. Quando `blockedOn` é `null`, a plataforma está genuinamente trabalhando e fazer polling é o procedimento correto; quando indica algo, esse algo está esperando por você.

Um deles é `email_not_configured`: o app ativou login por magic link ou código por e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) e não possui serviço de e-mail, portanto o deploy está ativo, mas ninguém consegue fazer login. O Rebase Cloud não envia e-mails pelo seu app: configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` com `rebase cloud env set` e depois faça o deploy. O `status` lê isso a partir do próprio `GET /api/auth/config` do app (seu campo `unavailable`), e o `deploy` informa o mesmo em sua verificação de disponibilidade (live check).

## Armazenamento de arquivos

Um novo projeto não tem bucket: uploads são recusados com `501 STORAGE_NOT_CONFIGURED`, e o resumo do deploy avisa isso, em vez de gravar em um disco que cada deploy substitui.

Forneça um de dois tipos, depois faça deploy novamente para que o app o reconheça:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

O `rebase cloud storage` lista os buckets do projeto. Um projeto com múltiplos buckets anexa cada um com `--source <key>`; um que configure o armazenamento via código não precisa de nenhum dos dois.

## Visualizar uma alteração em preview

```bash
rebase cloud deploy --preview
```

Isso compila e envia exatamente o que o `deploy` enviaria, mas serve em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que já servia antes. O deploy exibe o endereço do preview quando o build termina.

Para manter o mesmo endereço entre deploys, dê um nome ao preview. Fazer deploy com o mesmo nome novamente o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** gera o preview do backend, com seus apps estáticos integrados, da mesma forma que a produção os executa. Ele recebe um backend próprio em um **banco de dados vazio próprio**, nunca o de produção. Inicializar contra o banco de produção aplicaria o schema e as regras de acesso do preview a ele.
- **`rebase cloud deploy web --preview`** geraria o preview de um app estático isolado, com suas páginas chamando o backend de **produção**. Isso exige um plano de controle que sirva sites estáticos por conta própria, e o Rebase Cloud ainda não faz isso: ele recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça o preview do backend, que serve os apps estáticos integrados a ele; um projeto sem backend gerenciado ainda não pode ser visualizado em preview.

Um preview não faz upload de código-fonte nem registra apps ou hostnames, pois cada um deles alteraria o projeto de produção. `--source` e `--eject` não podem ser combinados com `--preview`. Cada um deles cria uma imagem de container para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

O `rebase cloud logs` sem `--preview` é sempre o de produção.

A página de **Deployments** do console lista os mesmos previews e permite abrir, visualizar o log de build ou excluir cada um deles. A criação continua sendo uma etapa via CLI.

Um preview expira uma semana após o último deploy realizado nele.

Ao terminar, o deploy verifica se o endereço do preview responde, da mesma forma que um deploy de produção faz (`--live-timeout <seconds>`, `0` para ignorar). O certificado de um novo preview pode levar um ou dois minutos, de modo que um deploy bem-sucedido pode relatar que o endereço ainda não está respondendo.

Um preview de backend é faturado como uma unidade de app no tamanho padrão (100m de CPU e 384 MiB de memória, na taxa do seu app para a região e capacidade dele), proporcional pelo tempo em que existir, e aparece na estimativa mensal do projeto no console. O `rebase cloud deploy --preview` exibe a mesma estimativa mensal para ele (`cost` sob `--json`). Iniciar um preview exige um cartão registrado, assim como um deploy de produção. Um primeiro deploy que falhar antes de qualquer coisa executar é removido em vez de faturado. Um projeto pode executar até três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio do Let's Encrypt, que permite 50 novos certificados por semana para um domínio, compartilhados com todos os sites de produção nele. Previews podem utilizar até 20 deles a cada 7 dias, em toda a plataforma. Ultrapassado esse limite, um novo preview é recusado (`429`, `preview_cert_budget`) com a indicação de quando poderá ser implantado; reimplantar um preview existente nunca consome essa cota.

O banco de dados de um preview de backend é um segundo banco no Postgres de **produção**: dados próprios, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, para que os previews não esgotem as conexões de produção, e a 2 GB: um preview cujo banco ultrapasse esse tamanho é pausado. Seu backend é interrompido, seu endereço para de responder, o `rebase cloud previews` e o console o mostram como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até que expire. Faça deploy novamente para iniciá-lo (ele será pausado de novo enquanto o banco continuar grande demais) ou exclua-o. Um preview pausado continua sendo faturado até ser excluído ou expirar. Exclua os previews de que não precisa mais. As extensões instaladas na produção não são instaladas no banco de dados de um preview.

Os previews estão sendo disponibilizados gradualmente. Um plano de controle que ainda não os atenda recusa `--preview` com `previews_unavailable` e não faz deploy de nada.

## Fazer rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que uma implantação bem-sucedida anterior entregou, sem nunca recompilar — o valor de um rollback é que ele entrega um artefato que já foi executado.

Quais deployments estão qualificados depende de como o projeto é implantado, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem que esse build publicou |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle entregue por esse deploy, na versão de runtime que o projeto está executando agora |

Apps estáticos integrados ao bundle do backend (um `rebase cloud deploy` comum em um projeto com backend) fazem parte desse bundle, portanto revertem junto com ele.

Um app estático implantado isoladamente (`rebase cloud deploy <app>`) ainda não pode ser revertido via rollback. Seu deployment registra qual app foi publicado, mas nenhum bundle, então o plano de controle não tem de onde restaurá-lo. A solução é fazer deploy da última versão funcional novamente, por exemplo a partir do commit anterior ao problemático. Após um deploy desse tipo, o `deploy` informa isso em vez de indicar o `rollback`, e um `rollback` sem ID recusa a operação em vez de reimplantar o backend que está em execução.

Portanto, um rollback precisa de um deployment que tenha registrado uma das duas coisas, o que significa um projeto que já teve deploy bem-sucedido pelo menos duas vezes. O `rebase cloud deployments` marca os que se qualificam, e `--json` relata `rollbackable` por linha juntamente com a `image` ou `bundle` que seria restaurado.

Dois tipos de deployment são recusados, e a CLI indica qual: um que não foi bem-sucedido e outro anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há o que adivinhar em nenhum dos casos — tentar adivinhar publicaria o que foi compilado ou enviado mais recentemente alegando restaurar este —, portanto, faça o deploy da versão desejada diretamente.

Todo deploy bem-sucedido termina indicando o caminho de volta (`rebase cloud rollback`), ficando visível no momento em que uma versão com problemas for notada.

Um rollback adiciona um novo deployment em vez de voltar o histórico no tempo, e aguarda a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, a partir de **Database → Backups** no console ou com a CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo ocorre em duas etapas. Primeiro, uma cópia recuperada é preparada ao lado do banco de dados ativo; seu app continua rodando no banco ativo, e o armazenamento da cópia é faturado até que você faça o cutover ou a descarte.
Depois, quando a cópia estiver pronta, o cutover reaponta o app para ela e o reinicia. Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados original é mantido como caminho de retorno e continua faturando armazenamento; reverter para ele, removê-lo ou fazer uma segunda restauração requer contato com o suporte. Apenas um proprietário ou administrador pode preparar, fazer cutover ou descartar, e o console solicita o nome do projeto antes de realizar o cutover.

## Proteja sua conta

Sua conta do console pode acessar bancos de dados de produção, segredos e faturamento, portanto proteja-a adequadamente. Abra **Account security** no menu sob seu avatar no console (ou acesse `/account`). A página é sua, não de uma organização: o que você configurar ali se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao app, ou um link que abre o app com a chave preenchida no celular, e em seguida solicita o código de 6 dígitos exibido no app. A partir de então, todo login solicitará um código, quer você entre com senha, Google ou GitHub.
- **Códigos de recuperação.** A ativação fornece dez códigos de uso único, exibidos apenas uma vez. Cada um deles permite fazer login no lugar do código do autenticador caso você perca seu telefone, portanto salve-os antes de fechar a caixa de diálogo. **New recovery codes** os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas e gerar novos códigos exigem a confirmação de um código primeiro.
- **Senha.** Alterá-la desconecta você em todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não possui senha; a página oferece o envio de um link por e-mail para definir uma.
- **Dispositivos conectados.** Todos os navegadores e terminais conectados à sua conta, com seu respectivo endereço e quando se conectaram. Desconecte qualquer dispositivo que não reconhecer, ou todos de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo fator, permitindo que o CI continue fazendo deploys após a ativação. Revogue tokens em que não confiar mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Add member** adiciona alguém que já possua uma conta no Rebase com endereço de e-mail verificado, como admin ou member; um proprietário pode torná-lo proprietário depois. Eles passam a ter acesso imediatamente e nada é enviado por e-mail. O Rebase Cloud ainda não envia convites, portanto peça a um colega de equipe sem conta que se cadastre e verifique seu endereço primeiro. A partir do terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que avisa caso o endereço não tenha uma conta.

## Veja quem fez o quê

A página de **Activity** do console e o comando `rebase cloud activity` mostram aos proprietários e administradores da organização quem fez deploy, definiu ou revelou uma variável de ambiente (pelo nome, nunca pelo valor), alterou um domínio, restaurou um backup, redimensionou, interrompeu ou excluiu um projeto, alterou a função de um membro ou criou um token, e quando isso ocorreu. As **Settings** de um projeto fornecem links para suas próprias entradas; entradas sobre projetos excluídos permanecem salvas. Um script pode lê-las com um token criado com `--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token restrito a algumas ações em um único projeto, criado a partir de um terminal autenticado com `rebase cloud tokens create --project shop --can deploy,logs`, e defina-o como `REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação de uma organização são permissões próprias (`--can billing`, `audit`, `notifications`) que um token só possui se solicitado expressamente. As permissões, um fluxo de trabalho do GitHub Actions e o que permanece restrito a um usuário autenticado estão em [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

O `rebase cloud init --claim` fornece a um app um backend ativo antes que qualquer pessoa tenha se cadastrado, e exibe uma URL de resgate para que a pessoa possa mantê-lo; um projeto que ninguém resgatar em até 72 horas é excluído. O que o token de um projeto não resgatado pode fazer, o `REBASE_API_TOKEN` que ele grava e o que o resgate altera estão em [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação e quanto custa

O preço de um projeto é calculado a partir do que ele reserva, não a partir de um plano. O comando `compute` exibe todos os parâmetros e o orçamento detalhado do próprio plano de controle para eles. (`rebase cloud resources` é algo diferente: os bancos de dados e buckets que o código declara, e se cada um está provisionado — veja a [Referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma, que depende da região (abaixo) |
| `--replicas` | Instâncias que sempre existem: o piso do escalonador automático e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que ele pode atingir. Instâncias que o escalonador automático adiciona acima de `--replicas` são cobradas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma tiver ativado isso; **Usage this month** indica isso. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o escalonador automático mantém, em relação à solicitação e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio segue o padrão da plataforma e muda quando este mudar.

Na Bélgica (europe-west1), o padrão reserva 100m de CPU e 384Mi e pode atingir picos de até 2 CPU e 2 GiB; em Falkenstein e Helsinki, a memória pode se estender até 1,4× a solicitação e a CPU até 10× (no máximo 1,7 vCPU). `rebase cloud compute` exibe os números do seu projeto.

Nada é validado pela CLI, propositalmente — os limites pertencem ao cluster no qual o projeto é executado e variam entre provedores. O plano de controle recusa qualquer valor que não possa atender e informa o campo. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; as alterações entram em vigor imediatamente, calculadas proporcionalmente a partir de hoje. Uma alteração no banco de dados entra em vigor imediatamente; cobrada no tamanho atual até estar em execução. Uma nova CPU ou memória para o banco de dados, ou menos instâncias, reinicia o banco (cerca de 30 segundos a 3 minutos; as conexões são encerradas e reconectadas): o `compute set` avisa isso e pede confirmação; fora de um terminal, `--yes` é o consentimento. Se esse reinício falhar, `rebase cloud compute apply` tenta novamente.

## O restante dos recursos

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` exibe o bearer token que a CLI enviaria agora, para scripts e o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude o alcance ao lado dos seus projetos Cloud. `--list` mostra-os, `--remove` remove um. Apenas proprietários e administradores |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para resgatá-lo; `claim` exibe esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicação e monitoramento |
| `deploy-hooks` | URLs secretas que um provedor git ou CI chama para fazer o deploy do projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Builds servidos em endereço próprio por `deploy --preview`, e sua exclusão. Consulte [Visualizar uma alteração em preview](#visualizar-uma-alteração-em-preview) |
| `sleep` | Hibernar quando ocioso: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` e `status` (o padrão). Hibernando, um projeto não consome CPU ou memória e a próxima requisição o desperta; tarefas agendadas e trabalho em segundo plano não são executados nesse ínterim. Onde um projeto não puder hibernar, o plano de controle recusa e explica o motivo |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura, a menos que a plataforma cobre projetos interrompidos apenas pelo armazenamento e pela taxa da plataforma; a linha de **Billing** do console indica quando for o caso |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que não está |
| `alerts` | Os incidentes abertos do projeto, além de confirmar ou silenciar um deles. |
| `cron` | Os cron jobs do app implantado e suas execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `app-key` | A chave que `init --claim` gravou no `.env` como `REBASE_API_TOKEN`, transferida no momento do resgate; `rotate` a substitui e revoga a antiga. Apenas proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` fornece uma nova ao app. Apenas proprietários e administradores |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em vários, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual agir, que só pode ser omitido se houver apenas um (para `verify`, um ainda pendente). Cada domínio verificado serve o projeto como ele mesmo; `primary <domain>` seleciona o canônico e `redirect <domain>` responde outro com um redirecionamento 308 para ele, mantendo caminho e query (`--off` volta a servi-lo) — faça isso para `www.` ao lado de um apex, já que o login do Google, cookies e passkeys são por origem. Um domínio no qual um app é servido (um `path` de app com hostname) nunca redireciona. Um domínio apex (`example.com`, sem subdomínio) requer um registro **A**, pois o DNS não permite CNAME nele. Esse endereço é o ingress da plataforma e não há garantia de que permanecerá o mesmo: se a plataforma mudar de local, o registro A continuará apontando para o endereço antigo. Caso seu provedor de DNS ofereça ALIAS, ANAME ou CNAME flattening no apex, aponte o apex para o `tenantHost` do projeto, que acompanha a plataforma. O CNAME de um subdomínio já o acompanha automaticamente. `list` exibe `verified, certificate pending` até que o HTTPS responda com um certificado real. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Conectar ou criar um banco de dados, conectar-se a ele a partir de sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Os usuários convidados deixados pelo login anônimo: contar, excluir um, remover os que não são vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Apenas proprietários e administradores |
| `extensions` | A lista de permissões de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em comparação com o que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu com o backend, do mais recente para o mais antigo: escalonamento do app, alterações de banco agendadas e aplicadas, um standby assumindo, o disco aumentando |
| `usage` | Requisições utilizadas este mês em relação à cota incluída e o excedente até agora, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters onde os tenants são executados. Apenas administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações e seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Apenas proprietários e administradores. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso, suas flags e exemplos — e o `--help` nunca executa o comando. Um teste mantém o índice para as páginas, portanto um grupo adicionado sem uma página falha a compilação em vez de responder com o índice. O `verify:docs` vincula a própria tabela a esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha também falhará o build.

Quando redirecionado via pipe, o `--help` responde em JSON: a mesma linha de uso, flags e exemplos estruturados para leitura em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Sem escolha de região, sem cadastro por autoatendimento, sem SLA publicado, sem deploys de branch, tokens que atuam como pessoa e sem endpoint público de banco de dados. [O que o beta não inclui](/docs/deployment/cloud-beta-limits/) explica cada um deles com clareza, junto com o significado de fazer deploy com os segredos de produção.

## Auto-hospedagem como alternativa

Nada aqui gera lock-in. O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a mesma imagem e o mesmo bundle com `docker compose`, e o [guia do Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.
