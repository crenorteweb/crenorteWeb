import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CargoFiltro, PreCadastro } from '../../../models/producao.model';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-botoes-exportacao',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './botoes-exportacao.component.html',
})
export class BotoesExportacao {
  /** Registros visíveis na tabela (já com filtro de busca aplicado) */
  @Input() registros: PreCadastro[] = [];
  @Input() cargo: CargoFiltro | null = null;
  @Input() nomeColaborador = '';
  @Input() data = '';

  // ── Helpers ──────────────────────────────────────────────────────────────

  private formatarHora(ts: any): string {
    if (!ts) return '—';
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  }

  private formatarData(str: string): string {
    if (!str) return str;
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  private nomeArquivo(ext: string): string {
    const nome = (this.nomeColaborador || 'colaborador')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
    return `producao_${this.cargo}_${nome}_${this.data}.${ext}`;
  }

  get registrosAptos(): PreCadastro[] {
    return this.registros.filter(r => r.resultado === 'apto');
  }

  get mostrarBotoesAptos(): boolean {
    return (this.cargo === 'analista' || this.cargo === 'geral') && this.registrosAptos.length > 0;
  }

  private getCabecalhos(): string[] {
    const base = ['Nome do Cliente', 'CPF', 'Telefone', 'Município', 'Bairro'];
    if (this.cargo === 'assessor')   return [...base, 'Status', 'Horário'];
    if (this.cargo === 'analista')   return [...base, 'Cadastrado por', 'Resultado', 'Horário da Análise'];
    if (this.cargo === 'supervisor') return [...base, 'Assessor Responsável', 'Horário'];
    if (this.cargo === 'geral')      return [...base, 'Assessor', 'Analista', 'Resultado', 'Horário da Análise'];
    return base;
  }

  private getLinhas(lista = this.registros): string[][] {
    return lista.map(r => {
      const base = [
        r.clienteNome || '—',
        r.cpf || '—',
        r.telefone || '—',
        r.municipio || '—',
        r.bairro || '—',
      ];
      if (this.cargo === 'assessor')
        return [...base, r.status || '—', this.formatarHora(r.encaminhadoEm)];
      if (this.cargo === 'analista')
        return [...base, r.assessorNome || '—', r.resultado || '—', this.formatarHora(r.analisadoEm)];
      if (this.cargo === 'supervisor')
        return [...base, r.assessorNome || '—', this.formatarHora(r.encaminhadoEm)];
      if (this.cargo === 'geral')
        return [...base, r.assessorNome || '—', r.analistaNome || '—', r.resultado || '—', this.formatarHora(r.analisadoEm)];
      return base;
    });
  }

  // ── Exportação ────────────────────────────────────────────────────────────

  private gerarPDF(lista: PreCadastro[], subtitulo = '') {
    const doc = new jsPDF();
    const cargoLabel: Record<string, string> = {
      assessor: 'Assessor', analista: 'Analista', supervisor: 'Supervisor', geral: 'Geral (Analistas)',
    };
    const agora = new Date().toLocaleString('pt-BR');

    doc.setFontSize(18);
    doc.setTextColor(0, 141, 69);
    doc.text('CRENORTE', 14, 18);

    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    const titulo = `Relatório de Produção — ${cargoLabel[this.cargo || ''] || ''}${subtitulo ? ' · ' + subtitulo : ''}`;
    doc.text(titulo, 14, 27);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Colaborador: ${this.nomeColaborador}`, 14, 35);
    doc.text(`Data: ${this.formatarData(this.data)}`, 14, 41);

    autoTable(doc, {
      head: [this.getCabecalhos()],
      body: this.getLinhas(lista),
      startY: 48,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      margin: { left: 14, right: 14 },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Total: ${lista.length} | Gerado em: ${agora}`, 14, finalY + 9);

    doc.save(this.nomeArquivo('pdf'));
  }

  private gerarExcel(lista: PreCadastro[], sufixo = '') {
    const wsData = [this.getCabecalhos(), ...this.getLinhas(lista)];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 32 }, { wch: 16 }, { wch: 16 },
      { wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produção');
    const nome = this.nomeArquivo('xlsx').replace('.xlsx', `${sufixo}.xlsx`);
    XLSX.writeFile(wb, nome);
  }

  exportarPDF()       { this.gerarPDF(this.registros); }
  exportarExcel()     { this.gerarExcel(this.registros); }
  exportarPDFAptos()  { this.gerarPDF(this.registrosAptos, 'Aptos'); }
  exportarExcelAptos(){ this.gerarExcel(this.registrosAptos, '_aptos'); }
}
