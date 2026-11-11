export interface SerialConfig {
  baudRate: number;
  dataBits: 7 | 8;
  parity: "none" | "even" | "odd";
  stopBits: 1 | 2;
}

export type Terminador = "etx" | "silencio";
export type Implementacao = "frame-ascii" | "urano-longo" | "simulado";
export type OrigemPerfil = "captura" | "vb-topmanager" | "estimado"| "manual";

export interface PerfilBalanca {
  id: string;
  descricao: string;
  implementacao: Implementacao;
  casasDecimais: number;
  unidade: "kg" | "g";
  serial: SerialConfig;
  /** true = a balança só responde ao ENQ. false = transmite sozinha. */
  comando: boolean;
  /** "etx" = frame termina com STX...ETX. "silencio" = fim por pausa na linha. */
  terminador: Terminador;
  origem: OrigemPerfil;
}

const SERIAL_9600_8N2: SerialConfig = {
  baudRate: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: 2,
};

export const PERFIS: Record<string, PerfilBalanca> = {
  "toledo-2098": {
    id: "toledo-2098",
    descricao: "Toledo 2098/61 (60 kg, e=0,01 kg)",
    implementacao: "frame-ascii",
    casasDecimais: 2,
    unidade: "kg",
    serial: { baudRate: 56000, dataBits: 7, parity: "none", stopBits: 2 },
    comando: true,
    terminador: "etx",
    origem: "captura",
  },

  "toledo-prix-3400": {
    id: "toledo-prix-3400",
    descricao: "Toledo Prix 3400/1 (2,5 kg, e=0,0005 kg)",
    implementacao: "frame-ascii",
    casasDecimais: 4,
    unidade: "kg",
    serial: SERIAL_9600_8N2,
    comando: true,
    terminador: "etx",
    origem: "estimado",
  },

  filizola: {
    id: "filizola",
    descricao: "Filizola / Toledo modelos pequenos",
    implementacao: "frame-ascii",
    casasDecimais: 1,
    unidade: "kg",
    serial: SERIAL_9600_8N2,
    comando: true,
    terminador: "etx",
    origem: "vb-topmanager",
  },

  urano: {
    id: "urano",
    descricao: "Urano (frame longo, sanitização + offset fixo)",
    implementacao: "urano-longo",
    casasDecimais: 1,
    unidade: "kg",
    serial: SERIAL_9600_8N2,
    comando: true,
    terminador: "silencio",
    origem: "vb-topmanager",
  },
  simulado: {
    id: "simulado",
    descricao: "Simulador (sem balança física)",
    implementacao: "simulado",
    casasDecimais: 3,
    unidade: "kg",
    serial: { baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 },
    comando: false,
    terminador: "etx",
    origem: "estimado",
},
};