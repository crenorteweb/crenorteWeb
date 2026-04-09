import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-filtro-data',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './filtro-data.component.html',
})
export class FiltroData implements OnInit {
  @Output() dataSelecionada = new EventEmitter<string>();

  data = '';

  ngOnInit() {
    this.data = this.hoje();
    this.dataSelecionada.emit(this.data);
  }

  onChange() {
    this.dataSelecionada.emit(this.data);
  }

  resetar() {
    this.data = this.hoje();
    this.dataSelecionada.emit(this.data);
  }

  private hoje(): string {
    return new Date().toISOString().split('T')[0];
  }
}
