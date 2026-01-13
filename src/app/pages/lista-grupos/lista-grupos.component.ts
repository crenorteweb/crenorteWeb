import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import {
  Firestore,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit as qLimit,
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  DocumentData,
  deleteField,
} from '@angular/fire/firestore';

import { HeaderComponent } from '../shared/header/header.component';

/* =========================
   Tipos persistidos
   ========================= */
export type GrupoStatus = 'rascunho' | 'ativo' | 'fechado' | 'cancelado';

export interface GrupoSolidario {
  id: string;
  nome: string;
  criadoEm: any;
  criadoPorUid: string;
  criadoPorNome?: string;
  cidade?: string | null;
  uf?: string | null;
  capacidadeMin: number;
  capacidadeMax: number;
  membrosIds: string[];
  membrosCount: number;
  status: GrupoStatus;
  observacoes?: string | null;
  coordenadorUid?: string | null;
  coordenadorNome?: string | null;
  dist?: {
    grupoAssessorUid?: string | null;
    grupoAssessorNome?: string | null;
    membros?: Record<string, { assessorUid: string; assessorNome: string }>;
  };
}

/* Extensão pra tela */
export type GrupoComStatus = GrupoSolidario & { _statusDerivado?: string };

type SortField = 'nome' | 'criadoEm' | 'membrosCount' | 'status' | 'cidade' | 'uf';
type SortDir = 'asc' | 'desc';
type Visualizacao = 'cards' | 'tabela';

type AprovCode = 'apto' | 'inapto' | 'pendente' | 'desconhecido';

type PreMini = {
  id: string;
  nomeCompleto?: string;
  cpf?: string;
  telefone?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  aprovacaoStatus?: string;
  createdAt?: any;
  createdByUid?: string;
  createdByNome?: string;
};

type Assessor = { uid: string; nome: string };

@Component({
  standalone: true,
  selector: 'app-lista-grupos',
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent],
  templateUrl: './lista-grupos.component.html',
  styleUrls: ['./lista-grupos.component.css'],
})
export class ListaGruposComponent implements OnInit {
  private fs = inject(Firestore);

  /* ===== Estado base ===== */
  gruposRaw = signal<GrupoSolidario[]>([]);
  preCache = signal<Record<string, PreMini>>({});
  assessores = signal<Assessor[]>([]);
  carregando = signal<boolean>(true);
  erroCarregar = signal<string>('');

  /* ===== Visualização / ordenação / paginação ===== */
  visualizacao = signal<Visualizacao>('cards');
  sortField = signal<SortField>('criadoEm');
  sortDir = signal<SortDir>('desc');
  itensPorPagina = signal<number>(20);
  paginaAtual = signal<number>(1);

  /* ===== Filtros ===== */
  private _filtro = signal({
    nome: '',
    status: '' as '' | GrupoStatus | 'Aprovado' | 'Incompleto' | 'Inapto' | 'Pendente',
    cidade: '',
    uf: '',
    criadoDe: '' as string | '',
    criadoAte: '' as string | '',
    coordenador: '',
  });
  filtro = computed(() => this._filtro());

  setFiltro(key: keyof ReturnType<typeof this.filtro>, value: any) {
    const cur = { ...this._filtro() } as any;
    cur[key as string] = value;
    this._filtro.set(cur);
    this.paginaAtual.set(1);
  }

  /* ===== Combos ===== */
  cidadesDisponiveis = signal<string[]>([]);
  ufsDisponiveis = signal<string[]>([]);
  statusDisponiveis = signal<Array<GrupoStatus | 'Aprovado' | 'Incompleto' | 'Inapto' | 'Pendente'>>(
    ['rascunho', 'ativo', 'fechado', 'cancelado', 'Aprovado', 'Incompleto', 'Inapto', 'Pendente']
  );
  coordenadoresDisponiveis = signal<string[]>([]);

  /* ===== Modais ===== */
  modalEditarAberto = signal<boolean>(false);
  modalAddAberto = signal<boolean>(false);
  modalDistribAberto = signal<boolean>(false);
  grupoSelecionado = signal<GrupoComStatus | null>(null);

  /* candidatos para adicionar */
  candidatos = signal<PreMini[]>([]);
  buscaCandidato = signal<string>('');
  apenasAptos = signal<boolean>(false);

  /* ===== Derivados ===== */
  kpiTotal = computed(() => this.gruposRaw().length);

  grupos = computed<GrupoComStatus[]>(() => {
    const pre = this.preCache();
    return this.gruposRaw().map((g) => ({
      ...g,
      _statusDerivado: this.computeStatusDerivado(g, pre),
    }));
  });

  gruposFiltrados = computed<GrupoComStatus[]>(() => {
    const arr = [...this.grupos()];
    const f = this.filtro();
    const norm = this.normalize;

    return arr.filter(g => {
      const nomeOk = f.nome ? norm(g.nome).includes(norm(f.nome)) : true;
      const cidadeOk = f.cidade ? norm(g.cidade || '') === norm(f.cidade) : true;
      const ufOk = f.uf ? (g.uf || '').toUpperCase() === f.uf.toUpperCase() : true;
      const coordOk = f.coordenador ? norm(g.coordenadorNome || '') === norm(f.coordenador) : true;

      let statusOk = true;
      if (f.status) {
        const sDer = (g._statusDerivado || '').toLowerCase();
        const sPer = (g.status || '').toLowerCase();
        const wanted = String(f.status).toLowerCase();
        statusOk = (sDer === wanted) || (sPer === wanted);
      }

      let dataOk = true;
      if (f.criadoDe || f.criadoAte) {
        const d0 = f.criadoDe ? new Date(f.criadoDe + 'T00:00:00') : null;
        const d1 = f.criadoAte ? new Date(f.criadoAte + 'T23:59:59.999') : null;
        const d = this.asDateFlexible(g.criadoEm);
        if (!d) dataOk = false;
        if (d0 && d && d < d0) dataOk = false;
        if (d1 && d && d > d1) dataOk = false;
      }

      return nomeOk && statusOk && cidadeOk && ufOk && coordOk && dataOk;
    });
  });

  gruposOrdenados = computed<GrupoComStatus[]>(() => {
    const field = this.sortField();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const norm = this.normalize;

    return [...this.gruposFiltrados()].sort((a, b) => {
      let va: any = null;
      let vb: any = null;

      switch (field) {
        case 'nome': va = norm(a.nome); vb = norm(b.nome); break;
        case 'status': va = norm(a._statusDerivado || a.status); vb = norm(b._statusDerivado || b.status); break;
        case 'cidade': va = norm(a.cidade || ''); vb = norm(b.cidade || ''); break;
        case 'uf': va = (a.uf || '').toUpperCase(); vb = (b.uf || '').toUpperCase(); break;
        case 'membrosCount': va = a.membrosCount || 0; vb = b.membrosCount || 0; break;
        default: va = this.asDateFlexible(a.criadoEm)?.getTime() ?? 0; vb = this.asDateFlexible(b.criadoEm)?.getTime() ?? 0;
      }

      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  });

  totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.gruposOrdenados().length / this.itensPorPagina()))
  );

  gruposPaginados = computed(() => {
    const page = Math.min(this.paginaAtual(), this.totalPaginas());
    const ini = (page - 1) * this.itensPorPagina();
    const fim = ini + this.itensPorPagina();
    return this.gruposOrdenados().slice(ini, fim);
  });

  /* =================== Ciclo de vida =================== */
  ngOnInit(): void {
    // 1) grupos
    const ref = query(collection(this.fs, 'grupos_solidarios'), orderBy('criadoEm', 'desc'));
    this.carregando.set(true);
    this.erroCarregar.set('');

    onSnapshot(ref, {
      next: (snap) => {
        const rows: GrupoSolidario[] = snap.docs.map((d) => {
          const data = d.data() as DocumentData;
          const g: GrupoSolidario = {
            id: d.id,
            nome: str(data, 'nome'),
            criadoEm: dataLike(data, 'criadoEm'),
            criadoPorUid: str(data, 'criadoPorUid'),
            criadoPorNome: str(data, 'criadoPorNome') || undefined,
            cidade: str(data, 'cidade') || null,
            uf: upperOrNull(data, 'uf'),
            capacidadeMin: num(data, 'capacidadeMin', 3),
            capacidadeMax: num(data, 'capacidadeMax', 10),
            membrosIds: arr(data, 'membrosIds'),
            membrosCount: num(data, 'membrosCount', arr(data, 'membrosIds').length),
            status: (str(data, 'status') as GrupoStatus) || 'rascunho',
            observacoes: str(data, 'observacoes') || null,
            coordenadorUid: str(data, 'coordenadorUid') || null,
            coordenadorNome: str(data, 'coordenadorNome') || null,
            dist: (data as any)['dist'] || undefined,
          };
          return g;
        });

        this.gruposRaw.set(rows);
        this.recalcularCombos(rows);

        // 2) assinar pré-cadastros
        const ids = new Set<string>();
        rows.forEach(g => g.membrosIds.forEach(id => ids.add(id)));
        this.subscribePreCadastrosRealtime(Array.from(ids));

        this.carregando.set(false);
        if (this.paginaAtual() > this.totalPaginas()) this.paginaAtual.set(1);
      },
      error: (err) => {
        console.error(err);
        this.erroCarregar.set('Falha ao carregar os grupos do Firebase.');
        this.carregando.set(false);
      }
    });

    // 3) assessores
    const refAss = query(collection(this.fs, 'colaboradores'), orderBy('nome'));
    onSnapshot(refAss, (snap) => {
      const list: Assessor[] = snap.docs.map(d => {
        const data = d.data() as any;
        return { uid: String(data.uid || d.id), nome: String(data.nome || data.displayName || '—') };
      });
      this.assessores.set(list);
    });

    // 4) candidatos para adicionar
    const refPre = query(collection(this.fs, 'pre_cadastros'), orderBy('createdAt', 'desc'), qLimit(100));
    onSnapshot(refPre, (snap) => {
      const list: PreMini[] = snap.docs.map(d => mapPreMini(d.id, d.data() as any));
      this.candidatos.set(list);
    });
  }

  /* =================== Pré-cadastro realtime =================== */
  private preSubs = new Map<string, () => void>();
  private subscribePreCadastrosRealtime(ids: string[]) {
    const wanted = new Set(ids);
    for (const [id, unsub] of this.preSubs.entries()) {
      if (!wanted.has(id)) { unsub(); this.preSubs.delete(id); }
    }
    ids.forEach(id => {
      if (this.preSubs.has(id)) return;
      const ref = doc(this.fs, 'pre_cadastros', id);
      const unsub = onSnapshot(ref, (d) => {
        if (!d.exists()) return;
        const pm = mapPreMini(d.id, d.data() as any);
        const next = { ...this.preCache() };
        next[d.id] = pm;
        this.preCache.set(next);
      });
      this.preSubs.set(id, unsub);
    });
  }

  /* =================== Status derivado =================== */
  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  private getAprovacaoCode(p?: PreMini): AprovCode {
    const n = this.normalize((p?.aprovacaoStatus || '').toString());
    if (!n) return 'desconhecido';
    if (/\binapto\b/.test(n) || /reprov/.test(n) || /neg/.test(n)) return 'inapto';
    if (/\bapto\b/.test(n) || /aprov/.test(n)) return 'apto';
    if (/pend/.test(n) || /analise/.test(n) || /nao_verificado|não_verificado/.test(n)) return 'pendente';
    return 'desconhecido';
  }
  private computeStatusDerivado(g: GrupoSolidario, pre: Record<string, PreMini>): string {
    const count = g.membrosIds?.length || 0;
    if (count < 3) return 'Incompleto';

    let temInapto = false;
    let todosAptos = true;

    for (const id of g.membrosIds) {
      const p = pre[id];
      const c = this.getAprovacaoCode(p);
      if (c === 'inapto') temInapto = true;
      if (c !== 'apto') todosAptos = false;
    }

    if (temInapto) return 'Inapto';
    if (todosAptos) return 'Aprovado';
    return 'Pendente';
  }

  statusBadgeClass(s: GrupoStatus | string): string {
    const v = String(s).toLowerCase();
    if (v === 'aprovado' || v === 'ativo') return 'text-bg-success';
    if (v === 'incompleto' || v === 'rascunho') return 'text-bg-secondary';
    if (v === 'inapto' || v === 'cancelado') return 'text-bg-danger';
    if (v === 'pendente') return 'text-bg-warning';
    if (v === 'fechado') return 'text-bg-dark';
    return 'text-bg-light';
  }

  /* =================== Utils =================== */
  private asDateFlexible(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object' && typeof (v as any).toDate === 'function') {
      try { return (v as any).toDate(); } catch {}
    }
    if (v && typeof v === 'object' && typeof (v as any).seconds === 'number') {
      const ns = (v as any).nanoseconds || 0;
      return new Date((v as any).seconds * 1000 + Math.floor(ns / 1e6));
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  toBRDate(value: any): string {
    const d = this.asDateFlexible(value);
    if (!d) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  toBRTime(value: any): string {
    const d = this.asDateFlexible(value);
    if (!d) return '—';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  displayName(raw?: string | null): string {
    const s = (raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keep = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts.map((p, i) => (i > 0 && keep.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }

  private uniqSorted(arr: string[]): string[] {
    const norm = this.normalize;
    return Array.from(new Set(arr.filter(x => !!x && x.trim() !== '')))
      .sort((a, b) => norm(a).localeCompare(norm(b)));
  }

  private recalcularCombos(grupos: GrupoSolidario[]) {
    this.cidadesDisponiveis.set(this.uniqSorted(grupos.map(g => g.cidade || '').filter(Boolean)));
    this.ufsDisponiveis.set(this.uniqSorted(grupos.map(g => g.uf || '').filter(Boolean)));
    this.coordenadoresDisponiveis.set(
      this.uniqSorted(grupos.map(g => this.displayName(g.coordenadorNome || '')).filter(Boolean))
    );
  }

  /* =================== UI =================== */
  trocarVisualizacao(v: Visualizacao) {
    if (this.visualizacao() === v) return;
    this.visualizacao.set(v);
    this.paginaAtual.set(1);
  }

  ordenarPor(campo: SortField) {
    if (this.sortField() === campo) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(campo);
      this.sortDir.set('asc');
    }
  }

  irParaPagina(n: number) {
    if (n < 1 || n > this.totalPaginas() || n === this.paginaAtual()) return;
    this.paginaAtual.set(n);
  }

  pages(): number[] { return Array.from({ length: this.totalPaginas() }, (_, i) => i + 1); }

  trackById(_i: number, g: GrupoComStatus) { return g.id; }

  /* =================== Ações rápidas =================== */
  abrirEditar(g: GrupoComStatus) { this.grupoSelecionado.set(g); this.modalEditarAberto.set(true); }
  fecharEditar() { this.modalEditarAberto.set(false); this.grupoSelecionado.set(null); }

  abrirAdd() { this.modalAddAberto.set(true); }
  fecharAdd() { this.modalAddAberto.set(false); this.buscaCandidato.set(''); }

  abrirDistribuicao() { this.modalDistribAberto.set(true); }
  fecharDistribuicao() { this.modalDistribAberto.set(false); }

  /* =================== Pré-cadastro helpers p/ template =================== */
  getPreById(id: string | null | undefined): PreMini | undefined {
    if (!id) return undefined;
    return this.preCache()[id];
  }
  getPreNome(id: string): string {
    const p = this.getPreById(id);
    return this.displayName(p?.nomeCompleto || '');
  }
  getPreCpf(id: string): string {
    const p = this.getPreById(id);
    return (p?.cpf || '—');
  }
  getPreTel(id: string): string {
    const p = this.getPreById(id);
    const t = (p?.telefone || '').replace(/\D/g, '');
    if (!t) return '—';
    if (t.length === 11) return t.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (t.length === 10) return t.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return t;
  }
  getPreLocal(id: string): string {
    const p = this.getPreById(id);
    const b = (p?.bairro || '—');
    const c = (p?.cidade || '—');
    const u = (p?.uf || '—');
    return `${b} — ${c} / ${u}`;
  }
  getPreAprovacao(id: string): string {
    const p = this.getPreById(id);
    const c = this.getAprovacaoCode(p);
    if (c === 'apto') return 'Apto';
    if (c === 'inapto') return 'Inapto';
    if (c === 'pendente') return 'Pendente';
    return '—';
  }

  /* =================== Assessores (evita ?. no template) =================== */
  getAssessorByUid(uid: string | null): Assessor | null {
    if (!uid) return null;
    return this.assessores().find(a => a.uid === uid) || null;
  }

  // Grupo inteiro
  onChangeAssessorGrupo(ev: Event) {
    const uid = (ev.target as HTMLSelectElement).value || '';
    this.setAssessorGrupo(this.getAssessorByUid(uid));
  }
  async setAssessorGrupo(a: Assessor | null) {
    const g = this.grupoSelecionado();
    if (!g) return;
    const ref = doc(this.fs, 'grupos_solidarios', g.id);
    await updateDoc(ref, {
      ['dist.grupoAssessorUid']: a?.uid ?? null,
      ['dist.grupoAssessorNome']: a?.nome ?? null,
    });
  }
  distGroupAssessorUid(): string {
    const g = this.grupoSelecionado();
    const d = (g as any)?.['dist'] || {};
    return d.grupoAssessorUid || '';
  }
  distGroupAssessorNome(): string {
    const g = this.grupoSelecionado();
    const d = (g as any)?.['dist'] || {};
    return d.grupoAssessorNome || '';
  }

  // Por membro
  onChangeAssessorMembro(mid: string, ev: Event) {
    const uid = (ev.target as HTMLSelectElement).value || '';
    this.setAssessorParaMembro(mid, this.getAssessorByUid(uid));
  }
  async setAssessorParaMembro(mid: string, a: Assessor | null) {
    const g = this.grupoSelecionado();
    if (!g) return;
    const ref = doc(this.fs, 'grupos_solidarios', g.id);
    if (a) {
      await updateDoc(ref, {
        [`dist.membros.${mid}.assessorUid`]: a.uid,
        [`dist.membros.${mid}.assessorNome`]: a.nome,
      });
    } else {
      await updateDoc(ref, {
        [`dist.membros.${mid}`]: deleteField(),
      });
    }
  }
  distPorMembro(mid: string): { assessorUid?: string; assessorNome?: string } {
    const g = this.grupoSelecionado();
    const d = (g as any)?.['dist'] || {};
    const m = (d.membros || {}) as Record<string, { assessorUid?: string; assessorNome?: string }>;
    return m[mid] || {};
  }

  /* =================== Ações de membros =================== */
  async removerMembro(mid: string) {
    const g = this.grupoSelecionado();
    if (!g) return;
    const ref = doc(this.fs, 'grupos_solidarios', g.id);
    await updateDoc(ref, {
      membrosIds: arrayRemove(mid),
      membrosCount: (g.membrosCount || 0) - 1,
      [`dist.membros.${mid}`]: deleteField(),
    });
  }

  async adicionarMembro(mid: string) {
    const g = this.grupoSelecionado();
    if (!g) return;
    if (g.membrosIds?.includes(mid)) return;

    const ref = doc(this.fs, 'grupos_solidarios', g.id);
    await updateDoc(ref, {
      membrosIds: arrayUnion(mid),
      membrosCount: (g.membrosCount || 0) + 1,
    });
    this.fecharAdd();
  }

  /* =================== Busca candidatos (modal) =================== */
  candidatosFiltrados(): PreMini[] {
    const b = this.normalize(this.buscaCandidato());
    const onlyApto = this.apenasAptos();
    const g = this.grupoSelecionado();
    const ja = new Set(g?.membrosIds || []);
    return this.candidatos()
      .filter(p => !ja.has(p.id))
      .filter(p => {
        if (!b) return true;
        const hay = [
          this.displayName(p.nomeCompleto || ''),
          p.cpf || '',
          p.cidade || '',
          p.uf || ''
        ].join(' ');
        return this.normalize(hay).includes(b);
      })
      .filter(p => !onlyApto || this.getAprovacaoCode(p) === 'apto');
  }

  /* =================== Relatório (plug-in) =================== */
  async gerarPDF(): Promise<void> {
    alert('Relatório em PDF pode ser plugado aqui (mesmo padrão da outra tela).');
  }
}

/* =================== Helpers puros =================== */
function has(obj: any, key: string) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null;
}
function str(obj: any, key: string, fallback = ''): string {
  return has(obj, key) ? String(obj[key]) : fallback;
}
function num(obj: any, key: string, fallback = 0): number {
  const v = has(obj, key) ? Number(obj[key]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}
function arr<T = any>(obj: any, key: string): T[] {
  const v = has(obj, key) ? obj[key] : [];
  return Array.isArray(v) ? (v as T[]) : [];
}
function upperOrNull(obj: any, key: string): string | null {
  const v = str(obj, key).trim();
  return v ? v.toUpperCase() : null;
}
function dataLike(obj: any, key: string): any {
  return has(obj, key) ? obj[key] : null;
}
function mapPreMini(id: string, data: any): PreMini {
  return {
    id,
    nomeCompleto: data?.nomeCompleto || data?.nome || '',
    cpf: data?.cpf || '',
    telefone: data?.telefone || '',
    bairro: data?.bairro || data?.enderecoBairro || '',
    cidade: data?.cidade || data?.enderecoCidade || '',
    uf: data?.uf || data?.enderecoUF || '',
    aprovacaoStatus: data?.aprovacao?.status || data?.aprovacaoStatus || '',
    createdAt: data?.createdAt,
    createdByUid: data?.createdByUid || '',
    createdByNome: data?.createdByNome || '',
  };
}
