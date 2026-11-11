import { EventEmitter } from "events";
import { SerialPort } from "serialport";
import { carregarConfig, ConfigAgente } from "../config";
import { salvar as salvarConfig, ConfigPersistida } from "../config/persistida";
import { criarParser } from "../parsers/registry";
import { SerialConnection } from "../serial/SerialConnection";
import { EstadoBalanca } from "./EstadoBalanca";
import { PERFIS } from "../balancas/perfis";
import { testarPerfilEmPorta, ResultadoTeste } from "../tools/testarPerfil";

const LIMIAR_VAZIO_KG = 0.05;
const ESTAVEL_MIN_MS = 2000;
const JANELA_RECONEXAO_MS = 5000;
const ESPERA_DRIVER_MS = 300;

export interface ResultadoTroca {
  ok: boolean;
  motivo?: string;
  config?: ConfigAgente;
}

export class GerenciadorBalanca extends EventEmitter {
  private conn: SerialConnection | null = null;
  private estado: EstadoBalanca | null = null;
  private config: ConfigAgente | null = null;
  private trocando = false;
  private reconexaoIniciadaEm: number | null = null;

  async iniciar(): Promise<{ conn: SerialConnection; estado: EstadoBalanca; config: ConfigAgente }> {
    this.config = await carregarConfig();
    this.conn = new SerialConnection(this.config, criarParser(this.config.perfilId));
    this.estado = new EstadoBalanca(this.conn, this.config);
    this.assinarConexao(this.conn);

    await this.conn.conectar();
    return { conn: this.conn, estado: this.estado, config: this.config };
  }

  get conexao(): SerialConnection | null { return this.conn; }
  get estadoAtual(): EstadoBalanca | null { return this.estado; }
  get configAtual(): ConfigAgente | null { return this.config; }

  private assinarConexao(conn: SerialConnection): void {
    conn.on("estado", (e) => {
      if (e === "erro") {
        if (this.reconexaoIniciadaEm === null) this.reconexaoIniciadaEm = Date.now();
      } else {
        this.reconexaoIniciadaEm = null;
      }
    });
  }

  // ---------- DONO ÚNICO DA PORTA: TESTE ----------

  /**
   * Testa um perfil numa porta. O gerenciador é o único que abre portas:
   * pausa o polling, solta a porta ativa (se for a mesma), abre a porta
   * do teste, mede e fecha. Depois retoma a conexão anterior.
   */
  async testarPerfil(perfilId: string, porta: string): Promise<ResultadoTeste> {
    if (!PERFIS[perfilId]) {
      return {
        ok: false, perfil: perfilId, porta,
        peso: null, unidade: null, casasDecimais: null, raw: null,
        erro: `perfil desconhecido: ${perfilId}`,
      };
    }

    // SIM: nada de hardware, resultado sintético direto.
    if (porta === "SIM") {
      const p = PERFIS[perfilId];
      return {
        ok: true, perfil: perfilId, porta: "SIM",
        peso: 0, unidade: p.unidade, casasDecimais: p.casasDecimais,
        raw: "simulador", erro: null,
      };
    }

    const cfg = this.config;
    if (!cfg) {
      return {
        ok: false, perfil: perfilId, porta,
        peso: null, unidade: null, casasDecimais: null, raw: null,
        erro: "agente não inicializado",
      };
    }

    const mesmaPorta = cfg.porta === porta;
    const eraSimulado = cfg.perfil.implementacao === "simulado";

    // 1. pausa o polling e solta a porta ativa, se for a mesma
    if (mesmaPorta && this.conn) {
      await this.conn.desconectar();
      await new Promise((r) => setTimeout(r, ESPERA_DRIVER_MS));
    }

    // 2. abre a porta do teste — o gerenciador é o dono
    let port: SerialPort | null = null;
    let resultado: ResultadoTeste;

    try {
      const perfil = PERFIS[perfilId];
      const s = perfil.serial;

      port = await new Promise<SerialPort>((resolve, reject) => {
        const p = new SerialPort({
          path: porta,
          baudRate: s.baudRate,
          dataBits: s.dataBits,
          stopBits: s.stopBits,
          parity: s.parity,
          autoOpen: false,
        });
        p.open((err) => (err ? reject(err) : resolve(p)));
      });

      resultado = await testarPerfilEmPorta(perfilId, porta, port);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultado = {
        ok: false, perfil: perfilId, porta,
        peso: null, unidade: null, casasDecimais: null, raw: null,
        erro: /access denied/i.test(msg)
          ? `porta ${porta} em uso por outro programa`
          : `falha ao abrir ${porta}: ${msg}`,
      };
    } finally {
      // 3. fecha a porta do teste, sempre
      if (port) {
        port.removeAllListeners();
        await new Promise<void>((resolve) => {
          if (!port!.isOpen) return resolve();
          const t = setTimeout(() => resolve(), 2000);
          port!.close(() => { clearTimeout(t); resolve(); });
        });
        await new Promise((r) => setTimeout(r, ESPERA_DRIVER_MS));
      }
    }

    // 4. retoma a conexão anterior (ou reabre, se era a mesma porta)
    if (mesmaPorta && !eraSimulado) {
      await this.retomarConexao();
    }

    return resultado;
  }

  // ---------- DONO ÚNICO DA PORTA: TROCA ----------

  private motivoRecusa(): string | null {
    if (this.trocando) return "já existe uma troca em andamento";
    if (!this.estado || !this.config) return "agente não inicializado";

    const snap = this.estado.snapshot();

    if (this.config.perfil.implementacao === "simulado") return null;
    if (snap.muda) return null;

    if (snap.estado === "erro") {
      const desde = this.reconexaoIniciadaEm;
      if (desde !== null && Date.now() - desde < JANELA_RECONEXAO_MS) {
        return "reconexão em andamento — aguarde alguns segundos ou desconecte a balança";
      }
      return null;
    }

    const leitura = snap.ultimaLeitura;
    if (!leitura) return null;

    if (Math.abs(leitura.peso) > LIMIAR_VAZIO_KG) {
      return `balança com peso (${leitura.peso.toFixed(leitura.casasDecimais)} ${leitura.unidade}) — retire o peso antes de trocar`;
    }

    if (!leitura.estavel) {
      const idade = snap.ultimaLeituraEm
        ? Date.now() - new Date(snap.ultimaLeituraEm).getTime()
        : Infinity;
      if (idade < ESTAVEL_MIN_MS) return "leitura instável — aguarde a balança estabilizar";
    }

    return null;
  }

  async trocarPerfil(perfilId: string, porta: string): Promise<ResultadoTroca> {
    if (!PERFIS[perfilId]) {
      return { ok: false, motivo: `perfil desconhecido: ${perfilId}` };
    }

    const recusa = this.motivoRecusa();
    if (recusa) return { ok: false, motivo: recusa };

    this.trocando = true;
    this.reconexaoIniciadaEm = null;
    this.emit("trocando", { perfil: perfilId, porta });

    try {
      if (this.conn) {
        this.conn.removeAllListeners();
        await this.conn.desconectar();
        await new Promise((r) => setTimeout(r, ESPERA_DRIVER_MS));
      }

      const atual = await carregarConfig();
      const persistida: Omit<ConfigPersistida, "atualizadoEm"> = {
        perfil: perfilId,
        porta,
        tokenLocal: atual.tokenLocal,
      };
      await salvarConfig(persistida);

      const novoConfig = await carregarConfig();
      const novaConn = new SerialConnection(novoConfig, criarParser(novoConfig.perfilId));
      const novoEstado = new EstadoBalanca(novaConn, novoConfig);
      this.assinarConexao(novaConn);

      await novaConn.conectar();

      this.conn = novaConn;
      this.estado = novoEstado;
      this.config = novoConfig;

      this.emit("trocado", novoConfig);
      return { ok: true, config: novoConfig };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit("erro-troca", msg);
      return { ok: false, motivo: `falha ao trocar: ${msg}` };
    } finally {
      this.trocando = false;
    }
  }

  /**
   * Recria a conexão com a configuração atual.
   * Usado depois de um teste de porta que soltou a conexão ativa.
   */
  async retomarConexao(): Promise<void> {
    if (!this.config) return;

    const conn = new SerialConnection(this.config, criarParser(this.config.perfilId));
    const estado = new EstadoBalanca(conn, this.config);
    this.assinarConexao(conn);

    try {
      await conn.conectar();
      this.conn = conn;
      this.estado = estado;
      this.emit("trocado", this.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit("erro-troca", `falha ao retomar: ${msg}`);
    }
  }

  /** Força uma tentativa de reconexão imediata. */
async reconectarAgora(): Promise<{ ok: boolean; motivo?: string }> {
  if (!this.conn) return { ok: false, motivo: "agente não inicializado" };

  if (this.config?.perfil.implementacao === "simulado") {
    return { ok: false, motivo: "perfil simulado não usa porta serial" };
  }

  await this.conn.reconectarAgora();
  return { ok: true };
}
}