import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import * as L from 'leaflet';
import 'leaflet.heat';

import { RotasService } from '../../services/rotas.service';
import { GeocodingService } from '../../services/geocoding.service';
import { Rota } from '../../models/rota.model';

import { HeaderComponent } from '../../pages/shared/header/header.component';

type BairroAgg = {
  bairro: string;
  municipio: string;
  totalPeso: number;
  analistas: Set<string>;
  lat?: number;
  lng?: number;
};

type Basemap = 'osm' | 'voyager' | 'streets' | 'imagery';

@Component({
  selector: 'app-mapa-rotas-heatmap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mapa-rotas-heatmap.component.html',
  styleUrls: ['./mapa-rotas-heatmap.component.css']
})
export class MapaRotasHeatmapComponent implements AfterViewInit {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // pré-visualização importada
  linhasImportadas: Rota[] = [];
  usarImportadasNoMapa = false;

  // firestore
  rotasFirestore: Rota[] = [];

  // edição inline
  editingId: string | null = null;
  editForm: Rota = {
    id: '', data: '', assessor: '', municipio: '', bairro: '',
    latitude: 0, longitude: 0, status: 'planejada', peso: 1
  };

  importMsg = '';

  // leaflet
  private map!: L.Map;
  private tileLayer!: L.TileLayer;
  private marcadoresLayer = L.layerGroup();
  private heatLayer: any = null;
  private setorLayer = L.layerGroup();   // usaremos para polígonos também
  private legendControl: L.Control | null = null;

  // toggles
  mostrarHeatmap = false;
  mostrarMarcadores = false;
  modoSetorizacao = true;

  // basemap
  basemap: Basemap = 'osm';

  // paleta e faixas
  private readonly COLOR_BINS = [0.2, 0.4, 0.6, 0.8, 1.01];
  private readonly COLOR_SCALE = ['#0ea5a0', '#84cc16', '#f59e0b', '#f97316', '#ef4444'];

  constructor(
    private rotasService: RotasService,
    private geo: GeocodingService
  ) {}

  async ngAfterViewInit() {
    this.initMap();
    await this.carregarRotas(); // Firestore na inicialização
  }

  private initMap() {
    const belem: L.LatLngExpression = [-1.4558, -48.4902];
    this.map = L.map('mapid', { center: belem, zoom: 11, zoomControl: true });

    this.trocarBasemap();
    (L.control as any).scale({ imperial: false }).addTo(this.map);

    this.marcadoresLayer.addTo(this.map);
    this.setorLayer.addTo(this.map);
    this.addOrUpdateLegend(0);
  }

  // ===== basemap =====
  trocarBasemap() {
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    const cfg = this.getBasemapConfig(this.basemap);
    this.tileLayer = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution });
    this.tileLayer.addTo(this.map);
  }

  private getBasemapConfig(style: Basemap) {
    switch (style) {
      case 'osm':
        return { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 };
      case 'voyager':
        return { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 20 };
      case 'streets':
        return { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri — World Street Map', maxZoom: 19 };
      case 'imagery':
        return { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri — World Imagery', maxZoom: 20 };
    }
  }

  abrirSeletorArquivo() {
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
      this.fileInput.nativeElement.click();
    }
  }

  // ======= Importar CSV (pré-visualização) =======
  async onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const rotas = await this.rotasService.parseCSV(file);
      const { validas, erros } = this.rotasService.validarRotas(rotas);

      // agregação por bairro
      const aggMap = new Map<string, BairroAgg>();
      for (const r of validas) {
        const key = `${(r.bairro || '').trim().toLowerCase()}|${(r.municipio || '').trim().toLowerCase()}`;
        if (!aggMap.has(key)) {
          aggMap.set(key, { bairro: r.bairro, municipio: r.municipio || 'Belém', totalPeso: 0, analistas: new Set<string>() });
        }
        const agg = aggMap.get(key)!;
        agg.totalPeso += Number(r.peso ?? 1);
        agg.analistas.add(r.assessor || '—');
      }

      // Geocodificação (ponto) só para fallback
      let geocoded = 0;
      for (const agg of aggMap.values()) {
        const termo = `${agg.bairro}${agg.municipio ? ', ' + agg.municipio : ''}, Pará, Brasil`;
        const p = await this.geo.geocode(termo);
        if (p) { agg.lat = p.lat; agg.lng = p.lon; geocoded++; }
        await this.geo.delay(500);
      }

      // vira rotas de pré-visualização (1 ponto por bairro)
      this.linhasImportadas = [];
      for (const agg of aggMap.values()) {
        if (Number.isFinite(agg.lat!) && Number.isFinite(agg.lng!)) {
          this.linhasImportadas.push({
            id: `${agg.bairro}-${agg.municipio}`,
            data: '',
            assessor: Array.from(agg.analistas).join(', '),
            municipio: agg.municipio,
            bairro: agg.bairro,
            latitude: agg.lat!,
            longitude: agg.lng!,
            status: 'planejada',
            peso: agg.totalPeso
          });
        }
      }

      this.importMsg =
        `Pré-visualização: ${this.linhasImportadas.length} setor(es)` +
        ` | geocodificados: ${geocoded}` +
        (erros.length ? ` | linhas com erro: ${erros.length}` : '');

      this.usarImportadasNoMapa = true;
      this.aplicarFonteNoMapa();
      this.fitAoConteudo();
    } catch (e) {
      console.error(e);
      this.importMsg = 'Falha ao ler CSV.';
    }
  }

  // ======= Firestore =======
  async carregarRotas() {
    try {
      this.rotasFirestore = await this.rotasService.listarRotas({ ordenarPor: 'updatedAt' });
      if (!this.usarImportadasNoMapa) {
        this.updateCamadas();
        this.fitAoConteudo();
      }
    } catch (e) {
      console.error(e);
      this.importMsg = 'Erro ao carregar rotas do Firestore.';
    }
  }

  async salvarImportados() {
    if (!this.linhasImportadas.length) return;
    try {
      await this.rotasService.salvarRotasEmLote(this.linhasImportadas);
      this.importMsg = 'Rotas importadas salvas no Firestore! Recarregando...';
      this.linhasImportadas = [];
      this.usarImportadasNoMapa = false;
      await this.carregarRotas();
    } catch (e) {
      console.error(e);
      this.importMsg = 'Erro ao salvar rotas no Firestore.';
    }
  }

  // ======= Lista (editar/excluir) =======
  trackById = (_: number, r: Rota) => r.id;
  iniciarEdicao(r: Rota) { this.editingId = r.id; this.editForm = { ...r }; }
  cancelarEdicao() { this.editingId = null; }
  async salvarEdicao() {
    if (!this.editingId) return;
    try {
      await this.rotasService.salvarRota(this.editForm);
      this.editingId = null;
      await this.carregarRotas();
      if (!this.usarImportadasNoMapa) { this.updateCamadas(); this.fitAoConteudo(); }
    } catch { this.importMsg = 'Erro ao salvar edição.'; }
  }
  async excluirRota(r: Rota) {
    if (!confirm(`Excluir rota de "${r.bairro} - ${r.municipio}"?`)) return;
    try {
      await this.rotasService.deletarRota(r.id);
      await this.carregarRotas();
      if (!this.usarImportadasNoMapa) { this.updateCamadas(); this.fitAoConteudo(); }
    } catch { this.importMsg = 'Erro ao excluir rota.'; }
  }

  // ======= UI =======
  baixarModeloCSV() {
    const blob = this.rotasService.gerarCSVModelo();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'modelo_rotas.csv'; a.click();
    URL.revokeObjectURL(url);
  }
  centralizarNoPara() {
    const bounds = L.latLngBounds([-9.8, -60.0], [2.0, -41.0]);
    this.map.fitBounds(bounds, { padding: [20, 20] });
  }
  aplicarFonteNoMapa() { this.updateCamadas(); this.fitAoConteudo(); }

  // ======= Mapa / camadas =======
  private getFonteRotas(): Rota[] {
    return this.usarImportadasNoMapa && this.linhasImportadas.length
      ? this.linhasImportadas
      : this.rotasFirestore;
  }

  updateCamadas() {
  if (!this.map) return;

  this.marcadoresLayer.clearLayers();
  this.setorLayer.clearLayers();
  if (this.heatLayer) { this.map.removeLayer(this.heatLayer); this.heatLayer = null; }

  const fonte = this.getFonteRotas();
  if (!fonte.length) { this.addOrUpdateLegend(0); return; }

  if (this.modoSetorizacao) {
    // SETORIZAÇÃO (polígonos ou fallback)
    const agg = this.agruparPorBairro(fonte);
    void this.desenharSetorizacaoPoligonos(agg); // assíncrono
  } else {
    // PONTOS
    const maxPeso = Math.max(...fonte.map(r => r.peso ?? 1), 1); // << calcula uma vez

    for (const r of fonte) {
      if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
      const proporcao = (r.peso || 1) / maxPeso;
      const color = this.getColorByRatio(proporcao);

      const m = L.circleMarker([r.latitude, r.longitude], {
        radius: 6, weight: 1.5, color, fillColor: color, fillOpacity: 0.4
      }).bindTooltip(`
          <div style="min-width:220px">
            <strong>${r.bairro}</strong>${r.municipio ? ` - <strong>${r.municipio}</strong>` : ''}<br/>
            Meta (peso): <strong>${r.peso ?? 1}</strong><br/>
            Colaboradores: <small>${r.assessor || '—'}</small>
          </div>
        `, { direction: 'top', sticky: true, opacity: 0.98 });

      this.marcadoresLayer.addLayer(m);
    }

    if (this.mostrarHeatmap && (L as any).heatLayer && fonte.length) {
      const pontos = fonte
        .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
        .map(r => [r.latitude, r.longitude, Math.max(0.1, r.peso ?? 1)]);
      this.heatLayer = (L as any).heatLayer(pontos, { radius: 25, blur: 15 });
      this.heatLayer.addTo(this.map);
    }

    this.addOrUpdateLegend(maxPeso); // << reaproveita
  }
}


  /** Desenha polígonos (ou círculos de fallback) para cada bairro agregado. */
  private async desenharSetorizacaoPoligonos(aggs: BairroAgg[]) {
    this.setorLayer.clearLayers();

    const maxPeso = Math.max(...aggs.map(a => a.totalPeso), 1);
    const minStroke = 1, maxStroke = 2;

    for (const a of aggs) {
      const proporcao = (a.totalPeso || 1) / maxPeso;
      const color = this.getColorByRatio(proporcao);

      // tenta polígono oficial do bairro
      const termo = `${a.bairro}${a.municipio ? ', ' + a.municipio : ''}, Pará, Brasil`;
      let feature: any = await this.geo.getPolygon(termo);
      if (feature) {
        const layer = L.geoJSON(feature, {
          style: () => ({
            color,
            weight: minStroke + (maxStroke - minStroke) * Math.sqrt(proporcao),
            fillColor: color,
            fillOpacity: 0.35
          })
        });

        layer.bindTooltip(`
          <div style="min-width:220px">
            <strong>${a.bairro}</strong>${a.municipio ? ` - <strong>${a.municipio}</strong>` : ''}<br/>
            Meta total: <strong>${a.totalPeso}</strong><br/>
            Colaboradores: <small>${Array.from(a.analistas).join(', ') || '—'}</small>
          </div>
        `, { direction: 'top', sticky: true, opacity: 0.98 });

        // hover highlight
        layer.on('mouseover', (e: any) => e.layer.setStyle({ fillOpacity: 0.5 }));
        layer.on('mouseout',  (e: any) => e.layer.setStyle({ fillOpacity: 0.35 }));

        this.setorLayer.addLayer(layer);
      } else {
        // fallback: círculo no centróide que já temos (lat/lng médios)
        if (Number.isFinite(a.lat!) && Number.isFinite(a.lng!)) {
          const radius = 10 + 25 * Math.sqrt(proporcao);
          const marker = L.circleMarker([a.lat!, a.lng!], {
            radius, weight: 1.5, color, fillColor: color, fillOpacity: 0.35
          }).bindTooltip(`
              <div style="min-width:220px">
                <strong>${a.bairro}</strong>${a.municipio ? ` - <strong>${a.municipio}</strong>` : ''}<br/>
                Meta total: <strong>${a.totalPeso}</strong><br/>
                Colaboradores: <small>${Array.from(a.analistas).join(', ') || '—'}</small>
              </div>
            `, { direction: 'top', sticky: true, opacity: 0.98 });
          this.setorLayer.addLayer(marker);
        }
      }

      // respeita limites da API pública
      await this.geo.delay(500);
    }

    this.addOrUpdateLegend(maxPeso);
  }

  private fitAoConteudo() {
    const fonte = this.getFonteRotas();
    const coords: [number, number][] = fonte
      .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
      .map(r => [r.latitude, r.longitude] as [number, number]);
    if (!coords.length) return;
    const bounds = L.latLngBounds(coords);
    this.map.fitBounds(bounds, { padding: [20, 20] });
  }

  private agruparPorBairro(rotas: Rota[]): BairroAgg[] {
    const map = new Map<string, BairroAgg>();
    for (const r of rotas) {
      const key = `${(r.bairro || '').trim().toLowerCase()}|${(r.municipio || '').trim().toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, { bairro: r.bairro, municipio: r.municipio, totalPeso: 0, analistas: new Set<string>(), lat: 0, lng: 0 });
      }
      const a = map.get(key)!;
      a.totalPeso += Number(r.peso ?? 1);
      a.analistas.add(r.assessor || '—');

      if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
        const n = (a as any)._n ?? 0;
        a.lat = (n * (a.lat ?? 0) + r.latitude) / (n + 1);
        a.lng = (n * (a.lng ?? 0) + r.longitude) / (n + 1);
        (a as any)._n = n + 1;
      }
    }
    return Array.from(map.values());
  }

  private getColorByRatio(ratio: number): string {
    for (let i = 0; i < this.COLOR_BINS.length; i++) {
      if (ratio <= this.COLOR_BINS[i]) return this.COLOR_SCALE[i];
    }
    return this.COLOR_SCALE[this.COLOR_SCALE.length - 1];
  }

  // Legenda
  private addOrUpdateLegend(maxPeso: number) {
    const bins = this.COLOR_BINS, colors = this.COLOR_SCALE;
    const abs = bins.map(b => Math.max(1, Math.round(b * (maxPeso || 1))));
    const labels = [
      `0 – ${abs[0]}`, `${abs[0] + 1} – ${abs[1]}`,
      `${abs[1] + 1} – ${abs[2]}`, `${abs[2] + 1} – ${abs[3]}`,
      `≥ ${abs[3] + 1}`
    ];
    const html = () => colors.map((c, i) => `
      <div class="item"><span class="swatch" style="background:${c}"></span><span>${labels[i]}</span></div>
    `).join('');

    if (!this.legendControl) {
      const Legend = (L.Control as any).extend({
        onAdd: () => {
          const div = L.DomUtil.create('div', 'leaflet-control crn-legend') as HTMLElement;
          div.innerHTML = `<div class="crn-legend"><div class="title">Meta (faixas)</div>${html()}</div>`;
          return div;
        }
      });
      this.legendControl = new Legend({ position: 'bottomright' }) as L.Control;
      this.legendControl.addTo(this.map);
    } else {
      const container = (this.legendControl as any).getContainer?.() as HTMLElement;
      if (container) container.innerHTML = `<div class="crn-legend"><div class="title">Meta (faixas)</div>${html()}</div>`;
    }
  }
}
