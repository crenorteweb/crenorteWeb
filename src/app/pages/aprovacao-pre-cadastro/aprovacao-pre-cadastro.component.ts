import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../shared/header/header.component';

import {
  Firestore, collection, query, where, updateDoc, doc,
  serverTimestamp, getDocs, getDocsFromServer, setDoc, getDoc
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PreCadastro } from '../../models/pre-cadastro.model';
import { filtrarUfsNorte } from '../../services/pre-cadastro.service';
import { normalizarTexto, UFS_PRIORITARIAS, CIDADES_PRIORITARIAS, BAIRROS_PRIORITARIOS } from '../../core/constants/regioes-prioritarias.constant';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';
type Status = 'ativo' | 'inativo';
type Colaborador = {
  id: string;
  uid?: string;
  nome: string;
  email?: string;
  papel: Papel;
  status?: Status;
  supervisorId?: string | null;
  analistaId?: string | null;
};

@Component({
  selector: 'app-aprovacao-pre-cadastro',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './aprovacao-pre-cadastro.component.html',
  styleUrls: ['./aprovacao-pre-cadastro.component.css']
})
export class AprovacaoPreCadastroComponent implements OnInit, OnDestroy {

  // ===== Handlers simples para o template =====
  onChangeAprovacao(v: string) { this.filtroAprovacao.set(v as any); this.filtroElegivel.set('todos'); this.currentPage = 1; }
  onChangeElegivel(v: string) { this.filtroElegivel.set(v as any); this.currentPage = 1; }
  onChangeMotivoInapto(v: string) { this.motivoInapto.set(v); }
  onRelFiltroAssessorChange(v: string) { this.relFiltroAssessor.set(v); }
  onRelFiltroDataDeChange(v: string) { this.relFiltroDataDe.set(v); }
  onRelFiltroDataAteChange(v: string) { this.relFiltroDataAte.set(v); }
  onRelFiltroNomeChange(v: string) { this.relFiltroNome.set(v); }

  // Filtros da LISTA principal
  onFiltroAssessorChange(v: string) { this.filtroAssessor.set(v || 'todos'); this.currentPage = 1; }
  onFiltroDataDeChange(v: string) { this.filtroDataDe.set(v); this.currentPage = 1; }
  onFiltroDataAteChange(v: string) { this.filtroDataAte.set(v); this.currentPage = 1; }

  onFiltroCidadeChange(v: string) {
    this.filtroCidade.set(v);
    this.filtroBairro.set('');
    this.currentPage = 1;
  }

  onFiltroUfChange(v: string) {
    this.filtroUf.set(v);
    this.filtroCidade.set('');
    this.filtroBairro.set('');
    this.currentPage = 1;
  }

  onFiltroBairroChange(v: string) {
    this.filtroBairro.set(v);
    this.currentPage = 1;
  }

  onFiltroOrigemChange(v: string) {
    this.filtroOrigem.set(v);
    this.currentPage = 1;
  }

  onFiltroCpfChange(v: string) {
    this.filtroCpf.set(v.replace(/\D/g, ''));
    this.currentPage = 1;
  }

  private fs = inject(Firestore);
  private auth = inject(Auth);

  // ======= Estado base =======
  loading = signal(false);
  preCadastros = signal<PreCadastro[]>([]);
  assessores = signal<Colaborador[]>([]);
  currentUser = signal<{ uid: string; nome?: string; papel?: string } | null>(null);

  // Mapas de nomes
  private nomePorUid = new Map<string, string>();
  private nomesSignal = signal<Record<string, string>>({}); // reativo para forçar update no template

  // seleção de assessor por pré-cadastro
  selected = signal<Record<string, string>>({});

  // ===== Filtros =====
  filtroAprovacao = signal<'todos' | 'pendente' | 'apto' | 'inapto' | 'nao_verificado'>('pendente');
  filtroElegivel = signal<'todos' | 'nao_verificado' | 'sim' | 'nao'>('todos');
  filtroAssessor = signal<string>('todos'); // UID do autor (createdByUid)
  filtroDataDe = signal<string>('');        // yyyy-MM-dd
  filtroDataAte = signal<string>('');

  // NOVOS
  filtroCidade = signal<string>('');
  filtroUf = signal<string>('');
  filtroBairro = signal<string>('');
  filtroOrigem = signal<string>('');
  filtroCpf = signal<string>('');

  // ===== Paginação =====
  pageSize = 20;
  currentPage = 1;
  get totalItems(): number { return this.filtrados().length; }
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalItems / this.pageSize)); }
  get pageStart(): number { return this.totalItems ? (this.currentPage - 1) * this.pageSize : 0; }
  get pageEnd(): number { return Math.min(this.pageStart + this.pageSize, this.totalItems); }
  pageItems(): PreCadastro[] { return this.filtrados().slice(this.pageStart, this.pageEnd); }
  onPageSizeChange(val: number) { this.pageSize = Number(val) || 10; this.currentPage = 1; }
  nextPage() { if (this.currentPage < this.totalPages) this.currentPage++; }
  prevPage() { if (this.currentPage > 1) this.currentPage--; }

  // ===== Totais por colaborador (autor) =====
  private _totaisPorAutor: Record<string, number> = {};
  rebuildTotaisPorAutor(base?: PreCadastro[]) {
    const arr = base ?? this.preCadastros();
    const map: Record<string, number> = {};
    for (const it of arr) {
      const uid = (it as any)?.createdByUid || '';
      if (!uid) continue;
      map[uid] = (map[uid] || 0) + 1;
    }
    this._totaisPorAutor = map;
  }
  totalDoAutor(uid?: string): number {
    if (!uid) return 0;
    if (!Object.keys(this._totaisPorAutor).length) this.rebuildTotaisPorAutor();
    return this._totaisPorAutor[uid] ?? 0;
  }

  // ======= Relatório =======
  relatorioAberto = signal(false);
  relFiltroAssessor = signal<string>('todos'); // uid do assessor | 'todos'
  relFiltroDataDe = signal<string>('');        // yyyy-MM-dd
  relFiltroDataAte = signal<string>('');       // yyyy-MM-dd
  relFiltroNome = signal<string>('');          // contém no nome

  // ===== Modal INAPTO =====
  inaptoAberto = signal<boolean>(false);
  private inaptoId = signal<string | null>(null);
  motivoInapto = signal<string>('');
  inaptoTipo = signal<'scr_prejuizo' | 'outros'>('outros');

  // ===== Modal NÃO ELEGÍVEL =====
  naoElegivelAberto = signal(false);
  private naoElegivelId = signal<string | null>(null);

  // ===== Modal EXPORTAR PDF =====
  pdfModalAberto = signal(false);
  pdfTipoData = signal<'aprovacao' | 'elegivel' | 'ambos'>('aprovacao');
  pdfDataDe = signal('');
  pdfDataAte = signal('');

  // ===== unsubscribers =====
  private unsubsAss: (() => void)[] = [];
  private unsubsPre: (() => void)[] = [];

  // ======= Derivados =======

  /** Opções de autores (assessores/criadores) de acordo com os itens carregados */
  autoresOptions = computed(() => {
    const uids = new Set<string>();
    this.preCadastros().forEach(it => { const u = (it as any)?.createdByUid; if (u) uids.add(u); });
    const map = this.nomesSignal();
    return Array.from(uids).map(uid => ({ uid, nome: map[uid] || uid }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  });

  /** Opções de origem únicas presentes nos dados carregados */
  origensOptions = computed(() => {
    const map = new Map<string, string>();
    this.preCadastros().forEach(it => {
      const o = ((it as any).origem || '').trim();
      if (!o) return;
      const key = o.toLowerCase();
      if (!map.has(key)) map.set(key, o);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .map(([key, label]) => ({ key, label }));
  });

  /** Apenas a data de aprovação (sem fallback para createdAt) */
  private aprovacaoEmOf(it: any): Date | null {
    const raw = it?.aprovacao?.em;
    if (raw?.toDate) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === 'number') return new Date(raw);
    return null;
  }

  /** Data de aprovação com fallback para criação (para ordenação apenas) */
  private aprovOf(it: any): Date | null {
    const raw = it?.aprovacao?.em;
    if (raw?.toDate) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === 'number') return new Date(raw);
    const c = it?.createdAt;
    if (c?.toDate) return c.toDate();
    if (c instanceof Date) return c;
    if (typeof c === 'number') return new Date(c);
    return null;
  }

  // ===== Options para filtros de localização =====
  ufsOptions = computed(() => {
    const all = new Set<string>();
    this.preCadastros().forEach(it => { const v = ((it as any).uf || '').toUpperCase().trim(); if (v) all.add(v); });
    const prio = UFS_PRIORITARIAS.filter(u => all.has(u));
    const demais = Array.from(all).filter(u => !UFS_PRIORITARIAS.includes(u)).sort();
    return { prio, demais };
  });

  cidadesOptions = computed(() => {
    const uf = this.filtroUf().toUpperCase();
    const all = new Set<string>();
    this.preCadastros()
      .filter(it => !uf || ((it as any).uf || '').toUpperCase() === uf)
      .forEach(it => { const v = ((it as any).cidade || '').trim(); if (v) all.add(v); });
    const sort = (a: string, b: string) => normalizarTexto(a).localeCompare(normalizarTexto(b));
    const prio = CIDADES_PRIORITARIAS.filter(c => Array.from(all).some(v => normalizarTexto(v) === normalizarTexto(c))).sort(sort);
    const prioNorms = new Set(prio.map(normalizarTexto));
    const demais = Array.from(all).filter(v => !prioNorms.has(normalizarTexto(v))).sort(sort);
    return { prio, demais };
  });

  bairrosOptions = computed(() => {
    const uf = this.filtroUf().toUpperCase();
    const cidade = normalizarTexto(this.filtroCidade());
    const all = new Set<string>();
    this.preCadastros()
      .filter(it => {
        if (uf && ((it as any).uf || '').toUpperCase() !== uf) return false;
        if (cidade && !normalizarTexto((it as any).cidade || '').includes(cidade)) return false;
        return true;
      })
      .forEach(it => { const v = ((it as any).bairro || '').trim(); if (v) all.add(v); });
    const sort = (a: string, b: string) => normalizarTexto(a).localeCompare(normalizarTexto(b));
    const prio = BAIRROS_PRIORITARIOS.filter(b => Array.from(all).some(v => normalizarTexto(v) === normalizarTexto(b))).sort(sort);
    const prioNorms = new Set(prio.map(normalizarTexto));
    const demais = Array.from(all).filter(v => !prioNorms.has(normalizarTexto(v))).sort(sort);
    return { prio, demais };
  });

  filtrados = computed(() => {
    const list = [...this.preCadastros()];
    const f = this.filtroAprovacao();
    const elegivel = this.filtroElegivel();
    const assUid = this.filtroAssessor();
    const de = this.filtroDataDe();
    const ate = this.filtroDataAte();
    const cidade = normalizarTexto(this.filtroCidade());
    const uf = this.filtroUf().toUpperCase();
    const bairro = normalizarTexto(this.filtroBairro());
    const origem = this.filtroOrigem();
    const cpf = this.filtroCpf().replace(/\D/g, '');

    const statusOf = (x: any) =>
      (x?.aprovacao?.status ?? 'nao_verificado') as 'apto' | 'inapto' | 'nao_verificado';

    let base = list;
    if (f === 'pendente') {
      base = base.filter(i =>
        statusOf(i) === 'nao_verificado' ||
        (statusOf(i) === 'apto' && (i.elegivel?.status ?? 'nao_verificado') === 'nao_verificado') ||
        (statusOf(i) === 'inapto' && (i as any)?.aprovacao?.motivoTipo === 'outros' && (i.elegivel?.status ?? 'nao_verificado') === 'nao_verificado')
      );
    } else if (f !== 'todos') {
      base = base.filter(i => statusOf(i) === f);
    }
    if (elegivel !== 'todos') base = base.filter(i => (i.elegivel?.status ?? 'nao_verificado') === elegivel);
    if (assUid !== 'todos') base = base.filter(i => (i as any)?.createdByUid === assUid);

    // ==== FILTRO POR DATA USANDO APROVAÇÃO (aprovacao.em) ====
    if (cidade) {
      base = base.filter(i =>
        normalizarTexto((i as any).cidade || '').includes(cidade)
      );
    }

    if (uf) {
      base = base.filter(i => {
        const valorUf = ((i as any).uf || (i as any).estado || '').toUpperCase();
        return valorUf.includes(uf);
      });
    }

    if (bairro) {
      base = base.filter(i =>
        normalizarTexto((i as any).bairro || '').includes(bairro)
      );
    }

    if (origem) {
      base = base.filter(i =>
        ((i as any).origem || '').trim().toLowerCase() === origem
      );
    }

    if (cpf) {
      base = base.filter(i =>
        ((i as any).cpf || '').replace(/\D/g, '').includes(cpf)
      );
    }

    const dtDe = de ? new Date(de + 'T00:00:00') : null;
    const dtAte = ate ? new Date(ate + 'T23:59:59') : null;
    if (dtDe || dtAte) {
      base = base.filter(i => {
        const d = this.createdOf(i);           // <-- data de criação do cadastro
        if (!d) return false;
        if (dtDe && d < dtDe) return false;
        if (dtAte && d > dtAte) return false;
        return true;
      });
    }

    // Ordena por aprovação desc (fallback: createdAt para quem não tem)
    return base.sort((a, b) =>
      (this.aprovOf(b)?.getTime() ?? 0) - (this.aprovOf(a)?.getTime() ?? 0)
    );
  });

  // Relatório (antes de filtros do modal)
  relatorio = computed(() => {
    const aptos = this.preCadastros()
      .filter(i => (i.aprovacao?.status ?? 'nao_verificado') === 'apto');

    const map = new Map<string, { assessorUid: string; assessorNome: string | null; itens: any[] }>();
    const pendentes: any[] = [];

    for (const it of aptos) {
      const enc = (it as any)?.encaminhamento;
      const uid = enc?.assessorUid || null;
      if (!uid) { pendentes.push(it); continue; }

      const nome = enc?.assessorNome || this.nomesSignal()[uid] || null;
      if (!map.has(uid)) map.set(uid, { assessorUid: uid, assessorNome: nome, itens: [] });
      map.get(uid)!.itens.push(it);
    }

    const grupos = Array.from(map.values())
      .sort((a, b) => (a.assessorNome || '').localeCompare(b.assessorNome || ''));

    return { total: aptos.length, pendentes, grupos };
  });

  // Relatório filtrado
  relatorioFiltrado = computed(() => {
    const de = this.relFiltroDataDe();
    const ate = this.relFiltroDataAte();
    const nomeTerm = (this.relFiltroNome() || '').trim().toLowerCase();
    const assUid = this.relFiltroAssessor();

    const dtDe = de ? new Date(de + 'T00:00:00') : null;
    const dtAte = ate ? new Date(ate + 'T23:59:59') : null;

    const aptos = this.preCadastros()
      .filter(i => (i.aprovacao?.status ?? 'nao_verificado') === 'apto');

    const pass = (it: PreCadastro) => {
      if (assUid !== 'todos' && (it as any)?.encaminhamento?.assessorUid !== assUid) return false;
      if (nomeTerm) {
        const n = (it.nomeCompleto || '').toLowerCase();
        if (!n.includes(nomeTerm)) return false;
      }
      // ==== AQUI passa a filtrar por aprovacao.em (não mais createdAt) ====
      if (dtDe || dtAte) {
        const d = this.aprovacaoEmOf(it);
        if (!d) return false;
        if (dtDe && d < dtDe) return false;
        if (dtAte && d > dtAte) return false;
      }
      return true;
    };

    const list = aptos.filter(pass);
    const pendentes = list.filter(i => !(i as any)?.encaminhamento?.assessorUid);

    const byAss = new Map<string, { assessorUid: string; assessorNome: string | null; itens: PreCadastro[] }>();
    for (const it of list) {
      const enc = (it as any)?.encaminhamento;
      if (!enc?.assessorUid) continue;
      const uid = enc.assessorUid;
      const nome = enc.assessorNome || this.nomesSignal()[uid] || null;
      if (!byAss.has(uid)) byAss.set(uid, { assessorUid: uid, assessorNome: nome, itens: [] });
      byAss.get(uid)!.itens.push(it);
    }

    const grupos = Array.from(byAss.values())
      .sort((a, b) => (a.assessorNome || '').localeCompare(b.assessorNome || ''));

    return { total: list.length, pendentes, grupos };
  });

  constructor() {
    onAuthStateChanged(this.auth, (u) => {
      if (!u) {
        this.currentUser.set(null);
        this.clearAllUnsubs();
        this.preCadastros.set([]);
        this.assessores.set([]);
        this.loading.set(false);
        return;
      }
      this.currentUser.set({ uid: u.uid, nome: u.displayName ?? undefined });
      this.carregarTudo();
    });
  }

  // ===== Lifecycle =====
  ngOnInit(): void { }
  ngOnDestroy(): void { this.clearAllUnsubs(); }

  // ================== Assinaturas ==================

  /** Busca assessores e pré-cadastros em paralelo (sem listeners em tempo real). */
  async carregarTudo(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const qAss = query(
        collection(this.fs, 'colaboradores'),
        where('papel', '==', 'assessor')
      );

      const [snapAss, snap1, snap2] = await Promise.all([
        getDocsFromServer(qAss),
        getDocsFromServer(collection(this.fs, 'pre_cadastros')),
        getDocsFromServer(collection(this.fs, 'pre-cadastros')),
      ]);

      // Assessores
      const rows = snapAss.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Colaborador));
      rows.forEach(r => { if (!r.uid) r.uid = r.id; });
      this.assessores.set(rows);
      rows.forEach(a => this.setNome(a.uid!, a.nome));

      // Pré-cadastros
      const acc = new Map<string, any>();
      const needNames = new Set<string>();

      const processSnap = (snap: any, colName: 'pre_cadastros' | 'pre-cadastros') => {
        snap.forEach((d: any) => {
          const raw = d.data() as any;
          const item = { id: d.id, ...raw, __col: colName };
          const prev = acc.get(item.id);
          acc.set(item.id, prev ? { ...prev, ...item, __col: colName } : item);

          const created = item?.createdByUid as string | undefined;
          const encUid = item?.encaminhamento?.assessorUid as string | undefined;
          if (created) needNames.add(created);
          if (encUid) needNames.add(encUid);
          if (encUid) this.setSelected(item.id, encUid);
        });
      };

      processSnap(snap1, 'pre_cadastros');
      processSnap(snap2, 'pre-cadastros');

      const todos = Array.from(acc.values());
      const norteIds = new Set(filtrarUfsNorte(todos).map((r: any) => r.id));
      const arr = todos.filter((r: any) =>
        norteIds.has(r.id) || r?.createdByUid === 'site_portal'
      );
      this.preCadastros.set(arr);
      this.rebuildTotaisPorAutor(arr);
      await this.preloadColabNames(Array.from(needNames));
    } catch (e) {
      console.error('[Aprovacao] erro ao carregar:', e);
    } finally {
      this.loading.set(false);
    }
  }

  // ===== Nomes helpers =====

  /** Ordena por aprovação (desc: mais recente primeiro) */
  ordenarPorAprovDesc<T extends Record<string, any>>(arr: T[]): T[] {
    return [...(arr || [])].sort((a, b) => {
      const da = this.aprovacaoEmOf(a)?.getTime() ?? 0;
      const db = this.aprovacaoEmOf(b)?.getTime() ?? 0;
      return db - da;
    });
  }

  private setNome(uid: string, nome?: string) {
    if (!uid || !nome) return;
    this.nomePorUid.set(uid, nome);
    const curr = this.nomesSignal();
    if (curr[uid] !== nome) this.nomesSignal.set({ ...curr, [uid]: nome });
  }

  /** Busca nomes faltantes na coleção `colaboradores` por `uid` e por `id` */
  private async preloadColabNames(uids: string[]) {
    const missing = uids.filter(u => u && !this.nomePorUid.has(u));
    if (!missing.length) return;

    // 1) tenta por campo uid (em chunks de 10)
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));

    for (const c of chunks) {
      try {
        const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', 'in', c)));
        snap.docs.forEach(d => this.setNome((d.data() as any)?.uid || d.id, (d.data() as any)?.nome));
      } catch { /* pode não existir índice; segue para por id */ }
    }

    // 2) para os que ainda faltarem, tenta por docId individualmente
    const still = missing.filter(u => !this.nomePorUid.has(u));
    for (const uid of still) {
      try {
        const s = await getDoc(doc(this.fs, 'colaboradores', uid));
        if (s.exists()) this.setNome(uid, (s.data() as any)?.nome || uid);
      } catch { /* ignore */ }
    }
  }

  // ===== Unsubs helpers =====
  private clearAssUnsubs() { try { this.unsubsAss.forEach(u => u()); } catch { } this.unsubsAss = []; }
  private clearPreUnsubs() { try { this.unsubsPre.forEach(u => u()); } catch { } this.unsubsPre = []; }
  private clearAllUnsubs() { this.clearAssUnsubs(); this.clearPreUnsubs(); }

  // ================== Helpers/UI ==================
  nomeDoAutor(uid?: string | null): string {
    if (!uid) return '';
    return this.nomesSignal()[uid] || this.nomePorUid.get(uid) || uid;
  }
  nomeDoAssessor(uid?: string | null): string {
    if (!uid) return '';
    return this.nomesSignal()[uid] || this.nomePorUid.get(uid) || uid;
  }

  setSelected(preId: string, assessorUid: string) {
    const curr = this.selected();
    this.selected.set({ ...curr, [preId]: assessorUid });
  }
  selectedAssessor(preId: string): string | undefined { return this.selected()[preId]; }

  aprovStatus(item: PreCadastro): 'apto' | 'inapto' | 'nao_verificado' {
    return (item.aprovacao?.status ?? 'nao_verificado') as any;
  }
  aptoHabilitado(item: PreCadastro) { return this.aprovStatus(item) !== 'apto'; }
  inaptoHabilitado(item: PreCadastro) { return this.aprovStatus(item) !== 'inapto'; }

  /** Elegibilidade pode ser verificada se: apto, OU inapto com motivoTipo = 'outros' */
  podeVerificarElegivel(item: PreCadastro): boolean {
    if (this.aprovStatus(item) === 'apto') return true;
    return this.aprovStatus(item) === 'inapto' && (item as any)?.aprovacao?.motivoTipo === 'outros';
  }
  enviarHabilitado(item: PreCadastro) {
    const status = this.aprovStatus(item);
    const ja = !!(item as any)?.encaminhamento?.assessorUid;
    return status === 'apto' && !ja;
  }

  // ================== Ações ==================
  async marcarApto(item: PreCadastro) {
    const cu = this.currentUser();
    if (!cu) return;

    let porNome = cu.nome ?? 'Analista';
    try {
      const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', '==', cu.uid)));
      const hit = snap.docs[0]?.data() as any;
      porNome = hit?.nome || porNome;
      if (porNome) this.setNome(cu.uid, porNome);
    } catch { }

    const payload: any = {
      'aprovacao.status': 'apto',
      'aprovacao.motivo': null,
      'aprovacao.observacao': null,
      'aprovacao.porUid': cu.uid,
      'aprovacao.porNome': porNome,
      'aprovacao.em': serverTimestamp(),
      caixaAtual: 'analista',
      caixaUid: cu.uid,
      destinatarioTipo: 'analista',
      destinatarioUid: cu.uid,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    // Atualiza o signal localmente para refletir na UI sem esperar o onSnapshot
    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, aprovacao: { ...(it as any).aprovacao, status: 'apto', porNome, porUid: cu.uid } }
        : it
      )
    );
  }

  abrirModalInapto(item: PreCadastro) {
    this.inaptoId.set(item.id);
    this.motivoInapto.set('');
    this.inaptoTipo.set('outros');
    this.inaptoAberto.set(true);
  }
  fecharModalInapto() {
    this.inaptoAberto.set(false);
    this.inaptoId.set(null);
    this.motivoInapto.set('');
    this.inaptoTipo.set('outros');
  }

  async confirmarInapto(motivo: string) {
    const id = this.inaptoId();
    const cu = this.currentUser();
    if (!id || !cu) return;

    const obs = (motivo ?? '').trim();
    if (!obs) { alert('Informe a observação/justificativa.'); return; }

    const tipo = this.inaptoTipo();

    const patch: any = {
      'aprovacao.status': 'inapto',
      'aprovacao.motivoTipo': tipo,
      'aprovacao.observacao': obs,
      'aprovacao.motivo': obs,
      'aprovacao.porUid': cu.uid,
      'aprovacao.porNome': this.nomeDoAutor(cu.uid),
      'aprovacao.em': serverTimestamp(),
      encaminhamento: null,
      caixaAtual: 'analista',
      caixaUid: cu.uid,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', id), patch).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', id), patch).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === id
        ? { ...it as any, aprovacao: { ...(it as any).aprovacao, status: 'inapto', motivoTipo: tipo, motivo: obs, observacao: obs } }
        : it
      )
    );

    this.fecharModalInapto();
  }

  async enviarParaAssessor(item: PreCadastro, assessorUid?: string) {
    const colName = (item as any).__col as ('pre_cadastros' | 'pre-cadastros' | undefined) ?? 'pre_cadastros';

    const chosen = assessorUid || this.selectedAssessor(item.id);
    if (!chosen) return;

    const ass = this.assessores().find(a => (a.uid || a.id) === chosen);
    const realUid = ass?.uid || ass?.id || chosen;
    const assessorNome = ass?.nome || this.nomeDoAssessor(realUid) || null;
    if (assessorNome) this.setNome(realUid, assessorNome);

    const analistaUid = this.currentUser()?.uid ?? null;
    const criadorUid = (item as any)?.createdByUid ?? null;
    const visivelParaUids = Array.from(new Set([realUid, analistaUid, criadorUid].filter(Boolean))) as string[];

    const payload: any = {
      encaminhamento: {
        assessorUid: realUid,
        assessorId: realUid,
        assessorNome,
        em: serverTimestamp(),
      },
      caixaAtual: 'assessor',
      caixaUid: realUid,
      destinatarioTipo: 'assessor',
      destinatarioUid: realUid,
      alocadoParaUid: realUid,
      alocadoParaNome: assessorNome,
      visivelParaUids,
      analistaId: analistaUid,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, colName, item.id), payload).catch(() => { }),
      setDoc(doc(this.fs, 'pre_cadastros', item.id), payload, { merge: true }),
    ]);

    await setDoc(
      doc(this.fs, `inboxes_assessores/${realUid}/itens/${item.id}`),
      {
        preCadastroId: item.id,
        path: `pre_cadastros/${item.id}`,
        nomeCompleto: (item as any)?.nomeCompleto ?? null,
        cpf: (item as any)?.cpf ?? null,
        aprovado: ((item.aprovacao?.status ?? 'nao_verificado') === 'apto'),
        em: serverTimestamp(),
      },
      { merge: true }
    );

    this.setSelected(item.id, realUid);
  }

  // ===== Ações: Elegibilidade =====
  elegivelStatus(item: PreCadastro): 'nao_verificado' | 'sim' | 'nao' {
    return (item.elegivel?.status ?? 'nao_verificado') as any;
  }

  async marcarElegivel(item: PreCadastro) {
    const cu = this.currentUser();
    if (!cu) return;

    let porNome = cu.nome ?? 'Analista';
    try {
      const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', '==', cu.uid)));
      const hit = snap.docs[0]?.data() as any;
      porNome = hit?.nome || porNome;
      if (porNome) this.setNome(cu.uid, porNome);
    } catch { }

    const payload: any = {
      'elegivel.status': 'sim',
      'elegivel.porUid': cu.uid,
      'elegivel.porNome': porNome,
      'elegivel.em': serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, elegivel: { status: 'sim', porNome, porUid: cu.uid } }
        : it
      )
    );
  }

  abrirModalNaoElegivel(item: PreCadastro) {
    this.naoElegivelId.set(item.id);
    this.naoElegivelAberto.set(true);
  }

  fecharModalNaoElegivel() {
    this.naoElegivelAberto.set(false);
    this.naoElegivelId.set(null);
  }

  async confirmarNaoElegivel() {
    const id = this.naoElegivelId();
    const cu = this.currentUser();
    if (!id || !cu) return;

    const porNome = this.nomeDoAutor(cu.uid) || cu.nome || 'Analista';

    const payload: any = {
      'elegivel.status': 'nao',
      'elegivel.porUid': cu.uid,
      'elegivel.porNome': porNome,
      'elegivel.em': serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === id
        ? { ...it as any, elegivel: { status: 'nao', porNome, porUid: cu.uid } }
        : it
      )
    );

    this.fecharModalNaoElegivel();
  }

  // ===== Exportar PDF de Elegibilidade =====
  confirmarExportarPdf() {
    this.pdfModalAberto.set(false);
    this.exportarElegibilidadePDF();
  }

  exportarElegibilidadePDF() {
    const tipoData = this.pdfTipoData();
    const de = this.pdfDataDe();
    const ate = this.pdfDataAte();
    const dtDe = de ? new Date(de + 'T00:00:00') : null;
    const dtAte = ate ? new Date(ate + 'T23:59:59') : null;

    let lista = this.filtrados();

    const toDate = (raw: any): Date | null =>
      raw?.toDate ? raw.toDate() : raw instanceof Date ? raw : typeof raw === 'number' ? new Date(raw) : null;

    const inRange = (d: Date | null) => {
      if (!d) return false;
      if (dtDe && d < dtDe) return false;
      if (dtAte && d > dtAte) return false;
      return true;
    };

    if (dtDe || dtAte) {
      lista = lista.filter(it => {
        const dAprov = toDate((it as any)?.aprovacao?.em);
        const dEleg  = toDate((it as any)?.elegivel?.em);
        if (tipoData === 'aprovacao') return inRange(dAprov);
        if (tipoData === 'elegivel')  return inRange(dEleg);
        // ambos: deve ter aprovação E elegibilidade dentro do período
        return inRange(dAprov) && inRange(dEleg);
      });
    }
    const docPdf = new jsPDF({ orientation: 'p', unit: 'pt' });

    docPdf.setFontSize(14);
    docPdf.text('Lista de CPFs – Verificação de Elegibilidade', 40, 40);

    const filtros: string[] = [];
    const tipoLabel = tipoData === 'aprovacao' ? 'Data de Aprovação' : tipoData === 'elegivel' ? 'Data de Elegibilidade' : 'Aprovação e Elegibilidade';
    if (dtDe || dtAte) filtros.push(`${tipoLabel}: ${de || '...'} a ${ate || '...'}`);
    const f = this.filtroElegivel();
    if (f !== 'todos') filtros.push(`Elegibilidade: ${f === 'nao_verificado' ? 'Não verificado' : f === 'sim' ? 'Elegível' : 'Não elegível'}`);
    if (this.filtroUf()) filtros.push(`UF: ${this.filtroUf()}`);
    if (this.filtroCidade()) filtros.push(`Cidade: ${this.filtroCidade()}`);
    if (this.filtroBairro()) filtros.push(`Bairro: ${this.filtroBairro()}`);
    if (this.filtroOrigem()) filtros.push(`Origem: ${this.filtroOrigem()}`);

    docPdf.setFontSize(9);
    docPdf.text(filtros.length ? `Filtros: ${filtros.join(' • ')}` : 'Sem filtros ativos', 40, 58);
    docPdf.text(`Total: ${lista.length} registro(s)   Gerado em: ${new Date().toLocaleString('pt-BR')}`, 40, 72);

    autoTable(docPdf, {
      startY: 84,
      head: [['#', 'Nome', 'CPF', 'Telefone', 'Cidade/UF', 'Bairro']],
      body: lista.map((it, idx) => [
        String(idx + 1),
        it.nomeCompleto || '',
        this.cpfMask(it.cpf),
        (it as any).telefone || '—',
        `${(it as any).cidade || ''}/${(it as any).uf || ''}`,
        (it as any).bairro || '',
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [33, 110, 57] },
      columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 80 }, 3: { cellWidth: 80 } },
    });

    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fname = `elegibilidade-cpfs-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.pdf`;
    docPdf.save(fname);
  }

  // ===== Relatório: Exportar PDF =====
  exportarRelatorioPDF() {
    const rel = this.relatorioFiltrado();

    const docPdf = new jsPDF({ orientation: 'p', unit: 'pt' });
    const title = 'Relatório de Aprovação - Pré-cadastros';
    docPdf.setFontSize(14);
    docPdf.text(title, 40, 40);

    const filtros: string[] = [];
    if (this.relFiltroAssessor() !== 'todos' && this.relFiltroAssessor() !== '') filtros.push(`Assessor: ${this.nomeDoAssessor(this.relFiltroAssessor())}`);
    if (this.relFiltroDataDe()) filtros.push(`De: ${this.relFiltroDataDe()}`);
    if (this.relFiltroDataAte()) filtros.push(`Até: ${this.relFiltroDataAte()}`);
    if ((this.relFiltroNome() || '').trim()) filtros.push(`Nome contém: "${(this.relFiltroNome() || '').trim()}"`);

    docPdf.setFontSize(10);
    docPdf.text((filtros.length ? `Filtros: ${filtros.join(' • ')}` : 'Sem filtros'), 40, 60);

    // === Resumo diário (Aptos x Inaptos) ===
    autoTable(docPdf, {
      startY: 80,
      head: [['Resumo por dia']],
      body: [],
      theme: 'plain'
    });
    this.addResumoDiarioToPdf(docPdf);

    // === Aptos pendentes (sem assessor) ===
    if (rel.pendentes.length) {
      autoTable(docPdf, {
        startY: (docPdf as any).lastAutoTable ? (docPdf as any).lastAutoTable.finalY + 16 : 80,
        head: [['Aptos pendentes (sem assessor)', '', '', '']],
        body: [],
        theme: 'plain'
      });
      autoTable(docPdf, {
        head: [['#', 'Cliente', 'CPF', 'Criado em', 'Aprovado em']],
        body: this.ordenarPorAprovDesc(rel.pendentes).map((it, idx) => {
          const created = (it.createdAt?.toDate ? it.createdAt.toDate() : it.createdAt) as Date | undefined;
          const aprovEmRaw = (it as any)?.aprovacao?.em;
          const aprovEm = aprovEmRaw?.toDate ? aprovEmRaw.toDate() : aprovEmRaw;
          return [
            String(idx + 1),
            it.nomeCompleto || '',
            this.cpfMask(it.cpf),
            created ? created.toLocaleString() : '—',
            aprovEm ? new Date(aprovEm).toLocaleString() : '—'
          ];
        }),
        styles: { fontSize: 9 }
      });
    }

    // === Aptos por assessor ===
    let startY = (docPdf as any).lastAutoTable ? (docPdf as any).lastAutoTable.finalY + 12 : 80;
    for (const g of rel.grupos) {
      autoTable(docPdf, {
        startY,
        head: [[`Aptos – Assessor: ${g.assessorNome || g.assessorUid}  (${g.itens.length})`, '', '', '']],
        body: [],
        theme: 'plain',
      });
      startY = (docPdf as any).lastAutoTable.finalY + 4;

      autoTable(docPdf, {
        head: [['#', 'Cliente', 'CPF', 'Criado em', 'Encaminhado em']],
        body: this.ordenarPorAprovDesc(g.itens).map((it, idx) => {
          const created = (it.createdAt?.toDate ? it.createdAt.toDate() : it.createdAt) as Date | undefined;
          const encRaw = (it as any)?.encaminhamento?.em;
          const enc = encRaw?.toDate ? encRaw.toDate() : encRaw;
          return [
            String(idx + 1),
            it.nomeCompleto || '',
            this.cpfMask(it.cpf),
            created ? created.toLocaleString() : '—',
            enc ? new Date(enc).toLocaleString() : '—'
          ];
        }),
        styles: { fontSize: 9 }
      });

      startY = (docPdf as any).lastAutoTable.finalY + 16;
    }

    // === INAPTOS ===
    this.addInaptosToPdf(docPdf);

    // Save
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fname =
      `relatorio-aprovacao-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.pdf`;
    docPdf.save(fname);
  }

  /** ==== Helpers de CPF + datas ==== **/
  private digits(s: any): string { return String(s ?? '').replace(/\D+/g, ''); }

  cpfMask(val?: string | null): string {
    const d = this.digits(val);
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  private createdOf(it: any): Date | null {
    const raw = it?.createdAt;
    if (raw?.toDate) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === 'number') return new Date(raw);
    return null;
  }

  /** ===================== NOVOS HELPERS ===================== **/
  /** Data de decisão do status (aprovação/reprovação); fallback createdAt */
  private decisaoDate(it: any): Date | null {
    const aprovRaw = it?.aprovacao?.em;
    const d = aprovRaw?.toDate ? aprovRaw.toDate() : aprovRaw;
    if (d instanceof Date) return d;
    const created = it?.createdAt?.toDate ? it.createdAt.toDate() : it?.createdAt;
    return created instanceof Date ? created : null;
  }
  /** Chave yyyy-MM-dd para agrupar por dia */
  private dateKey(d: Date | null): string {
    if (!d) return '—';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** ===================== INAPTOS (FILTRADOS) ===================== **/
  inaptosFiltrados = computed(() => {
    const de = this.relFiltroDataDe();
    const ate = this.relFiltroDataAte();
    const nomeTerm = (this.relFiltroNome() || '').trim().toLowerCase();

    const dtDe = de ? new Date(de + 'T00:00:00') : null;
    const dtAte = ate ? new Date(ate + 'T23:59:59') : null;

    const statusIsInapto = (x: any) => (x?.aprovacao?.status ?? 'nao_verificado') === 'inapto';

    const pass = (it: PreCadastro) => {
      if (!statusIsInapto(it)) return false;
      if (nomeTerm) {
        const n = (it.nomeCompleto || '').toLowerCase();
        if (!n.includes(nomeTerm)) return false;
      }
      if (dtDe || dtAte) {
        const d = this.decisaoDate(it);
        if (!d) return false;
        if (dtDe && d < dtDe) return false;
        if (dtAte && d > dtAte) return false;
      }
      return true;
    };

    const list = this.preCadastros().filter(pass);

    // Inaptos pendentes (sem assessor)
    const pendentes = list.filter(it => !((it as any)?.encaminhamento?.assessorUid));

    // (Opcional) Inaptos por assessor (caso exista)
    const byAss = new Map<string, { assessorUid: string; assessorNome: string | null; itens: PreCadastro[] }>();
    for (const it of list) {
      const enc = (it as any)?.encaminhamento;
      const uid = enc?.assessorUid;
      if (!uid) continue;
      const nome = enc?.assessorNome || this.nomesSignal()[uid] || null;
      if (!byAss.has(uid)) byAss.set(uid, { assessorUid: uid, assessorNome: nome, itens: [] });
      byAss.get(uid)!.itens.push(it);
    }
    const grupos = Array.from(byAss.values())
      .sort((a, b) => (a.assessorNome || '').localeCompare(b.assessorNome || ''));

    return { total: list.length, pendentes, grupos };
  });

  /** ===================== RESUMO POR DIA (APTOS X INAPTOS) ===================== **/
  resumoDiario = computed(() => {
    // Usa as listas já filtradas do modal:
    const aptos = this.relatorioFiltrado().grupos.flatMap(g => g.itens)
      .concat(this.relatorioFiltrado().pendentes); // todos aptos filtrados
    const inaptos = this.inaptosFiltrados().pendentes
      .concat(this.inaptosFiltrados().grupos.flatMap(g => g.itens)); // todos inaptos filtrados

    const map = new Map<string, { data: string; aptos: number; inaptos: number; itensAptos: any[]; itensInaptos: any[] }>();

    const bump = (key: string, kind: 'apto' | 'inapto', it: any) => {
      if (!map.has(key)) map.set(key, { data: key, aptos: 0, inaptos: 0, itensAptos: [], itensInaptos: [] });
      const row = map.get(key)!;
      if (kind === 'apto') { row.aptos++; row.itensAptos.push(it); }
      else { row.inaptos++; row.itensInaptos.push(it); }
    };

    for (const it of aptos) bump(this.dateKey(this.decisaoDate(it)), 'apto', it);
    for (const it of inaptos) bump(this.dateKey(this.decisaoDate(it)), 'inapto', it);

    return Array.from(map.values())
      .sort((a, b) => a.data.localeCompare(b.data)); // crescente por data
  });

  /** ===================== EXPORT PDF (ADICIONAR SEÇÕES) ===================== **/
  private addResumoDiarioToPdf(docPdf: jsPDF) {
    autoTable(docPdf, {
      startY: (docPdf as any).lastAutoTable ? (docPdf as any).lastAutoTable.finalY + 16 : 80,
      head: [['Data', 'Aptos', 'Inaptos', 'Total']],
      body: this.resumoDiario().map(r => [r.data, String(r.aptos), String(r.inaptos), String(r.aptos + r.inaptos)]),
      styles: { fontSize: 9 }
    });
  }

  private addInaptosToPdf(docPdf: jsPDF) {
    const ina = this.inaptosFiltrados();

    if (ina.total) {
      // Inaptos pendentes (sem assessor)
      if (ina.pendentes.length) {
        autoTable(docPdf, {
          startY: (docPdf as any).lastAutoTable ? (docPdf as any).lastAutoTable.finalY + 16 : 80,
          head: [['Inaptos (sem assessor)', '', '', '']],
          body: [],
          theme: 'plain'
        });
        autoTable(docPdf, {
          head: [['#', 'Cliente', 'CPF', 'Criado em', 'Reprovado em']],
          body: this.ordenarPorAprovDesc(ina.pendentes).map((it, idx) => {
            const created = (it.createdAt?.toDate ? it.createdAt.toDate() : it.createdAt) as Date | undefined;
            const emRaw = (it as any)?.aprovacao?.em;
            const em = emRaw?.toDate ? emRaw.toDate() : emRaw;
            return [
              String(idx + 1),
              it.nomeCompleto || '',
              this.cpfMask(it.cpf),
              created ? created.toLocaleString() : '—',
              em ? new Date(em).toLocaleString() : '—'
            ];
          }),
          styles: { fontSize: 9 }
        });
      }

      // (Opcional) Inaptos por assessor (caso exista)
      if (ina.grupos.length) {
        for (const g of ina.grupos) {
          autoTable(docPdf, {
            startY: (docPdf as any).lastAutoTable ? (docPdf as any).lastAutoTable.finalY + 12 : 80,
            head: [[`Inaptos – Assessor: ${g.assessorNome || g.assessorUid}  (${g.itens.length})`, '', '', '']],
            body: [],
            theme: 'plain',
          });
          autoTable(docPdf, {
            head: [['#', 'Cliente', 'CPF', 'Criado em', 'Reprovado em']],
            body: this.ordenarPorAprovDesc(g.itens).map((it, idx) => {
              const created = (it.createdAt?.toDate ? it.createdAt.toDate() : it.createdAt) as Date | undefined;
              const emRaw = (it as any)?.aprovacao?.em;
              const em = emRaw?.toDate ? emRaw.toDate() : emRaw;
              return [
                String(idx + 1),
                it.nomeCompleto || '',
                this.cpfMask(it.cpf),
                created ? created.toLocaleString() : '—',
                em ? new Date(em).toLocaleString() : '—'
              ];
            }),
            styles: { fontSize: 9 }
          });
        }
      }
    }
  }

}
