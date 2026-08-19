import {
  Component, EventEmitter, Input, OnChanges,
  Output, SimpleChanges, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CargoFiltro, Colaborador } from '../../../models/producao.model';
import { ColaboradoresService } from '../../../services/colaboradores.service';

@Component({
  selector: 'app-filtro-colaborador',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './filtro-colaborador.component.html',
})
export class FiltroColaborador implements OnChanges {
  @Input() cargo: CargoFiltro | null = null;
  @Output() colaboradorSelecionado = new EventEmitter<Colaborador>();

  private svc = inject(ColaboradoresService);

  lista        = signal<Colaborador[]>([]);
  carregando   = signal(false);
  erro         = signal<string | null>(null);
  uidSelecionado = '';

  ngOnChanges(changes: SimpleChanges) {
    if (changes['cargo']) {
      this.uidSelecionado = '';
      this.lista.set([]);
      this.erro.set(null);
      if (this.cargo) this.carregar(this.cargo);
    }
  }

  private carregar(cargo: CargoFiltro) {
    this.carregando.set(true);
    this.svc.buscarPorCargo(cargo).subscribe({
      next: lista => {
        this.lista.set(lista);
        this.carregando.set(false);
      },
      error: (e: any) => {
        this.erro.set('Erro ao carregar colaboradores.');
        this.carregando.set(false);
        console.error(e);
      },
    });
  }

  onChange(uid: string) {
    this.uidSelecionado = uid;
    const colab = this.lista().find(c => (c.uid || c.id) === uid);
    if (colab) this.colaboradorSelecionado.emit(colab);
  }
}
