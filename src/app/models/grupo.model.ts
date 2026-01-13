export type StatusGrupo = 'em_qa' | 'aprovado_basa' | 'reprovado_basa';

export interface MembroGrupo {
  cpf: string;
  nome?: string;
  papel: 'coordenador' | 'membro';
  cadastroId?: string;        // opcional: id do doc em /clientes
  valorSolicitado?: number;   // se quiser somar por membro
}

export interface GrupoSolidario {
  id?: string;
  codigo?: string;            // identificador interno/sequencial se quiser
  coordenadorCpf: string;     // chave de vínculo
  coordenadorNome?: string;

  membros: MembroGrupo[];     // inclui o coordenador
  cidade?: string;
  estado?: string;

  status: StatusGrupo;        // em_qa (pós criação), aprovado_basa, reprovado_basa
  statusHistory?: Array<{
    at: Date | any;
    byUid: string;
    byNome?: string;
    from?: StatusGrupo;
    to: StatusGrupo;
    note?: string;
  }>;

  criadoEm: Date | any;
  criadoPorUid: string;
  criadoPorNome?: string;

  // campos úteis para export/QA
  totalSolicitado?: number;
  observacoes?: string;
}
