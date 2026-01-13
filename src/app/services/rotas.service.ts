// src/app/services/rotas.service.ts
import { Injectable } from '@angular/core';
import * as Papa from 'papaparse';

import { db } from '../firebase.config';
import {
  collection, doc, setDoc, writeBatch, serverTimestamp,
  getDocs, query, orderBy, limit as fsLimit, deleteDoc,
} from 'firebase/firestore';

import { Rota } from '../models/rota.model';

@Injectable({ providedIn: 'root' })
export class RotasService {
  private readonly colecao = collection(db, 'rotas');

  // ---------------- IMPORTAÇÃO ----------------

  /**
   * Import padrão: tenta cabeçalhos (header:true).
   * Se não tiver lat/lng, reparseia o arquivo com header:false e trata como "matriz".
   */
  parseCSV(file: File): Promise<Rota[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          try {
            const fields = (result.meta.fields as string[]) || [];
            const data = result.data as any[];

            const temLatLng =
              fields.some(h => /latitude/i.test(h)) &&
              fields.some(h => /longitude/i.test(h));

            if (temLatLng) {
              const rotas = data
                .map(this.normalizarLinhaPadrao)
                .filter((v): v is Rota => !!v);
              resolve(rotas);
            } else {
              // Fallback: reparseia com header:false para pegar arrays puros (índices numéricos)
              Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                complete: (raw) => {
                  try {
                    const rows = raw.data as any[][];
                    const rotas = this.parseMatrizArrays(rows);
                    resolve(rotas);
                  } catch (e) {
                    reject(e);
                  }
                },
                error: (err) => reject(err),
              });
            }
          } catch (e) {
            reject(e);
          }
        },
        error: (err) => reject(err),
      });
    });
  }

  /**
   * Formato “matriz de metas” como array de arrays (header:false).
   * Ex.: linha com ["SUPERVISOR","ANALISTA","META","1","2",...]
   *       linhas seguintes com nomes de localidades por coluna (3..N),
   *       linhas com analistas e valores de metas por coluna.
   */
  private parseMatrizArrays(rows: any[][]): Rota[] {
    const norm = (v: any) => String(v ?? '').trim();

    // 1) Acha a linha com "SUPERVISOR" e "ANALISTA"
    const idxHeader = rows.findIndex(r => {
      const vals = (r || []).map(x => norm(x).toUpperCase());
      return vals.includes('SUPERVISOR') && vals.includes('ANALISTA');
    });
    if (idxHeader < 0) return [];

    // 2) Mapa de colunas -> nome da localidade, lendo algumas linhas abaixo (onde estão os nomes)
    const localidadesMap = new Map<number, string>(); // colIdx -> texto
    for (let i = idxHeader + 8; i < rows.length; i++) {
      const row = rows[i] || [];
      for (let col = 3; col < row.length; col++) {
        const s = norm(row[col]);
        if (!s) continue;
        // aceita strings com letras (evita números puros)
        if (/[A-Za-zÀ-ÿ]/.test(s) && !localidadesMap.has(col)) {
          localidadesMap.set(col, s);
        }
      }
      if (localidadesMap.size >= 5 && i > (idxHeader + 10)) {
        break;
      }
    }

    // 3) Linhas de analistas e metas: normalmente logo após o header
    //    (ajuste fino pela tua planilha observada: blocos entre idxHeader+3 e idxHeader+12)
    const rotas: Rota[] = [];
    for (let i = idxHeader + 3; i < Math.min(idxHeader + 12, rows.length); i++) {
      const row = rows[i] || [];
      const supervisor = norm(row[0]);
      const analista   = norm(row[1]);
      // const metaTotal = this.parseNumero(row[2]); // opcional

      localidadesMap.forEach((localidade, colIdx) => {
        const meta = this.parseNumero(row[colIdx]);
        if (Number.isFinite(meta) && meta > 0) {
          const { bairro, municipio } = this.splitLocalidade(localidade);
          rotas.push({
            id: `${analista || supervisor}-${localidade}-${i}-${colIdx}`,
            data: '',
            assessor: analista || supervisor || '—',
            municipio,
            bairro,
            latitude: NaN,   // geocodificar depois
            longitude: NaN,  // geocodificar depois
            status: 'planejada',
            peso: meta
          });
        }
      });
    }

    return rotas;
  }

  private splitLocalidade(txt: string): { bairro: string; municipio: string } {
    const s = (txt || '').trim();
    if (s.includes(' - ')) {
      const [b, m] = s.split(' - ').map(x => x.trim());
      return { bairro: b, municipio: m };
    }
    if (s.includes(',')) {
      const [b, m] = s.split(',').map(x => x.trim());
      return { bairro: b, municipio: m };
    }
    const belenenses = ['Marco','Icoaraci','Bengui','Marambaia','Outeiro','São Braz','Guamá','Nazaré','Fátima','Umarizal','Jurunas','Cremação','Tapanã','Souza','Coqueiro','Pedreira','Telégrafo','Cabanagem','Canudos','Curió','Mangueirão','Val-de-Cães','Pratinha'];
    if (belenenses.includes(s)) return { bairro: s, municipio: 'Belém' };
    return { bairro: s, municipio: '' };
  }

  private normalizarLinhaPadrao = (row: any): Rota | null => {
    const lat = this.parseNumero(row.latitude ?? row.Latitude ?? row.LATITUDE);
    const lng = this.parseNumero(row.longitude ?? row.Longitude ?? row.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      id: String(row.id ?? row.ID ?? ''),
      data: String(row.data ?? row.Data ?? ''),
      assessor: String(row.assessor ?? row.Analista ?? row.ANALISTA ?? ''),
      municipio: String(row.municipio ?? row.Município ?? row.Municipio ?? ''),
      bairro: String(row.bairro ?? row.Bairro ?? ''),
      latitude: lat,
      longitude: lng,
      status: String(row.status ?? row.Status ?? 'planejada'),
      peso: Number.isFinite(this.parseNumero(row.peso)) ? this.parseNumero(row.peso) : 1,
    };
  };

  private parseNumero(valor: any): number {
    if (valor === null || valor === undefined) return NaN;
    const s = String(valor).trim().replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // ---------------- FIRESTORE ----------------

  validarRotas(rotas: Rota[]) {
    const validas: Rota[] = [];
    const erros: { index: number; motivo: string }[] = [];

    rotas.forEach((r, i) => {
      const msgs: string[] = [];
      if (!r.assessor) msgs.push('assessor vazio');
      if (!r.bairro) msgs.push('bairro vazio');
      // latitude/longitude podem vir NaN antes da geocodificação
      if (msgs.length) erros.push({ index: i, motivo: msgs.join(', ') });
      else validas.push({ ...r, peso: r.peso ?? 1 });
    });

    return { validas, erros };
  }

  async salvarRotasEmLote(rotas: Rota[]) {
    if (!rotas?.length) return;
    const CHUNK = 450;
    for (let i = 0; i < rotas.length; i += CHUNK) {
      const slice = rotas.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach((rota) => {
        const id = String(rota.id || crypto.randomUUID());
        const ref = doc(this.colecao, id);
        batch.set(ref, { ...rota, peso: rota.peso ?? 1, updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
  }

  async salvarRota(rota: Rota) {
    const ref = doc(this.colecao, String(rota.id || crypto.randomUUID()));
    await setDoc(ref, { ...rota, peso: rota.peso ?? 1, updatedAt: serverTimestamp() });
  }

  async listarRotas(opts?: { ordenarPor?: 'updatedAt' | 'data'; limite?: number }): Promise<Rota[]> {
    const ordenarPor = opts?.ordenarPor ?? 'updatedAt';
    const limite = opts?.limite ?? 0;
    const q = limite > 0 ? query(this.colecao, orderBy(ordenarPor, 'desc'), fsLimit(limite))
                         : query(this.colecao, orderBy(ordenarPor, 'desc'));
    const snap = await getDocs(q);
    const out: Rota[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      out.push({
        id: d.id,
        data: data.data ?? '',
        assessor: data.assessor ?? '',
        municipio: data.municipio ?? '',
        bairro: data.bairro ?? '',
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        status: data.status ?? '',
        peso: Number.isFinite(Number(data.peso)) ? Number(data.peso) : 1,
      });
    });
    return out;
  }

  async deletarRota(id: string) {
    const ref = doc(this.colecao, id);
    await deleteDoc(ref);
  }

  gerarCSVModelo(): Blob {
    const exemplo = [
      { id: 'R-001', data: '2025-08-10', assessor: 'Maria', municipio: 'Belém', bairro: 'Marco', latitude: -1.4348, longitude: -48.4682, status: 'planejada', peso: 1 },
      { id: 'R-002', data: '2025-08-10', assessor: 'João', municipio: 'Ananindeua', bairro: 'Centro', latitude: -1.3651, longitude: -48.3723, status: 'pendente', peso: 2 },
    ];
    const csv = Papa.unparse(exemplo as any);
    return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  }
}
