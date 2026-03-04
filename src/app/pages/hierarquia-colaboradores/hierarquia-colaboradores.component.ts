import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Auth, user } from '@angular/fire/auth';
import { Subscription } from 'rxjs';

import { HeaderComponent } from '../shared/header/header.component';

import { db } from '../../firebase.config';
import {
  collection,
  onSnapshot,
  Unsubscribe,
  doc,
  setDoc
} from 'firebase/firestore';

// Bibliotecas para exportação
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';
type Status = 'ativo' | 'inativo';

export type Colaborador = {
  id: string;
  uid?: string;
  nome: string;
  email: string;
  papel: Papel;
  cargo?: string | null;
  status: Status;
  photoURL?: string | null;
  supervisorId?: string | null;
  analistaId?: string | null;
};

type Equipe = {
  id: string;               // `${supervisorId}__${analistaId || ''}`
  supervisorId: string;
  analistaId: string | null;
  nome: string;
};

type Bucket = {
  analista: Colaborador | null;
  assessores: Colaborador[];
  equipeId: string;
  equipeNome: string;
};

type GrupoSupervisor = {
  supervisor: Colaborador;
  buckets: Bucket[];        // agrupados por analista
  semAnalista: Colaborador[];
};

// ============================
// Pré-cadastros / produção
// ============================
type Formalizacao = {
  em?: any;
  porNome?: string;
  porUid?: string;
  status?: string;
  nomeCompleto?: string;
  origem?: string;
  parcelas?: number | null;
  telefone?: string;
};

type Desistencia = {
  status?: string;
  porUid?: string;
  porNome?: string;
  em?: any;
  observacao?: string | null;
};

type PreCadastroResumo = {
  id: string;
  nome?: string;
  nomeCompleto?: string;
  cpf?: string;
  telefone?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  assessorId?: string | null;
  createdByUid?: string | null;
  createdByNome?: string | null;
  encaminhadoPorUid?: string | null;
  encaminhadoPorNome?: string | null;
  encaminhadoEm?: any;
  formalizacao?: Formalizacao | null;
  desistencia?: Desistencia | null;
  agendamentoStatus?: string;
  agendamentoDataHora?: any;
  observacoes?: string | null;
  origem?: string | null;
  contatoRealizado?: boolean;
  createdAt?: any;
};

type ResumoStats = {
  agendados: number;
  total: number;
  formalizados: number;
  desistencias: number;
};

type CategoriaResumo = 'agendados' | 'total' | 'formalizados' | 'desistencias';

@Component({
  standalone: true,
  selector: 'app-hierarquia-colaboradores',
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './hierarquia-colaboradores.component.html',
  styleUrls: ['./hierarquia-colaboradores.component.css']
})
export class HierarquiaColaboradoresComponent implements OnInit, OnDestroy {
  private unsubColab?: Unsubscribe;
  private unsubEquipes?: Unsubscribe;
  private unsubPreCad?: Unsubscribe;

  private subUser?: Subscription;
  constructor(private auth: Auth) { }

  // estado
  busca = '';
  loading = signal<boolean>(true);
  erro = signal<string | null>(null);

  // usuário atual
  private currentUserUid: string | null = null;
  private currentColab: Colaborador | null = null;

  // edição de nome de time (um por vez)
  editEquipeId: string | null = null;
  editEquipeNome = '';

  // dados
  private todos = signal<Colaborador[]>([]);
  private equipesMap = new Map<string, Equipe>();

  private grupos = signal<GrupoSupervisor[]>([]);
  private bucketsSemSupervisor = signal<Bucket[]>([]);

  // pré-cadastros por assessor
  private prePorAssessor = new Map<string, PreCadastroResumo[]>();

  // ===== Modal de resumo por assessor =====
  showResumoModal = false;
  resumoAssessor: Colaborador | null = null;
  resumoStats: ResumoStats | null = null;

  viewResumoMode: 'cards' | 'lista' = 'cards';
  listaSelecionada: PreCadastroResumo[] = [];
  categoriaSelecionada: CategoriaResumo | null = null;
  categoriaLabelSelecionada = '';

  private listasPorCategoria: Partial<Record<CategoriaResumo, PreCadastroResumo[]>> = {};

  // ===== Lifecycle =====
  ngOnInit(): void {
    // ouvir Auth
    this.subUser = user(this.auth).subscribe(u => {
      this.currentUserUid = u?.uid ?? null;
      // quando o usuário muda, remontamos a árvore com o filtro adequado
      this.montarArvore();
    });

    this.subColaboradores();
    this.subEquipes();
    this.subPreCadastros();
  }

  ngOnDestroy(): void {
    this.unsubColab?.();
    this.unsubEquipes?.();
    this.unsubPreCad?.();
    this.subUser?.unsubscribe();
  }

  private syncCurrentColab(rows: Colaborador[]) {
    if (!this.currentUserUid) {
      this.currentColab = null;
      return;
    }

    this.currentColab =
      rows.find(r => r.uid === this.currentUserUid || r.id === this.currentUserUid) ?? null;
  }

  // ===== Firestore – colaboradores =====
  private subColaboradores() {
    this.loading.set(true);
    this.unsubColab = onSnapshot(collection(db, 'colaboradores'), snap => {
      const rows: Colaborador[] = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r => (r.status ?? 'ativo') === 'ativo');

      this.todos.set(rows);
      // detectar quem é o usuário atual dentro da lista de colaboradores
      this.syncCurrentColab(rows);
      this.montarArvore();
      this.loading.set(false);
    }, err => {
      console.error(err);
      this.erro.set('Falha ao carregar colaboradores.');
      this.loading.set(false);
    });
  }

  private subEquipes() {
    this.unsubEquipes = onSnapshot(collection(db, 'equipes'), snap => {
      this.equipesMap.clear();
      snap.forEach(d => {
        const e = { id: d.id, ...(d.data() as any) } as Equipe;
        this.equipesMap.set(e.id, e);
      });
      // aplicar nomes nos buckets
      this.montarArvore();
    }, err => console.error(err));
  }

  // ===== Firestore – pré-cadastros (produção por assessor) =====
  private subPreCadastros() {
    this.unsubPreCad = onSnapshot(collection(db, 'pre_cadastros'), snap => {
      const map = new Map<string, PreCadastroResumo[]>();

      snap.forEach(d => {
        const data = d.data() as any;

        const formalizacao = (data.formalizacao ?? null) as Formalizacao | null;
        const desistencia = (data.desistencia ?? null) as Desistencia | null;

        const assessorId: string | null =
          data.designadoParaUid ??
          data.designadoPara ??
          data.caixaUid ??
          data.assessorId ??
          data.createdByUid ??
          null;

        if (!assessorId) return;

        const pc: PreCadastroResumo = {
          id: d.id,
          nome: data.nome,
          nomeCompleto: data.nomeCompleto,
          cpf: data.cpf,
          telefone: data.telefone || data.contato || null,
          bairro: data.bairro || null,
          cidade: data.cidade,
          uf: data.uf,
          assessorId,
          createdByUid: data.createdByUid || null,
          createdByNome: data.createdByNome || null,
          encaminhadoPorUid: data.encaminhadoPorUid ?? null,
          encaminhadoPorNome: data.encaminhadoPorNome || data.encaminhamento?.porNome || null,
          encaminhadoEm: data.encaminhadoEm || data.encaminhamento?.em || data.aprovacao?.em || null,
          formalizacao,
          desistencia,
          agendamentoStatus: data.agendamentoStatus || 'nao_agendado',
          agendamentoDataHora: data.agendamentoDataHora || null,
          observacoes: data.observacoes || null,
          origem: data.origem || null,
          contatoRealizado: !!data.contatoRealizado,
          createdAt: data.createdAt || null
        };

        if (!map.has(assessorId)) map.set(assessorId, []);
        map.get(assessorId)!.push(pc);
      });

      this.prePorAssessor = map;
    }, err => {
      console.error('Erro ao carregar pré-cadastros para resumo de produção:', err);
    });
  }

  // ===== Montagem da árvore =====
  public montarArvore(): void {
    const rows = this.todos();
    const me = this.currentColab; // supervisor ou analista logado (se existir)

    const nrm = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // separar papéis
    let analistas = rows.filter(r => r.papel === 'analista')
      .sort((a, b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    let supervisores = rows.filter(r => r.papel === 'supervisor')
      .sort((a, b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    const assessoresBase = rows.filter(r => r.papel === 'assessor');

    // busca só filtra ASSESSORES
    let assessores = this.filtrarBusca(assessoresBase)
      .sort((a, b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    // === FILTRO PELO USUÁRIO LOGADO ===
    // Se for SUPERVISOR: mostra só o card dele
    if (me?.papel === 'supervisor') {
      supervisores = supervisores.filter(s => s.id === me.id);
      // 'assessores' não precisa filtrar aqui, pois depois filtramos por supervisorId em cada grupo
    }

    // Se for ANALISTA: mostra só os buckets desse analista
    if (me?.papel === 'analista') {
      analistas = analistas.filter(a => a.id === me.id);
      assessores = assessores.filter(a => (a.analistaId ?? null) === me.id);
    }

    const mapAnalista = new Map(analistas.map(a => [a.id, a]));

    // === grupos por supervisor ===
    let grupos: GrupoSupervisor[] = supervisores.map(s => {
      // assessores deste supervisor (já filtrados pela busca e, se analista, pela analistaId)
      const assDoSup = assessores.filter(a => (a.supervisorId ?? null) === s.id);

      // agrupar por analista
      const mapBuckets = new Map<string, Colaborador[]>();
      const semAnalista: Colaborador[] = [];

      for (const a of assDoSup) {
        const aid = a.analistaId ?? '';
        if (!aid) { semAnalista.push(a); continue; }
        if (!mapBuckets.has(aid)) mapBuckets.set(aid, []);
        mapBuckets.get(aid)!.push(a);
      }

      const buckets: Bucket[] = Array.from(mapBuckets.entries())
        .map(([aid, list]) => {
          const analista = mapAnalista.get(aid) ?? null;
          const equipeId = this.equipeId(s.id, aid);
          const equipeNome = this.equipesMap.get(equipeId)?.nome ?? '';
          return {
            analista,
            assessores: list.sort((x, y) => nrm(x.nome).localeCompare(nrm(y.nome))),
            equipeId,
            equipeNome
          };
        })
        .sort((b1, b2) =>
          nrm(b1.analista?.nome || 'Sem analista')
            .localeCompare(nrm(b2.analista?.nome || 'Sem analista'))
        );

      return {
        supervisor: s,
        buckets,
        // se usuário é analista, 'semAnalista' já cai pra 0 porque filtramos assessores por analistaId lá em cima
        semAnalista: semAnalista.sort((x, y) => nrm(x.nome).localeCompare(nrm(y.nome)))
      };
    });

    // Remove supervisores que ficaram totalmente vazios para o analista/supervisor
    grupos = grupos.filter(g => g.buckets.length || g.semAnalista.length);

    // === Assessores sem supervisor (global), agrupados por analista ===
    let assSemSup = assessores.filter(a => !a.supervisorId);

    // Se for supervisor, não faz sentido mostrar card "sem supervisor" (não é time dele)
    if (me?.papel === 'supervisor') {
      assSemSup = [];
    }

    const mapSemSup = new Map<string, Colaborador[]>();
    for (const a of assSemSup) {
      const aid = a.analistaId ?? '';
      if (!mapSemSup.has(aid)) mapSemSup.set(aid, []);
      mapSemSup.get(aid)!.push(a);
    }

    const semSupervisor: Bucket[] = Array.from(mapSemSup.entries())
      .map(([aid, list]) => {
        const analista = aid ? (mapAnalista.get(aid) ?? null) : null;
        return {
          analista,
          assessores: list.sort((x, y) => nrm(x.nome).localeCompare(nrm(y.nome))),
          equipeId: this.equipeId('', aid),
          equipeNome: ''
        };
      })
      .sort((b1, b2) =>
        nrm(b1.analista?.nome || 'Sem analista')
          .localeCompare(nrm(b2.analista?.nome || 'Sem analista'))
      );

    this.grupos.set(grupos);
    this.bucketsSemSupervisor.set(semSupervisor);
  }

  public onBuscaChange() {
    this.montarArvore();
  }

  public nomeCurto(nome: string | undefined | null): string {
    const n = (nome || '').trim();
    if (!n) return '';
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

  public cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  // ===== Compat/Selectors pro template =====
  public porSupervisor(): GrupoSupervisor[] { return this.grupos(); }
  public semSupervisor(): Bucket[] { return this.bucketsSemSupervisor(); }

  // ===== Resumo do time visível =====
  public resumoSupervisores(): number {
    return this.grupos().length;
  }

  public resumoAnalistas(): number {
    const ids = new Set<string>();
    for (const g of this.grupos()) {
      for (const b of g.buckets) {
        if (b.analista?.id) {
          ids.add(b.analista.id);
        }
      }
    }
    for (const b of this.bucketsSemSupervisor()) {
      if (b.analista?.id) {
        ids.add(b.analista.id);
      }
    }
    return ids.size;
  }

  public resumoAssessores(): number {
    let tot = 0;
    for (const g of this.grupos()) {
      for (const b of g.buckets) tot += b.assessores.length;
      tot += g.semAnalista.length;
    }
    for (const b of this.bucketsSemSupervisor()) {
      tot += b.assessores.length;
    }
    return tot;
  }

  public totalAssessoresDoGrupo(g: GrupoSupervisor): number {
    let tot = g.semAnalista.length;
    for (const b of g.buckets) tot += b.assessores.length;
    return tot;
  }

  public totalAssessoresSemSup(): number {
    let tot = 0;
    for (const b of this.bucketsSemSupervisor()) tot += b.assessores.length;
    return tot;
  }

  // ===== Nome do time (equipe) =====
  private equipeId(supervisorId: string, analistaId: string): string {
    return `${supervisorId || 'nosup'}__${analistaId || ''}`;
  }

  public startEditEquipe(b: Bucket, supId: string) {
    this.editEquipeId = b.equipeId;
    this.editEquipeNome = b.equipeNome || '';
  }

  public cancelEditEquipe() {
    this.editEquipeId = null;
    this.editEquipeNome = '';
  }

  public async salvarEquipeNome(b: Bucket, supId: string) {
    const nome = (this.editEquipeNome || '').trim();
    const [supervisorId, analistaIdRaw] = b.equipeId.split('__');
    const analistaId = analistaIdRaw || null;

    try {
      await setDoc(doc(db, 'equipes', b.equipeId), {
        id: b.equipeId,
        supervisorId: supervisorId === 'nosup' ? '' : supervisorId,
        analistaId,
        nome
      }, { merge: true });

      // refletir na UI imediatamente
      this.equipesMap.set(b.equipeId, {
        id: b.equipeId,
        supervisorId: supervisorId === 'nosup' ? '' : supervisorId,
        analistaId,
        nome
      });
      this.montarArvore();
      this.cancelEditEquipe();
    } catch (e) {
      console.error(e);
      this.erro.set('Falha ao salvar o nome do time.');
    }
  }

  // ===== Helpers =====
  private filtrarBusca(items: Colaborador[]): Colaborador[] {
    const term = (this.busca || '').trim().toLowerCase();
    if (!term) return items;
    return items.filter(c => {
      const blob = `${c.nome} ${c.email}`.toLowerCase();
      return blob.includes(term);
    });
  }

  // ===== Modal de resumo por assessor =====
  public abrirResumoAssessor(a: Colaborador) {
    this.resumoAssessor = a;

    // tenta por id do doc, se não achar tenta por uid
    const listaRaw =
      this.prePorAssessor.get(a.id) ||
      (a.uid ? this.prePorAssessor.get(a.uid) : null) ||
      [];

    // Ordenar: Mais recentes primeiro
    const lista = [...listaRaw].sort((x, y) => {
      const t1 = x.createdAt?.toMillis ? x.createdAt.toMillis() : (x.createdAt instanceof Date ? x.createdAt.getTime() : 0);
      const t2 = y.createdAt?.toMillis ? y.createdAt.toMillis() : (y.createdAt instanceof Date ? y.createdAt.getTime() : 0);
      return t2 - t1;
    });

    this.montarResumoAssessor(lista);
    this.viewResumoMode = 'cards';
    this.categoriaSelecionada = null;
    this.categoriaLabelSelecionada = '';
    this.showResumoModal = true;
  }

  public fecharResumoModal() {
    this.showResumoModal = false;
    this.resumoAssessor = null;
    this.resumoStats = null;
    this.listaSelecionada = [];
    this.viewResumoMode = 'cards';
    this.categoriaSelecionada = null;
    this.categoriaLabelSelecionada = '';
  }

  private montarResumoAssessor(lista: PreCadastroResumo[]) {
    const agendados = lista.filter(
      p => p.agendamentoStatus === 'agendado' || p.agendamentoStatus === 'visitado'
    );

    const formalizados = lista.filter(
      p => p.formalizacao?.status === 'formalizado'
    );

    const desistencias = lista.filter(
      p => p.desistencia?.status === 'desistiu'
    );

    this.resumoStats = {
      agendados: agendados.length,
      total: lista.length,
      formalizados: formalizados.length,
      desistencias: desistencias.length
    };

    this.listasPorCategoria = {
      agendados,
      total: lista,
      formalizados,
      desistencias
    };

    // visão inicial em cards
    this.listaSelecionada = [];
    this.viewResumoMode = 'cards';
  }

  public abrirDetalheCategoria(cat: CategoriaResumo) {
    this.categoriaSelecionada = cat;
    this.listaSelecionada = this.listasPorCategoria[cat] || [];
    this.categoriaLabelSelecionada = this.labelCategoria(cat);
    this.viewResumoMode = 'lista';
  }

  public voltarParaResumoCards() {
    this.viewResumoMode = 'cards';
    this.categoriaSelecionada = null;
    this.categoriaLabelSelecionada = '';
    this.listaSelecionada = [];
  }

  private labelCategoria(cat: CategoriaResumo): string {
    switch (cat) {
      case 'agendados':
        return 'Agendados';
      case 'total':
        return 'Pré-cadastros totais';
      case 'formalizados':
        return 'Formalizados';
      case 'desistencias':
        return 'Desistências';
      default:
        return '';
    }
  }

  // ============================
  // EXPORTAÇÃO DE RELATÓRIOS
  // ============================

  public exportarParaPDF() {
    if (!this.resumoAssessor || !this.resumoStats) return;

    const pdf = new jsPDF('p', 'pt', 'a4');
    const assessor = this.resumoAssessor;
    const stats = this.resumoStats;
    const dataEmissao = new Date().toLocaleString();

    const isCatView = this.viewResumoMode === 'lista' && !!this.categoriaSelecionada;
    const lista = isCatView ? this.listaSelecionada : (this.listasPorCategoria['total'] || []);
    const tituloRelatorio = isCatView
      ? `Relatório de ${this.categoriaLabelSelecionada}`
      : 'Relatório de Produção do Assessor';
    const sufixoArquivo = isCatView
      ? `${this.categoriaLabelSelecionada.replace(/\s+/g, '_')}_${assessor.nome.replace(/\s+/g, '_')}`
      : `Producao_${assessor.nome.replace(/\s+/g, '_')}`;

    // Cabeçalho
    pdf.setFontSize(18);
    pdf.setTextColor(37, 99, 235);
    pdf.text(tituloRelatorio, 40, 50);

    pdf.setFontSize(10);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Gerado em: ${dataEmissao}`, 40, 70);

    pdf.setFontSize(12);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Assessor: ${assessor.nome}`, 40, 100);
    pdf.text(`E-mail: ${assessor.email}`, 40, 115);

    let startDetalhes = 145;

    if (!isCatView) {
      // Resumo estatístico — apenas na visão geral (cards)
      pdf.setFontSize(14);
      pdf.setTextColor(15, 23, 42);
      pdf.text('Resumo da Carteira', 40, 145);

      const table1 = autoTable(pdf, {
        startY: 155,
        head: [['Categoria', 'Quantidade']],
        body: [
          ['Total de Pré-cadastros', stats.total],
          ['Agendados/Visitados', stats.agendados],
          ['Formalizados (Contratos)', stats.formalizados],
          ['Desistências', stats.desistencias]
        ],
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235] }
      });

      startDetalhes = ((table1 as any)?.lastAutoTable?.finalY ?? (pdf as any).lastAutoTable?.finalY ?? 260) + 30;
    }

    // Título da seção de detalhes
    pdf.setFontSize(14);
    pdf.setTextColor(15, 23, 42);
    const labelDetalhes = isCatView
      ? `${this.categoriaLabelSelecionada} (${lista.length} registro(s))`
      : 'Detalhamento dos Registros';
    pdf.text(labelDetalhes, 40, startDetalhes);

    const bodyRows = lista.map(p => [
      p.nomeCompleto || p.nome || 'Sem nome',
      this.cpfMask(p.cpf),
      p.telefone || '—',
      p.cidade || '—',
      this.formatStatus(p),
      p.createdAt ? new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toLocaleDateString() : '—'
    ]);

    autoTable(pdf, {
      startY: startDetalhes + 10,
      head: [['Nome', 'CPF', 'Telefone', 'Cidade', 'Status', 'Data']],
      body: bodyRows,
      theme: 'striped',
      headStyles: { fillColor: [51, 65, 85] },
      styles: { fontSize: 8 }
    });

    pdf.save(`Relatorio_${sufixoArquivo}.pdf`);
  }

  public exportarParaExcel() {
    if (!this.resumoAssessor) return;

    const isCatView = this.viewResumoMode === 'lista' && !!this.categoriaSelecionada;
    const lista = isCatView ? this.listaSelecionada : (this.listasPorCategoria['total'] || []);
    const nomePlanilha = isCatView ? this.categoriaLabelSelecionada.slice(0, 31) : 'Produção';
    const sufixoArquivo = isCatView
      ? `${this.categoriaLabelSelecionada.replace(/\s+/g, '_')}_${this.resumoAssessor.nome.replace(/\s+/g, '_')}`
      : `Producao_${this.resumoAssessor.nome.replace(/\s+/g, '_')}`;

    const data = lista.map(p => ({
      'Nome': p.nomeCompleto || p.nome || 'Sem nome',
      'CPF': this.cpfMask(p.cpf),
      'Telefone': p.telefone || '—',
      'Bairro': p.bairro || '—',
      'Cidade': p.cidade || '—',
      'UF': p.uf || '—',
      'Status Agendamento': p.agendamentoStatus || '—',
      'Formalizado': p.formalizacao?.status === 'formalizado' ? 'Sim' : 'Não',
      'Desistiu': p.desistencia?.status === 'desistiu' ? 'Sim' : 'Não',
      'Origem': p.origem || '—',
      'Cadastrado Em': p.createdAt ? new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toLocaleString() : '—',
      'Observações': p.observacoes || ''
    }));

    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(data);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nomePlanilha);

    XLSX.writeFile(wb, `Relatorio_${sufixoArquivo}.xlsx`);
  }

  private formatStatus(p: PreCadastroResumo): string {
    if (p.formalizacao?.status === 'formalizado') return 'Formalizado';
    if (p.desistencia?.status === 'desistiu') return 'Desistência';
    if (p.agendamentoStatus === 'visitado') return 'Visitado';
    if (p.agendamentoStatus === 'agendado') return 'Agendado';
    return 'Pendente';
  }
}
