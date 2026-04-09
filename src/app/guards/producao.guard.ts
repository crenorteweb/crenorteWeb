import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const producaoGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  return auth.papel$.pipe(
    take(1),
    map(papel => {
      if (papel === 'admin' || papel === 'supervisor') return true;
      router.navigate(['/dashboard']);
      return false;
    })
  );
};
