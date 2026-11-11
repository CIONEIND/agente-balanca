import { EventEmitter } from "events";
import { SerialConnection, EstadoConexao } from '../serial/SerialConnection'
import { LeituraEstabilizada } from "../parsers/types";
import { ConfigAgente } from "../config";

export interface SnapshotBalanca {
  estado: EstadoConexao;
  muda: boolean;
  perfil: string;
  descricaoPerfil: string;
  porta: string;
  ultimaLeitura: LeituraEstabilizada | null;
  ultimaLeituraEm: string | null;
  ciclosFalha: number;
  tentativaReconexao: number;
}

/**
 * Mantém o último estado conhecido da balança e notifica assinantes.
 * A API consulta o snapshot; o WebSocket assina os eventos.
 */
export class EstadoBalanca extends EventEmitter {
  private ultimaLeitura: LeituraEstabilizada | null = null;
  private ultimaLeituraEm: string | null = null;
  private estadoAtual: EstadoConexao = "desconectado";
  private estaMuda = false;
  private falhas = 0;

  constructor(
    private readonly conn: SerialConnection,
    private readonly config: ConfigAgente
  ) {
    super();
    this.assinar();
  }

  private assinar(): void {
    this.conn.on("estado", (e) => {
      this.estadoAtual = e;
      this.emit("mudanca", this.snapshot());
    });

    this.conn.on("leitura", (l) => {
      this.ultimaLeitura = l;
      this.ultimaLeituraEm = l.recebidoEm.toISOString();
      this.emit("leitura", l);
      //this.emit("mudanca", this.snapshot());
    });

    this.conn.on("muda", (muda, ciclos) => {
      this.estaMuda = muda;
      this.falhas = ciclos;
      this.emit("mudanca", this.snapshot());
    });

    this.conn.on("falha", (ciclos) => {
      this.falhas = ciclos;
    });
  }
    async reconectarAgora(): Promise<{ ok: boolean; motivo?: string }> {
    if (!this.conn) return { ok: false, motivo: "agente não inicializado" };

    if (this.config?.perfil.implementacao === "simulado") {
      return { ok: false, motivo: "perfil simulado não usa porta serial" };
    }

    await this.conn.reconectarAgora();
    return { ok: true };
  }

  snapshot(): SnapshotBalanca {
    return {
      estado: this.estadoAtual,
      muda: this.estaMuda,
      perfil: this.config.perfilId,
      descricaoPerfil: this.config.perfil.descricao,
      porta: this.config.porta,
      ultimaLeitura: this.ultimaLeitura,
      ultimaLeituraEm: this.ultimaLeituraEm,
      ciclosFalha: this.falhas,
      tentativaReconexao: this.conn.tentativaAtual,
    };
  }

  /** Uma leitura é considerada válida para pesagem se estável e recente. */
  leituraValida(maxIdadeMs = 3000): LeituraEstabilizada | null {
    if (!this.ultimaLeitura || !this.ultimaLeituraEm) return null;
    if (!this.ultimaLeitura.estavel) return null;
    if (this.estaMuda) return null;

    const idade = Date.now() - new Date(this.ultimaLeituraEm).getTime();
    return idade <= maxIdadeMs ? this.ultimaLeitura : null;
  }
  
}