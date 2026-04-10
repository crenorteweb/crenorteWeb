import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
  getDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import * as XLSX from 'xlsx';
import { LinhaImportacao, ResultadoImportacao } from './importacao-excel.model';

const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const CADUNICO_SIM = new Set(['sim', 's', 'yes', 'y', '1', 'true']);

@Injectable({ providedIn: 'root' })
export class ImportacaoExcelService {
  private db = inject(Firestore);
  private auth = inject(Auth);

  /** Lê o arquivo Excel e retorna as linhas brutas (sem validação). */
  parseExcel(file: File): Promise<LinhaImportacao[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

          // Precisa de pelo menos cabeçalho + 1 linha de dados
          if (rows.length < 2) {
            resolve([]);
            return;
          }

          const linhas: LinhaImportacao[] = rows
            .slice(1) // pula cabeçalho
            .filter((row) => row.some((cell) => String(cell).trim() !== ''))
            .map((row, i) => {
              const nome = String(row[0] ?? '').trim();
              const cpfRaw = String(row[1] ?? '').trim();
              const telefoneRaw = String(row[2] ?? '').trim();
              const bairro = String(row[3] ?? '').trim();
              const uf = String(row[4] ?? '').trim().toUpperCase();
              const municipio = String(row[5] ?? '').trim();
              const origem = String(row[6] ?? '').trim();
              const cadunicoRaw = String(row[7] ?? '').trim();

              const cpfNumeros = cpfRaw.replace(/\D/g, '');
              const telefoneNumeros = telefoneRaw.replace(/\D/g, '');
              const modalidade: 'cadunico' | 'grupo_solidario' =
                CADUNICO_SIM.has(cadunicoRaw.toLowerCase()) ? 'cadunico' : 'grupo_solidario';

              return {
                index: i + 2, // linha 1 é cabeçalho, dados começam na linha 2
                nome,
                cpf: cpfRaw,
                cpfNumeros,
                telefone: telefoneRaw,
                telefoneNumeros,
                bairro,
                uf,
                municipio,
                origem,
                cadunicoRaw,
                modalidade,
                erros: [],
                valida: false,
              };
            });

          resolve(linhas);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /** Valida campos obrigatórios e formatos. Não acessa o Firestore. */
  validarFormatos(linhas: LinhaImportacao[]): LinhaImportacao[] {
    return linhas.map((l) => {
      const erros: string[] = [];

      if (!l.nome || l.nome.length < 3)
        erros.push('Nome obrigatório (mínimo 3 caracteres)');

      if (!l.cpfNumeros) {
        erros.push('CPF obrigatório');
      } else if (l.cpfNumeros.length !== 11) {
        erros.push(`CPF inválido: "${l.cpf}" (deve ter 11 dígitos)`);
      }

      if (!l.telefoneNumeros) {
        erros.push('Telefone obrigatório');
      } else if (l.telefoneNumeros.length < 10 || l.telefoneNumeros.length > 11) {
        erros.push(`Telefone inválido: "${l.telefone}" (10 ou 11 dígitos com DDD)`);
      }

      if (!l.bairro) erros.push('Bairro obrigatório');

      if (!l.uf) {
        erros.push('UF obrigatória');
      } else if (!UFS_VALIDAS.has(l.uf)) {
        erros.push(`UF inválida: "${l.uf}" (use sigla de 2 letras, ex.: CE, SP)`);
      }

      if (!l.municipio) erros.push('Município obrigatório');
      if (!l.origem) erros.push('Origem obrigatória');

      if (!l.cadunicoRaw)
        erros.push('Campo Cadúnico obrigatório (aceitos: Sim, Não, S, N, Yes, No)');

      return { ...l, erros, valida: erros.length === 0 };
    });
  }

  /**
   * Verifica CPFs duplicados:
   * 1) duplicatas dentro da própria planilha
   * 2) CPFs já cadastrados no Firestore (chunks de 30 para respeitar limite do operador `in`)
   */
  async verificarCpfsDuplicados(linhas: LinhaImportacao[]): Promise<LinhaImportacao[]> {
    const cpfsParaVerificar = linhas
      .filter((l) => l.valida && l.cpfNumeros.length === 11)
      .map((l) => l.cpfNumeros);

    // Divide em chunks de 30 (limite do Firestore para o operador `in`)
    const cpfsDuplicadosFirestore = new Set<string>();
    if (cpfsParaVerificar.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < cpfsParaVerificar.length; i += 30) {
        chunks.push(cpfsParaVerificar.slice(i, i + 30));
      }

      const colRef = collection(this.db, 'pre_cadastros');
      for (const chunk of chunks) {
        const q = query(colRef, where('cpf', 'in', chunk));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const cpf = (d.data() as any)?.cpf;
          if (cpf) cpfsDuplicadosFirestore.add(cpf);
        });
      }
    }

    // Detecta duplicatas dentro da própria planilha (guarda índice da 1ª ocorrência)
    const cpfsVistosPlanilha = new Map<string, number>();

    return linhas.map((l) => {
      if (!l.valida || l.cpfNumeros.length !== 11) return l;

      // Duplicata na planilha — mantém apenas a 1ª ocorrência, sem contar como erro de validação
      if (cpfsVistosPlanilha.has(l.cpfNumeros)) {
        return { ...l, duplicadaNaPlanilha: true, valida: false };
      }
      cpfsVistosPlanilha.set(l.cpfNumeros, l.index);

      // Duplicata no Firestore
      if (cpfsDuplicadosFirestore.has(l.cpfNumeros)) {
        return {
          ...l,
          erros: [...l.erros, 'CPF já cadastrado no sistema'],
          valida: false,
        };
      }

      return l;
    });
  }

  /**
   * Executa a importação em lotes de até 500 registros (limite do Firestore).
   * Rejeita se o usuário autenticado não for admin.
   */
  async importar(
    linhas: LinhaImportacao[],
    onProgress?: (atual: number, total: number) => void
  ): Promise<ResultadoImportacao> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    // Verificação programática: apenas admin pode importar
    const colabSnap = await getDoc(doc(this.db, 'colaboradores', user.uid));
    const papel = (colabSnap.data() as any)?.papel ?? '';
    if (papel !== 'admin') {
      throw new Error('Apenas administradores podem realizar importações em massa.');
    }

    const linhasValidas = linhas.filter((l) => l.valida);
    const detalhesErro = linhas
      .filter((l) => !l.valida && !l.duplicadaNaPlanilha)
      .map((l) => ({ linha: l.index, nome: l.nome, erros: l.erros }));
    const duplicadasPlanilha = linhas.filter((l) => l.duplicadaNaPlanilha).length;

    if (linhasValidas.length === 0) {
      return { importados: 0, totalErros: detalhesErro.length, duplicadasPlanilha, detalhesErro, linhasImportadas: [] };
    }

    const colRef = collection(this.db, 'pre_cadastros');
    let importados = 0;
    const BATCH_SIZE = 500;

    for (let i = 0; i < linhasValidas.length; i += BATCH_SIZE) {
      const chunk = linhasValidas.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(this.db);

      for (const linha of chunk) {
        const newDocRef = doc(colRef);
        batch.set(newDocRef, {
          nomeCompleto: linha.nome,
          cpf: linha.cpfNumeros,
          telefone: linha.telefoneNumeros,
          bairro: linha.bairro,
          uf: linha.uf,
          cidade: linha.municipio,
          modalidade: linha.modalidade,
          email: '',
          sexo: '',
          origem: linha.origem,
          aprovacao: { status: 'nao_verificado' },
          agendamentoStatus: 'nao_agendado',
          formalizacao: { status: 'nao_formalizado' },
          desistencia: { status: 'nao_desistiu' },
          createdByUid: user.uid,
          createdByNome: (colabSnap.data() as any)?.nome ?? user.displayName ?? 'Admin',
          createdAt: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        });
      }

      await batch.commit();
      importados += chunk.length;
      onProgress?.(importados, linhasValidas.length);
    }

    return { importados, totalErros: detalhesErro.length, duplicadasPlanilha, detalhesErro, linhasImportadas: linhasValidas };
  }

  /** Gera e faz download de uma planilha com os registros importados com sucesso. */
  exportarCadastrados(linhas: LinhaImportacao[]): void {
    const wb = XLSX.utils.book_new();

    const linhas_ = [
      ['Nome', 'CPF', 'Telefone', 'Bairro', 'UF', 'Município', 'Origem', 'Modalidade'],
      ...linhas.map(l => [
        l.nome,
        l.cpfNumeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
        l.telefoneNumeros,
        l.bairro,
        l.uf,
        l.municipio,
        l.origem,
        l.modalidade === 'cadunico' ? 'Cadúnico' : 'Grupo Solidário',
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(linhas_);
    ws['!cols'] = [
      { wch: 30 }, { wch: 16 }, { wch: 16 },
      { wch: 20 }, { wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Cadastrados');

    const hoje = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `clientes_cadastrados_${hoje}.xlsx`);
  }

  /** Gera e faz download de um arquivo Excel modelo com instruções. */
  downloadTemplate(): void {
    const wb = XLSX.utils.book_new();

    // Aba 1: Planilha de importação
    const dadosSheet = [
      ['nome', 'cpf', 'telefone', 'bairro', 'uf', 'municipio', 'origem', 'cadunico'],
      ['Maria da Silva', '12345678901', '85998765432', 'Centro', 'CE', 'Fortaleza', 'Indicação', 'Sim'],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(dadosSheet);
    ws1['!cols'] = [
      { wch: 30 }, { wch: 16 }, { wch: 16 },
      { wch: 20 }, { wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Importação');

    // Aba 2: Instruções
    const instrucoes = [
      ['INSTRUÇÕES DE PREENCHIMENTO'],
      [''],
      ['Coluna', 'Descrição', 'Obrigatório', 'Exemplo'],
      ['nome', 'Nome completo do cliente', 'Sim (mínimo 3 caracteres)', 'Maria da Silva'],
      ['cpf', 'CPF (somente números ou com máscara)', 'Sim (11 dígitos)', '12345678901 ou 123.456.789-01'],
      ['telefone', 'Telefone com DDD (somente números)', 'Sim (10 ou 11 dígitos)', '85998765432'],
      ['bairro', 'Nome do bairro', 'Sim', 'Centro'],
      ['uf', 'Sigla do estado (2 letras)', 'Sim', 'CE'],
      ['municipio', 'Nome do município', 'Sim', 'Fortaleza'],
      ['origem', 'Como o cliente chegou até a empresa', 'Sim', 'Indicação, Redes Sociais, etc.'],
      ['cadunico', 'Possui Cadúnico?', 'Sim', 'Sim ou Não'],
      [''],
      ['VALORES ACEITOS PARA "cadunico":'],
      ['→ Para SIM: Sim, sim, S, s, Yes, yes'],
      ['→ Para NÃO: Não, Nao, N, n, No, no (ou qualquer outro valor)'],
      [''],
      ['OBSERVAÇÕES:'],
      ['• Não altere os cabeçalhos da aba "Importação"'],
      ['• A linha 1 é o cabeçalho — não a remova'],
      ['• Cada linha seguinte representa um cliente'],
      ['• CPFs duplicados (já cadastrados) serão ignorados'],
      ['• Linhas com erros de preenchimento não serão importadas'],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(instrucoes);
    ws2['!cols'] = [{ wch: 12 }, { wch: 50 }, { wch: 38 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Instruções');

    XLSX.writeFile(wb, 'modelo_importacao_clientes.xlsx');
  }
}
