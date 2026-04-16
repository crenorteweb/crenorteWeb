import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PeriodoFiltro } from '../../../models/producao.model';

@Component({
  selector: 'app-filtro-data',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './filtro-data.component.html',
})
export class FiltroData implements OnInit {
  @Output() dataSelecionada = new EventEmitter<PeriodoFiltro>();

  dataInicio = '';
  dataFim = '';

  ngOnInit() {
    this.dataInicio = this.hoje();
    this.dataFim = this.hoje();
    this.emit();
  }

  onInicioChange() {
    if (this.dataFim && this.dataFim < this.dataInicio) {
      this.dataFim = this.dataInicio;
    }
    this.emit();
  }

  onFimChange() {
    if (this.dataInicio && this.dataInicio > this.dataFim) {
      this.dataInicio = this.dataFim;
    }
    this.emit();
  }

  resetar() {
    this.dataInicio = this.hoje();
    this.dataFim = this.hoje();
    this.emit();
  }

  private emit() {
    this.dataSelecionada.emit({ inicio: this.dataInicio, fim: this.dataFim });
  }

  private hoje(): string {
    return new Date().toISOString().split('T')[0];
  }
}
