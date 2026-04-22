import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable } from 'rxjs';

import { AuthService } from '../../../services/auth.service';
import { Colaborador } from '../../../models/colaborador.model';

@Component({
  selector: 'app-header',
  imports: [CommonModule, RouterModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent {
  public auth = inject(AuthService);
  public perfil$: Observable<Colaborador | null> = this.auth.perfil$;

  sidebarAberto = signal(false);

  hasAny(papel: string | null | undefined, roles: string[]): boolean {
    return !!papel && roles.includes(papel);
  }

  fecharSidebar() { this.sidebarAberto.set(false); }
}
