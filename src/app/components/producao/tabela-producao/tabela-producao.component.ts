import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CargoFiltro, PreCadastro } from '../../../models/producao.model';

@Component({
  selector: 'app-tabela-producao',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tabela-producao.component.html',
})
export class TabelaProducao {
  @Input() registros: PreCadastro[] = [];
  @Input() cargo: CargoFiltro | null = null;
  @Output() clienteClicado = new EventEmitter<PreCadastro>();

  formatarHora(ts: any): string {
    if (!ts) return '—';
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  }

  getResultado(item: PreCadastro): string {
    if (item.resultado === 'apto')   return 'Apto';
    if (item.resultado === 'inapto') return 'Inapto';
    return '—';
  }

  getBadgeClasse(item: PreCadastro): string {
    if (item.resultado === 'apto')   return 'badge bg-success';
    if (item.resultado === 'inapto') return 'badge bg-danger';
    const s = item.status;
    if (s === 'apto')   return 'badge bg-success';
    if (s === 'inapto') return 'badge bg-danger';
    return 'badge bg-secondary';
  }

  getStatusLabel(item: PreCadastro): string {
    if (item.status === 'apto')           return 'Apto';
    if (item.status === 'inapto')         return 'Inapto';
    if (item.status === 'nao_verificado') return 'Não verificado';
    return item.status || '—';
  }
}
