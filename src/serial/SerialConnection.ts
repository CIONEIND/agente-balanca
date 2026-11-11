import { SerialPort } from "serialport";
import { EventEmitter } from "events";
import { ConfigAgente } from "../config";
import { IParserBalanca, LeituraEstabilizada } from "../parsers/types";
import { SimuladoParser } from "../parsers/simulado";

const STX = 0x02;
const ETX = 0x03;

export type EstadoConexao = "desconectado" | "conectando" | "conectado" | "erro";

export interface OpcoesPolling {
  intervaloMs: number;
  timeoutRespostaMs: number;
  silencioFrameMs: number;
  leiturasParaEstabilizar: number;
  toleranciaKg: number;
  estabilizacaoMinMs: number;
  ciclosParaAlerta: number;
  ciclosParaReconectar: number;
}

const PADRAO: Omit<OpcoesPolling, "toleranciaKg"> = {
  intervaloMs: 400,
  timeoutRespostaMs: 700,
  silencioFrameMs: 80,
  leiturasParaEstabilizar: 3,
  estabilizacaoMinMs: 1500,
  ciclosParaAlerta: 5,
  ciclosParaReconectar: 30,
};

/** Mapa de eventos — dá tipo real ao listener e elimina o `any` implícito. */
export interface EventosSerialConnection {
  estado: (estado: EstadoConexao) => void;
  leitura: (leitura: LeituraEstabilizada) => void;
  falha: (ciclos: number) => void;
  muda: (muda: boolean, ciclos: number) => void;
  "frame-invalido": (hex: string) => void;
  erro: (err: Error) => void;
  reconectando: (tentativa: number) => void;
  reconectado: (tentativa: number) => void;
  desistiu: () => void;
}

export class SerialConnection extends EventEmitter {
  private port: SerialPort | null = null;
  private parar = true;
  private agendado: NodeJS.Timeout | null = null;
  private timerReconexao: NodeJS.Timeout | null = null;
  private emCiclo = false;
  private reconectandoAgora = false;
  private tentativaReconexao = 0;
  private forcarReconexao = false;
  private ciclosFalha = 0;
  private estavaMuda = false;

  private historico: number[] = [];
  private inicioEstavel = 0;

  private readonly opcoes: OpcoesPolling;

  constructor(
    private readonly config: ConfigAgente,
    private readonly parser: IParserBalanca,
    opcoes: Partial<OpcoesPolling> = {}
  ) {
    super();
    this.opcoes = {
      ...PADRAO,
      toleranciaKg: 2 / 10 ** this.parser.casasDecimais,
      ...opcoes,
    };
  }

  /** true quando não há porta serial envolvida (simulador). */
  private get simulado(): boolean {
    return this.parser instanceof SimuladoParser;
  }

  get estado(): EstadoConexao {
    if (this.parar) return "desconectado";
    if (this.reconectandoAgora) return "erro";
    if (this.simulado) return "conectado";
    return this.port?.isOpen ? "conectado" : "desconectado";
  }

  get muda(): boolean {
    return this.estavaMuda;
  }

  async conectar(): Promise<void> {
    if (!this.simulado && this.port?.isOpen) return;

    this.parar = false;
    this.emit("estado", "conectando");

    if (!this.simulado) {
      await this.abrirPorta();
    }

    this.historico = [];
    this.inicioEstavel = 0;
    this.ciclosFalha = 0;
    this.estavaMuda = false;

    this.emit("estado", "conectado");
    this.agendar();
  }

  private abrirPorta(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = this.config.serial;

      this.port = new SerialPort({
        path: this.config.porta,
        baudRate: s.baudRate,
        dataBits: s.dataBits,
        stopBits: s.stopBits,
        parity: s.parity,
        autoOpen: false,
      });

      this.port.on("error", (err: Error) => this.emit("erro", err));

      this.port.open((err) => (err ? reject(err) : resolve()));
    });
  }

  private agendar(): void {
    if (this.parar) return;
    this.agendado = setTimeout(async () => {
      await this.ciclo();
      this.agendar();
    }, this.opcoes.intervaloMs);
  }

  private async ciclo(): Promise<void> {
    if (this.parar || this.emCiclo) return;
    this.emCiclo = true;

    try {
      const resposta = await this.ler();

      if (!resposta || resposta.length === 0) {
        this.registrarFalha();
        return;
      }

      const leitura = this.parser.parse(resposta);
      if (!leitura) {
        this.emit("frame-invalido", resposta.toString("hex"));
        return;
      }

      this.registrarSucesso();

      const estavel =
        leitura.origemEstabilidade === "balanca"
          ? leitura.estavel
          : this.avaliarEstabilidade(leitura.peso, Date.now());

      this.emit("leitura", { ...leitura, estavel });
    } catch (err) {
      this.emit("erro", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.emCiclo = false;
    }
  }

  private ler(): Promise<Buffer | null> {
    // Simulador: gera o frame direto, sem porta serial.
    // Precisa vir ANTES de qualquer checagem de porta.
    if (this.simulado) {
      return Promise.resolve((this.parser as SimuladoParser).gerarFrame());
    }

    return new Promise((resolve) => {
      const port = this.port;
      const comando = this.parser.comandoLeitura();
      if (!port?.isOpen) return resolve(null);

      const partes: Buffer[] = [];
      let concluido = false;
      let timerResposta: NodeJS.Timeout;
      let timerSilencio: NodeJS.Timeout | null = null;

      const finalizar = (valor: Buffer | null) => {
        if (concluido) return;
        concluido = true;
        clearTimeout(timerResposta);
        if (timerSilencio) clearTimeout(timerSilencio);
        port.off("data", onData);
        resolve(valor);
      };

      const onData = (chunk: Buffer) => {
        partes.push(chunk);
        const acumulado = Buffer.concat(partes);

        if (this.config.terminador === "etx") {
          const ini = acumulado.indexOf(STX);
          if (ini !== -1 && acumulado.indexOf(ETX, ini + 1) !== -1) finalizar(acumulado);
          return;
        }

        if (timerSilencio) clearTimeout(timerSilencio);
        timerSilencio = setTimeout(
          () => finalizar(Buffer.concat(partes)),
          this.opcoes.silencioFrameMs
        );
      };

      timerResposta = setTimeout(() => {
        const acumulado = Buffer.concat(partes);
        if (this.config.terminador === "silencio" && acumulado.length > 0) {
          finalizar(acumulado);
        } else {
          finalizar(null);
        }
      }, this.opcoes.timeoutRespostaMs);

      port.on("data", onData);

      if (!comando) return;

      port.write(comando, (err) => {
        if (err) {
          this.emit("erro", err);
          finalizar(null);
        }
      });
    });
  }

  private avaliarEstabilidade(peso: number, agora: number): boolean {
    const o = this.opcoes;
    const referencia = this.historico[this.historico.length - 1];

    if (referencia === undefined || Math.abs(peso - referencia) > o.toleranciaKg) {
      this.historico = [peso];
      this.inicioEstavel = agora;
      return false;
    }

    this.historico.push(peso);
    if (this.historico.length > o.leiturasParaEstabilizar) this.historico.shift();

    const semVariacao = this.historico.every((p) => Math.abs(p - peso) <= o.toleranciaKg);
    const tempoOk = agora - this.inicioEstavel >= o.estabilizacaoMinMs;
    const amostrasOk = this.historico.length >= o.leiturasParaEstabilizar;

    return semVariacao && tempoOk && amostrasOk;
  }

  private registrarFalha(): void {
    this.ciclosFalha++;
    this.emit("falha", this.ciclosFalha);

    if (!this.estavaMuda && this.ciclosFalha >= this.opcoes.ciclosParaAlerta) {
      this.estavaMuda = true;
      this.historico = [];
      this.emit("muda", true, this.ciclosFalha);
    }

    // Simulador não tem porta para reconectar.
    if (this.simulado) return;

    if (this.ciclosFalha >= this.opcoes.ciclosParaReconectar) {
      void this.reconectar();
    }
  }

  private registrarSucesso(): void {
    if (this.estavaMuda) {
      this.estavaMuda = false;
      this.emit("muda", false, 0);
    }
    this.ciclosFalha = 0;
  }
private esperaReconexao(tentativa: number): number {
  return Math.min(2000 * Math.pow(2, tentativa - 1), 15000);
}

get tentativaAtual(): number {
  return this.tentativaReconexao;
}
// --- reconectar() reescrito: sem limite de tentativas ---
async reconectar(): Promise<void> {
  if (this.reconectandoAgora || this.parar || this.simulado) return;

  this.reconectandoAgora = true;
  this.emit("estado", "erro");

  if (this.agendado) clearTimeout(this.agendado);
  this.agendado = null;

  await this.fecharPorta();

  // Sem limite: continua tentando enquanto não for parado.
  for (let tentativa = 1; !this.parar; tentativa++) {
    this.tentativaReconexao = tentativa;
    this.emit("reconectando", tentativa);

    // Espera interrompível: desconectar() ou forcarReconexao() limpam este timer.
    const espera = this.forcarReconexao ? 0 : this.esperaReconexao(tentativa);
    this.forcarReconexao = false;

    await new Promise<void>((r) => {
      this.timerReconexao = setTimeout(r, espera);
    });
    this.timerReconexao = null;

    if (this.parar) break;

    try {
      await this.abrirPorta();
      this.historico = [];
      this.inicioEstavel = 0;
      this.ciclosFalha = 0;
      this.tentativaReconexao = 0;
      this.reconectandoAgora = false;
      this.emit("estado", "conectado");
      this.emit("reconectado", tentativa);
      this.agendar();
      return;
    } catch {
      // falhou: próxima iteração com backoff maior
    }
  }

  this.reconectandoAgora = false;
  this.tentativaReconexao = 0;
  this.emit("desistiu"); // agora significa "parado", não "esgotou"
}

/**
 * Força uma tentativa imediata, sem esperar o backoff.
 * Chamado pelo botão "Reconectar agora" da tela.
 */
async reconectarAgora(): Promise<void> {
  if (this.simulado) return;

  if (this.reconectandoAgora) {
    // já está tentando: acorda a espera atual
    this.forcarReconexao = true;
    if (this.timerReconexao) {
      clearTimeout(this.timerReconexao);
      this.timerReconexao = null;
    }
    return;
  }

  this.ciclosFalha = this.opcoes.ciclosParaReconectar;
  await this.reconectar();
}

  private async fecharPorta(): Promise<void> {
  const port = this.port;
  if (!port) return;
  this.port = null;

  // Remove listeners ANTES de fechar, para não reagir a erros do close.
  port.removeAllListeners();

  await new Promise<void>((resolve) => {
    if (!port.isOpen) return resolve();

    // Timeout de segurança: se o close travar, não bloqueia a troca.
    const timer = setTimeout(() => resolve(), 2000);

    port.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  // Descarta a instância para o GC liberar o handle nativo.
  (port as unknown as { destroy?: () => void }).destroy?.();
}
async desconectar(): Promise<void> {
  this.parar = true;

  if (this.agendado) clearTimeout(this.agendado);
  this.agendado = null;

  if (this.timerReconexao) {
    clearTimeout(this.timerReconexao);
    this.timerReconexao = null;
  }

  await this.fecharPorta();

  // Dá tempo ao driver USB-serial do Windows de liberar o handle.
  // Sem isso, a próxima abertura recebe "Access denied".
  await new Promise((r) => setTimeout(r, 300));

  this.emit("estado", "desconectado");
}
}

/** Overloads tipados: dá tipo real aos listeners sem perder a API do EventEmitter. */
export declare interface SerialConnection {
  on<E extends keyof EventosSerialConnection>(event: E, listener: EventosSerialConnection[E]): this;
  once<E extends keyof EventosSerialConnection>(event: E, listener: EventosSerialConnection[E]): this;
  off<E extends keyof EventosSerialConnection>(event: E, listener: EventosSerialConnection[E]): this;
  emit<E extends keyof EventosSerialConnection>(
    event: E,
    ...args: Parameters<EventosSerialConnection[E]>
  ): boolean;
}