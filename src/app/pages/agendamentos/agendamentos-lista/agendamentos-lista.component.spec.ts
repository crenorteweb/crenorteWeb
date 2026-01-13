import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgendamentosListaComponent } from './agendamentos-lista.component';

describe('AgendamentosListaComponent', () => {
  let component: AgendamentosListaComponent;
  let fixture: ComponentFixture<AgendamentosListaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgendamentosListaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AgendamentosListaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
