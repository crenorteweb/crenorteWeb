import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  collection,
  getDocs,
  getCountFromServer,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { db } from '../../firebase.config';
import { HeaderComponent } from '../shared/header/header.component';
import { PreCadastro } from '../../models/pre-cadastro.model';

type SortDir = 'asc' | 'desc';
type Visualizacao = 'cards';
type PreCadastroList = PreCadastro & { _path: string };
type AprovMotivo = 'SERASA' | 'CADIN' | 'SCR';


@Component({
  selector: 'app-listagem-pre-cadastros',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  styleUrls: ['./listagem-pre-cadastros.component.css'],
  templateUrl: './listagem-pre-cadastros.component.html',
})
export class ListagemPreCadastrosComponent implements OnInit {
  // =================== Estado base ===================
  presAll: PreCadastroList[] = [];
  presFiltrados: PreCadastroList[] = [];

  totalEstimado = 0;
  carregando = false;
  erroCarregar = '';

  // Visualização fixa (apenas cards)
  visualizacao: Visualizacao = 'cards';

  // =================== Filtros ===================
  filtro = {
    nome: '',
    dataDe: '' as string | '',
    dataAte: '' as string | '',
    agendado: 'todos' as 'todos' | 'sim' | 'nao',
    origem: '',
    bairro: '',
    cidade: '',
    uf: '',
    assessor: '',
    agDataDe: '' as string | '',
    agDataAte: '' as string | '',
    agStatus: '',
    aprovStatus: '',
    distribuidoPara: '',

    // 🔽 NOVO: motivos de reprovação (só usados quando aprovStatus = 'Inapto')
    aprovInaptoObs: {
      serasa: false,
      cadin: false,
      scr: false,
    },
  };


  // Combos dinâmicos
  origensDisponiveis: string[] = [];
  bairrosDisponiveis: string[] = [];
  cidadesDisponiveis: string[] = [];
  ufsDisponiveis: string[] = [];
  assessoresDisponiveis: string[] = [];
  agStatusDisponiveis: string[] = [];
  aprovStatusDisponiveis: string[] = [];
  distribuicoesDisponiveis: string[] = []; // <— NOVO

  // Relatório
  relatorioAberto = false;
  relatorioGeradoEm = '';
  kpiCarregados = 0;
  kpiFiltrados = 0;
  kpiAgendados = 0;
  kpiSemAgendamento = 0;

  // 🔽 NOVOS KPIs para inaptos por motivo
  kpiInaptoSerasa = 0;
  kpiInaptoCadin = 0;
  kpiInaptoScr = 0;

  relDetalhes: Array<{
    nome: string;
    telefone: string;
    criado: string;
    agendado: 'Sim' | 'Não';
    agDataHora: string;
    agStatus: string;
    aprovStatus: string;
    aprovObs: string;          // 🔽 NOVO
    bairro: string;
    cidade: string;
    uf: string;
    origem: string;
    distribuidosPara: string;
  }> = [];

  resumoFiltros = '';

  // Ordenação (só afeta o array base/relatório)
  sortField: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro' = 'createdAt';
  sortDir: SortDir = 'desc';

  // =================== Mapa de colaboradores (UID -> Nome) ===================
  private uidToNome = new Map<string, string>();

  // =================== Modal de Edição ===================
  editOpen = false;
  editSaving = false;
  editItem: PreCadastroList | null = null;
  ufsBrasil = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ];
  editModel: {
    nomeCompleto: string;
    cpf: string;
    telefone: string;
    email: string;
    endereco: string;
    bairro: string;
    cidade: string;
    uf: string;
    origem: string;
  } = {
      nomeCompleto: '',
      cpf: '',
      telefone: '',
      email: '',
      endereco: '',
      bairro: '',
      cidade: '',
      uf: '',
      origem: '',
    };

  // =================== Ciclo de vida ===================
  async ngOnInit(): Promise<void> {
    // 1) carrega colaboradores para mapear UIDs -> nomes
    await this.carregarMapaColaboradores();
    // 2) carrega pré-cadastros
    await this.recarregarTudo();
  }

  /** Carrega top-level 'colaboradores' para montar o mapa UID→Nome */
  private async carregarMapaColaboradores(): Promise<void> {
    this.uidToNome.clear();
    try {
      const snap = await getDocs(collection(db, 'colaboradores'));
      snap.forEach((d) => {
        const data = d.data() as any;
        const uid = (data?.uid || d.id || '').toString().trim();
        const nome =
          (data?.displayName || data?.nome || data?.apelido || data?.email || '').toString().trim();
        if (uid && nome) this.uidToNome.set(uid, this.displayName(nome));
      });
    } catch {
      // Se não existir a coleção, seguimos sem mapa (cairá nos fallbacks por nome direto)
    }
  }

  // =================== Carrega TUDO (sem índice, sem collectionGroup) ===================
  private async carregarTudoTopLevel(): Promise<void> {
    this.carregando = true;
    this.erroCarregar = '';
    this.presAll = [];

    try {
      // Contagem estimada
      this.totalEstimado = 0;
      for (const colName of ['pre_cadastros', 'pre-cadastros']) {
        try {
          const cnt = await getCountFromServer(collection(db, colName));
          this.totalEstimado += (cnt.data() as any).count || 0;
        } catch { }
      }

      // Carregar documentos das coleções de topo
      const foundPaths = new Set<string>();
      for (const colName of ['pre_cadastros', 'pre-cadastros']) {
        try {
          const snap = await getDocs(collection(db, colName));
          snap.forEach((d) => {
            const path = d.ref.path;
            if (foundPaths.has(path)) return;
            foundPaths.add(path);
            const data = d.data() as any;
            this.presAll.push({ ...(data as any), id: d.id, _path: path });
          });
        } catch {
          // coleção pode não existir — ignore
        }
      }

      this.recalcularOpcoesDinamicas();
      this.aplicarFiltrosLocais(true);
    } catch (e: any) {
      console.error(e);
      this.erroCarregar = 'Falha ao carregar os dados do Firebase.';
    } finally {
      this.carregando = false;
    }
  }

  async recarregarTudo() {
    await this.carregarTudoTopLevel();
  }

  // =================== Utilidades ===================
  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  public displayName(raw?: string): string {
    const s = (raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keep = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts.map((p, i) => (i > 0 && keep.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }
  public maskPhone(input?: string): string {
    const d = (input || '').replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    if (d.length > 11) return d.replace(/(\d{2,3})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4');
    return d;
  }
  public getPhone(c: any): string { return (c?.contato ?? c?.telefone ?? '') as string; }
  private asDateFlexible(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object' && typeof v.toDate === 'function') { try { return v.toDate(); } catch { } }
    if (v && typeof v === 'object' && typeof v.seconds === 'number') {
      return new Date(v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6));
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  public toBRDate(value: any): string {
    const d = this.asDateFlexible(value);
    if (!d) return '—';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  public toBRTimeFromDate(d: Date): string {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // ========= Assessor/Origem/Bairro/Cidade/UF =========
  public getAssessorNome(c: PreCadastroList): string {
    const nome = (c.createdByNome || '').trim();
    if (nome) return this.displayName(nome);
    if (c.createdByUid) return `UID: ${c.createdByUid.slice(0, 6)}…`;
    return '(sem assessor)';
  }
  public getOrigem(c: PreCadastroList): string {
    const o = (c.origem ?? (c as any)?.origemNome ?? '').toString().trim();
    return o || '—';
  }
  public getBairro(c: PreCadastroList): string {
    const b = c.bairro ?? (c as any)?.enderecoBairro ?? (c as any)?.addressBairro ?? '';
    return (b || '').toString().trim() || '—';
  }
  public getCidade(c: PreCadastroList): string {
    const v = (c.cidade ?? (c as any)?.enderecoCidade ?? '').toString().trim();
    return v || '—';
  }
  public getUF(c: PreCadastroList): string {
    const v = (c.uf ?? (c as any)?.enderecoUF ?? '').toString().trim().toUpperCase();
    return v || '—';
  }

  // ========= Distribuídos para (com fallback via UIDs) =========
  private isRoleWord(s: string): boolean {
    const n = this.normalize(s);
    return ['analista', 'administrador', 'admin', 'assessor', 'coordenador', 'supervisor', 'operacional', 'rh']
      .some(w => n === w || n.startsWith(w + ' '));
  }

  /** Retorna nomes normalizados de "distribuídos para", resolvendo UIDs via mapa de colaboradores */
  public getDistribuidosPara(c: PreCadastroList): string[] {
    const nomes: string[] = [];

    // 1) nomes diretos se existirem
    const addNome = (v: any) => {
      const s = (v ?? '').toString().trim();
      if (!s) return;
      if (this.isRoleWord(s)) return; // ignora rótulos de papel (ex: "analista")
      nomes.push(this.displayName(s));
    };
    addNome((c as any).distribuidoPara);
    addNome((c as any).distribuidoParaNome);
    addNome((c as any).destinatarioNome);
    addNome((c as any).designadoParaNome);

    // 2) UIDs comuns no seu banco (pelo print): destinatarioUid, designadoParaUid, caixaUid
    const addUid = (uid: any) => {
      const s = (uid ?? '').toString().trim();
      if (!s) return;
      const nome = this.uidToNome.get(s);
      if (nome) nomes.push(this.displayName(nome));
    };
    addUid((c as any).destinatarioUid);
    addUid((c as any).designadoParaUid);
    addUid((c as any).caixaUid);

    // 3) Array genérico (se existir) — strings ou objetos com .nome / .porNome
    const arr = (c as any)?.distribuidosPara as any[] | undefined;
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (!it) continue;
        if (typeof it === 'string') addNome(it);
        else { addNome(it?.nome); addNome(it?.porNome); addUid(it?.uid); }
      }
    }

    // Dedupe e limpa
    return Array.from(new Set(nomes.filter(Boolean)));
  }

  /** Palavras de cargo que NÃO devem contar como nome de destino */
  private readonly CARGO_WORDS = new Set([
    'administrador', 'analista', 'coordenador', 'supervisor', 'operacional', 'rh', 'assessor'
  ]);

  /** Extrai o nome principal do destinatário da distribuição */
  private getDistribuidoPrincipalNome(c: any): string {
    const nome =
      (c?.designadoParaNome ?? c?.destinatarioNome ?? '').toString().trim();

    if (!nome) return '';
    // pega só a 1ª parte antes de vírgula (evita "Fulano, Administrador")
    const first = nome.split(',')[0].trim();
    const low = first.toLowerCase();

    // se for só um cargo, ignora
    if (this.CARGO_WORDS.has(low)) return '';
    return this.displayName(first);
  }

  /** Verdadeiro apenas se houver distribuição REAL para alguém diferente de quem criou */
  public isDistribuido(c: any): boolean {
    const temUidDestino = !!(c?.designadoParaUid || c?.destinatarioUid);
    const temMomento = !!c?.designadoEm; // opcional, mas ajuda a evitar falsos positivos
    const nomeDestino = this.getDistribuidoPrincipalNome(c);

    // se tiver creator e destino iguais, considera NÃO distribuído
    const mesmoQueCriador =
      c?.createdByUid && (c?.designadoParaUid === c?.createdByUid || c?.destinatarioUid === c?.createdByUid);

    return !!nomeDestino && temUidDestino && !mesmoQueCriador && (temMomento || temUidDestino);
  }

  /** Texto final para o card/relatório */
  public getDistribuidosParaTexto(c: any): string {
    return this.isDistribuido(c) ? this.getDistribuidoPrincipalNome(c) : 'Ainda não foi distribuído';
  }


  // ========= Aprovação / Agendamento =========
  private getAprovacaoCode(c: any): 'apto' | 'inapto' | 'pendente' | 'desconhecido' {
    const cand =
      c?.aprovacao?.status ??
      c?.aprovacaoStatus ??
      (typeof c?.aprovado === 'boolean' ? (c.aprovado ? 'apto' : 'inapto') : undefined) ??
      c?.statusAprovacao ??
      c?.aprovadoStatus ??
      '';
    const raw = (cand ?? '').toString().trim();
    if (!raw) return 'desconhecido';
    const n = this.normalize(raw);

    if (/\binapto\b/.test(n) || /reprov/.test(n) || /neg/.test(n) ||
      /\bnao[_-]?apto\b/.test(n) || /\bnão[_-]?apto\b/.test(n)) return 'inapto';
    if (['false', '0', 'nao', 'não', 'no'].includes(n)) return 'inapto';
    if (/\bapto\b/.test(n) || /aprov/.test(n)) return 'apto';
    if (['true', '1', 'sim', 'yes'].includes(n)) return 'apto';
    if (/pend/.test(n) || /analise/.test(n) || /em anal/.test(n) || /nao_verificado/.test(n) || /não_verificado/.test(n))
      return 'pendente';
    return 'desconhecido';
  }

  public getAprovacaoStatus(c: any): string {
    const code = this.getAprovacaoCode(c);
    if (code === 'apto') return 'Apto';
    if (code === 'inapto') return 'Inapto';
    if (code === 'pendente') return 'Pendente';
    return '—';
  }

  // ========= Motivos da reprovação (SERASA / CADIN / SCR) =========
  private readonly APROV_MOTIVOS: AprovMotivo[] = ['SERASA', 'CADIN', 'SCR'];

  /** Lê a string de observação (ex: "SERASA/CADIN/SCR") e devolve array de motivos válidos */
  private parseAprovMotivos(c: any): AprovMotivo[] {
    const raw = (
      c?.aprovacao?.observacao ??
      c?.aprovacaoObservacao ??
      c?.aprovacao?.motivo ??
      ''
    ).toString();

    if (!raw) return [];

    return raw
      .split('/')
      .map((t: string) => t.trim().toUpperCase())
      .filter((t: string) => this.APROV_MOTIVOS.includes(t as AprovMotivo)) as AprovMotivo[];
  }

  /** Verdadeiro se o pré-cadastro tiver o motivo especificado */
  public hasAprovMotivo(c: any, motivo: AprovMotivo): boolean {
    return this.parseAprovMotivos(c).includes(motivo);
  }

  /** Texto pronto para exibir nos cards / relatório */
  public getAprovMotivosTexto(c: any): string {
    const arr = this.parseAprovMotivos(c);
    return arr.length ? arr.join(' / ') : '';
  }

  /** Getter usado no template para saber se o filtro está em INAPTO */
  public get aprovFiltroEhInapto(): boolean {
    const n = this.normalize(this.filtro.aprovStatus);
    return !!n && n.includes('inapto');
  }


  public isAgendado(c: PreCadastroList): boolean {
    const ag: any = (c as any)?.agendamento;
    const temNovo = ag?.dataHora || ag?.status;
    const temLegado =
      (c as any).agendado === true ||
      !!(ag?.data || (c as any).agendamentoEm || (c as any).agendaData) ||
      !!(ag?.hora || (c as any).agendaHora) ||
      !!(ag?.status || (c as any).agendamentoStatus);
    return !!(temNovo || temLegado);
  }
  public getAgendaDateTime(c: PreCadastroList): Date | null {
    const ag: any = (c as any)?.agendamento;
    if (ag?.dataHora) return this.asDateFlexible(ag.dataHora);
    const dataBruta = ag?.data ?? (c as any).agendamentoEm ?? (c as any).agendaData ?? null;
    const d = this.asDateFlexible(dataBruta);
    if (!d) return null;
    const horaStr = ag?.hora ?? (c as any).agendaHora ?? null;
    if (typeof horaStr === 'string' && /^\d{1,2}:\d{2}$/.test(horaStr)) {
      const [h, m] = horaStr.split(':').map(Number);
      d.setHours(Math.min(23, Math.max(0, h || 0)), Math.min(59, Math.max(0, m || 0)), 0, 0);
    }
    return d;
  }
  public getAgendaStatus(c: PreCadastroList): string {
    const ag: any = (c as any)?.agendamento;
    return (ag?.status ?? (c as any).agendamentoStatus ?? '').toString().trim();
  }
  public getAgendamentoResumo(c: PreCadastroList): string {
    if (!this.isAgendado(c)) return '—';
    const dt = this.getAgendaDateTime(c);
    const status = this.getAgendaStatus(c);
    if (dt) {
      const data = this.toBRDate(dt);
      const hora = this.toBRTimeFromDate(dt);
      return [[data, hora].filter(Boolean).join(' '), status].filter(Boolean).join(' · ');
    }
    return ['Agendado', status].filter(Boolean).join(' · ');
  }

  // =================== Combos / filtros locais ===================
  private uniqSorted(arr: string[]): string[] {
    return Array.from(new Set(arr.filter(x => !!x && x !== '—')))
      .sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));
  }

  private recalcularOpcoesDinamicas() {
    this.origensDisponiveis = this.uniqSorted(this.presAll.map(c => this.getOrigem(c)));
    this.bairrosDisponiveis = this.uniqSorted(this.presAll.map(c => this.getBairro(c)));
    this.cidadesDisponiveis = this.uniqSorted(this.presAll.map(c => this.getCidade(c)));
    this.ufsDisponiveis = this.uniqSorted(this.presAll.map(c => this.getUF(c)));
    this.assessoresDisponiveis = this.uniqSorted(this.presAll.map(c => this.getAssessorNome(c)).filter(a => a !== '(sem assessor)'));
    this.agStatusDisponiveis = this.uniqSorted(this.presAll.map(c => this.getAgendaStatus(c)));

    // Distribuídos para — usando o resolvedor (pega nomes por UID também)
    this.distribuicoesDisponiveis = this.uniqSorted(
      this.presAll.flatMap(c => this.getDistribuidosPara(c))
    );

    const vistos = new Set(['Apto', 'Inapto', 'Pendente']);
    this.presAll.forEach(c => {
      const rotulo = this.getAprovacaoStatus(c);
      if (rotulo && rotulo !== '—') vistos.add(rotulo);
    });
    this.aprovStatusDisponiveis = Array.from(vistos)
      .sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));
  }

  onFiltroNomeChange(v: string) { this.filtro.nome = v; this.aplicarFiltrosLocais(); }
  onAprovacaoChange() {
    // se não estiver filtrando por INAPTO, limpa checkboxes de motivo
    if (!this.aprovFiltroEhInapto) {
      this.filtro.aprovInaptoObs = { serasa: false, cadin: false, scr: false };
    }
    this.aplicarFiltrosLocais(true);
  }

  aplicarFiltrosLocais(_resetPagina = false) {
    const nl = this.normalize(this.filtro.nome);
    let arr = [...this.presAll];

    if (nl) arr = arr.filter(c => this.normalize(this.displayName(c.nomeCompleto || '')).includes(nl));

    if (this.filtro.agendado !== 'todos') {
      const want = this.filtro.agendado === 'sim';
      arr = arr.filter(c => this.isAgendado(c) === want);
    }

    if (this.filtro.origem) arr = arr.filter(c => this.normalize(this.getOrigem(c)) === this.normalize(this.filtro.origem));
    if (this.filtro.bairro) arr = arr.filter(c => this.normalize(this.getBairro(c)) === this.normalize(this.filtro.bairro));
    if (this.filtro.cidade) arr = arr.filter(c => this.normalize(this.getCidade(c)) === this.normalize(this.filtro.cidade));
    if (this.filtro.uf) arr = arr.filter(c => this.getUF(c).toUpperCase() === this.filtro.uf.toUpperCase());
    if (this.filtro.assessor) arr = arr.filter(c => this.normalize(this.getAssessorNome(c)) === this.normalize(this.filtro.assessor));
    if (this.filtro.agStatus) arr = arr.filter(c => this.normalize(this.getAgendaStatus(c)) === this.normalize(this.filtro.agStatus));

    if (this.filtro.aprovStatus) {
      const n = this.normalize(this.filtro.aprovStatus);
      const alvo =
        n.includes('inapto') ? 'inapto' :
          n.includes('apto') ? 'apto' :
            'pendente';
      arr = arr.filter(c => this.getAprovacaoCode(c) === alvo);
    }

    if (this.filtro.aprovStatus) {
      const n = this.normalize(this.filtro.aprovStatus);
      const alvo =
        n.includes('inapto') ? 'inapto' :
          n.includes('apto') ? 'apto' :
            'pendente';
      arr = arr.filter(c => this.getAprovacaoCode(c) === alvo);
    }

    // ✅ NOVA VERSÃO: combinação EXATA de motivos selecionados
    if (this.aprovFiltroEhInapto) {
      const motivosSelecionados: AprovMotivo[] = [];
      if (this.filtro.aprovInaptoObs.serasa) motivosSelecionados.push('SERASA');
      if (this.filtro.aprovInaptoObs.cadin) motivosSelecionados.push('CADIN');
      if (this.filtro.aprovInaptoObs.scr) motivosSelecionados.push('SCR');

      if (motivosSelecionados.length) {
        arr = arr.filter(c => {
          const motivos = this.parseAprovMotivos(c); // ex: ['SERASA', 'SCR']

          // 1) mesma quantidade de motivos que o selecionado
          if (motivos.length !== motivosSelecionados.length) return false;

          // 2) todos os selecionados estão presentes no doc
          const setDoc = new Set(motivos);
          return motivosSelecionados.every(m => setDoc.has(m));
        });
      }
    }




    // Filtro por "Distribuído para"
    if (this.filtro.distribuidoPara) {
      const alvo = this.normalize(this.filtro.distribuidoPara);
      arr = arr.filter(c =>
        this.getDistribuidosPara(c).some(n => this.normalize(n) === alvo)
      );
    }

    if (this.filtro.agDataDe || this.filtro.agDataAte) {
      const d0 = this.filtro.agDataDe ? new Date(this.filtro.agDataDe + 'T00:00:00') : null;
      const d1 = this.filtro.agDataAte ? new Date(this.filtro.agDataAte + 'T23:59:59.999') : null;
      arr = arr.filter(c => {
        const d = this.getAgendaDateTime(c);
        if (!d) return false;
        if (d0 && d < d0) return false;
        if (d1 && d > d1) return false;
        return true;
      });
    }

    if (this.filtro.dataDe || this.filtro.dataAte) {
      const c0 = this.filtro.dataDe ? new Date(this.filtro.dataDe + 'T00:00:00') : null;
      const c1 = this.filtro.dataAte ? new Date(this.filtro.dataAte + 'T23:59:59.999') : null;
      arr = arr.filter(c => {
        const d = this.asDateFlexible(c.createdAt);
        if (!d) return false;
        if (c0 && d < c0) return false;
        if (c1 && d > c1) return false;
        return true;
      });
    }

    // Ordena e aplica
    this.presFiltrados = this.ordenarArray(arr, this.sortField, this.sortDir);
  }

  ordenarPor(campo: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro') {
    if (this.sortField === campo) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = campo; this.sortDir = 'asc'; }
    this.presFiltrados = this.ordenarArray(this.presFiltrados, this.sortField, this.sortDir);
  }

  private ordenarArray(arr: PreCadastroList[], campo: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro', dir: SortDir): PreCadastroList[] {
    const mult = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va: any, vb: any;
      if (campo === 'createdAt') { va = this.asDateFlexible(a.createdAt)?.getTime() ?? 0; vb = this.asDateFlexible(b.createdAt)?.getTime() ?? 0; }
      else if (campo === 'assessorNome') { va = this.normalize(this.getAssessorNome(a)); vb = this.normalize(this.getAssessorNome(b)); }
      else if (campo === 'bairro') { va = this.normalize(this.getBairro(a)); vb = this.normalize(this.getBairro(b)); }
      else { va = this.normalize(this.displayName(a.nomeCompleto || '')); vb = this.normalize(this.displayName(b.nomeCompleto || '')); }
      if (va < vb) return -1 * mult; if (va > vb) return 1 * mult; return 0;
    });
  }

  // =================== Editar (modal) ===================
  abrirEdicao(item: PreCadastroList) {
    this.editItem = item;
    this.editModel = {
      nomeCompleto: (item.nomeCompleto || '').toString(),
      cpf: (item.cpf || '').toString(),
      telefone: this.getPhone(item),
      email: (item.email || '').toString(),
      endereco: (item.endereco || (item as any).enderecoCompleto || '').toString(),
      bairro: this.getBairro(item).replace(/^—$/, ''),
      cidade: this.getCidade(item).replace(/^—$/, ''),
      uf: this.getUF(item).replace(/^—$/, ''),
      origem: this.getOrigem(item).replace(/^—$/, ''),
    };
    this.editOpen = true;
  }
  fecharEdicao() {
    this.editOpen = false;
    this.editItem = null;
  }

  private patchLocalItem(path: string, updates: Partial<PreCadastroList>) {
    const idx = this.presAll.findIndex(c => (c._path || `pre_cadastros/${(c as any).id}`) === path);
    if (idx >= 0) {
      this.presAll[idx] = { ...this.presAll[idx], ...updates } as any;
    }
  }

  async salvarEdicao() {
    if (!this.editItem) return;
    this.editSaving = true;

    const path = this.editItem._path || `pre_cadastros/${(this.editItem as any).id}`;
    const ref = doc(db, path);

    const payload = {
      nomeCompleto: (this.editModel.nomeCompleto || '').trim(),
      cpf: (this.editModel.cpf || '').trim(),
      telefone: (this.editModel.telefone || '').trim(),
      email: (this.editModel.email || '').trim(),
      endereco: (this.editModel.endereco || '').trim(),
      bairro: (this.editModel.bairro || '').trim(),
      cidade: (this.editModel.cidade || '').trim(),
      uf: (this.editModel.uf || '').trim().toUpperCase(),
      origem: (this.editModel.origem || '').trim(),
      atualizadoEm: new Date(),
    };

    try {
      await updateDoc(ref, payload);
      this.patchLocalItem(path, payload as any);
      this.recalcularOpcoesDinamicas();
      this.aplicarFiltrosLocais();

      this.fecharEdicao();
      alert('Pré-cadastro atualizado com sucesso!');
    } catch (e) {
      console.error(e);
      alert('Falha ao salvar as alterações.');
    } finally {
      this.editSaving = false;
    }
  }

  // =================== Remover ===================
  async removerPreCadastro(item: PreCadastroList) {
    const ok = window.confirm('Tem certeza que deseja remover este pré-cadastro?'); if (!ok) return;
    try {
      const path = item._path || `pre_cadastros/${(item as any).id}`;
      await deleteDoc(doc(db, path));
      this.presAll = this.presAll.filter(c => (c._path || `pre_cadastros/${(c as any).id}`) !== path);
      this.recalcularOpcoesDinamicas();
      this.aplicarFiltrosLocais();
    } catch (e) {
      console.error(e); alert('Falha ao remover o pré-cadastro.');
    }
  }

  // =================== Relatório (modal + PDF) ===================
  abrirRelatorioModal() {
    const dados = this.presFiltrados;
    this.kpiCarregados = this.presAll.length;
    this.kpiFiltrados = dados.length;
    this.kpiAgendados = dados.filter(c => this.isAgendado(c)).length;
    this.kpiSemAgendamento = this.kpiFiltrados - this.kpiAgendados;

    this.relDetalhes = dados.map(c => {
      const dtAg = this.getAgendaDateTime(c);
      const code = this.getAprovacaoCode(c);
      const obs = code === 'inapto' ? (this.getAprovMotivosTexto(c) || '—') : '—';

      return {
        nome: this.displayName(c.nomeCompleto || '') || '—',
        telefone: this.maskPhone(this.getPhone(c)),
        criado: this.toBRDate(c.createdAt),
        agendado: this.isAgendado(c) ? 'Sim' : 'Não',
        agDataHora: dtAg ? `${this.toBRDate(dtAg)} ${this.toBRTimeFromDate(dtAg)}` : '—',
        agStatus: this.getAgendaStatus(c) || '—',
        aprovStatus: this.getAprovacaoStatus(c),
        aprovObs: obs,                      // 🔽 NOVO
        bairro: this.getBairro(c),
        cidade: this.getCidade(c),
        uf: this.getUF(c),
        origem: this.getOrigem(c),
        distribuidosPara: this.getDistribuidosParaTexto(c),
      };
    });

    const inaptos = dados.filter(c => this.getAprovacaoCode(c) === 'inapto');
    this.kpiInaptoSerasa = inaptos.filter(c => this.hasAprovMotivo(c, 'SERASA')).length;
    this.kpiInaptoCadin = inaptos.filter(c => this.hasAprovMotivo(c, 'CADIN')).length;
    this.kpiInaptoScr = inaptos.filter(c => this.hasAprovMotivo(c, 'SCR')).length;

    this.resumoFiltros = this.montarResumoFiltros();
    this.relatorioGeradoEm = new Date().toLocaleString('pt-BR', { hour12: false });
    this.relatorioAberto = true;
  }
  fecharRelatorioModal() { this.relatorioAberto = false; }

  private montarResumoFiltros(): string {
    const f = this.filtro, p: string[] = [];
    if (f.nome) p.push(`Nome: "${f.nome}"`);
    if (f.dataDe) p.push(`Criado de ${f.dataDe}`); if (f.dataAte) p.push(`até ${f.dataAte}`);
    if (f.agendado !== 'todos') p.push(f.agendado === 'sim' ? 'Somente agendados' : 'Somente não agendados');
    if (f.assessor) p.push(`Assessor: ${f.assessor}`);
    if (f.bairro) p.push(`Bairro: ${f.bairro}`);
    if (f.cidade) p.push(`Cidade: ${f.cidade}`);
    if (f.uf) p.push(`UF: ${f.uf}`);
    if (f.origem) p.push(`Origem: ${f.origem}`);
    if (f.agDataDe) p.push(`Agendamento de ${f.agDataDe}`); if (f.agDataAte) p.push(`até ${f.agDataAte}`);
    if (f.agStatus) p.push(`Status: ${f.agStatus}`);
    if (f.aprovStatus) p.push(`Aprovação: ${f.aprovStatus}`);
    if (f.distribuidoPara) p.push(`Distribuído para: ${f.distribuidoPara}`);
    if (f.aprovStatus) p.push(`Aprovação: ${f.aprovStatus}`);
    if (this.aprovFiltroEhInapto) {
      const motivos: string[] = [];
      if (f.aprovInaptoObs.serasa) motivos.push('SERASA');
      if (f.aprovInaptoObs.cadin) motivos.push('CADIN');
      if (f.aprovInaptoObs.scr) motivos.push('SCR');
      if (motivos.length) p.push(`Motivo Inapto: ${motivos.join(' / ')}`);
    }
    return p.length ? p.join(' · ') : 'Sem filtros específicos';
  }

  gerarRelatorioPDF() {
    const docPdf = new jsPDF('l', 'pt', 'a4');
    const agora = new Date();
    const fmtDataHora = agora.toLocaleString('pt-BR', { hour12: false });

    docPdf.setFont('helvetica', 'bold'); docPdf.setFontSize(16);
    docPdf.text('Relatório de Pré-cadastros – CRENORTE', 40, 40);
    docPdf.setFont('helvetica', 'normal'); docPdf.setFontSize(10);
    docPdf.text(`Gerado em: ${fmtDataHora}`, 40, 58);

    autoTable(docPdf, {
      startY: 80,
      head: [['KPI', 'Valor']],
      body: [
        ['Registros carregados', String(this.kpiCarregados)],
        ['Registros após filtros', String(this.kpiFiltrados)],
        ['Inaptos com SERASA', String(this.kpiInaptoSerasa)],   // 🔽 NOVOS
        ['Inaptos com CADIN', String(this.kpiInaptoCadin)],
        ['Inaptos com SCR', String(this.kpiInaptoScr)],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 132, 73] },
      theme: 'striped',
      margin: { left: 40, right: 40 },
    });

    docPdf.addPage('a4', 'l');
    autoTable(docPdf, {
      startY: 40,
      head: [[
        'Nome', 'Telefone', 'Aprovação', 'Motivo (obs.)',
        'Bairro', 'Cidade', 'UF', 'Origem'
      ]],
      body: this.relDetalhes.map(d => [
        d.nome, d.telefone, d.aprovStatus, d.aprovObs,
        d.bairro, d.cidade, d.uf, d.origem
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [30, 132, 73] },
      theme: 'striped',
      margin: { left: 30, right: 30 },
      didDrawPage: () => {
        docPdf.setFontSize(10);
        docPdf.text('Relatório detalhado', 30, 24);
        // @ts-ignore
        const w = (docPdf.internal.pageSize.getWidth?.() ?? (docPdf.internal.pageSize as any).width);
        docPdf.text(`Página ${docPdf.getNumberOfPages()}`, w - 30, 24, { align: 'right' });
      },
    });

    const nomeArquivo = `relatorio-pre-cadastro-${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}.pdf`;
    docPdf.save(nomeArquivo);
  }

  // Identificador estável para *ngFor (cards/relatórios)
  trackById(index: number, c: PreCadastroList): string | number {
    return c?._path ?? (c as any)?.id ?? index;
  }

}
