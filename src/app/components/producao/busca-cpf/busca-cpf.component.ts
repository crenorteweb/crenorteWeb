import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-busca-cpf',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './busca-cpf.component.html',
})
export class BuscaCpf {
  /** Total de registros originais (sem filtro) */
  @Input() total = 0;
  /** Total após filtro — passado pelo pai */
  @Input() filtrado: number | null = null;

  @Output() termoBusca = new EventEmitter<string>();

  termo = '';

  onInput() {
    this.termoBusca.emit(this.termo);
  }

  limpar() {
    this.termo = '';
    this.termoBusca.emit('');
  }

  get contador(): string {
    const digits = this.termo.replace(/\D/g, '');
    if (digits && this.filtrado !== null) {
      return `${this.filtrado} de ${this.total}`;
    }
    return `${this.total} registro${this.total !== 1 ? 's' : ''}`;
  }

  get buscaAtiva(): boolean {
    return this.termo.replace(/\D/g, '').length > 0;
  }
}
