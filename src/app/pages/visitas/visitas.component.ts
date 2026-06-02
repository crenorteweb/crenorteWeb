import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { HeaderComponent } from '../shared/header/header.component';
import { AuthService } from '../../services/auth.service';
import { PreCadastroService } from '../../services/pre-cadastro.service';
import { Colaborador, Papel } from '../../models/colaborador.model';
import { PreCadastro, ObservacaoPreCadastro } from '../../models/pre-cadastro.model';

import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
} from '@angular/fire/firestore';

import { ModalDetalheCliente } from '../../components/producao/modal-detalhe-cliente/modal-detalhe-cliente.component';

@Component({
  selector: 'app-visitas',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, HeaderComponent, ModalDetalheCliente],
  templateUrl: './visitas.component.html',
  styleUrls: ['./visitas.component.css']
})
export class VisitasComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private preSvc = inject(PreCadastroService);
  private db = inject(Firestore);

  // Perfil logado
  currentUserUid: string | null = null;
  currentUserNome: string | null = null;
  currentUserPapel: string = '';
  private userSub?: Subscription;

  // Coleção de assessores disponíveis para filtrar no seletor
  assessores = signal<Array<{ uid: string; nome: string; rota?: string | null }>>([]);
  assessorSelecionadoUid = signal<string>('');

  // Estados dos dados e carregamentos
  loading = signal(false);
  clientes = signal<PreCadastro[]>([]);
  searchTerm = signal('');
  filtroStatus = signal<'todos' | 'agendado' | 'visitado' | 'nao_agendado' | 'formalizado' | 'desistiu'>('todos');
  
  // Filtros ativos
  filtroDataInicio = signal<string>('');
  filtroDataFim = signal<string>('');

  // Inputs temporários do período
  dataInicioTemp = signal<string>('');
  dataFimTemp = signal<string>('');

  // Modal observações e detalhes
  modalObsAberto = signal(false);
  modalVerAberto = signal(false);
  viewItem = signal<PreCadastro | null>(null);
  mappedViewItem = signal<any>(null);
  obsLista = signal<ObservacaoPreCadastro[]>([]);
  obsCarregando = signal(false);
  novaObsTexto = signal('');

  // Clientes filtrados apenas pelo período de datas (usado para as métricas e como base da tabela)
  clientesDoPeriodo = computed(() => {
    let list = this.clientes();
    const dataInicio = this.filtroDataInicio();
    const dataFim = this.filtroDataFim();

    if (dataInicio || dataFim) {
      list = list.filter(c => {
        const dataRef = this.obterDataReferencia(c);
        if (!dataRef) return false;
        if (dataInicio && dataRef < dataInicio) return false;
        if (dataFim && dataRef > dataFim) return false;
        return true;
      });
    }
    return list;
  });

  // Métricas reativas
  statsTotal = computed(() => this.clientesDoPeriodo().length);
  statsAgendados = computed(() => this.clientesDoPeriodo().filter(c => c.agendamentoStatus === 'agendado').length);
  statsVisitados = computed(() => this.clientesDoPeriodo().filter(c => c.agendamentoStatus === 'visitado').length);
  statsNaoAgendados = computed(() => this.clientesDoPeriodo().filter(c => !c.agendamentoStatus || c.agendamentoStatus === 'nao_agendado').length);
  statsFormalizados = computed(() => this.clientesDoPeriodo().filter(c => c.formalizacao?.status === 'formalizado').length);
  statsDesistentes = computed(() => this.clientesDoPeriodo().filter(c => c.desistencia?.status === 'desistiu').length);
  statsAdicionados = computed(() => this.clientesDoPeriodo().filter(c => c.createdByUid === this.assessorSelecionadoUid()).length);
  statsEncaminhados = computed(() => this.clientesDoPeriodo().filter(c => c.createdByUid !== this.assessorSelecionadoUid()).length);

  // Lista filtrada (tabela)
  clientesFiltrados = computed(() => {
    let list = this.clientesDoPeriodo();
    const search = this.searchTerm().toLowerCase().trim();
    const status = this.filtroStatus();

    // Filtro por texto (Nome/CPF)
    if (search) {
      list = list.filter(c =>
        (c.nomeCompleto || '').toLowerCase().includes(search) ||
        (c.cpf || '').includes(search)
      );
    }

    // Filtro por status
    if (status !== 'todos') {
      if (status === 'nao_agendado') {
        list = list.filter(c => !c.agendamentoStatus || c.agendamentoStatus === 'nao_agendado');
      } else if (status === 'formalizado') {
        list = list.filter(c => c.formalizacao?.status === 'formalizado');
      } else if (status === 'desistiu') {
        list = list.filter(c => c.desistencia?.status === 'desistiu');
      } else {
        list = list.filter(c => c.agendamentoStatus === status);
      }
    }

    return list;
  });

  // Clientes agrupados por data para exibição na tabela
  clientesAgrupados = computed(() => {
    const list = this.clientesFiltrados();
    
    // Agrupa por data
    const grupos: Record<string, PreCadastro[]> = {};
    list.forEach(c => {
      const chave = this.obterDataReferencia(c) || '';
      if (!grupos[chave]) {
        grupos[chave] = [];
      }
      grupos[chave].push(c);
    });

    // Ordena as chaves de data cronologicamente
    const chavesOrdenadas = Object.keys(grupos).sort((a, b) => {
      if (a === '') return 1; // Coloca "sem data" no final
      if (b === '') return -1;
      return a.localeCompare(b);
    });

    return chavesOrdenadas.map(chave => ({
      data: chave,
      titulo: this.formatarDiaSemanaEData(chave),
      itens: grupos[chave]
    }));
  });

  ngOnInit(): void {
    // Configura a semana atual como padrão
    const semana = this.obterSemanaAtual();
    this.dataInicioTemp.set(semana.inicio);
    this.dataFimTemp.set(semana.fim);
    this.filtroDataInicio.set(semana.inicio);
    this.filtroDataFim.set(semana.fim);

    this.userSub = this.authService.perfil$.subscribe(async (p) => {
      if (!p) return;
      this.currentUserUid = p.uid;
      this.currentUserNome = p.nome;
      this.currentUserPapel = p.papel;

      await this.carregarAssessores();
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  // Carrega assessores conforme o perfil logado
  private async carregarAssessores(): Promise<void> {
    try {
      const q = query(
        collection(this.db, 'colaboradores'),
        where('papel', '==', 'assessor'),
        where('status', '==', 'ativo')
      );
      const snap = await getDocs(q);
      const allAssessors = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          uid: d.id,
          nome: data.nome || 'Assessor',
          rota: data.rota || null,
          analistaResponsavelUid: data.analistaResponsavelUid || data.analistaId || null,
          supervisorUid: data.supervisorUid || data.supervisorId || null
        };
      });

      // Filtra conforme hierarquia
      if (this.currentUserPapel === 'admin') {
        this.assessores.set(allAssessors);
      } else if (this.currentUserPapel === 'supervisor') {
        const supervisados = allAssessors.filter(a => a.supervisorUid === this.currentUserUid);
        this.assessores.set(supervisados);
      } else if (this.currentUserPapel === 'analista') {
        const sobAnalise = allAssessors.filter(a => a.analistaResponsavelUid === this.currentUserUid);
        this.assessores.set(sobAnalise);
      } else {
        this.assessores.set([]);
      }

      // Ordena por nome
      this.assessores.update(list => list.sort((a, b) => a.nome.localeCompare(b.nome)));

    } catch (e) {
      console.error('[Visitas] Erro ao carregar assessores:', e);
      this.assessores.set([]);
    }
  }

  // Quando selecionado o assessor, carrega sua carteira
  async onAssessorSelected(uid: string): Promise<void> {
    this.assessorSelecionadoUid.set(uid);
    
    // Reseta filtros ao trocar de assessor
    this.searchTerm.set('');
    this.filtroStatus.set('todos');
    const semana = this.obterSemanaAtual();
    this.dataInicioTemp.set(semana.inicio);
    this.dataFimTemp.set(semana.fim);
    this.filtroDataInicio.set(semana.inicio);
    this.filtroDataFim.set(semana.fim);

    if (!uid) {
      this.clientes.set([]);
      return;
    }

    this.loading.set(true);
    try {
      const carteira = await this.preSvc.listarParaCaixa(uid);
      this.clientes.set(carteira || []);
    } catch (e) {
      console.error('[Visitas] Erro ao carregar carteira:', e);
      this.clientes.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  // ========== Ações do Modal de Observações ==========

  async abrirObservacoes(i: PreCadastro) {
    this.viewItem.set(i);
    this.obsLista.set([]);
    this.novaObsTexto.set('');
    this.modalObsAberto.set(true);
    this.obsCarregando.set(true);

    try {
      let historico = await this.preSvc.listarObservacoes(i.id);

      // Migração sob demanda caso possua comentário antigo
      if (historico.length === 0 && i.observacoes) {
        const usuarioMigracao = {
          uid: i.createdByUid || 'migracao_sistema',
          nome: i.createdByNome || 'Assessor (Origem)'
        };
        const cadastrada = await this.preSvc.adicionarObservacao(
          i.id,
          i.observacoes,
          usuarioMigracao,
          i.createdAt || null
        );
        historico = [cadastrada];
        await this.preSvc.limparObservacaoRaiz(i.id);
        
        // Atualiza em memória local
        i.observacoes = undefined;
        this.clientes.update(list => list.map(x => x.id === i.id ? { ...x, observacoes: undefined } : x));
      }

      this.obsLista.set(historico || []);
    } catch (e) {
      console.error('[Visitas] Erro ao listar/migrar observações:', e);
    } finally {
      this.obsCarregando.set(false);
    }
  }

  async salvarNovaObservacao() {
    const i = this.viewItem();
    const texto = this.novaObsTexto().trim();
    if (!i?.id || !texto) return;

    try {
      const usuario = {
        uid: this.currentUserUid || '',
        nome: `${this.currentUserNome || 'Gestor'} (${this.formatarCargoLabel(this.currentUserPapel)})`
      };

      const cadastrada = await this.preSvc.adicionarObservacao(i.id, texto, usuario);
      this.obsLista.update(lista => [cadastrada, ...lista]);
      this.novaObsTexto.set('');
    } catch (e) {
      console.error('[Visitas] Erro ao salvar comentário:', e);
      alert('Não foi possível salvar o comentário.');
    }
  }

  async deletarObservacao(obsId: string) {
    const i = this.viewItem();
    if (!i?.id || !obsId) return;

    if (!confirm('Deseja realmente excluir este comentário?')) return;

    try {
      await this.preSvc.removerObservacao(i.id, obsId);
      this.obsLista.update(lista => lista.filter(x => x.id !== obsId));
    } catch (e) {
      console.error('[Visitas] Erro ao excluir comentário:', e);
      alert('Não foi possível excluir o comentário.');
    }
  }

  abrirDetalhes(i: PreCadastro) {
    this.viewItem.set(i);
    this.mappedViewItem.set(this.obterPreCadastroParaModal(i));
    this.modalVerAberto.set(true);
  }

  fecharModais() {
    this.modalObsAberto.set(false);
    this.modalVerAberto.set(false);
    this.viewItem.set(null);
    this.mappedViewItem.set(null);
    this.obsLista.set([]);
    this.novaObsTexto.set('');
  }

  // Mapeamentos para exibição na UI
  formalizacaoStatus(i: PreCadastro): string {
    return i.formalizacao?.status || 'nao_formalizado';
  }

  desistenciaStatus(i: PreCadastro): string {
    return i.desistencia?.status || 'nao_desistiu';
  }

  private formatarCargoLabel(cargo: string): string {
    const map: Record<string, string> = {
      admin: 'Admin',
      supervisor: 'Supervisor',
      analista: 'Analista'
    };
    return map[cargo] || 'Gestor';
  }

  aplicarPeriodo() {
    this.filtroDataInicio.set(this.dataInicioTemp());
    this.filtroDataFim.set(this.dataFimTemp());
  }

  limparPeriodo() {
    this.dataInicioTemp.set('');
    this.dataFimTemp.set('');
    this.filtroDataInicio.set('');
    this.filtroDataFim.set('');
  }

  private obterSemanaAtual(): { inicio: string; fim: string } {
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    const diferencaParaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
    
    const dataInicio = new Date(hoje);
    dataInicio.setDate(hoje.getDate() + diferencaParaSegunda);
    
    const dataFim = new Date(dataInicio);
    dataFim.setDate(dataInicio.getDate() + 6);
    
    return {
      inicio: this.formatarDataIso(dataInicio),
      fim: this.formatarDataIso(dataFim)
    };
  }

  private formatarDataIso(d: Date): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  formatarDiaSemanaEData(dateStr: string | null | undefined): string {
    if (!dateStr) return 'Sem agendamento definido';
    
    try {
      const [ano, mes, dia] = dateStr.split('-').map(Number);
      const d = new Date(ano, mes - 1, dia);
      
      const diasSemana = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado'
      ];
      const diaSemana = diasSemana[d.getDay()];
      
      const diaStr = String(dia).padStart(2, '0');
      const mesStr = String(mes).padStart(2, '0');
      
      return `${diaSemana}, ${diaStr}/${mesStr}/${ano}`;
    } catch {
      return dateStr;
    }
  }

  extrairDataDeAgendamento(c: PreCadastro): string | null {
    if (c.agendamentoData) return c.agendamentoData;
    
    const ts = (c as any).agendamentoDataHora;
    if (ts) {
      try {
        const date = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
        if (date && !isNaN(date.getTime())) {
          return this.formatarDataIso(date);
        }
      } catch {}
    }
    return null;
  }

  obterDiaSemana(c: PreCadastro): string {
    const dataStr = this.obterDataReferencia(c);
    if (!dataStr) return '';
    try {
      const [ano, mes, dia] = dataStr.split('-').map(Number);
      const d = new Date(ano, mes - 1, dia);
      const diasSemana = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado'
      ];
      return diasSemana[d.getDay()];
    } catch {
      return '';
    }
  }

  obterDataReferencia(c: PreCadastro): string | null {
    // 1. Agendamento
    const dataAg = this.extrairDataDeAgendamento(c);
    if (dataAg) return dataAg;

    // 2. Criado por assessor
    const assessorUid = this.assessorSelecionadoUid();
    if (c.createdByUid === assessorUid && c.createdAt) {
      const date = this.converterParaData(c.createdAt);
      if (date) return this.formatarDataIso(date);
    }

    // 3. Encaminhamento
    const encEm = c.encaminhamento?.em || (c as any).designadoEm || (c as any).encaminhadoEm;
    if (encEm) {
      const date = this.converterParaData(encEm);
      if (date) return this.formatarDataIso(date);
    }

    // Fallback: createdAt geral
    if (c.createdAt) {
      const date = this.converterParaData(c.createdAt);
      if (date) return this.formatarDataIso(date);
    }

    return null;
  }

  obterEncaminhadoPorNome(c: PreCadastro): string | null {
    return (
      (c as any).encaminhadoPorNome ||
      c.aprovacao?.porNome ||
      (c as any).encaminhamento?.porNome ||
      null
    );
  }

  obterPreCadastroParaModal(c: PreCadastro | null): any {
    if (!c) return null;
    return {
      id: c.id,
      clienteNome: c.nomeCompleto,
      cpf: c.cpf,
      telefone: c.telefone,
      municipio: c.cidade,
      uf: c.uf,
      bairro: c.bairro,
      status: c.agendamentoStatus === 'agendado' ? 'Agendado' : c.agendamentoStatus === 'visitado' ? 'Visitado' : 'Não agendado',
      assessorNome: c.encaminhamento?.assessorNome || c.alocadoParaNome || '—',
      analistaNome: c.aprovacao?.porNome || '—',
      resultado: c.aprovacao?.status === 'apto' ? 'apto' : c.aprovacao?.status === 'inapto' ? 'inapto' : null,
      motivoInapto: c.aprovacao?.motivo || c.aprovacao?.observacao || null,
      contatoRealizado: c.contatoRealizado,
      observacaoAssessor: c.observacoes,
      agendamento: c.agendamentoData ? new Date(c.agendamentoData) : null,
      formalizado: c.formalizacao?.status === 'formalizado',
      criadoEm: c.createdAt,
      encaminhadoEm: c.encaminhamento?.em || (c as any).designadoEm || (c as any).encaminhadoEm || null,
    };
  }

  obterInfoOrigemFicha(c: PreCadastro): string {
    const assessorUid = this.assessorSelecionadoUid();
    
    // 1. Criado pelo assessor
    if (c.createdByUid === assessorUid && c.createdAt) {
      const date = this.converterParaData(c.createdAt);
      if (date) {
        return `Criado em ${date.toLocaleDateString('pt-BR')}`;
      }
    }

    // 2. Encaminhado ao assessor
    const encEm = c.encaminhamento?.em || (c as any).designadoEm || (c as any).encaminhadoEm;
    if (encEm) {
      const date = this.converterParaData(encEm);
      if (date) {
        const porNome = this.obterEncaminhadoPorNome(c);
        return porNome 
          ? `Recebido de ${porNome} em ${date.toLocaleDateString('pt-BR')}`
          : `Recebido em ${date.toLocaleDateString('pt-BR')}`;
      }
    }

    // Fallback createdAt
    if (c.createdAt) {
      const date = this.converterParaData(c.createdAt);
      if (date) {
        return `Criado em ${date.toLocaleDateString('pt-BR')}`;
      }
    }

    return '';
  }

  formatarDataPt(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [ano, mes, dia] = parts;
    return `${dia}/${mes}/${ano}`;
  }

  async exportarRelatorioVisitasPDF() {
    const list = this.clientesDoPeriodo();
    const assessorNome = this.assessores().find(a => a.uid === this.assessorSelecionadoUid())?.nome || 'Assessor';
    
    // Agrupar clientes por data de referência (dia)
    const grupos: Record<string, PreCadastro[]> = {};
    list.forEach(c => {
      const chave = this.obterDataReferencia(c) || 'sem_data';
      if (!grupos[chave]) {
        grupos[chave] = [];
      }
      grupos[chave].push(c);
    });

    // Encontrar todos os dias únicos ordenados
    const diasOrdenados = Object.keys(grupos).sort((a, b) => {
      if (a === 'sem_data') return 1;
      if (b === 'sem_data') return -1;
      return a.localeCompare(b);
    });

    // Determinar a lista de datas
    const dataInicioStr = this.filtroDataInicio();
    const dataFimStr = this.filtroDataFim();
    const datasRelatorio: string[] = [];

    if (dataInicioStr && dataFimStr) {
      try {
        const [yi, mi, di] = dataInicioStr.split('-').map(Number);
        const [yf, mf, df] = dataFimStr.split('-').map(Number);
        const cursor = new Date(yi, mi - 1, di, 12, 0, 0);
        const fim = new Date(yf, mf - 1, df, 12, 0, 0);
        while (cursor <= fim) {
          datasRelatorio.push(this.formatarDataIso(cursor));
          cursor.setDate(cursor.getDate() + 1);
        }
      } catch {
        datasRelatorio.push(...diasOrdenados.filter(d => d !== 'sem_data'));
      }
    } else {
      datasRelatorio.push(...diasOrdenados.filter(d => d !== 'sem_data'));
    }

    if (grupos['sem_data'] && grupos['sem_data'].length > 0) {
      datasRelatorio.push('sem_data');
    }

    const rows = datasRelatorio.map(dia => {
      const itens = grupos[dia] || [];
      
      const propostasEnviadas = itens.filter(c => 
        c.caixaAtual === 'analista' || 
        c.aprovacao?.status === 'apto' || 
        c.aprovacao?.status === 'inapto' || 
        c.formalizacao?.status === 'formalizado' || 
        c.desistencia?.status === 'desistiu'
      ).length;

      const visitasRealizadas = itens.filter(c => c.agendamentoStatus === 'visitado').length;
      
      const propostasFormalizadas = itens.filter(c => c.formalizacao?.status === 'formalizado').length;
      
      const visitasPendentes = itens.filter(c => c.agendamentoStatus === 'agendado').length;

      const meta = 4;
      const percentualMeta = ((visitasRealizadas / meta) * 100).toFixed(0) + '%';
      const relacaoMeta = `${visitasRealizadas} / ${meta} (${percentualMeta})`;

      const dataFormatada = dia === 'sem_data' ? 'Sem data definida' : this.formatarDiaSemanaEData(dia);

      return [
        dataFormatada,
        String(propostasEnviadas),
        String(visitasRealizadas),
        relacaoMeta,
        String(propostasFormalizadas),
        String(visitasPendentes)
      ];
    });

    // Iniciar jsPDF
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const agora = new Date().toLocaleString('pt-BR');
    const periodoLabel = dataInicioStr && dataFimStr
      ? `${this.formatarDataPt(dataInicioStr)} a ${this.formatarDataPt(dataFimStr)}`
      : 'Geral';

    // Cabeçalho do PDF
    doc.setFontSize(18);
    doc.setTextColor(0, 141, 69);
    doc.text('CRENORTE', 14, 18);

    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text(`Relatório Diário de Atividades - Módulo de Visitas`, 14, 27);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Assessor: ${assessorNome}`, 14, 35);
    doc.text(`Período: ${periodoLabel}`, 14, 41);
    doc.text(`Gerado em: ${agora}`, 14, 47);

    // Adiciona tabela usando autoTable
    autoTable(doc, {
      startY: 53,
      head: [['Dia', 'Propostas Enviadas', 'Visitas Realizadas', 'Relação c/ Meta (4/dia)', 'Propostas Formalizadas', 'Visitas Pendentes']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { halign: 'center' },
        2: { halign: 'center' },
        3: { halign: 'center' },
        4: { halign: 'center' },
        5: { halign: 'center' }
      },
      margin: { left: 14, right: 14 }
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 120;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('CRENORTE Web - Sistema de Acompanhamento de Campo', 14, finalY + 9);

    const safeNome = assessorNome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
    doc.save(`relatorio_visitas_${safeNome}_${dataInicioStr || 'geral'}_a_${dataFimStr || 'geral'}.pdf`);
  }

  private converterParaData(ts: any): Date | null {
    if (!ts) return null;
    try {
      if (ts.toDate) return ts.toDate();
      const date = new Date(ts);
      if (!isNaN(date.getTime())) return date;
    } catch {}
    return null;
  }
}
