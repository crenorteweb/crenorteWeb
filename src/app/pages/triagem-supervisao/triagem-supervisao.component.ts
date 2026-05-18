import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { HeaderComponent } from '../shared/header/header.component';

import { PreCadastroService, filtrarUfsNorte } from '../../services/pre-cadastro.service';
import { GrupoSolidarioService } from '../../services/grupo-solidario.service';

import { PreCadastro } from '../../models/pre-cadastro.model';
import { GrupoSolidario, MembroGrupoView } from '../../models/grupo-solidario.model';

import { Auth, user } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query as fsQuery,
  where,
  limit,
  setDoc,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

type Aba = 'pessoas' | 'grupos' | 'minha-caixa';

type FiltroEnvio = 'todos' | 'encaminhado' | 'nao_encaminhado' | 'apto' | 'inapto';

type ColaboradorItem = { uid: string; nome: string; papel: string };

type Assessor = {
  uid: string;
  nome: string;
  email?: string | null;
  rota?: string | null;
  analistaId?: string | null;
};

type Analista = { uid: string; nome: string };

@Component({
  selector: 'app-triagem-supervisao',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './triagem-supervisao.component.html',
  styleUrls: ['./triagem-supervisao.component.css'],
})
export class TriagemSupervisaoComponent implements OnInit, OnDestroy {
  // ====== injeções ======
  private preSvc = inject(PreCadastroService);
  private gruposSvc = inject(GrupoSolidarioService);
  private auth = inject(Auth);
  private afs = inject(Firestore);

  // ====== estado usuário atual ======
  currentUserUid: string | null = null;
  currentUserNome: string | null = null;
  currentUserPodeEncaminharParaAnalista = false;
  private subUser?: Subscription;

  // cache de nomes para não ficar lendo o mesmo colaborador sempre
  private nomeCache = new Map<string, string>();

  // UIDs dos Analistas vinculados ao Supervisor (extraídos do analistaId dos assessores)
  private analistasUids: string[] = [];

  // ====== abas / UI básica ======
  loading = false;
  aba: Aba = 'pessoas';

  searchTerm = '';
  filtrosEnvio = new Set<string>();

  // ====== filtro por quem cadastrou (autocomplete + select) ======
  colaboradoresList: ColaboradorItem[] = [];
  filtroCriadorInput = '';
  filtroCriadorUid: string | null = null;
  filtroCriadorSelectUid = '';
  sugestoesCriador: ColaboradorItem[] = [];
  mostrarSugestoes = false;

  // ====== filtros de localidade e elegibilidade ======
  filtroUf = '';
  filtroCidade = '';
  filtroBairro = '';
  filtroAprovadorUid = '';

  // ====== paginação ======
  paginaPessoas = 1;
  tamanhoPaginaPessoas = 25;
  paginaGrupos = 1;
  tamanhoPaginaGrupos = 10;
  paginaMinhaCaixa = 1;
  tamanhoPaginaMinhaCaixa = 25;

  // ====== filtro por analista do time ======
  analistas: Analista[] = [];
  filtroAnalista: string | 'todos' = 'todos';


  // ====== pessoas ======
  pessoas: PreCadastro[] = [];      // base completa (caixa + encaminhados + membros de grupos)
  pessoasView: PreCadastro[] = [];  // filtradas pela busca/filtros

  // ====== grupos ======
  grupos: GrupoSolidario[] = [];       // grupos da lista
  gruposView: GrupoSolidario[] = [];   // filtrados pela busca

  // ====== minha caixa (registros com caixaUid === currentUserUid) ======
  minhaCaixaPessoasView: PreCadastro[] = [];
  minhaCaixaGruposView: GrupoSolidario[] = [];
  searchTermMinhaCaixa = '';

  // ====== assessores (time do analista) ======
  assessores: Assessor[] = [];
  assessoresFiltrados: Assessor[] = [];

  // ====== datasets base (estado "todos") para evitar re-fetch =====
  private pessoasTodos: PreCadastro[] = [];
  private gruposTodos: GrupoSolidario[] = [];

  // indica busca em andamento ao trocar filtro de assessor
  loadingFiltro = false;

  // ====== modal encaminhar PESSOA ======
  showAssessorPessoaModal = false;
  pessoaSelecionada: PreCadastro | null = null;
  selectedAssessorUidPessoa: string | null = null;
  buscaAssessorPessoa = '';

  // ====== modal encaminhar GRUPO ======
  showAssessorGrupoModal = false;
  grupoSelecionado: GrupoSolidario | null = null;
  selectedAssessorUidGrupo: string | null = null;
  buscaAssessorGrupo = '';

  // ====== seletor de tipo de destino (compartilhado entre modais) ======
  tipoDestinoModal: 'assessor' | 'analista' = 'assessor';
  analistasFiltradosModal: Analista[] = [];
  buscaAnalistaModal = '';

  // ====== modal DETALHE GRUPO ======
  showGrupoDetalhe = false;
  grupoDetalhe: GrupoSolidario | null = null;

  // ====== modal RELATÓRIO PDF ======
  showRelatorioModal = false;
  relatorioAssessorUid = '';
  relatorioDataInicio = '';
  relatorioDataFim = '';
  relatorioLoading = false;
  buscaAssessorRelatorio = '';
  assessoresFiltradosRelatorio: Assessor[] = [];

  // ====================================================
  // CICLO DE VIDA
  // ====================================================
  ngOnInit(): void {
    this.subUser = user(this.auth).subscribe(async (u) => {
      this.loading = true;
      try {
        if (!u) {
          this.currentUserUid = null;
          this.currentUserNome = null;
          this.resetarListas();
          return;
        }

        this.currentUserUid = u.uid;
        this.currentUserNome = await this.resolveUserName(u.uid);

        // Verifica se o usuário logado tem permissão de encaminhar para analista
        try {
          const meSnap = await getDoc(doc(this.afs, 'colaboradores', u.uid));
          this.currentUserPodeEncaminharParaAnalista =
            (meSnap.data() as any)?.podeEncaminharParaAnalista === true;
        } catch {
          this.currentUserPodeEncaminharParaAnalista = false;
        }

        // Descobre o time primeiro para passar os UIDs completos ao carregamento de assessores
        const equipeUids = await this.obterIdsDoMeuTime();
        await Promise.all([
          this.carregarAssessoresDoMeuTime(equipeUids),
          this.carregarColaboradores(),
        ]);

        // Inclui UIDs de todos os assessores para que pré-cadastros criados/na caixa
        // deles também apareçam e possam ser encaminhados pelo supervisor
        const assessorUids = this.assessores.map(a => a.uid);
        const todosUids = [...new Set([...equipeUids, ...assessorUids])];

        await Promise.all([
          this.carregarPessoasDoAnalista(todosUids),
          this.carregarGruposDoAnalista(todosUids),
        ]);
        await this.mesclarPreCadastrosDeGrupos(); // garante membros de grupos na aba Pessoas

        // Salva snapshot do estado "todos" para restaurar sem nova query
        this.pessoasTodos = [...this.pessoas];
        this.gruposTodos  = [...this.grupos];

        this.aplicarFiltrosPessoas();
        this.aplicarFiltrosGrupos();
        this.aplicarFiltrosMinhaCaixa();
      } catch (e) {
        console.error('[TriagemSupervisao] erro ao iniciar:', e);
        this.resetarListas();
      } finally {
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.subUser?.unsubscribe();
  }

  private resetarListas() {
    this.pessoas = [];
    this.pessoasView = [];
    this.grupos = [];
    this.gruposView = [];
    this.minhaCaixaPessoasView = [];
    this.minhaCaixaGruposView = [];
    this.assessores = [];
    this.assessoresFiltrados = [];
    this.analistas = [];
    this.filtroAnalista = 'todos';
    this.filtrosEnvio = new Set();
    this.filtroCriadorInput = '';
    this.filtroCriadorUid = null;
    this.filtroCriadorSelectUid = '';
    this.sugestoesCriador = [];
    this.mostrarSugestoes = false;
    this.filtroUf = '';
    this.filtroCidade = '';
    this.filtroBairro = '';
    this.filtroAprovadorUid = '';
    this.paginaPessoas = 1;
    this.paginaGrupos = 1;
  }

  // ====================================================
  // FILTRO POR QUEM CADASTROU — autocomplete
  // ====================================================

  onCriadorInputChange(): void {
    const term = this.normalize(this.filtroCriadorInput);
    if (!term) {
      this.sugestoesCriador = [];
      if (this.filtroCriadorUid !== null) {
        this.limparCriador();
      }
      return;
    }
    this.mostrarSugestoes = true;
    this.sugestoesCriador = this.colaboradoresList
      .filter(c => this.normalize(c.nome).includes(term))
      .slice(0, 8);
  }

  async selecionarCriador(c: ColaboradorItem): Promise<void> {
    this.filtroCriadorInput = c.nome;
    this.filtroCriadorUid = c.uid;
    this.filtroCriadorSelectUid = c.uid;
    this.sugestoesCriador = [];
    this.mostrarSugestoes = false;
    await this._buscarPorCriador(c.uid);
  }

  async selecionarCriadorPorSelect(uid: string): Promise<void> {
    if (!uid) {
      this.limparCriador();
      return;
    }
    const colab = this.colaboradoresList.find(c => c.uid === uid);
    this.filtroCriadorUid = uid;
    this.filtroCriadorInput = colab?.nome ?? '';
    this.filtroCriadorSelectUid = uid;
    this.sugestoesCriador = [];
    this.mostrarSugestoes = false;
    await this._buscarPorCriador(uid);
  }

  private async _buscarPorCriador(uid: string): Promise<void> {
    this.loadingFiltro = true;
    try {
      await Promise.all([
        this.carregarPessoasPorCriador(uid),
        this.carregarGruposPorCriador(uid),
      ]);
      this.aplicarFiltrosPessoas();
      this.aplicarFiltrosGrupos();
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao buscar cadastros do criador:', e);
    } finally {
      this.loadingFiltro = false;
    }
  }

  limparCriador(): void {
    this.filtroCriadorInput = '';
    this.filtroCriadorUid = null;
    this.filtroCriadorSelectUid = '';
    this.sugestoesCriador = [];
    this.mostrarSugestoes = false;
    this.pessoas = [...this.pessoasTodos];
    this.grupos  = [...this.gruposTodos];
    this.aplicarFiltrosPessoas();
    this.aplicarFiltrosGrupos();
    this.aplicarFiltrosMinhaCaixa();
  }

  onCriadorBlur(): void {
    setTimeout(() => { this.mostrarSugestoes = false; }, 150);
  }

  setAnalistaFilter(uid: string | 'todos') {
    this.filtroAnalista = uid;
    this.aplicarFiltrosPessoas();
    this.aplicarFiltrosGrupos();
  }


  // ====================================================
  // RESOLVE NOME DO USUÁRIO (igual módulo Lista)
  // ====================================================
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
        const q = fsQuery(
          collection(this.afs, 'colaboradores'),
          where('uid', '==', uid),
          limit(1)
        );
        const qs = await getDocs(q);
        qs.forEach((d) => {
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
        nome = local.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    if (!nome) nome = 'Usuário';

    this.nomeCache.set(uid, nome);
    return nome;
  }

  // ====================================================
  // DESCOBERTA DE TODOS OS ANALISTAS E ADMINS ATIVOS DO SISTEMA
  // ====================================================
  private async obterIdsDoMeuTime(): Promise<string[]> {
    if (!this.currentUserUid) return [];
    try {
      const ref = collection(this.afs, 'colaboradores');

      const [snapAnalistas, snapAdmins] = await Promise.all([
        getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'analista'))),
        getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'admin'))),
      ]);

      const todosUids = [
        ...snapAnalistas.docs.map(d => d.id),
        ...snapAdmins.docs.map(d => d.id),
      ];

      this.analistasUids = todosUids;

      // Resolve os nomes de analistas e admins para exibir no filtro visual
      this.analistas = await Promise.all(
        todosUids.map(async uid => ({
          uid,
          nome: await this.resolveUserName(uid),
        }))
      );

      return [this.currentUserUid, ...todosUids];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao obter IDs dos analistas/admins:', e);
      return [this.currentUserUid];
    }
  }

  // ====================================================
  // CARREGAR TODOS OS ASSESSORES ATIVOS DO SISTEMA
  // ====================================================
  private async carregarAssessoresDoMeuTime(_teamUids: string[]): Promise<void> {
    try {
      const ref = collection(this.afs, 'colaboradores');

      // Busca assessores e admins ativos em paralelo
      const [snapAssessores, snapAdmins] = await Promise.all([
        getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'assessor'))),
        getDocs(fsQuery(ref, where('status', '==', 'ativo'), where('papel', '==', 'admin'))),
      ]);

      const map = new Map<string, Assessor>();

      // Processa admins primeiro (aparecem no topo da lista)
      snapAdmins.docs.forEach((d) => {
        const data = d.data() as any;
        map.set(d.id, {
          uid: d.id,
          nome: `[Admin] ${data?.nome || data?.email || 'Admin'}`,
          email: data?.email || null,
          rota: data?.rota || null,
          analistaId: data?.analistaId || null,
        });
      });

      snapAssessores.docs.forEach((d) => {
        const data = d.data() as any;
        map.set(d.id, {
          uid: d.id,
          nome: data?.nome || data?.displayName || data?.email || 'Assessor',
          email: data?.email || null,
          rota: data?.rota || null,
          analistaId: data?.analistaId || null,
        });
      });

      this.assessores = Array.from(map.values()).sort((a, b) =>
        (a.nome || '').localeCompare(b.nome || '')
      );
      this.assessoresFiltrados = [...this.assessores];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar assessores:', e);
      this.assessores = [];
      this.assessoresFiltrados = [];
    }
  }

  // ====================================================
  // CARREGAR PESSOAS DO ANALISTA
  // (igual lógica do módulo Lista: caixa + encaminhadosPorMim)
  // ====================================================
  private normalize(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private toJSDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') {
      try {
        return v.toDate();
      } catch {
        return null;
      }
    }
    return null;
  }

  private async carregarPessoasDoAnalista(uid: string | string[]): Promise<void> {
    try {
      // listarParaCaixa busca por caixaUid (onde o Admin deposita o lead)
      // e encaminhamento.assessorUid — cobre todos os cenários de distribuição
      const base = await this.preSvc.listarParaCaixa(uid);

      // encaminhadosPorUid: cobre todos os UIDs do time (supervisor + analistas)
      const encaminhados = await this.buscarPreCadastrosEncaminhadosPor(uid);

      const mapRows = new Map<string, PreCadastro>();

      for (const r of base || []) {
        if (r?.id) mapRows.set(r.id, r);
      }
      for (const e of encaminhados || []) {
        if (!e?.id) continue;
        const atual = mapRows.get(e.id);
        mapRows.set(e.id, { ...(atual as any), ...(e as any) } as PreCadastro);
      }

      const merged = Array.from(mapRows.values());

      const norm = merged.map((r) => {
        const formalizacao = (r as any).formalizacao || {};
        const desistencia = (r as any).desistencia || {};

        const rawGrupo: any = (r as any).grupo || null;
        const grupoId =
          (r as any).grupoId ??
          (r as any).grupoSolidarioId ??
          rawGrupo?.id ??
          null;
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
          ...r,
          agendamentoStatus: (r as any).agendamentoStatus || 'nao_agendado',
          grupoId,
          grupoNome,
          papelNoGrupo,
          formalizacao: {
            status: (formalizacao.status as any) || 'nao_formalizado',
            porUid: formalizacao.porUid,
            porNome: formalizacao.porNome,
            em: formalizacao.em,
            observacao: formalizacao.observacao ?? null,
          },
          desistencia: {
            status: (desistencia.status as any) || 'nao_desistiu',
            porUid: desistencia.porUid,
            porNome: desistencia.porNome,
            em: desistencia.em,
            observacao: desistencia.observacao ?? null,
          },
        } as PreCadastro;
      });

      this.pessoas = filtrarUfsNorte(norm).filter(
        r => ((r as any).aprovacao?.status || 'nao_verificado') === 'apto'
      ) as typeof norm;
      this.pessoasView = [...this.pessoas];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar pessoas:', e);
      this.pessoas = [];
      this.pessoasView = [];
    }
  }

  // =========== busca extra: pré-cadastros encaminhados por qualquer membro do time ===========
  private async buscarPreCadastrosEncaminhadosPor(
    uid: string | string[]
  ): Promise<PreCadastro[]> {
    const uids = [...new Set(Array.isArray(uid) ? uid : [uid])].filter(Boolean);
    if (!uids.length) return [];
    try {
      const ref = collection(this.afs, 'pre_cadastros');
      const lista: PreCadastro[] = [];

      // Chunking para o operador 'in' do Firestore (máx 10 por query)
      for (let i = 0; i < uids.length; i += 10) {
        const chunk = uids.slice(i, i + 10);
        const q = chunk.length === 1
          ? fsQuery(ref, where('encaminhadoPorUid', '==', chunk[0]))
          : fsQuery(ref, where('encaminhadoPorUid', 'in', chunk));
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          lista.push({ id: docSnap.id, ...docSnap.data() } as PreCadastro);
        });
      }

      return lista;
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao buscar pre_cadastros encaminhados:', e);
      return [];
    }
  }

  // ====================================================
  // CARREGAR GRUPOS DO ANALISTA
  // (igual Lista: caixa + grupos encaminhados por mim + joinGruposView)
  // ====================================================
  // =========== busca extra: grupos encaminhados por qualquer membro do time ===========
  private async buscarGruposEncaminhadosPor(
    uid: string | string[]
  ): Promise<GrupoSolidario[]> {
    const uids = [...new Set(Array.isArray(uid) ? uid : [uid])].filter(Boolean);
    if (!uids.length) return [];
    try {
      const ref = collection(this.afs, 'grupos_solidarios');
      const lista: GrupoSolidario[] = [];

      // Chunking para o operador 'in' do Firestore (máx 10 por query)
      for (let i = 0; i < uids.length; i += 10) {
        const chunk = uids.slice(i, i + 10);
        const q = chunk.length === 1
          ? fsQuery(ref, where('encaminhadoPorUid', '==', chunk[0]))
          : fsQuery(ref, where('encaminhadoPorUid', 'in', chunk));
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          lista.push({ id: docSnap.id, ...docSnap.data() } as GrupoSolidario);
        });
      }

      return lista;
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao buscar grupos encaminhados:', e);
      return [];
    }
  }

  private async carregarGruposDoAnalista(uid: string | string[]): Promise<void> {
    try {
      const base = await this.gruposSvc.listarParaCaixaAssessor(uid);
      // encaminhadosPorUid: cobre todos os UIDs do time (supervisor + analistas)
      const encaminhadosPorMim = await this.buscarGruposEncaminhadosPor(uid);

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
        map.set(id, { ...(atual as any), ...(g as any) } as GrupoSolidario);
      }

      const merged = Array.from(map.values());

      // join para coordenadorView, membrosView etc. (igual Lista)
      const join = await this.gruposSvc.joinGruposView(merged);
      this.grupos = join || [];
      this.gruposView = [...this.grupos];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar grupos:', e);
      this.grupos = [];
      this.gruposView = [];
    }
  }


  // ====================================================
  // BUSCA POR CRIADOR (createdByUid)
  // ====================================================

  private async carregarPessoasPorCriador(uid: string): Promise<void> {
    try {
      const colRef = collection(this.afs, 'pre_cadastros');
      const q = fsQuery(
        colRef,
        where('createdByUid', '==', uid),
        limit(500)
      );
      const snap = await getDocs(q);
      const norm = snap.docs.map(d => {
        const r = { id: d.id, ...d.data() } as any;
        const formalizacao = r.formalizacao || {};
        const desistencia  = r.desistencia  || {};
        return {
          ...r,
          agendamentoStatus: r.agendamentoStatus || 'nao_agendado',
          formalizacao: { status: formalizacao.status || 'nao_formalizado', ...formalizacao },
          desistencia:  { status: desistencia.status  || 'nao_desistiu',    ...desistencia  },
        } as PreCadastro;
      });
      const aptos = norm.filter(
        r => ((r as any).aprovacao?.status || 'nao_verificado') === 'apto'
      );
      this.pessoas = aptos;
      this.pessoasView = [...aptos];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao buscar pessoas por criador:', e);
      this.pessoas = [];
      this.pessoasView = [];
    }
  }

  private async carregarGruposPorCriador(uid: string): Promise<void> {
    try {
      const colRef = collection(this.afs, 'grupos_solidarios');
      const q = fsQuery(colRef, where('createdByUid', '==', uid));
      const snap = await getDocs(q);
      const grupos = snap.docs.map(d => ({ id: d.id, ...d.data() } as GrupoSolidario));
      const join = await this.gruposSvc.joinGruposView(grupos);
      this.grupos = join || [];
      this.gruposView = [...this.grupos];
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao buscar grupos por criador:', e);
      this.grupos = [];
      this.gruposView = [];
    }
  }

  private async carregarColaboradores(): Promise<void> {
    try {
      const ref = collection(this.afs, 'colaboradores');
      const snap = await getDocs(fsQuery(ref, where('status', '==', 'ativo')));
      this.colaboradoresList = snap.docs
        .map(d => {
          const data = d.data() as any;
          return {
            uid: d.id,
            nome: data?.nome || data?.email || 'Usuário',
            papel: data?.papel || '',
          };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome));
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao carregar colaboradores:', e);
      this.colaboradoresList = [];
    }
  }

  // ====================================================
  // Mesclar pré-cadastros de GRUPOS na aba PESSOAS
  // (cópia da lógica do módulo Lista, adaptada aqui)
  // ====================================================
  private async mesclarPreCadastrosDeGrupos() {
    try {
      const atuais = new Map<string, PreCadastro>();
      for (const p of this.pessoas) {
        if (p?.id) atuais.set(p.id, p);
      }

      const grupos = this.grupos || [];
      const faltando = new Map<
        string,
        { grupoId: string; grupoNome: string | null }
      >();

      for (const g of grupos) {
        const gid = (g as any).id;
        const gnome = (g as any).nome || null;
        const membrosIds: string[] = ((g as any).membrosIds || []) as string[];

        if (!gid || !membrosIds?.length) continue;

        for (const preId of membrosIds) {
          if (!preId) continue;

          if (atuais.has(preId)) {
            const cur = atuais.get(preId)!;
            atuais.set(preId, {
              ...(cur as any),
              grupoId: gid,
              grupoNome: gnome,
              papelNoGrupo: (cur as any).papelNoGrupo ?? 'membro',
            } as PreCadastro);
          } else {
            if (!faltando.has(preId)) {
              faltando.set(preId, { grupoId: gid, grupoNome: gnome });
            }
          }
        }

        // coordenadorView também entra como pessoa
        const coord: any = (g as any).coordenadorView || null;
        if (coord?.preCadastroId) {
          const preId = coord.preCadastroId;
          if (atuais.has(preId)) {
            const cur = atuais.get(preId)!;
            atuais.set(preId, {
              ...(cur as any),
              grupoId: gid,
              grupoNome: gnome,
              papelNoGrupo: (cur as any).papelNoGrupo ?? 'coordenador',
            } as PreCadastro);
          } else {
            if (!faltando.has(preId)) {
              faltando.set(preId, { grupoId: gid, grupoNome: gnome });
            }
          }
        }
      }

      // busca no Firestore os pré-cadastros que não estavam em this.pessoas
      for (const [preId, info] of faltando.entries()) {
        try {
          const snap = await getDoc(doc(this.afs, 'pre_cadastros', preId));
          if (!snap.exists()) {
            console.warn(
              '[Grupos->Pessoas] pre_cadastro não encontrado para membroId =',
              preId
            );
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
            ...data,
          } as PreCadastro;

          atuais.set(preId, pre);
        } catch (e) {
          console.error(
            '[Grupos->Pessoas] erro ao buscar pre_cadastro',
            preId,
            e
          );
        }
      }

      this.pessoas = Array.from(atuais.values()).filter(
        p => ((p as any).aprovacao?.status || 'nao_verificado') === 'apto'
      );
      this.pessoasView = [...this.pessoas];
    } catch (e) {
      console.error(
        '[Grupos->Pessoas] erro geral ao mesclar membrosIds em TriagemSupervisao:',
        e
      );
    }
  }

  // ====================================================
  // VALORES DISPONÍVEIS (para selects de localidade)
  // ====================================================
  get aprovadoresDisponiveis(): { uid: string; nome: string }[] {
    const map = new Map<string, string>();
    for (const p of this.pessoasTodos) {
      const uid: string = (p as any).aprovacao?.porUid;
      const nome: string = (p as any).aprovacao?.porNome;
      if (uid && nome && !map.has(uid)) map.set(uid, nome);
    }
    return Array.from(map.entries())
      .map(([uid, nome]) => ({ uid, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  get ufsDisponiveis(): string[] {
    const set = new Set<string>();
    for (const p of this.pessoasTodos) {
      if (((p as any).aprovacao?.status || 'nao_verificado') === 'inapto') continue;
      const u = ((p as any).uf || '').trim();
      if (u) set.add(u);
    }
    return Array.from(set).sort();
  }

  get cidadesDisponiveis(): string[] {
    const set = new Set<string>();
    for (const p of this.pessoasTodos) {
      if (((p as any).aprovacao?.status || 'nao_verificado') === 'inapto') continue;
      if (this.filtroUf && (p as any).uf !== this.filtroUf) continue;
      const c = ((p as any).cidade || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }

  get bairrosDisponiveis(): string[] {
    const set = new Set<string>();
    for (const p of this.pessoasTodos) {
      if (((p as any).aprovacao?.status || 'nao_verificado') === 'inapto') continue;
      if (this.filtroUf && (p as any).uf !== this.filtroUf) continue;
      if (this.filtroCidade && (p as any).cidade !== this.filtroCidade) continue;
      const b = ((p as any).bairro || '').trim();
      if (b) set.add(b);
    }
    return Array.from(set).sort();
  }

  onFiltroUfChange() {
    this.filtroCidade = '';
    this.filtroBairro = '';
    this.aplicarFiltrosPessoas();
  }

  onFiltroCidadeChange() {
    this.filtroBairro = '';
    this.aplicarFiltrosPessoas();
  }

  getAprovacaoLabel(status?: string): string {
    switch (status) {
      case 'apto':          return 'Apto';
      case 'inapto':        return 'Inapto';
      case 'nao_verificado':
      default:              return 'Não verificado';
    }
  }

  /** @deprecated use getAprovacaoLabel */
  getElegibilidadeLabel(status?: string): string {
    return this.getAprovacaoLabel(status);
  }

  elegivelLabel(status?: string): string {
    switch (status) {
      case 'sim': return 'Elegível';
      case 'nao': return 'Não elegível';
      default:    return 'Eleg. não verificada';
    }
  }

  elegivelClass(status?: string): string {
    switch (status) {
      case 'sim': return 'bg-success';
      case 'nao': return 'bg-danger';
      default:    return 'bg-secondary';
    }
  }

  // ====================================================
  // FILTROS / BUSCA
  // ====================================================
  setAba(aba: Aba) {
    this.aba = aba;
    this.aplicarFiltrosPessoas();
    this.aplicarFiltrosGrupos();
    this.aplicarFiltrosMinhaCaixa();
  }

  onSearchChange() {
    if (this.aba === 'pessoas') this.aplicarFiltrosPessoas();
    else if (this.aba === 'grupos') this.aplicarFiltrosGrupos();
    else this.aplicarFiltrosMinhaCaixa();
  }

  setEnvioFilter(f: FiltroEnvio) {
    if (f === 'todos') {
      this.filtrosEnvio = new Set();
    } else {
      const next = new Set(this.filtrosEnvio);
      if (next.has(f)) {
        next.delete(f);
      } else {
        next.add(f);
      }
      this.filtrosEnvio = next;
    }
    this.aplicarFiltrosPessoas();
  }

  aplicarFiltrosPessoas() {
    let list = [...this.pessoas];

    // Exibe somente aptos nesta visão de triagem/encaminhamento
    list = list.filter(
      p => ((p as any).aprovacao?.status || 'nao_verificado') === 'apto'
    );

    // filtro encaminhamento / elegibilidade
    if (this.filtrosEnvio.size > 0) {
      const temAprovacao = this.filtrosEnvio.has('apto');
      const temEncaminhamento = this.filtrosEnvio.has('encaminhado') || this.filtrosEnvio.has('nao_encaminhado');

      list = list.filter((p) => {
        const passaAprovacao = !temAprovacao ||
          this.filtrosEnvio.has((p as any).aprovacao?.status || 'nao_verificado');

        const enc = !!(p as any).encaminhadoParaUid;
        const passaEncaminhamento = !temEncaminhamento ||
          (this.filtrosEnvio.has('encaminhado') && enc) ||
          (this.filtrosEnvio.has('nao_encaminhado') && !enc);

        return passaAprovacao && passaEncaminhamento;
      });
    }

    // filtro por UF
    if (this.filtroUf) {
      list = list.filter(p => ((p as any).uf || '').toUpperCase() === this.filtroUf.toUpperCase());
    }

    // filtro por cidade
    if (this.filtroCidade) {
      list = list.filter(p => this.normalize((p as any).cidade || '') === this.normalize(this.filtroCidade));
    }

    // filtro por bairro
    if (this.filtroBairro) {
      list = list.filter(p => this.normalize((p as any).bairro || '') === this.normalize(this.filtroBairro));
    }

    // filtro por quem aprovou o CPF
    if (this.filtroAprovadorUid) {
      list = list.filter(p => (p as any).aprovacao?.porUid === this.filtroAprovadorUid);
    }

    // filtro por analista do time (leads na caixa do analista ou encaminhados por ele)
    if (this.filtroAnalista !== 'todos') {
      list = list.filter((p) =>
        (p as any).caixaUid === this.filtroAnalista ||
        (p as any).encaminhadoPorUid === this.filtroAnalista
      );
    }

    // filtro por quem cadastrou
    if (this.filtroCriadorUid) {
      list = list.filter((p) => (p as any).createdByUid === this.filtroCriadorUid);
    }

    const term = this.normalize(this.searchTerm);
    if (term === 'apto' || term === 'nao_verificado') {
      list = list.filter((p) => {
        const status = (p as any).aprovacao?.status || 'nao_verificado';
        return status === term;
      });
    } else if (term) {
      list = list.filter((p) => {
        const blob = this.normalize(
          `${(p as any).nomeCompleto || (p as any).nome || ''} ${(p as any).cpf || ''
          } ${(p as any).telefone || ''} ${(p as any).email || ''} ${(p as any).bairro || ''
          } ${(p as any).cidade || ''} ${(p as any).uf || ''} ${(p as any).grupoNome || ''
          } ${(p as any).aprovacao?.status || ''} ${(p as any).createdByNome || ''} ${(p as any).modalidade || ''} ${(p as any).sexo || ''}`
        );
        return blob.includes(term);
      });
    }

    list.sort((a, b) => {
      const da = this.toJSDate((a as any).createdAt)?.getTime() || 0;
      const db = this.toJSDate((b as any).createdAt)?.getTime() || 0;
      return db - da;
    });

    this.paginaPessoas = 1;
    this.pessoasView = list;
  }

  private aplicarFiltrosGrupos() {
    let list = [...this.grupos];

    // filtro por analista do time (grupos na caixa do analista ou encaminhados por ele)
    if (this.filtroAnalista !== 'todos') {
      list = list.filter((g) =>
        (g as any).caixaUid === this.filtroAnalista ||
        (g as any).encaminhadoPorUid === this.filtroAnalista
      );
    }

    // filtro por quem cadastrou
    if (this.filtroCriadorUid) {
      list = list.filter((g) => (g as any).createdByUid === this.filtroCriadorUid);
    }

    const term = this.normalize(this.searchTerm);
    if (term) {
      list = list.filter((g) => {
        const coord: any = (g as any).coordenadorView || {};
        const blob = this.normalize(
          `${(g as any).nome || ''} ${(g as any).codigo || ''} ${coord?.nome || ''
          } ${(g as any).cidade || ''} ${(g as any).estado || ''}
          ${(g as any).aprovacao || ''}`
        );
        return blob.includes(term);
      });
    }

    this.paginaGrupos = 1;
    this.gruposView = list;
  }

  // ====================================================
  // MINHA CAIXA
  // ====================================================
  aplicarFiltrosMinhaCaixa() {
    if (!this.currentUserUid) {
      this.minhaCaixaPessoasView = [];
      this.minhaCaixaGruposView = [];
      return;
    }

    const term = this.normalize(this.searchTermMinhaCaixa);

    let pessoas = this.pessoasTodos.filter(
      p => (p as any).caixaUid === this.currentUserUid
    );
    if (term) {
      pessoas = pessoas.filter(p => {
        const blob = this.normalize(
          `${(p as any).nomeCompleto || ''} ${(p as any).cpf || ''} ${(p as any).telefone || ''
          } ${(p as any).cidade || ''} ${(p as any).uf || ''} ${(p as any).encaminhadoPorNome || ''}`
        );
        return blob.includes(term);
      });
    }
    pessoas.sort((a, b) => {
      const da = this.toJSDate((a as any).encaminhadoEm)?.getTime() ||
                 this.toJSDate((a as any).createdAt)?.getTime() || 0;
      const db = this.toJSDate((b as any).encaminhadoEm)?.getTime() ||
                 this.toJSDate((b as any).createdAt)?.getTime() || 0;
      return db - da;
    });
    this.minhaCaixaPessoasView = pessoas;

    let grupos = this.gruposTodos.filter(
      g => (g as any).caixaUid === this.currentUserUid
    );
    if (term) {
      grupos = grupos.filter(g => {
        const coord: any = (g as any).coordenadorView || {};
        const blob = this.normalize(
          `${(g as any).nome || ''} ${coord?.nome || ''} ${(g as any).cidade || ''
          } ${(g as any).encaminhadoPorNome || ''}`
        );
        return blob.includes(term);
      });
    }
    this.minhaCaixaGruposView = grupos;

    this.paginaMinhaCaixa = 1;
  }

  get minhaCaixaPessoasPaginadas(): PreCadastro[] {
    const start = (this.paginaMinhaCaixa - 1) * this.tamanhoPaginaMinhaCaixa;
    return this.minhaCaixaPessoasView.slice(start, start + this.tamanhoPaginaMinhaCaixa);
  }

  get totalPaginasMinhaCaixa(): number {
    return Math.max(1, Math.ceil(this.minhaCaixaPessoasView.length / this.tamanhoPaginaMinhaCaixa));
  }

  // ====================================================
  // PAGINAÇÃO
  // ====================================================

  get pessoasPaginadas(): PreCadastro[] {
    const start = (this.paginaPessoas - 1) * this.tamanhoPaginaPessoas;
    return this.pessoasView.slice(start, start + this.tamanhoPaginaPessoas);
  }

  get totalPaginasPessoas(): number {
    return Math.max(1, Math.ceil(this.pessoasView.length / this.tamanhoPaginaPessoas));
  }

  get gruposPaginados(): GrupoSolidario[] {
    const start = (this.paginaGrupos - 1) * this.tamanhoPaginaGrupos;
    return this.gruposView.slice(start, start + this.tamanhoPaginaGrupos);
  }

  get totalPaginasGrupos(): number {
    return Math.max(1, Math.ceil(this.gruposView.length / this.tamanhoPaginaGrupos));
  }

  paginasVisiveis(atual: number, total: number): (number | '...')[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | '...')[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= atual - 2 && i <= atual + 2)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return pages;
  }

  irParaPaginaPessoas(p: number | '...'): void {
    if (typeof p === 'number') this.paginaPessoas = p;
  }

  irParaPaginaGrupos(p: number | '...'): void {
    if (typeof p === 'number') this.paginaGrupos = p;
  }

  // ====================================================
  // UTILS VISUAIS
  // ====================================================
  cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  whatsHref(v?: string | null): string | null {
    if (!v) return null;
    let d = String(v).replace(/\D+/g, '');
    if (d.startsWith('55')) d = d.slice(2);
    d = d.replace(/^0+/, '');
    if (d.length < 10 || d.length > 11) return null;
    return `https://wa.me/55${d}`;
  }

  encaminhadoNome(p: PreCadastro): string | null {
    return (
      (p as any).encaminhadoParaNome ||
      (p as any).encaminhamento?.assessorNome ||
      null
    );
  }

  encaminhadoData(p: PreCadastro): string | null {
    const rawEm = (p as any).encaminhadoEm ?? (p as any).designadoEm ?? null;
    const d = this.toJSDate(rawEm);
    if (!d) return null;
    const dd  = String(d.getDate()).padStart(2, '0');
    const mm  = String(d.getMonth() + 1).padStart(2, '0');
    const hh  = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} às ${hh}:${min}`;
  }

  encaminhadoTempoDesde(item: any): string | null {
    const rawEm = item?.encaminhadoEm ?? item?.designadoEm ?? null;
    return this.tempoDecorrido(rawEm);
  }

  private tempoDecorrido(rawDate: any): string | null {
    const d = this.toJSDate(rawDate);
    if (!d) return null;
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return null;
    const dias    = Math.floor(diffMs / 86400000);
    const horas   = Math.floor(diffMs / 3600000);
    const minutos = Math.floor(diffMs / 60000);
    if (dias    >= 1) return `há ${dias} dia${dias    !== 1 ? 's' : ''}`;
    if (horas   >= 1) return `há ${horas} hora${horas !== 1 ? 's' : ''}`;
    if (minutos >= 1) return `há ${minutos} min`;
    return 'agora mesmo';
  }

  // Mantido para o *ngIf do badge "Encaminhado / Não encaminhado"
  encaminhadoLabel(p: PreCadastro): string | null {
    return this.encaminhadoNome(p);
  }

  getStatusClass(status?: string): string {
    switch ((status || '').toLowerCase()) {
      case 'apto':        return 'bg-success';
      case 'inapto':      return 'bg-danger';
      case 'nao_verificado': return 'bg-secondary';
      default:            return 'bg-secondary';
    }
  }

  // ====================================================
  // MODAL — ENC. PESSOA
  // ====================================================
  abrirModalAssessorPessoa(p: PreCadastro) {
    if (!this.assessores.length) {
      alert('Não há assessores vinculados ao seu time.');
      return;
    }
    this.pessoaSelecionada = p;
    this.selectedAssessorUidPessoa =
      ((p as any).encaminhadoParaUid as string) ||
      ((p as any).designadoParaUid as string) ||
      null;
    this.buscaAssessorPessoa = '';
    this.buscaAnalistaModal = '';
    this.tipoDestinoModal = 'assessor';
    this.assessoresFiltrados = [...this.assessores];
    this.analistasFiltradosModal = [...this.analistas];
    this.showAssessorPessoaModal = true;
  }

  fecharModalAssessorPessoa() {
    this.showAssessorPessoaModal = false;
    this.pessoaSelecionada = null;
    this.selectedAssessorUidPessoa = null;
    this.buscaAssessorPessoa = '';
    this.buscaAnalistaModal = '';
  }

  setTipoDestinoModal(tipo: 'assessor' | 'analista') {
    this.tipoDestinoModal = tipo;
    this.selectedAssessorUidPessoa = null;
    this.selectedAssessorUidGrupo = null;
    this.buscaAssessorPessoa = '';
    this.buscaAssessorGrupo = '';
    this.buscaAnalistaModal = '';
    this.assessoresFiltrados = [...this.assessores];
    this.analistasFiltradosModal = [...this.analistas];
  }

  filtrarAnalistasModal() {
    const term = this.normalize(this.buscaAnalistaModal);
    if (!term) {
      this.analistasFiltradosModal = [...this.analistas];
      return;
    }
    this.analistasFiltradosModal = this.analistas.filter((a) =>
      this.normalize(a.nome || '').includes(term)
    );
  }

  filtrarAssessoresPessoa() {
    const term = this.normalize(this.buscaAssessorPessoa);
    if (!term) {
      this.assessoresFiltrados = [...this.assessores];
      return;
    }
    this.assessoresFiltrados = this.assessores.filter((a) =>
      this
        .normalize(`${a.nome || ''} ${a.email || ''} ${a.rota || ''}`)
        .includes(term)
    );
  }

  async confirmarEncaminharPessoa() {
    if (!this.pessoaSelecionada || !this.selectedAssessorUidPessoa) return;
    await this.encaminharPreCadastro(
      this.pessoaSelecionada,
      this.selectedAssessorUidPessoa,
      this.tipoDestinoModal
    );
    this.fecharModalAssessorPessoa();
  }

  private async encaminharPreCadastro(
    pre: PreCadastro,
    assessorUid: string,
    tipoDestino: 'assessor' | 'analista' = 'assessor'
  ): Promise<void> {
    if (!pre?.id) return;

    try {
      const colabRef = doc(this.afs, 'colaboradores', assessorUid);
      const colabSnap = await getDoc(colabRef);
      const colabData: any = colabSnap.data() || {};
      const assessorNome =
        colabData?.nome || colabData?.displayName || colabData?.email || null;

      const meUid = this.currentUserUid;
      const meNome = this.currentUserNome;

      const ref = doc(this.afs, 'pre_cadastros', pre.id);
      await setDoc(
        ref,
        {
          designadoParaUid: assessorUid,
          designadoPara: assessorUid,
          designadoParaNome: assessorNome,
          designadoEm: serverTimestamp(),

          encaminhadoParaUid: assessorUid,
          encaminhadoParaNome: assessorNome,
          encaminhadoEm: serverTimestamp(),
          encaminhadoPorUid: meUid,
          encaminhadoPorNome: meNome ?? null,

          caixaAtual: tipoDestino,
          caixaUid: assessorUid,
        },
        { merge: true }
      );

      const patch: any = {
        designadoParaUid: assessorUid,
        designadoParaNome: assessorNome,
        encaminhadoParaUid: assessorUid,
        encaminhadoParaNome: assessorNome,
        encaminhadoPorUid: meUid,
        encaminhadoPorNome: meNome ?? null,
        caixaAtual: tipoDestino,
        caixaUid: assessorUid,
      };

      this.pessoas = this.pessoas.map((p) =>
        p.id === pre.id ? ({ ...(p as any), ...patch } as PreCadastro) : p
      );
      this.pessoasTodos = this.pessoasTodos.map((p) =>
        p.id === pre.id ? ({ ...(p as any), ...patch } as PreCadastro) : p
      );
      this.aplicarFiltrosPessoas();
      this.aplicarFiltrosMinhaCaixa();
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao encaminhar pessoa:', e);
      alert('Não foi possível encaminhar o pré-cadastro. Tente novamente.');
    }
  }

  // ====================================================
  // MODAL — ENC. GRUPO
  // ====================================================
  abrirModalAssessorGrupo(g: GrupoSolidario) {
    if (!this.assessores.length) {
      alert('Não há assessores vinculados ao seu time.');
      return;
    }
    this.grupoSelecionado = g;
    this.selectedAssessorUidGrupo =
      ((g as any).encaminhadoParaUid as string) ||
      ((g as any).designadoParaUid as string) ||
      null;
    this.buscaAssessorGrupo = '';
    this.buscaAnalistaModal = '';
    this.tipoDestinoModal = 'assessor';
    this.assessoresFiltrados = [...this.assessores];
    this.analistasFiltradosModal = [...this.analistas];
    this.showAssessorGrupoModal = true;
  }

  fecharModalAssessorGrupo() {
    this.showAssessorGrupoModal = false;
    this.grupoSelecionado = null;
    this.selectedAssessorUidGrupo = null;
    this.buscaAssessorGrupo = '';
    this.buscaAnalistaModal = '';
  }

  filtrarAssessoresGrupo() {
    const term = this.normalize(this.buscaAssessorGrupo);
    if (!term) {
      this.assessoresFiltrados = [...this.assessores];
      return;
    }
    this.assessoresFiltrados = this.assessores.filter((a) =>
      this
        .normalize(`${a.nome || ''} ${a.email || ''} ${a.rota || ''}`)
        .includes(term)
    );
  }

  async confirmarEncaminharGrupo() {
    if (!this.grupoSelecionado || !this.selectedAssessorUidGrupo) return;
    await this.encaminharGrupo(
      this.grupoSelecionado,
      this.selectedAssessorUidGrupo,
      this.tipoDestinoModal
    );
    this.fecharModalAssessorGrupo();
  }

  private async encaminharGrupo(
    g: GrupoSolidario,
    assessorUid: string,
    tipoDestino: 'assessor' | 'analista' = 'assessor'
  ): Promise<void> {
    const gid = (g as any).id;
    if (!gid) return;

    try {
      const colabRef = doc(this.afs, 'colaboradores', assessorUid);
      const colabSnap = await getDoc(colabRef);
      const colabData: any = colabSnap.data() || {};
      const assessorNome =
        colabData?.nome || colabData?.displayName || colabData?.email || null;

      const meUid = this.currentUserUid;
      const meNome = this.currentUserNome;

      const batch = writeBatch(this.afs);

      // grupo
      const refGrupo = doc(this.afs, 'grupos_solidarios', gid);
      batch.set(
        refGrupo,
        {
          designadoParaUid: assessorUid,
          designadoParaNome: assessorNome,
          designadoEm: serverTimestamp(),

          encaminhadoParaUid: assessorUid,
          encaminhadoParaNome: assessorNome,
          encaminhadoEm: serverTimestamp(),
          encaminhadoPorUid: meUid,
          encaminhadoPorNome: meNome ?? null,

          caixaAtual: tipoDestino,
          caixaUid: assessorUid,
        },
        { merge: true }
      );

      // coordenador + membros (usando joinGruposView: coordenadorView / membrosView)
      const coord: any = (g as any).coordenadorView || null;
      const membros: any[] = ((g as any).membrosView || []) as MembroGrupoView[];

      const ids = new Set<string>();
      if (coord?.preCadastroId) ids.add(coord.preCadastroId);
      for (const m of membros) {
        if (m?.preCadastroId) ids.add(m.preCadastroId);
      }

      ids.forEach((id) => {
        const refPre = doc(this.afs, 'pre_cadastros', id);
        batch.set(
          refPre,
          {
            designadoParaUid: assessorUid,
            designadoPara: assessorUid,
            designadoParaNome: assessorNome,
            designadoEm: serverTimestamp(),

            encaminhadoParaUid: assessorUid,
            encaminhadoParaNome: assessorNome,
            encaminhadoEm: serverTimestamp(),
            encaminhadoPorUid: meUid,
            encaminhadoPorNome: meNome ?? null,

            caixaAtual: tipoDestino,
            caixaUid: assessorUid,
          },
          { merge: true }
        );
      });

      await batch.commit();

      // atualiza localmente o grupo
      const patchGrupo: any = {
        designadoParaUid: assessorUid,
        designadoParaNome: assessorNome,
        encaminhadoParaUid: assessorUid,
        encaminhadoParaNome: assessorNome,
        encaminhadoPorUid: meUid,
        encaminhadoPorNome: meNome ?? null,
        caixaAtual: tipoDestino,
        caixaUid: assessorUid,
      };

      this.grupos = this.grupos.map((gg) =>
        (gg as any).id === gid
          ? ({ ...(gg as any), ...patchGrupo } as GrupoSolidario)
          : gg
      );
      this.gruposTodos = this.gruposTodos.map((gg) =>
        (gg as any).id === gid
          ? ({ ...(gg as any), ...patchGrupo } as GrupoSolidario)
          : gg
      );
      this.aplicarFiltrosGrupos();

      // e atualiza localmente as pessoas (membros + coordenador)
      const idsArr = Array.from(ids);
      const patchPessoa: any = { ...patchGrupo };
      this.pessoas = this.pessoas.map((p) =>
        p.id && idsArr.includes(p.id)
          ? ({ ...(p as any), ...patchPessoa } as PreCadastro)
          : p
      );
      this.pessoasTodos = this.pessoasTodos.map((p) =>
        p.id && idsArr.includes(p.id)
          ? ({ ...(p as any), ...patchPessoa } as PreCadastro)
          : p
      );
      this.aplicarFiltrosPessoas();
      this.aplicarFiltrosMinhaCaixa();
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao encaminhar grupo:', e);
      alert('Não foi possível encaminhar o grupo. Tente novamente.');
    }
  }

  // ====================================================
  // DETALHE DO GRUPO (coordenador + membros)
  // ====================================================
  abrirDetalheGrupo(g: GrupoSolidario) {
    this.grupoDetalhe = g;
    this.showGrupoDetalhe = true;
  }

  fecharDetalheGrupo() {
    this.showGrupoDetalhe = false;
    this.grupoDetalhe = null;
  }

  qtdMembrosGrupo(g: GrupoSolidario): number {
    const membros = (g as any).membrosView || [];
    const coord = (g as any).coordenadorView || null;

    if (!coord) return membros.length;

    // Remove o coordenador se estiver dentro dos membros
    const membrosUnicos = membros.filter(
      (m: any) => m.preCadastroId !== coord.preCadastroId
    );

    return membrosUnicos.length + 1; // soma apenas se for realmente diferente
  }

  // ====================================================
  // MODAL — RELATÓRIO PDF
  // ====================================================
  abrirModalRelatorio() {
    this.relatorioAssessorUid = '';
    this.relatorioDataInicio = '';
    this.relatorioDataFim = '';
    this.buscaAssessorRelatorio = '';
    this.assessoresFiltradosRelatorio = [...this.assessores];
    this.showRelatorioModal = true;
  }

  fecharModalRelatorio() {
    this.showRelatorioModal = false;
  }

  filtrarAssessoresRelatorio() {
    const term = this.normalize(this.buscaAssessorRelatorio);
    if (!term) {
      this.assessoresFiltradosRelatorio = [...this.assessores];
      return;
    }
    this.assessoresFiltradosRelatorio = this.assessores.filter((a) =>
      this.normalize(`${a.nome || ''} ${a.email || ''} ${a.rota || ''}`).includes(term)
    );
  }

  get relatorioFormValido(): boolean {
    return !!this.relatorioAssessorUid && !!this.relatorioDataInicio;
  }

  async gerarRelatorio() {
    if (!this.relatorioFormValido) return;

    this.relatorioLoading = true;
    try {
      const ref = collection(this.afs, 'pre_cadastros');
      const q = fsQuery(ref, where('encaminhadoParaUid', '==', this.relatorioAssessorUid));
      const snap = await getDocs(q);

      const dataInicio = new Date(this.relatorioDataInicio + 'T00:00:00');
      const dataFim = this.relatorioDataFim
        ? new Date(this.relatorioDataFim + 'T23:59:59')
        : new Date(); // sem data fim → até agora

      const registros = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((r) => {
          const rawEm = r['encaminhadoEm'] ?? r['designadoEm'] ?? null;
          const d = this.toJSDate(rawEm);
          if (!d) return false;
          return d >= dataInicio && d <= dataFim;
        })
        .sort((a, b) => {
          const rawA = a['encaminhadoEm'] ?? a['designadoEm'] ?? null;
          const rawB = b['encaminhadoEm'] ?? b['designadoEm'] ?? null;
          const da = this.toJSDate(rawA)?.getTime() ?? 0;
          const db = this.toJSDate(rawB)?.getTime() ?? 0;
          return da - db;
        });

      const assessor = this.assessores.find((a) => a.uid === this.relatorioAssessorUid);
      this.exportarPdf(registros, assessor, dataInicio, dataFim);
      this.fecharModalRelatorio();
    } catch (e) {
      console.error('[TriagemSupervisao] erro ao gerar relatório:', e);
      alert('Erro ao gerar relatório. Tente novamente.');
    } finally {
      this.relatorioLoading = false;
    }
  }

  private exportarPdf(
    registros: any[],
    assessor: Assessor | undefined,
    dataInicio: Date,
    dataFim: Date
  ) {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const formatDate = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    const mesmodia =
      dataInicio.toDateString() === dataFim.toDateString();
    const periodo = mesmodia
      ? formatDate(dataInicio)
      : `${formatDate(dataInicio)} a ${formatDate(dataFim)}`;

    // cabeçalho
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Relatório de Encaminhamentos', 14, 16);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Assessor: ${assessor?.nome ?? '—'}`, 14, 23);
    doc.text(`Período: ${periodo}`, 14, 29);
    doc.text(`Total de clientes: ${registros.length}`, 14, 35);

    const hoje = new Date();
    doc.text(
      `Gerado em: ${formatDate(hoje)} ${String(hoje.getHours()).padStart(2, '0')}:${String(hoje.getMinutes()).padStart(2, '0')}`,
      doc.internal.pageSize.getWidth() - 14,
      16,
      { align: 'right' }
    );

    const rows = registros.map((r, i) => {
      const encEm = this.toJSDate(r['encaminhadoEm']);
      const dataEnc = encEm
        ? `${String(encEm.getDate()).padStart(2, '0')}/${String(encEm.getMonth() + 1).padStart(2, '0')} ${String(encEm.getHours()).padStart(2, '0')}:${String(encEm.getMinutes()).padStart(2, '0')}`
        : '—';

      return [
        i + 1,
        r['nomeCompleto'] || r['nome'] || '—',
        this.cpfMask(r['cpf']),
        r['telefone'] || '—',
        [r['cidade'], r['uf']].filter(Boolean).join('/') || '—',
        r['bairro'] || '—',
        dataEnc,
      ];
    });

    autoTable(doc, {
      startY: 41,
      head: [['#', 'Nome', 'CPF', 'Telefone', 'Cidade/UF', 'Bairro', 'Enc. em']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [25, 135, 84], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 250, 247] },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 55 },
        2: { cellWidth: 28 },
        3: { cellWidth: 28 },
        4: { cellWidth: 30 },
        5: { cellWidth: 50 },
        6: { cellWidth: 22, halign: 'center' },
      },
    });

    const safeName = (assessor?.nome ?? 'relatorio')
      .replace(/[^a-zA-Z0-9À-ÿ ]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase();
    doc.save(`encaminhamentos_${safeName}_${periodo.replace(/\//g, '-').replace(/ /g, '_')}.pdf`);
  }

}
