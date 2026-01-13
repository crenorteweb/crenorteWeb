// src/app/services/grupo-solidario.service.ts
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  documentId,
  orderBy,
} from '@angular/fire/firestore';

import { Auth } from '@angular/fire/auth';

import {
  GrupoSolidario,
  GrupoStatus,            // 'rascunho' | 'ativo' | 'fechado' | 'cancelado'
  MembroGrupoView,
} from '../models/grupo-solidario.model';
import { PreCadastro } from '../models/pre-cadastro.model';

/* ========== Utils ========== */
function randomToken(len = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Firestore limita 'in' a 10 ids por query
async function fetchPreCadastrosByIds(fs: Firestore, ids: string[]): Promise<PreCadastro[]> {
  const out: PreCadastro[] = [];
  if (!ids?.length) return out;
  const col = collection(fs, 'pre_cadastros');

  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const qy = query(col, where(documentId(), 'in', chunk));
    const snap = await getDocs(qy);
    snap.docs.forEach(d => out.push({ id: d.id, ...(d.data() as any) } as PreCadastro));
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class GrupoSolidarioService {
  private fs = inject(Firestore);
  private auth = inject(Auth);

  /* =========================
   * EXISTENTES (mantidos)
   * ========================= */

  async listarAptosPorPeriodo(de: string | null, ate: string | null): Promise<PreCadastro[]> {
    const colRef = collection(this.fs, 'pre_cadastros');
    const clauses: any[] = [where('aprovacao.status', '==', 'apto')];

    if (de) clauses.push(where('createdAt', '>=', new Date(de + 'T00:00:00')));
    if (ate) clauses.push(where('createdAt', '<=', new Date(ate + 'T23:59:59')));

    const qy = query(colRef, ...clauses as any);
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
  }

  buildInviteUrl(groupId: string, token: string): string {
    const base = (typeof window !== 'undefined' && window?.location?.origin) || 'https://app.seudominio.com';
    return `${base}/pre-cadastro/novo?grupo=${encodeURIComponent(groupId)}&token=${encodeURIComponent(token)}`;
  }

  async criarGrupo(payload: {
    nome: string;
    criadoPorUid: string;
    criadoPorNome?: string;
    cidade?: string | null;
    uf?: string | null;
    capacidadeMin?: number;
    capacidadeMax?: number;
    membrosIds?: string[];
    coordenadorUid?: string | null;
    coordenadorNome?: string | null;
    observacoes?: string | null;
  }): Promise<GrupoSolidario> {
    const token = randomToken(10);
    const ref = await addDoc(collection(this.fs, 'grupos_solidarios'), {
      nome: payload.nome,
      criadoPorUid: payload.criadoPorUid,
      criadoPorNome: payload.criadoPorNome || null,
      criadoEm: serverTimestamp(),
      cidade: payload.cidade || null,
      uf: payload.uf || null,
      capacidadeMin: payload.capacidadeMin ?? 3,
      capacidadeMax: payload.capacidadeMax ?? 10,
      membrosIds: payload.membrosIds || [],
      membrosCount: (payload.membrosIds || []).length,
      status: 'rascunho' as GrupoStatus,
      situacao: 'incompleto',
      inviteToken: token,
      observacoes: payload.observacoes || null,
      coordenadorUid: payload.coordenadorUid || null,
      coordenadorNome: payload.coordenadorNome || null,
    });

    const inviteUrl = this.buildInviteUrl(ref.id, token);
    await updateDoc(ref, { inviteUrl });

    const snap = await getDoc(ref);
    return { id: ref.id, ...(snap.data() as any) } as GrupoSolidario;
  }

  async adicionarMembros(grupoId: string, novosIds: string[]) {
    const ref = doc(this.fs, 'grupos_solidarios', grupoId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Grupo não encontrado');
    const data = snap.data() as GrupoSolidario;

    const setIds = new Set([...(data.membrosIds || []), ...novosIds]);
    const membrosIds = Array.from(setIds);
    await updateDoc(ref, { membrosIds, membrosCount: membrosIds.length });
    return membrosIds;
  }

  async definirStatusGrupo(grupoId: string, status: GrupoStatus): Promise<void> {
    const ref = doc(this.fs, 'grupos_solidarios', grupoId);
    await updateDoc(ref, { status, atualizadoEm: serverTimestamp() });
  }

  /* =========================
   * NOVOS (abas Grupos / Caixa)
   * ========================= */

  /**
   * Lista grupos atribuídos à “caixa do assessor”.
   * Compatível com:
   *  - distribuicao.groupAssessorUid   (novo)
   *  - dist.grupoAssessorUid           (variação já vista em base)
   *  - assessorUid / caixaUid          (legado)
   */
  async listarParaCaixaAssessor(assessorUid: string): Promise<GrupoSolidario[]> {
    const rows: GrupoSolidario[] = [];
    const colRef = collection(this.fs, 'grupos_solidarios');

    const tryGet = async (qy: any) => {
      try {
        const snap = await getDocs(qy);
        snap.docs.forEach(d => rows.push({ id: d.id, ...(d.data() as any) } as GrupoSolidario));
      } catch {}
    };

    // preferencial (novo)
    await tryGet(query(colRef, where('distribuicao.groupAssessorUid', '==', assessorUid)));
    // variação observada em dados (“dist”)
    await tryGet(query(colRef, where('dist.grupoAssessorUid', '==', assessorUid)));
    // legados
    await tryGet(query(colRef, where('assessorUid', '==', assessorUid)));
    await tryGet(query(colRef, where('caixaUid', '==', assessorUid)));

    // dedup + sort por criadoEm desc
    const map = new Map<string, GrupoSolidario>();
    rows.forEach(g => map.set(g.id!, g));
    const arr = Array.from(map.values());

    const ms = (x: any) =>
      x?.toMillis ? x.toMillis() :
      x?.toDate ? x.toDate().getTime() :
      (typeof x === 'number' ? x : 0);

    arr.sort((a: any, b: any) => (ms(b?.criadoEm) - ms(a?.criadoEm)));
    return arr.filter(g => (g?.status ?? 'rascunho') !== 'cancelado');
  }

  /**
   * Define a distribuição do GRUPO inteiro para um assessor.
   */
  async definirDistribuicaoGrupo(grupoId: string, assessorUid: string, assessorNome?: string): Promise<void> {
    const user = this.auth.currentUser;
    const ref = doc(this.fs, 'grupos_solidarios', grupoId);
    await updateDoc(ref, {
      distribuicao: {
        groupAssessorUid: assessorUid,
        groupAssessorNome: assessorNome ?? null,
        distribuidoEm: serverTimestamp(),
        distribuidoPorUid: user?.uid || null,
        distribuidoPorNome: user?.displayName || null,
      }
    } as any);
  }

  /**
   * Define a distribuição por membro (distribuicao.membros).
   */
  async definirDistribuicaoMembros(
    grupoId: string,
    membros: Array<{ preCadastroId: string; assessorUid: string; assessorNome?: string }>
  ): Promise<void> {
    const user = this.auth.currentUser;
    const ref = doc(this.fs, 'grupos_solidarios', grupoId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Grupo não encontrado');

    const data = snap.data() as GrupoSolidario;
    const base = data.distribuicao?.membros || [];
    const map = new Map<string, { preCadastroId: string; assessorUid: string; assessorNome?: string }>();
    base.forEach(m => map.set(m.preCadastroId, m));
    membros.forEach(n => map.set(n.preCadastroId, n));
    const merged = Array.from(map.values());

    await updateDoc(ref, {
      distribuicao: {
        ...(data.distribuicao || {}),
        membros: merged,
        distribuidoEm: serverTimestamp(),
        distribuidoPorUid: user?.uid || null,
        distribuidoPorNome: user?.displayName || null,
      }
    } as any);
  }

  /**
   * Atualiza observações no nível do grupo.
   */
  async atualizarObservacoesGrupo(grupoId: string, observacoes: string | null): Promise<void> {
    const ref = doc(this.fs, 'grupos_solidarios', grupoId);
    await updateDoc(ref, {
      observacoes: observacoes ?? null,
      atualizadoEm: serverTimestamp(),
    });
  }

  /* =========================
   * JOIN para “cards” da aba Grupos
   * ========================= */

  async joinGrupoView(g: GrupoSolidario): Promise<GrupoSolidario> {
    const membrosIds = g.membrosIds || [];
    const idsToFetch = new Set<string>(membrosIds);
    if (g.coordenadorUid) idsToFetch.add(g.coordenadorUid);

    const pres = await fetchPreCadastrosByIds(this.fs, Array.from(idsToFetch));

    const coordPre = g.coordenadorUid
      ? pres.find(p => p.id === g.coordenadorUid)
      : undefined;

    const coordenadorView = coordPre ? {
      preCadastroId: coordPre.id,
      nome: coordPre.nomeCompleto ?? g.coordenadorNome ?? null,
      cpf: coordPre.cpf ?? null,
      telefone: coordPre.telefone ?? null,
      email: coordPre.email ?? null,
      endereco: coordPre.endereco ?? null,
      bairro: coordPre.bairro ?? null,
      cidade: coordPre.cidade ?? g.cidade ?? null,
      uf: coordPre.uf ?? g.uf ?? null,
      agendamentoStatus: coordPre.agendamentoStatus || 'nao_agendado',
      formalizacao: coordPre.formalizacao,
      desistencia: coordPre.desistencia,
    } : undefined;

    const membrosView: MembroGrupoView[] = membrosIds.map(id => {
      const p = pres.find(x => x.id === id);
      return {
        preCadastroId: id,
        nome: p?.nomeCompleto ?? null,
        cpf: p?.cpf ?? null,
        telefone: p?.telefone ?? null,
        email: p?.email ?? null,
        agendamentoStatus: p?.agendamentoStatus || 'nao_agendado',
        formalizacao: p?.formalizacao,
        desistencia: p?.desistencia,
        assessorUid: g.distribuicao?.membros?.find(m => m.preCadastroId === id)?.assessorUid ?? null,
        assessorNome: g.distribuicao?.membros?.find(m => m.preCadastroId === id)?.assessorNome ?? null,
      };
    });

    const metrics = {
      total: membrosView.length,
      aptos: membrosView.filter(m => (pres.find(x => x.id === m.preCadastroId)?.aprovacao?.status === 'apto')).length,
      agendados: membrosView.filter(m => (m.agendamentoStatus || 'nao_agendado') === 'agendado').length,
      formalizados: membrosView.filter(m => m.formalizacao?.status === 'formalizado').length,
      desistentes: membrosView.filter(m => m.desistencia?.status === 'desistiu').length,
    };

    return { ...g, coordenadorView, membrosView, metrics };
  }

  async joinGruposView(grupos: GrupoSolidario[]): Promise<GrupoSolidario[]> {
    if (!grupos?.length) return [];
    const allIds = new Set<string>();
    grupos.forEach(g => {
      (g.membrosIds || []).forEach(id => allIds.add(id));
      if (g.coordenadorUid) allIds.add(g.coordenadorUid);
    });

    const pres = await fetchPreCadastrosByIds(this.fs, Array.from(allIds));
    const findPre = (id?: string | null) => id ? pres.find(p => p.id === id) : undefined;

    return grupos.map(g => {
      const coordPre = findPre(g.coordenadorUid);
      const coordenadorView = coordPre ? {
        preCadastroId: coordPre.id,
        nome: coordPre.nomeCompleto ?? g.coordenadorNome ?? null,
        cpf: coordPre.cpf ?? null,
        telefone: coordPre.telefone ?? null,
        email: coordPre.email ?? null,
        endereco: coordPre.endereco ?? null,
        bairro: coordPre.bairro ?? null,
        cidade: coordPre.cidade ?? g.cidade ?? null,
        uf: coordPre.uf ?? g.uf ?? null,
        agendamentoStatus: coordPre.agendamentoStatus || 'nao_agendado',
        formalizacao: coordPre.formalizacao,
        desistencia: coordPre.desistencia,
      } : undefined;

      const membrosView: MembroGrupoView[] = (g.membrosIds || []).map(id => {
        const p = findPre(id);
        return {
          preCadastroId: id,
          nome: p?.nomeCompleto ?? null,
          cpf: p?.cpf ?? null,
          telefone: p?.telefone ?? null,
          email: p?.email ?? null,
          agendamentoStatus: p?.agendamentoStatus || 'nao_agendado',
          formalizacao: p?.formalizacao,
          desistencia: p?.desistencia,
          assessorUid: g.distribuicao?.membros?.find(m => m.preCadastroId === id)?.assessorUid ?? null,
          assessorNome: g.distribuicao?.membros?.find(m => m.preCadastroId === id)?.assessorNome ?? null,
        };
      });

      const metrics = {
        total: membrosView.length,
        aptos: membrosView.filter(m => (findPre(m.preCadastroId)?.aprovacao?.status === 'apto')).length,
        agendados: membrosView.filter(m => (m.agendamentoStatus || 'nao_agendado') === 'agendado').length,
        formalizados: membrosView.filter(m => m.formalizacao?.status === 'formalizado').length,
        desistentes: membrosView.filter(m => m.desistencia?.status === 'desistiu').length,
      };

      return { ...g, coordenadorView, membrosView, metrics };
    });
  }
}
