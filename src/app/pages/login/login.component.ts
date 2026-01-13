// src/app/pages/login/login.component.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  template: `
  <div class="container py-5" style="max-width: 420px;">
    <h3 class="mb-3">Entrar</h3>
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="mb-3">
        <label class="form-label">E-mail</label>
        <input type="email" class="form-control" formControlName="email" autocomplete="username" />
      </div>
      <div class="mb-3">
        <label class="form-label">Senha</label>
        <input type="password" class="form-control" formControlName="senha" autocomplete="current-password" />
      </div>
      <button class="btn btn-success w-100" [disabled]="form.invalid || loading()">
        {{ loading() ? 'Entrando…' : 'Entrar' }}
      </button>
      <button type="button" class="btn btn-link mt-2" (click)="reset()">Esqueci minha senha</button>
      <div class="text-danger mt-2" *ngIf="erro()">{{ erro() }}</div>
    </form>
  </div>
  `
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  loading = signal(false);
  erro = signal<string | null>(null);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(6)]],
  });

  async onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.erro.set(null);

    const { email, senha } = this.form.value as { email: string; senha: string };

    try {
      // 1) faz login
      await this.auth.login(email, senha);

      // 2) garante que o doc colaboradores/{uid} exista (regras permitem a auto-criação 1x)
      await this.auth.garantirPerfilMinimo();

      // 3) pega o papel atual para decidir rota
      const papel = await firstValueFrom(this.auth.papel$);

      // 4) redireciona conforme o papel (ajuste as rotas como preferir)
      const destino = this.definirRotaPorPapel(papel);
      await this.router.navigate([destino]);
    } catch (e: any) {
      // mensagens mais amigáveis para erros comuns
      const msg = String(e?.message ?? e ?? '');
      if (msg.includes('auth/invalid-credential') || msg.includes('auth/invalid-login-credentials')) {
        this.erro.set('E-mail ou senha inválidos.');
      } else if (msg.includes('auth/user-not-found')) {
        this.erro.set('Usuário não encontrado.');
      } else if (msg.includes('auth/wrong-password')) {
        this.erro.set('Senha incorreta.');
      } else if (msg.includes('auth/too-many-requests')) {
        this.erro.set('Muitas tentativas. Tente novamente mais tarde.');
      } else {
        this.erro.set('Falha no login. ' + msg);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async reset() {
    const email = this.form.get('email')?.value as string | null;
    if (!email) {
      this.erro.set('Informe seu e-mail para recuperar a senha.');
      return;
    }
    try {
      await this.auth.resetSenha(email);
      this.erro.set('Enviamos um link de redefinição para seu e-mail.');
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '');
      this.erro.set('Falha ao enviar e-mail de redefinição. ' + msg);
    }
  }

  /** Ajuste o mapa de papéis -> rotas conforme sua aplicação */
  private definirRotaPorPapel(papel: string | null): string {
    const map: Record<string, string> = {
      admin: '/dashboard',
      supervisor: '/dashboard',
      coordenador: '/dashboard',
      rh: '/rh',
      assessor: '/dashboard', // ex.: área operacional/cliente
    };
    return (papel && map[papel]) ? map[papel] : '/dashboard';
  }
}
