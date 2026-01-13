import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PreCadastroListaComponent } from './pre-cadastro-lista.component';

describe('PreCadastroListaComponent', () => {
  let component: PreCadastroListaComponent;
  let fixture: ComponentFixture<PreCadastroListaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreCadastroListaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PreCadastroListaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
