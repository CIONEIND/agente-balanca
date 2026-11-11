// src/parsers/toledo-ascii.ts
import { IParserBalanca, LeituraBalanca } from "./types";

const STX = 0x02;
const ETX = 0x03;

export interface OpcoesToledoAscii {
  nome: string;
  casasDecimais: number;
  unidade: "kg" | "g";
  /** Posição inicial do campo de peso, se o frame for longo. 0 = payload inteiro. */
  campoInicio?: number;
  campoTamanho?: number;
}

export class ToledoAsciiParser implements IParserBalanca {
  readonly nome: string;
  readonly casasDecimais: number;
  readonly unidade: "kg" | "g";
  private readonly fator: number;
  private readonly campoInicio: number;
  private readonly campoTamanho?: number;

  constructor(o: OpcoesToledoAscii) {
    this.nome = o.nome;
    this.casasDecimais = o.casasDecimais;
    this.unidade = o.unidade;
    this.fator = 10 ** o.casasDecimais;
    this.campoInicio = o.campoInicio ?? 0;
    this.campoTamanho = o.campoTamanho;
  }

  parse(frame: Buffer): LeituraBalanca | null {
    const ini = frame.indexOf(STX);
    if (ini === -1) return null;
    const fim = frame.indexOf(ETX, ini + 1);
    if (fim === -1) return null;

    const payload = frame.subarray(ini + 1, fim).toString("latin1").trim();
    if (!payload) return null;

    const campo = this.campoTamanho
      ? payload.substring(this.campoInicio, this.campoInicio + this.campoTamanho)
      : payload;

    const digitos = campo.replace(/[^0-9]/g, "");
    if (!digitos) return null;

    const negativo = campo.includes("-");
    const valor = Number(digitos) / this.fator;

    return {
      peso: negativo ? -valor : valor,
      unidade: this.unidade,
      casasDecimais: this.casasDecimais,
      estavel: false,
      origemEstabilidade: "software",
      bruto: null,
      tara: null,
      negativo,
      sobrecarga: false,
      erro: null,
      raw: frame.toString("hex"),
      recebidoEm: new Date(),
    };
  }

  comandoLeitura(): Buffer {
    return Buffer.from([0x05]);
  }
}