import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HeaderComponent } from '../shared/header/header.component';
import { ProducaoService } from '../../services/producao.service';
import { PreCadastro } from '../../models/pre-cadastro.model';
import { Colaborador } from '../../models/colaborador.model';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export type CargoProd = 'assessor' | 'analista' | 'supervisor';

@Component({
  selector: 'app-producao',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent],
  templateUrl: './producao.component.html',
  styleUrls: ['./producao.component.css'],
})
export class ProducaoComponent {
  private service = inject(ProducaoService);

  readonly cargoOptions: { value: CargoProd; label: string }[] = [
    { value: 'assessor', label: 'Assessor' },
    { value: 'analista', label: 'Analista' },
    { value: 'supervisor', label: 'Supervisor' },
  ];

  // ===== Bindings de formulário (ngModel) =====
  cargoStr: string = '';
  colaboradorUidStr: string = '';
  dataSelecionadaStr: string = this.hoje();

  // ===== Estado reativo =====
  colaboradores   = signal<Colaborador[]>([]);
  colaboradorSel  = signal<Colaborador | null>(null);
  dados           = signal<PreCadastro[]>([]);
  loadingColab    = signal(false);
  loadingDados    = signal(false);
  msgErro         = signal<string | null>(null);
  jaCarregou      = signal(false);

  // ===== Helpers de data =====
  private hoje(): string {
    return new Date().toISOString().split('T')[0];
  }

  formatarDataExibicao(): string {
    if (!this.dataSelecionadaStr) return '';
    const [y, m, d] = this.dataSelecionadaStr.split('-');
    return `${d}/${m}/${y}`;
  }

  private parseDateLocal(str: string): Date {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // ===== Handlers de filtro =====
  async onCargoChange(cargo: string) {
    this.cargoStr = cargo;
    this.colaboradorUidStr = '';
    this.colaboradorSel.set(null);
    this.colaboradores.set([]);
    this.dados.set([]);
    this.jaCarregou.set(false);
    this.msgErro.set(null);
    if (!cargo) return;

    this.loadingColab.set(true);
    try {
      const lista = await this.service.buscarColaboradoresPorPapel(cargo);
      this.colaboradores.set(lista.sort((a, b) => a.nome.localeCompare(b.nome)));
    } catch (e: any) {
      this.msgErro.set('Erro ao carregar colaboradores: ' + (e?.message || 'Tente novamente.'));
    } finally {
      this.loadingColab.set(false);
    }
  }

  async onColaboradorChange(uid: string) {
    this.colaboradorUidStr = uid;
    const colab = this.colaboradores().find(c => c.uid === uid || (c as any).id === uid) ?? null;
    this.colaboradorSel.set(colab);
    this.dados.set([]);
    this.jaCarregou.set(false);
    if (colab) await this.buscarDados();
  }

  async onDataChange() {
    if (this.colaboradorSel()) await this.buscarDados();
  }

  resetarData() {
    this.dataSelecionadaStr = this.hoje();
    this.onDataChange();
  }

  // ===== Busca principal =====
  async buscarDados() {
    const cargo = this.cargoStr as CargoProd;
    const colab = this.colaboradorSel();
    if (!cargo || !colab || !this.dataSelecionadaStr) return;

    this.loadingDados.set(true);
    this.msgErro.set(null);
    this.dados.set([]);

    try {
      const uid = colab.uid || (colab as any).id;
      const date = this.parseDateLocal(this.dataSelecionadaStr);

      let result: PreCadastro[];
      if (cargo === 'assessor') {
        result = await this.service.buscarProducaoAssessor(uid, date);
      } else if (cargo === 'analista') {
        result = await this.service.buscarProducaoAnalista(uid, date);
      } else {
        result = await this.service.buscarProducaoSupervisor(uid, date);
      }

      this.dados.set(result);
      this.jaCarregou.set(true);
    } catch (e: any) {
      this.msgErro.set('Erro ao buscar dados: ' + (e?.message || 'Tente novamente.'));
    } finally {
      this.loadingDados.set(false);
    }
  }

  // ===== Cards de resumo =====
  get totalRegistros(): number { return this.dados().length; }
  get totalAptos(): number {
    return this.dados().filter(d => d.aprovacao?.status === 'apto').length;
  }
  get totalInaptos(): number {
    return this.dados().filter(d => d.aprovacao?.status === 'inapto').length;
  }

  // ===== Formatadores de célula =====
  formatarHorario(ts: any): string {
    if (!ts) return '—';
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  }

  getHorarioPrincipal(item: PreCadastro): string {
    if (this.cargoStr === 'analista') return this.formatarHorario(item.aprovacao?.em);
    return this.formatarHorario((item as any).createdAt);
  }

  getResultado(item: PreCadastro): string {
    if (item.aprovacao?.status === 'apto') return 'Apto';
    if (item.aprovacao?.status === 'inapto') return 'Inapto';
    return 'Não verificado';
  }

  getBadgeClasse(item: PreCadastro): string {
    if (item.aprovacao?.status === 'apto') return 'badge bg-success';
    if (item.aprovacao?.status === 'inapto') return 'badge bg-danger';
    return 'badge bg-secondary';
  }

  getAssessorResponsavel(item: PreCadastro): string {
    return (item as any).createdByNome || '—';
  }

  // ===== Exportação =====
  private nomeArquivo(ext: string): string {
    const cargo = this.cargoStr || 'cargo';
    const nome = (this.colaboradorSel()?.nome || 'colaborador')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_');
    return `producao_${cargo}_${nome}_${this.dataSelecionadaStr}.${ext}`;
  }

  private getCabecalhos(): string[] {
    const base = ['Nome do Cliente', 'CPF', 'Telefone', 'Município'];
    if (this.cargoStr === 'assessor') return [...base, 'Status', 'Horário'];
    if (this.cargoStr === 'analista') return [...base, 'Cadastrado por', 'Resultado', 'Horário da Análise'];
    return [...base, 'Assessor Responsável', 'Horário de Encaminhamento'];
  }

  private getLinhas(): string[][] {
    return this.dados().map(item => {
      const base = [
        item.nomeCompleto || '—',
        item.cpf || '—',
        item.telefone || '—',
        item.cidade || item.bairro || '—',
      ];
      if (this.cargoStr === 'assessor')
        return [...base, this.getResultado(item), this.getHorarioPrincipal(item)];
      if (this.cargoStr === 'analista')
        return [...base, item.createdByNome || '—', this.getResultado(item), this.getHorarioPrincipal(item)];
      return [...base, this.getAssessorResponsavel(item), this.getHorarioPrincipal(item)];
    });
  }

  exportarPDF() {
    const doc = new jsPDF();
    const colab = this.colaboradorSel();
    const cargoLabel = this.cargoOptions.find(c => c.value === this.cargoStr)?.label ?? this.cargoStr;
    const agora = new Date().toLocaleString('pt-BR');

    // Cabeçalho do documento
    doc.setFontSize(20);
    doc.setTextColor(0, 141, 69);
    doc.text('CRENORTE', 14, 18);

    doc.setFontSize(13);
    doc.setTextColor(40, 40, 40);
    doc.text(`Relatório de Produção — ${cargoLabel}`, 14, 27);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Colaborador: ${colab?.nome || '—'}`, 14, 35);
    doc.text(`Data: ${this.formatarDataExibicao()}`, 14, 41);

    autoTable(doc, {
      head: [this.getCabecalhos()],
      body: this.getLinhas(),
      startY: 48,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      margin: { left: 14, right: 14 },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      `Total de registros: ${this.dados().length}  |  Gerado em: ${agora}`,
      14,
      finalY + 10
    );

    doc.save(this.nomeArquivo('pdf'));
  }

  exportarExcel() {
    const wsData: string[][] = [this.getCabecalhos(), ...this.getLinhas()];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 32 }, { wch: 16 }, { wch: 16 },
      { wch: 20 }, { wch: 20 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produção');
    XLSX.writeFile(wb, this.nomeArquivo('xlsx'));
  }
}
