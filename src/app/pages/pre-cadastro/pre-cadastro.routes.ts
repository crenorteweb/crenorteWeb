import { Routes } from '@angular/router';
import { assessorOnlyGuard, adminOrSupervisorGuard } from '../../guards/role.guard';

export const PRE_CADASTRO_ROUTES: Routes = [
  {
    path: 'pre-cadastro/novo',
    canActivate: [assessorOnlyGuard],
    loadComponent: () => import('./pre-cadastro-form/pre-cadastro-form.component')
      .then(m => m.PreCadastroFormComponent)
  },
  {
    path: 'pre-cadastro/minha-lista',
    canActivate: [assessorOnlyGuard],
    loadComponent: () => import('./pre-cadastro-lista/pre-cadastro-lista.component')
      .then(m => m.PreCadastroListaComponent)
  },
  {
    path: 'pre-cadastro/relatorio',
    // relatória: admin/supervisor; (assessor tem sua visão dentro do componente)
    canActivate: [adminOrSupervisorGuard],
    loadComponent: () => import('./pre-cadastro-relatorio/pre-cadastro-relatorio.component')
      .then(m => m.PreCadastroRelatorioComponent)
  }
];
