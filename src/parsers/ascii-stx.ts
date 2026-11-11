// src/parsers/ascii-stx.ts
import { IParserBalanca, LeituraBalanca } from "./types";

const STX = 0x02;
const ETX = 0x03;

export interface OpcoesFrameAscii {
  nome: string;
  casasDecimais: number;
  unidade: "kg" | "g";
  /** Posição 0-based do campo de peso, contada a partir do STX. Omitir = payload inteiro. */
  campoInicio?: number;
  campoTamanho?: number;
}

/**
 * Parser genérico de frame ASCII delimitado por STX/ETX.
 * Cobre Toledo, Filizola e Urano — a diferença está só na configuração.
 * Enquadramento validado em campo na Toledo 2098; nos demais vem dos
 * scripts VB do TopManager e aguarda captura para homologação.
 */
export class FrameAsciiParser implements IParserBalanca {
  readonly nome: string;
  readonly casasDecimais: number;
  readonly unidade: "kg" | "g";
  private readonly fator: number;
  private readonly campoInicio: number;
  private readonly campoTamanho?: number;

  constructor(o: OpcoesFrameAscii) {
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
    const fimEfetivo = fim === -1 ? frame.length : fim;

    // Mantém o STX no texto para que os offsets batam com os do script VB
    const texto = frame.subarray(ini, fimEfetivo).toString("latin1");

    const campo = this.campoTamanho
      ? texto.substring(this.campoInicio, this.campoInicio + this.campoTamanho)
      : texto.substring(this.campoInicio);

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