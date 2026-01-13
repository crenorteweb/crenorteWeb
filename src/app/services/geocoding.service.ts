import { Injectable } from '@angular/core';

export interface GeoPoint { lat: number; lon: number; }

@Injectable({ providedIn: 'root' })
export class GeocodingService {
  private cache = new Map<string, GeoPoint>();
  private polyCache = new Map<string, any>(); // GeoJSON Feature

  constructor() {
    // pontos
    const raw = localStorage.getItem('geocache_rotas');
    if (raw) {
      try {
        const obj = JSON.parse(raw) as Record<string, GeoPoint>;
        Object.entries(obj).forEach(([k, v]) => this.cache.set(k, v));
      } catch {}
    }
    // polígonos
    const praw = localStorage.getItem('geopoly_rotas_v1');
    if (praw) {
      try {
        const obj = JSON.parse(praw) as Record<string, any>;
        Object.entries(obj).forEach(([k, v]) => this.polyCache.set(k, v));
      } catch {}
    }
  }

  private savePointCache() {
    const obj: Record<string, GeoPoint> = {};
    this.cache.forEach((v, k) => (obj[k] = v));
    localStorage.setItem('geocache_rotas', JSON.stringify(obj));
  }

  private savePolyCache() {
    const obj: Record<string, any> = {};
    this.polyCache.forEach((v, k) => (obj[k] = v));
    localStorage.setItem('geopoly_rotas_v1', JSON.stringify(obj));
  }

  async geocode(term: string): Promise<GeoPoint | null> {
    const key = term.trim().toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key)!;

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(term)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Crenorte-Rotas/1.0 (contato@exemplo.com)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    const { lat, lon } = data[0];
    const p = { lat: Number(lat), lon: Number(lon) };
    this.cache.set(key, p);
    this.savePointCache();
    return p;
  }

  /** Polígono GeoJSON do bairro (quando existir no OSM). */
  async getPolygon(term: string): Promise<any | null> {
    const key = `poly:${term.trim().toLowerCase()}`;
    if (this.polyCache.has(key)) return this.polyCache.get(key);

    // polygon_geojson=1 pede o contorno; limit=1 pega o melhor match
    const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&limit=1&q=${encodeURIComponent(term)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Crenorte-Rotas/1.0 (contato@exemplo.com)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length || !data[0].geojson) return null;

    const feature = {
      type: 'Feature',
      properties: { display_name: data[0].display_name },
      geometry: data[0].geojson
    };
    this.polyCache.set(key, feature);
    this.savePolyCache();
    return feature;
  }

  delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
}
