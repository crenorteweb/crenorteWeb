import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CargoFiltro, PreCadastro } from '../../../models/producao.model';

@Component({
  selector: 'app-cards-resumo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cards-resumo.component.html',
})
export class CardsResumo {
  /** Registros originais do dia (não afetados pela busca por CPF) */
  @Input() registros: PreCadastro[] = [];
  @Input() cargo: CargoFiltro | null = null;

  get total(): number     { return this.registros.length; }
  get aptos(): number     { return this.registros.filter(r => r.resultado === 'apto').length; }
  get inaptos(): number   { return this.registros.filter(r => r.resultado === 'inapto').length; }
  get elegiveis(): number { return this.registros.filter(r => r.elegivel?.status === 'sim').length; }
}
