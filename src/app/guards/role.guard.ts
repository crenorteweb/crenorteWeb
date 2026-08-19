// src/app/guards/role.guard.ts
import { CanActivateFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

const MAX_SESSION_TIME = 3 * 60 * 60 * 1000; // Tempo do token 3 horas

// Mesmo tipo do seu model
export type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'operacional' | 'rh' | 'financeiro' | 'qualidade';

async function resolvePapel(auth: AuthService): Promise<Papel | null> {
  try {
    const papel = await firstValueFrom(auth.papel$.pipe(take(1)));
    if (papel) return papel as Papel;
  } catch {}
  try {
    const raw = localStorage.getItem('perfil');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { papel?: Papel };
    return parsed.papel ?? null;
  } catch {
    return null;
  }
}

// ✅ Agora retorna uma função com a ASSINATURA CERTA: (route, state)
function roleGuardCore(rolesPermitidos: Papel[]): CanActivateFn {
  return (route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Promise<boolean | UrlTree> => {
    const router = inject(Router);
    const auth = inject(AuthService);

    return (async () => {
      // 1) Checa usuário logado
      const user = await firstValueFrom(auth.firebaseUser$.pipe(take(1)));
      if (!user) return router.parseUrl('/login');

      // 🔐 1.1) Força novo login a cada 24h
      const tokenResult = await user.getIdTokenResult();
      const authTime = new Date(tokenResult.authTime).getTime();
      const now = Date.now();

      if (now - authTime > MAX_SESSION_TIME) {
        await auth.logout(); // ou signOut(auth)
        return router.parseUrl('/login');
      }

      // 2) Bootstrap do perfil
      try {
        await auth.garantirPerfilMinimo();
      } catch {
        return router.parseUrl('/acesso-negado');
      }

      // 3) Verifica papel
      const papel = await resolvePapel(auth);
      const autorizado = !!papel && rolesPermitidos.includes(papel);

      return autorizado ? true : router.parseUrl('/acesso-negado');
    })();
  };
}

// Lê roles da rota e delega pro core (sem usar async aqui)
export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const roles = (route.data?.['roles'] as Papel[] | undefined) ?? [];
  return roleGuardCore(roles)(route, state);
};

// Guards específicos reaproveitando o core
export const assessorOnlyGuard: CanActivateFn = roleGuardCore(['assessor']);
export const adminOrSupervisorGuard: CanActivateFn = roleGuardCore(['admin', 'supervisor']);
