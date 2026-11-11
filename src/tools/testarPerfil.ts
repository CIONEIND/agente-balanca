import { SerialPort } from "serialport";
import { PERFIS } from "../balancas/perfis";
import { criarParser } from "../parsers/registry";

const STX = 0x02;
const ETX = 0x03;
const TIMEOUT_MS = 1500;

export interface ResultadoTeste {
  ok: boolean;
  perfil: string;
  porta: string;
  peso: number | null;
  unidade: string | null;
  casasDecimais: number | null;
  raw: string | null;
  erro: string | null;
}

/**
 * Executa um teste de leitura sobre uma porta JÁ ABERTA.
 * Não abre nem fecha a porta — quem chama é o dono do recurso.
 * Fecha apenas os listeners que ele mesmo registrou.
 */
export function testarPerfilEmPorta(
  perfilId: string,
  porta: string,
  port: SerialPort
): Promise<ResultadoTeste> {
  const perfil = PERFIS[perfilId];
  if (!perfil) {
    return Promise.resolve({
      ok: false,
      perfil: perfilId,
      porta,
      peso: null,
      unidade: null,
      casasDecimais: null,
      raw: null,
      erro: `perfil desconhecido: ${perfilId}`,
    });
  }

  // SIM não é porta real: devolve resultado sintético sem tocar em hardware.
  if (porta === "SIM") {
    return Promise.resolve({
      ok: true,
      perfil: perfilId,
      porta: "SIM",
      peso: 0,
      unidade: perfil.unidade,
      casasDecimais: perfil.casasDecimais,
      raw: "simulador",
      erro: null,
    });
  }

  const parser = criarParser(perfilId);
  const partes: Buffer[] = [];

  return new Promise((resolve) => {
    let finalizado = false;

    const finalizar = (resultado: ResultadoTeste) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      port.off("data", onData);
      port.off("error", onError);
      resolve(resultado);
    };

    const timer = setTimeout(() => {
      finalizar({
        ok: false,
        perfil: perfilId,
        porta,
        peso: null,
        unidade: null,
        casasDecimais: null,
        raw: null,
        erro: `sem resposta em ${TIMEOUT_MS} ms`,
      });
    }, TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      partes.push(chunk);
      const buf = Buffer.concat(partes);
      const ini = buf.indexOf(STX);
      if (ini === -1) return;
      if (buf.indexOf(ETX, ini + 1) === -1) return;

      const leitura = parser.parse(buf);
      if (!leitura) {
        finalizar({
          ok: false,
          perfil: perfilId,
          porta,
          peso: null,
          unidade: null,
          casasDecimais: null,
          raw: buf.toString("hex"),
          erro: "frame recebido mas não interpretado",
        });
        return;
      }

      finalizar({
        ok: true,
        perfil: perfilId,
        porta,
        peso: leitura.peso,
        unidade: leitura.unidade,
        casasDecimais: leitura.casasDecimais,
        raw: leitura.raw,
        erro: null,
      });
    };

    const onError = (err: Error) => {
      finalizar({
        ok: false,
        perfil: perfilId,
        porta,
        peso: null,
        unidade: null,
        casasDecimais: null,
        raw: null,
        erro: err.message,
      });
    };

    port.on("data", onData);
    port.on("error", onError);

    const cmd = parser.comandoLeitura();
    if (cmd) port.write(cmd);
  });
}