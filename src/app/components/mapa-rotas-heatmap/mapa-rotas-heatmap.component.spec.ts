import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapaRotasHeatmapComponent } from './mapa-rotas-heatmap.component';

describe('MapaRotasHeatmapComponent', () => {
  let component: MapaRotasHeatmapComponent;
  let fixture: ComponentFixture<MapaRotasHeatmapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapaRotasHeatmapComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapaRotasHeatmapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
