---
title: Implementando Rebase no Fly.io
description: Aprenda a implementar o Rebase globalmente ou a restringi-lo a centros de dados europeus usando o Fly.io.
sidebar_label: Fly.io
---

Fly.io permite hospedar contêineres Docker perto dos seus usuários através da sua rede global anycast. Fly é altamente configurável em relação ao roteamento de dados, tornando-o uma excelente escolha para implementar aplicações Rebase com um foco rigoroso em dados europeus.

Fly.io possui centros de dados em **Amsterdã (ams)**, **Frankfurt (fra)**, **Madri (mad)** e **Paris (cdg)**. 

## 1. Inicializar a Aplicação Fly
Do seu repositório local do Rebase, após garantir que o Fly CLI (`flyctl`) esteja instalado, execute:

```bash
fly launch
```

1. **Nome da Aplicação:** `my-rebase-app`
2. **Organização:** Pessoal ou a sua Org. corporativa.
3. **Região:** Quando solicitado por uma região, escolha explicitamente um centro de dados europeu, como **Frankfurt (fra)** ou **Paris (cdg)**.
4. **Base de Dados:** Quando solicitado para configurar uma base de dados Postgres, diga **Sim**. O Fly criará automaticamente um cluster Postgres na *mesma região* e injetará de forma segura a `DATABASE_URL` na sua aplicação.
5. **Redis:** Diga **Não**.

*Não implemente ainda quando solicitado.* Precisamos definir uma variável de ambiente crítica primeiro.

## 2. Definindo o Segredo JWT
Antes que sua aplicação entre em produção, você deve injetar o Segredo JWT para que o Rebase possa assinar com segurança as operações de tokens de autenticação.

Execute o seguinte comando localmente:
```bash
fly secrets set JWT_SECRET=your_super_long_randomly_generated_secure_string -a my-rebase-app
```

## 3. Validar Configuração Interna
O Fly terá gerado um arquivo `fly.toml` na raiz do seu projeto. Verifique se a porta interna se alinha explicitamente com a configuração padrão do Rebase (`3001`):

```toml
# fly.toml
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3001 # Make sure this matches your Hono app port
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
```

## 4. Implementar

Os seus dados estão localizados, a sua base de dados está provisionada e os seus segredos estão injetados. Inicie a implementação:

```bash
fly deploy
```

Assim que a análise e o upload forem concluídos, sua aplicação ficará online automaticamente. Execute `fly open` para visualizar sua aplicação implementada no navegador!

---
