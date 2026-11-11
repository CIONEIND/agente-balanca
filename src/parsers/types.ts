export type OrigemEstabilidade = "balanca" | "software";
export type Unidade = "kg" | "g";

export interface LeituraBalanca {
  peso: number;
  unidade: Unidade;
  casasDecimais: number;
  estavel: boolean;
  origemEstabilidade: OrigemEstabilidade;
  bruto: number | null;
  tara: number | null;
  negativo: boolean;
  sobrecarga: boolean;
  erro: string | null;
  raw: string;
  recebidoEm: Date;
}

export interface LeituraEstabilizada extends LeituraBalanca {
  /** Estabilidade final: da balança quando disponível, senão inferida. */
  estavel: boolean;
}

export interface IParserBalanca {
  readonly nome: string;
  readonly casasDecimais: number;
  readonly unidade: Unidade;
  parse(frame: Buffer): LeituraBalanca | null;
  comandoLeitura(): Buffer | null;
}