import { Timestamp } from '@angular/fire/firestore';

/** Status operacional (workflow) */
export type GrupoStatus = 'rascunho' | 'ativo' | 'fechado' | 'cancelado';

/** Situação do grupo usada para triagem/distribuição */
export type GrupoSituacao = 'aprovado' | 'incompleto' | 'inapto';

/**
 * Metadados de um arquivo no nível do GRUPO (opcional).
 * A lógica é idêntica à usada em pré-cadastro (subcoleção /arquivos).
 */
export interface ArquivoGrupo {
  id: string;
  nome: string;
  url: string;
  tipo?: string | null;
  tamanho?: number | null;
  uploadedAt?: Timestamp | Date | any;
  uploadedByUid?: string;
  uploadedByNome?: string | null;
  storagePath?: string; // recomendado para remoção segura no Storage
}

/**
 * (Opcional) Estado/ações individuais por membro para UI.
 * NÃO altera sua estrutura de persistência (membrosIds continua sendo o vínculo oficial).
 * Use isso como “cache de visualização” carregado a partir dos pré-cadastros.
 */
export interface MembroGrupoView {
  preCadastroId: string;
  nome?: string | null;
  cpf?: string | null;
  telefone?: string | null;
  email?: string | null;

  agendamentoStatus?: 'nao_agendado' | 'agendado' | 'visitado';
  formalizacao?: { status: 'formalizado' | 'nao_formalizado'; porUid?: string; porNome?: string; em?: Timestamp | Date | any };
  desistencia?: { status: 'desistiu' | 'nao_desistiu'; porUid?: string; porNome?: string; em?: Timestamp | Date | any; observacao?: string | null };

  // (opcional) distribuição individual (seu schema oficial já prevê em distribuicao.membros)
  assessorUid?: string | null;
  assessorNome?: string | null;
}

/**
 * Modelo principal do GRUPO, mantendo seu schema oficial + campos opcionais
 * APENAS para UI/denormalização leve.
 */
export interface GrupoSolidario {
  id: string;
  nome: string;

  criadoEm: Timestamp | Date | any;
  criadoPorUid: string;
  criadoPorNome?: string;

  /**
   * Coordenador do grupo (referência a um pré-cadastro APTO).
   * Mantido conforme seu modelo (Uid); use esse valor para buscar o documento
   * de pré-cadastro correspondente e preencher os campos “coordenadorView”.
   */
  coordenadorUid?: string | null;
  coordenadorNome?: string | null;

  cidade?: string | null;
  uf?: string | null;

  capacidadeMin: number;            // ex.: 3
  capacidadeMax: number;            // ex.: 10

  /** Vínculo oficial com pré-cadastros: IDs dos participantes */
  membrosIds: string[];
  membrosCount: number;

  /** Status operacional (workflow) */
  status: GrupoStatus;

  /** Situação calculada (regra de aptidão/tamanho) */
  situacao: GrupoSituacao;

  /** Informações para distribuição (grupo ou por membro) */
  distribuicao?: {
    groupAssessorUid?: string | null;
    groupAssessorNome?: string | null;
    membros?: Array<{
      preCadastroId: string;
      assessorUid: string;
      assessorNome?: string;
    }>;
    distribuidoEm?: Timestamp | Date | any;
    distribuidoPorUid?: string;
    distribuidoPorNome?: string;
  };

  // ✅ Adicione estes (usados na triagem e relatório)
  encaminhadoParaUid?: string | null;
  encaminhadoParaNome?: string | null;
  encaminhadoEm?: any | null;
  encaminhadoPorUid?: string | null;
  encaminhadoPorNome?: string | null;

  /** Convite de grupo */
  inviteToken: string;              // token curto
  inviteUrl?: string;               // URL pronta para compartilhar

  /** Observações no nível do grupo */
  observacoes?: string | null;

  // =========================
  // 🔽 Campos Opcionais (UI)
  // =========================

  /**
   * Denormalização leve do coordenador (somente para renderização rápida nos cards).
   * Preencha em tempo de leitura juntando com o pré-cadastro do coordenador.
   */
  coordenadorView?: {
    preCadastroId?: string | null;
    nome?: string | null;
    cpf?: string | null;
    telefone?: string | null;
    email?: string | null;
    endereco?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;

    agendamentoStatus?: 'nao_agendado' | 'agendado' | 'visitado';
    formalizacao?: { status: 'formalizado' | 'nao_formalizado'; porUid?: string; porNome?: string; em?: Timestamp | Date | any };
    desistencia?: { status: 'desistiu' | 'nao_desistiu'; porUid?: string; porNome?: string; em?: Timestamp | Date | any; observacao?: string | null };
  };

  /**
   * Lista expandida de membros para UI (carregada via join nos pré-cadastros).
   * NÃO é persistida como fonte de verdade; use como “view model”.
   */
  membrosView?: MembroGrupoView[];

  /**
   * Métricas de atalho para o card (pode ser calculado em memória).
   */
  metrics?: {
    total: number;
    aptos: number;
    agendados: number;
    formalizados: number;
    desistentes: number;
  };

  /**
   * (Opcional) Arquivos anexados ao grupo (caso queira permitir upload no nível do grupo).
   * Se usar, armazene como subcoleção: grupos_solidarios/{id}/arquivos
   */
  arquivos?: ArquivoGrupo[];
}
