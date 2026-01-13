import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListagemAgendamentosComponent } from './listagem-agendamentos.component';

describe('ListagemAgendamentosComponent', () => {
  let component: ListagemAgendamentosComponent;
  let fixture: ComponentFixture<ListagemAgendamentosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListagemAgendamentosComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ListagemAgendamentosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
