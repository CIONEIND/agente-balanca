import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GerenciadorBalanca } from "../estado/GerenciadorBalanca";
import { EstadoBalanca } from "../estado/EstadoBalanca";
import { ConfigAgente } from "../config";
import { criarRotas } from "./rotas";
import { criarRotaTela } from "./tela";
import { criarRotaDocumentacao } from "./documentacao";

const HOST = "127.0.0.1";
const PORTA_PADRAO = 3333;

export interface ServidorApi {
  fechar: () => Promise<void>;
  porta: number;
}

export function iniciarServidor(
  gerenciador: GerenciadorBalanca,
  config: ConfigAgente
): Promise<ServidorApi> {
  const porta = Number(process.env.API_PORTA ?? PORTA_PADRAO);

  const app = express();
  app.use(express.json());
  app.use(criarRotaTela());
  app.use("/docs", criarRotaDocumentacao(config));
  app.use(criarRotas(gerenciador, config));

  const servidor = http.createServer(app);
  const wss = new WebSocketServer({ server: servidor, path: "/weight" });

  const clientes = new Set<WebSocket>();

  const enviar = (ws: WebSocket, dados: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(dados));
  };

  wss.on("connection", (ws) => {
    clientes.add(ws);
    const estado = gerenciador.estadoAtual;
    if (estado) enviar(ws, { tipo: "snapshot", dados: estado.snapshot() });

    ws.on("close", () => clientes.delete(ws));
    ws.on("error", () => clientes.delete(ws));
  });

  const transmitir = (tipo: string) => (dados: unknown) => {
    for (const ws of clientes) enviar(ws, { tipo, dados });
  };

  // assinatura atual — trocada quando o perfil muda
  let estadoAssinado: EstadoBalanca | null = null;
  const aoMudar = transmitir("snapshot");
  const aoLer = transmitir("leitura");

  function assinar(estado: EstadoBalanca) {
    if (estadoAssinado) {
      estadoAssinado.off("mudanca", aoMudar);
      estadoAssinado.off("leitura", aoLer);
    }
    estado.on("mudanca", aoMudar);
    estado.on("leitura", aoLer);
    estadoAssinado = estado;
  }

  const estadoInicial = gerenciador.estadoAtual;
  if (estadoInicial) assinar(estadoInicial);

  // quando o perfil troca, reassina no novo estado
  const aoTrocar = () => {
    const novo = gerenciador.estadoAtual;
    if (novo) {
      assinar(novo);
      for (const ws of clientes) {
        enviar(ws, { tipo: "snapshot", dados: novo.snapshot() });
      }
    }
  };

  gerenciador.on("trocado", aoTrocar);

  return new Promise((resolve, reject) => {
    servidor.on("error", reject);

    servidor.listen(porta, HOST, () => {
      resolve({
        porta,
        fechar: () =>
          new Promise<void>((res) => {
            gerenciador.off("trocado", aoTrocar);
            if (estadoAssinado) {
              estadoAssinado.off("mudanca", aoMudar);
              estadoAssinado.off("leitura", aoLer);
            }
            for (const ws of clientes) ws.close();
            wss.close(() => servidor.close(() => res()));
          }),
      });
    });
  });
}