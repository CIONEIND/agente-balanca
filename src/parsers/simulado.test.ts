import { describe, it, expect } from "vitest";
import { SimuladoParser } from "./simulado";

const STX = 0x02;
const ETX = 0x03;

/** Extrai o valor numérico de um frame STX...ETX, aplicando o divisor do parser. */
function extrairPeso(parser: SimuladoParser, frame: Buffer): number {
  const leitura = parser.parse(frame);
  if (!leitura) throw new Error("frame inválido");
  return leitura.peso;
}

/** Extrai o texto do payload (sem STX/ETX). */
function payload(frame: Buffer): string {
  return frame.subarray(1, frame.length - 1).toString("latin1");
}

describe("SimuladoParser — formato de frame", () => {
  it("gera frame com STX no início e ETX no fim", () => {
    const p = new SimuladoParser({ cenario: "estavel", pesoAlvo: 5 });
    const frame = p.gerarFrame()!;

    expect(frame[0]).toBe(STX);
    expect(frame[frame.length - 1]).toBe(ETX);
  });

  it("respeita as casas decimais configuradas", () => {
    const p = new SimuladoParser({ cenario: "estavel", pesoAlvo: 12.5, casasDecimais: 3 });
    const frame = p.gerarFrame()!;
    const texto = payload(frame);

    // 12.5 kg com 3 casas = 12500, com padding de largura fixa (casas + 4)
    expect(texto).toBe("0012500");
    expect(Number(texto) / 1000).toBeCloseTo(12.5, 3);
  });

  it("parse() devolve o mesmo peso que gerou o frame", () => {
    const p = new SimuladoParser({ cenario: "estavel", pesoAlvo: 3.75, casasDecimais: 3 });
    const frame = p.gerarFrame()!;

    expect(extrairPeso(p, frame)).toBeCloseTo(3.75, 3);
  });

  it("parse() rejeita frame sem STX", () => {
    const p = new SimuladoParser();
    const invalido = Buffer.from("12345", "latin1");

    expect(p.parse(invalido)).toBeNull();
  });

  it("parse() rejeita frame sem ETX", () => {
    const p = new SimuladoParser();
    const invalido = Buffer.concat([Buffer.from([STX]), Buffer.from("12345", "latin1")]);

    expect(p.parse(invalido)).toBeNull();
  });
});

describe("SimuladoParser — cenário 'estavel'", () => {
  it("devolve sempre o mesmo peso", () => {
    const p = new SimuladoParser({ cenario: "estavel", pesoAlvo: 7.25 });
    const pesos = Array.from({ length: 20 }, () => extrairPeso(p, p.gerarFrame()!));

    pesos.forEach((peso) => expect(peso).toBeCloseTo(7.25, 3));
  });

  it("com pesoAlvo 0, sorteia valores entre 0 e 10", () => {
    const p = new SimuladoParser({ cenario: "estavel", pesoAlvo: 0 });
    const pesos = Array.from({ length: 50 }, () => extrairPeso(p, p.gerarFrame()!));

    pesos.forEach((peso) => {
      expect(peso).toBeGreaterThanOrEqual(0);
      expect(peso).toBeLessThanOrEqual(10);
    });
  });
});

describe("SimuladoParser — cenário 'subindo'", () => {
  it("parte de zero e converge para o alvo", () => {
    const alvo = 10;
    const p = new SimuladoParser({ cenario: "subindo", pesoAlvo: alvo });

    const primeiro = extrairPeso(p, p.gerarFrame()!);
    expect(primeiro).toBeLessThan(alvo);

    let ultimo = primeiro;
    for (let i = 0; i < 60; i++) {
      ultimo = extrairPeso(p, p.gerarFrame()!);
    }

    expect(ultimo).toBeCloseTo(alvo, 3);
  });

  it("nunca ultrapassa o alvo", () => {
    const alvo = 8;
    const p = new SimuladoParser({ cenario: "subindo", pesoAlvo: alvo });

    const pesos = Array.from({ length: 100 }, () => extrairPeso(p, p.gerarFrame()!));

    pesos.forEach((peso) => expect(peso).toBeLessThanOrEqual(alvo));
  });

  it("é monotônico não-decrescente", () => {
    const p = new SimuladoParser({ cenario: "subindo", pesoAlvo: 5 });
    const pesos = Array.from({ length: 50 }, () => extrairPeso(p, p.gerarFrame()!));

    for (let i = 1; i < pesos.length; i++) {
      expect(pesos[i]).toBeGreaterThanOrEqual(pesos[i - 1]);
    }
  });
});

describe("SimuladoParser — cenário 'oscilando'", () => {
  it("varia acima da tolerância de estabilidade", () => {
    const casas = 3;
    const tolerancia = 2 / 10 ** casas; // mesma regra do SerialConnection
    const p = new SimuladoParser({ cenario: "oscilando", pesoAlvo: 5, casasDecimais: casas });

    const pesos = Array.from({ length: 50 }, () => extrairPeso(p, p.gerarFrame()!));

    // pelo menos uma variação deve exceder a tolerância
    const variacoes = pesos.slice(1).map((p2, i) => Math.abs(p2 - pesos[i]));
    expect(Math.max(...variacoes)).toBeGreaterThan(tolerancia);
  });

  it("nunca fica constante por 3 leituras seguidas", () => {
    const p = new SimuladoParser({ cenario: "oscilando", pesoAlvo: 5 });
    const pesos = Array.from({ length: 100 }, () => extrairPeso(p, p.gerarFrame()!));

    let estagnacao = 0;
    for (let i = 1; i < pesos.length; i++) {
      if (Math.abs(pesos[i] - pesos[i - 1]) < 1e-9) estagnacao++;
      else estagnacao = 0;
      expect(estagnacao).toBeLessThan(3);
    }
  });
});

describe("SimuladoParser — cenário 'vazio'", () => {
  it("devolve sempre zero", () => {
    const p = new SimuladoParser({ cenario: "vazio" });
    const pesos = Array.from({ length: 20 }, () => extrairPeso(p, p.gerarFrame()!));

    pesos.forEach((peso) => expect(peso).toBe(0));
  });
});

describe("SimuladoParser — cenário 'sobrecarga'", () => {
  it("marca sobrecarga e não devolve peso válido", () => {
    const p = new SimuladoParser({ cenario: "sobrecarga" });
    const frame = p.gerarFrame()!;
    const leitura = p.parse(frame)!;

    expect(leitura.sobrecarga).toBe(true);
    expect(leitura.erro).not.toBeNull();
  });

  it("payload contém apenas traços", () => {
    const p = new SimuladoParser({ cenario: "sobrecarga" });
    const frame = p.gerarFrame()!;

    expect(payload(frame)).toMatch(/^-+$/);
  });
});

describe("SimuladoParser — cenário 'intermitente'", () => {
  it("alterna entre o alvo e zero em ciclos de 15", () => {
    const alvo = 6;
    const p = new SimuladoParser({ cenario: "intermitente", pesoAlvo: alvo });

    const pesos = Array.from({ length: 45 }, () => extrairPeso(p, p.gerarFrame()!));

    // deve conter tanto o alvo quanto zero
    expect(pesos.some((peso) => Math.abs(peso - alvo) < 0.001)).toBe(true);
    expect(pesos.some((peso) => peso === 0)).toBe(true);

    // proporção ~2/3 no alvo, ~1/3 em zero
    const noAlvo = pesos.filter((peso) => Math.abs(peso - alvo) < 0.001).length;
    expect(noAlvo).toBeGreaterThan(20);
    expect(noAlvo).toBeLessThan(35);
  });
});

describe("SimuladoParser — taxa de falha", () => {
  it("com taxaFalha 1, nunca gera frame", () => {
    const p = new SimuladoParser({ cenario: "estavel", taxaFalha: 1 });
    const frames = Array.from({ length: 20 }, () => p.gerarFrame());

    frames.forEach((f) => expect(f).toBeNull());
  });

  it("com taxaFalha 0, sempre gera frame", () => {
    const p = new SimuladoParser({ cenario: "estavel", taxaFalha: 0 });
    const frames = Array.from({ length: 20 }, () => p.gerarFrame());

    frames.forEach((f) => expect(f).not.toBeNull());
  });

  it("com taxaFalha 0.5, produz mistura de frames e nulos", () => {
    const p = new SimuladoParser({ cenario: "estavel", taxaFalha: 0.5 });
    const frames = Array.from({ length: 200 }, () => p.gerarFrame());

    const nulos = frames.filter((f) => f === null).length;
    expect(nulos).toBeGreaterThan(50);
    expect(nulos).toBeLessThan(150);
  });
});

describe("SimuladoParser — contrato IParserBalanca", () => {
  it("comandoLeitura() devolve null (simulador não precisa de comando)", () => {
    const p = new SimuladoParser();
    expect(p.comandoLeitura()).toBeNull();
  });

  it("expõe casasDecimais e unidade configurados", () => {
    const p = new SimuladoParser({ casasDecimais: 4, unidade: "g" });

    expect(p.casasDecimais).toBe(4);
    expect(p.unidade).toBe("g");
  });

  it("declara origemEstabilidade 'software'", () => {
    const p = new SimuladoParser({ cenario: "estavel", pesoAlvo: 1 });
    const leitura = p.parse(p.gerarFrame()!)!;

    expect(leitura.origemEstabilidade).toBe("software");
  });
});