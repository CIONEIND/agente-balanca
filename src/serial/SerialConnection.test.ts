import { describe, it, expect, vi } from "vitest";
import { SerialConnection } from "./SerialConnection";
import { SimuladoParser } from "../parsers/simulado";
import { ConfigAgente } from "../config";
import { PERFIS } from "../balancas/perfis";

function criarConfig(perfilId = "simulado"): ConfigAgente {
  const perfil = PERFIS[perfilId];
  return {
    porta: "SIM",
    perfilId,
    perfil,
    serial: perfil.serial,
    modo: "continuo",
    terminador: "etx",
    tokenLocal: "teste",
  };
}

/** Coleta leituras por N milissegundos e encerra. */
function coletar(conn: SerialConnection, ms: number): Promise<boolean[]> {
  return new Promise((resolve) => {
    const estaveis: boolean[] = [];
    conn.on("leitura", (l) => estaveis.push(l.estavel));
    setTimeout(async () => {
      await conn.desconectar();
      resolve(estaveis);
    }, ms);
  });
}

describe("SerialConnection + SimuladoParser", () => {
  it("cenário 'estavel' estabiliza após o tempo mínimo", async () => {
    const parser = new SimuladoParser({ cenario: "estavel", pesoAlvo: 5 });
    const conn = new SerialConnection(criarConfig(), parser, {
      intervaloMs: 100,
      estabilizacaoMinMs: 300,
      leiturasParaEstabilizar: 3,
    });

    await conn.conectar();
    const estaveis = await coletar(conn, 1200);

    expect(estaveis.some((e) => e === true)).toBe(true);
  });

  it("cenário 'oscilando' nunca estabiliza", async () => {
    const parser = new SimuladoParser({ cenario: "oscilando", pesoAlvo: 5 });
    const conn = new SerialConnection(criarConfig(), parser, {
      intervaloMs: 100,
      estabilizacaoMinMs: 300,
    });

    await conn.conectar();
    const estaveis = await coletar(conn, 1500);

    expect(estaveis.every((e) => e === false)).toBe(true);
  });

  it("cenário 'subindo' estabiliza só depois de atingir o alvo", async () => {
    const alvo = 3;
    const parser = new SimuladoParser({ cenario: "subindo", pesoAlvo: alvo });
    const conn = new SerialConnection(criarConfig(), parser, {
      intervaloMs: 50,
      estabilizacaoMinMs: 200,
    });

    await conn.conectar();
    const estaveis = await coletar(conn, 3000);

    // deve haver pelo menos uma leitura estável no final
    expect(estaveis[estaveis.length - 1]).toBe(true);
  });

  it("simulador não dispara reconexão", async () => {
    const parser = new SimuladoParser({ cenario: "estavel", taxaFalha: 1 });
    const conn = new SerialConnection(criarConfig(), parser, {
      intervaloMs: 50,
      ciclosParaReconectar: 3,
    });

    const reconectou = vi.fn();
    conn.on("reconectando", reconectou);

    await conn.conectar();
    await coletar(conn, 800);

    expect(reconectou).not.toHaveBeenCalled();
  });

  it("estado é 'conectado' no simulador, sem porta serial", async () => {
    const parser = new SimuladoParser({ cenario: "estavel", pesoAlvo: 1 });
    const conn = new SerialConnection(criarConfig(), parser);

    await conn.conectar();
    expect(conn.estado).toBe("conectado");

    await conn.desconectar();
    expect(conn.estado).toBe("desconectado");
  });
});