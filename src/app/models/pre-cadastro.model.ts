// src/app/models/pre-cadastro.model.ts
import { Timestamp } from '@angular/fire/firestore';
// --- Tipos auxiliares novos ---
export interface ArquivoPreCadastro {
  id: string;                // id único (gerado pelo storage/serviço)
  nome: string;              // nome do arquivo (ex.: boleto-01.pdf)
  url: string;               // URL para download
  tipo?: string | null;      // mime type
  tamanho?: number | null;   // bytes
  uploadedAt?: any;          // Timestamp | Date
  uploadedByUid?: string | null;
  uploadedByNome?: string | null;
  storagePath?: string; // recomendado

}


export type AgendamentoStatus = 'nao_agendado' | 'agendado' | 'visitado';
export type AprovacaoStatus = 'nao_verificado' | 'apto' | 'inapto';
export type FormalizacaoStatus = 'nao_formalizado' | 'formalizado';

// NOVO: status de desistência
export type DesistenciaStatus = 'nao_desistiu' | 'desistiu';

export type FluxoFixos = {
  aluguel: number;
  salarios: number;
  energiaEletrica: number;
  agua: number;
  telefoneInternet: number;
};

export type FluxoVariaveis = {
  materiaPrima: number;
  insumos: number;
  frete: number;
  transporte: number;
  outros: Array<{ nome: string; valor: number }>;
};

export type FluxoCaixa = {
  faturamentoMensal: number;
  fixos: FluxoFixos;
  variaveis: FluxoVariaveis;
};

export type FluxoTotais = { receita: number; custos: number; lucro: number };

export interface PreCadastro {
  id: string;

  grupoId?: string | null;                 // id do grupo que pertence
  papelNoGrupo?: 'coordenador' | 'membro' | null;

  nomeCompleto: string;
  cpf: string;
  endereco: string;
  telefone: string;
  email: string;
  bairro: string;
  origem: string;

  // NOVO: regionalização
  cidade?: string | null;
  uf?: string | null;

  createdByUid?: string;
  createdByNome?: string;
  createdAt?: Timestamp | Date | any;
  atualizadoEm?: Timestamp | Date | any;

  valorSolicitado?: number;
  valorSolicitadoFormatado?: string;
  parcelas?: number | null;
  valorParcela?: number;
  valorParcelaFormatado?: string;
  fluxoCaixa?: FluxoCaixa | null;
  fluxoCaixaTotais?: FluxoTotais;

  agendamentoStatus?: AgendamentoStatus;
  agendamentoId?: string | null;
  agendamentoData?: string | null;
  agendamentoHora?: string | null;
  visitadoEm?: Timestamp | Date | any;

  aprovacao?: {
    status: AprovacaoStatus;        // 'nao_verificado' | 'apto' | 'inapto'
    porUid?: string;
    porNome?: string;
    em?: Timestamp | Date | any;
    motivo?: string | null;
    observacao?: string | null;     // legado
  };

  formalizacao?: {
    status: FormalizacaoStatus;
    porUid?: string;
    porNome?: string;
    em?: Timestamp | Date | any;
    observacao?: string | null;
  };

  // NOVO: desistência (espelhado em formalização)
  desistencia?: {
    status: DesistenciaStatus;      // 'nao_desistiu' | 'desistiu'
    porUid?: string;
    porNome?: string;
    em?: Timestamp | Date | any;
    observacao?: string | null;
  };

  encaminhamento?: {
    assessorUid?: string | null;
    assessorId?: string | null;     // alias legado
    assessorNome?: string | null;
    em?: Timestamp | Date | any;
  };

  caixaAtual?: 'analista' | 'assessor';
  caixaUid?: string | null;

  destinatarioTipo?: 'analista' | 'assessor';
  destinatarioUid?: string | null;

  visivelParaUids?: string[];
  analistaId?: string | null;

  alocadoParaUid?: string | null;
  alocadoParaNome?: string | null;

  __col?: 'pre_cadastros' | 'pre-cadastros';

  /** Metadados de grupo (opcionais) */
  grupoNome?: string | null;
  /** 'coordenador' | 'membro' */



  // NOVOS CAMPOS:
  observacoes?: string | null;
  arquivos?: ArquivoPreCadastro[];   // opcional: meta dos arquivos no próprio doc


}
