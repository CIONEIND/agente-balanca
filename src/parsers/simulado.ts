// src/parsers/simulado.ts
import { IParserBalanca, LeituraBalanca } from "./types";

const STX = 0x02;
const ETX = 0x03;

export type CenarioSimulado =
  | "estavel"
  | "subindo"
  | "oscilando"
  | "vazio"
  | "sobrecarga"
  | "intermitente";

export interface OpcoesSimulado {
  cenario: CenarioSimulado;
  casasDecimais: number;
  unidade: "kg" | "g";
  /** Peso alvo em kg. Ignorado em "vazio" e "sobrecarga". */
  pesoAlvo: number;
  /** Probabilidade 0..1 de não responder (simula timeout). */
  taxaFalha: number;
}

const PADRAO: OpcoesSimulado = {
  cenario: "estavel",
  casasDecimais: 3,
  unidade: "kg",
  pesoAlvo: 12.5,
  taxaFalha: 0,
};

/**
 * Simulador de balança. Não abre porta serial — gera frames sintéticos
 * no mesmo formato STX/ETX usado pelas balanças reais, para que
 * SerialConnection e todo o resto do sistema funcionem sem alteração.
 *
 * Uso: perfil "simulado" em config.json, ou instanciado direto em testes.
 */
export class SimuladoParser implements IParserBalanca {
  readonly nome = "Simulador de balança";
  readonly casasDecimais: number;
  readonly unidade: "kg" | "g";

  private readonly opcoes: OpcoesSimulado;
  private readonly fator: number;
  private pesoAtual: number;
  private passo = 0;

  constructor(opcoes: Partial<OpcoesSimulado> = {}) {
    this.opcoes = { ...PADRAO, ...opcoes };
    this.casasDecimais = this.opcoes.casasDecimais;
    this.unidade = this.opcoes.unidade;
    this.fator = 10 ** this.casasDecimais;
    this.pesoAtual = this.opcoes.cenario === "subindo" ? 0 : this.opcoes.pesoAlvo;
  }

  /** Gera o próximo frame. Retorna null para simular timeout. */
  gerarFrame(): Buffer | null {
    if (Math.random() < this.opcoes.taxaFalha) return null;

    const peso = this.calcularPeso();
    const texto = this.formatarPayload(peso);
    return Buffer.concat([
      Buffer.from([STX]),
      Buffer.from(texto, "latin1"),
      Buffer.from([ETX]),
    ]);
  }

  private calcularPeso(): number {
    this.passo++;

    switch (this.opcoes.cenario) {
      case "vazio":
        return 0;

      case "sobrecarga":
        return -1; // sinaliza payload sem dígitos

      case "subindo": {
        // rampa de 0 até o alvo em ~40 ciclos, depois estabiliza
        const incremento = this.opcoes.pesoAlvo / 40;
        this.pesoAtual = Math.min(this.pesoAtual + incremento, this.opcoes.pesoAlvo);
        return this.pesoAtual;
      }

      case "oscilando": {
        const tolerancia = 2 / this.fator;
        const amplitude = tolerancia * 10;
        return this.opcoes.pesoAlvo + (Math.random() - 0.5) * amplitude * 2;
      }

      case "intermitente":
        // estável por 10 ciclos, depois cai para zero por 5
        return this.passo % 15 < 10 ? this.opcoes.pesoAlvo : 0;

      case "estavel":
      default:
        return this.opcoes.pesoAlvo;
    }
  }

  private formatarPayload(peso: number): string {
    if (this.opcoes.cenario === "sobrecarga") return "-----";
    const inteiro = Math.round(Math.abs(peso) * this.fator);
    const sinal = peso < 0 ? "-" : "";
    return sinal + String(inteiro).padStart(this.casasDecimais + 4, "0");
  }

  parse(frame: Buffer): LeituraBalanca | null {
    const ini = frame.indexOf(STX);
    if (ini === -1) return null;
    const fim = frame.indexOf(ETX, ini + 1);
    if (fim === -1) return null;

    const texto = frame.subarray(ini + 1, fim).toString("latin1").trim();
    const digitos = texto.replace(/[^0-9]/g, "");

    if (!digitos) {
      return {
        peso: 0,
        unidade: this.unidade,
        casasDecimais: this.casasDecimais,
        estavel: false,
        origemEstabilidade: "software",
        bruto: null,
        tara: null,
        negativo: false,
        sobrecarga: true,
        erro: "sobrecarga simulada",
        raw: frame.toString("hex"),
        recebidoEm: new Date(),
      };
    }

    const negativo = texto.includes("-");
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

  comandoLeitura(): Buffer | null {
    return null; // o simulador não precisa de comando
  }
}