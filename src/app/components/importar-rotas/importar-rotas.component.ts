// componentes/importar-rotas/importar-rotas.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import Papa from 'papaparse';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-importar-rotas',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="container py-4">
    <h4>Importar Rotas (CSV)</h4>
    <input type="file" (change)="onFile($event)" accept=".csv" class="form-control mb-2"/>
    <div *ngIf="msg">{{ msg }}</div>
  </div>
  `
})
export class ImportarRotasComponent {
  msg = '';

  constructor(private afs: Firestore) {}

  onFile(ev: any) {
    const file = ev.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res: any) => {
        let ok = 0, fail = 0;
        for (const row of res.data) {
          try {
            const doc = {
              id: row.id || crypto.randomUUID(),
              data: row.data, // "YYYY-MM-DD"
              assessor: row.assessor,
              supervisor: row.supervisor || null,
              municipio: row.municipio,
              bairro: row.bairro || null,
              endereco: row.endereco || null,
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              tipo_visita: row.tipo_visita || null,
              status: row.status || null,
              peso: row.peso ? Number(row.peso) : 1
            };
            if (Number.isFinite(doc.latitude) && Number.isFinite(doc.longitude)) {
              await addDoc(collection(this.afs, 'rotas'), doc);
              ok++;
            } else {
              fail++;
            }
          } catch {
            fail++;
          }
        }
        this.msg = `Importação concluída. Sucesso: ${ok} | Falhas: ${fail}`;
      }
    });
  }
}
