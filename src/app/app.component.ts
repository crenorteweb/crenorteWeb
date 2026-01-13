import { RouterOutlet } from '@angular/router';
import { Component, inject, OnInit } from '@angular/core';
import { AuthService } from './services/auth.service';
import { getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, setPersistence, browserLocalPersistence } from 'firebase/auth';


@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})


export class AppComponent implements OnInit {
  title = 'crenorte-cadastros';

  private authService = inject(AuthService);

  ngOnInit() {

    const app = getApp();
    console.log('FIREBASE PROJECT:', app.options['projectId']);

    (window as any).testLogin = async (email: string, senha: string) => {
      const auth = getAuth();
      try {
        await setPersistence(auth, browserLocalPersistence); // opcional
        const cred = await signInWithEmailAndPassword(auth, email, senha);
        console.log('[TEST LOGIN OK]', cred.user.uid, cred.user.email);
      } catch (e: any) {
        console.error('[TEST LOGIN ERRO]', e?.code, e?.message, e);
      }
    };

    this.authService.firebaseUser$.subscribe(u =>
      console.log('AUTH USER:', u?.uid, u?.email)
    );
    this.authService.perfil$.subscribe(p =>
      console.log('PERFIL:', p)
    );
    this.authService.papel$.subscribe(role =>
      console.log('PAPEL:', role)
    );
  }
}