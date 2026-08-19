import {
  Component, EventEmitter, HostListener,
  Input, OnChanges, Output, SimpleChanges, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PreCadastro, Cliente } from '../../../models/producao.model';
import { ClientesService } from '../../../services/clientes.service';

@Component({
  selector: 'app-modal-detalhe-cliente',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './modal-detalhe-cliente.component.html',
  styleUrls: ['./modal-detalhe-cliente.component.css'],
})
export class ModalDetalheCliente implements OnChanges {
  @Input()  preCadastro: PreCadastro | null = null;
  @Output() fechar = new EventEmitter<void>();

  private clientesSvc = inject(ClientesService);

  cliente      = signal<Cliente | null>(null);
  carregando   = signal(false);
  semCadastro  = signal(false);

  @HostListener('document:keydown.escape')
  onEscape() { this.fechar.emit(); }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['preCadastro'] && this.preCadastro) {
      this.cliente.set(null);
      this.semCadastro.set(false);
      this.buscarCliente();
    }
  }

  private buscarCliente() {
    const cpf = this.preCadastro?.cpf;
    if (!cpf) { this.semCadastro.set(true); return; }

    this.carregando.set(true);
    this.clientesSvc.buscarPorCpf(cpf).subscribe({
      next: c => {
        this.cliente.set(c);
        this.semCadastro.set(!c);
        this.carregando.set(false);
      },
      error: () => {
        this.semCadastro.set(true);
        this.carregando.set(false);
      },
    });
  }

  // Formata CPF XXX.XXX.XXX-XX ou XXXXXXXXXXX → XXX.XXX.XXX-XX
  formatarCpf(cpf: string | undefined): string {
    if (!cpf) return '—';
    const d = cpf.replace(/\D/g, '');
    if (d.length !== 11) return cpf;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  }

  formatarHora(ts: any): string {
    if (!ts) return '—';
    try {
      const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  }

  onOverlayClick() { this.fechar.emit(); }
}
