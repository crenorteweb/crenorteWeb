import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PreCadastroRelatorioComponent } from './pre-cadastro-relatorio.component';

describe('PreCadastroRelatorioComponent', () => {
  let component: PreCadastroRelatorioComponent;
  let fixture: ComponentFixture<PreCadastroRelatorioComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreCadastroRelatorioComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PreCadastroRelatorioComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
