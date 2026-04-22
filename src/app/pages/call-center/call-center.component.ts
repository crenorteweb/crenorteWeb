import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../shared/header/header.component';

import {
  Firestore, collection, query, where, updateDoc, doc,
  serverTimestamp, getDocs, getDoc, setDoc, deleteField
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { PreCadastro } from '../../models/pre-cadastro.model';
import { filtrarUfsNorte } from '../../services/pre-cadastro.service';
import { normalizarTexto, UFS_PRIORITARIAS, CIDADES_PRIORITARIAS, BAIRROS_PRIORITARIOS } from '../../core/constants/regioes-prioritarias.constant';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';

type Assessor = { id: string; uid?: string; nome: string; papel: Papel };

@Component({
  selector: 'app-call-center',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './call-center.component.html',
})
export class CallCenterComponent implements OnInit, OnDestroy {

  private fs = inject(Firestore);
  private auth = inject(Auth);

  loading = signal(false);
  preCadastros = signal<PreCadastro[]>([]);
  assessores = signal<Assessor[]>([]);
  currentUser = signal<{ uid: string; nome?: string; papel?: string } | null>(null);

  private nomePorUid = new Map<string, string>();
  private nomesSignal = signal<Record<string, string>>({});

  private readonly RMB = new Set([
    'belem', 'ananindeua', 'marituba',
    'benevides', 'santa barbara do para', 'santa izabel do para',
  ]);

  // ===== Abas =====
  abaAtiva = signal<'geral' | 'meus' | 'agenda'>('geral');

  // ===== Filtros (aba geral) =====
  filtroAtendimento = signal<'todos' | 'nao_atendido' | 'em_atendimento' | 'finalizado'>('nao_atendido');
  filtroNome = signal<string>('');
  filtroCidade = signal<string>('');
  filtroUf = signal<string>('');
  filtroBairro = signal<string>('');
  filtroCpf = signal<string>('');
  filtroTelefone = signal<string>('');
  filtroOrigem = signal<string>('');
  filtroAtendente = signal<string>('');

  // ===== Paginação aba geral =====
  pageSize = 20;
  currentPage = 1;
  get totalItems(): number { return this.filtrados().length; }
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalItems / this.pageSize)); }
  get pageStart(): number { return this.totalItems ? (this.currentPage - 1) * this.pageSize : 0; }
  get pageEnd(): number { return Math.min(this.pageStart + this.pageSize, this.totalItems); }
  pageItems(): PreCadastro[] { return this.filtrados().slice(this.pageStart, this.pageEnd); }
  nextPage() { if (this.currentPage < this.totalPages) this.currentPage++; }
  prevPage() { if (this.currentPage > 1) this.currentPage--; }
  onPageSizeChange(val: number) { this.pageSize = Number(val) || 20; this.currentPage = 1; }

  // ===== Paginação aba meus =====
  meusPageSize = 20;
  meusCurrentPage = 1;
  get meusTotalItems(): number { return this.meusFiltrado().length; }
  get meusTotalPages(): number { return Math.max(1, Math.ceil(this.meusTotalItems / this.meusPageSize)); }
  get meusPageStart(): number { return this.meusTotalItems ? (this.meusCurrentPage - 1) * this.meusPageSize : 0; }
  get meusPageEnd(): number { return Math.min(this.meusPageStart + this.meusPageSize, this.meusTotalItems); }
  meusPageItems(): PreCadastro[] { return this.meusFiltrado().slice(this.meusPageStart, this.meusPageEnd); }
  meusNextPage() { if (this.meusCurrentPage < this.meusTotalPages) this.meusCurrentPage++; }
  meusPrevPage() { if (this.meusCurrentPage > 1) this.meusCurrentPage--; }

  // ===== Modal: Finalizar =====
  finalizarAberto = signal(false);
  private finalizarId = signal<string | null>(null);

  // ===== Aba Agenda =====
  filtroAssessorAgenda = signal<string>('');
  filtroPeriodoAgenda = signal<'todos' | 'semana' | 'mes'>('todos');

  agendamentosDoAssessor = computed(() => {
    const uid = this.filtroAssessorAgenda();
    const periodo = this.filtroPeriodoAgenda();

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    let inicioSemana: Date | null = null;
    let fimSemana: Date | null = null;
    let inicioMes: Date | null = null;
    let fimMes: Date | null = null;

    if (periodo === 'semana') {
      const dow = hoje.getDay(); // 0=dom
      inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - dow);
      fimSemana = new Date(inicioSemana);
      fimSemana.setDate(inicioSemana.getDate() + 6);
    } else if (periodo === 'mes') {
      inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    }

    return this.preCadastros()
      .filter(i => {
        const data: string = (i as any).agendamentoData;
        if (!data) return false;
        if (uid) {
          const vinculado =
            (i as any)?.encaminhamento?.assessorUid === uid ||
            (i as any)?.createdByUid === uid ||
            (i as any)?.alocadoParaUid === uid;
          if (!vinculado) return false;
        }

        if (periodo !== 'todos') {
          // data está em formato YYYY-MM-DD
          const [y, m, d] = data.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          if (periodo === 'semana') return dt >= inicioSemana! && dt <= fimSemana!;
          if (periodo === 'mes')   return dt >= inicioMes!    && dt <= fimMes!;
        }
        return true;
      })
      .sort((a, b) => {
        const da = (a as any).agendamentoData ?? '';
        const db = (b as any).agendamentoData ?? '';
        if (da < db) return -1;
        if (da > db) return 1;
        const ha = (a as any).agendamentoHora ?? '';
        const hb = (b as any).agendamentoHora ?? '';
        return ha.localeCompare(hb);
      });
  });

  // ===== Modal: Encaminhar para assessor =====
  encaminharAberto = signal(false);
  encaminharItem = signal<PreCadastro | null>(null);
  assessorSelecionado = signal<string>('');

  agendamentosAssessorEncaminhar = computed(() => {
    const uid = this.assessorSelecionado();
    if (!uid) return [];
    return this.preCadastros()
      .filter(i => {
        if (!(i as any).agendamentoData) return false;
        return (i as any)?.encaminhamento?.assessorUid === uid ||
               (i as any)?.createdByUid === uid ||
               (i as any)?.alocadoParaUid === uid;
      })
      .sort((a, b) => {
        const da = (a as any).agendamentoData ?? '';
        const db = (b as any).agendamentoData ?? '';
        if (da < db) return -1;
        if (da > db) return 1;
        return ((a as any).agendamentoHora ?? '').localeCompare((b as any).agendamentoHora ?? '');
      });
  });

  // ===== Modal: Agendamento =====
  agendamentoAberto = signal(false);
  private agendamentoItem = signal<PreCadastro | null>(null);
  agendamentoData = signal<string>('');
  agendamentoHora = signal<string>('');

  // ===== Modal: Editar cliente =====
  editarAberto = signal(false);
  private editarItem = signal<PreCadastro | null>(null);
  editForm = signal<{
    nomeCompleto: string;
    telefone: string;
    email: string;
    bairro: string;
    cidade: string;
    uf: string;
    modalidade: string;
    origem: string;
  }>({ nomeCompleto: '', telefone: '', email: '', bairro: '', cidade: '', uf: '', modalidade: '', origem: '' });
  salvandoEdicao = signal(false);

  constructor() {
    onAuthStateChanged(this.auth, async (u) => {
      if (!u) {
        this.currentUser.set(null);
        this.preCadastros.set([]);
        this.loading.set(false);
        return;
      }

      let papel: string | undefined;
      let nome: string | undefined;
      try {
        const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', '==', u.uid)));
        const hit = snap.docs[0]?.data() as any;
        papel = hit?.papel;
        nome = hit?.nome;
        if (nome) this.setNome(u.uid, nome);
      } catch { }

      this.currentUser.set({ uid: u.uid, nome: nome ?? u.displayName ?? undefined, papel });
      this.carregarTudo();
    });
  }

  ngOnInit(): void { }
  ngOnDestroy(): void { }

  // ===== Handlers de filtro =====
  onFiltroAtendimentoChange(v: string) { this.filtroAtendimento.set(v as any); this.currentPage = 1; }
  onFiltroNomeChange(v: string) { this.filtroNome.set(v.toLowerCase()); this.currentPage = 1; }
  onFiltroCidadeChange(v: string) { this.filtroCidade.set(v); this.filtroBairro.set(''); this.currentPage = 1; }
  onFiltroUfChange(v: string) { this.filtroUf.set(v); this.filtroCidade.set(''); this.filtroBairro.set(''); this.currentPage = 1; }
  onFiltroBairroChange(v: string) { this.filtroBairro.set(v); this.currentPage = 1; }
  onFiltroCpfChange(v: string) { this.filtroCpf.set(v.replace(/\D/g, '')); this.currentPage = 1; }
  onFiltroTelefoneChange(v: string) { this.filtroTelefone.set(v.replace(/\D/g, '')); this.currentPage = 1; }
  onFiltroOrigemChange(v: string) { this.filtroOrigem.set(v); this.currentPage = 1; }
  onFiltroAtendenteChange(v: string) { this.filtroAtendente.set(v); this.currentPage = 1; }

  // ===== Carregar dados =====
  async carregarTudo(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const [snapAss, snap1, snap2] = await Promise.all([
        getDocs(query(collection(this.fs, 'colaboradores'), where('papel', '==', 'assessor'), where('status', '==', 'ativo'))),
        getDocs(query(collection(this.fs, 'pre_cadastros'), where('elegivel.status', '==', 'sim'))),
        getDocs(query(collection(this.fs, 'pre-cadastros'), where('elegivel.status', '==', 'sim'))),
      ]);

      // Assessores
      const assRows = snapAss.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Assessor));
      assRows.forEach(a => { if (!a.uid) a.uid = a.id; this.setNome(a.uid!, a.nome); });
      assRows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
      this.assessores.set(assRows);

      // Pré-cadastros elegíveis
      const acc = new Map<string, any>();
      const needNames = new Set<string>();

      const processSnap = (snap: any, colName: string) => {
        snap.forEach((d: any) => {
          const raw = d.data() as any;
          const item = { id: d.id, ...raw, __col: colName };
          const prev = acc.get(item.id);
          acc.set(item.id, prev ? { ...prev, ...item } : item);
          if (item?.createdByUid) needNames.add(item.createdByUid);
          if (item?.atendimento?.porUid) needNames.add(item.atendimento.porUid);
          if (item?.encaminhamento?.assessorUid) needNames.add(item.encaminhamento.assessorUid);
        });
      };

      processSnap(snap1, 'pre_cadastros');
      processSnap(snap2, 'pre-cadastros');

      this.preCadastros.set(Array.from(acc.values()));
      await this.preloadColabNames(Array.from(needNames));
    } catch (e) {
      console.error('[CallCenter] erro ao carregar:', e);
    } finally {
      this.loading.set(false);
    }
  }

  atendentesOptions = computed(() => {
    const map = new Map<string, string>(); // uid → nome
    this.preCadastros().forEach(it => {
      const uid = it.atendimento?.porUid;
      const nome = it.atendimento?.porNome;
      if (uid && nome && !map.has(uid)) map.set(uid, nome);
    });
    return Array.from(map.entries())
      .map(([uid, nome]) => ({ uid, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  });

  origensOptions = computed(() => {
    const map = new Map<string, string>(); // lowercase → label original (primeiro encontrado)
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

  // ===== Computed: filtrados (aba geral) =====
  filtrados = computed(() => {
    const f = this.filtroAtendimento();
    const nome = this.filtroNome();
    const cidade = normalizarTexto(this.filtroCidade());
    const uf = this.filtroUf().toUpperCase();
    const bairro = normalizarTexto(this.filtroBairro());
    const cpf = this.filtroCpf().replace(/\D/g, '');
    const telefone = this.filtroTelefone().replace(/\D/g, '');
    const origem = this.filtroOrigem();

    let base = [...this.preCadastros()];

    if (f !== 'todos') base = base.filter(i => (i.atendimento?.status ?? 'nao_atendido') === f);
    if (nome) base = base.filter(i => normalizarTexto(i.nomeCompleto || '').includes(nome));
    if (cidade) base = base.filter(i => normalizarTexto((i as any).cidade || '').includes(cidade));
    if (uf) base = base.filter(i => ((i as any).uf || '').toUpperCase().includes(uf));
    if (bairro) base = base.filter(i => normalizarTexto((i as any).bairro || '').includes(bairro));
    if (cpf) base = base.filter(i => ((i as any).cpf || '').replace(/\D/g, '').includes(cpf));
    if (telefone) base = base.filter(i => ((i as any).telefone || '').replace(/\D/g, '').includes(telefone));
    if (origem) base = base.filter(i => ((i as any).origem || '').trim().toLowerCase() === origem);
    const atendente = this.filtroAtendente();
    if (atendente) base = base.filter(i => i.atendimento?.porUid === atendente);

    const order: Record<string, number> = { em_atendimento: 0, nao_atendido: 1, finalizado: 2 };
    const toMs = (item: PreCadastro): number => {
      const ts = (item as any).createdAt;
      if (!ts) return 0;
      if (typeof ts.toMillis === 'function') return ts.toMillis();
      if (typeof ts.seconds === 'number') return ts.seconds * 1000;
      if (ts instanceof Date) return ts.getTime();
      return 0;
    };
    const isRmb = (item: PreCadastro) => this.RMB.has(normalizarTexto((item as any).cidade || ''));
    return base.sort((a, b) => {
      // 1. RMB tem prioridade sobre outras localidades
      const rA = isRmb(a) ? 0 : 1;
      const rB = isRmb(b) ? 0 : 1;
      if (rA !== rB) return rA - rB;
      const tA = this.temTentativas(a);
      const tB = this.temTentativas(b);
      // 2. Clientes com tentativas de contato vêm primeiro
      if (tA && !tB) return -1;
      if (!tA && tB) return 1;
      // 3. Ambos têm tentativas: mais recente primeiro
      if (tA && tB) return this.ultimaTentativaMs(b) - this.ultimaTentativaMs(a);
      // 4. Sem tentativas: por status → mais recente
      const oa = order[a.atendimento?.status ?? 'nao_atendido'] ?? 1;
      const ob = order[b.atendimento?.status ?? 'nao_atendido'] ?? 1;
      if (oa !== ob) return oa - ob;
      return toMs(b) - toMs(a);
    });
  });

  // ===== Computed: meus / todos os atendimentos =====
  meusFiltroPorAtendente = signal<string>('');
  meusDataInicio = signal<string>('');
  meusDataFim = signal<string>('');
  meusNome = signal<string>('');
  meusCpf = signal<string>('');
  meusTelefone = signal<string>('');

  meusFiltrado = computed(() => {
    const cu = this.currentUser();
    if (!cu?.uid) return [];

    const isAdmin = cu.papel === 'admin';
    const filtroUid = this.meusFiltroPorAtendente();
    const dataInicio = this.meusDataInicio();
    const dataFim = this.meusDataFim();
    const nome = normalizarTexto(this.meusNome());
    const cpf = this.meusCpf().replace(/\D/g, '');
    const telefone = this.meusTelefone().replace(/\D/g, '');

    // Converte 'YYYY-MM-DD' para timestamps de início e fim do dia
    const inicioDia = dataInicio ? new Date(dataInicio + 'T00:00:00').getTime() : null;
    const fimDia    = dataFim    ? new Date(dataFim    + 'T23:59:59').getTime() : null;

    const tsAtendimento = (i: PreCadastro): number => {
      const em = (i as any).atendimento?.em;
      if (!em) return 0;
      if (typeof em.toMillis === 'function') return em.toMillis();
      if (typeof em.seconds === 'number') return em.seconds * 1000;
      if (em instanceof Date) return em.getTime();
      return 0;
    };

    return this.preCadastros()
      .filter(i => {
        const st = i.atendimento?.status ?? 'nao_atendido';
        const porUid = i.atendimento?.porUid;
        if (st !== 'em_atendimento' && st !== 'finalizado') return false;
        if (isAdmin) {
          if (filtroUid && porUid !== filtroUid) return false;
          const ts = tsAtendimento(i);
          if (inicioDia && ts && ts < inicioDia) return false;
          if (fimDia    && ts && ts > fimDia)    return false;
        } else {
          if (porUid !== cu.uid) return false;
        }
        if (nome && !normalizarTexto(i.nomeCompleto || '').includes(nome)) return false;
        if (cpf && !((i as any).cpf || '').replace(/\D/g, '').includes(cpf)) return false;
        if (telefone && !((i as any).telefone || '').replace(/\D/g, '').includes(telefone)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.atendimento?.status === 'em_atendimento' && b.atendimento?.status !== 'em_atendimento') return -1;
        if (b.atendimento?.status === 'em_atendimento' && a.atendimento?.status !== 'em_atendimento') return 1;
        return tsAtendimento(b) - tsAtendimento(a);
      });
  });

  // ===== Verifica permissão de ação =====
  isOperacional(): boolean {
    const papel = this.currentUser()?.papel;
    return papel === 'operacional' || papel === 'admin';
  }

  // ===== Ação: Iniciar atendimento =====
  async iniciarAtendimento(item: PreCadastro) {
    const cu = this.currentUser();
    if (!cu) return;

    const porNome = this.nomeDoAutor(cu.uid) || cu.nome || 'Operacional';

    const payload: any = {
      'atendimento.status': 'em_atendimento',
      'atendimento.porUid': cu.uid,
      'atendimento.porNome': porNome,
      'atendimento.em': serverTimestamp(),
      'atendimento.observacao': null,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, atendimento: { status: 'em_atendimento', porNome, porUid: cu.uid } }
        : it
      )
    );
  }

  // ===== Ação: Liberar atendimento =====
  async liberarAtendimento(item: PreCadastro) {
    const payload: any = {
      'atendimento.status': 'nao_atendido',
      'atendimento.porUid': null,
      'atendimento.porNome': null,
      'atendimento.em': null,
      'atendimento.observacao': null,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, atendimento: { status: 'nao_atendido', porNome: null, porUid: null } }
        : it
      )
    );
  }

  // ===== Modal: Finalizar =====
  abrirModalFinalizar(item: PreCadastro) {
    this.finalizarId.set(item.id);
    this.finalizarAberto.set(true);
  }

  fecharModalFinalizar() {
    this.finalizarAberto.set(false);
    this.finalizarId.set(null);
  }

  async confirmarFinalizar(obs: string) {
    const id = this.finalizarId();
    const cu = this.currentUser();
    if (!id || !cu) return;

    const porNome = this.nomeDoAutor(cu.uid) || cu.nome || 'Operacional';

    const payload: any = {
      'atendimento.status': 'finalizado',
      'atendimento.porUid': cu.uid,
      'atendimento.porNome': porNome,
      'atendimento.em': serverTimestamp(),
      'atendimento.observacao': obs.trim() || null,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === id
        ? { ...it as any, atendimento: { status: 'finalizado', porNome, porUid: cu.uid, observacao: obs.trim() || null } }
        : it
      )
    );

    this.fecharModalFinalizar();
  }

  // ===== Modal: Encaminhar para assessor =====
  abrirModalEncaminhar(item: PreCadastro) {
    this.encaminharItem.set(item);
    const jaVinculado = (item as any)?.encaminhamento?.assessorUid ?? '';
    this.assessorSelecionado.set(jaVinculado);
    this.encaminharAberto.set(true);
  }

  fecharModalEncaminhar() {
    this.encaminharAberto.set(false);
    this.encaminharItem.set(null);
    this.assessorSelecionado.set('');
  }

  async confirmarEncaminhar() {
    const item = this.encaminharItem();
    const chosen = this.assessorSelecionado();
    const cu = this.currentUser();
    if (!item || !chosen || !cu) return;

    const ass = this.assessores().find(a => (a.uid || a.id) === chosen);
    const realUid = ass?.uid || ass?.id || chosen;
    const assessorNome = ass?.nome || this.nomeDoAutor(realUid) || null;
    if (assessorNome) this.setNome(realUid, assessorNome);

    const criadorUid = (item as any)?.createdByUid ?? null;
    const visivelParaUids = Array.from(new Set([realUid, cu.uid, criadorUid].filter(Boolean))) as string[];

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
      analistaId: cu.uid,
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      setDoc(doc(this.fs, 'pre_cadastros', item.id), payload, { merge: true }),
    ]);

    await setDoc(
      doc(this.fs, `inboxes_assessores/${realUid}/itens/${item.id}`),
      {
        preCadastroId: item.id,
        path: `pre_cadastros/${item.id}`,
        nomeCompleto: (item as any)?.nomeCompleto ?? null,
        cpf: (item as any)?.cpf ?? null,
        em: serverTimestamp(),
      },
      { merge: true }
    );

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, encaminhamento: { assessorUid: realUid, assessorNome, em: null }, caixaAtual: 'assessor' }
        : it
      )
    );

    this.fecharModalEncaminhar();
  }

  async retirarAssessor() {
    const item = this.encaminharItem();
    if (!item) return;

    const payload: any = {
      encaminhamento: deleteField(),
      caixaAtual: deleteField(),
      caixaUid: deleteField(),
      destinatarioTipo: deleteField(),
      destinatarioUid: deleteField(),
      alocadoParaUid: deleteField(),
      alocadoParaNome: deleteField(),
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => {
        if (it.id !== item.id) return it;
        const updated = { ...it as any };
        delete updated.encaminhamento;
        delete updated.caixaAtual;
        delete updated.caixaUid;
        delete updated.alocadoParaUid;
        delete updated.alocadoParaNome;
        return updated;
      })
    );

    this.fecharModalEncaminhar();
  }

  // ===== Modal: Agendamento =====
  abrirModalAgendamento(item: PreCadastro) {
    this.agendamentoItem.set(item);
    this.agendamentoData.set((item as any)?.agendamentoData ?? '');
    this.agendamentoHora.set((item as any)?.agendamentoHora ?? '');
    this.agendamentoAberto.set(true);
  }

  fecharModalAgendamento() {
    this.agendamentoAberto.set(false);
    this.agendamentoItem.set(null);
    this.agendamentoData.set('');
    this.agendamentoHora.set('');
  }

  async confirmarAgendamento() {
    const item = this.agendamentoItem();
    const data = this.agendamentoData().trim();
    const hora = this.agendamentoHora().trim();
    if (!item || !data) return;

    const payload: any = {
      agendamentoData: data,
      agendamentoHora: hora || null,
      agendamentoStatus: 'agendado',
      atualizadoEm: serverTimestamp(),
    };

    await Promise.all([
      updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
      updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
    ]);

    this.preCadastros.update(list =>
      list.map(it => it.id === item.id
        ? { ...it as any, agendamentoData: data, agendamentoHora: hora || null, agendamentoStatus: 'agendado' }
        : it
      )
    );

    this.fecharModalAgendamento();
  }

  // ===== Modal: Editar cliente =====
  abrirModalEditar(item: PreCadastro) {
    this.editarItem.set(item);
    this.editForm.set({
      nomeCompleto: item.nomeCompleto ?? '',
      telefone: item.telefone ?? '',
      email: item.email ?? '',
      bairro: item.bairro ?? '',
      cidade: (item as any).cidade ?? '',
      uf: (item as any).uf ?? '',
      modalidade: item.modalidade ?? '',
      origem: item.origem ?? '',
    });
    this.editarAberto.set(true);
  }

  fecharModalEditar() {
    this.editarAberto.set(false);
    this.editarItem.set(null);
    this.salvandoEdicao.set(false);
  }

  async confirmarEdicao() {
    const item = this.editarItem();
    if (!item) return;

    this.salvandoEdicao.set(true);
    try {
      const f = this.editForm();
      const payload: any = {
        nomeCompleto: f.nomeCompleto.trim(),
        telefone: f.telefone.trim(),
        email: f.email.trim(),
        bairro: f.bairro.trim(),
        cidade: f.cidade.trim(),
        uf: f.uf.trim().toUpperCase(),
        modalidade: f.modalidade.trim(),
        origem: f.origem.trim(),
        atualizadoEm: serverTimestamp(),
      };

      await Promise.all([
        updateDoc(doc(this.fs, 'pre_cadastros', item.id), payload).catch(() => { }),
        updateDoc(doc(this.fs, 'pre-cadastros', item.id), payload).catch(() => { }),
      ]);

      this.preCadastros.update(list =>
        list.map(it => it.id === item.id ? { ...it as any, ...payload } : it)
      );

      this.fecharModalEditar();
    } catch (e) {
      console.error('[CallCenter] erro ao salvar edição:', e);
    } finally {
      this.salvandoEdicao.set(false);
    }
  }

  updateEditForm(field: string, value: string) {
    this.editForm.update(f => ({ ...f, [field]: value }));
  }

  // ===== Helpers =====
  atendimentoStatus(item: PreCadastro): 'nao_atendido' | 'em_atendimento' | 'finalizado' {
    return (item.atendimento?.status ?? 'nao_atendido') as any;
  }

  temTentativas(item: PreCadastro): boolean {
    const t = (item as any).tentativasContato;
    return Array.isArray(t) && t.length > 0;
  }

  ultimaTentativaMs(item: PreCadastro): number {
    const t = (item as any).tentativasContato as any[];
    if (!Array.isArray(t) || !t.length) return 0;
    const ultimo = t[t.length - 1];
    if (!ultimo) return 0;
    if (typeof ultimo.toMillis === 'function') return ultimo.toMillis();
    if (typeof ultimo.seconds === 'number') return ultimo.seconds * 1000;
    if (ultimo instanceof Date) return ultimo.getTime();
    return 0;
  }

  ultimaTentativaData(item: PreCadastro): Date | null {
    const ms = this.ultimaTentativaMs(item);
    return ms ? new Date(ms) : null;
  }

  contarTentativas(item: PreCadastro): number {
    const t = (item as any).tentativasContato;
    return Array.isArray(t) ? t.length : 0;
  }

  contarPorStatus(status: string): number {
    return this.preCadastros().filter(i => (i.atendimento?.status ?? 'nao_atendido') === status).length;
  }

  nomeDoAutor(uid?: string | null): string {
    if (!uid) return '';
    return this.nomesSignal()[uid] || this.nomePorUid.get(uid) || uid;
  }

  cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  private setNome(uid: string, nome?: string) {
    if (!uid || !nome) return;
    this.nomePorUid.set(uid, nome);
    const curr = this.nomesSignal();
    if (curr[uid] !== nome) this.nomesSignal.set({ ...curr, [uid]: nome });
  }

  private async preloadColabNames(uids: string[]) {
    const missing = uids.filter(u => u && !this.nomePorUid.has(u));
    if (!missing.length) return;

    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));

    for (const c of chunks) {
      try {
        const snap = await getDocs(query(collection(this.fs, 'colaboradores'), where('uid', 'in', c)));
        snap.docs.forEach(d => this.setNome((d.data() as any)?.uid || d.id, (d.data() as any)?.nome));
      } catch { }
    }

    const still = missing.filter(u => !this.nomePorUid.has(u));
    for (const uid of still) {
      try {
        const s = await getDoc(doc(this.fs, 'colaboradores', uid));
        if (s.exists()) this.setNome(uid, (s.data() as any)?.nome || uid);
      } catch { }
    }
  }
}
