import { Router } from "express";
import { ConfigAgente } from "../config";

interface RotaDoc {
  metodo: string;
  caminho: string;
  descricao: string;
  auth: boolean;
  exemplo?: string;
}

const ROTAS: RotaDoc[] = [
  {
    metodo: "GET",
    caminho: "/status",
    descricao: "Estado da conexão, perfil ativo, porta e contagem de falhas.",
    auth: false,
    exemplo: "curl http://127.0.0.1:3333/status",
  },
  {
    metodo: "GET",
    caminho: "/weight",
    descricao:
      "Última leitura: peso, unidade, casas decimais, estabilidade e se é válida para pesagem.",
    auth: false,
    exemplo: "curl http://127.0.0.1:3333/weight",
  },
  {
    metodo: "GET",
    caminho: "/perfis",
    descricao: "Lista os perfis de balança disponíveis com configuração serial.",
    auth: false,
    exemplo: "curl http://127.0.0.1:3333/perfis",
  },
  {
    metodo: "GET",
    caminho: "/config",
    descricao: "Configuração ativa: perfil e porta.",
    auth: false,
    exemplo: "curl http://127.0.0.1:3333/config",
  },
  {
    metodo: "POST",
    caminho: "/config",
    descricao: "Troca o perfil ativo. Exige autenticação.",
    auth: true,
    exemplo:
      'curl -X POST http://127.0.0.1:3333/config -H "Content-Type: application/json" -H "x-token-local: SEU_TOKEN" -d "{\\"perfil\\":\\"toledo-2098\\",\\"porta\\":\\"COM2\\"}"',
  },
  {
    metodo: "POST",
    caminho: "/config/testar",
    descricao:
      "Testa comunicação com um perfil e porta sem alterar a configuração ativa. Exige autenticação.",
    auth: true,
    exemplo:
      'curl -X POST http://127.0.0.1:3333/config/testar -H "Content-Type: application/json" -H "x-token-local: SEU_TOKEN" -d "{\\"perfil\\":\\"toledo-2098\\",\\"porta\\":\\"COM2\\"}"',
  },
  {
    metodo: "POST",
    caminho: "/auth/login",
    descricao: "Troca o token local por um cookie HttpOnly válido por 8 horas.",
    auth: false,
    exemplo:
      'curl -X POST http://127.0.0.1:3333/auth/login -H "Content-Type: application/json" -d "{\\"token\\":\\"SEU_TOKEN\\"}"',
  },
  {
    metodo: "POST",
    caminho: "/auth/logout",
    descricao: "Apaga o cookie de sessão.",
    auth: false,
    exemplo: "curl -X POST http://127.0.0.1:3333/auth/logout",
  },
  {
  metodo: "POST",
  caminho: "/reconectar",
  descricao: "Força uma tentativa de reconexão imediata, sem esperar o backoff. Exige autenticação.",
  auth: true,
  exemplo:
    'curl -X POST http://127.0.0.1:3333/reconectar -H "x-token-local: SEU_TOKEN"',
},
  {
    metodo: "GET",
    caminho: "/auth/sessao",
    descricao: "Informa se a sessão atual está autenticada.",
    auth: false,
    exemplo: "curl http://127.0.0.1:3333/auth/sessao",
  },
  {
    metodo: "WS",
    caminho: "/weight",
    descricao:
      "Streaming de leituras e snapshots. Mensagens: { tipo: 'leitura' | 'snapshot', dados }.",
    auth: false,
    exemplo: 'const ws = new WebSocket("ws://127.0.0.1:3333/weight")',
  },
];

export function criarRotaDocumentacao(config: ConfigAgente): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      agente: "agente-balanca",
      versao: "0.1.0",
      perfilAtivo: config.perfilId,
      porta: config.porta,
      rotas: ROTAS,
    });
  });

  return router;
}