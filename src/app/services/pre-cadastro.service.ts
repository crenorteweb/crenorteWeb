// src/app/services/pre-cadastro.service.ts
import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
  limit as fsLimit,
  CollectionReference,
  DocumentData,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  deleteField,
  documentId,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { PreCadastro, ElegibilidadeStatus, AtendimentoStatus, ObservacaoPreCadastro } from '../models/pre-cadastro.model';

// Storage (upload/download/remover)
import {
  Storage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from '@angular/fire/storage';

import type { ArquivoPreCadastro } from '../models/pre-cadastro.model';

type UsuarioAssessor = {
  uid: string;
  nome: string;
  papel: 'assessor' | string;
  supervisorUid?: string | null;
  analistaResponsavelUid?: string | null;
};

export const UFS_NORTE = ['PA', 'AC', 'AP', 'AM', 'RO', 'RR', 'TO', 'MA', 'MT'] as const;

export function filtrarUfsNorte<T>(rows: T[]): T[] {
  return rows.filter(r => UFS_NORTE.includes(((r as any)?.uf ?? '').toString().toUpperCase().trim() as any));
}

@Injectable({ providedIn: 'root' })
export class PreCadastroService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private storage = inject(Storage);

  private colRef: CollectionReference<DocumentData> =
    collection(this.db, 'pre_cadastros') as CollectionReference<DocumentData>;

  /* ========== CRUD Básico ========== */

  async criar(
    data: Omit<PreCadastro, 'id' | 'createdAt' | 'createdByUid' | 'createdByNome' | 'aprovacao'>
  ): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    let createdByNome = 'Assessor';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      createdByNome = (snap.data() as any)?.papel
        ? ((snap.data() as any)?.nome || user.displayName || 'Assessor')
        : (user.displayName || 'Assessor');
    } catch {}

    const payload = {
      ...data,
      aprovacao: { status: 'nao_verificado' as const },
      elegivel: { status: 'nao_verificado' as const },
      atendimento: { status: 'nao_atendido' as const },
      encaminhamento: null,
      createdByUid: user.uid,
      createdByNome,
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(this.colRef, payload);
    return ref.id;
  }

  async salvarFluxoCaixa(
    preCadastroId: string,
    fluxoCaixa: any,
    totais: { receita: number; custos: number; lucro: number }
  ): Promise<void> {
    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      fluxoCaixa,
      fluxoCaixaTotais: totais,
      fluxoAtualizadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });
  }

  async registrarFeedbackCliente(preCadastroId: string, feedback: any): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const col = collection(this.db, `pre_cadastros/${preCadastroId}/feedback_cliente`);
    await addDoc(col, {
      ...feedback,
      assessorUid: user.uid,
      source: 'cliente',
      createdAt: serverTimestamp(),
    });
  }

  /* ========== Listagens ========== */

  async listarDoAssessor(uid?: string): Promise<PreCadastro[]> {
    const useUid = uid ?? this.auth.currentUser?.uid;
    if (!useUid) throw new Error('Usuário não autenticado.');

    try {
      const qy = query(this.colRef, where('createdByUid', '==', useUid), orderBy('createdAt', 'desc'), fsLimit(500));
      const snap = await getDocs(qy);
      return filtrarUfsNorte(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[]);
    } catch {
      const qy = query(this.colRef, where('createdByUid', '==', useUid), fsLimit(500));
      const snap = await getDocs(qy);
      const rows = filtrarUfsNorte(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[]);

      const ms = (x: any) =>
        x?.toMillis ? x.toMillis() :
        x?.toDate ? x.toDate().getTime() :
        (typeof x === 'number' ? x : 0);

      rows.sort((a: any, b: any) => (ms(b.createdAt) - ms(a.createdAt)));
      return rows;
    }
  }

  async listarTodos(): Promise<PreCadastro[]> {
    const qy = query(this.colRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(qy);
    return filtrarUfsNorte(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[]);
  }

  /**
   * NOVO: Busca por uma lista de IDs (para espelhar pessoas de grupos).
   */
  async buscarPorCpf(cpf: string): Promise<PreCadastro[]> {
    if (!cpf) return [];
    const [snap1, snap2] = await Promise.all([
      getDocs(query(collection(this.db, 'pre_cadastros'), where('cpf', '==', cpf))),
      getDocs(query(collection(this.db, 'pre-cadastros'), where('cpf', '==', cpf))),
    ]);
    const seen = new Set<string>();
    const result: PreCadastro[] = [];
    for (const snap of [snap1, snap2]) {
      snap.docs.forEach(d => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          result.push({ id: d.id, ...(d.data() as any) } as PreCadastro);
        }
      });
    }
    return result;
  }

  async listarPorIds(ids: string[]): Promise<PreCadastro[]> {
    if (!ids?.length) return [];
    const out: PreCadastro[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const qy = query(this.colRef, where(documentId(), 'in', chunk));
      const snap = await getDocs(qy);
      snap.docs.forEach(d => out.push({ id: d.id, ...(d.data() as any) } as PreCadastro));
    }
    return out;
  }

  /* ========== Atualizações / Remoções ========== */

  async atualizar(id: string, patch: Partial<PreCadastro>): Promise<void> {
    const clean: Record<string, any> = {};
    Object.entries(patch).forEach(([k, v]) => {
      if (v !== undefined) clean[k] = v;
    });
    if (!('atualizadoEm' in clean)) clean['atualizadoEm'] = serverTimestamp();
    await updateDoc(doc(this.db, 'pre_cadastros', id), clean);
  }

  async remover(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'pre_cadastros', id));
  }

  async removerDeep(id: string, opts?: { feedbackCliente?: boolean }): Promise<void> {
    if (opts?.feedbackCliente) {
      const subCol = collection(this.db, `pre_cadastros/${id}/feedback_cliente`);
      const subSnap = await getDocs(subCol);
      await Promise.all(subSnap.docs.map(d => deleteDoc(d.ref)));
    }
    await deleteDoc(doc(this.db, 'pre_cadastros', id));
  }

  async atualizarStatusAgendamento(
    id: string,
    status: 'nao_agendado' | 'agendado' | 'visitado',
    agendamentoId?: string | null
  ) {
    return this.atualizar(id, { agendamentoStatus: status, agendamentoId: agendamentoId ?? null } as any);
  }

  /* ========== Aprovação ========== */

  async listarParaAprovacao(): Promise<PreCadastro[]> {
    try {
      const qy = query(this.colRef, where('aprovacao.status', 'in', ['inapto', 'apto']));
      const snap = await getDocs(qy);
      const rows = filtrarUfsNorte(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[]);
      rows.sort((a: any, b: any) => {
        const ms = (x: any) =>
          x?.toMillis ? x.toMillis() :
          x?.toDate ? x.toDate().getTime() :
          (typeof x === 'number' ? x : 0);
        return (ms(b.createdAt) - ms(a.createdAt));
      });
      return rows;
    } catch {
      const snap = await getDocs(this.colRef);
      const rows = filtrarUfsNorte(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[]);
      const filtrados = rows.filter(r => ['inapto', 'apto'].includes(r?.aprovacao?.status ?? 'inapto'));
      filtrados.sort((a: any, b: any) => {
        const ms = (x: any) =>
          x?.toMillis ? x.toMillis() :
          x?.toDate ? x.toDate().getTime() :
          (typeof x === 'number' ? x : 0);
        return (ms(b.createdAt) - ms(a.createdAt));
      });
      return filtrados;
    }
  }

  async marcarApto(preCadastroId: string, observacao?: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    let aprovadorNome = user.displayName || 'Analista';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      aprovadorNome = (snap.data() as any)?.nome || aprovadorNome;
    } catch {}

    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      aprovacao: {
        status: 'apto',
        porUid: user.uid,
        porNome: aprovadorNome,
        em: serverTimestamp(),
        observacao: observacao ?? null,
      },
      atualizadoEm: serverTimestamp(),
    } as any);
  }

  async listarAssessoresDoAnalista(opts?: { usarSupervisor?: boolean; uidBase?: string }): Promise<UsuarioAssessor[]> {
    const user = this.auth.currentUser;
    if (!user && !opts?.uidBase) throw new Error('Usuário não autenticado.');
    const baseUid = opts?.uidBase ?? user!.uid;

    let qy = query(
      collection(this.db, 'colaboradores'),
      where('papel', '==', 'assessor'),
      where('analistaResponsavelUid', '==', baseUid)
    );
    let snap = await getDocs(qy);

    if (snap.empty || opts?.usarSupervisor) {
      qy = query(
        collection(this.db, 'colaboradores'),
        where('papel', '==', 'assessor'),
        where('supervisorUid', '==', baseUid)
      );
      snap = await getDocs(qy);
    }

    return snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) })) as UsuarioAssessor[];
  }

  async listarParaCaixa(uid: string | string[]): Promise<PreCadastro[]> {
    const uids = [...new Set(Array.isArray(uid) ? uid : [uid])].filter(Boolean);
    if (!uids.length) throw new Error('uid obrigatório');

    // Firestore 'in' aceita no máximo 10 valores por query
    const chunks: string[][] = [];
    for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

    const LIMIT = 500;
    const rows: PreCadastro[] = [];

    // Tenta query com orderBy (requer índice composto); se falhar usa fallback sem ordenação
    const tryGet = async (qy: any, fallback?: any) => {
      try {
        const snap = await getDocs(qy);
        snap.docs.forEach(d => rows.push({ id: d.id, ...(d.data() as any) } as PreCadastro));
      } catch {
        if (fallback) {
          try {
            const snap = await getDocs(fallback);
            snap.docs.forEach(d => rows.push({ id: d.id, ...(d.data() as any) } as PreCadastro));
          } catch {}
        }
      }
    };

    await Promise.all(chunks.map(chunk => {
      const eq = (field: string) =>
        chunk.length === 1
          ? where(field, '==', chunk[0])
          : where(field, 'in', chunk);
      return Promise.all([
        tryGet(
          query(this.colRef, eq('caixaUid'), orderBy('createdAt', 'desc'), fsLimit(LIMIT)),
          query(this.colRef, eq('caixaUid'), fsLimit(LIMIT))
        ),
        tryGet(
          query(this.colRef, eq('encaminhamento.assessorUid'), orderBy('createdAt', 'desc'), fsLimit(LIMIT)),
          query(this.colRef, eq('encaminhamento.assessorUid'), fsLimit(LIMIT))
        ),
        tryGet(
          query(this.colRef, eq('createdByUid'), orderBy('createdAt', 'desc'), fsLimit(LIMIT)),
          query(this.colRef, eq('createdByUid'), fsLimit(LIMIT))
        ),
      ]);
    }));

    const ms = (x: any) => x?.toMillis ? x.toMillis() : x?.toDate ? x.toDate().getTime() : (typeof x === 'number' ? x : 0);
    const map = new Map<string, PreCadastro>();
    rows.forEach(r => map.set(r.id, r));
    return filtrarUfsNorte(Array.from(map.values())).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt));
  }

  async enviarParaAssessor(preCadastroId: string, assessorUid: string, assessorNome?: string): Promise<void> {
    let nome = assessorNome ?? '';
    if (!nome) {
      try {
        const snap = await getDoc(doc(this.db, 'colaboradores', assessorUid));
        nome = (snap.data() as any)?.nome || '';
      } catch {}
    }
    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      encaminhamento: {
        assessorUid,
        assessorNome: nome || null,
        em: serverTimestamp(),
      },
      atualizadoEm: serverTimestamp(),
    } as any);
  }

  /**
   * Repasse feito pelo ASSESSOR ou pelo ANALISTA de volta para a caixa geral
   * de triagem — usado quando não teve sucesso no atendimento/contato do
   * cliente (assessor) ou quando quer tirar o item da própria caixa (analista).
   *
   * - Limpa TODOS os vínculos de caixa/designação/encaminhamento atuais
   *   (caixaUid, caixaAtual, designadoPara*, encaminhamento legado,
   *   analista*, encaminhadoPara*, encaminhadoPor*), fazendo o registro
   *   voltar a aparecer como "sem dono" na fila geral de triagem (que lista
   *   todos os pré-cadastros via collectionGroup, sem filtro de dono) e
   *   também sumir de qualquer "Minha Caixa" (assessor ou analista), já que
   *   ambas as telas verificam esses mesmos campos para decidir o que exibir.
   * - Registra o insucesso em `atendimento` (status volta para 'nao_atendido'
   *   com o motivo como observação) e em `repasseCaixa`, para histórico.
   * - Também grava uma observação no histórico de comentários do pré-cadastro.
   *
   * Observação: se quem repassou foi também quem criou o pré-cadastro
   * (createdByUid), ele continua aparecendo na "Minha Lista"/lista de
   * criados dele — o que é esperado, pois `listarParaCaixa`/`listarDoAssessor`
   * também buscam por createdByUid. O repasse apenas o torna
   * visível/disponível para outra pessoa assumir via triagem.
   */
  async repassarParaCaixa(preCadastroId: string, motivo: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const motivoLimpo = (motivo ?? '').trim();
    if (!motivoLimpo) throw new Error('Informe o motivo do repasse.');

    let porNome = user.displayName || 'Assessor';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      porNome = (snap.data() as any)?.nome || porNome;
    } catch {}

    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      // limpa vínculos de caixa/designação atuais
      caixaUid: deleteField(),
      caixaAtual: deleteField(),
      designadoParaUid: deleteField(),
      designadoPara: deleteField(),
      designadoParaNome: deleteField(),
      designadoEm: deleteField(),
      encaminhamento: null,
      analistaUid: deleteField(),
      analistaNome: deleteField(),
      analistaEm: deleteField(),
      encaminhadoParaUid: deleteField(),
      encaminhadoParaNome: deleteField(),
      encaminhadoEm: deleteField(),
      encaminhadoPorUid: deleteField(),
      encaminhadoPorNome: deleteField(),

      // registra o insucesso no atendimento
      'atendimento.status': 'nao_atendido',
      'atendimento.porUid': user.uid,
      'atendimento.porNome': porNome,
      'atendimento.em': serverTimestamp(),
      'atendimento.observacao': motivoLimpo,

      repasseCaixa: {
        motivo: motivoLimpo,
        porUid: user.uid,
        porNome,
        em: serverTimestamp(),
      },
      atualizadoEm: serverTimestamp(),
    } as any);

    try {
      await this.adicionarObservacao(
        preCadastroId,
        `Repassado para a caixa geral (não atendido): ${motivoLimpo}`,
        { uid: user.uid, nome: porNome }
      );
    } catch (e) {
      console.warn('[repassarParaCaixa] Falha ao registrar observação de histórico:', e);
    }
  }

  /* ========== Elegibilidade ========== */

  async registrarElegibilidade(preCadastroId: string, status: ElegibilidadeStatus): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    let porNome = user.displayName || 'Analista';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      porNome = (snap.data() as any)?.nome || porNome;
    } catch {}

    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      'elegivel.status': status,
      'elegivel.porUid': user.uid,
      'elegivel.porNome': porNome,
      'elegivel.em': serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });
  }

  /* ========== Atendimento ========== */

  async registrarAtendimento(
    preCadastroId: string,
    status: AtendimentoStatus,
    observacao?: string | null
  ): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    let porNome = user.displayName || 'Analista';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      porNome = (snap.data() as any)?.nome || porNome;
    } catch {}

    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      'atendimento.status': status,
      'atendimento.porUid': user.uid,
      'atendimento.porNome': porNome,
      'atendimento.em': serverTimestamp(),
      'atendimento.observacao': observacao ?? null,
      atualizadoEm: serverTimestamp(),
    });
  }

  /* ========== Observações ========== */

  async atualizarObservacoes(preId: string, observacoes: string | null): Promise<void> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    await updateDoc(doc(this.db, 'pre_cadastros', preId), {
      observacoes: observacoes ?? null,
      atualizadoEm: serverTimestamp(),
    });
  }

  private observacoesCol(preId: string) {
    return collection(this.db, `pre_cadastros/${preId}/observacoes`);
  }

  async listarObservacoes(preId: string): Promise<ObservacaoPreCadastro[]> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    const qy = query(this.observacoesCol(preId), orderBy('criadoEm', 'desc'));
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ObservacaoPreCadastro[];
  }

  async adicionarObservacao(
    preId: string,
    texto: string,
    usuario: { uid: string; nome: string },
    dataCriacao?: any
  ): Promise<ObservacaoPreCadastro> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');

    const novaObs = {
      texto: texto.trim(),
      criadoEm: dataCriacao || serverTimestamp(),
      criadoPorUid: usuario.uid,
      criadoPorNome: usuario.nome,
    };

    const docRef = await addDoc(this.observacoesCol(preId), novaObs);
    return { id: docRef.id, ...novaObs } as any;
  }

  async removerObservacao(preId: string, observacaoId: string): Promise<void> {
    if (!preId || !observacaoId) throw new Error('IDs obrigatórios');
    const docRef = doc(this.db, `pre_cadastros/${preId}/observacoes/${observacaoId}`);
    await deleteDoc(docRef);
  }

  async limparObservacaoRaiz(preId: string): Promise<void> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    await updateDoc(doc(this.db, 'pre_cadastros', preId), {
      observacoes: null,
      atualizadoEm: serverTimestamp(),
    });
  }

  /* ========== Arquivos ========== */

  private arquivosCol(preId: string) {
    return collection(this.db, `pre_cadastros/${preId}/arquivos`);
  }

  async listarArquivos(preId: string): Promise<ArquivoPreCadastro[]> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    const qy = query(this.arquivosCol(preId), orderBy('uploadedAt', 'desc'));
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ArquivoPreCadastro[];
  }

  async uploadArquivo(
    preId: string,
    file: File,
    currentUser: { uid: string; nome?: string | null }
  ): Promise<ArquivoPreCadastro> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    if (!file) throw new Error('Arquivo inválido.');

    const time = Date.now();
    const safeName = (file.name || 'arquivo').replace(/[^\w.\-]+/g, '_');
    const path = `pre-cadastros/${preId}/${time}-${safeName}`;

    const ref = storageRef(this.storage, path);
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);

    const meta = {
      nome: file.name,
      url,
      tipo: (file as any).type || null,
      tamanho: (file as any).size ?? null,
      uploadedAt: serverTimestamp(),
      uploadedByUid: currentUser.uid,
      uploadedByNome: currentUser.nome ?? null,
      storagePath: path,
    };

    const docRef = await addDoc(this.arquivosCol(preId), meta);
    return { id: docRef.id, ...(meta as any) } as ArquivoPreCadastro;
  }

  async removerArquivo(preId: string, arquivoId: string): Promise<void> {
    if (!preId || !arquivoId) throw new Error('IDs obrigatórios');

    const metaRef = doc(this.db, `pre_cadastros/${preId}/arquivos/${arquivoId}`);
    const metaSnap = await getDoc(metaRef);
    if (metaSnap.exists()) {
      const data = metaSnap.data() as any;
      const storagePath: string | undefined = data?.storagePath;
      try {
        if (storagePath) {
          const sref = storageRef(this.storage, storagePath);
          await deleteObject(sref);
        }
      } catch (e) {
        console.warn('[removerArquivo] Falha ao remover no Storage, seguindo:', e);
      }
    }

    await deleteDoc(metaRef);
  }
}
