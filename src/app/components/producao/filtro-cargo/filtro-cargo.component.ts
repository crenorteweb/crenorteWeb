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
    { value: 'geral', label: 'Geral', icon: 'bi-bar-chart-line' },
  ];

  atual: CargoFiltro | null = null;

  selecionar(cargo: CargoFiltro) {
    this.atual = cargo;
    this.cargoSelecionado.emit(cargo);
  }
}
