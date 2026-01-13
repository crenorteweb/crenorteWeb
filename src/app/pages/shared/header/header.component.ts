import { Component, inject } from '@angular/core';
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
    // ✅ injeta o service e expõe um observable tipado pra template
    public auth = inject(AuthService);
    public perfil$: Observable<Colaborador | null> = this.auth.perfil$;

}
