import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CargoFiltro } from '../../../models/producao.model';

@Component({
  selector: 'app-filtro-cargo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './filtro-cargo.component.html',
})
export class FiltroCargo {
  @Output() cargoSelecionado = new EventEmitter<CargoFiltro>();

  readonly opcoes: { value: CargoFiltro; label: string; icon: string }[] = [
    { value: 'assessor',  label: 'Assessor',  icon: 'bi-person-badge' },
    { value: 'analista',  label: 'Analista',  icon: 'bi-clipboard2-check' },
    { value: 'supervisor', label: 'Supervisor', icon: 'bi-people' },
    { value: 'geral',     label: 'Geral (Analistas)', icon: 'bi-bar-chart-line' },
  ];

  atual: CargoFiltro | null = null;

  selecionar(cargo: CargoFiltro) {
    this.atual = cargo;
    this.cargoSelecionado.emit(cargo);
  }
}
