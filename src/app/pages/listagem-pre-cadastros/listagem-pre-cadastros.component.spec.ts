import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListagemPreCadastrosComponent } from './listagem-pre-cadastros.component';

describe('ListagemPreCadastrosComponent', () => {
  let component: ListagemPreCadastrosComponent;
  let fixture: ComponentFixture<ListagemPreCadastrosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListagemPreCadastrosComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ListagemPreCadastrosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
