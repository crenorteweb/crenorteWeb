export interface LinhaImportacao {
  index: number;           // número da linha na planilha (começa em 2, pois linha 1 é cabeçalho)
  nome: string;
  cpf: string;             // valor bruto da planilha
  cpfNumeros: string;      // apenas dígitos
  telefone: string;        // valor bruto da planilha
  telefoneNumeros: string; // apenas dígitos
  bairro: string;
  uf: string;
  municipio: string;
  origem: string;
  cadunicoRaw: string;
  modalidade: 'cadunico' | 'grupo_solidario';
  erros: string[];
  valida: boolean;
  duplicadaNaPlanilha?: boolean; // CPF repetido na própria planilha (não é erro de validação)
}

export interface ResultadoImportacao {
  importados: number;
  totalErros: number;
  duplicadasPlanilha: number;
  detalhesErro: Array<{ linha: number; nome: string; erros: string[] }>;
  linhasImportadas: LinhaImportacao[];
}
