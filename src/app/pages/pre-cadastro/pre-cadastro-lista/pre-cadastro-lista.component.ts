import { Component, inject, signal, computed, effect, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { Auth, user } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { PreCadastro, FluxoCaixa, ArquivoPreCadastro } from '../../../models/pre-cadastro.model';
import { HeaderComponent } from '../../shared/header/header.component';
import { AgendamentoService } from '../../../services/agendamento.service';
import {
  Timestamp,
  Firestore,
  doc,
  getDoc,
  collection,
  query as fsQuery,
  where,
  getDocs,
  limit
} from '@angular/fire/firestore';

// ===== NOVO: Grupos =====
import { GrupoSolidario, MembroGrupoView } from '../../../models/grupo-solidario.model';
import { GrupoSolidarioService } from '../../../services/grupo-solidario.service';

type PreCadastroEdit = PreCadastro & { id: string };

@Component({
  selector: 'app-pre-cadastro-lista',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe, FormsModule, HeaderComponent],
  templateUrl: './pre-cadastro-lista.component.html',
  styleUrls: ['./pre-cadastro-lista.component.css']
})
export class PreCadastroListaComponent implements OnInit, OnDestroy {
  private service = inject(PreCadastroService);
  private agService = inject(AgendamentoService);
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private afs = inject(Firestore);

  // ===== NOVO: service de grupos
  private gruposSvc = inject(GrupoSolidarioService);

  loading = signal(true);
  itens = signal<PreCadastro[]>([]);
  private sub?: Subscription;

  // ====== UI STATE ======
  searchTerm = signal<string>('');

  // filtros principais
  filtroStatus = signal<'todos' | 'nao_agendado' | 'agendado' | 'visitado'>('todos');
  filtroHasPhone = signal<'todos' | 'sim' | 'nao'>('todos');
  filtroHasEmail = signal<'todos' | 'sim' | 'nao'>('todos');
  filtroBairro = signal<string>('');
  filtroDataIni = signal<string>(''); // yyyy-MM-dd
  filtroDataFim = signal<string>(''); // yyyy-MM-dd

  // ====== NOVOS FILTROS EXTRA ======
  // grupo: todos / com / sem
  filtroGrupo = signal<'todos' | 'com_grupo' | 'sem_grupo'>('todos');

  // checkboxes rápidos
  filtroFormalizados = signal<boolean>(false);
  filtroSomenteAgendados = signal<boolean>(false);
  filtroSomenteVisitados = signal<boolean>(false);
  filtroProximosAgendamentos = signal<boolean>(false); // próximos 7 dias

  // paginação (PESSOAS)
  pageSize = signal<number>(9);
  page = signal<number>(1);

  // ====== NOVO: Abas Pessoas | Grupos ======
  aba = signal<'pessoas' | 'grupos'>('pessoas');

  // Estado GRUPOS (lista do assessor)
  gruposLoading = signal(false);
  grupos = signal<GrupoSolidario[]>([]);

  // paginação (GRUPOS) — independentes da aba Pessoas
  pageGrupos = signal<number>(1);
  pageSizeGrupos = signal<number>(6);

  // modais (PESSOAS)
  modalVerAberto = signal(false);
  modalEditarAberto = signal(false);
  modalAgendarAberto = signal(false);

  // Modal de detalhes do grupo (coordenador + membros)
  modalGrupoAberto = signal(false);
  grupoSelecionado = signal<GrupoSolidario | null>(null);

  // NOVOS modais (PESSOAS)
  modalObsAberto = signal(false);
  modalArqsAberto = signal(false);

  viewItem = signal<PreCadastro | null>(null);
  editModel = signal<PreCadastroEdit | null>(null);
  itemAgendar = signal<PreCadastro | null>(null);

  // Observações (PESSOAS)
  obsModel = signal<string>('');

  // Arquivos (PESSOAS)
  arqsCarregando = signal(false);
  arqsLista = signal<ArquivoPreCadastro[]>([]);
  uploadEmProgresso = signal(false);

  saving = signal(false);
  agSalvando = signal(false);

  agData: string = ''; // yyyy-MM-dd
  agHora: string = ''; // HH:mm

  toastVisivel = signal(false);
  highlightId = signal<string | null>(null);

  currentUserUid: string | null = null;
  currentUserNome: string | null = null;

  // cache simples para evitar leituras repetidas do mesmo uid
  private nomeCache = new Map<string, string>();

  constructor() {
    // sempre que busca/filtros mudarem, voltar para a primeira página (PESSOAS)
    effect(() => {
      this.searchTerm();
      this.filtroStatus();
      this.filtroHasPhone();
      this.filtroHasEmail();
      this.filtroBairro();
      this.filtroDataIni();
      this.filtroDataFim();

      // novos filtros também resetam página
      this.filtroGrupo();
      this.filtroFormalizados();
      this.filtroSomenteAgendados();
      this.filtroSomenteVisitados();
      this.filtroProximosAgendamentos();

      this.page.set(1);
    });
  }

  async ngOnInit(): Promise<void> {
    this.route.queryParamMap.subscribe(pm => {
      const hId = pm.get('highlightId');
      const flash = pm.get('highlightFlash');
      if (hId) this.highlightId.set(hId);
      if (flash) {
        this.toastVisivel.set(true);
        setTimeout(() => this.toastVisivel.set(false), 3000);
      }
    });

    this.sub = user(this.auth).subscribe(async u => {
      this.loading.set(true);
      try {
        if (!u) {
          this.itens.set([]);
          this.grupos.set([]);
          return;
        }
        this.currentUserUid = u.uid;
        this.currentUserNome = await this.resolveUserName(u.uid);

        // ==== Pessoas (pré-cadastros) ====
        let rows: PreCadastro[] = [];
        const svcAny = this.service as any;

        if (typeof svcAny.listarParaCaixa === 'function') {
          // Caixa normal (assessor/analista) – o que já vinha antes
          rows = await svcAny.listarParaCaixa(u.uid);
        } else {
          rows = await this.service.listarDoAssessor(u.uid);
        }

        // 🔹 EXTRA: também trazer os pré-cadastros que ESTE usuário encaminhou
        const encaminhados = await this.buscarPreCadastrosEncaminhadosPor(u.uid);

        // 🔹 Mesclar os dois conjuntos (caixa + encaminhados), sem duplicar
        const mapRows = new Map<string, PreCadastro>();

        for (const r of rows || []) {
          if (r?.id) {
            mapRows.set(r.id, r);
          }
        }

        for (const e of encaminhados || []) {
          if (!e?.id) continue;
          const atual = mapRows.get(e.id);
          // se já existir, mescla; se não existir, adiciona do jeito que veio
          mapRows.set(e.id, { ...(atual as any), ...(e as any) });
        }

        // Aqui você passa a trabalhar só com "mergedRows"
        const mergedRows = Array.from(mapRows.values());

        const norm = mergedRows.map(r => {
          const formalizacao = (r as any).formalizacao || {};
          const desistencia = (r as any).desistencia || {};

          // 🔎 Tenta mapear o grupo a partir de vários formatos possíveis
          const rawGrupo: any = (r as any).grupo || null;

          const grupoId =
            (r as any).grupoId ??
            (r as any).grupoSolidarioId ??      // ex: se você salvou com esse nome
            (rawGrupo?.id ?? null);

          const grupoNome =
            (r as any).grupoNome ??
            rawGrupo?.nome ??
            null;

          const papelNoGrupo =
            (r as any).papelNoGrupo ??
            (r as any).grupoPapel ??
            rawGrupo?.papel ??
            null;

          return {
            agendamentoStatus: (r as any).agendamentoStatus || 'nao_agendado',

            // ✅ agora a badge enxerga o grupo
            grupoId,
            grupoNome,
            papelNoGrupo,

            formalizacao: {
              status: (formalizacao.status as any) || 'nao_formalizado',
              porUid: formalizacao.porUid,
              porNome: formalizacao.porNome,
              em: formalizacao.em,
              observacao: formalizacao.observacao ?? null
            },
            desistencia: {
              status: (desistencia.status as any) || 'nao_desistiu',
              porUid: desistencia.porUid,
              porNome: desistencia.porNome,
              em: desistencia.em,
              observacao: desistencia.observacao ?? null
            },
            observacoes: (r as any).observacoes ?? null,
            arquivos: (r as any).arquivos ?? [],
            ...r
          } as PreCadastro;
        });


        this.itens.set(norm);


        // ==== Grupos (aba "Grupos") ====
        await this.loadGruposDoAssessor(u.uid);

        // ==== Grupos (aba "Grupos") ====
        await this.loadGruposDoAssessor(u.uid);

        // 🔁 NOVO: usa membrosIds dos grupos para popular a aba Pessoas
        await this.mesclarPreCadastrosDeGrupos();

      } catch (err) {
        console.error('[PreCadastro] Erro ao listar:', err);
        this.itens.set([]);
        this.grupos.set([]);
      } finally {
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  // ===== Helpers =====
  private onlyDigits(v?: string | null): string { return (v ?? '').replace(/\D+/g, ''); }

  private toJSDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') {
      try { return v.toDate(); } catch { return null; }
    }
    return null;
  }

  private normalize(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  onWhatsClick(evt: MouseEvent, tel?: string | null, toggle?: HTMLInputElement) {
    evt.preventDefault();
    const url = this.whatsHref(tel);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      if (toggle) toggle.checked = false;
    }
  }

  whatsHref(v?: string | null): string | null {
    const core = this.normalizeBRPhone(v);
    return core ? `https://wa.me/${core}` : null;
  }

  private normalizeBRPhone(v?: string | null): string | null {
    if (!v) return null;
    let d = String(v).replace(/\D+/g, '');
    if (d.startsWith('55')) d = d.slice(2);
    d = d.replace(/^0+/, '');
    if (d.length < 10 || d.length > 11) return null;
    const full = `55${d}`;
    if (full.length < 12 || full.length > 13) return null;
    return full;
  }

  ufFlagSrc(uf?: string | null): string | null {
    const code = (uf || '').toLowerCase().trim();
    if (!code || code.length !== 2) return null;
    return `/assets/flags/uf-${code}.svg`;
  }

  ufTitle(uf?: string | null): string {
    return (uf || '').toUpperCase();
  }

  // 🔹 Resolve nome do usuário a partir do perfil (coleção "colaboradores")
  private async resolveUserName(uid: string): Promise<string> {
    if (this.nomeCache.has(uid)) return this.nomeCache.get(uid)!;

    let nome: string | null = null;

    try {
      const snap = await getDoc(doc(this.afs, 'colaboradores', uid));
      if (snap.exists()) {
        const data: any = snap.data();
        if (data?.nome) nome = String(data.nome);
      }
    } catch (e) {
      console.warn('[NomePerfil] doc direto falhou:', e);
    }

    if (!nome) {
      try {
        const q = fsQuery(collection(this.afs, 'colaboradores'), where('uid', '==', uid), limit(1));
        const qs = await getDocs(q);
        qs.forEach(d => {
          const data: any = d.data();
          if (!nome && data?.nome) nome = String(data.nome);
        });
      } catch (e) {
        console.warn('[NomePerfil] query por uid falhou:', e);
      }
    }

    if (!nome) nome = this.auth.currentUser?.displayName || null;

    if (!nome) {
      const email = this.auth.currentUser?.email || '';
      if (email) {
        const local = email.split('@')[0].replace(/[._-]+/g, ' ');
        nome = local.replace(/\b\w/g, c => c.toUpperCase());
      }
    }

    if (!nome) nome = 'Usuário';

    this.nomeCache.set(uid, nome);
    return nome;
  }

  // ===== Busca extra: pré-cadastros que ESTE usuário ENCAMINHOU (analista) =====
  private async buscarPreCadastrosEncaminhadosPor(uid: string): Promise<PreCadastro[]> {
    try {
      console.log('[PreCadastro] buscarPreCadastrosEncaminhadosPor UID =', uid);

      // 🔴 ANTES
      // const ref = collection(this.afs, 'pre-cadastros');

      // ✅ AGORA (igual ao nome real da coleção no banco)
      const ref = collection(this.afs, 'pre_cadastros');

      const q = fsQuery(
        ref,
        where('encaminhadoPorUid', '==', uid)
      );

      const snap = await getDocs(q);

      console.log('[PreCadastro] snapshot size =', snap.size);

      const lista: PreCadastro[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data() as any;

        console.log('[PreCadastro] enc doc:', docSnap.id, {
          encaminhadoPorUid: data?.encaminhadoPorUid,
          caixaAtual: data?.caixaAtual,
          caixaUid: data?.caixaUid,
          encaminhadoParaUid: data?.encaminhadoParaUid
        });

        lista.push({
          id: docSnap.id,
          ...data
        } as PreCadastro);
      });

      console.log('[PreCadastro] Encaminhados por', uid, '=>', lista.length, 'doc(s)');
      return lista;

    } catch (e) {
      console.error('[PreCadastro] erro ao buscar encaminhados por uid:', e);
      return [];
    }
  }

// ===== Busca extra: GRUPOS que ESTE usuário ENCAMINHOU (analista) =====
private async buscarGruposEncaminhadosPor(uid: string): Promise<GrupoSolidario[]> {
  try {
    console.log('[Grupos] buscarGruposEncaminhadosPor UID =', uid);

    // Ajuste o nome da coleção se no seu banco estiver diferente
    // (ex.: 'grupos_solidarios' ou 'grupos-solidarios')
    const ref = collection(this.afs, 'grupos_solidarios');

    const q = fsQuery(
      ref,
      where('encaminhadoPorUid', '==', uid)
    );

    const snap = await getDocs(q);
    console.log('[Grupos] snapshot encaminhados size =', snap.size);

    const lista: GrupoSolidario[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as any;

      console.log('[Grupos] enc doc:', docSnap.id, {
        encaminhadoPorUid: data?.encaminhadoPorUid,
        encaminhadoParaUid: data?.encaminhadoParaUid,
        caixaAtual: data?.caixaAtual,
        caixaUid: data?.caixaUid
      });

      lista.push({
        id: docSnap.id,
        ...data
      } as GrupoSolidario);
    });

    console.log('[Grupos] Encaminhados por', uid, '=>', lista.length, 'grupo(s)');
    return lista;
  } catch (e) {
    console.error('[Grupos] erro ao buscar grupos encaminhados por uid:', e);
    return [];
  }
}


  // ======= HELPERS: aprovação & encaminhamento & formalização & desistência =======
  aprovacaoStatus(i: PreCadastro): 'apto' | 'inapto' {
    return ((i as any)?.aprovacao?.status === 'apto') ? 'apto' : 'inapto';
  }
  aprovacaoBadgeClass(i: PreCadastro) {
    return this.aprovacaoStatus(i) === 'apto' ? 'text-bg-success' : 'text-bg-danger';
  }

  encaminhadoParaMim(i: PreCadastro): boolean {
    const uid = this.currentUserUid;
    if (!uid) return false;

    const encUidPlano = (i as any)?.encaminhadoParaUid;
    const encUidNested = (i as any)?.encaminhamento?.assessorUid;
    const caixa = (i as any)?.caixaUid;
    const criador = (i as any)?.createdByUid;
    const encPorUid = (i as any)?.encaminhadoPorUid;

    // aparece como distribuído se:
    // - eu sou o destino (assessor)
    // - ou está na minha caixa
    // - ou fui eu que encaminhei
    return (
      encUidPlano === uid ||
      encUidNested === uid ||
      caixa === uid ||
      encPorUid === uid
    );
  }


  encaminhadoPorNome(i: PreCadastro): string | null {
    return (
      (i as any)?.encaminhadoPorNome ||
      (i as any)?.aprovacao?.porNome ||
      (i as any)?.encaminhamento?.porNome ||
      null
    );
  }

  encaminhadoPorMim(i: PreCadastro): boolean {
    const uid = this.currentUserUid;
    const encPor = (i as any)?.encaminhadoPorUid;
    return !!uid && encPor === uid;
  }

  encaminhadoParaNome(i: PreCadastro): string | null {
    const plano = (i as any)?.encaminhadoParaNome;
    const nestedAssessor = (i as any)?.encaminhamento?.assessorNome;
    const nestedDest = (i as any)?.encaminhamento?.destinatarioNome;

    return plano || nestedAssessor || nestedDest || null;
  }


  encaminhadoQuando(i: PreCadastro): Date | null {
    const ts =
      (i as any)?.encaminhadoEm ||
      (i as any)?.encaminhamento?.em ||
      (i as any)?.aprovacao?.em;
    return this.toJSDate(ts);
  }

  // Formalização
  formalizacaoStatus(i: PreCadastro): 'formalizado' | 'nao_formalizado' {
    const st = (i as any)?.formalizacao?.status;
    return st === 'formalizado' ? 'formalizado' : 'nao_formalizado';
  }
  formalizacaoBadgeClass(i: PreCadastro) {
    return this.formalizacaoStatus(i) === 'formalizado' ? 'text-bg-success' : 'text-bg-secondary';
  }

  // Desistência
  desistenciaStatus(i: PreCadastro): 'desistiu' | 'nao_desistiu' {
    const st = (i as any)?.desistencia?.status;
    return st === 'desistiu' ? 'desistiu' : 'nao_desistiu';
  }
  desistenciaBadgeClass(i: PreCadastro) {
    return this.desistenciaStatus(i) === 'desistiu' ? 'text-bg-warning' : 'text-bg-secondary';
  }

  // ===== Derived UI data (PESSOAS) =====
  bairrosDisponiveis = computed<string[]>(() => {
    const set = new Set<string>();
    for (const x of this.itens()) {
      const b = (x.bairro ?? '').trim();
      if (b) set.add(b);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  filteredItems = computed<PreCadastro[]>(() => {
    const term = this.normalize(this.searchTerm());
    const st = this.filtroStatus();
    const hasPhone = this.filtroHasPhone();
    const hasEmail = this.filtroHasEmail();
    const bairro = this.filtroBairro();
    const dataIni = this.filtroDataIni();
    const dataFim = this.filtroDataFim();
    const grupoFilter = this.filtroGrupo();
    const apenasFormal = this.filtroFormalizados();
    const onlyAg = this.filtroSomenteAgendados();
    const onlyVis = this.filtroSomenteVisitados();
    const proximos = this.filtroProximosAgendamentos();

    const dtIni = dataIni ? new Date(dataIni + 'T00:00:00') : null;
    const dtFim = dataFim ? new Date(dataFim + 'T23:59:59') : null;

    let hoje: Date | null = null;
    let limite: Date | null = null;
    if (proximos) {
      hoje = new Date();
      limite = new Date(hoje);
      limite.setDate(hoje.getDate() + 7); // próximos 7 dias
    }

    return this.itens().filter(i => {
      // Busca por nome
      if (term) {
        const nome = this.normalize(i.nomeCompleto ?? (i as any).nome ?? '');
        if (!nome.includes(term)) return false;
      }

      // Filtro status principal
      const statusAtual = (i.agendamentoStatus || 'nao_agendado') as 'nao_agendado' | 'agendado' | 'visitado';
      if (st !== 'todos' && statusAtual !== st) return false;

      // Filtro por grupo
      if (grupoFilter === 'com_grupo' && !i.grupoId) return false;
      if (grupoFilter === 'sem_grupo' && i.grupoId) return false;

      // Filtro "apenas formalizados"
      if (apenasFormal && this.formalizacaoStatus(i) !== 'formalizado') return false;

      // Checkboxes "Agendados" / "Visitados" (multi-status)
      if (onlyAg || onlyVis) {
        const s = (i.agendamentoStatus || 'nao_agendado') as 'nao_agendado' | 'agendado' | 'visitado';
        const matchAg = onlyAg && s === 'agendado';
        const matchVis = onlyVis && s === 'visitado';
        if (!matchAg && !matchVis) return false;
      }

      // Filtro "Próximos agendamentos"
      if (proximos && hoje && limite) {
        const agData = this.toJSDate((i as any).agendamentoDataHora);
        if (!agData) return false;
        if (agData < hoje || agData > limite) return false;
      }

      // Telefone
      const temTel = !!(i.telefone && this.onlyDigits(i.telefone).length >= 10);
      if (hasPhone === 'sim' && !temTel) return false;
      if (hasPhone === 'nao' && temTel) return false;

      // Email
      const temEmail = !!((i.email ?? '').trim());
      if (hasEmail === 'sim' && !temEmail) return false;
      if (hasEmail === 'nao' && temEmail) return false;

      // Bairro
      if (bairro && (i.bairro ?? '') !== bairro) return false;

      // Filtro por data de criação
      if (dtIni || dtFim) {
        const created = this.toJSDate(i.createdAt);
        if (!created) return false;
        if (dtIni && created < dtIni) return false;
        if (dtFim && created > dtFim) return false;
      }

      return true;
    });
  });

  totalFiltrado = computed<number>(() => this.filteredItems().length);
  totalGeral = computed<number>(() => this.itens().length);

  totalPages = computed<number>(() => {
    const n = Math.ceil(this.totalFiltrado() / this.pageSize());
    return Math.max(1, n || 1);
  });

  pagedItems = computed<PreCadastro[]>(() => {
    const p = this.page();
    const ps = this.pageSize();
    const arr = this.filteredItems();
    const start = (p - 1) * ps;
    return arr.slice(start, start + ps);
  });

  setPageSize(n: number) {
    this.pageSize.set(n);
    this.page.set(1);
  }
  goFirst() { this.page.set(1); }
  goPrev() { this.page.update(p => Math.max(1, p - 1)); }
  goNext() { this.page.update(p => Math.min(this.totalPages(), p + 1)); }
  goLast() { this.page.set(this.totalPages()); }
  goTo(n: number) { this.page.set(Math.min(Math.max(1, n), this.totalPages())); }

  // ====== NOVO: Abas ======
  setAba(aba: 'pessoas' | 'grupos') {
    this.aba.set(aba);
    if (aba === 'grupos') {
      if (this.currentUserUid) this.loadGruposDoAssessor(this.currentUserUid);
    }
  }

  // ====== GRUPOS: carregamento e paginação ======
  // ====== GRUPOS: carregamento e paginação ======
  private async loadGruposDoAssessor(uid: string) {
    this.gruposLoading.set(true);
    try {
      // 1) Grupos que estão na MINHA caixa (assessor/analista),
      //    via service padrão
      const base = await this.gruposSvc.listarParaCaixaAssessor(uid);

      // 2) Grupos que EU encaminhei (analista) para algum assessor,
      //    mas que quero continuar vendo na MINHA lista
      const encaminhadosPorMim = await this.buscarGruposEncaminhadosPor(uid);

      // 3) Mesclar os dois conjuntos sem duplicar (por id)
      const map = new Map<string, GrupoSolidario>();

      for (const g of base || []) {
        const id = (g as any).id;
        if (!id) continue;
        map.set(id, g);
      }

      for (const g of encaminhadosPorMim || []) {
        const id = (g as any).id;
        if (!id) continue;

        const atual = map.get(id);
        // se já existir, mescla; se não existir, adiciona direto
        map.set(id, { ...(atual as any), ...(g as any) } as GrupoSolidario);
      }

      const merged = Array.from(map.values());

      // 4) Rodar o join para montar coordenadorView, membrosView, metrics etc.
      const join = await this.gruposSvc.joinGruposView(merged);

      this.grupos.set(join || []);
      this.pageGrupos.set(1);
    } catch (e) {
      console.error('[Grupos] erro ao listar:', e);
      this.grupos.set([]);
    } finally {
      this.gruposLoading.set(false);
    }
  }

  /**
 * Mescla na lista de Pessoas todos os pré-cadastros que pertencem
 * aos grupos da caixa do assessor, usando os IDs em `membrosIds`.
 *
 * - Se o pré-cadastro já existir em `this.itens`, só injeta grupoId/grupoNome/papelNoGrupo.
 * - Se não existir, busca em `pre_cadastros` pelo ID e adiciona na lista.
 */
  private async mesclarPreCadastrosDeGrupos() {
    try {
      const atuais = new Map<string, PreCadastro>();
      for (const p of this.itens()) {
        if (p?.id) atuais.set(p.id, p);
      }

      const grupos = this.grupos() || [];
      const faltando = new Map<string, { grupoId: string; grupoNome: string | null }>();

      // 1) Passa por todos os grupos e marca o que já existe,
      //    e coleta os IDs que ainda precisamos buscar no Firestore.
      for (const g of grupos) {
        const grupoId = (g as any).id;
        const grupoNome = (g as any).nome || null;
        const membrosIds: string[] = ((g as any).membrosIds || []) as string[];

        if (!grupoId || !membrosIds?.length) continue;

        for (const preId of membrosIds) {
          if (!preId) continue;

          if (atuais.has(preId)) {
            // Já existe na lista => só injeta dados do grupo
            const cur = atuais.get(preId)!;
            atuais.set(preId, {
              ...cur,
              grupoId,
              grupoNome,
              papelNoGrupo: (cur as any).papelNoGrupo ?? 'membro'
            } as PreCadastro);
          } else {
            // Ainda não temos esse pré-cadastro => agenda pra buscar no banco
            if (!faltando.has(preId)) {
              faltando.set(preId, { grupoId, grupoNome });
            }
          }
        }
      }

      // 2) Busca, um por um, os pré-cadastros que ainda não estavam em `this.itens`
      for (const [preId, info] of faltando.entries()) {
        try {
          const snap = await getDoc(doc(this.afs, 'pre_cadastros', preId));
          if (!snap.exists()) {
            console.warn('[Grupos->Pessoas] pre_cadastro não encontrado para membroId =', preId);
            continue;
          }

          const data = snap.data() as any;

          const pre: PreCadastro = {
            id: preId,
            nomeCompleto: (data.nomeCompleto ?? data.nome ?? null) as any,
            cpf: (data.cpf ?? null) as any,
            telefone: (data.telefone ?? null) as any,
            email: (data.email ?? null) as any,
            endereco: (data.endereco ?? null) as any,
            bairro: (data.bairro ?? null) as any,
            cidade: (data.cidade ?? null) as any,
            uf: (data.uf ?? null) as any,

            agendamentoStatus: (data.agendamentoStatus || 'nao_agendado') as any,
            formalizacao: data.formalizacao,
            desistencia: data.desistencia,

            grupoId: info.grupoId,
            grupoNome: info.grupoNome,
            papelNoGrupo: 'membro',

            // mantém o resto dos campos do documento original
            ...data
          } as PreCadastro;

          atuais.set(preId, pre);
        } catch (e) {
          console.error('[Grupos->Pessoas] erro ao buscar pre_cadastro', preId, e);
        }
      }

      this.itens.set(Array.from(atuais.values()));
      console.log('[Grupos->Pessoas] total na aba Pessoas após merge =', this.itens().length);
    } catch (e) {
      console.error('[Grupos->Pessoas] erro geral ao mesclar membrosIds:', e);
    }
  }


  gruposTotal = computed(() => this.grupos().length);

  gruposPaged = computed<GrupoSolidario[]>(() => {
    const p = this.pageGrupos();
    const ps = this.pageSizeGrupos();
    const arr = this.grupos();
    const start = (p - 1) * ps;
    return arr.slice(start, start + ps);
  });

  gruposTotalPages = computed<number>(() => {
    const n = Math.ceil(this.gruposTotal() / this.pageSizeGrupos());
    return Math.max(1, n || 1);
  });

  // ===== MODAL DE GRUPO (detalhes + membros) =====
  abrirGrupo(g: GrupoSolidario) {
    this.grupoSelecionado.set(g);
    this.modalGrupoAberto.set(true);
  }

  fecharModalGrupo() {
    this.modalGrupoAberto.set(false);
    this.grupoSelecionado.set(null);
  }

  gruposGoFirst() { this.pageGrupos.set(1); }
  gruposGoPrev() { this.pageGrupos.update(p => Math.max(1, p - 1)); }
  gruposGoNext() { this.pageGrupos.update(p => Math.min(this.gruposTotalPages(), p + 1)); }
  gruposGoLast() { this.pageGrupos.set(this.gruposTotalPages()); }
  gruposSetPageSize(n: number) { this.pageSizeGrupos.set(n); this.pageGrupos.set(1); }

  // ===== Abertura/fechamento modais (PESSOAS) =====
  abrirVer(i: PreCadastro) {
    this.viewItem.set(i);
    this.modalVerAberto.set(true);
  }

  abrirObservacoes(i: PreCadastro) {
    const texto = (i.observacoes ?? '') as any;
    this.viewItem.set(i);
    this.obsModel.set(String(texto));
    this.modalObsAberto.set(true);
  }

  abrirArquivos(i: PreCadastro) {
    this.viewItem.set(i);
    this.modalArqsAberto.set(true);
    this.carregarArquivos(i);
  }

  fecharModais() {
    this.modalVerAberto.set(false);
    this.modalEditarAberto.set(false);
    this.modalAgendarAberto.set(false);
    this.modalObsAberto.set(false);
    this.modalArqsAberto.set(false);

    this.viewItem.set(null);
    this.editModel.set(null);
    this.itemAgendar.set(null);
    this.agData = '';
    this.agHora = '';
    this.obsModel.set('');
    this.arqsLista.set([]);
  }

  // ===== Atualização do editModel =====
  onEditChange<K extends keyof PreCadastroEdit>(prop: K, value: PreCadastroEdit[K]) {
    const m = this.editModel();
    if (!m) return;

    const numericProps = new Set(['valorSolicitado', 'parcelas', 'valorParcela']);

    let v: any = value;
    if (numericProps.has(prop as string) && typeof value === 'string') {
      v = value === '' ? undefined : Number(value);
    }

    this.editModel.set({ ...(m as any), [prop]: v });
  }

  // ===== Atualização do fluxoCaixa =====
  private defaultFluxo(): FluxoCaixa {
    return {
      faturamentoMensal: 0,
      fixos: {
        aluguel: 0,
        salarios: 0,
        energiaEletrica: 0,
        agua: 0,
        telefoneInternet: 0
      },
      variaveis: {
        materiaPrima: 0,
        insumos: 0,
        frete: 0,
        transporte: 0,
        outros: []
      }
    };
  }

  onFluxoNumberChange(path: string, value: string | number) {
    const m = this.editModel();
    if (!m) return;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();

    const num = typeof value === 'string' ? (value === '' ? 0 : Number(value)) : value;

    const setNested = (obj: any, p: string[], val: any) => {
      if (p.length === 1) { obj[p[0]] = val; return; }
      const [head, ...rest] = p;
      if (!(head in obj) || typeof obj[head] !== 'object' || obj[head] === null) obj[head] = {};
      setNested(obj[head], rest, val);
    };

    setNested(fluxo as any, path.split('.'), num);

    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  // ===== Outros (lista dinâmica) =====
  addOutro() {
    const m = this.editModel();
    if (!m) return;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();
    const arr = fluxo.variaveis?.outros ?? [];
    fluxo.variaveis = { ...(fluxo.variaveis || { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] }) };
    fluxo.variaveis.outros = [...arr, { nome: '', valor: 0 }];
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  removeOutro(index: number) {
    const m = this.editModel();
    if (!m || !m.fluxoCaixa?.variaveis?.outros) return;
    const fluxo = { ...m.fluxoCaixa };
    fluxo.variaveis = { ...fluxo.variaveis, outros: fluxo.variaveis.outros.filter((_, i) => i !== index) };
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  abrirEditar(i: PreCadastro) {
    this.viewItem.set(i);
    this.editModel.set({ ...i });
    this.modalEditarAberto.set(true);
  }

  onOutroNomeChange(index: number, value: string) {
    const m = this.editModel();
    if (!m) return;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();
    const outros = [...(fluxo.variaveis?.outros ?? [])];
    if (!outros[index]) outros[index] = { nome: '', valor: 0 };
    outros[index] = { ...outros[index], nome: value };
    fluxo.variaveis = { ...(fluxo.variaveis || { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] }), outros };
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  onOutroValorChange(index: number, value: string | number) {
    const m = this.editModel();
    if (!m) return;
    const num = typeof value === 'string' ? (value === '' ? 0 : Number(value)) : value;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();
    const outros = [...(fluxo.variaveis?.outros ?? [])];
    if (!outros[index]) outros[index] = { nome: '', valor: 0 };
    outros[index] = { ...outros[index], valor: Number(num) };
    fluxo.variaveis = { ...(fluxo.variaveis || { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] }), outros };
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  // ===== CRUD (PESSOAS) =====
  async salvarEdicao() {
    const m = this.editModel();
    if (!m?.id) return;

    this.saving.set(true);
    try {
      const patch: Partial<PreCadastro> = {
        nomeCompleto: (m.nomeCompleto ?? '').trim(),
        cpf: (m.cpf ?? '').trim(),
        telefone: (m.telefone ?? '').trim(),
        email: (m.email ?? '').trim(),
        bairro: (m.bairro ?? '').trim(),
        endereco: (m.endereco ?? '').trim(),
        origem: m.origem ?? '',
        cidade: (m.cidade ?? null),
        uf: (m.uf ?? null),
        valorSolicitado: typeof m.valorSolicitado === 'number' ? m.valorSolicitado : m.valorSolicitado ? Number(m.valorSolicitado) : undefined,
        parcelas: m.parcelas ?? null,
        valorParcela: typeof m.valorParcela === 'number' ? m.valorParcela : m.valorParcela ? Number(m.valorParcela) : undefined,
        fluxoCaixa: m.fluxoCaixa ? { ...m.fluxoCaixa } : undefined,
        fluxoCaixaTotais: m.fluxoCaixaTotais ?? undefined,
      };

      await this.service.atualizar(m.id, patch);
      this.itens.update(list => list.map(x => (x.id === m.id ? { ...x, ...patch } as PreCadastro : x)));
      this.fecharModais();
      alert('Pré-cadastro editado com sucesso!');
    } catch (err) {
      console.error('[PreCadastro] Erro ao salvar edição:', err);
      alert('Falha ao salvar. Tente novamente.');
    } finally {
      this.saving.set(false);
    }
  }

  async remover(item: PreCadastro) {
    if (!item?.id) { console.warn('Sem ID:', item); return; }
    const ok = confirm(`Remover o pré-cadastro de "${item.nomeCompleto ?? 'sem nome'}"?`);
    if (!ok) return;

    try {
      const agId = (item as any)?.agendamentoId;
      if (agId) { try { await this.agService.remover(agId); } catch { } }

      await this.service.remover(item.id);
      this.itens.update(lista => lista.filter(x => x.id !== item.id));
    } catch (err) {
      console.error('[PreCadastro] Erro ao remover:', err);
      alert('Falha ao remover. Tente novamente.');
    }
  }

  private buildQueryFromPre(pc: PreCadastro): Record<string, any> {
    const contato = this.onlyDigits((pc as any)?.telefone ?? (pc as any)?.contato ?? '');
    const cpf = this.onlyDigits((pc as any)?.cpf ?? '');
    return {
      nome: (pc as any)?.nomeCompleto ?? (pc as any)?.nome ?? '',
      cpf,
      contato,
      email: (pc as any)?.email ?? '',
      endereco: (pc as any)?.endereco ?? (pc as any)?.enderecoCompleto ?? '',
      preCadastroId: (pc as any)?.id ?? (pc as any)?.uid ?? '',
    };
  }

  iniciarCadastro(pc: PreCadastro) {
    this.fecharModais();
    const qp = this.buildQueryFromPre(pc);
    this.router.navigate(['/cadastro', 'novo'], { queryParams: qp });
  }

  // ====== AGENDAMENTO (PESSOAS E GRUPOS) ======
  abrirAgendar(i: PreCadastro) {
    // Se o modal de grupo estiver aberto, fecha ele primeiro
    if (this.modalGrupoAberto()) {
      this.modalGrupoAberto.set(false);
      this.grupoSelecionado.set(null);
    }

    // Depois abre o modal de agendamento normalmente
    this.itemAgendar.set(i);
    this.agData = '';
    this.agHora = '';
    this.modalAgendarAberto.set(true);
  }

  private combineToTimestamp(dateStr: string, timeStr: string): Timestamp {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const js = new Date(y, (m - 1), d, hh, mm, 0);
    return Timestamp.fromDate(js);
  }

  async salvarAgendamento() {
    const pre = this.itemAgendar();
    const data = (this.agData || '').trim();
    const hora = (this.agHora || '').trim();

    if (!pre?.id) { alert('Pré-cadastro inválido.'); return; }
    if (!this.currentUserUid) { alert('Usuário não autenticado.'); return; }
    if (!data || !hora) { alert('Informe data e horário.'); return; }

    this.agSalvando.set(true);
    try {
      const dataHora = this.combineToTimestamp(data, hora);
      const agId = await this.agService.criar({
        preCadastroId: pre.id,
        clienteNome: pre.nomeCompleto ?? null,
        clienteCpf: pre.cpf ?? null,
        clienteTelefone: pre.telefone ?? null,
        clienteEmail: pre.email ?? null,
        clienteEndereco: pre.endereco ?? null,
        clienteBairro: pre.bairro ?? null,
        dataHora,
        assessorUid: this.currentUserUid!,
        assessorNome: this.currentUserNome ?? null,
        createdByUid: this.currentUserUid!,
        status: 'agendado'
      });

      await this.service.atualizar(pre.id, {
        agendamentoStatus: 'agendado',
        agendamentoId: agId,
        agendamentoDataHora: dataHora
      } as any);

      this.itens.update(list => list.map(x =>
        x.id === pre.id
          ? { ...x, agendamentoStatus: 'agendado', agendamentoId: agId, agendamentoDataHora: dataHora } as any
          : x
      ));

      this.modalAgendarAberto.set(false);
      this.itemAgendar.set(null);
      alert('Agendamento criado com sucesso!');
    } catch (e) {
      console.error('[Agendamento] erro ao salvar:', e);
      alert('Não foi possível criar o agendamento.');
    } finally {
      this.agSalvando.set(false);
    }
  }

  async marcarVisitado(i: PreCadastro) {
    if (!i?.id) return;
    try {
      await this.service.atualizar(i.id, { agendamentoStatus: 'visitado' } as any);
      this.itens.update(list => list.map(x => (x.id === i.id ? { ...x, agendamentoStatus: 'visitado' } : x)));

      const agId = (i as any)?.agendamentoId;
      if (agId) {
        try { await this.agService.atualizar(agId, { status: 'visitado' } as any); }
        catch (e: any) {
          if (e?.code === 'not-found' || /No document to update/i.test(e?.message || '')) {
            console.warn('[Pré] agendamento não existe mais, ignorando sync.');
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      console.error('[Agendamento] erro ao marcar visitado:', e);
      alert('Falha ao marcar como visitado.');
    }
  }

  async cancelarAgendamento(i: PreCadastro) {
    const agId = (i as any)?.agendamentoId;
    if (!i?.id || !agId) { alert('Não há agendamento para cancelar.'); return; }
    const ok = confirm(`Cancelar o agendamento de "${i.nomeCompleto || 'cliente'}"?`);
    if (!ok) return;

    try {
      try { await this.agService.remover(agId); }
      catch (e: any) {
        if (e?.code === 'not-found' || /No document to delete|NOT_FOUND/i.test(e?.message || '')) {
          console.warn('[Pré] agendamento já removido, seguindo.');
        } else {
          throw e;
        }
      }

      await this.service.atualizar(i.id, {
        agendamentoStatus: 'nao_agendado',
        agendamentoId: null as any,
        agendamentoDataHora: null as any
      } as any);

      this.itens.update(list => list.map(x =>
        x.id === i.id
          ? { ...x, agendamentoStatus: 'nao_agendado', agendamentoId: null, agendamentoDataHora: null } as any
          : x
      ));
      alert('Agendamento cancelado.');
    } catch (e) {
      console.error('[Agendamento] erro ao cancelar:', e);
      alert('Não foi possível cancelar o agendamento.');
    }
  }

  // ===== FORMALIZAÇÃO (PESSOAS) =====
  async marcarFormalizado(i: PreCadastro) {
    if (!i?.id) return;
    if (!this.currentUserUid) { alert('Usuário não autenticado.'); return; }

    try {
      const patch: Partial<PreCadastro> = {
        formalizacao: {
          status: 'formalizado',
          porUid: this.currentUserUid!,
          porNome: this.currentUserNome || undefined,
          em: Timestamp.now()
        }
      };
      await this.service.atualizar(i.id, patch as any);
      this.itens.update(list => list.map(x =>
        x.id === i.id ? { ...x, formalizacao: patch.formalizacao } as PreCadastro : x
      ));
      this.toastVisivel.set(true);
      setTimeout(() => this.toastVisivel.set(false), 2000);
    } catch (e) {
      console.error('[Formalização] erro ao marcar:', e);
      alert('Não foi possível marcar como formalizado.');
    }
  }

  async desfazerFormalizacao(i: PreCadastro) {
    if (!i?.id) return;
    if (!this.currentUserUid) { alert('Usuário não autenticado.'); return; }

    try {
      const patch: Partial<PreCadastro> = {
        formalizacao: {
          status: 'nao_formalizado',
          porUid: this.currentUserUid!,
          porNome: this.currentUserNome || undefined,
          em: Timestamp.now()
        }
      };
      await this.service.atualizar(i.id, patch as any);
      this.itens.update(list => list.map(x =>
        x.id === i.id ? { ...x, formalizacao: patch.formalizacao } as PreCadastro : x
      ));
      this.toastVisivel.set(true);
      setTimeout(() => this.toastVisivel.set(false), 2000);
    } catch (e) {
      console.error('[Formalização] erro ao desfazer:', e);
      alert('Não foi possível desfazer a formalização.');
    }
  }

  // ===== DESISTÊNCIA (PESSOAS) =====
  async marcarDesistencia(i: PreCadastro) {
    if (!i?.id) return;
    if (!this.currentUserUid) { alert('Usuário não autenticado.'); return; }

    const obs = (window.prompt('Observação da desistência (opcional):') || '').trim() || null;

    try {
      const patch: Partial<PreCadastro> = {
        desistencia: {
          status: 'desistiu',
          porUid: this.currentUserUid!,
          porNome: this.currentUserNome || undefined,
          em: Timestamp.now(),
          observacao: obs
        }
      };
      await this.service.atualizar(i.id, patch as any);
      this.itens.update(list => list.map(x =>
        x.id === i.id ? { ...x, desistencia: patch.desistencia } as PreCadastro : x
      ));
      this.toastVisivel.set(true);
      setTimeout(() => this.toastVisivel.set(false), 2000);
    } catch (e) {
      console.error('[Desistência] erro ao marcar:', e);
      alert('Não foi possível marcar desistência.');
    }
  }

  async desfazerDesistencia(i: PreCadastro) {
    if (!i?.id) return;
    if (!this.currentUserUid) { alert('Usuário não autenticado.'); return; }

    try {
      const patch: Partial<PreCadastro> = {
        desistencia: {
          status: 'nao_desistiu',
          porUid: this.currentUserUid!,
          porNome: this.currentUserNome || undefined,
          em: Timestamp.now(),
          observacao: null
        }
      };
      await this.service.atualizar(i.id, patch as any);
      this.itens.update(list => list.map(x =>
        x.id === i.id ? { ...x, desistencia: patch.desistencia } as PreCadastro : x
      ));
      this.toastVisivel.set(true);
      setTimeout(() => this.toastVisivel.set(false), 2000);
    } catch (e) {
      console.error('[Desistência] erro ao desfazer:', e);
      alert('Não foi possível desfazer a desistência.');
    }
  }

  // ===== OBSERVAÇÕES (PESSOAS) =====
  async salvarObservacoes() {
    const i = this.viewItem();
    if (!i?.id) return;
    try {
      const texto = (this.obsModel() || '').trim() || null;
      await this.service.atualizarObservacoes(i.id, texto);
      this.itens.update(list => list.map(x => x.id === i.id ? { ...x, observacoes: texto } : x));
      this.viewItem.set({ ...(i as any), observacoes: texto });
      this.modalObsAberto.set(false);
      alert('Observações salvas!');
    } catch (e) {
      console.error('[Observações] erro ao salvar:', e);
      alert('Não foi possível salvar as observações.');
    }
  }

  // ===== ARQUIVOS (PESSOAS) =====
  private async carregarArquivos(i: PreCadastro) {
    if (!i?.id) return;
    this.arqsCarregando.set(true);
    try {
      const lista = await this.service.listarArquivos(i.id);
      this.arqsLista.set(lista || []);
    } catch (e) {
      console.error('[Arquivos] erro ao listar:', e);
      this.arqsLista.set([]);
    } finally {
      this.arqsCarregando.set(false);
    }
  }

  async onEscolherArquivo(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const file = input?.files?.[0];
    const i = this.viewItem();
    if (!file || !i?.id) return;

    if (!this.currentUserUid) { alert('Usuário não autenticado.'); return; }

    this.uploadEmProgresso.set(true);
    try {
      const meta = await this.service.uploadArquivo(i.id, file, {
        uid: this.currentUserUid!,
        nome: this.currentUserNome || null
      });
      this.arqsLista.set([meta, ...this.arqsLista()]);
      this.itens.update(list => list.map(x => x.id === i.id ? { ...x, arquivos: [meta, ...(x.arquivos || [])] } : x));
      input.value = '';
    } catch (e) {
      console.error('[Arquivos] upload falhou:', e);
      alert('Falha no upload do arquivo.');
    } finally {
      this.uploadEmProgresso.set(false);
    }
  }

  async removerArquivo(arquivo: ArquivoPreCadastro) {
    const i = this.viewItem();
    if (!i?.id || !arquivo?.id) return;
    const ok = confirm(`Remover o arquivo "${arquivo.nome}"?`);
    if (!ok) return;

    try {
      await this.service.removerArquivo(i.id, arquivo.id);
      this.arqsLista.set(this.arqsLista().filter(a => a.id !== arquivo.id));
      this.itens.update(list => list.map(x =>
        x.id === i.id ? { ...x, arquivos: (x.arquivos || []).filter(a => a.id !== arquivo.id) } : x
      ));
    } catch (e) {
      console.error('[Arquivos] erro ao remover:', e);
      alert('Não foi possível remover o arquivo.');
    }
  }

  closeActions(toggle?: HTMLInputElement) {
    if (toggle) toggle.checked = false;
  }

  // =====================================================================================
  // ==================================  GRUPOS  ========================================
  // =====================================================================================

  private preLikeFromMember(m: MembroGrupoView, g?: GrupoSolidario): PreCadastro {
    return {
      id: m.preCadastroId,
      nomeCompleto: m.nome ?? null as any,
      cpf: m.cpf ?? null as any,
      telefone: m.telefone ?? null as any,
      email: m.email ?? null as any,
      endereco: null as any,
      bairro: null as any,
      cidade: null as any,
      uf: null as any,
      agendamentoStatus: m.agendamentoStatus || 'nao_agendado',
      formalizacao: m.formalizacao,
      desistencia: m.desistencia,
      grupoId: g?.id ?? null,
      grupoNome: g?.nome ?? null,
      papelNoGrupo: 'membro'
    } as unknown as PreCadastro;
  }

  private preLikeFromCoordenador(g: GrupoSolidario): PreCadastro | null {
    const c = g.coordenadorView;
    if (!c?.preCadastroId) return null;
    return {
      id: c.preCadastroId,
      nomeCompleto: c.nome ?? null as any,
      cpf: c.cpf ?? null as any,
      telefone: c.telefone ?? null as any,
      email: c.email ?? null as any,
      endereco: c.endereco ?? null as any,
      bairro: c.bairro ?? null as any,
      cidade: c.cidade ?? null as any,
      uf: c.uf ?? null as any,
      agendamentoStatus: c.agendamentoStatus || 'nao_agendado',
      formalizacao: c.formalizacao,
      desistencia: c.desistencia,
      grupoId: g.id,
      grupoNome: g.nome || null,
      papelNoGrupo: 'coordenador'
    } as unknown as PreCadastro;
  }

  // ===== Ações no Coordenador do Grupo =====
  abrirAgendarCoordenador(g: GrupoSolidario) {
    const pre = this.preLikeFromCoordenador(g);
    if (!pre) { alert('Coordenador não definido para este grupo.'); return; }
    this.abrirAgendar(pre);
  }

  marcarVisitadoCoordenador(g: GrupoSolidario) {
    const pre = this.preLikeFromCoordenador(g);
    if (!pre) return;
    this.marcarVisitado(pre);
  }

  cancelarAgendamentoCoordenador(g: GrupoSolidario) {
    const pre = this.preLikeFromCoordenador(g);
    if (!pre) return;
    this.cancelarAgendamento(pre);
  }

  marcarFormalizadoCoordenador(g: GrupoSolidario) {
    const pre = this.preLikeFromCoordenador(g);
    if (!pre) return;
    this.marcarFormalizado(pre);
  }

  desfazerFormalizacaoCoordenador(g: GrupoSolidario) {
    const pre = this.preLikeFromCoordenador(g);
    if (!pre) return;
    this.desfazerFormalizacao(pre);
  }

  marcarDesistenciaCoordenador(g: GrupoSolidario) {
    const pre = this.preLikeFromCoordenador(g);
    if (!pre) return;
    this.marcarDesistencia(pre);
  }

  desfazerDesistenciaCoordenador(g: GrupoSolidario) {
    const pre = this.preLikeFromCoordenador(g);
    if (!pre) return;
    this.desfazerDesistencia(pre);
  }

  whatsHrefCoordenador(g: GrupoSolidario): string | null {
    const tel = g?.coordenadorView?.telefone;
    return this.whatsHref(tel);
  }

  // ===== Ações por MEMBRO =====
  abrirAgendarMembro(m: MembroGrupoView) {
    const pre = this.preLikeFromMember(m);
    this.abrirAgendar(pre);
  }

  marcarVisitadoMembro(m: MembroGrupoView) {
    const pre = this.preLikeFromMember(m);
    this.marcarVisitado(pre);
  }

  cancelarAgendamentoMembro(m: MembroGrupoView) {
    const pre = this.preLikeFromMember(m);
    this.cancelarAgendamento(pre);
  }

  marcarFormalizadoMembro(m: MembroGrupoView) {
    const pre = this.preLikeFromMember(m);
    this.marcarFormalizado(pre);
  }

  desfazerFormalizacaoMembro(m: MembroGrupoView) {
    const pre = this.preLikeFromMember(m);
    this.desfazerFormalizacao(pre);
  }

  marcarDesistenciaMembro(m: MembroGrupoView) {
    const pre = this.preLikeFromMember(m);
    this.marcarDesistencia(pre);
  }

  desfazerDesistenciaMembro(m: MembroGrupoView) {
    const pre = this.preLikeFromMember(m);
    this.desfazerDesistencia(pre);
  }

  whatsHrefMembro(m: MembroGrupoView): string | null {
    return this.whatsHref(m.telefone || null);
  }
}
