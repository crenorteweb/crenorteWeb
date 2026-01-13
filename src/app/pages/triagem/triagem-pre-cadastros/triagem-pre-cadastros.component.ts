import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { HeaderComponent } from '../../shared/header/header.component';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Firestore
import { db } from '../../../firebase.config';
import {
  collectionGroup,
  onSnapshot,
  query,
  Unsubscribe,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';


/* =========================
   Normalização & Origens
   ========================= */
function normalizeBasic(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s: string): string {
  return (s || '').toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase());
}

const ORIGEM_SYNONYMS: Record<string, string> = {
  'panfleto': 'panfleto', 'panfletos': 'panfleto',
  'online': 'online', 'on-line': 'online', 'site': 'online',
  'formulario': 'online', 'formulário': 'online',
  'telefone': 'telefone', 'tel': 'telefone', 'celular': 'telefone', 'cel': 'telefone',
  'whatsapp': 'whatsapp', 'wpp': 'whatsapp', 'zap': 'whatsapp', 'wtz': 'whatsapp', 'whats': 'whatsapp',
  'igreja': 'igreja',
  'presencial': 'presencial', 'visita': 'presencial', 'visita presencial': 'presencial', 'cadastro presencial': 'presencial',
  'indicacao': 'indicacao', 'indicação': 'indicacao',
  'proprio': 'proprio', 'próprio': 'proprio', 'própria': 'proprio'
};

const ORIGEM_LABELS: Record<string, string> = {
  panfleto: 'Panfleto',
  online: 'Online',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  igreja: 'Igreja',
  presencial: 'Presencial',
  indicacao: 'Indicação',
  proprio: 'Próprio',
  outros: 'Outros',
};

type StatusAprovacao = 'nao' | 'apto' | 'inapto';
function coerceStatusToUi(x: any): StatusAprovacao {
  const n = normalizeBasic(String(x || ''));
  if (n.startsWith('apto')) return 'apto';
  if (n.startsWith('ina')) return 'inapto';
  return 'nao';
}

type AprovacaoStatus = 'nao_verificado' | 'apto' | 'inapto';
function mapLegacyToNovo(x: any): AprovacaoStatus {
  const n = normalizeBasic(String(x || ''));
  if (n.startsWith('apto')) return 'apto';
  if (n.startsWith('ina')) return 'inapto';
  return 'nao_verificado';
}

function canonicalizeOrigem(raw: string): { key: string; label: string } {
  const n = normalizeBasic(raw);

  if (n in ORIGEM_SYNONYMS) {
    const key = ORIGEM_SYNONYMS[n];
    return { key, label: ORIGEM_LABELS[key as keyof typeof ORIGEM_LABELS] || titleCase(key) };
  }
  if (/whats|zap|wpp/.test(n)) return { key: 'whatsapp', label: ORIGEM_LABELS['whatsapp'] };
  if (/on\s?-?\s?line|site|formul/.test(n)) return { key: 'online', label: ORIGEM_LABELS['online'] };
  if (/telefone|tel|cel/.test(n)) return { key: 'telefone', label: ORIGEM_LABELS['telefone'] };
  if (/igreja/.test(n)) return { key: 'igreja', label: ORIGEM_LABELS['igreja'] };
  if (/presencial|visita/.test(n)) return { key: 'presencial', label: ORIGEM_LABELS['presencial'] };
  if (/indic/.test(n)) return { key: 'indicacao', label: ORIGEM_LABELS['indicacao'] };
  if (/propri/.test(n)) return { key: 'proprio', label: ORIGEM_LABELS['proprio'] };

  if (n) return { key: n, label: titleCase(raw) };
  return { key: 'outros', label: ORIGEM_LABELS['outros'] };
}

/* =========================
   Tipos
   ========================= */
type PreCadastroRow = {
  id: string;
  data: Date | null;

  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  endereco: string;
  bairro: string;
  rota: string;
  cidade?: string;
  uf?: string;

  origem: string;
  origemKey: string;
  origemLabel: string;

  statusAprovacao?: 'nao' | 'apto' | 'inapto';

  designadoEm?: Date | null;
  designadoParaUid?: string | null;
  designadoParaNome?: string | null;

  _path: string;
  _eDeAssessor?: boolean;

  createdByUid?: string | null;
  createdByNome?: string | null;
};

type Assessor = {
  uid: string;
  nome?: string;
  email?: string;
  status?: string;
  papel?: string;
  rota?: string;
};

/* ===== Grupos (ATUALIZADO para IDs) ===== */
export type StatusGrupo = 'em_qa' | 'aprovado_basa' | 'reprovado_basa';
export interface GrupoSolidario {
  id?: string;
  codigo?: string;
  coordenadorCpf: string;
  coordenadorNome?: string;

  /* >>> membros por IDs de pré-cadastros */
  membrosIds?: string[];

  bairro?: string;
  cidade?: string;
  estado?: string;
  status: StatusGrupo;
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
  totalSolicitado?: number;
  observacoes?: string;

  /* distribuição */
  designadoEm?: Date | any;
  designadoParaUid?: string | null;
  designadoParaNome?: string | null;
}

/* =========================
   Componente
   ========================= */
@Component({
  standalone: true,
  selector: 'app-triagem-pre-cadastros',
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './triagem-pre-cadastros.component.html',
  styleUrls: ['./triagem-pre-cadastros.component.css'],
})
export class TriagemPreCadastrosComponent implements OnInit, OnDestroy {
  carregando = signal(false);
  erro = signal<string | null>(null);

  // UI
  density: 'relax' | 'compact' = 'relax';
  setDensity(mode: 'relax' | 'compact') { this.density = mode; }

  // Tabs
  activeTab: 'pessoas' | 'grupos' = 'pessoas';
  setTab(tab: 'pessoas' | 'grupos') { this.activeTab = tab; this.onBusca(this.busca); }

  // Drawer lateral (mobile)
  showFilters = false;
  toggleFilters() { this.showFilters ? this.closeFilters() : this.openFilters(); }
  openFilters() { this.showFilters = true; try { document.body.classList.add('no-scroll'); } catch { } }
  closeFilters() { this.showFilters = false; try { document.body.classList.remove('no-scroll'); } catch { } }

  // Collapses (INDIVIDUAL)
  filterOpen: Record<'status' | 'periodo' | 'origem' | 'bairros' | 'criador' | 'destino' | 'envio', boolean> = {
    status: true, periodo: false, origem: true, bairros: false, criador: false, destino: false, envio: true
  };
  toggleGroup(k: keyof typeof this.filterOpen) {
    this.filterOpen[k] = !this.filterOpen[k];
    try { localStorage.setItem('triagemFilterOpen', JSON.stringify(this.filterOpen)); } catch { }
  }
  isOpen(k: keyof typeof this.filterOpen) { return this.filterOpen[k]; }

  // filtros comuns
  busca = '';
  filtroRota = '';
  somenteNaoDesignados = false;

  // agregados (INDIVIDUAL)
  origens: Array<{ key: string; label: string; count: number }> = [];
  filtroOrigemKey = '';

  // filtros por assessor (INDIVIDUAL)
  filtroCriadorUid: string = '';
  filtroDistribuidoUid: string = '';

  topBairros: Array<{ label: string; count: number }> = [];
  filtroBairro = '';

  statusFilter: 'todos' | 'nao' | 'apto' | 'inapto' = 'todos';

  // envio (INDIVIDUAL)
  envioFilter: 'todos' | 'enviado' | 'nao_enviado' = 'todos';
  setEnvio(k: 'todos' | 'enviado' | 'nao_enviado') { this.envioFilter = (this.envioFilter === k ? 'todos' : k); this.aplicarFiltros(); }
  isEnvioActive(k: 'todos' | 'enviado' | 'nao_enviado') { return this.envioFilter === k; }

  // período (INDIVIDUAL)
  periodoFilter: 'todos' | 'hoje' | 'ontem' | '7' | '14' | '30' | '90' | 'custom' = 'todos';
  de = '';
  ate = '';

  setPeriodo(k: typeof this.periodoFilter) {
    this.periodoFilter = (this.periodoFilter === k ? 'todos' : k);
    if (this.periodoFilter !== 'custom') { this.de = ''; this.ate = ''; }
    this.aplicarFiltros();
  }
  isPeriodoActive(k: typeof this.periodoFilter) { return this.periodoFilter === k; }
  onPeriodoDatasChange() {
    if (this.periodoFilter !== 'custom') this.periodoFilter = 'custom';
    this.aplicarFiltros();
  }

  // dados INDIVIDUAL
  private unsub?: Unsubscribe;
  all: PreCadastroRow[] = [];
  view: PreCadastroRow[] = [];

  // índice por ID para lookup RÁPIDO (usado pelos grupos)
  private pcById = new Map<string, PreCadastroRow>();

  // paginação INDIVIDUAL
  pageSize = 20;
  currentPage = 1;
  get totalItems() { return this.view.length; }
  get totalPages() { return Math.max(1, Math.ceil(this.totalItems / this.pageSize)); }
  get pageStart() { return this.totalItems ? (this.currentPage - 1) * this.pageSize : 0; }
  get pageEnd() { return Math.min(this.pageStart + this.pageSize, this.pageSize * this.currentPage); }
  get pageItems() { return this.view.slice(this.pageStart, this.pageEnd); }

  // assessores / designação
  assessores: Assessor[] = [];
  selecaoAssessor: Record<string, string> = {};
  selecaoAssessorNome: Record<string, string> = {};
  designando: Record<string, boolean> = {};
  errDesignado: Record<string, boolean> = {};

  // modal INDIVIDUAL
  showAssessorModal = false;
  assessorBusca = '';
  assessoresFiltrados: Assessor[] = [];
  rowSelecionado: PreCadastroRow | null = null;
  selectedAssessorUid: string | null = null;

  // Migração (mantida)
  migrandoAprovacao = false;
  migracaoTotal = 0;
  migracaoProcessados = 0;

  // ===== GRUPOS =====
  private unsubGrupos?: Unsubscribe;
  allGrupos: GrupoSolidario[] = [];
  viewGrupos: GrupoSolidario[] = [];

  // paginação grupos
  pageSizeG = 20;
  currentPageG = 1;
  get totalItemsG() { return this.viewGrupos.length; }
  get totalPagesG() { return Math.max(1, Math.ceil(this.totalItemsG / this.pageSizeG)); }
  get pageStartG() { return this.totalItemsG ? (this.currentPageG - 1) * this.pageSizeG : 0; }
  get pageEndG() { return Math.min(this.pageStartG + this.pageSizeG, this.pageSizeG * this.currentPageG); }
  get pageItemsG() { return this.viewGrupos.slice(this.pageStartG, this.pageEndG); }

  // modal GRUPO
  showAssessorModalGrupo = false;
  assessorBuscaGrupo = '';
  assessoresFiltradosGrupo: Assessor[] = [];
  selectedAssessorUidGrupo: string | null = null;

  showGrupoDetalhe = false;
  grupoSelecionado: GrupoSolidario | null = null;

  selecaoAssessorNomeGrupo: Record<string, string> = {};
  designandoGrupo: Record<string, boolean> = {};

  // >>> membros carregados por ID para o modal
  membrosPC: PreCadastroRow[] = [];

  async ngOnInit(): Promise<void> {
    await this.carregarAssessores();
    this.carregarTodos();
    this.carregarGrupos();
  }
  ngOnDestroy(): void { this.unsub?.(); this.unsubGrupos?.(); }

  /* ============ Helpers de atualização sem perder a página ============ */
  private patchById<T extends { id?: string | number }>(
    arr: T[],
    id: string | number | undefined,
    patch: Partial<T>
  ): T[] {
    if (id == null) return arr;
    const idx = arr.findIndex(x => String(x.id) === String(id));
    if (idx === -1) return arr;
    const updated = { ...arr[idx], ...patch };
    const clone = arr.slice();
    clone[idx] = updated;
    return clone;
  }
  private reapplyPeoplePreservingPage(): void {
    const keep = this.currentPage;
    this.aplicarFiltros();
    this.currentPage = Math.min(keep, this.totalPages || 1);
    this.refreshMembrosSeModalAberto();
  }
  private reapplyGroupsPreservingPage(): void {
    const keep = this.currentPageG;
    this.filtrarGrupos();
    this.currentPageG = Math.min(keep, this.totalPagesG || 1);
    this.refreshMembrosSeModalAberto();
  }

  /* ============ Carregar dados INDIVIDUAL ============ */
  private carregarTodos() {
    this.carregando.set(true);
    this.erro.set(null);

    const base = collectionGroup(db, 'pre_cadastros');
    const qy = query(base);

    this.unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: PreCadastroRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const path = d.ref.path;

          const origemRaw = String(data?.origem ?? '').trim();
          const canon = canonicalizeOrigem(origemRaw);

          let uiStatus: StatusAprovacao = 'nao';
          if (data?.aprovacao?.status) {
            const novo = String(data.aprovacao.status);
            const n = normalizeBasic(novo);
            uiStatus = n === 'apto' ? 'apto' : (n === 'inapto' ? 'inapto' : 'nao');
          } else {
            uiStatus = coerceStatusToUi(data?.statusAprovacao);
          }

          const designadoParaUid: string | null =
            (data?.designadoParaUid ?? data?.designadoPara ?? null) || null;
          const designadoParaNome: string | null =
            (data?.designadoParaNome ?? null) || null;

          return {
            id: d.id,
            data: this.toDate(data?.createdAt ?? data?.criadoEm),
            nome: String(data?.nomeCompleto ?? data?.nome ?? '').trim(),
            cpf: String(data?.cpf ?? '').trim(),
            telefone: String(data?.telefone ?? data?.contato ?? '').trim(),
            email: String(data?.email ?? '').trim(),
            endereco: String(data?.endereco ?? data?.enderecoCompleto ?? '').trim(),
            bairro: String(data?.bairro ?? '').trim(),
            rota: String(data?.rota ?? '').trim(),
            cidade: String(data?.cidade ?? '').trim(),
            uf: String(data?.uf ?? data?.estado ?? '').trim(),

            origem: canon.label,
            origemKey: canon.key,
            origemLabel: canon.label,

            statusAprovacao: uiStatus,

            designadoEm: this.toDate(data?.designadoEm) ?? null,
            designadoParaUid,
            designadoParaNome,

            _path: path,
            _eDeAssessor: path.startsWith('colaboradores/'),

            createdByUid: data?.createdByUid ?? null,
            createdByNome: data?.createdByNome ?? null,
          };
        });

        // >>> índice por ID para lookup via membrosIds
        this.pcById.clear();
        for (const r of rows) this.pcById.set(String(r.id), r);

        rows.sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

        rows.forEach((r) => {
          if (r.designadoParaUid) {
            this.selecaoAssessor[r.id] = r.designadoParaUid;
            this.selecaoAssessorNome[r.id] = r.designadoParaNome || this.resolveAssessorNome(r.designadoParaUid);
          } else {
            this.selecaoAssessor[r.id] = '';
            this.selecaoAssessorNome[r.id] = '';
          }
        });

        this.all = rows;
        this.atualizarOrigens();
        this.atualizarBairros();
        this.aplicarFiltros();
        this.refreshMembrosSeModalAberto();
        this.carregando.set(false);
      },
      (err) => {
        console.error('[Triagem] onSnapshot error:', err);
        this.erro.set(err?.message ?? 'Falha ao carregar pré-cadastros.');
        this.carregando.set(false);
      }
    );
  }

  private async carregarAssessores() {
    try {
      const col = collection(db, 'colaboradores');
      const q1 = query(
        col,
        where('status', '==', 'ativo'),
        where('papel', 'in', ['assessor', 'admin', 'analista'])
      );
      const snap = await getDocs(q1);

      this.assessores = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            uid: d.id,
            nome: x?.nome ?? x?.displayName ?? '',
            email: x?.email ?? '',
            status: x?.status,
            papel: x?.papel,
            rota: x?.rota ?? '',
          } as Assessor;
        })
        .sort((a, b) => (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? ''));
    } catch (e) {
      console.error('[Triagem] Falha ao carregar assessores:', e);
      this.assessores = [];
    }
  }

  /* ============ Utils ============ */
  private toDate(x: unknown): Date | null {
    if (!x) return null;
    if (typeof (x as any)?.toDate === 'function') return (x as any).toDate();
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);
    return null;
  }
  private normalize(s: string): string { return normalizeBasic(s); }
  initial(s: string): string {
    const t = (s ?? '').toString().trim();
    return t ? t.charAt(0).toUpperCase() : '?';
  }
  nomeAssessor(a: Assessor | undefined): string { return (a?.nome || a?.email || a?.uid || '').toString(); }
  resolveAssessorNome(uid?: string | null): string {
    if (!uid) return '';
    const a = this.assessores.find((x) => x.uid === uid);
    return this.nomeAssessor(a) || uid;
  }
  trackById = (_: number, r: PreCadastroRow) => r._path || r.id;

  nomeDistribuido(r: PreCadastroRow): string {
    return r.designadoParaNome
      || (r.designadoParaUid ? this.resolveAssessorNome(r.designadoParaUid) : '')
      || '';
  }

  isEnviado(r: PreCadastroRow): boolean { return !!(r.designadoParaUid && r.designadoEm); }
  actionLabel(r: PreCadastroRow): string { return this.isEnviado(r) ? 'Atualizar' : 'Enviar'; }
  isEnviarDisabled(r: PreCadastroRow): boolean {
    const sel = this.selecaoAssessor[r.id];
    if (!sel) return true;
    if (this.designando[r.id]) return true;
    if (this.isEnviado(r) && sel === r.designadoParaUid) return true;
    return false;
  }

  /* ===== Período helpers (INDIVIDUAL) ===== */
  private parseDateLocal(yyyyMMdd: string, endOfDay = false): Date | null {
    if (!yyyyMMdd) return null;
    const [y, m, d] = yyyyMMdd.split('-').map(n => Number(n));
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d);
    if (endOfDay) dt.setHours(23, 59, 59, 999);
    else dt.setHours(0, 0, 0, 0);
    return dt;
  }
  private periodoCriacaoDentro(dt: Date | null): boolean {
    if (!dt) return false;
    const now = new Date();
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);

    if (this.periodoFilter === 'todos') return true;
    if (this.periodoFilter === 'hoje') return dt >= startToday;
    if (this.periodoFilter === 'ontem') {
      const y0 = new Date(startToday); y0.setDate(y0.getDate() - 1);
      const y1 = new Date(startToday); y1.setMilliseconds(-1);
      return dt >= y0 && dt <= y1;
    }
    if (this.periodoFilter === '7' || this.periodoFilter === '14' || this.periodoFilter === '30' || this.periodoFilter === '90') {
      const days = Number(this.periodoFilter);
      const min = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return dt >= min;
    }
    if (this.periodoFilter === 'custom') {
      const min = this.parseDateLocal(this.de, false);
      const max = this.parseDateLocal(this.ate, true);
      if (min && max) return dt >= min && dt <= max;
      if (min && !max) return dt >= min;
      if (!min && max) return dt <= max;
      return true;
    }
    return true;
  }
  private periodoDistribuicaoDentro(dt: Date | null): boolean {
    return this.periodoCriacaoDentro(dt);
  }

  /* ============ Filtros & Quick Filters (INDIVIDUAL) ============ */
  onBusca(val: string) {
    this.busca = (val ?? '').trim();
    if (this.activeTab === 'pessoas') this.aplicarFiltros();
    else this.filtrarGrupos();
  }
  onFiltroRota(val: string) { this.filtroRota = (val ?? '').trim(); this.aplicarFiltros(); }
  limparFiltros() {
    this.busca = '';
    this.filtroRota = '';
    this.filtroOrigemKey = '';
    this.filtroBairro = '';
    this.statusFilter = 'todos';
    this.periodoFilter = 'todos';
    this.envioFilter = 'todos';
    this.de = '';
    this.ate = '';
    this.somenteNaoDesignados = false;
    this.filtroCriadorUid = '';
    this.filtroDistribuidoUid = '';
    this.aplicarFiltros();
  }

  onFiltroCriadorChange(uid: string) {
    this.filtroCriadorUid = (uid || '').trim();
    this.aplicarFiltros();
  }
  limparFiltroCriador() {
    this.filtroCriadorUid = '';
    this.aplicarFiltros();
  }

  onFiltroDistribuidoChange(uid: string) {
    this.filtroDistribuidoUid = (uid || '').trim();
    this.aplicarFiltros();
  }
  limparFiltroDistribuido() {
    this.filtroDistribuidoUid = '';
    this.aplicarFiltros();
  }

  statusLabel(s?: StatusAprovacao | null): string {
    switch (s) {
      case 'apto': return 'Apto';
      case 'inapto': return 'Inapto';
      default: return 'Não verificado';
    }
  }
  statusIcon(s?: StatusAprovacao | null): string {
    switch (s) {
      case 'apto': return '✅';
      case 'inapto': return '⛔';
      default: return '🕑';
    }
  }
  statusChipClass(s?: StatusAprovacao | null) {
    return {
      'chip-status': true,
      'is-apto': s === 'apto',
      'is-inapto': s === 'inapto',
      'is-nao': !s || (s !== 'apto' && s !== 'inapto'),
    };
  }

  setStatus(k: 'todos' | 'nao' | 'apto' | 'inapto') {
    this.statusFilter = (this.statusFilter === k ? 'todos' : k);
    this.aplicarFiltros();
  }

  setOrigem(key: string) { this.filtroOrigemKey = (this.filtroOrigemKey === key ? '' : key); this.aplicarFiltros(); }
  isOrigemActive(key: string) { return this.filtroOrigemKey === key; }

  setBairro(label: string) { this.filtroBairro = (this.filtroBairro === label ? '' : label); this.aplicarFiltros(); }
  isBairroActive(label: string) { return this.filtroBairro === label; }

  private atualizarOrigens() {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const r of this.all) {
      const key = r.origemKey || 'outros';
      const label = r.origemLabel || ORIGEM_LABELS[key as keyof typeof ORIGEM_LABELS] || 'Outros';
      const slot = map.get(key) || { key, label, count: 0 };
      slot.count++;
      map.set(key, slot);
    }
    this.origens = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  private atualizarBairros() {
    const map = new Map<string, number>();
    for (const r of this.all) {
      const b = (r.bairro || '').trim();
      if (!b) continue;
      const label = titleCase(b);
      map.set(label, (map.get(label) || 0) + 1);
    }
    this.topBairros = Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 12);
  }

  aplicarFiltros() {
    let list = [...this.all];

    const term = this.normalize(this.busca);
    const rota = this.normalize(this.filtroRota);
    const origemKey = this.filtroOrigemKey;
    const bairroSel = this.filtroBairro;

    if (rota) list = list.filter(p => this.normalize(p.rota).includes(rota));
    if (origemKey) list = list.filter(p => p.origemKey === origemKey);
    if (bairroSel) list = list.filter(p => titleCase(p.bairro || '') === bairroSel);

    if (this.filtroCriadorUid) list = list.filter(p => (p.createdByUid || '') === this.filtroCriadorUid);

    if (this.filtroDistribuidoUid) {
      list = list.filter(p => !!p.designadoEm && !!p.designadoParaUid && p.designadoParaUid === this.filtroDistribuidoUid);
    }

    if (this.envioFilter !== 'todos') {
      list = list.filter(p => this.envioFilter === 'enviado' ? this.isEnviado(p) : !this.isEnviado(p));
    }

    if (this.statusFilter !== 'todos') {
      list = list.filter(p => (p.statusAprovacao || 'nao') === this.statusFilter);
    }

    list = list.filter(p => this.periodoCriacaoDentro(p.data || null));

    if (term) {
      list = list.filter((p) => {
        const blob = this.normalize(
          `${p.nome} ${p.cpf} ${p.telefone} ${p.email} ${p.endereco} ${p.bairro} ${p.rota} ${p.origemLabel} ${p.cidade} ${p.uf}`
        );
        return blob.includes(term);
      });
    }

    this.view = list;
  }

  private aplicarDistribuicaoEmPessoasPorGrupo(
    g: GrupoSolidario,
    uid: string,
    assessorNome: string | null
  ) {
    const ids = g.membrosIds || [];
    const now = new Date();

    for (const id of ids) {
      const pc = this.getPCById(id);
      if (!pc) continue;

      const patchLocal: Partial<PreCadastroRow> = {
        designadoParaUid: uid,
        designadoParaNome: assessorNome || this.resolveAssessorNome(uid),
        designadoEm: now,
      };

      // Atualiza arrays locais (all/view)
      this.all = this.patchById(this.all, pc.id, patchLocal);
      this.view = this.patchById(this.view, pc.id, patchLocal);

      // Atualiza seleção de assessor usada pelos botões da aba Pessoas
      this.selecaoAssessor[pc.id] = uid;
      this.selecaoAssessorNome[pc.id] = assessorNome || this.resolveAssessorNome(uid);
    }

    // Reaplica filtros/paginação na aba pessoas sem perder página atual
    this.reapplyPeoplePreservingPage();
  }


  /* ===== Paginação (INDIVIDUAL) ===== */
  onPageSizeChange(val: number) {
    const n = Number(val) || 10;
    this.pageSize = n;
    this.currentPage = 1;
    this.view = [...this.view];
  }
  nextPage() { if (this.currentPage < this.totalPages) this.currentPage++; }
  prevPage() { if (this.currentPage > 1) this.currentPage--; }

  /* ============ Enviar/Atualizar INDIVIDUAL (sem perder página) ============ */
  async designarParaAssessor(r: PreCadastroRow) {
    const uid = this.selecaoAssessor[r.id];
    if (!uid) return;

    this.designando[r.id] = true;
    this.errDesignado[r.id] = false;

    try {
      const colabRef = doc(db, 'colaboradores', uid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador não encontrado.');

      const colab = colabSnap.data() as any;
      const assessorNome = colab?.nome ?? colab?.displayName ?? null;

      const srcRef = doc(db, r._path);
      const patchRemote = {
        designadoParaUid: uid,
        designadoPara: uid,
        designadoParaNome: assessorNome || null,
        designadoEm: serverTimestamp(),
        caixaAtual: 'assessor',
        caixaUid: uid,
      };
      await setDoc(srcRef, patchRemote, { merge: true });

      const patchLocal = {
        designadoParaUid: uid,
        designadoParaNome: assessorNome || this.resolveAssessorNome(uid),
        designadoEm: new Date(),
      } as Partial<PreCadastroRow>;

      this.all = this.patchById(this.all, r.id, patchLocal);
      this.view = this.patchById(this.view, r.id, patchLocal);

      this.reapplyPeoplePreservingPage();
    } catch (e) {
      console.error('[Triagem] designarParaAssessor erro:', e);
      this.errDesignado[r.id] = true;
      alert('Não foi possível enviar/atualizar. Tente novamente.');
    } finally {
      this.designando[r.id] = false;
    }
  }

  /* ============ Modal INDIVIDUAL ============ */
  abrirModalAssessor(row: PreCadastroRow) {
    this.rowSelecionado = row;
    this.assessorBusca = '';
    this.filtrarAssessores();
    this.selectedAssessorUid = this.selecaoAssessor[row.id] || null;
    this.showAssessorModal = true;
  }
  fecharModalAssessor() {
    this.showAssessorModal = false;
    this.rowSelecionado = null;
    this.selectedAssessorUid = null;
  }
  filtrarAssessores() {
    const t = this.normalize(this.assessorBusca);
    let arr = [...this.assessores];
    if (t) {
      arr = arr.filter((a) =>
        this.normalize(`${a.nome ?? ''} ${a.email ?? ''} ${a.rota ?? ''}`).includes(t)
      );
    }
    arr.sort((a, b) => (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? ''));
    this.assessoresFiltrados = arr;
  }
  escolherAssessor(a: Assessor) {
    if (!this.rowSelecionado) return;
    this.selecaoAssessor[this.rowSelecionado.id] = a.uid;
    this.selecaoAssessorNome[this.rowSelecionado.id] = this.nomeAssessor(a);
    this.selectedAssessorUid = a.uid;
  }
  async escolherEEnviar(a: Assessor) {
    if (!this.rowSelecionado) return;
    this.selecaoAssessor[this.rowSelecionado.id] = a.uid;
    this.selecaoAssessorNome[this.rowSelecionado.id] = this.nomeAssessor(a);
    const row = this.rowSelecionado;
    this.fecharModalAssessor();
    await this.designarParaAssessor(row);
  }
  async enviarSelecionadoDoModal() {
    if (!this.rowSelecionado || !this.selectedAssessorUid) return;
    const aUid = this.selectedAssessorUid;
    this.selecaoAssessor[this.rowSelecionado.id] = aUid;
    this.selecaoAssessorNome[this.rowSelecionado.id] = this.resolveAssessorNome(aUid) || aUid;
    const row = this.rowSelecionado;
    this.fecharModalAssessor();
    await this.designarParaAssessor(row);
  }

  /* ===== Relatório de Distribuição (INDIVIDUAL) ===== */
  showRelatorioDist = false;
  abrirRelatorioDist() { this.showRelatorioDist = true; try { document.body.classList.add('no-scroll'); } catch { } }
  fecharRelatorioDist() { this.showRelatorioDist = false; try { document.body.classList.remove('no-scroll'); } catch { } }

  private two(n: number) { return (n < 10 ? '0' : '') + n; }
  private dayStart(d: Date | null): Date | null {
    if (!d) return null;
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  private digits(s: any): string { return String(s ?? '').replace(/\D+/g, ''); }
  cpfMask(val?: string | null): string {
    const d = this.digits(val);
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  private distBase() {
    let arr = (this.view || []).filter(r => !!r.designadoEm && !!r.designadoParaUid);
    arr = arr.filter(r => this.periodoDistribuicaoDentro(r.designadoEm || null));
    return arr;
  }

  gruposDistPorDia() {
    const map = new Map<string, { key: string; label: string; dt: Date | null; itens: PreCadastroRow[] }>();
    for (const r of this.distBase()) {
      const d0 = this.dayStart(r.designadoEm || null);
      const key = d0 ? `${d0.getFullYear()}-${this.two(d0.getMonth() + 1)}-${this.two(d0.getDate())}` : '—';
      let g = map.get(key);
      if (!g) {
        g = { key, label: d0 ? d0.toLocaleDateString('pt-BR') : '—', dt: d0, itens: [] };
        map.set(key, g);
      }
      if (!r.designadoParaNome && r.designadoParaUid) {
        r.designadoParaNome = this.resolveAssessorNome(r.designadoParaUid) || r.designadoParaUid;
      }
      g.itens.push(r);
    }
    const grupos = Array.from(map.values())
      .sort((a, b) => (b.dt?.getTime() ?? -1) - (a.dt?.getTime() ?? -1));
    grupos.forEach(g => g.itens = this.ordenarPorDistribuicaoDesc(g.itens));
    return grupos;
  }

  ordenarPorDistribuicaoDesc<T extends { designadoEm?: Date | null }>(arr: T[]): T[] {
    return [...(arr || [])].sort((a, b) => (b.designadoEm?.getTime() ?? 0) - (a.designadoEm?.getTime() ?? 0));
  }

  distPorDia() {
    const map = new Map<string, { key: string; label: string; total: number; dt: Date | null }>();
    for (const r of this.distBase()) {
      const d0 = this.dayStart(r.designadoEm || null);
      const key = d0 ? `${d0.getFullYear()}-${this.two(d0.getMonth() + 1)}-${this.two(d0.getDate())}` : '—';
      let slot = map.get(key);
      if (!slot) {
        slot = { key, label: d0 ? d0.toLocaleDateString('pt-BR') : '—', total: 0, dt: d0 };
        map.set(key, slot);
      }
      slot.total++;
    }
    return Array.from(map.values()).sort((a, b) => (b.dt?.getTime() ?? -1) - (a.dt?.getTime() ?? -1));
  }

  distPorAssessor() {
    const map = new Map<string, { uid: string; nome: string; total: number }>();
    for (const r of this.distBase()) {
      const uid = String(r.designadoParaUid);
      const nome = r.designadoParaNome || this.resolveAssessorNome(uid) || uid;
      let slot = map.get(uid);
      if (!slot) { slot = { uid, nome, total: 0 }; map.set(uid, slot); }
      slot.total++;
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  }

  distTotal(): number { return this.distBase().length; }

  exportarRelatorioDistribuicaoPDF() {
    const grupos = this.gruposDistPorDia();
    const totaisPorAssessor = this.distPorAssessor();
    const docPdf = new jsPDF({ orientation: 'p', unit: 'pt' });

    docPdf.setFontSize(14);
    docPdf.text('Relatório de Distribuição – Pré-cadastros', 40, 40);

    docPdf.setFontSize(10);
    docPdf.text(`Total de distribuições (após filtros): ${this.distTotal()}`, 40, 58);

    if (this.periodoFilter !== 'todos') {
      const desc = this.periodoFilter === 'custom'
        ? `Período: ${this.de || '—'} até ${this.ate || '—'}`
        : `Período: ${this.periodoFilter}`;
      docPdf.text(desc, 40, 72);
    }

    let startY = 80;

    autoTable(docPdf, {
      startY,
      head: [['Assessor', 'Distribuições']],
      body: totaisPorAssessor.map(a => [a.nome, String(a.total)]),
      styles: { fontSize: 10 },
      columnStyles: { 0: { cellWidth: 360 }, 1: { halign: 'right', cellWidth: 120 } }
    });
    startY = (docPdf as any).lastAutoTable.finalY + 16;

    if (!grupos.length) {
      docPdf.text('Nenhuma distribuição encontrada para os filtros atuais.', 40, startY);
      const ts = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fname = `relatorio-distribuicao-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.pdf`;
      docPdf.save(fname);
      return;
    }

    for (const g of grupos) {
      autoTable(docPdf, {
        startY,
        head: [[`Dia: ${g.label}  (${g.itens.length})`, '', '', '', '']],
        body: [],
        theme: 'plain',
        styles: { fontSize: 11 }
      });
      startY = (docPdf as any).lastAutoTable.finalY + 4;

      autoTable(docPdf, {
        startY,
        head: [['#', 'Cliente', 'CPF', 'Distribuído em', 'Assessor']],
        body: g.itens.map((it, idx) => {
          const dt = it.designadoEm ? it.designadoEm : null;
          const assessorNome = it.designadoParaNome || (it.designadoParaUid ? this.resolveAssessorNome(it.designadoParaUid) : '') || (it.designadoParaUid || '');
          return [String(idx + 1), it.nome || '', this.cpfMask(it.cpf), dt ? dt.toLocaleString() : '—', assessorNome];
        }),
        styles: { fontSize: 9 },
        columnStyles: { 0: { halign: 'center', cellWidth: 28 }, 2: { cellWidth: 110 }, 3: { cellWidth: 140 } }
      });

      startY = (docPdf as any).lastAutoTable.finalY + 16;
    }

    const ts = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fname = `relatorio-distribuicao-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.pdf`;
    docPdf.save(fname);
  }

  /* ====== GRUPOS (ATUALIZADO p/ membrosIds) ====== */
  private carregarGrupos() {
    const col = collection(db, 'grupos_solidarios');
    const qy = query(col, orderBy('criadoEm', 'desc'));
    this.unsubGrupos = onSnapshot(qy, snap => {
      const arr: GrupoSolidario[] = snap.docs.map(d => {
        const x = d.data() as any;

        // suporte a legado: se não houver membrosIds, tenta extrair de membros[].cadastroId
        const ids: string[] = Array.isArray(x.membrosIds)
          ? x.membrosIds
          : Array.isArray(x.membros)
            ? (x.membros.map((m: any) => m?.cadastroId).filter((v: any) => !!v))
            : [];

        return {
          id: d.id,
          codigo: x.codigo,
          coordenadorCpf: x.coordenadorCpf,
          coordenadorNome: x.coordenadorNome,
          membrosIds: ids,
          bairro: x.bairro || '',
          cidade: x.cidade,
          estado: x.estado,
          status: x.status || 'em_qa',
          criadoEm: x.criadoEm?.toDate?.() || new Date(),
          criadoPorUid: x.criadoPorUid,
          criadoPorNome: x.criadoPorNome,
          totalSolicitado: x.totalSolicitado || 0,
          observacoes: x.observacoes || '',
          designadoEm: x.designadoEm?.toDate?.() || null,
          designadoParaUid: x.designadoParaUid || null,
          designadoParaNome: x.designadoParaNome || null,
        };
      });
      this.allGrupos = arr;
      this.filtrarGrupos();
      this.refreshMembrosSeModalAberto();
    }, err => {
      console.error('[Triagem] Grupos error:', err);
      this.erro.set(err?.message ?? 'Falha ao carregar grupos.');
    });
  }

  filtrarGrupos() {
    const term = this.normalize(this.busca);
    let list = [...this.allGrupos];

    if (term) {
      list = list.filter(g => {
        const blob = this.normalize(
          `${g.codigo || ''} ${g.coordenadorNome || ''} ${g.bairro || ''} ${g.cidade || ''} ${g.estado || ''}`
        );
        return blob.includes(term);
      });
    }

    this.viewGrupos = list;
  }

  onPageSizeChangeG(val: number) { this.pageSizeG = +val; this.currentPageG = 1; }
  nextPageG() { if (this.currentPageG < this.totalPagesG) this.currentPageG++; }
  prevPageG() { if (this.currentPageG > 1) this.currentPageG--; }

  grupoStatusLabel(s: StatusGrupo): string {
    switch (s) {
      case 'em_qa': return 'Em QA';
      case 'aprovado_basa': return 'Aprovado BASA';
      case 'reprovado_basa': return 'Reprovado BASA';
      default: return '—';
    }
  }
  grupoStatusIcon(s: StatusGrupo): string {
    switch (s) {
      case 'aprovado_basa': return '✅';
      case 'reprovado_basa': return '⛔';
      default: return '🕑';
    }
  }
  grupoStatusChipClass(s: StatusGrupo) {
    return {
      'chip-status': true,
      'is-apto': s === 'aprovado_basa',
      'is-inapto': s === 'reprovado_basa',
      'is-nao': s === 'em_qa'
    };
  }

  /* ===== Designação de grupos (sem perder página) ===== */
  abrirModalAssessorGrupo(g: GrupoSolidario) {
    this.grupoSelecionado = g;
    this.assessorBuscaGrupo = '';
    this.filtrarAssessoresGrupo();
    this.selectedAssessorUidGrupo = g.designadoParaUid || null;
    this.showAssessorModalGrupo = true;
  }
  fecharModalAssessorGrupo() {
    this.showAssessorModalGrupo = false;
    this.grupoSelecionado = null;
    this.selectedAssessorUidGrupo = null;
  }
  filtrarAssessoresGrupo() {
    const t = this.normalize(this.assessorBuscaGrupo);
    let arr = [...this.assessores];
    if (t) {
      arr = arr.filter((a) => this.normalize(`${a.nome ?? ''} ${a.email ?? ''} ${a.rota ?? ''}`).includes(t));
    }
    arr.sort((a, b) => (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? ''));
    this.assessoresFiltradosGrupo = arr;
  }
  escolherAssessorGrupo(a: Assessor) {
    if (!this.grupoSelecionado) return;
    this.selecaoAssessorNomeGrupo[this.grupoSelecionado.id!] = this.nomeAssessor(a);
    this.selectedAssessorUidGrupo = a.uid;
  }
  async escolherEEnviarGrupo(a: Assessor) {
    if (!this.grupoSelecionado) return;
    this.selecaoAssessorNomeGrupo[this.grupoSelecionado.id!] = this.nomeAssessor(a);
    const g = this.grupoSelecionado;
    this.fecharModalAssessorGrupo();
    await this.designarGrupo(g, a.uid);
  }
  async enviarSelecionadoDoModalGrupo() {
    if (!this.grupoSelecionado || !this.selectedAssessorUidGrupo) return;
    const uid = this.selectedAssessorUidGrupo;
    this.selecaoAssessorNomeGrupo[this.grupoSelecionado.id!] = this.resolveAssessorNome(uid) || uid;
    const g = this.grupoSelecionado;
    this.fecharModalAssessorGrupo();
    await this.designarGrupo(g, uid);
  }

  async designarGrupo(g: GrupoSolidario, uid?: string | null) {
    if (!g?.id || !uid) return;
    this.designandoGrupo[g.id] = true;

    try {
      // 1) Pega dados do assessor
      const colabRef = doc(db, 'colaboradores', uid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador não encontrado.');
      const colab = colabSnap.data() as any;
      const assessorNome = colab?.nome ?? colab?.displayName ?? null;

      // 2) Cria batch para atualizar grupo + todos os membros
      const batch = writeBatch(db);

      // 2.1) Atualiza o grupo
      const refGrupo = doc(db, 'grupos_solidarios', g.id);
      batch.set(
        refGrupo,
        {
          designadoParaUid: uid,
          designadoParaNome: assessorNome || null,
          designadoEm: serverTimestamp(),
          caixaAtual: 'assessor',
          caixaUid: uid,
        },
        { merge: true }
      );

      // 2.2) Atualiza todos os pré-cadastros membros do grupo
      const ids = g.membrosIds || [];
      for (const id of ids) {
        const pc = this.getPCById(id);
        if (!pc) continue;

        const refPc = doc(db, pc._path);
        batch.set(
          refPc,
          {
            designadoParaUid: uid,
            designadoPara: uid,
            designadoParaNome: assessorNome || null,
            designadoEm: serverTimestamp(),
            caixaAtual: 'assessor',
            caixaUid: uid,
          },
          { merge: true }
        );
      }

      // 3) Commit das alterações remotas
      await batch.commit();

      // 4) Atualiza estado LOCAL do grupo
      const patchGrupoLocal: Partial<GrupoSolidario> = {
        designadoParaUid: uid,
        designadoParaNome: assessorNome || this.resolveAssessorNome(uid),
        designadoEm: new Date(),
      };
      this.allGrupos = this.patchById(this.allGrupos, g.id, patchGrupoLocal);
      this.viewGrupos = this.patchById(this.viewGrupos, g.id, patchGrupoLocal);

      // 5) Atualiza estado LOCAL das pessoas (aba Pessoas)
      this.aplicarDistribuicaoEmPessoasPorGrupo(g, uid, assessorNome || null);

      // 6) Reaplica filtros/paginação da aba Grupos sem perder página
      this.reapplyGroupsPreservingPage();
    } catch (e) {
      console.error('[Triagem] designarGrupo erro:', e);
      alert('Não foi possível enviar/atualizar o grupo. Tente novamente.');
    } finally {
      this.designandoGrupo[g.id] = false;
    }
  }


  /* ===== Detalhe do grupo (membros por ID) ===== */
  private getPCById(id?: string | null): PreCadastroRow | null {
    if (!id) return null;
    return this.pcById.get(String(id)) || null;
  }

  
  private montarMembrosPorIds(g: GrupoSolidario): PreCadastroRow[] {
    const ids = g.membrosIds || [];
    const itens: PreCadastroRow[] = [];
    for (const id of ids) {
      const pc = this.getPCById(id);
      if (pc) itens.push(pc);
    }
    return itens;
  }

  abrirDetalheGrupo(g: GrupoSolidario) {
    this.grupoSelecionado = g;
    this.membrosPC = this.montarMembrosPorIds(g);
    this.showGrupoDetalhe = true;
  }
  fecharDetalheGrupo() {
    this.showGrupoDetalhe = false;
    this.grupoSelecionado = null;
    this.membrosPC = [];
  }

  /** Se dados atualizarem com o modal aberto, remonta a lista */
  private refreshMembrosSeModalAberto() {
    if (this.showGrupoDetalhe && this.grupoSelecionado) {
      this.membrosPC = this.montarMembrosPorIds(this.grupoSelecionado);
    }
  }
}
