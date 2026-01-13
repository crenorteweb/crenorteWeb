import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AprovacoesComponent } from './aprovacoes.component';

describe('AprovacoesComponent', () => {
  let component: AprovacoesComponent;
  let fixture: ComponentFixture<AprovacoesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AprovacoesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AprovacoesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
