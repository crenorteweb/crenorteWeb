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
  @Input() dataInicio = '';
  @Input() dataFim = '';
  /** Quando true, usa colunas e nome de arquivo específicos para o relatório de adicionados */
  @Input() modoAdicionados = false;
  /** Nome do analista filtrado em modo geral — quando preenchido, substitui nomeColaborador no PDF */
  @Input() filtroAnalistaNome = '';
  /** Todos os registros do período sem filtro de analista — usado no relatório geral por dia */
  @Input() registrosGeral: PreCadastro[] = [];
  /** Quando true, gera PDF de resumo de encaminhamentos (usa os dados abaixo) */
  @Input() modoEncaminhados = false;
  @Input() encaminhadosPorRemetente: { nome: string; count: number }[] = [];
  @Input() encaminhadosPorAssessor:  { nome: string; count: number }[] = [];
  @Input() totalEncaminhados = 0;

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

  private get periodoLabel(): string {
    return this.dataInicio === this.dataFim
      ? this.dataInicio
      : `${this.dataInicio}_a_${this.dataFim}`;
  }

  private nomeArquivo(ext: string): string {
    const nome = (this.nomeColaborador || 'colaborador')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
    const prefixo = this.modoAdicionados ? 'adicionados' : `producao_${this.cargo}`;
    return `${prefixo}_${nome}_${this.periodoLabel}.${ext}`;
  }

  get registrosAptos(): PreCadastro[] {
    return this.registros.filter(r => r.resultado === 'apto');
  }

  get mostrarBotoesAptos(): boolean {
    return !this.modoAdicionados && (this.cargo === 'analista' || this.cargo === 'geral') && this.registrosAptos.length > 0;
  }

  get registrosElegiveis(): PreCadastro[] {
    return this.registros.filter(r => r.resultado === 'apto' && r.elegivel?.status === 'sim');
  }

  get mostrarBotaoElegiveis(): boolean {
    return !this.modoAdicionados && !this.modoEncaminhados && this.cargo === 'geral' && this.registrosElegiveis.length > 0;
  }

  private getCabecalhos(): string[] {
    const base = ['Nome do Cliente', 'CPF', 'Telefone', 'Município', 'UF', 'Bairro'];
    if (this.modoAdicionados) return base;
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
        r.uf || '—',
        r.bairro || '—',
      ];
      if (this.modoAdicionados)
        return base;
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

  // ── Helpers de data ──────────────────────────────────────────────────────

  private tsToDate(ts: any): Date | null {
    if (!ts) return null;
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  }

  private diaKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private diaLabel(d: Date): string {
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const sem  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()];
    return `${sem}, ${dd}/${mm}/${yyyy}`;
  }

  // ── Exportação ────────────────────────────────────────────────────────────

  private gerarPDF(lista: PreCadastro[], subtitulo = '') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw   = doc.internal.pageSize.getWidth();
    const ph   = doc.internal.pageSize.getHeight();

    const cargoLabel: Record<string, string> = {
      assessor: 'Assessor', analista: 'Analista', supervisor: 'Supervisor', geral: 'Geral (Analistas)',
    };
    const agora = new Date().toLocaleString('pt-BR');

    // ── cabeçalho ──
    doc.setFontSize(18);
    doc.setTextColor(0, 141, 69);
    doc.text('CRENORTE', 14, 18);

    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    const titulo = this.modoAdicionados
      ? `Relatório de Cadastros Adicionados${subtitulo ? ' · ' + subtitulo : ''}`
      : `Relatório de Produção — ${cargoLabel[this.cargo || ''] || ''}${subtitulo ? ' · ' + subtitulo : ''}`;
    doc.text(titulo, 14, 27);

    // nome a exibir: analista filtrado em modo geral tem prioridade sobre nomeColaborador
    const nomeExibido = this.filtroAnalistaNome || this.nomeColaborador;
    const colabLabel: Record<string, string> = {
      assessor: 'Assessor', analista: 'Analista', supervisor: 'Supervisor', geral: 'Analistas',
    };
    const labelCargo = (this.filtroAnalistaNome && this.cargo === 'geral')
      ? 'Analista'
      : (colabLabel[this.cargo || ''] || 'Colaborador');

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`${labelCargo}: ${nomeExibido}`, 14, 35);
    const periodo = this.dataInicio === this.dataFim
      ? this.formatarData(this.dataInicio)
      : `${this.formatarData(this.dataInicio)} a ${this.formatarData(this.dataFim)}`;
    doc.text(`Período: ${periodo}`, 14, 41);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 100, 50);
    doc.text(`Total de CPFs analisados: ${lista.length}`, 14, 47);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);

    const tableOpts = {
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [0, 141, 69] as [number, number, number], textColor: 255 as number, fontStyle: 'bold' as const },
      alternateRowStyles: { fillColor: [240, 249, 240] as [number, number, number] },
      margin: { left: 14, right: 14 },
    };

    // divide por dia quando: analista individual OU geral com analista filtrado, e período > 1 dia
    const temAnalistaEspecifico = this.cargo === 'analista' || !!this.filtroAnalistaNome;
    const dividePorDia = temAnalistaEspecifico && this.dataInicio !== this.dataFim;

    if (dividePorDia) {
      // agrupa por dia usando analisadoEm (fallback encaminhadoEm)
      const grupos = new Map<string, { label: string; ts: number; items: PreCadastro[] }>();

      for (const r of lista) {
        const d = this.tsToDate(r.analisadoEm ?? r.encaminhadoEm);
        if (!d) continue;
        const key = this.diaKey(d);
        if (!grupos.has(key)) grupos.set(key, { label: this.diaLabel(d), ts: d.getTime(), items: [] });
        grupos.get(key)!.items.push(r);
      }

      const diasOrdenados = Array.from(grupos.values()).sort((a, b) => a.ts - b.ts);

      // ── tabela resumo diário ──
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      doc.text('Resumo por dia', 14, 55);
      doc.setFont('helvetica', 'normal');

      autoTable(doc, {
        head: [['Dia', 'Qtd. analisados']],
        body: diasOrdenados.map(({ label, items }) => [label, items.length]),
        startY: 59,
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: [0, 141, 69] as [number, number, number], textColor: 255 as number, fontStyle: 'bold' as const },
        alternateRowStyles: { fillColor: [240, 249, 240] as [number, number, number] },
        columnStyles: { 1: { halign: 'center' as const, cellWidth: 45 } },
        tableWidth: 130,
        margin: { left: 14 },
      });

      let curY = ((doc as any).lastAutoTable?.finalY ?? 80) + 12;

      // ── detalhamento por dia ──
      for (const { label, items } of diasOrdenados) {
        if (curY > ph - 35) {
          doc.addPage();
          curY = 16;
        }

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 100, 50);
        doc.text(`${label}  —  ${items.length} registro${items.length !== 1 ? 's' : ''}`, 14, curY);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(40, 40, 40);

        autoTable(doc, {
          head: [this.getCabecalhos()],
          body: this.getLinhas(items),
          startY: curY + 4,
          ...tableOpts,
        });

        curY = ((doc as any).lastAutoTable?.finalY ?? curY + 20) + 10;
      }

      const lastY = (doc as any).lastAutoTable?.finalY ?? curY;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Gerado em: ${agora}`, 14, lastY + 9);

    } else {
      autoTable(doc, {
        head: [this.getCabecalhos()],
        body: this.getLinhas(lista),
        startY: 53,
        ...tableOpts,
      });

      const finalY = (doc as any).lastAutoTable?.finalY ?? 100;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Gerado em: ${agora}`, 14, finalY + 9);
    }

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

  exportarExcelElegiveis() {
    const lista = this.registrosElegiveis;
    if (!lista.length) return;

    const cabecalhos = ['Nome do Cliente', 'CPF', 'Telefone', 'Município', 'UF', 'Bairro', 'Assessor', 'Analista'];
    const linhas = lista.map(r => [
      r.clienteNome  || '—',
      r.cpf          || '—',
      r.telefone     || '—',
      r.municipio    || '—',
      r.uf           || '—',
      r.bairro       || '—',
      r.assessorNome || '—',
      r.analistaNome || '—',
    ]);

    const wsData = [cabecalhos, ...linhas];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 32 }, { wch: 16 }, { wch: 16 },
      { wch: 20 }, { wch: 6  }, { wch: 22 },
      { wch: 24 }, { wch: 24 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Elegíveis');
    const nome = this.nomeArquivo('xlsx').replace('.xlsx', '_elegiveis.xlsx');
    XLSX.writeFile(wb, nome);
  }

  exportarPDFProducaoGeralPorDia() {
    const lista = this.registrosGeral;
    if (!lista.length) return;

    const doc  = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const ph   = doc.internal.pageSize.getHeight();
    const agora = new Date().toLocaleString('pt-BR');
    const periodo = this.dataInicio === this.dataFim
      ? this.formatarData(this.dataInicio)
      : `${this.formatarData(this.dataInicio)} a ${this.formatarData(this.dataFim)}`;

    // ── cabeçalho da primeira página ──
    doc.setFontSize(18);
    doc.setTextColor(0, 141, 69);
    doc.text('CRENORTE', 14, 18);

    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text('Relatório de Produção — Analistas por Dia', 14, 27);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Período: ${periodo}`, 14, 35);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 100, 50);
    doc.text(`Total de CPFs analisados no período: ${lista.length}`, 14, 41);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);

    // ── gera todos os dias do período (inclusive os sem registros) ──
    const todosDias: { key: string; label: string; ts: number }[] = [];
    {
      const [yi, mi, di] = this.dataInicio.split('-').map(Number);
      const [yf, mf, df] = this.dataFim.split('-').map(Number);
      const cursor = new Date(yi, mi - 1, di, 12, 0, 0);
      const fim    = new Date(yf, mf - 1, df, 12, 0, 0);
      const sem    = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      while (cursor <= fim) {
        const key   = this.diaKey(cursor);
        const label = `${sem[cursor.getDay()]}  ${String(cursor.getDate()).padStart(2,'0')}/${String(cursor.getMonth()+1).padStart(2,'0')}/${cursor.getFullYear()}`;
        todosDias.push({ key, label, ts: cursor.getTime() });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // ── agrupa por analista → dia ──
    const analistasMap = new Map<string, string>();      // id → nome
    const matrix       = new Map<string, Map<string, number>>(); // analistaId → (diaKey → count)

    for (const r of lista) {
      const d = this.tsToDate(r.analisadoEm);
      if (!d) continue;

      const dKey  = this.diaKey(d);
      const aId   = r.analistaId   || 'sem_analista';
      const aNome = r.analistaNome || 'Sem analista';
      if (!analistasMap.has(aId)) analistasMap.set(aId, aNome);

      if (!matrix.has(aId)) matrix.set(aId, new Map());
      const rowMap = matrix.get(aId)!;
      rowMap.set(dKey, (rowMap.get(dKey) ?? 0) + 1);
    }

    const analistasOrdenados = Array.from(analistasMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));

    let curY = 49;

    const tableOpts = {
      styles:             { fontSize: 9, cellPadding: 2.5 },
      headStyles:         { fillColor: [0, 141, 69] as [number, number, number], textColor: 255 as number, fontStyle: 'bold' as const },
      alternateRowStyles: { fillColor: [240, 249, 240] as [number, number, number] },
      tableWidth:         110,
      margin:             { left: 14 },
    };

    for (const [aId, aNome] of analistasOrdenados) {
      const rowMap = matrix.get(aId) ?? new Map<string, number>();
      // usa todosDias para garantir que dias com 0 apareçam
      const dias = todosDias.map(d => ({ label: d.label, count: rowMap.get(d.key) ?? 0 }));
      const total = dias.reduce((s, d) => s + d.count, 0);

      // quebra de página se necessário
      const alturaBloco = 10 + dias.length * 7 + 14; // estimativa
      if (curY + alturaBloco > ph - 15) {
        doc.addPage();
        curY = 16;
      }

      // nome do analista
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 100, 50);
      doc.text(aNome, 14, curY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);

      // tabela dos dias
      const body: (string | number)[][] = dias.map(d => [d.label, d.count]);
      body.push(['Total', total]);

      autoTable(doc, {
        head: [['Dia', 'Qtd. analisados']],
        body,
        startY: curY + 4,
        ...tableOpts,
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 40, halign: 'center' as const },
        },
        didParseCell: (data: any) => {
          if (data.row.index === body.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [220, 245, 220];
          }
        },
      });

      curY = ((doc as any).lastAutoTable?.finalY ?? curY + 30) + 10;
    }

    const finalY = (doc as any).lastAutoTable?.finalY ?? curY;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Gerado em: ${agora}`, 14, finalY + 9);

    const periodo_safe = this.periodoLabel.replace(/\//g, '-');
    doc.save(`producao_analistas_por_dia_${periodo_safe}.pdf`);
  }

  exportarPDFEncaminhados() {
    const doc = new jsPDF();
    const agora = new Date().toLocaleString('pt-BR');
    const periodo = this.dataInicio === this.dataFim
      ? this.formatarData(this.dataInicio)
      : `${this.formatarData(this.dataInicio)} a ${this.formatarData(this.dataFim)}`;

    doc.setFontSize(18);
    doc.setTextColor(0, 141, 69);
    doc.text('CRENORTE', 14, 18);

    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text('Relatório de Encaminhamentos', 14, 27);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Período: ${periodo}`, 14, 35);
    doc.text(`Total encaminhados: ${this.totalEncaminhados}`, 14, 41);

    // Tabela: por quem encaminhou
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text('Por quem encaminhou', 14, 51);

    autoTable(doc, {
      head: [['Colaborador', 'Qtd.']],
      body: this.encaminhadosPorRemetente.map(i => [i.nome, i.count]),
      startY: 55,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      columnStyles: { 1: { halign: 'center', cellWidth: 30 } },
      margin: { left: 14, right: 14 },
    });

    const y1 = (doc as any).lastAutoTable?.finalY ?? 80;

    // Tabela: para qual assessor
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text('Para qual assessor', 14, y1 + 12);

    autoTable(doc, {
      head: [['Assessor', 'Qtd.']],
      body: this.encaminhadosPorAssessor.map(i => [i.nome, i.count]),
      startY: y1 + 16,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [0, 141, 69], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 240] },
      columnStyles: { 1: { halign: 'center', cellWidth: 30 } },
      margin: { left: 14, right: 14 },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 120;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Gerado em: ${agora}`, 14, finalY + 9);

    const nome = (this.nomeColaborador || 'geral')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
    doc.save(`encaminhamentos_${nome}_${this.periodoLabel}.pdf`);
  }
}
